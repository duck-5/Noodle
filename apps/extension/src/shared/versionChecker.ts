export type StoreTarget = 'chrome' | 'firefox';

export const CHROME_EXTENSION_ID = 'nelflkccefbdpnaphjabcgkpakhdoope';
export const CHROME_STORE_URL = `https://chromewebstore.google.com/detail/noodle/${CHROME_EXTENSION_ID}`;
export const CHROME_STORE_CHECK_URL = `${CHROME_STORE_URL}?hl=en`;
export const CHROME_CRX_UPDATE_URL =
  `https://clients2.google.com/service/update2/crx?response=updatecheck&prodversion=131.0.0.0&acceptformat=crx2,crx3&x=id%3D${CHROME_EXTENSION_ID}%26uc`;

export const FIREFOX_ADDON_SLUG = 'noodle';
export const FIREFOX_STORE_URL = `https://addons.mozilla.org/en-US/firefox/addon/${FIREFOX_ADDON_SLUG}/`;
export const FIREFOX_AMO_API_URL = `https://addons.mozilla.org/api/v5/addons/addon/${FIREFOX_ADDON_SLUG}/`;

export const VERSION_CHECK_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
export const VERSION_CHECK_TIMEOUT_MS = 7000;

export type FetchLike = (input: string, init?: RequestInit) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}>;

export interface StoreVersionCheckResult {
  store: StoreTarget;
  storeUrl: string;
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  checkedAt: number;
  checkedForVersion: string;
  source?: string;
}

/**
 * Extracts a normalized dotted numeric version string (e.g., "4.0.2") from inputs like "v4.0.2".
 */
export function normalizeVersion(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/^v/i, '');
  const match = trimmed.match(/^(\d+(?:\.\d+)*)$/);
  return match ? match[1] : null;
}

/**
 * Compares two dotted numeric version strings segment by segment.
 * Returns > 0 when a > b, < 0 when a < b, and 0 when numerically equal.
 */
export function compareVersions(a: string, b: string): number {
  const normA = normalizeVersion(a);
  const normB = normalizeVersion(b);
  if (!normA && !normB) return 0;
  if (!normA) return -1;
  if (!normB) return 1;

  const partsA = normA.split('.').map((n) => parseInt(n, 10));
  const partsB = normB.split('.').map((n) => parseInt(n, 10));
  const len = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < len; i++) {
    const numA = partsA[i] ?? 0;
    const numB = partsB[i] ?? 0;
    if (numA > numB) return 1;
    if (numA < numB) return -1;
  }
  return 0;
}

export function getStoreTarget(isFirefox: boolean): { store: StoreTarget; storeUrl: string } {
  return isFirefox
    ? { store: 'firefox', storeUrl: FIREFOX_STORE_URL }
    : { store: 'chrome', storeUrl: CHROME_STORE_URL };
}

/**
 * Extracts extension version from Chrome Web Store detail HTML (`?hl=en`).
 */
