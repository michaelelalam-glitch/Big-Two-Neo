/**
 * Mock for expo-av Audio module
 */

export const Audio = {
  Sound: {
    createAsync: jest.fn(() => 
      Promise.resolve({
        sound: {
          playAsync: jest.fn(() => Promise.resolve()),
          stopAsync: jest.fn(() => Promise.resolve()),
          unloadAsync: jest.fn(() => Promise.resolve()),
          setVolumeAsync: jest.fn(() => Promise.resolve()),
        },
        status: { isLoaded: true },
      })
    ),
  },
  setAudioModeAsync: jest.fn(() => Promise.resolve()),
};

export default { Audio };
