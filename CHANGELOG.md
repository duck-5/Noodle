# Changelog

All notable changes to the Noodle project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased] - 2026-09-01

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
