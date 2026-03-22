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
import type {
  ScoreHistory,
  PlayHistoryMatch,
  PlayHistoryHand,
  PlayerPosition,
} from '../types/scoreboard';
import type {
  GameState as MultiplayerGameState,
  Player as MultiplayerPlayer,
} from '../types/multiplayer';

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
    playHistory: PlayHistoryMatch[]
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

    // Guard: open at most once per game (DB realtime may deliver the same phase twice)
    if (hasOpenedModalRef.current) return;
    hasOpenedModalRef.current = true;

    gameLogger.info('[useMatchEndHandler] 🏁 Game reached terminal phase — opening end modal...', {
      game_phase,
    });

    const winnerPlayer = multiplayerPlayers.find(p => p.player_index === resolvedWinner);
    const winnerName = winnerPlayer?.username || `Player ${resolvedWinner + 1}`;

    // Build final_scores from the DB field when present; otherwise fall back to
    // the last accumulated scoreHistory entry (cumulative scores) or default 0.
    const hasFinalScores =
      !!final_scores && typeof final_scores === 'object' && Object.keys(final_scores).length > 0;

    // ─── SCORE HISTORY ──────────────────────────────────────────────────────────
    // Build dbScoreHistory FIRST so it can serve as a fallback for final standings
    // when final_scores has not yet been persisted to the DB snapshot we received.
    const dbScoreHistory: ScoreHistory[] = (multiplayerGameState.scores_history ?? []).map(
      entry => {
        const sortedScores = [...entry.scores].sort((a, b) => a.player_index - b.player_index);
        return {
          matchNumber: entry.match_number,
          pointsAdded: sortedScores.map(s => s.matchScore),
          scores: sortedScores.map(s => s.cumulativeScore),
          timestamp: new Date().toISOString(),
        };
      }
    );

    // Resolve final standings. Priority order:
    //  1. final_scores DB field (most authoritative)
    //  2. Last dbScoreHistory entry's cumulative scores (DB-derived, no React staleness)
    //  3. Last React-state scoreHistory entry (last resort before zeros)
    //  4. Zeros (absolute last resort)
    const resolvedFinalScores: Record<string, number> = hasFinalScores
      ? (final_scores as Record<string, number>)
      : (() => {
          const fallback: Record<string, number> = {};
          const dbLastEntry =
            dbScoreHistory.length > 0 ? dbScoreHistory[dbScoreHistory.length - 1] : null;
          if (dbLastEntry) {
            dbLastEntry.scores.forEach((cum, idx) => {
              fallback[String(idx)] = cum;
            });
            gameLogger.warn(
              '[useMatchEndHandler] ⚠️ final_scores missing — built from last dbScoreHistory entry'
            );
          } else if (scoreHistory.length > 0) {
            // Use cumulative scores from the last React-state match entry
            const lastEntry = scoreHistory[scoreHistory.length - 1];
            lastEntry.scores.forEach((cum, idx) => {
              fallback[String(idx)] = cum;
            });
            gameLogger.warn(
              '[useMatchEndHandler] ⚠️ final_scores missing — built from last scoreHistory entry'
            );
          } else {
            // Last resort: all players score 0
            multiplayerPlayers.forEach(p => {
              fallback[String(p.player_index)] = 0;
            });
            gameLogger.warn(
              '[useMatchEndHandler] ⚠️ final_scores and scoreHistory both empty — defaulting to 0 per player'
            );
          }
          return fallback;
        })();

    const formattedScores: FinalScore[] = Object.entries(resolvedFinalScores).map(
      ([position, score]) => {
        const player = multiplayerPlayers.find(p => p.player_index === parseInt(position));
        return {
          player_index: parseInt(position),
          player_name: player?.username || `Player ${parseInt(position) + 1}`,
          cumulative_score: score as number,
          points_added: 0,
        };
      }
    );

    const playerNames = multiplayerPlayers
      .map(p => p.username)
      .filter((name): name is string => name !== null);

    // Synthesize the final match entry when the edge function stored the result
    // only in final_scores (not scores_history). This happens when the last match
    // ends the whole game — the EF sets game_over + final_scores but may not
    // append the last entry to scores_history.
    //
    // NOTE: dbScoreHistory.length > 0 is intentionally NOT required here so that
    // a 1-match game (scores_history is always empty for a 1-match finish) also
    // gets a synthetic entry. The two sub-cases are handled inside the block.
    const expectedLastMatchNumber = multiplayerGameState.match_number;
    const lastHistoryMatchNumber =
      dbScoreHistory.length > 0 ? dbScoreHistory[dbScoreHistory.length - 1].matchNumber : 0;
    const isFinalMatchMissingFromHistory =
      expectedLastMatchNumber > lastHistoryMatchNumber && hasFinalScores;

    if (isFinalMatchMissingFromHistory) {
      if (dbScoreHistory.length > 0) {
        // Normal case: at least one previous entry exists; derive delta from it.
        const prevEntry = dbScoreHistory[dbScoreHistory.length - 1];
        const pointsAdded = prevEntry.scores.map((prevCum, idx) => {
          const finalCum = (resolvedFinalScores[String(idx)] as number) ?? prevCum;
          return Math.max(0, finalCum - prevCum);
        });
        dbScoreHistory.push({
          matchNumber: expectedLastMatchNumber,
          pointsAdded,
          scores: prevEntry.scores.map((prevCum, idx) => prevCum + pointsAdded[idx]),
          timestamp: new Date().toISOString(),
        });
      } else {
        // 1-match game: scores_history is empty; build the sole/final entry
        // entirely from resolvedFinalScores (which came from final_scores above).
        const numPlayers = multiplayerPlayers.length;
        const scores = Array.from(
          { length: numPlayers },
          (_, idx) => (resolvedFinalScores[String(idx)] as number) ?? 0
        );
        const pointsAdded = [...scores];
        dbScoreHistory.push({
          matchNumber: expectedLastMatchNumber,
          pointsAdded,
          scores,
          timestamp: new Date().toISOString(),
        });
      }
      gameLogger.info(
        `[useMatchEndHandler] 🔧 Synthesized missing final match ${expectedLastMatchNumber} entry from final_scores`
      );
    }

    // Use whichever source is more complete (longer list wins)
    const finalScoreHistory =
      dbScoreHistory.length >= scoreHistory.length ? dbScoreHistory : scoreHistory;

    // ─── PLAY HISTORY ───────────────────────────────────────────────────────────
    // Derive directly from DB play_history to avoid the React-state staleness
    // problem: the last hand is written to play_history in the same DB update
    // that sets game_phase = 'game_over', but addPlayHistory() (which updates
    // React state) hasn't re-rendered yet when this effect fires.
    const dbPlayHistory: PlayHistoryMatch[] = (() => {
      const rawPlays = multiplayerGameState.play_history;
      if (!Array.isArray(rawPlays) || rawPlays.length === 0) return playHistoryByMatch;

      const playsByMatch: Record<number, PlayHistoryHand[]> = {};
      rawPlays.forEach(play => {
        if (play.passed || !play.cards || play.cards.length === 0) return;
        const matchNum = play.match_number || 1;
        if (!playsByMatch[matchNum]) playsByMatch[matchNum] = [];
        playsByMatch[matchNum].push({
          by: play.position as PlayerPosition,
          type: play.combo_type || 'single',
          count: play.cards.length,
          cards: play.cards,
        });
      });

      return Object.entries(playsByMatch)
        .map(([matchNumStr, hands]) => ({ matchNumber: parseInt(matchNumStr, 10), hands }))
        .sort((a, b) => a.matchNumber - b.matchNumber);
    })();

    // Use whichever play history source is more complete
    const finalPlayHistory =
      dbPlayHistory.length >= playHistoryByMatch.length ? dbPlayHistory : playHistoryByMatch;

    gameLogger.info('[useMatchEndHandler] 📊 Opening game end modal with data:', {
      winnerName,
      winnerPosition: resolvedWinner,
      scoresCount: formattedScores.length,
      playerNamesCount: playerNames.length,
      scoreHistoryCount: finalScoreHistory.length,
      playHistoryCount: finalPlayHistory.length,
    });

    openGameEndModal(
      winnerName,
      resolvedWinner,
      formattedScores,
      playerNames,
      finalScoreHistory,
      finalPlayHistory
    );
  }, [
    isMultiplayerGame,
    multiplayerGameState,
    multiplayerPlayers,
    scoreHistory,
    playHistoryByMatch,
    openGameEndModal,
  ]);
}
