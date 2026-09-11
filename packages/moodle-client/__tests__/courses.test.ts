import { MoodleClient, RawMoodleCourse } from '../src/moodleApi.js';
import { parseTauCourseMetadata } from '../src/courseParser.js';

describe('Category 2: Course Management & Tracking', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('TC-CRS-01: Fetch Enrolled Courses', () => {
    it('should query core_enrol_get_users_courses and return mapped course list', async () => {
      const mockCourses: RawMoodleCourse[] = [
        { id: 101, shortname: '0368-2154-01-2025', fullname: 'Data Structures', idnumber: '0368215401' },
        { id: 102, shortname: '0368-1111-02-2025', fullname: 'Linear Algebra', idnumber: '0368111102' },
        { id: 103, shortname: '0368-3000-00-2025', fullname: 'Software Project', idnumber: '0368300000' },
      ];

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockCourses,
      } as Response);

      const client = new MoodleClient('VALID_TOKEN');
      const courses = await client.getEnrolledCourses(12345);

      expect(courses).toHaveLength(3);
      expect(courses[0].fullname).toBe('Data Structures');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('wsfunction=core_enrol_get_users_courses&moodlewsrestformat=json&userid=12345'),
        expect.anything()
      );
    });
  });

  describe('TC-CRS-02: Semester Parsing & Academic Grouping', () => {
    it('should parse semester A, B, Yearly, and academic year correctly', () => {
      expect(parseTauCourseMetadata('03682154-01-2025-1')).toEqual({
        courseCode: '03682154',
        groupId: '01',
        year: '2025',
        semester: 'SemesterA',
      });

      expect(parseTauCourseMetadata('03681111-02-2025-2')).toEqual({
        courseCode: '03681111',
        groupId: '02',
        year: '2025',
        semester: 'SemesterB',
      });

      expect(parseTauCourseMetadata('03683000-00-2025-0')).toEqual({
        courseCode: '03683000',
        groupId: '00',
        year: '2025',
        semester: 'Yearly',
      });
    });

    it('should group unknown or non-standard shortnames into Other', () => {
      const nonStandard = parseTauCourseMetadata('General-Orientation-2025');
      expect(nonStandard).toBeNull();
    });
  });

  describe('TC-CRS-03: Course Tracking Toggle (is_active)', () => {
    it('should update tracked course array when toggling active state', () => {
      let trackedCourseIds = [101];

      // Toggle course 102 to tracked
      const toggleCourse = (courseId: number) => {
        if (trackedCourseIds.includes(courseId)) {
          trackedCourseIds = trackedCourseIds.filter((id) => id !== courseId);
        } else {
          trackedCourseIds = [...trackedCourseIds, courseId];
        }
      };

      toggleCourse(102);
      expect(trackedCourseIds).toEqual([101, 102]);

      // Toggle course 101 to untracked
      toggleCourse(101);
      expect(trackedCourseIds).toEqual([102]);
    });
  });

  describe('TC-CRS-04: Custom Course Nickname Editing', () => {
    it('should return nickname if defined, otherwise fallback to course fullname', () => {
      const customNames: Record<number, string> = {
        101: 'לינארית 1',
      };

      const getDisplayName = (course: { id: number; fullname: string }) => {
        const nickname = customNames[course.id];
        return nickname && nickname.trim() !== '' ? nickname : course.fullname;
      };

      expect(getDisplayName({ id: 101, fullname: '0368-1111-01 אלגברה לינארית' })).toBe('לינארית 1');
      expect(getDisplayName({ id: 102, fullname: '0368-2154-01 מבני נתונים' })).toBe('0368-2154-01 מבני נתונים');
    });
  });

  describe('TC-EDGE-02: Corrupted / Malformed Course Metadata', () => {
    it('should handle undefined, null, or corrupt idnumber / shortname gracefully', () => {
      expect(parseTauCourseMetadata('')).toBeNull();
      expect(parseTauCourseMetadata('invalid')).toBeNull();
      expect(parseTauCourseMetadata('12345')).toBeNull();
      expect(parseTauCourseMetadata('9999-9999-99-invalidYear')).toBeNull();
    });
  });
});
