import { api } from '../api.js';
import { toast } from '../components/toast.js';

let filterCourse = 'all';
let filterStatus = 'all';
let filterSort = 'deadline';
let assignmentsData = [];

export async function renderAssignments(container, params) {
  const pageTitleEl = document.getElementById('page-title');
  if (pageTitleEl) pageTitleEl.innerText = 'Assignments';

  container.innerHTML = `
    <!-- Filter Bar -->
    <div class="page-filters fade-in">
      <div>
        <label class="form-label" style="margin-bottom:4px;">Filter by Course</label>
        <select class="filter-select" id="assign-filter-course">
          <option value="all">All Courses</option>
        </select>
      </div>
      <div>
        <label class="form-label" style="margin-bottom:4px;">Filter by Status</label>
        <select class="filter-select" id="assign-filter-status">
          <option value="all">All Statuses</option>
          <option value="Assigned">Assigned</option>
          <option value="Submitted">Submitted</option>
          <option value="Overdue">Overdue</option>
        </select>
      </div>
      <div>
        <label class="form-label" style="margin-bottom:4px;">Sort by</label>
        <select class="filter-select" id="assign-filter-sort">
          <option value="deadline">Deadline (Soonest)</option>
          <option value="course">Course Name</option>
          <option value="status">Status</option>
        </select>
      </div>
    </div>

    <!-- Main Grid Layout -->
    <div class="dashboard-layout fade-in" style="margin-top: 16px;">
      <!-- Left side: Assignments list -->
      <div style="display:flex; flex-direction:column; gap:12px;" id="assignments-list-container">
        <div class="skeleton skeleton-text"></div>
        <div class="skeleton skeleton-text"></div>
      </div>

      <!-- Right side: Assignment Details / Submission Panel -->
      <div id="assignment-detail-panel">
        <div class="card" style="text-align:center; color:var(--text-muted); padding:40px;">
          Select an assignment to view details and submit files.
        </div>
      </div>
    </div>
  `;

  // Fetch course choices for dropdown
  try {
    const tracked = await api.get('/courses/');
    const courseSelect = document.getElementById('assign-filter-course');
    tracked.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.course_id;
      opt.innerText = c.course_name;
      courseSelect.appendChild(opt);
    });
  } catch (e) {}

  // Restore filters
  document.getElementById('assign-filter-course').value = filterCourse;
  document.getElementById('assign-filter-status').value = filterStatus;
  document.getElementById('assign-filter-sort').value = filterSort;

  // Bind filter change events
  document.getElementById('assign-filter-course').addEventListener('change', (e) => {
    filterCourse = e.target.value;
    applyFilters();
  });
  document.getElementById('assign-filter-status').addEventListener('change', (e) => {
    filterStatus = e.target.value;
    applyFilters();
  });
  document.getElementById('assign-filter-sort').addEventListener('change', (e) => {
    filterSort = e.target.value;
    applyFilters();
  });

  // Load assignments data
  await fetchAssignments();
}

async function fetchAssignments() {
  const listContainer = document.getElementById('assignments-list-container');
  try {
    assignmentsData = await api.get('/assignments/');
    applyFilters();
  } catch (err) {
    listContainer.innerHTML = `<div class="card" style="color:var(--danger)">Failed to load assignments.</div>`;
  }
}

