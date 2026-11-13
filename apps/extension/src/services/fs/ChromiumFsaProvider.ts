import browser from 'webextension-polyfill';
import type {
  FilePresenceState,
  FileSystemProvider,
  LocalAdoptionCandidate,
  SyncedFileRecord,
} from './FileSystemProvider.js';
import {
  getStoredDirectoryHandle,
  saveDirectoryHandle,
} from './fsaHandleStore.js';
import { sanitizeRelativePath } from '@tautracker/moodle-client';
import { getInlineMimeType } from '../../shared/mimeUtils.js';
import { setLocalFsConfig } from '../../shared/storage.js';

export type FsaPermissionState = 'unselected' | 'granted' | 'prompt' | 'denied';

interface FsaHandlePermissionExt {
  queryPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
}

export class LocalFsPermissionError extends Error {
  constructor(message = 'Local directory write permission is required', options?: ErrorOptions) {
    super(message, options);
    this.name = 'LocalFsPermissionError';
  }
}

function isFsaPermissionError(err: unknown): boolean {
  if (err instanceof LocalFsPermissionError) return true;
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: unknown }).name;
  return name === 'NotAllowedError' || name === 'SecurityError';
}

function isFsaNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: unknown }).name;
  return name === 'NotFoundError' || name === 'TypeMismatchError';
}

async function queryHandlePermission(
  handle: FileSystemDirectoryHandle,
  mode: 'read' | 'readwrite'
): Promise<PermissionState> {
  const ext = handle as unknown as FsaHandlePermissionExt;
  if (typeof ext.queryPermission === 'function') {
    return await ext.queryPermission({ mode });
  }
  return 'granted';
}

async function requestHandlePermission(
  handle: FileSystemDirectoryHandle,
  mode: 'read' | 'readwrite'
): Promise<PermissionState> {
  const ext = handle as unknown as FsaHandlePermissionExt;
  if (typeof ext.requestPermission === 'function') {
    return await ext.requestPermission({ mode });
  }
  return 'granted';
}

export class ChromiumFsaProvider implements FileSystemProvider {
  public readonly backendType = 'fsa' as const;

  public async getPermissionState(): Promise<FsaPermissionState> {
    try {
      const handle = await getStoredDirectoryHandle();
      if (!handle) return 'unselected';
      const perm = await queryHandlePermission(handle, 'readwrite');
      if (perm === 'granted') return 'granted';
      if (perm === 'denied') return 'denied';
      return 'prompt';
    } catch {
      return 'unselected';
    }
  }

  public async requestStoredPermission(): Promise<boolean> {
    const handle = await getStoredDirectoryHandle();
    if (!handle) return false;
    const perm = await requestHandlePermission(handle, 'readwrite');
    return perm === 'granted';
  }

  public async isReady(): Promise<boolean> {
    try {
      const handle = await getStoredDirectoryHandle();
      if (!handle) return false;
      return (await queryHandlePermission(handle, 'readwrite')) === 'granted';
    } catch {
      return false;
    }
  }

  public async selectRootDirectory(): Promise<{ success: boolean; displayPath: string }> {
    const picker = (window as unknown as {
      showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
    }).showDirectoryPicker;

    if (typeof picker !== 'function') {
      throw new Error('File System Access API directory picker is unavailable in this browser.');
    }

    try {
      const handle = await picker({ mode: 'readwrite' });
      const perm = await queryHandlePermission(handle, 'readwrite');
      if (perm !== 'granted') {
        const requested = await requestHandlePermission(handle, 'readwrite');
        if (requested !== 'granted') {
          return { success: false, displayPath: '' };
        }
      }
      await saveDirectoryHandle(handle);
      await setLocalFsConfig({ rootLabel: handle.name });
      return { success: true, displayPath: handle.name };
    } catch (err: unknown) {
      const e = err as { name?: string };
      if (e?.name === 'AbortError') {
        return { success: false, displayPath: '' };
      }
      throw err;
    }
  }

  private async resolveFileHandle(
    relativePath: string,
    createMissing: boolean,
    mode: 'read' | 'readwrite',
    throwOnPermission = createMissing
  ): Promise<FileSystemFileHandle | null> {
    const root = await getStoredDirectoryHandle();
    if (!root) {
      if (throwOnPermission) {
        throw new LocalFsPermissionError('No root directory selected.');
      }
      return null;
    }

    let perm: PermissionState;
    try {
      perm = await queryHandlePermission(root, mode);
      if (perm !== 'granted' && typeof window !== 'undefined' && !createMissing) {
        // During UI user clicks (e.g. openLocalFile), requesting permission inline is valid
        try {
          perm = await requestHandlePermission(root, mode);
        } catch {
          // Ignore if called outside user activation
        }
      }
    } catch (err) {
      if (isFsaPermissionError(err)) {
        if (throwOnPermission) {
          throw new LocalFsPermissionError('Folder access permission is not granted.');
        }
        return null;
      }
      throw err;
    }

    if (perm !== 'granted') {
      if (throwOnPermission) {
        throw new LocalFsPermissionError('Folder access permission is not granted.');
      }
      return null;
    }

    const cleanRel = sanitizeRelativePath(relativePath);
    const segments = cleanRel.split('/').filter(Boolean);
    if (segments.length === 0) return null;

    let currentDir: FileSystemDirectoryHandle = root;
    for (let i = 0; i < segments.length - 1; i++) {
      try {
        currentDir = await currentDir.getDirectoryHandle(segments[i], { create: createMissing });
      } catch (err) {
        if (isFsaPermissionError(err)) {
          if (throwOnPermission) {
            throw new LocalFsPermissionError(
              `Permission denied accessing directory "${segments[i]}"`,
              { cause: err }
            );
          }
          return null;
        }
        if (!createMissing && isFsaNotFoundError(err)) return null;
        if (!createMissing) {
          throw err;
        }
        throw new Error(`Failed to access directory segment "${segments[i]}"`, { cause: err });
      }
    }

    const fileName = segments[segments.length - 1];
    try {
      return await currentDir.getFileHandle(fileName, { create: createMissing });
    } catch (err) {
      if (isFsaPermissionError(err)) {
        if (throwOnPermission) {
          throw new LocalFsPermissionError(
            `Permission denied accessing file "${fileName}"`,
            { cause: err }
          );
        }
        return null;
      }
      if (!createMissing && isFsaNotFoundError(err)) return null;
      if (!createMissing) {
        throw err;
      }
      throw new Error(`Failed to access file "${fileName}"`, { cause: err });
    }
  }

