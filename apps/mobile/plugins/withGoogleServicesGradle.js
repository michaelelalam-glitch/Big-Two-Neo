/**
 * Expo Config Plugin: Ensure Google Services Plugin is Always Applied
 * 
 * This plugin automatically injects the Google Services gradle plugin
 * into Android build files on EVERY prebuild, ensuring Firebase/FCM
 * notifications work without manual intervention.
 * 
 * WHY THIS EXISTS:
 * - /android folder is not tracked in git (Expo convention)
 * - Manual gradle edits are lost on every 'expo prebuild --clean'
 * - This plugin runs automatically during prebuild to inject configuration
 */

const { withProjectBuildGradle, withAppBuildGradle } = require('@expo/config-plugins');

/**
 * Add Google Services classpath to project-level build.gradle
 */
const withGoogleServicesProjectGradle = (config) => {
  return withProjectBuildGradle(config, (config) => {
    const { modResults } = config;
    let buildGradle = modResults.contents;

    // Check if already added (avoid duplicates)
    if (!buildGradle.includes('com.google.gms:google-services')) {
      // Find the dependencies block and inject the classpath
      const dependenciesRegex = /(dependencies\s*{[^}]*)/;
      
      if (dependenciesRegex.test(buildGradle)) {
        buildGradle = buildGradle.replace(
          dependenciesRegex,
          `$1\n        classpath('com.google.gms:google-services:4.4.0')  // Firebase FCM - Auto-injected by config plugin`
        );
      }
    }

    modResults.contents = buildGradle;
    return config;
  });
};

/**
 * Apply Google Services plugin to app-level build.gradle
 */
const withGoogleServicesAppGradle = (config) => {
  return withAppBuildGradle(config, (config) => {
    const { modResults } = config;
    let buildGradle = modResults.contents;

    // Check if already applied (avoid duplicates)
    if (!buildGradle.includes('com.google.gms.google-services')) {
      // Find where other plugins are applied and add ours
      const applyPluginRegex = /(apply plugin: "com\.facebook\.react")/;
      
      if (applyPluginRegex.test(buildGradle)) {
        buildGradle = buildGradle.replace(
          applyPluginRegex,
          `$1\napply plugin: "com.google.gms.google-services"  // Firebase FCM - Auto-injected by config plugin`
        );
      }
    }

    modResults.contents = buildGradle;
    return config;
  });
};

/**
 * Main plugin export - applies both gradle modifications
 */
const withGoogleServicesGradle = (config) => {
  config = withGoogleServicesProjectGradle(config);
  config = withGoogleServicesAppGradle(config);
  return config;
};

module.exports = withGoogleServicesGradle;
