import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import type * as FileSystemTypes from 'expo-file-system';
import type * as SharingTypes from 'expo-sharing';
import { ManageCoursesModal } from '@/components/ManageCoursesModal';
import { SsoWebViewModal } from '@/components/SsoWebViewModal';
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ClockIcon,
  CoffeeIcon,
  CourseIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FlaskIcon,
  InfoIcon,
  LinkIcon,
  LogoutIcon,
  MoonIcon,
  PaletteIcon,
  RefreshIcon,
  SettingsIcon,
  ShareIcon,
  ShieldIcon,
  SparklesIcon,
  StarIcon,
  SunIcon,
  TourIcon,
  UserIcon,
  VideoIcon,
} from '@/components/icons/NoodleIcons';
import { NoodleGradientButton } from '@/components/ui/NoodleAnimations';
import { Colors, ThemeColors, ThemeMode } from '@/constants/theme';
import { useAppState } from '@/hooks/use-app-state';
import { SupportedLanguage, usePreferences } from '@/hooks/use-preferences';
import { useResponsiveLayout } from '@/hooks/use-responsive-layout';
import { getPreference, setPreference } from '@/services/database';
import {
  DEFAULT_GOOGLE_CLIENT_ID,
  authenticateGoogleOAuth,
  getEffectiveRedirectUri,
  getGoogleAccessToken,
  performGoogleTasksSync,
  setGoogleAccessToken,
} from '@/services/googleTasks';
import { openMoodleUrl } from '@/services/moodleLink';
import { requestNotificationPermissions } from '@/services/notifications';
import {
  exportConfigBackupJson,
  importConfigBackupJson,
} from '@/services/settingsSyncService';

const SYNC_INTERVAL_OPTIONS = [15, 30, 60, 120] as const;

interface NumberStepperProps {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix: string;
  onChange: (val: number) => void;
  theme: ThemeColors;
  rowDir: 'row' | 'row-reverse';
  textAlign: 'left' | 'right';
}

