/**
 * withBarcodeCompatStubs.js
 *
 * Expo config plugin that creates a local Android library providing stub
 * implementations of expo.modules.interfaces.barcodescanner.* classes.
 *
 * Background:
 *   - expo-camera@15.0.16 and expo-barcode-scanner@14.0.1 import from
 *     expo.modules.interfaces.barcodescanner.* (BarCodeScannerResult,
 *     BarCodeScannerInterface, BarCodeScannerSettings, BarCodeScannerProviderInterface).
 *   - In expo-modules-core@3.x (SDK 54), these interfaces were removed because
 *     expo-barcode-scanner was deprecated, but the published npm packages still
 *     reference them, causing compileDebugKotlin BUILD FAILED.
 *   - This plugin creates a tiny Android library ':barcode-compat' with stub
 *     class definitions, then injects it as a dependency into expo-camera and
 *     expo-barcode-scanner via a Gradle subprojects hook in the root build.gradle.
 */

const {
  withSettingsGradle,
  withDangerousMod,
} = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

const LIB_NAME = 'barcode-compat';

// ── Stub Kotlin source files ───────────────────────────────────────────────

const STUB_BUILD_GRADLE = `\
apply plugin: 'com.android.library'
apply plugin: 'kotlin-android'

android {
    namespace "expo.modules.interfaces.barcodescanner.compat"
    compileSdkVersion 35
    defaultConfig {
        minSdkVersion 24
    }
    kotlin {
        jvmToolchain(17)
    }
}

dependencies {
}
`;

const STUB_BARCODE_SCANNER_RESULT = `\
package expo.modules.interfaces.barcodescanner

class BarCodeScannerResult(
    val type: Int,
    val value: String,
    val raw: String,
    var cornerPoints: MutableList<Int>,
    var referenceImageWidth: Int,
    var referenceImageHeight: Int
) {
    data class BoundingBox(val x: Int, val y: Int, val width: Int, val height: Int)

    val boundingBox: BoundingBox
        get() {
            if (cornerPoints.isEmpty()) return BoundingBox(0, 0, 0, 0)
            var minX = Int.MAX_VALUE; var minY = Int.MAX_VALUE
            var maxX = Int.MIN_VALUE; var maxY = Int.MIN_VALUE
            var i = 0
            while (i < cornerPoints.size) {
                val cx = cornerPoints[i]; val cy = cornerPoints[i + 1]
                if (cx < minX) minX = cx; if (cx > maxX) maxX = cx
                if (cy < minY) minY = cy; if (cy > maxY) maxY = cy
                i += 2
            }
            return BoundingBox(minX, minY, maxX - minX, maxY - minY)
        }
}
`;

const STUB_BARCODE_SCANNER_INTERFACE = `\
package expo.modules.interfaces.barcodescanner

import android.graphics.Bitmap

interface BarCodeScannerInterface {
    fun scan(imageData: ByteArray, width: Int, height: Int, rotation: Int): BarCodeScannerResult?
    fun scanMultiple(bitmap: Bitmap): List<BarCodeScannerResult>
    fun setSettings(settings: BarCodeScannerSettings?)
}
`;

const STUB_BARCODE_SCANNER_SETTINGS = `\
package expo.modules.interfaces.barcodescanner

class BarCodeScannerSettings(settingsMap: Map<String, Any?>? = null) {
    var types: Any? = null
        private set

    init {
        settingsMap?.get("barCodeTypes")?.let { putTypes(it) }
    }

    fun putTypes(barCodeTypes: Any?) {
        types = barCodeTypes
    }
}
`;

const STUB_BARCODE_SCANNER_PROVIDER_INTERFACE = `\
package expo.modules.interfaces.barcodescanner

import android.content.Context

interface BarCodeScannerProviderInterface {
    fun createBarCodeDetectorWithContext(context: Context): BarCodeScannerInterface
}
`;

// ── Dependency line injected into node_modules build.gradle files ─────────

const BARCODE_COMPAT_DEP = `  api project(':${LIB_NAME}') // [barcode-compat-stubs]\n`;

// ── Plugin implementation ─────────────────────────────────────────────────

module.exports = function withBarcodeCompatStubs(config) {
  // Step 1: Create the stub Android library files on prebuild
  config = withDangerousMod(config, [
    'android',
    (modConfig) => {
      const platformRoot = modConfig.modRequest.platformProjectRoot; // .../android
      const libDir = path.join(platformRoot, LIB_NAME);
      const srcDir = path.join(
        libDir,
        'src',
        'main',
        'java',
        'expo',
        'modules',
        'interfaces',
        'barcodescanner'
      );

      fs.mkdirSync(srcDir, { recursive: true });

      fs.writeFileSync(path.join(libDir, 'build.gradle'), STUB_BUILD_GRADLE);
      fs.writeFileSync(
        path.join(srcDir, 'BarCodeScannerResult.kt'),
        STUB_BARCODE_SCANNER_RESULT
      );
      fs.writeFileSync(
        path.join(srcDir, 'BarCodeScannerInterface.kt'),
        STUB_BARCODE_SCANNER_INTERFACE
      );
      fs.writeFileSync(
        path.join(srcDir, 'BarCodeScannerSettings.kt'),
        STUB_BARCODE_SCANNER_SETTINGS
      );
      fs.writeFileSync(
        path.join(srcDir, 'BarCodeScannerProviderInterface.kt'),
        STUB_BARCODE_SCANNER_PROVIDER_INTERFACE
      );

      // Step 3b: Directly patch expo-camera and expo-barcode-scanner build.gradle
      // This avoids the Gradle afterEvaluate timing issue.
      const projectRoot = modConfig.modRequest.projectRoot; // .../apps/mobile
      const targets = [
        path.join(projectRoot, 'node_modules', 'expo-camera', 'android', 'build.gradle'),
        path.join(projectRoot, 'node_modules', 'expo-barcode-scanner', 'android', 'build.gradle'),
      ];

      for (const target of targets) {
        if (!fs.existsSync(target)) continue;
        let contents = fs.readFileSync(target, 'utf8');
        if (contents.includes('[barcode-compat-stubs]')) continue; // already patched
        // Inject after "dependencies {" opening line
        contents = contents.replace(
          /^(dependencies\s*\{)/m,
          `$1\n${BARCODE_COMPAT_DEP}`
        );
        fs.writeFileSync(target, contents);
      }

      return modConfig;
    },
  ]);

  // Step 2: Include :barcode-compat in settings.gradle
  config = withSettingsGradle(config, (modConfig) => {
    if (!modConfig.modResults.contents.includes(`:${LIB_NAME}`)) {
      modConfig.modResults.contents +=
        `\ninclude ':${LIB_NAME}'` +
        `\nproject(':${LIB_NAME}').projectDir = new File(rootDir, '${LIB_NAME}')\n`;
    }
    return modConfig;
  });

  return config;
};
