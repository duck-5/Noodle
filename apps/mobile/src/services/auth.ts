import * as SecureStore from 'expo-secure-store';

const CREDENTIALS_KEY = 'moodle_credentials';

// ── Credential types & storage ─────────────────────────────────────────────

export interface MoodleCredentials {
  username: string;
  idNumber: string;
  password: string;
}

export async function getStoredCredentials(): Promise<MoodleCredentials | null> {
  try {
    const raw = await SecureStore.getItemAsync(CREDENTIALS_KEY);
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
    await SecureStore.setItemAsync(CREDENTIALS_KEY, JSON.stringify(payload));
  } catch (e) {
    console.error('saveCredentials error:', e);
  }
}

export async function clearCredentials(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(CREDENTIALS_KEY);
  } catch (e) {
    console.error('clearCredentials error:', e);
  }
}

// ── HTML entity helper (same as extension's serviceWorker.ts) ─────────────

function decodeHTMLEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#x3d;/g, '=')
    .replace(/&#x3D;/g, '=')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

// ── Cookie jar ─────────────────────────────────────────────────────────────
//
// React Native (OkHttp on Android) does NOT automatically share cookies
// across JS fetch() calls the way a browser does — especially for cookies
// set on intermediate 302 redirect responses.
//
// We manage cookies ourselves so the Moodle session cookie from Step 1's
// redirect response is still present when we POST the SAML assertion in Step 6.

class CookieJar {
  private store: Record<string, string> = {};

  /**
   * Parse the raw Set-Cookie header value and store cookies.
   *
   * On Android, React Native's networking layer concatenates multiple
   * Set-Cookie headers with ", " (comma-space). We split on ", " followed
   * by a token= pattern (start of a new cookie name) to avoid splitting
   * on dates like "Expires=Wed, 09 Jun 2021 ...".
   */
  ingest(raw: string | null): void {
    if (!raw) return;

    // Also handle newline-separated (some environments use \n instead of , )
    const normalized = raw.replace(/\r?\n/g, ', ');

    // Split on ", " that precedes a new "name=" token
    const parts = normalized.split(/,\s*(?=[a-zA-Z0-9_\-!#$%&'*+.^`|~]+=)/);

    for (const part of parts) {
      // Only take the name=value portion before any attribute (";")
      const nameVal = part.split(';')[0].trim();
      const eq = nameVal.indexOf('=');
      if (eq > 0) {
        const name = nameVal.slice(0, eq).trim();
        const value = nameVal.slice(eq + 1).trim();
        if (name) this.store[name] = value;
      }
    }
  }

  header(): string {
    return Object.entries(this.store)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }
}

// ── Managed fetch helpers ──────────────────────────────────────────────────

type ManagedInit = Omit<RequestInit, 'redirect'>;

/**
 * A single fetch that:
 * - Injects the current cookie jar into the Cookie header
 * - Reads Set-Cookie from the response back into the jar
 * - Always uses redirect:'manual' so we can intercept intermediate cookies
 */
async function mfetch(
  jar: CookieJar,
  url: string,
  init: ManagedInit = {}
): Promise<Response> {
  const cookieStr = jar.header();
  const headers: Record<string, string> = {};

  // Copy caller headers
  if (init.headers) {
    if (init.headers instanceof Headers) {
      init.headers.forEach((v, k) => { headers[k] = v; });
    } else {
      Object.assign(headers, init.headers as Record<string, string>);
    }
  }
  if (cookieStr) headers['Cookie'] = cookieStr;

  const res = await fetch(url, { ...init, headers, redirect: 'manual' });
  jar.ingest(res.headers.get('set-cookie'));
  return res;
}

/**
 * Follows redirects manually through the cookie jar, so every hop's
 * Set-Cookie is captured. Stops and returns when:
 *   - A non-redirect status is received, OR
 *   - The Location is a custom-scheme URL (moodlemobile:// / moodleapp://)
 *
 * Returns { response, finalUrl } where finalUrl is the last URL visited
 * (or the custom-scheme URL on a redirect to moodlemobile://).
 */
async function mfetchFollow(
  jar: CookieJar,
  url: string,
  init: ManagedInit = {},
  maxRedirects = 15
): Promise<{ response: Response; finalUrl: string }> {
  let currentUrl = url;
  let currentInit: ManagedInit = { ...init };

  for (let i = 0; i <= maxRedirects; i++) {
    const res = await mfetch(jar, currentUrl, currentInit);
    const status = res.status;

    if (status >= 300 && status < 400) {
      const loc = res.headers.get('location') ?? res.headers.get('Location') ?? '';
      if (!loc) return { response: res, finalUrl: currentUrl };

      // Resolve relative URLs
      let nextUrl: string;
      try {
        nextUrl = loc.startsWith('http') ? loc : new URL(loc, currentUrl).href;
      } catch {
        nextUrl = loc;
      }

      // Custom protocol → stop; caller will extract token from nextUrl
      if (nextUrl.startsWith('moodlemobile://') || nextUrl.startsWith('moodleapp://')) {
        return { response: res, finalUrl: nextUrl };
      }

      // 301 / 302 / 303 → follow as GET (browser behaviour)
      if (status === 301 || status === 302 || status === 303) {
        currentInit = {};
      }

      currentUrl = nextUrl;
      continue;
    }

    return { response: res, finalUrl: currentUrl };
  }

  throw new Error('Too many redirects during SSO login');
}

// ── Token extraction ───────────────────────────────────────────────────────

function tryExtractTokenFromUrl(url: string): string | null {
  if (!url) return null;
  const match = url.match(/(?:moodlemobile|moodleapp):\/\/token=([a-zA-Z0-9+/=]+)/);
  if (!match) return null;
  try {
    const parts = atob(match[1]).split(':::');
    return parts.length > 1 ? parts[1] : parts[0];
  } catch {
    return null;
  }
}

// ── TAU SSO Login ──────────────────────────────────────────────────────────
//
// Mirrors the 6-step SAML flow in the Chrome extension's
//   apps/extension/src/background/serviceWorker.ts → loginTauSso()
//
// Key difference: instead of Chrome's webRequest.onBeforeRedirect to capture
// the moodlemobile:// token, we use our managed fetch helpers to follow
// redirects manually (preserving cookies at every hop).

export async function loginTauSso(
  username: string,
  idNumber: string,
  password: string
): Promise<string> {
  const jar = new CookieJar();

  // 1. Initial request to login/index.php to get baseUrl
  let ssoUrl = '';
  let baseUrl = '';

  const { response: initialRes, finalUrl: urlAfterLogin } = await mfetchFollow(jar, 'https://moodle.tau.ac.il/login/index.php');
  
  if (urlAfterLogin.includes('/auth/saml2/login.php')) {
    baseUrl = urlAfterLogin.split('/auth')[0];
    const { response: samlRes, finalUrl: finalSsoUrl } = await mfetchFollow(jar, urlAfterLogin);
    ssoUrl = finalSsoUrl;
  } else {
    baseUrl = 'https://moodle.tau.ac.il';
    ssoUrl = urlAfterLogin;
  }

  // If already authenticated
  if (ssoUrl.includes('/my/') || ssoUrl.includes('moodle.tau.ac.il')) {
     const text = await initialRes.text();
     const sesskeyMatch = text.match(/"sesskey":"([^"]+)"/);
     if (sesskeyMatch) {
       return JSON.stringify({ type: 'web', sesskey: sesskeyMatch[1], cookie: jar.header(), baseUrl });
     }
  }

  if (!ssoUrl.includes('nidp.tau.ac.il')) {
    throw new Error(`Unexpected SSO redirect — expected TAU SSO (nidp.tau.ac.il), got: ${ssoUrl}`);
  }

  // ── Step 2: Parse & submit the SAML session-init form ───────────────────
  // We need to fetch ssoUrl again because mfetchFollow might have lost the html body 
  // if we used the stream? No, we didn't read it. Let's just fetch it again to be safe.
  const res1 = await mfetch(jar, ssoUrl);
  const html1 = await res1.text();
  const formMatch1 = html1.match(/<form[^>]+action=["']([^"']+)["']/i);
  if (formMatch1) {
    const action = formMatch1[1];
    ssoUrl = action.startsWith('http')
      ? action
      : new URL(action, 'https://nidp.tau.ac.il').href;
    await mfetch(jar, ssoUrl, { method: 'POST' });
  }

  // ── Step 3: Initiate login sequence ─────────────────────────────────────
  await mfetch(jar, ssoUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'option=credential&initiateLoginSequence=true&isAjax=true',
  });

  // ── Step 4: Submit credentials ───────────────────────────────────────────
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
    } catch (_) {}
    throw new Error(msg);
  }

  // ── Step 5: Fetch post-auth SAML assertion page ──────────────────────────
  const samlRes = await mfetch(jar, ssoUrl);
  const html2 = await samlRes.text();

  const actionMatch = html2.match(/<form[^>]+action=["']([^"']+)["']/i);
  const samlValMatch = html2.match(/<input[^>]+name=["']SAMLResponse["'][^>]+value=["']([^"']+)["']/i);
  const relayMatch = html2.match(/<input[^>]+name=["']RelayState["'][^>]+value=["']([^"']+)["']/i);

  if (!actionMatch || !samlValMatch) {
    throw new Error('Failed to parse SAML assertion from TAU SSO page');
  }

  const actionUrl = decodeHTMLEntities(actionMatch[1]);
  const samlResponse = decodeHTMLEntities(samlValMatch[1]);
  const relayState = relayMatch ? decodeHTMLEntities(relayMatch[1]) : '';

  const bodyParams = new URLSearchParams();
  bodyParams.append('SAMLResponse', samlResponse);
  if (relayState) bodyParams.append('RelayState', relayState);

  // ── Step 6: POST SAML assertion to Moodle ───────────────────────────────
  // We manually follow redirects so we capture the Moodle session cookie
  const { response: finalRes, finalUrl } = await mfetchFollow(jar, actionUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: bodyParams.toString(),
  });

  const finalHtml = await finalRes.text();
  const sesskeyMatch = finalHtml.match(/"sesskey":"([^"]+)"/);

  if (!sesskeyMatch) {
    throw new Error('Failed to extract sesskey from Moodle dashboard. Final URL: ' + finalUrl);
  }
  
  if (!baseUrl) {
     const myUrlMatch = finalUrl.match(/^(https:\/\/[^/]+\/(?:[0-9]{4}\/)?)/);
     baseUrl = myUrlMatch ? myUrlMatch[1].replace(/\/$/, '') : 'https://moodle.tau.ac.il';
  }

  return JSON.stringify({
    type: 'web',
    sesskey: sesskeyMatch[1],
    cookie: jar.header(),
    baseUrl: baseUrl
  });
}
