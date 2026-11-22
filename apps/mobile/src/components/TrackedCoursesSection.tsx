import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Href, useRouter } from 'expo-router';
import {
  Assignment,
  CoursePanoptoStaffEntry,
  GroupedCoursesResult,
  MoodleCourse,
  PanoptoRecording,
  SyncResult,
  UnifiedCourse,
  aggregateUnifiedCourseItems,
  cleanCourseDisplayName,
  isActivityCompleted,
  isActivityHidden,
  partitionPanoptoRecordingsByTrackedHosts,
} from '@tautracker/moodle-client';
import { COURSE_COLOR_PALETTE } from '@/constants/theme';
import { useAppState } from '@/hooks/use-app-state';
import { usePreferences } from '@/hooks/use-preferences';
import { useResponsiveLayout } from '@/hooks/use-responsive-layout';
import { getDueTextAndClass } from '@/services/dateUtils';
import { CoursesViewMode } from '@/services/settingsSyncService';
import { ManageCoursesModal } from '@/components/ManageCoursesModal';
import {
  AnimatedProgressBar,
  NoodleGradientButton,
  animateLayout,
} from '@/components/ui/NoodleAnimations';
import {
  AssignmentsIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CourseIcon,
} from '@/components/icons/NoodleIcons';

export interface UnifiedCourseSummary {
  course: UnifiedCourse;
  displayName: string;
  subtitle: string | null;
  color: string;
  totalAssigns: number;
  doneAssigns: number;
  totalLectures: number;
  doneLectures: number;
  totalRecitations: number;
  doneRecitations: number;
  totalItems: number;
  doneItems: number;
  overallPercent: number;
  nextTask: Assignment | null;
}

export function getDeadlineSortBucket(
  deadline: string | null,
  nowMs: number
): {
  bucket: 0 | 1 | 2;
  ts: number;
} {
  if (!deadline) {
    return { bucket: 1, ts: 0 };
  }
  const ts = new Date(deadline).getTime();
  if (Number.isNaN(ts)) {
    return { bucket: 1, ts: 0 };
  }
  if (ts > nowMs) {
    return { bucket: 0, ts };
  }
  return { bucket: 2, ts };
}

export function sortUpcomingTodoQueue(
  assignments: Assignment[],
  nowMs: number
): Assignment[] {
  return [...assignments].sort((a, b) => {
    const infoA = getDeadlineSortBucket(a.deadline, nowMs);
    const infoB = getDeadlineSortBucket(b.deadline, nowMs);

    if (infoA.bucket !== infoB.bucket) {
      return infoA.bucket - infoB.bucket;
    }

    if (infoA.bucket === 1) {
      return a.id - b.id;
    }

    const diff = infoA.ts - infoB.ts;
    if (diff !== 0) return diff;
    return a.id - b.id;
  });
}

