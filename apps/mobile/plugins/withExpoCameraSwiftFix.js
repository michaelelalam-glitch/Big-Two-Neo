/**
 * withExpoCameraSwiftFix.js
 *
 * Adds a Podfile post_install hook that sets per-configuration build settings
 * for the ExpoCamera pod to suppress Swift 6 strict-concurrency errors on Xcode 16.
 *
 * Background: expo-camera@15.x was written for Swift 5 concurrency semantics.
 * Xcode 16 enforces Swift 6 strict-concurrency by default in its whole-module
 * optimisation pass, causing SwiftCompile to fail with "actor-isolated" or
 * "sendable" errors in CameraView.swift and related files.
 *
 * Settings applied:
 *   SWIFT_STRICT_CONCURRENCY = minimal    — ALL configurations (Debug + Release)
 *   SWIFT_OPTIMIZATION_LEVEL = -Onone     — Debug only (skipped for Release)
 *
 * Rationale for scoping -Onone to non-Release builds only:
 * - Release builds ship to end-users; un-optimised SwiftCode increases binary
 *   size and startup latency. SWIFT_STRICT_CONCURRENCY = minimal is sufficient
 *   to suppress the errors during the Release optimisation pass.
 * - Debug/non-Release builds are only used locally and on CI simulators where
 *   the extra concurrency checking in -O sometimes surfaces false positives;
 *   -Onone eliminates those without affecting shipped performance.
 */

const { withDangerousMod } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

const MARKER = '# [withExpoCameraSwiftFix]';

const HOOK = `
${MARKER} — silence Swift 6 strict-concurrency errors for ExpoCamera on Xcode 16.
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
