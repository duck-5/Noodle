import { api } from '../api.js';
import { toast } from '../components/toast.js';

export async function renderSettings(container, params) {
  const pageTitleEl = document.getElementById('page-title');
  if (pageTitleEl) pageTitleEl.innerText = 'Settings';

  container.innerHTML = `
    <div class="card fade-in" style="max-width: 600px; margin: 0 auto;">
      <h3 class="widget-title" style="margin-bottom: 24px;">Moodle Configuration</h3>
      <form id="settings-form">
        <div class="form-group">
          <label class="form-label" for="moodle-username">Moodle Username (ID/Email)</label>
          <input type="text" id="moodle-username" class="form-control" required>
        </div>
        <div class="form-group">
          <label class="form-label" for="moodle-password">Moodle Password</label>
          <input type="password" id="moodle-password" class="form-control" placeholder="Leave blank to keep existing password">
        </div>
        
        <h3 class="widget-title" style="margin-top: 32px; margin-bottom: 24px;">Panopto / SSO (Optional)</h3>
        <p style="color: var(--text-muted); margin-bottom: 16px; font-size: 0.9rem;">
          Required if you want to sync lecture recordings from Panopto.
        </p>
        <div class="form-group">
          <label class="form-label" for="sso-id">SSO ID number</label>
          <input type="text" id="sso-id" class="form-control">
        </div>
        <div class="form-group">
          <label class="form-label" for="sso-password">SSO Password</label>
          <input type="password" id="sso-password" class="form-control">
        </div>
        
        <button type="submit" class="btn btn-primary" style="margin-top: 16px;">Save Settings</button>
      </form>
    </div>
  `;

  // Load existing settings
  try {
    const settings = await api.get('/settings/');
    document.getElementById('moodle-username').value = settings.moodle_username || '';
    document.getElementById('sso-id').value = settings.sso_id || '';
  } catch (e) {
    console.error("No settings found or failed to load");
  }

  // Handle save
  document.getElementById('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    const oldText = btn.innerText;
    btn.disabled = true;
    btn.innerText = 'Saving...';

    const payload = {
      moodle_username: document.getElementById('moodle-username').value,
      moodle_password: document.getElementById('moodle-password').value || null,
      sso_id: document.getElementById('sso-id').value || null,
      sso_password: document.getElementById('sso-password').value || null
    };

    try {
      await api.post('/settings/', payload);
      toast.success('Settings saved successfully!');
      document.getElementById('moodle-password').value = '';
      document.getElementById('sso-password').value = '';
    } catch (err) {
      toast.error(err.message || 'Failed to save settings');
    } finally {
      btn.disabled = false;
      btn.innerText = oldText;
    }
  });
}
