import browser from 'webextension-polyfill';
import type { SyncResult, CourseSection, CourseFolder, CourseLink, CourseAnnouncement, CourseGradeSummary } from '@tautracker/moodle-client';

export interface ExtensionSettings {
  googleTasksEnabled: boolean;
  googleTasksListName: string;
  googleClientId?: string | null;
  notificationsEnabled: boolean;
  coursesColorMap: Record<number, string>;
  coursesCustomNames: Record<number, string>;
  language: 'he' | 'en';
  assignmentGreenDaysThreshold?: number;
  assignmentYellowDaysThreshold?: number;
  theme?: 'dark' | 'noodle' | 'coffee';
  interestedMeetings?: string[]; // Array of meeting numbers the user is interested in
  showAllMeetings?: boolean;     // Toggle to show all meetings vs only interested ones
  hiddenAssignments?: Array<number | string>;  // Array of assignment ids or uids that are hidden
  completedAssignments?: Array<number | string>; // Array of assignment ids or uids that are marked as completed
  uncompletedAssignments?: Array<number | string>; // Array of assignment ids or uids marked as To Do even if submitted
  scrapingEnabled?: boolean;
  syncWithoutDeadline?: boolean;
  panoptoEnabled?: boolean;
  coursesPanoptoMap?: Record<number, string>;
  watchedRecordings?: string[];
  syncIntervalMinutes?: number;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  googleTasksEnabled: false,
  googleTasksListName: 'Noodle',
  googleClientId: null,
  notificationsEnabled: true,
  coursesColorMap: {},
  coursesCustomNames: {},
  language: 'he',
  assignmentGreenDaysThreshold: 7,
  assignmentYellowDaysThreshold: 3,
  theme: 'noodle',
  interestedMeetings: [],
  showAllMeetings: false,
  hiddenAssignments: [],
  completedAssignments: [],
  uncompletedAssignments: [],
  scrapingEnabled: false,
  syncWithoutDeadline: false,
  panoptoEnabled: false,
  coursesPanoptoMap: {},
  watchedRecordings: [],
  syncIntervalMinutes: 5,
};

export async function getStoredToken(): Promise<string | null> {
  const res = (await browser.storage.local.get('wstoken')) as { wstoken?: string };
  return res.wstoken || null;
}

export async function setStoredToken(token: string | null): Promise<void> {
  if (token === null) {
    await browser.storage.local.remove('wstoken');
  } else {
    await browser.storage.local.set({ wstoken: token });
  }
}

export async function getStoredSesskey(): Promise<string | null> {
  const res = (await browser.storage.local.get('sesskey')) as { sesskey?: string };
  return res.sesskey || null;
}

export async function setStoredSesskey(sesskey: string | null): Promise<void> {
  if (sesskey === null) {
    await browser.storage.local.remove('sesskey');
  } else {
    await browser.storage.local.set({ sesskey });
  }
}

export async function getMoodleCredentials(): Promise<{ username?: string; idNumber?: string; password?: string } | null> {
  const res = (await browser.storage.local.get('moodleCredentials')) as {
    moodleCredentials?: { username?: string; idNumber?: string; password?: string };
  };
  
  return res.moodleCredentials || null;
}

export async function setMoodleCredentials(credentials: { username?: string; idNumber?: string; password?: string } | null): Promise<void> {
  if (credentials === null) {
    await browser.storage.local.remove('moodleCredentials');
  } else {
    await browser.storage.local.set({ moodleCredentials: credentials });
  }
}

export async function getTrackedCourseIds(): Promise<number[]> {
  const res = (await browser.storage.sync.get('trackedCourseIds')) as { trackedCourseIds?: number[] };
  return res.trackedCourseIds || [];
}

let settingsSyncTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSettingsSyncBroadcast() {
  if (settingsSyncTimer) {
    clearTimeout(settingsSyncTimer);
  }
  settingsSyncTimer = setTimeout(() => {
    settingsSyncTimer = null;
    browser.runtime.sendMessage({ type: 'SYNC_SETTINGS' }).catch(() => {});
  }, 600);
}

export async function setTrackedCourseIds(ids: number[], skipSync = false): Promise<void> {
  await browser.storage.sync.set({ trackedCourseIds: ids });
  if (!skipSync) {
    const timestamps = ((await browser.storage.sync.get('settings_timestamps')).settings_timestamps || {}) as Record<string, number>;
    timestamps['trackedCourseIds'] = Date.now();
    await browser.storage.sync.set({ settings_timestamps: timestamps });
    scheduleSettingsSyncBroadcast();
  }
}

export async function getCachedSyncResult(): Promise<SyncResult | null> {
  const res = (await browser.storage.local.get('cachedSyncResult')) as { cachedSyncResult?: SyncResult };
  return res.cachedSyncResult || null;
}

