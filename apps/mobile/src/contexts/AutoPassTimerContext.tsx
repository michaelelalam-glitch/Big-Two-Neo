/**
 * AutoPassTimerContext — P9-1 audit fix.
 *
 * Isolates the frequently-changing auto-pass timer state from the main
 * GameContext so that timer tick updates only re-render components that
 * explicitly consume this context, leaving the rest of GameView's tree stable.
 *
 * Provided automatically by GameContextProvider — consumers call
 * useAutoPassTimerContext() instead of reading these fields from useGameContext().
 */
import React, { createContext, useContext, useMemo } from 'react';
import type { AutoPassTimerState } from '../types/multiplayer';

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

export interface AutoPassTimerContextType {
  /** The current auto-pass timer state from the DB, or undefined when inactive. */
  effectiveAutoPassTimerState: AutoPassTimerState | undefined;
  /**
   * Server-to-client clock offset in ms (positive = client behind server).
   * 0 for local AI games.
   */
  turnClockOffsetMs: number;
}

// ---------------------------------------------------------------------------
// Context object
// ---------------------------------------------------------------------------

const AutoPassTimerContext = createContext<AutoPassTimerContextType | undefined>(undefined);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface AutoPassTimerContextProviderProps {
  children: React.ReactNode;
  effectiveAutoPassTimerState: AutoPassTimerState | undefined;
  turnClockOffsetMs: number;
}

export function AutoPassTimerContextProvider({
  children,
  effectiveAutoPassTimerState,
  turnClockOffsetMs,
}: AutoPassTimerContextProviderProps) {
  const value = useMemo(
    () => ({ effectiveAutoPassTimerState, turnClockOffsetMs }),
    [effectiveAutoPassTimerState, turnClockOffsetMs]
  );
  return <AutoPassTimerContext.Provider value={value}>{children}</AutoPassTimerContext.Provider>;
}

// ---------------------------------------------------------------------------
// Consumer hook
// ---------------------------------------------------------------------------

/**
 * Returns `{ effectiveAutoPassTimerState, turnClockOffsetMs }`.
 * Throws if called outside a `<AutoPassTimerContextProvider>`.
 */
export function useAutoPassTimerContext(): AutoPassTimerContextType {
  const ctx = useContext(AutoPassTimerContext);
  if (ctx === undefined) {
    throw new Error('useAutoPassTimerContext must be used within an AutoPassTimerContextProvider');
  }
  return ctx;
}

export default AutoPassTimerContext;
