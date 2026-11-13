import { Assignment } from './types.js';

/**
 * Returns the canonical unique string identifier for an assignment or quiz.
 * Format: "assign:<id>" or "quiz:<id>", falling back to a.uid if already set.
 */
export function getActivityUid(activity: {
  id: number;
  activityType?: string;
  uid?: string;
}): string {
  if (activity.uid) return activity.uid;
  const type = activity.activityType || 'assign';
  return `${type}:${activity.id}`;
}

/**
 * Determines whether a stored activity identifier (which may be a modern uid string
 * or a legacy numeric ID from chrome.storage.sync) matches the given activity.
 */
export function matchesActivityIdentifier(
  storedId: string | number,
  activity: { id: number; activityType?: string; uid?: string }
): boolean {
  if (typeof storedId === 'number') {
    // Legacy numbers only match 'assign' activities (or activities without an explicit type),
    // never 'quiz' activities, avoiding cross-module ID collisions.
    return (!activity.activityType || activity.activityType === 'assign') && activity.id === storedId;
  }
  const str = String(storedId).trim();
  // Support stringified numeric IDs (e.g. "12") from JSON serialization or legacy storage
  if (/^\d+$/.test(str)) {
    return (!activity.activityType || activity.activityType === 'assign') && activity.id === Number(str);
  }
  const uid = getActivityUid(activity);
  if (str === uid) return true;
  // If storedId is "assign:12" and activity.id is 12
  if (str === `assign:${activity.id}` && (!activity.activityType || activity.activityType === 'assign')) {
    return true;
  }
  if (str === `quiz:${activity.id}` && activity.activityType === 'quiz') {
    return true;
  }
  return false;
}

/**
 * Returns true if an activity is hidden — either via the system auto-suppression heuristic
 * (e.g. matched late submission box) or explicitly by the user in settings.
 */
export function isActivityHidden(
  activity: { id: number; activityType?: string; uid?: string; isHidden?: boolean },
  hiddenIdentifiers?: Array<string | number> | null
): boolean {
  if (activity.isHidden) return true;
  if (!hiddenIdentifiers || hiddenIdentifiers.length === 0) return false;
  return hiddenIdentifiers.some((storedId) => matchesActivityIdentifier(storedId, activity));
}

/**
 * Determines whether an activity is considered submitted or completed by Moodle.
 * Evaluates nominal status ('Submitted'), explicit completion flag, manual completion,
 * finished quiz attempts, and recorded gradebook grades.
 */
export function isMoodleActivitySubmitted(activity: {
  status: string;
  isManualCompletionDone?: boolean;
  requiresManualCompletion?: boolean;
  grade?: number | null;
  isCompleted?: boolean;
  hasFinishedAttempt?: boolean;
}): boolean {
  return (
    activity.status === 'Submitted' ||
    Boolean(activity.isCompleted) ||
    Boolean(activity.isManualCompletionDone) ||
    Boolean(activity.hasFinishedAttempt) ||
    (activity.grade !== null && activity.grade !== undefined)
  );
}

/**
 * Returns true if an activity is completed — considering Moodle submission status,
 * manual completion overrides, and user completed/uncompleted settings.
 */
export function isActivityCompleted(
  activity: {
    id: number;
    activityType?: string;
    uid?: string;
    status: string;
    isManualCompletionDone?: boolean;
    requiresManualCompletion?: boolean;
    grade?: number | null;
    isCompleted?: boolean;
    hasFinishedAttempt?: boolean;
  },
  completedIdentifiers?: Array<string | number> | null,
  uncompletedIdentifiers?: Array<string | number> | null
): boolean {
  const isMoodleSubmitted = isMoodleActivitySubmitted(activity);
  const isExplicitlyUncompleted = (uncompletedIdentifiers || []).some((id) =>
    matchesActivityIdentifier(id, activity)
  );
  if (isExplicitlyUncompleted) return false;

  const isExplicitlyCompleted = (completedIdentifiers || []).some((id) =>
    matchesActivityIdentifier(id, activity)
  );
  if (isExplicitlyCompleted) return true;

  return isMoodleSubmitted;
}

export interface ZoomMeetingLike {
  courseId?: number | string;
  courseName?: string;
  meetingNumber?: string;
  title?: string;
  meetingUrl?: string;
}

/**
 * Returns the canonical compound key used to identify a Zoom meeting session.
 * Format: "<courseName>:<meetingNumber><title>", matching the dashboard keying convention.
 */
export function getZoomMeetingKey(meeting: ZoomMeetingLike): string {
  const courseName = meeting.courseName || '';
  const meetingNum = meeting.meetingNumber || '';
  const title = meeting.title || '';
  return courseName + ":" + meetingNum + title;
}

/**
 * Determines whether a Zoom meeting is explicitly marked as hidden by the user.
 * Default state: VISIBLE (returns false).
 * A meeting is only hidden if it (or its normalized meeting number or URL or compound key)
 * is present in hiddenZoomMeetings or legacy interestedMeetings denylist.
 */
export function isZoomMeetingHidden(
  meeting: ZoomMeetingLike,
  hiddenZoomMeetings?: string[] | null,
  legacyInterestedMeetings?: string[] | null
): boolean {
  if (!meeting) return false;
  const key = getZoomMeetingKey(meeting);
  const rawNum = meeting.meetingNumber ? String(meeting.meetingNumber).trim() : '';
  const cleanNum = rawNum ? rawNum.replace(/[\s-]/g, '') : '';
  const url = meeting.meetingUrl ? meeting.meetingUrl.trim() : '';

  // 1. Explicit modern denylist: hiddenZoomMeetings
  if (hiddenZoomMeetings && hiddenZoomMeetings.length > 0) {
    if (
      hiddenZoomMeetings.includes(key) ||
      (rawNum && hiddenZoomMeetings.includes(rawNum)) ||
      (cleanNum && hiddenZoomMeetings.includes(cleanNum)) ||
      (url && hiddenZoomMeetings.includes(url))
    ) {
      return true;
    }
  }

  // 2. Legacy denylist format support (prefixed with 'hidden_')
  if (legacyInterestedMeetings && legacyInterestedMeetings.length > 0) {
    if (
      (rawNum && legacyInterestedMeetings.includes("hidden_" + rawNum)) ||
      (cleanNum && legacyInterestedMeetings.includes("hidden_" + cleanNum)) ||
      (url && legacyInterestedMeetings.includes("hidden_" + url)) ||
      legacyInterestedMeetings.includes("hidden_" + key)
    ) {
      return true;
    }
  }

  // By default: all zoom links are VISIBLE
  return false;
}
