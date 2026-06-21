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
};

export async function getStoredToken(): Promise<string | null> {
  const res = (await chrome.storage.local.get('wstoken')) as { wstoken?: string };
  return res.wstoken || null;
}

export async function setStoredToken(token: string | null): Promise<void> {
  if (token === null) {
    await chrome.storage.local.remove('wstoken');
  } else {
    await chrome.storage.local.set({ wstoken: token });
  }
}

export async function getMoodleCredentials(): Promise<{ username?: string; idNumber?: string } | null> {
  const res = (await chrome.storage.local.get('moodleCredentials')) as {
    moodleCredentials?: { username?: string; idNumber?: string; password?: string };
  };
  
  if (res.moodleCredentials && res.moodleCredentials.password) {
    // Wipe password from storage if it exists from previous version
    const updated = { username: res.moodleCredentials.username, idNumber: res.moodleCredentials.idNumber };
    await chrome.storage.local.set({ moodleCredentials: updated });
    return updated;
  }
  
  return res.moodleCredentials || null;
}

export async function setMoodleCredentials(credentials: { username?: string; idNumber?: string } | null): Promise<void> {
  if (credentials === null) {
    await chrome.storage.local.remove('moodleCredentials');
  } else {
    await chrome.storage.local.set({ moodleCredentials: credentials });
  }
}

export async function getTrackedCourseIds(): Promise<number[]> {
  const res = (await chrome.storage.sync.get('trackedCourseIds')) as { trackedCourseIds?: number[] };
  return res.trackedCourseIds || [];
}

export async function setTrackedCourseIds(ids: number[]): Promise<void> {
  await chrome.storage.sync.set({ trackedCourseIds: ids });
}

export async function getCachedSyncResult(): Promise<SyncResult | null> {
  const res = (await chrome.storage.local.get('cachedSyncResult')) as { cachedSyncResult?: SyncResult };
  return res.cachedSyncResult || null;
}

export async function setCachedSyncResult(result: SyncResult): Promise<void> {
  await chrome.storage.local.set({ cachedSyncResult: result });
}

export async function getSettings(): Promise<ExtensionSettings> {
  const res = (await chrome.storage.sync.get('settings')) as { settings?: Partial<ExtensionSettings> };
  return { ...DEFAULT_SETTINGS, ...res.settings };
}

export async function setSettings(settings: Partial<ExtensionSettings>): Promise<void> {
  const current = await getSettings();
  await chrome.storage.sync.set({ settings: { ...current, ...settings } });
}
