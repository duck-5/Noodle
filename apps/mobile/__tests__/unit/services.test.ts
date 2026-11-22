import React from 'react';
import * as RN from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import type { Assignment } from '@tautracker/moodle-client';
import {
  applyLocalSettingsPatch,
  exportConfigBackupJson,
  getLocalSettingsSnapshot,
  importConfigBackupJson,
} from '@/services/settingsSyncService';
import { scheduleDeadlineNotifications } from '@/services/notifications';
import {
  sanitizeFileName,
  isFileCachedLocally,
  downloadMoodleFile,
  openMoodleFile,
  shareMoodleFile,
} from '@/services/fileDownloadService';
import { getEffectiveRedirectUri } from '@/services/googleTasks';
import { getTrackedCourseIdsFromDb } from '@/services/backgroundSync';
import { stripHtmlToPlainText } from '@/services/htmlUtils';
import { Colors, getReadableTextColor } from '@/constants/theme';
import { getSubjectFilesForAssignment } from '@/components/MoodleFileRow';
import {
  fetchMoodleMobileTokenViaLaunchNative,
  hasPanoptoAuthCookieNative,
  isNoodleNativeAvailable,
  saveFileWithSystemExplorerNative,
} from '@/services/nativeBridge';

declare const __dirname: string;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodeFs = require('fs') as { readFileSync: (filePath: string, encoding: string) => string };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodePath = require('path') as { resolve: (...segments: string[]) => string };

// In-memory mock preference store for unit testing services in isolation
const mockPrefs = new Map<string, string>();
const mockTrackedCourses: { moodle_id: number; name: string; color: string; is_active: number }[] = [];
let mockStoredToken: string | null = null;
const mockScheduledNotifications: { content: { title: string; body: string; data?: any }; trigger: any }[] = [];
const mockCancelAll = jest.fn(async () => {
  mockScheduledNotifications.length = 0;
});
const mockScheduleNotificationAsync = jest.fn(async (req: any) => {
  mockScheduledNotifications.push(req);
  return 'notif-1';
});

jest.mock('@/services/database', () => ({
  getDb: jest.fn(() => ({
    runSync: jest.fn(),
    getFirstSync: jest.fn(),
    getAllSync: jest.fn(() => []),
    withTransactionSync: (fn: () => void) => fn(),
  })),
  runInTransaction: jest.fn((fn: () => any) => fn()),
  getPreference: jest.fn((key: string) => (mockPrefs.has(key) ? mockPrefs.get(key)! : null)),
  setPreference: jest.fn((key: string, value: string) => {
    mockPrefs.set(key, value);
  }),
  removePreference: jest.fn((key: string) => {
    mockPrefs.delete(key);
  }),
  getTrackedCourses: jest.fn((activeOnly?: boolean) =>
    activeOnly ? mockTrackedCourses.filter((c) => c.is_active === 1) : [...mockTrackedCourses]
  ),
  saveTrackedCourses: jest.fn(),
  saveSyncResultToDatabase: jest.fn(),
  loadSyncResultFromDatabase: jest.fn(() => ({
    assignments: [],
    files: [],
    meetings: [],
    recordings: [],
    errors: [],
    syncedAt: '',
  })),
  getRecordings: jest.fn(() => []),
  getCourseStaffMap: jest.fn(() => ({})),
  getGradeSummaries: jest.fn(() => ({})),
  clearUserTablesOnLogout: jest.fn(),
}));

jest.mock('@/services/auth', () => ({
  getStoredToken: jest.fn(async () => mockStoredToken),
  saveToken: jest.fn(async (tok: string | null) => {
    mockStoredToken = tok;
  }),
  getStoredSesskey: jest.fn(async () => null),
  saveSesskey: jest.fn(async () => {}),
  getStoredCredentials: jest.fn(async () => null),
  saveCredentials: jest.fn(async () => {}),
  clearCredentials: jest.fn(async () => {}),
  loginTauSso: jest.fn(async () => 'mock-sso-token'),
  renewTokenSilently: jest.fn(async () => null),
  logoutAndTeardownSession: jest.fn(async () => {
    mockStoredToken = null;
  }),
}));

const topLevelDbMock = jest.requireMock('@/services/database');
const topLevelAuthMock = jest.requireMock('@/services/auth');

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  cancelAllScheduledNotificationsAsync: (...args: any[]) => (mockCancelAll as any)(...args),
  scheduleNotificationAsync: (...args: any[]) => (mockScheduleNotificationAsync as any)(...args),
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

