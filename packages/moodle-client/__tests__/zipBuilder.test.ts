import {
  computeCrc32,
  buildZipArchive,
  downloadFolderAsZip,
  buildAuthenticatedFileUrl,
  ZipEntryInput,
} from '../src/zipBuilder.js';
import { CourseFolder } from '../src/types.js';
import { MoodleApiError } from '../src/moodleApi.js';

describe('Phase 1: zipBuilder (Pure TypeScript PKZIP generator & wstoken Bulk Downloader)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('TC-API-011: PKZIP standard conformance & Hebrew UTF-8 filename encoding', () => {
    it('should compute IEEE 802.3 CRC-32 accurately for standard ASCII test vectors', () => {
      const asciiVector = new TextEncoder().encode('123456789');
      const crc = computeCrc32(asciiVector);
      // Standard CRC-32 of "123456789" is 0xCBF43926 (3421780262 in unsigned 32-bit int)
      expect(crc).toBe(0xcbf43926);
    });

    it('should construct valid PKZIP archive with UTF-8 flag 0x0800 for Hebrew paths', () => {
      const textData = new TextEncoder().encode('Hello Hebrew Moodle / שלום מודל');
      const entries: ZipEntryInput[] = [
        {
          path: 'מועד א סמסטר א 2026/פתרון.pdf',
          data: textData,
          lastModified: new Date('2026-02-15T10:00:00Z'),
        },
      ];

      const zipBytes = buildZipArchive(entries);
      expect(zipBytes).toBeInstanceOf(Uint8Array);
      expect(zipBytes.length).toBeGreaterThan(0);

      const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);

      // 1. Verify Local File Header signature (0x04034b50)
      expect(view.getUint32(0, true)).toBe(0x04034b50);

      // 2. Verify General Purpose Bit Flag at offset 6 has bit 11 set (0x0800) for UTF-8 EFS
      const localFlags = view.getUint16(6, true);
      expect(localFlags & 0x0800).toBe(0x0800);

      // 3. Verify compression method is 0 (STORE)
      expect(view.getUint16(8, true)).toBe(0);

      // 4. Verify CRC32 matches payload
      const expectedCrc = computeCrc32(textData);
      expect(view.getUint32(14, true)).toBe(expectedCrc);

      // 5. Verify uncompressed & compressed sizes match payload length
      expect(view.getUint32(18, true)).toBe(textData.length);
      expect(view.getUint32(22, true)).toBe(textData.length);

      // 6. Verify filename matches UTF-8 decoded Hebrew path
      const fileNameLen = view.getUint16(26, true);
      const fileNameBytes = zipBytes.slice(30, 30 + fileNameLen);
      const decodedName = new TextDecoder().decode(fileNameBytes);
      expect(decodedName).toBe('מועד א סמסטר א 2026/פתרון.pdf');

      // 7. Verify Central Directory Header signature (0x02014b50)
      const cdOffset = 30 + fileNameLen + textData.length;
      expect(view.getUint32(cdOffset, true)).toBe(0x02014b50);

      // 8. Verify General Purpose Bit Flag in Central Directory has 0x0800 set
      const cdFlags = view.getUint16(cdOffset + 8, true);
      expect(cdFlags & 0x0800).toBe(0x0800);

      // 9. Verify End of Central Directory signature (0x06054b50)
      const eocdOffset = cdOffset + 46 + fileNameLen;
      expect(view.getUint32(eocdOffset, true)).toBe(0x06054b50);
      expect(view.getUint16(eocdOffset + 8, true)).toBe(1); // 1 entry on disk
      expect(view.getUint16(eocdOffset + 10, true)).toBe(1); // 1 total entry
    });

    it('should disambiguate duplicate file paths automatically', () => {
      const data1 = new TextEncoder().encode('File 1');
      const data2 = new TextEncoder().encode('File 2');

      const entries: ZipEntryInput[] = [
        { path: 'notes/summary.txt', data: data1 },
        { path: 'notes/summary.txt', data: data2 },
      ];

      const zipBytes = buildZipArchive(entries);
      const decoded = new TextDecoder().decode(zipBytes);
      expect(decoded).toContain('notes/summary.txt');
      expect(decoded).toContain('notes/summary (2).txt');
    });

    it('should strip traversal sequences and correctly disambiguate filenames in dotted subdirectories', () => {
      const data1 = new TextEncoder().encode('Payload 1');
      const data2 = new TextEncoder().encode('Payload 2');

      const entries: ZipEntryInput[] = [
        { path: '../../course.v1/lecture.notes.pdf', data: data1 },
        { path: '../../course.v1/lecture.notes.pdf', data: data2 },
      ];

      const zipBytes = buildZipArchive(entries);
      const decoded = new TextDecoder().decode(zipBytes);
      expect(decoded).not.toContain('..');
      expect(decoded).toContain('course.v1/lecture.notes.pdf');
      expect(decoded).toContain('course.v1/lecture.notes (2).pdf');
    });

    it('should format authenticated file URLs with token parameter correctly', () => {
      expect(buildAuthenticatedFileUrl('https://moodle.tau.ac.il/file.pdf', 'MY_TOKEN')).toBe(
        'https://moodle.tau.ac.il/file.pdf?token=MY_TOKEN'
      );
      expect(
        buildAuthenticatedFileUrl('https://moodle.tau.ac.il/file.php?forcedownload=1', 'MY_TOKEN')
      ).toBe('https://moodle.tau.ac.il/file.php?forcedownload=1&token=MY_TOKEN');
      expect(
        buildAuthenticatedFileUrl('https://moodle.tau.ac.il/file.pdf?token=EXISTING', 'MY_TOKEN')
      ).toBe('https://moodle.tau.ac.il/file.pdf?token=EXISTING');
    });

    it('should reject Moodle HTTP 200 token/exception responses during folder download', async () => {
      const folder: CourseFolder = {
        id: 501,
        instanceId: 10,
        courseId: 100,
        courseName: 'Test Course',
        sectionId: 1,
        sectionName: 'General',
        name: 'Past Exams',
        moodleUrl: 'https://moodle.tau.ac.il/mod/folder/view.php?id=501',
        files: [
          {
            fileName: 'exam.pdf',
            relativePath: '',
            fileSize: 1024,
            fileUrl: 'https://moodle.tau.ac.il/webservice/pluginfile.php/1/exam.pdf',
            downloadUrl: 'https://moodle.tau.ac.il/webservice/pluginfile.php/1/exam.pdf?token=BAD',
            timeModified: 1700000000,
          },
        ],
        totalSize: 1024,
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        clone: () => ({
          json: async () => ({
            exception: 'moodle_exception',
            errorcode: 'invalidtoken',
            message: 'Invalid token - token expired',
          }),
        }),
        arrayBuffer: async () => new ArrayBuffer(0),
      } as any);

      await expect(downloadFolderAsZip(folder, 'BAD_TOKEN')).rejects.toThrow(MoodleApiError);
    });

    it('should successfully download all files and report progress', async () => {
      const folder: CourseFolder = {
        id: 502,
        instanceId: 11,
        courseId: 100,
        courseName: 'Test Course',
        sectionId: 1,
        sectionName: 'Exams',
        name: 'Past Exams',
        moodleUrl: 'https://moodle.tau.ac.il/mod/folder/view.php?id=501',
        files: [
          {
            fileName: 'exam1.pdf',
            relativePath: '2025/',
            fileSize: 4,
            fileUrl: 'https://moodle.tau.ac.il/webservice/pluginfile.php/1/exam1.pdf',
            downloadUrl: 'https://moodle.tau.ac.il/webservice/pluginfile.php/1/exam1.pdf?token=OK',
            timeModified: 1700000000,
          },
          {
            fileName: 'exam2.pdf',
            relativePath: '2026/',
            fileSize: 4,
            fileUrl: 'https://moodle.tau.ac.il/webservice/pluginfile.php/2/exam2.pdf',
            downloadUrl: 'https://moodle.tau.ac.il/webservice/pluginfile.php/2/exam2.pdf?token=OK',
            timeModified: 1700000000,
          },
        ],
        totalSize: 8,
      };

      const fileBytes = new TextEncoder().encode('PDF-BYTES');
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/pdf' }),
        arrayBuffer: async () => fileBytes.buffer,
      } as any);

      const progressCalls: [number, number][] = [];
      const zip = await downloadFolderAsZip(folder, 'OK_TOKEN', (comp, tot) => {
        progressCalls.push([comp, tot]);
      });

      expect(zip).toBeInstanceOf(Uint8Array);
      expect(progressCalls).toEqual([
        [1, 2],
        [2, 2],
      ]);
    });
  });
});
