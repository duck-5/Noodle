/**
 * Smart Sync Progress Calculator
 * 
 * Provides dynamic, empirically weighted, and strictly monotonic progress calculation
 * across the stages of the Moodle synchronization lifecycle:
 * 
 * 1. Initialization (0% - 7%): Site info and authentication verification.
 * 2. Course Mapping (7% - 15%): Enrolled courses catalog & instance routing metadata.
 * 3. Global Activity Fetch (15% - 28%): Assignments list, quizzes list, and grade summaries.
 * 4. Course Contents & Resource Scanning (28% - 75%): Iterating tracked courses, sections,
 *    subsections, files, folders, links, Zoom meetings, and Panopto sessions.
 * 5. Activity Details & Submissions (75% - 95%): Individual submission statuses, files,
 *    attempts, and completion states.
 * 6. Finalization & Complete (95% - 100%): Late box auto-suppression heuristics, sorting,
 *    and result delivery.
 */

export type SyncStage =
  | 'idle'
  | 'init'
  | 'mapping'
  | 'global_fetch'
  | 'courses'
  | 'activities'
  | 'panopto'
  | 'finalizing'
  | 'complete';

export interface SyncProgressState {
  percent: number; // Integer 0 - 100
  stage: SyncStage;
  message: string;
  coursesCompleted: number;
  totalCourses: number;
  activitiesCompleted: number;
  totalActivities: number;
  panoptoCoursesCompleted?: number;
  totalPanoptoCourses?: number;
}

export type SyncProgressCallback = (message: string, state: SyncProgressState) => void;

export interface ProgressStageWeights {
  initTarget?: number;          // Default: 7
  mappingTarget?: number;       // Default: 15
  globalQueriesTarget?: number; // Default: 28
  coursesTarget?: number;       // Default: 75
  activitiesTarget?: number;    // Default: 95
  panoptoTarget?: number;       // Default: 95 (or 90-95 when enabled)
  finalizingTarget?: number;    // Default: 98
}

export class SmartProgressCalculator {
  private currentPercent = 0;
  private stage: SyncStage = 'idle';
  private coursesCompleted = 0;
  private totalCourses = 0;
  private activitiesCompleted = 0;
  private totalActivities = 0;
  private panoptoCoursesCompleted = 0;
  private totalPanoptoCourses = 0;
  private lastEmittedMessage = '';

  private readonly initTarget: number;
  private readonly mappingTarget: number;
  private readonly globalQueriesTarget: number;
  private readonly coursesTarget: number;
  private readonly activitiesTarget: number;
  private readonly panoptoTarget: number;
  private readonly finalizingTarget: number;

  constructor(
    totalCourses: number = 0,
    private callback?: SyncProgressCallback,
    weights?: ProgressStageWeights
  ) {
    this.totalCourses = Math.max(0, totalCourses);
    this.initTarget = weights?.initTarget ?? 7;
    this.mappingTarget = weights?.mappingTarget ?? 15;
    this.globalQueriesTarget = weights?.globalQueriesTarget ?? 28;
    this.coursesTarget = weights?.coursesTarget ?? 75;
    this.activitiesTarget = weights?.activitiesTarget ?? 95;
    this.panoptoTarget = weights?.panoptoTarget ?? weights?.activitiesTarget ?? 95;
    this.finalizingTarget = weights?.finalizingTarget ?? 98;
  }

  public getState(): SyncProgressState {
    return {
      percent: this.currentPercent,
      stage: this.stage,
      message: this.lastEmittedMessage,
      coursesCompleted: this.coursesCompleted,
      totalCourses: this.totalCourses,
      activitiesCompleted: this.activitiesCompleted,
      totalActivities: this.totalActivities,
      panoptoCoursesCompleted: this.panoptoCoursesCompleted,
      totalPanoptoCourses: this.totalPanoptoCourses,
    };
  }

  public getPercent(): number {
    return this.currentPercent;
  }

