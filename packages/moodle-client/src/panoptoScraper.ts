import { MoodleCredentials, PanoptoRecording } from './types.js';
import { CookieJar, decodeHTMLEntities } from './zoomScraper.js';

export const PANOPTO_BASE_URL = 'https://tau.cloud.panopto.eu';

const UUID_REGEX = /[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}/;
const EXACT_UUID_REGEX = /^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/;

export function isPanoptoUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return (
      host.endsWith('panopto.eu') ||
      host.endsWith('panopto.com') ||
      host.endsWith('panopto.tau.ac.il') ||
      host.includes('.panopto.')
    );
  } catch {
    return /https?:\/\/[a-zA-Z0-9.\-]*panopto\.(?:eu|com|tau\.ac\.il)/i.test(url);
  }
}

/**
 * Checks whether a Moodle module name indicates a Panopto / recordings activity.
 */
export function isPanoptoModuleName(name: string): boolean {
  if (!name) return false;
  return /panopto|פנופטו|הקלטות|הקלטה|וידאו|recordings|lecture recordings|צפייה בהרצאות|שיעורים מוקלטים/i.test(name);
}

/**
 * Decodes up to 2 layers of URL percent-encoding and HTML entities so nested `ReturnUrl=%2fPanopto%2fPages%2fViewer.aspx%3fid%3d...`
 * or `SSO.php?return_url=...` links can be inspected reliably.
 */
function fullyDecodeUrl(input: string): string {
  let decoded = decodeHTMLEntities(input).trim();
  for (let i = 0; i < 2; i++) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
}

/**
 * Extracts a Panopto folder UUID from either a raw UUID string or a Panopto Folder URL
 * (e.g. `https://tau.cloud.panopto.eu/Panopto/Pages/Sessions/List.aspx#folderID=%22d971...%22`).
 */
