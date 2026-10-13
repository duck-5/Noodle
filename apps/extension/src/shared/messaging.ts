import type { SyncResult } from '@tautracker/moodle-client';
import browser from 'webextension-polyfill';

export async function sendMessageToBackground(message: any): Promise<any> {
  try {
    const response = await browser.runtime.sendMessage(message);
    return response;
  } catch (error: any) {
    // The service worker may have been terminated (MV3 lifecycle). The first
    // sendMessage attempt triggers Chrome to restart the SW, but the message
    // itself is lost. Wait briefly for the SW to spin up, then retry once.
    if (error.message?.includes('Receiving end does not exist')) {
      console.warn('[TauTracker] SW not ready, retrying in 500ms…');
      await new Promise((r) => setTimeout(r, 500));
      try {
        return await browser.runtime.sendMessage(message);
      } catch (retryError: any) {
        console.warn('[TauTracker] SW retry also failed:', retryError.message);
        return null;
      }
    }
    console.warn('[TauTracker] SW message port closed:', error.message);
    return null;
  }
}

export async function validateTokenOnBackground(
  token: string
): Promise<{ success: boolean; info?: any; error?: string }> {
  return sendMessageToBackground({ type: 'VALIDATE_TOKEN', token });
}

export async function fetchEnrolledCoursesOnBackground(
  token: string
): Promise<{ success: boolean; courses?: any[]; error?: string; errorcode?: string }> {
  return sendMessageToBackground({ type: 'FETCH_ENROLLED_COURSES', token });
}

export async function syncNowOnBackground(): Promise<{ success: boolean; result?: SyncResult; error?: string }> {
  return sendMessageToBackground({ type: 'SYNC_NOW' });
}

export async function syncGoogleTasksOnBackground(
  interactive = false
): Promise<{ success: boolean; status?: string; error?: string }> {
  return sendMessageToBackground({ type: 'SYNC_GOOGLE_TASKS', interactive });
}

export async function loginTauSsoOnBackground(
  username: string,
  idNumber: string,
  pass: string,
  skipInvalidate: boolean = false
): Promise<{ success: boolean; token?: string; error?: string }> {
  return sendMessageToBackground({ type: 'LOGIN_TAU_SSO', username, idNumber, pass, skipInvalidate });
}

export async function logoutOnBackground(): Promise<{ success: boolean; error?: string }> {
  return sendMessageToBackground({ type: 'LOGOUT' });
}
