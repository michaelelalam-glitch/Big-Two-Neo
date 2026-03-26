/**
 * useUnlockOrientationOnIos — Releases expo-screen-orientation lock on iOS.
 *
 * On iOS, the game screen may leave a portrait lock via expo-screen-orientation.
 * Calling unlockAsync on mount and on every focus event releases that lock so
 * navigation screens display correctly in both orientations.
 *
 * No-op on Android (expo-screen-orientation handles orientation automatically there).
 */

import { useEffect } from 'react';
import { Platform } from 'react-native';

/** Minimal navigation shape required by this hook. */
type NavigationWithFocusListener = {
  addListener: (event: 'focus', callback: () => void) => () => void;
};

export function useUnlockOrientationOnIos(navigation: NavigationWithFocusListener): void {
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let cancelled = false;
    const unlock = async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const ScreenOrientation = require('expo-screen-orientation');
        if (!cancelled) await ScreenOrientation.unlockAsync();
      } catch {
        // expo-screen-orientation not available — safe to ignore
      }
    };
    void unlock();
    const unsubscribe = navigation.addListener('focus', () => {
      void unlock();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [navigation]);
}
