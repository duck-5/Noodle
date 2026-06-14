import { api } from '../api.js';

export function initGlobalSearch() {
  const searchInput = document.getElementById('global-search-input');
  const resultsContainer = document.getElementById('global-search-results');
  
  if (!searchInput || !resultsContainer) return;

  let debounceTimer;

  searchInput.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    const query = e.target.value.trim();
    
    if (!query) {
      resultsContainer.style.display = 'none';
      return;
    }

    debounceTimer = setTimeout(async () => {
      try {
        const data = await api.get(`/search?q=${encodeURIComponent(query)}`);
        renderSearchResults(data, resultsContainer);
      } catch (err) {
        console.error('Search error:', err);
      }
    }, 300);
  });

  // Hide when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.global-search-container')) {
      resultsContainer.style.display = 'none';
    }
  });
}

function renderSearchResults(data, container) {
  const { courses, tasks } = data;
  let html = '';

  if (courses && courses.length > 0) {
    html += '<div style="padding: 8px 12px; font-weight: bold; background: var(--bg-primary); border-bottom: 1px solid var(--border-color); font-size: 12px; text-transform: uppercase;">Courses</div>';
    courses.forEach(c => {
      html += `
        <a href="#/courses/${c.id}" class="search-result-item" style="display: block; padding: 8px 12px; text-decoration: none; color: var(--text-primary); border-bottom: 1px solid var(--border-color);" onclick="document.getElementById('global-search-results').style.display='none'; document.getElementById('global-search-input').value='';">
          <div style="font-weight: 500;">${c.name}</div>
        </a>
      `;
    });
  }

  if (tasks && tasks.length > 0) {
    html += '<div style="padding: 8px 12px; font-weight: bold; background: var(--bg-primary); border-bottom: 1px solid var(--border-color); font-size: 12px; text-transform: uppercase;">Assignments</div>';
    tasks.forEach(t => {
      html += `
        <a href="#/assignments/${t.id}" class="search-result-item" style="display: block; padding: 8px 12px; text-decoration: none; color: var(--text-primary); border-bottom: 1px solid var(--border-color);" onclick="document.getElementById('global-search-results').style.display='none'; document.getElementById('global-search-input').value='';">
          <div style="font-weight: 500;">${t.name}</div>
          <div style="font-size: 12px; color: var(--text-secondary);">${t.course_name}</div>
        </a>
      `;
    });
  }

  if (!html) {
    html = '<div style="padding: 12px; color: var(--text-secondary); text-align: center;">No results found</div>';
  }

  container.innerHTML = html;
  container.style.display = 'block';

  // Add hover effect dynamically via JS since we can't easily add a new CSS class without modifying global CSS
  const items = container.querySelectorAll('.search-result-item');
  items.forEach(item => {
    item.addEventListener('mouseenter', () => {
      item.style.backgroundColor = 'var(--bg-secondary)';
    });
    item.addEventListener('mouseleave', () => {
      item.style.backgroundColor = 'transparent';
    });
  });
}
