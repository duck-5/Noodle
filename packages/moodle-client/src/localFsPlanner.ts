import {
  SyncResult,
  MoodleCourse,
  CourseSection,
  CourseFile,
  CourseFolder,
  Assignment,
} from './types.js';
import {
  groupEnrolledCourses,
  aggregateUnifiedCourseItems,
  cleanCourseDisplayName,
} from './courseGrouping.js';

const ILLEGAL_PATH_CHARS_REGEX = /[\\/:*?"<>|\x00-\x1f]/g;
const WINDOWS_RESERVED_NAME_REGEX = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

export interface PlannedLocalFile {
  moodleFileId: string;
  courseId: number;
  sourceCourseId: number;
  courseFolderName: string;
  relativePath: string;
  fileName: string;
  fileUrl: string;
  canonicalUrlPath: string;
  fileSize: number;
  timeModified: number;
  kind: 'resource' | 'folder' | 'assignment_attachment' | 'assignment_submission';
}

export interface LocalFsManifestLike {
  moodleFileId: string;
  relativePath: string;
  lastModified: number;
  size?: number;
  canonicalUrlPath?: string;
}

export interface LocalFsPlanOptions {
  trackedCourseIds?: number[];
  enrolledCourses?: MoodleCourse[];
  coursesCustomNames?: Record<number, string>;
  useCourseNicknames?: boolean;
  includeAssignments?: boolean;
  includeSubmissions?: boolean;
  existingCourseFolderNames?: Record<number, string>;
  existingManifest?: Record<string, LocalFsManifestLike>;
}

export interface LocalFsTreePlan {
  files: PlannedLocalFile[];
  courseFolderNames: Record<number, string>;
}

export type LocalFsDiffReason = 'new' | 'updated';

export interface LocalFsDiffItem {
  file: PlannedLocalFile;
  reason: LocalFsDiffReason;
}

export interface LocalFsDiffResult {
  toDownload: LocalFsDiffItem[];
  unchanged: LocalFsManifestLike[];
  skippedTooLarge: PlannedLocalFile[];
}

/**
 * Truncates a segment cleanly to maxLength while preserving a short file extension if present.
 */
function truncateSegmentPreservingExt(name: string, maxLength: number): string {
  if (name.length <= maxLength) return name;
  const dotIdx = name.lastIndexOf('.');
  if (dotIdx > 0 && name.length - dotIdx <= 12 && maxLength > name.length - dotIdx + 1) {
    const ext = name.slice(dotIdx);
    const base = name.slice(0, maxLength - ext.length).replace(/[. ]+$/, '');
    return `${base || '_'}${ext}`;
  }
  return name.slice(0, maxLength).replace(/[. ]+$/, '') || '_';
}

/**
 * Sanitizes a single directory or file name segment so it is valid across Windows, macOS, Linux,
 * Chromium File System Access API, and Firefox browser.downloads.download().
 */
export function sanitizePathSegment(segment: string, maxLength = 100): string {
  let clean = String(segment || '')
    .replace(ILLEGAL_PATH_CHARS_REGEX, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');

  if (!clean || clean === '.' || clean === '..' || /^\.+$/.test(clean)) {
    return '_';
  }

  if (WINDOWS_RESERVED_NAME_REGEX.test(clean)) {
    clean = `_${clean}`;
  }

  clean = truncateSegmentPreservingExt(clean, maxLength);
  if (WINDOWS_RESERVED_NAME_REGEX.test(clean)) {
    clean = `_${clean}`.slice(0, maxLength);
  }
  return clean || '_';
}

/**
 * Sanitizes a forward-slash relative path, stripping traversal sequences (.. / .),
 * sanitizing every segment, and bounding total path length.
 */
export function sanitizeRelativePath(relativePath: string, maxTotalLength = 210): string {
  const rawSegments = String(relativePath || '').replace(/\\/g, '/').split('/');
  const safeSegments: string[] = [];

  for (const raw of rawSegments) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === '.' || trimmed === '..') continue;
    safeSegments.push(sanitizePathSegment(trimmed));
  }

  if (safeSegments.length === 0) {
    return 'file';
  }

  let joined = safeSegments.join('/');
  if (joined.length <= maxTotalLength) {
    return joined;
  }

  // Proportionally trim intermediate directory segments first while keeping filename readable
  const lastIdx = safeSegments.length - 1;
  const fileSeg = truncateSegmentPreservingExt(safeSegments[lastIdx], Math.min(80, maxTotalLength));
  const dirSegments = safeSegments.slice(0, lastIdx);

  if (dirSegments.length === 0) {
    return fileSeg;
  }

  const budgetForDirs = Math.max(dirSegments.length * 8, maxTotalLength - fileSeg.length - 1);
  const perDirMax = Math.max(8, Math.floor((budgetForDirs - dirSegments.length) / dirSegments.length));
  const compactDirs = dirSegments.map((seg) => sanitizePathSegment(seg, perDirMax));
  joined = [...compactDirs, fileSeg].join('/');

  if (joined.length > maxTotalLength && compactDirs.length > 0) {
    const overflow = joined.length - maxTotalLength;
    const shortenedFile = truncateSegmentPreservingExt(
      fileSeg,
      Math.max(12, fileSeg.length - overflow)
    );
    joined = [...compactDirs, shortenedFile].join('/');
  }

  return joined;
}

