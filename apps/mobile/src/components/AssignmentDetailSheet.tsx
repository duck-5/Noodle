import React, { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Href, useRouter } from 'expo-router';
import {
  Assignment,
  CourseFile,
  cleanCourseDisplayName,
  getActivityUid,
  hasGracePeriod,
  isActivityCompleted,
  isActivityHidden,
  isMoodleActivitySubmitted,
} from '@tautracker/moodle-client';
import { useAppState } from '@/hooks/use-app-state';
import { usePreferences } from '@/hooks/use-preferences';
import { useResponsiveLayout } from '@/hooks/use-responsive-layout';
import {
  formatGracePeriodText,
  formatShortDate,
  formatTimeHM,
  getDueTextAndClass,
} from '@/services/dateUtils';
import {
  FileDownloadAction,
  downloadMoodleFile,
  isFileCachedLocally,
  openMoodleFile,
  shareMoodleFile,
} from '@/services/fileDownloadService';
import { stripHtmlToPlainText } from '@/services/htmlUtils';
import { openMoodleUrl } from '@/services/moodleLink';
import {
  MoodleFileRow,
  getSubjectFilesForAssignment,
} from '@/components/MoodleFileRow';
import {
  CheckIcon,
  ClockIcon,
  CourseIcon,
  ExternalLinkIcon,
  EyeIcon,
  EyeOffIcon,
  FileIcon,
  FolderIcon,
  QuizIcon,
  StarIcon,
  CloseIcon,
} from '@/components/icons/NoodleIcons';
import { NoodleGradientButton } from '@/components/ui/NoodleAnimations';

export interface AssignmentDetailSheetProps {
  visible: boolean;
  assignment: Assignment | null;
  courseColor?: string;
  courseDisplayName?: string;
  onClose: () => void;
  onNavigateToCourse?: (courseId: number) => void;
  inline?: boolean;
}

