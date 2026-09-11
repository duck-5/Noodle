# Developer Guide: Testing & Inspecting the Extension

This guide covers how to spin up a local development server for the extension and how to access its background service worker logs.

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
