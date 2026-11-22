import React, { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Assignment,
  calculateGradesSummary,
  cleanCourseDisplayName,
} from '@tautracker/moodle-client';
import { AssignmentDetailSheet } from '@/components/AssignmentDetailSheet';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  GradesIcon,
  InfoIcon,
  RefreshIcon,
  StarIcon,
} from '@/components/icons/NoodleIcons';
import { SpinningIcon } from '@/components/ui/NoodleAnimations';
import { getReadableTextColor } from '@/constants/theme';
import { useAppState, useSyncProgress } from '@/hooks/use-app-state';
import { usePreferences } from '@/hooks/use-preferences';
import { useResponsiveLayout } from '@/hooks/use-responsive-layout';
import { stripHtmlToPlainText } from '@/services/htmlUtils';

export default function GradesScreen() {
  const router = useRouter();
  const { width, isLandscapeTablet, isShortLandscape } = useResponsiveLayout();
  const { theme, isRtl, t } = usePreferences();
  const { openSyncWindow } = useSyncProgress();
  const {
    syncResult,
    groupedCourses,
    coursesColorMap,
    coursesCustomNames,
    hiddenAssignments,
    completedAssignments,
    uncompletedAssignments,
    isSyncing,
    triggerSync,
    tourStep,
  } = useAppState();

  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);

  const isTwoColumnGrid = width >= 680 && !isShortLandscape;

  const summary = useMemo(() => {
    return calculateGradesSummary({
      assignments: syncResult.assignments || [],
      hiddenIdentifiers: hiddenAssignments,
      completedIdentifiers: completedAssignments,
      uncompletedIdentifiers: uncompletedAssignments,
    });
  }, [
    syncResult.assignments,
    hiddenAssignments,
    completedAssignments,
    uncompletedAssignments,
  ]);

  const resolveCourseMeta = useCallback(
    (courseId: number, fallbackName: string): { displayName: string; color: string } => {
      const unified =
        groupedCourses.academicCourses.find(
          (u) => u.id === courseId || u.subCourses.some((s) => s.courseId === courseId)
        ) ||
        (groupedCourses.administrativeUmbrella &&
        (groupedCourses.administrativeUmbrella.id === courseId ||
          groupedCourses.administrativeUmbrella.subCourses.some((s) => s.courseId === courseId))
          ? groupedCourses.administrativeUmbrella
          : undefined);

      const color =
        coursesColorMap[courseId] ||
        (unified ? coursesColorMap[unified.id] : undefined) ||
        theme.primary;

      const customName =
        coursesCustomNames[courseId] ||
        (unified ? coursesCustomNames[unified.id] : undefined);

      const displayName =
        customName ||
        (unified ? cleanCourseDisplayName(unified.fullname) || unified.fullname : '') ||
        cleanCourseDisplayName(fallbackName) ||
        fallbackName;

      return { displayName, color };
    },
    [groupedCourses, coursesColorMap, coursesCustomNames, theme.primary]
  );

  const courseEntries = useMemo(
    () => Object.entries(summary.courseGroups),
    [summary.courseGroups]
  );

  const gradedCourseCount = courseEntries.length;

  const selectedCourseMeta = useMemo(() => {
    if (!selectedAssignment) return { displayName: '', color: theme.primary };
    return resolveCourseMeta(selectedAssignment.courseId, selectedAssignment.courseName);
  }, [selectedAssignment, resolveCourseMeta, theme.primary]);

  const rowDir = isRtl ? 'row-reverse' : 'row';
  const textAlign = isRtl ? 'right' : 'left';

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: theme.background }]}
      edges={isLandscapeTablet ? ['top'] : ['top', 'left', 'right']}
    >
      {/* Header */}
      <View
        style={[
          styles.header,
          {
            backgroundColor: theme.backgroundElement,
            borderBottomColor: theme.border,
          },
        ]}
      >
        <View
          style={[
            styles.headerInner,
            isLandscapeTablet ? styles.centeredMax : styles.centeredPortrait,
            { flexDirection: rowDir },
          ]}
        >
          <View style={[styles.headerTitleRow, { flexDirection: rowDir }]}>
            <View style={[styles.iconBadge, { backgroundColor: `${theme.primary}1a` }]}>
              <GradesIcon size={20} color={theme.primary} />
            </View>
            <Text style={[styles.headerTitle, { color: theme.text, textAlign }]}>
              {t('grades')}
            </Text>
          </View>

          <Pressable
            onPress={() => {
              if (isSyncing) {
                openSyncWindow();
              } else {
                triggerSync({ manual: true }).catch(() => {});
              }
            }}
            accessibilityRole="button"
            accessibilityLabel={t('sync_now')}
            style={({ pressed }) => [
              styles.syncBtn,
              {
                backgroundColor: theme.backgroundSelected,
                borderColor: theme.border,
                opacity: pressed ? 0.7 : 1,
                flexDirection: rowDir,
              },
            ]}
          >
            <SpinningIcon spinning={isSyncing}>
              <RefreshIcon size={16} color={theme.primary} />
            </SpinningIcon>
            <Text style={[styles.syncBtnText, { color: theme.text }]}>
              {isSyncing ? t('syncing') : t('sync_now')}
            </Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          isLandscapeTablet ? styles.centeredMax : styles.centeredPortrait,
        ]}
        refreshControl={
          <RefreshControl
            refreshing={isSyncing}
            onRefresh={() => {
              triggerSync({ manual: true }).catch(() => {});
            }}
            tintColor={theme.primary}
            colors={[theme.primary]}
          />
        }
      >
        {/* Pedagogical Policy Banner */}
        <View
          style={[
            styles.policyBanner,
            {
              backgroundColor: `${theme.primary}14`,
              borderColor: theme.border,
              borderLeftWidth: isRtl ? 1 : 4,
              borderRightWidth: isRtl ? 4 : 1,
              borderLeftColor: isRtl ? theme.border : theme.primary,
              borderRightColor: isRtl ? theme.primary : theme.border,
              flexDirection: rowDir,
            },
          ]}
        >
          <View style={styles.policyIconWrap}>
            <InfoIcon size={18} color={theme.primary} />
          </View>
          <Text
            style={[
              styles.policyText,
              { color: theme.textSecondary, textAlign, writingDirection: 'auto' },
            ]}
          >
            {t('grades_policy_note')}
          </Text>
        </View>

        {/* Estimated GPA Hero Card */}
        <View
          style={[
            styles.gpaCard,
            {
              backgroundColor: theme.backgroundElement,
              borderColor: tourStep === 4 ? theme.primary : theme.border,
              borderWidth: tourStep === 4 ? 2 : 1,
              borderLeftWidth: isRtl ? (tourStep === 4 ? 2 : 1) : 4,
              borderRightWidth: isRtl ? 4 : tourStep === 4 ? 2 : 1,
              borderLeftColor: isRtl
                ? tourStep === 4
                  ? theme.primary
                  : theme.border
                : theme.secondary,
              borderRightColor: isRtl
                ? theme.secondary
                : tourStep === 4
                  ? theme.primary
                  : theme.border,
            },
          ]}
        >
          <Text style={[styles.gpaLabel, { color: theme.textSecondary }]}>
            {t('gpa_title')}
          </Text>
          <Text style={[styles.gpaValue, { color: theme.text }]}>
            {summary.overallGpa}
          </Text>
          <Text style={[styles.gpaSubtitle, { color: theme.textSecondary }]}>
            {t('unweighted_average')}
          </Text>

          <View style={[styles.gpaMetricsRow, { flexDirection: rowDir }]}>
            <View
              style={[
                styles.metricPill,
                { backgroundColor: theme.backgroundSelected, borderColor: theme.border },
              ]}
            >
              <Text style={[styles.metricPillText, { color: theme.text }]}>
                {isRtl
                  ? `${summary.totalCalculatedItems} מטלות עם ציון`
                  : `${summary.totalCalculatedItems} graded items`}
              </Text>
            </View>
            <View
              style={[
                styles.metricPill,
                { backgroundColor: theme.backgroundSelected, borderColor: theme.border },
              ]}
            >
              <Text style={[styles.metricPillText, { color: theme.text }]}>
                {isRtl
                  ? `${gradedCourseCount} קורסים`
                  : `${gradedCourseCount} courses`}
              </Text>
            </View>
          </View>
        </View>

        {/* Empty State or Course Grade Cards */}
        {summary.totalCalculatedItems === 0 ? (
          <View
            style={[
              styles.emptyCard,
              {
                backgroundColor: theme.backgroundElement,
                borderColor: theme.border,
              },
            ]}
          >
            <View
              style={[
                styles.emptyIconCircle,
                { backgroundColor: `${theme.primary}15` },
              ]}
            >
              <GradesIcon size={34} color={theme.primary} />
            </View>
            <Text style={[styles.emptyTitle, { color: theme.text }]}>
              {t('no_grades')}
            </Text>
            <Text style={[styles.emptyHint, { color: theme.textSecondary }]}>
              {isRtl
                ? 'ציונים יופיעו כאן אוטומטית ברגע שמטלות או בחנים ייבדקו ויפורסמו במודל.'
                : 'Graded assignments and quizzes will appear here automatically once published in Moodle.'}
            </Text>
            <Pressable
              onPress={() => {
                if (isSyncing) {
                  openSyncWindow();
                } else {
                  triggerSync({ manual: true }).catch(() => {});
                }
              }}
              style={({ pressed }) => [
                styles.emptySyncBtn,
                {
                  backgroundColor: theme.primary,
                  opacity: pressed ? 0.8 : 1,
                  flexDirection: rowDir,
                },
              ]}
            >
              <RefreshIcon size={15} color={theme.onPrimary} />
              <Text style={[styles.emptySyncBtnText, { color: theme.onPrimary }]}>
                {isSyncing ? t('syncing') : t('sync_now')}
              </Text>
            </Pressable>
          </View>
        ) : (
          <View
            style={[
              styles.coursesGrid,
              isTwoColumnGrid && [
                styles.coursesGridTablet,
                { flexDirection: rowDir },
              ],
            ]}
          >
            {courseEntries.map(([courseIdStr, group]) => {
              const courseId = Number(courseIdStr);
              const { displayName, color } = resolveCourseMeta(courseId, group.courseName);
              const moodleGradeSummary = syncResult.gradeSummaries?.[courseId];

              return (
                <View
                  key={courseIdStr}
                  style={[
                    styles.courseCard,
                    isTwoColumnGrid && styles.courseCardTablet,
                    {
                      backgroundColor: theme.backgroundElement,
                      borderColor: color,
                      borderWidth: 1,
                      borderLeftWidth: isRtl ? 1 : 5,
                      borderRightWidth: isRtl ? 5 : 1,
                    },
                  ]}
                >
                  {/* Course Header */}
                  <Pressable
                    onPress={() => router.push(`/course/${courseId}` as any)}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.courseHeader,
                      {
                        flexDirection: rowDir,
                        borderBottomColor: theme.border,
                        opacity: pressed ? 0.75 : 1,
                      },
                    ]}
                  >
                    <View style={[styles.courseTitleWrap, { alignItems: isRtl ? 'flex-end' : 'flex-start' }]}>
                      <View style={[styles.courseNameRow, { flexDirection: rowDir }]}>
                        <Text
                          numberOfLines={2}
                          style={[
                            styles.courseTitle,
                            { color, textAlign, writingDirection: 'auto' },
                          ]}
                        >
                          {displayName}
                        </Text>
                        {isRtl ? (
                          <ChevronLeftIcon size={15} color={theme.textSecondary} />
                        ) : (
                          <ChevronRightIcon size={15} color={theme.textSecondary} />
                        )}
                      </View>
                      {moodleGradeSummary?.hasCourseTotal &&
                      moodleGradeSummary.courseTotalFormatted ? (
                        <Text
                          style={[
                            styles.moodleTotalRef,
                            { color: theme.textSecondary, textAlign },
                          ]}
                        >
                          {isRtl
                            ? `ציון מסכם במודל: ${moodleGradeSummary.courseTotalFormatted}`
                            : `Moodle Gradebook Total: ${moodleGradeSummary.courseTotalFormatted}`}
                        </Text>
                      ) : null}
                    </View>

                    <View style={[styles.avgBadge, { backgroundColor: color }]}>
                      <Text
                        style={[
                          styles.avgBadgeText,
                          { color: getReadableTextColor(color) },
                        ]}
                      >
                        {t('course_average_label')}: {group.average}
                      </Text>
                    </View>
                  </Pressable>

                  {/* Graded Items List */}
                  <View style={styles.itemsList}>
                    {group.list.map((item, idx) => {
                      const feedbackText = stripHtmlToPlainText(item.feedback);
                      const isLast = idx === group.list.length - 1;
                      const pct =
                        item.effectiveGradeMax > 0
                          ? Math.round((item.effectiveGrade / item.effectiveGradeMax) * 100)
                          : null;

                      return (
                        <Pressable
                          key={item.uid || `${item.activityType || 'assign'}:${item.id}:${idx}`}
                          onPress={() => setSelectedAssignment(item)}
                          style={({ pressed }) => [
                            styles.gradeRow,
                            !isLast && {
                              borderBottomWidth: StyleSheet.hairlineWidth,
                              borderBottomColor: theme.border,
                            },
                            { opacity: pressed ? 0.7 : 1 },
                          ]}
                        >
                          <View style={[styles.gradeTopRow, { flexDirection: rowDir }]}>
                            <View
                              style={[
                                styles.gradeNameWrap,
                                { flexDirection: rowDir },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.gradeName,
                                  { color: theme.text, textAlign, writingDirection: 'auto' },
                                ]}
                              >
                                {item.name}
                              </Text>
                              {item.isBonus ? (
                                <View
                                  style={[
                                    styles.bonusBadge,
                                    {
                                      backgroundColor: `${theme.warning}22`,
                                      borderColor: `${theme.warning}55`,
                                      flexDirection: rowDir,
                                    },
                                  ]}
                                >
                                  <StarIcon size={11} color={theme.warning} />
                                  <Text style={[styles.bonusText, { color: theme.warning }]}>
                                    {t('grades_bonus_label')}
                                  </Text>
                                </View>
                              ) : null}
                            </View>

                            <View
                              style={[
                                styles.scoreWrap,
                                { alignItems: isRtl ? 'flex-start' : 'flex-end' },
                              ]}
                            >
                              <Text style={[styles.gradeScore, { color: theme.text }]}>
                                {item.effectiveGrade} / {item.effectiveGradeMax}
                              </Text>
                              {item.effectiveGradeMax !== 100 && pct !== null ? (
                                <Text style={[styles.gradePct, { color: theme.textSecondary }]}>
                                  {pct}%
                                </Text>
                              ) : null}
                            </View>
                          </View>

                          {feedbackText ? (
                            <View
                              style={[
                                styles.feedbackBox,
                                {
                                  backgroundColor: `${theme.secondary}12`,
                                  borderLeftWidth: isRtl ? 0 : 3,
                                  borderRightWidth: isRtl ? 3 : 0,
                                  borderLeftColor: isRtl ? 'transparent' : theme.secondary,
                                  borderRightColor: isRtl ? theme.secondary : 'transparent',
                                },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.feedbackLabel,
                                  { color: theme.secondary, textAlign },
                                ]}
                              >
                                {t('grader_feedback')}
                              </Text>
                              <Text
                                style={[
                                  styles.feedbackText,
                                  { color: theme.text, textAlign, writingDirection: 'auto' },
                                ]}
                              >
                                {feedbackText}
                              </Text>
                            </View>
                          ) : null}
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      <AssignmentDetailSheet
        visible={Boolean(selectedAssignment)}
        assignment={selectedAssignment}
        courseColor={selectedCourseMeta.color}
        courseDisplayName={selectedCourseMeta.displayName}
        onClose={() => setSelectedAssignment(null)}
        onNavigateToCourse={(cid) => {
          setSelectedAssignment(null);
          router.push(`/course/${cid}` as any);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  centeredMax: {
    maxWidth: 1120,
    alignSelf: 'center',
    width: '100%',
  },
  centeredPortrait: {
    maxWidth: 680,
    alignSelf: 'center',
    width: '100%',
  },
  header: {
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerInner: {
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerTitleRow: {
    alignItems: 'center',
    gap: 10,
  },
  iconBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
  },
  syncBtn: {
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
  },
  syncBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 36,
    gap: 16,
  },
  policyBanner: {
    borderRadius: 12,
    padding: 12,
    gap: 10,
    alignItems: 'center',
  },
  policyIconWrap: {
    flexShrink: 0,
  },
  policyText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
  },
  gpaCard: {
    borderRadius: 16,
    padding: 22,
    alignItems: 'center',
  },
  gpaLabel: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  gpaValue: {
    fontSize: 48,
    fontWeight: '800',
    marginTop: 6,
    letterSpacing: -0.5,
  },
  gpaSubtitle: {
    fontSize: 13,
    marginTop: 4,
    textAlign: 'center',
  },
  gpaMetricsRow: {
    marginTop: 14,
    gap: 8,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  metricPill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  metricPillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  emptyCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 28,
    alignItems: 'center',
    gap: 10,
  },
  emptyIconCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptyHint: {
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
    maxWidth: 420,
  },
  emptySyncBtn: {
    marginTop: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    gap: 8,
  },
  emptySyncBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  coursesGrid: {
    gap: 14,
  },
  coursesGridTablet: {
    flexWrap: 'wrap',
    alignItems: 'flex-start',
  },
  courseCard: {
    borderRadius: 14,
    overflow: 'hidden',
    padding: 16,
  },
  courseCardTablet: {
    flexBasis: '48%',
    flexGrow: 1,
  },
  courseHeader: {
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 12,
    marginBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  courseTitleWrap: {
    flex: 1,
    gap: 3,
  },
  courseNameRow: {
    alignItems: 'center',
    gap: 4,
  },
  courseTitle: {
    fontSize: 16,
    fontWeight: '700',
    flexShrink: 1,
  },
  moodleTotalRef: {
    fontSize: 11,
    fontWeight: '500',
  },
  avgBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    flexShrink: 0,
  },
  avgBadgeText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  itemsList: {
    gap: 2,
  },
  gradeRow: {
    paddingVertical: 10,
    gap: 6,
  },
  gradeTopRow: {
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  gradeNameWrap: {
    flex: 1,
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  gradeName: {
    fontSize: 14,
    fontWeight: '600',
    flexShrink: 1,
  },
  bonusBadge: {
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  bonusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  scoreWrap: {
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  gradeScore: {
    fontSize: 14,
    fontWeight: '700',
  },
  gradePct: {
    fontSize: 11,
    fontWeight: '600',
  },
  feedbackBox: {
    marginTop: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    gap: 2,
  },
  feedbackLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
  feedbackText: {
    fontSize: 12,
    lineHeight: 18,
  },
});
