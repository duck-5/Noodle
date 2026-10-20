import browser from 'webextension-polyfill';
import { runSync, getOrCreateTaskList, syncAssignmentsToGoogleTasks, MoodleClient, SettingsSyncManager, type SyncResult } from '@tautracker/moodle-client';
import {
  getStoredToken,
  setStoredToken,
  getStoredSesskey,
  setStoredSesskey,
  getTrackedCourseIds,
  setTrackedCourseIds,
  setCachedSyncResult,
  getSettings,
  setSettings,
  getCachedSyncResult,
  getMoodleCredentials,
} from '../shared/storage.js';


// --------------------------------------------------------------------------
// Message listeners — registered immediately at top-level for MV3 event routing
// --------------------------------------------------------------------------
const messageHandler = (message: any, _sender: any, sendResponse?: (res?: any) => void) => {
  if (!message || typeof message !== 'object') return false;

  let promise: Promise<any> | null = null;

  if (message.type === 'LOGIN_TAU_SSO') {
    promise = loginTauSso(message.username, message.idNumber, message.pass, message.skipInvalidate)
      .then((token) => ({ success: true, token }))
      .catch((err) => ({ success: false, error: err?.message || String(err) }));
  } else if (message.type === 'VALIDATE_TOKEN') {
    promise = validateToken(message.token)
      .then((info) => ({ success: true, info }))
      .catch((err) => ({ success: false, error: err?.message || String(err) }));
  } else if (message.type === 'FETCH_ENROLLED_COURSES') {
    promise = fetchEnrolledCourses(message.token)
      .then((courses) => {
        console.log('[serviceWorker] Responding to FETCH_ENROLLED_COURSES with', courses.length, 'courses');
        return { success: true, courses };
      })
      .catch((err) => {
        console.error('[serviceWorker] Error in fetchEnrolledCourses:', err);
        return { success: false, error: err?.message || String(err), errorcode: err?.errorcode };
      });
  } else if (message.type === 'SYNC_NOW') {
    promise = performBackgroundSync()
      .then((result) => ({ success: true, result }))
      .catch((err) => ({ success: false, error: err?.message || String(err) }));
  } else if (message.type === 'SYNC_SETTINGS') {
    promise = performSettingsSync()
      .then(() => ({ success: true }))
      .catch((err) => ({ success: false, error: err?.message || String(err) }));
  } else if (message.type === 'SYNC_GOOGLE_TASKS') {
    promise = triggerGoogleTasksSync(message.interactive || false)
      .then((res) => ({ success: true, status: res }))
      .catch((err) => ({ success: false, error: err?.message || String(err) }));
  } else if (message.type === 'LOGOUT') {
    promise = clearUserSession()
      .then(() => ({ success: true }))
      .catch((err) => ({ success: false, error: err?.message || String(err) }));
  }

  if (promise) {
    if (typeof sendResponse === 'function') {
      promise.then(sendResponse).catch((err) => {
        sendResponse({ success: false, error: err?.message || String(err) });
      });
    }
    // Return true synchronously to keep the message port open in Chromium MV3
    return true;
  }

  return false;
};

// Register synchronously on the active extension runtime
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener(messageHandler);
} else {
  browser.runtime.onMessage.addListener(messageHandler);
}

const SYNC_INTERVAL_MINUTES = 5;

// Setup alarm checking function to register the alarm on startup without resetting it if it already exists
async function setupAlarm() {
  try {
    const alarm = await browser.alarms.get('periodicSync');
    if (!alarm || alarm.periodInMinutes !== SYNC_INTERVAL_MINUTES) {
      await browser.alarms.create('periodicSync', { periodInMinutes: SYNC_INTERVAL_MINUTES });
      console.log(`Created periodicSync alarm for ${SYNC_INTERVAL_MINUTES} minutes`);
    } else {
      console.log(`periodicSync alarm already exists with ${SYNC_INTERVAL_MINUTES} minutes`);
    }
  } catch (e) {
    console.warn('Non-fatal: Failed to check/create periodicSync alarm:', e);
  }
}

// Setup periodic alarms on install / startup
browser.runtime.onInstalled.addListener(async () => {
  console.log('TauTracker Extension Installed');
  try {
    await browser.alarms.create('periodicSync', { periodInMinutes: SYNC_INTERVAL_MINUTES });
    console.log(`Forced creation of periodicSync alarm for ${SYNC_INTERVAL_MINUTES} minutes onInstalled`);
  } catch (e) {
    console.warn('Non-fatal: Failed to create periodicSync alarm onInstalled:', e);
  }
  updateActionBadge().catch(() => {});
});

browser.runtime.onStartup.addListener(() => {
  setupAlarm().catch(() => {});
  updateActionBadge().catch(() => {});
});

