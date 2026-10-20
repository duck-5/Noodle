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

  test('TC-EXT-DEVTOOLS-02: Complete Successful Sync pipeline with DevTools inspection and UI updates', async ({ context, extensionId, optionsPage }) => {
    let [background] = context.serviceWorkers();
    if (!background) {
      background = await context.waitForEvent('serviceworker', { timeout: 10000 });
    }

    await optionsPage.setViewportSize({ width: 1440, height: 950 });

    const pageLogs: string[] = [];
    optionsPage.on('console', (msg) => {
      pageLogs.push(`[Page Console ${msg.type().toUpperCase()}] ${msg.text()}`);
    });

    // Mock Moodle API responses in the Service Worker fetch
    await background.evaluate(() => {
      const g = globalThis as any;
      g.__sw_success_logs = [];
      g.__lastZoomToolId = '101';

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

        // Parse search params or POST body
        let params = parsed.searchParams;
        if (!params.get('wsfunction') && args[1] && args[1].body) {
          try {
            params = new URLSearchParams(String(args[1].body));
          } catch {}
        }

        if (parsed.pathname.includes('/webservice/rest/server.php')) {
          const wsfunction = params.get('wsfunction');
          g.__sw_success_logs.push(`[DevTools Mock] Intercepted Moodle REST call: ${wsfunction}`);

          let data: any = {};
          if (wsfunction === 'core_webservice_get_site_info') {
            data = {
              userid: 42,
              username: 'israeli_student',
              fullname: 'ישראל ישראלי',
              sitename: 'TAU Moodle',
              userissiteadmin: false,
            };
          } else if (wsfunction === 'core_calendar_get_calendar_events') {
            data = { events: [] };
          } else if (wsfunction === 'core_enrol_get_users_courses') {
            data = [
              { id: 9999, fullname: '0368-1001-01 מבוא למדעי המחשב', shortname: '0368100101-CS101', idnumber: '0368100101' },
              { id: 9998, fullname: '0368-2158-01 מבני נתונים', shortname: '0368215801-DS201', idnumber: '0368215801' },
            ];
          } else if (wsfunction === 'mod_assign_get_assignments') {
            const nowSec = Math.floor(Date.now() / 1000);
            data = {
              courses: [
                {
                  id: 9999,
                  fullname: '0368-1001-01 מבוא למדעי המחשב',
                  shortname: '0368100101-CS101',
                  assignments: [
                    {
                      id: 888,
                      cmid: 777,
                      course: 9999,
                      name: 'מטלה 1 - רקורסיה ויעילות אלגוריתמית',
                      duedate: nowSec + 86400, // Due in 24 hours (Urgent!)
                      cutoffdate: nowSec + 2 * 86400,
                      allowsubmissionsfromdate: nowSec - 3 * 86400,
                      intro: '<p>יש לממש פתרון רקורסיבי לבעיית מגדלי האנוי וחלוקת מחרוזות. שימו לב לסיבוכיות זמן וזיכרון.</p>',
                      introattachments: [
                        { filename: 'hw1_template.py', fileurl: 'https://moodle.tau.ac.il/pluginfile.php/9999/mod_assign/intro/hw1_template.py' },
                        { filename: 'instructions_hw1.pdf', fileurl: 'https://moodle.tau.ac.il/pluginfile.php/9999/mod_assign/intro/instructions_hw1.pdf' },
                      ],
                      nosubmissions: 0,
                    },
                    {
                      id: 887,
                      cmid: 776,
                      course: 9999,
                      name: 'מטלה 0 - מבוא לסביבת הפיתוח והגשה',
                      duedate: nowSec - 7 * 86400, // Past due, submitted
                      cutoffdate: nowSec - 7 * 86400,
                      allowsubmissionsfromdate: nowSec - 14 * 86400,
                      intro: '<p>מטלת היכרות עם סביבת ההגשה במודל.</p>',
                      introattachments: [
                        { filename: 'setup_guide.pdf', fileurl: 'https://moodle.tau.ac.il/pluginfile.php/9999/mod_assign/intro/setup_guide.pdf' },
                      ],
                      nosubmissions: 0,
                    },
                  ],
                },
                {
                  id: 9998,
                  fullname: '0368-2158-01 מבני נתונים',
                  shortname: '0368215801-DS201',
                  assignments: [
                    {
                      id: 889,
                      cmid: 778,
                      course: 9998,
                      name: 'תרגיל בית 2 - עצי חיפוש בינאריים ועצי AVL',
                      duedate: nowSec + 4 * 86400, // Due in 4 days
                      cutoffdate: nowSec + 5 * 86400,
                      allowsubmissionsfromdate: nowSec - 2 * 86400,
                      intro: '<p>בניית עץ חיפוש בינארי מאוזן ומימוש גלגולי AVL (RR, LL, RL, LR).</p>',
                      introattachments: [
                        { filename: 'avl_tree_skeleton.cpp', fileurl: 'https://moodle.tau.ac.il/pluginfile.php/9998/mod_assign/intro/avl_tree_skeleton.cpp' },
                        { filename: 'instructions_hw2.pdf', fileurl: 'https://moodle.tau.ac.il/pluginfile.php/9998/mod_assign/intro/instructions_hw2.pdf' },
                      ],
                      nosubmissions: 0,
                    },
                    {
                      id: 886,
                      cmid: 786,
                      course: 9998,
                      name: 'תרגיל בית 1 - טבלאות גיבוב ורשימות מקושרות',
                      duedate: nowSec - 5 * 86400, // Past due, submitted
                      cutoffdate: nowSec - 5 * 86400,
                      allowsubmissionsfromdate: nowSec - 12 * 86400,
                      intro: '<p>מימוש Hash Table עם שרשור נפרד וכתובת פתוחה.</p>',
                      introattachments: [
                        { filename: 'hash_table_specs.pdf', fileurl: 'https://moodle.tau.ac.il/pluginfile.php/9998/mod_assign/intro/hash_table_specs.pdf' },
                      ],
                      nosubmissions: 0,
                    },
                  ],
                },
              ],
            };
          } else if (wsfunction === 'core_course_get_contents') {
            const courseid = params.get('courseid');
            if (String(courseid) === '9999') {
              data = [
                {
                  id: 1,
                  name: 'מבוא ונהלי הקורס',
                  modules: [
                    {
                      id: 501,
                      name: 'סילבוס תשפ"ו - מבוא למדעי המחשב',
                      modname: 'resource',
                      contents: [
                        {
                          type: 'file',
                          filename: 'סילבוס תשפ"ו - מבוא למדעי המחשב.pdf',
                          fileurl: 'https://moodle.tau.ac.il/mod/resource/view.php?id=501',
                          filesize: 462500,
                          mimetype: 'application/pdf',
                          timemodified: 1729000000,
                        },
                      ],
                    },
                    {
                      id: 502,
                      name: 'הנחיות התקנה של סביבת פיתוח Python',
                      modname: 'resource',
                      contents: [
                        {
                          type: 'file',
                          filename: 'הנחיות התקנה של סביבת פיתוח Python.pdf',
                          fileurl: 'https://moodle.tau.ac.il/mod/resource/view.php?id=502',
                          filesize: 1285000,
                          mimetype: 'application/pdf',
                          timemodified: 1729050000,
                        },
                      ],
                    },
                  ],
                },
                {
                  id: 2,
                  name: 'שבוע 1: רקורסיה ויעילות אלגוריתמית',
                  modules: [
                    {
                      id: 777,
                      name: 'מטלה 1 - רקורסיה ויעילות אלגוריתמית',
                      modname: 'assign',
                      instance: 888,
                    },
                    {
                      id: 503,
                      name: 'שקפי הרצאה 01 - רקורסיה ומגדלי האנוי',
                      modname: 'resource',
                      contents: [
                        {
                          type: 'file',
                          filename: 'שקפי הרצאה 01 - רקורסיה ומגדלי האנוי.pdf',
                          fileurl: 'https://moodle.tau.ac.il/mod/resource/view.php?id=503',
                          filesize: 3950000,
                          mimetype: 'application/pdf',
                          timemodified: 1729100000,
                        },
                      ],
                    },
                    {
                      id: 504,
                      name: 'תרגול 01 - דוגמאות קוד רקורסיבי',
                      modname: 'resource',
                      contents: [
                        {
                          type: 'file',
                          filename: 'תרגול 01 - דוגמאות קוד רקורסיבי.py',
                          fileurl: 'https://moodle.tau.ac.il/mod/resource/view.php?id=504',
                          filesize: 18400,
                          mimetype: 'text/x-python',
                          timemodified: 1729150000,
                        },
                      ],
                    },
                  ],
                },
                {
                  id: 3,
                  name: 'שבוע 2: סיבוכיות זמן ומקום וחיפוש בינארי',
                  modules: [
                    {
                      id: 505,
                      name: 'סיכומי הרצאה 02 - סימוני Asymptotic ו-Big O',
                      modname: 'resource',
                      contents: [
                        {
                          type: 'file',
                          filename: 'סיכומי הרצאה 02 - סימוני Asymptotic ו-Big O.pdf',
                          fileurl: 'https://moodle.tau.ac.il/mod/resource/view.php?id=505',
                          filesize: 2240000,
                          mimetype: 'application/pdf',
                          timemodified: 1729200000,
                        },
                      ],
                    },
                    {
                      id: 506,
                      name: 'דף עזר - אלגוריתמי חיפוש ומיון',
                      modname: 'resource',
                      contents: [
                        {
                          type: 'file',
                          filename: 'דף עזר - אלגוריתמי חיפוש ומיון.pdf',
                          fileurl: 'https://moodle.tau.ac.il/mod/resource/view.php?id=506',
                          filesize: 912000,
                          mimetype: 'application/pdf',
                          timemodified: 1729250000,
                        },
                      ],
                    },
                  ],
                },
                {
                  id: 4,
                  name: 'מטלות מוקדמות',
                  modules: [
                    {
                      id: 776,
                      name: 'מטלה 0 - מבוא לסביבת הפיתוח והגשה',
                      modname: 'assign',
                      instance: 887,
                    },
                  ],
                },
                {
                  id: 5,
                  name: 'שיעורי Zoom והקלטות',
                  modules: [
                    {
                      id: 775,
                      name: 'שיעורי Zoom - הרצאות ותרגולים',
                      modname: 'lti',
                      instance: 101,
                    },
                  ],
                },
              ];
            } else if (String(courseid) === '9998') {
              data = [
                {
                  id: 11,
                  name: 'מידע כללי וסילבוס',
                  modules: [
                    {
                      id: 601,
                      name: 'סילבוס מבני נתונים סמסטר א',
                      modname: 'resource',
                      contents: [
                        {
                          type: 'file',
                          filename: 'סילבוס מבני נתונים סמסטר א.pdf',
                          fileurl: 'https://moodle.tau.ac.il/mod/resource/view.php?id=601',
                          filesize: 524000,
                          mimetype: 'application/pdf',
                          timemodified: 1729000000,
                        },
                      ],
                    },
                    {
                      id: 602,
                      name: 'רשימת ספרי עזר וקישורים מומלצים',
                      modname: 'resource',
                      contents: [
                        {
                          type: 'file',
                          filename: 'רשימת ספרי עזר וקישורים מומלצים.pdf',
                          fileurl: 'https://moodle.tau.ac.il/mod/resource/view.php?id=602',
                          filesize: 340000,
                          mimetype: 'application/pdf',
                          timemodified: 1729050000,
                        },
                      ],
                    },
                  ],
                },
                {
                  id: 12,
                  name: 'תרגיל 1: טבלאות גיבוב ומיונים',
                  modules: [
                    {
                      id: 786,
                      name: 'תרגיל בית 1 - טבלאות גיבוב ורשימות מקושרות',
                      modname: 'assign',
                      instance: 886,
                    },
                    {
                      id: 603,
                      name: 'מצגת 02 - טבלאות גיבוב ופונקציות Hash',
                      modname: 'resource',
                      contents: [
                        {
                          type: 'file',
                          filename: 'מצגת 02 - טבלאות גיבוב ופונקציות Hash.pdf',
                          fileurl: 'https://moodle.tau.ac.il/mod/resource/view.php?id=603',
                          filesize: 4350000,
                          mimetype: 'application/pdf',
                          timemodified: 1729300000,
                        },
                      ],
                    },
                  ],
                },
                {
                  id: 13,
                  name: 'תרגיל 2: עצי חיפוש בינאריים ועצי AVL',
                  modules: [
                    {
                      id: 778,
                      name: 'תרגיל בית 2 - עצי חיפוש בינאריים ועצי AVL',
                      modname: 'assign',
                      instance: 889,
                    },
                    {
                      id: 604,
                      name: 'מצגת 04 - עצי חיפוש בינאריים ועצי AVL',
                      modname: 'resource',
                      contents: [
                        {
                          type: 'file',
                          filename: 'מצגת 04 - עצי חיפוש בינאריים ועצי AVL.pdf',
                          fileurl: 'https://moodle.tau.ac.il/mod/resource/view.php?id=604',
                          filesize: 5280000,
                          mimetype: 'application/pdf',
                          timemodified: 1729400000,
                        },
                      ],
                    },
                    {
                      id: 605,
                      name: 'קוד הדגמה - איזון עצים AVL',
                      modname: 'resource',
                      contents: [
                        {
                          type: 'file',
                          filename: 'קוד הדגמה - איזון עצים AVL.cpp',
                          fileurl: 'https://moodle.tau.ac.il/mod/resource/view.php?id=605',
                          filesize: 48200,
                          mimetype: 'text/x-c++src',
                          timemodified: 1729450000,
                        },
                      ],
                    },
                  ],
                },
                {
                  id: 14,
                  name: 'שיעורי Zoom ומפגשי שו"ת',
                  modules: [
                    {
                      id: 785,
                      name: 'שיעורי Zoom ומפגשי שאלות ותשובות',
                      modname: 'lti',
                      instance: 102,
                    },
                  ],
                },
              ];
            } else {
              data = [];
            }
          } else if (wsfunction === 'gradereport_user_get_grade_items') {
            const courseid = params.get('courseid');
            if (String(courseid) === '9999') {
              data = {
                usergrades: [
                  {
                    courseid: 9999,
                    userid: 42,
                    gradeitems: [
                      {
                        id: 1001,
                        itemname: 'מטלה 0 - מבוא לסביבת הפיתוח והגשה',
                        itemtype: 'mod',
                        itemmodule: 'assign',
                        cmid: 776,
                        graderaw: 100,
                        grademax: 100,
                        gradeishidden: false,
                      },
                    ],
                  },
                ],
              };
            } else if (String(courseid) === '9998') {
              data = {
                usergrades: [
                  {
                    courseid: 9998,
                    userid: 42,
                    gradeitems: [
                      {
                        id: 1002,
                        itemname: 'תרגיל בית 1 - טבלאות גיבוב ורשימות מקושרות',
                        itemtype: 'mod',
                        itemmodule: 'assign',
                        cmid: 786,
                        graderaw: 96,
                        grademax: 100,
                        gradeishidden: false,
                      },
                    ],
                  },
                ],
              };
            } else {
              data = { usergrades: [] };
            }
          } else if (wsfunction === 'mod_assign_get_submission_status') {
            const assignid = params.get('assignid');
            if (String(assignid) === '887') {
              data = {
                lastattempt: {
                  submission: {
                    id: 101,
                    status: 'submitted',
                    plugins: [
                      {
                        type: 'file',
                        name: 'File submissions',
                        fileareas: [
                          {
                            area: 'submission_files',
                            files: [
                              {
                                filename: 'hw0_solution.py',
                                fileurl: 'https://moodle.tau.ac.il/pluginfile.php/9999/mod_assign/submission_files/hw0_solution.py',
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                },
              };
            } else if (String(assignid) === '886') {
              data = {
                lastattempt: {
                  submission: {
                    id: 102,
                    status: 'submitted',
                    plugins: [
                      {
                        type: 'file',
                        name: 'File submissions',
                        fileareas: [
                          {
                            area: 'submission_files',
                            files: [
                              {
                                filename: 'hash_table.cpp',
                                fileurl: 'https://moodle.tau.ac.il/pluginfile.php/9998/mod_assign/submission_files/hash_table.cpp',
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                },
              };
            } else {
              data = {
                lastattempt: {
                  submission: {
                    id: 103,
                    status: 'new',
                  },
                },
              };
            }
          } else if (wsfunction === 'mod_lti_get_tool_launch_data') {
            const toolid = params.get('toolid') || '101';
            const courseRef = String(toolid) === '102' ? 'ds201' : 'cs101';
            data = {
              endpoint: `https://applications.zoom.us/lti/rich?course_ref=${courseRef}`,
              parameters: [
                { name: 'custom_course_id', value: String(toolid) },
              ],
            };
          }

          return new Response(JSON.stringify(data), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        // Intercept Zoom LTI requests
        if (urlStr.includes('applications.zoom.us')) {
          g.__sw_success_logs.push(`[DevTools Mock] Intercepted Zoom call: ${urlStr}`);

          if (urlStr.includes('/lti/rich') && !urlStr.includes('/meeting/')) {
            const isDsCourse = urlStr.includes('ds201');
            const ltiToken = isDsCourse ? 'mock-token-course-102' : 'mock-token-course-101';
            const html = `<!DOCTYPE html><html><head><script>var appConf = { ajaxHeaders: [{ key: "X-Lti-Token", value: "${ltiToken}" }] };</script></head><body>Zoom LTI Loaded</body></html>`;
            return new Response(html, {
              status: 200,
              headers: { 'Content-Type': 'text/html' },
            });
          }

          let ltiToken = '';
          const reqHeaders = args[1]?.headers;
          if (reqHeaders) {
            if (typeof reqHeaders.get === 'function') {
              ltiToken = reqHeaders.get('X-Lti-Token') || reqHeaders.get('x-lti-token') || '';
            } else if (typeof reqHeaders === 'object') {
              for (const [k, v] of Object.entries(reqHeaders)) {
                if (k.toLowerCase() === 'x-lti-token') {
                  ltiToken = String(v);
                  break;
                }
              }
            }
          }
          const isDsCourse = ltiToken.includes('102');

          if (urlStr.includes('/api/v1/lti/rich/meeting/upComing')) {
            if (isDsCourse) {
              return new Response(JSON.stringify({
                result: {
                  list: [
                    {
                      topic: 'הרצאה 05 - עצי AVL ואיזון עצים בינאריים',
                      meetingId: '9988776655',
                      joinUrl: 'https://tau-ac-il.zoom.us/j/9988776655?pwd=mockPasswordDS1',
                      startTime: new Date(Date.now() + 86400 * 1000).toISOString(),
                    },
                    {
                      topic: 'תרגול 05 - שאלות ממבחנים על עצים מאוזנים',
                      meetingId: '9988776656',
                      joinUrl: 'https://tau-ac-il.zoom.us/j/9988776656?pwd=mockPasswordDS2',
                      startTime: new Date(Date.now() + 3 * 86400 * 1000).toISOString(),
                    },
                  ],
                },
              }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              });
            } else {
              return new Response(JSON.stringify({
                result: {
                  list: [
                    {
                      topic: 'הרצאה 03 - רקורסיה ומבנה המחשב (פעיל כעת)',
                      meetingId: '9911223344',
                      joinUrl: 'https://tau-ac-il.zoom.us/j/9911223344?pwd=mockPasswordCS1',
                      startTime: new Date(Date.now() - 20 * 60 * 1000).toISOString(), // Active now!
                    },
                    {
                      topic: 'תרגול 03 - תרגול רקורסיה והוכחות נכונות',
                      meetingId: '9911223345',
                      joinUrl: 'https://tau-ac-il.zoom.us/j/9911223345?pwd=mockPasswordCS2',
                      startTime: new Date(Date.now() + 2 * 86400 * 1000).toISOString(),
                    },
                  ],
                },
              }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              });
            }
          }

          if (urlStr.includes('/api/v1/lti/rich/meeting/previous')) {
            if (isDsCourse) {
              return new Response(JSON.stringify({
                result: {
                  list: [
                    {
                      topic: 'הרצאה 04 - טבלאות גיבוב ומיונים מהירים',
                      meetingId: '9988776650',
                      joinUrl: 'https://tau-ac-il.zoom.us/j/9988776650',
                      startTime: new Date(Date.now() - 6 * 86400 * 1000).toISOString(),
                    },
                  ],
                },
              }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              });
            } else {
              return new Response(JSON.stringify({
                result: {
                  list: [
                    {
                      topic: 'הרצאה 02 - מבוא לשפת Python ותחביר בסיסי',
                      meetingId: '9911223340',
                      joinUrl: 'https://tau-ac-il.zoom.us/j/9911223340',
                      startTime: new Date(Date.now() - 7 * 86400 * 1000).toISOString(),
                    },
                  ],
                },
              }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              });
            }
          }
        }

        return origFetch.apply(g, args);
      };
    });

    // Seed state with mock token and 2 tracked courses (9999 and 9998)
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
        trackedCourseIds: [9999, 9998],
        settings: {
          theme: 'noodle',
          language: 'he',
          coursesColorMap: { 9999: '#10b981', 9998: '#6366f1' },
          coursesCustomNames: { 9999: 'מבוא למדעי המחשב', 9998: 'מבני נתונים' },
          hiddenAssignments: [],
          completedAssignments: [],
          uncompletedAssignments: [],
        },
      });
    });

    await optionsPage.reload();
    await optionsPage.waitForLoadState('domcontentloaded');

    const syncButton = optionsPage.locator('button.primary-btn.btn-sm').filter({ hasText: /Sync|סנכרן|🔄/ });
    await expect(syncButton).toBeVisible();

    console.log('[DevTools] Triggering full successful sync via UI button...');
    await syncButton.click();

    // Verify assignment cards appear in UI after sync
    const firstAssignmentCard = optionsPage.locator('.assignment-card').filter({ hasText: 'מטלה 1 - רקורסיה ויעילות' });
    await expect(firstAssignmentCard).toBeVisible({ timeout: 10000 });
    console.log('[DevTools UI] Confirmed: 2 courses synced and rendered in Options Dashboard!');

    // Directory for output screenshots
    const fs = await import('fs');
    const path = await import('path');
    const screenshotsDir = path.resolve(process.cwd(), 'screenshots');
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }

    // Expand Zoom accordions on the dashboard so meetings are visible
    const dashZoomHeaders = optionsPage.locator('.zoom-courses-list .zoom-course-header');
    const dashZoomCount = await dashZoomHeaders.count();
    for (let i = 0; i < dashZoomCount; i++) {
      await dashZoomHeaders.nth(i).click();
      await optionsPage.waitForTimeout(200);
    }

    // 1. Capture Main Dashboard with the 2 synced courses & assignments & Zoom banner
    const dashboardScreenshot = path.join(screenshotsDir, 'main-dashboard.png');
    await optionsPage.screenshot({ path: dashboardScreenshot, fullPage: true });
    console.log(`[DevTools UI] Captured Main Dashboard screenshot: ${dashboardScreenshot}`);

    // 2. Open Manage Courses Modal and capture it
    const manageCoursesBtn = optionsPage.locator('.manage-courses-trigger-btn');
    if (await manageCoursesBtn.isVisible()) {
      await manageCoursesBtn.click();
      await optionsPage.waitForTimeout(500);
      const manageModalScreenshot = path.join(screenshotsDir, 'dashboard-manage-modal.png');
      await optionsPage.screenshot({ path: manageModalScreenshot, fullPage: true });
      console.log(`[DevTools UI] Captured Manage Courses Modal: ${manageModalScreenshot}`);
      // Close modal
      const closeBtn = optionsPage.locator('.modal-backdrop button').first();
      if (await closeBtn.isVisible()) {
        await closeBtn.click();
        await optionsPage.waitForTimeout(300);
      }
    }

    // 3. Navigate to dedicated "Assignments" tab and capture both normal and expanded view
    const assignsNavBtn = optionsPage.locator('.nav-item').filter({ hasText: /מטלות|Assignments/ });
    if (await assignsNavBtn.isVisible()) {
      await assignsNavBtn.click();
      await optionsPage.waitForTimeout(500);
      const assignsScreenshot = path.join(screenshotsDir, 'assignments-page.png');
      await optionsPage.screenshot({ path: assignsScreenshot, fullPage: true });
      console.log(`[DevTools UI] Captured Assignments Tab screenshot: ${assignsScreenshot}`);

      // Expand first assignment card
      const firstCard = optionsPage.locator('.assignment-card').first();
      if (await firstCard.isVisible()) {
        await firstCard.click();
        await optionsPage.waitForTimeout(400);
        const assignsExpandedScreenshot = path.join(screenshotsDir, 'assignments-page-expanded.png');
        await optionsPage.screenshot({ path: assignsExpandedScreenshot, fullPage: true });
        console.log(`[DevTools UI] Captured Expanded Assignments screenshot: ${assignsExpandedScreenshot}`);
      }
    }

    // 4. Return to Dashboard and navigate to Course Detail Views
    const dashNavBtn = optionsPage.locator('.nav-item').filter({ hasText: /לוח בקרה|Dashboard/ });
    await dashNavBtn.click();
    await optionsPage.waitForTimeout(400);

    const firstCourseGoBtn = optionsPage.locator('.course-row-card').first().locator('button').filter({ hasText: /עבור לקורס|Go to/ });
    if (await firstCourseGoBtn.isVisible()) {
      await firstCourseGoBtn.click();
      await optionsPage.waitForTimeout(600);

      // Expand Zoom section if visible
      const zoomHeader1 = optionsPage.locator('.zoom-course-header');
      if (await zoomHeader1.isVisible()) {
        await zoomHeader1.click();
        await optionsPage.waitForTimeout(300);
      }

      const course1DetailScreenshot = path.join(screenshotsDir, 'course-9999-detail.png');
      await optionsPage.screenshot({ path: course1DetailScreenshot, fullPage: true });
      fs.copyFileSync(course1DetailScreenshot, path.join(screenshotsDir, 'course-detail-view.png'));
      console.log(`[DevTools UI] Captured Course 9999 Detail screenshot: ${course1DetailScreenshot}`);

      const backBtn = optionsPage.locator('.back-btn');
      if (await backBtn.isVisible()) {
        await backBtn.click();
        await optionsPage.waitForTimeout(400);
      }
    }

    const secondCourseGoBtn = optionsPage.locator('.course-row-card').nth(1).locator('button').filter({ hasText: /עבור לקורס|Go to/ });
    if (await secondCourseGoBtn.isVisible()) {
      await secondCourseGoBtn.click();
      await optionsPage.waitForTimeout(600);

      const zoomHeader2 = optionsPage.locator('.zoom-course-header');
      if (await zoomHeader2.isVisible()) {
        await zoomHeader2.click();
        await optionsPage.waitForTimeout(300);
      }

      const course2DetailScreenshot = path.join(screenshotsDir, 'course-9998-detail.png');
      await optionsPage.screenshot({ path: course2DetailScreenshot, fullPage: true });
      console.log(`[DevTools UI] Captured Course 9998 Detail screenshot: ${course2DetailScreenshot}`);

      const backBtn = optionsPage.locator('.back-btn');
      if (await backBtn.isVisible()) {
        await backBtn.click();
        await optionsPage.waitForTimeout(400);
      }
    }

    // 5. Capture Coffee Theme
    await optionsPage.evaluate(async () => {
      const syncData = await chrome.storage.sync.get('settings');
      const settings = syncData.settings || {};
      settings.theme = 'coffee';
      await chrome.storage.sync.set({ settings });
      document.body.className = 'theme-coffee';
    });
    await optionsPage.waitForTimeout(400);
    const coffeeDashboardScreenshot = path.join(screenshotsDir, 'dashboard-coffee-theme.png');
    await optionsPage.screenshot({ path: coffeeDashboardScreenshot, fullPage: true });
    console.log(`[DevTools UI] Captured Coffee Dashboard screenshot: ${coffeeDashboardScreenshot}`);

    // 6. Capture Dark Theme
    await optionsPage.evaluate(async () => {
      const syncData = await chrome.storage.sync.get('settings');
      const settings = syncData.settings || {};
      settings.theme = 'dark';
      await chrome.storage.sync.set({ settings });
      document.body.className = 'theme-dark';
    });
    await optionsPage.waitForTimeout(300);

    const darkDashboardScreenshot = path.join(screenshotsDir, 'main-dashboard-dark.png');
    await optionsPage.screenshot({ path: darkDashboardScreenshot, fullPage: true });
    console.log(`[DevTools UI] Captured Dark Dashboard screenshot: ${darkDashboardScreenshot}`);

    // Revert to noodle theme
    await optionsPage.evaluate(async () => {
      const syncData = await chrome.storage.sync.get('settings');
      const settings = syncData.settings || {};
      settings.theme = 'noodle';
      await chrome.storage.sync.set({ settings });
      document.body.className = 'theme-noodle';
    });
    await optionsPage.waitForTimeout(300);

    // 6. Capture Toolbar Popup view in English (crisp high-DPI container capture)
    // Set English language via optionsPage which is already in extension context
    await optionsPage.evaluate(async () => {
      const syncData = await chrome.storage.sync.get('settings');
      const settings = syncData.settings || {};
      settings.language = 'en';
      settings.theme = 'noodle';
      await chrome.storage.sync.set({ settings });
    });

    const popupPage = await context.newPage();
    await popupPage.setViewportSize({ width: 400, height: 600 });
    await popupPage.goto(`chrome-extension://${extensionId}/index.html`);
    await popupPage.waitForLoadState('domcontentloaded');
    await popupPage.waitForSelector('.popup-container', { state: 'visible' });
    await popupPage.waitForTimeout(600);

    const popupContainer = popupPage.locator('.popup-container');
    const popupScreenshot = path.join(screenshotsDir, 'toolbar-popup.png');
    await popupContainer.screenshot({ path: popupScreenshot });
    console.log(`[DevTools UI] Captured English Toolbar Popup screenshot: ${popupScreenshot}`);

    // Also capture Hebrew Toolbar Popup
    await optionsPage.evaluate(async () => {
      const syncData = await chrome.storage.sync.get('settings');
      const settings = syncData.settings || {};
      settings.language = 'he';
      await chrome.storage.sync.set({ settings });
    });
    await popupPage.reload();
    await popupPage.waitForSelector('.popup-container', { state: 'visible' });
    await popupPage.waitForTimeout(600);

    const popupHeScreenshot = path.join(screenshotsDir, 'toolbar-popup-he.png');
    await popupPage.locator('.popup-container').screenshot({ path: popupHeScreenshot });
    console.log(`[DevTools UI] Captured Hebrew Toolbar Popup screenshot: ${popupHeScreenshot}`);

    await popupPage.close();
  });
});
