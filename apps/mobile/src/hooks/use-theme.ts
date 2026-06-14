/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getPreference } from '@/services/database';

export function useTheme() {
  const scheme = useColorScheme();
  
  let themePref = 'system';
  try {
    themePref = getPreference('theme') || 'system';
  } catch (e) {
    console.error('Failed to get theme preference:', e);
  }
  
  if (themePref === 'noodle') {
    return Colors.noodle;
  }
  if (themePref === 'dark') {
    return Colors.dark;
  }
  if (themePref === 'light') {
    return Colors.light;
  }

  const theme = scheme === 'dark' ? 'dark' : 'light';
  return Colors[theme];
}
