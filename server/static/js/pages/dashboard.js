import { api } from '../api.js';
import { toast } from '../components/toast.js';

let syncInterval = null;

export async function renderDashboard(container, params) {
  // Set header page title
  const pageTitleEl = document.getElementById('page-title');
  if (pageTitleEl) pageTitleEl.innerText = 'Dashboard';

  // Render basic layout shells immediately
  container.innerHTML = `
    <div class="dashboard-stats fade-in">
      <div class="card stat-card">
        <div class="stat-label">Tracked Courses</div>
        <div class="stat-value" id="stat-courses">-</div>
      </div>
      <div class="card stat-card">
        <div class="stat-label">Pending Tasks</div>
        <div class="stat-value" id="stat-pending">-</div>
      </div>
      <div class="card stat-card">
        <div class="stat-label">Upcoming Deadlines</div>
        <div class="stat-value" id="stat-upcoming-count">-</div>
      </div>
      <div class="card stat-card">
        <div class="stat-label">Overall Average</div>
        <div class="stat-value" id="stat-avg">-</div>
      </div>
    </div>

    <div class="dashboard-layout fade-in">
      <!-- Left Column: Upcoming Assignments & Recent Grades -->
      <div style="display: flex; flex-direction: column; gap: 24px;">
        <div class="card">
          <div class="widget-header">
            <h3 class="widget-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px;height:20px;color:var(--accent)"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              Upcoming Deadlines (7 Days)
            </h3>
            <button class="btn btn-secondary" onclick="window.location.hash='#/assignments'">View All</button>
          </div>
          <div class="widget-content" id="upcoming-assignments-list">
            <div class="skeleton skeleton-text"></div>
            <div class="skeleton skeleton-text"></div>
          </div>
        </div>

        <div class="card">
          <div class="widget-header">
            <h3 class="widget-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px;height:20px;color:var(--success)"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              Recent Grades
            </h3>
            <button class="btn btn-secondary" onclick="window.location.hash='#/grades'">View Transcript</button>
          </div>
          <div class="widget-content" id="recent-grades-list">
            <div class="skeleton skeleton-text"></div>
            <div class="skeleton skeleton-text"></div>
          </div>
        </div>
      </div>

      <!-- Right Column: Quick Links & Live Info -->
      <div style="display: flex; flex-direction: column; gap: 24px;">
        <div class="card">
          <div class="widget-header">
            <h3 class="widget-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px;height:20px;color:var(--secondary)"><path d="M23 7a2 2 0 0 0-2.45-1.45L16 7V5a2 2 0 0 0-2-2H2a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2l4.55 1.45A2 2 0 0 0 23 17V7z"/></svg>
              Active Zoom Meetings
            </h3>
            <button class="btn btn-secondary" onclick="window.location.hash='#/meetings'">Join Class</button>
          </div>
          <div class="widget-content" id="zoom-meetings-list">
            <div class="skeleton skeleton-text"></div>
          </div>
        </div>

        <div class="card">
          <div class="widget-header">
            <h3 class="widget-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px;height:20px;color:var(--primary)"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/></svg>
              Recent Panopto Recordings
            </h3>
            <button class="btn btn-secondary" onclick="window.location.hash='#/recordings'">Watch Videos</button>
          </div>
          <div class="widget-content" id="panopto-recordings-list">
            <div class="skeleton skeleton-text"></div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Fetch all dashboard data
  await loadDashboardData();

  // Set up synchronization listener
  window.removeEventListener('sync-requested', handleSyncRequest);
  window.addEventListener('sync-requested', handleSyncRequest);
}

async function loadDashboardData() {
  try {
    const [courses, assignments, upcoming, grades, meetings, recordings] = await Promise.all([
      api.get('/courses/'),
      api.get('/assignments/'),
      api.get('/assignments/upcoming'),
      api.get('/grades/'),
      api.get('/meetings/'),
      api.get('/recordings/')
    ]);

    // Tracked Courses
    document.getElementById('stat-courses').innerText = courses.length;

    // Pending Assignments count
    const pendingCount = assignments.filter(a => a.status !== 'Submitted').length;
    document.getElementById('stat-pending').innerText = pendingCount;

    // Upcoming assignments (next 7 days) count
    document.getElementById('stat-upcoming-count').innerText = upcoming.length;

    // Grades average
    if (grades.length > 0) {
      const validPercentages = grades.filter(g => g.percentage !== null);
      if (validPercentages.length > 0) {
        const sum = validPercentages.reduce((acc, curr) => acc + curr.percentage, 0);
        const avg = Math.round((sum / validPercentages.length) * 100) / 100;
        document.getElementById('stat-avg').innerText = `${avg}%`;
      } else {
        document.getElementById('stat-avg').innerText = '-';
      }
    } else {
      document.getElementById('stat-avg').innerText = '-';
    }

    // Render upcoming deadlines list
    const upcomingContainer = document.getElementById('upcoming-assignments-list');
    if (upcoming.length === 0) {
      upcomingContainer.innerHTML = `<div style="text-align:center;padding:12px;color:var(--text-muted)">No deadlines in the next 7 days! 🎉</div>`;
    } else {
      upcomingContainer.innerHTML = upcoming.slice(0, 5).map(a => {
        const deadlineStr = a.deadline; // "YYYY-MM-DD HH:MM:SS"
        const relativeText = getRelativeTimeString(deadlineStr);
        return `
          <div class="list-item">
            <div class="item-left">
              <span class="item-title">${escapeHtml(a.assignment_name)}</span>
              <div class="item-meta">
                <span style="font-weight:600;color:var(--primary)">${escapeHtml(a.course_name)}</span>
                <span>Due ${relativeText}</span>
              </div>
            </div>
            <div class="item-right">
              <span class="badge ${a.status === 'Submitted' ? 'badge-submitted' : 'badge-assigned'}">${a.status}</span>
            </div>
          </div>
        `;
      }).join('');
    }

    // Render recent grades list
    const gradesContainer = document.getElementById('recent-grades-list');
    const recentGrades = grades.slice(0, 5);
    if (recentGrades.length === 0) {
      gradesContainer.innerHTML = `<div style="text-align:center;padding:12px;color:var(--text-muted)">No grades posted yet.</div>`;
    } else {
      gradesContainer.innerHTML = recentGrades.map(g => {
        const percent = g.percentage;
        let colorClass = 'var(--primary)';
        if (percent >= 90) colorClass = 'var(--accent)';
        else if (percent >= 80) colorClass = 'var(--success)';
        else if (percent < 65) colorClass = 'var(--danger)';
        
        return `
          <div class="list-item">
            <div class="item-left">
              <span class="item-title">${escapeHtml(g.assignment_name)}</span>
              <div class="item-meta">
                <span style="font-weight:600;color:var(--primary)">${escapeHtml(g.course_name)}</span>
              </div>
            </div>
            <div class="item-right" style="flex-direction:column;align-items:flex-end;gap:4px">
              <span style="font-weight:700;color:${colorClass}">${g.grade} / ${g.grade_max}</span>
              ${percent !== null ? `
                <div style="font-size:0.75rem;color:var(--text-muted)">${percent}%</div>
              ` : ''}
            </div>
          </div>
        `;
      }).join('');
    }

    // Render active zoom meetings list
    const meetingsContainer = document.getElementById('zoom-meetings-list');
    if (meetings.length === 0) {
      meetingsContainer.innerHTML = `<div style="text-align:center;padding:12px;color:var(--text-muted)">No active Zoom sessions found in course sections.</div>`;
    } else {
      meetingsContainer.innerHTML = meetings.slice(0, 3).map(m => `
        <div class="list-item">
          <div class="item-left">
            <span class="item-title">${escapeHtml(m.title)}</span>
            <div class="item-meta">
              <span style="font-weight:600;color:var(--secondary)">${escapeHtml(m.course_name)}</span>
            </div>
          </div>
          <div class="item-right">
            <a href="${m.meeting_url}" target="_blank" class="btn btn-primary" style="padding:6px 12px;font-size:0.8rem">Join</a>
          </div>
        </div>
      `).join('');
    }

    // Render Panopto recordings list
    const recordingsContainer = document.getElementById('panopto-recordings-list');
    if (recordings.length === 0) {
      recordingsContainer.innerHTML = `<div style="text-align:center;padding:12px;color:var(--text-muted)">No Panopto lecture recordings found. Configure SSO in Settings.</div>`;
    } else {
      recordingsContainer.innerHTML = recordings.slice(0, 3).map(r => `
        <div class="list-item">
          <div class="item-left">
            <span class="item-title">${escapeHtml(r.title)}</span>
            <div class="item-meta">
              <span style="font-weight:600;color:var(--primary)">${escapeHtml(r.course_name)}</span>
              <span>${escapeHtml(r.published_date)}</span>
            </div>
          </div>
          <div class="item-right">
            <a href="${r.recording_link}" target="_blank" class="btn btn-secondary" style="padding:6px 12px;font-size:0.8rem">Watch</a>
          </div>
        </div>
      `).join('');
    }

  } catch (err) {
    toast.error('Failed to load dashboard statistics');
  }
}

async function handleSyncRequest() {
  const syncBtn = document.getElementById('sync-now-btn');
  if (syncBtn) {
    syncBtn.disabled = true;
    syncBtn.classList.add('spin');
  }

  try {
    toast.info('Initiating sync process...');
    const result = await api.post('/sync/');
    toast.success('Synchronization started in background.');
    
    // Poll for status
    if (syncInterval) clearInterval(syncInterval);
    syncInterval = setInterval(checkSyncStatus, 2000);
  } catch (err) {
    toast.error(err.message || 'Failed to start sync');
    if (syncBtn) {
      syncBtn.disabled = false;
      syncBtn.classList.remove('spin');
    }
  }
}

async function checkSyncStatus() {
  const syncBtn = document.getElementById('sync-now-btn');
  try {
    const statusObj = await api.get('/sync/status');
    
    if (statusObj.status === 'completed') {
      clearInterval(syncInterval);
      toast.success('Sync completed! Reloading data...');
      if (syncBtn) {
        syncBtn.disabled = false;
        syncBtn.classList.remove('spin');
      }
      await loadDashboardData();
    } else if (statusObj.status === 'failed') {
      clearInterval(syncInterval);
      toast.error(`Sync failed: ${statusObj.progress || 'Unknown error'}`);
      if (syncBtn) {
        syncBtn.disabled = false;
        syncBtn.classList.remove('spin');
      }
    } else if (statusObj.status === 'syncing') {
      // Show progress update as minor toast or log
      console.log('Sync progress:', statusObj.progress);
    }
  } catch (err) {
    clearInterval(syncInterval);
    if (syncBtn) {
      syncBtn.disabled = false;
      syncBtn.classList.remove('spin');
    }
  }
}

// Helper: Relative deadline formatting
function getRelativeTimeString(deadlineStr) {
  try {
    const cleanStr = deadlineStr.replace(' ', 'T');
    const deadline = new Date(cleanStr);
    const now = new Date();
    const diff = deadline - now;
    
    const isPast = diff < 0;
    const absDiff = Math.abs(diff);
    
    const minutes = Math.floor(absDiff / 1000 / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (isPast) {
      if (days > 0) return `overdue by ${days} day${days > 1 ? 's' : ''}`;
      if (hours > 0) return `overdue by ${hours} hour${hours > 1 ? 's' : ''}`;
      return `overdue by ${minutes} minute${minutes > 1 ? 's' : ''}`;
    } else {
      if (days > 0) return `in ${days} day${days > 1 ? 's' : ''}`;
      if (hours > 0) return `in ${hours} hour${hours > 1 ? 's' : ''}`;
      return `in ${minutes} minute${minutes > 1 ? 's' : ''}`;
    }
  } catch (e) {
    return deadlineStr;
  }
}

// Helper: Escape HTML to prevent XSS
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
