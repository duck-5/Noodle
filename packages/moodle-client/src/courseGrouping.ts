import {
  MoodleCourse,
  TauSemester,
  SyncResult,
  Assignment,
  CourseFile,
  ZoomMeeting,
  CourseFolder,
  CourseLink,
  CourseSection,
  CourseAnnouncement,
  PanoptoRecording,
  CourseGradeSummary,
} from './types.js';
import { parseTauCourseMetadata } from './courseParser.js';

export interface UnifiedCourseGroup {
  courseId: number;
  shortname: string;
  groupId: string;
  fullname: string;
  isParentPortal: boolean;
}

export interface UnifiedCourse {
  id: number;
  courseCode: string;
  fullname: string;
  shortname: string;
  semester: TauSemester;
  year: string;
  subCourses: UnifiedCourseGroup[];
  isAdministrativeUmbrella?: boolean;
  excludeFromGpa?: boolean;
}

export interface GroupedCoursesResult {
  academicCourses: UnifiedCourse[];
  administrativeUmbrella: UnifiedCourse | null;
}

/**
 * Checks whether a course is an administrative, safety, or institutional compliance tutorial
 * that belongs under the Administrative Umbrella rather than standard academic courses.
 */
export function isAdministrativeCourse(course: {
  courseId?: string;
  shortname?: string;
  fullname?: string;
  coursecategory?: string;
}): boolean {
  const code = (course.courseId || '').trim();
  const shortname = (course.shortname || '').trim();
  const fullname = (course.fullname || '').trim();
  const category = (course.coursecategory || '').trim();

  // 1. Course code prefix rules: 5900* (Lab/Radiation/Safety), 5800* (Ethics/Institutional)
  if (/^5[89]00\d{4}/.test(code) || /^5[89]00\d{4}/.test(shortname)) {
    return true;
  }

  // 2. Category rules
  if (/בטיחות|safety|מנהלי|administrative/i.test(category)) {
    return true;
  }

  // 3. Fullname keywords
  if (
    /הדרכת בטיחות|בטיחות במעבדות|בטיחות קרינה|בטיחות ביולוגית|בטיחות באש|הטרדה מינית|הדרכות חובה/i.test(fullname)
  ) {
    return true;
  }

  return false;
}

/**
 * Strips numeric prefix from course fullname (e.g. "01022312 - ביוסטטיסטיקה מתקדמת" -> "ביוסטטיסטיקה מתקדמת")
 */
export function cleanCourseDisplayName(fullname: string): string {
  if (!fullname) return '';
  return fullname.replace(/^(\d{8,10}|\d{4}-?\d{4}-\d{2}-\d{4}-\d)\s*[-:–—]\s*/, '').trim();
}

/**
 * Groups enrolled courses into Mode A (Academic Parent/Sub-course Merging) and Mode B (Administrative Umbrella).
 */
