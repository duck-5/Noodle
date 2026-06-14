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

  it('should handle SemesterB and Yearly', () => {
    expect(parseTauCourseMetadata('03681118-02-2026-2')?.semester).toBe('SemesterB');
    expect(parseTauCourseMetadata('03681118-02-2026-0')?.semester).toBe('Yearly');
  });

  it('should return null for invalid formats', () => {
    expect(parseTauCourseMetadata('invalid')).toBeNull();
    expect(parseTauCourseMetadata('03211100-01-2025')).toBeNull();
  });
});
