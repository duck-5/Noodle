import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  Image,
  LayoutChangeEvent,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Href, Tabs, usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppState } from '@/hooks/use-app-state';
import { usePreferences } from '@/hooks/use-preferences';
import { useResponsiveLayout } from '@/hooks/use-responsive-layout';
import { getPreference, setPreference } from '@/services/database';
import {
  AssignmentsIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CourseIcon,
  DashboardIcon,
  GradesIcon,
  LogoutIcon,
  RecordingsIcon,
  SettingsIcon,
  TourIcon,
} from '@/components/icons/NoodleIcons';
import { animateLayout } from '@/components/ui/NoodleAnimations';

const isJestEnv =
  typeof process !== 'undefined' && Boolean(process.env?.JEST_WORKER_ID);

type NavKey =
  | 'index'
  | 'courses'
  | 'assignments'
  | 'recordings'
  | 'grades'
  | 'settings';
type NavHref =
  | '/'
  | '/courses'
  | '/assignments'
  | '/recordings'
  | '/grades'
  | '/settings';
type NavLabelKey =
  | 'home'
  | 'courses'
  | 'assignments'
  | 'recordings'
  | 'grades'
  | 'settings';

const ALL_NAV_ITEMS: {
  key: NavKey;
  href: NavHref;
  labelKey: NavLabelKey;
}[] = [
  { key: 'index', href: '/', labelKey: 'home' },
  { key: 'courses', href: '/courses', labelKey: 'courses' },
  { key: 'assignments', href: '/assignments', labelKey: 'assignments' },
  { key: 'recordings', href: '/recordings', labelKey: 'recordings' },
  { key: 'grades', href: '/grades', labelKey: 'grades' },
  { key: 'settings', href: '/settings', labelKey: 'settings' },
];

