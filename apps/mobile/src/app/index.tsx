import React, { useState, useEffect, useCallback } from 'react';
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
  LayoutAnimation,
  Platform,
  UIManager,
  Linking,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useFocusEffect } from 'expo-router';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import { getMoodleToken, setMoodleToken, triggerForegroundSync, registerBackgroundSyncTask } from '../services/backgroundSync';
import { downloadMoodleFile } from '../services/fileDownloadService';
import { loginTauSso, getStoredCredentials, saveCredentials, clearCredentials } from '../services/auth';
import { performSettingsSync, markSettingUpdatedAndSync } from '../services/settingsSyncService';
import { getDb, getPreference, setPreference } from '../services/database';
import { setGoogleAccessToken } from '../services/googleTasks';
import { MoodleClient, parseTauCourseMetadata } from '@tautracker/moodle-client';
import { t } from '../services/i18n';
import { usePreferences } from '../hooks/use-preferences';
import CoursesScreen from './courses';
import FilesScreen from './files';
import GradesScreen from './grades';
import SettingsScreen from './settings';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

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
    const semesterKey = `${year}-${semester}`;
    
    if (!groups[semesterKey]) {
      groups[semesterKey] = [];
    }
    groups[semesterKey].push(c);
  });

  const semesterLabels: Record<string, string> = {
    SemesterA: lang === 'he' ? 'סמסטר א׳' : 'Semester A',
    SemesterB: lang === 'he' ? 'סמסטר ב׳' : 'Semester B',
    Yearly: lang === 'he' ? 'שנתי' : 'Yearly',
    Other: lang === 'he' ? 'אחר' : 'Other'
  };

  return Object.keys(groups).map(key => {
    const [year, sem] = key.split('-');
    const label = `${semesterLabels[sem] || sem} - ${year}`;
    return {
      semesterKey: key,
      year,
      semester: sem as any,
      label,
      courses: groups[key]
    };
  }).sort((a, b) => b.semesterKey.localeCompare(a.semesterKey));
}

function isValidIsraeliId(id: string): boolean {
  const str = String(id).trim();
  if (str.length > 9 || isNaN(Number(str))) return false;
  const padded = str.padStart(9, '0');
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let num = Number(padded.charAt(i)) * ((i % 2) + 1);
    if (num > 9) num = num - 9;
    sum += num;
  }
  return sum % 10 === 0;
}

