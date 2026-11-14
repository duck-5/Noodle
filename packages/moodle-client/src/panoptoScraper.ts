import {
  CoursePanoptoStaffEntry,
  CourseStaffMember,
  MoodleCredentials,
  PanoptoRecording,
  PanoptoRecordingType,
} from './types.js';
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
 * Extracts the Zoom / session Host name from Panopto's `SessionRow.Abstract`
 * (e.g. `Zoom Meeting ID: ...\r\n• Host: Yoav Lahini\r\n• Meeting Start: ...`),
 * with fallback to explicit host/presenter fields when present.
 */
export function extractPanoptoHostFromAbstract(
  abstractText?: unknown,
  fallbackHost?: unknown
): string | undefined {
  const decodeNumericEntities = (str: string): string =>
    decodeHTMLEntities(str)
      .replace(/&#(\d+);/g, (_, dec) => {
        const cp = Number(dec);
        return Number.isFinite(cp) ? String.fromCodePoint(cp) : _;
      })
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
        const cp = parseInt(hex, 16);
        return Number.isFinite(cp) ? String.fromCodePoint(cp) : _;
      });

  if (abstractText && typeof abstractText === 'string') {
    const cleaned = decodeNumericEntities(abstractText)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|li|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, '');
    const hostMatch = cleaned.match(
      /(?:^|\r?\n|[•|])\s*(?:[•*\-–—]\s*)?(?:Host|מארח)\s*:\s*([^\r\n•|]+)/i
    );
    if (hostMatch && hostMatch[1]) {
      const candidate = hostMatch[1].replace(/\s+/g, ' ').trim();
      if (candidate && !/^(-|n\/a|none|unknown)$/i.test(candidate)) {
        return candidate;
      }
    }
  }

  if (fallbackHost && typeof fallbackHost === 'string') {
    const candidate = decodeNumericEntities(fallbackHost).replace(/\s+/g, ' ').trim();
    if (candidate && !/^(-|n\/a|none|unknown)$/i.test(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

const PERSON_TITLE_PREFIX_REGEX = /^(?:prof\.?|professor|dr\.?|mr\.?|ms\.?|mrs\.?|פרופ['׳"]?|ד["׳']?ר|דר['׳]?|מר|גב['׳]?|גברת)\s+/i;

/**
 * Normalizes a person's display name for comparison (strips titles, parenthetical email/notes,
 * punctuation, extra whitespace, and lowercases).
 */
export function normalizePersonName(name: string): string {
  if (!name) return '';
  let cleaned = decodeHTMLEntities(name)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\([^)]*@[^)]*\)|<[^>]*@[^>]*>/g, ' ')
    .replace(/["'׳״.,/\\|\-–—]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Strip up to 2 honorific prefixes (e.g. "Prof. Dr. ...")
  for (let i = 0; i < 2; i++) {
    const next = cleaned.replace(PERSON_TITLE_PREFIX_REGEX, '').trim();
    if (next === cleaned) break;
    cleaned = next;
  }

  return cleaned.toLowerCase();
}

/**
 * Generates an editable English transliteration suggestion from a Hebrew person name
 * (e.g. "יואב לחיני" -> "Yoav Lhini", "אדם חיטין ביאלוס" -> "Adam Hitin Bialos").
 */
export function transliterateHebrewNameToEnglish(name: string): string {
  const clean = decodeHTMLEntities(name || '').replace(/["'׳״]+/g, '').trim();
  if (!clean || !/[\u0590-\u05FF]/.test(clean)) return clean;

  const words = clean.split(/\s+/).filter(Boolean);
  const mappedWords = words.map((rawWord) => {
    if (!/[\u0590-\u05FF]/.test(rawWord)) {
      return rawWord.charAt(0).toUpperCase() + rawWord.slice(1);
    }

    let out = '';
    for (let i = 0; i < rawWord.length; i++) {
      const ch = rawWord[i];
      const next = rawWord[i + 1] || '';
      const prev = rawWord[i - 1] || '';
      const isStart = i === 0;
      const isEnd = i === rawWord.length - 1;

      if (isStart && ch === 'י' && next === 'ו') {
        out += 'Yo';
        i++;
        continue;
      }
      if (isStart && ch === 'י' && next === 'א') {
        out += 'Ya';
        i++;
        continue;
      }
      if (isStart && ch === 'א' && next === 'י' && rawWord[i + 2] === 'י') {
        out += 'Ei';
        i += 2;
        continue;
      }
      if (isStart && ch === 'א' && next === 'י') {
        out += rawWord.length <= 3 ? 'E' : 'Ei';
        i++;
        continue;
      }
      if (isStart && ch === 'א' && next === 'ו') {
        out += 'O';
        i++;
        continue;
      }
      if (ch === 'ו' && next === 'ו') {
        out += isStart ? 'V' : 'v';
        i++;
        continue;
      }
      if (ch === 'י' && next === 'י') {
        out += isStart ? 'Y' : 'i';
        i++;
        continue;
      }

      switch (ch) {
        case 'א':
          out += isStart ? 'A' : prev === 'י' ? 'a' : '';
          break;
        case 'ב':
          out += isStart || prev === 'מ' || prev === 'נ' || prev === 'ל' ? 'b' : isEnd ? 'v' : 'b';
          break;
        case 'ג':
          out += 'g';
          break;
        case 'ד':
          out += 'd';
          break;
        case 'ה':
          out += isStart ? 'h' : isEnd ? 'a' : 'h';
          break;
        case 'ו':
          out += isStart ? 'v' : 'o';
          break;
        case 'ז':
          out += 'z';
          break;
        case 'ח':
          out += 'h';
          break;
        case 'ט':
        case 'ת':
          out += 't';
          break;
        case 'י':
          out += isStart ? 'y' : isEnd ? 'i' : 'i';
          break;
        case 'כ':
        case 'ך':
          out += isEnd ? 'kh' : 'k';
          break;
        case 'ל':
          out += 'l';
          break;
        case 'מ':
        case 'ם':
          out += 'm';
          break;
        case 'נ':
        case 'ן':
          out += 'n';
          break;
        case 'ס':
          out += 's';
          break;
        case 'ע':
          out += isStart ? 'a' : '';
          break;
        case 'פ':
          out += isStart ? 'p' : 'f';
          break;
        case 'ף':
          out += 'f';
          break;
        case 'צ':
        case 'ץ':
          out += 'tz';
          break;
        case 'ק':
          out += 'k';
          break;
        case 'ר':
          out += 'r';
          break;
        case 'ש':
          out += 'sh';
          break;
        default:
          out += ch;
      }
    }

    return out ? out.charAt(0).toUpperCase() + out.slice(1) : rawWord;
  });

  return mappedWords.join(' ');
}

/**
 * Converts a single normalized name token (Hebrew or Latin) into a phonetic consonant skeleton
 * so Hebrew Moodle names (e.g. "יואב לחיני") can match English Panopto hosts (e.g. "Yoav Lahini").
 */
function toPhoneticTokenSkeleton(rawToken: string): string {
  const token = rawToken.toLowerCase().trim();
  if (!token) return '';

  if (/[\u0590-\u05FF]/.test(token)) {
    let sk = '';
    for (let i = 0; i < token.length; i++) {
      const ch = token[i];
      const isStart = i === 0;
      const isEnd = i === token.length - 1;
      const next = token[i + 1] || '';

      if (isStart && (ch === 'א' || ch === 'ע')) {
        sk += 'V';
        continue;
      }
      if (ch === 'א' || ch === 'ע') continue;

      if (ch === 'ו' && next === 'ו') {
        sk += 'b'; // v/b unified
        i++;
        continue;
      }
      if (ch === 'י' && next === 'י') {
        if (isStart) sk += 'y';
        i++;
        continue;
      }

      switch (ch) {
        case 'ב':
          sk += 'b';
          break;
        case 'ג':
          sk += 'g';
          break;
        case 'ד':
          sk += 'd';
          break;
        case 'ה':
          if (!isEnd) sk += 'h';
          break;
        case 'ו':
          if (isStart) sk += 'b';
          break;
        case 'ז':
          sk += 's'; // s/z unified for names like אייזנברג / Eisenberg
          break;
        case 'ח':
          sk += 'h';
          break;
        case 'ט':
        case 'ת':
          sk += 't';
          break;
        case 'י':
          if (isStart) sk += 'y';
          break;
        case 'כ':
        case 'ך':
        case 'ק':
          sk += 'k';
          break;
        case 'ל':
          sk += 'l';
          break;
        case 'מ':
        case 'ם':
          sk += 'm';
          break;
        case 'נ':
        case 'ן':
          sk += 'n';
          break;
        case 'ס':
        case 'ש':
          sk += 's';
          break;
        case 'פ':
        case 'ף':
          sk += 'p';
          break;
        case 'צ':
        case 'ץ':
          sk += 'ts';
          break;
        case 'ר':
          sk += 'r';
          break;
        default:
          if (/[a-z0-9]/.test(ch)) sk += ch;
      }
    }
    return sk.replace(/(.)\1+/g, '$1');
  }

  // Latin token
  let sk = '';
  for (let i = 0; i < token.length; i++) {
    const ch = token[i];
    const next = token[i + 1] || '';
    const isStart = i === 0;
    const isEnd = i === token.length - 1;

    if (isStart && 'aeiou'.includes(ch)) {
      sk += 'V';
      continue;
    }
    if ('aeiou'.includes(ch)) continue;
    if (ch === 'y') {
      if (isStart) sk += 'y';
      continue;
    }
    if ((ch === 'c' || ch === 'k') && next === 'h') {
      sk += 'h';
      i++;
      continue;
    }
    if (ch === 's' && next === 'h') {
      sk += 's';
      i++;
      continue;
    }
    if ((ch === 't' || ch === 'd') && (next === 'z' || next === 's')) {
      sk += 'ts';
      i++;
      continue;
    }
    if (ch === 't' && next === 'h') {
      sk += 't';
      i++;
      continue;
    }
    if (ch === 'p' && next === 'h') {
      sk += 'p';
      i++;
      continue;
    }
    if (ch === 'c') {
      sk += 'eiy'.includes(next) ? 's' : 'k';
      continue;
    }
    if (ch === 'q' || ch === 'k') {
      sk += 'k';
      continue;
    }
    if (ch === 'v' || ch === 'w' || ch === 'b') {
      sk += 'b';
      continue;
    }
    if (ch === 'f' || ch === 'p') {
      sk += 'p';
      continue;
    }
    if (ch === 'z' || ch === 's') {
      sk += 's';
      continue;
    }
    if (ch === 'j') {
      sk += 'g';
      continue;
    }
    if (ch === 'h') {
      if (!isEnd) sk += 'h';
      continue;
    }
    if (/[a-z0-9]/.test(ch)) {
      sk += ch;
    }
  }
  return sk.replace(/(.)\1+/g, '$1');
}

function phoneticSkeletonsMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 3 && b.length >= 3 && a.replace(/k/g, 'h') === b.replace(/k/g, 'h')) {
    return true;
  }
  return false;
}

/**
 * Checks whether a Panopto Host string matches a reference person name (exact, token-order-insensitive,
 * or cross-script Hebrew<->English phonetic token match).
 */
export function doesHostMatchPersonName(
  host: string,
  candidateName: string,
  allowPhonetic = true
): boolean {
  const normHost = normalizePersonName(host);
  const normCand = normalizePersonName(candidateName);
  if (!normHost || !normCand) return false;
  if (normHost === normCand) return true;

  const hostTokens = normHost.split(/\s+/).filter(t => t.length >= 2);
  const candTokens = normCand.split(/\s+/).filter(t => t.length >= 2);
  if (hostTokens.length === 0 || candTokens.length === 0) return false;

  // Token-set match (order-insensitive, e.g. "Lahini Yoav" === "Yoav Lahini")
  const [shorter, longer] = hostTokens.length <= candTokens.length ? [hostTokens, candTokens] : [candTokens, hostTokens];
  if (shorter.every(st => longer.includes(st))) {
    return true;
  }

  if (!allowPhonetic) return false;

  const hostSkels = hostTokens.map(toPhoneticTokenSkeleton).filter(Boolean);
  const candSkels = candTokens.map(toPhoneticTokenSkeleton).filter(Boolean);
  if (hostSkels.length === 0 || candSkels.length === 0) return false;

  // Require at least 2 matching tokens (or 1 token with skeleton >= 3 chars for single-word names)
  const [shortSkels, longSkels] = hostSkels.length <= candSkels.length ? [hostSkels, candSkels] : [candSkels, hostSkels];
  if (shortSkels.length === 1 && shortSkels[0].length < 3) return false;

  return shortSkels.every(st => longSkels.some(lt => phoneticSkeletonsMatch(st, lt)));
}

export interface ClassifyRecordingOptions {
  host?: string;
  staffEntries?: CoursePanoptoStaffEntry[];
  moodleStaff?: CourseStaffMember[];
}

export interface ClassifiedRecordingResult {
  type: PanoptoRecordingType;
  source: 'staff' | 'moodle_staff' | 'title';
}

/**
 * Classifies a recording as 'Lecture' or 'Recitation' using:
 * 1. User-configured course staff mapping matched against the recording's Panopto `Host`
 * 2. Explicit title keywords (`הרצאה`/`lecture` vs `תרגול`/`recitation`/`tirgul`/`tutorial`)
 * 3. Moodle course staff phonetic match (for ambiguous titles when unconfigured)
 * 4. Default `'Lecture'`
 */
export function classifyRecordingWithSource(
  title: string,
  options?: ClassifyRecordingOptions
): ClassifiedRecordingResult {
  const host = (options?.host || '').trim();
  const staffEntries = options?.staffEntries || [];
  const moodleStaff = options?.moodleStaff || [];

  // 1. User-configured staff mapping (highest priority)
  if (host && staffEntries.length > 0) {
    // 1a. Exact / token match against explicit panoptoName first
    const exactMatches = staffEntries.filter(
      entry =>
        (entry.panoptoName && doesHostMatchPersonName(host, entry.panoptoName, false)) ||
        (entry.moodleName && doesHostMatchPersonName(host, entry.moodleName, false))
    );
    if (exactMatches.length > 0) {
      const uniqueRoles = new Set(exactMatches.map(m => m.role));
      if (uniqueRoles.size === 1) {
        return { type: exactMatches[0].role, source: 'staff' };
      }
    }

    // 1b. Phonetic match against configured entries (panoptoName or moodleName)
    const phoneticMatches = staffEntries.filter(
      entry =>
        (entry.panoptoName && doesHostMatchPersonName(host, entry.panoptoName, true)) ||
        (entry.moodleName && doesHostMatchPersonName(host, entry.moodleName, true))
    );
    if (phoneticMatches.length > 0) {
      const uniqueRoles = new Set(phoneticMatches.map(m => m.role));
      if (uniqueRoles.size === 1) {
        return { type: phoneticMatches[0].role, source: 'staff' };
      }
    }
  }

  // 2. Title keyword classification
  const lower = (title || '').toLowerCase();
  const recitationKeywords = ['tirgul', 'recitation', 'תרגול', 'תרגיל', 'tutorial'];
  for (const kw of recitationKeywords) {
    if (lower.includes(kw)) {
      return { type: 'Recitation', source: 'title' };
    }
  }

  const explicitLectureKeywords = ['הרצאה', 'lecture'];
  const hasExplicitLectureKeyword = explicitLectureKeywords.some(kw => lower.includes(kw));
  if (hasExplicitLectureKeyword) {
    return { type: 'Lecture', source: 'title' };
  }

  // 3. Fallback to Moodle-discovered course staff when title has no explicit keyword
  if (host && moodleStaff.length > 0) {
    const moodleMatches = moodleStaff.filter(
      member =>
        (member.englishName && doesHostMatchPersonName(host, member.englishName, true)) ||
        doesHostMatchPersonName(host, member.fullName, true)
    );
    if (moodleMatches.length > 0) {
      const uniqueRoles = new Set(moodleMatches.map(m => m.role));
      if (uniqueRoles.size === 1) {
        return { type: moodleMatches[0].role, source: 'moodle_staff' };
      }
    }
  }

  return { type: 'Lecture', source: 'title' };
}

/**
 * Classifies a recording as 'Recitation' or 'Lecture' based on optional host/staff mapping
 * and Hebrew/English title keywords.
 */
export function classifyRecordingType(
  title: string,
  options?: ClassifyRecordingOptions
): 'Lecture' | 'Recitation' {
  return classifyRecordingWithSource(title, options).type;
}

/**
 * Returns true if the recording's extracted Panopto `Host` matches at least one
 * configured lecturer / TA entry (exact or cross-script phonetic match).
 */
export function doesRecordingMatchStaffEntries(
  rec: Pick<PanoptoRecording, 'host'>,
  staffEntries?: CoursePanoptoStaffEntry[]
): boolean {
  const host = (rec.host || '').trim();
  if (!host || !staffEntries || staffEntries.length === 0) return false;
  return staffEntries.some(
    (entry) =>
      (entry.panoptoName && doesHostMatchPersonName(host, entry.panoptoName, true)) ||
      (entry.moodleName && doesHostMatchPersonName(host, entry.moodleName, true))
  );
}

export interface PartitionedPanoptoRecordings {
  visible: PanoptoRecording[];
  hidden: PanoptoRecording[];
  isFilteringActive: boolean;
}

/**
 * Partitions a course's recordings into exclusively visible recordings (matching
 * user-picked lecturers/TAs) and hidden recordings. When no lecturers/TAs are
 * configured (`staffEntries` empty), nothing is hidden.
 */
export function partitionPanoptoRecordingsByTrackedHosts(
  recordings: PanoptoRecording[],
  staffEntries?: CoursePanoptoStaffEntry[]
): PartitionedPanoptoRecordings {
  if (!staffEntries || staffEntries.length === 0) {
    return {
      visible: recordings,
      hidden: [],
      isFilteringActive: false,
    };
  }

  const visible: PanoptoRecording[] = [];
  const hidden: PanoptoRecording[] = [];
  for (const rec of recordings) {
    if (doesRecordingMatchStaffEntries(rec, staffEntries)) {
      visible.push(rec);
    } else {
      hidden.push(rec);
    }
  }
  return {
    visible,
    hidden,
    isFilteringActive: true,
  };
}

/**
 * Toggles a recording's Panopto host in the configured staff entries for a course.
 * When adding a host, assigns `recordingType` ('Lecture' or 'Recitation') and
 * attaches a matching `moodleName` when discovered in cached Moodle staff.
 */
export function toggleTrackedHostEntry(
  entries: CoursePanoptoStaffEntry[],
  hostName: string,
  recordingType: PanoptoRecordingType,
  moodleStaff?: CourseStaffMember[]
): CoursePanoptoStaffEntry[] {
  const trimmedHost = (hostName || '').trim();
  if (!trimmedHost) return entries;

  const isAlreadyTracked = entries.some(
    (e) =>
      (e.panoptoName && doesHostMatchPersonName(trimmedHost, e.panoptoName, true)) ||
      (e.moodleName && doesHostMatchPersonName(trimmedHost, e.moodleName, true))
  );

  if (isAlreadyTracked) {
    return entries.filter(
      (e) =>
        !(e.panoptoName && doesHostMatchPersonName(trimmedHost, e.panoptoName, true)) &&
        !(e.moodleName && doesHostMatchPersonName(trimmedHost, e.moodleName, true))
    );
  }

  const matchedMoodle = (moodleStaff || []).find(
    (m) =>
      (m.englishName && doesHostMatchPersonName(trimmedHost, m.englishName, true)) ||
      doesHostMatchPersonName(trimmedHost, m.fullName, true)
  );

  const nextEntry: CoursePanoptoStaffEntry = {
    ...(matchedMoodle?.fullName ? { moodleName: matchedMoodle.fullName } : {}),
    panoptoName: trimmedHost,
    role: recordingType,
  };
  return [...entries, nextEntry];
}

/**
 * Re-classifies cached Panopto recordings in-memory when user-configured course staff mappings
 * are edited, without requiring a full network re-sync.
 */
export function reclassifyPanoptoRecordings(
  recordings: PanoptoRecording[],
  coursesPanoptoStaff?: Record<number, CoursePanoptoStaffEntry[]>,
  courseStaffMap?: Record<number, CourseStaffMember[]>,
  courseIdAliases?: Map<number, number[]>
): PanoptoRecording[] {
  if (!Array.isArray(recordings) || recordings.length === 0) return recordings;

  return recordings.map((rec) => {
    const candidateIds = new Set<number>([rec.courseId]);
    if (rec.sourceCourseId) candidateIds.add(rec.sourceCourseId);
    const aliases = courseIdAliases?.get(rec.courseId);
    if (aliases) aliases.forEach(id => candidateIds.add(id));

    const staffEntries: CoursePanoptoStaffEntry[] = [];
    const moodleStaff: CourseStaffMember[] = [];
    for (const cid of candidateIds) {
      const configured =
        coursesPanoptoStaff?.[cid] ??
        (coursesPanoptoStaff as Record<string, CoursePanoptoStaffEntry[]> | undefined)?.[String(cid)];
      if (Array.isArray(configured)) staffEntries.push(...configured);

      const discovered =
        courseStaffMap?.[cid] ??
        (courseStaffMap as Record<string, CourseStaffMember[]> | undefined)?.[String(cid)];
      if (Array.isArray(discovered)) moodleStaff.push(...discovered);
    }

    const classified = classifyRecordingWithSource(rec.title, {
      host: rec.host,
      staffEntries,
      moodleStaff,
    });

    return {
      ...rec,
      type: classified.type,
      classificationSource: classified.source,
      sectionName: classified.type === 'Recitation' ? 'Recitations' : 'Lectures',
    };
  });
}

/**
 * Maps a Moodle role shortname/label to 'Lecture' (Teacher/Lecturer) or 'Recitation' (TA),
 * or returns null for non-staff roles (Student, Guest, etc.).
 */
export function parseCourseStaffRole(
  roleShortname?: string,
  roleName?: string
): PanoptoRecordingType | null {
  const combined = `${roleShortname || ''} ${roleName || ''}`.toLowerCase().trim();
  if (!combined) return null;

  // Check Teaching Assistant / Recitation roles FIRST so "teaching assistant" / "non-editing teacher"
  // is never misclassified by the generic "teacher" / "מורה" substring.
  if (
    /non[-_\s]*editing\s*teacher|noneditingteacher|teaching[_\s-]*assistant|assistant|tutor|practitioner|recitation|מורה\s+(?:ללא\s+הרשאות\s+עריכה|ללא\s+עריכה|שאינ[וה]\s+עור[ךכ]|לא\s+עור[ךכ])|מתרגל|מתרגלת|עוזר[ת]?\s*הוראה|מדריך|מדריכה|\bta\b/i.test(
      combined
    )
  ) {
    return 'Recitation';
  }

  if (
    /editingteacher|\bteacher\b|lecturer|instructor|professor|coordinator|coursecreator|מרצה|מורה|רכז|רכזת/i.test(
      combined
    )
  ) {
    return 'Lecture';
  }

  return null;
}

/**
 * Extracts Hebrew and English spans from a Moodle multilang string if present,
 * or cleans plain text.
 */
export function extractMultilangPersonNames(raw: string): { primary: string; english?: string } {
  if (!raw) return { primary: '' };
  const strippedInitials = raw.replace(
    /<span[^>]*class=["'][^"']*userinitials[^"']*["'][^>]*>[\s\S]*?<\/span>/gi,
    ' '
  );

  if (/class=["'][^"']*multilang/i.test(strippedInitials)) {
    const heMatch = strippedInitials.match(/<span[^>]*\blang=["']he(?:[_-][^"']*)?["'][^>]*>([\s\S]*?)<\/span>/i);
    const enMatch = strippedInitials.match(/<span[^>]*\blang=["']en(?:[_-][^"']*)?["'][^>]*>([\s\S]*?)<\/span>/i);
    const cleanHe = heMatch ? decodeHTMLEntities(heMatch[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim() : '';
    const cleanEn = enMatch ? decodeHTMLEntities(enMatch[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim() : '';
    if (cleanHe || cleanEn) {
      return {
        primary: cleanHe || cleanEn,
        english: cleanEn && cleanEn !== cleanHe ? cleanEn : undefined,
      };
    }
  }

  if (/\{mlang\s+/i.test(strippedInitials)) {
    const heMatch = strippedInitials.match(/\{mlang\s+he(?:[_-][^}\s]*)?\}([\s\S]*?)\{mlang\}/i);
    const enMatch = strippedInitials.match(/\{mlang\s+en(?:[_-][^}\s]*)?\}([\s\S]*?)\{mlang\}/i);
    const cleanHe = heMatch ? decodeHTMLEntities(heMatch[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim() : '';
    const cleanEn = enMatch ? decodeHTMLEntities(enMatch[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim() : '';
    if (cleanHe || cleanEn) {
      return {
        primary: cleanHe || cleanEn,
        english: cleanEn && cleanEn !== cleanHe ? cleanEn : undefined,
      };
    }
  }

  const plain = decodeHTMLEntities(strippedInitials.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
  return { primary: plain };
}

interface ParsedTableCell {
  tag: 'td' | 'th';
  colIndex: number;
  span: number;
  fullHtml: string;
  innerHtml: string;
}

const ROLES_HEADER_REGEX = /\broles?\b|תפקיד(?:ים)?/i;
const NON_STAFF_ROLE_ONLY_REGEX =
  /^(?:students?|סטודנט(?:ים|ית)?|תלמיד(?:ה|ים)?|guests?|אורח(?:ת|ים)?|auditors?|מאזין(?:ים|ה)?|no\s+roles?|אין\s+תפקיד(?:ים)?|participants?|משתתף(?:ת|ים)?|authenticated\s+users?|משתמש(?:ת|ים)?\s+מאומת(?:ת|ים)?|none|[-–—]+)$/i;
const NON_ROLE_CELL_TEXT_REGEX =
  /\b(?:no\s+groups?|groups?|tutor\s+group|tutorial\s+group|(?:recitation|tutorial|tirgul|lecture|lab|section|seminar|tutor(?:ing)?|ta|assistant|lecturer)\s*[#:\-–—]?\s*(?:\d+|[a-z]\b)|never|now|active|suspended|\d+\s*(?:secs?|seconds?|mins?|minutes?|hours?|days?|weeks?|months?|years?))\b|^\s*(?:(?:recitation|tutorial|tirgul|lecture|lab|section|seminar)\b|(?:תרגול|הרצאה|מעבדה)(?=$|[\s,/\-|()[\]"':\d]))(?![^,]*(?:\b(?:teacher|assistant|ta|instructor|tutor|lecturer|coordinator|practitioner)\b|מורה|מתרגל|עוזר|מרצה|מדריך|רכז))|(?:^|[\s"'(\[])(?:קבוצ(?:ה|ות|ת)|אין\s+קבוצות|אף\s+פעם|גישה\s+אחרונה|תרגול\s*[#:\-–—]?\s*(?:\d+|[א-ת](?:\s|$))|הרצאה\s*[#:\-–—]?\s*(?:\d+|[א-ת](?:\s|$))|מעבדה\s*[#:\-–—]?\s*(?:\d+|[א-ת](?:\s|$)))|(?:לפני|שניות|דקות|שעות|שעתיים|ימים|יומיים|חודשים|פעיל|מושעה)/i;

function extractParticipantsScopeHtml(rawHtml: string): string {
  const html = rawHtml.replace(/<!--[\s\S]*?-->/g, '');
  const idMatch = html.match(
    /<table\b[^>]*id=["'][^"']*participants[^"']*["'][^>]*>([\s\S]*?)<\/table>/i
  );
  if (idMatch) return idMatch[1];

  const tableRegex = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch: RegExpExecArray | null;
  while ((tableMatch = tableRegex.exec(html)) !== null) {
    if (/\/user\/(?:view|profile)\.php\?/i.test(tableMatch[1])) {
      return tableMatch[1];
    }
  }

  return html;
}

function extractRowCells(rowHtml: string): ParsedTableCell[] {
  const cells: ParsedTableCell[] = [];
  const cellRegex = /<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  let colIndex = 0;

  while ((match = cellRegex.exec(rowHtml)) !== null) {
    const tag = match[1].toLowerCase() as 'td' | 'th';
    const attrs = match[2] || '';
    const innerHtml = match[3] || '';
    const colspanMatch = attrs.match(/\bcolspan\s*=\s*["']?(\d+)["']?/i);
    const span = colspanMatch ? Math.max(1, parseInt(colspanMatch[1], 10)) : 1;

    cells.push({
      tag,
      colIndex,
      span,
      fullHtml: match[0],
      innerHtml,
    });
    colIndex += span;
  }

  return cells;
}

function stripCellText(html: string): string {
  return decodeHTMLEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parses Moodle's `/user/index.php` Participants table HTML (including dynamic table AJAX HTML)
 * and returns only Teachers (Lecturers) and Teaching Assistants.
 */
export function parseParticipantsHtml(html: string): CourseStaffMember[] {
  if (!html) return [];
  const staff: CourseStaffMember[] = [];
  const seenKeys = new Set<string>();

  const scopeHtml = extractParticipantsScopeHtml(html);
  const tbodyMatches = [...scopeHtml.matchAll(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/gi)];
  const rowsHtml = tbodyMatches.length > 0 ? tbodyMatches.map((m) => m[1]).join('\n') : scopeHtml;

  // Locate the Roles column index when <thead> or a header <tr>...<th> row is present
  let hasHeaderRow = false;
  let rolesColIndex = -1;

  const findRolesColIndexInHeaderHtml = (headerHtml: string): { foundHeader: boolean; rolesIdx: number } => {
    const headerTrRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let headerTrMatch: RegExpExecArray | null;
    let foundHeader = false;
    let rolesIdx = -1;

    while ((headerTrMatch = headerTrRegex.exec(headerHtml)) !== null) {
      const cells = extractRowCells(headerTrMatch[1]);
      if (cells.length === 0) continue;
      foundHeader = true;

      for (const cell of cells) {
        const headerText = stripCellText(cell.innerHtml);
        if (ROLES_HEADER_REGEX.test(headerText)) {
          rolesIdx = cell.colIndex;
          break;
        }
      }
      if (rolesIdx !== -1) break;
    }

    return { foundHeader, rolesIdx };
  };

  const theadMatch = scopeHtml.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/i);
  if (theadMatch) {
    const theadInfo = findRolesColIndexInHeaderHtml(theadMatch[1]);
    hasHeaderRow = theadInfo.foundHeader;
    rolesColIndex = theadInfo.rolesIdx;
  }

  if (!hasHeaderRow) {
    const headerScanRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let headerScanMatch: RegExpExecArray | null;
    while ((headerScanMatch = headerScanRegex.exec(scopeHtml)) !== null) {
      const candidateRowHtml = headerScanMatch[1];
      if (/\/user\/(?:view|profile)\.php\?/i.test(candidateRowHtml)) continue;
      if (/<th\b[^>]*scope=["']row["']/i.test(candidateRowHtml)) continue;
      const cells = extractRowCells(candidateRowHtml);
      const thCount = cells.filter(c => c.tag === 'th').length;
      const hasColScope = /<th\b[^>]*scope=["']col["']/i.test(candidateRowHtml);
      const allTh = cells.length >= 2 && thCount === cells.length;
      if (thCount > 0 && (hasColScope || allTh || thCount >= 2)) {
        hasHeaderRow = true;
        for (const cell of cells) {
          if (ROLES_HEADER_REGEX.test(stripCellText(cell.innerHtml))) {
            rolesColIndex = cell.colIndex;
            break;
          }
        }
        break;
      }
    }
  }

  const trRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch: RegExpExecArray | null;

  while ((trMatch = trRegex.exec(rowsHtml)) !== null) {
    const rowHtml = trMatch[1];
    if (/<th\b[^>]*scope=["']col["']/i.test(rowHtml)) continue;

    // Extract user link (name + userId)
    const userAnchorMatch = rowHtml.match(
      /<a\b[^>]*href=["'][^"']*\/user\/(?:view|profile)\.php\?[^"']*\bid=(\d+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/i
    );
    if (!userAnchorMatch) continue;

    const userId = Number(userAnchorMatch[1]);
    const names = extractMultilangPersonNames(userAnchorMatch[2]);
    if (!names.primary) continue;

    const cells = extractRowCells(rowHtml);
    const nonUserCells = cells.filter(c => !/\/user\/(?:view|profile)\.php\?/i.test(c.innerHtml));
    const explicitRoleCells = nonUserCells.filter(c => /\bdata-itemtype=["']roles["']/i.test(c.fullHtml));

    let cellsToInspect: ParsedTableCell[] = [];
    if (hasHeaderRow) {
      if (rolesColIndex !== -1) {
        const colCell = nonUserCells.find(
          c => c.colIndex <= rolesColIndex && rolesColIndex < c.colIndex + c.span
        );
        if (colCell) {
          cellsToInspect = [colCell];
        }
        for (const roleCell of explicitRoleCells) {
          if (!cellsToInspect.includes(roleCell)) {
            cellsToInspect.push(roleCell);
          }
        }
      } else if (explicitRoleCells.length > 0) {
        cellsToInspect = explicitRoleCells;
      }
    } else if (explicitRoleCells.length > 0) {
      cellsToInspect = explicitRoleCells;
    } else {
      // Headerless table fragment without data-itemtype="roles": exclude non-role cells (groups, access, emails, user cell)
      const candidateCells = nonUserCells.filter(c => {
        if (c.tag !== 'td') return false;
        if (/\bdata-itemtype=["'](?!roles["'])[^"']+["']/i.test(c.fullHtml)) return false;
        const text = stripCellText(c.innerHtml);
        if (!text) return false;
        if (text.includes('@')) return false;
        if (NON_ROLE_CELL_TEXT_REGEX.test(text)) return false;
        return true;
      });

      const hasPureNonStaffRoleCell = candidateCells.some(c => {
        const text = stripCellText(c.innerHtml);
        const parts = text.split(/[,/\n|]+/).map(s => s.trim()).filter(Boolean);
        return (
          parts.length > 0 &&
          parts.every(p => NON_STAFF_ROLE_ONLY_REGEX.test(p)) &&
          parts.every(p => parseCourseStaffRole(undefined, p) === null)
        );
      });

      cellsToInspect = hasPureNonStaffRoleCell ? [] : candidateCells;
    }

    let detectedRole: PanoptoRecordingType | null = null;
    let rawRoleText = '';

    for (const cell of cellsToInspect) {
      const cellText = stripCellText(cell.innerHtml);
      if (!cellText) continue;

      const roleParts = cellText.split(/[,/\n|]+/).map(s => s.trim()).filter(Boolean);
      for (const part of roleParts) {
        const parsed = parseCourseStaffRole(undefined, part);
        if (parsed) {
          // Prefer Lecture if both somehow appear, otherwise take first staff role
          if (!detectedRole || parsed === 'Lecture') {
            detectedRole = parsed;
            rawRoleText = part;
          }
        }
      }
    }

    if (!detectedRole) continue;

    const dedupKey = userId > 0 ? `id:${userId}` : `name:${normalizePersonName(names.primary)}`;
    if (seenKeys.has(dedupKey)) continue;
    seenKeys.add(dedupKey);

    staff.push({
      userId: userId > 0 ? userId : undefined,
      fullName: names.primary,
      ...(names.english ? { englishName: names.english } : {}),
      role: detectedRole,
      rawRole: rawRoleText || undefined,
    });
  }

  return staff;
}

/**
 * Fetches Teachers and Teaching Assistants from Moodle's Participants page (`/user/index.php?id={courseId}`)
 * with Moodle 4.x `core_table_get_dynamic_table_content` AJAX fallback when the table is dynamically rendered.
 */
export async function fetchCourseStaffFromParticipantsPage(
  courseId: number,
  courseBaseUrl = 'https://moodle.tau.ac.il',
  fallbackSesskey?: string,
  jar?: CookieJar | null,
  creds?: MoodleCredentials
): Promise<CourseStaffMember[]> {
  if (!courseId || courseId <= 0) return [];
  const cleanMoodle = courseBaseUrl.replace(/\/+$/, '');
  const participantsUrl = `${cleanMoodle}/user/index.php?id=${courseId}&perpage=5000`;

  const extractFromPage = async (pageHtml: string): Promise<CourseStaffMember[]> => {
    const ssrStaff = parseParticipantsHtml(pageHtml);

    // Check if Moodle 4.x dynamic table needs an AJAX query (e.g., paginated or empty SSR tbody)
    const handlerMatch = pageHtml.match(/data-table-handler=["']([^"']+)["']/i);
    const uniqueIdMatch = pageHtml.match(/data-table-uniqueid=["']([^"']+)["']/i);
    const sesskeyMatch =
      pageHtml.match(/"sesskey"\s*:\s*"([^"]+)"/i) || pageHtml.match(/sesskey=([a-zA-Z0-9]+)/i);
    const activeSesskey = sesskeyMatch ? sesskeyMatch[1] : fallbackSesskey;

    if (handlerMatch && uniqueIdMatch && activeSesskey) {
      try {
        const ajaxUrl = `${cleanMoodle}/lib/ajax/service.php?sesskey=${encodeURIComponent(
          activeSesskey
        )}&info=core_table_get_dynamic_table_content`;

        const filtersAttrMatch = pageHtml.match(/data-table-filters=["']([^"']+)["']/i);
        let baseFilters: Record<string, any> = {
          courseid: { name: 'courseid', jointype: 1, values: [courseId] },
        };
        if (filtersAttrMatch) {
          try {
            const parsed = JSON.parse(decodeHTMLEntities(filtersAttrMatch[1]));
            if (parsed && typeof parsed === 'object') {
              baseFilters = parsed;
            }
          } catch {
            // keep default courseid filter
          }
        }

        const ajaxRes = await panoptoFetch(
          ajaxUrl,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify([
              {
                index: 0,
                methodname: 'core_table_get_dynamic_table_content',
                args: {
                  component: 'core_user',
                  handler: handlerMatch[1],
                  uniqueid: uniqueIdMatch[1],
                  sortdata: [],
                  filters: baseFilters,
                  jointype: 2,
                  firstinitial: '',
                  lastinitial: '',
                  page: 0,
                  pagesize: 5000,
                  hiddencolumns: [],
                  resetpreferences: false,
                },
              },
            ]),
          },
          jar
        );

        if (ajaxRes.ok) {
          const json = await ajaxRes.json();
          const dynamicHtml = json?.[0]?.data?.html;
          if (typeof dynamicHtml === 'string' && dynamicHtml.length > 0) {
            const dynamicStaff = parseParticipantsHtml(dynamicHtml);
            if (dynamicStaff.length >= ssrStaff.length && dynamicStaff.length > 0) {
              return dynamicStaff;
            }
          }
        }
      } catch {
        // Fallback to SSR results
      }
    }

    return ssrStaff;
  };

  try {
    let res = await panoptoFetch(participantsUrl, { method: 'GET' }, jar);
    let html = await res.text();
    let landedUrl = res.url || participantsUrl;

    if (
      (landedUrl.includes('nidp.tau.ac.il') ||
        landedUrl.includes('/login/index.php') ||
        landedUrl.includes('/auth/saml2/login.php') ||
        /id=["']login["']|name=["']logintoken["']/i.test(html)) &&
      creds?.username &&
      creds?.idNumber &&
      creds?.password
    ) {
      const rootMoodle = cleanMoodle.replace(/\/\d{4}$/, '');
      const ok = await ensureMoodleWebSessionWithCreds(rootMoodle, creds, jar);
      if (ok) {
        res = await panoptoFetch(participantsUrl, { method: 'GET' }, jar);
        html = await res.text();
      }
    }

    if (!res.ok) return [];

    let staff = await extractFromPage(html);

    // If Moodle is rendered in English and multilang-filtered Hebrew-only staff names disappeared,
    // temporarily query with &lang=he and restore &lang=en so the user's Moodle session stays in English.
    if (staff.length === 0 && /<html[^>]*\blang=["']en/i.test(html)) {
      try {
        const heRes = await panoptoFetch(`${participantsUrl}&lang=he`, { method: 'GET' }, jar);
        if (heRes.ok) {
          const heHtml = await heRes.text();
          staff = await extractFromPage(heHtml);
        }
      } finally {
        await panoptoFetch(`${cleanMoodle}/my/?lang=en`, { method: 'GET' }, jar).catch(() => {});
      }
    }

    return staff;
  } catch (err) {
    console.warn(`[Panopto][Staff] Failed to fetch participants page for course ${courseId}:`, err);
    return [];
  }
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
export function filterAndDeduplicateRecordings(
  recordings: PanoptoRecording[],
  classificationOptions?: ClassifyRecordingOptions
): PanoptoRecording[] {
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

    const classified =
      rec.type && rec.classificationSource
        ? { type: rec.type, source: rec.classificationSource }
        : classifyRecordingWithSource(rec.title, {
            ...classificationOptions,
            host: rec.host,
          });

    const normalized: PanoptoRecording = {
      ...rec,
      title: rec.title.trim(),
      publishedDate: parsePanoptoDate(rec.publishedDate) || rec.publishedDate || '',
      type: rec.type || classified.type,
      classificationSource: rec.classificationSource || classified.source,
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
  depth = 0,
  classificationOptions?: ClassifyRecordingOptions
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
          const host = extractPanoptoHostFromAbstract(
            item.Abstract ?? item.Description,
            item.Host ?? item.HostName ?? item.Presenter ?? item.Creator
          );
          const classified = classifyRecordingWithSource(title, {
            ...classificationOptions,
            host,
          });

          rawRecordings.push({
            id: vidId || recordingUrl,
            title,
            recordingUrl,
            publishedDate: parsePanoptoDate(rawDate),
            type: classified.type,
            host,
            classificationSource: classified.source,
            courseId,
            courseName,
            folderId: cleanFolderId,
            folderUrl: canonicalFolderUrl,
            durationSeconds,
          });
        }
        const filtered = filterAndDeduplicateRecordings(rawRecordings, classificationOptions);
        console.log(
          `[Panopto] Data.svc/GetSessions for folder ${cleanFolderId} (${courseName}): ${resultsList.length} raw (${rawRecordings.map(r => `"${r.title}"`).join(', ')}) -> ${filtered.length} valid recordings (subfolders: ${subfolderIds.length})`
        );
        if (filtered.length > 0 && (depth > 0 || subfolderIds.length === 0)) {
          return filtered;
        }
        if (filtered.length > 0 && depth === 0 && subfolderIds.length > 0) {
          const childRecordings: PanoptoRecording[] = [...filtered];
          for (const sfId of subfolderIds.slice(0, 8)) {
            const recs = await fetchPanoptoFolderSessions(
              sfId,
              courseId,
              courseName,
              cleanBase,
              jar,
              depth + 1,
              classificationOptions
            );
            childRecordings.push(...recs);
          }
          return filterAndDeduplicateRecordings(childRecordings, classificationOptions);
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
      const recs = await fetchPanoptoFolderSessions(
        sfId,
        courseId,
        courseName,
        cleanBase,
        jar,
        depth + 1,
        classificationOptions
      );
      childRecordings.push(...recs);
    }
    if (childRecordings.length > 0) {
      return filterAndDeduplicateRecordings(childRecordings, classificationOptions);
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
        return filterAndDeduplicateRecordings(
          parsedHtml.map((rec) => {
            const classified = classifyRecordingWithSource(rec.title, {
              ...classificationOptions,
              host: rec.host,
            });
            return {
              ...rec,
              type: classified.type,
              classificationSource: classified.source,
            };
          }),
          classificationOptions
        );
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


