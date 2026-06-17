// Learn more: https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Watch all files within the monorepo
config.watchFolders = [monorepoRoot];

// 2. Let Metro know where to resolve packages, and in what order
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// 3. Handle the moodle-client package which uses ESM with .js extensions
// Force Metro to resolve these correctly
config.resolver.sourceExts = [...config.resolver.sourceExts, 'mjs', 'cjs'];

// 4. Enable unstable package exports support for better ESM compatibility
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
