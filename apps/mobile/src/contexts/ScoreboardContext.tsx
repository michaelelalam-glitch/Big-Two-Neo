/**
 * ScoreboardContext - State management for scoreboard system
 * 
 * Manages:
 * - Scoreboard expand/collapse state
 * - Play history modal open/close state
 * - Match collapse state in play history
 * - Score history tracking
 * - Play history tracking
 * 
 * Created as part of Task #342: ScoreboardContext provider
 * Date: December 12, 2025
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ScoreboardContextState,
  ScoreHistory,
  PlayHistoryMatch,
} from '../types/scoreboard';
import { gameLogger } from '../utils/logger';

const SCORE_HISTORY_KEY = '@big2_score_history';

// ============================================================================
// CONTEXT DEFINITION
// ============================================================================

const ScoreboardContext = createContext<ScoreboardContextState | undefined>(undefined);

// ============================================================================
// PROVIDER PROPS
// ============================================================================

interface ScoreboardProviderProps {
  children: ReactNode;
  initialExpanded?: boolean;      // Initial expanded state
  initialPlayHistoryOpen?: boolean; // Initial play history open state
}

// ============================================================================
// PROVIDER COMPONENT
// ============================================================================

export const ScoreboardProvider: React.FC<ScoreboardProviderProps> = ({
  children,
  initialExpanded = false,
  initialPlayHistoryOpen = false,
}) => {
  // -------------------------------------------------------------------------
  // STATE - UI Controls
  // -------------------------------------------------------------------------
  
  const [isScoreboardExpanded, setIsScoreboardExpanded] = useState<boolean>(initialExpanded);
  const [isPlayHistoryOpen, setIsPlayHistoryOpen] = useState<boolean>(initialPlayHistoryOpen);
  const [collapsedMatches, setCollapsedMatches] = useState<Set<number>>(new Set());

  // -------------------------------------------------------------------------
  // STATE - History Tracking
  // -------------------------------------------------------------------------
  
  const [scoreHistory, setScoreHistory] = useState<ScoreHistory[]>([]);
  const [playHistoryByMatch, setPlayHistoryByMatch] = useState<PlayHistoryMatch[]>([]);

  // Persist scoreHistory to AsyncStorage whenever it changes (skip initial empty state)
  const isFirstRenderRef = useRef(true);
  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      return;
    }
    // Only persist non-empty scoreHistory (clearing is handled by clearHistory)
    if (scoreHistory.length > 0) {
      AsyncStorage.setItem(SCORE_HISTORY_KEY, JSON.stringify(scoreHistory)).catch((err) => {
        gameLogger.error('[ScoreboardContext] Failed to persist scoreHistory:', err?.message || String(err));
      });
    }
  }, [scoreHistory]);

  // -------------------------------------------------------------------------
  // HANDLERS - Match Collapse
  // -------------------------------------------------------------------------

  const toggleMatchCollapse = useCallback((matchNumber: number) => {
    setCollapsedMatches((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(matchNumber)) {
        newSet.delete(matchNumber);
      } else {
        newSet.add(matchNumber);
      }
      return newSet;
    });
  }, []);

  // -------------------------------------------------------------------------
  // HANDLERS - Score History
  // -------------------------------------------------------------------------

  const addScoreHistory = useCallback((history: ScoreHistory) => {
    gameLogger.info('🔍 [ScoreboardContext] addScoreHistory called, match:', history.matchNumber);
    setScoreHistory((prev) => {
      // Check if this match already exists
      const existingIndex = prev.findIndex((h) => h.matchNumber === history.matchNumber);
      
      if (existingIndex >= 0) {
        // Update existing match
        const updated = [...prev];
        updated[existingIndex] = history;
        gameLogger.info('🔍 [ScoreboardContext] Updated match, total count:', updated.length);
        return updated;
      } else {
        // Add new match
        const newHistory = [...prev, history];
        gameLogger.info('🔍 [ScoreboardContext] Added new match, total count:', newHistory.length);
        return newHistory;
      }
    });
  }, []);

  // -------------------------------------------------------------------------
  // HANDLERS - Play History
  // -------------------------------------------------------------------------

  const addPlayHistory = useCallback((history: PlayHistoryMatch) => {
    setPlayHistoryByMatch((prev) => {
      // Check if this match already exists
      const existingIndex = prev.findIndex((h) => h.matchNumber === history.matchNumber);
      
      if (existingIndex >= 0) {
        // Update existing match
        const updated = [...prev];
        updated[existingIndex] = history;
        return updated;
      } else {
        // Add new match
        return [...prev, history];
      }
    });
  }, []);

  // -------------------------------------------------------------------------
  // HANDLERS - Clear History
  // -------------------------------------------------------------------------

  /**
   * Restore scoreHistory from a persisted array (e.g. from AsyncStorage on rejoin).
   * Replaces the entire scoreHistory state in one shot.
   */
  const restoreScoreHistory = useCallback((history: ScoreHistory[]) => {
    gameLogger.info(`🔍 [ScoreboardContext] restoreScoreHistory called with ${history.length} entries`);
    setScoreHistory(history);
  }, []);

  const clearHistory = useCallback(() => {
    setScoreHistory([]);
    setPlayHistoryByMatch([]);
    setCollapsedMatches(new Set());
    setIsScoreboardExpanded(false);
    setIsPlayHistoryOpen(false);
    // Also clear persisted scoreHistory
    AsyncStorage.removeItem(SCORE_HISTORY_KEY).catch((err) => {
      gameLogger.error('[ScoreboardContext] Failed to clear persisted scoreHistory:', err?.message || String(err));
    });
  }, []);

  // -------------------------------------------------------------------------
  // CONTEXT VALUE
  // -------------------------------------------------------------------------

  const contextValue: ScoreboardContextState = {
    // UI state
    isScoreboardExpanded,
    setIsScoreboardExpanded,
    isPlayHistoryOpen,
    setIsPlayHistoryOpen,
    collapsedMatches,
    toggleMatchCollapse,
    
    // History
    scoreHistory,
    addScoreHistory,
    restoreScoreHistory,
    playHistoryByMatch,
    addPlayHistory,
    clearHistory,
  };

  return (
    <ScoreboardContext.Provider value={contextValue}>
      {children}
    </ScoreboardContext.Provider>
  );
};

// ============================================================================
// CUSTOM HOOK
// ============================================================================

/**
 * Hook to access scoreboard context
 * @throws Error if used outside ScoreboardProvider
 */
export const useScoreboard = (): ScoreboardContextState => {
  const context = useContext(ScoreboardContext);
  
  if (context === undefined) {
    throw new Error('useScoreboard must be used within a ScoreboardProvider');
  }
  
  return context;
};

// ============================================================================
// EXPORTS
// ============================================================================

export default ScoreboardContext;
