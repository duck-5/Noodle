import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  Switch,
  Alert,
} from 'react-native';
import { setMoodleToken } from '../services/backgroundSync';
import { clearCredentials } from '../services/auth';
import { getGoogleAccessToken, setGoogleAccessToken, performGoogleTasksSync } from '../services/googleTasks';
import { getDb, getPreference, setPreference } from '../services/database';
import { t, getLanguage } from '../services/i18n';
import { useTheme } from '../hooks/use-theme';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

interface SettingsScreenProps {
  onDisconnect?: () => void;
  onSettingsChanged?: () => void;
}

export default function SettingsScreen({ onDisconnect, onSettingsChanged }: SettingsScreenProps) {
  const theme = useTheme();

  const [loading, setLoading] = useState<boolean>(false);
  const [googleTasksEnabled, setGoogleTasksEnabled] = useState<boolean>(false);
  const [googleListName, setGoogleListName] = useState<string>('Noodle');
  const [googleTokenInput, setGoogleTokenInput] = useState<string>('');
  const [googleStatus, setGoogleStatus] = useState<string | null>(null);
  const [lang, setLang] = useState<'he' | 'en'>('he');
  const [activeTheme, setActiveTheme] = useState<'system' | 'light' | 'dark' | 'noodle'>('system');

  const isRtl = lang === 'he';

  const loadSettings = async () => {
    try {
      const enabled = getPreference('google_tasks_enabled') === 'true';
      setGoogleTasksEnabled(enabled);

      const listName = getPreference('google_tasks_list_name') || 'Noodle';
      setGoogleListName(listName);

      const googleToken = await getGoogleAccessToken();
      if (googleToken) {
        setGoogleTokenInput(googleToken);
      }

      const activeLang = getLanguage();
      setLang(activeLang);

      const themeVal = getPreference('theme') || 'system';
      setActiveTheme(themeVal as any);
    } catch (e) {
      console.error('loadSettings error:', e);
    }
  };

  useEffect(() => {
    setTimeout(() => {
      loadSettings();
    }, 0);
  }, []);

  const handleUpdateTheme = (tChoice: 'system' | 'light' | 'dark' | 'noodle') => {
    try {
      setPreference('theme', tChoice);
      setActiveTheme(tChoice);
      onSettingsChanged?.();
      Alert.alert(
        lang === 'he' ? 'ערכת הנושא שונתה' : 'Theme Changed',
        lang === 'he'
          ? 'אנא הפעל מחדש את האפליקציה להחלת ערכת הנושא במלוא עמודי האפליקציה.'
          : 'Please restart the app to apply the theme change fully.'
      );
    } catch (e) {
      console.error('handleUpdateTheme error:', e);
    }
  };

  const handleToggleGoogleTasks = (val: boolean) => {
    try {
      setGoogleTasksEnabled(val);
      setPreference('google_tasks_enabled', val ? 'true' : 'false');
      onSettingsChanged?.();
    } catch (e) {
      console.error(e);
    }
  };

  const handleUpdateListName = (text: string) => {
    try {
      setGoogleListName(text);
      setPreference('google_tasks_list_name', text);
      onSettingsChanged?.();
    } catch (e) {
      console.error(e);
    }
  };

  const handleUpdateLanguage = (l: 'he' | 'en') => {
    try {
      setPreference('language', l);
      setLang(l);
      onSettingsChanged?.();
      Alert.alert(l === 'he' ? 'השפה שונתה' : 'Language Changed', l === 'he' ? 'אנא הפעל מחדש את האפליקציה להחלת השינויים במלואם.' : 'Please restart the app to apply language changes fully.');
    } catch (e) {
      console.error(e);
    }
  };

  const handleSaveGoogleToken = async () => {
    setLoading(true);
    setGoogleStatus(null);
    try {
      if (googleTokenInput.trim()) {
        await setGoogleAccessToken(googleTokenInput.trim());
        setGoogleStatus(t('save_token_btn') + ' ' + (lang === 'he' ? 'הצליח' : 'success'));
      } else {
        await setGoogleAccessToken(null);
        setGoogleStatus(lang === 'he' ? 'האסימון נמחק' : 'Token cleared');
      }
      onSettingsChanged?.();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleManualGoogleSync = async () => {
    setLoading(true);
    setGoogleStatus(lang === 'he' ? 'מסנכרן משימות...' : 'Synchronizing Tasks...');
    try {
      const db = getDb();
      const assignments = db.getAllSync<any>('SELECT * FROM assignments');
      const res = await performGoogleTasksSync(assignments);
      setGoogleStatus(res.message || 'Sync completed.');
    } catch (e: any) {
      setGoogleStatus(`Sync failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    Alert.alert(
      lang === 'he' ? 'התנתק מהחשבון' : 'Disconnect Account',
      lang === 'he' ? 'האם אתה בטוח שברצונך להתנתק מחשבון המודל ולמחוק את כל המידע השמור מקומית?' : 'Are you sure you want to disconnect your Moodle account and erase all local cached data?',
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: lang === 'he' ? 'התנתק' : 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            try {
              // Clear secure tokens and saved SSO credentials
              await setMoodleToken(null);
              await setGoogleAccessToken(null);
              await clearCredentials();

              // Clear SQLite tables
              const db = getDb();
              db.execSync(`
                DELETE FROM tracked_courses;
                DELETE FROM assignments;
                DELETE FROM files;
                DELETE FROM meetings;
                DELETE FROM preferences;
              `);

              if (onDisconnect) {
                onDisconnect();
              } else {
                Alert.alert(lang === 'he' ? 'התנתק בהצלחה' : 'Disconnected', lang === 'he' ? 'הנתונים נמחקו. הפעל מחדש את האפליקציה כדי להתחבר.' : 'Account data has been successfully cleared. Restart the app to log in again.');
              }
            } catch (e: any) {
              Alert.alert('Error', e.message);
            }
          },
        },
      ]
    );
  };

  const handleExportConfig = async () => {
    setLoading(true);
    try {
      const db = getDb();
      
      const courseRows = db.getAllSync<{ moodle_id: number }>('SELECT moodle_id FROM tracked_courses WHERE is_active = 1');
      const trackedCourseIds = courseRows.map(r => r.moodle_id);
      
      const coursesColorMap: Record<number, string> = {};
      const coursesCustomNames: Record<number, string> = {};
      
      const allCourses = db.getAllSync<{ moodle_id: number; name: string; color: string }>('SELECT moodle_id, name, color FROM tracked_courses');
      for (const course of allCourses) {
        if (course.color) {
          coursesColorMap[course.moodle_id] = course.color;
        }
        if (course.name) {
          coursesCustomNames[course.moodle_id] = course.name;
        }
      }
      
      const gTasksEnabled = getPreference('google_tasks_enabled') === 'true';
      const gListName = getPreference('google_tasks_list_name') || 'Noodle';
      const themeVal = getPreference('theme') || 'system';
      const langVal = getPreference('language') || 'he';
      
      const config = {
        version: "TauTrackerConfig-v1",
        trackedCourseIds,
        settings: {
          googleTasksEnabled: gTasksEnabled,
          googleTasksListName: gListName,
          notificationsEnabled: true,
          coursesColorMap,
          coursesCustomNames,
          language: langVal,
          theme: themeVal
        }
      };

      const jsonString = JSON.stringify(config, null, 2);
      const fileUri = FileSystem.cacheDirectory + `tau_tracker_config_${new Date().toISOString().slice(0, 10)}.json`;
      
      await FileSystem.writeAsStringAsync(fileUri, jsonString, { encoding: FileSystem.EncodingType.UTF8 });
      
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri);
      } else {
        Alert.alert('Sharing Unavailable', 'Sharing is not supported on this platform.');
      }
    } catch (e: any) {
      Alert.alert('Export Failed', e.message || 'An error occurred during configuration export.');
    } finally {
      setLoading(false);
    }
  };

  const handleImportConfig = async () => {
    setLoading(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: false,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        setLoading(false);
        return;
      }

      const fileUri = result.assets[0].uri;
      let content = '';
      
      // Try multiple methods to read the file content to bypass any permission or sandbox limits
      try {
        // Method 1: Copy picked URI to app cache root, read it, and delete temp file
        const tempPath = FileSystem.cacheDirectory + 'temp_import_config.json';
        await FileSystem.copyAsync({
          from: fileUri,
          to: tempPath,
        });
        content = await FileSystem.readAsStringAsync(tempPath);
        try {
          await FileSystem.deleteAsync(tempPath, { idempotent: true });
        } catch (cleanupErr) {
          console.warn('Failed to delete temp config file:', cleanupErr);
        }
      } catch (copyReadError: any) {
        console.warn('Method 1 (copy to cache root) failed:', copyReadError);
        try {
          // Method 2: Direct read with decodeURIComponent
          const decodedUri = decodeURIComponent(fileUri);
          content = await FileSystem.readAsStringAsync(decodedUri);
        } catch (directReadError1: any) {
          console.warn('Method 2 (direct read decoded URI) failed:', directReadError1);
          try {
            // Method 3: Direct read with original URI
            content = await FileSystem.readAsStringAsync(fileUri);
          } catch (directReadError2: any) {
            console.warn('Method 3 (direct read original URI) failed:', directReadError2);
            try {
              // Method 4: Fetch original URI
              const response = await fetch(fileUri);
              content = await response.text();
            } catch (fetchError1: any) {
              console.warn('Method 4 (fetch original URI) failed:', fetchError1);
              try {
                // Method 5: Fetch decoded URI
                const response = await fetch(decodeURIComponent(fileUri));
                content = await response.text();
              } catch (fetchError2: any) {
                console.error('All methods to read selected file failed.');
                throw new Error(
                  (lang === 'he' ? 'שגיאה בקריאת הקובץ:' : 'Error reading file:') +
                  `\n- ${copyReadError.message || copyReadError}` +
                  `\n- ${directReadError1.message || directReadError1}` +
                  `\n- ${directReadError2.message || directReadError2}` +
                  `\n- ${fetchError1.message || fetchError1}` +
                  `\n- ${fetchError2.message || fetchError2}`
                );
              }
            }
          }
        }
      }

      let data: any;
      try {
        data = JSON.parse(content);
      } catch (jsonErr: any) {
        throw new Error(
          (lang === 'he' ? 'הקובץ אינו בפורמט JSON תקין: ' : 'File is not a valid JSON: ') +
          (jsonErr.message || String(jsonErr))
        );
      }

      // Check version and required fields (with informative message)
      if (!data.trackedCourseIds || !data.settings) {
        const foundKeys = Object.keys(data || {}).join(', ');
        throw new Error(
          (lang === 'he' 
            ? 'קובץ תצורה לא תקין. הקובץ חייב להכיל הגדרות וקורסים.' 
            : 'Invalid configuration file. Must contain settings and trackedCourseIds.') +
          ` (Keys: ${foundKeys || 'none'})`
        );
      }

      const db = getDb();
      
      db.withTransactionSync(() => {
        if (data.settings.theme) {
          setPreference('theme', data.settings.theme);
        }
        if (data.settings.language) {
          setPreference('language', data.settings.language);
        }
        if (data.settings.googleTasksEnabled !== undefined) {
          setPreference('google_tasks_enabled', data.settings.googleTasksEnabled ? 'true' : 'false');
        }
        if (data.settings.googleTasksListName) {
          setPreference('google_tasks_list_name', data.settings.googleTasksListName);
        }

        const importedTrackedIds = new Set<number>(data.trackedCourseIds);
        
        db.runSync('UPDATE tracked_courses SET is_active = 0');
        
        for (const moodleId of importedTrackedIds) {
          const color = data.settings.coursesColorMap?.[moodleId] || '#6366f1';
          const name = data.settings.coursesCustomNames?.[moodleId] || `Course ${moodleId}`;
          
          const existing = db.getFirstSync<{ moodle_id: number }>('SELECT moodle_id FROM tracked_courses WHERE moodle_id = ?', [moodleId]);
          
          if (existing) {
            db.runSync(
              'UPDATE tracked_courses SET is_active = 1, color = ?, name = ? WHERE moodle_id = ?',
              [color, name, moodleId]
            );
          } else {
            db.runSync(
              'INSERT INTO tracked_courses (moodle_id, name, color, is_active) VALUES (?, ?, ?, 1)',
              [moodleId, name, color]
            );
          }
        }
      });

      setGoogleTasksEnabled(data.settings.googleTasksEnabled ?? false);
      setGoogleListName(data.settings.googleTasksListName ?? 'Noodle');
      setLang(data.settings.language ?? 'he');
      setActiveTheme(data.settings.theme ?? 'system');
      onSettingsChanged?.();

      Alert.alert(
        t('config_backup_title'),
        t('import_success') + '\n' + (lang === 'he' ? 'אנא הפעל מחדש את האפליקציה להחלת שינויי שפה/ערכת נושא.' : 'Please restart the app to apply language/theme changes fully.')
      );
    } catch (e: any) {
      Alert.alert(t('import_failed'), e.message || 'An error occurred during import.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <Text style={[styles.headerTitle, { color: theme.text, textAlign: isRtl ? 'right' : 'left' }]}>{t('settings')}</Text>
      </View>

      <ScrollView style={styles.scroll}>
        {/* Language Selection */}
        <View style={[styles.section, { backgroundColor: theme.backgroundElement, marginBottom: 20 }]}>
          <Text style={[styles.sectionTitle, { color: theme.text, textAlign: isRtl ? 'right' : 'left' }]}>{t('language_label')}</Text>
          <View style={[styles.row, { flexDirection: isRtl ? 'row-reverse' : 'row', justifyContent: 'flex-start', gap: 10 }]}>
            <Pressable
              style={[
                styles.langBtn,
                { backgroundColor: lang === 'he' ? theme.primary : 'transparent', borderColor: theme.primary, borderWidth: 1 }
              ]}
              onPress={() => handleUpdateLanguage('he')}
            >
              <Text style={{ color: lang === 'he' ? '#ffffff' : theme.text, fontWeight: 'bold' }}>עברית</Text>
            </Pressable>
            <Pressable
              style={[
                styles.langBtn,
                { backgroundColor: lang === 'en' ? theme.primary : 'transparent', borderColor: theme.primary, borderWidth: 1 }
              ]}
              onPress={() => handleUpdateLanguage('en')}
            >
              <Text style={{ color: lang === 'en' ? '#ffffff' : theme.text, fontWeight: 'bold' }}>English</Text>
            </Pressable>
          </View>
        </View>

        {/* Theme Selection */}
        <View style={[styles.section, { backgroundColor: theme.backgroundElement, marginBottom: 20 }]}>
          <Text style={[styles.sectionTitle, { color: theme.text, textAlign: isRtl ? 'right' : 'left' }]}>
            {lang === 'he' ? 'ערכת נושא' : 'Theme'}
          </Text>
          <View style={[styles.row, { flexDirection: isRtl ? 'row-reverse' : 'row', justifyContent: 'flex-start', flexWrap: 'wrap', gap: 10 }]}>
            {(['system', 'light', 'dark', 'noodle'] as const).map((tChoice) => (
              <Pressable
                key={tChoice}
                style={[
                  styles.langBtn,
                  {
                    backgroundColor: activeTheme === tChoice ? theme.primary : 'transparent',
                    borderColor: theme.primary,
                    borderWidth: 1,
                  }
                ]}
                onPress={() => handleUpdateTheme(tChoice)}
              >
                <Text style={{ color: activeTheme === tChoice ? '#ffffff' : theme.text, fontWeight: 'bold' }}>
                  {tChoice === 'system' ? (lang === 'he' ? 'ברירת מחדל' : 'System') :
                   tChoice === 'light' ? (lang === 'he' ? 'בהיר' : 'Light') :
                   tChoice === 'dark' ? (lang === 'he' ? 'כהה' : 'Dark') :
                   (lang === 'he' ? 'נודל 🍜' : 'Noodle 🍜')}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Google Tasks Settings */}
        <View style={[styles.section, { backgroundColor: theme.backgroundElement }]}>
          <Text style={[styles.sectionTitle, { color: theme.text, textAlign: isRtl ? 'right' : 'left' }]}>{t('google_tasks_sync_title')}</Text>
          <View style={[styles.row, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowLabel, { color: theme.text, textAlign: isRtl ? 'right' : 'left' }]}>{lang === 'he' ? 'סנכרן משימות מהמודל' : 'Sync Moodle Assignments'}</Text>
              <Text style={{ color: theme.textSecondary, fontSize: 11, textAlign: isRtl ? 'right' : 'left' }}>
                {t('google_tasks_sync_desc')}
              </Text>
            </View>
            <Switch value={googleTasksEnabled} onValueChange={handleToggleGoogleTasks} />
          </View>

          {googleTasksEnabled && (
            <View style={[styles.subsettings, { borderTopColor: theme.border }]}>
              <Text style={[styles.label, { color: theme.textSecondary, textAlign: isRtl ? 'right' : 'left' }]}>{t('google_tasks_list_name_label')}</Text>
              <TextInput
                style={[styles.input, { borderColor: theme.backgroundSelected, color: theme.text, textAlign: isRtl ? 'right' : 'left' }]}
                value={googleListName}
                onChangeText={handleUpdateListName}
                placeholder="Noodle"
                placeholderTextColor={theme.placeholder}
              />

              <Text style={[styles.label, { color: theme.textSecondary, marginTop: 8, textAlign: isRtl ? 'right' : 'left' }]}>{t('google_token_label')}</Text>
              <TextInput
                style={[styles.input, { borderColor: theme.backgroundSelected, color: theme.text, textAlign: isRtl ? 'right' : 'left' }]}
                value={googleTokenInput}
                onChangeText={setGoogleTokenInput}
                placeholder={lang === 'he' ? 'הדבק אסימון OAuth של גוגל...' : 'Paste Google OAuth token...'}
                placeholderTextColor={theme.placeholder}
                secureTextEntry
              />

              <View style={[styles.btnRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                <Pressable style={[styles.secondaryBtn, { backgroundColor: theme.primary }]} onPress={handleSaveGoogleToken} disabled={loading}>
                  <Text style={styles.secondaryBtnText}>{t('save_token_btn')}</Text>
                </Pressable>

                <Pressable style={[styles.secondaryBtn, { backgroundColor: theme.primary }]} onPress={handleManualGoogleSync} disabled={loading}>
                  <Text style={styles.secondaryBtnText}>{t('sync_now')}</Text>
                </Pressable>
              </View>

              {googleStatus && <Text style={[styles.statusText, { textAlign: isRtl ? 'right' : 'left' }]}>{googleStatus}</Text>}
            </View>
          )}
        </View>

        {/* Backup & Restore */}
        <View style={[styles.section, { backgroundColor: theme.backgroundElement, marginTop: 24 }]}>
          <Text style={[styles.sectionTitle, { color: theme.text, textAlign: isRtl ? 'right' : 'left' }]}>
            {t('config_backup_title')}
          </Text>
          <Text style={{ color: theme.textSecondary, fontSize: 13, marginBottom: 16, textAlign: isRtl ? 'right' : 'left' }}>
            {t('config_backup_desc')}
          </Text>
          <View style={[styles.btnRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
            <Pressable style={[styles.secondaryBtn, { backgroundColor: theme.primary }]} onPress={handleExportConfig} disabled={loading}>
              <Text style={styles.secondaryBtnText}>📥 {t('export_config_btn')}</Text>
            </Pressable>
            <Pressable style={[styles.secondaryBtn, { backgroundColor: theme.primary }]} onPress={handleImportConfig} disabled={loading}>
              <Text style={styles.secondaryBtnText}>📁 {t('import_config_btn')}</Text>
            </Pressable>
          </View>
        </View>

        {/* Danger Zone */}
        <View style={[styles.section, { backgroundColor: theme.backgroundElement, marginTop: 24 }]}>
          <Text style={[styles.sectionTitle, { color: '#ef4444', textAlign: isRtl ? 'right' : 'left' }]}>{lang === 'he' ? 'אזור סכנה' : 'Danger Zone'}</Text>
          <Text style={{ color: theme.textSecondary, fontSize: 13, marginBottom: 16, textAlign: isRtl ? 'right' : 'left' }}>
            {lang === 'he' ? 'מחק לחלוטין את כל האסימונים, הרשאות המודל והמידע השמור במכשיר זה.' : 'Erase all credentials, Moodle tokens, database entries, and synchronization logs from this device.'}
          </Text>
          <Pressable style={styles.dangerBtn} onPress={handleDisconnect}>
            <Text style={styles.dangerBtnText}>{t('disconnect_account')}</Text>
          </Pressable>
        </View>
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
  scroll: {
    flex: 1,
    padding: 16,
  },
  section: {
    padding: 16,
    borderRadius: 14,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowLabel: {
    fontWeight: 'bold',
    fontSize: 14,
  },
  subsettings: {
    marginTop: 16,
    borderTopWidth: 1,
    paddingTop: 16,
    gap: 8,
  },
  label: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  input: {
    borderWidth: 1,
    padding: 10,
    borderRadius: 12,
    fontSize: 14,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  secondaryBtn: {
    padding: 12,
    borderRadius: 12,
    flex: 1,
    alignItems: 'center',
  },
  secondaryBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 13,
  },
  statusText: {
    fontSize: 12,
    color: '#10b981',
    marginTop: 8,
    fontWeight: 'bold',
  },
  dangerBtn: {
    backgroundColor: 'rgba(239,68,68,0.06)',
    borderWidth: 1,
    borderColor: '#ef4444',
    padding: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  dangerBtnText: {
    color: '#ef4444',
    fontSize: 14,
    fontWeight: 'bold',
  },
  langBtn: {
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 12,
  },
});
