export type FetchFn = typeof fetch;

export interface CookieAdapter {
  getCookieHeader(url: string): string | undefined | Promise<string | undefined>;
  ingestSetCookie?(url: string, setCookieHeader: string | null): void | Promise<void>;
}

export function isReactNativeEnvironment(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    navigator !== null &&
    (navigator as any).product === 'ReactNative'
  );
}

/**
 * Returns true only in browser DOM contexts (web pages, Expo Web, extension UI/Firefox BG)
 * or WebExtension background service workers (`chrome.runtime` / `browser.runtime`).
 * Returns false in React Native / Hermes (where `window` is defined but `document` is undefined
 * and/or `navigator.product === 'ReactNative'`) and Node.js.
 */
export function isBrowserEnvironment(): boolean {
  if (isReactNativeEnvironment()) {
    return false;
  }
  const g = globalThis as any;
  const hasExtensionRuntime =
    (typeof g.browser !== 'undefined' && Boolean(g.browser?.runtime)) ||
    (typeof g.chrome !== 'undefined' && Boolean(g.chrome?.runtime));
  return typeof document !== 'undefined' || hasExtensionRuntime;
}

/**
 * Returns true when the host runtime provides a native HTTP cookie store
 * (browser DOM/WebExtension or React Native Android CookieManager / iOS HTTPCookieStorage).
 */
export function usesNativeCookieStore(): boolean {
  return isBrowserEnvironment() || isReactNativeEnvironment();
}

export const DEFAULT_FETCH_TIMEOUT_MS = 20_000;
export const FORMAT_STATE_TIMEOUT_MS = 5_000;

export async function fetchWithTimeout(
  fetchImpl: FetchFn,
  url: string,
  init?: RequestInit,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS
): Promise<Response> {
  if (!timeoutMs || timeoutMs <= 0 || typeof AbortController === 'undefined') {
    return init !== undefined ? fetchImpl(url, init) : fetchImpl(url);
  }

  const controller = new AbortController();
  const externalSignal = init?.signal;
  let onExternalAbort: (() => void) | undefined;

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort((externalSignal as any).reason);
    } else {
      onExternalAbort = () => controller.abort((externalSignal as any).reason);
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  const timer = setTimeout(() => {
    controller.abort(new Error(`Request timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  try {
    return await fetchImpl(url, { ...(init ?? {}), signal: controller.signal });
  } finally {
    clearTimeout(timer);
    if (externalSignal && onExternalAbort) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}

export function extractSetCookieHeader(headers: Headers | undefined | null): string | null {
  if (!headers) return null;
  const getSetCookie = (headers as any).getSetCookie;
  if (typeof getSetCookie === 'function') {
    const list: unknown = getSetCookie.call(headers);
    if (Array.isArray(list) && list.length > 0) {
      return list.join(', ');
    }
  }
  return typeof headers.get === 'function' ? headers.get('set-cookie') : null;
}

export function mergeCookieHeaders(...headers: Array<string | undefined | null>): string {
  const map = new Map<string, string>();
  for (const h of headers) {
    if (!h) continue;
    for (const part of h.split(';')) {
      const trimmed = part.trim();
      const eq = trimmed.indexOf('=');
      if (eq > 0) {
        const name = trimmed.slice(0, eq).trim();
        const val = trimmed.slice(eq + 1).trim();
        if (name) map.set(name, val);
      }
    }
  }
  return Array.from(map.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}
