import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const promoDir = path.resolve(projectRoot, 'promo');
const screenshotsDir = path.resolve(projectRoot, 'screenshots');
const assetsDir = path.resolve(projectRoot, 'src', 'assets');

if (!fs.existsSync(promoDir)) {
  fs.mkdirSync(promoDir, { recursive: true });
}

function getBase64Image(filePath) {
  if (!fs.existsSync(filePath)) {
    console.warn(`File not found: ${filePath}`);
    return '';
  }
  const ext = path.extname(filePath).slice(1);
  const mime = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/svg+xml';
  const data = fs.readFileSync(filePath).toString('base64');
  return `data:${mime};base64,${data}`;
}

const logoData = getBase64Image(path.join(assetsDir, 'logo.png'));
const dashData = getBase64Image(path.join(screenshotsDir, 'main-dashboard.png'));
const dashDarkData = getBase64Image(path.join(screenshotsDir, 'main-dashboard-dark.png'));
const popupData = getBase64Image(path.join(screenshotsDir, 'toolbar-popup.png'));
const popupHeData = getBase64Image(path.join(screenshotsDir, 'toolbar-popup-he.png'));

const sharedCss = `
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Rubik:wght@400;500;600;700;800&display=swap');
  
  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }
  
  body {
    font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #fdfaf5;
    color: #1e293b;
    overflow: hidden;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }

  .slide-container {
    width: 1280px;
    height: 800px;
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    padding: 40px 52px 36px;
    background: radial-gradient(circle at 85% 15%, rgba(245, 158, 11, 0.16) 0%, transparent 45%),
                radial-gradient(circle at 10% 90%, rgba(99, 102, 241, 0.13) 0%, transparent 40%),
                radial-gradient(circle at 50% 50%, #ffffff 0%, #faf5ed 100%);
  }

  .slide-container::before {
    content: '';
    position: absolute;
    inset: 0;
    background-image: radial-gradient(#d6c7b2 1.2px, transparent 1.2px);
    background-size: 24px 24px;
    opacity: 0.35;
    pointer-events: none;
  }

  .header-zone {
    position: relative;
    z-index: 10;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 20px;
  }

  .brand-pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: rgba(255, 255, 255, 0.95);
    border: 1px solid rgba(224, 138, 60, 0.3);
    box-shadow: 0 4px 12px rgba(224, 138, 60, 0.1);
    backdrop-filter: blur(8px);
    padding: 6px 14px;
    border-radius: 999px;
    font-size: 13px;
    font-weight: 700;
    color: #c2410c;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    margin-bottom: 8px;
  }

  .brand-pill img {
    width: 20px;
    height: 20px;
    object-fit: contain;
  }

  .slide-title {
    font-size: 40px;
    font-weight: 800;
    line-height: 1.15;
    color: #0f172a;
    letter-spacing: -0.8px;
  }

  .slide-title span.highlight {
    background: linear-gradient(135deg, #ea580c 0%, #d97706 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  .slide-subtitle {
    font-size: 17px;
    font-weight: 500;
    color: #64748b;
    margin-top: 4px;
    max-width: 680px;
    line-height: 1.45;
  }

  .pill-group {
    display: flex;
    gap: 10px;
    align-items: center;
  }

  .feature-tag {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.04);
    padding: 7px 14px;
    border-radius: 100px;
    font-size: 13px;
    font-weight: 600;
    color: #334155;
  }

  .feature-tag .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #10b981;
  }

  .browser-frame {
    position: relative;
    z-index: 10;
    flex: 1;
    background: #ffffff;
    border-radius: 14px;
    border: 1px solid rgba(0, 0, 0, 0.08);
    box-shadow: 0 20px 40px -10px rgba(15, 23, 42, 0.16),
                0 0 0 1px rgba(0, 0, 0, 0.04);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .browser-topbar {
    height: 36px;
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
    display: flex;
    align-items: center;
    padding: 0 14px;
    gap: 12px;
  }

  .traffic-lights {
    display: flex;
    gap: 6px;
  }

  .traffic-light {
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }

  .tl-red { background: #ef4444; }
  .tl-yellow { background: #f59e0b; }
  .tl-green { background: #10b981; }

  .browser-address {
    flex: 1;
    max-width: 440px;
    height: 24px;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    display: flex;
    align-items: center;
    padding: 0 10px;
    font-size: 11px;
    font-weight: 500;
    color: #64748b;
    gap: 6px;
  }

  .browser-content {
    flex: 1;
    overflow: hidden;
    position: relative;
    background: #fdfaf5;
  }

  .badge-callout {
    position: absolute;
    z-index: 20;
    background: #ffffff;
    border: 1px solid rgba(226, 232, 240, 0.95);
    border-radius: 14px;
    padding: 12px 18px;
    box-shadow: 0 16px 32px -4px rgba(15, 23, 42, 0.14),
                0 4px 12px rgba(0, 0, 0, 0.05);
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .badge-icon-box {
    width: 38px;
    height: 38px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    flex-shrink: 0;
  }

  .badge-text-title {
    font-size: 13px;
    font-weight: 700;
    color: #0f172a;
  }

  .badge-text-sub {
    font-size: 11px;
    font-weight: 500;
    color: #64748b;
  }

  .speech-bubble {
    background: #ffffff;
    border: 1px solid #fed7aa;
    padding: 6px 14px;
    border-radius: 12px;
    font-size: 12px;
    font-weight: 700;
    color: #c2410c;
    box-shadow: 0 4px 14px rgba(224, 138, 60, 0.18);
    white-space: nowrap;
    z-index: 30;
    position: relative;
  }

  .speech-bubble::after {
    content: '';
    position: absolute;
    bottom: -6px;
    right: 22px;
    border-width: 6px 6px 0;
    border-style: solid;
    border-color: #ffffff transparent;
  }
`;

