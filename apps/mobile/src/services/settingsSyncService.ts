import {
  MoodleClient,
  SettingsSyncManager,
  SharedSettings,
  TrackedValue,
  CoursePanoptoStaffEntry,
} from '@tautracker/moodle-client';
import { ThemeMode } from '@/constants/theme';
import { SupportedLanguage } from './i18n';
import {
  getAllPreferences,
  getPreference,
  runInTransaction,
  setPreference,
  getTrackedCourses,
  saveTrackedCourses,
} from './database';
import { getStoredToken, getStoredSesskey, saveToken } from './auth';

export type SemesterProgressMode = 'lectures' | 'recitations' | 'assignments' | 'total' | 'all';
export type CoursesViewMode = 'list' | 'cards';

export interface MobileAppSettings {
  theme: ThemeMode;
  themeTimeDayStart: number;
  themeTimeDayEnd: number;
  language: SupportedLanguage;
  dueDateGreenDays: number;
  dueDateYellowDays: number;
  syncIntervalMinutes: number;
  googleTasksEnabled: boolean;
  googleTasksListName: string;
  syncWithoutDeadline: boolean;
  notificationsEnabled: boolean;
  panoptoEnabled: boolean;
  showPanoptoFolderOverride: boolean;
  showEmptySections: boolean;
  semesterProgressMode: SemesterProgressMode;
  coursesViewMode: CoursesViewMode;
  trackedCourseIds: number[];
  coursesColorMap: Record<number, string>;
  coursesCustomNames: Record<number, string>;
  hiddenAssignments: (number | string)[];
  completedAssignments: (number | string)[];
  uncompletedAssignments: (number | string)[];
  hiddenZoomMeetings: string[];
  watchedRecordings: string[];
  hiddenRecordings: string[];
  trackedPanoptoHosts: Record<number, string[]>;
  coursesPanoptoStaff: Record<number, CoursePanoptoStaffEntry[]>;
  coursesPanoptoMap: Record<number, string>;
}

export const DEFAULT_MOBILE_SETTINGS: MobileAppSettings = {
  theme: 'noodle',
  themeTimeDayStart: 7,
  themeTimeDayEnd: 17,
  language: 'he',
  dueDateGreenDays: 7,
  dueDateYellowDays: 3,
  syncIntervalMinutes: 60,
  googleTasksEnabled: false,
  googleTasksListName: 'University',
  syncWithoutDeadline: false,
  notificationsEnabled: true,
  panoptoEnabled: false,
  showPanoptoFolderOverride: false,
  showEmptySections: false,
  semesterProgressMode: 'total',
  coursesViewMode: 'cards',
  trackedCourseIds: [],
  coursesColorMap: {},
  coursesCustomNames: {},
  hiddenAssignments: [],
  completedAssignments: [],
  uncompletedAssignments: [],
  hiddenZoomMeetings: [],
  watchedRecordings: [],
  hiddenRecordings: [],
  trackedPanoptoHosts: {},
  coursesPanoptoStaff: {},
  coursesPanoptoMap: {},
};

const VALID_THEMES: ReadonlySet<string> = new Set([
  'noodle',
  'coffee',
  'dark',
  'light',
  'time',
  'system',
]);

const VALID_SEMESTER_MODES: ReadonlySet<string> = new Set([
  'lectures',
  'recitations',
  'assignments',
  'total',
  'all',
]);

const SHARED_SETTINGS_KEYS: readonly (keyof MobileAppSettings)[] = [
  'theme',
  'themeTimeDayStart',
  'themeTimeDayEnd',
  'language',
  'dueDateGreenDays',
  'dueDateYellowDays',
  'syncIntervalMinutes',
  'googleTasksEnabled',
  'googleTasksListName',
  'syncWithoutDeadline',
  'notificationsEnabled',
  'panoptoEnabled',
  'showPanoptoFolderOverride',
  'showEmptySections',
  'semesterProgressMode',
  'coursesViewMode',
  'trackedCourseIds',
  'coursesColorMap',
  'coursesCustomNames',
  'hiddenAssignments',
  'completedAssignments',
  'uncompletedAssignments',
  'hiddenZoomMeetings',
  'watchedRecordings',
  'hiddenRecordings',
  'trackedPanoptoHosts',
  'coursesPanoptoStaff',
  'coursesPanoptoMap',
];

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

function parseNumberPref(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw === null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function parseBoolPref(raw: string | null, fallback: boolean): boolean {
  if (raw === null || raw === '') return fallback;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  return fallback;
}

function normalizeNumberStringMap(input: unknown): Record<number, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const result: Record<number, string> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const numKey = Number(k);
    if (Number.isFinite(numKey) && typeof v === 'string' && v.trim().length > 0) {
      result[numKey] = v;
    }
  }
  return result;
}

function normalizeNumberStringArrayMap(input: unknown): Record<number, string[]> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const result: Record<number, string[]> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const numKey = Number(k);
    if (Number.isFinite(numKey) && Array.isArray(v)) {
      result[numKey] = v.map((item) => String(item)).filter(Boolean);
    }
  }
  return result;
}

function normalizePanoptoStaffMap(input: unknown): Record<number, CoursePanoptoStaffEntry[]> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const result: Record<number, CoursePanoptoStaffEntry[]> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const numKey = Number(k);
    if (Number.isFinite(numKey) && Array.isArray(v)) {
      result[numKey] = v.filter(
        (entry): entry is CoursePanoptoStaffEntry =>
          Boolean(entry && typeof entry === 'object' && typeof (entry as CoursePanoptoStaffEntry).panoptoName === 'string')
      );
    }
  }
  return result;
}

