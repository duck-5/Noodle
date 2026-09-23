# Changelog

All notable changes to the Noodle project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]
### Fixed
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