/**
 * Extracts a stable URL path without volatile query tokens (?token=..., ?forcedownload=1).
 */
export function getCanonicalFileUrlPath(rawUrl: string): string {
  if (!rawUrl) return '';
  try {
    const parsed = new URL(rawUrl, 'https://moodle.tau.ac.il');
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return rawUrl.split('?')[0];
  }
}

function appendCollisionSuffix(relativePath: string, counter: number): string {
  const slashIdx = relativePath.lastIndexOf('/');
  const dirPrefix = slashIdx >= 0 ? relativePath.slice(0, slashIdx + 1) : '';
  const fileName = slashIdx >= 0 ? relativePath.slice(slashIdx + 1) : relativePath;
  const dotIdx = fileName.lastIndexOf('.');
  if (dotIdx > 0) {
    return `${dirPrefix}${fileName.slice(0, dotIdx)} (${counter})${fileName.slice(dotIdx)}`;
  }
  return `${dirPrefix}${fileName} (${counter})`;
}

function unifySyncResultForPlanning(
  syncResult: SyncResult,
  options?: LocalFsPlanOptions
): SyncResult {
  const enrolledCourses = options?.enrolledCourses;
  const trackedCourseIds = options?.trackedCourseIds;
  if (!enrolledCourses || enrolledCourses.length === 0 || !trackedCourseIds || trackedCourseIds.length === 0) {
    return syncResult;
  }

  const grouped = groupEnrolledCourses(enrolledCourses);
  const trackedSet = new Set(trackedCourseIds);
  const multiPortalGroups = grouped.academicCourses
    .filter((u) => u.subCourses.length > 1 && trackedSet.has(u.id))
    .map((u) => ({
      ...u,
      subCourses: u.subCourses.filter((s) => trackedSet.has(s.courseId)),
    }))
    .filter((u) => u.subCourses.length > 1);

  if (multiPortalGroups.length === 0) {
    return syncResult;
  }

  const childCourseIds = new Set<number>();
  for (const u of multiPortalGroups) {
    for (const s of u.subCourses) {
      if (s.courseId !== u.id) childCourseIds.add(s.courseId);
    }
  }
  if (childCourseIds.size === 0) {
    return syncResult;
  }

  let assignments = (syncResult.assignments || []).filter((a) => !childCourseIds.has(a.courseId));
  let files = (syncResult.files || []).filter((f) => !childCourseIds.has(f.courseId));
  let folders = (syncResult.folders || []).filter((fld) => !childCourseIds.has(fld.courseId));
  let sections = (syncResult.sections || []).filter((sec) => !childCourseIds.has(sec.courseId));

  for (const u of multiPortalGroups) {
    const agg = aggregateUnifiedCourseItems(u, syncResult);
    assignments = assignments.filter((a) => a.courseId !== u.id).concat(agg.assignments);
    files = files.filter((f) => f.courseId !== u.id).concat(agg.files);
    folders = folders.filter((fld) => fld.courseId !== u.id).concat(agg.folders);
    sections = sections.filter((sec) => sec.courseId !== u.id).concat(agg.sections);
  }

  return {
    ...syncResult,
    assignments,
    files,
    folders,
    sections,
  };
}

