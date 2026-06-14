import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import * as SecureStore from 'expo-secure-store';
import { runSync } from '@tautracker/moodle-client';
import { getDb, saveSyncResultToDatabase } from './database';
import { scheduleDeadlineNotifications } from './notifications';
import { performGoogleTasksSync } from './googleTasks';

const BACKGROUND_SYNC_TASK = 'TAUTRACKER_BACKGROUND_SYNC';

export async function getMoodleToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync('moodle_wstoken');
  } catch (e) {
    console.error('getMoodleToken error:', e);
    return null;
  }
}

export async function setMoodleToken(token: string | null): Promise<void> {
  try {
    if (token === null) {
      await SecureStore.deleteItemAsync('moodle_wstoken');
    } else {
      await SecureStore.setItemAsync('moodle_wstoken', token);
    }
  } catch (e) {
    console.error('setMoodleToken error:', e);
  }
}

export async function getTrackedCourseIdsFromDb(): Promise<number[]> {
  try {
    const db = getDb();
    const rows = db.getAllSync<{ moodle_id: number }>('SELECT moodle_id FROM tracked_courses WHERE is_active = 1');
    return rows.map((r) => r.moodle_id);
  } catch (e) {
    console.error('getTrackedCourseIdsFromDb error:', e);
    return [];
  }
}

export async function triggerForegroundSync(): Promise<any> {
  const token = await getMoodleToken();
  if (!token) throw new Error('Moodle token not configured.');

  const trackedIds = await getTrackedCourseIdsFromDb();

  const result = await runSync(token, trackedIds, (msg) => {
    console.log(`[Mobile Foreground Sync] ${msg}`);
  });

  saveSyncResultToDatabase(result);
  await scheduleDeadlineNotifications(result.assignments);
  await performGoogleTasksSync(result.assignments);

  return result;
}

// Define the background task
TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
  try {
    const token = await getMoodleToken();
    if (!token) {
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    const trackedIds = await getTrackedCourseIdsFromDb();
    if (trackedIds.length === 0) {
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    const result = await runSync(token, trackedIds, (msg) => {
      console.log(`[Mobile Background Sync] ${msg}`);
    });

    saveSyncResultToDatabase(result);
    await scheduleDeadlineNotifications(result.assignments);
    await performGoogleTasksSync(result.assignments);

    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch (error) {
    console.error('Mobile background sync error:', error);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

// Register background task
export async function registerBackgroundSyncTask(): Promise<void> {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK);
    if (!isRegistered) {
      await BackgroundFetch.registerTaskAsync(BACKGROUND_SYNC_TASK, {
        minimumInterval: 60 * 60, // 1 hour
        stopOnTerminate: false,
        startOnBoot: true,
      });
      console.log('Mobile background sync task registered.');
    }
  } catch (e) {
    console.error('Failed to register background sync task:', e);
  }
}
