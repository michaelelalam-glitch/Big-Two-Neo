/**
 * Mock for expo-camera
 * Prevents native-module resolution errors in Jest (node / non-native) environments.
 *
 * Phase 4 (LiveKit): provides requestCameraPermissionsAsync and
 * getCameraPermissionsAsync so the real iOS permission path in useVideoChat.ts
 * is exercisable in unit tests.
 */

export const Camera = {
  requestCameraPermissionsAsync: jest.fn(() =>
    Promise.resolve({ status: 'granted', canAskAgain: true, expires: 'never', granted: true })
  ),
  getCameraPermissionsAsync: jest.fn(() =>
    Promise.resolve({ status: 'granted', canAskAgain: true, expires: 'never', granted: true })
  ),
};

export enum CameraType {
  front = 'front',
  back = 'back',
}

export enum FlashMode {
  on = 'on',
  off = 'off',
  auto = 'auto',
  torch = 'torch',
}
