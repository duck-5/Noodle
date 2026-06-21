import React, { useState, useCallback } from 'react';
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
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Paths, File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { getMoodleToken } from '../services/backgroundSync';
import { getDb, getPreference, setPreference } from '../services/database';
import { t, getLanguage } from '../services/i18n';
import { useTheme } from '../hooks/use-theme';

const PRESETS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#06b6d4'];

interface CoursesScreenProps {
  activeCourseId?: number | null;
  setActiveCourseId?: (id: number | null) => void;
}

export default function CoursesScreen({ activeCourseId, setActiveCourseId }: CoursesScreenProps) {
  const theme = useTheme();

  const [courses, setCourses] = useState<any[]>([]);
  const [expandedCourses, setExpandedCourses] = useState<Record<number, boolean>>({});
  const [configureCourses, setConfigureCourses] = useState<Record<number, boolean>>({});
  const [interestedMeetings, setInterestedMeetings] = useState<string[]>([]);
  const [expandedZoom, setExpandedZoom] = useState<boolean>(false);

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
    let updated;
    if (interestedMeetings.includes(meetingId)) {
      updated = interestedMeetings.filter(id => id !== meetingId);
    } else {
      updated = [...interestedMeetings, meetingId];
    }
    setInterestedMeetings(updated);
    setPreference('interested_meetings', JSON.stringify(updated));
  };

  function loadCourses() {
    try {
      const db = getDb();
      // Load all courses from database
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
      loadCourses();
    } catch (e) {
      console.error(e);
    }
  };

  const handleUpdateName = (id: number, text: string) => {
    try {
      const db = getDb();
      db.runSync('UPDATE tracked_courses SET name = ? WHERE id = ?', [text, id]);
      // Update local state without full reload to keep focus
      setCourses(courses.map(c => c.id === id ? { ...c, name: text } : c));
    } catch (e) {
      console.error(e);
    }
  };

  const handleSelectColor = (id: number, color: string) => {
    try {
      const db = getDb();
      db.runSync('UPDATE tracked_courses SET color = ? WHERE id = ?', [color, id]);
      loadCourses();
    } catch (e) {
      console.error(e);
    }
  };

  async function handleDownloadFile(file: any) {
    try {
      const moodleTokenVal = await getMoodleToken();
      if (!moodleTokenVal) {
        Alert.alert(t('connect_moodle'), 'Moodle connection token not found.');
        return;
      }
      const separator = file.file_url.includes('?') ? '&' : '?';
      const authenticatedUrl = `${file.file_url}${separator}token=${moodleTokenVal}`;
      const destinationFile = new File(Paths.document, encodeURIComponent(file.file_name));
      const downloadedFile = await File.downloadFileAsync(authenticatedUrl, destinationFile, { idempotent: true });
      if (downloadedFile) {
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(downloadedFile.uri, {
            mimeType: file.mime_type,
            dialogTitle: `Open ${file.file_name}`,
          });
        } else {
          Alert.alert('Download Complete', `File saved to: ${downloadedFile.uri}`);
        }
      } else {
        Alert.alert('Download Failed', 'Failed to download file.');
      }
    } catch (e: any) {
      Alert.alert('Download Error', e.message || 'An error occurred during file download.');
    }
  }

  if (activeCourseId) {
    const course = courses.find((c) => c.moodle_id === activeCourseId);
    if (!course) {
      return (
        <View style={[styles.container, { backgroundColor: theme.background }]}>
          <Text style={{ color: theme.text }}>Course not found.</Text>
          <Pressable onPress={() => setActiveCourseId && setActiveCourseId(null)}><Text style={{ color: theme.primary }}>Back</Text></Pressable>
        </View>
      );
    }

    const isTracked = course.is_active === 1;
    const db = getDb();
    const courseAssignments = db.getAllSync<any>(
      'SELECT * FROM assignments WHERE course_moodle_id = ? AND status != ?',
      [course.moodle_id, 'Submitted']
    );
    const courseFiles = db.getAllSync<any>(
      'SELECT * FROM files WHERE course_moodle_id = ?',
      [course.moodle_id]
    );
    const courseMeetings = db.getAllSync<any>(
      'SELECT * FROM meetings WHERE course_moodle_id = ?',
      [course.moodle_id]
    );
    const sectionsMap: Record<string, { assignments: any[]; files: any[]; meetings: any[] }> = {};
    const getSection = (name: string) => {
      const n = name || (isRtl ? 'כללי' : 'General');
      if (!sectionsMap[n]) sectionsMap[n] = { assignments: [], files: [], meetings: [] };
      return sectionsMap[n];
    };
    courseFiles.forEach((f: any) => getSection(f.section_name).files.push(f));
    courseAssignments.forEach((a: any) => getSection(a.section_name || (isRtl ? 'כללי' : 'General')).assignments.push(a));
    courseMeetings.forEach((m: any) => getSection(m.section_name || (isRtl ? 'כללי' : 'General')).meetings.push(m));
    const sectionEntries = Object.entries(sectionsMap);

    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={[styles.header, { borderBottomColor: theme.border, flexDirection: isRtl ? 'row-reverse' : 'row', alignItems: 'center' }]}>
          <Pressable onPress={() => {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setActiveCourseId && setActiveCourseId(null);
          }}>
            <Text style={{ color: theme.primary, fontSize: 16, marginRight: isRtl ? 0 : 16, marginLeft: isRtl ? 16 : 0 }}>
              {isRtl ? '← חזור' : '← Back'}
            </Text>
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={[styles.headerTitle, { color: theme.text, textAlign: isRtl ? 'right' : 'left' }]}>
              {course.name}
            </Text>
            <Text style={{ color: theme.textSecondary, fontSize: 13, textAlign: isRtl ? 'right' : 'left' }}>
              {course.course_id || 'Moodle ID: ' + course.moodle_id}
            </Text>
          </View>
        </View>

        <ScrollView style={styles.list}>
          {/* Configure Button */}
          <Pressable 
            style={{ paddingVertical: 8, paddingHorizontal: 12, backgroundColor: theme.background, borderRadius: 8, marginBottom: 12, borderWidth: 1, borderColor: theme.border }} 
            onPress={() => {
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              setConfigureCourses(prev => ({ ...prev, [course.id]: !configureCourses[course.id] }));
            }}
          >
            <Text style={{ color: theme.text, textAlign: 'center', fontWeight: 'bold' }}>
              {configureCourses[course.id] ? (isRtl ? 'סגור הגדרות' : 'Hide Settings') : (isRtl ? 'הגדר קורס' : 'Configure Course')}
            </Text>
          </Pressable>

          {configureCourses[course.id] && (
            <View style={{ marginBottom: 16, padding: 12, backgroundColor: theme.background, borderRadius: 8, borderWidth: 1, borderColor: theme.border }}>
              <View style={{ flexDirection: isRtl ? 'row-reverse' : 'row', alignItems: 'center', marginBottom: 12 }}>
                <Pressable
                  style={[
                    styles.checkbox,
                    {
                      backgroundColor: isTracked ? course.color || theme.primary : 'transparent',
                      borderColor: course.color || theme.primary,
                    },
                  ]}
                  onPress={() => handleToggleActive(course.id, course.is_active)}
                >
                  {isTracked && <Text style={styles.checkboxTick}>✓</Text>}
                </Pressable>
                <Text style={{ color: theme.text, marginHorizontal: 8 }}>{isRtl ? 'מעקב פעיל' : 'Tracking Active'}</Text>
              </View>
              <TextInput
                style={[styles.input, { borderColor: theme.border, color: theme.text, textAlign: isRtl ? 'right' : 'left', writingDirection: 'auto' }]}
                value={course.name}
                onChangeText={(text) => handleUpdateName(course.id, text)}
                placeholder={t('nickname_placeholder')}
                placeholderTextColor={theme.placeholder}
              />
              <View style={[styles.colorsRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                {PRESETS.map((color) => {
                  const isSelected = course.color === color;
                  return (
                    <Pressable
                      key={color}
                      style={[
                        styles.colorCircle,
                        {
                          backgroundColor: color,
                          borderWidth: isSelected ? 2 : 0,
                          borderColor: theme.text,
                        },
                      ]}
                      onPress={() => handleSelectColor(course.id, color)}
                    />
                  );
                })}
              </View>
            </View>
          )}

          {/* Zoom Section for Course Details */}
          {(() => {
            const now = new Date();
            const groups = new Map<string, typeof courseMeetings>();
            courseMeetings.forEach(m => {
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
              const future = list.filter(m => m.start_time && new Date(m.start_time) >= now);
              const past = list.filter(m => m.start_time && new Date(m.start_time) < now);
              const noTime = list.filter(m => !m.start_time);

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
              const now = new Date();
              const endTime = new Date(startTime.getTime() + 2 * 60 * 60 * 1000);
              if (now >= startTime && now <= endTime) {
                return 'active';
              } else {
                return 'inactive';
              }
            };

            return (
              <View style={{ marginBottom: 16, backgroundColor: theme.backgroundElement, borderRadius: 12, borderWidth: 1, borderColor: theme.border, overflow: 'hidden' }}>
                <Pressable
                  style={{
                    padding: 16,
                    flexDirection: isRtl ? 'row-reverse' : 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                  onPress={() => {
                    LayoutAnimation.configureNext({
                      duration: 200,
                      create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
                      update: { type: LayoutAnimation.Types.easeInEaseOut },
                    });
                    setExpandedZoom(!expandedZoom);
                  }}
                >
                  <View style={{ flex: 1, alignItems: isRtl ? 'flex-end' : 'flex-start', gap: 4 }}>
                    <Text style={{ color: course.color || theme.primary, fontWeight: 'bold', fontSize: 16, textAlign: isRtl ? 'right' : 'left' }}>
                      📹 {isRtl ? 'זום' : 'Zoom'}
                    </Text>

                    {(() => {
                      const activeMeeting = dedupedMeetings.find(m => {
                        if (!m.start_time) return false;
                        const startTime = new Date(m.start_time);
                        if (isNaN(startTime.getTime())) return false;
                        const now = new Date();
                        const endTime = new Date(startTime.getTime() + 2 * 60 * 60 * 1000);
                        return now >= startTime && now <= endTime;
                      });
                      if (!activeMeeting) return null;
                      return (
                        <View style={{ marginTop: 4, flexDirection: isRtl ? 'row-reverse' : 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                          <Text style={{ color: theme.textSecondary, fontSize: 13, fontWeight: 'bold' }}>
                            {isRtl ? 'זום נוכחי:' : 'Current Zoom:'}
                          </Text>
                          <Pressable onPress={() => activeMeeting.meeting_url && Linking.openURL(activeMeeting.meeting_url)}>
                            <Text style={{ color: course.color || theme.primary, fontSize: 13, fontWeight: 'bold', textDecorationLine: 'underline' }}>
                              {activeMeeting.title || 'Zoom'}
                            </Text>
                          </Pressable>
                        </View>
                      );
                    })()}

                    {/* Configured Quick buttons */}
                    {markedMeetings.length > 0 && (
                      <View style={{ flexDirection: 'column', gap: 6, marginTop: 4, alignItems: isRtl ? 'flex-end' : 'flex-start' }}>
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
                                textDecorationColor: course.color || theme.primary,
                                lineHeight: 18,
                                textAlign: isRtl ? 'right' : 'left'
                              }}
                            >
                              {m.title || 'Zoom'}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    )}
                  </View>

                  <Text style={{ color: theme.textSecondary, fontSize: 16 }}>
                    {expandedZoom ? '▲' : '▼'}
                  </Text>
                </Pressable>

                {expandedZoom && (
                  <View style={{ paddingHorizontal: 16, paddingBottom: 16, borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 12 }}>
                    {(() => {
                      if (dedupedMeetings.length === 0) {
                        return (
                          <View style={{ paddingVertical: 12, alignItems: 'center' }}>
                            <Text style={{ color: theme.textSecondary, fontSize: 13 }}>
                              {isRtl ? 'לא נמצאו פגישות זום עבור קורס זה.' : 'No Zoom meetings found for this course.'}
                            </Text>
                          </View>
                        );
                      }

                      const sortedMeetings = [...dedupedMeetings].sort((a, b) => {
                        const aMarked = isMarked(a);
                        const bMarked = isMarked(b);
                        if (aMarked && !bMarked) return -1;
                        if (!aMarked && bMarked) return 1;

                        const statusA = getMeetingStatusText(a.start_time);
                        const statusB = getMeetingStatusText(b.start_time);
                        const priority = { active: 1, unknown: 2, inactive: 3 };
                        if (priority[statusA] !== priority[statusB]) {
                          return priority[statusA] - priority[statusB];
                        }
                        const timeA = a.start_time ? new Date(a.start_time).getTime() : 0;
                        const timeB = b.start_time ? new Date(b.start_time).getTime() : 0;
                        return timeB - timeA;
                      });

                      return sortedMeetings.map((m) => {
                        const status = getMeetingStatusText(m.start_time);
                        const isCurrentlyMarked = isMarked(m);

                        let statusLabel = '';
                        let statusColor: string = theme.textSecondary;
                        let opacity = 1;

                        if (status === 'active') {
                          statusLabel = isRtl ? '● פעיל כעת' : '● Active Now';
                          statusColor = theme.secondary || '#10b981';
                        } else if (status === 'inactive') {
                          statusLabel = m.start_time ? (isRtl ? 'הסתיים / לא פעיל' : 'Finished / Inactive') : '';
                          statusColor = theme.textSecondary;
                          opacity = 0.5;
                        }

                        return (
                          <View 
                            key={m.id} 
                            style={{ 
                              flexDirection: isRtl ? 'row-reverse' : 'row', 
                              justifyContent: 'space-between', 
                              alignItems: 'center', 
                              padding: 12, 
                              backgroundColor: theme.background, 
                              borderRadius: 8, 
                              marginBottom: 8, 
                              opacity 
                            }}
                          >
                            <View style={{ flex: 1, alignItems: isRtl ? 'flex-end' : 'flex-start' }}>
                              <View style={{ flexDirection: isRtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 6 }}>
                                <Text style={{ color: theme.text, fontWeight: 'bold', fontSize: 14 }}>{m.title || 'Zoom'}</Text>
                                {statusLabel ? <Text style={{ color: statusColor, fontSize: 11, fontWeight: 'bold' }}>{statusLabel}</Text> : null}
                              </View>
                              <Text style={{ color: theme.textSecondary, fontSize: 12, marginTop: 2 }}>{m.section_name || 'General'}</Text>
                              {m.start_time ? (
                                <Text style={{ color: theme.textSecondary, fontSize: 11, marginTop: 2 }}>
                                  📅 {new Date(m.start_time).toLocaleString(lang === 'he' ? 'he-IL' : 'en-US')}
                                </Text>
                              ) : null}
                            </View>

                            <View style={{ flexDirection: isRtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 12 }}>
                              <Pressable
                                style={{ padding: 6 }}
                                onPress={() => {
                                  const keyId = m.meeting_number || m.meeting_url;
                                  if (keyId) {
                                    handleToggleMeetingInterest(keyId);
                                  }
                                }}
                              >
                                <Text style={{ fontSize: 18, opacity: isCurrentlyMarked ? 1 : 0.25, color: theme.primary }}>
                                  👁️
                                </Text>
                              </Pressable>

                              {m.meeting_url ? (
                                <Pressable
                                  style={{ backgroundColor: theme.primary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 }}
                                  onPress={() => Linking.openURL(m.meeting_url)}
                                >
                                  <Text style={{ color: '#ffffff', fontSize: 11, fontWeight: 'bold' }}>
                                    {isRtl ? 'הצטרף' : 'Join'}
                                  </Text>
                                </Pressable>
                              ) : null}
                            </View>
                          </View>
                        );
                      });
                    })()}
                  </View>
                )}
              </View>
            );
          })()}

          {sectionEntries.length === 0 ? (
            <Text style={{ color: theme.textSecondary, fontSize: 13, textAlign: isRtl ? 'right' : 'left' }}>
              {t('empty_sections')}
            </Text>
          ) : (
            sectionEntries.map(([secName, content], secIdx) => (
              <View key={secIdx} style={[styles.sectionNode, { backgroundColor: theme.background }]}>
                <Text style={[styles.sectionNodeTitle, { color: theme.text, borderBottomColor: theme.border, textAlign: isRtl ? 'right' : 'left' }]}>
                  {secName}
                </Text>
                
                {content.assignments.map((a) => {
                  let attachments: any[] = [];
                  try {
                    attachments = typeof a.attachments === 'string' ? JSON.parse(a.attachments) : a.attachments || [];
                  } catch (e) { attachments = []; }

                  return (
                    <View key={a.id} style={{ marginBottom: 12, backgroundColor: theme.backgroundElement, borderRadius: 8, padding: 8 }}>
                      <View style={{ flexDirection: isRtl ? 'row-reverse' : 'row', alignItems: 'center' }}>
                        <Text style={{ fontSize: 13 }}>📝</Text>
                        <Text style={{ color: theme.text, fontSize: 14, flex: 1, fontWeight: 'bold', marginHorizontal: 6, textAlign: isRtl ? 'right' : 'left' }}>{a.name}</Text>
                        {a.deadline && (
                          <Text style={{ color: theme.warning, fontSize: 11, fontWeight: 'bold' }}>
                            {new Date(a.deadline).toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-US', { month: 'short', day: 'numeric' })}
                          </Text>
                        )}
                      </View>
                      {attachments.length > 0 && (
                        <View style={{ marginTop: 8, paddingLeft: 24 }}>
                          {attachments.map((att: any, idx: number) => {
                            const displayFileName = att.fileName ? att.fileName : (isRtl ? 'קובץ מצורף' : 'Attachment');
                            return (
                              <Pressable 
                                key={idx} 
                                style={{ flexDirection: isRtl ? 'row-reverse' : 'row', alignItems: 'center', marginVertical: 4 }}
                                onPress={() => att.fileUrl && handleDownloadFile({ file_name: displayFileName, file_url: att.fileUrl, mime_type: att.mimeType })}
                              >
                                <Text style={{ fontSize: 12 }}>{att.fileUrl ? '📄' : '🔗'}</Text>
                                <Text style={{ color: theme.textSecondary, fontSize: 12, flex: 1, marginHorizontal: 6, textAlign: isRtl ? 'right' : 'left' }}>{displayFileName}</Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      )}
                    </View>
                  );
                })}
                
                {content.files.map((f) => {
                  const displayFileName = f.file_name ? f.file_name : (isRtl ? 'קובץ מצורף' : 'Attachment');
                  return (
                    <Pressable 
                      key={f.id} 
                      style={[styles.sectionItem, { flexDirection: isRtl ? 'row-reverse' : 'row', alignItems: 'center', marginBottom: 8, padding: 8, backgroundColor: theme.backgroundElement, borderRadius: 8 }]}
                      onPress={() => handleDownloadFile(f)}
                    >
                      <Text style={{ fontSize: 13 }}>📄</Text>
                      <Text style={{ color: theme.textSecondary, fontSize: 13, flex: 1, marginHorizontal: 6, textAlign: isRtl ? 'right' : 'left' }}>{displayFileName}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ))
          )}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <Text style={[styles.headerTitle, { color: theme.text, textAlign: isRtl ? 'right' : 'left' }]}>
          {t('courses')}
        </Text>
        <Text style={{ color: theme.textSecondary, fontSize: 13, marginTop: 4, textAlign: isRtl ? 'right' : 'left' }}>
          {isRtl ? 'הגדר מעקב, כינויים וצבעי תגים עבור הקורסים שלך.' : 'Toggle tracking, customize nicknames, and set custom tags.'}
        </Text>
      </View>

      <ScrollView style={styles.list}>
        {courses.length === 0 ? (
          <View style={styles.empty}>
            <Text style={{ color: theme.textSecondary }}>
              {isRtl ? 'לא נמצאו קורסים. אנא התחבר למודל תחילה.' : 'No courses tracked. Connect Moodle first.'}
            </Text>
          </View>
        ) : (
          courses.map((c) => {
            return (
              <Pressable 
                key={c.id} 
                style={[styles.card, {
                  backgroundColor: theme.backgroundElement,
                  borderLeftWidth: isRtl ? 0 : 4,
                  borderRightWidth: isRtl ? 4 : 0,
                  borderLeftColor: isRtl ? 'transparent' : (c.color || theme.primary),
                  borderRightColor: isRtl ? (c.color || theme.primary) : 'transparent',
                }]}
                onPress={() => {
                  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                  setActiveCourseId && setActiveCourseId(c.moodle_id);
                }}
              >
                {/* Course header row */}
                <View style={[styles.cardHeader, { flexDirection: isRtl ? 'row-reverse' : 'row', marginBottom: 0 }]}>
                  <View style={{ flex: 1, marginLeft: isRtl ? 0 : 0, marginRight: isRtl ? 0 : 0 }}>
                    <Text style={[styles.courseCode, { color: theme.textSecondary, textAlign: isRtl ? 'right' : 'left' }]}>
                      {c.course_id || 'Moodle ID: ' + c.moodle_id}
                    </Text>
                    <Text style={{ color: theme.text, fontSize: 18, fontWeight: 'bold', textAlign: isRtl ? 'right' : 'left' }}>
                      {c.name}
                    </Text>
                  </View>
                  <View>
                    <Text style={{ color: theme.textSecondary, fontSize: 18, paddingHorizontal: 8 }}>
                      {isRtl ? '←' : '→'}
                    </Text>
                  </View>
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>
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
    fontSize: 24,
    fontWeight: 'bold',
  },
  list: {
    flex: 1,
    padding: 16,
  },
  empty: {
    padding: 32,
    alignItems: 'center',
  },
  card: {
    padding: 16,
    borderRadius: 14,
    marginBottom: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxTick: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  courseCode: {
    fontWeight: 'bold',
    fontSize: 14,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    fontSize: 14,
    marginBottom: 12,
  },
  colorsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  colorCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  sectionNode: {
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    gap: 6,
  },
  sectionNodeTitle: {
    fontWeight: 'bold',
    fontSize: 13,
    borderBottomWidth: 1,
    paddingBottom: 4,
    marginBottom: 6,
  },
  sectionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 2,
  },
});
