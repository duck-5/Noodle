import browser from 'webextension-polyfill';
import type { FileSystemProvider, SyncedFileRecord } from './FileSystemProvider.js';
import { sanitizeRelativePath } from '@tautracker/moodle-client';
import {
  getLocalFsConfig,
  getLocalFsManifest,
  setLocalFsConfig,
  setLocalFsManifest,
} from '../../shared/storage.js';

const DEFAULT_FIREFOX_SUBFOLDER = 'Noodle';
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;

function normalizeFsPath(p: string): string {
  return (p || '').replace(/\\/g, '/').replace(/\/+/g, '/');
}

function findBestMatchingDownload(
  completedItems: browser.Downloads.DownloadItem[],
  rootSubfolder: string,
  relativePath: string
): browser.Downloads.DownloadItem | null {
  const cleanRel = normalizeFsPath(sanitizeRelativePath(relativePath));
  if (!cleanRel) return null;

  const cleanRoot = normalizeFsPath(rootSubfolder);
  const fullSuffix = `/${cleanRoot}/${cleanRel}`;
  const fullSuffixLower = fullSuffix.toLowerCase();
  const relSuffix = cleanRel.includes('/') ? `/${cleanRel}` : '';
  const relSuffixLower = relSuffix.toLowerCase();

  let exactMatch: browser.Downloads.DownloadItem | null = null;
  let relFallback: browser.Downloads.DownloadItem | null = null;

  for (const item of completedItems) {
    if (item.state !== 'complete' || item.exists !== true || typeof item.id !== 'number') {
      continue;
    }
    const itemPath = normalizeFsPath(item.filename || '');
    if (!itemPath) continue;
    const itemPathLower = itemPath.toLowerCase();

    if (itemPath.endsWith(fullSuffix) || itemPathLower.endsWith(fullSuffixLower)) {
      if (!exactMatch || item.id > exactMatch.id) {
        exactMatch = item;
      }
    } else if (
      relSuffix &&
      (itemPath.endsWith(relSuffix) || itemPathLower.endsWith(relSuffixLower))
    ) {
      if (!relFallback || item.id > relFallback.id) {
        relFallback = item;
      }
    }
  }

  return exactMatch || relFallback;
}

export class FirefoxDownloadsProvider implements FileSystemProvider {
  public readonly backendType = 'downloads' as const;

  public async getRootSubfolder(): Promise<string> {
    const cfg = await getLocalFsConfig();
    const raw = (cfg.rootLabel || '').trim() || DEFAULT_FIREFOX_SUBFOLDER;
    return sanitizeRelativePath(raw, 80);
  }

  public async isReady(): Promise<boolean> {
    if (typeof browser.downloads?.download !== 'function') {
      return false;
    }
    const subfolder = await this.getRootSubfolder();
    return Boolean(subfolder);
  }

  public async selectRootDirectory(customSubfolder?: string): Promise<{ success: boolean; displayPath: string }> {
    const cfg = await getLocalFsConfig();
    const candidate = (customSubfolder ?? cfg.rootLabel ?? DEFAULT_FIREFOX_SUBFOLDER).trim() || DEFAULT_FIREFOX_SUBFOLDER;
    const clean = sanitizeRelativePath(candidate, 80);
    await setLocalFsConfig({ rootLabel: clean });
    return { success: true, displayPath: `Downloads/${clean}` };
  }

  /**
   * Firefox downloadId integers are session-scoped and may rotate across restarts or extension reloads.
   * Reconciles localFsManifest against live browser.downloads entries by normalized filename path.
   */
  public async reconcileManifest(): Promise<number> {
    if (typeof browser.downloads?.search !== 'function') {
      return 0;
    }
    try {
      const [manifest, rootSubfolder, allCompleted] = await Promise.all([
        getLocalFsManifest(),
        this.getRootSubfolder(),
        browser.downloads.search({ state: 'complete' }),
      ]);

      const liveById = new Map<number, browser.Downloads.DownloadItem>();
      for (const item of allCompleted) {
        if (typeof item.id === 'number' && item.exists === true && item.state === 'complete') {
          liveById.set(item.id, item);
        }
      }

      let repaired = 0;
      for (const [moodleFileId, rec] of Object.entries(manifest.files || {})) {
        if (typeof rec.downloadId === 'number' && liveById.has(rec.downloadId)) {
          continue;
        }
        const match = findBestMatchingDownload(allCompleted, rootSubfolder, rec.relativePath);
        if (match && typeof match.id === 'number') {
          manifest.files[moodleFileId] = { ...rec, downloadId: match.id };
          repaired++;
        }
      }

      if (repaired > 0) {
        await setLocalFsManifest(manifest);
      }
      return repaired;
    } catch {
      return 0;
    }
  }

  private async healDownloadId(record: SyncedFileRecord): Promise<number | null> {
    if (typeof browser.downloads?.search !== 'function') {
      return null;
    }
    try {
      const [rootSubfolder, allCompleted] = await Promise.all([
        this.getRootSubfolder(),
        browser.downloads.search({ state: 'complete' }),
      ]);
      const match = findBestMatchingDownload(allCompleted, rootSubfolder, record.relativePath);
      if (!match || typeof match.id !== 'number') {
        return null;
      }
      if (record.moodleFileId) {
        const manifest = await getLocalFsManifest();
        const existing = manifest.files[record.moodleFileId];
        if (existing) {
          manifest.files[record.moodleFileId] = { ...existing, downloadId: match.id };
          await setLocalFsManifest(manifest);
        }
      }
      return match.id;
    } catch {
      return null;
    }
  }

