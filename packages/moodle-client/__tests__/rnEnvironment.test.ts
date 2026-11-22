import {
  CookieAdapter,
  CookieJar,
  MoodleClient,
  UnsupportedStrategyError,
  ensurePanoptoAuthenticated,
  extractSetCookieHeader,
  isBrowserEnvironment,
  isReactNativeEnvironment,
  mergeCookieHeaders,
  mfetch,
  mfetchFollow,
  resolvePanoptoViaLti,
  runSync,
  scrapeZoomMeetingsWithToken,
  tryExtractTokenFromUrl,
  usesNativeCookieStore,
} from '../src/index.js';

describe('React Native / Hermes Runtime Compatibility', () => {
  const originalFetch = globalThis.fetch;
  const hadWindow = 'window' in globalThis;
  const originalWindow = (globalThis as any).window;
  const hadDocument = 'document' in globalThis;
  const originalDocument = (globalThis as any).document;
  const hadNavigator = 'navigator' in globalThis;
  const originalNavigator = (globalThis as any).navigator;
  const hadChrome = 'chrome' in globalThis;
  const originalChrome = (globalThis as any).chrome;
  const hadBrowser = 'browser' in globalThis;
  const originalBrowser = (globalThis as any).browser;

  function setGlobalProp(key: string, value: unknown) {
    Object.defineProperty(globalThis, key, {
      value,
      writable: true,
      configurable: true,
    });
  }

  function restoreGlobalProp(key: string, existed: boolean, originalValue: unknown) {
    if (existed) {
      setGlobalProp(key, originalValue);
    } else {
      try {
        delete (globalThis as any)[key];
      } catch {
        setGlobalProp(key, undefined);
      }
    }
  }

  function simulateReactNative(withWindow = true) {
    setGlobalProp('window', withWindow ? globalThis : undefined);
    setGlobalProp('document', undefined);
    setGlobalProp('navigator', { product: 'ReactNative' });
    setGlobalProp('chrome', undefined);
    setGlobalProp('browser', undefined);
  }

  function simulateWebDom() {
    setGlobalProp('window', globalThis);
    setGlobalProp('document', {});
    setGlobalProp('navigator', { product: 'Gecko' });
    setGlobalProp('chrome', undefined);
    setGlobalProp('browser', undefined);
  }

  function simulateChromeServiceWorker() {
    setGlobalProp('window', undefined);
    setGlobalProp('document', undefined);
    setGlobalProp('navigator', { userAgent: 'Chrome' });
    setGlobalProp('chrome', { runtime: { id: 'mock-ext-id' } });
    setGlobalProp('browser', undefined);
  }

  afterEach(() => {
    globalThis.fetch = originalFetch;
    restoreGlobalProp('window', hadWindow, originalWindow);
    restoreGlobalProp('document', hadDocument, originalDocument);
    restoreGlobalProp('navigator', hadNavigator, originalNavigator);
    restoreGlobalProp('chrome', hadChrome, originalChrome);
    restoreGlobalProp('browser', hadBrowser, originalBrowser);
    jest.restoreAllMocks();
  });

  describe('Environment detection matrix', () => {
    it('returns false in Node.js (no document, no extension runtime)', () => {
      setGlobalProp('window', undefined);
      setGlobalProp('document', undefined);
      setGlobalProp('navigator', undefined);
      setGlobalProp('chrome', undefined);
      setGlobalProp('browser', undefined);

      expect(isReactNativeEnvironment()).toBe(false);
      expect(isBrowserEnvironment()).toBe(false);
    });

    it('returns false in React Native / Hermes even when window is defined', () => {
      simulateReactNative(true);
      expect(isReactNativeEnvironment()).toBe(true);
      expect(isBrowserEnvironment()).toBe(false);
    });

    it('returns false when window exists without document or extension runtime', () => {
      setGlobalProp('window', globalThis);
      setGlobalProp('document', undefined);
      setGlobalProp('navigator', undefined);
      setGlobalProp('chrome', undefined);
      setGlobalProp('browser', undefined);

      expect(isReactNativeEnvironment()).toBe(false);
      expect(isBrowserEnvironment()).toBe(false);
    });

    it('returns false in React Native even if a document polyfill exists', () => {
      setGlobalProp('window', globalThis);
      setGlobalProp('document', {});
      setGlobalProp('navigator', { product: 'ReactNative' });

      expect(isReactNativeEnvironment()).toBe(true);
      expect(isBrowserEnvironment()).toBe(false);
    });

    it('returns true in Web DOM', () => {
      simulateWebDom();
      expect(isReactNativeEnvironment()).toBe(false);
      expect(isBrowserEnvironment()).toBe(true);
    });

    it('returns true in Chrome MV3 Service Worker (chrome.runtime without document)', () => {
      simulateChromeServiceWorker();
      expect(isReactNativeEnvironment()).toBe(false);
      expect(isBrowserEnvironment()).toBe(true);
    });

    it('returns true in Firefox background context (browser.runtime)', () => {
      setGlobalProp('window', undefined);
      setGlobalProp('document', undefined);
      setGlobalProp('navigator', undefined);
      setGlobalProp('chrome', undefined);
      setGlobalProp('browser', { runtime: { id: 'firefox-ext' } });

      expect(isBrowserEnvironment()).toBe(true);
      expect(usesNativeCookieStore()).toBe(true);
    });

    it('usesNativeCookieStore returns true in RN & Web DOM and false in Node.js', () => {
      simulateReactNative(true);
      expect(usesNativeCookieStore()).toBe(true);

      simulateWebDom();
      expect(usesNativeCookieStore()).toBe(true);

      setGlobalProp('window', undefined);
      setGlobalProp('document', undefined);
      setGlobalProp('navigator', undefined);
      setGlobalProp('chrome', undefined);
      setGlobalProp('browser', undefined);
      expect(usesNativeCookieStore()).toBe(false);
    });
  });

  describe('Cookie utilities & CookieJar', () => {
    it('extractSetCookieHeader guards undefined headers and reads getSetCookie()', () => {
      expect(extractSetCookieHeader(undefined)).toBeNull();
      expect(extractSetCookieHeader(null)).toBeNull();

      const mockWithGetSetCookie = {
        getSetCookie: () => ['MoodleSession=abc; Path=/', '.ASPXAUTH=xyz; HttpOnly'],
        get: () => 'fallback',
      } as unknown as Headers;
      expect(extractSetCookieHeader(mockWithGetSetCookie)).toBe(
        'MoodleSession=abc; Path=/, .ASPXAUTH=xyz; HttpOnly'
      );

      const mockWithGet = {
        get: (name: string) => (name === 'set-cookie' ? 'MoodleSession=def; Path=/' : null),
      } as unknown as Headers;
      expect(extractSetCookieHeader(mockWithGet)).toBe('MoodleSession=def; Path=/');
    });

    it('mergeCookieHeaders deduplicates and preserves cookie order', () => {
      expect(mergeCookieHeaders('A=1; B=2', 'B=override; C=3', undefined)).toBe(
        'A=1; B=override; C=3'
      );
    });

    it('CookieJar.ingestCookieHeader preserves all semicolon-separated cookies', () => {
      const jar = new CookieJar();
      jar.ingestCookieHeader('MoodleSession=abc123; .ASPXAUTH=tok999; Theme=noodle');

      expect(jar.get('MoodleSession')).toBe('abc123');
      expect(jar.get('.ASPXAUTH')).toBe('tok999');
      expect(jar.get('Theme')).toBe('noodle');
      expect(jar.has('.ASPXAUTH')).toBe(true);
      expect(jar.header()).toBe('MoodleSession=abc123; .ASPXAUTH=tok999; Theme=noodle');

      jar.set('Extra', 'val');
      expect(jar.toRecord()).toEqual({
        MoodleSession: 'abc123',
        '.ASPXAUTH': 'tok999',
        Theme: 'noodle',
        Extra: 'val',
      });

      const fromRec = CookieJar.fromCookies({ Foo: 'bar' });
      expect(fromRec.get('Foo')).toBe('bar');

      jar.clear();
      expect(jar.header()).toBe('');
    });
  });

  describe('mfetch & mfetchFollow in RN vs Browser', () => {
    it('uses CookieJar, redirect:manual, and custom fetch/cookieAdapter in simulated RN', async () => {
      simulateReactNative(true);
      const jar = CookieJar.fromCookies('MoodleSession=initial');
      const adapterIngested: Array<{ url: string; header: string | null }> = [];
      const cookieAdapter: CookieAdapter = {
        getCookieHeader: async () => 'AdapterCookie=fromAdapter',
        ingestSetCookie: async (url, header) => {
          adapterIngested.push({ url, header });
        },
      };

      const customFetch = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string>;
        expect(init?.redirect).toBe('manual');
        expect((init as any)?.credentials).toBeUndefined();
        expect(headers['User-Agent']).toBe('MoodleMobile');
        expect(headers['Cookie']).toContain('AdapterCookie=fromAdapter');
        expect(headers['Cookie']).toContain('MoodleSession=initial');
        return {
          ok: true,
          status: 200,
          headers: {
            getSetCookie: () => ['NewSession=fresh; Path=/'],
            get: () => null,
          },
          text: async () => 'ok',
        } as unknown as Response;
      });

      await mfetch(jar, 'https://moodle.tau.ac.il/my/', {
        headers: { 'User-Agent': 'MoodleMobile' },
        fetch: customFetch as any,
        cookieAdapter,
      });

      expect(customFetch).toHaveBeenCalledTimes(1);
      expect(jar.get('NewSession')).toBe('fresh');
      expect(adapterIngested).toEqual([
        { url: 'https://moodle.tau.ac.il/my/', header: 'NewSession=fresh; Path=/' },
      ]);
    });

    it('mfetchFollow intercepts moodlemobile://token redirect and preserves custom fetch across hops', async () => {
      simulateReactNative(true);
      const jar = new CookieJar();
      const rawToken = btoa('sig:::SECRET_MOBILE_TOKEN');
      const customFetch = jest
        .fn()
        .mockResolvedValueOnce({
          status: 302,
          headers: new Headers({
            location: 'https://moodle.tau.ac.il/admin/tool/mobile/launch.php?step=2',
            'set-cookie': 'Step1=ok; Path=/',
          }),
        })
        .mockResolvedValueOnce({
          status: 302,
          headers: new Headers({
            location: `moodlemobile://token=${rawToken}`,
          }),
        });

      const { finalUrl } = await mfetchFollow(
        jar,
        'https://moodle.tau.ac.il/admin/tool/mobile/launch.php',
        { fetch: customFetch as any }
      );

      expect(customFetch).toHaveBeenCalledTimes(2);
      expect(jar.get('Step1')).toBe('ok');
      expect(tryExtractTokenFromUrl(finalUrl)).toBe('SECRET_MOBILE_TOKEN');
    });

    it('uses credentials:include and strips User-Agent in Web DOM and Chrome MV3 SW', async () => {
      for (const setup of [simulateWebDom, simulateChromeServiceWorker]) {
        setup();
        const jar = CookieJar.fromCookies('MoodleSession=ignoredInBrowser');
        const mockFetch = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
          const headers = init?.headers as Record<string, string>;
          expect(init?.redirect).toBe('follow');
          expect((init as any)?.credentials).toBe('include');
          expect(headers['User-Agent']).toBeUndefined();
          expect(headers['Cookie']).toBeUndefined();
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'set-cookie': 'ShouldIgnore=1' }),
          } as unknown as Response;
        });
        globalThis.fetch = mockFetch as any;

        await mfetch(jar, 'https://moodle.tau.ac.il/my/', {
          headers: { 'User-Agent': 'MoodleMobile' },
        });
        expect(jar.has('ShouldIgnore')).toBe(false);
      }
    });

    it('omits manual Cookie header in mfetch when useNativeCookies: true and no cookieAdapter is passed', async () => {
      simulateReactNative(true);
      const jar = CookieJar.fromCookies('MoodleSession=shouldNotBeManuallyInjected');
      const customFetch = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string>;
        expect(headers['Cookie']).toBeUndefined();
        expect(headers['cookie']).toBeUndefined();
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          text: async () => 'ok',
        } as unknown as Response;
      });

      await mfetch(jar, 'https://moodle.tau.ac.il/my/', {
        fetch: customFetch as any,
        useNativeCookies: true,
      });

      expect(customFetch).toHaveBeenCalledTimes(1);
    });

    it('mfetchFollow returns res.url on first hop (i === 0) when fetch auto-followed a redirect', async () => {
      simulateReactNative(true);
      const jar = new CookieJar();
      const customFetch = jest.fn(async () => ({
        ok: true,
        status: 200,
        url: 'https://moodle.tau.ac.il/my/courses.php',
        headers: new Headers(),
        text: async () => '<html></html>',
      }) as unknown as Response);

      const { finalUrl } = await mfetchFollow(jar, 'https://moodle.tau.ac.il/my/', {
        fetch: customFetch as any,
      });
      expect(finalUrl).toBe('https://moodle.tau.ac.il/my/courses.php');
    });

    it('tryExtractTokenFromUrl decodes URL-encoded (%2B, %3D) and URL-safe base64 (-, _) tokens', () => {
      const encodedStd = encodeURIComponent(btoa('sig:::tok+with/chars=1'));
      expect(tryExtractTokenFromUrl(`moodlemobile://token=${encodedStd}`)).toBe('tok+with/chars=1');

      const urlSafe = btoa('sig:::urlsafe_token_val').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      expect(tryExtractTokenFromUrl(`moodleapp://token=${urlSafe}`)).toBe('urlsafe_token_val');
    });

    it('scrapeZoomMeetingsWithToken tries mod_lti_get_tool_launch_data with instanceId FIRST and skips /mod/lti/view.php', async () => {
      simulateReactNative(true);
      const requestedUrls: string[] = [];
      const customFetch = jest.fn(async (url: RequestInfo | URL) => {
        const urlStr = String(url);
        requestedUrls.push(urlStr);
        if (urlStr.includes('mod_lti_get_tool_launch_data')) {
          expect(urlStr).toContain('toolid=555');
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => ({
              endpoint: 'https://applications.zoom.us/lti/rich',
              parameters: [{ name: 'oauth_consumer_key', value: 'k' }],
            }),
          } as unknown as Response;
        }
        if (urlStr.includes('applications.zoom.us/lti/rich')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            text: async () => '<a href="https://tau-ac-il.zoom.us/j/98765432101">Class Zoom</a>',
          } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({ result: { list: [] } }),
          text: async () => '',
        } as unknown as Response;
      });

      const meetings = await scrapeZoomMeetingsWithToken(
        'tok',
        555,
        'https://moodle.tau.ac.il',
        999,
        new CookieJar(),
        'lti',
        { fetch: customFetch as any }
      );

      expect(meetings).toHaveLength(1);
      expect(meetings[0].meetingNumber).toBe('98765432101');
      expect(requestedUrls[0]).toContain('mod_lti_get_tool_launch_data');
      expect(requestedUrls.some((u) => u.includes('/mod/lti/view.php'))).toBe(false);
    });
  });

  describe('resolvePanoptoViaLti RN vs Browser', () => {
    it('routes LTI POST through panoptoFetch with CookieJar in simulated RN', async () => {
      simulateReactNative(true);
      const jar = CookieJar.fromCookies('MoodleSession=rnSession');
      const customFetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = String(url);
        if (urlStr.includes('mod_lti_get_tool_launch_data')) {
          return {
            ok: true,
            json: async () => ({
              endpoint: 'https://tau.cloud.panopto.eu/Panopto/LTI/LTI.aspx',
              parameters: [{ name: 'context_id', value: '101' }],
            }),
          } as unknown as Response;
        }
        const headers = init?.headers as Record<string, string>;
        expect((init as any)?.credentials).toBeUndefined();
        expect(headers['Cookie']).toContain('MoodleSession=rnSession');
        return {
          ok: true,
          url: 'https://tau.cloud.panopto.eu/Panopto/Pages/Sessions/List.aspx?folderID=11111111-1111-1111-1111-111111111111',
          headers: new Headers({ 'set-cookie': '.ASPXAUTH=panoptoAuth; Path=/' }),
          text: async () => '<html></html>',
        } as unknown as Response;
      });

      const res = await resolvePanoptoViaLti(
        'tok',
        55,
        101,
        'Course',
        'https://moodle.tau.ac.il',
        'https://tau.cloud.panopto.eu',
        jar,
        { fetch: customFetch as any }
      );

      expect(res.folderIds).toContain('11111111-1111-1111-1111-111111111111');
      expect(jar.get('.ASPXAUTH')).toBe('panoptoAuth');
    });

    it('captures .ASPXAUTH across 302 redirect hops in resolvePanoptoViaLti, forwards cookies, and resolves finalUrl', async () => {
      simulateReactNative(true);
      const jar = CookieJar.fromCookies('MoodleSession=rnSession');
      const adapterStore = new CookieJar();
      adapterStore.set('AdapterOnly', 'keepMe');
      const cookieAdapter: CookieAdapter = {
        getCookieHeader: () => adapterStore.header(),
        ingestSetCookie: (_url, raw) => adapterStore.ingest(raw),
      };

      const seenRequests: Array<{ url: string; method: string; cookie?: string; contentType?: string; body?: unknown; userAgent?: string; redirect?: string }> = [];

      const customFetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = String(url);
        const headers = (init?.headers || {}) as Record<string, string>;
        seenRequests.push({
          url: urlStr,
          method: init?.method || 'GET',
          cookie: headers['Cookie'],
          contentType: headers['Content-Type'] ?? headers['content-type'],
          body: init?.body,
          userAgent: headers['User-Agent'],
          redirect: init?.redirect,
        });

        if (urlStr.includes('mod_lti_get_tool_launch_data')) {
          return {
            ok: true,
            json: async () => ({
              endpoint: 'https://tau.cloud.panopto.eu/Panopto/LTI/LTI.aspx',
              parameters: [{ name: 'context_id', value: '101' }],
            }),
          } as unknown as Response;
        }

        if (urlStr === 'https://tau.cloud.panopto.eu/Panopto/LTI/LTI.aspx') {
          return {
            ok: false,
            status: 302,
            url: '',
            headers: new Headers({
              location: '/Panopto/Pages/Sessions/List.aspx?folderID=33333333-3333-3333-3333-333333333333',
              'set-cookie': '.ASPXAUTH=LTI_302_TOKEN; Path=/; HttpOnly',
            }),
            text: async () => '',
          } as unknown as Response;
        }

        if (urlStr === 'https://tau.cloud.panopto.eu/Panopto/Pages/Sessions/List.aspx?folderID=33333333-3333-3333-3333-333333333333') {
          return {
            ok: true,
            status: 200,
            url: '',
            headers: new Headers(),
            text: async () => '<html><body>Sessions</body></html>',
          } as unknown as Response;
        }

        throw new Error(`Unexpected URL: ${urlStr}`);
      });

      const res = await resolvePanoptoViaLti(
        'tok',
        55,
        101,
        'Course',
        'https://moodle.tau.ac.il',
        'https://tau.cloud.panopto.eu',
        jar,
        { fetch: customFetch as any, cookieAdapter }
      );

      expect(jar.get('.ASPXAUTH')).toBe('LTI_302_TOKEN');
      expect(adapterStore.get('.ASPXAUTH')).toBe('LTI_302_TOKEN');
      expect(res.folderIds).toContain('33333333-3333-3333-3333-333333333333');

      const wsReq = seenRequests.find((r) => r.url.includes('mod_lti_get_tool_launch_data'));
      expect(wsReq?.userAgent).toBe('MoodleMobile');

      const ltiPost = seenRequests.find((r) => r.url.endsWith('/Panopto/LTI/LTI.aspx'));
      expect(ltiPost?.method).toBe('POST');
      expect(ltiPost?.redirect).toBe('manual');

      const listGet = seenRequests.find((r) => r.url.includes('/Panopto/Pages/Sessions/List.aspx'));
      expect(listGet).toBeDefined();
      expect(listGet?.method).toBe('GET');
      expect(listGet?.body).toBeUndefined();
      expect(listGet?.contentType).toBeUndefined();
      expect(listGet?.cookie).toContain('.ASPXAUTH=LTI_302_TOKEN');
      expect(listGet?.cookie).toContain('MoodleSession=rnSession');
      expect(listGet?.cookie).toContain('AdapterOnly=keepMe');
    });

    it('captures and forwards .ASPXAUTH across 302 redirect hops in ensurePanoptoAuthenticated', async () => {
      simulateReactNative(true);
      const jar = CookieJar.fromCookies('MoodleSession=activeMoodle');
      const adapterStore = new CookieJar();
      const cookieAdapter: CookieAdapter = {
        getCookieHeader: () => adapterStore.header(),
        ingestSetCookie: (_url, raw) => adapterStore.ingest(raw),
      };

      let homeCookieOnRetry = '';
      const customFetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = String(url);
        const headers = (init?.headers || {}) as Record<string, string>;
        expect(init?.redirect).toBe('manual');

        if (urlStr === 'https://tau.cloud.panopto.eu/Panopto/Pages/Home.aspx') {
          if (headers['Cookie']?.includes('.ASPXAUTH=SSO_302_OK')) {
            homeCookieOnRetry = headers['Cookie'];
            return {
              ok: true,
              status: 200,
              url: '',
              headers: new Headers(),
              text: async () => '<html><body>Panopto Home</body></html>',
            } as unknown as Response;
          }
          return {
            ok: false,
            status: 302,
            url: '',
            headers: new Headers({
              location: '/Panopto/Pages/Auth/Login.aspx',
            }),
            text: async () => '',
          } as unknown as Response;
        }

        if (urlStr === 'https://tau.cloud.panopto.eu/Panopto/Pages/Auth/Login.aspx') {
          return {
            ok: true,
            status: 200,
            url: '',
            headers: new Headers(),
            text: async () => '<html><body><button id="externalLoginButton">Login</button></body></html>',
          } as unknown as Response;
        }

        if (urlStr === 'https://moodle.tau.ac.il/blocks/panopto/SSO.php') {
          expect(headers['Cookie']).toContain('MoodleSession=activeMoodle');
          return {
            ok: false,
            status: 302,
            url: '',
            headers: new Headers({
              location: 'https://tau.cloud.panopto.eu/Panopto/Pages/Home.aspx',
              'set-cookie': '.ASPXAUTH=SSO_302_OK; Path=/; HttpOnly',
            }),
            text: async () => '',
          } as unknown as Response;
        }

        throw new Error(`Unexpected URL: ${urlStr}`);
      });

      const ok = await ensurePanoptoAuthenticated(
        'https://tau.cloud.panopto.eu',
        'https://moodle.tau.ac.il',
        jar,
        undefined,
        { fetch: customFetch as any, cookieAdapter }
      );

      expect(ok).toBe(true);
      expect(jar.get('.ASPXAUTH')).toBe('SSO_302_OK');
      expect(adapterStore.get('.ASPXAUTH')).toBe('SSO_302_OK');
      expect(homeCookieOnRetry).toContain('.ASPXAUTH=SSO_302_OK');
    });

    it('ensurePanoptoAuthenticated rejects guest Home.aspx 200 and accepts /Api/v1/users/me 200 with non-zero UserId', async () => {
      simulateReactNative(true);

      // Case 1: /Api/v1/users/me returns 200 with real non-zero UserId -> immediately true without SSO
      const authedFetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = String(url);
        const headers = (init?.headers || {}) as Record<string, string>;
        // Also verify useNativeCookies: true suppresses manual Cookie header in panoptoFetchHop
        expect(headers['Cookie']).toBeUndefined();
        if (urlStr === 'https://tau.cloud.panopto.eu/Panopto/Api/v1/users/me') {
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => ({ UserId: '12345678-1234-1234-1234-123456789abc' }),
          } as unknown as Response;
        }
        throw new Error(`Unexpected URL when already authenticated: ${urlStr}`);
      });

      const okAuthed = await ensurePanoptoAuthenticated(
        'https://tau.cloud.panopto.eu',
        'https://moodle.tau.ac.il',
        CookieJar.fromCookies('IgnoredByNative=1'),
        undefined,
        { fetch: authedFetch as any, useNativeCookies: true }
      );
      expect(okAuthed).toBe(true);
      expect(authedFetch).toHaveBeenCalledTimes(1);

      // Case 2: /Api/v1/users/me returns 401 and Home.aspx returns guest 200 HTML without "isAuthenticated":true -> must NOT false-positive
      let ssoCalled = false;
      const guestFetch = jest.fn(async (url: RequestInfo | URL) => {
        const urlStr = String(url);
        if (urlStr === 'https://tau.cloud.panopto.eu/Panopto/Api/v1/users/me') {
          return { ok: false, status: 401, headers: new Headers(), json: async () => ({}) } as unknown as Response;
        }
        if (urlStr === 'https://tau.cloud.panopto.eu/Panopto/Pages/Home.aspx') {
          return {
            ok: true,
            status: 200,
            url: urlStr,
            headers: new Headers(),
            text: async () => '<html><body>Guest Home Page ("isAuthenticated":false)</body></html>',
          } as unknown as Response;
        }
        if (urlStr === 'https://moodle.tau.ac.il/blocks/panopto/SSO.php') {
          ssoCalled = true;
          return {
            ok: false,
            status: 403,
            url: urlStr,
            headers: new Headers(),
            text: async () => 'Forbidden',
          } as unknown as Response;
        }
        throw new Error(`Unexpected URL: ${urlStr}`);
      });

      const okGuest = await ensurePanoptoAuthenticated(
        'https://tau.cloud.panopto.eu',
        'https://moodle.tau.ac.il',
        new CookieJar(),
        undefined,
        { fetch: guestFetch as any }
      );
      expect(ssoCalled).toBe(true);
      expect(okGuest).toBe(false);

      // Case 3: /Api/v1/users/me returns 200 with all-zero anonymous UUID -> must NOT false-positive
      let ssoCalledZero = false;
      const zeroUuidFetch = jest.fn(async (url: RequestInfo | URL) => {
        const urlStr = String(url);
        if (urlStr === 'https://tau.cloud.panopto.eu/Panopto/Api/v1/users/me') {
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => ({ UserId: '00000000-0000-0000-0000-000000000000' }),
          } as unknown as Response;
        }
        if (urlStr === 'https://moodle.tau.ac.il/blocks/panopto/SSO.php') {
          ssoCalledZero = true;
          return { ok: false, status: 403, url: urlStr, headers: new Headers(), text: async () => '' } as unknown as Response;
        }
        throw new Error(`Unexpected URL: ${urlStr}`);
      });

      const okZero = await ensurePanoptoAuthenticated(
        'https://tau.cloud.panopto.eu',
        'https://moodle.tau.ac.il',
        new CookieJar(),
        undefined,
        { fetch: zeroUuidFetch as any }
      );
      expect(ssoCalledZero).toBe(true);
      expect(okZero).toBe(false);
    });
  });

  describe('MoodleClient User-Agent, custom fetch & CookieAdapter', () => {
    it('sends User-Agent: MoodleMobile by default in RN and allows override or suppression', async () => {
      simulateReactNative(true);
      const seenHeaders: Array<Record<string, string> | undefined> = [];
      const customFetch = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        seenHeaders.push(init?.headers as Record<string, string> | undefined);
        return {
          ok: true,
          json: async () => ({ userid: 1, username: 'u', fullname: 'U', sitename: 'TAU' }),
          headers: new Headers(),
        } as unknown as Response;
      });

      const defaultClient = new MoodleClient('tok', 'https://moodle.tau.ac.il/webservice/rest/server.php', {
        fetch: customFetch as any,
      });
      await defaultClient.getSiteInfo();
      expect(seenHeaders[0]?.['User-Agent']).toBe('MoodleMobile');

      const customClient = new MoodleClient('tok', 'https://moodle.tau.ac.il/webservice/rest/server.php', {
        fetch: customFetch as any,
        userAgent: 'NoodleRN/1.0',
      });
      await customClient.apiCall('core_webservice_get_site_info', {}, 'POST');
      expect(seenHeaders[1]?.['User-Agent']).toBe('NoodleRN/1.0');
      expect(seenHeaders[1]?.['Content-Type']).toBe('application/x-www-form-urlencoded');

      const suppressedClient = new MoodleClient('tok', 'https://moodle.tau.ac.il/webservice/rest/server.php', {
        fetch: customFetch as any,
        userAgent: '',
      });
      await suppressedClient.getSiteInfo();
      expect(seenHeaders[2]?.['User-Agent']).toBeUndefined();
    });

    it('omits User-Agent in Web DOM and Chrome MV3 SW', async () => {
      for (const setup of [simulateWebDom, simulateChromeServiceWorker]) {
        setup();
        const mockFetch = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
          const headers = init?.headers as Record<string, string> | undefined;
          expect(headers?.['User-Agent']).toBeUndefined();
          return {
            ok: true,
            json: async () => ({ userid: 1, username: 'u', fullname: 'U', sitename: 'TAU' }),
          } as unknown as Response;
        });
        const client = new MoodleClient('tok', 'https://moodle.tau.ac.il/webservice/rest/server.php', {
          fetch: mockFetch as any,
        });
        await client.getSiteInfo();
      }
    });

    it('supports cookieAdapter and custom fetch across RestMoodleStrategy -> AjaxMoodleStrategy fallback', async () => {
      simulateReactNative(true);
      const ingested: Array<string | null> = [];
      const cookieAdapter: CookieAdapter = {
        getCookieHeader: () => 'MoodleSession=ajaxCookie',
        ingestSetCookie: (_url, h) => {
          ingested.push(h);
        },
      };

      const failingRestStrategy = {
        name: 'REST',
        isOperationSupported: () => false,
        getSiteInfo: async () => {
          throw new UnsupportedStrategyError('REST', 'getSiteInfo');
        },
        getEnrolledCourses: async () => {
          throw new UnsupportedStrategyError('REST', 'getEnrolledCourses');
        },
        getAssignments: async () => {
          throw new UnsupportedStrategyError('REST', 'getAssignments');
        },
        getSubmissionStatus: async () => {
          throw new UnsupportedStrategyError('REST', 'getSubmissionStatus');
        },
        getGradeItems: async () => {
          throw new UnsupportedStrategyError('REST', 'getGradeItems');
        },
        getCourseContents: async () => {
          throw new UnsupportedStrategyError('REST', 'getCourseContents');
        },
        uploadFile: async () => {
          throw new UnsupportedStrategyError('REST', 'uploadFile');
        },
        saveSubmission: async () => {
          throw new UnsupportedStrategyError('REST', 'saveSubmission');
        },
        submitForGrading: async () => {
          throw new UnsupportedStrategyError('REST', 'submitForGrading');
        },
        getAutoLoginKey: async () => {
          throw new UnsupportedStrategyError('REST', 'getAutoLoginKey');
        },
        saveNoodleSettings: async () => {
          throw new UnsupportedStrategyError('REST', 'saveNoodleSettings');
        },
        loadNoodleSettings: async () => {
          throw new UnsupportedStrategyError('REST', 'loadNoodleSettings');
        },
      };

      const { AjaxMoodleStrategy } = await import('../src/strategies/ajaxStrategy.js');
      const ajaxStrategy = new AjaxMoodleStrategy({
        token: 'tok',
        sesskey: 'SK123',
        baseUrl: 'https://moodle.tau.ac.il',
        userAgent: 'NoodleRN/1.0',
        cookieAdapter,
        fetch: (async (_url: RequestInfo | URL, init?: RequestInit) => {
          const headers = init?.headers as Record<string, string>;
          expect(headers['Cookie']).toBe('MoodleSession=ajaxCookie');
          expect(headers['User-Agent']).toBe('NoodleRN/1.0');
          return {
            ok: true,
            headers: new Headers({ 'set-cookie': 'MoodleSession=rotated; Path=/' }),
            json: async () => [
              {
                error: false,
                data: {
                  courses: [{ id: 201, fullname: 'Test Course', shortname: 'TC-01', idnumber: '' }],
                },
              },
            ],
          } as unknown as Response;
        }) as any,
      });

      const client = new MoodleClient('tok', 'https://moodle.tau.ac.il', {
        strategies: [failingRestStrategy, ajaxStrategy],
      });
      const courses = await client.getEnrolledCourses(10);
      expect(courses).toHaveLength(1);
      expect(courses[0].id).toBe(201);
      expect(ingested).toHaveLength(5);
      expect(ingested[0]).toBe('MoodleSession=rotated; Path=/');
    });
  });

  describe('runSync RN integration', () => {
    it('passes CookieJar into fetchCourseFormatState and sends User-Agent: MoodleMobile', async () => {
      simulateReactNative(true);
      let formatStateCookie = '';
      let restUserAgent = '';

      const customFetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = String(url);
        const bodyStr = init?.body ? String(init.body) : '';
        const headers = (init?.headers || {}) as Record<string, string>;

        if (urlStr.includes('core_courseformat_get_state')) {
          formatStateCookie = headers['Cookie'] || '';
          return {
            ok: true,
            headers: new Headers(),
            json: async () => [
              {
                error: false,
                data: JSON.stringify({
                  course: { id: 101, format: 'topics' },
                  section: [
                    { id: '10', section: 1, levelsan: 1 },
                    { id: '11', section: 2, parentid: '10', levelsan: 2 },
                  ],
                }),
              },
            ],
          } as unknown as Response;
        }

        if (urlStr.includes('webservice/rest/server.php')) {
          restUserAgent = headers['User-Agent'] || '';
        }

        const fnMatch = (fn: string) => urlStr.includes(fn) || bodyStr.includes(fn);
        if (fnMatch('core_webservice_get_site_info')) {
          return {
            ok: true,
            json: async () => ({ userid: 1, fullname: 'RN Student' }),
          } as unknown as Response;
        }
        if (fnMatch('core_enrol_get_users_courses')) {
          return {
            ok: true,
            json: async () => [{ id: 101, fullname: 'RN Course', shortname: '03681000-01' }],
          } as unknown as Response;
        }
        if (fnMatch('mod_assign_get_assignments')) {
          return { ok: true, json: async () => ({ courses: [] }) } as unknown as Response;
        }
        if (fnMatch('gradereport_user_get_grade_items')) {
          return { ok: true, json: async () => ({ usergrades: [{ courseid: 101, gradeitems: [] }] }) } as unknown as Response;
        }
        if (fnMatch('core_course_get_contents')) {
          return {
            ok: true,
            json: async () => [
              { id: 10, name: 'Parent Topic', section: 1, modules: [] },
              { id: 11, name: 'Child Subtopic', section: 2, modules: [] },
            ],
          } as unknown as Response;
        }
        return { ok: true, json: async () => ({}) } as unknown as Response;
      });

      const result = await runSync(
        'tok',
        [101],
        () => {},
        'https://moodle.tau.ac.il',
        undefined,
        'MoodleSession=rn123; ExtraCookie=456',
        'SESSKEY_RN',
        undefined,
        {
          enableScraping: false,
          fetch: customFetch as any,
        }
      );

      expect(restUserAgent).toBe('MoodleMobile');
      expect(formatStateCookie).toContain('MoodleSession=rn123');
      expect(formatStateCookie).toContain('ExtraCookie=456');
      const child = result.sections?.find((s) => s.id === 11);
      expect(child?.parentSectionId).toBe(10);
      expect(child?.level).toBe(1);
    });

    it('skips NIDP login in Stage 1 formatStatePromise when only creds are provided, and deduplicates web session login in Stage 3', async () => {
      simulateReactNative(true);
      let loginIndexCalls = 0;
      let launchCalls = 0;

      const customFetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = String(url);
        const bodyStr = init?.body ? String(init.body) : '';
        const fnMatch = (fn: string) => urlStr.includes(fn) || bodyStr.includes(fn);

        if (urlStr.includes('/admin/tool/mobile/launch.php')) {
          launchCalls++;
          return { ok: false, status: 404, headers: new Headers(), text: async () => '' } as unknown as Response;
        }
        if (urlStr.includes('/login/index.php')) {
          loginIndexCalls++;
          return {
            ok: true,
            status: 200,
            url: 'https://moodle.tau.ac.il/my/',
            headers: new Headers({ 'set-cookie': 'MoodleSession=singleFlightJar; Path=/' }),
            text: async () => '"sesskey":"SK_FLIGHT"',
          } as unknown as Response;
        }
        if (fnMatch('core_webservice_get_site_info')) {
          return { ok: true, json: async () => ({ userid: 1, fullname: 'RN Student' }) } as unknown as Response;
        }
        if (fnMatch('core_enrol_get_users_courses')) {
          return {
            ok: true,
            json: async () => [
              { id: 101, fullname: 'Course 1', shortname: '03681001-01' },
              { id: 102, fullname: 'Course 2', shortname: '03681002-01' },
            ],
          } as unknown as Response;
        }
        if (fnMatch('mod_assign_get_assignments')) {
          return { ok: true, json: async () => ({ courses: [] }) } as unknown as Response;
        }
        if (fnMatch('gradereport_user_get_grade_items')) {
          return { ok: true, json: async () => ({ usergrades: [] }) } as unknown as Response;
        }
        if (fnMatch('core_course_get_contents')) {
          return { ok: true, json: async () => [] } as unknown as Response;
        }
        return { ok: true, json: async () => ({}) } as unknown as Response;
      });

      await runSync(
        'tok',
        [101, 102],
        () => {},
        'https://moodle.tau.ac.il',
        { username: 'u', idNumber: '123456782', password: 'p' },
        undefined,
        'SESSKEY',
        undefined,
        {
          enableScraping: false,
          fetch: customFetch as any,
        }
      );

      // Stage 1 must NOT trigger performLogin (launch.php) or NIDP login just because creds are passed
      expect(launchCalls).toBe(0);
      expect(loginIndexCalls).toBe(0);
    });

    it('runs fetchSesskeyFromJar and fetchCourseFormatState in RN when only options.cookieAdapter is provided', async () => {
      simulateReactNative(true);
      const adapterStore = CookieJar.fromCookies('MoodleSession=adapterInitial');
      const cookieAdapter: CookieAdapter = {
        getCookieHeader: () => adapterStore.header(),
        ingestSetCookie: (_url, raw) => adapterStore.ingest(raw),
      };

      let sesskeyCookieSeen = '';
      let formatStateCookieSeen = '';
      let sawFormatState = false;

      const customFetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = String(url);
        const bodyStr = init?.body ? String(init.body) : '';
        const headers = (init?.headers || {}) as Record<string, string>;
        const fnMatch = (fn: string) => urlStr.includes(fn) || bodyStr.includes(fn);

        if (urlStr.endsWith('/my/')) {
          sesskeyCookieSeen = headers['Cookie'] || '';
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'set-cookie': 'MoodleSession=adapterRotated; Path=/' }),
            text: async () => '"sesskey":"SKADAPTER1"',
          } as unknown as Response;
        }

        if (urlStr.includes('core_courseformat_get_state')) {
          sawFormatState = true;
          formatStateCookieSeen = headers['Cookie'] || '';
          expect(urlStr).toContain('sesskey=SKADAPTER1');
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => [
              {
                error: false,
                data: JSON.stringify({
                  course: { id: 101, format: 'topics' },
                  section: [
                    { id: '10', section: 1, levelsan: 1 },
                    { id: '11', section: 2, parentid: '10', levelsan: 2 },
                  ],
                }),
              },
            ],
          } as unknown as Response;
        }

        if (fnMatch('core_webservice_get_site_info')) {
          return { ok: true, json: async () => ({ userid: 1, fullname: 'RN Student' }) } as unknown as Response;
        }
        if (fnMatch('core_enrol_get_users_courses')) {
          return {
            ok: true,
            json: async () => [{ id: 101, fullname: 'RN Course', shortname: '03681000-01' }],
          } as unknown as Response;
        }
        if (fnMatch('mod_assign_get_assignments')) {
          return { ok: true, json: async () => ({ courses: [] }) } as unknown as Response;
        }
        if (fnMatch('gradereport_user_get_grade_items')) {
          return { ok: true, json: async () => ({ usergrades: [] }) } as unknown as Response;
        }
        if (fnMatch('core_course_get_contents')) {
          return {
            ok: true,
            json: async () => [
              { id: 10, name: 'Parent Topic', section: 1, modules: [] },
              { id: 11, name: 'Child Subtopic', section: 2, modules: [] },
            ],
          } as unknown as Response;
        }
        return { ok: true, json: async () => ({}) } as unknown as Response;
      });

      const result = await runSync(
        'tok',
        [101],
        () => {},
        'https://moodle.tau.ac.il',
        undefined,
        undefined,
        undefined,
        undefined,
        {
          enableScraping: false,
          fetch: customFetch as any,
          cookieAdapter,
        }
      );

      expect(sesskeyCookieSeen).toContain('MoodleSession=adapterInitial');
      expect(sawFormatState).toBe(true);
      expect(formatStateCookieSeen).toContain('MoodleSession=adapterRotated');
      const child = result.sections?.find((s) => s.id === 11);
      expect(child?.parentSectionId).toBe(10);
      expect(child?.level).toBe(1);
    });

    it('guarantees non-null CookieJar for Panopto in RN without initial cookies and resolves Tier 2B LTI before Tier 3 browse', async () => {
      simulateReactNative(true);
      const adapterJar = new CookieJar();
      const cookieAdapter: CookieAdapter = {
        getCookieHeader: () => adapterJar.header(),
        ingestSetCookie: (_url, raw) => adapterJar.ingest(raw),
      };

      const callOrder: string[] = [];
      let sessionsCookieSeen = '';

      const customFetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = String(url);
        const bodyStr = init?.body ? String(init.body) : '';
        const headers = (init?.headers || {}) as Record<string, string>;
        const fnMatch = (fn: string) => urlStr.includes(fn) || bodyStr.includes(fn);

        if (fnMatch('core_webservice_get_site_info')) {
          return { ok: true, json: async () => ({ userid: 1, fullname: 'RN Student' }) } as unknown as Response;
        }
        if (fnMatch('core_enrol_get_users_courses')) {
          return {
            ok: true,
            json: async () => [{ id: 101, fullname: '03681000 - Algorithms', shortname: '03681000-01' }],
          } as unknown as Response;
        }
        if (fnMatch('mod_assign_get_assignments')) {
          return { ok: true, json: async () => ({ courses: [] }) } as unknown as Response;
        }
        if (fnMatch('mod_quiz_get_quizzes_by_courses')) {
          return { ok: true, json: async () => ({ quizzes: [] }) } as unknown as Response;
        }
        if (fnMatch('gradereport_user_get_grade_items')) {
          return { ok: true, json: async () => ({ usergrades: [{ courseid: 101, gradeitems: [] }] }) } as unknown as Response;
        }
        if (fnMatch('core_enrol_get_enrolled_users')) {
          return { ok: true, json: async () => [] } as unknown as Response;
        }
        if (fnMatch('core_course_get_contents')) {
          return {
            ok: true,
            json: async () => [
              {
                id: 10,
                name: 'General',
                section: 0,
                modules: [
                  {
                    id: 99,
                    instance: 55,
                    modname: 'lti',
                    name: 'Panopto Recordings',
                    url: 'https://moodle.tau.ac.il/mod/lti/view.php?id=99',
                  },
                ],
              },
            ],
          } as unknown as Response;
        }
        if (fnMatch('mod_lti_get_tool_launch_data')) {
          callOrder.push('lti_launch_data');
          return {
            ok: true,
            json: async () => ({
              endpoint: 'https://tau.cloud.panopto.eu/Panopto/LTI/LTI.aspx',
              parameters: [{ name: 'context_id', value: '101' }],
            }),
          } as unknown as Response;
        }
        if (urlStr.includes('Panopto/LTI/LTI.aspx')) {
          callOrder.push('lti_post');
          return {
            ok: true,
            url: 'https://tau.cloud.panopto.eu/Panopto/Pages/Sessions/List.aspx?folderID=11111111-1111-1111-1111-111111111111',
            headers: new Headers({ 'set-cookie': '.ASPXAUTH=rnLtiAuth; Path=/' }),
            text: async () => '<html></html>',
          } as unknown as Response;
        }
        if (urlStr.includes('Data.svc/GetFoldersList') || urlStr.includes('FolderInfo')) {
          callOrder.push('tier3_browse');
          return { ok: true, headers: new Headers(), json: async () => ({ d: { Results: [] } }) } as unknown as Response;
        }
        if (urlStr.includes('Data.svc/GetSessions')) {
          if (!bodyStr.includes('folderID')) {
            return {
              ok: true,
              headers: new Headers(),
              json: async () => ({ d: { Results: null } }),
            } as unknown as Response;
          }
          callOrder.push('get_sessions');
          sessionsCookieSeen = headers['Cookie'] || '';
          return {
            ok: true,
            headers: new Headers(),
            json: async () => ({
              d: {
                Results: [
                  {
                    DeliveryID: 'del-rn-1',
                    SessionName: 'Lecture 1',
                    FolderName: 'Algorithms',
                    StartTime: '/Date(1730000000000)/',
                    Duration: 3600,
                    PresenterFirstName: 'Prof',
                    PresenterLastName: 'Tau',
                  },
                ],
                Subfolders: [],
              },
            }),
          } as unknown as Response;
        }
        return { ok: true, headers: new Headers(), json: async () => ({}), text: async () => '' } as unknown as Response;
      });

      const result = await runSync(
        'tok',
        [101],
        () => {},
        'https://moodle.tau.ac.il',
        undefined,
        undefined,
        undefined,
        undefined,
        {
          enableScraping: false,
          enablePanopto: true,
          lang: 'en',
          fetch: customFetch as any,
          cookieAdapter,
        }
      );

      expect(callOrder[0]).toBe('lti_launch_data');
      expect(callOrder[1]).toBe('lti_post');
      expect(callOrder).toContain('get_sessions');
      expect(callOrder).not.toContain('tier3_browse');
      expect(adapterJar.get('.ASPXAUTH')).toBe('rnLtiAuth');
      expect(sessionsCookieSeen).toContain('.ASPXAUTH=rnLtiAuth');
      expect(result.recordings?.length).toBeGreaterThanOrEqual(1);
    });

    it('supports useNativeCookies: true + enableScraping: false + panopto_content.php discovery in RN', async () => {
      simulateReactNative(true);
      const discoveredUuid = 'f1f2f3f4-aaaa-bbbb-cccc-ddddeeeeffff';
      let panoptoContentBody = '';
      const seenHeadersOnPanoptoRequests: Array<Record<string, string>> = [];

      const customFetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = String(url);
        const bodyStr = init?.body ? String(init.body) : '';
        const headers = (init?.headers || {}) as Record<string, string>;
        const fnMatch = (fn: string) => urlStr.includes(fn) || bodyStr.includes(fn);

        if (urlStr.includes('tau.cloud.panopto.eu') || urlStr.includes('panopto_content.php')) {
          seenHeadersOnPanoptoRequests.push(headers);
        }

        if (fnMatch('core_webservice_get_site_info')) {
          return { ok: true, json: async () => ({ userid: 1, fullname: 'RN Student' }) } as unknown as Response;
        }
        if (fnMatch('core_enrol_get_users_courses')) {
          return {
            ok: true,
            json: async () => [{ id: 202, fullname: '03682000 - Operating Systems', shortname: '03682000-01' }],
          } as unknown as Response;
        }
        if (fnMatch('mod_assign_get_assignments')) {
          return { ok: true, json: async () => ({ courses: [] }) } as unknown as Response;
        }
        if (fnMatch('mod_quiz_get_quizzes_by_courses')) {
          return { ok: true, json: async () => ({ quizzes: [] }) } as unknown as Response;
        }
        if (fnMatch('gradereport_user_get_grade_items')) {
          return { ok: true, json: async () => ({ usergrades: [] }) } as unknown as Response;
        }
        if (fnMatch('core_enrol_get_enrolled_users')) {
          return { ok: true, json: async () => [] } as unknown as Response;
        }
        if (fnMatch('core_course_get_contents')) {
          return { ok: true, json: async () => [] } as unknown as Response;
        }
        if (urlStr.endsWith('/my/')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            text: async () => '"sesskey":"SKRNNATIVE1"',
          } as unknown as Response;
        }
        if (fnMatch('core_block_get_course_blocks')) {
          return {
            ok: true,
            json: async () => ({
              blocks: [
                {
                  name: 'panopto',
                  contents: {
                    content: '<div id="panopto_block_202"><div id="loading_text">Loading</div></div>',
                    footer: '',
                  },
                },
              ],
            }),
          } as unknown as Response;
        }
        if (urlStr.includes('/blocks/panopto/panopto_content.php')) {
          panoptoContentBody = bodyStr;
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            text: async () =>
              `<a href="https://tau.cloud.panopto.eu/Panopto/Pages/Sessions/List.aspx?folderID=${discoveredUuid}">Recordings</a>`,
          } as unknown as Response;
        }
        if (urlStr.includes('/Panopto/Api/v1/users/me')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => ({ UserId: '12345678-1234-1234-1234-123456789abc' }),
          } as unknown as Response;
        }
        if (urlStr.includes('/Panopto/Services/Data.svc/GetSessions') && bodyStr.includes(discoveredUuid)) {
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => ({
              d: {
                Results: [
                  {
                    DeliveryID: 'del-rn-native-1',
                    SessionName: 'OS Lecture 1',
                    FolderName: 'Operating Systems',
                    StartTime: '/Date(1730000000000)/',
                    Duration: 3600,
                  },
                ],
                Subfolders: [],
              },
            }),
          } as unknown as Response;
        }
        return { ok: true, headers: new Headers(), json: async () => ({}), text: async () => '' } as unknown as Response;
      });

      const result = await runSync(
        'tok',
        [202],
        () => {},
        'https://moodle.tau.ac.il',
        undefined,
        undefined,
        undefined,
        undefined,
        {
          enableScraping: false,
          enablePanopto: true,
          useNativeCookies: true,
          lang: 'en',
          fetch: customFetch as any,
        }
      );

      expect(new URLSearchParams(panoptoContentBody).get('sesskey')).toBe('SKRNNATIVE1');
      expect(seenHeadersOnPanoptoRequests.length).toBeGreaterThan(0);
      for (const h of seenHeadersOnPanoptoRequests) {
        expect(h['Cookie']).toBeUndefined();
      }
      expect(result.discoveredPanoptoFolders).toEqual({ 202: discoveredUuid });
      expect(result.recordings?.length).toBeGreaterThanOrEqual(1);
    });
  });
});
