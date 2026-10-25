# Changelog

All notable changes to the Noodle project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]
### Added
- **Warm Pastel Course Color Palette & Fallback (`apps/extension/src/options/App.tsx`, `Popup.tsx`, `e2e/sync-devtools.spec.ts`, `generate-promo-assets.mjs`)**:
  - Replaced harsh green (`#10b981`) and indigo purple (`#6366f1`) course color presets with attractive, happier pastels: warm coral/terracotta pastel orange (`#e07a5f`) for Course 9999 (CS101) and warm caramel/mocha pastel brown (`#a0613e`) for Course 9998 (DS201).
  - Updated the default course color fallback in `App.tsx` and `Popup.tsx` from `#6366f1` to `#e07a5f`.
  - Harmonized ambient background radial gradients in promotional slide graphics from indigo to soft pastel terracotta (`rgba(224, 122, 95, 0.12)`).
- **Expanded Realistic Mock Assignments for Demos & Screenshots (`apps/extension/e2e/sync-devtools.spec.ts`)**:
  - Expanded mock assignments data from 4 to 8 realistic, multi-state assignments across both courses with varied due dates (24h urgent spotlight, 3-day, 4-day, 6-day, 8-day, 12-day upcoming deadlines, and completed/graded items).
  - Linked corresponding modules and resources in `core_course_get_contents` for all new assignments, enriching the Upcoming Tasks Queue, dedicated Assignments Feed, Course Detail Views, and Toolbar Popup.
- **Refreshed 2× Retina Promotional Store Graphics (`apps/extension/promo/`, `scripts/generate-promo-assets.mjs`)**:
  - Re-rendered all 7 promotional assets at 2× Retina resolution reflecting recent UI updates, expandable hero card, inline file previews, "Open in Moodle" navigation button, warm pastel course tags, and rich upcoming tasks queue.
- **Direct "Open in Moodle ↗" Course Button in Course Detail View (`apps/extension/src/options/App.tsx`)**:
  - Added a direct `"פתח במודל ↗"` / `"Open in Moodle ↗"` button (`data-moodle-link="true"`) in the header of `CourseDetailView` to open the course's Moodle page directly from the course screen.
- **"Signing in to Moodle..." Status Indicator on Moodle Links (`apps/extension/src/options/App.tsx`, `Popup.tsx`, `i18n.ts`)**:
  - Added an immediate `"מתחבר למודל..."` / `"Signing in to Moodle..."` status toast/banner with a spinning indicator whenever any Moodle link is clicked, keeping the user informed while SSO session verification (`loginTauSsoOnBackground`) completes before opening the new tab.
- **Interactive Split-Pane Calendar View in Assignments Tab (`apps/extension/src/options/App.tsx`, `App.css`, `i18n.ts`, `TC-ASN-12`)**:
  - Added a "📅 תצוגת לוח שנה" / "📅 Calendar View" toggle button in the Assignments tab filter bar.
  - Opening the calendar shrinks the assignments feed column into a responsive split-pane workspace (`grid-template-columns: minmax(340px, 1.05fr) minmax(420px, 0.95fr)`) and displays a sticky monthly calendar grid alongside the assignments list.
  - Displays color-coded assignment pills on their due dates with month navigation (`◀`, `היום` / `Today`, `▶`) and completion status styling.
  - Clicking any assignment pill in the calendar automatically ensures its status filter (To Do / Past / Completed / Hidden) is enabled, expands the assignment card in the feed, and smoothly scrolls it into view.
- **Extension Toolbar Action Badge (`apps/extension/src/background/serviceWorker.ts`, `TC-BG-05`)**:
  - Implemented `updateActionBadge()` to display the live count of active, uncompleted, non-hidden assignments directly on the browser extension toolbar icon.
  - Dynamically colors the badge background based on the most urgent upcoming deadline: red (`#ef4444`) when $\le 24$ hours remain, amber (`#f59e0b`) when $\le 72$ hours remain, and indigo (`#6366f1`) otherwise.
  - Automatically updates on background sync, storage changes, startup, and clears upon logout.
- **Actionable Toolbar Popup with Live Zoom Banner & Quick Actions (`apps/extension/src/popup/Popup.tsx`, `Popup.css`, `TC-EXT-01`)**:
  - Added a pulsing "פעיל כעת" / "Live Now" Zoom banner at the top of the popup when a visible course Zoom session is currently active, with a 1-click "הצטרף" / "Join" button.
  - Added a 1-click Mark Done (`✓`) button on each assignment card in the popup, immediately updating local storage, refreshing the toolbar badge, and triggering a silent Google Tasks sync if enabled.
  - Made popup assignment cards clickable to open the assignment directly in Moodle.
- **Laboratory Course Bulk Assignment Hiding Suggestion (`apps/extension/src/options/App.tsx`, `apps/mobile/src/app/courses.tsx`)**:

  - Added automatic detection for courses containing the Hebrew keyword `"מעבדה"` (laboratory) when adding them to tracking (in both the onboarding course selection and the "Manage Courses" configuration modal).
  - Prompts the user with a confirmation dialog offering to automatically hide all assignments for the lab course, preventing dashboard clutter from extensive catalogs of optional/unassigned lab experiments while allowing manual unhiding when needed.
- **Google Tasks Sync for Assignments Without Deadline Option (`packages/moodle-client/src/googleTasksSync.ts`, `apps/extension`, `apps/mobile`)**:
  - Added `syncWithoutDeadline` configuration setting across the shared sync engine (`GoogleTasksSyncOptions`), extension settings (`DEFAULT_SETTINGS`, `ExtensionSettings`), and mobile settings (`performGoogleTasksSync`).
  - Default is **OFF** (`false`), preventing assignments lacking explicit due dates from cluttering Google Tasks.
  - When disabled, existing tasks in Google Tasks that lack deadlines are automatically cleaned up / deleted on synchronization.
  - Added setting switch and localized explanatory description ("סנכרון מטלות ללא תאריך יעד ל-Google Tasks") in Settings tab and mobile settings.
  - Added unit tests in `packages/moodle-client/__tests__/googleTasks.test.ts` covering both `syncWithoutDeadline: false` and `true`.
- **Elaborated About Tab & Account Section Credits (`apps/extension/src/options/App.tsx`, `apps/extension/src/options/App.css`, `apps/mobile/src/app/settings.tsx`, `i18n.ts`)**:
  - Added official GitHub repository (`https://github.com/duck-5/Noodle`) and GitHub Issues (`https://github.com/duck-5/Noodle/issues`) links in the Account card and About tab.
  - Added developer credits for **Yuval Mantin** and **Michael Kushnir**.
  - Added direct support and suggestions contact email: `noodle.d3v@gmail.com`.
  - Added Chrome Web Store review link (`https://chromewebstore.google.com/detail/noodle/nelflkccefbdpnaphjabcgkpakhdoope`).
  - Elaborated the About page with an interactive brand hero, quick action cards, and 3 collapsible accordion sections (`<details className="about-accordion">`) detailing Core Features, Pro Tips & Tricks, and Privacy & Security architecture.
- **Comprehensive 10-Step Interactive Landing & Onboarding Tour (v4 Redesign)**:
  - Completely redesigned and expanded the extension onboarding tour into an immersive, 10-step guided cockpit walkthrough:
    1. **Step 0 (Cockpit Overview)**: Centered glassmorphic welcome card detailing Noodle's local-first architecture and zero-backend privacy.
    2. **Step 1 (Real-Time Sync Button)**: Highlights `.header-sync-btn` in the header, demonstrating direct Moodle sync and automated Google Tasks updates.
    3. **Step 2 (Next Task Spotlight)**: Docks to bottom viewport; highlights `.hero-spotlight-card` with live countdown, 1-click submission, assignment attachments, and topic section files.
    4. **Step 3 (Task Controls: Done & Hidden)**: Highlights `.hero-actions-row` & `.queue-card`, demonstrating 1-click completion (`✓`) and task hiding (`👁`) with dynamic removal from the active To-Do queue.
    5. **Step 4 (Manage Courses Modal)**: Automatically opens the "Manage Courses" modal (`isManageModalOpen: true`), highlights `.modal-content` aligned to the top viewport, and guides the user through setting custom nicknames, assigning colors, tracking checkboxes, and semester grouping.
    6. **Step 5 (Live Zoom & Link Filtering)**: Automatically closes the modal and expands the first course row (`expandedCourseId`), highlighting `.course-row-card`. Guides the user on using the eye icon (`👁`) to filter out recitations they don't attend, joining live sessions via the "Active Now" banner, and accessing hidden sessions.
    7. **Step 6 (Assignments Hub & Feed)**: Automatically switches to the `assignments` tab, highlighting `.filter-bar`. Explains fast global search, 4 status filters (To Do, Past, Completed, Hidden), and expandable materials drawers.
    8. **Step 7 (Grades & GPA Tracker)**: Automatically switches to the `grades` tab, highlighting `.stat-card`. Explains cumulative GPA estimation, grade distributions per course, and auto-calculated averages.
    9. **Step 8 (Settings & Google Tasks Sync)**: Automatically switches to the `settings` tab, highlighting `.google-tasks-section`. Covers two-way sync with Google Tasks and Calendar, theme options, and custom urgency alerts.
    10. **Step 9 (Ready to Roll & About)**: Automatically switches to the `about` tab, highlighting `.tab-about`. Explains tour relaunching anytime, keyboard shortcuts (`[←] [→] [Esc]`), developer credits, and version details. Exiting cleanly returns user to the Dashboard (`setActiveTab('dashboard')`).
  - Added 10-segment segmented progress stepper with direct click-to-step navigation.
  - Added desktop keyboard navigation (`ArrowRight` / `ArrowLeft` adapted to RTL/LTR directionality, `Escape` to exit).
  - Added bottom viewport docking for interactive steps (`1–8`) so target UI elements remain visible with glowing outline pulses (`.tour-highlight`).
  - Added comprehensive multi-theme support across Slate Dark, Warm Noodle, and Dark Espresso Coffee themes.
  - Fully bilingual in Hebrew and English with dedicated translation keys in `i18n.ts`.