describe('settingsSyncService (v4.1 parity & TauTrackerConfig-v1 backup)', () => {
  beforeEach(() => {
    mockPrefs.clear();
    mockTrackedCourses.length = 0;
    mockStoredToken = null;
  });

  it('returns complete v4.1 defaults in getLocalSettingsSnapshot and applies patches cleanly', () => {
    const defaults = getLocalSettingsSnapshot();
    expect(defaults.theme).toBe('noodle');
    expect(defaults.themeTimeDayStart).toBe(7);
    expect(defaults.themeTimeDayEnd).toBe(17);
    expect(defaults.language).toBe('he');
    expect(defaults.dueDateGreenDays).toBe(7);
    expect(defaults.dueDateYellowDays).toBe(3);
    expect(defaults.syncIntervalMinutes).toBe(60);
    expect(defaults.notificationsEnabled).toBe(true);
    expect(defaults.panoptoEnabled).toBe(false);
    expect(defaults.showPanoptoFolderOverride).toBe(false);
    expect(defaults.showEmptySections).toBe(false);
    expect(defaults.semesterProgressMode).toBe('total');
    expect(defaults.coursesViewMode).toBe('cards');

    applyLocalSettingsPatch(
      {
        theme: 'time',
        themeTimeDayStart: 8,
        themeTimeDayEnd: 18,
        language: 'en',
        dueDateGreenDays: 10,
        dueDateYellowDays: 4,
        syncIntervalMinutes: 30,
        panoptoEnabled: true,
        showPanoptoFolderOverride: true,
        showEmptySections: true,
        semesterProgressMode: 'lectures',
        coursesViewMode: 'list',
        trackedCourseIds: [101],
        coursesColorMap: { 101: '#c27044', 202: '#48785e' },
        coursesCustomNames: { 101: 'Algorithms', 202: 'Inactive Course Nickname' },
        trackedPanoptoHosts: { 101: ['Prof. Smith'] },
        coursesPanoptoStaff: { 101: [{ panoptoName: 'Prof. Smith', role: 'Lecture' }] },
        coursesPanoptoMap: { 101: 'd971b682-0000-4000-8000-000000000001' },
        watchedRecordings: ['rec-1'],
        hiddenRecordings: ['rec-2'],
      },
      false
    );

    const updated = getLocalSettingsSnapshot();
    expect(updated.theme).toBe('time');
    expect(updated.themeTimeDayStart).toBe(8);
    expect(updated.themeTimeDayEnd).toBe(18);
    expect(updated.language).toBe('en');
    expect(updated.dueDateGreenDays).toBe(10);
    expect(updated.dueDateYellowDays).toBe(4);
    expect(updated.syncIntervalMinutes).toBe(30);
    expect(updated.panoptoEnabled).toBe(true);
    expect(updated.showPanoptoFolderOverride).toBe(true);
    expect(updated.showEmptySections).toBe(true);
    expect(updated.semesterProgressMode).toBe('lectures');
    expect(updated.coursesViewMode).toBe('list');
    // Inactive course 202 color and nickname are preserved in preferences JSON
    expect(updated.coursesColorMap).toEqual({ 101: '#c27044', 202: '#48785e' });
    expect(updated.coursesCustomNames).toEqual({ 101: 'Algorithms', 202: 'Inactive Course Nickname' });
    expect(updated.trackedPanoptoHosts).toEqual({ 101: ['Prof. Smith'] });
    expect(updated.coursesPanoptoMap).toEqual({ 101: 'd971b682-0000-4000-8000-000000000001' });
    expect(updated.watchedRecordings).toEqual(['rec-1']);
    expect(updated.hiddenRecordings).toEqual(['rec-2']);
    expect(mockPrefs.get('settings_timestamps')).toBeTruthy();
  });

  it('exports TauTrackerConfig-v1 JSON and imports with data.settings.coursesColorMap and both c.id and c.moodle_id', async () => {
    applyLocalSettingsPatch(
      {
        theme: 'coffee',
        language: 'en',
        trackedCourseIds: [1001, 1002],
        coursesColorMap: { 1001: '#8b5cf6', 1002: '#10b981' },
        coursesCustomNames: { 1001: 'Linear Algebra' },
        panoptoEnabled: true,
      },
      false
    );

    const exportedJson = await exportConfigBackupJson();
    const exported = JSON.parse(exportedJson);
    expect(exported.version).toBe('TauTrackerConfig-v1');
    expect(exported.trackedCourseIds).toEqual([1001, 1002]);
    expect(exported.settings.coursesColorMap).toEqual({ '1001': '#8b5cf6', '1002': '#10b981' });
    expect(exported.settings.coursesCustomNames).toEqual({ '1001': 'Linear Algebra' });

    // Clear local state before testing import
    mockPrefs.clear();

    // Extension-style backup where colors/names live in data.settings.* and courses use c.id
    const extensionBackup = JSON.stringify({
      version: 'TauTrackerConfig-v1',
      trackedCourseIds: [501, 502, 999],
      wstoken: 'imported-token-123',
      settings: {
        theme: 'dark',
        language: 'en',
        assignmentGreenDaysThreshold: 9,
        assignmentYellowDaysThreshold: 2,
        panoptoEnabled: true,
        showEmptySections: true,
        coursesColorMap: { 501: '#ef4444', 502: '#3b82f6' },
        coursesCustomNames: { 501: 'Calculus 1', 502: 'Discrete Math' },
        hiddenZoomMeetings: ['Course:123Topic'],
      },
    });

    const result = await importConfigBackupJson(extensionBackup, [
      { id: 501, name: 'Calculus' },
      { id: 9001, moodle_id: 502, name: 'Discrete' },
    ]);

    expect(result.matchedCourseIds).toEqual([501, 502]);
    expect(result.importedCount).toBeGreaterThan(0);

    const imported = getLocalSettingsSnapshot();
    expect(imported.theme).toBe('dark');
    expect(imported.language).toBe('en');
    expect(imported.dueDateGreenDays).toBe(9);
    expect(imported.dueDateYellowDays).toBe(2);
    expect(imported.panoptoEnabled).toBe(true);
    expect(imported.showEmptySections).toBe(true);
    expect(imported.trackedCourseIds).toEqual([501, 502]);
    expect(imported.coursesColorMap).toEqual({ 501: '#ef4444', 502: '#3b82f6' });
    expect(imported.coursesCustomNames).toEqual({ 501: 'Calculus 1', 502: 'Discrete Math' });
    expect(imported.hiddenZoomMeetings).toEqual(['Course:123Topic']);
    expect(mockStoredToken).toBe('imported-token-123');
  });

  it('supports legacy top-level courseColors/courseNicknames and rejects malformed backups', async () => {
    const legacyBackup = JSON.stringify({
      version: 'TauTrackerConfig-v1',
      trackedCourseIds: [701],
      courseColors: { 701: '#22c55e' },
      courseNicknames: { 701: 'Legacy Course' },
      settings: {
        theme: 'noodle',
      },
    });

    const res = await importConfigBackupJson(legacyBackup, [{ id: 701 }]);
    expect(res.matchedCourseIds).toEqual([701]);
    const snap = getLocalSettingsSnapshot();
    expect(snap.coursesColorMap[701]).toBe('#22c55e');
    expect(snap.coursesCustomNames[701]).toBe('Legacy Course');

    await expect(importConfigBackupJson('{not json')).rejects.toThrow(/Invalid JSON/i);
    await expect(importConfigBackupJson(JSON.stringify({ version: 'Other-v2' }))).rejects.toThrow(
      /Unsupported configuration version/i
    );
  });
});

