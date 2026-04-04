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
 * Date: December 16, 2025
 */

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import type { FinalScore, ScoreHistory, PlayHistoryMatch } from '../types/gameEnd';
import type {
  ScoreHistory as ScoreboardScoreHistory,
  PlayHistoryMatch as ScoreboardPlayHistory,
} from '../types/scoreboard';
import { gameLogger } from '../utils/logger';
import { trackScreenView } from '../services/analytics';

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
  const openGameEndModal = useCallback(
    (
      winnerName: string,
      winnerIndex: number,
      scores: FinalScore[],
      names: string[],
      scoreHist: ScoreHistory[] | ScoreboardScoreHistory[],
      playHist: PlayHistoryMatch[] | ScoreboardPlayHistory[]
    ) => {
      gameLogger.info('🔍 [GameEndContext] openGameEndModal called with:', {
        winnerName,
        winnerIndex,
        scoresCount: scores.length,
        namesCount: names.length,
        scoreHistCount: scoreHist.length,
        playHistCount: playHist.length,
      });

      // Hard block: a missing winner name causes GameEndModal to show a perpetual
      // loading spinner (it gates on !gameWinnerName). Reject early rather than
      // showing a stuck screen. Player names and scores have fallbacks below.
      if (!winnerName) {
        gameLogger.error('❌ [GameEndContext] Invalid data — no winner name; cannot open modal:', {
          hasWinner: !!winnerName,
          scoresCount: scores.length,
          namesCount: names.length,
        });
        return;
      }

      // Build fallback scores when they are missing so the modal always opens.
      // This can happen when the backend fires game_over before final_scores are
      // persisted. The GameEndModal will still render the winner + player list
      // and can show 0-point placeholders rather than a blank screen.
      // 7.9: Also guard when scores arrive but all points_added are 0 — this
      // indicates the DB row was inserted but the score calculation hasn't
      // committed yet. Treat it the same as the missing-scores case.
      const allScoresZero =
        scores.length > 0 && scores.every(s => s.points_added === 0 && s.cumulative_score === 0);
      const resolvedScores: FinalScore[] =
        scores.length > 0 && !allScoresZero
          ? scores
          : names.map((name, idx) => ({
              player_index: idx,
              player_name: name,
              cumulative_score: 0,
              points_added: 0,
            }));

      if (scores.length === 0 || allScoresZero) {
        gameLogger.warn(
          '⚠️ [GameEndContext] scores array was empty — built placeholder scores from player names:',
          {
            namesCount: names.length,
            resolvedScoresCount: resolvedScores.length,
          }
        );
      }

      setGameWinnerName(winnerName);
      setGameWinnerIndex(winnerIndex);
      setFinalScores(resolvedScores);
      setPlayerNames(names);
      setScoreHistory(scoreHist as ScoreHistory[]);
      setPlayHistory(playHist as PlayHistoryMatch[]);
      setShowGameEndModal(true);

      // Track that the game end screen was shown so we can correlate completions with modal views.
      trackScreenView('GameEndModal');

      gameLogger.info('✅ [GameEndContext] State updated, modal opening with valid data');
    },
    // All captured values are either stable state setters (guaranteed by React)
    // or module-level imports (outer scope constants). No reactive deps needed.
    []
  );

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

  return <GameEndContext.Provider value={value}>{children}</GameEndContext.Provider>;
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
