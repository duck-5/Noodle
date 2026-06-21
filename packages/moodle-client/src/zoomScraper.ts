import { MoodleCredentials } from './types.js';

export interface LtiZoomMeeting {
  topic: string;
  meetingId: string;
  meetingNumber: string;
  startTime?: string;
  joinUrl: string;
  password?: string;
  isUpcoming: boolean;
}

function decodeHTMLEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#x3d;/g, '=')
    .replace(/&#x3D;/g, '=')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
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
  const isBrowser = typeof window !== 'undefined' || (typeof (globalThis as any).chrome !== 'undefined' && (globalThis as any).chrome.runtime);

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
    fetchInit.credentials = 'include';
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

function parseAppConf(html: string): any {
  const headersBlockMatch = html.match(/ajaxHeaders\s*:\s*\[([\s\S]*?)\]/);
  if (!headersBlockMatch) {
    throw new Error('ajaxHeaders not found in Zoom LTI HTML');
  }

  const blockContent = headersBlockMatch[1];
  const ajaxHeaders: { key: string; value: string }[] = [];
  
  const regex = /\{\s*["']?key["']?\s*:\s*["']([^"']+)["']\s*,\s*["']?value["']?\s*:\s*["']([^"']+)["']\s*\}/g;
  let match;
  while ((match = regex.exec(blockContent)) !== null) {
    ajaxHeaders.push({
      key: match[1],
      value: match[2]
    });
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
        if (m.modname === 'lti' && (m.name || '').toLowerCase().includes('zoom')) {
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

      meetings.push({
        topic: m.topic || '',
        meetingId: m.meetingId || '',
        meetingNumber,
        startTime: m.startTime || undefined,
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

  // 6. Fetch previous meetings
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
