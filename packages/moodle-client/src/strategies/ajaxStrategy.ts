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

export class AjaxMoodleStrategy implements IMoodleStrategy {
  public readonly name = 'AJAX';

  constructor(private context: StrategyContext) {}

  private getRootUrl(): string {
    const base = this.context.baseUrl.replace(/\/$/, '');
    return base.replace(/\/webservice\/rest\/server\.php$/, '');
  }

  public async ajaxCall(methodname: string, args: Record<string, any> = {}): Promise<any> {
    if (!this.context.sesskey) {
      throw new UnsupportedStrategyError('AJAX', methodname, 'No sesskey configured for AJAX API');
    }

    const root = this.getRootUrl();
    const url = `${root}/lib/ajax/service.php?sesskey=${encodeURIComponent(
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
    // core_course_get_enrolled_courses_by_timeline_classification is AJAX-enabled in Moodle 4.x
    const data = await this.ajaxCall(
      'core_course_get_enrolled_courses_by_timeline_classification',
      {
        classification: 'all',
        limit: 0,
        offset: 0,
        sort: 'fullname',
      }
    );

    if (data && Array.isArray(data.courses)) {
      return data.courses.map((c: any) => ({
        id: c.id,
        fullname: c.fullname || '',
        shortname: c.shortname || '',
        idnumber: c.idnumber || '',
      }));
    }

    return [];
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
