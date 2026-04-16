/**
 * withSentryNonFatalUpload.js
 *
 * Makes the "Upload Debug Symbols to Sentry" Xcode build phase non-fatal for
 * non-production builds.
 *
 * PLACEMENT: Must be the FIRST entry in the plugins array in app.json.
 * Expo applies withXcodeProject mods in REVERSE registration order (the outer-
 * most plugin's callback runs last).  Being first means this plugin's
 * withXcodeProject callback runs LAST — after @sentry/react-native/expo has
 * already added the "Upload Debug Symbols to Sentry" build phase.
 *
 * SHELL COMMAND STRUCTURE:
 *   The original Sentry phase runs:
 *     /bin/sh `node --print "...sentry-xcode-debug-files.sh'"`
 *   We patch it to:
 *     /bin/sh `node --print "...sh'"` || { echo '…'; exit 0; }
 *   So sentry-cli failures become warnings rather than build errors.
 *
 *   The xcode library stores shellScript with the pbxproj string wrapper, e.g.:
 *     "/bin/sh `…\"…sentry-xcode-debug-files.sh'\"`"
 *   The \" is a pbxproj-escaped double-quote, the ` after it closes the shell
 *   substitution, and the final " closes the pbxproj string value.
 *   We insert the fallback between the closing ` and the final ".
 *
 * Skipped when EAS_BUILD_PROFILE === 'production'.
 */

const { withXcodeProject } = require('@expo/config-plugins');

const MARKER = '[withSentryNonFatalUpload]';

module.exports = function withSentryNonFatalUpload(config) {
  if (process.env.EAS_BUILD_PROFILE === 'production') return config;

  return withXcodeProject(config, (config) => {
    const xcodeProject = config.modResults;
    const phases =
      xcodeProject.hash.project.objects['PBXShellScriptBuildPhase'] || {};

    let patched = false;

    for (const key of Object.keys(phases)) {
      const phase = phases[key];
      if (!phase || typeof phase !== 'object') continue;

      const name = phase.name || '';
      if (!name.includes('Upload Debug Symbols to Sentry')) continue;

      const script = phase.shellScript;
      if (!script) continue;
      if (script.includes(MARKER)) continue; // idempotent

      if (!script.includes('sentry-xcode-debug-files')) continue;

      // The xcode library stores shellScript WITH the outer pbxproj string
      // wrapping quotes, e.g.:
      //
      //   "/bin/sh `${NODE_BINARY:-node} --print \"…sentry-xcode-debug-files.sh'\"`"
      //
      // Structure (from the end of the string):
      //   …sentry-xcode-debug-files.sh'  ← .sh' in the node --print arg
      //   \"                             ← pbxproj-escaped closing " of node arg
      //   `                              ← closing backtick of the substitution
      //   "                              ← pbxproj closing " of shellScript value
      //
      // We want to insert `|| { …; exit 0; }` AFTER the closing ` and BEFORE
      // the final " so the shell sees:
      //   /bin/sh `node --print "…sh'"` || { …; exit 0; }
      //
      // Regex: capture up to and INCLUDING the closing ` in group1, the
      //        trailing " in group2.  The $ anchor ensures we get the LAST
      //        ` before the final " (the one that closes the substitution).
      const patchedScript = script.replace(
        /(sentry-xcode-debug-files\.sh[^`]*`)("$)/,
        (match, beforeClose, trailingQuote) => {
          patched = true;
          const fallback =
            ` || { echo 'Sentry symbol upload failed (non-fatal) — build continues'; exit 0; }` +
            ` # ${MARKER}`;
          return `${beforeClose}${fallback}${trailingQuote}`;
        },
      );

      if (!patched) {
        console.warn(
          `[withSentryNonFatalUpload] regex did not match shellScript for "${name}".`,
        );
        continue;
      }

      phase.shellScript = patchedScript;
      console.log(`[withSentryNonFatalUpload] Patched "${name}" to be non-fatal.`);
    }

    if (!patched) {
      console.warn(
        '[withSentryNonFatalUpload] No matching Sentry debug-files build phase patched.',
      );
    }

    return config;
  });
};
