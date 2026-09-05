import React, { useState, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { getDb } from '../services/database';
import { t } from '../services/i18n';
import { usePreferences } from '../hooks/use-preferences';
import { downloadMoodleFile, sanitizeFileName } from '../services/fileDownloadService';
import { Paths, File as ExpoFile } from 'expo-file-system';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

function getFileIconAndType(fileName: string): { icon: string; label: string; color: string } {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'pdf':
      return { icon: '📕', label: 'PDF', color: '#ef4444' };
    case 'doc':
    case 'docx':
      return { icon: '📘', label: 'DOC', color: '#3b82f6' };
    case 'xls':
    case 'xlsx':
    case 'csv':
      return { icon: '📊', label: 'XLS', color: '#10b981' };
    case 'ppt':
    case 'pptx':
      return { icon: '📙', label: 'PPT', color: '#f97316' };
    case 'zip':
    case 'rar':
    case '7z':
    case 'tar':
    case 'gz':
      return { icon: '📦', label: 'ZIP', color: '#8b5cf6' };
    case 'py':
    case 'java':
    case 'c':
    case 'cpp':
    case 'js':
    case 'ts':
    case 'html':
    case 'css':
      return { icon: '💻', label: 'CODE', color: '#6366f1' };
    case 'mp4':
    case 'mkv':
    case 'mov':
    case 'avi':
      return { icon: '🎬', label: 'VIDEO', color: '#ec4899' };
    case 'mp3':
    case 'wav':
      return { icon: '🎵', label: 'AUDIO', color: '#14b8a6' };
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
      return { icon: '🖼️', label: 'IMG', color: '#06b6d4' };
    default:
      return { icon: '📄', label: 'FILE', color: '#64748b' };
  }
}