function resolveSectionPathSegments(
  sectionId: number | undefined,
  fallbackSectionName: string | undefined,
  sectionById: Map<number, CourseSection>
): string[] {
  if (sectionId !== undefined && sectionById.has(sectionId)) {
    const chain: string[] = [];
    const visited = new Set<number>();
    let cursor: CourseSection | undefined = sectionById.get(sectionId);
    while (cursor && !visited.has(cursor.id)) {
      visited.add(cursor.id);
      chain.unshift(sanitizePathSegment(cursor.name || 'General'));
      cursor =
        cursor.parentSectionId !== null && cursor.parentSectionId !== undefined
          ? sectionById.get(cursor.parentSectionId)
          : undefined;
    }
    if (chain.length > 0) {
      return chain;
    }
  }

  return [sanitizePathSegment(fallbackSectionName || 'General')];
}

/**
 * Builds a deterministic, cross-OS-safe mirrored directory tree plan from SyncResult.
 */
export function buildLocalFsTreePlan(
  syncResult: SyncResult,
  options: LocalFsPlanOptions = {}
): LocalFsTreePlan {
  const effectiveSync = unifySyncResultForPlanning(syncResult, options);
  const useNicknames = options.useCourseNicknames ?? true;
  const includeAssignments = options.includeAssignments ?? true;
  const includeSubmissions = options.includeSubmissions ?? false;
  const existingFolders = options.existingCourseFolderNames || {};
  const existingManifest = options.existingManifest || {};

  // Build course raw-name lookup
  const rawCourseNameById = new Map<number, string>();
  for (const c of options.enrolledCourses || []) {
    rawCourseNameById.set(c.id, cleanCourseDisplayName(c.fullname) || c.fullname || c.shortname);
  }
  for (const f of effectiveSync.files || []) {
    if (!rawCourseNameById.has(f.courseId) && f.courseName) {
      rawCourseNameById.set(f.courseId, cleanCourseDisplayName(f.courseName) || f.courseName);
    }
  }
  for (const fld of effectiveSync.folders || []) {
    if (!rawCourseNameById.has(fld.courseId) && fld.courseName) {
      rawCourseNameById.set(fld.courseId, cleanCourseDisplayName(fld.courseName) || fld.courseName);
    }
  }
  for (const a of effectiveSync.assignments || []) {
    if (!rawCourseNameById.has(a.courseId) && a.courseName) {
      rawCourseNameById.set(a.courseId, cleanCourseDisplayName(a.courseName) || a.courseName);
    }
  }

  // Discover all courseIds present in downloadable items
  const courseIdSet = new Set<number>();
  for (const f of effectiveSync.files || []) {
    if (!f.folderId && f.fileUrl) courseIdSet.add(f.courseId);
  }
  for (const fld of effectiveSync.folders || []) {
    if (fld.files?.length) courseIdSet.add(fld.courseId);
  }
  if (includeAssignments) {
    for (const a of effectiveSync.assignments || []) {
      if ((a.attachments && a.attachments.length > 0) || (includeSubmissions && a.submittedFiles?.length)) {
        courseIdSet.add(a.courseId);
      }
    }
  }

  // Assign deterministic, collision-free folder names per courseId
  const courseFolderNames: Record<number, string> = { ...existingFolders };
  const usedCourseFoldersLower = new Set<string>();
  const sortedCourseIds = Array.from(courseIdSet).sort((a, b) => a - b);

  for (const cId of sortedCourseIds) {
    const anchored = existingFolders[cId];
    let candidate = anchored ? sanitizePathSegment(anchored) : '';

    if (!candidate) {
      const nickname = useNicknames ? options.coursesCustomNames?.[cId]?.trim() : '';
      const rawName = nickname || rawCourseNameById.get(cId) || `Course ${cId}`;
      candidate = sanitizePathSegment(rawName);
    }

    if (usedCourseFoldersLower.has(candidate.toLowerCase())) {
      candidate = sanitizePathSegment(`${candidate} (${cId})`);
    }
    usedCourseFoldersLower.add(candidate.toLowerCase());
    courseFolderNames[cId] = candidate;
  }

  // Index sections by ID for 2-level hierarchy resolution
  const sectionById = new Map<number, CourseSection>();
  for (const sec of effectiveSync.sections || []) {
    sectionById.set(sec.id, sec);
  }

  const planned: PlannedLocalFile[] = [];
  const seenFileIds = new Set<string>();
  const usedPathsLower = new Set<string>();

  const registerItem = (
    moodleFileId: string,
    courseId: number,
    sourceCourseId: number,
    courseFolderName: string,
    segments: string[],
    rawFileName: string,
    fileUrl: string,
    fileSize: number,
    timeModified: number,
    kind: PlannedLocalFile['kind']
  ) => {
    if (!fileUrl || seenFileIds.has(moodleFileId)) return;
    seenFileIds.add(moodleFileId);

    const safeFileName = sanitizePathSegment(rawFileName || 'file');
    let relPath = sanitizeRelativePath([courseFolderName, ...segments, safeFileName].join('/'));

    // Preserve prior non-colliding path if already tracked in manifest
    const prev = existingManifest[moodleFileId];
    if (prev?.relativePath) {
      const cleanPrev = sanitizeRelativePath(prev.relativePath);
      if (cleanPrev && !usedPathsLower.has(cleanPrev.toLowerCase())) {
        relPath = cleanPrev;
      }
    }

    let candidate = relPath;
    let counter = 2;
    while (usedPathsLower.has(candidate.toLowerCase())) {
      candidate = appendCollisionSuffix(relPath, counter++);
    }
    usedPathsLower.add(candidate.toLowerCase());

    const finalFileName = candidate.slice(candidate.lastIndexOf('/') + 1);
    planned.push({
      moodleFileId,
      courseId,
      sourceCourseId,
      courseFolderName,
      relativePath: candidate,
      fileName: finalFileName,
      fileUrl,
      canonicalUrlPath: getCanonicalFileUrlPath(fileUrl),
      fileSize: Math.max(0, Number(fileSize) || 0),
      timeModified: Math.max(0, Number(timeModified) || 0),
      kind,
    });
  };

  // 1. Standalone resource files (exclude folderId files to avoid CR-09 duplication)
  const standaloneFiles: CourseFile[] = (effectiveSync.files || []).filter(
    (f) => !f.folderId && Boolean(f.fileUrl)
  );
  for (const f of standaloneFiles) {
    const courseFolder = courseFolderNames[f.courseId];
    if (!courseFolder) continue;
    const srcCourseId = f.sourceCourseId ?? f.courseId;
    const sectionSegs = resolveSectionPathSegments(f.sectionId, f.sectionName, sectionById);
    const moodleFileId = `res:${srcCourseId}:${f.id ?? 0}:${f.fileName}`;
    registerItem(
      moodleFileId,
      f.courseId,
      srcCourseId,
      courseFolder,
      sectionSegs,
      f.fileName,
      f.fileUrl,
      f.fileSize,
      f.timeModified,
      'resource'
    );
  }

  // 2. Moodle folder modules (mod_folder) with internal relativePath hierarchy
  const folders: CourseFolder[] = effectiveSync.folders || [];
  for (const fld of folders) {
    const courseFolder = courseFolderNames[fld.courseId];
    if (!courseFolder) continue;
    const srcCourseId = fld.sourceCourseId ?? fld.courseId;
    const sectionSegs = resolveSectionPathSegments(fld.sectionId, fld.sectionName, sectionById);
    const folderSeg = sanitizePathSegment(fld.name || `Folder ${fld.id}`);

    for (const ff of fld.files || []) {
      if (!ff.fileUrl) continue;
      const innerRelSegs = (ff.relativePath || '')
        .replace(/\\/g, '/')
        .split('/')
        .map((s) => s.trim())
        .filter((s) => s !== '' && s !== '.' && s !== '..')
        .map((s) => sanitizePathSegment(s));
      const moodleFileId = `fld:${srcCourseId}:${fld.id}:${ff.relativePath || ''}:${ff.fileName}`;
      registerItem(
        moodleFileId,
        fld.courseId,
        srcCourseId,
        courseFolder,
        [...sectionSegs, folderSeg, ...innerRelSegs],
        ff.fileName,
        ff.fileUrl,
        ff.fileSize,
        ff.timeModified,
        'folder'
      );
    }
  }

  // 3. Assignment attachments & optional student submissions
  if (includeAssignments) {
    const assigns: Assignment[] = effectiveSync.assignments || [];
    for (const a of assigns) {
      const courseFolder = courseFolderNames[a.courseId];
      if (!courseFolder) continue;
      const srcCourseId = a.sourceCourseId ?? a.courseId;
      const sectionSegs = resolveSectionPathSegments(a.sectionId, a.sectionName, sectionById);
      const assignSeg = sanitizePathSegment(a.name || `Assignment ${a.id}`);

      for (const att of a.attachments || []) {
        if (!att.url) continue;
        const moodleFileId = `asg_att:${srcCourseId}:${a.id}:${att.name}`;
        registerItem(
          moodleFileId,
          a.courseId,
          srcCourseId,
          courseFolder,
          [...sectionSegs, assignSeg],
          att.name,
          att.url,
          att.fileSize || 0,
          att.timeModified || 0,
          'assignment_attachment'
        );
      }

      if (includeSubmissions && a.submittedFiles) {
        for (const sub of a.submittedFiles) {
          if (!sub.url) continue;
          const moodleFileId = `asg_sub:${srcCourseId}:${a.id}:${sub.name}`;
          registerItem(
            moodleFileId,
            a.courseId,
            srcCourseId,
            courseFolder,
            [...sectionSegs, assignSeg, 'Submitted'],
            sub.name,
            sub.url,
            sub.fileSize || 0,
            sub.timeModified || 0,
            'assignment_submission'
          );
        }
      }
    }
  }

  return {
    files: planned,
    courseFolderNames,
  };
}

