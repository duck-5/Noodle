import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  Alert,
} from 'react-native';
import { getDb } from '../services/database';
import { Colors } from '../constants/theme';
import { t, getLanguage } from '../services/i18n';
import { useTheme } from '../hooks/use-theme';

const PRESETS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#06b6d4'];

export default function CoursesScreen() {
  const theme = useTheme();

  const [courses, setCourses] = useState<any[]>([]);
  const [expandedCourses, setExpandedCourses] = useState<Record<number, boolean>>({});

  const lang = getLanguage();
  const isRtl = lang === 'he';

  useEffect(() => {
    loadCourses();
  }, []);

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
            const isTracked = c.is_active === 1;
            const isExpanded = expandedCourses[c.id] ?? false;

            // Build sections for this course from DB
            const db = getDb();
            const courseAssignments = db.getAllSync<any>(
              'SELECT * FROM assignments WHERE course_moodle_id = ? AND status != ?',
              [c.moodle_id, 'Submitted']
            );
            const courseFiles = db.getAllSync<any>(
              'SELECT * FROM files WHERE course_moodle_id = ?',
              [c.moodle_id]
            );
            const sectionsMap: Record<string, { assignments: any[]; files: any[] }> = {};
            const getSection = (name: string) => {
              const n = name || (isRtl ? 'כללי' : 'General');
              if (!sectionsMap[n]) sectionsMap[n] = { assignments: [], files: [] };
              return sectionsMap[n];
            };
            courseFiles.forEach((f: any) => getSection(f.section_name).files.push(f));
            courseAssignments.forEach((a: any) => getSection(a.section_name || (isRtl ? 'כללי' : 'General')).assignments.push(a));
            const sectionEntries = Object.entries(sectionsMap);

            return (
              <View key={c.id} style={[styles.card, {
                backgroundColor: theme.backgroundElement,
                borderLeftWidth: isRtl ? 0 : 4,
                borderRightWidth: isRtl ? 4 : 0,
                borderLeftColor: isRtl ? 'transparent' : (c.color || theme.primary),
                borderRightColor: isRtl ? (c.color || theme.primary) : 'transparent',
              }]}>
                {/* Course header row */}
                <View style={[styles.cardHeader, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                  <Pressable
                    style={[
                      styles.checkbox,
                      {
                        backgroundColor: isTracked ? c.color || theme.primary : 'transparent',
                        borderColor: c.color || theme.primary,
                      },
                    ]}
                    onPress={() => handleToggleActive(c.id, c.is_active)}
                  >
                    {isTracked && <Text style={styles.checkboxTick}>✓</Text>}
                  </Pressable>
                  <View style={{ flex: 1, marginLeft: isRtl ? 0 : 12, marginRight: isRtl ? 12 : 0 }}>
                    <Text style={[styles.courseCode, { color: theme.textSecondary, textAlign: isRtl ? 'right' : 'left' }]}>
                      {c.course_id || 'Moodle ID: ' + c.moodle_id}
                    </Text>
                  </View>
                  {/* Expand/Collapse toggle */}
                  <Pressable onPress={() => setExpandedCourses(prev => ({ ...prev, [c.id]: !isExpanded }))}>
                    <Text style={{ color: theme.textSecondary, fontSize: 18, paddingHorizontal: 8 }}>
                      {isExpanded ? '▲' : '▼'}
                    </Text>
                  </Pressable>
                </View>

                {/* Nickname Input */}
                <TextInput
                  style={[styles.input, { borderColor: theme.border, color: theme.text, textAlign: isRtl ? 'right' : 'left', writingDirection: 'auto' }]}
                  value={c.name}
                  onChangeText={(text) => handleUpdateName(c.id, text)}
                  placeholder={t('nickname_placeholder')}
                  placeholderTextColor={theme.placeholder}
                />

                {/* Color Selector presets */}
                <View style={[styles.colorsRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                  {PRESETS.map((color) => {
                    const isSelected = c.color === color;
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
                        onPress={() => handleSelectColor(c.id, color)}
                      />
                    );
                  })}
                </View>

                {/* Sections Tree */}
                {isExpanded && (
                  <View style={{ marginTop: 16, borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 12 }}>
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
                          {content.assignments.map((a) => (
                            <View key={a.id} style={[styles.sectionItem, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                              <Text style={{ fontSize: 13 }}>📝</Text>
                              <Text style={{ color: theme.text, fontSize: 13, flex: 1, textAlign: isRtl ? 'right' : 'left' }}>{a.name}</Text>
                              {a.deadline && (
                                <Text style={{ color: theme.warning, fontSize: 11, fontWeight: 'bold' }}>
                                  {new Date(a.deadline).toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-US', { month: 'short', day: 'numeric' })}
                                </Text>
                              )}
                            </View>
                          ))}
                          {content.files.map((f) => (
                            <View key={f.id} style={[styles.sectionItem, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                              <Text style={{ fontSize: 13 }}>📄</Text>
                              <Text style={{ color: theme.textSecondary, fontSize: 13, flex: 1, textAlign: isRtl ? 'right' : 'left' }}>{f.file_name}</Text>
                            </View>
                          ))}
                        </View>
                      ))
                    )}
                  </View>
                )}
              </View>
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
