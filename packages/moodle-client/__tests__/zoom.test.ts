import { runSync } from '../src/syncEngine.js';
import {
  isZoomUrl,
  isZoomOrMeetingName,
  parseZoomUrl,
  extractZoomLinksFromHtml,
  collapseRecurringMeetings,
  parseAppConf,
  normalizeZoomStartTime,
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

    it('should identify English and Hebrew Zoom/meeting keywords using isZoomOrMeetingName', () => {
      expect(isZoomOrMeetingName('Zoom Meeting')).toBe(true);
      expect(isZoomOrMeetingName('שיעורי Zoom והקלטות')).toBe(true);
      expect(isZoomOrMeetingName('קישור לזום')).toBe(true);
      expect(isZoomOrMeetingName('מפגש מקוון')).toBe(true);
      expect(isZoomOrMeetingName('שיעור מקוון')).toBe(true);
      expect(isZoomOrMeetingName('הרצאה מקוונת')).toBe(true);
      expect(isZoomOrMeetingName('חדר זום לתרגול')).toBe(true);

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

    it('should extract Zoom meetings from URL modules, Hebrew titles, LTI fallbacks, labels, and summaries', async () => {
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
                  // 2. URL module with Hebrew keyword and module.url fallback
                  {
                    id: 202,
                    name: 'מפגש מקוון עם המרצה',
                    modname: 'url',
                    url: 'https://moodle.tau.ac.il/mod/url/view.php?id=202',
                    contents: [],
                  },
                  // 3. LTI module with scraping disabled (should produce fallback meeting link)
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

      expect(result.meetings.length).toBeGreaterThanOrEqual(4);

      // Verify URL module was extracted
      const urlMeeting = result.meetings.find((m) => m.meetingNumber === '123456789');
      expect(urlMeeting).toBeDefined();
      expect(urlMeeting?.password).toBe('secretPwd');
      expect(urlMeeting?.meetingUrl).toBe('https://tau-ac-il.zoom.us/j/123456789?pwd=secretPwd');

      // Verify Hebrew keyword URL module was extracted
      const hebrewUrlMeeting = result.meetings.find((m) => m.title === 'מפגש מקוון עם המרצה');
      expect(hebrewUrlMeeting).toBeDefined();
      expect(hebrewUrlMeeting?.meetingUrl).toBe('https://moodle.tau.ac.il/mod/url/view.php?id=202');

      // Verify LTI fallback meeting was extracted even with enableScraping: false
      const ltiMeeting = result.meetings.find((m) => m.title === 'שיעורי Zoom והקלטות');
      expect(ltiMeeting).toBeDefined();
      expect(ltiMeeting?.meetingUrl).toBe('https://moodle.tau.ac.il/mod/lti/view.php?id=203');

      // Verify Label embedded HTML link was extracted
      const labelMeeting = result.meetings.find((m) => m.meetingNumber === '555666777');
      expect(labelMeeting).toBeDefined();
      expect(labelMeeting?.password).toBe('labelPwd');

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
  });
});