  public async fileExists(record: SyncedFileRecord): Promise<boolean> {
    if (typeof browser.downloads?.search !== 'function') {
      return false;
    }
    try {
      if (typeof record.downloadId === 'number') {
        const items = await browser.downloads.search({ id: record.downloadId });
        const item = items?.[0];
        if (item && item.exists === true && item.state === 'complete') {
          return true;
        }
      }
      const healedId = await this.healDownloadId(record);
      return healedId !== null;
    } catch {
      return false;
    }
  }

  public async writeFile(
    record: Omit<SyncedFileRecord, 'downloadId'>,
    source: { url: string; blob?: Blob }
  ): Promise<SyncedFileRecord> {
    if (typeof browser.downloads?.download !== 'function') {
      throw new Error('browser.downloads API is unavailable.');
    }

    const rootSubfolder = await this.getRootSubfolder();
    const cleanRel = sanitizeRelativePath(record.relativePath);
    const filename = `${rootSubfolder}/${cleanRel}`;

    let objectUrl: string | null = null;
    const targetUrl = source.blob ? (objectUrl = URL.createObjectURL(source.blob)) : source.url;

    const observedTerminalStates = new Map<number, { state: string; error?: string }>();
    let targetDownloadId: number | null = null;
    let settled = false;
    let resolveDone!: () => void;
    let rejectDone!: (err: Error) => void;

    const completionPromise = new Promise<void>((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
    });

    const onChanged = (delta: browser.Downloads.OnChangedDownloadDeltaType) => {
      const stateCurrent = delta.state?.current;
      if (!stateCurrent) return;
      if (stateCurrent === 'complete' || stateCurrent === 'interrupted') {
        observedTerminalStates.set(delta.id, {
          state: stateCurrent,
          error: delta.error?.current,
        });
        if (targetDownloadId !== null && delta.id === targetDownloadId && !settled) {
          settled = true;
          if (stateCurrent === 'complete') {
            resolveDone();
          } else {
            rejectDone(new Error(`Download interrupted: ${delta.error?.current || 'unknown'}`));
          }
        }
      }
    };

    browser.downloads.onChanged.addListener(onChanged);

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    try {
      targetDownloadId = await browser.downloads.download({
        url: targetUrl,
        filename,
        conflictAction: 'overwrite',
        saveAs: false,
      });

      if (typeof targetDownloadId !== 'number') {
        throw new Error('Firefox downloads.download did not return a download ID');
      }

      // Guard against fast in-memory Blob downloads completing before targetDownloadId was returned
      const buffered = observedTerminalStates.get(targetDownloadId);
      if (buffered && !settled) {
        settled = true;
        if (buffered.state === 'complete') {
          resolveDone();
        } else {
          rejectDone(new Error(`Download interrupted: ${buffered.error || 'unknown'}`));
        }
      } else {
        const [existing] = await browser.downloads.search({ id: targetDownloadId });
        if (existing && !settled) {
          if (existing.state === 'complete') {
            settled = true;
            resolveDone();
          } else if (existing.state === 'interrupted') {
            settled = true;
            rejectDone(new Error(`Download interrupted: ${existing.error || 'unknown'}`));
          }
        }
      }

      await Promise.race([
        completionPromise,
        new Promise<void>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            if (!settled) {
              settled = true;
              reject(new Error(`Download timed out after ${DOWNLOAD_TIMEOUT_MS / 1000}s`));
            }
          }, DOWNLOAD_TIMEOUT_MS);
        }),
      ]);

      const [completedItem] = await browser.downloads.search({ id: targetDownloadId });
      const actualMime = (completedItem?.mime || '').toLowerCase();
      if (actualMime.includes('text/html') && !/\.html?$/i.test(cleanRel)) {
        await browser.downloads.removeFile(targetDownloadId).catch(() => {});
        await browser.downloads.erase({ id: targetDownloadId }).catch(() => {});
        throw new Error(`Session expired (HTML page received instead of ${cleanRel})`);
      }

      const persistedSize =
        record.size && record.size > 0
          ? record.size
          : completedItem?.fileSize && completedItem.fileSize > 0
            ? completedItem.fileSize
            : record.size;

      return {
        ...record,
        size: persistedSize,
        relativePath: cleanRel,
        downloadId: targetDownloadId,
        syncedAt: Date.now(),
      };
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      browser.downloads.onChanged.removeListener(onChanged);
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    }
  }

  public async openLocalFile(record: SyncedFileRecord): Promise<boolean> {
    const downloadsApi = browser.downloads as unknown as { open?: (id: number) => Promise<void> };
    if (typeof downloadsApi.open !== 'function') {
      return false;
    }

    if (typeof record.downloadId === 'number') {
      try {
        // Call browser.downloads.open() synchronously before any awaits so Firefox
        // preserves user click activation on the happy path.
        await downloadsApi.open(record.downloadId);
        return true;
      } catch (err) {
        console.warn('[LocalFS][Firefox] downloads.open failed for stored ID, searching by filename:', err);
      }
    }

    // Stale downloadId recovery across browser restarts / extension reloads
    const healedId = await this.healDownloadId(record);
    if (healedId !== null) {
      try {
        await downloadsApi.open(healedId);
        return true;
      } catch (retryErr) {
        console.warn('[LocalFS][Firefox] downloads.open retry with healed ID failed:', retryErr);
      }
    }

    return false;
  }

  public async revealInFileManager(record: SyncedFileRecord): Promise<void> {
    let targetId = typeof record.downloadId === 'number' ? record.downloadId : null;
    if (targetId === null || !(await this.fileExists(record))) {
      targetId = await this.healDownloadId(record);
    }
    if (targetId !== null) {
      await browser.downloads.show(targetId);
    }
  }
}