  public async checkFilePresence(record: SyncedFileRecord): Promise<FilePresenceState> {
    try {
      const fh = await this.resolveFileHandle(record.relativePath, false, 'read', true);
      return fh ? 'present' : 'missing';
    } catch {
      return 'unverifiable';
    }
  }

  public async fileExists(record: SyncedFileRecord): Promise<boolean> {
    try {
      const fh = await this.resolveFileHandle(record.relativePath, false, 'read', false);
      return fh !== null;
    } catch {
      return false;
    }
  }

  public async writeFile(
    record: Omit<SyncedFileRecord, 'downloadId'>,
    source: {
      url: string;
      blob?: Blob;
      stream?: ReadableStream<Uint8Array>;
      maxBytes?: number;
    }
  ): Promise<SyncedFileRecord> {
    const cleanRel = sanitizeRelativePath(record.relativePath);
    const fh = await this.resolveFileHandle(cleanRel, true, 'readwrite', true);
    if (!fh) {
      throw new LocalFsPermissionError('Failed to resolve target file handle.');
    }

    let writable: FileSystemWritableFileStream;
    try {
      writable = await fh.createWritable();
    } catch (err) {
      if (isFsaPermissionError(err)) {
        throw new LocalFsPermissionError('Permission denied opening file for writing.');
      }
      throw err;
    }

    try {
      if (source.stream) {
        await source.stream.pipeTo(writable);
        return {
          ...record,
          relativePath: cleanRel,
          syncedAt: Date.now(),
          origin: 'fsa',
        };
      }
      if (source.blob) {
        await writable.write(source.blob);
      } else {
        const res = await fetch(source.url, { credentials: 'include' });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} while downloading ${cleanRel}`);
        }
        if (res.body && typeof res.body.pipeTo === 'function') {
          await res.body.pipeTo(writable);
          return {
            ...record,
            relativePath: cleanRel,
            syncedAt: Date.now(),
            origin: 'fsa',
          };
        }
        const buf = await res.arrayBuffer();
        await writable.write(buf);
      }
      await writable.close();
      return {
        ...record,
        relativePath: cleanRel,
        syncedAt: Date.now(),
        origin: 'fsa',
      };
    } catch (err) {
      await writable.abort().catch(() => {});
      if (isFsaPermissionError(err)) {
        throw new LocalFsPermissionError('Folder write permission revoked during write.', { cause: err });
      }
      throw err;
    }
  }

  public async openLocalFile(record: SyncedFileRecord): Promise<boolean> {
    try {
      const fh = await this.resolveFileHandle(record.relativePath, false, 'read');
      if (!fh) return false;

      const file = await fh.getFile();
      if (!file) return false;

      const inlineMime = getInlineMimeType(file.name);
      const blob = inlineMime && inlineMime !== file.type ? new Blob([file], { type: inlineMime }) : file;
      const blobUrl = URL.createObjectURL(blob);
      await browser.tabs.create({ url: blobUrl });
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5 * 60 * 1000);
      return true;
    } catch (err) {
      console.warn('[LocalFS][Chromium] Failed to open local file, falling back to Moodle URL:', err);
      return false;
    }
  }

  public async adoptExistingFiles(
    candidates: LocalAdoptionCandidate[]
  ): Promise<Record<string, SyncedFileRecord>> {
    const adopted: Record<string, SyncedFileRecord> = {};
    if (candidates.length === 0 || !(await this.isReady())) {
      return adopted;
    }

    for (const candidate of candidates) {
      try {
        const fh = await this.resolveFileHandle(candidate.relativePath, false, 'read');
        if (!fh) continue;
        const diskFile = await fh.getFile();
        if (!diskFile || diskFile.size <= 0) continue;

        if (!/\.(html?|xhtml)$/i.test(candidate.fileName) && diskFile.size < 8192) {
          const headText = (await diskFile.slice(0, 128).text()).trim().toLowerCase();
          if (headText.startsWith('<!doctype html') || headText.startsWith('<html')) {
            continue;
          }
        }

        adopted[candidate.moodleFileId] = {
          moodleFileId: candidate.moodleFileId,
          relativePath: sanitizeRelativePath(candidate.relativePath),
          lastModified:
            candidate.timeModified > 0
              ? candidate.timeModified
              : Math.floor((diskFile.lastModified || Date.now()) / 1000),
          size: candidate.fileSize > 0 ? candidate.fileSize : diskFile.size,
          canonicalUrlPath: candidate.canonicalUrlPath,
          syncedAt: Date.now(),
          origin: 'fsa',
        };
      } catch {
        // Missing or unreadable on disk -> leave queued for download
      }
    }

    return adopted;
  }
}

