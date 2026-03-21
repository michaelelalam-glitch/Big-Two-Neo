// Metro configuration for Expo SDK 54 with pnpm.
// pnpm uses symlinks in node_modules; without this config Metro fails to
// resolve packages (e.g. expo-camera) because their symlink targets live in
// the pnpm virtual store under node_modules/.pnpm/. Adding the virtual store
// to watchFolders lets Metro traverse it and resolve transitive dependencies.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Allow Metro to follow pnpm symlinks into the virtual store.
config.resolver.unstable_enableSymlinks = true;

// Task #276: Enable package.json "exports" field resolution for better tree-shaking.
// This lets Metro respect each package's declared entry points (e.g. ESM builds)
// instead of always falling back to the CJS "main" field, reducing dead-code inclusion.
config.resolver.unstable_enablePackageExports = true;

// Expose the pnpm virtual store so Metro can resolve packages that are
// siblings of a symlinked package (e.g. expo-modules-core next to expo).
config.watchFolders = [
  ...(config.watchFolders ?? []),
  path.resolve(__dirname, 'node_modules/.pnpm'),
];

module.exports = config;