/**
 * Compares the desired tree plan against the persisted local FS manifest to isolate
 * newly added and modified files while enforcing maxFileSizeMb bounds.
 */
export function planLocalFsDiff(
  plan: LocalFsTreePlan,
  existingManifest: Record<string, LocalFsManifestLike>,
  options: { maxFileSizeMb?: number } = {}
): LocalFsDiffResult {
  const maxBytes =
    options.maxFileSizeMb && options.maxFileSizeMb > 0
      ? options.maxFileSizeMb * 1024 * 1024
      : Infinity;

  const toDownload: LocalFsDiffItem[] = [];
  const unchanged: LocalFsManifestLike[] = [];
  const skippedTooLarge: PlannedLocalFile[] = [];

  for (const file of plan.files) {
    if (file.fileSize > 0 && file.fileSize > maxBytes) {
      skippedTooLarge.push(file);
      continue;
    }

    const prev = existingManifest[file.moodleFileId];
    if (!prev) {
      toDownload.push({ file, reason: 'new' });
      continue;
    }

    const isTimeNewer = file.timeModified > 0 && file.timeModified > (prev.lastModified || 0);
    const isSizeChanged =
      file.fileSize > 0 && Boolean(prev.size) && prev.size! > 0 && file.fileSize !== prev.size;
    const isUrlChanged =
      Boolean(prev.canonicalUrlPath) &&
      Boolean(file.canonicalUrlPath) &&
      prev.canonicalUrlPath !== file.canonicalUrlPath;

    if (isTimeNewer || isSizeChanged || isUrlChanged) {
      toDownload.push({ file, reason: 'updated' });
    } else {
      unchanged.push(prev);
    }
  }

  return {
    toDownload,
    unchanged,
    skippedTooLarge,
  };
}

