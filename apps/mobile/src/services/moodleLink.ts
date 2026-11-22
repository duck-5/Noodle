import { Linking } from 'react-native';
import { MoodleClient } from '@tautracker/moodle-client';
import { getStoredSesskey, getStoredToken } from './auth';

const DEFAULT_MOODLE_BASE_URL = 'https://moodle.tau.ac.il';
const ALLOWED_SCHEMES = new Set(['https:', 'http:', 'zoomus:', 'mailto:']);
const AUTOLOGIN_CACHE_TTL_MS = 5 * 60 * 1000;
const AUTOLOGIN_TIMEOUT_MS = 2500;

interface CachedAutoLogin {
  token: string;
  userid: number;
  key: string;
  autologinurl: string;
  expiresAt: number;
}

let cachedAutoLogin: CachedAutoLogin | null = null;

export function normalizeMoodleUrl(url: string, baseUrl: string = DEFAULT_MOODLE_BASE_URL): string {
  const trimmed = (url || '').trim();
  if (!trimmed) return '';

  if (/^https?:\/\//i.test(trimmed) || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return trimmed;
  }

  if (trimmed.startsWith('//')) {
    return `https:${trimmed}`;
  }

  const cleanBase = (baseUrl || DEFAULT_MOODLE_BASE_URL).trim().replace(/\/+$/, '');
  if (trimmed.startsWith('/')) {
    return `${cleanBase}${trimmed}`;
  }

  return `${cleanBase}/${trimmed}`;
}

function parseAllowedScheme(url: string): URL | null {
  try {
    const parsed = new URL(url);
    if (!ALLOWED_SCHEMES.has(parsed.protocol.toLowerCase())) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function isMoodleHostUrl(parsed: URL): boolean {
  const host = parsed.hostname.toLowerCase();
  return host === 'moodle.tau.ac.il' || host.endsWith('.moodle.tau.ac.il');
}

function isDirectZoomUrl(parsed: URL): boolean {
  const host = parsed.hostname.toLowerCase();
  return parsed.protocol.toLowerCase() === 'zoomus:' || host === 'zoom.us' || host.endsWith('.zoom.us');
}

async function resolveAutoLoginUrl(targetUrl: string): Promise<string> {
  const token = await getStoredToken();
  if (!token) return targetUrl;

  const now = Date.now();
  if (
    cachedAutoLogin &&
    cachedAutoLogin.token === token &&
    cachedAutoLogin.expiresAt > now
  ) {
    return `${cachedAutoLogin.autologinurl}?userid=${cachedAutoLogin.userid}&key=${encodeURIComponent(
      cachedAutoLogin.key
    )}&urltogo=${encodeURIComponent(targetUrl)}`;
  }

  const fetchAutoLogin = async (): Promise<string> => {
    const sesskey = await getStoredSesskey();
    const client = new MoodleClient(token, undefined, {
      sesskey: sesskey || undefined,
      devMode: false,
      enableScraping: false,
    });
    const [siteInfo, autoLogin] = await Promise.all([
      client.getSiteInfo(),
      client.getAutoLoginKey(),
    ]);
    if (siteInfo?.userid && autoLogin?.key && autoLogin?.autologinurl) {
      cachedAutoLogin = {
        token,
        userid: siteInfo.userid,
        key: autoLogin.key,
        autologinurl: autoLogin.autologinurl,
        expiresAt: Date.now() + AUTOLOGIN_CACHE_TTL_MS,
      };
      return `${autoLogin.autologinurl}?userid=${siteInfo.userid}&key=${encodeURIComponent(
        autoLogin.key
      )}&urltogo=${encodeURIComponent(targetUrl)}`;
    }
    return targetUrl;
  };

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeoutPromise = new Promise<string>((resolve) => {
      timeoutHandle = setTimeout(() => resolve(targetUrl), AUTOLOGIN_TIMEOUT_MS);
    });
    return await Promise.race([fetchAutoLogin(), timeoutPromise]);
  } catch {
    return targetUrl;
  } finally {
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
    }
  }
}

export async function openMoodleUrl(url: string, baseUrl?: string): Promise<boolean> {
  const targetUrl = normalizeMoodleUrl(url, baseUrl);
  if (!targetUrl) return false;

  const parsed = parseAllowedScheme(targetUrl);
  if (!parsed) {
    console.warn('[moodleLink] Blocked URL with disallowed scheme:', targetUrl);
    return false;
  }

  let urlToOpen = targetUrl;
  if (isMoodleHostUrl(parsed) && !isDirectZoomUrl(parsed)) {
    try {
      urlToOpen = await resolveAutoLoginUrl(targetUrl);
    } catch {
      urlToOpen = targetUrl;
    }
  }

  try {
    await Linking.openURL(urlToOpen);
    return true;
  } catch (err) {
    if (urlToOpen !== targetUrl) {
      try {
        await Linking.openURL(targetUrl);
        return true;
      } catch (fallbackErr) {
        console.error('Failed to open URL', fallbackErr);
        return false;
      }
    }
    console.error('Failed to open URL', err);
    return false;
  }
}

export const openMoodleLink = openMoodleUrl;
