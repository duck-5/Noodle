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

## 5. Google Tasks Integration
* **Ported Feature**: Two-way sync of assignments to Google Tasks.
* **Capabilities**:
  * Sync can be toggled on/off, and list names customized.
  * Foreground and background syncing triggers `performGoogleTasksSync` automatically.
  * Added manual sync controls and status messages to Settings.
