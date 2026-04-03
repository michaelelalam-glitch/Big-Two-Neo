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
import { sentryCapture } from '../services/sentry';
import { trackGameEvent } from '../services/analytics';
import type {
  GameState as MultiplayerGameState,
  Player as MultiplayerPlayer,
} from '../types/multiplayer';
import type { RoomInfo } from './useMultiplayerRoomLoader';

interface UseGameStatsUploaderOptions {
  isMultiplayerGame: boolean;
  multiplayerGameState: MultiplayerGameState | null;
  multiplayerPlayers: MultiplayerPlayer[];
  roomInfo: RoomInfo | null;
  /** ISO timestamp when game started (from when the room started playing) */
  gameStartedAt: string | null;
  /**
   * Fallback difficulty used when the DB `bot_difficulty` column is NULL for bot players.
   * Pass the value from the route params (selected in the lobby) so that the correct
   * difficulty is recorded even when the RPC hasn't persisted it to `room_players` yet.
   */
  botDifficultyFallback?: 'easy' | 'medium' | 'hard';
}

export function useGameStatsUploader({
  isMultiplayerGame,
  multiplayerGameState,
  multiplayerPlayers,
  roomInfo,
  gameStartedAt,
  botDifficultyFallback,
}: UseGameStatsUploaderOptions): void {
  // Prevent duplicate uploads if state updates multiple times while 'finished'
  const hasUploadedRef = useRef(false);
  const uploadingRef = useRef(false);
  // Analytics does not require auth; track with its own one-shot guard.
  const hasTrackedCompletionRef = useRef(false);

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
        hasTrackedCompletionRef.current = false;
      }
      return;
    }
    if (!roomInfo?.id) return;

    // Fire Firebase analytics independently of the upload one-shot guard so the
    // event isn't permanently dropped when multiplayerPlayers is still empty on
    // the first game_over fire (hasUploadedRef would block re-entry on the next
    // render, but hasTrackedCompletionRef lets analytics retry until players load).
    if (!hasTrackedCompletionRef.current && multiplayerPlayers.length > 0) {
      hasTrackedCompletionRef.current = true;
      const analyticsGameMode = roomInfo.ranked_mode
        ? 'online_ranked'
        : roomInfo.is_public || roomInfo.is_matchmaking
          ? 'online_casual'
          : ('online_private' as const);
      const hasBots = multiplayerPlayers.some(p => p.is_bot);
      const dbBotDifficulty = multiplayerPlayers.find(p => p.is_bot)?.bot_difficulty;
      const resolvedBotDifficulty = hasBots
        ? (dbBotDifficulty ?? botDifficultyFallback ?? 'unknown')
        : 'none';
      const winnerPosition =
        multiplayerGameState.winner ?? multiplayerGameState.game_winner_index ?? null;
      const durationSeconds = gameStartedAt
        ? Math.round((Date.now() - new Date(gameStartedAt).getTime()) / 1000)
        : undefined;
      const rawRoundsPlayed = Array.isArray(multiplayerGameState.scores_history)
        ? multiplayerGameState.scores_history.length
        : undefined;
      const matchNumber = multiplayerGameState.match_number ?? undefined;
      const roundsPlayed =
        rawRoundsPlayed === undefined
          ? matchNumber
          : rawRoundsPlayed === 0
            ? (matchNumber ?? 1)
            : rawRoundsPlayed;
      trackGameEvent('game_completed', {
        game_mode: analyticsGameMode,
        player_count: multiplayerPlayers.length,
        bots_present: hasBots ? 1 : 0,
        human_count: multiplayerPlayers.filter(p => !p.is_bot).length,
        bot_count: multiplayerPlayers.filter(p => p.is_bot).length,
        bot_difficulty: resolvedBotDifficulty,
        ...(winnerPosition !== null && { winner_player_index: winnerPosition }),
        ...(durationSeconds !== undefined && { duration_seconds: durationSeconds }),
        ...(roundsPlayed !== undefined && { rounds_played: roundsPlayed }),
        ...(matchNumber !== undefined && { match_number: matchNumber }),
      });
    }

    if (hasUploadedRef.current) return;
    if (uploadingRef.current) return;

    const { hands } = multiplayerGameState;

    // Mark as uploaded optimistically BEFORE the winner/final_scores null guard.
    // This prevents a second upload attempt if the effect re-fires while winner
    // data hasn't propagated yet — the null-guard path now safely exits without
    // clearing the flag, so the upload won't be retried on the next state tick.
    hasUploadedRef.current = true;

    // Resolve winner — try 'winner' column first, fall back to 'game_winner_index'
    const resolvedWinner =
      multiplayerGameState.winner ?? multiplayerGameState.game_winner_index ?? null;

    // Resolve final_scores — try DB column first, fall back to last scores_history entry
    let resolvedFinalScores: Record<string, number> | null =
      multiplayerGameState.final_scores ?? null;
    if (
      !resolvedFinalScores &&
      Array.isArray(multiplayerGameState.scores_history) &&
      multiplayerGameState.scores_history.length > 0
    ) {
      const lastEntry =
        multiplayerGameState.scores_history[multiplayerGameState.scores_history.length - 1];
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
        hasScoresHistory:
          Array.isArray(multiplayerGameState.scores_history) &&
          multiplayerGameState.scores_history.length > 0,
      });
      return;
    }

    uploadingRef.current = true;

    const uploadStats = async () => {
      try {
        statsLogger.info('[GameStats] 📊 Uploading multiplayer game stats...');

        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          statsLogger.warn('[GameStats] No authenticated user, skipping stats upload');
          // Reset the flag so a retry is possible once the user is authenticated.
          hasUploadedRef.current = false;
          uploadingRef.current = false;
          return;
        }

        const {
          data: { session },
        } = await supabase.auth.getSession();
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
        } else if (roomInfo.is_public || roomInfo.is_matchmaking) {
          gameType = 'casual';
        } else {
          gameType = 'private';
        }

        statsLogger.info(
          `[GameStats] Game type: ${gameType} (ranked_mode=${roomInfo.ranked_mode}, is_public=${roomInfo.is_public}, is_matchmaking=${roomInfo.is_matchmaking})`
        );

        // Note: game_completed analytics are fired above the upload guard so they
        // aren't permanently blocked if players load after the first game_over fire.

        // Get final scores sorted by cumulative score (ascending = best)
        const finalScoresEntries = Object.entries(resolvedFinalScores!)
          .map(([idxStr, score]) => ({
            player_index: parseInt(idxStr, 10),
            cumulative_score: score as number,
          }))
          .sort((a, b) => a.cumulative_score - b.cumulative_score);

        // Build a unique finish-position map so every player gets a distinct
        // rank. The edge function validates positions are exactly [1,2,3,4].
        // Players present in finalScores are ranked 1-N by score; any missing
        // players (e.g. disconnected before game_over) fill N+1, N+2, …
        const finishPositionMap = new Map<number, number>();
        finalScoresEntries.forEach((entry, idx) => {
          finishPositionMap.set(entry.player_index, idx + 1);
        });
        let nextFallbackPosition = finalScoresEntries.length + 1;
        multiplayerPlayers.forEach(p => {
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

        // ─── Derive per-player combo counts from server-authoritative play_history ─
        // The multiplayer game server records every non-pass play in play_history with
        // { position (= player_index), combo_type, passed }. We aggregate these here so
        // each player's combos_played payload reflects actual server-verified plays
        // rather than the previously hardcoded all-zero placeholder.
        type ComboCounts = {
          singles: number;
          pairs: number;
          triples: number;
          straights: number;
          flushes: number;
          full_houses: number;
          four_of_a_kinds: number;
          straight_flushes: number;
          royal_flushes: number;
        };
        const zeroCombos: ComboCounts = {
          singles: 0,
          pairs: 0,
          triples: 0,
          straights: 0,
          flushes: 0,
          full_houses: 0,
          four_of_a_kinds: 0,
          straight_flushes: 0,
          royal_flushes: 0,
        };
        const comboTypeToField: Record<string, keyof ComboCounts> = {
          single: 'singles',
          pair: 'pairs',
          triple: 'triples',
          straight: 'straights',
          flush: 'flushes',
          'full house': 'full_houses',
          'four of a kind': 'four_of_a_kinds',
          'straight flush': 'straight_flushes',
          'royal flush': 'royal_flushes',
        };
        const combosByPlayerIndex = new Map<number, ComboCounts>();
        for (const entry of multiplayerGameState.play_history ?? []) {
          if (entry.passed) continue;
          const idx = entry.position;
          if (!combosByPlayerIndex.has(idx)) {
            combosByPlayerIndex.set(idx, { ...zeroCombos });
          }
          const counts = combosByPlayerIndex.get(idx)!;
          const field = comboTypeToField[String(entry.combo_type).toLowerCase()];
          if (field) counts[field]++;
        }
        // ─────────────────────────────────────────────────────────────────────────

        // Build players array
        const finishedAt = new Date().toISOString();
        const startedAt = gameStartedAt || new Date(Date.now() - 30 * 60 * 1000).toISOString(); // fallback 30min
        const durationSeconds = Math.floor(
          (new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000
        );

        // ─── Compute average cards_left across ALL matches (not just final) ──────
        // scores_history has per-match cardsRemaining for each player. Averaging
        // across all matches gives the true per-game avg_cards_left stat.
        const avgCardsLeftByPlayer = new Map<number, number>();
        const scoresHistory = multiplayerGameState.scores_history ?? [];
        if (scoresHistory.length > 0) {
          const totals = new Map<number, { sum: number; count: number }>();
          for (const entry of scoresHistory) {
            for (const s of entry.scores ?? []) {
              const cr = s.cardsRemaining;
              if (typeof cr !== 'number' || !Number.isFinite(cr)) continue;
              const prev = totals.get(s.player_index) ?? { sum: 0, count: 0 };
              prev.sum += cr;
              prev.count += 1;
              totals.set(s.player_index, prev);
            }
          }
          for (const [idx, { sum, count }] of totals) {
            avgCardsLeftByPlayer.set(idx, count > 0 ? Math.round(sum / count) : 0);
          }
        }

        const players = multiplayerPlayers.map(player => {
          // finishPositionMap should always contain this player_index (both passes
          // above guarantee coverage); the safeGapPosition fallback is a last-resort
          // guard to prevent duplicate positions if data is unexpectedly malformed.
          const finishPosition = finishPositionMap.get(player.player_index) ?? safeGapPosition++;

          // cards_left: average across all completed matches (scores_history), falling back
          // to final hand size if history is unavailable. This ensures the stat reflects
          // true per-match average, not just the last hand.
          const playerHandKey = String(player.player_index);
          const playerHand = hands?.[playerHandKey];
          const cardsLeft = Array.isArray(playerHand) ? playerHand.length : 0;

          // user_id: use actual user_id from room_players; bots have is_bot=true.
          // Non-bot players must have a user_id; null indicates inconsistent room_players data.
          let userId: string;
          if (player.is_bot) {
            userId = `bot_${player.player_index}`;
          } else if (player.user_id) {
            userId = player.user_id;
          } else {
            statsLogger.error('[Stats] Non-bot player has null user_id', {
              player_index: player.player_index,
            });
            userId = `unknown_${player.player_index}`;
          }

          return {
            user_id: userId,
            username: player.username,
            score: resolvedFinalScores![String(player.player_index)] ?? 0,
            finish_position: finishPosition,
            cards_left: avgCardsLeftByPlayer.get(player.player_index) ?? cardsLeft,
            was_bot: player.is_bot,
            // A player is considered disconnected if their connection_status is
            // 'disconnected' at the time the game ends (not yet bot-replaced).
            // This ensures the server records them as ABANDONED rather than
            // COMPLETED, which was the prior bug (hardcoded false for everyone).
            disconnected: player.connection_status === 'disconnected',
            original_username: null,
            // Combo counts derived from server play_history (not from the client).
            combos_played: combosByPlayerIndex.get(player.player_index) ?? { ...zeroCombos },
          };
        });

        // Determine winner_id
        const winnerPlayer = multiplayerPlayers.find(p => p.player_index === resolvedWinner);
        let winnerId: string;
        if (!winnerPlayer) {
          // Fallback: winner is the player with finish_position 1
          const winnerEntry = players.find(p => p.finish_position === 1);
          winnerId = winnerEntry?.user_id || user.id;
        } else if (winnerPlayer.is_bot) {
          winnerId = `bot_${winnerPlayer.player_index}`;
        } else if (winnerPlayer.user_id) {
          winnerId = winnerPlayer.user_id;
        } else {
          // Non-bot winner with null user_id indicates inconsistent room_players data.
          // Abort stats upload rather than misattributing the win.
          statsLogger.error('[Stats] Non-bot winner has null user_id', {
            player_index: winnerPlayer.player_index,
            username: winnerPlayer.username,
          });
          return;
        }

        // Extract bot_difficulty from the first bot player (all bots share the same difficulty).
        // Priority order:
        //   1. DB column value  (set by start_game_with_bots RPC)
        //   2. Route-param fallback  (passed from the lobby difficulty selector)
        //   3. 'medium'  (safe default for games recorded before difficulty tracking was added)
        const botPlayer = multiplayerPlayers.find(p => p.is_bot);
        const botDifficulty = botPlayer
          ? (botPlayer.bot_difficulty ?? botDifficultyFallback ?? 'medium')
          : null;

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

        // ─── Rich session analytics (game_session_summary) ──────────────────────
        // Fires right before the DB upload so every completed game has a full
        // structured record in GA4 / BigQuery regardless of edge-function outcome.
        // Captures all data visible in the expanded scoreboard + play history.
        try {
          const summaryGameMode =
            gameType === 'ranked'
              ? 'online_ranked'
              : gameType === 'casual'
                ? 'online_casual'
                : ('online_private' as const);
          const summaryHasBots = multiplayerPlayers.some(p => p.is_bot);
          const summaryBotDifficulty = summaryHasBots
            ? (botDifficulty ?? botDifficultyFallback ?? 'unknown')
            : 'none';

          // Compact standings: [{pos, pi, s}] sorted 1→4 by cumulative score.
          // Mirrors the expanded scoreboard "final standings" column.
          // Capped at 3 entries (≤ 80 chars) to stay within GA4's 100-char limit.
          const analyticsStandings = JSON.stringify(
            finalScoresEntries.slice(0, 3).map((e, i) => ({
              pos: i + 1,
              pi: e.player_index,
              s: e.cumulative_score,
            }))
          );

          // Compact match scores: [match_number, p0_score, p1_score, p2_score, p3_score]
          // per round as flat arrays. 3 rounds × 5 numbers stays well under GA4's
          // 100-char limit even with large scores, and avoids mid-token JSON truncation.
          const analyticsMatchScores = JSON.stringify(
            scoresHistory
              .slice(0, 3)
              .map(m => [m.match_number, ...(m.scores ?? []).slice(0, 4).map(sc => sc.matchScore)])
          );

          // Aggregate combo counts across ALL players (numeric params → no BigQuery length limit).
          const totalCombos = { ...zeroCombos };
          for (const counts of combosByPlayerIndex.values()) {
            for (const k of Object.keys(totalCombos) as (keyof ComboCounts)[]) {
              totalCombos[k] += counts[k];
            }
          }

          // Per-player combo totals with abbreviated keys, zeros omitted.
          // Intended for BigQuery UNNEST / JSON_VALUE queries.
          const comboKeyMap: Record<keyof ComboCounts, string> = {
            singles: 's',
            pairs: 'p',
            triples: 't',
            straights: 'st',
            flushes: 'f',
            full_houses: 'fh',
            four_of_a_kinds: '4k',
            straight_flushes: 'sf',
            royal_flushes: 'rf',
          };
          const combosPerPlayer: Record<string, Record<string, number>> = {};
          for (const [pi, counts] of combosByPlayerIndex) {
            const compressed: Record<string, number> = {};
            for (const [k, v] of Object.entries(counts) as [keyof ComboCounts, number][]) {
              if (v > 0) compressed[comboKeyMap[k]] = v;
            }
            if (Object.keys(compressed).length > 0) {
              combosPerPlayer[String(pi)] = compressed;
            }
          }

          const playHistory = multiplayerGameState.play_history ?? [];
          const totalPlays = playHistory.filter(e => !e.passed).length;
          const totalPasses = playHistory.filter(e => e.passed).length;

          const inferredRoundsPlayed =
            scoresHistory.length > 0
              ? scoresHistory.length
              : Math.max(1, multiplayerGameState.match_number ?? 0);

          trackGameEvent('game_session_summary', {
            // Outcome metadata (mirrors game_completed — keeps queries self-contained)
            game_mode: summaryGameMode,
            winner_player_index: resolvedWinner ?? -1,
            duration_seconds: Math.max(0, durationSeconds),
            rounds_played: inferredRoundsPlayed,
            match_number: multiplayerGameState.match_number ?? 0,
            player_count: multiplayerPlayers.length,
            bots_present: summaryHasBots ? 1 : 0,
            bot_difficulty: summaryBotDifficulty,
            // Scoreboard data
            standings: analyticsStandings,
            match_scores: analyticsMatchScores,
            // Play history aggregate (numeric params → no 500-char limit)
            total_plays: totalPlays,
            total_passes: totalPasses,
            combo_singles: totalCombos.singles,
            combo_pairs: totalCombos.pairs,
            combo_triples: totalCombos.triples,
            combo_straights: totalCombos.straights,
            combo_flushes: totalCombos.flushes,
            combo_full_houses: totalCombos.full_houses,
            combo_four_of_a_kinds: totalCombos.four_of_a_kinds,
            combo_straight_flushes: totalCombos.straight_flushes,
            combo_royal_flushes: totalCombos.royal_flushes,
            // Per-player combo totals: include winner only (max ~73 chars) to
            // stay within GA4's 100-char string param limit without truncating JSON.
            combos_by_player: (() => {
              const winnerKey = String(resolvedWinner ?? 0);
              return combosPerPlayer[winnerKey]
                ? JSON.stringify({ [winnerKey]: combosPerPlayer[winnerKey] })
                : '{}';
            })(),
          });
        } catch (analyticsError) {
          // Analytics must never block or crash the upload path
          if (__DEV__) {
            console.warn('[GameStats] game_session_summary failed:', analyticsError);
          }
        }
        // ─────────────────────────────────────────────────────────────────────────

        const MAX_RETRIES = 2;
        const FETCH_TIMEOUT_MS = 30_000; // 30 s abort timeout per attempt; backoff: 1 s, 2 s between retries
        let response: Response | null = null;
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
          try {
            response = await fetch(`${API.SUPABASE_URL}/functions/v1/complete-game`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${session.access_token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(payload),
              signal: controller.signal,
            });
            clearTimeout(timeoutId);
            if (response.ok || response.status < 500) {
              // Success (2xx/3xx) or client error (4xx): don't retry further.
              break;
            }
            if (attempt < MAX_RETRIES) {
              statsLogger.warn(
                `⚠️ [GameStats] Server error (${response.status}), retrying (${attempt + 1}/${MAX_RETRIES})...`
              );
              await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
              if (cancelled) break;
            }
          } catch (fetchError) {
            clearTimeout(timeoutId);
            if (attempt < MAX_RETRIES) {
              const msg = fetchError instanceof Error ? fetchError.message : String(fetchError);
              statsLogger.warn(
                `⚠️ [GameStats] Network error/timeout calling complete-game, retrying (${attempt + 1}/${MAX_RETRIES})...`,
                msg
              );
              await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
              if (cancelled) break;
            } else {
              throw fetchError;
            }
          }
        }

        // If the effect was cleaned up while we were in a backoff wait, exit
        // silently rather than throwing a false-positive Sentry exception.
        if (cancelled) return;

        if (!response) {
          throw new Error('[GameStats] No response from complete-game after retries');
        }

        if (response.ok) {
          const result = await response.json();
          statsLogger.info('✅ [GameStats] Stats uploaded successfully:', result);
        } else {
          const errorData = await response
            .json()
            .catch(() => ({ error: `HTTP ${response.status}` }));
          const errorMsg = errorData?.error || `HTTP ${response.status}`;
          statsLogger.error('❌ [GameStats] Edge function returned error:', errorMsg);
          sentryCapture.message(`[GameStats] Edge function error: ${errorMsg}`, {
            level: 'error',
            context: 'GameStatsUploader',
            extra: { statusCode: response.status, details: errorData?.details },
          });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        // Wrap non-Error throws so Sentry records a useful stack trace.
        const errorForSentry = err instanceof Error ? err : new Error(String(err));
        statsLogger.error('❌ [GameStats] Exception uploading stats:', msg);
        sentryCapture.exception(errorForSentry, {
          context: 'GameStatsUploader',
          extra: { msg },
        });
      } finally {
        uploadingRef.current = false;
      }
    };

    let cancelled = false;
    uploadStats();
    return () => {
      cancelled = true;
    };
  }, [
    isMultiplayerGame,
    multiplayerGameState,
    multiplayerPlayers,
    roomInfo,
    gameStartedAt,
    botDifficultyFallback,
  ]);
}
