import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Paths, File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { getDb } from '../services/database';
import { getMoodleToken } from '../services/backgroundSync';
import { Colors } from '../constants/theme';
import { t, getLanguage } from '../services/i18n';
import { useTheme } from '../hooks/use-theme';

export default function FilesScreen() {
  const theme = useTheme();

  const [loading, setLoading] = useState<boolean>(true);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [files, setFiles] = useState<any[]>([]);
  const [courses, setCourses] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');

  const lang = getLanguage();
  const isRtl = lang === 'he';

  useEffect(() => {
    loadFiles();
  }, []);

  function loadFiles() {
    setLoading(true);
    try {
      const db = getDb();
      const rows = db.getAllSync<any>('SELECT * FROM files ORDER BY section_name ASC');
      setFiles(rows);

      const courseRows = db.getAllSync<any>('SELECT * FROM tracked_courses');
      setCourses(courseRows);
    } catch (e) {
      console.error('loadFiles error:', e);
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

  async function handleDownload(file: any) {
    setDownloadingId(file.id);
    try {
      const token = await getMoodleToken();
      if (!token) {
        Alert.alert(t('connect_moodle'), 'Moodle connection token not found.');
        return;
      }

      // Append token to Moodle file URL
      const separator = file.file_url.includes('?') ? '&' : '?';
      const authenticatedUrl = `${file.file_url}${separator}token=${token}`;
      const destinationFile = new File(Paths.document, encodeURIComponent(file.file_name));

      console.log(`Downloading ${file.file_name}...`);
      const downloadedFile = await File.downloadFileAsync(authenticatedUrl, destinationFile, { idempotent: true });

      if (downloadedFile) {
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(downloadedFile.uri, {
            mimeType: file.mime_type,
            dialogTitle: `Open ${file.file_name}`,
          });
        } else {
          Alert.alert('Download Complete', `File saved to: ${downloadedFile.uri}`);
        }
      } else {
        Alert.alert('Download Failed', 'Failed to download file from Moodle.');
      }
    } catch (e: any) {
      Alert.alert('Download Error', e.message || 'An error occurred during file download.');
    } finally {
      setDownloadingId(null);
    }
  }

  const filteredFiles = files.filter(
    (f) =>
      f.file_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.course_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Group files by course
  const filesByCourse: Record<number, { courseName: string; list: any[] }> = {};
  filteredFiles.forEach((f) => {
    if (!filesByCourse[f.course_moodle_id]) {
      filesByCourse[f.course_moodle_id] = { courseName: f.course_name, list: [] };
    }
    filesByCourse[f.course_moodle_id].list.push(f);
  });

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: theme.text, textAlign: isRtl ? 'right' : 'left' }]}>
          {t('files')}
        </Text>
        <TextInput
          style={[styles.searchInput, { borderColor: theme.backgroundSelected, color: theme.text, textAlign: isRtl ? 'right' : 'left' }]}
          placeholder={t('search_placeholder')}
          placeholderTextColor={theme.textSecondary}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#6366f1" />
        </View>
      ) : files.length === 0 ? (
        <View style={styles.center}>
          <Text style={{ color: theme.textSecondary }}>{t('empty_state_files')}</Text>
        </View>
      ) : Object.keys(filesByCourse).length === 0 ? (
        <View style={styles.center}>
          <Text style={{ color: theme.textSecondary }}>{isRtl ? 'לא נמצאו קבצים מתאימים.' : 'No files match search criteria.'}</Text>
        </View>
      ) : (
        <ScrollView style={styles.list}>
          {Object.entries(filesByCourse).map(([moodleIdStr, group]) => {
            const moodleId = Number(moodleIdStr);
            const color = getCourseColor(moodleId);
            return (
              <View
                key={moodleId}
                style={[
                  styles.courseGroupCard,
                  { 
                    backgroundColor: theme.backgroundElement,
                    borderLeftWidth: isRtl ? 0 : 4,
                    borderRightWidth: isRtl ? 4 : 0,
                    borderLeftColor: isRtl ? 'transparent' : color,
                    borderRightColor: isRtl ? color : 'transparent',
                  },
                ]}
              >
                <Text style={[styles.courseTitle, { color, textAlign: isRtl ? 'right' : 'left', writingDirection: 'auto' }]}>{getCourseName(moodleId, group.courseName)}</Text>
                <View style={styles.fileList}>
                  {group.list.map((f) => {
                    const isDownloading = downloadingId === f.id;
                    const fileSizeMb = f.file_size ? (f.file_size / 1024 / 1024).toFixed(2) : '0';

                    return (
                      <View key={f.id} style={[styles.fileRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.fileName, { color: theme.text, textAlign: isRtl ? 'right' : 'left', writingDirection: 'auto' }]}>{f.file_name}</Text>
                          <Text style={{ color: theme.textSecondary, fontSize: 11, marginTop: 2, textAlign: isRtl ? 'right' : 'left', writingDirection: 'auto' }}>
                            {f.section_name} • {fileSizeMb} MB
                          </Text>
                        </View>

                        <Pressable
                          style={[styles.downloadBtn, { backgroundColor: color }]}
                          onPress={() => handleDownload(f)}
                          disabled={downloadingId !== null}
                        >
                          {isDownloading ? (
                            <ActivityIndicator size="small" color="#ffffff" />
                          ) : (
                            <Text style={styles.downloadBtnText}>{isRtl ? 'הורד' : 'Get'}</Text>
                          )}
                        </Pressable>
                      </View>
                    );
                  })}
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
    marginBottom: 12,
  },
  searchInput: {
    borderWidth: 1,
    padding: 10,
    borderRadius: 8,
    fontSize: 14,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  list: {
    flex: 1,
    padding: 16,
  },
  courseGroupCard: {
    padding: 16,
    borderRadius: 8,
    borderLeftWidth: 4,
    marginBottom: 16,
  },
  courseTitle: {
    fontWeight: 'bold',
    fontSize: 16,
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  fileList: {
    gap: 12,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.03)',
    paddingBottom: 8,
  },
  fileName: {
    fontSize: 14,
    fontWeight: '600',
  },
  downloadBtn: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  downloadBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 13,
  },
});
