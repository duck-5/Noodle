import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
  CourseFolder,
  CourseFolderFile,
  CourseLink,
  CoursePanoptoStaffEntry,
  CourseSection,
  CourseStaffMember,
  PanoptoRecording,
  PanoptoRecordingType,
  UnifiedCourse,
  ZoomMeeting,
  aggregateUnifiedCourseItems,
  buildPanoptoFolderUrl,
  calculateGradesSummary,
  cleanCourseDisplayName,
  collapseRecurringMeetings,
  doesRecordingMatchStaffEntries,
  extractPanoptoFolderId,
  formatFileSize,
  getZoomMeetingKey,
  hasGracePeriod,
  isActivityCompleted,
  isActivityHidden,
  isMoodleActivitySubmitted,
  isZoomJoinUrl,
  isZoomMeetingHidden,
  isZoomUrl,
  normalizePersonName,
  partitionPanoptoRecordingsByTrackedHosts,
  transliterateHebrewNameToEnglish,
} from '@tautracker/moodle-client';
import { AssignmentDetailSheet } from '@/components/AssignmentDetailSheet';
import { MoodleFileRow } from '@/components/MoodleFileRow';
import {
  AnnouncementIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  ClockIcon,
  CourseIcon,
  ExternalLinkIcon,
  EyeIcon,
  EyeOffIcon,
  FolderIcon,
  LinkIcon,
  PlusIcon,
  QuizIcon,
  RefreshIcon,
  StarIcon,
  TrashIcon,
  VideoIcon,
  ZipIcon,
} from '@/components/icons/NoodleIcons';
import { SpinningIcon, animateLayout } from '@/components/ui/NoodleAnimations';
import { getReadableTextColor } from '@/constants/theme';
import { useAppState, useSyncProgress } from '@/hooks/use-app-state';
import { usePreferences } from '@/hooks/use-preferences';
import { useResponsiveLayout } from '@/hooks/use-responsive-layout';
import {
  formatGracePeriodText,
  formatShortDate,
  formatTimeHM,
  getDueTextAndClass,
  getZoomLiveStatus,
} from '@/services/dateUtils';
import {
  type FileDownloadAction,
  downloadMoodleFile,
  downloadMoodleFolderZip,
  isFileCachedLocally,
  openMoodleFile,
  shareMoodleFile,
} from '@/services/fileDownloadService';
import { stripHtmlToPlainText } from '@/services/htmlUtils';
import { openMoodleUrl } from '@/services/moodleLink';

type PhoneSegmentTab = 'content' | 'assignments' | 'media';

interface GroupedSectionBucket {
  key: string;
  displayTitle: string;
  sectionId?: number;
  parentSectionId?: number | null;
  sectionUrl?: string;
  summaryText: string;
  files: CourseFile[];
  assignments: Assignment[];
  folders: CourseFolder[];
  links: CourseLink[];
}

function extractOriginUrl(rawUrl?: string | null): string | undefined {
  if (!rawUrl) return undefined;
  try {
    const parsed = new URL(rawUrl);
    return parsed.origin;
  } catch {
    return undefined;
  }
}

