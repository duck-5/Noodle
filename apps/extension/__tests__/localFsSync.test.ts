import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import type { SyncResult } from '@tautracker/moodle-client';
import {
  LOCAL_FS_RESUME_ALARM,
  adoptScannedDiskFiles,
  enqueueLocalFsSync,
  pauseLocalFsSync,
  processLocalFsQueue,
  resetLocalFsState,
  resumeLocalFsSync,
} from '../src/background/localFsSync.js';
import {
  getLocalFsManifest,
  getLocalFsQueue,
  getLocalFsStatus,
  setCachedSyncResult,
  setLocalFsConfig,
  setLocalFsManifest,
  setLocalFsQueue,
  setLocalFsStatus,
  setStoredToken,
  setTrackedCourseIds,
  DEFAULT_LOCAL_FS_STATUS,
} from '../src/shared/storage.js';
import { setMockDirectoryHandle } from './__mocks__/fsaHandleStore.js';
import {
  emitMockDownloadChanged,
  getMockAlarms,
  mockState,
  resetAllExtensionMocks,
  seedMockDownloads,
  setMockDownloadHandler,
  setMockExtensionRuntime,
  upsertMockDownloadItem,
} from './__mocks__/webextensionPolyfill.js';

function makeSyncResult(files: Array<{
  id: number;
  courseId: number;
  fileName: string;
  fileSize?: number;
  timeModified?: number;
}>, errors: Array<{ context: string; message: string }> = []): SyncResult {
  const courseIds = Array.from(new Set(files.map((f) => f.courseId)));
  return {
    syncedAt: '2026-11-10T10:00:00Z',
    errors,
    meetings: [],
    sections: [],
    folders: [],
    assignments: [],
    courses: courseIds.map((id) => ({
      id,
      courseId: `0368${id}`,
      fullname: `Course ${id}`,
      shortname: `C-${id}`,
      semester: 'SemesterA',
      year: '2026',
    })),
    files: files.map((f) => ({
      id: f.id,
      courseId: f.courseId,
      courseName: `Course ${f.courseId}`,
      sectionId: 0,
      sectionName: 'General',
      fileName: f.fileName,
      fileUrl: `https://moodle.tau.ac.il/webservice/pluginfile.php/${f.id}/mod_resource/content/1/${f.fileName}`,
      fileSize: f.fileSize ?? 1024,
      mimeType: 'application/pdf',
      timeModified: f.timeModified ?? 1000,
    })),
  };
}

function createInMemoryFsaRoot(options: {
  throwOnDirNameError?: string;
} = {}) {
  const writtenFiles = new Map<string, Uint8Array>();
  let abortedWrites = 0;

  const makeDir = (prefix: string): FileSystemDirectoryHandle =>
    ({
      name: 'Noodle',
      queryPermission: async () => 'granted',
      getDirectoryHandle: async (segment: string) => {
        if (options.throwOnDirNameError) {
          const err = new Error('Permission denied');
          err.name = options.throwOnDirNameError;
          throw err;
        }
        return makeDir(prefix ? `${prefix}/${segment}` : segment);
      },
      getFileHandle: async (fileName: string, opts?: { create?: boolean }) => {
        const rel = prefix ? `${prefix}/${fileName}` : fileName;
        if (opts?.create === false && !writtenFiles.has(rel)) {
          const err = new Error('Not found');
          err.name = 'NotFoundError';
          throw err;
        }
        return {
          getFile: async () => {
            const bytes = writtenFiles.get(rel) || new Uint8Array();
            return new File([bytes.slice()], fileName);
          },
          createWritable: async () => {
            const chunks: Uint8Array[] = [];
            return new WritableStream<Uint8Array>({
              write(chunk) {
                chunks.push(chunk);
              },
              close() {
                const total = chunks.reduce((s, c) => s + c.byteLength, 0);
                const merged = new Uint8Array(total);
                let offset = 0;
                for (const c of chunks) {
                  merged.set(c, offset);
                  offset += c.byteLength;
                }
                writtenFiles.set(rel, merged);
              },
              abort() {
                abortedWrites++;
              },
            }) as unknown as FileSystemWritableFileStream;
          },
        } as unknown as FileSystemFileHandle;
      },
    }) as unknown as FileSystemDirectoryHandle;

  return {
    rootHandle: makeDir(''),
    writtenFiles,
    getAbortedWrites: () => abortedWrites,
  };
}

async function waitForCondition(
  predicate: () => Promise<boolean> | boolean,
  timeoutMs = 5000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('Timed out waiting for condition');
}

