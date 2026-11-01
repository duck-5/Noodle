import {
  isAdministrativeCourse,
  cleanCourseDisplayName,
  groupEnrolledCourses,
  aggregateUnifiedCourseItems,
} from '../src/courseGrouping.js';
import { MoodleCourse, SyncResult } from '../src/types.js';

describe('Mode A & Mode B Course Grouping', () => {
  const mockCourses: MoodleCourse[] = [
    // Academic Parent Portal (Picture 2 top)
    {
      id: 101,
      courseId: '01022312',
      shortname: '01022312',
      fullname: '01022312 - ביוסטטיסטיקה מתקדמת',
      semester: 'SemesterA',
      year: '2026',
    },
    // Academic Sub-Course / Recitation (Picture 2 bottom)
    {
      id: 102,
      courseId: '0102231201',
      shortname: '0102231201',
      fullname: '0102231201 - ביוסטטיסטיקה מתקדמת',
      semester: 'SemesterA',
      year: '2026',
    },
    // Independent Academic Course
    {
      id: 201,
      courseId: '0368111801',
      shortname: '0368111801',
      fullname: '03681118 - מבני נתונים',
      semester: 'SemesterA',
      year: '2026',
    },
    // Administrative / Safety Tutorials (Mode B - 5900* series)
    {
      id: 901,
      courseId: '59004350',
      shortname: '59004350-01-2026-0',
      fullname: '59004350 - הדרכת בטיחות כללית במעבדות',
      coursecategory: 'יחידת בטיחות',
      semester: 'Yearly',
      year: '2026',
    },
    {
      id: 902,
      courseId: '59004351',
      shortname: '59004351-01-2026-0',
      fullname: '59004351 - בטיחות קרינה',
      coursecategory: 'יחידת בטיחות',
      semester: 'Yearly',
      year: '2026',
    },
  ];

  it('should identify administrative and safety courses', () => {
    expect(isAdministrativeCourse(mockCourses[3])).toBe(true);
    expect(isAdministrativeCourse(mockCourses[4])).toBe(true);
    expect(isAdministrativeCourse(mockCourses[0])).toBe(false);
    expect(isAdministrativeCourse(mockCourses[1])).toBe(false);
  });

  it('should clean course display name of numeric prefix', () => {
    expect(cleanCourseDisplayName('01022312 - ביוסטטיסטיקה מתקדמת')).toBe('ביוסטטיסטיקה מתקדמת');
    expect(cleanCourseDisplayName('0368111801 : מבני נתונים')).toBe('מבני נתונים');
    expect(cleanCourseDisplayName('הדרכת בטיחות כללית')).toBe('הדרכת בטיחות כללית');
  });

  it('should merge parent and sub-course into single unified card and group admin tutorials into umbrella', () => {
    const { academicCourses, administrativeUmbrella } = groupEnrolledCourses(mockCourses);

    // 1. Academic courses: 101 and 102 merged + 201 separate => 2 academic courses
    expect(academicCourses).toHaveLength(2);

    const biostat = academicCourses.find((c) => c.courseCode === '01022312');
    expect(biostat).toBeDefined();
    expect(biostat?.fullname).toBe('ביוסטטיסטיקה מתקדמת');
    expect(biostat?.subCourses).toHaveLength(2);
    expect(biostat?.subCourses.some((s) => s.courseId === 101 && s.isParentPortal)).toBe(true);
    expect(biostat?.subCourses.some((s) => s.courseId === 102 && !s.isParentPortal)).toBe(true);

    // 2. Administrative Umbrella: 901 and 902 grouped together
    expect(administrativeUmbrella).not.toBeNull();
    expect(administrativeUmbrella?.isAdministrativeUmbrella).toBe(true);
    expect(administrativeUmbrella?.excludeFromGpa).toBe(true);
    expect(administrativeUmbrella?.subCourses).toHaveLength(2);
    expect(administrativeUmbrella?.fullname).toBe('הדרכות בטיחות והדרכות חובה');
  });

  it('should aggregate and deduplicate items across parent and sub-courses', () => {
    const { academicCourses } = groupEnrolledCourses(mockCourses);
    const biostat = academicCourses.find((c) => c.courseCode === '01022312')!;

    const mockSyncResult: SyncResult = {
      assignments: [
        {
          id: 1,
          cmid: 1001,
          courseId: 101, // From parent
          courseName: 'ביוסטטיסטיקה מתקדמת',
          name: 'מטלה 1',
          status: 'Assigned',
          deadline: '2026-11-20T20:00:00Z',
          opened: null,
          link: 'https://moodle.tau.ac.il/mod/assign/view.php?id=1001',
          grade: null,
          gradeMax: 100,
          activityType: 'assign',
          uid: 'assign:1',
        },
        {
          id: 2,
          cmid: 2001,
          courseId: 102, // From sub-course / recitation
          courseName: 'ביוסטטיסטיקה מתקדמת - תרגול',
          name: 'בוחן 1',
          status: 'Submitted',
          deadline: '2026-11-25T20:00:00Z',
          opened: null,
          link: 'https://moodle.tau.ac.il/mod/quiz/view.php?id=2001',
          grade: 95,
          gradeMax: 100,
          activityType: 'quiz',
          uid: 'quiz:2',
        },
      ],
      files: [
        {
          fileName: 'Syllabus.pdf',
          fileSize: 10240,
          fileUrl: 'https://moodle.tau.ac.il/file1',
          mimeType: 'application/pdf',
          sectionName: 'General',
          timeModified: 1761984000,
          courseId: 101, // From parent
          courseName: 'ביוסטטיסטיקה מתקדמת',
        },
        {
          fileName: 'Syllabus.pdf', // Duplicate in recitation
          fileSize: 10240,
          fileUrl: 'https://moodle.tau.ac.il/file2',
          mimeType: 'application/pdf',
          sectionName: 'General',
          timeModified: 1761984000,
          courseId: 102, // From sub-course
          courseName: 'ביוסטטיסטיקה מתקדמת - תרגול',
        },
        {
          fileName: 'Exercise1.pdf',
          fileSize: 20480,
          fileUrl: 'https://moodle.tau.ac.il/file3',
          mimeType: 'application/pdf',
          sectionName: 'Exercises',
          timeModified: 1761984000,
          courseId: 102,
          courseName: 'ביוסטטיסטיקה מתקדמת - תרגול',
        },
      ],
      meetings: [],
      errors: [],
      syncedAt: new Date().toISOString(),
    };

    const aggregated = aggregateUnifiedCourseItems(biostat, mockSyncResult);

    // Both assignments present, remapped to unified course id (101) with sourceCourseId preserved
    expect(aggregated.assignments).toHaveLength(2);
    expect(aggregated.assignments[0].sourceCourseId).toBe(101);
    expect(aggregated.assignments[1].sourceCourseId).toBe(102);
    expect(aggregated.assignments[0].courseId).toBe(101);
    expect(aggregated.assignments[1].courseId).toBe(101);

    // Syllabus.pdf deduplicated! (2 items instead of 3)
    expect(aggregated.files).toHaveLength(2);
    expect(aggregated.files.map((f) => f.fileName)).toEqual(['Syllabus.pdf', 'Exercise1.pdf']);
  });
});
