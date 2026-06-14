class ToastManager {
  constructor() {
    this.container = null;
    this.init();
  }

  init() {
    // Create container if it doesn't exist
    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    this.container = container;
  }

  show(message, type = 'info', duration = 4000) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    // Choose appropriate SVG icon
    let icon = '';
    if (type === 'success') {
      icon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px;height:20px;color:var(--success)"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
    } else if (type === 'error') {
      icon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px;height:20px;color:var(--danger)"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
    } else {
      icon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px;height:20px;color:var(--secondary)"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
    }

    toast.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px">
        ${icon}
        <span style="font-size:0.9rem;font-weight:500">${message}</span>
      </div>
      <span class="toast-close">&times;</span>
    `;

    this.container.appendChild(toast);

    // Trigger animate-in
    setTimeout(() => toast.classList.add('show'), 10);

    // Auto-remove
    const timer = setTimeout(() => this.remove(toast), duration);

    // Close button click listener
    toast.querySelector('.toast-close').addEventListener('click', () => {
      clearTimeout(timer);
      this.remove(toast);
    });
  }

  remove(toast) {
    toast.classList.remove('show');
    toast.addEventListener('transitionend', () => toast.remove());
  }

  success(message, duration) { this.show(message, 'success', duration); }
  error(message, duration) { this.show(message, 'error', duration); }
  info(message, duration) { this.show(message, 'info', duration); }
}

export const toast = new ToastManager();
window.toast = toast; // expose globally for convenience
