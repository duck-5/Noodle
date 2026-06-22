import { useState, useEffect } from 'react';
import type { SyncResult } from '@tautracker/moodle-client';
import { getStoredToken, getCachedSyncResult, getSettings } from '../shared/storage.js';
import { syncNowOnBackground } from '../shared/messaging.js';
import { getDueTextAndClass } from '../shared/dateUtils.js';
import './Popup.css';

export default function Popup() {
  const [token, setToken] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [settings, setSettings] = useState<any>(null);

  async function loadData() {
    try {
      const storedToken = await getStoredToken();
      setToken(storedToken);
      const cached = await getCachedSyncResult();
      setSyncResult(cached);
      const s = await getSettings();
      setSettings(s);
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
    chrome.runtime.openOptionsPage();
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

  if (loading && !syncResult) {
    return (
      <div className="popup-loading">
        <div className="spinner"></div>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="popup-container unauth">
        <h3>Noodle</h3>
        <p className="subtitle" style={{ margin: '0.5rem 0 1.5rem', textAlign: 'center' }}>
          Track Moodle assignments directly on Google Tasks
        </p>
        <button className="primary-btn" onClick={handleOpenDashboard}>
          Connect Moodle
        </button>
      </div>
    );
  }

  const pendingAssigns = syncResult?.assignments.filter((a) => a.status !== 'Submitted') || [];

  return (
    <div className="popup-container">
      <header className="popup-header">
        <div className="popup-brand" onClick={handleOpenDashboard}>
          <span>Noodle</span>
        </div>
        <button className="sync-icon-btn" onClick={handleSync} disabled={loading}>
          {loading ? '⏳' : '🔄'}
        </button>
      </header>

      <main className="popup-main-content">
        <div className="popup-section-title">
          <span>Upcoming Assignments</span>
          <span className="count-badge">{pendingAssigns.length}</span>
        </div>

        <div className="popup-list">
          {pendingAssigns.length === 0 ? (
            <div className="popup-empty">No pending assignments! 🎉</div>
          ) : (
            pendingAssigns.slice(0, 5).map((a) => {
              const color = settings?.coursesColorMap[a.courseId] || '#6366f1';
              const name = settings?.coursesCustomNames[a.courseId] || a.courseName;

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
                  className="popup-assign-card"
                  style={{ borderLeft: `3px solid ${color}` }}
                >
                  <div className="popup-assign-info">
                    <span className="popup-course-tag" style={{ color }}>
                      {name}
                    </span>
                    <span className="popup-assign-name">{a.name}</span>
                  </div>
                  <span className="popup-due-tag">{dueText}</span>
                </div>
              );
            })
          )}
          {pendingAssigns.length > 5 && (
            <button className="more-btn" onClick={handleOpenDashboard}>
              And {pendingAssigns.length - 5} more... Open Dashboard
            </button>
          )}
        </div>
      </main>

      <footer className="popup-footer">
        <button className="footer-link-btn" onClick={handleOpenDashboard}>
          🚀 Open Full Dashboard
        </button>
      </footer>
    </div>
  );
}
