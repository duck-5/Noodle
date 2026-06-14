import { runSync, getOrCreateTaskList, syncAssignmentsToGoogleTasks, MoodleClient } from '@tautracker/moodle-client';
import {
  getStoredToken,
  setStoredToken,
  getTrackedCourseIds,
  setCachedSyncResult,
  getSettings,
  getCachedSyncResult,
} from '../shared/storage.js';

const MOODLE_HOST = 'moodle.tau.ac.il';

function getMoodleLaunchUrl(): string {
  // Use a random passport per request so Moodle treats each capture as a new device
  // and doesn't invalidate previously generated tokens for the same passport.
  const passport = Math.random().toString(36).substring(2, 15);
  return `https://${MOODLE_HOST}/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=${passport}`;
}

// Track the background tab we open for token capture, so we can close it after.
let captureTabId: number | null = null;

// Setup periodic alarms on install / startup
chrome.runtime.onInstalled.addListener(() => {
  console.log('TauTracker Extension Installed');
  chrome.alarms.create('periodicSync', { periodInMinutes: 60 });
});

chrome.alarms.onAlarm.addListener(async (alarm: chrome.alarms.Alarm) => {
  if (alarm.name === 'periodicSync') {
    console.log('Periodic sync alarm fired');
    try {
      await performBackgroundSync();
    } catch (e) {
      console.error('Error during periodic sync:', e);
    }
  }
});

// --------------------------------------------------------------------------
// Cookie check: does the user have an active Moodle session?
// --------------------------------------------------------------------------
async function checkMoodleSession(): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.cookies.getAll({ domain: MOODLE_HOST, name: 'MoodleSession' }, (cookies) => {
      resolve(cookies.length > 0);
    });
  });
}

// --------------------------------------------------------------------------
// Tab-based token capture
// Opens a background (non-active) tab to the Moodle mobile launch URL.
// Moodle redirects to moodlemobile://token=... which onBeforeRedirect catches.
// --------------------------------------------------------------------------
async function captureTokenViaTab(): Promise<void> {
  // If a capture tab is already open, don't open another one.
  if (captureTabId !== null) {
    console.log('Capture tab already open, skipping duplicate.');
    return;
  }
  console.log('Opening background tab for token capture...');
  chrome.tabs.create({ url: getMoodleLaunchUrl(), active: false }, (tab) => {
    if (tab.id !== undefined) {
      captureTabId = tab.id;
    }
  });
}

// (Cookie onChanged listener removed to prevent infinite tab loops. Capture is only triggered explicitly.)

// --------------------------------------------------------------------------
// webRequest interceptors: catch the moodlemobile:// redirect from ANY tab.
// --------------------------------------------------------------------------

// Intercept requests that already carry a token= in a moodlemobile:// URL
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.url.startsWith('moodlemobile://') || details.url.startsWith('moodleapp://')) {
      const match = details.url.match(/(?:moodlemobile|moodleapp):\/\/token=([a-zA-Z0-9+/=]+)/);
      if (match) {
        try {
          const parts = atob(match[1]).split(':::');
          const token = parts.length > 1 ? parts[1] : parts[0];
          console.log('Captured token from URL (onBeforeRequest)');
          setStoredToken(token).then(() => {
            performBackgroundSync();
            closeCapturTab(details.tabId);
          });
        } catch (e) {
          console.error('Error decoding token from URL', e);
        }
      }
    }
  },
  { urls: ['*://*/*'] }
);

// Intercept the redirect response from moodle.tau.ac.il that points to moodlemobile://
chrome.webRequest.onBeforeRedirect.addListener(
  (details) => {
    const redirectUrl = details.redirectUrl || '';
    if (redirectUrl.startsWith('moodlemobile://') || redirectUrl.startsWith('moodleapp://')) {
      const match = redirectUrl.match(/(?:moodlemobile|moodleapp):\/\/token=([a-zA-Z0-9+/=]+)/);
      if (match) {
        try {
          const parts = atob(match[1]).split(':::');
          const token = parts.length > 1 ? parts[1] : parts[0];
          console.log('Captured token from HTTP redirect (onBeforeRedirect)');
          setStoredToken(token).then(() => {
            performBackgroundSync();
            closeCapturTab(details.tabId);
          });
        } catch (e) {
          console.error('Error decoding token from HTTP redirect', e);
        }
      }
    }
  },
  { urls: ['https://moodle.tau.ac.il/*'] }
);

function closeCapturTab(tabId?: number) {
  const idToClose = tabId ?? captureTabId;
  if (idToClose !== null && idToClose !== undefined) {
    chrome.tabs.remove(idToClose, () => {
      if (chrome.runtime.lastError) {
        // Tab may have already been closed, ignore error
      }
    });
    if (idToClose === captureTabId) captureTabId = null;
  }
}

