import {
  MoodleClient,
  MoodleApiError,
  IMoodleStrategy,
  UnsupportedStrategyError,
  MoodleSiteInfo,
  RawMoodleCourse,
  RawCourseSection,
} from '../src/moodleApi.js';

describe('Fallback Strategy Architecture', () => {
  const dummySiteInfo: MoodleSiteInfo = {
    userid: 12345,
    username: 'testuser',
    fullname: 'Test User',
    sitename: 'TAU Moodle',
  };

  const dummyCourses: RawMoodleCourse[] = [
    {
      id: 101,
      fullname: '03681118 - Discrete Mathematics',
      shortname: '03681118-01-2026-1',
      idnumber: '0368111801',
    },
  ];

  const dummySections: RawCourseSection[] = [
    {
      id: 1,
      name: 'General',
      modules: [
        {
          id: 1001,
          name: 'Syllabus',
          modname: 'resource',
          contents: [
            {
              type: 'file',
              filename: 'syllabus.pdf',
              fileurl: 'https://moodle.tau.ac.il/mod/resource/view.php?id=1001',
              filesize: 1024,
              mimetype: 'application/pdf',
              timemodified: 1700000000,
            },
          ],
        },
      ],
    },
  ];

  it('TC-FALLBACK-01: should succeed immediately when primary REST strategy succeeds', async () => {
    const mockRest: IMoodleStrategy = {
      name: 'REST',
      getSiteInfo: jest.fn().mockResolvedValue(dummySiteInfo),
      getEnrolledCourses: jest.fn(),
      getAssignments: jest.fn(),
      getSubmissionStatus: jest.fn(),
      getGradeItems: jest.fn(),
      getCourseContents: jest.fn(),
      uploadFile: jest.fn(),
      saveSubmission: jest.fn(),
      submitForGrading: jest.fn(),
      getAutoLoginKey: jest.fn(),
      saveNoodleSettings: jest.fn(),
      loadNoodleSettings: jest.fn(),
    };

    const mockAjax: IMoodleStrategy = {
      name: 'AJAX',
      getSiteInfo: jest.fn(),
      getEnrolledCourses: jest.fn(),
      getAssignments: jest.fn(),
      getSubmissionStatus: jest.fn(),
      getGradeItems: jest.fn(),
      getCourseContents: jest.fn(),
      uploadFile: jest.fn(),
      saveSubmission: jest.fn(),
      submitForGrading: jest.fn(),
      getAutoLoginKey: jest.fn(),
      saveNoodleSettings: jest.fn(),
      loadNoodleSettings: jest.fn(),
    };

    const client = new MoodleClient('TEST_TOKEN', 'https://moodle.tau.ac.il', {
      strategies: [mockRest, mockAjax],
      devMode: true,
    });

    const siteInfo = await client.getSiteInfo();
    expect(siteInfo).toEqual(dummySiteInfo);
    expect(mockRest.getSiteInfo).toHaveBeenCalledTimes(1);
    expect(mockAjax.getSiteInfo).not.toHaveBeenCalled();
  });

  it('TC-FALLBACK-02: should fall back to AJAX when REST throws Access Control Exception', async () => {
    const mockRest: IMoodleStrategy = {
      name: 'REST',
      getSiteInfo: jest.fn(),
      getEnrolledCourses: jest
        .fn()
        .mockRejectedValue(new MoodleApiError('accessexception', 'Access control exception')),
      getAssignments: jest.fn(),
      getSubmissionStatus: jest.fn(),
      getGradeItems: jest.fn(),
      getCourseContents: jest.fn(),
      uploadFile: jest.fn(),
      saveSubmission: jest.fn(),
      submitForGrading: jest.fn(),
      getAutoLoginKey: jest.fn(),
      saveNoodleSettings: jest.fn(),
      loadNoodleSettings: jest.fn(),
    };

    const mockAjax: IMoodleStrategy = {
      name: 'AJAX',
      getSiteInfo: jest.fn(),
      getEnrolledCourses: jest.fn().mockResolvedValue(dummyCourses),
      getAssignments: jest.fn(),
      getSubmissionStatus: jest.fn(),
      getGradeItems: jest.fn(),
      getCourseContents: jest.fn(),
      uploadFile: jest.fn(),
      saveSubmission: jest.fn(),
      submitForGrading: jest.fn(),
      getAutoLoginKey: jest.fn(),
      saveNoodleSettings: jest.fn(),
      loadNoodleSettings: jest.fn(),
    };

    const client = new MoodleClient('TEST_TOKEN', 'https://moodle.tau.ac.il', {
      strategies: [mockRest, mockAjax],
      devMode: true,
    });

    const courses = await client.getEnrolledCourses(12345);
    expect(courses).toEqual(dummyCourses);
    expect(mockRest.getEnrolledCourses).toHaveBeenCalledTimes(1);
    expect(mockAjax.getEnrolledCourses).toHaveBeenCalledTimes(1);
  });

  it('TC-FALLBACK-03: should fall back from REST to Scraper when AJAX does not support the operation', async () => {
    const mockRest: IMoodleStrategy = {
      name: 'REST',
      getSiteInfo: jest.fn(),
      getEnrolledCourses: jest.fn(),
      getAssignments: jest.fn(),
      getSubmissionStatus: jest.fn(),
      getGradeItems: jest.fn(),
      getCourseContents: jest
        .fn()
        .mockRejectedValue(new MoodleApiError('accessexception', 'Access control exception')),
      uploadFile: jest.fn(),
      saveSubmission: jest.fn(),
      submitForGrading: jest.fn(),
      getAutoLoginKey: jest.fn(),
      saveNoodleSettings: jest.fn(),
      loadNoodleSettings: jest.fn(),
    };

    const mockAjax: IMoodleStrategy = {
      name: 'AJAX',
      getSiteInfo: jest.fn(),
      getEnrolledCourses: jest.fn(),
      getAssignments: jest.fn(),
      getSubmissionStatus: jest.fn(),
      getGradeItems: jest.fn(),
      getCourseContents: jest
        .fn()
        .mockRejectedValue(
          new UnsupportedStrategyError('AJAX', 'getCourseContents', 'core_course_get_contents is not ajax-enabled')
        ),
      uploadFile: jest.fn(),
      saveSubmission: jest.fn(),
      submitForGrading: jest.fn(),
      getAutoLoginKey: jest.fn(),
      saveNoodleSettings: jest.fn(),
      loadNoodleSettings: jest.fn(),
    };

    const mockScraper: IMoodleStrategy = {
      name: 'Scraper',
      getSiteInfo: jest.fn(),
      getEnrolledCourses: jest.fn(),
      getAssignments: jest.fn(),
      getSubmissionStatus: jest.fn(),
      getGradeItems: jest.fn(),
      getCourseContents: jest.fn().mockResolvedValue(dummySections),
      uploadFile: jest.fn(),
      saveSubmission: jest.fn(),
      submitForGrading: jest.fn(),
      getAutoLoginKey: jest.fn(),
      saveNoodleSettings: jest.fn(),
      loadNoodleSettings: jest.fn(),
    };

    const client = new MoodleClient('TEST_TOKEN', 'https://moodle.tau.ac.il', {
      strategies: [mockRest, mockAjax, mockScraper],
      devMode: true,
    });

    const sections = await client.getCourseContents(101);
    expect(sections).toEqual(dummySections);
    expect(mockRest.getCourseContents).toHaveBeenCalledTimes(1);
    expect(mockAjax.getCourseContents).toHaveBeenCalledTimes(1);
    expect(mockScraper.getCourseContents).toHaveBeenCalledTimes(1);
  });

  it('TC-FALLBACK-04: should throw when all fallback strategies fail', async () => {
    const mockRest: IMoodleStrategy = {
      name: 'REST',
      getSiteInfo: jest.fn(),
      getEnrolledCourses: jest.fn(),
      getAssignments: jest.fn(),
      getSubmissionStatus: jest.fn(),
      getGradeItems: jest.fn(),
      getCourseContents: jest
        .fn()
        .mockRejectedValue(new Error('Network error on REST')),
      uploadFile: jest.fn(),
      saveSubmission: jest.fn(),
      submitForGrading: jest.fn(),
      getAutoLoginKey: jest.fn(),
      saveNoodleSettings: jest.fn(),
      loadNoodleSettings: jest.fn(),
    };

    const mockAjax: IMoodleStrategy = {
      name: 'AJAX',
      getSiteInfo: jest.fn(),
      getEnrolledCourses: jest.fn(),
      getAssignments: jest.fn(),
      getSubmissionStatus: jest.fn(),
      getGradeItems: jest.fn(),
      getCourseContents: jest
        .fn()
        .mockRejectedValue(
          new UnsupportedStrategyError('AJAX', 'getCourseContents', 'not supported')
        ),
      uploadFile: jest.fn(),
      saveSubmission: jest.fn(),
      submitForGrading: jest.fn(),
      getAutoLoginKey: jest.fn(),
      saveNoodleSettings: jest.fn(),
      loadNoodleSettings: jest.fn(),
    };

    const mockScraper: IMoodleStrategy = {
      name: 'Scraper',
      getSiteInfo: jest.fn(),
      getEnrolledCourses: jest.fn(),
      getAssignments: jest.fn(),
      getSubmissionStatus: jest.fn(),
      getGradeItems: jest.fn(),
      getCourseContents: jest
        .fn()
        .mockRejectedValue(new Error('HTTP 500 on course page')),
      uploadFile: jest.fn(),
      saveSubmission: jest.fn(),
      submitForGrading: jest.fn(),
      getAutoLoginKey: jest.fn(),
      saveNoodleSettings: jest.fn(),
      loadNoodleSettings: jest.fn(),
    };

    const client = new MoodleClient('TEST_TOKEN', 'https://moodle.tau.ac.il', {
      strategies: [mockRest, mockAjax, mockScraper],
      devMode: false,
    });

    await expect(client.getCourseContents(101)).rejects.toThrow(
      /All strategies failed for getCourseContents/
    );
  });

  it('TC-FALLBACK-05: circuit breaker in RestMoodleStrategy triggers cooldown on accessexception and bypasses REST', async () => {
    const { RestMoodleStrategy } = await import('../src/strategies/restStrategy.js');
    RestMoodleStrategy.resetCooldown();

    // Mock global fetch to return accessexception for REST call
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      if (String(url).includes('/webservice/rest/server.php')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            exception: 'moodle_exception',
            errorcode: 'accessexception',
            message: 'חריגת בקרת גישה',
          }),
        };
      }
      return { ok: false, status: 404 };
    }) as any;

    try {
      const rest = new RestMoodleStrategy({
        token: 'TEST_TOKEN',
        baseUrl: 'https://moodle.tau.ac.il',
      });

      expect(rest.isOperationSupported('getSiteInfo')).toBe(true);

      // First call fails with accessexception
      await expect(rest.getSiteInfo()).rejects.toThrow(/חריגת בקרת גישה/);

      // Verify circuit breaker is now active
      expect(RestMoodleStrategy.isCoolingDown()).toBe(true);
      expect(rest.isOperationSupported('getSiteInfo')).toBe(false);

      // Next call fails immediately with UnsupportedStrategyError without making fetch
      (global.fetch as jest.Mock).mockClear();
      await expect(rest.getSiteInfo()).rejects.toThrow(/cooldown/);
      expect(global.fetch).not.toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
      RestMoodleStrategy.resetCooldown();
    }
  });

  it('TC-FALLBACK-06: AjaxMoodleStrategy marks non-course operations as unsupported', async () => {
    const { AjaxMoodleStrategy } = await import('../src/strategies/ajaxStrategy.js');
    const ajax = new AjaxMoodleStrategy({
      token: 'TEST_TOKEN',
      baseUrl: 'https://moodle.tau.ac.il',
    });

    expect(ajax.isOperationSupported('getEnrolledCourses')).toBe(true);
    expect(ajax.isOperationSupported('getSiteInfo')).toBe(false);
    expect(ajax.isOperationSupported('getAssignments')).toBe(false);
    expect(ajax.isOperationSupported('getCourseContents')).toBe(false);
    expect(ajax.isOperationSupported('getGradeItems')).toBe(false);
  });

  it('TC-FALLBACK-07: ScraperMoodleStrategy parses courses from cards, links, and JSON script data across pages', async () => {
    const { ScraperMoodleStrategy } = await import('../src/strategies/scraperStrategy.js');
    const scraper = new ScraperMoodleStrategy({
      token: '',
      baseUrl: 'https://moodle.tau.ac.il',
    });

    const mockMyCoursesHtml = `
      <!DOCTYPE html>
      <html>
        <body>
          <div class="card dashboard-card" data-course-id="201" aria-label="0368-2158-01 מבני נתונים">
            <a href="https://moodle.tau.ac.il/course/view.php?id=201">
              <span class="coursename">0368-2158-01 מבני נתונים</span>
            </a>
          </div>
        </body>
      </html>
    `;

    const mockProfileHtml = `
      <!DOCTYPE html>
      <html>
        <body>
          <section class="node_category">
            <ul>
              <li><a href="https://moodle.tau.ac.il/course/view.php?id=202">0368-1118-01 מתמטיקה בדידה</a></li>
            </ul>
          </section>
          <script>
            var state = {"courses":[{"id":203,"fullname":"0509-1851-01 אותות ומערכות","shortname":"Signals"}]};
          </script>
        </body>
      </html>
    `;

    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      const urlStr = String(url);
      if (urlStr.includes('/my/courses.php')) {
        return { ok: true, status: 200, text: async () => mockMyCoursesHtml };
      }
      if (urlStr.includes('/user/profile.php')) {
        return { ok: true, status: 200, text: async () => mockProfileHtml };
      }
      return { ok: true, status: 200, text: async () => '<html><body></body></html>' };
    }) as any;

    try {
      const courses = await scraper.getEnrolledCourses(12345);
      expect(courses.length).toBe(3);

      const c201 = courses.find((c) => c.id === 201);
      expect(c201).toBeDefined();
      expect(c201?.fullname).toContain('מבני נתונים');
      expect(c201?.idnumber).toBe('0368215801');

      const c202 = courses.find((c) => c.id === 202);
      expect(c202).toBeDefined();
      expect(c202?.fullname).toContain('מתמטיקה בדידה');
      expect(c202?.idnumber).toBe('0368111801');

      const c203 = courses.find((c) => c.id === 203);
      expect(c203).toBeDefined();
      expect(c203?.fullname).toContain('אותות ומערכות');
      expect(c203?.shortname).toBe('Signals');
    } finally {
      global.fetch = originalFetch;
    }
  });
});