function normalizeIdArray(input: unknown): (number | string)[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: (number | string)[] = [];
  for (const item of input) {
    if (typeof item === 'number' && Number.isFinite(item)) {
      const key = `n:${item}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(item);
      }
    } else if (typeof item === 'string' && item.trim().length > 0) {
      const trimmed = item.trim();
      const key = `s:${trimmed}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(trimmed);
      }
    }
  }
  return out;
}

function normalizeStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of input) {
    if (typeof item === 'string' && item.trim().length > 0) {
      const trimmed = item.trim();
      if (!seen.has(trimmed)) {
        seen.add(trimmed);
        out.push(trimmed);
      }
    }
  }
  return out;
}

function normalizeNumericIdArray(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const item of input) {
    const num = Number(item);
    if (Number.isFinite(num) && !seen.has(num)) {
      seen.add(num);
      out.push(num);
    }
  }
  return out;
}

function readTimestamps(): Record<string, number> {
  return safeJsonParse<Record<string, number>>(getPreference('settings_timestamps'), {});
}

function writeTimestamps(timestamps: Record<string, number>): void {
  setPreference('settings_timestamps', JSON.stringify(timestamps));
}

function syncTrackedCoursesTable(
  activeIds: number[],
  colorMap: Record<number, string>,
  namesMap: Record<number, string>
): void {
  try {
    const activeSet = new Set<number>(activeIds.map(Number).filter((id) => Number.isFinite(id) && id > 0));
    const existingRows = getTrackedCourses(false);
    const existingById = new Map(existingRows.map((r) => [r.moodle_id, r]));
    const allIds = new Set<number>([...existingById.keys(), ...activeSet]);

    const rowsToSave = Array.from(allIds).map((moodleId) => {
      const existing = existingById.get(moodleId);
      return {
        moodle_id: moodleId,
        course_id: existing?.course_id ?? null,
        name: namesMap[moodleId] || existing?.name || `Course ${moodleId}`,
        semester: existing?.semester ?? null,
        year: existing?.year ?? null,
        color: colorMap[moodleId] || existing?.color || '#6366f1',
        is_active: activeSet.has(moodleId) ? 1 : 0,
      };
    });

    saveTrackedCourses(rowsToSave, { merge: false });
  } catch {
    // Non-fatal when database is unavailable (e.g. unit test mocks)
  }
}

