import { test, expect } from './fixtures.js';

test.describe('Moodle Missing Structures Overhaul — Browser E2E Suite', () => {
  const courseId = 101;

  test.beforeEach(async ({ optionsPage }) => {
    const now = Date.now();

    await optionsPage.evaluate(async ({ currentTime, cId }) => {
      await chrome.storage.local.set({
        wstoken: 'MOCK_STRUCTURES_TOKEN',
        hasSeenTour: true,
        cachedSyncResult: {
          assignments: [
            // 1. Regular submitted assignment
            {
              id: 1,
              cmid: 1001,
              courseId: cId,
              courseName: 'מבני נתונים - 03682161',
              sectionId: 22,
              sectionName: 'שבוע 2 - עצי חיפוש',
              name: 'מטלה 1 - עצי חיפוש בינאריים',
              status: 'Submitted',
              deadline: new Date(currentTime + 24 * 3600 * 1000).toISOString(),
              opened: null,
              link: 'https://moodle.tau.ac.il/mod/assign/view.php?id=1001',
              grade: 98,
              gradeMax: 100,
              feedback: 'כל הכבוד, עבודה מצוינת!',
              isBonus: false,
              activityType: 'assign',
              uid: 'assign:1',
              isCompleted: true,
            },
            // 2. Companion Late Submission Box (auto-suppressed)
            {
              id: 2,
              cmid: 1002,
              courseId: cId,
              courseName: 'מבני נתונים - 03682161',
              sectionId: 22,
              sectionName: 'שבוע 2 - עצי חיפוש',
              name: 'מטלה 1 - תיבת הגשה באיחור',
              status: 'Submitted',
              deadline: new Date(currentTime + 48 * 3600 * 1000).toISOString(),
              opened: null,
              link: 'https://moodle.tau.ac.il/mod/assign/view.php?id=1002',
              grade: null,
              gradeMax: 100,
              isLateSubmissionBox: true,
              isHidden: true,
              activityType: 'assign',
              uid: 'assign:2',
              isCompleted: true,
            },
            // 3. Quiz with time limit and manual completion
            {
              id: 3,
              cmid: 1003,
              courseId: cId,
              courseName: 'מבני נתונים - 03682161',
              sectionId: 21,
              sectionName: 'שבוע 1 - מבוא וסיבוכיות',
              name: 'בוחן 1 - בדיקת ידע עצמי',
              status: 'Not submitted',
              deadline: new Date(currentTime + 72 * 3600 * 1000).toISOString(),
              opened: null,
              link: 'https://moodle.tau.ac.il/mod/quiz/view.php?id=1003',
              grade: null,
              gradeMax: 10,
              timeLimitSeconds: 1800, // 30 minutes
              requiresManualCompletion: true,
              isManualCompletionDone: false,
              activityType: 'quiz',
              uid: 'quiz:3',
              isCompleted: false,
            },
            // 4. Bonus assignment
            {
              id: 4,
              cmid: 1004,
              courseId: cId,
              courseName: 'מבני נתונים - 03682161',
              sectionId: 21,
              sectionName: 'שבוע 1 - מבוא וסיבוכיות',
              name: 'שאלת בונוס מתקדמת',
              status: 'Submitted',
              deadline: new Date(currentTime + 96 * 3600 * 1000).toISOString(),
              opened: null,
              link: 'https://moodle.tau.ac.il/mod/assign/view.php?id=1004',
              grade: 5,
              gradeMax: 5,
              isBonus: true,
              activityType: 'assign',
              uid: 'assign:4',
              isCompleted: true,
            },
          ],
          sections: [
            // Top-level section 1: General
            {
              id: 10,
              courseId: cId,
              sectionNumber: 0,
              name: 'כללי ומבוא',
              summaryHtml: 'ברוכים הבאים לקורס מבני נתונים!',
              parentSectionId: null,
              level: 0,
              sectionUrl: 'https://moodle.tau.ac.il/course/view.php?id=101&section=0',
              visible: true,
            },
            // Top-level section 2: Lectures (parent)
            {
              id: 20,
              courseId: cId,
              sectionNumber: 1,
              name: 'הרצאות הקורס',
              parentSectionId: null,
              level: 0,
              sectionUrl: 'https://moodle.tau.ac.il/course/view.php?id=101&section=1',
              visible: true,
            },
            // Child subsection 2a: Week 1
            {
              id: 21,
              courseId: cId,
              sectionNumber: 2,
              name: 'שבוע 1 - מבוא וסיבוכיות',
              parentSectionId: 20,
              level: 1,
              sectionUrl: 'https://moodle.tau.ac.il/course/view.php?id=101&section=2',
              visible: true,
            },
            // Child subsection 2b: Week 2
            {
              id: 22,
              courseId: cId,
              sectionNumber: 3,
              name: 'שבוע 2 - עצי חיפוש',
              parentSectionId: 20,
              level: 1,
              sectionUrl: 'https://moodle.tau.ac.il/course/view.php?id=101&section=3',
              visible: true,
            },
            // Child subsection 2c: Week 3 (Empty)
            {
              id: 23,
              courseId: cId,
              sectionNumber: 4,
              name: 'שבוע 3 - נושא עתידי',
              parentSectionId: 20,
              level: 1,
              sectionUrl: 'https://moodle.tau.ac.il/course/view.php?id=101&section=4',
              visible: true,
            },
            // Top-level section 3: Empty Section
            {
              id: 30,
              courseId: cId,
              sectionNumber: 5,
              name: 'פרויקט גמר (ריק)',
              parentSectionId: null,
              level: 0,
              sectionUrl: 'https://moodle.tau.ac.il/course/view.php?id=101&section=5',
              visible: true,
            },
          ],
          folders: [
            {
              id: 2001,
              instanceId: 501,
              courseId: cId,
              courseName: 'מבני נתונים',
              sectionId: 10,
              sectionName: 'כללי ומבוא',
              name: 'מבחנים משנים קודמות ופתרונות',
              moodleUrl: 'https://moodle.tau.ac.il/mod/folder/view.php?id=2001',
              totalSize: 5242880, // 5 MB
              files: [
                {
                  fileName: 'exam_2025_moed_a.pdf',
                  relativePath: '2025/',
                  fileSize: 2621440,
                  fileUrl: 'https://moodle.tau.ac.il/files/exam1.pdf',
                  downloadUrl: 'https://moodle.tau.ac.il/files/exam1.pdf?token=MOCK',
                  timeModified: 1720000000,
                },
                {
                  fileName: 'exam_2025_moed_b.pdf',
                  relativePath: '2025/',
                  fileSize: 2621440,
                  fileUrl: 'https://moodle.tau.ac.il/files/exam2.pdf',
                  downloadUrl: 'https://moodle.tau.ac.il/files/exam2.pdf?token=MOCK',
                  timeModified: 1720000000,
                },
              ],
            },
          ],
          links: [
            {
              id: 3001,
              courseId: cId,
              courseName: 'מבני נתונים',
              sectionId: 10,
              sectionName: 'כללי ומבוא',
              name: 'מאגר התרגילים הרשמי ב-GitHub',
              targetUrl: 'https://github.com/tau-cs/data-structures',
              moodleUrl: 'https://moodle.tau.ac.il/mod/url/view.php?id=3001',
              linkKind: 'github',
            },
          ],
          announcements: [
            {
              id: 4001,
              courseId: cId,
              name: 'לוח מודעות והודעות הקורס',
              moodleUrl: 'https://moodle.tau.ac.il/mod/forum/view.php?id=4001',
            },
          ],
          gradeSummaries: {
            [cId]: {
              courseId: cId,
              courseTotalFormatted: '94.50',
              courseTotalRaw: 94.5,
              courseTotalMax: 100,
              hasCourseTotal: true,
              items: [],
            },
          },
          files: [],
          meetings: [],
          recordings: [],
          errors: [],
          syncedAt: new Date().toISOString(),
        },
      });

      await chrome.storage.sync.set({
        trackedCourseIds: [cId],
        settings: {
          theme: 'noodle',
          language: 'he',
          coursesColorMap: { [cId]: '#3b82f6' },
          coursesCustomNames: {},
          hiddenAssignments: [],
          completedAssignments: [],
          uncompletedAssignments: [],
        },
      });
    }, { currentTime: now, cId: courseId });

    await optionsPage.reload();
    await optionsPage.waitForLoadState('domcontentloaded');
  });

  test('TC-EXT-015: Course Detail renders 2-level section navigation, quizzes, ZIP folder, links, and announcements', async ({ optionsPage }) => {
    // 1. Navigate from Dashboard into Course Detail view
    const courseCard = optionsPage.locator('.course-row-card').first();
    await expect(courseCard).toBeVisible();

    const goBtn = courseCard.locator('button').filter({ hasText: /עבור לקורס|Go to/ });
    await expect(goBtn).toBeVisible();
    await goBtn.click();

    const detailView = optionsPage.locator('.course-detail-view');
    await expect(detailView).toBeVisible();

    // 2. Verify Course Announcements Card is displayed
    const announcementsCard = detailView.locator('.course-announcements-card');
    await expect(announcementsCard).toBeVisible();
    await expect(announcementsCard).toContainText('לוח מודעות והודעות');
    await expect(announcementsCard.locator('a[href*="mod/forum"]')).toBeVisible();

    // 3. Verify Authoritative Course Total Badge in header
    const totalBadge = detailView.locator('.detail-title-section .badge').filter({ hasText: 'ציון כולל: 94.50' });
    await expect(totalBadge).toBeVisible();

    // 4. Verify 2-Level Section Hierarchy Navigation Chips
    const navTree = detailView.locator('.subjects-nav-tree-container');
    await expect(navTree).toBeVisible();
    await expect(navTree).toContainText('כללי ומבוא');
    await expect(navTree).toContainText('הרצאות הקורס');
    // Verify empty top-level section is hidden by default
    await expect(navTree).not.toContainText('פרויקט גמר (ריק)');

    // Click on "הרצאות הקורס" which has child sub-sections
    const lecturesChip = navTree.locator('button', { hasText: 'הרצאות הקורס' });
    await lecturesChip.click();

    // Verify subtopic pill row appears with ↳ indicator
    const subtopicsRow = navTree.locator('.subsections-nav-row');
    await expect(subtopicsRow).toBeVisible();
    await expect(subtopicsRow).toContainText('שבוע 1 - מבוא וסיבוכיות');
    await expect(subtopicsRow).toContainText('שבוע 2 - עצי חיפוש');
    // Verify empty sub-topic is hidden by default
    await expect(subtopicsRow).not.toContainText('שבוע 3 - נושא עתידי');

    // 4b. Verify Empty Sections Toggle (Show / Hide)
    const toggleBtn = detailView.locator('.toggle-empty-sections-btn');
    await expect(toggleBtn).toBeVisible();
    await expect(toggleBtn).toContainText(/הצג נושאים ריקים|Show empty sections/);

    // Click toggle to SHOW empty sections
    await toggleBtn.click();
    await expect(toggleBtn).toContainText(/הסתר נושאים ריקים|Hide empty sections/);
    await expect(navTree).toContainText('פרויקט גמר (ריק)');
    await expect(subtopicsRow).toContainText('שבוע 3 - נושא עתידי');

    // Click toggle to HIDE empty sections again
    await toggleBtn.click();
    await expect(toggleBtn).toContainText(/הצג נושאים ריקים|Show empty sections/);
    await expect(navTree).not.toContainText('פרויקט גמר (ריק)');
    await expect(subtopicsRow).not.toContainText('שבוע 3 - נושא עתידי');

    // Click on "All 🌐" to view all sections again
    const allChip = navTree.locator('button', { hasText: /הכל 🌐|All 🌐/ });
    await allChip.click();

    // 5. Verify Section Summary Banner
    const summaryBanner = detailView.locator('.section-summary-banner');
    await expect(summaryBanner).toBeVisible();
    await expect(summaryBanner).toContainText('ברוכים הבאים לקורס מבני נתונים!');

    // 6. Verify Folder Card & Bulk ZIP Download Button
    const folderCard = detailView.locator('.section-folder-card');
    await expect(folderCard).toBeVisible();
    await expect(folderCard).toContainText('מבחנים משנים קודמות ופתרונות');
    await expect(folderCard).toContainText('2 קבצים');
    const zipBtn = folderCard.locator('button', { hasText: /הורד כ-ZIP|Download ZIP/ });
    await expect(zipBtn).toBeVisible();

    // 7. Verify External Resource Link (GitHub)
    const linkItem = detailView.locator('.section-link-item');
    await expect(linkItem).toBeVisible();
    await expect(linkItem).toContainText('מאגר התרגילים הרשמי ב-GitHub');

    // 8. Verify Quizzes & בחנים (mod_quiz) Badging & Time Limit
    const quizItem = detailView.locator('.section-assignment-item').filter({ hasText: 'בוחן 1 - בדיקת ידע עצמי' });
    await expect(quizItem).toBeVisible();
    await expect(quizItem.locator('.quiz-tag')).toContainText('❓ בוחן');
    await expect(quizItem.locator('.badge', { hasText: "⏱️ 30 דק'" })).toBeVisible();

    // Verify Two-Way Interactive "Mark as done" Button
    const markDoneBtn = quizItem.locator('button', { hasText: 'סמן כבוצע' });
    await expect(markDoneBtn).toBeVisible();

    // 9. Verify Bonus Badge & Feedback on Assignments
    const bonusItem = detailView.locator('.section-assignment-item').filter({ hasText: 'שאלת בונוס מתקדמת' });
    await expect(bonusItem).toBeVisible();
    await expect(bonusItem.locator('.badge', { hasText: '✨ בונוס' })).toBeVisible();

    const submittedItem = detailView.locator('.section-assignment-item').filter({ hasText: 'מטלה 1 - עצי חיפוש בינאריים' });
    await expect(submittedItem).toBeVisible();
    await expect(submittedItem).toContainText('כל הכבוד, עבודה מצוינת!');

    // 10. Verify Late Submission Box Auto-Suppression
    // Companion late box has isHidden: true, so it should NOT appear in the section list
    const lateBoxItem = detailView.locator('.section-assignment-item', { hasText: 'תיבת הגשה באיחור' });
    await expect(lateBoxItem).toHaveCount(0);

    // Capture Full Page Screenshot of Course Detail View with new structures
    await optionsPage.screenshot({
      path: 'screenshots/structures-course-detail.png',
      fullPage: true,
    });
  });

  test('TC-EXT-016: Grades Tab prioritizes authoritative course total, bonus tags, and feedback', async ({ optionsPage }) => {
    // Navigate to Grades Tab via sidebar
    const gradesNav = optionsPage.locator('.nav-item').filter({ hasText: 'ציונים' });
    await gradesNav.click();

    const tabGrades = optionsPage.locator('.tab-grades');
    await expect(tabGrades).toBeVisible();

    // Verify Authoritative Course Total in course group header
    const courseGroup = tabGrades.locator('.course-grades-group');
    await expect(courseGroup).toBeVisible();
    await expect(courseGroup.locator('.course-avg-badge')).toContainText('ציון סופי: 94.50');

    // Verify Bonus badge in grade row
    const bonusRow = courseGroup.locator('.grade-row').filter({ hasText: 'שאלת בונוס מתקדמת' });
    await expect(bonusRow).toBeVisible();
    await expect(bonusRow.locator('.badge', { hasText: '✨ בונוס' })).toBeVisible();

    // Verify Feedback in grade row
    const feedbackRow = courseGroup.locator('.grade-row').filter({ hasText: 'מטלה 1 - עצי חיפוש בינאריים' });
    await expect(feedbackRow).toBeVisible();
    await expect(feedbackRow).toContainText('כל הכבוד, עבודה מצוינת!');

    // Capture Full Page Screenshot of Grades Tab with authoritative totals and bonus tags
    await optionsPage.screenshot({
      path: 'screenshots/structures-grades-tab.png',
      fullPage: true,
    });
  });
});
