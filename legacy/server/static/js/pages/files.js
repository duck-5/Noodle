import { api } from '../api.js';
import { toast } from '../components/toast.js';

let filesSearchQuery = '';
let activeFilesTab = 'all'; // 'all' or 'recent'
let coursesData = [];
let filesByCourse = {}; // courseId -> list of files
let recentFilesData = [];

export async function renderFiles(container, params) {
  const pageTitleEl = document.getElementById('page-title');
  if (pageTitleEl) pageTitleEl.innerText = 'Files';

  container.innerHTML = `
    <!-- Files Tab selection and Search -->
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px; margin-bottom:24px;" class="fade-in">
      <div class="tab-container" style="margin-bottom:0; border:none;">
        <button class="tab-btn ${activeFilesTab === 'all' ? 'active' : ''}" id="files-tab-all">All Course Files</button>
        <button class="tab-btn ${activeFilesTab === 'recent' ? 'active' : ''}" id="files-tab-recent">Recent Files (7 Days)</button>
      </div>
      
      <div style="position:relative; min-width:240px;">
        <input class="form-control" type="text" id="files-search-input" placeholder="Search files by name..." style="padding-right:40px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="position:absolute; right:12px; top:12px; width:18px; height:18px; color:var(--text-muted); pointer-events:none;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      </div>
    </div>

    <!-- Main Container -->
    <div id="files-list-container" class="fade-in" style="display:flex; flex-direction:column; gap:20px;">
      <div class="skeleton" style="height:120px; border-radius:12px;"></div>
    </div>
  `;

  // Bind tabs
  document.getElementById('files-tab-all').addEventListener('click', (e) => {
    document.getElementById('files-tab-all').classList.add('active');
    document.getElementById('files-tab-recent').classList.remove('active');
    activeFilesTab = 'all';
    renderFilteredFiles();
  });

  document.getElementById('files-tab-recent').addEventListener('click', (e) => {
    document.getElementById('files-tab-recent').classList.add('active');
    document.getElementById('files-tab-all').classList.remove('active');
    activeFilesTab = 'recent';
    renderFilteredFiles();
  });

  // Bind Search input
  const searchInput = document.getElementById('files-search-input');
  searchInput.value = filesSearchQuery;
  searchInput.addEventListener('input', (e) => {
    filesSearchQuery = e.target.value.toLowerCase().trim();
    renderFilteredFiles();
  });

  // Load data
  await loadFilesData();
}

async function loadFilesData() {
  const container = document.getElementById('files-list-container');
  try {
    // 1. Fetch tracked courses
    coursesData = await api.get('/courses/');
    
    // 2. Fetch recent files
    recentFilesData = await api.get('/files/recent');

    // 3. Fetch course files for each tracked course
    filesByCourse = {};
    await Promise.all(
      coursesData.map(async (course) => {
        try {
          const res = await api.get(`/files/course/${course.course_id}`);
          // Flatten sections into a single list with section metadata
          const sections = res.sections || {};
          let flatFiles = [];
          for (const secName of Object.keys(sections)) {
            sections[secName].forEach(f => {
              flatFiles.push({
                ...f,
                section_name: secName,
                course_name: course.course_name
              });
            });
          }
          filesByCourse[course.course_id] = flatFiles;
        } catch (e) {
          filesByCourse[course.course_id] = [];
        }
      })
    );

    renderFilteredFiles();
  } catch (err) {
    container.innerHTML = `<div class="card" style="color:var(--danger)">Failed to load file index. Please sync first.</div>`;
  }
}

