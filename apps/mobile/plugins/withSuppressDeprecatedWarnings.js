/**
 * withSuppressDeprecatedWarnings.js
 *
 * Adds a Podfile post_install hook that suppresses -Wdeprecated-declarations
 * across ALL pod targets. Third-party native libraries (RNReanimated, etc.)
 * use APIs that are deprecated in newer iOS SDKs. Xcode's default in some
 * configurations treats these warnings as errors, breaking EAS CI builds.
 *
 * Settings applied (per target × per configuration):
 *   GCC_WARN_ABOUT_DEPRECATED_FUNCTIONS = NO
 *   OTHER_CFLAGS += -Wno-deprecated-declarations
 */

const { withDangerousMod } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

const MARKER = '# [withSuppressDeprecatedWarnings]';

const HOOK = `
${MARKER} — suppress -Wdeprecated-declarations in all pod targets.
  installer.pods_project.targets.each do |target|
    target.build_configurations.each do |config|
      config.build_settings['GCC_WARN_ABOUT_DEPRECATED_FUNCTIONS'] = 'NO'
      existing = config.build_settings['OTHER_CFLAGS'] || '$(inherited)'
      config.build_settings['OTHER_CFLAGS'] = existing + ' -Wno-deprecated-declarations'
    end
  end
`;

module.exports = function withSuppressDeprecatedWarnings(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const podfilePath = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      if (!fs.existsSync(podfilePath)) {
        console.warn('[withSuppressDeprecatedWarnings] Podfile not found; skipping patch.');
        return cfg;
      }
      let contents = fs.readFileSync(podfilePath, 'utf8');

      // Idempotent: skip if already patched.
      if (contents.includes(MARKER)) return cfg;

      // Insert our hook inside the post_install block, before react_native_post_install
      // (which must remain last). Fall back to appending a new post_install block.
      const postInstallAnchor = 'post_install do |installer|';
      const rnPostInstallCall = '    react_native_post_install(';
      if (contents.includes(postInstallAnchor)) {
        if (contents.includes(rnPostInstallCall)) {
          // Insert immediately before react_native_post_install.
          contents = contents.replace(rnPostInstallCall, HOOK + '\n' + rnPostInstallCall);
        } else {
          // No react_native_post_install found; insert at start of post_install block.
          contents = contents.replace(
            postInstallAnchor + '\n',
            postInstallAnchor + '\n' + HOOK + '\n'
          );
        }
      } else {
        // No post_install block at all; append a new one.
        contents = contents + '\n\npost_install do |installer|\n' + HOOK + '\nend\n';
      }

      fs.writeFileSync(podfilePath, contents);
      return cfg;
    },
  ]);
};
