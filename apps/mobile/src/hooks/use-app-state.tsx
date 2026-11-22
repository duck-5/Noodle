import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import {
  Assignment,
  CoursePanoptoStaffEntry,
  GroupedCoursesResult,
  MoodleClient,
  MoodleCourse,
  PanoptoRecordingType,
  SyncProgressState,
  SyncResult,
  expandTrackedCourseIds,
  getActivityUid,
  getZoomMeetingKey,
  groupEnrolledCourses,
  isActivityCompleted,
  isActivityHidden,
  isMoodleActivitySubmitted,
  matchesActivityIdentifier,
  parseTauCourseMetadata,
  reclassifyPanoptoRecordings,
  toggleTrackedHostEntry,
} from '@tautracker/moodle-client';
import { COURSE_COLOR_PALETTE } from '@/constants/theme';
import { usePreferences } from '@/hooks/use-preferences';
import {
  clearCredentials,
  getStoredSesskey,
  getStoredToken,
  loginTauSso,
  logoutAndTeardownSession,
  renewTokenSilently,
  saveCredentials,
  saveSesskey,
  saveToken,
} from '@/services/auth';
import {
  isTokenAuthError,
  registerBackgroundSyncTask,
  triggerForegroundSync,
  unregisterBackgroundSyncTask,
} from '@/services/backgroundSync';
import {
  clearUserTablesOnLogout,
  getCourseStaffMap,
  getDb,
  getPreference,
  getTrackedCourses,
  loadSyncResultFromDatabase,
  removePreference,
  saveSyncResultToDatabase,
  saveTrackedCourses,
  setPreference,
} from '@/services/database';
import {
  performGoogleTasksSync,
  setGoogleAccessToken,
  setGoogleRefreshToken,
} from '@/services/googleTasks';
import { generateMockCourseSyncData, MOCK_COURSE_ID } from '@/services/mockCourse';
import {
  requestNotificationPermissions,
  scheduleDeadlineNotifications,
} from '@/services/notifications';
import {
  DEFAULT_MOBILE_SETTINGS,
  MobileAppSettings,
  applyLocalSettingsPatch,
  getLocalSettingsSnapshot,
  performSettingsSync,
  resetSettingsSyncThrottle,
} from '@/services/settingsSyncService';

const EMPTY_SYNC_RESULT: SyncResult = {
  courses: [],
  sections: [],
  folders: [],
  links: [],
  announcements: [],
  gradeSummaries: {},
  assignments: [],
  files: [],
  meetings: [],
  recordings: [],
  courseStaff: {},
  errors: [],
  syncedAt: '',
};

export interface SyncWarningItem {
  context: string;
  message: string;
}

export interface SyncProgressContextValue {
  isSyncing: boolean;
  syncProgress: SyncProgressState | null;
  syncError: string | null;
  syncWarnings: SyncWarningItem[];
  syncWindowVisible: boolean;
  syncWindowCollapsed: boolean;
  setSyncWindowCollapsed: (collapsed: boolean) => void;
  openSyncWindow: () => void;
  closeSyncWindow: () => void;
}

const SyncProgressContext = createContext<SyncProgressContextValue | null>(null);

export interface AppStateContextValue {
  isInitialized: boolean;
  isAuthenticated: boolean;
  hasCompletedOnboarding: boolean;
  syncResult: SyncResult;
  enrolledCourses: MoodleCourse[];
  groupedCourses: GroupedCoursesResult;
  isSyncing: boolean;
  syncProgress: SyncProgressState | null;
  lastSyncedAt: string | null;
  syncError: string | null;
  syncWarnings: SyncWarningItem[];
  tourActive: boolean;
  tourStep: number;
  settings: MobileAppSettings;
  // Convenience mirrors from settings & user metadata
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
  userFullname: string;
  hasMockCourse: boolean;
  sessionExpired: boolean;
  // Actions
  clearSessionExpired: () => void;
  reconnectWithToken: (token: string) => Promise<void>;
  loginWithSso: (username: string, idNumber: string, password: string, rememberMe: boolean) => Promise<boolean>;
  loginWithToken: (token: string) => Promise<boolean>;
  fetchOnboardingCourses: (tokenOverride?: string) => Promise<MoodleCourse[]>;
  completeOnboarding: (
    selectedIds: number[],
    nicknames?: Record<number, string>,
    colors?: Record<number, string>,
    hideLabAssignmentsForCourseIds?: number[]
  ) => Promise<void>;
  triggerSync: (options?: { manual?: boolean }) => Promise<SyncResult | null>;
  toggleAssignmentDone: (uid: string) => Promise<void>;
  toggleAssignmentHidden: (uid: string, forceUnhide?: boolean) => Promise<void>;
  bulkSetCourseAssignmentsHidden: (courseId: number, hide: boolean) => Promise<void>;
  toggleZoomHidden: (meetingKey: string) => Promise<void>;
  bulkSetCourseZoomHidden: (courseId: number, hide: boolean) => Promise<void>;
  toggleRecordingWatched: (recordingId: string) => Promise<void>;
  toggleRecordingHidden: (recordingId: string) => Promise<void>;
  toggleTrackedHost: (courseId: number, hostName: string, role: PanoptoRecordingType) => Promise<void>;
  saveCoursePanoptoStaff: (courseId: number, staffEntries: CoursePanoptoStaffEntry[]) => Promise<void>;
  saveCoursePanoptoFolder: (courseId: number, folderId: string) => Promise<void>;
  saveCoursesConfiguration: (
    trackedIds: number[],
    nicknames?: Record<number, string>,
    colors?: Record<number, string>
  ) => Promise<void>;
  updateSetting: <K extends keyof MobileAppSettings>(key: K, value: MobileAppSettings[K]) => Promise<void>;
  refreshFromLocal: () => Promise<void>;
  addMockCourse: () => Promise<void>;
  removeMockCourse: () => Promise<void>;
  disconnectAccount: () => Promise<void>;
  startTour: () => void;
  setTourStep: (step: number) => void;
  stopTour: () => void;
}

const AppStateContext = createContext<AppStateContextValue | null>(null);

function extractTokenAndSesskey(result: unknown): { token: string | null; sesskey?: string } {
  if (typeof result === 'string') {
    return { token: result.trim() || null };
  }
  if (result && typeof result === 'object') {
    const obj = result as { token?: string; sesskey?: string };
    return {
      token: typeof obj.token === 'string' ? obj.token.trim() || null : null,
      sesskey: typeof obj.sesskey === 'string' ? obj.sesskey : undefined,
    };
  }
  return { token: null };
}

function getUnifiedMemberIds(courseId: number, grouped: GroupedCoursesResult): Set<number> {
  const members = new Set<number>([courseId]);
  for (const u of grouped.academicCourses) {
    if (u.id === courseId || u.subCourses.some((s) => s.courseId === courseId)) {
      members.add(u.id);
      for (const s of u.subCourses) members.add(s.courseId);
    }
  }
  if (
    grouped.administrativeUmbrella &&
    (grouped.administrativeUmbrella.id === courseId ||
      grouped.administrativeUmbrella.subCourses.some((s) => s.courseId === courseId))
  ) {
    members.add(grouped.administrativeUmbrella.id);
    for (const s of grouped.administrativeUmbrella.subCourses) members.add(s.courseId);
  }
  return members;
}

