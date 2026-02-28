/**
 * useOrientationManager Hook
 * 
 * Manages screen orientation for the game room
 * 
 * Features:
 * - Toggle between portrait and landscape modes
 * - Persist orientation preference
 * - Auto-restore on mount
 * - Handle device rotation events
 * 
 * Task #450: Add orientation toggle functionality (landscape ↔ portrait)
 * Date: December 18, 2025
 */

import { useState, useEffect, useCallback } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { gameLogger } from '../utils/logger';

// Lazy import to handle missing native module gracefully
let ScreenOrientation: typeof import('expo-screen-orientation') | null = null;
let orientationError: string | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy require inside try/catch for graceful degradation when module is unavailable (e.g. Expo Go)
  ScreenOrientation = require('expo-screen-orientation');
  gameLogger.info('✅ [Orientation] expo-screen-orientation module loaded successfully');
} catch (error) {
  orientationError = 'Module not available. Make sure you are using a development build (not Expo Go).';
  gameLogger.warn('⚠️ [Orientation] expo-screen-orientation not available - orientation toggle disabled', error);
  gameLogger.warn('   This feature requires a development build. Run: npm run prebuild && npm run ios');
}

// Storage key for orientation preference
const ORIENTATION_STORAGE_KEY = '@big2_orientation_preference';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type OrientationMode = 'portrait' | 'landscape';