export function getLocalSettingsSnapshot(): MobileAppSettings {
  const allPrefs = typeof getAllPreferences === 'function' ? getAllPreferences() : null;
  const readPref = (key: string): string | null => {
    if (allPrefs !== null) {
      return Object.prototype.hasOwnProperty.call(allPrefs, key) ? allPrefs[key] : null;
    }
    return getPreference(key);
  };

  const rawTheme = readPref('theme');
  const theme: ThemeMode = rawTheme && VALID_THEMES.has(rawTheme) ? (rawTheme as ThemeMode) : DEFAULT_MOBILE_SETTINGS.theme;

  const rawLang = readPref('language');
  const language: SupportedLanguage = rawLang === 'en' || rawLang === 'he' ? rawLang : DEFAULT_MOBILE_SETTINGS.language;

  const rawSemesterMode = readPref('semester_progress_mode');
  const semesterProgressMode: SemesterProgressMode =
    rawSemesterMode && VALID_SEMESTER_MODES.has(rawSemesterMode)
      ? (rawSemesterMode as SemesterProgressMode)
      : DEFAULT_MOBILE_SETTINGS.semesterProgressMode;

  const rawCoursesViewMode = readPref('courses_view_mode');
  const coursesViewMode: CoursesViewMode =
    rawCoursesViewMode === 'list' || rawCoursesViewMode === 'cards'
      ? rawCoursesViewMode
      : DEFAULT_MOBILE_SETTINGS.coursesViewMode;

  // Read DB rows safely as migration baseline when JSON prefs haven't been created yet
  let dbRows: { moodle_id: number; name?: string | null; color?: string | null; is_active?: number | boolean }[] = [];
  try {
    const rows = getTrackedCourses(false);
    if (Array.isArray(rows)) {
      dbRows = rows;
    }
  } catch {
    dbRows = [];
  }

  const trackedIdsPref = readPref('tracked_course_ids');
  let trackedCourseIds: number[];
  if (trackedIdsPref !== null) {
    trackedCourseIds = normalizeNumericIdArray(safeJsonParse<unknown[]>(trackedIdsPref, []));
  } else {
    trackedCourseIds = dbRows
      .filter((r) => r.is_active === 1 || r.is_active === true)
      .map((r) => Number(r.moodle_id))
      .filter(Number.isFinite);
  }

  const colorMapPref = readPref('courses_color_map');
  let coursesColorMap: Record<number, string>;
  if (colorMapPref !== null) {
    coursesColorMap = normalizeNumberStringMap(safeJsonParse<Record<string, unknown>>(colorMapPref, {}));
  } else {
    coursesColorMap = {};
    for (const row of dbRows) {
      if (row.color) {
        coursesColorMap[Number(row.moodle_id)] = row.color;
      }
    }
  }

  const customNamesPref = readPref('courses_custom_names');
  let coursesCustomNames: Record<number, string>;
  if (customNamesPref !== null) {
    coursesCustomNames = normalizeNumberStringMap(safeJsonParse<Record<string, unknown>>(customNamesPref, {}));
  } else {
    coursesCustomNames = {};
    for (const row of dbRows) {
      if (row.name && row.name !== `Course ${row.moodle_id}`) {
        coursesCustomNames[Number(row.moodle_id)] = row.name;
      }
    }
  }

  return {
    theme,
    themeTimeDayStart: parseNumberPref(readPref('theme_time_day_start'), DEFAULT_MOBILE_SETTINGS.themeTimeDayStart, 0, 23),
    themeTimeDayEnd: parseNumberPref(readPref('theme_time_day_end'), DEFAULT_MOBILE_SETTINGS.themeTimeDayEnd, 0, 23),
    language,
    dueDateGreenDays: parseNumberPref(readPref('due_date_green_days'), DEFAULT_MOBILE_SETTINGS.dueDateGreenDays, 1, 90),
    dueDateYellowDays: parseNumberPref(readPref('due_date_yellow_days'), DEFAULT_MOBILE_SETTINGS.dueDateYellowDays, 1, 60),
    syncIntervalMinutes: parseNumberPref(readPref('sync_interval_minutes'), DEFAULT_MOBILE_SETTINGS.syncIntervalMinutes, 1, 1440),
    googleTasksEnabled: parseBoolPref(readPref('google_tasks_enabled'), DEFAULT_MOBILE_SETTINGS.googleTasksEnabled),
    googleTasksListName: readPref('google_tasks_list_name') || DEFAULT_MOBILE_SETTINGS.googleTasksListName,
    syncWithoutDeadline: parseBoolPref(readPref('sync_without_deadline'), DEFAULT_MOBILE_SETTINGS.syncWithoutDeadline),
    notificationsEnabled: parseBoolPref(readPref('notifications_enabled'), DEFAULT_MOBILE_SETTINGS.notificationsEnabled),
    panoptoEnabled: parseBoolPref(readPref('panopto_enabled'), DEFAULT_MOBILE_SETTINGS.panoptoEnabled),
    showPanoptoFolderOverride: parseBoolPref(
      readPref('show_panopto_folder_override'),
      DEFAULT_MOBILE_SETTINGS.showPanoptoFolderOverride
    ),
    showEmptySections: parseBoolPref(readPref('show_empty_sections'), DEFAULT_MOBILE_SETTINGS.showEmptySections),
    semesterProgressMode,
    coursesViewMode,
    trackedCourseIds,
    coursesColorMap,
    coursesCustomNames,
    hiddenAssignments: normalizeIdArray(safeJsonParse<unknown[]>(readPref('hidden_assignments'), [])),
    completedAssignments: normalizeIdArray(safeJsonParse<unknown[]>(readPref('completed_assignments'), [])),
    uncompletedAssignments: normalizeIdArray(safeJsonParse<unknown[]>(readPref('uncompleted_assignments'), [])),
    hiddenZoomMeetings: normalizeStringArray(safeJsonParse<unknown[]>(readPref('hidden_zoom_meetings'), [])),
    watchedRecordings: normalizeStringArray(safeJsonParse<unknown[]>(readPref('watched_recordings'), [])),
    hiddenRecordings: normalizeStringArray(safeJsonParse<unknown[]>(readPref('hidden_recordings'), [])),
    trackedPanoptoHosts: normalizeNumberStringArrayMap(safeJsonParse<Record<string, unknown>>(readPref('tracked_panopto_hosts'), {})),
    coursesPanoptoStaff: normalizePanoptoStaffMap(safeJsonParse<Record<string, unknown>>(readPref('courses_panopto_staff'), {})),
    coursesPanoptoMap: normalizeNumberStringMap(safeJsonParse<Record<string, unknown>>(readPref('courses_panopto_map'), {})),
  };
}

