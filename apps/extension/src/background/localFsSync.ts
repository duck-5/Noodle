import browser from 'webextension-polyfill';
import {
  buildAuthenticatedFileUrl,
  buildLocalFsTreePlan,
  planLocalFsDiff,
  type PlannedLocalFile,
} from '@tautracker/moodle-client';
import {
  getCachedSyncResult,
  getLocalFsConfig,
  getLocalFsManifest,
  getLocalFsQueue,
  getLocalFsStatus,
  getSettings,
  getStoredToken,
  getTrackedCourseIds,
  setLocalFsConfig,
  setLocalFsManifest,
  setLocalFsQueue,
  setLocalFsStatus,
  DEFAULT_LOCAL_FS_STATUS,
  type LocalFsLogEntry,
  type LocalFsQueueItem,
  type LocalFsStatus,
} from '../shared/storage.js';
import { createFileSystemProvider } from '../services/fs/FileSystemProvider.js';
import { ChromiumFsaProvider, LocalFsPermissionError } from '../services/fs/ChromiumFsaProvider.js';
import { FirefoxDownloadsProvider } from '../services/fs/FirefoxDownloadsProvider.js';
import { clearDirectoryHandle } from '../services/fs/fsaHandleStore.js';

export const LOCAL_FS_RESUME_ALARM = 'localFsResume';
const MAX_RETRIES_PER_FILE = 3;
const RATE_LIMIT_COOLDOWN_MS = 15 * 60 * 1000;
const MAX_LOGS = 200;

let activeQueuePromise: Promise<void> | null = null;
let abortRequested = false;

export type ReauthCallback = () => Promise<string | null>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function ensureResumeAlarm(): Promise<void> {
  try {
    const existing = await browser.alarms.get(LOCAL_FS_RESUME_ALARM);
    if (!existing) {
      await browser.alarms.create(LOCAL_FS_RESUME_ALARM, { periodInMinutes: 1 });
    }
  } catch (e) {
    console.warn('[LocalFS] Failed to schedule resume alarm:', e);
  }
}

async function clearResumeAlarm(): Promise<void> {
  try {
    await browser.alarms.clear(LOCAL_FS_RESUME_ALARM);
  } catch {
    // Ignore
  }
}

function appendLog(logs: LocalFsLogEntry[], entry: LocalFsLogEntry): LocalFsLogEntry[] {
  const filtered = logs.filter(
    (l) => !(l.moodleFileId === entry.moodleFileId && l.status === entry.status)
  );
  return [entry, ...filtered].slice(0, MAX_LOGS);
}

function toQueueItem(
  file: PlannedLocalFile,
  reason: LocalFsQueueItem['reason']
): LocalFsQueueItem {
  return {
    moodleFileId: file.moodleFileId,
    courseId: file.courseId,
    sourceCourseId: file.sourceCourseId,
    relativePath: file.relativePath,
    fileName: file.fileName,
    fileUrl: file.fileUrl,
    canonicalUrlPath: file.canonicalUrlPath,
    fileSize: file.fileSize,
    timeModified: file.timeModified,
    reason,
    attempts: 0,
  };
}

function parseRetryAfterMs(headerVal: string | null): number | null {
  if (!headerVal) return null;
  const seconds = Number(headerVal);
  if (!isNaN(seconds) && seconds > 0) {
    return Math.min(seconds * 1000, RATE_LIMIT_COOLDOWN_MS);
  }
  const dateMs = Date.parse(headerVal);
  if (!isNaN(dateMs) && dateMs > Date.now()) {
    return Math.min(dateMs - Date.now(), RATE_LIMIT_COOLDOWN_MS);
  }
  return null;
}

function isHtmlExtension(fileName: string): boolean {
  return /\.(html?|xhtml)$/i.test(fileName);
}

