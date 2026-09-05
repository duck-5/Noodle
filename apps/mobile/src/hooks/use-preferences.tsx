import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getPreference, setPreference } from '@/services/database';

export type ThemeMode = 'noodle' | 'system' | 'light' | 'dark';
export type SupportedLanguage = 'he' | 'en';
export type ThemeColors = {
  readonly [K in keyof typeof Colors.noodle]: string;
};

interface PreferencesContextType {
  themeMode: ThemeMode;
  theme: ThemeColors;
  language: SupportedLanguage;
  isRtl: boolean;
  setThemeMode: (mode: ThemeMode) => void;
  setLanguage: (lang: SupportedLanguage) => void;
  refreshPreferences: () => void;
}

const PreferencesContext = createContext<PreferencesContextType | null>(null);

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const scheme = useColorScheme();

  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => {
    try {
      const stored = getPreference('theme');
      if (stored === 'noodle' || stored === 'dark' || stored === 'light' || stored === 'system') {
        return stored;
      }
    } catch {}
    return 'noodle';
  });

  const [language, setLanguageState] = useState<SupportedLanguage>(() => {
    try {
      const stored = getPreference('language');
      if (stored === 'he' || stored === 'en') {
        return stored;
      }
    } catch {}
    return 'he';
  });

  const refreshPreferences = useCallback(() => {
    try {
      const storedTheme = getPreference('theme');
      if (storedTheme === 'noodle' || storedTheme === 'dark' || storedTheme === 'light' || storedTheme === 'system') {
        setThemeModeState(storedTheme);
      } else {
        setThemeModeState('noodle');
      }

      const storedLang = getPreference('language');
      if (storedLang === 'he' || storedLang === 'en') {
        setLanguageState(storedLang);
      } else {
        setLanguageState('he');
      }
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

  const setLanguage = useCallback((newLang: SupportedLanguage) => {
    try {
      setPreference('language', newLang);
    } catch (e) {
      console.error('Failed to save language preference:', e);
    }
    setLanguageState(newLang);
  }, []);

  const activeColors = useMemo<ThemeColors>(() => {
    if (themeMode === 'noodle') return Colors.noodle;
    if (themeMode === 'dark') return Colors.dark;
    if (themeMode === 'light') return Colors.light;
    return scheme === 'dark' ? Colors.dark : Colors.light;
  }, [themeMode, scheme]);

  const value = useMemo(
    () => ({
      themeMode,
      theme: activeColors,
      language,
      isRtl: language === 'he',
      setThemeMode,
      setLanguage,
      refreshPreferences,
    }),
    [themeMode, activeColors, language, setThemeMode, setLanguage, refreshPreferences]
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  const context = useContext(PreferencesContext);
  if (!context) {
    // Fallback if rendered outside provider
    return {
      themeMode: 'noodle' as ThemeMode,
      theme: Colors.noodle,
      language: 'he' as SupportedLanguage,
      isRtl: true,
      setThemeMode: (mode: ThemeMode) => {
        try { setPreference('theme', mode); } catch {}
      },
      setLanguage: (lang: SupportedLanguage) => {
        try { setPreference('language', lang); } catch {}
      },
      refreshPreferences: () => {},
    };
  }
  return context;
}