function writeSettingsToLocalStorage(
  patch: Partial<MobileAppSettings>,
  recordTimestamps: boolean
): string[] {
  const updatedKeys: string[] = [];
  const current = getLocalSettingsSnapshot();

  const runWrites = () => {

  if (patch.theme !== undefined && VALID_THEMES.has(patch.theme)) {
    setPreference('theme', patch.theme);
    updatedKeys.push('theme');
  }
  if (patch.themeTimeDayStart !== undefined && Number.isFinite(patch.themeTimeDayStart)) {
    const val = Math.max(0, Math.min(23, Math.round(patch.themeTimeDayStart)));
    setPreference('theme_time_day_start', String(val));
    updatedKeys.push('themeTimeDayStart');
  }
  if (patch.themeTimeDayEnd !== undefined && Number.isFinite(patch.themeTimeDayEnd)) {
    const val = Math.max(0, Math.min(23, Math.round(patch.themeTimeDayEnd)));
    setPreference('theme_time_day_end', String(val));
    updatedKeys.push('themeTimeDayEnd');
  }
  if (patch.language !== undefined && (patch.language === 'he' || patch.language === 'en')) {
    setPreference('language', patch.language);
    updatedKeys.push('language');
  }
  if (patch.dueDateGreenDays !== undefined && Number.isFinite(patch.dueDateGreenDays)) {
    const val = Math.max(1, Math.min(90, Math.round(patch.dueDateGreenDays)));
    setPreference('due_date_green_days', String(val));
    updatedKeys.push('dueDateGreenDays');
  }
  if (patch.dueDateYellowDays !== undefined && Number.isFinite(patch.dueDateYellowDays)) {
    const val = Math.max(1, Math.min(60, Math.round(patch.dueDateYellowDays)));
    setPreference('due_date_yellow_days', String(val));
    updatedKeys.push('dueDateYellowDays');
  }
  if (patch.syncIntervalMinutes !== undefined && Number.isFinite(patch.syncIntervalMinutes)) {
    const val = Math.max(1, Math.min(1440, Math.round(patch.syncIntervalMinutes)));
    setPreference('sync_interval_minutes', String(val));
    updatedKeys.push('syncIntervalMinutes');
  }
  if (patch.googleTasksEnabled !== undefined) {
    setPreference('google_tasks_enabled', patch.googleTasksEnabled ? 'true' : 'false');
    updatedKeys.push('googleTasksEnabled');
  }
  if (patch.googleTasksListName !== undefined) {
    setPreference('google_tasks_list_name', String(patch.googleTasksListName));
    updatedKeys.push('googleTasksListName');
  }
  if (patch.syncWithoutDeadline !== undefined) {
    setPreference('sync_without_deadline', patch.syncWithoutDeadline ? 'true' : 'false');
    updatedKeys.push('syncWithoutDeadline');
  }
  if (patch.notificationsEnabled !== undefined) {
    setPreference('notifications_enabled', patch.notificationsEnabled ? 'true' : 'false');
    updatedKeys.push('notificationsEnabled');
  }
  if (patch.panoptoEnabled !== undefined) {
    setPreference('panopto_enabled', patch.panoptoEnabled ? 'true' : 'false');
    updatedKeys.push('panoptoEnabled');
  }
  if (patch.showPanoptoFolderOverride !== undefined) {
    setPreference('show_panopto_folder_override', patch.showPanoptoFolderOverride ? 'true' : 'false');
    updatedKeys.push('showPanoptoFolderOverride');
  }
  if (patch.showEmptySections !== undefined) {
    setPreference('show_empty_sections', patch.showEmptySections ? 'true' : 'false');
    updatedKeys.push('showEmptySections');
  }
  if (patch.semesterProgressMode !== undefined && VALID_SEMESTER_MODES.has(patch.semesterProgressMode)) {
    setPreference('semester_progress_mode', patch.semesterProgressMode);
    updatedKeys.push('semesterProgressMode');
  }
  if (patch.coursesViewMode !== undefined && (patch.coursesViewMode === 'list' || patch.coursesViewMode === 'cards')) {
    setPreference('courses_view_mode', patch.coursesViewMode);
    updatedKeys.push('coursesViewMode');
  }

  let nextTrackedIds = current.trackedCourseIds;
  let nextColorMap = current.coursesColorMap;
  let nextNamesMap = current.coursesCustomNames;
  let shouldSyncTrackedTable = false;

  if (patch.trackedCourseIds !== undefined) {
    nextTrackedIds = normalizeNumericIdArray(patch.trackedCourseIds);
    setPreference('tracked_course_ids', JSON.stringify(nextTrackedIds));
    updatedKeys.push('trackedCourseIds');
    shouldSyncTrackedTable = true;
  }
  if (patch.coursesColorMap !== undefined) {
    nextColorMap = normalizeNumberStringMap(patch.coursesColorMap);
    setPreference('courses_color_map', JSON.stringify(nextColorMap));
    updatedKeys.push('coursesColorMap');
    shouldSyncTrackedTable = true;
  }
  if (patch.coursesCustomNames !== undefined) {
    nextNamesMap = normalizeNumberStringMap(patch.coursesCustomNames);
    setPreference('courses_custom_names', JSON.stringify(nextNamesMap));
    updatedKeys.push('coursesCustomNames');
    shouldSyncTrackedTable = true;
  }

  if (shouldSyncTrackedTable) {
    syncTrackedCoursesTable(nextTrackedIds, nextColorMap, nextNamesMap);
  }

  if (patch.hiddenAssignments !== undefined) {
    setPreference('hidden_assignments', JSON.stringify(normalizeIdArray(patch.hiddenAssignments)));
    updatedKeys.push('hiddenAssignments');
  }
  if (patch.completedAssignments !== undefined) {
    setPreference('completed_assignments', JSON.stringify(normalizeIdArray(patch.completedAssignments)));
    updatedKeys.push('completedAssignments');
  }
  if (patch.uncompletedAssignments !== undefined) {
    setPreference('uncompleted_assignments', JSON.stringify(normalizeIdArray(patch.uncompletedAssignments)));
    updatedKeys.push('uncompletedAssignments');
  }
  if (patch.hiddenZoomMeetings !== undefined) {
    setPreference('hidden_zoom_meetings', JSON.stringify(normalizeStringArray(patch.hiddenZoomMeetings)));
    updatedKeys.push('hiddenZoomMeetings');
  }
  if (patch.watchedRecordings !== undefined) {
    setPreference('watched_recordings', JSON.stringify(normalizeStringArray(patch.watchedRecordings)));
    updatedKeys.push('watchedRecordings');
  }
  if (patch.hiddenRecordings !== undefined) {
    setPreference('hidden_recordings', JSON.stringify(normalizeStringArray(patch.hiddenRecordings)));
    updatedKeys.push('hiddenRecordings');
  }
  if (patch.trackedPanoptoHosts !== undefined) {
    setPreference('tracked_panopto_hosts', JSON.stringify(normalizeNumberStringArrayMap(patch.trackedPanoptoHosts)));
    updatedKeys.push('trackedPanoptoHosts');
  }
  if (patch.coursesPanoptoStaff !== undefined) {
    setPreference('courses_panopto_staff', JSON.stringify(normalizePanoptoStaffMap(patch.coursesPanoptoStaff)));
    updatedKeys.push('coursesPanoptoStaff');
  }
  if (patch.coursesPanoptoMap !== undefined) {
    setPreference('courses_panopto_map', JSON.stringify(normalizeNumberStringMap(patch.coursesPanoptoMap)));
    updatedKeys.push('coursesPanoptoMap');
  }

  if (recordTimestamps && updatedKeys.length > 0) {
    const timestamps = readTimestamps();
    const now = Date.now();
    for (const key of updatedKeys) {
      timestamps[key] = now;
    }
    writeTimestamps(timestamps);
  }
  };

  if (typeof runInTransaction === 'function') {
    runInTransaction(runWrites);
  } else {
    runWrites();
  }

  return updatedKeys;
}

