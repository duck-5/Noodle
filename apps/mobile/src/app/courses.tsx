import React, { useState, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  LayoutAnimation,
  Alert,
  Linking,
  Modal,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { parseTauCourseMetadata } from '@tautracker/moodle-client';
import { downloadMoodleFile } from '../services/fileDownloadService';
import { getDb, getPreference, setPreference } from '../services/database';
import { t, getLanguage } from '../services/i18n';
import { useTheme } from '../hooks/use-theme';
import { markSettingUpdatedAndSync } from '../services/settingsSyncService';
import { getDueTextAndClass } from '../services/dateUtils';

const PRESETS = [
  '#6366f1', // Indigo
  '#3b82f6', // Blue
  '#06b6d4', // Cyan
  '#0d9488', // Teal
  '#10b981', // Emerald
  '#84cc16', // Lime
  '#f59e0b', // Amber
  '#ea580c', // Orange
  '#ef4444', // Red
  '#ec4899', // Pink
  '#d946ef', // Fuchsia
  '#8b5cf6', // Violet
  '#a855f7', // Purple
  '#64748b', // Slate
];

interface CoursesScreenProps {
  activeCourseId?: number | null;
  setActiveCourseId?: (id: number | null) => void;
}

interface GroupedCourses {
  semesterKey: string;
  year: string;
  semester: 'SemesterA' | 'SemesterB' | 'Yearly' | 'Other';
  label: string;
  courses: any[];
}

function groupAndSortCourses(courses: any[], lang: 'he' | 'en'): GroupedCourses[] {
  const groups: Record<string, any[]> = {};

  courses.forEach((c) => {
    const idNum = c.course_id || c.idnumber || c.shortname || '';
    const meta = parseTauCourseMetadata(idNum);
    const year = meta?.year || c.year || '';
    const semester = meta?.semester || c.semester || 'Other';

    const key = year ? `${year}-${semester}` : 'Other';
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(c);
  });

  const result: GroupedCourses[] = [];

  Object.keys(groups).forEach((key) => {
    if (key === 'Other') {
      result.push({
        semesterKey: 'Other',
        year: '',
        semester: 'Other',
        label: lang === 'he' ? 'אחר' : 'Other',
        courses: groups[key],
      });
    } else {
      const [year, semester] = key.split('-');
      let label = '';
      if (lang === 'he') {
        const semName =
          semester === 'SemesterA'
            ? "סמסטר א'"
            : semester === 'SemesterB'
            ? "סמסטר ב'"
            : semester === 'Yearly'
            ? 'שנתי'
            : 'אחר';
        label = `${semName} (${year})`;
      } else {
        const semName =
          semester === 'SemesterA'
            ? 'Semester A'
            : semester === 'SemesterB'
            ? 'Semester B'
            : semester === 'Yearly'
            ? 'Yearly'
            : 'Other';
        label = `${semName} (${year})`;
      }
      result.push({
        semesterKey: key,
        year,
        semester: semester as any,
        label,
        courses: groups[key],
      });
    }
  });

  result.sort((a, b) => {
    if (a.semesterKey === 'Other') return 1;
    if (b.semesterKey === 'Other') return -1;

    const yearDiff = parseInt(b.year, 10) - parseInt(a.year, 10);
    if (!isNaN(yearDiff) && yearDiff !== 0) return yearDiff;

    const getSemValue = (sem: string) => {
      if (sem === 'SemesterB') return 3;
      if (sem === 'SemesterA') return 2;
      if (sem === 'Yearly') return 1;
      return 0;
    };

    return getSemValue(b.semester) - getSemValue(a.semester);
  });

  return result;
}

function formatFileSize(bytes?: number): string {
  if (!bytes || isNaN(bytes)) return '';
  if (bytes >= 1024 * 1024) {
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
  return Math.round(bytes / 1024) + ' KB';
}

interface EditingCourseState {
  id: number;
  moodle_id: number;
  course_id: string;
  name: string;
  color: string;
  is_active: number;
}

export default function CoursesScreen({
  activeCourseId: propActiveCourseId,
  setActiveCourseId: propSetActiveCourseId,
}: CoursesScreenProps) {
  const theme = useTheme();

  // Internal active course state fallback for standalone routing
  const [internalActiveId, setInternalActiveId] = useState<number | null>(null);
  const activeCourseId = propActiveCourseId !== undefined ? propActiveCourseId : internalActiveId;
  const setActiveCourseId = useCallback(
    (id: number | null) => {
      if (propSetActiveCourseId) {
        propSetActiveCourseId(id);
      } else {
        setInternalActiveId(id);
      }
    },
    [propSetActiveCourseId]
  );

  const [courses, setCourses] = useState<any[]>([]);
  const [configExpanded, setConfigExpanded] = useState<boolean>(false);
  const [interestedMeetings, setInterestedMeetings] = useState<string[]>([]);
  const [expandedZoom, setExpandedZoom] = useState<boolean>(false);

  // Detail screen state
  const [activeDetailTab, setActiveDetailTab] = useState<'content' | 'assignments'>('content');
  const [activeSectionName, setActiveSectionName] = useState<string | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

  // Editing Course Modal State
  const [editingCourse, setEditingCourse] = useState<EditingCourseState | null>(null);
  const [customHexInput, setCustomHexInput] = useState<string>('');

  const lang = getLanguage();
  const isRtl = lang === 'he';

  useFocusEffect(
    useCallback(() => {
      loadCourses();
      loadInterestedMeetings();
    }, [])
  );

  function loadInterestedMeetings() {
    try {
      const interestedStr = getPreference('interested_meetings') || '';
      let interestedList: string[] = [];
      if (interestedStr) {
        try {
          interestedList = JSON.parse(interestedStr);
        } catch (e) {}
      }
      setInterestedMeetings(interestedList);
    } catch (e) {
      console.error(e);
    }
  }

  const handleToggleMeetingInterest = (meetingId: string) => {
    let updated: string[];
    if (interestedMeetings.includes(meetingId)) {
      updated = interestedMeetings.filter((id) => id !== meetingId);
    } else {
      updated = [...interestedMeetings, meetingId];
    }
    setInterestedMeetings(updated);
    setPreference('interested_meetings', JSON.stringify(updated));
  };

  function loadCourses() {
    try {
      const db = getDb();
      const rows = db.getAllSync<any>('SELECT * FROM tracked_courses');
      setCourses(rows);
    } catch (e) {
      console.error('loadCourses error:', e);
    }
  }

  const handleToggleActive = (id: number, currentVal: number) => {
    try {
      const db = getDb();
      const newVal = currentVal === 1 ? 0 : 1;
      db.runSync('UPDATE tracked_courses SET is_active = ? WHERE id = ?', [newVal, id]);
      markSettingUpdatedAndSync(['trackedCourseIds']);
      loadCourses();
    } catch (e) {
      console.error(e);
    }
  };

  const handleUpdateName = (id: number, text: string) => {
    try {
      const db = getDb();
      db.runSync('UPDATE tracked_courses SET name = ? WHERE id = ?', [text, id]);
      markSettingUpdatedAndSync(['coursesCustomNames']);
      setCourses(courses.map((c) => (c.id === id ? { ...c, name: text } : c)));
    } catch (e) {
      console.error(e);
    }
  };

  const handleSelectColor = (id: number, color: string) => {
    try {
      const db = getDb();
      db.runSync('UPDATE tracked_courses SET color = ? WHERE id = ?', [color, id]);
      markSettingUpdatedAndSync(['coursesColorMap']);
      loadCourses();
    } catch (e) {
      console.error(e);
    }
  };

  const openEditModal = (c: any) => {
    setEditingCourse({
      id: c.id,
      moodle_id: c.moodle_id,
      course_id: c.course_id || '',
      name: c.name || '',
      color: c.color || '#6366f1',
      is_active: c.is_active ?? 1,
    });
    setCustomHexInput(c.color || '#6366f1');
  };

  const saveEditingModal = () => {
    if (!editingCourse) return;
    try {
      const db = getDb();
      let colorToSave = editingCourse.color.trim();
      if (/^#[0-9A-Fa-f]{6}$/.test(customHexInput.trim())) {
        colorToSave = customHexInput.trim();
      }
      db.runSync('UPDATE tracked_courses SET name = ?, color = ?, is_active = ? WHERE id = ?', [
        editingCourse.name,
        colorToSave,
        editingCourse.is_active,
        editingCourse.id,
      ]);
      markSettingUpdatedAndSync(['trackedCourseIds', 'coursesCustomNames', 'coursesColorMap']);
      loadCourses();
      setEditingCourse(null);
    } catch (e) {
      console.error('Error saving course changes:', e);
      Alert.alert(isRtl ? 'שגיאה' : 'Error', String(e));
    }
  };

  async function handleDownloadFile(file: any) {
    const res = await downloadMoodleFile(file);
    if (!res.success && res.error) {
      Alert.alert(t('download'), res.error);
    }
  }

  // ==========================================
  // 1. COURSE DETAIL VIEW
  // ==========================================
  if (activeCourseId) {
    const course = courses.find((c) => c.moodle_id === activeCourseId);
    if (!course) {
      return (
        <View style={[styles.container, { backgroundColor: theme.background }]}>
          <View style={{ padding: 32, alignItems: 'center' }}>
            <Text style={{ color: theme.text, fontSize: 16, marginBottom: 12 }}>
              {isRtl ? 'הקורס לא נמצא.' : 'Course not found.'}
            </Text>
            <Pressable
              style={[styles.primaryBtn, { backgroundColor: theme.primary, paddingHorizontal: 20, paddingVertical: 10 }]}
              onPress={() => setActiveCourseId(null)}
            >
              <Text style={{ color: '#ffffff', fontWeight: 'bold' }}>{t('back_btn')}</Text>
            </Pressable>
          </View>
        </View>
      );
    }

    const courseColor = course.color || theme.primary;
    const db = getDb();

    // Load ALL assignments for this course
    const courseAssignments = db.getAllSync<any>(
      'SELECT * FROM assignments WHERE course_moodle_id = ? ORDER BY deadline ASC',
      [course.moodle_id]
    );
    const courseFiles = db.getAllSync<any>(
      'SELECT * FROM files WHERE course_moodle_id = ?',
      [course.moodle_id]
    );
    const courseMeetings = db.getAllSync<any>(
      'SELECT * FROM meetings WHERE course_moodle_id = ?',
      [course.moodle_id]
    );

    // Group files and assignments by sectionName
    const sectionsMap: Record<string, { assignments: any[]; files: any[]; meetings: any[] }> = {};
    const getSection = (name: string) => {
      const n = name || (isRtl ? 'כללי' : 'General');
      if (!sectionsMap[n]) sectionsMap[n] = { assignments: [], files: [], meetings: [] };
      return sectionsMap[n];
    };
    courseFiles.forEach((f: any) => getSection(f.section_name).files.push(f));
    courseAssignments.forEach((a: any) => getSection(a.section_name || (isRtl ? 'כללי' : 'General')).assignments.push(a));
    courseMeetings.forEach((m: any) => getSection(m.section_name || (isRtl ? 'כללי' : 'General')).meetings.push(m));
    const allSectionEntries = Object.entries(sectionsMap);

    // Filter section entries if user selected a specific section pill
    const sectionEntries = activeSectionName
      ? allSectionEntries.filter(([secName]) => secName === activeSectionName)
      : allSectionEntries;

    // Calculate course assignment stats
    const totalAssignments = courseAssignments.length;
    const submittedCount = courseAssignments.filter((a) => a.status === 'Submitted').length;
    const pendingCount = totalAssignments - submittedCount;
    const gradedAssignments = courseAssignments.filter(
      (a) => a.grade !== null && a.grade !== undefined && a.grade_max
    );
    const avgGrade =
      gradedAssignments.length > 0
        ? Math.round(
            gradedAssignments.reduce(
              (sum, a) => sum + (Number(a.grade) / Number(a.grade_max)) * 100,
              0
            ) / gradedAssignments.length
          )
        : null;

    // Zoom deduplication
    const now = new Date();
    const groups = new Map<string, typeof courseMeetings>();
    courseMeetings.forEach((m) => {
      const key = m.meeting_number || m.meeting_url;
      if (!key) return;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(m);
    });

    const dedupedMeetings: typeof courseMeetings = [];
    for (const [, list] of groups.entries()) {
      if (list.length <= 1) {
        dedupedMeetings.push(list[0]);
        continue;
      }
      const future = list.filter((m) => m.start_time && new Date(m.start_time) >= now);
      const past = list.filter((m) => m.start_time && new Date(m.start_time) < now);
      const noTime = list.filter((m) => !m.start_time);

      if (future.length > 0) {
        future.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
        dedupedMeetings.push(future[0]);
      } else if (past.length > 0) {
        past.sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());
        dedupedMeetings.push(past[0]);
      } else if (noTime.length > 0) {
        dedupedMeetings.push(noTime[0]);
      }
    }

    const isMarked = (m: any) => {
      const keyId = m.meeting_number || m.meeting_url;
      return interestedMeetings.includes(keyId);
    };
    const markedMeetings = dedupedMeetings.filter(isMarked);

    const getMeetingStatusText = (startTimeStr?: string) => {
      if (!startTimeStr) return 'unknown';
      const startTime = new Date(startTimeStr);
      if (isNaN(startTime.getTime())) return 'unknown';
      const endTime = new Date(startTime.getTime() + 2 * 60 * 60 * 1000);
      if (now >= startTime && now <= endTime) {
        return 'active';
      } else {
        return 'inactive';
      }
    };

    const toggleCollapseSection = (secName: string) => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setCollapsedSections((prev) => ({
        ...prev,
        [secName]: !prev[secName],
      }));
    };

    const toggleCollapseAll = () => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      const areAllCollapsed = allSectionEntries.every(([name]) => collapsedSections[name]);
      const nextState: Record<string, boolean> = {};
      allSectionEntries.forEach(([name]) => {
        nextState[name] = !areAllCollapsed;
      });
      setCollapsedSections(nextState);
    };

    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        {/* Course Color Top Accent */}
        <View style={{ height: 4, backgroundColor: courseColor }} />

        {/* Header */}
        <View
          style={[
            styles.detailHeader,
            {
              borderBottomColor: theme.border,
              flexDirection: isRtl ? 'row-reverse' : 'row',
              alignItems: 'center',
            },
          ]}
        >
          <Pressable
            style={styles.headerBtn}
            onPress={() => {
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              setActiveCourseId(null);
            }}
          >
            <Text style={{ color: theme.primary, fontSize: 16, fontWeight: 'bold' }}>
              {isRtl ? '← חזור' : '← Back'}
            </Text>
          </Pressable>

          <View style={{ flex: 1, marginHorizontal: 8 }}>
            <Text
              style={[
                styles.headerTitle,
                { color: theme.text, textAlign: isRtl ? 'right' : 'left' },
              ]}
              numberOfLines={1}
            >
              {course.name}
            </Text>
            <Text
              style={{
                color: theme.textSecondary,
                fontSize: 12,
                textAlign: isRtl ? 'right' : 'left',
              }}
            >
              {course.course_id || `Moodle ID: ${course.moodle_id}`}
            </Text>
          </View>

          {/* Action Buttons: Moodle & Edit */}
          <View style={{ flexDirection: isRtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 6 }}>
            <Pressable
              style={[styles.smallActionBtn, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
              onPress={() => Linking.openURL(`https://moodle.tau.ac.il/course/view.php?id=${course.moodle_id}`)}
            >
              <Text style={{ color: theme.primary, fontSize: 12, fontWeight: 'bold' }}>
                {isRtl ? 'מודל ↗' : 'Moodle ↗'}
              </Text>
            </Pressable>

            <Pressable
              style={[styles.smallActionBtn, { borderColor: courseColor, backgroundColor: theme.backgroundElement }]}
              onPress={() => openEditModal(course)}
            >
              <Text style={{ color: courseColor, fontSize: 12, fontWeight: 'bold' }}>
                ✏️ {isRtl ? 'ערוך' : 'Edit'}
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Segmented Switcher: Course Content vs. Assignments & Grades */}
        <View
          style={[
            styles.tabBarContainer,
            {
              backgroundColor: theme.backgroundElement,
              borderBottomColor: theme.border,
              flexDirection: isRtl ? 'row-reverse' : 'row',
            },
          ]}
        >
          <Pressable
            style={[
              styles.tabBarBtn,
              activeDetailTab === 'content' && {
                borderBottomColor: courseColor,
                borderBottomWidth: 3,
              },
            ]}
            onPress={() => {
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              setActiveDetailTab('content');
            }}
          >
            <Text
              style={[
                styles.tabBarText,
                {
                  color: activeDetailTab === 'content' ? courseColor : theme.textSecondary,
                  fontWeight: activeDetailTab === 'content' ? 'bold' : 'normal',
                },
              ]}
            >
              📚 {t('course_content')}
            </Text>
          </Pressable>

          <Pressable
            style={[
              styles.tabBarBtn,
              activeDetailTab === 'assignments' && {
                borderBottomColor: courseColor,
                borderBottomWidth: 3,
              },
            ]}
            onPress={() => {
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              setActiveDetailTab('assignments');
            }}
          >
            <Text
              style={[
                styles.tabBarText,
                {
                  color: activeDetailTab === 'assignments' ? courseColor : theme.textSecondary,
                  fontWeight: activeDetailTab === 'assignments' ? 'bold' : 'normal',
                },
              ]}
            >
              📝 {t('assignments_and_grades')} ({courseAssignments.length})
            </Text>
          </Pressable>
        </View>

        <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 40 }}>
          {/* ========================================================= */}
          {/* TAB 1: COURSE CONTENT (Zoom, Sections, Pills, Files, etc.) */}
          {/* ========================================================= */}
          {activeDetailTab === 'content' && (
            <>
              {/* Zoom Section */}
              <View
                style={{
                  marginBottom: 16,
                  backgroundColor: theme.backgroundElement,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: theme.border,
                  overflow: 'hidden',
                }}
              >
                <Pressable
                  style={{
                    padding: 14,
                    flexDirection: isRtl ? 'row-reverse' : 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                  onPress={() => {
                    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                    setExpandedZoom(!expandedZoom);
                  }}
                >
                  <View style={{ flex: 1, alignItems: isRtl ? 'flex-end' : 'flex-start', gap: 4 }}>
                    <Text
                      style={{
                        color: courseColor,
                        fontWeight: 'bold',
                        fontSize: 16,
                        textAlign: isRtl ? 'right' : 'left',
                      }}
                    >
                      📹 {isRtl ? 'זום' : 'Zoom'}
                    </Text>

                    {(() => {
                      const activeMeeting = dedupedMeetings.find((m) => {
                        if (!m.start_time) return false;
                        const startTime = new Date(m.start_time);
                        if (isNaN(startTime.getTime())) return false;
                        const endTime = new Date(startTime.getTime() + 2 * 60 * 60 * 1000);
                        return now >= startTime && now <= endTime;
                      });
                      if (!activeMeeting) return null;
                      return (
                        <View
                          style={{
                            marginTop: 4,
                            flexDirection: isRtl ? 'row-reverse' : 'row',
                            flexWrap: 'wrap',
                            alignItems: 'center',
                            gap: 6,
                          }}
                        >
                          <Text style={{ color: theme.secondary, fontSize: 13, fontWeight: 'bold' }}>
                            {isRtl ? '● זום פעיל כעת:' : '● Active Now:'}
                          </Text>
                          <Pressable
                            onPress={() => activeMeeting.meeting_url && Linking.openURL(activeMeeting.meeting_url)}
                          >
                            <Text
                              style={{
                                color: courseColor,
                                fontSize: 13,
                                fontWeight: 'bold',
                                textDecorationLine: 'underline',
                              }}
                            >
                              {activeMeeting.title || 'Zoom'}
                            </Text>
                          </Pressable>
                        </View>
                      );
                    })()}

                    {/* Marked Quick buttons */}
                    {markedMeetings.length > 0 && (
                      <View
                        style={{
                          flexDirection: 'column',
                          gap: 4,
                          marginTop: 4,
                          alignItems: isRtl ? 'flex-end' : 'flex-start',
                        }}
                      >
                        {markedMeetings.map((m, idx) => (
                          <Pressable
                            key={idx}
                            onPress={() => m.meeting_url && Linking.openURL(m.meeting_url)}
                          >
                            <Text
                              style={{
                                color: theme.text,
                                fontSize: 13,
                                textDecorationLine: 'underline',
                                textDecorationColor: courseColor,
                                textAlign: isRtl ? 'right' : 'left',
                              }}
                            >
                              {m.title || 'Zoom'}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    )}
                  </View>

                  <Text style={{ color: theme.textSecondary, fontSize: 14 }}>
                    {expandedZoom ? '▲' : '▼'}
                  </Text>
                </Pressable>

                {expandedZoom && (
                  <View
                    style={{
                      paddingHorizontal: 14,
                      paddingBottom: 14,
                      borderTopWidth: 1,
                      borderTopColor: theme.border,
                      paddingTop: 10,
                    }}
                  >
                    {dedupedMeetings.length === 0 ? (
                      <View style={{ paddingVertical: 12, alignItems: 'center' }}>
                        <Text style={{ color: theme.textSecondary, fontSize: 13 }}>
                          {isRtl ? 'לא נמצאו פגישות זום עבור קורס זה.' : 'No Zoom meetings found for this course.'}
                        </Text>
                      </View>
                    ) : (
                      dedupedMeetings.map((m) => {
                        const status = getMeetingStatusText(m.start_time);
                        const isCurrentlyMarked = isMarked(m);
                        const isActive = status === 'active';
                        const isInactive = status === 'inactive';

                        let statusLabel = '';
                        let statusColor = theme.textSecondary;
                        if (isActive) {
                          statusLabel = isRtl ? '● פעיל כעת' : '● Active Now';
                          statusColor = theme.secondary;
                        } else if (isInactive && m.start_time) {
                          statusLabel = isRtl ? 'הסתיים / לא פעיל' : 'Finished / Inactive';
                        }

                        return (
                          <View
                            key={m.id}
                            style={{
                              flexDirection: isRtl ? 'row-reverse' : 'row',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              padding: 10,
                              backgroundColor: theme.background,
                              borderRadius: 8,
                              marginBottom: 8,
                              opacity: isInactive ? 0.6 : 1,
                              borderRightWidth: isRtl ? (isActive ? 3 : 0) : 0,
                              borderLeftWidth: !isRtl ? (isActive ? 3 : 0) : 0,
                              borderRightColor: isActive ? theme.secondary : 'transparent',
                              borderLeftColor: isActive ? theme.secondary : 'transparent',
                            }}
                          >
                            <View style={{ flex: 1, alignItems: isRtl ? 'flex-end' : 'flex-start' }}>
                              <View
                                style={{
                                  flexDirection: isRtl ? 'row-reverse' : 'row',
                                  alignItems: 'center',
                                  gap: 6,
                                }}
                              >
                                <Text style={{ color: theme.text, fontWeight: 'bold', fontSize: 14 }}>
                                  {m.title || 'Zoom'}
                                </Text>
                                {statusLabel ? (
                                  <Text style={{ color: statusColor, fontSize: 11, fontWeight: 'bold' }}>
                                    {statusLabel}
                                  </Text>
                                ) : null}
                              </View>
                              <Text style={{ color: theme.textSecondary, fontSize: 12, marginTop: 2 }}>
                                {m.section_name || 'General'}
                              </Text>
                              {m.start_time ? (
                                <Text style={{ color: theme.textSecondary, fontSize: 11, marginTop: 2 }}>
                                  📅 {new Date(m.start_time).toLocaleString(lang === 'he' ? 'he-IL' : 'en-US')}
                                </Text>
                              ) : null}
                            </View>

                            <View
                              style={{
                                flexDirection: isRtl ? 'row-reverse' : 'row',
                                alignItems: 'center',
                                gap: 10,
                              }}
                            >
                              <Pressable
                                style={{ padding: 6 }}
                                onPress={() => {
                                  const keyId = m.meeting_number || m.meeting_url;
                                  if (keyId) handleToggleMeetingInterest(keyId);
                                }}
                              >
                                <Text
                                  style={{
                                    fontSize: 18,
                                    opacity: isCurrentlyMarked ? 1 : 0.3,
                                    color: theme.primary,
                                  }}
                                >
                                  👁️
                                </Text>
                              </Pressable>

                              {m.meeting_url && (
                                <Pressable
                                  style={[styles.primaryBtn, { backgroundColor: courseColor, paddingHorizontal: 10, paddingVertical: 6 }]}
                                  onPress={() => Linking.openURL(m.meeting_url)}
                                >
                                  <Text style={{ color: '#ffffff', fontSize: 11, fontWeight: 'bold' }}>
                                    {t('join_zoom')}
                                  </Text>
                                </Pressable>
                              )}
                            </View>
                          </View>
                        );
                      })
                    )}
                  </View>
                )}
              </View>

              {/* Subjects Navigation Pill Bar */}
              {allSectionEntries.length > 0 && (
                <View style={{ marginBottom: 14 }}>
                  <View
                    style={{
                      flexDirection: isRtl ? 'row-reverse' : 'row',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 8,
                    }}
                  >
                    <Text style={{ color: theme.textSecondary, fontSize: 13, fontWeight: 'bold' }}>
                      {t('navigate_subjects')}
                    </Text>

                    <Pressable onPress={toggleCollapseAll} style={{ paddingVertical: 2, paddingHorizontal: 6 }}>
                      <Text style={{ color: theme.primary, fontSize: 12, fontWeight: 'bold' }}>
                        {allSectionEntries.every(([n]) => collapsedSections[n])
                          ? t('expand_all')
                          : t('collapse_all')}
                      </Text>
                    </Pressable>
                  </View>

                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{
                      flexDirection: isRtl ? 'row-reverse' : 'row',
                      gap: 8,
                      paddingVertical: 2,
                    }}
                  >
                    {/* All Subjects Pill */}
                    <Pressable
                      style={[
                        styles.navPill,
                        {
                          backgroundColor: activeSectionName === null ? courseColor : theme.backgroundElement,
                          borderColor: activeSectionName === null ? courseColor : theme.border,
                        },
                      ]}
                      onPress={() => {
                        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                        setActiveSectionName(null);
                      }}
                    >
                      <Text
                        style={{
                          color: activeSectionName === null ? '#ffffff' : theme.text,
                          fontWeight: activeSectionName === null ? 'bold' : 'normal',
                          fontSize: 12,
                        }}
                      >
                        {t('all_subjects')}
                      </Text>
                    </Pressable>

                    {/* Section Pills */}
                    {allSectionEntries.map(([secName]) => {
                      const isSelected = activeSectionName === secName;
                      return (
                        <Pressable
                          key={secName}
                          style={[
                            styles.navPill,
                            {
                              backgroundColor: isSelected ? courseColor : theme.backgroundElement,
                              borderColor: isSelected ? courseColor : theme.border,
                            },
                          ]}
                          onPress={() => {
                            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                            setActiveSectionName(isSelected ? null : secName);
                          }}
                        >
                          <Text
                            style={{
                              color: isSelected ? '#ffffff' : theme.text,
                              fontWeight: isSelected ? 'bold' : 'normal',
                              fontSize: 12,
                            }}
                          >
                            {secName}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              )}

              {/* Section Accordions */}
              {sectionEntries.length === 0 ? (
                <View style={[styles.emptyCard, { backgroundColor: theme.backgroundElement }]}>
                  <Text style={{ color: theme.textSecondary, textAlign: 'center' }}>
                    {t('empty_sections')}
                  </Text>
                </View>
              ) : (
                sectionEntries.map(([secName, content], secIdx) => {
                  const isCollapsed = Boolean(collapsedSections[secName]);
                  const itemCount = content.assignments.length + content.files.length;

                  return (
                    <View
                      key={secIdx}
                      style={[
                        styles.sectionCard,
                        {
                          backgroundColor: theme.backgroundElement,
                          borderColor: theme.border,
                        },
                      ]}
                    >
                      {/* Section Title Header */}
                      <Pressable
                        style={[
                          styles.sectionHeader,
                          {
                            flexDirection: isRtl ? 'row-reverse' : 'row',
                            borderBottomColor: isCollapsed ? 'transparent' : theme.border,
                            borderBottomWidth: isCollapsed ? 0 : 1,
                          },
                        ]}
                        onPress={() => toggleCollapseSection(secName)}
                      >
                        <View
                          style={{
                            flex: 1,
                            flexDirection: isRtl ? 'row-reverse' : 'row',
                            alignItems: 'center',
                            gap: 8,
                          }}
                        >
                          <Text
                            style={{
                              color: theme.text,
                              fontWeight: 'bold',
                              fontSize: 15,
                              textAlign: isRtl ? 'right' : 'left',
                            }}
                          >
                            {secName}
                          </Text>
                          <View
                            style={{
                              backgroundColor: theme.background,
                              paddingHorizontal: 6,
                              paddingVertical: 2,
                              borderRadius: 10,
                            }}
                          >
                            <Text style={{ color: theme.textSecondary, fontSize: 11 }}>{itemCount}</Text>
                          </View>
                        </View>

                        <View style={{ flexDirection: isRtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 10 }}>
                          <Pressable
                            style={[styles.smallActionBtn, { backgroundColor: theme.background, borderColor: theme.border }]}
                            onPress={(e) => {
                              e.stopPropagation();
                              Linking.openURL(`https://moodle.tau.ac.il/course/view.php?id=${course.moodle_id}`);
                            }}
                          >
                            <Text style={{ color: theme.primary, fontSize: 11 }}>{isRtl ? 'מודל ↗' : 'Moodle ↗'}</Text>
                          </Pressable>
                          <Text style={{ color: theme.textSecondary, fontSize: 14 }}>
                            {isCollapsed ? '▼' : '▲'}
                          </Text>
                        </View>
                      </Pressable>

                      {/* Section Body */}
                      {!isCollapsed && (
                        <View style={{ padding: 12, gap: 10 }}>
                          {/* Section Assignments */}
                          {content.assignments.map((a) => {
                            const { deadlineText, badgeClass } = getDueTextAndClass(
                              a.deadline,
                              lang,
                              7,
                              3,
                              false,
                              a.status
                            );

                            let badgeBg = theme.border;
                            let badgeFg = theme.text;
                            if (badgeClass === 'badge-success') {
                              badgeBg = 'rgba(16, 185, 129, 0.15)';
                              badgeFg = '#10b981';
                            } else if (badgeClass === 'badge-warning') {
                              badgeBg = 'rgba(245, 158, 11, 0.15)';
                              badgeFg = '#f59e0b';
                            } else if (badgeClass === 'badge-danger') {
                              badgeBg = 'rgba(239, 68, 68, 0.15)';
                              badgeFg = '#ef4444';
                            }

                            let attachments: any[] = [];
                            try {
                              attachments =
                                typeof a.attachments === 'string'
                                  ? JSON.parse(a.attachments)
                                  : a.attachments || [];
                            } catch (e) {
                              attachments = [];
                            }

                            return (
                              <View
                                key={a.id}
                                style={{
                                  backgroundColor: theme.background,
                                  borderRadius: 10,
                                  padding: 12,
                                  borderWidth: 1,
                                  borderColor: theme.border,
                                }}
                              >
                                <View
                                  style={{
                                    flexDirection: isRtl ? 'row-reverse' : 'row',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    marginBottom: 6,
                                  }}
                                >
                                  <View
                                    style={{
                                      flexDirection: isRtl ? 'row-reverse' : 'row',
                                      alignItems: 'center',
                                      gap: 6,
                                    }}
                                  >
                                    <Text style={{ fontSize: 13 }}>📝</Text>
                                    <Text
                                      style={{
                                        color: theme.textSecondary,
                                        fontSize: 12,
                                        fontWeight: '600',
                                      }}
                                    >
                                      {isRtl ? 'מטלה' : 'Assignment'}
                                    </Text>
                                  </View>

                                  <View
                                    style={{
                                      backgroundColor: badgeBg,
                                      paddingHorizontal: 8,
                                      paddingVertical: 3,
                                      borderRadius: 8,
                                    }}
                                  >
                                    <Text style={{ color: badgeFg, fontSize: 11, fontWeight: 'bold' }}>
                                      {a.status === 'Submitted' ? t('submitted_badge') : deadlineText}
                                    </Text>
                                  </View>
                                </View>

                                <Text
                                  style={{
                                    color: theme.text,
                                    fontSize: 14,
                                    fontWeight: 'bold',
                                    textAlign: isRtl ? 'right' : 'left',
                                    marginBottom: 8,
                                  }}
                                >
                                  {a.name}
                                </Text>

                                {a.deadline && (
                                  <Text
                                    style={{
                                      color: theme.textSecondary,
                                      fontSize: 12,
                                      textAlign: isRtl ? 'right' : 'left',
                                      marginBottom: 8,
                                    }}
                                  >
                                    📅 {t('due_date')}:{' '}
                                    {new Date(a.deadline).toLocaleString(lang === 'he' ? 'he-IL' : 'en-US')}
                                  </Text>
                                )}

                                {/* Action row for Assignment */}
                                <View
                                  style={{
                                    flexDirection: isRtl ? 'row-reverse' : 'row',
                                    flexWrap: 'wrap',
                                    alignItems: 'center',
                                    gap: 8,
                                    marginTop: 4,
                                  }}
                                >
                                  {a.link && (
                                    <Pressable
                                      style={[
                                        styles.smallActionBtn,
                                        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
                                      ]}
                                      onPress={() => Linking.openURL(a.link)}
                                    >
                                      <Text style={{ color: theme.primary, fontSize: 12, fontWeight: 'bold' }}>
                                        {t('open_in_moodle')}
                                      </Text>
                                    </Pressable>
                                  )}

                                  {attachments.map((att: any, attIdx: number) => {
                                    const displayFileName = att.fileName || att.name || (isRtl ? 'קובץ' : 'File');
                                    return (
                                      <Pressable
                                        key={attIdx}
                                        style={[
                                          styles.smallActionBtn,
                                          { backgroundColor: theme.backgroundElement, borderColor: theme.border },
                                        ]}
                                        onPress={() =>
                                          att.fileUrl || att.url
                                            ? handleDownloadFile({
                                                file_name: displayFileName,
                                                file_url: att.fileUrl || att.url,
                                                mime_type: att.mimeType,
                                              })
                                            : null
                                        }
                                      >
                                        <Text style={{ color: theme.textSecondary, fontSize: 12 }}>
                                          📄 {displayFileName} 📥
                                        </Text>
                                      </Pressable>
                                    );
                                  })}
                                </View>
                              </View>
                            );
                          })}

                          {/* Section Files */}
                          {content.files.map((f) => {
                            const displayFileName = f.file_name || (isRtl ? 'קובץ' : 'File');
                            const sizeText = formatFileSize(f.file_size);

                            return (
                              <Pressable
                                key={f.id}
                                style={[
                                  styles.fileRow,
                                  {
                                    backgroundColor: theme.background,
                                    borderColor: theme.border,
                                    flexDirection: isRtl ? 'row-reverse' : 'row',
                                  },
                                ]}
                                onPress={() => handleDownloadFile(f)}
                              >
                                <Text style={{ fontSize: 16 }}>📄</Text>
                                <View style={{ flex: 1, marginHorizontal: 8 }}>
                                  <Text
                                    style={{
                                      color: theme.text,
                                      fontSize: 13,
                                      fontWeight: '600',
                                      textAlign: isRtl ? 'right' : 'left',
                                    }}
                                    numberOfLines={1}
                                  >
                                    {displayFileName}
                                  </Text>
                                  {sizeText ? (
                                    <Text
                                      style={{
                                        color: theme.textSecondary,
                                        fontSize: 11,
                                        textAlign: isRtl ? 'right' : 'left',
                                      }}
                                    >
                                      {sizeText}
                                    </Text>
                                  ) : null}
                                </View>
                                <View
                                  style={[
                                    styles.smallActionBtn,
                                    { backgroundColor: theme.backgroundElement, borderColor: theme.border },
                                  ]}
                                >
                                  <Text style={{ color: theme.primary, fontSize: 12, fontWeight: 'bold' }}>
                                    {t('download')}
                                  </Text>
                                </View>
                              </Pressable>
                            );
                          })}

                          {content.assignments.length === 0 && content.files.length === 0 && (
                            <Text
                              style={{
                                color: theme.textSecondary,
                                fontSize: 13,
                                textAlign: isRtl ? 'right' : 'left',
                                paddingVertical: 6,
                              }}
                            >
                              {isRtl ? 'נושא ריק' : 'Empty section'}
                            </Text>
                          )}
                        </View>
                      )}
                    </View>
                  );
                })
              )}
            </>
          )}

          {/* ========================================================= */}
          {/* TAB 2: ASSIGNMENTS & GRADES OVERVIEW                     */}
          {/* ========================================================= */}
          {activeDetailTab === 'assignments' && (
            <View style={{ gap: 14 }}>
              {/* Summary Stats Cards */}
              <View
                style={{
                  flexDirection: isRtl ? 'row-reverse' : 'row',
                  gap: 8,
                }}
              >
                {/* Course Average */}
                <View
                  style={[
                    styles.statsCard,
                    {
                      backgroundColor: theme.backgroundElement,
                      borderColor: theme.border,
                      borderTopColor: courseColor,
                      borderTopWidth: 3,
                    },
                  ]}
                >
                  <Text style={{ color: theme.textSecondary, fontSize: 11, fontWeight: 'bold' }}>
                    {t('course_average')}
                  </Text>
                  <Text style={{ color: theme.text, fontSize: 20, fontWeight: 'bold', marginTop: 4 }}>
                    {avgGrade !== null ? `${avgGrade}%` : '—'}
                  </Text>
                </View>

                {/* Completed */}
                <View
                  style={[
                    styles.statsCard,
                    {
                      backgroundColor: theme.backgroundElement,
                      borderColor: theme.border,
                      borderTopColor: '#10b981',
                      borderTopWidth: 3,
                    },
                  ]}
                >
                  <Text style={{ color: theme.textSecondary, fontSize: 11, fontWeight: 'bold' }}>
                    {t('completed_assignments')}
                  </Text>
                  <Text style={{ color: '#10b981', fontSize: 20, fontWeight: 'bold', marginTop: 4 }}>
                    {submittedCount} / {totalAssignments}
                  </Text>
                </View>

                {/* Pending Tasks */}
                <View
                  style={[
                    styles.statsCard,
                    {
                      backgroundColor: theme.backgroundElement,
                      borderColor: theme.border,
                      borderTopColor: pendingCount > 0 ? theme.warning : theme.border,
                      borderTopWidth: 3,
                    },
                  ]}
                >
                  <Text style={{ color: theme.textSecondary, fontSize: 11, fontWeight: 'bold' }}>
                    {t('pending_tasks')}
                  </Text>
                  <Text
                    style={{
                      color: pendingCount > 0 ? theme.warning : theme.textSecondary,
                      fontSize: 20,
                      fontWeight: 'bold',
                      marginTop: 4,
                    }}
                  >
                    {pendingCount}
                  </Text>
                </View>
              </View>

              {/* Assignments List */}
              {courseAssignments.length === 0 ? (
                <View style={[styles.emptyCard, { backgroundColor: theme.backgroundElement }]}>
                  <Text style={{ color: theme.textSecondary, textAlign: 'center' }}>
                    {t('empty_assignments')}
                  </Text>
                </View>
              ) : (
                courseAssignments.map((a) => {
                  const isSubmitted = a.status === 'Submitted';
                  const { deadlineText, badgeClass } = getDueTextAndClass(
                    a.deadline,
                    lang,
                    7,
                    3,
                    false,
                    a.status
                  );

                  let borderAccent = theme.border;
                  if (isSubmitted) {
                    borderAccent = '#10b981';
                  } else if (badgeClass === 'badge-danger') {
                    borderAccent = '#ef4444';
                  } else if (badgeClass === 'badge-warning') {
                    borderAccent = '#f59e0b';
                  }

                  let attachments: any[] = [];
                  try {
                    attachments =
                      typeof a.attachments === 'string'
                        ? JSON.parse(a.attachments)
                        : a.attachments || [];
                  } catch (e) {
                    attachments = [];
                  }

                  return (
                    <View
                      key={a.id}
                      style={[
                        styles.assignCard,
                        {
                          backgroundColor: theme.backgroundElement,
                          borderColor: theme.border,
                          borderLeftWidth: !isRtl ? 4 : 1,
                          borderRightWidth: isRtl ? 4 : 1,
                          borderLeftColor: !isRtl ? borderAccent : theme.border,
                          borderRightColor: isRtl ? borderAccent : theme.border,
                        },
                      ]}
                    >
                      {/* Header Row: Section Name & Status */}
                      <View
                        style={{
                          flexDirection: isRtl ? 'row-reverse' : 'row',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: 6,
                        }}
                      >
                        <Text style={{ color: theme.textSecondary, fontSize: 12 }}>
                          📁 {a.section_name || 'General'}
                        </Text>

                        {isSubmitted ? (
                          <View
                            style={{
                              backgroundColor: 'rgba(16, 185, 129, 0.15)',
                              paddingHorizontal: 8,
                              paddingVertical: 2,
                              borderRadius: 6,
                            }}
                          >
                            <Text style={{ color: '#10b981', fontSize: 11, fontWeight: 'bold' }}>
                              {t('submitted_badge')}
                            </Text>
                          </View>
                        ) : (
                          <View
                            style={{
                              backgroundColor:
                                badgeClass === 'badge-danger'
                                  ? 'rgba(239, 68, 68, 0.15)'
                                  : badgeClass === 'badge-warning'
                                  ? 'rgba(245, 158, 11, 0.15)'
                                  : 'rgba(100, 116, 139, 0.15)',
                              paddingHorizontal: 8,
                              paddingVertical: 2,
                              borderRadius: 6,
                            }}
                          >
                            <Text
                              style={{
                                color:
                                  badgeClass === 'badge-danger'
                                    ? '#ef4444'
                                    : badgeClass === 'badge-warning'
                                    ? '#f59e0b'
                                    : theme.textSecondary,
                                fontSize: 11,
                                fontWeight: 'bold',
                              }}
                            >
                              {deadlineText}
                            </Text>
                          </View>
                        )}
                      </View>

                      {/* Assignment Name */}
                      <Text
                        style={{
                          color: theme.text,
                          fontSize: 16,
                          fontWeight: 'bold',
                          textAlign: isRtl ? 'right' : 'left',
                          marginBottom: 8,
                        }}
                      >
                        {a.name}
                      </Text>

                      {/* Due Date & Grade */}
                      <View
                        style={{
                          flexDirection: isRtl ? 'row-reverse' : 'row',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: 6,
                          marginBottom: 8,
                        }}
                      >
                        {a.deadline ? (
                          <Text style={{ color: theme.textSecondary, fontSize: 12 }}>
                            📅 {t('due_date')}:{' '}
                            {new Date(a.deadline).toLocaleString(lang === 'he' ? 'he-IL' : 'en-US')}
                          </Text>
                        ) : (
                          <Text style={{ color: theme.textSecondary, fontSize: 12 }}>
                            {t('no_deadline')}
                          </Text>
                        )}

                        {a.grade !== null && a.grade !== undefined && a.grade_max ? (
                          <View
                            style={{
                              backgroundColor: 'rgba(99, 102, 241, 0.15)',
                              paddingHorizontal: 8,
                              paddingVertical: 3,
                              borderRadius: 6,
                            }}
                          >
                            <Text style={{ color: theme.primary, fontSize: 12, fontWeight: 'bold' }}>
                              {t('grade_label')}: {a.grade} / {a.grade_max}
                            </Text>
                          </View>
                        ) : null}
                      </View>

                      {/* Actions Row */}
                      <View
                        style={{
                          flexDirection: isRtl ? 'row-reverse' : 'row',
                          flexWrap: 'wrap',
                          alignItems: 'center',
                          gap: 8,
                          borderTopWidth: 1,
                          borderTopColor: theme.border,
                          paddingTop: 8,
                        }}
                      >
                        {a.link && (
                          <Pressable
                            style={[
                              styles.smallActionBtn,
                              { backgroundColor: theme.background, borderColor: theme.border },
                            ]}
                            onPress={() => Linking.openURL(a.link)}
                          >
                            <Text style={{ color: theme.primary, fontSize: 12, fontWeight: 'bold' }}>
                              {t('open_in_moodle')}
                            </Text>
                          </Pressable>
                        )}

                        {attachments.map((att: any, attIdx: number) => {
                          const displayFileName = att.fileName || att.name || (isRtl ? 'קובץ' : 'File');
                          return (
                            <Pressable
                              key={attIdx}
                              style={[
                                styles.smallActionBtn,
                                { backgroundColor: theme.background, borderColor: theme.border },
                              ]}
                              onPress={() =>
                                att.fileUrl || att.url
                                  ? handleDownloadFile({
                                      file_name: displayFileName,
                                      file_url: att.fileUrl || att.url,
                                      mime_type: att.mimeType,
                                    })
                                  : null
                              }
                            >
                              <Text style={{ color: theme.textSecondary, fontSize: 12 }}>
                                📄 {displayFileName} 📥
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          )}
        </ScrollView>

        {/* Modal: Edit Course */}
        {renderEditModal()}
      </View>
    );
  }

  // ==========================================
  // 2. MAIN COURSES LIST VIEW
  // ==========================================
  const trackedCourses = courses.filter((c) => c.is_active === 1);
  const groupedCourses = groupAndSortCourses(courses, lang);

  function renderEditModal() {
    if (!editingCourse) return null;

    return (
      <Modal
        visible={Boolean(editingCourse)}
        transparent
        animationType="fade"
        onRequestClose={() => setEditingCourse(null)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalCard,
              {
                backgroundColor: theme.backgroundElement,
                borderColor: theme.border,
              },
            ]}
          >
            {/* Modal Header */}
            <View
              style={{
                flexDirection: isRtl ? 'row-reverse' : 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 16,
              }}
            >
              <Text style={{ color: theme.text, fontSize: 18, fontWeight: 'bold' }}>
                ✏️ {t('edit_course')}
              </Text>
              <Pressable onPress={() => setEditingCourse(null)} style={{ padding: 4 }}>
                <Text style={{ color: theme.textSecondary, fontSize: 16 }}>✕</Text>
              </Pressable>
            </View>

            <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
              {/* Course Identifier Info */}
              <View
                style={{
                  backgroundColor: theme.background,
                  padding: 10,
                  borderRadius: 8,
                  marginBottom: 16,
                }}
              >
                <Text
                  style={{
                    color: theme.textSecondary,
                    fontSize: 12,
                    textAlign: isRtl ? 'right' : 'left',
                  }}
                >
                  {editingCourse.course_id || `Moodle ID: ${editingCourse.moodle_id}`}
                </Text>
              </View>

              {/* Tracking Active Toggle */}
              <Pressable
                style={{
                  flexDirection: isRtl ? 'row-reverse' : 'row',
                  alignItems: 'center',
                  marginBottom: 16,
                }}
                onPress={() =>
                  setEditingCourse((prev) =>
                    prev ? { ...prev, is_active: prev.is_active === 1 ? 0 : 1 } : null
                  )
                }
              >
                <View
                  style={[
                    styles.checkbox,
                    {
                      backgroundColor:
                        editingCourse.is_active === 1
                          ? editingCourse.color || theme.primary
                          : 'transparent',
                      borderColor: editingCourse.color || theme.primary,
                    },
                  ]}
                >
                  {editingCourse.is_active === 1 && <Text style={styles.checkboxTick}>✓</Text>}
                </View>
                <Text
                  style={{
                    color: theme.text,
                    marginHorizontal: 10,
                    fontSize: 15,
                    fontWeight: '600',
                  }}
                >
                  {t('tracking_active')}
                </Text>
              </Pressable>

              {/* Nickname Input */}
              <Text
                style={{
                  color: theme.textSecondary,
                  fontSize: 13,
                  marginBottom: 6,
                  fontWeight: '600',
                  textAlign: isRtl ? 'right' : 'left',
                }}
              >
                {t('display_nickname')}
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    borderColor: theme.border,
                    color: theme.text,
                    textAlign: isRtl ? 'right' : 'left',
                    backgroundColor: theme.background,
                  },
                ]}
                value={editingCourse.name}
                onChangeText={(text) =>
                  setEditingCourse((prev) => (prev ? { ...prev, name: text } : null))
                }
                placeholder={t('nickname_placeholder')}
                placeholderTextColor={theme.placeholder}
              />

              {/* Course Color Selection */}
              <Text
                style={{
                  color: theme.textSecondary,
                  fontSize: 13,
                  marginTop: 8,
                  marginBottom: 8,
                  fontWeight: '600',
                  textAlign: isRtl ? 'right' : 'left',
                }}
              >
                {t('course_color')}
              </Text>
              <View
                style={[
                  styles.colorsGrid,
                  {
                    flexDirection: isRtl ? 'row-reverse' : 'row',
                  },
                ]}
              >
                {PRESETS.map((color) => {
                  const isSelected = editingCourse.color.toLowerCase() === color.toLowerCase();
                  return (
                    <Pressable
                      key={color}
                      style={[
                        styles.colorCircle,
                        {
                          backgroundColor: color,
                          borderWidth: isSelected ? 3 : 0,
                          borderColor: theme.text,
                        },
                      ]}
                      onPress={() => {
                        setEditingCourse((prev) => (prev ? { ...prev, color } : null));
                        setCustomHexInput(color);
                      }}
                    >
                      {isSelected && <Text style={{ color: '#fff', fontSize: 12, fontWeight: 'bold' }}>✓</Text>}
                    </Pressable>
                  );
                })}
              </View>

              {/* Custom Hex Color */}
              <Text
                style={{
                  color: theme.textSecondary,
                  fontSize: 13,
                  marginTop: 12,
                  marginBottom: 6,
                  fontWeight: '600',
                  textAlign: isRtl ? 'right' : 'left',
                }}
              >
                {t('custom_color_hex')}
              </Text>
              <View
                style={{
                  flexDirection: isRtl ? 'row-reverse' : 'row',
                  alignItems: 'center',
                  gap: 10,
                  marginBottom: 16,
                }}
              >
                <View
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 8,
                    backgroundColor: /^#[0-9A-Fa-f]{6}$/.test(customHexInput.trim())
                      ? customHexInput.trim()
                      : editingCourse.color,
                    borderWidth: 1,
                    borderColor: theme.border,
                  }}
                />
                <TextInput
                  style={[
                    styles.input,
                    {
                      flex: 1,
                      marginBottom: 0,
                      borderColor: theme.border,
                      color: theme.text,
                      textAlign: 'left',
                      backgroundColor: theme.background,
                    },
                  ]}
                  value={customHexInput}
                  onChangeText={(text) => {
                    setCustomHexInput(text);
                    if (/^#[0-9A-Fa-f]{6}$/.test(text.trim())) {
                      setEditingCourse((prev) => (prev ? { ...prev, color: text.trim() } : null));
                    }
                  }}
                  placeholder="#6366f1"
                  placeholderTextColor={theme.placeholder}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
            </ScrollView>

            {/* Modal Actions */}
            <View
              style={{
                flexDirection: isRtl ? 'row-reverse' : 'row',
                justifyContent: 'flex-end',
                gap: 10,
                marginTop: 16,
                borderTopWidth: 1,
                borderTopColor: theme.border,
                paddingTop: 12,
              }}
            >
              <Pressable
                style={[styles.secondaryBtn, { borderColor: theme.border }]}
                onPress={() => setEditingCourse(null)}
              >
                <Text style={{ color: theme.text, fontWeight: '600' }}>{t('cancel')}</Text>
              </Pressable>

              <Pressable
                style={[
                  styles.primaryBtn,
                  {
                    backgroundColor: editingCourse.color || theme.primary,
                    paddingHorizontal: 20,
                  },
                ]}
                onPress={saveEditingModal}
              >
                <Text style={{ color: '#ffffff', fontWeight: 'bold' }}>{t('save_btn')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Screen Header */}
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <Text style={[styles.headerTitle, { color: theme.text, textAlign: isRtl ? 'right' : 'left' }]}>
          {t('courses')}
        </Text>
        <Text
          style={{
            color: theme.textSecondary,
            fontSize: 13,
            marginTop: 4,
            textAlign: isRtl ? 'right' : 'left',
          }}
        >
          {isRtl
            ? 'הגדר מעקב, כינויים וצבעי תגים עבור הקורסים שלך.'
            : 'Toggle tracking, customize nicknames, and set custom tags.'}
        </Text>
      </View>

      <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* 1. Tracked Courses Configuration Panel (Expandable) */}
        <View
          style={[
            styles.configCard,
            {
              backgroundColor: theme.backgroundElement,
              borderColor: theme.border,
            },
          ]}
        >
          <Pressable
            style={{
              flexDirection: isRtl ? 'row-reverse' : 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
            onPress={() => {
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              setConfigExpanded(!configExpanded);
            }}
          >
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  color: theme.text,
                  fontWeight: 'bold',
                  fontSize: 15,
                  textAlign: isRtl ? 'right' : 'left',
                }}
              >
                ⚙️ {t('tracked_courses_config')}
              </Text>
            </View>

            <View
              style={[
                styles.configToggleBadge,
                {
                  backgroundColor: theme.background,
                  borderColor: theme.border,
                },
              ]}
            >
              <Text style={{ color: theme.primary, fontSize: 12, fontWeight: 'bold' }}>
                {t('courses_configuration_btn')} {configExpanded ? '▲' : '▼'}
              </Text>
            </View>
          </Pressable>

          {configExpanded && (
            <View
              style={{
                marginTop: 16,
                borderTopWidth: 1,
                borderTopColor: theme.border,
                paddingTop: 16,
              }}
            >
              {courses.length === 0 ? (
                <Text style={{ color: theme.textSecondary, textAlign: 'center', paddingVertical: 12 }}>
                  {isRtl ? 'לא נמצאו קורסים. אנא התחבר למודל תחילה.' : 'No courses loaded. Connect Moodle first.'}
                </Text>
              ) : (
                groupedCourses.map((group) => (
                  <View key={group.semesterKey} style={{ marginBottom: 20 }}>
                    {/* Semester Title */}
                    <Text
                      style={{
                        color: theme.primary,
                        fontWeight: 'bold',
                        fontSize: 14,
                        marginBottom: 10,
                        borderBottomWidth: 1,
                        borderBottomColor: theme.border,
                        paddingBottom: 4,
                        textAlign: isRtl ? 'right' : 'left',
                      }}
                    >
                      📅 {group.label}
                    </Text>

                    {/* Courses in this semester */}
                    {group.courses.map((c) => {
                      const isTracked = c.is_active === 1;
                      const courseColor = c.color || theme.primary;

                      return (
                        <View
                          key={c.id}
                          style={[
                            styles.configRow,
                            {
                              backgroundColor: theme.background,
                              borderColor: theme.border,
                              flexDirection: isRtl ? 'row-reverse' : 'row',
                            },
                          ]}
                        >
                          {/* Checkbox */}
                          <Pressable
                            style={[
                              styles.checkbox,
                              {
                                backgroundColor: isTracked ? courseColor : 'transparent',
                                borderColor: courseColor,
                              },
                            ]}
                            onPress={() => handleToggleActive(c.id, c.is_active)}
                          >
                            {isTracked && <Text style={styles.checkboxTick}>✓</Text>}
                          </Pressable>

                          {/* Code and Nickname */}
                          <View style={{ flex: 1, marginHorizontal: 10 }}>
                            <Text
                              style={{
                                color: theme.textSecondary,
                                fontSize: 11,
                                textAlign: isRtl ? 'right' : 'left',
                              }}
                            >
                              {c.course_id || `ID: ${c.moodle_id}`}
                            </Text>
                            <TextInput
                              style={[
                                styles.inlineInput,
                                {
                                  borderColor: theme.border,
                                  color: theme.text,
                                  textAlign: isRtl ? 'right' : 'left',
                                },
                              ]}
                              defaultValue={c.name}
                              placeholder={t('nickname_placeholder')}
                              placeholderTextColor={theme.placeholder}
                              onEndEditing={(e) => handleUpdateName(c.id, e.nativeEvent.text)}
                            />
                          </View>

                          {/* Color Swatch & Edit Button */}
                          <View
                            style={{
                              flexDirection: isRtl ? 'row-reverse' : 'row',
                              alignItems: 'center',
                              gap: 8,
                            }}
                          >
                            <Pressable
                              style={[
                                styles.colorCircleSmall,
                                {
                                  backgroundColor: courseColor,
                                  borderColor: theme.border,
                                  borderWidth: 1,
                                },
                              ]}
                              onPress={() => openEditModal(c)}
                            />

                            <Pressable
                              style={[
                                styles.smallActionBtn,
                                { backgroundColor: theme.backgroundElement, borderColor: theme.border },
                              ]}
                              onPress={() => openEditModal(c)}
                            >
                              <Text style={{ color: theme.text, fontSize: 12 }}>✏️</Text>
                            </Pressable>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                ))
              )}
            </View>
          )}
        </View>

        {/* 2. Tracked Courses Navigation Pane (Filtered Cards) */}
        <View style={{ marginTop: 8 }}>
          <Text
            style={{
              color: theme.text,
              fontSize: 18,
              fontWeight: 'bold',
              marginBottom: 12,
              textAlign: isRtl ? 'right' : 'left',
            }}
          >
            {t('navigation_pane_title')}
          </Text>

          {trackedCourses.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: theme.backgroundElement }]}>
              <Text style={{ color: theme.textSecondary, textAlign: 'center', lineHeight: 20 }}>
                {t('no_tracked_courses_tip')}
              </Text>
            </View>
          ) : (
            trackedCourses.map((c) => {
              const courseColor = c.color || theme.primary;

              return (
                <Pressable
                  key={c.id}
                  style={[
                    styles.card,
                    {
                      backgroundColor: theme.backgroundElement,
                      borderColor: theme.border,
                      borderLeftWidth: !isRtl ? 5 : 1,
                      borderRightWidth: isRtl ? 5 : 1,
                      borderLeftColor: !isRtl ? courseColor : theme.border,
                      borderRightColor: isRtl ? courseColor : theme.border,
                    },
                  ]}
                  onPress={() => {
                    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                    setActiveCourseId(c.moodle_id);
                  }}
                >
                  {/* Card Title Row */}
                  <View
                    style={{
                      flexDirection: isRtl ? 'row-reverse' : 'row',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <View style={{ flex: 1, marginHorizontal: 4 }}>
                      <Text
                        style={{
                          color: courseColor,
                          fontSize: 12,
                          fontWeight: 'bold',
                          textAlign: isRtl ? 'right' : 'left',
                        }}
                      >
                        {c.course_id || `ID: ${c.moodle_id}`}
                      </Text>
                      <Text
                        style={{
                          color: theme.text,
                          fontSize: 16,
                          fontWeight: 'bold',
                          marginTop: 2,
                          textAlign: isRtl ? 'right' : 'left',
                        }}
                      >
                        📖 {c.name}
                      </Text>
                    </View>

                    {/* Action buttons inside card */}
                    <View
                      style={{
                        flexDirection: isRtl ? 'row-reverse' : 'row',
                        alignItems: 'center',
                        gap: 8,
                      }}
                    >
                      <Pressable
                        style={[
                          styles.smallActionBtn,
                          { backgroundColor: theme.background, borderColor: theme.border },
                        ]}
                        onPress={(e) => {
                          e.stopPropagation();
                          Linking.openURL(`https://moodle.tau.ac.il/course/view.php?id=${c.moodle_id}`);
                        }}
                      >
                        <Text style={{ color: theme.primary, fontSize: 11, fontWeight: 'bold' }}>
                          {isRtl ? 'מודל ↗' : 'Moodle ↗'}
                        </Text>
                      </Pressable>

                      <Pressable
                        style={[
                          styles.smallActionBtn,
                          { backgroundColor: theme.background, borderColor: theme.border },
                        ]}
                        onPress={(e) => {
                          e.stopPropagation();
                          openEditModal(c);
                        }}
                      >
                        <Text style={{ color: courseColor, fontSize: 11, fontWeight: 'bold' }}>
                          ✏️
                        </Text>
                      </Pressable>

                      <Text style={{ color: theme.textSecondary, fontSize: 18 }}>
                        {isRtl ? '←' : '→'}
                      </Text>
                    </View>
                  </View>
                </Pressable>
              );
            })
          )}
        </View>
      </ScrollView>

      {/* Edit Course Modal */}
      {renderEditModal()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    padding: 16,
    paddingTop: 60,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
  },
  detailHeader: {
    paddingHorizontal: 16,
    paddingTop: 54,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  headerBtn: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  tabBarContainer: {
    flexDirection: 'row',
    borderBottomWidth: 1,
  },
  tabBarBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBarText: {
    fontSize: 13,
  },
  list: {
    flex: 1,
    padding: 16,
  },
  configCard: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 16,
  },
  configToggleBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  configRow: {
    alignItems: 'center',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
  },
  card: {
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 12,
  },
  emptyCard: {
    padding: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  navPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  sectionCard: {
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
    overflow: 'hidden',
  },
  sectionHeader: {
    padding: 12,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  fileRow: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  assignCard: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  statsCard: {
    flex: 1,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 2,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxTick: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 13,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    fontSize: 14,
    marginBottom: 12,
  },
  inlineInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 13,
    marginTop: 2,
  },
  colorsGrid: {
    flexWrap: 'wrap',
    gap: 10,
  },
  colorCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
  },
  colorCircleSmall: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  primaryBtn: {
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryBtn: {
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  smallActionBtn: {
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 440,
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
  },
});
