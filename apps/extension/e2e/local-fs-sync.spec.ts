import { expect, test } from './fixtures.js';

const MOCK_COURSE_ID = 101;
const MOCK_COURSE_NAME = '0368-2158 מבני נתונים: Data Structures';
const EXPECTED_COURSE_FOLDER = '0368-2158 מבני נתונים_ Data Structures';
const OPFS_ROOT_NAME = 'NoodleE2ERoot';

const FILE_LECTURE_URL =
  'https://moodle.tau.ac.il/pluginfile.php/1001/mod_resource/content/1/Lecture%201%3F.pdf';
const FILE_FOLDER_URL =
  'https://moodle.tau.ac.il/pluginfile.php/1002/mod_folder/content/0/Lab01/guide.txt?forcedownload=1';
const FILE_ASSIGN_URL =
  'https://moodle.tau.ac.il/pluginfile.php/1003/mod_assign/introattachment/0/HW1.pdf';
const FILE_INCREMENTAL_URL =
  'https://moodle.tau.ac.il/pluginfile.php/1004/mod_resource/content/1/Slides2.pdf';
const FILE_TRAP_URL =
  'https://moodle.tau.ac.il/pluginfile.php/1005/mod_resource/content/1/Trap.pdf';

test.describe('Local Filesystem Sync (Issue #18)', () => {
  test('TC-LFS-01: Local FS Sync defaults to OFF and is strictly excluded from cloud settings sync', async ({
    optionsPage,
  }) => {
    await optionsPage.evaluate(async (courseId) => {
      await chrome.storage.local.clear();
      await chrome.storage.sync.clear();
      await chrome.storage.local.set({
        wstoken: 'TEST_LFS_TOKEN_OFF',
        hasSeenTour: true,
        enrolledCoursesCache: [
          { id: courseId, fullname: 'Intro CS', shortname: 'CS101' },
        ],
        cachedSyncResult: {
          courses: [{ id: courseId, fullname: 'Intro CS', shortname: 'CS101' }],
          sections: [],
          assignments: [],
          quizzes: [],
          folders: [],
          links: [],
          announcements: [],
          files: [],
          meetings: [],
          recordings: [],
          errors: [],
          syncedAt: new Date().toISOString(),
        },
      });
      await chrome.storage.sync.set({
        trackedCourseIds: [courseId],
        settings: {
          theme: 'noodle',
          language: 'en',
          coursesColorMap: { [courseId]: '#3b82f6' },
          coursesCustomNames: {},
          hiddenAssignments: [],
          completedAssignments: [],
          uncompletedAssignments: [],
        },
      });
    }, MOCK_COURSE_ID);

    await optionsPage.reload();
    await optionsPage.waitForLoadState('domcontentloaded');

    const settingsNavBtn = optionsPage
      .locator('.nav-item')
      .filter({ hasText: /הגדרות|Settings/ });
    await settingsNavBtn.click();

    const masterToggle = optionsPage.locator('#local-fs-enabled-toggle');
    await expect(masterToggle).toBeAttached();
    await expect(
      optionsPage.locator('label.switch:has(#local-fs-enabled-toggle) .slider')
    ).toBeVisible();
    await expect(masterToggle).not.toBeChecked();

    // Sub-settings should remain hidden while Local FS Sync is OFF
    await expect(optionsPage.locator('.local-fs-subsettings')).toBeHidden();

    // Verify chrome.storage.sync contains zero localFs keys (machine-local isolation)
    const storageCheck = await optionsPage.evaluate(async () => {
      const syncAll = await chrome.storage.sync.get(null);
      const localRes = await chrome.storage.local.get('localFsConfig');
      return {
        syncKeys: Object.keys(syncAll),
        localFsConfig: localRes.localFsConfig || null,
      };
    });

    const syncedLocalFsKeys = storageCheck.syncKeys.filter((k) =>
      k.toLowerCase().includes('localfs')
    );
    expect(syncedLocalFsKeys).toEqual([]);
  });

  test('TC-LFS-02..06: Full initial mirror, sanitization, incremental diff, HTML guard, autoResyncMissingFiles, local open & logout teardown', async ({
    context,
    optionsPage,
  }) => {
    test.setTimeout(60000);

    // Clear OPFS directory and IndexedDB from prior runs
    await optionsPage.evaluate(async (opfsDirName) => {
      try {
        const root = await navigator.storage.getDirectory();
        await root.removeEntry(opfsDirName, { recursive: true }).catch(() => {});
      } catch {
        // ignore if empty
      }
    }, OPFS_ROOT_NAME);

    // Get MV3 service worker and install deterministic fetch mock for Moodle pluginfile downloads
    let [background] = context.serviceWorkers();
    if (!background) {
      background = await context.waitForEvent('serviceworker', { timeout: 10000 });
    }

    await background.evaluate(() => {
      const g = globalThis as unknown as {
        __lfs_origFetch?: typeof fetch;
        __lfs_fetched_urls: string[];
        fetch: typeof fetch;
      };
      if (!g.__lfs_origFetch) {
        g.__lfs_origFetch = g.fetch.bind(globalThis);
      }
      g.__lfs_fetched_urls = [];

      const origFetch = g.__lfs_origFetch;
      g.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url.includes('moodle.tau.ac.il') && url.includes('pluginfile.php')) {
          g.__lfs_fetched_urls.push(url);
          const enc = new TextEncoder();
          if (url.includes('Lecture%201%3F.pdf')) {
            return new Response(enc.encode('%PDF-1.4\n%MockLecture1'), {
              status: 200,
              headers: { 'Content-Type': 'application/pdf' },
            });
          }
          if (url.includes('guide.txt')) {
            return new Response('Lab 01 Instructions', {
              status: 200,
              headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            });
          }
          if (url.includes('HW1.pdf')) {
            return new Response(enc.encode('%PDF-1.4\n%MockHW1Spec'), {
              status: 200,
              headers: { 'Content-Type': 'application/pdf' },
            });
          }
          if (url.includes('Slides2.pdf')) {
            return new Response(enc.encode('%PDF-1.4\n%MockSlides2'), {
              status: 200,
              headers: { 'Content-Type': 'application/pdf' },
            });
          }
          if (url.includes('Trap.pdf')) {
            return new Response('<!DOCTYPE html><html><body>TAU Shibboleth SSO Login</body></html>', {
              status: 200,
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
            });
          }
        }
        return origFetch(input, init);
      };
    });

    // Seed authenticated state with mod_resource, mod_folder, and mod_assign attachments
    await optionsPage.evaluate(
      async ({
        courseId,
        courseName,
        lectureUrl,
        folderUrl,
        assignUrl,
      }) => {
        await chrome.storage.local.clear();
        await chrome.storage.sync.clear();

        const dueSec = Math.floor(Date.now() / 1000) + 86400 * 3;
        await chrome.storage.local.set({
          wstoken: 'TEST_LFS_TOKEN_MAIN',
          hasSeenTour: true,
          enrolledCoursesCache: [
            { id: courseId, fullname: courseName, shortname: 'DS' },
          ],
          cachedSyncResult: {
            courses: [{ id: courseId, fullname: courseName, shortname: 'DS' }],
            sections: [
              {
                id: 10,
                courseId,
                section: 1,
                name: 'Week 1: Intro?',
                summary: '',
                available: true,
              },
            ],
            assignments: [
              {
                id: 201,
                courseId,
                courseName,
                sectionId: 10,
                sectionName: 'Week 1: Intro?',
                name: 'HW1: Spec',
                dueDate: new Date(dueSec * 1000).toISOString(),
                dueTimestamp: dueSec,
                effectiveDueTimestamp: dueSec,
                isSubmitted: false,
                moodleUrl: 'https://moodle.tau.ac.il/mod/assign/view.php?id=201',
                attachments: [
                  {
                    name: 'HW1?.pdf',
                    url: assignUrl,
                    fileSize: 1200,
                    timeModified: 1700000300,
                  },
                ],
              },
            ],
            quizzes: [],
            folders: [
              {
                id: 301,
                courseId,
                courseName,
                sectionId: 10,
                sectionName: 'Week 1: Intro?',
                name: 'Labs',
                moodleUrl: 'https://moodle.tau.ac.il/mod/folder/view.php?id=301',
                totalSize: 20,
                files: [
                  {
                    fileName: 'guide.txt',
                    relativePath: '/Lab01/',
                    fileSize: 19,
                    fileUrl: folderUrl,
                    downloadUrl: folderUrl,
                    timeModified: 1700000200,
                  },
                ],
              },
            ],
            links: [],
            announcements: [],
            files: [
              {
                id: 1001,
                courseId,
                courseName,
                sectionId: 10,
                sectionName: 'Week 1: Intro?',
                fileName: 'Lecture 1?.pdf',
                fileSize: 1024,
                fileUrl: lectureUrl,
                downloadUrl: lectureUrl,
                timeModified: 1700000100,
              },
            ],
            meetings: [],
            recordings: [],
            errors: [],
            syncedAt: new Date().toISOString(),
          },
        });

        await chrome.storage.sync.set({
          trackedCourseIds: [courseId],
          settings: {
            theme: 'noodle',
            language: 'en',
            coursesColorMap: { [courseId]: '#3b82f6' },
            coursesCustomNames: {},
            hiddenAssignments: [],
            completedAssignments: [],
            uncompletedAssignments: [],
          },
        });
      },
      {
        courseId: MOCK_COURSE_ID,
        courseName: MOCK_COURSE_NAME,
        lectureUrl: FILE_LECTURE_URL,
        folderUrl: FILE_FOLDER_URL,
        assignUrl: FILE_ASSIGN_URL,
      }
    );

    await optionsPage.reload();
    await optionsPage.waitForLoadState('domcontentloaded');

    // Navigate to Settings and stub window.showDirectoryPicker to return real OPFS subfolder
    await optionsPage.locator('.nav-item').filter({ hasText: /הגדרות|Settings/ }).click();

    await optionsPage.evaluate(async (opfsDirName) => {
      (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> })
        .showDirectoryPicker = async () => {
        const root = await navigator.storage.getDirectory();
        return await root.getDirectoryHandle(opfsDirName, { create: true });
      };
    }, OPFS_ROOT_NAME);

    // Enable Local FS Sync -> auto-triggers directory picker & initial sync
    await optionsPage.locator('label.switch:has(#local-fs-enabled-toggle) .slider').click();

    await expect(optionsPage.locator('.local-fs-path-chip')).toContainText(OPFS_ROOT_NAME, {
      timeout: 10000,
    });

    // Wait for initial queue (3 files) to finish cleanly
    await expect(async () => {
      const status = await optionsPage.evaluate(async () => {
        const res = await chrome.storage.local.get(['localFsStatus', 'localFsQueue']);
        return {
          status: res.localFsStatus as { state?: string; syncedCountTotal?: number } | undefined,
          queueLen: Array.isArray(res.localFsQueue) ? res.localFsQueue.length : 0,
        };
      });
      expect(status.status?.state).toBe('idle');
      expect(status.queueLen).toBe(0);
      expect(status.status?.syncedCountTotal).toBe(3);
    }).toPass({ timeout: 25000 });

    // Verify mirrored directory structure & file contents inside OPFS
    const initialFiles = await optionsPage.evaluate(
      async ({ opfsDirName, courseFolder }) => {
        const root = await navigator.storage.getDirectory();
        const syncRoot = await root.getDirectoryHandle(opfsDirName, { create: false });
        const readAtPath = async (segments: string[]): Promise<string | null> => {
          try {
            let dir: FileSystemDirectoryHandle = syncRoot;
            for (let i = 0; i < segments.length - 1; i++) {
              dir = await dir.getDirectoryHandle(segments[i], { create: false });
            }
            const fh = await dir.getFileHandle(segments[segments.length - 1], { create: false });
            const file = await fh.getFile();
            return await file.text();
          } catch {
            return null;
          }
        };

        return {
          lecture: await readAtPath([courseFolder, 'Week 1_ Intro_', 'Lecture 1_.pdf']),
          folderFile: await readAtPath([courseFolder, 'Week 1_ Intro_', 'Labs', 'Lab01', 'guide.txt']),
          assignFile: await readAtPath([courseFolder, 'Week 1_ Intro_', 'HW1_ Spec', 'HW1_.pdf']),
        };
      },
      { opfsDirName: OPFS_ROOT_NAME, courseFolder: EXPECTED_COURSE_FOLDER }
    );

    expect(initialFiles.lecture).toBe('%PDF-1.4\n%MockLecture1');
    expect(initialFiles.folderFile).toBe('Lab 01 Instructions');
    expect(initialFiles.assignFile).toBe('%PDF-1.4\n%MockHW1Spec');

    // --- TC-LFS-03: Incremental sync downloads ONLY newly added files ---
    await background.evaluate(() => {
      (globalThis as unknown as { __lfs_fetched_urls: string[] }).__lfs_fetched_urls = [];
    });

    await optionsPage.evaluate(
      async ({ courseId, courseName, incrementalUrl }) => {
        const res = await chrome.storage.local.get('cachedSyncResult');
        const cached = res.cachedSyncResult as {
          files: Array<Record<string, unknown>>;
        };
        cached.files.push({
          id: 1004,
          courseId,
          courseName,
          sectionId: 10,
          sectionName: 'Week 1: Intro?',
          fileName: 'Slides2.pdf',
          fileSize: 512,
          fileUrl: incrementalUrl,
          downloadUrl: incrementalUrl,
          timeModified: 1700000400,
        });
        await chrome.storage.local.set({ cachedSyncResult: cached });
      },
      {
        courseId: MOCK_COURSE_ID,
        courseName: MOCK_COURSE_NAME,
        incrementalUrl: FILE_INCREMENTAL_URL,
      }
    );

    await optionsPage.locator('#local-fs-sync-now-btn').click();

    await expect(async () => {
      const status = await optionsPage.evaluate(async () => {
        const res = await chrome.storage.local.get('localFsStatus');
        return res.localFsStatus as { state?: string; syncedCountTotal?: number } | undefined;
      });
      expect(status?.state).toBe('idle');
      expect(status?.syncedCountTotal).toBe(4);
    }).toPass({ timeout: 15000 });

    const incrementalFetched = await background.evaluate(() => {
      return (globalThis as unknown as { __lfs_fetched_urls: string[] }).__lfs_fetched_urls;
    });
    expect(incrementalFetched).toHaveLength(1);
    expect(incrementalFetched[0]).toContain('Slides2.pdf');

    // --- HTML SSO Trap Protection Check ---
    await optionsPage.evaluate(
      async ({ courseId, courseName, trapUrl }) => {
        const res = await chrome.storage.local.get('cachedSyncResult');
        const cached = res.cachedSyncResult as {
          files: Array<Record<string, unknown>>;
        };
        cached.files.push({
          id: 1005,
          courseId,
          courseName,
          sectionId: 10,
          sectionName: 'Week 1: Intro?',
          fileName: 'Trap.pdf',
          fileSize: 256,
          fileUrl: trapUrl,
          downloadUrl: trapUrl,
          timeModified: 1700000500,
        });
        await chrome.storage.local.set({ cachedSyncResult: cached });
      },
      {
        courseId: MOCK_COURSE_ID,
        courseName: MOCK_COURSE_NAME,
        trapUrl: FILE_TRAP_URL,
      }
    );

    await optionsPage.locator('#local-fs-sync-now-btn').click();

    await expect(async () => {
      const res = await optionsPage.evaluate(async () => {
        const s = await chrome.storage.local.get('localFsStatus');
        return (s.localFsStatus as { state?: string } | undefined)?.state;
      });
      expect(res).toBe('needs_auth');
    }).toPass({ timeout: 15000 });

    const trapWrittenOnDisk = await optionsPage.evaluate(
      async ({ opfsDirName, courseFolder }) => {
        try {
          const root = await navigator.storage.getDirectory();
          const syncRoot = await root.getDirectoryHandle(opfsDirName, { create: false });
          const cDir = await syncRoot.getDirectoryHandle(courseFolder, { create: false });
          const sDir = await cDir.getDirectoryHandle('Week 1_ Intro_', { create: false });
          await sDir.getFileHandle('Trap.pdf', { create: false });
          return true;
        } catch {
          return false;
        }
      },
      { opfsDirName: OPFS_ROOT_NAME, courseFolder: EXPECTED_COURSE_FOLDER }
    );
    expect(trapWrittenOnDisk).toBe(false);

    // Clean up Trap.pdf mock item and reset needs_auth state before testing deletion re-sync
    await optionsPage.evaluate(async () => {
      const res = await chrome.storage.local.get(['cachedSyncResult', 'localFsStatus']);
      const cached = res.cachedSyncResult as {
        files: Array<{ fileName?: string }>;
      };
      cached.files = cached.files.filter((f) => f.fileName !== 'Trap.pdf');
      const status = (res.localFsStatus as Record<string, unknown>) || {};
      status.state = 'idle';
      status.lastError = null;
      await chrome.storage.local.set({
        cachedSyncResult: cached,
        localFsQueue: [],
        localFsStatus: status,
      });
    });

    // --- TC-LFS-04: Manual Deletion vs autoResyncMissingFiles Toggle ---
    await optionsPage.evaluate(
      async ({ opfsDirName, courseFolder }) => {
        const root = await navigator.storage.getDirectory();
        const syncRoot = await root.getDirectoryHandle(opfsDirName, { create: false });
        const cDir = await syncRoot.getDirectoryHandle(courseFolder, { create: false });
        const sDir = await cDir.getDirectoryHandle('Week 1_ Intro_', { create: false });
        await sDir.removeEntry('Slides2.pdf');
      },
      { opfsDirName: OPFS_ROOT_NAME, courseFolder: EXPECTED_COURSE_FOLDER }
    );

    await background.evaluate(() => {
      (globalThis as unknown as { __lfs_fetched_urls: string[] }).__lfs_fetched_urls = [];
    });

    // Keep autoResyncMissingFiles OFF -> deleted file must NOT be re-downloaded
    const autoResyncCheckbox = optionsPage.locator('#local-fs-auto-resync-toggle');
    await expect(autoResyncCheckbox).not.toBeChecked();
    await optionsPage.locator('#local-fs-sync-now-btn').click();

    await expect(async () => {
      const state = await optionsPage.evaluate(async () => {
        const res = await chrome.storage.local.get('localFsStatus');
        return (res.localFsStatus as { state?: string } | undefined)?.state;
      });
      expect(state).toBe('idle');
    }).toPass({ timeout: 10000 });

    const fetchedWhileResyncOff = await background.evaluate(() => {
      return (globalThis as unknown as { __lfs_fetched_urls: string[] }).__lfs_fetched_urls;
    });
    expect(fetchedWhileResyncOff).toEqual([]);

    // Now toggle autoResyncMissingFiles ON -> automatically detects & re-downloads Slides2.pdf
    await optionsPage.locator('label.switch:has(#local-fs-auto-resync-toggle) .slider').click();

    await expect(async () => {
      const recreatedText = await optionsPage.evaluate(
        async ({ opfsDirName, courseFolder }) => {
          try {
            const root = await navigator.storage.getDirectory();
            const syncRoot = await root.getDirectoryHandle(opfsDirName, { create: false });
            const cDir = await syncRoot.getDirectoryHandle(courseFolder, { create: false });
            const sDir = await cDir.getDirectoryHandle('Week 1_ Intro_', { create: false });
            const fh = await sDir.getFileHandle('Slides2.pdf', { create: false });
            const file = await fh.getFile();
            return await file.text();
          } catch {
            return null;
          }
        },
        { opfsDirName: OPFS_ROOT_NAME, courseFolder: EXPECTED_COURSE_FOLDER }
      );
      expect(recreatedText).toBe('%PDF-1.4\n%MockSlides2');
    }).toPass({ timeout: 15000 });

    // --- TC-LFS-05: Visual PC vs Web Differentiation + Fast Local File Opening (zero network fetch) ---
    await background.evaluate(() => {
      (globalThis as unknown as { __lfs_fetched_urls: string[] }).__lfs_fetched_urls = [];
    });

    // Inject an unsynced web-only file into cachedSyncResult so both PC and Web icons render side-by-side
    await optionsPage.evaluate(
      async ({ courseId, courseName }) => {
        const res = await chrome.storage.local.get('cachedSyncResult');
        const cached = res.cachedSyncResult as {
          files: Array<Record<string, unknown>>;
        };
        cached.files.push({
          id: 1009,
          courseId,
          courseName,
          sectionId: 10,
          sectionName: 'Week 1: Intro?',
          fileName: 'UnsyncedWebOnly.pdf',
          fileSize: 256,
          fileUrl: 'https://moodle.tau.ac.il/pluginfile.php/1009/mod_resource/content/1/UnsyncedWebOnly.pdf',
          downloadUrl: 'https://moodle.tau.ac.il/pluginfile.php/1009/mod_resource/content/1/UnsyncedWebOnly.pdf',
          timeModified: 1700000900,
        });
        await chrome.storage.local.set({ cachedSyncResult: cached });
      },
      { courseId: MOCK_COURSE_ID, courseName: MOCK_COURSE_NAME }
    );

    await optionsPage.locator('.nav-item').filter({ hasText: /לוח בקרה|Dashboard/ }).click();
    const courseCard = optionsPage.locator('.course-row-card').first();
    await expect(courseCard).toBeVisible();
    await courseCard.locator('.course-row-title').click();

    const detailView = optionsPage.locator('.course-detail-view');
    await expect(detailView).toBeVisible();

    const unsyncedItem = detailView
      .locator('.section-file-item')
      .filter({ hasText: 'UnsyncedWebOnly.pdf' });
    await expect(unsyncedItem).toBeVisible();
    const webLink = unsyncedItem.locator('a.file-action-web');
    await expect(webLink).toBeVisible();
    await expect(webLink).toHaveAttribute('href', /UnsyncedWebOnly\.pdf/);

    const lectureItem = detailView
      .locator('.section-file-item')
      .filter({ hasText: 'Lecture 1?.pdf' });
    await expect(lectureItem).toBeVisible();

    const localBtn = lectureItem.locator('button.file-action-local');
    await expect(localBtn).toBeVisible();
    expect(await localBtn.getAttribute('href')).toBeNull();
    expect(await localBtn.getAttribute('title')).toContain('Lecture 1_.pdf');

    const [newTab] = await Promise.all([
      context.waitForEvent('page', { timeout: 10000 }),
      localBtn.click(),
    ]);

    await newTab.waitForLoadState('domcontentloaded').catch(() => {});
    expect(newTab.url()).toMatch(/^blob:chrome-extension:\/\//);
    await newTab.close();

    const fetchedDuringLocalOpen = await background.evaluate(() => {
      return (globalThis as unknown as { __lfs_fetched_urls: string[] }).__lfs_fetched_urls;
    });
    expect(fetchedDuringLocalOpen).toEqual([]);

    // --- TC-LFS-06: Logout Teardown preserves disk files but wipes manifest, queue & handle ---
    await optionsPage.evaluate(async () => {
      await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'LOGOUT' }, resolve);
      });
    });

    const postLogoutState = await optionsPage.evaluate(
      async ({ opfsDirName, courseFolder }) => {
        const storage = await chrome.storage.local.get([
          'localFsConfig',
          'localFsManifest',
          'localFsQueue',
          'localFsStatus',
        ]);

        const idbHandle = await new Promise<unknown>((resolve) => {
          const req = indexedDB.open('NoodleLocalFsDB', 1);
          req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains('handles')) {
              req.result.createObjectStore('handles');
            }
          };
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction('handles', 'readonly');
            const getReq = tx.objectStore('handles').get('rootDirHandle');
            getReq.onsuccess = () => {
              db.close();
              resolve(getReq.result ?? null);
            };
            getReq.onerror = () => {
              db.close();
              resolve(null);
            };
          };
          req.onerror = () => resolve(null);
        });

        // Verify downloaded files still exist safely on disk (never erased on logout)
        let lecturePreserved: boolean;
        try {
          const root = await navigator.storage.getDirectory();
          const syncRoot = await root.getDirectoryHandle(opfsDirName, { create: false });
          const cDir = await syncRoot.getDirectoryHandle(courseFolder, { create: false });
          const sDir = await cDir.getDirectoryHandle('Week 1_ Intro_', { create: false });
          await sDir.getFileHandle('Lecture 1_.pdf', { create: false });
          lecturePreserved = true;
        } catch {
          lecturePreserved = false;
        }

        return {
          config: storage.localFsConfig,
          manifest: storage.localFsManifest,
          queue: storage.localFsQueue,
          status: storage.localFsStatus,
          idbHandle,
          lecturePreserved,
        };
      },
      { opfsDirName: OPFS_ROOT_NAME, courseFolder: EXPECTED_COURSE_FOLDER }
    );

    expect(postLogoutState.config).toBeUndefined();
    expect(postLogoutState.manifest).toBeUndefined();
    expect(postLogoutState.queue).toBeUndefined();
    expect(postLogoutState.status).toBeUndefined();
    expect(postLogoutState.idbHandle).toBeNull();
    expect(postLogoutState.lecturePreserved).toBe(true);
  });
});
