import { MoodleClient, RawCourseModule, RawCourseSection, RawGradeItem, RawMoodleAssignment, RawMoodleQuiz } from './moodleApi.js';
import {
  SyncResult,
  Assignment,
  CourseFile,
  CourseSection,
  CourseFolder,
  CourseFolderFile,
  CourseLink,
  CourseAnnouncement,
  CourseGradeSummary,
  CourseGradeItem,
  ZoomMeeting,
  PanoptoRecording,
  CourseStaffMember,
  CoursePanoptoStaffEntry,
  SyncError,
  MoodleCredentials,
  Attachment,
} from './types.js';
import { fetchCourseFormatState, fetchSesskeyFromJar, ParsedCourseFormatState } from './courseFormatState.js';
import { groupEnrolledCourses } from './courseGrouping.js';
import { buildAuthenticatedFileUrl } from './zipBuilder.js';
import { parseTauCourseMetadata } from './courseParser.js';
import { SmartProgressCalculator, SyncProgressState } from './syncProgress.js';
import { CookieJar, scrapeZoomMeetingsWithToken, isZoomUrl, isZoomJoinUrl, isZoomOrMeetingName, parseZoomUrl, extractZoomLinksFromHtml, decodeHTMLEntities } from './zoomScraper.js';
import { CookieAdapter, FetchFn, isBrowserEnvironment } from './runtimeEnv.js';
import {
  PANOPTO_BASE_URL,
  PanoptoRequestOptions,
  isPanoptoUrl,
  isPanoptoModuleName,
  extractPanoptoFolderId,
  extractPanoptoDeliveryId,
  buildPanoptoFolderUrl,
  buildPanoptoViewerUrl,
  extractPanoptoFromCourseHtml,
  classifyRecordingType,
  classifyRecordingWithSource,
  ClassifyRecordingOptions,
  fetchCourseStaffFromParticipantsPage,
  filterAndDeduplicateRecordings,
  ensurePanoptoAuthenticated,
  ensureMoodleWebSessionWithCreds,
  resolvePanoptoViaLti,
  discoverPanoptoFromMoodleBlocks,
  resolveFolderIdFromDelivery,
  fetchPanoptoFolderSessions,
  discoverCourseFolderFromBrowse,
} from './panoptoScraper.js';

