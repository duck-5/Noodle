import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as ExpoRouter from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as AppStateModule from '@/hooks/use-app-state';
import type { SyncProgressContextValue } from '@/hooks/use-app-state';
import { usePreferences } from '@/hooks/use-preferences';
import { useResponsiveLayout } from '@/hooks/use-responsive-layout';
import { formatTimeHM } from '@/services/dateUtils';
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CloseIcon,
  InfoIcon,
  RefreshIcon,
} from '@/components/icons/NoodleIcons';
import { SpinningIcon, animateLayout } from '@/components/ui/NoodleAnimations';

const isJestEnv =
  typeof process !== 'undefined' && Boolean(process.env?.JEST_WORKER_ID);

function useNullSyncProgress(): Partial<SyncProgressContextValue> | null {
  return null;
}

const useSyncProgressHook: () => Partial<SyncProgressContextValue> | null =
  typeof AppStateModule.useSyncProgress === 'function'
    ? AppStateModule.useSyncProgress
    : useNullSyncProgress;

const useSafeSegments: () => string[] =
  typeof ExpoRouter.useSegments === 'function'
    ? (ExpoRouter.useSegments as () => string[])
    : () => [];

type TaskStatus = 'done' | 'active' | 'pending' | 'failed';

interface SyncTaskRow {
  id: string;
  order: number;
  title: string;
  subtext?: string;
}

