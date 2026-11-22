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
//    and expo-sqlite WebAssembly assets on web
config.resolver.sourceExts = Array.from(new Set([...config.resolver.sourceExts, 'mjs', 'cjs']));
config.resolver.assetExts = Array.from(new Set([...config.resolver.assetExts, 'wasm']));

// 4. Enable unstable package exports support for better ESM compatibility
config.resolver.unstable_enablePackageExports = true;

// 5. Add COEP/COOP headers required by expo-sqlite (SharedArrayBuffer) in web dev server
const prevEnhanceMiddleware = config.server?.enhanceMiddleware;
config.server = config.server || {};
config.server.enhanceMiddleware = (middleware, metroServer) => {
  const enhanced = prevEnhanceMiddleware ? prevEnhanceMiddleware(middleware, metroServer) : middleware;
  return (req, res, next) => {
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    return enhanced(req, res, next);
  };
};

module.exports = config;
