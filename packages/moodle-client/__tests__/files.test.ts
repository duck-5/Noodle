import { MoodleClient, formatFileSize, getFileExtension } from '../src/moodleApi.js';
import { CourseFile } from '../src/types.js';

describe('Category 6: Files Explorer & Document Downloader', () => {
  const mockFiles: CourseFile[] = [
    {
      fileName: 'lecture_01_intro.pdf',
      fileUrl: 'https://moodle.tau.ac.il/mod/resource/view.php?id=1001',
      fileSize: 1048576, // 1 MB
      mimeType: 'application/pdf',
      sectionName: 'שבוע 1',
      timeModified: 1728000000,
      courseId: 101,
      courseName: 'מבני נתונים',
    },
    {
      fileName: 'homework_1_specs.docx',
      fileUrl: 'https://moodle.tau.ac.il/mod/resource/view.php?id=1002',
      fileSize: 524288, // 512 KB
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sectionName: 'שבוע 2',
      timeModified: 1728100000,
      courseId: 101,
      courseName: 'מבני נתונים',
    },
    {
      fileName: 'cheatsheet.zip',
      fileUrl: 'https://moodle.tau.ac.il/mod/resource/view.php?id=2001',
      fileSize: 2097152, // 2 MB
      mimeType: 'application/zip',
      sectionName: 'חומרי עזר',
      timeModified: 1728200000,
      courseId: 102,
      courseName: 'אלגברה לינארית',
    },
  ];

  describe('TC-FILE-01: Aggregated Course Files Tree', () => {
    it('should aggregate files grouped by courseId', () => {
      const filesByCourse: Record<number, CourseFile[]> = {};
      for (const file of mockFiles) {
        if (!filesByCourse[file.courseId]) {
          filesByCourse[file.courseId] = [];
        }
        filesByCourse[file.courseId].push(file);
      }

      expect(Object.keys(filesByCourse)).toHaveLength(2);
      expect(filesByCourse[101]).toHaveLength(2);
      expect(filesByCourse[102]).toHaveLength(1);
    });
  });

  describe('TC-FILE-02: File Search by Keyword & Extension', () => {
    it('should filter files by search query matching filename or course name', () => {
      const searchFiles = (query: string) => {
        const q = query.toLowerCase().trim();
        return mockFiles.filter((f) =>
          f.fileName.toLowerCase().includes(q) || f.courseName.toLowerCase().includes(q)
        );
      };

      expect(searchFiles('.pdf')).toHaveLength(1);
      expect(searchFiles('מבני נתונים')).toHaveLength(2);
      expect(searchFiles('homework')).toHaveLength(1);
      expect(searchFiles('nonexistent')).toHaveLength(0);
    });
  });

  describe('TC-FILE-03: File-Type Badges & Size Formatting', () => {
    it('should format bytes to human readable format (TC-FILE-03 specification)', () => {
      expect(formatFileSize(1024)).toBe('1 KB');
      expect(formatFileSize(1048576)).toBe('1.0 MB');
      expect(formatFileSize(524288)).toBe('512 KB');
      expect(formatFileSize(0)).toBe('0 B');
    });

    it('should extract file extensions correctly', () => {
      expect(getFileExtension('homework.docx')).toBe('DOCX');
      expect(getFileExtension('slides.pdf')).toBe('PDF');
      expect(getFileExtension('archive.tar.gz')).toBe('GZ');
      expect(getFileExtension('no_extension')).toBe('');
    });
  });

  describe('TC-FILE-04: Authenticated Download with WAF Bypass', () => {
    it('should append token parameter to file URL for authenticated download', () => {
      const client = new MoodleClient('SECRET_WSTOKEN_XYZ');
      const authUrl = client.buildAuthenticatedFileUrl('https://moodle.tau.ac.il/pluginfile.php/123/mod_resource/content/1/doc.pdf');
      expect(authUrl).toBe('https://moodle.tau.ac.il/pluginfile.php/123/mod_resource/content/1/doc.pdf?token=SECRET_WSTOKEN_XYZ');

      // When URL already has query parameters
      const authUrlWithParams = client.buildAuthenticatedFileUrl('https://moodle.tau.ac.il/file.php?id=123');
      expect(authUrlWithParams).toBe('https://moodle.tau.ac.il/file.php?id=123&token=SECRET_WSTOKEN_XYZ');
    });
  });
});
