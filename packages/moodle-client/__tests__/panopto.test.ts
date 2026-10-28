import {
  isPanoptoUrl,
  extractPanoptoFolderId,
  extractPanoptoDeliveryId,
  buildPanoptoFolderUrl,
  buildPanoptoViewerUrl,
  extractPanoptoFromCourseHtml,
  isValidPanoptoRecording,
  classifyRecordingType,
  parsePanoptoDate,
  filterAndDeduplicateRecordings,
  matchRecordingToSection,
  resolveFolderIdFromDelivery,
  fetchPanoptoFolderSessions,
  discoverCourseFolderFromBrowse,
} from '../src/panoptoScraper.js';
import type { PanoptoRecording } from '../src/types.js';

describe('Panopto Lecture & Recitation Tracking', () => {
  describe('TC-PAN-01: Folder & Delivery ID Extraction and Course HTML Discovery', () => {
    it('should detect Panopto URLs with isPanoptoUrl', () => {
      expect(isPanoptoUrl('https://tau.cloud.panopto.eu/Panopto/Pages/Viewer.aspx?id=05c6571f-fd73-4f88-a06c-b3ff00a6d491')).toBe(true);
      expect(isPanoptoUrl('https://tau.cloud.panopto.eu/Panopto/Pages/Sessions/List.aspx#folderID=%22d971b6fd-f437-4df9-ab9b-b3eb00918477%22')).toBe(true);
      expect(isPanoptoUrl('https://moodle.tau.ac.il/course/view.php?id=12345')).toBe(false);
    });

    it('should extract folder UUID from raw UUID, quoted UUID, or Panopto List.aspx URL', () => {
      const uuid = 'd971b6fd-f437-4df9-ab9b-b3eb00918477';
      expect(extractPanoptoFolderId(uuid.toUpperCase())).toBe(uuid);
      expect(extractPanoptoFolderId(`"${uuid}"`)).toBe(uuid);
      expect(extractPanoptoFolderId(`%22${uuid}%22`)).toBe(uuid);
      expect(
        extractPanoptoFolderId(
          `https://tau.cloud.panopto.eu/Panopto/Pages/Sessions/List.aspx#folderID=%22${uuid}%22`
        )
      ).toBe(uuid);
      expect(
        extractPanoptoFolderId(
          `https://tau.cloud.panopto.eu/Panopto/Pages/Sessions/List.aspx?folderID="${uuid}"`
        )
      ).toBe(uuid);
      expect(
        extractPanoptoFolderId(
          `https://tau.cloud.panopto.eu/Panopto/Pages/Viewer.aspx?id=${uuid}`
        )
      ).toBeNull();
      expect(extractPanoptoFolderId('not-a-uuid')).toBeNull();
    });

    it('should extract delivery UUID from Viewer.aspx and Embed.aspx URLs', () => {
      const deliveryId = '05c6571f-fd73-4f88-a06c-b3ff00a6d491';
      expect(
        extractPanoptoDeliveryId(
          `https://tau.cloud.panopto.eu/Panopto/Pages/Viewer.aspx?id=${deliveryId}`
        )
      ).toBe(deliveryId);
      expect(
        extractPanoptoDeliveryId(
          `https://tau.cloud.panopto.eu/Panopto/Pages/Embed.aspx?id=${deliveryId}&autoplay=false`
        )
      ).toBe(deliveryId);
    });

    it('should build canonical Panopto folder and viewer URLs', () => {
      const id = 'd971b6fd-f437-4df9-ab9b-b3eb00918477';
      expect(buildPanoptoFolderUrl(id)).toBe(
        `https://tau.cloud.panopto.eu/Panopto/Pages/Sessions/List.aspx#folderID=%22${id}%22`
      );
      expect(buildPanoptoViewerUrl(id)).toBe(
        `https://tau.cloud.panopto.eu/Panopto/Pages/Viewer.aspx?id=${id}`
      );
    });

    it('should extract side-panel block_panopto recordings and folder links from Moodle course HTML (including Login.aspx?ReturnUrl= encoded links)', () => {
      const html = `
        <section class="block_panopto block">
          <div class="card-body">
            <a href="https://tau.cloud.panopto.eu/Panopto/Pages/Viewer.aspx?id=05c6571f-fd73-4f88-a06c-b3ff00a6d491">הרצאה 1 - מבוא</a>
            <a href="https://tau.cloud.panopto.eu/Panopto/Pages/Auth/Login.aspx?ReturnUrl=%2fPanopto%2fPages%2fViewer.aspx%3fid%3d15c6571f-fd73-4f88-a06c-b3ff00a6d492&amp;instance=moodle">תרגול 1 - סיבוכיות</a>
            <a href="https://tau.cloud.panopto.eu/Panopto/Pages/Sessions/List.aspx#folderID=%22d971b6fd-f437-4df9-ab9b-b3eb00918477%22">כל ההקלטות</a>
          </div>
        </section>
      `;
      const extracted = extractPanoptoFromCourseHtml(html);
      expect(extracted.folderIds).toEqual(['d971b6fd-f437-4df9-ab9b-b3eb00918477']);
      expect(extracted.deliveries).toHaveLength(2);
      expect(extracted.deliveries[0].id).toBe('05c6571f-fd73-4f88-a06c-b3ff00a6d491');
      expect(extracted.deliveries[0].title).toBe('הרצאה 1 - מבוא');
      expect(extracted.deliveries[1].id).toBe('15c6571f-fd73-4f88-a06c-b3ff00a6d492');
      expect(extracted.deliveries[1].title).toBe('תרגול 1 - סיבוכיות');
    });
  });

  describe('TC-PAN-02: Garbage Filtering, Classification & Recitation Series Deduplication', () => {
    it('should filter out short or non-alphabetical garbage titles and < 60s accidental clips', () => {
      expect(isValidPanoptoRecording('1')).toBe(false);
      expect(isValidPanoptoRecording('---')).toBe(false);
      expect(isValidPanoptoRecording('123456')).toBe(false);
      expect(isValidPanoptoRecording('הרצאה 1 - מבוא', 35)).toBe(false);
      expect(isValidPanoptoRecording('הרצאה 1 - מבוא', 3600)).toBe(true);
      expect(isValidPanoptoRecording('Recitation 2 - Trees')).toBe(true);
    });

    it('should classify recordings into Lecture vs Recitation', () => {
      expect(classifyRecordingType('הרצאה 3 - עצי חיפוש')).toBe('Lecture');
      expect(classifyRecordingType('Lecture 5: Dynamic Programming')).toBe('Lecture');
      expect(classifyRecordingType('תרגול 2 - ערימות')).toBe('Recitation');
      expect(classifyRecordingType('Tirgul 4 part 1')).toBe('Recitation');
      expect(classifyRecordingType('Recitation 1: Asymptotics')).toBe('Recitation');
    });

    it('should parse ASP.NET AJAX dates, ISO dates, and slash dates to YYYY-MM-DD', () => {
      expect(parsePanoptoDate('/Date(1710460800000)/')).toBe('2024-03-15');
      expect(parsePanoptoDate('2026-04-10T08:30:00Z')).toBe('2026-04-10');
      expect(parsePanoptoDate('03/25/2026')).toBe('2026-03-25');
      expect(parsePanoptoDate('')).toBe('');
    });

    it('should deduplicate recitation series across dates while keeping all parts of the latest group', () => {
      const raw: PanoptoRecording[] = [
        // Garbage entry (should be filtered out)
        {
          id: 'garbage-1',
          title: '123',
          recordingUrl: 'https://tau.cloud.panopto.eu/Panopto/Pages/Viewer.aspx?id=00000000-0000-0000-0000-000000000001',
          publishedDate: '2026-03-20',
          type: 'Lecture',
          courseId: 101,
          courseName: 'Algorithms',
        },
        // Old semester recitation 3 (2 parts)
        {
          id: 'old-rec-3-p1',
          title: 'תרגול 3 - חלק 1',
          recordingUrl: 'https://tau.cloud.panopto.eu/Panopto/Pages/Viewer.aspx?id=00000000-0000-0000-0000-000000000002',
          publishedDate: '2025-11-10',
          type: 'Recitation',
          courseId: 101,
          courseName: 'Algorithms',
        },
        {
          id: 'old-rec-3-p2',
          title: 'תרגול 3 - חלק 2',
          recordingUrl: 'https://tau.cloud.panopto.eu/Panopto/Pages/Viewer.aspx?id=00000000-0000-0000-0000-000000000003',
          publishedDate: '2025-11-10',
          type: 'Recitation',
          courseId: 101,
          courseName: 'Algorithms',
        },
        // Newer recitation 3 (2 parts on 2026-03-18)
        {
          id: 'new-rec-3-p1',
          title: 'תרגול 3 חלק א',
          recordingUrl: 'https://tau.cloud.panopto.eu/Panopto/Pages/Viewer.aspx?id=00000000-0000-0000-0000-000000000004',
          publishedDate: '2026-03-18',
          type: 'Recitation',
          courseId: 101,
          courseName: 'Algorithms',
        },
        {
          id: 'new-rec-3-p2',
          title: 'תרגול 3 חלק ב',
          recordingUrl: 'https://tau.cloud.panopto.eu/Panopto/Pages/Viewer.aspx?id=00000000-0000-0000-0000-000000000005',
          publishedDate: '2026-03-18',
          type: 'Recitation',
          courseId: 101,
          courseName: 'Algorithms',
        },
        // Lecture
        {
          id: 'lec-3',
          title: 'הרצאה 3 - עצי חיפוש',
          recordingUrl: 'https://tau.cloud.panopto.eu/Panopto/Pages/Viewer.aspx?id=00000000-0000-0000-0000-000000000006',
          publishedDate: '2026-03-19',
          type: 'Lecture',
          courseId: 101,
          courseName: 'Algorithms',
        },
      ];

      const result = filterAndDeduplicateRecordings(raw);
      expect(result.map(r => r.id)).toEqual(['lec-3', 'new-rec-3-p1', 'new-rec-3-p2']);
    });
  });

  describe('TC-PAN-03: Course Section Matching', () => {
    const sections = [
      'סילבוס והודעות',
      'שבוע 1: מבוא וסיבוכיות',
      'שבוע 2: מיון וחיפוש',
      'שבוע 3: עצי חיפוש מאוזנים (AVL)',
      'שבוע 4: טבלאות גיבוב',
    ];

    it('should match recordings to Moodle sections by lecture/recitation/week number', () => {
      expect(
        matchRecordingToSection({ title: 'הרצאה 3 - עצי AVL', type: 'Lecture' }, sections)
      ).toBe('שבוע 3: עצי חיפוש מאוזנים (AVL)');

      expect(
        matchRecordingToSection({ title: 'תרגול 2 חלק א', type: 'Recitation' }, sections)
      ).toBe('שבוע 2: מיון וחיפוש');
    });

    it('should match recordings to Moodle sections by title keyword overlap when no number is present', () => {
      expect(
        matchRecordingToSection({ title: 'חזרה על טבלאות גיבוב', type: 'Recitation' }, sections)
      ).toBe('שבוע 4: טבלאות גיבוב');
    });

    it('should return undefined when no section matches so UI groups into Panopto Recordings section', () => {
      expect(
        matchRecordingToSection({ title: 'מפגש שאלות ותשובות לקראת הבחינה', type: 'Lecture' }, sections)
      ).toBeUndefined();
    });
  });

  describe('TC-PAN-04: DeliveryInfo Folder Resolution & GetSessions API', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('should resolve parent folder UUID from DeliveryInfo.aspx', async () => {
      const deliveryId = '05c6571f-fd73-4f88-a06c-b3ff00a6d491';
      const folderId = 'd971b6fd-f437-4df9-ab9b-b3eb00918477';

      global.fetch = (async () =>
        new Response(
          JSON.stringify({
            Delivery: {
              SessionGroupPublicID: folderId,
            },
          }),
          { status: 200 }
        )) as any;

      const resolved = await resolveFolderIdFromDelivery(deliveryId);
      expect(resolved).toBe(folderId);
    });

    it('should traverse child subfolders when root course folder contains both direct sessions and subfolders', async () => {
      const rootFolderId = 'bdcd4a66-2843-4918-a672-b4e70090358b';
      const subFolderId = '11111111-2222-3333-4444-555555555555';

      global.fetch = (async (_url: string, init?: RequestInit) => {
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        const fid = body?.queryParameters?.folderID;
        if (fid === rootFolderId) {
          return new Response(
            JSON.stringify({
              d: {
                Results: [
                  {
                    DeliveryID: '05c6571f-fd73-4f88-a06c-b3ff00a6d491',
                    SessionName: 'גלים 1',
                    StartTime: '/Date(1710460800000)/',
                    Duration: 3600,
                  },
                ],
                Subfolders: [{ ID: subFolderId, Name: 'תרגולים' }],
              },
            }),
            { status: 200 }
          );
        }
        if (fid === subFolderId) {
          return new Response(
            JSON.stringify({
              d: {
                Results: [
                  {
                    DeliveryID: '15c6571f-fd73-4f88-a06c-b3ff00a6d492',
                    SessionName: 'תרגול 1 - גלים',
                    StartTime: '/Date(1710547200000)/',
                    Duration: 3600,
                  },
                ],
                Subfolders: [],
              },
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ d: { Results: [] } }), { status: 200 });
      }) as any;

      const sessions = await fetchPanoptoFolderSessions(rootFolderId, 321210299, 'Waves');
      expect(sessions).toHaveLength(2);
      expect(sessions.map(s => s.title)).toEqual(['תרגול 1 - גלים', 'גלים 1']);
      expect(sessions[0].folderUrl).toBe(
        `https://tau.cloud.panopto.eu/Panopto/Pages/Sessions/List.aspx#folderID=%22${subFolderId}%22`
      );
    });

    it('should fetch and deduplicate sessions from Data.svc/GetSessions', async () => {
      const folderId = 'd971b6fd-f437-4df9-ab9b-b3eb00918477';

      global.fetch = (async () =>
        new Response(
          JSON.stringify({
            d: {
              Results: [
                {
                  DeliveryID: '05c6571f-fd73-4f88-a06c-b3ff00a6d491',
                  SessionName: 'הרצאה 1 - מבוא למבני נתונים',
                  StartTime: '/Date(1710460800000)/',
                  Duration: 5400,
                },
                {
                  DeliveryID: '15c6571f-fd73-4f88-a06c-b3ff00a6d492',
                  SessionName: '12', // Garbage title -> filtered out
                  StartTime: '/Date(1710460800000)/',
                  Duration: 120,
                },
              ],
            },
          }),
          { status: 200 }
        )) as any;

      const sessions = await fetchPanoptoFolderSessions(folderId, 9999, 'Data Structures');
      expect(sessions).toHaveLength(1);
      expect(sessions[0].title).toBe('הרצאה 1 - מבוא למבני נתונים');
      expect(sessions[0].publishedDate).toBe('2024-03-15');
      expect(sessions[0].type).toBe('Lecture');
    });

    it('should discover course folder when Hebrew title ending in a digit is concatenated with the 10-digit course code', async () => {
      const targetFolderId = 'aaaa1111-2222-3333-4444-555555555555';

      global.fetch = (async (_url: string, init?: RequestInit) => {
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        const query = body?.queryParameters?.query;
        if (query === '0368215799' || query === '03682157') {
          return new Response(
            JSON.stringify({
              d: {
                Results: [
                  {
                    FolderID: targetFolderId,
                    FolderName: '(0368215799-2026-1) - תוכנה 1 - Introduction to Software Engineering',
                    SessionName: 'הרצאה 1',
                  },
                ],
                Subfolders: [],
              },
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ d: { Results: [], Subfolders: [] } }), { status: 200 });
      }) as any;

      const resolved = await discoverCourseFolderFromBrowse({
        courseId: 368215799,
        courseCode: '1036821579',
        fullName: 'תוכנה 10368215799 - Java Software 1',
      });
      expect(resolved).toBe(targetFolderId);
    });
  });
});

