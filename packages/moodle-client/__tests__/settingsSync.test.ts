import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { SettingsSyncManager, SharedSettings, getEffectiveTheme } from '../src/settingsSync.js';
import { MoodleClient, RestMoodleStrategy } from '../src/moodleApi.js';

describe('Category 9: Cross-Device Settings Sync (Moodle Calendar)', () => {
  let mockClient: jest.Mocked<MoodleClient>;
  let syncManager: SettingsSyncManager;

  beforeEach(() => {
    mockClient = {
      saveNoodleSettings: jest.fn<any>().mockResolvedValue(undefined),
      loadNoodleSettings: jest.fn<any>().mockResolvedValue(null),
    } as unknown as jest.Mocked<MoodleClient>;

    syncManager = new SettingsSyncManager(mockClient, 'device_chrome_1');
  });

  describe('TC-SYNC-01: Serialize Settings to Calendar Event', () => {
    it('should save settings serialized as JSON when remote is empty', async () => {
      const local: SharedSettings = {
        theme: { value: 'noodle', updatedAt: 1000, deviceId: 'device_chrome_1' },
      };

      const result = await syncManager.sync(local);
      expect(result).toEqual(local);
      expect(mockClient.saveNoodleSettings).toHaveBeenCalledWith(JSON.stringify(local));
    });
  });

  describe('TC-SYNC-02: Remote Settings Pull & LWW Merge', () => {
    it('should resolve conflicts using Last-Write-Wins based on timestamps', () => {
      const local: SharedSettings = {
        theme: { value: 'dark', updatedAt: 1000, deviceId: 'device_chrome_1' },
        completed_assignments: { value: [1, 2], updatedAt: 2500, deviceId: 'device_chrome_1' },
      };

      const remote: SharedSettings = {
        theme: { value: 'noodle', updatedAt: 2000, deviceId: 'device_mobile_1' }, // Newer
        completed_assignments: { value: [1], updatedAt: 1500, deviceId: 'device_mobile_1' }, // Older
      };

      const { merged, needsUpload } = syncManager.mergeSettings(local, remote);

      // Theme should take remote value ('noodle') because 2000 > 1000
      expect(merged.theme?.value).toBe('noodle');

      // Completed assignments should take local value ([1, 2]) because 2500 > 1500
      expect(merged.completed_assignments?.value).toEqual([1, 2]);

      // needsUpload should be true because local had a newer value
      expect(needsUpload).toBe(true);
    });

    it('should pull remote settings and update if remote is newer without triggering upload', async () => {
      const local: SharedSettings = {
        theme: { value: 'dark', updatedAt: 1000, deviceId: 'device_chrome_1' },
      };

      const remote: SharedSettings = {
        theme: { value: 'noodle', updatedAt: 2000, deviceId: 'device_mobile_1' },
      };

      mockClient.loadNoodleSettings.mockResolvedValue(remote);

      const result = await syncManager.sync(local);
      expect(result.theme?.value).toBe('noodle');
      // No upload needed because remote was strictly newer
      expect(mockClient.saveNoodleSettings).not.toHaveBeenCalled();
    });

    it('should abort and NOT overwrite remote settings when loadNoodleSettings() throws', async () => {
      const local: SharedSettings = {
        theme: { value: 'dark', updatedAt: 1000, deviceId: 'device_chrome_1' },
      };

      mockClient.loadNoodleSettings.mockRejectedValue(new Error('Network timeout'));

      await expect(syncManager.sync(local)).rejects.toThrow('Network timeout');
      expect(mockClient.saveNoodleSettings).not.toHaveBeenCalled();
    });

    it('should create new NOODLE_SYNC_DATA event BEFORE deleting older events in RestMoodleStrategy.saveNoodleSettings', async () => {
      const callOrder: string[] = [];
      const customFetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const body = init?.body ? String(init.body) : '';
        const urlStr = String(url);
        const fn = (name: string) => urlStr.includes(name) || body.includes(name);

        if (fn('core_calendar_get_calendar_events')) {
          callOrder.push('get');
          return {
            ok: true,
            headers: new Headers(),
            json: async () => ({
              events: [
                { id: 10, name: 'NOODLE_SYNC_DATA' },
                { id: 11, name: 'NOODLE_SYNC_DATA' },
              ],
            }),
          } as unknown as Response;
        }
        if (fn('core_calendar_create_calendar_events')) {
          callOrder.push('create');
          return {
            ok: true,
            headers: new Headers(),
            json: async () => ({ events: [{ id: 12, name: 'NOODLE_SYNC_DATA' }] }),
          } as unknown as Response;
        }
        if (fn('core_calendar_delete_calendar_events')) {
          callOrder.push('delete');
          expect(body).toContain('events%5B0%5D%5Beventid%5D=10');
          expect(body).toContain('events%5B1%5D%5Beventid%5D=11');
          expect(body).not.toContain('=12');
          return {
            ok: true,
            headers: new Headers(),
            json: async () => ({}),
          } as unknown as Response;
        }
        throw new Error(`Unexpected call: ${urlStr} ${body}`);
      });

      const strategy = new RestMoodleStrategy({
        baseUrl: 'https://moodle.tau.ac.il',
        token: 'tok',
        fetch: customFetch as any,
      });

      await strategy.saveNoodleSettings('{"theme":{"value":"noodle","updatedAt":1,"deviceId":"d1"}}');
      expect(callOrder).toEqual(['get', 'create', 'delete']);
    });

    it('should NOT delete old NOODLE_SYNC_DATA events if creating the new event fails', async () => {
      const callOrder: string[] = [];
      const customFetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const body = init?.body ? String(init.body) : '';
        const urlStr = String(url);
        const fn = (name: string) => urlStr.includes(name) || body.includes(name);

        if (fn('core_calendar_get_calendar_events')) {
          callOrder.push('get');
          return {
            ok: true,
            headers: new Headers(),
            json: async () => ({ events: [{ id: 10, name: 'NOODLE_SYNC_DATA' }] }),
          } as unknown as Response;
        }
        if (fn('core_calendar_create_calendar_events')) {
          callOrder.push('create');
          return {
            ok: true,
            headers: new Headers(),
            json: async () => ({
              exception: 'moodle_exception',
              errorcode: 'invalidtoken',
              message: 'Invalid token',
            }),
          } as unknown as Response;
        }
        if (fn('core_calendar_delete_calendar_events')) {
          callOrder.push('delete');
          return { ok: true, headers: new Headers(), json: async () => ({}) } as unknown as Response;
        }
        throw new Error(`Unexpected call: ${urlStr}`);
      });

      const strategy = new RestMoodleStrategy({
        baseUrl: 'https://moodle.tau.ac.il',
        token: 'tok',
        fetch: customFetch as any,
      });

      await expect(strategy.saveNoodleSettings('{}')).rejects.toThrow('Invalid token');
      expect(callOrder).toEqual(['get', 'create']);
    });
  });
  describe('TC-UI-06: Theme-by-Time Calculation (getEffectiveTheme)', () => {
    it('should return static themes directly', () => {
      expect(getEffectiveTheme('dark')).toBe('dark');
      expect(getEffectiveTheme('coffee')).toBe('coffee');
      expect(getEffectiveTheme('noodle')).toBe('noodle');
      expect(getEffectiveTheme(null)).toBe('noodle');
    });

    it('should calculate daytime as noodle and nighttime as coffee for standard 7-17 range', () => {
      // Daytime tests
      expect(getEffectiveTheme('time', 7, 17, 7)).toBe('noodle');
      expect(getEffectiveTheme('time', 7, 17, 12)).toBe('noodle');
      expect(getEffectiveTheme('time', 7, 17, 16)).toBe('noodle');

      // Nighttime tests
      expect(getEffectiveTheme('time', 7, 17, 17)).toBe('coffee');
      expect(getEffectiveTheme('time', 7, 17, 23)).toBe('coffee');
      expect(getEffectiveTheme('time', 7, 17, 0)).toBe('coffee');
      expect(getEffectiveTheme('time', 7, 17, 6)).toBe('coffee');
    });

    it('should handle inverted hour ranges (e.g. night owl 20 to 6)', () => {
      expect(getEffectiveTheme('time', 20, 6, 22)).toBe('noodle');
      expect(getEffectiveTheme('time', 20, 6, 2)).toBe('noodle');
      expect(getEffectiveTheme('time', 20, 6, 12)).toBe('coffee');
    });
  });
});
