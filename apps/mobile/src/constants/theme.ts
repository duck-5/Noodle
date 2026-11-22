/**
 * Color palettes, typography, spacing, and theme resolution utilities for Noodle Mobile.
 */

import '@/global.css';

import { Platform } from 'react-native';
import { getEffectiveTheme } from '@tautracker/moodle-client';

export const Colors = {
  light: {
    text: '#0f172a',
    background: '#f8fafc',
    backgroundElement: '#ffffff',
    backgroundSelected: '#e2e8f0',
    textSecondary: '#64748b',
    primary: '#4f46e5',
    onPrimary: '#ffffff',
    secondary: '#10b981',
    warning: '#f59e0b',
    onWarning: '#1c1208',
    danger: '#ef4444',
    border: '#cbd5e1',
    placeholder: '#94a3b8',
  },
  dark: {
    text: '#f8fafc',
    background: '#0f111a',
    backgroundElement: '#1a1d2e',
    backgroundSelected: '#242840',
    textSecondary: '#94a3b8',
    primary: '#6366f1',
    onPrimary: '#ffffff',
    secondary: '#10b981',
    warning: '#f59e0b',
    onWarning: '#1c1208',
    danger: '#ef4444',
    border: 'rgba(255, 255, 255, 0.08)',
    placeholder: '#64748b',
  },
  noodle: {
    text: '#3d405b',
    background: '#faf5eb',
    backgroundElement: '#fffdf9',
    backgroundSelected: '#ebdcb9',
    textSecondary: '#5f6585',
    primary: '#c27044',
    onPrimary: '#ffffff',
    secondary: '#48785e',
    warning: '#b36b1d',
    onWarning: '#1c1208',
    danger: '#b33c30',
    border: 'rgba(194, 112, 68, 0.18)',
    placeholder: '#8d93ab',
  },
  coffee: {
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
  },
} as const;

export type ThemeColor = keyof typeof Colors.light;
export type ThemeColors = { readonly [K in ThemeColor]: string };
export type ThemeMode = 'noodle' | 'coffee' | 'dark' | 'light' | 'time' | 'system';
export type ActiveThemeName = 'noodle' | 'coffee' | 'dark' | 'light';

export const COURSE_COLOR_PALETTE: readonly string[] = [
  '#E58C7A', // Pastel Coral
  '#E8A574', // Peach Apricot
  '#E2B86B', // Warm Amber
  '#7DB899', // Sage Mint
  '#6BB0A8', // Eucalyptus
  '#74AEE3', // Sky Blue
  '#8296E0', // Periwinkle
  '#9D8BE3', // Soft Lavender
  '#BE89D6', // Mauve Orchid
  '#DF86AC', // Dusty Rose
  '#C9846B', // Terracotta
  '#96BF78', // Pistachio
  '#7E9BB5', // Slate Blue
  '#A69382', // Warm Taupe
] as const;

export function getEffectiveThemeName(
  mode: ThemeMode,
  dayStart: number = 7,
  dayEnd: number = 17,
  systemScheme?: 'light' | 'dark' | null
): ActiveThemeName {
  if (mode === 'noodle' || mode === 'coffee' || mode === 'dark' || mode === 'light') {
    return mode;
  }
  if (mode === 'system') {
    return systemScheme === 'dark' ? 'dark' : 'light';
  }
  if (mode === 'time') {
    return getEffectiveTheme('time', dayStart, dayEnd);
  }
  return 'noodle';
}

export function getThemeColors(
  mode: ThemeMode,
  dayStart: number = 7,
  dayEnd: number = 17,
  systemScheme?: 'light' | 'dark' | null
): ThemeColors {
  return Colors[getEffectiveThemeName(mode, dayStart, dayEnd, systemScheme)];
}

/**
 * Computes WCAG 2.1 relative luminance for a hex color and returns a high-contrast
 * foreground color (`#14100d` for bright backgrounds, `#ffffff` for dark backgrounds).
 */
export function getReadableTextColor(hex: string): string {
  const cleaned = (hex || '').trim().replace(/^#/, '');
  let r = 0;
  let g = 0;
  let b = 0;

  if (cleaned.length === 3) {
    r = parseInt(cleaned[0] + cleaned[0], 16);
    g = parseInt(cleaned[1] + cleaned[1], 16);
    b = parseInt(cleaned[2] + cleaned[2], 16);
  } else if (cleaned.length === 6) {
    r = parseInt(cleaned.slice(0, 2), 16);
    g = parseInt(cleaned.slice(2, 4), 16);
    b = parseInt(cleaned.slice(4, 6), 16);
  } else {
    return '#ffffff';
  }

  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return '#ffffff';
  }

  const toLinear = (channel: number): number => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };

  const luminance = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  // Compare WCAG contrast against #ffffff (L=1) vs #14100d (L~0.005)
  const contrastWhite = (1.0 + 0.05) / (luminance + 0.05);
  const contrastDark = (luminance + 0.05) / (0.005 + 0.05);
  return contrastDark > contrastWhite ? '#14100d' : '#ffffff';
}

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
