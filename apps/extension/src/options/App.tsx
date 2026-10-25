import browser from 'webextension-polyfill';
import { useState, useEffect, useMemo } from 'react';
import type { SyncResult, Assignment, CourseFile, ZoomMeeting } from '@tautracker/moodle-client';
import { parseTauCourseMetadata, MoodleClient, isValidIsraeliId, collapseRecurringMeetings } from '@tautracker/moodle-client';
import {
  getStoredToken,
  setStoredToken,
  getStoredSesskey,
  getTrackedCourseIds,
  setTrackedCourseIds,
  getCachedSyncResult,
  setCachedSyncResult,
  getSettings,
  setSettings,
  getMoodleCredentials,
  setMoodleCredentials,
  DEFAULT_SETTINGS,
} from '../shared/storage.js';
import type { ExtensionSettings } from '../shared/storage.js';
import {
  fetchEnrolledCoursesOnBackground,
  syncNowOnBackground,
  syncGoogleTasksOnBackground,
  loginTauSsoOnBackground,
  logoutOnBackground,
} from '../shared/messaging.js';
import { getDueTextAndClass } from '../shared/dateUtils.js';
import { translations } from '../shared/i18n';

import './App.css';
import logoImg from '../assets/logo.png';
import aboutIcon from '../assets/about.svg';
import settingsIcon from '../assets/settings.svg';
import dashboardIcon from '../assets/dashboard.svg';

interface GroupedCourses {
  semesterKey: string;
  year: string;
  semester: 'SemesterA' | 'SemesterB' | 'Yearly' | 'Other';
  label: string;
  courses: any[];
}

export function buildFileDownloadUrl(rawUrl: string, token: string | null): string {
  if (!rawUrl) return '';
  let url = rawUrl;
  if (token && !token.startsWith('web_session_')) {
    url = `${url}${url.includes('?') ? '&' : '?'}token=${token}`;
  }
  return url;
}

export function buildFileOpenUrl(rawUrl: string, token: string | null): string {
  if (!rawUrl) return '';
  try {
    const parsed = new URL(rawUrl);
    parsed.searchParams.delete('forcedownload');
    if (token && !token.startsWith('web_session_')) {
      parsed.searchParams.set('token', token);
    }
    return parsed.toString();
  } catch {
    let url = rawUrl.replace(/([?&])forcedownload=1(&|$)/g, (_m, p1, p2) => (p2 === '&' ? p1 : ''));
    if (token && !token.startsWith('web_session_')) {
      url = `${url}${url.includes('?') ? '&' : '?'}token=${token}`;
    }
    return url;
  }
}

function getInlineMimeType(fileName: string): string | null {
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  switch (ext) {
    case 'pdf':
      return 'application/pdf';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    case 'txt':
    case 'log':
    case 'py':
    case 'c':
    case 'cpp':
    case 'h':
    case 'hpp':
    case 'java':
    case 'js':
    case 'ts':
    case 'tsx':
    case 'jsx':
    case 'cs':
    case 'go':
    case 'rs':
    case 'rb':
    case 'php':
    case 'sh':
    case 'sql':
    case 'md':
    case 'csv':
    case 'yml':
    case 'yaml':
    case 'ini':
    case 'cfg':
    case 'tex':
    case 'r':
    case 'm':
      return 'text/plain;charset=utf-8';
    case 'json':
      return 'application/json;charset=utf-8';
    case 'html':
    case 'htm':
      return 'text/html;charset=utf-8';
    case 'xml':
      return 'text/xml;charset=utf-8';
    default:
      return null;
  }
}

export async function handleOpenFileInNewTab(
  e: React.MouseEvent<HTMLAnchorElement>,
  rawUrl: string,
  token: string | null,
  fileName: string
): Promise<void> {
  e.preventDefault();
  e.stopPropagation();
  const openUrl = buildFileOpenUrl(rawUrl, token);
  if (!openUrl) return;

  const inlineMime = getInlineMimeType(fileName);
  const isSubmissionFile = openUrl.includes('assignsubmission_file') || openUrl.includes('submission_files');

  // If Moodle forces attachment download (especially on submitted files) and the browser can render the file inline,
  // fetch the bytes and open a blob URL with the explicit inline MIME type in a new tab.
  if (inlineMime && (isSubmissionFile || rawUrl.includes('forcedownload=1'))) {
    try {
      const res = await fetch(openUrl, { credentials: 'include' });
      const contentType = res.headers.get('content-type') || '';
      // Only use the blob if we didn't get redirected to an HTML login page (unless the file itself is HTML)
      if (res.ok && (!contentType.includes('text/html') || inlineMime.startsWith('text/html'))) {
        const arrayBuffer = await res.arrayBuffer();
        const blob = new Blob([arrayBuffer], { type: inlineMime });
        const blobUrl = URL.createObjectURL(blob);
        await browser.tabs.create({ url: blobUrl });
        setTimeout(() => URL.revokeObjectURL(blobUrl), 5 * 60 * 1000);
        return;
      }
    } catch (err) {
      console.warn('Inline blob preview failed, falling back to direct tab open:', err);
    }
  }

  await browser.tabs.create({ url: openUrl });
}