describe('notifications (emoji-free, localized he/en, respects notifications_enabled)', () => {
  const emojiRegex = /\p{Extended_Pictographic}/u;

  beforeEach(() => {
    mockPrefs.clear();
    mockScheduledNotifications.length = 0;
    mockCancelAll.mockClear();
    mockScheduleNotificationAsync.mockClear();
  });

  it('contains zero Unicode emojis or alarm clock characters in notifications.ts source', () => {
    const srcPath = nodePath.resolve(__dirname, '../../src/services/notifications.ts');
    const source = nodeFs.readFileSync(srcPath, 'utf8');
    expect(source).not.toContain('⏰');
    expect(emojiRegex.test(source)).toBe(false);
  });

  it('schedules localized Hebrew and English 24h & 1h reminders with zero emojis', async () => {
    const deadlineFuture = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const sampleAssignments: Assignment[] = [
      {
        id: 1,
        cmid: 11,
        courseId: 101,
        courseName: 'Algorithms',
        name: 'Homework 1',
        status: 'Assigned',
        deadline: deadlineFuture,
        opened: null,
        link: 'https://moodle.tau.ac.il/mod/assign/view.php?id=11',
        grade: null,
        gradeMax: 100,
        uid: 'assign:1',
      },
    ];

    // English
    mockPrefs.set('language', 'en');
    await scheduleDeadlineNotifications(sampleAssignments);
    expect(mockScheduledNotifications.length).toBe(2);
    for (const req of mockScheduledNotifications) {
      expect(emojiRegex.test(req.content.title)).toBe(false);
      expect(emojiRegex.test(req.content.body)).toBe(false);
    }
    expect(mockScheduledNotifications[0].content.title).toBe('Assignment due tomorrow');
    expect(mockScheduledNotifications[1].content.title).toBe('Due in 1 hour');

    // Hebrew
    mockScheduledNotifications.length = 0;
    mockPrefs.set('language', 'he');
    await scheduleDeadlineNotifications(sampleAssignments);
    expect(mockScheduledNotifications.length).toBe(2);
    for (const req of mockScheduledNotifications) {
      expect(emojiRegex.test(req.content.title)).toBe(false);
      expect(emojiRegex.test(req.content.body)).toBe(false);
    }
    expect(mockScheduledNotifications[0].content.title).toContain('מחר');
    expect(mockScheduledNotifications[1].content.title).toContain('שעה');
  });

  it('cancels notifications and skips scheduling when notifications_enabled is false', async () => {
    mockPrefs.set('notifications_enabled', 'false');
    const deadlineFuture = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

    await scheduleDeadlineNotifications([
      {
        id: 2,
        cmid: 22,
        courseId: 101,
        courseName: 'Algorithms',
        name: 'Homework 2',
        status: 'Assigned',
        deadline: deadlineFuture,
        opened: null,
        link: 'https://moodle.tau.ac.il/mod/assign/view.php?id=22',
        grade: null,
        gradeMax: 100,
        uid: 'assign:2',
      },
    ]);

    expect(mockCancelAll).toHaveBeenCalledTimes(1);
    expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
  });
});

describe('safe module imports & helpers in Jest', () => {
  it('safely loads fileDownloadService (download/open/share + Android native/SAF), googleTasks, and backgroundSync helpers', async () => {
    expect(sanitizeFileName('hw1:test/file?.pdf')).toBe('hw1_test_file_.pdf');
    expect(sanitizeFileName('[Lecture 1] Intro {2026}.pdf')).not.toMatch(/[\[\]{}]/);
    expect(typeof isFileCachedLocally('missing.pdf')).toBe('boolean');
    expect(typeof downloadMoodleFile).toBe('function');
    expect(typeof openMoodleFile).toBe('function');
    expect(typeof shareMoodleFile).toBe('function');

    expect(stripHtmlToPlainText('<p>Hello<br/><b>World</b> &amp; Co.</p>')).toBe('Hello\nWorld & Co.');
    expect(Colors.coffee.onPrimary).toBe('#14100d');
    expect(getReadableTextColor('#ffffff')).toBe('#14100d');
    expect(getReadableTextColor('#1e1b4b')).toBe('#ffffff');

    const subjectFiles = getSubjectFilesForAssignment(
      { id: 1, cmid: 1, courseId: 101, courseName: 'Algo', name: 'HW1', status: 'Assigned', deadline: null, opened: null, link: '', grade: null, gradeMax: 100, uid: 'assign:1', sectionName: 'Week 1' } as Assignment,
      [
        { id: 1, courseId: 101, sectionName: 'Week 1', fileName: 'slides.pdf', fileUrl: 'https://moodle.tau.ac.il/a.pdf' },
        { id: 2, courseId: 101, sectionName: 'Week 1', fileName: 'inside_folder.pdf', fileUrl: 'https://moodle.tau.ac.il/b.pdf', folderId: 55 },
        { id: 3, courseId: 101, sectionName: 'Week 1', fileName: 'slides.pdf', fileUrl: 'https://moodle.tau.ac.il/a.pdf' },
      ] as any
    );
    expect(subjectFiles).toHaveLength(1);
    expect(subjectFiles[0].fileName).toBe('slides.pdf');

    expect(getEffectiveRedirectUri('510394355212-custom.apps.googleusercontent.com')).toContain(
      'oauth2redirect'
    );
    const ids = await getTrackedCourseIdsFromDb();
    expect(Array.isArray(ids)).toBe(true);

    expect(isNoodleNativeAvailable()).toBe(false);
    expect(await hasPanoptoAuthCookieNative()).toBe(false);
    expect(await saveFileWithSystemExplorerNative('file:///tmp/a.pdf', 'a.pdf', 'application/pdf')).toEqual({
      saved: false,
      unsupported: true,
    });
    expect(await fetchMoodleMobileTokenViaLaunchNative({ username: 'u', idNumber: '1', password: 'p' })).toEqual({
      unsupported: true,
    });
  });
});

describe('E10: SQLite transaction re-entrancy (database.ts + settingsSyncService.ts)', () => {
  it('prevents nested withTransactionSync calls across saveTrackedCourses, saveSyncResultToDatabase, clearUserTablesOnLogout, and applyLocalSettingsPatch', () => {
    try {
      jest.isolateModules(() => {
        jest.unmock('@/services/database');
        let inTx = false;
        let txCount = 0;
        const prefStore = new Map<string, string>();

        const strictDb = {
          execSync: jest.fn(),
          runSync: jest.fn((sql: string, params?: any[]) => {
            if (sql.includes('INSERT OR REPLACE INTO preferences') && Array.isArray(params)) {
              prefStore.set(String(params[0]), String(params[1]));
            } else if (sql.includes('DELETE FROM preferences') && Array.isArray(params)) {
              prefStore.delete(String(params[0]));
            }
          }),
          getFirstSync: jest.fn((sql: string, params?: any[]) => {
            if (sql.includes('SELECT value FROM preferences') && Array.isArray(params)) {
              const val = prefStore.get(String(params[0]));
              return val !== undefined ? { value: val } : null;
            }
            return null;
          }),
          getAllSync: jest.fn((sql: string) => {
            if (sql.includes('PRAGMA table_info(preferences)')) {
              return [{ name: 'key' }, { name: 'value' }];
            }
            if (sql.includes('SELECT key, value FROM preferences')) {
              return Array.from(prefStore.entries()).map(([key, value]) => ({ key, value }));
            }
            return [];
          }),
          withTransactionSync: jest.fn((fn: () => void) => {
            if (inTx) {
              throw new Error(
                "Call to function 'NativeDatabase.execSync' has been rejected. Caused by: cannot start a transaction within a transaction"
              );
            }
            inTx = true;
            txCount += 1;
            try {
              fn();
            } finally {
              inTx = false;
            }
          }),
        };

        jest.doMock('expo-sqlite', () => ({
          openDatabaseSync: jest.fn(() => strictDb),
        }));

        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const dbMod = require('@/services/database');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const settingsMod = require('@/services/settingsSyncService');

        dbMod.runInTransaction(() => {
          dbMod.saveTrackedCourses([{ moodle_id: 101, name: 'Algo', is_active: 1 }], { merge: false });
          dbMod.saveSyncResultToDatabase(
            {
              courses: [],
              sections: [],
              folders: [],
              links: [],
              announcements: [],
              gradeSummaries: {},
              assignments: [],
              files: [],
              meetings: [],
              recordings: [],
              courseStaff: {},
              errors: [],
              syncedAt: '2026-11-21T00:00:00Z',
            },
            { activeCourseIds: [101], panoptoEnabled: true }
          );
          dbMod.clearUserTablesOnLogout();
        });
        expect(txCount).toBe(1);

        const txCountBeforePatch = txCount;
        settingsMod.applyLocalSettingsPatch(
          {
            trackedCourseIds: [101, 202],
            coursesColorMap: { 101: '#E58C7A', 202: '#8EAED6' },
          },
          false
        );
        expect(txCount).toBe(txCountBeforePatch + 1);
        expect(strictDb.withTransactionSync).toHaveBeenCalledTimes(2);
      });
    } finally {
      jest.doMock('@/services/database', () => topLevelDbMock);
    }
  });
});

