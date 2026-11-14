import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  extractChangelogSection,
  parseReleaseTag,
  verifyExtensionVersions,
} from './verify-release.mjs';

test('parseReleaseTag accepts vX.Y.Z and vX.Y.Z.W and rejects invalid tags', () => {
  assert.deepEqual(parseReleaseTag('v4.0.3'), { tag: 'v4.0.3', version: '4.0.3' });
  assert.deepEqual(parseReleaseTag('v4.0.3.1'), { tag: 'v4.0.3.1', version: '4.0.3.1' });

  assert.throws(() => parseReleaseTag('4.0.3'), /Invalid release tag/);
  assert.throws(() => parseReleaseTag('v4.0.3-beta.1'), /Invalid release tag/);
  assert.throws(() => parseReleaseTag(''), /Invalid release tag/);
});

test('verifyExtensionVersions checks manifest.json and package.json match tag version', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noodle-release-test-'));
  try {
    const extDir = path.join(tmpDir, 'apps', 'extension');
    fs.mkdirSync(path.join(extDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(extDir, 'src', 'manifest.json'), JSON.stringify({ version: '4.1.0' }));
    fs.writeFileSync(path.join(extDir, 'package.json'), JSON.stringify({ version: '4.1.0' }));

    assert.deepEqual(verifyExtensionVersions('4.1.0', tmpDir), {
      manifestVersion: '4.1.0',
      packageVersion: '4.1.0',
    });

    assert.throws(() => verifyExtensionVersions('4.1.1', tmpDir), /manifest\.json.*package\.json/s);

    fs.writeFileSync(path.join(extDir, 'package.json'), JSON.stringify({ version: '4.0.9' }));
    assert.throws(() => verifyExtensionVersions('4.1.0', tmpDir), /package\.json/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('extractChangelogSection prefers exact version section and falls back to Unreleased', () => {
  const sampleChangelog = `# Changelog

---

## [Unreleased]

### Added
- Pending feature

---

## [4.0.3] - 2026-11-11
### Added
- Tour overhaul
### Fixed
- Sync bug

## [4.0.2] - 2026-10-29
### Added
- Older item
`;

  const exact = extractChangelogSection(sampleChangelog, '4.0.3');
  assert.equal(exact.source, 'version');
  assert.match(exact.markdown, /Tour overhaul/);
  assert.doesNotMatch(exact.markdown, /Older item/);
  assert.doesNotMatch(exact.markdown, /Pending feature/);

  const fallbackUnreleased = extractChangelogSection(sampleChangelog, '4.0.4');
  assert.equal(fallbackUnreleased.source, 'unreleased');
  assert.match(fallbackUnreleased.markdown, /Pending feature/);

  const fallbackDefault = extractChangelogSection('# Changelog\n', '9.9.9');
  assert.equal(fallbackDefault.source, 'fallback');
  assert.equal(fallbackDefault.markdown, 'Release v9.9.9. See CHANGELOG.md for details.');
});

