/**
 * useGameCleanup — Handles navigation-away cleanup and orientation unlock for GameScreen.
 *
 * Extracted from GameScreen.tsx to reduce file size (~65 lines).
 * - Detects deliberate navigation away (POP/GO_BACK/NAVIGATE)
 * - Unlocks screen orientation
 * - Removes player from room on deliberate leave
 * - Provides isMountedRef for async safety
 */

import { useEffect, useRef } from 'react';
import type { StackNavigationProp } from '@react-navigation/stack';

import { supabase } from '../services/supabase';
import { gameLogger } from '../utils/logger';
import type { RootStackParamList } from '../navigation/AppNavigator';

interface UseGameCleanupOptions {
  userId: string | undefined;
  roomCode: string;
  navigation: StackNavigationProp<RootStackParamList, 'Game'>;
  orientationAvailable: boolean;
}

interface UseGameCleanupReturn {
  isMountedRef: React.MutableRefObject<boolean>;
}

export function useGameCleanup({
  userId,
  roomCode,
  navigation,
  orientationAvailable,
}: UseGameCleanupOptions): UseGameCleanupReturn {
  // Track component mount status for async operations
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Cleanup: Remove player from room when deliberately leaving
  // Also unlock orientation to prevent orientation lock from persisting
  useEffect(() => {
    let isDeliberateLeave = false;

    const allowedActionTypes = ['POP', 'GO_BACK', 'NAVIGATE'];
    const unsubscribe = navigation.addListener('beforeRemove', async (e: any) => {
      const actionType = e?.data?.action?.type;
      if (
        typeof actionType === 'string' &&
        allowedActionTypes.includes(actionType)
      ) {
        isDeliberateLeave = true;

        // Unlock orientation immediately when leaving GameScreen
        if (orientationAvailable) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports -- dynamic require inside try/catch; static import cannot be inside a conditional block
            const ScreenOrientation = require('expo-screen-orientation');
            await ScreenOrientation.unlockAsync();
            gameLogger.info('🔓 [Orientation] Unlocked on navigation away from GameScreen');
          } catch (error) {
            gameLogger.error('❌ [Orientation] Failed to unlock on navigation:', error);
          }
        }
      }
    });

    return () => {
      unsubscribe();

      if (isDeliberateLeave && userId && roomCode) {
        gameLogger.info(`🧹 [GameScreen] Deliberate exit: Removing user ${userId} from room ${roomCode}`);

        supabase
          .from('room_players')
          .delete()
          .eq('user_id', userId)
          .then(({ error }) => {
            if (error) {
              gameLogger.error('❌ [GameScreen] Cleanup error:', error?.message || error?.code || 'Unknown error');
            } else {
              gameLogger.info('✅ [GameScreen] Successfully removed from room');
            }
          });
      }
    };
  }, [userId, roomCode, navigation, orientationAvailable]);

  return { isMountedRef };
}
