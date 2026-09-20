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

  constructor(private context: StrategyContext) {}

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
    method: 'GET' | 'POST' = 'GET'
  ): Promise<any> {
    if (RestMoodleStrategy.isCoolingDown()) {
      const remainingMins = Math.ceil(RestMoodleStrategy.getCooldownRemainingMs() / 60000);
      throw new UnsupportedStrategyError(
        'REST',
        wsfunction,
        `REST strategy in cooldown (${remainingMins}m remaining after mobile plugin failure)`
      );
    }

    if (!this.context.token) {
      throw new UnsupportedStrategyError('REST', wsfunction, 'No wstoken provided');
    }

    const allParams = {
      wstoken: this.context.token,
      wsfunction,
      moodlewsrestformat: 'json',
      ...params,
    };

    let url = this.getRestEndpoint();
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
    return this.apiCall('core_enrol_get_users_courses', { userid: userId });
  }

  public async getAssignments(): Promise<RawMoodleAssignmentsResponse> {
    return this.apiCall('mod_assign_get_assignments');
  }

  public async getSubmissionStatus(assignId: number): Promise<RawSubmissionStatus> {
    return this.apiCall('mod_assign_get_submission_status', { assignid: assignId });
  }

  public async getGradeItems(courseId: number, userId: number): Promise<RawGradeReportResponse> {
    return this.apiCall('gradereport_user_get_grade_items', {
      courseid: courseId,
      userid: userId,
    });
  }

  public async getCourseContents(courseId: number): Promise<RawCourseSection[]> {
    return this.apiCall('core_course_get_contents', { courseid: courseId });
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