function NumberStepper({
  label,
  value,
  min,
  max,
  suffix,
  onChange,
  theme,
  rowDir,
  textAlign,
}: NumberStepperProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const displayValue = draft !== null ? draft : String(value);

  const commitDraft = () => {
    if (draft === null) return;
    const cleaned = draft.replace(/[^0-9]/g, '');
    setDraft(null);
    if (!cleaned) return;
    const parsed = parseInt(cleaned, 10);
    if (Number.isFinite(parsed)) {
      const clamped = Math.max(min, Math.min(max, parsed));
      if (clamped !== value) {
        onChange(clamped);
      }
    }
  };

  return (
    <View style={[styles.stepperRow, { flexDirection: rowDir }]}>
      <Text style={[styles.stepperLabel, { color: theme.text, textAlign }]}>{label}</Text>
      <View style={[styles.stepperControls, { flexDirection: rowDir }]}>
        <Pressable
          onPress={() => {
            setDraft(null);
            onChange(Math.max(min, value - 1));
          }}
          style={({ pressed }) => [
            styles.stepperBtn,
            {
              backgroundColor: theme.background,
              borderColor: theme.border,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Text style={[styles.stepperBtnText, { color: theme.text }]}>-</Text>
        </Pressable>

        <TextInput
          keyboardType="number-pad"
          value={displayValue}
          onChangeText={(txt) => {
            setDraft(txt.replace(/[^0-9]/g, ''));
          }}
          onBlur={commitDraft}
          onSubmitEditing={commitDraft}
          style={[
            styles.stepperInput,
            {
              backgroundColor: theme.background,
              borderColor: theme.border,
              color: theme.text,
            },
          ]}
        />

        <Pressable
          onPress={() => {
            setDraft(null);
            onChange(Math.min(max, value + 1));
          }}
          style={({ pressed }) => [
            styles.stepperBtn,
            {
              backgroundColor: theme.background,
              borderColor: theme.border,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Text style={[styles.stepperBtnText, { color: theme.text }]}>+</Text>
        </Pressable>

        {suffix ? (
          <Text style={[styles.stepperSuffix, { color: theme.textSecondary }]}>{suffix}</Text>
        ) : null}
      </View>
    </View>
  );
}

function getFileSystemModule(): typeof FileSystemTypes | null {
  if (Platform.OS === 'web') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-file-system') as typeof FileSystemTypes;
  } catch {
    return null;
  }
}

function getSharingModule(): typeof SharingTypes | null {
  if (Platform.OS === 'web') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-sharing') as typeof SharingTypes;
  } catch {
    return null;
  }
}

export default function SettingsScreen() {
  const router = useRouter();
  const { isLandscapeTablet } = useResponsiveLayout();
  const {
    themeMode,
    theme,
    language,
    isRtl,
    timeDayStart,
    timeDayEnd,
    setThemeMode,
    setTimeWindow,
    setLanguage,
    t,
  } = usePreferences();

  const {
    settings,
    syncResult,
    enrolledCourses,
    lastSyncedAt,
    userFullname,
    hasMockCourse,
    triggerSync,
    updateSetting,
    refreshFromLocal,
    addMockCourse,
    removeMockCourse,
    disconnectAccount,
    startTour,
  } = useAppState();

  const rowDir = isRtl ? 'row-reverse' : 'row';
  const textAlign = isRtl ? 'right' : 'left';

  // Modal state
  const [manageCoursesVisible, setManageCoursesVisible] = useState<boolean>(false);
  const [panoptoSsoVisible, setPanoptoSsoVisible] = useState<boolean>(false);

  // Local editable states synced from settings & preferences
  const [listNameDraft, setListNameDraft] = useState<string | null>(null);
  const listNameInput = listNameDraft ?? settings.googleTasksListName;
  const [customClientId, setCustomClientId] = useState<string>(() => {
    try {
      return getPreference('google_tasks_client_id') || '';
    } catch {
      return '';
    }
  });
  const [manualTokenInput, setManualTokenInput] = useState<string>('');
  const [hasGoogleToken, setHasGoogleToken] = useState<boolean>(false);
  const [showAdvancedGoogle, setShowAdvancedGoogle] = useState<boolean>(false);
  const [googleBusy, setGoogleBusy] = useState<boolean>(false);
  const [googleStatusMsg, setGoogleStatusMsg] = useState<string | null>(null);
  const [copiedRedirectNotice, setCopiedRedirectNotice] = useState<boolean>(false);

  const [backupBusy, setBackupBusy] = useState<boolean>(false);
  const [backupStatus, setBackupStatus] = useState<{ text: string; isError: boolean } | null>(null);

  const [mockToggleBusy, setMockToggleBusy] = useState<boolean>(false);
  const [aboutExpanded, setAboutExpanded] = useState<boolean>(false);
  const [disconnecting, setDisconnecting] = useState<boolean>(false);

  useEffect(() => {
    let active = true;
    getGoogleAccessToken()
      .then((tok) => {
        if (active) setHasGoogleToken(Boolean(tok));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const effectiveRedirectUri = useMemo(() => {
    const cid = customClientId.trim() || DEFAULT_GOOGLE_CLIENT_ID;
    return getEffectiveRedirectUri(cid);
  }, [customClientId]);

  const handleLanguageChange = useCallback(
    async (nextLang: SupportedLanguage) => {
      setLanguage(nextLang);
      await updateSetting('language', nextLang);
    },
    [setLanguage, updateSetting]
  );

  const handleThemeChange = useCallback(
    async (nextMode: ThemeMode) => {
      setThemeMode(nextMode);
      await updateSetting('theme', nextMode);
    },
    [setThemeMode, updateSetting]
  );

  const handleDayStartChange = useCallback(
    async (rawVal: number) => {
      const clamped = Math.max(0, Math.min(23, Math.floor(rawVal)));
      setTimeWindow(clamped, timeDayEnd);
      await updateSetting('themeTimeDayStart', clamped);
    },
    [setTimeWindow, timeDayEnd, updateSetting]
  );

  const handleDayEndChange = useCallback(
    async (rawVal: number) => {
      const clamped = Math.max(0, Math.min(23, Math.floor(rawVal)));
      setTimeWindow(timeDayStart, clamped);
      await updateSetting('themeTimeDayEnd', clamped);
    },
    [setTimeWindow, timeDayStart, updateSetting]
  );

  const handleGreenDaysChange = useCallback(
    async (rawVal: number) => {
      const clamped = Math.max(2, Math.min(90, Math.floor(rawVal)));
      await updateSetting('dueDateGreenDays', clamped);
      if (settings.dueDateYellowDays >= clamped) {
        await updateSetting('dueDateYellowDays', Math.max(1, clamped - 1));
      }
    },
    [settings.dueDateYellowDays, updateSetting]
  );

  const handleYellowDaysChange = useCallback(
    async (rawVal: number) => {
      const maxYellow = Math.min(60, Math.max(1, settings.dueDateGreenDays - 1));
      const clamped = Math.max(1, Math.min(maxYellow, Math.floor(rawVal)));
      await updateSetting('dueDateYellowDays', clamped);
    },
    [settings.dueDateGreenDays, updateSetting]
  );

  const handleToggleNotifications = useCallback(
    async (nextVal: boolean) => {
      if (nextVal) {
        const granted = await requestNotificationPermissions();
        if (!granted && Platform.OS !== 'web') {
          Alert.alert(
            isRtl ? 'נדרשת הרשאה' : 'Permission Required',
            isRtl
              ? 'יש לאשר הרשאת התראות בהגדרות המכשיר כדי לקבל תזכורות הגשה.'
              : 'Please allow notification permissions in device settings to receive deadline reminders.'
          );
          return;
        }
      }
      await updateSetting('notificationsEnabled', nextVal);
    },
    [isRtl, updateSetting]
  );

  const handleSaveClientId = useCallback((val: string) => {
    setCustomClientId(val);
    try {
      setPreference('google_tasks_client_id', val.trim());
    } catch {}
  }, []);

  const handleAuthAndSyncGoogle = useCallback(async () => {
    setGoogleBusy(true);
    setGoogleStatusMsg(isRtl ? 'מתחבר ל-Google...' : 'Authenticating with Google...');
    try {
      const authRes = await authenticateGoogleOAuth(customClientId.trim() || undefined);
      if (!authRes.success || !authRes.token) {
        setGoogleStatusMsg(
          authRes.error || (isRtl ? 'האימות בוטל או נכשל.' : 'Authentication was cancelled or failed.')
        );
        return;
      }
      setHasGoogleToken(true);
      setGoogleStatusMsg(isRtl ? 'מסנכרן משימות...' : 'Syncing tasks...');
      const syncRes = await performGoogleTasksSync(syncResult.assignments || []);
      setGoogleStatusMsg(
        syncRes.message ||
          (syncRes.success
            ? isRtl
              ? 'הסנכרון הושלם בהצלחה.'
              : 'Sync completed.'
            : isRtl
              ? 'הסנכרון נכשל.'
              : 'Sync failed.')
      );
    } catch (e: any) {
      setGoogleStatusMsg(e?.message || (isRtl ? 'שגיאה בחיבור ל-Google' : 'Google auth failed'));
    } finally {
      setGoogleBusy(false);
    }
  }, [customClientId, isRtl, syncResult.assignments]);

  const handleManualGoogleSync = useCallback(async () => {
    setGoogleBusy(true);
    setGoogleStatusMsg(isRtl ? 'מסנכרן משימות...' : 'Syncing tasks...');
    try {
      const syncRes = await performGoogleTasksSync(syncResult.assignments || []);
      setGoogleStatusMsg(
        syncRes.message ||
          (syncRes.success
            ? isRtl
              ? 'הסנכרון הושלם בהצלחה.'
              : 'Sync completed.'
            : isRtl
              ? 'הסנכרון נכשל.'
              : 'Sync failed.')
      );
    } catch (e: any) {
      setGoogleStatusMsg(e?.message || (isRtl ? 'הסנכרון נכשל' : 'Sync failed'));
    } finally {
      setGoogleBusy(false);
    }
  }, [isRtl, syncResult.assignments]);

  const handleSaveManualToken = useCallback(async () => {
    const trimmed = manualTokenInput.trim();
    if (!trimmed) return;
    setGoogleBusy(true);
    try {
      await setGoogleAccessToken(trimmed);
      setHasGoogleToken(true);
      setManualTokenInput('');
      setGoogleStatusMsg(
        isRtl ? 'אסימון הגישה נשמר בהצלחה.' : 'Access token saved successfully.'
      );
    } catch (e: any) {
      setGoogleStatusMsg(e?.message || (isRtl ? 'שמירת האסימון נכשלה' : 'Failed to save token'));
    } finally {
      setGoogleBusy(false);
    }
  }, [isRtl, manualTokenInput]);

  const handleCopyRedirectUri = useCallback(async () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(effectiveRedirectUri);
        setCopiedRedirectNotice(true);
        setTimeout(() => setCopiedRedirectNotice(false), 2000);
        return;
      } catch {
        // Fallback to Share below
      }
    }
    try {
      await Share.share({ message: effectiveRedirectUri });
    } catch {
      // Ignore user cancel
    }
  }, [effectiveRedirectUri]);

  const handleExportConfig = useCallback(async () => {
    setBackupBusy(true);
    setBackupStatus(null);
    try {
      const jsonString = await exportConfigBackupJson();
      const fileName = `noodle_config_${new Date().toISOString().slice(0, 10)}.json`;

      if (Platform.OS === 'web') {
        if (typeof Blob !== 'undefined' && typeof URL !== 'undefined' && typeof document !== 'undefined') {
          const blob = new Blob([jsonString], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = fileName;
          anchor.click();
          URL.revokeObjectURL(url);
          setBackupStatus({
            text: isRtl ? 'קובץ הגיבוי הורד בהצלחה.' : 'Configuration backup downloaded.',
            isError: false,
          });
          return;
        }
        throw new Error('Browser file download unavailable.');
      }

      const fs = getFileSystemModule();
      const sharing = getSharingModule();
      if (!fs) {
        throw new Error('File system module unavailable.');
      }

      const file = new fs.File(fs.Paths.cache, fileName);
      file.create({ overwrite: true });
      file.write(jsonString);

      if (sharing && (await sharing.isAvailableAsync())) {
        await sharing.shareAsync(file.uri, {
          mimeType: 'application/json',
          dialogTitle: fileName,
        });
      }

      setBackupStatus({
        text: isRtl ? 'קובץ הגיבוי יוצא בהצלחה.' : 'Configuration exported successfully.',
        isError: false,
      });
    } catch (e: any) {
      setBackupStatus({
        text: e?.message || (isRtl ? 'ייצוא ההגדרות נכשל.' : 'Failed to export configuration.'),
        isError: true,
      });
    } finally {
      setBackupBusy(false);
    }
  }, [isRtl]);

  const handleImportConfig = useCallback(async () => {
    setBackupBusy(true);
    setBackupStatus(null);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/json', 'text/plain', '*/*'],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];
      let jsonText = '';

      if (Platform.OS === 'web') {
        if (asset.file) {
          jsonText = await asset.file.text();
        } else {
          const resp = await fetch(asset.uri);
          jsonText = await resp.text();
        }
      } else {
        const fs = getFileSystemModule();
        if (fs) {
          const pickedFile = new fs.File(asset.uri);
          jsonText = await pickedFile.text();
        } else {
          const resp = await fetch(asset.uri);
          jsonText = await resp.text();
        }
      }

      const availableCourses =
        enrolledCourses.length > 0
          ? enrolledCourses.map((c) => ({ id: c.id, moodle_id: c.id, name: c.fullname }))
          : undefined;

      const summary = await importConfigBackupJson(jsonText, availableCourses);
      await refreshFromLocal();

      setBackupStatus({
        text: `${t('import_success')} (${summary.importedCount})`,
        isError: false,
      });
    } catch (e: any) {
      setBackupStatus({
        text: `${t('import_failed')}: ${e?.message || ''}`.trim(),
        isError: true,
      });
    } finally {
      setBackupBusy(false);
    }
  }, [enrolledCourses, refreshFromLocal, t]);

  const handleToggleMockCourse = useCallback(
    async (enable: boolean) => {
      setMockToggleBusy(true);
      try {
        if (enable) {
          await addMockCourse();
        } else {
          await removeMockCourse();
        }
      } finally {
        setMockToggleBusy(false);
      }
    },
    [addMockCourse, removeMockCourse]
  );

  const handleTakeTour = useCallback(() => {
    startTour();
    router.navigate('/(tabs)' as never);
  }, [router, startTour]);

  const performDisconnect = useCallback(async () => {
    setDisconnecting(true);
    try {
      await disconnectAccount();
      router.replace('/onboarding' as any);
    } finally {
      setDisconnecting(false);
    }
  }, [disconnectAccount, router]);

  const handleDisconnectPress = useCallback(() => {
    if (Platform.OS === 'web') {
      const confirmed =
        typeof window !== 'undefined' && typeof window.confirm === 'function'
          ? window.confirm(`${t('disconnect_confirm_title')}\n\n${t('disconnect_confirm_desc')}`)
          : true;
      if (confirmed) {
        performDisconnect().catch(() => {});
      }
      return;
    }

    Alert.alert(t('disconnect_confirm_title'), t('disconnect_confirm_desc'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('disconnect_account'),
        style: 'destructive',
        onPress: () => {
          performDisconnect().catch(() => {});
        },
      },
    ]);
  }, [performDisconnect, t]);

  const themeOptions: {
    id: ThemeMode;
    label: string;
    swatches: readonly [string, string, string, string];
    renderIcon: (color: string) => React.ReactNode;
  }[] = [
    {
      id: 'noodle',
      label: t('theme_noodle'),
      swatches: [Colors.noodle.background, Colors.noodle.backgroundElement, Colors.noodle.primary, Colors.noodle.secondary],
      renderIcon: (c) => <SunIcon size={16} color={c} />,
    },
    {
      id: 'coffee',
      label: t('theme_coffee'),
      swatches: [Colors.coffee.background, Colors.coffee.backgroundElement, Colors.coffee.primary, Colors.coffee.secondary],
      renderIcon: (c) => <CoffeeIcon size={16} color={c} />,
    },
    {
      id: 'dark',
      label: t('theme_dark'),
      swatches: [Colors.dark.background, Colors.dark.backgroundElement, Colors.dark.primary, Colors.dark.secondary],
      renderIcon: (c) => <MoonIcon size={16} color={c} />,
    },
    {
      id: 'light',
      label: t('theme_light'),
      swatches: [Colors.light.background, Colors.light.backgroundElement, Colors.light.primary, Colors.light.secondary],
      renderIcon: (c) => <SunIcon size={16} color={c} />,
    },
    {
      id: 'time',
      label: t('theme_time'),
      swatches: [Colors.noodle.background, Colors.noodle.primary, Colors.coffee.background, Colors.coffee.primary],
      renderIcon: (c) => <ClockIcon size={16} color={c} />,
    },
    {
      id: 'system',
      label: t('theme_system'),
      swatches: [Colors.light.background, Colors.light.primary, Colors.dark.background, Colors.dark.primary],
      renderIcon: (c) => <PaletteIcon size={16} color={c} />,
    },
  ];

  const renderStepper = (
    label: string,
    value: number,
    min: number,
    max: number,
    suffix: string,
    onChange: (val: number) => void
  ) => (
    <NumberStepper
      label={label}
      value={value}
      min={min}
      max={max}
      suffix={suffix}
      onChange={onChange}
      theme={theme}
      rowDir={rowDir}
      textAlign={textAlign}
    />
  );

  const formattedLastSynced = useMemo(() => {
    if (!lastSyncedAt) return isRtl ? 'לא סונכרן' : 'Never';
    const d = new Date(lastSyncedAt);
    if (isNaN(d.getTime())) return lastSyncedAt;
    try {
      return d.toLocaleString(language === 'he' ? 'he-IL' : 'en-US');
    } catch {
      return d.toISOString();
    }
  }, [lastSyncedAt, isRtl, language]);

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: theme.background }]}
      edges={isLandscapeTablet ? ['top'] : ['top', 'left', 'right']}
    >
      {/* Header */}
      <View
        style={[
          styles.header,
          { backgroundColor: theme.backgroundElement, borderBottomColor: theme.border },
        ]}
      >
        <View
          style={[
            styles.headerInner,
            isLandscapeTablet ? styles.centeredMax : styles.centeredPortrait,
            { flexDirection: rowDir },
          ]}
        >
          <View style={[styles.headerTitleRow, { flexDirection: rowDir }]}>
            <View style={[styles.iconBadge, { backgroundColor: `${theme.primary}1a` }]}>
              <SettingsIcon size={20} color={theme.primary} />
            </View>
            <Text style={[styles.headerTitle, { color: theme.text, textAlign }]}>
              {t('settings')}
            </Text>
          </View>
        </View>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      <ScrollView
        style={styles.scroll}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.scrollContent,
          isLandscapeTablet ? styles.centeredMax : styles.centeredPortrait,
        ]}
      >
        {/* 1. Appearance & Language */}
        <View
          style={[
            styles.card,
            { backgroundColor: theme.backgroundElement, borderColor: theme.border },
          ]}
        >
          <View style={[styles.cardTitleRow, { flexDirection: rowDir }]}>
            <PaletteIcon size={18} color={theme.primary} />
            <Text style={[styles.cardTitle, { color: theme.text, textAlign }]}>
              {isRtl ? 'מראה ושפה' : 'Appearance & Language'}
            </Text>
          </View>

          {/* Language Toggle */}
          <Text style={[styles.subLabel, { color: theme.textSecondary, textAlign }]}>
            {t('language_label')}
          </Text>
          <View style={[styles.pillGroup, { flexDirection: rowDir }]}>
            {(
              [
                { code: 'he', label: 'עברית' },
                { code: 'en', label: 'English' },
              ] as const
            ).map((opt) => {
              const active = language === opt.code;
              return (
                <Pressable
                  key={opt.code}
                  onPress={() => handleLanguageChange(opt.code).catch(() => {})}
                  style={[
                    styles.choicePill,
                    {
                      backgroundColor: active ? theme.primary : theme.background,
                      borderColor: active ? theme.primary : theme.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.choicePillText,
                      { color: active ? theme.onPrimary : theme.text },
                    ]}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Theme Selector */}
          <Text style={[styles.subLabel, { color: theme.textSecondary, textAlign, marginTop: 8 }]}>
            {t('theme_label')}
          </Text>
          <View style={[styles.themeGrid, { flexDirection: rowDir }]}>
            {themeOptions.map((opt) => {
              const active = themeMode === opt.id;
              const iconColor = active ? theme.onPrimary : theme.textSecondary;
              return (
                <Pressable
                  key={opt.id}
                  onPress={() => handleThemeChange(opt.id).catch(() => {})}
                  style={[
                    styles.themeCardBtn,
                    {
                      backgroundColor: active ? theme.primary : theme.background,
                      borderColor: active ? theme.primary : theme.border,
                      flexDirection: rowDir,
                    },
                  ]}
                >
                  {opt.renderIcon(iconColor)}
                  <Text
                    numberOfLines={2}
                    style={[
                      styles.themeCardText,
                      { color: active ? theme.onPrimary : theme.text, textAlign },
                    ]}
                  >
                    {opt.label}
                  </Text>
                  <View style={[styles.swatchRow, { flexDirection: rowDir }]}>
                    {opt.swatches.map((dotColor, dotIdx) => (
                      <View
                        key={`${opt.id}-dot-${dotIdx}`}
                        style={[
                          styles.swatchDot,
                          {
                            backgroundColor: dotColor,
                            borderColor: active
                              ? 'rgba(255,255,255,0.45)'
                              : theme.border,
                          },
                        ]}
                      />
                    ))}
                  </View>
                </Pressable>
              );
            })}
          </View>

          {/* Configurable Day Start / End when Time-Based theme is active */}
          {themeMode === 'time' ? (
            <View
              style={[
                styles.subBox,
                { backgroundColor: theme.background, borderColor: theme.border },
              ]}
            >
              {renderStepper(t('time_day_start'), timeDayStart, 0, 23, ':00', (v) => {
                handleDayStartChange(v).catch(() => {});
              })}
              {renderStepper(t('time_day_end'), timeDayEnd, 0, 23, ':00', (v) => {
                handleDayEndChange(v).catch(() => {});
              })}
            </View>
          ) : null}

          {/* Urgency Thresholds */}
          <View style={[styles.divider, { backgroundColor: theme.border }]} />
          <Text style={[styles.subLabel, { color: theme.textSecondary, textAlign }]}>
            {t('thresholds_title')}
          </Text>
          <View
            style={[
              styles.subBox,
              { backgroundColor: theme.background, borderColor: theme.border },
            ]}
          >
            {renderStepper(
              t('green_days_label'),
              settings.dueDateGreenDays,
              2,
              90,
              isRtl ? 'ימים' : 'd',
              (v) => {
                handleGreenDaysChange(v).catch(() => {});
              }
            )}
            {renderStepper(
              t('yellow_days_label'),
              settings.dueDateYellowDays,
              1,
              Math.min(60, Math.max(1, settings.dueDateGreenDays - 1)),
              isRtl ? 'ימים' : 'd',
              (v) => {
                handleYellowDaysChange(v).catch(() => {});
              }
            )}
          </View>
        </View>

        {/* 2. Courses & Sync */}
        <View
          style={[
            styles.card,
            { backgroundColor: theme.backgroundElement, borderColor: theme.border },
          ]}
        >
          <View style={[styles.cardTitleRow, { flexDirection: rowDir }]}>
            <CourseIcon size={18} color={theme.primary} />
            <Text style={[styles.cardTitle, { color: theme.text, textAlign }]}>
              {isRtl ? 'קורסים וסנכרון' : 'Courses & Sync'}
            </Text>
          </View>

          <NoodleGradientButton
            label={t('manage_courses_btn')}
            icon={<CourseIcon size={16} color="#ffffff" />}
            onPress={() => setManageCoursesVisible(true)}
            size="md"
            isRtl={isRtl}
            fullWidth
          />

          {/* Auto-sync interval selector */}
          <Text style={[styles.subLabel, { color: theme.textSecondary, textAlign, marginTop: 6 }]}>
            {t('auto_sync_interval')}
          </Text>
          <View style={[styles.pillGroup, { flexDirection: rowDir }]}>
            {SYNC_INTERVAL_OPTIONS.map((mins) => {
              const active = settings.syncIntervalMinutes === mins;
              return (
                <Pressable
                  key={mins}
                  onPress={() => updateSetting('syncIntervalMinutes', mins).catch(() => {})}
                  style={[
                    styles.choicePill,
                    {
                      backgroundColor: active ? theme.primary : theme.background,
                      borderColor: active ? theme.primary : theme.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.choicePillText,
                      { color: active ? theme.onPrimary : theme.text },
                    ]}
                  >
                    {t('time_limit_minutes', { minutes: mins })}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Notifications Switch */}
          <View style={[styles.switchRow, { flexDirection: rowDir }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.switchLabel, { color: theme.text, textAlign }]}>
                {t('notifications_label')}
              </Text>
              <Text style={[styles.switchHint, { color: theme.textSecondary, textAlign }]}>
                {isRtl
                  ? 'תזכורות 24 שעות ושעה לפני מועדי הגשה'
                  : 'Reminders 24h and 1h before assignment deadlines'}
              </Text>
            </View>
            <Switch
              value={settings.notificationsEnabled}
              onValueChange={(v) => handleToggleNotifications(v).catch(() => {})}
              trackColor={{ false: theme.border, true: theme.primary }}
              thumbColor="#ffffff"
            />
          </View>

          {/* Show empty sections Switch */}
          <View style={[styles.switchRow, { flexDirection: rowDir }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.switchLabel, { color: theme.text, textAlign }]}>
                {t('show_empty_sections')}
              </Text>
              <Text style={[styles.switchHint, { color: theme.textSecondary, textAlign }]}>
                {isRtl
                  ? 'הצג גם נושאים ללא קבצים או מטלות בעמוד הקורס'
                  : 'Include sections with no files or assignments in Course Detail'}
              </Text>
            </View>
            <Switch
              value={settings.showEmptySections}
              onValueChange={(v) => updateSetting('showEmptySections', v).catch(() => {})}
              trackColor={{ false: theme.border, true: theme.primary }}
              thumbColor="#ffffff"
            />
          </View>
        </View>

        {/* 3. Panopto (Beta) */}
        <View
          style={[
            styles.card,
            { backgroundColor: theme.backgroundElement, borderColor: theme.border },
          ]}
        >
          <View style={[styles.cardHeaderBetween, { flexDirection: rowDir }]}>
            <View style={[styles.cardTitleRow, { flexDirection: rowDir }]}>
              <VideoIcon size={18} color={theme.primary} />
              <Text style={[styles.cardTitle, { color: theme.text, textAlign }]}>
                {t('panopto_settings_title')}
              </Text>
            </View>
            <View
              style={[
                styles.betaBadge,
                { backgroundColor: `${theme.primary}1e`, borderColor: `${theme.primary}44` },
              ]}
            >
              <Text style={[styles.betaBadgeText, { color: theme.primary }]}>
                {t('panopto_beta_badge')}
              </Text>
            </View>
          </View>

          <View style={[styles.switchRow, { flexDirection: rowDir }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.switchLabel, { color: theme.text, textAlign }]}>
                {t('panopto_enable_label')}
              </Text>
            </View>
            <Switch
              value={settings.panoptoEnabled}
              onValueChange={(v) => updateSetting('panoptoEnabled', v).catch(() => {})}
              trackColor={{ false: theme.border, true: theme.primary }}
              thumbColor="#ffffff"
            />
          </View>

          <View style={[styles.switchRow, { flexDirection: rowDir }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.switchLabel, { color: theme.text, textAlign }]}>
                {t('panopto_override_toggle')}
              </Text>
            </View>
            <Switch
              value={settings.showPanoptoFolderOverride}
              onValueChange={(v) => updateSetting('showPanoptoFolderOverride', v).catch(() => {})}
              trackColor={{ false: theme.border, true: theme.primary }}
              thumbColor="#ffffff"
            />
          </View>

          <Pressable
            onPress={() => setPanoptoSsoVisible(true)}
            style={({ pressed }) => [
              styles.secondaryActionBtn,
              {
                backgroundColor: theme.background,
                borderColor: theme.border,
                flexDirection: rowDir,
                opacity: pressed ? 0.75 : 1,
              },
            ]}
          >
            <VideoIcon size={16} color={theme.primary} />
            <Text style={[styles.secondaryActionText, { color: theme.text }]}>
              {t('panopto_sso_btn')}
            </Text>
          </Pressable>
        </View>

        {/* 4. Google Tasks Sync */}
        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.backgroundElement,
              borderColor: theme.border,
            },
          ]}
        >
          <View style={[styles.cardHeaderBetween, { flexDirection: rowDir }]}>
            <View style={[styles.cardTitleRow, { flexDirection: rowDir }]}>
              <SparklesIcon size={18} color={theme.primary} />
              <Text style={[styles.cardTitle, { color: theme.text, textAlign }]}>
                {t('google_tasks_sync_title')}
              </Text>
            </View>
            {settings.googleTasksEnabled ? (
              <View
                style={[
                  styles.statusBadge,
                  {
                    backgroundColor: hasGoogleToken ? `${theme.secondary}1f` : `${theme.danger}1f`,
                    borderColor: hasGoogleToken ? `${theme.secondary}44` : `${theme.danger}44`,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.statusBadgeText,
                    { color: hasGoogleToken ? theme.secondary : theme.danger },
                  ]}
                >
                  {hasGoogleToken
                    ? isRtl
                      ? 'מחובר'
                      : 'Connected'
                    : isRtl
                      ? 'לא מחובר'
                      : 'Not connected'}
                </Text>
              </View>
            ) : null}
          </View>

          <View style={[styles.switchRow, { flexDirection: rowDir }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.switchLabel, { color: theme.text, textAlign }]}>
                {t('google_tasks_sync_title')}
              </Text>
              <Text style={[styles.switchHint, { color: theme.textSecondary, textAlign }]}>
                {t('google_tasks_sync_desc')}
              </Text>
            </View>
            <Switch
              value={settings.googleTasksEnabled}
              onValueChange={(v) => updateSetting('googleTasksEnabled', v).catch(() => {})}
              trackColor={{ false: theme.border, true: theme.primary }}
              thumbColor="#ffffff"
            />
          </View>

          <Text style={[styles.subLabel, { color: theme.textSecondary, textAlign }]}>
            {t('google_tasks_list_name_label')}
          </Text>
          <TextInput
            value={listNameInput}
            onChangeText={(txt) => {
              setListNameDraft(txt);
            }}
            onBlur={() => {
              if (listNameDraft !== null) {
                const committed = listNameDraft.trim() || 'University';
                updateSetting('googleTasksListName', committed).catch(() => {});
                setListNameDraft(null);
              }
            }}
            onSubmitEditing={() => {
              if (listNameDraft !== null) {
                const committed = listNameDraft.trim() || 'University';
                updateSetting('googleTasksListName', committed).catch(() => {});
                setListNameDraft(null);
              }
            }}
            placeholder="University"
            placeholderTextColor={theme.placeholder}
            style={[
              styles.textInput,
              {
                backgroundColor: theme.background,
                borderColor: theme.border,
                color: theme.text,
                textAlign,
              },
            ]}
          />

          <View style={[styles.switchRow, { flexDirection: rowDir }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.switchLabel, { color: theme.text, textAlign }]}>
                {t('sync_without_deadline_title')}
              </Text>
              <Text style={[styles.switchHint, { color: theme.textSecondary, textAlign }]}>
                {t('sync_without_deadline_desc')}
              </Text>
            </View>
            <Switch
              value={settings.syncWithoutDeadline}
              onValueChange={(v) => updateSetting('syncWithoutDeadline', v).catch(() => {})}
              trackColor={{ false: theme.border, true: theme.primary }}
              thumbColor="#ffffff"
            />
          </View>

          <View style={[styles.btnRow, { flexDirection: rowDir }]}>
            <Pressable
              onPress={() => handleAuthAndSyncGoogle().catch(() => {})}
              disabled={googleBusy}
              style={({ pressed }) => [
                styles.primaryActionBtn,
                {
                  flex: 1,
                  backgroundColor: theme.primary,
                  flexDirection: rowDir,
                  opacity: pressed || googleBusy ? 0.75 : 1,
                },
              ]}
            >
              {googleBusy ? (
                <ActivityIndicator size="small" color={theme.onPrimary} />
              ) : (
                <CheckIcon size={15} color={theme.onPrimary} />
              )}
              <Text style={[styles.primaryActionText, { color: theme.onPrimary }]}>
                {t('auth_sync_google')}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => handleManualGoogleSync().catch(() => {})}
              disabled={googleBusy}
              style={({ pressed }) => [
                styles.secondaryActionBtn,
                {
                  flex: 1,
                  backgroundColor: theme.background,
                  borderColor: theme.border,
                  flexDirection: rowDir,
                  opacity: pressed || googleBusy ? 0.75 : 1,
                },
              ]}
            >
              <RefreshIcon size={15} color={theme.primary} />
              <Text style={[styles.secondaryActionText, { color: theme.text }]}>
                {t('manual_sync_btn')}
              </Text>
            </Pressable>
          </View>

          {googleStatusMsg ? (
            <Text style={[styles.statusNote, { color: theme.secondary, textAlign }]}>
              {googleStatusMsg}
            </Text>
          ) : null}

          {/* Collapsible Advanced Google OAuth Settings */}
          <Pressable
            onPress={() => setShowAdvancedGoogle((v) => !v)}
            style={[styles.advancedToggle, { flexDirection: rowDir }]}
          >
            {showAdvancedGoogle ? (
              <ChevronUpIcon size={15} color={theme.textSecondary} />
            ) : (
              <ChevronDownIcon size={15} color={theme.textSecondary} />
            )}
            <Text style={[styles.advancedToggleText, { color: theme.textSecondary }]}>
              {t('advanced_settings')}
            </Text>
          </Pressable>

          {showAdvancedGoogle ? (
            <View
              style={[
                styles.subBox,
                { backgroundColor: theme.background, borderColor: theme.border },
              ]}
            >
              <Text style={[styles.subLabel, { color: theme.textSecondary, textAlign }]}>
                {t('google_cloud_redirect_label')}
              </Text>
              <View style={[styles.redirectRow, { flexDirection: rowDir }]}>
                <View
                  style={[
                    styles.textInput,
                    {
                      flex: 1,
                      backgroundColor: theme.backgroundElement,
                      borderColor: theme.border,
                    },
                  ]}
                >
                  <Text
                    selectable
                    numberOfLines={2}
                    style={[styles.monoInput, { color: theme.textSecondary }]}
                  >
                    {effectiveRedirectUri}
                  </Text>
                </View>
                <Pressable
                  onPress={() => handleCopyRedirectUri().catch(() => {})}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.copyBtn,
                    {
                      backgroundColor: theme.backgroundElement,
                      borderColor: theme.border,
                      opacity: pressed ? 0.72 : 1,
                    },
                  ]}
                >
                  <Text style={[styles.copyBtnText, { color: theme.primary }]}>
                    {copiedRedirectNotice
                      ? isRtl
                        ? 'הועתק'
                        : 'Copied'
                      : isRtl
                        ? 'העתק'
                        : 'Copy'}
                  </Text>
                </Pressable>
              </View>

              <Text style={[styles.subLabel, { color: theme.textSecondary, textAlign }]}>
                {t('google_tasks_client_id_label')}
              </Text>
              <TextInput
                value={customClientId}
                onChangeText={handleSaveClientId}
                placeholder={DEFAULT_GOOGLE_CLIENT_ID}
                placeholderTextColor={theme.placeholder}
                autoCapitalize="none"
                autoCorrect={false}
                style={[
                  styles.textInput,
                  styles.monoInput,
                  {
                    backgroundColor: theme.backgroundElement,
                    borderColor: theme.border,
                    color: theme.text,
                  },
                ]}
              />

              <Text style={[styles.subLabel, { color: theme.textSecondary, textAlign }]}>
                {t('google_token_label')}
              </Text>
              <View style={[styles.btnRow, { flexDirection: rowDir }]}>
                <TextInput
                  value={manualTokenInput}
                  onChangeText={setManualTokenInput}
                  secureTextEntry
                  placeholder={isRtl ? 'הדבק אסימון גישה...' : 'Paste Google access token...'}
                  placeholderTextColor={theme.placeholder}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={[
                    styles.textInput,
                    styles.monoInput,
                    {
                      flex: 1,
                      backgroundColor: theme.backgroundElement,
                      borderColor: theme.border,
                      color: theme.text,
                    },
                  ]}
                />
                <Pressable
                  onPress={() => handleSaveManualToken().catch(() => {})}
                  disabled={!manualTokenInput.trim() || googleBusy}
                  style={[
                    styles.saveSmallBtn,
                    {
                      backgroundColor: manualTokenInput.trim()
                        ? theme.primary
                        : theme.backgroundSelected,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.saveSmallBtnText,
                      {
                        color: manualTokenInput.trim()
                          ? theme.onPrimary
                          : theme.textSecondary,
                      },
                    ]}
                  >
                    {t('save_token_btn')}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>

        {/* 5. Backup & Restore */}
        <View
          style={[
            styles.card,
            { backgroundColor: theme.backgroundElement, borderColor: theme.border },
          ]}
        >
          <View style={[styles.cardTitleRow, { flexDirection: rowDir }]}>
            <ShareIcon size={18} color={theme.primary} />
            <Text style={[styles.cardTitle, { color: theme.text, textAlign }]}>
              {t('config_backup_title')}
            </Text>
          </View>
          <Text style={[styles.cardDesc, { color: theme.textSecondary, textAlign }]}>
            {t('config_backup_desc')}
          </Text>

          <View style={[styles.btnRow, { flexDirection: rowDir }]}>
            <Pressable
              onPress={() => handleExportConfig().catch(() => {})}
              disabled={backupBusy}
              style={({ pressed }) => [
                styles.primaryActionBtn,
                {
                  flex: 1,
                  backgroundColor: theme.primary,
                  flexDirection: rowDir,
                  opacity: pressed || backupBusy ? 0.75 : 1,
                },
              ]}
            >
              <DownloadIcon size={15} color={theme.onPrimary} />
              <Text style={[styles.primaryActionText, { color: theme.onPrimary }]}>
                {t('export_config_btn')}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => handleImportConfig().catch(() => {})}
              disabled={backupBusy}
              style={({ pressed }) => [
                styles.secondaryActionBtn,
                {
                  flex: 1,
                  backgroundColor: theme.background,
                  borderColor: theme.border,
                  flexDirection: rowDir,
                  opacity: pressed || backupBusy ? 0.75 : 1,
                },
              ]}
            >
              <ShareIcon size={15} color={theme.primary} />
              <Text style={[styles.secondaryActionText, { color: theme.text }]}>
                {t('import_config_btn')}
              </Text>
            </Pressable>
          </View>

          {backupStatus ? (
            <Text
              style={[
                styles.statusNote,
                {
                  color: backupStatus.isError ? theme.danger : theme.secondary,
                  textAlign,
                },
              ]}
            >
              {backupStatus.text}
            </Text>
          ) : null}
        </View>

        {/* 6. Demo & Guided Tour */}
        <View
          style={[
            styles.card,
            { backgroundColor: theme.backgroundElement, borderColor: theme.border },
          ]}
        >
          <View style={[styles.cardTitleRow, { flexDirection: rowDir }]}>
            <FlaskIcon size={18} color={theme.primary} />
            <Text style={[styles.cardTitle, { color: theme.text, textAlign }]}>
              {isRtl ? 'מצב הדגמה וסיור מודרך' : 'Demo & Guided Tour'}
            </Text>
          </View>

          <View style={[styles.switchRow, { flexDirection: rowDir }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.switchLabel, { color: theme.text, textAlign }]}>
                {t('mock_course_toggle')}
              </Text>
              <Text style={[styles.switchHint, { color: theme.textSecondary, textAlign }]}>
                {isRtl
                  ? 'מוסיף את קורס הדגמה 9999 עם מטלות, תיקיות, זום ופנופטו'
                  : 'Injects sample course 9999 with assignments, folders, Zoom, and Panopto'}
              </Text>
            </View>
            <Switch
              value={hasMockCourse}
              disabled={mockToggleBusy}
              onValueChange={(v) => handleToggleMockCourse(v).catch(() => {})}
              trackColor={{ false: theme.border, true: theme.primary }}
              thumbColor="#ffffff"
            />
          </View>

          <Pressable
            onPress={handleTakeTour}
            style={({ pressed }) => [
              styles.secondaryActionBtn,
              {
                backgroundColor: theme.background,
                borderColor: theme.border,
                flexDirection: rowDir,
                opacity: pressed ? 0.75 : 1,
              },
            ]}
          >
            <TourIcon size={16} color={theme.primary} />
            <Text style={[styles.secondaryActionText, { color: theme.text }]}>
              {t('take_tour_btn')}
            </Text>
          </Pressable>
        </View>

        {/* 7. About & Privacy */}
        <View
          style={[
            styles.card,
            { backgroundColor: theme.backgroundElement, borderColor: theme.border },
          ]}
        >
          <View style={[styles.aboutHeroRow, { flexDirection: rowDir }]}>
            <Image
              source={require('@/assets/images/logo-glow.png')}
              style={styles.aboutLogo}
              resizeMode="contain"
            />
            <View style={{ flex: 1, gap: 3 }}>
              <View style={[styles.aboutTitleLine, { flexDirection: rowDir }]}>
                <Text style={[styles.aboutBrandTitle, { color: theme.text }]}>Noodle</Text>
                <View
                  style={[
                    styles.versionBadge,
                    { backgroundColor: `${theme.primary}1a`, borderColor: `${theme.primary}44` },
                  ]}
                >
                  <Text style={[styles.versionBadgeText, { color: theme.primary }]}>
                    v4.1 • Mobile 1.0.0
                  </Text>
                </View>
              </View>
              <Text style={[styles.cardDesc, { color: theme.textSecondary, textAlign }]}>
                {t('developed_by')}
              </Text>
              <Text style={[styles.switchHint, { color: theme.textSecondary, textAlign }]}>
                {t('support_email_label')}
              </Text>
            </View>
          </View>

          <View style={[styles.linksGrid, { flexDirection: rowDir }]}>
            <Pressable
              onPress={() => openMoodleUrl('https://noodle.mantin.dev/')}
              style={({ pressed }) => [
                styles.aboutLinkBtn,
                {
                  backgroundColor: theme.background,
                  borderColor: theme.border,
                  flexDirection: rowDir,
                  opacity: pressed ? 0.75 : 1,
                },
              ]}
            >
              <View style={[styles.aboutLinkIconWrap, { backgroundColor: '#38bdf822' }]}>
                <LinkIcon size={14} color="#38bdf8" />
              </View>
              <Text style={[styles.aboutLinkText, { color: theme.text }]}>noodle.mantin.dev</Text>
              <ExternalLinkIcon size={12} color={theme.textSecondary} />
            </Pressable>

            <Pressable
              onPress={() =>
                openMoodleUrl(
                  'https://chromewebstore.google.com/detail/noodle/nelflkccefbdpnaphjabcgkpakhdoope'
                )
              }
              style={({ pressed }) => [
                styles.aboutLinkBtn,
                {
                  backgroundColor: theme.background,
                  borderColor: theme.border,
                  flexDirection: rowDir,
                  opacity: pressed ? 0.75 : 1,
                },
              ]}
            >
              <View style={[styles.aboutLinkIconWrap, { backgroundColor: '#f59e0b22' }]}>
                <StarIcon size={14} color="#f59e0b" />
              </View>
              <Text style={[styles.aboutLinkText, { color: theme.text }]}>
                {t('review_extension_label')}
              </Text>
              <ExternalLinkIcon size={12} color={theme.textSecondary} />
            </Pressable>

            <Pressable
              onPress={() => openMoodleUrl('https://github.com/duck-5/Noodle')}
              style={({ pressed }) => [
                styles.aboutLinkBtn,
                {
                  backgroundColor: theme.background,
                  borderColor: theme.border,
                  flexDirection: rowDir,
                  opacity: pressed ? 0.75 : 1,
                },
              ]}
            >
              <View style={[styles.aboutLinkIconWrap, { backgroundColor: '#a855f722' }]}>
                <CourseIcon size={14} color="#a855f7" />
              </View>
              <Text style={[styles.aboutLinkText, { color: theme.text }]}>
                {t('github_repo_link')}
              </Text>
              <ExternalLinkIcon size={12} color={theme.textSecondary} />
            </Pressable>

            <Pressable
              onPress={() => openMoodleUrl('https://github.com/duck-5/Noodle/issues')}
              style={({ pressed }) => [
                styles.aboutLinkBtn,
                {
                  backgroundColor: theme.background,
                  borderColor: theme.border,
                  flexDirection: rowDir,
                  opacity: pressed ? 0.75 : 1,
                },
              ]}
            >
              <View style={[styles.aboutLinkIconWrap, { backgroundColor: '#f43f5e22' }]}>
                <InfoIcon size={14} color="#f43f5e" />
              </View>
              <Text style={[styles.aboutLinkText, { color: theme.text }]}>
                {t('github_issues_link')}
              </Text>
              <ExternalLinkIcon size={12} color={theme.textSecondary} />
            </Pressable>

            <Pressable
              onPress={() => Linking.openURL('mailto:noodle.d3v@gmail.com').catch(() => {})}
              style={({ pressed }) => [
                styles.aboutLinkBtn,
                {
                  backgroundColor: theme.background,
                  borderColor: theme.border,
                  flexDirection: rowDir,
                  opacity: pressed ? 0.75 : 1,
                },
              ]}
            >
              <View style={[styles.aboutLinkIconWrap, { backgroundColor: '#10b98122' }]}>
                <ShareIcon size={14} color="#10b981" />
              </View>
              <Text style={[styles.aboutLinkText, { color: theme.text }]}>
                {isRtl ? 'דוא״ל לתמיכה' : 'Email Support'}
              </Text>
              <ExternalLinkIcon size={12} color={theme.textSecondary} />
            </Pressable>
          </View>

          {/* Expandable Privacy & Features Summary */}
          <Pressable
            onPress={() => setAboutExpanded((v) => !v)}
            style={[
              styles.privacyHeaderBtn,
              {
                backgroundColor: theme.background,
                borderColor: theme.border,
                flexDirection: rowDir,
              },
            ]}
          >
            <View style={[styles.cardTitleRow, { flexDirection: rowDir }]}>
              <ShieldIcon size={16} color={theme.secondary} />
              <Text style={[styles.privacyHeaderTitle, { color: theme.text }]}>
                {isRtl ? 'פרטיות ויכולות מרכזיות' : 'Privacy & Key Features'}
              </Text>
            </View>
            {aboutExpanded ? (
              <ChevronUpIcon size={16} color={theme.textSecondary} />
            ) : (
              <ChevronDownIcon size={16} color={theme.textSecondary} />
            )}
          </Pressable>

          {aboutExpanded ? (
            <View
              style={[
                styles.subBox,
                { backgroundColor: theme.background, borderColor: theme.border },
              ]}
            >
              <View style={[styles.bulletRow, { flexDirection: rowDir }]}>
                <ShieldIcon size={14} color={theme.secondary} />
                <Text style={[styles.bulletText, { color: theme.textSecondary, textAlign }]}>
                  {isRtl
                    ? '100% מקומי ומבוזר: האפליקציה מתקשרת ישירות מול שרתי TAU ללא שרת מתווך, ללא טלמטריה וללא מעקב.'
                    : '100% Client-Only & Decentralized: Communicates directly with TAU servers without any proxy, analytics, or telemetry.'}
                </Text>
              </View>
              <View style={[styles.bulletRow, { flexDirection: rowDir }]}>
                <SparklesIcon size={14} color={theme.primary} />
                <Text style={[styles.bulletText, { color: theme.textSecondary, textAlign }]}>
                  {isRtl
                    ? 'סנכרון דו-כיווני ל-Google Tasks, זיהוי מפגשי זום פעילים, מעקב הקלטות Panopto והורדת תיקיות כ-ZIP.'
                    : '2-way Google Tasks sync, live Zoom detection, Panopto lecture tracking, offline file caching, and ZIP folder downloads.'}
                </Text>
              </View>
            </View>
          ) : null}
        </View>

        {/* 8. Account / Disconnect */}
        <View
          style={[
            styles.card,
            { backgroundColor: theme.backgroundElement, borderColor: theme.border },
          ]}
        >
          <View style={[styles.cardTitleRow, { flexDirection: rowDir }]}>
            <UserIcon size={18} color={theme.primary} />
            <Text style={[styles.cardTitle, { color: theme.text, textAlign }]}>
              {t('account_credits_title')}
            </Text>
          </View>

          <View
            style={[
              styles.accountMetaBox,
              { backgroundColor: theme.background, borderColor: theme.border },
            ]}
          >
            {userFullname ? (
              <Text style={[styles.accountUserName, { color: theme.text, textAlign }]}>
                {userFullname}
              </Text>
            ) : null}
            <Text style={[styles.switchHint, { color: theme.textSecondary, textAlign }]}>
              {t('last_synced')}: {formattedLastSynced}
            </Text>
          </View>

          <Pressable
            onPress={handleDisconnectPress}
            disabled={disconnecting}
            style={({ pressed }) => [
              styles.dangerBtn,
              {
                backgroundColor: `${theme.danger}14`,
                borderColor: theme.danger,
                flexDirection: rowDir,
                opacity: pressed || disconnecting ? 0.75 : 1,
              },
            ]}
          >
            <LogoutIcon size={16} color={theme.danger} />
            <Text style={[styles.dangerBtnText, { color: theme.danger }]}>
              {t('disconnect_account')}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
      </KeyboardAvoidingView>

      <ManageCoursesModal
        visible={manageCoursesVisible}
        onClose={() => setManageCoursesVisible(false)}
      />

      <SsoWebViewModal
        visible={panoptoSsoVisible}
        mode="panopto"
        onClose={() => setPanoptoSsoVisible(false)}
        onPanoptoSuccess={async () => {
          setPanoptoSsoVisible(false);
          await updateSetting('panoptoEnabled', true);
          triggerSync({ manual: true }).catch(() => {});
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  centeredMax: {
    maxWidth: 1120,
    alignSelf: 'center',
    width: '100%',
  },
  centeredPortrait: {
    maxWidth: 680,
    alignSelf: 'center',
    width: '100%',
  },
  header: {
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerInner: {
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitleRow: {
    alignItems: 'center',
    gap: 10,
  },
  iconBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 42,
    gap: 14,
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  cardHeaderBetween: {
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  cardTitleRow: {
    alignItems: 'center',
    gap: 8,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  cardDesc: {
    fontSize: 13,
    lineHeight: 19,
  },
  subLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
  pillGroup: {
    flexWrap: 'wrap',
    gap: 8,
  },
  choicePill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  choicePillText: {
    fontSize: 13,
    fontWeight: '700',
  },
  themeGrid: {
    flexWrap: 'wrap',
    gap: 8,
  },
  themeCardBtn: {
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    minWidth: '47%',
    flexGrow: 1,
  },
  themeCardText: {
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  swatchRow: {
    alignItems: 'center',
    gap: 3,
    flexShrink: 0,
  },
  swatchDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: StyleSheet.hairlineWidth,
  },
  subBox: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    gap: 10,
  },
  stepperRow: {
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  stepperLabel: {
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  stepperControls: {
    alignItems: 'center',
    gap: 6,
  },
  stepperBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnText: {
    fontSize: 16,
    fontWeight: '700',
  },
  stepperInput: {
    width: 48,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '700',
    paddingVertical: 0,
  },
  stepperSuffix: {
    fontSize: 12,
    fontWeight: '600',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 4,
  },
  switchRow: {
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 4,
  },
  switchLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  switchHint: {
    fontSize: 12,
    marginTop: 2,
    lineHeight: 17,
  },
  betaBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  betaBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  statusBadge: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  btnRow: {
    gap: 10,
    flexWrap: 'wrap',
  },
  primaryActionBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  primaryActionText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  secondaryActionBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
  },
  secondaryActionText: {
    fontSize: 13,
    fontWeight: '700',
  },
  textInput: {
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 13,
  },
  monoInput: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 12,
    textAlign: 'left',
  },
  statusNote: {
    fontSize: 12,
    fontWeight: '600',
  },
  advancedToggle: {
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  advancedToggleText: {
    fontSize: 13,
    fontWeight: '600',
  },
  redirectRow: {
    alignItems: 'center',
    gap: 8,
  },
  copyBtn: {
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
  },
  copyBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  saveSmallBtn: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 8,
    justifyContent: 'center',
  },
  saveSmallBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  aboutHeroRow: {
    alignItems: 'center',
    gap: 12,
  },
  aboutLogo: {
    width: 52,
    height: 52,
    borderRadius: 12,
  },
  aboutTitleLine: {
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  aboutBrandTitle: {
    fontSize: 19,
    fontWeight: '800',
  },
  versionBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  versionBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  linksGrid: {
    flexWrap: 'wrap',
    gap: 8,
  },
  aboutLinkBtn: {
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
  },
  aboutLinkIconWrap: {
    width: 24,
    height: 24,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aboutLinkText: {
    fontSize: 12,
    fontWeight: '600',
  },
  privacyHeaderBtn: {
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  privacyHeaderTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  bulletRow: {
    alignItems: 'flex-start',
    gap: 8,
  },
  bulletText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  accountMetaBox: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    gap: 4,
  },
  accountUserName: {
    fontSize: 14,
    fontWeight: '700',
  },
  dangerBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 11,
    borderWidth: 1,
  },
  dangerBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
});
