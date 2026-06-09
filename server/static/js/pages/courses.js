import { api } from '../api.js';
import { toast } from '../components/toast.js';

let activeCourseTab = 'content';

export async function renderCourses(container, params) {
  const pageTitleEl = document.getElementById('page-title');
  if (pageTitleEl) pageTitleEl.innerText = 'Courses';

  const courseId = params.id;

  if (courseId) {
    // Render Course Detail Page
    await renderCourseDetail(container, courseId);
  } else {
    // Render Course List Page
    await renderCourseList(container);
  }
}

async function renderCourseList(container) {
  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px;">
      <h2 class="section-title" style="margin-bottom:0;">Tracked Courses</h2>
      <button class="btn btn-primary" id="manage-courses-btn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;"><path d="M12 5v14M5 12h14"/></svg>
        Configure Courses
      </button>
    </div>
    
    <div class="courses-grid" id="courses-grid-container">
      <div class="skeleton" style="height:180px;border-radius:12px;"></div>
      <div class="skeleton" style="height:180px;border-radius:12px;"></div>
      <div class="skeleton" style="height:180px;border-radius:12px;"></div>
    </div>

    <!-- Reusable Modal (hidden by default) -->
    <div class="modal-overlay" id="courses-modal">
      <div class="modal-container">
        <div class="modal-header">
          <h3 class="modal-title">Track Courses from Moodle</h3>
          <span class="modal-close" id="modal-close-btn">&times;</span>
        </div>
        <div class="modal-body" id="modal-courses-list">
          <div class="skeleton skeleton-text"></div>
          <div class="skeleton skeleton-text"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="modal-cancel-btn">Cancel</button>
          <button class="btn btn-primary" id="modal-save-btn">Save Changes</button>
        </div>
      </div>
    </div>
  `;

  // Bind manage courses modal opening
  const modal = document.getElementById('courses-modal');
  document.getElementById('manage-courses-btn').addEventListener('click', () => {
    modal.classList.add('open');
    loadAvailableCourses();
  });

  const closeModal = () => {
    modal.classList.remove('open');
  };
  document.getElementById('modal-close-btn').addEventListener('click', closeModal);
  document.getElementById('modal-cancel-btn').addEventListener('click', closeModal);

  // Load tracked courses list
  await loadTrackedCourses();
}

async function loadTrackedCourses() {
  const grid = document.getElementById('courses-grid-container');
  try {
    const tracked = await api.get('/courses/');
    
    if (tracked.length === 0) {
      grid.innerHTML = `
        <div class="card" style="grid-column: 1/-1; text-align: center; padding: 48px;">
          <h3 style="margin-bottom:12px;">No Tracked Courses</h3>
          <p style="color:var(--text-muted); margin-bottom:20px;">You are not tracking any courses yet. Configure your courses to sync Moodle data.</p>
          <button class="btn btn-primary" onclick="document.getElementById('manage-courses-btn').click()">Configure Courses</button>
        </div>
      `;
      return;
    }

    grid.innerHTML = tracked.map(course => `
      <div class="card interactive course-card" onclick="window.location.hash='#/courses/${course.course_id}'">
        <div class="course-card-top">
          <div class="course-semester">${escapeHtml(course.semester)} ${escapeHtml(course.year)}</div>
          <div class="course-name">${escapeHtml(course.course_name)}</div>
        </div>
        <div class="course-card-bottom">
          <span>ID: ${escapeHtml(course.course_id)}</span>
          <span style="color: var(--secondary); font-weight:600;">View Details &rarr;</span>
        </div>
      </div>
    `).join('');

  } catch (err) {
    grid.innerHTML = `<div class="card" style="grid-column:1/-1;color:var(--danger)">Failed to load tracked courses.</div>`;
  }
}

async function loadAvailableCourses() {
  const modalBody = document.getElementById('modal-courses-list');
  modalBody.innerHTML = '<div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text"></div>';

  try {
    const response = await api.get('/courses/available');
    const tracked = await api.get('/courses/');
    const trackedIds = new Set(tracked.map(c => c.course_id));

    const semesters = response.semesters || {};
    const semesterKeys = Object.keys(semesters).sort().reverse(); // Show recent semesters first

    if (semesterKeys.length === 0) {
      modalBody.innerHTML = `<p style="text-align:center;color:var(--text-muted)">No courses found on your Moodle account.</p>`;
      return;
    }

    let html = '';
    for (const sem of semesterKeys) {
      html += `
        <h4 style="margin:16px 0 8px; color:var(--secondary); border-bottom:1px solid var(--border-glass); padding-bottom:4px;">${escapeHtml(sem)}</h4>
        <div style="display:flex; flex-direction:column; gap:10px; margin-bottom:16px;">
      `;

      semesters[sem].forEach(course => {
        const isChecked = trackedIds.has(String(course.moodle_id)) ? 'checked' : '';
        html += `
          <label style="display:flex; align-items:flex-start; gap:12px; cursor:pointer; padding:8px; background:rgba(255,255,255,0.02); border-radius:6px;">
            <input type="checkbox" class="course-select-checkbox" data-id="${course.moodle_id}" ${isChecked} style="margin-top:4px;">
            <div>
              <div style="font-weight:600; font-size:0.9rem;">${escapeHtml(course.fullname)}</div>
              <div style="font-size:0.75rem; color:var(--text-muted)">Code: ${escapeHtml(course.course_id)}</div>
            </div>
          </label>
        `;
      });

      html += `</div>`;
    }

    modalBody.innerHTML = html;

    // Set up save handler
    const saveBtn = document.getElementById('modal-save-btn');
    // Remove old listeners
    const newSaveBtn = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);

    newSaveBtn.addEventListener('click', async () => {
      newSaveBtn.disabled = true;
      newSaveBtn.innerHTML = `<svg class="spin" style="width:18px;height:18px;color:white;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg> Saving...`;
      
      const selectedCheckboxes = document.querySelectorAll('.course-select-checkbox:checked');
      const selectedIds = Array.from(selectedCheckboxes).map(cb => cb.dataset.id);
      
      // We also need to untrack courses that were unchecked
      const uncheckedCheckboxes = document.querySelectorAll('.course-select-checkbox:not(:checked)');
      const uncheckedIds = Array.from(uncheckedCheckboxes).map(cb => cb.dataset.id);

      try {
        // Track new ones
        if (selectedIds.length > 0) {
          await api.post('/courses/', { course_ids: selectedIds });
        }
        
        // Untrack removed ones
        for (const uid of uncheckedIds) {
          if (trackedIds.has(String(uid))) {
            await api.delete(`/courses/${uid}`);
          }
        }

        toast.success('Course configuration updated!');
        document.getElementById('courses-modal').classList.remove('open');
        await loadTrackedCourses();
      } catch (err) {
        toast.error(err.message || 'Failed to update course tracking');
        newSaveBtn.disabled = false;
        newSaveBtn.innerText = 'Save Changes';
      }
    });

  } catch (err) {
    modalBody.innerHTML = `<p style="color:var(--danger)">Failed to fetch available courses from Moodle.</p>`;
  }
}

