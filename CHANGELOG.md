# Changelog

All notable changes to the Noodle project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased] - 2026-09-01

### Added
- **Firefox AMO & Cross-Browser Packaging Tooling**:
  - Added `scripts/package-source.py` to generate complete, reproducible source code zips for Mozilla Add-on (AMO) review, including dynamic `BUILD.md` reviewer documentation.
  - Added `apps/extension/scripts/zip.py` and npm scripts (`build:zip`, `package:source`, `zip`) for automated packaging.
  - Added Firefox Gecko extension metadata to `manifest.json` (`noodle@tau` Gecko ID and `strict_min_version`).
  - Added explicit action and extension `icons` configuration (16px, 32px, 48px, 128px) in `manifest.json`.
- **Cross-Browser OAuth & Identity Support (`serviceWorker.ts`)**:
  - Implemented automatic fallback to `launchWebAuthFlow` using `chrome.identity.getRedirectURL()` and manifest `oauth2.client_id` for browsers without native `chrome.identity.getAuthToken` (e.g. Mozilla Firefox).
- **Proprietary Software License & Disclaimers (`LICENSE`)**:
  - Added comprehensive terms prohibiting unauthorized duplication, distribution, reverse engineering, and commercial/personal use.
  - Added extensive limitation of liability, hold-harmless indemnification, and third-party platform non-affiliation (disclaiming association with Moodle Pty Ltd, Zoom, and academic institutions, and disclaiming liability for credential compromise or user actions).
  - Updated `package.json` license field to `"UNLICENSED"`.

### Changed
- **Logo & Asset System Refactor**:
  - Standardized all navigation icon filenames uniformly across both web extension and mobile app (`dashboard.svg`, `courses.svg`, `files.svg`, `grades.svg`, `settings.svg`, `about.svg`).
  - Updated web extension `index.html` and `options.html` page favicons and headers to use the official Noodle brand icon instead of the default Vite template icon.
  - Whitelisted all legitimate app assets in `.gitignore` (`!apps/**/assets/**`, `!apps/extension/public/*.png`, `!logo.png`) while keeping temporary scratch images and build archives (`*.zip`) safely ignored.

### Removed
- **Unused & Duplicate Assets**:
  - Removed duplicate root `/logos/` directory and root `logo_large.png`.
  - Removed boilerplate Vite template files (`react.svg`, `vite.svg`, `public/icons.svg`, `public/logo.png`).
  - Removed unused mobile Expo scaffolding assets (`assets/expo.icon/`).
