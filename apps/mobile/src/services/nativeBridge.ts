import { NativeModules, Platform } from 'react-native';

interface NoodleNativeModuleInterface {
  openContentUri(contentUri: string, mimeType: string): Promise<boolean>;
  saveToMediaStoreDownloads(
    sourcePath: string,
    fileName: string,
    mimeType: string
  ): Promise<string>;
  flushCookies(): Promise<boolean>;
  clearAllCookies(): Promise<boolean>;
  hasPanoptoAuthCookie(): Promise<boolean>;
  saveFileWithSystemExplorer(
    sourcePath: string,
    fileName: string,
    mimeType: string
  ): Promise<{ saved: boolean; uri?: string; cancelled?: boolean }>;
  fetchMoodleMobileTokenViaLaunch(
    username: string | null,
    idNumber: string | null,
    password: string | null
  ): Promise<{ token?: string; redirectUrl?: string }>;
}

export interface SaveExplorerResult {
  saved: boolean;
  uri?: string;
  cancelled?: boolean;
  unsupported?: boolean;
  errorCode?: string;
  error?: string;
}

export interface MoodleTokenLaunchResult {
  token?: string;
  redirectUrl?: string;
  errorCode?: string;
  unsupported?: boolean;
}

const isJestEnv =
  typeof process !== 'undefined' && Boolean(process.env?.JEST_WORKER_ID);

function getNoodleNative(): NoodleNativeModuleInterface | null {
  if (Platform.OS !== 'android' || isJestEnv) {
    return null;
  }
  const mod = NativeModules?.NoodleNative as NoodleNativeModuleInterface | undefined;
  return mod || null;
}

export function isNoodleNativeAvailable(): boolean {
  return getNoodleNative() !== null;
}

export async function openContentUriNative(
  contentUri: string,
  mimeType: string
): Promise<{ opened: boolean; errorCode?: string; error?: string }> {
  const mod = getNoodleNative();
  if (!mod || typeof mod.openContentUri !== 'function') {
    return { opened: false };
  }
  try {
    const ok = await mod.openContentUri(contentUri, mimeType || '*/*');
    return { opened: Boolean(ok) };
  } catch (err: any) {
    const code = typeof err?.code === 'string' ? err.code : undefined;
    return {
      opened: false,
      errorCode: code,
      error: err?.message || 'Failed to open file with external viewer.',
    };
  }
}

export async function saveToMediaStoreDownloadsNative(
  sourcePath: string,
  fileName: string,
  mimeType: string
): Promise<string | null> {
  const mod = getNoodleNative();
  if (!mod || typeof mod.saveToMediaStoreDownloads !== 'function') {
    return null;
  }
  try {
    const uri = await mod.saveToMediaStoreDownloads(sourcePath, fileName, mimeType);
    return typeof uri === 'string' && uri.length > 0 ? uri : null;
  } catch (err: any) {
    if (err?.code !== 'API_BELOW_Q') {
      console.warn('[nativeBridge] saveToMediaStoreDownloads failed:', err?.message || err);
    }
    return null;
  }
}

export async function flushCookiesNative(): Promise<boolean> {
  const mod = getNoodleNative();
  if (!mod || typeof mod.flushCookies !== 'function') {
    return false;
  }
  try {
    return Boolean(await mod.flushCookies());
  } catch (err: any) {
    console.warn('[nativeBridge] flushCookies failed:', err?.message || err);
    return false;
  }
}

export async function clearAllCookiesNative(): Promise<boolean> {
  const mod = getNoodleNative();
  if (!mod || typeof mod.clearAllCookies !== 'function') {
    return false;
  }
  try {
    return Boolean(await mod.clearAllCookies());
  } catch (err: any) {
    console.warn('[nativeBridge] clearAllCookies failed:', err?.message || err);
    return false;
  }
}

export async function hasPanoptoAuthCookieNative(): Promise<boolean> {
  const mod = getNoodleNative();
  if (!mod || typeof mod.hasPanoptoAuthCookie !== 'function') {
    return false;
  }
  try {
    return Boolean(await mod.hasPanoptoAuthCookie());
  } catch (err: any) {
    console.warn('[nativeBridge] hasPanoptoAuthCookie failed:', err?.message || err);
    return false;
  }
}

export async function saveFileWithSystemExplorerNative(
  sourcePath: string,
  fileName: string,
  mimeType: string
): Promise<SaveExplorerResult> {
  const mod = getNoodleNative();
  if (!mod || typeof mod.saveFileWithSystemExplorer !== 'function') {
    return { saved: false, unsupported: true };
  }
  try {
    const res = await mod.saveFileWithSystemExplorer(
      sourcePath,
      fileName,
      mimeType || 'application/octet-stream'
    );
    return {
      saved: Boolean(res?.saved),
      uri: typeof res?.uri === 'string' && res.uri.length > 0 ? res.uri : undefined,
      cancelled: Boolean(res?.cancelled),
    };
  } catch (err: any) {
    const code = typeof err?.code === 'string' ? err.code : undefined;
    if (code === 'ACTIVITY_NOT_FOUND') {
      return {
        saved: false,
        unsupported: true,
        errorCode: code,
        error: err?.message,
      };
    }
    return {
      saved: false,
      cancelled: false,
      errorCode: code,
      error: err?.message || 'Failed to save file with system explorer.',
    };
  }
}

export async function fetchMoodleMobileTokenViaLaunchNative(creds?: {
  username?: string;
  idNumber?: string;
  password?: string;
}): Promise<MoodleTokenLaunchResult> {
  const mod = getNoodleNative();
  if (!mod || typeof mod.fetchMoodleMobileTokenViaLaunch !== 'function') {
    return { unsupported: true };
  }
  try {
    const res = await mod.fetchMoodleMobileTokenViaLaunch(
      creds?.username ?? null,
      creds?.idNumber ?? null,
      creds?.password ?? null
    );
    return {
      token: typeof res?.token === 'string' && res.token.length > 0 ? res.token : undefined,
      redirectUrl: typeof res?.redirectUrl === 'string' ? res.redirectUrl : undefined,
    };
  } catch (err: any) {
    return {
      errorCode: typeof err?.code === 'string' ? err.code : 'TOKEN_LAUNCH_FAILED',
    };
  }
}
