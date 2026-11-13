import browser from 'webextension-polyfill';
import { ChromiumFsaProvider } from './ChromiumFsaProvider.js';
import { FirefoxDownloadsProvider } from './FirefoxDownloadsProvider.js';

export type SyncBackendType = 'fsa' | 'downloads';
export type FilePresenceState = 'present' | 'missing' | 'unverifiable';
export type SyncedFileOrigin = 'fsa' | 'download' | 'scan';

export interface SyncedFileRecord {
  moodleFileId: string;
  relativePath: string; // e.g., "0368-2158 Data Structures/Week 1/Lecture1.pdf"
  lastModified: number;
  size?: number;
  canonicalUrlPath?: string;
  syncedAt?: number;
  /** Chromium: unnecessary (resolved via DirectoryHandle). Firefox: tracks browser.downloads item ID */
  downloadId?: number;
  origin?: SyncedFileOrigin;
}

export interface LocalAdoptionCandidate {
  moodleFileId: string;
  relativePath: string;
  fileName: string;
  fileSize: number;
  timeModified: number;
  canonicalUrlPath: string;
}

export interface FileSystemProvider {
  readonly backendType: SyncBackendType;

  /**
   * Returns true if the provider is configured and has valid permissions.
   * - Chromium: checks IndexedDB for stored FileSystemDirectoryHandle + queryPermission({ mode: 'readwrite' }).
   * - Firefox: returns true (uses Downloads/<rootSubfolder> by default).
   */
  isReady(): Promise<boolean>;

  /**
   * Prompts the user to configure or re-grant access to the target directory.
   * - Chromium: calls window.showDirectoryPicker({ mode: 'readwrite' }) and persists handle in IndexedDB.
   * - Firefox: sets/updates the root subfolder name inside Downloads (e.g., "Noodle").
   */
  selectRootDirectory(customSubfolder?: string): Promise<{ success: boolean; displayPath: string }>;

  /**
   * Checks whether a previously synced file still exists on the local disk.
   * - Chromium: traverses FileSystemDirectoryHandle path and calls getFileHandle(name, { create: false }).
   * - Firefox: calls browser.downloads.search({ id: record.downloadId }) and checks item.exists.
   */
  fileExists(record: SyncedFileRecord): Promise<boolean>;

  /**
   * Tri-state verification used by autoResyncMissingFiles so backends where external files
   * cannot be verified (e.g., Firefox scanned/rclone files lacking a downloadId) return
   * 'unverifiable' instead of triggering destructive/redundant re-downloads.
   */
  checkFilePresence?(record: SyncedFileRecord): Promise<FilePresenceState>;

  /**
   * Writes/downloads a file into the mirrored folder structure.
   */
  writeFile(
    record: Omit<SyncedFileRecord, 'downloadId'>,
    source: {
      url: string;
      blob?: Blob;
      stream?: ReadableStream<Uint8Array>;
      maxBytes?: number;
    }
  ): Promise<SyncedFileRecord>;

  /**
   * Opens the locally mirrored file (#5). Must be called inside a user gesture handler (e.g. click).
   */
  openLocalFile(record: SyncedFileRecord): Promise<boolean>;

  /**
   * Checks whether previously planned files already exist locally on disk (e.g. after reinstall
   * or switching machines) so they can be adopted into the manifest without re-downloading.
   */
  adoptExistingFiles?(
    candidates: LocalAdoptionCandidate[]
  ): Promise<Record<string, SyncedFileRecord>>;

  /**
   * Reveals the file in the OS file manager (Explorer / Finder / Dolphin).
   */
  revealInFileManager?(record: SyncedFileRecord): Promise<void>;
}

export function isFirefoxExtensionRuntime(): boolean {
  try {
    const rootUrl = browser?.runtime?.getURL?.('');
    if (typeof rootUrl === 'string' && rootUrl.startsWith('moz-extension://')) {
      return true;
    }
  } catch {
    // Ignore outside runtime
  }
  if (typeof navigator !== 'undefined') {
    const ua = navigator.userAgent || '';
    if (/Firefox|Gecko\//i.test(ua) && !/Chrome|Chromium|Edg/i.test(ua)) {
      return true;
    }
  }
  return false;
}

/**
 * Factory selector safe across both UI windows and MV3 Service Workers (where `window` is undefined).
 */
export function createFileSystemProvider(): FileSystemProvider {
  if (typeof window !== 'undefined') {
    if ('showDirectoryPicker' in window) {
      return new ChromiumFsaProvider();
    }
    if (isFirefoxExtensionRuntime()) {
      return new FirefoxDownloadsProvider();
    }
    return new ChromiumFsaProvider();
  }

  return isFirefoxExtensionRuntime()
    ? new FirefoxDownloadsProvider()
    : new ChromiumFsaProvider();
}

