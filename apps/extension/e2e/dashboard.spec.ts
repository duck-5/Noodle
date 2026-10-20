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
    // Navigate to dedicated Assignments tab
    await optionsPage.locator('.nav-item').filter({ hasText: /מטלות|Assignments/ }).click();

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
    // Navigate to dedicated Assignments tab
    await optionsPage.locator('.nav-item').filter({ hasText: /מטלות|Assignments/ }).click();

    // Filter checkboxes in assignments tab
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
    // Navigate to dedicated Assignments tab
    await optionsPage.locator('.nav-item').filter({ hasText: /מטלות|Assignments/ }).click();

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

    // Capture screenshot of expanded assignment card
    await optionsPage.screenshot({ path: 'screenshots/assignments-page-expanded.png' });
  });

  test('TC-ASN-09: Should navigate from course row "מטלות" to filtered assignments and allow clearing filter', async ({ optionsPage }) => {
    // 1. Locate the first course row card ('מבני נתונים', courseId: 1)
    const firstCourseCard = optionsPage.locator('.course-row-card').first();
    await expect(firstCourseCard).toBeVisible();

    // 2. Click the "מטלות" button inside the course row
    const viewAssignsBtn = firstCourseCard.locator('button').filter({ hasText: /מטלות|Assignments/ });
    await viewAssignsBtn.click();

    // 3. Should now be on Assignments tab with course filter banner
    const filterBanner = optionsPage.locator('.course-filter-banner');
    await expect(filterBanner).toBeVisible();
    await expect(filterBanner).toContainText('מבני נתונים');

    // 4. Assignments displayed should only be for this course (course 1 has 1 pending assignment in seed: "תרגיל בית 1 - עצי חיפוש")
    await expect(optionsPage.locator('.assignment-card')).toHaveCount(1);
    await expect(optionsPage.locator('.assignment-card')).toContainText('תרגיל בית 1 - עצי חיפוש');

    // Capture screenshot of filtered assignments page
    await optionsPage.screenshot({ path: 'screenshots/assignments-page-filtered.png' });

    // 5. Clear filter
    await filterBanner.locator('button').click();
    await expect(filterBanner).toBeHidden();
    // Now both pending assignments (course 1 and course 2) are visible
    await expect(optionsPage.locator('.assignment-card')).toHaveCount(2);
  });

  test('TC-DASH-REHAUL-01: Should expand course row on click and show Zoom links & next assignments', async ({ optionsPage }) => {
    // 1. Locate the first course row card
    const firstCourseCard = optionsPage.locator('.course-row-card').first();
    await expect(firstCourseCard).toBeVisible();

    // 2. Click the card to expand
    await firstCourseCard.click();

    // 3. Expanded panel should be visible
    const expandedPanel = firstCourseCard.locator('.course-expanded-panel');
    await expect(expandedPanel).toBeVisible();

    // 4. Check for next assignments section inside expanded panel
    await expect(expandedPanel.locator('.course-mini-assign-item').first()).toBeVisible();

    // Take screenshot of expanded course
    await optionsPage.screenshot({ path: 'screenshots/dashboard-course-expanded.png' });
  });

  test('TC-DASH-REHAUL-02: Upcoming To-Do queue excludes completed tasks and shows expandable cards', async ({ optionsPage }) => {
    // 1. Check queue card exists
    const queueCard = optionsPage.locator('.queue-card');
    await expect(queueCard).toBeVisible();

    // 2. The completed assignment (מטלה 0 - חזרה על C++) must NOT be in the queue
    await expect(queueCard).not.toContainText('מטלה 0 - חזרה על C++');

    // 3. Pending assignment should be visible in the queue
    const queueItem = queueCard.locator('.queue-item').first();
    await expect(queueItem).toBeVisible();

    // 4. Click queue item to expand
    await queueItem.click();
    await expect(queueItem.locator('.queue-item-expanded')).toHaveClass(/open/);
  });

  test('TC-DASH-REHAUL-03: Manage courses modal opens from dashboard and groups courses', async ({ optionsPage }) => {
    // 1. Click manage courses button
    const manageBtn = optionsPage.locator('.manage-courses-trigger-btn');
    await expect(manageBtn).toBeVisible();
    await manageBtn.click();

    // 2. Modal backdrop and table should appear
    const modalBackdrop = optionsPage.locator('.modal-backdrop');
    await expect(modalBackdrop).toBeVisible();
    await expect(modalBackdrop.locator('.courses-settings-table').first()).toBeVisible();

    // Take screenshot of manage courses modal
    await optionsPage.screenshot({ path: 'screenshots/dashboard-manage-modal.png' });

    // 3. Close modal
    await modalBackdrop.locator('button').first().click();
    await expect(modalBackdrop).toBeHidden();
  });

  test('TC-DASH-REHAUL-04: Coffee theme switches and displays warm dark brown styling', async ({ optionsPage }) => {
    // 1. Set theme to coffee
    await optionsPage.evaluate(async () => {
      const data = await chrome.storage.sync.get('settings');
      const settings = data.settings || {};
      settings.theme = 'coffee';
      await chrome.storage.sync.set({ settings });
    });
    await optionsPage.reload();
    await optionsPage.waitForLoadState('domcontentloaded');

    // 2. Assert body has theme-coffee class
    await expect(optionsPage.locator('body')).toHaveClass(/theme-coffee/);

    // Take screenshot of coffee theme
    await optionsPage.screenshot({ path: 'screenshots/dashboard-coffee-theme.png' });
  });
});
