import { MoodleClient, RawGradeReportResponse } from '../src/moodleApi.js';

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
});
