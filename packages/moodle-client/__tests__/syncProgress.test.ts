import { SmartProgressCalculator, SyncProgressState } from '../src/syncProgress.js';

describe('SmartProgressCalculator', () => {
  it('should initialize at 0% and idle stage', () => {
    const calc = new SmartProgressCalculator(3);
    const state = calc.getState();
    expect(state.percent).toBe(0);
    expect(state.stage).toBe('idle');
    expect(state.coursesCompleted).toBe(0);
    expect(state.totalCourses).toBe(3);
  });

  it('should advance monotonically through all sync stages', () => {
    const snapshots: number[] = [];
    const stages: string[] = [];

    const calc = new SmartProgressCalculator(2, (_msg, state) => {
      snapshots.push(state.percent);
      stages.push(state.stage);
    });

    calc.start();
    expect(calc.getPercent()).toBe(2);

    calc.setSiteInfoDone();
    expect(calc.getPercent()).toBe(7);

    calc.setCourseMappingDone();
    expect(calc.getPercent()).toBe(15);

    calc.setGlobalQueriesDone();
    expect(calc.getPercent()).toBe(28);

    // Course 1 of 2
    calc.courseCompleted('CS101');
    const afterCourse1 = calc.getPercent();
    expect(afterCourse1).toBeGreaterThanOrEqual(51);

    // Course 2 of 2
    calc.courseCompleted('DS201');
    expect(calc.getPercent()).toBe(75);

    // Set 2 activities
    calc.setTotalActivities(1, 1);

    // Activity 1 of 2
    calc.activityCompleted('Assignment 1');
    const afterAct1 = calc.getPercent();
    expect(afterAct1).toBeGreaterThanOrEqual(85);

    // Activity 2 of 2
    calc.activityCompleted('Quiz 1');
    expect(calc.getPercent()).toBe(95);

    calc.finalizing();
    expect(calc.getPercent()).toBe(98);

    calc.complete();
    expect(calc.getPercent()).toBe(100);

    // Verify snapshots are strictly non-decreasing
    for (let i = 1; i < snapshots.length; i++) {
      expect(snapshots[i]).toBeGreaterThanOrEqual(snapshots[i - 1]);
    }

    // Verify stage progression
    expect(stages).toEqual(
      expect.arrayContaining(['init', 'mapping', 'global_fetch', 'courses', 'activities', 'finalizing', 'complete'])
    );
  });

  it('should handle zero tracked courses gracefully without getting stuck', () => {
    const calc = new SmartProgressCalculator(0);
    calc.start();
    calc.setSiteInfoDone();
    calc.setCourseMappingDone();
    calc.setGlobalQueriesDone();
    calc.setTotalCourses(0);
    expect(calc.getPercent()).toBe(75);

    calc.setTotalActivities(0, 0);
    expect(calc.getPercent()).toBe(95);

    calc.complete();
    expect(calc.getPercent()).toBe(100);
  });

  it('should handle zero activities gracefully', () => {
    const calc = new SmartProgressCalculator(1);
    calc.setGlobalQueriesDone();
    calc.courseCompleted('Physics');
    expect(calc.getPercent()).toBe(75);

    calc.setTotalActivities(0, 0);
    expect(calc.getPercent()).toBe(95);

    calc.complete();
    expect(calc.getPercent()).toBe(100);
  });

  it('should enforce monotonicity even if called out of order', () => {
    const calc = new SmartProgressCalculator(5);
    calc.setGlobalQueriesDone(); // 28%
    expect(calc.getPercent()).toBe(28);

    // Attempting to set an earlier milestone should NOT decrease percent
    calc.setSiteInfoDone();
    expect(calc.getPercent()).toBe(28);

    calc.courseCompleted('Course 1');
    const pct1 = calc.getPercent();
    expect(pct1).toBeGreaterThan(28);

    calc.setCourseMappingDone();
    expect(calc.getPercent()).toBe(pct1);
  });

  it('should support custom stage weights', () => {
    const customCalc = new SmartProgressCalculator(2, undefined, {
      initTarget: 10,
      mappingTarget: 20,
      globalQueriesTarget: 40,
      coursesTarget: 80,
      activitiesTarget: 95,
      finalizingTarget: 99,
    });

    customCalc.setSiteInfoDone();
    expect(customCalc.getPercent()).toBe(10);

    customCalc.setCourseMappingDone();
    expect(customCalc.getPercent()).toBe(20);

    customCalc.setGlobalQueriesDone();
    expect(customCalc.getPercent()).toBe(40);

    customCalc.courseCompleted('Course 1');
    customCalc.courseCompleted('Course 2');
    expect(customCalc.getPercent()).toBe(80);
  });

  it('should support dedicated Panopto stage when enabled', () => {
    const calc = new SmartProgressCalculator(2, undefined, {
      initTarget: 5,
      mappingTarget: 12,
      globalQueriesTarget: 22,
      coursesTarget: 55,
      activitiesTarget: 75,
      panoptoTarget: 95,
      finalizingTarget: 98,
    });

    calc.start();
    calc.setSiteInfoDone();
    calc.setCourseMappingDone();
    calc.setGlobalQueriesDone();
    expect(calc.getPercent()).toBe(22);

    calc.courseCompleted('Math');
    calc.courseCompleted('Physics');
    expect(calc.getPercent()).toBe(55);

    calc.setTotalActivities(1, 0);
    calc.activityCompleted('Hw 1');
    expect(calc.getPercent()).toBe(75);

    calc.setTotalPanoptoCourses(2);
    expect(calc.getState().stage).toBe('panopto');
    calc.panoptoCourseCompleted('Math');
    expect(calc.getPercent()).toBe(85);
    expect(calc.getState().panoptoCoursesCompleted).toBe(1);

    calc.panoptoCourseCompleted('Physics');
    expect(calc.getPercent()).toBe(95);

    calc.finalizing();
    expect(calc.getPercent()).toBe(98);

    calc.complete();
    expect(calc.getPercent()).toBe(100);
  });
});