export function parseChromeWebStoreHtmlVersion(html: string): string | null {
  if (!html || typeof html !== 'string') return null;

  const patterns: RegExp[] = [
    // Modern Chrome Web Store details grid: <div>Version</div><div class="...">4.0.2</div>
    />\s*Version\s*<\/div>\s*<div[^>]*>\s*v?(\d+(?:\.\d+)+)\s*<\/div>/i,
    // Generic nested element following "Version" label within the details pane
    />\s*Version\s*<[\s\S]{0,160}?>\s*v?(\d+\.\d+(?:\.\d+)*)\s*</i,
    // Schema.org meta softwareVersion
    /<meta[^>]+itemprop=["']softwareVersion["'][^>]+content=["']v?(\d+(?:\.\d+)+)["']/i,
    /<meta[^>]+content=["']v?(\d+(?:\.\d+)+)["'][^>]+itemprop=["']softwareVersion["']/i,
  ];

  for (const regex of patterns) {
    const match = html.match(regex);
    if (match?.[1]) {
      const normalized = normalizeVersion(match[1]);
      if (normalized) return normalized;
    }
  }
  return null;
}

/**
 * Extracts extension version from Google Omaha CRX updatecheck XML response.
 */
export function parseChromeCrxUpdateXmlVersion(xml: string): string | null {
  if (!xml || typeof xml !== 'string') return null;
  const match = xml.match(/<updatecheck[^>]*\bversion=["']v?(\d+(?:\.\d+)+)["']/i);
  if (!match?.[1]) return null;
  const normalized = normalizeVersion(match[1]);
  if (!normalized || normalized === '0.0.0.0') return null;
  return normalized;
}

/**
 * Extracts current published version from Mozilla AMO v5 JSON API payload.
 */
export function parseAmoApiVersion(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const currentVersion = (payload as { current_version?: { version?: unknown } }).current_version;
  if (!currentVersion || typeof currentVersion.version !== 'string') return null;
  return normalizeVersion(currentVersion.version);
}

/**
 * Fallback parser for AMO add-on HTML listing page.
 */
export function parseAmoHtmlVersion(html: string): string | null {
  if (!html || typeof html !== 'string') return null;
  const patterns: RegExp[] = [
    /<dd[^>]*AddonMoreInfo-version[^>]*>\s*v?(\d+(?:\.\d+)+)\s*<\/dd>/i,
    /"current_version"\s*:\s*\{[\s\S]{0,240}?"version"\s*:\s*"v?(\d+(?:\.\d+)+)"/i,
    />\s*Version\s*<\/dt>\s*<dd[^>]*>\s*v?(\d+(?:\.\d+)+)\s*<\/dd>/i,
  ];
  for (const regex of patterns) {
    const match = html.match(regex);
    if (match?.[1]) {
      const normalized = normalizeVersion(match[1]);
      if (normalized) return normalized;
    }
  }
  return null;
}

async function fetchWithTimeout(
  url: string,
  fetchFn: FetchLike,
  timeoutMs: number
): Promise<Awaited<ReturnType<FetchLike>>> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    return await fetchFn(url, {
      cache: 'no-store',
      credentials: 'omit',
      signal: controller?.signal,
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function fetchLatestStoreVersion(options: {
  isFirefox: boolean;
  fetchFn?: FetchLike;
  timeoutMs?: number;
}): Promise<{ latestVersion: string | null; source?: string }> {
  const fetchFn: FetchLike = options.fetchFn ?? (globalThis.fetch as unknown as FetchLike);
  const timeoutMs = options.timeoutMs ?? VERSION_CHECK_TIMEOUT_MS;
  if (typeof fetchFn !== 'function') {
    return { latestVersion: null };
  }

  if (options.isFirefox) {
    try {
      const apiRes = await fetchWithTimeout(FIREFOX_AMO_API_URL, fetchFn, timeoutMs);
      if (apiRes.ok) {
        const json = await apiRes.json();
        const ver = parseAmoApiVersion(json);
        if (ver) return { latestVersion: ver, source: 'amo-api' };
      }
    } catch {
      // Fall through to HTML listing fallback
    }

    try {
      const htmlRes = await fetchWithTimeout(FIREFOX_STORE_URL, fetchFn, timeoutMs);
      if (htmlRes.ok) {
        const html = await htmlRes.text();
        const ver = parseAmoHtmlVersion(html);
        if (ver) return { latestVersion: ver, source: 'amo-html' };
      }
    } catch {
      // Non-fatal store lookup failure
    }

    return { latestVersion: null };
  }

  // Omaha CRX update ping first (exact XML attribute), then Chrome Web Store HTML fallback
  try {
    const xmlRes = await fetchWithTimeout(CHROME_CRX_UPDATE_URL, fetchFn, timeoutMs);
    if (xmlRes.ok) {
      const xml = await xmlRes.text();
      const ver = parseChromeCrxUpdateXmlVersion(xml);
      if (ver) return { latestVersion: ver, source: 'cws-crx' };
    }
  } catch {
    // Fall through to CWS HTML listing fallback
  }

  try {
    const storeRes = await fetchWithTimeout(CHROME_STORE_CHECK_URL, fetchFn, timeoutMs);
    if (storeRes.ok) {
      const html = await storeRes.text();
      const ver = parseChromeWebStoreHtmlVersion(html);
      if (ver) return { latestVersion: ver, source: 'cws-html' };
    }
  } catch {
    // Non-fatal store lookup failure
  }

  return { latestVersion: null };
}

export interface CheckExtensionUpdateOptions {
  currentVersion: string;
  isFirefox: boolean;
  cachedResult?: StoreVersionCheckResult | null;
  force?: boolean;
  now?: number;
  fetchFn?: FetchLike;
  timeoutMs?: number;
  chromeRuntimeUpdateCheck?: () => Promise<{ status: string; version?: string }>;
}

/**
 * Checks whether a newer extension version is published on the relevant browser store.
 * Automatically invalidates cache if `manifest.version` changed (e.g. bumped down for local testing)
 * or if the cache TTL (6 hours) elapsed.
 */
export async function checkExtensionUpdate(
  options: CheckExtensionUpdateOptions
): Promise<StoreVersionCheckResult> {
  const { store, storeUrl } = getStoreTarget(options.isFirefox);
  const currentVersion = normalizeVersion(options.currentVersion) || options.currentVersion || '0.0.0';
  const now = options.now ?? Date.now();
  const cached = options.cachedResult;

  if (
    !options.force &&
    cached &&
    cached.store === store &&
    cached.latestVersion &&
    cached.checkedForVersion === currentVersion &&
    now - cached.checkedAt < VERSION_CHECK_CACHE_TTL_MS
  ) {
    return {
      ...cached,
      currentVersion,
      updateAvailable: compareVersions(cached.latestVersion, currentVersion) > 0,
    };
  }

  let { latestVersion, source } = await fetchLatestStoreVersion({
    isFirefox: options.isFirefox,
    fetchFn: options.fetchFn,
    timeoutMs: options.timeoutMs,
  });

  if (!latestVersion && !options.isFirefox && options.chromeRuntimeUpdateCheck) {
    try {
      const runtimeCheck = await options.chromeRuntimeUpdateCheck();
      if (runtimeCheck?.status === 'update_available' && runtimeCheck.version) {
        const runtimeVer = normalizeVersion(runtimeCheck.version);
        if (runtimeVer) {
          latestVersion = runtimeVer;
          source = 'chrome-runtime';
        }
      }
    } catch {
      // Ignore runtime fallback error
    }
  }

  const updateAvailable = latestVersion
    ? compareVersions(latestVersion, currentVersion) > 0
    : false;

  return {
    store,
    storeUrl,
    currentVersion,
    latestVersion,
    updateAvailable,
    checkedAt: now,
    checkedForVersion: currentVersion,
    source,
  };
}

