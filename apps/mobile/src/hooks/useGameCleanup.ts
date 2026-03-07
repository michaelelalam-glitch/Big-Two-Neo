/**
 * useGameCleanup — Handles navigation-away cleanup and orientation unlock for GameScreen.
 *
 * Extracted from GameScreen.tsx to reduce file size (~65 lines).
 * - Detects deliberate navigation away (POP/GO_BACK/NAVIGATE)
 * - Unlocks screen orientation
 * - Online playing rooms: calls mark-disconnected to start the 60s bot-replacement timer
 *   so the HomeScreen banner can show a countdown
 * - Offline/lobby rooms: removes player from room on deliberate leave
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
  /** Room UUID — required for online rooms so mark-disconnected can be called */
  roomId?: string;
}

interface UseGameCleanupReturn {
  isMountedRef: React.MutableRefObject<boolean>;
}

export function useGameCleanup({
  userId,
  roomCode,
  navigation,
  orientationAvailable,
  roomId,
}: UseGameCleanupOptions): UseGameCleanupReturn {
  // Track component mount status for async operations
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Keep a stable ref so the beforeRemove listener always reads the latest roomId
  // without re-registering the listener on every roomInfo change.
  const roomIdRef = useRef(roomId);
  roomIdRef.current = roomId;

  // Cleanup: Handle player exit when deliberately leaving
  // - Online playing rooms: call mark-disconnected (starts 60s bot-replacement timer)
  // - Offline rooms: delete player row immediately
  // Also unlock orientation to prevent orientation lock from persisting
  useEffect(() => {
    let isDeliberateLeave = false;

    const isOnlineRoom = roomCode !== 'LOCAL_AI_GAME';

    const allowedActionTypes = ['POP', 'GO_BACK', 'NAVIGATE'];
    const unsubscribe = navigation.addListener('beforeRemove', async (e: { data: { action: { type: string } }; preventDefault: () => void }) => {
      const actionType = e?.data?.action?.type;
      if (
        typeof actionType === 'string' &&
        allowedActionTypes.includes(actionType)
      ) {
        isDeliberateLeave = true;

        // For online rooms, fire mark-disconnected ASAP in beforeRemove
        // (before the component unmounts) so the server-side timer starts
        // immediately and HomeScreen can show the 60s countdown.
        const currentRoomId = roomIdRef.current;
        if (isOnlineRoom && currentRoomId) {
          gameLogger.info(`🔌 [GameScreen] Marking player disconnected in room ${roomCode} (starting 60s timer)`);
          supabase.functions
            .invoke('mark-disconnected', { body: { room_id: currentRoomId } })
            .then(({ error }) => {
              if (error) {
                gameLogger.error('❌ [GameScreen] mark-disconnected error:', error);
              } else {
                gameLogger.info('✅ [GameScreen] mark-disconnected success — 60s timer started');
              }
            })
            .catch((err: unknown) => {
              gameLogger.error('❌ [GameScreen] mark-disconnected exception:', err);
            });
        }

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
        if (isOnlineRoom) {
          // Online room: mark-disconnected was already called in beforeRemove
          // above. Do NOT delete the room_players row — the player is still in
          // the room with a 60s bot-replacement timer. The HomeScreen banner
          // will show the countdown and offer Rejoin / Leave options.
          gameLogger.info(`🧹 [GameScreen] Deliberate exit from online room ${roomCode} — keeping player row for rejoin`);
        } else {
          // Offline room: delete player row immediately
          gameLogger.info(`🧹 [GameScreen] Deliberate exit from offline room: Removing user ${userId}`);

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
      }
    };
  }, [userId, roomCode, navigation, orientationAvailable]);

  return { isMountedRef };
}
