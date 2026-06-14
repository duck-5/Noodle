import { api } from '../api.js';
import { toast } from '../components/toast.js';
import { t } from '../i18n.js';

export async function renderAssignmentDetail(container, params) {
  const assignmentId = params.id;
  if (!assignmentId) {
    window.location.hash = '#/assignments';
    return;
  }

  container.innerHTML = `
    <div style="margin-bottom: 24px;">
      <button class="btn btn-secondary" onclick="window.location.hash='#/assignments'">
        ${t('back_to_assignments')}
      </button>
    </div>
    
    <div id="assignment-detail-loading" class="card" style="text-align:center; padding:40px;">
      <div class="skeleton skeleton-text" style="width: 50%; margin: 0 auto 16px;"></div>
      <div class="skeleton skeleton-text" style="width: 30%; margin: 0 auto;"></div>
    </div>
    
    <div id="assignment-detail-content" style="display:none; flex-direction:column; gap:24px;">
      <!-- Details will be injected here -->
    </div>
  `;

  try {
    const [assignment, sectionFiles] = await Promise.all([
      api.get(`/assignments/${assignmentId}`),
      api.get(`/assignments/${assignmentId}/section-files`)
    ]);

    const pageTitleEl = document.getElementById('page-title');
    if (pageTitleEl) pageTitleEl.innerText = assignment.assignment_name;

    const contentDiv = document.getElementById('assignment-detail-content');
    
    const isSubmitted = assignment.status === 'Submitted';
    const isPast = new Date(assignment.deadline.replace(' ', 'T')) < new Date();
    const isOverdue = isPast && !isSubmitted;
    
    let statusBadge = `<span class="badge badge-assigned">${t(assignment.status.toLowerCase().replace(' ', '_')) || assignment.status}</span>`;
    if (isSubmitted) statusBadge = `<span class="badge badge-submitted">${t('submitted')}</span>`;
    else if (isOverdue) statusBadge = `<span class="badge badge-overdue">${t('overdue')}</span>`;

    let gradeHtml = '';
    if (assignment.grade && assignment.grade !== '-') {
      gradeHtml = `
        <div style="background:rgba(34, 197, 94, 0.08); border:1px dashed rgba(34, 197, 94, 0.2); border-radius:8px; padding:12px; display:flex; justify-content:space-between; align-items:center; margin-top: 16px;">
          <span style="font-weight:600;font-size:0.95rem;">${t('grade_received')}</span>
          <span style="font-weight:800;font-size:1.2rem;color:var(--success);">${assignment.grade} / ${assignment.grade_max}</span>
        </div>
      `;
    }

    let filesHtml = '';
    if (sectionFiles && sectionFiles.length > 0) {
      filesHtml = sectionFiles.map(f => {
        let iconHtml = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:24px;height:24px;color:var(--primary)"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
        if (f.file_name.toLowerCase().endsWith('.pdf')) {
          iconHtml = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:24px;height:24px;color:#ef4444"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><text x="8" y="16" font-size="6" font-weight="bold" fill="#ef4444">PDF</text></svg>`;
        }
        
        // Use ?view=1 to force inline viewing in the browser
        const downloadUrl = `/api/files/download?url=${encodeURIComponent(f.file_url)}&view=1`;
        
        return `
          <div class="list-item" style="padding: 12px 16px;">
            <div class="item-left">
              ${iconHtml}
              <div style="display:flex; flex-direction:column; margin-left: 12px;">
                <span class="item-title">${escapeHtml(f.file_name)}</span>
                <span style="font-size:0.8rem; color:var(--text-muted)">${formatBytes(f.file_size || 0)}</span>
              </div>
            </div>
            <div class="item-right">
              <a href="${downloadUrl}" target="_blank" class="btn btn-secondary" style="font-size:0.8rem; padding: 6px 12px;">
                ${t('open_in_browser')}
              </a>
            </div>
          </div>
        `;
      }).join('');
    } else {
      filesHtml = `<div style="text-align:center; padding:16px; color:var(--text-muted)">${t('no_files_subject')}</div>`;
    }

    contentDiv.innerHTML = `
      <div class="card fade-in">
        <div style="font-size:0.8rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">${escapeHtml(assignment.course_name)}</div>
        <h3 style="font-size:1.5rem;font-weight:800;margin-bottom:12px;">${escapeHtml(assignment.assignment_name)}</h3>
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
          ${statusBadge}
          <span style="font-size:0.9rem;color:var(--text-secondary)">${t('due')} ${escapeHtml(assignment.deadline)}</span>
        </div>
        ${gradeHtml}
        
        <div style="margin-top: 24px; border-top: 1px solid var(--border-glass); padding-top: 24px;">
          <a href="${assignment.link || '#'}" target="_blank" class="btn btn-primary" style="width: 100%; text-align: center; display: inline-flex; justify-content: center; align-items: center;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;margin-inline-end:8px;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            ${t('open_in_moodle')}
          </a>
          <p style="margin-top: 12px; font-size: 0.85rem; color: var(--text-muted); text-align: center;">
            ${t('submit_on_moodle_desc')}
          </p>
        </div>
        
        <div style="margin-top: 24px; border-top: 1px solid var(--border-glass); padding-top: 24px; display: flex; flex-direction: column; gap: 16px;">
          <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-weight: 600;">
            <input type="checkbox" id="mark-done-checkbox" ${assignment.marked_as_done === 'True' || isSubmitted ? 'checked' : ''} ${isSubmitted ? 'disabled' : ''}>
            Mark as Done ${isSubmitted ? '(Submitted)' : ''}
          </label>
          
          <div style="display: flex; flex-direction: column; gap: 8px;">
            <label for="assignment-notes" style="font-weight: 600;">Personal Notes</label>
            <textarea id="assignment-notes" class="form-control" rows="3" placeholder="Add personal notes here...">${escapeHtml(assignment.notes || '')}</textarea>
          </div>
          
          <button class="btn btn-primary" id="save-assignment-btn" style="align-self: flex-start;">Save Changes</button>
        </div>
      </div>

      <div class="card fade-in" style="animation-delay: 0.1s;">
        <div class="widget-header">
          <h3 class="widget-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px;height:20px;color:var(--accent)"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            ${t('files_in_subject')}
          </h3>
          <span style="font-size: 0.85rem; color: var(--text-muted);">${escapeHtml(assignment.section_name || t('general_section'))}</span>
        </div>
        <div class="widget-content">
          ${filesHtml}
        </div>
      </div>
    `;

    document.getElementById('assignment-detail-loading').style.display = 'none';
    contentDiv.style.display = 'flex';
    
    document.getElementById('save-assignment-btn').addEventListener('click', async () => {
      const btn = document.getElementById('save-assignment-btn');
      btn.disabled = true;
      btn.innerText = 'Saving...';
      
      try {
        const markedDone = document.getElementById('mark-done-checkbox').checked;
        const notes = document.getElementById('assignment-notes').value;
        
        await api.patch(`/assignments/${assignmentId}`, {
          marked_as_done: markedDone,
          notes: notes
        });
        
        toast.success('Changes saved successfully');
      } catch (err) {
        toast.error('Failed to save changes');
      } finally {
        btn.disabled = false;
        btn.innerText = 'Save Changes';
      }
    });

  } catch (err) {
    document.getElementById('assignment-detail-loading').innerHTML = `
      <div style="color:var(--danger)">${t('failed_load_assignment_details')}</div>
    `;
    toast.error(t('failed_load_assignment_details'));
  }
}

// Helpers
function formatBytes(bytes) {
  const b = parseInt(bytes, 10);
  if (isNaN(b) || b === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return parseFloat((b / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
