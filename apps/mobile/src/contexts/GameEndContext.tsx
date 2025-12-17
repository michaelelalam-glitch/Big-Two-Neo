/**
 * GameEndContext - State management for Game End modal
 * 
 * Manages:
 * - Game End modal visibility
 * - Winner information (name, index, score)
 * - Final scores for all players
 * - Score history for display
 * - Play history for display
 * 
 * Created as part of Task #404: Create GameEndContext provider
 * Date: December 16, 2024
 */

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import {
  FinalScore,
  ScoreHistory,
  PlayHistoryMatch,
} from '../types/gameEnd';
import type { ScoreHistory as ScoreboardScoreHistory, PlayHistoryMatch as ScoreboardPlayHistory } from '../types/scoreboard';

// ============================================================================
// CONTEXT STATE INTERFACE
// ============================================================================

export interface GameEndContextState {
  // Modal visibility
  showGameEndModal: boolean;
  setShowGameEndModal: (value: boolean) => void;
  
  // Winner information
  gameWinnerName: string;
  setGameWinnerName: (name: string) => void;
  gameWinnerIndex: number;
  setGameWinnerIndex: (index: number) => void;
  
  // Final scores
  finalScores: FinalScore[];
  setFinalScores: (scores: FinalScore[]) => void;
  
  // Player names
  playerNames: string[];
  setPlayerNames: (names: string[]) => void;
  
  // History data
  scoreHistory: ScoreHistory[];
  setScoreHistory: (history: ScoreHistory[]) => void;
  playHistory: PlayHistoryMatch[];
  setPlayHistory: (history: PlayHistoryMatch[]) => void;
  
  // Action callbacks (Task #416, #417)
  onPlayAgain?: () => void;
  setOnPlayAgain: (callback: (() => void) | undefined) => void;
  onReturnToMenu?: () => void;
  setOnReturnToMenu: (callback: (() => void) | undefined) => void;
  
  // Helper functions
  resetGameEndState: () => void;
  openGameEndModal: (
    winnerName: string,
    winnerIndex: number,
    scores: FinalScore[],
    names: string[],
    scoreHist: ScoreHistory[],
    playHist: PlayHistoryMatch[]
  ) => void;
}

// ============================================================================
// CONTEXT DEFINITION
// ============================================================================

const GameEndContext = createContext<GameEndContextState | undefined>(undefined);

// ============================================================================
// PROVIDER PROPS
// ============================================================================

interface GameEndProviderProps {
  children: ReactNode;
}

// ============================================================================
// PROVIDER COMPONENT
// ============================================================================

export const GameEndProvider: React.FC<GameEndProviderProps> = ({ children }) => {
  // -------------------------------------------------------------------------
  // STATE - Modal Visibility
  // -------------------------------------------------------------------------
  
  const [showGameEndModal, setShowGameEndModal] = useState<boolean>(false);

  // -------------------------------------------------------------------------
  // STATE - Winner Information
  // -------------------------------------------------------------------------
  
  const [gameWinnerName, setGameWinnerName] = useState<string>('');
  const [gameWinnerIndex, setGameWinnerIndex] = useState<number>(0);

  // -------------------------------------------------------------------------
  // STATE - Final Scores
  // -------------------------------------------------------------------------
  
  const [finalScores, setFinalScores] = useState<FinalScore[]>([]);

  // -------------------------------------------------------------------------
  // STATE - Player Names
  // -------------------------------------------------------------------------
  
  const [playerNames, setPlayerNames] = useState<string[]>([]);

  // -------------------------------------------------------------------------
  // STATE - History Data
  // -------------------------------------------------------------------------
  
  const [scoreHistory, setScoreHistory] = useState<ScoreHistory[]>([]);
  const [playHistory, setPlayHistory] = useState<PlayHistoryMatch[]>([]);

  // -------------------------------------------------------------------------
  // STATE - Action Callbacks (Task #416, #417)
  // -------------------------------------------------------------------------
  
  const [onPlayAgain, setOnPlayAgain] = useState<(() => void) | undefined>(undefined);
  const [onReturnToMenu, setOnReturnToMenu] = useState<(() => void) | undefined>(undefined);

  // -------------------------------------------------------------------------
  // HELPER FUNCTIONS
  // -------------------------------------------------------------------------

  /**
   * Reset all game end state to initial values
   * Called when returning to menu or starting a new game
   */
  const resetGameEndState = useCallback(() => {
    setShowGameEndModal(false);
    setGameWinnerName('');
    setGameWinnerIndex(0);
    setFinalScores([]);
    setPlayerNames([]);
    setScoreHistory([]);
    setPlayHistory([]);
  }, []);

  /**
   * Open game end modal with all required data
   * Called when game_ended event is received from backend
   * CRITICAL FIX: Added data validation and type conversion
   */
  const openGameEndModal = useCallback((
    winnerName: string,
    winnerIndex: number,
    scores: FinalScore[],
    names: string[],
    scoreHist: ScoreHistory[] | ScoreboardScoreHistory[],
    playHist: PlayHistoryMatch[] | ScoreboardPlayHistory[]
  ) => {
    console.log('🔍 [GameEndContext] openGameEndModal called with:', {
      winnerName,
      winnerIndex,
      scoresCount: scores.length,
      namesCount: names.length,
      scoreHistCount: scoreHist.length,
      playHistCount: playHist.length,
    });
    
    // CRITICAL FIX: Validate data before opening modal
    if (!winnerName || scores.length === 0 || names.length === 0) {
      console.error('❌ [GameEndContext] Invalid data, cannot open modal:', {
        hasWinner: !!winnerName,
        scoresCount: scores.length,
        namesCount: names.length,
      });
      return;
    }
    
    setGameWinnerName(winnerName);
    setGameWinnerIndex(winnerIndex);
    setFinalScores(scores);
    setPlayerNames(names);
    setScoreHistory(scoreHist as ScoreHistory[]);
    setPlayHistory(playHist as PlayHistoryMatch[]);
    setShowGameEndModal(true);
    
    console.log('✅ [GameEndContext] State updated, modal opening with valid data');
  }, []);

  // -------------------------------------------------------------------------
  // CONTEXT VALUE
  // -------------------------------------------------------------------------

  const value: GameEndContextState = {
    // Modal visibility
    showGameEndModal,
    setShowGameEndModal,
    
    // Winner information
    gameWinnerName,
    setGameWinnerName,
    gameWinnerIndex,
    setGameWinnerIndex,
    
    // Final scores
    finalScores,
    setFinalScores,
    
    // Player names
    playerNames,
    setPlayerNames,
    
    // History data
    scoreHistory,
    setScoreHistory,
    playHistory,
    setPlayHistory,
    
    // Action callbacks (Task #416, #417)
    onPlayAgain,
    setOnPlayAgain,
    onReturnToMenu,
    setOnReturnToMenu,
    
    // Helper functions
    resetGameEndState,
    openGameEndModal,
  };

  // -------------------------------------------------------------------------
  // RENDER
  // -------------------------------------------------------------------------

  return (
    <GameEndContext.Provider value={value}>
      {children}
    </GameEndContext.Provider>
  );
};

// ============================================================================
// CUSTOM HOOK
// ============================================================================

/**
 * Custom hook to use GameEndContext
 * Throws error if used outside of GameEndProvider
 */
export const useGameEnd = (): GameEndContextState => {
  const context = useContext(GameEndContext);
  
  if (context === undefined) {
    throw new Error('useGameEnd must be used within a GameEndProvider');
  }
  
  return context;
};

// ============================================================================
// EXPORTS
// ============================================================================

export default GameEndContext;
