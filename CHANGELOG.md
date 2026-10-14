# Changelog

All notable changes to the Noodle project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]
### Added
- **Noodle v4 Dashboard & UI Rehaul (Issues #14, #20)**:
  - Added Dark Noodle "Coffee" theme (`coffee`) featuring deep dark brown background (`#0f0a07`), rich card panels (`rgba(36, 22, 12, 0.92)`), terracotta and sage accents, and quick 3-way cycle button (`☕ / 🍜 / 🌙`) in header.
  - Added Hero Action Strip on Dashboard: tranquil "המטלה הקרובה" ("Next Task") spotlight card with attachment chips ("פתח ↗", SVG "הורדה ↓") and Upcoming To-Do Queue excluding completed and hidden tasks with smooth expandable drawers.
  - Added smooth accordion drawer for course rows in "My Tracked Courses", expanding to reveal active/visible Zoom meetings and next 5 course assignments without page transitions.
  - Added "Manage Courses" modal dialog on Dashboard with semester groupings (`groupAndSortCourses`), custom nicknames, color pickers, and tracking checkboxes.
  - Added pure SVG `DownloadIcon` replacing emoji icons on file action buttons throughout the extension.
  - Added E2E tests `TC-DASH-REHAUL-01` to `TC-DASH-REHAUL-04` validating course row expansion, upcoming to-do queue exclusion logic, manage courses modal, and Coffee theme styling.
- **Optional Web Scraping Toggle & Pure-API Default (`apps/extension/src/options/App.tsx`, `packages/moodle-client/src/moodleApi.ts`)**:
  - Made all HTML web scraping functionality optional and disabled by default (`scrapingEnabled: false`, `enableScraping: false`).
  - Added a dedicated bilingual switch (`#scraping-enabled-toggle`) in the Extension Settings page: "Moodle Web Scraping (Fallback)" / "סריקת אתר Moodle (Web Scraping)".
  - When disabled (default), the sync engine operates in high-speed pure API mode using official Moodle REST and AJAX endpoints with zero HTML scraping overhead.
  - Users can enable the toggle in Settings whenever they need fallback scraping for legacy archive modules, past unlisted deadlines, or Zoom LTI links.
- **Real-Time Streaming Sync Data (`packages/moodle-client/src/syncEngine.ts`, `apps/extension/src/background/serviceWorker.ts`, `App.tsx`)**:
  - Implemented `onPartialSync` streaming callback in `runSync`, emitting incremental `SYNC_PARTIAL` messages to the UI as assignments, files, and meetings are discovered.
  - The UI updates dynamically without having to wait for the entire multi-course synchronization process to terminate.
- **High-Resolution Promotional Assets & Store Suite (`apps/extension/scripts/generate-promo-assets.mjs`)**:
  - Generated full Webstore graphic suite rendered at 2× Retina resolution (2560×1600 slides, 2800×1120 marquee, 880×560 tile) with font preloading and mockups for Hero Overview, Deadlines & Grades, Zoom Lecture Hub, Course Files Explorer, and Midnight Dark Theme + Toolbar Popup.
  - Enforced unofficial, student-friendly branding ("Smart Moodle Companion" / "Modern Moodle Client") without claiming official university affiliation.
- **Retina 2× DPI Automation Harness (`apps/extension/e2e/fixtures.ts`, `apps/extension/e2e/sync-devtools.spec.ts`)**:
  - Configured Playwright browser context with `deviceScaleFactor: 2` and 1440×900 viewport to capture crisp Retina extension screenshots (`main-dashboard.png`, `toolbar-popup.png`, `courses-tab-view.png`).
- **Live Extension E2E Test Suite with Real Credentials (`apps/extension/e2e/live-extension.spec.ts`, `TC-EXT-LIVE-01`)**:
  - Added an end-to-end Playwright test suite executing real SSO authentication and data synchronization against Tel Aviv University's live servers using `moodle_test_credentials.env`.
  - Verifies the scraping toggle defaults to OFF, tests pure API sync, toggles scraping ON, verifies storage persistence, executes scraping-enabled sync, resets to clean default, and captures visual screenshots.

### Changed
- **Streamlined Dashboard Course Management & Unified Config Table (`apps/extension/src/options/App.tsx`)**:
  - Removed course manual reordering arrows (`▲/▼`) for a clean, deterministic list of tracked courses.
  - Enlarged Noodle bowl logo in sidebar to 48px for enhanced brand presence.
  - Refactored `CoursesConfigTable` into a unified shared component reused across both `CoursesTab` and Dashboard Manage Courses modal.
- **Accelerated Synchronization & Parallel Batching (`packages/moodle-client/src/syncEngine.ts`)**:
  - Parallelized grade items, submission statuses, and course contents fetching using concurrent batch processing (`batchPromises`), reducing sync times from minutes to ~15 seconds.
- **Archive Scanning Pruning (`packages/moodle-client/src/strategies/scraperStrategy.ts`, `restStrategy.ts`)**:
  - Pruned archive queries to 1 year back (`currentYear - 1`), stopping redundant scanning of 2-year-old subpaths.
  - Eliminated redundant multi-phase scraper fetching when courses are already discovered.

### Fixed
- **Course Detail View Localization & UI Polish (`apps/extension/src/options/App.tsx`)**:
  - Fixed Hebrew/English localization mixups in `CourseDetailView` by translating raw Moodle status strings into Hebrew (`הוגש`, `טרם הוגש`, `הוקצה`).
  - Removed unstyled, non-functional placeholder button in `CourseDetailView` Zoom empty state.
- **White Assignment Title in Next Assignment Banner (`apps/extension/src/options/App.css`, `apps/extension/src/index.css`)**:
  - Overrode hardcoded `color: white;` in `.next-assign-title` with `var(--text-primary)` (`#1e293b`), ensuring high-contrast dark text on the warm cream noodle theme.
- **Ambiguous Hebrew Singular Day Badge Format (`apps/extension/src/shared/dateUtils.ts`)**:
  - Corrected `diffDays === 1` formatting from bare `'יום'` or awkward `'1 ימים'` to clear and grammatically natural `'יום 1'`.
- **Suppressed Notifications for Assignments with No Deadline (`apps/extension/src/background/serviceWorker.ts`, `TC-BG-02`)**:
  - Filtered assignments in `checkAndNotify` so that only assignments with an active, non-null deadline and unsubmitted status produce notifications. Assignments with no deadline or already submitted no longer trigger new assignment discovery notifications.
- **Silent Sync Failure When Service Worker Is Asleep (`apps/extension/src/shared/messaging.ts`)**:
  - Fixed `sendMessageToBackground` silently returning `null` when the MV3 service worker was terminated. The first `sendMessage` call wakes the SW but loses the message; added a 500ms delay + single retry so the message is delivered once the SW is back up.
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
