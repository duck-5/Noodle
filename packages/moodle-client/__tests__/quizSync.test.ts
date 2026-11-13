import { RestMoodleStrategy } from '../src/strategies/restStrategy.js';
import { runSync } from '../src/syncEngine.js';
import { RawMoodleQuiz, RawMoodleQuizAttempt } from '../src/moodleApi.js';

describe('Quizzes & בחנים (mod_quiz) Strategy & Sync', () => {
  let strategy: RestMoodleStrategy;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    strategy = new RestMoodleStrategy({
      baseUrl: 'https://moodle.tau.ac.il',
      token: 'test_token_123',
    });
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('should call mod_quiz_get_quizzes_by_courses and return quizzes list', async () => {
    const mockQuizzes: RawMoodleQuiz[] = [
      {
        id: 501,
        course: 101,
        coursemodule: 9001,
        name: 'Lecture 1 Quiz - Introduction',
        timeopen: 1761984000,
        timeclose: 1763193600,
        timelimit: 1800, // 30 mins
        attempts: 2,
        sumgrades: 100,
      },
      {
        id: 502,
        course: 101,
        coursemodule: 9002,
        name: 'Quick-check quiz 2',
        timeopen: 1761984000,
        timeclose: 0, // no close date
        timelimit: 0,
        attempts: 0,
      },
    ];

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        quizzes: mockQuizzes,
      }),
    });

    const quizzes = await strategy.getQuizzes([101]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const callArgs = fetchMock.mock.calls[0];
    expect(callArgs[0]).toContain('https://moodle.tau.ac.il/webservice/rest/server.php');
    
    // Check form body params
    const bodyStr = callArgs[1].body?.toString() || '';
    expect(bodyStr).toContain('wsfunction=mod_quiz_get_quizzes_by_courses');
    expect(bodyStr).toContain('courseids%5B0%5D=101');
    expect(bodyStr).toContain('wstoken=test_token_123');

    expect(quizzes).toHaveLength(2);
    expect(quizzes[0].id).toBe(501);
    expect(quizzes[0].timelimit).toBe(1800);
    expect(quizzes[1].name).toBe('Quick-check quiz 2');
  });

  it('should call mod_quiz_get_user_attempts and return attempt status', async () => {
    const mockAttempts: RawMoodleQuizAttempt[] = [
      {
        id: 1001,
        quiz: 501,
        userid: 42,
        attempt: 1,
        state: 'finished',
        timestart: 1762000000,
        timefinish: 1762001200,
        timemodified: 1762001200,
        sumgrades: 95,
      },
    ];

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        attempts: mockAttempts,
      }),
    });

    const attempts = await strategy.getQuizAttempts(501);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const bodyStr = fetchMock.mock.calls[0][1].body?.toString() || '';
    expect(bodyStr).toContain('wsfunction=mod_quiz_get_user_attempts');
    expect(bodyStr).toContain('quizid=501');
    expect(bodyStr).toContain('status=all');

    expect(attempts).toHaveLength(1);
    expect(attempts[0].state).toBe('finished');
    expect(attempts[0].sumgrades).toBe(95);
  });

  it('should call core_completion_update_activity_completion_status_manually for two-way "Mark as done"', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        status: true,
      }),
    });

    const success = await strategy.updateActivityCompletionManually(9001, true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const bodyStr = fetchMock.mock.calls[0][1].body?.toString() || '';
    expect(bodyStr).toContain('wsfunction=core_completion_update_activity_completion_status_manually');
    expect(bodyStr).toContain('cmid=9001');
    expect(bodyStr).toContain('completed=1');

    expect(success).toBe(true);
  });

  it('should unmark completion status with completed=0', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        status: true,
      }),
    });

    const success = await strategy.updateActivityCompletionManually(9001, false);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const bodyStr = fetchMock.mock.calls[0][1].body?.toString() || '';
    expect(bodyStr).toContain('completed=0');
    expect(success).toBe(true);
  });

  it('marks quiz as Submitted and completed when grade exists in gradebook or automatic completion is done', async () => {
    // Mock getSiteInfo, enrolled courses, course contents, quizzes, grade items, etc.
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const body = init?.body?.toString() || '';
      if (body.includes('core_webservice_get_site_info')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ userid: 1234, username: 'testuser', fullname: 'Test User' }),
        };
      }
      if (body.includes('core_enrol_get_users_courses')) {
        return {
          ok: true,
          status: 200,
          json: async () => ([
            { id: 301, fullname: 'תוכנה 1 - מבוא להנדסת תוכנה', shortname: '0368215701' },
          ]),
        };
      }
      if (body.includes('core_course_get_contents')) {
        return {
          ok: true,
          status: 200,
          json: async () => ([
            {
              id: 1,
              name: 'שבוע 2',
              modules: [
                {
                  id: 1901,
                  instance: 901,
                  name: 'Lecture 2 Quiz',
                  modname: 'quiz',
                  completion: 2, // Automatic completion!
                  completiondata: { state: 1 }, // State 1: completed!
                },
              ],
            },
          ]),
        };
      }
      if (body.includes('mod_quiz_get_quizzes_by_courses')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            quizzes: [
              {
                id: 901,
                course: 301,
                coursemodule: 1901,
                name: 'Lecture 2 Quiz',
                timeopen: 1761984000,
                timeclose: 1762070400, // Closed in the past!
                timelimit: 0,
                attempts: 0,
                completion: 2,
                completiondata: { state: 1 },
              },
            ],
          }),
        };
      }
      if (body.includes('mod_quiz_get_user_attempts')) {
        // Attempts endpoint fails or returns empty because review is restricted
        return {
          ok: true,
          status: 200,
          json: async () => ({ attempts: [] }),
        };
      }
      if (body.includes('gradereport_user_get_grade_items')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            usergrades: [
              {
                courseid: 301,
                gradeitems: [
                  {
                    id: 888,
                    itemtype: 'mod',
                    itemmodule: 'quiz',
                    iteminstance: 901,
                    cmid: 1901,
                    graderaw: 100,
                    grademax: 100,
                    gradeishidden: false,
                  },
                ],
              },
            ],
          }),
        };
      }
      if (body.includes('mod_assign_get_assignments')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ courses: [{ id: 301, assignments: [] }] }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    const result = await runSync('test_token', [301], () => {});
    expect(result.assignments).toHaveLength(1);
    const quiz = result.assignments[0];
    expect(quiz.name).toBe('Lecture 2 Quiz');
    expect(quiz.grade).toBe(100);
    // Even though timeclose was in the past and attempts endpoint returned [],
    // the presence of grade / automatic completion ensures it is marked Submitted and isCompleted: true!
    expect(quiz.status).toBe('Submitted');
    expect(quiz.isCompleted).toBe(true);
    expect(quiz.isManualCompletionDone).toBe(true);
  });
});
