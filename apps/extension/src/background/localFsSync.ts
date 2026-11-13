import browser from 'webextension-polyfill';
import {
  buildAuthenticatedFileUrl,
  buildLocalFsTreePlan,
  planLocalFsDiff,
  sanitizeRelativePath,
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
  type LocalFsManifestRecord,
  type LocalFsQueueItem,
  type LocalFsStatus,
} from '../shared/storage.js';
import {
  createFileSystemProvider,
  type FilePresenceState,
  type SyncedFileRecord,
} from '../services/fs/FileSystemProvider.js';
import { ChromiumFsaProvider, LocalFsPermissionError } from '../services/fs/ChromiumFsaProvider.js';
import {
  FirefoxDownloadsProvider,
  LocalFsDownloadAuthError,
  LocalFsDownloadOversizedError,
  findBestMatchingDownload,
  normalizeFsPath,
  type ReconcileManifestReport,
} from '../services/fs/FirefoxDownloadsProvider.js';
import { clearDirectoryHandle } from '../services/fs/fsaHandleStore.js';

export const LOCAL_FS_RESUME_ALARM = 'localFsResume';
const MAX_RETRIES_PER_FILE = 3;
const RATE_LIMIT_COOLDOWN_MS = 15 * 60 * 1000;
const MAX_LOGS = 200;
const MAX_SLEEP_SLICE_MS = 2500;

let activeQueuePromise: Promise<void> | null = null;
let abortRequested = false;
let activeSleepAbort: AbortController | null = null;
let stateLockTail: Promise<void> = Promise.resolve();
let mutationEpoch = 0;
let controlEpoch = 0;

export type ReauthCallback = () => Promise<string | null>;

function withStateLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = stateLockTail.then(fn, fn);
  stateLockTail = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/**
 * Sliced abortable sleep bounded per chunk so MV3 service workers remain responsive
 * and Pause/Resume/Reset wakes immediately without waiting out multi-second waits.
 */
async function abortableSleep(totalMs: number): Promise<void> {
  if (totalMs <= 0 || abortRequested) return;
  let remaining = totalMs;
  while (remaining > 0 && !abortRequested) {
    const slice = Math.min(remaining, MAX_SLEEP_SLICE_MS);
    const ctrl = new AbortController();
    activeSleepAbort = ctrl;
    await new Promise<void>((resolve) => {
      if (abortRequested || ctrl.signal.aborted) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        ctrl.signal.removeEventListener('abort', onAbort);
        resolve();
      }, slice);
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      ctrl.signal.addEventListener('abort', onAbort, { once: true });
    });
    if (activeSleepAbort === ctrl) {
      activeSleepAbort = null;
    }
    remaining -= slice;
  }
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
  const filtered = logs.filter((l) => l.moodleFileId !== entry.moodleFileId);
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
  const declaredLen = Number(res.headers.get('content-length') || 0);
  if (declaredLen > 32768) {
    return { isError: false, isAuthError: false, message: '' };
  }
  try {
    let json: Record<string, unknown> | null = null;
    const cloned = res.clone();
    if (cloned.body && typeof cloned.body.getReader === 'function') {
      const reader = cloned.body.getReader();
      try {
        const chunks: Uint8Array[] = [];
        let total = 0;
        const limit = 16384;
        while (total <= limit) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            total += value.byteLength;
            if (total > limit) {
              // Never await branch2.cancel() on a res.clone() tee'd stream: WHATWG ReadableStreamTee's
              // cancelPromise waits for branch 1 (res.body) to also cancel, which deadlocks!
              void reader.cancel().catch(() => {});
              return { isError: false, isAuthError: false, message: '' };
            }
            chunks.push(value);
          }
        }
        const merged = new Uint8Array(total);
        let offset = 0;
        for (const c of chunks) {
          merged.set(c, offset);
          offset += c.byteLength;
        }
        json = JSON.parse(new TextDecoder().decode(merged)) as Record<string, unknown>;
      } finally {
        try {
          reader.releaseLock();
        } catch {
          // Ignore lock already released
        }
      }
    } else {
      json = (await cloned.json()) as Record<string, unknown>;
    }
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
    // Not parseable JSON or aborted read
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

interface ValidatedStreamSource {
  authUrl: string;
  contentLength: number;
  stream?: ReadableStream<Uint8Array>;
  blob?: Blob;
  getStreamedBytes: () => number;
}

/**
 * Fetches and validates an HTTP download response for Chromium FSA, preferring streaming
 * through a byte-limiting TransformStream so multi-hundred-MB files are never buffered in RAM.
 */
async function fetchValidatedFileSource(
  item: LocalFsQueueItem,
  token: string,
  maxBytes: number,
  reauth?: ReauthCallback
): Promise<ValidatedStreamSource> {
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

    const contentLength = Number(res.headers.get('content-length') || 0);
    if (maxBytes < Infinity && contentLength > maxBytes) {
      abortCtrl.abort();
      throw new OversizedFileError(contentLength);
    }

    const jsonCheck = await checkIsJsonApiError(res);
    if (jsonCheck.isError) {
      abortCtrl.abort();
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

    if (res.body && typeof res.body.pipeThrough === 'function' && typeof TransformStream === 'function') {
      let streamedBytes = 0;
      const limiter = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          streamedBytes += chunk.byteLength;
          if (maxBytes < Infinity && streamedBytes > maxBytes) {
            const err = new OversizedFileError(streamedBytes);
            abortCtrl.abort(err);
            controller.error(err);
            return;
          }
          controller.enqueue(chunk);
        },
      });
      return {
        authUrl,
        contentLength,
        stream: res.body.pipeThrough(limiter),
        getStreamedBytes: () => streamedBytes || contentLength,
      };
    }

    const blob = await res.blob();
    if (maxBytes < Infinity && blob.size > maxBytes) {
      throw new OversizedFileError(blob.size);
    }
    return {
      authUrl,
      contentLength: blob.size || contentLength,
      blob,
      getStreamedBytes: () => blob.size || contentLength,
    };
  }

  throw new AuthRedirectError('Authentication expired while downloading file');
}

