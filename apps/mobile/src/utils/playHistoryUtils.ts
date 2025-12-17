/**
 * Shared utilities for converting game state round history to play history format.
 * Used by both GameScreen and usePlayHistoryTracking hook to maintain consistency.
 */

import type { GameState } from '../game/state';
import type { PlayHistoryMatch, PlayHistoryHand, PlayerPosition } from '../types/scoreboard';
import { gameLogger } from './logger';

/**
 * Builds the final play history from game state, including the current match.
 * This ensures the winning hand is captured even if the context hasn't updated yet.
 * 
 * @param state - Current game state with round history and player information
 * @param existingPlayHistory - Existing play history from context. If a match with the same
 *                              matchNumber already exists, it will be updated/replaced with
 *                              the current state's data (including all hands from roundHistory).
 * @returns Complete play history including current match with all hands
 */
export function buildFinalPlayHistoryFromState(
  state: GameState,
  existingPlayHistory: PlayHistoryMatch[]
): PlayHistoryMatch[] {
  const finalPlayHistory = [...existingPlayHistory];

  // Add the CURRENT match's play history (including winning play)
  // The context might not have been updated yet, so we manually convert roundHistory
  if (state.roundHistory.length > 0) {
    const playerIdToIndex = new Map<string, number>();
    state.players.forEach((player, index) => {
      playerIdToIndex.set(player.id, index);
    });

    // Convert roundHistory entries to PlayHistoryHand format
    const hands: PlayHistoryHand[] = state.roundHistory
      .filter(entry => !entry.passed && entry.cards.length > 0)
      .map(entry => {
        const playerIndex = playerIdToIndex.get(entry.playerId);

        if (playerIndex === undefined) {
          gameLogger.warn?.(
            'buildFinalPlayHistoryFromState: Could not find player index for roundHistory entry',
            { playerId: entry.playerId, roundEntry: entry }
          );
          return null;
        }

        return {
          by: playerIndex as PlayerPosition,
          type: entry.combo_type,
          count: entry.cards.length,
          cards: entry.cards,
          timestamp: new Date(entry.timestamp).toISOString(),
        };
      })
      .filter((hand): hand is PlayHistoryHand => hand !== null);

    // Check if this match is already in the history
    const existingMatchIndex = finalPlayHistory.findIndex(
      m => m.matchNumber === state.currentMatch
    );

    if (existingMatchIndex >= 0) {
      // Update existing match with all hands (including winning play)
      finalPlayHistory[existingMatchIndex] = {
        matchNumber: state.currentMatch,
        hands,
        winner: state.winnerId ? playerIdToIndex.get(state.winnerId) : undefined,
        startTime: state.startedAt ? new Date(state.startedAt).toISOString() : undefined,
        endTime: new Date().toISOString(),
      };
    } else {
      // Add new match
      finalPlayHistory.push({
        matchNumber: state.currentMatch,
        hands,
        winner: state.winnerId ? playerIdToIndex.get(state.winnerId) : undefined,
        startTime: state.startedAt ? new Date(state.startedAt).toISOString() : undefined,
        endTime: new Date().toISOString(),
      });
    }
  }

  return finalPlayHistory;
}
