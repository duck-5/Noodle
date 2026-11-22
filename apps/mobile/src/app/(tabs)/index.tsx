import React, { useEffect, useMemo, useState } from 'react';
import {
  Animated,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Href, useRouter } from 'expo-router';
import {
  Assignment,
  CoursePanoptoStaffEntry,
  PanoptoRecording,
  UnifiedCourse,
  ZoomMeeting,
  aggregateUnifiedCourseItems,
  cleanCourseDisplayName,
  collapseRecurringMeetings,
  getActivityUid,
  getZoomMeetingKey,
  hasGracePeriod,
  isActivityCompleted,
  isActivityHidden,
  isZoomMeetingHidden,
  partitionPanoptoRecordingsByTrackedHosts,
} from '@tautracker/moodle-client';
import { COURSE_COLOR_PALETTE } from '@/constants/theme';
import * as AppStateModule from '@/hooks/use-app-state';
import type { SyncProgressContextValue } from '@/hooks/use-app-state';
import { usePreferences } from '@/hooks/use-preferences';
import { useResponsiveLayout } from '@/hooks/use-responsive-layout';
import {
  formatShortDate,
  formatTimeHM,
  getDueTextAndClass,
  getZoomLiveStatus,
} from '@/services/dateUtils';
import { openMoodleUrl } from '@/services/moodleLink';
import { SemesterProgressMode } from '@/services/settingsSyncService';
import { AssignmentDetailSheet } from '@/components/AssignmentDetailSheet';
import {
  TrackedCoursesSection,
  UnifiedCourseSummary,
  buildTrackedUnifiedCourses,
  sortUpcomingTodoQueue,
} from '@/components/TrackedCoursesSection';
import {
  AnimatedProgressBar,
  ClosestTaskGlowWrap,
  SpinningIcon,
  animateLayout,
} from '@/components/ui/NoodleAnimations';
import {
  AssignmentsIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  ClockIcon,
  CourseIcon,
  DashboardIcon,
  ExternalLinkIcon,
  QuizIcon,
  RecordingsIcon,
  RefreshIcon,
  StarIcon,
  TrashIcon,
  VideoIcon,
} from '@/components/icons/NoodleIcons';

const isJestEnv =
  typeof process !== 'undefined' && Boolean(process.env?.JEST_WORKER_ID);

function useNullSyncProgress(): Partial<SyncProgressContextValue> | null {
  return null;
}

const useSyncProgressHook: () => Partial<SyncProgressContextValue> | null =
  typeof AppStateModule.useSyncProgress === 'function'
    ? AppStateModule.useSyncProgress
    : useNullSyncProgress;

function LivePulseDot({ color }: { color: string }) {
  const [pulseAnim] = useState(() => new Animated.Value(isJestEnv ? 1 : 0.45));

  useEffect(() => {
    if (isJestEnv) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 750,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.4,
          duration: 750,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulseAnim]);

  return (
    <Animated.View
      style={[
        styles.liveDot,
        { backgroundColor: color, opacity: pulseAnim },
      ]}
    />
  );
}

