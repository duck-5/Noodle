type StorageData = Record<string, unknown>;
type AlarmRecord = { name: string; scheduledTime: number; periodInMinutes?: number };
type DownloadDelta = {
  id: number;
  state?: { current?: string; previous?: string };
  error?: { current?: string };
  totalBytes?: { current?: number };
  bytesReceived?: { current?: number };
};
type DownloadItem = {
  id: number;
  url?: string;
  filename?: string;
  mime?: string;
  state?: 'in_progress' | 'interrupted' | 'complete';
  exists?: boolean;
  fileSize?: number;
  totalBytes?: number;
  bytesReceived?: number;
  error?: string;
};

let runtimeMode: 'chrome' | 'firefox' = 'chrome';
let storageData: StorageData = {};
let syncStorageData: StorageData = {};
const alarmsMap = new Map<string, AlarmRecord>();
const downloadItems = new Map<number, DownloadItem>();
let nextDownloadId = 100;
const onChangedListeners = new Set<(delta: DownloadDelta) => void>();

type CustomDownloadHandler = (opts: {
  url: string;
  filename?: string;
  conflictAction?: string;
  saveAs?: boolean;
}) => Promise<number> | number;

let customDownloadHandler: CustomDownloadHandler | null = null;

export const mockState = {
  searchCalls: 0,
  downloadCalls: [] as Array<{ url: string; filename?: string }>,
  cancelCalls: [] as number[],
  removeFileCalls: [] as number[],
  eraseCalls: [] as number[],
  openCalls: [] as number[],
  showCalls: [] as number[],
  tabsCreated: [] as string[],
};

export function setMockExtensionRuntime(mode: 'chrome' | 'firefox'): void {
  runtimeMode = mode;
}

export function seedMockStorage(initial: StorageData): void {
  storageData = { ...initial };
}

export function getMockStorage(): StorageData {
  return storageData;
}

export function seedMockDownloads(items: DownloadItem[]): void {
  downloadItems.clear();
  for (const item of items) {
    downloadItems.set(item.id, { ...item });
    if (item.id >= nextDownloadId) {
      nextDownloadId = item.id + 1;
    }
  }
}

export function setMockDownloadHandler(handler: CustomDownloadHandler | null): void {
  customDownloadHandler = handler;
}

export function upsertMockDownloadItem(item: DownloadItem): void {
  downloadItems.set(item.id, { ...item });
}

export function emitMockDownloadChanged(delta: DownloadDelta): void {
  for (const listener of Array.from(onChangedListeners)) {
    listener(delta);
  }
}

export function getMockAlarms(): Map<string, AlarmRecord> {
  return alarmsMap;
}

export function resetAllExtensionMocks(mode: 'chrome' | 'firefox' = 'chrome'): void {
  runtimeMode = mode;
  storageData = {};
  syncStorageData = {};
  alarmsMap.clear();
  downloadItems.clear();
  nextDownloadId = 100;
  customDownloadHandler = null;
  onChangedListeners.clear();
  mockState.searchCalls = 0;
  mockState.downloadCalls = [];
  mockState.cancelCalls = [];
  mockState.removeFileCalls = [];
  mockState.eraseCalls = [];
  mockState.openCalls = [];
  mockState.showCalls = [];
  mockState.tabsCreated = [];
}