async function renderCourseDetail(container, courseId) {
  // Find course name in local cached courses
  let courseName = 'Course Detail';
  try {
    const tracked = await api.get('/courses/');
    const course = tracked.find(c => c.course_id === courseId);
    if (course) {
      courseName = course.course_name;
    }
  } catch (e) {}

  const pageTitleEl = document.getElementById('page-title');
  if (pageTitleEl) pageTitleEl.innerText = courseName;

  container.innerHTML = `
    <div style="margin-bottom:16px;">
      <a href="#/courses" class="btn btn-secondary" style="padding: 8px 16px; font-size: 0.9rem;">&larr; Back to Courses</a>
    </div>

    <div class="tab-container">
      <button class="tab-btn ${activeCourseTab === 'content' ? 'active' : ''}" data-tab="content">Content</button>
      <button class="tab-btn ${activeCourseTab === 'assignments' ? 'active' : ''}" data-tab="assignments">Assignments</button>
      <button class="tab-btn ${activeCourseTab === 'grades' ? 'active' : ''}" data-tab="grades">Grades</button>
      <button class="tab-btn ${activeCourseTab === 'files' ? 'active' : ''}" data-tab="files">Files</button>
      <button class="tab-btn ${activeCourseTab === 'recordings' ? 'active' : ''}" data-tab="recordings">Recordings</button>
      <button class="tab-btn ${activeCourseTab === 'meetings' ? 'active' : ''}" data-tab="meetings">Meetings</button>
    </div>

    <div id="course-tab-content" class="fade-in">
      <div class="skeleton skeleton-text"></div>
      <div class="skeleton skeleton-text"></div>
      <div class="skeleton skeleton-text"></div>
    </div>
  `;

  // Bind tabs
  const tabButtons = container.querySelectorAll('.tab-btn');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeCourseTab = btn.dataset.tab;
      loadCourseTabContent(courseId);
    });
  });

  // Load active tab
  await loadCourseTabContent(courseId);
}

