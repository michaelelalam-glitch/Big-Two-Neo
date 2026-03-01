/**
 * Type definitions for the useRealtime hook and related multiplayer Edge Function responses.
 *
 * Extracted from useRealtime.ts to reduce file size and improve reusability.
 */

import type { AutoPassTimerState, MatchScoreDetail } from './multiplayer';

// ── Edge Function Response Types ──────────────────────────────────────────────
// These interfaces type the JSON bodies returned by Supabase Edge Functions so
// that callers of invokeWithRetry<T> get proper type-checking.

export interface PlayCardsResponse {
  success: boolean;
  debug?: Record<string, unknown>;
  match_ended?: boolean;
  match_scores?: MultiplayerMatchScoreDetail[];
  game_over?: boolean;
  final_winner_index?: number;
  combo_type?: string;
  auto_pass_timer?: AutoPassTimerState | null;
  highest_play_detected?: boolean;
  next_turn?: number;
  passes?: number;
  trick_cleared?: boolean;
  error?: string;
}

export interface StartNewMatchResponse {
  match_number: number;
  starting_player_index: number;
}

export interface PlayerPassResponse {
  success: boolean;
  error?: string;
  next_turn: number;
  passes: number;
  trick_cleared: boolean;
  auto_pass_timer?: AutoPassTimerState | null;
}

export interface UseRealtimeOptions {
  userId: string;
  username: string;
  onError?: (error: Error) => void;
  onDisconnect?: () => void;
  onReconnect?: () => void;
  onMatchEnded?: (matchNumber: number, matchScores: MultiplayerMatchScoreDetail[]) => void;
  /** Called when a player reaches 101+ points and the whole game ends. */
  onGameOver?: (winnerIndex: number | null, finalScores: MultiplayerMatchScoreDetail[]) => void;
}

/**
 * Per-player score breakdown returned by multiplayer Edge Functions.
 * Re-exported from the shared MatchScoreDetail in multiplayer.ts.
 *
 * NOTE: This is distinct from `PlayerMatchScoreDetail` in `game/types/index.ts`,
 * which is used for local (offline) game scoring.
 */
export type MultiplayerMatchScoreDetail = MatchScoreDetail;