describe('C1: discoveredPanoptoFolders persistence preserving manual overrides', () => {
  beforeEach(() => {
    mockPrefs.clear();
    mockTrackedCourses.length = 0;
    mockStoredToken = '0123456789abcdef0123456789abcdef';
  });

  it('merges discovered Panopto folders into coursesPanoptoMap while keeping existing manual overrides', async () => {
    applyLocalSettingsPatch(
      {
        panoptoEnabled: true,
        trackedCourseIds: [101, 202, 303],
        coursesPanoptoMap: { 101: 'manual-folder-uuid' },
      },
      false
    );

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { persistDiscoveredPanoptoFolders } = require('@/services/backgroundSync');
    const mergedDirect = persistDiscoveredPanoptoFolders({
      101: 'auto-override-attempt',
      202: 'discovered-uuid-202',
    });

    expect(mergedDirect).toEqual({
      101: 'manual-folder-uuid',
      202: 'discovered-uuid-202',
    });
    expect(getLocalSettingsSnapshot().coursesPanoptoMap).toEqual({
      101: 'manual-folder-uuid',
      202: 'discovered-uuid-202',
    });

    await jest.isolateModulesAsync(async () => {
      jest.doMock('@tautracker/moodle-client', () => {
        const actual = jest.requireActual('@tautracker/moodle-client');
        return {
          ...actual,
          runSync: jest.fn(async (_t: string, _ids: number[], _p: any, _e: any, _c: any, _s: any, _sk: any, onPartial: any) => {
            onPartial?.({
              courses: [],
              assignments: [],
              files: [],
              meetings: [],
              recordings: [],
              discoveredPanoptoFolders: {
                101: 'auto-partial-101',
                250: 'discovered-uuid-250',
              },
            });
            return {
              courses: [],
              sections: [],
              folders: [],
              links: [],
              announcements: [],
              gradeSummaries: {},
              assignments: [],
              files: [],
              meetings: [],
              recordings: [],
              courseStaff: {},
              errors: [],
              syncedAt: '2026-11-21T00:00:00Z',
              discoveredPanoptoFolders: {
                101: 'auto-final-101',
                303: 'discovered-uuid-303',
              },
            };
          }),
        };
      });

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const bgSync = require('@/services/backgroundSync');
      await bgSync.triggerForegroundSync();
    });

    expect(getLocalSettingsSnapshot().coursesPanoptoMap).toEqual({
      101: 'manual-folder-uuid',
      202: 'discovered-uuid-202',
      250: 'discovered-uuid-250',
      303: 'discovered-uuid-303',
    });
  });
});

