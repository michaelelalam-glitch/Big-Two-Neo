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

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import {
  ScoreboardContextState,
  ScoreHistory,
  PlayHistoryMatch,
} from '../types/scoreboard';

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
    setScoreHistory((prev) => {
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

  const clearHistory = useCallback(() => {
    setScoreHistory([]);
    setPlayHistoryByMatch([]);
    setCollapsedMatches(new Set());
    setIsScoreboardExpanded(false);
    setIsPlayHistoryOpen(false);
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
