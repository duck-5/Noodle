export interface TauTrackerConfigV1 {
  version: 1;
  trackedCourseIds: number[];
  coursesColorMap: Record<number, string>;
  coursesCustomNames: Record<number, string>;
  theme: 'dark' | 'noodle';
  language: 'he' | 'en';
  googleTasks?: {
    enabled: boolean;
    listName: string;
  };
}

export function validateTauTrackerConfig(data: any): { isValid: boolean; error?: string } {
  if (!data || typeof data !== 'object') {
    return { isValid: false, error: 'Config must be an object' };
  }
  if (data.version !== 1) {
    return { isValid: false, error: 'Unsupported schema version' };
  }
  if (!Array.isArray(data.trackedCourseIds)) {
    return { isValid: false, error: 'trackedCourseIds must be an array' };
  }
  if (typeof data.coursesColorMap !== 'object' || data.coursesColorMap === null) {
    return { isValid: false, error: 'coursesColorMap must be an object' };
  }
  if (typeof data.coursesCustomNames !== 'object' || data.coursesCustomNames === null) {
    return { isValid: false, error: 'coursesCustomNames must be an object' };
  }
  if (!['dark', 'noodle'].includes(data.theme)) {
    return { isValid: false, error: 'Invalid theme' };
  }
  if (!['he', 'en'].includes(data.language)) {
    return { isValid: false, error: 'Invalid language' };
  }
  return { isValid: true };
}

describe('Category 10: Backup & Restore (Configuration JSON)', () => {
  describe('TC-BCK-01: Export TauTrackerConfig-v1 JSON', () => {
    it('should generate valid payload matching TauTrackerConfig-v1 schema', () => {
      const exportPayload: TauTrackerConfigV1 = {
        version: 1,
        trackedCourseIds: [101, 102],
        coursesColorMap: { 101: '#3b82f6', 102: '#10b981' },
        coursesCustomNames: { 101: 'לינארית', 102: 'מבני נתונים' },
        theme: 'noodle',
        language: 'he',
        googleTasks: {
          enabled: true,
          listName: 'Noodle',
        },
      };

      const validation = validateTauTrackerConfig(exportPayload);
      expect(validation.isValid).toBe(true);
      expect(exportPayload.version).toBe(1);
    });
  });

  describe('TC-BCK-02: Import & Validate Backup JSON', () => {
    it('should reject invalid or corrupt JSON payloads without crashing', () => {
      expect(validateTauTrackerConfig(null).isValid).toBe(false);
      expect(validateTauTrackerConfig({ foo: 'bar' }).isValid).toBe(false);
      expect(validateTauTrackerConfig({ version: 2 }).isValid).toBe(false);
      expect(
        validateTauTrackerConfig({
          version: 1,
          trackedCourseIds: 'not-an-array',
          coursesColorMap: {},
          coursesCustomNames: {},
          theme: 'noodle',
          language: 'he',
        }).isValid
      ).toBe(false);
    });

    it('should successfully validate well-formed configuration import', () => {
      const validImport = {
        version: 1,
        trackedCourseIds: [201],
        coursesColorMap: { 201: '#ff007f' },
        coursesCustomNames: { 201: 'אלגוריתמים' },
        theme: 'dark',
        language: 'en',
      };

      const validation = validateTauTrackerConfig(validImport);
      expect(validation.isValid).toBe(true);
      expect(validation.error).toBeUndefined();
    });
  });
});
