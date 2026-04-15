// app.config.js — dynamic Expo config that gates build-variant-specific settings
// on top of the static values in app.json.
//
// EAS Build automatically sets EAS_BUILD_PROFILE to the active profile name
// (e.g. "development", "preview", "test", "production").  For local Expo CLI
// runs and non-EAS environments the variable is undefined, which is treated as
// a dev/non-production build.

/** @param {{ config: import('@expo/config-types').ExpoConfig }} param0 */
module.exports = ({ config }) => {
  const isProductionBuild = process.env.EAS_BUILD_PROFILE === 'production';

  return {
    ...config,
    android: {
      ...config.android,
      // usesCleartextTraffic is required on Android development/E2E builds so
      // the Metro bundler (HTTP) can serve the JS bundle.  Production builds
      // should remain HTTPS-only, so we disable it there.
      usesCleartextTraffic: !isProductionBuild,
    },
  };
};
