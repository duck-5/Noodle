/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#0f172a',
    background: '#f8fafc',
    backgroundElement: '#ffffff',
    backgroundSelected: '#e2e8f0',
    textSecondary: '#64748b',
    primary: '#4f46e5',
    secondary: '#10b981',
    warning: '#f59e0b',
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
    secondary: '#10b981',
    warning: '#f59e0b',
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
    secondary: '#48785e',
    warning: '#b36b1d',
    danger: '#b33c30',
    border: 'rgba(194, 112, 68, 0.18)',
    placeholder: '#8d93ab',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light;

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
