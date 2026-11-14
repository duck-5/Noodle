# Developer Guide: Testing & Inspecting the Extension

This guide covers how to spin up a local development server for the extension, how to access its background service worker logs, and how autonomous agents can run E2E browser tests and capture screenshots.

## 1. Local Development Server (Hot-Reloading)

The project uses `vite-plugin-web-extension` to provide a seamless, hot-reloading development experience. You do **not** need to manually build and load the extension into your browser for every change.

### Running the Dev Server

To launch an isolated browser instance with the extension pre-loaded:

**For Chrome:**
```bash
pnpm --filter extension run dev
```

**For Firefox:**
```bash
pnpm --filter extension run dev:firefox
```

### Profile Persistence
By default, Vite will save your browser profile (including logins, cookies, and local storage) in `apps/extension/.dev-profile/`. This means you only have to log in to Moodle once, and your session will persist across server restarts.

## 2. Inspecting Logs & Background Services

Web Extensions have two distinct execution environments:
1. **The UI Context**: The popup and options page. Logs here appear in the standard browser developer tools when you right-click the popup and select "Inspect".
2. **The Background Context (Service Worker)**: This runs invisibly in the background to handle periodic alarms, network requests, and syncing. 

### Viewing Background Logs in Firefox (dev:firefox)
1. Open a new tab and navigate to `about:debugging#/runtime/this-firefox`.
2. Locate the **Noodle** extension in the list.
3. Click the **Inspect** button next to it. 
4. A new Developer Tools window will open specifically for the background script. Switch to the **Console** tab to view background sync logs.

### Viewing Background Logs in Chrome (dev)
1. Open a new tab and navigate to `chrome://extensions`.
2. Find the **Noodle** extension card.
3. Click on the blue **service worker** link.
4. A dedicated Developer Tools window will open for the service worker where you can monitor the console.

## 3. Simulating Alarms

To test periodic sync without waiting 5 minutes:
- You can manually reduce the `SYNC_INTERVAL_MINUTES` constant in `serviceWorker.ts` (e.g., to `0.1` for 6 seconds) during development.
- *Note: Chrome strictly enforces a minimum 1-minute interval for production builds installed from the Web Store.*

## 4. API Sandbox Testing

For low-level testing of the Moodle API endpoints (like fetching courses, assignments, Zoom links, or manipulating the calendar storage) without involving the UI or the background service worker, a sandbox script is provided.

1. Ensure your real testing credentials are populated in the root `moodle_test_credentials.env` file. Do not commit this file.
2. Run the sandbox script using the native Node.js `--env-file` flag:

```bash
node --env-file=moodle_test_credentials.env scripts/test-moodle-live.mjs
```

This will authenticate directly using the credentials and output the API responses to the console.

Alternatively, you can run the live tests alongside the standard test suite by running:

```bash
pnpm test -- --live
```

---

## 5. Autonomous Agent Browser Execution, DevTools Logs & Screenshots

For automated testing by AI coding agents or CI workflows without requiring manual human browser interaction:

```bash
# Run headless Chrome with extension loaded, DevTools log interception, and screenshot capture
pnpm test:devtools

# Run with visible browser window for manual/live inspection
pnpm test:e2e:headed
```

- **Logs Captured**: Intercepts UI console logs, unhandled page errors, Service Worker lifecycle events, and Moodle network fetch traffic.
- **Screenshots Saved**: Visual captures of the Options Dashboard (`options-dashboard.png`) and Toolbar Popup (`toolbar-popup.png`) are saved directly to `apps/extension/screenshots/`.
- For comprehensive agent implementation patterns, see [`docs/AGENT_BROWSER_EXECUTION.md`](file:///d:/ProgramFiles/Projects/Noodle/docs/AGENT_BROWSER_EXECUTION.md).

---

## 6. Automated GitHub Releases (Tag Push)

Tag pushes matching `v*` (e.g., `git tag v4.0.4 && git push origin v4.0.4`) trigger [`.github/workflows/release-extension.yml`](file:///home/excustic/Code/Noodle/.github/workflows/release-extension.yml), while regular branch pushes and PRs run [`.github/workflows/build-extension.yml`](file:///home/excustic/Code/Noodle/.github/workflows/build-extension.yml) (with `tags-ignore: ['v*']` to avoid duplicate runs).

### Pre-Release Checklist
1. Bump `version` in both `apps/extension/src/manifest.json` and `apps/extension/package.json` to match `<version>` (`X.Y.Z`).
2. Move release notes in `CHANGELOG.md` under `## [<version>] - YYYY-MM-DD` (if omitted, `scripts/verify-release.mjs` falls back to `## [Unreleased]` with a warning).
3. Ensure repository Actions secrets are configured for Mozilla AMO signing:
   - `WEB_EXT_API_KEY`: AMO JWT issuer (`user:...`)
   - `WEB_EXT_API_SECRET`: AMO JWT secret
   - Optional repository variable `AMO_CHANNEL`: defaults to `listed` (submits `releases/noodle-v<version>-source-code.zip` via `--upload-source-code`); set to `unlisted` for self-distributed `.xpi` releases.

### Generated Release Assets
- `noodle-v<version>-chrome.zip` — Chrome MV3 package (`manifest.json` `"key"` stripped for Chrome Web Store compliance)
- `noodle-v<version>-firefox.zip` — Firefox MV3 package (`dist-firefox/`)
- `noodle-v<version>-firefox.xpi` — AMO-signed Firefox package (`web-ext sign`)
- `noodle-v<version>-source-code.zip` — AMO reviewer source archive (`scripts/package-source.py`)
- `SHA256SUMS.txt` — SHA-256 checksums for all release archives
