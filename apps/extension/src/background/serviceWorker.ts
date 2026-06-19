import { runSync, getOrCreateTaskList, syncAssignmentsToGoogleTasks, MoodleClient } from '@tautracker/moodle-client';
import {
  getStoredToken,
  getTrackedCourseIds,
  setCachedSyncResult,
  getSettings,
  getCachedSyncResult,
} from '../shared/storage.js';




// Setup periodic alarms on install / startup
chrome.runtime.onInstalled.addListener(async () => {
  console.log('TauTracker Extension Installed');
  // Always recreate the alarm on install/update to ensure correct period (5 minutes)
  await chrome.alarms.create('periodicSync', { periodInMinutes: 5 });
  console.log('Forced creation of periodicSync alarm for 5 minutes onInstalled');
});

// Setup alarm checking function to register the alarm on startup without resetting it if it already exists
async function setupAlarm() {
  const alarm = await chrome.alarms.get('periodicSync');
  if (!alarm || alarm.periodInMinutes !== 5) {
    await chrome.alarms.create('periodicSync', { periodInMinutes: 5 });
    console.log('Created periodicSync alarm for 5 minutes');
  } else {
    console.log('periodicSync alarm already exists with 5 minutes');
  }
}
setupAlarm();

chrome.runtime.onStartup.addListener(setupAlarm);

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
// Message listeners
// --------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message: any, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {


  if (message.type === 'LOGIN_TAU_SSO') {
    loginTauSso(message.username, message.idNumber, message.pass)
      .then((token) => sendResponse({ success: true, token }))
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

  if (message.type === 'LOGOUT') {
    sendResponse({ success: true });
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
  let token = await getStoredToken();

  if (!token) {
    console.log('Sync skipped: No Moodle token stored.');
    throw new Error('Not authenticated with Moodle');
  }

  const trackedCourseIds = await getTrackedCourseIds();
  const settings = await getSettings();
  const prevResult = await getCachedSyncResult();

  let result;
  try {
    result = await runSync(token, trackedCourseIds, (msg) => {
      console.log(`[Sync Progress] ${msg}`);
    });
  } catch (err: any) {
    if ((err.message && err.message.toLowerCase().includes('invalidtoken')) || err.name === 'MoodleApiError') {
      console.log('Token invalid/expired. Prompting user to re-login.');
      chrome.notifications.create('moodle_token_expired', {
        type: 'basic',
        iconUrl: 'favicon.svg',
        title: 'Moodle Session Expired',
        message: 'Your Moodle session has expired. Please open Noodle to log in again.',
        requireInteraction: true,
      });
      throw new Error('Moodle session expired');
    } else {
      throw err;
    }
  }

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

async function getLaunchWebAuthFlowToken(clientId: string, interactive: boolean): Promise<string> {
  const cached = (await chrome.storage.local.get(['googleAccessToken', 'googleTokenExpiry'])) as {
    googleAccessToken?: string;
    googleTokenExpiry?: number;
  };
  if (cached.googleAccessToken && cached.googleTokenExpiry && cached.googleTokenExpiry > Date.now() + 60000) {
    return cached.googleAccessToken;
  }

  if (!interactive) {
    throw new Error('Google Tasks authentication required. Please open settings and sync manually.');
  }

  const redirectUrl = `https://${chrome.runtime.id}.chromiumapp.org/`;
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&response_type=token&redirect_uri=${encodeURIComponent(redirectUrl)}&scope=${encodeURIComponent('https://www.googleapis.com/auth/tasks')}`;

  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (responseUrl) => {
      if (chrome.runtime.lastError) {
        return reject(new Error(chrome.runtime.lastError.message));
      }
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
        chrome.storage.local.set({
          googleAccessToken: token,
          googleTokenExpiry: expiryTime
        }).then(() => {
          resolve(token);
        });
      } catch (err: any) {
        reject(new Error(`Failed to parse Google Tasks token: ${err.message}`));
      }
    });
  });
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

  let accessToken: string;
  if (settings.googleClientId && settings.googleClientId.trim()) {
    accessToken = await getLaunchWebAuthFlowToken(settings.googleClientId.trim(), interactive);
  } else {
    accessToken = await new Promise<string>((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive }, (result: any) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        const token = result && typeof result === 'object' ? result.token : result;
        if (!token) {
          return reject(new Error('Failed to obtain Google access token'));
        }
        resolve(token);
      });
    });
  }

  const syncErrors: string[] = [];
  const listId = await getOrCreateTaskList(accessToken, settings.googleTasksListName, (err: string) => {
    syncErrors.push(err);
  });

  const mappedAssignments = cachedResult.assignments.map((a: any) => {
    const nickname = settings.coursesCustomNames?.[a.courseId];
    return nickname && nickname.trim() ? { ...a, courseName: nickname.trim() } : a;
  });

  const { syncedCount, errors } = await syncAssignmentsToGoogleTasks(
    accessToken,
    listId,
    mappedAssignments
  );

  const allErrors = [...syncErrors, ...errors];

  if (allErrors.length > 0) {
    console.warn('Google Tasks sync encountered errors:', allErrors);
    return `Synced ${syncedCount} tasks with ${allErrors.length} errors.`;
  } else {
    return `Successfully synced ${syncedCount} tasks to Google Tasks.`;
  }
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

// --------------------------------------------------------------------------
// Programmatic TAU SSO Login
// --------------------------------------------------------------------------

let capturedTokenResolve: ((token: string) => void) | null = null;
let capturedTokenReject: ((err: Error) => void) | null = null;
let activeLoginTimeout: ReturnType<typeof setTimeout> | null = null;

chrome.webRequest.onBeforeRedirect.addListener(
  (details) => {
    const redirectUrl = details.redirectUrl || '';
    if (redirectUrl.startsWith('moodlemobile://') || redirectUrl.startsWith('moodleapp://')) {
      const match = redirectUrl.match(/(?:moodlemobile|moodleapp):\/\/token=([a-zA-Z0-9+/=]+)/);
      if (match) {
        try {
          const parts = atob(match[1]).split(':::');
          const token = parts.length > 1 ? parts[1] : parts[0];
          console.log('Captured token from SSO redirect via webRequest');
          if (activeLoginTimeout) {
            clearTimeout(activeLoginTimeout);
            activeLoginTimeout = null;
          }
          if (capturedTokenResolve) {
            capturedTokenResolve(token);
            capturedTokenResolve = null;
            capturedTokenReject = null;
          }
        } catch (e) {
          console.error('Error decoding token', e);
        }
      }
    }
  },
  { urls: ['https://moodle.tau.ac.il/*'] }
);

function decodeHTMLEntities(text: string) {
  return text.replace(/&quot;/g, '"')
             .replace(/&#x3d;/g, '=')
             .replace(/&#x3D;/g, '=')
             .replace(/&lt;/g, '<')
             .replace(/&gt;/g, '>')
             .replace(/&amp;/g, '&');
}

async function loginTauSso(username: string, idNumber: string, pass: string): Promise<string> {
  return new Promise<string>(async (resolve, reject) => {
    capturedTokenResolve = resolve;
    capturedTokenReject = reject;
    
    // Set a global timeout for the entire login process
    if (activeLoginTimeout) clearTimeout(activeLoginTimeout);
    activeLoginTimeout = setTimeout(() => {
      if (capturedTokenReject) {
        capturedTokenReject(new Error('Timeout waiting for Moodle token redirect'));
        capturedTokenResolve = null;
        capturedTokenReject = null;
      }
    }, 25000);

    try {
      const launchUrl = `https://moodle.tau.ac.il/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=${Math.random().toString(36).substring(2, 15)}`;
      
      // 1. Initial request to get SSO URL (auto-follows to nidp.tau.ac.il, or immediately to moodlemobile:// if already logged in)
      let res1;
      try {
        res1 = await fetch(launchUrl);
      } catch (e) {
        // If fetch throws on the very first request, it's likely because it hit the moodlemobile:// redirect!
        // We just wait a bit for the webRequest listener to fire and resolve the promise.
        console.log('fetch(launchUrl) threw, waiting for redirect interceptor...', e);
        return;
      }

      let ssoUrl = res1.url;
      if (!ssoUrl.includes('nidp.tau.ac.il')) {
        throw new Error('Did not redirect to TAU SSO. URL: ' + ssoUrl);
      }

      // 2. Parse the auto-submitting form that sets up the SAML session
      const html1 = await res1.text();
      const formActionMatch1 = html1.match(/<form[^>]+action=["']([^"']+)["']/i);
      if (formActionMatch1) {
        const action = formActionMatch1[1];
        ssoUrl = action.startsWith('http') ? action : new URL(action, 'https://nidp.tau.ac.il').href;
        // Submit the form (empty POST) to initialize the session
        await fetch(ssoUrl, { method: 'POST' });
      }

      // 3. Initiate login sequence
      await fetch(ssoUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'option=credential&initiateLoginSequence=true&isAjax=true'
      });

      // 4. Submit credentials
      const credRes = await fetch(ssoUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `option=credential&isAjax=true&Ecom_User_ID=${encodeURIComponent(username)}&Ecom_User_Pid=${encodeURIComponent(idNumber)}&Ecom_Password=${encodeURIComponent(pass)}`
      });
      
      const credText = await credRes.text();
      
      if (credText.replace(/\s/g, '').includes('"isError":true')) {
        let errorCode = 'Invalid username, ID, or password';
        try {
          const credData = JSON.parse(credText);
          errorCode = credData.errorCode === 'WRONG_USERNAME_OR_PASSWORD' ? 'שם משתמש או סיסמה שהזנתם אינם תקינים' : credData.errorCode;
        } catch (e) {}
        throw new Error(errorCode);
      }

      // 5. Complete SSO. Fetching the SSO URL again yields the auto-submitting SAML form
      const finalSsoRes = await fetch(ssoUrl);
      const html2 = await finalSsoRes.text();

      // Extract form action, SAMLResponse, and RelayState
      const actionMatch = html2.match(/<form[^>]+action=["']([^"']+)["']/i);
      const samlMatch = html2.match(/<input[^>]+name=["']SAMLResponse["'][^>]+value=["']([^"']+)["']/i);
      const relayMatch = html2.match(/<input[^>]+name=["']RelayState["'][^>]+value=["']([^"']+)["']/i);

      if (!actionMatch || !samlMatch) {
        throw new Error('Failed to parse SAML response from SSO page');
      }

      const actionUrl = decodeHTMLEntities(actionMatch[1]);
      const samlResponse = decodeHTMLEntities(samlMatch[1]);
      const relayState = relayMatch ? decodeHTMLEntities(relayMatch[1]) : '';

      const bodyParams = new URLSearchParams();
      bodyParams.append('SAMLResponse', samlResponse);
      if (relayState) {
        bodyParams.append('RelayState', relayState);
      }

      // 6. Submit SAML response back to Moodle.
      try {
        await fetch(actionUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: bodyParams
        });
      } catch (e) {
        console.log('Expected fetch error on custom protocol redirect:', e);
      }
    } catch (error) {
      if (activeLoginTimeout) clearTimeout(activeLoginTimeout);
      if (capturedTokenReject) {
        capturedTokenReject(error instanceof Error ? error : new Error(String(error)));
        capturedTokenResolve = null;
        capturedTokenReject = null;
      }
    }
  });
}