function SyncCountdown({
  syncedAt,
  isSyncing,
  currentLang,
}: {
  syncedAt?: string;
  isSyncing: boolean;
  currentLang: 'he' | 'en';
}) {
  const [nextSyncSecs, setNextSyncSecs] = useState<number | null>(null);

  useEffect(() => {
    const updateCountdown = async () => {
      try {
        const alarm = await browser.alarms.get('periodicSync');
        const targetTime =
          alarm?.scheduledTime || (syncedAt ? new Date(syncedAt).getTime() + 5 * 60 * 1000 : null);
        if (!targetTime) {
          setNextSyncSecs(null);
          return;
        }
        const diffMs = targetTime - Date.now();
        setNextSyncSecs(diffMs > 0 ? Math.floor(diffMs / 1000) : 0);
      } catch (e) {
        setNextSyncSecs(null);
      }
    };
    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [syncedAt]);

  if (isSyncing) {
    return (
      <span style={{ fontSize: '0.85rem', background: 'rgba(255,255,255,0.1)', padding: '0.2rem 0.5rem', borderRadius: 'var(--radius-sm)' }}>
        ⏱️ {currentLang === 'he' ? 'מסנכרן...' : 'Syncing...'}
      </span>
    );
  }

  if (nextSyncSecs !== null && nextSyncSecs > 0) {
    return (
      <span style={{ fontSize: '0.85rem', background: 'rgba(255,255,255,0.1)', padding: '0.2rem 0.5rem', borderRadius: 'var(--radius-sm)' }}>
        ⏱️ {Math.floor(nextSyncSecs / 60)}:{(nextSyncSecs % 60).toString().padStart(2, '0')}
      </span>
    );
  }

  return null;
}

export function getCourseMoodleUrl(
  courseIdOrObj: number | string | { id?: number; year?: string; instanceUrl?: string },
  fallbackLink?: string
): string {
  if (typeof courseIdOrObj === 'object' && courseIdOrObj !== null) {
    if (courseIdOrObj.instanceUrl) {
      return `${courseIdOrObj.instanceUrl}/course/view.php?id=${courseIdOrObj.id ?? ''}`;
    }
    if (courseIdOrObj.year && courseIdOrObj.year !== String(new Date().getFullYear())) {
      return `https://moodle.tau.ac.il/${courseIdOrObj.year}/course/view.php?id=${courseIdOrObj.id ?? ''}`;
    }
    return `https://moodle.tau.ac.il/course/view.php?id=${courseIdOrObj.id ?? ''}`;
  }

  const courseId = Number(courseIdOrObj);
  if (fallbackLink && fallbackLink.includes('/mod/')) {
    const root = fallbackLink.split('/mod/')[0];
    return `${root}/course/view.php?id=${courseId}`;
  }
  return `https://moodle.tau.ac.il/course/view.php?id=${courseId}`;
}

function groupAndSortCourses(courses: any[], lang: 'he' | 'en'): GroupedCourses[] {
  const groups: Record<string, any[]> = {};

  courses.forEach(c => {
    const idNum = c.idnumber || c.shortname || '';
    const meta = parseTauCourseMetadata(idNum);
    const year = meta?.year || c.year || '';
    const semester = meta?.semester || c.semester || 'Other';

    const key = year ? `${year}-${semester}` : 'Other';
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(c);
  });

  const result: GroupedCourses[] = [];

  Object.keys(groups).forEach(key => {
    if (key === 'Other') {
      result.push({
        semesterKey: 'Other',
        year: '',
        semester: 'Other',
        label: lang === 'he' ? 'אחר' : 'Other',
        courses: groups[key]
      });
    } else {
      const [year, semester] = key.split('-');
      let label = '';
      if (lang === 'he') {
        const semName = semester === 'SemesterA' ? "סמסטר א'" : semester === 'SemesterB' ? "סמסטר ב'" : semester === 'Yearly' ? "שנתי" : "קורסים כלליים";
        label = `${semName} (${year})`;
      } else {
        const semName = semester === 'SemesterA' ? "Semester A" : semester === 'SemesterB' ? "Semester B" : semester === 'Yearly' ? "Yearly" : "General";
        label = `${semName} (${year})`;
      }
      result.push({
        semesterKey: key,
        year,
        semester: semester as any,
        label,
        courses: groups[key]
      });
    }
  });

  result.sort((a, b) => {
    if (a.semesterKey === 'Other') return 1;
    if (b.semesterKey === 'Other') return -1;

    const yearDiff = parseInt(b.year) - parseInt(a.year);
    if (yearDiff !== 0) return yearDiff;

    const getSemValue = (sem: string) => {
      if (sem === 'SemesterB') return 3;
      if (sem === 'SemesterA') return 2;
      if (sem === 'Yearly') return 1;
      return 0;
    };

    return getSemValue(b.semester) - getSemValue(a.semester);
  });

  return result;
}

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [trackedCourseIds, setTrackedCourseIdsState] = useState<number[]>([]);
  const [settings, setSettingsState] = useState<ExtensionSettings | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [selectedCourseId, setSelectedCourseId] = useState<number | null>(null);
  const [assignmentFilterCourseId, setAssignmentFilterCourseId] = useState<number | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [showHiddenZoomCourseIds, setShowHiddenZoomCourseIds] = useState<Set<number>>(new Set());
  const [labModalCourse, setLabModalCourse] = useState<{ id: number; name: string } | null>(null);
  const [pendingLabHideCourseIds, setPendingLabHideCourseIds] = useState<number[]>([]);

  const handleToggleShowHiddenZoom = (courseId: number) => {
    setShowHiddenZoomCourseIds((prev) => {
      const next = new Set(prev);
      if (next.has(courseId)) {
        next.delete(courseId);
      } else {
        next.add(courseId);
      }
      return next;
    });
  };

  useEffect(() => {
    browser.storage.local.get('sidebarCollapsed').then((res) => {
      if (res && res.sidebarCollapsed !== undefined) {
        setSidebarCollapsed(!!res.sidebarCollapsed);
      }
    });
  }, []);

  const toggleSidebarCollapse = async () => {
    const val = !sidebarCollapsed;
    setSidebarCollapsed(val);
    await browser.storage.local.set({ sidebarCollapsed: val });
  };

  const [signingInToMoodle, setSigningInToMoodle] = useState<boolean>(false);

  useEffect(() => {
    const handleGlobalClick = async (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const link = target.closest('a');
      if (link && link.href && link.href.includes('moodle.tau.ac.il') && link.dataset.moodleLink === 'true') {
        e.preventDefault();
        e.stopPropagation();

        setSigningInToMoodle(true);
        try {
          const allCookies = await browser.cookies.getAll({ domain: 'moodle.tau.ac.il' }).catch(() => []);
          const hasSession = allCookies.some((c) => c.name.startsWith('MoodleSession'));
          if (hasSession) {
            await browser.tabs.create({ url: link.href });
            return;
          }

          const creds = await getMoodleCredentials();
          if (creds && creds.username && creds.password) {
            try {
              await loginTauSsoOnBackground(creds.username, creds.idNumber || '', creds.password, true);
            } catch (err) {
              console.error('SSO auto-login failed', err);
            }
          }
          await browser.tabs.create({ url: link.href });
        } finally {
          setSigningInToMoodle(false);
        }
      }
    };
    document.addEventListener('click', handleGlobalClick, true);
    return () => document.removeEventListener('click', handleGlobalClick, true);
  }, []);

  // Toast and Tour States
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [showTour, setShowTour] = useState<boolean>(false);
  const [tourStep, setTourStep] = useState<number>(-1);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
  };

  useEffect(() => {
    if (toast) {
      const id = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(id);
    }
  }, [toast]);

  useEffect(() => {
    if (tourStep >= 0 && tourStep <= 5) {
      setActiveTab('dashboard');
      setSelectedCourseId(null);
    } else if (tourStep === 6) {
      setActiveTab('assignments');
      setSelectedCourseId(null);
    } else if (tourStep === 7) {
      setActiveTab('grades');
      setSelectedCourseId(null);
    } else if (tourStep === 8) {
      setActiveTab('settings');
      setSelectedCourseId(null);
    } else if (tourStep === 9) {
      setActiveTab('about');
      setSelectedCourseId(null);
    }
  }, [tourStep]);

  const handleCloseTour = async () => {
    setShowTour(false);
    setTourStep(-1);
    setActiveTab('dashboard');
    setSelectedCourseId(null);
    await browser.storage.local.set({ hasSeenTour: true });
  };

  // Onboarding States
  const [moodleUsername, setMoodleUsername] = useState<string>('');
  const [moodleId, setMoodleId] = useState<string>('');
  const [moodlePassword, setMoodlePassword] = useState<string>('');
  const [rememberMe, setRememberMe] = useState<boolean>(true);
  const [validatingToken, setValidatingToken] = useState<boolean>(false);
  const [availableCourses, setAvailableCourses] = useState<any[]>([]);
  const [onboardingStep, setOnboardingStep] = useState<number>(1); // 1 = connect moodle, 2 = select courses

  // Settings tab states
  const [googleSyncStatus, setGoogleSyncStatus] = useState<string | null>(null);
  const [googleSyncLoading, setGoogleSyncLoading] = useState<boolean>(false);
  const [hasGoogleTasksToken, setHasGoogleTasksToken] = useState<boolean>(false);
  const [googleTasksAuthError, setGoogleTasksAuthError] = useState<string | null>(null);


  // Backup and custom disconnect states
  const [showDisconnectModal, setShowDisconnectModal] = useState<boolean>(false);
  const [deletePermanently, setDeletePermanently] = useState<boolean>(false);

  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  useEffect(() => {
    browser.storage.local.get('isSyncing').then((res: any) => {
      if (res.isSyncing !== undefined) setIsSyncing(res.isSyncing);
    });
  }, []);

  useEffect(() => {
    const messageListener = (msg: any) => {
      if (msg.type === 'SYNC_START') {
        setIsSyncing(true);
      }
      if (msg.type === 'SYNC_PARTIAL') {
        if (msg.partial && typeof msg.partial === 'object') {
          setSyncResult((prev) => ({
            syncedAt: msg.partial.syncedAt || prev?.syncedAt || new Date().toISOString(),
            assignments: msg.partial.assignments ?? prev?.assignments ?? [],
            meetings: msg.partial.meetings ?? prev?.meetings ?? [],
            files: msg.partial.files ?? prev?.files ?? [],
            errors: msg.partial.errors ?? prev?.errors ?? [],
          }));
        } else {
          getCachedSyncResult().then((cached) => {
            if (cached) setSyncResult(cached);
          });
        }
      }
      if (msg.type === 'SYNC_COMPLETE') {
        setIsSyncing(false);
        setLoading(false);
        // Re-read settings/trackedCourseIds from storage in case sync applied remote changes
        Promise.all([getTrackedCourseIds(), getSettings(), getCachedSyncResult()]).then(([ids, extSettings, cached]) => {
          setTrackedCourseIdsState(ids);
          setSettingsState(extSettings);
          if (cached) setSyncResult(cached);
        });
        if (msg.result) {
          setSyncResult(msg.result);
        }
      }
    };
    browser.runtime.onMessage.addListener(messageListener);
    return () => browser.runtime.onMessage.removeListener(messageListener);
  }, []);

  useEffect(() => {
    loadData();

    const handleStorageChange = (changes: { [key: string]: any }, areaName: string) => {
      if (areaName === 'local') {
        if (changes.wstoken && changes.wstoken.newValue) {
          // If the token is identical to our current state or we are in active course selection, avoid re-running onboarding
          if (changes.wstoken.newValue !== token && onboardingStep !== 2) {
            loadData();
          }
        }
        if (changes.googleAccessToken || changes.googleTokenExpiry) {
          const hasToken = !!(changes.googleAccessToken?.newValue && (!changes.googleTokenExpiry?.newValue || changes.googleTokenExpiry.newValue > Date.now()));
          setHasGoogleTasksToken(hasToken);
        }
        if ('googleTasksAuthError' in changes) {
          setGoogleTasksAuthError(changes.googleTasksAuthError?.newValue || null);
        }
      }
    };
    browser.storage.onChanged.addListener(handleStorageChange);
    return () => browser.storage.onChanged.removeListener(handleStorageChange);
  }, [token, onboardingStep]);

  useEffect(() => {
    if (settings?.theme) {
      document.body.className = `theme-${settings.theme}`;
    } else {
      document.body.className = 'theme-noodle';
    }
  }, [settings]);

  useEffect(() => {
    if (token && trackedCourseIds && trackedCourseIds.length > 0 && settings) {
      getMoodleCredentials().then((creds) => {
        const backup: any = {
          version: "TauTrackerConfig-v1",
          trackedCourseIds: trackedCourseIds,
          settings: settings
        };
        if (creds) {
          backup.wstoken = token;
        }
        browser.storage.local.set({ config_backup: backup });
      });
    }
  }, [token, trackedCourseIds, settings]);

  const assignmentsList = useMemo(() => {
    const rawAssignments = syncResult?.assignments || [];
    const completedSet = new Set(settings?.completedAssignments || []);
    const uncompletedSet = new Set(settings?.uncompletedAssignments || []);
    return rawAssignments.map((a) => {
      const isMoodleSubmitted = a.status === 'Submitted';
      const isManuallyCompleted = completedSet.has(a.id);
      const isManuallyToDo = uncompletedSet.has(a.id);

      let isCompleted = isMoodleSubmitted;
      if (isMoodleSubmitted && isManuallyToDo) {
        isCompleted = false;
      } else if (!isMoodleSubmitted && isManuallyCompleted) {
        isCompleted = true;
      }

      return {
        ...a,
        isMoodleSubmitted,
        isCompleted,
        status: (isCompleted ? 'Submitted' : (isMoodleSubmitted ? 'Assigned' : a.status)) as 'Assigned' | 'Submitted' | 'Not submitted',
      };
    });
  }, [syncResult?.assignments, settings?.completedAssignments, settings?.uncompletedAssignments]);

  async function loadData() {
    setLoading(true);
    try {
      const storedToken = await getStoredToken();
      const ids = await getTrackedCourseIds();
      const extensionSettings = await getSettings();

      // Load cached enrolled courses if available
      const cachedCoursesRes = (await browser.storage.local.get('enrolledCoursesCache')) as { enrolledCoursesCache?: any[] };
      if (cachedCoursesRes.enrolledCoursesCache) {
        setAvailableCourses(cachedCoursesRes.enrolledCoursesCache);
      }

      // Prefill credentials if they exist
      const credentials = await getMoodleCredentials();
      if (credentials) {
        if (credentials.username) setMoodleUsername(credentials.username);
        if (credentials.idNumber) setMoodleId(credentials.idNumber);
      }

      const tourSeenRes = await browser.storage.local.get('hasSeenTour');
      const googleAuthRes = (await browser.storage.local.get([
        'googleAccessToken',
        'googleTokenExpiry',
        'googleTasksAuthError',
      ])) as {
        googleAccessToken?: string;
        googleTokenExpiry?: number;
        googleTasksAuthError?: string | null;
      };
      const isGoogleAuth = !!(googleAuthRes.googleAccessToken && (!googleAuthRes.googleTokenExpiry || googleAuthRes.googleTokenExpiry > Date.now()));
      setHasGoogleTasksToken(isGoogleAuth);
      setGoogleTasksAuthError(googleAuthRes.googleTasksAuthError || null);

      setToken(storedToken);
      setTrackedCourseIdsState(ids);
      setSettingsState(extensionSettings);

      const cached = await getCachedSyncResult();
      setSyncResult(cached);

      if (storedToken && ids.length > 0) {
        setOnboardingStep(3); // Fully set up
        fetchEnrolledCoursesInBackground(storedToken);
        if (!tourSeenRes.hasSeenTour) {
          setShowTour(true);
          setTourStep(0);
        }
      } else if (storedToken) {
        if (cachedCoursesRes.enrolledCoursesCache && cachedCoursesRes.enrolledCoursesCache.length > 0) {
          setOnboardingStep((prev) => (prev === 3 ? 3 : 2));
        }
        // Token exists but courses might not be tracked yet — try to restore from Moodle
        restoreMoodleSettingsForOnboarding(storedToken);
      } else {
        setOnboardingStep(1);
      }
    } catch (e) {
      console.error('Error loading extension data:', e);
    } finally {
      setLoading(false);
    }
  }

  async function handleMoodleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!moodleUsername || !moodleId || !moodlePassword) return;

    if (!isValidIsraeliId(moodleId)) {
      showToast(currentLang === 'he' ? 'מספר תעודת זהות לא תקין' : 'Invalid Israeli ID', 'error');
      return;
    }

    setLoading(true);
    try {
      const res = await loginTauSsoOnBackground(moodleUsername, moodleId, moodlePassword);
      if (!res?.success || !res.token) {
        throw new Error(res?.error || 'Failed to generate token from SSO');
      }
      const fetchedToken = res.token;
      await setStoredToken(fetchedToken);
      if (rememberMe) {
        await setMoodleCredentials({ username: moodleUsername, idNumber: moodleId, password: moodlePassword });
      } else {
        await setMoodleCredentials(null);
      }
      setToken(fetchedToken);
      await restoreMoodleSettingsForOnboarding(fetchedToken);
    } catch (err: any) {
      showToast(`Login failed: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function fetchEnrolledCoursesInBackground(t: string) {
    try {
      const res = await fetchEnrolledCoursesOnBackground(t);
      if (res?.success && res.courses) {
        setAvailableCourses(res.courses);
        await browser.storage.local.set({ enrolledCoursesCache: res.courses });
      }
    } catch (e) {
      console.warn('Failed to background fetch enrolled courses:', e);
    }
  }

  async function restoreMoodleSettingsForOnboarding(t: string) {
    if (validatingToken) return;
    setValidatingToken(true);
    try {
      const sesskey = await getStoredSesskey();
      const client = new MoodleClient(t, undefined, {
        sesskey: sesskey || undefined,
        devMode: true,
        enableScraping: settings?.scrapingEnabled ?? false
      });
      const remoteSettings = await client.loadNoodleSettings();
      if (remoteSettings && Object.keys(remoteSettings).length > 0) {
        // We found existing remote settings, apply them directly!
        const updatedSettings = { ...settings } as ExtensionSettings;
        let foundTrackedCourses = false;

        for (const [key, trackedVal] of Object.entries(remoteSettings)) {
          if (trackedVal && typeof trackedVal === 'object' && 'value' in trackedVal) {
            if (key === 'trackedCourseIds') {
              foundTrackedCourses = true;
              const idsArray = Array.isArray(trackedVal.value) ? trackedVal.value : [];
              const ids = idsArray.map(Number);
              setTrackedCourseIdsState(ids);
              await setTrackedCourseIds(ids, true);
            } else if (key === 'googleTasksEnabled' || key === 'googleClientId') {
              // Keep local Google Tasks toggle if already enabled locally
              if (key === 'googleTasksEnabled' && updatedSettings.googleTasksEnabled) continue;
              (updatedSettings as any)[key] = trackedVal.value;
            } else {
              (updatedSettings as any)[key] = trackedVal.value;
            }
          }
        }

        setSettingsState(updatedSettings);
        await setSettings(updatedSettings, true);

        // Persist the remote timestamps so future syncs don't think local is newer
        const remoteTimestamps: Record<string, number> = {};
        for (const [key, trackedVal] of Object.entries(remoteSettings)) {
          if (trackedVal && typeof trackedVal === 'object' && 'updatedAt' in trackedVal) {
            remoteTimestamps[key] = (trackedVal as any).updatedAt;
          }
        }
        await browser.storage.sync.set({ settings_timestamps: remoteTimestamps });

        if (foundTrackedCourses) {
          // Successfully restored, jump straight to dashboard
          setOnboardingStep(3);

          // Also fetch their courses in background so they have names immediately
          fetchEnrolledCoursesInBackground(t);

          // Run initial sync
          const res = await syncNowOnBackground();
          if (res?.success && res.result) {
            setSyncResult(res.result);
          }
          return; // Skip normal onboarding
        }
      }

      // If no remote settings found, or no tracked courses, proceed to normal onboarding step 2
      await fetchEnrolledCoursesForOnboarding(t);
    } catch (e) {
      console.error('[Onboarding] Error restoring settings:', e);
      await fetchEnrolledCoursesForOnboarding(t); // Fallback
    } finally {
      setValidatingToken(false);
    }
  }

  async function fetchEnrolledCoursesForOnboarding(t: string) {
    setValidatingToken(true);
    try {
      const res = await fetchEnrolledCoursesOnBackground(t);
      console.log('[Onboarding] fetchEnrolledCoursesOnBackground response:', res);
      if (res?.success && res.courses && res.courses.length > 0) {
        setAvailableCourses(res.courses);
        await browser.storage.local.set({ enrolledCoursesCache: res.courses });
        setOnboardingStep((prev) => (prev === 3 ? 3 : 2));
      } else if (res?.success && res.courses && res.courses.length === 0) {
        console.warn('[Onboarding] Enrolled courses array is empty');
        showToast(currentLang === 'he' ? 'לא נמצאו קורסים מקושרים לחשבון' : 'No enrolled courses found for account', 'info');
        setAvailableCourses([]);
        setOnboardingStep((prev) => (prev === 3 ? 3 : 2));
      } else {
        const isAuthError = res?.errorcode === 'AUTH_SESSION_EXPIRED' || res?.errorcode === 'invalidtoken';
        setOnboardingStep((prev) => {
          if (availableCourses.length > 0 || prev === 2) {
            if (isAuthError) {
              showToast(res?.error || 'Session expired. Please log in again.', 'error');
              return 1;
            }
            console.warn('[Onboarding] Background fetch reported error but courses already present:', res?.error);
            return prev;
          } else {
            showToast(res?.error || 'Failed to fetch enrolled courses.', 'error');
            return 1; // Fallback to login if we can't load courses initially
          }
        });
      }
    } catch (e: any) {
      const isAuthError = e?.errorcode === 'AUTH_SESSION_EXPIRED' || e?.errorcode === 'invalidtoken';
      setOnboardingStep((prev) => {
        if (availableCourses.length > 0 || prev === 2) {
          if (isAuthError) {
            showToast(e?.message || 'Session expired. Please log in again.', 'error');
            return 1;
          }
          console.warn('[Onboarding] Background fetch exception but courses already present:', e?.message || e);
          return prev;
        } else {
          showToast(e?.message || 'Failed to fetch enrolled courses', 'error');
          return 1;
        }
      });
    } finally {
      setValidatingToken(false);
    }
  }



  async function handleConfirmHideLabAssignments(courseId: number) {
    setPendingLabHideCourseIds((prev) => Array.from(new Set([...prev, courseId])));
    if (syncResult?.assignments) {
      const courseAssignIds = syncResult.assignments
        .filter((a) => a.courseId === courseId)
        .map((a) => a.id);
      if (courseAssignIds.length > 0 && settings) {
        const currentHidden = new Set(settings.hiddenAssignments || []);
        courseAssignIds.forEach((id) => currentHidden.add(id));
        const updated = { ...settings, hiddenAssignments: Array.from(currentHidden) };
        setSettingsState(updated);
        await setSettings(updated);
        if (updated.googleTasksEnabled) {
          syncGoogleTasksOnBackground(false).catch(() => {});
        }
      }
    }
    showToast(t('lab_assignments_hidden_toast'), 'success');
  }

  async function handleOnboardingCourseToggle(courseId: number) {
    if (trackedCourseIds.includes(courseId)) {
      setTrackedCourseIdsState(trackedCourseIds.filter((id) => id !== courseId));
    } else {
      setTrackedCourseIdsState([...trackedCourseIds, courseId]);
      const course = availableCourses.find((c) => c.id === courseId);
      if (course && ((course.fullname && course.fullname.includes('מעבדה')) || (course.shortname && course.shortname.includes('מעבדה')))) {
        setLabModalCourse({
          id: courseId,
          name: course.fullname || course.shortname || `Course ${courseId}`,
        });
      }
    }
  }

  async function handleSaveOnboardingCourses() {
    setLoading(true);
    try {
      await setTrackedCourseIds(trackedCourseIds);
      setOnboardingStep(3);
      // Run initial sync
      const res = await syncNowOnBackground();
      if (res?.success && res.result) {
        setSyncResult(res.result);
        if (pendingLabHideCourseIds.length > 0 && settings) {
          const assignsToHide = res.result.assignments
            .filter((a) => pendingLabHideCourseIds.includes(a.courseId))
            .map((a) => a.id);
          if (assignsToHide.length > 0) {
            const currentHidden = new Set(settings.hiddenAssignments || []);
            assignsToHide.forEach((id) => currentHidden.add(id));
            const updated = { ...settings, hiddenAssignments: Array.from(currentHidden) };
            setSettingsState(updated);
            await setSettings(updated);
          }
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleManualSync() {
    setLoading(true);
    try {
      const res = await syncNowOnBackground();
      if (res?.success && res.result) {
        setSyncResult(res.result);
        if (settings?.googleTasksEnabled && (res.result as any).googleSyncError) {
          showToast(t('google_tasks_auth_warning_title'), 'error');
          setGoogleTasksAuthError((res.result as any).googleSyncError);
        }
      } else if (res && !res.success) {
        showToast(`Sync failed: ${res.error}`, 'error');
      }
    } catch (e: any) {
      showToast(`Sync failed: ${e.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleDisconnectClick() {
    setDeletePermanently(false);
    setShowDisconnectModal(true);
  }

  async function confirmDisconnect() {
    setLoading(true);
    setShowDisconnectModal(false);
    try {
      // clearUserSession() in the service worker handles:
      //   • Clearing all TAU/Moodle SSO cookies (so next login is always a fresh challenge)
      //   • Removing wstoken, moodleCredentials, cachedSyncResult, enrolledCoursesCache,
      //     googleAccessToken, googleTokenExpiry, and all notified_* keys from local storage
      //   • Removing trackedCourseIds from sync storage
      await logoutOnBackground();

      // Handle config_backup separately (UI-layer concern not owned by the service worker)
      if (deletePermanently) {
        await browser.storage.local.remove('config_backup');
      } else {
        // Strip the token from the backup so restoring it later doesn't auto-login
        const backupRes = (await browser.storage.local.get('config_backup')) as { config_backup?: any };
        if (backupRes.config_backup) {
          const updatedBackup = { ...backupRes.config_backup };
          delete updatedBackup.wstoken;
          await browser.storage.local.set({ config_backup: updatedBackup });
        }
      }

      // Reset ALL user-specific React state so the UI reflects a clean slate immediately
      setToken(null);
      setTrackedCourseIdsState([]);
      setSyncResult(null);
      setAvailableCourses([]);
      setMoodleUsername('');
      setMoodleId('');
      setMoodlePassword('');
      setOnboardingStep(1);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  function handleExportConfig() {
    if (!token || !settings) {
      showToast('No configuration found to export.', 'error');
      return;
    }
    const config = {
      version: "TauTrackerConfig-v1",
      trackedCourseIds: trackedCourseIds,
      settings: settings,
      zoomLinks: settings.interestedMeetings || []
    };
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tau_tracker_config_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportConfig(file: File) {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = e.target?.result as string;
        const data = JSON.parse(text);
        if (data.version !== "TauTrackerConfig-v1" || !data.trackedCourseIds || !data.settings) {
          throw new Error('Invalid file format');
        }

        setLoading(true);
        // We do NOT overwrite the wstoken during manual config import since the user is already signed in.
        await setTrackedCourseIds(data.trackedCourseIds);

        if (data.zoomLinks && Array.isArray(data.zoomLinks)) {
          data.settings.interestedMeetings = Array.from(new Set([
            ...(data.settings.interestedMeetings || []),
            ...data.zoomLinks
          ]));
        }

        await setSettings(data.settings);

        setTrackedCourseIdsState(data.trackedCourseIds);
        setSettingsState(data.settings);

        const syncRes = await syncNowOnBackground();
        if (syncRes && syncRes.success && syncRes.result) {
          setSyncResult(syncRes.result);
        }

        showToast(t('import_success'), 'success');
        loadData();
      } catch (err: any) {
        showToast(`${t('import_failed')}: ${err.message}`, 'error');
      } finally {
        setLoading(false);
      }
    };
    reader.readAsText(file);
  }
  async function handleToggleGoogleTasks(enabled: boolean) {
    if (!settings) return;
    const updated = { ...settings, googleTasksEnabled: enabled };
    setSettingsState(updated);
    await setSettings({ googleTasksEnabled: enabled });
    if (enabled) {
      handleSyncGoogleTasks();
    }
  }

  async function handleUpdateGoogleListName(name: string) {
    if (!settings) return;
    const updated = { ...settings, googleTasksListName: name };
    setSettingsState(updated);
    await setSettings(updated);
  }

  async function handleToggleMeetingInterest(targetMeetingKey: string, allMeetingKeys: string[]) {
    if (!settings) return;
    let currentInterested = settings.interestedMeetings || [];
    if (currentInterested.length === 0) {
      const allSystemMeetings = syncResult?.meetings || [];
      const allSystemKeys = allSystemMeetings.map((m) => `${m.courseName}:${m.meetingNumber || ''}${m.title}`);
      currentInterested = Array.from(new Set(allSystemKeys.length > 0 ? allSystemKeys : allMeetingKeys));
    }
    let updatedInterested: string[];
    if (currentInterested.includes(targetMeetingKey)) {
      updatedInterested = currentInterested.filter((key) => key !== targetMeetingKey);
    } else {
      updatedInterested = [...currentInterested, targetMeetingKey];
    }
    const updated = { ...settings, interestedMeetings: updatedInterested };
    setSettingsState(updated);
    await setSettings(updated);
  }

  async function handleSetCourseMeetingsVisibility(courseMeetings: ZoomMeeting[], makeVisible: boolean) {
    if (!settings) return;
    const courseKeys = courseMeetings.map((m) => `${m.courseName}:${m.meetingNumber || ''}${m.title}`);
    let currentInterested = settings.interestedMeetings || [];

    if (currentInterested.length === 0) {
      const allSystemMeetings = syncResult?.meetings || [];
      currentInterested = Array.from(new Set(allSystemMeetings.map((m) => `${m.courseName}:${m.meetingNumber || ''}${m.title}`)));
    }

    let updatedInterested: string[];
    if (makeVisible) {
      updatedInterested = Array.from(new Set([...currentInterested, ...courseKeys]));
    } else {
      const courseKeySet = new Set(courseKeys);
      updatedInterested = currentInterested.filter((key) => !courseKeySet.has(key));
    }

    const updated = { ...settings, interestedMeetings: updatedInterested };
    setSettingsState(updated);
    await setSettings(updated);
  }



  async function handleSyncGoogleTasks() {
    setGoogleSyncLoading(true);
    setGoogleSyncStatus('Connecting to Google...');
    try {
      const res = await syncGoogleTasksOnBackground(true); // Interactive login allowed
      if (res.success) {
        setGoogleSyncStatus(res.status || 'Tasks synchronized successfully.');
        setGoogleTasksAuthError(null);
        setHasGoogleTasksToken(true);
        showToast(t('google_tasks_status_connected'), 'success');
      } else {
        const errMsg = res.error || 'Authentication failed';
        setGoogleSyncStatus(`Google Sync failed: ${errMsg}`);
        setGoogleTasksAuthError(errMsg);
        showToast(`Google Sync failed: ${errMsg}`, 'error');
      }
    } catch (e: any) {
      const errMsg = e?.message || String(e);
      setGoogleSyncStatus(`Google Sync failed: ${errMsg}`);
      setGoogleTasksAuthError(errMsg);
      showToast(`Google Sync failed: ${errMsg}`, 'error');
    } finally {
      setGoogleSyncLoading(false);
      setTimeout(() => setGoogleSyncStatus(null), 8000);
    }
  }

  // Course customization helpers
  async function handleUpdateCourseColor(courseId: number, color: string) {
    if (!settings) return;
    const updatedMap = { ...settings.coursesColorMap, [courseId]: color };
    const updated = { ...settings, coursesColorMap: updatedMap };
    setSettingsState(updated);
    await setSettings(updated);
  }

  async function handleUpdateCourseCustomName(courseId: number, customName: string) {
    if (!settings) return;
    const updatedMap = { ...settings.coursesCustomNames, [courseId]: customName };
    const updated = { ...settings, coursesCustomNames: updatedMap };
    setSettingsState(updated);
    await setSettings(updated);
  }

  async function handleToggleCompleted(assignmentId: number) {
    if (!settings) return;
    const rawAssignments = syncResult?.assignments || [];
    const assign = rawAssignments.find(x => x.id === assignmentId);
    const isMoodleSubmitted = assign ? assign.status === 'Submitted' : false;

    const currentCompleted = settings.completedAssignments || [];
    const currentUncompleted = settings.uncompletedAssignments || [];

    let updatedCompleted = [...currentCompleted];
    let updatedUncompleted = [...currentUncompleted];

    if (isMoodleSubmitted) {
      if (currentUncompleted.includes(assignmentId)) {
        updatedUncompleted = currentUncompleted.filter(id => id !== assignmentId);
      } else {
        updatedUncompleted.push(assignmentId);
      }
    } else {
      if (currentCompleted.includes(assignmentId)) {
        updatedCompleted = currentCompleted.filter(id => id !== assignmentId);
      } else {
        updatedCompleted.push(assignmentId);
      }
    }

    const updated = {
      ...settings,
      completedAssignments: updatedCompleted,
      uncompletedAssignments: updatedUncompleted,
    };
    setSettingsState(updated);
    await setSettings(updated);
    if (updated.googleTasksEnabled) {
      syncGoogleTasksOnBackground(false).catch(() => {});
    }
  }

  async function handleToggleHidden(assignmentId: number) {
    if (!settings) return;
    const currentHidden = settings.hiddenAssignments || [];
    let updatedHidden;
    if (currentHidden.includes(assignmentId)) {
      updatedHidden = currentHidden.filter(id => id !== assignmentId);
    } else {
      updatedHidden = [...currentHidden, assignmentId];
    }
    const updated = { ...settings, hiddenAssignments: updatedHidden };
    setSettingsState(updated);
    await setSettings(updated);
    if (updated.googleTasksEnabled) {
      syncGoogleTasksOnBackground(false).catch(() => {});
    }
  }

  async function handleToggleHideAllCourse(courseAssignIds: number[], shouldHideAll: boolean) {
    if (!settings) return;
    const currentHidden = new Set(settings.hiddenAssignments || []);
    if (shouldHideAll) {
      courseAssignIds.forEach((id) => currentHidden.add(id));
    } else {
      courseAssignIds.forEach((id) => currentHidden.delete(id));
    }
    const updated = { ...settings, hiddenAssignments: Array.from(currentHidden) };
    setSettingsState(updated);
    await setSettings(updated);
    if (updated.googleTasksEnabled) {
      syncGoogleTasksOnBackground(false).catch(() => {});
    }
  }

  async function handleAddMockCourse() {
    const mockCourseId = 9999;
    const mockCourseName = '0368-2161 מבני נתונים (קורס לדוגמה)';
    const mockColor = '#8b5cf6';
    const mockCustomName = 'מבני נתונים 📚';
    const nowTime = Date.now();

    const mockMeetings: ZoomMeeting[] = [
      {
        courseId: mockCourseId,
        courseName: mockCourseName,
        title: "הרצאה שבועית - פרופ' כהן (פעיל עכשיו)",
        startTime: new Date(nowTime - 15 * 60 * 1000).toISOString(),
        meetingUrl: 'https://tau-ac-il.zoom.us/j/9999001',
        meetingNumber: '9999001',
        sectionName: 'כללי',
      },
      {
        courseId: mockCourseId,
        courseName: mockCourseName,
        title: 'תרגול 4 - עצים בינאריים ו-AVL',
        startTime: new Date(nowTime + 24 * 60 * 60 * 1000).toISOString(),
        meetingUrl: 'https://tau-ac-il.zoom.us/j/9999002',
        meetingNumber: '9999002',
        sectionName: 'שבוע 4: עצים מאוזנים',
      },
      {
        courseId: mockCourseId,
        courseName: mockCourseName,
        title: 'שעת קבלה - מתרגל דני',
        startTime: new Date(nowTime + 5 * 24 * 60 * 60 * 1000).toISOString(),
        meetingUrl: 'https://tau-ac-il.zoom.us/j/9999003',
        meetingNumber: '9999003',
        sectionName: 'כללי',
      },
    ];

    const mockAssignments: Assignment[] = [
      {
        id: 999901,
        cmid: 999901,
        courseId: mockCourseId,
        courseName: mockCourseName,
        name: 'מטלה 3: עצי AVL וטבלאות גיבוב',
        sectionName: 'שבוע 4: עצים מאוזנים',
        deadline: new Date(nowTime + 2 * 24 * 3600 * 1000).toISOString(),
        opened: new Date(nowTime - 7 * 24 * 3600 * 1000).toISOString(),
        status: 'Assigned',
        grade: null,
        gradeMax: 100,
        link: 'https://moodle.tau.ac.il/mod/assign/view.php?id=999901',
        attachments: [
          { name: 'hw3_avl_trees.pdf', url: 'https://moodle.tau.ac.il/sample_hw3.pdf' },
          { name: 'template.zip', url: 'https://moodle.tau.ac.il/template.zip' },
        ],
        submittedFiles: [],
      },
      {
        id: 999902,
        cmid: 999902,
        courseId: mockCourseId,
        courseName: mockCourseName,
        name: 'מטלה 4: גרפים וחיפוש לעומק/לרוחב',
        sectionName: 'שבוע 5: אלגוריתמי גרפים',
        deadline: new Date(nowTime + 9 * 24 * 3600 * 1000).toISOString(),
        opened: new Date(nowTime - 3 * 24 * 3600 * 1000).toISOString(),
        status: 'Assigned',
        grade: null,
        gradeMax: 100,
        link: 'https://moodle.tau.ac.il/mod/assign/view.php?id=999902',
        attachments: [
          { name: 'hw4_graphs.pdf', url: 'https://moodle.tau.ac.il/hw4.pdf' },
        ],
        submittedFiles: [],
      },
      {
        id: 999903,
        cmid: 999903,
        courseId: mockCourseId,
        courseName: mockCourseName,
        name: 'פרויקט אמצע סמסטר: מימוש מנוע חיפוש פנימי',
        sectionName: 'פרויקט סמסטריאלי',
        deadline: null,
        opened: new Date(nowTime - 14 * 24 * 3600 * 1000).toISOString(),
        status: 'Assigned',
        grade: null,
        gradeMax: 100,
        link: 'https://moodle.tau.ac.il/mod/assign/view.php?id=999903',
        attachments: [
          { name: 'project_spec.pdf', url: 'https://moodle.tau.ac.il/project_spec.pdf' },
        ],
        submittedFiles: [],
      },
      {
        id: 999904,
        cmid: 999904,
        courseId: mockCourseId,
        courseName: mockCourseName,
        name: 'מטלה 2: תורים וערימות בינאריות',
        sectionName: 'שבוע 3: ערימות',
        deadline: new Date(nowTime - 3 * 24 * 3600 * 1000).toISOString(),
        opened: new Date(nowTime - 17 * 24 * 3600 * 1000).toISOString(),
        status: 'Submitted',
        grade: 96,
        gradeMax: 100,
        link: 'https://moodle.tau.ac.il/mod/assign/view.php?id=999904',
        attachments: [
          { name: 'hw2_heaps.pdf', url: 'https://moodle.tau.ac.il/hw2_heaps.pdf' },
        ],
        submittedFiles: [
          { name: 'solution_312345678.pdf', url: 'https://moodle.tau.ac.il/submission_2.pdf' },
          { name: 'code.py', url: 'https://moodle.tau.ac.il/code.py' },
        ],
      },
      {
        id: 999905,
        cmid: 999905,
        courseId: mockCourseId,
        courseName: mockCourseName,
        name: 'מטלה 1: ניתוח סיבוכיות ואסימפטוטיקה',
        sectionName: 'שבוע 1: מבוא',
        deadline: new Date(nowTime - 14 * 24 * 3600 * 1000).toISOString(),
        opened: new Date(nowTime - 28 * 24 * 3600 * 1000).toISOString(),
        status: 'Assigned',
        grade: null,
        gradeMax: 100,
        link: 'https://moodle.tau.ac.il/mod/assign/view.php?id=999905',
        attachments: [],
        submittedFiles: [],
      },
    ];

    const mockFiles: CourseFile[] = [
      {
        fileName: 'lecture4_avl_trees_slides.pdf',
        fileUrl: 'https://moodle.tau.ac.il/lecture4_slides.pdf',
        fileSize: 2400000,
        mimeType: 'application/pdf',
        sectionName: 'שבוע 4: עצים מאוזנים',
        timeModified: Math.floor(nowTime / 1000),
        courseId: mockCourseId,
        courseName: mockCourseName,
      },
      {
        fileName: 'tutorial4_avl_rotations.pdf',
        fileUrl: 'https://moodle.tau.ac.il/tutorial4.pdf',
        fileSize: 1100000,
        mimeType: 'application/pdf',
        sectionName: 'שבוע 4: עצים מאוזנים',
        timeModified: Math.floor(nowTime / 1000),
        courseId: mockCourseId,
        courseName: mockCourseName,
      },
      {
        fileName: 'graphs_bfs_dfs_notes.pdf',
        fileUrl: 'https://moodle.tau.ac.il/graphs.pdf',
        fileSize: 3500000,
        mimeType: 'application/pdf',
        sectionName: 'שבוע 5: אלגוריתמי גרפים',
        timeModified: Math.floor(nowTime / 1000),
        courseId: mockCourseId,
        courseName: mockCourseName,
      },
      {
        fileName: 'syllabus_2026.pdf',
        fileUrl: 'https://moodle.tau.ac.il/syllabus.pdf',
        fileSize: 520000,
        mimeType: 'application/pdf',
        sectionName: 'סילבוס וחומר עזר',
        timeModified: Math.floor(nowTime / 1000),
        courseId: mockCourseId,
        courseName: mockCourseName,
      },
    ];

    const newTracked = Array.from(new Set([...trackedCourseIds, mockCourseId]));
    setTrackedCourseIdsState(newTracked);
    await setTrackedCourseIds(newTracked, true);

    const updatedSettings = {
      ...(settings || DEFAULT_SETTINGS),
      coursesColorMap: { ...(settings?.coursesColorMap || {}), [mockCourseId]: mockColor },
      coursesCustomNames: { ...(settings?.coursesCustomNames || {}), [mockCourseId]: mockCustomName },
    };
    setSettingsState(updatedSettings);
    await setSettings(updatedSettings);

    const existingAssigns = (syncResult?.assignments || []).filter((a) => a.courseId !== mockCourseId);
    const existingMeetings = (syncResult?.meetings || []).filter((m) => m.courseId !== mockCourseId);
    const existingFiles = (syncResult?.files || []).filter((f) => f.courseId !== mockCourseId);

    const newSyncResult: SyncResult = {
      syncedAt: new Date().toISOString(),
      assignments: [...mockAssignments, ...existingAssigns],
      meetings: [...mockMeetings, ...existingMeetings],
      files: [...mockFiles, ...existingFiles],
      errors: syncResult?.errors || [],
    };
    setSyncResult(newSyncResult);
    await setCachedSyncResult(newSyncResult);

    showToast(t('mock_course_added'), 'success');
  }

  const getCourseColor = (courseId: number) => {
    return settings?.coursesColorMap[courseId] || '#e07a5f';
  };

  const getCourseDisplayName = (courseId: number, defaultName: string) => {
    return settings?.coursesCustomNames[courseId] || defaultName;
  };

  const currentLang = settings?.language || 'he';
  const t = (key: keyof typeof translations['en']) => {
    return translations[currentLang]?.[key] || translations['en']?.[key] || key;
  };

  if (loading && onboardingStep === 1) {
    return (
      <div className="center-container" dir={currentLang === 'he' ? 'rtl' : 'ltr'}>
        <div className="spinner"></div>
        <p style={{ marginTop: '1rem', color: 'var(--text-secondary)' }}>Loading Noodle...</p>
      </div>
    );
  }

  if (onboardingStep === 1) {
    return (
      <div className="onboarding-container" dir={currentLang === 'he' ? 'rtl' : 'ltr'}>
        <div className="onboarding-card glass-panel" style={{ position: 'relative' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem', position: 'absolute', top: '1rem', right: currentLang === 'he' ? 'auto' : '1rem', left: currentLang === 'he' ? '1rem' : 'auto' }}>
            <select
              value={currentLang}
              onChange={async (e) => {
                const newLang = e.target.value as 'he' | 'en';
                const updated = { ...(settings || DEFAULT_SETTINGS), language: newLang };
                setSettingsState(updated);
                await setSettings(updated);
              }}
              className="settings-select"
              style={{
                padding: '0.3rem 0.6rem',
                fontSize: '0.85rem',
                background: 'rgba(0,0,0,0.4)',
                color: 'white',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer'
              }}
            >
              <option value="he" style={{ background: '#1e1b18', color: 'white' }}>עברית</option>
              <option value="en" style={{ background: '#1e1b18', color: 'white' }}>English</option>
            </select>
          </div>

          <div className="logo-section">
            <img src={logoImg} alt="Noodle Logo" className="logo-image-large" />
            <h1>Noodle</h1>
            <p className="subtitle">{t('moodle_credentials_title')}</p>
          </div>

          <div className="form-section" style={{ textAlign: 'center', marginTop: '2rem' }}>
            <form onSubmit={handleMoodleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'center', maxWidth: '300px', margin: '0 auto' }}>
              <p style={{ marginBottom: '1rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                {t('moodle_credentials_desc')}
              </p>
              <input
                type="text"
                placeholder={t('username_placeholder')}
                value={moodleUsername}
                onChange={(e) => setMoodleUsername(e.target.value)}
                className="noodle-input"
                style={{ width: '100%' }}
                required
              />
              <input
                type="text"
                placeholder={t('id_placeholder')}
                value={moodleId}
                onChange={(e) => setMoodleId(e.target.value)}
                className="noodle-input"
                style={{ width: '100%' }}
                required
              />
              <input
                type="password"
                placeholder={t('password_placeholder')}
                value={moodlePassword}
                onChange={(e) => setMoodlePassword(e.target.value)}
                className="noodle-input"
                style={{ width: '100%' }}
                required
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', justifyContent: 'flex-start', margin: '0.2rem 0' }}>
                <input
                  type="checkbox"
                  id="remember-me"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  style={{ cursor: 'pointer' }}
                />
                <label htmlFor="remember-me" style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', cursor: 'pointer', userSelect: 'none' }}>
                  {t('remember_me')}
                </label>
              </div>
              <button
                type="submit"
                className="primary-btn"
                style={{ padding: '0.8rem 1.5rem', fontSize: '1.1rem', width: '100%' }}
                disabled={loading}
              >
                {loading ? t('connecting') : t('connect_to_moodle')}
              </button>
            </form>
          </div>
        </div>
        {signingInToMoodle && (
        <div className="noodle-toast toast-info" dir={currentLang === 'he' ? 'rtl' : 'ltr'} style={{ zIndex: 100001 }}>
          <span className="toast-message" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.55rem' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="spinning-sync-icon">
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            <span>{t('signing_in_to_moodle')}</span>
          </span>
        </div>
      )}

      {toast && (
          <div className={`noodle-toast toast-${toast.type}`} dir={currentLang === 'he' ? 'rtl' : 'ltr'}>
            <span className="toast-message">{toast.message}</span>
            <button className="toast-close" onClick={() => setToast(null)}>×</button>
          </div>
        )}
      </div>
    );
  }

  // Onboarding Step 2: Course Selection
  if (onboardingStep === 2) {
    return (
      <div className="onboarding-container" dir={currentLang === 'he' ? 'rtl' : 'ltr'}>
        <div className="onboarding-card glass-panel wide-card" style={{ position: 'relative' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem', position: 'absolute', top: '1rem', right: currentLang === 'he' ? 'auto' : '1rem', left: currentLang === 'he' ? '1rem' : 'auto' }}>
            <select
              value={currentLang}
              onChange={async (e) => {
                const newLang = e.target.value as 'he' | 'en';
                const updated = { ...(settings || DEFAULT_SETTINGS), language: newLang };
                setSettingsState(updated);
                await setSettings(updated);
              }}
              className="settings-select"
              style={{
                padding: '0.3rem 0.6rem',
                fontSize: '0.85rem',
                background: 'rgba(0,0,0,0.4)',
                color: 'white',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer'
              }}
            >
              <option value="he" style={{ background: '#1e1b18', color: 'white' }}>עברית</option>
              <option value="en" style={{ background: '#1e1b18', color: 'white' }}>English</option>
            </select>
          </div>
          <h2>{t('select_courses_title')}</h2>
          <p className="subtitle" style={{ marginBottom: '1.5rem' }}>
            {t('select_courses_desc')}
          </p>

          {validatingToken ? (
            <div className="center-container">
              <div className="spinner"></div>
              <p>{t('fetching_courses')}</p>
            </div>
          ) : (
            <>
              <div className="courses-grid-selection-grouped" style={{ width: '100%', maxHeight: '450px', overflowY: 'auto', paddingRight: '0.5rem' }}>
                {groupAndSortCourses(availableCourses, currentLang).map((group) => (
                  <div key={group.semesterKey} className="semester-group-section" style={{ marginBottom: '2rem' }}>
                    <h3 className="semester-group-title" style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.5rem', marginBottom: '1rem', color: 'var(--text-primary)', textAlign: currentLang === 'he' ? 'right' : 'left' }}>
                      {group.label}
                    </h3>
                    <div className="courses-grid-selection">
                      {[...group.courses].sort((a, b) => {
                        const isCheckedA = trackedCourseIds.includes(a.id);
                        const isCheckedB = trackedCourseIds.includes(b.id);
                        if (isCheckedA && !isCheckedB) return -1;
                        if (!isCheckedA && isCheckedB) return 1;
                        return 0;
                      }).map((c) => {
                        const isChecked = trackedCourseIds.includes(c.id);
                        return (
                          <div
                            key={c.id}
                            className={`course-selection-item glass-panel ${isChecked ? 'selected' : ''}`}
                            onClick={() => handleOnboardingCourseToggle(c.id)}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              readOnly
                            />
                            <div className="course-info-selection">
                              <span className="course-code">{c.shortname.split('-')[0]}</span>
                              <h4 className="course-fullname">{c.fullname}</h4>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              <div className="action-row" style={{ marginTop: '2rem', display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'center' }}>
                <button
                  className="primary-btn"
                  onClick={handleSaveOnboardingCourses}
                  disabled={trackedCourseIds.length === 0}
                  style={{ width: '100%', maxWidth: '280px' }}
                >
                  {t('start_tracking')} ({trackedCourseIds.length} {currentLang === 'he' ? 'קורסים' : 'Courses'})
                </button>
                <label className="secondary-btn btn-sm" style={{ width: '100%', maxWidth: '280px', textAlign: 'center', cursor: 'pointer', display: 'inline-block' }}>
                  📁 {t('import_config_btn')}
                  <input
                    type="file"
                    accept=".json"
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        handleImportConfig(e.target.files[0]);
                      }
                    }}
                    style={{ display: 'none' }}
                  />
                </label>
              </div>
            </>
          )}
        </div>
        {signingInToMoodle && (
        <div className="noodle-toast toast-info" dir={currentLang === 'he' ? 'rtl' : 'ltr'} style={{ zIndex: 100001 }}>
          <span className="toast-message" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.55rem' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="spinning-sync-icon">
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            <span>{t('signing_in_to_moodle')}</span>
          </span>
        </div>
      )}

      {toast && (
          <div className={`noodle-toast toast-${toast.type}`} dir={currentLang === 'he' ? 'rtl' : 'ltr'}>
            <span className="toast-message">{toast.message}</span>
            <button className="toast-close" onClick={() => setToast(null)}>×</button>
          </div>
        )}
      </div>
    );
  }

  // Main Dashboard View (OnboardingStep === 3)
  const filesList = syncResult?.files || [];
  const meetingsList = syncResult?.meetings || [];

  return (
    <div className={`dashboard-layout ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`} dir={currentLang === 'he' ? 'rtl' : 'ltr'}>
      {/* Sidebar Navigation */}
      <aside className={`sidebar glass-panel ${sidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-logo" style={{ flexDirection: 'column', alignItems: 'center', gap: '0.5rem', textAlign: 'center', marginBottom: '2rem' }}>
          <img src={logoImg} alt="Noodle Logo" className="sidebar-logo-img" />
          <span>Noodle</span>
        </div>

        <nav className="sidebar-nav">
          <button
            className={`nav-item ${activeTab === 'dashboard' && selectedCourseId === null ? 'active' : ''}`}
            onClick={() => { setActiveTab('dashboard'); setSelectedCourseId(null); setAssignmentFilterCourseId(null); }}
          >
            <img src={dashboardIcon} alt="" className="nav-icon" /> <span>{t('dashboard')}</span>
          </button>
          <button
            className={`nav-item ${activeTab === 'assignments' && selectedCourseId === null ? 'active' : ''}`}
            onClick={() => { setActiveTab('assignments'); setSelectedCourseId(null); setAssignmentFilterCourseId(null); }}
          >
            <AssignmentsIcon size={18} /> <span>{t('assignments')}</span>
          </button>
          <button
            className={`nav-item ${activeTab === 'grades' && selectedCourseId === null ? 'active' : ''}`}
            onClick={() => { setActiveTab('grades'); setSelectedCourseId(null); }}
          >
            <span className="nav-icon" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem' }}>🎓</span> <span>{t('grades')}</span>
          </button>
          <button
            className={`nav-item ${activeTab === 'settings' && selectedCourseId === null ? 'active' : ''}`}
            onClick={() => { setActiveTab('settings'); setSelectedCourseId(null); }}
          >
            <img src={settingsIcon} alt="" className="nav-icon" /> <span>{t('settings')}</span>
          </button>
          <button
            className={`nav-item ${activeTab === 'about' && selectedCourseId === null ? 'active' : ''}`}
            onClick={() => { setActiveTab('about'); setSelectedCourseId(null); }}
          >
            <img src={aboutIcon} alt="" className="nav-icon" /> <span>{t('about')}</span>
          </button>

          <button
            className="nav-item collapse-toggle-btn"
            onClick={toggleSidebarCollapse}
            style={{ marginTop: 'auto' }}
          >
            <span className="toggle-arrow" style={{ transform: sidebarCollapsed ? 'rotate(180deg)' : 'none', display: 'inline-block' }}>
              {currentLang === 'he' ? '▶' : '◀'}
            </span>
            <span>{t('collapse_sidebar')}</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <button className="text-btn danger-text" onClick={handleDisconnectClick}>
            {t('disconnect_account')}
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="main-content">
        <header className="content-header">
          <div className="header-title">
            <h2>
              {selectedCourseId !== null
                ? getCourseDisplayName(
                    selectedCourseId,
                    assignmentsList.find((a) => a.courseId === selectedCourseId)?.courseName ||
                      filesList.find((f) => f.courseId === selectedCourseId)?.courseName ||
                      `Course ${selectedCourseId}`
                  )
                : t(activeTab as any)}
            </h2>
            <p className="subtitle" style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
              <span>{t('last_synced')}: {syncResult ? new Date(syncResult.syncedAt).toLocaleString() : t('never')}</span>
              <SyncCountdown syncedAt={syncResult?.syncedAt} isSyncing={isSyncing} currentLang={currentLang} />
            </p>
          </div>
          <div className="header-actions" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button
              className={`primary-btn btn-sm header-sync-btn ${tourStep === 1 ? 'tour-highlight' : ''}`}
              onClick={handleManualSync}
              disabled={loading || isSyncing}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={loading || isSyncing ? 'spinning-sync-icon' : ''}
              >
                <path d="M21 2v6h-6"></path>
                <path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path>
                <path d="M3 22v-6h6"></path>
                <path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path>
              </svg>
              <span>{loading || isSyncing ? t('syncing') : t('sync_now')}</span>
            </button>
          </div>
        </header>

        {/* Tab Contents */}
        <div className="tab-pane">
          {selectedCourseId !== null ? (
            <CourseDetailView
              courseId={selectedCourseId}
              assignments={assignmentsList}
              files={filesList}
              meetings={meetingsList}
              token={token}
              getCourseColor={getCourseColor}
              getCourseDisplayName={getCourseDisplayName}
              onBack={() => setSelectedCourseId(null)}
              t={t}
              lang={currentLang}
              settings={settings}
              onToggleMeetingInterest={handleToggleMeetingInterest}
              onSetCourseMeetingsVisibility={handleSetCourseMeetingsVisibility}
              showHiddenZoomCourseIds={showHiddenZoomCourseIds}
              onToggleShowHiddenZoom={handleToggleShowHiddenZoom}
              onToggleCompleted={handleToggleCompleted}
              onToggleHidden={handleToggleHidden}
              onToggleHideAllCourse={handleToggleHideAllCourse}
            />
          ) : activeTab === 'dashboard' ? (
            <DashboardTab
              assignments={assignmentsList}
              meetings={meetingsList}
              token={token}
              getCourseColor={getCourseColor}
              getCourseDisplayName={getCourseDisplayName}
              settings={settings}
              t={t}
              lang={currentLang}
              tourStep={tourStep}
              onToggleMeetingInterest={handleToggleMeetingInterest}
              onSetCourseMeetingsVisibility={handleSetCourseMeetingsVisibility}
              showHiddenZoomCourseIds={showHiddenZoomCourseIds}
              onToggleShowHiddenZoom={handleToggleShowHiddenZoom}
              trackedCourseIds={trackedCourseIds}
              enrolledCourses={availableCourses}
              onUpdateColor={handleUpdateCourseColor}
              onUpdateCustomName={handleUpdateCourseCustomName}
              onSaveTrackedCourses={async (newIds) => {
                setTrackedCourseIdsState(newIds);
                await setTrackedCourseIds(newIds);
                handleManualSync();
              }}
              onGoToCourse={(courseId) => {
                setSelectedCourseId(courseId);
              }}
              onViewCourseAssignments={(courseId) => {
                setAssignmentFilterCourseId(courseId);
                setActiveTab('assignments');
              }}
              syncResult={syncResult}
              onToggleCompleted={handleToggleCompleted}
              onToggleHidden={handleToggleHidden}
              onLabDetected={(id, name) => setLabModalCourse({ id, name })}
              hasGoogleTasksToken={hasGoogleTasksToken}
              googleTasksAuthError={googleTasksAuthError}
              onSyncGoogle={handleSyncGoogleTasks}
              googleSyncLoading={googleSyncLoading}
            />
          ) : activeTab === 'assignments' ? (
            <AssignmentsTab
              assignments={assignmentsList}
              files={filesList}
              token={token}
              getCourseColor={getCourseColor}
              getCourseDisplayName={getCourseDisplayName}
              filterCourseId={assignmentFilterCourseId}
              onClearFilter={() => setAssignmentFilterCourseId(null)}
              onGoToCourse={(courseId) => {
                setSelectedCourseId(courseId);
              }}
              settings={settings}
              t={t}
              lang={currentLang}
              tourStep={tourStep}
              onToggleCompleted={handleToggleCompleted}
              onToggleHidden={handleToggleHidden}
            />
          ) : null}

          {activeTab === 'grades' && (
            <GradesTab
              assignments={assignmentsList}
              getCourseColor={getCourseColor}
              getCourseDisplayName={getCourseDisplayName}
              t={t}
              lang={currentLang}
              tourStep={tourStep}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsTab
              settings={settings}
              onToggleGoogle={handleToggleGoogleTasks}
              onUpdateListName={handleUpdateGoogleListName}
              onSyncGoogle={handleSyncGoogleTasks}
              googleSyncLoading={googleSyncLoading}
              googleSyncStatus={googleSyncStatus}
              hasGoogleTasksToken={hasGoogleTasksToken}
              googleTasksAuthError={googleTasksAuthError}
              syncResult={syncResult}
              onDisconnectClick={handleDisconnectClick}
              onToggleSyncWithoutDeadline={async (enabled: boolean) => {
                if (!settings) return;
                const updated = { ...settings, syncWithoutDeadline: enabled };
                setSettingsState(updated);
                await setSettings(updated);
                if (updated.googleTasksEnabled) {
                  syncGoogleTasksOnBackground(false).catch(() => {});
                }
              }}
              t={t}
              lang={currentLang}
              onUpdateLanguage={async (l: 'he' | 'en') => {
                if (!settings) return;
                const updated = { ...settings, language: l };
                setSettingsState(updated);
                await setSettings(updated);
              }}
              onUpdateTheme={async (theme: 'dark' | 'noodle' | 'coffee') => {
                if (!settings) return;
                const updated = { ...settings, theme };
                setSettingsState(updated);
                await setSettings(updated);
              }}
              onUpdateThresholds={async (green: number, yellow: number) => {
                if (!settings) return;
                const updated = { ...settings, assignmentGreenDaysThreshold: green, assignmentYellowDaysThreshold: yellow };
                setSettingsState(updated);
                await setSettings(updated);
              }}
              onToggleScraping={async (enabled: boolean) => {
                if (!settings) return;
                const updated = { ...settings, scrapingEnabled: enabled };
                setSettingsState(updated);
                await setSettings(updated);
              }}
              onToggleNotifications={async (enabled: boolean) => {
                if (!settings) return;
                const updated = { ...settings, notificationsEnabled: enabled };
                setSettingsState(updated);
                await setSettings(updated);
              }}
              onExportConfig={handleExportConfig}
              onImportConfig={handleImportConfig}
              onAddMockCourse={handleAddMockCourse}
              tourStep={tourStep}
            />
          )}

          {activeTab === 'about' && (
            <AboutTab
              t={t}
              lang={currentLang}
              tourStep={tourStep}
              onStartTour={() => { setShowTour(true); setTourStep(0); }}
            />
          )}
        </div>
      </main>

      {showDisconnectModal && (
        <div className="modal-overlay">
          <div className="modal-content glass-panel" style={{ maxWidth: '450px', padding: '2rem' }}>
            <h3 style={{ marginTop: 0 }}>⚠️ {t('disconnect_account')}</h3>
            <p style={{ margin: '1rem 0', color: 'var(--text-secondary)', fontSize: '0.95rem', lineHeight: '1.4' }}>
              {t('disconnect_warning')}
            </p>
            <div className="modal-checkbox-row" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '1.5rem 0' }}>
              <input
                type="checkbox"
                id="perm-delete-checkbox"
                checked={deletePermanently}
                onChange={(e) => setDeletePermanently(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              <label htmlFor="perm-delete-checkbox" style={{ cursor: 'pointer', fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                {t('perm_delete_checkbox')}
              </label>
            </div>
            <div className="modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
              <button className="secondary-btn btn-sm" onClick={() => setShowDisconnectModal(false)}>
                {t('cancel_btn')}
              </button>
              <button className="primary-btn btn-sm" style={{ background: 'var(--error-color, #ef4444)' }} onClick={confirmDisconnect}>
                {t('disconnect_confirm_btn')}
              </button>
            </div>
          </div>
        </div>
      )}

      {labModalCourse && (
        <div className="modal-overlay" onClick={() => setLabModalCourse(null)}>
          <div
            className="modal-content glass-panel"
            style={{ maxWidth: '480px', padding: '2rem', textAlign: currentLang === 'he' ? 'right' : 'left' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
              <span style={{ fontSize: '2rem' }}>🧪</span>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.25rem' }}>{t('lab_detected_title')}</h3>
                <span style={{ fontSize: '0.9rem', color: 'var(--primary)' }}>{labModalCourse.name}</span>
              </div>
            </div>
            <p style={{ margin: '1rem 0 1.5rem', color: 'var(--text-secondary)', fontSize: '0.95rem', lineHeight: '1.5' }}>
              {t('lab_detected_desc')}
            </p>
            <div className="modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                className="secondary-btn btn-sm"
                onClick={() => setLabModalCourse(null)}
              >
                {t('lab_detected_keep_btn')}
              </button>
              <button
                className="primary-btn btn-sm"
                onClick={() => {
                  handleConfirmHideLabAssignments(labModalCourse.id);
                  setLabModalCourse(null);
                }}
              >
                {t('lab_detected_hide_btn')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showTour && (
        <TourOverlay
          step={tourStep}
          setStep={setTourStep}
          onClose={handleCloseTour}
          t={t}
          lang={currentLang}
        />
      )}

      {signingInToMoodle && (
        <div className="noodle-toast toast-info" dir={currentLang === 'he' ? 'rtl' : 'ltr'} style={{ zIndex: 100001 }}>
          <span className="toast-message" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.55rem' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="spinning-sync-icon">
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            <span>{t('signing_in_to_moodle')}</span>
          </span>
        </div>
      )}

      {toast && (
        <div className={`noodle-toast toast-${toast.type}`} dir={currentLang === 'he' ? 'rtl' : 'ltr'}>
          <span className="toast-message">{toast.message}</span>
          <button className="toast-close" onClick={() => setToast(null)}>×</button>
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------------------
// TAB COMPONENTS
// -------------------------------------------------------------------

type MeetingStatus = 'active' | 'unknown' | 'inactive';

function getMeetingStatus(startTimeStr?: string): MeetingStatus {
  if (!startTimeStr) return 'unknown';
  const startTime = new Date(startTimeStr);
  if (isNaN(startTime.getTime())) return 'unknown';
  const now = new Date();
  const endTime = new Date(startTime.getTime() + 2 * 60 * 60 * 1000); // 2h duration
  if (now >= startTime && now <= endTime) {
    return 'active';
  } else {
    return 'inactive';
  }
}

const EyeIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle' }}>
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const EyeOffIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle' }}>
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

const CheckIcon = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export const ExternalLinkIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

const BookOpenIcon = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
  </svg>
);

const FolderIcon = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

const ChevronDownIcon = ({ size = 14, expanded = false }: { size?: number; expanded?: boolean }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{
      transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
      transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)'
    }}
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const DownloadIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle' }}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <polyline points="19 12 12 19 5 12" />
  </svg>
);

const AssignmentsIcon = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="nav-icon" style={{ verticalAlign: 'middle' }}>
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
    <path d="M9 14l2 2 4-4" />
  </svg>
);

interface TabProps {
  getCourseColor: (id: number) => string;
  getCourseDisplayName: (id: number, def: string) => string;
  onToggleScraping?: (enabled: boolean) => void;
  t: (key: any) => string;
  lang: 'he' | 'en';
}

type EnhancedAssignment = Assignment & {
  isMoodleSubmitted?: boolean;
  isCompleted?: boolean;
};

// Reusable Tracked Courses Configuration Table (Used in CoursesTab and Dashboard Manage Courses Modal)
function CoursesConfigTable({
  trackedCourseIds,
  syncResult,
  enrolledCourses,
  getCourseColor,
  getCourseDisplayName,
  onUpdateColor,
  onUpdateCustomName,
  onSaveTrackedCourses,
  onLabDetected,
  t,
  lang,
}: {
  trackedCourseIds: number[];
  syncResult: SyncResult | null;
  enrolledCourses?: any[];
  getCourseColor: (id: number) => string;
  getCourseDisplayName: (id: number, defaultName: string) => string;
  onUpdateColor?: (id: number, color: string) => void;
  onUpdateCustomName?: (id: number, name: string) => void;
  onSaveTrackedCourses?: (newIds: number[]) => void;
  onLabDetected?: (id: number, name: string) => void;
  t: (key: any) => string;
  lang: 'he' | 'en';
}) {
  const coursesMap = new Map<number, { id: number; name: string; idnumber: string }>();

  if (enrolledCourses && enrolledCourses.length > 0) {
    enrolledCourses.forEach((c) => {
      coursesMap.set(c.id, {
        id: c.id,
        name: c.fullname || c.shortname || `Course ${c.id}`,
        idnumber: c.idnumber || c.shortname || '',
      });
    });
  } else if (syncResult) {
    syncResult.assignments.forEach((a) => {
      coursesMap.set(a.courseId, { id: a.courseId, name: a.courseName, idnumber: '' });
    });
    syncResult.files.forEach((f) => {
      coursesMap.set(f.courseId, { id: f.courseId, name: f.courseName, idnumber: '' });
    });
  }

  const coursesList = Array.from(coursesMap.values());
  const [activeTrackedIds, setActiveTrackedIds] = useState<number[]>(trackedCourseIds);

  useEffect(() => {
    setActiveTrackedIds(trackedCourseIds);
  }, [trackedCourseIds]);

  const handleToggle = (id: number) => {
    if (activeTrackedIds.includes(id)) {
      setActiveTrackedIds(activeTrackedIds.filter((cid) => cid !== id));
    } else {
      setActiveTrackedIds([...activeTrackedIds, id]);
      const c = coursesList.find((x) => x.id === id);
      if (c && c.name && c.name.includes('מעבדה')) {
        onLabDetected?.(id, c.name);
      }
    }
  };

  if (coursesList.length === 0) {
    return (
      <div className="empty-state">
        {lang === 'he' ? 'לא נטענו קורסים עדיין. הרץ סנכרון תחילה.' : 'No courses loaded yet. Run a sync first.'}
      </div>
    );
  }

  return (
    <>
      <div className="courses-grouped-container" style={{ maxHeight: '420px', overflowY: 'auto', paddingRight: '0.5rem' }}>
        {groupAndSortCourses(coursesList, lang).map((group) => (
          <div key={group.semesterKey} className="semester-group-section" style={{ marginBottom: '2rem' }}>
            <h4
              className="semester-group-title"
              style={{
                borderBottom: '1px solid rgba(255,255,255,0.1)',
                paddingBottom: '0.4rem',
                marginBottom: '0.8rem',
                color: 'var(--text-primary)',
                textAlign: lang === 'he' ? 'right' : 'left',
              }}
            >
              {group.label}
            </h4>
            <div className="courses-settings-table">
              <div className="table-header">
                <div>{t('track')}</div>
                <div>{t('course_code_name')}</div>
                <div>{t('display_nickname')}</div>
                <div>{t('theme_color_label')}</div>
              </div>
              {[...group.courses]
                .sort((a, b) => {
                  const isA = activeTrackedIds.includes(a.id);
                  const isB = activeTrackedIds.includes(b.id);
                  if (isA && !isB) return -1;
                  if (!isA && isB) return 1;
                  return 0;
                })
                .map((c) => {
                  return (
                    <div key={c.id} className="table-row">
                      <div>
                        <input
                          type="checkbox"
                          checked={activeTrackedIds.includes(c.id)}
                          onChange={() => handleToggle(c.id)}
                        />
                      </div>
                      <div>
                        <span className="course-code-span">{c.name.split('-')[0]}</span>
                        <p className="course-full-p">{c.name}</p>
                      </div>
                      <div>
                        <input
                          type="text"
                          className="nickname-input"
                          defaultValue={getCourseDisplayName(c.id, '')}
                          placeholder={t('nickname_placeholder')}
                          onBlur={(e) => onUpdateCustomName && onUpdateCustomName(c.id, e.target.value)}
                        />
                      </div>
                      <div>
                        <input
                          type="color"
                          className="color-picker"
                          value={getCourseColor(c.id)}
                          onChange={(e) => onUpdateColor && onUpdateColor(c.id, e.target.value)}
                        />
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        ))}
      </div>

      <div className="action-row" style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end' }}>
        <button className="primary-btn" onClick={() => onSaveTrackedCourses && onSaveTrackedCourses(activeTrackedIds)}>
          {t('save_tracking_options')}
        </button>
      </div>
    </>
  );
}

// 1. DASHBOARD TAB
function DashboardTab({
  assignments,
  meetings,
  token,
  getCourseColor,
  getCourseDisplayName,
  settings,
  t,
  lang,
  tourStep,
  onToggleMeetingInterest,
  onSetCourseMeetingsVisibility,
  showHiddenZoomCourseIds,
  onToggleShowHiddenZoom,
  trackedCourseIds,
  enrolledCourses,
  onUpdateColor,
  onUpdateCustomName,
  onSaveTrackedCourses,
  onGoToCourse,
  onViewCourseAssignments,
  syncResult,
  onToggleCompleted,
  onToggleHidden,
  onLabDetected,
  hasGoogleTasksToken,
  googleTasksAuthError,
  onSyncGoogle,
  googleSyncLoading,
}: {
  assignments: EnhancedAssignment[];
  meetings: ZoomMeeting[];
  token: string | null;
  settings: ExtensionSettings | null;
  tourStep?: number;
  onToggleMeetingInterest: (meetingNumber: string, allMeetingIds: string[]) => void;
  onSetCourseMeetingsVisibility?: (courseMeetings: ZoomMeeting[], makeVisible: boolean) => void;
  showHiddenZoomCourseIds?: Set<number>;
  onToggleShowHiddenZoom?: (courseId: number) => void;
  trackedCourseIds: number[];
  enrolledCourses?: any[];
  onUpdateColor?: (id: number, color: string) => void;
  onUpdateCustomName?: (id: number, name: string) => void;
  onSaveTrackedCourses?: (newIds: number[]) => void;
  onGoToCourse: (courseId: number) => void;
  onViewCourseAssignments: (courseId: number) => void;
  syncResult: SyncResult | null;
  onToggleCompleted?: (assignmentId: number) => void;
  onToggleHidden?: (assignmentId: number) => void;
  onLabDetected?: (id: number, name: string) => void;
  hasGoogleTasksToken?: boolean;
  googleTasksAuthError?: string | null;
  onSyncGoogle?: () => void;
  googleSyncLoading?: boolean;
} & TabProps) {
  const [isHeroExpanded, setIsHeroExpanded] = useState<boolean>(false);
  const [expandedUpcomingId, setExpandedUpcomingId] = useState<number | null>(null);
  const [expandedCourseId, setExpandedCourseId] = useState<number | null>(null);
  const [expandedCourseAssignId, setExpandedCourseAssignId] = useState<number | null>(null);
  const [isManageModalOpen, setIsManageModalOpen] = useState<boolean>(false);

  useEffect(() => {
    if (tourStep === 4) {
      setIsManageModalOpen(true);
      setExpandedCourseId(null);
    } else if (tourStep === 5) {
      setIsManageModalOpen(false);
      if (trackedCourseIds && trackedCourseIds.length > 0) {
        setExpandedCourseId(trackedCourseIds[0]);
      }
    } else if (tourStep !== undefined && tourStep >= 0) {
      setIsManageModalOpen(false);
      if (tourStep !== 5) {
        setExpandedCourseId(null);
      }
    }
  }, [tourStep, trackedCourseIds]);

  const visibleAssignments = assignments.filter((a) => !settings?.hiddenAssignments?.includes(a.id));
  const now = new Date();

  // Partition pending tasks to prioritize future -> no-deadline -> overdue (with deterministic tie-breakers)
  const pendingTasks = assignments
    .filter((a) => !settings?.hiddenAssignments?.includes(a.id) && a.status !== 'Submitted')
    .sort((a, b) => {
      const aHasFuture = a.deadline && new Date(a.deadline) > now;
      const bHasFuture = b.deadline && new Date(b.deadline) > now;
      if (aHasFuture && !bHasFuture) return -1;
      if (!aHasFuture && bHasFuture) return 1;

      const aHasNoDl = !a.deadline;
      const bHasNoDl = !b.deadline;
      if (aHasNoDl && bHasNoDl) return a.id - b.id;
      if (aHasNoDl && !bHasNoDl) return -1;
      if (!aHasNoDl && bHasNoDl) return 1;

      const diff = new Date(a.deadline || 0).getTime() - new Date(b.deadline || 0).getTime();
      if (diff !== 0) return diff;
      return a.id - b.id;
    });

  // Closest actionable assignment (Hero spotlight)
  const nextAssignment = pendingTasks[0] || null;

  // Subject files matching Next Task course & section
  const nextSubjectFiles = (syncResult?.files || []).filter(
    (f) =>
      f.courseId === nextAssignment?.courseId &&
      f.sectionName &&
      nextAssignment?.sectionName &&
      f.sectionName.trim().toLowerCase() === nextAssignment.sectionName.trim().toLowerCase()
  );

  // Top actionable upcoming tasks (excluding hero)
  const upcomingTasks = pendingTasks.slice(1, 4);

  // Active Zoom meetings right now (excluding hidden meetings)
  const isMeetingVisible = (m: ZoomMeeting) => {
    if (!settings?.interestedMeetings || settings.interestedMeetings.length === 0) return true;
    const id = `${m.courseName}:${m.meetingNumber || ''}${m.title}`;
    return settings.interestedMeetings.includes(id);
  };
  const activeMeetings = meetings.filter((m) => getMeetingStatus(m.startTime) === 'active' && isMeetingVisible(m));

  // Semester progress calculation
  const totalAssignCount = visibleAssignments.length;
  const completedAssignCount = visibleAssignments.filter((a) => a.status === 'Submitted').length;
  const semProgressPercent = totalAssignCount > 0 ? Math.round((completedAssignCount / totalAssignCount) * 100) : 0;

  return (
    <div className="tab-dashboard">
      {settings?.googleTasksEnabled && (!hasGoogleTasksToken || googleTasksAuthError) && (
        <div
          className="google-tasks-auth-banner glass-panel"
          style={{
            marginBottom: '1rem',
            padding: '0.85rem 1.25rem',
            border: '1px solid rgba(239, 68, 68, 0.35)',
            background: 'rgba(239, 68, 68, 0.1)',
            borderRadius: 'var(--radius-lg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '1.4rem' }}>⚠️</span>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--accent-red, #ef4444)' }}>
                {t('google_tasks_auth_warning_title')}
              </div>
              <div style={{ fontSize: '0.82rem', opacity: 0.85 }}>
                {t('google_tasks_auth_warning_desc')}
              </div>
            </div>
          </div>
          {onSyncGoogle && (
            <button
              className="primary-btn btn-sm"
              onClick={onSyncGoogle}
              disabled={googleSyncLoading}
              style={{ whiteSpace: 'nowrap' }}
            >
              {googleSyncLoading ? t('syncing') : t('connect_now')}
            </button>
          )}
        </div>
      )}

      {/* 1. Hero Action Strip: Hero Spotlight + Upcoming To-Do Queue */}
      <div className="hero-action-strip">
        {/* Left: Hero Spotlight Card */}
        {nextAssignment ? (
          <div
            className={`hero-spotlight-card next-assignment-banner glass-panel ${tourStep === 2 ? 'tour-highlight' : ''}`}
            style={{
              borderInlineStartColor: getCourseColor(nextAssignment.courseId),
              cursor: 'pointer'
            }}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('a, button, input')) return;
              setIsHeroExpanded((prev) => !prev);
            }}
          >
            <div>
              <div className="spotlight-badge-row">
                <span className="spotlight-label" style={{ color: getCourseColor(nextAssignment.courseId) }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  {t('next_assignment')}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  {nextAssignment.deadline && (
                    <span className={`badge ${getDueTextAndClass(nextAssignment.deadline, lang, settings?.assignmentGreenDaysThreshold, settings?.assignmentYellowDaysThreshold, false, nextAssignment.status).badgeClass}`}>
                      {getDueTextAndClass(nextAssignment.deadline, lang, settings?.assignmentGreenDaysThreshold, settings?.assignmentYellowDaysThreshold, false, nextAssignment.status).deadlineText}
                    </span>
                  )}
                  <ChevronDownIcon size={15} expanded={isHeroExpanded} />
                </div>
              </div>

              <h3 className="hero-task-title">{nextAssignment.name}</h3>

              <div className="hero-meta-strip">
                <div className="hero-course-tag" style={{ color: getCourseColor(nextAssignment.courseId), borderColor: `${getCourseColor(nextAssignment.courseId)}44` }}>
                  <span className="course-color-dot" style={{ backgroundColor: getCourseColor(nextAssignment.courseId) }} />
                  <span>{getCourseDisplayName(nextAssignment.courseId, nextAssignment.courseName)}</span>
                </div>
                {nextAssignment.sectionName && (
                  <span className="subject-pill">
                    <FolderIcon size={12} />
                    <span style={{ fontSize: '0.78rem' }}>{nextAssignment.sectionName}</span>
                  </span>
                )}
              </div>

              <div className={`queue-item-expanded ${isHeroExpanded ? 'open' : ''}`} onClick={(ev) => ev.stopPropagation()}>
              {nextAssignment.attachments && nextAssignment.attachments.length > 0 && (
                <div className="files-column-group" style={{ marginBottom: '0.85rem' }}>
                  <span className="files-column-label">
                    {t('attachments')}:
                  </span>
                  <div className="files-column-list">
                    {nextAssignment.attachments.map((att, attIdx) => {
                      const downloadUrl = buildFileDownloadUrl(att.url, token);
                      const openUrl = buildFileOpenUrl(att.url, token);
                      return (
                        <div key={attIdx} className="submitted-file-chip file-column-item" style={{ background: 'rgba(255,255,255,0.04)', borderColor: 'var(--border)' }}>
                          <span style={{ fontSize: '0.8rem' }}>📄 {att.name}</span>
                          <div className="file-actions-group" style={{ display: 'flex', gap: '0.35rem', marginInlineStart: 'auto' }}>
                            <a href={openUrl} target="_blank" rel="noreferrer" className="file-action-btn" onClick={(ev) => handleOpenFileInNewTab(ev, att.url, token, att.name)}>
                              {t('open_file')}
                            </a>
                            <a
                              href={downloadUrl}
                              download={att.name}
                              target="_blank"
                              rel="noreferrer"
                              className="file-action-btn file-download-btn"
                              title={t('download_file')}
                              aria-label={t('download_file')}
                              onClick={(ev) => ev.stopPropagation()}
                            >
                              <DownloadIcon size={13} />
                            </a>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Subject Files */}
              {nextSubjectFiles.length > 0 && (
                <div className="files-column-group" style={{ marginBottom: '0.85rem' }}>
                  <span className="files-column-label">
                    {t('subject_files')}:
                  </span>
                  <div className="files-column-list">
                    {nextSubjectFiles.map((sf, sfIdx) => {
                      const downloadUrl = buildFileDownloadUrl(sf.fileUrl, token);
                      const openUrl = buildFileOpenUrl(sf.fileUrl, token);
                      return (
                        <div key={sfIdx} className="submitted-file-chip file-column-item" style={{ background: 'rgba(255,255,255,0.04)', borderColor: 'var(--border)' }}>
                          <span style={{ fontSize: '0.8rem' }}>📂 {sf.fileName}</span>
                          <div className="file-actions-group" style={{ display: 'flex', gap: '0.35rem', marginInlineStart: 'auto' }}>
                            <a
                              href={openUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="file-action-btn"
                              style={{ color: '#10b981', borderColor: 'rgba(16, 185, 129, 0.4)', fontWeight: 600 }}
                              onClick={(ev) => handleOpenFileInNewTab(ev, sf.fileUrl, token, sf.fileName)}
                            >
                              {t('open_file')}
                            </a>
                            <a
                              href={downloadUrl}
                              download={sf.fileName}
                              target="_blank"
                              rel="noreferrer"
                              className="file-action-btn file-download-btn"
                              title={t('download_file')}
                              aria-label={t('download_file')}
                              onClick={(ev) => ev.stopPropagation()}
                            >
                              <DownloadIcon size={12} />
                            </a>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Submitted Files */}
              {nextAssignment.submittedFiles && nextAssignment.submittedFiles.length > 0 && (
                <div className="files-column-group" style={{ marginBottom: '0.85rem' }}>
                  <span className="files-column-label">
                    {lang === 'he' ? 'קבצים שהוגשו:' : 'Submitted files:'}
                  </span>
                  <div className="files-column-list">
                    {nextAssignment.submittedFiles.map((att, attIdx) => {
                      const downloadUrl = buildFileDownloadUrl(att.url, token);
                      const openUrl = buildFileOpenUrl(att.url, token);
                      return (
                        <div key={`sub-${attIdx}`} className="submitted-file-chip file-column-item" style={{ background: 'rgba(255,255,255,0.04)', borderColor: 'var(--border)' }}>
                          <CheckIcon size={12} />
                          <span style={{ fontSize: '0.8rem' }}>{att.name}</span>
                          <div className="file-actions-group" style={{ display: 'flex', gap: '0.35rem', marginInlineStart: 'auto' }}>
                            <a
                              href={openUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="file-action-btn"
                              style={{ color: '#10b981', borderColor: 'rgba(16, 185, 129, 0.4)' }}
                              onClick={(ev) => handleOpenFileInNewTab(ev, att.url, token, att.name)}
                            >
                              {t('open_file')}
                            </a>
                            <a
                              href={downloadUrl}
                              download={att.name}
                              target="_blank"
                              rel="noreferrer"
                              className="file-action-btn file-download-btn"
                              title={t('download_file')}
                              aria-label={t('download_file')}
                              onClick={(ev) => ev.stopPropagation()}
                            >
                              <DownloadIcon size={12} />
                            </a>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              </div>
            </div>

            <div>
              <div className={`hero-actions-row ${tourStep === 3 ? 'tour-highlight' : ''}`}>
                {nextAssignment.link && (
                  <a
                    href={nextAssignment.link}
                    target="_blank"
                    rel="noreferrer"
                    className="primary-btn btn-sm"
                    onClick={(ev) => ev.stopPropagation()}
                    data-moodle-link="true"
                  >
                    <span>{t('submit_assignment')}</span>
                  </a>
                )}
                <button
                  className="secondary-btn btn-sm"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onToggleCompleted && onToggleCompleted(nextAssignment.id);
                  }}
                >
                  <CheckIcon size={13} />
                  <span>{nextAssignment.isCompleted ? t('mark_incomplete') : t('mark_done')}</span>
                </button>
                <button
                  className="secondary-btn btn-sm"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onGoToCourse(nextAssignment.courseId);
                  }}
                >
                  <BookOpenIcon size={13} />
                  <span>{t('go_to_course')}</span>
                </button>
                <button
                  className="secondary-btn btn-sm"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onToggleHidden && onToggleHidden(nextAssignment.id);
                  }}
                  title={settings?.hiddenAssignments?.includes(nextAssignment.id) ? t('unhide_assignment') : t('hide_assignment')}
                >
                  {settings?.hiddenAssignments?.includes(nextAssignment.id) ? <EyeIcon size={13} /> : <EyeOffIcon size={13} />}
                  <span>{settings?.hiddenAssignments?.includes(nextAssignment.id) ? t('unhide_assignment') : t('hide_assignment')}</span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="hero-spotlight-card next-assignment-banner glass-panel" style={{ justifyContent: 'center', alignItems: 'center', minHeight: '160px' }}>
            <span style={{ fontSize: '1.1rem', color: 'var(--text-secondary)' }}>🎉 {t('all_caught_up')}</span>
          </div>
        )}

        {/* Right: Upcoming To-Do Queue */}
        <div className={`queue-card glass-panel ${tourStep === 3 ? 'tour-highlight' : ''}`}>
          <div className="queue-header">
            <div className="queue-title">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
              <span>{t('upcoming_tasks')}</span>
            </div>
            <span className="queue-count">{upcomingTasks.length} {t('tasks_count')}</span>
          </div>

          <div className="queue-list">
            {upcomingTasks.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '1.5rem 0' }}>
                🎉 {t('all_caught_up')}
              </div>
            ) : (
              upcomingTasks.map((task) => {
                const color = getCourseColor(task.courseId);
                const courseName = getCourseDisplayName(task.courseId, task.courseName);
                const isExpanded = expandedUpcomingId === task.id;
                const { badgeClass, deadlineText } = getDueTextAndClass(
                  task.deadline || null,
                  lang,
                  settings?.assignmentGreenDaysThreshold,
                  settings?.assignmentYellowDaysThreshold,
                  false,
                  task.status
                );

                const taskSubjectFiles = (syncResult?.files || []).filter(
                  (f) =>
                    f.courseId === task.courseId &&
                    f.sectionName &&
                    task.sectionName &&
                    f.sectionName.trim().toLowerCase() === task.sectionName.trim().toLowerCase()
                );
                const isTaskHidden = settings?.hiddenAssignments?.includes(task.id);
                const isTaskCompleted = task.isCompleted || task.status === 'Submitted';

                return (
                  <div
                    key={task.id}
                    className="queue-item"
                    onClick={() => setExpandedUpcomingId(isExpanded ? null : task.id)}
                  >
                    <div className="queue-item-main-row">
                      <div className="queue-item-left">
                        <button
                          className="quick-check-btn"
                          title={t('mark_done')}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            onToggleCompleted && onToggleCompleted(task.id);
                          }}
                        >
                          <CheckIcon size={12} />
                        </button>
                        <span className="course-color-dot" style={{ backgroundColor: color }} />
                        <div className="queue-item-texts">
                          <div className="queue-item-course" style={{ color }}>{courseName}</div>
                          <div className="queue-item-name" title={task.name}>{task.name}</div>
                        </div>
                      </div>

                      <div className="queue-item-meta">
                        <span className={`badge ${badgeClass}`} style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}>
                          {deadlineText}
                        </span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', display: 'inline-block' }}>
                          ▼
                        </span>
                      </div>
                    </div>

                    <div className={`queue-item-expanded ${isExpanded ? 'open' : ''}`} onClick={(ev) => ev.stopPropagation()}>
                      {/* Attachments */}
                      {task.attachments && task.attachments.length > 0 && (
                        <div className="files-column-group" style={{ marginBottom: '0.5rem' }}>
                          <span className="files-column-label">
                            {t('attachments')}:
                          </span>
                          <div className="files-column-list">
                            {task.attachments.map((att, attIdx) => {
                              const downloadUrl = buildFileDownloadUrl(att.url, token);
                              const openUrl = buildFileOpenUrl(att.url, token);
                              return (
                                <div key={attIdx} className="submitted-file-chip file-column-item" style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'var(--border)' }}>
                                  <span style={{ fontSize: '0.75rem' }}>📄 {att.name}</span>
                                  <div className="file-actions-group" style={{ display: 'flex', gap: '0.3rem', marginInlineStart: 'auto' }}>
                                    <a
                                      href={openUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="file-action-btn"
                                      style={{ color: '#10b981', borderColor: 'rgba(16, 185, 129, 0.4)', fontWeight: 600 }}
                                      onClick={(ev) => handleOpenFileInNewTab(ev, att.url, token, att.name)}
                                    >
                                      {t('open_file')}
                                    </a>
                                    <a
                                      href={downloadUrl}
                                      download={att.name}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="file-action-btn file-download-btn"
                                      title={t('download_file')}
                                      aria-label={t('download_file')}
                                    >
                                      <DownloadIcon size={12} />
                                    </a>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Subject Files */}
                      {taskSubjectFiles.length > 0 && (
                        <div className="files-column-group" style={{ marginBottom: '0.5rem' }}>
                          <span className="files-column-label">
                            {t('subject_files')}:
                          </span>
                          <div className="files-column-list">
                            {taskSubjectFiles.map((sf, sfIdx) => {
                              const downloadUrl = buildFileDownloadUrl(sf.fileUrl, token);
                              const openUrl = buildFileOpenUrl(sf.fileUrl, token);
                              return (
                                <div key={sfIdx} className="submitted-file-chip file-column-item" style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'var(--border)' }}>
                                  <span style={{ fontSize: '0.75rem' }}>📂 {sf.fileName}</span>
                                  <div className="file-actions-group" style={{ display: 'flex', gap: '0.3rem', marginInlineStart: 'auto' }}>
                                    <a
                                      href={openUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="file-action-btn"
                                      style={{ color: '#10b981', borderColor: 'rgba(16, 185, 129, 0.4)', fontWeight: 600 }}
                                      onClick={(ev) => handleOpenFileInNewTab(ev, sf.fileUrl, token, sf.fileName)}
                                    >
                                      {t('open_file')}
                                    </a>
                                    <a
                                      href={downloadUrl}
                                      download={sf.fileName}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="file-action-btn file-download-btn"
                                      title={t('download_file')}
                                      aria-label={t('download_file')}
                                    >
                                      <DownloadIcon size={12} />
                                    </a>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Submitted Files */}
                      {task.submittedFiles && task.submittedFiles.length > 0 && (
                        <div className="files-column-group" style={{ marginBottom: '0.5rem' }}>
                          <span className="files-column-label">
                            {lang === 'he' ? 'קבצים שהוגשו:' : 'Submitted files:'}
                          </span>
                          <div className="files-column-list">
                            {task.submittedFiles.map((att, attIdx) => {
                              const downloadUrl = buildFileDownloadUrl(att.url, token);
                              const openUrl = buildFileOpenUrl(att.url, token);
                              return (
                                <div key={`sub-${attIdx}`} className="submitted-file-chip file-column-item" style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'var(--border)' }}>
                                  <CheckIcon size={11} />
                                  <span style={{ fontSize: '0.75rem' }}>{att.name}</span>
                                  <div className="file-actions-group" style={{ display: 'flex', gap: '0.3rem', marginInlineStart: 'auto' }}>
                                    <a
                                      href={openUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="file-action-btn"
                                      style={{ color: '#10b981', borderColor: 'rgba(16, 185, 129, 0.4)' }}
                                      onClick={(ev) => handleOpenFileInNewTab(ev, att.url, token, att.name)}
                                    >
                                      {t('open_file')}
                                    </a>
                                    <a
                                      href={downloadUrl}
                                      download={att.name}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="file-action-btn file-download-btn"
                                      title={t('download_file')}
                                      aria-label={t('download_file')}
                                    >
                                      <DownloadIcon size={12} />
                                    </a>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Actions Toolbar */}
                      <div className="card-expanded-toolbar" style={{ marginTop: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.4rem' }}>
                        <span className="subject-pill">
                          <FolderIcon size={12} />
                          <span style={{ fontSize: '0.75rem' }}>{task.sectionName || (lang === 'he' ? 'כללי' : 'General')}</span>
                        </span>
                        <div className="toolbar-buttons-group" style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                          <button
                            className="secondary-btn btn-xs"
                            onClick={() => onGoToCourse(task.courseId)}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                          >
                            <BookOpenIcon size={11} />
                            <span>{t('go_to_course')}</span>
                          </button>
                          <button
                            className="secondary-btn btn-xs"
                            onClick={() => onToggleCompleted && onToggleCompleted(task.id)}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                          >
                            <CheckIcon size={11} />
                            <span>{isTaskCompleted ? t('mark_incomplete') : t('mark_done')}</span>
                          </button>
                          <button
                            className="secondary-btn btn-xs"
                            onClick={() => onToggleHidden && onToggleHidden(task.id)}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                          >
                            {isTaskHidden ? <EyeIcon size={11} /> : <EyeOffIcon size={11} />}
                            <span>{isTaskHidden ? t('unhide_assignment') : t('hide_assignment')}</span>
                          </button>
                          {task.link && (
                            <a
                              href={task.link}
                              target="_blank"
                              rel="noreferrer"
                              className="primary-btn btn-xs"
                              data-moodle-link="true"
                            >
                              <span>{t('submit_assignment')}</span>
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* 2. Multi-Active Zoom Sessions Strip */}
      {activeMeetings.length > 0 && (
        <div className={`multi-zoom-strip ${tourStep === 5 ? 'tour-highlight' : ''}`}>
          {activeMeetings.map((m, idx) => {
            const courseColor = getCourseColor(m.courseId);
            const courseDisplayName = getCourseDisplayName(m.courseId, m.courseName);
            return (
              <div key={idx} className="live-session-banner">
                <div className="live-session-left">
                  <div className="live-pulse-dot" />
                  <div>
                    <div className="live-session-title">
                      <span style={{ color: courseColor }}>{courseDisplayName}</span> — {m.title}
                    </div>
                    <div className="live-session-time">
                      {m.startTime ? `${t('starts_at')} ${new Date(m.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ` : ''}
                      <span style={{ color: '#10b981', fontWeight: 700 }}>● {t('active_now')}</span>
                    </div>
                  </div>
                </div>
                <a href={m.meetingUrl} target="_blank" rel="noreferrer" className="primary-btn btn-sm" style={{ background: '#10b981', border: 'none' }}>
                  <span>{t('join_zoom')}</span>
                </a>
              </div>
            );
          })}
        </div>
      )}

      {/* 3. Semester Cumulative Progress Bar */}
      {totalAssignCount > 0 && (
        <div className="progress-container glass-panel" style={{ marginBottom: '2rem', padding: '1rem 1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.9rem', fontWeight: 600 }}>
            <span>{t('semester_progress')}</span>
            <span style={{ color: 'var(--primary)' }}>{completedAssignCount}/{totalAssignCount} ({semProgressPercent}%)</span>
          </div>
          <div className="progress-bar-bg" style={{ width: '100%', height: '8px', background: 'rgba(255,255,255,0.08)', borderRadius: '4px', overflow: 'hidden' }}>
            <div
              className="progress-bar-fill"
              style={{
                width: `${semProgressPercent}%`,
                height: '100%',
                background: 'linear-gradient(90deg, var(--primary), var(--secondary))',
                transition: 'width 0.5s cubic-bezier(0.4, 0, 0.2, 1)'
              }}
            />
          </div>
        </div>
      )}

      {/* 4. My Tracked Courses List Pane */}
      <div className="dashboard-section glass-panel" style={{ marginBottom: '2rem' }}>
        <div className={`courses-list-header ${tourStep === 4 ? 'tour-highlight' : ''}`}>
          <h3 style={{ margin: 0 }}>{t('my_courses')}</h3>
          <button
            className={`secondary-btn btn-sm manage-courses-trigger-btn ${tourStep === 4 ? 'pulse-btn' : ''}`}
            onClick={() => setIsManageModalOpen(true)}
          >
            ⚙️ {t('manage_courses')}
          </button>
        </div>

        <div className={`courses-rows-container ${tourStep === 5 && activeMeetings.length === 0 ? 'tour-highlight' : ''}`}>
          {trackedCourseIds.length === 0 ? (
            <div className="empty-state">{t('empty_state_pending')}</div>
          ) : (
            trackedCourseIds.map((cid) => {
              const color = getCourseColor(cid);
              const courseAssigns = assignments.filter((a) => a.courseId === cid);
              const courseMeetings = meetings.filter((m) => m.courseId === cid);
              const total = courseAssigns.length;
              const done = courseAssigns.filter((a) => a.status === 'Submitted').length;
              const percent = total > 0 ? Math.round((done / total) * 100) : 0;

              const pendingCourseAssigns = courseAssigns
                .filter((a) => a.status !== 'Submitted' && !settings?.hiddenAssignments?.includes(a.id))
                .sort((a, b) => {
                  if (!a.deadline && !b.deadline) return a.id - b.id;
                  if (!a.deadline) return 1;
                  if (!b.deadline) return -1;
                  const diff = new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
                  if (diff !== 0) return diff;
                  return a.id - b.id;
                });

              const nextTask = pendingCourseAssigns[0];
              const nextTaskName = nextTask ? nextTask.name : t('all_caught_up');
              const nextTaskDue = nextTask?.deadline
                ? getDueTextAndClass(nextTask.deadline, lang, settings?.assignmentGreenDaysThreshold, settings?.assignmentYellowDaysThreshold, false, nextTask.status).deadlineText
                : '';

              const isMarked = (m: ZoomMeeting) => {
                if (!settings?.interestedMeetings || settings.interestedMeetings.length === 0) return true;
                const id = `${m.courseName}:${m.meetingNumber || ''}${m.title}`;
                return settings.interestedMeetings.includes(id);
              };

              // Collapse recurring meetings to closest upcoming (or latest past)
              const collapsedCourseMeetings = collapseRecurringMeetings(courseMeetings, now);
              const visibleMeetings = collapsedCourseMeetings.filter(isMarked);
              const hiddenMeetings = collapsedCourseMeetings.filter((m) => !isMarked(m));
              const isHiddenSectionOpen = showHiddenZoomCourseIds?.has(cid) ?? false;
              const isExpanded = expandedCourseId === cid;

              const next5Assignments = [...courseAssigns]
                .filter((a) => !settings?.hiddenAssignments?.includes(a.id))
                .sort((a, b) => {
                  if ((a.status === 'Submitted') !== (b.status === 'Submitted')) {
                    return a.status === 'Submitted' ? 1 : -1;
                  }
                  if (!a.deadline && !b.deadline) return a.id - b.id;
                  if (!a.deadline) return 1;
                  if (!b.deadline) return -1;
                  const diff = new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
                  if (diff !== 0) return diff;
                  return a.id - b.id;
                })
                .slice(0, 5);

              const rawCourseName = courseAssigns[0]?.courseName || courseMeetings[0]?.courseName || `Course ${cid}`;
              const courseDisplayName = getCourseDisplayName(cid, rawCourseName);
              const allMeetingIds = meetings.map((m) => `${m.courseName}:${m.meetingNumber || ''}${m.title}`);

              return (
                <div
                  key={cid}
                  className={`course-row-card glass-panel ${tourStep === 5 && expandedCourseId === cid ? 'tour-highlight' : ''}`}
                  style={{ borderInlineStartColor: color }}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest('a, button, input')) return;
                    setExpandedCourseId(isExpanded ? null : cid);
                  }}
                >
                  <div className="course-row-main">
                    {/* Course Title & Code */}
                    <div className="course-row-info">
                      <span className="course-color-dot" style={{ backgroundColor: color }} />
                      <div>
                        <h4 className="course-row-title" style={{ color }}>{courseDisplayName}</h4>
                        <span className="course-row-code">{rawCourseName}</span>
                      </div>
                    </div>

                    {/* Course Progress Bar */}
                    <div className="course-row-progress-box">
                      <div className="course-prog-meta">
                        <span>{t('view_assignments')}</span>
                        <span>{done}/{total} ({percent}%)</span>
                      </div>
                      <div className="course-prog-bar-bg">
                        <div className="course-prog-bar-fill" style={{ width: `${percent}%`, backgroundColor: color }} />
                      </div>
                    </div>

                    {/* Next Assignment */}
                    <div className="course-row-next-assign">
                      <div className="label">{t('next_assignment')}</div>
                      <div className="name">{nextTaskName}</div>
                      {nextTaskDue && <div className="due">{nextTaskDue}</div>}
                    </div>

                    {/* Course Actions */}
                    <div className="course-row-actions">
                      <button
                        className="secondary-btn btn-sm"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          onViewCourseAssignments(cid);
                        }}
                      >
                        <span>{t('view_assignments')}</span>
                      </button>

                      <button
                        className="primary-btn btn-sm"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          onGoToCourse(cid);
                        }}
                      >
                        <span>{t('go_to_course')}</span>
                      </button>

                      <button
                        className="btn-ghost"
                        style={{ padding: '0.4rem 0.5rem', color: 'var(--text-secondary)' }}
                        title={isExpanded ? 'Collapse' : 'Expand'}
                      >
                        <ChevronDownIcon size={14} expanded={isExpanded} />
                      </button>
                    </div>
                  </div>

                  {/* Expandable Course Panel (Visible Zoom Links + 5 Next Assignments) */}
                  <div className={`course-expanded-panel ${isExpanded ? 'open' : ''}`} onClick={(ev) => ev.stopPropagation()}>
                    {/* Zoom Links Sub-Section */}
                    <div className={`course-expanded-section ${tourStep === 5 ? 'tour-highlight' : ''}`}>
                      <div className="course-expanded-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
                          <span>{t('visible_zoom_links')} ({visibleMeetings.length}/{collapsedCourseMeetings.length})</span>
                        </div>
                        {collapsedCourseMeetings.length > 0 && onSetCourseMeetingsVisibility && (
                          <div style={{ display: 'flex', gap: '0.35rem' }}>
                            <button
                              type="button"
                              className="btn-ghost"
                              style={{ fontSize: '0.72rem', padding: '0.15rem 0.4rem', borderRadius: '4px', cursor: 'pointer' }}
                              onClick={() => onSetCourseMeetingsVisibility(collapsedCourseMeetings, true)}
                              title={t('show_all_course_zoom')}
                            >
                              {t('show_all_course_zoom')}
                            </button>
                            <button
                              type="button"
                              className="btn-ghost"
                              style={{ fontSize: '0.72rem', padding: '0.15rem 0.4rem', borderRadius: '4px', cursor: 'pointer' }}
                              onClick={() => onSetCourseMeetingsVisibility(collapsedCourseMeetings, false)}
                              title={t('hide_all_course_zoom')}
                            >
                              {t('hide_all_course_zoom')}
                            </button>
                          </div>
                        )}
                      </div>

                      {collapsedCourseMeetings.length === 0 ? (
                        <div style={{ fontSize: '0.825rem', color: 'var(--text-muted)', padding: '0.4rem 0' }}>
                          {t('no_zoom')}
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                          {visibleMeetings.length === 0 ? (
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', padding: '0.35rem 0' }}>
                              {t('all_zoom_hidden_for_course')}
                            </div>
                          ) : (
                            visibleMeetings.map((m, mIdx) => {
                              const isActive = getMeetingStatus(m.startTime) === 'active';
                              const keyId = `${m.courseName}:${m.meetingNumber || ''}${m.title}`;
                              return (
                                <div key={mIdx} className="zoom-meeting-row">
                                  <div className="zoom-meeting-info">
                                    <span className="zoom-meeting-title">
                                      {m.title}
                                      {isActive && (
                                        <span style={{ color: '#10b981', fontSize: '0.75rem', fontWeight: 700, marginInlineStart: '0.5rem' }}>
                                          ● {t('active_now')}
                                        </span>
                                      )}
                                    </span>
                                    {m.startTime && (
                                      <span className="zoom-meeting-time">
                                        {new Date(m.startTime).toLocaleString()}
                                      </span>
                                    )}
                                  </div>

                                  <div className="zoom-meeting-actions">
                                    <button
                                      onClick={() => {
                                        if (keyId) onToggleMeetingInterest(keyId, allMeetingIds);
                                      }}
                                      style={{
                                        background: 'none',
                                        border: 'none',
                                        cursor: 'pointer',
                                        padding: 4,
                                        color: 'var(--primary)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center'
                                      }}
                                      title={t('hide_from_dashboard')}
                                    >
                                      <EyeIcon />
                                    </button>
                                    <a href={m.meetingUrl} target="_blank" rel="noreferrer" className="file-action-btn" style={{ color: '#10b981' }}>
                                      {t('join_zoom')}
                                    </a>
                                  </div>
                                </div>
                              );
                            })
                          )}

                          {/* Hidden Meetings Toggle and Collapsible List */}
                          {hiddenMeetings.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.25rem' }}>
                              <button
                                type="button"
                                className="btn-ghost zoom-toggle-hidden-btn"
                                onClick={() => onToggleShowHiddenZoom && onToggleShowHiddenZoom(cid)}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '0.35rem',
                                  fontSize: '0.75rem',
                                  color: 'var(--text-secondary)',
                                  padding: '0.25rem 0.5rem',
                                  borderRadius: '4px',
                                  cursor: 'pointer',
                                  alignSelf: 'flex-start',
                                  background: isHiddenSectionOpen ? 'rgba(255, 255, 255, 0.05)' : 'transparent',
                                  border: '1px solid rgba(255, 255, 255, 0.08)'
                                }}
                              >
                                {isHiddenSectionOpen ? <EyeIcon size={14} /> : <EyeOffIcon size={14} />}
                                <span>
                                  {isHiddenSectionOpen
                                    ? `${t('hide_hidden_zoom')} (${hiddenMeetings.length})`
                                    : `${t('show_hidden_zoom')} (${hiddenMeetings.length})`}
                                </span>
                              </button>

                              {isHiddenSectionOpen && (
                                <div
                                  style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '0.4rem',
                                    padding: '0.5rem',
                                    background: 'rgba(255, 255, 255, 0.02)',
                                    borderRadius: '6px',
                                    border: '1px dashed rgba(255, 255, 255, 0.1)'
                                  }}
                                >
                                  {hiddenMeetings.map((m, hIdx) => {
                                    const isActive = getMeetingStatus(m.startTime) === 'active';
                                    const keyId = `${m.courseName}:${m.meetingNumber || ''}${m.title}`;
                                    return (
                                      <div key={hIdx} className="zoom-meeting-row" style={{ opacity: 0.75 }}>
                                        <div className="zoom-meeting-info">
                                          <span className="zoom-meeting-title">
                                            {m.title}
                                            {isActive && (
                                              <span style={{ color: '#10b981', fontSize: '0.75rem', fontWeight: 700, marginInlineStart: '0.5rem' }}>
                                                ● {t('active_now')}
                                              </span>
                                            )}
                                            <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginInlineStart: '0.5rem' }}>
                                              ({t('hidden_tag')})
                                            </span>
                                          </span>
                                          {m.startTime && (
                                            <span className="zoom-meeting-time">
                                              {new Date(m.startTime).toLocaleString()}
                                            </span>
                                          )}
                                        </div>

                                        <div className="zoom-meeting-actions">
                                          <button
                                            onClick={() => {
                                              if (keyId) onToggleMeetingInterest(keyId, allMeetingIds);
                                            }}
                                            style={{
                                              background: 'none',
                                              border: 'none',
                                              cursor: 'pointer',
                                              padding: 4,
                                              color: 'var(--text-muted)',
                                              display: 'flex',
                                              alignItems: 'center',
                                              justifyContent: 'center'
                                            }}
                                            title={t('show_on_dashboard')}
                                          >
                                            <EyeOffIcon />
                                          </button>
                                          <a href={m.meetingUrl} target="_blank" rel="noreferrer" className="file-action-btn" style={{ color: '#10b981' }}>
                                            {t('join_zoom')}
                                          </a>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* 5 Next Assignments Sub-Section */}
                    <div className="course-expanded-section">
                      <div className="course-expanded-section-title">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><path d="M9 14l2 2 4-4"/></svg>
                        <span>{t('next_5_assignments')}</span>
                      </div>

                      {next5Assignments.length === 0 ? (
                        <div style={{ fontSize: '0.825rem', color: 'var(--text-muted)', padding: '0.4rem 0' }}>
                          {t('no_pending_assignments')}
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                          {next5Assignments.map((a) => {
                            const isAssignExpanded = expandedCourseAssignId === a.id;
                            const isHidden = settings?.hiddenAssignments?.includes(a.id);
                            const isCompleted = a.isCompleted;
                            const { badgeClass, deadlineText } = getDueTextAndClass(
                              a.deadline || null,
                              lang,
                              settings?.assignmentGreenDaysThreshold,
                              settings?.assignmentYellowDaysThreshold,
                              false,
                              a.status
                            );

                            const assignSubjectFiles = (syncResult?.files || []).filter(
                              (f) =>
                                f.courseId === cid &&
                                f.sectionName &&
                                a.sectionName &&
                                f.sectionName.trim().toLowerCase() === a.sectionName.trim().toLowerCase()
                            );

                            return (
                              <div
                                key={a.id}
                                className={`assignment-card course-mini-assign-item glass-panel ${isCompleted ? 'assignment-completed' : ''}`}
                                style={{
                                  padding: '0.65rem 0.85rem',
                                  borderRadius: 'var(--radius-sm)',
                                  borderInlineStartColor: color,
                                  cursor: 'pointer'
                                }}
                                onClick={() => setExpandedCourseAssignId(isAssignExpanded ? null : a.id)}
                              >
                                <div className="assignment-card-compact-row">
                                  <div className="assign-left-info">
                                    <span style={{ fontSize: '0.85rem', color: isCompleted ? '#10b981' : 'var(--text-muted)', fontWeight: 700 }}>
                                      {isCompleted ? '✓' : '○'}
                                    </span>
                                    <span className="assign-title-span" style={{ fontSize: '0.85rem' }} title={a.name}>
                                      {a.name}
                                    </span>
                                    {isHidden && <span className="badge-hidden-tag">{t('hidden_tag')}</span>}
                                    {a.isCompleted && !a.isMoodleSubmitted && (
                                      <span
                                        className="assignment-tag"
                                        style={{
                                          background: 'rgba(16, 185, 129, 0.15)',
                                          color: 'var(--secondary)',
                                          border: '1px solid rgba(16, 185, 129, 0.3)',
                                          padding: '0.1rem 0.35rem',
                                          borderRadius: '4px',
                                          fontSize: '0.7rem'
                                        }}
                                      >
                                        {t('marked_as_done')}
                                      </span>
                                    )}
                                  </div>

                                  <div className="assign-right-meta">
                                    <span className={`badge ${badgeClass}`} style={{ fontSize: '0.7rem', padding: '0.15rem 0.45rem' }}>
                                      {deadlineText}
                                    </span>
                                    <button
                                      className="card-chevron-btn btn-ghost"
                                      onClick={(ev) => {
                                        ev.stopPropagation();
                                        setExpandedCourseAssignId(isAssignExpanded ? null : a.id);
                                      }}
                                    >
                                      <ChevronDownIcon size={12} expanded={isAssignExpanded} />
                                    </button>
                                  </div>
                                </div>

                                {/* Expanded Assignment Details */}
                                <div
                                  className={`assignment-card-expanded-body expanded-subject-container ${isAssignExpanded ? 'open' : ''}`}
                                  style={{
                                    maxHeight: isAssignExpanded ? '600px' : '0px',
                                    opacity: isAssignExpanded ? 1 : 0,
                                    overflow: 'hidden',
                                    transition: 'max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease, margin 0.2s ease, padding 0.2s ease',
                                    marginTop: isAssignExpanded ? '0.5rem' : '0px',
                                    paddingTop: isAssignExpanded ? '0.5rem' : '0px',
                                    borderTop: isAssignExpanded ? '1px solid rgba(255, 255, 255, 0.08)' : 'none'
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {/* Attachments */}
                                  {a.attachments && a.attachments.length > 0 && (
                                    <div className="files-column-group" style={{ marginBottom: '0.4rem' }}>
                                      <span className="files-column-label">
                                        {t('attachments')}:
                                      </span>
                                      <div className="files-column-list">
                                        {a.attachments.map((att, attIdx) => {
                                          const downloadUrl = buildFileDownloadUrl(att.url, token);
                                          const openUrl = buildFileOpenUrl(att.url, token);
                                          return (
                                            <div key={attIdx} className="submitted-file-chip file-column-item" style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'var(--border)' }}>
                                              <span style={{ fontSize: '0.75rem' }}>📄 {att.name}</span>
                                              <div className="file-actions-group" style={{ display: 'flex', gap: '0.3rem', marginInlineStart: 'auto' }}>
                                                <a href={openUrl} target="_blank" rel="noreferrer" className="file-action-btn" style={{ color: '#10b981', borderColor: 'rgba(16, 185, 129, 0.3)' }} onClick={(ev) => handleOpenFileInNewTab(ev, att.url, token, att.name)}>
                                                  {t('open_file')}
                                                </a>
                                                <a
                                                  href={downloadUrl}
                                                  download={att.name}
                                                  target="_blank"
                                                  rel="noreferrer"
                                                  className="file-action-btn file-download-btn"
                                                  title={t('download_file')}
                                                  aria-label={t('download_file')}
                                                >
                                                  <DownloadIcon size={12} />
                                                </a>
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}

                                  {/* Subject Files */}
                                  {assignSubjectFiles.length > 0 && (
                                    <div className="files-column-group" style={{ marginBottom: '0.4rem' }}>
                                      <span className="files-column-label">
                                        {t('subject_files')}:
                                      </span>
                                      <div className="files-column-list">
                                        {assignSubjectFiles.map((sf, sfIdx) => {
                                          const downloadUrl = buildFileDownloadUrl(sf.fileUrl, token);
                                          const openUrl = buildFileOpenUrl(sf.fileUrl, token);
                                          return (
                                            <div key={sfIdx} className="submitted-file-chip file-column-item" style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'var(--border)' }}>
                                              <span style={{ fontSize: '0.75rem' }}>📂 {sf.fileName}</span>
                                              <div className="file-actions-group" style={{ display: 'flex', gap: '0.3rem', marginInlineStart: 'auto' }}>
                                                <a href={openUrl} target="_blank" rel="noreferrer" className="file-action-btn" style={{ color: '#10b981', borderColor: 'rgba(16, 185, 129, 0.3)' }} onClick={(ev) => handleOpenFileInNewTab(ev, sf.fileUrl, token, sf.fileName)}>
                                                  {t('open_file')}
                                                </a>
                                                <a
                                                  href={downloadUrl}
                                                  download={sf.fileName}
                                                  target="_blank"
                                                  rel="noreferrer"
                                                  className="file-action-btn file-download-btn"
                                                  title={t('download_file')}
                                                  aria-label={t('download_file')}
                                                >
                                                  <DownloadIcon size={12} />
                                                </a>
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}

                                  {/* Submitted Files */}
                                  {a.submittedFiles && a.submittedFiles.length > 0 && (
                                    <div className="files-column-group" style={{ marginBottom: '0.4rem' }}>
                                      <span className="files-column-label">
                                        {t('submitted_files')}:
                                      </span>
                                      <div className="files-column-list">
                                        {a.submittedFiles.map((sub, sIdx) => {
                                          const downloadUrl = buildFileDownloadUrl(sub.url, token);
                                          const openUrl = buildFileOpenUrl(sub.url, token);
                                          return (
                                            <div key={sIdx} className="submitted-file-chip file-column-item">
                                              <CheckIcon size={11} />
                                              <span style={{ fontSize: '0.75rem' }}>{sub.name}</span>
                                              <div className="file-actions-group" style={{ display: 'flex', gap: '0.3rem', marginInlineStart: 'auto' }}>
                                                <a href={openUrl} target="_blank" rel="noreferrer" className="file-action-btn" style={{ color: '#10b981', borderColor: 'rgba(16, 185, 129, 0.3)' }} onClick={(ev) => handleOpenFileInNewTab(ev, sub.url, token, sub.name)}>
                                                  {t('open_file')}
                                                </a>
                                                <a
                                                  href={downloadUrl}
                                                  download={sub.name}
                                                  target="_blank"
                                                  rel="noreferrer"
                                                  className="file-action-btn file-download-btn"
                                                  title={t('download_file')}
                                                  aria-label={t('download_file')}
                                                >
                                                  <DownloadIcon size={12} />
                                                </a>
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}

                                  {/* Toolbar */}
                                  <div className="card-expanded-toolbar" style={{ marginTop: '0.35rem' }}>
                                    <span className="subject-pill">
                                      <FolderIcon size={12} />
                                      <span className="subject-label" style={{ fontSize: '0.72rem' }}>{t('subject_label')}:</span>
                                      <span className="subject-val" style={{ fontSize: '0.72rem' }}>{a.sectionName || (lang === 'he' ? 'כללי' : 'General')}</span>
                                    </span>

                                    <div className="toolbar-buttons-group">
                                      <button
                                        className="secondary-btn btn-xs"
                                        onClick={() => onToggleCompleted && onToggleCompleted(a.id)}
                                        style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                                      >
                                        <CheckIcon size={11} />
                                        <span>{isCompleted ? t('mark_incomplete') : t('mark_done')}</span>
                                      </button>

                                      <button
                                        className="secondary-btn btn-xs"
                                        onClick={() => onToggleHidden && onToggleHidden(a.id)}
                                        style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                                      >
                                        {isHidden ? <EyeIcon /> : <EyeOffIcon />}
                                        <span>{isHidden ? t('unhide_assignment') : t('hide_assignment')}</span>
                                      </button>

                                      {a.link && (
                                        <a
                                          href={a.link}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="secondary-btn btn-xs"
                                          data-moodle-link="true"
                                        >
                                          <span>{t('open_in_moodle')}</span>
                                        </a>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 5. Manage Courses Modal */}
      {isManageModalOpen && (
        <div
          className="modal-backdrop"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: tourStep === 4 ? 'flex-start' : 'center',
            justifyContent: 'center',
            zIndex: 1000,
            backdropFilter: 'blur(4px)',
            padding: tourStep === 4 ? '2rem 1.5rem 15rem 1.5rem' : '1.5rem'
          }}
          onClick={() => setIsManageModalOpen(false)}
        >
          <div
            className={`modal-content glass-panel ${tourStep === 4 ? 'tour-highlight' : ''}`}
            style={{
              maxWidth: '850px',
              width: '100%',
              maxHeight: tourStep === 4 ? '62vh' : '85vh',
              overflowY: 'auto',
              padding: '1.75rem',
              borderRadius: 'var(--radius-md)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h3 style={{ margin: 0 }}>⚙️ {t('tracked_courses_config')}</h3>
              <button className="btn-ghost" onClick={() => setIsManageModalOpen(false)} style={{ fontSize: '1.25rem', cursor: 'pointer' }}>
                ✕
              </button>
            </div>

            <CoursesConfigTable
              trackedCourseIds={trackedCourseIds}
              syncResult={syncResult}
              enrolledCourses={enrolledCourses || []}
              getCourseColor={getCourseColor}
              getCourseDisplayName={getCourseDisplayName}
              onUpdateColor={onUpdateColor}
              onUpdateCustomName={onUpdateCustomName}
              onSaveTrackedCourses={onSaveTrackedCourses}
              onLabDetected={onLabDetected}
              t={t}
              lang={lang}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// 2. ASSIGNMENTS TAB (Dedicated v4 Redesign Page)
function AssignmentsTab({
  assignments,
  files,
  token,
  getCourseColor,
  getCourseDisplayName,
  filterCourseId,
  onClearFilter,
  onGoToCourse,
  settings,
  t,
  lang,
  tourStep,
  onToggleCompleted,
  onToggleHidden,
}: {
  assignments: EnhancedAssignment[];
  files?: CourseFile[];
  token: string | null;
  filterCourseId: number | null;
  onClearFilter: () => void;
  onGoToCourse: (courseId: number) => void;
  settings: ExtensionSettings | null;
  tourStep?: number;
  onToggleCompleted?: (assignmentId: number) => void;
  onToggleHidden?: (assignmentId: number) => void;
} & TabProps) {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterPending, setFilterPending] = useState<boolean>(true);
  const [filterPast, setFilterPast] = useState<boolean>(false);
  const [filterCompleted, setFilterCompleted] = useState<boolean>(false);
  const [filterHidden, setFilterHidden] = useState<boolean>(false);
  const [expandedAssignId, setExpandedAssignId] = useState<number | null>(null);
  const [showCalendarView, setShowCalendarView] = useState<boolean>(false);
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const now = new Date();

  // Sort assignments by due date ascending
  const sortedAssigns = [...assignments].sort((a, b) => {
    if (!a.deadline && !b.deadline) return a.id - b.id;
    if (!a.deadline) return 1;
    if (!b.deadline) return -1;
    const diff = new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
    if (diff !== 0) return diff;
    return a.id - b.id;
  });

  const filteredAssigns = sortedAssigns.filter((a) => {
    if (filterCourseId && a.courseId !== filterCourseId) return false;

    const courseDisplayName = getCourseDisplayName(a.courseId, a.courseName).toLowerCase();
    const taskName = a.name.toLowerCase();
    const q = searchQuery.toLowerCase().trim();
    if (q && !taskName.includes(q) && !courseDisplayName.includes(q) && !a.courseName.toLowerCase().includes(q)) {
      return false;
    }

    const isHidden = !!settings?.hiddenAssignments?.includes(a.id);
    const isCompleted = a.status === 'Submitted';
    const hasDeadlinePassed = a.deadline ? new Date(a.deadline) < now : false;

    if (isHidden && filterHidden) return true;
    if (!isHidden && isCompleted && filterCompleted) return true;

    if (!isHidden && !isCompleted) {
      if (hasDeadlinePassed && filterPast) return true;
      if (!hasDeadlinePassed && filterPending) return true;
    }

    return false;
  });

  // Select an assignment from the Calendar View -> ensure its filter is enabled, expand it, and scroll to it
  const handleSelectCalendarAssignment = (a: EnhancedAssignment) => {
    const isHidden = !!settings?.hiddenAssignments?.includes(a.id);
    const isCompleted = a.status === 'Submitted';
    const hasDeadlinePassed = a.deadline ? new Date(a.deadline) < now : false;

    if (isHidden && !filterHidden) setFilterHidden(true);
    if (!isHidden && isCompleted && !filterCompleted) setFilterCompleted(true);
    if (!isHidden && !isCompleted) {
      if (hasDeadlinePassed && !filterPast) setFilterPast(true);
      if (!hasDeadlinePassed && !filterPending) setFilterPending(true);
    }

    setExpandedAssignId(a.id);
    setTimeout(() => {
      const el = document.getElementById(`assign-card-${a.id}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 60);
  };

  // Build Calendar Grid for `calendarMonth`
  const calYear = calendarMonth.getFullYear();
  const calMonthIdx = calendarMonth.getMonth();
  const firstDayOfWeek = new Date(calYear, calMonthIdx, 1).getDay(); // 0 (Sun) - 6 (Sat)
  const daysInMonth = new Date(calYear, calMonthIdx + 1, 0).getDate();
  const daysInPrevMonth = new Date(calYear, calMonthIdx, 0).getDate();

  const calendarCells: Array<{ date: Date; dayNumber: number; isCurrentMonth: boolean; isToday: boolean; items: EnhancedAssignment[] }> = [];

  // Map dated assignments by YYYY-MM-DD key
  // Calendar shows filtered assignments (plus any active/upcoming assignments if all filters match)
  const assignsByDateKey = new Map<string, EnhancedAssignment[]>();
  for (const a of filteredAssigns) {
    if (!a.deadline) continue;
    const d = new Date(a.deadline);
    if (isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!assignsByDateKey.has(key)) {
      assignsByDateKey.set(key, []);
    }
    assignsByDateKey.get(key)!.push(a);
  }

  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  // Leading days from previous month
  for (let i = firstDayOfWeek - 1; i >= 0; i--) {
    const dayNum = daysInPrevMonth - i;
    const cellDate = new Date(calYear, calMonthIdx - 1, dayNum);
    const key = `${cellDate.getFullYear()}-${String(cellDate.getMonth() + 1).padStart(2, '0')}-${String(cellDate.getDate()).padStart(2, '0')}`;
    calendarCells.push({
      date: cellDate,
      dayNumber: dayNum,
      isCurrentMonth: false,
      isToday: key === todayKey,
      items: assignsByDateKey.get(key) || [],
    });
  }

  // Current month days
  for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
    const cellDate = new Date(calYear, calMonthIdx, dayNum);
    const key = `${cellDate.getFullYear()}-${String(cellDate.getMonth() + 1).padStart(2, '0')}-${String(cellDate.getDate()).padStart(2, '0')}`;
    calendarCells.push({
      date: cellDate,
      dayNumber: dayNum,
      isCurrentMonth: true,
      isToday: key === todayKey,
      items: assignsByDateKey.get(key) || [],
    });
  }

  // Trailing days from next month to complete 6 weeks (42 cells) or 5 weeks (35 cells)
  const totalNeeded = calendarCells.length > 35 ? 42 : 35;
  const remaining = totalNeeded - calendarCells.length;
  for (let dayNum = 1; dayNum <= remaining; dayNum++) {
    const cellDate = new Date(calYear, calMonthIdx + 1, dayNum);
    const key = `${cellDate.getFullYear()}-${String(cellDate.getMonth() + 1).padStart(2, '0')}-${String(cellDate.getDate()).padStart(2, '0')}`;
    calendarCells.push({
      date: cellDate,
      dayNumber: dayNum,
      isCurrentMonth: false,
      isToday: key === todayKey,
      items: assignsByDateKey.get(key) || [],
    });
  }

  const weekdayLabels = lang === 'he'
    ? ["א'", "ב'", "ג'", "ד'", "ה'", "ו'", "ש'"]
    : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const monthTitle = calendarMonth.toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-US', {
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="tab-assignments">
      {/* Filter Bar */}
      <div className={`filter-bar glass-panel ${tourStep === 6 ? 'tour-highlight' : ''}`} style={{ padding: '0.85rem 1.25rem' }}>
        <div className="search-input-box">
          <input
            type="text"
            className="search-input"
            placeholder={t('search_assignments_feed')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
          {/* 4 Filter Checkboxes */}
          <div className="filter-checkboxes">
            <label>
              <input
                type="checkbox"
                checked={filterPending}
                onChange={(e) => setFilterPending(e.target.checked)}
              />
              <span>{t('filter_todo')}</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={filterPast}
                onChange={(e) => setFilterPast(e.target.checked)}
              />
              <span>{t('filter_past')}</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={filterCompleted}
                onChange={(e) => setFilterCompleted(e.target.checked)}
              />
              <span>{t('filter_completed')}</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={filterHidden}
                onChange={(e) => setFilterHidden(e.target.checked)}
              />
              <span>{t('filter_hidden')}</span>
            </label>
          </div>

          {/* Toggle Calendar View Button */}
          <button
            type="button"
            className={`calendar-toggle-btn ${showCalendarView ? 'active' : ''}`}
            onClick={() => setShowCalendarView((prev) => !prev)}
            title={showCalendarView ? t('hide_calendar_view') : t('calendar_view')}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <span>{showCalendarView ? t('hide_calendar_view') : t('calendar_view')}</span>
          </button>
        </div>
      </div>

      {/* Course Filter Banner (When navigating from specific course) */}
      {filterCourseId && (
        <div
          className="glass-panel course-filter-banner"
          style={{ borderInlineStartColor: getCourseColor(filterCourseId) }}
        >
          <span>
            {t('filter_by_course')}{' '}
            <strong style={{ color: getCourseColor(filterCourseId) }}>
              {getCourseDisplayName(
                filterCourseId,
                assignments.find((a) => a.courseId === filterCourseId)?.courseName || `Course ${filterCourseId}`
              )}
            </strong>
          </span>
          <button className="file-action-btn" onClick={onClearFilter}>
            {t('clear_filter')}
          </button>
        </div>
      )}

      {/* Split Workspace: Assignments Feed (shrinks width when calendar open) + Calendar View Pane */}
      <div className={`assignments-workspace ${showCalendarView ? 'calendar-open' : ''}`}>
        {/* Assignments Feed */}
        <div className="assignments-feed assignments-list">
          {filteredAssigns.length === 0 ? (
            <div className="glass-panel empty-state" style={{ padding: '2.5rem', textAlign: 'center' }}>
              {t('no_assignments_match')}
            </div>
          ) : (
            filteredAssigns.map((a) => {
              const color = getCourseColor(a.courseId);
              const { badgeClass, deadlineText } = getDueTextAndClass(
                a.deadline || null,
                lang,
                settings?.assignmentGreenDaysThreshold,
                settings?.assignmentYellowDaysThreshold,
                false,
                a.status
              );
              const isCompleted = a.status === 'Submitted';
              const isHidden = !!settings?.hiddenAssignments?.includes(a.id);
              const isExpanded = expandedAssignId === a.id;
              const courseDisplayName = getCourseDisplayName(a.courseId, a.courseName);

              const subjectFiles = (files || []).filter(
                (f) =>
                  f.courseId === a.courseId &&
                  f.sectionName &&
                  a.sectionName &&
                  f.sectionName.trim().toLowerCase() === a.sectionName.trim().toLowerCase()
              );

              return (
                <div
                  key={a.id}
                  id={`assign-card-${a.id}`}
                  className={`assignment-card glass-panel clickable-card ${isExpanded ? 'expanded is-expanded' : ''} ${isHidden ? 'is-hidden' : ''}`}
                  style={{ borderInlineStartColor: color }}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest('a, button, input')) return;
                    setExpandedAssignId(isExpanded ? null : a.id);
                  }}
                >
                  {/* Minimized compact row */}
                  <div className="assignment-card-compact-row">
                    <div className="assign-left-info">
                      <span className="course-color-dot" style={{ backgroundColor: color }} />
                      <span style={{ fontWeight: 700, color, fontSize: '0.85rem' }}>
                        {courseDisplayName}
                      </span>
                      <span className="assign-title-span" title={a.name}>
                        {a.name}
                      </span>
                      {isHidden && <span className="badge-hidden-tag">{t('hidden_tag')}</span>}
                      {a.isCompleted && !a.isMoodleSubmitted && (
                        <span
                          className="assignment-tag"
                          style={{
                            background: 'rgba(16, 185, 129, 0.15)',
                            color: 'var(--secondary)',
                            border: '1px solid rgba(16, 185, 129, 0.3)',
                            padding: '0.15rem 0.45rem',
                            borderRadius: '4px',
                            fontSize: '0.72rem'
                          }}
                        >
                          {t('marked_as_done')}
                        </span>
                      )}
                      {!a.isCompleted && a.isMoodleSubmitted && (
                        <span className="assignment-tag tag-submitted" title={lang === 'he' ? 'הוגש במודל - סומן לביצוע' : 'Submitted in Moodle - marked as To Do'}>
                          {t('submitted_tag')}
                        </span>
                      )}
                    </div>

                    <div className="assign-right-meta">
                      <span className={`badge ${badgeClass}`}>{deadlineText}</span>
                      {!isCompleted && a.link && (
                        <a
                          href={a.link}
                          target="_blank"
                          rel="noreferrer"
                          className="file-action-btn"
                          onClick={(ev) => ev.stopPropagation()}
                          data-moodle-link="true"
                        >
                          {t('submit_in_moodle')}
                        </a>
                      )}
                      {isCompleted && (
                        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#10b981' }}>✓</span>
                      )}
                      <button
                        className="card-chevron-btn btn-ghost"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setExpandedAssignId(isExpanded ? null : a.id);
                        }}
                        title={isExpanded ? (lang === 'he' ? 'צמצם' : 'Collapse') : (lang === 'he' ? 'הרחב' : 'Expand')}
                      >
                        <ChevronDownIcon size={14} expanded={isExpanded} />
                      </button>
                    </div>
                  </div>

                  {/* Expanded body (smoothly animated) */}
                  <div
                    className={`assignment-card-expanded-body expanded-subject-container ${isExpanded ? 'open' : ''}`}
                    style={{
                      maxHeight: isExpanded ? '600px' : '0px',
                      opacity: isExpanded ? 1 : 0,
                      overflow: 'hidden',
                      transition: 'max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease, margin 0.2s ease, padding 0.2s ease',
                      marginTop: isExpanded ? '0.75rem' : '0px',
                      paddingTop: isExpanded ? '0.75rem' : '0px',
                      borderTop: isExpanded ? '1px solid rgba(255, 255, 255, 0.08)' : 'none'
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Attachments */}
                    {a.attachments && a.attachments.length > 0 && (
                      <div className="files-column-group">
                        <span className="files-column-label">
                          {t('attachments')}:
                        </span>
                        <div className="files-column-list">
                          {a.attachments.map((att, attIdx) => {
                            const downloadUrl = buildFileDownloadUrl(att.url, token);
                            const openUrl = buildFileOpenUrl(att.url, token);
                            return (
                              <div key={attIdx} className="submitted-file-chip file-column-item" style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'var(--border)' }}>
                                <span className="file-name">📄 {att.name}</span>
                                <div className="file-actions-group" style={{ display: 'flex', gap: '0.35rem', marginInlineStart: 'auto' }}>
                                  <a href={openUrl} target="_blank" rel="noreferrer" className="file-action-btn" style={{ color: '#10b981', borderColor: 'rgba(16, 185, 129, 0.3)' }} onClick={(ev) => handleOpenFileInNewTab(ev, att.url, token, att.name)}>
                                    {t('open_file')}
                                  </a>
                                  <a
                                    href={downloadUrl}
                                    download={att.name}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="file-action-btn file-download-btn"
                                    title={t('download_file')}
                                    aria-label={t('download_file')}
                                  >
                                    <DownloadIcon size={12} />
                                  </a>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Subject Files */}
                    {subjectFiles.length > 0 && (
                      <div className="files-column-group" style={{ marginTop: '0.4rem' }}>
                        <span className="files-column-label">
                          {t('subject_files')}:
                        </span>
                        <div className="files-column-list">
                          {subjectFiles.map((sf, sfIdx) => {
                            const downloadUrl = buildFileDownloadUrl(sf.fileUrl, token);
                            const openUrl = buildFileOpenUrl(sf.fileUrl, token);
                            return (
                              <div key={sfIdx} className="submitted-file-chip file-column-item" style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'var(--border)' }}>
                                <span className="file-name">📂 {sf.fileName}</span>
                                <div className="file-actions-group" style={{ display: 'flex', gap: '0.35rem', marginInlineStart: 'auto' }}>
                                  <a href={openUrl} target="_blank" rel="noreferrer" className="file-action-btn" style={{ color: '#10b981', borderColor: 'rgba(16, 185, 129, 0.3)' }} onClick={(ev) => handleOpenFileInNewTab(ev, sf.fileUrl, token, sf.fileName)}>
                                    {t('open_file')}
                                  </a>
                                  <a
                                    href={downloadUrl}
                                    download={sf.fileName}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="file-action-btn file-download-btn"
                                    title={t('download_file')}
                                    aria-label={t('download_file')}
                                  >
                                    <DownloadIcon size={12} />
                                  </a>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Submitted Files */}
                    {a.submittedFiles && a.submittedFiles.length > 0 && (
                      <div className="files-column-group" style={{ marginTop: '0.4rem' }}>
                        <span className="files-column-label">
                          {t('submitted_files')}:
                        </span>
                        <div className="files-column-list">
                          {a.submittedFiles.map((sub, sIdx) => {
                            const downloadUrl = buildFileDownloadUrl(sub.url, token);
                            const openUrl = buildFileOpenUrl(sub.url, token);
                            return (
                              <div key={`sub-${sIdx}`} className="submitted-file-chip file-column-item">
                                <span className="file-check-badge">
                                  <CheckIcon size={12} />
                                </span>
                                <span className="file-name">{sub.name}</span>
                                <div className="file-actions-group" style={{ display: 'flex', gap: '0.35rem', marginInlineStart: 'auto' }}>
                                  <a href={openUrl} target="_blank" rel="noreferrer" className="file-action-btn" style={{ color: '#10b981', borderColor: 'rgba(16, 185, 129, 0.3)' }} onClick={(ev) => handleOpenFileInNewTab(ev, sub.url, token, sub.name)}>
                                    {t('open_file')}
                                  </a>
                                  <a
                                    href={downloadUrl}
                                    download={sub.name}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="file-action-btn file-download-btn"
                                    title={t('download_file')}
                                    aria-label={t('download_file')}
                                  >
                                    <DownloadIcon size={12} />
                                  </a>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Toolbar */}
                    <div className="card-expanded-toolbar">
                      <span className="subject-pill">
                        <FolderIcon size={13} />
                        <span className="subject-label">{t('subject_label')}:</span>
                        <span className="subject-val">{a.sectionName || (lang === 'he' ? 'כללי' : 'General')}</span>
                      </span>

                      <div className="toolbar-buttons-group">
                        <button
                          className="secondary-btn btn-xs"
                          onClick={() => onGoToCourse(a.courseId)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        >
                          <BookOpenIcon size={12} />
                          <span>{t('go_to_course')}</span>
                        </button>

                        <button
                          className="secondary-btn btn-xs"
                          onClick={() => onToggleCompleted && onToggleCompleted(a.id)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        >
                          <CheckIcon size={12} />
                          <span>{isCompleted ? t('mark_incomplete') : t('mark_done')}</span>
                        </button>

                        <button
                          className="secondary-btn btn-xs"
                          onClick={() => onToggleHidden && onToggleHidden(a.id)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        >
                          {isHidden ? <EyeIcon /> : <EyeOffIcon />}
                          <span>{isHidden ? t('unhide_assignment') : t('hide_assignment')}</span>
                        </button>

                        {a.link && (
                          <a
                            href={a.link}
                            target="_blank"
                            rel="noreferrer"
                            className="secondary-btn btn-xs"
                            data-moodle-link="true"
                          >
                            <span>{t('open_in_moodle')}</span>
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Interactive Calendar Side Pane */}
        {showCalendarView && (
          <aside className="assignments-calendar-pane glass-panel">
            <div className="calendar-pane-header">
              <div className="calendar-month-title">{monthTitle}</div>
              <div className="calendar-nav-controls">
                <button
                  type="button"
                  className="calendar-nav-btn"
                  onClick={() => setCalendarMonth(new Date(calYear, calMonthIdx - 1, 1))}
                  title={t('prev_month')}
                >
                  {lang === 'he' ? '▶' : '◀'}
                </button>
                <button
                  type="button"
                  className="calendar-today-btn"
                  onClick={() => setCalendarMonth(new Date(now.getFullYear(), now.getMonth(), 1))}
                >
                  {t('today_btn')}
                </button>
                <button
                  type="button"
                  className="calendar-nav-btn"
                  onClick={() => setCalendarMonth(new Date(calYear, calMonthIdx + 1, 1))}
                  title={t('next_month')}
                >
                  {lang === 'he' ? '◀' : '▶'}
                </button>
              </div>
            </div>

            <div className="calendar-hint-subtext">{t('calendar_click_hint')}</div>

            <div className="calendar-weekdays-row">
              {weekdayLabels.map((lbl, idx) => (
                <div key={idx} className="calendar-weekday-cell">
                  {lbl}
                </div>
              ))}
            </div>

            <div className="calendar-days-grid">
              {calendarCells.map((cell, idx) => (
                <div
                  key={idx}
                  className={`calendar-day-cell ${cell.isCurrentMonth ? '' : 'outside-month'} ${cell.isToday ? 'is-today' : ''} ${cell.items.length > 0 ? 'has-items' : ''}`}
                >
                  <div className="calendar-day-number">{cell.dayNumber}</div>
                  <div className="calendar-day-items">
                    {cell.items.map((item) => {
                      const color = getCourseColor(item.courseId);
                      const courseName = getCourseDisplayName(item.courseId, item.courseName);
                      const isSelected = expandedAssignId === item.id;
                      const isDone = item.status === 'Submitted';
                      const dueTimeStr = item.deadline
                        ? new Date(item.deadline).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                        : '';
                      return (
                        <button
                          type="button"
                          key={item.id}
                          className={`calendar-assign-pill ${isSelected ? 'selected' : ''} ${isDone ? 'completed' : ''}`}
                          style={{
                            borderInlineStartColor: color,
                            backgroundColor: isSelected ? `${color}33` : `${color}1a`,
                          }}
                          onClick={() => handleSelectCalendarAssignment(item)}
                          title={`${courseName} — ${item.name}${dueTimeStr ? ` (${dueTimeStr})` : ''}`}
                        >
                          <span className="calendar-pill-dot" style={{ backgroundColor: color }} />
                          <span className="calendar-pill-text">{item.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}





// 4. GRADES TAB
function GradesTab({
  assignments,
  getCourseColor,
  getCourseDisplayName,
  t,
  tourStep,
}: {
  assignments: Assignment[];
  tourStep?: number;
} & TabProps) {
  // Collect all assignments that are graded
  const gradedAssigns = assignments.filter((a) => a.grade !== null);

  // Group graded assignments by course to calculate averages
  const gradesByCourse: Record<number, { courseName: string; sum: number; count: number; list: Assignment[] }> = {};
  gradedAssigns.forEach((a) => {
    if (a.grade === null) return;
    if (!gradesByCourse[a.courseId]) {
      gradesByCourse[a.courseId] = { courseName: a.courseName, sum: 0, count: 0, list: [] };
    }
    const ratio = a.gradeMax ? a.grade / a.gradeMax : 0;
    gradesByCourse[a.courseId].sum += ratio * 100;
    gradesByCourse[a.courseId].count += 1;
    gradesByCourse[a.courseId].list.push(a);
  });

  // Calculate overall GPA (simple unweighted average of course averages)
  let totalCourseAverageSum = 0;
  let courseAveragesCount = 0;
  Object.values(gradesByCourse).forEach((c) => {
    totalCourseAverageSum += c.sum / c.count;
    courseAveragesCount++;
  });
  const overallGpa = courseAveragesCount > 0 ? (totalCourseAverageSum / courseAveragesCount).toFixed(2) : '-';

  return (
    <div className="tab-grades">
      <div className="gpa-card-container">
        <div className={`stat-card glass-panel border-left-secondary ${tourStep === 7 ? 'tour-highlight' : ''}`} style={{ maxWidth: '300px' }}>
          <span className="stat-title">{t('gpa_title')}</span>
          <span className="stat-val">{overallGpa}</span>
          <p className="subtitle">{t('unweighted_average')}</p>
        </div>
      </div>

      {gradedAssigns.length === 0 ? (
        <div className="empty-state glass-panel">{t('empty_state_grades')}</div>
      ) : (
        <div className="grades-grouped-list">
          {Object.entries(gradesByCourse).map(([courseIdStr, group]) => {
            const courseId = Number(courseIdStr);
            const color = getCourseColor(courseId);
            const courseAverage = (group.sum / group.count).toFixed(2);
            return (
              <div key={courseId} className="course-grades-group glass-panel" style={{ borderLeft: `4px solid ${color}` }}>
                <div className="group-header">
                  <h4 style={{ color }}>{getCourseDisplayName(courseId, group.courseName)}</h4>
                  <span className="course-avg-badge">{t('course_average_label')}: {courseAverage}</span>
                </div>

                <div className="grades-table">
                  {group.list.map((a) => (
                    <div key={a.id} className="grade-row">
                      <span className="grade-assign-name">{a.name}</span>
                      <span className="grade-value-span">
                        {a.grade} / {a.gradeMax}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// 5. SETTINGS TAB
function SettingsTab({
  settings,
  onToggleGoogle,
  onUpdateListName,
  onSyncGoogle,
  onExportConfig,
  onImportConfig,
  googleSyncLoading,
  googleSyncStatus,
  hasGoogleTasksToken,
  googleTasksAuthError,
  syncResult,
  onDisconnectClick,
  onToggleSyncWithoutDeadline,
  t,
  lang,
  onUpdateLanguage,
  onUpdateTheme,
  onUpdateThresholds,
  onToggleScraping,
  onToggleNotifications,
  onAddMockCourse,
  tourStep,
}: {
  settings: ExtensionSettings | null;
  onToggleGoogle: (e: boolean) => void;
  onUpdateListName: (name: string) => void;
  onSyncGoogle: () => void;
  onExportConfig: () => void;
  onImportConfig: (file: File) => void;
  googleSyncLoading: boolean;
  googleSyncStatus: string | null;
  hasGoogleTasksToken?: boolean;
  googleTasksAuthError?: string | null;
  syncResult?: SyncResult | null;
  onDisconnectClick?: () => void;
  onToggleSyncWithoutDeadline?: (enabled: boolean) => void;
  onUpdateLanguage: (l: 'he' | 'en') => void;
  onUpdateTheme: (theme: 'dark' | 'noodle' | 'coffee') => void;
  onUpdateThresholds: (green: number, yellow: number) => void;
  onToggleScraping?: (enabled: boolean) => void;
  onToggleNotifications?: (enabled: boolean) => void;
  onAddMockCourse?: () => void;
  t: (key: any) => string;
  lang: 'he' | 'en';
  tourStep?: number;
}) {
  if (!settings) return null;

  return (
    <div className="tab-settings glass-panel">
      <h3>{t('integration_settings')}</h3>
      <p className="subtitle" style={{ marginBottom: '2rem' }}>
        {lang === 'he'
          ? 'הגדר אינטגרציות חיצוניות, תדירות סנכרון והעדפות התראה.'
          : 'Configure external integrations, sync intervals, and notification preferences.'}
      </p>

      {/* Language Selection Section */}
      <div className="settings-section">
        <h4>{t('language_label')}</h4>
        <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
          <select
            className="settings-text-input"
            value={lang}
            onChange={(e) => onUpdateLanguage(e.target.value as 'he' | 'en')}
            style={{ maxWidth: '200px', cursor: 'pointer' }}
          >
            <option value="he">עברית (Hebrew)</option>
            <option value="en">English</option>
          </select>
        </div>
      </div>

      {/* Theme Selection Section */}
      <div className="settings-section" style={{ marginTop: '1.5rem' }}>
        <h4>{lang === 'he' ? 'ערכת נושא' : 'Theme'}</h4>
        <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
          <select
            className="settings-text-input"
            value={settings.theme || 'dark'}
            onChange={(e) => onUpdateTheme(e.target.value as 'dark' | 'noodle' | 'coffee')}
            style={{ maxWidth: '200px', cursor: 'pointer' }}
          >
            <option value="dark">{lang === 'he' ? 'כהה (Dark)' : 'Dark'}</option>
            <option value="noodle">{lang === 'he' ? 'נודל 🍜 (Noodle)' : 'Noodle 🍜'}</option>
            <option value="coffee">{lang === 'he' ? 'קפה ☕ (Coffee)' : 'Coffee ☕'}</option>
          </select>
        </div>
      </div>

      <hr className="settings-divider" />

      {/* Google Tasks Section */}
      <div className={`settings-section google-tasks-section ${tourStep === 8 ? 'tour-highlight' : ''}`}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <h4 style={{ margin: 0 }}>{t('google_tasks_sync_title')}</h4>
          {settings.googleTasksEnabled && (
            <span
              style={{
                fontSize: '0.8rem',
                padding: '0.2rem 0.6rem',
                borderRadius: 'var(--radius-full, 9999px)',
                fontWeight: 600,
                background: hasGoogleTasksToken && !googleTasksAuthError ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                color: hasGoogleTasksToken && !googleTasksAuthError ? 'var(--accent-green, #22c55e)' : 'var(--accent-red, #ef4444)',
                border: `1px solid ${hasGoogleTasksToken && !googleTasksAuthError ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
              }}
            >
              {hasGoogleTasksToken && !googleTasksAuthError ? t('google_tasks_status_connected') : t('google_tasks_status_not_connected')}
            </span>
          )}
        </div>
        <div className="toggle-row">
          <div>
            <span className="toggle-label">{t('google_tasks_sync_title')}</span>
            <p className="subtitle">{t('google_tasks_sync_desc')}</p>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.googleTasksEnabled}
              onChange={(e) => onToggleGoogle(e.target.checked)}
            />
            <span className="slider round"></span>
          </label>
        </div>

        {settings.googleTasksEnabled && (
          <div className="google-subsettings" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
            {(!hasGoogleTasksToken || googleTasksAuthError) && (
              <div
                style={{
                  background: 'rgba(239, 68, 68, 0.12)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  borderRadius: 'var(--radius-md)',
                  padding: '0.75rem 1rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '1rem',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--accent-red, #ef4444)' }}>
                    {t('google_tasks_auth_warning_title')}
                  </div>
                  <div style={{ fontSize: '0.82rem', opacity: 0.85 }}>
                    {t('google_tasks_auth_warning_desc')}
                  </div>
                </div>
                <button className="primary-btn btn-sm" onClick={onSyncGoogle} disabled={googleSyncLoading}>
                  {googleSyncLoading ? t('syncing') : t('connect_now')}
                </button>
              </div>
            )}

            <div>
              <label htmlFor="tasks-list-name" style={{ display: 'block', marginBottom: '0.3rem' }}>{t('google_tasks_list_name_label')}</label>
              <input
                type="text"
                id="tasks-list-name"
                className="settings-text-input"
                value={settings.googleTasksListName}
                onChange={(e) => onUpdateListName(e.target.value)}
              />
            </div>

            {/* Sync assignments without deadline toggle */}
            <div className="toggle-row" style={{ marginTop: '0.25rem', padding: '0.25rem 0' }}>
              <div>
                <span className="toggle-label" style={{ fontSize: '0.92rem' }}>{t('sync_without_deadline_title')}</span>
                <p className="subtitle" style={{ fontSize: '0.82rem', marginTop: '0.2rem' }}>{t('sync_without_deadline_desc')}</p>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  id="sync-without-deadline-toggle"
                  checked={settings.syncWithoutDeadline ?? false}
                  onChange={(e) => onToggleSyncWithoutDeadline && onToggleSyncWithoutDeadline(e.target.checked)}
                />
                <span className="slider round"></span>
              </label>
            </div>

            <div className="tasks-action-row">
              <button className="primary-btn btn-sm" onClick={onSyncGoogle} disabled={googleSyncLoading}>
                {googleSyncLoading
                  ? t('syncing')
                  : hasGoogleTasksToken && !googleTasksAuthError
                  ? `🔄 ${t('sync_tasks_now')}`
                  : `🔗 ${t('auth_sync_google')}`}
              </button>
            </div>

            {googleSyncStatus && <div className="status-message">{googleSyncStatus}</div>}
          </div>
        )}
      </div>

      <hr className="settings-divider" />

      <div className="settings-section">
        <h4>{t('desktop_notifications_title')}</h4>
        <div className="toggle-row">
          <div>
            <span className="toggle-label">{t('desktop_notifications_title')}</span>
            <p className="subtitle">{t('desktop_notifications_desc')}</p>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.notificationsEnabled}
              onChange={async (e) => {
                if (onToggleNotifications) {
                  onToggleNotifications(e.target.checked);
                } else {
                  await setSettings({ notificationsEnabled: e.target.checked });
                }
              }}
            />
            <span className="slider round"></span>
          </label>
        </div>
      </div>

      <hr className="settings-divider" />

      <div className="settings-section">
        <h4>{t('scraping_enabled_title')}</h4>
        <div className="toggle-row">
          <div>
            <span className="toggle-label">{t('scraping_enabled_title')}</span>
            <p className="subtitle">{t('scraping_enabled_desc')}</p>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              id="scraping-enabled-toggle"
              checked={settings.scrapingEnabled ?? false}
              onChange={async (e) => {
                if (onToggleScraping) {
                  onToggleScraping(e.target.checked);
                } else {
                  await setSettings({ scrapingEnabled: e.target.checked });
                }
              }}
            />
            <span className="slider round"></span>
          </label>
        </div>
      </div>

      <hr className="settings-divider" />

      {/* Threshold configuration section */}
      <div className="settings-section">
        <h4>{lang === 'he' ? 'צבעי מועדי הגשה (מטלה הבאה)' : 'Due Date Colors (Next Assignment)'}</h4>
        <p className="subtitle" style={{ marginBottom: '1rem' }}>
          {lang === 'he'
            ? 'הגדר את סף הימים לשינוי צבעי ההתראה של המטלה הבאה.'
            : 'Configure the day thresholds for the next assignment due date alerts.'}
        </p>
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
          <div>
            <label htmlFor="green-threshold" style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.85rem' }}>
              {lang === 'he' ? 'ירוק - יותר מ-X ימים (X):' : 'Green - more than X days (X):'}
            </label>
            <input
              type="number"
              id="green-threshold"
              className="settings-text-input"
              style={{ width: '80px' }}
              value={settings.assignmentGreenDaysThreshold ?? 7}
              onChange={(e) => {
                const val = parseInt(e.target.value) || 0;
                onUpdateThresholds(val, settings.assignmentYellowDaysThreshold ?? 3);
              }}
            />
          </div>
          <div>
            <label htmlFor="yellow-threshold" style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.85rem' }}>
              {lang === 'he' ? 'צהוב - יותר מ-Y ימים (Y):' : 'Yellow - more than Y days (Y):'}
            </label>
            <input
              type="number"
              id="yellow-threshold"
              className="settings-text-input"
              style={{ width: '80px' }}
              value={settings.assignmentYellowDaysThreshold ?? 3}
              onChange={(e) => {
                const val = parseInt(e.target.value) || 0;
                onUpdateThresholds(settings.assignmentGreenDaysThreshold ?? 7, val);
              }}
            />
          </div>
        </div>
      </div>

      <hr className="settings-divider" />





      {/* Configuration Backup Section */}
      <div className="settings-section">
        <h4>{lang === 'he' ? 'גיבוי ושחזור הגדרות' : 'Configuration Backup'}</h4>
        <p className="subtitle" style={{ marginBottom: '1rem' }}>
          {lang === 'he'
            ? 'ייצא את כל הגדרות התוסף, הצבעים והאסימונים לקובץ JSON במחשב שלך, כדי שתוכל לשחזר אותם מאוחר יותר.'
            : 'Export all extension settings, course colors, nicknames, and tokens to a JSON file on your computer to restore them later.'}
        </p>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <button className="primary-btn btn-sm" onClick={onExportConfig} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <DownloadIcon size={13} />
            <span>{t('export_config_btn')}</span>
          </button>
          <label className="secondary-btn btn-sm" style={{ cursor: 'pointer', display: 'inline-block', margin: 0 }}>
            📁 {t('import_config_btn')}
            <input
              type="file"
              accept=".json"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  onImportConfig(e.target.files[0]);
                }
              }}
              style={{ display: 'none' }}
            />
          </label>
        </div>
      </div>

      <hr className="settings-divider" />

      {/* Account & Development Section */}
      <div className="settings-section">
        <h4>👤 {t('account_section_title')}</h4>
        <p className="subtitle" style={{ marginBottom: '1rem' }}>
          {t('account_section_desc')}
        </p>

        <div className="account-card-box">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '1.2rem' }}>🎓</span>
                <strong>{lang === 'he' ? 'חשבון מודל מחובר' : 'Connected Moodle Account'}</strong>
                <span style={{ fontSize: '0.75rem', background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.3)', padding: '0.1rem 0.45rem', borderRadius: '4px' }}>
                  ● {lang === 'he' ? 'פעיל' : 'Active'}
                </span>
              </div>
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                {t('last_synced')}: {syncResult ? new Date(syncResult.syncedAt).toLocaleString() : t('never')}
              </p>
            </div>
            {onDisconnectClick && (
              <button className="text-btn danger-text" onClick={onDisconnectClick} style={{ padding: '0.45rem 0.9rem', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 'var(--radius-sm)' }}>
                {t('disconnect_account')}
              </button>
            )}
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
            <p style={{ fontSize: '0.92rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
              <strong>{t('developed_by')}</strong> {t('credits_authors')}
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <a
                href="https://github.com/duck-5/Noodle"
                target="_blank"
                rel="noreferrer"
                className="secondary-btn btn-xs"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
              >
                <span>🐙</span>
                <span>{t('github_repo_link')}</span>
              </a>
              <a
                href="https://github.com/duck-5/Noodle/issues"
                target="_blank"
                rel="noreferrer"
                className="secondary-btn btn-xs"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
              >
                <span>🐛</span>
                <span>{t('github_issues_link')}</span>
              </a>
              <a
                href="mailto:noodle.d3v@gmail.com"
                className="secondary-btn btn-xs"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
              >
                <span>✉️</span>
                <span>noodle.d3v@gmail.com</span>
              </a>
              <a
                href="https://chromewebstore.google.com/detail/noodle/nelflkccefbdpnaphjabcgkpakhdoope"
                target="_blank"
                rel="noreferrer"
                className="primary-btn btn-xs"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
              >
                <span>⭐</span>
                <span>{t('review_extension_label')}</span>
              </a>
            </div>
          </div>
        </div>
      </div>

      <hr className="settings-divider" />

      {/* Mock Course Section */}
      <div className="settings-section">
        <h4>{lang === 'he' ? 'קורס לדוגמה (לבדיקות ותצוגה)' : 'Mock Course (Testing & Showcase)'}</h4>
        <p className="subtitle" style={{ marginBottom: '1rem' }}>
          {lang === 'he'
            ? 'הוסף קורס עשיר עם מפגשי זום פעילים, מטלות עם קבצים מצורפים, קבצים שהוגשו ונושאים לצורך בדיקת ממשק המשתמש.'
            : 'Add a rich sample course with active Zoom meetings, assignments with attachments, submissions, and sections to test the UI.'}
        </p>
        <button
          className="primary-btn btn-sm"
          onClick={onAddMockCourse}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
        >
          <span>➕</span>
          <span>{t('add_mock_course')}</span>
        </button>
      </div>
    </div>
  );
}

// 6. COURSE DETAIL VIEW
function CourseDetailView({
  courseId,
  assignments,
  files,
  meetings,
  token,
  getCourseColor,
  getCourseDisplayName,
  onBack,
  t,
  lang,
  settings,
  onToggleMeetingInterest,
  onSetCourseMeetingsVisibility,
  showHiddenZoomCourseIds,
  onToggleShowHiddenZoom,
  onToggleCompleted,
  onToggleHidden,
  onToggleHideAllCourse,
}: {
  courseId: number;
  assignments: Assignment[];
  files: CourseFile[];
  meetings: ZoomMeeting[];
  token: string | null;
  onBack: () => void;
  t: (key: any) => string;
  lang: 'he' | 'en';
  settings: ExtensionSettings | null;
  onToggleMeetingInterest: (meetingNumber: string, allMeetingNumbers: string[]) => void;
  onSetCourseMeetingsVisibility?: (courseMeetings: ZoomMeeting[], makeVisible: boolean) => void;
  showHiddenZoomCourseIds?: Set<number>;
  onToggleShowHiddenZoom?: (courseId: number) => void;
  onToggleCompleted?: (assignmentId: number) => void;
  onToggleHidden?: (assignmentId: number) => void;
  onToggleHideAllCourse?: (courseAssignIds: number[], shouldHideAll: boolean) => void;
} & TabProps) {
  const [expandedZoom, setExpandedZoom] = useState<boolean>(false);
  const [expandedDetailAssignId, setExpandedDetailAssignId] = useState<number | null>(null);
  const [activeSectionName, setActiveSectionName] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string> | null>(null);

  const handleSectionSelect = (secName: string | null) => {
    setActiveSectionName(secName);
    if (secName) {
      setExpandedSections(new Set([secName]));
      setTimeout(() => {
        const elementId = `section-node-${encodeURIComponent(secName)}`;
        const el = document.getElementById(elementId);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 100);
    } else {
      setExpandedSections(null);
    }
  };

  const courseColor = getCourseColor(courseId);
  const rawCourseName = assignments.find(a => a.courseId === courseId)?.courseName ||
    files.find(f => f.courseId === courseId)?.courseName ||
    `Course ${courseId}`;
  const courseDisplayName = getCourseDisplayName(courseId, rawCourseName);

  // Filter items for this course
  const courseAssignments = assignments.filter((a) => a.courseId === courseId);
  const courseFiles = files.filter((f) => f.courseId === courseId);

  // Group files and assignments by sectionName
  const sectionsMap = new Map<string, { files: CourseFile[]; assignments: Assignment[] }>();

  // Initialize section helper
  const getSection = (name: string) => {
    const sName = name || 'General';
    if (!sectionsMap.has(sName)) {
      sectionsMap.set(sName, { files: [], assignments: [] });
    }
    return sectionsMap.get(sName)!;
  };

  courseFiles.forEach((f) => {
    getSection(f.sectionName).files.push(f);
  });

  courseAssignments.forEach((a) => {
    getSection(a.sectionName || 'General').assignments.push(a);
  });

  const sectionsList = Array.from(sectionsMap.entries());

  // Order assignments for this course by due date (with deterministic tie-breaker)
  const sortedCourseAssigns = [...courseAssignments].sort((a, b) => {
    if (!a.deadline && !b.deadline) return a.id - b.id;
    if (!a.deadline) return 1;
    if (!b.deadline) return -1;
    const diff = new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
    if (diff !== 0) return diff;
    return a.id - b.id;
  });

  return (
    <div className="course-detail-view glass-panel" style={{ borderTop: `6px solid ${courseColor}` }}>
      <div className="detail-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button className="back-btn" onClick={onBack}>
            {t('back_to_courses')}
          </button>
          <a
            href={getCourseMoodleUrl(courseId, courseAssignments[0]?.link || courseFiles[0]?.fileUrl)}
            target="_blank"
            rel="noreferrer"
            className="secondary-btn btn-sm"
            data-moodle-link="true"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', textDecoration: 'none' }}
          >
            <span>{t('open_in_moodle')}</span>
          </a>
        </div>
        <div className="detail-title-section">
          <h3 style={{ color: courseColor }}>{courseDisplayName}</h3>
          <span className="course-id-badge">{rawCourseName}</span>
        </div>
      </div>

      <div className="detail-grid">
        {/* Left column: Section Tree */}
        <div className="detail-main-tree">
          {(() => {
            const rawCourseMeetings = meetings.filter(m => m.courseId === courseId);
            const courseMeetings = collapseRecurringMeetings(rawCourseMeetings, new Date());

            const isMarked = (m: ZoomMeeting) => {
              if (!settings?.interestedMeetings || settings.interestedMeetings.length === 0) return true;
              const id = `${m.courseName}:${m.meetingNumber || ''}${m.title}`;
              return settings.interestedMeetings.includes(id);
            };
            const markedMeetings = courseMeetings.filter(isMarked);
            const hiddenMeetings = courseMeetings.filter(m => !isMarked(m));
            const isHiddenOpen = showHiddenZoomCourseIds?.has(courseId) ?? false;

            return (
              <div className="zoom-section-card glass-panel" style={{ borderLeft: lang === 'he' ? 'none' : `4px solid ${courseColor}`, borderRight: lang === 'he' ? `4px solid ${courseColor}` : 'none', padding: '1rem', marginBottom: '1.5rem' }}>
                <div
                  className="zoom-course-header"
                  onClick={() => setExpandedZoom(!expandedZoom)}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, textAlign: lang === 'he' ? 'right' : 'left' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <h4 style={{ margin: 0, fontSize: '1rem', color: courseColor, fontWeight: 'bold' }}>
                        📹 {t('zoom_links_found')} ({markedMeetings.length}/{courseMeetings.length})
                      </h4>
                      {courseMeetings.length > 0 && onSetCourseMeetingsVisibility && (
                        <div style={{ display: 'flex', gap: '0.35rem' }} onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            className="btn-ghost"
                            style={{ fontSize: '0.72rem', padding: '0.15rem 0.4rem', borderRadius: '4px', cursor: 'pointer' }}
                            onClick={() => onSetCourseMeetingsVisibility(courseMeetings, true)}
                            title={t('show_all_course_zoom')}
                          >
                            {t('show_all_course_zoom')}
                          </button>
                          <button
                            type="button"
                            className="btn-ghost"
                            style={{ fontSize: '0.72rem', padding: '0.15rem 0.4rem', borderRadius: '4px', cursor: 'pointer' }}
                            onClick={() => onSetCourseMeetingsVisibility(courseMeetings, false)}
                            title={t('hide_all_course_zoom')}
                          >
                            {t('hide_all_course_zoom')}
                          </button>
                        </div>
                      )}
                    </div>

                    {(() => {
                      const activeMeeting = courseMeetings.find(m => getMeetingStatus(m.startTime) === 'active');
                      if (!activeMeeting) return null;
                      return (
                        <div style={{ fontSize: '13px', fontWeight: 'bold', marginTop: '4px' }}>
                          <span style={{ color: 'var(--text-muted)' }}>{t('current_zoom')} </span>
                          <a
                            href={activeMeeting.meetingUrl}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              color: courseColor,
                              textDecoration: 'underline'
                            }}
                          >
                            {activeMeeting.title}
                          </a>
                        </div>
                      );
                    })()}

                    {/* Configured Quick buttons */}
                    {markedMeetings.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px', alignItems: lang === 'he' ? 'flex-end' : 'flex-start' }}>
                        {markedMeetings.map((m, idx) => (
                          <a
                            key={idx}
                            href={m.meetingUrl}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(ev) => ev.stopPropagation()}
                            style={{
                              fontSize: '13px',
                              fontWeight: 500,
                              color: 'var(--text-primary)',
                              textDecoration: 'underline',
                              textDecorationColor: courseColor,
                              transition: 'opacity 0.2s',
                              lineHeight: '1.4'
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.8'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
                          >
                            {m.title}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>

                  <span style={{ fontSize: '1rem', color: 'var(--text-secondary)', marginLeft: 8 }}>
                    {expandedZoom ? '▲' : '▼'}
                  </span>
                </div>

                <div
                  className="zoom-course-meetings-dropdown"
                  style={{
                    maxHeight: expandedZoom ? '400px' : '0px',
                    opacity: expandedZoom ? 1 : 0,
                    overflowY: expandedZoom ? 'auto' : 'hidden',
                    transition: 'max-height 0.2s ease-out, opacity 0.15s ease-out',
                    marginTop: expandedZoom ? '1rem' : '0px',
                    borderTop: expandedZoom ? '1px solid rgba(255,255,255,0.08)' : '1px solid transparent',
                    paddingTop: expandedZoom ? '1rem' : '0px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem'
                  }}
                >
                  {(() => {
                    if (courseMeetings.length === 0) {
                      return (
                        <div style={{ color: 'var(--text-secondary)', textAlign: 'center', fontSize: '13px', padding: '8px 0' }}>
                          {lang === 'he' ? 'לא נמצאו פגישות זום עבור קורס זה.' : 'No Zoom meetings found for this course.'}
                        </div>
                      );
                    }
                    const allMeetingIds = courseMeetings.map(m => `${m.courseName}:${m.meetingNumber || ''}${m.title}`);

                    const renderMeetingRow = (m: ZoomMeeting, idx: number, isMarkedRow: boolean) => {
                      const status = getMeetingStatus(m.startTime);
                      let statusLabel = '';
                      let statusColor = '';
                      let itemStyle: React.CSSProperties = {
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '0.75rem',
                        background: 'rgba(255,255,255,0.02)',
                        borderRadius: 'var(--radius-sm)',
                        borderLeft: lang === 'he' ? 'none' : `3px solid rgba(255,255,255,0.1)`,
                        borderRight: lang === 'he' ? `3px solid rgba(255,255,255,0.1)` : 'none'
                      };

                      if (status === 'active') {
                        itemStyle.borderLeft = lang === 'he' ? 'none' : `3px solid #28a745`;
                        itemStyle.borderRight = lang === 'he' ? `3px solid #28a745` : 'none';
                        statusLabel = lang === 'he' ? '● פעיל כעת' : '● Active Now';
                        statusColor = '#28a745';
                      } else if (status === 'inactive') {
                        itemStyle.opacity = isMarkedRow ? 0.75 : 0.6;
                        itemStyle.borderLeft = lang === 'he' ? 'none' : `3px solid #888888`;
                        itemStyle.borderRight = lang === 'he' ? `3px solid #888888` : 'none';
                        statusLabel = m.startTime ? (lang === 'he' ? `הסתיים / לא פעיל` : `Finished / Inactive`) : '';
                        statusColor = '#888888';
                      }

                      return (
                        <div key={idx} className="meeting-row-item" style={itemStyle}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, textAlign: lang === 'he' ? 'right' : 'left' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{m.title}</span>
                              {statusLabel && (
                                <span style={{ fontSize: 11, color: statusColor, fontWeight: 'bold' }}>
                                  {statusLabel}
                                </span>
                              )}
                              {!isMarkedRow && (
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                                  ({t('hidden_tag')})
                                </span>
                              )}
                            </div>
                            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{m.sectionName}</span>
                              {m.startTime && (
                                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                  📅 {new Date(m.startTime).toLocaleString()}
                                </span>
                              )}
                            </div>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <button
                              onClick={() => {
                                const keyId = `${m.courseName}:${m.meetingNumber || ''}${m.title}`;
                                if (keyId) {
                                  onToggleMeetingInterest(keyId, allMeetingIds);
                                }
                              }}
                              style={{
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                padding: 4,
                                color: isMarkedRow ? 'var(--primary)' : 'var(--text-muted)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                transition: 'color 0.2s'
                              }}
                              title={isMarkedRow ? t('hide_from_dashboard') : t('show_on_dashboard')}
                            >
                              {isMarkedRow ? <EyeIcon /> : <EyeOffIcon />}
                            </button>
                            <a href={m.meetingUrl} target="_blank" rel="noreferrer" className="zoom-btn" style={{ textDecoration: 'none', padding: '4px 10px', fontSize: '12px' }}>
                              {t('join_zoom')}
                            </a>
                          </div>
                        </div>
                      );
                    };

                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {markedMeetings.length === 0 ? (
                          <div style={{ color: 'var(--text-muted)', fontSize: '13px', padding: '4px 0' }}>
                            {t('all_zoom_hidden_for_course')}
                          </div>
                        ) : (
                          markedMeetings.map((m, idx) => renderMeetingRow(m, idx, true))
                        )}

                        {hiddenMeetings.length > 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.25rem' }}>
                            <button
                              type="button"
                              className="btn-ghost zoom-toggle-hidden-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                onToggleShowHiddenZoom && onToggleShowHiddenZoom(courseId);
                              }}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.35rem',
                                fontSize: '0.75rem',
                                color: 'var(--text-secondary)',
                                padding: '0.25rem 0.5rem',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                alignSelf: 'flex-start',
                                background: isHiddenOpen ? 'rgba(255, 255, 255, 0.05)' : 'transparent',
                                border: '1px solid rgba(255, 255, 255, 0.08)'
                              }}
                            >
                              {isHiddenOpen ? <EyeIcon size={14} /> : <EyeOffIcon size={14} />}
                              <span>
                                {isHiddenOpen
                                  ? `${t('hide_hidden_zoom')} (${hiddenMeetings.length})`
                                  : `${t('show_hidden_zoom')} (${hiddenMeetings.length})`}
                              </span>
                            </button>

                            {isHiddenOpen && (
                              <div
                                style={{
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: '0.4rem',
                                  padding: '0.5rem',
                                  background: 'rgba(255, 255, 255, 0.02)',
                                  borderRadius: '6px',
                                  border: '1px dashed rgba(255, 255, 255, 0.1)'
                                }}
                              >
                                {hiddenMeetings.map((m, hIdx) => renderMeetingRow(m, hIdx, false))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>
            );
          })()}

          <h4>{t('course_sections')}</h4>

          {/* Subjects Navigation Tree */}
          {sectionsList.length > 0 && (
            <div className="subjects-nav-tree glass-panel" style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.5rem',
              padding: '0.75rem',
              marginBottom: '1.5rem',
              background: 'rgba(255, 255, 255, 0.03)',
              borderRadius: '8px',
              alignItems: 'center'
            }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-secondary)', marginRight: '0.5rem' }}>
                {lang === 'he' ? 'נווּט נושאים:' : 'Navigate Subjects:'}
              </span>
              <button
                className="secondary-btn btn-sm"
                onClick={() => handleSectionSelect(null)}
                style={{
                  background: activeSectionName === null ? courseColor : 'rgba(255, 255, 255, 0.05)',
                  color: activeSectionName === null ? '#fff' : 'var(--text-primary)',
                  borderColor: activeSectionName === null ? 'transparent' : 'rgba(255, 255, 255, 0.1)',
                  fontWeight: activeSectionName === null ? 'bold' : 'normal',
                  padding: '0.3rem 0.75rem',
                  borderRadius: '16px',
                  cursor: 'pointer',
                  fontSize: '0.8rem'
                }}
              >
                {lang === 'he' ? 'הכל 🌐' : 'All 🌐'}
              </button>
              {sectionsList.map(([secName]) => {
                const isActive = activeSectionName === secName;
                return (
                  <button
                    key={secName}
                    className="secondary-btn btn-sm"
                    onClick={() => handleSectionSelect(secName)}
                    style={{
                      background: isActive ? courseColor : 'rgba(255, 255, 255, 0.05)',
                      color: isActive ? '#fff' : 'var(--text-primary)',
                      borderColor: isActive ? 'transparent' : 'rgba(255, 255, 255, 0.1)',
                      fontWeight: isActive ? 'bold' : 'normal',
                      padding: '0.3rem 0.75rem',
                      borderRadius: '16px',
                      cursor: 'pointer',
                      fontSize: '0.8rem'
                    }}
                  >
                    {secName}
                  </button>
                );
              })}
            </div>
          )}

          {sectionsList.length === 0 ? (
            <div className="empty-state">{t('empty_sections')}</div>
          ) : (
            <div className="sections-tree">
              {sectionsList.map(([secName, content], sIdx) => {
                const isCollapsed = expandedSections !== null ? !expandedSections.has(secName) : false;
                return (
                  <div
                    key={sIdx}
                    id={`section-node-${encodeURIComponent(secName)}`}
                    className={`section-node glass-panel ${isCollapsed ? 'collapsed' : 'expanded'}`}
                    style={{
                      transition: 'all 0.3s ease',
                      opacity: isCollapsed ? 0.7 : 1,
                      padding: isCollapsed ? '0.75rem 1rem' : '1rem'
                    }}
                  >
                    <h5
                      className="section-node-title"
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        margin: 0,
                        cursor: 'pointer',
                        paddingBottom: isCollapsed ? '0' : '0.5rem',
                        borderBottom: isCollapsed ? 'none' : '1px solid rgba(255,255,255,0.08)'
                      }}
                      onClick={(e) => {
                        if (activeSectionName !== null) {
                          setActiveSectionName(null);
                        }
                        setExpandedSections(prev => {
                          const newSet = new Set(prev === null ? sectionsList.map(s => s[0]) : prev);
                          if (newSet.has(secName)) {
                            newSet.delete(secName);
                          } else {
                            newSet.add(secName);
                          }
                          return newSet;
                        });
                        e.stopPropagation();
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span>{secName}</span>
                        <a href={getCourseMoodleUrl(courseId, courseAssignments[0]?.link)} target="_blank" rel="noreferrer" className="action-icon-link" data-moodle-link="true" onClick={(ev) => ev.stopPropagation()}>{lang === 'he' ? 'מודל ↗' : 'Moodle ↗'}</a>
                      </div>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        {isCollapsed ? '▼' : '▲'}
                      </span>
                    </h5>

                    {!isCollapsed && (
                      <div className="section-node-body" style={{ marginTop: '1rem' }}>
                        {content.assignments.length > 0 && (
                          <div className="section-assignments-list">
                            {content.assignments.map((a) => {
                              const { badgeClass, deadlineText } = getDueTextAndClass(
                                a.deadline || null,
                                lang,
                                settings?.assignmentGreenDaysThreshold,
                                settings?.assignmentYellowDaysThreshold,
                                false,
                                a.status
                              );

                              return (
                                <div key={a.id} className="section-assignment-item">
                                  <div className="item-meta-row">
                                    <span className="item-type-tag assign-tag">📝 {lang === 'he' ? 'מטלה' : 'Assignment'}</span>
                                    {a.status === 'Submitted' ? (
                                      <span className="badge badge-success">{lang === 'he' ? 'הוגש!' : 'Submitted!'}</span>
                                    ) : (
                                      <span className={`badge ${badgeClass}`}>{deadlineText}</span>
                                    )}
                                  </div>
                                  <span className="item-name">
                                    {a.name}
                                    {(a as any).isCompleted && !(a as any).isMoodleSubmitted && (
                                      <span className="assignment-tag tag-not-submitted" title={lang === 'he' ? 'הושלם ידנית - לא הוגש במודל' : 'Manually completed - not submitted in Moodle'}>
                                        {t('not_submitted_tag')}
                                      </span>
                                    )}
                                    {!(a as any).isCompleted && (a as any).isMoodleSubmitted && (
                                      <span className="assignment-tag tag-submitted" title={lang === 'he' ? 'הוגש במודל - סומן לביצוע' : 'Submitted in Moodle - marked as To Do'}>
                                        {t('submitted_tag')}
                                      </span>
                                    )}
                                  </span>
                                  <div className="item-actions" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.45rem' }}>
                                    <a href={a.link} target="_blank" rel="noreferrer" className="action-link-btn" data-moodle-link="true">
                                      {lang === 'he' ? 'פתח במודל ↗' : 'Open in Moodle ↗'}
                                    </a>
                                    {a.attachments && a.attachments.length > 0 && (
                                      <div className="files-column-list">
                                        {a.attachments.map((att, attIdx) => {
                                          const downloadUrl = buildFileDownloadUrl(att.url, token);
                                          const openUrl = buildFileOpenUrl(att.url, token);
                                          return (
                                            <div key={attIdx} className="submitted-file-chip file-column-item" style={{ background: 'rgba(255, 255, 255, 0.03)', borderColor: 'var(--border)' }}>
                                              <span style={{ fontSize: '0.75rem' }}>📄 {att.name}</span>
                                              <a href={openUrl} target="_blank" rel="noreferrer" className="file-action-btn" style={{ color: '#10b981', borderColor: 'rgba(16, 185, 129, 0.3)' }} onClick={(ev) => handleOpenFileInNewTab(ev, att.url, token, att.name)}>
                                                {t('open_file')}
                                              </a>
                                              <a href={downloadUrl} download={att.name} target="_blank" rel="noreferrer" className="file-action-btn file-download-btn" title={t('download_file')} aria-label={t('download_file')}>
                                                <DownloadIcon size={12} />
                                              </a>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {content.files.length > 0 && (
                          <div className="section-files-list">
                            {content.files.map((f, fIdx) => {
                              const downloadUrl = buildFileDownloadUrl(f.fileUrl, token);
                              const openUrl = buildFileOpenUrl(f.fileUrl, token);
                              return (
                                <div key={fIdx} className="section-file-item">
                                  <span className="item-name">📄 {f.fileName}</span>
                                  <div className="file-meta" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                    {f.fileSize > 0 && <span className="file-size">{(f.fileSize / 1024 / 1024).toFixed(2)} MB</span>}
                                    <a
                                      href={openUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="file-action-btn"
                                      style={{ color: '#10b981', borderColor: 'rgba(16, 185, 129, 0.4)', fontWeight: 600 }}
                                      onClick={(ev) => handleOpenFileInNewTab(ev, f.fileUrl, token, f.fileName)}
                                    >
                                      {t('open_file')}
                                    </a>
                                    <a
                                      href={downloadUrl}
                                      download={f.fileName}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="file-action-btn file-download-btn"
                                      title={t('download_file')}
                                      aria-label={t('download_file')}
                                    >
                                      <DownloadIcon size={12} />
                                    </a>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {content.assignments.length === 0 && content.files.length === 0 && (
                          <p className="no-content-text">{lang === 'he' ? 'נושא ריק' : 'Empty section'}</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right column: Assignments Quick Overview */}
        <div className="detail-sidebar">
          {(() => {
            const allHidden = sortedCourseAssigns.length > 0 && sortedCourseAssigns.every((a) => settings?.hiddenAssignments?.includes(a.id));
            return (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                <h4 style={{ margin: 0 }}>{t('all_assignments_label')}</h4>
                {sortedCourseAssigns.length > 0 && onToggleHideAllCourse && (
                  <button
                    className="secondary-btn btn-xs"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                    onClick={() => onToggleHideAllCourse(sortedCourseAssigns.map((a) => a.id), !allHidden)}
                  >
                    {allHidden ? <EyeIcon /> : <EyeOffIcon />}
                    <span>{allHidden ? t('unhide_all_assignments') : t('hide_all_assignments')}</span>
                  </button>
                )}
              </div>
            );
          })()}
          {sortedCourseAssigns.length === 0 ? (
            <div className="empty-state">{lang === 'he' ? 'לא נמצאו מטלות.' : 'No assignments found.'}</div>
          ) : (
            <div className="sidebar-assignments-list">
              {sortedCourseAssigns.map((a) => {
                const isExpanded = expandedDetailAssignId === a.id;
                const isHidden = settings?.hiddenAssignments?.includes(a.id);
                const assignSubjectFiles = (files || []).filter(
                  (f) =>
                    f.courseId === courseId &&
                    f.sectionName &&
                    a.sectionName &&
                    f.sectionName.trim().toLowerCase() === a.sectionName.trim().toLowerCase()
                );

                return (
                  <div
                    key={a.id}
                    className="sidebar-assign-card"
                    style={{
                      borderLeft: lang !== 'he' ? `3px solid ${a.status === 'Submitted' ? '#10b981' : '#f59e0b'}` : undefined,
                      borderRight: lang === 'he' ? `3px solid ${a.status === 'Submitted' ? '#10b981' : '#f59e0b'}` : undefined,
                      cursor: 'pointer'
                    }}
                    onClick={() => setExpandedDetailAssignId(isExpanded ? null : a.id)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                      <h6 style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', flexWrap: 'wrap', margin: 0 }}>
                        {a.name}
                        {isHidden && (
                          <span className="assignment-tag tag-hidden" style={{ background: 'rgba(239, 68, 68, 0.15)', color: 'var(--danger)', border: '1px solid rgba(239, 68, 68, 0.3)', padding: '0.15rem 0.45rem', borderRadius: '4px', fontSize: '0.72rem' }}>
                            {t('hidden_tag')}
                          </span>
                        )}
                        {(a as any).isCompleted && !(a as any).isMoodleSubmitted && (
                          <span
                            className="assignment-tag"
                            style={{
                              background: 'rgba(16, 185, 129, 0.15)',
                              color: 'var(--secondary)',
                              border: '1px solid rgba(16, 185, 129, 0.3)',
                              padding: '0.15rem 0.45rem',
                              borderRadius: '4px',
                              fontSize: '0.72rem'
                            }}
                          >
                            {t('marked_as_done')}
                          </span>
                        )}
                        {!(a as any).isCompleted && (a as any).isMoodleSubmitted && (
                          <span className="assignment-tag tag-submitted" title={lang === 'he' ? 'הוגש במודל - סומן לביצוע' : 'Submitted in Moodle - marked as To Do'}>
                            {t('submitted_tag')}
                          </span>
                        )}
                      </h6>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }}>
                        ▼
                      </span>
                    </div>

                    <p className="assign-status" style={{ margin: '0.35rem 0' }}>
                      {t('status_label')}: {(a as any).isCompleted && !(a as any).isMoodleSubmitted ? t('marked_as_done') : lang === 'he' ? (a.status === 'Submitted' ? 'הוגש' : a.status === 'Not submitted' ? 'טרם הוגש' : a.status === 'Assigned' ? 'הוקצה' : a.status) : a.status}
                    </p>
                    {a.status === 'Submitted' ? (
                      <p className="assign-deadline due-green" style={{ color: '#10b981', margin: 0 }}>
                        {lang === 'he' ? 'הוגש!' : 'Submitted!'} {a.grade !== null && a.gradeMax ? `(${a.grade}/${a.gradeMax})` : ''}
                      </p>
                    ) : a.deadline && (() => {
                      const { timeColorClass } = getDueTextAndClass(
                        a.deadline,
                        lang,
                        settings?.assignmentGreenDaysThreshold,
                        settings?.assignmentYellowDaysThreshold,
                        false,
                        a.status
                      );
                      return (
                        <p className={`assign-deadline ${timeColorClass}`} style={{ margin: 0 }}>
                          {lang === 'he' ? 'מועד הגשה:' : 'Due:'} {new Date(a.deadline).toLocaleString()}
                        </p>
                      );
                    })()}

                    {/* Smoothly expandable body */}
                    <div
                      style={{
                        maxHeight: isExpanded ? '650px' : '0px',
                        opacity: isExpanded ? 1 : 0,
                        overflow: 'hidden',
                        transition: 'max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease, margin 0.2s ease',
                        marginTop: isExpanded ? '0.75rem' : '0px',
                        paddingTop: isExpanded ? '0.75rem' : '0px',
                        borderTop: isExpanded ? '1px solid rgba(255, 255, 255, 0.08)' : 'none'
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {a.attachments && a.attachments.length > 0 && (
                        <div className="files-column-group" style={{ marginBottom: '0.6rem' }}>
                          <div className="files-column-list">
                            {a.attachments.map((att, attIdx) => {
                              const downloadUrl = buildFileDownloadUrl(att.url, token);
                              const openUrl = buildFileOpenUrl(att.url, token);
                              return (
                                <div key={attIdx} className="submitted-file-chip file-column-item" style={{ background: 'rgba(255, 255, 255, 0.03)', borderColor: 'var(--border)' }}>
                                  <span style={{ fontSize: '0.75rem' }}>📄 {att.name}</span>
                                  <a href={openUrl} target="_blank" rel="noreferrer" className="file-action-btn" style={{ color: '#10b981', borderColor: 'rgba(16, 185, 129, 0.3)' }} onClick={(ev) => handleOpenFileInNewTab(ev, att.url, token, att.name)}>
                                    {t('open_file')}
                                  </a>
                                  <a href={downloadUrl} download={att.name} target="_blank" rel="noreferrer" className="file-action-btn file-download-btn" title={t('download_file')} aria-label={t('download_file')}>
                                    <DownloadIcon size={12} />
                                  </a>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Subject Files */}
                      {assignSubjectFiles.length > 0 && (
                        <div className="files-column-group" style={{ marginBottom: '0.6rem' }}>
                          <span className="files-column-label" style={{ fontSize: '0.75rem', opacity: 0.7 }}>
                            {t('subject_files')}:
                          </span>
                          <div className="files-column-list">
                            {assignSubjectFiles.map((sf, sfIdx) => {
                              const downloadUrl = buildFileDownloadUrl(sf.fileUrl, token);
                              const openUrl = buildFileOpenUrl(sf.fileUrl, token);
                              return (
                                <div key={sfIdx} className="submitted-file-chip file-column-item" style={{ background: 'rgba(255, 255, 255, 0.03)', borderColor: 'var(--border)' }}>
                                  <span style={{ fontSize: '0.75rem' }}>📂 {sf.fileName}</span>
                                  <a href={openUrl} target="_blank" rel="noreferrer" className="file-action-btn" style={{ color: '#10b981', borderColor: 'rgba(16, 185, 129, 0.3)' }} onClick={(ev) => handleOpenFileInNewTab(ev, sf.fileUrl, token, sf.fileName)}>
                                    {t('open_file')}
                                  </a>
                                  <a href={downloadUrl} download={sf.fileName} target="_blank" rel="noreferrer" className="file-action-btn file-download-btn" title={t('download_file')} aria-label={t('download_file')}>
                                    <DownloadIcon size={12} />
                                  </a>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {a.submittedFiles && a.submittedFiles.length > 0 && (
                        <div className="files-column-group" style={{ marginBottom: '0.6rem' }}>
                          <span className="files-column-label" style={{ fontSize: '0.75rem', opacity: 0.7 }}>
                            {lang === 'he' ? 'קבצים שהוגשו:' : 'Submitted files:'}
                          </span>
                          <div className="files-column-list">
                            {a.submittedFiles.map((att, attIdx) => {
                              const downloadUrl = buildFileDownloadUrl(att.url, token);
                              const openUrl = buildFileOpenUrl(att.url, token);
                              return (
                                <div key={`sub-${attIdx}`} className="submitted-file-chip file-column-item">
                                  <CheckIcon size={11} />
                                  <span style={{ fontSize: '0.75rem' }}>{att.name}</span>
                                  <a href={openUrl} target="_blank" rel="noreferrer" className="file-action-btn" style={{ color: '#10b981', borderColor: 'rgba(16, 185, 129, 0.3)' }} onClick={(ev) => handleOpenFileInNewTab(ev, att.url, token, att.name)}>
                                    {t('open_file')}
                                  </a>
                                  <a href={downloadUrl} download={att.name} target="_blank" rel="noreferrer" className="file-action-btn file-download-btn" title={t('download_file')} aria-label={t('download_file')}>
                                    <DownloadIcon size={12} />
                                  </a>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                        <button
                          className="secondary-btn btn-xs"
                          onClick={() => onToggleCompleted && onToggleCompleted(a.id)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        >
                          <CheckIcon size={12} />
                          <span>{a.status === 'Submitted' ? t('mark_incomplete') : t('mark_done')}</span>
                        </button>
                        <button
                          className="secondary-btn btn-xs"
                          onClick={() => onToggleHidden && onToggleHidden(a.id)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        >
                          {isHidden ? <EyeIcon /> : <EyeOffIcon />}
                          <span>{isHidden ? t('unhide_assignment') : t('hide_assignment')}</span>
                        </button>
                        {a.link && (
                          <a
                            href={a.link}
                            target="_blank"
                            rel="noreferrer"
                            className="secondary-btn btn-xs"
                            data-moodle-link="true"
                          >
                            <span>{t('submit_assignment')}</span>
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// 7. ABOUT TAB
function AboutTab({ t, lang, tourStep, onStartTour }: { t: (key: any) => string; lang: 'he' | 'en'; tourStep?: number; onStartTour: () => void }) {
  const isHe = lang === 'he';
  const manifestVersion = browser.runtime.getManifest()?.version || '5.1.1';

  return (
    <div className={`tab-about glass-panel ${tourStep === 9 ? 'tour-highlight' : ''}`} style={{ padding: '2.5rem', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* Brand Hero Header */}
      <div className="about-hero">
        <img src={logoImg} alt="Noodle Logo" className="about-hero-logo" />
        <div>
          <h2 style={{ fontSize: '2rem', margin: '0 0 0.35rem 0', display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <span>Noodle</span>
            <span style={{ fontSize: '0.85rem', padding: '0.2rem 0.55rem', background: 'rgba(255,255,255,0.1)', borderRadius: '12px', fontWeight: 'normal', color: 'var(--text-secondary)' }}>
              v{manifestVersion}
            </span>
          </h2>
          <p style={{ margin: 0, fontSize: '1.05rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
            {isHe
              ? 'מרכז השליטה המבוזר למודל אוניברסיטת תל אביב • נבנה עבור סטודנטים ב-TAU'
              : 'Decentralized Moodle Cockpit for Tel Aviv University Students'}
          </p>
        </div>
      </div>

      {/* Description & Credits Card */}
      <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1.25rem 1.5rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
        <p style={{ lineHeight: '1.8', fontSize: '1.1rem', margin: '0 0 1rem 0', color: 'var(--text-primary)' }}>
          {isHe ? (
            <>
              <strong>Noodle 🍜</strong> הוא כלי עזר חכם בקוד פתוח המאפשר לסנכרן מועדי הגשת מטלות מהמודל ישירות ל-Google Tasks וללוח השנה של גוגל, לסנן קישורי זום בזמן אמת, ולהוריד קבצים והנחיות במהירות ובפרטיות מוחלטת ללא שרתים חיצוניים.
            </>
          ) : (
            <>
              <strong>Noodle 🍜</strong> is a decentralized, client-only utility designed for TAU students. It syncs Moodle deadlines directly to Google Tasks and Google Calendar, organizes live Zoom recitations, provides fast offline-ready access to files, and protects your privacy without any external backend servers.
            </>
          )}
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem', fontSize: '1rem', color: 'var(--text-secondary)' }}>
          <span>❤️</span>
          <span>
            <strong>{t('developed_by')}</strong> {t('credits_authors')}
          </span>
        </div>

        {/* Action / Review / Repo Buttons */}
        <div className="about-actions-grid">
          <a
            href="https://chromewebstore.google.com/detail/noodle/nelflkccefbdpnaphjabcgkpakhdoope"
            target="_blank"
            rel="noreferrer"
            className="about-link-card"
          >
            <span>⭐</span>
            <span>{t('review_extension_label')}</span>
          </a>
          <a
            href="https://github.com/duck-5/Noodle"
            target="_blank"
            rel="noreferrer"
            className="about-link-card"
          >
            <span>🐙</span>
            <span>{t('github_repo_link')}</span>
          </a>
          <a
            href="https://github.com/duck-5/Noodle/issues"
            target="_blank"
            rel="noreferrer"
            className="about-link-card"
          >
            <span>🐛</span>
            <span>{t('github_issues_link')}</span>
          </a>
          <a
            href="mailto:noodle.d3v@gmail.com"
            className="about-link-card"
          >
            <span>✉️</span>
            <span>noodle.d3v@gmail.com</span>
          </a>
          <div
            className="about-link-card"
            onClick={onStartTour}
            style={{ cursor: 'pointer' }}
          >
            <span>🚀</span>
            <span>{isHe ? 'הפעל סיור מודרך' : 'Launch Onboarding Tour'}</span>
          </div>
        </div>
      </div>

      {/* Expandable Sections */}
      <div>
        {/* Accordion 1: Features */}
        <details className="about-accordion" open>
          <summary>
            <span>{t('about_features_title')}</span>
          </summary>
          <div className="about-accordion-content">
            {isHe ? (
              <ul>
                <li><strong>🔄 סנכרון דו-כיווני ל-Google Tasks ולוח שנה:</strong> דדליינים מהמודל מסונכרנים אוטומטית לרשימת המשימות שלך. משימות שסימנת כבוצעות או שמחקת מסונכרנות באופן שקוף.</li>
                <li><strong>🧪 זיהוי חכם לקורסי מעבדה:</strong> זיהוי אוטומטי של המילה "מעבדה" בשם הקורס והצעה להסתרת כל המטלות כברירת מחדל, כדי שלא תוצף בעשרות ניסויים שאינך נדרש להגיש.</li>
                <li><strong>🎯 Spotlight וספירה לאחור חיה:</strong> כרטיס המטלה הבאה מציג ספירה לאחור מדויקת עם צבעי התראה מותאמים אישית (ירוק/צהוב/אדום) וקישורי הגשה וקבצים ישירים.</li>
                <li><strong>📹 Zoom Hub לשיעורים ותרגולים:</strong> זיהוי הרצאות ותרגולים שמתקיימים כעת והצטרפות בלחיצה אחת, עם אפשרות להסתיר קבוצות תרגול לא רלוונטיות.</li>
                <li><strong>📁 גישה ישירה לקבצים ולהגשות:</strong> צפייה והורדה של קבצי הנחיות, קבצי נושא וקבצים שהגשת בעבר ישירות מתוך התוסף ללא מעבר בין דפי המודל.</li>
                <li><strong>🎨 ערכות נושא מותאמות:</strong> בחירה בין ערכת נושא כהה (Dark), נודלס חמים (Noodle 🍜), או קפה אספרסו עשיר (Coffee ☕).</li>
              </ul>
            ) : (
              <ul>
                <li><strong>🔄 2-Way Google Tasks & Calendar Sync:</strong> Automatically synchronize deadlines to Google Tasks with instant updates when assignments are marked done or submitted.</li>
                <li><strong>🧪 Lab Course Experiment Detection:</strong> Detects lab courses ("מעבדה") and offers to hide all assignments by default so you aren't overwhelmed with experiments you don't take.</li>
                <li><strong>🎯 Next Task Spotlight & Live Countdown:</strong> Real-time countdown for upcoming submissions with customizable color thresholds (green/yellow/red) and 1-click submission links.</li>
                <li><strong>📹 Zoom Hub:</strong> Highlights active lectures and recitations happening right now, with easy per-meeting visibility toggles to hide recitations you don't attend.</li>
                <li><strong>📁 Fast File Browser & Attachments:</strong> View and download subject materials, prompt PDFs, and your past submitted files without navigating endless Moodle pages.</li>
                <li><strong>🎨 Custom Themes:</strong> Switch anytime between Dark, Noodle (warm beige/orange 🍜), and Coffee (deep espresso ☕).</li>
              </ul>
            )}
          </div>
        </details>

        {/* Accordion 2: Usage Tips */}
        <details className="about-accordion">
          <summary>
            <span>{t('about_tips_title')}</span>
          </summary>
          <div className="about-accordion-content">
            {isHe ? (
              <ul>
                <li><strong>🧪 איך להשתמש במעבדות ביעילות?</strong> לאחר הוספת קורס מעבדה והסתרת כל המטלות, עבור ללשונית "מטלות", סמן את תיבת הסינון "מוסתרים", ולחץ על סמל העין (👁) רק ליד הניסויים שהוקצו לך. כך תראה בלוח הבקרה רק את הניסויים שבאמת עליך לבצע!</li>
                <li><strong>📅 סנכרון מטלות ללא תאריך יעד:</strong> סטודנטים רבים רוצים לראות גם פרויקטים פתוחים או תרגילי רשות ברשימת המשימות שלהם. ניתן להפעיל זאת בקלות בהגדרות Google Tasks.</li>
                <li><strong>🎨 כינויי קורסים וצבעים:</strong> לחץ על "ניהול קורסים" בלוח הבקרה והענק לכל קורס שם קצר ומוכר וצבע ייחודי שיסונכרן בכל הממשק.</li>
                <li><strong>💾 גיבוי ושחזור קונפיגורציה:</strong> עובר למחשב אחר או משתמש גם בפיירפוקס? ייצא קובץ גיבוי בלשונית ההגדרות וייבא אותו בשניות בכל דפדפן.</li>
                <li><strong>⌨️ קיצורי דרך בסיור המודרך:</strong> השתמש במקשי החצים ימינה ושמאלה כדי לנווט בין שלבי הסיור, ולחץ על Esc כדי לצאת בכל עת.</li>
              </ul>
            ) : (
              <ul>
                <li><strong>🧪 How to efficiently handle lab courses:</strong> When adding a lab course, choose to hide all assignments. Then head over to the Assignments tab, check the "Hidden" filter, and click the eye icon (👁) only on the experiments you actually need to submit!</li>
                <li><strong>📅 Syncing tasks without a deadline:</strong> If you want ongoing projects and optional exercises to appear in your Google Tasks, enable "Sync assignments without deadline" under Settings.</li>
                <li><strong>🎨 Custom Course Nicknames & Colors:</strong> Tap "Manage Courses" on your dashboard to assign short nicknames and distinct colors for instant recognition across all tabs.</li>
                <li><strong>💾 Cross-device Backup & Restore:</strong> Switching laptops or using both Chrome and Firefox? Export your JSON config in Settings and import it anywhere in seconds.</li>
                <li><strong>⌨️ Keyboard Navigation:</strong> During the interactive tour, use arrow keys to navigate forward/back and hit Escape to exit at any time.</li>
              </ul>
            )}
          </div>
        </details>

        {/* Accordion 3: Privacy */}
        <details className="about-accordion">
          <summary>
            <span>{t('about_privacy_title')}</span>
          </summary>
          <div className="about-accordion-content">
            {isHe ? (
              <ul>
                <li><strong>🔒 100% Client-Only & Decentralized:</strong> Noodle פועל אך ורק בתוך הדפדפן שלך. אין לנו שרת מרכזי, שרת פרוקסי או בסיס נתונים בענן.</li>
                <li><strong>🚫 ללא מעקב או טלמטריה:</strong> אפס מעקב (Analytics), אפס קוקיות מעקב ואפס שיתוף נתונים עם צדדים שלישיים.</li>
                <li><strong>🛡️ אחסון מקומי מאובטח:</strong> פרטי החיבור ואסימון הגישה למודל נשמרים מוצפנים באחסון המקומי של הדפדפן שלך בלבד (browser.storage.local).</li>
                <li><strong>🌐 קוד פתוח ושקוף:</strong> הקוד זמין במלואו לבדיקה ותרומה ב-GitHub, ונכתב מתוך אהבה ומחויבות לקהילת הסטודנטים ב-TAU.</li>
              </ul>
            ) : (
              <ul>
                <li><strong>🔒 100% Client-Only & Decentralized:</strong> Noodle executes entirely within your browser. There is no middleman server, proxy, or backend database.</li>
                <li><strong>🚫 Zero Analytics or Telemetry:</strong> No tracking scripts, no behavioral telemetry, and no third-party data collection whatsoever.</li>
                <li><strong>🛡️ Secure Local Storage:</strong> All credentials and Moodle access tokens are stored strictly within your browser's private local storage (browser.storage.local).</li>
                <li><strong>🌐 Open Source Transparency:</strong> The complete codebase is open on GitHub for auditing, contributions, and community improvements.</li>
              </ul>
            )}
          </div>
        </details>
      </div>
    </div>
  );
}

// 8. TOUR OVERLAY
interface TourOverlayProps {
  step: number;
  setStep: (s: number) => void;
  onClose: () => void;
  t: (key: any) => string;
  lang: 'he' | 'en';
}

function TourOverlay({ step, setStep, onClose, t, lang }: TourOverlayProps) {
  const steps = [
    {
      icon: '🍜',
      title: t('tour_welcome_title'),
      tag: t('tour_welcome_tag'),
      desc: t('tour_welcome_desc'),
      chips: lang === 'he' ? ['מודל את"א', 'ללא שרת', 'פרטיות מלאה'] : ['TAU Moodle', 'Decentralized', 'Zero Server'],
    },
    {
      icon: '🔄',
      title: t('tour_sync_btn_title'),
      tag: t('tour_sync_btn_tag'),
      desc: t('tour_sync_btn_desc'),
      chips: lang === 'he' ? ['סנכרון מיידי', 'ללא שרת', 'Google Tasks'] : ['Live Sync', 'Direct Moodle', 'Google Tasks'],
    },
    {
      icon: '🎯',
      title: t('tour_next_task_title'),
      tag: t('tour_next_task_tag'),
      desc: t('tour_next_task_desc'),
      chips: lang === 'he' ? ['ספירה לאחור חיה', 'הגשה בלחיצה', 'קבצי הנחיות ונושא'] : ['Live Countdown', '1-Click Submit', 'Subject Files'],
    },
    {
      icon: '✅',
      title: t('tour_tasks_actions_title'),
      tag: t('tour_tasks_actions_tag'),
      desc: t('tour_tasks_actions_desc'),
      chips: lang === 'he' ? ['סימון כבוצע ✓', 'הסתרת משימות 👁', 'תור דינמי'] : ['Mark Done ✓', 'Hide Tasks 👁', 'Dynamic Queue'],
    },
    {
      icon: '🎨',
      title: t('tour_courses_custom_title'),
      tag: t('tour_courses_custom_tag'),
      desc: t('tour_courses_custom_desc'),
      chips: lang === 'he' ? ['כינויים מקוצרים', 'פלטות צבעים', 'סינון סמסטרים'] : ['Short Nicknames', 'Color Palettes', 'Semester Tracking'],
    },
    {
      icon: '📹',
      title: t('tour_zoom_visibility_title'),
      tag: t('tour_zoom_visibility_tag'),
      desc: t('tour_zoom_visibility_desc'),
      chips: lang === 'he' ? ['פעיל כעת ●', 'סינון תרגולים (👁)', 'הצטרפות ישירה'] : ['Active Now ●', 'Filter Recitations (👁)', 'Direct Zoom Link'],
    },
    {
      icon: '📋',
      title: t('tour_tab_assignments_title'),
      tag: t('tour_tab_assignments_tag'),
      desc: t('tour_tab_assignments_desc'),
      chips: lang === 'he' ? ['חיפוש מהיר', '4 מסנני סטטוס', 'מגירת חומרי קורס'] : ['Instant Search', '4 Status Filters', 'Course Files Drawer'],
    },
    {
      icon: '📊',
      title: t('tour_tab_grades_title'),
      tag: t('tour_tab_grades_tag'),
      desc: t('tour_tab_grades_desc'),
      chips: lang === 'he' ? ['ממוצע משוקלל', 'התפלגות ציונים', 'שקלול אוטומטי'] : ['GPA Tracker', 'Components Breakdown', 'Auto Weighted'],
    },
    {
      icon: '⚙️',
      title: t('tour_google_tasks_title'),
      tag: t('tour_google_tasks_tag'),
      desc: t('tour_google_tasks_desc'),
      chips: lang === 'he' ? ['סנכרון דו-כיווני', 'ערכות נושא (קפה / נודלס)', 'התראות מותאמות'] : ['2-Way Sync', 'Themes (Coffee/Noodle)', 'Custom Alerts'],
    },
    {
      icon: '🚀',
      title: t('tour_finish_title'),
      tag: t('tour_finish_tag'),
      desc: t('tour_finish_desc'),
      chips: lang === 'he' ? ['הפעלה מחדש מ"אודות"', 'קיצורי מקלדת', 'בהצלחה בסמסטר!'] : ['Restart via About', 'Keyboard Shortcuts', 'Good Luck!'],
    },
  ];

  const currentStep = steps[step] || steps[0];
  const isHighlightStep = step >= 1 && step <= 8;

  // Auto-scroll to highlighted element with smooth animation
  useEffect(() => {
    if (isHighlightStep) {
      const timer = setTimeout(() => {
        const highlightedEl = document.querySelector('.tour-highlight');
        if (highlightedEl) {
          highlightedEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 160);
      return () => clearTimeout(timer);
    }
  }, [step, isHighlightStep]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      const isNextKey = lang === 'he' ? e.key === 'ArrowLeft' : e.key === 'ArrowRight';
      const isBackKey = lang === 'he' ? e.key === 'ArrowRight' : e.key === 'ArrowLeft';

      if (isNextKey) {
        e.preventDefault();
        if (step < steps.length - 1) {
          setStep(step + 1);
        } else {
          onClose();
        }
      } else if (isBackKey) {
        e.preventDefault();
        if (step > 0) {
          setStep(step - 1);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [step, lang, onClose, setStep, steps.length]);

  const handleNext = () => {
    if (step < steps.length - 1) {
      setStep(step + 1);
    } else {
      onClose();
    }
  };

  const handleBack = () => {
    if (step > 0) {
      setStep(step - 1);
    }
  };

  return (
    <div className={`tour-overlay ${isHighlightStep ? 'highlight-mode' : ''}`} dir={lang === 'he' ? 'rtl' : 'ltr'}>
      <div className="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-step-title">
        {/* Segmented Stepper */}
        <div className="tour-stepper" aria-label={`Step ${step + 1} of ${steps.length}`}>
          {steps.map((_, idx) => (
            <div
              key={idx}
              className={`tour-stepper-bar ${idx < step ? 'completed' : ''} ${idx === step ? 'active' : ''}`}
              onClick={() => setStep(idx)}
              title={`${idx + 1}. ${steps[idx].title}`}
            />
          ))}
        </div>

        {/* Header with Tag & Icon Badge */}
        <div className="tour-header">
          <div className="tour-badge-group">
            <span className="tour-icon-badge">{currentStep.icon}</span>
            <div className="tour-badge-text">
              <span className="tour-tag-pill">{currentStep.tag}</span>
              <span className="tour-step-indicator">{step + 1} / {steps.length}</span>
            </div>
          </div>
          <button
            className="tour-close-btn"
            onClick={onClose}
            aria-label={t('tour_skip')}
            title={t('tour_skip')}
          >
            ✕
          </button>
        </div>

        {/* Step Title & Body */}
        <div className="tour-body">
          <h3 id="tour-step-title" className="tour-title">{currentStep.title}</h3>
          <p className="tour-desc">{currentStep.desc}</p>
        </div>

        {/* Feature Chips */}
        {currentStep.chips && currentStep.chips.length > 0 && (
          <div className="tour-chips-container">
            {currentStep.chips.map((chip, cIdx) => (
              <span key={cIdx} className="tour-chip">
                {chip}
              </span>
            ))}
          </div>
        )}

        {/* Keyboard hints banner */}
        <div className="tour-keyboard-hint-row">
          <span className="tour-key-badge">{lang === 'he' ? '←' : '→'}</span>
          <span className="tour-key-badge">{lang === 'he' ? '→' : '←'}</span>
          <span className="tour-key-badge">Esc</span>
          <span className="tour-hint-text">{t('tour_keyboard_hint')}</span>
        </div>

        {/* Action Footer */}
        <div className="tour-footer">
          <button className="secondary-btn btn-sm" onClick={onClose}>
            {t('tour_skip')}
          </button>

          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            {step > 0 && (
              <button className="secondary-btn btn-sm" onClick={handleBack}>
                {t('tour_back')}
              </button>
            )}
            <button className="primary-btn btn-sm" onClick={handleNext}>
              {step === steps.length - 1 ? t('tour_finish') : t('tour_next')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
