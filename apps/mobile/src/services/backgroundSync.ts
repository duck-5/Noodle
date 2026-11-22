import { Platform } from 'react-native';
import {
  runSync,
  RunSyncOptions,
  SmartProgressCalculator,
  SyncProgressState,
  SyncResult,
} from '@tautracker/moodle-client';
import {
  applyLocalSettingsPatch,
  getLocalSettingsSnapshot,
  performSettingsSync,
} from './settingsSyncService';
import {
  getCourseStaffMap,
  getPreference,
  getTrackedCourses,
  removePreference,
  saveSyncResultToDatabase,
  setPreference,
} from './database';
import { scheduleDeadlineNotifications } from './notifications';
import { performGoogleTasksSync } from './googleTasks';
import {
  getStoredCredentials,
  getStoredSesskey,
  getStoredToken,
  renewTokenSilently,
  saveToken,
} from './auth';
import { MOCK_COURSE_ID } from './mockCourse';

const BACKGROUND_SYNC_TASK = 'NOODLE_BACKGROUND_SYNC';
const BG_SYNC_INTERVAL_PREF = 'bg_sync_registered_interval_sec';

function getBackgroundModules(): {
  BackgroundFetch: typeof import('expo-background-fetch') | null;
  TaskManager: typeof import('expo-task-manager') | null;
} {
  if (Platform.OS === 'web') {
    return { BackgroundFetch: null, TaskManager: null };
  }
  let BackgroundFetch: typeof import('expo-background-fetch') | null = null;
  let TaskManager: typeof import('expo-task-manager') | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    BackgroundFetch = require('expo-background-fetch');
  } catch {}
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    TaskManager = require('expo-task-manager');
  } catch {}
  return { BackgroundFetch, TaskManager };
}

export async function getMoodleToken(): Promise<string | null> {
  return await getStoredToken();
}

export async function setMoodleToken(token: string | null): Promise<void> {
  await saveToken(token as any);
}

export async function getTrackedCourseIdsFromDb(): Promise<number[]> {
  try {
    const rows = getTrackedCourses(true);
    if (Array.isArray(rows) && rows.length > 0) {
      return rows.map((r) => r.moodle_id);
    }
    return getLocalSettingsSnapshot().trackedCourseIds;
  } catch (e) {
    console.error('getTrackedCourseIdsFromDb error:', e);
    return [];
  }
}

export function isTokenAuthError(err: unknown): boolean {
  const e =
    err && typeof err === 'object'
      ? (err as { errorcode?: string; exception?: string; message?: string })
      : null;
  const code = String(e?.errorcode || '').toLowerCase();
  const msg = String(typeof err === 'string' ? err : e?.message || '').toLowerCase();
  return (
    code === 'invalidtoken' ||
    code === 'accessexception' ||
    code === 'auth_session_expired' ||
    msg.includes('invalidtoken') ||
    msg.includes('accessexception') ||
    msg.includes('invalid token')
  );
}

export function persistDiscoveredPanoptoFolders(
  discovered?: Record<number, string>
): Record<number, string> {
  const currentMap = getLocalSettingsSnapshot().coursesPanoptoMap;
  if (!discovered || Object.keys(discovered).length === 0) {
    return currentMap;
  }

  const sanitizedDiscovered: Record<number, string> = {};
  for (const [cidKey, folderId] of Object.entries(discovered)) {
    if (cidKey.trim().length === 0) continue;
    const cid = Number(cidKey);
    if (
      Number.isInteger(cid) &&
      cid > 0 &&
      typeof folderId === 'string' &&
      folderId.trim().length > 0
    ) {
      sanitizedDiscovered[cid] = folderId.trim();
    }
  }
  if (Object.keys(sanitizedDiscovered).length === 0) {
    return currentMap;
  }

  const mergedMap: Record<number, string> = {
    ...sanitizedDiscovered,
    ...currentMap, // Preserve existing user manual overrides
  };
  const hasNewMapping = Object.keys(sanitizedDiscovered).some((k) => {
    const cid = Number(k);
    return !currentMap[cid];
  });
  if (hasNewMapping) {
    applyLocalSettingsPatch({ coursesPanoptoMap: mergedMap }, false);
  }
  return mergedMap;
}

