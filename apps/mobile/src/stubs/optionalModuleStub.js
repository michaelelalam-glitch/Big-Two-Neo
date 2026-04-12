/**
 * Empty stub for optional peer dependencies that are not listed in package.json.
 *
 * Metro resolves string-literal require() calls at bundle time. When an optional
 * native module (e.g. @infominds/react-native-play-integrity, react-native-app-attest)
 * is absent from node_modules, Metro would normally fail the bundle. metro.config.js
 * maps those package names to this stub so bundling always succeeds.
 *
 * At runtime, requiring this stub throws so the try/catch in loadPlayIntegrityModule()
 * / loadAppAttestModule() (attestation.ts) catches the error and returns null,
 * gracefully disabling the attestation flow until the real package is installed.
 *
 * To activate a hardware attestation flow:
 *   1. Add the real package to package.json optionalDependencies.
 *   2. Run pnpm install.
 *   3. Remove the package's entry from metro.config.js extraNodeModules.
 */
// eslint-disable-next-line no-undef
throw new Error(
  'Optional peer dependency not installed. ' +
    'Add the package to optionalDependencies and run pnpm install to activate.',
);
