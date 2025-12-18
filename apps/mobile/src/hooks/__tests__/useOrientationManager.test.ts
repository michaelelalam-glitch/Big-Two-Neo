/**
 * useOrientationManager Hook Tests
 * 
 * Task #450: Add orientation toggle functionality
 * Date: December 18, 2025
 */

import { renderHook, act, waitFor } from '@testing-library/react-native';
import { useOrientationManager } from '../useOrientationManager';
import * as ScreenOrientation from 'expo-screen-orientation';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Mock dependencies
jest.mock('expo-screen-orientation', () => ({
  lockAsync: jest.fn(),
  unlockAsync: jest.fn(),
  addOrientationChangeListener: jest.fn(),
  removeOrientationChangeListener: jest.fn(),
  OrientationLock: {
    PORTRAIT_UP: 3,
    LANDSCAPE: 5,
  },
  Orientation: {
    LANDSCAPE_LEFT: 3,
    LANDSCAPE_RIGHT: 4,
  },
}));
jest.mock('@react-native-async-storage/async-storage');
jest.mock('../../utils/logger', () => ({
  gameLogger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

describe('useOrientationManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('initializes with portrait orientation', () => {
    const { result } = renderHook(() => useOrientationManager());
    
    expect(result.current.currentOrientation).toBe('portrait');
    expect(result.current.isChanging).toBe(false);
    expect(result.current.isLocked).toBe(true);
  });

  it('toggles from portrait to landscape', async () => {
    (ScreenOrientation.lockAsync as jest.Mock).mockResolvedValue(undefined);
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
    
    const { result } = renderHook(() => useOrientationManager());
    
    await act(async () => {
      await result.current.toggleOrientation();
    });
    
    await waitFor(() => {
      expect(result.current.currentOrientation).toBe('landscape');
    });
    
    expect(ScreenOrientation.lockAsync).toHaveBeenCalledWith(
      ScreenOrientation.OrientationLock.LANDSCAPE
    );
  });

  it('toggles from landscape to portrait', async () => {
    (ScreenOrientation.lockAsync as jest.Mock).mockResolvedValue(undefined);
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
    
    const { result } = renderHook(() => useOrientationManager());
    
    // First toggle to landscape
    await act(async () => {
      await result.current.toggleOrientation();
    });
    
    // Then toggle back to portrait
    await act(async () => {
      await result.current.toggleOrientation();
    });
    
    await waitFor(() => {
      expect(result.current.currentOrientation).toBe('portrait');
    });
    
    expect(ScreenOrientation.lockAsync).toHaveBeenCalledWith(
      ScreenOrientation.OrientationLock.PORTRAIT_UP
    );
  });

  it('sets isChanging to true during transition', async () => {
    let resolve: () => void;
    const promise = new Promise<void>((r) => { resolve = r; });
    (ScreenOrientation.lockAsync as jest.Mock).mockReturnValue(promise);
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
    
    const { result } = renderHook(() => useOrientationManager());
    
    act(() => {
      result.current.toggleOrientation();
    });
    
    expect(result.current.isChanging).toBe(true);
    
    await act(async () => {
      resolve!();
      await promise;
    });
    
    await waitFor(() => {
      expect(result.current.isChanging).toBe(false);
    });
  });

  it('persists orientation preference to AsyncStorage', async () => {
    (ScreenOrientation.lockAsync as jest.Mock).mockResolvedValue(undefined);
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
    
    const { result } = renderHook(() => useOrientationManager());
    
    await act(async () => {
      await result.current.setOrientation('landscape');
    });
    
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      '@big2_orientation_preference',
      'landscape'
    );
  });

  it('loads saved orientation preference on mount', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('landscape');
    (ScreenOrientation.lockAsync as jest.Mock).mockResolvedValue(undefined);
    
    const { result } = renderHook(() => useOrientationManager());
    
    await waitFor(() => {
      expect(result.current.currentOrientation).toBe('landscape');
    });
    
    expect(ScreenOrientation.lockAsync).toHaveBeenCalledWith(
      ScreenOrientation.OrientationLock.LANDSCAPE
    );
  });

  it('handles orientation change listener', () => {
    const mockListener = jest.fn();
    (ScreenOrientation.addOrientationChangeListener as jest.Mock).mockReturnValue({
      remove: jest.fn(),
    });
    
    renderHook(() => useOrientationManager());
    
    expect(ScreenOrientation.addOrientationChangeListener).toHaveBeenCalled();
  });

  it('removes orientation change listener on unmount', () => {
    const mockRemove = jest.fn();
    (ScreenOrientation.addOrientationChangeListener as jest.Mock).mockReturnValue({
      remove: mockRemove,
    });
    (ScreenOrientation.removeOrientationChangeListener as jest.Mock).mockImplementation(
      (subscription) => subscription.remove()
    );
    
    const { unmount } = renderHook(() => useOrientationManager());
    
    unmount();
    
    expect(ScreenOrientation.removeOrientationChangeListener).toHaveBeenCalled();
  });

  it('warns and skips when trying concurrent orientation changes', async () => {
    jest.clearAllMocks();
    let firstResolve: () => void;
    const firstPromise = new Promise<void>((r) => { firstResolve = r; });
    (ScreenOrientation.lockAsync as jest.Mock)
      .mockReturnValueOnce(firstPromise)
      .mockResolvedValue(undefined);
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
    
    const { gameLogger } = require('../../utils/logger');
    
    const { result } = renderHook(() => useOrientationManager());
    
    // Start first toggle (doesn't complete yet)
    act(() => {
      result.current.toggleOrientation();
    });
    
    // isChanging should be true
    expect(result.current.isChanging).toBe(true);
    
    // Try second toggle while first is in progress
    await act(async () => {
      await result.current.toggleOrientation();
    });
    
    // Should log a warning about already changing
    expect(gameLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Already changing')
    );
    
    // Complete first toggle
    await act(async () => {
      firstResolve!();
      await firstPromise;
    });
    
    // Lock should have been called for the completed first toggle, not the skipped second
    expect(ScreenOrientation.lockAsync).toHaveBeenCalled();
  });

  it('handles errors gracefully', async () => {
    jest.clearAllMocks();
    const error = new Error('Lock failed');
    (ScreenOrientation.lockAsync as jest.Mock).mockRejectedValue(error);
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
    
    const { result } = renderHook(() => useOrientationManager());
    
    // Wait for initial mount to complete
    await waitFor(() => {
      expect(result.current).toBeDefined();
    });
    
    await act(async () => {
      try {
        await result.current.toggleOrientation();
      } catch (e) {
        // Expected to fail silently
      }
    });
    
    // Should not crash and isChanging should be false
    expect(result.current.isChanging).toBe(false);
  });
});