// --------------------------------------------------------------------------
// Message listeners
// --------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message: any, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
  if (message.type === 'CHECK_MOODLE_SESSION') {
    checkMoodleSession()
      .then((hasSession) => sendResponse({ hasSession }))
      .catch(() => sendResponse({ hasSession: false }));
    return true;
  }

  if (message.type === 'CAPTURE_TOKEN_VIA_TAB') {
    captureTokenViaTab()
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'VALIDATE_TOKEN') {
    validateToken(message.token)
      .then((info) => sendResponse({ success: true, info }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // Keep channel open for async response
  }

  if (message.type === 'FETCH_ENROLLED_COURSES') {
    fetchEnrolledCourses(message.token)
      .then((courses) => sendResponse({ success: true, courses }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'SYNC_NOW') {
    performBackgroundSync()
      .then((result) => sendResponse({ success: true, result }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'SYNC_GOOGLE_TASKS') {
    triggerGoogleTasksSync(message.interactive || false)
      .then((res) => sendResponse({ success: true, status: res }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
});


async function validateToken(token: string) {
  const client = new MoodleClient(token);
  return await client.getSiteInfo();
}

async function fetchEnrolledCourses(token: string) {
  const client = new MoodleClient(token);
  const info = await client.getSiteInfo();
  return await client.getEnrolledCourses(info.userid);
}

async function performBackgroundSync() {
  const token = await getStoredToken();
  if (!token) {
    console.log('Sync skipped: No Moodle token stored.');
    throw new Error('Not authenticated with Moodle');
  }

  const trackedCourseIds = await getTrackedCourseIds();
  const settings = await getSettings();

  const prevResult = await getCachedSyncResult();

  // Run sync
  const result = await runSync(token, trackedCourseIds, (msg) => {
    console.log(`[Sync Progress] ${msg}`);
  });

  // Save results to storage
  await setCachedSyncResult(result);

  // Check and fire notifications for new or upcoming assignments
  if (settings.notificationsEnabled) {
    await checkAndNotify(result.assignments, prevResult?.assignments || []);
  }

  // Trigger Google Tasks sync if enabled
  if (settings.googleTasksEnabled) {
    try {
      await triggerGoogleTasksSync(false);
    } catch (e) {
      console.error('Google Tasks sync failed:', e);
    }
  }

  return result;
}

async function triggerGoogleTasksSync(interactive: boolean): Promise<string> {
  const settings = await getSettings();
  if (!settings.googleTasksEnabled) {
    return 'Google Tasks sync is disabled in settings';
  }

  const cachedResult = await getCachedSyncResult();
  if (!cachedResult || cachedResult.assignments.length === 0) {
    return 'No assignments found to sync';
  }

  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, async (result: any) => {
      if (chrome.runtime.lastError) {
        return reject(new Error(chrome.runtime.lastError.message));
      }
      const accessToken = result && typeof result === 'object' ? result.token : result;
      if (!accessToken) {
        return reject(new Error('Failed to obtain Google access token'));
      }

      try {
        const listId = await getOrCreateTaskList(accessToken, settings.googleTasksListName);
        const { syncedCount, errors } = await syncAssignmentsToGoogleTasks(
          accessToken,
          listId,
          cachedResult.assignments
        );

        if (errors.length > 0) {
          console.warn('Google Tasks sync encountered errors:', errors);
          resolve(`Synced ${syncedCount} tasks with ${errors.length} errors.`);
        } else {
          resolve(`Successfully synced ${syncedCount} tasks to Google Tasks.`);
        }
      } catch (err: any) {
        reject(err);
      }
    });
  });
}

async function checkAndNotify(newAssigns: any[], oldAssigns: any[]) {
  const oldIds = new Set(oldAssigns.map((a) => a.id));

  for (const assign of newAssigns) {
    // 1. Notify for new assignments
    if (!oldIds.has(assign.id) && assign.status !== 'Submitted') {
      let deadlineText = 'No deadline';
      if (assign.deadline) {
        deadlineText = `Due: ${new Date(assign.deadline).toLocaleString()}`;
      }

      chrome.notifications.create(`new_assign_${assign.id}`, {
        type: 'basic',
        iconUrl: 'favicon.svg', // Fallback icon path in public
        title: 'New Moodle Assignment',
        message: `${assign.name}\n${assign.courseName}\n${deadlineText}`,
        requireInteraction: true,
      });
    }

    // 2. Notify for upcoming deadlines (due within 24 hours)
    if (assign.deadline && assign.status !== 'Submitted') {
      const deadline = new Date(assign.deadline);
      const hoursLeft = (deadline.getTime() - Date.now()) / (1000 * 60 * 60);

      // Only notify if it's less than 24 hours but greater than 0,
      // and we haven't already notified (we can track this in local storage if needed,
      // but let's just make it simple: notify if it's within a window, say 23-24 hours left,
      // or 1-2 hours left, to avoid double notification on every sync).
      const wasNotified24h = await wasAlreadyNotified(assign.id, '24h');
      if (hoursLeft <= 24 && hoursLeft > 23 && !wasNotified24h) {
        chrome.notifications.create(`upcoming_24h_${assign.id}`, {
          type: 'basic',
          iconUrl: 'favicon.svg',
          title: 'Assignment Due Tomorrow',
          message: `${assign.name}\n${assign.courseName}\nDue in ${Math.round(hoursLeft)} hours`,
        });
        await markNotified(assign.id, '24h');
      }

      const wasNotified1h = await wasAlreadyNotified(assign.id, '1h');
      if (hoursLeft <= 1 && hoursLeft > 0 && !wasNotified1h) {
        chrome.notifications.create(`upcoming_1h_${assign.id}`, {
          type: 'basic',
          iconUrl: 'favicon.svg',
          title: 'Assignment Due In 1 Hour!',
          message: `${assign.name}\n${assign.courseName}\nDue soon!`,
          requireInteraction: true,
        });
        await markNotified(assign.id, '1h');
      }
    }
  }
}

async function wasAlreadyNotified(assignId: number, type: '24h' | '1h'): Promise<boolean> {
  const key = `notified_${type}_${assignId}`;
  const res = await chrome.storage.local.get(key);
  return !!res[key];
}

async function markNotified(assignId: number, type: '24h' | '1h') {
  const key = `notified_${type}_${assignId}`;
  await chrome.storage.local.set({ [key]: true });
}
