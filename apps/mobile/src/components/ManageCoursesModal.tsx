import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  TauSemester,
  UnifiedCourse,
  cleanCourseDisplayName,
} from '@tautracker/moodle-client';
import { COURSE_COLOR_PALETTE, getReadableTextColor } from '@/constants/theme';
import { useAppState } from '@/hooks/use-app-state';
import { usePreferences } from '@/hooks/use-preferences';
import { useResponsiveLayout } from '@/hooks/use-responsive-layout';
import { ColorPalettePickerModal } from '@/components/ColorPalettePickerModal';
import { RtlHorizontalScrollView } from '@/components/RtlHorizontalScrollView';
import {
  CheckIcon,
  CloseIcon,
  FlaskIcon,
  PaletteIcon,
  PlusIcon,
  RefreshIcon,
  ShieldIcon,
} from '@/components/icons/NoodleIcons';

export interface ManageCoursesModalProps {
  visible: boolean;
  onClose: () => void;
}

interface SemesterCourseGroup {
  key: string;
  year: string;
  semester: TauSemester;
  label: string;
  courses: UnifiedCourse[];
}

const SEMESTER_RANK: Record<TauSemester, number> = {
  SemesterB: 4,
  SemesterA: 3,
  Summer: 2,
  Yearly: 1,
  Other: 0,
};

function getSemesterGroupLabel(
  year: string,
  semester: TauSemester,
  lang: 'he' | 'en'
): string {
  if (!year && semester === 'Other') {
    return lang === 'he' ? 'אחר' : 'Other';
  }
  const namesHe: Record<TauSemester, string> = {
    SemesterA: "סמסטר א'",
    SemesterB: "סמסטר ב'",
    Summer: 'סמסטר קיץ',
    Yearly: 'שנתי',
    Other: 'כללי',
  };
  const namesEn: Record<TauSemester, string> = {
    SemesterA: 'Semester A',
    SemesterB: 'Semester B',
    Summer: 'Summer',
    Yearly: 'Yearly',
    Other: 'General',
  };
  const semLabel = lang === 'he' ? namesHe[semester] : namesEn[semester];
  return year ? `${semLabel} (${year})` : semLabel;
}

function groupUnifiedAcademicCourses(
  academicCourses: UnifiedCourse[],
  lang: 'he' | 'en'
): SemesterCourseGroup[] {
  const map = new Map<string, SemesterCourseGroup>();

  for (const course of academicCourses) {
    const year = (course.year || '').trim();
    const semester: TauSemester = course.semester || 'Other';
    const key = year ? `${year}-${semester}` : 'Other';

    let group = map.get(key);
    if (!group) {
      group = {
        key,
        year,
        semester,
        label: getSemesterGroupLabel(year, semester, lang),
        courses: [],
      };
      map.set(key, group);
    }
    group.courses.push(course);
  }

  return Array.from(map.values()).sort((a, b) => {
    if (a.key === 'Other' && b.key !== 'Other') return 1;
    if (b.key === 'Other' && a.key !== 'Other') return -1;

    const yearA = parseInt(a.year, 10) || 0;
    const yearB = parseInt(b.year, 10) || 0;
    if (yearB !== yearA) return yearB - yearA;

    return (SEMESTER_RANK[b.semester] ?? 0) - (SEMESTER_RANK[a.semester] ?? 0);
  });
}

function isLabCourseName(name?: string, shortname?: string): boolean {
  const full = name || '';
  const short = shortname || '';
  return full.includes('מעבדה') || short.includes('מעבדה');
}

