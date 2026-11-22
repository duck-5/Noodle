import { fetchCourseFormatState, fetchSesskeyFromJar } from '../src/courseFormatState.js';
import { CookieJar } from '../src/zoomScraper.js';
import { cleanMoodleString } from '../src/syncEngine.js';

describe('Phase 1: courseFormatState & cleanMoodleString (Hard Item #2 & multilang filtering)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('cleanMoodleString', () => {
    it('should extract correct language from multilang spans and decode HTML entities', () => {
      const rawBilingual =
        '<span lang="he" class="multilang">הודעות ועדכונים</span><span lang="en" class="multilang">Announcements &amp; News</span>';
      expect(cleanMoodleString(rawBilingual, 'he')).toBe('הודעות ועדכונים');
      expect(cleanMoodleString(rawBilingual, 'en')).toBe('Announcements & News');
    });

    it('should strip residual HTML tags and decode entities', () => {
      const raw = '<b>Lecture 1:</b> Introduction &lt;Overview&gt;';
      expect(cleanMoodleString(raw)).toBe('Lecture 1: Introduction <Overview>');
    });

    it('should handle plain strings safely', () => {
      expect(cleanMoodleString('Simple Title')).toBe('Simple Title');
      expect(cleanMoodleString('')).toBe('');
    });
  });

  describe('TC-API-010: Parse 2-Level Section Hierarchy from core_courseformat_get_state', () => {
    it('should parse multitopic course tabsdata and resolve sub-tab parents and levels', async () => {
      const mockFormatResponse = [
        {
          error: false,
          data: JSON.stringify({
            course: {
              id: 368220099,
              format: 'multitopic',
              tabsdata: [
                {
                  sectionid: '213920', // Intro top-level tab
                  subtree: [
                    { sectionid: '213920' }, // self
                    { sectionid: '213921' }, // Forums (sub-tab)
                    { sectionid: '213922' }, // Office hours (sub-tab)
                  ],
                },
                {
                  sectionid: '213923', // Java & VSCode top-level tab
                  subtree: [{ sectionid: '213923' }],
                },
              ],
            },
            section: [
              {
                id: '213920',
                section: 1,
                levelsan: 0,
                sectionurl: 'https://moodle.tau.ac.il/course/view.php?id=368220099&sectionid=213920',
              },
              {
                id: '213921',
                section: 2,
                parentid: '213920',
                levelsan: 1,
                sectionurl: 'https://moodle.tau.ac.il/course/view.php?id=368220099&sectionid=213921',
              },
              {
                id: '213922',
                section: 3,
                parentid: '213920',
                levelsan: 1,
                sectionurl: 'https://moodle.tau.ac.il/course/view.php?id=368220099&sectionid=213922',
              },
              {
                id: '213923',
                section: 4,
                levelsan: 0,
                sectionurl: 'https://moodle.tau.ac.il/course/view.php?id=368220099&sectionid=213923',
              },
            ],
          }),
        },
      ];

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockFormatResponse,
      } as any);

      const result = await fetchCourseFormatState({
        instanceBaseUrl: 'https://moodle.tau.ac.il',
        courseId: 368220099,
        sesskey: 'TEST_SESSKEY',
      });

      expect(result).not.toBeNull();
      const sections = result!.sections;

      // Top-level tab Intro
      const intro = sections.get(213920);
      expect(intro?.parentSectionId).toBeNull();
      expect(intro?.level).toBe(0);
      expect(intro?.sectionUrl).toContain('&sectionid=213920');

      // Sub-tab Forums
      const forums = sections.get(213921);
      expect(forums?.parentSectionId).toBe(213920);
      expect(forums?.level).toBe(1);
      expect(forums?.sectionUrl).toContain('&sectionid=213921');

      // Sub-tab Office hours
      const officeHours = sections.get(213922);
      expect(officeHours?.parentSectionId).toBe(213920);
      expect(officeHours?.level).toBe(1);

      // Top-level tab Java & VSCode
      const java = sections.get(213923);
      expect(java?.parentSectionId).toBeNull();
      expect(java?.level).toBe(0);
    });

    it('should not treat sections pointing to section 0 as subsections and correctly distinguish levelsan', async () => {
      const mockFormatResponse = [
        {
          error: false,
          data: JSON.stringify({
            course: {
              id: 101,
              format: 'topics',
            },
            section: [
              {
                id: '500',
                section: 0,
                levelsan: 0,
              },
              {
                id: '501',
                section: 1,
                parentid: '500', // Points to Section 0
                levelsan: 1,     // Standard top-level page/topic
              },
              {
                id: '502',
                section: 2,
                parentid: '501', // Real subsection under Section 1
                levelsan: 2,     // Subtopic level
              },
            ],
          }),
        },
      ];

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockFormatResponse,
      } as any);

      const result = await fetchCourseFormatState({
        instanceBaseUrl: 'https://moodle.tau.ac.il',
        courseId: 101,
        sesskey: 'TEST_SESSKEY',
      });

      expect(result).not.toBeNull();
      const sections = result!.sections;

      // Section 0
      expect(sections.get(500)?.parentSectionId).toBeNull();
      expect(sections.get(500)?.level).toBe(0);

      // Section 1 pointing to Section 0 is root (level 0, parentSectionId null)
      expect(sections.get(501)?.parentSectionId).toBeNull();
      expect(sections.get(501)?.level).toBe(0);

      // Section 2 pointing to Section 1 is genuine subsection
      expect(sections.get(502)?.parentSectionId).toBe(501);
      expect(sections.get(502)?.level).toBe(1);
    });

    it('should degrade gracefully and return null when sesskey is missing or response is invalid', async () => {
      const nullResult = await fetchCourseFormatState({
        instanceBaseUrl: 'https://moodle.tau.ac.il',
        courseId: 368220099,
        sesskey: '',
      });
      expect(nullResult).toBeNull();

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 403,
      } as any);

      const errorResult = await fetchCourseFormatState({
        instanceBaseUrl: 'https://moodle.tau.ac.il',
        courseId: 368220099,
        sesskey: 'EXPIRED_SESSKEY',
      });
      expect(errorResult).toBeNull();
    });

    it('should pass CookieJar cookies via mfetch when jar is provided in non-browser mode', async () => {
      const jar = CookieJar.fromCookies('MoodleSession=jarSession123; Extra=ok');
      const customFetch = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string>;
        expect(headers['Cookie']).toContain('MoodleSession=jarSession123');
        expect(headers['Cookie']).toContain('Extra=ok');
        return {
          ok: true,
          headers: new Headers(),
          json: async () => [
            {
              error: false,
              data: JSON.stringify({
                course: { id: 101, format: 'topics' },
                section: [{ id: '10', section: 1, levelsan: 1 }],
                cm: [{ id: 999, uservisible: false }],
              }),
            },
          ],
        } as unknown as Response;
      });

      const result = await fetchCourseFormatState({
        instanceBaseUrl: 'https://moodle.tau.ac.il',
        courseId: 101,
        sesskey: 'SK1',
        jar,
        fetch: customFetch as any,
      });

      expect(result).not.toBeNull();
      expect(result!.sections.get(10)?.level).toBe(0);
      expect(result!.lockedCmids?.has(999)).toBe(true);
    });
  });

  describe('fetchSesskeyFromJar', () => {
    it('should return null when redirected to /login/ or nidp.tau.ac.il', async () => {
      const jar = new CookieJar();
      const nidpFetch = jest.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 302,
          headers: new Headers({ location: 'https://nidp.tau.ac.il/nidp/idff/sso' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          text: async () => '<form id="login"><input name="Ecom_User_ID"></form>',
        });

      expect(
        await fetchSesskeyFromJar(jar, 'https://moodle.tau.ac.il', { fetch: nidpFetch as any })
      ).toBeNull();

      const moodleLoginFetch = jest.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 302,
          headers: new Headers({ location: 'https://moodle.tau.ac.il/login/index.php' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          text: async () => '{"sesskey":"GUEST_SHOULD_IGNORE"}',
        });

      expect(
        await fetchSesskeyFromJar(jar, 'https://moodle.tau.ac.il', { fetch: moodleLoginFetch as any })
      ).toBeNull();
    });

    it('should extract sesskey from authenticated /my/ HTML', async () => {
      const jar = CookieJar.fromCookies('MoodleSession=auth');
      const okFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => '<script>M.cfg = {"sesskey":"VALID123ABC"};</script>',
      });

      expect(
        await fetchSesskeyFromJar(jar, 'https://moodle.tau.ac.il', { fetch: okFetch as any })
      ).toBe('VALID123ABC');
    });
  });
});
