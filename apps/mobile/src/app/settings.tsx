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
import { getMoodleToken, setMoodleToken } from '../services/backgroundSync';
import { getGoogleAccessToken, setGoogleAccessToken, performGoogleTasksSync } from '../services/googleTasks';
import { getDb, getPreference, setPreference, removePreference } from '../services/database';
import { Colors } from '../constants/theme';
import { t, getLanguage } from '../services/i18n';
import { useTheme } from '../hooks/use-theme';

export default function SettingsScreen() {
  const theme = useTheme();

  const [loading, setLoading] = useState<boolean>(false);
  const [googleTasksEnabled, setGoogleTasksEnabled] = useState<boolean>(false);
  const [googleListName, setGoogleListName] = useState<string>('Noodle');
  const [googleTokenInput, setGoogleTokenInput] = useState<string>('');
  const [googleStatus, setGoogleStatus] = useState<string | null>(null);
  const [lang, setLang] = useState<'he' | 'en'>('he');
  const [activeTheme, setActiveTheme] = useState<'system' | 'light' | 'dark' | 'noodle'>('system');

  const isRtl = lang === 'he';

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
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
  }

  const handleUpdateTheme = (tChoice: 'system' | 'light' | 'dark' | 'noodle') => {
    try {
      setPreference('theme', tChoice);
      setActiveTheme(tChoice);
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
    } catch (e) {
      console.error(e);
    }
  };

  const handleUpdateListName = (text: string) => {
    try {
      setGoogleListName(text);
      setPreference('google_tasks_list_name', text);
    } catch (e) {
      console.error(e);
    }
  };

  const handleUpdateLanguage = (l: 'he' | 'en') => {
    try {
      setPreference('language', l);
      setLang(l);
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
              // Clear secure tokens
              await setMoodleToken(null);
              await setGoogleAccessToken(null);

              // Clear SQLite tables
              const db = getDb();
              db.execSync(`
                DELETE FROM tracked_courses;
                DELETE FROM assignments;
                DELETE FROM files;
                DELETE FROM meetings;
                DELETE FROM preferences;
              `);

              Alert.alert(lang === 'he' ? 'התנתק בהצלחה' : 'Disconnected', lang === 'he' ? 'הנתונים נמחקו. הפעל מחדש את האפליקציה כדי להתחבר.' : 'Account data has been successfully cleared. Restart the app to log in again.');
            } catch (e: any) {
              Alert.alert('Error', e.message);
            }
          },
        },
      ]
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
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
                { backgroundColor: lang === 'he' ? '#6366f1' : 'transparent', borderColor: '#6366f1', borderWidth: 1 }
              ]}
              onPress={() => handleUpdateLanguage('he')}
            >
              <Text style={{ color: lang === 'he' ? '#ffffff' : theme.text, fontWeight: 'bold' }}>עברית</Text>
            </Pressable>
            <Pressable
              style={[
                styles.langBtn,
                { backgroundColor: lang === 'en' ? '#6366f1' : 'transparent', borderColor: '#6366f1', borderWidth: 1 }
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
                    backgroundColor: activeTheme === tChoice ? '#6366f1' : 'transparent',
                    borderColor: '#6366f1',
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
            <View style={styles.subsettings}>
              <Text style={[styles.label, { color: theme.textSecondary, textAlign: isRtl ? 'right' : 'left' }]}>{t('google_tasks_list_name_label')}</Text>
              <TextInput
                style={[styles.input, { borderColor: theme.backgroundSelected, color: theme.text, textAlign: isRtl ? 'right' : 'left' }]}
                value={googleListName}
                onChangeText={handleUpdateListName}
                placeholder="Noodle"
                placeholderTextColor={theme.textSecondary}
              />

              <Text style={[styles.label, { color: theme.textSecondary, marginTop: 8, textAlign: isRtl ? 'right' : 'left' }]}>{t('google_token_label')}</Text>
              <TextInput
                style={[styles.input, { borderColor: theme.backgroundSelected, color: theme.text, textAlign: isRtl ? 'right' : 'left' }]}
                value={googleTokenInput}
                onChangeText={setGoogleTokenInput}
                placeholder={lang === 'he' ? 'הדבק אסימון OAuth של גוגל...' : 'Paste Google OAuth token...'}
                placeholderTextColor={theme.textSecondary}
                secureTextEntry
              />

              <View style={[styles.btnRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                <Pressable style={styles.secondaryBtn} onPress={handleSaveGoogleToken} disabled={loading}>
                  <Text style={styles.secondaryBtnText}>{t('save_token_btn')}</Text>
                </Pressable>

                <Pressable style={styles.secondaryBtn} onPress={handleManualGoogleSync} disabled={loading}>
                  <Text style={styles.secondaryBtnText}>{t('sync_now')}</Text>
                </Pressable>
              </View>

              {googleStatus && <Text style={[styles.statusText, { textAlign: isRtl ? 'right' : 'left' }]}>{googleStatus}</Text>}
            </View>
          )}
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
    borderBottomColor: 'rgba(255,255,255,0.05)',
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
    borderRadius: 8,
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
    borderTopColor: 'rgba(255,255,255,0.05)',
    paddingTop: 16,
    gap: 8,
  },
  label: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  input: {
    borderWidth: 1,
    padding: 8,
    borderRadius: 6,
    fontSize: 14,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  secondaryBtn: {
    backgroundColor: '#3b82f6',
    padding: 10,
    borderRadius: 6,
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
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderWidth: 1,
    borderColor: '#ef4444',
    padding: 14,
    borderRadius: 8,
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
    borderRadius: 20,
  },
});
