import { api } from '../api.js';
import { toast } from '../components/toast.js';

export async function renderMeetings(container, params) {
  const pageTitleEl = document.getElementById('page-title');
  if (pageTitleEl) pageTitleEl.innerText = 'Zoom Meetings';

  container.innerHTML = `
    <div class="card fade-in">
      <div class="widget-header">
        <h3 class="widget-title">Course Meetings</h3>
      </div>
      <div class="table-container">
        <table class="table">
          <thead>
            <tr>
              <th>Course</th>
              <th>Meeting Title</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody id="meetings-table-body">
            <tr><td colspan="3"><div class="skeleton skeleton-text"></div></td></tr>
            <tr><td colspan="3"><div class="skeleton skeleton-text"></div></td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  try {
    const meetings = await api.get('/meetings/');
    const tbody = document.getElementById('meetings-table-body');
    
    if (meetings.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: var(--text-muted);">No meetings found.</td></tr>';
      return;
    }

    tbody.innerHTML = meetings.map(m => `
      <tr>
        <td style="font-weight: 600;">${escapeHtml(m.course_name)}</td>
        <td>${escapeHtml(m.title)}</td>
        <td>
          <a href="${m.meeting_url}" target="_blank" class="btn btn-primary" style="padding: 4px 12px; font-size: 0.8rem;">Join</a>
        </td>
      </tr>
    `).join('');

  } catch (err) {
    toast.error('Failed to load meetings');
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
