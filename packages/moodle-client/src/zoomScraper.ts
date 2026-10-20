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
  // Hebrew keywords commonly used in Israeli Moodle courses
  if (/זום|מפגש מקוון|מפגשי זום|מפגש זום|שיעור זום|שיעורי זום|חדר זום|הרצאה מקוונת|הרצאות מקוונות|שיעור מקוון|שיעורים מקוונים|קישור לשיעור|קישור להרצאה|קישור למפגש|קישור לזום|היוועדות חזותית|כיתה וירטואלית|כיתה מקוונת|סינכרונ|חדר פגישות/i.test(name)) {
    return true;
  }
  return false;
}

export function parseZoomUrl(rawUrl: string): { meetingUrl: string; meetingNumber?: string; password?: string } {
  let cleanUrl = decodeHTMLEntities(rawUrl).trim();
  let meetingNumber: string | undefined;
  let password: string | undefined;

  const matchNum = cleanUrl.match(/\/(?:j|w|s)\/(\d+)/i) || cleanUrl.match(/\/my\/([a-zA-Z0-9._-]+)/i);
  if (matchNum) {
    meetingNumber = matchNum[1];
  }

  try {
    const urlObj = new URL(cleanUrl);
    const pwdParam = urlObj.searchParams.get('pwd');
    if (pwdParam) {
      password = pwdParam;
    }

    const host = urlObj.hostname.toLowerCase();
    if (meetingNumber && /^\d+$/.test(meetingNumber) && (host === 'zoom.us' || host === 'www.zoom.us' || host === 'tau.zoom.us' || host === 'tau-ac-il.zoom.us')) {
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

async function mfetch(jar: CookieJar, url: string, init: ManagedInit = {}): Promise<Response> {
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

async function mfetchFollow(
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
  if (!headersBlockMatch) {
    throw new Error('ajaxHeaders not found in Zoom LTI HTML');
  }

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
 * Normalizes and validates a Zoom meeting startTime from the LTI Rich API.
 *
 * Why weird/unrelated hours happen:
 * 1. In Zoom's API, "Recurring meeting with no fixed time" (`type === 3`), Instant meetings (`type === 1`),
 *    and Personal Meeting Rooms (`type === 4`) populate `startTime` with the timestamp when the lecturer
 *    created/saved the room in Moodle (e.g. `02:37:41` or `23:14:52`), which is completely unrelated to class hours.
 * 2. Scheduled Zoom meetings (`type === 2` or `type === 8`) can only be scheduled on 5-minute intervals with `:00` seconds.
 *    Any timestamp with non-zero seconds or non-5-minute granularity is a creation/instant-launch artifact.
 * 3. Meetings from the `/previous/` endpoint that ended more than 3 hours ago should not display their old
 *    timestamp as if it were an active or upcoming class time.
 */
export function normalizeZoomStartTime(
  m: any,
  isUpcoming = true,
  referenceDate: Date = new Date()
): string | undefined {
  if (!m || m.startTime === undefined || m.startTime === null || m.startTime === '') {
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

  const raw = m.startTime;
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
      date = new Date(trimmed);
    }
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
  baseUrl = 'https://moodle.tau.ac.il'
): Promise<LtiZoomMeeting[]> {
  const wsUrl = `${baseUrl}/webservice/rest/server.php`;
  const urlParams = new URLSearchParams({
    wstoken: token,
    wsfunction: 'mod_lti_get_tool_launch_data',
    moodlewsrestformat: 'json',
    toolid: String(instanceId),
  });

  const res = await fetch(`${wsUrl}?${urlParams.toString()}`);
  if (!res.ok) {
    throw new Error(`Failed to call Moodle WS API mod_lti_get_tool_launch_data: ${res.statusText}`);
  }

  const launchData = await res.json();
  if (launchData.exception) {
    throw new Error(`Moodle API Exception: ${launchData.message}`);
  }

  const endpoint = launchData.endpoint;
  const ltiParams = new URLSearchParams();
  if (Array.isArray(launchData.parameters)) {
    launchData.parameters.forEach((p: any) => {
      ltiParams.append(p.name, p.value);
    });
  }

  const zoomJar = new CookieJar();
  const zoomRes = await mfetch(zoomJar, endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    },
    body: ltiParams.toString()
  });

  if (!zoomRes.ok) {
    throw new Error(`Zoom LTI launch POST failed with status: ${zoomRes.status}`);
  }

  const zoomHtml = await zoomRes.text();
  const appConf = parseAppConf(zoomHtml);

  // Configure request headers for AJAX calls to Zoom API
  const ajaxHeaders: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*'
  };
  if (appConf.ajaxHeaders) {
    for (const h of appConf.ajaxHeaders) {
      ajaxHeaders[h.key] = h.value;
    }
  }

  const meetings: LtiZoomMeeting[] = [];
  const seenUpcomingRooms = new Set<string>();

  const parseAndAddMeetings = (list: any[], isUpcoming: boolean) => {
    if (!Array.isArray(list)) return;

    for (const m of list) {
      const directJoinUrl = m.joinUrl || '';
      const matchNum = directJoinUrl.match(/\/j\/(\d+)/);
      const meetingNumber = matchNum ? matchNum[1] : '';
      
      let password = '';
      try {
        const urlObj = new URL(directJoinUrl);
        password = urlObj.searchParams.get('pwd') || '';
      } catch (_) {}

      const directUrl = meetingNumber 
        ? `https://tau-ac-il.zoom.us/j/${meetingNumber}${password ? `?pwd=${password}` : ''}`
        : directJoinUrl;

      const roomKey = meetingNumber || directUrl;
      if (isUpcoming && roomKey) {
        seenUpcomingRooms.add(roomKey);
      } else if (!isUpcoming && roomKey && seenUpcomingRooms.has(roomKey)) {
        // Room already exists in upComing list; skip redundant historical entry
        continue;
      }

      meetings.push({
        topic: m.topic || '',
        meetingId: m.meetingId || '',
        meetingNumber,
        startTime: normalizeZoomStartTime(m, isUpcoming),
        joinUrl: directUrl,
        password: password || undefined,
        isUpcoming
      });
    }
  };

  // 5. Fetch upcoming meetings
  const upcomingUrl = 'https://applications.zoom.us/api/v1/lti/rich/meeting/upComing/COURSE/all?page=1&total=0';
  const upcomingRes = await mfetch(zoomJar, upcomingUrl, {
    method: 'GET',
    headers: ajaxHeaders
  });
  if (upcomingRes.ok) {
    const upcomingData = await upcomingRes.json();
    if (upcomingData.result && upcomingData.result.list) {
      parseAndAddMeetings(upcomingData.result.list, true);
    }
  }

  // 6. Fetch previous meetings (fallback for rooms only listed under previous)
  const previousUrl = 'https://applications.zoom.us/api/v1/lti/rich/meeting/previous/COURSE/all?page=1&total=0';
  const previousRes = await mfetch(zoomJar, previousUrl, {
    method: 'GET',
    headers: ajaxHeaders
  });
  if (previousRes.ok) {
    const previousData = await previousRes.json();
    if (previousData.result && previousData.result.list) {
      parseAndAddMeetings(previousData.result.list, false);
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

  for (const m of meetings) {
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

