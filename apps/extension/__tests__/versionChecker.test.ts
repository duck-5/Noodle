import { describe, it, expect } from '@jest/globals';
import {
  CHROME_STORE_CHECK_URL,
  CHROME_CRX_UPDATE_URL,
  CHROME_STORE_URL,
  FIREFOX_AMO_API_URL,
  FIREFOX_STORE_URL,
  VERSION_CHECK_CACHE_TTL_MS,
  compareVersions,
  normalizeVersion,
  parseChromeWebStoreHtmlVersion,
  parseChromeCrxUpdateXmlVersion,
  parseAmoApiVersion,
  parseAmoHtmlVersion,
  fetchLatestStoreVersion,
  checkExtensionUpdate,
  type FetchLike,
} from '../src/shared/versionChecker.js';

function makeResponse(body: string, ok = true, status = 200) {
  return {
    ok,
    status,
    text: async () => body,
    json: async () => JSON.parse(body),
  };
}

describe('versionChecker (Chrome Web Store & Firefox AMO)', () => {
  it('normalizes and compares dotted numeric versions cleanly', () => {
    expect(normalizeVersion('v4.0.2')).toBe('4.0.2');
    expect(normalizeVersion(' 4.0.3 ')).toBe('4.0.3');
    expect(normalizeVersion('invalid')).toBeNull();

    expect(compareVersions('4.0.2', '4.0.1')).toBeGreaterThan(0);
    expect(compareVersions('4.0.3', '4.0.2')).toBeGreaterThan(0);
    expect(compareVersions('4.0.2', '4.0.3')).toBeLessThan(0);
    expect(compareVersions('4.0.2', 'v4.0.2')).toBe(0);
    expect(compareVersions('4.1', '4.0.9')).toBeGreaterThan(0);
    expect(compareVersions('4.0.0', '4.0')).toBe(0);
  });

  it('parses Chrome Web Store detail HTML and Omaha CRX XML responses', () => {
    const gridHtml = `
      <section>
        <div class="n792id">Version</div>
        <div class="P94y8">4.0.2</div>
      </section>
    `;
    expect(parseChromeWebStoreHtmlVersion(gridHtml)).toBe('4.0.2');

    const metaHtml = `<meta itemprop="softwareVersion" content="4.0.5" />`;
    expect(parseChromeWebStoreHtmlVersion(metaHtml)).toBe('4.0.5');

    const crxXml = `<?xml version="1.0" encoding="UTF-8"?>
      <gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">
        <app appid="nelflkccefbdpnaphjabcgkpakhdoope" status="ok">
          <updatecheck codebase="https://clients2.googleusercontent.com/crx" version="4.0.2"/>
        </app>
      </gupdate>`;
    expect(parseChromeCrxUpdateXmlVersion(crxXml)).toBe('4.0.2');
    expect(parseChromeCrxUpdateXmlVersion('<updatecheck version="0.0.0.0"/>')).toBeNull();
  });

  it('parses Firefox AMO v5 JSON API and fallback HTML page', () => {
    expect(parseAmoApiVersion({ current_version: { version: '4.0.2' } })).toBe('4.0.2');
    expect(parseAmoApiVersion({ current_version: {} })).toBeNull();

    const amoHtml = `<dd class="Definition-dd AddonMoreInfo-version">4.0.4</dd>`;
    expect(parseAmoHtmlVersion(amoHtml)).toBe('4.0.4');
  });

  it('queries Omaha CRX updatecheck first and falls back to Chrome Web Store HTML on miss', async () => {
    const calls: string[] = [];
    const fetchMock: FetchLike = async (url) => {
      calls.push(url);
      if (url === CHROME_CRX_UPDATE_URL) {
        return makeResponse('<gupdate><app><updatecheck status="noupdate"/></app></gupdate>', true, 200);
      }
      if (url === CHROME_STORE_CHECK_URL) {
        return makeResponse('<div>Version</div><div>4.0.2</div>', true, 200);
      }
      return makeResponse('', false, 404);
    };

    const res = await fetchLatestStoreVersion({ isFirefox: false, fetchFn: fetchMock });
    expect(calls).toEqual([CHROME_CRX_UPDATE_URL, CHROME_STORE_CHECK_URL]);
    expect(res).toEqual({ latestVersion: '4.0.2', source: 'cws-html' });
  });

  it('fetches Firefox AMO v5 API first and falls back to AMO HTML if API fails', async () => {
    const calls: string[] = [];
    const fetchMock: FetchLike = async (url) => {
      calls.push(url);
      if (url === FIREFOX_AMO_API_URL) {
        return makeResponse('{"detail":"rate limited"}', false, 429);
      }
      if (url === FIREFOX_STORE_URL) {
        return makeResponse('<dd class="AddonMoreInfo-version">4.0.2</dd>', true, 200);
      }
      return makeResponse('', false, 404);
    };

    const res = await fetchLatestStoreVersion({ isFirefox: true, fetchFn: fetchMock });
    expect(calls).toEqual([FIREFOX_AMO_API_URL, FIREFOX_STORE_URL]);
    expect(res).toEqual({ latestVersion: '4.0.2', source: 'amo-html' });
  });

  it('uses fresh cached result for identical version and invalidates cache when manifest version changes', async () => {
    const now = 1_700_000_000_000;
    let fetchCount = 0;
    const fetchMock: FetchLike = async (url) => {
      fetchCount++;
      if (url === CHROME_CRX_UPDATE_URL) {
        return makeResponse('<gupdate><app><updatecheck version="4.0.2"/></app></gupdate>', true, 200);
      }
      return makeResponse('<div>Version</div><div>4.0.2</div>', true, 200);
    };

    const cached = {
      store: 'chrome' as const,
      storeUrl: CHROME_STORE_URL,
      currentVersion: '4.0.3',
      latestVersion: '4.0.2',
      updateAvailable: false,
      checkedAt: now - 60_000,
      checkedForVersion: '4.0.3',
      source: 'cws-html',
    };

    // 1. Fresh cache for same currentVersion -> no network fetch, no update (4.0.2 < 4.0.3)
    const hit = await checkExtensionUpdate({
      currentVersion: '4.0.3',
      isFirefox: false,
      cachedResult: cached,
      now,
      fetchFn: fetchMock,
    });
    expect(fetchCount).toBe(0);
    expect(hit.updateAvailable).toBe(false);

    // 2. Developer bumps manifest version down to 4.0.1 -> cache invalidated, detects 4.0.2 > 4.0.1!
    const bumpedDown = await checkExtensionUpdate({
      currentVersion: '4.0.1',
      isFirefox: false,
      cachedResult: cached,
      now,
      fetchFn: fetchMock,
    });
    expect(fetchCount).toBe(1);
    expect(bumpedDown.latestVersion).toBe('4.0.2');
    expect(bumpedDown.updateAvailable).toBe(true);
    expect(bumpedDown.storeUrl).toBe(CHROME_STORE_URL);

    // 3. Expired cache (> 6 hours) re-fetches even if version stayed the same
    const stale = await checkExtensionUpdate({
      currentVersion: '4.0.3',
      isFirefox: false,
      cachedResult: { ...cached, checkedAt: now - VERSION_CHECK_CACHE_TTL_MS - 1 },
      now,
      fetchFn: fetchMock,
    });
    expect(fetchCount).toBe(2);
    expect(stale.updateAvailable).toBe(false);
  });
});

