/**
 * useGameAudio — Audio & haptic feedback for game events.
 *
 * Extracted from GameScreen.tsx to reduce file size (~65 lines).
 * Handles:
 * - Match start sound (fi_mat3am_hawn) on every match start
 * - Auto-pass timer: highest-card sound + progressive countdown vibrations
 */

import { useEffect, useRef } from 'react';

import { soundManager, hapticManager, SoundType } from '../utils';
import { gameLogger } from '../utils/logger';
import type { GameState as MultiplayerGameState } from '../types/multiplayer';
import type { GameState as LocalGameState } from '../game/state';

interface UseGameAudioOptions {
  isLocalAIGame: boolean;
  isMultiplayerGame: boolean;
  gameState: LocalGameState | null;
  multiplayerGameState: MultiplayerGameState | null;
}

export function useGameAudio({
  isLocalAIGame,
  isMultiplayerGame,
  gameState,
  multiplayerGameState,
}: UseGameAudioOptions): void {
  // Track which timer we last played the sound for (by started_at timestamp).
  // Using started_at instead of remaining_ms because remaining_ms is a static
  // deprecated field (always 10000) that never changes mid-timer, so its value
  // can be identical across consecutive timers and the effect might not re-run.
  const lastPlayedTimerStartedAtRef = useRef<string | null>(null);

  // Match start sound tracking refs — one per game mode to avoid cross-mode bleed.
  const previousLocalMatchNumberRef = useRef<number | null>(null);
  const previousMultiplayerMatchNumberRef = useRef<number | null>(null);

  // ── Local AI: match start sound ─────────────────────────────────────────── //
  // Fires whenever the local game's currentMatch increments (match 1, 2, 3…).
  // Uses explicit primitive dep (currentMatch) rather than the full gameState
  // object so React always re-runs the effect when the match number changes.
  useEffect(() => {
    if (!isLocalAIGame || !gameState) return;

    const currentMatch = gameState.currentMatch ?? null;
    if (currentMatch === null) return;

    if (currentMatch !== previousLocalMatchNumberRef.current) {
      previousLocalMatchNumberRef.current = currentMatch;
      soundManager.playSound(SoundType.GAME_START);
      gameLogger.info(`🎵 [Audio] Match start sound triggered - local AI match ${currentMatch}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- explicit primitive dep
  }, [isLocalAIGame, gameState?.currentMatch]);

  // ── Multiplayer: match start sound ──────────────────────────────────────── //
  // Uses explicit primitive deps (match_number + game_phase) so React reliably
  // re-runs the effect on each Supabase update, even if the object reference
  // is sometimes reused. Fires for first_play, playing, and dealing phases to
  // ensure the sound lands when new cards are dealt.
  useEffect(() => {
    if (!isMultiplayerGame || !multiplayerGameState) return;

    const currentMatchNumber = multiplayerGameState.match_number ?? null;
    const gamePhase = multiplayerGameState.game_phase;

    // first_play = cards just dealt, playing = first card played, dealing = dealing
    if (gamePhase !== 'playing' && gamePhase !== 'first_play' && gamePhase !== 'dealing') return;

    if (
      currentMatchNumber !== null &&
      currentMatchNumber !== previousMultiplayerMatchNumberRef.current
    ) {
      previousMultiplayerMatchNumberRef.current = currentMatchNumber;
      soundManager.playSound(SoundType.GAME_START);
      gameLogger.info(
        `🎵 [Audio] Match start sound triggered - multiplayer match ${currentMatchNumber} (phase=${gamePhase})`
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- explicit primitive deps
  }, [isMultiplayerGame, multiplayerGameState?.match_number, multiplayerGameState?.game_phase]);

  // ── Auto-pass timer: highest card sound + progressive countdown haptics ─── //
  useEffect(() => {
    const effectiveGameState = isLocalAIGame ? gameState : multiplayerGameState;
    const timerState = effectiveGameState?.auto_pass_timer;

    if (!timerState || !timerState.active) {
      // Timer cleared — reset so the next activation fires the sound again
      lastPlayedTimerStartedAtRef.current = null;
      return;
    }

    // Play highest card sound once per unique timer activation (keyed by started_at).
    // Avoids the stale-dep problem: remaining_ms is a deprecated static field (always
    // 10000) so two consecutive timers have the same remaining_ms value and React
    // may not re-run the effect if the null intermediate state is batched away.
    if (timerState.started_at !== lastPlayedTimerStartedAtRef.current) {
      lastPlayedTimerStartedAtRef.current = timerState.started_at;
      soundManager.playSound(SoundType.HIGHEST_CARD);
      gameLogger.info(
        `🎵 [Audio] Yeyyeeyy triggered - auto-pass timer active (started_at=${timerState.started_at})`
      );
    }

    // Progressive intensity vibration from 5 seconds down to 1
    const remaining_ms = timerState.remaining_ms;
    const displaySeconds = Math.ceil(remaining_ms / 1000);

    if (displaySeconds <= 5 && displaySeconds >= 1) {
      gameLogger.warn(
        `🚨 [VIBRATION] Triggering urgent countdown at ${displaySeconds}s (remaining_ms=${remaining_ms})`
      );
      hapticManager.urgentCountdown(displaySeconds);
      gameLogger.info(`📳 [Haptic] Progressive vibration triggered: ${displaySeconds}s`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only remaining_ms drives haptic intensity
  }, [
    isMultiplayerGame,
    isLocalAIGame,
    gameState?.auto_pass_timer?.started_at,
    gameState?.auto_pass_timer?.remaining_ms,
    multiplayerGameState?.auto_pass_timer?.started_at,
    multiplayerGameState?.auto_pass_timer?.remaining_ms,
  ]);
}
