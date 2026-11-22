import { Linking, Platform } from 'react-native';
import {
  CourseFolder,
  buildAuthenticatedFileUrl,
  downloadFolderAsZip,
} from '@tautracker/moodle-client';
import { getStoredToken, renewTokenSilently } from './auth';
import { getPreference, setPreference } from './database';
import {
  openContentUriNative,
  saveFileWithSystemExplorerNative,
  saveToMediaStoreDownloadsNative,
} from './nativeBridge';

export interface MoodleFileItem {
  id?: number;
  file_name: string;
  file_url: string;
  mime_type?: string;
  file_size?: number;
}

export type FileDownloadAction = 'download' | 'open' | 'share';

export interface FileDownloadResult {
  success: boolean;
  uri?: string;
  savedToDownloads?: boolean;
  cancelled?: boolean;
  fileName?: string;
  error?: string;
}

const ANDROID_DOWNLOAD_DIR_PREF = 'android_download_dir_uri';
const CACHE_SUBDIR = 'noodle-files';

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36';

// In-memory cache index so UI render loops never hit synchronous disk stat() repeatedly
const cachedKeysSet = new Set<string>();
const cachedNamesSet = new Set<string>();
const diskProbeCache = new Map<string, boolean>();

function getFileSystemModule(): typeof import('expo-file-system') | null {
  if (Platform.OS === 'web') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-file-system');
  } catch {
    return null;
  }
}

function getFileSystemLegacyModule(): typeof import('expo-file-system/legacy') | null {
  if (Platform.OS === 'web') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-file-system/legacy');
  } catch {
    return null;
  }
}

function getSharingModule(): typeof import('expo-sharing') | null {
  if (Platform.OS === 'web') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-sharing');
  } catch {
    return null;
  }
}

function shortHash(input: string): string {
  // Deterministic 32-bit FNV-1a hash in base36 (pure JS, no Node crypto)
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}

export function sanitizeFileName(name: string): string {
  // Strip control chars, FAT32/Android illegal chars, and URI-unsafe chars that break new File(...)
  let clean = (name || '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[\\/:*?"<>|[\]{}^`%#]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  // Avoid leading/trailing dots or empty names
  clean = clean.replace(/^\.+/, '').replace(/\.+$/, '').trim();
  if (!clean) {
    clean = `file_${Date.now()}`;
  }
  return clean;
}

function getFileExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === fileName.length - 1) {
    return '';
  }
  return fileName.slice(lastDot + 1).toLowerCase();
}

export function resolveMimeType(fileName: string, explicitMime?: string): string {
  if (explicitMime && explicitMime.trim()) {
    return explicitMime.trim();
  }
  const ext = getFileExtension(fileName);
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    zip: 'application/zip',
    rar: 'application/vnd.rar',
    '7z': 'application/x-7z-compressed',
    tar: 'application/x-tar',
    gz: 'application/gzip',
    txt: 'text/plain',
    csv: 'text/csv',
    json: 'application/json',
    html: 'text/html',
    htm: 'text/html',
    md: 'text/markdown',
    tex: 'application/x-tex',
    rtf: 'application/rtf',
    epub: 'application/epub+zip',
    // Code / STEM university files
    py: 'text/x-python',
    c: 'text/x-c',
    cpp: 'text/x-c++src',
    h: 'text/x-chdr',
    java: 'text/x-java-source',
    js: 'text/javascript',
    ts: 'text/typescript',
    m: 'text/x-matlab',
    ipynb: 'application/x-ipynb+json',
    // Images
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    heic: 'image/heic',
    // Office / OpenDocument
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    odt: 'application/vnd.oasis.opendocument.text',
    ods: 'application/vnd.oasis.opendocument.spreadsheet',
    odp: 'application/vnd.oasis.opendocument.presentation',
    // Audio / Video
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    mkv: 'video/x-matroska',
  };
  return (ext && map[ext]) || 'application/octet-stream';
}

