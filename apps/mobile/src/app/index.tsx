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
  Image,
} from 'react-native';
import { getMoodleToken, setMoodleToken, triggerForegroundSync } from '../services/backgroundSync';
import { loginTauSso, getStoredCredentials, saveCredentials, clearCredentials } from '../services/auth';
import { getDb, getPreference, setPreference } from '../services/database';
import { MoodleClient, parseTauCourseMetadata } from '@tautracker/moodle-client';
import { Colors } from '../constants/theme';
import { t, getLanguage } from '../services/i18n';
import { useTheme } from '../hooks/use-theme';

interface GroupedCourses {
  semesterKey: string;
  year: string;
  semester: 'SemesterA' | 'SemesterB' | 'Yearly' | 'Other';
  label: string;
  courses: any[];
}

function groupAndSortCourses(courses: any[], lang: string): GroupedCourses[] {
  const groups: Record<string, any[]> = {};
  
  courses.forEach(c => {
    const idNum = c.idnumber || c.shortname || '';
    const meta = parseTauCourseMetadata(idNum);
    const year = meta?.year || '';
    const semester = meta?.semester || 'Other';
    
    const key = year ? `${year}-${semester}` : 'Other';
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(c);
  });
  
  const result: GroupedCourses[] = [];
  
  Object.keys(groups).forEach(key => {
    if (key === 'Other') {
      result.push({
        semesterKey: 'Other',
        year: '',
        semester: 'Other',
        label: lang === 'he' ? 'אחר' : 'Other',
        courses: groups[key]
      });
    } else {
      const [year, semester] = key.split('-');
      let label = '';
      if (lang === 'he') {
        const semName = semester === 'SemesterA' ? "סמסטר א'" : semester === 'SemesterB' ? "סמסטר ב'" : semester === 'Yearly' ? "שנתי" : "אחר";
        label = `${semName} (${year})`;
      } else {
        const semName = semester === 'SemesterA' ? "Semester A" : semester === 'SemesterB' ? "Semester B" : semester === 'Yearly' ? "Yearly" : "Other";
        label = `${semName} (${year})`;
      }
      result.push({
        semesterKey: key,
        year,
        semester: semester as any,
        label,
        courses: groups[key]
      });
    }
  });
  
  result.sort((a, b) => {
    if (a.semesterKey === 'Other') return 1;
    if (b.semesterKey === 'Other') return -1;
    
    const yearDiff = parseInt(b.year) - parseInt(a.year);
    if (yearDiff !== 0) return yearDiff;
    
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

export default function DashboardScreen() {
  const theme = useTheme();

  const [loading, setLoading] = useState<boolean>(true);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [token, setToken] = useState<string | null>(null);
  const [onboardingStep, setOnboardingStep] = useState<number>(1); // 1 = token entry, 2 = select courses, 3 = dashboard

  // Inputs/Selection
  const [inputUsername, setInputUsername] = useState<string>('');
  const [inputIdNumber, setInputIdNumber] = useState<string>('');
  const [inputPassword, setInputPassword] = useState<string>('');
  const [rememberMe, setRememberMe] = useState<boolean>(false);
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

      // Pre-fill login form if credentials were saved
      const creds = await getStoredCredentials();
      if (creds) {
        setInputUsername(creds.username);
        setInputIdNumber(creds.idNumber);
        setInputPassword(creds.password);
        setRememberMe(true);
      }

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
    if (!inputUsername.trim() || !inputIdNumber.trim() || !inputPassword.trim()) {
      Alert.alert(t('connect_moodle'), isRtl ? 'נא למלא את כל השדות.' : 'Please fill in all fields.');
      return;
    }
    setLoading(true);
    try {
      const fetchedToken = await loginTauSso(
        inputUsername.trim(),
        inputIdNumber.trim(),
        inputPassword.trim()
      );
      await setMoodleToken(fetchedToken);
      setToken(fetchedToken);

      if (rememberMe) {
        await saveCredentials(inputUsername.trim(), inputIdNumber.trim(), inputPassword.trim());
      } else {
        await clearCredentials();
      }

      await fetchEnrolledCourses(fetchedToken);
      setOnboardingStep(2);
    } catch (e: any) {
      Alert.alert(isRtl ? 'כניסה נכשלה' : 'Login Failed', e.message || 'An error occurred during login.');
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
  // Onboarding Step 1 View — SSO Login
  // ---------------------------------------------------------
  if (onboardingStep === 1) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <ScrollView contentContainerStyle={styles.onboardingCard} keyboardShouldPersistTaps="handled">
          <Image
            source={require('../../assets/logo.png')}
            style={{
              width: 80,
              height: 80,
              alignSelf: 'center',
              marginBottom: 16,
              borderRadius: 16,
            }}
            resizeMode="contain"
          />
          <Text style={[styles.onboardingTitle, { color: theme.text, textAlign: 'center', marginBottom: 8 }]}>
            {t('connect_moodle')}
          </Text>
          <Text style={[styles.onboardingSubtitle, { color: theme.textSecondary, textAlign: 'center', marginBottom: 24 }]}>
            {isRtl
              ? 'היכנס עם פרטי המשתמש שלך של מערכת TAU'
              : 'Sign in with your TAU Moodle credentials'}
          </Text>

          <TextInput
            style={[styles.input, { borderColor: theme.border, color: theme.text, textAlign: isRtl ? 'right' : 'left' }]}
            placeholder={isRtl ? 'שם משתמש (אנגלית)' : 'Username'}
            placeholderTextColor={theme.placeholder}
            value={inputUsername}
            onChangeText={setInputUsername}
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="username"
          />

          <TextInput
            style={[styles.input, { borderColor: theme.border, color: theme.text, textAlign: isRtl ? 'right' : 'left' }]}
            placeholder={isRtl ? 'מספר תעודת זהות' : 'ID Number'}
            placeholderTextColor={theme.placeholder}
            value={inputIdNumber}
            onChangeText={setInputIdNumber}
            keyboardType="numeric"
            textContentType="none"
          />

          <TextInput
            style={[styles.input, { borderColor: theme.border, color: theme.text, textAlign: isRtl ? 'right' : 'left' }]}
            placeholder={isRtl ? 'סיסמה' : 'Password'}
            placeholderTextColor={theme.placeholder}
            value={inputPassword}
            onChangeText={setInputPassword}
            secureTextEntry
            textContentType="password"
          />

          {/* Remember me */}
          <Pressable
            style={[styles.rememberMeRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}
            onPress={() => setRememberMe(!rememberMe)}
          >
            <View style={[
              styles.checkbox,
              { borderColor: theme.primary, backgroundColor: rememberMe ? theme.primary : 'transparent' }
            ]}>
              {rememberMe && <Text style={styles.checkmark}>✓</Text>}
            </View>
            <Text style={[styles.rememberMeLabel, { color: theme.textSecondary }]}>
              {isRtl ? 'זכור אותי' : 'Remember me'}
            </Text>
          </Pressable>

          <Pressable style={[styles.primaryBtn, { backgroundColor: theme.primary }]} onPress={handleConnect} disabled={loading}>
            {loading ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.primaryBtnText}>
                {isRtl ? 'כניסה' : 'Sign In'}
              </Text>
            )}
          </Pressable>
        </ScrollView>
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
          {groupAndSortCourses(availableCourses, lang).map((group) => (
            <View key={group.semesterKey} style={{ marginBottom: 20 }}>
              <Text
                style={{
                  color: theme.text,
                  fontSize: 16,
                  fontWeight: 'bold',
                  borderBottomWidth: 1,
                  borderBottomColor: theme.border,
                  paddingBottom: 6,
                  marginBottom: 10,
                  marginHorizontal: 16,
                  textAlign: isRtl ? 'right' : 'left',
                }}
              >
                {group.label}
              </Text>
              {group.courses.map((c) => {
                const isSelected = selectedCourseIds.includes(c.id);
                return (
                  <Pressable
                    key={c.id}
                    style={[
                      styles.courseSelectItem,
                      {
                        backgroundColor: isSelected ? theme.backgroundSelected : theme.backgroundElement,
                        borderColor: isSelected ? theme.primary : 'transparent',
                      },
                    ]}
                    onPress={() => handleCourseToggle(c.id)}
                  >
                    <Text style={[styles.courseSelectName, { color: theme.text, writingDirection: 'auto', textAlign: isRtl ? 'right' : 'left' }]}>{c.fullname}</Text>
                    <Text style={{ color: theme.textSecondary, fontSize: 12, textAlign: isRtl ? 'right' : 'left' }}>{c.shortname}</Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </ScrollView>
        <View style={styles.actionFooter}>
          <Pressable style={[styles.primaryBtn, { backgroundColor: theme.primary }]} onPress={handleSaveCourses}>
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
      <View style={[styles.header, { flexDirection: isRtl ? 'row-reverse' : 'row', borderBottomColor: theme.border, borderBottomWidth: 1 }]}>
        <View>
          <Text style={[styles.headerTitle, { color: theme.text, textAlign: isRtl ? 'right' : 'left' }]}>{t('dashboard')}</Text>
          {syncing && <Text style={{ color: theme.primary, fontSize: 12, textAlign: isRtl ? 'right' : 'left' }}>{t('syncing')}</Text>}
        </View>
        <Pressable style={[styles.syncBtn, { backgroundColor: theme.primary }]} onPress={handleManualSync} disabled={syncing}>
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
            const cColor = courseMap[a.course_moodle_id]?.color || theme.primary;
            const cName = courseMap[a.course_moodle_id]?.name || a.course_name;
            const hoursLeft = a.deadline ? (new Date(a.deadline).getTime() - Date.now()) / (1000 * 60 * 60) : null;
            let deadlineText = t('no_deadline');
            if (hoursLeft !== null && a.deadline) {
              if (hoursLeft < 0) {
                deadlineText = t('overdue');
              } else {
                const diffMs = new Date(a.deadline).getTime() - Date.now();
                const diffMins = Math.floor(diffMs / (1000 * 60));
                const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
                const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
                
                if (diffDays >= 1) {
                  deadlineText = diffDays === 1 ? t('due_in_day') : t('due_in_days', { days: diffDays });
                } else if (diffHours >= 1) {
                  deadlineText = diffHours === 1 ? t('due_in_hour') : t('due_in_hours', { hours: diffHours });
                } else {
                  const mins = diffMins > 0 ? diffMins : 1;
                  deadlineText = mins === 1 ? t('due_in_minute') : t('due_in_minutes', { minutes: mins });
                }
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
                <View style={[styles.statusBadge, { backgroundColor: a.status === 'Submitted' ? theme.secondary : theme.primary }]}>
                  <Text style={{ color: '#ffffff', fontSize: 11, fontWeight: 'bold' }}>
                    {a.status === 'Submitted' ? (isRtl ? 'הוגש' : 'Submitted') : (isRtl ? 'מטלה' : 'Assigned')}
                  </Text>
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
            const cColor = courseMap[m.course_moodle_id]?.color || theme.secondary;
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
                  style={[styles.joinBtn, { backgroundColor: theme.secondary }]}
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
    flexGrow: 1,
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
    borderRadius: 12,
    fontSize: 16,
    marginBottom: 16,
  },
  rememberMeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    gap: 10,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmark: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  rememberMeLabel: {
    fontSize: 14,
  },
  primaryBtn: {
    padding: 14,
    borderRadius: 12,
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
    borderRadius: 14,
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
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
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
    borderRadius: 14,
    alignItems: 'center',
  },
  assignmentCard: {
    padding: 16,
    borderRadius: 14,
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
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  meetingCard: {
    padding: 16,
    borderRadius: 14,
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
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
  },
});
