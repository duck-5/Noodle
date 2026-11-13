import { MoodleCredentials, ZoomMeeting } from './types.js';

export interface LtiZoomMeeting {
  topic: string;
  meetingId: string;
  meetingNumber: string;
  startTime?: string;
  joinUrl: string;
  password?: string;
  isUpcoming: boolean;
}

export function decodeHTMLEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#x3d;/g, '=')
    .replace(/&#x3D;/g, '=')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export function isZoomJoinUrl(url: string, meetingNumber?: string): boolean {
  if (!url) return false;
  if (!isZoomUrl(url)) return false;

  const rawClean = decodeHTMLEntities(url).trim();

  const cleanNum = meetingNumber ? String(meetingNumber).replace(/[\s-]/g, '') : '';
  if (cleanNum && (/^\d{5,16}$/.test(cleanNum) || /^[a-zA-Z0-9._-]{3,64}$/.test(cleanNum))) {
    try {
      const parsed = new URL(rawClean);
      const path = parsed.pathname.toLowerCase();
      if (/^\/(?:signin|signup|download|test|support|privacy|terms|resources|docs|api|lti)\b/i.test(path)) {
        return false;
      }
      return true;
    } catch {
      return true;
    }
  }

  try {
    const parsed = new URL(rawClean);
    const path = parsed.pathname.toLowerCase();

    if (/^\/(?:signin|signup|download|test|support|privacy|terms|resources|docs|api|lti)\b/i.test(path)) {
      return false;
    }

    if (/\/(?:j|w|s)\/\d+/i.test(path)) return true;
    if (/\/my\/[a-zA-Z0-9._-]+/i.test(path)) return true;

    const confno = parsed.searchParams.get('confno');
    if (confno && /^\d+$/.test(confno.replace(/[\s-]/g, ''))) return true;

    return false;
  } catch {
    return /https?:\/\/[a-zA-Z0-9.\-]*zoom\.(?:us|com|gov)\/(?:(?:j|w|s)\/\d+|my\/[a-zA-Z0-9._-]+)/i.test(rawClean);
  }
}

export function isZoomUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return (
      host.endsWith('zoom.us') ||
      host.endsWith('zoom.com') ||
      host.endsWith('zoomgov.com') ||
      host.includes('.zoom.')
    );
  } catch {
    return /https?:\/\/[a-zA-Z0-9.\-]*zoom\.(?:us|com|gov)/i.test(url);
  }
}

export function isZoomOrMeetingName(name: string): boolean {
  if (!name) return false;
  const lower = name.toLowerCase();
  if (lower.includes('zoom')) return true;
  // English meeting keywords
  if (/\b(?:meeting|meetings|online\s+lecture|online\s+class|online\s+session|virtual\s+classroom|live\s+lecture|live\s+class|live\s+session)\b/i.test(name)) {
    return true;
  }
  // Hebrew keywords commonly used in Israeli Moodle courses
  if (/זום|מפגש מקוון|מפגשים מקוונים|מפגשי זום|מפגש זום|שיעור זום|שיעורי זום|חדר זום|חדרי זום|הרצאה מקוונת|הרצאות מקוונות|תרגול מקוון|תרגולים מקוונים|שיעור מקוון|שיעורים מקוונים|קישור לשיעור|קישור לשיעורים|קישורים לשיעורים|קישור להרצאה|קישור להרצאות|קישורים להרצאות|קישור לתרגול|קישור לתרגולים|קישורים לתרגולים|קישור למפגש|קישור למפגשים|קישורים למפגשים|קישור לזום|קישורי זום|קישורי מפגש|קישורי מפגשים|קישור לקורס|קישורים לקורס|קישור לכיתה|קישורים לכיתה|לינק לזום|לינק לשיעור|לינק להרצאה|לינק לתרגול|לינק למפגש|חדר הרצאות|חדר תרגולים|חדר שיעור|חדר השיעור|חדר הרצאה|חדר פגישות|חדר מפגש|היוועדות חזותית|כיתה וירטואלית|כיתה מקוונת|סינכרונ|הוראה מרחוק|למידה מרחוק|שיעור אונליין|שיעורים אונליין|הרצאה אונליין|הרצאות אונליין|תרגול אונליין|תרגולים אונליין/i.test(name)) {
    return true;
  }
  return false;
}

export function parseZoomUrl(rawUrl: string): { meetingUrl: string; meetingNumber?: string; password?: string } {
  let cleanUrl = decodeHTMLEntities(rawUrl).trim();
  let meetingNumber: string | undefined;
  let password: string | undefined;

  // Handle URL-encoded spaces (%20) or literal spaces in meeting ID
  const decodedForRegex = cleanUrl.replace(/%20/g, ' ');
  const matchNum =
    decodedForRegex.match(/\/(?:j|w|s)\/([0-9\s-]+)/i) ||
    decodedForRegex.match(/\/my\/([a-zA-Z0-9._-]+)/i) ||
    decodedForRegex.match(/[?&]confno=([0-9\s-]+)/i);
  if (matchNum) {
    meetingNumber = matchNum[1].replace(/[\s-]/g, '');
  }

  try {
    const urlObj = new URL(cleanUrl);
    const pwdParam = urlObj.searchParams.get('pwd');
    if (pwdParam) {
      password = pwdParam;
    }

    const host = urlObj.hostname.toLowerCase();
    if (
      meetingNumber &&
      /^\d+$/.test(meetingNumber) &&
      (host === 'zoom.us' || host === 'www.zoom.us' || host === 'tau.zoom.us' || host === 'tau-ac-il.zoom.us' || host.endsWith('.zoom.us'))
    ) {
      cleanUrl = `https://tau-ac-il.zoom.us/j/${meetingNumber}${password ? `?pwd=${password}` : ''}`;
    }
  } catch {}

  return {
    meetingUrl: cleanUrl,
    meetingNumber,
    password,
  };
}

