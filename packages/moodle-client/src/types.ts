export interface MoodleCourse {
  id: number;         // Moodle's internal integer ID
  courseId: string;   // Extracted from shortname (e.g. "0368111801")
  shortname: string;
  fullname: string;
  semester: 'SemesterA' | 'SemesterB' | 'Yearly' | 'Other';
  year: string;
}

export interface Attachment {
  name: string;
  url: string;
}

export interface Assignment {
  id: number;               // Moodle assign ID
  cmid: number;             // Course-module ID (used in deep links and grade lookups)
  courseId: number;         // Moodle course internal ID
  courseName: string;
  name: string;
  status: 'Assigned' | 'Submitted' | 'Not submitted';
  deadline: string | null;  // ISO 8601 string or null
  opened: string | null;
  link: string;             // https://moodle.tau.ac.il/mod/assign/view.php?id={cmid}
  grade: number | null;
  gradeMax: number | null;
  sectionName?: string;
  attachments?: Attachment[];
}

export interface CourseFile {
  fileName: string;
  fileUrl: string;       // raw URL — token must be appended for download
  fileSize: number;
  mimeType: string;
  sectionName: string;
  timeModified: number;
  courseId: number;
  courseName: string;
}

export interface ZoomMeeting {
  title: string;
  meetingUrl: string;
  sectionName: string;
  courseId: number;
  courseName: string;
}

export interface SyncResult {
  assignments: Assignment[];
  files: CourseFile[];
  meetings: ZoomMeeting[];
  errors: SyncError[];
  syncedAt: string; // ISO 8601
}

export interface SyncError {
  context: string;  // e.g. "assignment grade fetch for course 12345"
  message: string;
}

export interface TauCourseMetadata {
  courseCode: string;
  groupId: string;
  year: string;
  semester: 'SemesterA' | 'SemesterB' | 'Yearly' | 'Other';
}
