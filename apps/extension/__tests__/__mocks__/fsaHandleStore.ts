let storedHandle: FileSystemDirectoryHandle | null = null;

export function setMockDirectoryHandle(handle: FileSystemDirectoryHandle | null): void {
  storedHandle = handle;
}

export async function getStoredDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  return storedHandle;
}

export async function saveDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  storedHandle = handle;
}

export async function clearDirectoryHandle(): Promise<void> {
  storedHandle = null;
}