function applyFilters() {
  const listContainer = document.getElementById('assignments-list-container');
  let filtered = [...assignmentsData];

  // Course filter
  if (filterCourse !== 'all') {
    filtered = filtered.filter(a => String(a.course_id) === filterCourse);
  }

  // Status filter
  if (filterStatus !== 'all') {
    if (filterStatus === 'Overdue') {
      filtered = filtered.filter(a => {
        const isSubmitted = a.status === 'Submitted';
        const isPast = new Date(a.deadline.replace(' ', 'T')) < new Date();
        return isPast && !isSubmitted;
      });
    } else {
      filtered = filtered.filter(a => a.status === filterStatus);
    }
  }

  // Sorting
  if (filterSort === 'deadline') {
    filtered.sort((a, b) => new Date(a.deadline.replace(' ', 'T')) - new Date(b.deadline.replace(' ', 'T')));
  } else if (filterSort === 'course') {
    filtered.sort((a, b) => a.course_name.localeCompare(b.course_name));
  } else if (filterSort === 'status') {
    filtered.sort((a, b) => a.status.localeCompare(b.status));
  }

  if (filtered.length === 0) {
    listContainer.innerHTML = `<div class="card" style="text-align:center;color:var(--text-muted)">No matching assignments found.</div>`;
    return;
  }

  listContainer.innerHTML = filtered.map(a => {
    const isSubmitted = a.status === 'Submitted';
    const isPast = new Date(a.deadline.replace(' ', 'T')) < new Date();
    const isOverdue = isPast && !isSubmitted;
    
    let badgeClass = 'badge-assigned';
    let statusText = a.status;
    if (isSubmitted) badgeClass = 'badge-submitted';
    else if (isOverdue) {
      badgeClass = 'badge-overdue';
      statusText = 'Overdue';
    }

    return `
      <div class="list-item" style="cursor:pointer;" data-id="${a.id}">
        <div class="item-left">
          <span class="item-title">${escapeHtml(a.assignment_name)}</span>
          <div class="item-meta">
            <span style="font-weight:600;color:var(--primary)">${escapeHtml(a.course_name)}</span>
            <span>Due: ${escapeHtml(a.deadline)}</span>
          </div>
        </div>
        <div class="item-right">
          ${a.grade && a.grade !== '-' ? `
            <span style="font-weight:600; color:var(--success); font-size:0.85rem; margin-right:8px;">${a.grade}/${a.grade_max}</span>
          ` : ''}
          <span class="badge ${badgeClass}">${statusText}</span>
        </div>
      </div>
    `;
  }).join('');

  // Bind clicks
  const items = listContainer.querySelectorAll('.list-item');
  items.forEach(item => {
    item.addEventListener('click', () => {
      // Toggle selection styling
      items.forEach(i => i.style.borderColor = 'rgba(255, 255, 255, 0.04)');
      item.style.borderColor = 'var(--primary)';
      
      const id = item.dataset.id;
      const assignment = assignmentsData.find(a => a.id === id);
      if (assignment) {
        showAssignmentDetail(assignment);
      }
    });
  });
}

function showAssignmentDetail(a) {
  const panel = document.getElementById('assignment-detail-panel');
  const isSubmitted = a.status === 'Submitted';
  const isPast = new Date(a.deadline.replace(' ', 'T')) < new Date();
  const isOverdue = isPast && !isSubmitted;
  
  let statusBadge = `<span class="badge badge-assigned">${a.status}</span>`;
  if (isSubmitted) statusBadge = `<span class="badge badge-submitted">Submitted</span>`;
  else if (isOverdue) statusBadge = `<span class="badge badge-overdue">Overdue</span>`;

  panel.innerHTML = `
    <div class="card fade-in" style="display:flex; flex-direction:column; gap:16px;">
      <div>
        <div style="font-size:0.8rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">${escapeHtml(a.course_name)}</div>
        <h3 style="font-size:1.3rem;font-weight:800;margin-bottom:8px;">${escapeHtml(a.assignment_name)}</h3>
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
          ${statusBadge}
          <span style="font-size:0.85rem;color:var(--text-secondary)">Due ${escapeHtml(a.deadline)}</span>
        </div>
      </div>

      ${a.grade && a.grade !== '-' ? `
        <div style="background:rgba(34, 197, 94, 0.08); border:1px dashed rgba(34, 197, 94, 0.2); border-radius:8px; padding:12px; display:flex; justify-content:space-between; align-items:center;">
          <span style="font-weight:600;font-size:0.95rem;">Grade Received</span>
          <span style="font-weight:800;font-size:1.2rem;color:var(--success);">${a.grade} / ${a.grade_max}</span>
        </div>
      ` : ''}

      <div style="border-top:1px solid var(--border-glass);padding-top:16px;">
        <h4 style="margin-bottom:8px;font-size:0.95rem;color:var(--text-secondary);">Assignment Details</h4>
        <div style="font-size:0.9rem;line-height:1.6;color:var(--text-secondary);" id="assignment-desc">
          <!-- Raw description html or placeholder -->
          This assignment requires submission on Moodle. You can upload files below to submit directly to Tel Aviv University's server.
        </div>
      </div>

      <div style="border-top:1px solid var(--border-glass);padding-top:16px;">
        <h4 style="margin-bottom:8px;font-size:0.95rem;color:var(--text-secondary);">Submissions</h4>
        
        ${isSubmitted ? `
          <div style="text-align:center;padding:16px;background:rgba(34, 197, 94, 0.05);border-radius:8px;border:1px solid rgba(34, 197, 94, 0.15);color:var(--success);font-weight:600;">
            ✓ Already Submitted
          </div>
        ` : `
          <div class="upload-zone" id="file-drop-zone">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
            <div style="font-weight:600;margin-bottom:4px;">Drag and drop file here</div>
            <div style="font-size:0.75rem;color:var(--text-muted)">or click to select file from computer (<10MB)</div>
            <input type="file" id="submission-file-input" style="display:none;">
          </div>
          
          <div id="file-upload-progress" style="display:none;margin-top:12px;">
            <div style="display:flex;justify-content:between;font-size:0.8rem;margin-bottom:4px;">
              <span id="upload-filename">file.pdf</span>
              <span id="upload-percent">0%</span>
            </div>
            <div class="progress-bar-container">
              <div class="progress-bar-fill" id="upload-progress-fill" style="width: 0%; background: var(--primary);"></div>
            </div>
          </div>

          <button class="btn btn-primary" id="submit-btn" style="width:100%;margin-top:16px;" disabled>
            Submit to Moodle
          </button>
        `}
      </div>
      
      <div style="text-align:center;margin-top:12px;">
        <a href="${a.link || '#'}" target="_blank" style="font-size:0.8rem;color:var(--primary);text-decoration:underline;">Open Original Moodle Page</a>
      </div>
    </div>
  `;

  // Fetch full details (optional description etc if saved or query)
  // Our api does not store desc in assignments CSV, but we can query by assignment_id if available,
  // or just show link. We will provide a drag-and-drop handler if not submitted.
  if (!isSubmitted) {
    setupUploadHandlers(a.id);
  }
}

