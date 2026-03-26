import { renderHook } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { useUnlockOrientationOnIos } from '../useUnlockOrientationOnIos';

const mockUnlockAsync = jest.fn(() => Promise.resolve());

jest.mock('expo-screen-orientation', () => ({
  unlockAsync: mockUnlockAsync,
}));

// Save and restore Platform.OS around every test to avoid cross-suite leaks
let platformOSDescriptor: PropertyDescriptor | undefined;
beforeEach(() => {
  platformOSDescriptor = Object.getOwnPropertyDescriptor(Platform, 'OS');
});
afterEach(() => {
  if (platformOSDescriptor) {
    Object.defineProperty(Platform, 'OS', platformOSDescriptor);
  }
});

function setPlatform(os: 'ios' | 'android') {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
}

function makeNavigation() {
  const unsubscribe = jest.fn();
  const addListener = jest.fn(() => unsubscribe);
  return { addListener, unsubscribe };
}

describe('useUnlockOrientationOnIos', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('no-ops on Android — does not call unlockAsync', () => {
    setPlatform('android');
    const nav = makeNavigation();
    renderHook(() => useUnlockOrientationOnIos(nav));
    expect(mockUnlockAsync).not.toHaveBeenCalled();
    expect(nav.addListener).not.toHaveBeenCalled();
  });

  it('calls unlockAsync on mount when on iOS', async () => {
    setPlatform('ios');
    const nav = makeNavigation();
    renderHook(() => useUnlockOrientationOnIos(nav));
    // Flush the async unlock
    await Promise.resolve();
    expect(mockUnlockAsync).toHaveBeenCalledTimes(1);
  });

  it('registers a focus listener on iOS', () => {
    setPlatform('ios');
    const nav = makeNavigation();
    renderHook(() => useUnlockOrientationOnIos(nav));
    expect(nav.addListener).toHaveBeenCalledWith('focus', expect.any(Function));
  });

  it('calls unlockAsync again when focus fires on iOS', async () => {
    setPlatform('ios');
    const nav = makeNavigation();
    renderHook(() => useUnlockOrientationOnIos(nav));
    await Promise.resolve(); // initial unlock
    // Simulate navigation focus
    const focusCallback = nav.addListener.mock.calls[0][1] as () => void;
    focusCallback();
    await Promise.resolve();
    expect(mockUnlockAsync).toHaveBeenCalledTimes(2);
  });

  it('unsubscribes the focus listener on unmount', () => {
    setPlatform('ios');
    const nav = makeNavigation();
    const { unmount } = renderHook(() => useUnlockOrientationOnIos(nav));
    unmount();
    expect(nav.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
