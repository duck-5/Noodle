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
          <input type="text" id="moodle-username" class="form-control">
        </div>
        <div class="form-group">
          <label class="form-label" for="moodle-password">Moodle Password</label>
          <input type="password" id="moodle-password" class="form-control" placeholder="Leave blank to keep existing">
        </div>
        
        <div style="text-align:center; margin: 16px 0; color:var(--text-muted); font-size: 0.9rem;">— OR —</div>
        
        <div class="form-group">
          <label class="form-label" for="moodle-token">Manual Moodle Token</label>
          <input type="text" id="moodle-token" class="form-control" placeholder="Paste manual wstoken here">
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
        
        <div style="display:flex; gap:16px; margin-top: 16px;">
          <button type="button" class="btn btn-secondary" id="validate-btn">Validate User</button>
          <button type="submit" class="btn btn-primary" id="save-btn">Save Settings</button>
        </div>
      </form>
    </div>

    <div class="card fade-in" style="max-width: 600px; margin: 24px auto 0;">
      <h3 class="widget-title" style="margin-bottom: 24px;">Tracked Courses Configuration</h3>
      <p style="color: var(--text-muted); margin-bottom: 16px; font-size: 0.9rem;">
        Configure custom display names (aliases) and Panopto folder URLs for your tracked courses.
      </p>
      <div id="course-config-list">
        <div class="skeleton skeleton-text"></div>
      </div>
      <div style="display:flex; justify-content:flex-end; margin-top: 16px;">
        <button type="button" class="btn btn-primary" id="save-courses-btn" style="display:none;">Save Course Configs</button>
      </div>
    </div>
  `;

  // Load existing settings
  try {
    const settings = await api.get('/settings/');
    document.getElementById('moodle-username').value = settings.moodle_username || '';
  } catch (e) {
    console.error("No settings found or failed to load");
  }

  // Handle Validation
  document.getElementById('validate-btn').addEventListener('click', async (e) => {
    const btn = e.target;
    const oldText = btn.innerText;
    btn.disabled = true;
    btn.innerText = 'Validating...';

    const payload = {
      moodle_username: document.getElementById('moodle-username').value || null,
      moodle_password: document.getElementById('moodle-password').value || null,
      moodle_token: document.getElementById('moodle-token').value || null
    };

    try {
      const res = await api.post('/settings/validate', payload);
      if (res.valid) {
        toast.success(res.message || 'Credentials are valid!');
      } else {
        toast.error(res.message || 'Validation failed.');
      }
    } catch (err) {
      toast.error(err.message || 'Error occurred during validation.');
    } finally {
      btn.disabled = false;
      btn.innerText = oldText;
    }
  });

  // Handle save
  document.getElementById('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('save-btn');
    const oldText = btn.innerText;
    btn.disabled = true;
    btn.innerText = 'Saving...';

    const payload = {
      moodle_username: document.getElementById('moodle-username').value || null,
      moodle_password: document.getElementById('moodle-password').value || null,
      moodle_token: document.getElementById('moodle-token').value || null,
      sso_id: document.getElementById('sso-id').value || null,
      sso_password: document.getElementById('sso-password').value || null
    };

    try {
      await api.post('/settings/', payload);
      toast.success('Settings saved successfully!');
      document.getElementById('moodle-password').value = '';
      document.getElementById('sso-password').value = '';
      document.getElementById('moodle-token').value = '';
    } catch (err) {
      toast.error(err.message || 'Failed to save settings');
    } finally {
      btn.disabled = false;
      btn.innerText = oldText;
    }
  });

  // Load Course Configurations
  async function loadCourseConfigs() {
    try {
      const [courses, mappings] = await Promise.all([
        api.get('/courses/'),
        api.get('/settings/panopto-courses')
      ]);

      const configContainer = document.getElementById('course-config-list');
      const saveBtn = document.getElementById('save-courses-btn');

      if (!courses || courses.length === 0) {
        configContainer.innerHTML = '<p style="color:var(--text-muted);">No courses tracked yet.</p>';
        saveBtn.style.display = 'none';
        return;
      }

      saveBtn.style.display = 'block';
      
      let html = '';
      courses.forEach(c => {
        const panoptoUrl = mappings[c.course_id] || '';
        const safeName = c.course_name ? c.course_name.replace(/"/g, '&quot;') : '';
        const safeUrl = panoptoUrl.replace(/"/g, '&quot;');
        
        html += `
          <div class="form-group" style="border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 16px; margin-bottom: 16px;">
            <label class="form-label" style="color:var(--secondary);">${c.course_id} (Original: ${c.semester} ${c.year})</label>
            <div style="display:flex; gap:10px; margin-bottom:8px;">
              <input type="text" class="form-control course-alias-input" data-id="${c.course_id}" value="${safeName}" placeholder="Course Alias">
            </div>
            <div style="display:flex; gap:10px;">
              <input type="text" class="form-control course-panopto-input" data-id="${c.course_id}" value="${safeUrl}" placeholder="Panopto Folder URL / ID">
            </div>
          </div>
        `;
      });
      configContainer.innerHTML = html;

      saveBtn.onclick = async () => {
        const oldText = saveBtn.innerText;
        saveBtn.disabled = true;
        saveBtn.innerText = 'Saving...';
        try {
          const aliasInputs = document.querySelectorAll('.course-alias-input');
          const panoptoInputs = document.querySelectorAll('.course-panopto-input');
          
          const mappingsPayload = {};
          
          // Gather mappings
          panoptoInputs.forEach(inp => {
            if (inp.value.trim()) {
              mappingsPayload[inp.dataset.id] = inp.value.trim();
            }
          });
          
          await api.post('/settings/panopto-courses', { course_mappings: mappingsPayload });
          
          // Save aliases
          for (let inp of aliasInputs) {
             const cid = inp.dataset.id;
             const val = inp.value.trim();
             if (val) {
                await api.patch('/courses/' + cid, { course_name: val });
             }
          }
          
          toast.success('Course configurations saved!');
        } catch (err) {
          toast.error(err.message || 'Failed to save course configurations.');
        } finally {
          saveBtn.disabled = false;
          saveBtn.innerText = oldText;
        }
      };

    } catch (e) {
      document.getElementById('course-config-list').innerHTML = '<p style="color:var(--danger);">Failed to load courses configuration.</p>';
    }
  }

  loadCourseConfigs();
}
