import { MoodleClient, RawGradeItem, RawMoodleAssignment, RawMoodleQuiz } from './moodleApi.js';
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
  SyncError,
  MoodleCredentials,
  Attachment,
} from './types.js';
import { fetchCourseFormatState, fetchSesskeyFromJar, ParsedCourseFormatState } from './courseFormatState.js';
import { buildAuthenticatedFileUrl } from './zipBuilder.js';
import { parseTauCourseMetadata } from './courseParser.js';
import { CookieJar, performLogin, scrapeZoomMeetingsWithToken, isZoomUrl, isZoomOrMeetingName, parseZoomUrl, extractZoomLinksFromHtml, decodeHTMLEntities } from './zoomScraper.js';
import {
  PANOPTO_BASE_URL,
  isPanoptoUrl,
  isPanoptoModuleName,
  extractPanoptoFolderId,
  extractPanoptoDeliveryId,
  buildPanoptoFolderUrl,
  buildPanoptoViewerUrl,
  extractPanoptoFromCourseHtml,
  classifyRecordingType,
  filterAndDeduplicateRecordings,
  ensurePanoptoAuthenticated,
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

export interface RunSyncOptions {
  enableScraping?: boolean;
  enablePanopto?: boolean;
  coursesPanoptoMap?: Record<number, string>;
  onEnsurePanoptoAuth?: (forceRefresh?: boolean) => Promise<boolean>;
  lang?: 'he' | 'en';
}

export async function runSync(
  token: string,
  trackedCourseIds: number[],
  onProgress: (message: string) => void,
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
  const client = new MoodleClient(token, baseUrl, {
    sesskey,
    devMode: false,
    enableScraping,
    lang: options?.lang,
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

  let scrapedMeetingsJar: CookieJar | null = null;
  let didAttemptLogin = false;
  let panoptoAuthPromise: Promise<boolean> | null = null;

  const getScrapeJar = async (): Promise<CookieJar | null> => {
    if (!enableScraping && !enablePanopto && !creds && !moodleCookies) return null;
    if (scrapedMeetingsJar) return scrapedMeetingsJar;

    const isBrowser = typeof window !== 'undefined' || (typeof (globalThis as any).browser !== 'undefined' && (globalThis as any).browser.runtime) || (typeof (globalThis as any).chrome !== 'undefined' && (globalThis as any).chrome.runtime);
    if (isBrowser) {
      const jar = new CookieJar();
      scrapedMeetingsJar = jar;
      return jar;
    }

    if (didAttemptLogin) return null;
    
    if (moodleCookies) {
      const jar = new CookieJar();
      jar.ingest(moodleCookies);
      scrapedMeetingsJar = jar;
      return jar;
    } else if (creds) {
      didAttemptLogin = true;
      const jar = new CookieJar();
      try {
        await performLogin(jar, creds);
        scrapedMeetingsJar = jar;
        return jar;
      } catch (err: any) {
        errors.push({
          context: 'SSO Login for Zoom/Panopto Scraping',
          message: err.message,
        });
      }
    }
    return null;
  };

  let didForcePanoptoReauth = false;
  let panoptoSessionVerified = false;

  const ensurePanoptoSession = async (jar: CookieJar | null, forceRefresh = false): Promise<boolean> => {
    if (options?.onEnsurePanoptoAuth) {
      if (forceRefresh) {
        if (didForcePanoptoReauth) return false;
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
        creds
      ).catch(() => false);
    }
    return panoptoAuthPromise;
  };

  onProgress('Fetching Moodle user info...');
  let userId: number;

  try {
    const siteInfo = await client.getSiteInfo();
    userId = siteInfo.userid;
  } catch (err: any) {
    if (err.errorcode || err.name === 'MoodleApiError') {
      throw err;
    }
    throw new Error(`Failed to fetch initial data from Moodle: ${err.message}`);
  }

  if (trackedCourseIds.length === 0) {
    return {
      assignments: [],
      files: [],
      meetings: [],
      recordings: [],
      errors: [],
      syncedAt: new Date().toISOString(),
    };
  }

  onProgress('Fetching course mapping...');
  const courseMap = new Map<number, {
    display_name: string;
    name: string;
    courseCode?: string;
    year?: string;
    instanceUrl?: string;
    format?: string;
    coursecategory?: string;
  }>();
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
  } catch (err: any) {
    errors.push({
      context: 'Fetching enrolled courses',
      message: err.message,
    });
  }

  const getCourseDisplayName = (moodleCourseId: number, rawNameFromAssign?: string): string => {
    const mapVal = courseMap.get(moodleCourseId);
    if (mapVal) return mapVal.display_name;
    return rawNameFromAssign || `Course ${moodleCourseId}`;
  };

  onProgress('Fetching assignments, quizzes, and grades...');
  let rawAssignments: RawMoodleAssignment[] = [];
  let rawQuizzes: RawMoodleQuiz[] = [];
  const rawOrderMap = new Map<string, number>();
  let nextOrderIndex = 0;
  const gradesByCmid = new Map<number, RawGradeItem>();
  const moduleCompletionMap = new Map<number, { completion?: number; completiondata?: any }>();

  await Promise.all([
    (async () => {
      try {
        const assignmentsResp = await client.getAssignments();
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
    batchPromises(trackedCourseIds, 100, async (courseId) => {
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

  onProgress(`Fetching contents and submission statuses for ${trackedCourseIds.length} courses...`);
  const cmidToSectionMap = new Map<number, string>();
  const cmidToSectionIdMap = new Map<number, number>();
  const now = new Date();
  const seenProcessedAssignKeys = new Set<string>();
  const seenProcessedQuizKeys = new Set<string>();

  const processAssignment = async (assign: RawMoodleAssignment, sectionName?: string) => {
    const key = assign.cmid ? `cmid:${assign.cmid}` : `id:${assign.course}:${assign.id}`;
    if (seenProcessedAssignKeys.has(key)) return;
    seenProcessedAssignKeys.add(key);
    if (assign.cmid) seenProcessedAssignKeys.add(`cmid:${assign.cmid}`);
    if (assign.id) seenProcessedAssignKeys.add(`id:${assign.course}:${assign.id}`);
    let subStatus = 'new';
    let extensionDueDate = 0;
    let submittedFiles: Attachment[] | undefined = undefined;

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
            }));
          }
        }
      }
    } catch (err: any) {
      errors.push({
        context: `Fetching submission status for assignment ${assign.name} (id: ${assign.id})`,
        message: err.message,
      });
    }

    let status: 'Assigned' | 'Submitted' | 'Not submitted' = subStatus === 'submitted' ? 'Submitted' : 'Assigned';

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

    let attachments = assign.introattachments
      ? assign.introattachments.map((att) => ({
          name: att.filename,
          url: att.fileurl,
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
      isCompleted: status === 'Submitted',
      feedback,
      isBonus,
    };

    assignments.push(processedAssign);
    if (onPartialSync) {
      onPartialSync({ assignments: [...assignments] });
    }
  };

  const processQuiz = async (quiz: RawMoodleQuiz, sectionName?: string) => {
    const key = quiz.coursemodule ? `cmid:${quiz.coursemodule}` : `id:${quiz.course}:${quiz.id}`;
    if (seenProcessedQuizKeys.has(key)) return;
    seenProcessedQuizKeys.add(key);
    if (quiz.coursemodule) seenProcessedQuizKeys.add(`cmid:${quiz.coursemodule}`);
    if (quiz.id) seenProcessedQuizKeys.add(`id:${quiz.course}:${quiz.id}`);

    let hasFinished = false;
    try {
      const attempts = await client.getQuizAttempts(quiz.id);
      hasFinished = attempts.some((att) => att.state === 'finished');
    } catch (err: any) {
      errors.push({
        context: `Fetching attempts for quiz ${quiz.name} (id: ${quiz.id})`,
        message: err.message,
      });
    }

    const cmid = quiz.coursemodule;
    const completionInfo = moduleCompletionMap.get(cmid);
    const effectiveCompletion = completionInfo?.completion ?? quiz.completion;
    const effectiveCompletionData = completionInfo?.completiondata ?? quiz.completiondata;
    const requiresManualCompletion = effectiveCompletion === 1;
    const isManualCompletionDone = Boolean(effectiveCompletionData?.state === 1);

    let status: 'Assigned' | 'Submitted' | 'Not submitted' = 'Assigned';
    if (hasFinished) {
      status = 'Submitted';
    } else if (requiresManualCompletion && isManualCompletionDone) {
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
      isManualCompletionDone,
      completionTracking: effectiveCompletion,
      isCompleted: status === 'Submitted',
    };

    assignments.push(processedQuiz);
    if (onPartialSync) {
      onPartialSync({ assignments: [...assignments] });
    }
  };

  if (enablePanopto) {
    try {
      const initialJar = await getScrapeJar();
      await ensurePanoptoSession(initialJar);
    } catch {
      // Individual course sync will handle fallback/errors if needed
    }
  }

  // Stage 1: Fetch course contents & format state first so cmidToSectionMap,
  // cmidToSectionIdMap, moduleCompletionMap, and fallback activities are populated
  await batchPromises(trackedCourseIds, 20, async (courseId) => {
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
        const key = m.startTime
          ? `${courseId}:${m.meetingNumber || m.meetingUrl}:${m.startTime}`
          : `${courseId}:${m.meetingNumber || m.meetingUrl}`;
        if (seenMeetingKeys.has(key)) return;
        seenMeetingKeys.add(key);
        meetings.push(m);
        if (onPartialSync) onPartialSync({ meetings: [...meetings] });
      };

      try {
        let formatState: ParsedCourseFormatState | null = null;
        if (sesskey) {
          try {
            formatState = await fetchCourseFormatState({
              instanceBaseUrl: courseBaseUrl,
              courseId,
              sesskey,
            });
          } catch {
            // Non-critical, fallback to flat sections
          }
        }

        const rawSections = await client.getCourseContents(courseId);
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
              if (module.completion !== undefined || module.completiondata) {
                moduleCompletionMap.set(module.id, {
                  completion: module.completion,
                  completiondata: module.completiondata,
                });
              }
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
              } else {
                const synthQuiz: RawMoodleQuiz = {
                  id: module.instance || module.id,
                  course: courseId,
                  coursemodule: module.id,
                  name: name,
                  timeopen: 0,
                  timeclose: 0,
                  timelimit: 0,
                  attempts: 0,
                  completion: module.completion,
                  completiondata: module.completiondata,
                };
                const uid = `quiz:${synthQuiz.id}`;
                if (!rawOrderMap.has(uid)) {
                  rawOrderMap.set(uid, nextOrderIndex++);
                }
                rawQuizzes.push(synthQuiz);
              }
            }

            if (modname === 'assign') {
              cmidToSectionMap.set(module.id, sectionName);
              cmidToSectionIdMap.set(module.id, section.id);
              if (module.completion !== undefined || module.completiondata) {
                moduleCompletionMap.set(module.id, {
                  completion: module.completion,
                  completiondata: module.completiondata,
                });
              }
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
              } else {
                const newAssign: RawMoodleAssignment = {
                  id: module.instance || module.id,
                  cmid: module.id,
                  course: courseId,
                  name: name,
                  duedate: 0,
                  cutoffdate: 0,
                  allowsubmissionsfromdate: 0
                };
                const uid = `assign:${newAssign.id}`;
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
                  if (onPartialSync) onPartialSync({ files: [...files] });
                }
              }
            }

            // --- FOLDER DETECTION (mod_folder) ---
            if (modname === 'folder' && module.contents) {
              const folderFiles: CourseFolderFile[] = [];
              let totalFolderSize = 0;
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
              if (onPartialSync) onPartialSync({ folders: [...folders], files: [...files] });
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
                if (onPartialSync) onPartialSync({ links: [...links] });
              }
            }

            // --- ZOOM MEETING DETECTION ---
            // A. LTI Module (e.g. Zoom LTI Pro activity)
            if (modname === 'lti' && isZoomOrMeetingName(name)) {
              let scrapedSuccessfully = false;
              if (module.instance !== undefined) {
                try {
                  const ltiMeetings = await scrapeZoomMeetingsWithToken(token, module.instance, courseBaseUrl);
                  if (ltiMeetings.length > 0) {
                    scrapedSuccessfully = true;
                    for (const lm of ltiMeetings) {
                      addMeeting({
                        title: lm.topic || name,
                        meetingUrl: lm.joinUrl,
                        sectionName,
                        courseId,
                        courseName,
                        startTime: lm.startTime,
                        meetingNumber: lm.meetingNumber,
                        password: lm.password,
                      });
                    }
                  }
                } catch (err: any) {
                  console.warn(`[SyncEngine] Failed to scrape Zoom meetings for course ${courseName} (module ID: ${module.id}):`, err);
                  errors.push({
                    context: `Scraping Zoom meetings for course ${courseName} (module ID: ${module.id})`,
                    message: err.message,
                  });
                }
              }

              // Fallback if scraping is disabled, returns 0 meetings, or fails:
              if (!scrapedSuccessfully) {
                const fallbackUrl = module.url || `${courseBaseUrl}/mod/lti/view.php?id=${module.id}`;
                addMeeting({
                  title: name,
                  meetingUrl: fallbackUrl,
                  sectionName,
                  courseId,
                  courseName,
                });
              }
            }

            // B. Official Zoom Module (mod_zoom)
            else if (modname === 'zoom') {
              let zoomUrl = '';
              if (module.contents && module.contents.length > 0) {
                const direct = module.contents.find(c => c.fileurl && isZoomUrl(c.fileurl));
                if (direct?.fileurl) zoomUrl = direct.fileurl;
              }
              if (!zoomUrl && module.url) {
                zoomUrl = module.url;
              }
              if (!zoomUrl) {
                zoomUrl = `${courseBaseUrl}/mod/zoom/view.php?id=${module.id}`;
              }
              const parsed = parseZoomUrl(zoomUrl);
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

            // C. URL Module (mod_url)
            else if (modname === 'url') {
              let directUrl = '';
              if (module.contents && module.contents.length > 0) {
                const zoomContent = module.contents.find(c => c.fileurl && isZoomUrl(c.fileurl));
                if (zoomContent?.fileurl) {
                  directUrl = zoomContent.fileurl;
                } else if (isZoomOrMeetingName(name)) {
                  const firstUrl = module.contents.find(c => c.fileurl);
                  if (firstUrl?.fileurl) directUrl = firstUrl.fileurl;
                }
              }

              if (!directUrl && (isZoomUrl(module.url || '') || isZoomOrMeetingName(name))) {
                directUrl = module.url || `${courseBaseUrl}/mod/url/view.php?id=${module.id}`;
              }

              if (directUrl) {
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

            // D. Labels, Pages, or Module Descriptions/Intros with embedded Zoom links
            else {
              const htmlSources: string[] = [];
              if (module.description) htmlSources.push(module.description);
              if (module.intro) htmlSources.push(module.intro);
              if (modname === 'label' || modname === 'page') {
                if (name && isZoomUrl(name)) htmlSources.push(name);
                if (module.contents) {
                  for (const c of module.contents) {
                    if (c.fileurl && isZoomUrl(c.fileurl)) {
                      htmlSources.push(c.fileurl);
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
        if (onPartialSync && sections.length > 0) {
          onPartialSync({ sections: [...sections] });
        }
      } catch (err: any) {
        errors.push({
          context: `Fetching contents for course ${courseName} (id: ${courseId})`,
          message: err.message,
        });
      }

      // --- PANOPTO LECTURE & RECITATION DISCOVERY AND SYNC ---
      if (enablePanopto) {
        try {
          const jar = await getScrapeJar();
          let resolvedFolderId: string | null = null;
          let resolutionTier = 'none';
          const ltiRecordings: PanoptoRecording[] = [];

          // Ensure Panopto SSO session is established once per sync
          await ensurePanoptoSession(jar);

          // Tier 1: Manual override in coursesPanoptoMap[courseId]
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
                resolvedFolderId = await resolveFolderIdFromDelivery(manualDeliveryId, PANOPTO_BASE_URL, jar);
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

          // Tier 2a: Auto-discover from Moodle course modules
          if (!resolvedFolderId && discoveredPanoptoFolderIds.length > 0) {
            resolvedFolderId = discoveredPanoptoFolderIds[0];
            resolutionTier = 'Tier 2 (Moodle Course Modules)';
          }

          // Tier 3: Panopto Data.svc/GetSessions search by course code / title
          if (!resolvedFolderId) {
            await ensurePanoptoSession(jar);
            resolvedFolderId = await discoverCourseFolderFromBrowse(
              {
                courseId,
                courseCode: courseInfo?.courseCode,
                displayName: courseName,
                fullName: courseInfo?.name,
                year: courseInfo?.year,
              },
              PANOPTO_BASE_URL,
              jar
            );
            if (resolvedFolderId) {
              resolutionTier = 'Tier 3 (Panopto Data.svc Search)';
              panoptoSessionVerified = true;
            }
          }

          // Tier 2b: Fallback to Panopto LTI launch, Moodle course blocks WS, or course HTML if Data.svc search didn't find folder
          if (!resolvedFolderId && discoveredPanoptoLtiInstances.length > 0) {
            for (const ltiInstanceId of discoveredPanoptoLtiInstances) {
              const ltiResult = await resolvePanoptoViaLti(
                token,
                ltiInstanceId,
                courseId,
                courseName,
                courseBaseUrl,
                PANOPTO_BASE_URL,
                jar
              );
              for (const fid of ltiResult.folderIds) {
                addDiscoveredFolderId(fid);
              }
              ltiRecordings.push(...ltiResult.recordings);
            }
            if (discoveredPanoptoFolderIds.length > 0) {
              resolvedFolderId = discoveredPanoptoFolderIds[0];
              resolutionTier = 'Tier 2 (Moodle Course Modules / LTI)';
            }
          }

          if (!resolvedFolderId) {
            const wsBlockLinks = await discoverPanoptoFromMoodleBlocks(
              token,
              courseId,
              courseBaseUrl,
              PANOPTO_BASE_URL
            );
            for (const fid of wsBlockLinks.folderIds) {
              addDiscoveredFolderId(fid);
            }
            for (const del of wsBlockLinks.deliveries) {
              addDiscoveredDelivery(del.id, del.title, del.recordingUrl);
            }
            if (discoveredPanoptoFolderIds.length > 0) {
              resolvedFolderId = discoveredPanoptoFolderIds[0];
              resolutionTier = 'Tier 2 (Moodle core_block_get_course_blocks WS)';
            }
          }

          if (!resolvedFolderId && discoveredPanoptoDeliveries.length > 0) {
            for (const del of discoveredPanoptoDeliveries.slice(0, 3)) {
              resolvedFolderId = await resolveFolderIdFromDelivery(del.id, PANOPTO_BASE_URL, jar);
              if (resolvedFolderId) {
                resolutionTier = 'Tier 2 (DeliveryInfo Parent Folder)';
                break;
              }
            }
          }

          // If still unresolved and Panopto session has not yet been verified, force a hidden-tab re-auth check and retry Tier 3
          if (!resolvedFolderId && options?.onEnsurePanoptoAuth && !panoptoSessionVerified && !didForcePanoptoReauth) {
            const reauthed = await ensurePanoptoSession(jar, true);
            if (reauthed) {
              resolvedFolderId = await discoverCourseFolderFromBrowse(
                {
                  courseId,
                  courseCode: courseInfo?.courseCode,
                  displayName: courseName,
                  fullName: courseInfo?.name,
                  year: courseInfo?.year,
                },
                PANOPTO_BASE_URL,
                jar
              );
              if (resolvedFolderId) {
                resolutionTier = 'Tier 3 (Panopto Data.svc Search after Re-Auth)';
                panoptoSessionVerified = true;
              }
            }
          }

          console.log(
            `[SyncEngine][Panopto] Course "${courseName}" (${courseId}): resolvedFolderId=${resolvedFolderId || 'none'} via ${resolutionTier} (deliveries=${discoveredPanoptoDeliveries.length}, ltiRecs=${ltiRecordings.length})`
          );

          // Fetch recordings from the resolved Panopto folder
          let folderRecordings: PanoptoRecording[] = [];
          if (resolvedFolderId) {
            await ensurePanoptoSession(jar);
            folderRecordings = await fetchPanoptoFolderSessions(
              resolvedFolderId,
              courseId,
              courseName,
              PANOPTO_BASE_URL,
              jar
            );
            if (folderRecordings.length > 0) {
              panoptoSessionVerified = true;
            } else if (options?.onEnsurePanoptoAuth && !panoptoSessionVerified && !didForcePanoptoReauth) {
              console.log(
                `[SyncEngine][Panopto] 0 recordings returned for folder ${resolvedFolderId} (${courseName}); checking if Panopto session expired...`
              );
              const reauthed = await ensurePanoptoSession(jar, true);
              if (reauthed) {
                folderRecordings = await fetchPanoptoFolderSessions(
                  resolvedFolderId,
                  courseId,
                  courseName,
                  PANOPTO_BASE_URL,
                  jar
                );
                if (folderRecordings.length > 0) {
                  panoptoSessionVerified = true;
                }
              }
            }
          }

          // Merge explicit section assignments from Moodle modules and fallback deliveries
          const explicitSectionById = new Map<string, string>();
          for (const del of discoveredPanoptoDeliveries) {
            if (del.sectionName) {
              explicitSectionById.set(del.id.toLowerCase(), del.sectionName);
            }
          }

          const rawCombined: PanoptoRecording[] = [...folderRecordings, ...ltiRecordings];
          if (rawCombined.length === 0 && discoveredPanoptoDeliveries.length > 0) {
            for (const del of discoveredPanoptoDeliveries) {
              rawCombined.push({
                id: del.id,
                title: del.title,
                recordingUrl: del.recordingUrl,
                publishedDate: '',
                type: classifyRecordingType(del.title),
                courseId,
                courseName,
                sectionName: del.sectionName,
              });
            }
          }

          const resolvedFolderUrl = resolvedFolderId
            ? buildPanoptoFolderUrl(resolvedFolderId, PANOPTO_BASE_URL)
            : undefined;

          const finalCourseRecordings = filterAndDeduplicateRecordings(rawCombined).map(rec => ({
            ...rec,
            folderId: resolvedFolderId || rec.folderId,
            folderUrl: resolvedFolderUrl || rec.folderUrl,
            sectionName: rec.type === 'Recitation' ? 'Recitations' : 'Lectures',
          }));

          if (finalCourseRecordings.length > 0) {
            recordings.push(...finalCourseRecordings);
            if (onPartialSync) {
              onPartialSync({ recordings: [...recordings] });
            }
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
        }
      }
    });

  // Stage 2: Process all assignments and quizzes now that section & completion maps are populated
  await Promise.all([
    batchPromises(rawAssignments, 50, async (assign) => {
      await processAssignment(assign);
    }),
    batchPromises(rawQuizzes, 30, async (quiz) => {
      await processQuiz(quiz);
    }),
  ]);

  // Sync sectionName for known assignments in case contents finished after assignment processed
  for (const assign of assignments) {
    if (!assign.sectionName) {
      const secName = cmidToSectionMap.get(Number(assign.cmid));
      if (secName) assign.sectionName = secName;
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

  // Ensure assignments are deterministically ordered matching raw Moodle discovery sequence
  assignments.sort((a, b) => {
    const uidA = a.uid || `${a.activityType || 'assign'}:${a.id}`;
    const uidB = b.uid || `${b.activityType || 'assign'}:${b.id}`;
    const orderA = rawOrderMap.has(uidA) ? rawOrderMap.get(uidA)! : 999999 + a.id;
    const orderB = rawOrderMap.has(uidB) ? rawOrderMap.get(uidB)! : 999999 + b.id;
    return orderA - orderB;
  });

  onProgress('Sync completed.');
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
    syncedAt: new Date().toISOString(),
  };
}
