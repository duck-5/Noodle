import { Tabs } from 'expo-router';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/services/i18n';

export default function AppTabs() {
  const colors = useTheme();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: {
          backgroundColor: colors.backgroundElement,
          borderTopColor: colors.border,
          height: 60,
          paddingBottom: 8,
        },
        headerShown: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('dashboard'),
          tabBarLabel: `📊 ${t('dashboard')}`,
        }}
      />
      <Tabs.Screen
        name="courses"
        options={{
          title: t('courses'),
          tabBarLabel: `📚 ${t('courses')}`,
        }}
      />
      <Tabs.Screen
        name="files"
        options={{
          title: t('files'),
          tabBarLabel: `📁 ${t('files')}`,
        }}
      />
      <Tabs.Screen
        name="grades"
        options={{
          title: t('grades'),
          tabBarLabel: `🎓 ${t('grades')}`,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t('settings'),
          tabBarLabel: `⚙️ ${t('settings')}`,
        }}
      />
    </Tabs>
  );
}
