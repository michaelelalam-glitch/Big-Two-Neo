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

// Polyfill requestAnimationFrame/cancelAnimationFrame for Node.js test environment.
// Components like AutoPassTimer use rAF for smooth countdown rendering.
// Note: Node.js setTimeout returns NodeJS.Timeout, but the browser API expects a
// numeric handle. The `as unknown as number` cast is intentional — cancelAnimationFrame
// only needs the opaque handle returned by the matching requestAnimationFrame call,
// and clearTimeout accepts both types at runtime. This is test-only infrastructure.
if (typeof global.requestAnimationFrame === 'undefined') {
  (global as any).requestAnimationFrame = (cb: FrameRequestCallback): number =>
    setTimeout(() => cb(Date.now()), 1000 / 60) as unknown as number;
  (global as any).cancelAnimationFrame = (id: number): void => clearTimeout(id);
}

// Mock verbose console methods to reduce noise in test output
// Keep warn and error visible for debugging real issues
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: console.warn,
  error: console.error,
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

// Track real setInterval/setTimeout handles so we can clear them between tests.
//
// WHY GLOBAL INTERCEPTION:
// GameStateManager creates real intervals/timeouts in constructors and module
// initialization code that keep the Jest worker alive after tests complete.
// AutoPassTimer and bot turn scheduling also rely on real timers. Since these
// timers originate from deep inside class methods (not easily injectable), global
// interception is the most reliable way to ensure complete cleanup without
// modifying production code with test-only hooks.
//
// COMPONENTS REQUIRING THIS:
// - GameStateManager (bot turn timers, state save debounce)
// - AutoPassTimer (rAF + setTimeout fallback countdown)
// - useServerBotCoordinator (server fallback, grace period timeout)
//
// MIGRATION PATH:
// If you introduce new components that manage long-lived timers, prefer exposing
// explicit cleanup/dispose methods that tests can call in afterEach/afterAll hooks
// instead of relying on this global interception. When such refactors are feasible
// for existing code, consider migrating to that pattern and then simplifying or
// removing this global timer tracking.
const _realSetInterval = global.setInterval;
const _realClearInterval = global.clearInterval;
const _realSetTimeout = global.setTimeout;
const _realClearTimeout = global.clearTimeout;
const _activeIntervals = new Set<ReturnType<typeof setInterval>>();
const _activeTimeouts = new Set<ReturnType<typeof setTimeout>>();

global.setInterval = ((...args: Parameters<typeof setInterval>) => {
  const id = _realSetInterval(...args);
  _activeIntervals.add(id);
  return id;
}) as typeof setInterval;

global.clearInterval = ((id: ReturnType<typeof setInterval>) => {
  _activeIntervals.delete(id);
  return _realClearInterval(id);
}) as typeof clearInterval;

global.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
  const id = _realSetTimeout(...args);
  _activeTimeouts.add(id);
  return id;
}) as typeof setTimeout;

global.clearTimeout = ((id: ReturnType<typeof setTimeout>) => {
  _activeTimeouts.delete(id);
  return _realClearTimeout(id);
}) as typeof clearTimeout;

// Global afterEach: ensure no hanging timers between tests
afterEach(() => {
  // Clear any pending timers (both real and fake) to prevent hangs
  jest.clearAllTimers();
  // Clear any tracked real intervals/timeouts
  for (const id of _activeIntervals) {
    _realClearInterval(id);
  }
  _activeIntervals.clear();
  for (const id of _activeTimeouts) {
    _realClearTimeout(id);
  }
  _activeTimeouts.clear();
  // Restore real timers if fake timers were enabled per-test
  try { jest.useRealTimers(); } catch { /* already using real timers */ }
});

// Global afterAll: final cleanup before worker exit
afterAll(() => {
  jest.clearAllTimers();
  // Final cleanup of any remaining real handles
  for (const id of _activeIntervals) {
    _realClearInterval(id);
  }
  _activeIntervals.clear();
  for (const id of _activeTimeouts) {
    _realClearTimeout(id);
  }
  _activeTimeouts.clear();
  jest.restoreAllMocks();
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
