import React, { useRef, useEffect } from 'react';
import { useGameStateManager } from '../../hooks/useGameStateManager';
import { useBotTurnManager } from '../../hooks/useBotTurnManager';
import { usePlayHistoryTracking } from '../../hooks/usePlayHistoryTracking';
import type { LocalGameState, GameEndCallbacks } from './types';
import type { ScoreHistory, PlayHistoryMatch } from '../../types/scoreboard';

interface LocalAIGameProps {
  roomCode: string;
  currentPlayerName: string;
  forceNewGame: boolean;
  addScoreHistory: (entry: ScoreHistory) => void;
  openGameEndModal: GameEndCallbacks['openGameEndModal'];
  scoreHistory: ScoreHistory[];
  playHistoryByMatch: PlayHistoryMatch[];
  children: (state: LocalGameState) => React.ReactNode;
}

/**
 * LocalAIGame - Manages client-side AI game logic
 * Extracts all local game state management from GameScreen
 */
export function LocalAIGame({
  roomCode,
  currentPlayerName,
  forceNewGame,
  addScoreHistory,
  openGameEndModal,
  scoreHistory,
  playHistoryByMatch,
  children,
}: LocalAIGameProps) {
  // Bot turn management - only for LOCAL games
  const gameManagerRefPlaceholder = useRef<any>(null);
  const { checkAndExecuteBotTurn } = useBotTurnManager({
    gameManagerRef: gameManagerRefPlaceholder,
  });

  // Client-side game state (LOCAL AI games only)
  const { gameManagerRef, gameState, isInitializing } = useGameStateManager({
    roomCode,
    currentPlayerName,
    forceNewGame,
    isLocalGame: true,
    addScoreHistory,
    openGameEndModal,
    scoreHistory,
    playHistoryByMatch,
    checkAndExecuteBotTurn,
  });

  // Update placeholder ref once gameManagerRef is available
  useEffect(() => {
    if (gameManagerRef.current) {
      gameManagerRefPlaceholder.current = gameManagerRef.current;
    }
  }, [gameManagerRef]);

  // Play history tracking - automatically sync game plays to scoreboard
  usePlayHistoryTracking(gameState);

  // Extract player hand from game state for UI
  const localPlayerHand = (gameState as any)?.hands?.[0] || [];

  // Return render prop with local game state
  return <>{children({ gameState, gameManagerRef, isInitializing, localPlayerHand })}</>;
}
