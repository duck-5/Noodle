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

export const AJAX_SUPPORTED_OPERATIONS = new Set<string>([
  'getEnrolledCourses',
]);

export class AjaxMoodleStrategy implements IMoodleStrategy {
  public readonly name = 'AJAX';

  constructor(private context: StrategyContext) {}

  public isOperationSupported(operationName: string): boolean {
    return AJAX_SUPPORTED_OPERATIONS.has(operationName);
  }

  private getRootUrl(): string {
    const base = this.context.baseUrl.replace(/\/$/, '');
    return base.replace(/\/webservice\/rest\/server\.php$/, '');
  }

  public async ajaxCall(
    methodname: string,
    args: Record<string, any> = {},
    pathPrefix: string = ''
  ): Promise<any> {
    if (!this.context.sesskey) {
      throw new UnsupportedStrategyError('AJAX', methodname, 'No sesskey configured for AJAX API');
    }

    const root = this.getRootUrl();
    const url = `${root}${pathPrefix}/lib/ajax/service.php?sesskey=${encodeURIComponent(
      this.context.sesskey
    )}&info=${encodeURIComponent(methodname)}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify([{ index: 0, methodname, args }]),
    });

    if (!response.ok) {
      throw new Error(`AJAX HTTP error! status: ${response.status}`);
    }

    const json = await response.json();
    if (json && typeof json === 'object' && !Array.isArray(json)) {
      if (json.error || json.errorcode) {
        throw new MoodleApiError(
          json.errorcode || 'ajax_error',
          json.error || json.message || 'Moodle AJAX call failed'
        );
      }
    }

    if (!Array.isArray(json) || json.length === 0) {
      throw new Error('Unexpected AJAX response format');
    }

    const result = json[0];
    if (result.error) {
      const exc = result.exception || {};
      throw new MoodleApiError(
        exc.errorcode || 'ajax_error',
        exc.message || 'Moodle AJAX call failed',
        exc.link
      );
    }

    return result.data;
  }

  public async getSiteInfo(): Promise<MoodleSiteInfo> {
    // Moodle core does not expose core_webservice_get_site_info over AJAX
    throw new UnsupportedStrategyError('AJAX', 'getSiteInfo', 'Not available via internal AJAX');
  }

  public async getEnrolledCourses(_userId: number): Promise<RawMoodleCourse[]> {
    // core_course_get_enrolled_courses_by_timeline_classification is AJAX-enabled on the root Moodle instance.
    // Note: Past year archives (/2025/, /2024/) must NOT be called with the root sesskey, as foreign sesskeys
    // trigger Moodle CSRF security errors that terminate the active session cookie. Archive courses
    // are safely discovered by ScraperMoodleStrategy via standard HTML GET requests.
    const classifications = ['all', 'inprogress', 'future', 'past', 'favourites'];
    const coursesMap = new Map<number, RawMoodleCourse>();
    const root = this.getRootUrl();

    for (const classification of classifications) {
      try {
        if (this.context.devMode) {
          console.log(`[AjaxStrategy] Requesting timeline courses for classification '${classification}' (limit: 100)...`);
        }

        const data = await this.ajaxCall(
          'core_course_get_enrolled_courses_by_timeline_classification',
          {
            classification,
            limit: 100,
            offset: 0,
            sort: 'fullname',
          }
        );

        if (data && Array.isArray(data.courses)) {
          if (this.context.devMode) {
            console.log(`[AjaxStrategy] Classification '${classification}' returned ${data.courses.length} courses.`);
          }
          for (const c of data.courses) {
            if (c.id > 1 && !coursesMap.has(c.id)) {
              coursesMap.set(c.id, {
                id: c.id,
                fullname: c.fullname || '',
                shortname: c.shortname || c.fullname || '',
                idnumber: c.idnumber || '',
                instanceUrl: root,
              });
            }
          }
        }
      } catch (err: any) {
        if (this.context.devMode) {
          console.warn(`[AjaxStrategy] Classification '${classification}' failed:`, err?.message || err);
        }
      }
    }

    // Also attempt core_course_get_recent_courses if timeline returned nothing
    if (coursesMap.size === 0) {
      try {
        if (this.context.devMode) {
          console.log(`[AjaxStrategy] Attempting core_course_get_recent_courses fallback...`);
        }
        const recent = await this.ajaxCall('core_course_get_recent_courses', {});
        if (Array.isArray(recent)) {
          for (const c of recent) {
            if (c.id > 1 && !coursesMap.has(c.id)) {
              coursesMap.set(c.id, {
                id: c.id,
                fullname: c.fullname || '',
                shortname: c.shortname || c.fullname || '',
                idnumber: c.idnumber || '',
                instanceUrl: root,
              });
            }
          }
        }
      } catch (err: any) {
        if (this.context.devMode) {
          console.warn(`[AjaxStrategy] core_course_get_recent_courses failed:`, err?.message || err);
        }
      }
    }

    if (coursesMap.size === 0) {
      throw new Error('No enrolled courses returned by AJAX timeline service; falling back to Scraper');
    }

    return Array.from(coursesMap.values());
  }

  public async getAssignments(): Promise<RawMoodleAssignmentsResponse> {
    throw new UnsupportedStrategyError('AJAX', 'getAssignments', 'mod_assign_get_assignments is not ajax-enabled');
  }

  public async getSubmissionStatus(_assignId: number): Promise<RawSubmissionStatus> {
    throw new UnsupportedStrategyError('AJAX', 'getSubmissionStatus', 'mod_assign_get_submission_status is not ajax-enabled');
  }

  public async getGradeItems(_courseId: number, _userId: number): Promise<RawGradeReportResponse> {
    throw new UnsupportedStrategyError('AJAX', 'getGradeItems', 'gradereport_user_get_grade_items is not ajax-enabled');
  }

  public async getCourseContents(_courseId: number): Promise<RawCourseSection[]> {
    throw new UnsupportedStrategyError('AJAX', 'getCourseContents', 'core_course_get_contents is not ajax-enabled');
  }

  public async uploadFile(_filename: string, _fileContentBase64: string): Promise<{ itemid: number }> {
    throw new UnsupportedStrategyError('AJAX', 'uploadFile', 'File upload not supported via AJAX service');
  }

  public async saveSubmission(_assignId: number, _itemId: number): Promise<any> {
    throw new UnsupportedStrategyError('AJAX', 'saveSubmission', 'Not supported via AJAX service');
  }

  public async submitForGrading(_assignId: number): Promise<any> {
    throw new UnsupportedStrategyError('AJAX', 'submitForGrading', 'Not supported via AJAX service');
  }

  public async getAutoLoginKey(): Promise<{ key: string; autologinurl: string }> {
    throw new UnsupportedStrategyError('AJAX', 'getAutoLoginKey', 'Not supported via AJAX service');
  }

  public async saveNoodleSettings(_settingsJson: string): Promise<void> {
    throw new UnsupportedStrategyError('AJAX', 'saveNoodleSettings', 'Deferred to Scraper / Storage');
  }

  public async loadNoodleSettings(): Promise<any> {
    throw new UnsupportedStrategyError('AJAX', 'loadNoodleSettings', 'Deferred to Scraper / Storage');
  }
}
