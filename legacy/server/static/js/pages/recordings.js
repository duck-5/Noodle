import { api } from '../api.js';
import { toast } from '../components/toast.js';

let filterCourse = 'all';
let filterType = 'all';
let recordingsData = [];

export async function renderRecordings(container, params) {
  const pageTitleEl = document.getElementById('page-title');
  if (pageTitleEl) pageTitleEl.innerText = 'Recordings';

  container.innerHTML = `
    <!-- Filters -->
    <div class="page-filters fade-in">
      <div>
        <label class="form-label" style="margin-bottom:4px;">Filter by Course</label>
        <select class="filter-select" id="recs-filter-course">
          <option value="all">All Courses</option>
        </select>
      </div>
      <div>
        <label class="form-label" style="margin-bottom:4px;">Type</label>
        <select class="filter-select" id="recs-filter-type">
          <option value="all">All Types</option>
          <option value="Lecture">Lectures</option>
          <option value="Recitation">Recitations</option>
        </select>
      </div>
    </div>

    <!-- Course Grouped list -->
    <div style="display:flex; flex-direction:column; gap:20px; margin-top:16px;" id="recordings-container" class="fade-in">
      <div class="skeleton" style="height:120px; border-radius:12px;"></div>
    </div>
  `;

  // Populate course dropdown
  try {
    const tracked = await api.get('/courses/');
    const courseSelect = document.getElementById('recs-filter-course');
    tracked.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.course_id;
      opt.innerText = c.course_name;
      courseSelect.appendChild(opt);
    });
  } catch (e) {}

  // Restore filters
  document.getElementById('recs-filter-course').value = filterCourse;
  document.getElementById('recs-filter-type').value = filterType;

  // Bind change events
  document.getElementById('recs-filter-course').addEventListener('change', (e) => {
    filterCourse = e.target.value;
    applyFilters();
  });
  document.getElementById('recs-filter-type').addEventListener('change', (e) => {
    filterType = e.target.value;
    applyFilters();
  });

  await fetchRecordings();
}

async function fetchRecordings() {
  const container = document.getElementById('recordings-container');
  try {
    recordingsData = await api.get('/recordings/');
    applyFilters();
  } catch (err) {
    container.innerHTML = `<div class="card" style="color:var(--danger)">Failed to load recordings. Make sure SSO is configured and you have run Sync.</div>`;
  }
}

function applyFilters() {
  const container = document.getElementById('recordings-container');
  let filtered = [...recordingsData];

  // Course filter
  if (filterCourse !== 'all') {
    filtered = filtered.filter(r => String(r.course_id) === filterCourse);
  }

  // Type filter
  if (filterType !== 'all') {
    filtered = filtered.filter(r => r.type === filterType);
  }

  if (filtered.length === 0) {
    container.innerHTML = `<div class="card" style="text-align:center;color:var(--text-muted);padding:32px;">No recordings match your filter criteria.</div>`;
    return;
  }

  // Group by course
  const courses = {};
  filtered.forEach(r => {
    courses[r.course_name] = courses[r.course_name] || [];
    courses[r.course_name].push(r);
  });

  container.innerHTML = Object.keys(courses).map(cName => {
    const courseRecs = courses[cName];
    return `
      <div class="card" style="padding:20px;">
        <h3 style="font-size:1.15rem; font-weight:700; color:var(--secondary); margin-bottom:16px; border-bottom:1px solid var(--border-glass); padding-bottom:8px;">
          ${escapeHtml(cName)}
        </h3>
        
        <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap:20px;">
          ${courseRecs.map(r => {
            const isWatched = r.status === 'Watched';
            
            return `
              <div class="card interactive" style="display:flex; flex-direction:column; justify-content:space-between; min-height:160px; background: rgba(255,255,255,0.01);" data-id="${r.id}">
                <div>
                  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <span class="badge" style="background:${r.type === 'Lecture' ? 'rgba(0,210,255,0.1)' : 'rgba(34,197,94,0.1)'}; color:${r.type === 'Lecture' ? 'var(--secondary)' : 'var(--success)'};">
                      ${r.type}
                    </span>
                    <label style="display:inline-flex; align-items:center; gap:6px; cursor:pointer; font-size:0.75rem; color:var(--text-secondary);">
                      <input type="checkbox" class="watch-toggle-checkbox" data-id="${r.id}" ${isWatched ? 'checked' : ''}>
                      <span>Watched</span>
                    </label>
                  </div>
                  <h4 style="font-size:0.95rem; font-weight:700; margin-bottom:4px; line-height:1.4;">${escapeHtml(r.title)}</h4>
                  <div style="font-size:0.75rem; color:var(--text-muted);">${escapeHtml(r.published_date)}</div>
                </div>
                <div style="margin-top:16px; display:flex; justify-content:flex-end;">
                  <a href="${r.recording_link}" target="_blank" class="btn btn-primary watch-recording-btn" data-id="${r.id}" style="padding:6px 16px; font-size:0.8rem; border-radius:6px; width:100%;">
                    Play Video
                  </a>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }).join('');

  // Bind watch status toggle checkboxes
  const checkboxes = container.querySelectorAll('.watch-toggle-checkbox');
  checkboxes.forEach(cb => {
    cb.addEventListener('change', async (e) => {
      const recId = cb.dataset.id;
      const newStatus = e.target.checked ? 'Watched' : 'Unwatched';
      
      try {
        await api.put(`/recordings/${recId}/status?status=${newStatus}`);
        toast.success(`Marked recording as ${newStatus.toLowerCase()}`);
        
        // Update local memory data
        const localRec = recordingsData.find(r => r.id === recId);
        if (localRec) localRec.status = newStatus;
      } catch (err) {
        toast.error('Failed to update watch status');
        e.target.checked = !e.target.checked; // Revert checkbox
      }
    });
  });

  // Automatically mark as watched when clicking Play Video button
  const playButtons = container.querySelectorAll('.watch-recording-btn');
  playButtons.forEach(btn => {
    btn.addEventListener('click', async () => {
      const recId = btn.dataset.id;
      const cb = container.querySelector(`.watch-toggle-checkbox[data-id="${recId}"]`);
      
      if (cb && !cb.checked) {
        cb.checked = true;
        try {
          await api.put(`/recordings/${recId}/status?status=Watched`);
          const localRec = recordingsData.find(r => r.id === recId);
          if (localRec) localRec.status = 'Watched';
        } catch (e) {}
      }
    });
  });
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
