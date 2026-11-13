import {
  sanitizePathSegment,
  sanitizeRelativePath,
  getCanonicalFileUrlPath,
  buildLocalFsTreePlan,
  planLocalFsDiff,
} from '../src/localFsPlanner.js';
import type { SyncResult, MoodleCourse } from '../src/types.js';

describe('Local FS Planner & Path Sanitizer (#18)', () => {
  describe('sanitizePathSegment & sanitizeRelativePath', () => {
    it('strips illegal OS characters, control characters, and trailing dots/spaces', () => {
      expect(sanitizePathSegment('Week 1: Intro? *<>|"')).toBe('Week 1_ Intro_ _____');
      expect(sanitizePathSegment('שבוע 1 - מבוא...  ')).toBe('שבוע 1 - מבוא');
      expect(sanitizePathSegment('..')).toBe('_');
      expect(sanitizePathSegment('...')).toBe('_');
      expect(sanitizePathSegment('')).toBe('_');
    });

    it('guards Windows reserved filenames (CON, PRN, NUL, COM1, LPT1)', () => {
      expect(sanitizePathSegment('CON')).toBe('_CON');
      expect(sanitizePathSegment('nul.txt')).toBe('_nul.txt');
      expect(sanitizePathSegment('COM1')).toBe('_COM1');
      expect(sanitizePathSegment('lpt9.pdf')).toBe('_lpt9.pdf');
    });

    it('truncates long segments while preserving short extensions', () => {
      const longName = `${'א'.repeat(130)}.pdf`;
      const sanitized = sanitizePathSegment(longName, 50);
      expect(sanitized.length).toBeLessThanOrEqual(50);
      expect(sanitized.endsWith('.pdf')).toBe(true);
    });

    it('normalizes backslashes, strips traversal segments, and bounds total path length', () => {
      expect(sanitizeRelativePath('..\\..\\Course/Week 1./notes?.pdf')).toBe(
        'Course/Week 1/notes_.pdf'
      );

      const deepPath = `${'a'.repeat(90)}/${'b'.repeat(90)}/${'c'.repeat(90)}/lecture.pdf`;
      const bounded = sanitizeRelativePath(deepPath, 150);
      expect(bounded.length).toBeLessThanOrEqual(150);
      expect(bounded.endsWith('.pdf')).toBe(true);
    });
  });

  describe('getCanonicalFileUrlPath', () => {
    it('strips volatile token and forcedownload query parameters', () => {
      expect(
        getCanonicalFileUrlPath(
          'https://moodle.tau.ac.il/webservice/pluginfile.php/123/mod_resource/content/2/slides.pdf?token=ABC&forcedownload=1'
        )
      ).toBe('https://moodle.tau.ac.il/webservice/pluginfile.php/123/mod_resource/content/2/slides.pdf');
    });
  });

  describe('buildLocalFsTreePlan', () => {
    const mockSync: SyncResult = {
      syncedAt: '2026-11-10T10:00:00Z',
      errors: [],
      meetings: [],
      sections: [
        {
          id: 10,
          courseId: 101,
          sectionNumber: 1,
          name: 'הרצאות',
          parentSectionId: null,
          level: 0,
          sectionUrl: 'https://moodle.tau.ac.il/course/view.php?id=101&section=1',
          visible: true,
        },
        {
          id: 11,
          courseId: 101,
          sectionNumber: 2,
          name: 'שבוע 1: עצים',
          parentSectionId: 10,
          level: 1,
          sectionUrl: 'https://moodle.tau.ac.il/course/view.php?id=101&section=2',
          visible: true,
        },
      ],
      files: [
        // Standalone file inside 2-level subsection
        {
          id: 500,
          fileName: 'slides_01.pdf',
          fileUrl: 'https://moodle.tau.ac.il/webservice/pluginfile.php/1/mod_resource/content/1/slides_01.pdf',
          fileSize: 1024,
          mimeType: 'application/pdf',
          sectionId: 11,
          sectionName: 'שבוע 1: עצים',
          timeModified: 1700000000,
          courseId: 101,
          courseName: '03682158 - מבני נתונים',
        },
        // Duplicate filename in same section (different module id)
        {
          id: 501,
          fileName: 'slides_01.pdf',
          fileUrl: 'https://moodle.tau.ac.il/webservice/pluginfile.php/2/mod_resource/content/1/slides_01.pdf',
          fileSize: 2048,
          mimeType: 'application/pdf',
          sectionId: 11,
          sectionName: 'שבוע 1: עצים',
          timeModified: 1700000010,
          courseId: 101,
          courseName: '03682158 - מבני נתונים',
        },
        // CR-09 folder mirror file that MUST NOT be duplicated outside folder card
        {
          id: 600,
          fileName: 'exam_2025.pdf',
          fileUrl: 'https://moodle.tau.ac.il/webservice/pluginfile.php/3/mod_folder/content/1/2025/exam_2025.pdf',
          fileSize: 4096,
          mimeType: 'application/pdf',
          sectionId: 10,
          sectionName: 'הרצאות',
          folderId: 600,
          folderName: 'מבחני עבר',
          relativePath: '2025/',
          timeModified: 1700000020,
          courseId: 101,
          courseName: '03682158 - מבני נתונים',
        },
      ],
      folders: [
        {
          id: 600,
          instanceId: 60,
          courseId: 101,
          courseName: '03682158 - מבני נתונים',
          sectionId: 10,
          sectionName: 'הרצאות',
          name: 'מבחני עבר',
          moodleUrl: 'https://moodle.tau.ac.il/mod/folder/view.php?id=600',
          totalSize: 4096,
          files: [
            {
              fileName: 'exam_2025.pdf',
              relativePath: '2025/',
              fileSize: 4096,
              fileUrl: 'https://moodle.tau.ac.il/webservice/pluginfile.php/3/mod_folder/content/1/2025/exam_2025.pdf',
              downloadUrl: 'https://moodle.tau.ac.il/webservice/pluginfile.php/3/mod_folder/content/1/2025/exam_2025.pdf?token=T',
              timeModified: 1700000020,
            },
          ],
        },
      ],
      assignments: [
        {
          id: 700,
          cmid: 7000,
          courseId: 101,
          courseName: '03682158 - מבני נתונים',
          name: 'מטלה 1',
          status: 'Submitted',
          deadline: null,
          opened: null,
          link: 'https://moodle.tau.ac.il/mod/assign/view.php?id=7000',
          grade: null,
          gradeMax: 100,
          sectionId: 11,
          sectionName: 'שבוע 1: עצים',
          attachments: [
            {
              name: 'hw1.pdf',
              url: 'https://moodle.tau.ac.il/webservice/pluginfile.php/4/mod_assign/introattachment/0/hw1.pdf',
              fileSize: 512,
              timeModified: 1700000030,
            },
          ],
          submittedFiles: [
            {
              name: 'solution.zip',
              url: 'https://moodle.tau.ac.il/webservice/pluginfile.php/5/assignsubmission_file/submission_files/1/solution.zip',
              fileSize: 256,
              timeModified: 1700000040,
            },
          ],
        },
      ],
    };

    it('mirrors 2-level sections, avoids mod_folder duplication, disambiguates collisions, and respects assignment toggles', () => {
      const plan = buildLocalFsTreePlan(mockSync, {
        coursesCustomNames: { 101: 'מבני נתונים' },
        useCourseNicknames: true,
        includeAssignments: true,
        includeSubmissions: false,
      });

      const paths = plan.files.map((f) => f.relativePath);
      expect(paths).toEqual([
        'מבני נתונים/הרצאות/שבוע 1_ עצים/slides_01.pdf',
        'מבני נתונים/הרצאות/שבוע 1_ עצים/slides_01 (2).pdf',
        'מבני נתונים/הרצאות/מבחני עבר/2025/exam_2025.pdf',
        'מבני נתונים/הרצאות/שבוע 1_ עצים/מטלה 1/hw1.pdf',
      ]);

      const planWithSubs = buildLocalFsTreePlan(mockSync, {
        coursesCustomNames: { 101: 'מבני נתונים' },
        includeAssignments: true,
        includeSubmissions: true,
      });
      expect(planWithSubs.files.map((f) => f.relativePath)).toContain(
        'מבני נתונים/הרצאות/שבוע 1_ עצים/מטלה 1/Submitted/solution.zip'
      );
    });

    it('preserves anchored course folder names even when nickname changes', () => {
      const plan = buildLocalFsTreePlan(mockSync, {
        coursesCustomNames: { 101: 'שם חדש לגמרי' },
        existingCourseFolderNames: { 101: 'מבני נתונים' },
      });

      expect(plan.courseFolderNames[101]).toBe('מבני נתונים');
      expect(plan.files[0].relativePath.startsWith('מבני נתונים/')).toBe(true);
    });

    it('deduplicates Mode A multi-portal courses into one course directory', () => {
      const enrolledCourses: MoodleCourse[] = [
        {
          id: 101,
          courseId: '03682158',
          shortname: '0368-2158-99-2026-1',
          fullname: '03682158 - מבני נתונים',
          semester: 'SemesterA',
          year: '2026',
        },
        {
          id: 102,
          courseId: '0368215801',
          shortname: '0368-2158-01-2026-1',
          fullname: '0368215801 - תרגול מבני נתונים',
          semester: 'SemesterA',
          year: '2026',
        },
      ];

      const multiSync: SyncResult = {
        ...mockSync,
        files: [
          mockSync.files[0],
          // Identical file duplicated in recitation portal 102
          {
            ...mockSync.files[0],
            courseId: 102,
            courseName: '0368215801 - תרגול מבני נתונים',
          },
          // Unique file in portal 102
          {
            id: 900,
            fileName: 'recitation_1.pdf',
            fileUrl: 'https://moodle.tau.ac.il/webservice/pluginfile.php/9/mod_resource/content/1/recitation_1.pdf',
            fileSize: 999,
            mimeType: 'application/pdf',
            sectionName: 'תרגול',
            timeModified: 1700000100,
            courseId: 102,
            courseName: '0368215801 - תרגול מבני נתונים',
          },
        ],
        folders: [],
        assignments: [],
      };

      const plan = buildLocalFsTreePlan(multiSync, {
        enrolledCourses,
        trackedCourseIds: [101, 102],
      });

      expect(plan.files).toHaveLength(2);
      expect(plan.files.every((f) => f.courseId === 101)).toBe(true);
    });
  });

  describe('planLocalFsDiff', () => {
    it('detects new, updated (by timeModified, size, or URL revision), unchanged, and oversized files', () => {
      const plan = {
        courseFolderNames: { 101: 'Course' },
        files: [
          {
            moodleFileId: 'res:101:1:unchanged.pdf',
            courseId: 101,
            sourceCourseId: 101,
            courseFolderName: 'Course',
            relativePath: 'Course/Week 1/unchanged.pdf',
            fileName: 'unchanged.pdf',
            fileUrl: 'https://moodle.tau.ac.il/webservice/pluginfile.php/1/content/1/unchanged.pdf',
            canonicalUrlPath: 'https://moodle.tau.ac.il/webservice/pluginfile.php/1/content/1/unchanged.pdf',
            fileSize: 1000,
            timeModified: 100,
            kind: 'resource' as const,
          },
          {
            moodleFileId: 'res:101:2:new.pdf',
            courseId: 101,
            sourceCourseId: 101,
            courseFolderName: 'Course',
            relativePath: 'Course/Week 1/new.pdf',
            fileName: 'new.pdf',
            fileUrl: 'https://moodle.tau.ac.il/webservice/pluginfile.php/2/content/1/new.pdf',
            canonicalUrlPath: 'https://moodle.tau.ac.il/webservice/pluginfile.php/2/content/1/new.pdf',
            fileSize: 1000,
            timeModified: 200,
            kind: 'resource' as const,
          },
          {
            moodleFileId: 'res:101:3:updated_time.pdf',
            courseId: 101,
            sourceCourseId: 101,
            courseFolderName: 'Course',
            relativePath: 'Course/Week 1/updated_time.pdf',
            fileName: 'updated_time.pdf',
            fileUrl: 'https://moodle.tau.ac.il/webservice/pluginfile.php/3/content/1/updated_time.pdf',
            canonicalUrlPath: 'https://moodle.tau.ac.il/webservice/pluginfile.php/3/content/1/updated_time.pdf',
            fileSize: 1000,
            timeModified: 300,
            kind: 'resource' as const,
          },
          {
            moodleFileId: 'res:101:4:updated_url.pdf',
            courseId: 101,
            sourceCourseId: 101,
            courseFolderName: 'Course',
            relativePath: 'Course/Week 1/updated_url.pdf',
            fileName: 'updated_url.pdf',
            fileUrl: 'https://moodle.tau.ac.il/webservice/pluginfile.php/4/content/2/updated_url.pdf',
            canonicalUrlPath: 'https://moodle.tau.ac.il/webservice/pluginfile.php/4/content/2/updated_url.pdf',
            fileSize: 1000,
            timeModified: 0,
            kind: 'resource' as const,
          },
          {
            moodleFileId: 'res:101:5:huge.zip',
            courseId: 101,
            sourceCourseId: 101,
            courseFolderName: 'Course',
            relativePath: 'Course/Week 1/huge.zip',
            fileName: 'huge.zip',
            fileUrl: 'https://moodle.tau.ac.il/webservice/pluginfile.php/5/content/1/huge.zip',
            canonicalUrlPath: 'https://moodle.tau.ac.il/webservice/pluginfile.php/5/content/1/huge.zip',
            fileSize: 150 * 1024 * 1024,
            timeModified: 100,
            kind: 'resource' as const,
          },
        ],
      };

      const manifest = {
        'res:101:1:unchanged.pdf': {
          moodleFileId: 'res:101:1:unchanged.pdf',
          relativePath: 'Course/Week 1/unchanged.pdf',
          lastModified: 100,
          size: 1000,
          canonicalUrlPath: 'https://moodle.tau.ac.il/webservice/pluginfile.php/1/content/1/unchanged.pdf',
        },
        'res:101:3:updated_time.pdf': {
          moodleFileId: 'res:101:3:updated_time.pdf',
          relativePath: 'Course/Week 1/updated_time.pdf',
          lastModified: 200,
          size: 1000,
          canonicalUrlPath: 'https://moodle.tau.ac.il/webservice/pluginfile.php/3/content/1/updated_time.pdf',
        },
        'res:101:4:updated_url.pdf': {
          moodleFileId: 'res:101:4:updated_url.pdf',
          relativePath: 'Course/Week 1/updated_url.pdf',
          lastModified: 0,
          size: 1000,
          canonicalUrlPath: 'https://moodle.tau.ac.il/webservice/pluginfile.php/4/content/1/updated_url.pdf',
        },
      };

      const diff = planLocalFsDiff(plan, manifest, { maxFileSizeMb: 100 });
      expect(diff.unchanged.map((u) => u.moodleFileId)).toEqual(['res:101:1:unchanged.pdf']);
      expect(diff.skippedTooLarge.map((s) => s.moodleFileId)).toEqual(['res:101:5:huge.zip']);
      expect(diff.toDownload).toEqual([
        expect.objectContaining({ reason: 'new', file: expect.objectContaining({ moodleFileId: 'res:101:2:new.pdf' }) }),
        expect.objectContaining({ reason: 'updated', file: expect.objectContaining({ moodleFileId: 'res:101:3:updated_time.pdf' }) }),
        expect.objectContaining({ reason: 'updated', file: expect.objectContaining({ moodleFileId: 'res:101:4:updated_url.pdf' }) }),
      ]);
    });

    it('pre-seeds usedCourseFoldersLower from existingCourseFolderNames so smaller new courseIds cannot hijack anchored names', () => {
      const syncResult: SyncResult = {
        files: [
          {
            id: 5,
            courseId: 50,
            courseName: 'Discrete Math',
            sectionId: 0,
            sectionName: 'General',
            fileName: 'syllabus.pdf',
            fileUrl: 'https://moodle.tau.ac.il/webservice/pluginfile.php/5/content/1/syllabus.pdf',
            fileSize: 512,
            mimeType: 'application/pdf',
            timeModified: 100,
          },
          {
            id: 10,
            courseId: 100,
            courseName: 'Algorithms',
            sectionId: 1,
            sectionName: 'General',
            fileName: 'intro.pdf',
            fileUrl: 'https://moodle.tau.ac.il/webservice/pluginfile.php/10/content/1/intro.pdf',
            fileSize: 512,
            mimeType: 'application/pdf',
            timeModified: 100,
          },
          {
            id: 20,
            courseId: 200,
            courseName: 'Algorithms Renamed',
            sectionId: 2,
            sectionName: 'General',
            fileName: 'notes.pdf',
            fileUrl: 'https://moodle.tau.ac.il/webservice/pluginfile.php/20/content/1/notes.pdf',
            fileSize: 512,
            mimeType: 'application/pdf',
            timeModified: 100,
          },
        ],
        folders: [],
        sections: [],
        assignments: [],
        meetings: [],
        errors: [],
        courses: [
          {
            id: 50,
            courseId: '03680500',
            fullname: 'Discrete Math',
            shortname: 'DM-50',
            semester: 'SemesterA',
            year: '2026',
          },
          {
            id: 100,
            courseId: '03681000',
            fullname: 'Algorithms',
            shortname: 'ALG-100',
            semester: 'SemesterA',
            year: '2026',
          },
          {
            id: 200,
            courseId: '03682000',
            fullname: 'Algorithms Renamed',
            shortname: 'ALG-200',
            semester: 'SemesterA',
            year: '2026',
          },
        ],
        syncedAt: '2026-11-10T10:00:00Z',
      };

      const plan = buildLocalFsTreePlan(syncResult, {
        existingCourseFolderNames: {
          200: 'Algorithms',
          999: 'Discrete Math',
        },
        trackedCourseIds: [50, 100, 200],
      });

      expect(plan.courseFolderNames[200]).toBe('Algorithms');
      expect(plan.courseFolderNames[100]).toBe('Algorithms (100)');
      expect(plan.courseFolderNames[999]).toBe('Discrete Math');
      expect(plan.courseFolderNames[50]).toBe('Discrete Math (50)');
      expect(plan.files.find((f) => f.courseId === 200)?.relativePath).toBe('Algorithms/General/notes.pdf');
      expect(plan.files.find((f) => f.courseId === 100)?.relativePath).toBe('Algorithms (100)/General/intro.pdf');
      expect(plan.files.find((f) => f.courseId === 50)?.relativePath).toBe('Discrete Math (50)/General/syllabus.pdf');

      // Files belonging to untracked courses in a cached SyncResult must be excluded even if anchored
      const filteredPlan = buildLocalFsTreePlan(syncResult, {
        existingCourseFolderNames: { 200: 'Algorithms' },
        trackedCourseIds: [100],
      });
      expect(filteredPlan.files.map((f) => f.courseId)).toEqual([100]);
    });
  });
});

