import {
  IMoodleStrategy,
  StrategyContext,
  RestMoodleStrategy,
  AjaxMoodleStrategy,
  ScraperMoodleStrategy,
  executeWithFallback,
} from './strategies/index.js';

export * from './strategies/index.js';

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

export function isValidIsraeliId(id: string): boolean {
  const str = String(id).trim();
  if (str.length === 0 || str.length > 9 || isNaN(Number(str))) return false;
  const padded = str.padStart(9, '0');
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let num = Number(padded.charAt(i)) * ((i % 2) + 1);
    if (num > 9) num = num - 9;
    sum += num;
  }
  return sum % 10 === 0;
}

export function formatFileSize(bytes: number): string {
  if (bytes <= 0 || isNaN(bytes)) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) {
    const kb = Math.round(bytes / 1024);
    return `${kb} KB`;
  }
  const mb = (bytes / (1024 * 1024)).toFixed(1);
  return `${mb} MB`;
}

export function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1 || lastDot === filename.length - 1) return '';
  return filename.substring(lastDot + 1).toUpperCase();
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

export interface RawSubmissionPluginFile {
  filename: string;
  fileurl: string;
  filesize: number;
  mimetype?: string;
}

export interface RawSubmissionStatus {
  lastattempt?: {
    canedit?: boolean;
    cansubmit?: boolean;
    gradingstatus?: string;
    submission?: {
      status: string;
      plugins?: Array<{
        type: string;
        name: string;
        fileareas?: Array<{
          area: string;
          files?: RawSubmissionPluginFile[];
        }>;
      }>;
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
  instance?: number;
  contents?: RawCourseFileContent[];
}

export interface RawCourseSection {
  id: number;
  name: string;
  modules: RawCourseModule[];
}

export interface MoodleClientOptions {
  sesskey?: string;
  devMode?: boolean;
  strategies?: IMoodleStrategy[];
}

export class MoodleClient {
  private strategies: IMoodleStrategy[];
  private restStrategy: RestMoodleStrategy;
  private devMode: boolean;

  constructor(
    private token?: string,
    private baseUrl: string = 'https://moodle.tau.ac.il/webservice/rest/server.php',
    options?: MoodleClientOptions
  ) {
    this.devMode = options?.devMode ?? true;

    const context: StrategyContext = {
      token: this.token,
      sesskey: options?.sesskey,
      baseUrl: this.baseUrl,
      devMode: this.devMode,
    };

    this.restStrategy = new RestMoodleStrategy(context);

    if (options?.strategies && options.strategies.length > 0) {
      this.strategies = options.strategies;
    } else {
      this.strategies = [
        this.restStrategy,
        new AjaxMoodleStrategy(context),
        new ScraperMoodleStrategy(context),
      ];
    }
  }

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

  /**
   * Direct REST API call helper for backwards compatibility.
   */
  public async apiCall(
    wsfunction: string,
    params: Record<string, any> = {},
    method: 'GET' | 'POST' = 'GET'
  ): Promise<any> {
    return this.restStrategy.apiCall(wsfunction, params, method);
  }

  public async getSiteInfo(): Promise<MoodleSiteInfo> {
    return executeWithFallback('getSiteInfo', this.strategies, (s) => s.getSiteInfo(), this.devMode);
  }

  public async getEnrolledCourses(userId: number): Promise<RawMoodleCourse[]> {
    return executeWithFallback(
      'getEnrolledCourses',
      this.strategies,
      (s) => s.getEnrolledCourses(userId),
      this.devMode
    );
  }

  public async getAssignments(): Promise<RawMoodleAssignmentsResponse> {
    return executeWithFallback('getAssignments', this.strategies, (s) => s.getAssignments(), this.devMode);
  }

  public async getSubmissionStatus(assignId: number): Promise<RawSubmissionStatus> {
    return executeWithFallback(
      'getSubmissionStatus',
      this.strategies,
      (s) => s.getSubmissionStatus(assignId),
      this.devMode
    );
  }

  public async getGradeItems(courseId: number, userId: number): Promise<RawGradeReportResponse> {
    return executeWithFallback(
      'getGradeItems',
      this.strategies,
      (s) => s.getGradeItems(courseId, userId),
      this.devMode
    );
  }

  public async getCourseContents(courseId: number): Promise<RawCourseSection[]> {
    return executeWithFallback(
      'getCourseContents',
      this.strategies,
      (s) => s.getCourseContents(courseId),
      this.devMode
    );
  }

  public async uploadFile(filename: string, fileContentBase64: string): Promise<{ itemid: number }> {
    return executeWithFallback(
      'uploadFile',
      this.strategies,
      (s) => s.uploadFile(filename, fileContentBase64),
      this.devMode
    );
  }

  public async saveSubmission(assignId: number, itemId: number): Promise<any> {
    return executeWithFallback(
      'saveSubmission',
      this.strategies,
      (s) => s.saveSubmission(assignId, itemId),
      this.devMode
    );
  }

  public async submitForGrading(assignId: number): Promise<any> {
    return executeWithFallback(
      'submitForGrading',
      this.strategies,
      (s) => s.submitForGrading(assignId),
      this.devMode
    );
  }

  public async getAutoLoginKey(): Promise<{ key: string; autologinurl: string }> {
    return executeWithFallback('getAutoLoginKey', this.strategies, (s) => s.getAutoLoginKey(), this.devMode);
  }

  public buildAuthenticatedFileUrl(fileUrl: string): string {
    if (!this.token) return fileUrl;
    const separator = fileUrl.includes('?') ? '&' : '?';
    return `${fileUrl}${separator}token=${this.token}`;
  }

  public async saveNoodleSettings(settingsJson: string): Promise<void> {
    return executeWithFallback(
      'saveNoodleSettings',
      this.strategies,
      (s) => s.saveNoodleSettings(settingsJson),
      this.devMode
    );
  }

  public async loadNoodleSettings(): Promise<any> {
    return executeWithFallback(
      'loadNoodleSettings',
      this.strategies,
      (s) => s.loadNoodleSettings(),
      this.devMode
    );
  }
}
