import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import type { Assignment, CourseFile } from '@tautracker/moodle-client';
import type { ThemeColors } from '@/constants/theme';
import { DownloadIcon } from '@/components/icons/NoodleIcons';
import { translate } from '@/services/i18n';

export interface MoodleFileRowProps {
  fileName: string;
  fileSize?: number;
  subtitle?: string;
  colors: ThemeColors;
  isRtl?: boolean;
  isCached?: boolean;
  busyAction?: 'open' | 'download' | 'share' | null;
  onOpen: () => void;
  onDownload: () => void;
  /** @deprecated Share button removed in E8; kept optional for caller compatibility. */
  onShare?: () => void;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

function getExtensionBadge(fileName: string): string {
  const lastDot = (fileName || '').lastIndexOf('.');
  if (lastDot <= 0 || lastDot === fileName.length - 1) return 'FILE';
  const ext = fileName.slice(lastDot + 1).toUpperCase();
  return ext.length <= 5 ? ext : ext.slice(0, 4);
}

function formatBytes(bytes?: number): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Returns subject-level Moodle files belonging to the same course & section as an assignment,
 * strictly excluding folder-contained files (`folderId != null`) and deduplicating by URL.
 */
export function getSubjectFilesForAssignment(
  assignment: Assignment,
  files: CourseFile[]
): CourseFile[] {
  if (!assignment || !Array.isArray(files) || files.length === 0) return [];

  const targetSectionId = assignment.sectionId;
  const targetSectionName = (assignment.sectionName || '').trim().toLowerCase();
  if (targetSectionId === undefined && !targetSectionName) {
    return [];
  }

  const courseIds = new Set<number>([assignment.courseId]);
  if (assignment.sourceCourseId !== undefined) {
    courseIds.add(assignment.sourceCourseId);
  }

  const seenUrls = new Set<string>();
  const matched: CourseFile[] = [];

  for (const file of files) {
    // Exclude files that live inside a Moodle Folder resource
    if (file.folderId !== undefined && file.folderId !== null) {
      continue;
    }

    const sameCourse =
      courseIds.has(file.courseId) ||
      (file.sourceCourseId !== undefined && courseIds.has(file.sourceCourseId));
    if (!sameCourse) continue;

    const sameSection =
      targetSectionId !== undefined && file.sectionId !== undefined
        ? file.sectionId === targetSectionId
        : Boolean(
            targetSectionName &&
              (file.sectionName || '').trim().toLowerCase() === targetSectionName
          );
    if (!sameSection) continue;

    const dedupeKey = (file.fileUrl || '').trim() || `${file.fileName}|${file.fileSize || 0}`;
    if (seenUrls.has(dedupeKey)) continue;
    seenUrls.add(dedupeKey);
    matched.push(file);
  }

  return matched;
}

/**
 * Unified Moodle file row component with flat sibling `<Pressable>` targets (Open, Download),
 * extension badge, 2-line filename, optional Cached indicator pill (never replacing DownloadIcon),
 * and full screen-reader accessibility labels.
 */
export function MoodleFileRow({
  fileName,
  fileSize,
  subtitle,
  colors,
  isRtl = false,
  isCached = false,
  busyAction = null,
  onOpen,
  onDownload,
  compact = false,
  style,
  testID,
}: MoodleFileRowProps) {
  const rowDir = isRtl ? 'row-reverse' : 'row';
  const textAlign = isRtl ? 'right' : 'left';
  const ext = getExtensionBadge(fileName);
  const sizeStr = formatBytes(fileSize);
  const metaText = [sizeStr, subtitle].filter(Boolean).join(' · ');
  const isBusy = busyAction !== null;

  const openLabel = `${translate('open_file')} ${fileName}`;
  const downloadLabel = `${translate('download_file')} ${fileName}`;

  return (
    <View
      testID={testID}
      style={[
        styles.container,
        compact && styles.containerCompact,
        {
          flexDirection: rowDir,
          backgroundColor: colors.backgroundElement,
          borderColor: colors.border,
        },
        style,
      ]}
    >
      {/* Primary tap region: Open file */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={openLabel}
        disabled={isBusy}
        onPress={onOpen}
        hitSlop={4}
        style={({ pressed }) => [
          styles.mainPressable,
          { flexDirection: rowDir, opacity: pressed ? 0.72 : 1 },
        ]}
      >
        <View
          style={[
            styles.extBadge,
            {
              backgroundColor: `${colors.primary}18`,
              borderColor: `${colors.primary}38`,
            },
          ]}
        >
          {busyAction === 'open' ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Text style={[styles.extText, { color: colors.primary }]} numberOfLines={1}>
              {ext}
            </Text>
          )}
        </View>

        <View style={styles.textColumn}>
          <Text
            style={[styles.fileName, { color: colors.text, textAlign }]}
            numberOfLines={2}
            ellipsizeMode="middle"
          >
            {fileName}
          </Text>
          {(metaText.length > 0 || isCached) && (
            <View style={[styles.metaRow, { flexDirection: rowDir }]}>
              {metaText.length > 0 && (
                <Text
                  style={[styles.metaText, { color: colors.textSecondary, textAlign }]}
                  numberOfLines={1}
                >
                  {metaText}
                </Text>
              )}
              {isCached && (
                <View
                  style={[
                    styles.cachedPill,
                    {
                      backgroundColor: `${colors.secondary}1f`,
                      borderColor: `${colors.secondary}44`,
                    },
                  ]}
                >
                  <Text style={[styles.cachedPillText, { color: colors.secondary }]}>
                    Cached
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>
      </Pressable>

      {/* Sibling action button: Download */}
      <View style={[styles.actionsRow, { flexDirection: rowDir }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={downloadLabel}
          disabled={isBusy}
          onPress={onDownload}
          hitSlop={6}
          style={({ pressed }) => [
            styles.actionBtn,
            {
              backgroundColor: pressed ? colors.backgroundSelected : `${colors.primary}14`,
              borderColor: `${colors.primary}30`,
            },
          ]}
        >
          {busyAction === 'download' ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <DownloadIcon size={17} color={colors.primary} />
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  containerCompact: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  mainPressable: {
    flex: 1,
    minWidth: 0,
    minHeight: 36,
    alignItems: 'center',
    gap: 10,
  },
  extBadge: {
    minWidth: 42,
    height: 30,
    paddingHorizontal: 6,
    borderRadius: 7,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  extText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  textColumn: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  fileName: {
    fontSize: 13.5,
    fontWeight: '600',
    lineHeight: 18,
  },
  metaRow: {
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  metaText: {
    fontSize: 11.5,
  },
  cachedPill: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
    borderWidth: 1,
  },
  cachedPillText: {
    fontSize: 10,
    fontWeight: '700',
  },
  actionsRow: {
    alignItems: 'center',
    gap: 6,
  },
  actionBtn: {
    minWidth: 36,
    minHeight: 36,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
