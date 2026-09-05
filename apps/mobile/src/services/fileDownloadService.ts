import { Paths, File } from 'expo-file-system';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { getMoodleToken, setMoodleToken } from './backgroundSync';
import { getStoredCredentials, loginTauSso } from './auth';

export interface MoodleFileItem {
  id?: number;
  file_name: string;
  file_url: string;
  mime_type?: string;
  file_size?: number;
}

export function sanitizeFileName(name: string): string {
  // Strip characters illegal on Android/FAT32 filesystems
  let clean = name.replace(/[\\/:*?"<>|]/g, '_').trim();
  if (!clean) {
    clean = `file_${Date.now()}`;
  }
  return clean;
}

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36';

/**
 * Downloads a file from Moodle with browser-like headers, automatic token refresh
 * on auth/timeout failures, sanitized filename, and legacy download fallback.
 */
export async function downloadMoodleFile(
  file: MoodleFileItem,
  onProgress?: (progressPercent: number) => void
): Promise<{ success: boolean; uri?: string; error?: string }> {
  try {
    let token = await getMoodleToken();
    if (!token) {
      // Try logging in if credentials exist
      const creds = await getStoredCredentials();
      if (creds) {
        token = await loginTauSso(creds.username, creds.idNumber, creds.password);
        await setMoodleToken(token);
      } else {
        return { success: false, error: 'Moodle token not found. Please log in again.' };
      }
    }

    const cleanName = sanitizeFileName(file.file_name);
    const targetFile = new File(Paths.document, cleanName);

    // If already downloaded and exists with positive size, directly open/share
    if (targetFile.exists && targetFile.size > 0) {
      console.log(`File already cached locally: ${targetFile.uri}`);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(targetFile.uri, {
          mimeType: file.mime_type,
          dialogTitle: `Open ${cleanName}`,
        });
      }
      return { success: true, uri: targetFile.uri };
    }

    const downloadWithToken = async (activeToken: string): Promise<string> => {
      const separator = file.file_url.includes('?') ? '&' : '?';
      const authenticatedUrl = `${file.file_url}${separator}token=${activeToken}`;

      // Strategy 1: Modern File.downloadFileAsync with headers
      try {
        const result = await File.downloadFileAsync(authenticatedUrl, targetFile, {
          idempotent: true,
          headers: {
            'User-Agent': BROWSER_USER_AGENT,
            'Accept': '*/*',
            'Accept-Encoding': 'gzip, deflate, br',
          },
        });
        if (result && result.uri) {
          return result.uri;
        }
      } catch (err: any) {
        console.warn('File.downloadFileAsync failed, attempting legacy downloadAsync fallback...', err?.message);
      }

      // Strategy 2: Legacy FileSystem.downloadAsync with custom headers
      const legacyTargetUri = `${FileSystemLegacy.documentDirectory}${encodeURIComponent(cleanName)}`;
      const legacyResult = await FileSystemLegacy.downloadAsync(authenticatedUrl, legacyTargetUri, {
        headers: {
          'User-Agent': BROWSER_USER_AGENT,
          'Accept': '*/*',
        },
      });

      if (legacyResult && legacyResult.status === 200) {
        return legacyResult.uri;
      }

      throw new Error(`Download failed with HTTP status ${legacyResult?.status || 'unknown'}`);
    };

    let downloadedUri: string | null = null;
    try {
      downloadedUri = await downloadWithToken(token);
    } catch (primaryErr: any) {
      const errMsg = String(primaryErr?.message || primaryErr);
      const isTimeoutOrAuth =
        errMsg.includes('SocketTimeoutException') ||
        errMsg.includes('timeout') ||
        errMsg.includes('401') ||
        errMsg.includes('403') ||
        errMsg.includes('UnableToDownload');

      if (isTimeoutOrAuth) {
        console.warn('Download encountered timeout or auth error. Attempting token re-login...', errMsg);
        const creds = await getStoredCredentials();
        if (creds) {
          try {
            const freshToken = await loginTauSso(creds.username, creds.idNumber, creds.password);
            await setMoodleToken(freshToken);
            downloadedUri = await downloadWithToken(freshToken);
          } catch (retryErr: any) {
            console.error('Retry after re-login failed:', retryErr);
            throw retryErr;
          }
        } else {
          throw primaryErr;
        }
      } else {
        throw primaryErr;
      }
    }

    if (downloadedUri) {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(downloadedUri, {
          mimeType: file.mime_type,
          dialogTitle: `Open ${cleanName}`,
        });
      }
      return { success: true, uri: downloadedUri };
    }

    return { success: false, error: 'Download failed to produce a file.' };
  } catch (e: any) {
    console.error('downloadMoodleFile error:', e);
    return {
      success: false,
      error: e.message || 'An error occurred during file download. Please check your connection.',
    };
  }
}