describe('localFsSync orchestrator', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    jest.useRealTimers();
    resetAllExtensionMocks('chrome');
    setMockDirectoryHandle(null);
    globalThis.fetch = originalFetch;
    await resetLocalFsState(true);
  });

  afterEach(async () => {
    jest.useRealTimers();
    globalThis.fetch = originalFetch;
    await resetLocalFsState(true);
  });

  it('Weakness 1: Scan + autoResyncMissingFiles on Firefox does NOT re-download scanned/rclone files, only confirmed exists:false deletions', async () => {
    setMockExtensionRuntime('firefox');
    await setStoredToken('tok_fx');
    await setTrackedCourseIds([101], true);
    await setLocalFsConfig({
      enabled: true,
      rootLabel: 'Noodle',
      autoResyncMissingFiles: true,
    });

    const sync = makeSyncResult([
      { id: 1, courseId: 101, fileName: 'recitation1.pdf' },
      { id: 2, courseId: 101, fileName: 'recitation2.pptx' },
      { id: 3, courseId: 101, fileName: 'hw1.pdf' },
    ]);
    await setCachedSyncResult(sync);

    const adoptRes = await adoptScannedDiskFiles([
      { relativePath: 'Noodle/Course 101/General/recitation1.pdf', size: 1024, lastModified: 1000 },
      { relativePath: 'Noodle/Course 101/General/recitation2.pptx', size: 2048, lastModified: 1000 },
      { relativePath: 'Noodle/Course 101/General/hw1.pdf', size: 512, lastModified: 1000 },
    ]);

    expect(adoptRes.adoptedCount).toBe(3);
    expect(adoptRes.totalSynced).toBe(3);

    const manifestAfterScan = await getLocalFsManifest();
    expect(manifestAfterScan.files['res:101:1:recitation1.pdf'].origin).toBe('scan');
    expect(manifestAfterScan.files['res:101:1:recitation1.pdf'].downloadId).toBeUndefined();

    // Re-sync with autoResyncMissingFiles = true and empty Firefox downloads history:
    // none of the 3 rclone/scanned files should be falsely flagged as missing!
    const statusAfterEnqueue = await enqueueLocalFsSync();
    await waitForCondition(async () => (await getLocalFsStatus()).state === 'idle');

    expect(mockState.downloadCalls).toHaveLength(0);
    expect(statusAfterEnqueue.totalQueued).toBe(0);
    expect(statusAfterEnqueue.syncedCountTotal).toBe(3);

    // Now mark ONLY hw1.pdf as a confirmed deletion in Firefox download history (exists: false)
    manifestAfterScan.files['res:101:3:hw1.pdf'] = {
      ...manifestAfterScan.files['res:101:3:hw1.pdf'],
      downloadId: 77,
      origin: 'download',
    };
    await setLocalFsManifest(manifestAfterScan);
    seedMockDownloads([
      {
        id: 77,
        state: 'complete',
        exists: false,
        filename: '/home/u/Downloads/Noodle/Course 101/General/hw1.pdf',
      },
    ]);

    await enqueueLocalFsSync();
    await waitForCondition(
      async () => mockState.downloadCalls.length === 1 && (await getLocalFsStatus()).state === 'idle'
    );

    expect(mockState.downloadCalls).toHaveLength(1);
    expect(mockState.downloadCalls[0].filename).toContain('hw1.pdf');
  });

  it('Weakness 5: Firefox performs a single browser.downloads.download request (zero GET preflight) and reauthenticates on SAML/HTML', async () => {
    setMockExtensionRuntime('firefox');
    await setStoredToken('old_tok');
    await setTrackedCourseIds([101], true);
    await setLocalFsConfig({ enabled: true, rootLabel: 'Noodle' });
    await setCachedSyncResult(
      makeSyncResult([{ id: 10, courseId: 101, fileName: 'lecture.pdf' }])
    );

    const fetchSpy = jest.fn(async () => new Response('unexpected')) as unknown as typeof fetch;
    globalThis.fetch = fetchSpy;

    let attempt = 0;
    const reauthSpy = jest.fn(async () => {
      await setStoredToken('fresh_tok');
      return 'fresh_tok';
    });

    setMockDownloadHandler(async (opts) => {
      attempt++;
      const id = 300 + attempt;
      if (attempt === 1) {
        expect(opts.url).toContain('token=old_tok');
        upsertMockDownloadItem({
          id,
          url: 'https://nidp.tau.ac.il/saml2/sso',
          filename: `/home/u/Downloads/${opts.filename}`,
          mime: 'text/html',
          state: 'complete',
          exists: true,
          fileSize: 3200,
        });
      } else {
        expect(opts.url).toContain('token=fresh_tok');
        upsertMockDownloadItem({
          id,
          url: opts.url,
          filename: `/home/u/Downloads/${opts.filename}`,
          mime: 'application/pdf',
          state: 'complete',
          exists: true,
          fileSize: 4096,
        });
      }
      emitMockDownloadChanged({ id, state: { current: 'complete' } });
      return id;
    });

    await enqueueLocalFsSync({ reauthenticate: reauthSpy });
    await waitForCondition(async () => (await getLocalFsStatus()).state === 'idle');

    // No extra fetch preflight call on Firefox!
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(reauthSpy).toHaveBeenCalledTimes(1);
    expect(mockState.downloadCalls).toHaveLength(2);

    const manifest = await getLocalFsManifest();
    expect(manifest.files['res:101:10:lecture.pdf'].downloadId).toBe(302);
    expect(manifest.files['res:101:10:lecture.pdf'].origin).toBe('download');
  });

  it('Weakness 3: Rapid Pause -> Resume during active sleep aborts sleep immediately, re-arms LOCAL_FS_RESUME_ALARM, and completes queue', async () => {
    setMockExtensionRuntime('firefox');
    await setStoredToken('tok_pr');
    await setTrackedCourseIds([101], true);
    await setLocalFsConfig({
      enabled: true,
      rootLabel: 'Noodle',
      speedProfile: 'safe',
    });

    await setCachedSyncResult(
      makeSyncResult([
        { id: 1, courseId: 101, fileName: 'f1.pdf' },
        { id: 2, courseId: 101, fileName: 'f2.pdf' },
        { id: 3, courseId: 101, fileName: 'f3.pdf' },
      ])
    );

    await enqueueLocalFsSync();

    // Wait until file #1 has finished and the worker is inside abortableSleep before file #2
    await waitForCondition(() => mockState.downloadCalls.length === 1);

    const pausedStatus = await pauseLocalFsSync();
    expect(pausedStatus.state).toBe('paused');
    expect(getMockAlarms().has(LOCAL_FS_RESUME_ALARM)).toBe(false);

    // Immediately call resumeLocalFsSync WITHOUT waiting out the ~1-2s sleep
    await resumeLocalFsSync();
    expect(getMockAlarms().has(LOCAL_FS_RESUME_ALARM)).toBe(true);

    await waitForCondition(async () => (await getLocalFsStatus()).state === 'idle');

    const finalStatus = await getLocalFsStatus();
    expect(finalStatus.syncedCountTotal).toBe(3);
    expect(finalStatus.totalQueued).toBe(0);
    expect(finalStatus.completedInCycle).toBe(0);
    expect(finalStatus.pendingCount).toBe(0);
    expect(getMockAlarms().has(LOCAL_FS_RESUME_ALARM)).toBe(false);
  });

  it('Weakness 3/4: HTTP 429 cooldown defers automatic wake until pausedUntil, recovers after expiry, and explicit resumeLocalFsSync overrides 15m WAF cooldown', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
    setMockExtensionRuntime('chrome');
    const fsa = createInMemoryFsaRoot();
    setMockDirectoryHandle(fsa.rootHandle);
    await setStoredToken('tok_cr');
    await setTrackedCourseIds([101], true);
    await setLocalFsConfig({ enabled: true, rootLabel: 'Noodle' });

    // Scenario A: 3 consecutive 429 responses across queued files trigger 15-min WAF cooldown
    await setCachedSyncResult(
      makeSyncResult([
        { id: 1, courseId: 101, fileName: 's1.pdf' },
        { id: 2, courseId: 101, fileName: 's2.pdf' },
        { id: 3, courseId: 101, fileName: 's3.pdf' },
      ])
    );

    let failRateLimit = true;
    globalThis.fetch = jest.fn(async () => {
      if (failRateLimit) {
        return new Response('Too many requests', {
          status: 429,
          headers: { 'retry-after': '120' },
        });
      }
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { 'content-type': 'application/pdf', 'content-length': '4' },
      });
    }) as unknown as typeof fetch;

    await enqueueLocalFsSync();
    for (let step = 0; step < 12; step++) {
      await jest.advanceTimersByTimeAsync(1_000);
      const st = await getLocalFsStatus();
      if (st.state === 'cooldown') break;
    }

    const cooldownStatus = await getLocalFsStatus();
    expect(cooldownStatus.state).toBe('cooldown');
    expect(cooldownStatus.pausedUntil).toBeGreaterThan(Date.now());
    expect(getMockAlarms().has(LOCAL_FS_RESUME_ALARM)).toBe(true);

    // Simulated early alarm tick before pausedUntil expires stays in cooldown
    failRateLimit = false;
    await processLocalFsQueue();
    expect((await getLocalFsStatus()).state).toBe('cooldown');
    expect(fsa.writtenFiles.size).toBe(0);

    // Explicit user resume clears cooldown + nextRetryAt and finishes all 3 files
    await resumeLocalFsSync();
    for (let step = 0; step < 20; step++) {
      await jest.advanceTimersByTimeAsync(1_000);
      if ((await getLocalFsStatus()).state === 'idle') break;
    }

    const done = await getLocalFsStatus();
    expect(done.state).toBe('idle');
    expect(done.syncedCountTotal).toBe(3);
    expect(fsa.writtenFiles.has('Course 101/General/s1.pdf')).toBe(true);
    expect(fsa.writtenFiles.has('Course 101/General/s3.pdf')).toBe(true);

    // Scenario B: automatic wake recovery when cooldown pausedUntil expires naturally
    failRateLimit = true;
    await setCachedSyncResult(
      makeSyncResult([{ id: 4, courseId: 101, fileName: 'auto_recover.pdf' }])
    );
    await enqueueLocalFsSync();
    for (let step = 0; step < 6; step++) {
      await jest.advanceTimersByTimeAsync(500);
      if ((await getLocalFsStatus()).state === 'cooldown') break;
    }
    const cd2 = await getLocalFsStatus();
    expect(cd2.state).toBe('cooldown');
    expect(cd2.pausedUntil).toBeGreaterThan(Date.now());

    // Advance clock past Retry-After cooldown (120s), then fire alarm tick (processLocalFsQueue)
    failRateLimit = false;
    await jest.advanceTimersByTimeAsync(125_000);
    await processLocalFsQueue();
    await jest.advanceTimersByTimeAsync(500);

    const recovered = await getLocalFsStatus();
    expect(recovered.state).toBe('idle');
    expect(fsa.writtenFiles.has('Course 101/General/auto_recover.pdf')).toBe(true);
  });

  it('Weakness 2, 4, 9b: Lock + Epoch Guard drops stale post-reset commits, evicts untracked/oversized queue items, prunes orphans & clears resolved logs', async () => {
    setMockExtensionRuntime('firefox');
    await setStoredToken('tok_lock');
    await setTrackedCourseIds([101, 202], true);
    await setLocalFsConfig({ enabled: true, rootLabel: 'Noodle', maxFileSizeMb: 100 });

    // Part A: Epoch Guard against reset mid-download
    let resolveBlockedDownload!: (id: number) => void;
    setMockDownloadHandler(
      () =>
        new Promise<number>((resolve) => {
          resolveBlockedDownload = resolve;
        })
    );
    await setCachedSyncResult(makeSyncResult([{ id: 1, courseId: 101, fileName: 'slow.pdf' }]));

    await enqueueLocalFsSync();
    await waitForCondition(() => mockState.downloadCalls.length === 1);

    const resetPromise = resetLocalFsState(false);
    // Complete slow download #1 AFTER resetLocalFsState incremented mutationEpoch
    upsertMockDownloadItem({
      id: 999,
      url: 'https://moodle.tau.ac.il/slow.pdf',
      filename: '/home/u/Downloads/Noodle/Course 101/General/slow.pdf',
      mime: 'application/pdf',
      state: 'complete',
      exists: true,
      fileSize: 1024,
    });
    resolveBlockedDownload(999);
    await resetPromise;

    expect((await getLocalFsManifest()).files).toEqual({});
    expect(await getLocalFsQueue()).toEqual([]);

    // Part B: Queue eviction, orphan pruning, and skipped/failed log recomputation
    setMockDownloadHandler(null);
    const fullSync = makeSyncResult([
      { id: 1, courseId: 101, fileName: 'keep.pdf', fileSize: 1024 },
      { id: 2, courseId: 101, fileName: 'medium_big.bin', fileSize: 120 * 1024 * 1024 },
      { id: 3, courseId: 202, fileName: 'drop_course.pdf', fileSize: 1024 },
    ]);
    await setCachedSyncResult(fullSync);

    await setLocalFsManifest({
      courseFolderNames: { 101: 'Course 101', 202: 'Course 202' },
      files: {
        'res:101:1:keep.pdf': {
          moodleFileId: 'res:101:1:keep.pdf',
          relativePath: 'Course 101/General/keep.pdf',
          lastModified: 1000,
          size: 1024,
          canonicalUrlPath:
            'https://moodle.tau.ac.il/webservice/pluginfile.php/1/mod_resource/content/1/keep.pdf',
          origin: 'scan',
        },
        'res:202:3:drop_course.pdf': {
          moodleFileId: 'res:202:3:drop_course.pdf',
          relativePath: 'Course 202/General/drop_course.pdf',
          lastModified: 1000,
          size: 1024,
          canonicalUrlPath:
            'https://moodle.tau.ac.il/webservice/pluginfile.php/3/mod_resource/content/1/drop_course.pdf',
          origin: 'download',
          downloadId: 50,
        },
      },
    });

    await setLocalFsStatus({
      ...DEFAULT_LOCAL_FS_STATUS,
      backendType: 'downloads',
      state: 'paused',
      totalQueued: 2,
      completedInCycle: 1,
      pendingCount: 1,
      logs: [
        {
          moodleFileId: 'res:101:1:keep.pdf',
          fileName: 'keep.pdf',
          relativePath: 'Course 101/General/keep.pdf',
          status: 'failed',
          message: 'Resolved by scan',
          timestamp: 10,
        },
        {
          moodleFileId: 'res:202:3:drop_course.pdf',
          fileName: 'drop_course.pdf',
          relativePath: 'Course 202/General/drop_course.pdf',
          status: 'failed',
          message: 'Will be pruned with untracked course',
          timestamp: 10,
        },
      ],
    });
    await setLocalFsQueue([
      {
        moodleFileId: 'res:202:99:obsolete.pdf',
        courseId: 202,
        sourceCourseId: 202,
        relativePath: 'Course 202/General/obsolete.pdf',
        fileName: 'obsolete.pdf',
        fileUrl: 'https://example.com/obsolete.pdf',
        canonicalUrlPath: 'https://example.com/obsolete.pdf',
        fileSize: 100,
        timeModified: 10,
        reason: 'new',
        attempts: 1,
      },
    ]);

    // First re-plan with maxFileSizeMb=100 & tracked=[101] while paused:
    // - Orphan manifest entry from course 202 is pruned
    // - Stale queue item from course 202 is evicted
    // - Resolved failed log for keep.pdf and untracked drop_course.pdf are cleared
    // - medium_big.bin gets logged in skipped_too_large (1)
    await setTrackedCourseIds([101], true);
    const st1 = await enqueueLocalFsSync();
    expect(st1.syncedCountTotal).toBe(1);
    expect(st1.failedCount).toBe(0);
    expect(st1.skippedTooLargeCount).toBe(1);
    expect(st1.plannedTotal).toBe(2);
    expect(await getLocalFsQueue()).toEqual([]);
    expect((await getLocalFsManifest()).courseFolderNames[202]).toBeUndefined();

    // Now increase maxFileSizeMb to 250 MB while paused:
    // - Obsolete skipped_too_large log clears immediately!
    // - medium_big.bin enters pending queue (`pendingCount === 1`) and counter invariant holds!
    await setLocalFsConfig({ maxFileSizeMb: 250 });
    await setLocalFsStatus({ state: 'paused' });
    const st2 = await enqueueLocalFsSync();
    expect(st2.skippedTooLargeCount).toBe(0);
    expect(st2.logs).toEqual([]);
    expect(st2.pendingCount).toBe(1);
    expect(st2.totalQueued).toBe(st2.completedInCycle + (st2.pendingCount ?? 0));
  });

  it('Weakness 8: Chromium streams via TransformStream enforcing maxBytes mid-stream without Buffering Blob, and NotAllowedError triggers needs_permission', async () => {
    setMockExtensionRuntime('chrome');
    const fsa = createInMemoryFsaRoot();
    setMockDirectoryHandle(fsa.rootHandle);
    await setStoredToken('tok_stream');
    await setTrackedCourseIds([101], true);
    await setLocalFsConfig({ enabled: true, rootLabel: 'Noodle', maxFileSizeMb: 1 }); // 1 MiB cap

    await setCachedSyncResult(
      makeSyncResult([{ id: 1, courseId: 101, fileName: 'streamed.bin', fileSize: 0 }])
    );

    let signalAborted = false;
    globalThis.fetch = jest.fn(async (_url: string, init?: RequestInit) => {
      init?.signal?.addEventListener('abort', () => {
        signalAborted = true;
      });
      // Omit Content-Length header to force mid-stream TransformStream size enforcement
      const oversizedStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(700 * 1024));
          controller.enqueue(new Uint8Array(700 * 1024)); // pushes total > 1 MiB
          controller.close();
        },
      });
      return new Response(oversizedStream, {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
      });
    }) as unknown as typeof fetch;

    await enqueueLocalFsSync();
    await waitForCondition(async () => (await getLocalFsStatus()).state === 'idle');

    const st = await getLocalFsStatus();
    expect(signalAborted).toBe(true);
    expect(fsa.getAbortedWrites()).toBeGreaterThanOrEqual(1);
    expect(fsa.writtenFiles.size).toBe(0);
    expect(st.skippedTooLargeCount).toBe(1);
    expect(st.syncedCountTotal).toBe(0);

    // Part 2: Revoked FSA permission (NotAllowedError) sets state = 'needs_permission'
    const revokedFsa = createInMemoryFsaRoot({ throwOnDirNameError: 'NotAllowedError' });
    setMockDirectoryHandle(revokedFsa.rootHandle);
    globalThis.fetch = jest.fn(async () => {
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'application/pdf', 'content-length': '3' },
      });
    }) as unknown as typeof fetch;
    await setLocalFsConfig({ maxFileSizeMb: 100 });
    await setCachedSyncResult(
      makeSyncResult([{ id: 2, courseId: 101, fileName: 'perm.pdf', fileSize: 3 }])
    );

    await enqueueLocalFsSync();
    await waitForCondition(async () => (await getLocalFsStatus()).state === 'needs_permission');
    expect((await getLocalFsStatus()).state).toBe('needs_permission');
  });

  it('Bug A: Pause -> Resume mid-cycle preserves completedInCycle, totalQueued, and isInitialBulkMode; Resume -> Pause controlEpoch stops stale resume', async () => {
    setMockExtensionRuntime('firefox');
    await setStoredToken('tok_pause_preserve');
    await setTrackedCourseIds([101], true);
    await setLocalFsConfig({
      enabled: true,
      rootLabel: 'Noodle',
      speedProfile: 'moderate',
    });

    // 11 files -> triggers isInitialBulkMode = true
    const files = Array.from({ length: 11 }, (_, idx) => ({
      id: idx + 1,
      courseId: 101,
      fileName: `f${idx + 1}.pdf`,
    }));
    await setCachedSyncResult(makeSyncResult(files));

    await enqueueLocalFsSync();
    // Wait until 2 files have completed and worker is paused/sleeping before #3
    await waitForCondition(async () => (await getLocalFsStatus()).completedInCycle >= 2, 10000);

    const paused = await pauseLocalFsSync();
    expect(paused.state).toBe('paused');
    expect(paused.completedInCycle).toBeGreaterThanOrEqual(2);
    expect(paused.totalQueued).toBe(11);
    expect(paused.pendingCount).toBe(11 - paused.completedInCycle);
    expect(paused.isInitialBulkMode).toBe(true);

    const resumed = await resumeLocalFsSync();
    expect(resumed.state).toBe('syncing');
    expect(resumed.completedInCycle).toBe(paused.completedInCycle);
    expect(resumed.totalQueued).toBe(11);
    expect(resumed.pendingCount).toBe(11 - paused.completedInCycle);
    expect(resumed.isInitialBulkMode).toBe(true);

    await waitForCondition(async () => (await getLocalFsStatus()).state === 'idle', 25000);
    const done = await getLocalFsStatus();
    expect(done.syncedCountTotal).toBe(11);
    expect(done.totalQueued).toBe(0);
    expect(done.completedInCycle).toBe(0);

    // Part 2: Resume -> Pause race while slow download is draining activeQueuePromise
    await resetLocalFsState(false);
    await setLocalFsConfig({ enabled: true, rootLabel: 'Noodle' });
    await setCachedSyncResult(
      makeSyncResult([
        { id: 21, courseId: 101, fileName: 'slow_first.pdf' },
        { id: 22, courseId: 101, fileName: 'second.pdf' },
      ])
    );

    let resolveSlow!: (id: number) => void;
    let dlSeq = 0;
    setMockDownloadHandler(async () => {
      dlSeq++;
      if (dlSeq === 1) {
        return await new Promise<number>((resolve) => {
          resolveSlow = resolve;
        });
      }
      const id = 700 + dlSeq;
      upsertMockDownloadItem({
        id,
        url: 'https://moodle.tau.ac.il/second.pdf',
        filename: '/home/u/Downloads/Noodle/Course 101/General/second.pdf',
        mime: 'application/pdf',
        state: 'complete',
        exists: true,
        fileSize: 1024,
      });
      emitMockDownloadChanged({ id, state: { current: 'complete' } });
      return id;
    });

    await enqueueLocalFsSync();
    await waitForCondition(() => dlSeq === 1);

    // Start resume (blocks waiting for activeQueuePromise), then immediately call pause
    const pendingResume = resumeLocalFsSync();
    await pauseLocalFsSync();

    upsertMockDownloadItem({
      id: 701,
      url: 'https://moodle.tau.ac.il/slow_first.pdf',
      filename: '/home/u/Downloads/Noodle/Course 101/General/slow_first.pdf',
      mime: 'application/pdf',
      state: 'complete',
      exists: true,
      fileSize: 1024,
    });
    resolveSlow(701);
    await pendingResume;

    const afterRace = await getLocalFsStatus();
    expect(afterRace.state).toBe('paused');
    expect(dlSeq).toBe(1);
    expect(afterRace.pendingCount).toBe(1);
  }, 30000);

  it('Bug B1 & B2: Pausing during last slow download transitions cleanly to idle on finish, and 3rd 429 while paused does NOT flip to cooldown', async () => {
    setMockExtensionRuntime('firefox');
    await setStoredToken('tok_pause_in_flight');
    await setTrackedCourseIds([101], true);
    await setLocalFsConfig({ enabled: true, rootLabel: 'Noodle' });

    // B1: 1-item slow download paused in-flight settles to idle once complete
    await setCachedSyncResult(makeSyncResult([{ id: 1, courseId: 101, fileName: 'last.pdf' }]));
    let resolveLast!: (id: number) => void;
    setMockDownloadHandler(
      () =>
        new Promise<number>((resolve) => {
          resolveLast = resolve;
        })
    );

    await enqueueLocalFsSync();
    await waitForCondition(() => mockState.downloadCalls.length === 1);
    await pauseLocalFsSync();

    upsertMockDownloadItem({
      id: 801,
      url: 'https://moodle.tau.ac.il/last.pdf',
      filename: '/home/u/Downloads/Noodle/Course 101/General/last.pdf',
      mime: 'application/pdf',
      state: 'complete',
      exists: true,
      fileSize: 512,
    });
    resolveLast(801);
    await waitForCondition(async () => (await getLocalFsStatus()).state === 'idle');
    const stB1 = await getLocalFsStatus();
    expect(stB1.syncedCountTotal).toBe(1);
    expect(stB1.pendingCount).toBe(0);
    expect(stB1.totalQueued).toBe(0);
    expect(getMockAlarms().has(LOCAL_FS_RESUME_ALARM)).toBe(false);

    // B2: 3rd consecutive RateLimitError while paused stays paused and does NOT arm cooldown alarm
    await resetLocalFsState(false);
    setMockExtensionRuntime('chrome');
    const fsa = createInMemoryFsaRoot();
    setMockDirectoryHandle(fsa.rootHandle);
    await setLocalFsConfig({ enabled: true, rootLabel: 'Noodle' });
    await setCachedSyncResult(
      makeSyncResult([
        { id: 1, courseId: 101, fileName: 'r1.pdf' },
        { id: 2, courseId: 101, fileName: 'r2.pdf' },
        { id: 3, courseId: 101, fileName: 'r3.pdf' },
      ])
    );

    let fetchCount = 0;
    let releaseThird!: () => void;
    globalThis.fetch = jest.fn(async () => {
      fetchCount++;
      if (fetchCount < 3) {
        return new Response('Too many', { status: 429, headers: { 'retry-after': '1' } });
      }
      await new Promise<void>((resolve) => {
        releaseThird = resolve;
      });
      return new Response('Too many', { status: 429, headers: { 'retry-after': '1' } });
    }) as unknown as typeof fetch;

    await enqueueLocalFsSync();
    await waitForCondition(() => fetchCount === 3, 15000);
    await pauseLocalFsSync();
    releaseThird();

    // Let in-flight catch complete cleanly
    await new Promise((r) => setTimeout(r, 80));
    const stB2 = await getLocalFsStatus();
    expect(stB2.state).toBe('paused');
    expect(getMockAlarms().has(LOCAL_FS_RESUME_ALARM)).toBe(false);
  }, 20000);

  it('Bug B3: Mid-flight queue eviction drops late writeFile commit so excluded course file never re-enters manifest', async () => {
    setMockExtensionRuntime('firefox');
    await setStoredToken('tok_evict');
    await setTrackedCourseIds([101, 202], true);
    await setLocalFsConfig({ enabled: true, rootLabel: 'Noodle' });
    await setCachedSyncResult(
      makeSyncResult([{ id: 1, courseId: 202, fileName: 'drop_me.pdf' }])
    );

    let resolveSlow!: (id: number) => void;
    setMockDownloadHandler(
      () =>
        new Promise<number>((resolve) => {
          resolveSlow = resolve;
        })
    );

    await enqueueLocalFsSync();
    await waitForCondition(() => mockState.downloadCalls.length === 1);

    // Untrack course 202 while download #1 is in flight -> evicts item from queue
    await setTrackedCourseIds([101], true);
    const stAfterEvict = await enqueueLocalFsSync();
    expect(stAfterEvict.pendingCount).toBe(0);
    expect(await getLocalFsQueue()).toEqual([]);

    // Complete stale download afterward -> must NOT write back to manifest
    upsertMockDownloadItem({
      id: 901,
      url: 'https://moodle.tau.ac.il/drop_me.pdf',
      filename: '/home/u/Downloads/Noodle/Course 202/General/drop_me.pdf',
      mime: 'application/pdf',
      state: 'complete',
      exists: true,
      fileSize: 1024,
    });
    resolveSlow(901);

    await waitForCondition(async () => (await getLocalFsStatus()).state === 'idle');
    expect((await getLocalFsManifest()).files['res:202:1:drop_me.pdf']).toBeUndefined();
    expect((await getLocalFsStatus()).syncedCountTotal).toBe(0);
  });

  it('Bug C & D: Scan strips dead exists:false downloadId + matches NFD Unicode nested subfolder + transitions paused -> idle; oversized .json aborts via Content-Length without reading body', async () => {
    setMockExtensionRuntime('firefox');
    await setStoredToken('tok_scan_clean');
    await setTrackedCourseIds([101], true);
    await setLocalFsConfig({
      enabled: true,
      rootLabel: 'Uni/Spring/Noodle',
      autoResyncMissingFiles: true,
    });

    // Decomposed NFD string vs NFC Moodle title
    const nfcName = '\u05e9\u05d9\u05e2\u05d5\u05e8_\u05d0\u0501.pdf'.normalize('NFC');
    const nfdName = 'Cafe\u0301_Notes.pdf';
    const nfcNotes = nfdName.normalize('NFC');
    await setCachedSyncResult(
      makeSyncResult([
        { id: 1, courseId: 101, fileName: nfcNotes },
        { id: 2, courseId: 101, fileName: nfcName },
      ])
    );

    // Simulate previously deleted file (#1 had downloadId 88, exists: false) plus paused queue holding both
    await setLocalFsManifest({
      files: {
        [`res:101:1:${nfcNotes}`]: {
          moodleFileId: `res:101:1:${nfcNotes}`,
          relativePath: `Course 101/General/${nfcNotes}`,
          lastModified: 1000,
          size: 1024,
          downloadId: 88,
          syncedAt: 500,
          origin: 'download',
        },
      },
      courseFolderNames: { 101: 'Course 101' },
    });
    seedMockDownloads([
      {
        id: 88,
        state: 'complete',
        exists: false,
        filename: `/home/u/Downloads/Uni/Spring/Noodle/Course 101/General/${nfcNotes}`,
      },
    ]);
    await setLocalFsQueue([
      {
        moodleFileId: `res:101:2:${nfcName}`,
        courseId: 101,
        sourceCourseId: 101,
        relativePath: `Course 101/General/${nfcName}`,
        fileName: nfcName,
        fileUrl: `https://moodle.tau.ac.il/${nfcName}`,
        canonicalUrlPath: `https://moodle.tau.ac.il/${nfcName}`,
        fileSize: 1024,
        timeModified: 1000,
        reason: 'new',
        attempts: 0,
      },
    ]);
    await setLocalFsStatus({ state: 'paused', totalQueued: 2, completedInCycle: 1, pendingCount: 1 });

    // Scan restores both under nested rootLabel + NFD normalization
    await adoptScannedDiskFiles([
      {
        relativePath: `Downloads/Uni/Spring/Noodle/Course 101/General/${nfdName}`,
        size: 1024,
        lastModified: 1000,
      },
      {
        relativePath: `Downloads/Uni/Spring/Noodle/Course 101/General/${nfcName.normalize('NFD')}`,
        size: 1024,
        lastModified: 1000,
      },
    ]);

    const mf = await getLocalFsManifest();
    expect(mf.files[`res:101:1:${nfcNotes}`].origin).toBe('scan');
    expect(mf.files[`res:101:1:${nfcNotes}`].downloadId).toBeUndefined();
    expect(mf.files[`res:101:2:${nfcName}`].origin).toBe('scan');

    const stScan = await getLocalFsStatus();
    expect(stScan.state).toBe('idle');
    expect(stScan.pendingCount).toBe(0);
    expect(stScan.totalQueued).toBe(0);
    expect(getMockAlarms().has(LOCAL_FS_RESUME_ALARM)).toBe(false);

    // autoResyncMissingFiles must NOT re-download restored #1
    await enqueueLocalFsSync();
    await waitForCondition(async () => (await getLocalFsStatus()).state === 'idle');
    expect(mockState.downloadCalls).toHaveLength(0);

    // Bug D: Large application/json Content-Length skips clone().json() and triggers OversizedFileError immediately
    setMockExtensionRuntime('chrome');
    const fsa = createInMemoryFsaRoot();
    setMockDirectoryHandle(fsa.rootHandle);
    await setLocalFsConfig({ enabled: true, rootLabel: 'Noodle', maxFileSizeMb: 1 });
    await setCachedSyncResult(
      makeSyncResult([
        { id: 1, courseId: 101, fileName: nfcNotes },
        { id: 2, courseId: 101, fileName: nfcName },
        { id: 3, courseId: 101, fileName: 'dataset.json', fileSize: 0 },
      ])
    );
    // Keep #1 and #2 present in FSA memory
    for (const fn of [nfcNotes, nfcName]) {
      fsa.writtenFiles.set(`Course 101/General/${fn}`, new Uint8Array([1, 2]));
    }

    let pullAfterInitialChunk = false;
    let abortedJsonFetch = false;
    let cloneCalled = false;
    globalThis.fetch = jest.fn(async (_url: string, init?: RequestInit) => {
      init?.signal?.addEventListener('abort', () => {
        abortedJsonFetch = true;
      });
      const hugeJsonStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([123])); // fills HWM=1 so pull() only fires if read() is invoked
        },
        pull(controller) {
          pullAfterInitialChunk = true;
          controller.close();
        },
      });
      const res = new Response(hugeJsonStream, {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'content-length': String(10 * 1024 * 1024),
        },
      });
      const origClone = res.clone.bind(res);
      res.clone = () => {
        cloneCalled = true;
        return origClone();
      };
      return res;
    }) as unknown as typeof fetch;

    await enqueueLocalFsSync();
    await waitForCondition(async () => (await getLocalFsStatus()).state === 'idle');
    expect(abortedJsonFetch).toBe(true);
    expect(cloneCalled).toBe(false);
    expect(pullAfterInitialChunk).toBe(false);
    expect((await getLocalFsStatus()).skippedTooLargeCount).toBe(1);

    // Part 2 of Bug D: Genuine large chunked application/json (no Content-Length) cancels clone reader at 16KB and streams whole file cleanly
    await setLocalFsConfig({ enabled: true, rootLabel: 'Noodle', maxFileSizeMb: 0 });
    await setCachedSyncResult(
      makeSyncResult([{ id: 4, courseId: 101, fileName: 'chunked_data.json', fileSize: 0 }])
    );
    const chunkA = new Uint8Array(12 * 1024).fill(97); // 'a'
    const chunkB = new Uint8Array(12 * 1024).fill(98); // 'b' (pushes clone reader > 16KB limit)
    const chunkC = new Uint8Array(12 * 1024).fill(99); // 'c'
    globalThis.fetch = jest.fn(async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(chunkA);
          controller.enqueue(chunkB);
          controller.enqueue(chunkC);
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    await enqueueLocalFsSync();
    await waitForCondition(async () => (await getLocalFsStatus()).state === 'idle');
    const savedChunked = fsa.writtenFiles.get('Course 101/General/chunked_data.json');
    expect(savedChunked).toBeDefined();
    expect(savedChunked?.byteLength).toBe(36 * 1024);
  });
});