export function buildTrackedUnifiedCourses(
  trackedCourseIds: number[],
  groupedCourses: GroupedCoursesResult,
  syncResult: SyncResult,
  enrolledCourses: MoodleCourse[],
  coursesCustomNames: Record<number, string>
): UnifiedCourse[] {
  const trackedSet = new Set(trackedCourseIds);
  const coveredIds = new Set<number>();
  const result: UnifiedCourse[] = [];

  for (const u of groupedCourses.academicCourses) {
    const hasTrackedMember =
      trackedSet.has(u.id) ||
      u.subCourses.some((s) => trackedSet.has(s.courseId));
    if (!hasTrackedMember) continue;

    const trackedSubs = u.subCourses.filter((s) => trackedSet.has(s.courseId));
    const effectiveSubs = trackedSubs.length > 0 ? trackedSubs : u.subCourses;
    for (const s of effectiveSubs) {
      coveredIds.add(s.courseId);
    }
    coveredIds.add(u.id);

    const displayId = trackedSet.has(u.id)
      ? u.id
      : effectiveSubs[0]?.courseId ?? u.id;

    result.push({
      ...u,
      id: displayId,
      subCourses: effectiveSubs,
    });
  }

  const admin = groupedCourses.administrativeUmbrella;
  if (admin) {
    const umbrellaSelected = trackedSet.has(admin.id);
    const trackedAdminSubs = admin.subCourses.filter((s) =>
      trackedSet.has(s.courseId)
    );
    if (umbrellaSelected || trackedAdminSubs.length > 0) {
      const effectiveSubs = umbrellaSelected ? admin.subCourses : trackedAdminSubs;
      for (const s of effectiveSubs) {
        coveredIds.add(s.courseId);
      }
      coveredIds.add(admin.id);
      result.push({
        ...admin,
        subCourses: effectiveSubs,
      });
    }
  }

  const fallbackPool = [...(syncResult.courses || []), ...enrolledCourses];
  for (const cid of trackedCourseIds) {
    if (coveredIds.has(cid)) continue;
    const meta = fallbackPool.find((c) => c.id === cid);
    const title = meta
      ? cleanCourseDisplayName(meta.fullname) || meta.fullname
      : coursesCustomNames[cid] || `Course ${cid}`;
    coveredIds.add(cid);
    result.push({
      id: cid,
      courseCode: meta?.courseId || String(cid),
      fullname: title,
      shortname: meta?.shortname || '',
      semester: meta?.semester || 'Other',
      year: meta?.year || '',
      subCourses: [
        {
          courseId: cid,
          shortname: meta?.shortname || '',
          groupId: '00',
          fullname: meta?.fullname || title,
          isParentPortal: true,
        },
      ],
    });
  }

  return result;
}

export function useTrackedCourseSummaries(skip: boolean = false): UnifiedCourseSummary[] {
  const { theme } = usePreferences();
  const {
    syncResult,
    groupedCourses,
    enrolledCourses,
    trackedCourseIds,
    coursesColorMap,
    coursesCustomNames,
    completedAssignments,
    uncompletedAssignments,
    hiddenAssignments,
    watchedRecordings,
    hiddenRecordings,
    coursesPanoptoStaff,
    settings,
  } = useAppState();

  const [nowMs] = useState<number>(() => Date.now());
  const panoptoEnabled = Boolean(settings.panoptoEnabled);

  return useMemo(() => {
    if (skip) return [];

    const watchedSet = new Set(watchedRecordings);
    const trackedUnifiedCourses = buildTrackedUnifiedCourses(
      trackedCourseIds,
      groupedCourses,
      syncResult,
      enrolledCourses,
      coursesCustomNames
    );

    const summaries: UnifiedCourseSummary[] = [];

    trackedUnifiedCourses.forEach((uc, idx) => {
      const aggregated = aggregateUnifiedCourseItems(uc, syncResult);
      const color =
        coursesColorMap[uc.id] ||
        COURSE_COLOR_PALETTE[idx % COURSE_COLOR_PALETTE.length] ||
        theme.primary;
      const customNick = coursesCustomNames[uc.id]?.trim();
      const cleanedRealName = cleanCourseDisplayName(uc.fullname) || uc.fullname;
      const displayName =
        customNick && customNick.length > 0
          ? customNick
          : cleanedRealName || uc.fullname || `Course ${uc.id}`;
      const subtitle =
        customNick && cleanedRealName && customNick !== cleanedRealName
          ? uc.courseCode && !cleanedRealName.includes(uc.courseCode)
            ? `${cleanedRealName} · ${uc.courseCode}`
            : cleanedRealName
          : null;

      const visibleAssigns = aggregated.assignments.filter(
        (a) => !isActivityHidden(a, hiddenAssignments)
      );
      const doneAssigns = visibleAssigns.filter((a) =>
        isActivityCompleted(a, completedAssignments, uncompletedAssignments)
      );

      const staffMap = coursesPanoptoStaff as Record<
        string | number,
        CoursePanoptoStaffEntry[] | undefined
      >;
      let courseStaffEntries: CoursePanoptoStaffEntry[] =
        staffMap[uc.id] || staffMap[String(uc.id)] || [];
      if (courseStaffEntries.length === 0) {
        for (const sub of uc.subCourses) {
          const subStaff = staffMap[sub.courseId] || staffMap[String(sub.courseId)];
          if (subStaff && subStaff.length > 0) {
            courseStaffEntries = subStaff;
            break;
          }
        }
      }

      const visibleRecs: PanoptoRecording[] = panoptoEnabled
        ? partitionPanoptoRecordingsByTrackedHosts(
            aggregated.recordings,
            courseStaffEntries,
            hiddenRecordings
          ).visible
        : [];

      const courseLectures = visibleRecs.filter((r) => r.type === 'Lecture');
      const doneLectures = courseLectures.filter((r) => watchedSet.has(r.id));
      const courseRecitations = visibleRecs.filter((r) => r.type === 'Recitation');
      const doneRecitations = courseRecitations.filter((r) => watchedSet.has(r.id));

      const totalItems =
        visibleAssigns.length +
        (panoptoEnabled ? courseLectures.length + courseRecitations.length : 0);
      const doneItems =
        doneAssigns.length +
        (panoptoEnabled ? doneLectures.length + doneRecitations.length : 0);
      const overallPercent =
        totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : 0;

      const pendingForCourse = sortUpcomingTodoQueue(
        visibleAssigns.filter(
          (a) =>
            !isActivityCompleted(a, completedAssignments, uncompletedAssignments)
        ),
        nowMs
      );

      summaries.push({
        course: uc,
        displayName,
        subtitle,
        color,
        totalAssigns: visibleAssigns.length,
        doneAssigns: doneAssigns.length,
        totalLectures: courseLectures.length,
        doneLectures: doneLectures.length,
        totalRecitations: courseRecitations.length,
        doneRecitations: doneRecitations.length,
        totalItems,
        doneItems,
        overallPercent,
        nextTask: pendingForCourse[0] || null,
      });
    });

    return summaries;
  }, [
    skip,
    nowMs,
    trackedCourseIds,
    groupedCourses,
    syncResult,
    enrolledCourses,
    coursesCustomNames,
    coursesColorMap,
    theme.primary,
    hiddenAssignments,
    completedAssignments,
    uncompletedAssignments,
    coursesPanoptoStaff,
    panoptoEnabled,
    hiddenRecordings,
    watchedRecordings,
  ]);
}