function renderFilteredFiles() {
  const container = document.getElementById('files-list-container');
  
  if (activeFilesTab === 'recent') {
    // Render Recent Files Tab
    let filtered = [...recentFilesData];
    if (filesSearchQuery) {
      filtered = filtered.filter(f => f.file_name.toLowerCase().includes(filesSearchQuery));
    }

    if (filtered.length === 0) {
      container.innerHTML = `<div class="card" style="text-align:center;color:var(--text-muted);padding:32px;">No recent files found matching your search.</div>`;
      return;
    }

    container.innerHTML = `
      <div class="card" style="padding:20px;">
        <h3 style="font-size:1.1rem; font-weight:700; margin-bottom:16px;">Files Updated in Last 7 Days</h3>
        <div style="display:flex; flex-direction:column; gap:10px;">
          ${filtered.map(f => renderFileItemRow(f)).join('')}
        </div>
      </div>
    `;
  } else {
    // Render All Course Files Tab (Grouped by Course)
    if (coursesData.length === 0) {
      container.innerHTML = `
        <div class="card" style="text-align:center; padding:48px; color:var(--text-muted)">
          You are not tracking any courses. Go to Courses and track them.
        </div>
      `;
      return;
    }

    let hasAnyFiles = false;
    let html = '';

    coursesData.forEach(course => {
      let courseFiles = filesByCourse[course.course_id] || [];
      
      if (filesSearchQuery) {
        courseFiles = courseFiles.filter(f => f.file_name.toLowerCase().includes(filesSearchQuery));
      }

      if (courseFiles.length === 0) return; // Skip courses with no matching files
      
      hasAnyFiles = true;

      // Group files by section
      const sections = {};
      courseFiles.forEach(f => {
        sections.setdefault = sections.setdefault || {};
        const sec = f.section_name || 'General';
        sections[sec] = sections[sec] || [];
        sections[sec].push(f);
      });

      html += `
        <div class="card" style="padding:20px;">
          <h3 style="font-size:1.15rem; font-weight:700; color:var(--secondary); margin-bottom:16px; border-bottom:1px solid var(--border-glass); padding-bottom:8px;">
            ${escapeHtml(course.course_name)}
          </h3>
          <div style="display:flex; flex-direction:column; gap:16px;">
            ${Object.keys(sections).map(secName => `
              <div>
                <h4 style="font-size:0.9rem; font-weight:600; color:var(--text-secondary); margin-bottom:10px;">${escapeHtml(secName)}</h4>
                <div style="display:flex; flex-direction:column; gap:8px;">
                  ${sections[secName].map(f => renderFileItemRow(f)).join('')}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    });

    container.innerHTML = hasAnyFiles ? html : `<div class="card" style="text-align:center;color:var(--text-muted);padding:32px;">No course files found matching your search.</div>`;
  }
}

function renderFileItemRow(f) {
  const fileExt = f.file_name.split('.').pop().toLowerCase();
  
  // Choose emoji based on file extension
  let icon = '📄';
  if (['pdf'].includes(fileExt)) icon = '📕';
  else if (['doc', 'docx'].includes(fileExt)) icon = '📘';
  else if (['ppt', 'pptx'].includes(fileExt)) icon = '📙';
  else if (['xls', 'xlsx'].includes(fileExt)) icon = '📗';
  else if (['zip', 'rar', '7z', 'tar', 'gz'].includes(fileExt)) icon = '📦';
  else if (['jpg', 'jpeg', 'png', 'gif', 'svg'].includes(fileExt)) icon = '🖼️';
  else if (['mp4', 'mkv', 'avi', 'mov'].includes(fileExt)) icon = '🎥';
  else if (['mp3', 'wav', 'aac'].includes(fileExt)) icon = '🎵';

  return `
    <div class="list-item">
      <div class="item-left">
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:1.2rem;">${icon}</span>
          <span class="item-title">${escapeHtml(f.file_name)}</span>
        </div>
        <div class="item-meta" style="margin-left:26px;">
          ${f.course_name ? `<span style="font-weight:600;color:var(--primary);">${escapeHtml(f.course_name)}</span>` : ''}
          <span>Size: ${formatBytes(parseInt(f.file_size))}</span>
        </div>
      </div>
      <div class="item-right">
        <a href="/api/files/download?url=${encodeURIComponent(f.file_url)}" download="${escapeHtml(f.file_name)}" class="btn btn-secondary" style="padding:6px 12px; font-size:0.8rem;">
          Download
        </a>
      </div>
    </div>
  `;
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