export async function setCachedSyncResult(result: SyncResult): Promise<void> {
  await browser.storage.local.set({ cachedSyncResult: result });
}

export async function getCachedSections(): Promise<CourseSection[]> {
  const result = await getCachedSyncResult();
  return result?.sections || [];
}

export async function getCachedFolders(): Promise<CourseFolder[]> {
  const result = await getCachedSyncResult();
  return result?.folders || [];
}

export async function getCachedLinks(): Promise<CourseLink[]> {
  const result = await getCachedSyncResult();
  return result?.links || [];
}

export async function getCachedAnnouncements(): Promise<CourseAnnouncement[]> {
  const result = await getCachedSyncResult();
  return result?.announcements || [];
}

export async function getCachedGradeSummaries(): Promise<Record<number, CourseGradeSummary>> {
  const result = await getCachedSyncResult();
  return result?.gradeSummaries || {};
}

export async function getSettings(): Promise<ExtensionSettings> {
  const [syncRes, localRes] = await Promise.all([
    browser.storage.sync.get('settings').catch(() => ({})) as Promise<{ settings?: Partial<ExtensionSettings> }>,
    browser.storage.local.get('settings_local').catch(() => ({})) as Promise<{ settings_local?: Partial<ExtensionSettings> }>,
  ]);
  return { ...DEFAULT_SETTINGS, ...localRes.settings_local, ...syncRes.settings };
}

export async function setSettings(settings: Partial<ExtensionSettings>, skipSync = false): Promise<void> {
  const current = await getSettings();
  const merged = { ...current, ...settings };
  await browser.storage.local.set({ settings_local: merged }).catch(() => {});
  try {
    await browser.storage.sync.set({ settings: merged });
  } catch (e) {
    // storage.sync has a small per-item quota (8 KB in Chromium). Growing lists such as
    // watchedRecordings / completedAssignments can exceed it. If the write fails, drop the
    // stale sync copy so it can't shadow the fresh local copy in getSettings(); cross-device
    // sync still happens through the Moodle NOODLE_SYNC_DATA store.
    console.warn('[storage] storage.sync settings write failed (quota?); using local copy only.', e);
    await browser.storage.sync.remove('settings').catch(() => {});
  }
  
  if (!skipSync) {
    // Only update timestamps for keys whose value actually changed
    const timestamps = ((await browser.storage.sync.get('settings_timestamps')).settings_timestamps || {}) as Record<string, number>;
    const now = Date.now();
    let changed = false;
    for (const [key, val] of Object.entries(settings)) {
      const prevVal = (current as unknown as Record<string, unknown>)[key];
      if (JSON.stringify(prevVal) !== JSON.stringify(val)) {
        timestamps[key] = now;
        changed = true;
      }
    }
    if (changed) {
      await browser.storage.sync.set({ settings_timestamps: timestamps });
      scheduleSettingsSyncBroadcast();
    }
  }
}

export function getGoogleOAuthRedirectUrl(): string {
  let redirectUrl = '';
  try {
    if (typeof browser.identity?.getRedirectURL === 'function') {
      redirectUrl = browser.identity.getRedirectURL();
    }
  } catch {
    // Ignore context without identity API
  }

  if (!redirectUrl) {
    redirectUrl = `https://${browser.runtime.id}.chromiumapp.org/`;
  }

  // Firefox Loopback RFC 8252 support for Google OAuth:
  // Google rejects *.extensions.allizom.org due to required domain verification.
  // Firefox 86+ intercepts http://127.0.0.1/mozoauth2/<subdomain> locally,
  // which Google Cloud Console allows without domain ownership proof.
  if (redirectUrl.includes('.extensions.allizom.org')) {
    const subdomain = redirectUrl.replace('https://', '').split('.')[0];
    redirectUrl = `http://127.0.0.1/mozoauth2/${subdomain}`;
  }

  return redirectUrl;
}

// --------------------------------------------------------------------------
// Machine-Local Filesystem Sync Storage (NEVER synced via storage.sync or Moodle)
// --------------------------------------------------------------------------

export interface LocalFsConfig {
  enabled: boolean;
  rootLabel: string | null;
  includeAssignments: boolean;
  includeSubmissions: boolean;
  autoResyncMissingFiles: boolean;
  useCourseNicknames: boolean;
  maxFileSizeMb: number;
  speedProfile: 'safe' | 'moderate';
}

export const DEFAULT_LOCAL_FS_CONFIG: LocalFsConfig = {
  enabled: false,
  rootLabel: null,
  includeAssignments: true,
  includeSubmissions: false,
  autoResyncMissingFiles: false,
  useCourseNicknames: true,
  maxFileSizeMb: 100,
  speedProfile: 'safe',
};

