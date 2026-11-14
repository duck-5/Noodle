import {
  MoodleApiError,
  MoodleSiteInfo,
  RawCourseSection,
  RawGradeReportResponse,
  RawMoodleAssignmentsResponse,
  RawMoodleCourse,
  RawSubmissionStatus,
  RawMoodleQuiz,
  RawMoodleQuizAttempt,
} from '../moodleApi.js';
import { IMoodleStrategy, StrategyContext, UnsupportedStrategyError } from './types.js';
import type { CourseStaffMember, PanoptoRecordingType } from '../types.js';
import {
  extractMultilangPersonNames,
  normalizePersonName,
  parseCourseStaffRole,
} from '../panoptoScraper.js';

export class RestMoodleStrategy implements IMoodleStrategy {
  public readonly name = 'REST';
  private static cooldownUntil: number = 0;
  private archiveTokens = new Map<number, string>();
  private courseYearMap = new Map<number, number>();
  private assignYearMap = new Map<number, number>();
  private quizYearMap = new Map<number, number>();
  private cmidYearMap = new Map<number, number>();
  private lang: 'he' | 'en' = 'he';

  constructor(private context: StrategyContext) {
    if (context.lang) {
      this.lang = context.lang;
    }
  }

  public setLanguage(lang: 'he' | 'en'): void {
    this.lang = lang;
  }

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
    if (this.context.enableScraping === false) {
      return true;
    }
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
    if (RestMoodleStrategy.isCoolingDown() && this.context.enableScraping !== false) {
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

    const allParams: Record<string, any> = {
      wstoken: token,
      wsfunction,
      moodlewsrestformat: 'json',
      ...params,
      moodlewssettingfilter: params?.moodlewssettingfilter ?? 'true',
      moodlewssettinglang: params?.moodlewssettinglang ?? this.lang,
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

      if (isAccessOrServiceError && this.context.enableScraping !== false) {
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

    return Array.from(new Map(allCourses.map(c => [c.id, c])).values());
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

  public async getQuizzes(courseIds: number[]): Promise<RawMoodleQuiz[]> {
    if (!courseIds || courseIds.length === 0) return [];
    const currentYear = new Date().getFullYear();
    const urlHost = new URL(this.context.baseUrl).origin;

    // Partition courseIds by their Moodle instance year (root vs archive year)
    const buckets = new Map<number | undefined, number[]>();
    for (const id of courseIds) {
      const yr = this.courseYearMap.get(id);
      const bucketKey = yr && yr !== currentYear ? yr : undefined;
      if (!buckets.has(bucketKey)) buckets.set(bucketKey, []);
      buckets.get(bucketKey)!.push(id);
    }

    const allQuizzes: RawMoodleQuiz[] = [];
    for (const [archiveYear, ids] of buckets.entries()) {
      const params: Record<string, any> = {};
      ids.forEach((id, idx) => {
        params[`courseids[${idx}]`] = id;
      });
      const baseUrlOverride = archiveYear ? `${urlHost}/${archiveYear}` : undefined;
      try {
        const res = await this.apiCall('mod_quiz_get_quizzes_by_courses', params, 'POST', baseUrlOverride);
        if (res && Array.isArray(res.quizzes)) {
          for (const q of res.quizzes) {
            const effectiveYear = archiveYear || this.courseYearMap.get(q.course) || currentYear;
            this.quizYearMap.set(q.id, effectiveYear);
            if (q.coursemodule) {
              this.cmidYearMap.set(q.coursemodule, effectiveYear);
            }
            allQuizzes.push(q);
          }
        }
      } catch (err) {
        console.warn('mod_quiz_get_quizzes_by_courses failed:', err);
      }
    }

    return Array.from(new Map(allQuizzes.map((q) => [q.coursemodule || q.id, q])).values());
  }

  public async getQuizAttempts(quizId: number): Promise<RawMoodleQuizAttempt[]> {
    const currentYear = new Date().getFullYear();
    const year = this.quizYearMap.get(quizId);
    const urlHost = new URL(this.context.baseUrl).origin;
    const baseUrlOverride = year && year !== currentYear ? `${urlHost}/${year}` : undefined;
    try {
      const res = await this.apiCall('mod_quiz_get_user_attempts', {
        quizid: quizId,
        status: 'all',
        includepreviews: 0,
      }, 'POST', baseUrlOverride);
      if (res && Array.isArray(res.attempts)) {
        return res.attempts;
      }
      return [];
    } catch (err) {
      console.warn(`mod_quiz_get_user_attempts for quiz ${quizId} failed:`, err);
      return [];
    }
  }

  public async updateActivityCompletionManually(cmid: number, completed: boolean): Promise<boolean> {
    const currentYear = new Date().getFullYear();
    const year = this.cmidYearMap.get(cmid);
    const urlHost = new URL(this.context.baseUrl).origin;
    const baseUrlOverride = year && year !== currentYear ? `${urlHost}/${year}` : undefined;
    try {
      const res = await this.apiCall('core_completion_update_activity_completion_status_manually', {
        cmid,
        completed: completed ? 1 : 0,
      }, 'POST', baseUrlOverride);
      return Boolean(res && res.status);
    } catch (err) {
      console.warn(`updateActivityCompletionManually for cmid ${cmid} failed:`, err);
      return false;
    }
  }

  public async getCourseContents(courseId: number): Promise<RawCourseSection[]> {
    const year = this.courseYearMap.get(courseId);
    const urlHost = new URL(this.context.baseUrl).origin;
    const baseUrlOverride = year ? `${urlHost}/${year}` : undefined;
    const sections = await this.apiCall('core_course_get_contents', { courseid: courseId }, 'POST', baseUrlOverride);
    if (year && Array.isArray(sections)) {
      for (const sec of sections) {
        if (Array.isArray(sec.modules)) {
          for (const mod of sec.modules) {
            if (mod.id) this.cmidYearMap.set(mod.id, year);
            if (mod.modname === 'quiz' && mod.instance) this.quizYearMap.set(mod.instance, year);
          }
        }
      }
    }
    return sections;
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
    let cleanJson = syncEvent.description.replace(/(<([^>]+)>)/gi, '').trim();
    if (cleanJson.includes('&quot;') || cleanJson.includes('&amp;') || cleanJson.includes('&#39;')) {
      cleanJson = cleanJson
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
    }
    try {
      return JSON.parse(cleanJson);
    } catch (parseErr) {
      console.warn('[RestMoodleStrategy] Malformed JSON in NOODLE_SYNC_DATA calendar event:', parseErr);
      return null;
    }
  }

  public async getCourseStaff(courseId: number): Promise<CourseStaffMember[]> {
    const currentYear = new Date().getFullYear();
    const year = this.courseYearMap.get(courseId);
    const urlHost = new URL(this.context.baseUrl).origin;
    const baseUrlOverride = year && year !== currentYear ? `${urlHost}/${year}` : undefined;
    const tokenOverride = year && year !== currentYear ? this.archiveTokens.get(year) : undefined;

    const users = await this.apiCall(
      'core_enrol_get_enrolled_users',
      {
        courseid: courseId,
        // Keep raw multilang blocks so Hebrew names remain accessible even when Moodle UI lang is 'en'
        moodlewssettingfilter: 'false',
      },
      'POST',
      baseUrlOverride,
      tokenOverride
    );

    if (!Array.isArray(users)) {
      return [];
    }

    const staff: CourseStaffMember[] = [];
    const seen = new Set<string>();

    for (const u of users) {
      const roles: any[] = Array.isArray(u?.roles) ? u.roles : [];
      let resolvedRole: PanoptoRecordingType | null = null;
      let rawRoleLabel = '';

      for (const r of roles) {
        const parsed = parseCourseStaffRole(r?.shortname, r?.name);
        if (parsed === 'Lecture') {
          resolvedRole = 'Lecture';
          rawRoleLabel = String(r?.name || r?.shortname || '');
          break;
        }
        if (parsed === 'Recitation' && !resolvedRole) {
          resolvedRole = 'Recitation';
          rawRoleLabel = String(r?.name || r?.shortname || '');
        }
      }

      if (!resolvedRole) continue;

      const rawFullname =
        String(u?.fullname || '').trim() ||
        `${String(u?.firstname || '').trim()} ${String(u?.lastname || '').trim()}`.trim();
      if (!rawFullname) continue;

      const { primary, english } = extractMultilangPersonNames(rawFullname);
      const displayName = primary || english || rawFullname;
      const dedupeKey = normalizePersonName(displayName) || String(u?.id || '');
      if (!dedupeKey || seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      staff.push({
        userId: typeof u?.id === 'number' ? u.id : undefined,
        fullName: displayName,
        englishName: english,
        role: resolvedRole,
        rawRole: rawRoleLabel || undefined,
      });
    }

    return staff;
  }
}
