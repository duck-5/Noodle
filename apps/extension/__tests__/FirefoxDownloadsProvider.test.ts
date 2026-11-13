import { describe, it, expect, beforeEach } from '@jest/globals';
import browser from 'webextension-polyfill';
import {
  findBestMatchingDownload,
  FirefoxDownloadsProvider,
  LocalFsDownloadAuthError,
  LocalFsDownloadOversizedError,
} from '../src/services/fs/FirefoxDownloadsProvider.js';
import {
  getLocalFsManifest,
  setLocalFsConfig,
  setLocalFsManifest,
} from '../src/shared/storage.js';
import {
  emitMockDownloadChanged,
  mockState,
  resetAllExtensionMocks,
  seedMockDownloads,
  setMockDownloadHandler,
  upsertMockDownloadItem,
} from './__mocks__/webextensionPolyfill.js';

describe('FirefoxDownloadsProvider', () => {
  let provider: FirefoxDownloadsProvider;

  beforeEach(async () => {
    resetAllExtensionMocks('firefox');
    await setLocalFsConfig({ enabled: true, rootLabel: 'Noodle' });
    provider = new FirefoxDownloadsProvider();
  });

  describe('findBestMatchingDownload', () => {
    it('matches exact subfolder + relativePath case-insensitively and picks highest id', () => {
      const items = [
        { id: 10, state: 'complete' as const, exists: true, filename: '/home/u/Downloads/Noodle/Course A/slides.pdf' },
        { id: 25, state: 'complete' as const, exists: true, filename: 'C:\\Users\\u\\Downloads\\noodle\\course a\\slides.pdf' },
        { id: 30, state: 'complete' as const, exists: false, filename: '/home/u/Downloads/Noodle/Course A/slides.pdf' },
        { id: 35, state: 'in_progress' as const, exists: true, filename: '/home/u/Downloads/Noodle/Course A/slides.pdf' },
      ];

      const match = findBestMatchingDownload(items as never, 'Noodle', 'Course A/slides.pdf');
      expect(match?.id).toBe(25);
    });

    it('rejects loose relSuffix matches located under different root subfolders', () => {
      const items = [
        { id: 11, state: 'complete' as const, exists: true, filename: '/home/u/Downloads/OtherFolder/Course A/slides.pdf' },
        { id: 12, state: 'complete' as const, exists: true, filename: '/home/u/Downloads/OldNoodle/Course A/slides.pdf' },
      ];

      const match = findBestMatchingDownload(items as never, 'Noodle', 'Course A/slides.pdf');
      expect(match).toBeNull();
    });
  });

  describe('checkFilePresence & batchCheckFilePresence', () => {
    it('returns present, missing, or unverifiable accurately and avoids false missing for scanned/rclone entries', async () => {
      seedMockDownloads([
        {
          id: 1,
          state: 'complete',
          exists: true,
          filename: '/home/u/Downloads/Noodle/Algo/live.pdf',
        },
        {
          id: 2,
          state: 'complete',
          exists: false,
          filename: '/home/u/Downloads/Noodle/Algo/deleted.pdf',
        },
      ]);

      expect(
        await provider.checkFilePresence({
          moodleFileId: 'res:1:1:live.pdf',
          relativePath: 'Algo/live.pdf',
          lastModified: 100,
          downloadId: 1,
        })
      ).toBe('present');

      expect(
        await provider.checkFilePresence({
          moodleFileId: 'res:1:2:deleted.pdf',
          relativePath: 'Algo/deleted.pdf',
          lastModified: 100,
          downloadId: 2,
        })
      ).toBe('missing');

      // Scanned / rclone-synced file lacking downloadId must NEVER report 'missing'
      expect(
        await provider.checkFilePresence({
          moodleFileId: 'res:1:3:rclone.pdf',
          relativePath: 'Algo/rclone.pdf',
          lastModified: 100,
          origin: 'scan',
        })
      ).toBe('unverifiable');

      // Record whose downloadId was purged from Firefox history must also return 'unverifiable'
      expect(
        await provider.checkFilePresence({
          moodleFileId: 'res:1:4:purged.pdf',
          relativePath: 'Algo/purged.pdf',
          lastModified: 100,
          downloadId: 999,
        })
      ).toBe('unverifiable');

      // Scanned record that happens to match a live download in Downloads/Noodle resolves 'present'
      expect(
        await provider.checkFilePresence({
          moodleFileId: 'res:1:5:live_scan.pdf',
          relativePath: 'Algo/live.pdf',
          lastModified: 100,
          origin: 'scan',
        })
      ).toBe('present');
    });

    it('batchCheckFilePresence performs a single downloads.search call across many records', async () => {
      seedMockDownloads([
        { id: 10, state: 'complete', exists: true, filename: '/home/u/Downloads/Noodle/C/f1.pdf' },
      ]);
      mockState.searchCalls = 0;

      const records = Array.from({ length: 40 }, (_, i) => ({
        moodleFileId: `res:1:${i}:f${i}.pdf`,
        relativePath: `C/f${i}.pdf`,
        lastModified: 100,
        downloadId: i === 1 ? 10 : undefined,
      }));

      const result = await provider.batchCheckFilePresence(records);
      expect(mockState.searchCalls).toBe(1);
      expect(result['res:1:1:f1.pdf']).toBe('present');
      expect(result['res:1:0:f0.pdf']).toBe('unverifiable');
    });
  });

  describe('reconcileManifestDetailed', () => {
    it('repairs rotated IDs, preserves confirmed-missing downloadIds, and strips purged history IDs', async () => {
      seedMockDownloads([
        { id: 50, state: 'complete', exists: true, filename: '/home/u/Downloads/Noodle/C/rotated.pdf' },
        { id: 60, state: 'complete', exists: false, filename: '/home/u/Downloads/Noodle/C/deleted.pdf' },
      ]);

      await setLocalFsManifest({
        courseFolderNames: { 1: 'C' },
        files: {
          f_rotated: {
            moodleFileId: 'f_rotated',
            relativePath: 'C/rotated.pdf',
            lastModified: 10,
            downloadId: 5, // Old rotated ID
            origin: 'scan',
          },
          f_deleted: {
            moodleFileId: 'f_deleted',
            relativePath: 'C/deleted.pdf',
            lastModified: 10,
            downloadId: 60,
            origin: 'download',
          },
          f_purged: {
            moodleFileId: 'f_purged',
            relativePath: 'C/purged.pdf',
            lastModified: 10,
            downloadId: 888, // Purged from Firefox download history
            origin: 'download',
          },
          f_rclone: {
            moodleFileId: 'f_rclone',
            relativePath: 'C/rclone.pdf',
            lastModified: 10,
            origin: 'scan',
          },
        },
      });

      const report = await provider.reconcileManifestDetailed();
      expect(report.repaired).toBe(1);
      expect(report.cleared).toBe(1);
      expect(report.confirmedMissingIds).toEqual(['f_deleted']);

      const updated = await getLocalFsManifest();
      expect(updated.files.f_rotated.downloadId).toBe(50);
      expect(updated.files.f_rotated.origin).toBe('download');
      // Preserved so autoResyncMissingFiles sees exists === false
      expect(updated.files.f_deleted.downloadId).toBe(60);
      // Dead downloadId cleared so UI won't render a broken green PC badge
      expect(updated.files.f_purged.downloadId).toBeUndefined();
      // rclone entry stays intact without downloadId
      expect(updated.files.f_rclone.downloadId).toBeUndefined();
    });
  });

  describe('writeFile single-pass validations', () => {
    it('completes happy-path download with downloadId and download origin', async () => {
      const saved = await provider.writeFile(
        {
          moodleFileId: 'res:1:10:lec.pdf',
          relativePath: 'Course/lec.pdf',
          lastModified: 500,
          size: 0,
        },
        { url: 'https://moodle.tau.ac.il/pluginfile.php/10/lec.pdf?token=abc', maxBytes: 1024 * 1024 }
      );

      expect(mockState.downloadCalls).toHaveLength(1);
      expect(saved.downloadId).toBeDefined();
      expect(saved.origin).toBe('download');
      expect(saved.size).toBe(2048);
    });

    it('detects SAML/HTML response, deletes partial file, erases entry, and throws LocalFsDownloadAuthError', async () => {
      setMockDownloadHandler(async (opts) => {
        upsertMockDownloadItem({
          id: 201,
          url: 'https://nidp.tau.ac.il/nidp/saml2/sso',
          filename: `/home/u/Downloads/${opts.filename}`,
          mime: 'text/html',
          state: 'complete',
          exists: true,
          fileSize: 4096,
        });
        emitMockDownloadChanged({ id: 201, state: { current: 'complete' } });
        return 201;
      });

      await expect(
        provider.writeFile(
          {
            moodleFileId: 'res:1:11:slides.pdf',
            relativePath: 'Course/slides.pdf',
            lastModified: 100,
          },
          { url: 'https://moodle.tau.ac.il/pluginfile.php/11/slides.pdf?token=expired' }
        )
      ).rejects.toBeInstanceOf(LocalFsDownloadAuthError);

      expect(mockState.removeFileCalls).toContain(201);
      expect(mockState.eraseCalls).toContain(201);
    });

    it('detects small Moodle JSON API error response on non-JSON file and throws LocalFsDownloadAuthError', async () => {
      setMockDownloadHandler(async (opts) => {
        upsertMockDownloadItem({
          id: 202,
          url: opts.url,
          filename: `/home/u/Downloads/${opts.filename}`,
          mime: 'application/json',
          state: 'complete',
          exists: true,
          fileSize: 180,
        });
        return 202;
      });

      await expect(
        provider.writeFile(
          {
            moodleFileId: 'res:1:12:slides.pptx',
            relativePath: 'Course/slides.pptx',
            lastModified: 100,
          },
          { url: 'https://moodle.tau.ac.il/webservice/pluginfile.php/12/slides.pptx?token=expired' }
        )
      ).rejects.toBeInstanceOf(LocalFsDownloadAuthError);

      expect(mockState.removeFileCalls).toContain(202);
      expect(mockState.eraseCalls).toContain(202);
    });

    it('allows genuine .json and .html target downloads without false auth errors', async () => {
      setMockDownloadHandler(async (opts) => {
        upsertMockDownloadItem({
          id: 203,
          url: opts.url,
          filename: `/home/u/Downloads/${opts.filename}`,
          mime: opts.filename?.endsWith('.json') ? 'application/json' : 'text/html',
          state: 'complete',
          exists: true,
          fileSize: 256,
        });
        return 203;
      });

      const rec = await provider.writeFile(
        {
          moodleFileId: 'res:1:13:data.json',
          relativePath: 'Course/data.json',
          lastModified: 100,
        },
        { url: 'https://moodle.tau.ac.il/webservice/pluginfile.php/13/data.json?token=ok' }
      );
      expect(rec.downloadId).toBe(203);
    });

    it('maps SERVER_UNAUTHORIZED interrupted download to LocalFsDownloadAuthError', async () => {
      setMockDownloadHandler(async () => {
        setTimeout(() => {
          emitMockDownloadChanged({
            id: 204,
            state: { current: 'interrupted' },
            error: { current: 'SERVER_UNAUTHORIZED' },
          });
        }, 5);
        upsertMockDownloadItem({ id: 204, state: 'in_progress', exists: false });
        return 204;
      });

      await expect(
        provider.writeFile(
          { moodleFileId: 'res:1:14:hw.pdf', relativePath: 'Course/hw.pdf', lastModified: 100 },
          { url: 'https://moodle.tau.ac.il/pluginfile.php/14/hw.pdf' }
        )
      ).rejects.toBeInstanceOf(LocalFsDownloadAuthError);
      expect(mockState.eraseCalls).toContain(204);
    });

    it('cancels and erases download exceeding maxBytes during totalBytes progress or on completion', async () => {
      setMockDownloadHandler(async () => {
        upsertMockDownloadItem({ id: 205, state: 'in_progress', exists: false, totalBytes: 1024 });
        setTimeout(() => {
          emitMockDownloadChanged({ id: 205, totalBytes: { current: 50 * 1024 * 1024 } });
        }, 5);
        return 205;
      });

      await expect(
        provider.writeFile(
          { moodleFileId: 'res:1:15:video.mp4', relativePath: 'Course/video.mp4', lastModified: 100 },
          { url: 'https://moodle.tau.ac.il/pluginfile.php/15/video.mp4', maxBytes: 10 * 1024 * 1024 }
        )
      ).rejects.toBeInstanceOf(LocalFsDownloadOversizedError);

      expect(mockState.cancelCalls).toContain(205);
      expect(mockState.eraseCalls).toContain(205);
    });

    it('awaits async download cleanup (removeFile + erase) BEFORE writeFile rejects and detects finalUrl SAML redirects', async () => {
      let cleanupCompleted = false;
      const origErase = browser.downloads.erase;
      browser.downloads.erase = (async (query: browser.Downloads.DownloadQuery) => {
        await new Promise((r) => setTimeout(r, 25));
        cleanupCompleted = true;
        return await origErase(query);
      }) as typeof browser.downloads.erase;

      try {
        setMockDownloadHandler(async () => {
          upsertMockDownloadItem({ id: 206, state: 'in_progress', exists: false });
          setTimeout(() => {
            emitMockDownloadChanged({
              id: 206,
              state: { current: 'interrupted' },
              error: { current: 'SERVER_FORBIDDEN' },
            });
          }, 5);
          return 206;
        });

        await expect(
          provider.writeFile(
            { moodleFileId: 'res:1:16:denied.pdf', relativePath: 'Course/denied.pdf', lastModified: 100 },
            { url: 'https://moodle.tau.ac.il/pluginfile.php/16/denied.pdf' }
          )
        ).rejects.toBeInstanceOf(LocalFsDownloadAuthError);

        // Guaranteed finished BEFORE writeFile() rejection returned
        expect(cleanupCompleted).toBe(true);

        // finalUrl SAML detection when item.url kept original URL
        setMockDownloadHandler(async (opts) => {
          upsertMockDownloadItem({
            id: 207,
            url: opts.url,
            finalUrl: 'https://nidp.tau.ac.il/nidp/saml2/sso',
            filename: `/home/u/Downloads/${opts.filename}`,
            mime: 'application/octet-stream',
            state: 'complete',
            exists: true,
            fileSize: 2048,
          } as browser.Downloads.DownloadItem & { finalUrl: string });
          return 207;
        });

        await expect(
          provider.writeFile(
            { moodleFileId: 'res:1:17:slides.pdf', relativePath: 'Course/slides.pdf', lastModified: 100 },
            { url: 'https://moodle.tau.ac.il/pluginfile.php/17/slides.pdf' }
          )
        ).rejects.toBeInstanceOf(LocalFsDownloadAuthError);
      } finally {
        browser.downloads.erase = origErase;
      }
    });
  });
});
