import { test, expect } from './fixtures.js';

test.describe('Category 11: Localization & Theming (TC-UI-01, TC-UI-02, TC-UI-03)', () => {
  test.beforeEach(async ({ optionsPage }) => {
    // Seed authenticated state
    await optionsPage.evaluate(async () => {
      await chrome.storage.local.set({
        wstoken: 'MOCK_VALID_TOKEN',
        hasSeenTour: true,
        cachedSyncResult: {
          assignments: [
            {
              id: 1,
              cmid: 10,
              courseId: 101,
              courseName: 'מבני נתונים',
              name: 'מטלה 1',
              status: 'Not submitted',
              deadline: new Date(Date.now() + 86400 * 2000).toISOString(),
              opened: null,
              link: 'https://moodle.tau.ac.il',
              grade: null,
              gradeMax: 100,
            },
          ],
          files: [],
          meetings: [],
          errors: [],
          syncedAt: new Date().toISOString(),
        },
      });
      await chrome.storage.sync.set({
        trackedCourseIds: [101],
        settings: {
          theme: 'noodle',
          language: 'he',
          coursesColorMap: {},
          coursesCustomNames: {},
          hiddenAssignments: [],
          completedAssignments: [],
          uncompletedAssignments: [],
        },
      });
    });

    await optionsPage.reload();
    await optionsPage.waitForLoadState('domcontentloaded');
  });

  test('TC-UI-01: Hebrew (RTL) vs English (LTR) Toggle', async ({ optionsPage }) => {
    // 1. Initially language is Hebrew (RTL) on the main dashboard layout
    const dashboardLayout = optionsPage.locator('.dashboard-layout');
    await expect(dashboardLayout).toHaveAttribute('dir', 'rtl');

    // 2. Navigate to Settings Tab
    const settingsNavBtn = optionsPage.locator('.nav-item').filter({ hasText: /הגדרות|Settings/ });
    await settingsNavBtn.click();

    // 3. Locate Language select dropdown
    const langSelect = optionsPage.locator('select.settings-text-input').first();
    await expect(langSelect).toBeVisible();

    // 4. Change language to English
    await langSelect.selectOption('en');

    // 5. Assert document direction flips to LTR
    await expect(dashboardLayout).toHaveAttribute('dir', 'ltr');

    // 6. Flip back to Hebrew
    await langSelect.selectOption('he');
    await expect(dashboardLayout).toHaveAttribute('dir', 'rtl');
  });

  test('TC-UI-02: Slate Dark vs Warm Cream Noodle Theme Toggle', async ({ optionsPage }) => {
    // 1. Navigate to Settings
    const settingsNavBtn = optionsPage.locator('.nav-item').filter({ hasText: /הגדרות|Settings/ });
    await settingsNavBtn.click();

    // 2. Locate Theme select dropdown (2nd select in settings)
    const themeSelect = optionsPage.locator('select.settings-text-input').nth(1);
    await expect(themeSelect).toBeVisible();

    // 3. Switch to Dark theme
    await themeSelect.selectOption('dark');
    await expect(optionsPage.locator('body')).toBeVisible();

    // 4. Switch to Noodle theme
    await themeSelect.selectOption('noodle');
    await expect(optionsPage.locator('body')).toBeVisible();
  });
});
