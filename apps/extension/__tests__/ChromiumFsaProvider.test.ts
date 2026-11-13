import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  ChromiumFsaProvider,
  LocalFsPermissionError,
} from '../src/services/fs/ChromiumFsaProvider.js';
import { setMockDirectoryHandle } from './__mocks__/fsaHandleStore.js';
import { resetAllExtensionMocks } from './__mocks__/webextensionPolyfill.js';

function makeError(name: string, message: string): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

describe('ChromiumFsaProvider', () => {
  let provider: ChromiumFsaProvider;

  beforeEach(() => {
    resetAllExtensionMocks('chrome');
    setMockDirectoryHandle(null);
    provider = new ChromiumFsaProvider();
  });

  it('translates NotAllowedError and SecurityError in resolveFileHandle/writeFile into LocalFsPermissionError', async () => {
    const dirHandle = {
      name: 'Noodle',
      queryPermission: async () => 'granted',
      getDirectoryHandle: async () => {
        throw makeError('NotAllowedError', 'User revoked directory permission');
      },
      getFileHandle: async () => {
        throw makeError('NotAllowedError', 'User revoked file permission');
      },
    } as unknown as FileSystemDirectoryHandle;

    setMockDirectoryHandle(dirHandle);

    await expect(
      provider.writeFile(
        { moodleFileId: 'res:1:1:a.pdf', relativePath: 'Algo/a.pdf', lastModified: 100 },
        { url: 'https://moodle.tau.ac.il/a.pdf', blob: new Blob(['hello']) }
      )
    ).rejects.toBeInstanceOf(LocalFsPermissionError);

    const fileHandle = {
      createWritable: async () => {
        throw makeError('SecurityError', 'Cross-origin or sandboxed security denial');
      },
    } as unknown as FileSystemFileHandle;

    const okDir = {
      name: 'Noodle',
      queryPermission: async () => 'granted',
      getDirectoryHandle: async () => okDir,
      getFileHandle: async () => fileHandle,
    } as unknown as FileSystemDirectoryHandle;

    setMockDirectoryHandle(okDir);

    await expect(
      provider.writeFile(
        { moodleFileId: 'res:1:2:b.pdf', relativePath: 'Algo/b.pdf', lastModified: 100 },
        { url: 'https://moodle.tau.ac.il/b.pdf', blob: new Blob(['hello']) }
      )
    ).rejects.toBeInstanceOf(LocalFsPermissionError);
  });

  it('checkFilePresence returns present, missing, or unverifiable without misclassifying revoked permissions', async () => {
    // Missing root handle -> unverifiable (never triggers autoResyncMissingFiles wipe)
    expect(
      await provider.checkFilePresence({
        moodleFileId: 'res:1:1:a.pdf',
        relativePath: 'Algo/a.pdf',
        lastModified: 100,
      })
    ).toBe('unverifiable');

    // Permission state 'prompt' -> unverifiable
    const promptDir = {
      name: 'Noodle',
      queryPermission: async () => 'prompt',
    } as unknown as FileSystemDirectoryHandle;
    setMockDirectoryHandle(promptDir);

    expect(
      await provider.checkFilePresence({
        moodleFileId: 'res:1:1:a.pdf',
        relativePath: 'Algo/a.pdf',
        lastModified: 100,
      })
    ).toBe('unverifiable');

    // Genuine NotFoundError -> missing
    const missingDir = {
      name: 'Noodle',
      queryPermission: async () => 'granted',
      getDirectoryHandle: async () => missingDir,
      getFileHandle: async () => {
        throw makeError('NotFoundError', 'File does not exist');
      },
    } as unknown as FileSystemDirectoryHandle;
    setMockDirectoryHandle(missingDir);

    expect(
      await provider.checkFilePresence({
        moodleFileId: 'res:1:1:a.pdf',
        relativePath: 'Algo/a.pdf',
        lastModified: 100,
      })
    ).toBe('missing');

    // Present handle -> present
    const presentDir = {
      name: 'Noodle',
      queryPermission: async () => 'granted',
      getDirectoryHandle: async () => presentDir,
      getFileHandle: async () => ({}) as FileSystemFileHandle,
    } as unknown as FileSystemDirectoryHandle;
    setMockDirectoryHandle(presentDir);

    expect(
      await provider.checkFilePresence({
        moodleFileId: 'res:1:1:a.pdf',
        relativePath: 'Algo/a.pdf',
        lastModified: 100,
      })
    ).toBe('present');
  });

  it('streams source.stream directly into FileSystemWritableFileStream without double closing', async () => {
    const writtenChunks: Uint8Array[] = [];
    let closedCount = 0;
    let abortedCount = 0;

    const writable = new WritableStream<Uint8Array>({
      write(chunk) {
        writtenChunks.push(chunk);
      },
      close() {
        closedCount++;
      },
      abort() {
        abortedCount++;
      },
    }) as unknown as FileSystemWritableFileStream;

    const fileHandle = {
      createWritable: async () => writable,
    } as unknown as FileSystemFileHandle;

    const dirHandle = {
      name: 'Noodle',
      queryPermission: async () => 'granted',
      getDirectoryHandle: async () => dirHandle,
      getFileHandle: async () => fileHandle,
    } as unknown as FileSystemDirectoryHandle;
    setMockDirectoryHandle(dirHandle);

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4, 5]));
        controller.close();
      },
    });

    const record = await provider.writeFile(
      { moodleFileId: 'res:1:3:c.bin', relativePath: 'Algo/c.bin', lastModified: 200 },
      { url: 'https://moodle.tau.ac.il/c.bin', stream }
    );

    expect(record.origin).toBe('fsa');
    expect(closedCount).toBe(1);
    expect(abortedCount).toBe(0);
    expect(writtenChunks.reduce((sum, c) => sum + c.byteLength, 0)).toBe(5);
  });
});