describe('C3: saveFileWithSystemExplorerNative in fileDownloadService.ts', () => {
  it('handles saved, cancelled (zero MediaStore/SAF/Share fallback + temp ZIP cleanup), and unsupported fallback for files and ZIPs', async () => {
    await jest.isolateModulesAsync(async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const RN = require('react-native');
      const originalPlatformOs = RN.Platform.OS;
      RN.Platform.OS = 'android';

      try {
        const mockSaveExplorer = jest.fn();
        const mockSaveMediaStore = jest.fn();
        const mockShareAsync = jest.fn(async () => {});
        const mockZipDelete = jest.fn();
        const mockDownloadFolderAsZip = jest.fn(async () => new Uint8Array([80, 75, 3, 4]));

        jest.doMock('@/services/nativeBridge', () => ({
          openContentUriNative: jest.fn(async () => ({ opened: true })),
          saveFileWithSystemExplorerNative: mockSaveExplorer,
          saveToMediaStoreDownloadsNative: mockSaveMediaStore,
        }));
        jest.doMock('expo-sharing', () => ({
          isAvailableAsync: jest.fn(async () => true),
          shareAsync: mockShareAsync,
        }));
        jest.doMock('@tautracker/moodle-client', () => {
          const actual = jest.requireActual('@tautracker/moodle-client');
          return {
            ...actual,
            downloadFolderAsZip: mockDownloadFolderAsZip,
          };
        });

        let cachedFileExists = true;
        const MockFile = jest.fn().mockImplementation((_parent: any, name: string) => ({
          exists: name.endsWith('.zip') ? true : cachedFileExists,
          size: 256,
          uri: `file:///cache/${name}`,
          create: jest.fn(),
          write: jest.fn(),
          delete: mockZipDelete,
          open: jest.fn(() => ({ writeBytes: jest.fn(), close: jest.fn() })),
        }));
        const MockDirectory = jest.fn().mockImplementation((_parent: any, name: string) => ({
          exists: true,
          uri: `file:///cache/${name}`,
          create: jest.fn(),
        }));

        jest.doMock('expo-file-system', () => ({
          Paths: { cache: { uri: 'file:///cache' } },
          Directory: MockDirectory,
          File: MockFile,
          FileMode: { WriteOnly: 'w' },
        }));

        mockStoredToken = '0123456789abcdef0123456789abcdef';
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fd = require('@/services/fileDownloadService');

        const fileItem = {
          id: 1,
          file_name: 'lecture1.pdf',
          file_url: 'https://moodle.tau.ac.il/mod/resource/view.php?id=1',
          mime_type: 'application/pdf',
        };
        const folderItem = {
          id: 77,
          courseId: 101,
          name: 'Slides',
          files: [],
        };

        // 1. saved: true
        mockSaveExplorer.mockResolvedValueOnce({ saved: true, uri: 'content://doc/1' });
        const fileSaved = await fd.downloadMoodleFile(fileItem, undefined, { action: 'download' });
        expect(fileSaved).toEqual({
          success: true,
          uri: 'content://doc/1',
          savedToDownloads: true,
          fileName: 'lecture1.pdf',
        });
        expect(mockSaveMediaStore).not.toHaveBeenCalled();
        expect(mockShareAsync).not.toHaveBeenCalled();

        // 2. cancelled: true -> NO fallback to MediaStore, SAF, or Sharing
        mockSaveExplorer.mockResolvedValueOnce({ saved: false, cancelled: true });
        const fileCancelled = await fd.downloadMoodleFile(fileItem, undefined, { action: 'download' });
        expect(fileCancelled).toEqual({
          success: true,
          cancelled: true,
          savedToDownloads: false,
          fileName: 'lecture1.pdf',
        });
        expect(mockSaveMediaStore).not.toHaveBeenCalled();
        expect(mockShareAsync).not.toHaveBeenCalled();

        // 3. cancelled: true on ZIP -> NO fallback + temp ZIP cleaned up
        mockSaveExplorer.mockResolvedValueOnce({ saved: false, cancelled: true });
        const zipCancelled = await fd.downloadMoodleFolderZip(folderItem);
        expect(zipCancelled).toEqual({
          success: true,
          cancelled: true,
          savedToDownloads: false,
          fileName: 'Slides.zip',
        });
        expect(mockZipDelete).toHaveBeenCalledTimes(1);
        expect(mockSaveMediaStore).not.toHaveBeenCalled();
        expect(mockShareAsync).not.toHaveBeenCalled();

        // 4. unsupported: true -> falls back to MediaStore
        mockSaveExplorer.mockResolvedValueOnce({ saved: false, unsupported: true });
        mockSaveMediaStore.mockResolvedValueOnce('content://media/external/downloads/10');
        const fileFallback = await fd.downloadMoodleFile(fileItem, undefined, { action: 'download' });
        expect(fileFallback).toEqual({
          success: true,
          uri: 'content://media/external/downloads/10',
          savedToDownloads: true,
          fileName: 'lecture1.pdf',
        });

        mockSaveExplorer.mockResolvedValueOnce({ saved: false, unsupported: true });
        mockSaveMediaStore.mockResolvedValueOnce('content://media/external/downloads/11');
        const zipFallback = await fd.downloadMoodleFolderZip(folderItem);
        expect(zipFallback).toEqual({
          success: true,
          uri: 'content://media/external/downloads/11',
          savedToDownloads: true,
          fileName: 'Slides.zip',
        });
        expect(mockZipDelete).toHaveBeenCalledTimes(2);
        expect(mockShareAsync).not.toHaveBeenCalled();

        // 5. non-unsupported error -> returns failure without fallback
        mockSaveExplorer.mockResolvedValueOnce({
          saved: false,
          cancelled: false,
          unsupported: false,
          error: 'Disk full',
        });
        const zipErr = await fd.downloadMoodleFolderZip(folderItem);
        expect(zipErr).toEqual({
          success: false,
          savedToDownloads: false,
          fileName: 'Slides.zip',
          error: 'Disk full',
        });
        expect(mockZipDelete).toHaveBeenCalledTimes(3);
        expect(mockShareAsync).not.toHaveBeenCalled();

        // 6. unsupported + MediaStore/SAF fail -> sharing.shareAsync succeeds AND cleans up temp ZIP
        mockSaveExplorer.mockResolvedValueOnce({ saved: false, unsupported: true });
        mockSaveMediaStore.mockResolvedValueOnce(null);
        const zipShared = await fd.downloadMoodleFolderZip(folderItem);
        expect(zipShared).toEqual({
          success: true,
          uri: 'file:///cache/Slides.zip',
          savedToDownloads: false,
          fileName: 'Slides.zip',
        });
        expect(mockShareAsync).toHaveBeenCalledTimes(1);
        expect(mockZipDelete).toHaveBeenCalledTimes(4);

        // 7. unsupported + MediaStore/SAF fail + sharing unavailable -> error return AND cleans up temp ZIP
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const sharingMod = require('expo-sharing');
        sharingMod.isAvailableAsync.mockResolvedValueOnce(false);
        mockSaveExplorer.mockResolvedValueOnce({ saved: false, unsupported: true });
        mockSaveMediaStore.mockResolvedValueOnce(null);
        const zipNoSharing = await fd.downloadMoodleFolderZip(folderItem);
        expect(zipNoSharing).toEqual({
          success: false,
          uri: 'file:///cache/Slides.zip',
          savedToDownloads: false,
          fileName: 'Slides.zip',
          error: 'Sharing is not available on this device.',
        });
        expect(mockZipDelete).toHaveBeenCalledTimes(5);
      } finally {
        RN.Platform.OS = originalPlatformOs;
      }
    });
  });
});

