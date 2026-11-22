import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Assignment,
  CourseFile,
  aggregateUnifiedCourseItems,
  cleanCourseDisplayName,
  expandTrackedCourseIds,
  getActivityUid,
  hasGracePeriod,
  isActivityCompleted,
  isActivityHidden,
  isMoodleActivitySubmitted,
  partitionPanoptoRecordingsByTrackedHosts,
} from '@tautracker/moodle-client';
import { AssignmentDetailSheet } from '@/components/AssignmentDetailSheet';
import {
  MoodleFileRow,
  getSubjectFilesForAssignment,
} from '@/components/MoodleFileRow';
import { RtlHorizontalScrollView } from '@/components/RtlHorizontalScrollView';
import { ScheduleCalendarView } from '@/components/ScheduleCalendarView';
import {
  CalendarIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ClockIcon,
  CloseIcon,
  CourseIcon,
  ExternalLinkIcon,
  EyeIcon,
  EyeOffIcon,
  FileIcon,
  FilterIcon,
  FolderIcon,
  QuizIcon,
  RefreshIcon,
  SearchIcon,
  TrashIcon,
} from '@/components/icons/NoodleIcons';
import {
  ClosestTaskGlowWrap,
  NoodleGradientButton,
  SpinningIcon,
  animateLayout,
} from '@/components/ui/NoodleAnimations';
import { useAppState, useSyncProgress } from '@/hooks/use-app-state';
import { usePreferences } from '@/hooks/use-preferences';
import { useResponsiveLayout } from '@/hooks/use-responsive-layout';
import {
  formatGracePeriodText,
  formatShortDate,
  formatTimeHM,
  getDueTextAndClass,
} from '@/services/dateUtils';
import {
  FileDownloadAction,
  downloadMoodleFile,
  isFileCachedLocally,
  openMoodleFile,
  shareMoodleFile,
} from '@/services/fileDownloadService';
import { openMoodleUrl } from '@/services/moodleLink';

interface EnrichedAssignment extends Assignment {
  uidKey: string;
  isMoodleSubmitted: boolean;
  isCompletedEffective: boolean;
  isHiddenEffective: boolean;
  hasDeadlinePassed: boolean;
}

function withHexAlpha(color: string, alphaHex: string, fallback: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(color)) {
    return `${color}${alphaHex}`;
  }
  return fallback;
}

