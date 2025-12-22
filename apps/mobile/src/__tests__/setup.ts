/**
 * Jest setup file - runs before all tests
 * Sets up global mocks and test environment
 */

// Declare global namespace for Node.js global object
declare const global: typeof globalThis & {
  __DEV__: boolean;
};

// Define __DEV__ global for React Native (already declared by react-native)
if (typeof global.__DEV__ === 'undefined') {
  global.__DEV__ = process.env.NODE_ENV !== 'production';
}

// Mock console methods to reduce noise in test output
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Mock react-native-reanimated
jest.mock('react-native-reanimated', () => {
  const Reanimated = require('react-native-reanimated/mock');
  Reanimated.default.call = () => {};
  return Reanimated;
});
