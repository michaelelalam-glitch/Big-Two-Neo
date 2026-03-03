/**
 * useGameStatsUploader — Sends multiplayer game completion data to the complete-game edge function.
 *
 * Called once when a multiplayer game's phase transitions to 'game_over'.
 * Builds the full GameCompletionRequest payload including:
 *   - game_type derived from room's ranked_mode + is_public flags
 *   - cards_left per player (from final hands state)
 *   - was_bot, disconnected, original_username per player
 *   - placeholder combo stats for multiplayer games (currently all zeros; no combo tracking implemented yet)
 */

import { useEffect, useRef } from 'react';
import { supabase } from '../services/supabase';
import { API } from '../constants';
import { statsLogger } from '../utils/logger';
import type { GameState as MultiplayerGameState, Player as MultiplayerPlayer } from '../types/multiplayer';
import type { RoomInfo } from './useMultiplayerRoomLoader';

interface UseGameStatsUploaderOptions {
  isMultiplayerGame: boolean;
  multiplayerGameState: MultiplayerGameState | null;
  multiplayerPlayers: MultiplayerPlayer[];
  roomInfo: RoomInfo | null;
  /** ISO timestamp when game started (from when the room started playing) */
  gameStartedAt: string | null;
}

export function useGameStatsUploader({
  isMultiplayerGame,
  multiplayerGameState,
  multiplayerPlayers,
  roomInfo,
  gameStartedAt,
}: UseGameStatsUploaderOptions): void {
  // Prevent duplicate uploads if state updates multiple times while 'finished'
  const hasUploadedRef = useRef(false);
  const uploadingRef = useRef(false);

  useEffect(() => {
    if (!isMultiplayerGame) return;
    if (!multiplayerGameState) return;
    if (multiplayerGameState.game_phase !== 'game_over') {
      // Reset the upload guard ONLY on the 'dealing' phase — the start of a
      // brand-new game. Using 'dealing' as the sole reset trigger prevents
      // duplicate uploads caused by brief phase oscillations (e.g. a stale
      // 'playing' snapshot arriving after 'game_over') or by the transient
      // 'finished' phase (which occurs between matches inside a single game,
      // NOT at game end, so resetting there would be incorrect).
      //
      // Phase lifecycle: dealing → first_play → playing → finished (loop per match)
      //                                                  → game_over (game ends)
      // Only 'dealing' signals a genuinely new game; all other non-game_over
      // phases are either mid-game or transient and must NOT clear the guard.
      if (multiplayerGameState.game_phase === 'dealing') {
        hasUploadedRef.current = false;
        uploadingRef.current = false;
      }
      return;
    }
    if (!roomInfo?.id) return;
    if (hasUploadedRef.current) return;
    if (uploadingRef.current) return;

    const { hands } = multiplayerGameState;

    // Mark as uploaded optimistically BEFORE the winner/final_scores null guard.
    // This prevents a second upload attempt if the effect re-fires while winner
    // data hasn't propagated yet — the null-guard path now safely exits without
    // clearing the flag, so the upload won't be retried on the next state tick.
    hasUploadedRef.current = true;

    // Resolve winner — try 'winner' column first, fall back to 'game_winner_index'
    const resolvedWinner = multiplayerGameState.winner ?? multiplayerGameState.game_winner_index ?? null;

    // Resolve final_scores — try DB column first, fall back to last scores_history entry
    let resolvedFinalScores: Record<string, number> | null = multiplayerGameState.final_scores ?? null;
    if (!resolvedFinalScores && Array.isArray(multiplayerGameState.scores_history) && multiplayerGameState.scores_history.length > 0) {
      const lastEntry = multiplayerGameState.scores_history[multiplayerGameState.scores_history.length - 1];
      if (lastEntry?.scores) {
        resolvedFinalScores = {};
        for (const s of lastEntry.scores) {
          resolvedFinalScores[String(s.player_index)] = s.cumulativeScore;
        }
        statsLogger.info('[GameStats] Derived final_scores from scores_history fallback');
      }
    }

    if (resolvedWinner == null || !resolvedFinalScores) {
      statsLogger.warn('[GameStats] Missing winner or final_scores, skipping upload', {
        winner: resolvedWinner,
        hasFinalScores: !!resolvedFinalScores,
        hasScoresHistory: Array.isArray(multiplayerGameState.scores_history) && multiplayerGameState.scores_history.length > 0,
      });
      return;
    }

    uploadingRef.current = true;
    // NOTE: hasUploadedRef.current is set to true above (line ~70) BEFORE the
    // auth checks inside uploadStats(). Auth failures reset it to false (lines ~109
    // and ~118) so retries remain possible after transient auth errors. The second
    // assignment inside uploadStats() at auth-confirm time is now redundant — the
    // flag is already true. The null-guard path (missing winner/scores) does NOT
    // reset the flag, so missing-data exits are intentionally non-retryable.

    const uploadStats = async () => {
      try {
        statsLogger.info('[GameStats] 📊 Uploading multiplayer game stats...');

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          statsLogger.warn('[GameStats] No authenticated user, skipping stats upload');
          // Reset the flag so a retry is possible once the user is authenticated.
          hasUploadedRef.current = false;
          uploadingRef.current = false;
          return;
        }

        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) {
          statsLogger.warn('[GameStats] No active session, skipping stats upload');
          // Reset the flag so a retry is possible once the session is restored.
          hasUploadedRef.current = false;
          uploadingRef.current = false;
          return;
        }

        // Commit the upload flag here — auth is confirmed, we will attempt the upload.
        hasUploadedRef.current = true;

        // Determine game_type from room flags
        // ranked_mode=true → ranked
        // is_public=true, ranked_mode=false → casual
        // is_public=false, ranked_mode=false → private
        let gameType: 'casual' | 'ranked' | 'private';
        if (roomInfo.ranked_mode) {
          gameType = 'ranked';
        } else if (roomInfo.is_public) {
          gameType = 'casual';
        } else {
          gameType = 'private';
        }

        statsLogger.info(`[GameStats] Game type: ${gameType} (ranked_mode=${roomInfo.ranked_mode}, is_public=${roomInfo.is_public})`);

        // Get final scores sorted by cumulative score (ascending = best)
        const finalScoresEntries = Object.entries(resolvedFinalScores!).map(([idxStr, score]) => ({
          player_index: parseInt(idxStr, 10),
          cumulative_score: score as number,
        })).sort((a, b) => a.cumulative_score - b.cumulative_score);

        // Build a unique finish-position map so every player gets a distinct
        // rank. The edge function validates positions are exactly [1,2,3,4].
        // Players present in finalScores are ranked 1-N by score; any missing
        // players (e.g. disconnected before game_over) fill N+1, N+2, …
        const finishPositionMap = new Map<number, number>();
        finalScoresEntries.forEach((entry, idx) => {
          finishPositionMap.set(entry.player_index, idx + 1);
        });
        let nextFallbackPosition = finalScoresEntries.length + 1;
        multiplayerPlayers.forEach((p) => {
          if (!finishPositionMap.has(p.player_index)) {
            finishPositionMap.set(p.player_index, nextFallbackPosition++);
          }
        });
        // After the two passes above, every player in multiplayerPlayers has a
        // unique position in finishPositionMap. The counter below covers the
        // theoretically impossible case where a player_index is absent from
        // both finalScoresEntries AND multiplayerPlayers, which would otherwise
        // produce a duplicate position and fail the edge-function [1,2,3,4] check.
        let safeGapPosition = nextFallbackPosition;

        // Build players array
        const finishedAt = new Date().toISOString();
        const startedAt = gameStartedAt || new Date(Date.now() - 30 * 60 * 1000).toISOString(); // fallback 30min
        const durationSeconds = Math.floor(
          (new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000
        );

        const players = multiplayerPlayers.map((player) => {
          // finishPositionMap should always contain this player_index (both passes
          // above guarantee coverage); the safeGapPosition fallback is a last-resort
          // guard to prevent duplicate positions if data is unexpectedly malformed.
          const finishPosition = finishPositionMap.get(player.player_index) ?? safeGapPosition++;

          // cards_left: number of cards the player has at game end.
          // NOTE: There is a known edge case where the server-side hands object may
          // not yet reflect the final state when game_phase transitions to 'finished'
          // (the winning play and the phase update are two separate DB writes). In
          // practice the winner's hand will already be 0, but a losing player's
          // remaining cards could occasionally read 0 instead of the true count if
          // the state snapshot arrived mid-write. This is acceptable as-is; a retry
          // mechanism would add complexity for a minor cosmetic inaccuracy.
          const playerHandKey = String(player.player_index);
          const playerHand = hands?.[playerHandKey];
          const cardsLeft = Array.isArray(playerHand) ? playerHand.length : 0;

          // user_id: use actual user_id from room_players; bots have is_bot=true
          const userId = player.is_bot
            ? `bot_${player.player_index}`
            : player.user_id;

          return {
            user_id: userId,
            username: player.username,
            score: resolvedFinalScores![String(player.player_index)] ?? 0,
            finish_position: finishPosition,
            cards_left: cardsLeft,
            was_bot: player.is_bot,
            disconnected: false, // TODO: track per-player disconnect status in future
            original_username: null,
            // NOTE: Multiplayer combo tracking is not yet implemented.
            // All values are intentionally zero. Combo stats are available for
            // local (offline) games via state.ts saveGameStatsToDatabase, but
            // multiplayer games do not yet aggregate per-combo play counts.
            // This is a known gap; a future task should derive combos from
            // game_state.play_history entries on the server side.
            combos_played: {
              singles: 0,
              pairs: 0,
              triples: 0,
              straights: 0,
              flushes: 0,
              full_houses: 0,
              four_of_a_kinds: 0,
              straight_flushes: 0,
              royal_flushes: 0,
            },
          };
        });

        // Determine winner_id
        const winnerPlayer = multiplayerPlayers.find(p => p.player_index === resolvedWinner);
        let winnerId: string;
        if (!winnerPlayer) {
          // Fallback: winner is the player with finish_position 1
          const winnerEntry = players.find(p => p.finish_position === 1);
          winnerId = winnerEntry?.user_id || user.id;
        } else {
          winnerId = winnerPlayer.is_bot
            ? `bot_${winnerPlayer.player_index}`
            : winnerPlayer.user_id;
        }

        // Extract bot_difficulty from the first bot player (all bots share the same difficulty)
        const botDifficulty = multiplayerPlayers.find(p => p.is_bot)?.bot_difficulty ?? null;

        const payload = {
          room_id: roomInfo.id,
          room_code: roomInfo.code,
          game_type: gameType,
          bot_difficulty: botDifficulty,
          players,
          winner_id: winnerId,
          game_duration_seconds: Math.max(0, durationSeconds),
          started_at: startedAt,
          finished_at: finishedAt,
          game_completed: true,
        };

        statsLogger.info('[GameStats] Payload built:', {
          room_code: payload.room_code,
          game_type: payload.game_type,
          winner_id: payload.winner_id,
          players_count: payload.players.length,
        });

        const response = await fetch(
          `${API.SUPABASE_URL}/functions/v1/complete-game`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
          }
        );

        if (response.ok) {
          const result = await response.json();
          statsLogger.info('✅ [GameStats] Stats uploaded successfully:', result);
        } else {
          const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
          statsLogger.error('❌ [GameStats] Edge function returned error:', errorData?.error || `HTTP ${response.status}`);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        statsLogger.error('❌ [GameStats] Exception uploading stats:', msg);
      } finally {
        uploadingRef.current = false;
      }
    };

    uploadStats();
  }, [
    isMultiplayerGame,
    multiplayerGameState,
    multiplayerPlayers,
    roomInfo,
    gameStartedAt,
  ]);
}