  private emit(message: string, newPercent: number, stage: SyncStage): void {
    this.stage = stage;
    // Strictly monotonic: progress never goes backwards and remains in [0, 100]
    this.currentPercent = Math.max(this.currentPercent, Math.min(100, Math.round(newPercent)));
    this.lastEmittedMessage = message;

    if (this.callback) {
      this.callback(message, this.getState());
    }
  }

  public start(message = 'Initializing sync...'): void {
    this.emit(message, 2, 'init');
  }

  public setSiteInfoDone(message = 'User profile verified.'): void {
    this.emit(message, this.initTarget, 'init');
  }

  public setCourseMappingDone(message = 'Course catalog loaded.'): void {
    this.emit(message, this.mappingTarget, 'mapping');
  }

  public setGlobalQueriesDone(message = 'Assignments and grades loaded.'): void {
    this.emit(message, this.globalQueriesTarget, 'global_fetch');
  }

  public setTotalCourses(total: number): void {
    this.totalCourses = Math.max(0, total);
    if (this.totalCourses === 0 && this.currentPercent < this.coursesTarget) {
      this.emit('No courses to scan.', this.coursesTarget, 'courses');
    }
  }

  public courseCompleted(courseName?: string): void {
    this.coursesCompleted++;
    const total = Math.max(1, this.totalCourses);
    const fraction = Math.min(1, this.coursesCompleted / total);
    const span = this.coursesTarget - this.globalQueriesTarget;
    const pct = this.globalQueriesTarget + fraction * span;

    const msg = courseName
      ? `Scanning courses (${this.coursesCompleted}/${total}): ${courseName}...`
      : `Scanning courses (${this.coursesCompleted}/${total})...`;
    this.emit(msg, pct, 'courses');
  }

  public setTotalActivities(numAssignments: number, numQuizzes: number): void {
    this.totalActivities = Math.max(0, numAssignments + numQuizzes);
    if (this.totalActivities === 0 && this.currentPercent < this.activitiesTarget) {
      this.emit('No activity submissions to process.', this.activitiesTarget, 'activities');
    }
  }

  public activityCompleted(activityName?: string): void {
    this.activitiesCompleted++;
    const total = Math.max(1, this.totalActivities);
    const fraction = Math.min(1, this.activitiesCompleted / total);
    const span = this.activitiesTarget - this.coursesTarget;
    const pct = this.coursesTarget + fraction * span;

    const msg = activityName
      ? `Processing submissions (${this.activitiesCompleted}/${total}): ${activityName}...`
      : `Processing submissions (${this.activitiesCompleted}/${total})...`;
    this.emit(msg, pct, 'activities');
  }

  public setTotalPanoptoCourses(total: number): void {
    this.totalPanoptoCourses = Math.max(0, total);
    if (this.totalPanoptoCourses === 0 && this.currentPercent < this.panoptoTarget) {
      this.emit('No Panopto recordings to fetch.', this.panoptoTarget, 'panopto');
    } else {
      this.emit('Scanning Panopto recordings...', Math.max(this.currentPercent, this.activitiesTarget), 'panopto');
    }
  }

  public panoptoCourseCompleted(courseName?: string): void {
    this.panoptoCoursesCompleted++;
    const total = Math.max(1, this.totalPanoptoCourses);
    const fraction = Math.min(1, this.panoptoCoursesCompleted / total);
    const span = Math.max(0, this.panoptoTarget - this.activitiesTarget);
    const pct = this.activitiesTarget + fraction * span;

    const msg = courseName
      ? `Scanning recordings (${this.panoptoCoursesCompleted}/${total}): ${courseName}...`
      : `Scanning recordings (${this.panoptoCoursesCompleted}/${total})...`;
    this.emit(msg, pct, 'panopto');
  }

  public finalizing(message = 'Finalizing and sorting...'): void {
    this.emit(message, this.finalizingTarget, 'finalizing');
  }

  public complete(message = 'Sync completed.'): void {
    this.emit(message, 100, 'complete');
  }
}