function buildCourseAliasMap(grouped: GroupedCoursesResult): Map<number, number[]> {
  const aliases = new Map<number, number[]>();
  for (const u of grouped.academicCourses) {
    const memberIds = u.subCourses.map((s) => s.courseId);
    if (memberIds.length > 1) {
      for (const id of memberIds) {
        aliases.set(id, memberIds);
      }
    }
  }
  return aliases;
}

function normalizeSyncResultShape(raw: Partial<SyncResult> | null | undefined): SyncResult {
  if (!raw) return EMPTY_SYNC_RESULT;
  return {
    courses: Array.isArray(raw.courses) ? raw.courses : [],
    sections: Array.isArray(raw.sections) ? raw.sections : [],
    folders: Array.isArray(raw.folders) ? raw.folders : [],
    links: Array.isArray(raw.links) ? raw.links : [],
    announcements: Array.isArray(raw.announcements) ? raw.announcements : [],
    gradeSummaries: raw.gradeSummaries || {},
    assignments: Array.isArray(raw.assignments) ? raw.assignments : [],
    files: Array.isArray(raw.files) ? raw.files : [],
    meetings: Array.isArray(raw.meetings) ? raw.meetings : [],
    recordings: Array.isArray(raw.recordings) ? raw.recordings : [],
    courseStaff: raw.courseStaff || {},
    errors: Array.isArray(raw.errors) ? raw.errors : [],
    syncedAt: raw.syncedAt || '',
  };
}

function upsertCoursesInSqlite(
  trackedIds: number[],
  courses: MoodleCourse[],
  colorMap: Record<number, string>,
  namesMap: Record<number, string>
): void {
  try {
    const courseById = new Map<number, MoodleCourse>();
    for (const c of courses) {
      courseById.set(c.id, c);
    }

    const existingRows = getTrackedCourses(false);
    const existingById = new Map(existingRows.map((r) => [r.moodle_id, r]));
    const activeSet = new Set<number>(trackedIds.filter((id) => Number.isFinite(id) && id > 0));
    const allIds = new Set<number>([...existingById.keys(), ...activeSet]);

    const rowsToSave = Array.from(allIds).map((cid) => {
      const meta = courseById.get(cid);
      const existing = existingById.get(cid);
      return {
        moodle_id: cid,
        course_id: meta?.courseId || existing?.course_id || '',
        name: namesMap[cid] || meta?.fullname || existing?.name || `Course ${cid}`,
        semester: meta?.semester || existing?.semester || '',
        year: meta?.year || existing?.year || '',
        color: colorMap[cid] || existing?.color || '#6366f1',
        is_active: activeSet.has(cid) ? 1 : 0,
      };
    });

    saveTrackedCourses(rowsToSave, { merge: false });
  } catch (e) {
    console.warn('[AppState] Failed to upsert tracked_courses in SQLite:', e);
  }
}