interface EnqueueResult {
  status: LocalFsStatus;
  shouldStartQueue: boolean;
}

async function _enqueueLocalFsSyncLocked(options: {
  forceRescan?: boolean;
  retryFailed?: boolean;
  clearCooldown?: boolean;
  resumeFromPause?: boolean;
  reauthenticate?: ReauthCallback;
}): Promise<EnqueueResult> {
  const config = await getLocalFsConfig();
  const provider = createFileSystemProvider();

  if (!config.enabled) {
    await clearResumeAlarm();
    const status = await setLocalFsStatus({
      state: 'idle',
      backendType: provider.backendType,
      isInitialBulkMode: false,
      totalQueued: 0,
      completedInCycle: 0,
      pendingCount: 0,
      currentFilePath: null,
      pausedUntil: null,
      lastError: null,
    });
    return { status, shouldStartQueue: false };
  }

  const ready = await provider.isReady();
  if (!ready) {
    const [existingQueue, prevStatus, manifest] = await Promise.all([
      getLocalFsQueue(),
      getLocalFsStatus(),
      getLocalFsManifest(),
    ]);
    const errorHint =
      provider instanceof ChromiumFsaProvider
        ? (await provider.getPermissionState()) === 'unselected'
          ? 'No root folder selected'
          : 'Folder write permission required'
        : 'Downloads folder configuration missing';

    const completed =
      existingQueue.length > 0 && prevStatus.totalQueued > 0
        ? Math.max(0, prevStatus.completedInCycle || 0)
        : 0;
    const status = await setLocalFsStatus({
      state: 'needs_permission',
      backendType: provider.backendType,
      lastError: errorHint,
      currentFilePath: null,
      pendingCount: existingQueue.length,
      completedInCycle: completed,
      totalQueued: existingQueue.length > 0 ? completed + existingQueue.length : 0,
      syncedCountTotal: Object.keys(manifest.files).length,
    });
    return { status, shouldStartQueue: false };
  }

  const cachedSync = await getCachedSyncResult();
  if (!cachedSync) {
    return { status: await getLocalFsStatus(), shouldStartQueue: false };
  }

  const [trackedCourseIds, settings, localCoursesRes, initialManifest, existingQueue, prevStatus] =
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

  let manifest = initialManifest;

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

  const plannedById = new Map(plan.files.map((f) => [f.moodleFileId, f]));

  // Prune orphaned manifest records when cachedSync has no sync errors (authoritative snapshot),
  // and always strip disabled assignment/submission records if those toggles were turned off.
  const hasSyncErrors = Array.isArray(cachedSync.errors) && cachedSync.errors.length > 0;
  let manifestPruned = false;
  for (const fileId of Object.keys(manifest.files)) {
    if (!hasSyncErrors && !plannedById.has(fileId)) {
      delete manifest.files[fileId];
      manifestPruned = true;
      continue;
    }
    if (!config.includeAssignments && (fileId.startsWith('asg_att:') || fileId.startsWith('asg_sub:'))) {
      delete manifest.files[fileId];
      manifestPruned = true;
      continue;
    }
    if (!config.includeSubmissions && fileId.startsWith('asg_sub:')) {
      delete manifest.files[fileId];
      manifestPruned = true;
    }
  }

  const activeCourseIds = new Set(plan.files.map((f) => f.courseId));
  const nextCourseFolders: Record<number, string> = {};
  for (const [rawId, folderName] of Object.entries(plan.courseFolderNames)) {
    const cid = Number(rawId);
    const hasManifestFilesInFolder = Object.values(manifest.files).some((rec) =>
      rec.relativePath.startsWith(`${folderName}/`)
    );
    if (activeCourseIds.has(cid) || hasManifestFilesInFolder) {
      nextCourseFolders[cid] = folderName;
    } else {
      manifestPruned = true;
    }
  }
  manifest.courseFolderNames = nextCourseFolders;
  await setLocalFsManifest(manifest);

  const diff = planLocalFsDiff(plan, manifest.files, {
    maxFileSizeMb: config.maxFileSizeMb,
  });

  // Before queueing "new" files, check disk / browser download history so reinstalling
  // or pointing to an existing synced folder never blindly re-downloads unchanged files.
  let remainingToDownload = diff.toDownload;
  const adoptedIdSet = new Set<string>();
  const newCandidates = diff.toDownload
    .filter((d) => d.reason === 'new')
    .map((d) => d.file);
  if (newCandidates.length > 0 && typeof provider.adoptExistingFiles === 'function') {
    const adoptedMap = await provider.adoptExistingFiles(newCandidates);
    const adoptedEntries = Object.entries(adoptedMap);
    if (adoptedEntries.length > 0) {
      for (const [id, rec] of adoptedEntries) {
        manifest.files[id] = rec;
        adoptedIdSet.add(id);
      }
      await setLocalFsManifest(manifest);
      remainingToDownload = diff.toDownload.filter((d) => !adoptedMap[d.file.moodleFileId]);
    }
  }

  // Reconcile Firefox download IDs once in background under state lock
  if (provider instanceof FirefoxDownloadsProvider) {
    await provider.reconcileManifestDetailed();
    manifest = await getLocalFsManifest();
  }

  // Check genuinely missing files on disk if autoResyncMissingFiles or forceRescan is enabled.
  // Crucially, treat 'unverifiable' (e.g., Firefox scanned/rclone entries without a downloadId or
  // purged Firefox history) as non-missing so existing external files are NEVER blindly re-downloaded.
  const confirmedMissingIds = new Set<string>();
  const checkMissing = config.autoResyncMissingFiles || Boolean(options.forceRescan);
  if (checkMissing && diff.unchanged.length > 0) {
    const unchangedRecords: SyncedFileRecord[] = [];
    for (const u of diff.unchanged) {
      const rec = manifest.files[u.moodleFileId];
      if (rec) unchangedRecords.push(rec);
    }

    if (unchangedRecords.length > 0) {
      let presenceMap: Record<string, FilePresenceState> = {};
      if (provider instanceof FirefoxDownloadsProvider) {
        presenceMap = await provider.batchCheckFilePresence(unchangedRecords);
      } else if (typeof provider.checkFilePresence === 'function') {
        for (const rec of unchangedRecords) {
          presenceMap[rec.moodleFileId] = await provider.checkFilePresence(rec);
        }
      } else {
        for (const rec of unchangedRecords) {
          presenceMap[rec.moodleFileId] = (await provider.fileExists(rec)) ? 'present' : 'missing';
        }
      }

      for (const rec of unchangedRecords) {
        if (presenceMap[rec.moodleFileId] === 'missing') {
          confirmedMissingIds.add(rec.moodleFileId);
        }
      }
    }
  }

  const skippedIds = new Set(diff.skippedTooLarge.map((s) => s.moodleFileId));
  const unchangedIds = new Set(diff.unchanged.map((u) => u.moodleFileId));
  const queueById = new Map<string, LocalFsQueueItem>();

  // Strict queue eviction: keep existing queued items only if still planned, not oversized,
  // and still requiring transfer (either in diff.toDownload or confirmed missing when checking missing).
  for (const item of existingQueue) {
    const planned = plannedById.get(item.moodleFileId);
    if (!planned) continue;
    if (skippedIds.has(item.moodleFileId)) continue;
    if (adoptedIdSet.has(item.moodleFileId)) continue;

    if (unchangedIds.has(item.moodleFileId)) {
      if (!checkMissing || !confirmedMissingIds.has(item.moodleFileId)) {
        continue;
      }
    }

    const refreshedBase: LocalFsQueueItem = {
      ...item,
      courseId: planned.courseId,
      sourceCourseId: planned.sourceCourseId,
      relativePath: planned.relativePath,
      fileName: planned.fileName,
      fileUrl: planned.fileUrl,
      canonicalUrlPath: planned.canonicalUrlPath,
      fileSize: planned.fileSize,
      timeModified: planned.timeModified,
    };

    if (options.retryFailed) {
      queueById.set(item.moodleFileId, {
        ...refreshedBase,
        attempts: 0,
        nextRetryAt: undefined,
        lastError: undefined,
      });
    } else if (options.clearCooldown) {
      queueById.set(item.moodleFileId, {
        ...refreshedBase,
        nextRetryAt: undefined,
      });
    } else {
      queueById.set(item.moodleFileId, refreshedBase);
    }
  }

  for (const d of remainingToDownload) {
    const existing = queueById.get(d.file.moodleFileId);
    if (!existing || d.reason === 'updated') {
      queueById.set(d.file.moodleFileId, toQueueItem(d.file, d.reason));
    }
  }

  for (const missingId of confirmedMissingIds) {
    if (!queueById.has(missingId)) {
      const planned = plannedById.get(missingId);
      if (planned) {
        queueById.set(missingId, toQueueItem(planned, 'missing'));
      }
    }
  }

  if (options.retryFailed) {
    for (const log of prevStatus.logs) {
      if (log.status !== 'failed') continue;
      if (queueById.has(log.moodleFileId)) continue;
      const planned = plannedById.get(log.moodleFileId);
      if (!planned || skippedIds.has(planned.moodleFileId)) continue;
      if (!unchangedIds.has(planned.moodleFileId) || confirmedMissingIds.has(planned.moodleFileId)) {
        queueById.set(planned.moodleFileId, toQueueItem(planned, 'missing'));
      }
    }
  }

  // Recompute logs cleanly: strip resolved/obsolete failed entries and regenerate skipped_too_large strictly from diff
  let updatedLogs = prevStatus.logs.filter((l) => {
    if (l.status === 'skipped_too_large') return false;
    if (options.retryFailed && l.status === 'failed') return false;
    if (!plannedById.has(l.moodleFileId)) return false;
    if (skippedIds.has(l.moodleFileId)) return false;
    if (adoptedIdSet.has(l.moodleFileId)) return false;
    if (unchangedIds.has(l.moodleFileId) && !confirmedMissingIds.has(l.moodleFileId)) return false;
    return true;
  });

  const capLabel = config.maxFileSizeMb > 0 ? `${config.maxFileSizeMb} MB` : 'limit';
  for (const large of diff.skippedTooLarge) {
    updatedLogs = appendLog(updatedLogs, {
      moodleFileId: large.moodleFileId,
      fileName: large.fileName,
      relativePath: large.relativePath,
      status: 'skipped_too_large',
      message: `Skipped (${Math.round(large.fileSize / (1024 * 1024))} MB > ${capLabel} limit)`,
      timestamp: Date.now(),
    });
  }

  const nextQueue = Array.from(queueById.values());
  await setLocalFsQueue(nextQueue);

  const syncedCountTotal = Object.keys(manifest.files).length;
  const plannedTotal = plan.files.length;
  const failedCount = updatedLogs.filter((l) => l.status === 'failed').length;
  const skippedTooLargeCount = updatedLogs.filter((l) => l.status === 'skipped_too_large').length;

  if (nextQueue.length === 0) {
    await clearResumeAlarm();
    const idleStatus = await setLocalFsStatus({
      state: 'idle',
      backendType: provider.backendType,
      isInitialBulkMode: false,
      totalQueued: 0,
      completedInCycle: 0,
      plannedTotal,
      pendingCount: 0,
      failedCount,
      skippedTooLargeCount,
      syncedCountTotal,
      currentFilePath: null,
      pausedUntil: null,
      lastError: null,
      lastSyncAt:
        adoptedIdSet.size > 0 || manifestPruned || prevStatus.totalQueued > 0 || !prevStatus.lastSyncAt
          ? Date.now()
          : prevStatus.lastSyncAt,
      logs: updatedLogs,
    });
    return { status: idleStatus, shouldStartQueue: false };
  }

  const prevCompleted =
    prevStatus.totalQueued > 0 && prevStatus.state !== 'idle'
      ? Math.max(0, prevStatus.completedInCycle || 0)
      : 0;
  const totalQueued = prevCompleted + nextQueue.length;
  const isBulk = nextQueue.length > 10;

  let nextState = prevStatus.state;
  let nextPausedUntil = prevStatus.pausedUntil ?? null;
  if (prevStatus.state === 'needs_permission' || prevStatus.state === 'needs_auth' || prevStatus.state === 'error') {
    nextState = 'idle';
  }
  if (options.resumeFromPause && nextState === 'paused') {
    nextState = 'idle';
  }
  if (options.clearCooldown || options.retryFailed || options.forceRescan || options.resumeFromPause) {
    if (nextState === 'cooldown') {
      nextState = 'idle';
    }
    nextPausedUntil = null;
  }

  const isPaused = nextState === 'paused';
  const isWaitingCooldown =
    nextState === 'cooldown' && nextPausedUntil !== null && Date.now() < nextPausedUntil;
  if (!isPaused && !isWaitingCooldown) {
    nextState = 'syncing';
    nextPausedUntil = null;
  }
  const status = await setLocalFsStatus({
    state: nextState,
    backendType: provider.backendType,
    isInitialBulkMode: isBulk || (prevStatus.state !== 'idle' && prevStatus.isInitialBulkMode),
    totalQueued,
    completedInCycle: prevCompleted,
    plannedTotal,
    pendingCount: nextQueue.length,
    failedCount,
    skippedTooLargeCount,
    syncedCountTotal,
    pausedUntil: nextPausedUntil,
    logs: updatedLogs,
    lastError: null,
  });

  if (!isPaused) {
    await ensureResumeAlarm();
  }

  return { status, shouldStartQueue: !isPaused && !isWaitingCooldown };
}