- **Direct Zoom LTI REST Discovery & Session Extraction (`packages/moodle-client/src/syncEngine.ts`, `zoomScraper.ts`)**:
  - Un-gated Zoom LTI session retrieval from the optional web scraping flag. Zoom sessions with direct join URLs, passcodes, and ISO timestamps are now retrieved directly via Moodle's REST endpoint `mod_lti_get_tool_launch_data` and Zoom LTI Pro JSON API without requiring HTML scraping or user credentials.
  - Made Zoom LTI configuration parsing (`parseAppConf`) resilient to strict JSON blocks and flexible key/value parameter orderings.
  - Automatically stripped forbidden browser headers (such as `User-Agent`) in `mfetch` during extension runtime to avoid browser console warnings.
- **Recurring Zoom Session Collapsing (`@tautracker/moodle-client`, `TC-ZM-06`)**:
  - Exported `collapseRecurringMeetings(meetings, referenceDate)` from `@tautracker/moodle-client`. Automatically condenses recurring weekly sessions of the same room/meetingNumber into a single entry representing the nearest upcoming meeting (or latest past meeting if all sessions concluded).
  - Added unit test suite `TC-ZM-06` covering recurring meeting collapsing, past-only session fallback, undated link preservation, and appConf parsing.
- **Uncluttered Zoom Panels, "Show Hidden" Toggle & Bulk Actions (`apps/extension/src/options/App.tsx`, `i18n.ts`)**:
  - Redesigned the Zoom links section in Dashboard course cards and `CourseDetailView` to render only user-selected (visible) meetings by default, eliminating visual clutter in courses with 10+ recitation/lecture groups.
  - Added a collapsible "הצג פגישות מוסתרות" / "Show hidden meetings" toggle button displaying hidden meetings in a distinct muted container with single-click unhide actions.
  - Added single-click "הצג הכל" (Show all) and "הסתר הכל" (Hide all) bulk action buttons per course, allowing students to configure 10+ group instances in two clicks.
  - Fixed a critical scoping bug in `handleToggleMeetingInterest` where toggling a meeting in one course wiped visibility across all other courses when `interestedMeetings` was uninitialized.
- **Comprehensive Multi-Modal Zoom Detection (`packages/moodle-client/src/syncEngine.ts`, `zoomScraper.ts`)**:
  - Added automatic Zoom meeting extraction for standard Moodle URL modules (`modname === 'url'`), direct Zoom plugins (`modname === 'zoom'`), Hebrew Zoom titles ("קישור לזום", "מפגש מקוון", "שיעור זום", "הרצאה מקוונת"), embedded HTML links in label modules (`modname === 'label'`), page modules, and section summaries.
  - Added automatic URL normalization to the TAU tenant (`https://tau-ac-il.zoom.us/j/...`) and automatic extraction of `meetingNumber` and passcode parameters (`pwd`).
  - Added automated unit and integration tests (`TC-ZM-05`) verifying extraction across all modalities and course-level deduplication.
- **Mock Course Sandbox Generator (`apps/extension/src/options/App.tsx`, `i18n.ts`)**:
  - Added "➕ הוסף קורס לדוגמה" (Add Mock Course) button under Settings to inject Course 9999 into local storage with active live Zoom, upcoming meetings, files, and multi-state assignments (with attachments, submissions, and no-deadline tasks) for instantaneous UI and feature testing.
- **Subject Files Integration in Assignments Drawer (`apps/extension/src/options/App.tsx`, `i18n.ts`)**:
  - Expanding an assignment card (in Assignments Feed, Course Detail View, or Course row) resolves and displays subject files (`קבצי הנושא`) matching the assignment's course ID and section topic alongside assignment attachments and submitted files.
- **Course-Level "Hide All" Assignments Toggle (`apps/extension/src/options/App.tsx`, `i18n.ts`)**:
  - Added a bulk "הסתר את כל המטלות" / "בטל הסתרת הכל" button in `CourseDetailView` allowing one-click hiding or unhiding of all assignments within a course.
- **Dual File Actions (Open & Download) (`apps/extension/src/options/App.tsx`, `App.css`)**:
  - Provided distinct actions for all course and assignment files: green "פתח ↗" link (`#10b981`) and a dedicated SVG "הורדה ↓" button with the HTML `download` attribute.
