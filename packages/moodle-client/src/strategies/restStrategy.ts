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

  private async getArchiveToken(year: number): Promise<{ token: string, userid: number } | null> {
    if (this.archiveTokens.has(year)) {
      // Return cached token. (Userid can be re-fetched or cached, but let's just fetch it below anyway)
    }
    
    try {
      const baseUrl = this.context.baseUrl.replace(/\/$/, '');
      const urlHost = new URL(baseUrl).origin;
      const archiveLoginUrl = `${urlHost}/${year}/login/index.php`;
      
      let res = await fetch(archiveLoginUrl, { credentials: 'include' });
      let html = await res.text();
      
      const samlMatch = html.match(/<form[^>]+action=["']([^"']+)["']/i);
      const samlValMatch = html.match(/<input[^>]+name=["']SAMLResponse["'][^>]+value=["']([^"']+)["']/i);
      
      if (samlMatch && samlValMatch) {
        const actionUrl = this.decodeHtmlEntities(samlMatch[1]);
        const samlResponse = this.decodeHtmlEntities(samlValMatch[1]);
        const body = new URLSearchParams();
        body.append('SAMLResponse', samlResponse);
        
        res = await fetch(actionUrl, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString()
        });
        html = await res.text();
      }
      
      const sessMatch = html.match(/"sesskey":"([^"]+)"/);
      if (!sessMatch) return null;
      const sesskey = sessMatch[1];
      
      const manageUrl = `${urlHost}/${year}/user/managetoken.php`;
      res = await fetch(manageUrl, { credentials: 'include' });
      const manageHtml = await res.text();
      
      const allTokens = [...manageHtml.matchAll(/action=resetwstoken(?:&amp;|&)tokenid=(\d+)/gi)].map(m => m[1]);
      
      for (const tokenId of allTokens) {
        const resetParams = new URLSearchParams();
        resetParams.append('tokenid', tokenId);
        resetParams.append('action', 'resetwstoken');
        resetParams.append('confirm', '1');
        resetParams.append('sesskey', sesskey);
        
        const resetRes = await fetch(manageUrl, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: resetParams.toString()
        });
        
        const resetHtml = await resetRes.text();
        const finalTokenMatch = resetHtml.match(/id="copytoclipboardtoken"[^>]*>([^<]+)<\/div>/i);
        
        if (finalTokenMatch) {
          const candidateToken = finalTokenMatch[1].trim();
          const testUrl = `${urlHost}/${year}`;
          try {
            const siteInfo = await this.apiCall('core_webservice_get_site_info', {}, 'POST', testUrl, candidateToken);
            if (siteInfo && !siteInfo.errorcode && siteInfo.userid) {
              this.archiveTokens.set(year, candidateToken);
              return { token: candidateToken, userid: siteInfo.userid };
            }
          } catch (e) { /* ignore and try next token */ }
        }
      }
    } catch (e) {
      if ((this as any).devMode) console.warn(`[RestStrategy] Failed to get archive token for ${year}:`, e);
    }
    return null;
  }

  private async getYearOverrides(year?: number): Promise<{ baseUrlOverride?: string; tokenOverride?: string }> {
    if (!year) return {};
    const archiveData = await this.getArchiveToken(year);
    if (!archiveData) return {};
    const urlHost = new URL(this.context.baseUrl).origin;
    return {
      baseUrlOverride: `${urlHost}/${year}`,
      tokenOverride: archiveData.token,
    };
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
        code === 'accessexception' ||
        code === 'servicenotavailable' ||
        message.includes('חריגת בקרת גישה') ||
        message.includes('Access to the function');

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
    const rootCourses = await this.apiCall('core_enrol_get_users_courses', { userid: userId });
    if (Array.isArray(rootCourses)) {
      rootCourses.forEach(c => this.courseYearMap.set(c.id, currentYear));
      allCourses.push(...rootCourses);
    }
    
    // 2. Archives (Last year)
    const archiveYears = [currentYear, currentYear - 1]; 
    const urlHost = new URL(this.context.baseUrl).origin;

    for (const year of archiveYears) {
      const archiveData = await this.getArchiveToken(year);
      if (archiveData) {
        const archiveUrl = `${urlHost}/${year}`;
        try {
          const archiveCourses = await this.apiCall('core_enrol_get_users_courses', { userid: archiveData.userid }, 'POST', archiveUrl, archiveData.token);
          if (Array.isArray(archiveCourses)) {
            archiveCourses.forEach(c => this.courseYearMap.set(c.id, year));
            allCourses.push(...archiveCourses);
          }
        } catch (e) {}
      }
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
        this.courseYearMap.set(c.id, currentYear);
        if (Array.isArray(c.assignments)) {
          c.assignments.forEach((a: any) => this.assignYearMap.set(a.id, currentYear));
        }
      });
    }

    const archiveYears = [currentYear, currentYear - 1]; 
    const urlHost = new URL(this.context.baseUrl).origin;

    for (const year of archiveYears) {
      const archiveData = await this.getArchiveToken(year);
      if (archiveData) {
        const archiveUrl = `${urlHost}/${year}`;
        try {
          const aAssigns = await this.apiCall('mod_assign_get_assignments', {}, 'POST', archiveUrl, archiveData.token);
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
    }
    
    if (res && res.courses) {
      res.courses = Array.from(new Map(res.courses.map((c: any) => [c.id, c])).values());
    }
    
    return res;
  }

  public async getSubmissionStatus(assignId: number, cmid?: number): Promise<RawSubmissionStatus> {
    const year = this.assignYearMap.get(assignId);
    const overrides = await this.getYearOverrides(year);
    return this.apiCall('mod_assign_get_submission_status', { assignid: assignId }, 'POST', overrides.baseUrlOverride, overrides.tokenOverride);
  }

  public async getGradeItems(courseId: number, userId: number): Promise<RawGradeReportResponse> {
    const year = this.courseYearMap.get(courseId);
    const overrides = await this.getYearOverrides(year);
    return this.apiCall('gradereport_user_get_grade_items', {
      courseid: courseId,
      userid: userId,
    }, 'POST', overrides.baseUrlOverride, overrides.tokenOverride);
  }

  public async getCourseContents(courseId: number): Promise<RawCourseSection[]> {
    const year = this.courseYearMap.get(courseId);
    const overrides = await this.getYearOverrides(year);
    return this.apiCall('core_course_get_contents', { courseid: courseId }, 'POST', overrides.baseUrlOverride, overrides.tokenOverride);
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
