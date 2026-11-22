import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppState } from '@/hooks/use-app-state';
import { usePreferences } from '@/hooks/use-preferences';
import { useResponsiveLayout } from '@/hooks/use-responsive-layout';
import { TrackedCoursesSection } from '@/components/TrackedCoursesSection';

export default function CoursesScreen() {
  const { width, isLandscapeTablet } = useResponsiveLayout();
  const { theme } = usePreferences();
  const { isSyncing, triggerSync } = useAppState();

  const containerMaxWidth = isLandscapeTablet
    ? 1280
    : width >= 600
      ? 860
      : 680;

  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={[styles.safeArea, { backgroundColor: theme.background }]}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={isSyncing}
            onRefresh={() => {
              void triggerSync({ manual: true }).catch(() => {});
            }}
            tintColor={theme.primary}
            colors={[theme.primary]}
          />
        }
      >
        <View
          style={[
            styles.pageContainer,
            { maxWidth: containerMaxWidth, alignSelf: 'center' },
          ]}
        >
          <TrackedCoursesSection />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    paddingBottom: 32,
  },
  pageContainer: {
    width: '100%',
    gap: 14,
  },
});
