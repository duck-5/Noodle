import React, { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  Assignment,
  PanoptoRecording,
  cleanCourseDisplayName,
  hasGracePeriod,
  isMoodleActivitySubmitted,
} from '@tautracker/moodle-client';
import {
  CalendarIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  QuizIcon,
  VideoIcon,
} from '@/components/icons/NoodleIcons';
import { usePreferences } from '@/hooks/use-preferences';
import { useResponsiveLayout } from '@/hooks/use-responsive-layout';
import {
  formatGracePeriodText,
  formatShortDate,
  formatTimeHM,
} from '@/services/dateUtils';

export interface CalendarEventItem {
  key: string;
  kind: 'assignment' | 'recording';
  id: string;
  courseId: number;
  courseName: string;
  title: string;
  dateKey: string;
  timeLabel?: string;
  subLabel?: string;
  typeBadge?: string;
  isDone?: boolean;
  isQuiz?: boolean;
  hasGrace?: boolean;
  graceText?: string;
  courseColor: string;
  assignment?: Assignment;
  recording?: PanoptoRecording;
}

export interface ScheduleCalendarViewProps {
  mode: 'assignments' | 'recordings';
  assignments: Assignment[];
  recordings: PanoptoRecording[];
  showOverlay: boolean;
  onToggleOverlay: () => void;
  coursesColorMap: Record<number, string>;
  coursesCustomNames: Record<number, string>;
  onSelectAssignment?: (assignment: Assignment) => void;
  onSelectRecording?: (recording: PanoptoRecording) => void;
  disableSideBySide?: boolean;
}

export function formatLocalDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseRecordingDateKey(
  dateStr?: string | null
): { date: Date; key: string } | null {
  if (!dateStr) return null;
  const trimmed = dateStr.trim();
  if (!trimmed) return null;

  const isoDateMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDateMatch) {
    const y = Number(isoDateMatch[1]);
    const m = Number(isoDateMatch[2]) - 1;
    const day = Number(isoDateMatch[3]);
    const parsed = new Date(y, m, day);
    if (!isNaN(parsed.getTime())) {
      return { date: parsed, key: formatLocalDateKey(parsed) };
    }
  }

  const dmyMatch = trimmed.match(
    /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?:[\s,T]+(\d{1,2}):(\d{2}))?$/
  );
  if (dmyMatch) {
    const day = Number(dmyMatch[1]);
    const m = Number(dmyMatch[2]) - 1;
    const y = Number(dmyMatch[3]);
    const hh = dmyMatch[4] ? Number(dmyMatch[4]) : 0;
    const mm = dmyMatch[5] ? Number(dmyMatch[5]) : 0;
    const parsed = new Date(y, m, day, hh, mm);
    if (
      !isNaN(parsed.getTime()) &&
      parsed.getDate() === day &&
      parsed.getMonth() === m
    ) {
      return { date: parsed, key: formatLocalDateKey(parsed) };
    }
  }

  const parsed = new Date(trimmed);
  if (isNaN(parsed.getTime())) return null;
  return { date: parsed, key: formatLocalDateKey(parsed) };
}

function withHexAlpha(color: string, alphaHex: string, fallback: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(color)) {
    return `${color}${alphaHex}`;
  }
  return fallback;
}

function formatDurationBadge(seconds: number | undefined, lang: 'he' | 'en'): string {
  if (!seconds || seconds <= 0) return '';
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 60) {
    return lang === 'he' ? `${totalMinutes} דק'` : `${totalMinutes}m`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (lang === 'he') {
    return mins > 0 ? `${hours}ש' ${mins}דק'` : `${hours}ש'`;
  }
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

function formatMonthTitle(date: Date, lang: 'he' | 'en'): string {
  const locale = lang === 'he' ? 'he-IL' : 'en-US';
  try {
    return date.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  } catch {
    return `${date.getMonth() + 1}/${date.getFullYear()}`;
  }
}

function formatFullSelectedDate(dateKey: string, lang: 'he' | 'en'): string {
  const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return dateKey;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const locale = lang === 'he' ? 'he-IL' : 'en-US';
  try {
    return date.toLocaleDateString(locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
    });
  } catch {
    return dateKey;
  }
}

