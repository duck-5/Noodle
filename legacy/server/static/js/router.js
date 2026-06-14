import { auth } from './auth.js';

export class Router {
  constructor(routes, defaultRoute = '#/dashboard', loginRoute = '#/login') {
    this.routes = routes;
    this.defaultRoute = defaultRoute;
    this.loginRoute = loginRoute;
  }

  init() {
    window.addEventListener('hashchange', () => this.handleRoute());
    window.addEventListener('load', () => this.handleRoute());
  }

  getCurrentRoute() {
    const hash = window.location.hash || '#/';
    return hash;
  }

  matchRoute(hash) {
    // Strip hash character and trailing/leading slashes
    const path = hash.replace(/^#/, '') || '/';
    
    for (const route of this.routes) {
      // Convert e.g., '/courses/:id' to regex matching
      const paramNames = [];
      const regexPath = route.path
        .replace(/:([^\s/]+)/g, (_, name) => {
          paramNames.push(name);
          return '([^\\s/]+)';
        });
      
      const regex = new RegExp(`^${regexPath}$`);
      const match = path.match(regex);
      
      if (match) {
        const params = {};
        paramNames.forEach((name, index) => {
          params[name] = match[index + 1];
        });
        return { route, params };
      }
    }
    return null;
  }

  async handleRoute() {
    let hash = this.getCurrentRoute();
    
    // Auth route guard
    const isAuthed = auth.isAuthenticated();
    const isAuthPage = hash === '#/login' || hash === '#/register';

    if (!isAuthed && !isAuthPage) {
      window.location.hash = this.loginRoute;
      return;
    }

    if (isAuthed && isAuthPage) {
      window.location.hash = this.defaultRoute;
      return;
    }

    if (hash === '#/' || hash === '') {
      window.location.hash = isAuthed ? this.defaultRoute : this.loginRoute;
      return;
    }

    const matched = this.matchRoute(hash);
    if (!matched) {
      // 404 - fallback to default
      window.location.hash = isAuthed ? this.defaultRoute : this.loginRoute;
      return;
    }

    const { route, params } = matched;

    // Trigger loading state before loading components if app.js handles it
    const appEl = document.getElementById('app');
    
    // Toggle layout modes (auth screens vs sidebar desktop screens)
    if (route.isAuth) {
      appEl.className = 'auth-mode';
      appEl.innerHTML = '<div id="auth-container" class="fade-in"></div>';
    } else {
      appEl.className = '';
      if (!document.getElementById('sidebar-area')) {
        // Render shells if not already present
        appEl.innerHTML = `
          <div id="sidebar-area"></div>
          <div id="header-area"></div>
          <main id="main-area" class="fade-in"></main>
        `;
        // Render components
        this.renderShellComponents();
      }
      this.updateActiveSidebar(route.name);
    }

    // Call the page render function
    const containerId = route.isAuth ? 'auth-container' : 'main-area';
    const container = document.getElementById(containerId);
    
    if (container) {
      container.innerHTML = '<div class="skeleton skeleton-title"></div><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text"></div>';
      try {
        await route.render(container, params);
      } catch (err) {
        container.innerHTML = `
          <div class="card fade-in" style="border-color: var(--danger);">
            <h2 style="color: var(--danger); margin-bottom: 8px;">Error Loading Page</h2>
            <p style="color: var(--text-secondary);">${err.message || 'An unexpected error occurred.'}</p>
            <button class="btn btn-primary" style="margin-top: 16px;" onclick="window.location.reload()">Reload</button>
          </div>
        `;
      }
    }
  }

  updateActiveSidebar(routeName) {
    const items = document.querySelectorAll('.sidebar-item');
    items.forEach(item => {
      if (item.dataset.route === routeName) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
  }

  renderShellComponents() {
    // Render sidebar & header shells
    const sidebarEl = document.getElementById('sidebar-area');
    const headerEl = document.getElementById('header-area');

    if (sidebarEl) {
      const user = auth.getUserInfo();
      const initials = user ? user.username.slice(0, 2).toUpperCase() : 'U';
      sidebarEl.innerHTML = `
        <div class="sidebar-logo">TauTracker</div>
        <ul class="sidebar-menu">
          <li class="sidebar-item" data-route="dashboard" onclick="window.location.hash='#/dashboard'">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>
            Dashboard
          </li>
          <li class="sidebar-item" data-route="courses" onclick="window.location.hash='#/courses'">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/><path d="M6 6h10M6 10h10"/></svg>
            Courses
          </li>
          <li class="sidebar-item" data-route="assignments" onclick="window.location.hash='#/assignments'">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
            Assignments
          </li>
          <li class="sidebar-item" data-route="grades" onclick="window.location.hash='#/grades'">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M3 20v-8a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v8M12 20V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v16"/></svg>
            Grades
          </li>
          <li class="sidebar-item" data-route="files" onclick="window.location.hash='#/files'">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            Files
          </li>
          <li class="sidebar-item" data-route="recordings" onclick="window.location.hash='#/recordings'">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></svg>
            Recordings
          </li>
          <li class="sidebar-item" data-route="meetings" onclick="window.location.hash='#/meetings'">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 7a2 2 0 0 0-2.45-1.45L16 7V5a2 2 0 0 0-2-2H2a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2l4.55 1.45A2 2 0 0 0 23 17V7z"/></svg>
            Meetings
          </li>
          <li class="sidebar-item" data-route="settings" onclick="window.location.hash='#/settings'">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            Settings
          </li>
          <li class="sidebar-item" style="margin-top: auto;" onclick="window.dispatchEvent(new CustomEvent('logout'))">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>
            Logout
          </li>
        </ul>
        <div class="sidebar-footer">TauTracker v2.0.0</div>
      `;
    }

    if (headerEl) {
      const user = auth.getUserInfo();
      const initials = user ? user.username.slice(0, 2).toUpperCase() : 'U';
      headerEl.innerHTML = `
        <div class="header-title" id="page-title">Dashboard</div>
        <div class="header-actions">
          <button class="btn btn-secondary btn-icon" id="sync-now-btn" title="Refresh Moodle Data">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 18px; height: 18px;"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
          </button>
          <div class="user-profile-widget">
            <div class="user-avatar">${initials}</div>
            <div class="user-name">${user ? user.username : 'User'}</div>
          </div>
        </div>
      `;

      // Set up global Sync Listener
      document.getElementById('sync-now-btn').addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('sync-requested'));
      });
    }
  }
}