export function applyLocalSettingsPatch(
  patch: Partial<MobileAppSettings>,
  syncRemote = false
): void {
  const updatedKeys = writeSettingsToLocalStorage(patch, true);
  if (syncRemote && updatedKeys.length > 0) {
    performSettingsSync(undefined, { pushLocal: true }).catch((err) => {
      console.warn('[Mobile Sync] Background settings sync failed:', err);
    });
  }
}

function packLocalSharedSettings(timestamps: Record<string, number>): SharedSettings {
  const snapshot = getLocalSettingsSnapshot();
  const localShared: SharedSettings = {};

  for (const key of SHARED_SETTINGS_KEYS) {
    const value = snapshot[key];
    const ts = timestamps[key] || 0;
    const hasNonEmptyCollection = Array.isArray(value)
      ? value.length > 0
      : typeof value === 'object' && value !== null
        ? Object.keys(value).length > 0
        : true;

    if (ts > 0 || hasNonEmptyCollection) {
      (localShared as Record<string, TrackedValue<any>>)[key] = {
        value,
        updatedAt: ts,
        deviceId: 'mobile-app',
      };
    }
  }

  return localShared;
}

function unpackMergedSettings(merged: SharedSettings, newTimestamps: Record<string, number>): void {
  const patch: Partial<MobileAppSettings> = {};

  if (merged.theme?.value !== undefined) {
    patch.theme = merged.theme.value as ThemeMode;
  }
  if (merged.themeTimeDayStart?.value !== undefined) {
    patch.themeTimeDayStart = Number(merged.themeTimeDayStart.value);
  }
  if (merged.themeTimeDayEnd?.value !== undefined) {
    patch.themeTimeDayEnd = Number(merged.themeTimeDayEnd.value);
  }
  if (merged.language?.value !== undefined) {
    patch.language = merged.language.value as SupportedLanguage;
  }

  // Support both mobile dueDate* keys and extension assignment*DaysThreshold keys by newest updatedAt
  const pickNewest = <T,>(a?: TrackedValue<T>, b?: TrackedValue<T>): TrackedValue<T> | undefined => {
    if (a?.value !== undefined && b?.value !== undefined) {
      return (a.updatedAt || 0) >= (b.updatedAt || 0) ? a : b;
    }
    return a?.value !== undefined ? a : b;
  };

  const greenCandidate = pickNewest(merged.dueDateGreenDays, merged.assignmentGreenDaysThreshold);
  if (greenCandidate?.value !== undefined) {
    patch.dueDateGreenDays = Number(greenCandidate.value);
  }
  const yellowCandidate = pickNewest(merged.dueDateYellowDays, merged.assignmentYellowDaysThreshold);
  if (yellowCandidate?.value !== undefined) {
    patch.dueDateYellowDays = Number(yellowCandidate.value);
  }

  if (merged.syncIntervalMinutes?.value !== undefined) {
    patch.syncIntervalMinutes = Number(merged.syncIntervalMinutes.value);
  }
  // Intentionally skip googleTasksEnabled on remote pull (device-local OAuth token, matches extension)
  if (merged.googleTasksListName?.value !== undefined) {
    patch.googleTasksListName = String(merged.googleTasksListName.value);
  }
  if (merged.syncWithoutDeadline?.value !== undefined) {
    patch.syncWithoutDeadline = Boolean(merged.syncWithoutDeadline.value);
  }
  if (merged.notificationsEnabled?.value !== undefined) {
    patch.notificationsEnabled = Boolean(merged.notificationsEnabled.value);
  }
  if (merged.panoptoEnabled?.value !== undefined) {
    patch.panoptoEnabled = Boolean(merged.panoptoEnabled.value);
  }
  if (merged.showPanoptoFolderOverride?.value !== undefined) {
    patch.showPanoptoFolderOverride = Boolean(merged.showPanoptoFolderOverride.value);
  }
  if (merged.showEmptySections?.value !== undefined) {
    patch.showEmptySections = Boolean(merged.showEmptySections.value);
  }
  if (merged.semesterProgressMode?.value !== undefined) {
    patch.semesterProgressMode = merged.semesterProgressMode.value as SemesterProgressMode;
  }
  if (merged.coursesViewMode?.value !== undefined) {
    patch.coursesViewMode = merged.coursesViewMode.value as CoursesViewMode;
  }
  if (merged.trackedCourseIds?.value !== undefined) {
    patch.trackedCourseIds = normalizeNumericIdArray(merged.trackedCourseIds.value);
  }
  if (merged.coursesColorMap?.value !== undefined) {
    patch.coursesColorMap = normalizeNumberStringMap(merged.coursesColorMap.value);
  }
  if (merged.coursesCustomNames?.value !== undefined) {
    patch.coursesCustomNames = normalizeNumberStringMap(merged.coursesCustomNames.value);
  }
  if (merged.hiddenAssignments?.value !== undefined) {
    patch.hiddenAssignments = normalizeIdArray(merged.hiddenAssignments.value);
  }
  if (merged.completedAssignments?.value !== undefined) {
    patch.completedAssignments = normalizeIdArray(merged.completedAssignments.value);
  }
  if (merged.uncompletedAssignments?.value !== undefined) {
    patch.uncompletedAssignments = normalizeIdArray(merged.uncompletedAssignments.value);
  }
  if (merged.hiddenZoomMeetings?.value !== undefined) {
    patch.hiddenZoomMeetings = normalizeStringArray(merged.hiddenZoomMeetings.value);
  }
  if (merged.watchedRecordings?.value !== undefined) {
    patch.watchedRecordings = normalizeStringArray(merged.watchedRecordings.value);
  }
  if (merged.hiddenRecordings?.value !== undefined) {
    patch.hiddenRecordings = normalizeStringArray(merged.hiddenRecordings.value);
  }
  if (merged.trackedPanoptoHosts?.value !== undefined) {
    patch.trackedPanoptoHosts = normalizeNumberStringArrayMap(merged.trackedPanoptoHosts.value);
  }
  if (merged.coursesPanoptoStaff?.value !== undefined) {
    patch.coursesPanoptoStaff = normalizePanoptoStaffMap(merged.coursesPanoptoStaff.value);
  }
  if (merged.coursesPanoptoMap?.value !== undefined) {
    patch.coursesPanoptoMap = normalizeNumberStringMap(merged.coursesPanoptoMap.value);
  }

  writeSettingsToLocalStorage(patch, false);
  writeTimestamps(newTimestamps);
}