export function extractZoomLinksFromHtml(html: string): { url: string; title?: string }[] {
  if (!html) return [];
  const results: { url: string; title?: string }[] = [];
  const seen = new Set<string>();

  // 1. Match <a> tags with href containing zoom
  const anchorRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = anchorRegex.exec(html)) !== null) {
    const rawHref = decodeHTMLEntities(match[1]).trim();
    if (isZoomUrl(rawHref)) {
      const parsed = parseZoomUrl(rawHref);
      if (!isZoomJoinUrl(parsed.meetingUrl, parsed.meetingNumber)) continue;
      const key = parsed.meetingNumber || parsed.meetingUrl;
      if (!seen.has(key)) {
        seen.add(key);
        const innerText = match[2].replace(/<[^>]+>/g, '').trim();
        const title = innerText && !innerText.startsWith('http') ? decodeHTMLEntities(innerText) : undefined;
        results.push({ url: parsed.meetingUrl, title });
      }
    }
  }

  // 2. Match raw text URLs (e.g. plain text Zoom links not in <a> tags)
  const rawUrlRegex = /https?:\/\/[a-zA-Z0-9.\-]*zoom\.(?:us|com|gov)\/[^\s"'<>\\]+/gi;
  while ((match = rawUrlRegex.exec(html)) !== null) {
    const rawMatch = decodeHTMLEntities(match[0]).trim();
    const parsed = parseZoomUrl(rawMatch);
    if (!isZoomJoinUrl(parsed.meetingUrl, parsed.meetingNumber)) continue;
    const key = parsed.meetingNumber || parsed.meetingUrl;
    if (!seen.has(key)) {
      seen.add(key);
      results.push({ url: parsed.meetingUrl });
    }
  }

  return results;
}

export class CookieJar {
  private store: Record<string, string> = {};

