import { SettingsSyncManager, SharedSettings } from '../src/settingsSync.js';
import { MoodleClient } from '../src/moodleApi.js';

describe('Category 9: Cross-Device Settings Sync (Moodle Calendar)', () => {
  let mockClient: jest.Mocked<MoodleClient>;
  let syncManager: SettingsSyncManager;

  beforeEach(() => {
    mockClient = {
      saveNoodleSettings: jest.fn().mockResolvedValue(undefined),
      loadNoodleSettings: jest.fn().mockResolvedValue(null),
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
  });
});
