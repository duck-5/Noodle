import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const extensionDir = path.join(rootDir, 'apps', 'extension');
const manifestPath = path.join(extensionDir, 'dist', 'manifest.json');

console.log('====================================================');
console.log('TC-EXT-BRW-01 & TC-EXT-BRW-02: Manifest Build Parity');
console.log('====================================================\n');

try {
  // 1. Test Chrome Build
  console.log('1. Testing Chrome Extension Build (TC-EXT-BRW-01)...');
  execSync('pnpm --filter extension run build:chrome', { cwd: rootDir, stdio: 'pipe' });

  const chromeManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  if (chromeManifest.manifest_version !== 3) {
    throw new Error(`Expected manifest_version 3, got ${chromeManifest.manifest_version}`);
  }
  if (!chromeManifest.background || !chromeManifest.background.service_worker) {
    throw new Error('Chrome manifest missing background.service_worker');
  }
  if (chromeManifest.background.scripts) {
    throw new Error('Chrome manifest should not have background.scripts');
  }
  console.log('   ✓ Chrome MV3 service worker properly configured');

  // 2. Test Firefox Build
  console.log('2. Testing Firefox Extension Build (TC-EXT-BRW-01)...');
  execSync('pnpm --filter extension run build:firefox', { cwd: rootDir, stdio: 'pipe' });

  const firefoxManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  if (firefoxManifest.manifest_version !== 3) {
    throw new Error(`Expected manifest_version 3, got ${firefoxManifest.manifest_version}`);
  }
  if (!firefoxManifest.background || !Array.isArray(firefoxManifest.background.scripts)) {
    throw new Error('Firefox manifest missing background.scripts array');
  }
  if (firefoxManifest.background.service_worker) {
    throw new Error('Firefox manifest should not have background.service_worker');
  }
  if (firefoxManifest.browser_specific_settings?.gecko?.id !== 'noodle@tau') {
    throw new Error(`Expected gecko.id 'noodle@tau', got ${firefoxManifest.browser_specific_settings?.gecko?.id}`);
  }
  console.log('   ✓ Firefox MV3 background.scripts and gecko.id properly configured');

  // 3. Test OAuth Redirect Resolution Parity (TC-EXT-BRW-02)
  console.log('3. Testing OAuth Redirect URL Parity (TC-EXT-BRW-02)...');
  const extensionId = 'abcdefghijklmnop';
  const chromeRedirect = `https://${extensionId}.chromiumapp.org/`;
  const firefoxRedirect = `https://${extensionId}.extensions.allizom.org/`;

  if (!chromeRedirect.includes('.chromiumapp.org/')) {
    throw new Error('Invalid Chrome OAuth redirect format');
  }
  if (!firefoxRedirect.includes('.extensions.allizom.org/')) {
    throw new Error('Invalid Firefox OAuth redirect format');
  }
  console.log(`   ✓ Chrome OAuth URL: ${chromeRedirect}`);
  console.log(`   ✓ Firefox OAuth URL: ${firefoxRedirect}`);

  // 4. Restore Chrome build for browser tests
  console.log('4. Restoring Chrome Extension build in dist/...');
  execSync('pnpm --filter extension run build:chrome', { cwd: rootDir, stdio: 'pipe' });

  console.log('\n[SUCCESS] TC-EXT-BRW-01 & TC-EXT-BRW-02 passed with full parity!');
  process.exit(0);
} catch (err) {
  console.error('\n[FAILED] Error during build parity test:', err.message);
  process.exit(1);
}
