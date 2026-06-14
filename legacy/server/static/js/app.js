import { Router } from './router.js';
import { auth } from './auth.js';

// Import Page Renderers
import { renderAuth } from './pages/auth.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderCourses } from './pages/courses.js';
import { renderAssignments } from './pages/assignments.js';
import { renderGrades } from './pages/grades.js';
import { renderFiles } from './pages/files.js';
import { renderRecordings } from './pages/recordings.js';
import { renderMeetings } from './pages/meetings.js';
import { renderSettings } from './pages/settings.js';

// Route Table
const routes = [
  { path: '/login', name: 'login', isAuth: true, render: renderAuth },
  { path: '/register', name: 'register', isAuth: true, render: renderAuth },
  
  { path: '/dashboard', name: 'dashboard', render: renderDashboard },
  
  { path: '/courses', name: 'courses', render: renderCourses },
  { path: '/courses/:id', name: 'courses', render: renderCourses }, // highlight same sidebar item
  
  { path: '/assignments', name: 'assignments', render: renderAssignments },
  
  { path: '/grades', name: 'grades', render: renderGrades },
  
  { path: '/files', name: 'files', render: renderFiles },
  
  { path: '/recordings', name: 'recordings', render: renderRecordings },
  
  { path: '/meetings', name: 'meetings', render: renderMeetings },
  
  { path: '/settings', name: 'settings', render: renderSettings }
];

// Instantiating Hash Router
const router = new Router(routes, '#/dashboard', '#/login');

// Bootstrapping
document.addEventListener('DOMContentLoaded', () => {
  router.init();

  // Listen to Global Events
  window.addEventListener('logout', () => {
    auth.logout();
  });
});
