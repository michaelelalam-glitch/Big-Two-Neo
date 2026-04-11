// Metro configuration for Expo SDK 54 with pnpm.
// pnpm uses symlinks in node_modules; without this config Metro fails to
// resolve packages (e.g. expo-camera) because their symlink targets live in
// the pnpm virtual store under node_modules/.pnpm/. Adding the virtual store
// to watchFolders lets Metro traverse it and resolve transitive dependencies.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

let config = getDefaultConfig(__dirname);

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

// Map optional native peer dependencies to a throwing stub so Metro can always
// resolve them at bundle time. When the real package is absent from node_modules,
// Metro would otherwise fail the bundle before any try/catch can run. The stub
// throws at runtime so the try/catch in attestation.ts catches it and returns null.
// To activate a flow: add the package to optionalDependencies, run pnpm install,
// then remove its entry here.
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  '@infominds/react-native-play-integrity': require.resolve(
    './src/stubs/optionalModuleStub.js',
  ),
  'react-native-app-attest': require.resolve(
    './src/stubs/optionalModuleStub.js',
  ),
};

// P8-4 FIX: Integrate Sentry source map support so production stack traces
// remain readable. Wrapped in try/catch for graceful degradation — if
// @sentry/react-native is absent (e.g. bare Expo Go workflow), the build
// continues without source map upload rather than failing the bundle.
try {
  const { withSentryConfig } = require('@sentry/react-native/metro');
  config = withSentryConfig(config);
} catch {
  // @sentry/react-native not available or does not export withSentryConfig —
  // continue without Sentry Metro integration.
}

module.exports = config;
