import {
  MoodleClient,
  MoodleApiError,
  IMoodleStrategy,
  UnsupportedStrategyError,
  MoodleSiteInfo,
  RawMoodleCourse,
  RawCourseSection,
  ScraperMoodleStrategy,
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

  it('TC-FALLBACK-08: should scrape courses across multiple academic archive years and tag their years and instance URLs', async () => {
    const scraper = new ScraperMoodleStrategy({
      token: 'TEST_TOKEN',
      baseUrl: 'https://moodle.tau.ac.il/webservice/rest/server.php',
      devMode: true,
    });

    const mock2025OverviewHtml = `
      <!DOCTYPE html>
      <html>
        <body>
          <table class="generaltable">
            <tr>
              <td><a href="https://moodle.tau.ac.il/2025/course/view.php?id=301">0368-2154-01-2025-1 אלגוריתמים</a></td>
            </tr>
            <tr>
              <td><a href="/2025/course/view.php?id=302">0368-1111-02-2025-2 חדווא 1</a></td>
            </tr>
          </table>
        </body>
      </html>
    `;

    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      const urlStr = String(url);
      if (urlStr.includes('/2025/grade/report/overview/index.php')) {
        return { ok: true, status: 200, text: async () => mock2025OverviewHtml };
      }
      // Root pages return empty / no courses
      return { ok: true, status: 200, text: async () => '<html><body><div class="empty">No courses</div></body></html>' };
    }) as any;

    try {
      const courses = await scraper.getEnrolledCourses(30909);
      expect(courses.length).toBe(2);

      const c301 = courses.find((c: RawMoodleCourse) => c.id === 301);
      expect(c301).toBeDefined();
      expect(c301?.fullname).toContain('אלגוריתמים');
      expect(c301?.year).toBe('2025');
      expect(c301?.instanceUrl).toBe('https://moodle.tau.ac.il/2025');

      const c302 = courses.find((c: RawMoodleCourse) => c.id === 302);
      expect(c302).toBeDefined();
      expect(c302?.fullname).toContain('חדווא 1');
      expect(c302?.year).toBe('2025');
      expect(c302?.instanceUrl).toBe('https://moodle.tau.ac.il/2025');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('TC-FALLBACK-09: should route getCourseContents to discovered year instance', async () => {
    const scraper = new ScraperMoodleStrategy({
      token: 'TEST_TOKEN',
      baseUrl: 'https://moodle.tau.ac.il/webservice/rest/server.php',
      devMode: true,
    });

    const mockCourseHtml = `
      <!DOCTYPE html>
      <html>
        <body>
          <li id="section-1" class="section">
            <h3 class="sectionname">תרגילים</h3>
            <ul class="section">
              <li class="activity modtype_assign" id="module-555">
                <span class="instancename">מטלה 1</span>
              </li>
              <li class="activity modtype_resource" id="module-666">
                <span class="instancename">סיכום הרצאה</span>
                <a href="/2025/pluginfile.php/123/mod_resource/content/1/lecture1.pdf">הורדה</a>
              </li>
            </ul>
          </li>
        </body>
      </html>
    `;

    const fetchedUrls: string[] = [];
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      const urlStr = String(url);
      fetchedUrls.push(urlStr);
      if (urlStr.includes('/2025/course/view.php?id=301')) {
        return { ok: true, status: 200, text: async () => mockCourseHtml };
      }
      if (urlStr.includes('/course/view.php?id=301')) {
        // Root returns 404 or error for past year course
        return { ok: false, status: 404, text: async () => 'Not found' };
      }
      return { ok: true, status: 200, text: async () => '<html><body></body></html>' };
    }) as any;

    try {
      const sections = await scraper.getCourseContents(301);
      expect(sections.length).toBe(1);
      expect(sections[0].name).toBe('תרגילים');
      expect(sections[0].modules.length).toBe(2);

      const assignMod = sections[0].modules.find((m: any) => m.modname === 'assign');
      expect(assignMod?.url).toBe('https://moodle.tau.ac.il/2025/mod/assign/view.php?id=555');

      const fileMod = sections[0].modules.find((m: any) => m.modname === 'resource');
      expect(fileMod?.contents?.[0].fileurl).toBe('https://moodle.tau.ac.il/2025/pluginfile.php/123/mod_resource/content/1/lecture1.pdf');

      // Verify it probed root first then resolved to /2025/
      expect(fetchedUrls).toContain('https://moodle.tau.ac.il/2025/course/view.php?id=301');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('TC-FALLBACK-10: should intercept SAML SSO auto-submit form and complete POST-Redirect-Get handshake', async () => {
    const { ScraperMoodleStrategy } = await import('../src/strategies/scraperStrategy.js');
    const scraper = new ScraperMoodleStrategy({
      token: '',
      baseUrl: 'https://moodle.tau.ac.il',
    });

    const mockSamlFormHtml = `
      <html>
        <body>
          <form method="post" action="https://moodle.tau.ac.il/2025/auth/saml2/sp/saml2-acs.php/moodle.tau.ac.il">
            <input type="hidden" name="SAMLResponse" value="PEFzc2VydGlvbj4uLi48L0Fzc2VydGlvbj4=" />
            <input type="hidden" name="RelayState" value="https://moodle.tau.ac.il/2025/my/" />
          </form>
        </body>
      </html>
    `;

    const mockSiteInfoHtml = `{"userid": "12345"}`;

    const fetchedUrls: string[] = [];
    const postedData: URLSearchParams[] = [];

    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const urlStr = String(url);
      fetchedUrls.push(urlStr);

      if (init?.method === 'POST') {
        postedData.push(init.body as URLSearchParams);
        // Simulate a successful ACS POST that sets cookie but we just return dummy html
        // Scraper will re-fetch the original URL
        return { ok: true, status: 200, text: async () => '<html>ACS Complete</html>' };
      }

      if (urlStr.includes('/my/')) {
        // First fetch gets SAML form, second gets real HTML
        if (fetchedUrls.filter(u => u.includes('/my/')).length === 1) {
          return { ok: true, status: 200, text: async () => mockSamlFormHtml };
        } else {
          return { ok: true, status: 200, text: async () => mockSiteInfoHtml };
        }
      }

      return { ok: true, status: 200, text: async () => '<html><body></body></html>' };
    }) as any;

    try {
      const siteInfo = await scraper.getSiteInfo();
      expect(siteInfo.userid).toBe(12345);

      // Verify the POST request was made to ACS
      expect(fetchedUrls).toContain('https://moodle.tau.ac.il/2025/auth/saml2/sp/saml2-acs.php/moodle.tau.ac.il');
      expect(postedData.length).toBe(1);
      
      const formData = postedData[0];
      expect(formData.get('SAMLResponse')).toBe('PEFzc2VydGlvbj4uLi48L0Fzc2VydGlvbj4=');
      expect(formData.get('RelayState')).toBe('https://moodle.tau.ac.il/2025/my/');
      
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('TC-FALLBACK-11: should throw AUTH_SESSION_EXPIRED when hitting a manual SSO login form', async () => {
    const { ScraperMoodleStrategy } = await import('../src/strategies/scraperStrategy.js');
    const { MoodleApiError } = await import('../src/moodleApi.js');
    const scraper = new ScraperMoodleStrategy({
      token: '',
      baseUrl: 'https://moodle.tau.ac.il',
    });

    const mockLoginFormHtml = `
      <html>
        <body>
          <input type="text" name="Ecom_User_ID" />
          <input type="password" name="Ecom_Password" />
        </body>
      </html>
    `;

    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockImplementation(async () => {
      return { ok: true, status: 200, text: async () => mockLoginFormHtml };
    }) as any;

    try {
      await expect(scraper.getSiteInfo()).rejects.toThrow(MoodleApiError);
      await expect(scraper.getSiteInfo()).rejects.toMatchObject({
        errorcode: 'AUTH_SESSION_EXPIRED',
        message: expect.stringContaining('Moodle SSO session expired'),
      });
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('TC-FALLBACK-12: should parse courses from data-course-id when course name is in child span elements', async () => {
    const { ScraperMoodleStrategy } = await import('../src/strategies/scraperStrategy.js');
    const scraper = new ScraperMoodleStrategy({
      token: '',
      baseUrl: 'https://moodle.tau.ac.il',
    });

    // Realistic Moodle 4.x dashboard HTML where data-course-id is on a container
    // and the course name is in nested child spans (NOT in aria-label/title on same tag)
    const mockDashboardHtml = `
      <!DOCTYPE html>
      <html>
        <body>
          <input type="hidden" name="sesskey" value="TEST123">
          <div id="block-myoverview" class="block_myoverview">
            <div class="course-summaryimage" data-course-id="321110001">
              <div class="card dashboard-card">
                <div class="card-body course-info-container">
                  <span class="coursename">
                    <span class="multiline">0321110001 - אלגברה לינארית לפיזיקה</span>
                  </span>
                </div>
              </div>
            </div>
            <div class="course-summaryimage" data-course-id="321111801">
              <div class="card dashboard-card">
                <div class="card-body course-info-container">
                  <span class="coursename">
                    <span class="multiline">0321111801 - פיזיקה קלאסית 1</span>
                  </span>
                </div>
              </div>
            </div>
            <li class="list-group-item course-listitem" data-course-id="368111801">
              <div class="course-info-container">
                <span class="coursename">0368111801 - מתמטיקה בדידה 1</span>
              </div>
            </li>
          </div>
        </body>
      </html>
    `;

    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      const urlStr = String(url);
      if (urlStr.includes('/my/courses.php')) {
        return { ok: true, status: 200, text: async () => mockDashboardHtml };
      }
      return { ok: true, status: 200, text: async () => '<html><body></body></html>' };
    }) as any;

    try {
      const courses = await scraper.getEnrolledCourses(30909);
      expect(courses.length).toBeGreaterThanOrEqual(3);

      const c1 = courses.find((c: RawMoodleCourse) => c.id === 321110001);
      expect(c1).toBeDefined();
      expect(c1?.fullname).toContain('אלגברה לינארית');

      const c2 = courses.find((c: RawMoodleCourse) => c.id === 321111801);
      expect(c2).toBeDefined();
      expect(c2?.fullname).toContain('פיזיקה קלאסית');

      const c3 = courses.find((c: RawMoodleCourse) => c.id === 368111801);
      expect(c3).toBeDefined();
      expect(c3?.fullname).toContain('מתמטיקה בדידה');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('TC-FALLBACK-13: should parse courses from grade/report/overview/index.php links', async () => {
    const { ScraperMoodleStrategy } = await import('../src/strategies/scraperStrategy.js');
    const scraper = new ScraperMoodleStrategy({
      token: '',
      baseUrl: 'https://moodle.tau.ac.il',
    });

    // Grade overview page with links to /grade/report/overview/index.php?id=X
    // (NOT /grade/report/user/index.php or /course/view.php)
    const mockGradeOverviewHtml = `
      <!DOCTYPE html>
      <html>
        <body>
          <input type="hidden" name="sesskey" value="TEST123">
          <table class="generaltable overview-grade">
            <thead><tr><th>קורס</th><th>ציון</th></tr></thead>
            <tbody>
              <tr>
                <td class="cell c0">
                  <a href="https://moodle.tau.ac.il/grade/report/overview/index.php?id=321110001">0321110001 - אלגברה לינארית לפיזיקה</a>
                </td>
                <td class="cell c1">85</td>
              </tr>
              <tr>
                <td class="cell c0">
                  <a href="/grade/report/overview/index.php?id=321111801&amp;userid=30909">0321111801 - פיזיקה קלאסית 1</a>
                </td>
                <td class="cell c1">92</td>
              </tr>
            </tbody>
          </table>
        </body>
      </html>
    `;

    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      const urlStr = String(url);
      if (urlStr.includes('/grade/report/overview/index.php')) {
        return { ok: true, status: 200, text: async () => mockGradeOverviewHtml };
      }
      return { ok: true, status: 200, text: async () => '<html><body></body></html>' };
    }) as any;

    try {
      const courses = await scraper.getEnrolledCourses(30909);
      expect(courses.length).toBeGreaterThanOrEqual(2);

      const c1 = courses.find((c: RawMoodleCourse) => c.id === 321110001);
      expect(c1).toBeDefined();
      expect(c1?.fullname).toContain('אלגברה לינארית');

      const c2 = courses.find((c: RawMoodleCourse) => c.id === 321111801);
      expect(c2).toBeDefined();
      expect(c2?.fullname).toContain('פיזיקה קלאסית');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('TC-FALLBACK-14: should parse courses when aria-label precedes data-course-id on same element', async () => {
    const { ScraperMoodleStrategy } = await import('../src/strategies/scraperStrategy.js');
    const scraper = new ScraperMoodleStrategy({
      token: '',
      baseUrl: 'https://moodle.tau.ac.il',
    });

    const mockReversedAttrHtml = `
      <!DOCTYPE html>
      <html>
        <body>
          <input type="hidden" name="sesskey" value="TEST123">
          <div class="card dashboard-card" aria-label="0321110001 - אלגברה לינארית לפיזיקה" data-course-id="321110001" role="listitem">
            <a href="/course/view.php?id=321110001">View</a>
          </div>
          <div class="card dashboard-card" title="0321111801 - פיזיקה קלאסית 1" data-course-id="321111801" role="listitem">
            <a href="/course/view.php?id=321111801">View</a>
          </div>
        </body>
      </html>
    `;

    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      const urlStr = String(url);
      if (urlStr.includes('/my/courses.php')) {
        return { ok: true, status: 200, text: async () => mockReversedAttrHtml };
      }
      return { ok: true, status: 200, text: async () => '<html><body></body></html>' };
    }) as any;

    try {
      const courses = await scraper.getEnrolledCourses(30909);
      expect(courses.length).toBeGreaterThanOrEqual(2);

      const c1 = courses.find((c: RawMoodleCourse) => c.id === 321110001);
      expect(c1).toBeDefined();
      expect(c1?.fullname).toContain('אלגברה לינארית');

      const c2 = courses.find((c: RawMoodleCourse) => c.id === 321111801);
      expect(c2).toBeDefined();
      expect(c2?.fullname).toContain('פיזיקה קלאסית');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('TC-FALLBACK-15: should discover courses from year-specific grade overview pages with no /course/view.php links', async () => {
    const { ScraperMoodleStrategy } = await import('../src/strategies/scraperStrategy.js');
    const scraper = new ScraperMoodleStrategy({
      token: '',
      baseUrl: 'https://moodle.tau.ac.il',
      devMode: true,
    });

    // Mimics the real user scenario: all HTML pages have gradeReport=true,
    // dataCourseId=true, but courseViewLink=false
    const mockRootGradeOverview = `
      <!DOCTYPE html>
      <html>
        <body>
          <input type="hidden" name="sesskey" value="ROOT_SESSKEY">
          <table class="generaltable">
            <tr>
              <td><a href="/grade/report/overview/index.php?id=321110001">0321110001 - אלגברה לינארית לפיזיקה</a></td>
              <td>85</td>
            </tr>
          </table>
          <div data-course-id="321111801">
            <span class="coursename"><span class="multiline">0321111801 - פיזיקה קלאסית 1</span></span>
          </div>
        </body>
      </html>
    `;

    const mock2025GradeOverview = `
      <!DOCTYPE html>
      <html>
        <body>
          <input type="hidden" name="sesskey" value="Y2025_SESSKEY">
          <table class="generaltable">
            <tr>
              <td><a href="/2025/grade/report/overview/index.php?id=368111801">0368111801 - מתמטיקה בדידה 1</a></td>
              <td>78</td>
            </tr>
          </table>
        </body>
      </html>
    `;

    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockImplementation(async (url: string, init?: any) => {
      const urlStr = String(url);
      // Block AJAX calls to avoid testing them here
      if (init?.method === 'POST') {
        return { ok: true, status: 200, json: async () => [{ error: false, data: { courses: [] } }] };
      }
      if (urlStr.includes('/grade/report/overview') && !urlStr.includes('/2025/') && !urlStr.includes('/2024/')) {
        return { ok: true, status: 200, text: async () => mockRootGradeOverview };
      }
      if (urlStr.includes('/2025/grade/report/overview')) {
        return { ok: true, status: 200, text: async () => mock2025GradeOverview };
      }
      if (urlStr.includes('/2024/grade/report/overview')) {
        return { ok: false, status: 404, text: async () => 'Not found' };
      }
      return { ok: true, status: 200, text: async () => '<html><body></body></html>' };
    }) as any;

    try {
      const courses = await scraper.getEnrolledCourses(30909);
      expect(courses.length).toBeGreaterThanOrEqual(3);

      const c1 = courses.find((c: RawMoodleCourse) => c.id === 321110001);
      expect(c1).toBeDefined();
      expect(c1?.fullname).toContain('אלגברה לינארית');

      const c2 = courses.find((c: RawMoodleCourse) => c.id === 321111801);
      expect(c2).toBeDefined();
      expect(c2?.fullname).toContain('פיזיקה קלאסית');

      const c3 = courses.find((c: RawMoodleCourse) => c.id === 368111801);
      expect(c3).toBeDefined();
      expect(c3?.fullname).toContain('מתמטיקה בדידה');
      expect(c3?.year).toBe('2025');
      expect(c3?.instanceUrl).toBe('https://moodle.tau.ac.il/2025');
    } finally {
      global.fetch = originalFetch;
    }
  });
});