function loadCachedEnrolledCourses(): MoodleCourse[] {
  try {
    const raw = getPreference('enrolled_courses_cache');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mergeByKey<T>(prev: T[] | undefined, incoming: T[] | undefined, getKey: (item: T) => string): T[] {
  const base = Array.isArray(prev) ? prev : [];
  if (!Array.isArray(incoming) || incoming.length === 0) return base;
  const map = new Map<string, T>();
  for (const item of base) {
    map.set(getKey(item), item);
  }
  for (const item of incoming) {
    map.set(getKey(item), item);
  }
  return Array.from(map.values());
}

function mergePartialSyncResult(prev: SyncResult, partial: Partial<SyncResult>): SyncResult {
  let nextMeetings = prev.meetings || [];
  if (Array.isArray(partial.meetings) && partial.meetings.length > 0) {
    const incomingCourseIds = new Set(partial.meetings.map((m) => m.courseId));
    const kept = (prev.meetings || []).filter((m) => !incomingCourseIds.has(m.courseId));
    const seen = new Set<string>();
    const dedupedIncoming = partial.meetings.filter((m) => {
      const k = `${m.courseId}|${m.meetingUrl}|${m.title}|${m.startTime || ''}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    nextMeetings = [...kept, ...dedupedIncoming];
  }

  return {
    courses: mergeByKey(prev.courses, partial.courses, (c) => String(c.id)),
    sections: mergeByKey(prev.sections, partial.sections, (s) => String(s.id)),
    folders: mergeByKey(prev.folders, partial.folders, (f) => String(f.id)),
    links: mergeByKey(prev.links, partial.links, (l) => String(l.id)),
    announcements: mergeByKey(prev.announcements, partial.announcements, (a) => String(a.id)),
    gradeSummaries: partial.gradeSummaries
      ? { ...(prev.gradeSummaries || {}), ...partial.gradeSummaries }
      : prev.gradeSummaries,
    assignments: mergeByKey(
      prev.assignments,
      partial.assignments,
      (a) => a.uid || `${a.activityType || 'assign'}:${a.id}`
    ),
    files: mergeByKey(prev.files, partial.files, (f) => f.fileUrl),
    meetings: nextMeetings,
    recordings: mergeByKey(prev.recordings, partial.recordings, (r) => r.id),
    courseStaff: partial.courseStaff
      ? { ...(prev.courseStaff || {}), ...partial.courseStaff }
      : prev.courseStaff,
    errors: Array.isArray(partial.errors) ? partial.errors : prev.errors,
    syncedAt: partial.syncedAt || prev.syncedAt,
  };
}

function extractSyncWarnings(errors: SyncResult['errors'] | undefined): SyncWarningItem[] {
  if (!Array.isArray(errors) || errors.length === 0) return [];
  const seen = new Set<string>();
  const out: SyncWarningItem[] = [];
  for (const e of errors) {
    const context = String(e?.context || 'sync').trim();
    const message = String(e?.message || '').trim();
    if (!message) continue;
    const key = `${context}|${message}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ context, message });
    }
  }
  return out;
}

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const { refreshPreferences } = usePreferences();

  const [isInitialized, setIsInitialized] = useState<boolean>(false);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState<boolean>(false);
  const [syncResult, setSyncResult] = useState<SyncResult>(EMPTY_SYNC_RESULT);
  const [enrolledCourses, setEnrolledCourses] = useState<MoodleCourse[]>([]);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgressState | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncWarnings, setSyncWarnings] = useState<SyncWarningItem[]>([]);
  const [syncWindowVisible, setSyncWindowVisible] = useState<boolean>(false);
  const [syncWindowCollapsed, setSyncWindowCollapsed] = useState<boolean>(false);
  const [tourStep, setTourStepState] = useState<number>(-1);
  const [settings, setSettingsState] = useState<MobileAppSettings>(DEFAULT_MOBILE_SETTINGS);
  const [userFullname, setUserFullname] = useState<string>('');
  const [sessionExpired, setSessionExpired] = useState<boolean>(false);

  const settingsRef = useRef<MobileAppSettings>(DEFAULT_MOBILE_SETTINGS);
  const syncResultRef = useRef<SyncResult>(EMPTY_SYNC_RESULT);
  const enrolledCoursesRef = useRef<MoodleCourse[]>([]);
  const activeSyncPromiseRef = useRef<Promise<SyncResult | null> | null>(null);
  const sessionGenerationRef = useRef<number>(0);
  const lastProgressEmitRef = useRef<{ ts: number; stage: string; percent: number }>({
    ts: 0,
    stage: '',
    percent: -1,
  });

  const openSyncWindow = useCallback(() => {
    if (!activeSyncPromiseRef.current) return;
    setSyncWindowVisible(true);
    setSyncWindowCollapsed(false);
  }, []);

  const closeSyncWindow = useCallback(() => {
    setSyncWindowVisible(false);
  }, []);

  const clearSessionExpired = useCallback(() => {
    setSessionExpired(false);
  }, []);

  const updateSettingsState = useCallback((next: MobileAppSettings) => {
    settingsRef.current = next;
    setSettingsState(next);
  }, []);

  const updateSyncResultState = useCallback((next: SyncResult) => {
    syncResultRef.current = next;
    setSyncResult(next);
  }, []);

  const updateEnrolledCoursesState = useCallback((next: MoodleCourse[]) => {
    enrolledCoursesRef.current = next;
    setEnrolledCourses(next);
  }, []);

  const groupedCourses = useMemo<GroupedCoursesResult>(
    () => groupEnrolledCourses(enrolledCourses),
    [enrolledCourses]
  );

  const refreshFromLocal = useCallback(async () => {
    const localSettings = getLocalSettingsSnapshot();
    updateSettingsState(localSettings);

    const localSync = normalizeSyncResultShape(loadSyncResultFromDatabase());
    updateSyncResultState(localSync);

    const cachedEnrolled = loadCachedEnrolledCourses();
    if (cachedEnrolled.length > 0 && enrolledCoursesRef.current.length === 0) {
      updateEnrolledCoursesState(cachedEnrolled);
    }

    const fullNamePref = getPreference('user_fullname') || '';
    setUserFullname(fullNamePref);

    const syncedAtVal = localSync.syncedAt || getPreference('last_synced_at') || null;
    setLastSyncedAt(syncedAtVal);

    refreshPreferences();
  }, [refreshPreferences, updateEnrolledCoursesState, updateSettingsState, updateSyncResultState]);

  const fetchOnboardingCourses = useCallback(
    async (tokenOverride?: string): Promise<MoodleCourse[]> => {
      let token = tokenOverride || (await getStoredToken());
      if (!token) {
        const renewed = extractTokenAndSesskey(await renewTokenSilently());
        token = renewed.token;
      }
      if (!token) return [];

      const fetchWithToken = async (activeToken: string): Promise<MoodleCourse[]> => {
        const sesskey = await getStoredSesskey();
        const client = new MoodleClient(activeToken, undefined, {
          sesskey: sesskey || undefined,
          devMode: false,
          enableScraping: false,
          lang: settingsRef.current.language,
        });
        const info = await client.getSiteInfo();
        if (info?.fullname) {
          setUserFullname(info.fullname);
          setPreference('user_fullname', info.fullname);
        }
        const rawCourses = await client.getEnrolledCourses(info.userid);
        return rawCourses.map((c) => {
          const meta = parseTauCourseMetadata(c.idnumber || c.shortname || c.fullname || '');
          return {
            id: c.id,
            courseId: meta?.courseCode || c.idnumber || c.shortname || String(c.id),
            shortname: c.shortname || '',
            fullname: c.fullname || '',
            idnumber: c.idnumber,
            semester: meta?.semester || 'Other',
            year: meta?.year || (c.year !== undefined ? String(c.year) : ''),
            visible: c.visible,
            startdate: c.startdate,
            enddate: c.enddate,
            summary: c.summary,
            baseUrl: c.instanceUrl,
            format: c.format,
            coursecategory: c.coursecategory,
          };
        });
      };

      let normalized: MoodleCourse[];
      try {
        normalized = await fetchWithToken(token);
      } catch (err: any) {
        if (isTokenAuthError(err)) {
          const renewed = extractTokenAndSesskey(await renewTokenSilently());
          if (!renewed.token) {
            setSessionExpired(true);
            throw err;
          }
          normalized = await fetchWithToken(renewed.token);
        } else {
          throw err;
        }
      }

      // Preserve mock course in enrolledCourses if currently tracked
      if (settingsRef.current.trackedCourseIds.includes(MOCK_COURSE_ID)) {
        const hasMock = normalized.some((c) => c.id === MOCK_COURSE_ID);
        if (!hasMock) {
          const mockRaw: any = generateMockCourseSyncData(settingsRef.current.language);
          const mockCourses: MoodleCourse[] = Array.isArray(mockRaw?.courses)
            ? mockRaw.courses
            : Array.isArray(mockRaw?.syncResult?.courses)
              ? mockRaw.syncResult.courses
              : [];
          normalized = [...normalized, ...mockCourses];
        }
      }

      setPreference('enrolled_courses_cache', JSON.stringify(normalized));
      updateEnrolledCoursesState(normalized);
      return normalized;
    },
    [updateEnrolledCoursesState]
  );

  const triggerSync = useCallback(async (_options?: { manual?: boolean }): Promise<SyncResult | null> => {
    if (activeSyncPromiseRef.current) {
      return activeSyncPromiseRef.current;
    }

    const gen = sessionGenerationRef.current;
    lastProgressEmitRef.current = { ts: 0, stage: '', percent: -1 };

    const runPromise = (async () => {
      setIsSyncing(true);
      setSyncError(null);
      setSyncProgress({
        percent: 1,
        stage: 'init',
        message: 'Starting sync...',
        coursesCompleted: 0,
        totalCourses: 0,
        activitiesCompleted: 0,
        totalActivities: 0,
      });

      try {
        const result = await triggerForegroundSync(
          (progressState) => {
            if (sessionGenerationRef.current !== gen) return;
            const now = Date.now();
            const roundedPct = Math.round(progressState.percent);
            const prev = lastProgressEmitRef.current;
            const stageChanged = progressState.stage !== prev.stage;
            const pctChanged = roundedPct !== prev.percent;
            if (stageChanged || roundedPct >= 100 || (pctChanged && now - prev.ts >= 150)) {
              lastProgressEmitRef.current = { ts: now, stage: progressState.stage, percent: roundedPct };
              setSyncProgress(progressState);
            }
          },
          (partial) => {
            if (sessionGenerationRef.current !== gen) return;
            const merged = mergePartialSyncResult(syncResultRef.current, partial);
            updateSyncResultState(merged);
            if (
              partial.discoveredPanoptoFolders &&
              Object.keys(partial.discoveredPanoptoFolders).length > 0
            ) {
              updateSettingsState(getLocalSettingsSnapshot());
            }
          }
        );

        if (sessionGenerationRef.current !== gen) {
          return null;
        }

        const freshSettings = getLocalSettingsSnapshot();
        updateSettingsState(freshSettings);
        refreshPreferences();

        const loaded = normalizeSyncResultShape(loadSyncResultFromDatabase());
        updateSyncResultState(loaded);
        const allErrors = result?.errors || loaded.errors;
        setSyncWarnings(extractSyncWarnings(allErrors));
        const hasAuthErr = Array.isArray(allErrors) && allErrors.some((e) => isTokenAuthError(e));
        setSessionExpired(hasAuthErr);

        const syncedAtVal = result?.syncedAt || loaded.syncedAt || new Date().toISOString();
        setLastSyncedAt(syncedAtVal);
        setPreference('last_synced_at', syncedAtVal);

        return loaded;
      } catch (err: any) {
        if (sessionGenerationRef.current !== gen) {
          return null;
        }
        const msg = err?.message || 'Synchronization failed.';
        setSyncError(msg);
        if (isTokenAuthError(err) || msg === 'Moodle token not configured.') {
          setSessionExpired(true);
        }
        return null;
      } finally {
        if (sessionGenerationRef.current === gen) {
          setIsSyncing(false);
          setSyncWindowVisible(false);
          setSyncWindowCollapsed(false);
          activeSyncPromiseRef.current = null;
        }
      }
    })();

    activeSyncPromiseRef.current = runPromise;
    return runPromise;
  }, [refreshPreferences, updateSettingsState, updateSyncResultState]);

  // Initial hydration on mount
  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      try {
        const localSettings = getLocalSettingsSnapshot();
        if (!cancelled) updateSettingsState(localSettings);

        const localSync = normalizeSyncResultShape(loadSyncResultFromDatabase());
        if (!cancelled) {
          updateSyncResultState(localSync);
          setLastSyncedAt(localSync.syncedAt || getPreference('last_synced_at') || null);
          setUserFullname(getPreference('user_fullname') || '');
        }

        const cachedEnrolled = loadCachedEnrolledCourses();
        if (!cancelled && cachedEnrolled.length > 0) {
          updateEnrolledCoursesState(cachedEnrolled);
        }

        const token = await getStoredToken();
        if (cancelled) return;

        if (!token) {
          setIsAuthenticated(false);
          setHasCompletedOnboarding(false);
          setIsInitialized(true);
          return;
        }

        setIsAuthenticated(true);
        let activeRowsCount = 0;
        try {
          activeRowsCount = getTrackedCourses(true).length;
        } catch {}

        const initialHasOnboarding =
          localSettings.trackedCourseIds.length > 0 ||
          activeRowsCount > 0 ||
          getPreference('onboarding_completed') === 'true';

        setHasCompletedOnboarding(initialHasOnboarding);
        setIsInitialized(true);

        // Background settings sync + course fetch + foreground sync
        const hasRemoteTracked = await performSettingsSync(token).catch(() => false);
        if (cancelled) return;

        const syncedSettings = getLocalSettingsSnapshot();
        updateSettingsState(syncedSettings);
        refreshPreferences();

        const onboardingDone =
          initialHasOnboarding || hasRemoteTracked || syncedSettings.trackedCourseIds.length > 0;
        setHasCompletedOnboarding(onboardingDone);

        if (onboardingDone) {
          if (cachedEnrolled.length === 0) {
            fetchOnboardingCourses(token).catch(() => {});
          }
          if (syncedSettings.notificationsEnabled) {
            requestNotificationPermissions().catch(() => {});
          }
          registerBackgroundSyncTask().catch(() => {});
          triggerSync({ manual: false }).catch(() => {});
        } else {
          fetchOnboardingCourses(token).catch(() => {});
        }
      } catch (e) {
        console.error('[AppState] Bootstrap error:', e);
        if (!cancelled) {
          setIsInitialized(true);
        }
      }
    };

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, [fetchOnboardingCourses, refreshPreferences, triggerSync, updateEnrolledCoursesState, updateSettingsState, updateSyncResultState]);

  // Foreground periodic auto-sync based on syncIntervalMinutes (only when app is active)
  useEffect(() => {
    if (!isAuthenticated || !hasCompletedOnboarding) return;
    const minutes = Math.max(1, Number(settings.syncIntervalMinutes) || 60);
    const intervalMs = minutes * 60 * 1000;

    const timer = setInterval(() => {
      if (AppState.currentState && AppState.currentState !== 'active') {
        return;
      }
      triggerSync({ manual: false }).catch(() => {});
    }, intervalMs);

    return () => clearInterval(timer);
  }, [isAuthenticated, hasCompletedOnboarding, settings.syncIntervalMinutes, triggerSync]);

  const loginWithSso = useCallback(
    async (username: string, idNumber: string, password: string, rememberMe: boolean): Promise<boolean> => {
      const loginRaw = await loginTauSso(username.trim(), idNumber.trim(), password.trim());
      const { token, sesskey } = extractTokenAndSesskey(loginRaw);
      if (!token) {
        throw new Error('Authentication did not return a valid Moodle token.');
      }

      await saveToken(token);
      if (sesskey) {
        await saveSesskey(sesskey);
      }

      if (rememberMe) {
        await saveCredentials(username.trim(), idNumber.trim(), password.trim());
        setPreference('remember_me', 'true');
      } else {
        await clearCredentials();
        setPreference('remember_me', 'false');
      }

      try {
        const storedSesskey = sesskey || (await getStoredSesskey());
        const client = new MoodleClient(token, undefined, {
          sesskey: storedSesskey || undefined,
          devMode: false,
          enableScraping: false,
        });
        const info = await client.getSiteInfo();
        if (info?.fullname) {
          setUserFullname(info.fullname);
          setPreference('user_fullname', info.fullname);
        }
      } catch {
        // Non-fatal if site info fetch fails temporarily
      }

      const hasRemoteTracked = await performSettingsSync(token).catch(() => false);
      const syncedSettings = getLocalSettingsSnapshot();
      updateSettingsState(syncedSettings);
      refreshPreferences();
      setSessionExpired(false);
      setIsAuthenticated(true);

      const hasTracked = hasRemoteTracked || syncedSettings.trackedCourseIds.length > 0;
      if (hasTracked) {
        setHasCompletedOnboarding(true);
        setPreference('onboarding_completed', 'true');
        if (syncedSettings.notificationsEnabled) {
          requestNotificationPermissions().catch(() => {});
        }
        fetchOnboardingCourses(token).catch(() => {});
        registerBackgroundSyncTask().catch(() => {});
        triggerSync({ manual: false }).catch(() => {});
      } else {
        setHasCompletedOnboarding(false);
        await fetchOnboardingCourses(token);
      }

      return true;
    },
    [fetchOnboardingCourses, refreshPreferences, triggerSync, updateSettingsState]
  );

  const loginWithToken = useCallback(
    async (rawToken: string): Promise<boolean> => {
      const token = rawToken.trim();
      if (!token) {
        throw new Error('Token cannot be empty.');
      }

      const client = new MoodleClient(token, undefined, {
        devMode: false,
        enableScraping: false,
      });
      const info = await client.getSiteInfo();
      if (info?.fullname) {
        setUserFullname(info.fullname);
        setPreference('user_fullname', info.fullname);
      }

      await saveToken(token);

      const hasRemoteTracked = await performSettingsSync(token).catch(() => false);
      const syncedSettings = getLocalSettingsSnapshot();
      updateSettingsState(syncedSettings);
      refreshPreferences();
      setSessionExpired(false);
      setIsAuthenticated(true);

      const hasTracked = hasRemoteTracked || syncedSettings.trackedCourseIds.length > 0;
      if (hasTracked) {
        setHasCompletedOnboarding(true);
        setPreference('onboarding_completed', 'true');
        if (syncedSettings.notificationsEnabled) {
          requestNotificationPermissions().catch(() => {});
        }
        fetchOnboardingCourses(token).catch(() => {});
        registerBackgroundSyncTask().catch(() => {});
        triggerSync({ manual: false }).catch(() => {});
      } else {
        setHasCompletedOnboarding(false);
        await fetchOnboardingCourses(token);
      }

      return true;
    },
    [fetchOnboardingCourses, refreshPreferences, triggerSync, updateSettingsState]
  );

  const reconnectWithToken = useCallback(
    async (rawToken: string): Promise<void> => {
      const token = rawToken.trim();
      if (!token) {
        throw new Error('Token cannot be empty.');
      }

      await saveToken(token);
      setSessionExpired(false);
      setSyncError(null);
      resetSettingsSyncThrottle();
      await performSettingsSync(token, { force: true }).catch(() => false);
      const syncedSettings = getLocalSettingsSnapshot();
      updateSettingsState(syncedSettings);
      refreshPreferences();
      setIsAuthenticated(true);
      await triggerSync({ manual: false }).catch(() => null);
    },
    [refreshPreferences, triggerSync, updateSettingsState]
  );

  const saveCoursesConfiguration = useCallback(
    async (
      trackedIds: number[],
      nicknames?: Record<number, string>,
      colors?: Record<number, string>
    ): Promise<void> => {
      const grouped = groupEnrolledCourses(enrolledCoursesRef.current);
      const expandedIds = expandTrackedCourseIds(trackedIds, grouped);

      const current = settingsRef.current;
      const nextNames: Record<number, string> = { ...current.coursesCustomNames };
      if (nicknames) {
        for (const [k, v] of Object.entries(nicknames)) {
          const cid = Number(k);
          if (!Number.isFinite(cid)) continue;
          const trimmed = typeof v === 'string' ? v.trim() : '';
          if (trimmed) {
            nextNames[cid] = trimmed;
          } else {
            delete nextNames[cid];
          }
        }
      }

      const nextColors: Record<number, string> = { ...current.coursesColorMap };
      if (colors) {
        for (const [k, v] of Object.entries(colors)) {
          const cid = Number(k);
          if (Number.isFinite(cid) && typeof v === 'string' && v.trim()) {
            nextColors[cid] = v.trim();
          }
        }
      }

      // Assign palette colors to newly tracked courses without a color yet
      expandedIds.forEach((cid, idx) => {
        if (!nextColors[cid]) {
          const paletteColor =
            Array.isArray(COURSE_COLOR_PALETTE) && COURSE_COLOR_PALETTE.length > 0
              ? COURSE_COLOR_PALETTE[idx % COURSE_COLOR_PALETTE.length]
              : '#6366f1';
          nextColors[cid] = paletteColor;
        }
      });

      upsertCoursesInSqlite(expandedIds, enrolledCoursesRef.current, nextColors, nextNames);
      applyLocalSettingsPatch(
        {
          trackedCourseIds: expandedIds,
          coursesCustomNames: nextNames,
          coursesColorMap: nextColors,
        },
        true
      );
      updateSettingsState(getLocalSettingsSnapshot());
    },
    [updateSettingsState]
  );

  const bulkSetCourseAssignmentsHidden = useCallback(
    async (courseId: number, hide: boolean): Promise<void> => {
      const current = settingsRef.current;
      const grouped = groupEnrolledCourses(enrolledCoursesRef.current);
      const memberIds = getUnifiedMemberIds(courseId, grouped);
      const courseAssigns = (syncResultRef.current.assignments || []).filter(
        (a) => memberIds.has(a.courseId) || (a.sourceCourseId !== undefined && memberIds.has(a.sourceCourseId))
      );

      let updatedHidden = [...current.hiddenAssignments];
      for (const assign of courseAssigns) {
        const targetKey = getActivityUid(assign);
        const unhiddenKey = `unhidden:${targetKey}`;
        updatedHidden = updatedHidden.filter(
          (id) => id !== unhiddenKey && !matchesActivityIdentifier(id, assign)
        );
        if (hide) {
          if (!assign.isHidden) {
            updatedHidden.push(targetKey);
          }
        } else if (assign.isHidden) {
          updatedHidden.push(unhiddenKey);
        }
      }

      applyLocalSettingsPatch({ hiddenAssignments: updatedHidden }, true);
      const nextSettings = getLocalSettingsSnapshot();
      updateSettingsState(nextSettings);

      scheduleDeadlineNotifications(syncResultRef.current.assignments).catch(() => {});
      if (nextSettings.googleTasksEnabled) {
        performGoogleTasksSync(syncResultRef.current.assignments).catch(() => {});
      }
    },
    [updateSettingsState]
  );

  const completeOnboarding = useCallback(
    async (
      selectedIds: number[],
      nicknames?: Record<number, string>,
      colors?: Record<number, string>,
      hideLabAssignmentsForCourseIds?: number[]
    ): Promise<void> => {
      await saveCoursesConfiguration(selectedIds, nicknames, colors);
      setHasCompletedOnboarding(true);
      setPreference('onboarding_completed', 'true');
      if (settingsRef.current.notificationsEnabled) {
        requestNotificationPermissions().catch(() => {});
      }
      registerBackgroundSyncTask().catch(() => {});

      const synced = await triggerSync({ manual: false });
      if (hideLabAssignmentsForCourseIds && hideLabAssignmentsForCourseIds.length > 0 && synced) {
        for (const cid of hideLabAssignmentsForCourseIds) {
          await bulkSetCourseAssignmentsHidden(cid, true);
        }
      }
    },
    [bulkSetCourseAssignmentsHidden, saveCoursesConfiguration, triggerSync]
  );

  const toggleAssignmentDone = useCallback(
    async (uid: string): Promise<void> => {
      const current = settingsRef.current;
      const rawAssignments = syncResultRef.current.assignments || [];
      const assign = rawAssignments.find(
        (x) =>
          matchesActivityIdentifier(uid, x) ||
          x.uid === uid ||
          getActivityUid(x) === String(uid) ||
          String(x.id) === String(uid)
      );

      const fallbackAssign: Pick<Assignment, 'id' | 'status'> = {
        id: Number(String(uid).split(':').pop()) || 0,
        status: 'Not submitted',
      };
      const targetKey = assign ? getActivityUid(assign) : String(uid);
      const isMoodleSubmitted = assign ? isMoodleActivitySubmitted(assign) : false;
      const isCurrentlyCompleted = isActivityCompleted(
        assign || fallbackAssign,
        current.completedAssignments,
        current.uncompletedAssignments
      );

      const updatedCompleted = current.completedAssignments.filter(
        (id) => !matchesActivityIdentifier(id, assign || fallbackAssign) && String(id) !== targetKey
      );
      const updatedUncompleted = current.uncompletedAssignments.filter(
        (id) => !matchesActivityIdentifier(id, assign || fallbackAssign) && String(id) !== targetKey
      );

      const willBeCompleted = !isCurrentlyCompleted;
      if (willBeCompleted) {
        if (!isMoodleSubmitted) {
          updatedCompleted.push(targetKey);
        }
      } else if (isMoodleSubmitted) {
        updatedUncompleted.push(targetKey);
      }

      applyLocalSettingsPatch(
        {
          completedAssignments: updatedCompleted,
          uncompletedAssignments: updatedUncompleted,
        },
        true
      );
      const nextSettings = getLocalSettingsSnapshot();
      updateSettingsState(nextSettings);

      if (assign?.requiresManualCompletion && assign.cmid) {
        getStoredToken()
          .then((tok: string | null) => {
            if (!tok) return;
            let instanceBaseUrl: string | undefined;
            try {
              instanceBaseUrl = assign.link ? new URL(assign.link).origin : undefined;
            } catch {}
            const client = new MoodleClient(tok, instanceBaseUrl, { devMode: false, enableScraping: false });
            client.updateActivityCompletionManually(assign.cmid, willBeCompleted).catch(() => {});
          })
          .catch(() => {});
      }

      scheduleDeadlineNotifications(rawAssignments).catch(() => {});
      if (nextSettings.googleTasksEnabled) {
        performGoogleTasksSync(rawAssignments).catch(() => {});
      }
    },
    [updateSettingsState]
  );

  const toggleAssignmentHidden = useCallback(
    async (uid: string, forceUnhide?: boolean): Promise<void> => {
      const current = settingsRef.current;
      const rawAssignments = syncResultRef.current.assignments || [];
      const assign = rawAssignments.find(
        (x) =>
          matchesActivityIdentifier(uid, x) ||
          x.uid === uid ||
          getActivityUid(x) === String(uid) ||
          String(x.id) === String(uid)
      );

      const fallbackAssign = { id: Number(String(uid).split(':').pop()) || 0, uid: String(uid) };
      const targetKey = assign ? getActivityUid(assign) : String(uid);
      const unhiddenKey = `unhidden:${targetKey}`;
      const isCurrentlyHidden = isActivityHidden(assign || fallbackAssign, current.hiddenAssignments);

      const updatedHidden = current.hiddenAssignments.filter(
        (id) =>
          id !== unhiddenKey &&
          String(id) !== targetKey &&
          !matchesActivityIdentifier(id, assign || fallbackAssign)
      );

      const shouldHide = forceUnhide !== undefined ? !forceUnhide : !isCurrentlyHidden;
      if (shouldHide) {
        if (!assign?.isHidden) {
          updatedHidden.push(targetKey);
        }
      } else if (assign?.isHidden) {
        updatedHidden.push(unhiddenKey);
      }

      applyLocalSettingsPatch({ hiddenAssignments: updatedHidden }, true);
      const nextSettings = getLocalSettingsSnapshot();
      updateSettingsState(nextSettings);

      scheduleDeadlineNotifications(rawAssignments).catch(() => {});
      if (nextSettings.googleTasksEnabled) {
        performGoogleTasksSync(rawAssignments).catch(() => {});
      }
    },
    [updateSettingsState]
  );

  const toggleZoomHidden = useCallback(
    async (meetingKey: string): Promise<void> => {
      const current = settingsRef.current.hiddenZoomMeetings;
      const updated = current.includes(meetingKey)
        ? current.filter((k) => k !== meetingKey)
        : [...current, meetingKey];
      applyLocalSettingsPatch({ hiddenZoomMeetings: updated }, true);
      updateSettingsState(getLocalSettingsSnapshot());
    },
    [updateSettingsState]
  );

  const bulkSetCourseZoomHidden = useCallback(
    async (courseId: number, hide: boolean): Promise<void> => {
      const grouped = groupEnrolledCourses(enrolledCoursesRef.current);
      const memberIds = getUnifiedMemberIds(courseId, grouped);
      const courseMeetings = (syncResultRef.current.meetings || []).filter((m) =>
        memberIds.has(m.courseId)
      );
      const courseKeys = courseMeetings.map((m) => getZoomMeetingKey(m));
      const keySet = new Set(courseKeys);
      const current = settingsRef.current.hiddenZoomMeetings;

      let updated: string[];
      if (hide) {
        updated = Array.from(new Set([...current, ...courseKeys]));
      } else {
        const extraIdentifiers = new Set<string>();
        for (const m of courseMeetings) {
          if (m.meetingNumber) {
            extraIdentifiers.add(m.meetingNumber.trim());
            extraIdentifiers.add(m.meetingNumber.replace(/[\s-]/g, ''));
          }
          if (m.meetingUrl) extraIdentifiers.add(m.meetingUrl.trim());
        }
        updated = current.filter((k) => !keySet.has(k) && !extraIdentifiers.has(k));
      }

      applyLocalSettingsPatch({ hiddenZoomMeetings: updated }, true);
      updateSettingsState(getLocalSettingsSnapshot());
    },
    [updateSettingsState]
  );

  const toggleRecordingWatched = useCallback(
    async (recordingId: string): Promise<void> => {
      if (!recordingId) return;
      const current = settingsRef.current.watchedRecordings;
      const updated = current.includes(recordingId)
        ? current.filter((id) => id !== recordingId)
        : [...current, recordingId];
      applyLocalSettingsPatch({ watchedRecordings: updated }, true);
      updateSettingsState(getLocalSettingsSnapshot());
    },
    [updateSettingsState]
  );

  const toggleRecordingHidden = useCallback(
    async (recordingId: string): Promise<void> => {
      if (!recordingId) return;
      const current = settingsRef.current.hiddenRecordings;
      const updated = current.includes(recordingId)
        ? current.filter((id) => id !== recordingId)
        : [...current, recordingId];
      applyLocalSettingsPatch({ hiddenRecordings: updated }, true);
      updateSettingsState(getLocalSettingsSnapshot());
    },
    [updateSettingsState]
  );

  const saveCoursePanoptoStaff = useCallback(
    async (courseId: number, staffEntries: CoursePanoptoStaffEntry[]): Promise<void> => {
      const nextStaffMap: Record<number, CoursePanoptoStaffEntry[]> = {
        ...settingsRef.current.coursesPanoptoStaff,
      };
      const nextHostsMap: Record<number, string[]> = {
        ...settingsRef.current.trackedPanoptoHosts,
      };

      if (staffEntries.length === 0) {
        delete nextStaffMap[courseId];
        delete nextHostsMap[courseId];
      } else {
        nextStaffMap[courseId] = staffEntries;
        nextHostsMap[courseId] = staffEntries
          .map((e) => e.panoptoName || e.moodleName || '')
          .filter(Boolean);
      }

      applyLocalSettingsPatch(
        {
          coursesPanoptoStaff: nextStaffMap,
          trackedPanoptoHosts: nextHostsMap,
        },
        true
      );
      updateSettingsState(getLocalSettingsSnapshot());

      const recs = syncResultRef.current.recordings;
      if (recs && recs.length > 0) {
        const grouped = groupEnrolledCourses(enrolledCoursesRef.current);
        const aliasMap = buildCourseAliasMap(grouped);
        const combinedStaff = {
          ...getCourseStaffMap(),
          ...(syncResultRef.current.courseStaff || {}),
        };
        const reclassified = reclassifyPanoptoRecordings(recs, nextStaffMap, combinedStaff, aliasMap);
        const nextSync: SyncResult = {
          ...syncResultRef.current,
          recordings: reclassified,
        };
        updateSyncResultState(nextSync);
        saveSyncResultToDatabase({ recordings: reclassified } as SyncResult);
      }
    },
    [updateSettingsState, updateSyncResultState]
  );

  const toggleTrackedHost = useCallback(
    async (courseId: number, hostName: string, role: PanoptoRecordingType): Promise<void> => {
      const existingEntries = settingsRef.current.coursesPanoptoStaff[courseId] || [];
      const staffMap = getCourseStaffMap();
      const moodleStaff =
        syncResultRef.current.courseStaff?.[courseId] ||
        staffMap[courseId];
      const nextEntries = toggleTrackedHostEntry(existingEntries, hostName, role, moodleStaff);
      await saveCoursePanoptoStaff(courseId, nextEntries);
    },
    [saveCoursePanoptoStaff]
  );

  const saveCoursePanoptoFolder = useCallback(
    async (courseId: number, folderId: string): Promise<void> => {
      const nextMap: Record<number, string> = { ...settingsRef.current.coursesPanoptoMap };
      const trimmed = (folderId || '').trim();
      if (!trimmed) {
        delete nextMap[courseId];
      } else {
        nextMap[courseId] = trimmed;
      }
      applyLocalSettingsPatch({ coursesPanoptoMap: nextMap }, true);
      updateSettingsState(getLocalSettingsSnapshot());
    },
    [updateSettingsState]
  );

  const updateSetting = useCallback(
    async <K extends keyof MobileAppSettings>(key: K, value: MobileAppSettings[K]): Promise<void> => {
      applyLocalSettingsPatch({ [key]: value } as Partial<MobileAppSettings>, true);
      const nextSettings = getLocalSettingsSnapshot();
      updateSettingsState(nextSettings);

      if (
        key === 'theme' ||
        key === 'themeTimeDayStart' ||
        key === 'themeTimeDayEnd' ||
        key === 'language'
      ) {
        refreshPreferences();
      }
      if (key === 'syncIntervalMinutes') {
        registerBackgroundSyncTask().catch(() => {});
      }
      if (key === 'notificationsEnabled') {
        scheduleDeadlineNotifications(syncResultRef.current.assignments).catch(() => {});
      }
    },
    [refreshPreferences, updateSettingsState]
  );

  const addMockCourse = useCallback(async (): Promise<void> => {
    const lang = settingsRef.current.language;
    const rawMock: any = generateMockCourseSyncData(lang);
    const mockData: Partial<SyncResult> = rawMock?.syncResult ? rawMock.syncResult : rawMock;
    const mockColor: string = rawMock?.color || rawMock?.courseColor || '#8b5cf6';
    const mockCustomName: string =
      rawMock?.customName ||
      rawMock?.courseName ||
      (lang === 'he' ? 'מבני נתונים' : 'Data Structures');

    const current = settingsRef.current;
    const nextTracked = Array.from(new Set([...current.trackedCourseIds, MOCK_COURSE_ID]));
    const nextColors = { ...current.coursesColorMap, [MOCK_COURSE_ID]: mockColor };
    const nextNames = { ...current.coursesCustomNames, [MOCK_COURSE_ID]: mockCustomName };

    const mockCourses: MoodleCourse[] = Array.isArray(mockData.courses) && mockData.courses.length > 0
      ? mockData.courses
      : [
          {
            id: MOCK_COURSE_ID,
            courseId: '03682161',
            shortname: '0368-2161-01-2026-1',
            fullname: lang === 'he' ? '0368-2161 מבני נתונים (קורס לדוגמה)' : '0368-2161 Data Structures (Mock Course)',
            semester: 'SemesterA',
            year: String(new Date().getFullYear()),
          },
        ];

    upsertCoursesInSqlite(nextTracked, [...enrolledCoursesRef.current, ...mockCourses], nextColors, nextNames);

    const hasMockRecordings = Array.isArray(mockData.recordings) && mockData.recordings.length > 0;
    applyLocalSettingsPatch(
      {
        trackedCourseIds: nextTracked,
        coursesColorMap: nextColors,
        coursesCustomNames: nextNames,
        ...(hasMockRecordings ? { panoptoEnabled: true } : {}),
      },
      false
    );
    updateSettingsState(getLocalSettingsSnapshot());

    const prev = syncResultRef.current;
    const filterNotMock = <T extends { courseId: number }>(arr?: T[]): T[] =>
      (arr || []).filter((item) => item.courseId !== MOCK_COURSE_ID);

    const nextGradeSummaries: Record<number, any> = { ...(prev.gradeSummaries || {}) };
    if (mockData.gradeSummaries) {
      Object.assign(nextGradeSummaries, mockData.gradeSummaries);
    }

    const mergedMockSync: SyncResult = {
      courses: [
        ...mockCourses,
        ...(prev.courses || []).filter((c) => c.id !== MOCK_COURSE_ID),
      ],
      sections: [...(mockData.sections || []), ...filterNotMock(prev.sections)],
      folders: [...(mockData.folders || []), ...filterNotMock(prev.folders)],
      links: [...(mockData.links || []), ...filterNotMock(prev.links)],
      announcements: [...(mockData.announcements || []), ...filterNotMock(prev.announcements)],
      gradeSummaries: nextGradeSummaries,
      assignments: [...(mockData.assignments || []), ...filterNotMock(prev.assignments)],
      files: [...(mockData.files || []), ...filterNotMock(prev.files)],
      meetings: [...(mockData.meetings || []), ...filterNotMock(prev.meetings)],
      recordings: [...(mockData.recordings || []), ...filterNotMock(prev.recordings)],
      courseStaff: { ...(prev.courseStaff || {}), ...(mockData.courseStaff || {}) },
      errors: prev.errors || [],
      syncedAt: prev.syncedAt || new Date().toISOString(),
    };

    // Persist mock items without triggering pruning on real courses
    saveSyncResultToDatabase({
      ...mergedMockSync,
      syncedAt: '',
    } as SyncResult);
    updateSyncResultState(mergedMockSync);

    const nextEnrolled = [
      ...enrolledCoursesRef.current.filter((c) => c.id !== MOCK_COURSE_ID),
      ...mockCourses,
    ];
    updateEnrolledCoursesState(nextEnrolled);
    setPreference('enrolled_courses_cache', JSON.stringify(nextEnrolled));
  }, [updateEnrolledCoursesState, updateSettingsState, updateSyncResultState]);

  const removeMockCourse = useCallback(async (): Promise<void> => {
    const current = settingsRef.current;
    const nextTracked = current.trackedCourseIds.filter((id) => id !== MOCK_COURSE_ID);
    const nextColors = { ...current.coursesColorMap };
    const nextNames = { ...current.coursesCustomNames };
    delete nextColors[MOCK_COURSE_ID];
    delete nextNames[MOCK_COURSE_ID];

    applyLocalSettingsPatch(
      {
        trackedCourseIds: nextTracked,
        coursesColorMap: nextColors,
        coursesCustomNames: nextNames,
      },
      false
    );
    updateSettingsState(getLocalSettingsSnapshot());

    try {
      const db = getDb();
      if (db && typeof db.runSync === 'function') {
        const safeExec = (sql: string, params: any[]) => {
          try {
            db.runSync(sql, params);
          } catch {}
        };
        safeExec('DELETE FROM tracked_courses WHERE moodle_id = ?', [MOCK_COURSE_ID]);
        safeExec('DELETE FROM courses WHERE id = ?', [MOCK_COURSE_ID]);
        safeExec('DELETE FROM assignments WHERE course_moodle_id = ?', [MOCK_COURSE_ID]);
        safeExec('DELETE FROM files WHERE course_moodle_id = ?', [MOCK_COURSE_ID]);
        safeExec('DELETE FROM meetings WHERE course_moodle_id = ?', [MOCK_COURSE_ID]);
        safeExec('DELETE FROM course_sections WHERE course_moodle_id = ?', [MOCK_COURSE_ID]);
        safeExec('DELETE FROM course_folders WHERE course_moodle_id = ?', [MOCK_COURSE_ID]);
        safeExec('DELETE FROM course_links WHERE course_moodle_id = ?', [MOCK_COURSE_ID]);
        safeExec('DELETE FROM course_announcements WHERE course_id = ?', [MOCK_COURSE_ID]);
        safeExec('DELETE FROM recordings WHERE course_id = ?', [MOCK_COURSE_ID]);
        safeExec('DELETE FROM course_staff WHERE course_id = ?', [MOCK_COURSE_ID]);
        safeExec('DELETE FROM grade_summaries WHERE course_id = ?', [MOCK_COURSE_ID]);
      }
    } catch {}

    const prev = syncResultRef.current;
    const dropMock = <T extends { courseId: number }>(arr?: T[]): T[] =>
      (arr || []).filter((item) => item.courseId !== MOCK_COURSE_ID);
    const nextGrades = { ...(prev.gradeSummaries || {}) };
    delete nextGrades[MOCK_COURSE_ID];

    updateSyncResultState({
      ...prev,
      courses: (prev.courses || []).filter((c) => c.id !== MOCK_COURSE_ID),
      sections: dropMock(prev.sections),
      folders: dropMock(prev.folders),
      links: dropMock(prev.links),
      announcements: dropMock(prev.announcements),
      gradeSummaries: nextGrades,
      assignments: dropMock(prev.assignments),
      files: dropMock(prev.files),
      meetings: dropMock(prev.meetings),
      recordings: dropMock(prev.recordings),
    });

    const nextEnrolled = enrolledCoursesRef.current.filter((c) => c.id !== MOCK_COURSE_ID);
    updateEnrolledCoursesState(nextEnrolled);
    setPreference('enrolled_courses_cache', JSON.stringify(nextEnrolled));
  }, [updateEnrolledCoursesState, updateSettingsState, updateSyncResultState]);

  const disconnectAccount = useCallback(async (): Promise<void> => {
    // Invalidate any in-flight sync so it discards stale results upon resolving
    sessionGenerationRef.current += 1;
    activeSyncPromiseRef.current = null;
    resetSettingsSyncThrottle();
    await unregisterBackgroundSyncTask().catch(() => {});

    let tablesCleared = false;
    try {
      await logoutAndTeardownSession();
      tablesCleared = true;
    } catch (e) {
      console.warn('[AppState] logoutAndTeardownSession error:', e);
    }

    if (!tablesCleared) {
      try {
        clearUserTablesOnLogout();
      } catch (e) {
        console.warn('[AppState] clearUserTablesOnLogout error:', e);
      }
    }

    await setGoogleAccessToken(null).catch(() => {});
    await setGoogleRefreshToken(null).catch(() => {});
    await scheduleDeadlineNotifications([]).catch(() => {});

    const userPrefsToClear = [
      'tracked_course_ids',
      'enrolled_courses_cache',
      'user_fullname',
      'last_synced_at',
      'onboarding_completed',
      'settings_timestamps',
      'remember_me',
    ];
    for (const key of userPrefsToClear) {
      try {
        removePreference(key);
      } catch {}
    }

    setIsAuthenticated(false);
    setHasCompletedOnboarding(false);
    setIsSyncing(false);
    setUserFullname('');
    setLastSyncedAt(null);
    setSyncError(null);
    setSessionExpired(false);
    setSyncWarnings([]);
    setSyncProgress(null);
    setSyncWindowVisible(false);
    setSyncWindowCollapsed(false);
    setTourStepState(-1);
    updateEnrolledCoursesState([]);
    updateSyncResultState(EMPTY_SYNC_RESULT);
    updateSettingsState(getLocalSettingsSnapshot());
  }, [updateEnrolledCoursesState, updateSettingsState, updateSyncResultState]);

  const startTour = useCallback(() => setTourStepState(0), []);
  const setTourStep = useCallback((step: number) => setTourStepState(step), []);
  const stopTour = useCallback(() => setTourStepState(-1), []);

  const syncProgressValue = useMemo<SyncProgressContextValue>(
    () => ({
      isSyncing,
      syncProgress,
      syncError,
      syncWarnings,
      syncWindowVisible,
      syncWindowCollapsed,
      setSyncWindowCollapsed,
      openSyncWindow,
      closeSyncWindow,
    }),
    [
      isSyncing,
      syncProgress,
      syncError,
      syncWarnings,
      syncWindowVisible,
      syncWindowCollapsed,
      openSyncWindow,
      closeSyncWindow,
    ]
  );

  const value = useMemo<AppStateContextValue>(
    () => ({
      isInitialized,
      isAuthenticated,
      hasCompletedOnboarding,
      syncResult,
      enrolledCourses,
      groupedCourses,
      isSyncing,
      syncProgress,
      lastSyncedAt,
      syncError,
      syncWarnings,
      tourActive: tourStep >= 0,
      tourStep,
      settings,
      trackedCourseIds: settings.trackedCourseIds,
      coursesColorMap: settings.coursesColorMap,
      coursesCustomNames: settings.coursesCustomNames,
      hiddenAssignments: settings.hiddenAssignments,
      completedAssignments: settings.completedAssignments,
      uncompletedAssignments: settings.uncompletedAssignments,
      hiddenZoomMeetings: settings.hiddenZoomMeetings,
      watchedRecordings: settings.watchedRecordings,
      hiddenRecordings: settings.hiddenRecordings,
      trackedPanoptoHosts: settings.trackedPanoptoHosts,
      coursesPanoptoStaff: settings.coursesPanoptoStaff,
      coursesPanoptoMap: settings.coursesPanoptoMap,
      userFullname,
      hasMockCourse: settings.trackedCourseIds.includes(MOCK_COURSE_ID),
      sessionExpired,
      clearSessionExpired,
      reconnectWithToken,
      loginWithSso,
      loginWithToken,
      fetchOnboardingCourses,
      completeOnboarding,
      triggerSync,
      toggleAssignmentDone,
      toggleAssignmentHidden,
      bulkSetCourseAssignmentsHidden,
      toggleZoomHidden,
      bulkSetCourseZoomHidden,
      toggleRecordingWatched,
      toggleRecordingHidden,
      toggleTrackedHost,
      saveCoursePanoptoStaff,
      saveCoursePanoptoFolder,
      saveCoursesConfiguration,
      updateSetting,
      refreshFromLocal,
      addMockCourse,
      removeMockCourse,
      disconnectAccount,
      startTour,
      setTourStep,
      stopTour,
    }),
    [
      isInitialized,
      isAuthenticated,
      hasCompletedOnboarding,
      syncResult,
      enrolledCourses,
      groupedCourses,
      isSyncing,
      syncProgress,
      lastSyncedAt,
      syncError,
      syncWarnings,
      tourStep,
      settings,
      userFullname,
      sessionExpired,
      clearSessionExpired,
      reconnectWithToken,
      loginWithSso,
      loginWithToken,
      fetchOnboardingCourses,
      completeOnboarding,
      triggerSync,
      toggleAssignmentDone,
      toggleAssignmentHidden,
      bulkSetCourseAssignmentsHidden,
      toggleZoomHidden,
      bulkSetCourseZoomHidden,
      toggleRecordingWatched,
      toggleRecordingHidden,
      toggleTrackedHost,
      saveCoursePanoptoStaff,
      saveCoursePanoptoFolder,
      saveCoursesConfiguration,
      updateSetting,
      refreshFromLocal,
      addMockCourse,
      removeMockCourse,
      disconnectAccount,
      startTour,
      setTourStep,
      stopTour,
    ]
  );

  return (
    <SyncProgressContext.Provider value={syncProgressValue}>
      <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
    </SyncProgressContext.Provider>
  );
}

export { SyncProgressContext };

export function useSyncProgress(): SyncProgressContextValue {
  const ctx = useContext(SyncProgressContext);
  if (!ctx) {
    throw new Error('useSyncProgress must be used within an AppStateProvider');
  }
  return ctx;
}

export function useAppState(): AppStateContextValue {
  const ctx = useContext(AppStateContext);
  if (!ctx) {
    throw new Error('useAppState must be used within an AppStateProvider');
  }
  return ctx;
}
