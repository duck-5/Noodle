import { api } from '../api.js';
import { auth } from '../auth.js';
import { toast } from '../components/toast.js';

export async function renderAuth(container, params) {
  // Determine if login or register based on active route path
  const isRegister = window.location.hash.endsWith('/register');
  
  container.innerHTML = `
    <div class="card auth-card fade-in">
      <div class="auth-logo">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:36px;height:36px;color:var(--secondary)"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
        TauTracker
      </div>
      <div class="auth-subtitle">${isRegister ? 'Create a secure multi-user Moodle account' : 'Sign in to access your dashboard'}</div>
      
      <form id="auth-form" novalidate>
        <div class="form-group">
          <label class="form-label" for="username">Username</label>
          <input class="form-control" type="text" id="username" placeholder="e.g. janesmith" required minlength="3">
        </div>
        
        ${isRegister ? `
        <div class="form-group">
          <label class="form-label" for="email">Email Address</label>
          <input class="form-control" type="email" id="email" placeholder="e.g. jane@student.tau.ac.il" required>
        </div>
        ` : ''}
        
        <div class="form-group">
          <label class="form-label" for="password">Password</label>
          <input class="form-control" type="password" id="password" placeholder="••••••••" required minlength="6">
        </div>

        ${isRegister ? `
        <div class="form-group">
          <label class="form-label" for="confirm-password">Confirm Password</label>
          <input class="form-control" type="password" id="confirm-password" placeholder="••••••••" required>
        </div>
        ` : ''}
        
        <button type="submit" class="btn btn-primary" style="width: 100%; margin-top: 10px;">
          ${isRegister ? 'Register Account' : 'Sign In'}
        </button>
      </form>
      
      <div class="auth-toggle">
        ${isRegister ? `
          Already have an account? <span class="auth-toggle-link" id="link-to-login">Sign In</span>
        ` : `
          New to TauTracker? <span class="auth-toggle-link" id="link-to-register">Create Account</span>
        `}
      </div>
    </div>
  `;

  // Bind toggles
  if (isRegister) {
    document.getElementById('link-to-login').addEventListener('click', () => {
      window.location.hash = '#/login';
    });
  } else {
    document.getElementById('link-to-register').addEventListener('click', () => {
      window.location.hash = '#/register';
    });
  }

  // Handle Form Submission
  const form = document.getElementById('auth-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Reset any shake animation
    const card = container.querySelector('.auth-card');
    card.classList.remove('shake');
    
    // Collect values
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const email = isRegister ? document.getElementById('email').value.trim() : null;
    const confirmPassword = isRegister ? document.getElementById('confirm-password').value : null;
    
    // Validation
    if (!username || !password || (isRegister && (!email || !confirmPassword))) {
      toast.error('Please fill in all fields');
      card.classList.add('shake');
      return;
    }

    if (username.length < 3) {
      toast.error('Username must be at least 3 characters');
      card.classList.add('shake');
      return;
    }

    if (password.length < 6) {
      toast.error('Password must be at least 6 characters');
      card.classList.add('shake');
      return;
    }
    
    if (isRegister) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        toast.error('Please enter a valid email address');
        card.classList.add('shake');
        return;
      }
      if (password !== confirmPassword) {
        toast.error('Passwords do not match');
        card.classList.add('shake');
        return;
      }
    }
    
    const submitBtn = form.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerText;
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<svg class="spin" style="width: 20px; height: 20px; color: white;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>`;

    try {
      if (isRegister) {
        // Registration
        await api.post('/auth/register', { username, email, password });
        toast.success('Registration successful! Please sign in.');
        window.location.hash = '#/login';
      } else {
        // Login - FastAPI expects OAuth2 form parameters or JSON depending on route.
        // Let's check how POST /api/auth/login is implemented.
        // Let's look at server/routes/auth.py or read documentation to ensure correct parameters.
        // We'll call the JSON login (which supports {username, password} or form data).
        // Let's send a standard post JSON request first.
        const res = await api.post('/auth/login', { username, password });
        auth.setSession(res.access_token, { username, user_id: res.user_id });
        toast.success(`Welcome back, ${username}!`);
        window.location.hash = '#/dashboard';
      }
    } catch (err) {
      toast.error(err.message || 'Authentication failed');
      card.classList.add('shake');
      submitBtn.disabled = false;
      submitBtn.innerText = originalText;
    }
  });
}
