/**
 * useMatchEndHandler — Detects multiplayer game end and opens the game-end modal.
 *
 * Extracted from GameScreen.tsx to reduce file size (~60 lines).
 * Watches multiplayerGameState.game_phase for 'finished' and triggers
 * the GameEndModal with properly formatted score data.
 */

import { useEffect } from 'react';

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
  useEffect(() => {
    if (!isMultiplayerGame || !multiplayerGameState) return;

    const { game_phase, winner, final_scores } = multiplayerGameState;

    if (game_phase !== 'finished' || winner == null || !final_scores) return;

    gameLogger.info('[GameScreen] 🏁 Multiplayer game finished! Opening end modal...');

    const winnerPlayer = multiplayerPlayers.find(p => p.player_index === winner);
    const winnerName = winnerPlayer?.username || `Player ${winner + 1}`;

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

    gameLogger.info('[GameScreen] 📊 Opening game end modal with data:', {
      winnerName,
      winnerPosition: winner,
      scoresCount: formattedScores.length,
      playerNamesCount: playerNames.length,
      scoreHistoryCount: scoreHistory.length,
      playHistoryCount: playHistoryByMatch.length,
    });

    openGameEndModal(
      winnerName,
      winner,
      formattedScores,
      playerNames,
      scoreHistory,
      playHistoryByMatch,
    );
  }, [isMultiplayerGame, multiplayerGameState, multiplayerPlayers, scoreHistory, playHistoryByMatch, openGameEndModal]);
}
