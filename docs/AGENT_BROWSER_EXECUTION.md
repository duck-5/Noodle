# Agent Guide: Executing the Browser Extension, Capturing DevTools Logs & Screenshots

This guide is the authoritative reference for AI coding agents (and human developers) on how to:
1. **Execute the actual unpacked browser extension** inside a real Chromium browser environment without manual intervention.
2. **Stream and capture DevTools console logs, unhandled errors, and network traffic** from both the UI pages and background service worker.
3. **Capture visual screenshots (pictures)** of the options dashboard, popup views, and specific UI elements for autonomous feedback loops and visual verification.

---

## 1. Quick Commands for Agents

| Objective | Command | Details |
| :--- | :--- | :--- |
| **Full Automated Feedback Loop** | `pnpm test:devtools` | Builds extension, boots Chromium with extension loaded, streams DevTools & Service Worker logs, tests sync, saves UI screenshots. |
| **Headed Visual Run** | `pnpm --filter extension run test:e2e:headed` | Boots visible Chromium window for live interaction. |
| **Full Extension E2E Suite** | `pnpm test:e2e` | Runs all extension Playwright specs (auth, theming, dashboard, sidebar, DevTools). |
| **Build Unpacked Extension** | `pnpm --filter extension run build:chrome` | Outputs unpacked MV3 extension bundle into `apps/extension/dist/`. |

---

## 2. How to Programmatically Launch the Extension

Chromium Manifest V3 extensions require a persistent context and do not load in legacy headless mode. To launch the extension in Playwright, use `--headless=new` with `--load-extension`:

```typescript
import { chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import path from 'path';

const pathToExtension = path.resolve(__dirname, '../dist');

// 1. Launch Persistent Chromium Context with Extension
const context = await chromium.launchPersistentContext('', {
  headless: false, // In Chromium, MV3 extensions only load when headless is false or --headless=new
  args: [
    `--disable-extensions-except=${pathToExtension}`,
    `--load-extension=${pathToExtension}`,
    `--headless=new`, // Run autonomously in agent environment
  ],
});

// 2. Discover Extension ID via the Background Service Worker
let [background] = context.serviceWorkers();
if (!background) {
  background = await context.waitForEvent('serviceworker', { timeout: 10000 });
}
const extensionId = background.url().split('/')[2];

// 3. Open Extension Pages
const optionsPage = await context.newPage();
await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
await optionsPage.waitForLoadState('domcontentloaded');
```

---

## 3. How to Capture DevTools Console Logs & Network Activity

An extension consists of two separate runtime contexts:
1. **The Page UI Context** (`options.html`, `index.html`)
2. **The Background Service Worker Context** (`serviceWorker.js`)

Agents must hook into both contexts to obtain complete visibility:

### A. UI Page Logs & Unhandled Page Errors

Listen directly to Playwright's `console` and `pageerror` events:

```typescript
const pageLogs: string[] = [];
const pageErrors: string[] = [];

optionsPage.on('console', (msg) => {
  const entry = `[Page Console ${msg.type().toUpperCase()}] ${msg.text()}`;
  pageLogs.push(entry);
  console.log(entry);
});

optionsPage.on('pageerror', (err) => {
  const entry = `[Page Error] ${err.name}: ${err.message}\n${err.stack}`;
  pageErrors.push(entry);
  console.error(entry);
});
```

### B. Service Worker Logs & Network Interception

Because Service Workers run in a worker thread, inject a lightweight logging and `fetch` wrapper inside the worker context using `background.evaluate()`:

```typescript
await background.evaluate(() => {
  const g = globalThis as any;
  g.__sw_logs = g.__sw_logs || [];

  // 1. Wrap Service Worker Console Methods
  const wrap = (type: string) => {
    const orig = (console as any)[type];
    (console as any)[type] = (...args: any[]) => {
      const formatted = args.map((a) => {
        if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack}`;
        if (typeof a === 'object') {
          try { return JSON.stringify(a); } catch { return String(a); }
        }
        return String(a);
      }).join(' ');
      g.__sw_logs.push(`[SW ${type.toUpperCase()}] ${formatted}`);
      orig?.apply(console, args);
    };
  };
  wrap('log');
  wrap('info');
  wrap('warn');
  wrap('error');

  // 2. Wrap Service Worker Network Requests (Moodle REST / Scraper calls)
  const origFetch = g.fetch;
  g.fetch = async (...args: any[]) => {
    const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : String(args[0]));
    g.__sw_logs.push(`[SW FETCH REQUEST] ${url}`);
    try {
      const res = await origFetch.apply(g, args);
      const cloned = res.clone();
      let bodyPreview = '';
      try {
        const text = await cloned.text();
        bodyPreview = text.length > 250 ? text.slice(0, 250) + '...' : text;
      } catch {
        bodyPreview = '(binary/unread)';
      }
      g.__sw_logs.push(`[SW FETCH RESPONSE] ${res.status} ${res.statusText} for ${url} | body: ${bodyPreview}`);
      return res;
    } catch (err: any) {
      g.__sw_logs.push(`[SW FETCH ERROR] ${url} -> ${err.message}`);
      throw err;
    }
  };
});
```

### C. Retrieving Service Worker Logs at Runtime

Whenever you want to inspect what the service worker has done (e.g. after clicking "Sync Now"), pull the array back to node:

```typescript
const swLogs: string[] = await background.evaluate(() => (globalThis as any).__sw_logs || []);
for (const log of swLogs) {
  console.log(log);
}
```

---

## 4. How to Take Pictures (Screenshots) of the Extension

Agents can take screenshots of both full pages, component elements, and toolbar popup views.

### A. Full Dashboard Screenshot

```typescript
import path from 'path';
import fs from 'fs';

