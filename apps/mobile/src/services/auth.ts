import { Platform } from 'react-native';
import type * as SecureStoreTypes from 'expo-secure-store';
import {
  CookieJar,
  decodeHTMLEntities,
  isValidIsraeliId,
  mfetch,
  mfetchFollow,
  performLogin,
  type MoodleCredentials,
} from '@tautracker/moodle-client';
import { clearUserTablesOnLogout } from './database';
import {
  clearAllCookiesNative,
  fetchMoodleMobileTokenViaLaunchNative,
} from './nativeBridge';

export { isValidIsraeliId };
export type { MoodleCredentials };

const CREDENTIALS_KEY = 'moodle_credentials';
const TOKEN_KEY = 'moodle_wstoken';
const SESSKEY_KEY = 'moodle_sesskey';
const WEB_SECURE_PREFIX = 'noodle_secure_';

// ── Web & Jest safe secure storage wrapper ─────────────────────────────────

const memSecureStore: Record<string, string> = {};

function getWebStorage(): Storage | null {
  try {
    if (
      Platform.OS === 'web' &&
      typeof window !== 'undefined' &&
      typeof window.localStorage !== 'undefined'
    ) {
      return window.localStorage;
    }
  } catch {
    // Ignore restricted storage access
  }
  return null;
}

async function getAvailableSecureStore(): Promise<typeof SecureStoreTypes | null> {
  if (Platform.OS === 'web') {
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-secure-store') as typeof SecureStoreTypes;
    if (!mod) return null;
    if (typeof mod.isAvailableAsync === 'function') {
      const available = await mod.isAvailableAsync();
      return available ? mod : null;
    }
    return typeof mod.getItemAsync === 'function' ? mod : null;
  } catch {
    return null;
  }
}

async function secureGetItem(key: string): Promise<string | null> {
  const store = await getAvailableSecureStore();
  if (store) {
    try {
      const res = await store.getItemAsync(key);
      if (typeof res === 'string') {
        return res;
      }
      if (Object.prototype.hasOwnProperty.call(memSecureStore, key)) {
        return memSecureStore[key];
      }
      return null;
    } catch {
      // Fall back to memory
    }
  }
  const ls = getWebStorage();
  if (ls) {
    try {
      return ls.getItem(`${WEB_SECURE_PREFIX}${key}`);
    } catch {
      // Fall back to memory
    }
  }
  return Object.prototype.hasOwnProperty.call(memSecureStore, key) ? memSecureStore[key] : null;
}

async function secureSetItem(key: string, value: string): Promise<void> {
  memSecureStore[key] = value;
  const store = await getAvailableSecureStore();
  if (store) {
    try {
      await store.setItemAsync(key, value);
      return;
    } catch {
      // Keep memory fallback
    }
  }
  const ls = getWebStorage();
  if (ls) {
    try {
      ls.setItem(`${WEB_SECURE_PREFIX}${key}`, value);
    } catch {
      // Ignore quota errors
    }
  }
}

async function secureDeleteItem(key: string): Promise<void> {
  const store = await getAvailableSecureStore();
  if (store) {
    try {
      await store.deleteItemAsync(key);
    } catch {
      // Continue to clean fallback too
    }
  }
  delete memSecureStore[key];
  const ls = getWebStorage();
  if (ls) {
    try {
      ls.removeItem(`${WEB_SECURE_PREFIX}${key}`);
    } catch {
      // Ignore
    }
  }
}

// ── Credential, Token & Sesskey Storage ────────────────────────────────────

