import { parseTauCourseMetadata } from '../src/courseParser.js';

describe('parseTauCourseMetadata', () => {
  it('should parse valid TAU course idnumber correctly', () => {
    const parsed = parseTauCourseMetadata('03211100-01-2025-1');
    expect(parsed).toEqual({
      courseCode: '03211100',
      groupId: '01',
      year: '2025',
      semester: 'SemesterA',
    });
  });

  it('should handle SemesterB, Summer, and Yearly', () => {
    expect(parseTauCourseMetadata('03681118-02-2026-2')?.semester).toBe('SemesterB');
    expect(parseTauCourseMetadata('03681118-02-2026-3')?.semester).toBe('Summer');
    expect(parseTauCourseMetadata('03681118-02-2026-0')?.semester).toBe('Yearly');
  });

  it('should handle standalone 10-digit group code and 8-digit base code', () => {
    const parsed10 = parseTauCourseMetadata('0102231201');
    expect(parsed10?.courseCode).toBe('01022312');
    expect(parsed10?.groupId).toBe('01');

    const parsed8 = parseTauCourseMetadata('01022312');
    expect(parsed8?.courseCode).toBe('01022312');
    expect(parsed8?.groupId).toBe('00');
  });

  it('should handle course codes with trailing titles', () => {
    const parsedWithTitle = parseTauCourseMetadata('01022312 - ביוסטטיסטיקה מתקדמת');
    expect(parsedWithTitle?.courseCode).toBe('01022312');
    expect(parsedWithTitle?.groupId).toBe('00');

    const parsedSubWithTitle = parseTauCourseMetadata('0102231201 - ביוסטטיסטיקה מתקדמת');
    expect(parsedSubWithTitle?.courseCode).toBe('01022312');
    expect(parsedSubWithTitle?.groupId).toBe('01');
  });

  it('should handle reversed format year-group-code-semester', () => {
    const parsed = parseTauCourseMetadata('2026-01-01022312-1');
    expect(parsed?.courseCode).toBe('01022312');
    expect(parsed?.groupId).toBe('01');
    expect(parsed?.year).toBe('2026');
    expect(parsed?.semester).toBe('SemesterA');
  });

  it('should return null for invalid formats', () => {
    expect(parseTauCourseMetadata('invalid')).toBeNull();
    expect(parseTauCourseMetadata('03211100-01-2025')).toBeNull();
  });
});
