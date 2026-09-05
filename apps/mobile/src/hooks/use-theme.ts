/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { usePreferences } from '@/hooks/use-preferences';

export function useTheme() {
  const { theme } = usePreferences();
  return theme;
}
