import { MoodleClient } from './moodleApi.js';

export interface TrackedValue<T> {
  value: T;
  updatedAt: number; // Unix timestamp in ms
  deviceId: string;
}

export interface SharedSettings {
  hidden_assignments?: TrackedValue<number[]>;
  completed_assignments?: TrackedValue<number[]>;
  uncompleted_assignments?: TrackedValue<number[]>;
  theme?: TrackedValue<string>;
  // Allow arbitrary extra settings
  [key: string]: TrackedValue<any> | undefined;
}

export class SettingsSyncManager {
  constructor(private moodleClient: MoodleClient, private deviceId: string) {}

  /**
   * Helper to create or update a tracked value.
   */
  public createTrackedValue<T>(value: T): TrackedValue<T> {
    return {
      value,
      updatedAt: Date.now(),
      deviceId: this.deviceId,
    };
  }

  /**
   * Merges local settings with remote settings.
   * For each key, it picks the TrackedValue with the highest `updatedAt` timestamp.
   * If a value only exists on one side, it is kept.
   * 
   * Returns an object containing the `mergedSettings` and a boolean `needsUpload`
   * which is true if the local settings had newer data than remote.
   */
  public mergeSettings(local: SharedSettings, remote: SharedSettings): { merged: SharedSettings; needsUpload: boolean } {
    const merged: SharedSettings = {};
    let needsUpload = false;

    // Get all unique keys from both local and remote
    const allKeys = new Set([...Object.keys(local), ...Object.keys(remote)]);

    for (const key of allKeys) {
      const localVal = local[key];
      const remoteVal = remote[key];

      if (localVal && remoteVal) {
        if (localVal.updatedAt > remoteVal.updatedAt) {
          merged[key] = localVal;
          needsUpload = true; // We have newer data to push
        } else if (remoteVal.updatedAt > localVal.updatedAt) {
          merged[key] = remoteVal;
        } else {
          // Exactly the same timestamp, fallback to keeping remote to avoid unnecessary uploads
          merged[key] = remoteVal;
        }
      } else if (localVal && !remoteVal) {
        merged[key] = localVal;
        needsUpload = true; // Local has a new setting remote doesn't know about
      } else if (remoteVal && !localVal) {
        merged[key] = remoteVal;
      }
    }

    return { merged, needsUpload };
  }

  /**
   * Performs a full sync operation:
   * 1. Fetches remote settings from Moodle Calendar.
   * 2. Merges with provided local settings based on timestamps.
   * 3. Uploads back to Moodle if local had newer changes.
   * 4. Returns the final merged settings state.
   */
  public async sync(localSettings: SharedSettings): Promise<SharedSettings> {
    let remoteSettings: SharedSettings | null = null;
    
    try {
      remoteSettings = await this.moodleClient.loadNoodleSettings();
    } catch (e) {
      console.warn('[SettingsSyncManager] Failed to load remote settings, assuming empty.', e);
    }

    if (!remoteSettings) {
      // Remote is empty, so we push our local settings as the source of truth
      if (Object.keys(localSettings).length > 0) {
        await this.moodleClient.saveNoodleSettings(JSON.stringify(localSettings));
      }
      return localSettings;
    }

    const { merged, needsUpload } = this.mergeSettings(localSettings, remoteSettings);

    if (needsUpload) {
      await this.moodleClient.saveNoodleSettings(JSON.stringify(merged));
    }

    return merged;
  }
}
