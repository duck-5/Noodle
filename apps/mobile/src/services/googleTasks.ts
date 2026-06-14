import * as SecureStore from 'expo-secure-store';
import { getOrCreateTaskList, syncAssignmentsToGoogleTasks, Assignment } from '@tautracker/moodle-client';
import { getPreference } from './database';

export async function getGoogleAccessToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync('google_access_token');
  } catch (e) {
    console.error('getGoogleAccessToken error:', e);
    return null;
  }
}

export async function setGoogleAccessToken(token: string | null): Promise<void> {
  try {
    if (token === null) {
      await SecureStore.deleteItemAsync('google_access_token');
    } else {
      await SecureStore.setItemAsync('google_access_token', token);
    }
  } catch (e) {
    console.error('setGoogleAccessToken error:', e);
  }
}

export async function performGoogleTasksSync(assignments: Assignment[]): Promise<{ success: boolean; message?: string }> {
  try {
    const isEnabled = getPreference('google_tasks_enabled') === 'true';
    if (!isEnabled) {
      return { success: false, message: 'Google Tasks integration is disabled.' };
    }

    const accessToken = await getGoogleAccessToken();
    if (!accessToken) {
      return { success: false, message: 'Google account is not connected.' };
    }

    const listName = getPreference('google_tasks_list_name') || 'TauTracker';
    const listId = await getOrCreateTaskList(accessToken, listName);

    const { syncedCount, errors } = await syncAssignmentsToGoogleTasks(accessToken, listId, assignments);

    if (errors.length > 0) {
      return { success: true, message: `Synced ${syncedCount} tasks with ${errors.length} errors.` };
    }
    return { success: true, message: `Synced ${syncedCount} tasks successfully.` };
  } catch (e: any) {
    console.error('performGoogleTasksSync error:', e);
    return { success: false, message: e.message };
  }
}
