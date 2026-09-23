import {
  MoodleSiteInfo,
  RawMoodleCourse,
  RawMoodleAssignmentsResponse,
  RawSubmissionStatus,
  RawGradeReportResponse,
  RawCourseSection,
} from '../moodleApi.js';

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
}

export interface IMoodleStrategy {
  readonly name: string;
  isOperationSupported?(operationName: string): boolean;
  getSiteInfo(): Promise<MoodleSiteInfo>;
  getEnrolledCourses(userId: number): Promise<RawMoodleCourse[]>;
  getAssignments(): Promise<RawMoodleAssignmentsResponse>;
  getSubmissionStatus(assignId: number, cmid?: number): Promise<RawSubmissionStatus>;
  getGradeItems(courseId: number, userId: number): Promise<RawGradeReportResponse>;
  getCourseContents(courseId: number): Promise<RawCourseSection[]>;
  uploadFile(filename: string, fileContentBase64: string): Promise<{ itemid: number }>;
  saveSubmission(assignId: number, itemId: number): Promise<any>;
  submitForGrading(assignId: number): Promise<any>;
  getAutoLoginKey(): Promise<{ key: string; autologinurl: string }>;
  saveNoodleSettings(settingsJson: string): Promise<void>;
  loadNoodleSettings(): Promise<any>;
}
