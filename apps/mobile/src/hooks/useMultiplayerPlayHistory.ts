/**
 * useMultiplayerPlayHistory — Syncs multiplayer play_history to the scoreboard.
 *
 * Extracted from GameScreen.tsx to reduce file size (~50 lines).
 * Groups server-side play_history entries by match_number and adds
 * them to the ScoreboardContext via addPlayHistory.
 */

import { useEffect, useRef } from 'react';

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
  // Track number of plays already synced to avoid re-calling addPlayHistory
  // (and triggering a ScoreboardContext state update + re-render) when the game
  // state object is replaced but play_history has not grown.
  const lastSyncedPlayCountRef = useRef(0);

  useEffect(() => {
    if (!isMultiplayerGame || !multiplayerGameState) return;

    const playHistoryArray = multiplayerGameState.play_history;
    if (!Array.isArray(playHistoryArray) || playHistoryArray.length === 0) {
      // Reset the count when the array is cleared (e.g. between games) so that
      // plays from the next game are not permanently skipped.
      lastSyncedPlayCountRef.current = 0;
      return;
    }

    // Guard: skip the expensive sync when no new plays have arrived.
    // addPlayHistory is idempotent for existing matches but still creates a
    // new array reference in setState, causing needless re-renders on every
    // unrelated game-state update (current_turn change, turn_started_at, etc.).
    if (playHistoryArray.length <= lastSyncedPlayCountRef.current) return;
    lastSyncedPlayCountRef.current = playHistoryArray.length;

    gameLogger.info(
      `[GameScreen] 📊 Syncing ${playHistoryArray.length} plays from multiplayer game state to scoreboard`
    );

    const playsByMatch: Record<number, PlayHistoryHand[]> = {};

    playHistoryArray.forEach(play => {
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
        `[GameScreen] 📊 Adding ${hands.length} hands for Match ${matchNum} to scoreboard`
      );
      addPlayHistory(matchData);
    });
    // Narrow dependency to play_history array only (not the full game state object)
    // so the effect re-runs only when new plays are appended — not on every
    // current_turn / turn_started_at / hands update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMultiplayerGame, multiplayerGameState?.play_history, addPlayHistory]);

  // Reset the sync counter when the game state is cleared (new game / rejoin).
  useEffect(() => {
    if (!multiplayerGameState) {
      lastSyncedPlayCountRef.current = 0;
    }
  }, [multiplayerGameState]);
}
