import React, { useState, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { calculateGradesSummary, Assignment } from '@tautracker/moodle-client';
import { getDb, getPreference } from '../services/database';
import { t, getLanguage } from '../services/i18n';
import { useTheme } from '../hooks/use-theme';

export default function GradesScreen() {
  const theme = useTheme();

  const [loading, setLoading] = useState<boolean>(true);
  const [courses, setCourses] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [hiddenIds, setHiddenIds] = useState<Array<string | number>>([]);
  const [completedIds, setCompletedIds] = useState<Array<string | number>>([]);
  const [uncompletedIds, setUncompletedIds] = useState<Array<string | number>>([]);

  const lang = getLanguage();
  const isRtl = lang === 'he';

  const loadGrades = () => {
    setLoading(true);
    try {
      const db = getDb();
      // Load all tracked active courses
      const courseRows = db.getAllSync<any>('SELECT * FROM tracked_courses WHERE is_active = 1');
      setCourses(courseRows);

      // Load all assignments for active tracked courses
      const assignRows = db.getAllSync<any>(
        'SELECT a.* FROM assignments a JOIN tracked_courses c ON a.course_moodle_id = c.moodle_id WHERE c.is_active = 1'
      );
      const mapped: Assignment[] = assignRows.map((a: any) => ({
        id: a.moodle_assign_id,
        uid: a.uid,
        courseId: a.course_moodle_id,
        courseName: a.course_name,
        name: a.name,
        status: a.status,
        deadline: a.deadline,
        opened: a.opened || null,
        grade: a.grade,
        gradeMax: a.grade_max,
        feedback: a.feedback,
        isBonus: Boolean(a.is_bonus),
        isHidden: Boolean(a.is_hidden),
        activityType: a.activity_type || 'assign',
        cmid: a.cmid,
        link: a.link,
      }));
      setAssignments(mapped);

      // Load local preferences
      const hiddenStr = getPreference('hidden_assignments');
      const completedStr = getPreference('completed_assignments');
      const uncompletedStr = getPreference('uncompleted_assignments');
      setHiddenIds(hiddenStr ? JSON.parse(hiddenStr) : []);
      setCompletedIds(completedStr ? JSON.parse(completedStr) : []);
      setUncompletedIds(uncompletedStr ? JSON.parse(uncompletedStr) : []);
    } catch (e) {
      console.error('loadGrades error:', e);
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadGrades();
    }, [])
  );

  const getCourseColor = (courseMoodleId: number) => {
    const course = courses.find((c) => c.moodle_id === courseMoodleId);
    return course?.color || theme.primary;
  };

  const getCourseName = (courseMoodleId: number, fallback: string) => {
    const course = courses.find((c) => c.moodle_id === courseMoodleId);
    return course?.name || fallback;
  };

  const { overallGpa, courseGroups, totalCalculatedItems } = useMemo(() => {
    return calculateGradesSummary({
      assignments,
      hiddenIdentifiers: hiddenIds,
      completedIdentifiers: completedIds,
      uncompletedIdentifiers: uncompletedIds,
    });
  }, [assignments, hiddenIds, completedIds, uncompletedIds]);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <Text style={[styles.headerTitle, { color: theme.text, textAlign: isRtl ? 'right' : 'left' }]}>{t('grades')}</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      ) : totalCalculatedItems === 0 ? (
        <View style={styles.center}>
          <Text style={{ color: theme.textSecondary, textAlign: 'center' }}>
            {t('no_grades')}
          </Text>
        </View>
      ) : (
        <ScrollView style={styles.scroll}>
          {/* Subtle Notice Banner */}
          <View style={[styles.policyNotice, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
            <Text style={[styles.policyNoticeText, { color: theme.textSecondary, textAlign: isRtl ? 'right' : 'left' }]}>
              {t('grades_policy_note')}
            </Text>
          </View>

          {/* GPA Stat Card */}
          <View style={[styles.gpaCard, { backgroundColor: theme.backgroundElement }]}>
            <Text style={{ color: theme.textSecondary, fontSize: 13, fontWeight: 'bold' }}>{t('gpa_title')}</Text>
            <Text style={[styles.gpaVal, { color: theme.text }]}>{overallGpa}</Text>
            <Text style={{ color: theme.textSecondary, fontSize: 11, marginTop: 4, textAlign: 'center' }}>
              {t('unweighted_average')}
            </Text>
          </View>

          {/* Graded groups list */}
          {Object.entries(courseGroups).map(([moodleIdStr, group]) => {
            const moodleId = Number(moodleIdStr);
            const color = getCourseColor(moodleId);

            return (
              <View
                key={moodleId}
                style={[
                  styles.courseGradesCard,
                  { 
                    backgroundColor: theme.backgroundElement,
                    borderLeftWidth: isRtl ? 0 : 4,
                    borderRightWidth: isRtl ? 4 : 0,
                    borderLeftColor: isRtl ? 'transparent' : color,
                    borderRightColor: isRtl ? color : 'transparent',
                  },
                ]}
              >
                <View style={[styles.courseHeader, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                  <Text style={[styles.courseTitle, { color, textAlign: isRtl ? 'right' : 'left', writingDirection: 'auto' }]}>{getCourseName(moodleId, group.courseName)}</Text>
                  <View style={[styles.avgBadge, { backgroundColor: color }]}>
                    <Text style={styles.avgBadgeText}>{t('course_average_label')}: {group.average}</Text>
                  </View>
                </View>

                <View style={styles.gradesList}>
                  {group.list.map((a) => (
                    <View key={a.id} style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border, paddingVertical: 8 }}>
                      <View style={[styles.gradeRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                        <View style={{ flex: 1, flexDirection: isRtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <Text style={[styles.gradeName, { color: theme.text, textAlign: isRtl ? 'right' : 'left', writingDirection: 'auto' }]}>{a.name}</Text>
                          {a.isBonus && (
                            <View style={{ backgroundColor: 'rgba(234, 179, 8, 0.15)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                              <Text style={{ color: '#eab308', fontSize: 10, fontWeight: 'bold' }}>{t('grades_bonus_label')}</Text>
                            </View>
                          )}
                        </View>
                        <Text style={[styles.gradeValLabel, { color: theme.text }]}>
                          {a.effectiveGrade} / {a.effectiveGradeMax}
                        </Text>
                      </View>
                      {a.feedback && (
                        <Text style={{ fontSize: 12, color: theme.textSecondary, marginTop: 4, textAlign: isRtl ? 'right' : 'left' }}>
                          {a.feedback}
                        </Text>
                      )}
                    </View>
                  ))}
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}
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
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  scroll: {
    flex: 1,
    padding: 16,
  },
  policyNotice: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 16,
  },
  policyNoticeText: {
    fontSize: 12,
    lineHeight: 18,
  },
  gpaCard: {
    padding: 20,
    borderRadius: 14,
    alignItems: 'center',
    marginBottom: 24,
  },
  gpaVal: {
    fontSize: 48,
    fontWeight: 'bold',
    marginTop: 8,
  },
  courseGradesCard: {
    padding: 16,
    borderRadius: 14,
    borderLeftWidth: 4,
    marginBottom: 16,
  },
  courseHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  courseTitle: {
    fontWeight: 'bold',
    fontSize: 15,
    flex: 1,
    textTransform: 'uppercase',
  },
  avgBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  avgBadgeText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  gradesList: {
    gap: 8,
  },
  gradeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
  },
  gradeName: {
    fontSize: 14,
    flex: 1,
  },
  gradeValLabel: {
    fontSize: 14,
    fontWeight: 'bold',
    marginLeft: 16,
  },
});
