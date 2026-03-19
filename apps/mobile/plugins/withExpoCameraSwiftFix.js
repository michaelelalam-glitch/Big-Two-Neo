/**
 * withExpoCameraSwiftFix.js
 *
 * Adds a Podfile post_install hook that sets per-configuration build settings
 * for the ExpoCamera pod to fix two categories of Swift compile errors on Xcode 16:
 *
 * 1. Swift 6 strict-concurrency errors (CameraView.swift)
 *    expo-camera@15.x was written for Swift 5 concurrency semantics. Xcode 16
 *    enforces Swift 6 strict-concurrency by default in its whole-module
 *    optimisation pass, causing SwiftCompile to fail with "actor-isolated" or
 *    "sendable" errors in CameraView.swift and related files.
 *
 * 2. Legacy camera compile errors (CameraViewLegacy.swift)
 *    CameraViewLegacy.swift references EXBarCodeScannerInterface and
 *    EXBarCodeScannerProviderInterface from the expo-barcode-scanner ObjC layer,
 *    plus uses Swift API shapes that changed in Xcode 16 (DispatchWorkItem
 *    trailing-closure overload resolution). These types are no longer exported
 *    by expo-barcode-scanner@14.x on Xcode 16, causing BUILD FAILED:
 *      - cannot find type 'EXBarCodeScannerInterface' in scope
 *      - cannot find type 'EXBarCodeScannerProviderInterface' in scope
 *      - trailing closure passed to parameter of type 'DispatchWorkItem'
 *    Excluding the file is safe: modern iOS 16+ devices use CameraView.swift;
 *    the legacy path is only reachable on iOS ≤ 15 which is below Expo SDK 54's
 *    minimum deployment target.
 *
 * Settings applied:
 *   SWIFT_STRICT_CONCURRENCY = minimal    — ALL configurations (Debug + Release)
 *   EXCLUDED_SOURCE_FILE_NAMES           — ALL configurations (Debug + Release)
 *     = CameraViewLegacy.swift             CameraViewLegacy.swift: has missing deps
 *       CameraViewLegacyModule.swift       CameraViewLegacyModule.swift: refs CameraViewLegacy
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
${MARKER} — fix Swift 6 strict-concurrency and Legacy camera compile errors for ExpoCamera on Xcode 16.
  installer.pods_project.targets.each do |target|
    next unless target.name == 'ExpoCamera'
    target.build_configurations.each do |config|
      # SWIFT_STRICT_CONCURRENCY = minimal: suppress Swift 6 actor-isolation /
      # Sendable errors in ExpoCamera for ALL configurations (safe — this is a
      # per-target override, not a global project setting).
      config.build_settings['SWIFT_STRICT_CONCURRENCY'] = 'minimal'
      # EXCLUDED_SOURCE_FILE_NAMES: CameraViewLegacy.swift references
      # EXBarCodeScannerInterface / EXBarCodeScannerProviderInterface from
      # expo-barcode-scanner which are not exported on Xcode 16, and uses a
      # DispatchWorkItem trailing-closure overload removed in Swift 5.9+.
      # CameraViewLegacyModule.swift references CameraViewLegacy class directly
      # and must also be excluded to avoid "cannot find type" cascade errors.
      # Excluding both files is safe for iOS 16+ (Expo SDK 54 minimum target);
      # modern devices use CameraView.swift, not the legacy path.
      config.build_settings['EXCLUDED_SOURCE_FILE_NAMES'] = 'CameraViewLegacy.swift CameraViewLegacyModule.swift'
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