// Update toolbar badge whenever cachedSyncResult or settings change
browser.storage.onChanged.addListener((changes, areaName) => {
  if (
    (areaName === 'local' && (changes.cachedSyncResult || changes.wstoken)) ||
    (areaName === 'sync' && changes.settings)
  ) {
    updateActionBadge().catch(() => {});
  }
});

// Initialize badge when service worker wakes up
updateActionBadge().catch(() => {});

async function updateActionBadge() {
  try {
    const actionApi: any = (browser as any).action || (browser as any).browserAction;
    if (!actionApi || typeof actionApi.setBadgeText !== 'function') return;

    const token = await getStoredToken();
    const cached = await getCachedSyncResult();
    if (!token || !cached || !Array.isArray(cached.assignments)) {
      await actionApi.setBadgeText({ text: '' });
      return;
    }

    const settings = await getSettings();
    const hiddenSet = new Set(settings.hiddenAssignments || []);
    const completedSet = new Set(settings.completedAssignments || []);
    const uncompletedSet = new Set(settings.uncompletedAssignments || []);

    const isDone = (a: any) => {
      if (uncompletedSet.has(a.id)) return false;
      if (completedSet.has(a.id) || a.isCompleted === true) return true;
      return a.status === 'Submitted';
    };

    const now = Date.now();
    const activeAssigns = cached.assignments.filter((a: any) => {
      if (hiddenSet.has(a.id) || a.isHidden) return false;
      if (isDone(a)) return false;
      if (!a.deadline) return true;
      // Only count upcoming/active deadlines or recently due within 24h
      return new Date(a.deadline).getTime() >= now;
    });

    const count = activeAssigns.length;
    if (count === 0) {
      await actionApi.setBadgeText({ text: '' });
      return;
    }

    let minHoursLeft = Infinity;
    for (const a of activeAssigns) {
      if (a.deadline) {
        const hoursLeft = (new Date(a.deadline).getTime() - now) / (1000 * 60 * 60);
        if (hoursLeft >= 0 && hoursLeft < minHoursLeft) {
          minHoursLeft = hoursLeft;
        }
      }
    }

    let badgeColor = '#6366f1'; // Primary indigo
    if (minHoursLeft <= 24) {
      badgeColor = '#ef4444'; // Urgent red (<= 24h)
    } else if (minHoursLeft <= 72) {
      badgeColor = '#f59e0b'; // Warning amber (<= 72h)
    }

    await actionApi.setBadgeText({ text: count > 99 ? '99+' : String(count) });
    if (typeof actionApi.setBadgeBackgroundColor === 'function') {
      await actionApi.setBadgeBackgroundColor({ color: badgeColor });
    }
  } catch (e) {
    // Non-fatal if browser action API is unavailable
  }
}

