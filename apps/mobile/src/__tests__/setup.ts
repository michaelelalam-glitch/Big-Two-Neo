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

// Polyfill requestAnimationFrame/cancelAnimationFrame for Node.js test environment
// Components like AutoPassTimer use rAF for smooth countdown rendering
if (typeof global.requestAnimationFrame === 'undefined') {
  (global as any).requestAnimationFrame = (cb: FrameRequestCallback): number => setTimeout(cb, 0) as unknown as number;
  (global as any).cancelAnimationFrame = (id: number): void => clearTimeout(id);
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
  const React = require('react');
  const ReactNative = require('react-native');
  
  const AnimatedView = React.forwardRef((props: any, ref: any) => {
    return React.createElement(ReactNative.View, { ...props, ref });
  });
  const AnimatedText = React.forwardRef((props: any, ref: any) => {
    return React.createElement(ReactNative.Text, { ...props, ref });
  });
  const AnimatedScrollView = React.forwardRef((props: any, ref: any) => {
    return React.createElement(ReactNative.ScrollView, { ...props, ref });
  });
  
  return {
    __esModule: true,
    default: {
      View: AnimatedView,
      Text: AnimatedText,
      ScrollView: AnimatedScrollView,
      createAnimatedComponent: (Component: any) => Component,
    },
    useSharedValue: jest.fn((initial) => ({ value: initial })),
    useAnimatedStyle: jest.fn((fn) => fn()),
    withTiming: jest.fn((value) => value),
    withSpring: jest.fn((value) => value),
    runOnJS: jest.fn((fn) => fn),
    Easing: { bezier: jest.fn() },
  };
});

// Mock react-native-gesture-handler
jest.mock('react-native-gesture-handler', () => {
  return {
    Gesture: {
      Tap: jest.fn(() => ({
        enabled: jest.fn().mockReturnThis(),
        maxDuration: jest.fn().mockReturnThis(),
        onStart: jest.fn().mockReturnThis(),
        onEnd: jest.fn().mockReturnThis(),
      })),
      Pan: jest.fn(() => ({
        enabled: jest.fn().mockReturnThis(),
        minDistance: jest.fn().mockReturnThis(),
        onStart: jest.fn().mockReturnThis(),
        onUpdate: jest.fn().mockReturnThis(),
        onEnd: jest.fn().mockReturnThis(),
        onChange: jest.fn().mockReturnThis(),
      })),
      LongPress: jest.fn(() => ({
        enabled: jest.fn().mockReturnThis(),
        minDuration: jest.fn().mockReturnThis(),
        onStart: jest.fn().mockReturnThis(),
        onEnd: jest.fn().mockReturnThis(),
        onFinalize: jest.fn().mockReturnThis(),
      })),
      Simultaneous: jest.fn((...gestures) => ({
        gestures,
        type: 'simultaneous',
      })),
      Exclusive: jest.fn((...gestures) => ({
        gestures,
        type: 'exclusive',
      })),
    },
    GestureDetector: ({ children }: any) => children,
    GestureHandlerRootView: ({ children }: any) => children,
  };
});