export async function enqueueLocalFsSync(options: {
  forceRescan?: boolean;
  retryFailed?: boolean;
  clearCooldown?: boolean;
  reauthenticate?: ReauthCallback;
} = {}): Promise<LocalFsStatus> {
  const result = await withStateLock(() => _enqueueLocalFsSyncLocked(options));
  if (result.shouldStartQueue) {
    void processLocalFsQueue(options.reauthenticate);
  }
  return result.status;
}

export async function processLocalFsQueue(reauthenticate?: ReauthCallback): Promise<void> {
  while (activeQueuePromise) {
    if (abortRequested) {
      activeSleepAbort?.abort();
      await activeQueuePromise.catch(() => {});
      continue;
    }
    return await activeQueuePromise;
  }

  abortRequested = false;
  const runEpoch = mutationEpoch;

  activeQueuePromise = (async () => {
    const provider = createFileSystemProvider();
    let consecutiveRateLimits = 0;
    let processedInRun = 0;

    try {
      const initialGate = await withStateLock(async () => {
        if (runEpoch !== mutationEpoch) {
          return { action: 'exit' as const, isBulk: false };
        }
        const initialConfig = await getLocalFsConfig();
        if (!initialConfig.enabled) {
          await clearResumeAlarm();
          await setLocalFsStatus({
            state: 'idle',
            isInitialBulkMode: false,
            currentFilePath: null,
            pausedUntil: null,
            lastError: null,
            totalQueued: 0,
            completedInCycle: 0,
            pendingCount: 0,
          });
          return { action: 'exit' as const, isBulk: false };
        }

        const initialStatus = await getLocalFsStatus();
        if (initialStatus.state === 'paused') {
          await clearResumeAlarm();
          return { action: 'exit' as const, isBulk: false };
        }

        if (
          initialStatus.state === 'cooldown' &&
          initialStatus.pausedUntil &&
          Date.now() < initialStatus.pausedUntil
        ) {
          await ensureResumeAlarm();
          return { action: 'exit' as const, isBulk: false };
        }

        if (!(await provider.isReady())) {
          await setLocalFsStatus({
            state: 'needs_permission',
            backendType: provider.backendType,
            currentFilePath: null,
          });
          return { action: 'exit' as const, isBulk: false };
        }

        const queue = await getLocalFsQueue();
        if (queue.length === 0) {
          await clearResumeAlarm();
          const manifest = await getLocalFsManifest();
          await setLocalFsStatus({
            state: 'idle',
            backendType: provider.backendType,
            isInitialBulkMode: false,
            totalQueued: 0,
            completedInCycle: 0,
            pendingCount: 0,
            syncedCountTotal: Object.keys(manifest.files).length,
            currentFilePath: null,
            pausedUntil: null,
            lastSyncAt: Date.now(),
          });
          return { action: 'exit' as const, isBulk: false };
        }

        await ensureResumeAlarm();
        const completed = Math.max(0, initialStatus.completedInCycle || 0);
        const totalAtStart = completed + queue.length;
        const isBulk = queue.length > 10 || initialStatus.isInitialBulkMode;

        await setLocalFsStatus({
          state: 'syncing',
          backendType: provider.backendType,
          isInitialBulkMode: isBulk,
          totalQueued: totalAtStart,
          completedInCycle: completed,
          pendingCount: queue.length,
          pausedUntil: null,
          lastError: null,
        });

        return { action: 'run' as const, isBulk };
      });

      if (initialGate.action !== 'run') {
        return;
      }

      const isInitialBulkMode = initialGate.isBulk;

      while (!abortRequested && runEpoch === mutationEpoch) {
        const nextStep = await withStateLock(async () => {
          if (abortRequested || runEpoch !== mutationEpoch) {
            return { kind: 'exit' as const };
          }
          const [cfg, curStatus, queue, manifest] = await Promise.all([
            getLocalFsConfig(),
            getLocalFsStatus(),
            getLocalFsQueue(),
            getLocalFsManifest(),
          ]);

          if (!cfg.enabled || curStatus.state === 'paused') {
            await clearResumeAlarm();
            return { kind: 'exit' as const };
          }

          if (queue.length === 0) {
            await clearResumeAlarm();
            await setLocalFsStatus({
              state: 'idle',
              isInitialBulkMode: false,
              totalQueued: 0,
              completedInCycle: 0,
              pendingCount: 0,
              syncedCountTotal: Object.keys(manifest.files).length,
              currentFilePath: null,
              pausedUntil: null,
              lastSyncAt: Date.now(),
            });
            return { kind: 'exit' as const };
          }

          const now = Date.now();
          const readyIndex = queue.findIndex((q) => !q.nextRetryAt || q.nextRetryAt <= now);
          if (readyIndex === -1) {
            await ensureResumeAlarm();
            const earliestRetry = Math.min(...queue.map((q) => q.nextRetryAt || now + 60000));
            const completed = Math.max(0, curStatus.completedInCycle || 0);
            await setLocalFsStatus({
              state: 'cooldown',
              pausedUntil: earliestRetry,
              currentFilePath: null,
              totalQueued: completed + queue.length,
              pendingCount: queue.length,
            });
            return { kind: 'exit' as const };
          }

          const item = queue[readyIndex];
          const completed = Math.max(0, curStatus.completedInCycle || 0);
          await setLocalFsStatus({
            state: 'syncing',
            currentFilePath: item.relativePath,
            totalQueued: completed + queue.length,
            pendingCount: queue.length,
          });

          return { kind: 'process' as const, item, cfg };
        });

        if (nextStep.kind !== 'process') {
          return;
        }

        const { item, cfg } = nextStep;
        const token = (await getStoredToken()) || '';
        const maxBytes =
          cfg.maxFileSizeMb && cfg.maxFileSizeMb > 0
            ? cfg.maxFileSizeMb * 1024 * 1024
            : Infinity;

        let downloadedSize = item.fileSize || 0;
        let remainingAfterCount = 0;

        try {
          let savedRecord: SyncedFileRecord;
          if (provider.backendType === 'downloads') {
            // Single HTTP request directly via browser.downloads.download (no duplicate GET preflight)
            let activeToken = token;
            let written: SyncedFileRecord | null = null;
            for (let authAttempt = 0; authAttempt < 2; authAttempt++) {
              const authUrl = buildAuthenticatedFileUrl(item.fileUrl, activeToken);
              const manifestBaselineSize = item.fileSize > 0 ? item.fileSize : undefined;
              try {
                written = await provider.writeFile(
                  {
                    moodleFileId: item.moodleFileId,
                    relativePath: item.relativePath,
                    lastModified: item.timeModified,
                    size: manifestBaselineSize,
                    canonicalUrlPath: item.canonicalUrlPath,
                  },
                  {
                    url: authUrl,
                    maxBytes: maxBytes < Infinity ? maxBytes : undefined,
                  }
                );
                break;
              } catch (dlErr) {
                if (dlErr instanceof LocalFsDownloadOversizedError) {
                  throw new OversizedFileError(dlErr.actualBytes);
                }
                if (dlErr instanceof LocalFsDownloadAuthError) {
                  if (authAttempt === 0 && reauthenticate) {
                    const freshToken = await reauthenticate().catch(() => null);
                    if (freshToken) {
                      activeToken = freshToken;
                      continue;
                    }
                  }
                  throw new AuthRedirectError(dlErr.message);
                }
                throw dlErr;
              }
            }
            if (!written) {
              throw new AuthRedirectError('Authentication expired while downloading file');
            }
            savedRecord = written;
            downloadedSize = written.size || downloadedSize;
          } else {
            const source = await fetchValidatedFileSource(item, token, maxBytes, reauthenticate);
            const manifestBaselineSize = item.fileSize > 0 ? item.fileSize : source.contentLength || undefined;
            savedRecord = await provider.writeFile(
              {
                moodleFileId: item.moodleFileId,
                relativePath: item.relativePath,
                lastModified: item.timeModified,
                size: manifestBaselineSize,
                canonicalUrlPath: item.canonicalUrlPath,
              },
              {
                url: source.authUrl,
                stream: source.stream,
                blob: source.blob,
                maxBytes: maxBytes < Infinity ? maxBytes : undefined,
              }
            );
            downloadedSize = source.getStreamedBytes() || downloadedSize;
            if (savedRecord.size === undefined && downloadedSize > 0) {
              savedRecord = { ...savedRecord, size: downloadedSize };
            }
          }

          if (runEpoch !== mutationEpoch) {
            return;
          }

          consecutiveRateLimits = 0;
          processedInRun++;

          remainingAfterCount = await withStateLock(async () => {
            if (runEpoch !== mutationEpoch) return 0;

            const [manifest, curQueue, curStatus] = await Promise.all([
              getLocalFsManifest(),
              getLocalFsQueue(),
              getLocalFsStatus(),
            ]);

            const stillInQueue = curQueue.some((q) => q.moodleFileId === item.moodleFileId);
            if (!stillInQueue) {
              if (curQueue.length === 0) {
                await clearResumeAlarm();
                await setLocalFsStatus({
                  state: 'idle',
                  isInitialBulkMode: false,
                  completedInCycle: 0,
                  totalQueued: 0,
                  pendingCount: 0,
                  syncedCountTotal: Object.keys(manifest.files).length,
                  currentFilePath: null,
                  pausedUntil: null,
                  lastSyncAt: Date.now(),
                });
                return 0;
              }
              return curStatus.state === 'paused' ? 0 : curQueue.length;
            }

            manifest.files[item.moodleFileId] = savedRecord;
            await setLocalFsManifest(manifest);

            const remainingQueue = curQueue.filter((q) => q.moodleFileId !== item.moodleFileId);
            await setLocalFsQueue(remainingQueue);

            const cleanedLogs = curStatus.logs.filter((l) => l.moodleFileId !== item.moodleFileId);
            const failedCount = cleanedLogs.filter((l) => l.status === 'failed').length;
            const skippedTooLargeCount = cleanedLogs.filter(
              (l) => l.status === 'skipped_too_large'
            ).length;

            if (remainingQueue.length === 0) {
              await clearResumeAlarm();
              await setLocalFsStatus({
                state: 'idle',
                isInitialBulkMode: false,
                completedInCycle: 0,
                totalQueued: 0,
                pendingCount: 0,
                syncedCountTotal: Object.keys(manifest.files).length,
                currentFilePath: null,
                pausedUntil: null,
                lastSyncAt: Date.now(),
                logs: cleanedLogs,
                failedCount,
                skippedTooLargeCount,
              });
              return 0;
            }

            const nextCompleted = Math.max(0, (curStatus.completedInCycle || 0) + 1);
            await setLocalFsStatus({
              completedInCycle: nextCompleted,
              totalQueued: nextCompleted + remainingQueue.length,
              pendingCount: remainingQueue.length,
              syncedCountTotal: Object.keys(manifest.files).length,
              logs: cleanedLogs,
              failedCount,
              skippedTooLargeCount,
            });
            return curStatus.state === 'paused' ? 0 : remainingQueue.length;
          });
        } catch (err: unknown) {
          if (runEpoch !== mutationEpoch) {
            return;
          }
          const errMessage = err instanceof Error ? err.message : String(err);

          const catchResult = await withStateLock(async (): Promise<{
            action: 'exit' | 'continue' | 'throttle';
            remainingCount: number;
          }> => {
            if (runEpoch !== mutationEpoch) return { action: 'exit', remainingCount: 0 };

            if (err instanceof LocalFsPermissionError) {
              await setLocalFsStatus({
                state: 'needs_permission',
                lastError: err.message,
                currentFilePath: null,
              });
              return { action: 'exit', remainingCount: 0 };
            }

            if (err instanceof AuthRedirectError || errMessage.startsWith('Session expired')) {
              await setLocalFsStatus({
                state: 'needs_auth',
                lastError: errMessage,
                currentFilePath: null,
              });
              return { action: 'exit', remainingCount: 0 };
            }

            const [cur, curQueue] = await Promise.all([
              getLocalFsStatus(),
              getLocalFsQueue(),
            ]);
            const stillInQueue = curQueue.some((q) => q.moodleFileId === item.moodleFileId);
            if (!stillInQueue) {
              if (curQueue.length === 0 && (cur.state === 'syncing' || cur.state === 'paused')) {
                await clearResumeAlarm();
                await setLocalFsStatus({
                  state: 'idle',
                  isInitialBulkMode: false,
                  currentFilePath: null,
                  pausedUntil: null,
                  totalQueued: 0,
                  completedInCycle: 0,
                  pendingCount: 0,
                  lastSyncAt: Date.now(),
                });
                return { action: 'exit', remainingCount: 0 };
              }
              return {
                action: cur.state === 'paused' ? 'exit' : 'continue',
                remainingCount: curQueue.length,
              };
            }

            if (err instanceof OversizedFileError) {
              const capLabel = cfg.maxFileSizeMb > 0 ? `${cfg.maxFileSizeMb} MB` : 'limit';
              const logs = appendLog(cur.logs, {
                moodleFileId: item.moodleFileId,
                fileName: item.fileName,
                relativePath: item.relativePath,
                status: 'skipped_too_large',
                message: `Skipped (${Math.round(err.bytes / (1024 * 1024))} MB > ${capLabel} limit)`,
                timestamp: Date.now(),
              });
              const remaining = curQueue.filter((q) => q.moodleFileId !== item.moodleFileId);
              await setLocalFsQueue(remaining);
              const failedCount = logs.filter((l) => l.status === 'failed').length;
              const skippedTooLargeCount = logs.filter((l) => l.status === 'skipped_too_large').length;
              if (remaining.length === 0) {
                await clearResumeAlarm();
                await setLocalFsStatus({
                  state: 'idle',
                  isInitialBulkMode: false,
                  currentFilePath: null,
                  pausedUntil: null,
                  totalQueued: 0,
                  completedInCycle: 0,
                  pendingCount: 0,
                  logs,
                  failedCount,
                  skippedTooLargeCount,
                  lastSyncAt: Date.now(),
                });
                return { action: 'exit', remainingCount: 0 };
              }
              const completed = Math.max(0, cur.completedInCycle || 0);
              await setLocalFsStatus({
                logs,
                totalQueued: completed + remaining.length,
                pendingCount: remaining.length,
                failedCount,
                skippedTooLargeCount,
              });
              return {
                action: cur.state === 'paused' ? 'exit' : 'continue',
                remainingCount: remaining.length,
              };
            }

            if (err instanceof RateLimitError) {
              consecutiveRateLimits++;
              if (consecutiveRateLimits >= 3 && cur.state !== 'paused') {
                const pausedUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
                await ensureResumeAlarm();
                const completed = Math.max(0, cur.completedInCycle || 0);
                await setLocalFsStatus({
                  state: 'cooldown',
                  pausedUntil,
                  lastError: err.message,
                  currentFilePath: null,
                  totalQueued: completed + curQueue.length,
                  pendingCount: curQueue.length,
                });
                return { action: 'exit', remainingCount: curQueue.length };
              }
            }

            let remainingCount = curQueue.length;
            const nextAttempts = (item.attempts || 0) + 1;
            if (nextAttempts >= MAX_RETRIES_PER_FILE) {
              const logs = appendLog(cur.logs, {
                moodleFileId: item.moodleFileId,
                fileName: item.fileName,
                relativePath: item.relativePath,
                status: 'failed',
                message: errMessage,
                timestamp: Date.now(),
              });
              const remaining = curQueue.filter((q) => q.moodleFileId !== item.moodleFileId);
              await setLocalFsQueue(remaining);
              remainingCount = remaining.length;
              const failedCount = logs.filter((l) => l.status === 'failed').length;
              const skippedTooLargeCount = logs.filter((l) => l.status === 'skipped_too_large').length;
              if (remaining.length === 0) {
                await clearResumeAlarm();
                await setLocalFsStatus({
                  state: 'idle',
                  isInitialBulkMode: false,
                  currentFilePath: null,
                  pausedUntil: null,
                  totalQueued: 0,
                  completedInCycle: 0,
                  pendingCount: 0,
                  logs,
                  failedCount,
                  skippedTooLargeCount,
                  lastSyncAt: Date.now(),
                });
                return { action: 'exit', remainingCount: 0 };
              }
              const completed = Math.max(0, cur.completedInCycle || 0);
              await setLocalFsStatus({
                logs,
                totalQueued: completed + remaining.length,
                pendingCount: remaining.length,
                failedCount,
                skippedTooLargeCount,
              });
            } else {
              const backoffMs =
                err instanceof RateLimitError && err.retryAfterMs
                  ? err.retryAfterMs
                  : Math.min(120000, 5000 * Math.pow(3, nextAttempts - 1)) + randomInt(300, 1500);
              const updatedQ = curQueue.map((q) =>
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
            return {
              action: cur.state === 'paused' ? 'exit' : 'throttle',
              remainingCount,
            };
          });

          if (catchResult.action === 'exit') return;
          if (catchResult.action === 'continue') continue;
          remainingAfterCount = catchResult.remainingCount;
        }

        if (remainingAfterCount === 0) {
          break;
        }

        // MV3-safe adaptive throttling before next item (never blocking >7.5s, sliced into <=2.5s steps)
        if (remainingAfterCount > 0 && !abortRequested && runEpoch === mutationEpoch) {
          let delayMs: number;
          if (!isInitialBulkMode && remainingAfterCount <= 10) {
            delayMs = randomInt(400, 800);
          } else if (cfg.speedProfile === 'moderate') {
            const sizeCool = Math.min(2000, Math.floor(downloadedSize / (1024 * 1024)) * 250);
            delayMs = randomInt(600, 1100) + sizeCool;
          } else if (processedInRun > 0 && processedInRun % 20 === 0) {
            await ensureResumeAlarm();
            delayMs = randomInt(5000, 7500);
          } else {
            const sizeCool = Math.min(3500, Math.floor(downloadedSize / (512 * 1024)) * 300);
            delayMs = randomInt(1200, 2200) + sizeCool;
          }
          await abortableSleep(delayMs);
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
  controlEpoch++;
  activeSleepAbort?.abort();
  return await withStateLock(async () => {
    await clearResumeAlarm();
    return await setLocalFsStatus({ state: 'paused', currentFilePath: null });
  });
}

export async function resumeLocalFsSync(reauthenticate?: ReauthCallback): Promise<LocalFsStatus> {
  const myControl = ++controlEpoch;
  abortRequested = true;
  activeSleepAbort?.abort();
  while (activeQueuePromise) {
    await activeQueuePromise.catch(() => {});
  }
  const result = await withStateLock(async (): Promise<EnqueueResult> => {
    if (myControl !== controlEpoch) {
      return { status: await getLocalFsStatus(), shouldStartQueue: false };
    }
    return await _enqueueLocalFsSyncLocked({
      reauthenticate,
      clearCooldown: true,
      resumeFromPause: true,
    });
  });
  if (result.shouldStartQueue && myControl === controlEpoch) {
    void processLocalFsQueue(reauthenticate);
  }
  return result.status;
}

export async function resetLocalFsState(disableToggle = false): Promise<void> {
  abortRequested = true;
  mutationEpoch++;
  controlEpoch++;
  activeSleepAbort?.abort();
  while (activeQueuePromise) {
    await activeQueuePromise.catch(() => {});
  }
  await withStateLock(async () => {
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
  });
}

export async function teardownLocalFsOnLogout(): Promise<void> {
  abortRequested = true;
  mutationEpoch++;
  controlEpoch++;
  activeSleepAbort?.abort();
  while (activeQueuePromise) {
    await activeQueuePromise.catch(() => {});
  }
  await withStateLock(async () => {
    await clearResumeAlarm();
    await browser.storage.local.remove([
      'localFsConfig',
      'localFsManifest',
      'localFsQueue',
      'localFsStatus',
    ]);
    await clearDirectoryHandle();
  });
}

export interface ScannedLocalFileInput {
  relativePath: string;
  size: number;
  lastModified: number;
}

/**
 * Adopts files discovered by a user folder scan (`<input webkitdirectory>`) into `localFsManifest`
 * so pre-existing local folders (e.g. after reinstall or rclone sync onto another device)
 * are recognized immediately without re-downloading.
 */
export async function adoptScannedDiskFiles(
  scannedFiles: ScannedLocalFileInput[]
): Promise<{ adoptedCount: number; totalSynced: number }> {
  return await withStateLock(async () => {
    const cachedSync = await getCachedSyncResult();
    if (!cachedSync || scannedFiles.length === 0) {
      const curManifest = await getLocalFsManifest();
      return { adoptedCount: 0, totalSynced: Object.keys(curManifest.files).length };
    }

    const [config, trackedCourseIds, settings, localCoursesRes, manifest, existingQueue, prevStatus] =
      await Promise.all([
        getLocalFsConfig(),
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

    // Build exact and lowercased normalized (NFC) lookup from scanned webkitRelativePath variants
    const rootParts = normalizeFsPath(config.rootLabel || 'Noodle')
      .normalize('NFC')
      .replace(/^\/+|\/+$/g, '')
      .split('/')
      .filter(Boolean);
    const maxLeadShift = Math.max(4, rootParts.length + 2);

    const exactMap = new Map<string, ScannedLocalFileInput>();
    const lowerMap = new Map<string, ScannedLocalFileInput>();
    for (const entry of scannedFiles) {
      if (!entry || entry.size <= 0 || !entry.relativePath) continue;
      const norm = normalizeFsPath(entry.relativePath).normalize('NFC').replace(/^\/+/, '');
      if (!norm) continue;

      // Index full path + suffixes after stripping leading directory segments (handles selecting
      // either `Noodle/` directly, a nested subfolder like `Uni/Noodle/`, or its parent folder).
      const parts = norm.split('/').filter(Boolean);
      const maxShift = Math.min(maxLeadShift, Math.max(0, parts.length - 1));
      for (let shift = 0; shift <= maxShift; shift++) {
        const candidatePath = parts.slice(shift).join('/');
        const sanitizedCandidate = sanitizeRelativePath(candidatePath).normalize('NFC');
        if (sanitizedCandidate) {
          if (!exactMap.has(sanitizedCandidate)) {
            exactMap.set(sanitizedCandidate, entry);
          }
          const lowerKey = sanitizedCandidate.toLowerCase();
          if (!lowerMap.has(lowerKey)) {
            lowerMap.set(lowerKey, entry);
          }
        }
      }
    }

    const provider = createFileSystemProvider();
    let firefoxCompleted: browser.Downloads.DownloadItem[] = [];
    let firefoxSubfolder = 'Noodle';
    let firefoxSearchOk = false;
    const liveFirefoxById = new Map<number, browser.Downloads.DownloadItem>();
    if (provider instanceof FirefoxDownloadsProvider && typeof browser.downloads?.search === 'function') {
      try {
        [firefoxSubfolder, firefoxCompleted] = await Promise.all([
          provider.getRootSubfolder(),
          browser.downloads.search({ state: 'complete' }),
        ]);
        firefoxSearchOk = true;
        for (const dl of firefoxCompleted) {
          if (dl.state === 'complete' && dl.exists === true && typeof dl.id === 'number') {
            liveFirefoxById.set(dl.id, dl);
          }
        }
      } catch {
        firefoxCompleted = [];
        firefoxSearchOk = false;
      }
    }

    let adoptedCount = 0;
    const adoptedIds = new Set<string>();
    for (const planned of plan.files) {
      const cleanRel = sanitizeRelativePath(planned.relativePath).normalize('NFC');
      const scannedMatch = exactMap.get(cleanRel) || lowerMap.get(cleanRel.toLowerCase());
      if (!scannedMatch) continue;

      const existingRec = manifest.files[planned.moodleFileId];
      let matchedDownloadId: number | undefined = existingRec?.downloadId;
      if (provider instanceof FirefoxDownloadsProvider && firefoxSearchOk) {
        // Clear dead/deleted/purged Firefox download IDs since the file is confirmed present on disk;
        // keeping a stale exists===false ID would cause autoResyncMissingFiles to re-download it.
        if (typeof matchedDownloadId !== 'number' || !liveFirefoxById.has(matchedDownloadId)) {
          const dlMatch = findBestMatchingDownload(firefoxCompleted, firefoxSubfolder, cleanRel);
          matchedDownloadId = dlMatch && typeof dlMatch.id === 'number' ? dlMatch.id : undefined;
        }
      }

      const origin: LocalFsManifestRecord['origin'] =
        matchedDownloadId !== undefined
          ? 'download'
          : provider.backendType === 'fsa'
            ? 'fsa'
            : 'scan';

      const nextRecord: LocalFsManifestRecord = {
        moodleFileId: planned.moodleFileId,
        relativePath: cleanRel,
        lastModified:
          planned.timeModified > 0
            ? planned.timeModified
            : Math.floor((scannedMatch.lastModified || Date.now()) / 1000),
        size: planned.fileSize > 0 ? planned.fileSize : scannedMatch.size,
        canonicalUrlPath: planned.canonicalUrlPath,
        syncedAt: Date.now(),
        origin,
        ...(matchedDownloadId !== undefined ? { downloadId: matchedDownloadId } : {}),
      };

      if (!existingRec) {
        adoptedCount++;
      }
      manifest.files[planned.moodleFileId] = nextRecord;
      adoptedIds.add(planned.moodleFileId);
    }

    await setLocalFsManifest(manifest);

    const prunedQueue = existingQueue.filter((q) => !adoptedIds.has(q.moodleFileId));
    if (prunedQueue.length !== existingQueue.length) {
      await setLocalFsQueue(prunedQueue);
    }

    const cleanedLogs = prevStatus.logs.filter((l) => !adoptedIds.has(l.moodleFileId));
    const failedCount = cleanedLogs.filter((l) => l.status === 'failed').length;
    const skippedTooLargeCount = cleanedLogs.filter((l) => l.status === 'skipped_too_large').length;
    const completed = Math.max(0, prevStatus.completedInCycle || 0);
    const totalSynced = Object.keys(manifest.files).length;

    if (prunedQueue.length === 0) {
      if (prevStatus.state !== 'needs_permission') {
        await clearResumeAlarm();
      }
      await setLocalFsStatus({
        ...(prevStatus.state !== 'needs_permission'
          ? {
              state: 'idle' as const,
              isInitialBulkMode: false,
              currentFilePath: null,
              pausedUntil: null,
              lastError: null,
            }
          : {}),
        syncedCountTotal: totalSynced,
        plannedTotal: plan.files.length,
        pendingCount: 0,
        totalQueued: 0,
        completedInCycle: 0,
        logs: cleanedLogs,
        failedCount,
        skippedTooLargeCount,
        ...(adoptedIds.size > 0 ||
        prevStatus.state === 'syncing' ||
        prevStatus.state === 'paused' ||
        prevStatus.state === 'cooldown'
          ? { lastSyncAt: Date.now() }
          : {}),
      });
    } else {
      await setLocalFsStatus({
        syncedCountTotal: totalSynced,
        plannedTotal: plan.files.length,
        pendingCount: prunedQueue.length,
        totalQueued: completed + prunedQueue.length,
        completedInCycle: completed,
        logs: cleanedLogs,
        failedCount,
        skippedTooLargeCount,
      });
    }

    return {
      adoptedCount,
      totalSynced,
    };
  });
}

export async function reconcileLocalFsManifest(): Promise<ReconcileManifestReport> {
  return await withStateLock(async () => {
    const provider = createFileSystemProvider();
    if (provider instanceof FirefoxDownloadsProvider) {
      return await provider.reconcileManifestDetailed();
    }
    return { repaired: 0, cleared: 0, confirmedMissingIds: [] };
  });
}

export async function recoverStaleLocalFsStateOnBoot(reauthenticate?: ReauthCallback): Promise<void> {
  try {
    const shouldStart = await withStateLock(async () => {
      const cfg = await getLocalFsConfig();
      if (!cfg.enabled) return false;

      const [status, queue] = await Promise.all([
        getLocalFsStatus(),
        getLocalFsQueue(),
      ]);
      if (status.state === 'syncing' && queue.length === 0) {
        await clearResumeAlarm();
        await setLocalFsStatus({
          state: 'idle',
          currentFilePath: null,
          totalQueued: 0,
          completedInCycle: 0,
          pendingCount: 0,
        });
        return false;
      }

      if (queue.length > 0 && status.state !== 'paused') {
        await ensureResumeAlarm();
        return true;
      }
      return false;
    });

    if (shouldStart) {
      void processLocalFsQueue(reauthenticate);
    }
  } catch (e) {
    console.warn('[LocalFS] Failed boot state recovery:', e);
  }
}