browser.alarms.onAlarm.addListener(async (alarm: any) => {
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
// Session Teardown — clears ALL user-specific data on logout
// --------------------------------------------------------------------------

/**
 * Invalidates the TAU SSO and Moodle server-side sessions, and clears local cookies.
 * We must use credentials: 'include' to ensure the server receives the active JSESSIONID
 * and destroys the session. After the server invalidates the session, it sends back
 * a "dead" cookie. We then use browser.cookies to completely clear the browser's cookie jar,
 * so the next login starts with a clean slate.
 */
async function invalidateSsoSession(): Promise<void> {
  // Step 1: Invalidate server-side session. We must send the active cookies (credentials: 'include')
  // so the server knows which session to destroy.
  const logoutUrls = [
    `https://nidp.tau.ac.il/nidp/app/logout?_t=${Date.now()}`,
    `https://moodle.tau.ac.il/login/logout.php?_t=${Date.now()}`,
  ];

  await Promise.allSettled(
    logoutUrls.map((url) =>
      fetch(url, {
        method: 'GET',
        credentials: 'include',
        redirect: 'follow',
        cache: 'no-store'
      })
    )
  );

  // Step 2: Physically delete all NIDP and Moodle cookies so our local jar is completely clean.
  // This removes both the active session (if the fetch failed) and the "dead" session cookie
  // issued by the logout endpoint, preventing SAML poisoning on the next login.
  try {
    const domains = ['nidp.tau.ac.il', 'moodle.tau.ac.il', 'tau.ac.il'];
    for (const domain of domains) {
      const cookies = await browser.cookies.getAll({ domain });
      for (const cookie of cookies) {
        let cleanDomain = cookie.domain;
        if (cleanDomain.startsWith('.')) {
          cleanDomain = cleanDomain.substring(1);
        }
        const url = `http${cookie.secure ? 's' : ''}://${cleanDomain}${cookie.path}`;
        await browser.cookies.remove({ url, name: cookie.name });
      }
    }
  } catch (e) {
    console.error('Failed to clear cookies:', e);
  }
}

/**
 * Full user-session teardown.  Invalidates the server-side SSO session and
 * removes every user-specific storage key while leaving general UI
 * preferences (theme, language, sidebar) intact.
 */
async function clearUserSession(): Promise<void> {
  // 1. Invalidate the SSO/Moodle server-side session (no cookies permission needed)
  await invalidateSsoSession();

  // 2. Wipe all user-specific local storage keys
  const userLocalKeys = [
    'wstoken',
    'sesskey',
    'moodleCredentials',
    'cachedSyncResult',
    'enrolledCoursesCache',
    'googleAccessToken',
    'googleTokenExpiry',
  ];
  await browser.storage.local.remove(userLocalKeys);

  // Also remove dynamic notification-tracking keys (notified_24h_*, notified_1h_*)
  const allLocal = await browser.storage.local.get(null);
  const notificationKeys = Object.keys(allLocal).filter(
    (k) => k.startsWith('notified_')
  );
  if (notificationKeys.length > 0) {
    await browser.storage.local.remove(notificationKeys);
  }

  // 3. Wipe user-specific sync storage keys
  await browser.storage.sync.remove('trackedCourseIds');
  await updateActionBadge();
}


async function validateToken(token: string) {
  const sesskey = await getStoredSesskey();
  const settings = await getSettings();
  const client = new MoodleClient(token, undefined, {
    sesskey: sesskey || undefined,
    devMode: true,
    enableScraping: settings.scrapingEnabled ?? false
  });
  return await client.getSiteInfo();
}

let activeFetchEnrolledCoursesPromise: Promise<any[]> | null = null;

async function fetchEnrolledCourses(token: string) {
  if (activeFetchEnrolledCoursesPromise) {
    console.log('[serviceWorker] Returning existing in-flight fetchEnrolledCourses promise');
    return await activeFetchEnrolledCoursesPromise;
  }

  activeFetchEnrolledCoursesPromise = (async () => {
    try {
      const sesskey = await getStoredSesskey();
      const settings = await getSettings();
      const client = new MoodleClient(token, undefined, {
        sesskey: sesskey || undefined,
        devMode: true,
        enableScraping: settings.scrapingEnabled ?? false
      });
      console.log('[serviceWorker] fetchEnrolledCourses called with sesskey:', sesskey ? `${sesskey.substring(0, 4)}...` : 'none');
      let userid = 0;
      try {
        const info = await client.getSiteInfo();
        console.log('[serviceWorker] SiteInfo resolved:', info);
        userid = info.userid;
      } catch (err: any) {
        if ((err.message && err.message.toLowerCase().includes('invalidtoken')) || err.errorcode === 'invalidtoken') {
          console.log('Token invalid/expired during fetchEnrolledCourses. Attempting automatic background re-login...');
          const creds = await getMoodleCredentials();
          if (creds && creds.username && creds.idNumber && creds.password) {
            try {
              const newToken = await loginTauSso(creds.username, creds.idNumber, creds.password, false);
              console.log('Automatic re-login successful! Retrying fetchEnrolledCourses...');
              const newSesskey = await getStoredSesskey();
              const newSettings = await getSettings();
              const newClient = new MoodleClient(newToken, undefined, {
                sesskey: newSesskey || undefined,
                devMode: true,
                enableScraping: newSettings.scrapingEnabled ?? false
              });
              const newInfo = await newClient.getSiteInfo();
              return await newClient.getEnrolledCourses(newInfo.userid);
            } catch (loginErr: any) {
              console.error('Automatic background re-login failed during fetch:', loginErr);
            }
          }
          console.warn('[serviceWorker] fetchEnrolledCourses: Moodle token is invalid. Aborting to trigger re-auth.');
          throw err;
        }
        console.warn('[serviceWorker] Failed to get site info, attempting getEnrolledCourses with userid 0:', err?.message || err);
      }
      const courses = await client.getEnrolledCourses(userid);
      console.log('[serviceWorker] fetchEnrolledCourses found courses count:', courses.length);
      return courses;
    } finally {
      activeFetchEnrolledCoursesPromise = null;
    }
  })();

  return await activeFetchEnrolledCoursesPromise;
}

async function performSettingsSync() {
  const token = await getStoredToken();
  if (!token) {
    console.log('[SettingsSync] No token, skipping.');
    return;
  }

  const settings = await getSettings();
  const sesskey = await getStoredSesskey();
  const client = new MoodleClient(token, undefined, {
    sesskey: sesskey || undefined,
    devMode: true,
    enableScraping: settings.scrapingEnabled ?? false
  });
  const syncManager = new SettingsSyncManager(client, 'chrome-extension');

  const trackedCourseIds = await getTrackedCourseIds();
  const timestamps = ((await browser.storage.sync.get('settings_timestamps')).settings_timestamps || {}) as Record<string, number>;

  const localShared: Record<string, any> = {};

  // Package settings
  for (const [key, value] of Object.entries(settings)) {
    if (value !== undefined) {
      const ts = timestamps[key] || 0;
      // Only send default values if they were explicitly set (ts > 0)
      if (ts > 0 || (Array.isArray(value) ? value.length > 0 : (value !== null && typeof value === 'object' ? Object.keys(value).length > 0 : true))) {
        localShared[key] = {
          value,
          updatedAt: ts,
          deviceId: 'chrome-extension'
        };
      }
    }
  }

  // Package trackedCourseIds
  const tsTracked = timestamps['trackedCourseIds'] || 0;
  if (tsTracked > 0 || trackedCourseIds.length > 0) {
    localShared['trackedCourseIds'] = {
      value: trackedCourseIds,
      updatedAt: tsTracked,
      deviceId: 'chrome-extension'
    };
  }

  const merged = await syncManager.sync(localShared);

  // Unwrap merged
  const newSettings: any = {};
  let newTrackedCourseIds: number[] | null = null;
  const newTimestamps: Record<string, number> = { ...timestamps };

  for (const [key, tracked] of Object.entries(merged)) {
    if (!tracked) continue;
    newTimestamps[key] = tracked.updatedAt;

    if (key === 'trackedCourseIds') {
      newTrackedCourseIds = tracked.value;
    } else {
      newSettings[key] = tracked.value;
    }
  }

  // Save back to storage without triggering another sync
  if (Object.keys(newSettings).length > 0) {
    await setSettings(newSettings, true);
  }
  if (newTrackedCourseIds !== null) {
    await setTrackedCourseIds(newTrackedCourseIds, true);
  }

  // Update timestamps
  await browser.storage.sync.set({ settings_timestamps: newTimestamps });
  console.log('[SettingsSync] Successfully synced settings with Moodle.');
}

let activeBackgroundSyncPromise: Promise<SyncResult> | null = null;

async function performBackgroundSync(): Promise<SyncResult> {
  if (activeBackgroundSyncPromise) {
    console.log('[serviceWorker] Returning existing in-flight background sync promise');
    return await activeBackgroundSyncPromise;
  }

  activeBackgroundSyncPromise = (async () => {
    console.log('--- STARTING SYNC (Triggered manually or via periodic alarm) ---');
    let token = await getStoredToken();

    if (!token) {
      console.log('Sync skipped: No Moodle token stored.');
      throw new Error('Not authenticated with Moodle');
    }

  await browser.storage.local.set({ isSyncing: true });
  browser.runtime.sendMessage({ type: 'SYNC_START' }).catch(() => { });

  let result;
  try {
    // Pull any latest configuration from Moodle before syncing assignments
    try {
      await performSettingsSync();
    } catch (e) {
      console.warn('Non-fatal: Failed to pull settings before assignment sync', e);
    }

    // Refetch settings/trackedCourseIds in case they just updated from performSettingsSync!
    const trackedCourseIds = await getTrackedCourseIds();
    const settings = await getSettings();
    const prevResult = await getCachedSyncResult();
    const sesskey = await getStoredSesskey();

    try {
      result = await runSync(
        token,
        trackedCourseIds,
        (msg) => {
          browser.runtime.sendMessage({ type: 'SYNC_PROGRESS', msg }).catch(() => { });
          console.log(`[Sync Progress] ${msg}`);
        },
        undefined,
        undefined,
        undefined,
        sesskey || undefined,
        (partial) => {
          browser.runtime.sendMessage({ type: 'SYNC_PARTIAL', partial }).catch(() => { });
        },
        { enableScraping: settings.scrapingEnabled ?? false }
      );
    } catch (err: any) {
      let retrySuccessful = false;
      if ((err.message && err.message.toLowerCase().includes('invalidtoken')) || err.name === 'MoodleApiError') {
        console.log('Token invalid/expired. Attempting automatic background re-login...');
        const creds = await getMoodleCredentials();
        if (creds && creds.username && creds.idNumber && creds.password) {
          try {
            const newToken = await loginTauSso(creds.username, creds.idNumber, creds.password, false);
            console.log('Automatic re-login successful! Retrying sync...');
            const newSesskey = await getStoredSesskey();
            
            result = await runSync(
              newToken,
              trackedCourseIds,
              (msg) => {
                browser.runtime.sendMessage({ type: 'SYNC_PROGRESS', msg }).catch(() => { });
                console.log(`[Sync Progress Retry] ${msg}`);
              },
              undefined,
              undefined,
              undefined,
              newSesskey || undefined,
              (partial) => {
                browser.runtime.sendMessage({ type: 'SYNC_PARTIAL', partial }).catch(() => { });
              },
              { enableScraping: settings.scrapingEnabled ?? false }
            );
            retrySuccessful = true;
          } catch (loginErr: any) {
            console.error('Automatic background re-login failed:', loginErr);
          }
        }
        
        if (!retrySuccessful) {
          console.log('Automatic re-login failed or no credentials. Prompting user to re-login.');
          browser.notifications.create('moodle_token_expired', {
            type: 'basic',
            iconUrl: browser.runtime.getURL('icon-128.png'),
            title: 'Moodle Session Expired',
            message: 'Your Moodle session has expired. Please open Noodle to log in again.',
          });
          throw new Error('Moodle session expired');
        }
      } else {
        throw err;
      }
    }

    if (!result) {
      throw new Error('Sync failed: No result returned');
    }

    // Save results to storage
    await setCachedSyncResult(result);
    await updateActionBadge();

    // Check and fire notifications for new or upcoming assignments
    if (settings.notificationsEnabled) {
      await checkAndNotify(result.assignments, prevResult?.assignments || [], settings);
    }

    // Trigger Google Tasks sync if enabled
    if (settings.googleTasksEnabled) {
      try {
        await triggerGoogleTasksSync(false);
      } catch (e) {
        console.error('Google Tasks sync failed:', e);
      }
    }
  } finally {
    // Save syncing state and notify listeners
    await browser.storage.local.set({ isSyncing: false });
    browser.runtime.sendMessage({ type: 'SYNC_COMPLETE' }).catch(() => { });
    // Reschedule the alarm to exactly X minutes from now to align with this sync
    // NOTE: Chrome strictly enforces a minimum of 1 minute in production. 
    // In dev, you can test with floats (e.g., 0.1 for 6 seconds).
    await browser.alarms.create('periodicSync', { periodInMinutes: SYNC_INTERVAL_MINUTES });
  }

    return result;
  })();

  try {
    return await activeBackgroundSyncPromise;
  } finally {
    activeBackgroundSyncPromise = null;
  }
}

async function getLaunchWebAuthFlowToken(clientId: string, interactive: boolean): Promise<string> {
  const cached = (await browser.storage.local.get(['googleAccessToken', 'googleTokenExpiry'])) as {
    googleAccessToken?: string;
    googleTokenExpiry?: number;
  };
  if (cached.googleAccessToken && cached.googleTokenExpiry && cached.googleTokenExpiry > Date.now() + 60000) {
    return cached.googleAccessToken;
  }

  if (!interactive) {
    throw new Error('Google Tasks authentication required. Please open settings and sync manually.');
  }

  const redirectUrl = typeof browser.identity.getRedirectURL === 'function'
    ? browser.identity.getRedirectURL()
    : `https://${browser.runtime.id}.chromiumapp.org/`;
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&response_type=token&redirect_uri=${encodeURIComponent(redirectUrl)}&scope=${encodeURIComponent('https://www.googleapis.com/auth/tasks')}`;

  return new Promise((resolve, reject) => {
    browser.identity.launchWebAuthFlow({ url: authUrl, interactive: true })
      .then((responseUrl) => {
        if (!responseUrl) {
          return reject(new Error('OAuth flow canceled or returned empty response.'));
        }

        try {
          const urlObj = new URL(responseUrl);
          const params = new URLSearchParams(urlObj.hash.substring(1));
          const token = params.get('access_token');
          const expiresIn = params.get('expires_in');

          if (!token) {
            return reject(new Error('Access token not found in Google OAuth response.'));
          }

          const expiryTime = Date.now() + (expiresIn ? parseInt(expiresIn, 10) * 1000 : 3600 * 1000);
          browser.storage.local.set({
            googleAccessToken: token,
            googleTokenExpiry: expiryTime
          }).then(() => {
            resolve(token);
          });
        } catch (err: any) {
          reject(new Error(err.message || String(err)));
        }
      }).catch((err: any) => {
        reject(new Error(err.message || String(err)));
      });
  });
}

async function triggerGoogleTasksSync(interactive: boolean): Promise<string> {
  const settings = await getSettings();
  if (!settings.googleTasksEnabled) {
    return 'Google Tasks sync is disabled in settings';
  }

  const cachedResult = await getCachedSyncResult();
  if (!cachedResult) {
    return 'No assignments found to sync';
  }

  let accessToken: string;
  const customClientId = settings.googleClientId?.trim();
  const manifestClientId = (browser.runtime.getManifest() as any).oauth2?.client_id;
  const clientId = customClientId || manifestClientId;

  if (!clientId) {
    throw new Error('No Google Client ID provided. Please configure one in settings.');
  }

  accessToken = await getLaunchWebAuthFlowToken(clientId, interactive);

  const syncErrors: string[] = [];
  const listId = await getOrCreateTaskList(accessToken, settings.googleTasksListName, (err: string) => {
    syncErrors.push(err);
  });

  const rawAssignments = cachedResult.assignments || [];
  const mappedAssignments = rawAssignments.map((a: any) => {
    const nickname = settings.coursesCustomNames?.[a.courseId];
    return nickname && nickname.trim() ? { ...a, courseName: nickname.trim() } : a;
  });

  const { syncedCount, errors } = await syncAssignmentsToGoogleTasks(
    accessToken,
    listId,
    mappedAssignments,
    {
      hiddenAssignmentIds: settings.hiddenAssignments || [],
      completedAssignmentIds: settings.completedAssignments || [],
      uncompletedAssignmentIds: settings.uncompletedAssignments || [],
      syncWithoutDeadline: settings.syncWithoutDeadline ?? false,
    }
  );

  const allErrors = [...syncErrors, ...errors];

  if (allErrors.length > 0) {
    console.warn('Google Tasks sync encountered errors:', allErrors);
    return `Synced ${syncedCount} tasks with ${allErrors.length} errors.`;
  } else {
    return `Successfully synced ${syncedCount} tasks to Google Tasks.`;
  }
}

async function checkAndNotify(newAssigns: any[], oldAssigns: any[], settings?: any) {
  const activeSettings = settings || (await getSettings());
  const hiddenSet = new Set(activeSettings.hiddenAssignments || []);
  const completedSet = new Set(activeSettings.completedAssignments || []);
  const uncompletedSet = new Set(activeSettings.uncompletedAssignments || []);

  const isDone = (a: any) => {
    if (uncompletedSet.has(a.id)) return false;
    if (completedSet.has(a.id) || a.isCompleted === true) return true;
    return a.status === 'Submitted';
  };

  const oldIds = new Set(oldAssigns.map((a) => a.id));
  const allLocal = await browser.storage.local.get(null);
  const newNotifiedUpdates: Record<string, boolean> = {};

  for (const assign of newAssigns) {
    // Skip hidden, completed/submitted, or undated assignments
    if (!assign.deadline || hiddenSet.has(assign.id) || assign.isHidden || isDone(assign)) {
      continue;
    }

    const courseDisplayName = activeSettings.coursesCustomNames?.[assign.courseId]?.trim() || assign.courseName;

    // 1. Notify for new assignments (only if we already had a previous sync snapshot)
    if (oldAssigns.length > 0 && !oldIds.has(assign.id)) {
      const deadlineText = `Due: ${new Date(assign.deadline).toLocaleString()}`;

      browser.notifications.create(`new_assign_${assign.id}`, {
        type: 'basic',
        iconUrl: browser.runtime.getURL('icon-128.png'),
        title: 'New Moodle Assignment',
        message: `${assign.name}\n${courseDisplayName}\n${deadlineText}`,
      });
    }

    // 2. Notify for upcoming deadlines
    const deadline = new Date(assign.deadline);
    const hoursLeft = (deadline.getTime() - Date.now()) / (1000 * 60 * 60);

    const key24h = `notified_24h_${assign.id}`;
    const wasNotified24h = !!allLocal[key24h] || !!newNotifiedUpdates[key24h];
    if (hoursLeft <= 24 && hoursLeft > 1 && !wasNotified24h) {
      browser.notifications.create(`upcoming_24h_${assign.id}`, {
        type: 'basic',
        iconUrl: browser.runtime.getURL('icon-128.png'),
        title: 'Assignment Due Within 24 Hours',
        message: `${assign.name}\n${courseDisplayName}\nDue in ${Math.max(1, Math.round(hoursLeft))} hours`,
      });
      newNotifiedUpdates[key24h] = true;
    }

    const key1h = `notified_1h_${assign.id}`;
    const wasNotified1h = !!allLocal[key1h] || !!newNotifiedUpdates[key1h];
    if (hoursLeft <= 1 && hoursLeft > 0 && !wasNotified1h) {
      browser.notifications.create(`upcoming_1h_${assign.id}`, {
        type: 'basic',
        iconUrl: browser.runtime.getURL('icon-128.png'),
        title: 'Assignment Due In 1 Hour!',
        message: `${assign.name}\n${courseDisplayName}\nDue soon!`,
      });
      newNotifiedUpdates[key1h] = true;
    }
  }

  if (Object.keys(newNotifiedUpdates).length > 0) {
    await browser.storage.local.set(newNotifiedUpdates);
  }
}

// --------------------------------------------------------------------------
// Programmatic TAU SSO Login
// --------------------------------------------------------------------------

function decodeHTMLEntities(text: string) {
  return text.replace(/&quot;/g, '"')
    .replace(/&#x3d;/g, '=')
    .replace(/&#x3D;/g, '=')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

async function loginTauSso(username: string, idNumber: string, pass: string, skipInvalidate = false): Promise<string> {
  // 0. Force a clean session state unless skipInvalidate is set.
  if (!skipInvalidate) {
    try {
      await invalidateSsoSession();
    } catch (e) {
      console.log('Failed to invalidate existing SSO session before login', e);
    }
  }

  // 1. Initial request to login/index.php to get baseUrl
  let ssoUrl = '';
  let baseUrl = '';

  const initialRes = await fetch('https://moodle.tau.ac.il/login/index.php', { credentials: 'include' });
  const urlAfterLogin = initialRes.url;
  
  if (urlAfterLogin.includes('/auth/saml2/login.php')) {
    baseUrl = urlAfterLogin.split('/auth')[0];
    const samlRes = await fetch(urlAfterLogin, { credentials: 'include' });
    ssoUrl = samlRes.url;
  } else {
    baseUrl = 'https://moodle.tau.ac.il'; // Fallback
    ssoUrl = urlAfterLogin;
  }

  if (!ssoUrl.includes('nidp.tau.ac.il')) {
    // We may already be logged in (valid session cookies). If we landed on a
    // Moodle page, try to extract the sesskey and token directly.
    if (ssoUrl.includes('moodle.tau.ac.il')) {
      console.log('[loginTauSso] Already logged into Moodle, extracting sesskey from dashboard...');
      const dashboardRes = await fetch(ssoUrl, { credentials: 'include' });
      const dashboardHtml = await dashboardRes.text();
      const dashSesskeyMatch = dashboardHtml.match(/"sesskey":"([^"]+)"/);
      if (dashSesskeyMatch) {
        const sesskey = dashSesskeyMatch[1];
        await setStoredSesskey(sesskey);

        if (!baseUrl) {
          const myUrlMatch = dashboardRes.url.match(/^(https:\/\/[^/]+\/(?:[0-9]{4}\/)?)/);
          baseUrl = myUrlMatch ? myUrlMatch[1].replace(/\/$/, '') : 'https://moodle.tau.ac.il';
        }

        // Reuse the token-reset logic to get a fresh wstoken
        let scrapedToken: string | null = null;
        try {
          const manageUrl = `${baseUrl}/user/managetoken.php`;
          const manageRes = await fetch(manageUrl, { credentials: 'include' });
          const manageHtml = await manageRes.text();
          const trs = manageHtml.split(/<tr/i);
          const targetTr = trs.find(t => /moodle\s+mobile\s+web\s+service/i.test(t) || /moodle_mobile_app/i.test(t))
                        || trs.find(t => /mobile/i.test(t));
          const tokenMatch = targetTr ? targetTr.match(/action=resetwstoken(?:&amp;|&)tokenid=(\d+)/i) : null;
          if (tokenMatch) {
            const tokenId = tokenMatch[1];
            const resetUrl = `${manageUrl}?action=resetwstoken&tokenid=${tokenId}&confirm=1&sesskey=${sesskey}`;
            const resetRes = await fetch(resetUrl, { credentials: 'include' });
            const resetHtml = await resetRes.text();
            const finalTokenMatch = resetHtml.match(/id="copytoclipboardtoken"[^>]*>([a-f0-9]{32})<\/div>/i) || resetHtml.match(/([a-f0-9]{32})/);
            if (finalTokenMatch) {
              scrapedToken = finalTokenMatch[1].trim();
            }
          }
        } catch (e) {
          console.warn('[loginTauSso] Could not scrape mobile token from dashboard session:', e);
        }

        const finalToken = scrapedToken || `web_session_${Date.now()}`;
        await setStoredToken(finalToken);
        console.log('[loginTauSso] Recovered token from existing dashboard session');
        return finalToken;
      }
    }
    throw new Error('Did not redirect to TAU SSO. URL: ' + ssoUrl);
  }

  // 2. Parse the auto-submitting form that sets up the SAML session
  let html1 = await (await fetch(ssoUrl, { credentials: 'include' })).text();
  const formActionMatch1 = html1.match(/<form[^>]+action=["']([^"']+)["']/i);
  if (formActionMatch1) {
    const action = formActionMatch1[1];
    ssoUrl = action.startsWith('http') ? action : new URL(action, 'https://nidp.tau.ac.il').href;

    const params = new URLSearchParams();
    const inputs = [...html1.matchAll(/<input[^>]+name=["']([^"']+)["'][^>]+value=["']([^"']+)["']/gi)];
    inputs.forEach(m => params.append(decodeHTMLEntities(m[1]), decodeHTMLEntities(m[2])));

    await fetch(ssoUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      credentials: 'include',
      body: params
    });
  }

  // 3. Initiate login sequence
  await fetch(ssoUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    credentials: 'include',
    body: 'option=credential&initiateLoginSequence=true&isAjax=true'
  });

  // 4. Submit credentials
  const credRes = await fetch(ssoUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    credentials: 'include',
    body: `option=credential&isAjax=true&Ecom_User_ID=${encodeURIComponent(username)}&Ecom_User_Pid=${encodeURIComponent(idNumber)}&Ecom_Password=${encodeURIComponent(pass)}`
  });

  const credText = await credRes.text();

  if (credText.replace(/\s/g, '').includes('"isError":true')) {
    let errorCode = 'Invalid username, ID, or password';
    try {
      const credData = JSON.parse(credText);
      errorCode = credData.errorCode === 'WRONG_USERNAME_OR_PASSWORD' ? 'שם משתמש ת.ז. או סיסמה אינם נכונים' : credData.errorCode;
    } catch (e) { }
    throw new Error(errorCode);
  }

  // 5. Complete SSO.
  const finalSsoRes = await fetch(ssoUrl, { credentials: 'include' });
  const html2 = await finalSsoRes.text();

  let samlResponse = '';
  let relayState = '';
  const finalInputs = [...html2.matchAll(/<input([^>]+)>/gi)];
  for (const m of finalInputs) {
    const nMatch = m[1].match(/name=["']([^"']+)["']/i);
    const vMatch = m[1].match(/value=["']([^"']+)["']/i);
    if (nMatch && vMatch) {
      if (nMatch[1] === 'SAMLResponse') samlResponse = vMatch[1];
      if (nMatch[1] === 'RelayState') relayState = vMatch[1];
    }
  }

  const actionMatch = html2.match(/<form[^>]+action=["']([^"']+)["']/i);

  if (!actionMatch || !samlResponse) {
    const debugHtml = html2.length > 500 ? html2.substring(0, 500) + '...' : html2;
    throw new Error('SAML Parsing Failed. HTML: ' + debugHtml);
  }

  const actionUrl = decodeHTMLEntities(actionMatch[1]);
  samlResponse = decodeHTMLEntities(samlResponse);
  relayState = relayState ? decodeHTMLEntities(relayState) : '';

  const bodyParams = new URLSearchParams();
  bodyParams.append('SAMLResponse', samlResponse);
  if (relayState) {
    bodyParams.append('RelayState', relayState);
  }

  // 6. Submit SAML response back to Moodle.
  const moodleRes = await fetch(actionUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    credentials: 'include',
    body: bodyParams
  });

  const moodleHtml = await moodleRes.text();
  const sesskeyMatch = moodleHtml.match(/"sesskey":"([^"]+)"/);
  
  if (!sesskeyMatch) {
    throw new Error('Failed to extract sesskey from Moodle dashboard after SSO login');
  }
  
  if (!baseUrl) {
     const myUrlMatch = moodleRes.url.match(/^(https:\/\/[^/]+\/(?:[0-9]{4}\/)?)/);
     baseUrl = myUrlMatch ? myUrlMatch[1].replace(/\/$/, '') : 'https://moodle.tau.ac.il';
  }

  const sesskey = sesskeyMatch[1];
  await setStoredSesskey(sesskey);
  
    // 7. Try to scrape managetoken.php and reset the token for Moodle Mobile App
  let scrapedToken: string | null = null;
  try {
    const manageUrl = `${baseUrl}/user/managetoken.php`;
    const manageRes = await fetch(manageUrl, { credentials: 'include' });
    const manageHtml = await manageRes.text();
    
    // Split by tr to ensure we only get the token for the mobile app
    const trs = manageHtml.split(/<tr/i);
    const targetTr = trs.find(t => /moodle\s+mobile\s+web\s+service/i.test(t) || /moodle_mobile_app/i.test(t))
                  || trs.find(t => /mobile/i.test(t));
    
    const tokenMatch = targetTr ? targetTr.match(/action=resetwstoken(?:&amp;|&)tokenid=(\d+)/i) : null;
    
    if (tokenMatch) {
      const tokenId = tokenMatch[1];
      
      // Reset the token via GET confirmation link
      const resetUrl = `${manageUrl}?action=resetwstoken&tokenid=${tokenId}&confirm=1&sesskey=${sesskey}`;
      const resetRes = await fetch(resetUrl, { credentials: 'include' });
      const resetHtml = await resetRes.text();
      
      // Read the redirected HTML to find the newly generated 32-hex wstoken
      const finalTokenMatch = resetHtml.match(/id="copytoclipboardtoken"[^>]*>([a-f0-9]{32})<\/div>/i) || resetHtml.match(/([a-f0-9]{32})/);
      if (finalTokenMatch) {
        scrapedToken = finalTokenMatch[1].trim();
      }
    }
  } catch (e) {
    console.warn('[loginTauSso] Could not scrape mobile token, proceeding with web session fallback:', e);
  }

  const finalToken = scrapedToken || `web_session_${Date.now()}`;
  await setStoredToken(finalToken);
  return finalToken;
}

