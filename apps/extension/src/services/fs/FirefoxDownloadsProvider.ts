import browser from 'webextension-polyfill';
import type {
  FilePresenceState,
  FileSystemProvider,
  LocalAdoptionCandidate,
  SyncedFileRecord,
} from './FileSystemProvider.js';
import { sanitizeRelativePath } from '@tautracker/moodle-client';
import {
  getLocalFsConfig,
  getLocalFsManifest,
  setLocalFsConfig,
  setLocalFsManifest,
} from '../../shared/storage.js';

const DEFAULT_FIREFOX_SUBFOLDER = 'Noodle';
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;

export class LocalFsDownloadAuthError extends Error {
  public readonly httpStatus?: number;
  constructor(message = 'Session expired during download', httpStatus?: number) {
    super(message);
    this.name = 'LocalFsDownloadAuthError';
    this.httpStatus = httpStatus;
  }
}

export class LocalFsDownloadOversizedError extends Error {
  public readonly actualBytes: number;
  public readonly maxBytes: number;
  constructor(actualBytes: number, maxBytes: number, message?: string) {
    super(message || `File size (${actualBytes} bytes) exceeds limit (${maxBytes} bytes)`);
    this.name = 'LocalFsDownloadOversizedError';
    this.actualBytes = actualBytes;
    this.maxBytes = maxBytes;
  }
}

export interface ReconcileManifestReport {
  repaired: number;
  cleared: number;
  confirmedMissingIds: string[];
}

export function normalizeFsPath(p: string): string {
  return (p || '').replace(/\\/g, '/').replace(/\/+/g, '/');
}

