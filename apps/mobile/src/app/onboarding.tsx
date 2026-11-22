import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Href, useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import {
  TauSemester,
  UnifiedCourse,
  cleanCourseDisplayName,
} from '@tautracker/moodle-client';
import { COURSE_COLOR_PALETTE, getReadableTextColor } from '@/constants/theme';
import { useAppState } from '@/hooks/use-app-state';
import { usePreferences } from '@/hooks/use-preferences';
import { isValidIsraeliId } from '@/services/auth';
import {
  getLocalSettingsSnapshot,
  importConfigBackupJson,
} from '@/services/settingsSyncService';
import { ColorPalettePickerModal } from '@/components/ColorPalettePickerModal';
import { SsoWebViewModal } from '@/components/SsoWebViewModal';
import { RtlHorizontalScrollView } from '@/components/RtlHorizontalScrollView';
import { NoodleGradientButton } from '@/components/ui/NoodleAnimations';
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  DownloadIcon,
  EyeIcon,
  EyeOffIcon,
  FlaskIcon,
  InfoIcon,
  LinkIcon,
  PaletteIcon,
  PlusIcon,
  RefreshIcon,
  ShieldIcon,
} from '@/components/icons/NoodleIcons';

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

async function readPickedJsonText(asset: DocumentPicker.DocumentPickerAsset): Promise<string> {
  if (Platform.OS === 'web') {
    if (asset.file && typeof asset.file.text === 'function') {
      return await asset.file.text();
    }
    const resp = await fetch(asset.uri);
    return await resp.text();
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('expo-file-system');
    if (fs?.File) {
      const f = new fs.File(asset.uri);
      if (typeof f.text === 'function') {
        return await f.text();
      }
    }
  } catch {
    // Fallback to legacy FileSystem API
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fsLegacy = require('expo-file-system/legacy');
    if (fsLegacy?.readAsStringAsync) {
      return await fsLegacy.readAsStringAsync(asset.uri);
    }
  } catch {
    // Fallback to fetch(uri)
  }

  const resp = await fetch(asset.uri);
  return await resp.text();
}