export interface OrientationManagerState {
  /** Current orientation mode */
  currentOrientation: OrientationMode;
  /** Whether orientation is being changed */
  isChanging: boolean;
  /** Toggle between portrait and landscape */
  toggleOrientation: () => Promise<void>;
  /** Set specific orientation */
  setOrientation: (mode: OrientationMode) => Promise<void>;
  /** Check if orientation is locked */
  isLocked: boolean;
  /** Whether orientation control is available (native module loaded) */
  isAvailable: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const ORIENTATION_LOCKS = ScreenOrientation ? {
  portrait: ScreenOrientation.OrientationLock.PORTRAIT_UP,
  landscape: ScreenOrientation.OrientationLock.LANDSCAPE,
} as const : null;

// ============================================================================
// MAIN HOOK
// ============================================================================

export function useOrientationManager(): OrientationManagerState {
  const [currentOrientation, setCurrentOrientation] = useState<OrientationMode>('portrait');
  const [isChanging, setIsChanging] = useState(false);
  const [isLocked, setIsLocked] = useState(true);

  // Load saved orientation preference on mount AND unlock on unmount
  useEffect(() => {
    // Skip if native module not available
    if (!ScreenOrientation) {
      gameLogger.warn('⚠️ [Orientation] Native module not available - using portrait only');
      return;
    }

    loadOrientationPreference();
    
    // Listen for orientation changes
    const subscription = ScreenOrientation.addOrientationChangeListener((event: { orientationInfo: { orientation: number } }) => {
      const orientation = event.orientationInfo.orientation;
      const isLandscape = 
        orientation === ScreenOrientation.Orientation.LANDSCAPE_LEFT ||
        orientation === ScreenOrientation.Orientation.LANDSCAPE_RIGHT;
      
      gameLogger.info(`📱 [Orientation] Device orientation changed: ${isLandscape ? 'landscape' : 'portrait'}`);
    });

    // Ensure orientation is unlocked when leaving GameScreen to restore auto-rotation on other screens
    return () => {
      ScreenOrientation.removeOrientationChangeListener(subscription);
      // Unlock to allow auto-rotation on other screens
      ScreenOrientation.unlockAsync().then(() => {
        gameLogger.info('🔓 [Orientation] Unlocked on component unmount');
      }).catch((error: unknown) => {
        gameLogger.error('❌ [Orientation] Failed to unlock:', error);
      });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only effect; loadOrientationPreference is defined below in the file; adding it would require hoisting or useCallback, neither of which is warranted for a one-time AsyncStorage read
  }, []);

  /**
   * Load orientation preference from storage
   */
  const loadOrientationPreference = async () => {
    try {
      const saved = await AsyncStorage.getItem(ORIENTATION_STORAGE_KEY);
      if (saved) {
        const mode = saved as OrientationMode;
        setCurrentOrientation(mode);
        await applyOrientation(mode);
        gameLogger.info(`📱 [Orientation] Restored preference: ${mode}`);
      }
    } catch (error) {
      gameLogger.error('❌ [Orientation] Failed to load preference:', error);
    }
  };

  /**
   * Save orientation preference to storage
   */
  const saveOrientationPreference = async (mode: OrientationMode) => {
    try {
      await AsyncStorage.setItem(ORIENTATION_STORAGE_KEY, mode);
      gameLogger.info(`💾 [Orientation] Saved preference: ${mode}`);
    } catch (error) {
      gameLogger.error('❌ [Orientation] Failed to save preference:', error);
    }
  };

  /**
   * Apply orientation lock
   */
  const applyOrientation = async (mode: OrientationMode) => {
    // Skip if native module not available
    if (!ScreenOrientation || !ORIENTATION_LOCKS) {
      gameLogger.warn('⚠️ [Orientation] Cannot apply lock - native module not available');
      return;
    }

    try {
      const lock = ORIENTATION_LOCKS[mode];
      await ScreenOrientation.lockAsync(lock);
      setIsLocked(true);
      gameLogger.info(`🔒 [Orientation] Locked to ${mode}`);
    } catch (error) {
      gameLogger.error(`❌ [Orientation] Failed to lock to ${mode}:`, error);
      throw error;
    }
  };

  /**
   * Set specific orientation
   */
  const setOrientation = useCallback(async (mode: OrientationMode) => {
    // Skip if native module not available
    if (!ScreenOrientation) {
      gameLogger.warn('⚠️ [Orientation] Cannot change orientation - native module not available');
      return;
    }

    if (isChanging) {
      gameLogger.warn('⚠️ [Orientation] Already changing, skipping...');
      return;
    }

    setIsChanging(true);
    try {
      gameLogger.info(`🔄 [Orientation] Changing to ${mode}...`);
      
      // Apply orientation lock
      await applyOrientation(mode);
      
      // Update state
      setCurrentOrientation(mode);
      
      // Save preference
      await saveOrientationPreference(mode);
      
      gameLogger.info(`✅ [Orientation] Successfully changed to ${mode}`);
    } catch (error) {
      gameLogger.error(`❌ [Orientation] Failed to change to ${mode}:`, error);
    } finally {
      setIsChanging(false);
    }
  }, [isChanging]);

  /**
   * Toggle between portrait and landscape
   */
  const toggleOrientation = useCallback(async () => {
    gameLogger.info(`🔄 [Orientation] Toggle requested. Current: ${currentOrientation}, Available: ${ScreenOrientation !== null}`);
    
    // Provide user feedback if module not available
    if (!ScreenOrientation) {
      gameLogger.error('❌ [Orientation] expo-screen-orientation module not available');
      gameLogger.error('   Error: ' + (orientationError || 'Unknown error'));
      
      // Show alert to user
      Alert.alert(
        'Orientation Toggle Not Available',
        'This feature requires a development build and does not work in Expo Go.\n\n' +
        'To enable orientation toggle:\n' +
        '1. Run: npm run prebuild\n' +
        '2. Run: npm run ios (or android)\n\n' +
        'For testing, the UI will simulate the layout change.',
        [{ text: 'OK' }]
      );
      
      // Still update state for UI testing purposes (simulates the toggle)
      const newMode: OrientationMode = currentOrientation === 'portrait' ? 'landscape' : 'portrait';
      setCurrentOrientation(newMode);
      gameLogger.info(`📱 [Orientation] State changed to ${newMode} (UI only - no native lock)`);
      return;
    }
    
    const newMode: OrientationMode = currentOrientation === 'portrait' ? 'landscape' : 'portrait';
    await setOrientation(newMode);
  }, [currentOrientation, setOrientation]);

  return {
    currentOrientation,
    isChanging,
    toggleOrientation,
    setOrientation,
    isLocked,
    isAvailable: ScreenOrientation !== null,
  };
}
