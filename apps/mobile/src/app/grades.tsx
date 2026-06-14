import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { getDb } from '../services/database';
import { Colors } from '../constants/theme';
import { t, getLanguage } from '../services/i18n';
import { useTheme } from '../hooks/use-theme';

export default function GradesScreen() {
  const theme = useTheme();

  const [loading, setLoading] = useState<boolean>(true);
  const [courses, setCourses] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);

  const lang = getLanguage();
  const isRtl = lang === 'he';

  useEffect(() => {
    loadGrades();
  }, []);

  function loadGrades() {
    setLoading(true);
    try {
      const db = getDb();
      // Load all graded assignments
      const gradedRows = db.getAllSync<any>('SELECT * FROM assignments WHERE grade IS NOT NULL');
      setAssignments(gradedRows);

      // Load all tracked courses
      const courseRows = db.getAllSync<any>('SELECT * FROM tracked_courses');
      setCourses(courseRows);
    } catch (e) {
      console.error('loadGrades error:', e);
    } finally {
      setLoading(false);
    }
  }

  const getCourseColor = (courseMoodleId: number) => {
    const course = courses.find((c) => c.moodle_id === courseMoodleId);
    return course?.color || '#6366f1';
  };

  const getCourseName = (courseMoodleId: number, fallback: string) => {
    const course = courses.find((c) => c.moodle_id === courseMoodleId);
    return course?.name || fallback;
  };

  // Group graded assignments by course to calculate averages
  const gradesByCourse: Record<number, { courseName: string; sum: number; count: number; list: any[] }> = {};
  assignments.forEach((a) => {
    if (a.grade === null) return;
    if (!gradesByCourse[a.course_moodle_id]) {
      gradesByCourse[a.course_moodle_id] = { courseName: a.course_name, sum: 0, count: 0, list: [] };
    }
    const ratio = a.grade_max ? a.grade / a.grade_max : 0;
    gradesByCourse[a.course_moodle_id].sum += ratio * 100;
    gradesByCourse[a.course_moodle_id].count += 1;
    gradesByCourse[a.course_moodle_id].list.push(a);
  });

  // Calculate overall average GPA
  let totalCourseAverageSum = 0;
  let courseAveragesCount = 0;
  Object.values(gradesByCourse).forEach((c) => {
    totalCourseAverageSum += c.sum / c.count;
    courseAveragesCount++;
  });
  const overallAverage = courseAveragesCount > 0 ? (totalCourseAverageSum / courseAveragesCount).toFixed(1) : '-';

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: theme.text, textAlign: isRtl ? 'right' : 'left' }]}>{t('grades')}</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#6366f1" />
        </View>
      ) : assignments.length === 0 ? (
        <View style={styles.center}>
          <Text style={{ color: theme.textSecondary, textAlign: 'center' }}>
            {t('no_grades')}
          </Text>
        </View>
      ) : (
        <ScrollView style={styles.scroll}>
          {/* GPA Stat Card */}
          <View style={[styles.gpaCard, { backgroundColor: theme.backgroundElement }]}>
            <Text style={{ color: theme.textSecondary, fontSize: 13, fontWeight: 'bold' }}>{t('gpa_title')}</Text>
            <Text style={[styles.gpaVal, { color: theme.text }]}>{overallAverage}</Text>
            <Text style={{ color: theme.textSecondary, fontSize: 11, marginTop: 4, textAlign: 'center' }}>
              {t('unweighted_average')}
            </Text>
          </View>

          {/* Graded groups list */}
          {Object.entries(gradesByCourse).map(([moodleIdStr, group]) => {
            const moodleId = Number(moodleIdStr);
            const color = getCourseColor(moodleId);
            const courseAverage = (group.sum / group.count).toFixed(1);

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
                    <Text style={styles.avgBadgeText}>{t('course_average_label')}: {courseAverage}</Text>
                  </View>
                </View>

                <View style={styles.gradesList}>
                  {group.list.map((a) => (
                    <View key={a.id} style={[styles.gradeRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                      <Text style={[styles.gradeName, { color: theme.text, textAlign: isRtl ? 'right' : 'left', writingDirection: 'auto' }]}>{a.name}</Text>
                      <Text style={[styles.gradeValLabel, { color: theme.text }]}>
                        {a.grade} / {a.grade_max}
                      </Text>
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
    borderBottomColor: 'rgba(255,255,255,0.05)',
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
  gpaCard: {
    padding: 20,
    borderRadius: 8,
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
    borderRadius: 8,
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
    borderRadius: 4,
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
    borderBottomColor: 'rgba(255,255,255,0.03)',
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