function extractTokenValue(renewed: unknown): string | null {
  if (typeof renewed === 'string' && renewed.trim().length > 0) {
    return renewed.trim();
  }
  if (renewed && typeof renewed === 'object' && typeof (renewed as { token?: string }).token === 'string') {
    const tok = (renewed as { token: string }).token.trim();
    return tok.length > 0 ? tok : null;
  }
  return null;
}

export async function triggerForegroundSync(
  onProgressState?: (state: SyncProgressState) => void,
  onPartialResult?: (partial: Partial<SyncResult>) => void
): Promise<SyncResult> {
  let token = await getMoodleToken();
  if (!token) {
    const renewed = extractTokenValue(await renewTokenSilently());
    if (renewed) {
      token = renewed;
    }
  }
  if (!token) {
    throw new Error('Moodle token not configured.');
  }

  let highestPercent = 0;
  let latestState: SyncProgressState = {
    percent: 0,
    stage: 'init',
    message: 'Starting sync...',
    coursesCompleted: 0,
    totalCourses: 0,
    activitiesCompleted: 0,
    totalActivities: 0,
  };

  const emitMonotonic = (next: SyncProgressState) => {
    const clampedPercent = Math.max(highestPercent, Math.min(100, Math.round(next.percent)));
    highestPercent = clampedPercent;
    latestState = {
      ...next,
      percent: clampedPercent,
    };
    onProgressState?.(latestState);
  };

  const progressCalc = new SmartProgressCalculator(0, (_msg, state) => {
    emitMonotonic(state);
  });
  progressCalc.start('Syncing settings...');

  // Pull any latest configuration from Moodle before syncing assignments (TTL + mutex handled inside performSettingsSync)
  try {
    await performSettingsSync(token);
  } catch (e) {
    console.warn('Non-fatal: Failed to pull settings before assignment sync', e);
  }

  let trackedIds = await getTrackedCourseIdsFromDb();
  let syncCourseIds = trackedIds.filter((id) => Number.isFinite(id) && id > 0 && id !== MOCK_COURSE_ID);
  let settings = getLocalSettingsSnapshot();
  const creds = await getStoredCredentials();
  const cachedCourseStaff = getCourseStaffMap();

  const handleRunSyncProgress = (msg: string, progress?: number | SyncProgressState) => {
    if (progress && typeof progress === 'object') {
      const capped = progress.stage === 'complete' || progress.percent >= 100 ? 99 : progress.percent;
      emitMonotonic({
        ...progress,
        percent: capped,
        stage: progress.stage === 'complete' ? 'finalizing' : progress.stage,
        message: progress.message || msg,
      });
    } else if (typeof progress === 'number') {
      const capped = progress >= 100 ? 99 : progress;
      emitMonotonic({
        ...latestState,
        percent: capped,
        message: msg,
      });
    } else {
      emitMonotonic({
        ...latestState,
        message: msg,
      });
    }
  };

  const executeRunSync = async (activeToken: string): Promise<SyncResult> => {
    const sesskey = await getStoredSesskey();
    const options: RunSyncOptions & { useNativeCookies?: boolean } = {
      enablePanopto: settings.panoptoEnabled,
      coursesPanoptoMap: settings.coursesPanoptoMap,
      coursesPanoptoStaff: settings.coursesPanoptoStaff,
      cachedCourseStaff,
      enableScraping: false,
      lang: settings.language,
      useNativeCookies: true,
    };

    return await runSync(
      activeToken,
      syncCourseIds,
      handleRunSyncProgress,
      undefined,
      creds || undefined,
      undefined,
      sesskey || undefined,
      (partial) => {
        saveSyncResultToDatabase(partial as SyncResult, {
          panoptoEnabled: settings.panoptoEnabled,
          activeCourseIds: trackedIds,
        });
        if (partial.discoveredPanoptoFolders) {
          persistDiscoveredPanoptoFolders(partial.discoveredPanoptoFolders);
        }
        onPartialResult?.(partial);
      },
      options as RunSyncOptions
    );
  };

  let result: SyncResult;
  try {
    result = await executeRunSync(token);
  } catch (err: unknown) {
    if (isTokenAuthError(err)) {
      const freshToken = extractTokenValue(await renewTokenSilently());
      if (freshToken) {
        try {
          await performSettingsSync(freshToken, { force: true });
          trackedIds = await getTrackedCourseIdsFromDb();
          syncCourseIds = trackedIds.filter((id) => Number.isFinite(id) && id > 0 && id !== MOCK_COURSE_ID);
          settings = getLocalSettingsSnapshot();
        } catch (settingsErr) {
          console.warn('Non-fatal: Failed to re-sync settings after token renewal', settingsErr);
        }
        result = await executeRunSync(freshToken);
      } else {
        throw err;
      }
    } else {
      throw err;
    }
  }

  saveSyncResultToDatabase(result, {
    panoptoEnabled: settings.panoptoEnabled,
    activeCourseIds: trackedIds,
  });
  persistDiscoveredPanoptoFolders(result.discoveredPanoptoFolders);

  progressCalc.complete('Sync completed.');
  emitMonotonic({
    ...latestState,
    percent: 100,
    stage: 'complete',
    message: 'Sync completed.',
  });

  // Schedule notifications & push Google Tasks asynchronously so UI sync completes immediately
  void scheduleDeadlineNotifications(result.assignments).catch((err) => {
    console.warn('Non-fatal: Deadline notifications scheduling failed:', err);
  });

  if (settings.googleTasksEnabled) {
    void performGoogleTasksSync(result.assignments).catch((err) => {
      console.warn('Non-fatal: Google Tasks sync failed:', err);
    });
  }

  return result;
}

