import type {
  MoodleSiteInfo,
  RawMoodleCourse,
  RawMoodleAssignmentsResponse,
  RawSubmissionStatus,
  RawGradeReportResponse,
  RawCourseSection,
  RawMoodleQuiz,
  RawMoodleQuizAttempt,
} from '../moodleApi.js';
import type { CourseStaffMember } from '../types.js';
import type { CookieAdapter, FetchFn } from '../runtimeEnv.js';

export class UnsupportedStrategyError extends Error {
  constructor(
    public strategyName: string,
    public operationName: string,
    reason?: string
  ) {
    super(
      `Strategy '${strategyName}' does not support operation '${operationName}'${
        reason ? `: ${reason}` : ''
      }`
    );
    this.name = 'UnsupportedStrategyError';
  }
}

export interface StrategyContext {
  token?: string;
  sesskey?: string;
  baseUrl: string;
  devMode?: boolean;
  /** @deprecated Legacy Web Scraping fallback option (removed from extension Settings UI). */
  enableScraping?: boolean;
  lang?: 'he' | 'en';
  userAgent?: string;
  fetch?: FetchFn;
  cookieAdapter?: CookieAdapter;
  timeoutMs?: number;
}

export interface IMoodleStrategy {
  readonly name: string;
  isOperationSupported?(operationName: string): boolean;
  getSiteInfo(): Promise<MoodleSiteInfo>;
  getEnrolledCourses(userId: number): Promise<RawMoodleCourse[]>;
  getAssignments(courseIds?: number[]): Promise<RawMoodleAssignmentsResponse>;
  getSubmissionStatus(assignId: number, cmid?: number): Promise<RawSubmissionStatus>;
  getGradeItems(courseId: number, userId: number): Promise<RawGradeReportResponse>;
  getCourseContents(courseId: number): Promise<RawCourseSection[]>;
  getCourseStaff?(courseId: number): Promise<CourseStaffMember[]>;
  getQuizzes?(courseIds: number[]): Promise<RawMoodleQuiz[]>;
  getQuizAttempts?(quizId: number): Promise<RawMoodleQuizAttempt[]>;
  updateActivityCompletionManually?(cmid: number, completed: boolean): Promise<boolean>;

  uploadFile(filename: string, fileContentBase64: string): Promise<{ itemid: number }>;
  saveSubmission(assignId: number, itemId: number): Promise<any>;
  submitForGrading(assignId: number): Promise<any>;
  getAutoLoginKey(): Promise<{ key: string; autologinurl: string }>;
  saveNoodleSettings(settingsJson: string): Promise<void>;
  loadNoodleSettings(): Promise<any>;
  getMobileToken?(): Promise<string>;
  setToken?(token: string): void;
  setKnownCourses?(courses: RawMoodleCourse[]): void;
}
