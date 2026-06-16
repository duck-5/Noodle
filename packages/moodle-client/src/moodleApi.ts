export class MoodleApiError extends Error {
  constructor(
    public errorcode: string,
    message: string,
    public exception?: string
  ) {
    super(message);
    this.name = 'MoodleApiError';
  }
}

export interface MoodleSiteInfo {
  userid: number;
  username: string;
  fullname: string;
  sitename: string;
}

export interface RawMoodleCourse {
  id: number;
  shortname: string;
  fullname: string;
  idnumber: string;
}

export interface RawMoodleAssignment {
  id: number;
  cmid: number;
  course: number;
  name: string;
  duedate: number;
  cutoffdate: number;
  allowsubmissionsfromdate: number;
  introattachments?: Array<{
    filename: string;
    fileurl: string;
  }>;
}

export interface RawMoodleAssignmentCourse {
  id: number;
  fullname: string;
  shortname: string;
  assignments: RawMoodleAssignment[];
}

export interface RawMoodleAssignmentsResponse {
  courses: RawMoodleAssignmentCourse[];
}

export interface RawSubmissionStatus {
  lastattempt?: {
    submission?: {
      status: string;
    };
    extensionduedate?: number;
  };
}

export interface RawGradeItem {
  itemtype: string;
  itemmodule: string;
  cmid: number | null;
  gradeformatted: string;
  graderaw: number | null;
  grademax: number;
  gradeishidden: boolean;
}

export interface RawUserGrade {
  courseid: number;
  userid: number;
  gradeitems: RawGradeItem[];
}

export interface RawGradeReportResponse {
  usergrades: RawUserGrade[];
}

export interface RawCourseFileContent {
  type: string;
  filename: string;
  fileurl: string;
  filesize: number;
  mimetype: string;
  timemodified: number;
}

export interface RawCourseModule {
  id: number;
  name: string;
  modname: string;
  url?: string;
  contents?: RawCourseFileContent[];
}

export interface RawCourseSection {
  id: number;
  name: string;
  modules: RawCourseModule[];
}

export class MoodleClient {
  constructor(
    private token: string,
    private baseUrl: string = 'https://moodle.tau.ac.il/webservice/rest/server.php'
  ) {}

  public static async fetchToken(
    username: string,
    password: string,
    baseUrl: string = 'https://moodle.tau.ac.il'
  ): Promise<string> {
    const url = `${baseUrl}/login/token.php?username=${encodeURIComponent(
      username
    )}&password=${encodeURIComponent(password)}&service=moodle_mobile_app`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    if (data.error) {
      throw new Error(data.error);
    }
    if (!data.token) {
      throw new Error('Failed to retrieve token: unexpected response');
    }
    return data.token;
  }

  private async apiCall(
    wsfunction: string,
    params: Record<string, any> = {},
    method: 'GET' | 'POST' = 'GET'
  ): Promise<any> {
    const allParams = {
      wstoken: this.token,
      wsfunction,
      moodlewsrestformat: 'json',
      ...params,
    };

    let url = this.baseUrl;
    const options: RequestInit = { method };

    if (method === 'GET') {
      const urlParams = new URLSearchParams();
      for (const [key, value] of Object.entries(allParams)) {
        if (value !== undefined && value !== null) {
          urlParams.append(key, String(value));
        }
      }
      url = `${this.baseUrl}?${urlParams.toString()}`;
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

  public buildAuthenticatedFileUrl(fileUrl: string): string {
    const separator = fileUrl.includes('?') ? '&' : '?';
    return `${fileUrl}${separator}token=${this.token}`;
  }
}
