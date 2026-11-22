import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { DarkTheme, DefaultTheme, Href, Stack, ThemeProvider, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { SsoWebViewModal } from '@/components/SsoWebViewModal';
import { SyncProgressBanner } from '@/components/SyncProgressBanner';
import { TourOverlay } from '@/components/TourOverlay';
import { CloseIcon, RefreshIcon, ShieldIcon } from '@/components/icons/NoodleIcons';
import { AppStateProvider, useAppState } from '@/hooks/use-app-state';
import { PreferencesProvider, usePreferences } from '@/hooks/use-preferences';

WebBrowser.maybeCompleteAuthSession();

function InnerLayout() {
  const router = useRouter();
  const segments = useSegments();
  const insets = useSafeAreaInsets();
  const { effectiveThemeName, theme, isRtl, t } = usePreferences();
  const {
    isInitialized,
    isAuthenticated,
    hasCompletedOnboarding,
    sessionExpired,
    clearSessionExpired,
    reconnectWithToken,
  } = useAppState();
  const [reconnectModalVisible, setReconnectModalVisible] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

  const isDark = effectiveThemeName === 'dark' || effectiveThemeName === 'coffee';

  const customNavigationTheme = {
    ...(isDark ? DarkTheme : DefaultTheme),
    colors: {
      ...(isDark ? DarkTheme.colors : DefaultTheme.colors),
      background: theme.background,
      card: theme.backgroundElement,
      text: theme.text,
      border: theme.border,
      primary: theme.primary,
    },
  };

  useEffect(() => {
    if (!isInitialized) return;

    const firstSegment = segments[0] as string | undefined;
    const inOnboarding = firstSegment === 'onboarding';
    const inOAuthRedirect = firstSegment === 'oauth2redirect';

    if (!isAuthenticated || !hasCompletedOnboarding) {
      if (!inOnboarding && !inOAuthRedirect) {
        router.replace('/onboarding' as Href);
      }
      return;
    }

    if (inOnboarding || !firstSegment) {
      router.replace('/(tabs)' as Href);
    }
  }, [isInitialized, isAuthenticated, hasCompletedOnboarding, segments, router]);

  const firstSegment = segments[0] as string | undefined;
  const showReconnectBanner =
    isInitialized &&
    isAuthenticated &&
    hasCompletedOnboarding &&
    sessionExpired &&
    firstSegment !== 'onboarding' &&
    firstSegment !== 'oauth2redirect';

  const rowDir = isRtl ? 'row-reverse' : 'row';
  const textAlign = isRtl ? 'right' : 'left';

  return (
    <ThemeProvider value={customNavigationTheme}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <AnimatedSplashOverlay />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="course/[id]" />
        <Stack.Screen name="oauth2redirect" />
      </Stack>

      {showReconnectBanner && (
        <View
          pointerEvents="box-none"
          style={[
            styles.reconnectOverlay,
            { top: Math.max(insets.top, 8) + 8 },
          ]}
        >
          <View
            testID="session-expired-banner"
            style={[
              styles.reconnectCard,
              {
                backgroundColor: theme.backgroundElement,
                borderColor: theme.warning,
                flexDirection: rowDir,
              },
            ]}
          >
            <View style={[styles.reconnectIconWrap, { backgroundColor: `${theme.warning}20` }]}>
              <ShieldIcon size={18} color={theme.warning} />
            </View>

            <View style={styles.reconnectTextCol}>
              <Text style={[styles.reconnectTitle, { color: theme.text, textAlign }]}>
                {t('session_expired_title')}
              </Text>
              <Text
                style={[styles.reconnectDesc, { color: theme.textSecondary, textAlign }]}
                numberOfLines={2}
              >
                {t('session_expired_desc')}
              </Text>
            </View>

            <TouchableOpacity
              testID="session-reconnect-btn"
              disabled={reconnecting}
              onPress={() => setReconnectModalVisible(true)}
              style={[
                styles.reconnectBtn,
                { backgroundColor: theme.primary, flexDirection: rowDir },
              ]}
            >
              {reconnecting ? (
                <ActivityIndicator size="small" color={theme.onPrimary} />
              ) : (
                <RefreshIcon size={14} color={theme.onPrimary} />
              )}
              <Text style={[styles.reconnectBtnText, { color: theme.onPrimary }]}>
                {reconnecting ? t('reconnecting_btn') : t('reconnect_btn')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              testID="session-dismiss-btn"
              onPress={clearSessionExpired}
              style={[styles.dismissBtn, { backgroundColor: theme.backgroundSelected }]}
              accessibilityLabel={t('cancel')}
            >
              <CloseIcon size={15} color={theme.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      <SsoWebViewModal
        visible={reconnectModalVisible}
        mode="moodle"
        onClose={() => setReconnectModalVisible(false)}
        onTokenCaptured={(token) => {
          setReconnectModalVisible(false);
          setReconnecting(true);
          void reconnectWithToken(token)
            .catch(() => {})
            .finally(() => setReconnecting(false));
        }}
      />

      <SyncProgressBanner />
      <TourOverlay />
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  reconnectOverlay: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 900,
    alignItems: 'center',
  },
  reconnectCard: {
    width: '100%',
    maxWidth: 560,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
    gap: 10,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 10,
    elevation: 6,
  },
  reconnectIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reconnectTextCol: {
    flex: 1,
    gap: 2,
  },
  reconnectTitle: {
    fontSize: 13.5,
    fontWeight: '700',
  },
  reconnectDesc: {
    fontSize: 12,
    lineHeight: 16,
  },
  reconnectBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 9,
    alignItems: 'center',
    gap: 6,
  },
  reconnectBtnText: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  dismissBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default function RootLayout() {
  return (
    <PreferencesProvider>
      <AppStateProvider>
        <InnerLayout />
      </AppStateProvider>
    </PreferencesProvider>
  );
}
