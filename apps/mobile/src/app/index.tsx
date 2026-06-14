import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
  useColorScheme,
} from 'react-native';
import { getMoodleToken, setMoodleToken, triggerForegroundSync } from '../services/backgroundSync';
import { getDb, getPreference, setPreference } from '../services/database';
import { MoodleClient } from '@tautracker/moodle-client';
import { Colors } from '../constants/theme';
import { t, getLanguage } from '../services/i18n';

export default function DashboardScreen() {
  const scheme = useColorScheme();
  const theme = Colors[scheme === 'dark' ? 'dark' : 'light'];

  const [loading, setLoading] = useState<boolean>(true);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [token, setToken] = useState<string | null>(null);
  const [onboardingStep, setOnboardingStep] = useState<number>(1); // 1 = token entry, 2 = select courses, 3 = dashboard

  // Inputs/Selection
  const [inputToken, setInputToken] = useState<string>('');
  const [availableCourses, setAvailableCourses] = useState<any[]>([]);
  const [selectedCourseIds, setSelectedCourseIds] = useState<number[]>([]);

  // Cached data
  const [assignments, setAssignments] = useState<any[]>([]);
  const [meetings, setMeetings] = useState<any[]>([]);
  const [courseMap, setCourseMap] = useState<Record<number, any>>({});

  const lang = getLanguage();
  const isRtl = lang === 'he';

  useEffect(() => {
    loadAppStatus();
  }, []);

  async function loadAppStatus() {
    setLoading(true);
    try {
      const storedToken = await getMoodleToken();
      setToken(storedToken);

      const db = getDb();
      const trackedCourses = db.getAllSync<any>('SELECT * FROM tracked_courses WHERE is_active = 1');

      if (storedToken && trackedCourses.length > 0) {
        setOnboardingStep(3);
        loadDashboardData();
      } else if (storedToken) {
        setOnboardingStep(2);
        fetchEnrolledCourses(storedToken);
      } else {
        setOnboardingStep(1);
      }
    } catch (e) {
      console.error('loadAppStatus error:', e);
    } finally {
      setLoading(false);
    }
  }

  async function fetchEnrolledCourses(moodleToken: string) {
    try {
      const client = new MoodleClient(moodleToken);
      const info = await client.getSiteInfo();
      const courses = await client.getEnrolledCourses(info.userid);
      setAvailableCourses(courses);
    } catch (e: any) {
      Alert.alert(t('connect_moodle'), e.message || 'Failed to fetch Moodle courses.');
      setOnboardingStep(1);
    }
  }

  async function handleConnect() {
    if (!inputToken.trim()) return;
    setLoading(true);
    try {
      const client = new MoodleClient(inputToken.trim());
      const info = await client.getSiteInfo(); // Validate token
      await setMoodleToken(inputToken.trim());
      setToken(inputToken.trim());
      await fetchEnrolledCourses(inputToken.trim());
      setOnboardingStep(2);
    } catch (e: any) {
      Alert.alert('Connection Failed', e.message || 'Invalid token. Please check and try again.');
    } finally {
      setLoading(false);
    }
  }

  const handleCourseToggle = (moodleId: number) => {
    if (selectedCourseIds.includes(moodleId)) {
      setSelectedCourseIds(selectedCourseIds.filter((id) => id !== moodleId));
    } else {
      setSelectedCourseIds([...selectedCourseIds, moodleId]);
    }
  };

  async function handleSaveCourses() {
    if (selectedCourseIds.length === 0) {
      Alert.alert('No Courses Selected', 'Please select at least one course to track.');
      return;
    }
    setLoading(true);
    try {
      const db = getDb();
      db.withTransactionSync(() => {
        db.runSync('DELETE FROM tracked_courses');
        for (const cId of selectedCourseIds) {
          const course = availableCourses.find((c) => c.id === cId);
          if (course) {
            db.runSync(
              'INSERT INTO tracked_courses (moodle_id, name, course_id, semester, year, color, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)',
              [course.id, course.fullname, course.idnumber || '', '', '', '#6366f1', 1]
            );
          }
        }
      });
      setOnboardingStep(3);
      handleManualSync();
    } catch (e: any) {
      Alert.alert('Database Error', e.message || 'Failed to save courses.');
    } finally {
      setLoading(false);
    }
  }

  async function handleManualSync() {
    setSyncing(true);
    try {
      await triggerForegroundSync();
      loadDashboardData();
    } catch (e: any) {
      Alert.alert('Sync Failed', e.message || 'An error occurred during synchronization.');
    } finally {
      setSyncing(false);
    }
  }

  function loadDashboardData() {
    try {
      const db = getDb();
      // Load assignments
      const cachedAssigns = db.getAllSync<any>('SELECT * FROM assignments WHERE status != ? ORDER BY deadline ASC', ['Submitted']);
      setAssignments(cachedAssigns);

      // Load meetings
      const cachedMeetings = db.getAllSync<any>('SELECT * FROM meetings ORDER BY id ASC');
      setMeetings(cachedMeetings);

      // Load courses map
      const tracked = db.getAllSync<any>('SELECT * FROM tracked_courses');
      const map: Record<number, any> = {};
      for (const t of tracked) {
        map[t.moodle_id] = t;
      }
      setCourseMap(map);
    } catch (e) {
      console.error('loadDashboardData error:', e);
    }
  }

  // ---------------------------------------------------------
  // Onboarding Step 1 View
  // ---------------------------------------------------------
  if (onboardingStep === 1) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={styles.onboardingCard}>
          <Text style={[styles.onboardingTitle, { color: theme.text, textAlign: isRtl ? 'right' : 'left' }]}>
            {t('connect_moodle')}
          </Text>
          <Text style={[styles.onboardingSubtitle, { color: theme.textSecondary, textAlign: isRtl ? 'right' : 'left' }]}>
            {t('moodle_token_desc')}
          </Text>

          <TextInput
            style={[styles.input, { borderColor: theme.backgroundSelected, color: theme.text, textAlign: isRtl ? 'right' : 'left' }]}
            placeholder={t('paste_token_placeholder')}
            placeholderTextColor={theme.textSecondary}
            value={inputToken}
            onChangeText={setInputToken}
            secureTextEntry
          />

          <Pressable style={styles.primaryBtn} onPress={handleConnect} disabled={loading}>
            {loading ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.primaryBtnText}>{t('connect_btn')}</Text>
            )}
          </Pressable>

          <ScrollView style={styles.helpBox}>
            <Text style={[styles.helpTitle, { color: theme.text, textAlign: isRtl ? 'right' : 'left' }]}>
              {t('token_help_title')}
            </Text>
            <Text style={[styles.helpText, { color: theme.textSecondary, textAlign: isRtl ? 'right' : 'left' }]}>
              {t('token_help_step1')}{'\n'}
              {t('token_help_step2')}{'\n'}
              {t('token_help_step3')}{'\n'}
              {t('token_help_step4')}
            </Text>
          </ScrollView>
        </View>
      </View>
    );
  }

  // ---------------------------------------------------------
  // Onboarding Step 2 View
  // ---------------------------------------------------------
  if (onboardingStep === 2) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <Text style={[styles.sectionTitle, { color: theme.text, padding: 16, textAlign: isRtl ? 'right' : 'left' }]}>
          {t('select_courses_title')}
        </Text>
        <ScrollView style={styles.scrollList}>
          {availableCourses.map((c) => {
            const isSelected = selectedCourseIds.includes(c.id);
            return (
              <Pressable
                key={c.id}
                style={[
                  styles.courseSelectItem,
                  {
                    backgroundColor: isSelected ? theme.backgroundSelected : theme.backgroundElement,
                    borderColor: isSelected ? '#6366f1' : 'transparent',
                  },
                ]}
                onPress={() => handleCourseToggle(c.id)}
              >
                <Text style={[styles.courseSelectName, { color: theme.text, writingDirection: 'auto', textAlign: isRtl ? 'right' : 'left' }]}>{c.fullname}</Text>
                <Text style={{ color: theme.textSecondary, fontSize: 12, textAlign: isRtl ? 'right' : 'left' }}>{c.shortname}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={styles.actionFooter}>
          <Pressable style={styles.primaryBtn} onPress={handleSaveCourses}>
            <Text style={styles.primaryBtnText}>
              {t('start_tracking_btn')} ({selectedCourseIds.length})
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ---------------------------------------------------------
  // Main Dashboard View (Step 3)
  // ---------------------------------------------------------
  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
        <View>
          <Text style={[styles.headerTitle, { color: theme.text, textAlign: isRtl ? 'right' : 'left' }]}>{t('dashboard')}</Text>
          {syncing && <Text style={{ color: '#6366f1', fontSize: 12, textAlign: isRtl ? 'right' : 'left' }}>{t('syncing')}</Text>}
        </View>
        <Pressable style={styles.syncBtn} onPress={handleManualSync} disabled={syncing}>
          <Text style={styles.syncBtnText}>{syncing ? t('syncing') : t('sync_now')}</Text>
        </Pressable>
      </View>

      <ScrollView style={styles.scrollView}>
        <Text style={[styles.sectionHeading, { color: theme.text, textAlign: isRtl ? 'right' : 'left' }]}>
          {t('pending_tasks')} ({assignments.length})
        </Text>
        {assignments.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: theme.backgroundElement }]}>
            <Text style={{ color: theme.textSecondary, textAlign: 'center' }}>{t('no_pending_tasks')}</Text>
          </View>
        ) : (
          assignments.map((a) => {
            const cColor = courseMap[a.course_moodle_id]?.color || '#6366f1';
            const cName = courseMap[a.course_moodle_id]?.name || a.course_name;
            const hoursLeft = a.deadline ? (new Date(a.deadline).getTime() - Date.now()) / (1000 * 60 * 60) : null;
            let deadlineText = t('no_deadline');
            if (hoursLeft !== null) {
              if (hoursLeft < 0) {
                deadlineText = t('overdue');
              } else if (hoursLeft <= 24) {
                deadlineText = t('due_in_hours', { hours: Math.round(hoursLeft) });
              } else if (hoursLeft <= 72) {
                deadlineText = t('due_in_days', { days: Math.round(hoursLeft / 24) });
              } else {
                deadlineText = t('due_date_label', { date: new Date(a.deadline).toLocaleDateString() });
              }
            }
            return (
              <View
                key={a.id}
                style={[
                  styles.assignmentCard,
                  {
                    backgroundColor: theme.backgroundElement,
                    borderLeftWidth: isRtl ? 0 : 4,
                    borderRightWidth: isRtl ? 4 : 0,
                    borderLeftColor: isRtl ? 'transparent' : cColor,
                    borderRightColor: isRtl ? cColor : 'transparent',
                    flexDirection: isRtl ? 'row-reverse' : 'row',
                  },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.courseTag, { color: cColor, textAlign: isRtl ? 'right' : 'left', writingDirection: 'auto' }]}>{cName}</Text>
                  <Text style={[styles.assignName, { color: theme.text, textAlign: isRtl ? 'right' : 'left', writingDirection: 'auto' }]}>{a.name}</Text>
                  <Text style={{ color: theme.textSecondary, fontSize: 12, marginTop: 4, textAlign: isRtl ? 'right' : 'left' }}>
                    {deadlineText}
                  </Text>
                </View>
                <View style={styles.statusBadge}>
                  <Text style={{ color: '#ffffff', fontSize: 11, fontWeight: 'bold' }}>{a.status}</Text>
                </View>
              </View>
            );
          })
        )}

        <Text style={[styles.sectionHeading, { color: theme.text, marginTop: 24, textAlign: isRtl ? 'right' : 'left' }]}>
          {t('zoom_links')} ({meetings.length})
        </Text>
        {meetings.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: theme.backgroundElement }]}>
            <Text style={{ color: theme.textSecondary, textAlign: 'center' }}>{t('no_zoom_links')}</Text>
          </View>
        ) : (
          meetings.map((m) => {
            const cColor = courseMap[m.course_moodle_id]?.color || '#10b981';
            return (
              <View
                key={m.id}
                style={[
                  styles.meetingCard,
                  {
                    backgroundColor: theme.backgroundElement,
                    borderLeftWidth: isRtl ? 0 : 4,
                    borderRightWidth: isRtl ? 4 : 0,
                    borderLeftColor: isRtl ? 'transparent' : cColor,
                    borderRightColor: isRtl ? cColor : 'transparent',
                    flexDirection: isRtl ? 'row-reverse' : 'row',
                  },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.textSecondary, fontSize: 12, textAlign: isRtl ? 'right' : 'left', writingDirection: 'auto' }}>{m.section_name}</Text>
                  <Text style={[styles.meetingTitle, { color: theme.text, textAlign: isRtl ? 'right' : 'left', writingDirection: 'auto' }]}>{m.title}</Text>
                </View>
                <Pressable
                  style={styles.joinBtn}
                  onPress={() => {
                    Alert.alert(t('join_zoom'), `Redirecting to: ${m.meeting_url}`);
                  }}
                >
                  <Text style={{ color: '#ffffff', fontWeight: 'bold', fontSize: 12 }}>{t('join_zoom')}</Text>
                </Pressable>
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
  onboardingCard: {
    padding: 24,
    justifyContent: 'center',
    flex: 1,
  },
  onboardingTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  onboardingSubtitle: {
    fontSize: 14,
    marginBottom: 24,
    lineHeight: 20,
  },
  input: {
    borderWidth: 1,
    padding: 12,
    borderRadius: 8,
    fontSize: 16,
    marginBottom: 16,
  },
  primaryBtn: {
    backgroundColor: '#6366f1',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  helpBox: {
    marginTop: 24,
    maxHeight: 180,
  },
  helpTitle: {
    fontWeight: 'bold',
    fontSize: 14,
    marginBottom: 8,
  },
  helpText: {
    fontSize: 13,
    lineHeight: 18,
  },
  scrollList: {
    flex: 1,
    paddingHorizontal: 16,
  },
  courseSelectItem: {
    padding: 16,
    borderRadius: 8,
    borderWidth: 2,
    marginBottom: 8,
  },
  courseSelectName: {
    fontWeight: 'bold',
    fontSize: 15,
    marginBottom: 4,
  },
  actionFooter: {
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    paddingTop: 60,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  syncBtn: {
    backgroundColor: '#6366f1',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  syncBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
  },
  scrollView: {
    flex: 1,
    paddingHorizontal: 16,
  },
  sectionHeading: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  emptyCard: {
    padding: 24,
    borderRadius: 8,
    alignItems: 'center',
  },
  assignmentCard: {
    padding: 16,
    borderRadius: 8,
    borderLeftWidth: 4,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  courseTag: {
    fontSize: 11,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  assignName: {
    fontSize: 15,
    fontWeight: 'bold',
  },
  statusBadge: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  meetingCard: {
    padding: 16,
    borderRadius: 8,
    borderLeftWidth: 4,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  meetingTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    marginTop: 2,
  },
  joinBtn: {
    backgroundColor: '#10b981',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 4,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
  },
});
