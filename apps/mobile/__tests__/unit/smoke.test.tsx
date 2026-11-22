import React from 'react';
import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { cleanMoodleString, hasGracePeriod, isBrowserEnvironment } from '@tautracker/moodle-client';
import { Colors } from '@/constants/theme';

describe('Mobile Jest + RNTL + moodle-client smoke test', () => {
  it('renders React Native Text via RNTL', () => {
    render(<Text>Noodle Mobile</Text>);
    expect(screen.getByText('Noodle Mobile')).toBeTruthy();
  });

  it('imports and runs @tautracker/moodle-client ESM exports in Jest', () => {
    expect(
      cleanMoodleString(
        '<span lang="he" class="multilang">הודעות</span><span lang="en" class="multilang">News</span>',
        'en'
      )
    ).toBe('News');

    expect(
      hasGracePeriod({
        deadline: '2026-11-10T10:00:00Z',
        cutoffDate: '2026-11-11T10:00:00Z',
      })
    ).toBe(true);

    // jest-expo runs in RN environment (no document) -> must return false for CookieJar mode
    expect(isBrowserEnvironment()).toBe(false);
  });

  it('resolves @/constants/theme (CSS stub) and @/assets/* module mappings', () => {
    expect(Colors.noodle.background).toBe('#faf5eb');
    expect(Colors.dark.text).toBe('#f8fafc');
    const logoAsset = require('@/assets/images/logo-glow.png');
    expect(logoAsset).toBeDefined();
  });
});
