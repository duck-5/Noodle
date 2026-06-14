import * as Notifications from 'expo-notifications';
import { Assignment } from '@tautracker/moodle-client';

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

export async function scheduleDeadlineNotifications(assignments: Assignment[]): Promise<void> {
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