const screenshotsDir = path.resolve(process.cwd(), 'screenshots');
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

const dashboardScreenshotPath = path.join(screenshotsDir, 'options-dashboard.png');
await optionsPage.screenshot({ path: dashboardScreenshotPath, fullPage: true });
console.log(`Saved screenshot to: ${dashboardScreenshotPath}`);
```

### B. Toolbar Popup Screenshot

Because browser extension action popups (`index.html`) have a constrained viewport in the browser toolbar, set the page viewport dimensions to simulate the toolbar popup before taking the picture:

```typescript
const popupPage = await context.newPage();
await popupPage.setViewportSize({ width: 380, height: 600 });
await popupPage.goto(`chrome-extension://${extensionId}/index.html`);
await popupPage.waitForLoadState('domcontentloaded');

const popupScreenshotPath = path.join(screenshotsDir, 'toolbar-popup.png');
await popupPage.screenshot({ path: popupScreenshotPath });
console.log(`Saved popup screenshot to: ${popupScreenshotPath}`);
```

### C. Individual Component Screenshot

You can capture specific components (like an assignment card, banner, or modal) by targeting the locator:

```typescript
const assignmentCard = optionsPage.locator('.assignment-card').first();
await assignmentCard.screenshot({ path: path.join(screenshotsDir, 'single-assignment-card.png') });
```

### D. Viewing Pictures in Agent Sessions

Once the PNG file is written to disk, the agent can immediately inspect it using the `view_file` tool:
```json
{
  "AbsolutePath": "D:\\ProgramFiles\\Projects\\Noodle\\apps\\extension\\screenshots\\toolbar-popup.png",
  "toolAction": "Inspect extension screenshot",
  "toolSummary": "View toolbar popup"
}
```
This renders the visual image directly in the agent's inspection context for verification.

---

## 5. End-to-End Autonomous Testing Pattern: Mocking Moodle & Testing Sync

When testing extension changes without requiring live TAU student credentials, agents should use the mock pattern established in `apps/extension/e2e/sync-devtools.spec.ts`:

1. **Seed Extension Storage**:
   ```typescript
   await optionsPage.evaluate(async () => {
     await chrome.storage.local.set({
       wstoken: 'MOCK_TOKEN',
       hasSeenTour: true,
       cachedSyncResult: { assignments: [], files: [], meetings: [], errors: [], syncedAt: new Date().toISOString() },
     });
     await chrome.storage.sync.set({
       trackedCourseIds: [101],
       settings: { theme: 'noodle', language: 'en', coursesColorMap: { 101: '#10b981' } },
     });
   });
   await optionsPage.reload();
   ```

2. **Intercept Moodle REST Web Services in Service Worker**:
   ```typescript
   await background.evaluate(() => {
     const g = globalThis as any;
     const origFetch = g.fetch;
     g.fetch = async (...args: any[]) => {
       const urlStr = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : String(args[0]));
       const parsed = new URL(urlStr, 'https://moodle.tau.ac.il');

       if (parsed.pathname.includes('/webservice/rest/server.php')) {
         const wsfunction = parsed.searchParams.get('wsfunction');
         if (wsfunction === 'core_webservice_get_site_info') {
           return new Response(JSON.stringify({ userid: 42, username: 'test_student', fullname: 'Israel Israeli' }), {
             headers: { 'Content-Type': 'application/json' },
           });
         }
         if (wsfunction === 'mod_assign_get_assignments') {
           return new Response(JSON.stringify({
             courses: [{ id: 101, assignments: [{ id: 1, name: 'Homework 1', duedate: Math.floor(Date.now() / 1000) + 86400 }] }]
           }), { headers: { 'Content-Type': 'application/json' } });
         }
       }
       return origFetch.apply(g, args);
     };
   });
   ```

3. **Trigger UI Action & Assert Feedback**:
   ```typescript
   const syncButton = optionsPage.locator('button.primary-btn.btn-sm').filter({ hasText: /Sync|🔄/ });
   await syncButton.click();

   // Assert UI renders the assignment card
   const card = optionsPage.locator('.assignment-card').filter({ hasText: 'Homework 1' });
   await expect(card).toBeVisible({ timeout: 10000 });

   // Assert Chrome local storage updated
   const storage = await optionsPage.evaluate(async () => chrome.storage.local.get('cachedSyncResult'));
   expect(storage.cachedSyncResult.assignments[0].name).toBe('Homework 1');
   ```

---

## 6. Summary Checklist for Agents Before Concluding

When introducing new extension features or debugging:
- [ ] Run `pnpm test:devtools` to confirm clean builds, console log execution, and screenshot capture.
- [ ] Verify there are zero `TypeError`, `Uncaught Exception`, or `[Page Error]` occurrences.
- [ ] Inspect generated screenshots in `apps/extension/screenshots/` using `view_file` to confirm layout integrity (RTL/LTR, themes, alignments).
- [ ] Ensure test coverage references `docs/TEST_CASES.md` (`TC-EXT-DEVTOOLS-01`, `TC-EXT-DEVTOOLS-02`).
- [ ] Verify that `pnpm test` runs with 100% pass rate across the monorepo.