export function AssignmentDetailSheet({
  visible,
  assignment,
  courseColor,
  courseDisplayName,
  onClose,
  onNavigateToCourse,
  inline = false,
}: AssignmentDetailSheetProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isLandscapeTablet, isTabletDevice } = useResponsiveLayout();
  const { theme, language, isRtl, t } = usePreferences();
  const {
    syncResult,
    settings,
    coursesColorMap,
    coursesCustomNames,
    completedAssignments,
    uncompletedAssignments,
    hiddenAssignments,
    toggleAssignmentDone,
    toggleAssignmentHidden,
  } = useAppState();

  const [busyFiles, setBusyFiles] = useState<Record<string, FileDownloadAction>>({});
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<boolean>(false);

  const isTablet = isLandscapeTablet || isTabletDevice;
  const rowDir = isRtl ? 'row-reverse' : 'row';
  const textAlign = isRtl ? 'right' : 'left';

  const assignmentResetKey = `${visible ? '1' : '0'}:${assignment?.uid || (assignment ? String(assignment.id) : '')}`;
  const [prevResetKey, setPrevResetKey] = useState(assignmentResetKey);
  if (prevResetKey !== assignmentResetKey) {
    setPrevResetKey(assignmentResetKey);
    setDownloadError(null);
    setDownloadNotice(null);
    setBusyFiles({});
    setActionBusy(false);
  }

  const subjectFiles = useMemo<CourseFile[]>(() => {
    if (!assignment) return [];
    return getSubjectFilesForAssignment(assignment, syncResult.files || []);
  }, [assignment, syncResult.files]);

  if (!visible || !assignment) {
    return null;
  }

  const effectiveColor =
    courseColor || coursesColorMap[assignment.courseId] || theme.primary;
  const effectiveCourseName =
    courseDisplayName ||
    coursesCustomNames[assignment.courseId] ||
    cleanCourseDisplayName(assignment.courseName) ||
    assignment.courseName ||
    `Course ${assignment.courseId}`;

  const uid = assignment.uid || getActivityUid(assignment);
  const isMoodleSubmitted = isMoodleActivitySubmitted(assignment);
  const isDone = isActivityCompleted(
    assignment,
    completedAssignments,
    uncompletedAssignments
  );
  const isHidden = isActivityHidden(assignment, hiddenAssignments);

  const dueInfo = getDueTextAndClass(
    assignment.deadline,
    language,
    settings.dueDateGreenDays,
    settings.dueDateYellowDays,
    false,
    assignment.status
  );

  const badgeColors: Record<typeof dueInfo.badgeClass, { bg: string; fg: string }> = {
    'badge-success': { bg: `${theme.secondary}22`, fg: theme.secondary },
    'badge-warning': { bg: `${theme.warning}22`, fg: theme.warning },
    'badge-danger': { bg: `${theme.danger}22`, fg: theme.danger },
    'badge-muted': { bg: theme.backgroundSelected, fg: theme.textSecondary },
  };
  const dueStyle = badgeColors[dueInfo.badgeClass];

  const showGracePeriod = hasGracePeriod(assignment) && Boolean(assignment.cutoffDate);
  const attachments = assignment.attachments || [];
  const submittedFiles = assignment.submittedFiles || [];
  const hasAnyFiles =
    attachments.length > 0 || subjectFiles.length > 0 || submittedFiles.length > 0;

  const handleFileAction = async (
    action: FileDownloadAction,
    key: string,
    fileName: string,
    fileUrl: string,
    mimeType?: string,
    fileSize?: number,
    id?: number
  ) => {
    setDownloadError(null);
    setDownloadNotice(null);
    setBusyFiles((prev) => ({ ...prev, [key]: action }));
    try {
      const payload = {
        id,
        file_name: fileName,
        file_url: fileUrl,
        mime_type: mimeType,
        file_size: fileSize,
      };
      const res =
        action === 'open'
          ? await openMoodleFile(payload)
          : action === 'share'
            ? await shareMoodleFile(payload)
            : await downloadMoodleFile(payload, undefined, { action: 'download' });
      if (!res.success && res.error) {
        setDownloadError(
          res.error === 'NO_VIEWER_INSTALLED' ? t('no_viewer_installed') : res.error
        );
      } else if (res.success && action === 'download' && res.savedToDownloads) {
        setDownloadNotice(t('saved_to_downloads_desc', { name: res.fileName || fileName }));
      }
    } catch (err: any) {
      setDownloadError(err?.message || (language === 'he' ? 'הפעולה נכשלה' : 'File action failed'));
    } finally {
      setBusyFiles((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const handleGoToCourse = () => {
    onClose();
    if (onNavigateToCourse) {
      onNavigateToCourse(assignment.courseId);
    } else {
      router.push(`/course/${assignment.courseId}` as Href);
    }
  };

  const handleToggleDone = async () => {
    if (actionBusy) return;
    setActionBusy(true);
    try {
      await toggleAssignmentDone(uid);
    } finally {
      setActionBusy(false);
    }
  };

  const handleToggleHidden = async () => {
    if (actionBusy) return;
    setActionBusy(true);
    try {
      await toggleAssignmentHidden(uid);
      if (!isHidden) {
        onClose();
      }
    } finally {
      setActionBusy(false);
    }
  };

  const plainFeedback = stripHtmlToPlainText(assignment.feedback);

  const cardContent = (
    <View
      testID={inline ? 'assignment-detail-inline' : undefined}
      style={[
        styles.sheetCard,
        inline ? styles.sheetInline : isTablet ? styles.sheetTablet : styles.sheetPhone,
        {
          backgroundColor: theme.backgroundElement,
          borderColor: effectiveColor,
          borderTopColor: effectiveColor,
        },
      ]}
    >
          {/* Top Accent Header */}
          <View
            style={[
              styles.header,
              {
                borderBottomColor: theme.border,
                flexDirection: rowDir,
              },
            ]}
          >
            <View style={styles.headerContent}>
              <View style={[styles.courseRow, { flexDirection: rowDir }]}>
                <View style={[styles.courseDot, { backgroundColor: effectiveColor }]} />
                <Text
                  style={[styles.courseName, { color: effectiveColor, textAlign }]}
                  numberOfLines={1}
                >
                  {effectiveCourseName}
                </Text>
                <View
                  style={[
                    styles.sectionPill,
                    { backgroundColor: theme.backgroundSelected, flexDirection: rowDir },
                  ]}
                >
                  <FolderIcon size={11} color={theme.textSecondary} />
                  <Text
                    style={[styles.sectionPillText, { color: theme.textSecondary }]}
                    numberOfLines={1}
                  >
                    {assignment.sectionName || (language === 'he' ? 'כללי' : 'General')}
                  </Text>
                </View>
              </View>

              <Text style={[styles.title, { color: theme.text, textAlign }]}>
                {assignment.name}
              </Text>
            </View>

            <TouchableOpacity
              testID="detail-close-btn"
              onPress={onClose}
              style={[styles.closeBtn, { backgroundColor: theme.backgroundSelected }]}
              accessibilityLabel={t('cancel')}
            >
              <CloseIcon size={17} color={theme.text} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.bodyScroll}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Status & Attribute Badges */}
            <View style={[styles.badgesRow, { flexDirection: rowDir }]}>
              <View style={[styles.badgePill, { backgroundColor: dueStyle.bg }]}>
                <Text style={[styles.badgeText, { color: dueStyle.fg }]}>
                  {dueInfo.deadlineText}
                </Text>
              </View>

              {/* Authentic Moodle status (never conflated with local completion) */}
              <View
                style={[
                  styles.badgePill,
                  {
                    backgroundColor: isMoodleSubmitted
                      ? `${theme.secondary}22`
                      : theme.backgroundSelected,
                    flexDirection: rowDir,
                  },
                ]}
              >
                {isMoodleSubmitted && <CheckIcon size={12} color={theme.secondary} />}
                <Text
                  style={[
                    styles.badgeText,
                    { color: isMoodleSubmitted ? theme.secondary : theme.textSecondary },
                  ]}
                >
                  {isMoodleSubmitted ? t('submitted_tag') : t('not_submitted_tag')}
                </Text>
              </View>

              {/* Local checkoff state shown separately */}
              {isDone && !isMoodleSubmitted && (
                <View
                  style={[
                    styles.badgePill,
                    { backgroundColor: `${theme.primary}20`, flexDirection: rowDir },
                  ]}
                >
                  <CheckIcon size={12} color={theme.primary} />
                  <Text style={[styles.badgeText, { color: theme.primary }]}>
                    {t('marked_as_done')}
                  </Text>
                </View>
              )}

              {!isDone && isMoodleSubmitted && (
                <View
                  style={[
                    styles.badgePill,
                    { backgroundColor: `${theme.warning}22`, flexDirection: rowDir },
                  ]}
                >
                  <Text style={[styles.badgeText, { color: theme.warning }]}>
                    {t('submitted_marked_todo')}
                  </Text>
                </View>
              )}

              {assignment.activityType === 'quiz' && (
                <View
                  style={[
                    styles.badgePill,
                    { backgroundColor: '#8b5cf620', flexDirection: rowDir },
                  ]}
                >
                  <QuizIcon size={12} color="#8b5cf6" />
                  <Text style={[styles.badgeText, { color: '#8b5cf6' }]}>
                    {t('quiz_label')}
                    {assignment.timeLimitSeconds
                      ? ` (${t('time_limit_minutes', {
                          minutes: Math.max(1, Math.round(assignment.timeLimitSeconds / 60)),
                        })})`
                      : ''}
                  </Text>
                </View>
              )}

              {assignment.isLateSubmissionBox && (
                <View style={[styles.badgePill, { backgroundColor: `${theme.warning}20` }]}>
                  <Text style={[styles.badgeText, { color: theme.warning }]}>
                    {t('late_box_label')}
                  </Text>
                </View>
              )}

              {assignment.isBonus && (
                <View
                  style={[
                    styles.badgePill,
                    { backgroundColor: `${theme.warning}20`, flexDirection: rowDir },
                  ]}
                >
                  <StarIcon size={12} color={theme.warning} />
                  <Text style={[styles.badgeText, { color: theme.warning }]}>
                    {t('grades_bonus_label')}
                  </Text>
                </View>
              )}
            </View>

            {/* Exact Deadline Timestamp */}
            {assignment.deadline && (
              <View
                style={[
                  styles.infoRow,
                  {
                    backgroundColor: theme.background,
                    borderColor: theme.border,
                    flexDirection: rowDir,
                  },
                ]}
              >
                <ClockIcon size={15} color={theme.textSecondary} />
                <Text style={[styles.infoText, { color: theme.text, textAlign }]}>
                  {`${t('due_date')}: ${formatShortDate(assignment.deadline, language)} ${formatTimeHM(assignment.deadline, language)}`}
                </Text>
              </View>
            )}

            {/* Grace Period Notice */}
            {showGracePeriod && assignment.cutoffDate && (
              <View
                style={[
                  styles.graceNotice,
                  {
                    backgroundColor: `${theme.warning}18`,
                    borderColor: `${theme.warning}55`,
                    flexDirection: rowDir,
                  },
                ]}
              >
                <ClockIcon size={15} color={theme.warning} />
                <Text style={[styles.graceText, { color: theme.warning, textAlign }]}>
                  {formatGracePeriodText(assignment.cutoffDate, language)}
                </Text>
              </View>
            )}

            {/* Grade & Grader Feedback */}
            {(assignment.grade !== null && assignment.grade !== undefined) ||
            Boolean(assignment.feedback) ? (
              <View
                style={[
                  styles.gradeCard,
                  { backgroundColor: theme.background, borderColor: theme.border },
                ]}
              >
                {assignment.grade !== null && assignment.grade !== undefined && (
                  <View style={[styles.gradeRow, { flexDirection: rowDir }]}>
                    <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>
                      {t('grade_label')}
                    </Text>
                    <Text style={[styles.gradeValue, { color: theme.secondary }]}>
                      {assignment.gradeMax
                        ? `${assignment.grade} / ${assignment.gradeMax}`
                        : String(assignment.grade)}
                    </Text>
                  </View>
                )}
                {Boolean(plainFeedback) && (
                  <View style={styles.feedbackBlock}>
                    <Text style={[styles.sectionLabel, { color: theme.textSecondary, textAlign }]}>
                      {t('grader_feedback')}
                    </Text>
                    <Text style={[styles.feedbackText, { color: theme.text, textAlign }]}>
                      {plainFeedback}
                    </Text>
                  </View>
                )}
              </View>
            ) : null}

            {downloadError && (
              <View
                style={[
                  styles.errorBox,
                  { backgroundColor: `${theme.danger}18`, borderColor: theme.danger },
                ]}
              >
                <Text style={[styles.errorText, { color: theme.danger, textAlign }]}>
                  {downloadError}
                </Text>
              </View>
            )}

            {downloadNotice && (
              <View
                style={[
                  styles.errorBox,
                  { backgroundColor: `${theme.secondary}18`, borderColor: theme.secondary },
                ]}
              >
                <Text style={[styles.errorText, { color: theme.secondary, textAlign }]}>
                  {downloadNotice}
                </Text>
              </View>
            )}

            {/* Attachments */}
            {attachments.length > 0 && (
              <View style={styles.filesGroup}>
                <Text style={[styles.filesGroupTitle, { color: theme.textSecondary, textAlign }]}>
                  {t('attachments')}
                </Text>
                {attachments.map((att, idx) => {
                  const key = `att-${idx}-${att.name}`;
                  const cached = isFileCachedLocally(att.name, att.url);
                  return (
                    <MoodleFileRow
                      key={key}
                      fileName={att.name}
                      fileSize={att.fileSize}
                      colors={theme}
                      isRtl={isRtl}
                      isCached={cached}
                      busyAction={busyFiles[key] ?? null}
                      onOpen={() =>
                        handleFileAction('open', key, att.name, att.url, undefined, att.fileSize)
                      }
                      onDownload={() =>
                        handleFileAction('download', key, att.name, att.url, undefined, att.fileSize)
                      }
                      onShare={() =>
                        handleFileAction('share', key, att.name, att.url, undefined, att.fileSize)
                      }
                      compact
                    />
                  );
                })}
              </View>
            )}

            {/* Subject Files (section files excluding folders) */}
            {subjectFiles.length > 0 && (
              <View style={styles.filesGroup}>
                <Text style={[styles.filesGroupTitle, { color: theme.textSecondary, textAlign }]}>
                  {t('subject_files')}
                </Text>
                {subjectFiles.map((sf, idx) => {
                  const key = `sf-${idx}-${sf.fileName}`;
                  const cached = isFileCachedLocally(sf.fileName, sf.fileUrl);
                  return (
                    <MoodleFileRow
                      key={key}
                      fileName={sf.fileName}
                      fileSize={sf.fileSize}
                      colors={theme}
                      isRtl={isRtl}
                      isCached={cached}
                      busyAction={busyFiles[key] ?? null}
                      onOpen={() =>
                        handleFileAction(
                          'open',
                          key,
                          sf.fileName,
                          sf.fileUrl,
                          sf.mimeType,
                          sf.fileSize,
                          sf.id
                        )
                      }
                      onDownload={() =>
                        handleFileAction(
                          'download',
                          key,
                          sf.fileName,
                          sf.fileUrl,
                          sf.mimeType,
                          sf.fileSize,
                          sf.id
                        )
                      }
                      onShare={() =>
                        handleFileAction(
                          'share',
                          key,
                          sf.fileName,
                          sf.fileUrl,
                          sf.mimeType,
                          sf.fileSize,
                          sf.id
                        )
                      }
                      compact
                    />
                  );
                })}
              </View>
            )}

            {/* Submitted Files */}
            {submittedFiles.length > 0 && (
              <View style={styles.filesGroup}>
                <Text style={[styles.filesGroupTitle, { color: theme.textSecondary, textAlign }]}>
                  {t('submitted_files')}
                </Text>
                {submittedFiles.map((sub, idx) => {
                  const key = `sub-${idx}-${sub.name}`;
                  const cached = isFileCachedLocally(sub.name, sub.url);
                  return (
                    <MoodleFileRow
                      key={key}
                      fileName={sub.name}
                      fileSize={sub.fileSize}
                      colors={theme}
                      isRtl={isRtl}
                      isCached={cached}
                      busyAction={busyFiles[key] ?? null}
                      onOpen={() =>
                        handleFileAction('open', key, sub.name, sub.url, undefined, sub.fileSize)
                      }
                      onDownload={() =>
                        handleFileAction('download', key, sub.name, sub.url, undefined, sub.fileSize)
                      }
                      onShare={() =>
                        handleFileAction('share', key, sub.name, sub.url, undefined, sub.fileSize)
                      }
                      compact
                    />
                  );
                })}
              </View>
            )}

            {!hasAnyFiles && (
              <View
                style={[
                  styles.emptyFilesBox,
                  { backgroundColor: theme.background, borderColor: theme.border, flexDirection: rowDir },
                ]}
              >
                <FileIcon size={15} color={theme.textSecondary} />
                <Text style={[styles.emptyFilesText, { color: theme.textSecondary, textAlign }]}>
                  {language === 'he'
                    ? 'אין קבצים מצורפים למטלה זו'
                    : 'No attached files for this assignment'}
                </Text>
              </View>
            )}
          </ScrollView>

          {/* Pinned Footer Actions */}
          <View
            style={[
              styles.footer,
              {
                borderTopColor: theme.border,
                backgroundColor: theme.backgroundElement,
                flexDirection: rowDir,
                paddingBottom: !inline && !isTabletDevice ? Math.max(12, insets.bottom) : 12,
              },
            ]}
          >
            <NoodleGradientButton
              testID="detail-go-to-course-btn"
              label={t('go_to_course')}
              icon={<CourseIcon size={14} color="#ffffff" />}
              onPress={handleGoToCourse}
              isRtl={isRtl}
              size="sm"
            />

            <TouchableOpacity
              onPress={handleToggleDone}
              disabled={actionBusy}
              style={[
                styles.footerBtn,
                {
                  backgroundColor: isDone ? `${theme.secondary}22` : theme.backgroundSelected,
                  borderColor: isDone ? theme.secondary : 'transparent',
                  borderWidth: isDone ? 1 : 0,
                  flexDirection: rowDir,
                  opacity: actionBusy ? 0.6 : 1,
                },
              ]}
            >
              <CheckIcon size={14} color={isDone ? theme.secondary : theme.text} />
              <Text
                style={[
                  styles.footerBtnText,
                  { color: isDone ? theme.secondary : theme.text },
                ]}
              >
                {isDone ? t('unmark_completed') : t('mark_completed')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleToggleHidden}
              disabled={actionBusy}
              style={[
                styles.footerBtn,
                {
                  backgroundColor: theme.backgroundSelected,
                  flexDirection: rowDir,
                  opacity: actionBusy ? 0.6 : 1,
                },
              ]}
            >
              {isHidden ? (
                <EyeIcon size={14} color={theme.text} />
              ) : (
                <EyeOffIcon size={14} color={theme.text} />
              )}
              <Text style={[styles.footerBtnText, { color: theme.text }]}>
                {isHidden ? t('unhide_assignment') : t('hide_assignment')}
              </Text>
            </TouchableOpacity>

            {Boolean(assignment.link) && (
              <TouchableOpacity
                onPress={() => openMoodleUrl(assignment.link, (assignment as any).baseUrl)}
                style={[
                  styles.footerBtn,
                  styles.footerPrimaryBtn,
                  { backgroundColor: theme.primary, flexDirection: rowDir },
                ]}
              >
                <ExternalLinkIcon size={14} color={theme.onPrimary} />
                <Text style={[styles.footerBtnText, { color: theme.onPrimary }]}>
                  {isMoodleSubmitted ? t('open_in_moodle') : t('submit_in_moodle')}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
  );

  if (inline) {
    return cardContent;
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={[styles.backdrop, isTablet ? styles.backdropCentered : styles.backdropBottom]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        {cardContent}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  backdropBottom: {
    justifyContent: 'flex-end',
  },
  backdropCentered: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  sheetCard: {
    width: '100%',
    borderWidth: 1.5,
    borderTopWidth: 4,
    overflow: 'hidden',
  },
  sheetPhone: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    maxHeight: '88%',
  },
  sheetTablet: {
    maxWidth: 620,
    borderRadius: 20,
    maxHeight: '85%',
  },
  sheetInline: {
    borderRadius: 16,
    flex: 1,
  },
  header: {
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerContent: {
    flex: 1,
    gap: 8,
  },
  courseRow: {
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  courseDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  courseName: {
    fontSize: 13,
    fontWeight: '700',
    flexShrink: 1,
  },
  sectionPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    alignItems: 'center',
    gap: 4,
    maxWidth: 200,
  },
  sectionPillText: {
    fontSize: 11,
    fontWeight: '600',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 24,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bodyScroll: {
    flexGrow: 0,
  },
  bodyContent: {
    padding: 18,
    gap: 12,
  },
  badgesRow: {
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  badgePill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    alignItems: 'center',
    gap: 5,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  infoRow: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    gap: 8,
  },
  infoText: {
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  graceNotice: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    gap: 8,
  },
  graceText: {
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  gradeCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 8,
  },
  gradeRow: {
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
  gradeValue: {
    fontSize: 16,
    fontWeight: '800',
  },
  feedbackBlock: {
    gap: 4,
  },
  feedbackText: {
    fontSize: 13,
    lineHeight: 19,
  },
  errorBox: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
  },
  errorText: {
    fontSize: 12,
    fontWeight: '600',
  },
  filesGroup: {
    gap: 6,
  },
  filesGroupTitle: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 2,
  },
  fileRow: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  fileMainTap: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: 10,
  },
  fileRowActions: {
    alignItems: 'center',
    gap: 6,
  },
  fileMiniBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileMeta: {
    flex: 1,
    gap: 2,
  },
  fileName: {
    fontSize: 13,
    fontWeight: '600',
  },
  fileSize: {
    fontSize: 11,
  },
  emptyFilesBox: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    alignItems: 'center',
    gap: 8,
  },
  emptyFilesText: {
    fontSize: 13,
    flex: 1,
  },
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'flex-end',
  },
  footerBtn: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    alignItems: 'center',
    gap: 6,
  },
  footerPrimaryBtn: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  footerBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
});