describe('C5 & E7: renewTokenSilently native launch, isTokenAuthError, sessionExpired & SyncWindow lifecycle', () => {
  it('supports cookie-backed and credential-backed native token launch in renewTokenSilently', async () => {
    const validToken = 'fedcba9876543210fedcba9876543210';

    try {
      await jest.isolateModulesAsync(async () => {
        jest.unmock('@/services/auth');
        const secureMap = new Map<string, string>();
        const mockNativeLaunch = jest.fn();

        jest.doMock('expo-secure-store', () => ({
          getItemAsync: jest.fn(async (k: string) => secureMap.get(k) ?? null),
          setItemAsync: jest.fn(async (k: string, v: string) => {
            secureMap.set(k, v);
          }),
          deleteItemAsync: jest.fn(async (k: string) => {
            secureMap.delete(k);
          }),
        }));
        jest.doMock('@/services/nativeBridge', () => ({
          clearAllCookiesNative: jest.fn(async () => true),
          fetchMoodleMobileTokenViaLaunchNative: mockNativeLaunch,
        }));

        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const authMod = require('@/services/auth');

        // Cookie-backed native launch succeeds even with NO saved credentials
        mockNativeLaunch.mockResolvedValueOnce({ token: validToken });
        expect(await authMod.renewTokenSilently()).toBe(validToken);
        expect(mockNativeLaunch).toHaveBeenLastCalledWith(undefined);
        expect(await authMod.getStoredToken()).toBe(validToken);

        // Without credentials + unsupported native launch -> returns null
        mockNativeLaunch.mockResolvedValueOnce({ unsupported: true });
        expect(await authMod.renewTokenSilently()).toBeNull();

        // With saved credentials -> passes creds to native launch
        await authMod.saveCredentials('alice', '123456782', 'secret');
        mockNativeLaunch.mockResolvedValueOnce({ token: validToken });
        expect(await authMod.renewTokenSilently()).toBe(validToken);
        expect(mockNativeLaunch).toHaveBeenLastCalledWith({
          username: 'alice',
          idNumber: '123456782',
          password: 'secret',
        });

        // INVALID_CREDENTIALS short-circuits cleanly to null without JS fallback
        mockNativeLaunch.mockResolvedValueOnce({ errorCode: 'INVALID_CREDENTIALS' });
        expect(await authMod.renewTokenSilently()).toBeNull();
      });
    } finally {
      jest.doMock('@/services/auth', () => topLevelAuthMock);
    }
  });

  it('manages E7 SyncWindow visibility and C5 sessionExpired / reconnectWithToken in AppStateProvider', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { isTokenAuthError } = require('@/services/backgroundSync');
    expect(isTokenAuthError({ errorcode: 'invalidtoken', message: 'Invalid token' })).toBe(true);
    expect(isTokenAuthError({ errorcode: 'accessexception', message: 'Access exception' })).toBe(true);
    expect(isTokenAuthError({ context: 'Panopto Authentication', message: 'Panopto session authentication failed' })).toBe(false);

    await jest.isolateModulesAsync(async () => {
      jest.doMock('react', () => React);
      jest.doMock('react-native', () => RN);
      mockStoredToken = '0123456789abcdef0123456789abcdef';
      topLevelAuthMock.saveToken.mockClear();
      let pendingResolve: ((v: any) => void) | null = null;
      let pendingReject: ((e: any) => void) | null = null;
      const triggerForegroundSyncMock = jest.fn(
        () =>
          new Promise((resolve, reject) => {
            pendingResolve = resolve;
            pendingReject = reject;
          })
      );

      const mockRefreshPreferences = jest.fn();
      jest.doMock('@/hooks/use-preferences', () => ({
        usePreferences: () => ({
          refreshPreferences: mockRefreshPreferences,
        }),
      }));
      jest.doMock('@/services/backgroundSync', () => ({
        isTokenAuthError,
        registerBackgroundSyncTask: jest.fn(async () => {}),
        triggerForegroundSync: triggerForegroundSyncMock,
        unregisterBackgroundSyncTask: jest.fn(async () => {}),
      }));
      jest.doMock('@/services/settingsSyncService', () => {
        const actual = jest.requireActual('@/services/settingsSyncService');
        return {
          ...actual,
          performSettingsSync: jest.fn(async () => true),
          resetSettingsSyncThrottle: jest.fn(),
        };
      });

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { AppStateProvider, useAppState, useSyncProgress } = require('@/hooks/use-app-state');

      let latestAppState: any = null;
      let latestSyncProgress: any = null;
      function Probe() {
        latestAppState = useAppState();
        latestSyncProgress = useSyncProgress();
        return null;
      }

      const view = render(
        React.createElement(AppStateProvider, null, React.createElement(Probe, null))
      );

      try {
        await act(async () => {
          for (let i = 0; i < 10; i++) {
            await Promise.resolve();
          }
        });

        // Bootstrap started a sync; E7 requires syncWindowVisible to stay false on start
        expect(latestSyncProgress.isSyncing).toBe(true);
        expect(latestSyncProgress.syncWindowVisible).toBe(false);

        // Tapping Sync during active sync opens sync window
        act(() => {
          latestSyncProgress.openSyncWindow();
        });
        expect(latestSyncProgress.syncWindowVisible).toBe(true);

        // Resolving sync immediately hides sync window and resets collapse
        await act(async () => {
          pendingResolve?.({
            courses: [],
            sections: [],
            folders: [],
            links: [],
            announcements: [],
            gradeSummaries: {},
            assignments: [],
            files: [],
            meetings: [],
            recordings: [],
            courseStaff: {},
            errors: [],
            syncedAt: '2026-11-21T00:00:00Z',
          });
          for (let i = 0; i < 6; i++) {
            await Promise.resolve();
          }
        });
        expect(latestSyncProgress.isSyncing).toBe(false);
        expect(latestSyncProgress.syncWindowVisible).toBe(false);
        expect(latestSyncProgress.syncWindowCollapsed).toBe(false);

        // Calling openSyncWindow while idle is a no-op
        act(() => {
          latestSyncProgress.openSyncWindow();
        });
        expect(latestSyncProgress.syncWindowVisible).toBe(false);

        // C5: invalidtoken failure triggers sessionExpired = true
        act(() => {
          void latestAppState.triggerSync({ manual: true });
        });
        expect(latestSyncProgress.syncWindowVisible).toBe(false);

        await act(async () => {
          pendingReject?.({ errorcode: 'invalidtoken', message: 'Invalid token' });
          for (let i = 0; i < 6; i++) {
            await Promise.resolve();
          }
        });
        expect(latestAppState.sessionExpired).toBe(true);
        expect(latestSyncProgress.syncWindowVisible).toBe(false);

        act(() => {
          latestAppState.clearSessionExpired();
        });
        expect(latestAppState.sessionExpired).toBe(false);

        // Re-trigger expired error then recover with reconnectWithToken
        act(() => {
          void latestAppState.triggerSync({ manual: false });
        });
        await act(async () => {
          pendingReject?.({ errorcode: 'invalidtoken', message: 'Invalid token' });
          for (let i = 0; i < 6; i++) {
            await Promise.resolve();
          }
        });
        expect(latestAppState.sessionExpired).toBe(true);

        const newToken = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
        let reconnectPromise: Promise<void>;
        act(() => {
          reconnectPromise = latestAppState.reconnectWithToken(newToken);
        });
        await act(async () => {
          for (let i = 0; i < 6; i++) {
            await Promise.resolve();
          }
          pendingResolve?.({
            courses: [],
            sections: [],
            folders: [],
            links: [],
            announcements: [],
            gradeSummaries: {},
            assignments: [],
            files: [],
            meetings: [],
            recordings: [],
            courseStaff: {},
            errors: [],
            syncedAt: '2026-11-21T00:01:00Z',
          });
          await reconnectPromise!;
        });
        expect(topLevelAuthMock.saveToken).toHaveBeenCalledWith(newToken);
        expect(mockStoredToken).toBe(newToken);
        expect(latestAppState.sessionExpired).toBe(false);
      } finally {
        view.unmount();
      }
    });
  });
});

