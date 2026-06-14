import type { SyncResult } from '@tautracker/moodle-client';

const MOODLE_HOST = 'moodle.tau.ac.il';

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

/**
 * Check if the browser currently has an active Moodle session cookie.
 * Called directly via the cookies API — no service worker IPC needed.
 */
export async function checkMoodleSessionDirect(): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.cookies.getAll({ domain: MOODLE_HOST, name: 'MoodleSession' }, (cookies) => {
      if (chrome.runtime.lastError) {
        console.warn('[TauTracker] Cookie check error:', chrome.runtime.lastError.message);
        resolve(false);
        return;
      }
      resolve(cookies.length > 0);
    });
  });
}

/**
 * Request the background script to open a tab to the Moodle mobile launch URL.
 * The service worker will manage the tab lock and capture the token from the redirect.
 */
export async function captureTokenViaTabOnBackground(): Promise<void> {
  // Fire and forget, catching null in case port closes early
  await sendMessageToBackground({ type: 'CAPTURE_TOKEN_VIA_TAB' });
}