export function cleanMoodleString(raw: string, lang: 'he' | 'en' = 'he'): string {
  if (!raw) return '';
  let str = raw;
  if (str.includes('class="multilang"') || str.includes("class='multilang'")) {
    const langMatch = str.match(new RegExp(`<span[^>]*\\blang=["']${lang}["'][^>]*>([\\s\\S]*?)<\\/span>`, 'i'));
    if (langMatch && langMatch[1]) {
      str = langMatch[1];
    } else {
      const anyMatch = str.match(/<span[^>]*\bclass=["']multilang["'][^>]*>([\s\S]*?)<\/span>/i);
      if (anyMatch && anyMatch[1]) {
        str = anyMatch[1];
      }
    }
  }
  str = str.replace(/<[^>]+>/g, '');
  return decodeHTMLEntities(str).trim();
}

// Dependency-free batch promise runner to limit concurrency and avoid Moodle rate limits
async function batchPromises<T, R>(
  items: T[],
  batchSize: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

/**
 * Checks whether an assignment has an active grace period (cutoffDate strictly after deadline).
 */
export function hasGracePeriod(assignment: { deadline: string | null; cutoffDate?: string | null }): boolean {
  if (!assignment.deadline || !assignment.cutoffDate) return false;
  return new Date(assignment.cutoffDate).getTime() > new Date(assignment.deadline).getTime();
}

/**
 * Determines whether a Moodle course module or activity is locked/restricted for the current user
 * (e.g. group restriction "זמין רק למי ש: שייך ל קבוצה 4" or `uservisible === false`).
 */
export function isCourseModuleLocked(
  module: Pick<RawCourseModule, 'id' | 'visible' | 'uservisible' | 'availabilityinfo' | 'url'>,
  section?: Pick<RawCourseSection, 'visible' | 'uservisible' | 'availabilityinfo'> | null,
  formatState?: ParsedCourseFormatState | null
): boolean {
  if (module.uservisible === false) return true;
  if (module.visible === 0 && module.uservisible !== true) return true;
  if (formatState?.lockedCmids?.has(Number(module.id))) {
    return true;
  }
  const hasExplicitUnlockedAccess = module.uservisible === true && Boolean(module.url);
  if (!hasExplicitUnlockedAccess) {
    if (typeof module.availabilityinfo === 'string' && module.availabilityinfo.trim().length > 0) {
      return true;
    }
    if (section) {
      if (section.uservisible === false) return true;
      if (typeof section.availabilityinfo === 'string' && section.availabilityinfo.trim().length > 0) {
        return true;
      }
    }
  } else if (section?.uservisible === false) {
    return true;
  }
  return false;
}

export interface RunSyncOptions {
  /** @deprecated Legacy Web Scraping fallback option (removed from extension Settings UI; pure REST/AJAX is standard). */
  enableScraping?: boolean;
  enablePanopto?: boolean;
  coursesPanoptoMap?: Record<number, string>;
  coursesPanoptoStaff?: Record<number, CoursePanoptoStaffEntry[]>;
  /** Previously cached Moodle course staff (skipped from re-fetching when present, including cached empty arrays). */
  cachedCourseStaff?: Record<number, CourseStaffMember[]>;
  onEnsurePanoptoAuth?: (forceRefresh?: boolean) => Promise<boolean>;
  lang?: 'he' | 'en';
  userAgent?: string;
  fetch?: FetchFn;
  cookieAdapter?: CookieAdapter;
  cookieJar?: CookieJar;
  panoptoJar?: CookieJar;
  useNativeCookies?: boolean;
  timeoutMs?: number;
}

export type SyncOptions = RunSyncOptions;

export async function runSync(
  token: string,
  trackedCourseIds: number[],
  onProgress: (message: string, progress?: number | SyncProgressState) => void,
  baseUrl?: string,
  creds?: MoodleCredentials,
  moodleCookies?: string,
  sesskey?: string,
  onPartialSync?: (partial: Partial<SyncResult>) => void,
  options?: RunSyncOptions
): Promise<SyncResult> {
  const enableScraping = options?.enableScraping ?? false;
  const enablePanopto = options?.enablePanopto ?? false;
  const coursesPanoptoMap = options?.coursesPanoptoMap || {};
  const coursesPanoptoStaff = options?.coursesPanoptoStaff || {};
  const requestOpts: PanoptoRequestOptions = {
    ...(options?.fetch ? { fetch: options.fetch } : {}),
    ...(options?.cookieAdapter ? { cookieAdapter: options.cookieAdapter } : {}),
    ...(options?.userAgent !== undefined ? { userAgent: options.userAgent } : {}),
    ...(options?.useNativeCookies !== undefined ? { useNativeCookies: options.useNativeCookies } : {}),
    ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  };
  const client = new MoodleClient(token, baseUrl, {
    sesskey,
    devMode: false,
    enableScraping,
    lang: options?.lang,
    userAgent: options?.userAgent,
    fetch: options?.fetch,
    cookieAdapter: options?.cookieAdapter,
  });
  const errors: SyncError[] = [];
  const assignments: Assignment[] = [];
  const files: CourseFile[] = [];
  const meetings: ZoomMeeting[] = [];
  const recordings: PanoptoRecording[] = [];
  const folders: CourseFolder[] = [];
  const links: CourseLink[] = [];
  const sections: CourseSection[] = [];
  const announcements: CourseAnnouncement[] = [];
  const gradeSummaries: Record<number, CourseGradeSummary> = {};
  const courseStaff: Record<number, CourseStaffMember[]> = {};
  const discoveredPanoptoFolders: Record<number, string> = {};

  let scrapedMeetingsJar: CookieJar | null = null;
  let scrapeJarPromise: Promise<CookieJar | null> | null = null;
  let adapterFallbackJar: CookieJar | null = null;
  let fallbackPanoptoJar: CookieJar | null = null;
  let panoptoAuthPromise: Promise<boolean> | null = null;

  const getScrapeJar = async (): Promise<CookieJar | null> => {
    if (scrapedMeetingsJar) return scrapedMeetingsJar;

    const isBrowser = isBrowserEnvironment();
    if (isBrowser) {
      const jar = new CookieJar();
      if (moodleCookies) jar.ingestCookieHeader(moodleCookies);
      scrapedMeetingsJar = jar;
      return jar;
    }

    if (options?.cookieJar) {
      if (moodleCookies) options.cookieJar.ingestCookieHeader(moodleCookies);
      scrapedMeetingsJar = options.cookieJar;
      return options.cookieJar;
    }

    if (moodleCookies) {
      const jar = new CookieJar();
      jar.ingestCookieHeader(moodleCookies);
      scrapedMeetingsJar = jar;
      return jar;
    }

    if (!enableScraping && !enablePanopto && !creds) return null;
    if (scrapeJarPromise) return scrapeJarPromise;

    if (creds) {
      scrapeJarPromise = (async () => {
        const jar = new CookieJar();
        try {
          const ok = await ensureMoodleWebSessionWithCreds(
            baseUrl || 'https://moodle.tau.ac.il',
            creds,
            jar,
            requestOpts
          );
          if (ok || Object.keys(jar.toRecord()).length > 0) {
            scrapedMeetingsJar = jar;
            return jar;
          }
          return null;
        } catch (err: any) {
          errors.push({
            context: 'SSO Login for Zoom/Panopto Scraping',
            message: err?.message || 'Failed to establish Moodle web session',
          });
          return null;
        }
      })();
      return scrapeJarPromise;
    }
    return null;
  };

  const getPanoptoJar = async (): Promise<CookieJar> => {
    if (options?.panoptoJar) return options.panoptoJar;
    return (await getScrapeJar()) ?? (fallbackPanoptoJar ??= new CookieJar());
  };

  let didForcePanoptoReauth = false;
  let panoptoSessionVerified = false;

  const ensurePanoptoSession = async (jar: CookieJar | null, forceRefresh = false): Promise<boolean> => {
    if (options?.onEnsurePanoptoAuth) {
      if (forceRefresh) {
        if (didForcePanoptoReauth && panoptoAuthPromise) {
          return panoptoAuthPromise;
        }
        didForcePanoptoReauth = true;
        panoptoAuthPromise = options.onEnsurePanoptoAuth(true).catch(() => false);
      } else if (!panoptoAuthPromise) {
        panoptoAuthPromise = options.onEnsurePanoptoAuth(false).catch(() => false);
      }
      return panoptoAuthPromise;
    }
    if (!panoptoAuthPromise) {
      panoptoAuthPromise = ensurePanoptoAuthenticated(
        PANOPTO_BASE_URL,
        baseUrl || 'https://moodle.tau.ac.il',
        jar,
        creds,
        { ...requestOpts, sampleCourseId: trackedCourseIds[0] }
      ).catch(() => false);
    }
    return panoptoAuthPromise;
  };

  const progress = new SmartProgressCalculator(
    trackedCourseIds.length,
    (msg, state) => {
      onProgress(msg, state);
    },
    enablePanopto
      ? {
        initTarget: 5,
        mappingTarget: 12,
        globalQueriesTarget: 22,
        coursesTarget: 55,
        activitiesTarget: 75,
        panoptoTarget: 95,
        finalizingTarget: 98,
      }
      : undefined
  );
  progress.start('Fetching Moodle user info...');
  let userId: number;

  try {
    const siteInfo = await client.getSiteInfo();
    userId = siteInfo.userid;
    progress.setSiteInfoDone();
  } catch (err: any) {
    if (err.errorcode || err.name === 'MoodleApiError') {
      throw err;
    }
    throw new Error(`Failed to fetch initial data from Moodle: ${err.message}`);
  }

  if (trackedCourseIds.length === 0) {
    progress.complete('Sync completed.');
    return {
      assignments: [],
      files: [],
      meetings: [],
      recordings: [],
      errors: [],
      syncedAt: new Date().toISOString(),
    };
  }

  const courseMap = new Map<number, {
    display_name: string;
    name: string;
    courseCode?: string;
    year?: string;
    instanceUrl?: string;
    format?: string;
    coursecategory?: string;
  }>();
  const courseGroupAliases = new Map<number, number[]>();
  try {
    const courses = await client.getEnrolledCourses(userId);
    for (const c of courses) {
      const shortname = c.shortname || '';
      const parts = shortname.split('-');
      const courseIdExtracted = parts.length >= 2 ? parts[0].trim() : String(c.id);

      let display_name = shortname;
      if (parts.length >= 2) {
        const englishPart = parts[parts.length - 1].trim();
        display_name = `${courseIdExtracted} - ${englishPart}`;
      }

      courseMap.set(c.id, {
        display_name,
        name: c.fullname,
        courseCode: c.idnumber || courseIdExtracted,
        year: c.year,
        instanceUrl: c.instanceUrl,
      });
    }
    try {
      const normalizedCourses = courses.map((c) => {
        const meta = parseTauCourseMetadata(c.idnumber || c.shortname || c.fullname || '');
        return {
          id: c.id,
          courseId: meta?.courseCode || c.idnumber || c.shortname || String(c.id),
          shortname: c.shortname || '',
          fullname: c.fullname || '',
          idnumber: c.idnumber,
          semester: meta?.semester || 'Other',
          year: meta?.year || (c.year !== undefined ? String(c.year) : ''),
        };
      });
      const grouped = groupEnrolledCourses(normalizedCourses);
      for (const u of grouped.academicCourses) {
        const memberIds = Array.from(new Set([u.id, ...u.subCourses.map((s) => s.courseId)]));
        if (memberIds.length > 1) {
          for (const mid of memberIds) {
            courseGroupAliases.set(mid, memberIds);
          }
        }
      }
    } catch {
      // Non-fatal if grouping fails on partial mock courses
    }
  } catch (err: any) {
    errors.push({
      context: 'Fetching enrolled courses',
      message: err.message,
    });
  } finally {
    progress.setCourseMappingDone('Course catalog loaded.');
  }

  const getCourseDisplayName = (moodleCourseId: number, rawNameFromAssign?: string): string => {
    const mapVal = courseMap.get(moodleCourseId);
    if (mapVal) return mapVal.display_name;
    return rawNameFromAssign || `Course ${moodleCourseId}`;
  };

  let rawAssignments: RawMoodleAssignment[] = [];
  let rawQuizzes: RawMoodleQuiz[] = [];
  const rawOrderMap = new Map<string, number>();
  let nextOrderIndex = 0;
  const gradesByCmid = new Map<number, RawGradeItem>();
  const moduleCompletionMap = new Map<number, { completion?: number; completiondata?: any }>();
  const isBrowserEnv = isBrowserEnvironment();

  await Promise.all([
    (async () => {
      try {
        const assignmentsResp = await client.getAssignments(trackedCourseIds);
        for (const courseObj of assignmentsResp.courses) {
          if (trackedCourseIds.includes(courseObj.id)) {
            for (const assign of courseObj.assignments) {
              const alreadyHas = rawAssignments.some(
                (a) =>
                  (assign.id && a.id === assign.id && a.course === courseObj.id) ||
                  (assign.cmid && a.cmid && a.cmid === assign.cmid)
              );
              if (!alreadyHas) {
                rawAssignments.push(assign);
                const uid = `assign:${assign.id}`;
                if (!rawOrderMap.has(uid)) {
                  rawOrderMap.set(uid, nextOrderIndex++);
                }
              }
            }
          }
        }
      } catch (err: any) {
        errors.push({
          context: 'Processing assignments',
          message: err.message,
        });
      }
    })(),
    (async () => {
      try {
        const quizzes = await client.getQuizzes(trackedCourseIds);
        rawQuizzes = quizzes || [];
        for (const q of rawQuizzes) {
          const uid = `quiz:${q.id}`;
          if (!rawOrderMap.has(uid)) {
            rawOrderMap.set(uid, nextOrderIndex++);
          }
        }
      } catch (err: any) {
        errors.push({
          context: 'Processing quizzes',
          message: err.message,
        });
      }
    })(),
    batchPromises(trackedCourseIds, isBrowserEnv ? 100 : 12, async (courseId) => {
      try {
        const gradesResp = await client.getGradeItems(courseId, userId);
        for (const userGrade of gradesResp.usergrades) {
          const cId = userGrade.courseid;
          let courseTotalFormatted: string | null = null;
          let courseTotalRaw: number | null = null;
          let courseTotalMax: number | null = null;
          let hasCourseTotal = false;
          const items: CourseGradeItem[] = [];

          for (const item of userGrade.gradeitems) {
            if (item.itemtype === 'course') {
              hasCourseTotal = true;
              courseTotalFormatted = item.gradeformatted || null;
              courseTotalRaw = item.graderaw;
              courseTotalMax = item.grademax;
            }

            const isBonus = /בונוס|bonus/i.test(item.itemname || '');

            if (item.itemtype === 'mod' && item.cmid !== null) {
              gradesByCmid.set(Number(item.cmid), item);
            }

            items.push({
              cmid: item.cmid !== null ? Number(item.cmid) : null,
              itemName: cleanMoodleString(item.itemname || ''),
              itemType: item.itemtype,
              itemModule: item.itemmodule,
              gradeFormatted: item.gradeformatted || '-',
              gradeRaw: item.graderaw,
              gradeMax: item.grademax,
              isBonus,
              feedback: item.feedback ? cleanMoodleString(item.feedback) : undefined,
            });
          }

          gradeSummaries[cId] = {
            courseId: cId,
            courseTotalFormatted,
            courseTotalRaw,
            courseTotalMax,
            hasCourseTotal,
            items,
          };
        }
      } catch (err: any) {
        errors.push({
          context: `Fetching grades for course ${courseId}`,
          message: err.message,
        });
      }
    })
  ]);
  progress.setGlobalQueriesDone('Global activities and grades loaded.');
  progress.setTotalCourses(trackedCourseIds.length);
  const cmidToSectionMap = new Map<number, string>();
  const cmidToSectionIdMap = new Map<number, number>();
  const lockedCmids = new Set<number>();
  const lockedActivityUids = new Set<string>();
  const now = new Date();
  const seenProcessedAssignKeys = new Set<string>();
  const seenProcessedQuizKeys = new Set<string>();

  const isRestrictionErrorMessage = (msg: string | undefined): boolean => {
    if (!msg) return false;
    return /requireloginerror|nopermission|restricted|not available|not accessible|אינו זמין|זמין רק למי/i.test(msg);
  };

  const processAssignment = async (assign: RawMoodleAssignment, sectionName?: string) => {
    const key = assign.cmid ? `cmid:${assign.cmid}` : `id:${assign.course}:${assign.id}`;
    if (seenProcessedAssignKeys.has(key)) return;
    seenProcessedAssignKeys.add(key);
    if (assign.cmid) seenProcessedAssignKeys.add(`cmid:${assign.cmid}`);
    if (assign.id) seenProcessedAssignKeys.add(`id:${assign.course}:${assign.id}`);
    let subStatus = 'new';
    let extensionDueDate = 0;
    let submittedFiles: Attachment[] | undefined = undefined;

    const uid = `assign:${assign.id}`;
    let isLocked =
      assign.uservisible === false ||
      (assign.visible === 0 && assign.uservisible !== true) ||
      Boolean(assign.availabilityinfo && String(assign.availabilityinfo).trim().length > 0) ||
      (Boolean(assign.cmid) && lockedCmids.has(Number(assign.cmid))) ||
      lockedActivityUids.has(uid);

    if (!isLocked) {
      try {
        const statusResp = await client.getSubmissionStatus(assign.id, assign.cmid);
        if (statusResp._scraperIntroAttachments && statusResp._scraperIntroAttachments.length > 0) {
          assign.introattachments = statusResp._scraperIntroAttachments;
        }
        subStatus = statusResp.lastattempt?.submission?.status || 'new';
        extensionDueDate = statusResp.lastattempt?.extensionduedate || 0;

        const plugins = statusResp.lastattempt?.submission?.plugins;
        if (plugins) {
          const filePlugin = plugins.find(p => p.type === 'file');
          if (filePlugin && filePlugin.fileareas) {
            const submissionArea = filePlugin.fileareas.find(a => a.area === 'submission_files');
            if (submissionArea && submissionArea.files) {
              submittedFiles = submissionArea.files.map(f => ({
                name: f.filename,
                url: f.fileurl,
                ...(typeof f.filesize === 'number' ? { fileSize: f.filesize } : {}),
                ...(typeof f.timemodified === 'number' ? { timeModified: f.timemodified } : {}),
              }));
            }
          }
        }
      } catch (err: any) {
        if (isRestrictionErrorMessage(err?.message || err?.errorcode)) {
          isLocked = true;
        } else {
          errors.push({
            context: `Fetching submission status for assignment ${assign.name} (id: ${assign.id})`,
            message: err.message,
          });
        }
      }
    }

    const assignCmid = assign.cmid;
    const completionInfo = moduleCompletionMap.get(assignCmid);
    const effectiveCompletion = completionInfo?.completion ?? assign.completion;
    const effectiveCompletionData = completionInfo?.completiondata ?? assign.completiondata;
    const requiresManualCompletion = effectiveCompletion === 1;
    const isManualCompletionDone = Boolean(effectiveCompletionData?.state === 1);
    const isAutomaticCompletionDone =
      effectiveCompletion === 2 &&
      (effectiveCompletionData?.state === 1 || effectiveCompletionData?.state === 2);

    const gradeInfo = gradesByCmid.get(Number(assign.cmid));
    let grade: number | null = null;
    let gradeMax: number | null = null;
    let feedback: string | undefined = undefined;
    let isBonus = /בונוס|bonus/i.test(assign.name || '');

    if (gradeInfo && !gradeInfo.gradeishidden) {
      grade = gradeInfo.graderaw;
      gradeMax = gradeInfo.grademax;
      if (gradeInfo.feedback) feedback = cleanMoodleString(gradeInfo.feedback);
      if (/בונוס|bonus/i.test(gradeInfo.itemname || '')) {
        isBonus = true;
      }
    }

    const hasGrade = grade !== null && grade !== undefined;

    let status: 'Assigned' | 'Submitted' | 'Not submitted' =
      (subStatus === 'submitted' || hasGrade || isAutomaticCompletionDone || (requiresManualCompletion && isManualCompletionDone))
        ? 'Submitted'
        : 'Assigned';

    const dueTs = assign.duedate || 0;
    const cutoffTs = assign.cutoffdate || 0;
    const extTs = extensionDueDate || 0;

    // True Deadline resolution:
    // 1. Personal extension (extensionduedate) takes absolute precedence
    // 2. Otherwise, official nominal due date (duedate) is the deadline
    // 3. Cutoff date is only used as a fallback if no duedate was set
    const finalDeadlineTs = extTs > 0
      ? extTs
      : (dueTs > 0 ? dueTs : cutoffTs);

    let deadlineIso: string | null = null;

    if (finalDeadlineTs > 0) {
      const deadlineDate = new Date(finalDeadlineTs * 1000);
      deadlineIso = deadlineDate.toISOString();
      if (status !== 'Submitted' && deadlineDate < now) {
        status = 'Not submitted';
      }
    }

    // Grace period / late submission cutoff date:
    // Set if cutoffdate is present and later than the effective deadline
    const cutoffDateIso = (cutoffTs > 0 && cutoffTs > finalDeadlineTs)
      ? new Date(cutoffTs * 1000).toISOString()
      : null;

    const openedIso = assign.allowsubmissionsfromdate > 0
      ? new Date(assign.allowsubmissionsfromdate * 1000).toISOString()
      : null;

    let attachments: Attachment[] = assign.introattachments
      ? assign.introattachments.map((att) => ({
        name: att.filename,
        url: att.fileurl,
        ...(typeof att.filesize === 'number' ? { fileSize: att.filesize } : {}),
        ...(typeof att.timemodified === 'number' ? { timeModified: att.timemodified } : {}),
      }))
      : [];

    if (attachments.length === 0 && assign.intro) {
      const links = assign.intro.matchAll(/href="([^"]*pluginfile\.php[^"]*)"[^>]*>([^<]+)<\/a>/gi);
      for (const linkMatch of links) {
        attachments.push({
          url: linkMatch[1].replace(/&amp;/g, '&'),
          name: linkMatch[2].trim()
        });
      }
    }

    const courseInfo = courseMap.get(assign.course);
    const assignBaseUrl = courseInfo?.instanceUrl
      ? courseInfo.instanceUrl
      : courseInfo?.year && courseInfo.year !== String(new Date().getFullYear())
        ? `https://moodle.tau.ac.il/${courseInfo.year}`
        : 'https://moodle.tau.ac.il';

    const processedAssign: Assignment = {
      id: assign.id,
      cmid: assign.cmid,
      courseId: assign.course,
      courseName: getCourseDisplayName(assign.course),
      name: cleanMoodleString(assign.name || ''),
      status,
      submittedFiles,
      deadline: deadlineIso,
      cutoffDate: cutoffDateIso,
      opened: openedIso,
      link: `${assignBaseUrl}/mod/assign/view.php?id=${assign.cmid}`,
      grade,
      gradeMax,
      attachments,
      sectionId: cmidToSectionIdMap.get(Number(assign.cmid)),
      sectionName: sectionName || cmidToSectionMap.get(Number(assign.cmid)),
      activityType: 'assign',
      uid: `assign:${assign.id}`,
      requiresManualCompletion,
      isManualCompletionDone: isManualCompletionDone || isAutomaticCompletionDone,
      completionTracking: effectiveCompletion,
      isCompleted: status === 'Submitted',
      feedback,
      isBonus,
      ...(isLocked && status !== 'Submitted' && !hasGrade ? { isHidden: true } : {}),
    };

    assignments.push(processedAssign);
    progress.activityCompleted(assign.name);
  };

  const processQuiz = async (quiz: RawMoodleQuiz, sectionName?: string) => {
    const key = quiz.coursemodule ? `cmid:${quiz.coursemodule}` : `id:${quiz.course}:${quiz.id}`;
    if (seenProcessedQuizKeys.has(key)) return;
    seenProcessedQuizKeys.add(key);
    if (quiz.coursemodule) seenProcessedQuizKeys.add(`cmid:${quiz.coursemodule}`);
    if (quiz.id) seenProcessedQuizKeys.add(`id:${quiz.course}:${quiz.id}`);

    const uid = `quiz:${quiz.id}`;
    let isLocked =
      quiz.uservisible === false ||
      (quiz.visible === 0 && quiz.uservisible !== true) ||
      Boolean(quiz.availabilityinfo && String(quiz.availabilityinfo).trim().length > 0) ||
      (Boolean(quiz.coursemodule) && lockedCmids.has(Number(quiz.coursemodule))) ||
      lockedActivityUids.has(uid);

    let hasFinished = false;
    if (!isLocked) {
      try {
        const attempts = await client.getQuizAttempts(quiz.id);
        hasFinished = attempts.some((att) => att.state === 'finished');
      } catch (err: any) {
        if (isRestrictionErrorMessage(err?.message || err?.errorcode)) {
          isLocked = true;
        } else {
          errors.push({
            context: `Fetching attempts for quiz ${quiz.name} (id: ${quiz.id})`,
            message: err.message,
          });
        }
      }
    }

    const cmid = quiz.coursemodule;
    const completionInfo = moduleCompletionMap.get(cmid);
    const effectiveCompletion = completionInfo?.completion ?? quiz.completion;
    const effectiveCompletionData = completionInfo?.completiondata ?? quiz.completiondata;
    const requiresManualCompletion = effectiveCompletion === 1;
    const isManualCompletionDone = Boolean(effectiveCompletionData?.state === 1);
    const isAutomaticCompletionDone =
      effectiveCompletion === 2 &&
      (effectiveCompletionData?.state === 1 || effectiveCompletionData?.state === 2);

    const gradeInfo = gradesByCmid.get(Number(cmid));
    let grade: number | null = null;
    let gradeMax: number | null = null;
    let feedback: string | undefined = undefined;
    let isBonus = /בונוס|bonus/i.test(quiz.name || '');
    if (gradeInfo && !gradeInfo.gradeishidden) {
      grade = gradeInfo.graderaw;
      gradeMax = gradeInfo.grademax;
      if (gradeInfo.feedback) feedback = cleanMoodleString(gradeInfo.feedback);
      if (/בונוס|bonus/i.test(gradeInfo.itemname || '')) {
        isBonus = true;
      }
    } else if (quiz.sumgrades !== undefined && quiz.sumgrades !== null) {
      gradeMax = quiz.sumgrades;
    }

    const hasGrade = grade !== null && grade !== undefined;

    let status: 'Assigned' | 'Submitted' | 'Not submitted' = 'Assigned';
    if (hasFinished || hasGrade || isAutomaticCompletionDone || (requiresManualCompletion && isManualCompletionDone)) {
      status = 'Submitted';
    }

    const closeTs = quiz.timeclose || 0;
    let deadlineIso: string | null = null;
    if (closeTs > 0) {
      const closeDate = new Date(closeTs * 1000);
      deadlineIso = closeDate.toISOString();
      if (status !== 'Submitted' && closeDate < now) {
        status = 'Not submitted';
      }
    }

    const openTs = quiz.timeopen || 0;
    const openedIso = openTs > 0 ? new Date(openTs * 1000).toISOString() : null;

    const courseInfo = courseMap.get(quiz.course);
    const quizBaseUrl = courseInfo?.instanceUrl
      ? courseInfo.instanceUrl
      : courseInfo?.year && courseInfo.year !== String(new Date().getFullYear())
        ? `https://moodle.tau.ac.il/${courseInfo.year}`
        : 'https://moodle.tau.ac.il';

    const processedQuiz: Assignment = {
      id: quiz.id,
      cmid: quiz.coursemodule,
      courseId: quiz.course,
      courseName: getCourseDisplayName(quiz.course),
      name: cleanMoodleString(quiz.name || ''),
      status,
      deadline: deadlineIso,
      cutoffDate: null,
      opened: openedIso,
      link: `${quizBaseUrl}/mod/quiz/view.php?id=${quiz.coursemodule}`,
      grade,
      gradeMax,
      feedback,
      isBonus: isBonus || undefined,
      sectionId: cmidToSectionIdMap.get(Number(quiz.coursemodule)),
      sectionName: sectionName || cmidToSectionMap.get(Number(quiz.coursemodule)),
      activityType: 'quiz',
      uid: `quiz:${quiz.id}`,
      timeLimitSeconds: quiz.timelimit > 0 ? quiz.timelimit : undefined,
      attemptsAllowed: quiz.attempts > 0 ? quiz.attempts : undefined,
      hasFinishedAttempt: hasFinished,
      requiresManualCompletion,
      isManualCompletionDone: isManualCompletionDone || isAutomaticCompletionDone,
      completionTracking: effectiveCompletion,
      isCompleted: status === 'Submitted',
      ...(isLocked && status !== 'Submitted' && !hasGrade ? { isHidden: true } : {}),
    };

    assignments.push(processedQuiz);
    progress.activityCompleted(quiz.name);
  };

  const coursePanoptoMetadataMap = new Map<number, {
    courseId: number;
    courseName: string;
    courseBaseUrl: string;
    courseInfo?: any;
    discoveredPanoptoFolderIds: string[];
    discoveredPanoptoDeliveries: { id: string; title: string; recordingUrl: string; sectionName?: string }[];
    discoveredPanoptoLtiInstances: number[];
  }>();

  const normalizeBaseUrl = (url: string): string => url.replace(/\/+$/, '');
  const formatSesskeyCache = new Map<string, Promise<string | null>>();
  const allZoomScrapeTasks: Array<() => Promise<void>> = [];

  // Stage 1: Fetch course contents & format state first so cmidToSectionMap,
  // cmidToSectionIdMap, moduleCompletionMap, and fallback activities are populated
  await batchPromises(trackedCourseIds, isBrowserEnv ? 20 : 12, async (courseId) => {
    const courseName = getCourseDisplayName(courseId);
    const courseInfo = courseMap.get(courseId);
    const courseBaseUrl = courseInfo?.instanceUrl
      ? courseInfo.instanceUrl
      : courseInfo?.year && courseInfo.year !== String(new Date().getFullYear())
        ? `https://moodle.tau.ac.il/${courseInfo.year}`
        : (baseUrl || 'https://moodle.tau.ac.il');

    const seenMeetingKeys = new Set<string>();
    const courseSectionNames: string[] = [];
    const discoveredPanoptoFolderIds: string[] = [];
    const discoveredPanoptoDeliveries: { id: string; title: string; recordingUrl: string; sectionName?: string }[] = [];
    const discoveredPanoptoLtiInstances: number[] = [];

    const addDiscoveredFolderId = (fid: string | null) => {
      if (fid && !discoveredPanoptoFolderIds.includes(fid)) {
        discoveredPanoptoFolderIds.push(fid);
      }
    };

    const addDiscoveredDelivery = (id: string, title: string, recordingUrl: string, sectionName?: string) => {
      if (id && !discoveredPanoptoDeliveries.some(d => d.id === id)) {
        discoveredPanoptoDeliveries.push({ id, title, recordingUrl, sectionName });
      }
    };

    const scanHtmlForPanopto = (html: string, sectionName?: string, fallbackTitle?: string) => {
      if (!enablePanopto || !html) return;
      const extracted = extractPanoptoFromCourseHtml(html);
      for (const fid of extracted.folderIds) {
        addDiscoveredFolderId(fid);
      }
      for (const del of extracted.deliveries) {
        addDiscoveredDelivery(del.id, del.title || fallbackTitle || '', del.recordingUrl, sectionName);
      }
    };

    const addMeeting = (m: ZoomMeeting) => {
      // Strictly guarantee only real, joinable Zoom meetings are registered as Zoom meetings
      if (!m.meetingUrl || !isZoomJoinUrl(m.meetingUrl, m.meetingNumber)) return;
      const key = m.startTime
        ? `${courseId}:${m.meetingNumber || m.meetingUrl}:${m.startTime}`
        : `${courseId}:${m.meetingNumber || m.meetingUrl}`;
      if (seenMeetingKeys.has(key)) return;
      seenMeetingKeys.add(key);
      meetings.push(m);
    };

    try {
      const rawSectionsPromise = client.getCourseContents(courseId);
      const formatStatePromise: Promise<ParsedCourseFormatState | null> = (async () => {
        const isBrowser = isBrowserEnvironment();
        const hasFormatCookies = Boolean(options?.cookieJar || moodleCookies);
        const useNative = options?.useNativeCookies === true;
        // Do NOT trigger a 14-round-trip NIDP login just because `creds` is present
        if (!isBrowser && !hasFormatCookies && !options?.cookieAdapter && !useNative) {
          return null;
        }

        let formatJar: CookieJar | undefined;
        if (!isBrowser && (hasFormatCookies || Boolean(options?.cookieAdapter) || useNative)) {
          formatJar =
            (hasFormatCookies ? (await getScrapeJar()) : null) ??
            (options?.cookieAdapter || useNative ? (adapterFallbackJar ??= new CookieJar()) : undefined);
        }

        let effectiveFormatSesskey = sesskey;
        if (!effectiveFormatSesskey && !isBrowser && formatJar) {
          const normalizedCourseBaseUrl = normalizeBaseUrl(courseBaseUrl);
          let sesskeyPromise = formatSesskeyCache.get(normalizedCourseBaseUrl);
          if (!sesskeyPromise) {
            sesskeyPromise = fetchSesskeyFromJar(formatJar, normalizedCourseBaseUrl, requestOpts);
            formatSesskeyCache.set(normalizedCourseBaseUrl, sesskeyPromise);
          }
          effectiveFormatSesskey = (await sesskeyPromise) ?? undefined;
        }

        if (effectiveFormatSesskey) {
          try {
            const effectiveFormatJar =
              formatJar ?? (!isBrowser && (options?.cookieAdapter || useNative) ? (adapterFallbackJar ??= new CookieJar()) : undefined);
            return await fetchCourseFormatState({
              instanceBaseUrl: courseBaseUrl,
              courseId,
              sesskey: effectiveFormatSesskey,
              ...(effectiveFormatJar ? { jar: effectiveFormatJar } : {}),
              ...(options?.fetch ? { fetch: options.fetch } : {}),
              ...(options?.cookieAdapter ? { cookieAdapter: options.cookieAdapter } : {}),
              ...(options?.useNativeCookies !== undefined ? { useNativeCookies: options.useNativeCookies } : {}),
            });
          } catch {
            // Non-critical, fallback to flat sections
          }
        }
        return null;
      })();

      const [rawSections, formatState] = await Promise.all([rawSectionsPromise, formatStatePromise]);
      // Map Moodle 4.5+ mod_subsection modules to their delegated child sections
      const subsectionParentBySectionId = new Map<number, number>();
      const subsectionParentByTitle = new Map<string, number>();
      for (const sec of rawSections) {
        for (const mod of sec.modules || []) {
          if (mod.modname === 'subsection') {
            if (mod.customdata) {
              try {
                const cd = typeof mod.customdata === 'string' ? JSON.parse(mod.customdata) : mod.customdata;
                const targetSecId = Number(cd?.sectionid || cd?.section);
                if (!isNaN(targetSecId) && targetSecId > 0) {
                  subsectionParentBySectionId.set(targetSecId, sec.id);
                }
              } catch {
                // Ignore JSON parse error and fallback to title
              }
            }
            if (mod.name) {
              subsectionParentByTitle.set(cleanMoodleString(mod.name), sec.id);
            }
          }
        }
      }

      for (const section of rawSections) {
        const sectionName = cleanMoodleString(section.name || '');
        if (sectionName && !courseSectionNames.includes(sectionName)) {
          courseSectionNames.push(sectionName);
        }

        const secState = formatState?.sections.get(section.id);
        const isSubMod = (section as any).component === 'mod_subsection' ||
          subsectionParentBySectionId.has(section.id) ||
          subsectionParentByTitle.has(sectionName);
        const inferredParentId = secState?.parentSectionId ??
          subsectionParentBySectionId.get(section.id) ??
          subsectionParentByTitle.get(sectionName) ??
          null;
        sections.push({
          id: section.id,
          courseId,
          sectionNumber: section.section ?? 0,
          name: sectionName || (section.section === 0 ? 'כללי' : `נושא ${section.section}`),
          summaryHtml: section.summary ? cleanMoodleString(section.summary) : undefined,
          parentSectionId: inferredParentId,
          level: (secState?.level === 1 || inferredParentId !== null || isSubMod) ? 1 : 0,
          isSubsectionModule: isSubMod || undefined,
          sectionUrl: secState?.sectionUrl || `${courseBaseUrl}/course/view.php?id=${courseId}&section=${section.section}`,
          visible: (section as any).uservisible !== undefined
            ? Boolean((section as any).uservisible)
            : (section.visible !== undefined ? section.visible !== 0 || Boolean(isSubMod) || ((section.modules?.length ?? 0) > 0) : true),
        });

        // 1. Scan section summary for embedded Zoom & Panopto links
        if (section.summary) {
          const summaryLinks = extractZoomLinksFromHtml(section.summary);
          for (const link of summaryLinks) {
            const parsed = parseZoomUrl(link.url);
            addMeeting({
              title: link.title || `${sectionName} Zoom`,
              meetingUrl: parsed.meetingUrl,
              sectionName,
              courseId,
              courseName,
              meetingNumber: parsed.meetingNumber,
              password: parsed.password,
            });
          }
          scanHtmlForPanopto(section.summary, sectionName);
        }

        for (const module of section.modules) {
          const modname = module.modname;
          const name = module.name || '';

          // Scan module URL / contents / description / intro for Panopto links if enabled
          if (enablePanopto) {
            const candidateUrls: string[] = [];
            if (module.url) candidateUrls.push(module.url);
            if (module.contents) {
              for (const c of module.contents) {
                if (c.fileurl) candidateUrls.push(c.fileurl);
              }
            }
            for (const u of candidateUrls) {
              if (isPanoptoUrl(u)) {
                const fid = extractPanoptoFolderId(u);
                if (fid) addDiscoveredFolderId(fid);
                const did = extractPanoptoDeliveryId(u);
                if (did) addDiscoveredDelivery(did, name, buildPanoptoViewerUrl(did), sectionName);
              }
            }
            if (module.description) scanHtmlForPanopto(module.description, sectionName, name);
            if (module.intro) scanHtmlForPanopto(module.intro, sectionName, name);
            if (
              modname === 'lti' &&
              module.instance !== undefined &&
              !isZoomOrMeetingName(name) &&
              (isPanoptoModuleName(name) || isPanoptoUrl(module.url || ''))
            ) {
              if (!discoveredPanoptoLtiInstances.includes(module.instance)) {
                discoveredPanoptoLtiInstances.push(module.instance);
              }
            }
          }

          if (modname === 'forum') {
            const ANNOUNCEMENTS_REGEX = /לוח\s+מודעות|הודעות\s+הקורס|הודעות\s+ודרשות|announcements|news\s+forum/i;
            if (ANNOUNCEMENTS_REGEX.test(name)) {
              announcements.push({
                id: module.id,
                courseId,
                name: cleanMoodleString(name),
                moodleUrl: `${courseBaseUrl}/mod/forum/view.php?id=${module.id}`,
              });
            }
          }

          if (modname === 'quiz') {
            cmidToSectionMap.set(module.id, sectionName);
            cmidToSectionIdMap.set(module.id, section.id);
            const moduleLocked = isCourseModuleLocked(module, section, formatState);
            if (moduleLocked) {
              lockedCmids.add(module.id);
            }
            if (module.completion !== undefined || module.completiondata) {
              moduleCompletionMap.set(module.id, {
                completion: module.completion,
                completiondata: module.completiondata,
              });
            }
            const modOpenTs =
              module.dates?.find((d) => d.dataid === 'timeopen' || /open|נפתח/i.test(d.label || ''))?.timestamp || 0;
            const modCloseTs =
              module.dates?.find(
                (d) => d.dataid === 'timeclose' || d.dataid === 'duedate' || /close|due|מסתיים|נסגר/i.test(d.label || '')
              )?.timestamp || 0;
            const existingQuiz = rawQuizzes.find(
              (q) =>
                (module.instance && q.id === module.instance) ||
                (q.coursemodule && q.coursemodule === module.id) ||
                (q.course === courseId && q.name === name)
            );
            if (existingQuiz) {
              if (!existingQuiz.coursemodule) {
                existingQuiz.coursemodule = module.id;
              }
              if (!existingQuiz.timeopen && modOpenTs > 0) existingQuiz.timeopen = modOpenTs;
              if (!existingQuiz.timeclose && modCloseTs > 0) existingQuiz.timeclose = modCloseTs;
              if (moduleLocked) {
                existingQuiz.uservisible = false;
                if (module.availabilityinfo) existingQuiz.availabilityinfo = module.availabilityinfo;
                lockedActivityUids.add(`quiz:${existingQuiz.id}`);
              }
            } else {
              const synthQuiz: RawMoodleQuiz = {
                id: module.instance || module.id,
                course: courseId,
                coursemodule: module.id,
                name: name,
                timeopen: modOpenTs,
                timeclose: modCloseTs,
                timelimit: 0,
                attempts: 0,
                visible: module.visible,
                uservisible: moduleLocked ? false : module.uservisible,
                availabilityinfo: module.availabilityinfo,
                completion: module.completion,
                completiondata: module.completiondata,
              };
              const uid = `quiz:${synthQuiz.id}`;
              if (moduleLocked) {
                lockedActivityUids.add(uid);
              }
              if (!rawOrderMap.has(uid)) {
                rawOrderMap.set(uid, nextOrderIndex++);
              }
              rawQuizzes.push(synthQuiz);
            }
          }

          if (modname === 'assign') {
            cmidToSectionMap.set(module.id, sectionName);
            cmidToSectionIdMap.set(module.id, section.id);
            const moduleLocked = isCourseModuleLocked(module, section, formatState);
            if (moduleLocked) {
              lockedCmids.add(module.id);
            }
            if (module.completion !== undefined || module.completiondata) {
              moduleCompletionMap.set(module.id, {
                completion: module.completion,
                completiondata: module.completiondata,
              });
            }
            const modDueTs =
              module.dates?.find(
                (d) => d.dataid === 'duedate' || /due|מסתיים|מועד הגשה/i.test(d.label || '')
              )?.timestamp || 0;
            const modCutoffTs =
              module.dates?.find((d) => d.dataid === 'cutoffdate')?.timestamp || 0;
            const modOpenTs =
              module.dates?.find(
                (d) => d.dataid === 'allowsubmissionsfromdate' || /open|נפתח/i.test(d.label || '')
              )?.timestamp || 0;
            const existingAssign = rawAssignments.find(
              (a) =>
                (module.instance && a.id === module.instance) ||
                (a.cmid && a.cmid === module.id) ||
                (a.course === courseId && a.name === name)
            );
            if (existingAssign) {
              if (!existingAssign.cmid) {
                existingAssign.cmid = module.id;
              }
              if (!existingAssign.duedate && modDueTs > 0) existingAssign.duedate = modDueTs;
              if (!existingAssign.cutoffdate && modCutoffTs > 0) existingAssign.cutoffdate = modCutoffTs;
              if (!existingAssign.allowsubmissionsfromdate && modOpenTs > 0) {
                existingAssign.allowsubmissionsfromdate = modOpenTs;
              }
              if (moduleLocked) {
                existingAssign.uservisible = false;
                if (module.availabilityinfo) existingAssign.availabilityinfo = module.availabilityinfo;
                lockedActivityUids.add(`assign:${existingAssign.id}`);
              }
            } else {
              const newAssign: RawMoodleAssignment = {
                id: module.instance || module.id,
                cmid: module.id,
                course: courseId,
                name: name,
                duedate: modDueTs,
                cutoffdate: modCutoffTs,
                allowsubmissionsfromdate: modOpenTs,
                visible: module.visible,
                uservisible: moduleLocked ? false : module.uservisible,
                availabilityinfo: module.availabilityinfo,
                dates: module.dates,
              };
              const uid = `assign:${newAssign.id}`;
              if (moduleLocked) {
                lockedActivityUids.add(uid);
              }
              if (!rawOrderMap.has(uid)) {
                rawOrderMap.set(uid, nextOrderIndex++);
              }
              rawAssignments.push(newAssign);
            }
          }

          if (modname === 'resource' && module.contents) {
            for (const content of module.contents) {
              if (content.type === 'file') {
                const newFile: CourseFile = {
                  id: module.id,
                  fileName: content.filename || '',
                  fileUrl: content.fileurl || '',
                  fileSize: content.filesize || 0,
                  mimeType: content.mimetype || 'application/octet-stream',
                  sectionId: section.id,
                  sectionNumber: section.section,
                  sectionName,
                  timeModified: content.timemodified || 0,
                  courseId,
                  courseName,
                };
                files.push(newFile);
              }
            }
          }

          // --- FOLDER DETECTION (mod_folder) ---
          if (modname === 'folder') {
            const folderFiles: CourseFolderFile[] = [];
            let totalFolderSize = 0;
            if (Array.isArray(module.contents)) {
              for (const c of module.contents) {
                if (c.type === 'file') {
                  const fileSize = c.filesize || 0;
                  totalFolderSize += fileSize;
                  folderFiles.push({
                    fileName: c.filename || '',
                    relativePath: c.filepath ? c.filepath.replace(/^\/+/, '') : '',
                    fileSize,
                    fileUrl: c.fileurl || '',
                    downloadUrl: buildAuthenticatedFileUrl(c.fileurl || '', token),
                    timeModified: c.timemodified || 0,
                    mimeType: c.mimetype || 'application/octet-stream',
                  });

                  files.push({
                    id: module.id,
                    fileName: c.filename || '',
                    fileUrl: c.fileurl || '',
                    downloadUrl: buildAuthenticatedFileUrl(c.fileurl || '', token),
                    fileSize,
                    mimeType: c.mimetype || 'application/octet-stream',
                    sectionId: section.id,
                    sectionNumber: section.section,
                    sectionName,
                    folderId: module.id,
                    folderName: name,
                    relativePath: c.filepath ? c.filepath.replace(/^\/+/, '') : '',
                    timeModified: c.timemodified || 0,
                    courseId,
                    courseName,
                  });
                }
              }
            }

            const newFolder: CourseFolder = {
              id: module.id,
              instanceId: module.instance || module.id,
              courseId,
              courseName,
              sectionId: section.id,
              sectionName,
              name: cleanMoodleString(name),
              descriptionHtml: module.description ? cleanMoodleString(module.description) : undefined,
              moodleUrl: `${courseBaseUrl}/mod/folder/view.php?id=${module.id}`,
              files: folderFiles,
              totalSize: totalFolderSize,
            };
            folders.push(newFolder);
          }

          // --- EXTERNAL LINK DETECTION (mod_url) ---
          if (modname === 'url') {
            const targetUrl = module.contents?.[0]?.fileurl || module.url || '';
            let linkKind: 'zoom' | 'panopto' | 'drive' | 'github' | 'external' = 'external';
            if (isZoomUrl(targetUrl)) linkKind = 'zoom';
            else if (isPanoptoUrl(targetUrl)) linkKind = 'panopto';
            else if (/drive\.google\.com/i.test(targetUrl)) linkKind = 'drive';
            else if (/github\.com/i.test(targetUrl)) linkKind = 'github';

            if (targetUrl) {
              links.push({
                id: module.id,
                courseId,
                courseName,
                sectionId: section.id,
                sectionName,
                name: cleanMoodleString(name),
                targetUrl,
                moodleUrl: `${courseBaseUrl}/mod/url/view.php?id=${module.id}`,
                linkKind,
              });
            }
          }

          // --- ZOOM MEETING DETECTION ---
          // A. Zoom Activity (mod_zoom or Zoom LTI Pro mod_lti)
          const isZoomActivity = modname === 'zoom' || (modname === 'lti' && isZoomOrMeetingName(name));

          if (isZoomActivity) {
            const targetUrl = module.url || `${courseBaseUrl}/mod/${modname}/view.php?id=${module.id}`;
            links.push({
              id: module.id,
              courseId,
              courseName,
              sectionId: section.id,
              sectionName,
              name: cleanMoodleString(name),
              targetUrl,
              moodleUrl: `${courseBaseUrl}/mod/${modname}/view.php?id=${module.id}`,
              linkKind: 'zoom',
            });

            // 1. Direct contents or URLs
            if (module.contents && module.contents.length > 0) {
              for (const c of module.contents) {
                if (c.fileurl && isZoomUrl(c.fileurl)) {
                  const parsed = parseZoomUrl(c.fileurl);
                  addMeeting({
                    title: c.filename || name,
                    meetingUrl: parsed.meetingUrl,
                    sectionName,
                    courseId,
                    courseName,
                    meetingNumber: parsed.meetingNumber,
                    password: parsed.password,
                  });
                }
                if (c.content) {
                  const extracted = extractZoomLinksFromHtml(c.content);
                  for (const el of extracted) {
                    const parsed = parseZoomUrl(el.url);
                    addMeeting({
                      title: el.title || name,
                      meetingUrl: parsed.meetingUrl,
                      sectionName,
                      courseId,
                      courseName,
                      meetingNumber: parsed.meetingNumber,
                      password: parsed.password,
                    });
                  }
                }
              }
            }
            if (module.url && isZoomUrl(module.url)) {
              const parsed = parseZoomUrl(module.url);
              addMeeting({
                title: name,
                meetingUrl: parsed.meetingUrl,
                sectionName,
                courseId,
                courseName,
                meetingNumber: parsed.meetingNumber,
                password: parsed.password,
              });
            }
            if (module.description || module.intro) {
              const extracted = extractZoomLinksFromHtml(`${module.description || ''} ${module.intro || ''}`);
              for (const el of extracted) {
                const parsed = parseZoomUrl(el.url);
                addMeeting({
                  title: el.title || name,
                  meetingUrl: parsed.meetingUrl,
                  sectionName,
                  courseId,
                  courseName,
                  meetingNumber: parsed.meetingNumber,
                  password: parsed.password,
                });
              }
            }

            // 2. Queue activity meeting scraping (mod_zoom view page, Zoom table, LTI launch)
            if (module.instance !== undefined || module.id !== undefined) {
              const targetModInstanceOrId = module.instance ?? module.id;
              const targetModId = module.id;
              const targetSectionName = sectionName;
              const targetModName = modname;
              const targetName = name;
              allZoomScrapeTasks.push(async () => {
                try {
                  const scrapeJar = await getScrapeJar();
                  const ltiMeetings = await scrapeZoomMeetingsWithToken(
                    token,
                    targetModInstanceOrId,
                    courseBaseUrl,
                    targetModId,
                    scrapeJar,
                    targetModName,
                    {
                      ...requestOpts,
                      ...(options?.userAgent !== undefined ? { userAgent: options.userAgent } : {}),
                    }
                  );
                  if (ltiMeetings.length > 0) {
                    for (const lm of ltiMeetings) {
                      addMeeting({
                        title: lm.topic || targetName,
                        meetingUrl: lm.joinUrl,
                        sectionName: targetSectionName,
                        courseId,
                        courseName,
                        startTime: lm.startTime,
                        meetingNumber: lm.meetingNumber,
                        password: lm.password,
                      });
                    }
                  }
                } catch (err: any) {
                  console.warn(`[SyncEngine] Failed to scrape Zoom meetings for course ${courseName} (module ID: ${targetModId}):`, err);
                  errors.push({
                    context: `Scraping Zoom meetings for course ${courseName} (module ID: ${targetModId})`,
                    message: err.message,
                  });
                }
              });
            }
          }

          // C. URL Module (mod_url)
          else if (modname === 'url') {
            let directUrl = '';
            if (module.contents && module.contents.length > 0) {
              const zoomContent = module.contents.find(c => c.fileurl && isZoomUrl(c.fileurl));
              if (zoomContent?.fileurl) {
                directUrl = zoomContent.fileurl;
              }
            }

            if (!directUrl && isZoomUrl(module.url || '')) {
              directUrl = module.url!;
            }

            if (directUrl && isZoomUrl(directUrl)) {
              const parsed = parseZoomUrl(directUrl);
              addMeeting({
                title: name,
                meetingUrl: parsed.meetingUrl,
                sectionName,
                courseId,
                courseName,
                meetingNumber: parsed.meetingNumber,
                password: parsed.password,
              });
            }
          }

          // D. Labels, Pages, Resources, or Module Descriptions/Intros with embedded Zoom links
          else {
            const htmlSources: string[] = [];
            if (module.description) htmlSources.push(module.description);
            if (module.intro) htmlSources.push(module.intro);
            if (modname === 'label' || modname === 'page' || modname === 'resource') {
              if (name && isZoomUrl(name)) htmlSources.push(name);
              if (module.contents) {
                for (const c of module.contents) {
                  if (c.fileurl && isZoomUrl(c.fileurl)) {
                    htmlSources.push(c.fileurl);
                  }
                  if (c.content) {
                    htmlSources.push(c.content);
                  }
                }
              }
            }

            for (const html of htmlSources) {
              const foundLinks = extractZoomLinksFromHtml(html);
              for (const fl of foundLinks) {
                const parsed = parseZoomUrl(fl.url);
                addMeeting({
                  title: fl.title || name || `${sectionName} Zoom`,
                  meetingUrl: parsed.meetingUrl,
                  sectionName,
                  courseId,
                  courseName,
                  meetingNumber: parsed.meetingNumber,
                  password: parsed.password,
                });
              }
            }
          }
        }
      }
    } catch (err: any) {
      errors.push({
        context: `Fetching contents for course ${courseName} (id: ${courseId})`,
        message: err.message,
      });
    }

    // Collect discovered Panopto metadata in-memory for Stage 3 (no blocking network calls)
    if (enablePanopto) {
      coursePanoptoMetadataMap.set(courseId, {
        courseId,
        courseName,
        courseBaseUrl,
        courseInfo,
        discoveredPanoptoFolderIds,
        discoveredPanoptoDeliveries,
        discoveredPanoptoLtiInstances,
      });
    }
    progress.courseCompleted(courseName);
  });

  // Level 1 Complete: Emit all course contents, files, folders, links, sections, and direct meetings atomically
  if (onPartialSync) {
    onPartialSync({
      files: [...files],
      folders: [...folders],
      links: [...links],
      meetings: [...meetings],
      sections: [...sections],
      announcements: [...announcements],
    });
  }

  // Stage 2: Process all assignments, quizzes, and deferred Zoom LTI/view scraping concurrently
  // (decoupled from Level 1 emit, with bounded concurrency on mobile/non-browser runtimes)
  const stage2AssignBatch = isBrowserEnv ? 50 : 12;
  const stage2QuizBatch = isBrowserEnv ? 30 : 12;
  progress.setTotalActivities(rawAssignments.length, rawQuizzes.length);
  await Promise.all([
    batchPromises(rawAssignments, stage2AssignBatch, async (assign) => {
      await processAssignment(assign);
    }),
    batchPromises(rawQuizzes, stage2QuizBatch, async (quiz) => {
      await processQuiz(quiz);
    }),
    allZoomScrapeTasks.length > 0
      ? batchPromises(allZoomScrapeTasks, 6, (fn) => fn())
      : Promise.resolve(),
  ]);

  // Sync sectionName for known assignments in case contents finished after assignment processed
  for (const assign of assignments) {
    if (!assign.sectionName) {
      const secName = cmidToSectionMap.get(Number(assign.cmid));
      if (secName) assign.sectionName = secName;
    }
  }

  // Level 2 Complete: Emit all assignments, quizzes, grade summaries, and any LTI-scraped Zoom meetings atomically
  if (onPartialSync) {
    onPartialSync({
      assignments: [...assignments],
      gradeSummaries: { ...gradeSummaries },
      ...(allZoomScrapeTasks.length > 0 ? { meetings: [...meetings] } : {}),
    });
  }

  // Stage 3: Dedicated Panopto Recordings Discovery & Sync (isolated from core Moodle content)
  if (enablePanopto && trackedCourseIds.length > 0) {
    progress.setTotalPanoptoCourses(trackedCourseIds.length);
    let initialPanoptoAuthed = false;
    let panoptoAuthErrorReported = false;
    let activeBlockSesskey: string | undefined = sesskey || undefined;
    const rootMoodleUrl = normalizeBaseUrl(baseUrl || 'https://moodle.tau.ac.il');
    try {
      const initialJar = await getPanoptoJar();
      if (!activeBlockSesskey && (options?.useNativeCookies || options?.cookieAdapter || Object.keys(initialJar.toRecord()).length > 0)) {
        let cachedSesskeyPromise = formatSesskeyCache.get(rootMoodleUrl);
        if (!cachedSesskeyPromise) {
          cachedSesskeyPromise = fetchSesskeyFromJar(initialJar, rootMoodleUrl, requestOpts);
          formatSesskeyCache.set(rootMoodleUrl, cachedSesskeyPromise);
        }
        activeBlockSesskey = (await cachedSesskeyPromise) || undefined;
      }
      initialPanoptoAuthed = await ensurePanoptoSession(initialJar);
    } catch {
      // Individual course sync will handle fallback/errors if needed
    }

    // Pre-populate Moodle course staff across tracked courses so grouped parent/child courses
    // can share staff mappings even when Stage 3 processes courses concurrently.
    await batchPromises(trackedCourseIds, 8, async (courseId) => {
      const panoptoMeta = coursePanoptoMetadataMap.get(courseId);
      const courseBaseUrl = panoptoMeta?.courseBaseUrl || (baseUrl || 'https://moodle.tau.ac.il');
      try {
        const cachedForCourse =
          options?.cachedCourseStaff?.[courseId] ??
          (options?.cachedCourseStaff as Record<string, CourseStaffMember[]> | undefined)?.[String(courseId)];
        let moodleStaff: CourseStaffMember[] = [];
        if (Array.isArray(cachedForCourse)) {
          moodleStaff = cachedForCourse;
        } else {
          moodleStaff = await client.getCourseStaff(courseId);
          if (moodleStaff.length === 0) {
            const jar = await getScrapeJar();
            moodleStaff = await fetchCourseStaffFromParticipantsPage(
              courseId,
              courseBaseUrl,
              sesskey,
              jar,
              creds,
              requestOpts
            );
          }
        }
        // Cache both positive and negative (empty) checked results so restricted courses
        // do not re-scrape Participants HTML on every sync.
        courseStaff[courseId] = moodleStaff;
      } catch (staffErr) {
        console.warn(`[SyncEngine][Panopto] Course staff fetch skipped for ${courseId}:`, staffErr);
      }
    });

    await batchPromises(trackedCourseIds, 4, async (courseId) => {
      const panoptoMeta = coursePanoptoMetadataMap.get(courseId);
      const courseName = panoptoMeta?.courseName || getCourseDisplayName(courseId);
      const courseInfo = panoptoMeta?.courseInfo || courseMap.get(courseId);
      const courseBaseUrl = panoptoMeta?.courseBaseUrl || (baseUrl || 'https://moodle.tau.ac.il');
      const discoveredPanoptoFolderIds = panoptoMeta?.discoveredPanoptoFolderIds || [];
      const discoveredPanoptoDeliveries = panoptoMeta?.discoveredPanoptoDeliveries || [];
      const discoveredPanoptoLtiInstances = panoptoMeta?.discoveredPanoptoLtiInstances || [];

      try {
        const panoptoJar = await getPanoptoJar();
        let resolvedFolderId: string | null = null;
        let resolutionTier = 'none';
        const ltiRecordings: PanoptoRecording[] = [];
        let didRunLti = false;

        const moodleStaff: CourseStaffMember[] = courseStaff[courseId] || [];
        const groupIds = courseGroupAliases.get(courseId) || [courseId];
        const staffEntries: CoursePanoptoStaffEntry[] = [];
        const mergedMoodleStaff: CourseStaffMember[] = [...moodleStaff];
        for (const gid of groupIds) {
          const configured =
            coursesPanoptoStaff[gid] ??
            (coursesPanoptoStaff as Record<string, CoursePanoptoStaffEntry[]>)[String(gid)];
          if (Array.isArray(configured)) {
            staffEntries.push(...configured);
          }
          if (gid !== courseId && Array.isArray(courseStaff[gid])) {
            mergedMoodleStaff.push(...courseStaff[gid]);
          }
        }
        const classificationOptions: ClassifyRecordingOptions = {
          staffEntries,
          moodleStaff: mergedMoodleStaff,
        };

        await ensurePanoptoSession(panoptoJar);

        // Tier 1: Manual override
        const rawManual =
          coursesPanoptoMap[courseId] ??
          (coursesPanoptoMap as Record<string, string>)[String(courseId)] ??
          '';
        const manualOverride = String(rawManual).trim();
        if (manualOverride) {
          resolvedFolderId = extractPanoptoFolderId(manualOverride);
          if (!resolvedFolderId) {
            const manualDeliveryId = extractPanoptoDeliveryId(manualOverride);
            if (manualDeliveryId) {
              resolvedFolderId = await resolveFolderIdFromDelivery(manualDeliveryId, PANOPTO_BASE_URL, panoptoJar, requestOpts);
            }
          }
          if (resolvedFolderId) {
            resolutionTier = 'Tier 1 (Manual Override)';
          } else {
            console.warn(
              `[SyncEngine][Panopto] Course "${courseName}" (${courseId}): Could not extract folder UUID from manual override "${manualOverride}"`
            );
            errors.push({
              context: `Panopto (${courseName})`,
              message: `Invalid Panopto folder URL or UUID: "${manualOverride}"`,
            });
          }
        }

        // Tier 2A: Discovered folder links from Moodle course modules/HTML
        if (!resolvedFolderId && discoveredPanoptoFolderIds.length > 0) {
          resolvedFolderId = discoveredPanoptoFolderIds[0];
          resolutionTier = 'Tier 2A (Moodle Course Modules)';
        }

        // Tier 2B: Pure REST mod_lti_get_tool_launch_data + signed OAuth POST (also establishes .ASPXAUTH)
        if (!resolvedFolderId && discoveredPanoptoLtiInstances.length > 0) {
          didRunLti = true;
          for (const ltiInstanceId of discoveredPanoptoLtiInstances) {
            const ltiResult = await resolvePanoptoViaLti(
              token,
              ltiInstanceId,
              courseId,
              courseName,
              courseBaseUrl,
              PANOPTO_BASE_URL,
              panoptoJar,
              requestOpts
            );
            for (const fid of ltiResult.folderIds) {
              if (fid && !discoveredPanoptoFolderIds.includes(fid)) {
                discoveredPanoptoFolderIds.push(fid);
              }
            }
            ltiRecordings.push(...ltiResult.recordings);
          }
          if (discoveredPanoptoFolderIds.length > 0) {
            resolvedFolderId = discoveredPanoptoFolderIds[0];
            resolutionTier = 'Tier 2B (Moodle LTI Launch)';
            panoptoSessionVerified = true;
          } else if (ltiRecordings.length > 0) {
            panoptoSessionVerified = true;
          }
        }

        // Tier 2C: Pure REST core_block_get_course_blocks + AJAX panopto_content.php discovery
        if (!resolvedFolderId) {
          const normalizedCourseBaseUrl = normalizeBaseUrl(courseBaseUrl);
          const isSameAsRoot = normalizedCourseBaseUrl === rootMoodleUrl;
          let cachedCourseSesskey = formatSesskeyCache.get(normalizedCourseBaseUrl);
          if (
            !cachedCourseSesskey &&
            !isSameAsRoot &&
            (options?.useNativeCookies || options?.cookieAdapter || Object.keys(panoptoJar.toRecord()).length > 0)
          ) {
            cachedCourseSesskey = fetchSesskeyFromJar(panoptoJar, normalizedCourseBaseUrl, requestOpts);
            formatSesskeyCache.set(normalizedCourseBaseUrl, cachedCourseSesskey);
          }
          const courseBlockSesskey =
            (cachedCourseSesskey ? (await cachedCourseSesskey) ?? undefined : undefined) ??
            (isSameAsRoot ? activeBlockSesskey : undefined);
          const wsBlockLinks = await discoverPanoptoFromMoodleBlocks(
            token,
            courseId,
            courseBaseUrl,
            PANOPTO_BASE_URL,
            requestOpts,
            {
              jar: panoptoJar,
              sesskey: courseBlockSesskey,
              moodleCookies,
            }
          );
          for (const fid of wsBlockLinks.folderIds) {
            if (fid && !discoveredPanoptoFolderIds.includes(fid)) {
              discoveredPanoptoFolderIds.push(fid);
            }
          }
          for (const del of wsBlockLinks.deliveries) {
            if (del.id && !discoveredPanoptoDeliveries.some(d => d.id === del.id)) {
              discoveredPanoptoDeliveries.push({ id: del.id, title: del.title, recordingUrl: del.recordingUrl });
            }
          }
          if (discoveredPanoptoFolderIds.length > 0) {
            resolvedFolderId = discoveredPanoptoFolderIds[0];
            resolutionTier = 'Tier 2C (Moodle core_block_get_course_blocks WS)';
          }
        }

        // Tier 2D: Resolve parent folder from discovered delivery IDs
        if (!resolvedFolderId && discoveredPanoptoDeliveries.length > 0) {
          for (const del of discoveredPanoptoDeliveries.slice(0, 3)) {
            resolvedFolderId = await resolveFolderIdFromDelivery(del.id, PANOPTO_BASE_URL, panoptoJar, requestOpts);
            if (resolvedFolderId) {
              resolutionTier = 'Tier 2D (DeliveryInfo Parent Folder)';
              break;
            }
          }
        }

        // Tier 3: Panopto Data.svc/GetSessions search (un-gated when Panopto is enabled)
        if (!resolvedFolderId) {
          let hasPanoptoSession: boolean;
          if (didForcePanoptoReauth && panoptoAuthPromise) {
            const reauthed = await panoptoAuthPromise;
            initialPanoptoAuthed = reauthed;
            hasPanoptoSession = reauthed;
          } else {
            hasPanoptoSession =
              initialPanoptoAuthed || panoptoSessionVerified || (await ensurePanoptoSession(panoptoJar));
            if (!hasPanoptoSession && options?.onEnsurePanoptoAuth) {
              const reauthed = await ensurePanoptoSession(panoptoJar, true);
              if (reauthed) {
                initialPanoptoAuthed = true;
                hasPanoptoSession = true;
              }
            }
          }
          const didSearchWithForceReauth = didForcePanoptoReauth;

          resolvedFolderId = await discoverCourseFolderFromBrowse(
            {
              courseId,
              courseCode: courseInfo?.courseCode,
              displayName: courseName,
              fullName: courseInfo?.name,
              year: courseInfo?.year,
            },
            PANOPTO_BASE_URL,
            panoptoJar,
            requestOpts
          );
          if (resolvedFolderId) {
            resolutionTier =
              didForcePanoptoReauth && hasPanoptoSession
                ? 'Tier 3 (Panopto Data.svc Search after Re-Auth)'
                : 'Tier 3 (Panopto Data.svc Search)';
            panoptoSessionVerified = true;
          }

          if (!resolvedFolderId && options?.onEnsurePanoptoAuth && !panoptoSessionVerified && !didSearchWithForceReauth) {
            const reauthed = await ensurePanoptoSession(panoptoJar, true);
            if (reauthed) {
              initialPanoptoAuthed = true;
              hasPanoptoSession = true;
              resolvedFolderId = await discoverCourseFolderFromBrowse(
                {
                  courseId,
                  courseCode: courseInfo?.courseCode,
                  displayName: courseName,
                  fullName: courseInfo?.name,
                  year: courseInfo?.year,
                },
                PANOPTO_BASE_URL,
                panoptoJar,
                requestOpts
              );
              if (resolvedFolderId) {
                resolutionTier = 'Tier 3 (Panopto Data.svc Search after Re-Auth)';
                panoptoSessionVerified = true;
              }
            } else {
              initialPanoptoAuthed = false;
              hasPanoptoSession = false;
            }
          }

          if (!resolvedFolderId && !hasPanoptoSession && !panoptoAuthErrorReported) {
            panoptoAuthErrorReported = true;
            errors.push({
              context: 'Panopto Authentication',
              message: 'Panopto session authentication failed; Panopto folder search returned no match.',
            });
          }
        }

        console.log(
          `[SyncEngine][Panopto] Course "${courseName}" (${courseId}): resolvedFolderId=${resolvedFolderId || 'none'} via ${resolutionTier} (deliveries=${discoveredPanoptoDeliveries.length}, ltiRecs=${ltiRecordings.length})`
        );
        if (resolvedFolderId && !manualOverride) {
          discoveredPanoptoFolders[courseId] = resolvedFolderId;
        }

        let folderRecordings: PanoptoRecording[] = [];
        if (resolvedFolderId) {
          await ensurePanoptoSession(panoptoJar);
          folderRecordings = await fetchPanoptoFolderSessions(
            resolvedFolderId,
            courseId,
            courseName,
            PANOPTO_BASE_URL,
            panoptoJar,
            0,
            classificationOptions,
            requestOpts
          );
          if (folderRecordings.length > 0) {
            panoptoSessionVerified = true;
          } else if (!didRunLti && discoveredPanoptoLtiInstances.length > 0 && !panoptoSessionVerified) {
            didRunLti = true;
            const ltiResult = await resolvePanoptoViaLti(
              token,
              discoveredPanoptoLtiInstances[0],
              courseId,
              courseName,
              courseBaseUrl,
              PANOPTO_BASE_URL,
              panoptoJar,
              requestOpts
            );
            ltiRecordings.push(...ltiResult.recordings);
            folderRecordings = await fetchPanoptoFolderSessions(
              resolvedFolderId,
              courseId,
              courseName,
              PANOPTO_BASE_URL,
              panoptoJar,
              0,
              classificationOptions,
              requestOpts
            );
            if (folderRecordings.length > 0) {
              panoptoSessionVerified = true;
            }
          }

          if (folderRecordings.length === 0 && options?.onEnsurePanoptoAuth && !panoptoSessionVerified && !didForcePanoptoReauth) {
            console.log(
              `[SyncEngine][Panopto] 0 recordings returned for folder ${resolvedFolderId} (${courseName}); checking if Panopto session expired...`
            );
            const reauthed = await ensurePanoptoSession(panoptoJar, true);
            if (reauthed) {
              folderRecordings = await fetchPanoptoFolderSessions(
                resolvedFolderId,
                courseId,
                courseName,
                PANOPTO_BASE_URL,
                panoptoJar,
                0,
                classificationOptions,
                requestOpts
              );
              if (folderRecordings.length > 0) {
                panoptoSessionVerified = true;
              }
            }
          }
        }

        const reclassifiedLti = ltiRecordings.map((rec) => {
          const classified = classifyRecordingWithSource(rec.title, {
            ...classificationOptions,
            host: rec.host,
          });
          return {
            ...rec,
            type: classified.type,
            classificationSource: classified.source,
          };
        });

        const rawCombined: PanoptoRecording[] = [...folderRecordings, ...reclassifiedLti];
        if (rawCombined.length === 0 && discoveredPanoptoDeliveries.length > 0) {
          for (const del of discoveredPanoptoDeliveries) {
            const classified = classifyRecordingWithSource(del.title, classificationOptions);
            rawCombined.push({
              id: del.id,
              title: del.title,
              recordingUrl: del.recordingUrl,
              publishedDate: '',
              type: classified.type,
              classificationSource: classified.source,
              courseId,
              courseName,
              sectionName: del.sectionName,
            });
          }
        }

        const resolvedFolderUrl = resolvedFolderId
          ? buildPanoptoFolderUrl(resolvedFolderId, PANOPTO_BASE_URL)
          : undefined;

        const finalCourseRecordings = filterAndDeduplicateRecordings(rawCombined, classificationOptions).map(rec => ({
          ...rec,
          folderId: resolvedFolderId || rec.folderId,
          folderUrl: resolvedFolderUrl || rec.folderUrl,
          sectionName: rec.type === 'Recitation' ? 'Recitations' : 'Lectures',
        }));

        if (finalCourseRecordings.length > 0) {
          recordings.push(...finalCourseRecordings);
        } else if (manualOverride && resolvedFolderId) {
          errors.push({
            context: `Panopto (${courseName})`,
            message: `No recordings returned for folder ${resolvedFolderId}. Ensure you are signed into tau.cloud.panopto.eu in your browser or check the folder permissions.`,
          });
        }
      } catch (err: any) {
        errors.push({
          context: `Fetching Panopto recordings for course ${courseName} (id: ${courseId})`,
          message: err.message,
        });
      } finally {
        progress.panoptoCourseCompleted(courseName);
      }
    });

    // Level 3 Complete: Emit all Panopto recordings, discovered folder mappings, and course staff atomically
    if (
      onPartialSync &&
      (recordings.length > 0 || Object.keys(courseStaff).length > 0 || Object.keys(discoveredPanoptoFolders).length > 0)
    ) {
      onPartialSync({
        recordings: [...recordings],
        ...(Object.keys(courseStaff).length > 0 ? { courseStaff: { ...courseStaff } } : {}),
        ...(Object.keys(discoveredPanoptoFolders).length > 0
          ? { discoveredPanoptoFolders: { ...discoveredPanoptoFolders } }
          : {}),
      });
    }
  }

  // Late Submission Box Auto-Suppression Heuristic
  const LATE_BOX_REGEX = /הגשה\s+באיחור|תיבת\s+הגשה\s+באיחור|הגשה\s+מאוחרת|מועד\s+מיוחד|late\s+submission/i;

  const normalizeTitle = (title: string): string => {
    return title
      .replace(LATE_BOX_REGEX, '')
      .replace(/[-–—:()\[\]]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  };

  const isWordBoundaryMatch = (full: string, sub: string): boolean => {
    if (!full || !sub || sub.length < 2) return false;
    if (full === sub) return true;
    const escaped = sub.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(^|[^a-zA-Z0-9\\u0590-\\u05FF])${escaped}($|[^a-zA-Z0-9\\u0590-\\u05FF])`);
    return regex.test(full);
  };

  for (const assign of assignments) {
    if (LATE_BOX_REGEX.test(assign.name)) {
      assign.isLateSubmissionBox = true;
      const normalizedLate = normalizeTitle(assign.name);
      if (!normalizedLate || normalizedLate.length < 2) continue;

      const regularAssign = assignments.find((other) => {
        const assignUid = assign.uid || `${assign.activityType || 'assign'}:${assign.id}`;
        const otherUid = other.uid || `${other.activityType || 'assign'}:${other.id}`;
        if (other.courseId !== assign.courseId || otherUid === assignUid) return false;
        if (LATE_BOX_REGEX.test(other.name)) return false;
        const normalizedOther = normalizeTitle(other.name);
        if (!normalizedOther || normalizedOther.length < 2) return false;
        return (
          normalizedLate === normalizedOther ||
          isWordBoundaryMatch(normalizedLate, normalizedOther) ||
          isWordBoundaryMatch(normalizedOther, normalizedLate)
        );
      });

      if (regularAssign && (regularAssign.status === 'Submitted' || regularAssign.isCompleted)) {
        assign.isHidden = true;
        assign.status = 'Submitted';
      }
    }
  }

  progress.finalizing('Finalizing sync results...');

  // Ensure assignments are deterministically ordered matching raw Moodle discovery sequence
  assignments.sort((a, b) => {
    const uidA = a.uid || `${a.activityType || 'assign'}:${a.id}`;
    const uidB = b.uid || `${b.activityType || 'assign'}:${b.id}`;
    const orderA = rawOrderMap.has(uidA) ? rawOrderMap.get(uidA)! : 999999 + a.id;
    const orderB = rawOrderMap.has(uidB) ? rawOrderMap.get(uidB)! : 999999 + b.id;
    return orderA - orderB;
  });

  progress.complete('Sync completed.');
  return {
    assignments,
    files,
    meetings,
    recordings,
    errors,
    sections,
    folders,
    links,
    announcements,
    gradeSummaries,
    ...(Object.keys(courseStaff).length > 0 ? { courseStaff } : {}),
    ...(Object.keys(discoveredPanoptoFolders).length > 0 ? { discoveredPanoptoFolders } : {}),
    syncedAt: new Date().toISOString(),
  };
}
