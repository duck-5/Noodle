import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Assignment,
  CoursePanoptoStaffEntry,
  PanoptoRecording,
  aggregateUnifiedCourseItems,
  cleanCourseDisplayName,
  doesRecordingMatchStaffEntries,
  expandTrackedCourseIds,
  isActivityCompleted,
  isActivityHidden,
  partitionPanoptoRecordingsByTrackedHosts,
  reclassifyPanoptoRecordings,
} from '@tautracker/moodle-client';
import { AssignmentDetailSheet } from '@/components/AssignmentDetailSheet';
import { RtlHorizontalScrollView } from '@/components/RtlHorizontalScrollView';
import {
  ScheduleCalendarView,
  parseRecordingDateKey,
} from '@/components/ScheduleCalendarView';
import { SsoWebViewModal } from '@/components/SsoWebViewModal';
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
  FilterIcon,
  FolderIcon,
  InfoIcon,
  RefreshIcon,
  SearchIcon,
  ShieldIcon,
  TrashIcon,
  UserIcon,
  VideoIcon,
} from '@/components/icons/NoodleIcons';
import { SpinningIcon, animateLayout } from '@/components/ui/NoodleAnimations';
import { getReadableTextColor } from '@/constants/theme';
import { useAppState, useSyncProgress } from '@/hooks/use-app-state';
import { usePreferences } from '@/hooks/use-preferences';
import { useResponsiveLayout } from '@/hooks/use-responsive-layout';
import { openMoodleUrl } from '@/services/moodleLink';

function withHexAlpha(color: string, alphaHex: string, fallback: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(color)) {
    return `${color}${alphaHex}`;
  }
  return fallback;
}