export default function OnboardingScreen() {
  const router = useRouter();
  const { theme, language, isRtl, setLanguage, t } = usePreferences();
  const {
    isAuthenticated,
    hasCompletedOnboarding,
    enrolledCourses,
    groupedCourses,
    trackedCourseIds,
    coursesCustomNames,
    coursesColorMap,
    loginWithSso,
    loginWithToken,
    fetchOnboardingCourses,
    completeOnboarding,
    refreshFromLocal,
  } = useAppState();

  const step: 1 | 2 = isAuthenticated && !hasCompletedOnboarding ? 2 : 1;

  // Step 1 state
  const [username, setUsername] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [showManualToken, setShowManualToken] = useState(false);
  const [manualToken, setManualToken] = useState('');
  const [ssoModalVisible, setSsoModalVisible] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Step 2 state
  const [selectedIds, setSelectedIds] = useState<number[]>(trackedCourseIds);
  const [nicknames, setNicknames] = useState<Record<number, string>>(coursesCustomNames);
  const [colors, setColors] = useState<Record<number, string>>(coursesColorMap);
  const [expandedColorCourseId, setExpandedColorCourseId] = useState<number | null>(null);
  const [paletteTarget, setPaletteTarget] = useState<{
    courseId: number;
    courseName: string;
    color: string;
  } | null>(null);
  const [hideLabCourseIds, setHideLabCourseIds] = useState<number[]>([]);
  const [labPromptCourse, setLabPromptCourse] = useState<{
    courseId: number;
    title: string;
  } | null>(null);
  const [coursesLoading, setCoursesLoading] = useState(false);
  const [coursesError, setCoursesError] = useState<string | null>(null);
  const [importFeedback, setImportFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [completing, setCompleting] = useState(false);

  const fetchedOnStep2Ref = useRef(false);

  useEffect(() => {
    if (isAuthenticated && hasCompletedOnboarding) {
      router.replace('/(tabs)' as Href);
    }
  }, [isAuthenticated, hasCompletedOnboarding, router]);

  useEffect(() => {
    if (step !== 2) return;
    if (enrolledCourses.length === 0 && !fetchedOnStep2Ref.current) {
      fetchedOnStep2Ref.current = true;
      let cancelled = false;
      Promise.resolve()
        .then(() => {
          if (!cancelled) setCoursesLoading(true);
          if (!cancelled) setCoursesError(null);
          return fetchOnboardingCourses();
        })
        .catch((err: any) => {
          if (!cancelled) {
            setCoursesError(
              err?.message ||
                (language === 'he' ? 'טעינת הקורסים נכשלה' : 'Failed to load courses')
            );
          }
        })
        .finally(() => {
          if (!cancelled) setCoursesLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }
  }, [step, enrolledCourses.length, fetchOnboardingCourses, language]);

  const semesterGroups = useMemo(
    () => groupUnifiedAcademicCourses(groupedCourses.academicCourses, language),
    [groupedCourses.academicCourses, language]
  );
  const adminUmbrella = groupedCourses.administrativeUmbrella;

  const rowDir = isRtl ? 'row-reverse' : 'row';
  const textAlign = isRtl ? 'right' : 'left';

  const getCourseColor = (courseId: number, fallbackIdx: number = 0): string => {
    return (
      colors[courseId] ||
      COURSE_COLOR_PALETTE[fallbackIdx % COURSE_COLOR_PALETTE.length] ||
      theme.primary
    );
  };

  const handleLoginSubmit = async () => {
    setLoginError(null);

    if (!username.trim() || !password.trim()) {
      setLoginError(
        language === 'he'
          ? 'יש למלא שם משתמש, תעודת זהות וסיסמה.'
          : 'Please fill in username, ID number, and password.'
      );
      return;
    }

    if (!isValidIsraeliId(idNumber)) {
      setLoginError(t('invalid_id_error'));
      return;
    }

    setLoginLoading(true);
    try {
      await loginWithSso(username, idNumber, password, rememberMe);
    } catch (err: any) {
      setLoginError(
        err?.message ||
          (language === 'he'
            ? 'ההתחברות נכשלה. בדוק את הפרטים ונסה שוב.'
            : 'Login failed. Please check your credentials and try again.')
      );
    } finally {
      setLoginLoading(false);
    }
  };

  const handleTokenLogin = async (tokenValue: string) => {
    setLoginError(null);
    const trimmed = tokenValue.trim();
    if (!trimmed) {
      setLoginError(
        language === 'he' ? 'יש להזין אסימון תקין.' : 'Please enter a valid token.'
      );
      return;
    }

    setLoginLoading(true);
    try {
      await loginWithToken(trimmed);
    } catch (err: any) {
      setLoginError(
        err?.message ||
          (language === 'he'
            ? 'אימות האסימון נכשל.'
            : 'Token authentication failed.')
      );
    } finally {
      setLoginLoading(false);
    }
  };

  const handleRefreshCourses = async () => {
    setCoursesError(null);
    setCoursesLoading(true);
    try {
      await fetchOnboardingCourses();
    } catch (err: any) {
      setCoursesError(
        err?.message ||
          (language === 'he' ? 'טעינת הקורסים נכשלה' : 'Failed to fetch courses')
      );
    } finally {
      setCoursesLoading(false);
    }
  };

  const handleToggleCourse = (
    courseId: number,
    courseTitle: string,
    courseShortname?: string
  ) => {
    const isSelected = selectedIds.includes(courseId);
    if (isSelected) {
      setSelectedIds((prev) => prev.filter((id) => id !== courseId));
      setHideLabCourseIds((prev) => prev.filter((id) => id !== courseId));
      return;
    }

    setSelectedIds((prev) => {
      const next = [...prev, courseId];
      if (!colors[courseId]) {
        const assignedColor =
          COURSE_COLOR_PALETTE[prev.length % COURSE_COLOR_PALETTE.length] ||
          theme.primary;
        setColors((cPrev) => ({ ...cPrev, [courseId]: assignedColor }));
      }
      return next;
    });

    if (isLabCourseName(courseTitle, courseShortname)) {
      setLabPromptCourse({ courseId, title: courseTitle });
    }
  };

  const handleToggleUmbrellaAll = () => {
    if (!adminUmbrella) return;
    const subIds = adminUmbrella.subCourses.map((s) => s.courseId);
    const allSelected =
      selectedIds.includes(adminUmbrella.id) ||
      (subIds.length > 0 && subIds.every((id) => selectedIds.includes(id)));

    if (allSelected) {
      const removeSet = new Set([adminUmbrella.id, ...subIds]);
      setSelectedIds((prev) => prev.filter((id) => !removeSet.has(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...subIds])));
    }
  };

  const handleImportConfig = async () => {
    setImportFeedback(null);
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['application/json', 'text/plain', '*/*'],
        copyToCacheDirectory: true,
      });

      if (picked.canceled || !picked.assets?.[0]) {
        return;
      }

      const jsonText = await readPickedJsonText(picked.assets[0]);
      const result = await importConfigBackupJson(jsonText, enrolledCourses);
      const snapshot = getLocalSettingsSnapshot();

      setSelectedIds(result.matchedCourseIds);
      setColors(snapshot.coursesColorMap);
      setNicknames(snapshot.coursesCustomNames);
      await refreshFromLocal();

      setImportFeedback({
        type: 'success',
        message: `${t('import_success')} (${result.matchedCourseIds.length})`,
      });
    } catch (err: any) {
      setImportFeedback({
        type: 'error',
        message: `${t('import_failed')}: ${err?.message || String(err)}`,
      });
    }
  };

  const handleCompleteOnboarding = async () => {
    if (selectedIds.length === 0) return;
    setCompleting(true);
    setCoursesError(null);
    try {
      await completeOnboarding(
        selectedIds,
        nicknames,
        colors,
        hideLabCourseIds.length > 0 ? hideLabCourseIds : undefined
      );
      router.replace('/(tabs)' as Href);
    } catch (err: any) {
      setCoursesError(
        err?.message ||
          (language === 'he' ? 'השלמת ההגדרה נכשלה' : 'Failed to complete setup')
      );
    } finally {
      setCompleting(false);
    }
  };

  const renderColorPicker = (
    courseId: number,
    currentColor: string,
    courseName?: string
  ) => {
    const isSelected = selectedIds.includes(courseId);
    const isExpanded = expandedColorCourseId === courseId || isSelected;
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
          const active = currentColor.toLowerCase() === hex.toLowerCase();
          return (
            <TouchableOpacity
              key={hex}
              onPress={() => setColors((prev) => ({ ...prev, [courseId]: hex }))}
              style={[
                styles.swatchCircle,
                {
                  backgroundColor: hex,
                  borderColor: active ? theme.text : 'transparent',
                  borderWidth: active ? 2.5 : 0,
                },
              ]}
              accessibilityLabel={`${t('course_color')} ${hex}`}
            >
              {active && (
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
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView
        style={styles.flexOne}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scrollCenter}
          keyboardShouldPersistTaps="handled"
        >
          {/* Language Bar */}
          <View
            style={[
              styles.topBar,
              {
                maxWidth: step === 1 ? 520 : 840,
                flexDirection: rowDir,
              },
            ]}
          >
            <View
              style={[
                styles.langToggleGroup,
                {
                  backgroundColor: theme.backgroundElement,
                  borderColor: theme.border,
                  flexDirection: rowDir,
                },
              ]}
            >
              <TouchableOpacity
                onPress={() => setLanguage('he')}
                style={[
                  styles.langBtn,
                  language === 'he' && { backgroundColor: theme.primary },
                ]}
              >
                <Text
                  style={[
                    styles.langBtnText,
                    { color: language === 'he' ? theme.onPrimary : theme.textSecondary },
                  ]}
                >
                  עברית
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setLanguage('en')}
                style={[
                  styles.langBtn,
                  language === 'en' && { backgroundColor: theme.primary },
                ]}
              >
                <Text
                  style={[
                    styles.langBtnText,
                    { color: language === 'en' ? theme.onPrimary : theme.textSecondary },
                  ]}
                >
                  English
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {step === 1 ? (
            <View
              style={[
                styles.card,
                styles.loginCard,
                {
                  backgroundColor: theme.backgroundElement,
                  borderColor: theme.border,
                },
              ]}
            >
              <View style={styles.brandBlock}>
                <Image
                  source={require('@/assets/logo.png')}
                  style={styles.logoImg}
                  resizeMode="contain"
                />
                <Text style={[styles.brandName, { color: theme.text }]}>Noodle</Text>
                <Text style={[styles.cardTitle, { color: theme.text }]}>
                  {t('connect_moodle')}
                </Text>
                <Text style={[styles.cardSubtitle, { color: theme.textSecondary }]}>
                  {t('moodle_token_desc')}
                </Text>
              </View>

              {loginError && (
                <View
                  style={[
                    styles.alertBox,
                    {
                      backgroundColor: `${theme.danger}18`,
                      borderColor: theme.danger,
                      flexDirection: rowDir,
                    },
                  ]}
                >
                  <InfoIcon size={16} color={theme.danger} />
                  <Text style={[styles.alertText, { color: theme.danger, textAlign }]}>
                    {loginError}
                  </Text>
                </View>
              )}

              <View style={styles.formFields}>
                <View style={styles.fieldGroup}>
                  <Text style={[styles.fieldLabel, { color: theme.text, textAlign }]}>
                    {t('username_label')}
                  </Text>
                  <TextInput
                    value={username}
                    onChangeText={setUsername}
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder={t('username_label')}
                    placeholderTextColor={theme.placeholder}
                    style={[
                      styles.input,
                      {
                        backgroundColor: theme.background,
                        borderColor: theme.border,
                        color: theme.text,
                        textAlign: 'left',
                      },
                    ]}
                  />
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={[styles.fieldLabel, { color: theme.text, textAlign }]}>
                    {t('id_number_label')}
                  </Text>
                  <TextInput
                    value={idNumber}
                    onChangeText={setIdNumber}
                    keyboardType="number-pad"
                    maxLength={9}
                    placeholder="123456782"
                    placeholderTextColor={theme.placeholder}
                    style={[
                      styles.input,
                      {
                        backgroundColor: theme.background,
                        borderColor: theme.border,
                        color: theme.text,
                        textAlign: 'left',
                      },
                    ]}
                  />
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={[styles.fieldLabel, { color: theme.text, textAlign }]}>
                    {t('password_label')}
                  </Text>
                  <View
                    style={[
                      styles.passwordWrap,
                      {
                        backgroundColor: theme.background,
                        borderColor: theme.border,
                        flexDirection: rowDir,
                      },
                    ]}
                  >
                    <TextInput
                      value={password}
                      onChangeText={setPassword}
                      secureTextEntry={!showPassword}
                      autoCapitalize="none"
                      autoCorrect={false}
                      placeholder={t('password_label')}
                      placeholderTextColor={theme.placeholder}
                      style={[
                        styles.passwordInput,
                        { color: theme.text, textAlign: 'left' },
                      ]}
                    />
                    <TouchableOpacity
                      onPress={() => setShowPassword((p) => !p)}
                      style={styles.eyeBtn}
                      accessibilityLabel={
                        showPassword
                          ? language === 'he'
                            ? 'הסתר סיסמה'
                            : 'Hide password'
                          : language === 'he'
                            ? 'הצג סיסמה'
                            : 'Show password'
                      }
                    >
                      {showPassword ? (
                        <EyeOffIcon size={18} color={theme.textSecondary} />
                      ) : (
                        <EyeIcon size={18} color={theme.textSecondary} />
                      )}
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={[styles.rememberRow, { flexDirection: rowDir }]}>
                  <Switch
                    value={rememberMe}
                    onValueChange={setRememberMe}
                    trackColor={{ false: theme.border, true: theme.primary }}
                    thumbColor="#ffffff"
                  />
                  <Text style={[styles.rememberLabel, { color: theme.text }]}>
                    {t('remember_me')}
                  </Text>
                </View>

                <NoodleGradientButton
                  label={loginLoading ? t('syncing') : t('sso_login_btn')}
                  onPress={handleLoginSubmit}
                  disabled={loginLoading}
                  isRtl={isRtl}
                  size="md"
                  fullWidth
                  icon={
                    loginLoading ? (
                      <ActivityIndicator size="small" color="#ffffff" />
                    ) : undefined
                  }
                />

                <TouchableOpacity
                  onPress={() => setSsoModalVisible(true)}
                  disabled={loginLoading}
                  style={[
                    styles.secondaryBtn,
                    {
                      backgroundColor: theme.backgroundSelected,
                      borderColor: theme.border,
                      flexDirection: rowDir,
                    },
                  ]}
                >
                  <ShieldIcon size={16} color={theme.primary} />
                  <Text style={[styles.secondaryBtnText, { color: theme.text }]}>
                    {t('webview_sso_btn')}
                  </Text>
                </TouchableOpacity>

                {/* Expandable Manual Token Entry */}
                <TouchableOpacity
                  onPress={() => setShowManualToken((prev) => !prev)}
                  style={[styles.manualToggleBtn, { flexDirection: rowDir }]}
                >
                  <LinkIcon size={14} color={theme.textSecondary} />
                  <Text style={[styles.manualToggleText, { color: theme.textSecondary }]}>
                    {t('paste_token_option')}
                  </Text>
                  {showManualToken ? (
                    <ChevronUpIcon size={15} color={theme.textSecondary} />
                  ) : (
                    <ChevronDownIcon size={15} color={theme.textSecondary} />
                  )}
                </TouchableOpacity>

                {showManualToken && (
                  <View
                    style={[
                      styles.manualTokenBox,
                      {
                        backgroundColor: theme.background,
                        borderColor: theme.border,
                      },
                    ]}
                  >
                    <Text style={[styles.helpTitle, { color: theme.text, textAlign }]}>
                      {t('token_help_title')}
                    </Text>
                    <Text style={[styles.helpStep, { color: theme.textSecondary, textAlign }]}>
                      {t('token_help_step1')}
                    </Text>
                    <Text style={[styles.helpStep, { color: theme.textSecondary, textAlign }]}>
                      {t('token_help_step2')}
                    </Text>
                    <Text style={[styles.helpStep, { color: theme.textSecondary, textAlign }]}>
                      {t('token_help_step3')}
                    </Text>
                    <Text style={[styles.helpStep, { color: theme.textSecondary, textAlign }]}>
                      {t('token_help_step4')}
                    </Text>

                    <TextInput
                      value={manualToken}
                      onChangeText={setManualToken}
                      autoCapitalize="none"
                      autoCorrect={false}
                      placeholder={t('paste_token_placeholder')}
                      placeholderTextColor={theme.placeholder}
                      style={[
                        styles.input,
                        {
                          backgroundColor: theme.backgroundElement,
                          borderColor: theme.border,
                          color: theme.text,
                          textAlign: 'left',
                          marginTop: 6,
                        },
                      ]}
                    />

                    <TouchableOpacity
                      onPress={() => handleTokenLogin(manualToken)}
                      disabled={loginLoading}
                      style={[
                        styles.primaryBtn,
                        { backgroundColor: theme.secondary, marginTop: 4 },
                      ]}
                    >
                      <Text style={styles.primaryBtnText}>{t('connect_btn')}</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            </View>
          ) : (
            /* Step 2: Course Selection */
            <View
              style={[
                styles.card,
                styles.coursesCard,
                {
                  backgroundColor: theme.backgroundElement,
                  borderColor: theme.border,
                },
              ]}
            >
              <View style={[styles.step2Header, { flexDirection: rowDir }]}>
                <View style={styles.step2HeaderTexts}>
                  <Text style={[styles.cardTitle, { color: theme.text, textAlign }]}>
                    {t('select_courses_title')}
                  </Text>
                  <Text style={[styles.cardSubtitle, { color: theme.textSecondary, textAlign }]}>
                    {t('select_courses_subtitle')}
                  </Text>
                </View>

                <TouchableOpacity
                  onPress={handleRefreshCourses}
                  disabled={coursesLoading}
                  style={[
                    styles.refreshPill,
                    {
                      backgroundColor: theme.backgroundSelected,
                      borderColor: theme.border,
                      flexDirection: rowDir,
                    },
                  ]}
                >
                  {coursesLoading ? (
                    <ActivityIndicator size="small" color={theme.primary} />
                  ) : (
                    <RefreshIcon size={15} color={theme.primary} />
                  )}
                  <Text style={[styles.refreshPillText, { color: theme.text }]}>
                    {language === 'he' ? 'רענן' : 'Refresh'}
                  </Text>
                </TouchableOpacity>
              </View>

              {coursesError && (
                <View
                  style={[
                    styles.alertBox,
                    {
                      backgroundColor: `${theme.danger}18`,
                      borderColor: theme.danger,
                      flexDirection: rowDir,
                    },
                  ]}
                >
                  <InfoIcon size={16} color={theme.danger} />
                  <Text style={[styles.alertText, { color: theme.danger, textAlign }]}>
                    {coursesError}
                  </Text>
                </View>
              )}

              {importFeedback && (
                <View
                  style={[
                    styles.alertBox,
                    {
                      backgroundColor:
                        importFeedback.type === 'success'
                          ? `${theme.secondary}18`
                          : `${theme.danger}18`,
                      borderColor:
                        importFeedback.type === 'success' ? theme.secondary : theme.danger,
                      flexDirection: rowDir,
                    },
                  ]}
                >
                  {importFeedback.type === 'success' ? (
                    <CheckIcon size={16} color={theme.secondary} />
                  ) : (
                    <InfoIcon size={16} color={theme.danger} />
                  )}
                  <Text
                    style={[
                      styles.alertText,
                      {
                        color:
                          importFeedback.type === 'success'
                            ? theme.secondary
                            : theme.danger,
                        textAlign,
                      },
                    ]}
                  >
                    {importFeedback.message}
                  </Text>
                </View>
              )}

              {coursesLoading && enrolledCourses.length === 0 ? (
                <View style={styles.loadingCoursesBox}>
                  <ActivityIndicator size="large" color={theme.primary} />
                  <Text style={[styles.loadingCoursesText, { color: theme.textSecondary }]}>
                    {language === 'he' ? 'טוען את הקורסים שלך...' : 'Fetching your Moodle courses...'}
                  </Text>
                </View>
              ) : enrolledCourses.length === 0 && !coursesLoading ? (
                <View style={styles.loadingCoursesBox}>
                  <Text style={[styles.loadingCoursesText, { color: theme.textSecondary }]}>
                    {language === 'he'
                      ? 'לא נמצאו קורסים. לחץ על "רענן" כדי לטעון ממודל.'
                      : 'No courses found. Tap "Refresh" to fetch from Moodle.'}
                  </Text>
                  <TouchableOpacity
                    onPress={handleRefreshCourses}
                    style={[
                      styles.refreshPill,
                      {
                        backgroundColor: theme.backgroundSelected,
                        borderColor: theme.border,
                        flexDirection: rowDir,
                      },
                    ]}
                  >
                    <RefreshIcon size={15} color={theme.primary} />
                    <Text style={[styles.refreshPillText, { color: theme.text }]}>
                      {language === 'he' ? 'רענן קורסים' : 'Refresh Courses'}
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.groupsList}>
                  {semesterGroups.map((group) => (
                    <View key={group.key} style={styles.semesterSection}>
                      <Text
                        style={[
                          styles.semesterHeader,
                          {
                            color: theme.text,
                            borderBottomColor: theme.border,
                            textAlign,
                          },
                        ]}
                      >
                        {group.label}
                      </Text>

                      <View style={styles.semesterCourses}>
                        {group.courses.map((u, uIdx) => {
                          const isMainSelected = selectedIds.includes(u.id);
                          const mainColor = getCourseColor(u.id, uIdx);
                          const childSubs = u.subCourses.filter((s) => s.courseId !== u.id);
                          const hasMultipleSubs = u.subCourses.length > 1;
                          const isLabMain = isLabCourseName(u.fullname, u.shortname);

                          return (
                            <View
                              key={u.id}
                              style={[
                                styles.courseSelectCard,
                                {
                                  backgroundColor: isMainSelected
                                    ? `${mainColor}12`
                                    : theme.background,
                                  borderColor: isMainSelected ? mainColor : theme.border,
                                  borderWidth: isMainSelected ? 1.5 : 1,
                                },
                              ]}
                            >
                              <View style={[styles.courseTopRow, { flexDirection: rowDir }]}>
                                <TouchableOpacity
                                  onPress={() =>
                                    handleToggleCourse(u.id, u.fullname, u.shortname)
                                  }
                                  style={[
                                    styles.checkbox,
                                    {
                                      backgroundColor: isMainSelected
                                        ? mainColor
                                        : 'transparent',
                                      borderColor: isMainSelected
                                        ? mainColor
                                        : theme.textSecondary,
                                    },
                                  ]}
                                  accessibilityRole="checkbox"
                                  accessibilityState={{ checked: isMainSelected }}
                                >
                                  {isMainSelected && (
                                    <CheckIcon
                                      size={14}
                                      color={getReadableTextColor(mainColor)}
                                      strokeWidth={2.6}
                                    />
                                  )}
                                </TouchableOpacity>

                                <TouchableOpacity
                                  onPress={() =>
                                    handleToggleCourse(u.id, u.fullname, u.shortname)
                                  }
                                  style={styles.courseTitleCol}
                                >
                                  <View style={[styles.badgesWrap, { flexDirection: rowDir }]}>
                                    <Text
                                      style={[
                                        styles.courseCode,
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
                                    style={[
                                      styles.courseNameText,
                                      { color: theme.text, textAlign },
                                    ]}
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
                                >
                                  <View
                                    style={[styles.colorDot, { backgroundColor: mainColor }]}
                                  />
                                  <PaletteIcon size={14} color={theme.textSecondary} />
                                </TouchableOpacity>
                              </View>

                              {isMainSelected && (
                                <TextInput
                                  value={nicknames[u.id] ?? ''}
                                  onChangeText={(txt) =>
                                    setNicknames((prev) => ({ ...prev, [u.id]: txt }))
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

                              {renderColorPicker(u.id, mainColor, u.fullname)}

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
                                    const isSubSelected = selectedIds.includes(sub.courseId);
                                    const subColor = getCourseColor(
                                      sub.courseId,
                                      uIdx + sIdx + 1
                                    );
                                    const isSubLab = isLabCourseName(
                                      sub.fullname,
                                      sub.shortname
                                    );
                                    const subTitle =
                                      cleanCourseDisplayName(sub.fullname) || sub.fullname;

                                    return (
                                      <View
                                        key={sub.courseId}
                                        style={[
                                          styles.subCourseBox,
                                          {
                                            backgroundColor: isSubSelected
                                              ? `${subColor}12`
                                              : theme.backgroundElement,
                                            borderColor: isSubSelected
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
                                              handleToggleCourse(
                                                sub.courseId,
                                                sub.fullname,
                                                sub.shortname
                                              )
                                            }
                                            style={[
                                              styles.checkbox,
                                              {
                                                backgroundColor: isSubSelected
                                                  ? subColor
                                                  : 'transparent',
                                                borderColor: isSubSelected
                                                  ? subColor
                                                  : theme.textSecondary,
                                              },
                                            ]}
                                          >
                                            {isSubSelected && (
                                              <CheckIcon
                                                size={13}
                                                color={getReadableTextColor(subColor)}
                                                strokeWidth={2.6}
                                              />
                                            )}
                                          </TouchableOpacity>

                                          <TouchableOpacity
                                            onPress={() =>
                                              handleToggleCourse(
                                                sub.courseId,
                                                sub.fullname,
                                                sub.shortname
                                              )
                                            }
                                            style={styles.courseTitleCol}
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
                                                  <FlaskIcon
                                                    size={11}
                                                    color={theme.warning}
                                                  />
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
                                              {subTitle}
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
                                                styles.colorDot,
                                                { backgroundColor: subColor },
                                              ]}
                                            />
                                            <PaletteIcon
                                              size={13}
                                              color={theme.textSecondary}
                                            />
                                          </TouchableOpacity>
                                        </View>

                                        {isSubSelected && (
                                          <TextInput
                                            value={nicknames[sub.courseId] ?? ''}
                                            onChangeText={(txt) =>
                                              setNicknames((prev) => ({
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

                                        {renderColorPicker(sub.courseId, subColor, subTitle)}
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
                    <View style={styles.semesterSection}>
                      <View
                        style={[
                          styles.adminHeaderRow,
                          { borderBottomColor: theme.border, flexDirection: rowDir },
                        ]}
                      >
                        <View style={[styles.adminTitleRow, { flexDirection: rowDir }]}>
                          <ShieldIcon size={17} color={theme.primary} />
                          <Text style={[styles.adminHeaderTitle, { color: theme.text }]}>
                            {t('admin_umbrella_title')}
                          </Text>
                        </View>
                        <TouchableOpacity
                          onPress={handleToggleUmbrellaAll}
                          style={[
                            styles.umbrellaBtn,
                            {
                              backgroundColor: theme.backgroundSelected,
                              borderColor: theme.border,
                            },
                          ]}
                        >
                          <Text style={[styles.umbrellaBtnText, { color: theme.primary }]}>
                            {adminUmbrella.subCourses.every((s) =>
                              selectedIds.includes(s.courseId)
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

                      <View style={styles.semesterCourses}>
                        {adminUmbrella.subCourses.map((sub, idx) => {
                          const isSelected = selectedIds.includes(sub.courseId);
                          const subColor = getCourseColor(sub.courseId, idx + 8);
                          return (
                            <View
                              key={sub.courseId}
                              style={[
                                styles.courseSelectCard,
                                {
                                  backgroundColor: isSelected
                                    ? `${subColor}12`
                                    : theme.background,
                                  borderColor: isSelected ? subColor : theme.border,
                                  borderWidth: isSelected ? 1.5 : 1,
                                },
                              ]}
                            >
                              <View style={[styles.courseTopRow, { flexDirection: rowDir }]}>
                                <TouchableOpacity
                                  onPress={() =>
                                    handleToggleCourse(
                                      sub.courseId,
                                      sub.fullname,
                                      sub.shortname
                                    )
                                  }
                                  style={[
                                    styles.checkbox,
                                    {
                                      backgroundColor: isSelected
                                        ? subColor
                                        : 'transparent',
                                      borderColor: isSelected
                                        ? subColor
                                        : theme.textSecondary,
                                    },
                                  ]}
                                >
                                  {isSelected && (
                                    <CheckIcon
                                      size={14}
                                      color={getReadableTextColor(subColor)}
                                      strokeWidth={2.6}
                                    />
                                  )}
                                </TouchableOpacity>

                                <TouchableOpacity
                                  onPress={() =>
                                    handleToggleCourse(
                                      sub.courseId,
                                      sub.fullname,
                                      sub.shortname
                                    )
                                  }
                                  style={styles.courseTitleCol}
                                >
                                  <View
                                    style={[
                                      styles.pillBadge,
                                      {
                                        backgroundColor: theme.backgroundSelected,
                                        alignSelf: isRtl ? 'flex-end' : 'flex-start',
                                      },
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
                                  <Text
                                    style={[
                                      styles.courseNameText,
                                      { color: theme.text, textAlign },
                                    ]}
                                  >
                                    {sub.fullname}
                                  </Text>
                                </TouchableOpacity>
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    </View>
                  )}
                </View>
              )}

              {/* Footer Actions */}
              <View style={styles.step2Actions}>
                <NoodleGradientButton
                  label={`${t('start_tracking_btn')} (${selectedIds.length})`}
                  onPress={handleCompleteOnboarding}
                  disabled={selectedIds.length === 0 || completing}
                  isRtl={isRtl}
                  size="md"
                  fullWidth
                  icon={
                    completing ? (
                      <ActivityIndicator size="small" color="#ffffff" />
                    ) : undefined
                  }
                />

                <TouchableOpacity
                  onPress={handleImportConfig}
                  style={[
                    styles.secondaryBtn,
                    {
                      backgroundColor: theme.backgroundSelected,
                      borderColor: theme.border,
                      flexDirection: rowDir,
                    },
                  ]}
                >
                  <DownloadIcon size={16} color={theme.primary} />
                  <Text style={[styles.secondaryBtnText, { color: theme.text }]}>
                    {t('import_config_btn')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <SsoWebViewModal
        visible={ssoModalVisible}
        mode="moodle"
        onClose={() => setSsoModalVisible(false)}
        onTokenCaptured={(tok) => handleTokenLogin(tok)}
      />

      {/* Lab Course Detection Modal */}
      <Modal
        visible={Boolean(labPromptCourse)}
        transparent
        animationType="fade"
        onRequestClose={() => setLabPromptCourse(null)}
      >
        <View style={styles.labModalBackdrop}>
          <View
            style={[
              styles.labModalCard,
              {
                backgroundColor: theme.backgroundElement,
                borderColor: theme.warning,
              },
            ]}
          >
            <View style={[styles.labModalHeader, { flexDirection: rowDir }]}>
              <FlaskIcon size={20} color={theme.warning} />
              <Text style={[styles.labModalTitle, { color: theme.text, textAlign }]}>
                {t('lab_detected_title')}
              </Text>
            </View>
            {labPromptCourse && (
              <Text style={[styles.labModalCourse, { color: theme.primary, textAlign }]}>
                {labPromptCourse.title}
              </Text>
            )}
            <Text style={[styles.labModalDesc, { color: theme.textSecondary, textAlign }]}>
              {t('lab_detected_desc')}
            </Text>
            <View style={[styles.labModalActions, { flexDirection: rowDir }]}>
              <TouchableOpacity
                onPress={() => setLabPromptCourse(null)}
                style={[styles.labBtn, { backgroundColor: theme.backgroundSelected }]}
              >
                <Text style={[styles.labBtnText, { color: theme.text }]}>
                  {t('lab_detected_keep_btn')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  if (labPromptCourse) {
                    const cid = labPromptCourse.courseId;
                    setHideLabCourseIds((prev) =>
                      prev.includes(cid) ? prev : [...prev, cid]
                    );
                  }
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
      </Modal>

      <ColorPalettePickerModal
        visible={Boolean(paletteTarget)}
        initialColor={paletteTarget?.color || COURSE_COLOR_PALETTE[0]}
        courseName={paletteTarget?.courseName}
        onSelectColor={(hex) => {
          if (paletteTarget) {
            setColors((prev) => ({
              ...prev,
              [paletteTarget.courseId]: hex,
            }));
          }
        }}
        onClose={() => setPaletteTarget(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  flexOne: {
    flex: 1,
  },
  scrollCenter: {
    flexGrow: 1,
    paddingHorizontal: 18,
    paddingVertical: 20,
    alignItems: 'center',
  },
  topBar: {
    width: '100%',
    justifyContent: 'flex-end',
    marginBottom: 14,
  },
  langToggleGroup: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 3,
    gap: 4,
  },
  langBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 7,
  },
  langBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  card: {
    width: '100%',
    borderRadius: 20,
    borderWidth: 1,
    padding: 22,
    gap: 16,
  },
  loginCard: {
    maxWidth: 520,
  },
  coursesCard: {
    maxWidth: 840,
  },
  brandBlock: {
    alignItems: 'center',
    gap: 6,
  },
  logoImg: {
    width: 68,
    height: 68,
    marginBottom: 4,
  },
  brandName: {
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  cardSubtitle: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  alertBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    gap: 8,
  },
  alertText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
  },
  formFields: {
    gap: 12,
  },
  fieldGroup: {
    gap: 5,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  input: {
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 13,
    paddingVertical: 11,
    fontSize: 15,
  },
  passwordWrap: {
    borderWidth: 1,
    borderRadius: 11,
    alignItems: 'center',
    paddingHorizontal: 13,
  },
  passwordInput: {
    flex: 1,
    paddingVertical: 11,
    fontSize: 15,
  },
  eyeBtn: {
    padding: 6,
  },
  rememberRow: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 2,
  },
  rememberLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  primaryBtn: {
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  secondaryBtn: {
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  secondaryBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  manualToggleBtn: {
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  manualToggleText: {
    fontSize: 13,
    fontWeight: '600',
  },
  manualTokenBox: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    gap: 6,
  },
  helpTitle: {
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 2,
  },
  helpStep: {
    fontSize: 12,
    lineHeight: 18,
  },
  step2Header: {
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  step2HeaderTexts: {
    flex: 1,
    gap: 4,
  },
  refreshPill: {
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    gap: 6,
  },
  refreshPillText: {
    fontSize: 13,
    fontWeight: '700',
  },
  loadingCoursesBox: {
    paddingVertical: 40,
    alignItems: 'center',
    gap: 12,
  },
  loadingCoursesText: {
    fontSize: 14,
  },
  groupsList: {
    gap: 18,
  },
  semesterSection: {
    gap: 10,
  },
  semesterHeader: {
    fontSize: 15,
    fontWeight: '800',
    paddingBottom: 6,
    borderBottomWidth: 1,
  },
  semesterCourses: {
    gap: 10,
  },
  courseSelectCard: {
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
  courseTitleCol: {
    flex: 1,
    gap: 3,
  },
  badgesWrap: {
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  courseCode: {
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
  colorDot: {
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
    width: 25,
    height: 25,
    borderRadius: 12.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  customColorBtn: {
    height: 25,
    paddingHorizontal: 8,
    borderRadius: 12.5,
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
  adminHeaderRow: {
    paddingBottom: 6,
    borderBottomWidth: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  adminTitleRow: {
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  adminHeaderTitle: {
    fontSize: 15,
    fontWeight: '800',
  },
  umbrellaBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  umbrellaBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  step2Actions: {
    marginTop: 6,
    gap: 10,
  },
  labModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  labModalCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 18,
    gap: 10,
  },
  labModalHeader: {
    alignItems: 'center',
    gap: 8,
  },
  labModalTitle: {
    fontSize: 16,
    fontWeight: '800',
    flex: 1,
  },
  labModalCourse: {
    fontSize: 14,
    fontWeight: '700',
  },
  labModalDesc: {
    fontSize: 13,
    lineHeight: 19,
  },
  labModalActions: {
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
