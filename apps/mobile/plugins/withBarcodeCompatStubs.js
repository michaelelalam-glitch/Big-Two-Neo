/**
 * withBarcodeCompatStubs.js
 *
 * Creates a local Android library providing Java stub implementations of
 * expo.modules.interfaces.barcodescanner.* classes removed in expo-modules-core@3.x.
 *
 * Stubs are intentionally written in JAVA (not Kotlin) so all types appear as
 * platform types (T!) from Kotlin's perspective, resolving the null-safety
 * contradiction where some Kotlin callers need String? and others need String
 * for the same BarCodeScannerResult fields.
 */

const { withSettingsGradle, withDangerousMod, withProjectBuildGradle } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

const LIB_NAME = 'barcode-compat';

const STUB_BUILD_GRADLE = `apply plugin: 'com.android.library'

android {
    namespace "expo.modules.interfaces.barcodescanner.compat"
    // Use rootProject.ext values (set by expo-root-project from android.*
    // gradle.properties) to stay aligned with the app's SDK targets.
    // Fall back to hardcoded defaults (compileSdk 35, minSdk 24) if ext
    // properties haven't been set yet — e.g. during isolated project eval.
    compileSdkVersion rootProject.ext.has('compileSdkVersion')
        ? rootProject.ext.compileSdkVersion.toInteger()
        : 35
    defaultConfig {
        minSdkVersion rootProject.ext.has('minSdkVersion')
            ? rootProject.ext.minSdkVersion.toInteger()
            : 24
    }
    compileOptions {
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
    }
}
dependencies {}
`;

const STUB_RESULT = `package expo.modules.interfaces.barcodescanner;
import java.util.List;
public class BarCodeScannerResult {
    public static class BoundingBox {
        public final int x, y, width, height;
        public BoundingBox(int x, int y, int width, int height) {
            this.x=x; this.y=y; this.width=width; this.height=height;
        }
    }
    public final int type;
    public final String value;
    public final String raw;
    public List<Integer> cornerPoints;
    public final int referenceImageWidth;
    public final int referenceImageHeight;
    public BarCodeScannerResult(int type, String value, String raw,
            List<Integer> cornerPoints, int referenceImageWidth, int referenceImageHeight) {
        this.type=type; this.value=value; this.raw=raw;
        this.cornerPoints=cornerPoints;
        this.referenceImageWidth=referenceImageWidth;
        this.referenceImageHeight=referenceImageHeight;
    }
    public BoundingBox getBoundingBox() {
        if (cornerPoints==null||cornerPoints.isEmpty()) return new BoundingBox(0,0,0,0);
        int minX=Integer.MAX_VALUE,minY=Integer.MAX_VALUE;
        int maxX=Integer.MIN_VALUE,maxY=Integer.MIN_VALUE;
        for (int i=0;i+1<cornerPoints.size();i+=2) {
            int cx=cornerPoints.get(i),cy=cornerPoints.get(i+1);
            if(cx<minX)minX=cx; if(cx>maxX)maxX=cx;
            if(cy<minY)minY=cy; if(cy>maxY)maxY=cy;
        }
        return new BoundingBox(minX,minY,maxX-minX,maxY-minY);
    }
}
`;

const STUB_INTERFACE = `package expo.modules.interfaces.barcodescanner;
import android.graphics.Bitmap;
import java.util.List;
public interface BarCodeScannerInterface {
    BarCodeScannerResult scan(byte[] imageData, int width, int height, int rotation);
    List<BarCodeScannerResult> scanMultiple(Bitmap bitmap);
    void setSettings(BarCodeScannerSettings settings);
}
`;

const STUB_SETTINGS = `package expo.modules.interfaces.barcodescanner;
import java.util.Map;
public class BarCodeScannerSettings {
    public Object types;
    public BarCodeScannerSettings() {}
    public BarCodeScannerSettings(Map<String,Object> settingsMap) {
        if (settingsMap!=null&&settingsMap.containsKey("barCodeTypes"))
            putTypes(settingsMap.get("barCodeTypes"));
    }
    public void putTypes(Object barCodeTypes) { this.types=barCodeTypes; }
}
`;

