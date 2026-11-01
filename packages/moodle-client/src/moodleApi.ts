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
  year?: string;
  instanceUrl?: string;
  format?: string;
  coursecategory?: string;
  startdate?: number;
  enddate?: number;
  section?: number;
  visible?: number;
  uservisible?: boolean;
  summary?: string;
  summaryformat?: number;
  component?: string;
}

export interface RawMoodleAssignment {
  id: number;
  cmid: number;
  course: number;
  name: string;
  duedate: number;
  cutoffdate: number;
  allowsubmissionsfromdate: number;
  intro?: string;
  visible?: number;
  uservisible?: boolean;
  visibleoncoursepage?: number;
  customdata?: string;
  completion?: number;
  completiondata?: {
    state?: number;
    timecompleted?: number;
    hascompletion?: boolean;
    isautomatic?: boolean;
    isincomplete?: boolean;
    [key: string]: any;
  };
  dates?: Array<{
    label: string;
    timestamp: number;
    dataid: string;
  }>;
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

export interface RawMoodleQuiz {
  id: number;
  course: number;
  coursemodule: number;
  name: string;
  intro?: string;
  introformat?: number;
  timeopen: number;
  timeclose: number;
  timelimit: number;
  attempts: number;
  grademethod?: number;
  grade?: number;
  sumgrades?: number;
  completion?: number;
  completiondata?: {
    state?: number;
    timecompleted?: number;
    hascompletion?: boolean;
    isautomatic?: boolean;
    isincomplete?: boolean;
    [key: string]: any;
  };
}

export interface RawMoodleQuizzesResponse {
  quizzes: RawMoodleQuiz[];
  warnings?: any[];
}

export interface RawMoodleQuizAttempt {
  id: number;
  quiz: number;
  userid: number;
  attempt: number;
  state: 'inprogress' | 'overdue' | 'finished' | 'abandoned';
  timestart: number;
  timefinish: number;
  timemodified: number;
  sumgrades?: number;
}

export interface RawMoodleQuizAttemptsResponse {
  attempts: RawMoodleQuizAttempt[];
  warnings?: any[];
}


export interface RawSubmissionPluginFile {
  filename: string;
  fileurl: string;
  filesize: number;
  mimetype?: string;
}

export interface RawSubmissionStatus {
  _scraperIntroAttachments?: { filename: string, fileurl: string }[];
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
  description?: string;
  intro?: string;
  visible?: number;
  uservisible?: boolean;
  visibleoncoursepage?: number;
  customdata?: string;
  completion?: number;
  completiondata?: {
    state?: number;
    timecompleted?: number;
    hascompletion?: boolean;
    isautomatic?: boolean;
    isincomplete?: boolean;
    [key: string]: any;
  };
  dates?: Array<{
    label: string;
    timestamp: number;
    dataid: string;
  }>;
  contents?: RawCourseFileContent[];
}

export interface RawCourseSection {
  id: number;
  name: string;
  section?: number;
  visible?: number;
  uservisible?: boolean;
  summary?: string;
  summaryformat?: number;
  component?: string;
  modules: RawCourseModule[];
}

export interface MoodleClientOptions {
  sesskey?: string;
  devMode?: boolean;
  strategies?: IMoodleStrategy[];
  enableScraping?: boolean;
  lang?: 'he' | 'en';
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
      enableScraping: options?.enableScraping,
      lang: options?.lang,
    };

    this.restStrategy = new RestMoodleStrategy(context);

    if (options?.strategies && options.strategies.length > 0) {
      this.strategies = options.enableScraping === false
        ? options.strategies.filter(s => s.name !== 'Scraper')
        : options.strategies;
    } else {
      const defaultStrategies: IMoodleStrategy[] = [
        this.restStrategy,
        new AjaxMoodleStrategy(context),
      ];
      if (options?.enableScraping) {
        defaultStrategies.push(new ScraperMoodleStrategy(context));
      }
      this.strategies = defaultStrategies;
    }
  }

  public setLanguage(lang: 'he' | 'en'): void {
    this.restStrategy.setLanguage(lang);
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
    const courses = await executeWithFallback(
      'getEnrolledCourses',
      this.strategies,
      (s) => s.getEnrolledCourses(userId),
      this.devMode
    );
    
    // Fallback: If we only got 1 dummy course (or just root courses), actively augment with Scraper to fetch archive years
    const scraper = this.strategies.find(s => s.name === 'Scraper');
    if (scraper) {
      try {
        const scraperCourses = await scraper.getEnrolledCourses(userId);
        const map = new Map(courses.map(c => [c.id, c]));
        scraperCourses.forEach(c => map.set(c.id, c));
        courses.splice(0, courses.length, ...Array.from(map.values()));
      } catch (e: any) {
        if (this.devMode) console.log('[MoodleClient] Non-fatal: Failed to augment enrolled courses with Scraper:', e.message);
      }
    }
    
    for (const s of this.strategies) {
      if (s.setKnownCourses) {
        s.setKnownCourses(courses);
      }
    }
    return courses;
  }

  public async getAssignments(): Promise<RawMoodleAssignmentsResponse> {
    const res = await executeWithFallback('getAssignments', this.strategies, (s) => s.getAssignments(), this.devMode);
    
    const scraper = this.strategies.find(s => s.name === 'Scraper');
    if (scraper) {
      try {
        const scraperRes = await scraper.getAssignments();
        const courseMap = new Map((res.courses || []).map((c: any) => [c.id, c]));
        
        (scraperRes.courses || []).forEach((c: any) => {
          if (courseMap.has(c.id)) {
            const existing = courseMap.get(c.id)!;
            const assignMap = new Map((existing.assignments || []).map((a: any) => [a.id, a]));
            (c.assignments || []).forEach((a: any) => assignMap.set(a.id, a));
            existing.assignments = Array.from(assignMap.values());
          } else {
            courseMap.set(c.id, c);
          }
        });
        res.courses = Array.from(courseMap.values());
      } catch (e: any) {
        if (this.devMode) console.log('[MoodleClient] Non-fatal: Failed to augment assignments with Scraper:', e.message);
      }
    }
    
    return res;
  }

  public async getSubmissionStatus(assignId: number, cmid?: number): Promise<RawSubmissionStatus> {
    return executeWithFallback(
      'getSubmissionStatus',
      this.strategies,
      (s) => s.getSubmissionStatus(assignId, cmid),
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

  public async getQuizzes(courseIds: number[]): Promise<RawMoodleQuiz[]> {
    return executeWithFallback(
      'getQuizzes',
      this.strategies,
      (s) => (s.getQuizzes ? s.getQuizzes(courseIds) : Promise.resolve([])),
      this.devMode
    );
  }

  public async getQuizAttempts(quizId: number): Promise<RawMoodleQuizAttempt[]> {
    return executeWithFallback(
      'getQuizAttempts',
      this.strategies,
      (s) => (s.getQuizAttempts ? s.getQuizAttempts(quizId) : Promise.resolve([])),
      this.devMode
    );
  }

  public async updateActivityCompletionManually(cmid: number, completed: boolean): Promise<boolean> {
    return executeWithFallback(
      'updateActivityCompletionManually',
      this.strategies,
      (s) => (s.updateActivityCompletionManually ? s.updateActivityCompletionManually(cmid, completed) : Promise.resolve(false)),
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