export interface LocalFsManifestRecord {
  moodleFileId: string;
  relativePath: string;
  lastModified: number;
  size?: number;
  canonicalUrlPath?: string;
  syncedAt?: number;
  downloadId?: number;
}

export interface LocalFsManifestStore {
  files: Record<string, LocalFsManifestRecord>;
  courseFolderNames: Record<number, string>;
}

export interface LocalFsQueueItem {
  moodleFileId: string;
  courseId: number;
  sourceCourseId: number;
  relativePath: string;
  fileName: string;
  fileUrl: string;
  canonicalUrlPath: string;
  fileSize: number;
  timeModified: number;
  reason: 'new' | 'updated' | 'missing';
  attempts: number;
  nextRetryAt?: number;
  lastError?: string;
}

export interface LocalFsLogEntry {
  moodleFileId: string;
  fileName: string;
  relativePath: string;
  status: 'failed' | 'skipped_too_large';
  message: string;
  timestamp: number;
}

export type LocalFsStateKind =
  | 'idle'
  | 'syncing'
  | 'paused'
  | 'cooldown'
  | 'needs_permission'
  | 'needs_auth'
  | 'error';

export interface LocalFsStatus {
  state: LocalFsStateKind;
  backendType: 'fsa' | 'downloads';
  isInitialBulkMode: boolean;
  totalQueued: number;
  completedInCycle: number;
  failedCount: number;
  skippedTooLargeCount: number;
  syncedCountTotal: number;
  currentFilePath?: string | null;
  pausedUntil?: number | null;
  lastSyncAt?: number | null;
  lastError?: string | null;
  logs: LocalFsLogEntry[];
}

export const DEFAULT_LOCAL_FS_STATUS: LocalFsStatus = {
  state: 'idle',
  backendType: 'fsa',
  isInitialBulkMode: false,
  totalQueued: 0,
  completedInCycle: 0,
  failedCount: 0,
  skippedTooLargeCount: 0,
  syncedCountTotal: 0,
  currentFilePath: null,
  pausedUntil: null,
  lastSyncAt: null,
  lastError: null,
  logs: [],
};

export async function getLocalFsConfig(): Promise<LocalFsConfig> {
  const res = (await browser.storage.local.get('localFsConfig').catch(() => ({}))) as {
    localFsConfig?: Partial<LocalFsConfig>;
  };
  return { ...DEFAULT_LOCAL_FS_CONFIG, ...res.localFsConfig };
}

export async function setLocalFsConfig(patch: Partial<LocalFsConfig>): Promise<LocalFsConfig> {
  const current = await getLocalFsConfig();
  const merged = { ...current, ...patch };
  await browser.storage.local.set({ localFsConfig: merged });
  return merged;
}

export async function getLocalFsManifest(): Promise<LocalFsManifestStore> {
  const res = (await browser.storage.local.get('localFsManifest').catch(() => ({}))) as {
    localFsManifest?: Partial<LocalFsManifestStore>;
  };
  return {
    files: res.localFsManifest?.files || {},
    courseFolderNames: res.localFsManifest?.courseFolderNames || {},
  };
}

export async function setLocalFsManifest(manifest: LocalFsManifestStore): Promise<void> {
  await browser.storage.local.set({ localFsManifest: manifest });
}

export async function getLocalFsQueue(): Promise<LocalFsQueueItem[]> {
  const res = (await browser.storage.local.get('localFsQueue').catch(() => ({}))) as {
    localFsQueue?: LocalFsQueueItem[];
  };
  return Array.isArray(res.localFsQueue) ? res.localFsQueue : [];
}

export async function setLocalFsQueue(queue: LocalFsQueueItem[]): Promise<void> {
  await browser.storage.local.set({ localFsQueue: queue });
}

export async function getLocalFsStatus(): Promise<LocalFsStatus> {
  const res = (await browser.storage.local.get('localFsStatus').catch(() => ({}))) as {
    localFsStatus?: Partial<LocalFsStatus>;
  };
  return {
    ...DEFAULT_LOCAL_FS_STATUS,
    ...res.localFsStatus,
    logs: Array.isArray(res.localFsStatus?.logs) ? res.localFsStatus!.logs : [],
  };
}

export async function setLocalFsStatus(patch: Partial<LocalFsStatus>): Promise<LocalFsStatus> {
  const current = await getLocalFsStatus();
  const merged: LocalFsStatus = {
    ...current,
    ...patch,
    logs: patch.logs !== undefined ? patch.logs : current.logs,
  };
  await browser.storage.local.set({ localFsStatus: merged });
  return merged;
}
