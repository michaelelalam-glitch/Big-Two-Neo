/**
 * useMatchEndHandler — Detects multiplayer game end and opens the game-end modal.
 *
 * Extracted from GameScreen.tsx to reduce file size (~60 lines).
 * Watches multiplayerGameState.game_phase for 'finished' OR 'game_over' and triggers
 * the GameEndModal with properly formatted score data.
 *
 * Fixes applied:
 * - Bug: non-winners never saw the modal because the guard only checked 'finished'
 *   but play-cards stores 'game_over'. Now checks both phases.
 * - Bug: last match score was missing because the accumulated scoreHistory state
 *   hadn't yet been updated when this effect fired. Now derives score history
 *   directly from multiplayerGameState.scores_history (DB-authoritative).
 * - Bug: winner was always read from the 'winner' column; falls back to
 *   'game_winner_index' for robustness.
 */

import { useEffect, useRef } from 'react';

import { gameLogger } from '../utils/logger';
import type { FinalScore } from '../types/gameEnd';
import type { ScoreHistory, PlayHistoryMatch } from '../types/scoreboard';
import type { GameState as MultiplayerGameState, Player as MultiplayerPlayer } from '../types/multiplayer';

interface UseMatchEndHandlerOptions {
  isMultiplayerGame: boolean;
  multiplayerGameState: MultiplayerGameState | null;
  multiplayerPlayers: MultiplayerPlayer[];
  scoreHistory: ScoreHistory[];
  playHistoryByMatch: PlayHistoryMatch[];
  openGameEndModal: (
    winnerName: string,
    winnerPosition: number,
    finalScores: FinalScore[],
    playerNames: string[],
    scoreHistory: ScoreHistory[],
    playHistory: PlayHistoryMatch[],
  ) => void;
}

export function useMatchEndHandler({
  isMultiplayerGame,
  multiplayerGameState,
  multiplayerPlayers,
  scoreHistory,
  playHistoryByMatch,
  openGameEndModal,
}: UseMatchEndHandlerOptions): void {
  // Prevent the modal from being opened more than once per game instance
  const hasOpenedModalRef = useRef(false);

  // Reset the guard when game state is cleared (new game / room change)
  useEffect(() => {
    if (!multiplayerGameState) {
      hasOpenedModalRef.current = false;
    }
  }, [multiplayerGameState]);

  useEffect(() => {
    if (!isMultiplayerGame || !multiplayerGameState) return;

    const { game_phase, winner, game_winner_index, final_scores } = multiplayerGameState;

    // Both 'finished' (edge-case legacy) and 'game_over' (current play-cards behaviour) signal end
    if (game_phase !== 'finished' && game_phase !== 'game_over') return;

    // Resolve winner — prefer 'winner' (legacy alias), fall back to 'game_winner_index'
    const resolvedWinner = winner ?? game_winner_index;
    if (resolvedWinner == null) return;

    // Require final_scores to be a non-empty object
    if (!final_scores || typeof final_scores !== 'object' || Object.keys(final_scores).length === 0) return;

    // Guard: open at most once per game (DB realtime may deliver the same phase twice)
    if (hasOpenedModalRef.current) return;
    hasOpenedModalRef.current = true;

    gameLogger.info('[useMatchEndHandler] 🏁 Game reached terminal phase — opening end modal...', { game_phase });

    const winnerPlayer = multiplayerPlayers.find(p => p.player_index === resolvedWinner);
    const winnerName = winnerPlayer?.username || `Player ${resolvedWinner + 1}`;

    const formattedScores: FinalScore[] = Object.entries(final_scores).map(
      ([position, score]) => {
        const player = multiplayerPlayers.find(
          p => p.player_index === parseInt(position),
        );
        return {
          player_index: parseInt(position),
          player_name: player?.username || `Player ${parseInt(position) + 1}`,
          cumulative_score: score as number,
          points_added: 0,
        };
      },
    );

    const playerNames = multiplayerPlayers.map(p => p.username).filter(Boolean);

    // Derive score history directly from the DB-persisted scores_history array.
    // This is more reliable than the accumulated `scoreHistory` state, which may
    // not yet include the final match at the moment this effect fires (the
    // useMultiplayerScoreHistory hook processes new entries asynchronously after
    // the realtime update arrives). scores_history is written atomically by
    // play-cards in the same UPDATE that sets game_phase = 'game_over', so it
    // is guaranteed to contain every match including the last one.
    const dbScoreHistory: ScoreHistory[] = (multiplayerGameState.scores_history ?? []).map(entry => {
      const sortedScores = [...entry.scores].sort((a, b) => a.player_index - b.player_index);
      return {
        matchNumber: entry.match_number,
        pointsAdded: sortedScores.map(s => s.matchScore),
        scores: sortedScores.map(s => s.cumulativeScore),
        timestamp: new Date().toISOString(),
      };
    });

    // Use whichever source is more complete (longer wins)
    const finalScoreHistory = dbScoreHistory.length >= scoreHistory.length
      ? dbScoreHistory
      : scoreHistory;

    gameLogger.info('[useMatchEndHandler] 📊 Opening game end modal with data:', {
      winnerName,
      winnerPosition: resolvedWinner,
      scoresCount: formattedScores.length,
      playerNamesCount: playerNames.length,
      scoreHistoryCount: finalScoreHistory.length,
      playHistoryCount: playHistoryByMatch.length,
    });

    openGameEndModal(
      winnerName,
      resolvedWinner,
      formattedScores,
      playerNames,
      finalScoreHistory,
      playHistoryByMatch,
    );
  }, [isMultiplayerGame, multiplayerGameState, multiplayerPlayers, scoreHistory, playHistoryByMatch, openGameEndModal]);
}
