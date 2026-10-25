import browser from 'webextension-polyfill';
import { useState, useEffect } from 'react';
import type { SyncResult } from '@tautracker/moodle-client';
import { getStoredToken, getCachedSyncResult, getSettings, setSettings as saveSettings, getMoodleCredentials } from '../shared/storage.js';
import { syncNowOnBackground, syncGoogleTasksOnBackground, loginTauSsoOnBackground } from '../shared/messaging.js';
import { getDueTextAndClass } from '../shared/dateUtils.js';
import logoImg from '../assets/logo.png';
import './Popup.css';

export default function Popup() {
  const [token, setToken] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [settings, setSettingsState] = useState<any>(null);
  const [signingInMoodle, setSigningInMoodle] = useState<boolean>(false);

  async function loadData() {
    try {
      const storedToken = await getStoredToken();
      setToken(storedToken);
      const cached = await getCachedSyncResult();
      setSyncResult(cached);
      const s = await getSettings();
      setSettingsState(s);
    } catch (e) {
      console.error('Error loading popup data:', e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (settings?.theme) {
      document.body.className = `theme-${settings.theme}`;
    } else {
      document.body.className = 'theme-noodle';
    }
  }, [settings]);

  const handleOpenDashboard = () => {
    browser.runtime.openOptionsPage();
  };

  const handleSync = async () => {
    setLoading(true);
    try {
      const res = await syncNowOnBackground();
      if (res?.success && res.result) {
        setSyncResult(res.result);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleMarkDone = async (e: React.MouseEvent, assignId: number) => {
    e.stopPropagation();
    if (!settings) return;
    const completed = Array.from(new Set([...(settings.completedAssignments || []), assignId]));
    const uncompleted = (settings.uncompletedAssignments || []).filter((id: number) => id !== assignId);
    const updated = { ...settings, completedAssignments: completed, uncompletedAssignments: uncompleted };
    setSettingsState(updated);
    await saveSettings({ completedAssignments: completed, uncompletedAssignments: uncompleted });
    if (settings.googleTasksEnabled) {
      syncGoogleTasksOnBackground(false).catch(() => {});
    }
  };

  if (loading && !syncResult) {
    return (
      <div className="popup-loading">
        <div className="spinner"></div>
      </div>
    );
  }

  const isHe = settings?.language === 'he';

  if (!token) {
    return (
      <div className="popup-container unauth" dir={isHe ? 'rtl' : 'ltr'}>
        <img src={logoImg} alt="Noodle Logo" style={{ width: '84px', height: '84px', objectFit: 'contain', marginBottom: '0.75rem' }} />
        <h3>Noodle</h3>
        <p className="subtitle" style={{ margin: '0.5rem 0 1.5rem', textAlign: 'center' }}>
          {isHe ? 'סנכרן מטלות מודל ישירות ל-Google Tasks' : 'Track Moodle assignments directly on Google Tasks'}
        </p>
        <button className="primary-btn" onClick={handleOpenDashboard}>
          {isHe ? 'התחבר למודל' : 'Connect Moodle'}
        </button>
      </div>
    );
  }

  const hiddenSet = new Set<number>(settings?.hiddenAssignments || []);
  const completedSet = new Set<number>(settings?.completedAssignments || []);
  const uncompletedSet = new Set<number>(settings?.uncompletedAssignments || []);

  const isDone = (a: any) => {
    if (uncompletedSet.has(a.id)) return false;
    if (completedSet.has(a.id) || a.isCompleted === true) return true;
    return a.status === 'Submitted';
  };

  const now = Date.now();
  const pendingAssigns = (syncResult?.assignments || [])
    .filter((a: any) => !hiddenSet.has(a.id) && !a.isHidden && !isDone(a))
    .sort((a: any, b: any) => {
      const aHasNoDl = !a.deadline;
      const bHasNoDl = !b.deadline;
      const aTime = a.deadline ? new Date(a.deadline).getTime() : 0;
      const bTime = b.deadline ? new Date(b.deadline).getTime() : 0;
      const aIsPast = !aHasNoDl && aTime < now;
      const bIsPast = !bHasNoDl && bTime < now;

      // 1. Active upcoming deadlines first (nearest first)
      if (!aHasNoDl && !aIsPast && !bHasNoDl && !bIsPast) return aTime - bTime;
      if (!aHasNoDl && !aIsPast) return -1;
      if (!bHasNoDl && !bIsPast) return 1;

      // 2. Tasks with no deadline next
      if (aHasNoDl && bHasNoDl) return a.id - b.id;
      if (aHasNoDl) return -1;
      if (bHasNoDl) return 1;

      // 3. Past-due tasks last (most recently overdue first)
      return bTime - aTime;
    });

  // Check for currently active Zoom sessions (within 15 min before start up to 2 hours after start)
  const interestedList = settings?.interestedMeetings || [];
  const activeMeetings = (syncResult?.meetings || []).filter((m: any) => {
    if (!m.startTime) return false;
    const key = m.meetingNumber || m.meetingUrl;
    if (interestedList.includes(`hidden_${key}`)) return false;
    const startMs = new Date(m.startTime).getTime();
    if (isNaN(startMs)) return false;
    const diffMinutes = (now - startMs) / (1000 * 60);
    return diffMinutes >= -15 && diffMinutes <= 120;
  });

  return (
    <div className="popup-container" dir={isHe ? 'rtl' : 'ltr'}>
      <header className="popup-header">
        <div className="popup-brand" onClick={handleOpenDashboard} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
          <img src={logoImg} alt="Noodle Logo" style={{ width: '34px', height: '34px', objectFit: 'contain' }} />
          <span>Noodle</span>
        </div>
        <button className="sync-icon-btn" onClick={handleSync} disabled={loading} title={isHe ? 'סנכרן עכשיו' : 'Sync now'}>
          {loading ? '⏳' : '🔄'}
        </button>
      </header>

      <main className="popup-main-content">
        {signingInMoodle && (
          <div style={{ padding: '0.45rem 0.7rem', marginBottom: '0.6rem', borderRadius: '6px', background: 'rgba(99, 102, 241, 0.15)', border: '1px solid rgba(99, 102, 241, 0.3)', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', textAlign: 'center' }}>
            ⏳ {isHe ? 'מתחבר למודל...' : 'Signing in to Moodle...'}
          </div>
        )}
        {activeMeetings.length > 0 && (
          <div className="popup-active-zoom-banner">
            {activeMeetings.slice(0, 2).map((m: any, idx: number) => {
              const courseTitle = settings?.coursesCustomNames?.[m.courseId] || m.courseName;
              return (
                <div key={`${m.meetingUrl}_${idx}`} className="popup-active-zoom-row">
                  <div className="popup-active-zoom-info">
                    <span className="popup-live-dot-badge">● {isHe ? 'פעיל כעת' : 'Live Now'}</span>
                    <span className="popup-active-zoom-title" title={`${courseTitle} - ${m.title}`}>
                      {courseTitle}: {m.title}
                    </span>
                  </div>
                  <a
                    href={m.meetingUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="popup-join-zoom-btn"
                  >
                    📹 {isHe ? 'הצטרף' : 'Join'}
                  </a>
                </div>
              );
            })}
          </div>
        )}

        <div className="popup-section-title">
          <span>{isHe ? 'מטלות לביצוע' : 'To-Do Assignments'}</span>
          <span className="count-badge">{pendingAssigns.length}</span>
        </div>

        <div className="popup-list">
          {pendingAssigns.length === 0 ? (
            <div className="popup-empty">{isHe ? 'אין מטלות לביצוע! 🎉' : 'No pending assignments! 🎉'}</div>
          ) : (
            pendingAssigns.slice(0, 5).map((a: any) => {
              const color = settings?.coursesColorMap?.[a.courseId] || '#e07a5f';
              const name = settings?.coursesCustomNames?.[a.courseId] || a.courseName;

              const { deadlineText: dueText } = getDueTextAndClass(
                a.deadline || null,
                settings?.language || 'en',
                settings?.assignmentGreenDaysThreshold,
                settings?.assignmentYellowDaysThreshold,
                true
              );

              return (
                <div
                  key={a.id}
                  className="popup-assign-card clickable"
                  onClick={async () => {
                    if (a.link) {
                      setSigningInMoodle(true);
                      try {
                        const allCookies = await browser.cookies.getAll({ domain: 'moodle.tau.ac.il' }).catch(() => []);
                        const hasSession = allCookies.some((c) => c.name.startsWith('MoodleSession'));
                        if (!hasSession) {
                          const creds = await getMoodleCredentials();
                          if (creds && creds.username && creds.password) {
                            await loginTauSsoOnBackground(creds.username, creds.idNumber || '', creds.password, true).catch(() => {});
                          }
                        }
                        await browser.tabs.create({ url: a.link });
                      } finally {
                        setSigningInMoodle(false);
                      }
                    } else {
                      handleOpenDashboard();
                    }
                  }}
                  title={isHe ? 'לחץ לפתיחת המטלה במודל' : 'Click to open assignment in Moodle'}
                  style={{
                    borderLeft: isHe ? 'none' : `3.5px solid ${color}`,
                    borderRight: isHe ? `3.5px solid ${color}` : 'none',
                  }}
                >
                  <div className="popup-assign-info">
                    <span className="popup-course-tag" style={{ color }}>
                      {name}
                    </span>
                    <span className="popup-assign-name">{a.name}</span>
                  </div>
                  <div className="popup-assign-actions">
                    <span className="popup-due-tag">{dueText}</span>
                    <button
                      type="button"
                      className="popup-done-btn"
                      onClick={(e) => handleMarkDone(e, a.id)}
                      title={isHe ? 'סמן כבוצע' : 'Mark as Done'}
                    >
                      ✓
                    </button>
                  </div>
                </div>
              );
            })
          )}
          {pendingAssigns.length > 5 && (
            <button className="more-btn" onClick={handleOpenDashboard}>
              {isHe ? `ועוד ${pendingAssigns.length - 5} נוספות... פתח לוח בקרה` : `And ${pendingAssigns.length - 5} more... Open Dashboard`}
            </button>
          )}
        </div>
      </main>

      <footer className="popup-footer">
        <button className="footer-link-btn" onClick={handleOpenDashboard}>
          {isHe ? '🚀 פתח לוח בקרה מלא' : '🚀 Open Full Dashboard'}
        </button>
      </footer>
    </div>
  );
}