const slides = [
  // Slide 1: Hero Overview
  {
    name: 'promo-1-hero-overview',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          ${sharedCss}
          .dashboard-scaled-container {
            width: 100%;
            height: 100%;
            overflow: hidden;
            display: flex;
            justify-content: center;
            align-items: flex-start;
            background: #fdfaf5;
          }
          .dashboard-scaled-container img {
            width: 100%;
            height: auto;
            transform: scale(0.97);
            transform-origin: top center;
            display: block;
            image-rendering: -webkit-optimize-contrast;
          }
        </style>
      </head>
      <body>
        <div class="slide-container">
          <div class="header-zone">
            <div>
              <div class="brand-pill">
                <img src="${logoData}" alt="Noodle logo">
                <span>Smart Moodle Companion</span>
              </div>
              <h1 class="slide-title">Meet <span class="highlight">Noodle</span>: Study Smarter</h1>
              <p class="slide-subtitle">A decentralized, beautifully designed dashboard that replaces clunky Moodle with real-time deadlines, Zoom links, and instant sync.</p>
            </div>
            <div class="pill-group">
              <div class="feature-tag"><span class="dot"></span>100% Client-Only</div>
              <div class="feature-tag">🔒 Zero Cloud Storage</div>
              <div class="feature-tag">⚡ Instant Sync</div>
            </div>
          </div>

          <div class="browser-frame">
            <div class="browser-topbar">
              <div class="traffic-lights">
                <span class="traffic-light tl-red"></span>
                <span class="traffic-light tl-yellow"></span>
                <span class="traffic-light tl-green"></span>
              </div>
              <div class="browser-address">
                <span>🔒 chrome-extension://noodle/options.html</span>
              </div>
            </div>
            <div class="browser-content">
              <div class="dashboard-scaled-container">
                <img src="${dashData}" alt="Main Dashboard Preview">
              </div>
            </div>
          </div>

          <!-- Callout 1 -->
          <div class="badge-callout" style="bottom: 45px; left: 40px;">
            <div class="badge-icon-box" style="background: #ecfdf5; color: #059669;">⚡</div>
            <div>
              <div class="badge-text-title">Fast Background Sync</div>
              <div class="badge-text-sub">Pulls deadlines & files seamlessly</div>
            </div>
          </div>

          <!-- Callout 2 -->
          <div class="badge-callout" style="top: 140px; right: 40px;">
            <div class="badge-icon-box" style="background: #eff6ff; color: #2563eb;">🎯</div>
            <div>
              <div class="badge-text-title">Clean & Clutter-Free</div>
              <div class="badge-text-sub">Only what matters for your courses</div>
            </div>
          </div>
        </div>
      </body>
      </html>
    `,
  },

  // Slide 2: Deadlines & Grades (Crisp dedicated deadline cards mockup)
  {
    name: 'promo-2-deadlines-grades',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          ${sharedCss}
          .split-grid {
            position: relative;
            z-index: 10;
            flex: 1;
            display: grid;
            grid-template-columns: 1.25fr 0.75fr;
            gap: 24px;
            align-items: stretch;
          }
          .highlight-card {
            background: #ffffff;
            border-radius: 16px;
            border: 1px solid #e2e8f0;
            padding: 24px;
            box-shadow: 0 16px 36px -8px rgba(15, 23, 42, 0.1);
            display: flex;
            flex-direction: column;
            justify-content: space-between;
          }
          .feature-item {
            display: flex;
            gap: 14px;
            padding: 14px 16px;
            border-radius: 12px;
            background: #f8fafc;
            border: 1px solid #f1f5f9;
            align-items: flex-start;
          }
          .mockup-inner {
            padding: 24px;
            display: flex;
            flex-direction: column;
            gap: 16px;
            background: #fdfaf5;
            height: 100%;
          }
          .task-card-mock {
            background: #ffffff;
            border: 1px solid #e2e8f0;
            border-radius: 14px;
            padding: 18px 22px;
            box-shadow: 0 4px 14px rgba(0, 0, 0, 0.04);
            display: flex;
            flex-direction: column;
            gap: 12px;
            position: relative;
          }
          .task-card-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
          }
          .course-pill-tag {
            font-size: 12px;
            font-weight: 700;
            padding: 3px 10px;
            border-radius: 999px;
            text-transform: uppercase;
            letter-spacing: 0.3px;
          }
          .due-badge-pill {
            font-size: 13px;
            font-weight: 700;
            padding: 6px 14px;
            border-radius: 999px;
            display: inline-flex;
            align-items: center;
            gap: 6px;
          }
          .task-action-btn {
            background: #c2410c;
            color: #ffffff;
            padding: 8px 16px;
            border-radius: 8px;
            font-size: 13px;
            font-weight: 700;
            border: none;
            cursor: pointer;
            box-shadow: 0 2px 6px rgba(194, 65, 12, 0.25);
            display: inline-flex;
            align-items: center;
            gap: 6px;
          }
          .file-attachment-chip {
            background: #f1f5f9;
            border: 1px solid #e2e8f0;
            padding: 5px 12px;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 600;
            color: #475569;
            display: inline-flex;
            align-items: center;
            gap: 6px;
          }
        </style>
      </head>
      <body>
        <div class="slide-container">
          <div class="header-zone">
            <div>
              <div class="brand-pill">
                <img src="${logoData}" alt="Noodle logo">
                <span>Deadline & Grade Management</span>
              </div>
              <h1 class="slide-title">Never Miss a <span class="highlight">Deadline</span> Again</h1>
              <p class="slide-subtitle">Clear countdown timers, urgent deadline banners, and live grade tracking at your fingertips.</p>
            </div>
            <div class="pill-group">
              <div class="feature-tag">⏰ Live Countdowns</div>
              <div class="feature-tag">💯 100/100 Grade Tracking</div>
              <div class="feature-tag">📅 Google Tasks Sync</div>
            </div>
          </div>

          <div class="split-grid">
            <div class="browser-frame">
              <div class="browser-topbar">
                <div class="traffic-lights">
                  <span class="traffic-light tl-red"></span>
                  <span class="traffic-light tl-yellow"></span>
                  <span class="traffic-light tl-green"></span>
                </div>
                <div class="browser-address">
                  <span>🎯 Deadlines & Submissions View</span>
                </div>
              </div>
              <div class="mockup-inner">
                <!-- Task 1: Urgent Deadline -->
                <div class="task-card-mock" style="border-left: 6px solid #ef4444;">
                  <div class="task-card-header">
                    <div>
                      <span class="course-pill-tag" style="background: #ecfdf5; color: #047857;">מבוא למדעי המחשב • CS101</span>
                      <h4 style="font-size: 17px; font-weight: 800; color: #0f172a; margin-top: 6px;">מטלה 1 - רקורסיה ויעילות אלגוריתמית</h4>
                    </div>
                    <div class="due-badge-pill" style="background: #fee2e2; color: #b91c1c;">
                      🔥 בעוד יום (Urgent!)
                    </div>
                  </div>

                  <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                    <div class="file-attachment-chip">📄 instructions_hw1.pdf (0.44 MB)</div>
                    <div class="file-attachment-chip">🐍 hw1_template.py (24 KB)</div>
                  </div>

                  <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #f1f5f9; padding-top: 10px;">
                    <span style="font-size: 12px; font-weight: 600; color: #64748b;">מועד הגשה: מחר, 23:59</span>
                    <button class="task-action-btn">הגש במודל ↗</button>
                  </div>
                </div>

                <!-- Task 2: Approaching Deadline -->
                <div class="task-card-mock" style="border-left: 6px solid #6366f1;">
                  <div class="task-card-header">
                    <div>
                      <span class="course-pill-tag" style="background: #eef2ff; color: #4338ca;">מבני נתונים • DS201</span>
                      <h4 style="font-size: 17px; font-weight: 800; color: #0f172a; margin-top: 6px;">תרגיל בית 2 - עצי חיפוש בינאריים ועצי AVL</h4>
                    </div>
                    <div class="due-badge-pill" style="background: #f1f5f9; color: #4338ca;">
                      ⏱ בעוד 4 ימים
                    </div>
                  </div>

                  <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                    <div class="file-attachment-chip">📄 instructions_hw2.pdf (0.87 MB)</div>
                    <div class="file-attachment-chip">💻 avl_tree_skeleton.cpp (48 KB)</div>
                  </div>

                  <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #f1f5f9; padding-top: 10px;">
                    <span style="font-size: 12px; font-weight: 600; color: #64748b;">מועד הגשה: יום ראשון, 23:59</span>
                    <button class="task-action-btn" style="background: #4338ca;">הגש במודל ↗</button>
                  </div>
                </div>

                <!-- Task 3: Submitted & Graded -->
                <div class="task-card-mock" style="border-left: 6px solid #10b981; opacity: 0.92;">
                  <div class="task-card-header">
                    <div>
                      <span class="course-pill-tag" style="background: #ecfdf5; color: #047857;">מבוא למדעי המחשב • CS101</span>
                      <h4 style="font-size: 16px; font-weight: 700; color: #334155; margin-top: 4px;">מטלה 0 - מבוא לסביבת הפיתוח</h4>
                    </div>
                    <div class="due-badge-pill" style="background: #dcfce7; color: #15803d;">
                      🏆 100 / 100 (הוגש)
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="highlight-card">
              <div style="display: flex; flex-direction: column; gap: 12px;">
                <h3 style="font-size: 20px; font-weight: 700; color: #0f172a; margin-bottom: 2px;">Smart Assignment Highlights</h3>

                <div class="feature-item" style="border-left: 4px solid #ef4444; background: #fff5f5;">
                  <div style="font-size: 24px;">🔥</div>
                  <div>
                    <div style="font-weight: 700; color: #991b1b; font-size: 15px;">Urgent Deadline Alerts</div>
                    <div style="color: #7f1d1d; font-size: 13px; margin-top: 2px;">Color-coded countdown badges ("1 day", "4 days") warn you ahead of time.</div>
                  </div>
                </div>

                <div class="feature-item" style="border-left: 4px solid #10b981; background: #f0fdf4;">
                  <div style="font-size: 24px;">🏆</div>
                  <div>
                    <div style="font-weight: 700; color: #065f46; font-size: 15px;">Real-Time Grade Feedback</div>
                    <div style="color: #047857; font-size: 13px; margin-top: 2px;">Inspect 100/100 grades immediately without digging through gradebooks.</div>
                  </div>
                </div>

                <div class="feature-item" style="border-left: 4px solid #6366f1; background: #eef2ff;">
                  <div style="font-size: 24px;">📊</div>
                  <div>
                    <div style="font-weight: 700; color: #3730a3; font-size: 15px;">Course Progress Tracking</div>
                    <div style="color: #4338ca; font-size: 13px; margin-top: 2px;">Visual progress bars calculate completed vs pending tasks instantly.</div>
                  </div>
                </div>
              </div>

              <div style="background: linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%); padding: 14px 18px; border-radius: 12px; border: 1px solid #fed7aa; display: flex; align-items: center; gap: 12px;">
                <span style="font-size: 22px;">🚀</span>
                <span style="font-size: 13px; font-weight: 600; color: #9a3412;">One-click direct links to Moodle submission pages!</span>
              </div>
            </div>
          </div>
        </div>
      </body>
      </html>
    `,
  },

  // Slide 3: Zoom Hub
  {
    name: 'promo-3-zoom-hub',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          ${sharedCss}
          .zoom-stack {
            position: relative;
            z-index: 10;
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 16px;
          }
          .zoom-banner-mockup {
            background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%);
            color: #ffffff;
            border-radius: 14px;
            padding: 16px 24px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            box-shadow: 0 10px 25px -5px rgba(37, 99, 235, 0.35);
          }
          .upcoming-meetings-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 16px;
          }
          .meeting-card {
            background: #ffffff;
            border-radius: 12px;
            border: 1px solid #e2e8f0;
            padding: 16px 20px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.04);
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .zoom-hub-detail {
            background: #ffffff;
            border-radius: 14px;
            border: 1px solid #e2e8f0;
            padding: 20px 24px;
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 12px;
            box-shadow: 0 8px 24px -4px rgba(15, 23, 42, 0.08);
          }
        </style>
      </head>
      <body>
        <div class="slide-container">
          <div class="header-zone">
            <div>
              <div class="brand-pill">
                <img src="${logoData}" alt="Noodle logo">
                <span>Unified Zoom Lecture Hub</span>
              </div>
              <h1 class="slide-title">Join Live Lectures in <span class="highlight">One Click</span></h1>
              <p class="slide-subtitle">Active classes are detected automatically. No more searching for lost meeting links, passcodes, or dates.</p>
            </div>
            <div class="pill-group">
              <div class="feature-tag">🎥 Automatic Link Discovery</div>
              <div class="feature-tag">● Live Class Banner</div>
              <div class="feature-tag">📅 Weekly Schedule</div>
            </div>
          </div>

          <div class="zoom-stack">
            <!-- Prominent Live Meeting Banner -->
            <div class="zoom-banner-mockup">
              <div style="display: flex; align-items: center; gap: 14px;">
                <span style="display: inline-block; width: 12px; height: 12px; background: #22c55e; border-radius: 50%; box-shadow: 0 0 12px #22c55e;"></span>
                <div>
                  <div style="font-size: 16px; font-weight: 700; letter-spacing: 0.2px;">שיעור שבועי - מבוא למדעי המחשב (● פעיל כעת)</div>
                  <div style="font-size: 13px; opacity: 0.85; margin-top: 2px;">מרצה: פרופ' ישראלי | זמין עכשיו להצטרפות ישירה</div>
                </div>
              </div>
              <div style="background: #ffffff; color: #1e3a8a; padding: 10px 20px; border-radius: 10px; font-weight: 800; font-size: 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">
                🚀 הצטרף לשיעור עכשיו
              </div>
            </div>

            <!-- Scheduled Meetings Row -->
            <div class="upcoming-meetings-grid">
              <div class="meeting-card" style="border-right: 4px solid #10b981;">
                <div>
                  <div style="font-size: 12px; font-weight: 700; color: #10b981; text-transform: uppercase;">מבוא למדעי המחשב</div>
                  <div style="font-size: 14px; font-weight: 700; color: #0f172a; margin-top: 2px;">תרגול 03 - רקורסיה והוכחות נכונות</div>
                  <div style="font-size: 12px; color: #64748b; margin-top: 2px;">יום שלישי, 14:00 • חדר זום של מתרגל</div>
                </div>
                <div style="background: #f1f5f9; color: #334155; padding: 6px 12px; border-radius: 8px; font-size: 12px; font-weight: 700;">
                  במועד 📅
                </div>
              </div>

              <div class="meeting-card" style="border-right: 4px solid #6366f1;">
                <div>
                  <div style="font-size: 12px; font-weight: 700; color: #6366f1; text-transform: uppercase;">מבני נתונים</div>
                  <div style="font-size: 14px; font-weight: 700; color: #0f172a; margin-top: 2px;">הרצאה 05 - עצי AVL ואיזון עצים בינאריים</div>
                  <div style="font-size: 12px; color: #64748b; margin-top: 2px;">יום חמישי, 10:00 • חדר הרצאות ראשי</div>
                </div>
                <div style="background: #f1f5f9; color: #334155; padding: 6px 12px; border-radius: 8px; font-size: 12px; font-weight: 700;">
                  במועד 📅
                </div>
              </div>
            </div>

            <!-- Zoom Hub Value Callout -->
            <div class="zoom-hub-detail">
              <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #f1f5f9; padding-bottom: 8px;">
                <span style="font-size: 14px; font-weight: 700; color: #0f172a;">📅 שאר המפגשים השבועיים המסונכרנים</span>
                <span style="font-size: 12px; font-weight: 600; color: #10b981;">● 4 פגישות מקושרות אוטומטית</span>
              </div>

              <div style="display: flex; flex-direction: column; gap: 8px; margin: 4px 0;">
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 14px; display: flex; justify-content: space-between; align-items: center;">
                  <div style="display: flex; align-items: center; gap: 10px;">
                    <span style="font-size: 18px;">💻</span>
                    <div>
                      <div style="font-size: 13px; font-weight: 700; color: #1e293b;">הרצאה 04: סיבוכיות זמן ומקום וחישוביות</div>
                      <div style="font-size: 11px; color: #64748b;">מבוא למדעי המחשב • יום ראשון, 11:00</div>
                    </div>
                  </div>
                  <span style="font-size: 11px; font-weight: 700; color: #2563eb; background: #eff6ff; padding: 4px 10px; border-radius: 6px;">מקושר לזום 🔗</span>
                </div>

                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 14px; display: flex; justify-content: space-between; align-items: center;">
                  <div style="display: flex; align-items: center; gap: 10px;">
                    <span style="font-size: 18px;">🙋</span>
                    <div>
                      <div style="font-size: 13px; font-weight: 700; color: #1e293b;">שעת קבלה שבועית עם מתרגלי הקורס</div>
                      <div style="font-size: 11px; color: #64748b;">מבני נתונים • יום רביעי, 16:00</div>
                    </div>
                  </div>
                  <span style="font-size: 11px; font-weight: 700; color: #2563eb; background: #eff6ff; padding: 4px 10px; border-radius: 6px;">מקושר לזום 🔗</span>
                </div>
              </div>

              <div style="display: flex; gap: 12px; align-items: center; font-size: 13px; color: #475569; border-top: 1px solid #f1f5f9; padding-top: 10px;">
                <span style="font-size: 20px;">💡</span>
                <span>Noodle סורק את מודול הזום של מודל ומציג את הפגישות הפעילות בראש הדשבורד עם קישור הצטרפות ישיר ללא צורך במעבר בין לשוניות.</span>
              </div>
            </div>
          </div>
        </div>
      </body>
      </html>
    `,
  },

  // Slide 4: Clean Course Files Explorer (Crystal clear, readable files UI mockup)
  {
    name: 'promo-4-course-files',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          ${sharedCss}
          .files-mockup-container {
            flex: 1;
            background: #ffffff;
            border-radius: 14px;
            border: 1px solid #e2e8f0;
            box-shadow: 0 16px 36px -8px rgba(15, 23, 42, 0.12);
            display: flex;
            flex-direction: column;
            overflow: hidden;
          }
          .course-header-bar {
            background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
            border-bottom: 1px solid #e2e8f0;
            padding: 14px 24px;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .topic-pills-row {
            display: flex;
            gap: 8px;
            padding: 10px 24px;
            background: #faf5ed;
            border-bottom: 1px solid #f1f5f9;
            align-items: center;
          }
          .topic-pill {
            padding: 5px 13px;
            border-radius: 999px;
            font-size: 13px;
            font-weight: 600;
            color: #64748b;
            background: #ffffff;
            border: 1px solid #e2e8f0;
            cursor: pointer;
          }
          .topic-pill.active {
            background: #c2410c;
            color: #ffffff;
            border-color: #c2410c;
            box-shadow: 0 2px 6px rgba(194, 65, 12, 0.25);
          }
          .files-list-table {
            flex: 1;
            padding: 10px 24px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            overflow-y: auto;
          }
          .file-row-card {
            background: #ffffff;
            border: 1px solid #f1f5f9;
            border-radius: 10px;
            padding: 9px 16px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            transition: all 0.2s;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.02);
          }
          .file-row-card:hover {
            border-color: #fed7aa;
            background: #fffaf5;
          }
          .file-badge-type {
            font-size: 18px;
            width: 36px;
            height: 36px;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
          }
          .file-download-btn {
            background: #f1f5f9;
            color: #1e293b;
            border: 1px solid #cbd5e1;
            padding: 6px 14px;
            border-radius: 8px;
            font-size: 12px;
            font-weight: 700;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            cursor: pointer;
          }
          .file-download-btn:hover {
            background: #e2e8f0;
          }
        </style>
      </head>
      <body>
        <div class="slide-container">
          <div class="header-zone">
            <div>
              <div class="brand-pill">
                <img src="${logoData}" alt="Noodle logo">
                <span>Clean Course Files & Navigation</span>
              </div>
              <h1 class="slide-title">All Course Files, <span class="highlight">Cleanly Organized</span></h1>
              <p class="slide-subtitle">Filter by weekly topic and download slides, code skeletons, and syllabi in one click with exact file sizes.</p>
            </div>
            <div class="pill-group">
              <div class="feature-tag">📑 1-Click Downloads</div>
              <div class="feature-tag">📦 Exact File Sizes</div>
              <div class="feature-tag">🗂️ Weekly Topic Pills</div>
            </div>
          </div>

          <div class="files-mockup-container">
            <!-- Course Header -->
            <div class="course-header-bar">
              <div>
                <span style="font-size: 12px; font-weight: 700; color: #047857; text-transform: uppercase;">0368-1001-01</span>
                <h3 style="font-size: 20px; font-weight: 800; color: #0f172a; margin-top: 2px;">מבוא למדעי המחשב (CS101) - כל חומרי ההוראה</h3>
              </div>
              <div style="font-size: 13px; font-weight: 600; color: #64748b; background: #ffffff; border: 1px solid #e2e8f0; padding: 6px 14px; border-radius: 8px;">
                🔍 חיפוש קבצים ומצגות...
              </div>
            </div>

            <!-- Topic Pills -->
            <div class="topic-pills-row">
              <span style="font-size: 12px; font-weight: 700; color: #94a3b8; margin-right: 4px;">נושאים:</span>
              <div class="topic-pill">הכל 🌐</div>
              <div class="topic-pill">מידע וסילבוס 📋</div>
              <div class="topic-pill active">שבוע 1: רקורסיה ויעילות ✨</div>
              <div class="topic-pill">שבוע 2: סיבוכיות ו-Big O 📊</div>
              <div class="topic-pill">שבוע 3: עצים בינאריים 🌲</div>
            </div>

            <!-- File List for Topic -->
            <div class="files-list-table">
              <div class="file-row-card">
                <div style="display: flex; align-items: center; gap: 14px;">
                  <div class="file-badge-type" style="background: #fee2e2; color: #dc2626;">📑</div>
                  <div>
                    <div style="font-size: 15px; font-weight: 700; color: #0f172a;">
                      <bdi>מצגת 01 - רקורסיה ומגדלי האנוי</bdi> <span style="color: #64748b; font-size: 12px; font-weight: 600;">(PDF)</span>
                    </div>
                    <div style="font-size: 12px; color: #64748b; margin-top: 2px;">שקפי הרצאה מורחבים • עודכן השבוע</div>
                  </div>
                </div>
                <div style="display: flex; align-items: center; gap: 14px;">
                  <span style="font-size: 13px; font-weight: 700; color: #475569; background: #f1f5f9; padding: 4px 10px; border-radius: 6px;">3.77 MB</span>
                  <button class="file-download-btn">הורדה 📥</button>
                </div>
              </div>

              <div class="file-row-card">
                <div style="display: flex; align-items: center; gap: 14px;">
                  <div class="file-badge-type" style="background: #e0f2fe; color: #0284c7;">🐍</div>
                  <div>
                    <div style="font-size: 15px; font-weight: 700; color: #0f172a; font-family: 'JetBrains Mono', monospace;" dir="ltr">
                      recursion_starter_template.py
                    </div>
                    <div style="font-size: 12px; color: #64748b; margin-top: 2px;">שלד פייתון ותרגילי דוגמה למטלה 1</div>
                  </div>
                </div>
                <div style="display: flex; align-items: center; gap: 14px;">
                  <span style="font-size: 13px; font-weight: 700; color: #475569; background: #f1f5f9; padding: 4px 10px; border-radius: 6px;">24 KB</span>
                  <button class="file-download-btn">הורדה 📥</button>
                </div>
              </div>

              <div class="file-row-card">
                <div style="display: flex; align-items: center; gap: 14px;">
                  <div class="file-badge-type" style="background: #fef3c7; color: #d97706;">📄</div>
                  <div>
                    <div style="font-size: 15px; font-weight: 700; color: #0f172a;">
                      <bdi>הנחיות התקנת סביבת פיתוח פייתון</bdi> <span style="color: #64748b; font-size: 12px; font-weight: 600;">(PDF)</span>
                    </div>
                    <div style="font-size: 12px; color: #64748b; margin-top: 2px;">מדריך הגדרת VS Code ואינטרפרטר</div>
                  </div>
                </div>
                <div style="display: flex; align-items: center; gap: 14px;">
                  <span style="font-size: 13px; font-weight: 700; color: #475569; background: #f1f5f9; padding: 4px 10px; border-radius: 6px;">1.23 MB</span>
                  <button class="file-download-btn">הורדה 📥</button>
                </div>
              </div>

              <div class="file-row-card">
                <div style="display: flex; align-items: center; gap: 14px;">
                  <div class="file-badge-type" style="background: #f3e8ff; color: #7e22ce;">📦</div>
                  <div>
                    <div style="font-size: 15px; font-weight: 700; color: #0f172a;">
                      <bdi>תרגול 01 - פתרונות ושלדי קוד</bdi> <span style="color: #64748b; font-size: 12px; font-weight: 600;">(ZIP)</span>
                    </div>
                    <div style="font-size: 12px; color: #64748b; margin-top: 2px;">תרגילי חזרה למבחן ופתרונות בית ספר</div>
                  </div>
                </div>
                <div style="display: flex; align-items: center; gap: 14px;">
                  <span style="font-size: 13px; font-weight: 700; color: #475569; background: #f1f5f9; padding: 4px 10px; border-radius: 6px;">4.12 MB</span>
                  <button class="file-download-btn">הורדה 📥</button>
                </div>
              </div>

              <div class="file-row-card">
                <div style="display: flex; align-items: center; gap: 14px;">
                  <div class="file-badge-type" style="background: #fee2e2; color: #dc2626;">📑</div>
                  <div>
                    <div style="font-size: 15px; font-weight: 700; color: #0f172a;">
                      <bdi>מצגת 02 - סיבוכיות זמן וחסמים אסימפטוטיים</bdi> <span style="color: #64748b; font-size: 12px; font-weight: 600;">(PDF)</span>
                    </div>
                    <div style="font-size: 12px; color: #64748b; margin-top: 2px;">שקפי הרצאה שבוע 2 • פונקציות Big-O</div>
                  </div>
                </div>
                <div style="display: flex; align-items: center; gap: 14px;">
                  <span style="font-size: 13px; font-weight: 700; color: #475569; background: #f1f5f9; padding: 4px 10px; border-radius: 6px;">2.85 MB</span>
                  <button class="file-download-btn">הורדה 📥</button>
                </div>
              </div>

              <div class="file-row-card">
                <div style="display: flex; align-items: center; gap: 14px;">
                  <div class="file-badge-type" style="background: #ede9fe; color: #7c3aed;">💻</div>
                  <div>
                    <div style="font-size: 15px; font-weight: 700; color: #0f172a;">
                      <bdi>סילבוס תשפ"ו - מבוא למדעי המחשב</bdi> <span style="color: #64748b; font-size: 12px; font-weight: 600;">(PDF)</span>
                    </div>
                    <div style="font-size: 12px; color: #64748b; margin-top: 2px;">מבנה ציון, מועדי בחינות ושעות קבלה</div>
                  </div>
                </div>
                <div style="display: flex; align-items: center; gap: 14px;">
                  <span style="font-size: 13px; font-weight: 700; color: #475569; background: #f1f5f9; padding: 4px 10px; border-radius: 6px;">0.44 MB</span>
                  <button class="file-download-btn">הורדה 📥</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </body>
      </html>
    `,
  },

  // Slide 5: Themes & Quick Toolbar Popup
  {
    name: 'promo-5-productivity-themes',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          ${sharedCss}
          .themes-layout {
            position: relative;
            z-index: 10;
            flex: 1;
            display: grid;
            grid-template-columns: 1.35fr 0.85fr;
            gap: 24px;
            align-items: center;
          }
          .popup-wrapper {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 16px;
          }
          .popup-label {
            background: #ffffff;
            border: 1px solid #e2e8f0;
            padding: 8px 16px;
            border-radius: 999px;
            font-size: 13px;
            font-weight: 700;
            color: #475569;
            box-shadow: 0 4px 10px rgba(0,0,0,0.05);
            display: inline-flex;
            align-items: center;
            gap: 6px;
          }
          .popup-shadow {
            border-radius: 18px;
            box-shadow: 0 24px 48px -8px rgba(15, 23, 42, 0.22),
                        0 0 0 1px rgba(0, 0, 0, 0.08);
            overflow: hidden;
            background: #fdfaf5;
          }
          .popup-shadow img {
            display: block;
            max-width: 380px;
            height: auto;
            image-rendering: -webkit-optimize-contrast;
          }
        </style>
      </head>
      <body>
        <div class="slide-container">
          <div class="header-zone">
            <div>
              <div class="brand-pill">
                <img src="${logoData}" alt="Noodle logo">
                <span>Everyday Productivity & Customization</span>
              </div>
              <h1 class="slide-title">Tailored to <span class="highlight">Your Workflow</span></h1>
              <p class="slide-subtitle">Dark mode for late-night study sessions, quick 1-click toolbar popup, and full bilingual Hebrew & English support.</p>
            </div>
            <div class="pill-group">
              <div class="feature-tag">🌙 Midnight Dark Mode</div>
              <div class="feature-tag">⚡ 1-Click Browser Popup</div>
              <div class="feature-tag">🌐 Hebrew & English</div>
            </div>
          </div>

          <div class="themes-layout">
            <!-- Dark Mode Dashboard -->
            <div class="browser-frame" style="height: 100%;">
              <div class="browser-topbar" style="background: #1e293b; border-color: #334155;">
                <div class="traffic-lights">
                  <span class="traffic-light tl-red"></span>
                  <span class="traffic-light tl-yellow"></span>
                  <span class="traffic-light tl-green"></span>
                </div>
                <div class="browser-address" style="background: #0f172a; border-color: #334155; color: #94a3b8;">
                  <span>🌙 Midnight Dark Theme</span>
                </div>
              </div>
              <div class="browser-content" style="background: #0f172a;">
                <img src="${dashDarkData}" alt="Dark Mode Dashboard Preview" style="width: 100%; height: auto; transform: scale(0.97); transform-origin: top center; image-rendering: -webkit-optimize-contrast;">
              </div>
            </div>

            <!-- Toolbar Popup Showcase -->
            <div class="popup-wrapper">
              <div class="popup-label">
                <span>📌 Instant Browser Extension Popup</span>
              </div>
              <div class="popup-shadow">
                <img src="${popupData}" alt="Toolbar Popup Preview">
              </div>
              <div style="font-size: 13px; font-weight: 600; color: #64748b; text-align: center; max-width: 320px;">
                Check upcoming tasks with zero tab switching right from your browser toolbar!
              </div>
            </div>
          </div>
        </div>
      </body>
      </html>
    `,
  },
];

// Marquee Banner: 1400x560 (No TAU specification)
const marqueeBanner = {
  name: 'promo-marquee-banner',
  width: 1400,
  height: 560,
  html: `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        ${sharedCss}
        .banner-container {
          width: 1400px;
          height: 560px;
          display: grid;
          grid-template-columns: 1.15fr 1fr;
          padding: 50px 70px;
          background: radial-gradient(circle at 15% 20%, rgba(245, 158, 11, 0.18) 0%, transparent 50%),
                      radial-gradient(circle at 85% 85%, rgba(99, 102, 241, 0.16) 0%, transparent 45%),
                      #fdfaf5;
          align-items: center;
          position: relative;
          overflow: hidden;
        }
        .left-col {
          display: flex;
          flex-direction: column;
          gap: 16px;
          z-index: 10;
        }
        .badge-bar {
          display: flex;
          gap: 10px;
          margin-top: 10px;
        }
        .right-col {
          position: relative;
          z-index: 10;
          display: flex;
          justify-content: center;
          align-items: center;
        }
        .mockup-3d {
          width: 600px;
          height: 380px;
          border-radius: 16px;
          overflow: hidden;
          box-shadow: 0 30px 60px -12px rgba(15, 23, 42, 0.28),
                      0 0 0 1px rgba(0,0,0,0.06);
          border: 1px solid rgba(255, 255, 255, 0.8);
          transform: perspective(1000px) rotateY(-8deg) rotateX(4deg);
        }
        .mockup-3d img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
          image-rendering: -webkit-optimize-contrast;
        }
      </style>
    </head>
    <body>
      <div class="banner-container">
        <div class="left-col">
          <div class="brand-pill" style="align-self: flex-start;">
            <img src="${logoData}" alt="Noodle logo">
            <span>Smart Moodle Companion</span>
          </div>
          <h1 style="font-size: 52px; font-weight: 800; color: #0f172a; line-height: 1.08; letter-spacing: -1.2px;">
            Upgrade Your <br><span class="highlight">Study Life</span>
          </h1>
          <p style="font-size: 18px; color: #64748b; font-weight: 500; line-height: 1.45; max-width: 520px;">
            The fast, private, and delightful frontend for university students. Deadlines, Zoom classes, and course files in one seamless interface.
          </p>
          <div class="badge-bar">
            <div class="feature-tag"><span class="dot"></span>100% Client-Only</div>
            <div class="feature-tag">⚡ Instant Sync</div>
            <div class="feature-tag">🎥 Zoom Hub</div>
            <div class="feature-tag">🌙 Dark Mode</div>
          </div>
        </div>

        <div class="right-col">
          <div class="mockup-3d">
            <img src="${dashData}" alt="Dashboard Mockup">
          </div>
          
          <div style="position: absolute; bottom: 8px; right: 18px; display: flex; flex-direction: column; align-items: center; z-index: 25;">
            <div class="speech-bubble" style="margin-bottom: 6px;">
              Moodle, but actually good! 🍜
            </div>
            <img src="${logoData}" style="width: 130px; height: 130px; object-fit: contain; filter: drop-shadow(0 12px 20px rgba(224, 138, 60, 0.3));" alt="Mascot">
          </div>
        </div>
      </div>
    </body>
    </html>
  `,
};

// Small Promo Tile: 440x280 (No TAU specification)
const smallTile = {
  name: 'promo-small-tile',
  width: 440,
  height: 280,
  html: `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        ${sharedCss}
        .tile-container {
          width: 440px;
          height: 280px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          padding: 24px 28px;
          background: radial-gradient(circle at 90% 15%, rgba(245, 158, 11, 0.22) 0%, transparent 50%),
                      radial-gradient(circle at 10% 90%, rgba(99, 102, 241, 0.16) 0%, transparent 45%),
                      #fdfaf5;
          position: relative;
          overflow: hidden;
        }
      </style>
    </head>
    <body>
      <div class="tile-container">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; z-index: 10;">
          <div>
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
              <span style="font-size: 32px; font-weight: 800; color: #0f172a; letter-spacing: -0.5px;">Noodle</span>
            </div>
            <div style="font-size: 15px; font-weight: 700; color: #ea580c;">Smart Study Companion</div>
          </div>
          <div style="width: 76px; height: 76px; overflow: hidden; border-radius: 50%; background: #ffffff; border: 2px solid #fed7aa; box-shadow: 0 6px 14px rgba(224, 138, 60, 0.25); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
            <img src="${logoData}" style="width: 130px; height: 130px; object-fit: contain; transform: translateY(14px);" alt="Logo">
          </div>
        </div>

        <div style="z-index: 10; display: flex; flex-direction: column; gap: 8px; margin-top: 4px;">
          <div style="display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: #334155;">
            <span style="color: #10b981; font-weight: 800;">✓</span> Real-Time Deadlines & Countdowns
          </div>
          <div style="display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: #334155;">
            <span style="color: #2563eb; font-weight: 800;">✓</span> 1-Click Live Zoom Lectures
          </div>
          <div style="display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: #334155;">
            <span style="color: #8b5cf6; font-weight: 800;">✓</span> 100% Private & Client-Only
          </div>
        </div>

        <div style="z-index: 10; display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #e2e8f0; padding-top: 10px;">
          <span style="font-size: 11px; font-weight: 600; color: #64748b;">Free & Open Source</span>
          <span style="font-size: 11px; font-weight: 700; color: #c2410c;">Modern Moodle Client</span>
        </div>
      </div>
    </body>
    </html>
  `,
};

async function main() {
  console.log('Starting High-Resolution Promo Asset Generation with Playwright...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    deviceScaleFactor: 2, // High-DPI / Retina sharpness
  });
  const page = await context.newPage();

  // 1. Generate 5 Carousel Slides
  for (const slide of slides) {
    console.log(`Generating ${slide.name}.png (1280x800)...`);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.setContent(slide.html, { waitUntil: 'networkidle' });
    // Wait for fonts to fully resolve
    await page.waitForFunction(() => document.fonts.ready);
    await page.waitForTimeout(400);

    const outPath = path.join(promoDir, `${slide.name}.png`);
    await page.screenshot({ path: outPath, type: 'png' });
    console.log(`✓ Saved ${outPath}`);
  }

  // 2. Generate Marquee Banner (1400x560)
  console.log(`Generating ${marqueeBanner.name}.png (1400x560)...`);
  await page.setViewportSize({ width: marqueeBanner.width, height: marqueeBanner.height });
  await page.setContent(marqueeBanner.html, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.fonts.ready);
  await page.waitForTimeout(400);
  const marqueeOut = path.join(promoDir, `${marqueeBanner.name}.png`);
  await page.screenshot({ path: marqueeOut, type: 'png' });
  console.log(`✓ Saved ${marqueeOut}`);

  // 3. Generate Small Tile (440x280)
  console.log(`Generating ${smallTile.name}.png (440x280)...`);
  await page.setViewportSize({ width: smallTile.width, height: smallTile.height });
  await page.setContent(smallTile.html, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.fonts.ready);
  await page.waitForTimeout(400);
  const tileOut = path.join(promoDir, `${smallTile.name}.png`);
  await page.screenshot({ path: tileOut, type: 'png' });
  console.log(`✓ Saved ${tileOut}`);

  await browser.close();
  console.log('All promotional assets generated successfully!');
}

main().catch(err => {
  console.error('Error generating promo assets:', err);
  process.exit(1);
});