async function checkIsJsonApiError(res: Response): Promise<{ isError: boolean; isAuthError: boolean; message: string }> {
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (!ct.includes('application/json')) {
    return { isError: false, isAuthError: false, message: '' };
  }
  try {
    const json = await res.clone().json();
    if (json && (json.exception || json.errorcode || json.error)) {
      const code = String(json.errorcode || json.error || '');
      const msg = String(json.message || code || 'Moodle JSON API error');
      const isAuthError =
        code === 'invalidtoken' ||
        code === 'accessexception' ||
        msg.toLowerCase().includes('invalid token');
      return { isError: true, isAuthError, message: msg };
    }
  } catch {
    // Not parseable JSON
  }
  return { isError: false, isAuthError: false, message: '' };
}

function isSsoHtmlRedirect(res: Response, fileName: string): boolean {
  const finalUrl = (res.url || '').toLowerCase();
  if (
    finalUrl.includes('nidp.tau.ac.il') ||
    finalUrl.includes('/login/index.php') ||
    finalUrl.includes('/auth/saml2/')
  ) {
    return true;
  }
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (ct.includes('text/html') && !isHtmlExtension(fileName)) {
    return true;
  }
  return false;
}

class AuthRedirectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthRedirectError';
  }
}

class RateLimitError extends Error {
  public retryAfterMs: number | null;
  constructor(message: string, retryAfterMs: number | null = null) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

class OversizedFileError extends Error {
  public bytes: number;
  constructor(bytes: number) {
    super(`File exceeds max size limit (${Math.round(bytes / (1024 * 1024))} MB)`);
    this.name = 'OversizedFileError';
    this.bytes = bytes;
  }
}

async function fetchValidatedFileBlob(
  item: LocalFsQueueItem,
  token: string,
  maxBytes: number,
  reauth?: ReauthCallback
): Promise<Blob> {
  let activeToken = token;

  for (let authAttempt = 0; authAttempt < 2; authAttempt++) {
    const authUrl = buildAuthenticatedFileUrl(item.fileUrl, activeToken);
    const res = await fetch(authUrl, { credentials: 'include' });

    if (res.status === 429 || res.status === 503 || res.status === 502) {
      throw new RateLimitError(
        `HTTP ${res.status} from Moodle while downloading ${item.fileName}`,
        parseRetryAfterMs(res.headers.get('retry-after'))
      );
    }

    if (res.status === 401 || res.status === 403) {
      if (authAttempt === 0 && reauth) {
        const freshToken = await reauth().catch(() => null);
        if (freshToken) {
          activeToken = freshToken;
          continue;
        }
      }
      throw new RateLimitError(`HTTP ${res.status} (access denied / WAF block) for ${item.fileName}`);
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} downloading ${item.fileName}`);
    }

    const jsonCheck = await checkIsJsonApiError(res);
    if (jsonCheck.isError) {
      if (jsonCheck.isAuthError && authAttempt === 0 && reauth) {
        const freshToken = await reauth().catch(() => null);
        if (freshToken) {
          activeToken = freshToken;
          continue;
        }
        throw new AuthRedirectError(jsonCheck.message);
      }
      throw new Error(jsonCheck.message);
    }

    if (isSsoHtmlRedirect(res, item.fileName)) {
      if (authAttempt === 0 && reauth) {
        const freshToken = await reauth().catch(() => null);
        if (freshToken) {
          activeToken = freshToken;
          continue;
        }
      }
      throw new AuthRedirectError(`Session expired (redirected to HTML login page for ${item.fileName})`);
    }

    const contentLength = Number(res.headers.get('content-length') || 0);
    if (maxBytes < Infinity && contentLength > maxBytes) {
      throw new OversizedFileError(contentLength);
    }

    const blob = await res.blob();
    if (maxBytes < Infinity && blob.size > maxBytes) {
      throw new OversizedFileError(blob.size);
    }
    return blob;
  }

  throw new AuthRedirectError('Authentication expired while downloading file');
}

async function preflightMoodleDownloadUrl(
  item: LocalFsQueueItem,
  token: string,
  maxBytes: number,
  reauth?: ReauthCallback
): Promise<{ authUrl: string; contentLength: number }> {
  let activeToken = token;

  for (let authAttempt = 0; authAttempt < 2; authAttempt++) {
    const authUrl = buildAuthenticatedFileUrl(item.fileUrl, activeToken);
    const abortCtrl = new AbortController();
    const res = await fetch(authUrl, { credentials: 'include', signal: abortCtrl.signal });

    if (res.status === 429 || res.status === 503 || res.status === 502) {
      abortCtrl.abort();
      throw new RateLimitError(
        `HTTP ${res.status} from Moodle while downloading ${item.fileName}`,
        parseRetryAfterMs(res.headers.get('retry-after'))
      );
    }

    if (res.status === 401 || res.status === 403) {
      abortCtrl.abort();
      if (authAttempt === 0 && reauth) {
        const freshToken = await reauth().catch(() => null);
        if (freshToken) {
          activeToken = freshToken;
          continue;
        }
      }
      throw new RateLimitError(`HTTP ${res.status} (access denied / WAF block) for ${item.fileName}`);
    }

    if (!res.ok) {
      abortCtrl.abort();
      throw new Error(`HTTP ${res.status} downloading ${item.fileName}`);
    }

    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('application/json')) {
      const jsonCheck = await checkIsJsonApiError(res);
      abortCtrl.abort();
      if (jsonCheck.isError) {
        if (jsonCheck.isAuthError && authAttempt === 0 && reauth) {
          const freshToken = await reauth().catch(() => null);
          if (freshToken) {
            activeToken = freshToken;
            continue;
          }
          throw new AuthRedirectError(jsonCheck.message);
        }
        throw new Error(jsonCheck.message);
      }
    }

    if (isSsoHtmlRedirect(res, item.fileName)) {
      abortCtrl.abort();
      if (authAttempt === 0 && reauth) {
        const freshToken = await reauth().catch(() => null);
        if (freshToken) {
          activeToken = freshToken;
          continue;
        }
      }
      throw new AuthRedirectError(`Session expired (redirected to HTML login page for ${item.fileName})`);
    }

    const contentLength = Number(res.headers.get('content-length') || 0);
    abortCtrl.abort();
    if (maxBytes < Infinity && contentLength > maxBytes) {
      throw new OversizedFileError(contentLength);
    }

    return { authUrl, contentLength };
  }

  throw new AuthRedirectError('Authentication expired while downloading file');
}

export async function enqueueLocalFsSync(options: {
  forceRescan?: boolean;
  retryFailed?: boolean;
  reauthenticate?: ReauthCallback;
} = {}): Promise<LocalFsStatus> {
  const config = await getLocalFsConfig();
  const provider = createFileSystemProvider();

  if (!config.enabled) {
    await clearResumeAlarm();
    return await setLocalFsStatus({
      state: 'idle',
      backendType: provider.backendType,
      currentFilePath: null,
    });
  }

  const ready = await provider.isReady();
  if (!ready) {
    const errorHint =
      provider instanceof ChromiumFsaProvider
        ? (await provider.getPermissionState()) === 'unselected'
          ? 'No root folder selected'
          : 'Folder write permission required'
        : 'Downloads folder configuration missing';

    return await setLocalFsStatus({
      state: 'needs_permission',
      backendType: provider.backendType,
      lastError: errorHint,
      currentFilePath: null,
    });
  }

  const cachedSync = await getCachedSyncResult();
  if (!cachedSync) {
    return await getLocalFsStatus();
  }

  const [trackedCourseIds, settings, localCoursesRes, manifest, existingQueue, prevStatus] =
    await Promise.all([
      getTrackedCourseIds(),
      getSettings(),
      browser.storage.local.get('enrolledCoursesCache').catch(() => ({})) as Promise<{
        enrolledCoursesCache?: NonNullable<Parameters<typeof buildLocalFsTreePlan>[1]>['enrolledCourses'];
      }>,
      getLocalFsManifest(),
      getLocalFsQueue(),
      getLocalFsStatus(),
    ]);

  const plan = buildLocalFsTreePlan(cachedSync, {
    trackedCourseIds,
    enrolledCourses: localCoursesRes.enrolledCoursesCache,
    coursesCustomNames: settings.coursesCustomNames,
    useCourseNicknames: config.useCourseNicknames,
    includeAssignments: config.includeAssignments,
    includeSubmissions: config.includeSubmissions,
    existingCourseFolderNames: manifest.courseFolderNames,
    existingManifest: manifest.files,
  });

  manifest.courseFolderNames = plan.courseFolderNames;
  await setLocalFsManifest(manifest);

  const diff = planLocalFsDiff(plan, manifest.files, {
    maxFileSizeMb: config.maxFileSizeMb,
  });

  const queueById = new Map<string, LocalFsQueueItem>();
  for (const item of existingQueue) {
    if (options.retryFailed) {
      queueById.set(item.moodleFileId, { ...item, attempts: 0, nextRetryAt: undefined });
    } else {
      queueById.set(item.moodleFileId, item);
    }
  }

  for (const d of diff.toDownload) {
    const existing = queueById.get(d.file.moodleFileId);
    if (!existing || d.reason === 'updated') {
      queueById.set(d.file.moodleFileId, toQueueItem(d.file, d.reason));
    }
  }

  // Check missing files on disk if autoResyncMissingFiles or forceRescan is enabled
  if (config.autoResyncMissingFiles || options.forceRescan) {
    if (provider instanceof FirefoxDownloadsProvider) {
      await provider.reconcileManifest();
    }
    const refreshedManifest =
      provider instanceof FirefoxDownloadsProvider ? await getLocalFsManifest() : manifest;
    const itemsToVerify = Object.values(refreshedManifest.files);
    const unchangedIds = new Set(diff.unchanged.map((u) => u.moodleFileId));
    const plannedById = new Map(plan.files.map((f) => [f.moodleFileId, f]));
    for (const rec of itemsToVerify) {
      if (!unchangedIds.has(rec.moodleFileId)) continue;
      if (queueById.has(rec.moodleFileId)) continue;
      const exists = await provider.fileExists(rec);
      if (!exists) {
        const planned = plannedById.get(rec.moodleFileId);
        if (planned) {
          queueById.set(planned.moodleFileId, toQueueItem(planned, 'missing'));
        }
      }
    }
  }

  let updatedLogs = [...prevStatus.logs];
  if (options.retryFailed) {
    const plannedById = new Map(plan.files.map((f) => [f.moodleFileId, f]));
    for (const log of prevStatus.logs) {
      if (log.status === 'failed' && !queueById.has(log.moodleFileId)) {
        const planned = plannedById.get(log.moodleFileId);
        if (planned) {
          queueById.set(planned.moodleFileId, toQueueItem(planned, 'missing'));
        }
      }
    }
    updatedLogs = updatedLogs.filter((l) => l.status !== 'failed');
  }

  for (const large of diff.skippedTooLarge) {
    updatedLogs = appendLog(updatedLogs, {
      moodleFileId: large.moodleFileId,
      fileName: large.fileName,
      relativePath: large.relativePath,
      status: 'skipped_too_large',
      message: `Skipped (${Math.round(large.fileSize / (1024 * 1024))} MB > ${config.maxFileSizeMb} MB limit)`,
      timestamp: Date.now(),
    });
  }

  const nextQueue = Array.from(queueById.values());
  await setLocalFsQueue(nextQueue);

  const isBulk = nextQueue.length > 10;
  const status = await setLocalFsStatus({
    backendType: provider.backendType,
    isInitialBulkMode: isBulk || (prevStatus.state === 'syncing' && prevStatus.isInitialBulkMode),
    totalQueued: nextQueue.length,
    completedInCycle: nextQueue.length === 0 ? 0 : prevStatus.completedInCycle,
    failedCount: updatedLogs.filter((l) => l.status === 'failed').length,
    skippedTooLargeCount: updatedLogs.filter((l) => l.status === 'skipped_too_large').length,
    syncedCountTotal: Object.keys(manifest.files).length,
    logs: updatedLogs,
    lastError: null,
  });

  if (nextQueue.length > 0 && status.state !== 'paused') {
    void processLocalFsQueue(options.reauthenticate);
  } else if (nextQueue.length === 0) {
    await clearResumeAlarm();
    await setLocalFsStatus({
      state: 'idle',
      currentFilePath: null,
      lastSyncAt: Date.now(),
    });
  }

  return await getLocalFsStatus();
}

export async function processLocalFsQueue(reauthenticate?: ReauthCallback): Promise<void> {
  if (activeQueuePromise) {
    return await activeQueuePromise;
  }

  abortRequested = false;

  activeQueuePromise = (async () => {
    const provider = createFileSystemProvider();
    let consecutiveRateLimits = 0;
    let processedInRun = 0;

    try {
      const initialConfig = await getLocalFsConfig();
      if (!initialConfig.enabled) {
        await clearResumeAlarm();
        await setLocalFsStatus({ state: 'idle', currentFilePath: null });
        return;
      }

      const initialStatus = await getLocalFsStatus();
      if (initialStatus.state === 'paused') {
        await clearResumeAlarm();
        return;
      }

      if (
        initialStatus.state === 'cooldown' &&
        initialStatus.pausedUntil &&
        Date.now() < initialStatus.pausedUntil
      ) {
        await ensureResumeAlarm();
        return;
      }

      if (!(await provider.isReady())) {
        await setLocalFsStatus({
          state: 'needs_permission',
          backendType: provider.backendType,
          currentFilePath: null,
        });
        return;
      }

      let queue = await getLocalFsQueue();
      if (queue.length === 0) {
        await clearResumeAlarm();
        await setLocalFsStatus({
          state: 'idle',
          backendType: provider.backendType,
          totalQueued: 0,
          currentFilePath: null,
          lastSyncAt: Date.now(),
        });
        return;
      }

      await ensureResumeAlarm();

      const isInitialBulkMode = queue.length > 10 || initialStatus.isInitialBulkMode;
      const totalAtStart = Math.max(queue.length + initialStatus.completedInCycle, queue.length);
      let completedInCycle = initialStatus.completedInCycle || 0;

      await setLocalFsStatus({
        state: 'syncing',
        backendType: provider.backendType,
        isInitialBulkMode,
        totalQueued: totalAtStart,
        pausedUntil: null,
        lastError: null,
      });

      while (!abortRequested) {
        const cfg = await getLocalFsConfig();
        const curStatus = await getLocalFsStatus();
        if (!cfg.enabled || curStatus.state === 'paused') {
          await clearResumeAlarm();
          return;
        }

        queue = await getLocalFsQueue();
        if (queue.length === 0) {
          await clearResumeAlarm();
          const manifest = await getLocalFsManifest();
          await setLocalFsStatus({
            state: 'idle',
            isInitialBulkMode: false,
            totalQueued: 0,
            completedInCycle: 0,
            syncedCountTotal: Object.keys(manifest.files).length,
            currentFilePath: null,
            lastSyncAt: Date.now(),
          });
          return;
        }

        const now = Date.now();
        const readyIndex = queue.findIndex((q) => !q.nextRetryAt || q.nextRetryAt <= now);
        if (readyIndex === -1) {
          // Only backoff-delayed items remain; let alarm wake us up
          await ensureResumeAlarm();
          const earliestRetry = Math.min(...queue.map((q) => q.nextRetryAt || now + 60000));
          await setLocalFsStatus({
            state: 'cooldown',
            pausedUntil: earliestRetry,
            currentFilePath: null,
          });
          return;
        }

        const item = queue[readyIndex];
        await setLocalFsStatus({
          state: 'syncing',
          currentFilePath: item.relativePath,
        });

        const token = (await getStoredToken()) || '';
        const maxBytes =
          cfg.maxFileSizeMb && cfg.maxFileSizeMb > 0
            ? cfg.maxFileSizeMb * 1024 * 1024
            : Infinity;

        let downloadedSize = item.fileSize || 0;
        try {
          let savedRecord;
          if (provider.backendType === 'downloads') {
            // Preflight headers/auth only (abort body) so Firefox downloads the file ONCE using
            // the persistent https:// URL, keeping DownloadItem records valid across restarts.
            const { authUrl, contentLength } = await preflightMoodleDownloadUrl(
              item,
              token,
              maxBytes,
              reauthenticate
            );
            downloadedSize = contentLength || downloadedSize;
            const manifestBaselineSize = item.fileSize > 0 ? item.fileSize : downloadedSize;
            savedRecord = await provider.writeFile(
              {
                moodleFileId: item.moodleFileId,
                relativePath: item.relativePath,
                lastModified: item.timeModified,
                size: manifestBaselineSize,
                canonicalUrlPath: item.canonicalUrlPath,
              },
              { url: authUrl }
            );
          } else {
            const blob = await fetchValidatedFileBlob(item, token, maxBytes, reauthenticate);
            downloadedSize = blob.size || downloadedSize;
            // Persist Moodle's reported metadata size when present so incremental planLocalFsDiff
            // compares metadata-to-metadata rather than triggering endless re-downloads if transfer sizes differ.
            const manifestBaselineSize = item.fileSize > 0 ? item.fileSize : downloadedSize;

            const authUrl = buildAuthenticatedFileUrl(item.fileUrl, token);
            savedRecord = await provider.writeFile(
              {
                moodleFileId: item.moodleFileId,
                relativePath: item.relativePath,
                lastModified: item.timeModified,
                size: manifestBaselineSize,
                canonicalUrlPath: item.canonicalUrlPath,
              },
              { url: authUrl, blob }
            );
          }

          consecutiveRateLimits = 0;
          processedInRun++;
          completedInCycle++;

          const manifest = await getLocalFsManifest();
          manifest.files[item.moodleFileId] = savedRecord;
          await setLocalFsManifest(manifest);

          const remainingQueue = (await getLocalFsQueue()).filter(
            (q) => q.moodleFileId !== item.moodleFileId
          );
          await setLocalFsQueue(remainingQueue);

          await setLocalFsStatus({
            completedInCycle,
            syncedCountTotal: Object.keys(manifest.files).length,
          });
        } catch (err: unknown) {
          const errMessage = err instanceof Error ? err.message : String(err);
          if (err instanceof LocalFsPermissionError) {
            await setLocalFsStatus({
              state: 'needs_permission',
              lastError: err.message,
              currentFilePath: null,
            });
            return;
          }

          if (err instanceof AuthRedirectError || errMessage.startsWith('Session expired')) {
            await setLocalFsStatus({
              state: 'needs_auth',
              lastError: errMessage,
              currentFilePath: null,
            });
            return;
          }

          if (err instanceof OversizedFileError) {
            const cur = await getLocalFsStatus();
            const logs = appendLog(cur.logs, {
              moodleFileId: item.moodleFileId,
              fileName: item.fileName,
              relativePath: item.relativePath,
              status: 'skipped_too_large',
              message: err.message,
              timestamp: Date.now(),
            });
            const remaining = (await getLocalFsQueue()).filter(
              (q) => q.moodleFileId !== item.moodleFileId
            );
            await setLocalFsQueue(remaining);
            await setLocalFsStatus({
              logs,
              skippedTooLargeCount: logs.filter((l) => l.status === 'skipped_too_large').length,
            });
            continue;
          }

          if (err instanceof RateLimitError) {
            consecutiveRateLimits++;
            if (consecutiveRateLimits >= 3) {
              const pausedUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
              await ensureResumeAlarm();
              await setLocalFsStatus({
                state: 'cooldown',
                pausedUntil,
                lastError: err.message,
                currentFilePath: null,
              });
              return;
            }
          }

          const nextAttempts = (item.attempts || 0) + 1;
          const currentQ = await getLocalFsQueue();
          if (nextAttempts >= MAX_RETRIES_PER_FILE) {
            const cur = await getLocalFsStatus();
            const logs = appendLog(cur.logs, {
              moodleFileId: item.moodleFileId,
              fileName: item.fileName,
              relativePath: item.relativePath,
              status: 'failed',
              message: errMessage,
              timestamp: Date.now(),
            });
            await setLocalFsQueue(currentQ.filter((q) => q.moodleFileId !== item.moodleFileId));
            await setLocalFsStatus({
              logs,
              failedCount: logs.filter((l) => l.status === 'failed').length,
            });
          } else {
            const backoffMs =
              err instanceof RateLimitError && err.retryAfterMs
                ? err.retryAfterMs
                : Math.min(120000, 5000 * Math.pow(3, nextAttempts - 1)) + randomInt(300, 1500);
            const updatedQ = currentQ.map((q) =>
              q.moodleFileId === item.moodleFileId
                ? {
                    ...q,
                    attempts: nextAttempts,
                    nextRetryAt: Date.now() + backoffMs,
                    lastError: errMessage,
                  }
                : q
            );
            await setLocalFsQueue(updatedQ);
          }
        }

        // Polite adaptive throttling before next item
        const afterQueue = await getLocalFsQueue();
        if (afterQueue.length > 0 && !abortRequested) {
          let delayMs: number;
          if (!isInitialBulkMode && afterQueue.length <= 10) {
            delayMs = randomInt(400, 800);
          } else if (cfg.speedProfile === 'moderate') {
            const sizeCool = Math.min(3000, Math.floor(downloadedSize / (1024 * 1024)) * 300);
            delayMs = randomInt(600, 1200) + sizeCool;
          } else {
            const sizeCool = Math.min(8000, Math.floor(downloadedSize / (512 * 1024)) * 400);
            delayMs = randomInt(1500, 2800) + sizeCool;
            if (processedInRun > 0 && processedInRun % 20 === 0) {
              delayMs += randomInt(6000, 10000);
            }
          }
          await sleep(delayMs);
        }
      }
    } finally {
      activeQueuePromise = null;
    }
  })();

  await activeQueuePromise;
}

export async function pauseLocalFsSync(): Promise<LocalFsStatus> {
  abortRequested = true;
  await clearResumeAlarm();
  return await setLocalFsStatus({ state: 'paused', currentFilePath: null });
}

export async function resumeLocalFsSync(reauthenticate?: ReauthCallback): Promise<LocalFsStatus> {
  await setLocalFsStatus({ state: 'idle', pausedUntil: null, lastError: null });
  return await enqueueLocalFsSync({ reauthenticate });
}

export async function resetLocalFsState(disableToggle = false): Promise<void> {
  abortRequested = true;
  await clearResumeAlarm();
  if (disableToggle) {
    await setLocalFsConfig({ enabled: false, rootLabel: null });
    await clearDirectoryHandle();
  }
  await setLocalFsManifest({ files: {}, courseFolderNames: {} });
  await setLocalFsQueue([]);
  const provider = createFileSystemProvider();
  await setLocalFsStatus({
    ...DEFAULT_LOCAL_FS_STATUS,
    backendType: provider.backendType,
  });
}

export async function teardownLocalFsOnLogout(): Promise<void> {
  abortRequested = true;
  await clearResumeAlarm();
  await browser.storage.local.remove([
    'localFsConfig',
    'localFsManifest',
    'localFsQueue',
    'localFsStatus',
  ]);
  await clearDirectoryHandle();
}

export async function recoverStaleLocalFsStateOnBoot(reauthenticate?: ReauthCallback): Promise<void> {
  try {
    const cfg = await getLocalFsConfig();
    if (!cfg.enabled) return;

    const status = await getLocalFsStatus();
    const queue = await getLocalFsQueue();
    if (status.state === 'syncing' && queue.length === 0) {
      await setLocalFsStatus({ state: 'idle', currentFilePath: null });
      return;
    }

    if (queue.length > 0 && status.state !== 'paused') {
      void processLocalFsQueue(reauthenticate);
    }
  } catch (e) {
    console.warn('[LocalFS] Failed boot state recovery:', e);
  }
}