function formatDuration(seconds: number | undefined, lang: 'he' | 'en'): string {
  if (!seconds || seconds <= 0) return '';
  const totalMin = Math.round(seconds / 60);
  if (totalMin < 60) {
    return lang === 'he' ? `${totalMin} דק'` : `${totalMin}m`;
  }
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (lang === 'he') {
    return m > 0 ? `${h}ש' ${m}דק'` : `${h}ש'`;
  }
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export default function RecordingsScreen() {
  const router = useRouter();
  const { isLandscapeTablet } = useResponsiveLayout();

  const { theme, language, isRtl, t } = usePreferences();
  const { syncWarnings, openSyncWindow } = useSyncProgress();
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
    watchedRecordings,
    hiddenRecordings,
    trackedPanoptoHosts,
    coursesPanoptoStaff,
    toggleRecordingWatched,
    toggleRecordingHidden,
    toggleTrackedHost,
    updateSetting,
  } = useAppState();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCourseId, setSelectedCourseId] = useState<'all' | number>('all');
  const [filterUnwatched, setFilterUnwatched] = useState(true);
  const [filterWatched, setFilterWatched] = useState(false);
  const [filterLectures, setFilterLectures] = useState(true);
  const [filterRecitations, setFilterRecitations] = useState(true);
  const [filterHidden, setFilterHidden] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [alsoShowAssignments, setAlsoShowAssignments] = useState(false);
  const [showHiddenDrawer, setShowHiddenDrawer] = useState(false);
  const [isEnablingPanopto, setIsEnablingPanopto] = useState(false);
  const [panoptoSsoVisible, setPanoptoSsoVisible] = useState(false);
  const [dismissedWarningSig, setDismissedWarningSig] = useState<string | null>(null);
  const [focusedRecordingId, setFocusedRecordingId] = useState<string | null>(null);
  const [modalRecording, setModalRecording] = useState<PanoptoRecording | null>(null);
  const [sheetAssignment, setSheetAssignment] = useState<Assignment | null>(null);

  const panoptoWarnings = useMemo(
    () =>
      syncWarnings.filter(
        (w) => /panopto/i.test(w.context) || /panopto/i.test(w.message)
      ),
    [syncWarnings]
  );
  const warningSig = useMemo(
    () => panoptoWarnings.map((w) => `${w.context}:${w.message}`).join('|'),
    [panoptoWarnings]
  );
  const showPanoptoWarningBanner =
    panoptoWarnings.length > 0 && dismissedWarningSig !== warningSig;

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
      if (fallback) return cleanCourseDisplayName(fallback) || fallback;
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

  const resolveStaffEntries = useCallback(
    (courseId: number, sourceCourseId?: number): CoursePanoptoStaffEntry[] => {
      const direct = coursesPanoptoStaff[courseId];
      if (Array.isArray(direct) && direct.length > 0) return direct;
      if (sourceCourseId !== undefined) {
        const src = coursesPanoptoStaff[sourceCourseId];
        if (Array.isArray(src) && src.length > 0) return src;
      }
      const hostFallbacks =
        trackedPanoptoHosts[courseId] ||
        (sourceCourseId !== undefined ? trackedPanoptoHosts[sourceCourseId] : undefined) ||
        [];
      return hostFallbacks.map((hostName) => ({
        panoptoName: hostName,
        role: 'Lecture' as const,
      }));
    },
    [coursesPanoptoStaff, trackedPanoptoHosts]
  );

  // Merge multi-portal unified courses & filter to tracked courses
  const { sortedRecordings, mergedAssignments } = useMemo(() => {
    const rawRecs = syncResult.recordings || [];
    const rawAssigns = syncResult.assignments || [];

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
    const aliasMap = new Map<number, number[]>();
    for (const u of multiPortalGroups) {
      const memberIds = u.subCourses.map((s) => s.courseId);
      for (const s of u.subCourses) {
        aliasMap.set(s.courseId, memberIds);
        if (s.courseId !== u.id) {
          childCourseIds.add(s.courseId);
        }
      }
    }

    const isTrackedId = (cid: number) =>
      !hasTrackedFilter || expandedSet.has(cid) || trackedSet.has(cid);

    let recordings = rawRecs.filter(
      (r) => !childCourseIds.has(r.courseId) && isTrackedId(r.courseId)
    );
    let assignments = rawAssigns.filter(
      (a) => !childCourseIds.has(a.courseId) && isTrackedId(a.courseId)
    );

    for (const u of multiPortalGroups) {
      const agg = aggregateUnifiedCourseItems(u, syncResult);
      recordings = recordings.filter((r) => r.courseId !== u.id).concat(agg.recordings);
      assignments = assignments.filter((a) => a.courseId !== u.id).concat(agg.assignments);
    }

    const reclassified =
      recordings.length > 0
        ? reclassifyPanoptoRecordings(
            recordings,
            coursesPanoptoStaff,
            syncResult.courseStaff,
            aliasMap
          )
        : recordings;

    const sorted = [...reclassified].sort((a, b) => {
      const pa = parseRecordingDateKey(a.publishedDate);
      const pb = parseRecordingDateKey(b.publishedDate);
      const ta = pa ? pa.date.getTime() : 0;
      const tb = pb ? pb.date.getTime() : 0;
      if (tb !== ta) return tb - ta;
      return b.id.localeCompare(a.id);
    });

    return {
      sortedRecordings: sorted,
      mergedAssignments: assignments,
    };
  }, [syncResult, groupedCourses, trackedCourseIds, coursesPanoptoStaff]);

  const watchedSet = useMemo(() => new Set(watchedRecordings), [watchedRecordings]);
  const manualHiddenSet = useMemo(() => new Set(hiddenRecordings), [hiddenRecordings]);

  // Partition per course using partitionPanoptoRecordingsByTrackedHosts
  const { hiddenByHostSet } = useMemo(() => {
    const byCourse = new Map<number, PanoptoRecording[]>();
    for (const rec of sortedRecordings) {
      const list = byCourse.get(rec.courseId);
      if (list) list.push(rec);
      else byCourse.set(rec.courseId, [rec]);
    }

    const hostHidden = new Set<string>();
    for (const [cid, list] of byCourse.entries()) {
      const staffEntries = resolveStaffEntries(cid);
      const partitioned = partitionPanoptoRecordingsByTrackedHosts(
        list,
        staffEntries,
        hiddenRecordings
      );
      for (const h of partitioned.hidden) {
        if (!manualHiddenSet.has(h.id)) {
          hostHidden.add(h.id);
        }
      }
    }
    return { hiddenByHostSet: hostHidden };
  }, [sortedRecordings, resolveStaffEntries, hiddenRecordings, manualHiddenSet]);

  const courseFilterOptions = useMemo(() => {
    const map = new Map<number, { courseId: number; displayName: string; count: number }>();
    for (const rec of sortedRecordings) {
      const existing = map.get(rec.courseId);
      if (existing) {
        existing.count++;
      } else {
        map.set(rec.courseId, {
          courseId: rec.courseId,
          displayName: resolveCourseName(rec.courseId, rec.courseName),
          count: 1,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      a.displayName.localeCompare(b.displayName)
    );
  }, [sortedRecordings, resolveCourseName]);

  const baseMatchedRecordings = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return sortedRecordings.filter((rec) => {
      if (selectedCourseId !== 'all' && rec.courseId !== selectedCourseId) {
        return false;
      }
      if (rec.type === 'Recitation' && !filterRecitations) return false;
      if (rec.type !== 'Recitation' && !filterLectures) return false;
      if (!q) return true;

      const courseDisplay = resolveCourseName(rec.courseId, rec.courseName).toLowerCase();
      return (
        rec.title.toLowerCase().includes(q) ||
        (rec.host || '').toLowerCase().includes(q) ||
        (rec.sectionName || '').toLowerCase().includes(q) ||
        courseDisplay.includes(q) ||
        rec.courseName.toLowerCase().includes(q)
      );
    });
  }, [
    sortedRecordings,
    selectedCourseId,
    filterRecitations,
    filterLectures,
    searchQuery,
    resolveCourseName,
  ]);

  const bucketCounts = useMemo(() => {
    let unwatched = 0;
    let watched = 0;
    let lectures = 0;
    let recitations = 0;
    let hidden = 0;

    for (const rec of sortedRecordings) {
      if (selectedCourseId !== 'all' && rec.courseId !== selectedCourseId) continue;
      if (rec.type === 'Recitation') recitations++;
      else lectures++;

      const isHidden = manualHiddenSet.has(rec.id) || hiddenByHostSet.has(rec.id);
      if (isHidden) {
        hidden++;
      } else if (watchedSet.has(rec.id)) {
        watched++;
      } else {
        unwatched++;
      }
    }
    return { unwatched, watched, lectures, recitations, hidden };
  }, [sortedRecordings, selectedCourseId, manualHiddenSet, hiddenByHostSet, watchedSet]);

  const filteredRecordings = useMemo(() => {
    return baseMatchedRecordings.filter((rec) => {
      const isHidden = manualHiddenSet.has(rec.id) || hiddenByHostSet.has(rec.id);
      if (isHidden) return filterHidden;
      const isWatched = watchedSet.has(rec.id);
      if (isWatched && filterWatched) return true;
      if (!isWatched && filterUnwatched) return true;
      return false;
    });
  }, [
    baseMatchedRecordings,
    manualHiddenSet,
    hiddenByHostSet,
    watchedSet,
    filterHidden,
    filterWatched,
    filterUnwatched,
  ]);

  const drawerHiddenRecordings = useMemo(() => {
    if (filterHidden) return [];
    return baseMatchedRecordings.filter(
      (rec) => manualHiddenSet.has(rec.id) || hiddenByHostSet.has(rec.id)
    );
  }, [baseMatchedRecordings, filterHidden, manualHiddenSet, hiddenByHostSet]);

  const overlayAssignments = useMemo(() => {
    return mergedAssignments
      .filter((a) => {
        if (selectedCourseId !== 'all' && a.courseId !== selectedCourseId) {
          return false;
        }
        return !isActivityHidden(a, hiddenAssignments);
      })
      .map((a) => ({
        ...a,
        isCompleted: isActivityCompleted(
          a,
          completedAssignments,
          uncompletedAssignments
        ),
      }));
  }, [
    mergedAssignments,
    selectedCourseId,
    hiddenAssignments,
    completedAssignments,
    uncompletedAssignments,
  ]);

  const handleEnablePanopto = async () => {
    if (isEnablingPanopto) return;
    setIsEnablingPanopto(true);
    try {
      await updateSetting('panoptoEnabled', true);
      await triggerSync({ manual: true });
    } finally {
      setIsEnablingPanopto(false);
    }
  };

  const handleResetFilters = () => {
    setSearchQuery('');
    setSelectedCourseId('all');
    setFilterUnwatched(true);
    setFilterWatched(true);
    setFilterLectures(true);
    setFilterRecitations(true);
    setFilterHidden(
      sortedRecordings.length > 0 &&
        sortedRecordings.every(
          (r) => manualHiddenSet.has(r.id) || hiddenByHostSet.has(r.id)
        )
    );
  };

  const handleSelectCalendarRecording = (rec: PanoptoRecording) => {
    const isHidden = manualHiddenSet.has(rec.id) || hiddenByHostSet.has(rec.id);
    const isWatched = watchedSet.has(rec.id);
    if (isHidden && !filterHidden) setFilterHidden(true);
    if (!isHidden && isWatched && !filterWatched) setFilterWatched(true);
    if (!isHidden && !isWatched && !filterUnwatched) setFilterUnwatched(true);
    if (rec.type === 'Recitation' && !filterRecitations) setFilterRecitations(true);
    if (rec.type !== 'Recitation' && !filterLectures) setFilterLectures(true);

    setFocusedRecordingId(rec.id);
    setModalRecording(rec);
  };

  const renderRecordingCard = (rec: PanoptoRecording) => {
    const courseColor = resolveCourseColor(rec.courseId);
    const courseDisplayName = resolveCourseName(rec.courseId, rec.courseName);
    const isWatched = watchedSet.has(rec.id);
    const isManuallyHidden = manualHiddenSet.has(rec.id);
    const isHostHidden = hiddenByHostSet.has(rec.id);
    const isHidden = isManuallyHidden || isHostHidden;
    const isRecitation = rec.type === 'Recitation';
    const isFocused = focusedRecordingId === rec.id;

    const staffEntries = resolveStaffEntries(rec.courseId, rec.sourceCourseId);
    const isHostTracked =
      Boolean(rec.host) &&
      doesRecordingMatchStaffEntries({ host: rec.host }, staffEntries);

    const durationLabel = formatDuration(rec.durationSeconds, language);
    const typeColor = isRecitation ? '#8b5cf6' : '#3b82f6';

    return (
      <View
        key={rec.id}
        style={[
          styles.card,
          {
            backgroundColor: theme.backgroundElement,
            borderColor: isFocused ? courseColor : theme.border,
            borderWidth: isFocused ? 1.5 : 1,
            borderLeftWidth: isRtl ? (isFocused ? 1.5 : 1) : 4,
            borderRightWidth: isRtl ? 4 : isFocused ? 1.5 : 1,
            borderLeftColor: isRtl
              ? isFocused
                ? courseColor
                : theme.border
              : courseColor,
            borderRightColor: isRtl
              ? courseColor
              : isFocused
                ? courseColor
                : theme.border,
            opacity: isHidden ? 0.72 : isWatched ? 0.78 : 1,
          },
        ]}
      >
        {/* Top Row: Course Chip + Type Badge + Hidden Badge */}
        <View style={[styles.cardTopRow, { flexDirection: rowDir }]}>
          <View style={[styles.cardBadgesGroup, { flexDirection: rowDir }]}>
            <Pressable
              onPress={() => router.push(`/course/${rec.courseId}` as never)}
              style={[
                styles.courseChip,
                {
                  backgroundColor: withHexAlpha(
                    courseColor,
                    '1A',
                    theme.backgroundSelected
                  ),
                  borderColor: withHexAlpha(courseColor, '44', theme.border),
                  flexDirection: rowDir,
                },
              ]}
            >
              <CourseIcon size={12} color={courseColor} />
              <Text
                style={[styles.courseChipText, { color: courseColor }]}
                numberOfLines={1}
              >
                {courseDisplayName}
              </Text>
            </Pressable>

            <View
              style={[
                styles.typeBadge,
                {
                  backgroundColor: withHexAlpha(
                    typeColor,
                    '1A',
                    theme.backgroundSelected
                  ),
                },
              ]}
            >
              <Text style={[styles.typeBadgeText, { color: typeColor }]}>
                {isRecitation ? t('recitations_label') : t('lectures_label')}
              </Text>
            </View>

            {isHidden ? (
              <View
                style={[
                  styles.hiddenBadge,
                  {
                    backgroundColor: withHexAlpha(
                      theme.textSecondary,
                      '1A',
                      theme.backgroundSelected
                    ),
                  },
                ]}
              >
                <Text
                  style={[styles.hiddenBadgeText, { color: theme.textSecondary }]}
                >
                  {t('filter_hidden')}
                </Text>
              </View>
            ) : null}
          </View>

          <Pressable
            onPress={() => void toggleRecordingHidden(rec.id)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={
              isManuallyHidden ? t('unhide_recording') : t('hide_assignment')
            }
            style={[
              styles.iconActionBtn,
              {
                backgroundColor: theme.background,
                borderColor: theme.border,
              },
            ]}
          >
            {isManuallyHidden ? (
              <EyeIcon size={14} color={theme.primary} />
            ) : (
              <TrashIcon size={14} color={theme.textSecondary} />
            )}
          </Pressable>
        </View>

        {/* Recording Title */}
        <Text
          style={[styles.cardTitle, { color: theme.text, textAlign }]}
          numberOfLines={2}
        >
          {rec.title}
        </Text>

        {/* Metadata Badges: Host, Published Date + Duration, Section */}
        {(rec.host || rec.publishedDate || durationLabel || rec.sectionName) ? (
          <View style={[styles.metaRow, { flexDirection: rowDir }]}>
            {rec.host ? (
              <View
                style={[
                  styles.metaChip,
                  {
                    backgroundColor: theme.background,
                    borderColor: theme.border,
                    flexDirection: rowDir,
                  },
                ]}
              >
                <UserIcon size={11} color={theme.textSecondary} />
                <Text
                  style={[styles.metaChipText, { color: theme.textSecondary }]}
                  numberOfLines={1}
                >
                  {rec.host}
                </Text>
              </View>
            ) : null}

            {rec.publishedDate || durationLabel ? (
              <View
                style={[
                  styles.metaChip,
                  {
                    backgroundColor: theme.background,
                    borderColor: theme.border,
                    flexDirection: rowDir,
                  },
                ]}
              >
                {rec.publishedDate ? (
                  <>
                    <CalendarIcon size={11} color={theme.textSecondary} />
                    <Text
                      style={[
                        styles.metaChipText,
                        { color: theme.textSecondary },
                      ]}
                    >
                      {rec.publishedDate}
                    </Text>
                  </>
                ) : null}
                {rec.publishedDate && durationLabel ? (
                  <Text style={{ color: theme.textSecondary, fontSize: 11 }}>
                    ·
                  </Text>
                ) : null}
                {durationLabel ? (
                  <>
                    <ClockIcon size={11} color={theme.textSecondary} />
                    <Text
                      style={[
                        styles.metaChipText,
                        { color: theme.textSecondary },
                      ]}
                    >
                      {durationLabel}
                    </Text>
                  </>
                ) : null}
              </View>
            ) : null}

            {rec.sectionName ? (
              <View
                style={[
                  styles.metaChip,
                  {
                    backgroundColor: theme.background,
                    borderColor: theme.border,
                    flexDirection: rowDir,
                  },
                ]}
              >
                <FolderIcon size={11} color={theme.textSecondary} />
                <Text
                  style={[styles.metaChipText, { color: theme.textSecondary }]}
                  numberOfLines={1}
                >
                  {rec.sectionName}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Action Footer */}
        <View style={[styles.actionsRow, { flexDirection: rowDir }]}>
          {rec.host ? (
            <Pressable
              onPress={() =>
                void toggleTrackedHost(rec.courseId, rec.host!, rec.type)
              }
              style={[
                styles.actionBtn,
                {
                  backgroundColor: isHostTracked
                    ? withHexAlpha(theme.primary, '18', theme.backgroundSelected)
                    : theme.background,
                  borderColor: isHostTracked ? theme.primary : theme.border,
                  flexDirection: rowDir,
                },
              ]}
            >
              {isHostTracked ? (
                <EyeIcon size={13} color={theme.primary} />
              ) : (
                <EyeOffIcon size={13} color={theme.textSecondary} />
              )}
              <Text
                style={[
                  styles.actionBtnText,
                  {
                    color: isHostTracked ? theme.primary : theme.textSecondary,
                  },
                ]}
              >
                {isHostTracked ? t('tracking_host') : t('track_this_host')}
              </Text>
            </Pressable>
          ) : null}

          <Pressable
            onPress={() => void toggleRecordingWatched(rec.id)}
            style={[
              styles.actionBtn,
              {
                backgroundColor: isWatched
                  ? withHexAlpha(theme.secondary, '1A', theme.backgroundSelected)
                  : theme.background,
                borderColor: isWatched ? theme.secondary : theme.border,
                flexDirection: rowDir,
              },
            ]}
          >
            <CheckIcon
              size={13}
              color={isWatched ? theme.secondary : theme.text}
            />
            <Text
              style={[
                styles.actionBtnText,
                { color: isWatched ? theme.secondary : theme.text },
              ]}
            >
              {isWatched ? t('mark_unwatched') : t('mark_watched')}
            </Text>
          </Pressable>

          {rec.recordingUrl ? (
            <Pressable
              onPress={() => void openMoodleUrl(rec.recordingUrl)}
              style={[
                styles.watchBtn,
                { backgroundColor: theme.primary, flexDirection: rowDir },
              ]}
            >
              <VideoIcon size={13} color={theme.onPrimary} />
              <Text style={[styles.watchBtnText, { color: theme.onPrimary }]}>
                {t('watch_recording')}
              </Text>
              <ExternalLinkIcon size={11} color={theme.onPrimary} />
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  };

  // Disabled Beta Opt-In CTA
  if (!settings.panoptoEnabled) {
    return (
      <SafeAreaView
        edges={isLandscapeTablet ? ['top'] : ['top', 'left', 'right']}
        style={[styles.safeArea, { backgroundColor: theme.background }]}
      >
        <View style={styles.disabledContainer}>
          <View
            style={[
              styles.disabledCard,
              {
                backgroundColor: theme.backgroundElement,
                borderColor: theme.border,
              },
            ]}
          >
            <View
              style={[
                styles.disabledIconCircle,
                {
                  backgroundColor: withHexAlpha(
                    theme.primary,
                    '18',
                    theme.backgroundSelected
                  ),
                },
              ]}
            >
              <VideoIcon size={36} color={theme.primary} />
            </View>

            <View
              style={[
                styles.betaPill,
                {
                  backgroundColor: withHexAlpha(
                    theme.primary,
                    '18',
                    theme.backgroundSelected
                  ),
                  borderColor: withHexAlpha(theme.primary, '40', theme.border),
                },
              ]}
            >
              <Text style={[styles.betaPillText, { color: theme.primary }]}>
                {t('panopto_beta_badge')}
              </Text>
            </View>

            <Text style={[styles.disabledTitle, { color: theme.text }]}>
              {t('panopto_disabled_title')}
            </Text>
            <Text style={[styles.disabledDesc, { color: theme.textSecondary }]}>
              {t('panopto_disabled_desc')}
            </Text>

            <Pressable
              onPress={() => void handleEnablePanopto()}
              disabled={isEnablingPanopto}
              style={[
                styles.enablePanoptoBtn,
                {
                  backgroundColor: theme.primary,
                  opacity: isEnablingPanopto ? 0.7 : 1,
                  flexDirection: rowDir,
                },
              ]}
            >
              {isEnablingPanopto ? (
                <ActivityIndicator size="small" color={theme.onPrimary} />
              ) : (
                <VideoIcon size={16} color={theme.onPrimary} />
              )}
              <Text style={[styles.enablePanoptoBtnText, { color: theme.onPrimary }]}>
                {t('enable_panopto_btn')}
              </Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const filterChips: {
    key: string;
    label: string;
    active: boolean;
    count: number;
    onPress: () => void;
  }[] = [
    {
      key: 'unwatched',
      label: t('filter_unwatched'),
      active: filterUnwatched,
      count: bucketCounts.unwatched,
      onPress: () => setFilterUnwatched((prev) => !prev),
    },
    {
      key: 'watched',
      label: t('filter_watched'),
      active: filterWatched,
      count: bucketCounts.watched,
      onPress: () => setFilterWatched((prev) => !prev),
    },
    {
      key: 'lectures',
      label: t('filter_lectures'),
      active: filterLectures,
      count: bucketCounts.lectures,
      onPress: () => setFilterLectures((prev) => !prev),
    },
    {
      key: 'recitations',
      label: t('filter_recitations'),
      active: filterRecitations,
      count: bucketCounts.recitations,
      onPress: () => setFilterRecitations((prev) => !prev),
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
      {filteredRecordings.length === 0 ? (
        <View
          style={[
            styles.emptyCard,
            {
              backgroundColor: theme.backgroundElement,
              borderColor: theme.border,
            },
          ]}
        >
          <VideoIcon size={28} color={theme.textSecondary} />
          <Text style={[styles.emptyTitle, { color: theme.text }]}>
            {language === 'he'
              ? 'לא נמצאו הקלטות תואמות'
              : 'No matching recordings'}
          </Text>
          <Text style={[styles.emptySubtitle, { color: theme.textSecondary }]}>
            {drawerHiddenRecordings.length > 0 && !filterHidden
              ? language === 'he'
                ? 'כל ההקלטות מוסתרות או שייכות למארחים שאינם במעקב.'
                : 'All recordings are hidden or belong to untracked hosts.'
              : t('no_catchup_recordings')}
          </Text>
          {sortedRecordings.length > 0 ? (
            <Pressable
              onPress={handleResetFilters}
              accessibilityRole="button"
              accessibilityLabel={t('reset_filters')}
              style={({ pressed }) => [
                styles.enablePanoptoBtn,
                {
                  backgroundColor: theme.primary,
                  flexDirection: rowDir,
                  opacity: pressed ? 0.85 : 1,
                  marginTop: 4,
                },
              ]}
            >
              <FilterIcon size={15} color={theme.onPrimary} />
              <Text style={[styles.enablePanoptoBtnText, { color: theme.onPrimary }]}>
                {t('reset_filters')}
              </Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => setPanoptoSsoVisible(true)}
              accessibilityRole="button"
              accessibilityLabel={t('panopto_connect_sso')}
              testID="recordings-empty-panopto-sso-btn"
              style={({ pressed }) => [
                styles.enablePanoptoBtn,
                {
                  backgroundColor: theme.primary,
                  flexDirection: rowDir,
                  opacity: pressed ? 0.85 : 1,
                  marginTop: 4,
                },
              ]}
            >
              <ShieldIcon size={16} color={theme.onPrimary} />
              <Text style={[styles.enablePanoptoBtnText, { color: theme.onPrimary }]}>
                {t('panopto_connect_sso')}
              </Text>
            </Pressable>
          )}
        </View>
      ) : (
        filteredRecordings.map(renderRecordingCard)
      )}

      {/* Collapsible Hidden Recordings Drawer */}
      {!filterHidden && drawerHiddenRecordings.length > 0 ? (
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
                {`${t('hidden_recordings_drawer')} (${drawerHiddenRecordings.length})`}
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
              {drawerHiddenRecordings.map(renderRecordingCard)}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );

  const calendarNode = (
    <ScheduleCalendarView
      mode="recordings"
      assignments={overlayAssignments}
      recordings={filteredRecordings}
      showOverlay={alsoShowAssignments}
      onToggleOverlay={() => setAlsoShowAssignments((prev) => !prev)}
      coursesColorMap={coursesColorMap}
      coursesCustomNames={coursesCustomNames}
      disableSideBySide={isLandscapeTablet}
      onSelectRecording={handleSelectCalendarRecording}
      onSelectAssignment={(a) => setSheetAssignment(a)}
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
            onRefresh={() => void triggerSync({ manual: true })}
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
                {t('recordings')}
              </Text>
              <View
                style={[
                  styles.betaPillSmall,
                  {
                    backgroundColor: withHexAlpha(
                      theme.primary,
                      '1A',
                      theme.backgroundSelected
                    ),
                  },
                ]}
              >
                <Text style={[styles.betaPillSmallText, { color: theme.primary }]}>
                  {t('panopto_beta_badge')}
                </Text>
              </View>
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
                  {filteredRecordings.length}
                </Text>
              </View>
            </View>

            <View style={[styles.headerActions, { flexDirection: rowDir }]}>
              <Pressable
                onPress={() => setPanoptoSsoVisible(true)}
                accessibilityRole="button"
                accessibilityLabel={t('panopto_connect_sso')}
                testID="recordings-panopto-sso-btn"
                style={[
                  styles.headerIconBtn,
                  {
                    backgroundColor: theme.backgroundElement,
                    borderColor: theme.border,
                  },
                ]}
              >
                <ShieldIcon size={16} color={theme.primary} />
              </Pressable>

              <Pressable
                onPress={() =>
                  isSyncing ? openSyncWindow() : void triggerSync({ manual: true })
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
                  <RefreshIcon size={16} color={isSyncing ? theme.primary : theme.text} />
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

          {/* Panopto Sync Warning Banner */}
          {showPanoptoWarningBanner ? (
            <View
              style={[
                styles.warningBanner,
                {
                  backgroundColor: withHexAlpha(
                    theme.warning,
                    '18',
                    theme.backgroundElement
                  ),
                  borderColor: withHexAlpha(theme.warning, '55', theme.border),
                },
              ]}
            >
              <View style={[styles.warningBannerTop, { flexDirection: rowDir }]}>
                <InfoIcon size={16} color={theme.warning} />
                <Text
                  style={[
                    styles.warningBannerText,
                    { color: theme.text, textAlign },
                  ]}
                >
                  {panoptoWarnings.map((w) => w.message).join(' • ')}
                </Text>
                <Pressable
                  onPress={() => setDismissedWarningSig(warningSig)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={t('close')}
                >
                  <CloseIcon size={15} color={theme.textSecondary} />
                </Pressable>
              </View>
              <Pressable
                onPress={() => setPanoptoSsoVisible(true)}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.warningSsoBtn,
                  {
                    backgroundColor: theme.warning,
                    flexDirection: rowDir,
                    alignSelf: isRtl ? 'flex-end' : 'flex-start',
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <ShieldIcon size={13} color={theme.onWarning} />
                <Text
                  style={[styles.warningSsoBtnText, { color: theme.onWarning }]}
                >
                  {t('panopto_connect_sso')}
                </Text>
              </Pressable>
            </View>
          ) : null}

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
              style={[styles.searchInput, { color: theme.text, textAlign }]}
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

          {/* Course Filter Pills */}
          {courseFilterOptions.length > 0 ? (
            <RtlHorizontalScrollView
              isRtl={isRtl}
              contentContainerStyle={styles.pillsRow}
            >
              <Pressable
                onPress={() => setSelectedCourseId('all')}
                style={[
                  styles.courseFilterPill,
                  {
                    backgroundColor:
                      selectedCourseId === 'all'
                        ? theme.primary
                        : theme.backgroundElement,
                    borderColor:
                      selectedCourseId === 'all' ? theme.primary : theme.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.courseFilterPillText,
                    {
                      color:
                        selectedCourseId === 'all' ? theme.onPrimary : theme.text,
                    },
                  ]}
                >
                  {t('all_subjects')}
                </Text>
              </Pressable>

              {courseFilterOptions.map((opt) => {
                const isSelected = selectedCourseId === opt.courseId;
                const cColor = resolveCourseColor(opt.courseId);
                const selectedFg = getReadableTextColor(cColor);
                return (
                  <Pressable
                    key={opt.courseId}
                    onPress={() => setSelectedCourseId(opt.courseId)}
                    style={[
                      styles.courseFilterPill,
                      {
                        backgroundColor: isSelected
                          ? cColor
                          : theme.backgroundElement,
                        borderColor: isSelected ? cColor : theme.border,
                        flexDirection: rowDir,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.courseDot,
                        { backgroundColor: isSelected ? selectedFg : cColor },
                      ]}
                    />
                    <Text
                      style={[
                        styles.courseFilterPillText,
                        { color: isSelected ? selectedFg : theme.text },
                      ]}
                      numberOfLines={1}
                    >
                      {opt.displayName}
                    </Text>
                  </Pressable>
                );
              })}
            </RtlHorizontalScrollView>
          ) : null}

          {/* 5 Filter Chips */}
          <RtlHorizontalScrollView
            isRtl={isRtl}
            contentContainerStyle={styles.pillsRow}
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

          {/* Main Workspace */}
          {showCalendar ? (
            isLandscapeTablet ? (
              <View style={[styles.splitWorkspace, { flexDirection: rowDir }]}>
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

      {/* Lightweight Recording Action Modal when selecting a recording in Calendar */}
      <Modal
        visible={modalRecording !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setModalRecording(null)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setModalRecording(null)}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={[
              styles.modalCard,
              {
                backgroundColor: theme.backgroundElement,
                borderColor: theme.border,
              },
            ]}
          >
            {modalRecording ? (
              <>
                <View style={[styles.modalHeader, { flexDirection: rowDir }]}>
                  <Text
                    style={[
                      styles.modalCourse,
                      {
                        color: resolveCourseColor(modalRecording.courseId),
                        textAlign,
                      },
                    ]}
                    numberOfLines={1}
                  >
                    {resolveCourseName(
                      modalRecording.courseId,
                      modalRecording.courseName
                    )}
                  </Text>
                  <Pressable
                    onPress={() => setModalRecording(null)}
                    hitSlop={8}
                  >
                    <CloseIcon size={18} color={theme.textSecondary} />
                  </Pressable>
                </View>

                <Text
                  style={[styles.modalTitle, { color: theme.text, textAlign }]}
                >
                  {modalRecording.title}
                </Text>

                <View style={[styles.metaRow, { flexDirection: rowDir }]}>
                  {modalRecording.host ? (
                    <View
                      style={[
                        styles.metaChip,
                        {
                          backgroundColor: theme.background,
                          borderColor: theme.border,
                          flexDirection: rowDir,
                        },
                      ]}
                    >
                      <UserIcon size={11} color={theme.textSecondary} />
                      <Text
                        style={[
                          styles.metaChipText,
                          { color: theme.textSecondary },
                        ]}
                      >
                        {modalRecording.host}
                      </Text>
                    </View>
                  ) : null}
                  {modalRecording.publishedDate ? (
                    <View
                      style={[
                        styles.metaChip,
                        {
                          backgroundColor: theme.background,
                          borderColor: theme.border,
                          flexDirection: rowDir,
                        },
                      ]}
                    >
                      <CalendarIcon size={11} color={theme.textSecondary} />
                      <Text
                        style={[
                          styles.metaChipText,
                          { color: theme.textSecondary },
                        ]}
                      >
                        {modalRecording.publishedDate}
                      </Text>
                    </View>
                  ) : null}
                </View>

                <View style={[styles.modalActions, { flexDirection: rowDir }]}>
                  <Pressable
                    onPress={() => void toggleRecordingWatched(modalRecording.id)}
                    style={[
                      styles.actionBtn,
                      {
                        backgroundColor: watchedSet.has(modalRecording.id)
                          ? withHexAlpha(
                              theme.secondary,
                              '1A',
                              theme.backgroundSelected
                            )
                          : theme.background,
                        borderColor: watchedSet.has(modalRecording.id)
                          ? theme.secondary
                          : theme.border,
                        flexDirection: rowDir,
                      },
                    ]}
                  >
                    <CheckIcon
                      size={13}
                      color={
                        watchedSet.has(modalRecording.id)
                          ? theme.secondary
                          : theme.text
                      }
                    />
                    <Text
                      style={[
                        styles.actionBtnText,
                        {
                          color: watchedSet.has(modalRecording.id)
                            ? theme.secondary
                            : theme.text,
                        },
                      ]}
                    >
                      {watchedSet.has(modalRecording.id)
                        ? t('mark_unwatched')
                        : t('mark_watched')}
                    </Text>
                  </Pressable>

                  {modalRecording.recordingUrl ? (
                    <Pressable
                      onPress={() => {
                        const url = modalRecording.recordingUrl;
                        setModalRecording(null);
                        void openMoodleUrl(url);
                      }}
                      style={[
                        styles.watchBtn,
                        { backgroundColor: theme.primary, flexDirection: rowDir },
                      ]}
                    >
                      <VideoIcon size={13} color={theme.onPrimary} />
                      <Text style={[styles.watchBtnText, { color: theme.onPrimary }]}>
                        {t('watch_recording')}
                      </Text>
                      <ExternalLinkIcon size={11} color={theme.onPrimary} />
                    </Pressable>
                  ) : null}
                </View>
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Assignment Detail Sheet when tapping an overlaid assignment in Calendar */}
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

      <SsoWebViewModal
        visible={panoptoSsoVisible}
        mode="panopto"
        onClose={() => setPanoptoSsoVisible(false)}
        onPanoptoSuccess={async () => {
          setPanoptoSsoVisible(false);
          await updateSetting('panoptoEnabled', true);
          triggerSync({ manual: true }).catch(() => {});
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
  disabledContainer: {
    flex: 1,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledCard: {
    width: '100%',
    maxWidth: 480,
    borderRadius: 20,
    borderWidth: 1,
    padding: 28,
    alignItems: 'center',
    gap: 12,
  },
  disabledIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  betaPill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  betaPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  disabledTitle: {
    fontSize: 19,
    fontWeight: '800',
    textAlign: 'center',
  },
  disabledDesc: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  enablePanoptoBtn: {
    marginTop: 6,
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 12,
    alignItems: 'center',
    gap: 8,
  },
  enablePanoptoBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  headerBar: {
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
  },
  warningBanner: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 10,
  },
  warningBannerTop: {
    alignItems: 'flex-start',
    gap: 8,
  },
  warningBannerText: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: '500',
  },
  warningSsoBtn: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    alignItems: 'center',
    gap: 6,
  },
  warningSsoBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  headerTitleGroup: {
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
  },
  betaPillSmall: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  betaPillSmallText: {
    fontSize: 11,
    fontWeight: '700',
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
  pillsRow: {
    gap: 8,
    paddingVertical: 2,
  },
  courseFilterPill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
    alignItems: 'center',
    gap: 6,
    maxWidth: 220,
  },
  courseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  courseFilterPillText: {
    fontSize: 12,
    fontWeight: '700',
    flexShrink: 1,
  },
  filterChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 13,
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
    padding: 13,
    gap: 9,
  },
  cardTopRow: {
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  cardBadgesGroup: {
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
    alignItems: 'center',
    gap: 5,
    maxWidth: '100%',
  },
  courseChipText: {
    fontSize: 12,
    fontWeight: '700',
    flexShrink: 1,
  },
  typeBadge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  typeBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  hiddenBadge: {
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  hiddenBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  iconActionBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 21,
  },
  metaRow: {
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  metaChip: {
    borderRadius: 7,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignItems: 'center',
    gap: 4,
    maxWidth: '100%',
  },
  metaChipText: {
    fontSize: 11,
    fontWeight: '600',
    flexShrink: 1,
  },
  actionsRow: {
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  actionBtn: {
    borderRadius: 9,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
    alignItems: 'center',
    gap: 5,
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  watchBtn: {
    borderRadius: 9,
    paddingHorizontal: 11,
    paddingVertical: 7,
    alignItems: 'center',
    gap: 5,
  },
  watchBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  emptyCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 28,
    alignItems: 'center',
    gap: 8,
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCard: {
    width: '100%',
    maxWidth: 440,
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
    gap: 12,
  },
  modalHeader: {
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  modalCourse: {
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 22,
  },
  modalActions: {
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
});
