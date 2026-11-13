import { MoodleClient, RawGradeReportResponse } from '../src/moodleApi.js';
import { calculateGradesSummary } from '../src/gradesCalculation.js';
import { Assignment } from '../src/types.js';

describe('Category 7 & 4: Grades, Progress & Course Statistics', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('TC-GRD-01: Grade Items Query & Parsing', () => {
    it('should query gradereport_user_get_grade_items and parse grade items', async () => {
      const mockGradeReport: RawGradeReportResponse = {
        usergrades: [
          {
            courseid: 101,
            userid: 12345,
            gradeitems: [
              {
                itemtype: 'mod',
                itemmodule: 'assign',
                cmid: 10,
                gradeformatted: '95.00',
                graderaw: 95,
                grademax: 100,
                gradeishidden: false,
              },
              {
                itemtype: 'mod',
                itemmodule: 'assign',
                cmid: 20,
                gradeformatted: '-',
                graderaw: null,
                grademax: 100,
                gradeishidden: false,
              },
              {
                itemtype: 'course',
                itemmodule: '',
                cmid: null,
                gradeformatted: '95.00',
                graderaw: 95,
                grademax: 100,
                gradeishidden: false,
              },
            ],
          },
        ],
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockGradeReport,
      } as Response);

      const client = new MoodleClient('VALID_TOKEN');
      const response = await client.getGradeItems(101, 12345);

      expect(response.usergrades).toHaveLength(1);
      const items = response.usergrades[0].gradeitems;
      const gradedItems = items.filter((i) => i.graderaw !== null && i.itemtype === 'mod');
      expect(gradedItems).toHaveLength(1);
      expect(gradedItems[0].graderaw).toBe(95);
      expect(gradedItems[0].grademax).toBe(100);
    });
  });

  describe('TC-GRD-02: Graded Assignment Item Breakdown', () => {
    it('should compute score percentage and ratio display', () => {
      const formatItem = (graderaw: number, grademax: number) => {
        const percentage = Math.round((graderaw / grademax) * 100);
        return {
          ratio: `${graderaw} / ${grademax}`,
          percentage: `${percentage}%`,
        };
      };

      const result = formatItem(85, 100);
      expect(result.ratio).toBe('85 / 100');
      expect(result.percentage).toBe('85%');

      const scaled = formatItem(18, 20);
      expect(scaled.ratio).toBe('18 / 20');
      expect(scaled.percentage).toBe('90%');
    });
  });

  describe('TC-GRD-03: Course Average & Overall GPA Calculation', () => {
    it('should calculate unweighted average per course and overall GPA across courses', () => {
      // Course A: 90/100 (90%) and 100/100 (100%) -> Average: 95.0
      const courseAGrades = [90, 100];
      const courseAAvg = courseAGrades.reduce((a, b) => a + b, 0) / courseAGrades.length;
      expect(courseAAvg).toBe(95.0);

      // Course B: 80/100 (80%) -> Average: 80.0
      const courseBGrades = [80];
      const courseBAvg = courseBGrades.reduce((a, b) => a + b, 0) / courseBGrades.length;
      expect(courseBAvg).toBe(80.0);

      // Overall Average = (95.0 + 80.0) / 2 = 87.5
      const overallAvg = (courseAAvg + courseBAvg) / 2;
      expect(overallAvg).toBe(87.5);
    });
  });

  describe('TC-DET-03: Course Statistics Summary Banner', () => {
    it('should calculate average grade, submitted count, and pending count for a course', () => {
      const courseAssignments = [
        { status: 'Submitted', grade: 80 },
        { status: 'Submitted', grade: 100 },
        { status: 'Submitted', grade: null }, // unrated submitted
        { status: 'Not submitted', grade: null }, // pending
      ];

      const submitted = courseAssignments.filter((a) => a.status === 'Submitted');
      const pending = courseAssignments.filter((a) => a.status !== 'Submitted');
      const graded = submitted.filter((a) => a.grade !== null);

      const avgGrade = graded.reduce((sum, a) => sum + (a.grade || 0), 0) / graded.length;

      expect(avgGrade).toBe(90.0);
      expect(submitted).toHaveLength(3);
      expect(pending).toHaveLength(1);
    });
  });

  describe('TC-GRD-04: Pedagogical Policy Filtering (Hidden, Locally Checked-Done, Pending Tasks)', () => {
    const fixedNow = new Date('2026-11-10T12:00:00Z');
    const createMockAssignment = (partial: Partial<Assignment> & { id: number; courseId: number; name: string }): Assignment => ({
      cmid: partial.id * 10,
      courseName: 'CS 101',
      status: 'Assigned',
      deadline: null,
      opened: null,
      link: `https://moodle.tau.ac.il/mod/assign/view.php?id=${partial.id * 10}`,
      grade: null,
      gradeMax: 100,
      ...partial,
    });

    it('should exclude hidden assignments, unsubmitted locally checked tasks, and future pending tasks', () => {
      const mockAssignments: Assignment[] = [
        createMockAssignment({
          id: 1,
          courseId: 101,
          courseName: 'CS 101',
          name: 'Graded Homework 1',
          grade: 90,
          gradeMax: 100,
          status: 'Submitted',
        }),
        createMockAssignment({
          id: 2,
          courseId: 101,
          courseName: 'CS 101',
          name: 'Hidden Homework 2',
          isHidden: true,
          grade: null,
          status: 'Not submitted',
          deadline: '2026-11-01T12:00:00Z', // past deadline, but hidden!
        }),
        createMockAssignment({
          id: 3,
          courseId: 101,
          courseName: 'CS 101',
          name: 'Locally Done But Unsubmitted HW 3',
          grade: null,
          status: 'Not submitted',
          deadline: '2026-11-05T12:00:00Z',
          // Marked as done locally without Moodle submission
        }),
        createMockAssignment({
          id: 4,
          courseId: 101,
          courseName: 'CS 101',
          name: 'Future Pending Assignment 4',
          grade: null,
          status: 'Not submitted',
          deadline: '2026-11-20T12:00:00Z', // future deadline
        }),
        createMockAssignment({
          id: 5,
          courseId: 101,
          courseName: 'CS 101',
          name: 'Submitted Awaiting Grade HW 5',
          grade: null,
          status: 'Submitted',
          deadline: '2026-11-08T12:00:00Z', // past deadline, submitted, not graded yet
        }),
      ];

      const result = calculateGradesSummary({
        assignments: mockAssignments,
        hiddenIdentifiers: [],
        completedIdentifiers: [3], // HW 3 is checked locally
        uncompletedIdentifiers: [],
        now: fixedNow,
      });

      // Only HW 1 (graded 90/100) should be included!
      expect(result.totalCalculatedItems).toBe(1);
      expect(result.calculatedItems[0].id).toBe(1);
      expect(result.overallGpa).toBe('90.00');
      expect(result.courseGroups[101].average).toBe('90.00');
    });
  });

  describe('TC-GRD-05: Exclusion of Ungraded Overdue & Pending Tasks (Only Published Grades Included)', () => {
    const fixedNow = new Date('2026-11-10T12:00:00Z');
    const createMockAssignment = (partial: Partial<Assignment> & { id: number; courseId: number; name: string }): Assignment => ({
      cmid: partial.id * 10,
      courseName: 'CS 101',
      status: 'Assigned',
      deadline: null,
      opened: null,
      link: `https://moodle.tau.ac.il/mod/assign/view.php?id=${partial.id * 10}`,
      grade: null,
      gradeMax: 100,
      ...partial,
    });

    it('should NOT default overdue tasks to zero and only include tasks with published grades', () => {
      const mockAssignments: Assignment[] = [
        createMockAssignment({
          id: 1,
          courseId: 101,
          courseName: 'CS 101',
          name: 'Graded HW 1',
          grade: 100,
          gradeMax: 100,
          status: 'Submitted',
        }),
        createMockAssignment({
          id: 2,
          courseId: 101,
          courseName: 'CS 101',
          name: 'Overdue HW 2 (No Grade)',
          grade: null,
          gradeMax: 100,
          status: 'Not submitted',
          deadline: '2026-11-05T12:00:00Z', // Overdue relative to fixedNow, but ungraded -> excluded!
        }),
        createMockAssignment({
          id: 3,
          courseId: 101,
          courseName: 'CS 101',
          name: 'Official Zero in Moodle HW 3',
          grade: 0,
          gradeMax: 100,
          status: 'Submitted',
          deadline: '2026-11-04T12:00:00Z', // Officially graded 0 in Moodle -> included!
        }),
      ];

      const result = calculateGradesSummary({
        assignments: mockAssignments,
        now: fixedNow,
      });

      // Overdue HW 2 is excluded; Graded HW 1 (100) and Official Zero HW 3 (0) are included
      expect(result.totalCalculatedItems).toBe(2);
      expect(result.calculatedItems.map((i) => i.id)).toEqual([1, 3]);

      // Course average: (100% + 0%) / 2 = 50.00%
      expect(result.courseGroups[101].average).toBe('50.00');
      expect(result.overallGpa).toBe('50.00');
    });
  });

  describe('TC-GRD-06: Administrative / Safety Course Exclusion & Bonus Activity Handling', () => {
    const createMockAssignment = (partial: Partial<Assignment> & { id: number; courseId: number; name: string }): Assignment => ({
      cmid: partial.id * 10,
      courseName: 'General Course',
      status: 'Assigned',
      deadline: null,
      opened: null,
      link: `https://moodle.tau.ac.il/mod/assign/view.php?id=${partial.id * 10}`,
      grade: null,
      gradeMax: 100,
      ...partial,
    });

    it('should exclude administrative safety course prefixes and handle bonus items gracefully', () => {
      const mockAssignments: Assignment[] = [
        createMockAssignment({
          id: 10,
          courseId: 58001001,
          courseName: '58001001 - Safety in Laboratories',
          name: 'Lab Safety Quiz',
          grade: 100,
          gradeMax: 100,
          status: 'Submitted',
        }),
        createMockAssignment({
          id: 20,
          courseId: 202,
          courseName: 'Math 202',
          name: 'Midterm Exam',
          grade: 80,
          gradeMax: 100,
          status: 'Submitted',
        }),
        createMockAssignment({
          id: 21,
          courseId: 202,
          courseName: 'Math 202',
          name: 'Bonus Riddle',
          grade: 10,
          gradeMax: 10,
          isBonus: true,
          status: 'Submitted',
        }),
      ];

      const result = calculateGradesSummary({
        assignments: mockAssignments,
      });

      // Course 58001001 is excluded entirely
      expect(result.courseGroups[58001001]).toBeUndefined();

      // Course 202 should have 2 items listed (Midterm and Bonus), but count = 1 for average
      expect(result.courseGroups[202]).toBeDefined();
      expect(result.courseGroups[202].list).toHaveLength(2);
      expect(result.courseGroups[202].count).toBe(1);
      expect(result.courseGroups[202].average).toBe('80.00');
      expect(result.overallGpa).toBe('80.00');
    });
  });
});
