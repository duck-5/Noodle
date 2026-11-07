import {
  getActivityUid,
  isActivityHidden,
  isActivityCompleted,
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
});