export interface TrackedCoursesSectionProps {
  courseSummaries?: UnifiedCourseSummary[];
}

export function TrackedCoursesSection({
  courseSummaries: providedSummaries,
}: TrackedCoursesSectionProps) {
  const router = useRouter();
  const { width, isLandscapeTablet, isCompactPhone } = useResponsiveLayout();
  const { theme, language, isRtl, t } = usePreferences();
  const { settings, updateSetting } = useAppState();
  const [manageCoursesVisible, setManageCoursesVisible] = useState(false);
  const [gridWidth, setGridWidth] = useState(0);

  const computedSummaries = useTrackedCourseSummaries(Boolean(providedSummaries));
  const courseSummaries = providedSummaries ?? computedSummaries;

  const panoptoEnabled = Boolean(settings.panoptoEnabled);
  const coursesViewMode: CoursesViewMode = settings.coursesViewMode || 'cards';
  const rowDir = isRtl ? 'row-reverse' : 'row';
  const textAlign = isRtl ? 'right' : 'left';

  const containerMaxWidth = isLandscapeTablet
    ? 1280
    : width >= 600
      ? 860
      : 680;
  const usableWidth =
    gridWidth > 0
      ? gridWidth
      : Math.max(
          240,
          Math.min(isLandscapeTablet ? width - 220 : width, containerMaxWidth) - 32
        );

  const cardColumns = isLandscapeTablet
    ? usableWidth >= 820
      ? 3
      : 2
    : usableWidth < 390 || isCompactPhone || courseSummaries.length === 1
      ? 1
      : 2;
  const isCompactPair = !isLandscapeTablet && cardColumns > 1 && usableWidth < 520;
  const cardGap = isCompactPair ? 10 : 12;
  const multiCardWidth =
    cardColumns > 1
      ? Math.floor((usableWidth - cardGap * (cardColumns - 1)) / cardColumns)
      : undefined;

  const badgePalette = {
    'badge-success': { bg: `${theme.secondary}20`, fg: theme.secondary },
    'badge-warning': { bg: `${theme.warning}20`, fg: theme.warning },
    'badge-danger': { bg: `${theme.danger}20`, fg: theme.danger },
    'badge-muted': { bg: theme.backgroundSelected, fg: theme.textSecondary },
  };

  return (
    <View
      style={styles.coursesSection}
      onLayout={(e) => {
        const measured = Math.floor(e.nativeEvent.layout.width);
        if (measured > 0 && Math.abs(measured - gridWidth) > 2) {
          setGridWidth(measured);
        }
      }}
    >
      <View style={[styles.coursesHeader, { flexDirection: rowDir }]}>
        <Text style={[styles.sectionTitle, { color: theme.text, textAlign }]}>
          {t('my_courses_title')}
        </Text>

        <View style={[styles.coursesHeaderActions, { flexDirection: rowDir }]}>
          <NoodleGradientButton
            testID="dashboard-manage-courses-btn"
            label={t('manage_courses_btn')}
            icon={<CourseIcon size={15} color="#ffffff" />}
            onPress={() => setManageCoursesVisible(true)}
            isRtl={isRtl}
            size="sm"
          />

          <View
            style={[
              styles.segmentedGroup,
              {
                backgroundColor: theme.backgroundElement,
                borderColor: theme.border,
                flexDirection: rowDir,
              },
            ]}
          >
            <TouchableOpacity
              onPress={() => {
                animateLayout();
                updateSetting('coursesViewMode', 'cards');
              }}
              style={[
                styles.segmentedBtn,
                coursesViewMode === 'cards' && { backgroundColor: theme.primary },
              ]}
            >
              <Text
                style={[
                  styles.segmentedBtnText,
                  {
                    color:
                      coursesViewMode === 'cards'
                        ? theme.onPrimary
                        : theme.textSecondary,
                  },
                ]}
              >
                {t('view_cards')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                animateLayout();
                updateSetting('coursesViewMode', 'list');
              }}
              style={[
                styles.segmentedBtn,
                coursesViewMode === 'list' && { backgroundColor: theme.primary },
              ]}
            >
              <Text
                style={[
                  styles.segmentedBtnText,
                  {
                    color:
                      coursesViewMode === 'list'
                        ? theme.onPrimary
                        : theme.textSecondary,
                  },
                ]}
              >
                {t('view_list')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {courseSummaries.length === 0 ? (
        <View
          style={[
            styles.emptyCoursesCard,
            {
              backgroundColor: theme.backgroundElement,
              borderColor: theme.border,
            },
          ]}
        >
          <CourseIcon size={28} color={theme.textSecondary} />
          <Text
            style={[
              styles.emptyCoursesText,
              { color: theme.textSecondary, textAlign: 'center' },
            ]}
          >
            {t('no_tracked_courses_tip')}
          </Text>
          <NoodleGradientButton
            label={t('manage_courses_btn')}
            icon={<CourseIcon size={15} color="#ffffff" />}
            onPress={() => setManageCoursesVisible(true)}
            isRtl={isRtl}
            size="md"
          />
        </View>
      ) : coursesViewMode === 'cards' ? (
        <View
          testID="dashboard-courses-cards-grid"
          style={[
            styles.cardsGrid,
            { flexDirection: cardColumns > 1 ? rowDir : 'column', gap: cardGap },
          ]}
        >
          {courseSummaries.map((item) => {
            const nextDue = item.nextTask?.deadline
              ? getDueTextAndClass(
                  item.nextTask.deadline,
                  language,
                  settings.dueDateGreenDays,
                  settings.dueDateYellowDays,
                  true,
                  item.nextTask.status
                )
              : null;
            const nextDueColors = nextDue
              ? badgePalette[nextDue.badgeClass]
              : null;
            const assignPending = item.doneAssigns < item.totalAssigns;
            const lecturesPending = item.doneLectures < item.totalLectures;
            const recitationsPending = item.doneRecitations < item.totalRecitations;

            return (
              <TouchableOpacity
                key={item.course.id}
                testID={`course-card-${item.course.id}`}
                onPress={() => router.push(`/course/${item.course.id}` as Href)}
                activeOpacity={0.8}
                style={[
                  styles.courseGridCard,
                  {
                    backgroundColor: theme.backgroundElement,
                    borderColor: theme.border,
                    borderTopColor: item.color,
                    borderLeftWidth: isRtl ? 1 : 4,
                    borderRightWidth: isRtl ? 4 : 1,
                    borderLeftColor: isRtl ? theme.border : item.color,
                    borderRightColor: isRtl ? item.color : theme.border,
                    padding: isCompactPair ? 10 : 14,
                    width: multiCardWidth ?? '100%',
                  },
                ]}
              >
                <View style={[styles.courseCardTop, { flexDirection: rowDir }]}>
                  <View
                    style={[styles.courseDot, { backgroundColor: item.color }]}
                  />
                  <Text
                    style={[
                      styles.courseCardTitle,
                      {
                        color: item.color,
                        textAlign,
                        fontSize: isCompactPair ? 13 : 15,
                      },
                    ]}
                    numberOfLines={2}
                  >
                    {item.displayName}
                  </Text>
                  {isRtl ? (
                    <ChevronLeftIcon size={15} color={theme.textSecondary} />
                  ) : (
                    <ChevronRightIcon size={15} color={theme.textSecondary} />
                  )}
                </View>

                <View style={[styles.pillsRow, { flexDirection: rowDir }]}>
                  <View
                    style={[
                      styles.statPill,
                      assignPending ? styles.gapPendingPill : styles.gapClearPill,
                    ]}
                  >
                    <Text
                      style={[
                        styles.statPillText,
                        {
                          color: assignPending ? '#f59e0b' : '#10b981',
                          fontSize: isCompactPair ? 10 : 11,
                        },
                      ]}
                    >
                      {`${t('assignments_label')}: ${item.doneAssigns}/${item.totalAssigns}`}
                    </Text>
                  </View>
                  {panoptoEnabled && (
                    <>
                      <View
                        style={[
                          styles.statPill,
                          lecturesPending ? styles.gapPendingPill : styles.gapClearPill,
                        ]}
                      >
                        <Text
                          style={[
                            styles.statPillText,
                            {
                              color: lecturesPending ? '#f59e0b' : '#10b981',
                              fontSize: isCompactPair ? 10 : 11,
                            },
                          ]}
                        >
                          {`${t('lectures_label')}: ${item.doneLectures}/${item.totalLectures}`}
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.statPill,
                          recitationsPending
                            ? styles.gapPendingPill
                            : styles.gapClearPill,
                        ]}
                      >
                        <Text
                          style={[
                            styles.statPillText,
                            {
                              color: recitationsPending ? '#f59e0b' : '#10b981',
                              fontSize: isCompactPair ? 10 : 11,
                            },
                          ]}
                        >
                          {`${t('recitations_label')}: ${item.doneRecitations}/${item.totalRecitations}`}
                        </Text>
                      </View>
                    </>
                  )}
                </View>

                <View
                  style={[
                    styles.nextTaskBox,
                    {
                      backgroundColor: theme.background,
                      borderColor: theme.border,
                      flexDirection: isCompactPair ? 'column' : rowDir,
                      alignItems: isCompactPair
                        ? isRtl
                          ? 'flex-end'
                          : 'flex-start'
                        : 'center',
                    },
                  ]}
                >
                  <View style={styles.nextTaskTexts}>
                    <Text
                      style={[
                        styles.nextTaskCaption,
                        { color: theme.textSecondary, textAlign },
                      ]}
                    >
                      {t('next_task')}
                    </Text>
                    <Text
                      style={[
                        styles.nextTaskName,
                        {
                          color: theme.text,
                          textAlign,
                          fontSize: isCompactPair ? 11.5 : 12.5,
                        },
                      ]}
                      numberOfLines={1}
                    >
                      {item.nextTask ? item.nextTask.name : t('no_pending_tasks')}
                    </Text>
                  </View>
                  {nextDue && nextDueColors && (
                    <View
                      style={[
                        styles.dueBadge,
                        { backgroundColor: nextDueColors.bg },
                      ]}
                    >
                      <Text
                        style={[styles.dueBadgeText, { color: nextDueColors.fg }]}
                      >
                        {nextDue.deadlineText}
                      </Text>
                    </View>
                  )}
                </View>

                <View style={styles.courseCardFooter}>
                  <View
                    style={[
                      styles.progressMetaRow,
                      { flexDirection: rowDir, marginBottom: 4 },
                    ]}
                  >
                    <Text
                      style={[
                        styles.progressNumbers,
                        { color: theme.textSecondary },
                      ]}
                    >
                      {`${item.overallPercent}%`}
                    </Text>
                    <TouchableOpacity
                      onPress={(e) => {
                        e.stopPropagation();
                        router.push({
                          pathname: '/(tabs)/assignments',
                          params: { courseId: String(item.course.id) },
                        } as unknown as Href);
                      }}
                      style={[
                        styles.quickFilterLink,
                        {
                          backgroundColor: `${item.color}1C`,
                          flexDirection: rowDir,
                          paddingHorizontal: isCompactPair ? 6 : 9,
                        },
                      ]}
                    >
                      <AssignmentsIcon size={11} color={item.color} />
                      <Text
                        style={[
                          styles.quickFilterText,
                          {
                            color: item.color,
                            fontSize: isCompactPair ? 10.5 : 11.5,
                          },
                        ]}
                      >
                        {t('assignments')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <AnimatedProgressBar
                    percent={item.overallPercent}
                    color={item.color}
                    trackColor={theme.backgroundSelected}
                    height={6}
                    isRtl={isRtl}
                  />
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : (
        <View style={styles.listStack}>
          {courseSummaries.map((item) => {
            const nextDue = item.nextTask?.deadline
              ? getDueTextAndClass(
                  item.nextTask.deadline,
                  language,
                  settings.dueDateGreenDays,
                  settings.dueDateYellowDays,
                  true,
                  item.nextTask.status
                )
              : null;
            const nextDueColors = nextDue
              ? badgePalette[nextDue.badgeClass]
              : null;

            return (
              <TouchableOpacity
                key={item.course.id}
                onPress={() => router.push(`/course/${item.course.id}` as Href)}
                activeOpacity={0.8}
                style={[
                  styles.courseListRow,
                  {
                    backgroundColor: theme.backgroundElement,
                    borderColor: theme.border,
                    borderLeftWidth: isRtl ? 1 : 4,
                    borderRightWidth: isRtl ? 4 : 1,
                    borderLeftColor: isRtl ? theme.border : item.color,
                    borderRightColor: isRtl ? item.color : theme.border,
                    flexDirection: rowDir,
                  },
                ]}
              >
                <View style={styles.courseListMain}>
                  <View style={[styles.courseListTitleRow, { flexDirection: rowDir }]}>
                    <Text
                      style={[
                        styles.courseCardTitle,
                        { color: item.color, textAlign },
                      ]}
                      numberOfLines={1}
                    >
                      {item.displayName}
                    </Text>
                    <Text
                      style={[
                        styles.progressNumbers,
                        { color: theme.textSecondary },
                      ]}
                    >
                      {`${item.overallPercent}%`}
                    </Text>
                  </View>

                  <View style={[styles.pillsRow, { flexDirection: rowDir }]}>
                    <Text
                      style={[
                        styles.listMetaText,
                        { color: theme.textSecondary, textAlign },
                      ]}
                    >
                      {`${t('assignments_label')} ${item.doneAssigns}/${item.totalAssigns}`}
                      {panoptoEnabled
                        ? ` | ${t('lectures_label')} ${item.doneLectures}/${item.totalLectures} | ${t('recitations_label')} ${item.doneRecitations}/${item.totalRecitations}`
                        : ''}
                    </Text>
                  </View>

                  {item.nextTask && (
                    <View style={[styles.listNextTaskRow, { flexDirection: rowDir }]}>
                      <Text
                        style={[
                          styles.listNextTaskText,
                          { color: theme.text, textAlign },
                        ]}
                        numberOfLines={1}
                      >
                        {`${t('next_task')}: ${item.nextTask.name}`}
                      </Text>
                      {nextDue && nextDueColors && (
                        <View
                          style={[
                            styles.dueBadge,
                            { backgroundColor: nextDueColors.bg },
                          ]}
                        >
                          <Text
                            style={[
                              styles.dueBadgeText,
                              { color: nextDueColors.fg },
                            ]}
                          >
                            {nextDue.deadlineText}
                          </Text>
                        </View>
                      )}
                    </View>
                  )}
                </View>

                <View style={[styles.courseListActions, { flexDirection: rowDir }]}>
                  <TouchableOpacity
                    onPress={(e) => {
                      e.stopPropagation();
                      router.push({
                        pathname: '/(tabs)/assignments',
                        params: { courseId: String(item.course.id) },
                      } as unknown as Href);
                    }}
                    style={[
                      styles.quickFilterLink,
                      {
                        backgroundColor: `${item.color}1C`,
                        flexDirection: rowDir,
                      },
                    ]}
                  >
                    <AssignmentsIcon size={12} color={item.color} />
                    <Text style={[styles.quickFilterText, { color: item.color }]}>
                      {t('assignments')}
                    </Text>
                  </TouchableOpacity>
                  <NoodleGradientButton
                    testID={`course-go-btn-${item.course.id}`}
                    size="xs"
                    label={t('go_to_course')}
                    icon={<CourseIcon size={11} color="#ffffff" />}
                    onPress={() => router.push(`/course/${item.course.id}` as Href)}
                    isRtl={isRtl}
                  />
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      <ManageCoursesModal
        visible={manageCoursesVisible}
        onClose={() => setManageCoursesVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  coursesSection: {
    gap: 12,
  },
  coursesHeader: {
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 10,
  },
  coursesHeaderActions: {
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  segmentedGroup: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 3,
    gap: 3,
  },
  segmentedBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 7,
  },
  segmentedBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  emptyCoursesCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
    gap: 10,
  },
  emptyCoursesText: {
    fontSize: 13.5,
    lineHeight: 20,
  },
  cardsGrid: {
    flexWrap: 'wrap',
    gap: 12,
  },
  courseGridCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderTopWidth: 4,
    padding: 14,
    gap: 10,
  },
  courseCardTop: {
    alignItems: 'center',
    gap: 8,
  },
  courseDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
  },
  courseCardTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
  },
  pillsRow: {
    flexWrap: 'wrap',
    gap: 6,
  },
  statPill: {
    paddingHorizontal: 7,
    paddingVertical: 3.5,
    borderRadius: 7,
  },
  gapPendingPill: {
    backgroundColor: 'rgba(245, 158, 11, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.34)',
  },
  gapClearPill: {
    backgroundColor: 'rgba(16, 185, 129, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.34)',
  },
  statPillText: {
    fontSize: 11,
    fontWeight: '600',
  },
  nextTaskBox: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  nextTaskTexts: {
    flex: 1,
    gap: 2,
  },
  nextTaskCaption: {
    fontSize: 10.5,
    fontWeight: '700',
  },
  nextTaskName: {
    fontSize: 12.5,
    fontWeight: '600',
  },
  dueBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  dueBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  courseCardFooter: {
    gap: 4,
  },
  progressMetaRow: {
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  progressNumbers: {
    fontSize: 12,
    fontWeight: '600',
  },
  quickFilterLink: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
    alignItems: 'center',
    gap: 5,
  },
  quickFilterText: {
    fontSize: 11.5,
    fontWeight: '700',
  },
  listStack: {
    gap: 10,
  },
  courseListRow: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 13,
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  courseListMain: {
    flex: 1,
    gap: 5,
  },
  courseListTitleRow: {
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  listMetaText: {
    fontSize: 12,
    fontWeight: '500',
  },
  listNextTaskRow: {
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  listNextTaskText: {
    fontSize: 12,
    fontWeight: '600',
    flexShrink: 1,
  },
  courseListActions: {
    alignItems: 'center',
    gap: 8,
  },
});
