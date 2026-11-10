import {
  getActivityUid,
  isActivityHidden,
  isActivityCompleted,
  isMoodleActivitySubmitted,
  matchesActivityIdentifier,
} from '../src/activityState';

describe('activityState helpers', () => {
  const assign1 = { id: 12, activityType: 'assign' as const, status: 'Not submitted' };
  const quiz1 = { id: 12, activityType: 'quiz' as const, status: 'Not submitted' };
  const assignSubmitted = { id: 15, activityType: 'assign' as const, status: 'Submitted' };
  const quizManual = {
    id: 20,
    activityType: 'quiz' as const,
    status: 'Not submitted',
    requiresManualCompletion: true,
    isManualCompletionDone: true,
  };

  it('getActivityUid generates distinct canonical keys for assign vs quiz with identical numeric ID', () => {
    expect(getActivityUid(assign1)).toBe('assign:12');
    expect(getActivityUid(quiz1)).toBe('quiz:12');
  });

  it('matchesActivityIdentifier supports legacy numeric IDs for assign while preventing cross-match with quiz', () => {
    // Numeric 12 matches assign:12
    expect(matchesActivityIdentifier(12, assign1)).toBe(true);
    // Numeric 12 does NOT match quiz:12
    expect(matchesActivityIdentifier(12, quiz1)).toBe(false);

    // Canonical uid matches exact type
    expect(matchesActivityIdentifier('assign:12', assign1)).toBe(true);
    expect(matchesActivityIdentifier('quiz:12', quiz1)).toBe(true);
    expect(matchesActivityIdentifier('assign:12', quiz1)).toBe(false);
  });

  it('isActivityHidden detects auto-suppression or explicit user setting (uid and legacy)', () => {
    const autoHidden = { id: 30, activityType: 'assign' as const, status: 'Submitted', isHidden: true };
    expect(isActivityHidden(autoHidden, [])).toBe(true);

    expect(isActivityHidden(assign1, [12])).toBe(true);
    expect(isActivityHidden(quiz1, [12])).toBe(false); // numeric 12 doesn't hide quiz 12
    expect(isActivityHidden(quiz1, ['quiz:12'])).toBe(true);
  });

  it('isActivityCompleted respects Moodle status, manual completion, and explicit user overrides', () => {
    expect(isActivityCompleted(assignSubmitted)).toBe(true);
    expect(isActivityCompleted(quizManual)).toBe(true);
    expect(isActivityCompleted(assign1)).toBe(false);

    // Overriding an unsubmitted item
    expect(isActivityCompleted(assign1, ['assign:12'], [])).toBe(true);
    // Overriding a submitted item to uncompleted
    expect(isActivityCompleted(assignSubmitted, [], ['assign:15'])).toBe(false);
  });

  it('isActivityCompleted recognizes grade, isCompleted flag, and finished attempts', () => {
    // Activity with a grade is considered completed even if nominal status is not Submitted
    const gradedQuiz = { id: 45, activityType: 'quiz' as const, status: 'Not submitted', grade: 100 };
    expect(isActivityCompleted(gradedQuiz)).toBe(true);

    // Activity with isCompleted flag
    const completedFlag = { id: 46, activityType: 'quiz' as const, status: 'Assigned', isCompleted: true };
    expect(isActivityCompleted(completedFlag)).toBe(true);

    // Activity with finished attempt
    const finishedAttempt = { id: 47, activityType: 'quiz' as const, status: 'Not submitted', hasFinishedAttempt: true };
    expect(isActivityCompleted(finishedAttempt)).toBe(true);

    // Explicit uncompleted override still wins over grade
    expect(isActivityCompleted(gradedQuiz, [], ['quiz:45'])).toBe(false);
  });
  describe('TC-ACT-02: Two-way Mark Done and Mark as To Do state transitions', () => {
    it('isMoodleActivitySubmitted correctly identifies Moodle-submitted states', () => {
      expect(isMoodleActivitySubmitted({ status: 'Submitted' })).toBe(true);
      expect(isMoodleActivitySubmitted({ status: 'Assigned', isCompleted: true })).toBe(true);
      expect(isMoodleActivitySubmitted({ status: 'Not submitted', grade: 95 })).toBe(true);
      expect(isMoodleActivitySubmitted({ status: 'Not submitted', isManualCompletionDone: true })).toBe(true);
      expect(isMoodleActivitySubmitted({ status: 'Not submitted', hasFinishedAttempt: true })).toBe(true);

      expect(isMoodleActivitySubmitted({ status: 'Assigned' })).toBe(false);
      expect(isMoodleActivitySubmitted({ status: 'Not submitted', grade: null })).toBe(false);
      expect(isMoodleActivitySubmitted({ status: 'Not submitted', isManualCompletionDone: false })).toBe(false);
    });

    it('seamlessly transitions unsubmitted item to completed and back via string/number identifiers', () => {
      const task = { id: 101, activityType: 'assign' as const, status: 'Assigned' };
      let completedList: Array<string | number> = [];
      let uncompletedList: Array<string | number> = [];

      // Initial state: not completed
      expect(isActivityCompleted(task, completedList, uncompletedList)).toBe(false);

      // User clicks "Mark Done" -> saves canonical targetKey "assign:101"
      completedList.push('assign:101');
      expect(isActivityCompleted(task, completedList, uncompletedList)).toBe(true);

      // User clicks "Mark as To Do" -> toggles off
      completedList = completedList.filter((id) => !matchesActivityIdentifier(id, task));
      expect(isActivityCompleted(task, completedList, uncompletedList)).toBe(false);

      // Works even if stored as legacy numeric ID 101
      completedList.push(101);
      expect(isActivityCompleted(task, completedList, uncompletedList)).toBe(true);
    });

    it('seamlessly transitions Moodle-submitted item to uncompleted and back via string/number identifiers', () => {
      const task = { id: 202, activityType: 'assign' as const, status: 'Submitted' };
      let completedList: Array<string | number> = [];
      let uncompletedList: Array<string | number> = [];

      // Initial state: submitted in Moodle
      expect(isActivityCompleted(task, completedList, uncompletedList)).toBe(true);

      // User clicks "Mark as To Do" -> saves "assign:202" into uncompletedList
      uncompletedList.push('assign:202');
      expect(isActivityCompleted(task, completedList, uncompletedList)).toBe(false);

      // User clicks "Mark Done" -> removes from uncompletedList
      uncompletedList = uncompletedList.filter((id) => !matchesActivityIdentifier(id, task));
      expect(isActivityCompleted(task, completedList, uncompletedList)).toBe(true);

      // Works even if stored as legacy numeric ID 202
      uncompletedList.push(202);
      expect(isActivityCompleted(task, completedList, uncompletedList)).toBe(false);
    });
  });
});

