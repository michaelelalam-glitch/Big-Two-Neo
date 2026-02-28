/**
 * usePlayerTotalScores Hook (Task #590)
 *
 * Computes per-player cumulative scores from scoreHistory.
 * Uses player_index when available (multiplayer) to align with pointsAdded indexing,
 * falling back to array index for local AI games.
 *
 * Shared across GameScreen, LocalAIGameScreen, and MultiplayerGameScreen.
 */

import { useMemo } from 'react';
import { ScoreHistory } from '../types/scoreboard';

/** Minimal player shape needed for score lookups. */
interface LayoutPlayer {
  player_index?: number;
  playerIndex?: number;
  score?: number;
}

/**
 * Compute total scores for each player from scoreHistory.
 *
 * @param layoutPlayers Array of player objects (may contain player_index / playerIndex).
 * @param scoreHistory  Array of match score records with pointsAdded arrays.
 * @returns             Array of total scores aligned with layoutPlayers order.
 */
export function usePlayerTotalScores(
  layoutPlayers: LayoutPlayer[],
  scoreHistory: ScoreHistory[],
): number[] {
  return useMemo(() => {
    if (layoutPlayers.length !== 4 || scoreHistory.length === 0) {
      return layoutPlayers.map((p) => p.score || 0);
    }
    return layoutPlayers.map((p, i) => {
      const playerIndex =
        (p?.player_index ?? p?.playerIndex) !== undefined
          ? (p.player_index ?? p.playerIndex)!
          : i;
      return scoreHistory.reduce((sum, match) => {
        const pointsArray = match.pointsAdded || [];
        return (
          sum +
          (playerIndex >= 0 && playerIndex < pointsArray.length
            ? pointsArray[playerIndex] || 0
            : 0)
        );
      }, 0);
    });
  }, [layoutPlayers, scoreHistory]);
}