function buildNormalizedAuthenticatedFileUrl(rawUrl: string, token: string): string {
  let normalized = (rawUrl || '').trim();
  // Normalize /pluginfile.php/ -> /webservice/pluginfile.php/ when not already under /webservice/
  if (/\/pluginfile\.php\//i.test(normalized) && !/\/webservice\/pluginfile\.php\//i.test(normalized)) {
    normalized = normalized.replace(/\/pluginfile\.php\//i, '/webservice/pluginfile.php/');
  }

  // Strip any existing token= query parameter before delegating to buildAuthenticatedFileUrl
  try {
    const parsed = new URL(normalized);
    parsed.searchParams.delete('token');
    normalized = parsed.toString();
  } catch {
    normalized = normalized
      .replace(/([?&])token=[^&]*&?/i, '$1')
      .replace(/[?&]$/, '');
  }

  return buildAuthenticatedFileUrl(normalized, token);
}

function getCacheKey(cleanName: string, fileUrl?: string): string {
  const hashSegment = fileUrl ? shortHash(fileUrl) : 'default';
  return `${hashSegment}/${cleanName}`;
}

function ensureCacheTargetFile(
  fs: typeof import('expo-file-system'),
  cleanName: string,
  fileUrl?: string
): { dir: InstanceType<typeof fs.Directory>; file: InstanceType<typeof fs.File>; tmpFile: InstanceType<typeof fs.File>; cacheKey: string } {
  const hashSegment = fileUrl ? shortHash(fileUrl) : 'default';
  const dir = new fs.Directory(fs.Paths.cache, CACHE_SUBDIR, hashSegment);
  try {
    if (!dir.exists) {
      dir.create({ intermediates: true, idempotent: true });
    }
  } catch {
    // Directory may already exist or mock may not implement intermediates
    try {
      dir.create();
    } catch {}
  }
  const file = new fs.File(dir, cleanName);
  const tmpFile = new fs.File(dir, `${cleanName}.tmp`);
  return { dir, file, tmpFile, cacheKey: `${hashSegment}/${cleanName}` };
}

function markFileCached(cleanName: string, cacheKey: string): void {
  cachedKeysSet.add(cacheKey);
  cachedNamesSet.add(cleanName);
  diskProbeCache.set(cacheKey, true);
}

export function isFileCachedLocally(fileName: string, fileUrl?: string): boolean {
  if (Platform.OS === 'web') return false;
  const cleanName = sanitizeFileName(fileName);
  if (fileUrl) {
    const cacheKey = getCacheKey(cleanName, fileUrl);
    if (cachedKeysSet.has(cacheKey)) return true;
    const probed = diskProbeCache.get(cacheKey);
    if (probed !== undefined) return probed;

    const fs = getFileSystemModule();
    if (!fs) return false;
    try {
      const hashSegment = shortHash(fileUrl);
      const targetFile = new fs.File(fs.Paths.cache, CACHE_SUBDIR, hashSegment, cleanName);
      const exists = Boolean(targetFile.exists && targetFile.size > 0);
      diskProbeCache.set(cacheKey, exists);
      if (exists) {
        cachedKeysSet.add(cacheKey);
        cachedNamesSet.add(cleanName);
      }
      return exists;
    } catch {
      diskProbeCache.set(cacheKey, false);
      return false;
    }
  }

  // Backward-compatible call with only fileName
  if (cachedNamesSet.has(cleanName)) return true;
  const probed = diskProbeCache.get(`name:${cleanName}`);
  if (probed !== undefined) return probed;

  const fs = getFileSystemModule();
  if (!fs) return false;
  try {
    // Check legacy document path or default cache path once
    const legacyFile = new fs.File(fs.Paths.document, cleanName);
    const exists = Boolean(legacyFile.exists && legacyFile.size > 0);
    diskProbeCache.set(`name:${cleanName}`, exists);
    if (exists) {
      cachedNamesSet.add(cleanName);
    }
    return exists;
  } catch {
    diskProbeCache.set(`name:${cleanName}`, false);
    return false;
  }
}

async function readFilePrefixText(
  fs: typeof import('expo-file-system'),
  fsLegacy: typeof import('expo-file-system/legacy') | null,
  fileObj: InstanceType<typeof fs.File>,
  uri: string
): Promise<string> {
  try {
    if (typeof fileObj.open === 'function' && fs.FileMode?.ReadOnly !== undefined) {
      const handle = fileObj.open(fs.FileMode.ReadOnly);
      try {
        const len = Math.min(512, Math.max(0, Number(fileObj.size) || 512));
        if (len === 0) return '';
        const bytes = handle.readBytes(len);
        let out = '';
        for (let i = 0; i < bytes.length; i++) {
          out += String.fromCharCode(bytes[i]);
        }
        return out;
      } finally {
        try {
          handle.close();
        } catch {}
      }
    }
  } catch {
    // Fall back to legacy partial read
  }

  if (fsLegacy && typeof fsLegacy.readAsStringAsync === 'function') {
    try {
      const chunk = await fsLegacy.readAsStringAsync(uri, {
        encoding: fsLegacy.EncodingType.UTF8,
        length: 512,
        position: 0,
      } as any);
      return typeof chunk === 'string' ? chunk.slice(0, 512) : '';
    } catch {
      return '';
    }
  }
  return '';
}

function validateDownloadedPayload(
  cleanName: string,
  prefixText: string,
  contentTypeHeader?: string
): void {
  const ext = getFileExtension(cleanName);
  const expectsHtml = ext === 'html' || ext === 'htm';
  const expectsJson = ext === 'json' || ext === 'ipynb';
  const ct = (contentTypeHeader || '').toLowerCase();
  const trimmed = (prefixText || '').trimStart();
  const lower = trimmed.toLowerCase();

  if (!expectsHtml) {
    if (
      ct.includes('text/html') ||
      lower.startsWith('<!doctype') ||
      lower.startsWith('<html')
    ) {
      const authErr: any = new Error('Received HTML login/error page instead of file (expired token).');
      authErr.errorcode = 'invalidtoken';
      throw authErr;
    }
  }

  if (!expectsJson) {
    if (
      lower.startsWith('{"exception"') ||
      lower.startsWith('{"errorcode"') ||
      lower.startsWith('{"error"')
    ) {
      const authErr: any = new Error('Received Moodle JSON error instead of file.');
      authErr.errorcode = 'invalidtoken';
      throw authErr;
    }
  }
}

type SafSaveResult =
  | { status: 'saved'; uri?: string }
  | { status: 'cancelled' }
  | { status: 'failed' };

async function saveToDeviceDownloadsAndroidSaf(
  sourceUri: string,
  cleanName: string,
  mimeType?: string
): Promise<SafSaveResult> {
  if (Platform.OS !== 'android') {
    return { status: 'failed' };
  }
  const fsLegacy = getFileSystemLegacyModule();
  const saf = fsLegacy?.StorageAccessFramework;
  if (!fsLegacy || !saf) {
    return { status: 'failed' };
  }

  const effectiveMime = resolveMimeType(cleanName, mimeType);
  let base64Cache: string | null = null;
  const readSourceBase64 = async (): Promise<string> => {
    if (base64Cache !== null) return base64Cache;
    base64Cache = await fsLegacy.readAsStringAsync(sourceUri, {
      encoding: fsLegacy.EncodingType.Base64,
    });
    return base64Cache;
  };

  const writeIntoSafDirectory = async (dirUri: string): Promise<string> => {
    const destUri = await saf.createFileAsync(dirUri, cleanName, effectiveMime);
    const base64Data = await readSourceBase64();
    await fsLegacy.writeAsStringAsync(destUri, base64Data, {
      encoding: fsLegacy.EncodingType.Base64,
    });
    return destUri;
  };

  let savedDirUri = '';
  try {
    savedDirUri = getPreference(ANDROID_DOWNLOAD_DIR_PREF) || '';
  } catch {
    savedDirUri = '';
  }

  if (savedDirUri) {
    try {
      const destUri = await writeIntoSafDirectory(savedDirUri);
      return { status: 'saved', uri: destUri };
    } catch {
      // Stored SAF grant may have been revoked; prompt again cleanly
      savedDirUri = '';
    }
  }

  try {
    const initialUri =
      typeof saf.getUriForDirectoryInRoot === 'function'
        ? saf.getUriForDirectoryInRoot('Download')
        : undefined;
    const perm = await saf.requestDirectoryPermissionsAsync(initialUri);
    if (!perm?.granted || !perm.directoryUri) {
      return { status: 'cancelled' };
    }
    try {
      setPreference(ANDROID_DOWNLOAD_DIR_PREF, perm.directoryUri);
    } catch {
      // Ignore pref write error
    }
    const destUri = await writeIntoSafDirectory(perm.directoryUri);
    return { status: 'saved', uri: destUri };
  } catch (err) {
    console.warn('StorageAccessFramework save failed:', err);
    return { status: 'failed' };
  }
}

async function resolveActiveToken(): Promise<string | null> {
  const token = await getStoredToken();
  if (token) return token;
  const renewed = await renewTokenSilently();
  return typeof renewed === 'string' ? renewed : (renewed as { token?: string } | null)?.token ?? null;
}

function isAuthOrTimeoutError(err: unknown): boolean {
  const e = err as { errorcode?: string; message?: string } | null | undefined;
  const code = String(e?.errorcode || '').toLowerCase();
  const errMsg = String(e?.message || err || '');
  return (
    code === 'invalidtoken' ||
    code === 'accessexception' ||
    errMsg.includes('SocketTimeoutException') ||
    errMsg.toLowerCase().includes('timeout') ||
    errMsg.includes('401') ||
    errMsg.includes('403') ||
    errMsg.includes('UnableToDownload') ||
    errMsg.toLowerCase().includes('invalidtoken')
  );
}

/**
 * Downloads, opens, or shares a file from Moodle (or opens authenticated URL via Linking on web).
 * - `action: 'download'` (default): saves to device Downloads/Noodle on Android via MediaStore (with SAF fallback).
 * - `action: 'open'`: opens in native OS viewer (`ACTION_VIEW` + `FLAG_GRANT_READ_URI_PERMISSION` on Android, preview/share on iOS).
 * - `action: 'share'`: opens the system share sheet.
 */
export async function downloadMoodleFile(
  file: MoodleFileItem,
  onProgress?: (progressPercent: number) => void,
  options?: { action?: FileDownloadAction }
): Promise<FileDownloadResult> {
  const action: FileDownloadAction = options?.action || 'download';
  try {
    if (!file?.file_url) {
      return { success: false, error: 'Invalid file URL.' };
    }

    const token = await resolveActiveToken();
    if (!token) {
      return { success: false, error: 'Moodle token not found. Please log in again.' };
    }

    const authenticatedUrl = buildNormalizedAuthenticatedFileUrl(file.file_url, token);
    const cleanName = sanitizeFileName(file.file_name);

    if (Platform.OS === 'web') {
      if (action === 'download' && typeof document !== 'undefined') {
        const anchor = document.createElement('a');
        anchor.href = authenticatedUrl;
        anchor.download = cleanName;
        anchor.target = '_blank';
        anchor.rel = 'noreferrer';
        anchor.click();
      } else {
        await Linking.openURL(authenticatedUrl);
      }
      onProgress?.(100);
      return { success: true, uri: authenticatedUrl, fileName: cleanName };
    }

    const fs = getFileSystemModule();
    const fsLegacy = getFileSystemLegacyModule();
    const sharing = getSharingModule();

    if (!fs) {
      await Linking.openURL(authenticatedUrl);
      onProgress?.(100);
      return { success: true, uri: authenticatedUrl, fileName: cleanName };
    }

    const resolvedMime = resolveMimeType(cleanName, file.mime_type);
    const { file: targetFile, tmpFile, cacheKey } = ensureCacheTargetFile(fs, cleanName, file.file_url);

    const handleLocalUri = async (localUri: string): Promise<FileDownloadResult> => {
      onProgress?.(100);

      if (action === 'share') {
        if (sharing && (await sharing.isAvailableAsync())) {
          await sharing.shareAsync(localUri, {
            mimeType: resolvedMime,
            dialogTitle: cleanName,
          });
          return { success: true, uri: localUri, fileName: cleanName };
        }
        return {
          success: false,
          uri: localUri,
          fileName: cleanName,
          error: 'Sharing is not available on this device.',
        };
      }

      if (action === 'open') {
        if (Platform.OS === 'android' && fsLegacy?.getContentUriAsync) {
          try {
            const contentUri = await fsLegacy.getContentUriAsync(localUri);
            const nativeRes = await openContentUriNative(contentUri, resolvedMime);
            if (nativeRes.opened) {
              return { success: true, uri: contentUri, fileName: cleanName };
            }
            if (nativeRes.errorCode === 'NO_ACTIVITY') {
              return {
                success: false,
                uri: localUri,
                fileName: cleanName,
                error: 'NO_VIEWER_INSTALLED',
              };
            }
            // Native bridge unavailable (e.g., Expo Go / Jest) -> fallback to Linking
            try {
              await Linking.openURL(contentUri);
              return { success: true, uri: contentUri, fileName: cleanName };
            } catch {
              // Fall through to shareAsync
            }
          } catch {
            // Fall back to OS viewer via shareAsync if getContentUriAsync failed
          }
        }

        if (sharing && (await sharing.isAvailableAsync())) {
          await sharing.shareAsync(localUri, {
            mimeType: resolvedMime,
            dialogTitle: `Open ${cleanName}`,
          });
          return { success: true, uri: localUri, fileName: cleanName };
        }

        if (Platform.OS === 'ios') {
          return { success: true, uri: localUri, fileName: cleanName };
        }

        return {
          success: false,
          uri: localUri,
          fileName: cleanName,
          error: 'NO_VIEWER_INSTALLED',
        };
      }

      // action === 'download': on Android, launch system file explorer first (ACTION_CREATE_DOCUMENT)
      if (Platform.OS === 'android') {
        let explorerUnsupported = false;
        try {
          const explorerRes = await saveFileWithSystemExplorerNative(
            localUri,
            cleanName,
            resolvedMime
          );
          if (explorerRes.saved) {
            return {
              success: true,
              uri: explorerRes.uri || localUri,
              savedToDownloads: true,
              fileName: cleanName,
            };
          }
          if (explorerRes.cancelled) {
            return {
              success: true,
              cancelled: true,
              savedToDownloads: false,
              fileName: cleanName,
            };
          }
          if (explorerRes.unsupported) {
            explorerUnsupported = true;
          } else {
            return {
              success: false,
              uri: localUri,
              savedToDownloads: false,
              fileName: cleanName,
              error: explorerRes.error || 'Failed to save file with system explorer.',
            };
          }
        } catch (explorerErr: any) {
          if (explorerErr?.code === 'ACTIVITY_NOT_FOUND') {
            explorerUnsupported = true;
          } else {
            return {
              success: false,
              uri: localUri,
              savedToDownloads: false,
              fileName: cleanName,
              error: explorerErr?.message || 'Failed to save file with system explorer.',
            };
          }
        }

        if (explorerUnsupported) {
          const mediaStoreUri = await saveToMediaStoreDownloadsNative(
            localUri,
            cleanName,
            resolvedMime
          );
          if (mediaStoreUri) {
            return {
              success: true,
              uri: mediaStoreUri,
              savedToDownloads: true,
              fileName: cleanName,
            };
          }

          // Fallback to SAF on API < 29 or when native module is unavailable
          const safResult = await saveToDeviceDownloadsAndroidSaf(
            localUri,
            cleanName,
            resolvedMime
          );
          if (safResult.status === 'saved') {
            return {
              success: true,
              uri: safResult.uri || localUri,
              savedToDownloads: true,
              fileName: cleanName,
            };
          }
          if (safResult.status === 'cancelled') {
            return {
              success: true,
              cancelled: true,
              savedToDownloads: false,
              fileName: cleanName,
            };
          }
        }
      }

      if (sharing && (await sharing.isAvailableAsync())) {
        await sharing.shareAsync(localUri, {
          mimeType: resolvedMime,
          dialogTitle: `Save ${cleanName}`,
        });
        return { success: true, uri: localUri, savedToDownloads: false, fileName: cleanName };
      }

      return {
        success: false,
        uri: localUri,
        savedToDownloads: false,
        fileName: cleanName,
        error: 'Sharing is not available on this device.',
      };
    };

    // If already cached locally with positive size, perform requested action immediately
    if (targetFile.exists && targetFile.size > 0) {
      markFileCached(cleanName, cacheKey);
      return await handleLocalUri(targetFile.uri);
    }

    const cleanupTmp = () => {
      try {
        if (tmpFile.exists) {
          tmpFile.delete();
        }
      } catch {}
    };

    const promoteTmpToTarget = async (downloadedTmpUri: string): Promise<string> => {
      try {
        if (targetFile.exists) {
          targetFile.delete();
        }
      } catch {}

      try {
        if (typeof tmpFile.move === 'function' && downloadedTmpUri === tmpFile.uri) {
          tmpFile.move(targetFile);
          markFileCached(cleanName, cacheKey);
          return targetFile.uri;
        }
      } catch {
        // Fallback to legacy moveAsync
      }

      if (fsLegacy && typeof fsLegacy.moveAsync === 'function') {
        await fsLegacy.moveAsync({ from: downloadedTmpUri, to: targetFile.uri });
        markFileCached(cleanName, cacheKey);
        return targetFile.uri;
      }

      markFileCached(cleanName, cacheKey);
      return downloadedTmpUri;
    };

    const downloadWithToken = async (activeToken: string): Promise<string> => {
      const urlWithToken = buildNormalizedAuthenticatedFileUrl(file.file_url, activeToken);
      cleanupTmp();

      let tmpUri: string | null = null;
      let responseContentType: string | undefined;

      // Strategy 1: Modern File.downloadFileAsync (no Accept-Encoding header so OkHttp transparently handles compression)
      try {
        const result = await fs.File.downloadFileAsync(urlWithToken, tmpFile, {
          idempotent: true,
          headers: {
            'User-Agent': BROWSER_USER_AGENT,
            Accept: '*/*',
          },
        });
        if (result && result.uri) {
          tmpUri = result.uri;
        }
      } catch (err: any) {
        console.warn('File.downloadFileAsync failed, attempting legacy downloadAsync fallback...', err?.message);
      }

      // Strategy 2: Legacy FileSystem.downloadAsync with custom headers
      if (!tmpUri && fsLegacy) {
        const legacyTargetUri = tmpFile.uri;
        const legacyResult = await fsLegacy.downloadAsync(urlWithToken, legacyTargetUri, {
          headers: {
            'User-Agent': BROWSER_USER_AGENT,
            Accept: '*/*',
          },
        });

        if (legacyResult && legacyResult.status === 200) {
          tmpUri = legacyResult.uri;
          const headers = legacyResult.headers || {};
          responseContentType =
            headers['Content-Type'] || headers['content-type'] || undefined;
        } else {
          cleanupTmp();
          throw new Error(`Download failed with HTTP status ${legacyResult?.status || 'unknown'}`);
        }
      }

      if (!tmpUri) {
        cleanupTmp();
        throw new Error('File download failed on this device.');
      }

      // Validate downloaded payload before promoting to cache
      try {
        const prefix = await readFilePrefixText(fs, fsLegacy, tmpFile, tmpUri);
        validateDownloadedPayload(cleanName, prefix, responseContentType);
      } catch (validationErr) {
        cleanupTmp();
        throw validationErr;
      }

      return await promoteTmpToTarget(tmpUri);
    };

    let downloadedUri: string | null = null;
    try {
      onProgress?.(10);
      downloadedUri = await downloadWithToken(token);
    } catch (primaryErr: unknown) {
      if (isAuthOrTimeoutError(primaryErr)) {
        const renewed = await renewTokenSilently();
        const freshToken =
          typeof renewed === 'string' ? renewed : (renewed as { token?: string } | null)?.token ?? null;
        if (freshToken) {
          downloadedUri = await downloadWithToken(freshToken);
        } else {
          throw primaryErr;
        }
      } else {
        throw primaryErr;
      }
    }

    if (downloadedUri) {
      return await handleLocalUri(downloadedUri);
    }

    return { success: false, error: 'Download failed to produce a file.' };
  } catch (e: any) {
    console.error('downloadMoodleFile error:', e);
    return {
      success: false,
      error: e?.message || 'An error occurred during file download. Please check your connection.',
    };
  }
}

export async function openMoodleFile(
  file: MoodleFileItem,
  onProgress?: (progressPercent: number) => void
): Promise<FileDownloadResult> {
  return downloadMoodleFile(file, onProgress, { action: 'open' });
}

export async function shareMoodleFile(
  file: MoodleFileItem,
  onProgress?: (progressPercent: number) => void
): Promise<FileDownloadResult> {
  return downloadMoodleFile(file, onProgress, { action: 'share' });
}

export async function downloadMoodleFolderZip(
  folder: CourseFolder,
  onProgress?: (completed: number, total: number) => void
): Promise<FileDownloadResult> {
  let cleanupTempZip: (() => void) | null = null;
  try {
    let token = await resolveActiveToken();
    if (!token) {
      return { success: false, error: 'Moodle token not found. Please log in again.' };
    }

    const cleanName = `${sanitizeFileName(folder.name || 'folder')}.zip`;

    let zipBytes: Uint8Array;
    try {
      zipBytes = await downloadFolderAsZip(folder, token, onProgress);
    } catch (err: unknown) {
      if (isAuthOrTimeoutError(err)) {
        const renewed = await renewTokenSilently();
        const freshToken =
          typeof renewed === 'string' ? renewed : (renewed as { token?: string } | null)?.token ?? null;
        if (freshToken) {
          token = freshToken;
          zipBytes = await downloadFolderAsZip(folder, token, onProgress);
        } else {
          throw err;
        }
      } else {
        throw err;
      }
    }

    if (Platform.OS === 'web') {
      if (typeof Blob !== 'undefined' && typeof URL !== 'undefined' && typeof document !== 'undefined') {
        const blob = new Blob([new Uint8Array(zipBytes)], { type: 'application/zip' });
        const blobUrl = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = blobUrl;
        anchor.download = cleanName;
        anchor.click();
        URL.revokeObjectURL(blobUrl);
        return { success: true, fileName: cleanName };
      }
      if (folder.moodleUrl) {
        await Linking.openURL(folder.moodleUrl);
        return { success: true, uri: folder.moodleUrl, fileName: cleanName };
      }
      return { success: false, error: 'Web folder download is unavailable in this environment.' };
    }

    const fs = getFileSystemModule();
    const sharing = getSharingModule();
    if (!fs) {
      return { success: false, error: 'File system is unavailable on this platform.' };
    }

    const targetFile = new fs.File(fs.Paths.cache, cleanName);
    cleanupTempZip = () => {
      try {
        if (targetFile.exists) {
          targetFile.delete();
        }
      } catch {}
    };

    targetFile.create({ overwrite: true });
    if (typeof (targetFile as any).write === 'function') {
      (targetFile as any).write(zipBytes);
    } else {
      const handle = targetFile.open(fs.FileMode.WriteOnly);
      try {
        handle.writeBytes(zipBytes);
      } finally {
        handle.close();
      }
    }
    const destUri = targetFile.uri;

    if (Platform.OS === 'android') {
      let explorerUnsupported = false;
      try {
        const explorerRes = await saveFileWithSystemExplorerNative(
          destUri,
          cleanName,
          'application/zip'
        );
        if (explorerRes.saved) {
          cleanupTempZip();
          return {
            success: true,
            uri: explorerRes.uri || destUri,
            savedToDownloads: true,
            fileName: cleanName,
          };
        }
        if (explorerRes.cancelled) {
          cleanupTempZip();
          return {
            success: true,
            cancelled: true,
            savedToDownloads: false,
            fileName: cleanName,
          };
        }
        if (explorerRes.unsupported) {
          explorerUnsupported = true;
        } else {
          cleanupTempZip();
          return {
            success: false,
            savedToDownloads: false,
            fileName: cleanName,
            error: explorerRes.error || 'Failed to save ZIP with system explorer.',
          };
        }
      } catch (explorerErr: any) {
        if (explorerErr?.code === 'ACTIVITY_NOT_FOUND') {
          explorerUnsupported = true;
        } else {
          cleanupTempZip();
          return {
            success: false,
            savedToDownloads: false,
            fileName: cleanName,
            error: explorerErr?.message || 'Failed to save ZIP with system explorer.',
          };
        }
      }

      if (explorerUnsupported) {
        const mediaStoreUri = await saveToMediaStoreDownloadsNative(
          destUri,
          cleanName,
          'application/zip'
        );
        if (mediaStoreUri) {
          cleanupTempZip();
          return {
            success: true,
            uri: mediaStoreUri,
            savedToDownloads: true,
            fileName: cleanName,
          };
        }

        const safResult = await saveToDeviceDownloadsAndroidSaf(
          destUri,
          cleanName,
          'application/zip'
        );
        if (safResult.status === 'saved') {
          cleanupTempZip();
          return {
            success: true,
            uri: safResult.uri || destUri,
            savedToDownloads: true,
            fileName: cleanName,
          };
        }
        if (safResult.status === 'cancelled') {
          cleanupTempZip();
          return {
            success: true,
            cancelled: true,
            savedToDownloads: false,
            fileName: cleanName,
          };
        }
      }
    }

    if (sharing && (await sharing.isAvailableAsync())) {
      await sharing.shareAsync(destUri, {
        mimeType: 'application/zip',
        dialogTitle: cleanName,
      });
      cleanupTempZip();
      return { success: true, uri: destUri, savedToDownloads: false, fileName: cleanName };
    }

    cleanupTempZip();
    return {
      success: false,
      uri: destUri,
      savedToDownloads: false,
      fileName: cleanName,
      error: 'Sharing is not available on this device.',
    };
  } catch (err: any) {
    cleanupTempZip?.();
    console.error('downloadMoodleFolderZip error:', err);
    return { success: false, error: err?.message || 'Folder download failed' };
  }
}