export function groupEnrolledCourses(courses: MoodleCourse[]): GroupedCoursesResult {
  const academicList: MoodleCourse[] = [];
  const adminList: MoodleCourse[] = [];

  for (const c of courses) {
    if (isAdministrativeCourse(c)) {
      adminList.push(c);
    } else {
      academicList.push(c);
    }
  }

  // Build Administrative Umbrella card if any admin courses found
  let administrativeUmbrella: UnifiedCourse | null = null;
  if (adminList.length > 0) {
    const currentYear = String(new Date().getFullYear());
    administrativeUmbrella = {
      id: -5900,
      courseCode: '5900',
      fullname: 'הדרכות בטיחות והדרכות חובה',
      shortname: 'ADMIN-SAFETY',
      semester: 'Yearly',
      year: currentYear,
      isAdministrativeUmbrella: true,
      excludeFromGpa: true,
      subCourses: adminList.map((c) => ({
        courseId: c.id,
        shortname: c.shortname,
        groupId: c.courseId || String(c.id),
        fullname: c.fullname,
        isParentPortal: false,
      })),
    };
  }

  // Group Academic courses by base 8-digit course code + year + semester,
  // with fallback matching when a standalone 8/10-digit course has semester='Other' or empty year.
  const unifiedList: UnifiedCourse[] = [];

  for (const c of academicList) {
    const meta = parseTauCourseMetadata(c.idnumber || c.shortname || c.fullname);
    const courseCode = meta?.courseCode || (c.courseId ? c.courseId.substring(0, 8) : '') || String(c.id);
    const year = (meta?.year && meta.year.trim()) || (c.year && c.year.trim()) || String(new Date().getFullYear());
    const semester: TauSemester =
      meta?.semester && meta.semester !== 'Other'
        ? meta.semester
        : c.semester && c.semester !== 'Other'
        ? c.semester
        : 'Other';
    const groupId = meta?.groupId || '00';
    const isParentPortal = groupId === '99' || groupId === '00' || c.shortname.trim() === courseCode;

    // Find an existing group with the same courseCode + year where semesters either match
    // or one of them is 'Other' (common on standalone 10-digit sub-courses like 0102231201).
    let unified = unifiedList.find(
      (u) =>
        u.courseCode === courseCode &&
        u.year === year &&
        (u.semester === semester || u.semester === 'Other' || semester === 'Other')
    );

    if (!unified) {
      const cleanTitle = cleanCourseDisplayName(c.fullname) || c.fullname;
      unified = {
        id: c.id,
        courseCode,
        fullname: cleanTitle,
        shortname: c.shortname,
        semester,
        year,
        subCourses: [],
      };
      unifiedList.push(unified);
    } else if (unified.semester === 'Other' && semester !== 'Other') {
      unified.semester = semester;
    }

    // If current entry is parent portal (e.g. -99- or base course code), prefer its ID and clean title
    if (isParentPortal) {
      unified.id = c.id;
      const cleanTitle = cleanCourseDisplayName(c.fullname);
      if (cleanTitle) unified.fullname = cleanTitle;
    }

    unified.subCourses.push({
      courseId: c.id,
      shortname: c.shortname,
      groupId,
      fullname: c.fullname,
      isParentPortal,
    });
  }

  return {
    academicCourses: unifiedList,
    administrativeUmbrella,
  };
}

/**
 * Expands a list of tracked course IDs (which may include a -5900 synthetic administrative umbrella ID)
 * into constituent underlying real positive Moodle course IDs for REST API syncing.
 * Academic courses selected by the user are preserved as chosen (parent or child) without force-expanding unselected sub-courses.
 */
export function expandTrackedCourseIds(
  trackedCourseIds: number[],
  grouped: GroupedCoursesResult
): number[] {
  const expanded = new Set<number>();

  for (const id of trackedCourseIds) {
    if (id > 0) {
      expanded.add(id);
    } else if (id === -5900 && grouped.administrativeUmbrella) {
      for (const sub of grouped.administrativeUmbrella.subCourses) {
        if (sub.courseId > 0) expanded.add(sub.courseId);
      }
    }
  }

  return Array.from(expanded);
}

/**
 * Aggregates and deduplicates all items (assignments, files, meetings, folders, links,
 * sections, announcements, recordings, and gradeSummary) for a unified course across
 * all its underlying sub-courses.
 */
