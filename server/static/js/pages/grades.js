import { api } from '../api.js';
import { toast } from '../components/toast.js';

export async function renderGrades(container, params) {
  const pageTitleEl = document.getElementById('page-title');
  if (pageTitleEl) pageTitleEl.innerText = 'Grades';

  container.innerHTML = `
    <!-- Overall Transcript Stats -->
    <div class="dashboard-stats fade-in">
      <div class="card stat-card">
        <div class="stat-label">Graded Assignments</div>
        <div class="stat-value" id="stats-graded-count">-</div>
      </div>
      <div class="card stat-card">
        <div class="stat-label">Cumulative GPA</div>
        <div class="stat-value" id="stats-gpa">-</div>
      </div>
      <div class="card stat-card">
        <div class="stat-label">Best Performing Course</div>
        <div class="stat-value" id="stats-best-course" style="font-size: 1.2rem; line-height: 1.5;">-</div>
      </div>
    </div>

    <!-- Collapsible Course-wise list -->
    <div style="display:flex; flex-direction:column; gap:16px; margin-top:24px;" id="grades-transcript-container" class="fade-in">
      <div class="skeleton" style="height:120px; border-radius:12px;"></div>
      <div class="skeleton" style="height:120px; border-radius:12px;"></div>
    </div>
  `;

  await loadGradesData();
}

async function loadGradesData() {
  const container = document.getElementById('grades-transcript-container');
  try {
    const [grades, summary] = await Promise.all([
      api.get('/grades/'),
      api.get('/grades/summary')
    ]);

    // Aggregate values
    document.getElementById('stats-graded-count').innerText = grades.length;

    const validAverages = summary.filter(s => s.average_percentage !== null);
    if (validAverages.length > 0) {
      const sum = validAverages.reduce((acc, curr) => acc + curr.average_percentage, 0);
      const cumulative = Math.round((sum / validAverages.length) * 100) / 100;
      document.getElementById('stats-gpa').innerText = `${cumulative}%`;
      
      // Find best course
      let best = validAverages[0];
      validAverages.forEach(v => {
        if (v.average_percentage > best.average_percentage) {
          best = v;
        }
      });
      document.getElementById('stats-best-course').innerHTML = `
        <span style="font-size: 1.8rem; font-weight: 800; color: var(--success);">${best.average_percentage}%</span><br>
        <span style="font-size:0.8rem; color:var(--text-secondary); display:block; text-overflow:ellipsis; overflow:hidden; white-space:nowrap; max-width:200px;">
          ${escapeHtml(best.course_name)}
        </span>
      `;
    } else {
      document.getElementById('stats-gpa').innerText = '-';
      document.getElementById('stats-best-course').innerText = '-';
    }

    if (summary.length === 0) {
      container.innerHTML = `
        <div class="card" style="text-align:center; padding:48px; color:var(--text-muted)">
          No graded courses found. Run synchronization in the top header.
        </div>
      `;
      return;
    }

    // Render course breakdown
    container.innerHTML = summary.map(c => {
      const courseGrades = grades.filter(g => String(g.course_id) === String(c.course_id));
      const hasGrades = courseGrades.length > 0;
      const avgPercent = c.average_percentage;

      let colorClass = 'var(--primary)';
      if (avgPercent >= 90) colorClass = 'var(--accent)';
      else if (avgPercent >= 80) colorClass = 'var(--success)';
      else if (avgPercent < 65) colorClass = 'var(--danger)';

      return `
        <div class="content-section card" style="padding:0; overflow:hidden;" id="course-sec-${c.course_id}">
          <div class="section-header" style="background:rgba(255,255,255,0.01); border:none; border-radius:0; padding:20px 24px;" onclick="this.parentNode.classList.toggle('open')">
            <div style="display:flex; flex-direction:column; gap:4px; text-align:left;">
              <span class="section-name" style="font-size:1.1rem; font-weight:700;">${escapeHtml(c.course_name)}</span>
              <span style="font-size:0.75rem; color:var(--text-muted)">Graded: ${c.graded_assignments} / ${c.total_assignments} assignments</span>
            </div>
            <div style="display:flex; align-items:center; gap:20px;">
              ${avgPercent !== null ? `
                <div style="text-align:right;">
                  <span style="font-size:1.2rem; font-weight:800; color:${colorClass};">${avgPercent}%</span>
                  <div style="font-size:0.7rem; color:var(--text-muted)">average</div>
                </div>
              ` : '<span style="font-size:0.9rem; color:var(--text-muted)">No grades</span>'}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;"><polyline points="6 9 12 15 18 9"/></svg>
            </div>
          </div>
          
          <div class="section-modules" style="padding:0 24px 20px; display:flex; flex-direction:column; gap:12px; border-top:1px solid var(--border-glass); margin-top:0;">
            ${hasGrades ? courseGrades.map(g => {
              const percent = g.percentage;
              let barColor = 'var(--primary)';
              if (percent >= 90) barColor = 'var(--accent)';
              else if (percent >= 80) barColor = 'var(--success)';
              else if (percent < 65) barColor = 'var(--danger)';

              return `
                <div style="display:flex; flex-direction:column; gap:6px; padding:12px 0; border-bottom:1px solid rgba(255,255,255,0.02);">
                  <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span style="font-size:0.95rem; font-weight:600;">${escapeHtml(g.assignment_name)}</span>
                    <span style="font-weight:700; color:${barColor}; font-size:1rem;">${g.grade} / ${g.grade_max}</span>
                  </div>
                  ${percent !== null ? `
                    <div style="display:grid; grid-template-columns: 1fr auto; align-items:center; gap:16px;">
                      <div class="progress-bar-container" style="margin-top:0;">
                        <div class="progress-bar-fill" style="width: ${percent}%; background-color: ${barColor};"></div>
                      </div>
                      <span style="font-size:0.75rem; font-weight:600; color:var(--text-secondary); width:35px; text-align:right;">${percent}%</span>
                    </div>
                  ` : ''}
                </div>
              `;
            }).join('') : `
              <div style="text-align:center; padding:16px; color:var(--text-muted); font-size:0.9rem;">
                No graded assignments recorded for this course.
              </div>
            `}
          </div>
        </div>
      `;
    }).join('');

  } catch (err) {
    container.innerHTML = `<div class="card" style="color:var(--danger)">Failed to load transcript data.</div>`;
  }
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
