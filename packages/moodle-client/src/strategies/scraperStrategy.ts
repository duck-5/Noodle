import {
  MoodleSiteInfo,
  RawCourseFileContent,
  RawCourseModule,
  RawCourseSection,
  RawGradeItem,
  RawGradeReportResponse,
  RawMoodleAssignment,
  RawMoodleAssignmentsResponse,
  RawMoodleCourse,
  RawSubmissionPluginFile,
  RawSubmissionStatus,
} from '../moodleApi.js';
import { IMoodleStrategy, StrategyContext, UnsupportedStrategyError } from './types.js';

export function decodeHtmlEntities(text: string): string {
  if (!text) return '';
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x3d;/gi, '=')
    .replace(/&#x3D;/gi, '=')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .trim();
}

function stripHtmlTags(html: string): string {
  if (!html) return '';
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, '').trim());
}

export class ScraperMoodleStrategy implements IMoodleStrategy {
  public readonly name = 'Scraper';

  constructor(private context: StrategyContext) {}

  private getRootUrl(): string {
    const base = this.context.baseUrl.replace(/\/$/, '');
    return base.replace(/\/webservice\/rest\/server\.php$/, '');
  }

  private async fetchHtml(pathOrUrl: string): Promise<string> {
    const root = this.getRootUrl();
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${root}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;

    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error(`Scraper HTTP error! status: ${response.status} for URL: ${url}`);
    }