describe('M2 Iteration 2: SsoWebViewModal origin/visibleRef guards, SyncProgressBanner errors & backgroundSync guards', () => {
  beforeEach(() => {
    mockPrefs.clear();
    mockTrackedCourses.length = 0;
  });

  it('rejects non-positive/empty course IDs in persistDiscoveredPanoptoFolders and handles string inputs in isTokenAuthError', () => {
    jest.isolateModules(() => {
      jest.unmock('@/services/backgroundSync');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const settingsMod = require('@/services/settingsSyncService');
      settingsMod.applyLocalSettingsPatch(
        {
          panoptoEnabled: true,
          coursesPanoptoMap: { 101: 'manual-101' },
        },
        false
      );
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { persistDiscoveredPanoptoFolders, isTokenAuthError } = require('@/services/backgroundSync');
      const merged = persistDiscoveredPanoptoFolders({
        '': 'bad-empty',
        '   ': 'bad-ws',
        0: 'bad-zero',
        '-5': 'bad-neg',
        12.5: 'bad-float',
        202: '  valid-folder-202  ',
      } as any);

      expect(merged).toEqual({
        101: 'manual-101',
        202: 'valid-folder-202',
      });
      expect(settingsMod.getLocalSettingsSnapshot().coursesPanoptoMap).toEqual({
        101: 'manual-101',
        202: 'valid-folder-202',
      });

      expect(isTokenAuthError('Invalid token')).toBe(true);
      expect(isTokenAuthError('invalidtoken')).toBe(true);
      expect(isTokenAuthError('Panopto authentication failed')).toBe(false);
      expect(isTokenAuthError(null)).toBe(false);
    });
  });

  it('SyncProgressBanner shows dismissible error banner on non-auth error, hides when sessionExpired=true, and renders null on completion', async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock('react', () => React);
      jest.doMock('react-native', () => RN);
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { translate } = require('@/services/i18n');

      const state: any = {
        isSyncing: false,
        syncProgress: {
          percent: 50,
          stage: 'courses',
          message: 'Failed',
          coursesCompleted: 1,
          totalCourses: 2,
          activitiesCompleted: 0,
          totalActivities: 0,
        },
        syncError: 'Network offline',
        syncWindowVisible: false,
        syncWindowCollapsed: false,
        setSyncWindowCollapsed: jest.fn(),
        closeSyncWindow: jest.fn(),
        lastSyncedAt: null,
        settings: { panoptoEnabled: false },
        sessionExpired: false,
      };

      jest.doMock('@/hooks/use-app-state', () => ({
        useAppState: () => state,
        useSyncProgress: () => state,
      }));
      jest.doMock('@/hooks/use-preferences', () => ({
        usePreferences: () => ({
          theme: Colors.noodle,
          effectiveThemeName: 'noodle',
          language: 'en',
          isRtl: false,
          t: (key: string, params?: Record<string, string | number>) => translate(key, params, 'en'),
        }),
      }));
      jest.doMock('@/hooks/use-responsive-layout', () => ({
        useResponsiveLayout: () => ({ isLandscapeTablet: false, isShortLandscape: false }),
      }));
      jest.doMock('react-native-safe-area-context', () => ({
        useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
      }));
      jest.doMock('expo-router', () => ({
        useSegments: () => ['(tabs)'],
      }));

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { SyncProgressBanner } = require('@/components/SyncProgressBanner');

      // 1. Non-auth sync error with syncWindowVisible=false renders error banner and dismisses cleanly
      const view = render(React.createElement(SyncProgressBanner, null));
      try {
        expect(view.getByTestId('sync-progress-window')).toBeTruthy();
        expect(view.getByText('Network offline')).toBeTruthy();

        fireEvent.press(view.getByLabelText('Dismiss'));
        expect(view.queryByTestId('sync-progress-window')).toBeNull();
        expect(state.closeSyncWindow).toHaveBeenCalled();

        // 2. When sessionExpired=true, SyncProgressBanner stays hidden so _layout.tsx reconnect banner isn't duplicated
        state.syncError = 'Invalid token';
        state.sessionExpired = true;
        view.rerender(React.createElement(SyncProgressBanner, null));
        expect(view.queryByTestId('sync-progress-window')).toBeNull();

        // 3. Clean sync completion renders null immediately
        state.sessionExpired = false;
        state.syncError = null;
        state.syncProgress = {
          percent: 100,
          stage: 'complete',
          message: 'Complete',
          coursesCompleted: 2,
          totalCourses: 2,
          activitiesCompleted: 5,
          totalActivities: 5,
        };
        view.rerender(React.createElement(SyncProgressBanner, null));
        expect(view.queryByTestId('sync-progress-window')).toBeNull();
      } finally {
        view.unmount();
      }
    });
  });

  it('SsoWebViewModal guards credential injection by HTTPS + exact nidp.tau.ac.il host, avoids duplicate AllowBounce, and checks visibleRef after 250ms retry', async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock('react', () => React);
      jest.doMock('react-native', () => RN);
      const originalPlatformOs = RN.Platform.OS;
      RN.Platform.OS = 'android';

      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { translate } = require('@/services/i18n');
        let capturedWebViewProps: any = null;
        const mockInjectJs = jest.fn();

        jest.doMock('react-native-webview', () => {
          const WebViewMock = React.forwardRef((props: any, ref: any) => {
            capturedWebViewProps = props;
            React.useImperativeHandle(ref, () => ({
              injectJavaScript: mockInjectJs,
              reload: jest.fn(),
            }));
            return null;
          });
          WebViewMock.displayName = 'WebViewMock';
          return { WebView: WebViewMock, default: WebViewMock };
        });
        jest.doMock('react-native-safe-area-context', () => ({
          SafeAreaView: RN.View,
        }));
        jest.doMock('@/hooks/use-preferences', () => ({
          usePreferences: () => ({
            theme: Colors.noodle,
            language: 'en',
            isRtl: false,
            t: (key: string, params?: Record<string, string | number>) => translate(key, params, 'en'),
          }),
        }));

        const mockFlushCookies = jest.fn(async () => true);
        const mockHasPanoptoCookie = jest.fn(async () => false);
        const mockGetStoredCredentials = jest.fn(async () => ({
          username: 'alice',
          idNumber: '123456782',
          password: 'secret-password-xyz',
        }));
        topLevelAuthMock.getStoredCredentials.mockImplementation(mockGetStoredCredentials);
        jest.doMock('@/services/nativeBridge', () => ({
          flushCookiesNative: mockFlushCookies,
          hasPanoptoAuthCookieNative: mockHasPanoptoCookie,
          isNoodleNativeAvailable: () => true,
        }));
        jest.doMock('@/services/auth', () => ({
          ...topLevelAuthMock,
          getStoredCredentials: mockGetStoredCredentials,
          tryExtractTokenFromUrl: jest.fn(() => null),
        }));

        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { SsoWebViewModal } = require('@/components/SsoWebViewModal');
        const onClose = jest.fn();
        const onPanoptoSuccess = jest.fn();

        const view = render(
          React.createElement(SsoWebViewModal, {
            visible: true,
            mode: 'panopto',
            onClose,
            onPanoptoSuccess,
          })
        );

        try {
          await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
          });

          // 1. Untrusted / HTTP hosts -> skip injectJavaScript completely
          await act(async () => {
            capturedWebViewProps.onNavigationStateChange({ url: 'https://evil.com/login', loading: false });
            await capturedWebViewProps.onLoadEnd({ nativeEvent: { url: 'https://evil.com/login' } });
            await capturedWebViewProps.onLoadEnd({ nativeEvent: { url: 'http://nidp.tau.ac.il/nidp/idff/sso' } });
            await capturedWebViewProps.onLoadEnd({ nativeEvent: { url: 'https://nidp.tau.ac.il.evil.com/login' } });
          });
          expect(mockInjectJs).not.toHaveBeenCalled();

          // 2. Panopto host -> injects script with NULL credentials (never leaks plaintext creds to panopto.eu)
          await act(async () => {
            await capturedWebViewProps.onLoadEnd({
              nativeEvent: { url: 'https://tau.cloud.panopto.eu/Panopto/Pages/Auth/Login.aspx' },
            });
          });
          expect(mockInjectJs).toHaveBeenCalledTimes(1);
          const panoptoJs = mockInjectJs.mock.calls[0][0] as string;
          expect(panoptoJs).not.toContain('secret-password-xyz');
          expect(panoptoJs).not.toContain('123456782');
          expect(panoptoJs).toContain('AllowBounce=true');

          // Verify AllowBounce=true is NOT duplicated if already in window.location.search
          const scheduledTimers: { fn: () => void; ms: number }[] = [];
          const mockLoc = {
            hostname: 'tau.cloud.panopto.eu',
            protocol: 'https:',
            href: 'https://tau.cloud.panopto.eu/Panopto/Pages/Auth/Login.aspx?instance=Moodle2026&AllowBounce=true',
            search: '?instance=Moodle2026&AllowBounce=true',
          };
          const extBtn = { click: jest.fn() };
          const mockDoc = {
            querySelector: (sel: string) => (sel.includes('externalLoginButton') ? extBtn : null),
          };
          const mockWin: any = {
            location: mockLoc,
            Panopto: null,
            ReactNativeWebView: { postMessage: jest.fn() },
          };
          new Function('window', 'document', 'setTimeout', 'Event', panoptoJs)(
            mockWin,
            mockDoc,
            (fn: () => void, ms: number) => scheduledTimers.push({ fn, ms }),
            function MockEvent(type: string) {
              return { type };
            }
          );
          expect(extBtn.click).toHaveBeenCalledTimes(1);
          expect(scheduledTimers.length).toBe(1);
          scheduledTimers[0].fn();
          expect(mockLoc.search).toBe('?instance=Moodle2026&AllowBounce=true');

          // 3. Exact https://nidp.tau.ac.il host -> passes credentials AND enforces HTTPS + NIDP guard inside JS
          await act(async () => {
            await capturedWebViewProps.onLoadEnd({
              nativeEvent: { url: 'https://nidp.tau.ac.il/nidp/idff/sso' },
            });
          });
          expect(mockInjectJs).toHaveBeenCalledTimes(2);
          const nidpJs = mockInjectJs.mock.calls[1][0] as string;
          expect(nidpJs).toContain('secret-password-xyz');

          // Execute nidpJs on spoofed http://nidp.tau.ac.il -> must NOT fill inputs
          const userEl = { value: '', focus: jest.fn(), dispatchEvent: jest.fn() };
          const pidEl = { value: '', focus: jest.fn(), dispatchEvent: jest.fn() };
          const passEl = { value: '', focus: jest.fn(), dispatchEvent: jest.fn(), closest: () => null };
          const nidpDoc = {
            querySelector: (sel: string) => {
              if (sel.includes('Ecom_User_ID')) return userEl;
              if (sel.includes('Ecom_User_Pid')) return pidEl;
              if (sel.includes('Ecom_Password')) return passEl;
              return null;
            },
          };
          new Function('window', 'document', 'setTimeout', 'Event', nidpJs)(
            {
              location: { hostname: 'nidp.tau.ac.il', protocol: 'http:', href: 'http://nidp.tau.ac.il/nidp/idff/sso' },
              HTMLInputElement: { prototype: {} },
              ReactNativeWebView: { postMessage: jest.fn() },
            },
            nidpDoc,
            jest.fn(),
            function MockEvent(type: string) {
              return { type };
            }
          );
          expect(userEl.value).toBe('');
          expect(passEl.value).toBe('');

          // Execute nidpJs on https://nidp.tau.ac.il -> fills credentials
          new Function('window', 'document', 'setTimeout', 'Event', nidpJs)(
            {
              location: { hostname: 'nidp.tau.ac.il', protocol: 'https:', href: 'https://nidp.tau.ac.il/nidp/idff/sso' },
              HTMLInputElement: { prototype: {} },
              ReactNativeWebView: { postMessage: jest.fn() },
            },
            nidpDoc,
            jest.fn(),
            function MockEvent(type: string) {
              return { type };
            }
          );
          expect(userEl.value).toBe('alice');
          expect(pidEl.value).toBe('123456782');
          expect(passEl.value).toBe('secret-password-xyz');

          // 4. Closing modal during 250ms .ASPXAUTH retry prevents firing onPanoptoSuccess
          jest.useFakeTimers();
          mockHasPanoptoCookie.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
          act(() => {
            capturedWebViewProps.onMessage({
              nativeEvent: { data: JSON.stringify({ type: 'PANOPTO_AUTH_CHECK', authenticated: true }) },
            });
          });
          await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
          });

          // Close modal before 250ms timeout resolves
          view.rerender(
            React.createElement(SsoWebViewModal, {
              visible: false,
              mode: 'panopto',
              onClose,
              onPanoptoSuccess,
            })
          );

          await act(async () => {
            jest.advanceTimersByTime(300);
            await Promise.resolve();
            await Promise.resolve();
          });

          expect(onPanoptoSuccess).not.toHaveBeenCalled();
          expect(onClose).not.toHaveBeenCalled();
        } finally {
          view.unmount();
        }
      } finally {
        topLevelAuthMock.getStoredCredentials.mockImplementation(async () => null);
        jest.useRealTimers();
        RN.Platform.OS = originalPlatformOs;
      }
    });
  });
});