export default function FilesScreen() {
  const { theme, language: lang, isRtl } = usePreferences();

  const [loading, setLoading] = useState<boolean>(true);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [files, setFiles] = useState<any[]>([]);
  const [courses, setCourses] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Course accordion: Set of course IDs that are EXPANDED.
  // Initially empty Set => ALL courses are COLLAPSED by default (Issue 8).
  const [expandedCourseIds, setExpandedCourseIds] = useState<Set<number>>(new Set());

  // Section accordion: Set of "courseId:sectionName" that are COLLAPSED.
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  const loadFiles = () => {
    setLoading(true);
    try {
      const db = getDb();
      const rows = db.getAllSync<any>(
        'SELECT f.* FROM files f JOIN tracked_courses c ON f.course_moodle_id = c.moodle_id WHERE c.is_active = 1 ORDER BY f.section_name ASC'
      );
      setFiles(rows);

      const courseRows = db.getAllSync<any>('SELECT * FROM tracked_courses WHERE is_active = 1');
      setCourses(courseRows);
    } catch (e) {
      console.error('loadFiles error:', e);
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadFiles();
    }, [])
  );

  const getCourseColor = useCallback((courseMoodleId: number) => {
    const course = courses.find((c) => c.moodle_id === courseMoodleId);
    return course?.color || theme.primary;
  }, [courses, theme.primary]);

  const getCourseName = useCallback((courseMoodleId: number, fallback: string) => {
    const course = courses.find((c) => c.moodle_id === courseMoodleId);
    return course?.name || fallback;
  }, [courses]);

  async function handleDownload(file: any) {
    setDownloadingId(file.id);
    try {
      const result = await downloadMoodleFile(file);
      if (!result.success && result.error) {
        Alert.alert(lang === 'he' ? 'שגיאה בהורדה' : 'Download Error', result.error);
      }
    } catch (e: any) {
      Alert.alert(lang === 'he' ? 'שגיאה בהורדה' : 'Download Error', e.message || 'An error occurred.');
    } finally {
      setDownloadingId(null);
    }
  }

  const toggleCourse = (moodleId: number) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedCourseIds((prev) => {
      const next = new Set(prev);
      if (next.has(moodleId)) {
        next.delete(moodleId);
      } else {
        next.add(moodleId);
      }
      return next;
    });
  };

  const toggleSection = (sectionKey: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionKey)) {
        next.delete(sectionKey);
      } else {
        next.add(sectionKey);
      }
      return next;
    });
  };

  const toggleAllCourses = (expand: boolean) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    if (expand) {
      const allIds = new Set<number>(Object.keys(filesByCourse).map(Number));
      setExpandedCourseIds(allIds);
    } else {
      setExpandedCourseIds(new Set());
    }
  };

  const filteredFiles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return files;
    return files.filter(
      (f) =>
        f.file_name.toLowerCase().includes(q) ||
        f.course_name.toLowerCase().includes(q) ||
        (f.section_name && f.section_name.toLowerCase().includes(q))
    );
  }, [files, searchQuery]);

  // Group files by course and then by section
  const filesByCourse: Record<
    number,
    {
      courseName: string;
      totalFiles: number;
      totalSizeBytes: number;
      sections: Record<string, any[]>;
    }
  > = {};

  for (const f of filteredFiles) {
    const courseId = f.course_moodle_id;
    if (!filesByCourse[courseId]) {
      filesByCourse[courseId] = {
        courseName: getCourseName(courseId, f.course_name),
        totalFiles: 0,
        totalSizeBytes: 0,
        sections: {},
      };
    }
    const sectionName = f.section_name || (lang === 'he' ? 'כללי' : 'General');
    if (!filesByCourse[courseId].sections[sectionName]) {
      filesByCourse[courseId].sections[sectionName] = [];
    }
    filesByCourse[courseId].sections[sectionName].push(f);
    filesByCourse[courseId].totalFiles += 1;
    filesByCourse[courseId].totalSizeBytes += f.file_size || 0;
  }

  // When searching, auto-expand courses that have results
  const isSearching = searchQuery.trim().length > 0;
  const isCourseExpanded = (courseId: number) => {
    if (isSearching) return true;
    return expandedCourseIds.has(courseId);
  };

  const allAreExpanded = Object.keys(filesByCourse).length > 0 &&
    Object.keys(filesByCourse).every((idStr) => expandedCourseIds.has(Number(idStr)));

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Top Header */}
      <View style={[styles.header, { borderBottomColor: theme.border, backgroundColor: theme.backgroundElement }]}>
        <View style={[styles.headerTitleRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
          <Text style={[styles.headerTitle, { color: theme.text }]}>
            {t('files')}
          </Text>
          {Object.keys(filesByCourse).length > 0 && !isSearching && (
            <Pressable
              style={[styles.toggleAllBtn, { borderColor: theme.border, backgroundColor: theme.backgroundSelected + '50' }]}
              onPress={() => toggleAllCourses(!allAreExpanded)}
            >
              <Text style={[styles.toggleAllBtnText, { color: theme.primary }]}>
                {allAreExpanded ? t('collapse_all') : t('expand_all')}
              </Text>
            </Pressable>
          )}
        </View>

        <TextInput
          style={[
            styles.searchInput,
            {
              borderColor: theme.border,
              color: theme.text,
              textAlign: isRtl ? 'right' : 'left',
              backgroundColor: theme.background,
            },
          ]}
          placeholder={t('search_placeholder')}
          placeholderTextColor={theme.placeholder}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      {/* Main List */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      ) : files.length === 0 ? (
        <View style={styles.center}>
          <Text style={{ color: theme.textSecondary, fontSize: 14 }}>{t('empty_state_files')}</Text>
        </View>
      ) : Object.keys(filesByCourse).length === 0 ? (
        <View style={styles.center}>
          <Text style={{ color: theme.textSecondary, fontSize: 14 }}>
            {isRtl ? 'לא נמצאו קבצים מתאימים לחיפוש.' : 'No files match search criteria.'}
          </Text>
        </View>
      ) : (
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {Object.entries(filesByCourse).map(([moodleIdStr, group]) => {
            const moodleId = Number(moodleIdStr);
            const color = getCourseColor(moodleId);
            const expanded = isCourseExpanded(moodleId);
            const totalMb = (group.totalSizeBytes / 1024 / 1024).toFixed(1);

            return (
              <View
                key={moodleId}
                style={[
                  styles.courseCard,
                  {
                    backgroundColor: theme.backgroundElement,
                    borderColor: expanded ? color : theme.border,
                    borderLeftWidth: isRtl ? 1 : 5,
                    borderRightWidth: isRtl ? 5 : 1,
                    borderLeftColor: isRtl ? (expanded ? color : theme.border) : color,
                    borderRightColor: isRtl ? color : (expanded ? color : theme.border),
                  },
                ]}
              >
                {/* Course Header (Accordion Trigger) */}
                <Pressable
                  style={[styles.courseHeaderPressable, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}
                  onPress={() => toggleCourse(moodleId)}
                >
                  <View style={{ flex: 1, marginRight: isRtl ? 0 : 8, marginLeft: isRtl ? 8 : 0 }}>
                    <Text
                      style={[
                        styles.courseTitle,
                        { color: theme.text, textAlign: isRtl ? 'right' : 'left', writingDirection: 'auto' },
                      ]}
                      numberOfLines={2}
                    >
                      {getCourseName(moodleId, group.courseName)}
                    </Text>
                    <View style={[styles.metaPillRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                      <View style={[styles.countPill, { backgroundColor: color + '20' }]}>
                        <Text style={[styles.countPillText, { color }]}>
                          📁 {group.totalFiles} {lang === 'he' ? 'קבצים' : 'files'}
                        </Text>
                      </View>
                      {group.totalSizeBytes > 0 && (
                        <View style={[styles.countPill, { backgroundColor: theme.backgroundSelected + '60' }]}>
                          <Text style={[styles.countPillText, { color: theme.textSecondary }]}>
                            💾 {totalMb} MB
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>

                  <View
                    style={[
                      styles.chevronContainer,
                      { backgroundColor: theme.backgroundSelected + '50' },
                    ]}
                  >
                    <Text style={{ color: theme.primary, fontSize: 16, fontWeight: 'bold' }}>
                      {expanded ? '▲' : '▼'}
                    </Text>
                  </View>
                </Pressable>

                {/* Course Body (Visible when expanded) */}
                {expanded && (
                  <View style={[styles.courseBody, { borderTopColor: theme.border }]}>
                    {Object.entries(group.sections).map(([sectionName, sectionFiles]) => {
                      const sectionKey = `${moodleId}:${sectionName}`;
                      const isSectionCollapsed = collapsedSections.has(sectionKey);

                      return (
                        <View key={sectionKey} style={styles.sectionBlock}>
                          {/* Section Header */}
                          <Pressable
                            style={[
                              styles.sectionHeader,
                              {
                                flexDirection: isRtl ? 'row-reverse' : 'row',
                                backgroundColor: theme.backgroundSelected + '35',
                              },
                            ]}
                            onPress={() => toggleSection(sectionKey)}
                          >
                            <View style={[styles.sectionTitleRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                              <Text
                                style={[
                                  styles.sectionTitleText,
                                  { color: theme.text, textAlign: isRtl ? 'right' : 'left' },
                                ]}
                              >
                                📁 {sectionName}
                              </Text>
                              <Text style={[styles.sectionFileCount, { color: theme.textSecondary }]}>
                                ({sectionFiles.length})
                              </Text>
                            </View>
                            <Text style={{ color: theme.textSecondary, fontSize: 12 }}>
                              {isSectionCollapsed ? '▼' : '▲'}
                            </Text>
                          </Pressable>

                          {/* Section Files List */}
                          {!isSectionCollapsed && (
                            <View style={styles.fileList}>
                              {sectionFiles.map((f) => {
                                const isDownloading = downloadingId === f.id;
                                const fileSizeMb = f.file_size
                                  ? (f.file_size / 1024 / 1024).toFixed(2)
                                  : '0';
                                const { icon: fileIcon, label: typeLabel, color: typeColor } =
                                  getFileIconAndType(f.file_name);

                                // Check if cached locally
                                const cleanName = sanitizeFileName(f.file_name);
                                const localTarget = new ExpoFile(Paths.document, cleanName);
                                const isCached = localTarget.exists && localTarget.size > 0;

                                return (
                                  <View
                                    key={f.id}
                                    style={[
                                      styles.fileCard,
                                      {
                                        backgroundColor: theme.backgroundElement,
                                        borderColor: theme.border,
                                        flexDirection: isRtl ? 'row-reverse' : 'row',
                                      },
                                    ]}
                                  >
                                    {/* File Type Badge */}
                                    <View
                                      style={[
                                        styles.typeBadge,
                                        { backgroundColor: typeColor + '15', borderColor: typeColor + '40' },
                                      ]}
                                    >
                                      <Text style={styles.typeIconText}>{fileIcon}</Text>
                                      <Text style={[styles.typeLabelText, { color: typeColor }]}>
                                        {typeLabel}
                                      </Text>
                                    </View>

                                    {/* File Info */}
                                    <View
                                      style={{
                                        flex: 1,
                                        marginRight: isRtl ? 10 : 12,
                                        marginLeft: isRtl ? 12 : 10,
                                        justifyContent: 'center',
                                      }}
                                    >
                                      <Text
                                        style={[
                                          styles.fileName,
                                          {
                                            color: theme.text,
                                            textAlign: isRtl ? 'right' : 'left',
                                            writingDirection: 'auto',
                                          },
                                        ]}
                                      >
                                        {f.file_name}
                                      </Text>
                                      <View
                                        style={[
                                          styles.fileMetaRow,
                                          { flexDirection: isRtl ? 'row-reverse' : 'row' },
                                        ]}
                                      >
                                        <Text style={[styles.fileSizeText, { color: theme.textSecondary }]}>
                                          {fileSizeMb} MB
                                        </Text>
                                        {isCached && (
                                          <Text style={styles.cachedBadge}>
                                            ✓ {lang === 'he' ? 'הורד' : 'Saved'}
                                          </Text>
                                        )}
                                      </View>
                                    </View>

                                    {/* Action Button */}
                                    <Pressable
                                      style={[
                                        styles.downloadBtn,
                                        {
                                          backgroundColor: isCached ? '#10b981' : color,
                                        },
                                      ]}
                                      onPress={() => handleDownload(f)}
                                      disabled={downloadingId !== null}
                                    >
                                      {isDownloading ? (
                                        <ActivityIndicator size="small" color="#ffffff" />
                                      ) : (
                                        <Text style={styles.downloadBtnText}>
                                          {isCached
                                            ? (lang === 'he' ? 'פתח 📂' : 'Open 📂')
                                            : (lang === 'he' ? 'הורדה 📥' : 'Get 📥')}
                                        </Text>
                                      )}
                                    </Pressable>
                                  </View>
                                );
                              })}
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </View>
                )}
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
    paddingTop: 54,
    borderBottomWidth: 1,
  },
  headerTitleRow: {
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  toggleAllBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
  },
  toggleAllBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  searchInput: {
    borderWidth: 1,
    padding: 12,
    borderRadius: 12,
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
  },
  listContent: {
    padding: 16,
    paddingBottom: 32,
  },
  courseCard: {
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 14,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  courseHeaderPressable: {
    padding: 14,
    alignItems: 'center',
  },
  courseTitle: {
    fontWeight: '700',
    fontSize: 16,
    lineHeight: 22,
    marginBottom: 6,
  },
  metaPillRow: {
    gap: 8,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  countPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  countPillText: {
    fontSize: 11,
    fontWeight: 'bold',
  },
  chevronContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  courseBody: {
    borderTopWidth: 1,
    padding: 12,
    gap: 12,
  },
  sectionBlock: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  sectionHeader: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  sectionTitleRow: {
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  sectionTitleText: {
    fontSize: 13,
    fontWeight: 'bold',
  },
  sectionFileCount: {
    fontSize: 11,
  },
  fileList: {
    gap: 8,
    paddingHorizontal: 2,
  },
  fileCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 10,
    alignItems: 'center',
  },
  typeBadge: {
    width: 44,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 2,
  },
  typeIconText: {
    fontSize: 16,
  },
  typeLabelText: {
    fontSize: 8,
    fontWeight: '900',
    textTransform: 'uppercase',
    marginTop: 1,
  },
  fileName: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  fileMetaRow: {
    alignItems: 'center',
    gap: 8,
    marginTop: 3,
  },
  fileSizeText: {
    fontSize: 11,
  },
  cachedBadge: {
    fontSize: 10,
    color: '#10b981',
    fontWeight: 'bold',
  },
  downloadBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 70,
    minHeight: 36,
  },
  downloadBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 12,
  },
});
