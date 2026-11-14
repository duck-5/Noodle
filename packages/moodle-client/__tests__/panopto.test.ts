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
  extractPanoptoHostFromAbstract,
  transliterateHebrewNameToEnglish,
  doesHostMatchPersonName,
  classifyRecordingWithSource,
  reclassifyPanoptoRecordings,
  doesRecordingMatchStaffEntries,
  partitionPanoptoRecordingsByTrackedHosts,
  toggleTrackedHostEntry,
  parseCourseStaffRole,
  extractMultilangPersonNames,
  parseParticipantsHtml,
  fetchCourseStaffFromParticipantsPage,
} from '../src/panoptoScraper.js';
import { RestMoodleStrategy } from '../src/strategies/restStrategy.js';
import { runSync } from '../src/syncEngine.js';
import type { CoursePanoptoStaffEntry, CourseStaffMember, PanoptoRecording } from '../src/types.js';

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

  describe('TC-PAN-09: Host Extraction, Hebrew-English Name Mapping, Moodle Staff Discovery & Reclassification (#40)', () => {
    it('extracts Host from Panopto SessionRow Abstract with bullet markers, newlines, entities, and fallbacks', () => {
      const sampleAbstract =
        'Zoom Meeting ID: 82300742209\r\n• Host: Yoav Lahini\r\n• Meeting Start: 11/12/2026 @ 2:08 PM\r\n• Recording Start: 11/12/2026 @ 2:08 PM\r\n• Duration: 1 hr 50 mins \r\n• Participants: Alice, Bob';
      expect(extractPanoptoHostFromAbstract(sampleAbstract)).toBe('Yoav Lahini');

      expect(extractPanoptoHostFromAbstract('&#8226; Host: Eli Eisenberg<br/>Duration: 50 mins')).toBe(
        'Eli Eisenberg'
      );
      expect(extractPanoptoHostFromAbstract('Recorded via Zoom\nHost:   אדם חיטין ביאלוס  \nParticipants: 12')).toBe(
        'אדם חיטין ביאלוס'
      );
      expect(extractPanoptoHostFromAbstract('No host listed here', 'Fallback Presenter')).toBe('Fallback Presenter');
      expect(extractPanoptoHostFromAbstract('• Host: N/A')).toBeUndefined();
      expect(extractPanoptoHostFromAbstract('')).toBeUndefined();
    });

    it('matches Hebrew Moodle names to English Panopto host names (including reversed order and negatives)', () => {
      expect(transliterateHebrewNameToEnglish('יואב לחיני').length).toBeGreaterThan(3);

      expect(doesHostMatchPersonName('Yoav Lahini', 'יואב לחיני')).toBe(true);
      expect(doesHostMatchPersonName('Lahini Yoav', 'יואב לחיני')).toBe(true);
      expect(doesHostMatchPersonName('Adam Hitin Bialos', 'אדם חיטין ביאלוס')).toBe(true);
      expect(doesHostMatchPersonName('Eli Eisenberg', 'אלי אייזנברג')).toBe(true);
      expect(doesHostMatchPersonName('David Cohen', 'יואב לחיני')).toBe(false);
    });

    it('prioritizes explicit staff mapping over title keywords, with Moodle staff and title fallbacks', () => {
      const staffEntries: CoursePanoptoStaffEntry[] = [
        { moodleName: 'יואב לחיני', panoptoName: 'Yoav Lahini', role: 'Lecture' },
        { panoptoName: 'Noa Levi', role: 'Recitation' },
      ];

      // Even if a recording title happens to contain "תרגול" or is ambiguous, explicit Lecturer wins
      const lecByHost = classifyRecordingWithSource('שיעור חזרה ותרגול לקראת בוחן', {
        host: 'Yoav Lahini',
        staffEntries,
      });
      expect(lecByHost).toEqual({ type: 'Lecture', source: 'staff' });

      // Neutral title classified as Recitation because host is mapped as TA
      const recByHost = classifyRecordingWithSource('Zoom Recording 14.11.2026', {
        host: 'Noa Levi',
        staffEntries,
      });
      expect(recByHost).toEqual({ type: 'Recitation', source: 'staff' });

      // Moodle staff fallback when no explicit user mapping exists (Hebrew name matched against English Host)
      const moodleStaff: CourseStaffMember[] = [
        { fullName: 'יואב לחיני', role: 'Lecture', rawRole: 'Teacher' },
        { fullName: 'נועה לוי', role: 'Recitation', rawRole: 'Teaching Assistant' },
      ];
      const byMoodleStaff = classifyRecordingWithSource('Session 07', {
        host: 'Yoav Lahini',
        moodleStaff,
      });
      expect(byMoodleStaff).toEqual({ type: 'Lecture', source: 'moodle_staff' });

      // Title keyword fallback when host is missing or unmapped
      const byTitle = classifyRecordingWithSource('תרגול 5 - אינדוקציה', {
        host: 'Unknown Guest',
        staffEntries,
        moodleStaff,
      });
      expect(byTitle).toEqual({ type: 'Recitation', source: 'title' });
    });

    it('reclassifies existing recordings immediately across courseIdAliases when staff mapping changes', () => {
      const recordings: PanoptoRecording[] = [
        {
          id: 'r1',
          title: 'Zoom Meeting 1',
          recordingUrl: 'https://tau.cloud.panopto.eu/Panopto/Pages/Viewer.aspx?id=1',
          publishedDate: '2026-11-12',
          type: 'Lecture',
          host: 'Tal Golan',
          courseId: 100,
          sourceCourseId: 101,
          courseName: 'Physics 1',
          sectionName: 'Lectures',
        },
      ];

      const staffMap: Record<number, CoursePanoptoStaffEntry[]> = {
        100: [{ panoptoName: 'Tal Golan', role: 'Recitation' }],
      };
      const aliases = new Map<number, number[]>([
        [100, [100, 101]],
        [101, [100, 101]],
      ]);

      const updated = reclassifyPanoptoRecordings(recordings, staffMap, undefined, aliases);
      expect(updated[0].type).toBe('Recitation');
      expect(updated[0].classificationSource).toBe('staff');
      expect(updated[0].sectionName).toBe('Recitations');
    });

    it('parses Moodle staff roles, multilang names, and participants HTML safely (ignoring Students)', () => {
      expect(parseCourseStaffRole('editingteacher', 'Teacher')).toBe('Lecture');
      expect(parseCourseStaffRole('teacher', 'Teaching Assistant')).toBe('Recitation');
      expect(parseCourseStaffRole(undefined, 'מרצה')).toBe('Lecture');
      expect(parseCourseStaffRole(undefined, 'מתרגל')).toBe('Recitation');
      expect(parseCourseStaffRole('student', 'Student')).toBeNull();

      expect(
        extractMultilangPersonNames(
          '<span class="multilang" lang="he">יואב לחיני</span><span class="multilang" lang="en">Yoav Lahini</span>'
        )
      ).toEqual({ primary: 'יואב לחיני', english: 'Yoav Lahini' });

      expect(
        extractMultilangPersonNames('{mlang he}אדם חיטין ביאלוס{mlang}{mlang en}Adam Hitin Bialos{mlang}')
      ).toEqual({ primary: 'אדם חיטין ביאלוס', english: 'Adam Hitin Bialos' });

      const sampleHtml = `
        <table id="participants">
          <tbody>
            <tr>
              <th class="cell c1"><a href="/user/view.php?id=10"><span class="userinitials size-35">אח</span>אדם חיטין ביאלוס</a></th>
              <td class="cell c2">Teacher</td>
            </tr>
            <tr>
              <th class="cell c1"><a href="/user/view.php?id=11"><span class="userinitials size-35">יל</span>יואב לחיני</a></th>
              <td class="cell c2">Teaching Assistant</td>
            </tr>
            <tr>
              <th class="cell c1"><a href="/user/view.php?id=12">סטודנט לדוגמה</a></th>
              <td class="cell c2">Student</td>
            </tr>
          </tbody>
        </table>
      `;
      const parsed = parseParticipantsHtml(sampleHtml);
      expect(parsed).toEqual([
        { userId: 10, fullName: 'אדם חיטין ביאלוס', role: 'Lecture', rawRole: 'Teacher' },
        { userId: 11, fullName: 'יואב לחיני', role: 'Recitation', rawRole: 'Teaching Assistant' },
      ]);
    });

    it('ignores Students assigned to Moodle groups like "Recitation 01" or "Tutorial Group A" in parseParticipantsHtml', () => {
      // 1. Standard Moodle table with <thead> (checkbox td + th name + Roles td + Groups td + Last access td)
      const withTheadHtml = `
        <table id="participants">
          <thead>
            <tr>
              <th class="header c0" scope="col"><input type="checkbox" /></th>
              <th class="header c1" scope="col"><a href="#">First name / Last name</a></th>
              <th class="header c2" scope="col"><a href="#">Roles<span class="accesshide"> Sort by Roles Ascending</span></a></th>
              <th class="header c3" scope="col">Groups</th>
              <th class="header c4" scope="col">Last access to course</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="cell c0"><input type="checkbox" name="user10" /></td>
              <th class="cell c1" scope="row"><a href="/user/view.php?id=10">Yoav Lahini</a></th>
              <td class="cell c2"><span data-itemtype="roles">Teacher</span></td>
              <td class="cell c3"><span data-itemtype="groups">No groups</span></td>
              <td class="cell c4">5 mins 10 secs</td>
            </tr>
            <tr>
              <td class="cell c0"><input type="checkbox" name="user11" /></td>
              <th class="cell c1" scope="row"><a href="/user/view.php?id=11">Noa Levi</a></th>
              <td class="cell c2">Teaching Assistant</td>
              <td class="cell c3">Recitation 01</td>
              <td class="cell c4">1 hour 2 mins</td>
            </tr>
            <tr>
              <td class="cell c0"><input type="checkbox" name="user12" /></td>
              <th class="cell c1" scope="row"><a href="/user/view.php?id=12">Dana Student</a></th>
              <td class="cell c2">Student</td>
              <td class="cell c3">Recitation 01</td>
              <td class="cell c4">2 days</td>
            </tr>
            <tr>
              <td class="cell c0"><input type="checkbox" name="user13" /></td>
              <th class="cell c1" scope="row"><a href="/user/view.php?id=13">Omer Student</a></th>
              <td class="cell c2">Student</td>
              <td class="cell c3">Tutorial Group A</td>
              <td class="cell c4">Never</td>
            </tr>
            <tr>
              <td class="cell c0"><input type="checkbox" name="user14" /></td>
              <th class="cell c1" scope="row"><a href="/user/view.php?id=14">Maya Student</a></th>
              <td class="cell c2">Student</td>
              <td class="cell c3">Tutor Group A</td>
              <td class="cell c4">3 mins</td>
            </tr>
          </tbody>
        </table>
      `;
      expect(parseParticipantsHtml(withTheadHtml)).toEqual([
        { userId: 10, fullName: 'Yoav Lahini', role: 'Lecture', rawRole: 'Teacher' },
        { userId: 11, fullName: 'Noa Levi', role: 'Recitation', rawRole: 'Teaching Assistant' },
      ]);

      // 2. Hebrew <thead> column header ("תפקידים")
      const hebrewTheadHtml = `
        <table id="participants">
          <thead>
            <tr>
              <th scope="col">שם פרטי / שם משפחה</th>
              <th scope="col">תפקידים</th>
              <th scope="col">קבוצות</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th class="cell c1"><a href="/user/view.php?id=21">אלי אייזנברג</a></th>
              <td class="cell c2">מרצה</td>
              <td class="cell c3">אין קבוצות</td>
            </tr>
            <tr>
              <th class="cell c1"><a href="/user/view.php?id=22">תלמיד לדוגמה</a></th>
              <td class="cell c2">סטודנט</td>
              <td class="cell c3">תרגול 01</td>
            </tr>
          </tbody>
        </table>
      `;
      expect(parseParticipantsHtml(hebrewTheadHtml)).toEqual([
        { userId: 21, fullName: 'אלי אייזנברג', role: 'Lecture', rawRole: 'מרצה' },
      ]);

      // 3. Headerless table fragment with data-itemtype="roles" and data-itemtype="groups"
      const headlessDataItemtypeHtml = `
        <table id="participants">
          <tbody>
            <tr>
              <th class="cell c1"><a href="/user/view.php?id=31">Prof. Dan</a></th>
              <td class="cell c2"><span class="inplaceeditable" data-itemtype="roles"><a href="#">Teacher <span class="quickediticon"></span></a></span></td>
              <td class="cell c3"><span class="inplaceeditable" data-itemtype="groups">No groups</span></td>
            </tr>
            <tr>
              <th class="cell c1"><a href="/user/view.php?id=32">Student Ben</a></th>
              <td class="cell c2"><span class="inplaceeditable" data-itemtype="roles"><a href="#">Student <span class="quickediticon"></span></a></span></td>
              <td class="cell c3"><span class="inplaceeditable" data-itemtype="groups">Recitation 01</span></td>
            </tr>
          </tbody>
        </table>
      `;
      expect(parseParticipantsHtml(headlessDataItemtypeHtml)).toEqual([
        { userId: 31, fullName: 'Prof. Dan', role: 'Lecture', rawRole: 'Teacher' },
      ]);

      // 4. Headerless table fragment without data-itemtype="roles"
      const headlessPlainHtml = `
        <table id="participants">
          <tbody>
            <tr>
              <th class="cell c1"><a href="/user/view.php?id=41">Dr. Cohen</a></th>
              <td class="cell c2">Teacher</td>
              <td class="cell c3">No groups</td>
            </tr>
            <tr>
              <th class="cell c1"><a href="/user/view.php?id=42">TA Tal</a></th>
              <td class="cell c2">Teaching Assistant</td>
              <td class="cell c3">Tutorial Group A</td>
            </tr>
            <tr>
              <th class="cell c1"><a href="/user/view.php?id=43">Student Ron</a></th>
              <td class="cell c2">Student</td>
              <td class="cell c3">Recitation 01</td>
            </tr>
            <tr>
              <th class="cell c1"><a href="/user/view.php?id=44">Student Gal</a></th>
              <td class="cell c2">Student</td>
              <td class="cell c3">Tutorial Group A</td>
            </tr>
          </tbody>
        </table>
      `;
      expect(parseParticipantsHtml(headlessPlainHtml)).toEqual([
        { userId: 41, fullName: 'Dr. Cohen', role: 'Lecture', rawRole: 'Teacher' },
        { userId: 42, fullName: 'TA Tal', role: 'Recitation', rawRole: 'Teaching Assistant' },
      ]);

      // 5. Full Moodle 4.x page with earlier block <table> and <table id="user-index-participants-101">
      const moodle4PageHtml = `
        <html>
          <body>
            <table class="block-table">
              <thead><tr><th>Calendar</th><th>Events</th></tr></thead>
              <tbody><tr><td>Today</td><td>No events</td></tr></tbody>
            </table>
            <table id="user-index-participants-101" class="flexible table">
              <thead>
                <tr>
                  <th class="header c0" scope="col"><input type="checkbox" /></th>
                  <th class="header c1" scope="col">First name / Last name</th>
                  <th class="header c2" scope="col">Roles</th>
                  <th class="header c3" scope="col">Groups</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td class="cell c0"><input type="checkbox" /></td>
                  <th class="cell c1" scope="row"><a href="/user/view.php?id=51">Prof. Levi</a></th>
                  <td class="cell c2">Teacher</td>
                  <td class="cell c3">No groups</td>
                </tr>
                <tr>
                  <td class="cell c0"><input type="checkbox" /></td>
                  <th class="cell c1" scope="row"><a href="/user/view.php?id=52">Student Avi</a></th>
                  <td class="cell c2">Student</td>
                  <td class="cell c3">Recitation</td>
                </tr>
              </tbody>
            </table>
          </body>
        </html>
      `;
      expect(parseParticipantsHtml(moodle4PageHtml)).toEqual([
        { userId: 51, fullName: 'Prof. Levi', role: 'Lecture', rawRole: 'Teacher' },
      ]);

      // 6. Header row without <thead> or scope="col" (leading <td> checkbox + <th> headers) and themed <th> role cell
      const mixedHeaderNoTheadHtml = `
        <table>
          <tbody>
            <tr>
              <td class="header c0"><input type="checkbox" /></td>
              <th class="header c1">First name / Last name</th>
              <th class="header c2">Roles</th>
              <th class="header c3">Groups</th>
            </tr>
            <tr>
              <td class="cell c0"><input type="checkbox" /></td>
              <th class="cell c1"><a href="/user/view.php?id=61">TA Shira</a></th>
              <th class="cell c2">Teaching Assistant</th>
              <td class="cell c3">Recitation 01</td>
            </tr>
            <tr>
              <td class="cell c0"><input type="checkbox" /></td>
              <th class="cell c1"><a href="/user/view.php?id=62">Student Nir</a></th>
              <td class="cell c2">-</td>
              <td class="cell c3">Recitation</td>
            </tr>
          </tbody>
        </table>
      `;
      expect(parseParticipantsHtml(mixedHeaderNoTheadHtml)).toEqual([
        { userId: 61, fullName: 'TA Shira', role: 'Recitation', rawRole: 'Teaching Assistant' },
      ]);

      // 7. Headerless fragment without data-itemtype="roles": bare/numbered group names vs real Tutor / Recitation TA roles
      const headlessEdgeGroupsHtml = `
        <table id="participants">
          <tbody>
            <tr>
              <th class="cell c1"><a href="/user/view.php?id=71">Student Bare</a></th>
              <td class="cell c2">-</td>
              <td class="cell c3">Recitation</td>
            </tr>
            <tr>
              <th class="cell c1"><a href="/user/view.php?id=72">Student Heb</a></th>
              <td class="cell c2">תלמיד</td>
              <td class="cell c3">Tutorial</td>
            </tr>
            <tr>
              <th class="cell c1"><a href="/user/view.php?id=73">Student Num</a></th>
              <td class="cell c2">None</td>
              <td class="cell c3">TA 01</td>
            </tr>
            <tr>
              <th class="cell c1"><a href="/user/view.php?id=74">Student TutorGrp</a></th>
              <td class="cell c2">None</td>
              <td class="cell c3">Tutor 01</td>
            </tr>
            <tr>
              <th class="cell c1"><a href="/user/view.php?id=75">Real Tutor</a></th>
              <td class="cell c2">Tutor</td>
              <td class="cell c3">No groups</td>
            </tr>
            <tr>
              <th class="cell c1"><a href="/user/view.php?id=76">Real Recitation TA</a></th>
              <td class="cell c2">Recitation TA</td>
              <td class="cell c3">Recitation 02</td>
            </tr>
          </tbody>
        </table>
      `;
      expect(parseParticipantsHtml(headlessEdgeGroupsHtml)).toEqual([
        { userId: 75, fullName: 'Real Tutor', role: 'Recitation', rawRole: 'Tutor' },
        { userId: 76, fullName: 'Real Recitation TA', role: 'Recitation', rawRole: 'Recitation TA' },
      ]);
    });

    it('extracts host from Abstract in fetchPanoptoFolderSessions and classifies using staffEntries', async () => {
      const folderId = 'bbbb1111-2222-3333-4444-555555555555';
      global.fetch = (async () =>
        new Response(
          JSON.stringify({
            d: {
              Results: [
                {
                  DeliveryID: '05c6571f-fd73-4f88-a06c-b3ff00a6d491',
                  SessionName: 'שיעור 05 - פתרון מבחן',
                  StartTime: '/Date(1710460800000)/',
                  Duration: 5400,
                  Abstract: 'Zoom Meeting ID: 82300742209\r\n• Host: Eli Eisenberg\r\n• Duration: 1 hr 30 mins',
                },
                {
                  DeliveryID: '15c6571f-fd73-4f88-a06c-b3ff00a6d499',
                  SessionName: 'Session 05',
                  StartTime: '/Date(1710547200000)/',
                  Duration: 3600,
                  Abstract: 'Zoom Meeting ID: 82300742210\r\n• Host: Yoav Lahini\r\n• Duration: 60 mins',
                },
              ],
              Subfolders: [],
            },
          }),
          { status: 200 }
        )) as any;

      const sessions = await fetchPanoptoFolderSessions(folderId, 200, 'Quantum Mechanics', undefined, null, 0, {
        staffEntries: [
          { panoptoName: 'Eli Eisenberg', role: 'Lecture' },
          { panoptoName: 'Yoav Lahini', role: 'Recitation' },
        ],
      });

      expect(sessions).toHaveLength(2);
      const eliSession = sessions.find((s) => s.host === 'Eli Eisenberg');
      const yoavSession = sessions.find((s) => s.host === 'Yoav Lahini');
      expect(eliSession).toMatchObject({
        host: 'Eli Eisenberg',
        type: 'Lecture',
        classificationSource: 'staff',
      });
      expect(yoavSession).toMatchObject({
        host: 'Yoav Lahini',
        type: 'Recitation',
        classificationSource: 'staff',
      });
    });

    it('populates result.courseStaff in runSync even when 0 Panopto recordings exist (start of year)', async () => {
      const folderId = 'cccc1111-2222-3333-4444-555555555555';
      const seenWsCalls: Array<{ wsfunction: string | null; filter: string | null }> = [];

      global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = String(input);
        const bodyStr = init?.body ? String(init.body) : '';
        const params = new URLSearchParams(urlStr.includes('?') ? urlStr.split('?')[1] : bodyStr);
        const wsfn = params.get('wsfunction');
        if (urlStr.includes('webservice/rest/server.php')) {
          seenWsCalls.push({ wsfunction: wsfn, filter: params.get('moodlewssettingfilter') });
        }

        if (wsfn === 'core_webservice_get_site_info') {
          return new Response(JSON.stringify({ userid: 42, fullname: 'Test Student' }), { status: 200 });
        }
        if (wsfn === 'core_enrol_get_users_courses') {
          return new Response(
            JSON.stringify([{ id: 501, fullname: '0321-1101 - Classical Mechanics', shortname: '03211101' }]),
            { status: 200 }
          );
        }
        if (wsfn === 'mod_assign_get_assignments') {
          return new Response(JSON.stringify({ courses: [] }), { status: 200 });
        }
        if (wsfn === 'core_course_get_contents') {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (wsfn === 'mod_quiz_get_quizzes_by_courses') {
          return new Response(JSON.stringify({ quizzes: [] }), { status: 200 });
        }
        if (wsfn === 'gradereport_user_get_grade_items') {
          return new Response(JSON.stringify({ usergrades: [] }), { status: 200 });
        }
        if (wsfn === 'core_enrol_get_enrolled_users') {
          return new Response(
            JSON.stringify([
              {
                id: 77,
                fullname: 'יואב לחיני',
                roles: [{ shortname: 'editingteacher', name: 'Teacher' }],
              },
              {
                id: 78,
                fullname: 'סטודנט אחר',
                roles: [{ shortname: 'student', name: 'Student' }],
              },
            ]),
            { status: 200 }
          );
        }
        if (urlStr.includes('Data.svc/GetSessions')) {
          return new Response(JSON.stringify({ d: { Results: [], Subfolders: [] } }), { status: 200 });
        }
        if (urlStr.includes('Sessions/List.aspx')) {
          return new Response('<html><body></body></html>', { status: 200 });
        }
        return new Response('', { status: 200 });
      }) as any;

      const syncRes = await runSync(
        'TEST_TOKEN',
        [501],
        () => {},
        'https://moodle.tau.ac.il',
        undefined,
        undefined,
        undefined,
        undefined,
        {
          enablePanopto: true,
          lang: 'en',
          coursesPanoptoMap: { 501: folderId },
        }
      );

      const enrolledCall = seenWsCalls.find((c) => c.wsfunction === 'core_enrol_get_enrolled_users');
      expect(enrolledCall).toBeDefined();
      expect(enrolledCall?.filter).toBe('false');
      expect(syncRes.recordings).toEqual([]);
      expect(syncRes.courseStaff?.[501]).toEqual([
        { userId: 77, fullName: 'יואב לחיני', englishName: undefined, role: 'Lecture', rawRole: 'Teacher' },
      ]);
    });

    it('extracts Host from single-line bullet/pipe abstracts and matches hyphenated Hebrew names', () => {
      expect(
        extractPanoptoHostFromAbstract('Zoom Meeting ID: 82300742209 • Host: Yoav Lahini • Start: 11/12/2026')
      ).toBe('Yoav Lahini');
      expect(
        extractPanoptoHostFromAbstract('Meeting | Host: Eli Eisenberg | Duration: 50 mins')
      ).toBe('Eli Eisenberg');
      expect(doesHostMatchPersonName('Adam Hitin Bialos', 'אדם חיטין-ביאלוס')).toBe(true);
    });

    it('maps Non-editing teacher and regional multilang subtags accurately', () => {
      expect(parseCourseStaffRole(undefined, 'Non-editing teacher')).toBe('Recitation');
      expect(parseCourseStaffRole(undefined, 'מורה ללא הרשאות עריכה')).toBe('Recitation');
      expect(parseCourseStaffRole(undefined, 'מורה שאינו עורך')).toBe('Recitation');
      expect(parseCourseStaffRole(undefined, 'Teacher')).toBe('Lecture');

      expect(
        extractMultilangPersonNames('<span lang="he_il" class="multilang">יואב לחיני</span><span lang="en_us" class="multilang">Yoav Lahini</span>')
      ).toEqual({ primary: 'יואב לחיני', english: 'Yoav Lahini' });

      expect(
        extractMultilangPersonNames('{mlang he_il}אלי אייזנברג{mlang}{mlang en-US}Eli Eisenberg{mlang}')
      ).toEqual({ primary: 'אלי אייזנברג', english: 'Eli Eisenberg' });
    });

    it('uses root URL for current-year courses and year prefix for archive courses in getCourseStaff', async () => {
      const currentYear = new Date().getFullYear();
      const archiveYear = currentYear - 1;
      const staffRequestUrls: string[] = [];
      const origFetch = global.fetch;

      global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const body = init?.body ? String(init.body) : '';
        const combined = `${url} ${body}`;

        if (combined.includes('core_enrol_get_users_courses')) {
          return new Response(
            JSON.stringify([
              { id: 801, shortname: `0368-1111-01-${currentYear}-1`, fullname: 'Current Course', idnumber: `0368-1111-01-${currentYear}-1` },
              { id: 802, shortname: `0368-1111-01-${archiveYear}-1`, fullname: 'Archive Course', idnumber: `0368-1111-01-${archiveYear}-1` },
            ]),
            { status: 200 }
          );
        }

        if (combined.includes('core_enrol_get_enrolled_users')) {
          staffRequestUrls.push(url);
          return new Response(
            JSON.stringify([
              { id: 11, fullname: 'יואב לחיני', roles: [{ shortname: 'editingteacher', name: 'Teacher' }] },
            ]),
            { status: 200 }
          );
        }

        return new Response(JSON.stringify({}), { status: 200 });
      }) as typeof fetch;

      try {
        const strategy = new RestMoodleStrategy({
          token: 'TEST_TOKEN',
          baseUrl: 'https://moodle.tau.ac.il',
          lang: 'en',
        });
        await strategy.getEnrolledCourses(999);
        const currentStaff = await strategy.getCourseStaff(801);
        const archiveStaff = await strategy.getCourseStaff(802);

        expect(currentStaff).toHaveLength(1);
        expect(archiveStaff).toHaveLength(1);

        expect(staffRequestUrls).toHaveLength(2);
        expect(staffRequestUrls[0]).toContain('https://moodle.tau.ac.il/webservice/rest/server.php');
        expect(staffRequestUrls[0]).not.toContain(`/${currentYear}/`);
        expect(staffRequestUrls[1]).toContain(`https://moodle.tau.ac.il/${archiveYear}/webservice/rest/server.php`);
      } finally {
        global.fetch = origFetch;
      }
    });

    it('retries /user/index.php with lang=he and restores lang=en when English HTML hides Hebrew-only staff', async () => {
      const seenPageUrls: string[] = [];
      const origFetch = global.fetch;

      global.fetch = jest.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        seenPageUrls.push(url);

        if (url.includes('lang=he')) {
          return {
            ok: true,
            status: 200,
            url,
            text: async () => `
              <html lang="he">
              <body>
                <table id="participants">
                  <tbody>
                    <tr id="user-index-participants-100_r0">
                      <th class="cell c1"><a href="/user/view.php?id=77">יואב לחיני</a></th>
                      <td class="cell c2">מרצה</td>
                    </tr>
                  </tbody>
                </table>
              </body>
              </html>
            `,
          } as Response;
        }

        return {
          ok: true,
          status: 200,
          url,
          text: async () => '<html lang="en"><body><table id="participants"><tbody></tbody></table></body></html>',
        } as Response;
      }) as typeof fetch;

      try {
        const staff = await fetchCourseStaffFromParticipantsPage(601, 'https://moodle.tau.ac.il');
        expect(staff).toEqual([
          { userId: 77, fullName: 'יואב לחיני', role: 'Lecture', rawRole: 'מרצה' },
        ]);
        expect(seenPageUrls.some((u) => u.includes('perpage=5000'))).toBe(true);
        expect(seenPageUrls.some((u) => u.includes('lang=he'))).toBe(true);
        expect(seenPageUrls.some((u) => u.includes('lang=en'))).toBe(true);
      } finally {
        global.fetch = origFetch;
      }
    });

    it('shares coursesPanoptoStaff across unified parent and child course portals during runSync', async () => {
      const origFetch = global.fetch;
      global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const body = init?.body ? String(init.body) : '';

        if (url.includes('core_webservice_get_site_info')) {
          return new Response(JSON.stringify({ userid: 1 }), { status: 200 });
        }
        if (url.includes('core_enrol_get_users_courses')) {
          return new Response(
            JSON.stringify([
              { id: 701, shortname: '0368-2154-01-2026-1', fullname: 'Physics 2 (Lecture)', idnumber: '0368215401' },
              { id: 702, shortname: '0368-2154-06-2026-1', fullname: 'Physics 2 (Recitation)', idnumber: '0368215406' },
            ]),
            { status: 200 }
          );
        }
        if (url.includes('core_course_get_contents')) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (url.includes('mod_assign_get_assignments')) {
          return new Response(JSON.stringify({ courses: [] }), { status: 200 });
        }
        if (url.includes('core_block_get_course_blocks')) {
          const isChild = body.includes('courseid=702') || url.includes('courseid=702');
          const folderUuid = isChild
            ? 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
            : 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
          return new Response(
            JSON.stringify({
              blocks: [
                {
                  name: 'panopto',
                  contents: {
                    content: `<a href="https://tau.cloud.panopto.eu/Panopto/Pages/Sessions/List.aspx#folderID=%22${folderUuid}%22">Panopto</a>`,
                  },
                },
              ],
            }),
            { status: 200 }
          );
        }
        if (url.includes('core_enrol_get_enrolled_users')) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (url.includes('Data.svc/GetSessions')) {
          const payload = JSON.parse(body || '{}');
          const folderId = payload?.queryParameters?.folderID || '';
          if (folderId.includes('aaaaaaaa')) {
            return new Response(
              JSON.stringify({
                d: {
                  Results: [
                    {
                      DeliveryID: '11111111-1111-4111-8111-111111111111',
                      SessionName: 'Weekly Session 01',
                      Abstract: '• Host: Adam Hitin Bialos\n• Start: 11/12/2026',
                      StartTime: '/Date(1794400000000)/',
                      Duration: 3000,
                      ViewerUrl: 'https://tau.cloud.panopto.eu/Panopto/Pages/Viewer.aspx?id=11111111-1111-4111-8111-111111111111',
                    },
                  ],
                  Subfolders: [],
                },
              }),
              { status: 200 }
            );
          }
          return new Response(JSON.stringify({ d: { Results: [], Subfolders: [] } }), { status: 200 });
        }
        if (url.includes('Sessions/List.aspx')) {
          return new Response('<html><body></body></html>', { status: 200 });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      }) as typeof fetch;

      try {
        const syncRes = await runSync(
          'TEST_TOKEN',
          [701, 702],
          () => {},
          'https://moodle.tau.ac.il',
          undefined,
          undefined,
          undefined,
          undefined,
          {
            enablePanopto: true,
            coursesPanoptoMap: {
              701: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
              702: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
            },
            coursesPanoptoStaff: {
              // Configured ONLY on parent unified course 701
              701: [
                {
                  moodleName: 'אדם חיטין ביאלוס',
                  panoptoName: 'Adam Hitin Bialos',
                  role: 'Recitation',
                },
              ],
            },
          }
        );

        expect(syncRes.recordings).toHaveLength(1);
        expect(syncRes.recordings?.[0]?.courseId).toBe(702);
        expect(syncRes.recordings?.[0]?.type).toBe('Recitation');
        expect(syncRes.recordings?.[0]?.classificationSource).toBe('staff');
      } finally {
        global.fetch = origFetch;
      }
    });

    it('partitions recordings exclusively by picked hosts and hides all others unless none are chosen', () => {
      const sampleRecs: PanoptoRecording[] = [
        {
          id: 'r1',
          title: 'Lecture 1',
          recordingUrl: 'https://tau.cloud.panopto.eu/Panopto/Pages/Viewer.aspx?id=r1',
          publishedDate: '2026-11-12',
          type: 'Lecture',
          courseId: 101,
          courseName: 'Physics 2',
          host: 'Yoav Lahini',
        },
        {
          id: 'r2',
          title: 'Recitation 1',
          recordingUrl: 'https://tau.cloud.panopto.eu/Panopto/Pages/Viewer.aspx?id=r2',
          publishedDate: '2026-11-13',
          type: 'Recitation',
          courseId: 101,
          courseName: 'Physics 2',
          host: 'Adam Hitin Bialos',
        },
        {
          id: 'r3',
          title: 'Other Group',
          recordingUrl: 'https://tau.cloud.panopto.eu/Panopto/Pages/Viewer.aspx?id=r3',
          publishedDate: '2026-11-14',
          type: 'Recitation',
          courseId: 101,
          courseName: 'Physics 2',
          host: 'Dana Levi',
        },
        {
          id: 'r4',
          title: 'Guest Upload',
          recordingUrl: 'https://tau.cloud.panopto.eu/Panopto/Pages/Viewer.aspx?id=r4',
          publishedDate: '2026-11-15',
          type: 'Lecture',
          courseId: 101,
          courseName: 'Physics 2',
        },
      ];

      // 1. When no lecturers/TAs are chosen, nothing is hidden
      const noFilter = partitionPanoptoRecordingsByTrackedHosts(sampleRecs, []);
      expect(noFilter.isFilteringActive).toBe(false);
      expect(noFilter.visible).toHaveLength(4);
      expect(noFilter.hidden).toHaveLength(0);

      // 2. When only Yoav is picked, show Yoav exclusively and hide all other recordings
      const oneHost = partitionPanoptoRecordingsByTrackedHosts(sampleRecs, [
        { panoptoName: 'Yoav Lahini', role: 'Lecture' },
      ]);
      expect(oneHost.isFilteringActive).toBe(true);
      expect(oneHost.visible.map((r) => r.id)).toEqual(['r1']);
      expect(oneHost.hidden.map((r) => r.id)).toEqual(['r2', 'r3', 'r4']);

      // 3. Phonetic Hebrew match in entries keeps matching English host visible
      const hebrewStaff = partitionPanoptoRecordingsByTrackedHosts(sampleRecs, [
        { moodleName: 'אדם חיטין ביאלוס', panoptoName: '', role: 'Recitation' },
      ]);
      expect(hebrewStaff.visible.map((r) => r.id)).toEqual(['r2']);
      expect(doesRecordingMatchStaffEntries({ host: 'Dana Levi' }, [{ panoptoName: 'Yoav Lahini', role: 'Lecture' }])).toBe(false);
    });

    it('toggleTrackedHostEntry adds host with recording type, attaches moodleName, and untoggles when re-clicked', () => {
      const moodleStaff: CourseStaffMember[] = [
        { fullName: 'אדם חיטין ביאלוס', role: 'Recitation' },
      ];
      const added = toggleTrackedHostEntry([], 'Adam Hitin Bialos', 'Recitation', moodleStaff);
      expect(added).toEqual([
        {
          moodleName: 'אדם חיטין ביאלוס',
          panoptoName: 'Adam Hitin Bialos',
          role: 'Recitation',
        },
      ]);

      const addedSecond = toggleTrackedHostEntry(added, 'Yoav Lahini', 'Lecture', moodleStaff);
      expect(addedSecond).toHaveLength(2);
      expect(addedSecond[1]).toEqual({ panoptoName: 'Yoav Lahini', role: 'Lecture' });

      const untoggled = toggleTrackedHostEntry(addedSecond, 'Adam Hitin Bialos', 'Recitation', moodleStaff);
      expect(untoggled).toEqual([{ panoptoName: 'Yoav Lahini', role: 'Lecture' }]);
    });

    it('partitions manually dismissed recordings into hidden even when no staff filter is active', () => {
      const recs: PanoptoRecording[] = [
        {
          id: 'rec-a',
          courseId: 705,
          courseName: 'Physics C',
          title: 'Lecture 1',
          type: 'Lecture',
          recordingUrl: 'https://tau.cloud.panopto.eu/Panopto/Pages/Viewer.aspx?id=rec-a',
          publishedDate: '2026-11-01',
          host: 'Yoav Lahini',
        },
        {
          id: 'rec-b',
          courseId: 705,
          courseName: 'Physics C',
          title: 'Lecture 2',
          type: 'Lecture',
          recordingUrl: 'https://tau.cloud.panopto.eu/Panopto/Pages/Viewer.aspx?id=rec-b',
          publishedDate: '2026-11-08',
          host: 'Yoav Lahini',
        },
      ];

      const partitioned = partitionPanoptoRecordingsByTrackedHosts(recs, [], ['rec-a']);
      expect(partitioned.isFilteringActive).toBe(true);
      expect(partitioned.visible.map((r) => r.id)).toEqual(['rec-b']);
      expect(partitioned.hidden.map((r) => r.id)).toEqual(['rec-a']);
    });

    it('runSync reuses cachedCourseStaff and avoids re-fetching Moodle staff on subsequent syncs', async () => {
      const origFetch = global.fetch;
      let enrolledUsersFetchCount = 0;

      global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        const body = typeof init?.body === 'string' ? init.body : '';
        if (url.includes('core_enrol_get_enrolled_users')) {
          enrolledUsersFetchCount++;
        }
        if (url.includes('core_webservice_get_site_info')) {
          return new Response(JSON.stringify({ userid: 1, fullname: 'Test' }), { status: 200 });
        }
        if (url.includes('core_enrol_get_users_courses')) {
          return new Response(
            JSON.stringify([{ id: 705, shortname: '0321-1000-01-2026-1', fullname: 'Physics C' }]),
            { status: 200 }
          );
        }
        if (url.includes('core_course_get_contents') || url.includes('mod_assign_get_assignments') || url.includes('core_block_get_course_blocks')) {
          return new Response(JSON.stringify(url.includes('mod_assign') ? { courses: [] } : url.includes('blocks') ? { blocks: [] } : []), { status: 200 });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      }) as typeof fetch;

      try {
        const cachedStaff: Record<number, CourseStaffMember[]> = {
          705: [{ fullName: 'יואב לחיני', role: 'Lecture' }],
        };
        const res = await runSync(
          'TEST_TOKEN',
          [705],
          () => {},
          'https://moodle.tau.ac.il',
          undefined,
          undefined,
          undefined,
          undefined,
          {
            enablePanopto: true,
            cachedCourseStaff: cachedStaff,
          }
        );

        expect(enrolledUsersFetchCount).toBe(0);
        expect(res.courseStaff?.[705]).toEqual(cachedStaff[705]);
      } finally {
        global.fetch = origFetch;
      }
    });
  });
});

