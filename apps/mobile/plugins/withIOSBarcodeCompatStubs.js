/**
 * withIOSBarcodeCompatStubs.js
 *
 * Creates stub Objective-C header files for the barcode-scanner interfaces that
 * were removed from expo-modules-core@3.x (Expo SDK 54) but are still
 * referenced by expo-barcode-scanner@14.x and expo-camera@15.x iOS code:
 *
 *   #import <ExpoModulesCore/EXBarcodeScannerInterface.h>
 *   #import <ExpoModulesCore/EXBarcodeScannerProviderInterface.h>
 *
 * Without these stubs, the EXBarCodeScanner pod fails to build:
 *   error: 'ExpoModulesCore/EXBarcodeScannerInterface.h' file not found
 *
 * The stubs declare the full @protocol methods that expo-camera's
 * CameraViewLegacy.swift calls at runtime. This allows the legacy camera Swift
 * code to compile without excluding it (which would break ExpoModulesProvider).
 *
 * Companion to ./withBarcodeCompatStubs.js which handles Android Java stubs.
 */

const { withDangerousMod } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

const STUB_SCANNER_INTERFACE = `\
// Stub header — EXBarcodeScannerInterface was removed from expo-modules-core@3.x.
// Created by withIOSBarcodeCompatStubs plugin for expo-barcode-scanner@14.x compat.
// Method signatures match the original protocol so CameraViewLegacy.swift can compile.
#import <Foundation/Foundation.h>
#import <AVFoundation/AVFoundation.h>

@protocol EXBarCodeScannerInterface <NSObject>

- (void)setSession:(AVCaptureSession *)session;
- (void)setSessionQueue:(dispatch_queue_t)sessionQueue;
- (void)setOnBarCodeScanned:(void (^)(NSDictionary *))onBarCodeScanned;
- (void)setIsEnabled:(BOOL)enabled;
- (void)setSettings:(NSDictionary<NSString *, id> *)settings;
- (void)setPreviewLayer:(AVCaptureVideoPreviewLayer *)previewLayer;
- (void)maybeStartBarCodeScanning;
- (void)stopBarCodeScanning;

@end
`;

const STUB_PROVIDER_INTERFACE = `\
// Stub header — EXBarcodeScannerProviderInterface was removed from expo-modules-core@3.x.
// Created by withIOSBarcodeCompatStubs plugin for expo-barcode-scanner@14.x compat.
#import <Foundation/Foundation.h>

@protocol EXBarCodeScannerInterface;

@protocol EXBarCodeScannerProviderInterface <NSObject>

- (id<EXBarCodeScannerInterface>)createBarCodeScanner;

@end
`;

module.exports = function withIOSBarcodeCompatStubs(config) {
  return withDangerousMod(config, [
    'ios',
    (modConfig) => {
      // Resolve the expo-modules-core iOS directory in node_modules.
      let expoModulesCoreIos;
      try {
        const corePackageJson = require.resolve('expo-modules-core/package.json', {
          paths: [modConfig.modRequest.projectRoot],
        });
        expoModulesCoreIos = path.join(path.dirname(corePackageJson), 'ios');
      } catch {
        console.warn(
          '[withIOSBarcodeCompatStubs] Could not resolve expo-modules-core — skipping iOS barcode stubs.',
        );
        return modConfig;
      }

      // ExpoModulesCore.podspec uses: s.source_files = 'ios/**/*.{h,m,mm,swift,cpp}'
      // So any .h file under ios/ will be automatically included as a public header.
      const stubDir = path.join(expoModulesCoreIos, 'Interfaces', 'BarcodeScanner');
      fs.mkdirSync(stubDir, { recursive: true });

      const scannerPath = path.join(stubDir, 'EXBarcodeScannerInterface.h');
      fs.writeFileSync(scannerPath, STUB_SCANNER_INTERFACE);

      const providerPath = path.join(stubDir, 'EXBarcodeScannerProviderInterface.h');
      fs.writeFileSync(providerPath, STUB_PROVIDER_INTERFACE);

      return modConfig;
    },
  ]);
};
