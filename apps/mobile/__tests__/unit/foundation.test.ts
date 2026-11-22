import React from 'react';
import { Linking, Platform } from 'react-native';
import { render } from '@testing-library/react-native';

import {
  Colors,
  COURSE_COLOR_PALETTE,
  getEffectiveThemeName,
  getReadableTextColor,
  getThemeColors,
} from '@/constants/theme';
import { getLanguage, t, translate, translations } from '@/services/i18n';
import {
  AssignmentsIcon,
  CoffeeIcon,
  DashboardIcon,
  FlaskIcon,
  GradesIcon,
  RecordingsIcon,
  SettingsIcon,
  StarIcon,
  TourIcon,
} from '@/components/icons/NoodleIcons';
import {
  formatGracePeriodText,
  formatShortDate,
  formatTimeHM,
  getDueTextAndClass,
  getZoomLiveStatus,
} from '@/services/dateUtils';
import { normalizeMoodleUrl, openMoodleUrl } from '@/services/moodleLink';
import { generateMockCourseSyncData, MOCK_COURSE_ID } from '@/services/mockCourse';
import {
  clearUserTablesOnLogout,
  getAssignments,
  getCourseAnnouncements,
  getCourseFolders,
  getCourseLinks,
  getCourseSections,
  getCourseStaffMap,
  getFiles,
  getGradeSummaries,
  getMeetings,
  getPreference,
  getRecordings,
  getTrackedCourses,
  loadSyncResultFromDatabase,
  removePreference,
  saveSyncResultToDatabase,
  saveTrackedCourses,
  setPreference,
} from '@/services/database';
import {
  clearCredentials,
  getStoredCredentials,
  getStoredSesskey,
  getStoredToken,
  isValidIsraeliId,
  loginTauSso,
  logoutAndTeardownSession,
  renewTokenSilently,
  saveCredentials,
  saveSesskey,
  saveToken,
  tryExtractTokenFromUrl,
} from '@/services/auth';

const EMOJI_OR_SYMBOL_REGEX =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\uFE0F\u200D🎉📥↗🌐⭐🧪⏰📄📁]/u;

const originalFetch = globalThis.fetch;

