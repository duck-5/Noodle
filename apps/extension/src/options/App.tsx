import { useState, useEffect } from 'react';
import type { SyncResult, Assignment, CourseFile, ZoomMeeting } from '@tautracker/moodle-client';
import {
  getStoredToken,
  setStoredToken,
  getTrackedCourseIds,
  setTrackedCourseIds,
  getCachedSyncResult,
  getSettings,
  setSettings,
} from '../shared/storage.js';
import type { ExtensionSettings } from '../shared/storage.js';
import {
  validateTokenOnBackground,
  fetchEnrolledCoursesOnBackground,
  syncNowOnBackground,
  syncGoogleTasksOnBackground,
  checkMoodleSessionDirect,
  captureTokenViaTabOnBackground,
} from '../shared/messaging.js';
import { translations } from '../shared/i18n';

import './App.css';

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [trackedCourseIds, setTrackedCourseIdsState] = useState<number[]>([]);
  const [settings, setSettingsState] = useState<ExtensionSettings | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [selectedCourseId, setSelectedCourseId] = useState<number | null>(null);

  // Onboarding States
  const [validatingToken, setValidatingToken] = useState<boolean>(false);
  const [availableCourses, setAvailableCourses] = useState<any[]>([]);
  const [onboardingStep, setOnboardingStep] = useState<number>(1); // 1 = connect moodle, 2 = select courses
  // true after user has pressed "Connect Moodle" and is waiting to confirm login
  const [waitingForLogin, setWaitingForLogin] = useState<boolean>(false);

  // Settings tab states
  const [googleSyncStatus, setGoogleSyncStatus] = useState<string | null>(null);
  const [googleSyncLoading, setGoogleSyncLoading] = useState<boolean>(false);

  // Search/Filters states
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [fileSearchQuery, setFileSearchQuery] = useState<string>('');

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

  async function loadData() {
    setLoading(true);
    try {
      const storedToken = await getStoredToken();
      setToken(storedToken);

      const ids = await getTrackedCourseIds();
      setTrackedCourseIdsState(ids);

      const extensionSettings = await getSettings();
      setSettingsState(extensionSettings);

      const cached = await getCachedSyncResult();
      setSyncResult(cached);

      if (storedToken && ids.length > 0 && cached) {
        setOnboardingStep(3); // Fully set up
      } else if (storedToken) {
        // Token exists but courses might not be tracked yet
        setOnboardingStep(2);
        fetchEnrolledCoursesForOnboarding(storedToken);
      } else {
        setOnboardingStep(1);
        // Check for an active Moodle session cookie directly — no IPC, no port-closed risk.
        const hasSession = await checkMoodleSessionDirect();
        if (hasSession) {
          // Session exists: request the background script to open a capture tab.
          console.log('Moodle session cookie found – opening capture tab...');
          captureTokenViaTabOnBackground();
          // The storage.onChanged listener will fire when the token arrives and call loadData().
        }
        // If no session, show the Connect button — nothing else to do.
      }
    } catch (e) {
      console.error('Error loading extension data:', e);
    } finally {
      setLoading(false);
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
        alert(res.error || 'Failed to fetch enrolled courses.');
        setOnboardingStep(1);
      }
    } catch (e: any) {
      alert(e.message);
      setOnboardingStep(1);
    } finally {
      setValidatingToken(false);
    }
  }

  async function handleUpdateMasterToken(newToken: string) {
    if (!newToken.trim()) return;
    setLoading(true);
    try {
      const res = await validateTokenOnBackground(newToken.trim());
      if (res.success) {
        await setStoredToken(newToken.trim());
        setToken(newToken.trim());
        loadData();
        alert('Master token saved and validated successfully!');
      } else {
        alert(res.error || 'Invalid token. Please check and try again.');
      }
    } catch (e: any) {
      alert(e.message);
    } finally {
      setLoading(false);
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
        alert(`Sync failed: ${res.error}`);
      }
    } catch (e: any) {
      alert(`Sync failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleDisconnect() {
    if (confirm('Are you sure you want to disconnect your Moodle account? All local caches will be cleared.')) {
      setLoading(true);
      try {
        await setStoredToken(null);
        await setTrackedCourseIds([]);
        await chrome.storage.local.remove('cachedSyncResult');
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
        <p style={{ marginTop: '1rem', color: 'var(--text-secondary)' }}>Loading TauTracker...</p>
      </div>
    );
  }

  // Onboarding Step 1: Moodle Token Connection
  if (onboardingStep === 1) {
    return (
      <div className="onboarding-container" dir={currentLang === 'he' ? 'rtl' : 'ltr'}>
        <div className="onboarding-card glass-panel">
          <div className="logo-section">
            <span className="logo-icon">T</span>
            <h1>TauTracker</h1>
            <p className="subtitle">Sync Moodle Directly to Google Tasks</p>
          </div>

          <div className="form-section" style={{ textAlign: 'center', marginTop: '2rem' }}>
            {!waitingForLogin ? (
              <>
                <p style={{ marginBottom: '1.5rem', color: 'var(--text-secondary)' }}>
                  {t('moodle_token_connection_desc')}
                </p>
                <button
                  className="primary-btn"
                  style={{ padding: '0.8rem 1.5rem', fontSize: '1.1rem' }}
                  onClick={() => {
                    // Open login page in a new tab, then switch button state.
                    window.open('https://moodle.tau.ac.il/login/index.php', '_blank');
                    setWaitingForLogin(true);
                  }}
                >
                  {t('login_via_tau_moodle')}
                </button>
              </>
            ) : (
              <>
                <p style={{ marginBottom: '1.5rem', color: 'var(--text-secondary)' }}>
                  {t('return_after_login_desc')}
                </p>
                <button
                  className="primary-btn"
                  style={{ padding: '0.8rem 1.5rem', fontSize: '1.1rem' }}
                  onClick={async () => {
                    // Request background tab directly — fire-and-forget.
                    captureTokenViaTabOnBackground();
                    // Storage listener auto-advances when token arrives.
                  }}
                >
                  {t('i_have_logged_in')}
                </button>
                <p style={{ marginTop: '1rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}
                   onClick={() => setWaitingForLogin(false)}
                   role="button"
                >
                  ← {t('back')}
                </p>
              </>
            )}
          </div>
        </div>
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
              <div className="courses-grid-selection">
                {availableCourses.map((c) => {
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

              <div className="action-row" style={{ marginTop: '2rem' }}>
                <button
                  className="primary-btn"
                  onClick={handleSaveOnboardingCourses}
                  disabled={trackedCourseIds.length === 0}
                >
                  Start Tracking ({trackedCourseIds.length} Courses)
                </button>
              </div>
            </>
          )}
        </div>
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
        <div className="sidebar-logo">
          <span className="logo-badge">T</span>
          <span>TauTracker</span>
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
        </nav>

        <div className="sidebar-footer">
          <button className="text-btn danger-text" onClick={handleDisconnect}>
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
              t={t}
              lang={currentLang}
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
              token={token}
              onToggleGoogle={handleToggleGoogleTasks}
              onUpdateListName={handleUpdateGoogleListName}
              onSyncGoogle={handleSyncGoogleTasks}
              onUpdateToken={handleUpdateMasterToken}
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
            />
          )}
        </div>
      </main>
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
  t,
  lang,
}: {
  assignments: Assignment[];
  meetings: ZoomMeeting[];
  token: string | null;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
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

  return (
    <div className="tab-dashboard">
      {/* Next Assignment Highlight Banner */}
      {nextAssignment && (
        <div className="next-assignment-banner">
          <div className="next-assign-info">
            <span className="next-assign-label">{t('next_assignment')}</span>
            <span className="next-assign-title">{nextAssignment.name}</span>
            <span className="next-assign-course" style={{ color: getCourseColor(nextAssignment.courseId) }}>
              {getCourseDisplayName(nextAssignment.courseId, nextAssignment.courseName)}
            </span>
          </div>
          <div className="next-assign-action">
            {nextAssignment.deadline && (
              <span className="next-assign-time">
                {lang === 'he' ? 'הגשה ב-' : 'Due: '}{new Date(nextAssignment.deadline).toLocaleString()}
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
        <div className="dashboard-section glass-panel">
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
                const deadline = a.deadline ? new Date(a.deadline) : null;
                const hoursLeft = deadline ? (deadline.getTime() - Date.now()) / (1000 * 60 * 60) : null;

                let badgeClass = 'badge-muted';
                let deadlineText = lang === 'he' ? 'אין מועד הגשה' : 'No deadline';
                if (hoursLeft !== null) {
                  if (hoursLeft < 0) {
                    badgeClass = 'badge-danger';
                    deadlineText = lang === 'he' ? 'עבר המועד!' : 'Overdue!';
                  } else if (hoursLeft <= 24) {
                    badgeClass = 'badge-danger';
                    deadlineText = lang === 'he' ? `הגשה בעוד ${Math.round(hoursLeft)} שעות` : `Due in ${Math.round(hoursLeft)} hours`;
                  } else if (hoursLeft <= 72) {
                    badgeClass = 'badge-warning';
                    deadlineText = lang === 'he' ? `הגשה בעוד ${Math.round(hoursLeft / 24)} ימים` : `Due in ${Math.round(hoursLeft / 24)} days`;
                  } else {
                    badgeClass = 'badge-success';
                    deadlineText = lang === 'he' ? `הגשה ב-${deadline?.toLocaleDateString()}` : `Due ${deadline?.toLocaleDateString()}`;
                  }
                }

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
  getCourseColor,
  getCourseDisplayName,
  onUpdateColor,
  onUpdateCustomName,
  onSaveTrackedCourses,
  onSelectCourse,
  t,
  lang,
}: {
  trackedCourseIds: number[];
  syncResult: SyncResult | null;
  onUpdateColor: (id: number, color: string) => void;
  onUpdateCustomName: (id: number, name: string) => void;
  onSaveTrackedCourses: (newIds: number[]) => void;
  onSelectCourse: (id: number) => void;
} & TabProps) {
  // We collect all unique courses that are available in the syncResult or cached
  const coursesMap = new Map<number, string>();
  if (syncResult) {
    // Collect from assignments
    syncResult.assignments.forEach((a) => {
      coursesMap.set(a.courseId, a.courseName);
    });
    // Collect from files
    syncResult.files.forEach((f) => {
      coursesMap.set(f.courseId, f.courseName);
    });
  }

  const coursesList = Array.from(coursesMap.entries()).map(([id, name]) => ({
    id,
    name,
  }));

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

  return (
    <div className="dashboard-section glass-panel">
      <h3>{t('tracked_courses_config')}</h3>
      <p className="subtitle" style={{ marginBottom: '1.5rem' }}>
        {lang === 'he' 
          ? 'בחר אילו קורסים ברצונך לסנכרן מהמודל, הגדר להם כינוי מותאם אישית ובחר צבע עבור לוח הבקרה.'
          : 'Select which courses you want to fetch Moodle data for, customize their nickname (display name), and assign colors for dashboard tags.'}
      </p>

      {coursesList.length === 0 ? (
        <div className="empty-state">{lang === 'he' ? 'לא נטענו קורסים עדיין. הרץ סנכרון תחילה.' : 'No courses loaded yet. Run a sync first.'}</div>
      ) : (
        <>
          <div className="courses-settings-table">
            <div className="table-header">
              <div>{t('track')}</div>
              <div>{t('course_code_name')}</div>
              <div>{t('display_nickname')}</div>
              <div>{t('theme_color_label')}</div>
              <div>{t('action')}</div>
            </div>
            {coursesList.map((c) => {
              const isTracked = activeTrackedIds.includes(c.id);
              return (
                <div key={c.id} className="table-row">
                  <div>
                    <input
                      type="checkbox"
                      checked={isTracked}
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
                  <div>
                    <button
                      className="primary-btn btn-sm"
                      onClick={() => onSelectCourse(c.id)}
                      disabled={!isTracked}
                      style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
                    >
                      📖 {lang === 'he' ? 'ניווט' : 'Navigate'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="action-row" style={{ marginTop: '1.5rem' }}>
            <button className="primary-btn" onClick={() => onSaveTrackedCourses(activeTrackedIds)}>
              {t('save_tracking_options')}
            </button>
          </div>
        </>
      )}
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
  token,
  onToggleGoogle,
  onUpdateListName,
  onSyncGoogle,
  onUpdateToken,
  googleSyncLoading,
  googleSyncStatus,
  t,
  lang,
  onUpdateLanguage,
}: {
  settings: ExtensionSettings | null;
  token: string | null;
  onToggleGoogle: (e: boolean) => void;
  onUpdateListName: (name: string) => void;
  onSyncGoogle: () => void;
  onUpdateToken: (t: string) => void;
  googleSyncLoading: boolean;
  googleSyncStatus: string | null;
  onUpdateLanguage: (l: 'he' | 'en') => void;
  t: (key: any) => string;
  lang: 'he' | 'en';
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

      <hr className="settings-divider" />

      {/* Google Tasks Section */}
      <div className="settings-section">
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
          <div className="google-subsettings">
            <label htmlFor="tasks-list-name">{t('google_tasks_list_name_label')}</label>
            <input
              type="text"
              id="tasks-list-name"
              className="settings-text-input"
              value={settings.googleTasksListName}
              onChange={(e) => onUpdateListName(e.target.value)}
            />

            <div className="tasks-action-row" style={{ marginTop: '1rem' }}>
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

      {/* Manual Token Section */}
      <div className="settings-section">
        <h4>{t('manual_master_token_title')}</h4>
        <p className="subtitle" style={{ marginBottom: '1rem' }}>
          {t('manual_master_token_desc')}
        </p>
        <div className="help-section" style={{ fontSize: '0.85rem', marginBottom: '1rem', background: 'rgba(255,255,255,0.05)', padding: '1rem', borderRadius: '8px' }}>
          <h5 style={{ marginTop: 0 }}>{t('how_to_get_token_title')}</h5>
          <ol style={{ paddingLeft: '1.2rem', marginBottom: 0 }}>
            <li>{t('how_to_get_token_step1')}</li>
            <li>{t('how_to_get_token_step2')}</li>
            <li>{t('how_to_get_token_step3')}</li>
            <li>{t('how_to_get_token_step4')}</li>
          </ol>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <input
            type="password"
            className="settings-text-input"
            placeholder={lang === 'he' ? 'הדבק אסימון ראשי...' : 'Paste Master Token...'}
            defaultValue={token || ''}
            id="master-token-input"
            style={{ flex: 1, margin: 0 }}
          />
          <button 
            className="primary-btn btn-sm"
            onClick={() => {
              const val = (document.getElementById('master-token-input') as HTMLInputElement).value;
              onUpdateToken(val);
            }}
          >
            {t('save_token_btn')}
          </button>
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
                        const deadline = a.deadline ? new Date(a.deadline) : null;
                        const hoursLeft = deadline ? (deadline.getTime() - Date.now()) / (1000 * 60 * 60) : null;
                        
                        let badgeClass = 'badge-muted';
                        let deadlineText = lang === 'he' ? 'אין מועד הגשה' : 'No deadline';
                        if (hoursLeft !== null) {
                          if (hoursLeft < 0) {
                            badgeClass = 'badge-danger';
                            deadlineText = lang === 'he' ? 'עבר המועד' : 'Overdue';
                          } else if (hoursLeft <= 24) {
                            badgeClass = 'badge-danger';
                            deadlineText = lang === 'he' ? `נותרו ${Math.round(hoursLeft)} שעות` : `${Math.round(hoursLeft)}h left`;
                          } else {
                            badgeClass = 'badge-success';
                            deadlineText = deadline?.toLocaleDateString() || '';
                          }
                        }

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
