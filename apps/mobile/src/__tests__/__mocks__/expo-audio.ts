/**
 * Mock for expo-audio module (replacement for expo-av Audio)
 *
 * Each createAudioPlayer() call returns a fresh object with independent jest.fn()
 * instances so that call counts / state cannot bleed between different players
 * in the same test run.
 */

const createMockPlayer = () => ({
  volume: 1.0,
  playing: false,
  paused: true,
  muted: false,
  loop: false,
  isLoaded: true,
  currentTime: 0,
  duration: 0,
  play: jest.fn(),
  pause: jest.fn(),
  remove: jest.fn(),
  replace: jest.fn(),
  seekTo: jest.fn(() => Promise.resolve()),
  addListener: jest.fn(() => ({ remove: jest.fn() })),
  removeAllListeners: jest.fn(),
});

export const createAudioPlayer = jest.fn(() => createMockPlayer());

export const setAudioModeAsync = jest.fn(() => Promise.resolve());

export const setIsAudioActiveAsync = jest.fn(() => Promise.resolve());

export const useAudioPlayer = jest.fn(() => createMockPlayer());

export const AudioPlayer = jest.fn(() => createMockPlayer());

// Permission APIs (replacement for expo-av Audio.getPermissionsAsync / Audio.requestPermissionsAsync)
export const getRecordingPermissionsAsync = jest.fn(() =>
  Promise.resolve({ status: 'granted', canAskAgain: true, expires: 'never', granted: true })
);
export const requestRecordingPermissionsAsync = jest.fn(() =>
  Promise.resolve({ status: 'granted', canAskAgain: true, expires: 'never', granted: true })
);

export default {
  createAudioPlayer,
  setAudioModeAsync,
  setIsAudioActiveAsync,
  useAudioPlayer,
  AudioPlayer,
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
};