async function loadCourseTabContent(courseId) {
  const contentContainer = document.getElementById('course-tab-content');
  contentContainer.innerHTML = '<div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text"></div>';

  try {
    if (activeCourseTab === 'content') {
      const contents = await api.get(`/courses/${courseId}`);
      if (!contents || contents.length === 0) {
        contentContainer.innerHTML = `<div class="card" style="text-align:center;color:var(--text-muted)">No course contents available. Please run Sync to fetch.</div>`;
        return;
      }
      
      let html = '';
      contents.forEach((section, index) => {
        // Exclude completely empty sections
        if (!section.modules || section.modules.length === 0) return;
        
        const isOpen = index === 0 ? 'open' : ''; // Open first section by default
        
        html += `
          <div class="content-section ${isOpen}" id="section-${section.id}">
            <div class="section-header" onclick="this.parentNode.classList.toggle('open')">
              <span class="section-name">${escapeHtml(section.name)}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;"><polyline points="6 9 12 15 18 9"/></svg>
            </div>
            <div class="section-modules">
        `;

        section.modules.forEach(mod => {
          let icon = '📄';
          let actionUrl = mod.url || '#';
          let downloadAttr = '';
          
          if (mod.modname === 'resource') {
            icon = '📄'; // File
            const fileObj = mod.contents ? mod.contents[0] : null;
            if (fileObj) {
              actionUrl = `/api/files/download?url=${encodeURIComponent(fileObj.fileurl)}`;
              downloadAttr = `download="${escapeHtml(fileObj.filename)}"`;
            }
          } else if (mod.modname === 'assign') {
            icon = '📝';
            actionUrl = `#/assignments`; // Redirect to assignments screen
          } else if (mod.modname === 'url') {
            icon = '🔗';
          } else if (mod.modname === 'forum') {
            icon = '💬';
          } else if (mod.modname === 'folder') {
            icon = '📁';
          } else if (mod.modname === 'zoom') {
            icon = '📹';
          }

          html += `
            <div class="module-item">
              <span class="module-icon">${icon}</span>
              <a href="${actionUrl}" ${downloadAttr} class="module-name" ${mod.modname !== 'assign' && !actionUrl.startsWith('#') ? 'target="_blank"' : ''}>
                ${escapeHtml(mod.name)}
              </a>
              ${mod.modname === 'resource' && mod.contents && mod.contents[0] ? `
                <span class="module-meta">${formatBytes(mod.contents[0].filesize)}</span>
              ` : ''}
            </div>
          `;
        });

        html += `
            </div>
          </div>
        `;
      });
      
      contentContainer.innerHTML = html || `<div class="card" style="text-align:center;color:var(--text-muted)">No visible section modules found.</div>`;

    } else if (activeCourseTab === 'assignments') {
      const assignments = await api.get(`/assignments/?course_id=${courseId}`);
      if (assignments.length === 0) {
        contentContainer.innerHTML = `<div class="card" style="text-align:center;color:var(--text-muted)">No assignments in this course.</div>`;
        return;
      }
      
      contentContainer.innerHTML = `
        <div class="assignments-list">
          ${assignments.map(a => `
            <div class="list-item" onclick="window.location.hash='#/assignments'" style="cursor:pointer;">
              <div class="item-left">
                <span class="item-title">${escapeHtml(a.assignment_name)}</span>
                <div class="item-meta">
                  <span>Due ${escapeHtml(a.deadline)}</span>
                </div>
              </div>
              <div class="item-right">
                <span class="badge ${a.status === 'Submitted' ? 'badge-submitted' : 'badge-assigned'}">${a.status}</span>
              </div>
            </div>
          `).join('')}
        </div>
      `;

    } else if (activeCourseTab === 'grades') {
      const grades = await api.get(`/grades/course/${courseId}`);
      if (grades.length === 0) {
        contentContainer.innerHTML = `<div class="card" style="text-align:center;color:var(--text-muted)">No grades posted for this course.</div>`;
        return;
      }

      contentContainer.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:12px;">
          ${grades.map(g => {
            const percent = g.percentage;
            let barColor = 'var(--primary)';
            if (percent >= 90) barColor = 'var(--accent)';
            else if (percent >= 80) barColor = 'var(--success)';
            else if (percent < 65) barColor = 'var(--danger)';

            return `
              <div class="card" style="padding:16px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                  <span style="font-weight:600;font-size:0.95rem;">${escapeHtml(g.assignment_name)}</span>
                  <span style="font-weight:700;color:${barColor};">${g.grade} / ${g.grade_max}</span>
                </div>
                ${percent !== null ? `
                  <div class="progress-bar-container">
                    <div class="progress-bar-fill" style="width: ${percent}%; background-color: ${barColor};"></div>
                  </div>
                  <div style="font-size:0.75rem; color:var(--text-secondary); text-align:right; margin-top:4px;">${percent}%</div>
                ` : ''}
              </div>
            `;
          }).join('')}
        </div>
      `;

    } else if (activeCourseTab === 'files') {
      const res = await api.get(`/files/course/${courseId}`);
      const sections = res.sections || {};
      const sectionKeys = Object.keys(sections);

      if (sectionKeys.length === 0) {
        contentContainer.innerHTML = `<div class="card" style="text-align:center;color:var(--text-muted)">No files parsed for this course. Run Sync to scrape.</div>`;
        return;
      }

      contentContainer.innerHTML = sectionKeys.map(secName => `
        <div style="margin-bottom:20px;">
          <h4 style="margin-bottom:10px; color:var(--secondary); font-size:1.05rem;">${escapeHtml(secName)}</h4>
          <div style="display:flex; flex-direction:column; gap:8px;">
            ${sections[secName].map(f => `
              <div class="list-item">
                <div class="item-left">
                  <span class="item-title">${escapeHtml(f.file_name)}</span>
                  <div class="item-meta">
                    <span>Size: ${formatBytes(parseInt(f.file_size))}</span>
                  </div>
                </div>
                <div class="item-right">
                  <a href="/api/files/download?url=${encodeURIComponent(f.file_url)}" download="${escapeHtml(f.file_name)}" class="btn btn-secondary" style="padding:6px 12px; font-size:0.8rem;">
                    Download
                  </a>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `).join('');

    } else if (activeCourseTab === 'recordings') {
      const recordings = await api.get(`/recordings/course/${courseId}`);
      if (recordings.length === 0) {
        contentContainer.innerHTML = `<div class="card" style="text-align:center;color:var(--text-muted)">No lecture recordings found. Configure SSO folder mappings in Settings.</div>`;
        return;
      }

      contentContainer.innerHTML = `
        <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap:20px;">
          ${recordings.map(r => `
            <div class="card" style="display:flex; flex-direction:column; justify-content:space-between; min-height:150px;">
              <div>
                <span class="badge" style="background:rgba(255,255,255,0.05); color:var(--text-secondary); margin-bottom:8px;">${escapeHtml(r.type)}</span>
                <h4 style="font-size:1rem; font-weight:700; margin-bottom:4px;">${escapeHtml(r.title)}</h4>
                <div style="font-size:0.75rem; color:var(--text-muted);">${escapeHtml(r.published_date)}</div>
              </div>
              <div style="margin-top:16px; display:flex; justify-content:space-between; align-items:center;">
                <span style="font-size:0.8rem; color:var(--text-muted);">${escapeHtml(r.status)}</span>
                <a href="${r.recording_link}" target="_blank" class="btn btn-primary" style="padding:6px 12px; font-size:0.8rem;">Watch</a>
              </div>
            </div>
          `).join('')}
        </div>
      `;

    } else if (activeCourseTab === 'meetings') {
      const meetings = await api.get(`/meetings/course/${courseId}`);
      if (meetings.length === 0) {
        contentContainer.innerHTML = `<div class="card" style="text-align:center;color:var(--text-muted)">No Zoom links found in this course.</div>`;
        return;
      }

      contentContainer.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:10px;">
          ${meetings.map(m => `
            <div class="list-item">
              <div class="item-left">
                <span class="item-title">${escapeHtml(m.title)}</span>
                <div class="item-meta">
                  <span>Section: ${escapeHtml(m.section_name || 'General')}</span>
                </div>
              </div>
              <div class="item-right">
                <a href="${m.meeting_url}" target="_blank" class="btn btn-primary" style="padding:6px 12px; font-size:0.8rem;">Join Meeting</a>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }
  } catch (err) {
    contentContainer.innerHTML = `<div class="card" style="color:var(--danger)">Error loading tab contents: ${err.message || 'Server error'}</div>`;
  }
}

// Helpers
function formatBytes(bytes, decimals = 2) {
  if (!bytes || isNaN(bytes)) return '0 Bytes';
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
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
