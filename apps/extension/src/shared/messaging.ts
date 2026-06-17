import type { SyncResult } from '@tautracker/moodle-client';

export async function sendMessageToBackground(message: any): Promise<any> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: any) => {
      if (chrome.runtime.lastError) {
        // The service worker may have been terminated mid-flight (MV3 lifecycle).
        // Treat this as a null response rather than a hard error — callers handle null.
        console.warn('[TauTracker] SW message port closed:', chrome.runtime.lastError.message);
        resolve(null);
        return;
      }
      resolve(response);
    });
  });
}

export async function validateTokenOnBackground(
  token: string
): Promise<{ success: boolean; info?: any; error?: string }> {
  return sendMessageToBackground({ type: 'VALIDATE_TOKEN', token });
}

export async function fetchEnrolledCoursesOnBackground(
  token: string
): Promise<{ success: boolean; courses?: any[]; error?: string }> {
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
  pass: string
): Promise<{ success: boolean; token?: string; error?: string }> {
  return sendMessageToBackground({ type: 'LOGIN_TAU_SSO', username, idNumber, pass });
}

export async function logoutOnBackground(): Promise<{ success: boolean; error?: string }> {
  return sendMessageToBackground({ type: 'LOGOUT' });
}
