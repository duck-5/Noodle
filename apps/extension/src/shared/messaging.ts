import type { SyncResult } from '@tautracker/moodle-client';
import browser from 'webextension-polyfill';

function rawSendMessage(msg: unknown): Promise<any> {
  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  }
  return browser.runtime.sendMessage(msg);
}

export async function sendMessageToBackground(message: any): Promise<any> {
  const delays = [200, 500, 1000, 1500]; // Multi-stage progressive backoff allowing up to ~3.2s for dormant SW to boot
  const maxRetries = delays.length;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await rawSendMessage(message);
      return response;
    } catch (error: unknown) {
      const err = error as Error;
      if (err.message?.includes('Extension context invalidated')) {
        console.warn('[TauTracker] Extension context invalidated (extension was reloaded/updated). Please refresh this page.');
        return { success: false, error: 'Extension context invalidated. Please refresh the page.' };
      }

      // The service worker may have been terminated (MV3 lifecycle). The first
      // sendMessage attempt triggers Chrome to restart the SW, but the message
      // itself is dropped. Wait briefly with progressive backoff for the SW to spin up.
      const isNotReady = err.message?.includes('Receiving end does not exist');
      if (isNotReady && attempt < maxRetries) {
        const delay = delays[attempt];
        console.warn(`[TauTracker] SW not ready (attempt ${attempt + 1}/${maxRetries}), retrying in ${delay}ms…`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      if (isNotReady) {
        console.warn('[TauTracker] SW retry also failed after maximum attempts:', err.message);
        return { success: false, error: 'Service Worker not responding. Please reload the extension.' };
      }

      console.warn('[TauTracker] SW message port closed:', err.message);
      return { success: false, error: err.message };
    }
  }

  return { success: false, error: 'Maximum attempts reached.' };
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
