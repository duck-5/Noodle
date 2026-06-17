import { Assignment } from '@tautracker/moodle-client';

// expo-notifications remote push support was removed from Expo Go in SDK 53.
// All calls are wrapped so the app still runs in Expo Go (local/scheduled
// notifications still work in a development build).
let Notifications: typeof import('expo-notifications') | null = null;

try {
  // Dynamic require lets us catch the "removed from Expo Go" error at runtime
  // instead of crashing the whole module graph at import time.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Notifications = require('expo-notifications');
} catch (e) {
  console.warn('expo-notifications is not available in this environment:', e);
}

// Set up the foreground notification handler if the module loaded successfully.
if (Notifications) {
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

export async function scheduleDeadlineNotifications(assignments: Assignment[]): Promise<void> {
  if (!Notifications) return;

  try {
    // 1. Cancel all current scheduled notifications
    await Notifications.cancelAllScheduledNotificationsAsync();

    const now = new Date();

    for (const assignment of assignments) {
      if (!assignment.deadline || assignment.status === 'Submitted') continue;

      const deadline = new Date(assignment.deadline);
      const hoursUntilDeadline = (deadline.getTime() - now.getTime()) / (1000 * 60 * 60);

      if (hoursUntilDeadline <= 0) continue;

      // 24h notification
      if (hoursUntilDeadline > 24) {
        const triggerDate = new Date(deadline.getTime() - 24 * 60 * 60 * 1000);
        await Notifications.scheduleNotificationAsync({
          content: {
            title: '📅 Assignment due tomorrow',
            body: `${assignment.name} — ${assignment.courseName}`,
            data: { assignmentId: assignment.id, link: assignment.link },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: triggerDate,
          },
        });
      }

      // 1h notification
      if (hoursUntilDeadline > 1) {
        const triggerDate = new Date(deadline.getTime() - 1 * 60 * 60 * 1000);
        await Notifications.scheduleNotificationAsync({
          content: {
            title: '⏰ Due in 1 hour!',
            body: `${assignment.name} — ${assignment.courseName}`,
            data: { assignmentId: assignment.id, link: assignment.link },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: triggerDate,
          },
        });
      }
    }
  } catch (e) {
    console.error('Failed to schedule notifications:', e);
  }
}

export async function requestNotificationPermissions(): Promise<boolean> {
  if (!Notifications) return false;

  try {
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
