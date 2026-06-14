import { TauCourseMetadata } from './types.js';

/**
 * Parses academic year and semester from Moodle's idnumber.
 * TAU idnumber structure: [8-digit Course Code]-[2-digit Group]-[4-digit Year]-[1-digit Semester]
 * e.g. 03211100-01-2025-1 -> Year 2025, Semester A (1)
 */
export function parseTauCourseMetadata(idnumber: string): TauCourseMetadata | null {
  const match = idnumber.match(/^(\d{8})-(\d{2})-(\d{4})-(\d)$/);
  if (match) {
    const [, courseCode, groupId, year, semesterCode] = match;
    let semester: 'SemesterA' | 'SemesterB' | 'Yearly' | 'Other' = 'Other';
    if (semesterCode === '1') {
      semester = 'SemesterA';
    } else if (semesterCode === '2') {
      semester = 'SemesterB';
    } else if (semesterCode === '0') {
      semester = 'Yearly';
    }
    return {
      courseCode,
      groupId,
      year,
      semester,
    };
  }
  return null;
}
