# Noodle Mobile App - Feature Implementations & Technical Decisions

This document details the features ported from the Chrome Extension into the mobile version, along with design choices, architectural changes, and capabilities.

---

## 1. TAU SSO Login & Onboarding
* **Ported Feature**: Login via TAU SSO (Single Sign-On) credentials.
* **Problem**: In the extension, capturing the `wstoken` was done via Chrome's specific `webRequest` API by intercepting redirects to `moodlemobile://token=...`. This API is not available in React Native.
* **Decision**: We implemented a custom `CookieJar` class in `auth.ts` and set up manual redirect following (`fetch(..., { redirect: 'manual' })`). Each HTTP response hop is intercepted, cookies are ingested, and redirect loops are followed until the `moodlemobile://` token is extracted from the `Location` header.
* **Security & Convenience**: Added a **Remember Me** option. When checked, the username, ID number, and password are encrypted and stored locally in the device's keychain using `expo-secure-store`. Silent re-authentication is performed when token validation fails.

---

## 2. Configuration Backup & Restore
* **Ported Feature**: Exporting and importing configuration JSON files.
* **Format**: Compatible with `TauTrackerConfig-v1` format.
* **Capabilities**:
  * **Export**: Collects tracked course IDs from SQLite, plus user preferences (theme, language, Google Tasks status), and custom color/nickname mappings. Writes this as JSON via `expo-file-system` and triggers the native sharing sheet with `expo-sharing` to allow sending via email, WhatsApp, or saving to files.
  * **Import**: Invokes a file picker with `expo-document-picker`. Reads and validates the format, stores settings/preferences in SQLite, and merges course tracking, custom nicknames, and hex colors into the `tracked_courses` table.

---

## 3. Extension Logo Integration
* **Ported Feature**: Incorporate the brand identity of Noodle.
* **Design**: Center-aligned the login card and added a premium 80x80px logo wrapper with rounded corners (`borderRadius: 16`), bringing visual consistency with the extension onboarding layout.

---

## 4. UI Themes & Colors Parity
* **Ported Feature**: Premium layouts, spacing, and styling matching the options screen.
* **Styling**:
  * Integrated the premium slate-based **Dark Theme** (`#0f111a` background) and the warm terracotta **Noodle Theme** (`#faf5eb` warm cream background) with Sage green accent colors.
  * Mapped button, loader, checkbox, switcher, and badge colors directly to the dynamic `useTheme` hooks.
  * Standardized all cards and containers to use a premium `borderRadius: 14` (equivalent to the extension's `--radius-md: 14px`).
  * Styled assignment badges contextually: "Submitted" badges use Sage/Emerald green, while "Assigned" badges use the theme's primary color.

---

## 5. Google Tasks Integration & One-Tap OAuth
* **Ported Feature**: Two-way sync of assignments to Google Tasks.
* **Capabilities**:
  * **One-Tap OAuth**: Added `authenticateGoogleOAuth` in `googleTasks.ts` leveraging `expo-web-browser` (`WebBrowser.openAuthSessionAsync`). Users authenticate directly with Google and receive an access token automatically without manually generating OAuth credentials.
  * **Default Task List**: Defaults to `"University"` list.
  * Sync can be toggled on/off, and list names customized.
  * Foreground and background syncing triggers `performGoogleTasksSync` automatically.
  * Added manual sync controls and status messages to Settings, with manual token fields moved to an expandable "Advanced Settings" section.

---

## 6. Reactive Preferences & Live Theme/Language Switching
* **Problem**: Previously, `useTheme()` and `t()` read synchronously from SQLite (`noodle.db`). Modifying the theme or language in Settings required alerting the user to restart the application because components in the tree had no React state trigger to re-render.
* **Solution**: Introduced `PreferencesProvider` and `usePreferences()` in `src/hooks/use-preferences.tsx`.
* **Capabilities**:
  * All theme, mode, and language changes update React state immediately and write asynchronously to SQLite.
  * Default theme set to `'noodle'` (warm cream & terracotta palette) and default language set to Hebrew (`'he'`).
  * Removed all "Please restart the app" alert popups—UI reflects changes instantly across all mounted screens.

---

## 7. Resilient File Download Architecture
* **Problem**: Downloading files from TAU Moodle on mobile previously succeeded initially but then failed with `java.net.SocketTimeoutException`. TAU Moodle's firewall/WAF rejects or drops Android OkHttpClient requests using default `okhttp/...` User-Agents, and expired tokens redirect to internal SSO (`nidp.tau.ac.il`) which native downloaders cannot resolve.
* **Solution**: Created `fileDownloadService.ts` providing an enterprise-grade download pipeline:
  * **Browser Headers**: Dispatches requests with modern browser `User-Agent` (`Mozilla/5.0 (Linux; Android 14; Mobile)...`) and `Accept` headers to bypass WAF drop filters.
  * **Automatic Token Renewal**: Intercepts 401/403/timeouts and triggers `loginTauSso()` in `auth.ts` using stored credentials from `expo-secure-store` to refresh the session and retry seamlessly.
  * **Dual-Strategy Engine**: Attempts direct memory buffer download via `fetch` + base64 disk write first; falls back gracefully to `FileSystemLegacy.downloadAsync`.
  * **Filename Sanitization**: Cleans illegal Android/filesystem characters and extracts MIME types to ensure valid extensions (`.pdf`, `.docx`, etc.).

---

## 8. Mobile Files Explorer & Course Accordion
* **Ported Feature**: Course files browsing inspired by the Chrome extension's collapsible file tree, optimized for mobile screens.
* **Capabilities**:
  * **Default Collapsed State**: Courses are collapsed by default on initial load to prevent infinite scroll fatigue.
  * **Global Toggle**: Added quick "Expand All" / "Collapse All" toggle controls in the header.
  * **Section Folders**: Nested Moodle sections/folders collapse independently within each course card.
  * **Touch-Friendly File Cards**: Visual file-type badges (PDF, Word, Excel, PowerPoint, ZIP, Audio, Video, Code) with distinct color coding, readable file size pills, upload dates, and one-tap download / view action buttons.

---

## 9. Mobile Brand Identity & Sidebar UX
* **Bundling & App Icons**: Converted brand assets from `assets/logo.png` into high-resolution adaptive Android icons (`android-icon-foreground.png`, `android-icon-background.png`), splash screen (`splash-icon.png` on `#FAF5EB` cream canvas), and favicon.
* **Sidebar Layout**: Added smooth vertical scrolling (`ScrollView` with bounce physics and hidden scrollbars) to prevent clipping on compact phones and landscape viewports.
* **Brand Typography**: Positioned the official "Noodle" wordmark under the header logo in the sidebar navigation with dynamic theme styling.