export function ManageCoursesModal({ visible, onClose }: ManageCoursesModalProps) {
  const { isTabletDevice, isLandscapeTablet } = useResponsiveLayout();
  const { theme, language, isRtl, t } = usePreferences();
  const {
    groupedCourses,
    enrolledCourses,
    trackedCourseIds,
    coursesCustomNames,
    coursesColorMap,
    fetchOnboardingCourses,
    saveCoursesConfiguration,
    bulkSetCourseAssignmentsHidden,
    triggerSync,
  } = useAppState();

  const [draftTrackedIds, setDraftTrackedIds] = useState<number[]>([]);
  const [draftNicknames, setDraftNicknames] = useState<Record<number, string>>({});
  const [draftColors, setDraftColors] = useState<Record<number, string>>({});
  const [expandedColorCourseId, setExpandedColorCourseId] = useState<number | null>(null);
  const [paletteTarget, setPaletteTarget] = useState<{
    courseId: number;
    courseName: string;
    color: string;
  } | null>(null);
  const [labHideQueue, setLabHideQueue] = useState<number[]>([]);
  const [labPromptCourse, setLabPromptCourse] = useState<{
    courseId: number;
    title: string;
  } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [prevVisible, setPrevVisible] = useState(false);

  const isTablet = isTabletDevice || isLandscapeTablet;
  const rowDir = isRtl ? 'row-reverse' : 'row';
  const textAlign = isRtl ? 'right' : 'left';

  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (visible) {
      setDraftTrackedIds([...trackedCourseIds]);
      setDraftNicknames({ ...coursesCustomNames });
      setDraftColors({ ...coursesColorMap });
      setLabHideQueue([]);
      setLabPromptCourse(null);
      setExpandedColorCourseId(null);
      setPaletteTarget(null);
      setErrorMsg(null);
      if (enrolledCourses.length === 0) {
        setRefreshing(true);
      }
    }
  }

  useEffect(() => {
    if (!visible || enrolledCourses.length > 0) return;
    let cancelled = false;
    fetchOnboardingCourses()
      .catch((err: any) => {
        if (!cancelled) {
          setErrorMsg(
            err?.message ||
              (language === 'he' ? 'טעינת הקורסים נכשלה' : 'Failed to load courses')
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setRefreshing(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [visible, enrolledCourses.length, fetchOnboardingCourses, language]);

  const semesterGroups = useMemo(
    () => groupUnifiedAcademicCourses(groupedCourses.academicCourses, language),
    [groupedCourses.academicCourses, language]
  );

  const adminUmbrella = groupedCourses.administrativeUmbrella;

  const getCourseColor = (courseId: number, fallbackIdx: number = 0): string => {
    return (
      draftColors[courseId] ||
      COURSE_COLOR_PALETTE[fallbackIdx % COURSE_COLOR_PALETTE.length] ||
      theme.primary
    );
  };

  const handleRefreshCourses = async () => {
    setErrorMsg(null);
    setRefreshing(true);
    try {
      await fetchOnboardingCourses();
    } catch (err: any) {
      setErrorMsg(
        err?.message ||
          (language === 'he' ? 'רענון הקורסים נכשל' : 'Failed to refresh courses')
      );
    } finally {
      setRefreshing(false);
    }
  };

  const toggleCourseSelection = (
    courseId: number,
    courseTitle: string,
    courseShortname?: string
  ) => {
    const isCurrentlyTracked = draftTrackedIds.includes(courseId);
    if (isCurrentlyTracked) {
      setDraftTrackedIds((prev) => prev.filter((id) => id !== courseId));
      setLabHideQueue((prev) => prev.filter((id) => id !== courseId));
      return;
    }

    setDraftTrackedIds((prev) => {
      const next = [...prev, courseId];
      if (!draftColors[courseId]) {
        const assignedColor =
          COURSE_COLOR_PALETTE[prev.length % COURSE_COLOR_PALETTE.length] ||
          theme.primary;
        setDraftColors((colorsPrev) => ({ ...colorsPrev, [courseId]: assignedColor }));
      }
      return next;
    });

    const wasOriginallyTracked = trackedCourseIds.includes(courseId);
    if (!wasOriginallyTracked && isLabCourseName(courseTitle, courseShortname)) {
      setLabPromptCourse({ courseId, title: courseTitle });
    }
  };

  const handleToggleUmbrellaAll = () => {
    if (!adminUmbrella) return;
    const subIds = adminUmbrella.subCourses.map((s) => s.courseId);
    const allTracked =
      draftTrackedIds.includes(adminUmbrella.id) ||
      (subIds.length > 0 && subIds.every((id) => draftTrackedIds.includes(id)));

    if (allTracked) {
      const removeSet = new Set([adminUmbrella.id, ...subIds]);
      setDraftTrackedIds((prev) => prev.filter((id) => !removeSet.has(id)));
    } else {
      setDraftTrackedIds((prev) => {
        const nextSet = new Set(prev);
        for (const id of subIds) {
          nextSet.add(id);
        }
        return Array.from(nextSet);
      });
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setErrorMsg(null);
    try {
      await saveCoursesConfiguration(draftTrackedIds, draftNicknames, draftColors);
      for (const labCourseId of labHideQueue) {
        await bulkSetCourseAssignmentsHidden(labCourseId, true);
      }
      triggerSync().catch(() => {});
      onClose();
    } catch (err: any) {
      setErrorMsg(
        err?.message ||
          (language === 'he' ? 'שמירת ההגדרות נכשלה' : 'Failed to save configuration')
      );
    } finally {
      setSaving(false);
    }
  };

  const renderColorPicker = (
    courseId: number,
    currentColor: string,
    courseName?: string
  ) => {
    const isTracked = draftTrackedIds.includes(courseId);
    const isExpanded = expandedColorCourseId === courseId || isTracked;
    if (!isExpanded) return null;

    const isCustomColor = !COURSE_COLOR_PALETTE.some(
      (hex) => hex.toLowerCase() === currentColor.toLowerCase()
    );

    return (
      <RtlHorizontalScrollView
        isRtl={isRtl}
        contentContainerStyle={styles.swatchesRow}
      >
        {COURSE_COLOR_PALETTE.map((hex) => {
          const selected = currentColor.toLowerCase() === hex.toLowerCase();
          return (
            <TouchableOpacity
              key={hex}
              onPress={() =>
                setDraftColors((prev) => ({ ...prev, [courseId]: hex }))
              }
              style={[
                styles.swatchCircle,
                {
                  backgroundColor: hex,
                  borderColor: selected ? theme.text : 'transparent',
                  borderWidth: selected ? 2.5 : 0,
                },
              ]}
              accessibilityLabel={`${t('course_color')} ${hex}`}
            >
              {selected && (
                <CheckIcon
                  size={12}
                  color={getReadableTextColor(hex)}
                  strokeWidth={2.6}
                />
              )}
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity
          testID={`custom-color-btn-${courseId}`}
          onPress={() =>
            setPaletteTarget({
              courseId,
              courseName: courseName || '',
              color: currentColor,
            })
          }
          style={[
            styles.customColorBtn,
            {
              backgroundColor: isCustomColor
                ? currentColor
                : theme.backgroundSelected,
              borderColor: isCustomColor ? theme.text : theme.border,
              borderWidth: isCustomColor ? 2 : 1,
              flexDirection: rowDir,
            },
          ]}
          accessibilityLabel={t('custom_color_picker_btn')}
        >
          {isCustomColor ? (
            <PaletteIcon size={13} color={getReadableTextColor(currentColor)} />
          ) : (
            <>
              <PlusIcon size={11} color={theme.text} strokeWidth={2.4} />
              <PaletteIcon size={13} color={theme.primary} />
            </>
          )}
        </TouchableOpacity>
      </RtlHorizontalScrollView>
    );
  };

  return (
    <Modal
      visible={visible}
      transparent={isTablet}
      animationType="fade"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.modalRoot}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      <View
        style={[
          styles.modalRoot,
          isTablet
            ? styles.tabletBackdrop
            : { backgroundColor: theme.background },
        ]}
      >
        {isTablet && <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />}

        <SafeAreaView
          style={[
            styles.modalContainer,
            isTablet ? styles.tabletCard : styles.phoneFull,
            {
              backgroundColor: theme.background,
              borderColor: theme.border,
            },
          ]}
        >
          {/* Header */}
          <View
            style={[
              styles.header,
              {
                backgroundColor: theme.backgroundElement,
                borderBottomColor: theme.border,
                flexDirection: rowDir,
              },
            ]}
          >
            <View style={styles.headerTitleBlock}>
              <Text style={[styles.headerTitle, { color: theme.text, textAlign }]}>
                {t('tracked_courses_config')}
              </Text>
              <Text style={[styles.headerSub, { color: theme.textSecondary, textAlign }]}>
                {language === 'he'
                  ? `${draftTrackedIds.length} קורסים נבחרו`
                  : `${draftTrackedIds.length} courses selected`}
              </Text>
            </View>

            <View style={[styles.headerActions, { flexDirection: rowDir }]}>
              <TouchableOpacity
                onPress={handleRefreshCourses}
                disabled={refreshing}
                style={[
                  styles.refreshBtn,
                  {
                    backgroundColor: theme.backgroundSelected,
                    borderColor: theme.border,
                    flexDirection: rowDir,
                  },
                ]}
              >
                {refreshing ? (
                  <ActivityIndicator size="small" color={theme.primary} />
                ) : (
                  <RefreshIcon size={15} color={theme.primary} />
                )}
                <Text style={[styles.refreshBtnText, { color: theme.text }]}>
                  {language === 'he' ? 'רענן קורסים' : 'Refresh Courses'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={onClose}
                style={[styles.closeBtn, { backgroundColor: theme.backgroundSelected }]}
                accessibilityLabel={t('cancel')}
              >
                <CloseIcon size={18} color={theme.text} />
              </TouchableOpacity>
            </View>
          </View>

          {errorMsg && (
            <View
              style={[
                styles.errorBanner,
                { backgroundColor: `${theme.danger}18`, borderColor: theme.danger },
              ]}
            >
              <Text style={[styles.errorText, { color: theme.danger, textAlign }]}>
                {errorMsg}
              </Text>
            </View>
          )}

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {refreshing && enrolledCourses.length === 0 ? (
              <View style={styles.loadingState}>
                <ActivityIndicator size="large" color={theme.primary} />
                <Text style={[styles.loadingText, { color: theme.textSecondary }]}>
                  {language === 'he' ? 'טוען קורסים ממודל...' : 'Loading Moodle courses...'}
                </Text>
              </View>
            ) : semesterGroups.length === 0 && !adminUmbrella ? (
              <View style={styles.loadingState}>
                <Text style={[styles.loadingText, { color: theme.textSecondary }]}>
                  {language === 'he'
                    ? 'לא נמצאו קורסים. לחץ על "רענן קורסים" כדי לטעון מהשרת.'
                    : 'No courses found. Tap "Refresh Courses" to fetch from Moodle.'}
                </Text>
              </View>
            ) : (
              <>
                {semesterGroups.map((group) => (
                  <View key={group.key} style={styles.groupSection}>
                    <Text
                      style={[
                        styles.groupTitle,
                        {
                          color: theme.text,
                          borderBottomColor: theme.border,
                          textAlign,
                        },
                      ]}
                    >
                      {group.label}
                    </Text>

                    <View style={styles.groupList}>
                      {group.courses.map((u, uIdx) => {
                        const isMainTracked = draftTrackedIds.includes(u.id);
                        const mainColor = getCourseColor(u.id, uIdx);
                        const childSubs = u.subCourses.filter((s) => s.courseId !== u.id);
                        const hasMultipleSubs = u.subCourses.length > 1;
                        const isLabMain = isLabCourseName(u.fullname, u.shortname);

                        return (
                          <View
                            key={u.id}
                            style={[
                              styles.courseCard,
                              {
                                backgroundColor: isMainTracked
                                  ? `${mainColor}12`
                                  : theme.backgroundElement,
                                borderColor: isMainTracked ? mainColor : theme.border,
                                borderWidth: isMainTracked ? 1.5 : 1,
                              },
                            ]}
                          >
                            {/* Main / Parent Row */}
                            <View style={[styles.courseTopRow, { flexDirection: rowDir }]}>
                              <TouchableOpacity
                                onPress={() =>
                                  toggleCourseSelection(u.id, u.fullname, u.shortname)
                                }
                                style={[
                                  styles.checkbox,
                                  {
                                    backgroundColor: isMainTracked
                                      ? mainColor
                                      : 'transparent',
                                    borderColor: isMainTracked
                                      ? mainColor
                                      : theme.textSecondary,
                                  },
                                ]}
                                accessibilityRole="checkbox"
                                accessibilityState={{ checked: isMainTracked }}
                              >
                                {isMainTracked && (
                                  <CheckIcon
                                    size={14}
                                    color={getReadableTextColor(mainColor)}
                                    strokeWidth={2.6}
                                  />
                                )}
                              </TouchableOpacity>

                              <TouchableOpacity
                                onPress={() =>
                                  toggleCourseSelection(u.id, u.fullname, u.shortname)
                                }
                                style={styles.courseInfoCol}
                              >
                                <View style={[styles.badgesWrap, { flexDirection: rowDir }]}>
                                  <Text
                                    style={[
                                      styles.courseCodeText,
                                      { color: theme.textSecondary },
                                    ]}
                                  >
                                    {u.courseCode}
                                  </Text>
                                  {hasMultipleSubs && (
                                    <View
                                      style={[
                                        styles.pillBadge,
                                        { backgroundColor: `${theme.primary}1F` },
                                      ]}
                                    >
                                      <Text
                                        style={[
                                          styles.pillBadgeText,
                                          { color: theme.primary },
                                        ]}
                                      >
                                        {t('main_portal_badge')}
                                      </Text>
                                    </View>
                                  )}
                                  {isLabMain && (
                                    <View
                                      style={[
                                        styles.pillBadge,
                                        {
                                          backgroundColor: `${theme.warning}22`,
                                          flexDirection: rowDir,
                                        },
                                      ]}
                                    >
                                      <FlaskIcon size={11} color={theme.warning} />
                                      <Text
                                        style={[
                                          styles.pillBadgeText,
                                          { color: theme.warning },
                                        ]}
                                      >
                                        {language === 'he' ? 'מעבדה' : 'Lab'}
                                      </Text>
                                    </View>
                                  )}
                                </View>
                                <Text
                                  style={[styles.courseNameText, { color: theme.text, textAlign }]}
                                >
                                  {u.fullname}
                                </Text>
                              </TouchableOpacity>

                              <TouchableOpacity
                                onPress={() =>
                                  setExpandedColorCourseId(
                                    expandedColorCourseId === u.id ? null : u.id
                                  )
                                }
                                style={[
                                  styles.colorTriggerBtn,
                                  {
                                    backgroundColor: theme.backgroundSelected,
                                    borderColor: theme.border,
                                    flexDirection: rowDir,
                                  },
                                ]}
                                accessibilityLabel={t('course_color')}
                              >
                                <View
                                  style={[styles.colorDotPreview, { backgroundColor: mainColor }]}
                                />
                                <PaletteIcon size={14} color={theme.textSecondary} />
                              </TouchableOpacity>
                            </View>

                            {/* Nickname input */}
                            {isMainTracked && (
                              <TextInput
                                value={draftNicknames[u.id] ?? ''}
                                onChangeText={(txt) =>
                                  setDraftNicknames((prev) => ({ ...prev, [u.id]: txt }))
                                }
                                placeholder={t('nickname_placeholder')}
                                placeholderTextColor={theme.placeholder}
                                style={[
                                  styles.nicknameInput,
                                  {
                                    backgroundColor: theme.background,
                                    borderColor: theme.border,
                                    color: theme.text,
                                    textAlign,
                                  },
                                ]}
                              />
                            )}

                            {renderColorPicker(u.id, mainColor, u.fullname)}

                            {/* Indented Child Sub-courses */}
                            {childSubs.length > 0 && (
                              <View
                                style={[
                                  styles.subCoursesList,
                                  {
                                    borderTopColor: theme.border,
                                    paddingLeft: isRtl ? 0 : 14,
                                    paddingRight: isRtl ? 14 : 0,
                                  },
                                ]}
                              >
                                {childSubs.map((sub, sIdx) => {
                                  const isSubTracked = draftTrackedIds.includes(sub.courseId);
                                  const subColor = getCourseColor(
                                    sub.courseId,
                                    uIdx + sIdx + 1
                                  );
                                  const isSubLab = isLabCourseName(
                                    sub.fullname,
                                    sub.shortname
                                  );
                                  const subDisplayTitle =
                                    cleanCourseDisplayName(sub.fullname) || sub.fullname;

                                  return (
                                    <View
                                      key={sub.courseId}
                                      style={[
                                        styles.subCourseBox,
                                        {
                                          backgroundColor: isSubTracked
                                            ? `${subColor}12`
                                            : theme.background,
                                          borderColor: isSubTracked
                                            ? subColor
                                            : theme.border,
                                        },
                                      ]}
                                    >
                                      <View
                                        style={[
                                          styles.courseTopRow,
                                          { flexDirection: rowDir },
                                        ]}
                                      >
                                        <TouchableOpacity
                                          onPress={() =>
                                            toggleCourseSelection(
                                              sub.courseId,
                                              sub.fullname,
                                              sub.shortname
                                            )
                                          }
                                          style={[
                                            styles.checkbox,
                                            {
                                              backgroundColor: isSubTracked
                                                ? subColor
                                                : 'transparent',
                                              borderColor: isSubTracked
                                                ? subColor
                                                : theme.textSecondary,
                                            },
                                          ]}
                                        >
                                          {isSubTracked && (
                                            <CheckIcon
                                              size={13}
                                              color={getReadableTextColor(subColor)}
                                              strokeWidth={2.6}
                                            />
                                          )}
                                        </TouchableOpacity>

                                        <TouchableOpacity
                                          onPress={() =>
                                            toggleCourseSelection(
                                              sub.courseId,
                                              sub.fullname,
                                              sub.shortname
                                            )
                                          }
                                          style={styles.courseInfoCol}
                                        >
                                          <View
                                            style={[
                                              styles.badgesWrap,
                                              { flexDirection: rowDir },
                                            ]}
                                          >
                                            {sub.groupId &&
                                              sub.groupId !== '00' &&
                                              sub.groupId !== '99' && (
                                                <View
                                                  style={[
                                                    styles.pillBadge,
                                                    {
                                                      backgroundColor:
                                                        theme.backgroundSelected,
                                                    },
                                                  ]}
                                                >
                                                  <Text
                                                    style={[
                                                      styles.pillBadgeText,
                                                      { color: theme.textSecondary },
                                                    ]}
                                                  >
                                                    {language === 'he'
                                                      ? `קבוצה ${sub.groupId}`
                                                      : `Group ${sub.groupId}`}
                                                  </Text>
                                                </View>
                                              )}
                                            {isSubLab && (
                                              <View
                                                style={[
                                                  styles.pillBadge,
                                                  {
                                                    backgroundColor: `${theme.warning}22`,
                                                    flexDirection: rowDir,
                                                  },
                                                ]}
                                              >
                                                <FlaskIcon size={11} color={theme.warning} />
                                                <Text
                                                  style={[
                                                    styles.pillBadgeText,
                                                    { color: theme.warning },
                                                  ]}
                                                >
                                                  {language === 'he' ? 'מעבדה' : 'Lab'}
                                                </Text>
                                              </View>
                                            )}
                                          </View>
                                          <Text
                                            style={[
                                              styles.subCourseNameText,
                                              { color: theme.text, textAlign },
                                            ]}
                                          >
                                            {subDisplayTitle}
                                          </Text>
                                        </TouchableOpacity>

                                        <TouchableOpacity
                                          onPress={() =>
                                            setExpandedColorCourseId(
                                              expandedColorCourseId === sub.courseId
                                                ? null
                                                : sub.courseId
                                            )
                                          }
                                          style={[
                                            styles.colorTriggerBtn,
                                            {
                                              backgroundColor: theme.backgroundSelected,
                                              borderColor: theme.border,
                                              flexDirection: rowDir,
                                            },
                                          ]}
                                        >
                                          <View
                                            style={[
                                              styles.colorDotPreview,
                                              { backgroundColor: subColor },
                                            ]}
                                          />
                                          <PaletteIcon
                                            size={13}
                                            color={theme.textSecondary}
                                          />
                                        </TouchableOpacity>
                                      </View>

                                      {isSubTracked && (
                                        <TextInput
                                          value={draftNicknames[sub.courseId] ?? ''}
                                          onChangeText={(txt) =>
                                            setDraftNicknames((prev) => ({
                                              ...prev,
                                              [sub.courseId]: txt,
                                            }))
                                          }
                                          placeholder={t('nickname_placeholder')}
                                          placeholderTextColor={theme.placeholder}
                                          style={[
                                            styles.nicknameInput,
                                            {
                                              backgroundColor: theme.backgroundElement,
                                              borderColor: theme.border,
                                              color: theme.text,
                                              textAlign,
                                            },
                                          ]}
                                        />
                                      )}

                                      {renderColorPicker(sub.courseId, subColor, subDisplayTitle)}
                                    </View>
                                  );
                                })}
                              </View>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  </View>
                ))}

                {/* Mode B: Administrative Umbrella (-5900) */}
                {adminUmbrella && adminUmbrella.subCourses.length > 0 && (
                  <View style={styles.groupSection}>
                    <View
                      style={[
                        styles.adminHeaderRow,
                        {
                          borderBottomColor: theme.border,
                          flexDirection: rowDir,
                        },
                      ]}
                    >
                      <View style={[styles.adminTitleWrap, { flexDirection: rowDir }]}>
                        <ShieldIcon size={17} color={theme.primary} />
                        <Text style={[styles.groupTitleNoBorder, { color: theme.text }]}>
                          {t('admin_umbrella_title')}
                        </Text>
                      </View>
                      <TouchableOpacity
                        onPress={handleToggleUmbrellaAll}
                        style={[
                          styles.umbrellaToggleBtn,
                          {
                            backgroundColor: theme.backgroundSelected,
                            borderColor: theme.border,
                          },
                        ]}
                      >
                        <Text style={[styles.umbrellaToggleText, { color: theme.primary }]}>
                          {adminUmbrella.subCourses.every((s) =>
                            draftTrackedIds.includes(s.courseId)
                          )
                            ? language === 'he'
                              ? 'בטל הכל'
                              : 'Deselect All'
                            : language === 'he'
                              ? 'בחר הכל'
                              : 'Select All'}
                        </Text>
                      </TouchableOpacity>
                    </View>

                    <View style={styles.groupList}>
                      {adminUmbrella.subCourses.map((sub, idx) => {
                        const isTracked = draftTrackedIds.includes(sub.courseId);
                        const subColor = getCourseColor(sub.courseId, idx + 8);
                        return (
                          <View
                            key={sub.courseId}
                            style={[
                              styles.courseCard,
                              {
                                backgroundColor: isTracked
                                  ? `${subColor}12`
                                  : theme.backgroundElement,
                                borderColor: isTracked ? subColor : theme.border,
                                borderWidth: isTracked ? 1.5 : 1,
                              },
                            ]}
                          >
                            <View style={[styles.courseTopRow, { flexDirection: rowDir }]}>
                              <TouchableOpacity
                                onPress={() =>
                                  toggleCourseSelection(
                                    sub.courseId,
                                    sub.fullname,
                                    sub.shortname
                                  )
                                }
                                style={[
                                  styles.checkbox,
                                  {
                                    backgroundColor: isTracked ? subColor : 'transparent',
                                    borderColor: isTracked
                                      ? subColor
                                      : theme.textSecondary,
                                  },
                                ]}
                              >
                                {isTracked && (
                                  <CheckIcon
                                    size={14}
                                    color={getReadableTextColor(subColor)}
                                    strokeWidth={2.6}
                                  />
                                )}
                              </TouchableOpacity>

                              <TouchableOpacity
                                onPress={() =>
                                  toggleCourseSelection(
                                    sub.courseId,
                                    sub.fullname,
                                    sub.shortname
                                  )
                                }
                                style={styles.courseInfoCol}
                              >
                                <View
                                  style={[styles.badgesWrap, { flexDirection: rowDir }]}
                                >
                                  <View
                                    style={[
                                      styles.pillBadge,
                                      { backgroundColor: theme.backgroundSelected },
                                    ]}
                                  >
                                    <Text
                                      style={[
                                        styles.pillBadgeText,
                                        { color: theme.textSecondary },
                                      ]}
                                    >
                                      {language === 'he' ? 'הדרכה' : 'Tutorial'}
                                    </Text>
                                  </View>
                                </View>
                                <Text
                                  style={[
                                    styles.courseNameText,
                                    { color: theme.text, textAlign },
                                  ]}
                                >
                                  {sub.fullname}
                                </Text>
                              </TouchableOpacity>

                              <TouchableOpacity
                                onPress={() =>
                                  setExpandedColorCourseId(
                                    expandedColorCourseId === sub.courseId
                                      ? null
                                      : sub.courseId
                                  )
                                }
                                style={[
                                  styles.colorTriggerBtn,
                                  {
                                    backgroundColor: theme.backgroundSelected,
                                    borderColor: theme.border,
                                    flexDirection: rowDir,
                                  },
                                ]}
                              >
                                <View
                                  style={[
                                    styles.colorDotPreview,
                                    { backgroundColor: subColor },
                                  ]}
                                />
                                <PaletteIcon size={14} color={theme.textSecondary} />
                              </TouchableOpacity>
                            </View>

                            {isTracked && (
                              <TextInput
                                value={draftNicknames[sub.courseId] ?? ''}
                                onChangeText={(txt) =>
                                  setDraftNicknames((prev) => ({
                                    ...prev,
                                    [sub.courseId]: txt,
                                  }))
                                }
                                placeholder={t('nickname_placeholder')}
                                placeholderTextColor={theme.placeholder}
                                style={[
                                  styles.nicknameInput,
                                  {
                                    backgroundColor: theme.background,
                                    borderColor: theme.border,
                                    color: theme.text,
                                    textAlign,
                                  },
                                ]}
                              />
                            )}

                            {renderColorPicker(sub.courseId, subColor, sub.fullname)}
                          </View>
                        );
                      })}
                    </View>
                  </View>
                )}
              </>
            )}
          </ScrollView>

          {/* Footer */}
          <View
            style={[
              styles.footer,
              {
                backgroundColor: theme.backgroundElement,
                borderTopColor: theme.border,
                flexDirection: rowDir,
              },
            ]}
          >
            <TouchableOpacity
              onPress={onClose}
              disabled={saving}
              style={[
                styles.cancelBtn,
                { backgroundColor: theme.backgroundSelected },
              ]}
            >
              <Text style={[styles.cancelBtnText, { color: theme.text }]}>
                {t('cancel')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleSave}
              disabled={saving}
              style={[styles.saveBtn, { backgroundColor: theme.primary, flexDirection: rowDir }]}
            >
              {saving ? (
                <ActivityIndicator size="small" color={theme.onPrimary} />
              ) : (
                <CheckIcon size={16} color={theme.onPrimary} strokeWidth={2.4} />
              )}
              <Text style={[styles.saveBtnText, { color: theme.onPrimary }]}>{t('save_btn')}</Text>
            </TouchableOpacity>
          </View>

          {/* Lab Course Bulk-Hide Prompt Overlay */}
          {labPromptCourse && (
            <View style={styles.labPromptBackdrop}>
              <View
                style={[
                  styles.labPromptCard,
                  {
                    backgroundColor: theme.backgroundElement,
                    borderColor: theme.warning,
                  },
                ]}
              >
                <View style={[styles.labPromptHeader, { flexDirection: rowDir }]}>
                  <FlaskIcon size={20} color={theme.warning} />
                  <Text style={[styles.labPromptTitle, { color: theme.text, textAlign }]}>
                    {t('lab_detected_title')}
                  </Text>
                </View>
                <Text style={[styles.labPromptCourseName, { color: theme.primary, textAlign }]}>
                  {labPromptCourse.title}
                </Text>
                <Text style={[styles.labPromptDesc, { color: theme.textSecondary, textAlign }]}>
                  {t('lab_detected_desc')}
                </Text>
                <View style={[styles.labPromptActions, { flexDirection: rowDir }]}>
                  <TouchableOpacity
                    onPress={() => setLabPromptCourse(null)}
                    style={[
                      styles.labBtn,
                      { backgroundColor: theme.backgroundSelected },
                    ]}
                  >
                    <Text style={[styles.labBtnText, { color: theme.text }]}>
                      {t('lab_detected_keep_btn')}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => {
                      const cid = labPromptCourse.courseId;
                      setLabHideQueue((prev) =>
                        prev.includes(cid) ? prev : [...prev, cid]
                      );
                      setLabPromptCourse(null);
                    }}
                    style={[styles.labBtn, { backgroundColor: theme.warning }]}
                  >
                    <Text style={[styles.labBtnText, { color: theme.onWarning }]}>
                      {t('lab_detected_hide_btn')}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}
        </SafeAreaView>
      </View>
      </KeyboardAvoidingView>

      <ColorPalettePickerModal
        visible={Boolean(paletteTarget)}
        initialColor={paletteTarget?.color || COURSE_COLOR_PALETTE[0]}
        courseName={paletteTarget?.courseName}
        onSelectColor={(hex) => {
          if (paletteTarget) {
            setDraftColors((prev) => ({
              ...prev,
              [paletteTarget.courseId]: hex,
            }));
          }
        }}
        onClose={() => setPaletteTarget(null)}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
  },
  tabletBackdrop: {
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalContainer: {
    overflow: 'hidden',
  },
  phoneFull: {
    flex: 1,
  },
  tabletCard: {
    width: '100%',
    maxWidth: 780,
    maxHeight: '88%',
    borderRadius: 20,
    borderWidth: 1,
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  headerTitleBlock: {
    flex: 1,
    gap: 2,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '800',
  },
  headerSub: {
    fontSize: 12,
    fontWeight: '500',
  },
  headerActions: {
    alignItems: 'center',
    gap: 8,
  },
  refreshBtn: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    gap: 6,
  },
  refreshBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBanner: {
    marginHorizontal: 16,
    marginTop: 10,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  errorText: {
    fontSize: 13,
    fontWeight: '600',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 18,
  },
  loadingState: {
    paddingVertical: 48,
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    textAlign: 'center',
  },
  groupSection: {
    gap: 10,
  },
  groupTitle: {
    fontSize: 15,
    fontWeight: '800',
    paddingBottom: 6,
    borderBottomWidth: 1,
  },
  groupTitleNoBorder: {
    fontSize: 15,
    fontWeight: '800',
  },
  adminHeaderRow: {
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 6,
    borderBottomWidth: 1,
    gap: 8,
  },
  adminTitleWrap: {
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  umbrellaToggleBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  umbrellaToggleText: {
    fontSize: 12,
    fontWeight: '700',
  },
  groupList: {
    gap: 10,
  },
  courseCard: {
    borderRadius: 14,
    padding: 12,
    gap: 10,
  },
  courseTopRow: {
    alignItems: 'center',
    gap: 10,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  courseInfoCol: {
    flex: 1,
    gap: 3,
  },
  badgesWrap: {
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  courseCodeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  pillBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    alignItems: 'center',
    gap: 4,
  },
  pillBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  courseNameText: {
    fontSize: 14,
    fontWeight: '700',
  },
  subCourseNameText: {
    fontSize: 13,
    fontWeight: '600',
  },
  colorTriggerBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    gap: 5,
  },
  colorDotPreview: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  nicknameInput: {
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 11,
    paddingVertical: 8,
    fontSize: 13,
  },
  swatchesRow: {
    gap: 8,
    paddingVertical: 2,
    alignItems: 'center',
  },
  swatchCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  customColorBtn: {
    height: 26,
    paddingHorizontal: 8,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  subCoursesList: {
    marginTop: 4,
    paddingTop: 10,
    borderTopWidth: 1,
    gap: 8,
  },
  subCourseBox: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    gap: 8,
  },
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
  },
  cancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 10,
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  saveBtn: {
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: 'center',
    gap: 6,
  },
  saveBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  labPromptBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  labPromptCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 18,
    gap: 10,
  },
  labPromptHeader: {
    alignItems: 'center',
    gap: 8,
  },
  labPromptTitle: {
    fontSize: 16,
    fontWeight: '800',
    flex: 1,
  },
  labPromptCourseName: {
    fontSize: 14,
    fontWeight: '700',
  },
  labPromptDesc: {
    fontSize: 13,
    lineHeight: 19,
  },
  labPromptActions: {
    marginTop: 6,
    gap: 10,
    justifyContent: 'flex-end',
  },
  labBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 9,
  },
  labBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
});