function setupUploadHandlers(assignmentId) {
  const dropZone = document.getElementById('file-drop-zone');
  const fileInput = document.getElementById('submission-file-input');
  const submitBtn = document.getElementById('submit-btn');
  const progressContainer = document.getElementById('file-upload-progress');
  const progressBar = document.getElementById('upload-progress-fill');
  const progressPercent = document.getElementById('upload-percent');
  const progressFilename = document.getElementById('upload-filename');

  let selectedFile = null;

  dropZone.addEventListener('click', () => fileInput.click());

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragging');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragging');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragging');
    if (e.dataTransfer.files.length > 0) {
      handleFileSelection(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFileSelection(e.target.files[0]);
    }
  });

  function handleFileSelection(file) {
    if (file.size > 10 * 1024 * 1024) {
      toast.error('File size exceeds the 10MB limit.');
      return;
    }
    selectedFile = file;
    dropZone.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--success)"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      <div style="font-weight:600;color:var(--success)">${escapeHtml(file.name)}</div>
      <div style="font-size:0.75rem;color:var(--text-muted)">Click or drag to change file (${formatBytes(file.size)})</div>
    `;
    submitBtn.disabled = false;
  }

  submitBtn.addEventListener('click', async () => {
    if (!selectedFile) return;

    submitBtn.disabled = true;
    dropZone.style.pointerEvents = 'none';
    progressContainer.style.display = 'block';
    progressFilename.innerText = selectedFile.name;

    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      // Simulate/Show upload progress (standard fetch doesn't support progress out of the box,
      // but we can use XMLHttpRequest for upload progress representation)
      const token = localStorage.getItem('jwt_token');
      
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `/api/assignments/${assignmentId}/submit`);
        
        if (token) {
          xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        }

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const percentage = Math.round((e.loaded / e.total) * 100);
            progressBar.style.width = `${percentage}%`;
            progressPercent.innerText = `${percentage}%`;
          }
        });

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(JSON.parse(xhr.responseText));
          } else {
            let errorMsg = 'Failed to submit file';
            try {
              const resJson = JSON.parse(xhr.responseText);
              errorMsg = resJson.detail || resJson.error || errorMsg;
            } catch (e) {}
            reject(new Error(errorMsg));
          }
        };

        xhr.onerror = () => reject(new Error('Network error during file upload'));
        xhr.send(formData);
      });

      toast.success('Assignment submitted successfully!');
      
      // Refresh state
      await fetchAssignments();
      
      // Update selected card
      const updated = assignmentsData.find(a => a.id === assignmentId);
      if (updated) {
        showAssignmentDetail(updated);
      }

    } catch (err) {
      toast.error(err.message || 'Submission failed');
      submitBtn.disabled = false;
      dropZone.style.pointerEvents = 'all';
      progressContainer.style.display = 'none';
    }
  });
}

// Helpers
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
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
