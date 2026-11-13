import { Assignment } from './types.js';
import { isActivityHidden, isActivityCompleted, isMoodleActivitySubmitted } from './activityState.js';
import { isAdministrativeCourse } from './courseGrouping.js';

export interface GradeCalculationOptions {
  assignments: Assignment[];
  hiddenIdentifiers?: Array<string | number> | null;
  completedIdentifiers?: Array<string | number> | null;
  uncompletedIdentifiers?: Array<string | number> | null;
  excludedCourseIds?: Set<number> | null;
  now?: Date;
}

export interface CalculatedGradeItem extends Assignment {
  effectiveGrade: number;
  effectiveGradeMax: number;
}

export interface CourseGradesGroup {
  courseId: number;
  courseName: string;
  sum: number;
  count: number;
  average: string;
  list: CalculatedGradeItem[];
}

export interface GradesCalculationResult {
  overallGpa: string;
  courseGroups: Record<number, CourseGradesGroup>;
  totalCalculatedItems: number;
  calculatedItems: CalculatedGradeItem[];
}

/**
 * Calculates academic grades and GPA across courses following strict pedagogical rules:
 * 1. Exclude course-level exclusions and administrative / safety tutorials (course codes 5800.../5900...).
 * 2. Exclude hidden assignments (e.g. lab experiments student does not attend, late submission boxes, or user-hidden tasks).
 * 3. Exclude "Marked as done" assignments that were NOT submitted in Moodle (local student checkoffs).
 * 4. Only include and display activities that have an actual published grade in Moodle (grade !== null && grade !== undefined).
 *    Do NOT default unsubmitted or overdue tasks to 0 (if 0, it must be the official grade assigned in Moodle).
 *    Submitted assignments that have not yet been graded are not included until officially graded.
 */
export function calculateGradesSummary({
  assignments,
  hiddenIdentifiers,
  completedIdentifiers,
  uncompletedIdentifiers,
  excludedCourseIds,
}: GradeCalculationOptions): GradesCalculationResult {
  const courseGroups: Record<number, CourseGradesGroup> = {};
  const calculatedItems: CalculatedGradeItem[] = [];

  for (const a of assignments) {
    // 1. Exclude courses disabled for GPA or administrative/safety tutorials
    if (
      excludedCourseIds?.has(a.courseId) ||
      isAdministrativeCourse({ courseId: String(a.courseId), fullname: a.courseName, shortname: a.courseName })
    ) {
      continue;
    }

    // 2. Exclude hidden assignments (auto-suppressed late submission boxes or user-hidden)
    const isHidden = Boolean(a.isHidden) || isActivityHidden(a, hiddenIdentifiers);
    if (isHidden) {
      continue;
    }

    // 3. Exclude "Marked as done" assignments that were not submitted in Moodle
    const isMoodleSubmitted =
      (a as any).isMoodleSubmitted !== undefined
        ? Boolean((a as any).isMoodleSubmitted)
        : isMoodleActivitySubmitted(a);

    const isCompleted =
      (a as any).isCompleted !== undefined
        ? Boolean((a as any).isCompleted)
        : isActivityCompleted(a, completedIdentifiers, uncompletedIdentifiers);

    if (isCompleted && !isMoodleSubmitted) {
      continue;
    }

    // 4. Only include and display assignments with an official published grade in Moodle
    if (a.grade === null || a.grade === undefined) {
      continue;
    }

    const effectiveGrade = a.grade;
    const effectiveGradeMax = a.gradeMax && a.gradeMax > 0 ? a.gradeMax : 100;

    if (!courseGroups[a.courseId]) {
      courseGroups[a.courseId] = {
        courseId: a.courseId,
        courseName: a.courseName,
        sum: 0,
        count: 0,
        average: '-',
        list: [],
      };
    }

    const item: CalculatedGradeItem = {
      ...a,
      effectiveGrade,
      effectiveGradeMax,
    };
    courseGroups[a.courseId].list.push(item);
    calculatedItems.push(item);

    // Bonus assignments are tracked in list, but do not contribute to the unweighted course average percentage ratio
    if (!a.isBonus) {
      const ratio = effectiveGradeMax > 0 ? effectiveGrade / effectiveGradeMax : 0;
      courseGroups[a.courseId].sum += ratio * 100;
      courseGroups[a.courseId].count += 1;
    }
  }

  // Calculate averages per course
  let totalCourseAverageSum = 0;
  let courseAveragesCount = 0;

  for (const group of Object.values(courseGroups)) {
    if (group.count > 0) {
      const avg = group.sum / group.count;
      group.average = avg.toFixed(2);
      totalCourseAverageSum += avg;
      courseAveragesCount++;
    } else {
      group.average = '-';
    }
  }

  const overallGpa = courseAveragesCount > 0 ? (totalCourseAverageSum / courseAveragesCount).toFixed(2) : '-';

  return {
    overallGpa,
    courseGroups,
    totalCalculatedItems: calculatedItems.length,
    calculatedItems,
  };
}
