import { test, expect } from './fixtures.js';

test.describe('TC-PAN-09: Panopto Staff Host Mapping, Moodle Import & Instant Reclassification (#40)', () => {
  let enrolledUsersRequestCount = 0;

  test.beforeEach(async ({ context, optionsPage }) => {
    enrolledUsersRequestCount = 0;
    // Intercept TAU Moodle REST API & participants HTML requests made by the background service worker
    await context.route('https://moodle.tau.ac.il/**', async (route) => {
      const request = route.request();
      const url = request.url();
      const postData = request.postData() || '';

      if (url.includes('webservice/rest/server.php') && (url.includes('core_webservice_get_site_info') || postData.includes('core_webservice_get_site_info'))) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ userid: 99, fullname: 'Test Student' }),
        });
        return;
      }

      if (url.includes('webservice/rest/server.php') && (url.includes('core_enrol_get_users_courses') || postData.includes('core_enrol_get_users_courses'))) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              id: 101,
              shortname: '0368-2154-01-2026-1',
              fullname: 'פיזיקה 2',
              idnumber: '0368-2154-01-2026-1',
            },
            {
              id: 102,
              shortname: '0368-2155-01-2026-1',
              fullname: 'מערכות הפעלה',
              idnumber: '0368-2155-01-2026-1',
            },
          ]),
        });
        return;
      }

      if (url.includes('webservice/rest/server.php') && postData.includes('core_enrol_get_enrolled_users')) {
        enrolledUsersRequestCount++;
        if (postData.includes('courseid=101')) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([
              {
                id: 77,
                fullname: 'יואב לחיני',
                roles: [{ shortname: 'editingteacher', name: 'Teacher' }],
              },
              {
                id: 78,
                fullname: 'אדם חיטין ביאלוס',
                roles: [{ shortname: '', name: 'Non-editing teacher' }],
              },
              {
                id: 79,
                fullname: 'סטודנט בדיקה',
                roles: [{ shortname: 'student', name: 'Student' }],
              },
            ]),
          });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({}),
      });
    });

    await optionsPage.evaluate(async () => {
      await chrome.storage.local.set({
        wstoken: 'MOCK_VALID_TOKEN',
        hasSeenTour: true,
        enrolledCoursesCache: [
          {
            id: 101,
            shortname: '0368-2154-01-2026-1',
            fullname: 'פיזיקה 2',
            idnumber: '0368-2154-01-2026-1',
          },
          {
            id: 102,
            shortname: '0368-2155-01-2026-1',
            fullname: 'מערכות הפעלה',
            idnumber: '0368-2155-01-2026-1',
          },
        ],
        cachedSyncResult: {
          courses: [
            {
              id: 101,
              courseId: '03682154',
              shortname: '0368-2154-01-2026-1',
              fullname: 'פיזיקה 2',
              semester: 'SemesterA',
              year: '2026',
            },
            {
              id: 102,
              courseId: '03682155',
              shortname: '0368-2155-01-2026-1',
              fullname: 'מערכות הפעלה',
              semester: 'SemesterA',
              year: '2026',
            },
          ],
          assignments: [],
          files: [],
          meetings: [],
          recordings: [
            {
              id: 'rec-01',
              title: 'תרגול 01 - פתיחה',
              recordingUrl: 'https://tau.cloud.panopto.eu/Panopto/Pages/Viewer.aspx?id=rec-01',
              publishedDate: '2026-11-12',
              type: 'Recitation', // Misclassified by title keyword until Yoav Lahini is mapped as Lecturer
              courseId: 101,
              courseName: 'פיזיקה 2',
              durationSeconds: 5400,
              host: 'Yoav Lahini',
              classificationSource: 'title',
            },
            {
              id: 'rec-02',
              title: 'הרצאה 02 - משוואות מקסוול',
              recordingUrl: 'https://tau.cloud.panopto.eu/Panopto/Pages/Viewer.aspx?id=rec-02',
              publishedDate: '2026-11-13',
              type: 'Lecture', // Misclassified by title keyword until Adam Hitin Bialos is mapped as TA
              courseId: 101,
              courseName: 'פיזיקה 2',
              durationSeconds: 3000,
              host: 'Adam Hitin Bialos',
              classificationSource: 'title',
            },
          ],
          errors: [],
          syncedAt: new Date().toISOString(),
        },
      });

      await chrome.storage.sync.set({
        trackedCourseIds: [101, 102],
        settings: {
          theme: 'noodle',
          language: 'en',
          panoptoEnabled: true,
          coursesColorMap: { 101: '#e07a5f', 102: '#3b82f6' },
          coursesCustomNames: { 101: 'פיזיקה 2', 102: 'מערכות הפעלה' },
          coursesPanoptoStaff: {},
          hiddenAssignments: [],
          completedAssignments: [],
          uncompletedAssignments: [],
        },
      });
    });

    await optionsPage.reload();
    await optionsPage.waitForLoadState('domcontentloaded');
  });

  test('Imports Moodle staff, edits Hebrew-to-English Host mapping, reclassifies immediately, and configures 0-recording courses + Manage Courses modal', async ({ optionsPage }) => {
    // 1. Open course 101 ("פיזיקה 2") — before host filtering, all 2 recordings count in gaps & progress (0/2)
    const physicsCard = optionsPage.locator('.course-row-card').filter({ hasText: 'פיזיקה 2' }).first();
    await expect(physicsCard).toBeVisible();
    await expect(physicsCard.locator('.course-stat-gap').filter({ hasText: /Lectures:\s*1/ })).toBeVisible();
    await expect(physicsCard.locator('.course-stat-gap').filter({ hasText: /Recitations:\s*1/ })).toBeVisible();
    await expect(physicsCard.locator('.course-prog-percent')).toContainText('0/2 (0%)');
    await physicsCard.click();
    await expect(optionsPage.locator('.course-detail-view')).toBeVisible();

    // Panopto recordings section is expanded by default
    const panoptoCard = optionsPage.locator('.panopto-section-card');
    await expect(panoptoCard).toBeVisible();

    // Verify Host badges & initial misclassified tags
    await expect(panoptoCard.locator('.recording-host-badge').filter({ hasText: 'Yoav Lahini' })).toBeVisible();
    await expect(panoptoCard.locator('.recording-host-badge').filter({ hasText: 'Adam Hitin Bialos' })).toBeVisible();

    const session01Row = panoptoCard.locator('.section-recording-item').filter({ hasText: 'תרגול 01 - פתיחה' });
    const session02Row = panoptoCard.locator('.section-recording-item').filter({ hasText: 'הרצאה 02 - משוואות מקסוול' });
    await expect(session01Row.locator('.recording-type-tag')).toHaveClass(/recitation-tag/);
    await expect(session02Row.locator('.recording-type-tag')).toHaveClass(/lecture-tag/);

    // 2. Open Staff Editor and import staff from Moodle
    await panoptoCard.locator('.panopto-staff-toggle-btn').click();
    const staffEditor = panoptoCard.locator('.panopto-staff-editor');
    await expect(staffEditor).toBeVisible();

    await staffEditor.locator('.panopto-staff-import-btn').click();

    // Wait for Hebrew Moodle staff rows to populate
    await expect(staffEditor.locator('.panopto-staff-row')).toHaveCount(2);
    await expect(staffEditor).toContainText('יואב לחיני');
    await expect(staffEditor).toContainText('אדם חיטין ביאלוס');

    // Verify Non-editing teacher imported as Recitation and Teacher imported as Lecture
    const yoavRow = staffEditor.locator('.panopto-staff-row').filter({ hasText: 'יואב לחיני' });
    const adamRow = staffEditor.locator('.panopto-staff-row').filter({ hasText: 'אדם חיטין ביאלוס' });
    await expect(yoavRow.locator('.panopto-role-btn').first()).toHaveClass(/active/);
    await expect(adamRow.locator('.panopto-role-btn').last()).toHaveClass(/active/);

    // 3. Edit Panopto Host English names and verify instant reclassification without reload
    const yoavInput = yoavRow.locator('.panopto-staff-host-input');
    await yoavInput.fill('Yoav Lahini');
    await yoavInput.blur();

    const adamInput = adamRow.locator('.panopto-staff-host-input');
    await adamInput.fill('Adam Hitin Bialos');
    await adamInput.blur();

    await expect(session01Row.locator('.recording-type-tag')).toHaveClass(/lecture-tag/);
    await expect(session02Row.locator('.recording-type-tag')).toHaveClass(/recitation-tag/);

    // Toggle Yoav role to Recitation and back to Lecture -> verify instant live updates
    await yoavRow.locator('.panopto-role-btn').last().click();
    await expect(session01Row.locator('.recording-type-tag')).toHaveClass(/recitation-tag/);
    await yoavRow.locator('.panopto-role-btn').first().click();
    await expect(session01Row.locator('.recording-type-tag')).toHaveClass(/lecture-tag/);

    // Verify persistence in chrome.storage.sync, cachedSyncResult, and cachedCourseStaff
    const persistedAfterCourse101 = await optionsPage.evaluate(async () => {
      const syncData = await chrome.storage.sync.get('settings');
      const localData = await chrome.storage.local.get(['cachedSyncResult', 'cachedCourseStaff']);
      return {
        staff101: syncData.settings?.coursesPanoptoStaff?.[101] || syncData.settings?.coursesPanoptoStaff?.['101'],
        recordings: localData.cachedSyncResult?.recordings || [],
        cachedStaff101: localData.cachedCourseStaff?.[101] || localData.cachedCourseStaff?.['101'] || [],
      };
    });
    expect(persistedAfterCourse101.staff101).toHaveLength(2);
    expect(persistedAfterCourse101.cachedStaff101).toHaveLength(2);
    expect(persistedAfterCourse101.recordings.find((r: { id: string; type: string }) => r.id === 'rec-01')?.type).toBe('Lecture');
    expect(persistedAfterCourse101.recordings.find((r: { id: string; type: string }) => r.id === 'rec-02')?.type).toBe('Recitation');

    // 3b. Test "Track this host" filtering + hidden recordings drawer:
    // Untrack Adam via editor so only Yoav Lahini is tracked -> rec-02 moves into hidden list!
    await adamRow.locator('.panopto-staff-remove-btn').click();
    await expect(panoptoCard.locator('.section-recordings-list .section-recording-item')).toHaveCount(1);
    await expect(panoptoCard.locator('.section-recordings-list .section-recording-item')).toContainText('תרגול 01 - פתיחה');
    await expect(panoptoCard.locator('.panopto-toggle-hidden-btn')).toContainText('(1)');

    // Expand Hidden recordings drawer and click "Track this host" on rec-02 to track Adam again
    await panoptoCard.locator('.panopto-toggle-hidden-btn').click();
    const hiddenDrawer = panoptoCard.locator('.panopto-hidden-recordings-drawer');
    await expect(hiddenDrawer).toBeVisible();
    await expect(hiddenDrawer.locator('.section-recording-item')).toContainText('Adam Hitin Bialos');
    await hiddenDrawer.locator('.recording-track-host-btn').click();

    // Both recordings are now exclusively visible and hidden toggle disappears!
    await expect(panoptoCard.locator('.section-recordings-list .section-recording-item')).toHaveCount(2);
    await expect(panoptoCard.locator('.panopto-toggle-hidden-btn')).toHaveCount(0);

    // Clear all staff on course 101 via editor -> nothing hidden when 0 hosts chosen
    await staffEditor.locator('.panopto-staff-remove-btn').first().click();
    await staffEditor.locator('.panopto-staff-remove-btn').first().click();
    await expect(panoptoCard.locator('.section-recordings-list .section-recording-item')).toHaveCount(2);
    await expect(panoptoCard.locator('.panopto-toggle-hidden-btn')).toHaveCount(0);

    // Click "Track this host" directly from unfiltered recording rec-01 -> tracks Yoav as Lecture and hides rec-02
    await session01Row.locator('.recording-track-host-btn').click();
    await expect(panoptoCard.locator('.section-recordings-list .section-recording-item')).toHaveCount(1);
    await expect(panoptoCard.locator('.panopto-toggle-hidden-btn')).toContainText('(1)');

    // 4. Start-of-year setup: verify Dashboard excludes hidden rec-02 (Lecture) from gaps & progress bar, then open Course 102
    await optionsPage.locator('.back-btn').click();
    await expect(physicsCard.locator('.course-stat-gap').filter({ hasText: /Lectures:\s*0/ })).toBeVisible();
    await expect(physicsCard.locator('.course-stat-gap').filter({ hasText: /Recitations:\s*1/ })).toBeVisible();
    await expect(physicsCard.locator('.course-prog-percent')).toContainText('0/1 (0%)');
    const osCard = optionsPage.locator('.course-row-card').filter({ hasText: 'מערכות הפעלה' }).first();
    await osCard.click();
    await expect(optionsPage.locator('.course-detail-view')).toBeVisible();

    const osPanoptoCard = optionsPage.locator('.panopto-section-card');
    await expect(osPanoptoCard).toBeVisible();
    await osPanoptoCard.locator('.panopto-staff-toggle-btn').click();

    const osEditor = osPanoptoCard.locator('.panopto-staff-editor');
    await expect(osEditor).toBeVisible();
    await osEditor.locator('.panopto-staff-add-row .panopto-staff-host-input').fill('Eli Eisenberg');
    await osEditor.locator('.panopto-staff-add-row > button').click();

    await expect(osEditor.locator('.panopto-staff-row')).toHaveCount(1);
    await expect(osEditor.locator('.panopto-staff-host-input').first()).toHaveValue('Eli Eisenberg');

    // 5. Open Manage Courses modal: verify wider dialog, Lecturer & TA columns (combobox + manual), and drawer parity
    await optionsPage.locator('.back-btn').click();
    const fetchesBeforeManageOpen = enrolledUsersRequestCount;
    await optionsPage.getByRole('button', { name: /Manage Courses|ניהול קורסים/i }).click();
    const manageModal = optionsPage.locator('.manage-courses-modal');
    await expect(manageModal).toBeVisible();

    const modalMaxWidth = await manageModal.evaluate((el) => parseFloat(getComputedStyle(el).maxWidth));
    expect(modalMaxWidth).toBeGreaterThan(1000);

    const physicsModalRow = optionsPage.locator('.courses-settings-table .table-row').filter({ hasText: 'פיזיקה 2' }).first();
    await expect(physicsModalRow.locator('.staff-host-cell-lecture')).toBeVisible();
    await expect(physicsModalRow.locator('.staff-host-cell-recitation')).toBeVisible();

    // Verify course 101 Lecturer combobox was populated from cachedCourseStaff (first-time local storage cache!)
    // and that the detected Panopto host matches the Moodle member without duplicating the option
    const physicsTaSelect = physicsModalRow.locator('.staff-host-cell-recitation .staff-cell-select');
    const adamOption = physicsTaSelect.locator('option', { hasText: 'אדם חיטין ביאלוס (Adam Hitin Bialos)' });
    await expect(adamOption).toHaveCount(1);
    await expect(physicsTaSelect.locator('option', { hasText: 'Adam Hitin Bialos' })).toHaveCount(1);

    // Course 101 was ALREADY cached in step 2, so opening Manage Courses must NOT re-fetch Moodle staff for course 101
    await expect(physicsModalRow.locator('.staff-host-cell-recitation .staff-cell-select option').first()).not.toContainText('Loading');

    // Pick TA from combobox in TA column
    const adamOptionValue = await adamOption.getAttribute('value');
    expect(adamOptionValue).toBeTruthy();
    await physicsTaSelect.selectOption(adamOptionValue!);
    await expect(physicsModalRow.locator('.staff-host-cell-recitation .staff-cell-chip', { hasText: 'Adam Hitin Bialos' })).toHaveCount(1);

    // Also add manual host in TA column for Course 102
    const osModalRow = optionsPage.locator('.courses-settings-table .table-row').filter({ hasText: 'מערכות הפעלה' }).first();
    await osModalRow.locator('.staff-host-cell-recitation .staff-cell-manual-input').fill('Noam TA');
    await osModalRow.locator('.staff-host-cell-recitation .staff-cell-add-btn').click();
    await expect(osModalRow.locator('.staff-host-cell-recitation .staff-cell-chip', { hasText: 'Noam TA' })).toHaveCount(1);

    // Verify existing PanoptoStaffEditor drawer in modal row still reflects persisted entries
    await osModalRow.locator('.panopto-staff-toggle-btn').click();
    const modalDrawer = optionsPage.locator('.panopto-staff-table-drawer .panopto-staff-editor');
    await expect(modalDrawer).toBeVisible();
    await expect(modalDrawer.locator('.panopto-staff-host-input').first()).toHaveValue('Eli Eisenberg');

    // Re-opening Manage Courses does NOT re-fetch already cached Moodle staff
    const fetchesAfterFirstManageOpen = enrolledUsersRequestCount;
    expect(fetchesAfterFirstManageOpen).toBeLessThanOrEqual(fetchesBeforeManageOpen + 1);
    await manageModal.locator('button', { hasText: '✕' }).click();
    await expect(manageModal).not.toBeVisible();
    await optionsPage.getByRole('button', { name: /Manage Courses|ניהול קורסים/i }).click();
    await expect(manageModal).toBeVisible();
    expect(enrolledUsersRequestCount).toBe(fetchesAfterFirstManageOpen);
  });
});