// Guard background TaskManager registration so Jest and Expo Web never crash on import
const { BackgroundFetch, TaskManager } = getBackgroundModules();

if (
  Platform.OS !== 'web' &&
  TaskManager &&
  typeof TaskManager.defineTask === 'function' &&
  (!TaskManager.isTaskDefined || !TaskManager.isTaskDefined(BACKGROUND_SYNC_TASK))
) {
  try {
    TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
      try {
        const token = await getMoodleToken();
        if (!token) {
          return BackgroundFetch?.BackgroundFetchResult?.NoData ?? 1;
        }

        const trackedIds = await getTrackedCourseIdsFromDb();
        if (trackedIds.length === 0) {
          return BackgroundFetch?.BackgroundFetchResult?.NoData ?? 1;
        }

        await triggerForegroundSync();
        return BackgroundFetch?.BackgroundFetchResult?.NewData ?? 2;
      } catch (error) {
        console.error('Mobile background sync error:', error);
        return BackgroundFetch?.BackgroundFetchResult?.Failed ?? 3;
      }
    });
  } catch (e) {
    console.warn('TaskManager.defineTask skipped:', e);
  }
}

export async function registerBackgroundSyncTask(): Promise<void> {
  if (Platform.OS === 'web' || !BackgroundFetch || !TaskManager) {
    return;
  }

  try {
    const settings = getLocalSettingsSnapshot();
    const configuredMinutes = Number(settings.syncIntervalMinutes) || 60;
    // Android WorkManager / iOS BGAppRefreshTask enforce a 15-minute minimum interval
    const clampedMinutes = Math.max(15, configuredMinutes);
    const targetIntervalSec = clampedMinutes * 60;

    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK);
    const prevIntervalSec = Number(getPreference(BG_SYNC_INTERVAL_PREF) || 0);
    if (isRegistered && prevIntervalSec === targetIntervalSec) {
      // Already registered with the same interval — avoid churning WorkManager/BGTaskScheduler on cold start
      return;
    }

    if (isRegistered) {
      await BackgroundFetch.unregisterTaskAsync(BACKGROUND_SYNC_TASK);
    }

    await BackgroundFetch.registerTaskAsync(BACKGROUND_SYNC_TASK, {
      minimumInterval: targetIntervalSec,
      stopOnTerminate: false,
      startOnBoot: true,
    });
    setPreference(BG_SYNC_INTERVAL_PREF, String(targetIntervalSec));
  } catch (e) {
    console.error('Failed to register background sync task:', e);
  }
}

export async function unregisterBackgroundSyncTask(): Promise<void> {
  if (Platform.OS === 'web' || !BackgroundFetch || !TaskManager) {
    return;
  }
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK);
    if (isRegistered) {
      await BackgroundFetch.unregisterTaskAsync(BACKGROUND_SYNC_TASK);
    }
    removePreference(BG_SYNC_INTERVAL_PREF);
  } catch (e) {
    console.warn('Failed to unregister background sync task:', e);
  }
}
