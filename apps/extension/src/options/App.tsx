import browser from 'webextension-polyfill';
import { useState, useEffect } from 'react';
import type { SyncResult, Assignment, CourseFile, ZoomMeeting } from '@tautracker/moodle-client';
import { parseTauCourseMetadata, MoodleClient, isValidIsraeliId } from '@tautracker/moodle-client';
import {
  getStoredToken,
  setStoredToken,
  getStoredSesskey,
  getTrackedCourseIds,
  setTrackedCourseIds,
  getCachedSyncResult,
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

  useEffect(() => {
    const handleGlobalClick = async (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const link = target.closest('a');
      if (link && link.href && link.href.includes('moodle.tau.ac.il') && link.dataset.moodleLink === 'true') {
        e.preventDefault();
        e.stopPropagation();

        const cookie = await browser.cookies.get({ url: 'https://moodle.tau.ac.il', name: 'MoodleSession' });
        if (cookie) {
          browser.tabs.create({ url: link.href });
          return;
        }

        const creds = await getMoodleCredentials();
        if (creds && creds.password) {
          try {
            await browser.runtime.sendMessage({
              type: 'LOGIN_TAU_SSO',
              username: creds.username,
              idNumber: creds.idNumber,
              pass: creds.password,
              skipInvalidate: true
            });
            browser.tabs.create({ url: link.href });
          } catch (err) {
            console.error('SSO auto-login failed', err);
            browser.tabs.create({ url: link.href });
          }
        } else {
          browser.tabs.create({ url: link.href });
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
    if (tourStep === 0 || tourStep === 1 || tourStep === 2) {
      setActiveTab('dashboard');
      setSelectedCourseId(null);
    } else if (tourStep === 3 || tourStep === 4) {
      setActiveTab('courses');
      setSelectedCourseId(null);
    } else if (tourStep === 5 || tourStep === 6) {
      setActiveTab('settings');
      setSelectedCourseId(null);
    } else if (tourStep === 7) {
      setActiveTab('dashboard');
      setSelectedCourseId(null);
    }
  }, [tourStep]);

  const handleCloseTour = async () => {
    setShowTour(false);
    setTourStep(-1);
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


  // Backup and custom disconnect states
  const [showDisconnectModal, setShowDisconnectModal] = useState<boolean>(false);
  const [deletePermanently, setDeletePermanently] = useState<boolean>(false);

  const [nextSyncSecs, setNextSyncSecs] = useState<number | null>(null);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  useEffect(() => {
    browser.storage.local.get('isSyncing').then((res: any) => {
      if (res.isSyncing !== undefined) setIsSyncing(res.isSyncing);
    });

    const updateCountdown = async () => {
      try {
        const alarm = await browser.alarms.get('periodicSync');
        const targetTime = alarm?.scheduledTime || (syncResult?.syncedAt ? new Date(syncResult.syncedAt).getTime() + 5 * 60 * 1000 : null);
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
  }, [syncResult?.syncedAt]);

  useEffect(() => {
    const messageListener = (msg: any) => {
      if (msg.type === 'SYNC_START') {
        setIsSyncing(true);
      }
      if (msg.type === 'SYNC_PARTIAL') {
        getCachedSyncResult().then(cached => {
          if (cached) setSyncResult(cached);
        });
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
      if (areaName === 'local' && changes.wstoken && changes.wstoken.newValue) {
        // If the token is identical to our current state or we are in active course selection, avoid re-running onboarding
        if (changes.wstoken.newValue !== token && onboardingStep !== 2) {
          loadData();
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



  async function handleOnboardingCourseToggle(courseId: number) {
    if (trackedCourseIds.includes(courseId)) {
      setTrackedCourseIdsState(trackedCourseIds.filter((id) => id !== courseId));
    } else {
      setTrackedCourseIdsState([...trackedCourseIds, courseId]);
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
    await setSettings(updated);
  }

  async function handleUpdateGoogleListName(name: string) {
    if (!settings) return;
    const updated = { ...settings, googleTasksListName: name };
    setSettingsState(updated);
    await setSettings(updated);
  }

  async function handleToggleMeetingInterest(meetingNumber: string, allMeetingNumbers: string[]) {
    if (!settings) return;
    let currentInterested = settings.interestedMeetings;
    if (currentInterested === undefined) {
      currentInterested = allMeetingNumbers;
    }
    let updatedInterested;
    if (currentInterested.includes(meetingNumber)) {
      updatedInterested = currentInterested.filter((num) => num !== meetingNumber);
    } else {
      updatedInterested = [...currentInterested, meetingNumber];
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
      } else {
        setGoogleSyncStatus(`Google Sync failed: ${res.error}`);
      }
    } catch (e: any) {
      setGoogleSyncStatus(`Google Sync failed: ${e.message}`);
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
  }

  const getCourseColor = (courseId: number) => {
    return settings?.coursesColorMap[courseId] || '#6366f1';
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
  const rawAssignments = syncResult?.assignments || [];
  const completedIds = settings?.completedAssignments || [];
  const uncompletedIds = settings?.uncompletedAssignments || [];

  const assignmentsList = rawAssignments.map(a => {
    const isMoodleSubmitted = a.status === 'Submitted';
    const isManuallyCompleted = completedIds.includes(a.id);
    const isManuallyToDo = uncompletedIds.includes(a.id);

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
              {isSyncing ? (
                <span style={{ fontSize: '0.85rem', background: 'rgba(255,255,255,0.1)', padding: '0.2rem 0.5rem', borderRadius: 'var(--radius-sm)' }}>
                  ⏱️ {currentLang === 'he' ? 'מסנכרן...' : 'Syncing...'}
                </span>
              ) : nextSyncSecs !== null && nextSyncSecs > 0 ? (
                <span style={{ fontSize: '0.85rem', background: 'rgba(255,255,255,0.1)', padding: '0.2rem 0.5rem', borderRadius: 'var(--radius-sm)' }}>
                  ⏱️ {Math.floor(nextSyncSecs / 60)}:{(nextSyncSecs % 60).toString().padStart(2, '0')}
                </span>
              ) : null}
            </p>
          </div>
          <div className="header-actions" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button
              className="secondary-btn btn-sm"
              title={currentLang === 'he' ? 'ערכת נושא' : 'Theme'}
              onClick={async () => {
                if (!settings) return;
                const nextTheme: 'dark' | 'noodle' | 'coffee' = settings.theme === 'coffee' ? 'dark' : settings.theme === 'dark' ? 'noodle' : 'coffee';
                const updated = { ...settings, theme: nextTheme };
                setSettingsState(updated);
                await setSettings(updated);
              }}
            >
              {settings?.theme === 'coffee' ? '☕' : settings?.theme === 'noodle' ? '🍜' : '🌙'}
            </button>
            <button className="primary-btn btn-sm" onClick={handleManualSync} disabled={loading}>
              {loading ? t('syncing') : `🔄 ${t('sync_now')}`}
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
              onToggleCompleted={handleToggleCompleted}
              onToggleHidden={handleToggleHidden}
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
            />
          ) : activeTab === 'assignments' ? (
            <AssignmentsTab
              assignments={assignmentsList}
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
              onExportConfig={handleExportConfig}
              onImportConfig={handleImportConfig}
              tourStep={tourStep}
            />
          )}

          {activeTab === 'about' && (
            <AboutTab
              t={t}
              lang={currentLang}
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

      {showTour && (
        <TourOverlay
          step={tourStep}
          setStep={setTourStep}
          onClose={handleCloseTour}
          t={t}
          lang={currentLang}
        />
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

const EyeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle' }}>
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const EyeOffIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle' }}>
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

const CheckIcon = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const ExternalLinkIcon = ({ size = 12 }: { size?: number }) => (
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
}: {
  assignments: EnhancedAssignment[];
  meetings: ZoomMeeting[];
  token: string | null;
  settings: ExtensionSettings | null;
  tourStep?: number;
  onToggleMeetingInterest: (meetingNumber: string, allMeetingIds: string[]) => void;
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
} & TabProps) {
  const [isNextExpanded, setIsNextExpanded] = useState<boolean>(false);
  const [expandedUpcomingId, setExpandedUpcomingId] = useState<number | null>(null);
  const [expandedCourseId, setExpandedCourseId] = useState<number | null>(null);
  const [isManageModalOpen, setIsManageModalOpen] = useState<boolean>(false);
  const [isNextMenuOpen, setIsNextMenuOpen] = useState<boolean>(false);

  const visibleAssignments = assignments.filter((a) => !settings?.hiddenAssignments?.includes(a.id));
  const now = new Date();

  // Sort assignments by due date ascending
  const sortedAssigns = [...assignments].sort((a, b) => {
    if (!a.deadline && !b.deadline) return 0;
    if (!a.deadline) return 1;
    if (!b.deadline) return -1;
    return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
  });

  // Find the closest future assignment (Hero spotlight)
  const nextAssignment = sortedAssigns.find(
    (a) => a.deadline && new Date(a.deadline) > now && !settings?.hiddenAssignments?.includes(a.id) && a.status !== 'Submitted'
  );

  // Top actionable upcoming tasks (excluding hero and completed/hidden)
  const upcomingTasks = sortedAssigns
    .filter(
      (a) =>
        a.id !== nextAssignment?.id &&
        !settings?.hiddenAssignments?.includes(a.id) &&
        a.status !== 'Submitted' &&
        a.deadline &&
        new Date(a.deadline) > now
    )
    .slice(0, 3);

  // Active Zoom meetings right now
  const activeMeetings = meetings.filter((m) => getMeetingStatus(m.startTime) === 'active');

  // Semester progress calculation
  const totalAssignCount = visibleAssignments.length;
  const completedAssignCount = visibleAssignments.filter((a) => a.status === 'Submitted').length;
  const semProgressPercent = totalAssignCount > 0 ? Math.round((completedAssignCount / totalAssignCount) * 100) : 0;

  return (
    <div className="tab-dashboard">
      {/* 1. Hero Action Strip: Hero Spotlight + Upcoming To-Do Queue */}
      <div className="hero-action-strip">
        {/* Left: Hero Spotlight Card */}
        {nextAssignment ? (
          <div
            className={`hero-spotlight-card next-assignment-banner glass-panel ${tourStep === 1 ? 'tour-highlight' : ''}`}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('a, button, input')) return;
              setIsNextExpanded(!isNextExpanded);
            }}
          >
            <div>
              <div className="spotlight-badge-row">
                <span className="spotlight-label">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  {t('next_assignment')}
                </span>
                {nextAssignment.deadline && (
                  <span className={`badge ${getDueTextAndClass(nextAssignment.deadline, lang, settings?.assignmentGreenDaysThreshold, settings?.assignmentYellowDaysThreshold, false, nextAssignment.status).badgeClass}`}>
                    {getDueTextAndClass(nextAssignment.deadline, lang, settings?.assignmentGreenDaysThreshold, settings?.assignmentYellowDaysThreshold, false, nextAssignment.status).deadlineText}
                  </span>
                )}
              </div>

              <h3 className="hero-task-title">{nextAssignment.name}</h3>

              <div className="hero-course-tag" style={{ color: getCourseColor(nextAssignment.courseId) }}>
                <span className="course-color-dot" style={{ backgroundColor: getCourseColor(nextAssignment.courseId) }} />
                <span>{getCourseDisplayName(nextAssignment.courseId, nextAssignment.courseName)}</span>
              </div>

              {nextAssignment.attachments && nextAssignment.attachments.length > 0 && (
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                  {nextAssignment.attachments.map((att, attIdx) => {
                    const downloadUrl = token ? `${att.url}${att.url.includes('?') ? '&' : '?'}token=${token}` : att.url;
                    return (
                      <div key={attIdx} className="submitted-file-chip" style={{ background: 'rgba(255,255,255,0.04)', borderColor: 'var(--border)' }}>
                        <span style={{ fontSize: '0.8rem' }}>📄 {att.name}</span>
                        <a href={downloadUrl} target="_blank" rel="noreferrer" className="file-action-btn" onClick={(ev) => ev.stopPropagation()}>
                          {t('open_file')}
                        </a>
                        <a href={downloadUrl} target="_blank" rel="noreferrer" className="file-action-btn" onClick={(ev) => ev.stopPropagation()}>
                          <span>{t('download_file')}</span>
                          <DownloadIcon size={11} />
                        </a>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div>
              <div className="hero-actions-row">
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
                    setIsNextExpanded(!isNextExpanded);
                  }}
                  title={isNextExpanded ? 'Collapse' : 'Expand'}
                >
                  <ChevronDownIcon size={13} expanded={isNextExpanded} />
                </button>
              </div>

              {/* Expanding subject (section) element */}
              <div
                className={`expanded-subject-container ${isNextExpanded ? 'open' : ''}`}
                onClick={(ev) => ev.stopPropagation()}
                style={{ textAlign: lang === 'he' ? 'right' : 'left', marginTop: isNextExpanded ? '0.75rem' : '0' }}
              >
                <div className="expanded-toolbar-row">
                  <div className="expanded-subject-info">
                    <span className="subject-pill">
                      <FolderIcon size={13} />
                      <span className="subject-label">{t('subject_label')}:</span>
                      <span className="subject-val">{nextAssignment.sectionName || (lang === 'he' ? 'כללי' : 'General')}</span>
                    </span>
                  </div>
                  <div className="expanded-actions-group">
                    <button
                      className="card-action-btn card-action-btn-ghost"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setIsNextMenuOpen(!isNextMenuOpen);
                      }}
                      title={t('more_actions')}
                    >
                      <span>⋯</span>
                      <span>{t('more_actions')}</span>
                    </button>
                  </div>
                </div>

                {isNextMenuOpen && (
                  <div className="card-revealed-menu" onClick={(ev) => ev.stopPropagation()}>
                    <button
                      className={`card-action-btn ${nextAssignment.isCompleted ? 'card-action-btn-completed' : 'card-action-btn-complete'}`}
                      onClick={() => {
                        onToggleCompleted && onToggleCompleted(nextAssignment.id);
                        setIsNextMenuOpen(false);
                      }}
                    >
                      <CheckIcon size={13} />
                      <span>{nextAssignment.isCompleted ? t('mark_incomplete') : t('mark_done')}</span>
                    </button>
                    <button
                      className="card-action-btn card-action-btn-ghost"
                      onClick={() => {
                        onToggleHidden && onToggleHidden(nextAssignment.id);
                        setIsNextMenuOpen(false);
                      }}
                    >
                      {settings?.hiddenAssignments?.includes(nextAssignment.id) ? <EyeIcon /> : <EyeOffIcon />}
                      <span>{settings?.hiddenAssignments?.includes(nextAssignment.id) ? t('unhide_assignment') : t('hide_assignment')}</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="hero-spotlight-card next-assignment-banner glass-panel" style={{ justifyContent: 'center', alignItems: 'center', minHeight: '160px' }}>
            <span style={{ fontSize: '1.1rem', color: 'var(--text-secondary)' }}>🎉 {t('all_caught_up')}</span>
          </div>
        )}

        {/* Right: Upcoming To-Do Queue */}
        <div className="queue-card glass-panel">
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
                      {task.attachments && task.attachments.length > 0 && (
                        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                          {task.attachments.map((att, attIdx) => {
                            const downloadUrl = token ? `${att.url}${att.url.includes('?') ? '&' : '?'}token=${token}` : att.url;
                            return (
                              <div key={attIdx} className="submitted-file-chip" style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'var(--border)' }}>
                                <span style={{ fontSize: '0.75rem' }}>📄 {att.name}</span>
                                <a href={downloadUrl} target="_blank" rel="noreferrer" className="file-action-btn">
                                  {t('open_file')}
                                </a>
                                <a href={downloadUrl} target="_blank" rel="noreferrer" className="file-action-btn">
                                  <span>{t('download_file')}</span>
                                  <DownloadIcon size={11} />
                                </a>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.4rem', flexWrap: 'wrap', gap: '0.4rem' }}>
                        <span className="subject-pill">
                          <FolderIcon size={12} />
                          <span style={{ fontSize: '0.75rem' }}>{task.sectionName || (lang === 'he' ? 'כללי' : 'General')}</span>
                        </span>
                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                          <button
                            className="secondary-btn btn-xs"
                            onClick={() => onGoToCourse(task.courseId)}
                          >
                            <BookOpenIcon size={11} />
                            <span>{t('go_to_course')}</span>
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
        <div className="multi-zoom-strip">
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
        <div className="courses-list-header">
          <h3 style={{ margin: 0 }}>{t('my_courses')}</h3>
          <button
            className="secondary-btn btn-sm manage-courses-trigger-btn"
            onClick={() => setIsManageModalOpen(true)}
          >
            ⚙️ {t('manage_courses')}
          </button>
        </div>

        <div className="courses-rows-container">
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
                .sort((a, b) => new Date(a.deadline || 0).getTime() - new Date(b.deadline || 0).getTime());

              const nextTask = pendingCourseAssigns[0];
              const nextTaskName = nextTask ? nextTask.name : t('all_caught_up');
              const nextTaskDue = nextTask?.deadline
                ? getDueTextAndClass(nextTask.deadline, lang, settings?.assignmentGreenDaysThreshold, settings?.assignmentYellowDaysThreshold, false, nextTask.status).deadlineText
                : '';

              const isMarked = (m: ZoomMeeting) => {
                if (!settings?.interestedMeetings) return false;
                const id = `${m.courseName}:${m.meetingNumber || ''}${m.title}`;
                return settings.interestedMeetings.includes(id);
              };

              // Deduplicate meetings
              const dedupedMeetings: ZoomMeeting[] = [];
              const seenZoomKeys = new Set<string>();
              courseMeetings.forEach((m) => {
                const k = m.meetingNumber || m.meetingUrl;
                if (!seenZoomKeys.has(k)) {
                  seenZoomKeys.add(k);
                  dedupedMeetings.push(m);
                }
              });

              const visibleMeetings = dedupedMeetings.filter(isMarked);
              const isExpanded = expandedCourseId === cid;

              const next5Assignments = [...courseAssigns]
                .sort((a, b) => {
                  if ((a.status === 'Submitted') !== (b.status === 'Submitted')) {
                    return a.status === 'Submitted' ? 1 : -1;
                  }
                  return new Date(a.deadline || 0).getTime() - new Date(b.deadline || 0).getTime();
                })
                .slice(0, 5);

              const rawCourseName = courseAssigns[0]?.courseName || courseMeetings[0]?.courseName || `Course ${cid}`;
              const courseDisplayName = getCourseDisplayName(cid, rawCourseName);
              const allMeetingIds = meetings.map((m) => `${m.courseName}:${m.meetingNumber || ''}${m.title}`);

              return (
                <div
                  key={cid}
                  className="course-row-card glass-panel"
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
                    <div className="course-expanded-section">
                      <div className="course-expanded-section-title">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
                        <span>{t('visible_zoom_links')} ({visibleMeetings.length})</span>
                      </div>

                      {visibleMeetings.length === 0 ? (
                        <div style={{ fontSize: '0.825rem', color: 'var(--text-muted)', padding: '0.4rem 0' }}>
                          {t('no_zoom')}
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                          {visibleMeetings.map((m, mIdx) => {
                            const isActive = getMeetingStatus(m.startTime) === 'active';
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
                                      const keyId = `${m.courseName}:${m.meetingNumber || ''}${m.title}`;
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
                          })}
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
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                          {next5Assignments.map((a) => {
                            const { badgeClass, deadlineText } = getDueTextAndClass(
                              a.deadline || null,
                              lang,
                              settings?.assignmentGreenDaysThreshold,
                              settings?.assignmentYellowDaysThreshold,
                              false,
                              a.status
                            );

                            return (
                              <div key={a.id} className="course-mini-assign-item">
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', minWidth: 0, flex: 1 }}>
                                  <span style={{ fontSize: '0.9rem', color: a.status === 'Submitted' ? '#10b981' : 'var(--text-muted)' }}>
                                    {a.status === 'Submitted' ? '✓' : '○'}
                                  </span>
                                  <span className="course-mini-assign-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {a.name}
                                  </span>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                                  <span className={`badge ${badgeClass}`} style={{ fontSize: '0.72rem', padding: '0.15rem 0.45rem' }}>
                                    {deadlineText}
                                  </span>
                                  {a.attachments && a.attachments.length > 0 && (
                                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                                      {a.attachments.map((att, attIdx) => {
                                        const downloadUrl = token ? `${att.url}${att.url.includes('?') ? '&' : '?'}token=${token}` : att.url;
                                        return (
                                          <a key={attIdx} href={downloadUrl} target="_blank" rel="noreferrer" className="file-action-btn" title={att.name}>
                                            <DownloadIcon size={11} />
                                          </a>
                                        );
                                      })}
                                    </div>
                                  )}
                                  {a.link && (
                                    <a href={a.link} target="_blank" rel="noreferrer" className="file-action-btn" data-moodle-link="true">
                                      <ExternalLinkIcon size={11} />
                                    </a>
                                  )}
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
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            backdropFilter: 'blur(4px)',
            padding: '1.5rem'
          }}
          onClick={() => setIsManageModalOpen(false)}
        >
          <div
            className="modal-content glass-panel"
            style={{
              maxWidth: '850px',
              width: '100%',
              maxHeight: '85vh',
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
  token,
  getCourseColor,
  getCourseDisplayName,
  filterCourseId,
  onClearFilter,
  onGoToCourse,
  settings,
  t,
  lang,
  onToggleCompleted,
  onToggleHidden,
}: {
  assignments: EnhancedAssignment[];
  token: string | null;
  filterCourseId: number | null;
  onClearFilter: () => void;
  onGoToCourse: (courseId: number) => void;
  settings: ExtensionSettings | null;
  onToggleCompleted?: (assignmentId: number) => void;
  onToggleHidden?: (assignmentId: number) => void;
} & TabProps) {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterPending, setFilterPending] = useState<boolean>(true);
  const [filterPast, setFilterPast] = useState<boolean>(false);
  const [filterCompleted, setFilterCompleted] = useState<boolean>(false);
  const [filterHidden, setFilterHidden] = useState<boolean>(false);
  const [expandedAssignId, setExpandedAssignId] = useState<number | null>(null);

  const now = new Date();

  // Sort assignments by due date ascending
  const sortedAssigns = [...assignments].sort((a, b) => {
    if (!a.deadline && !b.deadline) return 0;
    if (!a.deadline) return 1;
    if (!b.deadline) return -1;
    return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
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

  return (
    <div className="tab-assignments">
      {/* Filter Bar */}
      <div className="filter-bar glass-panel" style={{ padding: '0.85rem 1.25rem' }}>
        <div className="search-input-box">
          <input
            type="text"
            className="search-input"
            placeholder={t('search_assignments_feed')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

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

            return (
              <div
                key={a.id}
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
                      <span className="assignment-tag tag-not-submitted" title={lang === 'he' ? 'הושלם ידנית - לא הוגש במודל' : 'Manually completed - not submitted in Moodle'}>
                        {t('not_submitted_tag')}
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
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                        {t('attachments')}:
                      </span>
                      {a.attachments.map((att, attIdx) => {
                        const downloadUrl = token ? `${att.url}${att.url.includes('?') ? '&' : '?'}token=${token}` : att.url;
                        return (
                          <div key={attIdx} className="submitted-file-chip" style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'var(--border)' }}>
                            <span className="file-name">📄 {att.name}</span>
                            <div className="file-actions-group" style={{ display: 'flex', gap: '0.35rem', marginInlineStart: '0.5rem' }}>
                              <a href={downloadUrl} target="_blank" rel="noreferrer" className="file-action-btn">
                                {t('open_file')}
                              </a>
                              <a href={downloadUrl} target="_blank" rel="noreferrer" className="file-action-btn">
                                <span>{t('download_file')}</span>
                                <DownloadIcon size={11} />
                              </a>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Submitted Files */}
                  {a.submittedFiles && a.submittedFiles.length > 0 && (
                    <div className="submitted-files-row" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                        {t('submitted_files')}:
                      </span>
                      {a.submittedFiles.map((sub, sIdx) => {
                        const downloadUrl = token ? `${sub.url}${sub.url.includes('?') ? '&' : '?'}token=${token}` : sub.url;
                        return (
                          <div key={`sub-${sIdx}`} className="submitted-file-chip">
                            <span className="file-check-badge">
                              <CheckIcon size={12} />
                            </span>
                            <span className="file-name">{sub.name}</span>
                            <div className="file-actions-group" style={{ display: 'flex', gap: '0.35rem', marginInlineStart: '0.5rem' }}>
                              <a href={downloadUrl} target="_blank" rel="noreferrer" className="file-action-btn">
                                {t('open_file')}
                              </a>
                              <a href={downloadUrl} target="_blank" rel="noreferrer" className="file-action-btn">
                                <span>{t('download_file')}</span>
                                <DownloadIcon size={11} />
                              </a>
                            </div>
                          </div>
                        );
                      })}
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
                        className="secondary-btn btn-sm"
                        onClick={() => onGoToCourse(a.courseId)}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                      >
                        <BookOpenIcon size={13} />
                        <span>{t('go_to_course')}</span>
                      </button>

                      <button
                        className="secondary-btn btn-sm"
                        onClick={() => onToggleCompleted && onToggleCompleted(a.id)}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                      >
                        <CheckIcon size={13} />
                        <span>{isCompleted ? t('mark_incomplete') : t('mark_done')}</span>
                      </button>

                      <button
                        className="secondary-btn btn-sm"
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
                          className="primary-btn btn-sm"
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
    </div>
  );
}





// 4. GRADES TAB
function GradesTab({
  assignments,
  getCourseColor,
  getCourseDisplayName,
  t,
}: {
  assignments: Assignment[];
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
        <div className="stat-card glass-panel border-left-secondary" style={{ maxWidth: '300px' }}>
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
  t,
  lang,
  onUpdateLanguage,
  onUpdateTheme,
  onUpdateThresholds,
  onToggleScraping,
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
  onUpdateLanguage: (l: 'he' | 'en') => void;
  onUpdateTheme: (theme: 'dark' | 'noodle' | 'coffee') => void;
  onUpdateThresholds: (green: number, yellow: number) => void;
  onToggleScraping?: (enabled: boolean) => void;
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
      <div className={`settings-section ${tourStep === 5 ? 'tour-highlight' : ''}`}>
        <h4>{t('google_tasks_sync_title')}</h4>
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



            <div className="tasks-action-row">
              <button className="primary-btn btn-sm" onClick={onSyncGoogle} disabled={googleSyncLoading}>
                {googleSyncLoading ? t('syncing') : `🔗 ${t('auth_sync_google')}`}
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
                await setSettings({ notificationsEnabled: e.target.checked });
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
      <div className={`settings-section ${tourStep === 6 ? 'tour-highlight' : ''}`}>
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
  onToggleCompleted,
  onToggleHidden,
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
  onToggleCompleted?: (assignmentId: number) => void;
  onToggleHidden?: (assignmentId: number) => void;
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

  // Order assignments for this course by due date
  const sortedCourseAssigns = [...courseAssignments].sort((a, b) => {
    if (!a.deadline && !b.deadline) return 0;
    if (!a.deadline) return 1;
    if (!b.deadline) return -1;
    return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
  });

  return (
    <div className="course-detail-view glass-panel" style={{ borderTop: `6px solid ${courseColor}` }}>
      <div className="detail-header">
        <button className="back-btn" onClick={onBack}>
          {t('back_to_courses')}
        </button>
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

            // Deduplicate recurring meetings by meetingNumber or meetingUrl
            const now = new Date();
            const groups = new Map<string, typeof meetings>();
            rawCourseMeetings.forEach(m => {
              const key = m.meetingNumber || m.meetingUrl;
              if (!key) return;
              if (!groups.has(key)) groups.set(key, []);
              groups.get(key)!.push(m);
            });

            const courseMeetings: typeof meetings = [];
            for (const [, list] of groups.entries()) {
              if (list.length <= 1) {
                courseMeetings.push(list[0]);
                continue;
              }
              const future = list.filter(m => m.startTime && new Date(m.startTime!) >= now);
              const past = list.filter(m => m.startTime && new Date(m.startTime!) < now);
              const noTime = list.filter(m => !m.startTime);

              if (future.length > 0) {
                future.sort((a, b) => new Date(a.startTime!).getTime() - new Date(b.startTime!).getTime());
                courseMeetings.push(future[0]);
              } else if (past.length > 0) {
                past.sort((a, b) => new Date(b.startTime!).getTime() - new Date(a.startTime!).getTime());
                courseMeetings.push(past[0]);
              } else if (noTime.length > 0) {
                courseMeetings.push(noTime[0]);
              }
            }

            const isMarked = (m: ZoomMeeting) => {
              if (!settings?.interestedMeetings) return false;
              const id = `${m.courseName}:${m.meetingNumber || ''}${m.title}`;
              return settings.interestedMeetings.includes(id);
            };
            const markedMeetings = courseMeetings.filter(isMarked);

            return (
              <div className="zoom-section-card glass-panel" style={{ borderLeft: lang === 'he' ? 'none' : `4px solid ${courseColor}`, borderRight: lang === 'he' ? `4px solid ${courseColor}` : 'none', padding: '1rem', marginBottom: '1.5rem' }}>
                <div
                  className="zoom-course-header"
                  onClick={() => setExpandedZoom(!expandedZoom)}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, textAlign: lang === 'he' ? 'right' : 'left' }}>
                    <h4 style={{ margin: 0, fontSize: '1rem', color: courseColor, fontWeight: 'bold' }}>
                      📹 {t('zoom_links_found')}
                    </h4>

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
                    maxHeight: expandedZoom ? '300px' : '0px',
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
                    const sortedMeetings = [...courseMeetings].sort((a, b) => {
                      const aMarked = isMarked(a);
                      const bMarked = isMarked(b);
                      if (aMarked && !bMarked) return -1;
                      if (!aMarked && bMarked) return 1;

                      const statusA = getMeetingStatus(a.startTime);
                      const statusB = getMeetingStatus(b.startTime);
                      const priority = { active: 1, unknown: 2, inactive: 3 };
                      if (priority[statusA] !== priority[statusB]) {
                        return priority[statusA] - priority[statusB];
                      }
                      const timeA = a.startTime ? new Date(a.startTime).getTime() : 0;
                      const timeB = b.startTime ? new Date(b.startTime).getTime() : 0;
                      return timeB - timeA;
                    });

                    return sortedMeetings.map((m, idx) => {
                      const status = getMeetingStatus(m.startTime);
                      const isCurrentlyMarked = isMarked(m);

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
                        itemStyle.opacity = 0.5;
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
                                color: isCurrentlyMarked ? 'var(--primary)' : 'var(--text-muted)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                transition: 'color 0.2s'
                              }}
                              title={isCurrentlyMarked ? t('hide_from_dashboard') : t('show_on_dashboard')}
                            >
                              {isCurrentlyMarked ? <EyeIcon /> : <EyeOffIcon />}
                            </button>
                            <a href={m.meetingUrl} target="_blank" rel="noreferrer" className="zoom-btn" style={{ textDecoration: 'none', padding: '4px 10px', fontSize: '12px' }}>
                              {t('join_zoom')}
                            </a>
                          </div>
                        </div>
                      );
                    });
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
                                  <div className="item-actions">
                                    <a href={a.link} target="_blank" rel="noreferrer" className="action-link-btn" data-moodle-link="true">
                                      {lang === 'he' ? 'פתח במודל ↗' : 'Open in Moodle ↗'}
                                    </a>
                                    {a.attachments && a.attachments.map((att, attIdx) => {
                                      const downloadUrl = token
                                        ? `${att.url}${att.url.includes('?') ? '&' : '?'}token=${token}`
                                        : att.url;
                                      return (
                                        <a key={attIdx} href={downloadUrl} target="_blank" rel="noreferrer" className="action-link-btn file-btn">
                                          📄 {att.name}
                                        </a>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {content.files.length > 0 && (
                          <div className="section-files-list">
                            {content.files.map((f, fIdx) => {
                              const downloadUrl = token
                                ? `${f.fileUrl}${f.fileUrl.includes('?') ? '&' : '?'}token=${token}`
                                : f.fileUrl;
                              return (
                                <div key={fIdx} className="section-file-item">
                                  <span className="item-name">📄 {f.fileName}</span>
                                  <div className="file-meta">
                                    <span className="file-size">{(f.fileSize / 1024 / 1024).toFixed(2)} MB</span>
                                    <a href={downloadUrl} target="_blank" rel="noreferrer" className="action-link-btn file-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                                      <span>{t('download_file')}</span>
                                      <DownloadIcon size={11} />
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
          <h4>{t('all_assignments_label')}</h4>
          {sortedCourseAssigns.length === 0 ? (
            <div className="empty-state">{lang === 'he' ? 'לא נמצאו מטלות.' : 'No assignments found.'}</div>
          ) : (
            <div className="sidebar-assignments-list">
              {sortedCourseAssigns.map((a) => {
                const isExpanded = expandedDetailAssignId === a.id;
                const isHidden = settings?.hiddenAssignments?.includes(a.id);
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
                          <span className="assignment-tag tag-not-submitted" title={lang === 'he' ? 'הושלם ידנית - לא הוגש במודל' : 'Manually completed - not submitted in Moodle'}>
                            {t('not_submitted_tag')}
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
                      {t('status_label')}: {lang === 'he' ? (a.status === 'Submitted' ? 'הוגש' : a.status === 'Not submitted' ? 'טרם הוגש' : a.status === 'Assigned' ? 'הוקצה' : a.status) : a.status}
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
                        maxHeight: isExpanded ? '500px' : '0px',
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
                        <div className="attachment-button-row" style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
                          {a.attachments.map((att, attIdx) => {
                            const downloadUrl = token ? `${att.url}${att.url.includes('?') ? '&' : '?'}token=${token}` : att.url;
                            return (
                              <div key={attIdx} className="submitted-file-chip" style={{ background: 'rgba(255, 255, 255, 0.03)', borderColor: 'var(--border)' }}>
                                <span style={{ fontSize: '0.75rem' }}>📄 {att.name}</span>
                                <a href={downloadUrl} target="_blank" rel="noreferrer" className="file-action-btn">
                                  {t('open_file')}
                                </a>
                                <a href={downloadUrl} target="_blank" rel="noreferrer" className="file-action-btn">
                                  <span>{t('download_file')}</span>
                                  <DownloadIcon size={11} />
                                </a>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {a.submittedFiles && a.submittedFiles.length > 0 && (
                        <div style={{ marginBottom: '0.6rem' }}>
                          <span style={{ fontSize: '0.75rem', opacity: 0.7, display: 'block', marginBottom: '0.3rem' }}>
                            {lang === 'he' ? 'קבצים שהוגשו:' : 'Submitted files:'}
                          </span>
                          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                            {a.submittedFiles.map((att, attIdx) => {
                              const downloadUrl = token ? `${att.url}${att.url.includes('?') ? '&' : '?'}token=${token}` : att.url;
                              return (
                                <div key={`sub-${attIdx}`} className="submitted-file-chip">
                                  <CheckIcon size={11} />
                                  <span style={{ fontSize: '0.75rem' }}>{att.name}</span>
                                  <a href={downloadUrl} target="_blank" rel="noreferrer" className="file-action-btn">
                                    {t('open_file')}
                                  </a>
                                  <a href={downloadUrl} target="_blank" rel="noreferrer" className="file-action-btn">
                                    <span>{t('download_file')}</span>
                                    <DownloadIcon size={11} />
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
                            className="primary-btn btn-xs"
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
function AboutTab({ t, lang, onStartTour }: { t: (key: any) => string; lang: 'he' | 'en'; onStartTour: () => void }) {
  return (
    <div className="tab-about glass-panel" style={{ padding: '2.5rem', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <h3 style={{ fontSize: '1.75rem', marginBottom: '0.5rem' }}>{t('about')}</h3>

      {lang === 'he' ? (
        <>
          <p style={{ lineHeight: '1.8', fontSize: '1.25rem', color: 'var(--text-secondary)' }}>
            <strong>Noodle 🍜</strong> הוא כלי עזר לסטודנטים באוניברסיטת תל אביב, המאפשר לסנכרן מועדי הגשת מטלות מהמודל ישירות ל-Google Tasks וללוח השנה של גוגל.
          </p>

          <div style={{ marginTop: '1.2rem' }}>
            <h4 style={{ color: 'white', marginBottom: '0.8rem', fontSize: '1.45rem' }}>מדריך שימוש מהיר 📖</h4>
            <ul style={{ paddingRight: '1.8rem', lineHeight: '2.0', color: 'var(--text-secondary)', fontSize: '1.2rem' }}>
              <li><strong>חיבור ראשוני:</strong> הזן את פרטי ההתחברות שלך למודל של אוניברסיטת תל אביב. הסיסמה נשמרת באופן מקומי ומאובטח.</li>
              <li><strong>בחירת קורסים:</strong> בחר אילו קורסים ברצונך לנטר. תוכל לשנות זאת תמיד בלשונית הקורסים.</li>
              <li><strong>התאמה אישית:</strong> בלשונית הקורסים תוכל לתת כינוי מקוצר וצבע לכל קורס לנוחות מירבית.</li>
              <li><strong>סנכרון לגוגל:</strong> בהגדרות תוכל לחבר את חשבון הגוגל שלך ולסנכרן את המשימות אוטומטית.</li>
            </ul>
          </div>

          <div style={{ marginTop: '1.2rem' }}>
            <h4 style={{ color: 'white', marginBottom: '0.8rem', fontSize: '1.45rem' }}>צריכים עזרה נוספת? 💡</h4>
            <p style={{ color: 'var(--text-secondary)', fontSize: '1.2rem', lineHeight: '1.8' }}>
              תוכל להפעיל מחדש את הסיור המודרך בכל עת כדי לראות סקירה של תכונות המערכת.
            </p>
            <button className="primary-btn" onClick={onStartTour} style={{ marginTop: '1rem', padding: '0.8rem 1.6rem', fontSize: '1.15rem' }}>
              🚀 הפעל את המדריך למשתמש החדש
            </button>
          </div>
        </>
      ) : (
        <>
          <p style={{ lineHeight: '1.8', fontSize: '1.25rem', color: 'var(--text-secondary)' }}>
            <strong>Noodle 🍜</strong> is a utility for Tel Aviv University students, helping you sync Moodle deadlines directly with Google Tasks and Google Calendar.
          </p>

          <div style={{ marginTop: '1.2rem' }}>
            <h4 style={{ color: 'white', marginBottom: '0.8rem', fontSize: '1.45rem' }}>Quick User Manual 📖</h4>
            <ul style={{ paddingLeft: '1.8rem', lineHeight: '2.0', color: 'var(--text-secondary)', fontSize: '1.2rem' }}>
              <li><strong>Initial Connection:</strong> Enter your TAU Moodle login details. Your credentials are saved securely and locally to refresh your token.</li>
              <li><strong>Select Courses:</strong> Pick which courses to track. You can update your selection at any time under the Courses tab.</li>
              <li><strong>Personalization:</strong> Set custom nicknames and tab colors for each course in the Courses tab.</li>
              <li><strong>Google Sync:</strong> Under Settings, connect your Google Account to automatically push deadlines to your tasks.</li>
            </ul>
          </div>

          <div style={{ marginTop: '1.2rem' }}>
            <h4 style={{ color: 'white', marginBottom: '0.8rem', fontSize: '1.45rem' }}>Need More Help? 💡</h4>
            <p style={{ color: 'var(--text-secondary)', fontSize: '1.2rem', lineHeight: '1.8' }}>
              You can restart the interactive onboarding tour at any time to get a quick overview of Noodle's interface.
            </p>
            <button className="primary-btn" onClick={onStartTour} style={{ marginTop: '1rem', padding: '0.8rem 1.6rem', fontSize: '1.15rem' }}>
              🚀 Launch Onboarding Tour
            </button>
          </div>
        </>
      )}
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
      title: t('tour_welcome_title'),
      desc: t('tour_welcome_desc'),
    },
    {
      title: lang === 'he' ? 'המטלה הקרובה ביותר 🚀' : 'Next Assignment 🚀',
      desc: lang === 'he'
        ? 'באנר זה מציג בהבלטה את המטלה הקרובה ביותר להגשה, עם ספירה לאחור, קישור למודל ומשאבים להורדה מהירה.'
        : 'This banner highlights your closest upcoming deadline, showing a countdown, direct Moodle link, and quick attachment downloads.',
    },
    {
      title: lang === 'he' ? 'לוח הגשות 📅' : 'Assignments List 📅',
      desc: lang === 'he'
        ? 'רשימה מפורטת של כל המטלות הפתוחות שלכם, ממוינות לפי תאריך הגשה וצבועות לפי דחיפות.'
        : 'A detailed list of all your pending Moodle assignments, sorted by due date and color-coded by urgency.',
    },
    {
      title: lang === 'he' ? 'הגדרות קורסים וצבעים 🎨' : 'Course Colors & Nicknames 🎨',
      desc: lang === 'he'
        ? 'לחצו על "הגדרות קורסים וצבעים" כדי לפתוח את תפריט ההתאמה האישית ולתת לכל קורס כינוי מקוצר וצבע ייחודי.'
        : 'Click "Course Settings & Colors" to open the personalization menu where you can set custom nicknames and colors.',
    },
    {
      title: lang === 'he' ? 'חומר לימודי וקישורים 📚' : 'Course Files & Zoom 📚',
      desc: lang === 'he'
        ? 'כאן תוכלו לנוווט במהירות בין נושאי הקורסים, להוריד קבצים ולמצוא קישורי זום מתוזמנים.'
        : 'Quickly browse course sections, download uploaded files, and find scheduled Zoom class links.',
    },
    {
      title: lang === 'he' ? 'סנכרון Google Tasks 🔄' : 'Google Tasks Sync 🔄',
      desc: lang === 'he'
        ? 'חברו את חשבון הגוגל שלכם כדי שמועדי ההגשה יסתנכרנו אוטומטית ישירות ללוח השנה ולרשימת המשימות.'
        : 'Connect your Google account to automatically push and sync deadlines directly to your tasks.',
    },
    {
      title: lang === 'he' ? 'צבעי התרעות מועדי הגשה ⚙️' : 'Urgency Thresholds ⚙️',
      desc: lang === 'he'
        ? 'הגדירו את סף הימים לשינוי צבעי ההתראה (אדום/צהוב/ירוק) במטלה הבאה לפי העדפתכם.'
        : 'Configure the day thresholds to adjust when task countdowns turn red, yellow, or green.',
    },
    {
      title: lang === 'he' ? 'מוכנים לדרך! 🎉' : 'All Set! 🎉',
      desc: lang === 'he'
        ? 'זהו זה! תוכלו להפעיל את המדריך מחדש תמיד דרך לשונית "אודות". לימודים פוריים!'
        : 'You are all set! You can relaunch this guide at any time from the "About" tab. Happy studying!',
    },
  ];

  const currentStep = steps[step];

  useEffect(() => {
    if (step >= 1 && step <= 6) {
      const timer = setTimeout(() => {
        const highlightedEl = document.querySelector('.tour-highlight');
        if (highlightedEl) {
          highlightedEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [step]);

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

  const isHighlightStep = step >= 1 && step <= 6;

  return (
    <div className={`tour-overlay ${isHighlightStep ? 'highlight-mode' : ''}`} dir={lang === 'he' ? 'rtl' : 'ltr'}>
      <div className="tour-card">
        <div className="tour-header">
          <h3>{currentStep.title}</h3>
          <span className="tour-step-indicator">
            {step + 1} / {steps.length}
          </span>
        </div>

        <div className="tour-body">
          <p style={{ fontSize: '1.05rem', lineHeight: '1.6', color: 'var(--text-secondary)' }}>{currentStep.desc}</p>
        </div>

        <div className="tour-bullets">
          {steps.map((_, idx) => (
            <span
              key={idx}
              className={`tour-bullet ${idx === step ? 'active' : ''}`}
            />
          ))}
        </div>

        <div className="tour-footer">
          <button className="secondary-btn btn-sm" onClick={onClose}>
            {t('tour_skip')}
          </button>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
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