const STUB_PROVIDER = `package expo.modules.interfaces.barcodescanner;
import android.content.Context;
public interface BarCodeScannerProviderInterface {
    BarCodeScannerInterface createBarCodeDetectorWithContext(Context context);
}
`;

// Minimal manifest required by Android Gradle Plugin for library modules.
// Without it, AGP fails with "manifest file does not exist" during prebuild.
const STUB_MANIFEST = `<manifest xmlns:android="http://schemas.android.com/apk/res/android" />
`;

// Injected via withProjectBuildGradle (subprojects hook) rather than patching
// node_modules directly — avoids dirty working copy / read-only env failures
// (Copilot PR-149 r2946350505).
const SUBPROJECTS_BLOCK = `
// [barcode-compat-stubs] inject compileOnly dep into expo-camera without editing node_modules
subprojects { subproject ->
    afterEvaluate {
        if (subproject.name == 'expo-camera') {
            dependencies {
                compileOnly project(':${LIB_NAME}') // [barcode-compat-stubs]
            }
        }
    }
}
`;

module.exports = function withBarcodeCompatStubs(config) {
  config = withDangerousMod(config, [
    'android',
    (modConfig) => {
      const platformRoot = modConfig.modRequest.platformProjectRoot;
      const libDir = path.join(platformRoot, LIB_NAME);
      const srcDir = path.join(libDir,'src','main','java','expo','modules','interfaces','barcodescanner');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(libDir, 'build.gradle'), STUB_BUILD_GRADLE);
      fs.writeFileSync(path.join(libDir, 'src', 'main', 'AndroidManifest.xml'), STUB_MANIFEST);
      fs.writeFileSync(path.join(srcDir, 'BarCodeScannerResult.java'), STUB_RESULT);
      fs.writeFileSync(path.join(srcDir, 'BarCodeScannerInterface.java'), STUB_INTERFACE);
      fs.writeFileSync(path.join(srcDir, 'BarCodeScannerSettings.java'), STUB_SETTINGS);
      fs.writeFileSync(path.join(srcDir, 'BarCodeScannerProviderInterface.java'), STUB_PROVIDER);

      return modConfig;
    },
  ]);

  // Inject compileOnly dep into expo-camera via a subprojects hook in
  // android/build.gradle. Using withProjectBuildGradle avoids patching files
  // under node_modules, which is brittle across version updates and fails in
  // read-only build environments (Copilot PR-149 r2946350505).
  //
  // IMPORTANT: the block must be inserted BEFORE `apply plugin: "expo-root-project"`
  // so that the afterEvaluate hooks are registered before expo-root-project
  // eagerly configures (evaluates) subprojects. Appending to the END of
  // build.gradle causes "Cannot run afterEvaluate when project is already
  // evaluated" on Gradle 7+ (Copilot PR-169 snapshot-fix).
  config = withProjectBuildGradle(config, (modConfig) => {
    if (!modConfig.modResults.contents.includes('[barcode-compat-stubs]')) {
      const original = modConfig.modResults.contents;
      // Insert immediately before the first `apply plugin:` statement so the
      // subprojects afterEvaluate hook is registered prior to evaluation.
      modConfig.modResults.contents = original.replace(
        /^(\s*apply plugin:\s*["']expo-root-project["'])/m,
        `${SUBPROJECTS_BLOCK}\n$1`
      );
      // Safety: if the expected marker line was absent (non-standard prebuild
      // output), fall back to appending so the hook is still injected rather
      // than silently lost — and emit a warning so the issue is discoverable.
      if (modConfig.modResults.contents === original) {
        console.warn(
          '[withBarcodeCompatStubs] Could not find "apply plugin: expo-root-project" ' +
          'in android/build.gradle — falling back to append. The afterEvaluate ' +
          'hook may fail on Gradle 7+ if subprojects are already evaluated.'
        );
        modConfig.modResults.contents += SUBPROJECTS_BLOCK;
      }
    }
    return modConfig;
  });

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