export default function CourseDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const rawIdParam = Array.isArray(params.id) ? params.id[0] : params.id;
  const numericId = Number(rawIdParam);

  const { isLandscapeTablet } = useResponsiveLayout();
  const { theme, language, isRtl, t } = usePreferences();
  const { openSyncWindow } = useSyncProgress();
  const {
    syncResult,
    enrolledCourses,
    groupedCourses,
    settings,
    coursesColorMap,
    coursesCustomNames,
    hiddenAssignments,
    completedAssignments,
    uncompletedAssignments,
    hiddenZoomMeetings,
    watchedRecordings,
    hiddenRecordings,
    coursesPanoptoStaff,
    coursesPanoptoMap,
    isSyncing,
    triggerSync,
    toggleAssignmentDone,
    toggleAssignmentHidden,
    bulkSetCourseAssignmentsHidden,
    toggleZoomHidden,
    bulkSetCourseZoomHidden,
    toggleRecordingWatched,
    toggleRecordingHidden,
    toggleTrackedHost,
    saveCoursePanoptoStaff,
    saveCoursePanoptoFolder,
    updateSetting,
  } = useAppState();

  const isTwoColTablet = isLandscapeTablet;

  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const intervalId = setInterval(() => {
      setNowMs(Date.now());
    }, 60_000);
    return () => clearInterval(intervalId);
  }, []);

  const [phoneTab, setPhoneTab] = useState<PhoneSegmentTab>('content');
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);
  const [activeTopSectionId, setActiveTopSectionId] = useState<number | null>(null);
  const [activeSubSectionId, setActiveSubSectionId] = useState<number | null>(null);
  const [activeOrphanSectionKey, setActiveOrphanSectionKey] = useState<string | null>(null);
  const [collapsedSectionKeys, setCollapsedSectionKeys] = useState<Set<string>>(() => new Set());
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<number>>(() => new Set());
  const [expandedHiddenSectionKeys, setExpandedHiddenSectionKeys] = useState<Set<string>>(() => new Set());
  const [showHiddenAssignmentsTabDrawer, setShowHiddenAssignmentsTabDrawer] = useState<boolean>(false);
  const [showHiddenZoomDrawer, setShowHiddenZoomDrawer] = useState<boolean>(false);
  const [showHiddenPanoptoDrawer, setShowHiddenPanoptoDrawer] = useState<boolean>(false);
  const [tabletZoomExpanded, setTabletZoomExpanded] = useState<boolean>(false);
  const [tabletPanoptoExpanded, setTabletPanoptoExpanded] = useState<boolean>(false);
  const [staffEditorOpen, setStaffEditorOpen] = useState<boolean>(false);
  const [newHostName, setNewHostName] = useState<string>('');
  const [newHostRole, setNewHostRole] = useState<PanoptoRecordingType>('Lecture');
  const [busyFiles, setBusyFiles] = useState<Record<string, FileDownloadAction>>({});
  const [downloadingFolderId, setDownloadingFolderId] = useState<number | null>(null);
  const [folderZipProgress, setFolderZipProgress] = useState<{ completed: number; total: number } | null>(null);
  const [fileCacheTick, setFileCacheTick] = useState<number>(0);

  // Resolve UnifiedCourse from groupedCourses, enrolledCourses, or syncResult
  const unifiedCourse = useMemo<UnifiedCourse | null>(() => {
    if (!Number.isFinite(numericId)) return null;

    const fromAcademic = groupedCourses.academicCourses.find(
      (u) => u.id === numericId || u.subCourses.some((s) => s.courseId === numericId)
    );
    if (fromAcademic) return fromAcademic;

    if (
      groupedCourses.administrativeUmbrella &&
      (groupedCourses.administrativeUmbrella.id === numericId ||
        groupedCourses.administrativeUmbrella.subCourses.some((s) => s.courseId === numericId))
    ) {
      return groupedCourses.administrativeUmbrella;
    }

    const rawCourse =
      enrolledCourses.find((c) => c.id === numericId) ||
      (syncResult.courses || []).find((c) => c.id === numericId);

    if (rawCourse) {
      return {
        id: rawCourse.id,
        courseCode: rawCourse.courseId || String(rawCourse.id),
        fullname: cleanCourseDisplayName(rawCourse.fullname) || rawCourse.fullname,
        shortname: rawCourse.shortname,
        semester: rawCourse.semester,
        year: rawCourse.year,
        subCourses: [
          {
            courseId: rawCourse.id,
            shortname: rawCourse.shortname,
            groupId: '00',
            fullname: rawCourse.fullname,
            isParentPortal: true,
          },
        ],
      };
    }

    // Fallback: synthesize if items exist in syncResult for this ID
    const fallbackName =
      syncResult.assignments.find((a) => a.courseId === numericId)?.courseName ||
      syncResult.files.find((f) => f.courseId === numericId)?.courseName ||
      syncResult.meetings.find((m) => m.courseId === numericId)?.courseName ||
      (syncResult.recordings || []).find((r) => r.courseId === numericId)?.courseName;

    if (fallbackName || syncResult.sections?.some((s) => s.courseId === numericId)) {
      return {
        id: numericId,
        courseCode: String(numericId),
        fullname: cleanCourseDisplayName(fallbackName || '') || fallbackName || `Course ${numericId}`,
        shortname: String(numericId),
        semester: 'Other',
        year: '',
        subCourses: [
          {
            courseId: numericId,
            shortname: String(numericId),
            groupId: '00',
            fullname: fallbackName || `Course ${numericId}`,
            isParentPortal: true,
          },
        ],
      };
    }

    return null;
  }, [numericId, groupedCourses, enrolledCourses, syncResult]);

  const aggregated = useMemo(() => {
    if (!unifiedCourse) {
      return {
        assignments: [] as Assignment[],
        files: [] as CourseFile[],
        meetings: [] as ZoomMeeting[],
        folders: [] as CourseFolder[],
        links: [] as CourseLink[],
        sections: [] as CourseSection[],
        announcements: [],
        recordings: [] as PanoptoRecording[],
        gradeSummary: undefined,
      };
    }
    return aggregateUnifiedCourseItems(unifiedCourse, syncResult);
  }, [unifiedCourse, syncResult]);

  const logicalCourseId = unifiedCourse?.id ?? numericId;
  const memberCourseIds = useMemo(() => {
    if (!unifiedCourse) return [numericId];
    return Array.from(new Set([unifiedCourse.id, ...unifiedCourse.subCourses.map((s) => s.courseId)]));
  }, [unifiedCourse, numericId]);

  const courseColor = useMemo(() => {
    for (const cid of memberCourseIds) {
      if (coursesColorMap[cid]) return coursesColorMap[cid];
    }
    return theme.primary;
  }, [memberCourseIds, coursesColorMap, theme.primary]);

  const courseDisplayName = useMemo(() => {
    for (const cid of memberCourseIds) {
      if (coursesCustomNames[cid]) return coursesCustomNames[cid];
    }
    if (unifiedCourse) {
      return cleanCourseDisplayName(unifiedCourse.fullname) || unifiedCourse.fullname;
    }
    return `Course ${numericId}`;
  }, [memberCourseIds, coursesCustomNames, unifiedCourse, numericId]);

  const courseBaseUrl = useMemo(() => {
    for (const cid of memberCourseIds) {
      const c =
        enrolledCourses.find((item) => item.id === cid) ||
        (syncResult.courses || []).find((item) => item.id === cid);
      if (c?.baseUrl) {
        return c.baseUrl.replace(/\/+$/, '');
      }
    }
    const candidateLink =
      aggregated.sections.find((s) => s.sectionUrl)?.sectionUrl ||
      aggregated.assignments.find((a) => a.link)?.link ||
      aggregated.files.find((f) => f.fileUrl)?.fileUrl ||
      aggregated.announcements[0]?.moodleUrl;
    return extractOriginUrl(candidateLink) || 'https://moodle.tau.ac.il';
  }, [memberCourseIds, enrolledCourses, syncResult.courses, aggregated]);

  const moodleCourseUrl = useMemo(() => {
    const positiveId =
      unifiedCourse && unifiedCourse.id > 0
        ? unifiedCourse.id
        : unifiedCourse?.subCourses.find((s) => s.courseId > 0)?.courseId ?? numericId;
    return `${courseBaseUrl}/course/view.php?id=${positiveId}`;
  }, [courseBaseUrl, unifiedCourse, numericId]);

  // Course GPA / Average calculation (aggregates across all member sub-courses)
  const courseGradeSummary = useMemo(() => {
    return calculateGradesSummary({
      assignments: aggregated.assignments,
      hiddenIdentifiers: hiddenAssignments,
      completedIdentifiers: completedAssignments,
      uncompletedIdentifiers: uncompletedAssignments,
    });
  }, [
    aggregated.assignments,
    hiddenAssignments,
    completedAssignments,
    uncompletedAssignments,
  ]);
  const courseAverage =
    courseGradeSummary.totalCalculatedItems > 0
      ? courseGradeSummary.overallGpa
      : undefined;

  // Panopto Folder override state synced with saved preferences
  const savedPanoptoFolder = useMemo(() => {
    for (const cid of memberCourseIds) {
      const val = coursesPanoptoMap[cid];
      if (val) return val;
    }
    return '';
  }, [memberCourseIds, coursesPanoptoMap]);

  const [panoptoFolderDraft, setPanoptoFolderDraft] = useState<{
    courseId: number;
    value: string;
  } | null>(null);
  const panoptoFolderInput =
    panoptoFolderDraft && panoptoFolderDraft.courseId === logicalCourseId
      ? panoptoFolderDraft.value
      : savedPanoptoFolder;

  // Course Panopto staff entries & Moodle staff
  const courseStaffEntries = useMemo<CoursePanoptoStaffEntry[]>(() => {
    const merged: CoursePanoptoStaffEntry[] = [];
    const seen = new Set<string>();
    for (const cid of memberCourseIds) {
      const list = coursesPanoptoStaff[cid];
      if (!Array.isArray(list)) continue;
      for (const entry of list) {
        const key = `${normalizePersonName(entry.panoptoName)}:${normalizePersonName(entry.moodleName || '')}`;
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(entry);
        }
      }
    }
    return merged;
  }, [memberCourseIds, coursesPanoptoStaff]);

  const moodleStaffMembers = useMemo<CourseStaffMember[]>(() => {
    const staffMap = syncResult.courseStaff || {};
    const out: CourseStaffMember[] = [];
    const seen = new Set<string>();
    for (const cid of memberCourseIds) {
      const members = staffMap[cid];
      if (!Array.isArray(members)) continue;
      for (const m of members) {
        const k = normalizePersonName(m.fullName);
        if (k && !seen.has(k)) {
          seen.add(k);
          out.push(m);
        }
      }
    }
    return out;
  }, [memberCourseIds, syncResult.courseStaff]);

  // Section hierarchy & grouping (parity with Extension CourseDetailView)
  const {
    visibleTopSections,
    visibleSubSections,
    visibleOrphanBuckets,
    displayedBuckets,
    allVisibleBucketsCount,
    allCourseSections,
  } = useMemo(() => {
    const idsWithContent = new Set<number>();
    const namesWithContent = new Set<string>();

    aggregated.files.forEach((f) => {
      if (!f.folderId) {
        if (f.sectionId) idsWithContent.add(f.sectionId);
        if (f.sectionName) namesWithContent.add(f.sectionName);
      }
    });
    aggregated.assignments.forEach((a) => {
      if (a.sectionId) idsWithContent.add(a.sectionId);
      if (a.sectionName) namesWithContent.add(a.sectionName);
    });
    aggregated.folders.forEach((fld) => {
      if (fld.sectionId) idsWithContent.add(fld.sectionId);
      if (fld.sectionName) namesWithContent.add(fld.sectionName);
    });
    aggregated.links.forEach((lnk) => {
      if (lnk.sectionId) idsWithContent.add(lnk.sectionId);
      if (lnk.sectionName) namesWithContent.add(lnk.sectionName);
    });

    const filteredSecs = aggregated.sections
      .filter(
        (s) =>
          s.visible !== false ||
          idsWithContent.has(s.id) ||
          namesWithContent.has(s.name)
      )
      .sort((a, b) => a.sectionNumber - b.sectionNumber);

    const secIdSet = new Set(filteredSecs.map((s) => s.id));
    const rawTop = filteredSecs.filter((s) => {
      if (!s.parentSectionId || s.parentSectionId <= 0) return true;
      if (!secIdSet.has(s.parentSectionId)) return true;
      return s.level === 0;
    });
    const topSecs =
      rawTop.length <= 1 && filteredSecs.length > 1 ? filteredSecs : rawTop;

    const bucketMap = new Map<string, GroupedSectionBucket>();
    const keyById = new Map<number, string>();
    const keyByName = new Map<string, string>();

    const ensureBucket = (
      key: string,
      displayTitle?: string,
      sectionId?: number,
      parentSectionId?: number | null,
      sectionUrl?: string,
      summaryHtml?: string
    ): GroupedSectionBucket => {
      const title = displayTitle || key || (isRtl ? 'כללי' : 'General');
      let sKey = key || (isRtl ? 'כללי' : 'General');
      if (sectionId !== undefined && keyById.has(sectionId)) {
        sKey = keyById.get(sectionId)!;
      } else if (sectionId === undefined && keyByName.has(sKey)) {
        sKey = keyByName.get(sKey)!;
      } else if (
        sectionId !== undefined &&
        bucketMap.has(sKey) &&
        bucketMap.get(sKey)!.sectionId !== sectionId
      ) {
        sKey = `${sKey}__${sectionId}`;
      }

      if (!bucketMap.has(sKey)) {
        bucketMap.set(sKey, {
          key: sKey,
          displayTitle: title,
          sectionId,
          parentSectionId,
          sectionUrl,
          summaryText: stripHtmlToPlainText(summaryHtml),
          files: [],
          assignments: [],
          folders: [],
          links: [],
        });
      }
      if (sectionId !== undefined) keyById.set(sectionId, sKey);
      if (!keyByName.has(title)) keyByName.set(title, sKey);
      return bucketMap.get(sKey)!;
    };

    filteredSecs.forEach((sec) => {
      ensureBucket(
        sec.name,
        sec.name,
        sec.id,
        sec.parentSectionId,
        sec.sectionUrl,
        sec.summaryHtml
      );
    });

    aggregated.files.forEach((f) => {
      if (!f.folderId) {
        ensureBucket(
          f.sectionName || (isRtl ? 'כללי' : 'General'),
          f.sectionName,
          f.sectionId
        ).files.push(f);
      }
    });

    aggregated.assignments.forEach((a) => {
      ensureBucket(
        a.sectionName || (isRtl ? 'כללי' : 'General'),
        a.sectionName,
        a.sectionId
      ).assignments.push(a);
    });

    aggregated.folders.forEach((fld) => {
      ensureBucket(
        fld.sectionName || (isRtl ? 'כללי' : 'General'),
        fld.sectionName,
        fld.sectionId
      ).folders.push(fld);
    });

    aggregated.links.forEach((lnk) => {
      ensureBucket(
        lnk.sectionName || (isRtl ? 'כללי' : 'General'),
        lnk.sectionName,
        lnk.sectionId
      ).links.push(lnk);
    });

    const isBucketEmpty = (b: GroupedSectionBucket) =>
      b.files.length === 0 &&
      b.assignments.length === 0 &&
      b.folders.length === 0 &&
      b.links.length === 0 &&
      b.summaryText.length === 0;

    const sectionHasContent = (sec: CourseSection): boolean => {
      const k = keyById.get(sec.id) || sec.name;
      const b = bucketMap.get(k);
      if (b && !isBucketEmpty(b)) return true;
      return filteredSecs.some((child) => child.parentSectionId === sec.id && sectionHasContent(child));
    };

    const showEmpty = settings.showEmptySections;
    const visTop = showEmpty ? topSecs : topSecs.filter(sectionHasContent);

    const curSubs =
      activeTopSectionId !== null
        ? filteredSecs.filter((s) => s.parentSectionId === activeTopSectionId)
        : [];
    const visSubs = showEmpty ? curSubs : curSubs.filter(sectionHasContent);

    const coveredKeys = new Set<string>();
    filteredSecs.forEach((s) => {
      const k = keyById.get(s.id);
      if (k) coveredKeys.add(k);
      coveredKeys.add(s.name);
    });

    const allBuckets = Array.from(bucketMap.values());
    const orphanBuckets = allBuckets.filter((b) => !coveredKeys.has(b.key));
    const visOrphans = showEmpty ? orphanBuckets : orphanBuckets.filter((b) => !isBucketEmpty(b));
    const visibleAllBuckets = showEmpty ? allBuckets : allBuckets.filter((b) => !isBucketEmpty(b));

    let filteredDisplay = visibleAllBuckets;
    if (activeOrphanSectionKey !== null) {
      filteredDisplay = visibleAllBuckets.filter((b) => b.key === activeOrphanSectionKey);
    } else if (activeSubSectionId !== null) {
      const subKey = keyById.get(activeSubSectionId);
      filteredDisplay = visibleAllBuckets.filter(
        (b) => b.sectionId === activeSubSectionId || (subKey !== undefined && b.key === subKey)
      );
    } else if (activeTopSectionId !== null) {
      const childIds = new Set(curSubs.map((s) => s.id));
      const topKey = keyById.get(activeTopSectionId);
      filteredDisplay = visibleAllBuckets.filter(
        (b) =>
          b.sectionId === activeTopSectionId ||
          (b.sectionId !== undefined && childIds.has(b.sectionId)) ||
          (topKey !== undefined && b.key === topKey)
      );
    }

    return {
      visibleTopSections: visTop,
      visibleSubSections: visSubs,
      visibleOrphanBuckets: visOrphans,
      displayedBuckets: filteredDisplay,
      allVisibleBucketsCount: visibleAllBuckets.length,
      allCourseSections: filteredSecs,
    };
  }, [
    aggregated,
    settings.showEmptySections,
    activeTopSectionId,
    activeSubSectionId,
    activeOrphanSectionKey,
    isRtl,
  ]);

  // Sorted course assignments
  const sortedCourseAssignments = useMemo(() => {
    return [...aggregated.assignments].sort((a, b) => {
      if (!a.deadline && !b.deadline) return a.id - b.id;
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      const diff = new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
      if (diff !== 0) return diff;
      return a.id - b.id;
    });
  }, [aggregated.assignments]);

  const visibleAssignments = useMemo(
    () => sortedCourseAssignments.filter((a) => !isActivityHidden(a, hiddenAssignments)),
    [sortedCourseAssignments, hiddenAssignments]
  );
  const hiddenCourseAssignments = useMemo(
    () => sortedCourseAssignments.filter((a) => isActivityHidden(a, hiddenAssignments)),
    [sortedCourseAssignments, hiddenAssignments]
  );
  const allAssignmentsHidden =
    sortedCourseAssignments.length > 0 && visibleAssignments.length === 0;

  // Zoom meetings collapsed & partitioned
  const collapsedMeetings = useMemo(() => {
    const joinable = aggregated.meetings.filter(
      (m) => isZoomJoinUrl(m.meetingUrl, m.meetingNumber) || isZoomUrl(m.meetingUrl)
    );
    return collapseRecurringMeetings(joinable, new Date(nowMs));
  }, [aggregated.meetings, nowMs]);

  const visibleMeetings = useMemo(
    () => collapsedMeetings.filter((m) => !isZoomMeetingHidden(m, hiddenZoomMeetings)),
    [collapsedMeetings, hiddenZoomMeetings]
  );
  const hiddenMeetingsList = useMemo(
    () => collapsedMeetings.filter((m) => isZoomMeetingHidden(m, hiddenZoomMeetings)),
    [collapsedMeetings, hiddenZoomMeetings]
  );

  // Panopto recordings partitioned by tracked staff hosts & manual hidden list
  const partitionedRecordings = useMemo(
    () =>
      partitionPanoptoRecordingsByTrackedHosts(
        aggregated.recordings,
        courseStaffEntries,
        hiddenRecordings
      ),
    [aggregated.recordings, courseStaffEntries, hiddenRecordings]
  );

  const watchedRecSet = useMemo(() => new Set(watchedRecordings), [watchedRecordings]);
  const hiddenRecSet = useMemo(() => new Set(hiddenRecordings), [hiddenRecordings]);
  const watchedCountTarget = partitionedRecordings.isFilteringActive
    ? partitionedRecordings.visible
    : aggregated.recordings;
  const watchedRecordingsCount = watchedCountTarget.filter((r) => watchedRecSet.has(r.id)).length;

  const panoptoCourseUrl = useMemo(() => {
    const folderId =
      extractPanoptoFolderId(panoptoFolderInput) ||
      aggregated.recordings.find((r) => r.folderId)?.folderId ||
      extractPanoptoFolderId(aggregated.recordings.find((r) => r.folderUrl)?.folderUrl || '');
    if (folderId) {
      return buildPanoptoFolderUrl(folderId);
    }
    return (
      aggregated.recordings.find((r) => r.folderUrl)?.folderUrl ||
      'https://tau.cloud.panopto.eu/Panopto/Pages/Sessions/List.aspx'
    );
  }, [panoptoFolderInput, aggregated.recordings]);

  const detectedUnmappedHosts = useMemo(() => {
    const mappedNorms = new Set(
      courseStaffEntries
        .flatMap((e) => [
          normalizePersonName(e.panoptoName),
          e.moodleName ? normalizePersonName(e.moodleName) : '',
        ])
        .filter(Boolean)
    );
    const seen = new Set<string>();
    const out: string[] = [];
    for (const rec of aggregated.recordings) {
      const h = (rec.host || '').trim();
      const norm = normalizePersonName(h);
      if (h && norm && !mappedNorms.has(norm) && !seen.has(norm)) {
        seen.add(norm);
        out.push(h);
      }
    }
    return out;
  }, [aggregated.recordings, courseStaffEntries]);

  const availableMoodleStaff = useMemo(() => {
    const mappedNorms = new Set(
      courseStaffEntries
        .flatMap((e) => [
          normalizePersonName(e.panoptoName),
          e.moodleName ? normalizePersonName(e.moodleName) : '',
        ])
        .filter(Boolean)
    );
    return moodleStaffMembers.filter((m) => {
      const fn = normalizePersonName(m.fullName);
      const en = m.englishName ? normalizePersonName(m.englishName) : '';
      return !(fn && mappedNorms.has(fn)) && !(en && mappedNorms.has(en));
    });
  }, [moodleStaffMembers, courseStaffEntries]);

  // Handlers
  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)' as any);
    }
  }, [router]);

  const handleFileAction = useCallback(
    async (
      item: {
        key: string;
        id?: number;
        fileName: string;
        fileUrl: string;
        mimeType?: string;
        fileSize?: number;
      },
      action: FileDownloadAction
    ) => {
      if (!item.fileUrl || busyFiles[item.key]) return;
      setBusyFiles((prev) => ({ ...prev, [item.key]: action }));
      try {
        const attachment = {
          id: item.id,
          file_name: item.fileName,
          file_url: item.fileUrl,
          mime_type: item.mimeType,
          file_size: item.fileSize,
        };
        const res =
          action === 'open'
            ? await openMoodleFile(attachment)
            : action === 'share'
              ? await shareMoodleFile(attachment)
              : await downloadMoodleFile(attachment);
        setFileCacheTick((c) => c + 1);
        if (!res.success) {
          const msg =
            res.error === 'NO_VIEWER_INSTALLED'
              ? t('no_viewer_installed')
              : res.error || (isRtl ? 'לא ניתן להוריד את הקובץ.' : 'Could not download the file.');
          Alert.alert(isRtl ? 'שגיאה בהורדה' : 'Download Failed', msg);
        } else if (action === 'download' && res.savedToDownloads) {
          Alert.alert(
            t('saved_to_downloads_title'),
            t('saved_to_downloads_desc', { name: res.fileName || item.fileName })
          );
        }
      } finally {
        setBusyFiles((prev) => {
          const next = { ...prev };
          delete next[item.key];
          return next;
        });
      }
    },
    [busyFiles, isRtl, t]
  );

  const handleDownloadFolderZip = useCallback(
    async (folder: CourseFolder) => {
      if (downloadingFolderId !== null || folder.files.length === 0) return;
      setDownloadingFolderId(folder.id);
      setFolderZipProgress({ completed: 0, total: folder.files.length });
      try {
        const res = await downloadMoodleFolderZip(folder, (completed, total) => {
          setFolderZipProgress({ completed, total });
        });
        if (!res.success) {
          Alert.alert(
            isRtl ? 'שגיאה בהורדת התיקייה' : 'Folder Download Failed',
            res.error || (isRtl ? 'לא ניתן ליצור קובץ ZIP.' : 'Could not prepare ZIP archive.')
          );
        } else if (res.savedToDownloads) {
          Alert.alert(
            t('saved_to_downloads_title'),
            t('saved_to_downloads_desc', { name: res.fileName || folder.name })
          );
        }
      } finally {
        setDownloadingFolderId(null);
        setFolderZipProgress(null);
      }
    },
    [downloadingFolderId, isRtl, t]
  );

  const toggleSectionCollapsed = useCallback((secKey: string) => {
    animateLayout();
    setCollapsedSectionKeys((prev) => {
      const next = new Set(prev);
      if (next.has(secKey)) next.delete(secKey);
      else next.add(secKey);
      return next;
    });
  }, []);

  const toggleAllSectionsCollapsed = useCallback(() => {
    animateLayout();
    const allCollapsed =
      displayedBuckets.length > 0 &&
      displayedBuckets.every((b) => collapsedSectionKeys.has(b.key));
    if (allCollapsed) {
      setCollapsedSectionKeys(new Set());
    } else {
      setCollapsedSectionKeys(new Set(displayedBuckets.map((b) => b.key)));
    }
  }, [displayedBuckets, collapsedSectionKeys]);

  const toggleFolderCollapsed = useCallback((folderId: number) => {
    animateLayout();
    setCollapsedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }, []);

  const toggleHiddenSectionDrawer = useCallback((secKey: string) => {
    animateLayout();
    setExpandedHiddenSectionKeys((prev) => {
      const next = new Set(prev);
      if (next.has(secKey)) next.delete(secKey);
      else next.add(secKey);
      return next;
    });
  }, []);

  const handleAddStaffEntry = useCallback(
    async (panoptoName: string, role: PanoptoRecordingType, moodleName?: string) => {
      const trimmed = panoptoName.trim();
      if (!trimmed) return;
      const norm = normalizePersonName(trimmed);
      const existsIdx = courseStaffEntries.findIndex(
        (e) =>
          (norm && normalizePersonName(e.panoptoName) === norm) ||
          (moodleName && e.moodleName && normalizePersonName(e.moodleName) === normalizePersonName(moodleName))
      );
      const nextEntry: CoursePanoptoStaffEntry = {
        ...(moodleName ? { moodleName } : {}),
        panoptoName: trimmed,
        role,
      };
      const nextList =
        existsIdx >= 0
          ? courseStaffEntries.map((item, idx) => (idx === existsIdx ? nextEntry : item))
          : [...courseStaffEntries, nextEntry];
      await saveCoursePanoptoStaff(logicalCourseId, nextList);
    },
    [courseStaffEntries, logicalCourseId, saveCoursePanoptoStaff]
  );

  const handleRemoveStaffEntry = useCallback(
    async (idx: number) => {
      const nextList = courseStaffEntries.filter((_, i) => i !== idx);
      await saveCoursePanoptoStaff(logicalCourseId, nextList);
    },
    [courseStaffEntries, logicalCourseId, saveCoursePanoptoStaff]
  );

  const handleToggleStaffRole = useCallback(
    async (idx: number, role: PanoptoRecordingType) => {
      const nextList = courseStaffEntries.map((entry, i) =>
        i === idx ? { ...entry, role } : entry
      );
      await saveCoursePanoptoStaff(logicalCourseId, nextList);
    },
    [courseStaffEntries, logicalCourseId, saveCoursePanoptoStaff]
  );

  const rowDir = isRtl ? 'row-reverse' : 'row';
  const textAlign = isRtl ? 'right' : 'left';

  const getStatusBadgeColors = (badgeClass: string) => {
    if (badgeClass === 'badge-success') {
      return { bg: `${theme.secondary}22`, border: `${theme.secondary}55`, text: theme.secondary };
    }
    if (badgeClass === 'badge-warning') {
      return { bg: `${theme.warning}22`, border: `${theme.warning}55`, text: theme.warning };
    }
    if (badgeClass === 'badge-danger') {
      return { bg: `${theme.danger}22`, border: `${theme.danger}55`, text: theme.danger };
    }
    return { bg: theme.backgroundSelected, border: theme.border, text: theme.textSecondary };
  };

  const renderAssignmentItemCard = (a: Assignment, isHiddenRow = false) => {
    const uid = a.uid || `${a.activityType || 'assign'}:${a.id}`;
    const isCompleted = isActivityCompleted(a, completedAssignments, uncompletedAssignments);
    const isSubmitted = isMoodleActivitySubmitted(a);
    const isQuiz = a.activityType === 'quiz';
    const typeAccent = isQuiz ? '#8b5cf6' : theme.primary;
    const { deadlineText, badgeClass } = getDueTextAndClass(
      a.deadline,
      language,
      settings.dueDateGreenDays,
      settings.dueDateYellowDays,
      false,
      isCompleted ? a.status : undefined
    );
    const statusColors = getStatusBadgeColors(badgeClass);
    const showGrace = hasGracePeriod(a);
    const feedbackPlain = stripHtmlToPlainText(a.feedback);

    return (
      <Pressable
        key={`${uid}-${isHiddenRow ? 'hid' : 'vis'}`}
        onPress={() => setSelectedAssignment(a)}
        style={({ pressed }) => [
          styles.assignCard,
          {
            backgroundColor: theme.background,
            borderColor: theme.border,
            borderLeftWidth: isRtl ? 1 : 3,
            borderRightWidth: isRtl ? 3 : 1,
            borderLeftColor: isRtl
              ? theme.border
              : isCompleted
                ? theme.secondary
                : courseColor,
            borderRightColor: isRtl
              ? isCompleted
                ? theme.secondary
                : courseColor
              : theme.border,
            opacity: pressed ? 0.78 : isHiddenRow ? 0.72 : 1,
          },
        ]}
      >
        <View style={[styles.assignMetaRow, { flexDirection: rowDir }]}>
          <View
            style={[
              styles.tagPill,
              {
                backgroundColor: `${typeAccent}18`,
                borderColor: `${typeAccent}40`,
                flexDirection: rowDir,
              },
            ]}
          >
            {isQuiz ? (
              <QuizIcon size={12} color={typeAccent} />
            ) : (
              <CourseIcon size={12} color={typeAccent} />
            )}
            <Text style={[styles.tagPillText, { color: typeAccent }]}>
              {isQuiz
                ? t('quiz_label')
                : isRtl
                  ? 'מטלה'
                  : 'Assignment'}
            </Text>
          </View>

          {a.timeLimitSeconds ? (
            <View
              style={[
                styles.tagPill,
                {
                  backgroundColor: `${typeAccent}14`,
                  borderColor: `${typeAccent}33`,
                  flexDirection: rowDir,
                },
              ]}
            >
              <ClockIcon size={11} color={typeAccent} />
              <Text style={[styles.tagPillText, { color: typeAccent }]}>
                {t('time_limit_minutes', { minutes: Math.round(a.timeLimitSeconds / 60) })}
              </Text>
            </View>
          ) : null}

          {a.isBonus ? (
            <View
              style={[
                styles.tagPill,
                {
                  backgroundColor: `${theme.warning}20`,
                  borderColor: `${theme.warning}50`,
                  flexDirection: rowDir,
                },
              ]}
            >
              <StarIcon size={11} color={theme.warning} />
              <Text style={[styles.tagPillText, { color: theme.warning }]}>
                {t('grades_bonus_label')}
              </Text>
            </View>
          ) : null}

          {a.isLateSubmissionBox ? (
            <View
              style={[
                styles.tagPill,
                {
                  backgroundColor: `${theme.warning}1c`,
                  borderColor: `${theme.warning}44`,
                  flexDirection: rowDir,
                },
              ]}
            >
              <ClockIcon size={11} color={theme.warning} />
              <Text style={[styles.tagPillText, { color: theme.warning }]}>
                {t('late_box_label')}
              </Text>
            </View>
          ) : null}

          {a.status === 'Submitted' && isCompleted ? (
            <View
              style={[
                styles.tagPill,
                {
                  backgroundColor: `${theme.secondary}20`,
                  borderColor: `${theme.secondary}55`,
                },
              ]}
            >
              <Text style={[styles.tagPillText, { color: theme.secondary }]}>
                {t('submitted_badge')}
              </Text>
            </View>
          ) : isCompleted ? (
            <View
              style={[
                styles.tagPill,
                {
                  backgroundColor: `${theme.secondary}20`,
                  borderColor: `${theme.secondary}55`,
                },
              ]}
            >
              <Text style={[styles.tagPillText, { color: theme.secondary }]}>
                {t('marked_as_done')}
              </Text>
            </View>
          ) : (
            <>
              {(a.status === 'Submitted' || isSubmitted) ? (
                <View
                  style={[
                    styles.tagPill,
                    {
                      backgroundColor: `${theme.warning}20`,
                      borderColor: `${theme.warning}55`,
                    },
                  ]}
                >
                  <Text style={[styles.tagPillText, { color: theme.warning }]}>
                    {t('submitted_marked_todo')}
                  </Text>
                </View>
              ) : null}
              <View
                style={[
                  styles.tagPill,
                  {
                    backgroundColor: statusColors.bg,
                    borderColor: statusColors.border,
                    flexDirection: rowDir,
                  },
                ]}
              >
                <Text style={[styles.tagPillText, { color: statusColors.text }]}>
                  {deadlineText}
                </Text>
                {showGrace ? <ClockIcon size={11} color={statusColors.text} /> : null}
              </View>
            </>
          )}
        </View>

        <Text
          style={[
            styles.assignTitle,
            { color: theme.text, textAlign, writingDirection: 'auto' },
          ]}
        >
          {a.name}
        </Text>

        {showGrace && a.cutoffDate ? (
          <View style={[styles.graceRow, { flexDirection: rowDir }]}>
            <ClockIcon size={12} color={theme.textSecondary} />
            <Text style={[styles.graceText, { color: theme.textSecondary, textAlign }]}>
              {formatGracePeriodText(a.cutoffDate, language)}
            </Text>
          </View>
        ) : null}

        {a.grade !== null && a.grade !== undefined ? (
          <Text style={[styles.assignGradeLine, { color: theme.secondary, textAlign }]}>
            {t('grade_label')}: {a.grade} / {a.gradeMax ?? 100}
          </Text>
        ) : null}

        {feedbackPlain ? (
          <Text
            numberOfLines={2}
            style={[
              styles.assignFeedbackLine,
              { color: theme.textSecondary, textAlign, writingDirection: 'auto' },
            ]}
          >
            {t('grader_feedback')}: {feedbackPlain}
          </Text>
        ) : null}

        {/* Quick actions row */}
        <View style={[styles.assignQuickActions, { flexDirection: rowDir }]}>
          <Pressable
            onPress={(ev) => {
              ev.stopPropagation();
              toggleAssignmentDone(uid).catch(() => {});
            }}
            style={({ pressed }) => [
              styles.smallActionBtn,
              {
                backgroundColor: isCompleted ? `${theme.secondary}20` : theme.backgroundElement,
                borderColor: isCompleted ? theme.secondary : theme.border,
                flexDirection: rowDir,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <CheckIcon size={12} color={isCompleted ? theme.secondary : theme.text} />
            <Text
              style={[
                styles.smallActionBtnText,
                { color: isCompleted ? theme.secondary : theme.text },
              ]}
            >
              {isCompleted ? t('unmark_completed') : t('mark_completed')}
            </Text>
          </Pressable>

          <Pressable
            onPress={(ev) => {
              ev.stopPropagation();
              toggleAssignmentHidden(uid).catch(() => {});
            }}
            style={({ pressed }) => [
              styles.smallActionBtn,
              {
                backgroundColor: theme.backgroundElement,
                borderColor: theme.border,
                flexDirection: rowDir,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            {isHiddenRow ? (
              <EyeIcon size={12} color={theme.primary} />
            ) : (
              <TrashIcon size={12} color={theme.textSecondary} />
            )}
            <Text
              style={[
                styles.smallActionBtnText,
                { color: isHiddenRow ? theme.primary : theme.textSecondary },
              ]}
            >
              {isHiddenRow ? t('unhide_assignment') : t('hide_assignment')}
            </Text>
          </Pressable>

          {!isCompleted && isSubmitted ? (
            <Text style={[styles.subtleTag, { color: theme.primary }]}>
              {t('submitted_tag')}
            </Text>
          ) : null}
        </View>
      </Pressable>
    );
  };

  const renderFileRow = (
    item: {
      key: string;
      id?: number;
      fileName: string;
      fileUrl: string;
      mimeType?: string;
      fileSize?: number;
    }
  ) => {
    void fileCacheTick;
    return (
      <MoodleFileRow
        key={item.key}
        fileName={item.fileName}
        fileSize={item.fileSize}
        colors={theme}
        isRtl={isRtl}
        isCached={isFileCachedLocally(item.fileName, item.fileUrl)}
        busyAction={busyFiles[item.key] ?? null}
        style={{ backgroundColor: theme.background }}
        onOpen={() => void handleFileAction(item, 'open')}
        onDownload={() => void handleFileAction(item, 'download')}
        onShare={() => void handleFileAction(item, 'share')}
      />
    );
  };

  const renderFolderCard = (folder: CourseFolder) => {
    const isExpanded = !collapsedFolderIds.has(folder.id);
    const isZipping = downloadingFolderId === folder.id;
    const files = folder.files || [];
    const rootFiles = files.filter(
      (f) => !f.relativePath || f.relativePath === '' || f.relativePath === '/'
    );
    const subfolderMap = new Map<string, CourseFolderFile[]>();
    files.forEach((f) => {
      const cleanRel = (f.relativePath || '').replace(/^\/+|\/+$/g, '');
      if (cleanRel) {
        if (!subfolderMap.has(cleanRel)) subfolderMap.set(cleanRel, []);
        subfolderMap.get(cleanRel)!.push(f);
      }
    });
    const subfolders = Array.from(subfolderMap.entries()).sort(([a], [b]) => a.localeCompare(b));
    const folderDesc = stripHtmlToPlainText(folder.descriptionHtml);

    return (
      <View
        key={`folder-${folder.id}`}
        style={[
          styles.folderCard,
          { backgroundColor: theme.background, borderColor: theme.border },
        ]}
      >
        <Pressable
          onPress={() => {
            if (files.length > 0) toggleFolderCollapsed(folder.id);
          }}
          style={[
            styles.folderHeader,
            {
              flexDirection: rowDir,
              borderBottomWidth: isExpanded && files.length > 0 ? StyleSheet.hairlineWidth : 0,
              borderBottomColor: theme.border,
            },
          ]}
        >
          <View style={[styles.folderHeaderLeft, { flexDirection: rowDir }]}>
            <FolderIcon size={18} color={courseColor} />
            <View style={{ flex: 1 }}>
              <Text
                style={[
                  styles.folderTitle,
                  { color: theme.text, textAlign, writingDirection: 'auto' },
                ]}
              >
                {folder.name}
              </Text>
              <Text style={[styles.folderMetaText, { color: theme.textSecondary, textAlign }]}>
                {t('files_count', { count: files.length })}
                {folder.totalSize > 0 ? ` • ${formatFileSize(folder.totalSize)}` : ''}
              </Text>
            </View>
            {files.length > 0 ? (
              isExpanded ? (
                <ChevronUpIcon size={16} color={theme.textSecondary} />
              ) : (
                <ChevronDownIcon size={16} color={theme.textSecondary} />
              )
            ) : null}
          </View>
        </Pressable>

        {/* Folder action bar (Open in Moodle + Download ZIP) */}
        <View style={[styles.folderActionsBar, { flexDirection: rowDir }]}>
          <Pressable
            onPress={() => openMoodleUrl(folder.moodleUrl, courseBaseUrl)}
            style={({ pressed }) => [
              styles.smallActionBtn,
              {
                backgroundColor: theme.backgroundElement,
                borderColor: theme.border,
                flexDirection: rowDir,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <ExternalLinkIcon size={12} color={theme.primary} />
            <Text style={[styles.smallActionBtnText, { color: theme.primary }]}>
              {t('open_in_moodle')}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => handleDownloadFolderZip(folder)}
            disabled={isZipping || files.length === 0}
            style={({ pressed }) => [
              styles.smallActionBtn,
              {
                backgroundColor: `${theme.primary}18`,
                borderColor: `${theme.primary}44`,
                flexDirection: rowDir,
                opacity: pressed || files.length === 0 ? 0.6 : 1,
              },
            ]}
          >
            {isZipping ? (
              <ActivityIndicator size="small" color={theme.primary} />
            ) : (
              <ZipIcon size={13} color={theme.primary} />
            )}
            <Text style={[styles.smallActionBtnText, { color: theme.primary }]}>
              {isZipping
                ? `${t('downloading_zip')} (${folderZipProgress?.completed ?? 0}/${folderZipProgress?.total ?? files.length})`
                : t('download_zip')}
            </Text>
          </Pressable>
        </View>

        {isExpanded && (folderDesc || files.length > 0) ? (
          <View style={styles.folderBody}>
            {folderDesc ? (
              <Text
                style={[
                  styles.folderDesc,
                  { color: theme.textSecondary, textAlign, writingDirection: 'auto' },
                ]}
              >
                {folderDesc}
              </Text>
            ) : null}

            {rootFiles.map((f, fIdx) =>
              renderFileRow({
                key: `fld-${folder.id}-root-${fIdx}`,
                id: folder.id,
                fileName: f.fileName,
                fileUrl: f.fileUrl,
                mimeType: f.mimeType,
                fileSize: f.fileSize,
              })
            )}

            {subfolders.map(([subPath, subFiles]) => (
              <View
                key={`fld-${folder.id}-sub-${subPath}`}
                style={[
                  styles.subfolderGroup,
                  {
                    borderLeftWidth: isRtl ? 0 : 2,
                    borderRightWidth: isRtl ? 2 : 0,
                    borderLeftColor: isRtl ? 'transparent' : theme.border,
                    borderRightColor: isRtl ? theme.border : 'transparent',
                    paddingLeft: isRtl ? 0 : 10,
                    paddingRight: isRtl ? 10 : 0,
                  },
                ]}
              >
                <View style={[styles.subfolderHeader, { flexDirection: rowDir }]}>
                  <FolderIcon size={14} color={theme.primary} />
                  <Text
                    style={[
                      styles.subfolderTitle,
                      { color: theme.textSecondary, textAlign, writingDirection: 'auto' },
                    ]}
                  >
                    {subPath}/ ({subFiles.length})
                  </Text>
                </View>
                <View style={styles.subfolderFilesList}>
                  {subFiles.map((sf, sfIdx) =>
                    renderFileRow({
                      key: `fld-${folder.id}-sub-${subPath}-${sfIdx}`,
                      id: folder.id,
                      fileName: sf.fileName,
                      fileUrl: sf.fileUrl,
                      mimeType: sf.mimeType,
                      fileSize: sf.fileSize,
                    })
                  )}
                </View>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    );
  };

  const renderExternalLinkRow = (lnk: CourseLink) => {
    const renderKindIcon = () => {
      if (lnk.linkKind === 'drive') return <FolderIcon size={15} color={theme.primary} />;
      if (lnk.linkKind === 'zoom' || lnk.linkKind === 'panopto') {
        return <VideoIcon size={15} color={theme.primary} />;
      }
      return <LinkIcon size={15} color={theme.primary} />;
    };

    return (
      <Pressable
        key={`link-${lnk.id}`}
        onPress={() => openMoodleUrl(lnk.targetUrl || lnk.moodleUrl, courseBaseUrl)}
        style={({ pressed }) => [
          styles.linkRow,
          {
            backgroundColor: theme.background,
            borderColor: theme.border,
            flexDirection: rowDir,
            opacity: pressed ? 0.75 : 1,
          },
        ]}
      >
        <View style={[styles.linkRowLeft, { flexDirection: rowDir }]}>
          {renderKindIcon()}
          <Text
            style={[
              styles.linkRowTitle,
              { color: theme.text, textAlign, writingDirection: 'auto' },
            ]}
          >
            {lnk.name}
          </Text>
        </View>
        <ExternalLinkIcon size={14} color={theme.primary} />
      </Pressable>
    );
  };

  const renderZoomHubCard = (collapsibleOnTablet = false) => {
    void nowMs;
    const zoomLinkFallback = aggregated.links.find((l) => l.linkKind === 'zoom');
    const isExpanded = !collapsibleOnTablet || tabletZoomExpanded;

    const renderMeetingRow = (m: ZoomMeeting, idx: number, isHiddenRow: boolean) => {
      const liveStatus = getZoomLiveStatus(m.startTime);
      const meetingKey = getZoomMeetingKey(m);
      const dateStr = m.startTime ? formatShortDate(m.startTime, language) : '';
      const timeStr = m.startTime ? formatTimeHM(m.startTime, language) : '';
      const joinBg = liveStatus === 'active' ? theme.secondary : theme.primary;
      const joinFg =
        liveStatus === 'active'
          ? getReadableTextColor(theme.secondary)
          : theme.onPrimary;

      let statusLabel = '';
      let statusColor = theme.textSecondary;
      if (liveStatus === 'active') {
        statusLabel = t('live_now');
        statusColor = theme.secondary;
      } else if (liveStatus === 'upcoming') {
        statusLabel = isRtl ? 'קרוב' : 'Upcoming';
        statusColor = theme.primary;
      } else if (liveStatus === 'past') {
        statusLabel = isRtl ? 'הסתיים' : 'Finished';
        statusColor = theme.textSecondary;
      } else {
        statusLabel = isRtl ? 'חדר קבוע' : 'Permanent';
        statusColor = theme.textSecondary;
      }

      return (
        <View
          key={`${meetingKey}-${idx}`}
          style={[
            styles.mediaItemCard,
            {
              backgroundColor: theme.background,
              borderColor: liveStatus === 'active' ? theme.secondary : theme.border,
              borderLeftWidth: isRtl ? 1 : 3,
              borderRightWidth: isRtl ? 3 : 1,
              borderLeftColor: isRtl
                ? theme.border
                : liveStatus === 'active'
                  ? theme.secondary
                  : theme.border,
              borderRightColor: isRtl
                ? liveStatus === 'active'
                  ? theme.secondary
                  : theme.border
                : theme.border,
              opacity: isHiddenRow ? 0.68 : 1,
            },
          ]}
        >
          <View style={[styles.mediaTopRow, { flexDirection: rowDir }]}>
            <View
              style={[
                styles.statusBadge,
                {
                  backgroundColor: `${statusColor}1c`,
                  borderColor: `${statusColor}44`,
                  flexDirection: rowDir,
                },
              ]}
            >
              {liveStatus === 'active' ? (
                <View style={[styles.liveDot, { backgroundColor: theme.secondary }]} />
              ) : null}
              <Text style={[styles.statusBadgeText, { color: statusColor }]}>
                {statusLabel}
              </Text>
            </View>
            {dateStr || timeStr ? (
              <Text style={[styles.mediaDateText, { color: theme.textSecondary }]}>
                {[dateStr, timeStr].filter(Boolean).join(' • ')}
              </Text>
            ) : null}
          </View>

          <Text
            style={[
              styles.mediaTitle,
              { color: theme.text, textAlign, writingDirection: 'auto' },
            ]}
          >
            {m.title}
          </Text>

          {m.sectionName || m.meetingNumber || m.password ? (
            <Text style={[styles.mediaSubText, { color: theme.textSecondary, textAlign }]}>
              {[
                m.sectionName,
                m.meetingNumber ? `ID: ${m.meetingNumber}` : '',
                m.password ? `Pass: ${m.password}` : '',
              ]
                .filter(Boolean)
                .join(' • ')}
            </Text>
          ) : null}

          <View style={[styles.mediaActionsRow, { flexDirection: rowDir }]}>
            <Pressable
              onPress={() => openMoodleUrl(m.meetingUrl, courseBaseUrl)}
              style={({ pressed }) => [
                styles.joinZoomBtn,
                { backgroundColor: joinBg, flexDirection: rowDir, opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <VideoIcon size={13} color={joinFg} />
              <Text style={[styles.joinZoomBtnText, { color: joinFg }]}>
                {t('join_zoom')}
              </Text>
              <ExternalLinkIcon size={12} color={joinFg} />
            </Pressable>

            <Pressable
              onPress={() => toggleZoomHidden(meetingKey).catch(() => {})}
              accessibilityRole="button"
              accessibilityLabel={isHiddenRow ? t('show_all') : t('hide_assignment')}
              style={({ pressed }) => [
                styles.iconToggleBtn,
                {
                  backgroundColor: theme.backgroundElement,
                  borderColor: theme.border,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              {isHiddenRow ? (
                <EyeOffIcon size={16} color={theme.textSecondary} />
              ) : (
                <EyeIcon size={16} color={theme.primary} />
              )}
            </Pressable>
          </View>
        </View>
      );
    };

    return (
      <View
        style={[
          styles.sectionCard,
          {
            backgroundColor: theme.backgroundElement,
            borderColor: theme.border,
            borderLeftWidth: isRtl ? 1 : 4,
            borderRightWidth: isRtl ? 4 : 1,
            borderLeftColor: isRtl ? theme.border : courseColor,
            borderRightColor: isRtl ? courseColor : theme.border,
          },
        ]}
      >
        <Pressable
          onPress={() => {
            if (collapsibleOnTablet) setTabletZoomExpanded((prev) => !prev);
          }}
          style={[styles.cardHeaderRow, { flexDirection: rowDir }]}
        >
          <View style={[styles.cardHeaderLeft, { flexDirection: rowDir }]}>
            <VideoIcon size={18} color={courseColor} />
            <Text style={[styles.cardHeaderTitle, { color: courseColor, textAlign }]}>
              {t('zoom_hub_title')} ({visibleMeetings.length}/{collapsedMeetings.length})
            </Text>
          </View>
          {collapsibleOnTablet ? (
            tabletZoomExpanded ? (
              <ChevronUpIcon size={18} color={theme.textSecondary} />
            ) : (
              <ChevronDownIcon size={18} color={theme.textSecondary} />
            )
          ) : null}
        </Pressable>

        {collapsedMeetings.length > 0 && isExpanded ? (
          <View style={[styles.bulkRow, { flexDirection: rowDir }]}>
            <Pressable
              onPress={() => bulkSetCourseZoomHidden(logicalCourseId, false).catch(() => {})}
              style={({ pressed }) => [
                styles.smallActionBtn,
                {
                  backgroundColor: theme.background,
                  borderColor: theme.border,
                  flexDirection: rowDir,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <EyeIcon size={12} color={theme.primary} />
              <Text style={[styles.smallActionBtnText, { color: theme.text }]}>
                {t('show_all')}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => bulkSetCourseZoomHidden(logicalCourseId, true).catch(() => {})}
              style={({ pressed }) => [
                styles.smallActionBtn,
                {
                  backgroundColor: theme.background,
                  borderColor: theme.border,
                  flexDirection: rowDir,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <EyeOffIcon size={12} color={theme.textSecondary} />
              <Text style={[styles.smallActionBtnText, { color: theme.textSecondary }]}>
                {t('hide_all')}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {isExpanded ? (
          <View style={styles.mediaListBody}>
            {collapsedMeetings.length === 0 ? (
              <View style={styles.emptyMiniBox}>
                <Text style={[styles.emptyMiniText, { color: theme.textSecondary, textAlign }]}>
                  {t('no_zoom_links')}
                </Text>
                {zoomLinkFallback ? (
                  <Pressable
                    onPress={() =>
                      openMoodleUrl(
                        zoomLinkFallback.targetUrl || zoomLinkFallback.moodleUrl,
                        courseBaseUrl
                      )
                    }
                    style={[
                      styles.smallActionBtn,
                      {
                        backgroundColor: theme.background,
                        borderColor: theme.border,
                        flexDirection: rowDir,
                        marginTop: 8,
                        alignSelf: isRtl ? 'flex-end' : 'flex-start',
                      },
                    ]}
                  >
                    <ExternalLinkIcon size={12} color={theme.primary} />
                    <Text style={[styles.smallActionBtnText, { color: theme.primary }]}>
                      {t('open_in_moodle')}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : (
              <>
                {visibleMeetings.map((m, idx) => renderMeetingRow(m, idx, false))}

                {hiddenMeetingsList.length > 0 ? (
                  <View style={styles.drawerWrapper}>
                    <Pressable
                      onPress={() => setShowHiddenZoomDrawer((v) => !v)}
                      style={({ pressed }) => [
                        styles.drawerToggleBtn,
                        {
                          backgroundColor: theme.background,
                          borderColor: theme.border,
                          flexDirection: rowDir,
                          opacity: pressed ? 0.75 : 1,
                        },
                      ]}
                    >
                      {showHiddenZoomDrawer ? (
                        <EyeIcon size={14} color={theme.primary} />
                      ) : (
                        <EyeOffIcon size={14} color={theme.textSecondary} />
                      )}
                      <Text style={[styles.drawerToggleText, { color: theme.text }]}>
                        {t('show_hidden_meetings')} ({hiddenMeetingsList.length})
                      </Text>
                      {showHiddenZoomDrawer ? (
                        <ChevronUpIcon size={14} color={theme.textSecondary} />
                      ) : (
                        <ChevronDownIcon size={14} color={theme.textSecondary} />
                      )}
                    </Pressable>
                    {showHiddenZoomDrawer ? (
                      <View style={styles.drawerContent}>
                        {hiddenMeetingsList.map((m, idx) => renderMeetingRow(m, idx, true))}
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </>
            )}
          </View>
        ) : null}
      </View>
    );
  };

  const renderPanoptoCard = (collapsibleOnTablet = false) => {
    if (!settings.panoptoEnabled && aggregated.recordings.length === 0) {
      return null;
    }

    const isExpanded = !collapsibleOnTablet || tabletPanoptoExpanded;

    const renderRecordingRow = (rec: PanoptoRecording, isHiddenRow: boolean) => {
      const isWatched = watchedRecSet.has(rec.id);
      const isManuallyHidden = hiddenRecSet.has(rec.id);
      const isRecitation = rec.type === 'Recitation';
      const isHostTracked =
        Boolean(rec.host) &&
        doesRecordingMatchStaffEntries({ host: rec.host }, courseStaffEntries);
      const durationMin =
        rec.durationSeconds && rec.durationSeconds > 0
          ? Math.round(rec.durationSeconds / 60)
          : null;

      return (
        <View
          key={`${rec.id}-${isHiddenRow ? 'hid' : 'vis'}`}
          style={[
            styles.mediaItemCard,
            {
              backgroundColor: theme.background,
              borderColor: theme.border,
              opacity: isHiddenRow ? 0.68 : isWatched ? 0.76 : 1,
            },
          ]}
        >
          <View style={[styles.mediaTopRow, { flexDirection: rowDir }]}>
            <View
              style={[
                styles.statusBadge,
                {
                  backgroundColor: isRecitation ? `${theme.secondary}1f` : `${theme.primary}1f`,
                  borderColor: isRecitation ? `${theme.secondary}44` : `${theme.primary}44`,
                  flexDirection: rowDir,
                },
              ]}
            >
              {isRecitation ? (
                <CourseIcon size={11} color={theme.secondary} />
              ) : (
                <VideoIcon size={11} color={theme.primary} />
              )}
              <Text
                style={[
                  styles.statusBadgeText,
                  { color: isRecitation ? theme.secondary : theme.primary },
                ]}
              >
                {isRecitation
                  ? isRtl
                    ? 'תרגול'
                    : 'Recitation'
                  : isRtl
                    ? 'הרצאה'
                    : 'Lecture'}
              </Text>
            </View>

            <View style={[styles.recMetaRight, { flexDirection: rowDir }]}>
              {rec.publishedDate ? (
                <Text style={[styles.mediaDateText, { color: theme.textSecondary }]}>
                  {rec.publishedDate}
                </Text>
              ) : null}
              {durationMin ? (
                <Text style={[styles.mediaDateText, { color: theme.textSecondary }]}>
                  {t('time_limit_minutes', { minutes: durationMin })}
                </Text>
              ) : null}
            </View>
          </View>

          <Text
            style={[
              styles.mediaTitle,
              { color: theme.text, textAlign, writingDirection: 'auto' },
            ]}
          >
            {rec.title}
          </Text>

          {rec.host ? (
            <View style={[styles.hostRow, { flexDirection: rowDir }]}>
              <Text style={[styles.mediaSubText, { color: theme.textSecondary }]}>
                {t('host_label')}: {rec.host}
              </Text>
              <Pressable
                onPress={() => toggleTrackedHost(logicalCourseId, rec.host!, rec.type).catch(() => {})}
                style={({ pressed }) => [
                  styles.hostTrackChip,
                  {
                    backgroundColor: isHostTracked ? `${theme.secondary}22` : theme.backgroundElement,
                    borderColor: isHostTracked ? theme.secondary : theme.border,
                    flexDirection: rowDir,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                {isHostTracked ? <CheckIcon size={11} color={theme.secondary} /> : null}
                <Text
                  style={[
                    styles.hostTrackChipText,
                    { color: isHostTracked ? theme.secondary : theme.textSecondary },
                  ]}
                >
                  {isHostTracked ? t('tracking_host') : t('track_this_host')}
                </Text>
              </Pressable>
            </View>
          ) : null}

          <View style={[styles.mediaActionsRow, { flexDirection: rowDir }]}>
            <Pressable
              onPress={() => toggleRecordingWatched(rec.id).catch(() => {})}
              style={({ pressed }) => [
                styles.smallActionBtn,
                {
                  backgroundColor: isWatched ? `${theme.secondary}20` : theme.backgroundElement,
                  borderColor: isWatched ? theme.secondary : theme.border,
                  flexDirection: rowDir,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <CheckIcon size={12} color={isWatched ? theme.secondary : theme.text} />
              <Text
                style={[
                  styles.smallActionBtnText,
                  { color: isWatched ? theme.secondary : theme.text },
                ]}
              >
                {isWatched ? t('mark_unwatched') : t('mark_watched')}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => openMoodleUrl(rec.recordingUrl)}
              style={({ pressed }) => [
                styles.smallActionBtn,
                {
                  backgroundColor: theme.primary,
                  borderColor: theme.primary,
                  flexDirection: rowDir,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <ExternalLinkIcon size={12} color="#ffffff" />
              <Text style={[styles.smallActionBtnText, { color: '#ffffff' }]}>
                {t('watch_recording')}
              </Text>
            </Pressable>

            {!isHiddenRow || isManuallyHidden ? (
              <Pressable
                onPress={() => toggleRecordingHidden(rec.id).catch(() => {})}
                style={({ pressed }) => [
                  styles.iconToggleBtn,
                  {
                    backgroundColor: theme.backgroundElement,
                    borderColor: theme.border,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                {isHiddenRow ? (
                  <EyeIcon size={15} color={theme.primary} />
                ) : (
                  <TrashIcon size={15} color={theme.textSecondary} />
                )}
              </Pressable>
            ) : null}
          </View>
        </View>
      );
    };

    return (
      <View
        style={[
          styles.sectionCard,
          {
            backgroundColor: theme.backgroundElement,
            borderColor: theme.border,
            borderLeftWidth: isRtl ? 1 : 4,
            borderRightWidth: isRtl ? 4 : 1,
            borderLeftColor: isRtl ? theme.border : courseColor,
            borderRightColor: isRtl ? courseColor : theme.border,
          },
        ]}
      >
        <Pressable
          onPress={() => {
            if (collapsibleOnTablet) setTabletPanoptoExpanded((prev) => !prev);
          }}
          style={[styles.cardHeaderRow, { flexDirection: rowDir }]}
        >
          <View style={[styles.cardHeaderLeft, { flexDirection: rowDir }]}>
            <VideoIcon size={18} color={courseColor} />
            <Text style={[styles.cardHeaderTitle, { color: courseColor, textAlign }]}>
              Panopto ({watchedRecordingsCount}/{watchedCountTarget.length})
            </Text>
          </View>
          {collapsibleOnTablet ? (
            tabletPanoptoExpanded ? (
              <ChevronUpIcon size={18} color={theme.textSecondary} />
            ) : (
              <ChevronDownIcon size={18} color={theme.textSecondary} />
            )
          ) : null}
        </Pressable>

        {isExpanded ? (
          <View style={styles.mediaListBody}>
            {/* Panopto Toolbar: Staff Hosts Toggle + Open Panopto */}
            <View style={[styles.bulkRow, { flexDirection: rowDir }]}>
              <Pressable
                onPress={() => setStaffEditorOpen((v) => !v)}
                style={({ pressed }) => [
                  styles.smallActionBtn,
                  {
                    backgroundColor: staffEditorOpen ? `${theme.primary}1a` : theme.background,
                    borderColor: staffEditorOpen ? theme.primary : theme.border,
                    flexDirection: rowDir,
                    opacity: pressed ? 0.75 : 1,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.smallActionBtnText,
                    { color: staffEditorOpen ? theme.primary : theme.text },
                  ]}
                >
                  {t('staff_hosts_title')} ({courseStaffEntries.length})
                </Text>
                {staffEditorOpen ? (
                  <ChevronUpIcon size={13} color={theme.primary} />
                ) : (
                  <ChevronDownIcon size={13} color={theme.textSecondary} />
                )}
              </Pressable>

              <Pressable
                onPress={() => openMoodleUrl(panoptoCourseUrl)}
                style={({ pressed }) => [
                  styles.smallActionBtn,
                  {
                    backgroundColor: theme.background,
                    borderColor: theme.border,
                    flexDirection: rowDir,
                    opacity: pressed ? 0.75 : 1,
                  },
                ]}
              >
                <ExternalLinkIcon size={12} color={theme.primary} />
                <Text style={[styles.smallActionBtnText, { color: theme.primary }]}>
                  Panopto
                </Text>
              </Pressable>
            </View>

            {/* Inline Staff Host Editor */}
            {staffEditorOpen ? (
              <View
                style={[
                  styles.staffEditorBox,
                  { backgroundColor: theme.background, borderColor: theme.border },
                ]}
              >
                <Text style={[styles.staffSectionLabel, { color: theme.text, textAlign }]}>
                  {t('staff_hosts_title')}
                </Text>

                {/* Moodle-discovered course staff quick add */}
                {availableMoodleStaff.length > 0 ? (
                  <View style={styles.staffSubBlock}>
                    <Text style={[styles.staffHelperLabel, { color: theme.textSecondary, textAlign }]}>
                      {isRtl ? 'סגל מהמודל (הוספה מהירה):' : 'Course staff from Moodle (tap to track):'}
                    </Text>
                    <View style={[styles.chipsWrap, { flexDirection: rowDir }]}>
                      {availableMoodleStaff.map((member, mIdx) => {
                        const suggestedEn =
                          member.englishName?.trim() ||
                          transliterateHebrewNameToEnglish(member.fullName).trim() ||
                          member.fullName;
                        return (
                          <Pressable
                            key={`mstaff-${mIdx}-${member.fullName}`}
                            onPress={() =>
                              handleAddStaffEntry(suggestedEn, member.role, member.fullName).catch(
                                () => {}
                              )
                            }
                            style={({ pressed }) => [
                              styles.quickHostChip,
                              {
                                backgroundColor: theme.backgroundElement,
                                borderColor: theme.border,
                                flexDirection: rowDir,
                                opacity: pressed ? 0.7 : 1,
                              },
                            ]}
                          >
                            <PlusIcon size={11} color={theme.primary} />
                            <Text style={[styles.quickHostChipText, { color: theme.text }]}>
                              {member.fullName}
                              {suggestedEn !== member.fullName ? ` (${suggestedEn})` : ''}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                ) : null}

                {/* Detected unmapped hosts from recordings */}
                {detectedUnmappedHosts.length > 0 ? (
                  <View style={styles.staffSubBlock}>
                    <Text style={[styles.staffHelperLabel, { color: theme.textSecondary, textAlign }]}>
                      {isRtl ? 'מארחים שזוהו בהקלטות:' : 'Detected hosts from recordings:'}
                    </Text>
                    {detectedUnmappedHosts.map((host) => (
                      <View
                        key={`dhost-${host}`}
                        style={[
                          styles.detectedHostRow,
                          {
                            borderColor: theme.border,
                            backgroundColor: theme.backgroundElement,
                            flexDirection: rowDir,
                          },
                        ]}
                      >
                        <Text style={[styles.detectedHostName, { color: theme.text }]}>{host}</Text>
                        <View style={[styles.detectedHostBtns, { flexDirection: rowDir }]}>
                          <Pressable
                            onPress={() => handleAddStaffEntry(host, 'Lecture').catch(() => {})}
                            style={[
                              styles.roleChipBtn,
                              { borderColor: theme.primary, backgroundColor: `${theme.primary}15` },
                            ]}
                          >
                            <Text style={[styles.roleChipBtnText, { color: theme.primary }]}>
                              + {isRtl ? 'הרצאה' : 'Lecture'}
                            </Text>
                          </Pressable>
                          <Pressable
                            onPress={() => handleAddStaffEntry(host, 'Recitation').catch(() => {})}
                            style={[
                              styles.roleChipBtn,
                              { borderColor: theme.secondary, backgroundColor: `${theme.secondary}15` },
                            ]}
                          >
                            <Text style={[styles.roleChipBtnText, { color: theme.secondary }]}>
                              + {isRtl ? 'תרגול' : 'Recitation'}
                            </Text>
                          </Pressable>
                        </View>
                      </View>
                    ))}
                  </View>
                ) : null}

                {/* Configured staff entries */}
                {courseStaffEntries.map((entry, idx) => (
                  <View
                    key={`entry-${idx}-${entry.panoptoName}`}
                    style={[
                      styles.configuredStaffRow,
                      {
                        borderColor: theme.border,
                        backgroundColor: theme.backgroundElement,
                        flexDirection: rowDir,
                      },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.configuredStaffName, { color: theme.text }]}>
                        {entry.panoptoName}
                      </Text>
                      {entry.moodleName && entry.moodleName !== entry.panoptoName ? (
                        <Text style={[styles.configuredStaffSub, { color: theme.textSecondary }]}>
                          {entry.moodleName}
                        </Text>
                      ) : null}
                    </View>
                    <View style={[styles.roleToggleGroup, { flexDirection: rowDir }]}>
                      <Pressable
                        onPress={() => handleToggleStaffRole(idx, 'Lecture').catch(() => {})}
                        style={[
                          styles.roleTogglePill,
                          {
                            backgroundColor:
                              entry.role === 'Lecture' ? theme.primary : theme.background,
                            borderColor: theme.border,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.roleTogglePillText,
                            { color: entry.role === 'Lecture' ? '#ffffff' : theme.textSecondary },
                          ]}
                        >
                          {isRtl ? 'הרצאה' : 'Lecture'}
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => handleToggleStaffRole(idx, 'Recitation').catch(() => {})}
                        style={[
                          styles.roleTogglePill,
                          {
                            backgroundColor:
                              entry.role === 'Recitation' ? theme.secondary : theme.background,
                            borderColor: theme.border,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.roleTogglePillText,
                            {
                              color:
                                entry.role === 'Recitation' ? '#ffffff' : theme.textSecondary,
                            },
                          ]}
                        >
                          {isRtl ? 'תרגול' : 'Recitation'}
                        </Text>
                      </Pressable>
                    </View>
                    <Pressable
                      onPress={() => handleRemoveStaffEntry(idx).catch(() => {})}
                      style={styles.removeEntryBtn}
                    >
                      <TrashIcon size={15} color={theme.danger} />
                    </Pressable>
                  </View>
                ))}

                {/* Manual host add input */}
                <View style={[styles.manualAddRow, { flexDirection: rowDir }]}>
                  <TextInput
                    value={newHostName}
                    onChangeText={setNewHostName}
                    placeholder={isRtl ? 'שם מארח ב-Panopto (באנגלית)' : 'Panopto host name'}
                    placeholderTextColor={theme.placeholder}
                    style={[
                      styles.textInput,
                      {
                        flex: 1,
                        backgroundColor: theme.backgroundElement,
                        borderColor: theme.border,
                        color: theme.text,
                        textAlign: 'left',
                      },
                    ]}
                  />
                  <Pressable
                    onPress={() =>
                      setNewHostRole((r) => (r === 'Lecture' ? 'Recitation' : 'Lecture'))
                    }
                    style={[
                      styles.roleTogglePill,
                      {
                        backgroundColor:
                          newHostRole === 'Lecture' ? `${theme.primary}20` : `${theme.secondary}20`,
                        borderColor: newHostRole === 'Lecture' ? theme.primary : theme.secondary,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.roleTogglePillText,
                        { color: newHostRole === 'Lecture' ? theme.primary : theme.secondary },
                      ]}
                    >
                      {newHostRole === 'Lecture'
                        ? isRtl
                          ? 'הרצאה'
                          : 'Lecture'
                        : isRtl
                          ? 'תרגול'
                          : 'Recitation'}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      const trimmed = newHostName.trim();
                      if (!trimmed) return;
                      handleAddStaffEntry(trimmed, newHostRole)
                        .then(() => setNewHostName(''))
                        .catch(() => {});
                    }}
                    disabled={!newHostName.trim()}
                    style={[
                      styles.addBtn,
                      {
                        backgroundColor: newHostName.trim() ? theme.primary : theme.backgroundSelected,
                      },
                    ]}
                  >
                    <PlusIcon size={14} color="#ffffff" />
                  </Pressable>
                </View>
              </View>
            ) : null}

            {/* Optional Folder Override Input */}
            {settings.showPanoptoFolderOverride ? (
              <View
                style={[
                  styles.folderOverrideBox,
                  { backgroundColor: theme.background, borderColor: theme.border },
                ]}
              >
                <Text style={[styles.staffHelperLabel, { color: theme.textSecondary, textAlign }]}>
                  {t('panopto_folder_override')}
                </Text>
                <View style={[styles.manualAddRow, { flexDirection: rowDir }]}>
                  <TextInput
                    value={panoptoFolderInput}
                    onChangeText={(txt) =>
                      setPanoptoFolderDraft({ courseId: logicalCourseId, value: txt })
                    }
                    placeholder="https://tau.cloud.panopto.eu/... or UUID"
                    placeholderTextColor={theme.placeholder}
                    style={[
                      styles.textInput,
                      {
                        flex: 1,
                        backgroundColor: theme.backgroundElement,
                        borderColor: theme.border,
                        color: theme.text,
                        textAlign: 'left',
                      },
                    ]}
                  />
                  <Pressable
                    onPress={() =>
                      saveCoursePanoptoFolder(logicalCourseId, panoptoFolderInput)
                        .then(() => setPanoptoFolderDraft(null))
                        .catch(() => {})
                    }
                    style={[styles.saveFolderBtn, { backgroundColor: theme.primary }]}
                  >
                    <Text style={styles.saveFolderBtnText}>{t('save_btn')}</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            {/* Recordings List */}
            {aggregated.recordings.length === 0 ? (
              <Text style={[styles.emptyMiniText, { color: theme.textSecondary, textAlign }]}>
                {isRtl
                  ? 'לא נמצאו הקלטות Panopto עבור קורס זה.'
                  : 'No Panopto recordings discovered for this course yet.'}
              </Text>
            ) : (
              <>
                {partitionedRecordings.visible.map((rec) => renderRecordingRow(rec, false))}
                {partitionedRecordings.hidden.length > 0 ? (
                  <View style={styles.drawerWrapper}>
                    <Pressable
                      onPress={() => setShowHiddenPanoptoDrawer((v) => !v)}
                      style={({ pressed }) => [
                        styles.drawerToggleBtn,
                        {
                          backgroundColor: theme.background,
                          borderColor: theme.border,
                          flexDirection: rowDir,
                          opacity: pressed ? 0.75 : 1,
                        },
                      ]}
                    >
                      {showHiddenPanoptoDrawer ? (
                        <EyeIcon size={14} color={theme.primary} />
                      ) : (
                        <EyeOffIcon size={14} color={theme.textSecondary} />
                      )}
                      <Text style={[styles.drawerToggleText, { color: theme.text }]}>
                        {t('hidden_recordings_drawer')} ({partitionedRecordings.hidden.length})
                      </Text>
                      {showHiddenPanoptoDrawer ? (
                        <ChevronUpIcon size={14} color={theme.textSecondary} />
                      ) : (
                        <ChevronDownIcon size={14} color={theme.textSecondary} />
                      )}
                    </Pressable>
                    {showHiddenPanoptoDrawer ? (
                      <View style={styles.drawerContent}>
                        {partitionedRecordings.hidden.map((rec) => renderRecordingRow(rec, true))}
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </>
            )}
          </View>
        ) : null}
      </View>
    );
  };

  const renderContentPane = (includeTabletMedia: boolean) => {
    const allCollapsed =
      displayedBuckets.length > 0 &&
      displayedBuckets.every((b) => collapsedSectionKeys.has(b.key));

    return (
      <View style={styles.paneColumn}>
        {/* Announcements Noticeboard Card */}
        {aggregated.announcements.length > 0 ? (
          <View
            style={[
              styles.announcementsCard,
              {
                backgroundColor: `${theme.primary}12`,
                borderColor: `${theme.primary}38`,
              },
            ]}
          >
            <View style={[styles.announcementsHeader, { flexDirection: rowDir }]}>
              <AnnouncementIcon size={18} color={theme.primary} />
              <Text style={[styles.announcementsTitle, { color: theme.primary, textAlign }]}>
                {t('announcements_title')}
              </Text>
            </View>
            <View style={[styles.chipsWrap, { flexDirection: rowDir }]}>
              {aggregated.announcements.map((ann) => (
                <Pressable
                  key={`ann-${ann.id}`}
                  onPress={() => openMoodleUrl(ann.moodleUrl, courseBaseUrl)}
                  style={({ pressed }) => [
                    styles.announcementChip,
                    {
                      backgroundColor: theme.backgroundElement,
                      borderColor: theme.border,
                      flexDirection: rowDir,
                      opacity: pressed ? 0.75 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.announcementChipText,
                      { color: theme.text, writingDirection: 'auto' },
                    ]}
                  >
                    {ann.name}
                  </Text>
                  <ExternalLinkIcon size={12} color={theme.primary} />
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {/* On Tablet, keep collapsible Zoom & Panopto accessible right in main column */}
        {includeTabletMedia ? (
          <>
            {renderZoomHubCard(true)}
            {renderPanoptoCard(true)}
          </>
        ) : null}

        {/* Sections Header + Empty Sections Toggle + Collapse/Expand All */}
        <View style={[styles.sectionsToolbar, { flexDirection: rowDir }]}>
          <Text style={[styles.sectionsHeading, { color: theme.text, textAlign }]}>
            {t('course_sections')}
          </Text>
          <View style={[styles.sectionsToolbarBtns, { flexDirection: rowDir }]}>
            <Pressable
              onPress={() => {
                const nextEmpty = !settings.showEmptySections;
                if (!nextEmpty) {
                  setActiveTopSectionId(null);
                  setActiveSubSectionId(null);
                  setActiveOrphanSectionKey(null);
                }
                updateSetting('showEmptySections', nextEmpty).catch(() => {});
              }}
              style={({ pressed }) => [
                styles.smallActionBtn,
                {
                  backgroundColor: settings.showEmptySections
                    ? `${theme.primary}1a`
                    : theme.backgroundElement,
                  borderColor: settings.showEmptySections ? theme.primary : theme.border,
                  flexDirection: rowDir,
                  opacity: pressed ? 0.75 : 1,
                },
              ]}
            >
              {settings.showEmptySections ? (
                <EyeOffIcon size={13} color={theme.primary} />
              ) : (
                <EyeIcon size={13} color={theme.textSecondary} />
              )}
              <Text
                style={[
                  styles.smallActionBtnText,
                  { color: settings.showEmptySections ? theme.primary : theme.textSecondary },
                ]}
              >
                {settings.showEmptySections
                  ? t('hide_empty_sections')
                  : t('show_empty_sections')}
              </Text>
            </Pressable>

            {displayedBuckets.length > 1 ? (
              <Pressable
                onPress={toggleAllSectionsCollapsed}
                style={({ pressed }) => [
                  styles.smallActionBtn,
                  {
                    backgroundColor: theme.backgroundElement,
                    borderColor: theme.border,
                    flexDirection: rowDir,
                    opacity: pressed ? 0.75 : 1,
                  },
                ]}
              >
                {allCollapsed ? (
                  <ChevronDownIcon size={13} color={theme.text} />
                ) : (
                  <ChevronUpIcon size={13} color={theme.text} />
                )}
                <Text style={[styles.smallActionBtnText, { color: theme.text }]}>
                  {allCollapsed ? t('expand_all') : t('collapse_all')}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {/* 2-Level Section Navigation Chips */}
        {visibleTopSections.length > 0 || visibleOrphanBuckets.length > 0 ? (
          <View
            style={[
              styles.sectionNavBox,
              { backgroundColor: theme.backgroundElement, borderColor: theme.border },
            ]}
          >
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={[
                styles.chipStripContent,
                { flexDirection: rowDir },
              ]}
            >
              <Pressable
                onPress={() => {
                  setActiveTopSectionId(null);
                  setActiveSubSectionId(null);
                  setActiveOrphanSectionKey(null);
                }}
                style={[
                  styles.navChip,
                  {
                    backgroundColor:
                      activeTopSectionId === null && activeOrphanSectionKey === null
                        ? courseColor
                        : theme.background,
                    borderColor:
                      activeTopSectionId === null && activeOrphanSectionKey === null
                        ? courseColor
                        : theme.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.navChipText,
                    {
                      color:
                        activeTopSectionId === null && activeOrphanSectionKey === null
                          ? '#ffffff'
                          : theme.text,
                    },
                  ]}
                >
                  {t('all_subjects')}
                </Text>
              </Pressable>

              {visibleTopSections.map((sec) => {
                const isActive =
                  activeTopSectionId === sec.id && activeOrphanSectionKey === null;
                return (
                  <Pressable
                    key={`topsec-${sec.id}`}
                    onPress={() => {
                      setActiveOrphanSectionKey(null);
                      setActiveTopSectionId(sec.id);
                      setActiveSubSectionId(null);
                    }}
                    style={[
                      styles.navChip,
                      {
                        backgroundColor: isActive ? courseColor : theme.background,
                        borderColor: isActive ? courseColor : theme.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.navChipText,
                        { color: isActive ? '#ffffff' : theme.text },
                      ]}
                    >
                      {sec.name}
                    </Text>
                  </Pressable>
                );
              })}

              {visibleOrphanBuckets.map((b) => {
                const isActive = activeOrphanSectionKey === b.key;
                return (
                  <Pressable
                    key={`orphan-${b.key}`}
                    onPress={() => {
                      setActiveTopSectionId(null);
                      setActiveSubSectionId(null);
                      setActiveOrphanSectionKey(b.key);
                    }}
                    style={[
                      styles.navChip,
                      {
                        backgroundColor: isActive ? courseColor : theme.background,
                        borderColor: isActive ? courseColor : theme.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.navChipText,
                        { color: isActive ? '#ffffff' : theme.text },
                      ]}
                    >
                      {b.displayTitle}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Level 1 Subsection Strip (shown when active top section has children) */}
            {activeTopSectionId !== null && visibleSubSections.length > 0 ? (
              <View
                style={[
                  styles.subSectionStripWrap,
                  {
                    borderTopColor: theme.border,
                    paddingLeft: isRtl ? 0 : 12,
                    paddingRight: isRtl ? 12 : 0,
                    flexDirection: rowDir,
                  },
                ]}
              >
                {isRtl ? (
                  <ChevronLeftIcon size={14} color={theme.textSecondary} />
                ) : (
                  <ChevronRightIcon size={14} color={theme.textSecondary} />
                )}
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={[
                    styles.chipStripContent,
                    { flexDirection: rowDir },
                  ]}
                >
                  <Pressable
                    onPress={() => setActiveSubSectionId(null)}
                    style={[
                      styles.subNavChip,
                      {
                        backgroundColor:
                          activeSubSectionId === null ? courseColor : theme.background,
                        borderColor:
                          activeSubSectionId === null ? courseColor : theme.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.subNavChipText,
                        { color: activeSubSectionId === null ? '#ffffff' : theme.text },
                      ]}
                    >
                      {isRtl ? 'כל תתי-הנושאים' : 'All Subtopics'}
                    </Text>
                  </Pressable>

                  {visibleSubSections.map((sub) => {
                    const isActive = activeSubSectionId === sub.id;
                    return (
                      <Pressable
                        key={`subsec-${sub.id}`}
                        onPress={() => setActiveSubSectionId(sub.id)}
                        style={[
                          styles.subNavChip,
                          {
                            backgroundColor: isActive ? courseColor : theme.background,
                            borderColor: isActive ? courseColor : theme.border,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.subNavChipText,
                            { color: isActive ? '#ffffff' : theme.text },
                          ]}
                        >
                          {sub.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Section Cards */}
        {displayedBuckets.length === 0 ? (
          <View
            style={[
              styles.emptySectionCard,
              { backgroundColor: theme.backgroundElement, borderColor: theme.border },
            ]}
          >
            <Text style={[styles.emptyMiniText, { color: theme.textSecondary, textAlign: 'center' }]}>
              {allVisibleBucketsCount === 0 && aggregated.sections.length > 0 && !settings.showEmptySections
                ? isRtl
                  ? 'כל הנושאים בקורס זה ריקים (מוסתרים כברירת מחדל).'
                  : 'All sections in this course are empty (hidden by default).'
                : t('empty_sections')}
            </Text>
            {!settings.showEmptySections && aggregated.sections.length > 0 ? (
              <Pressable
                onPress={() => updateSetting('showEmptySections', true).catch(() => {})}
                style={[
                  styles.smallActionBtn,
                  {
                    backgroundColor: theme.background,
                    borderColor: theme.border,
                    flexDirection: rowDir,
                    marginTop: 10,
                  },
                ]}
              >
                <EyeIcon size={13} color={theme.primary} />
                <Text style={[styles.smallActionBtnText, { color: theme.primary }]}>
                  {t('show_empty_sections')}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          displayedBuckets.map((bucket) => {
            const isCollapsed = collapsedSectionKeys.has(bucket.key);
            const isChildSubsection =
              bucket.parentSectionId !== null && bucket.parentSectionId !== undefined;
            const visibleSecAssigns = bucket.assignments.filter(
              (a) => !isActivityHidden(a, hiddenAssignments)
            );
            const hiddenSecAssigns = bucket.assignments.filter((a) =>
              isActivityHidden(a, hiddenAssignments)
            );
            const isHiddenDrawerOpen = expandedHiddenSectionKeys.has(bucket.key);

            const matchingSec = allCourseSections.find(
              (s) =>
                (bucket.sectionId !== undefined && s.id === bucket.sectionId) ||
                s.name === bucket.displayTitle
            );
            const sectionMoodleUrl =
              bucket.sectionUrl ||
              matchingSec?.sectionUrl ||
              moodleCourseUrl;

            const isBucketEmptyNow =
              bucket.files.length === 0 &&
              bucket.assignments.length === 0 &&
              bucket.folders.length === 0 &&
              bucket.links.length === 0 &&
              !bucket.summaryText;

            return (
              <View
                key={`sec-${bucket.key}`}
                style={[
                  styles.sectionCard,
                  isChildSubsection && {
                    marginLeft: isRtl ? 0 : 12,
                    marginRight: isRtl ? 12 : 0,
                  },
                  {
                    backgroundColor: theme.backgroundElement,
                    borderColor: theme.border,
                    borderLeftWidth: isRtl ? 1 : isChildSubsection ? 3 : 4,
                    borderRightWidth: isRtl ? (isChildSubsection ? 3 : 4) : 1,
                    borderLeftColor: isRtl ? theme.border : courseColor,
                    borderRightColor: isRtl ? courseColor : theme.border,
                  },
                ]}
              >
                {/* Section Header */}
                <Pressable
                  onPress={() => toggleSectionCollapsed(bucket.key)}
                  style={[
                    styles.sectionCardHeader,
                    {
                      flexDirection: rowDir,
                      borderBottomWidth: isCollapsed ? 0 : StyleSheet.hairlineWidth,
                      borderBottomColor: theme.border,
                      paddingBottom: isCollapsed ? 0 : 10,
                    },
                  ]}
                >
                  <View style={[styles.sectionHeaderLeft, { flexDirection: rowDir }]}>
                    <Text
                      style={[
                        styles.sectionCardTitle,
                        { color: theme.text, textAlign, writingDirection: 'auto' },
                      ]}
                    >
                      {bucket.displayTitle}
                    </Text>
                  </View>

                  <View style={[styles.sectionHeaderActions, { flexDirection: rowDir }]}>
                    <Pressable
                      onPress={(ev) => {
                        ev.stopPropagation();
                        openMoodleUrl(sectionMoodleUrl, courseBaseUrl);
                      }}
                      style={({ pressed }) => [
                        styles.sectionMoodleLink,
                        {
                          backgroundColor: theme.background,
                          borderColor: theme.border,
                          flexDirection: rowDir,
                          opacity: pressed ? 0.7 : 1,
                        },
                      ]}
                    >
                      <Text style={[styles.sectionMoodleLinkText, { color: theme.primary }]}>
                        {isRtl ? 'מודל' : 'Moodle'}
                      </Text>
                      <ExternalLinkIcon size={11} color={theme.primary} />
                    </Pressable>
                    {isCollapsed ? (
                      <ChevronDownIcon size={17} color={theme.textSecondary} />
                    ) : (
                      <ChevronUpIcon size={17} color={theme.textSecondary} />
                    )}
                  </View>
                </Pressable>

                {!isCollapsed ? (
                  <View style={styles.sectionCardBody}>
                    {isBucketEmptyNow ? (
                      <Text style={[styles.emptyMiniText, { color: theme.textSecondary, textAlign }]}>
                        {isRtl ? 'אין פריטים זמינים בנושא זה.' : 'No items in this section.'}
                      </Text>
                    ) : null}

                    {bucket.summaryText ? (
                      <View
                        style={[
                          styles.summaryBox,
                          {
                            backgroundColor: theme.background,
                            borderLeftWidth: isRtl ? 0 : 3,
                            borderRightWidth: isRtl ? 3 : 0,
                            borderLeftColor: isRtl ? 'transparent' : courseColor,
                            borderRightColor: isRtl ? courseColor : 'transparent',
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.summaryText,
                            { color: theme.textSecondary, textAlign, writingDirection: 'auto' },
                          ]}
                        >
                          {bucket.summaryText}
                        </Text>
                      </View>
                    ) : null}

                    {/* Section Assignments & Quizzes */}
                    {visibleSecAssigns.length > 0 ? (
                      <View style={styles.subsectionBlock}>
                        {visibleSecAssigns.map((a) => renderAssignmentItemCard(a, false))}
                      </View>
                    ) : null}

                    {/* Standalone Files (!f.folderId) */}
                    {bucket.files.length > 0 ? (
                      <View style={styles.subsectionBlock}>
                        {bucket.files.map((f, fIdx) =>
                          renderFileRow({
                            key: `secfile-${bucket.key}-${f.id || fIdx}-${f.fileName}`,
                            id: f.id,
                            fileName: f.fileName,
                            fileUrl: f.fileUrl,
                            mimeType: f.mimeType,
                            fileSize: f.fileSize,
                          })
                        )}
                      </View>
                    ) : null}

                    {/* mod_folder Directory Browsers */}
                    {bucket.folders.length > 0 ? (
                      <View style={styles.subsectionBlock}>
                        {bucket.folders.map((fld) => renderFolderCard(fld))}
                      </View>
                    ) : null}

                    {/* External Links */}
                    {bucket.links.length > 0 ? (
                      <View style={styles.subsectionBlock}>
                        {bucket.links.map((lnk) => renderExternalLinkRow(lnk))}
                      </View>
                    ) : null}

                    {/* Per-section Collapsible Hidden Assignments Drawer */}
                    {hiddenSecAssigns.length > 0 ? (
                      <View style={styles.drawerWrapper}>
                        <Pressable
                          onPress={() => toggleHiddenSectionDrawer(bucket.key)}
                          style={({ pressed }) => [
                            styles.drawerToggleBtn,
                            {
                              backgroundColor: theme.background,
                              borderColor: theme.border,
                              flexDirection: rowDir,
                              opacity: pressed ? 0.75 : 1,
                            },
                          ]}
                        >
                          {isHiddenDrawerOpen ? (
                            <EyeIcon size={14} color={theme.primary} />
                          ) : (
                            <EyeOffIcon size={14} color={theme.textSecondary} />
                          )}
                          <Text style={[styles.drawerToggleText, { color: theme.text }]}>
                            {t('hidden_assignments_drawer')} ({hiddenSecAssigns.length})
                          </Text>
                          {isHiddenDrawerOpen ? (
                            <ChevronUpIcon size={14} color={theme.textSecondary} />
                          ) : (
                            <ChevronDownIcon size={14} color={theme.textSecondary} />
                          )}
                        </Pressable>
                        {isHiddenDrawerOpen ? (
                          <View style={styles.drawerContent}>
                            {hiddenSecAssigns.map((a) => renderAssignmentItemCard(a, true))}
                          </View>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })
        )}
      </View>
    );
  };

  const renderAssignmentsPane = () => {
    return (
      <View
        style={[
          styles.sectionCard,
          {
            backgroundColor: theme.backgroundElement,
            borderColor: theme.border,
          },
        ]}
      >
        <View style={[styles.cardHeaderRow, { flexDirection: rowDir }]}>
          <Text style={[styles.cardHeaderTitle, { color: theme.text, textAlign }]}>
            {t('all_assignments_label')} ({visibleAssignments.length})
          </Text>

          {sortedCourseAssignments.length > 0 ? (
            <Pressable
              onPress={() =>
                bulkSetCourseAssignmentsHidden(logicalCourseId, !allAssignmentsHidden).catch(
                  () => {}
                )
              }
              style={({ pressed }) => [
                styles.smallActionBtn,
                {
                  backgroundColor: theme.background,
                  borderColor: theme.border,
                  flexDirection: rowDir,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              {allAssignmentsHidden ? (
                <EyeIcon size={13} color={theme.primary} />
              ) : (
                <EyeOffIcon size={13} color={theme.textSecondary} />
              )}
              <Text
                style={[
                  styles.smallActionBtnText,
                  { color: allAssignmentsHidden ? theme.primary : theme.text },
                ]}
              >
                {allAssignmentsHidden
                  ? t('unhide_all_assignments')
                  : t('hide_all_assignments')}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {sortedCourseAssignments.length === 0 ? (
          <Text style={[styles.emptyMiniText, { color: theme.textSecondary, textAlign }]}>
            {t('empty_assignments')}
          </Text>
        ) : (
          <View style={styles.subsectionBlock}>
            {visibleAssignments.length === 0 ? (
              <Text style={[styles.emptyMiniText, { color: theme.textSecondary, textAlign }]}>
                {t('no_pending_tasks')}
              </Text>
            ) : (
              visibleAssignments.map((a) => renderAssignmentItemCard(a, false))
            )}

            {hiddenCourseAssignments.length > 0 ? (
              <View style={styles.drawerWrapper}>
                <Pressable
                  onPress={() => setShowHiddenAssignmentsTabDrawer((v) => !v)}
                  style={({ pressed }) => [
                    styles.drawerToggleBtn,
                    {
                      backgroundColor: theme.background,
                      borderColor: theme.border,
                      flexDirection: rowDir,
                      opacity: pressed ? 0.75 : 1,
                    },
                  ]}
                >
                  {showHiddenAssignmentsTabDrawer ? (
                    <EyeIcon size={14} color={theme.primary} />
                  ) : (
                    <EyeOffIcon size={14} color={theme.textSecondary} />
                  )}
                  <Text style={[styles.drawerToggleText, { color: theme.text }]}>
                    {t('hidden_assignments_drawer')} ({hiddenCourseAssignments.length})
                  </Text>
                  {showHiddenAssignmentsTabDrawer ? (
                    <ChevronUpIcon size={14} color={theme.textSecondary} />
                  ) : (
                    <ChevronDownIcon size={14} color={theme.textSecondary} />
                  )}
                </Pressable>
                {showHiddenAssignmentsTabDrawer ? (
                  <View style={styles.drawerContent}>
                    {hiddenCourseAssignments.map((a) => renderAssignmentItemCard(a, true))}
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]} edges={['top', 'bottom']}>
      {/* Top Header */}
      <View
        style={[
          styles.header,
          {
            backgroundColor: theme.backgroundElement,
            borderBottomColor: theme.border,
            borderTopWidth: 4,
            borderTopColor: courseColor,
          },
        ]}
      >
        <View style={[isLandscapeTablet ? styles.centeredMax : styles.centeredPortrait, styles.headerContainer]}>
          <View style={[styles.headerTopRow, { flexDirection: rowDir }]}>
            <Pressable
              onPress={handleBack}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.backBtn,
                {
                  backgroundColor: theme.backgroundSelected,
                  borderColor: theme.border,
                  flexDirection: rowDir,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              {isRtl ? (
                <ChevronRightIcon size={16} color={theme.text} />
              ) : (
                <ChevronLeftIcon size={16} color={theme.text} />
              )}
              <Text style={[styles.backBtnText, { color: theme.text }]}>{t('back_btn')}</Text>
            </Pressable>

            <View style={[styles.headerRightActions, { flexDirection: rowDir }]}>
              <Pressable
                onPress={() => {
                  if (isSyncing) {
                    openSyncWindow();
                  } else {
                    triggerSync({ manual: true }).catch(() => {});
                  }
                }}
                accessibilityLabel={t('sync_now')}
                style={({ pressed }) => [
                  styles.iconCircleBtn,
                  {
                    backgroundColor: theme.backgroundSelected,
                    borderColor: theme.border,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <SpinningIcon spinning={isSyncing}>
                  <RefreshIcon size={16} color={theme.primary} />
                </SpinningIcon>
              </Pressable>

              {unifiedCourse ? (
                <Pressable
                  onPress={() => openMoodleUrl(moodleCourseUrl, courseBaseUrl)}
                  style={({ pressed }) => [
                    styles.openMoodleBtn,
                    {
                      backgroundColor: theme.backgroundSelected,
                      borderColor: theme.border,
                      flexDirection: rowDir,
                      opacity: pressed ? 0.75 : 1,
                    },
                  ]}
                >
                  <Text style={[styles.openMoodleText, { color: theme.primary }]}>
                    {t('open_in_moodle')}
                  </Text>
                  <ExternalLinkIcon size={13} color={theme.primary} />
                </Pressable>
              ) : null}
            </View>
          </View>

          <View style={[styles.headerTitleRow, { flexDirection: rowDir }]}>
            <View style={{ flex: 1 }}>
              <Text
                style={[
                  styles.courseMainTitle,
                  { color: courseColor, textAlign, writingDirection: 'auto' },
                ]}
              >
                {courseDisplayName}
              </Text>
              {unifiedCourse?.courseCode ? (
                <Text
                  style={[
                    styles.courseCodeSubtitle,
                    { color: theme.textSecondary, textAlign, writingDirection: 'auto' },
                  ]}
                >
                  {unifiedCourse.courseCode}
                  {unifiedCourse.fullname && unifiedCourse.fullname !== courseDisplayName
                    ? ` • ${unifiedCourse.fullname}`
                    : ''}
                </Text>
              ) : null}
            </View>

            {courseAverage && courseAverage !== '-' ? (
              <View style={[styles.courseAvgBadge, { backgroundColor: `${courseColor}22`, borderColor: courseColor }]}>
                <Text style={[styles.courseAvgBadgeText, { color: courseColor }]}>
                  {t('course_average_label')}: {courseAverage}
                </Text>
              </View>
            ) : null}
          </View>

          {/* Phone Segmented Switcher */}
          {!isTwoColTablet ? (
            <View
              testID="course-segmented-bar"
              style={[
                styles.segmentedBar,
                {
                  backgroundColor: theme.background,
                  borderColor: theme.border,
                  flexDirection: rowDir,
                },
              ]}
            >
              {(
                [
                  { id: 'content', label: t('course_content') },
                  {
                    id: 'assignments',
                    label: `${t('assignments')} (${visibleAssignments.length})`,
                  },
                  { id: 'media', label: t('zoom_and_panopto') },
                ] as const
              ).map((seg) => {
                const active = phoneTab === seg.id;
                return (
                  <Pressable
                    key={seg.id}
                    onPress={() => setPhoneTab(seg.id)}
                    style={[
                      styles.segmentItem,
                      active && { backgroundColor: courseColor },
                    ]}
                  >
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.segmentText,
                        { color: active ? '#ffffff' : theme.textSecondary },
                      ]}
                    >
                      {seg.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </View>
      </View>

      {/* Main Content */}
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
              triggerSync().catch(() => {});
            }}
            tintColor={courseColor}
            colors={[courseColor]}
          />
        }
      >
        {!unifiedCourse ? (
          <View
            style={[
              styles.sectionCard,
              { backgroundColor: theme.backgroundElement, borderColor: theme.border },
            ]}
          >
            <Text style={[styles.emptyMiniText, { color: theme.textSecondary, textAlign: 'center' }]}>
              {isRtl ? 'הקורס לא נמצא.' : 'Course not found.'}
            </Text>
          </View>
        ) : isTwoColTablet ? (
          <View testID="course-tablet-grid" style={[styles.tabletGrid, { flexDirection: rowDir }]}>
            <View style={styles.tabletMainCol}>{renderContentPane(true)}</View>
            <View style={styles.tabletSideCol}>{renderAssignmentsPane()}</View>
          </View>
        ) : phoneTab === 'content' ? (
          renderContentPane(false)
        ) : phoneTab === 'assignments' ? (
          renderAssignmentsPane()
        ) : (
          <View style={styles.paneColumn}>
            {renderZoomHubCard(false)}
            {renderPanoptoCard(false)}
          </View>
        )}
      </ScrollView>

      <AssignmentDetailSheet
        visible={Boolean(selectedAssignment)}
        assignment={selectedAssignment}
        courseColor={courseColor}
        courseDisplayName={courseDisplayName}
        onClose={() => setSelectedAssignment(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  centeredMax: {
    maxWidth: 1280,
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
  headerContainer: {
    gap: 10,
  },
  headerTopRow: {
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  backBtn: {
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 9,
    borderWidth: 1,
  },
  backBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  headerRightActions: {
    alignItems: 'center',
    gap: 8,
  },
  iconCircleBtn: {
    width: 34,
    height: 34,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  openMoodleBtn: {
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 9,
    borderWidth: 1,
  },
  openMoodleText: {
    fontSize: 12,
    fontWeight: '700',
  },
  headerTitleRow: {
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  courseMainTitle: {
    fontSize: 20,
    fontWeight: '800',
  },
  courseCodeSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  courseAvgBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    flexShrink: 0,
  },
  courseAvgBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  segmentedBar: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 4,
    gap: 4,
  },
  segmentItem: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentText: {
    fontSize: 12,
    fontWeight: '700',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  tabletGrid: {
    gap: 16,
    alignItems: 'flex-start',
  },
  tabletMainCol: {
    flex: 1.65,
    minWidth: 0,
  },
  tabletSideCol: {
    flex: 1,
    minWidth: 310,
    maxWidth: 420,
  },
  paneColumn: {
    gap: 14,
  },
  announcementsCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  announcementsHeader: {
    alignItems: 'center',
    gap: 8,
  },
  announcementsTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  chipsWrap: {
    flexWrap: 'wrap',
    gap: 8,
  },
  announcementChip: {
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  announcementChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  sectionsToolbar: {
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  sectionsHeading: {
    fontSize: 16,
    fontWeight: '700',
  },
  sectionsToolbarBtns: {
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  sectionNavBox: {
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    gap: 8,
  },
  chipStripContent: {
    gap: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
  },
  navChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  navChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  subSectionStripWrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
    alignItems: 'center',
    gap: 6,
  },
  subNavChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  subNavChipText: {
    fontSize: 11,
    fontWeight: '600',
  },
  sectionCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  sectionCardHeader: {
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  sectionHeaderLeft: {
    flex: 1,
    alignItems: 'center',
  },
  sectionCardTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  sectionHeaderActions: {
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  sectionMoodleLink: {
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 7,
    borderWidth: 1,
  },
  sectionMoodleLinkText: {
    fontSize: 11,
    fontWeight: '600',
  },
  sectionCardBody: {
    gap: 10,
  },
  summaryBox: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
  },
  summaryText: {
    fontSize: 13,
    lineHeight: 19,
  },
  subsectionBlock: {
    gap: 8,
  },
  assignCard: {
    borderRadius: 11,
    borderWidth: 1,
    padding: 12,
    gap: 6,
  },
  assignMetaRow: {
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  tagPill: {
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  tagPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  assignTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  graceRow: {
    alignItems: 'center',
    gap: 5,
  },
  graceText: {
    fontSize: 11,
    flex: 1,
  },
  assignGradeLine: {
    fontSize: 12,
    fontWeight: '700',
  },
  assignFeedbackLine: {
    fontSize: 12,
    lineHeight: 17,
  },
  assignQuickActions: {
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 2,
  },
  subtleTag: {
    fontSize: 11,
    fontWeight: '600',
  },
  smallActionBtn: {
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  smallActionBtnText: {
    fontSize: 11,
    fontWeight: '600',
  },
  fileRow: {
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    gap: 10,
  },
  fileLeft: {
    flex: 1,
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
  },
  fileTextWrap: {
    flex: 1,
    gap: 3,
  },
  fileNameText: {
    fontSize: 13,
    fontWeight: '600',
  },
  fileSubMeta: {
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  extBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  extBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  fileSizeText: {
    fontSize: 11,
  },
  cachedBadge: {
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 1,
  },
  cachedBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  fileRowActions: {
    flexShrink: 0,
    alignItems: 'center',
    gap: 6,
  },
  fileMiniBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  folderCard: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  folderHeader: {
    padding: 12,
    alignItems: 'center',
  },
  folderHeaderLeft: {
    flex: 1,
    alignItems: 'center',
    gap: 10,
  },
  folderTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  folderMetaText: {
    fontSize: 11,
    marginTop: 2,
  },
  folderActionsBar: {
    paddingHorizontal: 12,
    paddingBottom: 10,
    gap: 8,
    flexWrap: 'wrap',
  },
  folderBody: {
    paddingHorizontal: 10,
    paddingBottom: 12,
    gap: 8,
  },
  folderDesc: {
    fontSize: 12,
    lineHeight: 18,
    paddingHorizontal: 4,
  },
  subfolderGroup: {
    marginTop: 4,
    gap: 6,
  },
  subfolderHeader: {
    alignItems: 'center',
    gap: 6,
  },
  subfolderTitle: {
    fontSize: 12,
    fontWeight: '700',
  },
  subfolderFilesList: {
    gap: 6,
  },
  linkRow: {
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    gap: 10,
  },
  linkRowLeft: {
    flex: 1,
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  linkRowTitle: {
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
  },
  drawerWrapper: {
    marginTop: 4,
    gap: 8,
  },
  drawerToggleBtn: {
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  drawerToggleText: {
    fontSize: 12,
    fontWeight: '600',
  },
  drawerContent: {
    gap: 8,
  },
  emptySectionCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 20,
    alignItems: 'center',
  },
  emptyMiniBox: {
    paddingVertical: 6,
  },
  emptyMiniText: {
    fontSize: 13,
  },
  cardHeaderRow: {
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  cardHeaderLeft: {
    alignItems: 'center',
    gap: 8,
  },
  cardHeaderTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  bulkRow: {
    gap: 8,
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  mediaListBody: {
    gap: 10,
  },
  mediaItemCard: {
    borderRadius: 11,
    borderWidth: 1,
    padding: 12,
    gap: 6,
  },
  mediaTopRow: {
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  statusBadge: {
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  mediaDateText: {
    fontSize: 11,
    fontWeight: '500',
  },
  recMetaRight: {
    alignItems: 'center',
    gap: 8,
  },
  mediaTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  mediaSubText: {
    fontSize: 12,
  },
  mediaActionsRow: {
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    marginTop: 2,
  },
  joinZoomBtn: {
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  joinZoomBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  iconToggleBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hostRow: {
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  hostTrackChip: {
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  hostTrackChipText: {
    fontSize: 11,
    fontWeight: '600',
  },
  staffEditorBox: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    gap: 10,
  },
  staffSectionLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  staffSubBlock: {
    gap: 6,
  },
  staffHelperLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  quickHostChip: {
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 7,
    borderWidth: 1,
  },
  quickHostChipText: {
    fontSize: 11,
    fontWeight: '600',
  },
  detectedHostRow: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 8,
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
  },
  detectedHostName: {
    fontSize: 12,
    fontWeight: '600',
  },
  detectedHostBtns: {
    gap: 6,
  },
  roleChipBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  roleChipBtnText: {
    fontSize: 11,
    fontWeight: '700',
  },
  configuredStaffRow: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 8,
    alignItems: 'center',
    gap: 8,
  },
  configuredStaffName: {
    fontSize: 12,
    fontWeight: '700',
  },
  configuredStaffSub: {
    fontSize: 11,
  },
  roleToggleGroup: {
    gap: 4,
  },
  roleTogglePill: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
  },
  roleTogglePillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  removeEntryBtn: {
    padding: 4,
  },
  manualAddRow: {
    alignItems: 'center',
    gap: 8,
  },
  textInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
  },
  addBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  folderOverrideBox: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    gap: 6,
  },
  saveFolderBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  saveFolderBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
});