describe('Mobile Foundation Slice (F1)', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.useRealTimers();
    jest.restoreAllMocks();
    clearUserTablesOnLogout();
    removePreference('theme');
    removePreference('language');
    removePreference('theme_time_day_start');
    removePreference('theme_time_day_end');
  });

  describe('theme.ts', () => {
    it('defines Colors.coffee and preserves Colors.noodle / Colors.dark', () => {
      expect(Colors.noodle.background).toBe('#faf5eb');
      expect(Colors.dark.text).toBe('#f8fafc');
      expect(Colors.coffee).toEqual({
        text: '#fbf6f0',
        background: '#14100d',
        backgroundElement: '#1e1814',
        backgroundSelected: '#2c231e',
        textSecondary: '#d0c3b6',
        primary: '#d4a373',
        onPrimary: '#14100d',
        secondary: '#10b981',
        warning: '#f59e0b',
        onWarning: '#1c1208',
        danger: '#ef4444',
        border: 'rgba(212, 163, 115, 0.18)',
        placeholder: '#9a8a7c',
      });
      expect(COURSE_COLOR_PALETTE).toHaveLength(14);
      COURSE_COLOR_PALETTE.forEach((hex) => {
        expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
      });
      expect(getReadableTextColor('#E2B86B')).toBe('#14100d');
      expect(getReadableTextColor('#14100d')).toBe('#ffffff');
    });

    it('switches time-based theme between noodle (day) and coffee (night)', () => {
      jest.useFakeTimers();

      // Noon -> day -> noodle
      jest.setSystemTime(new Date(2026, 10, 18, 12, 0, 0));
      expect(getEffectiveThemeName('time', 7, 17)).toBe('noodle');
      expect(getThemeColors('time', 7, 17)).toEqual(Colors.noodle);

      // 21:00 -> night -> coffee
      jest.setSystemTime(new Date(2026, 10, 18, 21, 0, 0));
      expect(getEffectiveThemeName('time', 7, 17)).toBe('coffee');
      expect(getThemeColors('time', 7, 17)).toEqual(Colors.coffee);

      // 05:00 -> night -> coffee
      jest.setSystemTime(new Date(2026, 10, 18, 5, 0, 0));
      expect(getEffectiveThemeName('time', 7, 17)).toBe('coffee');

      // System mode respects scheme
      expect(getEffectiveThemeName('system', 7, 17, 'dark')).toBe('dark');
      expect(getEffectiveThemeName('system', 7, 17, 'light')).toBe('light');
    });
  });

  describe('i18n.ts', () => {
    it('contains zero unicode emojis or arrow symbols across all he & en keys', () => {
      const heKeys = Object.keys(translations.he).sort();
      const enKeys = Object.keys(translations.en).sort();
      expect(heKeys).toEqual(enKeys);

      for (const key of enKeys) {
        const enVal = (translations.en as Record<string, string>)[key];
        const heVal = (translations.he as Record<string, string>)[key];
        expect(EMOJI_OR_SYMBOL_REGEX.test(enVal)).toBe(false);
        expect(EMOJI_OR_SYMBOL_REGEX.test(heVal)).toBe(false);
      }
    });

    it('interpolates parameters and resolves active language preference', () => {
      setPreference('language', 'en');
      expect(getLanguage()).toBe('en');
      expect(t('grace_period_tooltip', { date: '20/11/2026' })).toBe(
        'Late submission accepted until 20/11/2026'
      );
      expect(translate('grace_period_tooltip', { date: '20/11/2026' }, 'he')).toBe(
        'מטלות באיחור יתקבלו עד 20/11/2026'
      );
    });
  });

  describe('NoodleIcons.tsx', () => {
    it('renders monochrome SVG icons cleanly', () => {
      const { toJSON } = render(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(DashboardIcon),
          React.createElement(AssignmentsIcon, { size: 18, color: '#c27044' }),
          React.createElement(RecordingsIcon),
          React.createElement(GradesIcon),
          React.createElement(SettingsIcon),
          React.createElement(CoffeeIcon),
          React.createElement(StarIcon),
          React.createElement(FlaskIcon),
          React.createElement(TourIcon)
        )
      );
      expect(toJSON()).toBeTruthy();
    });
  });

  describe('dateUtils.ts', () => {
    it('computes due text, classes, grace period, short date/time, and Zoom live status', () => {
      jest.useFakeTimers();
      const now = new Date('2026-11-18T12:00:00.000Z');
      jest.setSystemTime(now);

      const submitted = getDueTextAndClass(
        new Date(now.getTime() + 86400000).toISOString(),
        'en',
        7,
        3,
        false,
        'Submitted'
      );
      expect(submitted.badgeClass).toBe('badge-success');
      expect(submitted.deadlineText).toBe('Submitted');

      const urgent = getDueTextAndClass(
        new Date(now.getTime() + 2 * 86400000).toISOString(),
        'en',
        7,
        3
      );
      expect(urgent.badgeClass).toBe('badge-danger');
      expect(urgent.deadlineText).toBe('2 days');

      const overdue = getDueTextAndClass(
        new Date(now.getTime() - 3600000).toISOString(),
        'he'
      );
      expect(overdue.badgeClass).toBe('badge-danger');
      expect(overdue.deadlineText).toBe('עבר המועד!');

      // Zoom live status windows (-15m to +120m -> active)
      expect(getZoomLiveStatus(undefined)).toBe('permanent');
      expect(getZoomLiveStatus('')).toBe('permanent');
      expect(getZoomLiveStatus('invalid-date')).toBe('permanent');
      expect(getZoomLiveStatus(new Date(now.getTime() + 10 * 60000).toISOString())).toBe('active');
      expect(getZoomLiveStatus(new Date(now.getTime() - 60 * 60000).toISOString())).toBe('active');
      expect(getZoomLiveStatus(new Date(now.getTime() + 45 * 60000).toISOString())).toBe('upcoming');
      expect(getZoomLiveStatus(new Date(now.getTime() - 150 * 60000).toISOString())).toBe('past');

      // Grace period & date/time formatters
      const gpEn = formatGracePeriodText('2026-11-22T23:55:00.000Z', 'en');
      expect(gpEn).toContain('Late submission accepted until');
      const gpHe = formatGracePeriodText('2026-11-22T23:55:00.000Z', 'he');
      expect(gpHe).toContain('מטלות באיחור יתקבלו עד');

      expect(formatShortDate('2026-11-18T12:00:00.000Z', 'en')).not.toBe('');
      expect(formatTimeHM('2026-11-18T12:05:00.000Z', 'en')).toMatch(/^\d{2}:\d{2}$/);
      expect(formatShortDate(null, 'en')).toBe('');
    });
  });

  describe('moodleLink.ts', () => {
    it('normalizes relative Moodle paths and opens via Linking.openURL', async () => {
      const openSpy = jest.spyOn(Linking, 'openURL').mockResolvedValueOnce(true as any);
      expect(normalizeMoodleUrl('/mod/assign/view.php?id=42')).toBe(
        'https://moodle.tau.ac.il/mod/assign/view.php?id=42'
      );
      expect(normalizeMoodleUrl('mod/quiz/view.php?id=9', 'https://moodle.tau.ac.il/2025/')).toBe(
        'https://moodle.tau.ac.il/2025/mod/quiz/view.php?id=9'
      );
      await openMoodleUrl('/mod/assign/view.php?id=42');
      expect(openSpy).toHaveBeenCalledWith('https://moodle.tau.ac.il/mod/assign/view.php?id=42');
    });
  });

  describe('mockCourse.ts', () => {
    it('generates complete mock course sync data with zero emojis', () => {
      expect(MOCK_COURSE_ID).toBe(9999);

      for (const lang of ['he', 'en'] as const) {
        const data = generateMockCourseSyncData(lang);
        expect(data.courses?.[0]?.id).toBe(9999);
        expect(data.sections?.some((s) => s.level === 1 && s.isSubsectionModule)).toBe(true);
        expect((data.folders || []).length).toBeGreaterThanOrEqual(1);
        expect(data.assignments.some((a) => a.activityType === 'quiz' && Boolean(a.timeLimitSeconds))).toBe(true);
        expect(data.assignments.some((a) => a.isBonus)).toBe(true);
        expect(data.assignments.some((a) => a.isLateSubmissionBox)).toBe(true);
        expect(data.assignments.some((a) => Boolean(a.cutoffDate))).toBe(true);
        expect((data.recordings || []).length).toBeGreaterThanOrEqual(2);
        expect(data.gradeSummaries?.[MOCK_COURSE_ID]?.hasCourseTotal).toBe(true);
        expect(data.courseStaff?.[MOCK_COURSE_ID]?.length).toBeGreaterThanOrEqual(2);

        const serialized = JSON.stringify(data);
        expect(EMOJI_OR_SYMBOL_REGEX.test(serialized)).toBe(false);
      }
    });
  });

  describe('database.ts', () => {
    it('persists and loads full SyncResult roundtrip and preserves UI prefs on logout', () => {
      setPreference('theme', 'coffee');
      setPreference('language', 'en');
      setPreference('theme_time_day_start', '8');
      setPreference('theme_time_day_end', '19');
      setPreference('user_fullname', 'Test Student');

      const mockData = generateMockCourseSyncData('en');
      saveTrackedCourses([
        {
          moodle_id: MOCK_COURSE_ID,
          course_id: '0368216101',
          name: 'Data Structures',
          semester: 'SemesterB',
          year: '2026',
          color: '#8b5cf6',
          is_active: 1,
        },
      ]);
      saveSyncResultToDatabase(mockData);

      expect(getTrackedCourses()).toHaveLength(1);
      expect(getAssignments(MOCK_COURSE_ID)).toHaveLength(mockData.assignments.length);
      expect(getFiles(MOCK_COURSE_ID)).toHaveLength(mockData.files.length);
      expect(getMeetings(MOCK_COURSE_ID)).toHaveLength(mockData.meetings.length);
      expect(getCourseSections(MOCK_COURSE_ID)).toHaveLength(mockData.sections!.length);
      expect(getCourseFolders(MOCK_COURSE_ID)).toHaveLength(mockData.folders!.length);
      expect(getCourseLinks(MOCK_COURSE_ID)).toHaveLength(mockData.links!.length);
      expect(getCourseAnnouncements(MOCK_COURSE_ID)).toHaveLength(mockData.announcements!.length);
      expect(getRecordings(MOCK_COURSE_ID)).toHaveLength(mockData.recordings!.length);
      expect(getCourseStaffMap()[MOCK_COURSE_ID]).toHaveLength(2);
      expect(getGradeSummaries()[MOCK_COURSE_ID]?.courseTotalRaw).toBe(96);

      const loaded = loadSyncResultFromDatabase();
      expect(loaded.courses).toHaveLength(1);
      expect(loaded.assignments).toHaveLength(mockData.assignments.length);
      expect(loaded.recordings).toHaveLength(mockData.recordings!.length);
      expect(loaded.syncedAt).toBe(mockData.syncedAt);

      // Logout clears user tables & user prefs but keeps UI prefs
      clearUserTablesOnLogout();
      expect(getTrackedCourses(false)).toHaveLength(0);
      expect(getAssignments()).toHaveLength(0);
      expect(getRecordings()).toHaveLength(0);
      expect(getCourseStaffMap()).toEqual({});
      expect(getGradeSummaries()).toEqual({});
      expect(getPreference('user_fullname')).toBeNull();
      expect(getPreference('last_synced_at')).toBeNull();
      expect(getPreference('theme')).toBe('coffee');
      expect(getPreference('language')).toBe('en');
      expect(getPreference('theme_time_day_start')).toBe('8');
      expect(getPreference('theme_time_day_end')).toBe('19');
    });

    it('works safely when Platform.OS === "web"', () => {
      const originalOs = Platform.OS;
      Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
      try {
        setPreference('theme', 'noodle');
        expect(getPreference('theme')).toBe('noodle');
      } finally {
        Object.defineProperty(Platform, 'OS', { value: originalOs, configurable: true });
      }
    });
  });

  describe('auth.ts', () => {
    it('validates Israeli ID numbers and extracts moodlemobile tokens', () => {
      expect(isValidIsraeliId('123456782')).toBe(true);
      expect(isValidIsraeliId('123456789')).toBe(false);

      const payload = btoa('sig:::abcdef0123456789abcdef0123456789');
      expect(tryExtractTokenFromUrl(`moodlemobile://token=${payload}`)).toBe(
        'abcdef0123456789abcdef0123456789'
      );
      expect(tryExtractTokenFromUrl('https://moodle.tau.ac.il/my/')).toBeNull();
    });

    it('stores credentials, tokens, and sesskeys cleanly in fallback mode', async () => {
      await saveCredentials('alice', '123456782', 'secret');
      await saveToken('abcdef0123456789abcdef0123456789');
      await saveSesskey('sess_xyz');

      expect(await getStoredCredentials()).toEqual({
        username: 'alice',
        idNumber: '123456782',
        password: 'secret',
      });
      expect(await getStoredToken()).toBe('abcdef0123456789abcdef0123456789');
      expect(await getStoredSesskey()).toBe('sess_xyz');

      await clearCredentials();
      expect(await getStoredCredentials()).toBeNull();
    });

    it('rejects with SSO_TOKEN_EXTRACTION_FAILED instead of returning web_session_*', async () => {
      (globalThis as any).fetch = jest.fn().mockResolvedValue({
        status: 200,
        ok: true,
        headers: new Headers(),
        text: async () => '<html><body>No SSO redirect</body></html>',
      });

      await expect(loginTauSso('alice', '123456782', 'secret')).rejects.toThrow(
        'SSO_TOKEN_EXTRACTION_FAILED'
      );
    });

    it('falls back to SAML + managetoken.php reset and rejects if no real 32+ char token exists', async () => {
      const realToken = 'fedcba9876543210fedcba9876543210';
      const createMockFetch = (withToken: boolean) => {
        let authed = false;
        return jest.fn().mockImplementation(async (url: string, init?: RequestInit) => {
          const u = String(url);
          const bodyStr = String(init?.body || '');
          if (u.includes('launch.php')) {
            return {
              status: 200,
              ok: true,
              headers: new Headers(),
              text: async () => '<html>No mobile scheme</html>',
            };
          }
          if (u.includes('login/index.php')) {
            return {
              status: 302,
              ok: false,
              headers: new Headers({ location: 'https://nidp.tau.ac.il/nidp/saml2/sso' }),
              text: async () => '',
            };
          }
          if (u.includes('nidp.tau.ac.il')) {
            if (bodyStr.includes('Ecom_User_ID')) {
              authed = true;
              return { status: 200, ok: true, headers: new Headers(), text: async () => '{"isError":false}' };
            }
            if (authed) {
              return {
                status: 200,
                ok: true,
                headers: new Headers(),
                text: async () =>
                  '<form action="https://moodle.tau.ac.il/auth/saml2/sp/saml2-acs.php">' +
                  '<input type="hidden" name="SAMLResponse" value="c2FtbA==" />' +
                  '<input type="hidden" name="RelayState" value="cmVsYXk=" />' +
                  '</form>',
              };
            }
            return {
              status: 200,
              ok: true,
              headers: new Headers(),
              text: async () =>
                '<form action="/nidp/saml2/sso?sid=0"><input type="hidden" name="option" value="credential" /></form>',
            };
          }
          if (u.includes('saml2-acs.php')) {
            return {
              status: 200,
              ok: true,
              headers: new Headers(),
              text: async () => '{"sesskey":"sess_abc123"}',
            };
          }
          if (u.includes('managetoken.php')) {
            if (init?.method === 'POST' && withToken) {
              return {
                status: 200,
                ok: true,
                headers: new Headers(),
                text: async () => `<div id="copytoclipboardtoken">${realToken}</div>`,
              };
            }
            if (init?.method === 'POST' && !withToken) {
              return {
                status: 200,
                ok: true,
                headers: new Headers(),
                text: async () => `<div id="copytoclipboardtoken">short</div>`,
              };
            }
            return {
              status: 200,
              ok: true,
              headers: new Headers(),
              text: async () =>
                '<table><tr><td>Moodle mobile web service</td><td><a href="?action=resetwstoken&amp;tokenid=77">Reset</a></td></tr></table>',
            };
          }
          return { status: 200, ok: true, headers: new Headers(), text: async () => '' };
        });
      };

      (globalThis as any).fetch = createMockFetch(false);
      await expect(loginTauSso('alice', '123456782', 'secret')).rejects.toThrow(
        'SSO_TOKEN_EXTRACTION_FAILED'
      );

      (globalThis as any).fetch = createMockFetch(true);
      const token = await loginTauSso('alice', '123456782', 'secret');
      expect(token).toBe(realToken);
      expect(await getStoredSesskey()).toBe('sess_abc123');
    });

    it('returns real 32+ char token when launch redirect succeeds and supports silent renewal', async () => {
      const realToken = '0123456789abcdef0123456789abcdef';
      const encoded = btoa(`sig:::${realToken}`);
      (globalThis as any).fetch = jest.fn().mockResolvedValue({
        status: 302,
        ok: false,
        headers: new Headers({ location: `moodlemobile://token=${encoded}` }),
        text: async () => '',
      });

      expect(await renewTokenSilently()).toBeNull();

      await saveCredentials('alice', '123456782', 'secret');
      const renewed = await renewTokenSilently();
      expect(renewed).toBe(realToken);
      expect(await getStoredToken()).toBe(realToken);
    });

    it('invalidates server sessions with cache-busting and clears local user state on logout', async () => {
      const fetchMock = jest.fn().mockResolvedValue(new Response('', { status: 200 }));
      (globalThis as any).fetch = fetchMock;

      setPreference('theme', 'coffee');
      setPreference('language', 'en');
      setPreference('user_fullname', 'Alice');
      await saveCredentials('alice', '123456782', 'secret');
      await saveToken('0123456789abcdef0123456789abcdef');
      await saveSesskey('sess_123');
      saveSyncResultToDatabase(generateMockCourseSyncData('en'));

      await logoutAndTeardownSession();

      expect(fetchMock).toHaveBeenCalledTimes(3);
      const calledUrls = fetchMock.mock.calls.map((c: any[]) => String(c[0]));
      expect(calledUrls.some((u) => u.startsWith('https://moodle.tau.ac.il/login/logout.php?sesskey=sess_123&_t='))).toBe(true);
      expect(calledUrls.some((u) => u.startsWith('https://nidp.tau.ac.il/nidp/app/logout?_t='))).toBe(true);
      expect(calledUrls.some((u) => u.startsWith('https://tau.cloud.panopto.eu/Panopto/Pages/Auth/Logout.aspx?_t='))).toBe(true);
      fetchMock.mock.calls.forEach((c: any[]) => {
        expect(c[1]).toMatchObject({ cache: 'no-store' });
      });

      expect(await getStoredToken()).toBeNull();
      expect(await getStoredCredentials()).toBeNull();
      expect(await getStoredSesskey()).toBeNull();
      expect(getAssignments()).toHaveLength(0);
      expect(getPreference('user_fullname')).toBeNull();
      expect(getPreference('theme')).toBe('coffee');
      expect(getPreference('language')).toBe('en');
    });
  });
});
