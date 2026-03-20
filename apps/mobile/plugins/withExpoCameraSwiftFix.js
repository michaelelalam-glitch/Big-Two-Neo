/**
 * withExpoCameraSwiftFix.js
 *
 * Adds a Podfile post_install hook that sets per-configuration build settings
 * for the ExpoCamera pod to fix Swift 6 strict-concurrency compile errors on
 * Xcode 16.
 *
 * expo-camera@15.x was written for Swift 5 concurrency semantics. Xcode 16
 * enforces Swift 6 strict-concurrency by default in its whole-module
 * optimisation pass, causing SwiftCompile to fail with "actor-isolated" or
 * "sendable" errors in CameraView.swift and related files.
 *
 * NOTE: CameraViewLegacy.swift / CameraViewLegacyModule.swift are no longer
 * excluded. The missing ObjC barcode-scanner interfaces they depend on are now
 * provided by withIOSBarcodeCompatStubs.js (stub headers). Keeping them in the
 * build avoids the need to patch the auto-generated ExpoModulesProvider.swift,
 * which is written AFTER post_install by Expo's UserProjectIntegrator.
 *
 * Settings applied:
 *   SWIFT_STRICT_CONCURRENCY = minimal    — ALL configurations (Debug + Release)
 *   SWIFT_OPTIMIZATION_LEVEL = -Onone     — Debug only (skipped for Release)
 */

const { withDangerousMod } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

const MARKER = '# [withExpoCameraSwiftFix]';

const HOOK = `
${MARKER} — fix Swift 6 strict-concurrency errors for ExpoCamera on Xcode 16.
  installer.pods_project.targets.each do |target|
    next unless target.name == 'ExpoCamera'
    target.build_configurations.each do |config|
      # SWIFT_STRICT_CONCURRENCY = minimal: suppress Swift 6 actor-isolation /
      # Sendable errors in ExpoCamera for ALL configurations (safe — this is a
      # per-target override, not a global project setting).
      config.build_settings['SWIFT_STRICT_CONCURRENCY'] = 'minimal'
      # SWIFT_OPTIMIZATION_LEVEL = -Onone: needed only for non-Release builds
      # to work around the Xcode 16 whole-module-optimisation pass that
      # re-surfaces concurrency errors even with strict-concurrency = minimal.
      # Skipped for Release to avoid shipping un-optimised camera code.
      next if config.name == 'Release'
      config.build_settings['SWIFT_OPTIMIZATION_LEVEL'] = '-Onone'
    end
  end
`;

module.exports = function withExpoCameraSwiftFix(config) {
  return withDangerousMod(config, [
    'ios',
    (modConfig) => {
      const podfilePath = path.join(
        modConfig.modRequest.platformProjectRoot,
        'Podfile',
      );

      if (!fs.existsSync(podfilePath)) return modConfig;

      let content = fs.readFileSync(podfilePath, 'utf8');

      // Idempotent — skip if already patched.
      if (content.includes(MARKER)) return modConfig;

      // Prefer injecting into an existing post_install block.
      if (content.includes('post_install do |installer|')) {
        content = content.replace(
          'post_install do |installer|',
          `post_install do |installer|\n${HOOK}`,
        );
      } else {
        // No existing post_install — append one.
        content += `\npost_install do |installer|\n${HOOK}\nend\n`;
      }

      fs.writeFileSync(podfilePath, content);
      return modConfig;
    },
  ]);
};
