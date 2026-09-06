import { MoodleClient, SettingsSyncManager } from '@tautracker/moodle-client';
import { getDb, getPreference, setPreference } from './database';
import { getMoodleToken } from './backgroundSync';

/**
 * Reads local mobile settings and maps them into the cross-platform extension format.
 */
function packLocalSharedSettings(timestamps: Record<string, number>): Record<string, any> {
  const localShared: Record<string, any> = {};
  
  // 1. Preferences
  const theme = getPreference('theme');
  const tsTheme = timestamps['theme'] || 0;
  if (tsTheme > 0 || (theme && theme !== 'system')) {
    localShared['theme'] = { value: theme || 'system', updatedAt: tsTheme, deviceId: 'mobile-app' };
  }
  
  const language = getPreference('language');
  const tsLang = timestamps['language'] || 0;
  if (tsLang > 0 || language) {
    localShared['language'] = { value: language || 'en', updatedAt: tsLang, deviceId: 'mobile-app' };
  }
  
  const googleTasksEnabled = getPreference('google_tasks_enabled') === 'true';
  const tsGoogle = timestamps['googleTasksEnabled'] || 0;
  if (tsGoogle > 0 || googleTasksEnabled) {
    localShared['googleTasksEnabled'] = { value: googleTasksEnabled, updatedAt: tsGoogle, deviceId: 'mobile-app' };
  }
  
  const googleTasksListName = getPreference('google_tasks_list_name') || 'University';
  const tsGoogleList = timestamps['googleTasksListName'] || 0;
  if (tsGoogleList > 0 || googleTasksListName !== 'University') {
    localShared['googleTasksListName'] = { value: googleTasksListName, updatedAt: tsGoogleList, deviceId: 'mobile-app' };
  }

  // 2. Tracked Courses (SQLite)
  const db = getDb();
  const trackedRows = db.getAllSync<{ moodle_id: number; name: string; color: string }>('SELECT moodle_id, name, color FROM tracked_courses WHERE is_active = 1');
  
  const trackedCourseIds = trackedRows.map(r => r.moodle_id);
  const coursesColorMap: Record<number, string> = {};
  const coursesCustomNames: Record<number, string> = {};
  
  trackedRows.forEach(row => {
    if (row.color) coursesColorMap[row.moodle_id] = row.color;
    if (row.name) coursesCustomNames[row.moodle_id] = row.name;
  });

  const tsTracked = timestamps['trackedCourseIds'] || 0;
  if (tsTracked > 0 || trackedCourseIds.length > 0) {
    localShared['trackedCourseIds'] = { value: trackedCourseIds, updatedAt: tsTracked, deviceId: 'mobile-app' };
  }
  
  const tsColor = timestamps['coursesColorMap'] || 0;
  if (tsColor > 0 || Object.keys(coursesColorMap).length > 0) {
    localShared['coursesColorMap'] = { value: coursesColorMap, updatedAt: tsColor, deviceId: 'mobile-app' };
  }
  
  const tsName = timestamps['coursesCustomNames'] || 0;
  if (tsName > 0 || Object.keys(coursesCustomNames).length > 0) {
    localShared['coursesCustomNames'] = { value: coursesCustomNames, updatedAt: tsName, deviceId: 'mobile-app' };
  }

  return localShared;
}

/**
 * Takes merged settings from Moodle and applies them to the local SQLite/Preferences.
 */
function unpackMergedSettings(merged: Record<string, any>, newTimestamps: Record<string, number>) {
  const db = getDb();
  
  db.withTransactionSync(() => {
    if (merged['theme']) {
      setPreference('theme', merged['theme'].value);
    }
    if (merged['language']) {
      setPreference('language', merged['language'].value);
    }
    if (merged['googleTasksEnabled']) {
      setPreference('google_tasks_enabled', merged['googleTasksEnabled'].value ? 'true' : 'false');
    }
    if (merged['googleTasksListName']) {
      setPreference('google_tasks_list_name', merged['googleTasksListName'].value);
    }

    if (merged['trackedCourseIds']) {
      const activeIdsArray = Array.isArray(merged['trackedCourseIds'].value) ? merged['trackedCourseIds'].value : [];
      const activeIds = new Set<number>(activeIdsArray.map(Number));
      const colorMap = merged['coursesColorMap']?.value || {};
      const namesMap = merged['coursesCustomNames']?.value || {};

      db.runSync('UPDATE tracked_courses SET is_active = 0');
      
      for (const moodleId of activeIds) {
        const color = colorMap[moodleId] || '#6366f1';
        const name = namesMap[moodleId] || `Course ${moodleId}`;
        
        const existing = db.getFirstSync<{ moodle_id: number }>('SELECT moodle_id FROM tracked_courses WHERE moodle_id = ?', [moodleId]);
        if (existing) {
          db.runSync('UPDATE tracked_courses SET is_active = 1, color = ?, name = ? WHERE moodle_id = ?', [color, name, moodleId]);
        } else {
          db.runSync('INSERT INTO tracked_courses (moodle_id, name, color, is_active) VALUES (?, ?, ?, 1)', [moodleId, name, color]);
        }
      }
    }
  });

  // Save new timestamps
  setPreference('settings_timestamps', JSON.stringify(newTimestamps));
}

export async function performSettingsSync(providedToken?: string): Promise<boolean> {
  try {
    const token = providedToken || await getMoodleToken();
    if (!token) return false;

    const client = new MoodleClient(token);
    const syncManager = new SettingsSyncManager(client, 'mobile-app');

    // Load local timestamps
    const timestampsRaw = getPreference('settings_timestamps');
    let timestamps: Record<string, number> = {};
    if (timestampsRaw) {
      try { timestamps = JSON.parse(timestampsRaw); } catch (e) {}
    }

    const localShared = packLocalSharedSettings(timestamps);
    
    // Sync with Moodle
    const merged = await syncManager.sync(localShared);

    // Extract new timestamps
    const newTimestamps: Record<string, number> = { ...timestamps };
    let hasRemoteTrackedCourses = false;
    
    for (const [key, tracked] of Object.entries(merged)) {
      if (tracked) {
        newTimestamps[key] = tracked.updatedAt;
        if (key === 'trackedCourseIds') {
           hasRemoteTrackedCourses = true;
        }
      }
    }

    // Apply merged state
    unpackMergedSettings(merged, newTimestamps);
    console.log('[Mobile Sync] Settings successfully synchronized with Moodle.');
    
    return hasRemoteTrackedCourses;
  } catch (e) {
    console.error('[Mobile Sync] Failed to sync settings:', e);
    return false;
  }
}

/**
 * Function to call when a setting is updated locally to mark its timestamp and trigger a sync.
 */
export function markSettingUpdatedAndSync(keys: string[]) {
  const timestampsRaw = getPreference('settings_timestamps');
  let timestamps: Record<string, number> = {};
  if (timestampsRaw) {
    try { timestamps = JSON.parse(timestampsRaw); } catch (e) {}
  }
  
  const now = Date.now();
  for (const key of keys) {
    timestamps[key] = now;
  }
  setPreference('settings_timestamps', JSON.stringify(timestamps));

  // Trigger non-blocking sync
  performSettingsSync().catch(console.error);
}
