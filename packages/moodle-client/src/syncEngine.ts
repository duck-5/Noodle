import { MoodleClient, RawGradeItem, RawMoodleAssignment } from './moodleApi.js';
import { SyncResult, Assignment, CourseFile, ZoomMeeting, SyncError, MoodleCredentials } from './types.js';
import { parseTauCourseMetadata } from './courseParser.js';
import { CookieJar, performLogin, scrapeZoomMeetingsWithToken } from './zoomScraper.js';

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

export async function runSync(
  token: string,
  trackedCourseIds: number[],
  onProgress: (message: string) => void,
  baseUrl?: string,
  creds?: MoodleCredentials,
  moodleCookies?: string
): Promise<SyncResult> {
  const client = new MoodleClient(token, baseUrl);
  const errors: SyncError[] = [];
  const assignments: Assignment[] = [];
  const files: CourseFile[] = [];
  const meetings: ZoomMeeting[] = [];

  let scrapedMeetingsJar: CookieJar | null = null;
  let didAttemptLogin = false;

  const getScrapeJar = async (): Promise<CookieJar | null> => {
    if (scrapedMeetingsJar) return scrapedMeetingsJar;

    const isBrowser = typeof window !== 'undefined' || (typeof (globalThis as any).chrome !== 'undefined' && (globalThis as any).chrome.runtime);
    if (isBrowser) {
      // In the browser/extension, we don't need programmatic login or to pass cookies; 
      // the network stack handles cookies implicitly when credentials: 'include' is used.
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
          context: 'SSO Login for Zoom Scraping',
          message: err.message,
        });
      }
    }
    return null;
  };

  onProgress('Fetching Moodle user info...');
  let userId: number;
  try {
    const siteInfo = await client.getSiteInfo();
    userId = siteInfo.userid;
  } catch (err: any) {
    throw new Error(`Failed to authenticate with Moodle: ${err.message}`);
  }

  if (trackedCourseIds.length === 0) {
    return {
      assignments: [],
      files: [],
      meetings: [],
      errors: [],
      syncedAt: new Date().toISOString(),
    };
  }

  // 1. Fetch Enrolled Courses to map names and parse metadata
  onProgress('Fetching course mapping...');
  const courseMap = new Map<number, { display_name: string; name: string }>();
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
      });
    }
  } catch (err: any) {
    errors.push({
      context: 'Fetching enrolled courses',
      message: err.message,
    });
  }

  // Helper to get course display name
  const getCourseDisplayName = (moodleCourseId: number, rawNameFromAssign?: string): string => {
    const mapVal = courseMap.get(moodleCourseId);
    if (mapVal) return mapVal.display_name;
    return rawNameFromAssign || `Course ${moodleCourseId}`;
  };

  // 2. Fetch Assignments
  onProgress('Fetching assignments...');
  let rawAssignments: RawMoodleAssignment[] = [];
  try {
    const assignmentsResp = await client.getAssignments();
    for (const courseObj of assignmentsResp.courses) {
      if (trackedCourseIds.includes(courseObj.id)) {
        for (const assign of courseObj.assignments) {
          rawAssignments.push(assign);
        }
      }
    }
  } catch (err: any) {
    errors.push({
      context: 'Fetching assignments',
      message: err.message,
    });
  }

  // 3. Parallelize fetching submissions, grades, and course contents
  onProgress(`Fetching details for ${rawAssignments.length} assignments and ${trackedCourseIds.length} courses...`);
  
  const submissionsMap = new Map<number, { status: string; extensionDueDate: number }>();
  const gradesByCmid = new Map<number, RawGradeItem>();
  const cmidToSectionMap = new Map<number, string>();

  await Promise.all([
    // A: Submissions
    batchPromises(rawAssignments, 100, async (assign) => {
      try {
        const statusResp = await client.getSubmissionStatus(assign.id);
        const subStatus = statusResp.lastattempt?.submission?.status || 'new';
        const status = subStatus === 'submitted' ? 'Submitted' : 'Assigned';
        const extensionDueDate = statusResp.lastattempt?.extensionduedate || 0;
        submissionsMap.set(assign.id, { status, extensionDueDate });
      } catch (err: any) {
        errors.push({
          context: `Fetching submission status for assignment ${assign.name} (id: ${assign.id})`,
          message: err.message,
        });
        submissionsMap.set(assign.id, { status: 'Assigned', extensionDueDate: 0 });
      }
    }),

    // B: Grades
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
    }),

    // C: Course Contents
    batchPromises(trackedCourseIds, 100, async (courseId) => {
      const courseName = getCourseDisplayName(courseId);
      try {
        const sections = await client.getCourseContents(courseId);
        for (const section of sections) {
          const sectionName = section.name || '';
          for (const module of section.modules) {
            const modname = module.modname;
            const name = module.name || '';
            const nameLower = name.toLowerCase();

            // Store mapping of assign modules (which are assignments)
            if (modname === 'assign') {
              cmidToSectionMap.set(module.id, sectionName);
            }

            // Files parsing
            if (modname === 'resource' && module.contents) {
              for (const content of module.contents) {
                if (content.type === 'file') {
                  files.push({
                    fileName: content.filename || '',
                    fileUrl: content.fileurl || '',
                    fileSize: content.filesize || 0,
                    mimeType: content.mimetype || 'application/octet-stream',
                    sectionName,
                    timeModified: content.timemodified || 0,
                    courseId,
                    courseName,
                  });
                }
              }
            }

            // Zoom Meetings parsing
            if (modname === 'lti' && nameLower.includes('zoom') && module.instance !== undefined) {
              try {
                const ltiMeetings = await scrapeZoomMeetingsWithToken(token, module.instance, baseUrl);
                for (const lm of ltiMeetings) {
                  meetings.push({
                    title: lm.topic,
                    meetingUrl: lm.joinUrl,
                    sectionName,
                    courseId,
                    courseName,
                    startTime: lm.startTime,
                    meetingNumber: lm.meetingNumber,
                    password: lm.password,
                  });
                }
              } catch (err: any) {
                console.warn(`[SyncEngine] Failed to scrape Zoom meetings for course ${courseName} (module ID: ${module.id}):`, err);
                errors.push({
                  context: `Scraping Zoom meetings for course ${courseName} (module ID: ${module.id})`,
                  message: err.message,
                });
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
    })
  ]);

  // Assemble Assignments
  const now = new Date();
  for (const assign of rawAssignments) {
    const sub = submissionsMap.get(assign.id) || { status: 'Assigned' as const, extensionDueDate: 0 };
    let status: 'Assigned' | 'Submitted' | 'Not submitted' = sub.status as any;

    const dueTs = assign.duedate || 0;
    const cutoffTs = assign.cutoffdate || 0;
    const extTs = sub.extensionDueDate || 0;

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

    const attachments = assign.introattachments
      ? assign.introattachments.map((att) => ({
          name: att.filename,
          url: att.fileurl,
        }))
      : [];

    assignments.push({
      id: assign.id,
      cmid: assign.cmid,
      courseId: assign.course,
      courseName: getCourseDisplayName(assign.course),
      name: assign.name,
      status,
      deadline: deadlineIso,
      opened: openedIso,
      link: `https://moodle.tau.ac.il/mod/assign/view.php?id=${assign.cmid}`,
      grade,
      gradeMax,
      attachments,
    });
  }

  // Assign sectionName to assignments
  for (const assign of assignments) {
    const secName = cmidToSectionMap.get(Number(assign.cmid));
    if (secName) {
      assign.sectionName = secName;
    }
  }

  onProgress('Sync completed.');
  return {
    assignments,
    files,
    meetings,
    errors,
    syncedAt: new Date().toISOString(),
  };
}
