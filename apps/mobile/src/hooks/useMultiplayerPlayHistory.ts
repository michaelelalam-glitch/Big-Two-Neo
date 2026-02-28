/**
 * useMultiplayerPlayHistory — Syncs multiplayer play_history to the scoreboard.
 *
 * Extracted from GameScreen.tsx to reduce file size (~50 lines).
 * Groups server-side play_history entries by match_number and adds
 * them to the ScoreboardContext via addPlayHistory.
 */

import { useEffect } from 'react';

import { gameLogger } from '../utils/logger';
import type { PlayHistoryMatch, PlayHistoryHand, PlayerPosition } from '../types/scoreboard';
import type { GameState as MultiplayerGameState } from '../types/multiplayer';

interface UseMultiplayerPlayHistoryOptions {
  isMultiplayerGame: boolean;
  multiplayerGameState: MultiplayerGameState | null;
  addPlayHistory: (match: PlayHistoryMatch) => void;
}

export function useMultiplayerPlayHistory({
  isMultiplayerGame,
  multiplayerGameState,
  addPlayHistory,
}: UseMultiplayerPlayHistoryOptions): void {
  useEffect(() => {
    if (!isMultiplayerGame || !multiplayerGameState) return;

    const playHistoryArray = multiplayerGameState.play_history;
    if (!Array.isArray(playHistoryArray) || playHistoryArray.length === 0) return;

    gameLogger.info(
      `[GameScreen] 📊 Syncing ${playHistoryArray.length} plays from multiplayer game state to scoreboard`,
    );

    const playsByMatch: Record<number, PlayHistoryHand[]> = {};

    playHistoryArray.forEach((play) => {
      if (play.passed || !play.cards || play.cards.length === 0) return;

      const matchNum = play.match_number || 1;
      if (!playsByMatch[matchNum]) {
        playsByMatch[matchNum] = [];
      }

      playsByMatch[matchNum].push({
        by: play.position as PlayerPosition,
        type: play.combo_type || 'single',
        count: play.cards.length,
        cards: play.cards,
      });
    });

    Object.entries(playsByMatch).forEach(([matchNumStr, hands]) => {
      const matchNum = parseInt(matchNumStr, 10);
      const matchData: PlayHistoryMatch = { matchNumber: matchNum, hands };
      gameLogger.info(
        `[GameScreen] 📊 Adding ${hands.length} hands for Match ${matchNum} to scoreboard`,
      );
      addPlayHistory(matchData);
    });
  }, [isMultiplayerGame, multiplayerGameState, addPlayHistory]);
}
