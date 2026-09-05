import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { getOrCreateTaskList, syncAssignmentsToGoogleTasks, Assignment } from '@tautracker/moodle-client';
import { getPreference, getDb } from './database';

export const DEFAULT_GOOGLE_CLIENT_ID = '510394355212-0e3ums7pu5raagej4gg14nrkt9o06m78.apps.googleusercontent.com';

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

export async function authenticateGoogleOAuth(customClientId?: string): Promise<{ success: boolean; token?: string; error?: string }> {
  try {
    const clientId = customClientId?.trim() || getPreference('google_tasks_client_id') || DEFAULT_GOOGLE_CLIENT_ID;
    const redirectUrl = Linking.createURL('oauth');

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(
      clientId
    )}&response_type=token&redirect_uri=${encodeURIComponent(
      redirectUrl
    )}&scope=${encodeURIComponent('https://www.googleapis.com/auth/tasks')}&prompt=consent`;

    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);

    if (result.type !== 'success' || !result.url) {
      if (result.type === 'cancel' || result.type === 'dismiss') {
        return { success: false, error: 'Authentication was cancelled' };
      }
      return { success: false, error: 'Failed to complete Google authentication' };
    }

    const responseUrl = result.url;
    let token: string | null = null;

    if (responseUrl.includes('#')) {
      const hashPart = responseUrl.split('#')[1];
      const params = new URLSearchParams(hashPart);
      token = params.get('access_token');
    }

    if (!token && responseUrl.includes('?')) {
      const queryPart = responseUrl.split('?')[1];
      const params = new URLSearchParams(queryPart);
      token = params.get('access_token');
    }

    if (!token) {
      return { success: false, error: 'No access token received from Google' };
    }

    await setGoogleAccessToken(token);
    return { success: true, token };
  } catch (e: any) {
    console.error('authenticateGoogleOAuth error:', e);
    return { success: false, error: e.message || 'Authentication failed' };
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

    // Load course nicknames from tracked_courses
    const db = getDb();
    const rows = db.getAllSync<{ moodle_id: number; name: string }>('SELECT moodle_id, name FROM tracked_courses');
    const courseNameMap = new Map<number, string>();
    for (const r of rows) {
      courseNameMap.set(r.moodle_id, r.name);
    }

    const mappedAssignments = assignments.map(a => {
      const nickname = courseNameMap.get(a.courseId);
      return nickname && nickname.trim() ? { ...a, courseName: nickname.trim() } : a;
    });

    const listName = getPreference('google_tasks_list_name') || 'University';
    const syncErrors: string[] = [];
    const listId = await getOrCreateTaskList(accessToken, listName, (err: string) => {
      syncErrors.push(err);
    });

    const { syncedCount, errors } = await syncAssignmentsToGoogleTasks(accessToken, listId, mappedAssignments);
    const allErrors = [...syncErrors, ...errors];

    if (allErrors.length > 0) {
      return { success: true, message: `Synced ${syncedCount} tasks with ${allErrors.length} errors.` };
    }
    return { success: true, message: `Synced ${syncedCount} tasks successfully.` };
  } catch (e: any) {
    console.error('performGoogleTasksSync error:', e);
    return { success: false, message: e.message };
  }
}
