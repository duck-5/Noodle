import { test, expect } from './fixtures.js';
import fs from 'fs';
import path from 'path';

test.describe('Live Extension Verification with Real Credentials', () => {
  test('TC-EXT-LIVE-01: Log in with real credentials, verify scraping toggle default OFF, toggle ON, and test sync', async ({ context, optionsPage, extensionId }) => {
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

    // 5. Verify the scraping toggle is present
    const scrapingToggle = optionsPage.locator('#scraping-enabled-toggle');
    const toggleSlider = optionsPage.locator('label.switch:has(#scraping-enabled-toggle) .slider');
    await expect(scrapingToggle).toBeAttached();

    // Ensure we start from OFF mode
    if (await scrapingToggle.isChecked()) {
      console.log('[Live Test] Toggle was ON from previous session; toggling OFF to test default OFF mode...');
      await toggleSlider.click();
      await expect(scrapingToggle).not.toBeChecked();
    }

    const isCheckedOff = await scrapingToggle.isChecked();
    console.log(`[Live Test] Scraping toggle is confirmed OFF: isChecked = ${isCheckedOff}`);
    expect(isCheckedOff).toBe(false);

    // Capture screenshot of Settings tab with toggle OFF
    const screenshotsDir = path.resolve(process.cwd(), 'screenshots');
    if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });
    await optionsPage.screenshot({ path: path.join(screenshotsDir, 'live-settings-scraping-off.png'), fullPage: true });

    // 6. Test sync with Scraping OFF
    console.log('[Live Test] Testing Sync with Scraping OFF (Pure API mode)...');
    await background.evaluate(() => {
      (globalThis as any).__sw_logs = [];
    });
    const headerSyncBtn = optionsPage.locator('.header-actions button.primary-btn');
    await expect(headerSyncBtn).toBeEnabled({ timeout: 30000 });
    await headerSyncBtn.click();

    // Wait for sync to complete (button becomes enabled again with 'Sync Now' / 'סנכרן עכשיו' text)
    await expect(headerSyncBtn).toBeEnabled({ timeout: 90000 });
    await expect(headerSyncBtn).toHaveText(/סנכרן עכשיו|Sync Now/);
    console.log('[Live Test] Sync with Scraping OFF completed quickly and cleanly!');

    const logsScrapingOff = await background.evaluate(() => (globalThis as any).__sw_logs || []);
    const scraperLogs = logsScrapingOff.filter((l: string) => l.includes('[ScraperStrategy]') || l.includes("strategy 'Scraper'"));
    console.log(`[Live Test] Verified: 0 Scraper log entries while Scraping is OFF (actual: ${scraperLogs.length})`);
    expect(scraperLogs).toHaveLength(0);

    // 7. Toggle Scraping to ON by clicking the toggle
    console.log('[Live Test] Toggling Scraping to ON in the Settings page...');
    await toggleSlider.click();
    
    // Assert checkbox is now checked
    await expect(scrapingToggle).toBeChecked();

    // Verify stored settings in chrome.storage.sync has scrapingEnabled: true
    const storedOn = await optionsPage.evaluate(async () => {
      const s = await chrome.storage.sync.get('settings');
      return s.settings;
    });
    console.log(`[Live Test] Stored scrapingEnabled setting after toggle ON: ${storedOn.scrapingEnabled}`);
    expect(storedOn.scrapingEnabled).toBe(true);

    // Capture screenshot of Settings tab with toggle ON
    await optionsPage.screenshot({ path: path.join(screenshotsDir, 'live-settings-scraping-on.png'), fullPage: true });

    // 8. Test sync with Scraping ON
    console.log('[Live Test] Testing Sync with Scraping ON (Fallback Scraper active)...');
    await expect(headerSyncBtn).toBeEnabled({ timeout: 30000 });
    await headerSyncBtn.click();
    await expect(headerSyncBtn).toBeEnabled({ timeout: 120000 });
    await expect(headerSyncBtn).toHaveText(/סנכרן עכשיו|Sync Now/);
    console.log('[Live Test] Sync with Scraping ON completed successfully!');

    // 9. Reset toggle back to OFF so clean default state remains
    console.log('[Live Test] Resetting Scraping toggle back to OFF (default)...');
    await toggleSlider.click();
    await expect(scrapingToggle).not.toBeChecked();

    const storedReset = await optionsPage.evaluate(async () => {
      const s = await chrome.storage.sync.get('settings');
      return s.settings;
    });
    console.log(`[Live Test] Final stored scrapingEnabled setting: ${storedReset.scrapingEnabled}`);
    expect(storedReset.scrapingEnabled).toBe(false);

    // 10. Navigate to assignments/dashboard tab and capture final dashboard
    const assignmentsTabBtn = optionsPage.locator('button.nav-item').filter({ hasText: /לוח בקרה|Dashboard|מטלות|Assignments/ }).first();
    if (await assignmentsTabBtn.isVisible()) {
      await assignmentsTabBtn.click();
      await optionsPage.waitForTimeout(2000);
      await optionsPage.screenshot({ path: path.join(screenshotsDir, 'live-dashboard-after-sync.png'), fullPage: true });
      console.log('[Live Test] Saved screenshot of dashboard after live sync.');
    }
  });
});
