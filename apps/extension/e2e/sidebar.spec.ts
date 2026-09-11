import { test, expect } from './fixtures.js';

test.describe('Category 13: Extension Specials (TC-EXT-02, TC-AUTH-06)', () => {
  test.beforeEach(async ({ optionsPage }) => {
    // Seed authenticated state
    await optionsPage.evaluate(async () => {
      await chrome.storage.local.set({
        wstoken: 'MOCK_VALID_TOKEN',
        hasSeenTour: true,
        cachedSyncResult: {
          assignments: [],
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

  test('TC-EXT-02: Should toggle collapsible sidebar width', async ({ optionsPage }) => {
    const sidebar = optionsPage.locator('aside.sidebar');
    await expect(sidebar).toBeVisible();

    const collapseBtn = optionsPage.locator('.collapse-toggle-btn');
    await expect(collapseBtn).toBeVisible();

    // Toggle collapse
    await collapseBtn.click();
    await expect(sidebar).toHaveClass(/collapsed/);

    // Toggle expand
    await collapseBtn.click();
    await expect(sidebar).not.toHaveClass(/collapsed/);
  });

  test('TC-AUTH-06: Should handle disconnect/logout and return to login screen', async ({ optionsPage }) => {
    const disconnectBtn = optionsPage.locator('.danger-text');
    await expect(disconnectBtn).toBeVisible();

    await disconnectBtn.click();

    // Modal confirmation
    const confirmBtn = optionsPage.locator('.modal-actions button.danger-btn, .modal-actions button.primary-btn').first();
    if (await confirmBtn.isVisible()) {
      await confirmBtn.click();
    }

    // Should return to onboarding/login container
    const loginTitle = optionsPage.locator('.logo-section h1');
    await expect(loginTitle).toBeVisible();
    await expect(loginTitle).toHaveText('Noodle');
  });
});
