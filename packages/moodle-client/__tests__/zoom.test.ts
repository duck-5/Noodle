import { runSync } from '../src/syncEngine.js';
import {
  isZoomUrl,
  isZoomJoinUrl,
  isZoomOrMeetingName,
  parseZoomUrl,
  extractZoomLinksFromHtml,
  collapseRecurringMeetings,
  parseAppConf,
  normalizeZoomStartTime,
  parseDateTimeInZone,
  scrapeZoomMeetingsWithToken,
} from '../src/zoomScraper.js';

describe('Category 5: Zoom Meetings & Live Sessions', () => {
  describe('TC-ZM-01: Zoom Module & Schedule Scraping', () => {
    it('should extract meetingNumber, password, and direct link from Zoom join URLs', () => {
      const joinUrl = 'https://tau-ac-il.zoom.us/j/123456789?pwd=mockPassword123';
      const parsed = parseZoomUrl(joinUrl);

      expect(parsed.meetingNumber).toBe('123456789');
      expect(parsed.password).toBe('mockPassword123');
      expect(parsed.meetingUrl).toBe(joinUrl);
    });

    it('should normalize meeting join URL with direct tau-ac-il domain', () => {
      const genericUrl = 'https://zoom.us/j/987654321?pwd=secretPassword';
      const parsed = parseZoomUrl(genericUrl);

      expect(parsed.meetingNumber).toBe('987654321');
      expect(parsed.password).toBe('secretPassword');
      expect(parsed.meetingUrl).toBe('https://tau-ac-il.zoom.us/j/987654321?pwd=secretPassword');
    });

    it('should accurately detect Zoom URLs using isZoomUrl', () => {
      expect(isZoomUrl('https://tau-ac-il.zoom.us/j/123456789?pwd=abc')).toBe(true);
      expect(isZoomUrl('https://tau.zoom.us/j/123456')).toBe(true);
      expect(isZoomUrl('https://zoom.us/j/987654321')).toBe(true);
      expect(isZoomUrl('https://us02web.zoom.us/j/987654321')).toBe(true);
      expect(isZoomUrl('https://custom.zoom.com/j/123')).toBe(true);
      expect(isZoomUrl('https://zoomgov.com/j/123')).toBe(true);

      expect(isZoomUrl('https://moodle.tau.ac.il/mod/url/view.php?id=123')).toBe(false);
      expect(isZoomUrl('https://example.com/not-zoom')).toBe(false);
      expect(isZoomUrl('')).toBe(false);
    });

    it('should distinguish joinable Zoom meeting URLs from generic portals and endpoints using isZoomJoinUrl', () => {
      // Valid joinable meeting URLs (/j/, /w/, /s/, /my/, ?confno=)
      expect(isZoomJoinUrl('https://tau-ac-il.zoom.us/j/86295092403')).toBe(true);
      expect(isZoomJoinUrl('https://tau-ac-il.zoom.us/j/86295092403?pwd=secretPassword')).toBe(true);
      expect(isZoomJoinUrl('https://zoom.us/j/81592282211')).toBe(true);
      expect(isZoomJoinUrl('https://us02web.zoom.us/w/88182963916')).toBe(true);
      expect(isZoomJoinUrl('https://zoom.us/s/89058095422')).toBe(true);
      expect(isZoomJoinUrl('https://tau-ac-il.zoom.us/my/professordoe')).toBe(true);
      expect(isZoomJoinUrl('https://zoom.us?confno=86295092403')).toBe(true);
      expect(isZoomJoinUrl('https://tau-ac-il.zoom.us', '86295092403')).toBe(true);

      // Non-joinable URLs (generic homepages, portals, LTI APIs, auth endpoints, help docs)
      expect(isZoomJoinUrl('https://tau-ac-il.zoom.us')).toBe(false);
      expect(isZoomJoinUrl('https://tau.zoom.us/')).toBe(false);
      expect(isZoomJoinUrl('https://zoom.us')).toBe(false);
      expect(isZoomJoinUrl('https://zoom.us/')).toBe(false);
      expect(isZoomJoinUrl('https://zoom.us/signin')).toBe(false);
      expect(isZoomJoinUrl('https://zoom.us/join')).toBe(false);
      expect(isZoomJoinUrl('https://zoom.us/test')).toBe(false);
      expect(isZoomJoinUrl('https://zoom.us/download')).toBe(false);
      expect(isZoomJoinUrl('https://applications.zoom.us/api/v1/lti/rich/meeting/upComing/COURSE/all?page=1&total=0')).toBe(false);
      expect(isZoomJoinUrl('https://moodle.tau.ac.il/mod/lti/view.php?id=123')).toBe(false);
      expect(isZoomJoinUrl('')).toBe(false);
    });

    it('should identify English and Hebrew Zoom/meeting keywords using isZoomOrMeetingName', () => {
      expect(isZoomOrMeetingName('Zoom Meeting')).toBe(true);
      expect(isZoomOrMeetingName('שיעורי Zoom והקלטות')).toBe(true);
      expect(isZoomOrMeetingName('קישור לזום')).toBe(true);
      expect(isZoomOrMeetingName('מפגש מקוון')).toBe(true);
      expect(isZoomOrMeetingName('מפגשים מקוונים')).toBe(true);
      expect(isZoomOrMeetingName('שיעור מקוון')).toBe(true);
      expect(isZoomOrMeetingName('הרצאה מקוונת')).toBe(true);
      expect(isZoomOrMeetingName('תרגולים מקוונים')).toBe(true);
      expect(isZoomOrMeetingName('חדר זום לתרגול')).toBe(true);
      expect(isZoomOrMeetingName('חדר הרצאות')).toBe(true);
      expect(isZoomOrMeetingName('חדר תרגולים')).toBe(true);
      expect(isZoomOrMeetingName('קישור לתרגול')).toBe(true);
      expect(isZoomOrMeetingName('קישורים לתרגולים')).toBe(true);
      expect(isZoomOrMeetingName('קישורים להרצאות')).toBe(true);
      expect(isZoomOrMeetingName('live lecture')).toBe(true);
      expect(isZoomOrMeetingName('online session')).toBe(true);
      expect(isZoomOrMeetingName('virtual classroom')).toBe(true);

      expect(isZoomOrMeetingName('סילבוס הקורס')).toBe(false);
      expect(isZoomOrMeetingName('מטלה 1 - תרגיל בית')).toBe(false);
      expect(isZoomOrMeetingName('')).toBe(false);
    });

    it('should extract Zoom links and titles from HTML snippets', () => {
      const html = `
        <div>
          <p>קישור להרצאה: <a href="https://tau-ac-il.zoom.us/j/111222333?pwd=xyz">חדר הרצאה ראשי</a></p>
          <p>קישור לתרגול: https://tau-ac-il.zoom.us/j/444555666?pwd=abc</p>
        </div>
      `;
      const links = extractZoomLinksFromHtml(html);
      expect(links).toHaveLength(2);

      expect(links[0].url).toContain('111222333');
      expect(links[0].title).toBe('חדר הרצאה ראשי');

      expect(links[1].url).toContain('444555666');
    });

    it('should ignore non-joinable portal/homepage Zoom links in extractZoomLinksFromHtml', () => {
      const html = `
        <div>
          <p>פורטל: <a href="https://tau-ac-il.zoom.us">כניסה לזום</a></p>
          <p>עזרה: <a href="https://zoom.us/test">בדיקת חיבור</a></p>
          <p>הרצאה אמיתית: <a href="https://tau-ac-il.zoom.us/j/86295092403">הרצאה שבועית</a></p>
        </div>
      `;
      const links = extractZoomLinksFromHtml(html);
      expect(links).toHaveLength(1);
      expect(links[0].url).toContain('86295092403');
      expect(links[0].title).toBe('הרצאה שבועית');
    });
  });

  describe('TC-ZM-02: Active Meeting Detection (● פעיל כעת)', () => {
    it('should mark meeting as active when current time is within meeting window', () => {
      const isMeetingActive = (startTimeMs: number, durationMinutes: number, currentTimeMs: number): boolean => {
        const endTimeMs = startTimeMs + durationMinutes * 60 * 1000;
        return currentTimeMs >= startTimeMs && currentTimeMs <= endTimeMs;
      };

      const meetingStart = new Date('2026-10-12T10:00:00Z').getTime();
      const duration = 120; // 2 hours

      // At 10:30 (active)
      const testTimeActive = new Date('2026-10-12T10:30:00Z').getTime();
      expect(isMeetingActive(meetingStart, duration, testTimeActive)).toBe(true);

      // At 14:00 (inactive)
      const testTimeInactive = new Date('2026-10-12T14:00:00Z').getTime();
      expect(isMeetingActive(meetingStart, duration, testTimeInactive)).toBe(false);

      // Before start at 09:30 (inactive)
      const testTimeBefore = new Date('2026-10-12T09:30:00Z').getTime();
      expect(isMeetingActive(meetingStart, duration, testTimeBefore)).toBe(false);
    });
  });

  describe('TC-ZM-03: Zoom Meeting Interest / Favorite Toggle', () => {
    it('should toggle meeting numbers in interested meetings array', () => {
      let interestedMeetings: string[] = [];

      const toggleInterest = (meetingNumber: string) => {
        if (interestedMeetings.includes(meetingNumber)) {
          interestedMeetings = interestedMeetings.filter((num) => num !== meetingNumber);
        } else {
          interestedMeetings.push(meetingNumber);
        }
      };

      toggleInterest('123456789');
      expect(interestedMeetings).toContain('123456789');

      toggleInterest('123456789');
      expect(interestedMeetings).not.toContain('123456789');
    });
  });

  describe('TC-ZM-05: Multi-modal Zoom Extraction via runSync', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('should extract Zoom meetings from URL modules, Hebrew titles, labels, summaries, and pages without fake LTI meeting rows', async () => {
      global.fetch = jest.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        const urlStr = String(url);
        const bodyStr = init?.body ? String(init.body) : '';
        const matches = (fn: string) => urlStr.includes(fn) || bodyStr.includes(fn);

        if (matches('core_webservice_get_site_info')) {
          return {
            ok: true,
            json: async () => ({ userid: 100, fullname: 'Student Tester' }),
          };
        }

        if (matches('core_enrol_get_users_courses')) {
          return {
            ok: true,
            json: async () => [
              { id: 9001, fullname: 'מבוא לתכנות', shortname: '03681111-01' },
            ],
          };
        }

        if (matches('mod_assign_get_assignments')) {
          return {
            ok: true,
            json: async () => ({
              courses: [{ id: 9001, assignments: [] }],
            }),
          };
        }

        if (matches('gradereport_user_get_grade_items')) {
          return {
            ok: true,
            json: async () => ({ usergrades: [{ courseid: 9001, gradeitems: [] }] }),
          };
        }

        if (matches('core_course_get_contents')) {
          return {
            ok: true,
            json: async () => [
              {
                id: 1,
                name: 'מידע כללי',
                summary: '<p>קישור למפגש השבועי: <a href="https://tau-ac-il.zoom.us/j/999111222?pwd=summaryPwd">זום שבועי</a></p>',
                modules: [
                  // 1. Direct URL module pointing to Zoom
                  {
                    id: 201,
                    name: 'קישור לשיעורי זום',
                    modname: 'url',
                    contents: [
                      {
                        type: 'url',
                        filename: 'שיעורי זום',
                        fileurl: 'https://tau-ac-il.zoom.us/j/123456789?pwd=secretPwd',
                        filesize: 0,
                        mimetype: 'text/html',
                        timemodified: 1729000000,
                      },
                    ],
                  },
                  // 2. URL module with Hebrew keyword and module.url fallback (not a direct zoom url)
                  {
                    id: 202,
                    name: 'מפגש מקוון עם המרצה',
                    modname: 'url',
                    url: 'https://moodle.tau.ac.il/mod/url/view.php?id=202',
                    contents: [],
                  },
                  // 3. LTI module with scraping disabled (should be registered as course link, NOT as a fake Zoom meeting)
                  {
                    id: 203,
                    name: 'שיעורי Zoom והקלטות',
                    modname: 'lti',
                    instance: 555,
                    url: 'https://moodle.tau.ac.il/mod/lti/view.php?id=203',
                  },
                  // 4. Label module with embedded HTML Zoom link
                  {
                    id: 204,
                    name: 'קישור קבוע להרצאות',
                    modname: 'label',
                    description: '<p>הצטרפו דרך: <a href="https://tau-ac-il.zoom.us/j/555666777?pwd=labelPwd">כניסה לזום</a></p>',
                  },
                  // 5. Page module with embedded Zoom link in contents[0].content
                  {
                    id: 206,
                    name: 'דף קישורי זום לתרגולים',
                    modname: 'page',
                    contents: [
                      {
                        type: 'file',
                        filename: 'index.html',
                        fileurl: 'https://moodle.tau.ac.il/webservice/pluginfile.php/123/page/content/index.html',
                        content: '<p>קישור לזום תרגול: <a href="https://tau-ac-il.zoom.us/j/777888999?pwd=pagePwd">זום תרגול בדף</a></p>',
                        filesize: 100,
                        mimetype: 'text/html',
                        timemodified: 1729000000,
                      },
                    ],
                  },
                ],
              },
              {
                id: 2,
                name: 'שבוע 1',
                modules: [
                  // Duplicate link of 201 should be deduplicated
                  {
                    id: 205,
                    name: 'קישור לשיעורי זום שבוע 1',
                    modname: 'url',
                    contents: [
                      {
                        type: 'url',
                        filename: 'שיעורי זום',
                        fileurl: 'https://tau-ac-il.zoom.us/j/123456789?pwd=secretPwd',
                        filesize: 0,
                        mimetype: 'text/html',
                        timemodified: 1729000000,
                      },
                    ],
                  },
                ],
              },
            ],
          };
        }

        return {
          ok: true,
          json: async () => ({}),
        };
      });

      const result = await runSync(
        'mock-token',
        [9001],
        () => {},
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { enableScraping: false }
      );

      // Verify that every meeting in result.meetings is a genuine Zoom URL
      expect(result.meetings.length).toBeGreaterThan(0);
      for (const m of result.meetings) {
        expect(isZoomUrl(m.meetingUrl)).toBe(true);
      }

      // Verify URL module was extracted
      const urlMeeting = result.meetings.find((m) => m.meetingNumber === '123456789');
      expect(urlMeeting).toBeDefined();
      expect(urlMeeting?.password).toBe('secretPwd');
      expect(urlMeeting?.meetingUrl).toBe('https://tau-ac-il.zoom.us/j/123456789?pwd=secretPwd');

      // Verify non-Zoom URL module is NOT in meetings
      const hebrewUrlMeeting = result.meetings.find((m) => m.title === 'מפגש מקוון עם המרצה');
      expect(hebrewUrlMeeting).toBeUndefined();

      // Verify LTI module is NOT added as a fake meeting in meetings
      const ltiMeeting = result.meetings.find((m) => m.title === 'שיעורי Zoom והקלטות');
      expect(ltiMeeting).toBeUndefined();

      // But verify LTI module IS registered under links with linkKind 'zoom'
      const ltiLink = result.links?.find((l) => l.id === 203);
      expect(ltiLink).toBeDefined();
      expect(ltiLink?.linkKind).toBe('zoom');
      expect(ltiLink?.targetUrl).toBe('https://moodle.tau.ac.il/mod/lti/view.php?id=203');

      // Verify Label embedded HTML link was extracted
      const labelMeeting = result.meetings.find((m) => m.meetingNumber === '555666777');
      expect(labelMeeting).toBeDefined();
      expect(labelMeeting?.password).toBe('labelPwd');

      // Verify Page module embedded HTML link from contents[0].content was extracted
      const pageMeeting = result.meetings.find((m) => m.meetingNumber === '777888999');
      expect(pageMeeting).toBeDefined();
      expect(pageMeeting?.password).toBe('pagePwd');

      // Verify Section Summary link was extracted
      const summaryMeeting = result.meetings.find((m) => m.meetingNumber === '999111222');
      expect(summaryMeeting).toBeDefined();
      expect(summaryMeeting?.password).toBe('summaryPwd');

      // Verify deduplication: 123456789 should only appear once
      const dups = result.meetings.filter((m) => m.meetingNumber === '123456789');
      expect(dups).toHaveLength(1);
    });
  });

  describe('TC-ZM-06: Recurring Zoom Meeting Collapsing & Parsing', () => {
    it('should collapse recurring meetings into the closest upcoming session', () => {
      const now = new Date('2026-10-15T12:00:00Z');
      const mockMeetings = [
        // Group 1: 3 weekly instances of Lecture 01 (meetingNumber 1001)
        {
          title: 'הרצאה 01',
          meetingUrl: 'https://tau-ac-il.zoom.us/j/1001',
          meetingNumber: '1001',
          sectionName: 'שבוע 1',
          courseId: 101,
          courseName: 'מבוא למדעי המחשב',
          startTime: '2026-10-08T10:00:00Z', // past
        },
        {
          title: 'הרצאה 01',
          meetingUrl: 'https://tau-ac-il.zoom.us/j/1001',
          meetingNumber: '1001',
          sectionName: 'שבוע 2',
          courseId: 101,
          courseName: 'מבוא למדעי המחשב',
          startTime: '2026-10-16T10:00:00Z', // upcoming soonest!
        },
        {
          title: 'הרצאה 01',
          meetingUrl: 'https://tau-ac-il.zoom.us/j/1001',
          meetingNumber: '1001',
          sectionName: 'שבוע 3',
          courseId: 101,
          courseName: 'מבוא למדעי המחשב',
          startTime: '2026-10-23T10:00:00Z', // upcoming later
        },
        // Group 2: Recitation 02 (meetingNumber 1002) - past only
        {
          title: 'תרגול 02',
          meetingUrl: 'https://tau-ac-il.zoom.us/j/1002',
          meetingNumber: '1002',
          sectionName: 'שבוע 1',
          courseId: 101,
          courseName: 'מבוא למדעי המחשב',
          startTime: '2026-10-05T14:00:00Z', // past earlier
        },
        {
          title: 'תרגול 02',
          meetingUrl: 'https://tau-ac-il.zoom.us/j/1002',
          meetingNumber: '1002',
          sectionName: 'שבוע 2',
          courseId: 101,
          courseName: 'מבוא למדעי המחשב',
          startTime: '2026-10-12T14:00:00Z', // past latest!
        },
        // Group 3: Static link without date
        {
          title: 'שעות קבלה מרצה',
          meetingUrl: 'https://tau-ac-il.zoom.us/j/1003',
          meetingNumber: '1003',
          sectionName: 'כללי',
          courseId: 101,
          courseName: 'מבוא למדעי המחשב',
        },
      ];

      const collapsed = collapseRecurringMeetings(mockMeetings, now);

      // Should have exactly 3 meetings (one per room/meetingNumber)
      expect(collapsed).toHaveLength(3);

      // Room 1001 should pick the soonest upcoming (2026-10-16)
      const lecture1 = collapsed.find((m) => m.meetingNumber === '1001');
      expect(lecture1?.startTime).toBe('2026-10-16T10:00:00Z');

      // Room 1002 should pick the latest past (2026-10-12)
      const recitation = collapsed.find((m) => m.meetingNumber === '1002');
      expect(recitation?.startTime).toBe('2026-10-12T14:00:00Z');

      // Room 1003 should be preserved
      const officeHours = collapsed.find((m) => m.meetingNumber === '1003');
      expect(officeHours).toBeDefined();
      expect(officeHours?.title).toBe('שעות קבלה מרצה');
    });

    it('should correctly parse Zoom LTI appConf with JSON or regex structure', () => {
      const mockHtmlJson = `
        <html>
          <head>
            <script>
              window.__appConf__ = {
                "ajaxHeaders": [
                  { "key": "X-Lti-Auth-Token", "value": "token-xyz-123" },
                  { "key": "X-Lti-Signature", "value": "sig-abc-456" }
                ]
              };
            </script>
          </head>
        </html>
      `;

      const conf1 = parseAppConf(mockHtmlJson);
      expect(conf1.ajaxHeaders).toHaveLength(2);
      expect(conf1.ajaxHeaders[0].key).toBe('X-Lti-Auth-Token');
      expect(conf1.ajaxHeaders[0].value).toBe('token-xyz-123');

      const mockHtmlRegex = `
        <html>
          <body>
            <script>
              var config = {
                ajaxHeaders: [
                  { 'key': 'X-Lti-Auth-Token', 'value': 'regex-tok' },
                  { 'value': 'regex-val', 'key': 'X-Custom-Header' }
                ]
              };
            </script>
          </body>
        </html>
      `;

      const conf2 = parseAppConf(mockHtmlRegex);
      expect(conf2.ajaxHeaders).toHaveLength(2);
      expect(conf2.ajaxHeaders.find((h: any) => h.key === 'X-Custom-Header')?.value).toBe('regex-val');
    });

    it('should retain currently active meeting in collapseRecurringMeetings instead of skipping to next week', () => {
      // Lecture started 20 minutes ago at 10:00Z, current time is 10:20Z
      const now = new Date('2026-10-16T10:20:00Z');
      const mockMeetings = [
        {
          title: 'הרצאה 01',
          meetingUrl: 'https://tau-ac-il.zoom.us/j/1001',
          meetingNumber: '1001',
          sectionName: 'שבוע 2',
          courseId: 101,
          courseName: 'מבוא למדעי המחשב',
          startTime: '2026-10-16T10:00:00Z', // active right now!
        },
        {
          title: 'הרצאה 01',
          meetingUrl: 'https://tau-ac-il.zoom.us/j/1001',
          meetingNumber: '1001',
          sectionName: 'שבוע 3',
          courseId: 101,
          courseName: 'מבוא למדעי המחשב',
          startTime: '2026-10-23T10:00:00Z', // next week
        },
      ];

      const collapsed = collapseRecurringMeetings(mockMeetings, now);
      expect(collapsed).toHaveLength(1);
      expect(collapsed[0].startTime).toBe('2026-10-16T10:00:00Z');
    });

    it('should strip creation timestamps on No Fixed Time meetings and validate scheduled 5-min intervals via normalizeZoomStartTime', () => {
      const refDate = new Date('2026-10-16T10:00:00Z');

      // 1. Valid scheduled meeting (type 2, on 5-min boundary with :00 seconds)
      expect(
        normalizeZoomStartTime({ type: 2, startTime: '2026-10-16T12:00:00Z' }, true, refDate)
      ).toBe('2026-10-16T12:00:00.000Z');

      // 2. Valid recurring fixed-time meeting (type 8, on 15-min boundary)
      expect(
        normalizeZoomStartTime({ type: 8, startTime: '2026-10-16T14:15:00Z' }, true, refDate)
      ).toBe('2026-10-16T14:15:00.000Z');

      // 3. Recurring with No Fixed Time (type 3) - should return undefined even if startTime is present
      expect(
        normalizeZoomStartTime({ type: 3, startTime: '2026-09-01T02:30:00Z' }, true, refDate)
      ).toBeUndefined();

      // 4. Instant meeting (type 1) or PMI (type 4) - should return undefined
      expect(
        normalizeZoomStartTime({ type: 1, startTime: '2026-10-16T12:00:00Z' }, true, refDate)
      ).toBeUndefined();
      expect(
        normalizeZoomStartTime({ type: 4, startTime: '2026-10-16T12:00:00Z' }, true, refDate)
      ).toBeUndefined();

      // 5. Creation timestamp artifact with non-zero seconds or non-5-minute granularity (e.g. 23:14:52)
      expect(
        normalizeZoomStartTime({ startTime: '2026-10-01T23:14:52Z' }, true, refDate)
      ).toBeUndefined();
      expect(
        normalizeZoomStartTime({ startTime: '2026-10-01T11:03:00Z' }, true, refDate)
      ).toBeUndefined();

      // 6. Stale previous meeting that ended days ago -> startTime stripped
      expect(
        normalizeZoomStartTime({ type: 2, startTime: '2026-10-01T10:00:00Z', duration: 90 }, false, refDate)
      ).toBeUndefined();
    });

    it('should correctly treat Zoom LTI API start time as UTC and fix Issue #35 (2-hour shift)', () => {
      // 1. Zoom LTI API returns standard SQL datetime string with "timezone": "UTC"
      const zoomLtiUtcMeeting = {
        type: 2,
        startTime: '2026-11-03 10:00:00',
        timezone: 'UTC',
        duration: 120,
      };
      const normalizedUtc = normalizeZoomStartTime(zoomLtiUtcMeeting, true);
      expect(normalizedUtc).toBe('2026-11-03T10:00:00.000Z');

      // 2. Real-world scenario from user log:
      // Zoom LTI API returns raw="2026-11-17 10:00:00" and tz="Asia/Jerusalem".
      // The startTime is already in UTC (representing 12:00 PM Jerusalem class time).
      const zoomLtiJerusalemMeeting = {
        type: 2,
        startTime: '2026-11-17 10:00:00',
        timezone: 'Asia/Jerusalem',
        duration: 120,
      };
      expect(normalizeZoomStartTime(zoomLtiJerusalemMeeting, true)).toBe('2026-11-17T10:00:00.000Z');

      // 3. Fallback to start_time property
      const snakeCaseMeeting = {
        type: 2,
        start_time: '2026-11-03 10:00:00',
        timeZone: 'UTC',
      };
      expect(normalizeZoomStartTime(snakeCaseMeeting, true)).toBe('2026-11-03T10:00:00.000Z');

      // 4. Verification of Issue #35 bug condition:
      // Lecture is scheduled for 10:00:00 UTC (which is 12:00:00 local Israel time).
      const scheduledUtcIso = normalizedUtc!;
      const scheduledStartTimeMs = new Date(scheduledUtcIso).getTime();
      const endTimeMs = scheduledStartTimeMs + 2 * 60 * 60 * 1000;

      // At 10:00:00 local Israel time (08:00:00 UTC) - 2 hours BEFORE class starts:
      const twoHoursEarlyMs = new Date('2026-11-03T08:00:00.000Z').getTime();
      const isLiveEarly = twoHoursEarlyMs >= scheduledStartTimeMs && twoHoursEarlyMs <= endTimeMs;
      expect(isLiveEarly).toBe(false); // MUST NOT be live 2 hours early!

      // At 12:00:00 local Israel time (10:00:00 UTC) - ON TIME when class starts:
      const onTimeMs = new Date('2026-11-03T10:00:00.000Z').getTime();
      const isLiveOnTime = onTimeMs >= scheduledStartTimeMs && onTimeMs <= endTimeMs;
      expect(isLiveOnTime).toBe(true); // MUST be live when class starts!
    });

    it('should parse datetime strings into UTC Date via parseDateTimeInZone', () => {
      // Explicit Z
      expect(parseDateTimeInZone('2026-11-03T10:00:00Z').toISOString()).toBe('2026-11-03T10:00:00.000Z');
      // Explicit numeric offset (+02:00 Israel time)
      expect(parseDateTimeInZone('2026-11-03T12:00:00+02:00').toISOString()).toBe('2026-11-03T10:00:00.000Z');
      // Space-separated SQL timestamp without offset -> treated as UTC as per Zoom LTI API
      expect(parseDateTimeInZone('2026-11-03 10:00:00').toISOString()).toBe('2026-11-03T10:00:00.000Z');
    });

    it('should correctly parse meeting IDs with spaces into join URLs', () => {
      const parsedWithSpaces = parseZoomUrl('https://tau-ac-il.zoom.us/j/862 9509 2403?pwd=secretPassword');
      expect(parsedWithSpaces.meetingNumber).toBe('86295092403');
      expect(parsedWithSpaces.meetingUrl).toBe('https://tau-ac-il.zoom.us/j/86295092403?pwd=secretPassword');
      expect(isZoomJoinUrl(parsedWithSpaces.meetingUrl, parsedWithSpaces.meetingNumber)).toBe(true);

      const parsedEncoded = parseZoomUrl('https://tau-ac-il.zoom.us/j/862%209509%202403');
      expect(parsedEncoded.meetingNumber).toBe('86295092403');
      expect(parsedEncoded.meetingUrl).toBe('https://tau-ac-il.zoom.us/j/86295092403');
    });

    it('should extract Zoom meetings from LTI HTML table rows and embedded scripts (TC-ZM-05)', async () => {
      const originalFetch = global.fetch;
      const htmlWithTable = `
        <html>
          <body>
            <table>
              <tr>
                <td>Tomorrow (Recurring) 5:00 AM</td>
                <td>מכניקה אנליטית יום ד</td>
                <td>862 9509 2403</td>
                <td><button>Join</button></td>
              </tr>
              <tr>
                <td>Tomorrow (Recurring) 8:00 AM</td>
                <td>תרגול - יום רביעי</td>
                <td>815 9228 2211</td>
                <td><button>Join</button></td>
              </tr>
            </table>
          </body>
        </html>
      `;

      global.fetch = jest.fn(async (url: any, init?: any) => {
        const urlStr = String(url);
        if (urlStr.includes('mod_lti_get_tool_launch_data')) {
          return {
            ok: true,
            json: async () => ({
              endpoint: 'https://applications.zoom.us/lti/rich',
              parameters: [{ name: 'oauth_consumer_key', value: 'key123' }],
            }),
          };
        }
        if (urlStr.includes('applications.zoom.us/lti/rich')) {
          return {
            ok: true,
            text: async (): Promise<string> => htmlWithTable,
            headers: new Headers(),
          };
        }
        return {
          ok: false,
          status: 404,
          json: async () => ({}),
          text: async () => '',
        };
      }) as any;

      try {
        const meetings = await scrapeZoomMeetingsWithToken('mock-token', 101, 'https://moodle.tau.ac.il', 202);
        expect(meetings.length).toBe(2);

        const m1 = meetings.find((m) => m.meetingNumber === '86295092403');
        expect(m1).toBeDefined();
        expect(m1?.topic).toBe('מכניקה אנליטית יום ד');
        expect(m1?.joinUrl).toBe('https://tau-ac-il.zoom.us/j/86295092403');

        const m2 = meetings.find((m) => m.meetingNumber === '81592282211');
        expect(m2).toBeDefined();
        expect(m2?.topic).toBe('תרגול - יום רביעי');
        expect(m2?.joinUrl).toBe('https://tau-ac-il.zoom.us/j/81592282211');
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('should collapse recurring class sessions preserving nearest active or upcoming session', () => {
      const now = new Date('2026-11-11T02:00:00.000Z');
      const sessions = [
        {
          courseId: 101,
          courseName: 'מכניקה אנליטית',
          title: 'מכניקה אנליטית יום ד',
          meetingNumber: '86295092403',
          meetingUrl: 'https://tau-ac-il.zoom.us/j/86295092403',
          sectionName: 'General',
          startTime: '2026-11-11T03:00:00.000Z', // Tomorrow 5 AM Israel time
        },
        {
          courseId: 101,
          courseName: 'מכניקה אנליטית',
          title: 'מכניקה אנליטית יום ד',
          meetingNumber: '86295092403',
          meetingUrl: 'https://tau-ac-il.zoom.us/j/86295092403',
          sectionName: 'General',
          startTime: '2026-11-18T03:00:00.000Z', // Next week
        },
        {
          courseId: 101,
          courseName: 'מכניקה אנליטית',
          title: 'תרגול - יום רביעי',
          meetingNumber: '81592282211',
          meetingUrl: 'https://tau-ac-il.zoom.us/j/81592282211',
          sectionName: 'General',
          startTime: '2026-11-11T06:00:00.000Z',
        },
      ];

      const collapsed = collapseRecurringMeetings(sessions, now);
      expect(collapsed.length).toBe(2);

      const lecture = collapsed.find((m) => m.meetingNumber === '86295092403');
      expect(lecture?.startTime).toBe('2026-11-11T03:00:00.000Z'); // Should pick nearest upcoming!
    });

    it('should extract all Zoom meetings from Moodle mod_zoom / mod_lti view page matching Hebrew class schedule (TC-ZM-07)', async () => {
      const originalFetch = global.fetch;
      const htmlFromScreenshot = `
        <div class="page-header">
          <h2>קישורי זום - הרצאה ותרגולים</h2>
        </div>
        <table class="generaltable">
          <thead>
            <tr>
              <th class="header c0">Start Time</th>
              <th class="header c1">Topic</th>
              <th class="header c2">Meeting ID</th>
              <th class="header c3">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="cell c0">Tomorrow (Recurring)<br>7:05 AM</td>
              <td class="cell c1">תרגול שלישי רביעי 17:00-18:00</td>
              <td class="cell c2">840 9026 3132</td>
              <td class="cell c3"><button>Join</button> <button>Invitation</button></td>
            </tr>
            <tr>
              <td class="cell c0">Tomorrow (Recurring)<br>8:05 AM</td>
              <td class="cell c1">תרגול רביעי 18:00-19:00</td>
              <td class="cell c2">821 2946 9420</td>
              <td class="cell c3"><button>Join</button> <button>Invitation</button></td>
            </tr>
            <tr>
              <td class="cell c0">Thu, Nov 12 (Recurring)<br>4:00 AM</td>
              <td class="cell c1">גלים אור ואופטיקה - הרצאה יום חמישי</td>
              <td class="cell c2">823 0074 2209</td>
              <td class="cell c3"><button>Join</button> <button>Invitation</button></td>
            </tr>
            <tr>
              <td class="cell c0">Mon, Nov 16 (Recurring)<br>7:00 AM</td>
              <td class="cell c1">גלים אור ואופטיקה - הרצאה יום שני</td>
              <td class="cell c2">836 9487 3763</td>
              <td class="cell c3"><button>Join</button> <button>Invitation</button></td>
            </tr>
          </tbody>
        </table>
      `;

      global.fetch = jest.fn(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/mod/zoom/view.php?id=301') || urlStr.includes('/mod/lti/view.php?id=301')) {
          return {
            ok: true,
            text: async (): Promise<string> => htmlFromScreenshot,
            headers: new Headers(),
          };
        }
        return {
          ok: false,
          status: 404,
          json: async () => ({}),
          text: async () => '',
        };
      }) as any;

      try {
        const meetings = await scrapeZoomMeetingsWithToken(
          'mock-token',
          301,
          'https://moodle.tau.ac.il',
          301,
          null,
          'zoom'
        );

        expect(meetings).toHaveLength(4);

        const m1 = meetings.find((m) => m.meetingNumber === '84090263132');
        expect(m1).toBeDefined();
        expect(m1?.topic).toBe('תרגול שלישי רביעי 17:00-18:00');
        expect(m1?.joinUrl).toBe('https://tau-ac-il.zoom.us/j/84090263132');

        const m2 = meetings.find((m) => m.meetingNumber === '82129469420');
        expect(m2).toBeDefined();
        expect(m2?.topic).toBe('תרגול רביעי 18:00-19:00');
        expect(m2?.joinUrl).toBe('https://tau-ac-il.zoom.us/j/82129469420');

        const m3 = meetings.find((m) => m.meetingNumber === '82300742209');
        expect(m3).toBeDefined();
        expect(m3?.topic).toBe('גלים אור ואופטיקה - הרצאה יום חמישי');
        expect(m3?.joinUrl).toBe('https://tau-ac-il.zoom.us/j/82300742209');

        const m4 = meetings.find((m) => m.meetingNumber === '83694873763');
        expect(m4).toBeDefined();
        expect(m4?.topic).toBe('גלים אור ואופטיקה - הרצאה יום שני');
        expect(m4?.joinUrl).toBe('https://tau-ac-il.zoom.us/j/83694873763');
      } finally {
        global.fetch = originalFetch;
      }
    });
  });
});