export default function AssignmentsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ courseId?: string }>();
  const { isLandscapeTablet } = useResponsiveLayout();

  const { theme, language, isRtl, t } = usePreferences();
  const { openSyncWindow } = useSyncProgress();
  const {
    syncResult,
    groupedCourses,
    enrolledCourses,
    isSyncing,
    triggerSync,
    settings,
    trackedCourseIds,
    coursesColorMap,
    coursesCustomNames,
    hiddenAssignments,
    completedAssignments,
    uncompletedAssignments,
    hiddenRecordings,
    coursesPanoptoStaff,
    toggleAssignmentDone,
    toggleAssignmentHidden,
  } = useAppState();

  const rawCourseParam =
    typeof params.courseId === 'string' ? params.courseId.trim() : '';
  const parsedCourseParam = rawCourseParam ? Number(rawCourseParam) : NaN;
  const [clearedCourseParam, setClearedCourseParam] = useState<string | null>(
    null
  );
  const effectiveClearedParam = rawCourseParam ? clearedCourseParam : null;

  const courseFilterId =
    rawCourseParam &&
    rawCourseParam !== effectiveClearedParam &&
    Number.isFinite(parsedCourseParam) &&
    parsedCourseParam !== 0
      ? parsedCourseParam
      : null;

  const courseFilterMemberIds = useMemo<Set<number> | null>(() => {
    if (courseFilterId === null) return null;
    const set = new Set<number>([courseFilterId]);
    const unified =
      groupedCourses.academicCourses.find(
        (u) => u.id === courseFilterId || u.subCourses.some((s) => s.courseId === courseFilterId)
      ) ||
      (groupedCourses.administrativeUmbrella &&
      (groupedCourses.administrativeUmbrella.id === courseFilterId ||
        groupedCourses.administrativeUmbrella.subCourses.some((s) => s.courseId === courseFilterId))
        ? groupedCourses.administrativeUmbrella
        : undefined);
    if (unified) {
      set.add(unified.id);
      for (const s of unified.subCourses) {
        set.add(s.courseId);
      }
    }
    return set;
  }, [courseFilterId, groupedCourses]);

  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const intervalId = setInterval(() => {
      setNowMs(Date.now());
    }, 60_000);
    return () => clearInterval(intervalId);
  }, []);

  const [searchQuery, setSearchQuery] = useState('');
  const [filterTodo, setFilterTodo] = useState(true);
  const [filterPast, setFilterPast] = useState(false);
  const [filterCompleted, setFilterCompleted] = useState(false);
  const [filterHidden, setFilterHidden] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [alsoShowRecordings, setAlsoShowRecordings] = useState(false);
  const [expandedUid, setExpandedUid] = useState<string | null>(null);
  const [showHiddenDrawer, setShowHiddenDrawer] = useState(false);
  const [busyFiles, setBusyFiles] = useState<Record<string, FileDownloadAction>>({});
  const [fileCacheTick, setFileCacheTick] = useState<number>(0);
  const [sheetAssignment, setSheetAssignment] = useState<Assignment | null>(null);

  const rowDir = isRtl ? 'row-reverse' : 'row';
  const textAlign = isRtl ? 'right' : 'left';

  const courseNameLookup = useMemo(() => {
    const map = new Map<number, string>();
    for (const c of enrolledCourses) {
      map.set(c.id, cleanCourseDisplayName(c.fullname) || c.fullname);
    }
    for (const c of syncResult.courses || []) {
      if (!map.has(c.id)) {
        map.set(c.id, cleanCourseDisplayName(c.fullname) || c.fullname);
      }
    }
    for (const u of groupedCourses.academicCourses) {
      map.set(u.id, u.fullname);
    }
    if (groupedCourses.administrativeUmbrella) {
      map.set(
        groupedCourses.administrativeUmbrella.id,
        groupedCourses.administrativeUmbrella.fullname
      );
    }
    return map;
  }, [enrolledCourses, syncResult.courses, groupedCourses]);

  const resolveCourseName = useCallback(
    (courseId: number, fallback?: string): string => {
      const custom = coursesCustomNames[courseId];
      if (custom && custom.trim()) return custom.trim();
      const fromMap = courseNameLookup.get(courseId);
      if (fromMap) return fromMap;
      if (fallback) {
        return cleanCourseDisplayName(fallback) || fallback;
      }
      return `Course ${courseId}`;
    },
    [coursesCustomNames, courseNameLookup]
  );

  const resolveCourseColor = useCallback(
    (courseId: number): string => {
      return coursesColorMap[courseId] || theme.primary;
    },
    [coursesColorMap, theme.primary]
  );

  // Merge multi-portal unified courses & filter to tracked courses when configured
  const { mergedAssignments, mergedFiles, mergedRecordings } = useMemo(() => {
    const rawAssigns = syncResult.assignments || [];
    const rawFiles = syncResult.files || [];
    const rawRecs = syncResult.recordings || [];

    const trackedSet = new Set(trackedCourseIds);
    const expandedSet = new Set(
      expandTrackedCourseIds(trackedCourseIds, groupedCourses)
    );
    const hasTrackedFilter = trackedCourseIds.length > 0;

    const multiPortalGroups = groupedCourses.academicCourses
      .filter((u) => u.subCourses.length > 1 && (!hasTrackedFilter || trackedSet.has(u.id)))
      .map((u) => ({
        ...u,
        subCourses: hasTrackedFilter
          ? u.subCourses.filter((s) => expandedSet.has(s.courseId) || trackedSet.has(s.courseId))
          : u.subCourses,
      }))
      .filter((u) => u.subCourses.length > 1);

    const childCourseIds = new Set<number>();
    for (const u of multiPortalGroups) {
      for (const s of u.subCourses) {
        if (s.courseId !== u.id) {
          childCourseIds.add(s.courseId);
        }
      }
    }

    const isTrackedId = (cid: number) =>
      !hasTrackedFilter || expandedSet.has(cid) || trackedSet.has(cid);

    let assignments = rawAssigns.filter(
      (a) => !childCourseIds.has(a.courseId) && isTrackedId(a.courseId)
    );
    let files: CourseFile[] = rawFiles.filter(
      (f) => !childCourseIds.has(f.courseId) && isTrackedId(f.courseId)
    );
    let recordings = rawRecs.filter(
      (r) => !childCourseIds.has(r.courseId) && isTrackedId(r.courseId)
    );

    for (const u of multiPortalGroups) {
      const agg = aggregateUnifiedCourseItems(u, syncResult);
      assignments = assignments.filter((a) => a.courseId !== u.id).concat(agg.assignments);
      files = files.filter((f) => f.courseId !== u.id).concat(agg.files);
      recordings = recordings.filter((r) => r.courseId !== u.id).concat(agg.recordings);
    }

    return {
      mergedAssignments: assignments,
      mergedFiles: files,
      mergedRecordings: recordings,
    };
  }, [syncResult, groupedCourses, trackedCourseIds]);

  const enrichedAssignments = useMemo<EnrichedAssignment[]>(() => {
    const mapped = mergedAssignments.map((a) => {
      const uidKey = a.uid || getActivityUid(a);
      const isMoodleSubmitted = isMoodleActivitySubmitted(a);
      const isCompletedEffective = isActivityCompleted(
        a,
        completedAssignments,
        uncompletedAssignments
      );
      const isHiddenEffective = isActivityHidden(a, hiddenAssignments);
      const hasDeadlinePassed = a.deadline
        ? new Date(a.deadline).getTime() < nowMs
        : false;

      return {
        ...a,
        isCompleted: isCompletedEffective,
        uidKey,
        isMoodleSubmitted,
        isCompletedEffective,
        isHiddenEffective,
        hasDeadlinePassed,
      };
    });

    return mapped.sort((a, b) => {
      if (!a.deadline && !b.deadline) return a.id - b.id;
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      const diff = new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
      if (diff !== 0) return diff;
      return a.id - b.id;
    });
  }, [
    mergedAssignments,
    completedAssignments,
    uncompletedAssignments,
    hiddenAssignments,
    nowMs,
  ]);

  const courseAndSearchMatched = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return enrichedAssignments.filter((a) => {
      if (
        courseFilterMemberIds !== null &&
        !courseFilterMemberIds.has(a.courseId) &&
        (a.sourceCourseId === undefined || !courseFilterMemberIds.has(a.sourceCourseId))
      ) {
        return false;
      }
      if (!q) return true;
      const displayName = resolveCourseName(a.courseId, a.courseName).toLowerCase();
      return (
        a.name.toLowerCase().includes(q) ||
        displayName.includes(q) ||
        a.courseName.toLowerCase().includes(q)
      );
    });
  }, [enrichedAssignments, courseFilterMemberIds, searchQuery, resolveCourseName]);

  const bucketCounts = useMemo(() => {
    let todo = 0;
    let past = 0;
    let completed = 0;
    let hidden = 0;
    for (const a of courseAndSearchMatched) {
      if (a.isHiddenEffective) {
        hidden++;
      } else if (a.isCompletedEffective) {
        completed++;
      } else if (a.hasDeadlinePassed) {
        past++;
      } else {
        todo++;
      }
    }
    return { todo, past, completed, hidden };
  }, [courseAndSearchMatched]);

  const filteredAssignments = useMemo(() => {
    return courseAndSearchMatched.filter((a) => {
      if (a.isHiddenEffective) return filterHidden;
      if (a.isCompletedEffective) return filterCompleted;
      if (a.hasDeadlinePassed) return filterPast;
      return filterTodo;
    });
  }, [
    courseAndSearchMatched,
    filterHidden,
    filterCompleted,
    filterPast,
    filterTodo,
  ]);

  const drawerHiddenAssignments = useMemo(() => {
    if (filterHidden) return [];
    return courseAndSearchMatched.filter((a) => a.isHiddenEffective);
  }, [courseAndSearchMatched, filterHidden]);

  const visibleOverlayRecordings = useMemo(() => {
    if (!settings.panoptoEnabled) return [];
    const byCourse = new Map<number, typeof mergedRecordings>();
    for (const rec of mergedRecordings) {
      if (
        courseFilterMemberIds !== null &&
        !courseFilterMemberIds.has(rec.courseId) &&
        (rec.sourceCourseId === undefined || !courseFilterMemberIds.has(rec.sourceCourseId))
      ) {
        continue;
      }
      const list = byCourse.get(rec.courseId);
      if (list) list.push(rec);
      else byCourse.set(rec.courseId, [rec]);
    }
    const result: typeof mergedRecordings = [];
    for (const [cid, list] of byCourse.entries()) {
      const staff = coursesPanoptoStaff[cid];
      const partitioned = partitionPanoptoRecordingsByTrackedHosts(
        list,
        staff,
        hiddenRecordings
      );
      result.push(...partitioned.visible);
    }
    return result;
  }, [
    settings.panoptoEnabled,
    mergedRecordings,
    coursesPanoptoStaff,
    hiddenRecordings,
    courseFilterMemberIds,
  ]);

  const handleClearCourseFilter = () => {
    if (rawCourseParam) {
      setClearedCourseParam(rawCourseParam);
    }
    try {
      router.setParams({ courseId: undefined });
    } catch {
      // Ignore if router param clear is unsupported in test mock
    }
  };

  const handleResetFilters = () => {
    setSearchQuery('');
    if (courseFilterId !== null) {
      handleClearCourseFilter();
    }
    setFilterTodo(true);
    setFilterPast(true);
    setFilterCompleted(true);
    setFilterHidden(
      enrichedAssignments.length > 0 &&
        enrichedAssignments.every((a) => a.isHiddenEffective)
    );
  };

  const handleRefreshSync = () => {
    setNowMs(Date.now());
    void triggerSync({ manual: true });
  };

  const handleToggleHiddenItem = async (item: EnrichedAssignment) => {
    if (item.isHiddenEffective) {
      if (item.isCompletedEffective && !filterCompleted) setFilterCompleted(true);
      else if (!item.isCompletedEffective && item.hasDeadlinePassed && !filterPast) setFilterPast(true);
      else if (!item.isCompletedEffective && !item.hasDeadlinePassed && !filterTodo) setFilterTodo(true);
      await toggleAssignmentHidden(item.uidKey, true);
    } else {
      if (expandedUid === item.uidKey) setExpandedUid(null);
      await toggleAssignmentHidden(item.uidKey);
    }
  };

  const handleFileAction = async (
    action: FileDownloadAction,
    key: string,
    fileName: string,
    fileUrl: string,
    mimeType?: string,
    fileSize?: number
  ) => {
    if (busyFiles[key]) return;
    setBusyFiles((prev) => ({ ...prev, [key]: action }));
    try {
      const payload = {
        file_name: fileName,
        file_url: fileUrl,
        mime_type: mimeType,
        file_size: fileSize,
      };
      const res =
        action === 'open'
          ? await openMoodleFile(payload)
          : action === 'share'
            ? await shareMoodleFile(payload)
            : await downloadMoodleFile(payload, undefined, { action: 'download' });
      setFileCacheTick((c) => c + 1);
      if (!res.success && res.error) {
        Alert.alert(
          t('download'),
          res.error === 'NO_VIEWER_INSTALLED' ? t('no_viewer_installed') : res.error
        );
      } else if (res.success && action === 'download' && res.savedToDownloads) {
        Alert.alert(
          t('saved_to_downloads_title'),
          t('saved_to_downloads_desc', { name: res.fileName || fileName })
        );
      }
    } finally {
      setBusyFiles((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const getBadgeTone = (
    badgeClass: 'badge-success' | 'badge-warning' | 'badge-danger' | 'badge-muted'
  ) => {
    switch (badgeClass) {
      case 'badge-success':
        return theme.secondary;
      case 'badge-warning':
        return theme.warning;
      case 'badge-danger':
        return theme.danger;
      default:
        return theme.textSecondary;
    }
  };

  const renderFileActionRow = (
    dlKey: string,
    fileName: string,
    fileUrl: string,
    mimeType?: string,
    fileSize?: number,
    isSubmittedChip = false
  ) => {
    void fileCacheTick;
    return (
      <MoodleFileRow
        key={dlKey}
        fileName={fileName}
        fileSize={fileSize}
        colors={theme}
        isRtl={isRtl}
        isCached={isFileCachedLocally(fileName, fileUrl)}
        busyAction={busyFiles[dlKey] ?? null}
        compact
        style={
          isSubmittedChip
            ? {
                backgroundColor: withHexAlpha(theme.secondary, '10', theme.background),
                borderColor: withHexAlpha(theme.secondary, '35', theme.border),
              }
            : {
                backgroundColor: theme.background,
              }
        }
        onOpen={() =>
          void handleFileAction('open', dlKey, fileName, fileUrl, mimeType, fileSize)
        }
        onDownload={() =>
          void handleFileAction('download', dlKey, fileName, fileUrl, mimeType, fileSize)
        }
        onShare={() =>
          void handleFileAction('share', dlKey, fileName, fileUrl, mimeType, fileSize)
        }
      />
    );
  };

  const renderAssignmentCard = (item: EnrichedAssignment, idx: number) => {
    const isClosestMain =
      idx === 0 && filterTodo && !item.isCompletedEffective && !item.isHiddenEffective;
    const courseColor = resolveCourseColor(item.courseId);
    const courseDisplayName = resolveCourseName(item.courseId, item.courseName);
    const isExpanded = expandedUid === item.uidKey;
    const isQuiz = item.activityType === 'quiz';
    const graceActive = Boolean(item.cutoffDate && hasGracePeriod(item));
    const graceText =
      graceActive && item.cutoffDate
        ? formatGracePeriodText(item.cutoffDate, language)
        : '';

    const dueInfo = getDueTextAndClass(
      item.deadline,
      language,
      settings.dueDateGreenDays,
      settings.dueDateYellowDays,
      false,
      item.isCompletedEffective ? item.status : undefined
    );
    const dueTone = getBadgeTone(dueInfo.badgeClass);

    const subjectFiles = isExpanded ? getSubjectFilesForAssignment(item, mergedFiles) : [];
    const attachments = item.attachments || [];
    const submittedFiles = item.submittedFiles || [];

    const quizMinutes =
      item.timeLimitSeconds && item.timeLimitSeconds > 0
        ? Math.max(1, Math.round(item.timeLimitSeconds / 60))
        : null;

    return (
      <ClosestTaskGlowWrap
        key={item.uidKey}
        active={isClosestMain}
        borderRadius={14}
      >
        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.backgroundElement,
              borderColor: isClosestMain ? 'transparent' : theme.border,
              borderLeftWidth: isRtl ? 1 : 4,
              borderRightWidth: isRtl ? 4 : 1,
              borderLeftColor: isRtl ? theme.border : courseColor,
              borderRightColor: isRtl ? courseColor : theme.border,
              opacity: item.isHiddenEffective ? 0.72 : 1,
            },
          ]}
        >
        {/* Main Tappable Compact Header */}
        <Pressable
          onPress={() => {
            animateLayout();
            setExpandedUid(isExpanded ? null : item.uidKey);
          }}
          style={({ pressed }) => [
            styles.cardHeaderPress,
            { opacity: pressed ? 0.78 : 1 },
          ]}
        >
          {/* Top Tag Row: Course chip + Quiz/Bonus/Late Box + Quick Action Icons */}
          <View style={[styles.cardTopRow, { flexDirection: rowDir }]}>
            <View style={[styles.cardTagsGroup, { flexDirection: rowDir }]}>
              <View
                style={[
                  styles.courseChip,
                  {
                    backgroundColor: withHexAlpha(
                      courseColor,
                      '1A',
                      theme.backgroundSelected
                    ),
                    borderColor: withHexAlpha(courseColor, '44', theme.border),
                  },
                ]}
              >
                <Text
                  style={[styles.courseChipText, { color: courseColor }]}
                  numberOfLines={1}
                >
                  {courseDisplayName}
                </Text>
              </View>

              {isQuiz ? (
                <View
                  style={[
                    styles.metaTag,
                    {
                      backgroundColor: withHexAlpha(
                        '#8b5cf6',
                        '1A',
                        theme.backgroundSelected
                      ),
                      flexDirection: rowDir,
                    },
                  ]}
                >
                  <QuizIcon size={11} color="#8b5cf6" />
                  <Text style={[styles.metaTagText, { color: '#8b5cf6' }]}>
                    {quizMinutes
                      ? `${t('quiz_label')} · ${t('time_limit_minutes', { minutes: quizMinutes })}`
                      : t('quiz_label')}
                  </Text>
                </View>
              ) : null}

              {item.isBonus ? (
                <View
                  style={[
                    styles.metaTag,
                    {
                      backgroundColor: withHexAlpha(
                        theme.warning,
                        '1C',
                        theme.backgroundSelected
                      ),
                    },
                  ]}
                >
                  <Text style={[styles.metaTagText, { color: theme.warning }]}>
                    {t('grades_bonus_label')}
                  </Text>
                </View>
              ) : null}

              {item.isLateSubmissionBox ? (
                <View
                  style={[
                    styles.metaTag,
                    {
                      backgroundColor: withHexAlpha(
                        theme.textSecondary,
                        '1C',
                        theme.backgroundSelected
                      ),
                    },
                  ]}
                >
                  <Text style={[styles.metaTagText, { color: theme.textSecondary }]}>
                    {t('late_box_label')}
                  </Text>
                </View>
              ) : null}
            </View>

            <View style={[styles.cardHeaderActions, { flexDirection: rowDir }]}>
              <Pressable
                onPress={(e) => {
                  e.stopPropagation();
                  void handleToggleHiddenItem(item);
                }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={
                  item.isHiddenEffective
                    ? t('unhide_assignment')
                    : t('hide_assignment')
                }
                style={[
                  styles.iconActionBtn,
                  {
                    backgroundColor: theme.background,
                    borderColor: theme.border,
                  },
                ]}
              >
                {item.isHiddenEffective ? (
                  <EyeIcon size={14} color={theme.primary} />
                ) : (
                  <TrashIcon size={14} color={theme.textSecondary} />
                )}
              </Pressable>

              <View style={styles.chevronWrap}>
                {isExpanded ? (
                  <ChevronUpIcon size={16} color={theme.textSecondary} />
                ) : (
                  <ChevronDownIcon size={16} color={theme.textSecondary} />
                )}
              </View>
            </View>
          </View>

          {/* Assignment Title */}
          <Text
            style={[styles.cardTitle, { color: theme.text, textAlign }]}
            numberOfLines={isExpanded ? 4 : 2}
          >
            {item.name}
          </Text>

          {/* Status / Due Date / Decoupled Badges + Submit in Moodle Row */}
          <View style={[styles.cardStatusRow, { flexDirection: rowDir }]}>
            <View style={[styles.statusBadgesWrap, { flexDirection: rowDir }]}>
              {item.isMoodleSubmitted && item.isCompletedEffective ? (
                <View
                  style={[
                    styles.statusBadge,
                    {
                      backgroundColor: withHexAlpha(
                        theme.secondary,
                        '1C',
                        theme.backgroundSelected
                      ),
                      flexDirection: rowDir,
                    },
                  ]}
                >
                  <CheckIcon size={12} color={theme.secondary} />
                  <Text style={[styles.statusBadgeText, { color: theme.secondary }]}>
                    {t('submitted_badge')}
                  </Text>
                </View>
              ) : null}

              {item.isCompletedEffective && !item.isMoodleSubmitted ? (
                <View
                  style={[
                    styles.statusBadge,
                    {
                      backgroundColor: withHexAlpha(
                        theme.secondary,
                        '1C',
                        theme.backgroundSelected
                      ),
                      flexDirection: rowDir,
                    },
                  ]}
                >
                  <CheckIcon size={12} color={theme.secondary} />
                  <Text style={[styles.statusBadgeText, { color: theme.secondary }]}>
                    {t('marked_as_done')}
                  </Text>
                </View>
              ) : null}

              {!item.isCompletedEffective && item.isMoodleSubmitted ? (
                <View
                  style={[
                    styles.statusBadge,
                    {
                      backgroundColor: withHexAlpha(
                        theme.warning,
                        '1C',
                        theme.backgroundSelected
                      ),
                    },
                  ]}
                >
                  <Text style={[styles.statusBadgeText, { color: theme.warning }]}>
                    {t('submitted_marked_todo')}
                  </Text>
                </View>
              ) : null}

              {!item.isCompletedEffective ? (
                <View
                  style={[
                    styles.statusBadge,
                    {
                      backgroundColor: withHexAlpha(
                        dueTone,
                        '1C',
                        theme.backgroundSelected
                      ),
                    },
                  ]}
                >
                  <Text style={[styles.statusBadgeText, { color: dueTone }]}>
                    {dueInfo.deadlineText}
                  </Text>
                </View>
              ) : null}

              {graceActive ? (
                <View
                  style={[
                    styles.graceInlineRow,
                    {
                      backgroundColor: withHexAlpha(
                        theme.warning,
                        '14',
                        theme.backgroundSelected
                      ),
                      flexDirection: rowDir,
                    },
                  ]}
                >
                  <ClockIcon size={12} color={theme.warning} />
                  <Text
                    style={[styles.graceInlineText, { color: theme.warning }]}
                    numberOfLines={1}
                  >
                    {graceText}
                  </Text>
                </View>
              ) : null}
            </View>

            {!item.isMoodleSubmitted && item.link ? (
              <Pressable
                onPress={(e) => {
                  e.stopPropagation();
                  void openMoodleUrl(item.link, (item as any).baseUrl);
                }}
                style={[
                  styles.submitBtn,
                  { backgroundColor: theme.primary, flexDirection: rowDir },
                ]}
              >
                <Text style={[styles.submitBtnText, { color: theme.onPrimary }]}>
                  {t('submit_in_moodle')}
                </Text>
                <ExternalLinkIcon size={12} color={theme.onPrimary} />
              </Pressable>
            ) : null}
          </View>
        </Pressable>

        {/* Expanded Details Drawer */}
        {isExpanded ? (
          <View
            style={[
              styles.expandedBody,
              { borderTopColor: theme.border },
            ]}
          >
            {/* Section, Exact Deadline & Grade Summary */}
            <View style={[styles.expandedMetaRow, { flexDirection: rowDir }]}>
              {item.sectionName ? (
                <View style={[styles.expandedMetaChip, { flexDirection: rowDir }]}>
                  <FolderIcon size={13} color={theme.textSecondary} />
                  <Text
                    style={[styles.expandedMetaText, { color: theme.textSecondary }]}
                    numberOfLines={1}
                  >
                    {item.sectionName}
                  </Text>
                </View>
              ) : null}

              {item.deadline ? (
                <View style={[styles.expandedMetaChip, { flexDirection: rowDir }]}>
                  <CalendarIcon size={13} color={theme.textSecondary} />
                  <Text
                    style={[styles.expandedMetaText, { color: theme.textSecondary }]}
                  >
                    {`${formatShortDate(item.deadline, language)} · ${formatTimeHM(item.deadline, language)}`}
                  </Text>
                </View>
              ) : null}

              {item.grade !== null && item.grade !== undefined ? (
                <View
                  style={[
                    styles.gradePill,
                    {
                      backgroundColor: withHexAlpha(
                        theme.secondary,
                        '1A',
                        theme.backgroundSelected
                      ),
                    },
                  ]}
                >
                  <Text style={[styles.gradePillText, { color: theme.secondary }]}>
                    {`${t('grade_label')}: ${item.grade}${item.gradeMax ? ` / ${item.gradeMax}` : ''}`}
                  </Text>
                </View>
              ) : null}
            </View>

            {/* Attachments */}
            {attachments.length > 0 ? (
              <View style={styles.filesSection}>
                <Text
                  style={[
                    styles.filesSectionLabel,
                    { color: theme.textSecondary, textAlign },
                  ]}
                >
                  {t('attachments')}
                </Text>
                {attachments.map((att, attIdx) =>
                  renderFileActionRow(
                    `att-${item.uidKey}-${attIdx}`,
                    att.name,
                    att.url,
                    undefined,
                    att.fileSize
                  )
                )}
              </View>
            ) : null}

            {/* Subject Files */}
            {subjectFiles.length > 0 ? (
              <View style={styles.filesSection}>
                <Text
                  style={[
                    styles.filesSectionLabel,
                    { color: theme.textSecondary, textAlign },
                  ]}
                >
                  {t('subject_files')}
                </Text>
                {subjectFiles.map((sf, sfIdx) =>
                  renderFileActionRow(
                    `sf-${item.uidKey}-${sfIdx}`,
                    sf.fileName,
                    sf.fileUrl,
                    sf.mimeType,
                    sf.fileSize
                  )
                )}
              </View>
            ) : null}

            {/* Submitted Files */}
            {submittedFiles.length > 0 ? (
              <View style={styles.filesSection}>
                <Text
                  style={[
                    styles.filesSectionLabel,
                    { color: theme.textSecondary, textAlign },
                  ]}
                >
                  {t('submitted_files')}
                </Text>
                {submittedFiles.map((sub, subIdx) =>
                  renderFileActionRow(
                    `sub-${item.uidKey}-${subIdx}`,
                    sub.name,
                    sub.url,
                    undefined,
                    sub.fileSize,
                    true
                  )
                )}
              </View>
            ) : null}

            {/* Expanded Action Toolbar */}
            <View style={[styles.actionToolbar, { flexDirection: rowDir }]}>
              <NoodleGradientButton
                size="xs"
                label={t('go_to_course')}
                icon={<CourseIcon size={12} color="#ffffff" />}
                onPress={() =>
                  router.push(`/course/${item.courseId}` as never)
                }
                isRtl={isRtl}
              />

              <Pressable
                onPress={() => void toggleAssignmentDone(item.uidKey)}
                style={[
                  styles.toolbarBtn,
                  {
                    backgroundColor: item.isCompletedEffective
                      ? withHexAlpha(
                          theme.secondary,
                          '1A',
                          theme.backgroundSelected
                        )
                      : theme.background,
                    borderColor: item.isCompletedEffective
                      ? theme.secondary
                      : theme.border,
                    flexDirection: rowDir,
                  },
                ]}
              >
                <CheckIcon
                  size={13}
                  color={
                    item.isCompletedEffective ? theme.secondary : theme.text
                  }
                />
                <Text
                  style={[
                    styles.toolbarBtnText,
                    {
                      color: item.isCompletedEffective
                        ? theme.secondary
                        : theme.text,
                    },
                  ]}
                >
                  {item.isCompletedEffective
                    ? t('unmark_completed')
                    : t('mark_completed')}
                </Text>
              </Pressable>

              <Pressable
                onPress={() => setSheetAssignment(item)}
                style={[
                  styles.toolbarBtn,
                  {
                    backgroundColor: withHexAlpha(
                      theme.primary,
                      '14',
                      theme.backgroundSelected
                    ),
                    borderColor: withHexAlpha(theme.primary, '40', theme.border),
                    flexDirection: rowDir,
                  },
                ]}
              >
                <FileIcon size={13} color={theme.primary} />
                <Text style={[styles.toolbarBtnText, { color: theme.primary }]}>
                  {language === 'he' ? 'פרטים' : 'Details'}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
      </ClosestTaskGlowWrap>
    );
  };

  const filterChips: {
    key: string;
    label: string;
    active: boolean;
    count: number;
    onPress: () => void;
  }[] = [
    {
      key: 'todo',
      label: t('filter_todo'),
      active: filterTodo,
      count: bucketCounts.todo,
      onPress: () => setFilterTodo((prev) => !prev),
    },
    {
      key: 'past',
      label: t('filter_past'),
      active: filterPast,
      count: bucketCounts.past,
      onPress: () => setFilterPast((prev) => !prev),
    },
    {
      key: 'completed',
      label: t('filter_completed'),
      active: filterCompleted,
      count: bucketCounts.completed,
      onPress: () => setFilterCompleted((prev) => !prev),
    },
    {
      key: 'hidden',
      label: t('filter_hidden'),
      active: filterHidden,
      count: bucketCounts.hidden,
      onPress: () => setFilterHidden((prev) => !prev),
    },
  ];

  const feedContent = (
    <View style={styles.feedCol}>
      {filteredAssignments.length === 0 ? (
        <View
          style={[
            styles.emptyCard,
            {
              backgroundColor: theme.backgroundElement,
              borderColor: theme.border,
            },
          ]}
        >
          <Text style={[styles.emptyTitle, { color: theme.text }]}>
            {language === 'he'
              ? 'לא נמצאו מטלות תואמות'
              : 'No matching assignments'}
          </Text>
          {enrichedAssignments.length > 0 ? (
            <>
              <Text style={[styles.emptySubtitle, { color: theme.textSecondary }]}>
                {language === 'he'
                  ? 'יש מטלות מוסתרות או מסוננות לפי הבחירה הנוכחית.'
                  : 'Some assignments are hidden by your active filters.'}
              </Text>
              <Pressable
                onPress={handleResetFilters}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.resetFiltersBtn,
                  {
                    backgroundColor: theme.primary,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <Text
                  style={[styles.resetFiltersBtnText, { color: theme.onPrimary }]}
                >
                  {t('reset_filters')}
                </Text>
              </Pressable>
            </>
          ) : (
            <Text style={[styles.emptySubtitle, { color: theme.textSecondary }]}>
              {t('no_pending_tasks')}
            </Text>
          )}
        </View>
      ) : (
        filteredAssignments.map((item, idx) => renderAssignmentCard(item, idx))
      )}

      {/* Collapsible Hidden Assignments Drawer */}
      {!filterHidden && drawerHiddenAssignments.length > 0 ? (
        <View style={styles.hiddenDrawerWrap}>
          <Pressable
            onPress={() => {
              animateLayout();
              setShowHiddenDrawer((prev) => !prev);
            }}
            style={[
              styles.hiddenDrawerToggle,
              {
                backgroundColor: theme.backgroundElement,
                borderColor: theme.border,
                flexDirection: rowDir,
              },
            ]}
          >
            <View style={[styles.hiddenDrawerTitleRow, { flexDirection: rowDir }]}>
              {showHiddenDrawer ? (
                <EyeIcon size={15} color={theme.textSecondary} />
              ) : (
                <EyeOffIcon size={15} color={theme.textSecondary} />
              )}
              <Text style={[styles.hiddenDrawerLabel, { color: theme.textSecondary }]}>
                {`${t('hidden_assignments_drawer')} (${drawerHiddenAssignments.length})`}
              </Text>
            </View>
            {showHiddenDrawer ? (
              <ChevronUpIcon size={16} color={theme.textSecondary} />
            ) : (
              <ChevronDownIcon size={16} color={theme.textSecondary} />
            )}
          </Pressable>

          {showHiddenDrawer ? (
            <View style={styles.hiddenDrawerList}>
              {drawerHiddenAssignments.map((hiddenItem) => {
                const courseColor = resolveCourseColor(hiddenItem.courseId);
                return (
                  <View
                    key={`hidden-${hiddenItem.uidKey}`}
                    style={[
                      styles.hiddenCardRow,
                      {
                        backgroundColor: theme.backgroundElement,
                        borderColor: theme.border,
                        borderLeftWidth: isRtl ? 1 : 4,
                        borderRightWidth: isRtl ? 4 : 1,
                        borderLeftColor: isRtl ? theme.border : courseColor,
                        borderRightColor: isRtl ? courseColor : theme.border,
                        flexDirection: rowDir,
                      },
                    ]}
                  >
                    <View style={styles.hiddenCardInfo}>
                      <Text
                        style={[
                          styles.hiddenCardCourse,
                          { color: courseColor, textAlign },
                        ]}
                        numberOfLines={1}
                      >
                        {resolveCourseName(hiddenItem.courseId, hiddenItem.courseName)}
                      </Text>
                      <Text
                        style={[
                          styles.hiddenCardTitle,
                          { color: theme.text, textAlign },
                        ]}
                        numberOfLines={2}
                      >
                        {hiddenItem.name}
                      </Text>
                    </View>

                    <Pressable
                      onPress={() => void handleToggleHiddenItem(hiddenItem)}
                      style={[
                        styles.unhideBtn,
                        {
                          backgroundColor: withHexAlpha(
                            theme.primary,
                            '18',
                            theme.backgroundSelected
                          ),
                          borderColor: withHexAlpha(
                            theme.primary,
                            '40',
                            theme.border
                          ),
                          flexDirection: rowDir,
                        },
                      ]}
                    >
                      <EyeIcon size={13} color={theme.primary} />
                      <Text style={[styles.unhideBtnText, { color: theme.primary }]}>
                        {t('unhide_assignment')}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );

  const calendarNode = (
    <ScheduleCalendarView
      mode="assignments"
      assignments={filteredAssignments}
      recordings={visibleOverlayRecordings}
      showOverlay={alsoShowRecordings}
      onToggleOverlay={() => setAlsoShowRecordings((prev) => !prev)}
      coursesColorMap={coursesColorMap}
      coursesCustomNames={coursesCustomNames}
      disableSideBySide={isLandscapeTablet}
      onSelectAssignment={(a) => {
        const uid = a.uid || getActivityUid(a);
        setExpandedUid(uid);
        setSheetAssignment(a);
      }}
      onSelectRecording={(rec) => {
        if (rec.recordingUrl) {
          void openMoodleUrl(rec.recordingUrl);
        }
      }}
    />
  );

  return (
    <SafeAreaView
      edges={isLandscapeTablet ? ['top'] : ['top', 'left', 'right']}
      style={[styles.safeArea, { backgroundColor: theme.background }]}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={isSyncing}
            onRefresh={handleRefreshSync}
            tintColor={theme.primary}
            colors={[theme.primary]}
          />
        }
      >
        <View style={[styles.container, { maxWidth: isLandscapeTablet ? 1280 : 680 }]}>
          {/* Top Header */}
          <View style={[styles.headerBar, { flexDirection: rowDir }]}>
            <View style={[styles.headerTitleGroup, { flexDirection: rowDir }]}>
              <Text style={[styles.headerTitle, { color: theme.text }]}>
                {t('assignments')}
              </Text>
              <View
                style={[
                  styles.headerCountBadge,
                  {
                    backgroundColor: withHexAlpha(
                      theme.primary,
                      '1A',
                      theme.backgroundSelected
                    ),
                  },
                ]}
              >
                <Text style={[styles.headerCountText, { color: theme.primary }]}>
                  {filteredAssignments.length}
                </Text>
              </View>
            </View>

            <View style={[styles.headerActions, { flexDirection: rowDir }]}>
              <Pressable
                onPress={() =>
                  isSyncing ? openSyncWindow() : handleRefreshSync()
                }
                accessibilityRole="button"
                accessibilityLabel={t('sync_now')}
                style={({ pressed }) => [
                  styles.headerIconBtn,
                  {
                    backgroundColor: theme.backgroundElement,
                    borderColor: theme.border,
                    opacity: pressed ? 0.72 : 1,
                  },
                ]}
              >
                <SpinningIcon spinning={isSyncing}>
                  <RefreshIcon
                    size={16}
                    color={isSyncing ? theme.primary : theme.text}
                  />
                </SpinningIcon>
              </Pressable>

              <Pressable
                onPress={() => setShowCalendar((prev) => !prev)}
                accessibilityRole="button"
                style={[
                  styles.viewToggleBtn,
                  {
                    backgroundColor: showCalendar
                      ? theme.primary
                      : theme.backgroundElement,
                    borderColor: showCalendar ? theme.primary : theme.border,
                    flexDirection: rowDir,
                  },
                ]}
              >
                {showCalendar ? (
                  <FilterIcon size={14} color={theme.onPrimary} />
                ) : (
                  <CalendarIcon size={14} color={theme.primary} />
                )}
                <Text
                  style={[
                    styles.viewToggleText,
                    { color: showCalendar ? theme.onPrimary : theme.text },
                  ]}
                >
                  {showCalendar
                    ? t('view_list')
                    : language === 'he'
                      ? 'לוח שנה'
                      : 'Calendar'}
                </Text>
              </Pressable>
            </View>
          </View>

          {/* Search Bar */}
          <View
            style={[
              styles.searchBar,
              {
                backgroundColor: theme.backgroundElement,
                borderColor: theme.border,
                flexDirection: rowDir,
              },
            ]}
          >
            <SearchIcon size={16} color={theme.textSecondary} />
            <TextInput
              style={[
                styles.searchInput,
                { color: theme.text, textAlign },
              ]}
              placeholder={t('search_placeholder')}
              placeholderTextColor={theme.placeholder}
              value={searchQuery}
              onChangeText={setSearchQuery}
              returnKeyType="search"
            />
            {searchQuery.length > 0 ? (
              <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
                <CloseIcon size={15} color={theme.textSecondary} />
              </Pressable>
            ) : null}
          </View>

          {/* Course Filter Banner (from route param) */}
          {courseFilterId !== null ? (
            <View
              style={[
                styles.courseBanner,
                {
                  backgroundColor: theme.backgroundElement,
                  borderColor: withHexAlpha(
                    resolveCourseColor(courseFilterId),
                    '45',
                    theme.border
                  ),
                  borderLeftWidth: isRtl ? 1 : 4,
                  borderRightWidth: isRtl ? 4 : 1,
                  borderLeftColor: isRtl
                    ? withHexAlpha(
                        resolveCourseColor(courseFilterId),
                        '45',
                        theme.border
                      )
                    : resolveCourseColor(courseFilterId),
                  borderRightColor: isRtl
                    ? resolveCourseColor(courseFilterId)
                    : withHexAlpha(
                        resolveCourseColor(courseFilterId),
                        '45',
                        theme.border
                      ),
                  flexDirection: rowDir,
                },
              ]}
            >
              <View style={[styles.courseBannerTextGroup, { flexDirection: rowDir }]}>
                <CourseIcon size={15} color={resolveCourseColor(courseFilterId)} />
                <Text
                  style={[styles.courseBannerText, { color: theme.text, textAlign }]}
                  numberOfLines={1}
                >
                  {resolveCourseName(courseFilterId)}
                </Text>
              </View>

              <Pressable
                onPress={handleClearCourseFilter}
                style={[
                  styles.clearBannerBtn,
                  {
                    backgroundColor: theme.background,
                    borderColor: theme.border,
                    flexDirection: rowDir,
                  },
                ]}
              >
                <CloseIcon size={12} color={theme.textSecondary} />
                <Text style={[styles.clearBannerBtnText, { color: theme.text }]}>
                  {language === 'he' ? 'הצג הכל' : 'All Courses'}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {/* 4 Filter Chips */}
          <RtlHorizontalScrollView
            isRtl={isRtl}
            contentContainerStyle={styles.filtersRow}
          >
            {filterChips.map((chip) => (
              <Pressable
                key={chip.key}
                onPress={chip.onPress}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor: chip.active
                      ? theme.primary
                      : theme.backgroundElement,
                    borderColor: chip.active ? theme.primary : theme.border,
                    flexDirection: rowDir,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    { color: chip.active ? theme.onPrimary : theme.text },
                  ]}
                >
                  {`${chip.label} (${chip.count})`}
                </Text>
              </Pressable>
            ))}
          </RtlHorizontalScrollView>

          {/* Main Workspace: Split on wide tablets when Calendar active, toggled on phone */}
          {showCalendar ? (
            isLandscapeTablet ? (
              <View
                style={[
                  styles.splitWorkspace,
                  { flexDirection: rowDir },
                ]}
              >
                <View style={styles.splitFeedPane}>{feedContent}</View>
                <View style={styles.splitCalendarPane}>{calendarNode}</View>
              </View>
            ) : (
              calendarNode
            )
          ) : (
            feedContent
          )}
        </View>
      </ScrollView>

      <AssignmentDetailSheet
        visible={sheetAssignment !== null}
        assignment={sheetAssignment}
        courseColor={
          sheetAssignment
            ? resolveCourseColor(sheetAssignment.courseId)
            : undefined
        }
        courseDisplayName={
          sheetAssignment
            ? resolveCourseName(
                sheetAssignment.courseId,
                sheetAssignment.courseName
              )
            : undefined
        }
        onClose={() => setSheetAssignment(null)}
        onNavigateToCourse={(cid) => {
          setSheetAssignment(null);
          router.push(`/course/${cid}` as never);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  container: {
    width: '100%',
    alignSelf: 'center',
    gap: 12,
  },
  headerBar: {
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  headerTitleGroup: {
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
  },
  headerCountBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  headerCountText: {
    fontSize: 13,
    fontWeight: '700',
  },
  headerActions: {
    alignItems: 'center',
    gap: 8,
  },
  headerIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewToggleBtn: {
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  viewToggleText: {
    fontSize: 13,
    fontWeight: '700',
  },
  searchBar: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 44,
    alignItems: 'center',
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 6,
  },
  courseBanner: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  courseBannerTextGroup: {
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  courseBannerText: {
    fontSize: 14,
    fontWeight: '700',
    flexShrink: 1,
  },
  clearBannerBtn: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignItems: 'center',
    gap: 5,
  },
  clearBannerBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  filtersRow: {
    gap: 8,
    paddingVertical: 2,
  },
  filterChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  splitWorkspace: {
    gap: 16,
    alignItems: 'flex-start',
  },
  splitFeedPane: {
    flex: 1.05,
    minWidth: 0,
  },
  splitCalendarPane: {
    flex: 1.15,
    minWidth: 0,
  },
  feedCol: {
    gap: 10,
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
  },
  cardHeaderPress: {
    padding: 13,
    gap: 8,
  },
  cardTopRow: {
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  cardTagsGroup: {
    flex: 1,
    minWidth: 0,
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  courseChip: {
    borderRadius: 7,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    maxWidth: '100%',
  },
  courseChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  metaTag: {
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    alignItems: 'center',
    gap: 4,
  },
  metaTagText: {
    fontSize: 11,
    fontWeight: '700',
  },
  cardHeaderActions: {
    alignItems: 'center',
    gap: 6,
  },
  iconActionBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevronWrap: {
    padding: 2,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 21,
  },
  cardStatusRow: {
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  statusBadgesWrap: {
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    flex: 1,
  },
  statusBadge: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignItems: 'center',
    gap: 4,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  graceInlineRow: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignItems: 'center',
    gap: 4,
    maxWidth: '100%',
  },
  graceInlineText: {
    fontSize: 11,
    fontWeight: '600',
    flexShrink: 1,
  },
  submitBtn: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: 'center',
    gap: 5,
  },
  submitBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  expandedBody: {
    borderTopWidth: 1,
    padding: 13,
    gap: 10,
  },
  expandedMetaRow: {
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
  },
  expandedMetaChip: {
    alignItems: 'center',
    gap: 5,
  },
  expandedMetaText: {
    fontSize: 12,
    fontWeight: '500',
  },
  gradePill: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  gradePillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  filesSection: {
    gap: 6,
  },
  filesSectionLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
  fileRow: {
    borderRadius: 9,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  fileMainTap: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: 8,
  },
  fileRowActions: {
    alignItems: 'center',
    gap: 6,
  },
  fileMiniBtn: {
    width: 28,
    height: 28,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileRowName: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
  },
  actionToolbar: {
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 2,
  },
  toolbarBtn: {
    borderRadius: 9,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
    alignItems: 'center',
    gap: 5,
  },
  toolbarBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  emptyCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 28,
    alignItems: 'center',
    gap: 6,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 13,
    textAlign: 'center',
  },
  resetFiltersBtn: {
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resetFiltersBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  hiddenDrawerWrap: {
    marginTop: 6,
    gap: 8,
  },
  hiddenDrawerToggle: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  hiddenDrawerTitleRow: {
    alignItems: 'center',
    gap: 8,
  },
  hiddenDrawerLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  hiddenDrawerList: {
    gap: 8,
  },
  hiddenCardRow: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  hiddenCardInfo: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  hiddenCardCourse: {
    fontSize: 11,
    fontWeight: '700',
  },
  hiddenCardTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  unhideBtn: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: 'center',
    gap: 5,
  },
  unhideBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
});
