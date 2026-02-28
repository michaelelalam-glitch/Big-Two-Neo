/**
 * usePlayerDisplayData — Memoized display arrays and computed values for GameScreen rendering.
 *
 * Extracted from GameScreen.tsx to reduce file size (~110 lines).
 * Computes:
 * - memoizedPlayerNames, memoizedCurrentScores, memoizedCardCounts, memoizedOriginalPlayerNames
 * - effectiveAutoPassTimerState (suppressed when match is over)
 * - effectiveScoreboardCurrentPlayerIndex (layout-aware lookup for multiplayer)
 * - matchNumber, isGameFinished
 * - layoutPlayersWithScores
 */

import React from 'react';

import type { AutoPassTimerState, GameState as MultiplayerGameState, Player as MultiplayerPlayer } from '../types/multiplayer';
import type { LayoutPlayer } from './useMultiplayerLayout';
import type { ScoreHistory } from '../types/scoreboard';

interface UsePlayerDisplayDataOptions {
  isLocalAIGame: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- local game state shape differs
  gameState: any;
  multiplayerGameState: MultiplayerGameState | null;
  multiplayerPlayers: MultiplayerPlayer[];
  layoutPlayers: (LayoutPlayer | any)[];
  scoreHistory: ScoreHistory[];
  playerTotalScores: number[];
  multiplayerLayoutPlayers: LayoutPlayer[];
}

interface UsePlayerDisplayDataReturn {
  memoizedPlayerNames: string[];
  memoizedCurrentScores: number[];
  memoizedCardCounts: number[];
  memoizedOriginalPlayerNames: string[];
  effectiveAutoPassTimerState: AutoPassTimerState | undefined;
  effectiveScoreboardCurrentPlayerIndex: number;
  matchNumber: number;
  isGameFinished: boolean;
  layoutPlayersWithScores: any[];
  displayOrderScoreHistory: ScoreHistory[];
}

export function usePlayerDisplayData({
  isLocalAIGame,
  gameState,
  multiplayerGameState,
  multiplayerPlayers,
  layoutPlayers,
  scoreHistory,
  playerTotalScores,
  multiplayerLayoutPlayers,
}: UsePlayerDisplayDataOptions): UsePlayerDisplayDataReturn {
  const matchNumber = isLocalAIGame
    ? ((gameState as any)?.currentMatch ?? 1)
    : (multiplayerGameState?.match_number ?? 1);

  const isGameFinished = isLocalAIGame
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- local game state shape differs from multiplayer
    ? ((gameState as any)?.gameOver ?? false)
    : (
        multiplayerGameState?.game_phase === 'finished' ||
        multiplayerGameState?.game_phase === 'game_over'
      );

  const layoutPlayersWithScores = React.useMemo(() => {
    return layoutPlayers.map((p: any, i: number) => ({
      ...p,
      totalScore: playerTotalScores[i] ?? 0,
    }));
  }, [layoutPlayers, playerTotalScores]);

  const memoizedPlayerNames = React.useMemo(() => {
    return layoutPlayers.length === 4
      ? layoutPlayers.map((p: any) => p.name)
      : [];
  }, [layoutPlayers]);

  const memoizedCurrentScores = React.useMemo(() => {
    if (layoutPlayers.length !== 4) return [];

    if (scoreHistory.length > 0) {
      return layoutPlayers.map((p: any, index: number) => {
        const playerIdx = p.player_index !== undefined ? p.player_index : index;
        return scoreHistory.reduce(
          (sum: number, match: ScoreHistory) => sum + (match.pointsAdded[playerIdx] || 0),
          0
        );
      });
    }

    return layoutPlayers.map((p: any) => p.score);
  }, [layoutPlayers, scoreHistory]);

  const memoizedCardCounts = React.useMemo(() => {
    return layoutPlayers.length === 4
      ? layoutPlayers.map((p: any) => p.cardCount)
      : [];
  }, [layoutPlayers]);

  const memoizedOriginalPlayerNames = React.useMemo(() => {
    if (isLocalAIGame) {
      return (gameState as any)?.players
        ? (gameState as any).players.map((p: any) => p.name)
        : [];
    }
    return multiplayerPlayers.map(p => p.username || `Player ${p.player_index + 1}`);
  }, [isLocalAIGame, gameState, multiplayerPlayers]);

  // Auto-pass timer: suppress when match is over
  const multiplayerPhase = multiplayerGameState?.game_phase;
  const isMatchActive = !multiplayerPhase || (multiplayerPhase !== 'finished' && multiplayerPhase !== 'game_over');
  const effectiveAutoPassTimerState = isLocalAIGame
    ? ((gameState as any)?.auto_pass_timer ?? undefined)
    : (isMatchActive ? (multiplayerGameState?.auto_pass_timer ?? undefined) : undefined);

  // Scoreboard current player index (layout-aware for multiplayer)
  const multiplayerCurrentTurn = multiplayerGameState?.current_turn;

  const getMultiplayerScoreboardIndex = (currentTurn: number): number => {
    const idx = multiplayerLayoutPlayers.findIndex((p: any) => p.player_index === currentTurn);
    return idx >= 0 ? idx : 0;
  };

  const effectiveScoreboardCurrentPlayerIndex = isLocalAIGame
    ? ((gameState as any)?.currentPlayerIndex ?? 0)
    : (typeof multiplayerCurrentTurn === 'number'
        ? getMultiplayerScoreboardIndex(multiplayerCurrentTurn)
        : 0);

  // Reindex scoreHistory.pointsAdded from player_index order to display order.
  // For multiplayer, layoutPlayers use relative positioning (current user = bottom)
  // so display index ≠ player_index. The scoreboard columns use display order names
  // but pointsAdded is stored in player_index order — we must remap.
  const displayOrderScoreHistory = React.useMemo((): ScoreHistory[] => {
    // For local AI games, layoutPlayers are already in player_index order — no remap needed
    if (isLocalAIGame) return scoreHistory;

    // Build mapping: displayIndex → player_index from layoutPlayers
    const hasMapping = layoutPlayers.length === 4 && layoutPlayers.every((p: any) => p.player_index !== undefined);
    if (!hasMapping) return scoreHistory;

    return scoreHistory.map((match) => {
      const reindexed = layoutPlayers.map((p: any) => match.pointsAdded[p.player_index] || 0);
      const reindexedScores = layoutPlayers.map((p: any) => match.scores[p.player_index] || 0);
      return { ...match, pointsAdded: reindexed, scores: reindexedScores };
    });
  }, [isLocalAIGame, scoreHistory, layoutPlayers]);

  return {
    memoizedPlayerNames,
    memoizedCurrentScores,
    memoizedCardCounts,
    memoizedOriginalPlayerNames,
    effectiveAutoPassTimerState,
    effectiveScoreboardCurrentPlayerIndex,
    matchNumber,
    isGameFinished,
    layoutPlayersWithScores,
    displayOrderScoreHistory,
  };
}
