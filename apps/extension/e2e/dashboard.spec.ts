import { test, expect } from './fixtures.js';

test.describe('Category 3: Unified Assignments Dashboard UI', () => {
  test.beforeEach(async ({ optionsPage }) => {
    // Seed authenticated state with mock assignments
    const now = Date.now();
    await optionsPage.evaluate(async (currentTime) => {
      await chrome.storage.local.set({
        wstoken: 'MOCK_VALID_TOKEN',
        hasSeenTour: true,
        cachedSyncResult: {
          assignments: [
            {
              id: 101,
              cmid: 10,
              courseId: 1,
              courseName: 'מבני נתונים',
              name: 'תרגיל בית 1 - עצי חיפוש',
              status: 'Not submitted',
              deadline: new Date(currentTime + 24 * 3600 * 1000).toISOString(), // due in 1 day
              opened: null,
              link: 'https://moodle.tau.ac.il/mod/assign/view.php?id=10',
              grade: null,
              gradeMax: 100,
            },
            {
              id: 102,
              cmid: 20,
              courseId: 2,
              courseName: 'אלגברה לינארית',
              name: 'מטלה 3 - מרחבים וקטוריים',
              status: 'Not submitted',
              deadline: new Date(currentTime + 5 * 24 * 3600 * 1000).toISOString(), // due in 5 days
              opened: null,
              link: 'https://moodle.tau.ac.il/mod/assign/view.php?id=20',
              grade: null,
              gradeMax: 100,
            },
            {
              id: 103,
              cmid: 30,
              courseId: 1,
              courseName: 'מבני נתונים',
              name: 'מטלה 0 - חזרה על C++',
              status: 'Submitted',
              deadline: new Date(currentTime - 3 * 24 * 3600 * 1000).toISOString(), // submitted in the past
              opened: null,
              link: 'https://moodle.tau.ac.il/mod/assign/view.php?id=30',
              grade: 100,
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
        trackedCourseIds: [1, 2],
        settings: {
          theme: 'noodle',
          language: 'he',
          coursesColorMap: { 1: '#10b981', 2: '#6366f1' },
          coursesCustomNames: {},
          hiddenAssignments: [],
          completedAssignments: [],
          uncompletedAssignments: [],
        },
      });
    }, now);

    await optionsPage.reload();
    await optionsPage.waitForLoadState('domcontentloaded');
  });

  test('TC-ASN-10: Should spotlight the closest deadline in the "Next Up" banner', async ({ optionsPage }) => {
    // Next Up banner should be visible and spotlight Assignment 101
    const nextBanner = optionsPage.locator('.next-assignment-banner');
    await expect(nextBanner).toBeVisible();
    await expect(nextBanner).toContainText('תרגיל בית 1 - עצי חיפוש');
  });

  test('TC-ASN-07: Should filter assignments in real-time by search query', async ({ optionsPage }) => {
    const searchInput = optionsPage.locator('.search-input');
    await expect(searchInput).toBeVisible();

    // Type "לינארית"
    await searchInput.fill('לינארית');
    await expect(optionsPage.locator('.assignment-card')).toHaveCount(1);
    await expect(optionsPage.locator('.assignment-card')).toContainText('מרחבים וקטוריים');

    // Clear search
    await searchInput.clear();
    await expect(optionsPage.locator('.assignment-card')).toHaveCount(2); // 2 pending visible
  });

  test('TC-ASN-06: Should switch between status filter checkboxes (Pending / Past / Completed)', async ({ optionsPage }) => {
    // Filter checkboxes in dashboard
    const completedLabel = optionsPage.locator('label').filter({ hasText: /הושלמו|Completed/ });
    const pendingLabel = optionsPage.locator('label').filter({ hasText: /לביצוע|To Do/ });

    await expect(completedLabel).toBeVisible();

    // Check Completed and uncheck Pending
    await completedLabel.locator('input').check();
    await pendingLabel.locator('input').uncheck();

    // Now only the completed assignment should be displayed
    await expect(optionsPage.locator('.assignment-card')).toHaveCount(1);
    await expect(optionsPage.locator('.assignment-card')).toContainText('מטלה 0 - חזרה על C++');
  });

  test('TC-ASN-08: Should expand assignment accordion drawer on card click', async ({ optionsPage }) => {
    const firstCard = optionsPage.locator('.assignment-card').first();
    await expect(firstCard).toBeVisible();

    // Initially not expanded
    await expect(firstCard).not.toHaveClass(/expanded/);

    // Click to expand
    await firstCard.click();

    // Assert card has expanded class and subject drawer is open
    await expect(firstCard).toHaveClass(/expanded/);
    const subjectContainer = firstCard.locator('.expanded-subject-container');
    await expect(subjectContainer).toHaveClass(/open/);
    await expect(firstCard.locator('.subject-pill')).toBeVisible();
  });
});