export function aggregateUnifiedCourseItems(
  unifiedCourse: UnifiedCourse,
  syncResult: SyncResult
): {
  assignments: Assignment[];
  files: CourseFile[];
  meetings: ZoomMeeting[];
  folders: CourseFolder[];
  links: CourseLink[];
  sections: CourseSection[];
  announcements: CourseAnnouncement[];
  recordings: PanoptoRecording[];
  gradeSummary?: CourseGradeSummary;
} {
  const memberCourseIds = new Set(unifiedCourse.subCourses.map((s) => s.courseId));

  // Assignments & Quizzes
  const rawAssigns = (syncResult.assignments || []).filter((a) => memberCourseIds.has(a.courseId));
  const seenAssignKeys = new Set<string>();
  const assignments: Assignment[] = [];
  for (const a of rawAssigns) {
    const key = a.uid || `${a.activityType || 'assign'}:${a.id}`;
    const cmidKey = a.cmid ? `cmid:${a.cmid}` : '';
    const nameKey = `${(a.name || '').trim().toLowerCase()}_${a.deadline || ''}`;
    if (!seenAssignKeys.has(key) && (!cmidKey || !seenAssignKeys.has(cmidKey)) && !seenAssignKeys.has(nameKey)) {
      seenAssignKeys.add(key);
      if (cmidKey) seenAssignKeys.add(cmidKey);
      seenAssignKeys.add(nameKey);
      assignments.push({
        ...a,
        sourceCourseId: a.courseId,
        courseId: unifiedCourse.id,
      });
    }
  }

  // Files: deduplicate by fileName + fileSize
  const rawFiles = (syncResult.files || []).filter((f) => memberCourseIds.has(f.courseId));
  const seenFileKeys = new Set<string>();
  const files: CourseFile[] = [];
  for (const f of rawFiles) {
    const key = `${f.fileName}_${f.fileSize}`;
    if (!seenFileKeys.has(key)) {
      seenFileKeys.add(key);
      files.push({
        ...f,
        sourceCourseId: f.courseId,
        courseId: unifiedCourse.id,
      });
    }
  }

  // Zoom Meetings: deduplicate by meetingNumber or URL
  const rawMeetings = (syncResult.meetings || []).filter((m) => memberCourseIds.has(m.courseId));
  const seenMeetingKeys = new Set<string>();
  const meetings: ZoomMeeting[] = [];
  for (const m of rawMeetings) {
    const key = m.startTime
      ? `${m.meetingNumber || m.meetingUrl}_${m.startTime}`
      : `${m.meetingNumber || m.meetingUrl}`;
    if (!seenMeetingKeys.has(key)) {
      seenMeetingKeys.add(key);
      meetings.push({
        ...m,
        courseId: unifiedCourse.id,
      });
    }
  }

  // Folders: deduplicate by folder name + files length
  const rawFolders = (syncResult.folders || []).filter((fld) => memberCourseIds.has(fld.courseId));
  const seenFolderKeys = new Set<string>();
  const folders: CourseFolder[] = [];
  for (const fld of rawFolders) {
    const key = `${fld.name}_${fld.files.length}`;
    if (!seenFolderKeys.has(key)) {
      seenFolderKeys.add(key);
      folders.push({
        ...fld,
        sourceCourseId: fld.courseId,
        courseId: unifiedCourse.id,
      });
    }
  }

  // Links: deduplicate by targetUrl
  const rawLinks = (syncResult.links || []).filter((lnk) => memberCourseIds.has(lnk.courseId));
  const seenLinkKeys = new Set<string>();
  const links: CourseLink[] = [];
  for (const lnk of rawLinks) {
    if (!seenLinkKeys.has(lnk.targetUrl)) {
      seenLinkKeys.add(lnk.targetUrl);
      links.push({
        ...lnk,
        sourceCourseId: lnk.courseId,
        courseId: unifiedCourse.id,
      });
    }
  }

  // Sections: preserve all unique section IDs across sub-courses
  const rawSections = (syncResult.sections || []).filter((sec) => memberCourseIds.has(sec.courseId));
  const seenSectionIds = new Set<number>();
  const sections: CourseSection[] = [];
  for (const sec of rawSections) {
    if (!seenSectionIds.has(sec.id)) {
      seenSectionIds.add(sec.id);
      sections.push({
        ...sec,
        sourceCourseId: sec.courseId,
        courseId: unifiedCourse.id,
      });
    }
  }

  // Announcements: deduplicate by id
  const rawAnnouncements = (syncResult.announcements || []).filter((ann) => memberCourseIds.has(ann.courseId));
  const seenAnnIds = new Set<number>();
  const announcements: CourseAnnouncement[] = [];
  for (const ann of rawAnnouncements) {
    if (!seenAnnIds.has(ann.id)) {
      seenAnnIds.add(ann.id);
      announcements.push({
        ...ann,
        courseId: unifiedCourse.id,
      });
    }
  }

  // Panopto Recordings: deduplicate by id
  const rawRecordings = (syncResult.recordings || []).filter((rec) => memberCourseIds.has(rec.courseId));
  const seenRecIds = new Set<string>();
  const recordings: PanoptoRecording[] = [];
  for (const rec of rawRecordings) {
    if (!seenRecIds.has(rec.id)) {
      seenRecIds.add(rec.id);
      recordings.push({
        ...rec,
        courseId: unifiedCourse.id,
      });
    }
  }

  // Grade Summary: merge items and prefer sub-course with authoritative courseTotal
  let gradeSummary: CourseGradeSummary | undefined = undefined;
  if (syncResult.gradeSummaries) {
    const memberSummaries = Array.from(memberCourseIds)
      .map((cid) => syncResult.gradeSummaries![cid])
      .filter((g): g is CourseGradeSummary => Boolean(g));
    if (memberSummaries.length > 0) {
      const primary = memberSummaries.find((g) => g.hasCourseTotal) || memberSummaries[0];
      const mergedItems = memberSummaries.flatMap((g) => g.items);
      gradeSummary = {
        ...primary,
        courseId: unifiedCourse.id,
        items: mergedItems,
      };
    }
  }

  return {
    assignments,
    files,
    meetings,
    folders,
    links,
    sections,
    announcements,
    recordings,
    gradeSummary,
  };
}
