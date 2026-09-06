import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { getOrCreateTaskList, syncAssignmentsToGoogleTasks, Assignment } from '@tautracker/moodle-client';
import { getPreference, getDb } from './database';

export const DEFAULT_GOOGLE_CLIENT_ID = '510394355212-opk74l9lv3e44sv3m1c1u96ocsdn1n0j.apps.googleusercontent.com';

// Self-contained Pure JS SHA-256 implementation (RFC 7636 PKCE S256 compatible)
function sha256(ascii: string): Uint8Array {
  function rightRotate(value: number, amount: number): number {
    return (value >>> amount) | (value << (32 - amount));
  }
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  const lengthProperty = 'length';
  let i: number, j: number;
  const words: number[] = [];
  const asciiBitLength = ascii[lengthProperty] * 8;
  let hash: number[] = [];
  const k: number[] = [];
  let primeCounter = 0;
  const isComposite: Record<number, boolean> = {};

  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (i = 0; i < 313; i += candidate) {
        isComposite[i] = true;
      }
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }

  ascii += '\x80';
  while ((ascii[lengthProperty] % 64) - 56) ascii += '\x00';
  for (i = 0; i < ascii[lengthProperty]; i++) {
    j = ascii.charCodeAt(i);
    if (j >> 8) return new Uint8Array();
    words[i >> 2] |= j << (((3 - i) % 4) * 8);
  }
  words[words[lengthProperty]] = (asciiBitLength / maxWord) | 0;
  words[words[lengthProperty]] = asciiBitLength;

  for (j = 0; j < words[lengthProperty]; ) {
    const w = words.slice(j, (j += 16));
    const oldHash = hash;
    hash = hash.slice(0, 8);
    for (i = 0; i < 64; i++) {
      const w15 = w[i - 15], w2 = w[i - 2];
      const s0 = rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3);
      const s1 = rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10);
      w[i] = i < 16 ? w[i] : (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      const ch = (hash[4] & hash[5]) ^ (~hash[4] & hash[6]);
      const maj = (hash[0] & hash[1]) ^ (hash[0] & hash[2]) ^ (hash[1] & hash[2]);
      const temp1 = (hash[7] + (rightRotate(hash[4], 6) ^ rightRotate(hash[4], 11) ^ rightRotate(hash[4], 25)) + ch + k[i] + w[i]) | 0;
      const temp2 = ((rightRotate(hash[0], 2) ^ rightRotate(hash[0], 13) ^ rightRotate(hash[0], 22)) + maj) | 0;
      hash = [(temp1 + temp2) | 0].concat(hash);
      hash[4] = (hash[4] + temp1) | 0;
    }
    for (i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }

  const bytes: number[] = [];
  for (i = 0; i < 8; i++) {
    for (let b = 3; b >= 0; b--) {
      bytes.push((hash[i] >>> (b * 8)) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

function base64Url(bytes: Uint8Array): string {
  const b64chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b1 = bytes[i];
    const b2 = i + 1 < len ? bytes[i + 1] : 0;
    const b3 = i + 2 < len ? bytes[i + 2] : 0;
    result += b64chars[b1 >> 2];
    result += b64chars[((b1 & 3) << 4) | (b2 >> 4)];
    result += i + 1 < len ? b64chars[((b2 & 15) << 2) | (b3 >> 6)] : '';
    result += i + 2 < len ? b64chars[b3 & 63] : '';
  }
  return result.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generateCodeVerifier(length = 64): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  let result = '';
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const randomBytes = new Uint8Array(length);
    crypto.getRandomValues(randomBytes);
    for (let i = 0; i < length; i++) {
      result += chars[randomBytes[i] % chars.length];
    }
  } else {
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  }
  return result;
}

export async function getGoogleAccessToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync('google_access_token');
  } catch (e) {
    console.error('getGoogleAccessToken error:', e);
    return null;
  }
}

export async function getGoogleRefreshToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync('google_refresh_token');
  } catch (e) {
    console.error('getGoogleRefreshToken error:', e);
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

export async function setGoogleRefreshToken(token: string | null): Promise<void> {
  try {
    if (token === null) {
      await SecureStore.deleteItemAsync('google_refresh_token');
    } else {
      await SecureStore.setItemAsync('google_refresh_token', token);
    }
  } catch (e) {
    console.error('setGoogleRefreshToken error:', e);
  }
}

export async function refreshGoogleAccessToken(): Promise<string | null> {
  try {
    const refreshToken = await getGoogleRefreshToken();
    if (!refreshToken) return null;

    const clientId = getPreference('google_tasks_client_id') || DEFAULT_GOOGLE_CLIENT_ID;
    const clientSecret = getPreference('google_tasks_client_secret') || '';

    const bodyParams: Record<string, string> = {
      client_id: clientId,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    };
    if (clientSecret.trim()) {
      bodyParams.client_secret = clientSecret.trim();
    }

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(bodyParams).toString(),
    });

    const data = await res.json();
    if (data.access_token) {
      await setGoogleAccessToken(data.access_token);
      if (data.refresh_token) {
        await setGoogleRefreshToken(data.refresh_token);
      }
      return data.access_token;
    }
    console.warn('refreshGoogleAccessToken failed:', data);
    return null;
  } catch (e) {
    console.error('refreshGoogleAccessToken error:', e);
    return null;
  }
}

