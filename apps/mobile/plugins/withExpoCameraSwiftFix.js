/**
 * withExpoCameraSwiftFix.js
 *
 * Adds a Podfile post_install hook that sets:
 *   SWIFT_STRICT_CONCURRENCY = minimal
 *   SWIFT_OPTIMIZATION_LEVEL = -Onone
 * for the ExpoCamera pod on Release builds.
 *
 * Background: expo-camera@15.x was written for Swift 5 concurrency semantics.
 * Xcode 16 (macos-latest GitHub runner) enforces Swift 6 strict-concurrency by
 * default in Release's -O whole-module optimisation pass, causing SwiftCompile to
 * fail with "actor-isolated" or "sendable" errors in CameraView.swift and related
 * files. Setting these two flags per-target lets ExpoCamera compile without
 * requiring source-level Swift 6 annotations.
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
      config.build_settings['SWIFT_STRICT_CONCURRENCY'] = 'minimal'
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