export function findBestMatchingDownload(
  completedItems: browser.Downloads.DownloadItem[],
  rootSubfolder: string,
  relativePath: string
): browser.Downloads.DownloadItem | null {
  const cleanRel = normalizeFsPath(sanitizeRelativePath(relativePath)).replace(/^\/+|\/+$/g, '');
  if (!cleanRel) return null;

  const cleanRoot = normalizeFsPath(rootSubfolder).replace(/^\/+|\/+$/g, '');
  const fullExact = cleanRoot ? `${cleanRoot}/${cleanRel}` : cleanRel;
  const fullExactLower = fullExact.toLowerCase();
  const fullSuffix = `/${fullExact}`;
  const fullSuffixLower = fullSuffix.toLowerCase();

  let exactMatch: browser.Downloads.DownloadItem | null = null;

  for (const item of completedItems) {
    if (item.state !== 'complete' || item.exists !== true || typeof item.id !== 'number') {
      continue;
    }
    const itemPath = normalizeFsPath(item.filename || '');
    if (!itemPath) continue;
    const itemPathLower = itemPath.toLowerCase();

    if (
      itemPath === fullExact ||
      itemPath.endsWith(fullSuffix) ||
      itemPathLower === fullExactLower ||
      itemPathLower.endsWith(fullSuffixLower)
    ) {
      if (!exactMatch || item.id > exactMatch.id) {
        exactMatch = item;
      }
    }
  }

  return exactMatch;
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
   * Preserves downloadIds for items still present in download history with exists === false so
   * autoResyncMissingFiles can distinguish true disk deletions from purged download history or
   * externally scanned/rclone files.
   */
  public async reconcileManifestDetailed(): Promise<ReconcileManifestReport> {
    if (typeof browser.downloads?.search !== 'function') {
      return { repaired: 0, cleared: 0, confirmedMissingIds: [] };
    }
    try {
      const [manifest, rootSubfolder, allDownloads] = await Promise.all([
        getLocalFsManifest(),
        this.getRootSubfolder(),
        browser.downloads.search({}),
      ]);

      const byId = new Map<number, browser.Downloads.DownloadItem>();
      const completedLive: browser.Downloads.DownloadItem[] = [];
      for (const item of allDownloads) {
        if (typeof item.id === 'number') {
          byId.set(item.id, item);
          if (item.exists === true && item.state === 'complete') {
            completedLive.push(item);
          }
        }
      }

      let repaired = 0;
      let cleared = 0;
      const confirmedMissingIds: string[] = [];

      for (const [moodleFileId, rec] of Object.entries(manifest.files || {})) {
        const currentItem = typeof rec.downloadId === 'number' ? byId.get(rec.downloadId) : undefined;
        if (currentItem && currentItem.state === 'complete' && currentItem.exists === true) {
          continue;
        }

        const match = findBestMatchingDownload(completedLive, rootSubfolder, rec.relativePath);
        if (match && typeof match.id === 'number') {
          manifest.files[moodleFileId] = {
            ...rec,
            downloadId: match.id,
            origin: rec.origin === 'scan' ? 'download' : (rec.origin || 'download'),
          };
          repaired++;
          continue;
        }

        if (currentItem && currentItem.state === 'complete' && currentItem.exists === false) {
          confirmedMissingIds.push(moodleFileId);
          continue;
        }

        // Download ID was purged from Firefox history (or never completed) -> strip dead badge ID
        if (typeof rec.downloadId === 'number') {
          const updated = { ...rec };
          delete updated.downloadId;
          manifest.files[moodleFileId] = updated;
          cleared++;
        }
      }

      if (repaired > 0 || cleared > 0) {
        await setLocalFsManifest(manifest);
      }
      return { repaired, cleared, confirmedMissingIds };
    } catch {
      return { repaired: 0, cleared: 0, confirmedMissingIds: [] };
    }
  }

  public async reconcileManifest(): Promise<number> {
    const report = await this.reconcileManifestDetailed();
    return report.repaired;
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
          manifest.files[record.moodleFileId] = {
            ...existing,
            downloadId: match.id,
            origin: existing.origin === 'scan' ? 'download' : (existing.origin || 'download'),
          };
          await setLocalFsManifest(manifest);
        }
      }
      return match.id;
    } catch {
      return null;
    }
  }

  private evaluatePresenceFromSnapshot(
    record: SyncedFileRecord,
    rootSubfolder: string,
    byId: Map<number, browser.Downloads.DownloadItem>,
    completedLive: browser.Downloads.DownloadItem[]
  ): FilePresenceState {
    if (typeof record.downloadId === 'number') {
      const item = byId.get(record.downloadId);
      if (item && item.state === 'complete' && item.exists === true) {
        return 'present';
      }
      const match = findBestMatchingDownload(completedLive, rootSubfolder, record.relativePath);
      if (match && typeof match.id === 'number') {
        return 'present';
      }
      if (item && item.state === 'complete' && item.exists === false) {
        return 'missing';
      }
      // Download history cleared/purged -> cannot verify disk deletion without false positives
      return 'unverifiable';
    }

    // Scanned/rclone manifest entries have no downloadId: only resolvable if Firefox already
    // holds a matching completed download; otherwise disk presence is unverifiable via downloads API.
    const match = findBestMatchingDownload(completedLive, rootSubfolder, record.relativePath);
    if (match && typeof match.id === 'number') {
      return 'present';
    }
    return 'unverifiable';
  }

  public async checkFilePresence(record: SyncedFileRecord): Promise<FilePresenceState> {
    if (typeof browser.downloads?.search !== 'function') {
      return 'unverifiable';
    }
    try {
      const [rootSubfolder, allDownloads] = await Promise.all([
        this.getRootSubfolder(),
        browser.downloads.search({}),
      ]);
      const byId = new Map<number, browser.Downloads.DownloadItem>();
      const completedLive: browser.Downloads.DownloadItem[] = [];
      for (const item of allDownloads) {
        if (typeof item.id === 'number') {
          byId.set(item.id, item);
          if (item.exists === true && item.state === 'complete') {
            completedLive.push(item);
          }
        }
      }
      return this.evaluatePresenceFromSnapshot(record, rootSubfolder, byId, completedLive);
    } catch {
      return 'unverifiable';
    }
  }

  public async batchCheckFilePresence(
    records: SyncedFileRecord[]
  ): Promise<Record<string, FilePresenceState>> {
    const out: Record<string, FilePresenceState> = {};
    if (records.length === 0) return out;
    if (typeof browser.downloads?.search !== 'function') {
      for (const rec of records) out[rec.moodleFileId] = 'unverifiable';
      return out;
    }
    try {
      const [rootSubfolder, allDownloads] = await Promise.all([
        this.getRootSubfolder(),
        browser.downloads.search({}),
      ]);
      const byId = new Map<number, browser.Downloads.DownloadItem>();
      const completedLive: browser.Downloads.DownloadItem[] = [];
      for (const item of allDownloads) {
        if (typeof item.id === 'number') {
          byId.set(item.id, item);
          if (item.exists === true && item.state === 'complete') {
            completedLive.push(item);
          }
        }
      }
      for (const rec of records) {
        out[rec.moodleFileId] = this.evaluatePresenceFromSnapshot(
          rec,
          rootSubfolder,
          byId,
          completedLive
        );
      }
    } catch {
      for (const rec of records) out[rec.moodleFileId] = 'unverifiable';
    }
    return out;
  }

  public async fileExists(record: SyncedFileRecord): Promise<boolean> {
    return (await this.checkFilePresence(record)) === 'present';
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
    if (typeof browser.downloads?.download !== 'function') {
      throw new Error('browser.downloads API is unavailable.');
    }

    const rootSubfolder = await this.getRootSubfolder();
    const cleanRel = sanitizeRelativePath(record.relativePath);
    const filename = `${rootSubfolder}/${cleanRel}`;
    const maxBytes = typeof source.maxBytes === 'number' && Number.isFinite(source.maxBytes) && source.maxBytes > 0
      ? source.maxBytes
      : 0;

    let objectUrl: string | null = null;
    let targetUrl = source.url;
    if (source.blob) {
      objectUrl = URL.createObjectURL(source.blob);
      targetUrl = objectUrl;
    } else if (source.stream) {
      const bufferedBlob = await new Response(source.stream).blob();
      objectUrl = URL.createObjectURL(bufferedBlob);
      targetUrl = objectUrl;
    }

    const observedTerminalStates = new Map<number, { state: string; error?: string }>();
    const observedOversized = new Map<number, number>();
    let targetDownloadId: number | null = null;
    let settled = false;
    let resolveDone!: () => void;
    let rejectDone!: (err: Error) => void;

    const completionPromise = new Promise<void>((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
    });

    const cleanupDownload = async (downloadId: number, cancelFirst = false) => {
      if (cancelFirst && typeof browser.downloads?.cancel === 'function') {
        await browser.downloads.cancel(downloadId).catch(() => {});
      }
      if (typeof browser.downloads?.removeFile === 'function') {
        await browser.downloads.removeFile(downloadId).catch(() => {});
      }
      if (typeof browser.downloads?.erase === 'function') {
        await browser.downloads.erase({ id: downloadId }).catch(() => {});
      }
    };

    const settleWithCleanup = (downloadId: number, cancelFirst: boolean, err: Error) => {
      void cleanupDownload(downloadId, cancelFirst).finally(() => {
        rejectDone(err);
      });
    };

    const rejectInterrupted = (downloadId: number, reason?: string) => {
      const code = reason || 'unknown';
      if (code === 'SERVER_UNAUTHORIZED' || code === 'SERVER_FORBIDDEN') {
        const status = code === 'SERVER_UNAUTHORIZED' ? 401 : 403;
        settleWithCleanup(
          downloadId,
          false,
          new LocalFsDownloadAuthError(`Download rejected (${code}) for ${cleanRel}`, status)
        );
        return;
      }
      settleWithCleanup(downloadId, false, new Error(`Download interrupted: ${code}`));
    };

    const onChanged = (delta: browser.Downloads.OnChangedDownloadDeltaType) => {
      if (maxBytes > 0) {
        const total = delta.totalBytes?.current ?? -1;
        const deltaExt = delta as unknown as { bytesReceived?: { current?: number } };
        const received = deltaExt.bytesReceived?.current ?? -1;
        const exceeding = total > maxBytes ? total : received > maxBytes ? received : -1;
        if (exceeding > 0) {
          observedOversized.set(delta.id, exceeding);
          if (targetDownloadId !== null && delta.id === targetDownloadId && !settled) {
            settled = true;
            settleWithCleanup(
              targetDownloadId,
              true,
              new LocalFsDownloadOversizedError(exceeding, maxBytes)
            );
            return;
          }
        }
      }

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
            rejectInterrupted(targetDownloadId, delta.error?.current);
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

      const preOversized = observedOversized.get(targetDownloadId);
      if (preOversized && !settled) {
        settled = true;
        await cleanupDownload(targetDownloadId, true);
        throw new LocalFsDownloadOversizedError(preOversized, maxBytes);
      }

      // Guard against fast in-memory Blob/cached downloads completing before targetDownloadId was returned
      const buffered = observedTerminalStates.get(targetDownloadId);
      if (buffered && !settled) {
        settled = true;
        if (buffered.state === 'complete') {
          resolveDone();
        } else {
          rejectInterrupted(targetDownloadId, buffered.error);
        }
      } else {
        const [existing] = await browser.downloads.search({ id: targetDownloadId });
        if (existing && !settled) {
          if (
            maxBytes > 0 &&
            ((existing.totalBytes ?? -1) > maxBytes ||
              (existing.bytesReceived ?? -1) > maxBytes ||
              (existing.fileSize ?? -1) > maxBytes)
          ) {
            settled = true;
            const offending = Math.max(
              existing.totalBytes ?? 0,
              existing.bytesReceived ?? 0,
              existing.fileSize ?? 0
            );
            await cleanupDownload(targetDownloadId, true);
            throw new LocalFsDownloadOversizedError(offending, maxBytes);
          }
          if (existing.state === 'complete') {
            settled = true;
            resolveDone();
          } else if (existing.state === 'interrupted') {
            settled = true;
            rejectInterrupted(targetDownloadId, existing.error);
          }
        }
      }

      await Promise.race([
        completionPromise,
        new Promise<void>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            if (!settled) {
              settled = true;
              const err = new Error(`Download timed out after ${DOWNLOAD_TIMEOUT_MS / 1000}s`);
              if (targetDownloadId !== null) {
                void cleanupDownload(targetDownloadId, true).finally(() => reject(err));
              } else {
                reject(err);
              }
            }
          }, DOWNLOAD_TIMEOUT_MS);
        }),
      ]);

      const [completedItem] = await browser.downloads.search({ id: targetDownloadId });
      const actualSize =
        completedItem?.fileSize && completedItem.fileSize > 0
          ? completedItem.fileSize
          : completedItem?.totalBytes && completedItem.totalBytes > 0
            ? completedItem.totalBytes
            : -1;

      if (maxBytes > 0 && actualSize > maxBytes) {
        await cleanupDownload(targetDownloadId, false);
        throw new LocalFsDownloadOversizedError(actualSize, maxBytes);
      }

      const actualMime = (completedItem?.mime || '').toLowerCase();
      const completedExt = completedItem as (browser.Downloads.DownloadItem & { finalUrl?: string }) | undefined;
      const finalUrl = (completedExt?.finalUrl || completedItem?.url || '').toLowerCase();
      const isHtmlTarget = /\.(html?|xhtml)$/i.test(cleanRel);
      const isJsonTarget = /\.json$/i.test(cleanRel);

      if (
        finalUrl.includes('nidp.tau.ac.il') ||
        finalUrl.includes('/login/index.php') ||
        finalUrl.includes('/auth/saml2/') ||
        (!isHtmlTarget && actualMime.includes('text/html')) ||
        (!isJsonTarget && actualMime.includes('application/json') && (actualSize <= 0 || actualSize < 32768))
      ) {
        await cleanupDownload(targetDownloadId, false);
        throw new LocalFsDownloadAuthError(
          `Session expired (${actualMime || finalUrl || 'auth redirect'} received instead of ${cleanRel})`,
          401
        );
      }

      const persistedSize =
        record.size && record.size > 0
          ? record.size
          : actualSize > 0
            ? actualSize
            : record.size;

      return {
        ...record,
        size: persistedSize,
        relativePath: cleanRel,
        downloadId: targetDownloadId,
        syncedAt: Date.now(),
        origin: 'download',
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

  public async adoptExistingFiles(
    candidates: LocalAdoptionCandidate[]
  ): Promise<Record<string, SyncedFileRecord>> {
    const adopted: Record<string, SyncedFileRecord> = {};
    if (candidates.length === 0 || typeof browser.downloads?.search !== 'function') {
      return adopted;
    }
    try {
      const [rootSubfolder, allCompleted] = await Promise.all([
        this.getRootSubfolder(),
        browser.downloads.search({ state: 'complete' }),
      ]);

      for (const candidate of candidates) {
        const match = findBestMatchingDownload(allCompleted, rootSubfolder, candidate.relativePath);
        if (!match || typeof match.id !== 'number') continue;
        const mimeLower = (match.mime || '').toLowerCase();
        if (mimeLower.includes('text/html') && !/\.(html?|xhtml)$/i.test(candidate.fileName)) {
          continue;
        }
        if (match.fileSize === 0) continue;

        adopted[candidate.moodleFileId] = {
          moodleFileId: candidate.moodleFileId,
          relativePath: sanitizeRelativePath(candidate.relativePath),
          lastModified: candidate.timeModified,
          size:
            candidate.fileSize > 0
              ? candidate.fileSize
              : match.fileSize && match.fileSize > 0
                ? match.fileSize
                : 0,
          canonicalUrlPath: candidate.canonicalUrlPath,
          downloadId: match.id,
          syncedAt: Date.now(),
          origin: 'download',
        };
      }
    } catch {
      // Ignore downloads.search failures and fall back to normal queue
    }
    return adopted;
  }
}

