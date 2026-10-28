import { MoodleClient, RawGradeItem, RawMoodleAssignment } from './moodleApi.js';
import { SyncResult, Assignment, CourseFile, ZoomMeeting, PanoptoRecording, SyncError, MoodleCredentials, Attachment } from './types.js';
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

export interface RunSyncOptions {
  enableScraping?: boolean;
  enablePanopto?: boolean;
  coursesPanoptoMap?: Record<number, string>;
  onEnsurePanoptoAuth?: (forceRefresh?: boolean) => Promise<boolean>;
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
  const client = new MoodleClient(token, baseUrl, { sesskey, devMode: false, enableScraping });
  const errors: SyncError[] = [];
  const assignments: Assignment[] = [];
  const files: CourseFile[] = [];
  const meetings: ZoomMeeting[] = [];
  const recordings: PanoptoRecording[] = [];

  let scrapedMeetingsJar: CookieJar | null = null;
  let didAttemptLogin = false;
  let panoptoAuthPromise: Promise<boolean> | null = null;

  const getScrapeJar = async (): Promise<CookieJar | null> => {
    if (!enableScraping && !enablePanopto) return null;
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
  const courseMap = new Map<number, { display_name: string; name: string; courseCode?: string; year?: string; instanceUrl?: string }>();
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

  onProgress('Fetching assignments and grades...');
  let rawAssignments: RawMoodleAssignment[] = [];
  const rawOrderMap = new Map<number, number>();
  let nextOrderIndex = 0;
  const gradesByCmid = new Map<number, RawGradeItem>();

  await Promise.all([
    (async () => {
      try {
        const assignmentsResp = await client.getAssignments();
        for (const courseObj of assignmentsResp.courses) {
          if (trackedCourseIds.includes(courseObj.id)) {
            for (const assign of courseObj.assignments) {
              rawAssignments.push(assign);
              if (!rawOrderMap.has(assign.id)) {
                rawOrderMap.set(assign.id, nextOrderIndex++);
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
    batchPromises(trackedCourseIds, 100, async (courseId) => {
      try {
        const gradesResp = await client.getGradeItems(courseId, userId);
        for (const userGrade of gradesResp.usergrades) {
          for (const item of userGrade.gradeitems) {
            if (item.itemtype === 'mod' && item.itemmodule === 'assign' && item.cmid !== null) {
              gradesByCmid.set(Number(item.cmid), item);
            }
          }
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
  const now = new Date();

  const processAssignment = async (assign: RawMoodleAssignment, sectionName?: string) => {
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

    const finalDeadlineTs = Math.max(dueTs, cutoffTs, extTs);
    let deadlineIso: string | null = null;

    if (finalDeadlineTs > 0) {
      const deadlineDate = new Date(finalDeadlineTs * 1000);
      deadlineIso = deadlineDate.toISOString();
      if (status !== 'Submitted' && deadlineDate < now) {
        status = 'Not submitted';
      }
    }

    const openedIso = assign.allowsubmissionsfromdate > 0
      ? new Date(assign.allowsubmissionsfromdate * 1000).toISOString()
      : null;

    const gradeInfo = gradesByCmid.get(Number(assign.cmid));
    let grade: number | null = null;
    let gradeMax: number | null = null;

    if (gradeInfo && !gradeInfo.gradeishidden) {
      grade = gradeInfo.graderaw;
      gradeMax = gradeInfo.grademax;
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
      name: decodeHTMLEntities(assign.name || ''),
      status,
      submittedFiles,
      deadline: deadlineIso,
      opened: openedIso,
      link: `${assignBaseUrl}/mod/assign/view.php?id=${assign.cmid}`,
      grade,
      gradeMax,
      attachments,
      sectionName: sectionName || cmidToSectionMap.get(Number(assign.cmid))
    };

    assignments.push(processedAssign);
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

  await Promise.all([
    // Process known assignments from getAssignments
    batchPromises(rawAssignments, 50, async (assign) => {
      await processAssignment(assign);
    }),

    // Process course contents to find files, zoom meetings, and missing assignments
    batchPromises(trackedCourseIds, 20, async (courseId) => {
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
        const sections = await client.getCourseContents(courseId);
        for (const section of sections) {
          const sectionName = section.name || '';
          if (sectionName && !courseSectionNames.includes(sectionName)) {
            courseSectionNames.push(sectionName);
          }

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

            if (modname === 'assign') {
              cmidToSectionMap.set(module.id, sectionName);
              const exists = rawAssignments.some(a => a.cmid === module.id);
              if (!exists) {
                const newAssign: RawMoodleAssignment = {
                  id: module.instance || module.id,
                  cmid: module.id,
                  course: courseId,
                  name: name,
                  duedate: 0,
                  cutoffdate: 0,
                  allowsubmissionsfromdate: 0
                };
                if (!rawOrderMap.has(newAssign.id)) {
                  rawOrderMap.set(newAssign.id, nextOrderIndex++);
                }
                // It was discovered here, process it right away
                await processAssignment(newAssign, sectionName);
              }
            }

            if (modname === 'resource' && module.contents) {
              for (const content of module.contents) {
                if (content.type === 'file') {
                  const newFile: CourseFile = {
                    fileName: content.filename || '',
                    fileUrl: content.fileurl || '',
                    fileSize: content.filesize || 0,
                    mimeType: content.mimetype || 'application/octet-stream',
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
    })
  ]);

  // Sync sectionName for known assignments in case contents finished after assignment processed
  for (const assign of assignments) {
    if (!assign.sectionName) {
      const secName = cmidToSectionMap.get(Number(assign.cmid));
      if (secName) assign.sectionName = secName;
    }
  }

  // Ensure assignments are deterministically ordered matching raw Moodle discovery sequence
  assignments.sort((a, b) => {
    const orderA = rawOrderMap.has(a.id) ? rawOrderMap.get(a.id)! : 999999 + a.id;
    const orderB = rawOrderMap.has(b.id) ? rawOrderMap.get(b.id)! : 999999 + b.id;
    return orderA - orderB;
  });

  onProgress('Sync completed.');
  return {
    assignments,
    files,
    meetings,
    recordings,
    errors,
    syncedAt: new Date().toISOString(),
  };
}
