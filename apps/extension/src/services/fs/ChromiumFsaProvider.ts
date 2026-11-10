import browser from 'webextension-polyfill';
import type { FileSystemProvider, SyncedFileRecord } from './FileSystemProvider.js';
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
  constructor(message = 'Local directory write permission is required') {
    super(message);
    this.name = 'LocalFsPermissionError';
  }
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
    mode: 'read' | 'readwrite'
  ): Promise<FileSystemFileHandle | null> {
    const root = await getStoredDirectoryHandle();
    if (!root) {
      if (createMissing) {
        throw new LocalFsPermissionError('No root directory selected.');
      }
      return null;
    }

    let perm = await queryHandlePermission(root, mode);
    if (perm !== 'granted' && typeof window !== 'undefined' && !createMissing) {
      // During UI user clicks (e.g. openLocalFile), requesting permission inline is valid
      try {
        perm = await requestHandlePermission(root, mode);
      } catch {
        // Ignore if called outside user activation
      }
    }

    if (perm !== 'granted') {
      if (createMissing) {
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
      } catch {
        if (!createMissing) return null;
        throw new Error(`Failed to access directory segment "${segments[i]}"`);
      }
    }

    const fileName = segments[segments.length - 1];
    try {
      return await currentDir.getFileHandle(fileName, { create: createMissing });
    } catch {
      if (!createMissing) return null;
      throw new Error(`Failed to access file "${fileName}"`);
    }
  }

  public async fileExists(record: SyncedFileRecord): Promise<boolean> {
    try {
      const fh = await this.resolveFileHandle(record.relativePath, false, 'read');
      return fh !== null;
    } catch {
      return false;
    }
  }

  public async writeFile(
    record: Omit<SyncedFileRecord, 'downloadId'>,
    source: { url: string; blob?: Blob }
  ): Promise<SyncedFileRecord> {
    const cleanRel = sanitizeRelativePath(record.relativePath);
    const fh = await this.resolveFileHandle(cleanRel, true, 'readwrite');
    if (!fh) {
      throw new LocalFsPermissionError('Failed to resolve target file handle.');
    }

    const writable = await fh.createWritable();
    try {
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
      };
    } catch (err) {
      await writable.abort().catch(() => {});
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
}