  ingest(raw: string | null): void {
    if (!raw) return;
    const normalized = raw.replace(/\r?\n/g, ', ');
    const parts = normalized.split(/,\s*(?=[a-zA-Z0-9_\-!#$%&'*+.^`|~]+=)/);
    for (const part of parts) {
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

type ManagedInit = Omit<RequestInit, 'redirect'>;

export async function mfetch(jar: CookieJar, url: string, init: ManagedInit = {}): Promise<Response> {
  const isBrowser = typeof window !== 'undefined' || (typeof (globalThis as any).browser !== 'undefined' && (globalThis as any).browser.runtime) || (typeof (globalThis as any).chrome !== 'undefined' && (globalThis as any).chrome.runtime);

  const headers: Record<string, string> = {};
  if (init.headers) {
    if (init.headers instanceof Headers) {
      init.headers.forEach((v, k) => { headers[k] = v; });
    } else {
      Object.assign(headers, init.headers as Record<string, string>);
    }
  }

  const fetchInit: RequestInit = {
    ...init,
    headers,
    redirect: isBrowser ? 'follow' : 'manual'
  };

  if (isBrowser) {
    (fetchInit as any).credentials = 'include';
    // Browsers forbid setting User-Agent, Cookie, Host, etc. via fetch()
    delete headers['User-Agent'];
    delete headers['user-agent'];
  } else {
    const cookieStr = jar.header();
    if (cookieStr) headers['Cookie'] = cookieStr;
  }

  const res = await fetch(url, fetchInit);

  if (!isBrowser) {
    jar.ingest(res.headers.get('set-cookie'));
  }

  return res;
}

export async function mfetchFollow(
  jar: CookieJar,
  url: string,
  init: ManagedInit = {},
  maxRedirects = 15
): Promise<{ response: Response; finalUrl: string }> {
  let currentUrl = url;
  let currentInit = { ...init };

  for (let i = 0; i <= maxRedirects; i++) {
    const res = await mfetch(jar, currentUrl, currentInit);
    const status = res.status;

    if (status >= 300 && status < 400) {
      const loc = res.headers.get('location') ?? res.headers.get('Location') ?? '';
      if (!loc) return { response: res, finalUrl: currentUrl };

      let nextUrl: string;
      try {
        nextUrl = loc.startsWith('http') ? loc : new URL(loc, currentUrl).href;
      } catch {
        nextUrl = loc;
      }

      if (nextUrl.startsWith('moodlemobile://') || nextUrl.startsWith('moodleapp://')) {
        return { response: res, finalUrl: nextUrl };
      }

      if (status === 301 || status === 302 || status === 303) {
        currentInit = {};
      }
      currentUrl = nextUrl;
      continue;
    }
    return { response: res, finalUrl: currentUrl };
  }
  throw new Error('Too many redirects');
}

function tryExtractTokenFromUrl(url: string): string | null {
  if (!url) return null;
  const match = url.match(/(?:moodlemobile|moodleapp):\/\/token=([a-zA-Z0-9+/=]+)/);
  if (!match) return null;
  try {
    const decoded = atob(match[1]);
    const parts = decoded.split(':::');
    return parts.length > 1 ? parts[1] : parts[0];
  } catch {
    return null;
  }
}

export async function performLogin(jar: CookieJar, creds: MoodleCredentials): Promise<string> {
  const passport = Math.random().toString(36).substring(2, 15);
  const launchUrl = `https://moodle.tau.ac.il/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=${passport}`;

  const { response: res1, finalUrl: afterLaunch } = await mfetchFollow(jar, launchUrl);
  const earlyToken = tryExtractTokenFromUrl(afterLaunch);
  if (earlyToken) return earlyToken;

  let ssoUrl = afterLaunch;

  const html1 = await res1.text();
  const formMatch1 = html1.match(/<form[^>]+action=["']([^"']+)["']/i);
  if (formMatch1) {
    const action = formMatch1[1];
    ssoUrl = action.startsWith('http') ? action : new URL(action, 'https://nidp.tau.ac.il').href;
    await mfetch(jar, ssoUrl, { method: 'POST' });
  }

  await mfetch(jar, ssoUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'option=credential&initiateLoginSequence=true&isAjax=true',
  });

  const credBody = [
    'option=credential',
    'isAjax=true',
    `Ecom_User_ID=${encodeURIComponent(creds.username)}`,
    `Ecom_User_Pid=${encodeURIComponent(creds.idNumber)}`,
    `Ecom_Password=${encodeURIComponent(creds.password)}`,
  ].join('&');

  const credRes = await mfetch(jar, ssoUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: credBody,
  });
  const credText = await credRes.text();
  if (credText.replace(/\s/g, '').includes('"isError":true')) {
    throw new Error('SSO Authentication failed: invalid credentials');
  }

  const samlRes = await mfetch(jar, ssoUrl);
  const html2 = await samlRes.text();

  const actionMatch = html2.match(/<form[^>]+action=["']([^"']+)["']/i);
  const samlValMatch = html2.match(/<input[^>]+name=["']SAMLResponse["'][^>]+value=["']([^"']+)["']/i);
  const relayMatch = html2.match(/<input[^>]+name=["']RelayState["'][^>]+value=["']([^"']+)["']/i);

  if (!actionMatch || !samlValMatch) {
    throw new Error('Failed to parse SAML assertion from SSO page');
  }

  const actionUrl = decodeHTMLEntities(actionMatch[1]);
  const samlResponse = decodeHTMLEntities(samlValMatch[1]);
  const relayState = relayMatch ? decodeHTMLEntities(relayMatch[1]) : '';

  const bodyParams = new URLSearchParams();
  bodyParams.append('SAMLResponse', samlResponse);
  if (relayState) bodyParams.append('RelayState', relayState);

  const { finalUrl } = await mfetchFollow(jar, actionUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: bodyParams.toString(),
  });

  const token = tryExtractTokenFromUrl(finalUrl);
  if (!token) {
    throw new Error('Failed to extract Moodle mobile token from final redirect');
  }
  return token;
}

function parseLtiForm(html: string): { actionUrl: string; params: URLSearchParams } {
  const forms = html.match(/<form[\s\S]*?<\/form>/gi);
  if (!forms) throw new Error('No LTI launch form found in page');
  
  const ltiForm = forms.find(f => f.includes('id="tool_launch_form"') || f.includes('name="ltiLaunchForm"'));
  if (!ltiForm) throw new Error('LTI launch form (id=tool_launch_form) not found');
  
  const actionMatch = ltiForm.match(/action=["']([^"']+)["']/i);
  if (!actionMatch) throw new Error('LTI launch form action attribute not found');
  
  const actionUrl = decodeHTMLEntities(actionMatch[1]);
  
  const inputMatches = ltiForm.match(/<input[^>]+>/g) || [];
  const params = new URLSearchParams();
  for (const input of inputMatches) {
    const nameMatch = input.match(/name=["']([^"']+)["']/i);
    const valueMatch = input.match(/value=["']([^"']+)["']/i);
    if (nameMatch && valueMatch) {
      params.append(nameMatch[1], decodeHTMLEntities(valueMatch[1]));
    }
  }
  
  return { actionUrl, params };
}

export function parseAppConf(html: string): any {
  if (!html) return { ajaxHeaders: [] };
  // 1. Try matching JSON block for window.__appConf__
  const confMatch = html.match(/window\.__appConf__\s*=\s*(\{[\s\S]*?\});/);
  if (confMatch) {
    try {
      const parsed = JSON.parse(confMatch[1]);
      if (Array.isArray(parsed.ajaxHeaders)) {
        return { ajaxHeaders: parsed.ajaxHeaders };
      }
    } catch (_) {}
  }

  // 2. Extract ajaxHeaders block
  const headersBlockMatch = html.match(/ajaxHeaders\s*:\s*\[([\s\S]*?)\]/);
  if (headersBlockMatch) {
    const blockContent = headersBlockMatch[1];
    const ajaxHeaders: { key: string; value: string }[] = [];
    const objRegex = /\{([^{}]+)\}/g;
    let objMatch;
    while ((objMatch = objRegex.exec(blockContent)) !== null) {
      const item = objMatch[1];
      const keyMatch = item.match(/["']?key["']?\s*:\s*["']([^"']+)["']/);
      const valMatch = item.match(/["']?value["']?\s*:\s*["']([^"']+)["']/);
      if (keyMatch && valMatch) {
        ajaxHeaders.push({
          key: keyMatch[1],
          value: valMatch[1]
        });
      }
    }
    return { ajaxHeaders };
  }

  return { ajaxHeaders: [] };
}

export async function scrapeZoomMeetings(
  creds: MoodleCredentials,
  courseNumber: string
): Promise<LtiZoomMeeting[]> {
  const jar = new CookieJar();
  const token = await performLogin(jar, creds);

  // 1. Query the enrolled courses using WS API to find the target course ID
  const wsBaseUrl = 'https://moodle.tau.ac.il/webservice/rest/server.php';
  
  const apiCall = async (wsfunction: string, params: Record<string, any>) => {
    const allParams = {
      wstoken: token,
      wsfunction,
      moodlewsrestformat: 'json',
      ...params,
    };
    const urlParams = new URLSearchParams();
    for (const [k, v] of Object.entries(allParams)) {
      urlParams.append(k, String(v));
    }
    const res = await fetch(`${wsBaseUrl}?${urlParams.toString()}`);
    if (!res.ok) throw new Error(`Moodle WS API failed: ${res.statusText}`);
    return res.json();
  };

  const siteInfo = await apiCall('core_webservice_get_site_info', {});
  const coursesResponse = await apiCall('core_enrol_get_users_courses', { userid: siteInfo.userid });
  
  if (!Array.isArray(coursesResponse)) {
    throw new Error('Unexpected response format from enrolled courses API');
  }

  // Find course matching number
  const normalizedCourseNum = courseNumber.replace(/\D/g, ''); // strip dashes/dots
  const targetCourse = coursesResponse.find(c => {
    const idNum = String(c.idnumber || '').replace(/\D/g, '');
    const fullname = String(c.fullname || '');
    return idNum.includes(normalizedCourseNum) || fullname.includes(courseNumber);
  });

  if (!targetCourse) {
    throw new Error(`Course matching number "${courseNumber}" was not found among enrolled courses.`);
  }

  // 2. Fetch course contents to locate ZOOM LTI module
  const contents = await apiCall('core_course_get_contents', { courseid: targetCourse.id });
  let zoomModule: any = null;
  
  if (Array.isArray(contents)) {
    for (const section of contents) {
      if (!section.modules) continue;
      for (const m of section.modules) {
        if (m.modname === 'lti' && isZoomOrMeetingName(m.name || '')) {
          zoomModule = m;
          break;
        }
      }
      if (zoomModule) break;
    }
  }

  if (!zoomModule) {
    throw new Error(`Zoom LTI activity was not found in the course "${targetCourse.fullname}"`);
  }

  return scrapeZoomMeetingsWithToken(token, zoomModule.instance);
}

/**
 * Parses a Zoom meeting date-time string into a UTC Date.
 *
 * Crucial Zoom LTI API Detail:
 * Zoom's LTI API (`applications.zoom.us/api/v1/lti/rich/meeting/...`) ALWAYS returns
 * `startTime` in UTC as a SQL-formatted string (e.g. "2026-11-17 10:00:00").
 * Even when the JSON payload includes `"timezone": "Asia/Jerusalem"` or another zone,
 * that field only reflects the host's display preference. The actual timestamp in
 * `startTime` is already UTC.
 *
 * In standard JavaScript, passing "YYYY-MM-DD HH:mm:ss" without 'Z' to `new Date()`
 * parses the string in the client's local timezone (e.g. UTC+2 in Israel), which shifts
 * the time by the local offset.
 *
 * By ensuring the datetime string ends with 'Z' (or handling explicit offsets),
 * the timestamp is accurately treated as UTC, allowing the browser's standard
 * `.toLocaleString()` / `.toLocaleTimeString()` to format it correctly in the
 * user's local timezone.
 */
export function parseDateTimeInZone(dateStr: string): Date {
  const cleanStr = dateStr.trim().replace(' ', 'T');

  // If cleanStr already has an explicit offset or UTC indicator ('Z' or '+02:00' or '-05:00')
  if (/[zZ]$|[+-]\d{2}(?::?\d{2})?$/.test(cleanStr)) {
    return new Date(cleanStr);
  }

  // Zoom LTI API always outputs startTime in UTC. Append 'Z' to prevent JavaScript
  // from parsing it as a local device timestamp.
  return new Date(cleanStr.endsWith('Z') ? cleanStr : cleanStr + 'Z');
}

export function parseZoomHumanDateTime(rawStr: string, referenceDate: Date = new Date()): Date | undefined {
  if (!rawStr) return undefined;
  const clean = rawStr
    .replace(/\(recurring\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Try standard parsing first if it looks like an ISO / standard format
  if (/^\d{4}-\d{2}-\d{2}/.test(clean)) {
    const std = parseDateTimeInZone(clean);
    if (!isNaN(std.getTime()) && std.getTime() > 0) return std;
  }

  // Handle "Tomorrow 7:05 AM", "Tomorrow at 7:05 AM"
  const tomorrowMatch = clean.match(/^tomorrow\s*(?:at\s*)?(\d{1,2}):(\d{2})(?:\s*(am|pm))?/i);
  if (tomorrowMatch) {
    const d = new Date(referenceDate);
    d.setDate(d.getDate() + 1);
    let hours = parseInt(tomorrowMatch[1], 10);
    const minutes = parseInt(tomorrowMatch[2], 10);
    const meridiem = tomorrowMatch[3]?.toLowerCase();
    if (meridiem === 'pm' && hours < 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;
    d.setHours(hours, minutes, 0, 0);
    return d;
  }

  // Handle "Today 8:05 AM"
  const todayMatch = clean.match(/^today\s*(?:at\s*)?(\d{1,2}):(\d{2})(?:\s*(am|pm))?/i);
  if (todayMatch) {
    const d = new Date(referenceDate);
    let hours = parseInt(todayMatch[1], 10);
    const minutes = parseInt(todayMatch[2], 10);
    const meridiem = todayMatch[3]?.toLowerCase();
    if (meridiem === 'pm' && hours < 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;
    d.setHours(hours, minutes, 0, 0);
    return d;
  }

  // Handle "Thu, Nov 12 4:00 AM" or "Mon, Nov 16 7:00 AM" or "Nov 12 4:00 AM"
  const dateMatch = clean.match(/(?:[a-zA-Z]{3},\s*)?([a-zA-Z]{3})\s+(\d{1,2})(?:,?\s*(\d{4}))?\s*(?:at\s*)?(\d{1,2}):(\d{2})(?:\s*(am|pm))?/i);
  if (dateMatch) {
    const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const monthIdx = monthNames.indexOf(dateMatch[1].toLowerCase());
    if (monthIdx !== -1) {
      const day = parseInt(dateMatch[2], 10);
      const year = dateMatch[3] ? parseInt(dateMatch[3], 10) : referenceDate.getFullYear();
      let hours = parseInt(dateMatch[4], 10);
      const minutes = parseInt(dateMatch[5], 10);
      const meridiem = dateMatch[6]?.toLowerCase();
      if (meridiem === 'pm' && hours < 12) hours += 12;
      if (meridiem === 'am' && hours === 12) hours = 0;
      return new Date(year, monthIdx, day, hours, minutes, 0, 0);
    }
  }

  const std = parseDateTimeInZone(clean);
  if (!isNaN(std.getTime()) && std.getTime() > 0) return std;

  return undefined;
}

/**
 * Extracts Zoom meetings from server-rendered HTML tables or embedded snippets
 * (e.g. Moodle mod_zoom / mod_lti view page or Zoom LTI HTML).
 */
export function extractZoomMeetingsFromHtml(html: string, referenceDate: Date = new Date()): LtiZoomMeeting[] {
  if (!html) return [];
  const results: LtiZoomMeeting[] = [];
  const seenIds = new Set<string>();

  const rowMatches = html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
  for (const rm of rowMatches) {
    const row = rm[1];
    const idMatch = row.match(/\b(\d{3}[\s-]*\d{3,4}[\s-]*\d{4})\b/) || row.match(/\b(\d{9,11})\b/);
    if (!idMatch) continue;

    const rawId = idMatch[1].replace(/[\s-]/g, '');
    if (!/^\d{9,11}$/.test(rawId)) continue;
    if (seenIds.has(rawId)) continue;

    const cells = Array.from(row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((m) =>
      decodeHTMLEntities(
        m[1]
          .replace(/<br\s*\/?>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      )
    );

    let topic = '';
    let startTimeRaw = '';

    for (const cell of cells) {
      if (!cell) continue;
      if (cell.includes(idMatch[1]) || cell.replace(/[\s-]/g, '').includes(rawId)) continue;
      if (/^(?:join|invitation|delete|edit|start|details|הצטרף|הזמנה|הצטרפות)$/i.test(cell)) continue;

      if (
        /\b(?:recurring|tomorrow|yesterday|today|mon|tue|wed|thu|fri|sat|sun|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(cell) ||
        /\b\d{1,2}:\d{2}\s*(?:am|pm)\b/i.test(cell)
      ) {
        if (!startTimeRaw) startTimeRaw = cell;
        continue;
      }

      if (!topic) {
        topic = cell;
      }
    }

    let joinUrl = '';
    const anchorMatches = row.matchAll(/href=["']([^"']+)["']/gi);
    for (const am of anchorMatches) {
      const href = decodeHTMLEntities(am[1]);
      if (isZoomJoinUrl(href, rawId)) {
        joinUrl = href;
        break;
      }
    }
    const pwdMatch = row.match(/[?&]pwd=([a-zA-Z0-9._-]+)/i);
    const password = pwdMatch ? pwdMatch[1] : undefined;

    if (!joinUrl) {
      joinUrl = `https://tau-ac-il.zoom.us/j/${rawId}${password ? `?pwd=${password}` : ''}`;
    }

    seenIds.add(rawId);
    const parsedDate = startTimeRaw ? parseZoomHumanDateTime(startTimeRaw, referenceDate) : undefined;
    const startTimeIso = parsedDate && !isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : undefined;

    results.push({
      topic: topic || `Meeting ${rawId}`,
      meetingId: rawId,
      meetingNumber: rawId,
      startTime: startTimeIso,
      joinUrl,
      password,
      isUpcoming: true,
    });
  }

  return results;
}

/**
 * Normalizes and validates a Zoom meeting startTime from the LTI Rich API.
 *
 * Why weird/unrelated hours happen:
 * 1. In Zoom's API, "Recurring meeting with no fixed time" (`type === 3`), Instant meetings (`type === 1`),
 *    and Personal Meeting Rooms (`type === 4`) populate `startTime` with the timestamp when the lecturer
 *    created/saved the room in Moodle (e.g. `02:37:41` or `23:14:52`), which is completely unrelated to class hours.
 * 2. Scheduled Zoom meetings (`type === 2` or `type === 8`) can only be scheduled on 5-minute intervals with `:00` seconds.
 *    Any timestamp with non-zero seconds or non-5-minute granularity is a creation/instant-launch artifact.
 * 3. Zoom LTI Rich API returns UTC date-time strings (e.g. "YYYY-MM-DD HH:mm:ss") without a 'Z' suffix.
 *    They are normalized to UTC ISO strings so the browser can format them in the user's local timezone.
 */
export function normalizeZoomStartTime(
  m: any,
  isUpcoming = true,
  referenceDate: Date = new Date()
): string | undefined {
  if (!m) return undefined;

  const raw =
    m.startTime !== undefined && m.startTime !== null && m.startTime !== ''
      ? m.startTime
      : m.start_time;

  if (raw === undefined || raw === null || raw === '') {
    return undefined;
  }

  // Filter out non-scheduled meeting types:
  // Zoom meeting types: 1 = Instant, 2 = Scheduled, 3 = Recurring with no fixed time, 4 = PMI, 8 = Recurring with fixed time
  if (m.type !== undefined && m.type !== null && ![2, 8].includes(Number(m.type))) {
    return undefined;
  }
  if (m.noFixedTime === true || m.recurrence?.type === 4) {
    return undefined;
  }

  let date: Date;

  if (typeof raw === 'number') {
    // Handle Unix seconds vs milliseconds
    const ms = raw < 1e11 ? raw * 1000 : raw;
    date = new Date(ms);
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    if (/^\d+$/.test(trimmed)) {
      const num = Number(trimmed);
      date = new Date(num < 1e11 ? num * 1000 : num);
    } else {
      date = parseZoomHumanDateTime(trimmed, referenceDate) || parseDateTimeInZone(trimmed);
    }
  } else if (raw instanceof Date) {
    date = raw;
  } else {
    return undefined;
  }

  const timeMs = date.getTime();
  if (isNaN(timeMs) || timeMs <= 0) {
    return undefined;
  }

  // Scheduled Zoom meetings are always aligned to 5-minute boundaries with 0 seconds.
  // Creation timestamps on "No Fixed Time" rooms almost always have arbitrary minutes/seconds (e.g. 14:23:47).
  if (date.getUTCSeconds() !== 0 || date.getUTCMinutes() % 5 !== 0) {
    return undefined;
  }

  // If this came from the `previous` meetings list and ended more than 3 hours ago,
  // strip the timestamp so an old finished session doesn't show a stale hour on the room card.
  const durationMinutes = Number(m.duration) > 0 ? Number(m.duration) : 120;
  const endTimeMs = timeMs + durationMinutes * 60 * 1000;
  if (!isUpcoming && endTimeMs + 60 * 60 * 1000 < referenceDate.getTime()) {
    return undefined;
  }

  return date.toISOString();
}

export async function scrapeZoomMeetingsWithToken(
  token: string,
  instanceId: number,
  baseUrl = 'https://moodle.tau.ac.il',
  cmid?: number,
  jar?: CookieJar | null,
  modname = 'lti'
): Promise<LtiZoomMeeting[]> {
  const cleanBaseUrl = baseUrl.replace(/\/+$/, '');
  const meetings: LtiZoomMeeting[] = [];
  const seenMeetingKeys = new Set<string>();

  const addParsedMeetings = (list: LtiZoomMeeting[]) => {
    for (const m of list) {
      if (!m || !m.joinUrl || !isZoomJoinUrl(m.joinUrl, m.meetingNumber)) continue;
      const key = m.meetingNumber || m.joinUrl;
      const uniqueKey = m.startTime ? `${key}_${m.startTime}` : key;
      if (!seenMeetingKeys.has(uniqueKey)) {
        seenMeetingKeys.add(uniqueKey);
        meetings.push(m);
      }
    }
  };

  const zoomJar = jar || new CookieJar();
  const targetCmid = cmid || instanceId;

  let endpoint: string | undefined;
  const ltiParams = new URLSearchParams();

  // 1. Fetch Moodle view page: /mod/${modname}/view.php?id=${targetCmid}
  if (targetCmid) {
    try {
      const viewUrl = `${cleanBaseUrl}/mod/${modname}/view.php?id=${targetCmid}`;
      const viewRes = await mfetch(zoomJar, viewUrl);
      if (viewRes.ok) {
        const viewHtml = await viewRes.text();

        // 1a. Table rows directly on view.php (e.g. mod_zoom)
        const tableMeetings = extractZoomMeetingsFromHtml(viewHtml);
        if (tableMeetings.length > 0) {
          addParsedMeetings(tableMeetings);
        }

        // 1b. Embedded Zoom URLs
        const embeddedLinks = extractZoomLinksFromHtml(viewHtml);
        for (const el of embeddedLinks) {
          const parsed = parseZoomUrl(el.url);
          if (isZoomJoinUrl(parsed.meetingUrl, parsed.meetingNumber)) {
            addParsedMeetings([
              {
                topic: el.title || (parsed.meetingNumber ? `Meeting ${parsed.meetingNumber}` : 'Zoom Meeting'),
                meetingId: parsed.meetingNumber || '',
                meetingNumber: parsed.meetingNumber || '',
                joinUrl: parsed.meetingUrl,
                password: parsed.password,
                isUpcoming: true,
              },
            ]);
          }
        }

        // 1c. Check if viewHtml has an LTI launch form
        try {
          const parsedForm = parseLtiForm(viewHtml);
          if (parsedForm && parsedForm.actionUrl) {
            endpoint = parsedForm.actionUrl;
            parsedForm.params.forEach((v, k) => ltiParams.append(k, v));
          }
        } catch (_) {}

        // 1d. Check if viewHtml embeds an iframe (contentframe -> launch.php or applications.zoom.us)
        const iframeMatch = viewHtml.match(/<iframe[^>]+src=["']([^"']+)["']/i);
        if (iframeMatch) {
          try {
            const rawSrc = decodeHTMLEntities(iframeMatch[1]);
            const iframeUrl = rawSrc.startsWith('http') ? rawSrc : new URL(rawSrc, viewUrl).href;
            const iframeRes = await mfetch(zoomJar, iframeUrl);
            if (iframeRes.ok) {
              const iframeHtml = await iframeRes.text();

              const iframeTableMeetings = extractZoomMeetingsFromHtml(iframeHtml);
              if (iframeTableMeetings.length > 0) {
                addParsedMeetings(iframeTableMeetings);
              }

              const iframeLinks = extractZoomLinksFromHtml(iframeHtml);
              for (const el of iframeLinks) {
                const parsed = parseZoomUrl(el.url);
                if (isZoomJoinUrl(parsed.meetingUrl, parsed.meetingNumber)) {
                  addParsedMeetings([
                    {
                      topic: el.title || (parsed.meetingNumber ? `Meeting ${parsed.meetingNumber}` : 'Zoom Meeting'),
                      meetingId: parsed.meetingNumber || '',
                      meetingNumber: parsed.meetingNumber || '',
                      joinUrl: parsed.meetingUrl,
                      password: parsed.password,
                      isUpcoming: true,
                    },
                  ]);
                }
              }

              if (!endpoint) {
                try {
                  const parsedIframeForm = parseLtiForm(iframeHtml);
                  if (parsedIframeForm && parsedIframeForm.actionUrl) {
                    endpoint = parsedIframeForm.actionUrl;
                    parsedIframeForm.params.forEach((v, k) => ltiParams.append(k, v));
                  }
                } catch (_) {}
              }
            }
          } catch (_) {}
        }
      }
    } catch (viewErr) {
      console.warn(`[ZoomScraper] Failed to fetch Moodle view page for cmid ${targetCmid}:`, viewErr);
    }
  }

  // 2. If endpoint not found and modname === 'lti', try WS API mod_lti_get_tool_launch_data
  if (!endpoint && modname === 'lti') {
    const wsUrl = `${cleanBaseUrl}/webservice/rest/server.php`;
    const candidateToolIds = [cmid, instanceId].filter((id): id is number => typeof id === 'number' && !isNaN(id) && id > 0);
    const uniqueCandidateIds = Array.from(new Set(candidateToolIds));

    for (const tid of uniqueCandidateIds) {
      try {
        const urlParams = new URLSearchParams({
          wstoken: token,
          wsfunction: 'mod_lti_get_tool_launch_data',
          moodlewsrestformat: 'json',
          toolid: String(tid),
        });

        const res = await fetch(`${wsUrl}?${urlParams.toString()}`);
        if (res.ok) {
          const data = await res.json();
          if (!data.exception && data.endpoint) {
            endpoint = data.endpoint;
            if (Array.isArray(data.parameters)) {
              data.parameters.forEach((p: any) => {
                if (p && p.name) ltiParams.append(p.name, p.value ?? '');
              });
            }
            break;
          }
        }
      } catch (_) {}
    }
  }

  // 3. Fallback to /mod/lti/launch.php?id={cmid}&triggerview=0 if still no endpoint
  if (!endpoint && modname === 'lti' && targetCmid) {
    try {
      const launchUrl = `${cleanBaseUrl}/mod/lti/launch.php?id=${targetCmid}&triggerview=0`;
      const launchRes = await mfetch(zoomJar, launchUrl);
      if (launchRes.ok) {
        const launchHtml = await launchRes.text();
        const launchTableMeetings = extractZoomMeetingsFromHtml(launchHtml);
        if (launchTableMeetings.length > 0) {
          addParsedMeetings(launchTableMeetings);
        }
        try {
          const parsedForm = parseLtiForm(launchHtml);
          if (parsedForm && parsedForm.actionUrl) {
            endpoint = parsedForm.actionUrl;
            parsedForm.params.forEach((val, key) => ltiParams.append(key, val));
          }
        } catch (_) {}
      }
    } catch (_) {}
  }

  // 4. If endpoint was found, POST to Zoom LTI endpoint and fetch LTI API
  if (endpoint) {
    let zoomHtml = '';
    try {
      const zoomRes = await mfetch(zoomJar, endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        body: ltiParams.toString(),
      });
      if (zoomRes.ok) {
        zoomHtml = await zoomRes.text();
      }
    } catch (postErr: any) {
      console.warn('[ZoomScraper] POST to Zoom LTI endpoint failed:', postErr);
    }

    if (zoomHtml) {
      // 4a. JSON blocks inside scripts
      const jsonMatches = zoomHtml.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi);
      for (const sm of jsonMatches) {
        const scriptContent = sm[1];
        const listMatches = scriptContent.match(/\[\s*\{[\s\S]*?"(?:topic|meetingNumber|meetingId|joinUrl)"[\s\S]*?\}\s*\]/g);
        if (listMatches) {
          for (const lm of listMatches) {
            try {
              const parsed = JSON.parse(lm);
              if (Array.isArray(parsed)) {
                for (const item of parsed) {
                  const num = String(item.meetingNumber || item.meetingId || item.id || '').replace(/[\s-]/g, '');
                  const url = item.joinUrl || item.join_url || (num ? `https://tau-ac-il.zoom.us/j/${num}` : '');
                  if (url && isZoomJoinUrl(url, num)) {
                    addParsedMeetings([
                      {
                        topic: item.topic || item.title || (num ? `Meeting ${num}` : 'Zoom Meeting'),
                        meetingId: num,
                        meetingNumber: num,
                        startTime: normalizeZoomStartTime(item, true),
                        joinUrl: url,
                        password: item.password,
                        isUpcoming: true,
                      },
                    ]);
                  }
                }
              }
            } catch (_) {}
          }
        }
      }

      // 4b. Table rows from Zoom HTML
      const zoomTableMeetings = extractZoomMeetingsFromHtml(zoomHtml);
      if (zoomTableMeetings.length > 0) {
        addParsedMeetings(zoomTableMeetings);
      }

      // 4c. Embedded Zoom links
      const embeddedLinks = extractZoomLinksFromHtml(zoomHtml);
      for (const el of embeddedLinks) {
        const parsed = parseZoomUrl(el.url);
        if (isZoomJoinUrl(parsed.meetingUrl, parsed.meetingNumber)) {
          addParsedMeetings([
            {
              topic: el.title || (parsed.meetingNumber ? `Meeting ${parsed.meetingNumber}` : 'Zoom Meeting'),
              meetingId: parsed.meetingNumber || '',
              meetingNumber: parsed.meetingNumber || '',
              joinUrl: parsed.meetingUrl,
              password: parsed.password,
              isUpcoming: true,
            },
          ]);
        }
      }

      // 4d. Zoom LTI Rich API calls
      const appConf = parseAppConf(zoomHtml);
      const ajaxHeaders: Record<string, string> = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json, text/plain, */*',
      };
      if (appConf?.ajaxHeaders) {
        for (const h of appConf.ajaxHeaders) {
          ajaxHeaders[h.key] = h.value;
        }
      }

      const fetchLtiApi = async (apiUrl: string, isUpcoming: boolean) => {
        try {
          const apiRes = await mfetch(zoomJar, apiUrl, { method: 'GET', headers: ajaxHeaders });
          if (apiRes.ok) {
            const data = await apiRes.json();
            if (Array.isArray(data?.result?.list)) {
              for (const m of data.result.list) {
                const num = String(m.meetingNumber || m.meetingId || m.id || '').replace(/[\s-]/g, '');
                const url = m.joinUrl || m.join_url || (num ? `https://tau-ac-il.zoom.us/j/${num}` : '');
                if (url && isZoomJoinUrl(url, num)) {
                  addParsedMeetings([
                    {
                      topic: m.topic || m.title || (num ? `Meeting ${num}` : 'Zoom Meeting'),
                      meetingId: num,
                      meetingNumber: num,
                      startTime: normalizeZoomStartTime(m, isUpcoming),
                      joinUrl: url,
                      password: m.password,
                      isUpcoming,
                    },
                  ]);
                }
              }
            }
          }
        } catch (_) {}
      };

      await fetchLtiApi('https://applications.zoom.us/api/v1/lti/rich/meeting/upComing/COURSE/all?page=1&total=0', true);
      await fetchLtiApi('https://applications.zoom.us/api/v1/lti/rich/meeting/previous/COURSE/all?page=1&total=0', false);
    }
  }

  return meetings;
}

/**
 * Collapses recurring Zoom meetings (sharing the same room/meeting number or URL)
 * into a single meeting representing the currently active or closest upcoming session
 * (or the latest past session).
 * Sorts active/upcoming sessions chronologically, then non-timestamped, then past sessions.
 */
export function collapseRecurringMeetings(meetings: ZoomMeeting[], referenceDate: Date = new Date()): ZoomMeeting[] {
  const groups = new Map<string, ZoomMeeting[]>();

  for (const m of meetings || []) {
    if (!m || !m.meetingUrl) continue;
    const key = `${m.courseId || m.courseName}_${m.meetingNumber || m.meetingUrl}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(m);
  }

  const result: ZoomMeeting[] = [];
  const refTime = referenceDate.getTime();
  const activeWindowMs = 2 * 60 * 60 * 1000; // 2 hours active meeting window

  const isActiveOrFuture = (timeMs: number) => timeMs + activeWindowMs >= refTime;

  for (const [, list] of groups.entries()) {
    if (list.length === 1) {
      result.push(list[0]);
      continue;
    }

    // 1. Find currently active or upcoming meetings (startTime + 2h >= refTime)
    const activeOrFuture = list.filter((m) => {
      if (!m.startTime) return false;
      const t = new Date(m.startTime).getTime();
      return !isNaN(t) && isActiveOrFuture(t);
    });
    if (activeOrFuture.length > 0) {
      // Sort ascending (currently active or nearest upcoming first)
      activeOrFuture.sort((a, b) => new Date(a.startTime!).getTime() - new Date(b.startTime!).getTime());
      result.push(activeOrFuture[0]);
      continue;
    }

    // 2. If no active/upcoming, find most recent past meeting (startTime + 2h < refTime)
    const past = list.filter((m) => {
      if (!m.startTime) return false;
      const t = new Date(m.startTime).getTime();
      return !isNaN(t) && !isActiveOrFuture(t);
    });
    if (past.length > 0) {
      // Sort descending (latest past first)
      past.sort((a, b) => new Date(b.startTime!).getTime() - new Date(a.startTime!).getTime());
      result.push(past[0]);
      continue;
    }

    // 3. Meetings without startTime
    result.push(list[0]);
  }

  // Sort: active/upcoming first (chronological), then undated, then past
  return result.sort((a, b) => {
    const timeA = a.startTime ? new Date(a.startTime).getTime() : 0;
    const timeB = b.startTime ? new Date(b.startTime).getTime() : 0;

    const isFutureA = timeA > 0 && isActiveOrFuture(timeA);
    const isFutureB = timeB > 0 && isActiveOrFuture(timeB);

    if (isFutureA && isFutureB) {
      return timeA - timeB;
    }
    if (isFutureA && !isFutureB) return -1;
    if (!isFutureA && isFutureB) return 1;

    if (timeA && !timeB) return -1;
    if (!timeA && timeB) return 1;

    return (a.title || '').localeCompare(b.title || '');
  });
}

