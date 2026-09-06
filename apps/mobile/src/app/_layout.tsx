import { DarkTheme, DefaultTheme, ThemeProvider, Stack } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { PreferencesProvider, usePreferences } from '@/hooks/use-preferences';

WebBrowser.maybeCompleteAuthSession();

function InnerLayout() {
  const { themeMode, theme } = usePreferences();
  const isDark = themeMode === 'dark';

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

  return (
    <ThemeProvider value={customNavigationTheme}>
      <AnimatedSplashOverlay />
      <Stack screenOptions={{ headerShown: false }} />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <PreferencesProvider>
      <InnerLayout />
    </PreferencesProvider>
  );
}