export const CHROME_EXTENSION_CLIENT_ID = '510394355212-0e3ums7pu5raagej4gg14nrkt9o06m78.apps.googleusercontent.com';
export const CHROME_EXTENSION_REDIRECT_URI = 'https://gaiognmkgghdihdeokgmpcdndmencdbj.chromiumapp.org/';

export function getEffectiveRedirectUri(clientId: string): string {
  const customRedirect = getPreference('google_tasks_redirect_uri');
  if (customRedirect && customRedirect.trim()) {
    return customRedirect.trim();
  }
  if (clientId === CHROME_EXTENSION_CLIENT_ID) {
    return CHROME_EXTENSION_REDIRECT_URI;
  }
  if (clientId.endsWith('.apps.googleusercontent.com')) {
    const prefix = clientId.replace('.apps.googleusercontent.com', '');
    return `com.googleusercontent.apps.${prefix}:/oauth2redirect`;
  }
  return Linking.createURL('oauth');
}

export async function authenticateGoogleOAuth(
  customClientId?: string,
  customClientSecret?: string
): Promise<{ success: boolean; token?: string; error?: string }> {
  try {
    const clientId = customClientId?.trim() || getPreference('google_tasks_client_id') || DEFAULT_GOOGLE_CLIENT_ID;
    const clientSecret = customClientSecret?.trim() || getPreference('google_tasks_client_secret') || '';
    const redirectUrl = getEffectiveRedirectUri(clientId);

    const isExtensionClient = clientId === CHROME_EXTENSION_CLIENT_ID;
    const responseType = isExtensionClient ? 'token' : 'code';

    const codeVerifier = generateCodeVerifier(64);
    const codeChallenge = base64Url(sha256(codeVerifier));

    let authUrl =
      `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${encodeURIComponent(clientId)}&` +
      `response_type=${responseType}&` +
      `redirect_uri=${encodeURIComponent(redirectUrl)}&` +
      `scope=${encodeURIComponent('https://www.googleapis.com/auth/tasks')}&` +
      `prompt=consent`;

    if (responseType === 'code') {
      authUrl += `&code_challenge=${encodeURIComponent(codeChallenge)}&code_challenge_method=S256&access_type=offline`;
    }

    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);

    if (result.type !== 'success' || !result.url) {
      if (result.type === 'cancel' || result.type === 'dismiss') {
        return { success: false, error: 'Authentication was cancelled' };
      }
      return { success: false, error: 'Failed to complete Google authentication' };
    }

    const responseUrl = result.url;
    let authCode: string | null = null;
    let directToken: string | null = null;

    if (responseUrl.includes('?')) {
      const queryPart = responseUrl.split('?')[1].split('#')[0];
      const params = new URLSearchParams(queryPart);
      authCode = params.get('code');
      directToken = params.get('access_token');
    }

    if (!authCode && responseUrl.includes('#')) {
      const hashPart = responseUrl.split('#')[1];
      const params = new URLSearchParams(hashPart);
      authCode = params.get('code');
      directToken = params.get('access_token');
    }

    if (directToken) {
      await setGoogleAccessToken(directToken);
      return { success: true, token: directToken };
    }

    if (!authCode) {
      return { success: false, error: 'No authorization code or token received from Google' };
    }

    // Exchange authCode for access_token with PKCE verifier
    const tokenParams: Record<string, string> = {
      client_id: clientId,
      code: authCode,
      code_verifier: codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUrl,
    };
    if (clientSecret.trim()) {
      tokenParams.client_secret = clientSecret.trim();
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(tokenParams).toString(),
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      const err = tokenData.error_description || tokenData.error || 'Failed to exchange authorization code for access token';
      return { success: false, error: err };
    }

    await setGoogleAccessToken(tokenData.access_token);
    if (tokenData.refresh_token) {
      await setGoogleRefreshToken(tokenData.refresh_token);
    }

    return { success: true, token: tokenData.access_token };
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

    let accessToken = await getGoogleAccessToken();
    if (!accessToken) {
      accessToken = await refreshGoogleAccessToken();
    }
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

    const mappedAssignments = assignments.map((a) => {
      const nickname = courseNameMap.get(a.courseId);
      return nickname && nickname.trim() ? { ...a, courseName: nickname.trim() } : a;
    });

    const listName = getPreference('google_tasks_list_name') || 'University';
    const syncErrors: string[] = [];
    let listId = '';
    try {
      listId = await getOrCreateTaskList(accessToken, listName, (err: string) => {
        syncErrors.push(err);
      });
    } catch (err: any) {
      if (err.message && (err.message.includes('401') || err.message.toLowerCase().includes('unauthorized'))) {
        // Token might have expired, try refresh once
        const refreshedToken = await refreshGoogleAccessToken();
        if (refreshedToken) {
          accessToken = refreshedToken;
          listId = await getOrCreateTaskList(accessToken, listName, (e: string) => {
            syncErrors.push(e);
          });
        } else {
          throw err;
        }
      } else {
        throw err;
      }
    }

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