export async function getStoredCredentials(): Promise<MoodleCredentials | null> {
  try {
    const raw = await secureGetItem(CREDENTIALS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as MoodleCredentials;
  } catch (e) {
    console.error('getStoredCredentials error:', e);
    return null;
  }
}

export async function saveCredentials(
  username: string,
  idNumber: string,
  password: string
): Promise<void> {
  try {
    const payload: MoodleCredentials = { username, idNumber, password };
    await secureSetItem(CREDENTIALS_KEY, JSON.stringify(payload));
  } catch (e) {
    console.error('saveCredentials error:', e);
  }
}

export async function clearCredentials(): Promise<void> {
  try {
    await secureDeleteItem(CREDENTIALS_KEY);
  } catch (e) {
    console.error('clearCredentials error:', e);
  }
}

export async function getStoredToken(): Promise<string | null> {
  try {
    return await secureGetItem(TOKEN_KEY);
  } catch (e) {
    console.error('getStoredToken error:', e);
    return null;
  }
}

export async function saveToken(token: string | null): Promise<void> {
  try {
    if (!token) {
      await secureDeleteItem(TOKEN_KEY);
    } else {
      await secureSetItem(TOKEN_KEY, token);
    }
  } catch (e) {
    console.error('saveToken error:', e);
  }
}

export async function getStoredSesskey(): Promise<string | null> {
  try {
    return await secureGetItem(SESSKEY_KEY);
  } catch (e) {
    console.error('getStoredSesskey error:', e);
    return null;
  }
}

export async function saveSesskey(sesskey: string | null): Promise<void> {
  try {
    if (!sesskey) {
      await secureDeleteItem(SESSKEY_KEY);
    } else {
      await secureSetItem(SESSKEY_KEY, sesskey);
    }
  } catch (e) {
    console.error('saveSesskey error:', e);
  }
}

// ── Token Extraction ───────────────────────────────────────────────────────

function decodeBase64(b64: string): string {
  const normalized = b64.replace(/-/g, '+').replace(/_/g, '/');
  if (typeof atob === 'function') {
    return atob(normalized);
  }
  // Pure JS fallback when global atob is unavailable
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = normalized.replace(/=+$/, '');
  let output = '';
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const val = chars.indexOf(clean[i]);
    if (val < 0) throw new Error('Invalid base64 character');
    buffer = (buffer << 6) | val;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return output;
}

export function tryExtractTokenFromUrl(url: string): string | null {
  if (!url) return null;
  const match = url.match(/(?:moodlemobile|moodleapp):\/\/token=([^&\s#]+)/i);
  if (!match || !match[1]) return null;
  try {
    let rawPayload = match[1];
    if (rawPayload.includes('%')) {
      rawPayload = decodeURIComponent(rawPayload);
    }
    const decoded = decodeBase64(rawPayload);
    const parts = decoded.split(':::');
    const candidate = (parts.length > 1 ? parts[1] : parts[0]).trim();
    return candidate.length > 0 ? candidate : null;
  } catch {
    return null;
  }
}

function isValidRealToken(token: string | null | undefined): token is string {
  if (!token) return false;
  const trimmed = token.trim();
  return trimmed.length >= 32 && !trimmed.startsWith('web_session_');
}

function isCredentialError(err: unknown): boolean {
  const msg = String((err as any)?.message || err || '');
  return /invalid credentials|wrong username|wrong_username_or_password|שם משתמש/i.test(msg);
}

// ── TAU SSO Login ──────────────────────────────────────────────────────────

async function loginViaSamlAndManageToken(
  username: string,
  idNumber: string,
  password: string
): Promise<string> {
  const jar = new CookieJar();

  // Step 1: Initial request to login/index.php to reach TAU SSO
  const { finalUrl: urlAfterLogin } = await mfetchFollow(
    jar,
    'https://moodle.tau.ac.il/login/index.php'
  );

  let baseUrl = 'https://moodle.tau.ac.il';
  let ssoUrl = urlAfterLogin;

  if (urlAfterLogin.includes('/auth/saml2/login.php')) {
    baseUrl = urlAfterLogin.split('/auth')[0];
    const samlRes = await mfetchFollow(jar, urlAfterLogin);
    ssoUrl = samlRes.finalUrl;
  }

  if (!ssoUrl.includes('nidp.tau.ac.il')) {
    throw new Error('SSO_TOKEN_EXTRACTION_FAILED');
  }

  // Step 2: Parse & submit the SAML session-init form
  const samlInitRes = await mfetchFollow(jar, ssoUrl);
  const html1 = await samlInitRes.response.text();
  const formMatch1 = html1.match(/<form[^>]+action=["']([^"']+)["']/i);
  if (formMatch1) {
    const action = formMatch1[1];
    ssoUrl = action.startsWith('http')
      ? action
      : new URL(action, 'https://nidp.tau.ac.il').href;

    const params = new URLSearchParams();
    const inputTags = [...html1.matchAll(/<input([^>]+)>/gi)];
    for (const tag of inputTags) {
      const nMatch = tag[1].match(/name=["']([^"']+)["']/i);
      const vMatch = tag[1].match(/value=["']([^"']+)["']/i);
      if (nMatch && vMatch) {
        params.append(decodeHTMLEntities(nMatch[1]), decodeHTMLEntities(vMatch[1]));
      }
    }

    await mfetch(jar, ssoUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
  }

  // Step 3: Initiate login sequence
  await mfetch(jar, ssoUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'option=credential&initiateLoginSequence=true&isAjax=true',
  });

  // Step 4: Submit credentials
  const credBody = [
    'option=credential',
    'isAjax=true',
    `Ecom_User_ID=${encodeURIComponent(username)}`,
    `Ecom_User_Pid=${encodeURIComponent(idNumber)}`,
    `Ecom_Password=${encodeURIComponent(password)}`,
  ].join('&');

  const credRes = await mfetch(jar, ssoUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: credBody,
  });
  const credText = await credRes.text();

  if (credText.replace(/\s/g, '').includes('"isError":true')) {
    let msg = 'Wrong username, ID number, or password';
    try {
      const parsed = JSON.parse(credText);
      if (parsed.errorCode === 'WRONG_USERNAME_OR_PASSWORD') {
        msg = 'Wrong username, ID number, or password';
      } else if (parsed.errorCode) {
        msg = parsed.errorCode;
      }
    } catch {
      // Keep default message
    }
    throw new Error(msg);
  }

  // Step 5: Fetch post-auth SAML assertion page
  const samlRes = await mfetch(jar, ssoUrl);
  const html2 = await samlRes.text();

  const actionMatch = html2.match(/<form[^>]+action=["']([^"']+)["']/i);
  let rawSamlResponse = '';
  let rawRelayState = '';
  const finalInputs = [...html2.matchAll(/<input([^>]+)>/gi)];
  for (const tag of finalInputs) {
    const nMatch = tag[1].match(/name=["']([^"']+)["']/i);
    const vMatch = tag[1].match(/value=["']([^"']+)["']/i);
    if (nMatch && vMatch) {
      if (nMatch[1] === 'SAMLResponse') rawSamlResponse = vMatch[1];
      if (nMatch[1] === 'RelayState') rawRelayState = vMatch[1];
    }
  }

  if (!actionMatch || !rawSamlResponse) {
    throw new Error('SSO_TOKEN_EXTRACTION_FAILED');
  }

  const actionUrl = decodeHTMLEntities(actionMatch[1]);
  const samlResponse = decodeHTMLEntities(rawSamlResponse);
  const relayState = rawRelayState ? decodeHTMLEntities(rawRelayState) : '';

  const bodyParams = new URLSearchParams();
  bodyParams.append('SAMLResponse', samlResponse);
  if (relayState) bodyParams.append('RelayState', relayState);

  // Step 6: POST SAML assertion to Moodle
  const { response: moodleRes, finalUrl: moodleFinalUrl } = await mfetchFollow(jar, actionUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: bodyParams.toString(),
  });

  const moodleHtml = await moodleRes.text();
  const sesskeyMatch = moodleHtml.match(/"sesskey":"([^"]+)"/);

  if (!sesskeyMatch) {
    throw new Error('SSO_TOKEN_EXTRACTION_FAILED');
  }

  const myUrlMatch = moodleFinalUrl.match(/^(https:\/\/[^/]+\/(?:[0-9]{4}\/)?)/);
  if (myUrlMatch) {
    baseUrl = myUrlMatch[1].replace(/\/$/, '');
  }

  const sesskey = sesskeyMatch[1];
  await saveSesskey(sesskey);

  // Step 7: Scrape managetoken.php and reset the token for Moodle Mobile App
  let scrapedToken: string | null = null;
  try {
    const manageUrl = `${baseUrl}/user/managetoken.php`;
    const manageRes = await mfetchFollow(jar, manageUrl);
    const manageHtml = await manageRes.response.text();

    const trs = manageHtml.split(/<tr/i);
    const targetTr =
      trs.find((row) => /moodle\s+mobile\s+web\s+service/i.test(row) || /moodle_mobile_app/i.test(row)) ||
      trs.find((row) => /mobile/i.test(row));
    const tokenMatch = targetTr
      ? targetTr.match(/action=resetwstoken(?:&amp;|&)tokenid=(\d+)/i)
      : null;

    if (tokenMatch) {
      const tokenId = tokenMatch[1];
      const resetParams = new URLSearchParams();
      resetParams.append('tokenid', tokenId);
      resetParams.append('action', 'resetwstoken');
      resetParams.append('confirm', '1');
      resetParams.append('sesskey', sesskey);

      const resetRes = await mfetchFollow(jar, manageUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: resetParams.toString(),
      });

      const resetHtml = await resetRes.response.text();
      const finalTokenMatch =
        resetHtml.match(/id=["']copytoclipboardtoken["'][^>]*>([^<]+)<\/div>/i) ||
        resetHtml.match(/([a-f0-9]{32,})/i);
      if (finalTokenMatch && finalTokenMatch[1]) {
        scrapedToken = finalTokenMatch[1].trim();
      }
    }
  } catch (e) {
    console.warn('[loginTauSso] managetoken.php extraction failed:', e);
  }

  if (!isValidRealToken(scrapedToken)) {
    throw new Error('SSO_TOKEN_EXTRACTION_FAILED');
  }

  return scrapedToken;
}

function extractNativeLaunchToken(
  res: { token?: string; redirectUrl?: string } | null | undefined
): string | null {
  const candidate =
    res?.token || (res?.redirectUrl ? tryExtractTokenFromUrl(res.redirectUrl) : null);
  return isValidRealToken(candidate) ? candidate.trim() : null;
}

async function loginTauSsoJsFallback(
  username: string,
  idNumber: string,
  password: string
): Promise<string> {
  // Primary JS path: Moodle Mobile launch.php flow via @tautracker/moodle-client
  try {
    const jar = new CookieJar();
    const token = await performLogin(jar, { username, idNumber, password });
    if (isValidRealToken(token)) {
      const cleanToken = token.trim();
      await saveToken(cleanToken);
      return cleanToken;
    }
  } catch (err) {
    if (isCredentialError(err)) {
      throw err;
    }
    console.warn('[loginTauSso] performLogin did not yield a valid token, trying SAML fallback:', err);
  }

  // Fallback path: SAML + managetoken.php reset (never returns fake web_session_*)
  try {
    const fallbackToken = await loginViaSamlAndManageToken(username, idNumber, password);
    await saveToken(fallbackToken);
    return fallbackToken;
  } catch (err) {
    if (isCredentialError(err)) {
      throw err;
    }
    throw new Error('SSO_TOKEN_EXTRACTION_FAILED');
  }
}

export async function loginTauSso(
  username: string,
  idNumber: string,
  password: string
): Promise<string> {
  try {
    const nativeRes = await fetchMoodleMobileTokenViaLaunchNative({
      username,
      idNumber,
      password,
    });
    const nativeToken = extractNativeLaunchToken(nativeRes);
    if (nativeToken) {
      await saveToken(nativeToken);
      return nativeToken;
    }
    if (nativeRes?.errorCode === 'INVALID_CREDENTIALS') {
      throw new Error('Wrong username, ID number, or password');
    }
  } catch (err) {
    if (isCredentialError(err)) {
      throw err;
    }
    console.warn('[loginTauSso] Native launch flow failed, falling back to JS SSO:', err);
  }

  return await loginTauSsoJsFallback(username, idNumber, password);
}

export async function renewTokenSilently(): Promise<string | null> {
  try {
    const creds = await getStoredCredentials();
    const hasCreds = Boolean(creds && creds.username && creds.idNumber && creds.password);

    // Attempt native OkHttp + WebView CookieManager launch first (works with or without saved creds)
    const nativeRes = await fetchMoodleMobileTokenViaLaunchNative(
      hasCreds ? creds! : undefined
    );
    const nativeToken = extractNativeLaunchToken(nativeRes);
    if (nativeToken) {
      await saveToken(nativeToken);
      return nativeToken;
    }

    if (nativeRes?.errorCode === 'INVALID_CREDENTIALS' || !hasCreds) {
      return null;
    }

    // Native launch unavailable or non-credential failure with saved credentials: JS SSO fallback
    const fallbackToken = await loginTauSsoJsFallback(
      creds!.username,
      creds!.idNumber,
      creds!.password
    );
    return isValidRealToken(fallbackToken) ? fallbackToken : null;
  } catch (e) {
    console.warn('[auth] Silent token renewal failed:', e);
    return null;
  }
}

export async function logoutAndTeardownSession(): Promise<void> {
  const sesskey = await getStoredSesskey();
  const ts = Date.now();
  const moodleLogoutUrl = sesskey
    ? `https://moodle.tau.ac.il/login/logout.php?sesskey=${encodeURIComponent(sesskey)}&_t=${ts}`
    : `https://moodle.tau.ac.il/login/logout.php?_t=${ts}`;

  const logoutUrls = [
    moodleLogoutUrl,
    `https://nidp.tau.ac.il/nidp/app/logout?_t=${ts}`,
    `https://tau.cloud.panopto.eu/Panopto/Pages/Auth/Logout.aspx?_t=${ts}`,
  ];

  if (typeof fetch === 'function') {
    await Promise.allSettled(
      logoutUrls.map((url) =>
        fetch(url, {
          method: 'GET',
          credentials: 'include',
          redirect: 'follow',
          cache: 'no-store',
        })
      )
    );
  }

  await clearAllCookiesNative().catch(() => false);
  await saveToken(null);
  await clearCredentials();
  await saveSesskey(null);
  clearUserTablesOnLogout();
}
