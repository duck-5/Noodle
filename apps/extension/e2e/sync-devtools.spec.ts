import { test, expect } from './fixtures.js';

test.describe('DevTools & Sync Feedback Loop', () => {
  test('TC-EXT-DEVTOOLS-01: Capture DevTools console logs and network traffic during unauth & expired token Sync', async ({ context, optionsPage }) => {
    const pageLogs: string[] = [];
    const pageErrors: string[] = [];

    optionsPage.on('console', (msg) => {
      const entry = `[Page Console ${msg.type().toUpperCase()}] ${msg.text()}`;
      pageLogs.push(entry);
      console.log(entry);
    });

    optionsPage.on('pageerror', (err) => {
      const entry = `[Page Error] ${err.message}`;
      pageErrors.push(entry);
      console.error(entry);
    });

    let [background] = context.serviceWorkers();
    if (!background) {
      background = await context.waitForEvent('serviceworker', { timeout: 10000 });
    }

    await background.evaluate(() => {
      const g = globalThis as any;
      g.__sw_logs = g.__sw_logs || [];

      const wrap = (type: string) => {
        const orig = (console as any)[type];
        (console as any)[type] = (...args: any[]) => {
          const str = args.map((a) => {
            if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack}`;
            if (typeof a === 'object') {
              try { return JSON.stringify(a); } catch { return String(a); }
            }
            return String(a);
          }).join(' ');
          g.__sw_logs.push(`[SW ${type.toUpperCase()}] ${str}`);
          orig?.apply(console, args);
        };
      };
      wrap('log');
      wrap('info');
      wrap('warn');
      wrap('error');

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
            bodyPreview = text.length > 200 ? text.slice(0, 200) + '...' : text;
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

    console.log('\n--- 1. Testing Unauthenticated Sync ---');
    const unauthSyncResult = await optionsPage.evaluate(async () => {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'SYNC_NOW' }, (response) => {
          resolve(response);
        });
      });
    });
    console.log('[DevTools] Unauthenticated SYNC_NOW response:', JSON.stringify(unauthSyncResult));

    let currentLogs: string[] = await background.evaluate(() => (globalThis as any).__sw_logs || []);
    console.log('\nService Worker Logs (Unauth Phase):');
    currentLogs.forEach((l) => console.log('  ', l));

    console.log('\n--- 2. Seeding State & Testing Sync via Options UI ---');
    await optionsPage.evaluate(async () => {
      await chrome.storage.local.set({
        wstoken: 'TEST_DEVTOOLS_MOCK_TOKEN',
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
        trackedCourseIds: [1234],
        settings: {
          theme: 'noodle',
          language: 'en',
          coursesColorMap: { 1234: '#3b82f6' },
          coursesCustomNames: {},
          hiddenAssignments: [],
          completedAssignments: [],
          uncompletedAssignments: [],
        },
      });
    });

    await optionsPage.reload();
    await optionsPage.waitForLoadState('domcontentloaded');

    const syncButton = optionsPage.locator('button.primary-btn.btn-sm').filter({ hasText: /Sync|🔄/ });
    await expect(syncButton).toBeVisible();

    console.log('[DevTools UI] Clicking "Sync Now" button...');
    await syncButton.click();

    try {
      await optionsPage.waitForFunction(() => {
        const btn = document.querySelector('button.primary-btn.btn-sm');
        return btn && !btn.hasAttribute('disabled');
      }, { timeout: 8000 });
    } catch {
      console.log('[DevTools] Timed out waiting for sync button to re-enable, continuing to capture logs...');
    }

    const toast = optionsPage.locator('.noodle-toast');
    if (await toast.isVisible().catch(() => false)) {
      const toastText = await toast.innerText();
      console.log(`[DevTools UI Toast] ${toastText}`);
    }

    const finalSwLogs: string[] = await background.evaluate(() => (globalThis as any).__sw_logs || []);
    console.log('\n--- 3. ALL SERVICE WORKER LOGS & NETWORK ACTIVITY ---');
    for (const log of finalSwLogs) {
      console.log(log);
    }
  });

  test('TC-EXT-DEVTOOLS-02: Complete Successful Sync pipeline with DevTools inspection and UI updates', async ({ context, optionsPage }) => {
    let [background] = context.serviceWorkers();
    if (!background) {
      background = await context.waitForEvent('serviceworker', { timeout: 10000 });
    }

    const pageLogs: string[] = [];
    optionsPage.on('console', (msg) => {
      pageLogs.push(`[Page Console ${msg.type().toUpperCase()}] ${msg.text()}`);
    });

    // Mock Moodle API responses in the Service Worker fetch
    await background.evaluate(() => {
      const g = globalThis as any;
      g.__sw_success_logs = [];

      const wrap = (type: string) => {
        const orig = (console as any)[type];
        (console as any)[type] = (...args: any[]) => {
          g.__sw_success_logs.push(`[SW ${type.toUpperCase()}] ` + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
          orig?.apply(console, args);
        };
      };
      wrap('log');
      wrap('info');
      wrap('warn');
      wrap('error');

      const origFetch = g.fetch;
      g.fetch = async (...args: any[]) => {
        const urlStr = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : String(args[0]));
        const parsed = new URL(urlStr, 'https://moodle.tau.ac.il');

        if (parsed.pathname.includes('/webservice/rest/server.php')) {
          const wsfunction = parsed.searchParams.get('wsfunction');
          g.__sw_success_logs.push(`[DevTools Mock] Intercepted Moodle REST call: ${wsfunction}`);

          let data: any = {};
          if (wsfunction === 'core_webservice_get_site_info') {
            data = {
              userid: 42,
              username: 'test_student',
              fullname: 'Israel Israeli',
              userissiteadmin: false,
            };
          } else if (wsfunction === 'core_calendar_get_calendar_events') {
            data = { events: [] };
          } else if (wsfunction === 'core_enrol_get_users_courses') {
            data = [
              { id: 9999, fullname: 'Introduction to Computer Science', shortname: 'CS101' },
            ];
          } else if (wsfunction === 'mod_assign_get_assignments') {
            data = {
              courses: [
                {
                  id: 9999,
                  assignments: [
                    {
                      id: 888,
                      cmid: 777,
                      name: 'Homework 1 - Recursion',
                      duedate: Math.floor(Date.now() / 1000) + 86400, // Due in 24 hours
                      intro: 'Solve recursion problems',
                      nosubmissions: 0,
                    },
                  ],
                },
              ],
            };
          } else if (wsfunction === 'core_course_get_contents') {
            data = [];
          } else if (wsfunction === 'gradereport_user_get_grade_items') {
            data = { usergrades: [] };
          }

          return new Response(JSON.stringify(data), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        return origFetch.apply(g, args);
      };
    });

    // Seed state with mock token and tracked course 9999
    await optionsPage.evaluate(async () => {
      await chrome.storage.local.set({
        wstoken: 'VALID_MOCK_DEVTOOLS_TOKEN',
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
        trackedCourseIds: [9999],
        settings: {
          theme: 'noodle',
          language: 'en',
          coursesColorMap: { 9999: '#10b981' },
          coursesCustomNames: { 9999: 'CS101 Intro' },
          hiddenAssignments: [],
          completedAssignments: [],
          uncompletedAssignments: [],
        },
      });
    });

    await optionsPage.reload();
    await optionsPage.waitForLoadState('domcontentloaded');

    const syncButton = optionsPage.locator('button.primary-btn.btn-sm').filter({ hasText: /Sync|🔄/ });
    await expect(syncButton).toBeVisible();

    console.log('[DevTools] Triggering full successful sync via UI button...');
    await syncButton.click();

    // Verify assignment card appears in UI after sync
    const assignmentCard = optionsPage.locator('.assignment-card').filter({ hasText: 'Homework 1 - Recursion' });
    await expect(assignmentCard).toBeVisible({ timeout: 10000 });
    console.log('[DevTools UI] Confirmed: "Homework 1 - Recursion" rendered successfully in Options Dashboard!');

    // Retrieve SW logs
    const swLogs: string[] = await background.evaluate(() => (globalThis as any).__sw_success_logs || []);
    console.log('\n--- SUCCESSFUL SYNC TRACE ---');
    for (const log of swLogs) {
      console.log('  ', log);
    }

    // Verify storage was updated with sync result
    const storedSync = await optionsPage.evaluate(async () => {
      return chrome.storage.local.get('cachedSyncResult');
    });
    expect(storedSync.cachedSyncResult.assignments.length).toBeGreaterThan(0);
    expect(storedSync.cachedSyncResult.assignments[0].name).toBe('Homework 1 - Recursion');
    console.log('[DevTools Storage] Verified cachedSyncResult contains synced assignment!');
  });
});
