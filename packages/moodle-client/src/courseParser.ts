import { TauCourseMetadata, TauSemester } from './types.js';

/**
 * Parses academic year, semester, course code, and group ID from Moodle's idnumber or shortname.
 * Supported TAU formats:
 * - Standard: [8-digit Course Code]-[2-digit Group]-[4-digit Year]-[1-digit Semester]
 *   e.g. 03211100-01-2025-1 -> Year 2025, Semester A (1)
 *   e.g. 01022312-99-2026-3 -> Year 2026, Summer (3)
 * - Reversed: [Year]-[Group]-[CourseCode]-[Semester]
 *   e.g. 2026-01-01022312-1
 * - Standalone 10 digits: [8-digit Course Code][2-digit Group]
 *   e.g. 0102231201 -> Course 01022312, Group 01
 * - Standalone 8 digits: [8-digit Course Code]
 *   e.g. 01022312 -> Course 01022312, Group 00
 */
export function parseTauCourseMetadata(idnumberOrShortname: string): TauCourseMetadata | null {
  if (!idnumberOrShortname) return null;
  const str = idnumberOrShortname.trim();

  // Pattern 1: Standard [8-digit Course Code]-[2-digit Group]-[4-digit Year]-[1-digit Semester]
  const matchStandard = str.match(/^(\d{4}-?\d{4})-(\d{2})-(\d{4})-(\d)$/);
  if (matchStandard) {
    const [, rawCourseCode, groupId, year, semesterCode] = matchStandard;
    const courseCode = rawCourseCode.replace('-', '');
    let semester: TauSemester = 'Other';
    if (semesterCode === '1') semester = 'SemesterA';
    else if (semesterCode === '2') semester = 'SemesterB';
    else if (semesterCode === '3') semester = 'Summer';
    else if (semesterCode === '0' || semesterCode === '9') semester = 'Yearly';

    return {
      courseCode,
      groupId,
      year,
      semester,
    };
  }

  // Pattern 2: Reversed format [Year]-[Group]-[CourseCode]-[Semester]
  const matchReversed = str.match(/^(\d{4})-(\d{2})-(\d{8,10})-(\d)$/);
  if (matchReversed) {
    const [, year, groupId, rawCode, semesterCode] = matchReversed;
    const courseCode = rawCode.substring(0, 8);
    const resolvedGroup = rawCode.length === 10 ? rawCode.substring(8, 10) : groupId;
    let semester: TauSemester = 'Other';
    if (semesterCode === '1') semester = 'SemesterA';
    else if (semesterCode === '2') semester = 'SemesterB';
    else if (semesterCode === '3') semester = 'Summer';
    else if (semesterCode === '0' || semesterCode === '9') semester = 'Yearly';

    return {
      courseCode,
      groupId: resolvedGroup,
      year,
      semester,
    };
  }

  // Pattern 3: Standalone 10-digit code [8-digit course][2-digit group]
  const matchTenDigits = str.match(/^(\d{8})(\d{2})$/);
  if (matchTenDigits) {
    return {
      courseCode: matchTenDigits[1],
      groupId: matchTenDigits[2],
      year: '',
      semester: 'Other',
    };
  }

  // Pattern 4: Standalone 8-digit code [8-digit course]
  const matchEightDigits = str.match(/^(\d{8})$/);
  if (matchEightDigits) {
    return {
      courseCode: matchEightDigits[1],
      groupId: '00',
      year: '',
      semester: 'Other',
    };
  }

  return null;
}
