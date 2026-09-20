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
});
