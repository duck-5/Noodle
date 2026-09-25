import {
  MoodleApiError,
  MoodleSiteInfo,
  RawCourseSection,
  RawGradeReportResponse,
  RawMoodleAssignmentsResponse,
  RawMoodleCourse,
  RawSubmissionStatus,
} from '../moodleApi.js';
import { IMoodleStrategy, StrategyContext, UnsupportedStrategyError } from './types.js';

export class RestMoodleStrategy implements IMoodleStrategy {
  public readonly name = 'REST';
  private static cooldownUntil: number = 0;
  private archiveTokens = new Map<number, string>();
  private courseYearMap = new Map<number, number>();
  private assignYearMap = new Map<number, number>();

  constructor(private context: StrategyContext) {}

  private decodeHtmlEntities(text: string): string {
    const entities: { [key: string]: string } = {
      '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'"
    };
    return text.replace(/&[#\w]+;/g, (m) => entities[m] || m);
  }



  public setToken(token: string): void {
    this.context.token = token;
  }

  public static markUnavailable(durationMs: number = 60 * 60 * 1000): void {
    RestMoodleStrategy.cooldownUntil = Date.now() + durationMs;
  }

  public static isCoolingDown(): boolean {
    return Date.now() < RestMoodleStrategy.cooldownUntil;
  }

  public static getCooldownRemainingMs(): number {
    return Math.max(0, RestMoodleStrategy.cooldownUntil - Date.now());
  }

  public static resetCooldown(): void {
    RestMoodleStrategy.cooldownUntil = 0;
  }

  public isOperationSupported(_operationName: string): boolean {
    return !RestMoodleStrategy.isCoolingDown();
  }

  private getRestEndpoint(): string {
    const base = this.context.baseUrl.replace(/\/$/, '');
    if (base.endsWith('/webservice/rest/server.php')) {
      return base;
    }
    return `${base}/webservice/rest/server.php`;
  }

  public async apiCall(
    wsfunction: string,
    params: Record<string, any> = {},
    method: 'GET' | 'POST' = 'GET',
    baseUrlOverride?: string,
    tokenOverride?: string
  ): Promise<any> {
    if (RestMoodleStrategy.isCoolingDown()) {
      const remainingMins = Math.ceil(RestMoodleStrategy.getCooldownRemainingMs() / 60000);
      throw new UnsupportedStrategyError(
        'REST',
        wsfunction,
        `REST strategy in cooldown (${remainingMins}m remaining after mobile plugin failure)`
      );
    }

    const token = tokenOverride || this.context.token;
    if (!token) {
      throw new UnsupportedStrategyError('REST', wsfunction, 'No wstoken provided');
    }

    const allParams = {
      wstoken: token,
      wsfunction,
      moodlewsrestformat: 'json',
      ...params,
    };

    let url = baseUrlOverride || this.getRestEndpoint();
    if (baseUrlOverride && !url.endsWith('/webservice/rest/server.php')) {
        url = `${url}/webservice/rest/server.php`;
    }
    const options: RequestInit = { method };

    if (method === 'GET') {
      const urlParams = new URLSearchParams();
      for (const [key, value] of Object.entries(allParams)) {
        if (value !== undefined && value !== null) {
          urlParams.append(key, String(value));
        }
      }
      url = `${url}?${urlParams.toString()}`;
    } else {
      const bodyParams = new URLSearchParams();
      for (const [key, value] of Object.entries(allParams)) {
        if (value !== undefined && value !== null) {
          bodyParams.append(key, String(value));
        }
      }
      options.body = bodyParams;
      options.headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
      };
    }

    const response = await fetch(url, options);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    if (data && typeof data === 'object') {
      const code = data.errorcode || '';
      const message = String(data.message || '');
      const isAccessOrServiceError =
        code === 'servicenotavailable' ||
        (wsfunction === 'core_webservice_get_site_info' && (
          code === 'accessexception' || 
          message.includes('חריגת בקרת גישה') || 
          message.includes('Access to the function')
        ));

      if (isAccessOrServiceError) {
        RestMoodleStrategy.markUnavailable(60 * 60 * 1000);
      }

      if ('exception' in data) {
        throw new MoodleApiError(
          data.errorcode || 'exception',
          data.message || 'Moodle API Exception',
          data.exception
        );
      }
      if ('errorcode' in data) {
        throw new MoodleApiError(data.errorcode, data.message || 'Moodle API Error');
      }
    }
    return data;
  }

  public async getSiteInfo(): Promise<MoodleSiteInfo> {
    return this.apiCall('core_webservice_get_site_info');
  }

  public async getEnrolledCourses(userId: number): Promise<RawMoodleCourse[]> {
    const allCourses: RawMoodleCourse[] = [];
    const currentYear = new Date().getFullYear();
    
    // 1. Root
    let rootCourses: any[] = [];
    try {
      rootCourses = await this.apiCall('core_enrol_get_users_courses', { userid: userId });
    } catch (err: any) {
      if (err instanceof MoodleApiError && err.errorcode === 'accessexception') {
        if (this.context.devMode) console.log("[MoodleClient] REST fallback: 'core_enrol_get_users_courses' blocked. Trying 'core_course_get_enrolled_courses_by_timeline_classification'...");
        try {
          const timelineRes = await this.apiCall('core_course_get_enrolled_courses_by_timeline_classification', {
            classification: 'all',
            limit: 100,
            offset: 0,
            sort: 'fullname'
          });
          if (timelineRes && Array.isArray(timelineRes.courses)) {
            rootCourses = timelineRes.courses;
          }
        } catch (innerErr) {
          throw err; // throw original if fallback fails
        }
      } else {
        throw err;
      }
    }

    if (Array.isArray(rootCourses)) {
      rootCourses.forEach(c => {
        let year = String(currentYear);
        if (c.idnumber) {
          const match = c.idnumber.match(/^(\d{4}-?\d{4})-(\d{2})-(\d{4})-(\d)$/);
          if (match) year = match[3];
        } else if (c.fullname) {
          const match = c.fullname.match(/\b(20\d{2})\b/);
          if (match) year = match[1];
        }
        c.year = year;
        c.instanceUrl = `${new URL(this.context.baseUrl).origin}/${year === String(currentYear) ? '' : year}`;
        this.courseYearMap.set(c.id, parseInt(year, 10));
      });
      allCourses.push(...rootCourses);
    }
    
    // 2. Archives (Last year)
    const archiveYears = [currentYear, currentYear - 1]; 
    const urlHost = new URL(this.context.baseUrl).origin;

    for (const year of archiveYears) {
      const archiveUrl = `${urlHost}/${year}`;
      try {
        const archiveCourses = await this.apiCall('core_enrol_get_users_courses', { userid: userId }, 'POST', archiveUrl);
        if (Array.isArray(archiveCourses)) {
          archiveCourses.forEach(c => this.courseYearMap.set(c.id, year));
          allCourses.push(...archiveCourses);
        }
      } catch (e) {}
    }
    // Deduplicate by course ID (in case the current year archive redirects back to root)
    const uniqueCourses = Array.from(new Map(allCourses.map(c => [c.id, c])).values());
    
    return uniqueCourses;
  }

  public async getAssignments(): Promise<RawMoodleAssignmentsResponse> {
    const res = await this.apiCall('mod_assign_get_assignments');
    
    const currentYear = new Date().getFullYear();
    if (res && Array.isArray(res.courses)) {
      res.courses.forEach((c: any) => {
        let year = String(currentYear);
        if (c.shortname) {
          const match = c.shortname.match(/^(\d{4}-?\d{4})-(\d{2})-(\d{4})-(\d)$/);
          if (match) year = match[3];
        } 
        if (year === String(currentYear) && c.fullname) {
          const match = c.fullname.match(/\b(20\d{2})\b/);
          if (match) year = match[1];
        }
        this.courseYearMap.set(c.id, parseInt(year, 10));
        if (Array.isArray(c.assignments)) {
          c.assignments.forEach((a: any) => this.assignYearMap.set(a.id, parseInt(year, 10)));
        }
      });
    }

    const archiveYears = [currentYear, currentYear - 1]; 
    const urlHost = new URL(this.context.baseUrl).origin;

    for (const year of archiveYears) {
      const archiveUrl = `${urlHost}/${year}`;
      try {
        const aAssigns = await this.apiCall('mod_assign_get_assignments', {}, 'POST', archiveUrl);
        if (aAssigns && Array.isArray(aAssigns.courses)) {
          aAssigns.courses.forEach((c: any) => {
            this.courseYearMap.set(c.id, year);
            if (Array.isArray(c.assignments)) {
              c.assignments.forEach((a: any) => this.assignYearMap.set(a.id, year));
            }
          });
          if (!res.courses) res.courses = [];
          res.courses.push(...aAssigns.courses);
        }
      } catch (e) {}
    }
    
    if (res && res.courses) {
      res.courses = Array.from(new Map(res.courses.map((c: any) => [c.id, c])).values());
    }
    
    return res;
  }

  public async getSubmissionStatus(assignId: number, cmid?: number): Promise<RawSubmissionStatus> {
    const year = this.assignYearMap.get(assignId);
    const urlHost = new URL(this.context.baseUrl).origin;
    const baseUrlOverride = year ? `${urlHost}/${year}` : undefined;
    return this.apiCall('mod_assign_get_submission_status', { assignid: assignId }, 'POST', baseUrlOverride);
  }

  public async getGradeItems(courseId: number, userId: number): Promise<RawGradeReportResponse> {
    const year = this.courseYearMap.get(courseId);
    const urlHost = new URL(this.context.baseUrl).origin;
    const baseUrlOverride = year ? `${urlHost}/${year}` : undefined;
    return this.apiCall('gradereport_user_get_grade_items', {
      courseid: courseId,
      userid: userId
    }, 'POST', baseUrlOverride);
  }

  public async getCourseContents(courseId: number): Promise<RawCourseSection[]> {
    const year = this.courseYearMap.get(courseId);
    const urlHost = new URL(this.context.baseUrl).origin;
    const baseUrlOverride = year ? `${urlHost}/${year}` : undefined;
    return this.apiCall('core_course_get_contents', { courseid: courseId }, 'POST', baseUrlOverride);
  }

  public async uploadFile(filename: string, fileContentBase64: string): Promise<{ itemid: number }> {
    return this.apiCall(
      'core_files_upload',
      {
        component: 'user',
        filearea: 'draft',
        itemid: 0,
        filepath: '/',
        filename,
        filecontent: fileContentBase64,
      },
      'POST'
    );
  }

  public async saveSubmission(assignId: number, itemId: number): Promise<any> {
    return this.apiCall(
      'mod_assign_save_submission',
      {
        assignmentid: assignId,
        'plugindata[files_filemanager]': itemId,
      },
      'POST'
    );
  }

  public async submitForGrading(assignId: number): Promise<any> {
    return this.apiCall(
      'mod_assign_submit_for_grading',
      {
        assignmentid: assignId,
        acceptsubmissionstatement: 1,
      },
      'POST'
    );
  }

  public async getAutoLoginKey(): Promise<{ key: string; autologinurl: string }> {
    return this.apiCall('tool_mobile_get_autologin_key');
  }

  public async saveNoodleSettings(settingsJson: string): Promise<void> {
    const response = await this.apiCall('core_calendar_get_calendar_events', {
      'events[eventids][0]': 0,
      'options[userevents]': 1,
      'options[timeend]': 4102444800 + 86400,
      'options[timestart]': 4102444800 - 86400,
    });

    if (response && response.events) {
      const existingEvents = response.events.filter((e: any) => e.name === 'NOODLE_SYNC_DATA');
      if (existingEvents.length > 0) {
        const deleteParams: Record<string, any> = {};
        for (let i = 0; i < existingEvents.length; i++) {
          deleteParams[`events[${i}][eventid]`] = existingEvents[i].id;
          deleteParams[`events[${i}][repeat]`] = 0;
        }
        try {
          await this.apiCall('core_calendar_delete_calendar_events', deleteParams, 'POST');
        } catch (e: any) {
          console.warn('[RestMoodleStrategy] Failed to delete old sync events:', e);
        }
      }
    }

    await this.apiCall(
      'core_calendar_create_calendar_events',
      {
        'events[0][name]': 'NOODLE_SYNC_DATA',
        'events[0][description]': settingsJson,
        'events[0][eventtype]': 'user',
        'events[0][timestart]': 4102444800, // Year 2100
      },
      'POST'
    );
  }

  public async loadNoodleSettings(): Promise<any> {
    const response = await this.apiCall('core_calendar_get_calendar_events', {
      'events[eventids][0]': 0,
      'options[userevents]': 1,
      'options[timeend]': 4102444800 + 86400,
      'options[timestart]': 4102444800 - 86400,
    });

    if (!response || !response.events) return null;
    const allEvents = response.events.filter((e: any) => e.name === 'NOODLE_SYNC_DATA');
    if (allEvents.length === 0) return null;

    allEvents.sort((a: any, b: any) => b.id - a.id);
    const syncEvent = allEvents[0];
    const cleanJson = syncEvent.description.replace(/(<([^>]+)>)/gi, '').trim();
    return JSON.parse(cleanJson);
  }
}
