import { Platform } from 'react-native';
import { Assignment, isActivityHidden, isActivityCompleted } from '@tautracker/moodle-client';
import { getPreference } from './database';
import { getLanguage } from './i18n';

// expo-notifications remote push support was removed from Expo Go in SDK 53.
// All calls are guarded so the app still runs cleanly on Web, Jest, and Expo Go.
let Notifications: typeof import('expo-notifications') | null = null;

if (Platform.OS !== 'web') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Notifications = require('expo-notifications');
  } catch (e) {
    console.warn('expo-notifications is not available in this environment:', e);
  }
}

if (Notifications && typeof Notifications.setNotificationHandler === 'function') {
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
  } catch (e) {
    console.warn('expo-notifications: failed to set notification handler:', e);
  }
}

function resolveNotificationLanguage(): 'he' | 'en' {
  const pref = getPreference('language');
  if (pref === 'he' || pref === 'en') {
    return pref;
  }
  try {
    return getLanguage() === 'en' ? 'en' : 'he';
  } catch {
    return 'he';
  }
}

function formatReminderContent(
  kind: '24h' | '1h',
  assignment: Assignment,
  lang: 'he' | 'en'
): { title: string; body: string } {
  const body = `${assignment.name} - ${assignment.courseName}`;
  if (kind === '24h') {
    return {
      title: lang === 'he' ? 'תזכורת: מטלה להגשה מחר' : 'Assignment due tomorrow',
      body,
    };
  }
  return {
    title: lang === 'he' ? 'תזכורת דחופה: נותרה שעה להגשה' : 'Due in 1 hour',
    body,
  };
}

const DEADLINE_CHANNEL_ID = 'deadline-reminders';

export async function ensureNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android' || !Notifications) return;
  if (typeof Notifications.setNotificationChannelAsync !== 'function') return;
  try {
    await Notifications.setNotificationChannelAsync(DEADLINE_CHANNEL_ID, {
      name: 'Deadline Reminders',
      importance: Notifications.AndroidImportance?.HIGH ?? 4,
      vibrationPattern: [0, 250, 250, 250],
    });
  } catch (e) {
    console.warn('expo-notifications: failed to create notification channel:', e);
  }
}

export async function scheduleDeadlineNotifications(assignments: Assignment[]): Promise<void> {
  if (Platform.OS === 'web' || !Notifications) return;

  try {
    await ensureNotificationChannel();

    // Always clear previously scheduled reminders first so disabling notifications cleans stale alerts
    await Notifications.cancelAllScheduledNotificationsAsync();

    if (getPreference('notifications_enabled') === 'false') {
      return;
    }

    const lang = resolveNotificationLanguage();

    let hiddenIds: (string | number)[] = [];
    let completedIds: (string | number)[] = [];
    let uncompletedIds: (string | number)[] = [];
    try {
      const h = getPreference('hidden_assignments');
      if (h) hiddenIds = JSON.parse(h);
      const c = getPreference('completed_assignments');
      if (c) completedIds = JSON.parse(c);
      const u = getPreference('uncompleted_assignments');
      if (u) uncompletedIds = JSON.parse(u);
    } catch {
      // Ignore malformed JSON in preferences
    }

    const now = new Date();
    const triggerType = Notifications.SchedulableTriggerInputTypes?.DATE ?? ('date' as any);

    for (const assignment of assignments) {
      if (!assignment.deadline) continue;
      if (isActivityHidden(assignment, hiddenIds)) continue;
      if (isActivityCompleted(assignment, completedIds, uncompletedIds)) continue;

      const deadline = new Date(assignment.deadline);
      const hoursUntilDeadline = (deadline.getTime() - now.getTime()) / (1000 * 60 * 60);

      if (hoursUntilDeadline <= 0) continue;

      // 24h notification
      if (hoursUntilDeadline > 24) {
        const triggerDate = new Date(deadline.getTime() - 24 * 60 * 60 * 1000);
        const content24 = formatReminderContent('24h', assignment, lang);
        await Notifications.scheduleNotificationAsync({
          content: {
            title: content24.title,
            body: content24.body,
            data: { assignmentId: assignment.id, uid: assignment.uid, link: assignment.link },
          },
          trigger: {
            type: triggerType,
            date: triggerDate,
            ...(Platform.OS === 'android' ? { channelId: DEADLINE_CHANNEL_ID } : {}),
          } as any,
        });
      }

      // 1h notification
      if (hoursUntilDeadline > 1) {
        const triggerDate = new Date(deadline.getTime() - 1 * 60 * 60 * 1000);
        const content1 = formatReminderContent('1h', assignment, lang);
        await Notifications.scheduleNotificationAsync({
          content: {
            title: content1.title,
            body: content1.body,
            data: { assignmentId: assignment.id, uid: assignment.uid, link: assignment.link },
          },
          trigger: {
            type: triggerType,
            date: triggerDate,
            ...(Platform.OS === 'android' ? { channelId: DEADLINE_CHANNEL_ID } : {}),
          } as any,
        });
      }
    }
  } catch (e) {
    console.error('Failed to schedule notifications:', e);
  }
}

export async function requestNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === 'web' || !Notifications) return false;

  try {
    await ensureNotificationChannel();
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    return finalStatus === 'granted';
  } catch (e) {
    console.error('Failed to request notification permissions:', e);
    return false;
  }
}