const mockBrowser = {
  runtime: {
    getURL: (path = '') =>
      runtimeMode === 'firefox'
        ? `moz-extension://test-ext-id/${path}`
        : `chrome-extension://test-ext-id/${path}`,
    sendMessage: async () => ({ success: true }),
  },
  storage: {
    local: {
      get: async (keys?: string | string[] | null) => {
        if (!keys) return { ...storageData };
        const keyList = Array.isArray(keys) ? keys : [keys];
        const out: StorageData = {};
        for (const k of keyList) {
          if (k in storageData) {
            out[k] = storageData[k];
          }
        }
        return out;
      },
      set: async (items: StorageData) => {
        Object.assign(storageData, items);
      },
      remove: async (keys: string | string[]) => {
        const keyList = Array.isArray(keys) ? keys : [keys];
        for (const k of keyList) {
          delete storageData[k];
        }
      },
      clear: async () => {
        storageData = {};
      },
    },
    sync: {
      get: async (keys?: string | string[] | null) => {
        if (!keys) return { ...syncStorageData };
        const keyList = Array.isArray(keys) ? keys : [keys];
        const out: StorageData = {};
        for (const k of keyList) {
          if (k in syncStorageData) {
            out[k] = syncStorageData[k];
          }
        }
        return out;
      },
      set: async (items: StorageData) => {
        Object.assign(syncStorageData, items);
      },
      remove: async (keys: string | string[]) => {
        const keyList = Array.isArray(keys) ? keys : [keys];
        for (const k of keyList) {
          delete syncStorageData[k];
        }
      },
      clear: async () => {
        syncStorageData = {};
      },
    },
  },
  alarms: {
    get: async (name: string) => alarmsMap.get(name),
    create: async (name: string, alarmInfo: { periodInMinutes?: number; delayInMinutes?: number }) => {
      alarmsMap.set(name, {
        name,
        scheduledTime: Date.now() + (alarmInfo.delayInMinutes ?? alarmInfo.periodInMinutes ?? 1) * 60_000,
        periodInMinutes: alarmInfo.periodInMinutes,
      });
    },
    clear: async (name: string) => alarmsMap.delete(name),
    clearAll: async () => {
      alarmsMap.clear();
      return true;
    },
  },
  tabs: {
    create: async ({ url }: { url: string }) => {
      mockState.tabsCreated.push(url);
      return { id: 1, url };
    },
  },
  downloads: {
    download: async (opts: { url: string; filename?: string; conflictAction?: string; saveAs?: boolean }) => {
      mockState.downloadCalls.push({ url: opts.url, filename: opts.filename });
      if (customDownloadHandler) {
        return await customDownloadHandler(opts);
      }
      const id = nextDownloadId++;
      downloadItems.set(id, {
        id,
        url: opts.url,
        filename: `/home/user/Downloads/${opts.filename || 'file.bin'}`,
        mime: 'application/pdf',
        state: 'complete',
        exists: true,
        fileSize: 2048,
        totalBytes: 2048,
      });
      emitMockDownloadChanged({ id, state: { current: 'complete' } });
      return id;
    },
    search: async (query: { id?: number; state?: string }) => {
      mockState.searchCalls++;
      if (typeof query?.id === 'number') {
        const found = downloadItems.get(query.id);
        return found ? [{ ...found }] : [];
      }
      const all = Array.from(downloadItems.values());
      if (query?.state) {
        return all.filter((i) => i.state === query.state).map((i) => ({ ...i }));
      }
      return all.map((i) => ({ ...i }));
    },
    cancel: async (id: number) => {
      mockState.cancelCalls.push(id);
      const item = downloadItems.get(id);
      if (item) {
        item.state = 'interrupted';
        item.error = 'USER_CANCELED';
      }
    },
    removeFile: async (id: number) => {
      mockState.removeFileCalls.push(id);
      const item = downloadItems.get(id);
      if (item) {
        item.exists = false;
      }
    },
    erase: async (query: { id?: number }) => {
      if (typeof query?.id === 'number') {
        mockState.eraseCalls.push(query.id);
        downloadItems.delete(query.id);
        return [query.id];
      }
      return [];
    },
    open: async (id: number) => {
      mockState.openCalls.push(id);
      const item = downloadItems.get(id);
      if (!item || item.exists !== true) {
        throw new Error(`Invalid or missing download ${id}`);
      }
    },
    show: async (id: number) => {
      mockState.showCalls.push(id);
    },
    onChanged: {
      addListener: (fn: (delta: DownloadDelta) => void) => {
        onChangedListeners.add(fn);
      },
      removeListener: (fn: (delta: DownloadDelta) => void) => {
        onChangedListeners.delete(fn);
      },
    },
  },
};

export default mockBrowser;
