/**
 * Expo Config Plugin: Exclude legacy com.android.support from all Gradle configurations
 *
 * WHY THIS EXISTS:
 * - android.enableJetifier=true rewrites third-party bytecode to use androidx.*
 *   class names, but it does NOT remove the old com.android.support JARs from
 *   Gradle's resolved classpath.
 * - When a dependency (e.g. LiveKit) transitively pulls in com.android.support:
 *   support-compat:25.3.1 or support-media-compat:25.3.1, those JARs land on
 *   the compile classpath alongside the real AndroidX JARs (core-1.16.0,
 *   media-1.4.3), producing BUILD FAILED "Duplicate class" errors.
 * - Adding  configurations.all { exclude group: "com.android.support" }
 *   in app/build.gradle tells Gradle never to resolve those legacy JARs.
 *   This is safe because Jetifier has already rewritten every consumer to use
 *   androidx.* import paths.
 *
 * NOTE: /android is gitignored (Expo convention). This plugin regenerates the
 *       fix on every `expo prebuild` / EAS local build automatically.
 */

const { withAppBuildGradle } = require('@expo/config-plugins');

const EXCLUDE_BLOCK = `
// Exclude legacy com.android.support JARs to prevent duplicate-class errors.
// Jetifier (android.enableJetifier=true in gradle.properties) rewrites all
// third-party bytecode to androidx.* class names but does not remove the old
// support JARs from Gradle's classpath.  Both old and new JARs would otherwise
// resolve simultaneously, causing BUILD FAILED "Duplicate class" errors.
configurations.all {
    exclude group: "com.android.support"
}
`;

const withAndroidSupportExclude = (config) => {
  return withAppBuildGradle(config, (config) => {
    let buildGradle = config.modResults.contents;

    // Idempotent: only inject once
    if (buildGradle.includes('exclude group: "com.android.support"')) {
      return config;
    }

    // Append before the dependencies { } block
    buildGradle = buildGradle.replace(
      /^(dependencies\s*\{)/m,
      `${EXCLUDE_BLOCK}\n$1`
    );

    config.modResults.contents = buildGradle;
    return config;
  });
};

module.exports = withAndroidSupportExclude;