- **Noodle v4 Dashboard & UI Rehaul (Issues #14, #20)**:
  - Added dedicated full-page **Assignments Tab (`assignments`)** matching redesign specifications with search bar (`search_assignments_feed`), 4 filter checkboxes ("לביצוע", "עברו", "הושלמו", "מוסתרים"), course filter banner with clear button, compact/minimized default cards, smooth accordion drawer with attachment download/open buttons, submitted files, topic pill, and action buttons.
  - Streamlined sidebar navigation to 5 focused items: `dashboard`, `assignments`, `grades`, `settings`, and `about`, removing legacy separate `courses` and `files` tabs.
  - Cleaned up Dashboard home view by removing duplicate assignments calendar at the bottom, converting the Dashboard into a clean, focused cockpit (Hero Action Strip + Multi-active Zoom + Semester Progress + My Tracked Courses).
  - Wired Dashboard course row "מטלות" button to navigate directly to the Assignments tab pre-filtered to the selected course with a dismissible course filter banner.
  - Added Dark Noodle "Coffee" theme (`coffee`) featuring deep dark brown background (`#0f0a07`), rich card panels (`rgba(36, 22, 12, 0.92)`), terracotta and sage accents, and quick 3-way cycle button (`☕ / 🍜 / 🌙`) in header.
  - Added Hero Action Strip on Dashboard: tranquil "המטלה הקרובה" ("Next Task") spotlight card with attachment chips ("פתח ↗", SVG "הורדה ↓") and Upcoming To-Do Queue excluding completed and hidden tasks with smooth expandable drawers.
  - Added smooth accordion drawer for course rows in "My Tracked Courses", expanding to reveal active/visible Zoom meetings and next 5 course assignments without page transitions.
  - Added "Manage Courses" modal dialog on Dashboard with semester groupings (`groupAndSortCourses`), custom nicknames, color pickers, and tracking checkboxes.
  - Added pure SVG `DownloadIcon` replacing emoji icons on file action buttons throughout the extension.
  - Added E2E tests `TC-DASH-REHAUL-01` to `TC-DASH-REHAUL-04` and `TC-ASN-09` validating course row expansion, upcoming to-do queue exclusion logic, manage courses modal, Coffee theme styling, and course-specific assignment filtering.
- **Optional Web Scraping Toggle & Pure-API Default (`apps/extension/src/options/App.tsx`, `packages/moodle-client/src/moodleApi.ts`)**:
  - Made all HTML web scraping functionality optional and disabled by default (`scrapingEnabled: false`, `enableScraping: false`).
  - Added a dedicated bilingual switch (`#scraping-enabled-toggle`) in the Extension Settings page: "Moodle Web Scraping (Fallback)" / "סריקת אתר Moodle (Web Scraping)".
  - When disabled (default), the sync engine operates in high-speed pure API mode using official Moodle REST and AJAX endpoints with zero HTML scraping overhead.
  - Users can enable the toggle in Settings whenever they need fallback scraping for legacy archive modules, past unlisted deadlines, or Zoom LTI links.
- **Real-Time Streaming Sync Data (`packages/moodle-client/src/syncEngine.ts`, `apps/extension/src/background/serviceWorker.ts`, `App.tsx`)**:
  - Implemented `onPartialSync` streaming callback in `runSync`, emitting incremental `SYNC_PARTIAL` messages to the UI as assignments, files, and meetings are discovered.
  - The UI updates dynamically without having to wait for the entire multi-course synchronization process to terminate.
- **High-Resolution Promotional Assets Suite for v4 Redesign (`apps/extension/scripts/generate-promo-assets.mjs`)**:
  - Completely refreshed the store promotional graphics suite rendered at 2× Retina resolution (2560×1600 slides, 2800×1120 marquee, 880×560 small tile) tailored specifically to the v4 Cockpit UI redesign:
    - **Slide 1 (`promo-1-hero-overview.png`)**: Showcases the new Cockpit Dashboard featuring the Hero Action Strip ("המטלה הקרובה"), Upcoming To-Do queue ("תור משימות קרובות"), and active Live Zoom strip.
    - **Slide 2 (`promo-2-deadlines-grades.png`)**: Showcases the dedicated full-page Assignments Hub with instant search, 4 filter checkboxes ("לביצוע", "עברו", "הושלמו", "מוסתרים"), and expanded drawer featuring attached prompts and weekly topic files.
    - **Slide 3 (`promo-3-zoom-hub.png`)**: Showcases Course Materials & Lecture Hub with active Zoom detection, weekly topic pills, and direct file downloads with exact file size badges.
    - **Slide 4 (`promo-4-course-files.png`)**: Showcases the centered frosted-glass Course Management modal with custom course nicknames, semester tracking toggles, and custom color tags.
    - **Slide 5 (`promo-5-productivity-themes.png`)**: Showcases the new dark espresso Coffee Theme (`theme-coffee`) side-by-side with the high-DPI English Toolbar Popup.
    - **Marquee Banner (`promo-marquee-banner.png`)**: 3D tilted v4 Cockpit dashboard and mascot with student-friendly branding ("Smart Moodle Companion").
    - **Small Promo Tile (`promo-small-tile.png`)**: Centered circular avatar featuring the smiling mascot bowl, real-time deadlines, and 1-click zoom with zero university mentions.
- **High-Resolution Promotional Assets & Store Suite (`apps/extension/scripts/generate-promo-assets.mjs`)**:
  - Generated full Webstore graphic suite rendered at 2× Retina resolution (2560×1600 slides, 2800×1120 marquee, 880×560 tile) with font preloading and mockups for Hero Overview, Deadlines & Grades, Zoom Lecture Hub, Course Files Explorer, and Midnight Dark Theme + Toolbar Popup.
  - Enforced unofficial, student-friendly branding ("Smart Moodle Companion" / "Modern Moodle Client") without claiming official university affiliation.
- **Retina 2× DPI Automation Harness (`apps/extension/e2e/fixtures.ts`, `apps/extension/e2e/sync-devtools.spec.ts`)**:
  - Configured Playwright browser context with `deviceScaleFactor: 2` and 1440×900 viewport to capture crisp Retina extension screenshots (`main-dashboard.png`, `toolbar-popup.png`, `courses-tab-view.png`).
- **Live Extension E2E Test Suite with Real Credentials (`apps/extension/e2e/live-extension.spec.ts`, `TC-EXT-LIVE-01`)**:
  - Added an end-to-end Playwright test suite executing real SSO authentication and data synchronization against Tel Aviv University's live servers using `moodle_test_credentials.env`.
  - Verifies the scraping toggle defaults to OFF, tests pure API sync, toggles scraping ON, verifies storage persistence, executes scraping-enabled sync, resets to clean default, and captures visual screenshots.

### Changed
- **Expandable Hero Spotlight Card Hiding Files Until Expanded (`apps/extension/src/options/App.tsx`)**:
  - Updated the Dashboard Hero Spotlight ("Next Task" / `"המטלה הקרובה"`) card to collapse its assignment attachments, subject files (`קבצי הנושא`), and submitted files by default (`isHeroExpanded: false`), revealing them only when the user clicks to expand the card.
- **Subject, Assignment, and Submitted Files Ordered in a Vertical Column (`apps/extension/src/options/App.tsx`, `App.css`, `TC-DASH-REHAUL-07`)**:
  - Updated all file lists (assignment attachments, subject/topic files `קבצי הנושא`, and student submitted files) across the Dashboard Hero Spotlight, Upcoming To-Do Queue, Tracked Course Rows, Assignments Tab feed, and Course Detail View to render in a clean vertical column layout (`.files-column-group`, `.files-column-list`, `.file-column-item`) instead of wrapping horizontally.
- **Isolated Sync Countdown Timer & Memoized Assignment Derivation (`apps/extension/src/options/App.tsx`)**:
  - Extracted the 1-second sync countdown interval into a dedicated `<SyncCountdown />` leaf component and memoized `assignmentsList` with `useMemo`, preventing the entire 5,000+ line Options page from re-rendering every second.
- **Debounced Remote Settings Broadcast (`apps/extension/src/shared/storage.ts`)**:
  - Added a 600ms debounce (`scheduleSettingsSyncBroadcast`) to `SYNC_SETTINGS` background messages triggered by `setSettings` and `setTrackedCourseIds`, coalescing rapid UI edits (such as typing a course nickname or dragging a color picker) into a single Moodle Calendar API write.
- **Concurrent Google Tasks API Batching (`packages/moodle-client/src/googleTasksSync.ts`)**:
  - Upgraded Google Tasks synchronization and deletion loops from sequential `await fetch` calls to bounded concurrency (`CONCURRENCY_LIMIT = 5`), accelerating multi-task syncs by ~5×.
- **Minimal Extension Permissions (`apps/extension/src/manifest.json`)**:
  - Removed the unused `"webRequest"` permission from `manifest.json` to reduce extension privilege surface and speed up store review.
- **Coffee Theme Complete Redesign (`apps/extension/src/index.css`)**:
  - Completely rebuilt the coffee theme palette eliminating reddish, orange, and burgundy hues. Features pure dark espresso bean background (`#14100d`), rich roasted coffee cards (`rgba(29, 23, 19, 0.94)`), silky golden crema accents (`#c4996c`, `#d8b18a`), sage matcha highlights (`#8da882`), and warm froth typography (`#fbf6f0`).
- **Enlarged Brand Logo & Full-Bleed Extension Bar Icons (`apps/extension/public/icon-*.png`, `apps/extension/src/assets/logo.png`, `App.css`, `Popup.tsx`)**:
  - Tightly cropped the master noodle bowl artwork to eliminate excessive horizontal transparency padding (which previously caused the graphic to render at only ~40% coverage).
  - Regenerated all extension toolbar icons (`icon-16.png`, `icon-32.png`, `icon-48.png`, `icon-128.png`) with area-averaging anti-aliased resampling, boosting toolbar icon visual height coverage from 43% (6×7px) to 95–100% (12×16px / 22×30px) so the Noodle bowl is crisp, bold, and easily recognizable on the browser extension bar.
  - Sized the options sidebar logo to 108px (expanded) and 54px (collapsed), enlarged popup brand logo to 34px, unauthenticated popup logo to 84px, and optimized login onboarding logo dimensions.
- **Enhanced Next Task Spotlight Card (`apps/extension/src/options/App.tsx`, `App.css`)**:
  - Upgraded the Next Task hero panel with dynamic course-colored accent borders and surfaces (`rgba(courseColor, 0.08)`), section/topic academic metadata strip, course subject files (`קבצי הנושא`), submitted files preview, direct 1-click action buttons (Mark Done / Incomplete, Go to Course, Hide / Unhide), and squircle file chips.
- **Upcoming To-Do Queue Subject Files & Full Actions Suite (`apps/extension/src/options/App.tsx`, `App.css`)**:
  - Expanded upcoming queue items to resolve and display course subject files (`קבצי הנושא`) matching the task's course and topic section, submitted files, and the full action toolbar ("עבור לקורס", "סמן כבוצע / כלא הושלם", "הסתר / בטל הסתרה", and "הגש במודל ↗").
  - Increased `.queue-item-expanded.open` max-height to 800px to ensure multi-file task drawers never truncate content.
- **Squircle Buttons & Arrow-Only Download Action (`apps/extension/src/options/App.css`, `App.tsx`)**:
  - Replaced all file chips and action buttons with 8px squircle geometry. Simplified download action buttons across the entire app to strictly display the SVG arrow icon (`<DownloadIcon size={12} />`) with tooltip accessibility (`title` and `aria-label`).
- **Button Sizing & Hierarchy Polish (`apps/extension/src/options/App.css`, `App.tsx`)**:
  - Enforced `.btn-xs` sizing rules with specific selectors (`.secondary-btn.btn-xs`, `.primary-btn.btn-xs`) ensuring "Mark Done", "Unhide", and secondary actions remain compact and never overridden.
- **Assignment Action Button & Pill Hierarchy (`apps/extension/src/options/App.css`, `App.tsx`)**:
  - Converted the subject/topic pill (`.subject-pill`) into unframed metadata text to prevent button-like confusion.
  - Sized action buttons down to compact `.btn-xs` (`font-size: 0.75rem; padding: 0.25rem 0.55rem;`).
  - Styled "Open in Moodle" as a secondary subtle button while preserving "Go to Course" as the vibrant primary action.
- **Streamlined Dashboard Header & Sync Animation (`apps/extension/src/options/App.tsx`, `App.css`)**:
  - Removed the theme switcher from the dashboard header (retained in Settings) and added a minimal SVG sync icon with smooth spinning animation (`.spinning-sync-icon`) during sync.
- **Interactive Course Row Assignments (`apps/extension/src/options/App.tsx`)**:
  - Transformed the 5 next assignments inside expanded course rows into full interactive, expandable assignment cards.
- **Streamlined Dashboard Course Management & Unified Config Table (`apps/extension/src/options/App.tsx`)**:
  - Removed course manual reordering arrows (`▲/▼`) for a clean, deterministic list of tracked courses.
  - Enlarged Noodle bowl logo in sidebar to 48px for enhanced brand presence.
  - Refactored `CoursesConfigTable` into a unified shared component reused across both `CoursesTab` and Dashboard Manage Courses modal.
- **Accelerated Synchronization & Parallel Batching (`packages/moodle-client/src/syncEngine.ts`)**:
  - Parallelized grade items, submission statuses, and course contents fetching using concurrent batch processing (`batchPromises`), reducing sync times from minutes to ~15 seconds.
- **Archive Scanning Pruning (`packages/moodle-client/src/strategies/scraperStrategy.ts`, `restStrategy.ts`)**:
  - Pruned archive queries to 1 year back (`currentYear - 1`), stopping redundant scanning of 2-year-old subpaths.
  - Eliminated redundant multi-phase scraper fetching when courses are already discovered.

- **Google Tasks Hidden & Completed Tasks Deletion (`packages/moodle-client/src/googleTasksSync.ts`, `apps/extension/src/background/serviceWorker.ts`, `App.tsx`, `apps/mobile/src/services/googleTasks.ts`, `TC-GT-05`, `TC-GT-06`)**:
  - Ensured hidden tasks (`hiddenAssignments`, `isHidden: true`) are never synced to Google Tasks, and automatically issued `DELETE` requests for any matching tasks already existing in Google Tasks.
  - Implemented automatic Google Tasks deletion for any task marked as done (submitted in Moodle, manually completed in Noodle via `completedAssignments`, or completed inside Google Tasks with `status: 'completed'`), keeping the student's task list focused on actionable work.
  - Retained uncompleted override support (`uncompletedAssignments`) so tasks submitted in Moodle that the student marked as "To Do" remain active with `status: 'needsAction'`.
  - Added immediate silent background Google Tasks sync when toggling completed or hidden status in the Options page if Google Tasks integration is enabled.
  - Exported `GoogleTasksSyncOptions` from `@tautracker/moodle-client` accepting `hiddenAssignmentIds`, `completedAssignmentIds`, and `uncompletedAssignmentIds`.
- **Cross-Browser Build Directory Isolation (`apps/extension/vite.config.ts`, `apps/extension/package.json`, `scripts/test-build-parity.mjs`)**:
  - Separated build output directories: Chrome builds strictly into `apps/extension/dist/` with Manifest V3 `background.service_worker`, while Firefox builds compile to `apps/extension/dist-firefox/` with `background.scripts` and `browser_specific_settings.gecko`.
  - Prevented Firefox builds or automated parity test runs (`test:parity`) from overwriting Chrome's `dist/manifest.json` with unsupported Firefox syntax, permanently resolving Chrome's failure to register the service worker (`Could not establish connection. Receiving end does not exist`).
  - Updated extension package script `"build"` to explicitly include `--mode chrome`.
- **Service Worker Wake-up & "Receiving end does not exist" Connection Failures (`apps/extension/src/background/serviceWorker.ts`, `apps/extension/src/shared/messaging.ts`, `apps/extension/vite.config.ts`)**:
  - Registered `onMessage` event listener synchronously at the very top of `serviceWorker.ts` before alarms or any async initialization, ensuring Chrome's C++ Manifest V3 static analyzer detects the message receiver on cold-boot spin-up.
  - Implemented standard `sendResponse` callback support with synchronous `return true;` in `serviceWorker.ts` to keep the native message channel open until asynchronous promises resolve in Chromium.
  - Added native `chrome.runtime.sendMessage` direct execution path in `messaging.ts` with structured error returns (`{ success: false, error: ... }`) instead of `null` on retry exhaustion, allowing UI callers like `handleManualSync` to present actionable toast messages.
  - Protected `setupAlarm` with `try/catch` and removed unhandled top-level `setupAlarm()` invocation during service worker module evaluation, binding alarm initialization exclusively to `runtime.onInstalled` and `runtime.onStartup`.
  - Added `emptyOutDir: true` to Vite build configuration to purge stale files (`background.js`, obsolete assets) from `apps/extension/dist` on every compilation.
- **Zoom Meetings Failing to Appear on Courses (`packages/moodle-client/src/syncEngine.ts`, `apps/extension/src/options/App.tsx`)**:
  - Fixed Zoom meetings not being extracted from courses using standard Moodle URL activities (`modname === 'url'`), direct Zoom modules (`modname === 'zoom'`), or Hebrew activity names ("קישור לזום", "שיעור זום", "מפגש מקוון").
  - Fixed Zoom LTI modules disappearing when web scraping was disabled or failed by introducing an automatic fallback to the Moodle LTI activity launch URL (`/mod/lti/view.php?id={cmid}`).
  - Fixed `isMeetingVisible` and `isMarked` in `App.tsx` where an empty `interestedMeetings: []` default array was erroneously treated as filtering out all meetings, hiding active and visible Zoom meetings from the dashboard.
- **Course Detail View Grid & Overflow Containment (`apps/extension/src/options/App.css`)**:
  - Resolved an issue where assignments and sidebar cards slid horizontally out of frame on the course detail page. Added `minmax(0, 1.8fr) minmax(0, 1fr)` column bounds, `overflow-wrap: anywhere`, and responsive single-column collapse at 960px.
- **Tracked Courses Task Alignment & Hidden Task Leakage (`apps/extension/src/options/App.tsx`, `App.css`)**:
  - Corrected task alignment in "My Tracked Courses" from centered to start-aligned (`align-items: stretch; text-align: start;`). Excluded hidden assignments from the next 5 assignments list.
- **Hidden Zoom Link Filtering in "Active Now" Strip (`apps/extension/src/options/App.tsx`)**:
  - Filtered active meetings against user visibility preferences (`isMeetingVisible`) so hidden or uninterested Zoom meetings never appear in the top Active Now banner.
- **Deterministic Raw Sync Ordering & Stable Undated Assignments (`packages/moodle-client/src/syncEngine.ts`, `apps/extension/src/options/App.tsx`)**:
  - Preserved raw Moodle discovery sequence using `rawOrderMap` in `SyncEngine` across asynchronous batches, and added stable tie-breakers (`a.id - b.id`) across all UI sort functions so undated assignments do not shuffle positions upon sync.
- **Redundant Course Navigation CTA Removal (`apps/extension/src/options/App.tsx`)**:
  - Removed redundant "Go to Course" primary button from expanded task items inside My Tracked Courses, and updated the Assignments tab "Go to Course" button to a compact secondary button.
- **Upcoming To-Do Queue & Hero Spotlight for Undated Tasks (`apps/extension/src/options/App.tsx`)**:
  - Resolved an issue where assignments without explicit deadlines were excluded from the upcoming to-do queue and hero task computation, falsely displaying "All completed! 🎉". Tasks are now partitioned (future -> undated -> overdue) to ensure all pending tasks remain visible.
- **Hero Card In-Place Expansion (`apps/extension/src/options/App.tsx`)**:
  - Prevented automatic navigation to the assignments tab when clicking the Hero spotlight card, maintaining the user's dashboard context and expanding/collapsing details inline.
- **Zoom Meeting Unhiding in Course Rows (`apps/extension/src/options/App.tsx`)**:
  - Rendered all Zoom meetings in course row accordions with eye toggle icons (`EyeIcon` / `EyeOffIcon`), allowing users to easily unhide previously hidden meetings.
  - Added "הצג את כל המפגשים" toggle button in `CourseDetailView` to review and unhide hidden meetings.
- **Accurate Manual Completion Status Tag (`apps/extension/src/options/App.tsx`, `i18n.ts`)**:
  - Replaced misleading "הוגש" (submitted) badge on manually marked-done assignments with "סומן כהושלם" (`marked_as_done`).
- **Course Detail View Localization & UI Polish (`apps/extension/src/options/App.tsx`)**:
  - Fixed Hebrew/English localization mixups in `CourseDetailView` by translating raw Moodle status strings into Hebrew (`הוגש`, `טרם הוגש`, `הוקצה`).
  - Removed unstyled, non-functional placeholder button in `CourseDetailView` Zoom empty state.
- **White Assignment Title in Next Assignment Banner (`apps/extension/src/options/App.css`, `apps/extension/src/index.css`)**:
  - Overrode hardcoded `color: white;` in `.next-assign-title` with `var(--text-primary)` (`#1e293b`), ensuring high-contrast dark text on the warm cream noodle theme.
- **Ambiguous Hebrew Singular Day Badge Format (`apps/extension/src/shared/dateUtils.ts`)**:
  - Corrected `diffDays === 1` formatting from bare `'יום'` or awkward `'1 ימים'` to clear and grammatically natural `'יום 1'`.
- **Suppressed Notifications for Assignments with No Deadline (`apps/extension/src/background/serviceWorker.ts`, `TC-BG-02`)**:
  - Filtered assignments in `checkAndNotify` so that only assignments with an active, non-null deadline and unsubmitted status produce notifications. Assignments with no deadline or already submitted no longer trigger new assignment discovery notifications.
- **Moodle Mobile Service Token Disambiguation (`packages/moodle-client/src/strategies/scraperStrategy.ts`, `apps/extension/src/background/serviceWorker.ts`, `apps/mobile/src/services/auth.ts`)**:
  - Fixed token scraping from `/user/managetoken.php` inadvertently selecting `Moodle Mobile additional features service` instead of the primary `Moodle mobile web service`. The additional features token lacked permissions for `core_calendar_*` and `core_webservice_get_site_info`, triggering `accessexception` errors. Regex matching now strictly prioritizes `Moodle mobile web service` / `moodle_mobile_app`.
- **Calendar Settings Sync Resiliency (`packages/moodle-client/src/strategies/restStrategy.ts`)**:
  - Added HTML entity decoding (`&quot;`, `&amp;`, `&#39;`, `&lt;`, `&gt;`) and safe JSON parsing in `loadNoodleSettings()` to protect against Moodle formatting and filter wrappers in calendar event descriptions.
- **Silent Sync Failure & SW Wakeup Port Closure (`apps/extension/src/shared/messaging.ts`, `apps/extension/vite.config.ts`)**:
  - Upgraded `sendMessageToBackground` from a fragile single 500ms delay to progressive backoff across 4 retry stages (`[200, 500, 1000, 1500]ms`, totaling ~3.2s) to prevent `Could not establish connection. Receiving end does not exist` when Chrome wakes dormant MV3 service workers on cold starts.
  - Added explicit handling and warnings for `Extension context invalidated` to clarify when the extension was reloaded in `chrome://extensions` while an options/popup tab remained open.
  - Cleaned up `browser_specific_settings` in Vite config for Chrome builds, and unified SSO login in `App.tsx` through `loginTauSsoOnBackground`.
- **Automatic Re-Login Fails When Moodle Session Cookies Are Still Valid (`apps/extension/src/background/serviceWorker.ts`)**:
  - Fixed background re-login passing `skipInvalidate: true`, which left stale Moodle session cookies in place. Those cookies made `/login/index.php` redirect to the dashboard instead of the SSO login page, causing `Did not redirect to TAU SSO` errors.
  - Added a dashboard fallback path in `loginTauSso`: when the browser is already authenticated with Moodle (valid cookies), the function now extracts the sesskey and resets the wstoken directly from the dashboard instead of throwing.
- **REST Strategy 1-Hour Cooldown Blocks All Operations When Scraping Is Disabled (`packages/moodle-client/src/strategies/restStrategy.ts`)**:
  - The REST strategy entered a 1-hour cooldown when it received a `servicenotavailable` or `accessexception` error, designed to fall back to the scraper. When scraping was disabled, REST was the only strategy, so the cooldown blocked everything with no fallback. Now the cooldown only activates when `enableScraping` is true.
- **Strict Web Scraper Disablement when Scraping Toggle is OFF (packages/moodle-client/src/moodleApi.ts, settingsSync.ts, pps/extension/src/background/serviceWorker.ts, App.tsx)**:
  - Resolved an issue where ScraperMoodleStrategy was inadvertently initialized and executed (fetching /grade/report/overview/index.php, archive years, and student profiles) even when the scraping setting was disabled.
  - Updated MoodleClient constructor to strictly respect options.enableScraping, omitting ScraperMoodleStrategy from the fallback strategy chain by default and whenever enableScraping: false.
  - Updated alidateToken, etchEnrolledCourses, and 
estoreMoodleSettingsForOnboarding across the extension background service worker and options UI to explicitly pass enableScraping: settings.scrapingEnabled ?? false.
  - Wrapped calendar saveNoodleSettings calls in SettingsSyncManager in resilient error handling so calendar-based settings synchronization fails gracefully without throwing unhandled errors when scraping is off.
  - Verified via unit test TC-FALLBACK-18 and live Playwright test TC-EXT-LIVE-01 that zero scraper network requests or log entries occur while the scraping toggle is off.
- **Corrupted Hebrew Regex in Scraper Assignment Timestamps (`packages/moodle-client/src/strategies/scraperStrategy.ts`)**:
  - Fixed UTF-8 encoding corruption in Hebrew month and deadline regex patterns (`הוגש ב`, `מועד הגשה:`, `פתוח מ:`) that caused dates to parse as `null`.
- **Direct Assignment Attachment Download Links (`packages/moodle-client/src/syncEngine.ts`, `scraperStrategy.ts`)**:
  - Fixed assignment file links pointing to the intermediate Moodle webpage instead of direct download URLs (`pluginfile.php`) by extracting attachments from `intro` and `attachments` HTML blocks and populating `introattachments`.
- **Mobile Web Service Token Extraction on SSO Login (`apps/extension/src/background/serviceWorker.ts`)**:
  - Fixed token reset in `loginTauSso` by sending a GET request with query parameters to `/user/managetoken.php` and parsing the newly generated 32-character hexadecimal wstoken, resolving `invalidtoken` fallback loops.
- **Onboarding Step State Degradation (`apps/extension/src/options/App.tsx`)**:
  - Fixed a race condition where `App.tsx` downgraded `onboardingStep` from 3 back to 2 when `cachedSyncResult` was null prior to initial sync completion.
- **Background Sync Lock & Deduplication (`apps/extension/src/background/serviceWorker.ts`)**:
  - Added `activeBackgroundSyncPromise` lock to prevent multiple concurrent sync operations from executing simultaneously.
- **High-Impact Promotional Assets Suite (`apps/extension/scripts/generate-promo-assets.mjs`, `apps/extension/promo/`)**: Created an automated Playwright-based generator for Chrome Web Store and project showcase promotional graphics. Generates 5 high-resolution (1280×800, 2× Retina) carousel slides highlighting core capabilities:
  1. *Hero Overview*: "Meet Noodle: Study Smarter at TAU" with client-only privacy and instant sync callouts.
  2. *Deadlines & Grades*: "Never Miss a Deadline Again" with color-coded urgent countdowns, 100/100 grade badges, and progress tracking.
  3. *Zoom Lecture Hub*: "Join Live Lectures in One Click" with live class banners (`● פעיל כעת`) and unified schedules.
  4. *Course Files*: "All Course Files, Cleanly Organized" with weekly topic pills, PDF slides, and code skeletons with exact MB sizes.
  5. *Themes & Productivity*: "Tailored to Your Workflow" featuring Midnight Dark Mode, high-DPI toolbar popup, and bilingual support.
  Also generates a 1400×560 Marquee Banner (`promo-marquee-banner.png`) and a 440×280 Small Promo Tile (`promo-small-tile.png`) featuring the smiling ramen bowl mascot.
- **Bilingual High-DPI Toolbar Popup Captures (`apps/extension/screenshots/toolbar-popup.png`, `toolbar-popup-he.png`)**: Enhanced e2e test suite to capture container-focused, high-resolution popup screenshots with zero empty whitespace in both English and Hebrew modes.
- **Automated Chrome DevTools Inspection & E2E Feedback Loop (`pnpm test:devtools` / `apps/extension/e2e/sync-devtools.spec.ts`)**: Built an automated browser testing feedback loop for agents and developers using Playwright with real unpacked Chrome extension loading (`TC-EXT-DEVTOOLS-01`, `TC-EXT-DEVTOOLS-02`). Hooks into Chrome DevTools console and network streams across both the Options Page UI and the Background Service Worker. Allows agents to trigger synchronization, inspect diagnostic logs, test failure recovery (unauthenticated/expired tokens), verify successful synchronization, assert UI DOM updates, and confirm local storage persistence without manual human intervention.

### Fixed
- **Google Tasks Persistent Sign-In, Silent Background Refresh, and Unauthenticated Sync Alert (`apps/extension/src/background/serviceWorker.ts`, `apps/extension/src/options/App.tsx`, `apps/extension/src/shared/i18n.ts`, `storage.ts`, `TC-GT-09`)**:
  - Fixed Google Tasks repeatedly requiring re-authentication by preventing Moodle SSO teardowns (`clearUserSession`) from wiping `googleAccessToken` and `googleTokenExpiry`.
  - Added background silent OAuth token refresh with cached `googleUserEmail` via `login_hint` and non-interactive `launchWebAuthFlow({ prompt: 'none' })`, preserving authentication across browser restarts and Moodle sessions without repeated popups.
  - Fixed Google Tasks failing silently when unauthenticated: records `googleTasksAuthError` in `browser.storage.local` and dispatches browser notifications during background sync failures.
  - Added visual connection status badges (`● Connected to Google Tasks` / `⚠️ Not connected — Authentication required`) and prominent warning alerts with a 1-click "Connect Now ↗" button across both Dashboard and Settings tab.
- **Inline New-Tab Opening for Submitted & Course Files (`apps/extension/src/options/App.tsx`)**:
  - Fixed pressing `"פתח ↗"` ("Open") on submitted files (`assignsubmission_file` / `submission_files`) downloading the file instead of opening it in a new tab due to Moodle's `Content-Disposition: attachment` response header.
  - Added `handleOpenFileInNewTab` and `buildFileOpenUrl` (stripping `forcedownload=1`) to fetch inline-viewable files (PDFs, images, source code, and text files) with session credentials, wrap them in an inline-typed `Blob` (`application/pdf`, `image/*`, `text/plain;charset=utf-8`), and open the `Blob` URL in a new browser tab.
- **React Hook Order Violation in Options Page (`apps/extension/src/options/App.tsx`, Minified React error #310)**:
  - Fixed an unhandled conditional hook violation where `assignmentsList`'s `useMemo` was defined inside the step-3 dashboard block, below early return statements for loading and onboarding steps 1 and 2.
  - Moved the `useMemo` computation to the top-level hook declaration block alongside other state and effects, and directly referenced `syncResult?.assignments`, `settings?.completedAssignments`, and `settings?.uncompletedAssignments` in its dependency array.
  - Eliminates the runtime crash `Minified React error #310` ("Rendered more hooks than during the previous render") when transitioning from onboarding course selection to the main dashboard.
- **Zoom Link Date & Time Extraction for "No Fixed Time" and Active Recurring Meetings (`packages/moodle-client/src/zoomScraper.ts`, `TC-ZM-06`)**:
  - Fixed Zoom LTI Pro recurring meetings with "No Fixed Time" (`type === 3`), instant meetings (`type === 1`), and PMI rooms (`type === 4`) displaying arbitrary creation timestamps (e.g., `14:23:47` from months ago) by introducing `normalizeZoomStartTime()` which strips non-scheduled creation timestamps and past timestamps not aligned to 5-minute `:00` boundaries.
  - Deduplicated `previous` LTI meetings against `upComing` rooms in `scrapeZoomMeetingsWithToken`.
  - Fixed `collapseRecurringMeetings()` treating currently live sessions (`startTime < now <= startTime + 2h`) as past meetings and replacing them with next week's occurrence; active sessions within the 2-hour window are now retained as the active representative.
- **Toolbar Popup Assignment Filtering & Chronological Sorting (`apps/extension/src/popup/Popup.tsx`, `TC-EXT-01`)**:
  - Fixed the extension popup displaying hidden assignments, ignoring manual completion overrides (`completedAssignments` / `uncompletedAssignments`), and showing unsorted tasks. Popup tasks now strictly match Dashboard filtering and sort by nearest upcoming deadline $\rightarrow$ undated $\rightarrow$ overdue.
- **Dashboard `pendingTasks` Sort Comparator Dead-Code Typo (`apps/extension/src/options/App.tsx`)**:
  - Fixed a duplicate `if (aHasNoDl && !bHasNoDl)` condition in `DashboardTab`'s `pendingTasks` comparator that prevented deterministic tie-breaking (`a.id - b.id`) when both tasks lacked deadlines.
- **Settings Desktop Notifications Toggle State Sync (`apps/extension/src/options/App.tsx`)**:
  - Wired `onToggleNotifications` in `SettingsTab` so toggling Desktop Notifications immediately updates React `settings` state instead of requiring a page reload.
- **`SYNC_PARTIAL` Progressive Rendering (`apps/extension/src/options/App.tsx`)**:
  - Updated the `SYNC_PARTIAL` message listener to merge `msg.partial` into `syncResult` state in real time during synchronization.
- **Deadline Notification Window & Hidden/Completed Filtering (`apps/extension/src/background/serviceWorker.ts`, `TC-BG-03`)**:
  - Fixed `checkAndNotify` sending notifications for hidden or manually completed assignments.
  - Widened the 24-hour deadline alert window from `(23, 24]` hours to `(1, 24]` hours so hourly background alarm drift or browser sleep cannot miss the 24-hour reminder, and batched notification flag reads/writes into a single `storage.local` call.
- **File Download URLs with `web_session_` Fallback Token (`apps/extension/src/options/App.tsx`)**:
  - Added `buildFileDownloadUrl(rawUrl, token)` to avoid appending `?token=web_session_...` to Moodle file URLs when operating in cookie-authenticated web session mode.
- **Dynamic Manifest Version in About Tab (`apps/extension/src/options/App.tsx`)**:
  - Replaced hardcoded `v4.1` badge in `AboutTab` with `v{browser.runtime.getManifest().version}`.
- **Suppressed Notifications for Assignments with No Deadline (`apps/extension/src/background/serviceWorker.ts`, `TC-BG-02`)**:
  - Filtered assignments in `checkAndNotify` so that only assignments with an active, non-null deadline and unsubmitted status produce notifications. Assignments with no deadline or already submitted no longer trigger new assignment discovery notifications.
- **Silent Sync Failure When Service Worker Is Asleep (`apps/extension/src/shared/messaging.ts`)**:
  - Fixed `sendMessageToBackground` silently returning `null` when the MV3 service worker was terminated. The first `sendMessage` call wakes the SW but loses the message; added a 500ms delay + single retry so the message is delivered once the SW is back up.
- **Automatic Re-Login Fails When Moodle Session Cookies Are Still Valid (`apps/extension/src/background/serviceWorker.ts`)**:
  - Fixed background re-login passing `skipInvalidate: true`, which left stale Moodle session cookies in place. Those cookies made `/login/index.php` redirect to the dashboard instead of the SSO login page, causing `Did not redirect to TAU SSO` errors.
  - Added a dashboard fallback path in `loginTauSso`: when the browser is already authenticated with Moodle (valid cookies), the function now extracts the sesskey and resets the wstoken directly from the dashboard instead of throwing.
- **REST Strategy 1-Hour Cooldown Blocks All Operations When Scraping Is Disabled (`packages/moodle-client/src/strategies/restStrategy.ts`)**:
  - The REST strategy entered a 1-hour cooldown when it received a `servicenotavailable` or `accessexception` error, designed to fall back to the scraper. When scraping was disabled, REST was the only strategy, so the cooldown blocked everything with no fallback. Now the cooldown only activates when `enableScraping` is true.
- **Toolbar Popup Badge Grammar & English Localization (`apps/extension/src/shared/dateUtils.ts`, `apps/extension/src/popup/Popup.tsx`, `Popup.css`)**: Fixed awkward `"1ימים"` badge text in English mode by generating proper English strings (`"1 day"` / `"${diffDays} days"`), ensuring bilingual parity with Hebrew (`"יום"` / `"${diffDays} ימים"`), localizing header labels ("UPCOMING ASSIGNMENTS" vs "מטלות קרובות"), and fixing assignment title truncation in mixed RTL/LTR layouts.
- **Enriched Mock Dataset & Multi-Course Visual Validation**: Expanded `apps/extension/e2e/sync-devtools.spec.ts` with comprehensive mock data covering two tracked courses (`0368-1001-01 מבוא למדעי המחשב` and `0368-2158-01 מבני נתונים`). Includes assignments with exact timestamps (allowsubmissionsfromdate, duedate, cutoffdate), urgency badges, submissions, grades (100/100, 96/100), structured topic sections with downloadable files (PDFs, Python, C++ code), and active/upcoming Zoom meetings (`● פעיל כעת` live banner, meeting lists, and direct launch links). Captures full-page screenshots of the Main Dashboard (`main-dashboard.png`), Courses Tab (`courses-tab-view.png`), and both individual Course Detail views (`course-9999-detail.png`, `course-9998-detail.png`).
- **Agent Browser Execution & Visual Inspection Guide ([`docs/AGENT_BROWSER_EXECUTION.md`](file:///d:/ProgramFiles/Projects/Noodle/docs/AGENT_BROWSER_EXECUTION.md))**: Added comprehensive documentation explaining how AI agents can autonomously launch the unpacked extension via Playwright in Chromium, stream console logs and network traffic from both page and worker contexts, take full-page and popup screenshots (`apps/extension/screenshots/`), and verify visual rendering without requiring user intervention.
- **Multi-Instance REST Orchestrator (`packages/moodle-client`)**: Upgraded `RestMoodleStrategy` to natively support cross-instance REST API fetching. Since TAU physically isolates databases for past academic years (e.g. `/2025/`), the root REST API cannot access historical courses. `RestMoodleStrategy` now uses the user's active SSO cookies to silently follow SAML postback challenges into archive login endpoints, extracts a dedicated REST token per academic year, and aggregates/deduplicates the courses and assignments directly using the mobile web service API without relying on HTML scraping.
- **Automatic Mobile Web Service Token Renewal on Expiry (`packages/moodle-client`)**: Added `getMobileToken()` to `ScraperMoodleStrategy` and `setToken()` across all strategies. When `RestMoodleStrategy` encounters `invalidtoken`, `fallbackRunner.ts` silently resets and acquires a fresh mobile web service token from `/user/managetoken.php` using active SSO session cookies, updates all strategies, resets circuit breaker cooldowns, and retries the REST request seamlessly without requiring the user to re-authenticate (Fixes #26, resolves D2).
- **Direct Course-Page Assignment Scraping (`packages/moodle-client`)**: Rewrote `ScraperMoodleStrategy.getAssignments()` to extract assignments directly from individual course pages (`/course/view.php?id=X`) across all discovered academic years. Decoupled assignment discovery from the Moodle Calendar (which filtered out past deadlines), guaranteeing all historical and current course assignments are captured (Fixes #26, resolves D4).

### Fixed
- **Suppressed Notifications for Assignments with No Deadline (`apps/extension/src/background/serviceWorker.ts`, `TC-BG-02`)**:
  - Filtered assignments in `checkAndNotify` so that only assignments with an active, non-null deadline and unsubmitted status produce notifications. Assignments with no deadline or already submitted no longer trigger new assignment discovery notifications.
- **Silent Sync Failure When Service Worker Is Asleep (`apps/extension/src/shared/messaging.ts`)**:
  - Fixed `sendMessageToBackground` silently returning `null` when the MV3 service worker was terminated. The first `sendMessage` call wakes the SW but loses the message; added a 500ms delay + single retry so the message is delivered once the SW is back up.
- **Automatic Re-Login Fails When Moodle Session Cookies Are Still Valid (`apps/extension/src/background/serviceWorker.ts`)**:
  - Fixed background re-login passing `skipInvalidate: true`, which left stale Moodle session cookies in place. Those cookies made `/login/index.php` redirect to the dashboard instead of the SSO login page, causing `Did not redirect to TAU SSO` errors.
  - Added a dashboard fallback path in `loginTauSso`: when the browser is already authenticated with Moodle (valid cookies), the function now extracts the sesskey and resets the wstoken directly from the dashboard instead of throwing.
- **REST Strategy 1-Hour Cooldown Blocks All Operations When Scraping Is Disabled (`packages/moodle-client/src/strategies/restStrategy.ts`)**:
  - The REST strategy entered a 1-hour cooldown when it received a `servicenotavailable` or `accessexception` error, designed to fall back to the scraper. When scraping was disabled, REST was the only strategy, so the cooldown blocked everything with no fallback. Now the cooldown only activates when `enableScraping` is true.
- **Settings Sync Null Pointer Exception (`apps/extension/src/background/serviceWorker.ts`)**: Fixed `TypeError: Cannot convert undefined or null to object` in `performSettingsSync()` when examining nullish setting entries with `typeof value === 'object'`.
- **Notification Icon URL Resolution in MV3 (`apps/extension/src/background/serviceWorker.ts`)**: Replaced relative `'icon-128.png'` strings in `browser.notifications.create` with canonical absolute URLs via `browser.runtime.getURL('icon-128.png')` to prevent background fetch failures.
- **AJAX Course Year Mapping Bug (`packages/moodle-client`)**: Fixed an issue in `extractCoursesViaAjax` where courses added from timeline AJAX responses bypassed `this.courseYearMap`, preventing them from being scraped for assignments.
- **Archive Assignment Syncing (Missing Assignments)**: Discovered that past assignments from archive courses (e.g. `2025/`) were missing because the scraper strategy solely relied on the Moodle Calendar "Upcoming Events" view, which explicitly filters out past deadlines. `syncEngine.ts` has been refactored to first process `CourseContents`, injecting any discovered `assign` modules into the sync pipeline before fetching `SubmissionStatus` and `GradeItems`. This guarantees all assignments visible in course modules are parsed and tracked, even if their deadlines are in the past.
- **Scraper Strategy SSO Race Condition**: Fixed a critical bug where fetching archive instances (e.g. `2025/my/`) in parallel would sometimes yield unauthenticated guest sessions, causing AJAX course discovery to return 0 courses. The background extension now sequentially primes the SSO session for all known archive domains before fetching course contents.
- **Moodle 4.x Scraper Regex**: Fixed the module parsing regular expression (`modRegex`) in `ScraperStrategy` to correctly use `id="module-\d+"` as the lookahead boundary. Moodle 4.x nested the `modtype_` class inside the `activitytitle` element, causing the old lookahead to prematurely truncate the HTML string. This truncation was responsible for syncing returning 0 files and 0 zoom meetings.

- Added --live and --live-only flags to pnpm test wrapper to conditionally execute the Moodle API sandbox script (scripts/test-moodle-live.mjs) alongside the standard automated tests. - 2026-09-07

### Changed
- **Test Runner Cleanliness (`packages/moodle-client/jest.config.js`)**:
  - Enabled `silent: true` in Jest configuration to suppress expected handled warning and fallback logs emitted during failure mode unit tests.
  - Suppressed `ts-jest` hybrid module kind diagnostic code `151002` to prevent repetitive compiler warnings on each test file.

### Added
- **API Sandbox Testing Tool (`sandbox/test_moodle.mjs`, `docs/developer-guide.md`)**:
  - Added a dedicated sandbox testing script in `sandbox/test_moodle.mjs` for manual low-level verification of Moodle Web Service API endpoints (Courses, Assignments, Zoom LTI, and Calendar-based Settings Sync) using actual credentials.
  - Added support for `--env-file` configuration via `moodle_test_credentials.env` and interactive prompt fallback.
  - Added API Sandbox Testing section to `docs/developer-guide.md`.

- **Multi-Year Academic Archive Course Discovery & Contextual Routing (`packages/moodle-client`, `apps/extension`)**:
  - Added multi-year archive scanning in `ScraperMoodleStrategy` and `AjaxMoodleStrategy`, querying both current root and candidate past academic year instances (e.g. `2025`, `2024`) via `Promise.allSettled` to resolve empty course selections during academic year transitions (such as between September and October before the upcoming 2026 academic year courses open).
  - Added dynamic archive year discovery (`discoverArchiveYears`) scanning page HTML and dropdown options for archive subpaths (`/(20\d{2})\b`).
  - Added `year` and `instanceUrl` metadata properties to `RawMoodleCourse` and internal routing maps (`courseYearMap`, `assignYearMap`) in `ScraperMoodleStrategy`.
  - Added year-aware deep link generation in `syncEngine.ts`, routing assignment links (`/mod/assign/view.php`) to the appropriate archive year instance (`https://moodle.tau.ac.il/${year}/...`).
  - Updated `groupAndSortCourses` in `apps/extension/src/options/App.tsx` to group past year courses by academic year when metadata parsing lacks semester details, and updated course links (`getCourseMoodleUrl`) to navigate directly to the correct academic year instance.
  - Relaxed `parseTauCourseMetadata` regex to accept optional hyphens in course codes (`^(\d{4}-?\d{4})-(\d{2})-(\d{4})-(\d)$`).
  - Added test cases `TC-FALLBACK-08` and `TC-FALLBACK-09` in `fallbackStrategies.test.ts` and `docs/TEST_CASES.md`.
- **Modular Multi-Tier Moodle Client Fallback Architecture (`packages/moodle-client`, `apps/extension`, `apps/mobile`)**:
  - Implemented a Strategy Pattern with Chain-of-Responsibility fallback runner (`executeWithFallback`) in `@tautracker/moodle-client`:
    - **Tier 1 (`RestMoodleStrategy`)**: Uses the official Moodle Mobile REST API (`/webservice/rest/server.php`) with `wstoken`. When the university re-enables the mobile app or plugin, requests resolve immediately with zero overhead.
    - **Tier 2 (`AjaxMoodleStrategy`)**: Uses Moodle's internal AJAX endpoint (`/lib/ajax/service.php`) with the web `sesskey` and browser session cookies for supported endpoints (e.g. timeline courses). Statically lists unsupported operations to bypass redundant network requests and console noise.
    - **Tier 3 (`ScraperMoodleStrategy`)**: Uses pure TypeScript DOM/Regex parsing to fetch and extract course listings, assignment submission tables, course sections, files, and grades directly from standard Moodle web pages (`/my/courses.php`, `/user/profile.php`, `/my/`, `/course/view.php`, etc.) using session cookies.
  - Added a **1-hour circuit breaker** on `RestMoodleStrategy`: when Moodle returns access control exceptions (`accessexception` / `servicenotavailable`), the REST strategy enters a 1-hour cooldown window to prevent repeated hammering of the disabled mobile endpoint.
  - Enhanced course discovery in `ScraperMoodleStrategy.getEnrolledCourses()` using `Promise.allSettled` to query `/my/courses.php`, `/user/profile.php`, and `/my/`, parsing course cards (`data-course-id`), links (`/course/view.php?id=`), and inline JSON state scripts, extracting TAU course codes (`0368111801`).
  - Added real-time observability in dev mode (`devMode: true`) logging strategy attempts, unsupported function skips, failure reasons, and fallback transitions.
  - Added test cases `TC-FALLBACK-01` through `TC-FALLBACK-07` in `fallbackStrategies.test.ts`.
  - Added `sesskey` extraction, storage, and teardown in extension `serviceWorker.ts`, `storage.ts`, and mobile `auth.ts`.
  - Updated `docs/ARCHITECTURE.md` and `docs/TEST_CASES.md`.

### Fixed
- **Suppressed Notifications for Assignments with No Deadline (`apps/extension/src/background/serviceWorker.ts`, `TC-BG-02`)**:
  - Filtered assignments in `checkAndNotify` so that only assignments with an active, non-null deadline and unsubmitted status produce notifications. Assignments with no deadline or already submitted no longer trigger new assignment discovery notifications.
- **Silent Sync Failure When Service Worker Is Asleep (`apps/extension/src/shared/messaging.ts`)**:
  - Fixed `sendMessageToBackground` silently returning `null` when the MV3 service worker was terminated. The first `sendMessage` call wakes the SW but loses the message; added a 500ms delay + single retry so the message is delivered once the SW is back up.
- **Automatic Re-Login Fails When Moodle Session Cookies Are Still Valid (`apps/extension/src/background/serviceWorker.ts`)**:
  - Fixed background re-login passing `skipInvalidate: true`, which left stale Moodle session cookies in place. Those cookies made `/login/index.php` redirect to the dashboard instead of the SSO login page, causing `Did not redirect to TAU SSO` errors.
  - Added a dashboard fallback path in `loginTauSso`: when the browser is already authenticated with Moodle (valid cookies), the function now extracts the sesskey and resets the wstoken directly from the dashboard instead of throwing.
- **REST Strategy 1-Hour Cooldown Blocks All Operations When Scraping Is Disabled (`packages/moodle-client/src/strategies/restStrategy.ts`)**:
  - The REST strategy entered a 1-hour cooldown when it received a `servicenotavailable` or `accessexception` error, designed to fall back to the scraper. When scraping was disabled, REST was the only strategy, so the cooldown blocked everything with no fallback. Now the cooldown only activates when `enableScraping` is true.
- **Fixed Onboarding Reversion & Session Termination During Archive Discovery**:
  - Prevented `AjaxMoodleStrategy` from attempting to query past year archive subpaths (`/2025/`, `/2024/`) with the root `sesskey`, which caused Moodle CSRF security errors that terminated active browser session cookies. Archive year course discovery is safely and cleanly delegated to `ScraperMoodleStrategy` via standard HTML GET requests.
  - Fixed a race condition in `apps/extension/src/options/App.tsx` where `browser.storage.onChanged` triggered duplicate concurrent onboarding setup routines that kicked users back to step 1 (login) on background error.
  - Added in-flight promise deduplication to `fetchEnrolledCourses` in `serviceWorker.ts` and step 2 retention guards in `App.tsx` so transient network hiccups never demote users from active course selection.
- Fixed `getEnrolledCourses` in `AjaxMoodleStrategy` passing invalid `limit: 0` (which requested 0 courses from Moodle) and unsupported classifications; updated to query valid Moodle 4.x classifications (`'all'`, `'inprogress'`, `'future'`, `'past'`, `'favourites'`) with `limit: 100`, `sort: 'fullname'`, course accumulation across classifications, and `core_course_get_recent_courses` fallback.
- Enhanced `ScraperMoodleStrategy` course scraping to query `/grade/report/overview/index.php`, reject unauthenticated guest sessions (`userid <= 1`) in `getSiteInfo`, extract opening `<a>` tags with flexible attribute positioning, and parse course `<option>` dropdowns.
- **Fixed Zero Courses Extracted in Scraper HTML Parsing (Moodle 4.x)**:
  - Fixed `parseCoursesFromHtml` failing to extract courses on Moodle 4.x dashboards by updating `data-course-id` regex to support nested child span elements (`<span class="coursename">`) and flexible `aria-label`/`title` attribute positioning.
  - Fixed scraper failing to extract links from grade overview pages by adding `/grade/report/overview/index.php` to the course link regex.
  - Fixed greedy regex capturing in course link extraction that incorrectly captured user IDs (`userid=...`) instead of course IDs; updated to use precise word boundaries (`\bid=`).
  - Added test cases `TC-FALLBACK-10` through `TC-FALLBACK-15` verifying resilient regex parsing on realistic HTML structures without `course/view.php` links.
- Fixed Moodle login breaking after the academic year changed by scraping `user/managetoken.php` to reset and acquire the Web Service token, restoring API access after the university disabled the `tool_mobile` plugin.

### Added
- **Continuous Integration (CI) Test Pipeline on Every Commit (`.github/workflows/build-extension.yml`)**:
  - Updated GitHub Actions workflow to trigger on every `push` (all branches) and `pull_request`.
  - Integrated the full test suite into the CI pipeline:
    - Shared core unit tests (`pnpm test:moodle-client` - 12 suites, 61 tests).
    - Cross-browser extension build parity verification (`pnpm test:parity` - Chrome MV3 vs Firefox MV3).
    - Playwright Chromium extension E2E tests (`xvfb-run --auto-servernum -- pnpm test:e2e`).
    - Failure artifact capture (`playwright-report` upload on test failure).
    - Build and release artifact upload for both Chrome and Firefox extensions.
- **Comprehensive Automated Testing & Playwright E2E Suite (`packages/moodle-client`, `apps/extension`, `scripts/`)**:
  - Implemented 12 Jest test suites in `packages/moodle-client` with 61 unit/integration tests verifying categories 1 through 15 from `docs/TEST_CASES.md` (Authentication, Courses, Assignments, Grades, Zoom, Files, Google Tasks, Calendar Sync, Backup/Restore, Background Notifications, Stress/Volume).
  - Added shared validation and formatting utilities (`isValidIsraeliId`, `formatFileSize`, `getFileExtension`) in `@tautracker/moodle-client`.
  - Added automated cross-browser build parity suite (`scripts/test-build-parity.mjs`) for `TC-EXT-BRW-01` and `TC-EXT-BRW-02`.
  - Configured **Playwright** (`@playwright/test`) in `apps/extension` for automated headless testing and interactive headed browser agent testing:
    - `auth.spec.ts`: Tests login form, Israeli ID mod-10 validation toast, and "Remember Me" toggle.
    - `dashboard.spec.ts`: Tests "Next Up" spotlight banner, real-time search filtering, status filter checkboxes, and accordion expansion.
    - `theming.spec.ts`: Tests Hebrew (RTL) vs English (LTR) language toggle, and Slate Dark vs Warm Cream Noodle theme.
    - `sidebar.spec.ts`: Tests sidebar collapse width toggle and session logout.
  - Added root test scripts `pnpm test`, `pnpm test:moodle-client`, `pnpm test:parity`, `pnpm test:e2e`, and `pnpm test:e2e:headed`.
- **Master System Test Cases Catalog & Cross-Browser Parity (`docs/TEST_CASES.md`, `.agents/`)**:
  - Created comprehensive test catalog in `docs/TEST_CASES.md` detailing 70+ test cases across 15 functional domains.
  - Divided test cases into **Automated Testing** (Jest, Vitest, Playwright) and **Gemini Browser Interaction Agent Testing** (options page, popup, mobile web).
  - Explicitly specified platform coverage: Mobile, Extension (Chromium), and Extension (Firefox), including dedicated cross-browser parity test cases (`TC-EXT-BRW-*`).
  - Updated agent instructions (`AGENTS.md` and `.agents/rules/`) to mandate cross-browser parity and test case traceability.
  - Archived legacy test infrastructure specification (`docs/TEST_INFRA.md`).
- **Submitted Files Display & Download (`@tautracker/moodle-client`, `apps/extension`, `apps/mobile`)**:
  - Parsed `lastattempt.submission.plugins` for `submission_files` in `syncEngine.ts`, exposing typed `submittedFiles?: Attachment[]` on `Assignment`.
  - Added SQLite migration (`ALTER TABLE assignments ADD COLUMN submitted_files TEXT`) and data mapper updates in `apps/mobile/src/services/database.ts`.
  - Rendered submitted files as green download links in the web extension options dashboard and course view (`App.tsx`), and mobile screens (`index.tsx`, `courses.tsx`).
- **Moodle SSO Background Auto-Login for Links (`apps/extension`)**:
  - Added capture-phase global click interceptor on `moodle.tau.ac.il` assignment and course links.
  - Checks existing `MoodleSession` cookies to allow instantaneous navigation if already authenticated.
  - Automatically performs an invisible background SAML/Shibboleth SSO authentication via the Extension Service Worker using saved credentials, seeding browser cookies before opening the tab to bypass login prompts and prevent enrolment rejection loops.
  - Added `skipInvalidate` support to avoid wiping active sessions and ensure fast (sub-second) tab launching.
  - Updated storage configuration to retain Moodle credentials securely when "Remember me" is checked.
- **Assignment Card & Calendar Redesign, Lifecycle & Status Tags (`apps/extension`, `apps/mobile`, `packages/moodle-client`)**:
  - **Dual-Dimension Status Tracking & Tags**:
    - Added light green **"הוגש" (`Submitted`)** tag when a Moodle-submitted assignment is kept in **To Do** (`לביצוע`).
    - Added light orange **"לא הוגש" (`Not submitted`)** tag when an unsubmitted assignment is marked done manually (replacing the old `❗`).
    - Added full reversibility between "To Do" (`לביצוע`) and "Completed" (`הושלמו`) with contextual action menu items ("סמן כבוצע" / "סמן לביצוע").
    - Added `uncompletedAssignments` synchronization support across Extension settings, Mobile preferences, and `@tautracker/moodle-client` SharedSettings.
  - **Contextual Action Menu (`⋯`)**:
    - Integrated expanded toolbar options dropdown across desktop calendar cards and mobile drawers, revealing: Mark Done/To Do, Go to Course, Open in Moodle, and Hide/Unhide.
  - **Submit Button Visibility Optimization**:
    - Restyled and made the `Submit ↗` (`הגש ↗`) button visible exclusively on unsubmitted, active tasks, omitting it on completed tasks for a cleaner appearance.
  - **Terminology Standardization**:
    - Renamed all UI references from "Pending" (`ממתינים` / `פתוח`) to "To Do" (`לביצוע`) across filters, stat cards, headings, and empty state messages.
  - **Desktop Assignment Card Layout Fix (`apps/extension/src/options/App.css`)**:
    - Fixed card squashing and cropping when expanding multiple assignments by applying `flex-shrink: 0; min-height: fit-content;` and expanding `.assignments-list` scroll viewport to `75vh`.

### Fixed
- **Suppressed Notifications for Assignments with No Deadline (`apps/extension/src/background/serviceWorker.ts`, `TC-BG-02`)**:
  - Filtered assignments in `checkAndNotify` so that only assignments with an active, non-null deadline and unsubmitted status produce notifications. Assignments with no deadline or already submitted no longer trigger new assignment discovery notifications.
- **Silent Sync Failure When Service Worker Is Asleep (`apps/extension/src/shared/messaging.ts`)**:
  - Fixed `sendMessageToBackground` silently returning `null` when the MV3 service worker was terminated. The first `sendMessage` call wakes the SW but loses the message; added a 500ms delay + single retry so the message is delivered once the SW is back up.
- **Automatic Re-Login Fails When Moodle Session Cookies Are Still Valid (`apps/extension/src/background/serviceWorker.ts`)**:
  - Fixed background re-login passing `skipInvalidate: true`, which left stale Moodle session cookies in place. Those cookies made `/login/index.php` redirect to the dashboard instead of the SSO login page, causing `Did not redirect to TAU SSO` errors.
  - Added a dashboard fallback path in `loginTauSso`: when the browser is already authenticated with Moodle (valid cookies), the function now extracts the sesskey and resets the wstoken directly from the dashboard instead of throwing.
- **REST Strategy 1-Hour Cooldown Blocks All Operations When Scraping Is Disabled (`packages/moodle-client/src/strategies/restStrategy.ts`)**:
  - The REST strategy entered a 1-hour cooldown when it received a `servicenotavailable` or `accessexception` error, designed to fall back to the scraper. When scraping was disabled, REST was the only strategy, so the cooldown blocked everything with no fallback. Now the cooldown only activates when `enableScraping` is true.
- **Mobile Attachments Display & Download (`apps/mobile/src/app/index.tsx`, `courses.tsx`)**:
  - Fixed issue where all attachments displayed the literal label "Attachment" / "קובץ מצורף" by resolving property keys across `name`, `fileName`, and `filename`.
  - Fixed attachment download button non-responsiveness by resolving `url`, `fileUrl`, and `fileurl`, and adding a fallback to `Linking.openURL`.
- **Mobile Task Progress & Stats (`apps/mobile/src/app/index.tsx`)**:
  - Corrected calculation of `pendingTasksCount` and progress bar percentage to properly filter hidden and completed tasks.

---

## [3.2.0] - 2026-09-01

### Added
- **Mobile Courses Redesign & Extension Parity (`apps/mobile/src/app/courses.tsx`, `dateUtils.ts`, `i18n.ts`)**:
  - Added dedicated **Course Edit Modal** to customize course nicknames, pick from 14 curated color swatches or custom Hex codes, and toggle tracking status with automatic cross-platform sync.
  - Added expandable **Tracked Courses Configuration Panel** with semester grouping (`groupAndSortCourses` via `parseTauCourseMetadata`) and inline controls.
  - Added horizontal scrolling **Subjects Navigation Pill Bar** ("הכל 🌐" and section pills with active color highlight) and global "צמצם הכל / הרחב הכל" toggle.
  - Added **Dual-View Segmented Switcher**:
    - **Course Content Tab**: Interactive Zoom section with live meeting detection (`● פעיל כעת`), dashboard eye interest toggle, and collapsible section accordions with downloadable files and urgency-badged assignments.
    - **Assignments & Grades Tab**: Summary cards (Course Average %, Submitted, Pending) and full chronological assignment cards with status indicators, grades (`ציון: X / Y`), due countdowns, attachments, and direct Moodle links.
  - Ported `dateUtils.ts` for consistent urgency badges (`badge-success`, `badge-warning`, `badge-danger`) and countdown text.
  - Added complete Hebrew and English localization for all new course features.
- **Cross-Platform Settings Synchronization via Moodle Calendar (`@tautracker/moodle-client`, Extension, Mobile)**:
  - Added zero-backend configuration sync engine using hidden Moodle Calendar user events (`NOODLE_SYNC_DATA`).
  - Automatically synchronizes tracked courses, course nicknames, course colors, UI themes, language preferences, and Google Tasks preferences across devices.
  - Implemented conflict-free Last-Write-Wins (LWW) resolution with per-key millisecond timestamps and device identifiers.
  - Added automatic configuration restore on login/startup for both web extensions and mobile app, bypassing manual onboarding when existing configurations exist.
  - Tied settings synchronization directly into foreground and background assignment sync loops.
- **Mobile Google Tasks One-Tap OAuth Flow (`apps/mobile/src/services/googleTasks.ts`, `settings.tsx`)**:
  - Implemented one-tap OAuth login via `WebBrowser.openAuthSessionAsync` with scope `https://www.googleapis.com/auth/tasks`, matching the seamless flow of the browser extension.
  - Set default Google Tasks list name to `"University"`.
  - Added collapsible "Advanced Settings" section for manual OAuth client ID/access token overrides.
- **Mobile Resilient File Download Service (`apps/mobile/src/services/fileDownloadService.ts`)**:
  - Implemented robust downloader with browser User-Agent headers, URL and filename sanitization, and dual-strategy fallback.
  - Added automatic TAU SSO token renewal via `loginTauSso` when encountering 401/403 or socket timeouts (`java.net.SocketTimeoutException`).
- **Mobile Reactive Preferences Provider (`apps/mobile/src/hooks/use-preferences.tsx`)**:
  - Added global reactive context provider for theme, mode, language, and RTL state, eliminating "Please restart the app" alert popups on setting changes.
  - Set default theme to `'noodle'` (warm cream & terracotta) and default language to Hebrew (`'he'`).
- **Mobile Files Tab Accordion Explorer (`apps/mobile/src/app/files.tsx`)**:
  - Collapsed courses by default to prevent long scrolling.
  - Added "Expand All" / "Collapse All" global toggle and collapsible section folders.
  - Redesigned file cards with extension-inspired file-type badges (PDF, Word, Excel, PowerPoint, ZIP, Media, Code), file size badges, and one-tap download/open buttons.

### Changed
- **Mobile Branding & Bundling Assets (`apps/mobile/assets/images/*`, `app.json`, `animated-icon.tsx`)**:
  - Generated high-resolution adaptive app icons, foregrounds, backgrounds, splash screens (`#FAF5EB`), and favicons directly from the official Noodle brand logo (`assets/logo.png`).
  - Added "Noodle" brand name typography below the header logo in the mobile sidebar.
  - Updated mobile sidebar navigation to use smooth bouncing vertical scrolling to prevent clipping on smaller screens.
- **Logo & Asset System Refactor**:
  - Standardized all navigation icon filenames uniformly across both web extension and mobile app (`dashboard.svg`, `courses.svg`, `files.svg`, `grades.svg`, `settings.svg`, `about.svg`).
  - Updated web extension `index.html` and `options.html` page favicons and headers to use the official Noodle brand icon instead of the default Vite template icon.
  - Whitelisted all legitimate app assets in `.gitignore` (`!apps/**/assets/**`, `!apps/extension/public/*.png`, `!logo.png`) while keeping temporary scratch images and build archives (`*.zip`) safely ignored.

### Removed
- **Unused & Duplicate Assets**:
  - Removed duplicate root `/logos/` directory and root `logo_large.png`.
  - Removed boilerplate Vite template files (`react.svg`, `vite.svg`, `public/icons.svg`, `public/logo.png`).
  - Removed unused mobile Expo scaffolding assets (`assets/expo.icon/`).