export default function DashboardScreen() {
  const router = useRouter();
  const { width, isLandscapeTablet } = useResponsiveLayout();
  const { theme, language, isRtl, t } = usePreferences();
  const syncProgressCtx = useSyncProgressHook();
  const openSyncWindow = syncProgressCtx?.openSyncWindow;
  const {
    userFullname,
    lastSyncedAt,
    isSyncing,
    syncResult,
    groupedCourses,
    enrolledCourses,
    trackedCourseIds,
    coursesColorMap,
    coursesCustomNames,
    completedAssignments,
    uncompletedAssignments,
    hiddenAssignments,
    hiddenZoomMeetings,
    watchedRecordings,
    hiddenRecordings,
    coursesPanoptoStaff,
    settings,
    triggerSync,
    toggleAssignmentHidden,
    toggleRecordingWatched,
    toggleRecordingHidden,
    updateSetting,
  } = AppStateModule.useAppState();

  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);
  const [progressMenuOpen, setProgressMenuOpen] = useState(false);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    const intervalId = setInterval(() => {
      setNowMs(Date.now());
    }, 60_000);
    return () => clearInterval(intervalId);
  }, []);

  const isWideHero = isLandscapeTablet;
  const containerMaxWidth = isLandscapeTablet
    ? 1280
    : width >= 600
      ? 860
      : 680;

  const rowDir = isRtl ? 'row-reverse' : 'row';
  const textAlign = isRtl ? 'right' : 'left';
  const panoptoEnabled = Boolean(settings.panoptoEnabled);
  const semesterProgressMode: SemesterProgressMode =
    settings.semesterProgressMode || 'total';

  const getCourseColor = (courseId: number, fallbackIdx: number = 0): string => {
    return (
      coursesColorMap[courseId] ||
      COURSE_COLOR_PALETTE[fallbackIdx % COURSE_COLOR_PALETTE.length] ||
      theme.primary
    );
  };

  const getCourseDisplayName = (courseId: number, rawName?: string): string => {
    const custom = coursesCustomNames[courseId];
    if (custom && custom.trim()) return custom.trim();
    const cleaned = rawName ? cleanCourseDisplayName(rawName) : '';
    return cleaned || rawName || `Course ${courseId}`;
  };

  // Build deduplicated list of tracked UnifiedCourses
  const trackedUnifiedCourses = useMemo<UnifiedCourse[]>(
    () =>
      buildTrackedUnifiedCourses(
        trackedCourseIds,
        groupedCourses,
        syncResult,
        enrolledCourses,
        coursesCustomNames
      ),
    [
      trackedCourseIds,
      groupedCourses,
      syncResult,
      enrolledCourses,
      coursesCustomNames,
    ]
  );

  // Aggregate items per tracked course & across dashboard queues
  const dashboardData = useMemo(() => {
    const watchedSet = new Set(watchedRecordings);
    const trackedMemberSet = new Set<number>(trackedCourseIds);

    const courseSummaries: UnifiedCourseSummary[] = [];
    const allVisibleAssignments: Assignment[] = [];
    const allVisibleRecordings: PanoptoRecording[] = [];
    const seenAssignUids = new Set<string>();
    const seenRecIds = new Set<string>();

    let totalAssignsAll = 0;
    let doneAssignsAll = 0;
    let totalLecturesAll = 0;
    let doneLecturesAll = 0;
    let totalRecitationsAll = 0;
    let doneRecitationsAll = 0;

    trackedUnifiedCourses.forEach((uc, idx) => {
      for (const s of uc.subCourses) {
        trackedMemberSet.add(s.courseId);
      }
      trackedMemberSet.add(uc.id);

      const aggregated = aggregateUnifiedCourseItems(uc, syncResult);
      const color = getCourseColor(uc.id, idx);
      const customNick = coursesCustomNames[uc.id]?.trim();
      const cleanedRealName = cleanCourseDisplayName(uc.fullname) || uc.fullname;
      const displayName = getCourseDisplayName(uc.id, uc.fullname);
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

      for (const a of visibleAssigns) {
        const uid = a.uid || getActivityUid(a);
        if (!seenAssignUids.has(uid)) {
          seenAssignUids.add(uid);
          allVisibleAssignments.push(a);
        }
      }

      const staffMap = coursesPanoptoStaff as Record<
        string | number,
        CoursePanoptoStaffEntry[] | undefined
      >;
      let courseStaffEntries: CoursePanoptoStaffEntry[] = staffMap[uc.id] || staffMap[String(uc.id)] || [];
      if (courseStaffEntries.length === 0) {
        for (const sub of uc.subCourses) {
          const subStaff = staffMap[sub.courseId] || staffMap[String(sub.courseId)];
          if (subStaff && subStaff.length > 0) {
            courseStaffEntries = subStaff;
            break;
          }
        }
      }

      const visibleRecs = panoptoEnabled
        ? partitionPanoptoRecordingsByTrackedHosts(
            aggregated.recordings,
            courseStaffEntries,
            hiddenRecordings
          ).visible
        : [];

      for (const r of visibleRecs) {
        if (!seenRecIds.has(r.id)) {
          seenRecIds.add(r.id);
          allVisibleRecordings.push(r);
        }
      }

      const courseLectures = visibleRecs.filter((r) => r.type === 'Lecture');
      const doneLectures = courseLectures.filter((r) => watchedSet.has(r.id));
      const courseRecitations = visibleRecs.filter((r) => r.type === 'Recitation');
      const doneRecitations = courseRecitations.filter((r) => watchedSet.has(r.id));

      totalAssignsAll += visibleAssigns.length;
      doneAssignsAll += doneAssigns.length;
      totalLecturesAll += courseLectures.length;
      doneLecturesAll += doneLectures.length;
      totalRecitationsAll += courseRecitations.length;
      doneRecitationsAll += doneRecitations.length;

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

      courseSummaries.push({
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

    const pendingQueue = sortUpcomingTodoQueue(
      allVisibleAssignments.filter(
        (a) =>
          !isActivityCompleted(a, completedAssignments, uncompletedAssignments)
      ),
      nowMs
    );

    const catchUpQueue = panoptoEnabled
      ? allVisibleRecordings
          .filter((r) => !watchedSet.has(r.id))
          .sort((a, b) => {
            if (!a.publishedDate && !b.publishedDate) {
              return a.title.localeCompare(b.title);
            }
            if (!a.publishedDate) return 1;
            if (!b.publishedDate) return -1;
            const dateCmp = a.publishedDate.localeCompare(b.publishedDate);
            return dateCmp !== 0 ? dateCmp : a.title.localeCompare(b.title);
          })
      : [];

    const trackedMeetings = (syncResult.meetings || []).filter(
      (m) => trackedMemberSet.size === 0 || trackedMemberSet.has(m.courseId)
    );
    const activeZoomMeetings: ZoomMeeting[] = collapseRecurringMeetings(
      trackedMeetings,
      new Date(nowMs)
    ).filter(
      (m) =>
        Boolean(m.meetingUrl) &&
        !isZoomMeetingHidden(m, hiddenZoomMeetings) &&
        getZoomLiveStatus(m.startTime) === 'active'
    );

    const totalAll = totalLecturesAll + totalRecitationsAll + totalAssignsAll;
    const doneAll = doneLecturesAll + doneRecitationsAll + doneAssignsAll;

    return {
      courseSummaries,
      pendingQueue,
      catchUpQueue,
      activeZoomMeetings,
      progressStats: {
        lectures: {
          done: doneLecturesAll,
          total: totalLecturesAll,
          percent:
            totalLecturesAll > 0
              ? Math.round((doneLecturesAll / totalLecturesAll) * 100)
              : 0,
        },
        recitations: {
          done: doneRecitationsAll,
          total: totalRecitationsAll,
          percent:
            totalRecitationsAll > 0
              ? Math.round((doneRecitationsAll / totalRecitationsAll) * 100)
              : 0,
        },
        assignments: {
          done: doneAssignsAll,
          total: totalAssignsAll,
          percent:
            totalAssignsAll > 0
              ? Math.round((doneAssignsAll / totalAssignsAll) * 100)
              : 0,
        },
        total: {
          done: doneAll,
          total: totalAll,
          percent: totalAll > 0 ? Math.round((doneAll / totalAll) * 100) : 0,
        },
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    nowMs,
    trackedUnifiedCourses,
    trackedCourseIds,
    syncResult,
    completedAssignments,
    uncompletedAssignments,
    hiddenAssignments,
    hiddenZoomMeetings,
    watchedRecordings,
    hiddenRecordings,
    coursesPanoptoStaff,
    coursesColorMap,
    coursesCustomNames,
    panoptoEnabled,
  ]);

  const { courseSummaries, pendingQueue, catchUpQueue, activeZoomMeetings, progressStats } =
    dashboardData;

  const badgePalette = {
    'badge-success': { bg: `${theme.secondary}20`, fg: theme.secondary },
    'badge-warning': { bg: `${theme.warning}20`, fg: theme.warning },
    'badge-danger': { bg: `${theme.danger}20`, fg: theme.danger },
    'badge-muted': { bg: theme.backgroundSelected, fg: theme.textSecondary },
  };

  const progressModes: {
    key: SemesterProgressMode;
    label: string;
    statKey: 'lectures' | 'recitations' | 'assignments' | 'total' | 'all';
    accent: string;
  }[] = [
    {
      key: 'lectures',
      label: t('mode_lectures'),
      statKey: 'lectures',
      accent: '#3b82f6',
    },
    {
      key: 'recitations',
      label: t('mode_recitations'),
      statKey: 'recitations',
      accent: '#8b5cf6',
    },
    {
      key: 'assignments',
      label: t('mode_assignments'),
      statKey: 'assignments',
      accent: theme.primary,
    },
    {
      key: 'total',
      label: t('mode_total'),
      statKey: 'total',
      accent: theme.secondary,
    },
    {
      key: 'all',
      label: t('mode_all'),
      statKey: 'all',
      accent: theme.primary,
    },
  ];

  const activeSingleStat =
    semesterProgressMode === 'lectures'
      ? {
          key: 'lectures' as const,
          label: t('mode_lectures'),
          ...progressStats.lectures,
          accent: '#3b82f6',
          gradientColors: ['#3b82f6', '#60a5fa'] as [string, string],
        }
      : semesterProgressMode === 'recitations'
        ? {
            key: 'recitations' as const,
            label: t('mode_recitations'),
            ...progressStats.recitations,
            accent: '#8b5cf6',
            gradientColors: ['#8b5cf6', '#a78bfa'] as [string, string],
          }
        : semesterProgressMode === 'assignments'
          ? {
              key: 'assignments' as const,
              label: t('mode_assignments'),
              ...progressStats.assignments,
              accent: theme.primary,
              gradientColors: [theme.primary, '#d46337'] as [string, string],
            }
          : {
              key: 'total' as const,
              label: t('mode_total'),
              ...progressStats.total,
              accent: theme.secondary,
              gradientColors: [theme.secondary, '#34d399'] as [string, string],
            };

  const renderProgressCategoryIcon = (
    key: 'lectures' | 'recitations' | 'assignments' | 'total' | 'all',
    color: string
  ) => {
    switch (key) {
      case 'lectures':
        return <VideoIcon size={14} color={color} />;
      case 'recitations':
        return <CourseIcon size={14} color={color} />;
      case 'assignments':
        return <AssignmentsIcon size={14} color={color} />;
      case 'total':
        return <CheckIcon size={14} color={color} />;
      case 'all':
        return <DashboardIcon size={14} color={color} />;
    }
  };

  const activeProgressMode =
    progressModes.find((m) => m.key === semesterProgressMode) ?? progressModes[3];

  const greetingText = userFullname
    ? language === 'he'
      ? `שלום, ${userFullname}`
      : `Hello, ${userFullname}`
    : t('dashboard');

  const lastSyncedLabel = lastSyncedAt
    ? `${t('last_synced')}: ${formatShortDate(lastSyncedAt, language)} ${formatTimeHM(
        lastSyncedAt,
        language
      )}`
    : language === 'he'
      ? 'ממתין לסנכרון'
      : 'Not synced yet';

  const selectedCourseColor = selectedAssignment
    ? getCourseColor(selectedAssignment.courseId)
    : undefined;
  const selectedCourseName = selectedAssignment
    ? getCourseDisplayName(selectedAssignment.courseId, selectedAssignment.courseName)
    : undefined;

  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={[styles.safeArea, { backgroundColor: theme.background }]}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={isSyncing}
            onRefresh={() => {
              void triggerSync({ manual: true }).catch(() => {});
            }}
            tintColor={theme.primary}
            colors={[theme.primary]}
          />
        }
      >
        <View
          style={[
            styles.pageContainer,
            { maxWidth: containerMaxWidth, alignSelf: 'center' },
          ]}
        >
          {/* Top Header */}
          <View style={[styles.headerRow, { flexDirection: rowDir }]}>
            <View style={[styles.greetingRow, { flexDirection: rowDir }]}>
              <Image
                testID="dashboard-header-logo"
                source={require('@/assets/logo.png')}
                style={styles.greetingLogo}
                resizeMode="contain"
              />
              <View style={styles.greetingBlock}>
                <Text style={[styles.greetingTitle, { color: theme.text, textAlign }]}>
                  {greetingText}
                </Text>
                <Text style={[styles.lastSyncedText, { color: theme.textSecondary, textAlign }]}>
                  {lastSyncedLabel}
                </Text>
              </View>
            </View>

            <View style={[styles.headerActions, { flexDirection: rowDir }]}>
              <TouchableOpacity
                onPress={() => {
                  if (isSyncing) {
                    openSyncWindow?.();
                  } else {
                    void triggerSync({ manual: true }).catch(() => {});
                  }
                }}
                style={[
                  styles.actionBtn,
                  {
                    backgroundColor: theme.primary,
                    opacity: isSyncing ? 0.85 : 1,
                    flexDirection: rowDir,
                  },
                ]}
              >
                <SpinningIcon spinning={isSyncing}>
                  <RefreshIcon size={15} color={theme.onPrimary} />
                </SpinningIcon>
                <Text style={[styles.primaryActionText, { color: theme.onPrimary }]}>
                  {isSyncing ? t('syncing') : t('sync_now')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Live Zoom Strip */}
          {activeZoomMeetings.length > 0 && (
            <View style={styles.liveZoomStrip}>
              <View style={[styles.sectionHeaderMini, { flexDirection: rowDir }]}>
                <VideoIcon size={15} color={theme.secondary} />
                <Text style={[styles.sectionTitleMini, { color: theme.text }]}>
                  {t('live_zoom_title')}
                </Text>
              </View>

              {activeZoomMeetings.map((m) => {
                const mKey = getZoomMeetingKey(m);
                const mColor = getCourseColor(m.courseId);
                const mCourseName = getCourseDisplayName(m.courseId, m.courseName);
                const startHM = formatTimeHM(m.startTime, language);

                return (
                  <View
                    key={mKey}
                    style={[
                      styles.liveZoomBanner,
                      {
                        backgroundColor: `${theme.secondary}14`,
                        borderColor: `${theme.secondary}66`,
                        flexDirection: rowDir,
                      },
                    ]}
                  >
                    <View style={[styles.liveZoomLeft, { flexDirection: rowDir }]}>
                      <LivePulseDot color={theme.secondary} />
                      <View style={styles.liveZoomTexts}>
                        <View style={[styles.liveMetaRow, { flexDirection: rowDir }]}>
                          <View
                            style={[
                              styles.liveCourseBadge,
                              { backgroundColor: `${mColor}22` },
                            ]}
                          >
                            <Text
                              style={[styles.liveCourseBadgeText, { color: mColor }]}
                              numberOfLines={1}
                            >
                              {mCourseName}
                            </Text>
                          </View>
                          <Text style={[styles.liveStatusTag, { color: theme.secondary }]}>
                            {startHM ? `${startHM} | ${t('live_now')}` : t('live_now')}
                          </Text>
                        </View>
                        <Text
                          style={[styles.liveTitle, { color: theme.text, textAlign }]}
                          numberOfLines={1}
                        >
                          {m.title}
                        </Text>
                      </View>
                    </View>

                    <TouchableOpacity
                      onPress={() => openMoodleUrl(m.meetingUrl)}
                      style={[
                        styles.joinZoomBtn,
                        { backgroundColor: theme.secondary, flexDirection: rowDir },
                      ]}
                    >
                      <ExternalLinkIcon size={13} color="#ffffff" />
                      <Text style={styles.joinZoomText}>{t('join_zoom')}</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          )}

          {/* Hero Action Section: Upcoming To-Do Queue + Panopto Catch-Up Queue / Inline Master-Detail */}
          <View
            style={[
              styles.heroGrid,
              isWideHero && panoptoEnabled && !selectedAssignment && { flexDirection: rowDir },
            ]}
          >
            <View
              testID={
                isLandscapeTablet && selectedAssignment
                  ? 'dashboard-master-detail'
                  : undefined
              }
              style={
                isLandscapeTablet && selectedAssignment
                  ? [styles.masterDetailRow, { flexDirection: rowDir }]
                  : isWideHero && panoptoEnabled
                    ? styles.heroColumnHalf
                    : styles.fullWidthBlock
              }
            >
              {/* Upcoming To-Do Queue */}
              <View
                style={[
                  styles.queueCard,
                  {
                    backgroundColor: theme.backgroundElement,
                    borderColor: theme.border,
                  },
                  isLandscapeTablet && selectedAssignment && styles.heroColumnHalf,
                ]}
              >
              <View
                style={[
                  styles.queueHeader,
                  { borderBottomColor: theme.border, flexDirection: rowDir },
                ]}
              >
                <View style={[styles.queueTitleRow, { flexDirection: rowDir }]}>
                  <AssignmentsIcon size={16} color={theme.primary} />
                  <Text style={[styles.queueTitle, { color: theme.text }]}>
                    {t('upcoming_queue_title')}
                  </Text>
                </View>
                <View
                  style={[
                    styles.countPill,
                    { backgroundColor: theme.backgroundSelected },
                  ]}
                >
                  <Text style={[styles.countPillText, { color: theme.textSecondary }]}>
                    {pendingQueue.length}
                  </Text>
                </View>
              </View>

              {pendingQueue.length === 0 ? (
                <View style={styles.emptyQueueBox}>
                  <CheckIcon size={20} color={theme.secondary} />
                  <Text style={[styles.emptyQueueText, { color: theme.textSecondary }]}>
                    {t('no_pending_tasks')}
                  </Text>
                </View>
              ) : (
                <View style={styles.queueList}>
                  {pendingQueue.map((task, idx) => {
                    const taskColor = getCourseColor(task.courseId);
                    const taskCourse = getCourseDisplayName(
                      task.courseId,
                      task.courseName
                    );
                    const dueInfo = getDueTextAndClass(
                      task.deadline,
                      language,
                      settings.dueDateGreenDays,
                      settings.dueDateYellowDays,
                      false,
                      task.status
                    );
                    const dueStyle = badgePalette[dueInfo.badgeClass];
                    const isNearestFuture =
                      idx === 0 &&
                      Boolean(task.deadline) &&
                      new Date(task.deadline as string).getTime() > nowMs;
                    const uid = task.uid || getActivityUid(task);
                    const isSelected = Boolean(
                      selectedAssignment &&
                        (selectedAssignment.uid ||
                          getActivityUid(selectedAssignment)) === uid
                    );

                    return (
                      <ClosestTaskGlowWrap
                        key={uid}
                        active={idx === 0}
                        borderRadius={12}
                      >
                        <TouchableOpacity
                          onPress={() => {
                            animateLayout();
                            setSelectedAssignment(
                              isSelected && isLandscapeTablet ? null : task
                            );
                          }}
                          activeOpacity={0.75}
                          style={[
                            styles.queueRow,
                            {
                              backgroundColor: isSelected
                                ? `${taskColor}18`
                                : isNearestFuture
                                  ? `${theme.primary}12`
                                  : theme.background,
                              borderColor: isSelected
                                ? taskColor
                                : idx === 0
                                  ? 'transparent'
                                  : theme.border,
                              borderWidth: isSelected ? 1.5 : 1,
                              flexDirection: rowDir,
                            },
                          ]}
                        >
                        <View style={[styles.queueRowLeft, { flexDirection: rowDir }]}>
                          <View
                            style={[styles.courseDot, { backgroundColor: taskColor }]}
                          />
                          <View style={styles.queueTextCol}>
                            <View style={[styles.queueCourseRow, { flexDirection: rowDir }]}>
                              <Text
                                style={[
                                  styles.queueCourseLabel,
                                  { color: taskColor, textAlign },
                                ]}
                                numberOfLines={1}
                              >
                                {taskCourse}
                              </Text>
                              {task.activityType === 'quiz' && (
                                <View
                                  style={[
                                    styles.miniBadge,
                                    { backgroundColor: '#8b5cf620', flexDirection: rowDir },
                                  ]}
                                >
                                  <QuizIcon size={10} color="#8b5cf6" />
                                  <Text
                                    style={[
                                      styles.miniBadgeText,
                                      { color: '#8b5cf6' },
                                    ]}
                                  >
                                    {t('quiz_label')}
                                  </Text>
                                </View>
                              )}
                              {task.isBonus && (
                                <View
                                  style={[
                                    styles.miniBadge,
                                    { backgroundColor: `${theme.warning}20`, flexDirection: rowDir },
                                  ]}
                                >
                                  <StarIcon size={10} color={theme.warning} />
                                  <Text
                                    style={[
                                      styles.miniBadgeText,
                                      { color: theme.warning },
                                    ]}
                                  >
                                    {t('grades_bonus_label')}
                                  </Text>
                                </View>
                              )}
                            </View>
                            <Text
                              style={[styles.queueItemTitle, { color: theme.text, textAlign }]}
                              numberOfLines={2}
                            >
                              {task.name}
                            </Text>
                          </View>
                        </View>

                        <View style={[styles.queueRowRight, { flexDirection: rowDir }]}>
                          <View
                            style={[styles.dueBadge, { backgroundColor: dueStyle.bg }]}
                          >
                            <Text style={[styles.dueBadgeText, { color: dueStyle.fg }]}>
                              {dueInfo.deadlineText}
                            </Text>
                          </View>
                          {hasGracePeriod(task) && (
                            <View
                              style={[
                                styles.graceIconBadge,
                                { backgroundColor: `${theme.warning}20` },
                              ]}
                            >
                              <ClockIcon size={12} color={theme.warning} />
                            </View>
                          )}
                          <TouchableOpacity
                            onPress={(e) => {
                              e.stopPropagation();
                              toggleAssignmentHidden(uid);
                            }}
                            style={styles.quickHideBtn}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            accessibilityLabel={t('hide_assignment')}
                          >
                            <TrashIcon size={14} color={theme.textSecondary} />
                          </TouchableOpacity>
                          {isRtl ? (
                            <ChevronLeftIcon
                              size={14}
                              color={isSelected ? taskColor : theme.textSecondary}
                            />
                          ) : (
                            <ChevronRightIcon
                              size={14}
                              color={isSelected ? taskColor : theme.textSecondary}
                            />
                          )}
                        </View>
                        </TouchableOpacity>
                      </ClosestTaskGlowWrap>
                    );
                  })}
                </View>
              )}
              </View>

              {isLandscapeTablet && selectedAssignment && (
                <View style={styles.heroDetailPane}>
                  <AssignmentDetailSheet
                    inline
                    visible={true}
                    assignment={selectedAssignment}
                    courseColor={selectedCourseColor}
                    courseDisplayName={selectedCourseName}
                    onClose={() => {
                      animateLayout();
                      setSelectedAssignment(null);
                    }}
                    onNavigateToCourse={(courseId) =>
                      router.push(`/course/${courseId}` as Href)
                    }
                  />
                </View>
              )}
            </View>

            {/* Panopto Catch-Up Queue (shown when panoptoEnabled) */}
            {panoptoEnabled && (
              <View
                style={[
                  styles.queueCard,
                  {
                    backgroundColor: theme.backgroundElement,
                    borderColor: theme.border,
                  },
                  isWideHero && !selectedAssignment && styles.heroColumnHalf,
                ]}
              >
                <View
                  style={[
                    styles.queueHeader,
                    { borderBottomColor: theme.border, flexDirection: rowDir },
                  ]}
                >
                  <View style={[styles.queueTitleRow, { flexDirection: rowDir }]}>
                    <RecordingsIcon size={16} color={theme.primary} />
                    <Text style={[styles.queueTitle, { color: theme.primary }]}>
                      {t('catch_up_queue_title')}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.countPill,
                      { backgroundColor: theme.backgroundSelected },
                    ]}
                  >
                    <Text style={[styles.countPillText, { color: theme.textSecondary }]}>
                      {catchUpQueue.length}
                    </Text>
                  </View>
                </View>

                {catchUpQueue.length === 0 ? (
                  <View style={styles.emptyQueueBox}>
                    <CheckIcon size={20} color={theme.secondary} />
                    <Text style={[styles.emptyQueueText, { color: theme.textSecondary }]}>
                      {t('no_catchup_recordings')}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.queueList}>
                    {catchUpQueue.map((rec) => {
                      const recColor = getCourseColor(rec.courseId);
                      const recCourse = getCourseDisplayName(
                        rec.courseId,
                        rec.courseName
                      );
                      const isRecitation = rec.type === 'Recitation';

                      return (
                        <View
                          key={rec.id}
                          style={[
                            styles.queueRow,
                            {
                              backgroundColor: theme.background,
                              borderColor: theme.border,
                              flexDirection: rowDir,
                            },
                          ]}
                        >
                          <View style={[styles.queueRowLeft, { flexDirection: rowDir }]}>
                            <TouchableOpacity
                              onPress={() => toggleRecordingWatched(rec.id)}
                              style={[
                                styles.quickWatchBtn,
                                {
                                  borderColor: theme.secondary,
                                  backgroundColor: `${theme.secondary}15`,
                                },
                              ]}
                              accessibilityLabel={t('mark_watched')}
                            >
                              <CheckIcon size={12} color={theme.secondary} />
                            </TouchableOpacity>

                            <View style={styles.queueTextCol}>
                              <View
                                style={[styles.queueCourseRow, { flexDirection: rowDir }]}
                              >
                                <View
                                  style={[
                                    styles.courseDot,
                                    { backgroundColor: recColor },
                                  ]}
                                />
                                <Text
                                  style={[
                                    styles.queueCourseLabel,
                                    { color: recColor, textAlign },
                                  ]}
                                  numberOfLines={1}
                                >
                                  {recCourse}
                                </Text>
                                <View
                                  style={[
                                    styles.miniBadge,
                                    {
                                      backgroundColor: isRecitation
                                        ? '#8b5cf622'
                                        : '#3b82f622',
                                    },
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.miniBadgeText,
                                      {
                                        color: isRecitation ? '#8b5cf6' : '#3b82f6',
                                      },
                                    ]}
                                  >
                                    {isRecitation
                                      ? t('recitations_label')
                                      : t('lectures_label')}
                                  </Text>
                                </View>
                              </View>
                              <Text
                                style={[
                                  styles.queueItemTitle,
                                  { color: theme.text, textAlign },
                                ]}
                                numberOfLines={2}
                              >
                                {rec.title}
                              </Text>
                              {(rec.host || rec.publishedDate) && (
                                <Text
                                  style={[
                                    styles.recSubMeta,
                                    { color: theme.textSecondary, textAlign },
                                  ]}
                                  numberOfLines={1}
                                >
                                  {[
                                    rec.host ? `${t('host_label')}: ${rec.host}` : '',
                                    rec.publishedDate || '',
                                  ]
                                    .filter(Boolean)
                                    .join(' | ')}
                                </Text>
                              )}
                            </View>
                          </View>

                          <View style={[styles.queueRowRight, { flexDirection: rowDir }]}>
                            {Boolean(rec.recordingUrl) && (
                              <TouchableOpacity
                                onPress={() => openMoodleUrl(rec.recordingUrl)}
                                style={[
                                  styles.watchLinkBtn,
                                  {
                                    backgroundColor: `${theme.secondary}18`,
                                    borderColor: `${theme.secondary}50`,
                                    flexDirection: rowDir,
                                  },
                                ]}
                                accessibilityLabel={t('watch_recording')}
                              >
                                <ExternalLinkIcon size={12} color={theme.secondary} />
                                <Text
                                  style={[
                                    styles.watchLinkText,
                                    { color: theme.secondary },
                                  ]}
                                >
                                  {language === 'he' ? 'צפייה' : 'Watch'}
                                </Text>
                              </TouchableOpacity>
                            )}
                            <TouchableOpacity
                              onPress={() => toggleRecordingHidden(rec.id)}
                              style={styles.quickHideBtn}
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                              accessibilityLabel={t('hide_assignment')}
                            >
                              <TrashIcon size={14} color={theme.textSecondary} />
                            </TouchableOpacity>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            )}
          </View>

          {/* Semester Cumulative Progress Card */}
          <View
            style={[
              styles.sectionCard,
              {
                backgroundColor: theme.backgroundElement,
                borderColor: theme.border,
              },
            ]}
          >
            <View style={[styles.semesterCardHeader, { flexDirection: rowDir }]}>
              <Text style={[styles.sectionTitle, { color: theme.text, textAlign }]}>
                {t('semester_progress_title')}
              </Text>

              <TouchableOpacity
                testID="semester-progress-mode-btn"
                onPress={() => {
                  animateLayout();
                  setProgressMenuOpen((prev) => !prev);
                }}
                accessibilityRole="button"
                accessibilityLabel={activeProgressMode.label}
                style={[
                  styles.progressModeTrigger,
                  {
                    backgroundColor: theme.background,
                    borderColor: progressMenuOpen ? theme.primary : theme.border,
                    flexDirection: rowDir,
                  },
                ]}
              >
                {renderProgressCategoryIcon(
                  activeProgressMode.statKey,
                  activeProgressMode.accent
                )}
                <Text style={[styles.progressModeTriggerText, { color: theme.text }]}>
                  {activeProgressMode.label}
                </Text>
                {progressMenuOpen ? (
                  <ChevronUpIcon size={14} color={theme.textSecondary} />
                ) : (
                  <ChevronDownIcon size={14} color={theme.textSecondary} />
                )}
              </TouchableOpacity>
            </View>

            {progressMenuOpen && (
              <View
                testID="semester-progress-mode-menu"
                style={[
                  styles.progressModeMenu,
                  {
                    backgroundColor: theme.background,
                    borderColor: theme.border,
                  },
                ]}
              >
                {progressModes.map((m) => {
                  const active = semesterProgressMode === m.key;
                  return (
                    <TouchableOpacity
                      key={m.key}
                      testID={`semester-progress-option-${m.key}`}
                      onPress={() => {
                        animateLayout();
                        updateSetting('semesterProgressMode', m.key);
                        setProgressMenuOpen(false);
                      }}
                      style={[
                        styles.progressModeOption,
                        {
                          flexDirection: rowDir,
                          backgroundColor: active
                            ? `${theme.primary}18`
                            : 'transparent',
                        },
                      ]}
                    >
                      <View
                        style={{
                          flexDirection: rowDir,
                          alignItems: 'center',
                          gap: 8,
                          flex: 1,
                        }}
                      >
                        {renderProgressCategoryIcon(
                          m.statKey,
                          active ? theme.primary : m.accent
                        )}
                        <Text
                          style={[
                            styles.progressModeOptionText,
                            {
                              color: active ? theme.primary : theme.text,
                              fontWeight: active ? '800' : '600',
                              textAlign,
                            },
                          ]}
                        >
                          {m.label}
                        </Text>
                      </View>
                      {active && (
                        <CheckIcon size={14} color={theme.primary} strokeWidth={2.5} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {semesterProgressMode === 'all' ? (
              <View style={[styles.allProgressGrid, { flexDirection: rowDir }]}>
                {(
                  [
                    {
                      key: 'lectures' as const,
                      label: t('mode_lectures'),
                      ...progressStats.lectures,
                      accent: '#3b82f6',
                      gradientColors: ['#3b82f6', '#60a5fa'] as [string, string],
                    },
                    {
                      key: 'recitations' as const,
                      label: t('mode_recitations'),
                      ...progressStats.recitations,
                      accent: '#8b5cf6',
                      gradientColors: ['#8b5cf6', '#a78bfa'] as [string, string],
                    },
                    {
                      key: 'assignments' as const,
                      label: t('mode_assignments'),
                      ...progressStats.assignments,
                      accent: theme.primary,
                      gradientColors: [theme.primary, theme.warning] as [string, string],
                    },
                    {
                      key: 'total' as const,
                      label: t('mode_total'),
                      ...progressStats.total,
                      accent: theme.secondary,
                      gradientColors: [theme.secondary, '#34d399'] as [string, string],
                    },
                  ]
                ).map((cat) => (
                  <View
                    key={cat.key}
                    style={[
                      styles.progressItemBox,
                      {
                        backgroundColor:
                          cat.key === 'total' ? `${theme.secondary}12` : theme.background,
                        borderColor:
                          cat.key === 'total' ? `${theme.secondary}55` : theme.border,
                      },
                      isLandscapeTablet && styles.progressItemHalf,
                    ]}
                  >
                    <View style={[styles.progressMetaRow, { flexDirection: rowDir }]}>
                      <View style={{ flexDirection: rowDir, alignItems: 'center', gap: 6 }}>
                        {renderProgressCategoryIcon(cat.key, cat.accent)}
                        <Text style={[styles.progressLabel, { color: theme.text }]}>
                          {cat.label}
                        </Text>
                      </View>
                      <Text style={[styles.progressNumbers, { color: theme.textSecondary }]}>
                        {`${cat.done}/${cat.total} (${cat.percent}%)`}
                      </Text>
                    </View>
                    <AnimatedProgressBar
                      percent={cat.percent}
                      color={cat.accent}
                      gradientColors={cat.gradientColors}
                      trackColor={theme.backgroundSelected}
                      height={7}
                      isRtl={isRtl}
                    />
                  </View>
                ))}
              </View>
            ) : (
              <View style={styles.singleProgressBox}>
                <View style={[styles.progressMetaRow, { flexDirection: rowDir }]}>
                  <View style={{ flexDirection: rowDir, alignItems: 'center', gap: 6 }}>
                    {renderProgressCategoryIcon(activeSingleStat.key, activeSingleStat.accent)}
                    <Text style={[styles.progressLabel, { color: theme.text }]}>
                      {activeSingleStat.label}
                    </Text>
                  </View>
                  <Text style={[styles.progressNumbers, { color: theme.textSecondary }]}>
                    {`${activeSingleStat.done}/${activeSingleStat.total} (${activeSingleStat.percent}%)`}
                  </Text>
                </View>
                <AnimatedProgressBar
                  percent={activeSingleStat.percent}
                  color={activeSingleStat.accent}
                  trackColor={theme.backgroundSelected}
                  height={9}
                  isRtl={isRtl}
                />
              </View>
            )}
          </View>

          {/* My Tracked Courses Section (Landscape Tablet only; phone/portrait uses dedicated Courses tab) */}
          {isLandscapeTablet && (
            <TrackedCoursesSection courseSummaries={courseSummaries} />
          )}
        </View>
      </ScrollView>

      <AssignmentDetailSheet
        visible={!isLandscapeTablet && Boolean(selectedAssignment)}
        assignment={selectedAssignment}
        courseColor={selectedCourseColor}
        courseDisplayName={selectedCourseName}
        onClose={() => setSelectedAssignment(null)}
        onNavigateToCourse={(courseId) =>
          router.push(`/course/${courseId}` as Href)
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    paddingBottom: 32,
  },
  pageContainer: {
    width: '100%',
    gap: 14,
  },
  headerRow: {
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 12,
  },
  greetingRow: {
    alignItems: 'center',
    gap: 10,
    flexShrink: 1,
    minWidth: 0,
  },
  greetingLogo: {
    width: 36,
    height: 36,
    borderRadius: 8,
  },
  greetingBlock: {
    flexShrink: 1,
    gap: 2,
  },
  greetingTitle: {
    fontSize: 22,
    fontWeight: '800',
  },
  lastSyncedText: {
    fontSize: 12,
    fontWeight: '500',
  },
  headerActions: {
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  actionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    alignItems: 'center',
    gap: 6,
  },
  primaryActionText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  liveZoomStrip: {
    gap: 8,
  },
  sectionHeaderMini: {
    alignItems: 'center',
    gap: 6,
  },
  sectionTitleMini: {
    fontSize: 13,
    fontWeight: '800',
  },
  liveZoomBanner: {
    borderRadius: 14,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  liveZoomLeft: {
    flex: 1,
    alignItems: 'center',
    gap: 10,
  },
  liveDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  liveZoomTexts: {
    flex: 1,
    gap: 3,
  },
  liveMetaRow: {
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  liveCourseBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    maxWidth: 180,
  },
  liveCourseBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  liveStatusTag: {
    fontSize: 11,
    fontWeight: '800',
  },
  liveTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  joinZoomBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 9,
    alignItems: 'center',
    gap: 5,
  },
  joinZoomText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  heroGrid: {
    gap: 14,
  },
  fullWidthBlock: {
    width: '100%',
  },
  masterDetailRow: {
    gap: 14,
    alignItems: 'stretch',
  },
  heroColumnHalf: {
    flex: 1,
  },
  heroDetailPane: {
    flex: 1.15,
    minWidth: 300,
  },
  queueCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  queueHeader: {
    paddingBottom: 10,
    borderBottomWidth: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  queueTitleRow: {
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  queueTitle: {
    fontSize: 15,
    fontWeight: '800',
  },
  countPill: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
  },
  countPillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  emptyQueueBox: {
    paddingVertical: 20,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  emptyQueueText: {
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
  },
  queueList: {
    gap: 8,
  },
  queueRow: {
    borderRadius: 12,
    paddingHorizontal: 11,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  queueRowLeft: {
    flex: 1,
    alignItems: 'center',
    gap: 9,
  },
  courseDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
  },
  queueTextCol: {
    flex: 1,
    gap: 3,
  },
  queueCourseRow: {
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  queueCourseLabel: {
    fontSize: 11,
    fontWeight: '700',
    flexShrink: 1,
  },
  miniBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 5,
    alignItems: 'center',
    gap: 3,
  },
  miniBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  queueItemTitle: {
    fontSize: 13.5,
    fontWeight: '700',
  },
  recSubMeta: {
    fontSize: 11,
    fontWeight: '500',
  },
  queueRowRight: {
    alignItems: 'center',
    gap: 6,
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
  graceIconBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickHideBtn: {
    padding: 5,
    borderRadius: 6,
  },
  quickWatchBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  watchLinkBtn: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 7,
    borderWidth: 1,
    alignItems: 'center',
    gap: 4,
  },
  watchLinkText: {
    fontSize: 11,
    fontWeight: '700',
  },
  sectionCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    gap: 12,
  },
  semesterCardHeader: {
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  progressModeTrigger: {
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
  },
  progressModeTriggerText: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  progressModeMenu: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 4,
    gap: 2,
  },
  progressModeOption: {
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 8,
  },
  progressModeOptionText: {
    fontSize: 13,
    flex: 1,
  },
  allProgressGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  progressItemBox: {
    width: '100%',
    borderRadius: 11,
    borderWidth: 1,
    padding: 10,
    gap: 7,
  },
  progressItemHalf: {
    width: '48.8%',
  },
  singleProgressBox: {
    gap: 8,
  },
  progressMetaRow: {
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  progressLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  progressNumbers: {
    fontSize: 12,
    fontWeight: '600',
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    width: '100%',
  },
  progressTrackLarge: {
    height: 9,
    borderRadius: 4.5,
    overflow: 'hidden',
    width: '100%',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4.5,
  },
});
