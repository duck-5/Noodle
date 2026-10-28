document.addEventListener('DOMContentLoaded', () => {
  // 1. Theme Switcher
  const themeBtns = document.querySelectorAll('.theme-btn');
  const savedTheme = localStorage.getItem('noodle-landing-theme') || 'light';
  setTheme(savedTheme);

  themeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const theme = btn.getAttribute('data-theme');
      setTheme(theme);
    });
  });

  function setTheme(theme) {
    document.body.classList.remove('theme-dark', 'theme-coffee');
    if (theme === 'dark') {
      document.body.classList.add('theme-dark');
    } else if (theme === 'coffee') {
      document.body.classList.add('theme-coffee');
    }
    localStorage.setItem('noodle-landing-theme', theme);

    themeBtns.forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-theme') === theme);
    });
  }

  // 2. Hero Interactive Mockup Tabs
  const mockupTabBtns = document.querySelectorAll('.mockup-tab-btn');
  const mockupImages = document.querySelectorAll('.mockup-image');

  mockupTabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');

      mockupTabBtns.forEach((b) => b.classList.remove('active'));
      mockupImages.forEach((img) => img.classList.remove('active'));

      btn.classList.add('active');
      const targetImg = document.getElementById(targetId);
      if (targetImg) {
        targetImg.classList.add('active');
      }
    });
  });

  // 3. Feature Deep-Dive Tabs
  const featureNavBtns = document.querySelectorAll('.feature-nav-btn');
  const featurePanels = document.querySelectorAll('.feature-tab-panel');

  featureNavBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const panelId = btn.getAttribute('data-panel');

      featureNavBtns.forEach((b) => b.classList.remove('active'));
      featurePanels.forEach((p) => p.classList.remove('active'));

      btn.classList.add('active');
      const activePanel = document.getElementById(panelId);
      if (activePanel) {
        activePanel.classList.add('active');
      }
    });
  });

  // 4. Real-Time Simulated Deadline Countdown
  // Simulates a realistic student deadline 18 hours, 32 minutes from current visit
  const targetTime = Date.now() + (18 * 3600 + 32 * 60 + 45) * 1000;
  const timerElement = document.getElementById('hero-live-timer');

  if (timerElement) {
    function updateCountdown() {
      const now = Date.now();
      const diff = Math.max(0, targetTime - now);

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      const pad = (n) => String(n).padStart(2, '0');
      timerElement.textContent = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    }

    updateCountdown();
    setInterval(updateCountdown, 1000);
  }

  // 5. Interactive Demo Checklist Clickable Status
  const demoCheckBtn = document.getElementById('demo-mark-done-btn');
  const demoTaskCard = document.getElementById('demo-task-card');
  const demoStatusBadge = document.getElementById('demo-status-badge');

  if (demoCheckBtn && demoTaskCard && demoStatusBadge) {
    let isDone = false;
    demoCheckBtn.addEventListener('click', () => {
      isDone = !isDone;
      if (isDone) {
        demoTaskCard.style.opacity = '0.6';
        demoTaskCard.style.textDecoration = 'line-through';
        demoCheckBtn.textContent = '↩ Undo';
        demoStatusBadge.textContent = '✓ Completed (Synced to Google Tasks)';
        demoStatusBadge.style.background = '#2a9d8f';
        demoStatusBadge.style.color = '#ffffff';
      } else {
        demoTaskCard.style.opacity = '1';
        demoTaskCard.style.textDecoration = 'none';
        demoCheckBtn.textContent = '✓ Mark Done';
        demoStatusBadge.textContent = '⏳ Due in 18h';
        demoStatusBadge.style.background = '#ef4444';
        demoStatusBadge.style.color = '#ffffff';
      }
    });
  }
});
