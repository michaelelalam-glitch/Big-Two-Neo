/**
 * useMultiplayerScoreHistory — Syncs multiplayer scores_history to the scoreboard.
 *
 * The play-cards edge function persists per-match score breakdowns in
 * game_state.scores_history on every match end. This hook reads that
 * persisted array and converts each entry into ScoreHistory objects for
 * ScoreboardContext — exactly the same pattern as useMultiplayerPlayHistory
 * does for play_history.
 *
 * This ensures score history is available even for matches where the
 * winning play was made by a server-side bot (no HTTP response or
 * broadcast reaches the human client in that case).
 */

import { useEffect, useRef } from 'react';

import { gameLogger } from '../utils/logger';
import type { ScoreHistory } from '../types/scoreboard';
import type { GameState as MultiplayerGameState } from '../types/multiplayer';

interface UseMultiplayerScoreHistoryOptions {
  isMultiplayerGame: boolean;
  multiplayerGameState: MultiplayerGameState | null;
  addScoreHistory: (history: ScoreHistory) => void;
}

export function useMultiplayerScoreHistory({
  isMultiplayerGame,
  multiplayerGameState,
  addScoreHistory,
}: UseMultiplayerScoreHistoryOptions): void {
  // Track the last synced scores_history length to avoid re-processing entries
  const lastSyncedLengthRef = useRef(0);

  useEffect(() => {
    if (!isMultiplayerGame || !multiplayerGameState) return;

    const scoresHistory = multiplayerGameState.scores_history;
    if (!Array.isArray(scoresHistory) || scoresHistory.length === 0) return;

    // Only process NEW entries since last sync
    if (scoresHistory.length <= lastSyncedLengthRef.current) return;

    const newEntries = scoresHistory.slice(lastSyncedLengthRef.current);
    lastSyncedLengthRef.current = scoresHistory.length;

    gameLogger.info(
      `[ScoreHistory] 📊 Syncing ${newEntries.length} new match score entries from game_state.scores_history`,
    );

    for (const entry of newEntries) {
      const matchNumber = entry.match_number;
      const scores = entry.scores;

      if (!Array.isArray(scores) || scores.length === 0) continue;

      // Sort by player_index to ensure consistent ordering
      const sortedScores = [...scores].sort((a, b) => a.player_index - b.player_index);

      const pointsAdded: number[] = sortedScores.map((s) => s.matchScore);
      const cumulativeScores: number[] = sortedScores.map((s) => s.cumulativeScore);

      const scoreHistoryEntry: ScoreHistory = {
        matchNumber,
        pointsAdded,
        scores: cumulativeScores,
        timestamp: new Date().toISOString(),
      };

      gameLogger.info(
        `[ScoreHistory] 📊 Adding score history for Match ${matchNumber}:`,
        scoreHistoryEntry,
      );
      addScoreHistory(scoreHistoryEntry);
    }
  // Narrow dependency to scores_history array only (not full game state object) to
  // avoid re-running on every game state update unrelated to score history changes.
  // This matches the pattern used by useMultiplayerPlayHistory for play_history.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMultiplayerGame, multiplayerGameState?.scores_history, addScoreHistory]);

  // Reset the sync counter when the game state is cleared (new game)
  useEffect(() => {
    if (!multiplayerGameState) {
      lastSyncedLengthRef.current = 0;
    }
  }, [multiplayerGameState]);
}
