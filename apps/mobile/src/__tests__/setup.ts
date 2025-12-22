/**
 * Jest setup file - runs before all tests
 * Sets up global mocks and test environment
 */

// Mock console methods to reduce noise in test output
(global as any).console = {
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

// Mock Animated from react-native for compatibility
jest.mock('react-native/Libraries/Animated/NativeAnimatedHelper');
