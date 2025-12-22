/**
 * Mock for expo-screen-orientation
 */

export const Orientation = {
  PORTRAIT_UP: 1,
  LANDSCAPE_LEFT: 3,
  LANDSCAPE_RIGHT: 4,
};

export const OrientationLock = {
  PORTRAIT_UP: 1,
  LANDSCAPE: 8,
  DEFAULT: 0,
};

export const lockAsync = jest.fn(() => Promise.resolve());
export const unlockAsync = jest.fn(() => Promise.resolve());
export const addOrientationChangeListener = jest.fn(() => ({
  remove: jest.fn(),
}));
export const removeOrientationChangeListener = jest.fn();
export const getOrientationAsync = jest.fn(() => Promise.resolve(Orientation.PORTRAIT_UP));

export default {
  Orientation,
  OrientationLock,
  lockAsync,
  unlockAsync,
  addOrientationChangeListener,
  removeOrientationChangeListener,
  getOrientationAsync,
};
