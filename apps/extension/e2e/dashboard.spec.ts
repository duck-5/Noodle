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
          coursesColorMap: { 1: '#e07a5f', 2: '#a0613e' },
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
    // Closest task should be highlighted with metallic wave in the upcoming queue
    const closestTask = optionsPage.locator('.queue-item.closest-metallic-wave');
    await expect(closestTask).toBeVisible();
    await expect(closestTask).toContainText('תרגיל בית 1 - עצי חיפוש');
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

  test('TC-DASH-REHAUL-01: Should navigate to course detail on course card click', async ({ optionsPage }) => {
    // 1. Locate the first course row card
    const firstCourseCard = optionsPage.locator('.course-row-card').first();
    await expect(firstCourseCard).toBeVisible();

    // 2. Click the card to navigate to detail view
    await firstCourseCard.click();

    // 3. Course detail view should be visible
    await expect(optionsPage.locator('.course-detail-view')).toBeVisible();

    // Take screenshot of detail view
    await optionsPage.screenshot({ path: 'screenshots/dashboard-course-expanded.png' });
  });

  test('TC-DASH-REHAUL-02: Upcoming To-Do queue excludes completed tasks, opens split detail pane with course-colored border, and dismisses tasks to hidden list', async ({ optionsPage }) => {
    // 1. Check queue card exists
    const queueCard = optionsPage.locator('.queue-card');
    await expect(queueCard).toBeVisible();

    // 2. The completed assignment (מטלה 0 - חזרה על C++) must NOT be in the queue
    await expect(queueCard).not.toContainText('מטלה 0 - חזרה על C++');

    // 3. Pending assignment should be visible in the queue with a Trash dismiss button
    const queueItem = queueCard.locator('.queue-item').first();
    await expect(queueItem).toBeVisible();

    const deleteBtn = queueItem.locator('.queue-delete-btn');
    await expect(deleteBtn).toBeVisible();
    await expect(deleteBtn.locator('svg')).toBeVisible();

    // 4. Click queue item to open the side-by-side split detail pane inside the queue card
    await queueItem.click();
    await expect(queueCard).toHaveClass(/is-split/);
    const detailPane = queueCard.locator('.queue-detail-pane.queue-item-expanded');
    await expect(detailPane).toBeVisible();
    await expect(detailPane).toHaveClass(/open/);
    await expect(detailPane.locator('.queue-detail-title')).toContainText('תרגיל בית 1 - עצי חיפוש');

    // 5. Verify the detail pane has the course's color applied to its border
    const borderColor = await detailPane.evaluate((el) => (el as HTMLElement).style.borderColor);
    expect(borderColor).toBeTruthy();

    // 6. Clicking the close button closes the detail pane
    await detailPane.locator('.queue-detail-close-btn').click();
    await expect(queueCard).not.toHaveClass(/is-split/);
    await expect(detailPane).toBeHidden();

    // 7. Clicking the Trash button dismisses the task from the queue without opening the split pane
    await deleteBtn.click();
    await expect(queueCard).not.toHaveClass(/is-split/);
    await expect(queueCard).not.toContainText('תרגיל בית 1 - עצי חיפוש');
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

  test('TC-DASH-REHAUL-09: Hidden tasks are excluded from the course card gaps count', async ({ optionsPage }) => {
    // 1. Initial state: Course 1 has Assignment 101 (pending) and Assignment 103 (submitted)
    const firstCourseCard = optionsPage.locator('.course-row-card').first();
    await expect(firstCourseCard).toBeVisible();

    // Verify initial breakdown: (1/2) and 1 pending assignment gap
    const gapStat = firstCourseCard.locator('.course-stat-gap').first();
    await expect(gapStat).toContainText(/מטלות:\s*1|Assignments:\s*1/);
    await expect(firstCourseCard.locator('.course-prog-percent, .stat-count').first()).toContainText('1/2');

    // 2. Hide Assignment 101 via settings
    await optionsPage.evaluate(async () => {
      const data = await chrome.storage.sync.get('settings');
      const settings = data.settings || {};
      settings.hiddenAssignments = [101];
      await chrome.storage.sync.set({ settings });
    });
    await optionsPage.reload();
    await optionsPage.waitForLoadState('domcontentloaded');

    // 3. Verify Course 1 breakdown now reflects only visible tasks: (1/1) and 0 gaps
    const updatedCard = optionsPage.locator('.course-row-card').first();
    await expect(updatedCard).toBeVisible();
    const updatedGapStat = updatedCard.locator('.course-stat-gap').first();
    await expect(updatedGapStat).toContainText(/מטלות:\s*0|Assignments:\s*0/);
    await expect(updatedCard.locator('.course-prog-percent, .stat-count').first()).toContainText('1/1');
  });

  test('TC-DASH-REHAUL-08: Toggling to cards view switches to responsive card grid and horizontal 2-section layout', async ({ optionsPage }) => {
    // 1. Check segmented view mode buttons exist
    const viewModeGroup = optionsPage.locator('.view-mode-toggle-group');
    await expect(viewModeGroup).toBeVisible();

    // 2. Click "Cards" button
    const cardsBtn = viewModeGroup.locator('.view-mode-btn').filter({ hasText: /כרטיסים|Cards/ });
    await expect(cardsBtn).toBeVisible();
    await cardsBtn.click();
    await expect(cardsBtn).toHaveClass(/active/);

    // 3. Courses container should receive .courses-cards-grid
    const coursesContainer = optionsPage.locator('.courses-rows-container');
    await expect(coursesContainer).toHaveClass(/courses-cards-grid/);

    // 4. Course card should have the 3-row layout
    const firstCard = coursesContainer.locator('.course-grid-card').first();
    await expect(firstCard).toBeVisible();
    await expect(firstCard.locator('.course-card-row-top')).toBeVisible();
    await expect(firstCard.locator('.course-card-row-middle')).toBeVisible();
    await expect(firstCard.locator('.course-card-row-bottom')).toBeVisible();

    // 5. Card click navigates directly to course detail view
    await firstCard.click();
    await expect(optionsPage.locator('.course-detail-view')).toBeVisible();
    await optionsPage.locator('.back-btn').click();

    // 6. Switch back to list view
    const listBtn = viewModeGroup.locator('.view-mode-btn').filter({ hasText: /רשימה|List/ });
    await listBtn.click();
    await expect(coursesContainer).not.toHaveClass(/courses-cards-grid/);
  });

  test('TC-EXT-03: 10-step Interactive Onboarding Tour walks all slides with SVG icons and highlights targets without auto-opening modal', async ({ optionsPage }) => {
    const emojiRegex = /[\p{Extended_Pictographic}]/u;

    // 1. Verify the Take Tour button sits directly below Collapse Sidebar in the sidebar nav and launches the tour
    const collapseBtn = optionsPage.locator('.sidebar-nav .collapse-toggle-btn');
    const sidebarTourBtn = optionsPage.locator('.sidebar-nav .sidebar-tour-btn');
    await expect(collapseBtn).toBeVisible();
    await expect(sidebarTourBtn).toBeVisible();

    const collapseIndex = await optionsPage.locator('.sidebar-nav .nav-item').evaluateAll((els) => {
      const collapseIdx = els.findIndex((el) => el.classList.contains('collapse-toggle-btn'));
      const tourIdx = els.findIndex((el) => el.classList.contains('sidebar-tour-btn'));
      return { collapseIdx, tourIdx };
    });
    expect(collapseIndex.collapseIdx).toBeGreaterThanOrEqual(0);
    expect(collapseIndex.tourIdx).toBe(collapseIndex.collapseIdx + 1);

    await sidebarTourBtn.click();

    const tourCard = optionsPage.locator('.tour-card');
    await expect(tourCard).toBeVisible();
    await optionsPage.locator('.tour-card .tour-close-btn').click();
    await expect(tourCard).toBeHidden();

    // 2. Also verify relaunching from About tab's Interactive Tour card works
    await optionsPage.locator('.sidebar-nav .nav-item').filter({ hasText: /אודות|About/ }).click();
    const tourLaunchCard = optionsPage.locator('.card-accent-tour');
    await expect(tourLaunchCard).toBeVisible();
    await tourLaunchCard.click();

    await expect(tourCard).toBeVisible();

    const stepIndicator = tourCard.locator('.tour-step-indicator');
    const nextBtn = tourCard.locator('.tour-footer .primary-btn');

    const assertNoEmojiAndSvgBadge = async (expectedStep: number) => {
      await expect(stepIndicator).toHaveText(`${expectedStep} / 10`);
      await expect(tourCard.locator('.tour-icon-badge svg')).toBeVisible();
      const cardText = (await tourCard.textContent()) || '';
      expect(emojiRegex.test(cardText)).toBe(false);
    };

    // Step 1 (index 0): Welcome
    await assertNoEmojiAndSvgBadge(1);
    await nextBtn.click();

    // Step 2 (index 1): Header Sync
    await assertNoEmojiAndSvgBadge(2);
    await expect(optionsPage.locator('.header-sync-btn.tour-highlight')).toBeVisible();
    await nextBtn.click();

    // Step 3 (index 2): Action Strip (To-Do Queue, Split Pane & Catch-Up)
    await assertNoEmojiAndSvgBadge(3);
    await expect(optionsPage.locator('.hero-action-strip.tour-highlight')).toBeVisible();
    await nextBtn.click();

    // Step 4 (index 3): Active Zoom & Dashboard Cards/Gaps
    await assertNoEmojiAndSvgBadge(4);
    await expect(optionsPage.locator('.course-row-card.tour-highlight, .multi-zoom-strip.tour-highlight').first()).toBeVisible();
    await nextBtn.click();

    // Step 5 (index 4): Manage Courses & Staff Mapping (highlight button only, NO modal auto-open)
    await assertNoEmojiAndSvgBadge(5);
    await expect(optionsPage.locator('.courses-list-header.tour-highlight')).toBeVisible();
    await expect(optionsPage.locator('.manage-courses-trigger-btn.pulse-btn')).toBeVisible();
    await expect(optionsPage.locator('.manage-courses-modal')).toHaveCount(0);
    await nextBtn.click();

    // Step 6 (index 5): Course Hub, ZIP Folders & Host Tracking
    await assertNoEmojiAndSvgBadge(6);
    await expect(optionsPage.locator('.course-detail-view.tour-highlight')).toBeVisible();
    await nextBtn.click();

    // Step 7 (index 6): Assignments Hub
    await assertNoEmojiAndSvgBadge(7);
    await expect(optionsPage.locator('.tab-assignments .filter-bar.tour-highlight')).toBeVisible();
    await nextBtn.click();

    // Step 8 (index 7): Grades & GPA Tracker
    await assertNoEmojiAndSvgBadge(8);
    await expect(optionsPage.locator('.tab-grades .stat-card.tour-highlight')).toBeVisible();
    await nextBtn.click();

    // Step 9 (index 8): Local Folder Sync, Google Tasks & Settings
    await assertNoEmojiAndSvgBadge(9);
    await expect(optionsPage.locator('.google-tasks-section.tour-highlight')).toBeVisible();
    await expect(optionsPage.locator('.local-fs-section.tour-highlight')).toBeVisible();
    await nextBtn.click();

    // Step 10 (index 9): Finish on About tab
    await assertNoEmojiAndSvgBadge(10);
    await expect(optionsPage.locator('.tab-about.tour-highlight')).toBeVisible();

    // Finish tour -> closes overlay and returns to Dashboard
    await nextBtn.click();
    await expect(tourCard).toBeHidden();
    await expect(optionsPage.locator('.tab-dashboard')).toBeVisible();
  });

  test('TC-EXT-05: Sidebar new-version banner pops up when store has newer version, adapts on collapse, and persists dismiss', async ({ optionsPage }) => {
    // Wait for initial Dashboard boot & drain any in-flight store check (on online CI,
    // initial CHECK_STORE_UPDATE fetches the live store and would otherwise race with seeding).
    await expect(optionsPage.locator('.collapse-toggle-btn')).toBeVisible();

    // Seed a store update check result with a version higher than the current manifest version
    await optionsPage.evaluate(async () => {
      await new Promise<void>((resolve) => {
        try {
          chrome.runtime.sendMessage({ type: 'CHECK_STORE_UPDATE', force: false }, () => resolve());
        } catch {
          resolve();
        }
      });

      const currentVersion = chrome.runtime.getManifest().version;
      await chrome.storage.local.remove('dismissedUpdateVersion');
      await chrome.storage.local.set({
        storeUpdateStatus: {
          store: 'chrome',
          storeUrl: 'https://chromewebstore.google.com/detail/noodle/nelflkccefbdpnaphjabcgkpakhdoope',
          currentVersion,
          latestVersion: '99.0.0',
          updateAvailable: true,
          checkedAt: Date.now(),
          checkedForVersion: currentVersion,
          source: 'cws-crx',
        },
      });
    });

    const banner = optionsPage.locator('.sidebar-update-banner');
    await expect(banner).toBeVisible();
    await expect(banner.locator('.sidebar-update-versions')).toContainText('v99.0.0');

    const ctaLink = banner.locator('a.sidebar-update-cta');
    await expect(ctaLink).toBeVisible();
    await expect(ctaLink).toHaveAttribute(
      'href',
      'https://chromewebstore.google.com/detail/noodle/nelflkccefbdpnaphjabcgkpakhdoope'
    );

    // Collapsing sidebar switches banner into compact circular link mode
    await optionsPage.locator('.collapse-toggle-btn').click();
    await expect(banner.locator('a.sidebar-update-compact')).toBeVisible();
    await optionsPage.locator('.collapse-toggle-btn').click();
    await expect(ctaLink).toBeVisible();

    // Dismissing banner hides it and persists across reloads
    await banner.locator('.sidebar-update-dismiss').click();
    await expect(banner).toBeHidden();

    await optionsPage.reload();
    await optionsPage.waitForLoadState('domcontentloaded');
    await expect(optionsPage.locator('.sidebar-update-banner')).toBeHidden();
  });

  test('TC-REC-TAB-01: Recordings tab filters, dismiss/restore drawer, and weekly/monthly calendar with cross-overlay', async ({ optionsPage }) => {
    const now = new Date();
    const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    await optionsPage.evaluate(async (dateKey) => {
      const localData = await chrome.storage.local.get('cachedSyncResult');
      const syncResult = localData.cachedSyncResult || {};
      if (Array.isArray(syncResult.assignments) && syncResult.assignments.length > 0) {
        const endOfToday = new Date();
        endOfToday.setHours(23, 0, 0, 0);
        syncResult.assignments[0].deadline = endOfToday.toISOString();
      }
      syncResult.recordings = [
        {
          id: 'rec-lecture-1',
          title: 'Lecture 1 - Asymptotic Bounds',
          recordingUrl: 'https://tau.panopto.eu/Panopto/Pages/Viewer.aspx?id=rec-lecture-1',
          publishedDate: dateKey,
          type: 'Lecture',
          courseId: 1,
          courseName: 'מבני נתונים',
          host: 'Dr. Cohen',
        },
        {
          id: 'rec-recitation-1',
          title: 'Recitation 1 - Induction',
          recordingUrl: 'https://tau.panopto.eu/Panopto/Pages/Viewer.aspx?id=rec-recitation-1',
          publishedDate: dateKey,
          type: 'Recitation',
          courseId: 2,
          courseName: 'אלגוריתמים',
          host: 'TA Levi',
  test('TC-DASH-REHAUL-07: Assignment delete button, locked assignment auto-dismissal, and Panopto recording dismissal move items to hidden lists (including per-section hidden list on Course page)', async ({ optionsPage }) => {
    // Seed sectionName 'שבוע 02' on assignment 101, a locked auto-hidden assignment (תרגיל בית 2 - קבוצה 4) in 'שבוע 02', a section file, and a Panopto recording
    await optionsPage.evaluate(async () => {
      const localData = await chrome.storage.local.get('cachedSyncResult');
      const syncResult = localData.cachedSyncResult || {};
      syncResult.assignments = (syncResult.assignments || []).map((a: any) =>
        a.id === 101 ? { ...a, sectionName: 'שבוע 02' } : a
      );
      syncResult.assignments.push({
        id: 504,
        cmid: 1504,
        uid: 'assign:504',
        courseId: 1,
        courseName: 'מבני נתונים',
        sectionName: 'שבוע 02',
        name: 'תרגיל בית 2 - קבוצה 4',
        status: 'Assigned',
        deadline: '2026-11-10T11:00:00.000Z',
        opened: null,
        link: 'https://moodle.tau.ac.il/mod/assign/view.php?id=1504',
        grade: null,
        gradeMax: 100,
        isHidden: true,
      });
      syncResult.files = [
        {
          id: 901,
          courseId: 1,
          courseName: 'מבני נתונים',
          sectionName: 'שבוע 02',
          fileName: 'תרגול 2.pdf',
          fileUrl: 'https://moodle.tau.ac.il/pluginfile.php/901/mod_resource/content/1/tirgul2.pdf',
          fileSize: 102400,
          fileType: 'application/pdf',
        },
      ];
      syncResult.recordings = [
        {
          id: 'rec-ds-01',
          title: 'הרצאה 01 - מבוא למבני נתונים',
          recordingUrl: 'https://tau.cloud.panopto.eu/Panopto/Pages/Viewer.aspx?id=rec-ds-01',
          publishedDate: '2026-11-01',
          type: 'Lecture',
          courseId: 1,
          courseName: 'מבני נתונים',
          durationSeconds: 3600,
        },
      ];
      await chrome.storage.local.set({ cachedSyncResult: syncResult });

      const syncData = await chrome.storage.sync.get('settings');
      const settings = syncData.settings || {};
      settings.panoptoEnabled = true;
      settings.watchedRecordings = ['rec-recitation-1'];
      settings.hiddenRecordings = [];
      await chrome.storage.sync.set({ settings });
    }, todayIso);
      settings.hiddenAssignments = [];
      settings.hiddenRecordings = [];
      await chrome.storage.sync.set({ settings });
    });

    await optionsPage.reload();
    await optionsPage.waitForLoadState('domcontentloaded');

    // Navigate to dedicated Recordings tab
    const recNavBtn = optionsPage.locator('.nav-item').filter({ hasText: /הקלטות|Recordings/ });
    await expect(recNavBtn).toBeVisible();
    await recNavBtn.click();

    await expect(optionsPage.locator('.tab-recordings')).toBeVisible();

    // Initially Unwatched=true, Watched=false -> Lecture 1 visible, Recitation 1 hidden by watched filter
    await expect(optionsPage.locator('#recording-card-rec-lecture-1')).toBeVisible();
    await expect(optionsPage.locator('#recording-card-rec-recitation-1')).toHaveCount(0);

    // Enable Watched filter -> both recordings visible
    const filterCheckboxes = optionsPage.locator('.tab-recordings .filter-checkboxes input[type="checkbox"]');
    await filterCheckboxes.nth(1).check(); // filter_watched
    await expect(optionsPage.locator('#recording-card-rec-recitation-1')).toBeVisible();

    // Uncheck Recitations filter -> Recitation 1 filtered out
    await filterCheckboxes.nth(3).uncheck(); // filter_recitations
    await expect(optionsPage.locator('#recording-card-rec-recitation-1')).toHaveCount(0);
    await filterCheckboxes.nth(3).check();

    // Search filter isolates by host / title
    const searchInput = optionsPage.locator('.tab-recordings .search-input');
    await searchInput.fill('Asymptotic');
    await expect(optionsPage.locator('#recording-card-rec-lecture-1')).toBeVisible();
    await expect(optionsPage.locator('#recording-card-rec-recitation-1')).toHaveCount(0);
    await searchInput.fill('');

    // Calendar pane starts open -> switch to Weekly mode and verify 7-day week grid
    await expect(optionsPage.locator('.assignments-calendar-pane')).toBeVisible();
    const weekBtn = optionsPage.locator('.calendar-mode-btn').filter({ hasText: /שבועי|Weekly/ });
    await weekBtn.click();
    await expect(optionsPage.locator('.calendar-week-grid .calendar-week-day-card')).toHaveCount(7);
    await expect(optionsPage.locator('.calendar-week-item-card').filter({ hasText: 'Lecture 1 - Asymptotic Bounds' })).toBeVisible();

    // Toggle "Also show assignments" overlay -> seeded Assignment for Course 1 renders in weekly calendar
    const overlayCheckbox = optionsPage.locator('.calendar-overlay-toggle input[type="checkbox"]');
    await overlayCheckbox.check();
    await expect(optionsPage.locator('.calendar-week-item-card').filter({ hasText: 'תרגיל בית 1 - עצי חיפוש' })).toBeVisible();
    await overlayCheckbox.uncheck();

    // Switch back to Monthly mode and click recording pill to focus its card
    await optionsPage.locator('.calendar-mode-btn').filter({ hasText: /חודשי|Monthly/ }).click();
    await optionsPage.locator('.calendar-assign-pill').filter({ hasText: 'Lecture 1 - Asymptotic Bounds' }).click();
    await expect(optionsPage.locator('#recording-card-rec-lecture-1')).toBeVisible();

    // Dismiss Lecture 1 -> moves into collapsible hidden recordings drawer; Restore brings it back
    await optionsPage.locator('#recording-card-rec-lecture-1 .queue-delete-btn').click();
    await expect(optionsPage.locator('#recording-card-rec-lecture-1')).toHaveCount(0);
    const hiddenDrawerToggle = optionsPage.locator('.panopto-hidden-toggle-btn');
    await expect(hiddenDrawerToggle).toBeVisible();
    await hiddenDrawerToggle.click();
    await expect(optionsPage.locator('.panopto-hidden-recordings-drawer #recording-card-rec-lecture-1')).toBeVisible();
    await optionsPage.locator('.panopto-hidden-recordings-drawer #recording-card-rec-lecture-1 .queue-delete-btn').click();
    await expect(optionsPage.locator('.assignments-feed > #recording-card-rec-lecture-1')).toBeVisible();

    // Verify theme accent color on filter checkboxes and Settings range slider (Coffee theme -> #d4a373)
    await optionsPage.evaluate(async () => {
      const data = await chrome.storage.sync.get('settings');
      const settings = data.settings || {};
      settings.theme = 'coffee';
      await chrome.storage.sync.set({ settings });
    });
    await optionsPage.reload();
    await optionsPage.waitForLoadState('domcontentloaded');
    await optionsPage.locator('.nav-item').filter({ hasText: /הקלטות|Recordings/ }).click();
    const recCheckboxAccent = await optionsPage.locator('.tab-recordings .filter-checkboxes input[type="checkbox"]').first().evaluate(
      (el) => getComputedStyle(el).accentColor
    );
    expect(recCheckboxAccent).toBe('rgb(212, 163, 115)');

    await optionsPage.locator('.nav-item').filter({ hasText: /הגדרות|Settings/ }).click();
    const sliderAccent = await optionsPage.locator('.settings-range-slider').evaluate(
      (el) => getComputedStyle(el).accentColor
    );
    expect(sliderAccent).toBe('rgb(212, 163, 115)');
    // 1. Locked assignment "תרגיל בית 2 - קבוצה 4" must NOT appear in the Dashboard Upcoming To-Do queue
    const queueCard = optionsPage.locator('.queue-card').first();
    await expect(queueCard).not.toContainText('תרגיל בית 2 - קבוצה 4');

    // 2. Navigate to Assignments tab: locked assignment is in the collapsible Hidden Assignments drawer, not the active feed
    await optionsPage.locator('.sidebar-nav .nav-item').nth(1).click();
    const assignmentsFeed = optionsPage.locator('.assignments-feed');
    await expect(assignmentsFeed).toBeVisible();
    const hiddenDrawerWrapper = assignmentsFeed.locator('.hidden-assignments-drawer-wrapper');
    await expect(hiddenDrawerWrapper).toBeVisible();

    // Dismiss active assignment "תרגיל בית 1 - עצי חיפוש" via its card delete button
    const treeCard = assignmentsFeed.locator('.assignment-card').filter({ hasText: 'תרגיל בית 1 - עצי חיפוש' });
    await expect(treeCard).toBeVisible();
    await treeCard.locator('.queue-delete-btn').click();
    await expect(treeCard).toHaveCount(0);

    // Open Hidden Assignments drawer on Assignments tab -> both "תרגיל בית 1 - עצי חיפוש" and locked "תרגיל בית 2 - קבוצה 4" appear
    await hiddenDrawerWrapper.locator('.panopto-toggle-hidden-btn').click();
    const hiddenDrawer = hiddenDrawerWrapper.locator('.hidden-assignments-drawer');
    await expect(hiddenDrawer).toBeVisible();
    await expect(hiddenDrawer).toContainText('תרגיל בית 1 - עצי חיפוש');
    await expect(hiddenDrawer).toContainText('תרגיל בית 2 - קבוצה 4');

    // Restore "תרגיל בית 1 - עצי חיפוש" from the hidden drawer
    await hiddenDrawer.locator('.assignment-card').filter({ hasText: 'תרגיל בית 1 - עצי חיפוש' }).locator('.queue-delete-btn').click();
    await expect(assignmentsFeed.locator('> .assignment-card').filter({ hasText: 'תרגיל בית 1 - עצי חיפוש' })).toBeVisible();

    // 3. Navigate back to Dashboard and open Course 1 ("מבני נתונים")
    await optionsPage.locator('.sidebar-nav .nav-item').first().click();
    await optionsPage.locator('.course-row-card').filter({ hasText: 'מבני נתונים' }).first().click();
    const detailView = optionsPage.locator('.course-detail-view');
    await expect(detailView).toBeVisible();

    // Inside section "שבוע 02", "תרגיל בית 1 - עצי חיפוש" is visible and locked "תרגיל בית 2 - קבוצה 4" is in the section's hidden assignments drawer
    const week2Section = detailView.locator('.section-node').filter({ hasText: 'שבוע 02' });
    await expect(week2Section).toBeVisible();
    await expect(week2Section.locator('> .section-node-body > .section-assignments-list')).toContainText('תרגיל בית 1 - עצי חיפוש');
    await expect(week2Section.locator('> .section-node-body > .section-assignments-list')).not.toContainText('תרגיל בית 2 - קבוצה 4');

    const sectionHiddenWrapper = week2Section.locator('.section-hidden-assignments-wrapper');
    await expect(sectionHiddenWrapper).toBeVisible();
    const sectionHiddenToggle = sectionHiddenWrapper.locator('.section-hidden-assignments-toggle');
    await expect(sectionHiddenToggle).toContainText('(1)');

    // Dismiss "תרגיל בית 1 - עצי חיפוש" directly inside the "שבוע 02" section card
    await week2Section
      .locator('> .section-node-body > .section-assignments-list .section-assignment-item')
      .filter({ hasText: 'תרגיל בית 1 - עצי חיפוש' })
      .locator('.queue-delete-btn')
      .click();
    await expect(sectionHiddenToggle).toContainText('(2)');

    // Expand the section's hidden assignments drawer at the bottom of "שבוע 02" -> both assignments appear
    await sectionHiddenToggle.click();
    const sectionHiddenDrawer = sectionHiddenWrapper.locator('.section-hidden-assignments-drawer');
    await expect(sectionHiddenDrawer).toBeVisible();
    await expect(sectionHiddenDrawer).toContainText('תרגיל בית 1 - עצי חיפוש');
    await expect(sectionHiddenDrawer).toContainText('תרגיל בית 2 - קבוצה 4');

    // Unhide "תרגיל בית 1 - עצי חיפוש" from the section's hidden drawer -> returns to the active section card
    await sectionHiddenDrawer
      .locator('.section-assignment-item')
      .filter({ hasText: 'תרגיל בית 1 - עצי חיפוש' })
      .locator('.queue-delete-btn')
      .click();
    await expect(week2Section.locator('> .section-node-body > .section-assignments-list')).toContainText('תרגיל בית 1 - עצי חיפוש');
    await expect(sectionHiddenToggle).toContainText('(1)');

    // 4. Dismiss Panopto recording "הרצאה 01 - מבוא למבני נתונים" via its delete button -> moves into hidden recordings drawer
    const panoptoCard = detailView.locator('.panopto-section-card');
    await expect(panoptoCard).toBeVisible();
    const recRow = panoptoCard.locator('.section-recording-item').filter({ hasText: 'הרצאה 01 - מבוא למבני נתונים' });
    await expect(recRow).toBeVisible();
    await recRow.locator('.queue-delete-btn').click();

    await expect(panoptoCard.locator('.panopto-toggle-hidden-btn')).toContainText('(1)');
    await panoptoCard.locator('.panopto-toggle-hidden-btn').click();
    const panoptoHiddenDrawer = panoptoCard.locator('.panopto-hidden-recordings-drawer');
    await expect(panoptoHiddenDrawer).toContainText('הרצאה 01 - מבוא למבני נתונים');

    // Restore Panopto recording from hidden drawer
    await panoptoHiddenDrawer.locator('.section-recording-item').locator('.queue-delete-btn').click();
    await expect(panoptoCard.locator('.section-recordings-list .section-recording-item')).toContainText('הרצאה 01 - מבוא למבני נתונים');
  });
});