export function ScheduleCalendarView({
  mode,
  assignments,
  recordings,
  showOverlay,
  onToggleOverlay,
  coursesColorMap,
  coursesCustomNames,
  onSelectAssignment,
  onSelectRecording,
  disableSideBySide = false,
}: ScheduleCalendarViewProps) {
  const { theme, language, isRtl, t } = usePreferences();
  const { isLandscapeTablet } = useResponsiveLayout();
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const isTablet = !disableSideBySide && isLandscapeTablet && containerWidth >= 680;

  const [viewMode, setViewMode] = useState<'month' | 'week'>('month');
  const [calendarDate, setCalendarDate] = useState<Date>(() => new Date());
  const [selectedDateKey, setSelectedDateKey] = useState<string>(() =>
    formatLocalDateKey(new Date())
  );

  const todayKey = formatLocalDateKey(new Date());
  const weekdayLabels = useMemo(
    () =>
      language === 'he'
        ? ["א'", "ב'", "ג'", "ד'", "ה'", "ו'", "ש'"]
        : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    [language]
  );

  const resolveCourseName = useCallback(
    (courseId: number, fallbackName: string): string => {
      const custom = coursesCustomNames[courseId];
      if (custom && custom.trim()) return custom.trim();
      const cleaned = cleanCourseDisplayName(fallbackName);
      return cleaned || fallbackName || `Course ${courseId}`;
    },
    [coursesCustomNames]
  );

  const resolveCourseColor = useCallback(
    (courseId: number): string => {
      return coursesColorMap[courseId] || theme.primary;
    },
    [coursesColorMap, theme.primary]
  );

  const calendarEvents = useMemo<CalendarEventItem[]>(() => {
    const list: CalendarEventItem[] = [];
    const includeAssignments = mode === 'assignments' || showOverlay;
    const includeRecordings = mode === 'recordings' || showOverlay;

    if (includeAssignments) {
      for (const a of assignments) {
        if (!a.deadline) continue;
        const parsed = new Date(a.deadline);
        if (isNaN(parsed.getTime())) continue;
        const dateKey = formatLocalDateKey(parsed);
        const hasGrace = Boolean(a.cutoffDate && hasGracePeriod(a));
        const graceText =
          hasGrace && a.cutoffDate
            ? formatGracePeriodText(a.cutoffDate, language)
            : undefined;
        const isDone =
          a.isCompleted !== undefined
            ? Boolean(a.isCompleted)
            : isMoodleActivitySubmitted(a);

        list.push({
          key: `assign-${a.uid || a.id}-${a.courseId}`,
          kind: 'assignment',
          id: String(a.uid || a.id),
          courseId: a.courseId,
          courseName: resolveCourseName(a.courseId, a.courseName),
          title: a.name,
          dateKey,
          timeLabel: formatTimeHM(a.deadline, language),
          typeBadge:
            a.activityType === 'quiz' ? t('quiz_label') : t('assignments'),
          isDone,
          isQuiz: a.activityType === 'quiz',
          hasGrace,
          graceText,
          courseColor: resolveCourseColor(a.courseId),
          assignment: a,
        });
      }
    }

    if (includeRecordings) {
      for (const rec of recordings) {
        const parsed = parseRecordingDateKey(rec.publishedDate);
        if (!parsed) continue;
        const durationLabel = formatDurationBadge(rec.durationSeconds, language);
        const subBits = [rec.host, durationLabel].filter(Boolean).join(' · ');

        list.push({
          key: `rec-${rec.id}`,
          kind: 'recording',
          id: rec.id,
          courseId: rec.courseId,
          courseName: resolveCourseName(rec.courseId, rec.courseName),
          title: rec.title,
          dateKey: parsed.key,
          subLabel: subBits || undefined,
          typeBadge:
            rec.type === 'Recitation'
              ? t('recitations_label')
              : t('lectures_label'),
          courseColor: resolveCourseColor(rec.courseId),
          recording: rec,
        });
      }
    }

    return list;
  }, [
    mode,
    showOverlay,
    assignments,
    recordings,
    resolveCourseColor,
    resolveCourseName,
    language,
    t,
  ]);

  const itemsByDateKey = useMemo(() => {
    const map = new Map<string, CalendarEventItem[]>();
    for (const item of calendarEvents) {
      const existing = map.get(item.dateKey);
      if (existing) {
        existing.push(item);
      } else {
        map.set(item.dateKey, [item]);
      }
    }
    return map;
  }, [calendarEvents]);

  const calYear = calendarDate.getFullYear();
  const calMonthIdx = calendarDate.getMonth();

  const monthWeeks = useMemo(() => {
    const firstDayOfWeek = new Date(calYear, calMonthIdx, 1).getDay();
    const daysInMonth = new Date(calYear, calMonthIdx + 1, 0).getDate();
    const daysInPrevMonth = new Date(calYear, calMonthIdx, 0).getDate();

    const cells: {
      key: string;
      dayNumber: number;
      isCurrentMonth: boolean;
      isToday: boolean;
      items: CalendarEventItem[];
    }[] = [];

    for (let i = firstDayOfWeek - 1; i >= 0; i--) {
      const dayNum = daysInPrevMonth - i;
      const cellDate = new Date(calYear, calMonthIdx - 1, dayNum);
      const key = formatLocalDateKey(cellDate);
      cells.push({
        key,
        dayNumber: dayNum,
        isCurrentMonth: false,
        isToday: key === todayKey,
        items: itemsByDateKey.get(key) || [],
      });
    }

    for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
      const cellDate = new Date(calYear, calMonthIdx, dayNum);
      const key = formatLocalDateKey(cellDate);
      cells.push({
        key,
        dayNumber: dayNum,
        isCurrentMonth: true,
        isToday: key === todayKey,
        items: itemsByDateKey.get(key) || [],
      });
    }

    const totalNeeded = cells.length > 35 ? 42 : 35;
    const remaining = totalNeeded - cells.length;
    for (let dayNum = 1; dayNum <= remaining; dayNum++) {
      const cellDate = new Date(calYear, calMonthIdx + 1, dayNum);
      const key = formatLocalDateKey(cellDate);
      cells.push({
        key,
        dayNumber: dayNum,
        isCurrentMonth: false,
        isToday: key === todayKey,
        items: itemsByDateKey.get(key) || [],
      });
    }

    const rows: typeof cells[] = [];
    for (let i = 0; i < cells.length; i += 7) {
      rows.push(cells.slice(i, i + 7));
    }
    return rows;
  }, [calYear, calMonthIdx, todayKey, itemsByDateKey]);

  const weekDays = useMemo(() => {
    const anchor = new Date(calYear, calMonthIdx, calendarDate.getDate());
    const weekStart = new Date(anchor);
    weekStart.setDate(anchor.getDate() - anchor.getDay());

    const result: {
      date: Date;
      key: string;
      weekdayLabel: string;
      shortDate: string;
      isToday: boolean;
      items: CalendarEventItem[];
    }[] = [];

    for (let offset = 0; offset < 7; offset++) {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + offset);
      const key = formatLocalDateKey(d);
      result.push({
        date: d,
        key,
        weekdayLabel: weekdayLabels[offset],
        shortDate: formatShortDate(d.toISOString(), language),
        isToday: key === todayKey,
        items: itemsByDateKey.get(key) || [],
      });
    }
    return result;
  }, [calYear, calMonthIdx, calendarDate, weekdayLabels, language, todayKey, itemsByDateKey]);

  const headerTitle = useMemo(() => {
    if (viewMode === 'week' && weekDays.length === 7) {
      return `${weekDays[0].shortDate} - ${weekDays[6].shortDate}`;
    }
    return formatMonthTitle(calendarDate, language);
  }, [viewMode, weekDays, calendarDate, language]);

  const handlePrev = () => {
    if (viewMode === 'week') {
      setCalendarDate(new Date(calYear, calMonthIdx, calendarDate.getDate() - 7));
    } else {
      setCalendarDate(new Date(calYear, calMonthIdx - 1, 1));
    }
  };

  const handleNext = () => {
    if (viewMode === 'week') {
      setCalendarDate(new Date(calYear, calMonthIdx, calendarDate.getDate() + 7));
    } else {
      setCalendarDate(new Date(calYear, calMonthIdx + 1, 1));
    }
  };

  const handleToday = () => {
    const now = new Date();
    setCalendarDate(now);
    setSelectedDateKey(formatLocalDateKey(now));
  };

  const handlePressEvent = (item: CalendarEventItem) => {
    setSelectedDateKey(item.dateKey);
    if (item.kind === 'assignment' && item.assignment) {
      onSelectAssignment?.(item.assignment);
    } else if (item.kind === 'recording' && item.recording) {
      onSelectRecording?.(item.recording);
    }
  };

  const selectedDayItems = itemsByDateKey.get(selectedDateKey) || [];
  const overlayLabel =
    mode === 'assignments'
      ? t('also_show_recordings')
      : t('also_show_assignments');

  const rowDir = isRtl ? 'row-reverse' : 'row';
  const textAlign = isRtl ? 'right' : 'left';

  const agendaPanel = (
    <View
      style={[
        styles.agendaCard,
        {
          backgroundColor: theme.backgroundElement,
          borderColor: theme.border,
        },
        isTablet ? styles.agendaCardTablet : undefined,
      ]}
    >
      <View style={[styles.agendaHeader, { flexDirection: rowDir }]}>
        <View style={[styles.agendaTitleRow, { flexDirection: rowDir }]}>
          <CalendarIcon size={16} color={theme.primary} />
          <Text
            style={[styles.agendaTitle, { color: theme.text, textAlign }]}
            numberOfLines={1}
          >
            {formatFullSelectedDate(selectedDateKey, language)}
          </Text>
        </View>
        <View
          style={[
            styles.countPill,
            { backgroundColor: withHexAlpha(theme.primary, '1A', theme.backgroundSelected) },
          ]}
        >
          <Text style={[styles.countPillText, { color: theme.primary }]}>
            {selectedDayItems.length}
          </Text>
        </View>
      </View>

      {selectedDayItems.length === 0 ? (
        <View style={styles.agendaEmpty}>
          <Text style={[styles.agendaEmptyText, { color: theme.textSecondary }]}>
            {language === 'he'
              ? 'אין אירועים מתוזמנים ביום זה'
              : 'No scheduled items on this day'}
          </Text>
        </View>
      ) : (
        <View style={styles.agendaList}>
          {selectedDayItems.map((item) => (
            <Pressable
              key={item.key}
              onPress={() => handlePressEvent(item)}
              style={({ pressed }) => [
                styles.agendaItem,
                {
                  backgroundColor: withHexAlpha(
                    item.courseColor,
                    pressed ? '26' : '14',
                    theme.backgroundSelected
                  ),
                  borderColor: withHexAlpha(item.courseColor, '40', theme.border),
                  borderLeftWidth: isRtl ? 1 : 4,
                  borderRightWidth: isRtl ? 4 : 1,
                  borderLeftColor: isRtl
                    ? withHexAlpha(item.courseColor, '40', theme.border)
                    : item.courseColor,
                  borderRightColor: isRtl
                    ? item.courseColor
                    : withHexAlpha(item.courseColor, '40', theme.border),
                  opacity: item.isDone ? 0.72 : 1,
                },
              ]}
            >
              <View style={[styles.agendaItemTop, { flexDirection: rowDir }]}>
                <View style={[styles.agendaCourseRow, { flexDirection: rowDir }]}>
                  {item.kind === 'recording' ? (
                    <VideoIcon size={13} color={item.courseColor} />
                  ) : item.isQuiz ? (
                    <QuizIcon size={13} color={item.courseColor} />
                  ) : (
                    <CalendarIcon size={13} color={item.courseColor} />
                  )}
                  <Text
                    style={[styles.agendaCourseName, { color: item.courseColor }]}
                    numberOfLines={1}
                  >
                    {item.courseName}
                  </Text>
                </View>

                <View style={[styles.agendaBadgesRow, { flexDirection: rowDir }]}>
                  {item.typeBadge ? (
                    <View
                      style={[
                        styles.miniBadge,
                        {
                          backgroundColor: theme.backgroundElement,
                          borderColor: theme.border,
                        },
                      ]}
                    >
                      <Text style={[styles.miniBadgeText, { color: theme.textSecondary }]}>
                        {item.typeBadge}
                      </Text>
                    </View>
                  ) : null}
                  {item.isDone ? (
                    <View
                      style={[
                        styles.doneBadge,
                        {
                          backgroundColor: withHexAlpha(
                            theme.secondary,
                            '20',
                            theme.backgroundSelected
                          ),
                        },
                      ]}
                    >
                      <CheckIcon size={11} color={theme.secondary} />
                    </View>
                  ) : null}
                </View>
              </View>

              <Text
                style={[
                  styles.agendaItemTitle,
                  {
                    color: theme.text,
                    textAlign,
                    textDecorationLine: item.isDone ? 'line-through' : 'none',
                  },
                ]}
                numberOfLines={2}
              >
                {item.title}
              </Text>

              {(item.timeLabel || item.subLabel || item.hasGrace) && (
                <View style={[styles.agendaItemMeta, { flexDirection: rowDir }]}>
                  {item.timeLabel ? (
                    <View style={[styles.metaBit, { flexDirection: rowDir }]}>
                      <ClockIcon size={11} color={theme.textSecondary} />
                      <Text style={[styles.metaBitText, { color: theme.textSecondary }]}>
                        {item.timeLabel}
                      </Text>
                    </View>
                  ) : null}
                  {item.subLabel ? (
                    <Text
                      style={[styles.metaBitText, { color: theme.textSecondary }]}
                      numberOfLines={1}
                    >
                      {item.subLabel}
                    </Text>
                  ) : null}
                  {item.hasGrace && item.graceText ? (
                    <View style={[styles.metaBit, { flexDirection: rowDir }]}>
                      <ClockIcon size={11} color={theme.warning} />
                      <Text
                        style={[styles.metaBitText, { color: theme.warning }]}
                        numberOfLines={1}
                      >
                        {item.graceText}
                      </Text>
                    </View>
                  ) : null}
                </View>
              )}
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );

  return (
    <View
      style={[styles.wrapper, { maxWidth: isLandscapeTablet ? 1280 : 680 }]}
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        if (w > 0 && Math.abs(w - containerWidth) > 2) {
          setContainerWidth(w);
        }
      }}
    >
      <View
        style={[
          styles.outerLayout,
          isTablet
            ? { flexDirection: rowDir, alignItems: 'flex-start', gap: 16 }
            : { flexDirection: 'column', gap: 12 },
        ]}
      >
        <View
          style={[
            styles.calendarCard,
            {
              backgroundColor: theme.backgroundElement,
              borderColor: theme.border,
            },
            isTablet ? styles.calendarCardTablet : undefined,
          ]}
        >
          {/* Header: Month/Week Title & Mode + Nav Controls */}
          <View style={[styles.headerRow, { flexDirection: rowDir }]}>
            <Text
              style={[styles.monthTitle, { color: theme.text, textAlign }]}
              numberOfLines={1}
            >
              {headerTitle}
            </Text>

            <View style={[styles.controlsGroup, { flexDirection: rowDir }]}>
              <View
                style={[
                  styles.modeSwitcher,
                  {
                    backgroundColor: theme.background,
                    borderColor: theme.border,
                    flexDirection: rowDir,
                  },
                ]}
              >
                <Pressable
                  onPress={() => setViewMode('month')}
                  accessibilityRole="button"
                  style={[
                    styles.modeBtn,
                    viewMode === 'month' && { backgroundColor: theme.primary },
                  ]}
                >
                  <Text
                    style={[
                      styles.modeBtnText,
                      {
                        color:
                          viewMode === 'month' ? theme.onPrimary : theme.textSecondary,
                      },
                    ]}
                  >
                    {t('calendar_month')}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setViewMode('week')}
                  accessibilityRole="button"
                  style={[
                    styles.modeBtn,
                    viewMode === 'week' && { backgroundColor: theme.primary },
                  ]}
                >
                  <Text
                    style={[
                      styles.modeBtnText,
                      {
                        color:
                          viewMode === 'week' ? theme.onPrimary : theme.textSecondary,
                      },
                    ]}
                  >
                    {t('calendar_week')}
                  </Text>
                </Pressable>
              </View>

              <View style={[styles.navGroup, { flexDirection: rowDir }]}>
                <Pressable
                  onPress={handlePrev}
                  accessibilityRole="button"
                  accessibilityLabel={
                    language === 'he' ? 'הקודם' : 'Previous'
                  }
                  style={[
                    styles.navBtn,
                    {
                      backgroundColor: theme.background,
                      borderColor: theme.border,
                    },
                  ]}
                >
                  {isRtl ? (
                    <ChevronRightIcon size={16} color={theme.text} />
                  ) : (
                    <ChevronLeftIcon size={16} color={theme.text} />
                  )}
                </Pressable>

                <Pressable
                  onPress={handleToday}
                  accessibilityRole="button"
                  style={[
                    styles.todayBtn,
                    {
                      backgroundColor: theme.background,
                      borderColor: theme.border,
                    },
                  ]}
                >
                  <Text style={[styles.todayBtnText, { color: theme.primary }]}>
                    {t('calendar_today')}
                  </Text>
                </Pressable>

                <Pressable
                  onPress={handleNext}
                  accessibilityRole="button"
                  accessibilityLabel={language === 'he' ? 'הבא' : 'Next'}
                  style={[
                    styles.navBtn,
                    {
                      backgroundColor: theme.background,
                      borderColor: theme.border,
                    },
                  ]}
                >
                  {isRtl ? (
                    <ChevronLeftIcon size={16} color={theme.text} />
                  ) : (
                    <ChevronRightIcon size={16} color={theme.text} />
                  )}
                </Pressable>
              </View>
            </View>
          </View>

          {/* Subtoolbar: Cross-overlay toggle */}
          <View style={[styles.subToolbar, { flexDirection: rowDir }]}>
            <Pressable
              onPress={onToggleOverlay}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: showOverlay }}
              style={[
                styles.overlayChip,
                {
                  backgroundColor: showOverlay
                    ? withHexAlpha(theme.primary, '18', theme.backgroundSelected)
                    : theme.background,
                  borderColor: showOverlay ? theme.primary : theme.border,
                  flexDirection: rowDir,
                },
              ]}
            >
              <View
                style={[
                  styles.checkboxBox,
                  {
                    borderColor: showOverlay ? theme.primary : theme.textSecondary,
                    backgroundColor: showOverlay ? theme.primary : 'transparent',
                  },
                ]}
              >
                {showOverlay ? <CheckIcon size={11} color={theme.onPrimary} /> : null}
              </View>
              <Text
                style={[
                  styles.overlayText,
                  { color: showOverlay ? theme.primary : theme.text },
                ]}
              >
                {overlayLabel}
              </Text>
            </Pressable>

            <Text style={[styles.totalHint, { color: theme.textSecondary }]}>
              {language === 'he'
                ? `${calendarEvents.length} פריטים`
                : `${calendarEvents.length} items`}
            </Text>
          </View>

          {viewMode === 'month' ? (
            <View style={styles.monthContainer}>
              {/* Weekday Headers */}
              <View style={[styles.weekdaysRow, { flexDirection: rowDir }]}>
                {weekdayLabels.map((lbl, idx) => (
                  <View key={idx} style={styles.weekdayCell}>
                    <Text
                      style={[
                        styles.weekdayText,
                        { color: theme.textSecondary },
                      ]}
                    >
                      {lbl}
                    </Text>
                  </View>
                ))}
              </View>

              {/* Month Rows */}
              <View style={styles.monthGrid}>
                {monthWeeks.map((week, wIdx) => (
                  <View
                    key={wIdx}
                    style={[styles.weekRow, { flexDirection: rowDir }]}
                  >
                    {week.map((cell) => {
                      const isSelected = cell.key === selectedDateKey;
                      const visibleItems = cell.items.slice(0, 2);
                      const overflowCount = cell.items.length - visibleItems.length;

                      return (
                        <Pressable
                          key={cell.key}
                          onPress={() => setSelectedDateKey(cell.key)}
                          style={[
                            styles.dayCell,
                            {
                              minHeight: isTablet ? 74 : 56,
                              backgroundColor: isSelected
                                ? withHexAlpha(
                                    theme.primary,
                                    '14',
                                    theme.backgroundSelected
                                  )
                                : theme.background,
                              borderColor: isSelected
                                ? theme.primary
                                : theme.border,
                              opacity: cell.isCurrentMonth ? 1 : 0.45,
                            },
                          ]}
                        >
                          <View
                            style={[
                              styles.dayNumberWrap,
                              { alignSelf: isRtl ? 'flex-end' : 'flex-start' },
                              cell.isToday && {
                                backgroundColor: theme.primary,
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.dayNumber,
                                {
                                  color: cell.isToday
                                    ? theme.onPrimary
                                    : isSelected
                                      ? theme.primary
                                      : theme.text,
                                },
                              ]}
                            >
                              {cell.dayNumber}
                            </Text>
                          </View>

                          <View style={styles.dayPillsCol}>
                            {visibleItems.map((item) => (
                              <View
                                key={item.key}
                                style={[
                                  styles.dayEventPill,
                                  {
                                    backgroundColor: withHexAlpha(
                                      item.courseColor,
                                      '24',
                                      theme.backgroundSelected
                                    ),
                                    borderLeftWidth: isRtl ? 0 : 2.5,
                                    borderRightWidth: isRtl ? 2.5 : 0,
                                    borderLeftColor: item.courseColor,
                                    borderRightColor: item.courseColor,
                                    flexDirection: rowDir,
                                    opacity: item.isDone ? 0.6 : 1,
                                  },
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.dayEventPillText,
                                    { color: theme.text, textAlign },
                                  ]}
                                  numberOfLines={1}
                                >
                                  {item.title}
                                </Text>
                                {item.hasGrace ? (
                                  <ClockIcon size={9} color={theme.warning} />
                                ) : null}
                              </View>
                            ))}
                            {overflowCount > 0 ? (
                              <Text
                                style={[
                                  styles.overflowText,
                                  { color: theme.textSecondary },
                                ]}
                              >
                                +{overflowCount}
                              </Text>
                            ) : null}
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                ))}
              </View>
            </View>
          ) : (
            /* Weekly 7-Day Agenda */
            <View style={styles.weekAgendaList}>
              {weekDays.map((day) => {
                const isSelected = day.key === selectedDateKey;
                return (
                  <Pressable
                    key={day.key}
                    onPress={() => setSelectedDateKey(day.key)}
                    style={[
                      styles.weekDayCard,
                      {
                        backgroundColor: isSelected
                          ? withHexAlpha(
                              theme.primary,
                              '10',
                              theme.backgroundSelected
                            )
                          : theme.background,
                        borderColor: isSelected ? theme.primary : theme.border,
                      },
                    ]}
                  >
                    <View style={[styles.weekDayHeader, { flexDirection: rowDir }]}>
                      <View style={[styles.weekDayTitleGroup, { flexDirection: rowDir }]}>
                        <Text
                          style={[
                            styles.weekDayName,
                            { color: day.isToday ? theme.primary : theme.text },
                          ]}
                        >
                          {day.weekdayLabel}
                        </Text>
                        <Text
                          style={[
                            styles.weekDayDate,
                            { color: theme.textSecondary },
                          ]}
                        >
                          {day.shortDate}
                        </Text>
                        {day.isToday ? (
                          <View
                            style={[
                              styles.todayPill,
                              { backgroundColor: theme.primary },
                            ]}
                          >
                            <Text style={[styles.todayPillText, { color: theme.onPrimary }]}>
                              {t('calendar_today')}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      <Text
                        style={[
                          styles.weekDayCount,
                          { color: theme.textSecondary },
                        ]}
                      >
                        {day.items.length}
                      </Text>
                    </View>

                    {day.items.length > 0 ? (
                      <View style={styles.weekDayItems}>
                        {day.items.map((item) => (
                          <Pressable
                            key={item.key}
                            onPress={() => handlePressEvent(item)}
                            style={[
                              styles.weekEventRow,
                              {
                                backgroundColor: withHexAlpha(
                                  item.courseColor,
                                  '18',
                                  theme.backgroundSelected
                                ),
                                borderLeftWidth: isRtl ? 0 : 3,
                                borderRightWidth: isRtl ? 3 : 0,
                                borderLeftColor: item.courseColor,
                                borderRightColor: item.courseColor,
                                flexDirection: rowDir,
                                opacity: item.isDone ? 0.68 : 1,
                              },
                            ]}
                          >
                            <View style={styles.weekEventMain}>
                              <View style={[styles.weekEventTop, { flexDirection: rowDir }]}>
                                <Text
                                  style={[
                                    styles.weekEventCourse,
                                    { color: item.courseColor },
                                  ]}
                                  numberOfLines={1}
                                >
                                  {item.courseName}
                                </Text>
                                {item.typeBadge ? (
                                  <Text
                                    style={[
                                      styles.weekEventBadge,
                                      { color: theme.textSecondary },
                                    ]}
                                  >
                                    {item.typeBadge}
                                  </Text>
                                ) : null}
                              </View>
                              <Text
                                style={[
                                  styles.weekEventTitle,
                                  {
                                    color: theme.text,
                                    textAlign,
                                    textDecorationLine: item.isDone
                                      ? 'line-through'
                                      : 'none',
                                  },
                                ]}
                                numberOfLines={2}
                              >
                                {item.title}
                              </Text>
                            </View>
                            <View style={[styles.weekEventMeta, { flexDirection: rowDir }]}>
                              {item.timeLabel ? (
                                <Text
                                  style={[
                                    styles.weekEventTime,
                                    { color: theme.textSecondary },
                                  ]}
                                >
                                  {item.timeLabel}
                                </Text>
                              ) : null}
                              {item.hasGrace ? (
                                <ClockIcon size={12} color={theme.warning} />
                              ) : null}
                              {item.isDone ? (
                                <CheckIcon size={12} color={theme.secondary} />
                              ) : null}
                            </View>
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>

        {agendaPanel}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
    maxWidth: 1080,
    alignSelf: 'center',
  },
  outerLayout: {
    width: '100%',
  },
  calendarCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
  },
  calendarCardTablet: {
    flex: 1.35,
    minWidth: 0,
  },
  headerRow: {
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  monthTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  controlsGroup: {
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  modeSwitcher: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 2,
    gap: 2,
  },
  modeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  modeBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  navGroup: {
    alignItems: 'center',
    gap: 4,
  },
  navBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayBtn: {
    height: 30,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  subToolbar: {
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    gap: 8,
  },
  overlayChip: {
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
  },
  checkboxBox: {
    width: 16,
    height: 16,
    borderRadius: 4,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayText: {
    fontSize: 12,
    fontWeight: '600',
  },
  totalHint: {
    fontSize: 12,
    fontWeight: '500',
  },
  monthContainer: {
    width: '100%',
  },
  weekdaysRow: {
    marginBottom: 4,
  },
  weekdayCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 4,
  },
  weekdayText: {
    fontSize: 11,
    fontWeight: '700',
  },
  monthGrid: {
    gap: 4,
  },
  weekRow: {
    gap: 4,
  },
  dayCell: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    padding: 3,
    overflow: 'hidden',
  },
  dayNumberWrap: {
    alignSelf: 'flex-start',
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    marginBottom: 2,
  },
  dayNumber: {
    fontSize: 11,
    fontWeight: '700',
  },
  dayPillsCol: {
    gap: 2,
  },
  dayEventPill: {
    borderRadius: 4,
    paddingHorizontal: 3,
    paddingVertical: 2,
    alignItems: 'center',
    gap: 2,
  },
  dayEventPillText: {
    fontSize: 9,
    fontWeight: '600',
    flex: 1,
  },
  overflowText: {
    fontSize: 9,
    fontWeight: '700',
    textAlign: 'center',
  },
  weekAgendaList: {
    gap: 8,
  },
  weekDayCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 10,
    gap: 8,
  },
  weekDayHeader: {
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  weekDayTitleGroup: {
    alignItems: 'center',
    gap: 6,
  },
  weekDayName: {
    fontSize: 14,
    fontWeight: '700',
  },
  weekDayDate: {
    fontSize: 12,
    fontWeight: '500',
  },
  todayPill: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  todayPillText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
  weekDayCount: {
    fontSize: 12,
    fontWeight: '600',
  },
  weekDayItems: {
    gap: 6,
  },
  weekEventRow: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 7,
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  weekEventMain: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  weekEventTop: {
    alignItems: 'center',
    gap: 6,
  },
  weekEventCourse: {
    fontSize: 11,
    fontWeight: '700',
    flexShrink: 1,
  },
  weekEventBadge: {
    fontSize: 10,
    fontWeight: '600',
  },
  weekEventTitle: {
    fontSize: 13,
    fontWeight: '600',
  },
  weekEventMeta: {
    alignItems: 'center',
    gap: 4,
  },
  weekEventTime: {
    fontSize: 11,
    fontWeight: '600',
  },
  agendaCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  agendaCardTablet: {
    flex: 1,
    minWidth: 280,
  },
  agendaHeader: {
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  agendaTitleRow: {
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  agendaTitle: {
    fontSize: 15,
    fontWeight: '700',
    flexShrink: 1,
  },
  countPill: {
    minWidth: 26,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countPillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  agendaEmpty: {
    paddingVertical: 18,
    alignItems: 'center',
  },
  agendaEmptyText: {
    fontSize: 13,
  },
  agendaList: {
    gap: 8,
  },
  agendaItem: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 10,
    gap: 5,
  },
  agendaItemTop: {
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  agendaCourseRow: {
    alignItems: 'center',
    gap: 5,
    flex: 1,
    minWidth: 0,
  },
  agendaCourseName: {
    fontSize: 12,
    fontWeight: '700',
    flexShrink: 1,
  },
  agendaBadgesRow: {
    alignItems: 'center',
    gap: 5,
  },
  miniBadge: {
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  miniBadgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  doneBadge: {
    borderRadius: 6,
    padding: 3,
  },
  agendaItemTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  agendaItemMeta: {
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  metaBit: {
    alignItems: 'center',
    gap: 4,
  },
  metaBitText: {
    fontSize: 11,
    fontWeight: '500',
  },
});