const SETTINGS_SYNC_TTL_MS = 30_000;
const SETTINGS_SYNC_DEBOUNCE_MS = 500;
const isJestEnv =
  typeof process !== 'undefined' && Boolean(process.env?.JEST_WORKER_ID);

let lastSettingsSyncTimestamp = 0;
let lastHasRemoteTrackedResult = false;
let inFlightSettingsSync: Promise<boolean> | null = null;
let pendingDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingDebouncePromise: Promise<boolean> | null = null;
let pendingDebounceResolvers: ((val: boolean) => void)[] = [];

export function resetSettingsSyncThrottle(): void {
  lastSettingsSyncTimestamp = 0;
  lastHasRemoteTrackedResult = false;
  inFlightSettingsSync = null;
  if (pendingDebounceTimer !== null) {
    clearTimeout(pendingDebounceTimer);
    pendingDebounceTimer = null;
  }
  const resolvers = pendingDebounceResolvers;
  pendingDebounceResolvers = [];
  pendingDebouncePromise = null;
  for (const resolve of resolvers) {
    resolve(false);
  }
}

async function executeSettingsSyncNow(providedToken?: string): Promise<boolean> {
  if (inFlightSettingsSync) {
    return inFlightSettingsSync;
  }

  const run = (async () => {
    try {
      const token = providedToken || (await getStoredToken());
      if (!token) return false;

      const sesskey = await getStoredSesskey();
      const client = new MoodleClient(token, undefined, {
        sesskey: sesskey || undefined,
        devMode: false,
        enableScraping: false,
      });
      const syncManager = new SettingsSyncManager(client, 'mobile-app');

      const timestamps = readTimestamps();
      const localShared = packLocalSharedSettings(timestamps);

      const merged = await syncManager.sync(localShared);

      const newTimestamps: Record<string, number> = { ...timestamps };
      let hasRemoteTrackedCourses = false;

      for (const [key, tracked] of Object.entries(merged)) {
        if (tracked) {
          newTimestamps[key] = tracked.updatedAt;
          if (
            key === 'trackedCourseIds' &&
            Array.isArray(tracked.value) &&
            tracked.value.length > 0
          ) {
            hasRemoteTrackedCourses = true;
          }
        }
      }

      unpackMergedSettings(merged, newTimestamps);
      lastSettingsSyncTimestamp = Date.now();
      lastHasRemoteTrackedResult = hasRemoteTrackedCourses;
      return hasRemoteTrackedCourses;
    } catch (e) {
      console.error('[Mobile Sync] Failed to sync settings:', e);
      return false;
    } finally {
      inFlightSettingsSync = null;
    }
  })();

  inFlightSettingsSync = run;
  return run;
}

export async function performSettingsSync(
  providedToken?: string,
  options?: { force?: boolean; pushLocal?: boolean }
): Promise<boolean> {
  const force = Boolean(options?.force);
  const pushLocal = Boolean(options?.pushLocal);

  if (inFlightSettingsSync) {
    return inFlightSettingsSync;
  }

  if (!force && !pushLocal && lastSettingsSyncTimestamp > 0 && Date.now() - lastSettingsSyncTimestamp < SETTINGS_SYNC_TTL_MS) {
    return lastHasRemoteTrackedResult;
  }

  if (force || isJestEnv) {
    if (pendingDebounceTimer !== null) {
      clearTimeout(pendingDebounceTimer);
      pendingDebounceTimer = null;
    }
    const result = await executeSettingsSyncNow(providedToken);
    const resolvers = pendingDebounceResolvers;
    pendingDebounceResolvers = [];
    pendingDebouncePromise = null;
    for (const resolve of resolvers) {
      resolve(result);
    }
    return result;
  }

  // 500ms debounce for non-forced background settings syncs
  if (!pendingDebouncePromise) {
    pendingDebouncePromise = new Promise<boolean>((resolve) => {
      pendingDebounceResolvers.push(resolve);
    });
  } else {
    return new Promise<boolean>((resolve) => {
      pendingDebounceResolvers.push(resolve);
    });
  }

  if (pendingDebounceTimer !== null) {
    clearTimeout(pendingDebounceTimer);
  }

  pendingDebounceTimer = setTimeout(() => {
    pendingDebounceTimer = null;
    const resolvers = pendingDebounceResolvers;
    pendingDebounceResolvers = [];
    pendingDebouncePromise = null;
    executeSettingsSyncNow(providedToken)
      .then((res) => {
        for (const r of resolvers) r(res);
      })
      .catch(() => {
        for (const r of resolvers) r(false);
      });
  }, SETTINGS_SYNC_DEBOUNCE_MS);

  return pendingDebouncePromise;
}

