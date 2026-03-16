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

const { withSettingsGradle, withDangerousMod } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

const LIB_NAME = 'barcode-compat';

const STUB_BUILD_GRADLE = `apply plugin: 'com.android.library'

android {
    namespace "expo.modules.interfaces.barcodescanner.compat"
    compileSdkVersion 35
    defaultConfig { minSdkVersion 24 }
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

const BARCODE_COMPAT_DEP = `  api project(':${LIB_NAME}') // [barcode-compat-stubs]\n`;

module.exports = function withBarcodeCompatStubs(config) {
  config = withDangerousMod(config, [
    'android',
    (modConfig) => {
      const platformRoot = modConfig.modRequest.platformProjectRoot;
      const libDir = path.join(platformRoot, LIB_NAME);
      const srcDir = path.join(libDir,'src','main','java','expo','modules','interfaces','barcodescanner');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(libDir, 'build.gradle'), STUB_BUILD_GRADLE);
      fs.writeFileSync(path.join(srcDir, 'BarCodeScannerResult.java'), STUB_RESULT);
      fs.writeFileSync(path.join(srcDir, 'BarCodeScannerInterface.java'), STUB_INTERFACE);
      fs.writeFileSync(path.join(srcDir, 'BarCodeScannerSettings.java'), STUB_SETTINGS);
      fs.writeFileSync(path.join(srcDir, 'BarCodeScannerProviderInterface.java'), STUB_PROVIDER);

      // Directly patch expo-camera and expo-barcode-scanner build.gradle
      const projectRoot = modConfig.modRequest.projectRoot;
      const targets = [
        path.join(projectRoot,'node_modules','expo-camera','android','build.gradle'),
        path.join(projectRoot,'node_modules','expo-barcode-scanner','android','build.gradle'),
      ];
      for (const target of targets) {
        if (!fs.existsSync(target)) continue;
        let contents = fs.readFileSync(target, 'utf8');
        if (contents.includes('[barcode-compat-stubs]')) continue;
        contents = contents.replace(/^(dependencies\s*\{)/m, `$1\n${BARCODE_COMPAT_DEP}`);
        fs.writeFileSync(target, contents);
      }
      return modConfig;
    },
  ]);

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