export default function DashboardScreen() {
  const { theme, language: lang, isRtl, setLanguage, refreshPreferences } = usePreferences();

  const [loading, setLoading] = useState<boolean>(true);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [token, setToken] = useState<string | null>(null);
  const [onboardingStep, setOnboardingStep] = useState<number>(1); // 1 = token entry, 2 = select courses, 3 = dashboard
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [activeCourseId, setActiveCourseId] = useState<number | null>(null);
  const [sidebarExpanded, setSidebarExpanded] = useState<boolean>(false);

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
  const [trackedCourses, setTrackedCourses] = useState<any[]>([]);

  // UI details matching SPEC
  const [userFullname, setUserFullname] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [completedCount, setCompletedCount] = useState<number>(0);

  // Accordion feed elements and files
  const [expandedAssignments, setExpandedAssignments] = useState<Record<string, boolean>>({});
  const [openMenuAssignId, setOpenMenuAssignId] = useState<string | null>(null);
  const [dashboardFiles, setDashboardFiles] = useState<any[]>([]);
  const [interestedMeetings, setInterestedMeetings] = useState<string[]>([]);
  const [expandedCourseId, setExpandedCourseId] = useState<number | null>(null);

  const [filterPending, setFilterPending] = useState<boolean>(true);
  const [filterPast, setFilterPast] = useState<boolean>(false);
  const [filterHidden, setFilterHidden] = useState<boolean>(false);
  const [filterCompleted, setFilterCompleted] = useState<boolean>(false);

  useFocusEffect(
    useCallback(() => {
      loadDashboardData();
    }, [])
  );



  useEffect(() => {
    if (!token) return;
    
    // Register background sync (every 5 minutes minimumInterval)
    registerBackgroundSyncTask().catch((err) => {
      console.error('Failed to register background sync task:', err);
    });

    // Foreground auto-sync every 5 minutes (300,000 ms)
    const interval = setInterval(async () => {
      try {
        console.log('[Foreground Auto-Sync] Triggering sync...');
        await triggerForegroundSync();
        loadDashboardData();
      } catch (err) {
        console.warn('[Foreground Auto-Sync] Sync failed:', err);
      }
    }, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, [token]);

  const fetchEnrolledCourses = useCallback(async (moodleToken: string) => {
    try {
      const client = new MoodleClient(moodleToken);
      const info = await client.getSiteInfo();
      const courses = await client.getEnrolledCourses(info.userid);
      setAvailableCourses(courses);
    } catch (e: any) {
      Alert.alert(t('connect_moodle'), e.message || 'Failed to fetch Moodle courses.');
      setOnboardingStep(1);
    }
  }, []);

  const loadAppStatus = useCallback(async () => {
    setLoading(true);
    try {
      const storedToken = await getMoodleToken();
      setToken(storedToken);

      // Pre-fill login form if credentials were saved
      const creds = await getStoredCredentials();
      const rememberMePref = getPreference('remember_me') === 'true';
      if (creds) {
        setInputUsername(creds.username);
        setInputIdNumber(creds.idNumber);
        setInputPassword(creds.password);
        setRememberMe(true);
        setPreference('remember_me', 'true');
      } else {
        setRememberMe(rememberMePref);
      }

      const db = getDb();
      const trackedCourses = db.getAllSync<any>('SELECT * FROM tracked_courses WHERE is_active = 1');

      if (storedToken) {
        // Always try to sync settings on boot to get remote updates
        const hasTracked = await performSettingsSync(storedToken);
        
        if (hasTracked || trackedCourses.length > 0) {
          refreshPreferences();
          setOnboardingStep(3);
          loadDashboardData();
          handleManualSync();
        } else {
          setOnboardingStep(2);
          fetchEnrolledCourses(storedToken);
        }
      } else {
        setOnboardingStep(1);
      }
    } catch (e) {
      console.error('loadAppStatus error:', e);
    } finally {
      setLoading(false);
    }
  }, [fetchEnrolledCourses, refreshPreferences]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadAppStatus();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadAppStatus]);

  async function handleToggleCompleted(assignMoodleId: number) {
    const target = assignments.find((x: any) => x.moodle_assign_id === assignMoodleId);
    const rawMoodleSubmitted = target ? Boolean(target.rawMoodleSubmitted) : false;

    const completedStr = getPreference('completed_assignments');
    let completedList: number[] = completedStr ? JSON.parse(completedStr) : [];

    const uncompletedStr = getPreference('uncompleted_assignments');
    let uncompletedList: number[] = uncompletedStr ? JSON.parse(uncompletedStr) : [];

    if (rawMoodleSubmitted) {
      if (uncompletedList.includes(assignMoodleId)) {
        uncompletedList = uncompletedList.filter((id: number) => id !== assignMoodleId);
      } else {
        uncompletedList.push(assignMoodleId);
      }
      setPreference('uncompleted_assignments', JSON.stringify(uncompletedList));
      markSettingUpdatedAndSync(['uncompletedAssignments']);
    } else {
      if (completedList.includes(assignMoodleId)) {
        completedList = completedList.filter((id: number) => id !== assignMoodleId);
      } else {
        completedList.push(assignMoodleId);
      }
      setPreference('completed_assignments', JSON.stringify(completedList));
      markSettingUpdatedAndSync(['completedAssignments']);
    }

    loadDashboardData();
  }

  async function handleToggleHidden(assignMoodleId: number) {
    const hiddenStr = getPreference('hidden_assignments');
    let current = hiddenStr ? JSON.parse(hiddenStr) : [];
    if (current.includes(assignMoodleId)) {
      current = current.filter((id: number) => id !== assignMoodleId);
    } else {
      current.push(assignMoodleId);
    }
    setPreference('hidden_assignments', JSON.stringify(current));
    markSettingUpdatedAndSync(['hiddenAssignments']);
    loadDashboardData();
  }

  async function handleConnect() {
    if (!inputUsername.trim() || !inputIdNumber.trim() || !inputPassword.trim()) {
      Alert.alert(t('connect_moodle'), isRtl ? 'נא למלא את כל השדות.' : 'Please fill in all fields.');
      return;
    }
    if (!isValidIsraeliId(inputIdNumber)) {
      Alert.alert(
        isRtl ? 'מספר תעודת זהות לא תקין' : 'Invalid ID Number',
        isRtl
          ? 'נא להזין מספר תעודת זהות תקין בן 9 ספרות.'
          : 'Please enter a valid 9-digit Israeli National ID.'
      );
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

      // Save user fullname and remember me preference
      try {
        const client = new MoodleClient(fetchedToken);
        const info = await client.getSiteInfo();
        if (info && info.fullname) {
          setUserFullname(info.fullname);
          setPreference('user_fullname', info.fullname);
        }
      } catch (err) {
        console.warn('Failed to fetch Moodle site info during login:', err);
      }

      if (rememberMe) {
        await saveCredentials(inputUsername.trim(), inputIdNumber.trim(), inputPassword.trim());
        setPreference('remember_me', 'true');
      } else {
        await clearCredentials();
        setPreference('remember_me', 'false');
      }

      const hasTracked = await performSettingsSync(fetchedToken);
      if (hasTracked) {
        refreshPreferences();
        setOnboardingStep(3);
        loadDashboardData();
        handleManualSync();
      } else {
        await fetchEnrolledCourses(fetchedToken);
        setOnboardingStep(2);
      }
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
      markSettingUpdatedAndSync(['trackedCourseIds', 'coursesColorMap', 'coursesCustomNames']);
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

  async function handleDisconnect() {
    setLoading(true);
    try {
      const db = getDb();
      const isRememberMe = getPreference('remember_me') === 'true';

      await setMoodleToken(null);
      setToken(null);

      if (isRememberMe) {
        // Keep credentials, tracked_courses, preferences.
        // Wipe session data.
        db.withTransactionSync(() => {
          db.runSync('DELETE FROM assignments');
          db.runSync('DELETE FROM meetings');
          db.runSync('DELETE FROM files');
        });
      } else {
        // Full destructive wipe
        await clearCredentials();
        await setGoogleAccessToken(null);
        db.withTransactionSync(() => {
          db.runSync('DELETE FROM tracked_courses');
          db.runSync('DELETE FROM assignments');
          db.runSync('DELETE FROM meetings');
          db.runSync('DELETE FROM files');
          db.runSync('DELETE FROM preferences');
        });
      }
      setOnboardingStep(1);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to disconnect.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSidebarDisconnect() {
    Alert.alert(
      isRtl ? 'התנתקות' : 'Disconnect',
      isRtl ? 'האם אתה בטוח שברצונך להתנתק מהחשבון?' : 'Are you sure you want to disconnect?',
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: isRtl ? 'התנתק' : 'Disconnect',
          style: 'destructive',
          onPress: handleDisconnect,
        }
      ]
    );
  }

  function loadDashboardData() {
    try {
      const db = getDb();

      // Load user fullname
      const fullName = getPreference('user_fullname') || '';
      setUserFullname(fullName);

      // Load active tracked courses
      const trackedList = db.getAllSync<any>('SELECT * FROM tracked_courses WHERE is_active = 1');
      setTrackedCourses(trackedList);

      const hiddenStr = getPreference('hidden_assignments');
      const completedStr = getPreference('completed_assignments');
      const uncompletedStr = getPreference('uncompleted_assignments');
      const hiddenIds: number[] = hiddenStr ? JSON.parse(hiddenStr) : [];
      const completedIds: number[] = completedStr ? JSON.parse(completedStr) : [];
      const uncompletedIds: number[] = uncompletedStr ? JSON.parse(uncompletedStr) : [];

      // Load all assignments of active courses
      const cachedAssigns = db.getAllSync<any>(
        `SELECT a.*, c.name AS custom_course_name, c.color AS course_color 
         FROM assignments a 
         JOIN tracked_courses c ON a.course_moodle_id = c.moodle_id 
         WHERE c.is_active = 1
         ORDER BY CASE WHEN a.deadline IS NULL OR a.deadline = '' THEN 1 ELSE 0 END, a.deadline ASC`
      ).map(a => {
        let mod = { ...a };
        const rawMoodleSubmitted = a.status === 'Submitted';
        mod.rawMoodleSubmitted = rawMoodleSubmitted;

        if (hiddenIds.includes(a.moodle_assign_id)) {
          mod.isHidden = true;
        }

        let isCompleted = rawMoodleSubmitted;
        if (rawMoodleSubmitted && uncompletedIds.includes(a.moodle_assign_id)) {
          isCompleted = false;
        } else if (!rawMoodleSubmitted && completedIds.includes(a.moodle_assign_id)) {
          isCompleted = true;
        }

        mod.isCompleted = isCompleted;
        mod.status = isCompleted ? 'Submitted' : (rawMoodleSubmitted ? 'Assigned' : a.status);
        return mod;
      });

      setAssignments(cachedAssigns);

      // Load meetings of active courses only
      const cachedMeetings = db.getAllSync<any>(
        `SELECT m.*, c.name AS custom_course_name, c.color AS course_color 
         FROM meetings m 
         JOIN tracked_courses c ON m.course_moodle_id = c.moodle_id 
         WHERE c.is_active = 1 
         ORDER BY m.id ASC`
      );
      setMeetings(cachedMeetings);

      // Load files of active courses only
      const cachedFiles = db.getAllSync<any>(
        `SELECT f.*, c.name AS custom_course_name, c.color AS course_color 
         FROM files f 
         JOIN tracked_courses c ON f.course_moodle_id = c.moodle_id 
         WHERE c.is_active = 1`
      );
      setDashboardFiles(cachedFiles);

      const computedCompletedCount = cachedAssigns.filter(a => a.status === 'Submitted' && !a.isHidden).length;
      setCompletedCount(computedCompletedCount);

      // Load interested meetings preference
      const interestedStr = getPreference('interested_meetings') || '';
      let interestedList: string[] = [];
      if (interestedStr) {
        try {
          interestedList = JSON.parse(interestedStr);
        } catch (e) {}
      }
      setInterestedMeetings(interestedList);
    } catch (e) {
      console.error('loadDashboardData error:', e);
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

  async function handleDownloadFile(file: any) {
    if (!file?.file_url) {
      Alert.alert(t('download') || (isRtl ? 'הורדה' : 'Download'), isRtl ? 'כתובת קובץ לא תקינה' : 'Invalid file URL');
      return;
    }
    try {
      const res = await downloadMoodleFile(file);
      if (!res.success && res.error) {
        try {
          await Linking.openURL(file.file_url);
        } catch (linkErr) {
          Alert.alert(t('download') || (isRtl ? 'הורדה' : 'Download'), res.error);
        }
      }
    } catch (err: any) {
      try {
        await Linking.openURL(file.file_url);
      } catch (linkErr) {
        Alert.alert(t('download') || (isRtl ? 'הורדה' : 'Download'), err?.message || 'Download failed');
      }
    }
  }

  // ---------------------------------------------------------
  // Onboarding Step 1 View — SSO Login
  // ---------------------------------------------------------
  if (onboardingStep === 1) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <ScrollView contentContainerStyle={styles.onboardingCard} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: isRtl ? 'row' : 'row-reverse', justifyContent: 'space-between', width: '100%', marginBottom: 16 }}>
            <View />
            <Pressable
              onPress={() => {
                const nextLang = isRtl ? 'en' : 'he';
                setLanguage(nextLang);
              }}
              style={{
                paddingVertical: 6,
                paddingHorizontal: 12,
                borderRadius: 20,
                borderWidth: 1,
                borderColor: theme.border,
                backgroundColor: theme.backgroundElement,
              }}
            >
              <Text style={{ color: theme.text, fontSize: 12, fontWeight: 'bold' }}>
                {isRtl ? 'English 🇺🇸' : 'עברית 🇮🇱'}
              </Text>
            </Pressable>
          </View>
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
        <View style={[styles.actionFooter, { flexDirection: isRtl ? 'row-reverse' : 'row', gap: 12 }]}>
          <Pressable style={[styles.primaryBtn, { backgroundColor: theme.primary, flex: 1 }]} onPress={handleSaveCourses}>
            <Text style={styles.primaryBtnText}>
              {t('start_tracking_btn')} ({selectedCourseIds.length})
            </Text>
          </Pressable>
          <Pressable 
            style={[styles.primaryBtn, { backgroundColor: theme.backgroundElement, borderWidth: 1, borderColor: theme.border, flex: 1 }]} 
            onPress={async () => {
              try {
                const res = await DocumentPicker.getDocumentAsync({ type: 'application/json' });
                if (res.canceled || !res.assets || res.assets.length === 0) return;
                const fileUri = res.assets[0].uri;
                
                let content = '';
                if (fileUri.startsWith('content://') || fileUri.startsWith('file://')) {
                  const tempPath = FileSystemLegacy.cacheDirectory + 'temp_import_config.json';
                  await FileSystemLegacy.copyAsync({ from: fileUri, to: tempPath });
                  content = await FileSystemLegacy.readAsStringAsync(tempPath);
                } else {
                  content = await FileSystemLegacy.readAsStringAsync(fileUri);
                }

                const data = JSON.parse(content);
                if (!data.trackedCourseIds) {
                  Alert.alert(t('import_failed') || 'Import Failed', 'Invalid configuration file format.');
                  return;
                }

                // Match external moodle_ids to internal DB ids
                const importedMoodleIds = new Set<number>(data.trackedCourseIds);
                const matchedIds = availableCourses
                  .filter(c => importedMoodleIds.has(c.moodle_id))
                  .map(c => c.id);
                  
                setSelectedCourseIds(matchedIds);
                
                const db = getDb();
                if (data.courseColors) {
                  Object.entries(data.courseColors).forEach(([cidStr, color]) => {
                    db.runSync('UPDATE tracked_courses SET color = ? WHERE moodle_id = ?', [color as any, parseInt(cidStr)]);
                  });
                }
                if (data.courseNicknames) {
                  Object.entries(data.courseNicknames).forEach(([cidStr, nickname]) => {
                    db.runSync('UPDATE tracked_courses SET name = ? WHERE moodle_id = ?', [nickname as any, parseInt(cidStr)]);
                  });
                }
                
                Alert.alert(isRtl ? 'הצלחה' : 'Success', isRtl ? 'התצורה נטענה בהצלחה.' : 'Configuration loaded successfully.');
              } catch (e: any) {
                Alert.alert(t('import_failed') || 'Import Failed', e.message || 'An error occurred during import.');
              }
            }}
          >
            <Text style={[styles.primaryBtnText, { color: theme.text }]}>
              {isRtl ? 'ייבוא תצורה' : 'Import Configuration'}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ---------------------------------------------------------
  // Main Dashboard View (Step 3)
  // ---------------------------------------------------------
  function renderDashboard() {
    // Find the closest future assignment
    const now = new Date();
    const nextAssignment = assignments.find(
      (a) => a.deadline && new Date(a.deadline) > now && a.status !== 'Submitted' && !a.isHidden
    );

    let timeColor: string = theme.danger;
    let nextAssignDeadlineText = '';
    if (nextAssignment && nextAssignment.deadline) {
      const diffMs = new Date(nextAssignment.deadline).getTime() - Date.now();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffMins = Math.floor(diffMs / (1000 * 60));
      
      if (diffDays > 7) {
        timeColor = theme.secondary;
      } else if (diffDays > 3) {
        timeColor = theme.warning;
      }
      
      const diffDaysInt = Math.floor(diffDays);
      if (diffDaysInt >= 1) {
        nextAssignDeadlineText = diffDaysInt === 1 ? t('due_in_day') : t('due_in_days', { days: diffDaysInt });
      } else if (diffHours >= 1) {
        nextAssignDeadlineText = diffHours === 1 ? t('due_in_hour') : t('due_in_hours', { hours: diffHours });
      } else {
        const mins = diffMins > 0 ? diffMins : 1;
        nextAssignDeadlineText = mins === 1 ? t('due_in_minute') : t('due_in_minutes', { minutes: mins });
      }
    }

    const greeting = isRtl ? `שלום, ${userFullname || 'משתמש'}` : `Hello, ${userFullname || 'User'}`;

    const filteredAssignments = assignments.filter((a) => {
      const cName = a.custom_course_name || a.course_name;
      const isSearchMatch = 
        a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        cName.toLowerCase().includes(searchQuery.toLowerCase());
      
      if (!isSearchMatch) return false;

      const isHidden = a.isHidden;
      const isCompleted = a.status === 'Submitted';
      const hasDeadlinePassed = a.deadline ? new Date(a.deadline) < now : false;

      if (isHidden && filterHidden) return true;
      if (!isHidden && isCompleted && filterCompleted) return true;
      
      if (!isHidden && !isCompleted) {
        if (hasDeadlinePassed && filterPast) return true;
        if (!hasDeadlinePassed && filterPending) return true;
      }

      return false;
    }).sort((a, b) => {
      // Overdue at the bottom
      const aHours = a.deadline ? (new Date(a.deadline).getTime() - Date.now()) / (1000 * 60 * 60) : Infinity;
      const bHours = b.deadline ? (new Date(b.deadline).getTime() - Date.now()) / (1000 * 60 * 60) : Infinity;
      const aIsOverdue = aHours < 0;
      const bIsOverdue = bHours < 0;
      if (aIsOverdue && !bIsOverdue) return 1;
      if (!aIsOverdue && bIsOverdue) return -1;
      return 0; // maintain SQL order
    });

    const visibleAssignments = assignments.filter((a) => !a.isHidden);
    const totalTasks = visibleAssignments.length;
    const currentCompletedCount = visibleAssignments.filter((a) => a.status === 'Submitted').length;
    const pendingTasksCount = visibleAssignments.filter((a) => a.status !== 'Submitted').length;
    const progressPercent = totalTasks > 0 ? (currentCompletedCount / totalTasks) * 100 : 0;

    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={[styles.header, { flexDirection: isRtl ? 'row-reverse' : 'row', borderBottomColor: theme.border, borderBottomWidth: 1, alignItems: 'center' }]}>
          <View style={{ flexDirection: isRtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 12 }}>
            {syncing && <Text style={{ color: theme.primary, fontSize: 12, textAlign: isRtl ? 'right' : 'left' }}>{t('syncing')}</Text>}
          </View>
          <View style={{ flexDirection: isRtl ? 'row-reverse' : 'row', gap: 8, marginLeft: isRtl ? 0 : 'auto', marginRight: isRtl ? 'auto' : 0 }}>
            <Pressable style={[styles.syncBtn, { backgroundColor: theme.primary }]} onPress={handleManualSync} disabled={syncing}>
              <Text style={styles.syncBtnText}>{syncing ? t('syncing') : t('sync_now')}</Text>
            </Pressable>
          </View>
        </View>

        {/* Progress Bar */}
        <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
          <View style={{ flexDirection: isRtl ? 'row-reverse' : 'row', justifyContent: 'space-between', marginBottom: 6 }}>
            <Text style={{ color: theme.textSecondary, fontSize: 13, fontWeight: 'bold' }}>
              {isRtl ? 'התקדמות מטלות' : 'Task Progress'}
            </Text>
            <Text style={{ color: theme.textSecondary, fontSize: 13 }}>
              {currentCompletedCount} / {totalTasks} {isRtl ? 'הושלמו' : 'completed'}
            </Text>
          </View>
          <View style={{ height: 8, backgroundColor: theme.border, borderRadius: 4, overflow: 'hidden', flexDirection: isRtl ? 'row-reverse' : 'row' }}>
            <View style={{ width: `${progressPercent}%`, backgroundColor: theme.primary, height: '100%' }} />
          </View>
        </View>

        <ScrollView style={styles.scrollView} contentContainerStyle={{ paddingBottom: 24, paddingTop: 16 }}>
          {/* Quick Stats Widget */}
          <View style={[styles.statsRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
            <View style={[styles.statCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border, borderWidth: 1 }]}>
              <Text style={[styles.statValue, { color: theme.primary }]}>{pendingTasksCount}</Text>
              <Text style={[styles.statLabel, { color: theme.textSecondary }]}>
                {isRtl ? 'מטלות לביצוע' : 'To Do'}
              </Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border, borderWidth: 1 }]}>
              <Text style={[styles.statValue, { color: theme.secondary }]}>{currentCompletedCount}</Text>
              <Text style={[styles.statLabel, { color: theme.textSecondary }]}>
                {isRtl ? 'מטלות שהוגשו' : 'Completed'}
              </Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border, borderWidth: 1 }]}>
              <Text style={[styles.statValue, { color: timeColor, fontSize: 13 }]} numberOfLines={1}>
                {nextAssignDeadlineText || '-'}
              </Text>
              <Text style={[styles.statLabel, { color: theme.textSecondary }]}>
                {isRtl ? 'המועד הקרוב' : 'Impending'}
              </Text>
            </View>
          </View>

          {/* Next Assignment Banner */}
          {nextAssignment && (() => {
            const isNextExpanded = !!expandedAssignments['next_' + nextAssignment.id];
            const nextColor = nextAssignment.course_color || theme.primary;
            const nextCourseName = nextAssignment.custom_course_name || nextAssignment.course_name;
            const isNextDone = nextAssignment.status === 'Submitted';
            let nextAttachments: any[] = [];
            try {
              nextAttachments = typeof nextAssignment.attachments === 'string'
                ? JSON.parse(nextAssignment.attachments)
                : nextAssignment.attachments || [];
            } catch (e) { nextAttachments = []; }

            const nextDeadlineBg = timeColor === theme.danger
              ? 'rgba(239, 68, 68, 0.12)'
              : timeColor === theme.warning
                ? 'rgba(245, 158, 11, 0.12)'
                : 'rgba(34, 197, 94, 0.12)';

            return (
              <View style={{ marginBottom: 14 }}>
                <View
                  style={[
                    styles.unifiedAssignmentCard,
                    {
                      backgroundColor: theme.backgroundElement,
                      borderColor: isNextDone ? theme.secondary : theme.primary,
                      borderWidth: 1.5,
                      opacity: isNextDone ? 0.75 : 1,
                    }
                  ]}
                >
                  <View
                    style={[
                      styles.accentStripe,
                      {
                        [isRtl ? 'right' : 'left']: 0,
                        backgroundColor: isNextDone ? theme.secondary : theme.primary,
                      }
                    ]}
                  />
                  <Pressable
                    style={[
                      styles.cardHeaderRow,
                      {
                        flexDirection: isRtl ? 'row-reverse' : 'row',
                        paddingLeft: isRtl ? 14 : 18,
                        paddingRight: isRtl ? 18 : 14,
                      }
                    ]}
                    onPress={() => {
                      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                      setExpandedAssignments((prev) => ({ ...prev, ['next_' + nextAssignment.id]: !isNextExpanded }));
                    }}
                  >
                    <Pressable
                      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                      onPress={() => handleToggleCompleted(nextAssignment.moodle_assign_id)}
                      style={styles.checkboxArea}
                    >
                      <View
                        style={[
                          styles.checkboxCircle,
                          {
                            borderColor: isNextDone ? theme.secondary : theme.border,
                            backgroundColor: isNextDone ? theme.secondary : 'transparent',
                          }
                        ]}
                      >
                        {isNextDone && <Text style={styles.checkmarkIcon}>✓</Text>}
                      </View>
                    </Pressable>

                    <View style={[styles.cardContent, { alignItems: isRtl ? 'flex-end' : 'flex-start' }]}>
                      <View style={[styles.cardMetaRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                        <View style={[styles.urgencyBadge, { backgroundColor: 'rgba(59, 130, 246, 0.12)' }]}>
                          <Text style={[styles.urgencyBadgeText, { color: theme.primary }]}>
                            {isRtl ? '🚀 הקרובה ביותר' : '🚀 Next Up'}
                          </Text>
                        </View>
                        {nextCourseName ? (
                          <View style={[styles.coursePill, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                            <View style={[styles.courseDot, { backgroundColor: nextColor }]} />
                            <Text style={[styles.coursePillText, { color: theme.textSecondary }]} numberOfLines={1}>
                              {nextCourseName}
                            </Text>
                          </View>
                        ) : null}
                        {nextAssignDeadlineText ? (
                          <View style={[styles.urgencyBadge, { backgroundColor: nextDeadlineBg }]}>
                            <Text style={[styles.urgencyBadgeText, { color: timeColor }]}>
                              {nextAssignDeadlineText}
                            </Text>
                          </View>
                        ) : null}
                      </View>

                      <View style={{ flexDirection: isRtl ? 'row-reverse' : 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                        <Text
                          style={[
                            styles.assignmentTitle,
                            {
                              color: isNextDone ? theme.textSecondary : theme.text,
                              textDecorationLine: isNextDone ? 'line-through' : 'none',
                              textAlign: isRtl ? 'right' : 'left',
                            }
                          ]}
                          numberOfLines={2}
                        >
                          {nextAssignment.name}
                        </Text>
                        {isNextDone && !nextAssignment.rawMoodleSubmitted && (
                          <View style={styles.tagNotSubmitted}>
                            <Text style={styles.tagNotSubmittedText}>
                              {isRtl ? 'לא הוגש' : 'Not submitted'}
                            </Text>
                          </View>
                        )}
                        {!isNextDone && nextAssignment.rawMoodleSubmitted && (
                          <View style={styles.tagSubmitted}>
                            <Text style={styles.tagSubmittedText}>
                              {isRtl ? 'הוגש' : 'Submitted'}
                            </Text>
                          </View>
                        )}
                      </View>
                    </View>

                    <Text style={[styles.chevronText, { color: theme.textSecondary }]}>
                      {isNextExpanded ? '▲' : '▼'}
                    </Text>
                  </Pressable>

                  {isNextExpanded && (
                    <View style={[styles.cardDrawer, { borderTopColor: theme.border }]}>
                      {nextAttachments.length > 0 && (
                        <View style={styles.attachmentsContainer}>
                          <Text style={[styles.drawerSectionLabel, { color: theme.textSecondary, textAlign: isRtl ? 'right' : 'left' }]}>
                            {t('attachments') || (isRtl ? 'קבצים מצורפים' : 'Attachments')}
                          </Text>
                          <View style={[styles.attachmentsWrap, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                            {nextAttachments.map((att: any, idx: number) => {
                              const displayFileName = att.name || att.fileName || att.filename || (isRtl ? 'קובץ מצורף' : 'Attachment');
                              const fileUrl = att.url || att.fileUrl || att.fileurl;
                              const mimeType = att.mimeType || att.mimetype;
                              return (
                                <Pressable
                                  key={`att-next-${idx}`}
                                  style={[styles.attachmentChip, { backgroundColor: theme.background, borderColor: theme.border }]}
                                  onPress={() => fileUrl && handleDownloadFile({ file_name: displayFileName, file_url: fileUrl, mime_type: mimeType })}
                                >
                                  <Text style={{ fontSize: 13 }}>{fileUrl ? '📄' : '🔗'}</Text>
                                  <Text style={[styles.attachmentText, { color: theme.text }]} numberOfLines={1}>
                                    {displayFileName}
                                  </Text>
                                </Pressable>
                              );
                            })}
                          </View>
                          </View>
                        )}

                        {submittedFiles.length > 0 && (
                          <View style={styles.attachmentsContainer}>
                            <Text style={[styles.drawerSectionLabel, { color: theme.textSecondary, textAlign: isRtl ? 'right' : 'left' }]}>
                              {isRtl ? 'קבצים שהוגשו' : 'Submitted Files'}
                            </Text>
                            <View style={[styles.attachmentsWrap, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                              {submittedFiles.map((att: any, idx: number) => {
                                const displayFileName = att.name || att.fileName || att.filename || (isRtl ? 'קובץ מצורף' : 'Attachment');
                                const fileUrl = att.url || att.fileUrl || att.fileurl;
                                const mimeType = att.mimeType || att.mimetype;
                                return (
                                  <Pressable
                                    key={sub-}
                                    style={[styles.attachmentChip, { backgroundColor: '#2e7d32', borderColor: '#2e7d32' }]}
                                    onPress={() => fileUrl && handleDownloadFile({ file_name: displayFileName, file_url: fileUrl, mime_type: mimeType })}
                                  >
                                    <Text style={{ fontSize: 13, color: 'white' }}>{fileUrl ? '📥' : '🔗'}</Text>
                                    <Text style={[styles.attachmentText, { color: 'white' }]} numberOfLines={1}>
                                      {displayFileName}
                                    </Text>
                                  </Pressable>
                                );
                              })}
                            </View>
                          </View>
                        )}

                        <View style={[styles.cardActionBar, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                        {(!isNextDone && !nextAssignment.rawMoodleSubmitted && nextAssignment.link) ? (
                          <Pressable
                            style={[styles.actionPrimaryBtn, { backgroundColor: theme.primary, flex: 1 }]}
                            onPress={() => Linking.openURL(nextAssignment.link)}
                          >
                            <Text style={styles.actionPrimaryBtnText}>
                              {t('submit_assignment') || (isRtl ? 'הגש ↗' : 'Submit ↗')}
                            </Text>
                          </Pressable>
                        ) : null}

                        <Pressable
                          style={[
                            styles.actionMenuBtn,
                            {
                              borderColor: openMenuAssignId === ('next_' + nextAssignment.id) ? theme.primary : theme.border,
                              backgroundColor: openMenuAssignId === ('next_' + nextAssignment.id) ? (theme.primary + '15') : theme.background,
                              flexDirection: isRtl ? 'row-reverse' : 'row',
                            }
                          ]}
                          onPress={() => {
                            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                            setOpenMenuAssignId(openMenuAssignId === ('next_' + nextAssignment.id) ? null : ('next_' + nextAssignment.id));
                          }}
                        >
                          <Text style={{ fontSize: 13, color: openMenuAssignId === ('next_' + nextAssignment.id) ? theme.primary : theme.text }}>⋯</Text>
                          <Text style={[styles.actionMenuBtnText, { color: openMenuAssignId === ('next_' + nextAssignment.id) ? theme.primary : theme.text }]}>
                            {t('more_actions') || (isRtl ? 'אפשרויות' : 'Options')}
                          </Text>
                        </Pressable>
                      </View>

                      {openMenuAssignId === ('next_' + nextAssignment.id) && (
                        <View style={[styles.mobileMenuCard, { backgroundColor: theme.background, borderColor: theme.border }]}>
                          <Pressable
                            style={[styles.mobileMenuItem, { flexDirection: isRtl ? 'row-reverse' : 'row', borderBottomColor: theme.border }]}
                            onPress={() => {
                              handleToggleCompleted(nextAssignment.moodle_assign_id);
                              setOpenMenuAssignId(null);
                            }}
                          >
                            <Text style={{ fontSize: 14 }}>{isNextDone ? '↺' : '✓'}</Text>
                            <Text style={[styles.mobileMenuItemText, { color: theme.text }]}>
                              {isNextDone
                                ? (isRtl ? 'סמן לביצוע' : 'Mark as To Do')
                                : (isRtl ? 'סמן כבוצע' : 'Mark as Done')}
                            </Text>
                          </Pressable>

                          <Pressable
                            style={[styles.mobileMenuItem, { flexDirection: isRtl ? 'row-reverse' : 'row', borderBottomColor: theme.border }]}
                            onPress={() => {
                              setActiveCourseId(nextAssignment.course_moodle_id);
                              setActiveTab('courses');
                              setOpenMenuAssignId(null);
                            }}
                          >
                            <Text style={{ fontSize: 14 }}>📚</Text>
                            <Text style={[styles.mobileMenuItemText, { color: theme.text }]}>
                              {isRtl ? 'עבור לדף הקורס' : 'Go to Course'}
                            </Text>
                          </Pressable>

                          {nextAssignment.link ? (
                            <Pressable
                              style={[styles.mobileMenuItem, { flexDirection: isRtl ? 'row-reverse' : 'row', borderBottomColor: theme.border }]}
                              onPress={() => {
                                Linking.openURL(nextAssignment.link);
                                setOpenMenuAssignId(null);
                              }}
                            >
                              <Text style={{ fontSize: 14 }}>🌐</Text>
                              <Text style={[styles.mobileMenuItemText, { color: theme.text }]}>
                                {isRtl ? 'פתח במודל' : 'Open in Moodle'}
                              </Text>
                            </Pressable>
                          ) : null}

                          <Pressable
                            style={[styles.mobileMenuItem, { flexDirection: isRtl ? 'row-reverse' : 'row', borderBottomColor: 'transparent' }]}
                            onPress={() => {
                              handleToggleHidden(nextAssignment.moodle_assign_id);
                              setOpenMenuAssignId(null);
                            }}
                          >
                            <Text style={{ fontSize: 14 }}>👁️</Text>
                            <Text style={[styles.mobileMenuItemText, { color: theme.text }]}>
                              {nextAssignment.isHidden ? (isRtl ? 'בטל הסתרת מטלה' : 'Unhide Assignment') : (isRtl ? 'הסתר מטלה' : 'Hide Assignment')}
                            </Text>
                          </Pressable>
                        </View>
                      )}
                    </View>
                  )}
                </View>
              </View>
            );
          })()}

          <TextInput
            style={[styles.searchInput, { borderColor: theme.border, color: theme.text, textAlign: isRtl ? 'right' : 'left', marginTop: nextAssignment ? 20 : 8, marginBottom: 8 }]}
            placeholder={isRtl ? 'חפש מטלות או קורסים...' : 'Search assignments or courses...'}
            placeholderTextColor={theme.placeholder}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          
          <View style={{ flexDirection: isRtl ? 'row-reverse' : 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16, justifyContent: 'center' }}>
            <Pressable
              onPress={() => setFilterPending(!filterPending)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
            >
              <View style={[styles.checkbox, { width: 16, height: 16, borderRadius: 4, borderColor: theme.primary, backgroundColor: filterPending ? theme.primary : 'transparent' }]}>
                {filterPending && <Text style={{ color: '#fff', fontSize: 10, textAlign: 'center' }}>✓</Text>}
              </View>
              <Text style={{ color: theme.text, fontSize: 12 }}>{isRtl ? 'לביצוע' : 'To Do'}</Text>
            </Pressable>

            <Pressable
              onPress={() => setFilterPast(!filterPast)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
            >
              <View style={[styles.checkbox, { width: 16, height: 16, borderRadius: 4, borderColor: theme.primary, backgroundColor: filterPast ? theme.primary : 'transparent' }]}>
                {filterPast && <Text style={{ color: '#fff', fontSize: 10, textAlign: 'center' }}>✓</Text>}
              </View>
              <Text style={{ color: theme.text, fontSize: 12 }}>{isRtl ? 'עברו' : 'Past'}</Text>
            </Pressable>

            <Pressable
              onPress={() => setFilterCompleted(!filterCompleted)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
            >
              <View style={[styles.checkbox, { width: 16, height: 16, borderRadius: 4, borderColor: theme.primary, backgroundColor: filterCompleted ? theme.primary : 'transparent' }]}>
                {filterCompleted && <Text style={{ color: '#fff', fontSize: 10, textAlign: 'center' }}>✓</Text>}
              </View>
              <Text style={{ color: theme.text, fontSize: 12 }}>{isRtl ? 'הושלמו' : 'Completed'}</Text>
            </Pressable>

            <Pressable
              onPress={() => setFilterHidden(!filterHidden)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
            >
              <View style={[styles.checkbox, { width: 16, height: 16, borderRadius: 4, borderColor: theme.primary, backgroundColor: filterHidden ? theme.primary : 'transparent' }]}>
                {filterHidden && <Text style={{ color: '#fff', fontSize: 10, textAlign: 'center' }}>✓</Text>}
              </View>
              <Text style={{ color: theme.text, fontSize: 12 }}>{isRtl ? 'מוסתרים' : 'Hidden'}</Text>
            </Pressable>
          </View>

          <Text style={[styles.sectionHeading, { color: theme.text, textAlign: isRtl ? 'right' : 'left' }]}>
            {t('pending_tasks')} ({filteredAssignments.length})
          </Text>

          {filteredAssignments.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: theme.backgroundElement }]}>
              <Text style={{ color: theme.textSecondary, textAlign: 'center' }}>{t('no_pending_tasks')}</Text>
            </View>
          ) : (
            filteredAssignments.map((a) => {
              const cColor = a.course_color || theme.primary;
              const cName = a.custom_course_name || a.course_name;
              const hoursLeft = a.deadline ? (new Date(a.deadline).getTime() - Date.now()) / (1000 * 60 * 60) : null;
              let deadlineText = t('no_deadline');
              let deadlineColor: string = theme.textSecondary;
              
              if (hoursLeft !== null && a.deadline) {
                if (hoursLeft < 0) {
                  deadlineText = t('overdue');
                  deadlineColor = theme.danger;
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

                  if (hoursLeft < 24) {
                    deadlineColor = theme.danger;
                  } else if (hoursLeft < 72) {
                    deadlineColor = theme.warning;
                  }
                }
              }

              const isExpanded = !!expandedAssignments[a.id];
              const isDone = a.status === 'Submitted';
              let attachments: any[] = [];
              try {
                attachments = typeof a.attachments === 'string' ? JSON.parse(a.attachments) : a.attachments || [];
              } catch (e) { attachments = []; }

              const deadlineBg = deadlineColor === theme.danger
                ? 'rgba(239, 68, 68, 0.12)'
                : deadlineColor === theme.warning
                  ? 'rgba(245, 158, 11, 0.12)'
                  : 'rgba(100, 116, 139, 0.1)';

              return (
                <View key={a.id} style={{ marginBottom: 10 }}>
                  <View
                    style={[
                      styles.unifiedAssignmentCard,
                      {
                        backgroundColor: theme.backgroundElement,
                        borderColor: isDone ? (theme.secondary + '40') : theme.border,
                        opacity: isDone ? 0.75 : 1,
                      }
                    ]}
                  >
                    <View
                      style={[
                        styles.accentStripe,
                        {
                          [isRtl ? 'right' : 'left']: 0,
                          backgroundColor: isDone ? theme.secondary : cColor,
                        }
                      ]}
                    />

                    <Pressable
                      style={[
                        styles.cardHeaderRow,
                        {
                          flexDirection: isRtl ? 'row-reverse' : 'row',
                          paddingLeft: isRtl ? 14 : 18,
                          paddingRight: isRtl ? 18 : 14,
                        }
                      ]}
                      onPress={() => {
                        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                        setExpandedAssignments((prev) => ({ ...prev, [a.id]: !isExpanded }));
                      }}
                    >
                      <Pressable
                        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                        onPress={() => handleToggleCompleted(a.moodle_assign_id)}
                        style={styles.checkboxArea}
                      >
                        <View
                          style={[
                            styles.checkboxCircle,
                            {
                              borderColor: isDone ? theme.secondary : theme.border,
                              backgroundColor: isDone ? theme.secondary : 'transparent',
                            }
                          ]}
                        >
                          {isDone && <Text style={styles.checkmarkIcon}>✓</Text>}
                        </View>
                      </Pressable>

                      <View style={[styles.cardContent, { alignItems: isRtl ? 'flex-end' : 'flex-start' }]}>
                        <View style={[styles.cardMetaRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                          {cName ? (
                            <View style={[styles.coursePill, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                              <View style={[styles.courseDot, { backgroundColor: cColor }]} />
                              <Text style={[styles.coursePillText, { color: theme.textSecondary }]} numberOfLines={1}>
                                {cName}
                              </Text>
                            </View>
                          ) : null}

                          {deadlineText ? (
                            <View style={[styles.urgencyBadge, { backgroundColor: deadlineBg }]}>
                              <Text style={[styles.urgencyBadgeText, { color: deadlineColor }]}>
                                {deadlineText}
                              </Text>
                            </View>
                          ) : null}
                        </View>

                        <View style={{ flexDirection: isRtl ? 'row-reverse' : 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 3 }}>
                          <Text
                            style={[
                              styles.assignmentTitle,
                              {
                                color: isDone ? theme.textSecondary : theme.text,
                                textDecorationLine: isDone ? 'line-through' : 'none',
                                textAlign: isRtl ? 'right' : 'left',
                              }
                            ]}
                            numberOfLines={2}
                          >
                            {a.name}
                          </Text>
                          {isDone && !a.rawMoodleSubmitted && (
                            <View style={styles.tagNotSubmitted}>
                              <Text style={styles.tagNotSubmittedText}>
                                {isRtl ? 'לא הוגש' : 'Not submitted'}
                              </Text>
                            </View>
                          )}
                          {!isDone && a.rawMoodleSubmitted && (
                            <View style={styles.tagSubmitted}>
                              <Text style={styles.tagSubmittedText}>
                                {isRtl ? 'הוגש' : 'Submitted'}
                              </Text>
                            </View>
                          )}
                        </View>
                      </View>

                      <Text style={[styles.chevronText, { color: theme.textSecondary }]}>
                        {isExpanded ? '▲' : '▼'}
                      </Text>
                    </Pressable>

                    {isExpanded && (
                      <View style={[styles.cardDrawer, { borderTopColor: theme.border }]}>
                        {attachments.length > 0 && (
                          <View style={styles.attachmentsContainer}>
                            <Text style={[styles.drawerSectionLabel, { color: theme.textSecondary, textAlign: isRtl ? 'right' : 'left' }]}>
                              {t('attachments') || (isRtl ? 'קבצים מצורפים' : 'Attachments')}
                            </Text>
                            <View style={[styles.attachmentsWrap, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                              {attachments.map((att: any, idx: number) => {
                                const displayFileName = att.name || att.fileName || att.filename || (isRtl ? 'קובץ מצורף' : 'Attachment');
                                const fileUrl = att.url || att.fileUrl || att.fileurl;
                                const mimeType = att.mimeType || att.mimetype;
                                return (
                                  <Pressable
                                    key={`att-${idx}`}
                                    style={[styles.attachmentChip, { backgroundColor: theme.background, borderColor: theme.border }]}
                                    onPress={() => fileUrl && handleDownloadFile({ file_name: displayFileName, file_url: fileUrl, mime_type: mimeType })}
                                  >
                                    <Text style={{ fontSize: 13 }}>{fileUrl ? '📄' : '🔗'}</Text>
                                    <Text style={[styles.attachmentText, { color: theme.text }]} numberOfLines={1}>
                                      {displayFileName}
                                    </Text>
                                  </Pressable>
                                );
                              })}
                            </View>
                          </View>
                        )}

                        {submittedFiles.length > 0 && (
                          <View style={styles.attachmentsContainer}>
                            <Text style={[styles.drawerSectionLabel, { color: theme.textSecondary, textAlign: isRtl ? 'right' : 'left' }]}>
                              {isRtl ? 'קבצים שהוגשו' : 'Submitted Files'}
                            </Text>
                            <View style={[styles.attachmentsWrap, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                              {submittedFiles.map((att: any, idx: number) => {
                                const displayFileName = att.name || att.fileName || att.filename || (isRtl ? 'קובץ מצורף' : 'Attachment');
                                const fileUrl = att.url || att.fileUrl || att.fileurl;
                                const mimeType = att.mimeType || att.mimetype;
                                return (
                                  <Pressable
                                    key={sub-}
                                    style={[styles.attachmentChip, { backgroundColor: '#2e7d32', borderColor: '#2e7d32' }]}
                                    onPress={() => fileUrl && handleDownloadFile({ file_name: displayFileName, file_url: fileUrl, mime_type: mimeType })}
                                  >
                                    <Text style={{ fontSize: 13, color: 'white' }}>{fileUrl ? '📥' : '🔗'}</Text>
                                    <Text style={[styles.attachmentText, { color: 'white' }]} numberOfLines={1}>
                                      {displayFileName}
                                    </Text>
                                  </Pressable>
                                );
                              })}
                            </View>
                          </View>
                        )}

                        <View style={[styles.cardActionBar, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                          {(!isDone && !a.rawMoodleSubmitted && a.link) ? (
                            <Pressable
                              style={[styles.actionPrimaryBtn, { backgroundColor: theme.primary, flex: 1 }]}
                              onPress={() => Linking.openURL(a.link)}
                            >
                              <Text style={styles.actionPrimaryBtnText}>
                                {t('submit_assignment') || (isRtl ? 'הגש ↗' : 'Submit ↗')}
                              </Text>
                            </Pressable>
                          ) : null}

                          <Pressable
                            style={[
                              styles.actionMenuBtn,
                              {
                                borderColor: openMenuAssignId === String(a.id) ? theme.primary : theme.border,
                                backgroundColor: openMenuAssignId === String(a.id) ? (theme.primary + '15') : theme.background,
                                flexDirection: isRtl ? 'row-reverse' : 'row',
                              }
                            ]}
                            onPress={() => {
                              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                              setOpenMenuAssignId(openMenuAssignId === String(a.id) ? null : String(a.id));
                            }}
                          >
                            <Text style={{ fontSize: 13, color: openMenuAssignId === String(a.id) ? theme.primary : theme.text }}>⋯</Text>
                            <Text style={[styles.actionMenuBtnText, { color: openMenuAssignId === String(a.id) ? theme.primary : theme.text }]}>
                              {t('more_actions') || (isRtl ? 'אפשרויות' : 'Options')}
                            </Text>
                          </Pressable>
                        </View>

                        {openMenuAssignId === String(a.id) && (
                          <View style={[styles.mobileMenuCard, { backgroundColor: theme.background, borderColor: theme.border }]}>
                            <Pressable
                              style={[styles.mobileMenuItem, { flexDirection: isRtl ? 'row-reverse' : 'row', borderBottomColor: theme.border }]}
                              onPress={() => {
                                handleToggleCompleted(a.moodle_assign_id);
                                setOpenMenuAssignId(null);
                              }}
                            >
                              <Text style={{ fontSize: 14 }}>{isDone ? '↺' : '✓'}</Text>
                              <Text style={[styles.mobileMenuItemText, { color: theme.text }]}>
                                {isDone
                                  ? (isRtl ? 'סמן לביצוע' : 'Mark as To Do')
                                  : (isRtl ? 'סמן כבוצע' : 'Mark as Done')}
                              </Text>
                            </Pressable>

                            <Pressable
                              style={[styles.mobileMenuItem, { flexDirection: isRtl ? 'row-reverse' : 'row', borderBottomColor: theme.border }]}
                              onPress={() => {
                                setActiveCourseId(a.course_moodle_id);
                                setActiveTab('courses');
                                setOpenMenuAssignId(null);
                              }}
                            >
                              <Text style={{ fontSize: 14 }}>📚</Text>
                              <Text style={[styles.mobileMenuItemText, { color: theme.text }]}>
                                {isRtl ? 'עבור לדף הקורס' : 'Go to Course'}
                              </Text>
                            </Pressable>

                            {a.link ? (
                              <Pressable
                                style={[styles.mobileMenuItem, { flexDirection: isRtl ? 'row-reverse' : 'row', borderBottomColor: theme.border }]}
                                onPress={() => {
                                  openMoodleLink(a.link);
                                  setOpenMenuAssignId(null);
                                }}
                              >
                                <Text style={{ fontSize: 14 }}>🌐</Text>
                                <Text style={[styles.mobileMenuItemText, { color: theme.text }]}>
                                  {isRtl ? 'פתח במודל' : 'Open in Moodle'}
                                </Text>
                              </Pressable>
                            ) : null}

                            <Pressable
                              style={[styles.mobileMenuItem, { flexDirection: isRtl ? 'row-reverse' : 'row', borderBottomColor: 'transparent' }]}
                              onPress={() => {
                                handleToggleHidden(a.moodle_assign_id);
                                setOpenMenuAssignId(null);
                              }}
                            >
                              <Text style={{ fontSize: 14 }}>👁️</Text>
                              <Text style={[styles.mobileMenuItemText, { color: theme.text }]}>
                                {a.isHidden ? (isRtl ? 'בטל הסתרת מטלה' : 'Unhide Assignment') : (isRtl ? 'הסתר מטלה' : 'Hide Assignment')}
                              </Text>
                            </Pressable>
                          </View>
                        )}
                      </View>
                    )}
                  </View>
                </View>
              );
            })
          )}

          {/* Zoom Section */}
          <Text style={[styles.sectionHeading, { color: theme.text, marginTop: 24, textAlign: isRtl ? 'right' : 'left' }]}>
            {isRtl ? 'זום' : 'Zoom'}
          </Text>

          {(() => {
            const activeMeeting = meetings.find(m => {
              if (!m.start_time) return false;
              const startTime = new Date(m.start_time);
              if (isNaN(startTime.getTime())) return false;
              const now = new Date();
              const endTime = new Date(startTime.getTime() + 2 * 60 * 60 * 1000);
              return now >= startTime && now <= endTime;
            });
            if (!activeMeeting) return null;
            
            // Get course color for the active meeting
            const targetCourse = trackedCourses.find(c => c.moodle_id === activeMeeting.course_moodle_id);
            const courseColor = targetCourse?.color || theme.primary;
            const courseName = targetCourse?.name || activeMeeting.course_name || `Course ${activeMeeting.course_moodle_id}`;
            
            return (
              <View style={{ marginBottom: 12, flexDirection: isRtl ? 'row-reverse' : 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                <Text style={{ color: theme.textSecondary, fontSize: 14, fontWeight: 'bold' }}>
                  {isRtl ? 'זום נוכחי:' : 'Current Zoom:'}
                </Text>
                <Pressable onPress={() => activeMeeting.meeting_url && Linking.openURL(activeMeeting.meeting_url)}>
                  <Text style={{ color: courseColor, fontSize: 14, fontWeight: 'bold', textDecorationLine: 'underline' }}>
                    {courseName} - {activeMeeting.title || 'Zoom'}
                  </Text>
                </Pressable>
              </View>
            );
          })()}

          {(() => {
            const coursesWithMeetings = trackedCourses.map((c) => {
              const courseMeetings = meetings.filter((m) => m.course_moodle_id === c.moodle_id);
              
              // Deduplicate recurring meetings by meeting_number or meeting_url
              const now = new Date();
              const groups = new Map<string, typeof meetings>();
              courseMeetings.forEach(m => {
                const key = m.meeting_number || m.meeting_url;
                if (!key) return;
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key)!.push(m);
              });

              const dedupedMeetings: typeof meetings = [];
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

              return {
                courseId: c.moodle_id,
                courseName: c.name || `Course ${c.moodle_id}`,
                color: c.color || theme.primary,
                meetings: dedupedMeetings,
              };
            });

            if (coursesWithMeetings.length === 0) {
              return (
                <View style={[styles.emptyCard, { backgroundColor: theme.backgroundElement }]}>
                  <Text style={{ color: theme.textSecondary, textAlign: 'center' }}>
                    {isRtl ? 'לא נמצאו קישורי זום בקורסים.' : 'No Zoom links found in courses.'}
                  </Text>
                </View>
              );
            }

            const isMarked = (m: any) => {
              const keyId = m.meeting_number || m.meeting_url;
              return interestedMeetings.includes(keyId);
            };

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

            return coursesWithMeetings.map((c) => {
              const isExpanded = expandedCourseId === c.courseId;
              const markedMeetings = c.meetings.filter(isMarked);

              return (
                <View key={c.courseId} style={{ marginBottom: 12, backgroundColor: theme.backgroundElement, borderRadius: 12, borderWidth: 1, borderColor: theme.border, overflow: 'hidden' }}>
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
                      setExpandedCourseId(prev => prev === c.courseId ? null : c.courseId);
                    }}
                  >
                    <View style={{ flex: 1, alignItems: isRtl ? 'flex-end' : 'flex-start', gap: 4 }}>
                      <Text style={{ color: c.color, fontWeight: 'bold', fontSize: 16, textAlign: isRtl ? 'right' : 'left' }}>
                        📖 {c.courseName}
                      </Text>

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
                                  textDecorationColor: c.color,
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
                      {isExpanded ? '▲' : '▼'}
                    </Text>
                  </Pressable>

                  {isExpanded && (
                    <View style={{ paddingHorizontal: 16, paddingBottom: 16, borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 12 }}>
                      {(() => {
                        if (c.meetings.length === 0) {
                          return (
                            <View style={{ paddingVertical: 12, alignItems: 'center' }}>
                              <Text style={{ color: theme.textSecondary, fontSize: 13 }}>
                                {isRtl ? 'לא נמצאו פגישות זום עבור קורס זה.' : 'No Zoom meetings found for this course.'}
                              </Text>
                            </View>
                          );
                        }

                        const sortedMeetings = [...c.meetings].sort((a, b) => {
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
            });
          })()}
        </ScrollView>
      </View>
    );
  }

  const navItems = [
    { key: 'dashboard', label: t('dashboard'), source: require('../../assets/logos/dashboard.svg') },
    { key: 'courses', label: t('courses'), source: require('../../assets/logos/courses.svg') },
    { key: 'files', label: t('files'), source: require('../../assets/logos/files.svg') },
    { key: 'grades', label: t('grades'), source: require('../../assets/logos/grades.svg') },
    { key: 'settings', label: t('settings'), source: require('../../assets/logos/settings.svg') },
  ];

  const renderActiveScreen = () => {
    switch (activeTab) {
      case 'dashboard':
        return renderDashboard();
      case 'courses':
        return <CoursesScreen activeCourseId={activeCourseId} setActiveCourseId={setActiveCourseId} />;
      case 'files':
        return <FilesScreen />;
      case 'grades':
        return <GradesScreen />;
      case 'settings':
        return <SettingsScreen onDisconnect={() => {
          setToken(null);
          setOnboardingStep(1);
          loadAppStatus();
        }} onSettingsChanged={() => {
          refreshPreferences();
          loadDashboardData();
        }} />;
      default:
        return renderDashboard();
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background, flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
      {/* Collapsible Sidebar Stripe */}
      <View style={[
        styles.sidebar, 
        { 
          backgroundColor: theme.backgroundElement, 
          width: sidebarExpanded ? 160 : 60,
          borderRightWidth: isRtl ? 0 : 1,
          borderLeftWidth: isRtl ? 1 : 0,
          borderColor: theme.border,
        }
      ]}>
        {/* Toggle Button */}
        <Pressable 
          style={styles.sidebarToggle} 
          onPress={() => {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setSidebarExpanded(!sidebarExpanded);
          }}
        >
          <Text style={{ color: theme.text, fontSize: 22, fontWeight: 'bold' }}>
            {sidebarExpanded ? (isRtl ? '→' : '←') : '☰'}
          </Text>
        </Pressable>

        {/* Scrollable Sidebar Content */}
        <ScrollView
          style={{ flex: 1, width: '100%' }}
          contentContainerStyle={{ alignItems: 'center', paddingBottom: 16 }}
          showsVerticalScrollIndicator={false}
          bounces={true}
          overScrollMode="never"
        >
          {/* Sidebar Logo & App Name */}
          <View style={{ paddingVertical: 12, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: theme.border, marginBottom: 12, width: '100%' }}>
            <Image
              source={require('../../assets/logo.png')}
              style={{
                width: sidebarExpanded ? 72 : 32,
                height: sidebarExpanded ? 72 : 32,
                borderRadius: 8,
              }}
              resizeMode="contain"
            />
            {sidebarExpanded && (
              <Text
                style={{
                  color: theme.primary,
                  fontSize: 16,
                  fontWeight: 'bold',
                  marginTop: 6,
                  letterSpacing: 0.5,
                }}
              >
                Noodle
              </Text>
            )}
          </View>

          {/* Navigation Items */}
          <View style={styles.sidebarNav}>
            {navItems.map((item) => {
              const isActive = activeTab === item.key;
              return (
                <Pressable
                  key={item.key}
                  style={[
                    styles.sidebarNavItem,
                    { flexDirection: isRtl ? 'row-reverse' : 'row' },
                    isActive && { backgroundColor: theme.backgroundSelected }
                  ]}
                  onPress={() => {
                    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                    setExpandedAssignments({});
                    setActiveCourseId(null);
                    setActiveTab(item.key);
                  }}
                >
                  <ExpoImage
                    source={item.source}
                    style={{ width: 24, height: 24, opacity: isActive ? 1 : 0.6 }}
                    contentFit="contain"
                  />
                  {sidebarExpanded && (
                    <Text style={[
                      styles.sidebarNavLabel, 
                      { color: isActive ? theme.primary : theme.textSecondary, textAlign: isRtl ? 'right' : 'left' }
                    ]}>
                      {item.label}
                    </Text>
                  )}
                </Pressable>
              );
            })}
          </View>

          {/* Footer with Disconnect Button - Only shown when vertical menu is expanded */}
          {sidebarExpanded && (
            <View style={[styles.sidebarFooter, { marginTop: 16 }]}>
              <Pressable
                style={styles.disconnectBtn}
                onPress={handleSidebarDisconnect}
              >
                <Text style={styles.disconnectBtnText}>{isRtl ? 'התנתק' : 'Disconnect'}</Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
      </View>

      {/* Screen Content Wrapper */}
      <View style={{ flex: 1 }}>
        {renderActiveScreen()}
        
        {sidebarExpanded && (
          <Pressable 
            style={[StyleSheet.absoluteFill, { backgroundColor: 'transparent', zIndex: 999 }]} 
            onPress={() => {
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              setSidebarExpanded(false);
            }} 
          />
        )}
      </View>
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
  sidebar: {
    flexShrink: 0,
    paddingTop: 50,
    paddingBottom: 16,
    alignItems: 'center',
  },
  sidebarToggle: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  sidebarNav: {
    width: '100%',
    gap: 4,
    paddingHorizontal: 4,
  },
  sidebarNavItem: {
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
    gap: 8,
  },
  sidebarNavLabel: {
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  sidebarFooter: {
    width: '100%',
    paddingHorizontal: 4,
    paddingBottom: 4,
  },
  disconnectBtn: {
    width: '100%',
    backgroundColor: 'rgba(239,68,68,0.08)',
    borderWidth: 1,
    borderColor: '#ef4444',
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disconnectBtnText: {
    color: '#ef4444',
    fontWeight: 'bold',
    fontSize: 12,
  },
  nextAssignmentBanner: {
    flexDirection: 'row',
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    marginTop: 16,
    marginBottom: 4,
    gap: 12,
    alignItems: 'center',
  },
  nextAssignLabel: {
    fontSize: 11,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  nextAssignTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  nextAssignCourse: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  nextAssignTime: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  searchInput: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    fontSize: 14,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 12,
  },
  statCard: {
    flex: 1,
    padding: 10,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 70,
  },
  statValue: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 2,
    textAlign: 'center',
  },
  statLabel: {
    fontSize: 10,
    textAlign: 'center',
  },
  unifiedAssignmentCard: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  accentStripe: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 4,
    zIndex: 2,
  },
  cardHeaderRow: {
    alignItems: 'center',
    paddingVertical: 14,
    gap: 12,
  },
  checkboxArea: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 2,
  },
  checkboxCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkmarkIcon: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 'bold',
    marginTop: -2,
  },
  cardContent: {
    flex: 1,
    justifyContent: 'center',
  },
  cardMetaRow: {
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  coursePill: {
    alignItems: 'center',
    gap: 5,
    maxWidth: '65%',
  },
  courseDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  coursePillText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  urgencyBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 6,
  },
  urgencyBadgeText: {
    fontSize: 10.5,
    fontWeight: '700',
  },
  assignmentTitle: {
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
  },
  chevronText: {
    fontSize: 11,
    paddingHorizontal: 4,
  },
  cardDrawer: {
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  drawerSectionLabel: {
    fontSize: 11.5,
    fontWeight: '600',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  attachmentsContainer: {
    gap: 4,
  },
  attachmentsWrap: {
    flexWrap: 'wrap',
    gap: 8,
  },
  attachmentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    maxWidth: '100%',
  },
  attachmentText: {
    fontSize: 12,
    fontWeight: '500',
    flexShrink: 1,
  },
  cardActionBar: {
    alignItems: 'center',
    gap: 8,
  },
  actionPrimaryBtn: {
    flex: 3,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionPrimaryBtnText: {
    color: '#ffffff',
    fontSize: 12.5,
    fontWeight: '700',
  },
  actionSecondaryBtn: {
    flex: 2,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionSecondaryBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  actionIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionMenuBtn: {
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  actionMenuBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  mobileMenuCard: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    marginTop: 8,
  },
  mobileMenuItem: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: 0.5,
  },
  mobileMenuItemText: {
    fontSize: 13,
    fontWeight: '600',
  },
  tagNotSubmitted: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderColor: 'rgba(245, 158, 11, 0.35)',
    borderWidth: 1,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 6,
  },
  tagNotSubmittedText: {
    color: '#f59e0b',
    fontSize: 11,
    fontWeight: '600',
  },
  tagSubmitted: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderColor: 'rgba(16, 185, 129, 0.35)',
    borderWidth: 1,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 6,
  },
  tagSubmittedText: {
    color: '#10b981',
    fontSize: 11,
    fontWeight: '600',
  },
});