export function SyncProgressBanner() {
  const appState = AppStateModule.useAppState();
  const syncCtx = useSyncProgressHook();
  const { theme, effectiveThemeName, language, isRtl, t } = usePreferences();
  const insets = useSafeAreaInsets();
  const { isLandscapeTablet, isShortLandscape } = useResponsiveLayout();
  const segments = useSafeSegments();

  const isSyncing = syncCtx?.isSyncing ?? appState.isSyncing;
  const syncProgress = syncCtx?.syncProgress ?? appState.syncProgress;
  const syncError = syncCtx?.syncError ?? appState.syncError;
  const syncWindowVisible = syncCtx?.syncWindowVisible;
  const ctxCollapsed = syncCtx?.syncWindowCollapsed;
  const ctxSetCollapsed = syncCtx?.setSyncWindowCollapsed;
  const ctxCloseSyncWindow = syncCtx?.closeSyncWindow;
  const { lastSyncedAt, settings, sessionExpired } = appState;

  const [localCollapsed, setLocalCollapsed] = useState<boolean>(isShortLandscape);
  const [dismissedError, setDismissedError] = useState<string | null>(null);

  const prevShortLandscapeRef = useRef<boolean>(isShortLandscape);
  const [enterAnim] = useState(() => new Animated.Value(isJestEnv ? 1 : 0));

  const collapsed = ctxCollapsed ?? localCollapsed;

  useEffect(() => {
    if (isShortLandscape && !prevShortLandscapeRef.current) {
      setLocalCollapsed(true);
      ctxSetCollapsed?.(true);
    }
    prevShortLandscapeRef.current = isShortLandscape;
  }, [isShortLandscape, ctxSetCollapsed]);

  const [prevSyncing, setPrevSyncing] = useState(isSyncing);
  if (prevSyncing !== isSyncing) {
    setPrevSyncing(isSyncing);
    if (isSyncing) {
      setDismissedError(null);
    } else {
      setLocalCollapsed(isShortLandscape);
    }
  }

  const hasError = Boolean(syncError) && !isSyncing;
  const isErrorDismissed = hasError && dismissedError === syncError;
  const showErrorBanner = hasError && !isErrorDismissed && !sessionExpired;
  const isComplete = !isSyncing && !hasError && syncProgress?.percent === 100;
  const effectiveVisible = syncWindowVisible ?? isSyncing;
  const shouldRender =
    syncWindowVisible !== undefined
      ? (Boolean(effectiveVisible) && isSyncing) || showErrorBanner
      : effectiveVisible || showErrorBanner;

  useEffect(() => {
    if (!shouldRender || isJestEnv) return;
    enterAnim.setValue(0);
    Animated.timing(enterAnim, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [shouldRender, enterAnim]);

  if (!shouldRender) {
    return null;
  }

  const percent = Math.max(
    0,
    Math.min(100, Math.round(syncProgress?.percent ?? (isSyncing ? 2 : 0)))
  );
  const totalCourses = syncProgress?.totalCourses ?? 0;
  const coursesCompleted = syncProgress?.coursesCompleted ?? 0;
  const totalActivities = syncProgress?.totalActivities ?? 0;
  const activitiesCompleted = syncProgress?.activitiesCompleted ?? 0;
  const totalPanoptoCourses = syncProgress?.totalPanoptoCourses ?? 0;
  const panoptoCoursesCompleted = syncProgress?.panoptoCoursesCompleted ?? 0;
  const hasPanopto = Boolean(settings?.panoptoEnabled);

  const currentStage = String(
    syncProgress?.stage || (isSyncing ? 'init' : 'idle')
  );
  const stageOrder: Record<string, number> = {
    idle: 0,
    init: 1,
    mapping: 2,
    global_fetch: 3,
    courses: 4,
    activities: 5,
    panopto: 6,
    finalizing: hasPanopto ? 7 : 6,
    complete: hasPanopto ? 8 : 7,
  };
  const currentStageIndex = isComplete
    ? hasPanopto
      ? 8
      : 7
    : (stageOrder[currentStage] ?? (isSyncing ? 1 : 0));

  const tasks: SyncTaskRow[] = [
    {
      id: 'init',
      order: 1,
      title: t('sync_task_init'),
    },
    {
      id: 'mapping',
      order: 2,
      title: t('sync_task_mapping'),
    },
    {
      id: 'global_fetch',
      order: 3,
      title: t('sync_task_global_fetch'),
    },
    {
      id: 'courses',
      order: 4,
      title: t('sync_task_courses'),
      subtext:
        currentStage === 'courses' && totalCourses > 0
          ? `${coursesCompleted} / ${totalCourses} ${t('sync_courses_scanned')}`
          : undefined,
    },
    {
      id: 'activities',
      order: 5,
      title: t('sync_task_activities'),
      subtext:
        currentStage === 'activities' && totalActivities > 0
          ? `${activitiesCompleted} / ${totalActivities} ${t('sync_activities_checked')}`
          : undefined,
    },
    ...(hasPanopto
      ? [
          {
            id: 'panopto',
            order: 6,
            title: t('sync_task_panopto'),
            subtext:
              currentStage === 'panopto' && totalPanoptoCourses > 0
                ? `${panoptoCoursesCompleted} / ${totalPanoptoCourses} ${t('sync_panopto_scanned')}`
                : undefined,
          },
        ]
      : []),
    {
      id: 'finalizing',
      order: hasPanopto ? 7 : 6,
      title: t('sync_task_finalizing'),
    },
  ];

  const inTabs = Array.isArray(segments) && segments[0] === '(tabs)';
  const bottomOffset =
    inTabs && !isLandscapeTablet
      ? 58 + Math.max(8, insets.bottom) + 12
      : Math.max(16, insets.bottom + 8);
  const sidePosition = isRtl ? { left: 16 } : { right: 16 };
  const rowDir = isRtl ? 'row-reverse' : 'row';
  const textAlign = isRtl ? 'right' : 'left';

  const isDarkTheme = effectiveThemeName === 'coffee' || effectiveThemeName === 'dark';
  const successColor = isDarkTheme ? '#4ade80' : '#16a34a';

  // Extension-matched theme surfaces
  const surfaceBg =
    effectiveThemeName === 'noodle'
      ? 'rgba(253, 246, 240, 0.97)'
      : effectiveThemeName === 'coffee'
        ? 'rgba(29, 23, 19, 0.97)'
        : effectiveThemeName === 'dark'
          ? 'rgba(24, 25, 36, 0.96)'
          : 'rgba(255, 255, 255, 0.97)';
  const surfaceBorder = hasError
    ? theme.danger
    : effectiveThemeName === 'noodle'
      ? 'rgba(194, 112, 68, 0.28)'
      : effectiveThemeName === 'coffee'
        ? 'rgba(217, 160, 102, 0.28)'
        : effectiveThemeName === 'dark'
          ? 'rgba(255, 255, 255, 0.14)'
          : theme.border;
  const accentColor = hasError
    ? theme.danger
    : isComplete
      ? successColor
      : theme.primary;

  const rawSuccessTitle = t('sync_success' as any);
  const rawFailedTitle = t('sync_failed' as any);
  const headerTitle = hasError
    ? rawFailedTitle !== 'sync_failed'
      ? rawFailedTitle
      : language === 'he'
        ? 'הסנכרון נכשל'
        : 'Sync Failed'
    : isComplete
      ? rawSuccessTitle !== 'sync_success'
        ? rawSuccessTitle
        : language === 'he'
          ? 'הסנכרון הושלם'
          : 'Sync Complete'
      : t('sync_window_title');

  const stageLabel = hasError
    ? syncError ||
      (language === 'he' ? 'הסנכרון נכשל' : 'Synchronization failed')
    : isComplete
      ? language === 'he'
        ? `הכל מעודכן${lastSyncedAt ? ` (${formatTimeHM(lastSyncedAt, language)})` : ''}`
        : `All up to date${lastSyncedAt ? ` (${formatTimeHM(lastSyncedAt, language)})` : ''}`
      : syncProgress?.message || t('syncing');

  const handleDismiss = () => {
    if (syncError) {
      setDismissedError(syncError);
    }
    ctxCloseSyncWindow?.();
  };

  const toggleCollapsed = (next: boolean) => {
    animateLayout();
    setLocalCollapsed(next);
    ctxSetCollapsed?.(next);
  };

  const animStyle = isJestEnv
    ? undefined
    : {
        opacity: enterAnim,
        transform: [
          {
            translateY: enterAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [12, 0],
            }),
          },
          {
            scale: enterAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [0.97, 1],
            }),
          },
        ],
      };

  if (collapsed) {
    return (
      <Animated.View
        testID="sync-progress-collapsed"
        style={[
          styles.floatingAnchor,
          { bottom: bottomOffset },
          sidePosition,
          animStyle,
        ]}
      >
        <TouchableOpacity
          activeOpacity={0.88}
          onPress={() => toggleCollapsed(false)}
          accessibilityRole="button"
          accessibilityLabel={t('sync_expand')}
          style={[
            styles.collapsedPill,
            {
              backgroundColor: surfaceBg,
              borderColor: surfaceBorder,
              flexDirection: rowDir,
            },
          ]}
        >
          {hasError ? (
            <InfoIcon size={14} color={theme.danger} />
          ) : isComplete ? (
            <CheckIcon size={14} color={successColor} />
          ) : (
            <SpinningIcon spinning={isSyncing}>
              <RefreshIcon size={14} color={theme.primary} />
            </SpinningIcon>
          )}
          <Text
            style={[styles.collapsedText, { color: theme.text, textAlign }]}
            numberOfLines={1}
          >
            {hasError
              ? language === 'he'
                ? 'שגיאה'
                : 'Sync error'
              : isComplete
                ? `${language === 'he' ? 'הסתיים' : 'Done'} 100%`
                : `${percent}%`}
          </Text>
          <TouchableOpacity
            testID="sync-expand-btn"
            onPress={() => toggleCollapsed(false)}
            style={styles.pillChevronBtn}
            accessibilityLabel={t('sync_expand')}
          >
            <ChevronUpIcon size={14} color={theme.textSecondary} />
          </TouchableOpacity>
          {!isSyncing && (
            <TouchableOpacity
              onPress={handleDismiss}
              style={styles.pillChevronBtn}
              accessibilityLabel={language === 'he' ? 'סגור' : 'Dismiss'}
            >
              <CloseIcon size={13} color={theme.textSecondary} />
            </TouchableOpacity>
          )}
        </TouchableOpacity>
      </Animated.View>
    );
  }

  return (
    <>
      <Pressable
        style={styles.outsideDismissBackdrop}
        onPress={() => toggleCollapsed(true)}
        accessibilityRole="button"
        accessibilityLabel={t('sync_collapse')}
      />
      <Animated.View
        testID="sync-progress-window"
        style={[
          styles.floatingAnchor,
          styles.windowBox,
          {
            bottom: bottomOffset,
            backgroundColor: surfaceBg,
            borderColor: surfaceBorder,
          },
          sidePosition,
          animStyle,
        ]}
      >
        {/* Window Header */}
        <View
          style={[
            styles.windowHeader,
            { borderBottomColor: theme.border, flexDirection: rowDir },
          ]}
        >
          <View style={[styles.windowTitleRow, { flexDirection: rowDir }]}>
            {hasError ? (
              <InfoIcon size={14} color={theme.danger} />
            ) : isComplete ? (
              <CheckIcon size={14} color={successColor} />
            ) : (
              <SpinningIcon spinning={isSyncing}>
                <RefreshIcon size={14} color={theme.primary} />
              </SpinningIcon>
            )}
            <Text
              style={[styles.windowTitle, { color: theme.text, textAlign }]}
              numberOfLines={1}
            >
              {headerTitle}
            </Text>
          </View>

        <View style={[styles.headerActions, { flexDirection: rowDir }]}>
          <TouchableOpacity
            testID="sync-collapse-btn"
            onPress={() => toggleCollapsed(true)}
            style={styles.iconBtn}
            accessibilityLabel={t('sync_collapse')}
          >
            <ChevronDownIcon size={15} color={theme.textSecondary} />
          </TouchableOpacity>
          {!isSyncing && (
            <TouchableOpacity
              onPress={handleDismiss}
              style={styles.iconBtn}
              accessibilityLabel={language === 'he' ? 'סגור' : 'Dismiss'}
            >
              <CloseIcon size={14} color={theme.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* 7-Step Task Checklist */}
      <View style={styles.tasksList}>
        {tasks.map((task) => {
          let status: TaskStatus = 'pending';
          if (hasError && task.order === currentStageIndex) {
            status = 'failed';
          } else if (currentStageIndex > task.order || isComplete) {
            status = 'done';
          } else if (currentStageIndex === task.order && isSyncing) {
            status = 'active';
          }

          return (
            <View
              key={task.id}
              style={[
                styles.taskItem,
                { flexDirection: rowDir },
                status === 'active' && {
                  backgroundColor: `${theme.primary}16`,
                },
              ]}
            >
              <View
                style={[
                  styles.taskBadge,
                  status === 'done'
                    ? styles.badgeDone
                    : status === 'active'
                      ? {
                          backgroundColor: `${theme.primary}24`,
                          borderColor: theme.primary,
                        }
                      : status === 'failed'
                        ? styles.badgeFailed
                        : {
                            backgroundColor: theme.backgroundSelected,
                            borderColor: theme.border,
                          },
                ]}
              >
                {status === 'done' ? (
                  <CheckIcon size={9} color={successColor} />
                ) : status === 'active' ? (
                  <SpinningIcon spinning={true}>
                    <RefreshIcon size={9} color={theme.primary} />
                  </SpinningIcon>
                ) : status === 'failed' ? (
                  <CloseIcon size={9} color="#ef4444" />
                ) : (
                  <View
                    style={[
                      styles.pendingDot,
                      { backgroundColor: theme.textSecondary },
                    ]}
                  />
                )}
              </View>

              <View style={styles.taskContent}>
                <Text
                  style={[
                    styles.taskTitle,
                    {
                      color:
                        status === 'active'
                          ? theme.primary
                          : status === 'pending'
                            ? theme.textSecondary
                            : theme.text,
                      fontWeight: status === 'active' ? '700' : '500',
                      textAlign,
                    },
                  ]}
                  numberOfLines={1}
                >
                  {task.title}
                </Text>
                {task.subtext ? (
                  <Text
                    style={[
                      styles.taskSubtext,
                      { color: theme.textSecondary, textAlign },
                    ]}
                    numberOfLines={1}
                  >
                    {task.subtext}
                  </Text>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>

      {/* Window Footer: Live Status Message + Tabular % */}
      <View
        style={[
          styles.windowFooter,
          { borderTopColor: theme.border, flexDirection: rowDir },
        ]}
      >
        <Text
          style={[
            styles.footerMsg,
            {
              color: hasError ? theme.danger : theme.textSecondary,
              textAlign,
            },
          ]}
          numberOfLines={1}
        >
          {stageLabel}
        </Text>
        <Text style={[styles.footerPct, { color: accentColor }]}>
          {hasError ? '!' : `${percent}%`}
        </Text>
      </View>
    </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  outsideDismissBackdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 999,
  },
  floatingAnchor: {
    position: 'absolute',
    zIndex: 1000,
    elevation: 10,
  },
  windowBox: {
    width: 268,
    maxWidth: '90%',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 10,
    gap: 7,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
  },
  collapsedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
  },
  collapsedText: {
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  pillChevronBtn: {
    padding: 2,
  },
  windowHeader: {
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  windowTitleRow: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  windowTitle: {
    fontSize: 12.5,
    fontWeight: '700',
    flex: 1,
  },
  headerActions: {
    alignItems: 'center',
    gap: 4,
  },
  iconBtn: {
    padding: 3,
    borderRadius: 6,
  },
  tasksList: {
    gap: 3,
  },
  taskItem: {
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 5,
    paddingVertical: 3.5,
    borderRadius: 7,
  },
  taskBadge: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  badgeDone: {
    backgroundColor: 'rgba(34, 197, 94, 0.18)',
    borderColor: 'rgba(34, 197, 94, 0.5)',
  },
  badgeFailed: {
    backgroundColor: 'rgba(239, 68, 68, 0.18)',
    borderColor: '#ef4444',
  },
  pendingDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    opacity: 0.55,
  },
  taskContent: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  taskTitle: {
    fontSize: 11.5,
    lineHeight: 15,
  },
  taskSubtext: {
    fontSize: 10,
    lineHeight: 13,
  },
  windowFooter: {
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  footerMsg: {
    fontSize: 11,
    flex: 1,
  },
  footerPct: {
    fontSize: 11.5,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});
