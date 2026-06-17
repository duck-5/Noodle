import { useState, useEffect } from 'react';
import type { SyncResult, Assignment, CourseFile, ZoomMeeting } from '@tautracker/moodle-client';
import { parseTauCourseMetadata } from '@tautracker/moodle-client';
import {
  getStoredToken,
  setStoredToken,
  getTrackedCourseIds,
  setTrackedCourseIds,
  getCachedSyncResult,
  getSettings,
  setSettings,
  getMoodleCredentials,
  setMoodleCredentials,
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

interface GroupedCourses {
  semesterKey: string;
  year: string;
  semester: 'SemesterA' | 'SemesterB' | 'Yearly' | 'Other';
  label: string;
  courses: any[];
}

function groupAndSortCourses(courses: any[], lang: 'he' | 'en'): GroupedCourses[] {
  const groups: Record<string, any[]> = {};
  
  courses.forEach(c => {
    const idNum = c.idnumber || c.shortname || '';
    const meta = parseTauCourseMetadata(idNum);
    const year = meta?.year || '';
    const semester = meta?.semester || 'Other';
    
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
        const semName = semester === 'SemesterA' ? "סמסטר א'" : semester === 'SemesterB' ? "סמסטר ב'" : semester === 'Yearly' ? "שנתי" : "אחר";
        label = `${semName} (${year})`;
      } else {
        const semName = semester === 'SemesterA' ? "Semester A" : semester === 'SemesterB' ? "Semester B" : semester === 'Yearly' ? "Yearly" : "Other";
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
    await chrome.storage.local.set({ hasSeenTour: true });
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

  // Search/Filters states
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [fileSearchQuery, setFileSearchQuery] = useState<string>('');

  // Backup and custom disconnect states
  const [showDisconnectModal, setShowDisconnectModal] = useState<boolean>(false);
  const [deletePermanently, setDeletePermanently] = useState<boolean>(false);

  useEffect(() => {
    loadData();

    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (areaName === 'local' && changes.wstoken && changes.wstoken.newValue) {
        loadData();
      }
    };
    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  useEffect(() => {
    if (settings?.theme) {
      document.body.className = `theme-${settings.theme}`;
    } else {
      document.body.className = 'theme-dark';
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
        chrome.storage.local.set({ config_backup: backup });
      });
    }
  }, [token, trackedCourseIds, settings]);

  async function loadData() {
    setLoading(true);
    try {
      const storedToken = await getStoredToken();
      const ids = await getTrackedCourseIds();
      const extensionSettings = await getSettings();

      // Check if config backup exists
      const backupRes = (await chrome.storage.local.get('config_backup')) as {
        config_backup?: {
          wstoken?: string;
          trackedCourseIds?: number[];
          settings?: any;
        };
      };
      const data = backupRes.config_backup;

      let activeToken = storedToken;
      let activeIds = ids;
      let activeSettings = extensionSettings;

      // Automatically restore config backup settings and course preferences on startup if current state is empty
      if (data) {
        if (activeIds.length === 0 && data.trackedCourseIds && data.trackedCourseIds.length > 0) {
          await setTrackedCourseIds(data.trackedCourseIds);
          activeIds = data.trackedCourseIds;
        }
        if (data.settings) {
          await setSettings(data.settings);
          activeSettings = { ...activeSettings, ...data.settings };
        }
        if (data.wstoken && !activeToken) {
          activeToken = data.wstoken;
          await setStoredToken(activeToken);
        }
      }

      setToken(activeToken);
      setTrackedCourseIdsState(activeIds);
      setSettingsState(activeSettings);

      const cached = await getCachedSyncResult();
      setSyncResult(cached);

      // Load cached enrolled courses if available
      const cachedCoursesRes = (await chrome.storage.local.get('enrolledCoursesCache')) as { enrolledCoursesCache?: any[] };
      if (cachedCoursesRes.enrolledCoursesCache) {
        setAvailableCourses(cachedCoursesRes.enrolledCoursesCache);
      }

      // Prefill credentials if they exist
      const credentials = await getMoodleCredentials();
      if (credentials) {
        if (credentials.username) setMoodleUsername(credentials.username);
        if (credentials.idNumber) setMoodleId(credentials.idNumber);
      }

      const tourSeenRes = await chrome.storage.local.get('hasSeenTour');
      if (activeToken && activeIds.length > 0 && cached) {
        setOnboardingStep(3); // Fully set up
        fetchEnrolledCoursesInBackground(activeToken);
        if (!tourSeenRes.hasSeenTour) {
          setShowTour(true);
          setTourStep(0);
        }
      } else if (activeToken) {
        // Token exists but courses might not be tracked yet
        setOnboardingStep(2);
        fetchEnrolledCoursesForOnboarding(activeToken);
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
    setLoading(true);
    try {
      const res = await loginTauSsoOnBackground(moodleUsername, moodleId, moodlePassword);
      if (!res?.success || !res.token) {
        throw new Error(res?.error || 'Failed to generate token from SSO');
      }
      const fetchedToken = res.token;
      await setStoredToken(fetchedToken);
      if (rememberMe) {
        await setMoodleCredentials({ username: moodleUsername, idNumber: moodleId });
      } else {
        await setMoodleCredentials(null);
      }
      setToken(fetchedToken);
      fetchEnrolledCoursesForOnboarding(fetchedToken);
    } catch (err: any) {
      showToast(`Login failed: ${err.message}`, 'error');
      setLoading(false);
    }
  }

  async function fetchEnrolledCoursesInBackground(t: string) {
    try {
      const res = await fetchEnrolledCoursesOnBackground(t);
      if (res.success && res.courses) {
        setAvailableCourses(res.courses);
        await chrome.storage.local.set({ enrolledCoursesCache: res.courses });
      }
    } catch (e) {
      console.warn('Failed to background fetch enrolled courses:', e);
    }
  }

  async function fetchEnrolledCoursesForOnboarding(t: string) {
    setValidatingToken(true);
    try {
      const res = await fetchEnrolledCoursesOnBackground(t);
      if (res.success && res.courses) {
        setAvailableCourses(res.courses);
        setOnboardingStep(2);
      } else {
        showToast(res.error || 'Failed to fetch enrolled courses.', 'error');
        setOnboardingStep(1);
      }
    } catch (e: any) {
      showToast(e.message, 'error');
      setOnboardingStep(1);
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
      // Clear TAU browser session cookies so next login is always fresh
      await logoutOnBackground();

      await setStoredToken(null);
      await setMoodleCredentials(null);
      await setTrackedCourseIds([]);
      await chrome.storage.local.remove('cachedSyncResult');
      await chrome.storage.local.remove('enrolledCoursesCache');
      
      if (deletePermanently) {
        await chrome.storage.local.remove('config_backup');
      } else {
        // Clear wstoken from the backup so that restoring backup later does not auto-login
        const backupRes = (await chrome.storage.local.get('config_backup')) as { config_backup?: any };
        if (backupRes.config_backup) {
          const updatedBackup = { ...backupRes.config_backup };
          delete updatedBackup.wstoken;
          await chrome.storage.local.set({ config_backup: updatedBackup });
        }
      }
      
      setToken(null);
      setTrackedCourseIdsState([]);
      setSyncResult(null);
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
      settings: settings
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

  // Onboarding Step 1: Moodle Token Connection
  if (onboardingStep === 1) {
    return (
      <div className="onboarding-container" dir={currentLang === 'he' ? 'rtl' : 'ltr'}>
        <div className="onboarding-card glass-panel">
          <div className="logo-section">
            <img src={logoImg} alt="Noodle Logo" className="logo-image-large" />
            <h1>Noodle</h1>
            <p className="subtitle">Sync Moodle Directly to Google Tasks</p>
          </div>

          <div className="form-section" style={{ textAlign: 'center', marginTop: '2rem' }}>
            <form onSubmit={handleMoodleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'center', maxWidth: '300px', margin: '0 auto' }}>
              <p style={{ marginBottom: '1rem', color: 'var(--text-secondary)' }}>
                Please enter your Moodle credentials. Your password will be securely saved locally to auto-refresh your session.
              </p>
              <input
                type="text"
                placeholder="Username"
                value={moodleUsername}
                onChange={(e) => setMoodleUsername(e.target.value)}
                className="noodle-input"
                style={{ width: '100%' }}
                required
              />
              <input
                type="text"
                placeholder="ID Number"
                value={moodleId}
                onChange={(e) => setMoodleId(e.target.value)}
                className="noodle-input"
                style={{ width: '100%' }}
                required
              />
              <input
                type="password"
                placeholder="Password"
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
                  Remember me
                </label>
              </div>
              <button
                type="submit"
                className="primary-btn"
                style={{ padding: '0.8rem 1.5rem', fontSize: '1.1rem', width: '100%' }}
                disabled={loading}
              >
                {loading ? 'Connecting...' : 'Connect to Moodle'}
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
        <div className="onboarding-card glass-panel wide-card">
          <h2>Select Courses to Track</h2>
          <p className="subtitle" style={{ marginBottom: '1.5rem' }}>
            Choose which courses you want to track deadlines, files, and grades for. You can change this later.
          </p>

          {validatingToken ? (
            <div className="center-container">
              <div className="spinner"></div>
              <p>Fetching enrolled courses...</p>
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
                  Start Tracking ({trackedCourseIds.length} Courses)
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
  const assignmentsList = syncResult?.assignments || [];
  const filesList = syncResult?.files || [];
  const meetingsList = syncResult?.meetings || [];

  return (
    <div className="dashboard-layout" dir={currentLang === 'he' ? 'rtl' : 'ltr'}>
      {/* Sidebar Navigation */}
      <aside className="sidebar glass-panel">
        <div className="sidebar-logo" style={{ flexDirection: 'column', alignItems: 'center', gap: '0.5rem', textAlign: 'center', marginBottom: '2rem' }}>
          <img src={logoImg} alt="Noodle Logo" className="sidebar-logo-img" />
          <span>Noodle</span>
        </div>

        <nav className="sidebar-nav">
          <button
            className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => { setActiveTab('dashboard'); setSelectedCourseId(null); }}
          >
            📊 {t('dashboard')}
          </button>
          <button
            className={`nav-item ${activeTab === 'courses' ? 'active' : ''}`}
            onClick={() => { setActiveTab('courses'); setSelectedCourseId(null); }}
          >
            📚 {t('courses')}
          </button>
          <button
            className={`nav-item ${activeTab === 'files' ? 'active' : ''}`}
            onClick={() => { setActiveTab('files'); setSelectedCourseId(null); }}
          >
            📁 {t('files')}
          </button>
          <button
            className={`nav-item ${activeTab === 'grades' ? 'active' : ''}`}
            onClick={() => { setActiveTab('grades'); setSelectedCourseId(null); }}
          >
            🎓 {t('grades')}
          </button>
          <button
            className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => { setActiveTab('settings'); setSelectedCourseId(null); }}
          >
            ⚙️ {t('settings')}
          </button>
          <button
            className={`nav-item ${activeTab === 'about' ? 'active' : ''}`}
            onClick={() => { setActiveTab('about'); setSelectedCourseId(null); }}
          >
            ℹ️ {t('about')}
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
            <h2>{t(activeTab as any)}</h2>
            <p className="subtitle">
              {t('last_synced')}: {syncResult ? new Date(syncResult.syncedAt).toLocaleString() : t('never')}
            </p>
          </div>
          <div className="header-actions">
            <button className="primary-btn btn-sm" onClick={handleManualSync} disabled={loading}>
              {loading ? t('syncing') : `🔄 ${t('sync_now')}`}
            </button>
          </div>
        </header>

        {/* Tab Contents */}
        <div className="tab-pane">
          {activeTab === 'dashboard' && (
            <DashboardTab
              assignments={assignmentsList}
              meetings={meetingsList}
              token={token}
              getCourseColor={getCourseColor}
              getCourseDisplayName={getCourseDisplayName}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              settings={settings}
              t={t}
              lang={currentLang}
              tourStep={tourStep}
            />
          )}

          {activeTab === 'courses' && selectedCourseId !== null ? (
            <CourseDetailView
              courseId={selectedCourseId}
              assignments={assignmentsList}
              files={filesList}
              token={token}
              getCourseColor={getCourseColor}
              getCourseDisplayName={getCourseDisplayName}
              onBack={() => setSelectedCourseId(null)}
              t={t}
              lang={currentLang}
            />
          ) : activeTab === 'courses' && (
            <CoursesTab
              trackedCourseIds={trackedCourseIds}
              syncResult={syncResult}
              enrolledCourses={availableCourses}
              token={token}
              getCourseColor={getCourseColor}
              getCourseDisplayName={getCourseDisplayName}
              onUpdateColor={handleUpdateCourseColor}
              onUpdateCustomName={handleUpdateCourseCustomName}
              onSaveTrackedCourses={async (newIds) => {
                setTrackedCourseIdsState(newIds);
                await setTrackedCourseIds(newIds);
                handleManualSync();
              }}
              onSelectCourse={setSelectedCourseId}
              t={t}
              lang={currentLang}
              tourStep={tourStep}
              settings={settings}
            />
          )}

          {activeTab === 'files' && (
            <FilesTab
              files={filesList}
              token={token}
              getCourseColor={getCourseColor}
              getCourseDisplayName={getCourseDisplayName}
              fileSearchQuery={fileSearchQuery}
              setFileSearchQuery={setFileSearchQuery}
              t={t}
              lang={currentLang}
            />
          )}

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
              onUpdateTheme={async (theme: 'dark' | 'noodle') => {
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

interface TabProps {
  getCourseColor: (id: number) => string;
  getCourseDisplayName: (id: number, def: string) => string;
  t: (key: any) => string;
  lang: 'he' | 'en';
}

// 1. DASHBOARD TAB
function DashboardTab({
  assignments,
  meetings,
  token,
  getCourseColor,
  getCourseDisplayName,
  searchQuery,
  setSearchQuery,
  settings,
  t,
  lang,
  tourStep,
}: {
  assignments: Assignment[];
  meetings: ZoomMeeting[];
  token: string | null;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  settings: ExtensionSettings | null;
  tourStep?: number;
} & TabProps) {
  const pendingAssigns = assignments.filter((a) => a.status !== 'Submitted');
  
  // Sort assignments by due date ascending
  const sortedPendingAssigns = [...pendingAssigns].sort((a, b) => {
    if (!a.deadline && !b.deadline) return 0;
    if (!a.deadline) return 1;
    if (!b.deadline) return -1;
    return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
  });

  const filteredAssigns = sortedPendingAssigns.filter(
    (a) =>
      a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.courseName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Find the closest future assignment
  const now = new Date();
  const nextAssignment = sortedPendingAssigns.find(
    (a) => a.deadline && new Date(a.deadline) > now
  );

  const greenThreshold = settings?.assignmentGreenDaysThreshold ?? 7;
  const yellowThreshold = settings?.assignmentYellowDaysThreshold ?? 3;

  let timeColorClass = 'due-red';
  if (nextAssignment && nextAssignment.deadline) {
    const diffDays = (new Date(nextAssignment.deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    if (diffDays > greenThreshold) {
      timeColorClass = 'due-green';
    } else if (diffDays > yellowThreshold) {
      timeColorClass = 'due-yellow';
    }
  }

  return (
    <div className="tab-dashboard">
      {/* Next Assignment Highlight Banner */}
      {nextAssignment && (
        <div className={`next-assignment-banner ${tourStep === 1 ? 'tour-highlight' : ''}`}>
          <div className="next-assign-info">
            <span className="next-assign-label">{t('next_assignment')}</span>
            <span className="next-assign-title">{nextAssignment.name}</span>
            <span className="next-assign-course" style={{ color: getCourseColor(nextAssignment.courseId) }}>
              {getCourseDisplayName(nextAssignment.courseId, nextAssignment.courseName)}
            </span>
            {nextAssignment.attachments && nextAssignment.attachments.length > 0 && (
              <div className="attachment-button-row" style={{ marginTop: '0.6rem', display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                {nextAssignment.attachments.map((att, attIdx) => {
                  const downloadUrl = token
                    ? `${att.url}${att.url.includes('?') ? '&' : '?'}token=${token}`
                    : att.url;
                  return (
                    <a
                      key={attIdx}
                      href={downloadUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="action-link-btn file-btn btn-xs"
                    >
                      📄 {att.name}
                    </a>
                  );
                })}
              </div>
            )}
          </div>
          <div className="next-assign-action">
            {nextAssignment.deadline && (
              <span className={`next-assign-time ${timeColorClass}`}>
                {
                  getDueTextAndClass(
                    nextAssignment.deadline,
                    lang,
                    settings?.assignmentGreenDaysThreshold,
                    settings?.assignmentYellowDaysThreshold
                  ).deadlineText
                }
              </span>
            )}
            <a href={nextAssignment.link} target="_blank" rel="noreferrer" className="primary-btn btn-sm">
              {t('open_assignment')}
            </a>
          </div>
        </div>
      )}

      <div className="stats-row">
        <div className="stat-card glass-panel border-left-primary">
          <span className="stat-title">{t('pending_tasks')}</span>
          <span className="stat-val">{pendingAssigns.length}</span>
        </div>
        <div className="stat-card glass-panel border-left-secondary">
          <span className="stat-title">{t('completed_assignments')}</span>
          <span className="stat-val">{assignments.filter((a) => a.status === 'Submitted').length}</span>
        </div>
        <div className="stat-card glass-panel border-left-warning">
          <span className="stat-title">{t('zoom_links_found')}</span>
          <span className="stat-val">{meetings.length}</span>
        </div>
      </div>

      <div className="dashboard-grids">
        {/* Assignments Section */}
        <div className={`dashboard-section glass-panel ${tourStep === 2 ? 'tour-highlight' : ''}`}>
          <div className="section-header-row">
            <h3>{t('assignments_calendar')}</h3>
            <input
              type="text"
              className="search-input"
              placeholder={t('search_assignments')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="assignments-list">
            {filteredAssigns.length === 0 ? (
              <div className="empty-state">{t('empty_state_pending')}</div>
            ) : (
              filteredAssigns.map((a) => {
                const color = getCourseColor(a.courseId);
                const { badgeClass, deadlineText } = getDueTextAndClass(
                  a.deadline || null,
                  lang,
                  settings?.assignmentGreenDaysThreshold,
                  settings?.assignmentYellowDaysThreshold
                );

                return (
                  <div key={a.id} className="assignment-card glass-panel" style={{ borderRight: `4px solid ${color}` }}>
                    <div className="assign-main">
                      <span className="assign-course-tag" style={{ color }}>
                        {getCourseDisplayName(a.courseId, a.courseName)}
                      </span>
                      <h4 className="assign-name">{a.name}</h4>
                      {a.attachments && a.attachments.length > 0 && (
                        <div className="attachment-button-row" style={{ marginTop: '0.5rem' }}>
                          {a.attachments.map((att, attIdx) => {
                            const downloadUrl = token
                              ? `${att.url}${att.url.includes('?') ? '&' : '?'}token=${token}`
                              : att.url;
                            return (
                              <a
                                key={attIdx}
                                href={downloadUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="action-link-btn file-btn btn-xs"
                              >
                                📄 {att.name}
                              </a>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <div className="assign-meta">
                      <span className={`badge ${badgeClass}`}>{deadlineText}</span>
                      <a href={a.link} target="_blank" rel="noreferrer" className="action-icon-link">
                        ↗️ {lang === 'he' ? 'פתח' : 'Open'}
                      </a>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Zoom Meetings Section */}
        <div className="dashboard-section glass-panel">
          <h3>{t('zoom_links_found')}</h3>
          <div className="zoom-list">
            {meetings.length === 0 ? (
              <div className="empty-state">{t('empty_state_zoom')}</div>
            ) : (
              meetings.map((m, idx) => {
                const color = getCourseColor(m.courseId);
                return (
                  <div key={idx} className="meeting-card glass-panel" style={{ borderLeft: `3px solid ${color}` }}>
                    <div className="meeting-main">
                      <span className="meeting-course" style={{ color }}>
                        {getCourseDisplayName(m.courseId, m.courseName)}
                      </span>
                      <h4 className="meeting-title">{m.title}</h4>
                      <p className="meeting-section text-muted">{m.sectionName}</p>
                    </div>
                    <a href={m.meetingUrl} target="_blank" rel="noreferrer" className="zoom-btn">
                      {t('join_zoom')}
                    </a>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// 2. COURSES TAB
function CoursesTab({
  trackedCourseIds,
  syncResult,
  enrolledCourses,
  token,
  getCourseColor,
  getCourseDisplayName,
  onUpdateColor,
  onUpdateCustomName,
  onSaveTrackedCourses,
  onSelectCourse,
  t,
  lang,
  tourStep,
  settings,
}: {
  trackedCourseIds: number[];
  syncResult: SyncResult | null;
  enrolledCourses: any[];
  token: string | null;
  onUpdateColor: (id: number, color: string) => void;
  onUpdateCustomName: (id: number, name: string) => void;
  onSaveTrackedCourses: (newIds: number[]) => void;
  onSelectCourse: (id: number) => void;
  tourStep?: number;
  settings: ExtensionSettings | null;
} & TabProps) {
  const coursesMap = new Map<number, { id: number; name: string; idnumber: string }>();
  
  if (enrolledCourses && enrolledCourses.length > 0) {
    enrolledCourses.forEach(c => {
      coursesMap.set(c.id, { id: c.id, name: c.fullname || c.shortname || `Course ${c.id}`, idnumber: c.idnumber || c.shortname || '' });
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
  const [configExpanded, setConfigExpanded] = useState<boolean>(false);
  const [expandedCourses, setExpandedCourses] = useState<Record<number, boolean>>({});

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

  const toggleCourseExpand = (courseId: number) => {
    setExpandedCourses(prev => ({
      ...prev,
      [courseId]: !prev[courseId]
    }));
  };

  const getCourseSectionsList = (courseId: number) => {
    const courseAssignments = (syncResult?.assignments || []).filter((a) => a.courseId === courseId);
    const courseFiles = (syncResult?.files || []).filter((f) => f.courseId === courseId);

    const sectionsMap = new Map<string, { files: CourseFile[]; assignments: Assignment[] }>();
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

    return Array.from(sectionsMap.entries());
  };

  return (
    <div className="courses-tab-container" dir={lang === 'he' ? 'rtl' : 'ltr'}>
      {/* 1. Configuration Button & Expandable Panel */}
      <div className={`dashboard-section glass-panel ${tourStep === 3 ? 'tour-highlight' : ''}`} style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>{t('tracked_courses_config')}</h3>
          <button
            className="courses-config-toggle-btn"
            onClick={() => setConfigExpanded(!configExpanded)}
            style={{ padding: '0.5rem 1rem', fontSize: '0.9rem' }}
          >
            {t('courses_configuration_btn')} {configExpanded ? '▲' : '▼'}
          </button>
        </div>

        {configExpanded && (
          <div className="config-expanded-content" style={{ marginTop: '1.5rem', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '1.5rem' }}>
            {coursesList.length === 0 ? (
              <div className="empty-state">{lang === 'he' ? 'לא נטענו קורסים עדיין. הרץ סנכרון תחילה.' : 'No courses loaded yet. Run a sync first.'}</div>
            ) : (
              <>
                <div className="courses-grouped-container" style={{ maxHeight: '400px', overflowY: 'auto', paddingRight: '0.5rem' }}>
                  {groupAndSortCourses(coursesList, lang).map((group) => (
                    <div key={group.semesterKey} className="semester-group-section" style={{ marginBottom: '2rem' }}>
                      <h4 className="semester-group-title" style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.4rem', marginBottom: '0.8rem', color: 'var(--text-primary)', textAlign: lang === 'he' ? 'right' : 'left' }}>
                        {group.label}
                      </h4>
                      <div className="courses-settings-table">
                        <div className="table-header">
                          <div>{t('track')}</div>
                          <div>{t('course_code_name')}</div>
                          <div>{t('display_nickname')}</div>
                          <div>{t('theme_color_label')}</div>
                        </div>
                        {[...group.courses].sort((a, b) => {
                          const isA = activeTrackedIds.includes(a.id);
                          const isB = activeTrackedIds.includes(b.id);
                          if (isA && !isB) return -1;
                          if (!isA && isB) return 1;
                          return 0;
                        }).map((c) => {
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
                                  onBlur={(e) => onUpdateCustomName(c.id, e.target.value)}
                                />
                              </div>
                              <div>
                                <input
                                  type="color"
                                  className="color-picker"
                                  value={getCourseColor(c.id)}
                                  onChange={(e) => onUpdateColor(c.id, e.target.value)}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="action-row" style={{ marginTop: '1.5rem' }}>
                  <button className="primary-btn" onClick={() => onSaveTrackedCourses(activeTrackedIds)}>
                    {t('save_tracking_options')}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* 2. Navigation Pane */}
      <div className={`dashboard-section glass-panel ${tourStep === 4 ? 'tour-highlight' : ''}`}>
        <h3>{t('navigation_pane_title')}</h3>
        
        {activeTrackedIds.length === 0 ? (
          <div className="empty-state">
            {lang === 'he' 
              ? 'אנא בחר קורסים למעקב בהגדרות למעלה.' 
              : 'Please select courses to track in the configuration menu above.'}
          </div>
        ) : (
          <div className="navigation-pane-list" style={{ marginTop: '1.5rem' }}>
            {coursesList
              .filter(c => activeTrackedIds.includes(c.id))
              .map(c => {
                const color = getCourseColor(c.id);
                const displayName = getCourseDisplayName(c.id, c.name);
                const sectionsList = getCourseSectionsList(c.id);
                const isExpanded = !!expandedCourses[c.id];
                const displayedSections = isExpanded ? sectionsList : sectionsList.slice(-2);

                return (
                  <div key={c.id} className="nav-course-card glass-panel" style={{ borderLeft: lang !== 'he' ? `4px solid ${color}` : undefined, borderRight: lang === 'he' ? `4px solid ${color}` : undefined, marginBottom: '1.2rem', padding: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h4 
                        className="nav-course-title" 
                        onClick={() => onSelectCourse(c.id)}
                        style={{ color: color, cursor: 'pointer', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                      >
                        📖 {displayName}
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 'normal' }}>({c.name.split('-')[0]})</span>
                      </h4>
                      <button
                        className="icon-btn"
                        onClick={() => toggleCourseExpand(c.id)}
                        style={{ background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '1.1rem', padding: '0.2rem' }}
                      >
                        {isExpanded ? '▲' : '▼'}
                      </button>
                    </div>

                    <div className="nav-course-sections sections-tree" style={{ marginTop: '0.8rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      {displayedSections.length === 0 ? (
                        <p className="no-content-text" style={{ fontSize: '0.85rem' }}>{lang === 'he' ? 'אין נושאים או קבצים' : 'No sections or files'}</p>
                      ) : (
                        displayedSections.map(([secName, content], sIdx) => (
                          <div key={sIdx} className="section-node glass-panel" style={{ padding: '0.8rem', gap: '0.5rem' }}>
                            <h5 className="section-node-title" style={{ fontSize: '0.95rem', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.3rem', marginBottom: '0.2rem' }}>{secName}</h5>
                            
                            {content.assignments.length > 0 && (
                              <div className="section-assignments-list" style={{ gap: '0.5rem' }}>
                                {content.assignments.map((a) => {
                                  const { badgeClass, deadlineText } = getDueTextAndClass(
                                    a.deadline || null,
                                    lang,
                                    settings?.assignmentGreenDaysThreshold,
                                    settings?.assignmentYellowDaysThreshold
                                  );

                                  return (
                                    <div key={a.id} className="section-assignment-item" style={{ padding: '0.5rem 0.75rem' }}>
                                      <div className="item-meta-row">
                                        <span className="item-type-tag assign-tag">📝 {lang === 'he' ? 'מטלה' : 'Assignment'}</span>
                                        <span className={`badge ${badgeClass}`}>{deadlineText}</span>
                                      </div>
                                      <span className="item-name" style={{ fontSize: '0.85rem' }}>{a.name}</span>
                                      <div className="item-actions">
                                        <a href={a.link} target="_blank" rel="noreferrer" className="action-link-btn" style={{ fontSize: '0.75rem', padding: '0.15rem 0.4rem' }}>
                                          {lang === 'he' ? 'פתח במודל ↗' : 'Open in Moodle ↗'}
                                        </a>
                                        {a.attachments && a.attachments.map((att, attIdx) => {
                                          const downloadUrl = token
                                            ? `${att.url}${att.url.includes('?') ? '&' : '?'}token=${token}`
                                            : att.url;
                                          return (
                                            <a key={attIdx} href={downloadUrl} target="_blank" rel="noreferrer" className="action-link-btn file-btn" style={{ fontSize: '0.75rem', padding: '0.15rem 0.4rem' }}>
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
                              <div className="section-files-list" style={{ gap: '0.5rem' }}>
                                {content.files.map((f, fIdx) => {
                                  const downloadUrl = token
                                    ? `${f.fileUrl}${f.fileUrl.includes('?') ? '&' : '?'}token=${token}`
                                    : f.fileUrl;
                                  return (
                                    <div key={fIdx} className="section-file-item" style={{ padding: '0.5rem 0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                      <span className="item-name" style={{ fontSize: '0.85rem' }}>📄 {f.fileName}</span>
                                      <div className="file-meta" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <span className="file-size" style={{ fontSize: '0.7rem' }}>{(f.fileSize / 1024 / 1024).toFixed(2)} MB</span>
                                        <a href={downloadUrl} target="_blank" rel="noreferrer" className="action-link-btn file-btn" style={{ fontSize: '0.75rem', padding: '0.15rem 0.4rem' }}>
                                          {lang === 'he' ? 'הורדה 📥' : 'Download 📥'}
                                        </a>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
}

// 3. FILES TAB
function FilesTab({
  files,
  token,
  getCourseColor,
  getCourseDisplayName,
  fileSearchQuery,
  setFileSearchQuery,
  t,
  lang,
}: {
  files: CourseFile[];
  token: string | null;
  fileSearchQuery: string;
  setFileSearchQuery: (q: string) => void;
} & TabProps) {
  const filteredFiles = files.filter(
    (f) =>
      f.fileName.toLowerCase().includes(fileSearchQuery.toLowerCase()) ||
      f.courseName.toLowerCase().includes(fileSearchQuery.toLowerCase())
  );

  // Group files by course
  const filesByCourse: Record<number, { courseName: string; list: CourseFile[] }> = {};
  filteredFiles.forEach((f) => {
    if (!filesByCourse[f.courseId]) {
      filesByCourse[f.courseId] = { courseName: f.courseName, list: [] };
    }
    filesByCourse[f.courseId].list.push(f);
  });

  return (
    <div className="dashboard-section glass-panel">
      <div className="section-header-row">
        <h3>{lang === 'he' ? 'משאבי קורסים וקבצים' : 'Course Resources & Files'}</h3>
        <input
          type="text"
          className="search-input"
          placeholder={t('search_files_placeholder')}
          value={fileSearchQuery}
          onChange={(e) => setFileSearchQuery(e.target.value)}
        />
      </div>

      {files.length === 0 ? (
        <div className="empty-state">{t('empty_state_files')}</div>
      ) : Object.keys(filesByCourse).length === 0 ? (
        <div className="empty-state">{lang === 'he' ? 'לא נמצאו קבצים התואמים לחיפוש.' : 'No files matching search criteria.'}</div>
      ) : (
        <div className="files-grouped-list">
          {Object.entries(filesByCourse).map(([courseIdStr, group]) => {
            const courseId = Number(courseIdStr);
            const color = getCourseColor(courseId);
            return (
              <div key={courseId} className="course-files-group glass-panel" style={{ borderLeft: `4px solid ${color}` }}>
                <h4 className="group-course-title" style={{ color }}>
                  {getCourseDisplayName(courseId, group.courseName)}
                </h4>
                <div className="files-table">
                  {group.list.map((f, idx) => {
                    const downloadUrl = token
                      ? `${f.fileUrl}${f.fileUrl.includes('?') ? '&' : '?'}token=${token}`
                      : f.fileUrl;

                    return (
                      <div key={idx} className="file-row">
                        <div className="file-info-cell">
                          <span className="file-name-span">{f.fileName}</span>
                          <span className="file-section-tag">{f.sectionName}</span>
                        </div>
                        <div className="file-size-cell">{(f.fileSize / 1024 / 1024).toFixed(2)} MB</div>
                        <div className="file-action-cell">
                          <a href={downloadUrl} target="_blank" rel="noreferrer" className="action-icon-link">
                            {t('download')}
                          </a>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
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
  onUpdateTheme: (theme: 'dark' | 'noodle') => void;
  onUpdateThresholds: (green: number, yellow: number) => void;
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
            onChange={(e) => onUpdateTheme(e.target.value as 'dark' | 'noodle')}
            style={{ maxWidth: '200px', cursor: 'pointer' }}
          >
            <option value="dark">{lang === 'he' ? 'כהה (Dark)' : 'Dark'}</option>
            <option value="noodle">{lang === 'he' ? 'נודל 🍜 (Noodle)' : 'Noodle 🍜'}</option>
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
          <button className="primary-btn btn-sm" onClick={onExportConfig}>
            📥 {t('export_config_btn')}
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
  token,
  getCourseColor,
  getCourseDisplayName,
  onBack,
  t,
  lang,
}: {
  courseId: number;
  assignments: Assignment[];
  files: CourseFile[];
  token: string | null;
  onBack: () => void;
  t: (key: any) => string;
  lang: 'he' | 'en';
} & TabProps) {
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
          <h4>{t('course_sections')}</h4>
          {sectionsList.length === 0 ? (
            <div className="empty-state">{t('empty_sections')}</div>
          ) : (
            <div className="sections-tree">
              {sectionsList.map(([secName, content], sIdx) => (
                <div key={sIdx} className="section-node glass-panel">
                  <h5 className="section-node-title">{secName}</h5>
                  
                  {content.assignments.length > 0 && (
                    <div className="section-assignments-list">
                      {content.assignments.map((a) => {
                        const { badgeClass, deadlineText } = getDueTextAndClass(
                          a.deadline || null,
                          lang
                        );

                        return (
                          <div key={a.id} className="section-assignment-item">
                            <div className="item-meta-row">
                              <span className="item-type-tag assign-tag">📝 {lang === 'he' ? 'מטלה' : 'Assignment'}</span>
                              <span className={`badge ${badgeClass}`}>{deadlineText}</span>
                            </div>
                            <span className="item-name">{a.name}</span>
                            <div className="item-actions">
                              <a href={a.link} target="_blank" rel="noreferrer" className="action-link-btn">
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
                              <a href={downloadUrl} target="_blank" rel="noreferrer" className="action-link-btn file-btn">
                                {lang === 'he' ? 'הורדה 📥' : 'Download 📥'}
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
              ))}
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
              {sortedCourseAssigns.map((a) => (
                <div key={a.id} className="sidebar-assign-card" style={{ borderLeft: `3px solid ${a.status === 'Submitted' ? '#10b981' : '#f59e0b'}` }}>
                  <h6>{a.name}</h6>
                  <p className="assign-status">{t('status_label')}: {a.status}</p>
                  {a.deadline && (
                    <p className="assign-deadline">{lang === 'he' ? 'מועד הגשה:' : 'Due:'} {new Date(a.deadline).toLocaleString()}</p>
                  )}
                  {a.attachments && a.attachments.length > 0 && (
                    <div className="attachment-button-row" style={{ marginTop: '0.5rem' }}>
                      {a.attachments.map((att, attIdx) => {
                        const downloadUrl = token
                          ? `${att.url}${att.url.includes('?') ? '&' : '?'}token=${token}`
                          : att.url;
                        return (
                          <a key={attIdx} href={downloadUrl} target="_blank" rel="noreferrer" className="action-link-btn file-btn btn-xs">
                            📄 {lang === 'he' ? 'פתח קובץ' : 'Open File'}
                          </a>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
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
