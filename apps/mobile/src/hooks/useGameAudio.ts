/**
 * useGameAudio — Audio & haptic feedback for game events.
 *
 * Extracted from GameScreen.tsx to reduce file size (~65 lines).
 * Handles:
 * - Match start sound (fi_mat3am_hawn) on every match start
 * - Auto-pass timer: highest-card sound + progressive countdown vibrations
 */

import { useEffect, useRef } from 'react';

import { soundManager, hapticManager, HapticType, SoundType } from '../utils';
import { gameLogger } from '../utils/logger';
import type { GameState as MultiplayerGameState } from '../types/multiplayer';

interface UseGameAudioOptions {
  isLocalAIGame: boolean;
  isMultiplayerGame: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- local game state shape
  gameState: any;
  multiplayerGameState: MultiplayerGameState | null;
}

export function useGameAudio({
  isLocalAIGame,
  isMultiplayerGame,
  gameState,
  multiplayerGameState,
}: UseGameAudioOptions): void {
  // Auto-pass timer audio tracking
  const hasPlayedHighestCardSoundRef = useRef(false);

  // Multiplayer match start sound tracking
  const previousMultiplayerMatchNumberRef = useRef<number | null>(null);

  // Match start sound: plays on every match_number change for multiplayer
  useEffect(() => {
    if (!isMultiplayerGame || !multiplayerGameState) return;

    const currentMatchNumber = multiplayerGameState?.match_number ?? null;
    const gamePhase = multiplayerGameState?.game_phase;

    if (gamePhase !== 'playing') return;

    if (currentMatchNumber !== null && currentMatchNumber !== previousMultiplayerMatchNumberRef.current) {
      previousMultiplayerMatchNumberRef.current = currentMatchNumber;
      soundManager.playSound(SoundType.GAME_START);
      gameLogger.info(`🎵 [Audio] Match start sound triggered - multiplayer match ${currentMatchNumber}`);
    }
  }, [isMultiplayerGame, multiplayerGameState]);

  // Auto-pass timer: highest card sound + progressive countdown haptics
  useEffect(() => {
    const effectiveGameState = isLocalAIGame ? gameState : multiplayerGameState;
    const timerState = effectiveGameState?.auto_pass_timer;

    if (!timerState || !timerState.active) {
      hasPlayedHighestCardSoundRef.current = false;
      return;
    }

    // Play highest card sound once per timer activation
    if (!hasPlayedHighestCardSoundRef.current) {
      soundManager.playSound(SoundType.HIGHEST_CARD);
      gameLogger.info('🎵 [Audio] Highest card sound triggered - auto-pass timer active');
      hasPlayedHighestCardSoundRef.current = true;
    }

    // Progressive intensity vibration from 5 seconds down to 1
    const remaining_ms = timerState.remaining_ms;
    const displaySeconds = Math.ceil(remaining_ms / 1000);

    if (displaySeconds <= 5 && displaySeconds >= 1) {
      gameLogger.warn(`🚨 [VIBRATION] Triggering urgent countdown at ${displaySeconds}s (remaining_ms=${remaining_ms})`);
      hapticManager.urgentCountdown(displaySeconds);
      gameLogger.info(`📳 [Haptic] Progressive vibration triggered: ${displaySeconds}s`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only remaining_ms drives haptic intensity
  }, [isMultiplayerGame, isLocalAIGame, gameState?.auto_pass_timer?.remaining_ms, multiplayerGameState?.auto_pass_timer?.remaining_ms]);
}