    return response.text();
  }

  public async getSiteInfo(): Promise<MoodleSiteInfo> {
    const html = await this.fetchHtml('/my/');

    // 1. Extract User ID
    let userid = 0;
    const uidMatch =
      html.match(/"userid"\s*:\s*"?(\d+)"?/i) ||
      html.match(/data-userid="(\d+)"/i) ||
      html.match(/\/user\/(?:profile|view)\.php\?id=(\d+)/i) ||
      html.match(/"sesskey"\s*:\s*"[^"]+"\s*,\s*"userid"\s*:\s*(\d+)/i);

    if (uidMatch) {
      userid = parseInt(uidMatch[1], 10);
    }

    // 2. Extract Full Name
    let fullname = 'Student';
    const nameMatch =
      html.match(/<span[^>]+class="[^"]*usertext[^"]*"[^>]*>([^<]+)<\/span>/i) ||
      html.match(/<span[^>]+class="[^"]*user-fullname[^"]*"[^>]*>([^<]+)<\/span>/i) ||
      html.match(/alt="User picture of ([^"]+)"/i) ||
      html.match(/alt="תמונת המשתמש של ([^"]+)"/i);

    if (nameMatch) {
      fullname = decodeHtmlEntities(nameMatch[1].trim());
    }

    // 3. Extract Sitename
    let sitename = 'Moodle TAU';
    const siteMatch = html.match(/<title>([^<]+)<\/title>/i);
    if (siteMatch) {
      sitename = decodeHtmlEntities(siteMatch[1].trim());
    }

    // 4. Extract Username
    let username = String(userid || 'user');
    const uNameMatch = html.match(/"username"\s*:\s*"([^"]+)"/i);
    if (uNameMatch) {
      username = uNameMatch[1];
    }

    return {
      userid,
      username,
      fullname,
      sitename,
    };
  }

  public async getEnrolledCourses(_userId: number): Promise<RawMoodleCourse[]> {
    const html = await this.fetchHtml('/my/');
    const coursesMap = new Map<number, RawMoodleCourse>();

    // 1. Match standard course cards or links: /course/view.php?id=(\d+)
    const courseRegex = /<a[^>]+href="[^"]*\/course\/view\.php\?id=(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
    let match: RegExpExecArray | null;

    while ((match = courseRegex.exec(html)) !== null) {
      const id = parseInt(match[1], 10);
      if (isNaN(id) || id <= 1) continue;

      const rawText = match[2];
      const cleanText = stripHtmlTags(rawText);
      if (!cleanText || cleanText.length < 2) continue;

      // Extract shortname/idnumber if format is "0368111801 - Course Name"
      const parts = cleanText.split('-');
      let shortname = cleanText;
      let idnumber = '';

      if (parts.length >= 2) {
        idnumber = parts[0].trim();
        shortname = cleanText;
      }

      if (!coursesMap.has(id)) {
        coursesMap.set(id, {
          id,
          fullname: cleanText,
          shortname,
          idnumber,
        });
      }
    }

    // 2. Also check if courses are in M.cfg or JSON script tags on dashboard
    const jsonMatches = html.matchAll(/data-course-id="(\d+)"[^>]*aria-label="([^"]+)"/gi);
    for (const jm of jsonMatches) {
      const id = parseInt(jm[1], 10);
      const fullname = decodeHtmlEntities(jm[2]);
      if (id > 1 && !coursesMap.has(id)) {
        coursesMap.set(id, {
          id,
          fullname,
          shortname: fullname,
          idnumber: '',
        });
      }
    }

    return Array.from(coursesMap.values());
  }

  public async getAssignments(): Promise<RawMoodleAssignmentsResponse> {
    // In Moodle web, upcoming assignments are displayed on /calendar/view.php?view=upcoming
    // and dashboard timeline. Let's fetch /calendar/view.php?view=upcoming.
    const html = await this.fetchHtml('/calendar/view.php?view=upcoming');
    const coursesMap = new Map<number, { id: number; fullname: string; shortname: string; assignments: RawMoodleAssignment[] }>();

    // Event blocks in upcoming calendar view:
    // <div class="event" data-event-id="..." ...>
    // Link to assignment: <a href=".../mod/assign/view.php?id=(\d+)">Name</a>
    // Due date: <span class="date">...</span>
    // Course link: <a href=".../course/view.php?id=(\d+)">Course Name</a>
    const eventRegex = /<div[^>]+class="[^"]*event[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
    let eventMatch: RegExpExecArray | null;

    while ((eventMatch = eventRegex.exec(html)) !== null) {
      const eventHtml = eventMatch[1];
      const assignMatch = eventHtml.match(/\/mod\/assign\/view\.php\?id=(\d+)[^>]*>([^<]+)<\/a>/i);
      if (!assignMatch) continue;

      const cmid = parseInt(assignMatch[1], 10);
      const name = decodeHtmlEntities(assignMatch[2]);

      const courseMatch = eventHtml.match(/\/course\/view\.php\?id=(\d+)[^>]*>([^<]+)<\/a>/i);
      const courseId = courseMatch ? parseInt(courseMatch[1], 10) : 0;
      const courseName = courseMatch ? decodeHtmlEntities(courseMatch[2]) : `Course ${courseId}`;

      // Extract timestamp or date string if available
      let duedate = 0;
      const timeMatch = eventHtml.match(/data-timestamp="(\d+)"/i);
      if (timeMatch) {
        duedate = parseInt(timeMatch[1], 10);
      }

      if (!coursesMap.has(courseId)) {
        coursesMap.set(courseId, {
          id: courseId,
          fullname: courseName,
          shortname: courseName,
          assignments: [],
        });
      }

      coursesMap.get(courseId)!.assignments.push({
        id: cmid,
        cmid,
        course: courseId,
        name,
        duedate,
        cutoffdate: 0,
        allowsubmissionsfromdate: 0,
      });
    }

    return {
      courses: Array.from(coursesMap.values()),
    };
  }

  public async getSubmissionStatus(assignId: number): Promise<RawSubmissionStatus> {
    const html = await this.fetchHtml(`/mod/assign/view.php?id=${assignId}`);

    const isSubmitted =
      html.includes('הוגש להערכה') ||
      html.includes('Submitted for grading') ||
      html.includes('submissionstatussubmitted');

    const isGraded =
      html.includes('הוערך') ||
      html.includes('Graded') ||
      html.includes('submissiongraded');

    // Extract submitted files if present
    const submittedFiles: RawSubmissionPluginFile[] = [];
    const fileMatches = html.matchAll(/<a[^>]+href="([^"]*\/pluginfile\.php\/[^"]+)"[^>]*>([^<]+)<\/a>/gi);
    for (const fm of fileMatches) {
      const fileurl = decodeHtmlEntities(fm[1]);
      const filename = decodeHtmlEntities(fm[2]);
      if (fileurl && filename && !fileurl.includes('/user/icon/')) {
        submittedFiles.push({
          filename,
          fileurl,
          filesize: 0,
        });
      }
    }

    return {
      lastattempt: {
        gradingstatus: isGraded ? 'graded' : 'notgraded',
        submission: {
          status: isSubmitted ? 'submitted' : 'new',
          plugins: [
            {
              type: 'file',
              name: 'File submissions',
              fileareas: [
                {
                  area: 'submission_files',
                  files: submittedFiles,
                },
              ],
            },
          ],
        },
      },
    };
  }

  public async getGradeItems(courseId: number, _userId: number): Promise<RawGradeReportResponse> {
    const html = await this.fetchHtml(`/grade/report/user/index.php?id=${courseId}`);
    const gradeitems: RawGradeItem[] = [];

    // Each row in the user grade table:
    // <tr ...> <th class="... item ..."><a href=".../mod/assign/view.php?id=(\d+)">Item Name</a> ... <td class="... grade ...">95.00</td>
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch: RegExpExecArray | null;

    while ((rowMatch = rowRegex.exec(html)) !== null) {
      const rowHtml = rowMatch[1];
      const assignLinkMatch = rowHtml.match(/\/mod\/assign\/view\.php\?id=(\d+)[^>]*>([^<]+)<\/a>/i);
      if (!assignLinkMatch) continue;

      const cmid = parseInt(assignLinkMatch[1], 10);
      const gradeMatch = rowHtml.match(/<td[^>]+class="[^"]*column-grade[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
      const gradeText = gradeMatch ? stripHtmlTags(gradeMatch[1]) : '';
      const rawNum = parseFloat(gradeText);

      gradeitems.push({
        itemtype: 'mod',
        itemmodule: 'assign',
        cmid,
        gradeformatted: gradeText || '-',
        graderaw: isNaN(rawNum) ? null : rawNum,
        grademax: 100,
        gradeishidden: false,
      });
    }

    return {
      usergrades: [
        {
          courseid: courseId,
          userid: _userId,
          gradeitems,
        },
      ],
    };
  }

  public async getCourseContents(courseId: number): Promise<RawCourseSection[]> {
    const html = await this.fetchHtml(`/course/view.php?id=${courseId}`);
    const sections: RawCourseSection[] = [];

    // Match sections: <li id="section-(\d+)" class="section ..."> or <div class="course-section" ...>
    const sectionRegex = /<(?:li|section|div)[^>]+id="section-(\d+)"[^>]*>([\s\S]*?)(?=<(?:li|section|div)[^>]+id="section-\d+"|<\/(?:ul|section)>|$)/gi;
    let secMatch: RegExpExecArray | null;

    while ((secMatch = sectionRegex.exec(html)) !== null) {
      const secId = parseInt(secMatch[1], 10);
      const secHtml = secMatch[2];

      const nameMatch =
        secHtml.match(/<h[234][^>]+class="[^"]*sectionname[^"]*"[^>]*>([\s\S]*?)<\/h[234]>/i) ||
        secHtml.match(/<span[^>]+class="[^"]*sectionname[^"]*"[^>]*>([\s\S]*?)<\/span>/i);

      const sectionName = nameMatch ? stripHtmlTags(nameMatch[1]) : `Section ${secId}`;
      const modules: RawCourseModule[] = [];

      // Match activities in this section:
      // <li class="activity ([^"]*) modtype_([^" ]*)" id="module-(\d+)">
      const modRegex = /<(?:li|div)[^>]+class="[^"]*modtype_([a-z0-9_]+)[^"]*"[^>]+id="module-(\d+)"[^>]*>([\s\S]*?)(?=<(?:li|div)[^>]+class="[^"]*modtype_|<\/ul>|$)/gi;
      let mMatch: RegExpExecArray | null;

      while ((mMatch = modRegex.exec(secHtml)) !== null) {
        const modname = mMatch[1];
        const moduleId = parseInt(mMatch[2], 10);
        const modHtml = mMatch[3];

        const instMatch = modHtml.match(/<span[^>]+class="[^"]*instancename[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
        const modName = instMatch ? stripHtmlTags(instMatch[1]) : `${modname} ${moduleId}`;

        const contents: RawCourseFileContent[] = [];

        // If it's a resource/file, extract pluginfile URL
        if (modname === 'resource' || modname === 'folder') {
          const fileMatch = modHtml.match(/<a[^>]+href="([^"]*(?:pluginfile\.php|mod\/resource\/view\.php)[^"]*)"[^>]*>/i);
          if (fileMatch) {
            const fileurl = decodeHtmlEntities(fileMatch[1]);
            contents.push({
              type: 'file',
              filename: modName,
              fileurl,
              filesize: 0,
              mimetype: 'application/octet-stream',
              timemodified: 0,
            });
          }
        }

        modules.push({
          id: moduleId,
          name: modName,
          modname,
          url: `${this.getRootUrl()}/mod/${modname}/view.php?id=${moduleId}`,
          instance: moduleId,
          contents: contents.length > 0 ? contents : undefined,
        });
      }

      sections.push({
        id: secId,
        name: sectionName,
        modules,
      });
    }

    return sections;
  }

  public async uploadFile(_filename: string, _fileContentBase64: string): Promise<{ itemid: number }> {
    throw new UnsupportedStrategyError('Scraper', 'uploadFile', 'Use REST strategy for direct file uploads');
  }

  public async saveSubmission(_assignId: number, _itemId: number): Promise<any> {
    throw new UnsupportedStrategyError('Scraper', 'saveSubmission', 'Web submission saving not yet automated via scraper');
  }

  public async submitForGrading(_assignId: number): Promise<any> {
    throw new UnsupportedStrategyError('Scraper', 'submitForGrading', 'Submission statement not automated via scraper');
  }

  public async getAutoLoginKey(): Promise<{ key: string; autologinurl: string }> {
    throw new UnsupportedStrategyError('Scraper', 'getAutoLoginKey', 'Auto-login keys are REST exclusive');
  }

  public async saveNoodleSettings(_settingsJson: string): Promise<void> {
    throw new UnsupportedStrategyError('Scraper', 'saveNoodleSettings', 'Calendar settings saving deferred to browser storage');
  }

  public async loadNoodleSettings(): Promise<any> {
    const html = await this.fetchHtml('/calendar/view.php?view=upcoming');
    const syncMatch = html.match(/NOODLE_SYNC_DATA[\s\S]*?<div[^>]+class="description[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (!syncMatch) return null;

    const rawJson = stripHtmlTags(syncMatch[1]);
    try {
      return JSON.parse(rawJson);
    } catch {
      return null;
    }
  }
}
