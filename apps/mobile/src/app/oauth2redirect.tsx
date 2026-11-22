import React, { useEffect } from 'react';
import * as WebBrowser from 'expo-web-browser';
import { useRouter } from 'expo-router';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { usePreferences } from '@/hooks/use-preferences';

WebBrowser.maybeCompleteAuthSession();

export default function OAuth2RedirectScreen() {
  const router = useRouter();
  const { theme } = usePreferences();

  useEffect(() => {
    WebBrowser.maybeCompleteAuthSession();
    const timer = setTimeout(() => {
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/settings');
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [router]);

  return (
    <View style={[styles.container, { backgroundColor: theme?.background || '#FAF5EB' }]}>
      <ActivityIndicator size="large" color={theme?.primary || '#3b82f6'} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
