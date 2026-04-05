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

// NOTE: Do NOT enable unstable_enablePackageExports here.
// @sentry/react-native@8.x is a pnpm symlink that resolves fine via the "main"
// field but breaks under the exports-field resolver (Metro can't follow symlinks
// to the pnpm store when exports mode is active). Leaving it at the default
// (false) keeps Metro on the proven "main"-field resolution path for all packages.

// Expose the pnpm virtual store so Metro can resolve packages that are
// siblings of a symlinked package (e.g. expo-modules-core next to expo).
config.watchFolders = [
  ...(config.watchFolders ?? []),
  path.resolve(__dirname, 'node_modules/.pnpm'),
];

module.exports = config;
