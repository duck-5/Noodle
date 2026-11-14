import { test, expect } from './fixtures.js';
import fs from 'fs';
import path from 'path';

test.describe('Live Extension Verification with Real Credentials', () => {
  test('TC-EXT-LIVE-01: Log in with real credentials, verify legacy scraping toggle removed, and test pure API sync', async ({ context, optionsPage, extensionId }) => {
    test.setTimeout(360000); // 6 minutes timeout for full real network & SSO requests
    await optionsPage.setViewportSize({ width: 1280, height: 900 });

    // 1. Read real credentials from moodle_test_credentials.env
    const envPath = path.resolve(process.cwd(), '../../moodle_test_credentials.env');
    const rootEnvPath = path.resolve(process.cwd(), 'moodle_test_credentials.env');
    const targetEnvPath = fs.existsSync(envPath) ? envPath : (fs.existsSync(rootEnvPath) ? rootEnvPath : null);

    if (!targetEnvPath) {
      test.skip(!targetEnvPath, 'moodle_test_credentials.env not found');
      return;
    }

    const envContent = fs.readFileSync(targetEnvPath, 'utf-8');
    const userMatch = envContent.match(/MOODLE_TESTING_USERNAME=(.*)/);
    const idMatch = envContent.match(/MOODLE_TESTING_ID=(.*)/);
    const passMatch = envContent.match(/MOODLE_TESTING_PASSWORD=(.*)/);

    if (!userMatch || !idMatch || !passMatch) {
      test.skip(true, 'Incomplete credentials in moodle_test_credentials.env');
      return;
    }

    const username = userMatch[1].trim();
    const idNumber = idMatch[1].trim();
    const password = passMatch[1].trim();

    console.log(`[Live Test] Authenticating user "${username}" in the Chrome extension...`);

        let [background] = context.serviceWorkers();
    if (!background) {
      background = await context.waitForEvent('serviceworker', { timeout: 10000 });
    }

    await background.evaluate(() => {
      const g = globalThis as any;
      g.__sw_logs = g.__sw_logs || [];
      const origLog = console.log;
      console.log = (...args: any[]) => {
        g.__sw_logs.push(args.map(String).join(' '));
        origLog.apply(console, args);
      };
      const origWarn = console.warn;
      console.warn = (...args: any[]) => {
        g.__sw_logs.push(args.map(String).join(' '));
        origWarn.apply(console, args);
      };
    });

    // 2. Locate inputs and log in
    const usernameInput = optionsPage.locator('input[type="text"]').first();
    const idInput = optionsPage.locator('input[type="text"]').nth(1);
    const passwordInput = optionsPage.locator('input[type="password"]');
    const submitBtn = optionsPage.locator('button[type="submit"]');

    await expect(usernameInput).toBeVisible({ timeout: 10000 });
    await usernameInput.fill(username);
    await idInput.fill(idNumber);
    await passwordInput.fill(password);

    await submitBtn.click();
    console.log('[Live Test] Submitted login form. Waiting for SSO / dashboard...');

    // 3. Handle possible Onboarding Step 2 ("Select Courses to Track") or direct dashboard
    const onboardingHeader = optionsPage.locator('h2').filter({ hasText: /בחר קורסים למעקב|Select Courses to Track/ });
    const dashboardNav = optionsPage.locator('nav.sidebar-nav, .dashboard-layout');

    console.log('[Live Test] Waiting for login / SSO completion...');
    await expect(onboardingHeader.or(dashboardNav.first())).toBeVisible({ timeout: 90000 });

    if (await onboardingHeader.isVisible()) {
      console.log('[Live Test] Reached Onboarding Course Selection view.');
      const courseCard = optionsPage.locator('.course-selection-item').first();
      await expect(courseCard).toBeVisible({ timeout: 30000 });
      console.log('[Live Test] Selecting first course for tracking...');
      await courseCard.click();

      const startTrackingBtn = optionsPage.locator('button.primary-btn').filter({ hasText: /התחל מעקב|Start Tracking/ });
      await expect(startTrackingBtn).toBeEnabled({ timeout: 15000 });
      console.log('[Live Test] Clicking "Start Tracking" button...');
      await startTrackingBtn.click();
    }

    // Now wait for main dashboard
    await expect(dashboardNav.first()).toBeVisible({ timeout: 60000 });
    console.log('[Live Test] Successfully reached the Main Dashboard!');

    // Wait for any initial background sync to settle
    const syncStatusBadge = optionsPage.locator('.content-header .subtitle').filter({ hasText: /Syncing|מסנכרן/ });
    if (await syncStatusBadge.isVisible()) {
      console.log('[Live Test] Waiting for initial background sync to settle...');
      await expect(syncStatusBadge).not.toBeVisible({ timeout: 90000 });
    }

    // Dismiss tour if present
    const skipTourBtn = optionsPage.locator('.tour-overlay button').filter({ hasText: /דלג|Skip/ });
    if (await skipTourBtn.isVisible()) {
      console.log('[Live Test] Dismissing product tour...');
      await skipTourBtn.click();
      await expect(optionsPage.locator('.tour-overlay')).not.toBeVisible();
    }

    // 4. Navigate to Settings tab
    const settingsTabBtn = optionsPage.locator('button.nav-item').filter({ hasText: /הגדרות|Settings/ });
    await expect(settingsTabBtn).toBeVisible({ timeout: 15000 });
    await settingsTabBtn.click();
    console.log('[Live Test] Navigated to Settings tab.');

    // 5. Verify the legacy scraping toggle was removed from Settings UI
    const scrapingToggle = optionsPage.locator('#scraping-enabled-toggle');
    await expect(scrapingToggle).toHaveCount(0);

    const screenshotsDir = path.resolve(process.cwd(), 'screenshots');
    if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });
    await optionsPage.screenshot({ path: path.join(screenshotsDir, 'live-settings.png'), fullPage: true });

    // 6. Test pure API sync (no legacy HTML scraping fallback)
    console.log('[Live Test] Testing Pure API Sync...');
    await background.evaluate(() => {
      (globalThis as any).__sw_logs = [];
    });
    const headerSyncBtn = optionsPage.locator('.header-actions button.primary-btn');
    await expect(headerSyncBtn).toBeEnabled({ timeout: 30000 });
    await headerSyncBtn.click();

    // Wait for sync to complete (button becomes enabled again with 'Sync Now' / 'סנכרן עכשיו' text)
    await expect(headerSyncBtn).toBeEnabled({ timeout: 90000 });
    await expect(headerSyncBtn).toHaveText(/סנכרן עכשיו|Sync Now/);
    console.log('[Live Test] Pure API Sync completed cleanly!');

    const logsSync = await background.evaluate(() => (globalThis as any).__sw_logs || []);
    const scraperLogs = logsSync.filter((l: string) => l.includes('[ScraperStrategy]') || l.includes("strategy 'Scraper'"));
    console.log(`[Live Test] Verified: 0 legacy Scraper log entries (actual: ${scraperLogs.length})`);
    expect(scraperLogs).toHaveLength(0);

    const storedSettings = await optionsPage.evaluate(async () => {
      const s = await chrome.storage.sync.get('settings');
      return s.settings;
    });
    expect(Boolean(storedSettings?.scrapingEnabled)).toBe(false);

    // 7. Navigate to assignments/dashboard tab and capture final dashboard
    const assignmentsTabBtn = optionsPage.locator('button.nav-item').filter({ hasText: /לוח בקרה|Dashboard|מטלות|Assignments/ }).first();
    if (await assignmentsTabBtn.isVisible()) {
      await assignmentsTabBtn.click();
      await optionsPage.waitForTimeout(2000);
      await optionsPage.screenshot({ path: path.join(screenshotsDir, 'live-dashboard-after-sync.png'), fullPage: true });
      console.log('[Live Test] Saved screenshot of dashboard after live sync.');
    }
  });
});
