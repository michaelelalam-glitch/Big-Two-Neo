/**
 * Mock for expo-audio module (replacement for expo-av Audio)
 */

const mockPlayer = {
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
};

export const createAudioPlayer = jest.fn(() => ({ ...mockPlayer }));

export const setAudioModeAsync = jest.fn(() => Promise.resolve());

export const setIsAudioActiveAsync = jest.fn(() => Promise.resolve());

export const useAudioPlayer = jest.fn(() => ({ ...mockPlayer }));

export const AudioPlayer = jest.fn(() => ({ ...mockPlayer }));

export default {
  createAudioPlayer,
  setAudioModeAsync,
  setIsAudioActiveAsync,
  useAudioPlayer,
  AudioPlayer,
};
