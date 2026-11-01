import { RestMoodleStrategy } from '../src/strategies/restStrategy.js';
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
});