export function extractPanoptoFolderId(input: string): string | null {
  if (!input) return null;
  const trimmed = decodeHTMLEntities(input).trim();
  if (!trimmed) return null;

  const decoded = fullyDecodeUrl(trimmed);

  // Never treat a single-video Viewer.aspx / Embed.aspx link as a folder ID
  if (extractPanoptoDeliveryId(decoded)) {
    return null;
  }

  const unquoted = decoded.replace(/^["'\s]+|["'\s]+$/g, '');
  if (EXACT_UUID_REGEX.test(unquoted)) {
    return unquoted.toLowerCase();
  }

  // Match folderID="..." or folderID=%22...%22 or folderID=...
  const folderParamMatch = decoded.match(
    /folderID\s*=\s*(?:["']|%22)?([a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12})/i
  );
  if (folderParamMatch) {
    return folderParamMatch[1].toLowerCase();
  }

  // If it's a Panopto List/EmbeddedList/folders URL or a non-URL string containing a UUID, extract it
  if (
    /Sessions\/List\.aspx/i.test(decoded) ||
    /EmbeddedList\.aspx/i.test(decoded) ||
    /folders\//i.test(decoded) ||
    isPanoptoUrl(decoded) ||
    !/^https?:\/\//i.test(decoded)
  ) {
    const uuidMatch = decoded.match(UUID_REGEX);
    if (uuidMatch) {
      return uuidMatch[0].toLowerCase();
    }
  }

  return null;
}

/**
 * Extracts a Panopto delivery/session UUID from a Viewer or Embed URL
 * (e.g. `https://tau.cloud.panopto.eu/Panopto/Pages/Viewer.aspx?id=05c6...` or wrapped in `Login.aspx?ReturnUrl=...`).
 */
export function extractPanoptoDeliveryId(input: string): string | null {
  if (!input) return null;
  const decoded = fullyDecodeUrl(input);
  if (!decoded) return null;

  const idMatch =
    decoded.match(
      /(?:Viewer|Embed)\.aspx\?[^#"']*\bid=([a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12})/i
    ) ||
    decoded.match(
      /\bdeliveryId=([a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12})/i
    );
  if (idMatch) {
    return idMatch[1].toLowerCase();
  }

  return null;
}

export function buildPanoptoFolderUrl(folderId: string, baseUrl = PANOPTO_BASE_URL): string {
  return `${baseUrl.replace(/\/+$/, '')}/Panopto/Pages/Sessions/List.aspx#folderID=%22${folderId.toLowerCase()}%22`;
}

export function buildPanoptoViewerUrl(deliveryId: string, baseUrl = PANOPTO_BASE_URL): string {
  return `${baseUrl.replace(/\/+$/, '')}/Panopto/Pages/Viewer.aspx?id=${deliveryId.toLowerCase()}`;
}

export interface ExtractedCoursePanoptoLinks {
  folderIds: string[];
  deliveries: { id: string; title: string; recordingUrl: string }[];
}

/**
 * Scans Moodle course HTML (including the `block_panopto` side panel and section links)
 * for Panopto folder URLs (`Sessions/List.aspx#folderID=...`) and direct video links (`Viewer.aspx?id=...`).
 */
export function extractPanoptoFromCourseHtml(
  html: string,
  baseUrl = PANOPTO_BASE_URL
): ExtractedCoursePanoptoLinks {
  const folderIds: string[] = [];
  const seenFolders = new Set<string>();
  const deliveries: { id: string; title: string; recordingUrl: string }[] = [];
  const seenDeliveries = new Set<string>();

  if (!html) return { folderIds, deliveries };

  const anchorRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = anchorRegex.exec(html)) !== null) {
    const rawHref = decodeHTMLEntities(match[1]).trim();
    const decodedHref = fullyDecodeUrl(rawHref);
    if (
      !isPanoptoUrl(rawHref) &&
      !isPanoptoUrl(decodedHref) &&
      !/panopto/i.test(rawHref) &&
      !/panopto/i.test(decodedHref)
    ) {
      continue;
    }

    // Check single-video delivery ID FIRST so Login.aspx?ReturnUrl=...Viewer.aspx?id=... is never misclassified as a folder
    const deliveryId = extractPanoptoDeliveryId(decodedHref);
    if (deliveryId && !seenDeliveries.has(deliveryId)) {
      seenDeliveries.add(deliveryId);
      const innerText = decodeHTMLEntities(match[2].replace(/<[^>]+>/g, ''))
        .replace(/\s+/g, ' ')
        .trim();
      deliveries.push({
        id: deliveryId,
        title: innerText,
        recordingUrl: buildPanoptoViewerUrl(deliveryId, baseUrl),
      });
      continue;
    }

    const folderId = extractPanoptoFolderId(decodedHref);
    if (folderId && !seenFolders.has(folderId)) {
      seenFolders.add(folderId);
      folderIds.push(folderId);
      continue;
    }
  }

  // Also scan raw text / attributes for folderID=... and Viewer.aspx?id=... in case they are embedded in scripts/iframes/data-attributes
  const decodedHtml = fullyDecodeUrl(html);
  const rawFolderRegex =
    /folderID\s*=\s*(?:["']|%22)?([a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12})/gi;
  while ((match = rawFolderRegex.exec(decodedHtml)) !== null) {
    const fid = match[1].toLowerCase();
    if (!seenFolders.has(fid)) {
      seenFolders.add(fid);
      folderIds.push(fid);
    }
  }

  const rawViewerRegex =
    /(?:Viewer|Embed)\.aspx\?[^#"'\s<>]*\bid=([a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12})/gi;
  while ((match = rawViewerRegex.exec(decodedHtml)) !== null) {
    const did = match[1].toLowerCase();
    if (!seenDeliveries.has(did)) {
      seenDeliveries.add(did);
      deliveries.push({
        id: did,
        title: '',
        recordingUrl: buildPanoptoViewerUrl(did, baseUrl),
      });
    }
  }

  return { folderIds, deliveries };
}

/**
 * Checks whether a recording title (and optional duration) is a valid lecture/recitation
 * and not an accidental/garbage upload (e.g. "1", "---", or < 60s test clip).
 */
export function isValidPanoptoRecording(title: string, durationSeconds?: number): boolean {
  if (!title) return false;
  const cleanTitle = title.trim();
  if (cleanTitle.length < 3) return false;
  const hasLetters = /[a-zA-Z\u0590-\u05FF]/.test(cleanTitle);
  const isDateFormatted = /\b\d{1,4}[/.-]\d{1,2}[/.-]\d{2,4}\b/.test(cleanTitle);
  if (!hasLetters && !isDateFormatted) return false;
  if (cleanTitle.length < 5 && !/[\u0590-\u05FF]/.test(cleanTitle)) return false;
  if (durationSeconds !== undefined && durationSeconds > 0 && durationSeconds < 60) {
    return false;
  }
  return true;
}

/**
 * Classifies a recording as 'Recitation' or 'Lecture' based on Hebrew and English keywords.
 */
export function classifyRecordingType(title: string): 'Lecture' | 'Recitation' {
  const lower = (title || '').toLowerCase();
  const recitationKeywords = ['tirgul', 'recitation', 'תרגול', 'תרגיל', 'tutorial'];
  for (const kw of recitationKeywords) {
    if (lower.includes(kw)) {
      return 'Recitation';
    }
  }
  return 'Lecture';
}

/**
 * Parses Panopto's date formats (ASP.NET `/Date(1709635800000)/`, ISO 8601, `MM/DD/YYYY`, etc.)
 * into a standardized `YYYY-MM-DD` string.
 */
export function parsePanoptoDate(rawDate: unknown): string {
  if (!rawDate) return '';
  const rawStr = String(rawDate).trim();
  if (!rawStr) return '';

  // 1. Already YYYY-MM-DD or ISO 8601 starting with YYYY-MM-DD
  const isoMatch = rawStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  // 2. ASP.NET AJAX format: /Date(1709635800000)/ or /Date(1709635800000+0200)/
  const aspMatch = rawStr.match(/\/Date\((-?\d+)(?:[+-]\d{4})?\)\//);
  if (aspMatch) {
    const ms = Number(aspMatch[1]);
    if (!isNaN(ms) && ms > 0) {
      const d = new Date(ms);
      const year = d.getUTCFullYear();
      const month = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  }

  // 3. Slash-separated dates: M/D/YYYY or D/M/YYYY
  const slashMatch = rawStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashMatch) {
    const p1 = Number(slashMatch[1]);
    const p2 = Number(slashMatch[2]);
    const year = slashMatch[3];
    // Panopto US locale defaults to MM/DD/YYYY unless first part > 12
    const [month, day] = p1 > 12 ? [p2, p1] : [p1, p2];
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  // 4. Fallback native Date parser (e.g. "March 15, 2026" or "Mar 15, 2026")
  const parsed = new Date(rawStr);
  if (!isNaN(parsed.getTime()) && parsed.getFullYear() >= 2000) {
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  return '';
}

/**
 * Filters out garbage recordings and deduplicates recitation series groups.
 * When multiple recordings exist for the same recitation (e.g. "תרגול 3 חלק 1", "תרגול 3 חלק 2"
 * across different dates or semesters), keeps all parts belonging to the most recent `publishedDate`.
 */
export function filterAndDeduplicateRecordings(recordings: PanoptoRecording[]): PanoptoRecording[] {
  const seenIds = new Set<string>();
  const lectures: PanoptoRecording[] = [];
  const recitations: PanoptoRecording[] = [];

  for (const rec of recordings) {
    if (!isValidPanoptoRecording(rec.title, rec.durationSeconds)) {
      continue;
    }
    const key = (rec.id || rec.recordingUrl || rec.title).toLowerCase();
    if (seenIds.has(key)) continue;
    seenIds.add(key);

    const normalized: PanoptoRecording = {
      ...rec,
      title: rec.title.trim(),
      publishedDate: parsePanoptoDate(rec.publishedDate) || rec.publishedDate || '',
      type: rec.type || classifyRecordingType(rec.title),
    };

    if (normalized.type === 'Recitation') {
      recitations.push(normalized);
    } else {
      lectures.push(normalized);
    }
  }

  // Group recitations by base key (stripping part suffixes like "חלק 1", "part 2", "a-c")
  const recitationGroups = new Map<string, PanoptoRecording[]>();
  for (const rec of recitations) {
    let baseKey = rec.title.toLowerCase();
    baseKey = baseKey.replace(
      /[-–—,\s]*(?:חלק|part|חלקים)\s*(?:\d+|[א-ת]|[a-z])(?:\s*ו[-–—]?\s*(?:\d+|[א-ת]|[a-z]))?.*$/i,
      ''
    );
    baseKey = baseKey.replace(/\s+[a-c]$/i, '');
    baseKey = baseKey.replace(/[\s\-_]+/g, ' ').trim();
    if (!baseKey) {
      baseKey = rec.title.toLowerCase().trim();
    }

    const groupKey = `${rec.courseId}:${baseKey}`;
    if (!recitationGroups.has(groupKey)) {
      recitationGroups.set(groupKey, []);
    }
    recitationGroups.get(groupKey)!.push(rec);
  }

  const dedupedRecitations: PanoptoRecording[] = [];
  for (const group of recitationGroups.values()) {
    const byDate = new Map<string, PanoptoRecording[]>();
    for (const r of group) {
      const dStr = r.publishedDate || '0000-00-00';
      if (!byDate.has(dStr)) {
        byDate.set(dStr, []);
      }
      byDate.get(dStr)!.push(r);
    }
    const dates = Array.from(byDate.keys()).sort();
    const latestDate = dates[dates.length - 1];
    if (latestDate && byDate.has(latestDate)) {
      dedupedRecitations.push(...byDate.get(latestDate)!);
    }
  }

  const combined = [...lectures, ...dedupedRecitations];
  combined.sort((a, b) => {
    const dateA = a.publishedDate || '';
    const dateB = b.publishedDate || '';
    if (dateA !== dateB) {
      return dateB.localeCompare(dateA); // Newest first
    }
    return a.title.localeCompare(b.title);
  });

  return combined;
}

/**
 * Matches a Panopto recording to a Moodle course section name based on
 * lecture/recitation/week numbers or shared title keywords.
 */
export function matchRecordingToSection(
  recording: Pick<PanoptoRecording, 'title' | 'type'>,
  sectionNames: string[]
): string | undefined {
  if (!sectionNames || sectionNames.length === 0) return undefined;

  const cleanSections = sectionNames
    .map(s => s.trim())
    .filter(Boolean);
  if (cleanSections.length === 0) return undefined;

  const title = recording.title.trim();
  const recType = recording.type || classifyRecordingType(title);

  // Extract primary session/week/lecture/recitation number from recording title
  const numberRegex = /(?:הרצאה|שיעור|תרגול|תרגיל|שבוע|יחידה|נושא|מפגש|פרק|lecture|recitation|tirgul|week|lesson|topic|unit|session|chapter)\s*#?\s*0*(\d{1,2})\b/i;
  const leadingNumRegex = /^0*(\d{1,2})(?:\s*[-–—.:)]|\s+)/;

  const numMatch = title.match(numberRegex) || title.match(leadingNumRegex);
  const recNum = numMatch ? Number(numMatch[1]) : null;

  if (recNum !== null && !isNaN(recNum)) {
    // 1a. Try matching section with the exact same type + number (e.g. "תרגול 3" or "הרצאה 3")
    const typeKeywordRegex = recType === 'Recitation'
      ? new RegExp(`(?:תרגול|תרגיל|recitation|tirgul|tutorial)\\s*#?\\s*0*${recNum}(?!\\d)`, 'i')
      : new RegExp(`(?:הרצאה|שיעור|lecture|lesson)\\s*#?\\s*0*${recNum}(?!\\d)`, 'i');

    for (const sec of cleanSections) {
      if (typeKeywordRegex.test(sec)) {
        return sec;
      }
    }

    // 1b. Try matching section with week/topic/unit/lecture number == recNum
    const secNumberRegex = new RegExp(
      `(?:שבוע|הרצאה|שיעור|יחידה|נושא|מפגש|פרק|תרגול|week|lecture|lesson|topic|unit|session|chapter|section)\\s*#?\\s*0*${recNum}(?!\\d)|^0*${recNum}(?:\\s*[-–—.:)]|\\s+|$)`,
      'i'
    );
    for (const sec of cleanSections) {
      if (secNumberRegex.test(sec)) {
        return sec;
      }
    }
  }

  // 2. Keyword overlap between recording title and section name
  const stopWords = new Set([
    'הרצאה', 'שיעור', 'תרגול', 'תרגיל', 'שבוע', 'יחידה', 'נושא', 'מפגש', 'פרק', 'חלק', 'הקלטה', 'הקלטות', 'כללי',
    'lecture', 'recitation', 'tirgul', 'week', 'lesson', 'topic', 'unit', 'session', 'part', 'recording', 'recordings', 'general',
    'and', 'the', 'for', 'with', 'של', 'על', 'את', 'עם',
  ]);

  const tokenize = (text: string): string[] =>
    text
      .toLowerCase()
      .replace(/[^\w\u0590-\u05FF\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 3 && !/^\d+$/.test(w) && !stopWords.has(w));

  const recTokens = tokenize(title);
  if (recTokens.length > 0) {
    let bestSection: string | undefined;
    let bestScore = 0;

    for (const sec of cleanSections) {
      const secTokens = tokenize(sec);
      if (secTokens.length === 0) continue;
      let score = 0;
      for (const rt of recTokens) {
        if (secTokens.some(st => st === rt || (st.length >= 4 && rt.length >= 4 && (st.includes(rt) || rt.includes(st))))) {
          score++;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestSection = sec;
      }
    }

    if (bestScore > 0 && bestSection) {
      return bestSection;
    }
  }

  // 3. Dedicated recordings section if the course has one
  for (const sec of cleanSections) {
    if (/הקלטות|פנופטו|panopto|recordings|וידאו|videos/i.test(sec)) {
      return sec;
    }
  }

  return undefined;
}

/**
 * Fallback HTML parser for Panopto `Sessions/List.aspx` or table markup,
 * mirroring `_parse_html` in `legacy/clients/panopto_client.py`.
 */
export function parsePanoptoListHtml(
  html: string,
  courseId: number,
  courseName: string,
  baseUrl = PANOPTO_BASE_URL
): PanoptoRecording[] {
  if (!html) return [];
  const results: PanoptoRecording[] = [];
  const anchorRegex = /<a\s+[^>]*href=["']([^"']*Viewer\.aspx\?id=[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = anchorRegex.exec(html)) !== null) {
    const rawHref = decodeHTMLEntities(match[1]).trim();
    const deliveryId = extractPanoptoDeliveryId(rawHref);
    const title = decodeHTMLEntities(match[2].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    if (!deliveryId || !isValidPanoptoRecording(title)) continue;

    const recordingUrl = rawHref.startsWith('http')
      ? rawHref
      : buildPanoptoViewerUrl(deliveryId, baseUrl);

    results.push({
      id: deliveryId,
      title,
      recordingUrl,
      publishedDate: '',
      type: classifyRecordingType(title),
      courseId,
      courseName,
    });
  }

  return filterAndDeduplicateRecordings(results);
}

async function panoptoFetch(
  url: string,
  init: RequestInit = {},
  jar?: CookieJar | null
): Promise<Response> {
  const isBrowser =
    typeof window !== 'undefined' ||
    (typeof (globalThis as any).browser !== 'undefined' && (globalThis as any).browser.runtime) ||
    (typeof (globalThis as any).chrome !== 'undefined' && (globalThis as any).chrome.runtime);

  const headers: Record<string, string> = {};
  if (init.headers) {
    if (init.headers instanceof Headers) {
      init.headers.forEach((v, k) => {
        headers[k] = v;
      });
    } else {
      Object.assign(headers, init.headers as Record<string, string>);
    }
  }

  const fetchInit: RequestInit = {
    ...init,
    headers,
  };

  if (isBrowser) {
    fetchInit.credentials = 'include';
    delete headers['User-Agent'];
    delete headers['user-agent'];
  } else if (jar) {
    const cookieStr = jar.header();
    if (cookieStr) headers['Cookie'] = cookieStr;
  }

  const res = await fetch(url, fetchInit);
  if (!isBrowser && jar) {
    jar.ingest(res.headers.get('set-cookie'));
  }
  return res;
}

/**
 * Parses an HTML auto-submit SSO / SAML / LTI `<form>` and returns its action URL and input fields
 * if it contains SSO-related fields (`SAMLResponse`, `SAMLRequest`, `wresult`, `lti_message_type`, etc.).
 */
function parseAutoSubmitSsoForm(
  html: string,
  baseActionUrl: string
): { actionUrl: string; params: URLSearchParams } | null {
  if (!html) return null;
  const formRegex = /<form\b[^>]*action=["']([^"']+)["'][^>]*>([\s\S]*?)<\/form>/gi;
  let match: RegExpExecArray | null;

  while ((match = formRegex.exec(html)) !== null) {
    const rawAction = decodeHTMLEntities(match[1]).trim();
    const formBody = match[2];
    const inputRegex = /<input\b[^>]*>/gi;
    const params = new URLSearchParams();
    let hasSsoField = false;
    let inputMatch: RegExpExecArray | null;

    while ((inputMatch = inputRegex.exec(formBody)) !== null) {
      const tag = inputMatch[0];
      const nameMatch = tag.match(/\bname=["']([^"']+)["']/i);
      const valMatch = tag.match(/\bvalue=["']([^"']*)["']/i);
      if (nameMatch) {
        const fieldName = decodeHTMLEntities(nameMatch[1]);
        const fieldVal = valMatch ? decodeHTMLEntities(valMatch[1]) : '';
        params.append(fieldName, fieldVal);
        if (
          /^(SAMLResponse|SAMLRequest|RelayState|wresult|wa|wctx|lti_message_type|oauth_consumer_key|token|auth)$/i.test(
            fieldName
          )
        ) {
          hasSsoField = true;
        }
      }
    }

    if (
      hasSsoField ||
      /panopto|SSO\.php|saml|nidp\.tau\.ac\.il/i.test(rawAction)
    ) {
      let actionUrl = rawAction;
      try {
        actionUrl = rawAction.startsWith('http')
          ? rawAction
          : new URL(rawAction, baseActionUrl).href;
      } catch {
        // Keep rawAction if URL resolution fails
      }
      if ([...params.keys()].length > 0) {
        return { actionUrl, params };
      }
    }
  }

  return null;
}

/**
 * Performs a silent TAU NIDP SAML login to establish active web session cookies on
 * `nidp.tau.ac.il` and `moodle.tau.ac.il` using the user's stored Moodle credentials
 * (without resetting the user's mobile `wstoken`).
 */
async function ensureMoodleWebSessionWithCreds(
  cleanMoodle: string,
  creds: MoodleCredentials,
  jar?: CookieJar | null
): Promise<boolean> {
  if (!creds?.username || !creds?.idNumber || !creds?.password) return false;

  try {
    const initialRes = await panoptoFetch(`${cleanMoodle}/login/index.php`, { method: 'GET' }, jar);
    let urlAfterLogin = initialRes.url || `${cleanMoodle}/login/index.php`;
    let html1 = await initialRes.text();

    // If we landed on the Moodle dashboard with a sesskey, Moodle web session is already active
    if (urlAfterLogin.includes('moodle.tau.ac.il') && !urlAfterLogin.includes('/login/') && /"sesskey"\s*:\s*"[^"]+"/.test(html1)) {
      console.log('[Panopto][SSO] Existing Moodle web session is already active.');
      return true;
    }

    let ssoUrl = urlAfterLogin;
    if (urlAfterLogin.includes('/auth/saml2/login.php')) {
      const samlRes = await panoptoFetch(urlAfterLogin, { method: 'GET' }, jar);
      ssoUrl = samlRes.url || urlAfterLogin;
      html1 = await samlRes.text();
    } else if (!ssoUrl.includes('nidp.tau.ac.il')) {
      // Look for /auth/saml2/login.php link in login/index.php HTML
      const samlLinkMatch = html1.match(/href=["'](https?:\/\/[^"']*\/auth\/saml2\/login\.php[^"']*)["']/i);
      if (samlLinkMatch) {
        const samlLoginUrl = decodeHTMLEntities(samlLinkMatch[1]);
        const samlRes = await panoptoFetch(samlLoginUrl, { method: 'GET' }, jar);
        ssoUrl = samlRes.url || samlLoginUrl;
        html1 = await samlRes.text();
      }
    }

    if (!ssoUrl.includes('nidp.tau.ac.il')) {
      return false;
    }

    console.log('[Panopto][SSO] Performing silent TAU NIDP login with stored credentials...');

    // Parse initial auto-submitting form that sets up the NIDP SAML session
    const formActionMatch1 = html1.match(/<form[^>]+action=["']([^"']+)["']/i);
    if (formActionMatch1) {
      const action = decodeHTMLEntities(formActionMatch1[1]);
      ssoUrl = action.startsWith('http') ? action : new URL(action, 'https://nidp.tau.ac.il').href;

      const params = new URLSearchParams();
      const inputs = [...html1.matchAll(/<input[^>]+name=["']([^"']+)["'][^>]+value=["']([^"']*)["']/gi)];
      inputs.forEach(m => params.append(decodeHTMLEntities(m[1]), decodeHTMLEntities(m[2])));

      await panoptoFetch(
        ssoUrl,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
        },
        jar
      );
    }

    // Initiate NIDP login sequence
    await panoptoFetch(
      ssoUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'option=credential&initiateLoginSequence=true&isAjax=true',
      },
      jar
    );

    // Submit credentials
    const credBody = `option=credential&isAjax=true&Ecom_User_ID=${encodeURIComponent(creds.username)}&Ecom_User_Pid=${encodeURIComponent(creds.idNumber)}&Ecom_Password=${encodeURIComponent(creds.password)}`;
    const credRes = await panoptoFetch(
      ssoUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: credBody,
      },
      jar
    );
    const credText = await credRes.text();
    if (credText.replace(/\s/g, '').includes('"isError":true')) {
      console.warn('[Panopto][SSO] TAU NIDP rejected stored credentials.');
      return false;
    }

    // Fetch SAMLResponse assertion
    const finalSsoRes = await panoptoFetch(ssoUrl, { method: 'GET' }, jar);
    const html2 = await finalSsoRes.text();

    let samlResponse = '';
    let relayState = '';
    const finalInputs = [...html2.matchAll(/<input([^>]+)>/gi)];
    for (const m of finalInputs) {
      const nMatch = m[1].match(/name=["']([^"']+)["']/i);
      const vMatch = m[1].match(/value=["']([^"']*)["']/i);
      if (nMatch && vMatch) {
        if (nMatch[1] === 'SAMLResponse') samlResponse = decodeHTMLEntities(vMatch[1]);
        if (nMatch[1] === 'RelayState') relayState = decodeHTMLEntities(vMatch[1]);
      }
    }

    const actionMatch = html2.match(/<form[^>]+action=["']([^"']+)["']/i);
    if (!actionMatch || !samlResponse) {
      return false;
    }

    const actionUrl = decodeHTMLEntities(actionMatch[1]);
    const bodyParams = new URLSearchParams();
    bodyParams.append('SAMLResponse', samlResponse);
    if (relayState) bodyParams.append('RelayState', relayState);

    const moodleRes = await panoptoFetch(
      actionUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: bodyParams.toString(),
      },
      jar
    );

    console.log(`[Panopto][SSO] TAU NIDP + Moodle SAML session established (status=${moodleRes.status}).`);
    return moodleRes.ok;
  } catch (err) {
    console.warn('[Panopto][SSO] Silent TAU SSO login failed:', err);
    return false;
  }
}

/**
 * Ensures the Panopto session (`.ASPXAUTH` cookie on `tau.cloud.panopto.eu`) is authenticated
 * by following Panopto's Moodle/SAML SSO handshake (`Login.aspx` / `blocks/panopto/SSO.php`),
 * automatically logging into TAU SSO using stored Moodle credentials if needed.
 */
export async function ensurePanoptoAuthenticated(
  baseUrl = PANOPTO_BASE_URL,
  moodleBaseUrl = 'https://moodle.tau.ac.il',
  jar?: CookieJar | null,
  creds?: MoodleCredentials
): Promise<boolean> {
  const cleanPanopto = baseUrl.replace(/\/+$/, '');
  const cleanMoodle = moodleBaseUrl.replace(/\/+$/, '');
  let didRunCredsLogin = false;

  const ensureWebSessionOnce = async (): Promise<boolean> => {
    if (didRunCredsLogin || !creds?.username || !creds?.idNumber || !creds?.password) {
      return false;
    }
    didRunCredsLogin = true;
    return await ensureMoodleWebSessionWithCreds(cleanMoodle, creds, jar);
  };

  const followSsoChain = async (startUrl: string): Promise<boolean> => {
    try {
      let currentRes = await panoptoFetch(startUrl, { method: 'GET' }, jar);
      let currentUrl = currentRes.url || startUrl;
      let html = await currentRes.text();

      // If redirected to Moodle login or TAU NIDP login, authenticate with stored credentials and retry startUrl
      if (
        (currentUrl.includes('nidp.tau.ac.il') ||
          currentUrl.includes('/login/index.php') ||
          currentUrl.includes('/auth/saml2/login.php') ||
          /id=["']login["']|name=["']logintoken["']/i.test(html)) &&
        (await ensureWebSessionOnce())
      ) {
        currentRes = await panoptoFetch(startUrl, { method: 'GET' }, jar);
        currentUrl = currentRes.url || startUrl;
        html = await currentRes.text();
      }

      for (let hop = 0; hop < 6; hop++) {
        const form = parseAutoSubmitSsoForm(html, currentUrl);
        if (!form) break;
        currentRes = await panoptoFetch(
          form.actionUrl,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: form.params.toString(),
          },
          jar
        );
        currentUrl = currentRes.url || form.actionUrl;
        html = await currentRes.text();
      }

      return currentRes.ok && isPanoptoUrl(currentUrl);
    } catch {
      return false;
    }
  };

  // 1. Check if Panopto session (.ASPXAUTH) is already active on Home.aspx before touching SSO endpoints
  try {
    const homeRes = await panoptoFetch(`${cleanPanopto}/Panopto/Pages/Home.aspx`, { method: 'GET' }, jar);
    const homeUrl = homeRes.url || '';
    const homeHtml = await homeRes.text();
    if (
      homeRes.ok &&
      !homeUrl.includes('/Auth/Login.aspx') &&
      !/externalLoginButton|PageContentPlaceholder_loginControl/i.test(homeHtml)
    ) {
      console.log('[Panopto][SSO] Existing Panopto session is active.');
      return true;
    }
  } catch {
    // Proceed to SSO handshake
  }

  // 2. Ensure Moodle web session is active and try Moodle's Panopto block SSO endpoint
  if (creds?.username && creds?.idNumber && creds?.password) {
    await ensureWebSessionOnce();
  }

  const ssoUrl = `${cleanMoodle}/blocks/panopto/SSO.php`;
  const viaMoodleSso = await followSsoChain(ssoUrl);
  if (viaMoodleSso) {
    console.log('[Panopto][SSO] Authenticated Panopto via Moodle blocks/panopto/SSO.php');
    return true;
  }

  return false;
}

/**
 * Launches a Moodle LTI module (`mod_lti_get_tool_launch_data`) using the Moodle WebService token.
 * If the LTI endpoint belongs to Panopto, POSTs the signed OAuth launch parameters to Panopto,
 * which authenticates the `.ASPXAUTH` cookie on `tau.cloud.panopto.eu` and returns the course's
 * Panopto folder ID and/or recordings.
 */
export async function resolvePanoptoViaLti(
  token: string,
  instanceId: number,
  courseId: number,
  courseName: string,
  moodleBaseUrl = 'https://moodle.tau.ac.il',
  panoptoBaseUrl = PANOPTO_BASE_URL,
  jar?: CookieJar | null
): Promise<{ folderIds: string[]; recordings: PanoptoRecording[] }> {
  const folderIds: string[] = [];
  const recordings: PanoptoRecording[] = [];
  if (!token || !instanceId) return { folderIds, recordings };

  try {
    const wsUrl = `${moodleBaseUrl.replace(/\/+$/, '')}/webservice/rest/server.php`;
    const urlParams = new URLSearchParams({
      wstoken: token,
      wsfunction: 'mod_lti_get_tool_launch_data',
      moodlewsrestformat: 'json',
      toolid: String(instanceId),
    });

    const wsRes = await fetch(`${wsUrl}?${urlParams.toString()}`);
    if (!wsRes.ok) return { folderIds, recordings };

    const launchData = await wsRes.json();
    if (launchData?.exception || !launchData?.endpoint) {
      return { folderIds, recordings };
    }

    const endpoint = String(launchData.endpoint);
    if (!isPanoptoUrl(endpoint) && !/panopto/i.test(endpoint)) {
      return { folderIds, recordings };
    }

    const ltiParams = new URLSearchParams();
    if (Array.isArray(launchData.parameters)) {
      for (const p of launchData.parameters) {
        if (p && p.name !== undefined) {
          const paramName = String(p.name);
          const paramVal = String(p.value ?? '');
          ltiParams.append(paramName, paramVal);
          const paramFolder = extractPanoptoFolderId(paramVal);
          if (paramFolder && !folderIds.includes(paramFolder)) {
            folderIds.push(paramFolder);
          }
        }
      }
    }

    const endpointFolder = extractPanoptoFolderId(endpoint);
    if (endpointFolder && !folderIds.includes(endpointFolder)) {
      folderIds.push(endpointFolder);
    }

    // Use credentials: 'omit' in browser context so Panopto's LTI.aspx endpoint does not
    // overwrite or invalidate the browser's main SSO .ASPXAUTH cookie mid-sync
    const isBrowser =
      typeof window !== 'undefined' ||
      (typeof (globalThis as any).browser !== 'undefined' && (globalThis as any).browser.runtime) ||
      (typeof (globalThis as any).chrome !== 'undefined' && (globalThis as any).chrome.runtime);
    const ltiRes = isBrowser
      ? await fetch(endpoint, {
          method: 'POST',
          credentials: 'omit',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: ltiParams.toString(),
        })
      : await panoptoFetch(
          endpoint,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: ltiParams.toString(),
          },
          jar
        );

    if (ltiRes.url) {
      const redirectedFolder = extractPanoptoFolderId(ltiRes.url);
      if (redirectedFolder && !folderIds.includes(redirectedFolder)) {
        folderIds.push(redirectedFolder);
      }
    }

    const ltiHtml = await ltiRes.text();
    const extracted = extractPanoptoFromCourseHtml(ltiHtml, panoptoBaseUrl);
    for (const fid of extracted.folderIds) {
      if (!folderIds.includes(fid)) {
        folderIds.push(fid);
      }
    }

    const parsedHtmlRecs = parsePanoptoListHtml(ltiHtml, courseId, courseName, panoptoBaseUrl);
    recordings.push(...parsedHtmlRecs);
  } catch (err) {
    console.warn(`[Panopto] LTI launch failed for instance ${instanceId}:`, err);
  }

  return { folderIds, recordings };
}

/**
 * Queries Moodle's REST API `core_block_get_course_blocks` using the user's `wstoken`
 * to inspect the `block_panopto` side drawer ("הקלטות הקורס בשרת הוידאו Panopto") without requiring
 * a browser `MoodleSession` cookie.
 */
export async function discoverPanoptoFromMoodleBlocks(
  token: string,
  courseId: number,
  moodleBaseUrl = 'https://moodle.tau.ac.il',
  panoptoBaseUrl = PANOPTO_BASE_URL
): Promise<ExtractedCoursePanoptoLinks> {
  const folderIds: string[] = [];
  const seenFolders = new Set<string>();
  const deliveries: { id: string; title: string; recordingUrl: string }[] = [];
  const seenDeliveries = new Set<string>();

  if (!token || !courseId) return { folderIds, deliveries };

  try {
    const wsUrl = `${moodleBaseUrl.replace(/\/+$/, '')}/webservice/rest/server.php`;
    const urlParams = new URLSearchParams({
      wstoken: token,
      wsfunction: 'core_block_get_course_blocks',
      moodlewsrestformat: 'json',
      courseid: String(courseId),
      returncontents: '1',
    });

    const res = await fetch(`${wsUrl}?${urlParams.toString()}`);
    if (!res.ok) {
      console.warn(`[Panopto][Tier 2 - Moodle WS] core_block_get_course_blocks HTTP ${res.status} for course ${courseId}`);
      return { folderIds, deliveries };
    }

    const data = await res.json();
    if (data?.exception) {
      console.log(
        `[Panopto][Tier 2 - Moodle WS] core_block_get_course_blocks returned exception for course ${courseId}: ${data.errorcode || data.exception} (${data.message || ''})`
      );
      return { folderIds, deliveries };
    }

    const blocks: any[] = Array.isArray(data?.blocks) ? data.blocks : [];
    const blockNames = blocks.map(b => b?.name || 'unknown');
    console.log(
      `[Panopto][Tier 2 - Moodle WS] Course ${courseId} blocks (${blocks.length}): ${blockNames.join(', ') || 'none'}`
    );

    const mergeExtracted = (ext: ExtractedCoursePanoptoLinks) => {
      for (const fid of ext.folderIds) {
        if (!seenFolders.has(fid)) {
          seenFolders.add(fid);
          folderIds.push(fid);
        }
      }
      for (const del of ext.deliveries) {
        if (!seenDeliveries.has(del.id)) {
          seenDeliveries.add(del.id);
          deliveries.push(del);
        }
      }
    };

    for (const block of blocks) {
      const bName = String(block?.name || '').toLowerCase();
      const title = String(block?.contents?.title || '');
      const contentHtml = String(block?.contents?.content || '');
      const footerHtml = String(block?.contents?.footer || '');

      if (bName.includes('panopto')) {
        console.log(
          `[Panopto][Tier 2 - Moodle WS] Panopto block payload for course ${courseId}:`,
          JSON.stringify({
            instanceid: block?.instanceid,
            title: block?.contents?.title,
            contentLen: contentHtml.length,
            contentPreview: contentHtml.slice(0, 300),
            footerPreview: footerHtml.slice(0, 200),
            configs: block?.configs,
          })
        );
      }

      if (contentHtml) {
        mergeExtracted(extractPanoptoFromCourseHtml(contentHtml, panoptoBaseUrl));
      }
      if (footerHtml) {
        mergeExtracted(extractPanoptoFromCourseHtml(footerHtml, panoptoBaseUrl));
      }

      if (Array.isArray(block?.configs)) {
        for (const cfg of block.configs) {
          const cfgName = String(cfg?.name || '').toLowerCase();
          const cfgVal = String(cfg?.value || '');
          if (!cfgVal) continue;
          if (bName.includes('panopto') || isPanoptoModuleName(title) || cfgName.includes('panopto') || cfgName.includes('folder') || cfgName.includes('course')) {
            const fid = extractPanoptoFolderId(cfgVal);
            if (fid && !seenFolders.has(fid)) {
              seenFolders.add(fid);
              folderIds.push(fid);
            }
          }
          mergeExtracted(extractPanoptoFromCourseHtml(cfgVal, panoptoBaseUrl));
        }
      }

      if (Array.isArray(block?.contents?.files)) {
        for (const f of block.contents.files) {
          if (f?.fileurl) {
            mergeExtracted(extractPanoptoFromCourseHtml(String(f.fileurl), panoptoBaseUrl));
          }
        }
      }
    }

    if (folderIds.length > 0 || deliveries.length > 0) {
      console.log(
        `[Panopto][Tier 2 - Moodle WS] Extracted ${folderIds.length} folder(s) and ${deliveries.length} delivery link(s) from core_block_get_course_blocks for course ${courseId}`
      );
    }
  } catch (err) {
    console.warn(`[Panopto][Tier 2 - Moodle WS] Failed for course ${courseId}:`, err);
  }

  return { folderIds, deliveries };
}

/**
 * Resolves the parent Panopto folder UUID from a single video `deliveryId`
 * via Panopto's `DeliveryInfo.aspx` endpoint (mirrors `resolve_course_panopto_folders` in legacy),
 * with a fallback to `/Panopto/Api/v1/sessions/{id}`.
 */
export async function resolveFolderIdFromDelivery(
  deliveryId: string,
  baseUrl = PANOPTO_BASE_URL,
  jar?: CookieJar | null
): Promise<string | null> {
  const cleanId = extractPanoptoDeliveryId(`Viewer.aspx?id=${deliveryId}`) || deliveryId.trim().toLowerCase();
  if (!EXACT_UUID_REGEX.test(cleanId)) return null;

  const cleanBase = baseUrl.replace(/\/+$/, '');
  const url = `${cleanBase}/Panopto/Pages/Viewer/DeliveryInfo.aspx`;
  const body = new URLSearchParams({
    deliveryId: cleanId,
    isLiveNotes: 'false',
    refreshAuthCookie: 'true',
    isActiveBroadcast: 'false',
    isEditing: 'false',
    isKollectiveAgentInstalled: 'false',
    isEmbed: 'false',
    responseType: 'json',
  });

  try {
    const res = await panoptoFetch(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          Accept: 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: body.toString(),
      },
      jar
    );

    if (res.ok) {
      const data = await res.json();
      const delivery = data?.Delivery || data;
      const candidate =
        delivery?.SessionGroupPublicID ||
        delivery?.FolderId ||
        delivery?.FolderID ||
        data?.FolderId ||
        data?.FolderID ||
        data?.SessionGroupPublicID;

      if (typeof candidate === 'string' && EXACT_UUID_REGEX.test(candidate.trim())) {
        const resolved = candidate.trim().toLowerCase();
        console.log(`[Panopto][DeliveryInfo] Resolved delivery ${cleanId} -> parent folder ${resolved}`);
        return resolved;
      }
      console.warn(
        `[Panopto][DeliveryInfo] DeliveryInfo.aspx returned 200 for ${cleanId} but no SessionGroupPublicID/FolderId (keys: ${Object.keys(delivery || {}).join(', ')})`
      );
    } else {
      console.warn(`[Panopto][DeliveryInfo] DeliveryInfo.aspx HTTP ${res.status} for delivery ${cleanId}`);
    }
  } catch (err) {
    console.warn(`[Panopto][DeliveryInfo] Error calling DeliveryInfo.aspx for ${cleanId}:`, err);
  }

  return null;
}

/**
 * Fetches all recordings inside a Panopto folder via `Data.svc/GetSessions`
 * (with subfolder traversal and HTML parsing fallback),
 * then filters and deduplicates them.
 */
export async function fetchPanoptoFolderSessions(
  folderId: string,
  courseId: number,
  courseName: string,
  baseUrl = PANOPTO_BASE_URL,
  jar?: CookieJar | null,
  depth = 0
): Promise<PanoptoRecording[]> {
  const cleanFolderId = extractPanoptoFolderId(folderId);
  if (!cleanFolderId) {
    console.warn(`[Panopto] Could not extract a valid folder UUID from "${folderId}"`);
    return [];
  }

  const cleanBase = baseUrl.replace(/\/+$/, '');
  const canonicalFolderUrl = buildPanoptoFolderUrl(cleanFolderId, cleanBase);
  const apiUrl = `${cleanBase}/Panopto/Services/Data.svc/GetSessions`;

  const payload = {
    queryParameters: {
      query: null,
      sortColumn: 1,
      sortAscending: false,
      maxResults: 250,
      page: 0,
      startDate: null,
      endDate: null,
      folderID: cleanFolderId,
      bookmarked: false,
      getFolderData: true,
      isSharedWithMe: false,
      includePlaylists: true,
    },
  };

  const subfolderIds: string[] = [];

  try {
    const res = await panoptoFetch(
      apiUrl,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          Accept: 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify(payload),
      },
      jar
    );

    if (res.ok) {
      const data = await res.json();
      const resultsList: any[] = data?.d?.Results || data?.Results || [];
      const rawSubfolders: any[] = data?.d?.Subfolders || data?.Subfolders || [];
      if (Array.isArray(rawSubfolders)) {
        for (const sf of rawSubfolders) {
          const sfId = String(sf?.ID || sf?.Id || sf?.FolderID || '').trim().toLowerCase();
          if (EXACT_UUID_REGEX.test(sfId) && !subfolderIds.includes(sfId)) {
            subfolderIds.push(sfId);
          }
        }
      }

      if (Array.isArray(resultsList) && resultsList.length > 0) {
        const rawRecordings: PanoptoRecording[] = [];
        for (const item of resultsList) {
          const title = String(item.SessionName || item.Name || '').trim();
          const vidId = String(item.DeliveryID || item.SessionID || item.Id || '').trim();
          const recordingUrl =
            item.ViewerUrl ||
            item.EmbedUrl ||
            (vidId ? buildPanoptoViewerUrl(vidId, cleanBase) : buildPanoptoFolderUrl(cleanFolderId, cleanBase));
          const rawDate = item.StartTime || item.Date || item.CreatedDate || '';
          const durationSeconds = typeof item.Duration === 'number' ? item.Duration : undefined;

          rawRecordings.push({
            id: vidId || recordingUrl,
            title,
            recordingUrl,
            publishedDate: parsePanoptoDate(rawDate),
            type: classifyRecordingType(title),
            courseId,
            courseName,
            folderId: cleanFolderId,
            folderUrl: canonicalFolderUrl,
            durationSeconds,
          });
        }
        const filtered = filterAndDeduplicateRecordings(rawRecordings);
        console.log(
          `[Panopto] Data.svc/GetSessions for folder ${cleanFolderId} (${courseName}): ${resultsList.length} raw (${rawRecordings.map(r => `"${r.title}"`).join(', ')}) -> ${filtered.length} valid recordings (subfolders: ${subfolderIds.length})`
        );
        if (filtered.length > 0 && (depth > 0 || subfolderIds.length === 0)) {
          return filtered;
        }
        if (filtered.length > 0 && depth === 0 && subfolderIds.length > 0) {
          const childRecordings: PanoptoRecording[] = [...filtered];
          for (const sfId of subfolderIds.slice(0, 8)) {
            const recs = await fetchPanoptoFolderSessions(sfId, courseId, courseName, cleanBase, jar, depth + 1);
            childRecordings.push(...recs);
          }
          return filterAndDeduplicateRecordings(childRecordings);
        }
      } else {
        console.log(
          `[Panopto] Data.svc/GetSessions for folder ${cleanFolderId} (${courseName}) returned 0 direct sessions (subfolders: ${subfolderIds.length})`
        );
      }
    } else {
      console.warn(
        `[Panopto] Data.svc/GetSessions HTTP ${res.status} for folder ${cleanFolderId} (${courseName})`
      );
    }
  } catch (err) {
    console.warn(`[Panopto] Data.svc/GetSessions error for folder ${cleanFolderId}:`, err);
  }

  // Fallback 1: If the course folder organizes recordings into child subfolders (e.g. "הרצאות", "תרגולים"),
  // traverse one level of subfolders discovered via Data.svc/GetSessions
  if (depth === 0 && subfolderIds.length > 0) {
    const childRecordings: PanoptoRecording[] = [];
    for (const sfId of subfolderIds.slice(0, 8)) {
      const recs = await fetchPanoptoFolderSessions(sfId, courseId, courseName, cleanBase, jar, depth + 1);
      childRecordings.push(...recs);
    }
    if (childRecordings.length > 0) {
      return filterAndDeduplicateRecordings(childRecordings);
    }
  }

  // Fallback 2: HTML parsing of Sessions/List.aspx?folderID=... (mirrors _parse_html in legacy)
  try {
    const listUrl = `${cleanBase}/Panopto/Pages/Sessions/List.aspx?folderID=${cleanFolderId}`;
    const listRes = await panoptoFetch(listUrl, { method: 'GET' }, jar);
    if (listRes.ok) {
      const listHtml = await listRes.text();
      const parsedHtml = parsePanoptoListHtml(listHtml, courseId, courseName, cleanBase);
      if (parsedHtml.length > 0) {
        console.log(
          `[Panopto] List.aspx HTML fallback for folder ${cleanFolderId} (${courseName}): ${parsedHtml.length} recordings`
        );
        return parsedHtml;
      }
    }
  } catch {
    // Ignore HTML fallback errors
  }

  return [];
}

/**
 * Queries Moodle's `block_panopto` AJAX endpoint (`/blocks/panopto/ajax/load_panopto_block.php`)
 * using the `sesskey` extracted from the course page HTML to retrieve the dynamically rendered
 * Panopto side-drawer links (`הקלטות הקורס בשרת הוידאו Panopto`).
 */
export async function discoverPanoptoFromMoodleAjaxBlock(
  courseId: number,
  courseHtml: string,
  moodleBaseUrl = 'https://moodle.tau.ac.il',
  panoptoBaseUrl = PANOPTO_BASE_URL,
  fallbackSesskey?: string,
  jar?: CookieJar | null
): Promise<ExtractedCoursePanoptoLinks> {
  const folderIds: string[] = [];
  const deliveries: { id: string; title: string; recordingUrl: string }[] = [];

  const sesskeyMatch = courseHtml?.match(/"sesskey"\s*:\s*"([^"]+)"/i) || courseHtml?.match(/sesskey=([a-zA-Z0-9]+)/i);
  const activeSesskey = sesskeyMatch ? sesskeyMatch[1] : fallbackSesskey;
  if (!activeSesskey) {
    return { folderIds, deliveries };
  }

  const cleanMoodle = moodleBaseUrl.replace(/\/+$/, '');
  const ajaxUrl = `${cleanMoodle}/blocks/panopto/ajax/load_panopto_block.php`;

  try {
    const body = new URLSearchParams({
      sesskey: activeSesskey,
      courseid: String(courseId),
      'params[courseid]': String(courseId),
    });

    const res = await panoptoFetch(
      ajaxUrl,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: body.toString(),
      },
      jar
    );

    if (res.ok) {
      const rawText = await res.text();
      let htmlToScan = rawText;
      try {
        const parsedJson = JSON.parse(rawText);
        if (typeof parsedJson === 'string') {
          htmlToScan = parsedJson;
        } else if (parsedJson && typeof parsedJson === 'object') {
          htmlToScan = [
            parsedJson.response,
            parsedJson.content,
            parsedJson.html,
            parsedJson.result,
            JSON.stringify(parsedJson),
          ]
            .filter(Boolean)
            .join('\n');
        }
      } catch {
        // Response is raw HTML
      }

      const extracted = extractPanoptoFromCourseHtml(htmlToScan, panoptoBaseUrl);
      console.log(
        `[Panopto][Tier 2 - Block AJAX] Course ${courseId}: HTTP ${res.status} (len=${rawText.length}) -> folders=${extracted.folderIds.length}, deliveries=${extracted.deliveries.length}`
      );
      return extracted;
    } else {
      console.log(`[Panopto][Tier 2 - Block AJAX] Course ${courseId}: HTTP ${res.status} from ${ajaxUrl}`);
    }
  } catch (err) {
    console.warn(`[Panopto][Tier 2 - Block AJAX] Error for course ${courseId}:`, err);
  }

  return { folderIds, deliveries };
}

/**
 * Normalizes a TAU course code or numeric course ID into its 8-digit base course number,
 * 10-digit full group code, and `99` combined-group variant.
 */
export function normalizeTauCourseIdentifiers(courseInfo: {
  courseId?: number | string;
  courseCode?: string;
  displayName?: string;
  fullName?: string;
}): {
  full10Digits: string;
  baseCourseDigits: string;
  wildcard99Digits: string;
  dashedCourseCode: string;
  cleanTitle: string;
} {
  let rawDigits = '';

  // 1. Prefer numeric Moodle courseId directly if it is a 7-10 digit TAU course ID (e.g. 321213001 -> 0321213001)
  const idStr = courseInfo.courseId !== undefined ? String(courseInfo.courseId).trim() : '';
  if (/^\d{7,10}$/.test(idStr)) {
    rawDigits = idStr;
  }

  // 2. Otherwise extract from courseCode / displayName / fullName
  if (!rawDigits) {
    const candidates = [
      courseInfo.courseCode || '',
      courseInfo.displayName || '',
      courseInfo.fullName || '',
      idStr,
    ];

    for (const c of candidates) {
      // Match TAU course codes starting with 0 even if glued after a Hebrew numeral (e.g. "תוכנה 10368215799")
      const zeroPrefixedMatch = c.match(/(0\d{3}[-\s.]?\d{4}(?:[-\s.]?\d{2})?)/);
      if (zeroPrefixedMatch) {
        rawDigits = zeroPrefixedMatch[1].replace(/\D/g, '');
        break;
      }
      const tokenMatch = c.match(/\b(\d{4}[-\s.]?\d{4}(?:[-\s.]?\d{2})?|\d{7,10})\b/);
      if (tokenMatch) {
        rawDigits = tokenMatch[1].replace(/\D/g, '');
        break;
      }
      const allDigits = c.replace(/\D/g, '');
      if (allDigits.length >= 7) {
        rawDigits = allDigits;
        break;
      }
    }
  }

  if (rawDigits.length === 9 || rawDigits.length === 7) {
    rawDigits = `0${rawDigits}`;
  }

  const full10Digits = rawDigits.length >= 10 ? rawDigits.slice(0, 10) : '';
  const baseCourseDigits = rawDigits.length >= 8 ? rawDigits.slice(0, 8) : rawDigits;
  const wildcard99Digits = baseCourseDigits.length === 8 ? `${baseCourseDigits}99` : '';
  const dashedCourseCode =
    baseCourseDigits.length === 8
      ? `${baseCourseDigits.slice(0, 4)}-${baseCourseDigits.slice(4, 8)}`
      : '';

  const rawTitleSource = courseInfo.displayName || courseInfo.fullName || '';
  const cleanTitle = rawTitleSource
    .replace(/^.*?0?\d{3}[-\s.]?\d{4}(?:[-\s.]?\d{2})?\)?\s*[-–—:]?\s*/, '')
    .replace(/^\s*\(?0?\d[\d\-.]*\)?\s*[-–—:]?\s*/, '')
    .trim()
    .toLowerCase();

  return {
    full10Digits,
    baseCourseDigits,
    wildcard99Digits,
    dashedCourseCode,
    cleanTitle,
  };
}

/**
 * Tier 3 auto-discovery: Queries Panopto's `Data.svc/GetSessions` with the course's
 * 10-digit / 8-digit TAU course code (once authenticated via `.ASPXAUTH`), extracting
 * either the matching `FolderID` directly or resolving it from a matched session's `DeliveryID`
 * via `DeliveryInfo.aspx` (without calling unsupported `/Api/v1/` endpoints).
 */
export async function discoverCourseFolderFromBrowse(
  courseInfo: {
    courseId?: number | string;
    courseCode?: string;
    displayName?: string;
    fullName?: string;
    year?: string;
  },
  baseUrl = PANOPTO_BASE_URL,
  jar?: CookieJar | null
): Promise<string | null> {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const {
    full10Digits,
    baseCourseDigits,
    wildcard99Digits,
    dashedCourseCode,
    cleanTitle,
  } = normalizeTauCourseIdentifiers(courseInfo);

  const searchQueries = Array.from(
    new Set([full10Digits, wildcard99Digits, baseCourseDigits, dashedCourseCode, cleanTitle].filter(q => q && q.length >= 4))
  );

  const matchesCourseFolder = (folderName: string): boolean => {
    if (!folderName) return false;
    const normFolderDigits = folderName.replace(/\D/g, '');
    if (full10Digits && normFolderDigits.includes(full10Digits)) return true;
    if (wildcard99Digits && normFolderDigits.includes(wildcard99Digits)) return true;
    if (baseCourseDigits.length >= 7 && normFolderDigits.includes(baseCourseDigits)) return true;
    if (dashedCourseCode && folderName.includes(dashedCourseCode)) return true;
    if (cleanTitle.length >= 5 && folderName.toLowerCase().includes(cleanTitle)) return true;
    return false;
  };

  for (const q of searchQueries) {
    try {
      const svcUrl = `${cleanBase}/Panopto/Services/Data.svc/GetSessions`;
      const payload = {
        queryParameters: {
          query: q,
          sortColumn: 1,
          sortAscending: false,
          maxResults: 50,
          page: 0,
          startDate: null,
          endDate: null,
          folderID: null,
          bookmarked: false,
          getFolderData: true,
          isSharedWithMe: false,
          includePlaylists: true,
        },
      };
      const res = await panoptoFetch(
        svcUrl,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=UTF-8',
            Accept: 'application/json, text/javascript, */*; q=0.01',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: JSON.stringify(payload),
        },
        jar
      );
      if (!res.ok) continue;

      const data = await res.json();
      const rawSubfolders: any[] = data?.d?.Subfolders || data?.Subfolders || [];
      const rawResults: any[] = data?.d?.Results || data?.Results || [];
      const isNumericCourseQuery = /^\d{7,10}$/.test(q);

      if (Array.isArray(rawSubfolders)) {
        for (const sf of rawSubfolders) {
          const id = String(sf?.ID || sf?.Id || sf?.FolderID || '').trim().toLowerCase();
          const name = String(sf?.Name || sf?.FolderName || '').trim();
          if (EXACT_UUID_REGEX.test(id) && (isNumericCourseQuery || matchesCourseFolder(name))) {
            console.log(`[Panopto][Tier 3 - Data.svc Search] Matched subfolder "${name}" (${id}) for query="${q}"`);
            return id;
          }
        }
      }

      if (Array.isArray(rawResults) && rawResults.length > 0) {
        for (const item of rawResults) {
          const folderId = String(
            item?.FolderID || item?.FolderId || item?.SessionGroupPublicID || ''
          )
            .trim()
            .toLowerCase();
          const folderName = String(
            item?.FolderName || item?.SessionGroupLongName || item?.ContextName || ''
          ).trim();
          if (EXACT_UUID_REGEX.test(folderId) && (isNumericCourseQuery || matchesCourseFolder(folderName))) {
            console.log(
              `[Panopto][Tier 3 - Data.svc Search] Matched session folder "${folderName || q}" (${folderId}) for query="${q}"`
            );
            return folderId;
          }
        }

        // If Data.svc/GetSessions returned sessions for a numeric course code query without FolderID on the row,
        // resolve the parent folder UUID via DeliveryInfo.aspx on the first session's DeliveryID
        if (isNumericCourseQuery) {
          const firstDeliveryId = String(
            rawResults[0]?.DeliveryID || rawResults[0]?.SessionID || rawResults[0]?.Id || ''
          ).trim();
          if (firstDeliveryId) {
            const resolvedFromDelivery = await resolveFolderIdFromDelivery(firstDeliveryId, cleanBase, jar);
            if (resolvedFromDelivery) {
              console.log(
                `[Panopto][Tier 3 - Data.svc Search] Resolved folder ${resolvedFromDelivery} via DeliveryInfo for query="${q}"`
              );
              return resolvedFromDelivery;
            }
          }
        }
      }
    } catch {
      // Ignore search error and try next query
    }
  }

  return null;
}


