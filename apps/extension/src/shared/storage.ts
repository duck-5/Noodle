import browser from 'webextension-polyfill';
import type { SyncResult } from '@tautracker/moodle-client';

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
  theme?: 'dark' | 'noodle';
  interestedMeetings?: string[]; // Array of meeting numbers the user is interested in
  showAllMeetings?: boolean;     // Toggle to show all meetings vs only interested ones
  hiddenAssignments?: number[];  // Array of assignment ids that are hidden
  completedAssignments?: number[]; // Array of assignment ids that are marked as completed
  uncompletedAssignments?: number[]; // Array of assignment ids marked as To Do even if submitted
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

export async function getMoodleCredentials(): Promise<{ username?: string; idNumber?: string } | null> {
  const res = (await browser.storage.local.get('moodleCredentials')) as {
    moodleCredentials?: { username?: string; idNumber?: string; password?: string };
  };
  
  if (res.moodleCredentials && res.moodleCredentials.password) {
    // Wipe password from storage if it exists from previous version
    const updated = { username: res.moodleCredentials.username, idNumber: res.moodleCredentials.idNumber };
    await browser.storage.local.set({ moodleCredentials: updated });
    return updated;
  }
  
  return res.moodleCredentials || null;
}

export async function setMoodleCredentials(credentials: { username?: string; idNumber?: string } | null): Promise<void> {
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

export async function setTrackedCourseIds(ids: number[], skipSync = false): Promise<void> {
  await browser.storage.sync.set({ trackedCourseIds: ids });
  if (!skipSync) {
    const timestamps = ((await browser.storage.sync.get('settings_timestamps')).settings_timestamps || {}) as Record<string, number>;
    timestamps['trackedCourseIds'] = Date.now();
    await browser.storage.sync.set({ settings_timestamps: timestamps });
    browser.runtime.sendMessage({ type: 'SYNC_SETTINGS' }).catch(() => {});
  }
}

export async function getCachedSyncResult(): Promise<SyncResult | null> {
  const res = (await browser.storage.local.get('cachedSyncResult')) as { cachedSyncResult?: SyncResult };
  return res.cachedSyncResult || null;
}

export async function setCachedSyncResult(result: SyncResult): Promise<void> {
  await browser.storage.local.set({ cachedSyncResult: result });
}

export async function getSettings(): Promise<ExtensionSettings> {
  const res = (await browser.storage.sync.get('settings')) as { settings?: Partial<ExtensionSettings> };
  return { ...DEFAULT_SETTINGS, ...res.settings };
}

export async function setSettings(settings: Partial<ExtensionSettings>, skipSync = false): Promise<void> {
  const current = await getSettings();
  await browser.storage.sync.set({ settings: { ...current, ...settings } });
  
  if (!skipSync) {
    // Only update timestamps when the user explicitly changed a setting
    const timestamps = ((await browser.storage.sync.get('settings_timestamps')).settings_timestamps || {}) as Record<string, number>;
    const now = Date.now();
    for (const key of Object.keys(settings)) {
      timestamps[key] = now;
    }
    await browser.storage.sync.set({ settings_timestamps: timestamps });
    browser.runtime.sendMessage({ type: 'SYNC_SETTINGS' }).catch(() => {});
  }
}
