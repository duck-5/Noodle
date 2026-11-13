import { runSync } from '../src/syncEngine.js';

describe('Gradebook Fidelity & Heuristics (Phase 4)', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('TC-SYNC-010: should auto-suppress late-submission box when regular assignment is submitted and detect bonus assignments', async () => {
    fetchMock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const urlStr = url.toString();
      const body = init?.body?.toString() || '';

      if (body.includes('wsfunction=core_webservice_get_site_info') || urlStr.includes('wsfunction=core_webservice_get_site_info')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ userid: 12345, fullname: 'Student Israel' }),
        };
      }

      if (body.includes('wsfunction=core_enrol_get_users_courses') || urlStr.includes('wsfunction=core_enrol_get_users_courses')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              id: 101,
              shortname: '0368-2161-01 - מבנה נתונים',
              fullname: 'מבנה נתונים',
              idnumber: '0368216101',
            },
          ],
        };
      }

      if (body.includes('wsfunction=mod_assign_get_assignments') || urlStr.includes('wsfunction=mod_assign_get_assignments')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            courses: [
              {
                id: 101,
                assignments: [
                  {
                    id: 1,
                    cmid: 1001,
                    name: 'מטלה 1 - עצי חיפוש',
                    intro: 'הגישו עצי חיפוש',
                    duedate: 1762000000,
                    cutoffdate: 1762086400,
                  },
                  {
                    id: 2,
                    cmid: 1002,
                    name: 'מטלה 1 - הגשה באיחור',
                    intro: 'תיבה למאחרים בלבד',
                    duedate: 1762172800,
                    cutoffdate: 1762259200,
                  },
                  {
                    id: 3,
                    cmid: 1003,
                    name: 'שאלת בונוס אלגוריתמית',
                    intro: 'שאלה רשות',
                    duedate: 1762300000,
                  },
                  {
                    id: 4,
                    cmid: 1004,
                    name: 'מטלה 2 - גרפים',
                    intro: 'גרפים',
                    duedate: 1762500000,
                  },
                  {
                    id: 5,
                    cmid: 1005,
                    name: 'מטלה 2 - תיבת הגשה באיחור',
                    intro: 'תיבת הגשה באיחור למטלה 2',
                    duedate: 1762600000,
                  },
                  {
                    id: 6,
                    cmid: 1006,
                    name: 'מטלה 10 - סיבוכיות',
                    intro: 'מטלה 10',
                    duedate: 1762700000,
                  },
                  {
                    id: 7,
                    cmid: 1007,
                    name: 'תיבת הגשה באיחור',
                    intro: 'תיבה כללית ללא שם מטלה',
                    duedate: 1762800000,
                  },
                ],
              },
            ],
          }),
        };
      }

      if (body.includes('wsfunction=mod_quiz_get_quizzes_by_courses')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            quizzes: [
              {
                id: 20,
                course: 101,
                coursemodule: 2020,
                name: 'בוחן 1 - שאלת בונוס',
                timelimit: 1800,
                attempts: 1,
                timeopen: 1760000000,
                timeclose: 1762000000,
              },
            ],
          }),
        };
      }

      if (body.includes('wsfunction=gradereport_user_get_grade_items')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            usergrades: [
              {
                courseid: 101,
                gradeitems: [
                  {
                    id: 999,
                    itemname: 'Course total',
                    itemtype: 'course',
                    itemmodule: '',
                    cmid: null,
                    graderaw: 92.5,
                    grademax: 100,
                    gradeformatted: '92.50',
                    gradeishidden: false,
                  },
                  {
                    id: 1001,
                    itemname: 'מטלה 1 - עצי חיפוש',
                    itemtype: 'mod',
                    itemmodule: 'assign',
                    cmid: 1001,
                    graderaw: 98,
                    grademax: 100,
                    gradeformatted: '98.00',
                    gradeishidden: false,
                    feedback: '<p>כל הכבוד, עבודה מצוינת!</p>',
                  },
                  {
                    id: 1003,
                    itemname: 'שאלת בונוס אלגוריתמית',
                    itemtype: 'mod',
                    itemmodule: 'assign',
                    cmid: 1003,
                    graderaw: 5,
                    grademax: 5,
                    gradeformatted: '5.00',
                    gradeishidden: false,
                  },
                  {
                    id: 2020,
                    itemname: 'בוחן 1 - שאלת בונוס',
                    itemtype: 'mod',
                    itemmodule: 'quiz',
                    cmid: 2020,
                    graderaw: 10,
                    grademax: 10,
                    gradeformatted: '10.00',
                    gradeishidden: false,
                    feedback: 'מעולה!',
                  },
                ],
              },
            ],
          }),
        };
      }

      if (body.includes('wsfunction=mod_assign_get_submission_status')) {
        // Assign 1 is Submitted
        if (body.includes('assignid=1')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              lastattempt: {
                submission: {
                  status: 'submitted',
                },
              },
            }),
          };
        }
        // Assign 4 (מטלה 2) is NOT submitted (status: new)
        return {
          ok: true,
          status: 200,
          json: async () => ({
            lastattempt: {
              submission: {
                status: 'new',
              },
            },
          }),
        };
      }

      if (body.includes('wsfunction=core_course_get_contents')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              id: 10,
              name: 'מבוא',
              section: 0,
              summary: '<p>ברוכים הבאים לקורס</p>',
              visible: 1,
              modules: [
                {
                  id: 201,
                  name: 'לוח מודעות והודעות הקורס',
                  modname: 'forum',
                },
                {
                  id: 202,
                  name: 'חומרי עזר ומבחנים קודמים',
                  modname: 'folder',
                  contents: [
                    {
                      type: 'file',
                      filename: 'exam2024.pdf',
                      filepath: '/exams/',
                      fileurl: 'https://moodle.tau.ac.il/pluginfile.php/1/exam.pdf',
                      filesize: 102400,
                      timemodified: 1720000000,
                    },
                  ],
                },
                {
                  id: 203,
                  name: 'ספר הקורס ב-GitHub',
                  modname: 'url',
                  url: 'https://github.com/tau-cs/data-structures',
                },
              ],
            },
          ],
        };
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({}),
      };
    });

    const result = await runSync(
      'mock_token',
      [101],
      () => {},
      'https://moodle.tau.ac.il',
      undefined,
      undefined,
      undefined,
      undefined,
      { enableScraping: false }
    );

    // 1. Verify late submission box auto-suppression
    const lateAssign1 = result.assignments.find((a) => a.id === 2);
    expect(lateAssign1).toBeDefined();
    expect(lateAssign1?.isLateSubmissionBox).toBe(true);
    // Because regular assign 1 was submitted, late box must be hidden and marked submitted
    expect(lateAssign1?.isHidden).toBe(true);
    expect(lateAssign1?.status).toBe('Submitted');

    // Late box for מטלה 2 should NOT be hidden because מטלה 2 was NOT submitted
    const lateAssign2 = result.assignments.find((a) => a.id === 5);
    expect(lateAssign2).toBeDefined();
    expect(lateAssign2?.isLateSubmissionBox).toBe(true);
    expect(lateAssign2?.isHidden).toBeUndefined();

    // CR-06: Generic late box without assignment title must NOT be auto-suppressed
    const lateAssignGeneric = result.assignments.find((a) => a.id === 7);
    expect(lateAssignGeneric).toBeDefined();
    expect(lateAssignGeneric?.isLateSubmissionBox).toBe(true);
    expect(lateAssignGeneric?.isHidden).toBeUndefined();

    // CR-06: Word-boundary: מטלה 10 must not be confused with מטלה 1
    const assign10 = result.assignments.find((a) => a.id === 6);
    expect(assign10).toBeDefined();
    expect(assign10?.isHidden).toBeUndefined();

    // 2. Verify Bonus Heuristic & Quiz Feedback (CR-12)
    const bonusAssign = result.assignments.find((a) => a.id === 3);
    expect(bonusAssign).toBeDefined();
    expect(bonusAssign?.isBonus).toBe(true);

    const bonusQuiz = result.assignments.find((a) => a.id === 20);
    expect(bonusQuiz).toBeDefined();
    expect(bonusQuiz?.isBonus).toBe(true);
    expect(bonusQuiz?.feedback).toBe('מעולה!');

    // 3. Verify Feedback Extraction
    const assign1 = result.assignments.find((a) => a.id === 1);
    expect(assign1?.feedback).toContain('כל הכבוד, עבודה מצוינת!');

    // 4. Verify Grade Summaries & Course Total
    expect(result.gradeSummaries).toBeDefined();
    const courseGrade = result.gradeSummaries![101];
    expect(courseGrade).toBeDefined();
    expect(courseGrade.hasCourseTotal).toBe(true);
    expect(courseGrade.courseTotalFormatted).toBe('92.50');
    expect(courseGrade.courseTotalRaw).toBe(92.5);
    expect(courseGrade.items).toHaveLength(4);

    // 5. Verify Announcements extraction
    expect(result.announcements).toBeDefined();
    expect(result.announcements).toHaveLength(1);
    expect(result.announcements![0].name).toContain('לוח מודעות והודעות הקורס');

    // 6. Verify Folder & Link extraction
    expect(result.folders).toBeDefined();
    expect(result.folders).toHaveLength(1);
    expect(result.folders![0].name).toContain('חומרי עזר ומבחנים קודמים');
    expect(result.folders![0].files).toHaveLength(1);
    expect(result.folders![0].files[0].fileName).toBe('exam2024.pdf');

    expect(result.links).toBeDefined();
    expect(result.links).toHaveLength(1);
    expect(result.links![0].linkKind).toBe('github');
  });
});