const TAB_TRANSITION_MS = 260;

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const router = useRouter();
  const pathname = usePathname() || '/';
  const { isLandscapeTablet } = useResponsiveLayout();
  const { theme, isRtl, t } = usePreferences();
  const { disconnectAccount, startTour, tourActive } = useAppState();

  const navItems = useMemo(
    () =>
      isLandscapeTablet
        ? ALL_NAV_ITEMS.filter((item) => item.key !== 'courses')
        : ALL_NAV_ITEMS,
    [isLandscapeTablet]
  );

  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return getPreference('sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });
  const [disconnecting, setDisconnecting] = useState<boolean>(false);

  const toggleSidebar = useCallback(() => {
    animateLayout();
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        setPreference('sidebar_collapsed', next ? 'true' : 'false');
      } catch {
        // Ignore persistence errors in restricted environments
      }
      return next;
    });
  }, []);

  const isNavActive = useCallback(
    (routeKey: NavKey): boolean => {
      if (routeKey === 'index') {
        return (
          pathname === '/' ||
          pathname === '/index' ||
          pathname === '/(tabs)' ||
          pathname === '/(tabs)/index'
        );
      }
      return (
        pathname === `/${routeKey}` ||
        pathname.startsWith(`/${routeKey}/`) ||
        pathname === `/(tabs)/${routeKey}`
      );
    },
    [pathname]
  );

  const navigateTo = useCallback(
    (href: NavHref) => {
      const navRouter = router as {
        navigate?: (target: string) => void;
        replace: (target: string) => void;
      };
      if (typeof navRouter.navigate === 'function') {
        navRouter.navigate(href);
      } else {
        navRouter.replace(href);
      }
    },
    [router]
  );

  useEffect(() => {
    if (isLandscapeTablet && isNavActive('courses')) {
      navigateTo('/');
    }
  }, [isLandscapeTablet, isNavActive, navigateTo]);

  const activeIndex = useMemo(() => {
    const idx = navItems.findIndex((item) => isNavActive(item.key));
    return idx >= 0 ? idx : 0;
  }, [navItems, isNavActive]);

  const [swipeTranslateX] = useState(() => new Animated.Value(0));
  const [containerWidth, setContainerWidth] = useState<number>(0);

  const handleTabsLayout = useCallback((e: LayoutChangeEvent) => {
    const measured = Math.round(e.nativeEvent.layout.width);
    if (measured > 0) {
      setContainerWidth((prev) => (Math.abs(prev - measured) > 1 ? measured : prev));
    }
  }, []);

  const resetSwipeTranslate = useCallback(() => {
    if (isJestEnv) {
      swipeTranslateX.setValue(0);
    } else {
      Animated.spring(swipeTranslateX, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 0,
      }).start();
    }
  }, [swipeTranslateX]);

  const settleSwipeAfterNavigation = useCallback(() => {
    if (isJestEnv) {
      swipeTranslateX.setValue(0);
    } else {
      // Match the tab transition curve so release handoff glides forward without recoiling
      Animated.timing(swipeTranslateX, {
        toValue: 0,
        duration: TAB_TRANSITION_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  }, [swipeTranslateX]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (_evt, g) =>
          !tourActive &&
          g.numberActiveTouches <= 1 &&
          Math.abs(g.dx) > 24 &&
          Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderTerminationRequest: () => true,
        onPanResponderMove: (_evt, g) => {
          const step = isRtl ? (g.dx > 0 ? 1 : -1) : g.dx < 0 ? 1 : -1;
          const target = activeIndex + step;
          const canMove = target >= 0 && target < navItems.length;
          const damped = Math.max(
            -72,
            Math.min(72, g.dx * (canMove ? 0.42 : 0.16))
          );
          swipeTranslateX.setValue(damped);
        },
        onPanResponderRelease: (_evt, g) => {
          const step = isRtl ? (g.dx > 0 ? 1 : -1) : g.dx < 0 ? 1 : -1;
          const targetIndex = activeIndex + step;
          const passedDistance = Math.abs(g.dx) > 56;
          const passedVelocity = Math.abs(g.vx) > 0.45 && Math.abs(g.dx) > 16;

          if (
            (passedDistance || passedVelocity) &&
            targetIndex >= 0 &&
            targetIndex < navItems.length
          ) {
            navigateTo(navItems[targetIndex].href);
            settleSwipeAfterNavigation();
            return;
          }
          resetSwipeTranslate();
        },
        onPanResponderTerminate: () => {
          resetSwipeTranslate();
        },
      }),
    [
      activeIndex,
      isRtl,
      navItems,
      navigateTo,
      resetSwipeTranslate,
      settleSwipeAfterNavigation,
      swipeTranslateX,
      tourActive,
    ]
  );

  const handleTakeTour = useCallback(() => {
    if (!isNavActive('index')) {
      navigateTo('/');
    }
    startTour();
  }, [isNavActive, navigateTo, startTour]);

  const performDisconnect = useCallback(async () => {
    setDisconnecting(true);
    try {
      await disconnectAccount();
      router.replace('/onboarding' as Href);
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

  const renderNavIcon = (key: NavKey, color: string, size: number) => {
    switch (key) {
      case 'index':
        return <DashboardIcon color={color} size={size} />;
      case 'courses':
        return <CourseIcon color={color} size={size} />;
      case 'assignments':
        return <AssignmentsIcon color={color} size={size} />;
      case 'recordings':
        return <RecordingsIcon color={color} size={size} />;
      case 'grades':
        return <GradesIcon color={color} size={size} />;
      case 'settings':
        return <SettingsIcon color={color} size={size} />;
    }
  };

  const bottomPadding = Math.max(8, insets.bottom);
  const sidebarWidth = (sidebarCollapsed ? 68 : 220) + (isRtl ? insets.right : insets.left);
  const rowDir = isRtl ? 'row-reverse' : 'row';
  const showChevronRight = isRtl ? !sidebarCollapsed : sidebarCollapsed;
  const fallbackTabsWidth = Math.max(
    240,
    windowWidth - (isLandscapeTablet ? sidebarWidth : 0)
  );
  const slideWidth = containerWidth > 0 ? containerWidth : fallbackTabsWidth;

  const tabTransitionSpec = useMemo(
    () => ({
      animation: 'timing' as const,
      config: {
        duration: isJestEnv ? 0 : TAB_TRANSITION_MS,
        easing: Easing.out(Easing.cubic),
      },
    }),
    []
  );

  const tabSceneInterpolator = useCallback(
    ({ current }: { current: { progress: Animated.Value } }) => ({
      sceneStyle: {
        opacity: current.progress.interpolate({
          inputRange: [-1, -0.85, 0, 0.85, 1],
          outputRange: [0, 0.92, 1, 0.92, 0],
          extrapolate: 'clamp',
        }),
        transform: [
          {
            translateX: current.progress.interpolate({
              inputRange: [-1, 0, 1],
              outputRange: isRtl
                ? [slideWidth, 0, -slideWidth]
                : [-slideWidth, 0, slideWidth],
              extrapolate: 'clamp',
            }),
          },
        ],
      },
    }),
    [isRtl, slideWidth]
  );

  return (
    <View
      style={[
        styles.shell,
        {
          flexDirection: isLandscapeTablet ? rowDir : 'column',
          backgroundColor: theme.background,
        },
      ]}
    >
      {isLandscapeTablet && (
        <View
          testID="tablet-sidebar"
          style={[
            styles.sidebar,
            {
              width: sidebarWidth,
              backgroundColor: theme.backgroundElement,
              borderColor: theme.border,
              borderRightWidth: isRtl ? 0 : 1,
              borderLeftWidth: isRtl ? 1 : 0,
              paddingTop: Math.max(12, insets.top),
              paddingBottom: Math.max(12, insets.bottom),
              paddingLeft: isRtl ? 8 : Math.max(10, insets.left),
              paddingRight: isRtl ? Math.max(10, insets.right) : 8,
            },
          ]}
        >
          {/* Sidebar Brand Header */}
          <View
            style={[
              styles.sidebarHeader,
              {
                flexDirection: rowDir,
                justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                borderBottomColor: theme.border,
              },
            ]}
          >
            <View
              style={[
                styles.brandRow,
                {
                  flexDirection: rowDir,
                  justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                },
              ]}
            >
              <Image
                source={require('@/assets/logo.png')}
                style={styles.brandLogo}
                resizeMode="contain"
              />
              {!sidebarCollapsed && (
                <Text style={[styles.brandTitle, { color: theme.text }]} numberOfLines={1}>
                  Noodle
                </Text>
              )}
            </View>
          </View>

          {/* Navigation Items */}
          <ScrollView
            style={styles.sidebarNavScroll}
            contentContainerStyle={styles.sidebarNavContent}
            showsVerticalScrollIndicator={false}
          >
            {navItems.map((item) => {
              const active = isNavActive(item.key);
              const color = active ? theme.primary : theme.textSecondary;
              return (
                <TouchableOpacity
                  key={item.key}
                  testID={`sidebar-nav-${item.key}`}
                  onPress={() => navigateTo(item.href)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={t(item.labelKey)}
                  style={[
                    styles.navItem,
                    {
                      flexDirection: rowDir,
                      justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                      backgroundColor: active ? `${theme.primary}18` : 'transparent',
                      borderColor: active ? `${theme.primary}44` : 'transparent',
                    },
                  ]}
                >
                  {renderNavIcon(item.key, color, 20)}
                  {!sidebarCollapsed && (
                    <Text
                      style={[
                        styles.navLabel,
                        {
                          color: active ? theme.primary : theme.text,
                          fontWeight: active ? '800' : '600',
                          textAlign: isRtl ? 'right' : 'left',
                        },
                      ]}
                      numberOfLines={1}
                    >
                      {t(item.labelKey)}
                    </Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Sidebar Footer: Collapse Toggle, Take Tour & Disconnect */}
          <View style={[styles.sidebarFooter, { borderTopColor: theme.border }]}>
            <TouchableOpacity
              testID="sidebar-toggle-btn"
              onPress={toggleSidebar}
              accessibilityRole="button"
              accessibilityLabel={sidebarCollapsed ? t('sidebar_expand') : t('sidebar_collapse')}
              style={[
                styles.footerBtn,
                {
                  flexDirection: rowDir,
                  justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                },
              ]}
            >
              {showChevronRight ? (
                <ChevronRightIcon size={18} color={theme.textSecondary} />
              ) : (
                <ChevronLeftIcon size={18} color={theme.textSecondary} />
              )}
              {!sidebarCollapsed && (
                <Text
                  style={[
                    styles.footerBtnText,
                    { color: theme.text, textAlign: isRtl ? 'right' : 'left' },
                  ]}
                  numberOfLines={1}
                >
                  {t('sidebar_collapse')}
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              testID="sidebar-tour-btn"
              onPress={handleTakeTour}
              accessibilityRole="button"
              accessibilityLabel={t('take_tour_btn')}
              style={[
                styles.footerBtn,
                {
                  flexDirection: rowDir,
                  justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                },
              ]}
            >
              <TourIcon size={18} color={theme.primary} />
              {!sidebarCollapsed && (
                <Text
                  style={[
                    styles.footerBtnText,
                    { color: theme.text, textAlign: isRtl ? 'right' : 'left' },
                  ]}
                  numberOfLines={1}
                >
                  {t('take_tour_btn')}
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              testID="sidebar-disconnect-btn"
              onPress={handleDisconnectPress}
              disabled={disconnecting}
              accessibilityRole="button"
              accessibilityLabel={t('disconnect_account')}
              style={[
                styles.footerBtn,
                {
                  flexDirection: rowDir,
                  justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                  opacity: disconnecting ? 0.6 : 1,
                },
              ]}
            >
              <LogoutIcon size={18} color={theme.danger} />
              {!sidebarCollapsed && (
                <Text
                  style={[
                    styles.footerBtnText,
                    { color: theme.danger, textAlign: isRtl ? 'right' : 'left' },
                  ]}
                  numberOfLines={1}
                >
                  {t('disconnect_account')}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}

      <Animated.View
        testID="tabs-swipe-container"
        onLayout={handleTabsLayout}
        style={[
          styles.tabsWrap,
          { transform: [{ translateX: swipeTranslateX }] },
        ]}
        {...panResponder.panHandlers}
      >
        <Tabs
          detachInactiveScreens={false}
          tabBar={isLandscapeTablet ? () => null : undefined}
          screenOptions={{
            headerShown: false,
            lazy: false,
            animation: 'shift',
            transitionSpec: tabTransitionSpec,
            sceneStyleInterpolator: tabSceneInterpolator,
            sceneStyle: { backgroundColor: theme.background },
            tabBarActiveTintColor: theme.primary,
            tabBarInactiveTintColor: theme.textSecondary,
            tabBarStyle: isLandscapeTablet
              ? { display: 'none' }
              : {
                  backgroundColor: theme.backgroundElement,
                  borderTopColor: theme.border,
                  borderTopWidth: 1,
                  paddingBottom: bottomPadding,
                  paddingTop: 6,
                  height: 58 + bottomPadding,
                },
            tabBarItemStyle: {
              paddingHorizontal: 0,
            },
            tabBarLabelStyle: {
              fontSize: 10.5,
              fontWeight: '700',
            },
          }}
        >
          <Tabs.Screen
            name="index"
            options={{
              title: t('home'),
              tabBarIcon: ({ color, size }) => (
                <DashboardIcon
                  color={typeof color === 'string' ? color : theme.primary}
                  size={size ?? 20}
                />
              ),
            }}
          />
          <Tabs.Screen
            name="courses"
            options={{
              title: t('courses'),
              lazy: isLandscapeTablet,
              href: isLandscapeTablet ? null : undefined,
              tabBarIcon: ({ color, size }) => (
                <CourseIcon
                  color={typeof color === 'string' ? color : theme.primary}
                  size={size ?? 20}
                />
              ),
            }}
          />
          <Tabs.Screen
            name="assignments"
            options={{
              title: t('assignments'),
              tabBarIcon: ({ color, size }) => (
                <AssignmentsIcon
                  color={typeof color === 'string' ? color : theme.primary}
                  size={size ?? 20}
                />
              ),
            }}
          />
          <Tabs.Screen
            name="recordings"
            options={{
              title: t('recordings'),
              tabBarIcon: ({ color, size }) => (
                <RecordingsIcon
                  color={typeof color === 'string' ? color : theme.primary}
                  size={size ?? 20}
                />
              ),
            }}
          />
          <Tabs.Screen
            name="grades"
            options={{
              title: t('grades'),
              tabBarIcon: ({ color, size }) => (
                <GradesIcon
                  color={typeof color === 'string' ? color : theme.primary}
                  size={size ?? 20}
                />
              ),
            }}
          />
          <Tabs.Screen
            name="settings"
            options={{
              title: t('settings'),
              tabBarIcon: ({ color, size }) => (
                <SettingsIcon
                  color={typeof color === 'string' ? color : theme.primary}
                  size={size ?? 20}
                />
              ),
            }}
          />
        </Tabs>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
  },
  tabsWrap: {
    flex: 1,
    minWidth: 0,
  },
  sidebar: {
    justifyContent: 'space-between',
  },
  sidebarHeader: {
    alignItems: 'center',
    paddingBottom: 12,
    marginBottom: 8,
    borderBottomWidth: 1,
    minHeight: 44,
    gap: 8,
  },
  brandRow: {
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  brandLogo: {
    width: 28,
    height: 28,
    borderRadius: 6,
  },
  brandTitle: {
    fontSize: 17,
    fontWeight: '800',
  },
  sidebarNavScroll: {
    flex: 1,
  },
  sidebarNavContent: {
    gap: 6,
    paddingVertical: 4,
  },
  navItem: {
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
  },
  navLabel: {
    fontSize: 14,
    flex: 1,
  },
  sidebarFooter: {
    borderTopWidth: 1,
    paddingTop: 10,
    gap: 6,
  },
  footerBtn: {
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 8,
  },
  footerBtnText: {
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
  },
});
