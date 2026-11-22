import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import {
  Colors,
  ThemeMode,
  ActiveThemeName,
  ThemeColors,
  getEffectiveThemeName,
  getThemeColors,
} from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getPreference, setPreference } from '@/services/database';
import { SupportedLanguage, translate } from '@/services/i18n';

export type { ThemeMode, ActiveThemeName, ThemeColors, SupportedLanguage };

type TranslationKey = Parameters<typeof translate>[0];

export interface PreferencesContextType {
  themeMode: ThemeMode;
  effectiveThemeName: ActiveThemeName;
  theme: ThemeColors;
  language: SupportedLanguage;
  isRtl: boolean;
  timeDayStart: number;
  timeDayEnd: number;
  setThemeMode: (mode: ThemeMode) => void;
  setTimeWindow: (dayStart: number, dayEnd: number) => void;
  setLanguage: (lang: SupportedLanguage) => void;
  refreshPreferences: () => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

const PreferencesContext = createContext<PreferencesContextType | null>(null);

function parseThemeMode(raw: string | null): ThemeMode {
  if (
    raw === 'noodle' ||
    raw === 'coffee' ||
    raw === 'dark' ||
    raw === 'light' ||
    raw === 'time' ||
    raw === 'system'
  ) {
    return raw;
  }
  return 'noodle';
}

function parseLanguage(raw: string | null): SupportedLanguage {
  return raw === 'en' || raw === 'he' ? raw : 'he';
}

function parseHour(raw: string | null, fallback: number): number {
  if (raw === null || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(23, Math.floor(parsed)));
}

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const rawScheme = useColorScheme();
  const systemScheme: 'light' | 'dark' | undefined =
    rawScheme === 'dark' ? 'dark' : rawScheme === 'light' ? 'light' : undefined;

  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => {
    try {
      return parseThemeMode(getPreference('theme'));
    } catch {
      return 'noodle';
    }
  });

  const [timeDayStart, setTimeDayStartState] = useState<number>(() => {
    try {
      return parseHour(getPreference('theme_time_day_start'), 7);
    } catch {
      return 7;
    }
  });

  const [timeDayEnd, setTimeDayEndState] = useState<number>(() => {
    try {
      return parseHour(getPreference('theme_time_day_end'), 17);
    } catch {
      return 17;
    }
  });

  const [language, setLanguageState] = useState<SupportedLanguage>(() => {
    try {
      return parseLanguage(getPreference('language'));
    } catch {
      return 'he';
    }
  });

  const [timeTick, setTimeTick] = useState<number>(() => Date.now());

  // Re-evaluate time-based theme every 30s when themeMode === 'time'
  useEffect(() => {
    if (themeMode !== 'time') return;
    const interval = setInterval(() => {
      setTimeTick(Date.now());
    }, 30_000);
    return () => clearInterval(interval);
  }, [themeMode]);

  const refreshPreferences = useCallback(() => {
    try {
      setThemeModeState(parseThemeMode(getPreference('theme')));
      setTimeDayStartState(parseHour(getPreference('theme_time_day_start'), 7));
      setTimeDayEndState(parseHour(getPreference('theme_time_day_end'), 17));
      setLanguageState(parseLanguage(getPreference('language')));
      setTimeTick(Date.now());
    } catch (e) {
      console.error('refreshPreferences error:', e);
    }
  }, []);

  const setThemeMode = useCallback((newMode: ThemeMode) => {
    try {
      setPreference('theme', newMode);
    } catch (e) {
      console.error('Failed to save theme preference:', e);
    }
    setThemeModeState(newMode);
  }, []);

  const setTimeWindow = useCallback((dayStart: number, dayEnd: number) => {
    const start = Math.max(0, Math.min(23, Math.floor(Number(dayStart) || 0)));
    const end = Math.max(0, Math.min(23, Math.floor(Number(dayEnd) || 0)));
    try {
      setPreference('theme_time_day_start', String(start));
      setPreference('theme_time_day_end', String(end));
    } catch (e) {
      console.error('Failed to save theme time window:', e);
    }
    setTimeDayStartState(start);
    setTimeDayEndState(end);
    setTimeTick(Date.now());
  }, []);

  const setLanguage = useCallback((newLang: SupportedLanguage) => {
    try {
      setPreference('language', newLang);
    } catch (e) {
      console.error('Failed to save language preference:', e);
    }
    setLanguageState(newLang);
  }, []);

  const effectiveThemeName = useMemo<ActiveThemeName>(() => {
    void timeTick;
    return getEffectiveThemeName(themeMode, timeDayStart, timeDayEnd, systemScheme);
  }, [themeMode, timeDayStart, timeDayEnd, systemScheme, timeTick]);

  const theme = useMemo<ThemeColors>(() => {
    void timeTick;
    return getThemeColors(themeMode, timeDayStart, timeDayEnd, systemScheme);
  }, [themeMode, timeDayStart, timeDayEnd, systemScheme, timeTick]);

  const t = useCallback(
    (key: TranslationKey, params?: Record<string, string | number>) => {
      return translate(key, params, language);
    },
    [language]
  );

  const value = useMemo<PreferencesContextType>(
    () => ({
      themeMode,
      effectiveThemeName,
      theme,
      language,
      isRtl: language === 'he',
      timeDayStart,
      timeDayEnd,
      setThemeMode,
      setTimeWindow,
      setLanguage,
      refreshPreferences,
      t,
    }),
    [
      themeMode,
      effectiveThemeName,
      theme,
      language,
      timeDayStart,
      timeDayEnd,
      setThemeMode,
      setTimeWindow,
      setLanguage,
      refreshPreferences,
      t,
    ]
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesContextType {
  const context = useContext(PreferencesContext);
  if (!context) {
    return {
      themeMode: 'noodle',
      effectiveThemeName: 'noodle',
      theme: Colors.noodle,
      language: 'he',
      isRtl: true,
      timeDayStart: 7,
      timeDayEnd: 17,
      setThemeMode: (mode: ThemeMode) => {
        try {
          setPreference('theme', mode);
        } catch {}
      },
      setTimeWindow: (dayStart: number, dayEnd: number) => {
        try {
          setPreference('theme_time_day_start', String(dayStart));
          setPreference('theme_time_day_end', String(dayEnd));
        } catch {}
      },
      setLanguage: (lang: SupportedLanguage) => {
        try {
          setPreference('language', lang);
        } catch {}
      },
      refreshPreferences: () => {},
      t: (key: TranslationKey, params?: Record<string, string | number>) => translate(key, params, 'he'),
    };
  }
  return context;
}
