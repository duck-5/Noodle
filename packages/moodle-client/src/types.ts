export type TauSemester = 'SemesterA' | 'SemesterB' | 'Summer' | 'Yearly' | 'Other';

export interface MoodleCourse {
  id: number;         // Moodle's internal integer ID
  courseId: string;   // Extracted from shortname (e.g. "0368111801")
  shortname: string;
  fullname: string;
  idnumber?: string;
  semester: TauSemester;
  year: string;
  visible?: number;
  startdate?: number;
  enddate?: number;
  summary?: string;
  courseimage?: string;
  baseUrl?: string;
  format?: string;          // e.g. 'topics' | 'weeks' | 'onetopic' | 'multitopic' | 'tiles' | 'grid'
  coursecategory?: string;  // e.g. 'מדעים מדויקים' | 'יחידת בטיחות'
}

export interface CourseSection {
  id: number;                        // Moodle section DB id (e.g. 213921)
  courseId: number;                  // Logical course ID in Noodle
  sourceCourseId?: number;           // Underlying Moodle course ID (for merged sub-courses)
  sectionNumber: number;             // Moodle section index (0, 1, 2, ...)
  name: string;                      // Cleaned title; fallback "General" / "כללי" when sectionNumber === 0 && empty
  summaryHtml?: string;              // Cleaned section intro HTML (if non-empty)
  parentSectionId: number | null;    // null = top-level tab/section; number = child sub-tab or mod_subsection
  level: 0 | 1;                      // 0 = top-level section/tab, 1 = nested sub-tab / subsection
  isSubsectionModule?: boolean;      // true when backed by Moodle 4.5 component === 'mod_subsection'
  sectionUrl: string;                // Format-aware deep link (&sectionid=... for multitopic, &section=... otherwise)
  visible: boolean;
}

export interface CourseFolderFile {
  fileName: string;
  relativePath: string;              // Normalized relative subfolder path, e.g. "" or "מועד א 2026/"
  fileSize: number;
  fileUrl: string;                   // Raw webservice/pluginfile.php URL (without token)
  downloadUrl: string;               // Authenticated URL with ?token=...
  timeModified: number;
  mimeType?: string;
}

export interface CourseFolder {
  id: number;                        // Course module id (module.id / cmid)
  instanceId: number;                // module.instance
  courseId: number;
  sourceCourseId?: number;
  courseName: string;
  sectionId: number;
  sectionName: string;
  name: string;
  descriptionHtml?: string;
  moodleUrl: string;                 // `${courseBaseUrl}/mod/folder/view.php?id=${cmid}`
  files: CourseFolderFile[];
  totalSize: number;
}

export interface CourseLink {
  id: number;                        // Course module id (cmid)
  courseId: number;
  sourceCourseId?: number;
  courseName: string;
  sectionId: number;
  sectionName: string;
  name: string;
  targetUrl: string;                 // module.contents[0]?.fileurl || module.url
  moodleUrl: string;
  linkKind: 'zoom' | 'panopto' | 'drive' | 'github' | 'external';
}

export interface Attachment {
  name: string;
  url: string;
}

export interface Assignment {
  id: number;               // Moodle assign ID or quiz ID
  cmid: number;             // Course-module ID (used in deep links, completion updates, and grade lookups)
  courseId: number;         // Moodle course internal ID
  sourceCourseId?: number;   // Underlying Moodle course ID (when merged in parent/sub-course)
  courseName: string;
  name: string;
  status: 'Assigned' | 'Submitted' | 'Not submitted';
  deadline: string | null;  // ISO 8601 string or null
  opened: string | null;
  link: string;             // https://moodle.tau.ac.il/mod/assign/view.php?id={cmid} or .../mod/quiz/view.php?id={cmid}
  grade: number | null;
  gradeMax: number | null;
  sectionName?: string;
  attachments?: Attachment[];
  submittedFiles?: Attachment[];
  isCompleted?: boolean;
  isHidden?: boolean;
  activityType?: 'assign' | 'quiz';
  uid?: string;             // Deterministic composite ID: 'assign:{id}' | 'quiz:{id}'
  timeLimitSeconds?: number;
  attemptsAllowed?: number;
  hasFinishedAttempt?: boolean;
  requiresManualCompletion?: boolean;
  isManualCompletionDone?: boolean;
  completionTracking?: number; // 0=none, 1=manual, 2=automatic
}

export interface CourseFile {
  id?: number;              // module.id / cmid
  fileName: string;
  fileUrl: string;          // raw URL — token must be appended for download
  downloadUrl?: string;     // authenticated URL with ?token=...
  fileSize: number;
  mimeType: string;
  sectionId?: number;
  sectionNumber?: number;
  sectionName: string;
  folderId?: number;        // Present when file came from mod_folder
  folderName?: string;
  relativePath?: string;    // e.g. "מועד א סמסטר א 2026/"
  moduleName?: string;
  timeModified: number;
  courseId: number;
  sourceCourseId?: number;
  courseName: string;
  isNew?: boolean;
}

export interface ZoomMeeting {
  title: string;
  meetingUrl: string;
  sectionName: string;
  courseId: number;
  courseName: string;
  startTime?: string;
  meetingNumber?: string;
  password?: string;
}

export interface PanoptoRecording {
  id: string;
  title: string;
  recordingUrl: string;
  publishedDate: string; // YYYY-MM-DD or empty string
  type: 'Lecture' | 'Recitation';
  courseId: number;
  courseName: string;
  folderId?: string;
  folderUrl?: string;
  sectionName?: string;
  durationSeconds?: number;
}

export interface SyncResult {
  courses?: MoodleCourse[];
  sections?: CourseSection[];
  folders?: CourseFolder[];
  links?: CourseLink[];
  assignments: Assignment[];
  files: CourseFile[];
  meetings: ZoomMeeting[];
  recordings?: PanoptoRecording[];
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
  semester: TauSemester;
}

export interface MoodleCredentials {
  username: string;
  idNumber: string;
  password: string;
}
