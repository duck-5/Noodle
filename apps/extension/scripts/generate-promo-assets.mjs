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
const dashCoffeeData = getBase64Image(path.join(screenshotsDir, 'dashboard-coffee-theme.png'));
const dashDarkData = getBase64Image(path.join(screenshotsDir, 'main-dashboard-dark.png'));
const assignsData = getBase64Image(path.join(screenshotsDir, 'assignments-page-expanded.png'));
const courseDetailData = getBase64Image(path.join(screenshotsDir, 'course-9999-detail.png'));
const modalData = getBase64Image(path.join(screenshotsDir, 'dashboard-manage-modal.png'));
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
                radial-gradient(circle at 10% 90%, rgba(224, 122, 95, 0.12) 0%, transparent 40%),
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
  // Slide 1: Hero Overview - The Modern Study Cockpit
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
            transform: scale(0.96);
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
                <span>The Modern Study Cockpit</span>
              </div>
              <h1 class="slide-title">Meet <span class="highlight">Noodle</span>: Study Smarter</h1>
              <p class="slide-subtitle">A distraction-free Moodle client featuring an urgent deadline spotlight, live Zoom detection, and instant background sync.</p>
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
                <img src="${dashData}" alt="Cockpit Dashboard Preview">
              </div>
            </div>
          </div>

          <!-- Callout 1 -->
          <div class="badge-callout" style="bottom: 45px; left: 40px;">
            <div class="badge-icon-box" style="background: #ecfdf5; color: #059669;">🎯</div>
            <div>
              <div class="badge-text-title">Urgent Deadline Spotlight</div>
              <div class="badge-text-sub">Next due assignment with topic files & attachments</div>
            </div>
          </div>

          <!-- Callout 2 -->
          <div class="badge-callout" style="top: 140px; right: 40px;">
            <div class="badge-icon-box" style="background: #eff6ff; color: #2563eb;">🎥</div>
            <div>
              <div class="badge-text-title">Live Zoom Detection</div>
              <div class="badge-text-sub">1-click join banner when your lecture is live</div>
            </div>
          </div>
        </div>
      </body>
      </html>
    `,
  },

  // Slide 2: Dedicated Assignments Hub
  {
    name: 'promo-2-deadlines-grades',
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
            transform: scale(0.98);
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
                <span>Dedicated Assignments Hub</span>
              </div>
              <h1 class="slide-title">All Assignments & Files in <span class="highlight">One View</span></h1>
              <p class="slide-subtitle">Filter by pending, past, or completed. Search instantly and access attached assignment prompts and weekly topic files directly from the drawer.</p>
            </div>
            <div class="pill-group">
              <div class="feature-tag">🔍 Instant Search</div>
              <div class="feature-tag">📂 Topic Files in Drawer</div>
              <div class="feature-tag">⏰ Live Countdowns</div>
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
                <span>🔒 chrome-extension://noodle/options.html#assignments</span>
              </div>
            </div>
            <div class="browser-content">
              <div class="dashboard-scaled-container">
                <img src="${assignsData}" alt="Assignments Page Preview">
              </div>
            </div>
          </div>

          <!-- Callout 1 -->
          <div class="badge-callout" style="bottom: 45px; left: 40px;">
            <div class="badge-icon-box" style="background: #fef3c7; color: #d97706;">📂</div>
            <div>
              <div class="badge-text-title">Smart Topic Files & Prompts</div>
              <div class="badge-text-sub">Slides, code templates & guidelines in one drawer</div>
            </div>
          </div>

          <!-- Callout 2 -->
          <div class="badge-callout" style="top: 140px; right: 40px;">
            <div class="badge-icon-box" style="background: #fdf2f8; color: #db2777;">⚡</div>
            <div>
              <div class="badge-text-title">One-Click Moodle Submission</div>
              <div class="badge-text-sub">Direct link to dropzone with zero extra clicks</div>
            </div>
          </div>
        </div>
      </body>
      </html>
    `,
  },

  // Slide 3: Course Materials & Live Lecture Hub
  {
    name: 'promo-3-zoom-hub',
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
            transform: scale(0.96) translateY(-460px);
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
                <span>Course Materials & Lecture Hub</span>
              </div>
              <h1 class="slide-title">Course Files & Zoom in <span class="highlight">One Click</span></h1>
              <p class="slide-subtitle">Browse weekly topics, download course slides and code skeletons with exact file sizes, and join live lectures without hunting for links.</p>
            </div>
            <div class="pill-group">
              <div class="feature-tag">🎥 Auto-Discovered Zoom</div>
              <div class="feature-tag">📥 1-Click Downloads</div>
              <div class="feature-tag">🗂️ Weekly Topic Pills</div>
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
                <span>🔒 chrome-extension://noodle/options.html#course/9999</span>
              </div>
            </div>
            <div class="browser-content">
              <div class="dashboard-scaled-container">
                <img src="${courseDetailData}" alt="Course Detail Preview">
              </div>
            </div>
          </div>

          <!-- Callout 1 -->
          <div class="badge-callout" style="bottom: 45px; left: 40px;">
            <div class="badge-icon-box" style="background: #eff6ff; color: #2563eb;">🎥</div>
            <div>
              <div class="badge-text-title">Live Meeting Detection</div>
              <div class="badge-text-sub">Active Zoom lecture highlighted with direct join button</div>
            </div>
          </div>

          <!-- Callout 2 -->
          <div class="badge-callout" style="top: 140px; right: 40px;">
            <div class="badge-icon-box" style="background: #f0fdf4; color: #16a34a;">📦</div>
            <div>
              <div class="badge-text-title">Exact File Sizes & Downloads</div>
              <div class="badge-text-sub">Download slides, syllabi and zip archives directly</div>
            </div>
          </div>
        </div>
      </body>
      </html>
    `,
  },

  // Slide 4: Personalized Course Management & Colors
  {
    name: 'promo-4-course-files',
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
            align-items: center;
            background: #fdfaf5;
          }
          .dashboard-scaled-container img {
            width: 100%;
            height: auto;
            transform: scale(1.08);
            transform-origin: center center;
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
                <span>Personalized Course Management</span>
              </div>
              <h1 class="slide-title">Organize Your Semester, <span class="highlight">Your Way</span></h1>
              <p class="slide-subtitle">Track only active courses, set custom Hebrew and English nicknames, and customize color tags for total visual clarity.</p>
            </div>
            <div class="pill-group">
              <div class="feature-tag">🎨 Custom Color Tags</div>
              <div class="feature-tag">✏️ Custom Nicknames</div>
              <div class="feature-tag">🎯 Semester Focus</div>
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
                <span>🔒 chrome-extension://noodle/options.html#manage-courses</span>
              </div>
            </div>
            <div class="browser-content">
              <div class="dashboard-scaled-container">
                <img src="${modalData}" alt="Manage Courses Modal Preview">
              </div>
            </div>
          </div>

          <!-- Callout 1 -->
          <div class="badge-callout" style="bottom: 45px; left: 40px;">
            <div class="badge-icon-box" style="background: #fff7ed; color: #ea580c;">🎨</div>
            <div>
              <div class="badge-text-title">Pastel Color Coding</div>
              <div class="badge-text-sub">Identify courses across all views with warm custom palettes</div>
            </div>
          </div>

          <!-- Callout 2 -->
          <div class="badge-callout" style="top: 140px; right: 40px;">
            <div class="badge-icon-box" style="background: #fdf8f6; color: #a0613e;">✏️</div>
            <div>
              <div class="badge-text-title">Human-Readable Names</div>
              <div class="badge-text-sub">Replace cryptic course IDs with memorable names</div>
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
            grid-template-columns: 1.32fr 0.88fr;
            gap: 24px;
            align-items: center;
          }
          .coffee-frame {
            height: 100%;
            background: #231b17;
            border-radius: 14px;
            border: 1px solid #3d2f28;
            box-shadow: 0 20px 40px -10px rgba(15, 23, 42, 0.28);
            display: flex;
            flex-direction: column;
            overflow: hidden;
          }
          .coffee-topbar {
            height: 36px;
            background: #1b1512;
            border-bottom: 1px solid #332720;
            display: flex;
            align-items: center;
            padding: 0 14px;
            gap: 12px;
          }
          .coffee-address {
            flex: 1;
            max-width: 440px;
            height: 24px;
            background: #29201a;
            border: 1px solid #3d2f28;
            border-radius: 6px;
            display: flex;
            align-items: center;
            padding: 0 10px;
            font-size: 11px;
            font-weight: 500;
            color: #d6c7b2;
            gap: 6px;
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
              <h1 class="slide-title">Built for Late Nights: <span class="highlight">Coffee & Dark</span> Themes</h1>
              <p class="slide-subtitle">Switch between Cozy Coffee, Midnight Dark, and Clean Noodle themes. Check deadlines instantly with the browser toolbar popup.</p>
            </div>
            <div class="pill-group">
              <div class="feature-tag">☕ Cozy Coffee Theme</div>
              <div class="feature-tag">🌙 Midnight Dark Mode</div>
              <div class="feature-tag">⚡ 1-Click Toolbar Popup</div>
            </div>
          </div>

          <div class="themes-layout">
            <!-- Coffee Theme Dashboard -->
            <div class="coffee-frame">
              <div class="coffee-topbar">
                <div class="traffic-lights">
                  <span class="traffic-light tl-red"></span>
                  <span class="traffic-light tl-yellow"></span>
                  <span class="traffic-light tl-green"></span>
                </div>
                <div class="coffee-address">
                  <span>☕ Cozy Coffee Theme • Relaxing Espresso Aesthetic</span>
                </div>
              </div>
              <div class="browser-content" style="background: #1f1814;">
                <img src="${dashCoffeeData}" alt="Coffee Theme Dashboard Preview" style="width: 100%; height: auto; transform: scale(0.98); transform-origin: top center; image-rendering: -webkit-optimize-contrast;">
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
              <div style="font-size: 13px; font-weight: 600; color: #64748b; text-align: center; max-width: 320px; line-height: 1.4;">
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
                      radial-gradient(circle at 85% 85%, rgba(224, 122, 95, 0.14) 0%, transparent 45%),
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
            The fast, private, and delightful frontend for university students. Deadlines, Zoom classes, and course files in one seamless cockpit.
          </p>
          <div class="badge-bar">
            <div class="feature-tag"><span class="dot"></span>100% Client-Only</div>
            <div class="feature-tag">⚡ Instant Sync</div>
            <div class="feature-tag">🎥 Zoom Hub</div>
            <div class="feature-tag">☕ Coffee Theme</div>
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

// Small Promo Tile: 440x280 (No TAU specification, perfectly framed avatar Option B)
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
                      radial-gradient(circle at 10% 90%, rgba(224, 122, 95, 0.14) 0%, transparent 45%),
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
          <div style="width: 76px; height: 76px; overflow: hidden; border-radius: 50%; background: #ffffff; border: 2.5px solid #fed7aa; box-shadow: 0 6px 16px rgba(224, 138, 60, 0.25); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
            <img src="${logoData}" style="width: 105px; height: 105px; object-fit: cover; transform: translateY(-25px) scale(1.35);" alt="Logo">
          </div>
        </div>

        <div style="z-index: 10; display: flex; flex-direction: column; gap: 8px; margin-top: 4px;">
          <div style="display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: #334155;">
            <span style="color: #10b981; font-weight: 800;">✓</span> Real-Time Deadlines & Countdowns
          </div>
          <div style="display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: #334155;">
            <span style="color: #2563eb; font-weight: 800;">✓</span> 1-Click Live Zoom Lectures
          </div>
          <div style="display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: #8b5cf6;">
            <span style="color: #a0613e; font-weight: 800;">✓</span> 100% Private & Client-Only
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