export function markSettingUpdatedAndSync(keys: string[]): void {
  const timestamps = readTimestamps();
  const now = Date.now();
  for (const key of keys) {
    timestamps[key] = now;
  }
  writeTimestamps(timestamps);

  performSettingsSync(undefined, { pushLocal: true }).catch((err) => {
    console.warn('[Mobile Sync] Non-fatal settings sync error:', err);
  });
}

export async function exportConfigBackupJson(): Promise<string> {
  const snapshot = getLocalSettingsSnapshot();
  const config = {
    version: 'TauTrackerConfig-v1',
    exportedAt: new Date().toISOString(),
    trackedCourseIds: snapshot.trackedCourseIds,
    settings: {
      ...snapshot,
      assignmentGreenDaysThreshold: snapshot.dueDateGreenDays,
      assignmentYellowDaysThreshold: snapshot.dueDateYellowDays,
    },
    hiddenZoomMeetings: snapshot.hiddenZoomMeetings,
    courseColors: snapshot.coursesColorMap,
    courseNicknames: snapshot.coursesCustomNames,
  };
  return JSON.stringify(config, null, 2);
}

export async function importConfigBackupJson(
  jsonString: string,
  availableCourses?: { id: number; moodle_id?: number; name?: string }[]
): Promise<{ matchedCourseIds: number[]; importedCount: number }> {
  let data: any;
  try {
    data = JSON.parse(jsonString);
  } catch (err: any) {
    throw new Error(`Invalid JSON configuration file: ${err?.message || String(err)}`);
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Invalid configuration file: root must be a JSON object.');
  }

  if (data.version && data.version !== 'TauTrackerConfig-v1') {
    throw new Error(`Unsupported configuration version: ${String(data.version)}`);
  }

  const settingsObj: Record<string, any> =
    data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings)
      ? data.settings
      : {};

  const hasTrackedField = Array.isArray(data.trackedCourseIds) || Array.isArray(settingsObj.trackedCourseIds);
  const hasSettingsField = Boolean(data.settings && typeof data.settings === 'object');
  if (!hasTrackedField && !hasSettingsField) {
    const foundKeys = Object.keys(data).join(', ');
    throw new Error(`Invalid configuration file. Must contain settings or trackedCourseIds (found: ${foundKeys || 'none'}).`);
  }

  const rawTrackedIds = normalizeNumericIdArray(
    Array.isArray(data.trackedCourseIds) ? data.trackedCourseIds : settingsObj.trackedCourseIds
  );

  let matchedCourseIds: number[];
  if (availableCourses !== undefined) {
    const importedSet = new Set<number>(rawTrackedIds);
    const matchedSet = new Set<number>();
    for (const c of availableCourses) {
      const idVal = Number(c.id);
      const moodleIdVal = c.moodle_id !== undefined ? Number(c.moodle_id) : undefined;
      if (
        (Number.isFinite(idVal) && importedSet.has(idVal)) ||
        (moodleIdVal !== undefined && Number.isFinite(moodleIdVal) && importedSet.has(moodleIdVal))
      ) {
        const canonicalId = moodleIdVal !== undefined && Number.isFinite(moodleIdVal) ? moodleIdVal : idVal;
        matchedSet.add(canonicalId);
      }
    }
    matchedCourseIds = Array.from(matchedSet);
  } else {
    matchedCourseIds = rawTrackedIds;
  }

  const current = getLocalSettingsSnapshot();

  // Merge both top-level legacy keys and data.settings.* v4.1 maps
  const mergedColors: Record<number, string> = {
    ...current.coursesColorMap,
    ...normalizeNumberStringMap(data.courseColors),
    ...normalizeNumberStringMap(settingsObj.coursesColorMap),
  };

  const mergedNicknames: Record<number, string> = {
    ...current.coursesCustomNames,
    ...normalizeNumberStringMap(data.courseNicknames),
    ...normalizeNumberStringMap(settingsObj.coursesCustomNames),
  };

  const patch: Partial<MobileAppSettings> = {
    trackedCourseIds: matchedCourseIds,
    coursesColorMap: mergedColors,
    coursesCustomNames: mergedNicknames,
  };

  let importedCount = matchedCourseIds.length;

  if (typeof settingsObj.theme === 'string' && VALID_THEMES.has(settingsObj.theme)) {
    patch.theme = settingsObj.theme as ThemeMode;
    importedCount++;
  }
  if (settingsObj.themeTimeDayStart !== undefined && Number.isFinite(Number(settingsObj.themeTimeDayStart))) {
    patch.themeTimeDayStart = Number(settingsObj.themeTimeDayStart);
    importedCount++;
  }
  if (settingsObj.themeTimeDayEnd !== undefined && Number.isFinite(Number(settingsObj.themeTimeDayEnd))) {
    patch.themeTimeDayEnd = Number(settingsObj.themeTimeDayEnd);
    importedCount++;
  }
  if (settingsObj.language === 'he' || settingsObj.language === 'en') {
    patch.language = settingsObj.language;
    importedCount++;
  }

  const greenDays = settingsObj.dueDateGreenDays ?? settingsObj.assignmentGreenDaysThreshold;
  if (greenDays !== undefined && Number.isFinite(Number(greenDays))) {
    patch.dueDateGreenDays = Number(greenDays);
    importedCount++;
  }
  const yellowDays = settingsObj.dueDateYellowDays ?? settingsObj.assignmentYellowDaysThreshold;
  if (yellowDays !== undefined && Number.isFinite(Number(yellowDays))) {
    patch.dueDateYellowDays = Number(yellowDays);
    importedCount++;
  }
  if (settingsObj.syncIntervalMinutes !== undefined && Number.isFinite(Number(settingsObj.syncIntervalMinutes))) {
    patch.syncIntervalMinutes = Number(settingsObj.syncIntervalMinutes);
    importedCount++;
  }
  if (typeof settingsObj.googleTasksEnabled === 'boolean') {
    patch.googleTasksEnabled = settingsObj.googleTasksEnabled;
    importedCount++;
  }
  if (typeof settingsObj.googleTasksListName === 'string') {
    patch.googleTasksListName = settingsObj.googleTasksListName;
    importedCount++;
  }
  if (typeof settingsObj.syncWithoutDeadline === 'boolean') {
    patch.syncWithoutDeadline = settingsObj.syncWithoutDeadline;
    importedCount++;
  }
  if (typeof settingsObj.notificationsEnabled === 'boolean') {
    patch.notificationsEnabled = settingsObj.notificationsEnabled;
    importedCount++;
  }
  if (typeof settingsObj.panoptoEnabled === 'boolean') {
    patch.panoptoEnabled = settingsObj.panoptoEnabled;
    importedCount++;
  }
  if (typeof settingsObj.showPanoptoFolderOverride === 'boolean') {
    patch.showPanoptoFolderOverride = settingsObj.showPanoptoFolderOverride;
    importedCount++;
  }
  if (typeof settingsObj.showEmptySections === 'boolean') {
    patch.showEmptySections = settingsObj.showEmptySections;
    importedCount++;
  }
  if (typeof settingsObj.semesterProgressMode === 'string' && VALID_SEMESTER_MODES.has(settingsObj.semesterProgressMode)) {
    patch.semesterProgressMode = settingsObj.semesterProgressMode as SemesterProgressMode;
    importedCount++;
  }
  if (settingsObj.coursesViewMode === 'list' || settingsObj.coursesViewMode === 'cards') {
    patch.coursesViewMode = settingsObj.coursesViewMode;
    importedCount++;
  }
  if (Array.isArray(settingsObj.hiddenAssignments)) {
    patch.hiddenAssignments = normalizeIdArray(settingsObj.hiddenAssignments);
    importedCount++;
  }
  if (Array.isArray(settingsObj.completedAssignments)) {
    patch.completedAssignments = normalizeIdArray(settingsObj.completedAssignments);
    importedCount++;
  }
  if (Array.isArray(settingsObj.uncompletedAssignments)) {
    patch.uncompletedAssignments = normalizeIdArray(settingsObj.uncompletedAssignments);
    importedCount++;
  }

  const combinedHiddenZoom = [
    ...(Array.isArray(settingsObj.hiddenZoomMeetings) ? settingsObj.hiddenZoomMeetings : []),
    ...(Array.isArray(data.hiddenZoomMeetings) ? data.hiddenZoomMeetings : []),
  ];
  if (Array.isArray(settingsObj.hiddenZoomMeetings) || Array.isArray(data.hiddenZoomMeetings)) {
    patch.hiddenZoomMeetings = normalizeStringArray(combinedHiddenZoom);
    importedCount++;
  }

  if (Array.isArray(settingsObj.watchedRecordings)) {
    patch.watchedRecordings = normalizeStringArray(settingsObj.watchedRecordings);
    importedCount++;
  }
  if (Array.isArray(settingsObj.hiddenRecordings)) {
    patch.hiddenRecordings = normalizeStringArray(settingsObj.hiddenRecordings);
    importedCount++;
  }
  if (settingsObj.trackedPanoptoHosts && typeof settingsObj.trackedPanoptoHosts === 'object') {
    patch.trackedPanoptoHosts = normalizeNumberStringArrayMap(settingsObj.trackedPanoptoHosts);
    importedCount++;
  }
  if (settingsObj.coursesPanoptoStaff && typeof settingsObj.coursesPanoptoStaff === 'object') {
    patch.coursesPanoptoStaff = normalizePanoptoStaffMap(settingsObj.coursesPanoptoStaff);
    importedCount++;
  }
  if (settingsObj.coursesPanoptoMap && typeof settingsObj.coursesPanoptoMap === 'object') {
    patch.coursesPanoptoMap = normalizeNumberStringMap(settingsObj.coursesPanoptoMap);
    importedCount++;
  }

  applyLocalSettingsPatch(patch, false);

  // Apply wstoken cleanly if included in backup and user doesn't have one yet (or explicit token import)
  const importedToken = typeof data.wstoken === 'string' ? data.wstoken.trim() : '';
  if (importedToken) {
    try {
      const existingToken = await getStoredToken();
      if (!existingToken) {
        await saveToken(importedToken);
      }
      importedCount++;
    } catch (e) {
      console.warn('[importConfigBackupJson] Could not apply imported token:', e);
    }
  }

  // Apply custom Google OAuth settings if present
  if (typeof settingsObj.googleClientId === 'string' && settingsObj.googleClientId.trim()) {
    setPreference('google_tasks_client_id', settingsObj.googleClientId.trim());
    importedCount++;
  }

  return {
    matchedCourseIds,
    importedCount,
  };
}
