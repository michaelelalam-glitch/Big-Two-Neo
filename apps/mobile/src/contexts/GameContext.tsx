/**
 * GameContext — shared game-view state for both Local AI and Multiplayer game modes.
 *
 * Replaces the 50+ individual props previously threaded from MultiplayerGame /
 * LocalAIGame through to GameView and its children.  Consumers call
 * `useGameContext()` to access the full game-view model; they throw if rendered
 * outside a `GameContextProvider`.
 *
 * H4 Audit fix — Task #638.
 */
import React, { createContext, useContext } from 'react';
import type { Card } from '../game/types';
import type { GameStateManager } from '../game/state';
import type { ScoreHistory, PlayHistoryMatch } from '../types/scoreboard';
import type { AutoPassTimerState } from '../types/multiplayer';

// ---------------------------------------------------------------------------
// Player type aliases (mirror the inline types in the old GameViewProps)
// ---------------------------------------------------------------------------

export interface LayoutPlayer {
  name: string;
  cardCount: number;
  score: number;
  isActive: boolean;
  player_index?: number;
  isDisconnected?: boolean;
  disconnectTimerStartedAt?: string | null;
}

export interface LayoutPlayerWithTimer extends LayoutPlayer {
  totalScore?: number;
  turnTimerStartedAt?: string | null;
  onCountdownExpired?: () => void;
}

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

export interface GameContextType {
  // ── Mode ───────────────────────────────────────────────────────────────
  isLocalAIGame: boolean;

  // ── Orientation ────────────────────────────────────────────────────────
  currentOrientation: 'portrait' | 'landscape';
  toggleOrientation: () => void;

  // ── Status flags ───────────────────────────────────────────────────────
  isInitializing: boolean;
  isConnected: boolean;

  // ── Settings modal ─────────────────────────────────────────────────────
  showSettings: boolean;
  setShowSettings: (show: boolean) => void;
  roomCode?: string;

  // ── Player hand & selection ────────────────────────────────────────────
  effectivePlayerHand: Card[];
  selectedCardIds: Set<string>;
  setSelectedCardIds: (ids: Set<string>) => void;
  handleCardsReorder: (cards: Card[]) => void;
  selectedCards: Card[];
  customCardOrder: string[];
  setCustomCardOrder: (order: string[]) => void;

  // ── Table state ────────────────────────────────────────────────────────
  effectiveLastPlayedCards: Card[];
  effectiveLastPlayedBy: string | null;
  effectiveLastPlayComboType: string | null;
  effectiveLastPlayCombo: string | null;

  // ── Layout players ─────────────────────────────────────────────────────
  layoutPlayers: LayoutPlayer[];
  layoutPlayersWithScores: LayoutPlayerWithTimer[];
  playerTotalScores: number[];
  currentPlayerName: string;

  // ── Scoreboard UI toggles ──────────────────────────────────────────────
  togglePlayHistory: () => void;
  toggleScoreboardExpanded: () => void;

  // ── Scoreboard display data ────────────────────────────────────────────
  memoizedPlayerNames: string[];
  memoizedCurrentScores: number[];
  memoizedCardCounts: number[];
  memoizedOriginalPlayerNames: string[];
  effectiveAutoPassTimerState: AutoPassTimerState | undefined;
  effectiveScoreboardCurrentPlayerIndex: number;
  matchNumber: number;
  isGameFinished: boolean;
  displayOrderScoreHistory: ScoreHistory[];
  playHistoryByMatch: PlayHistoryMatch[];

  // ── Action callbacks ───────────────────────────────────────────────────
  handlePlayCards: (cards: Card[]) => Promise<void>;
  handlePass: () => Promise<void>;
  handlePlaySuccess: () => void;
  handlePassSuccess: () => void;
  handleCardHandPlayCards: (cards: Card[]) => void;
  handleCardHandPass: () => void;
  handleLeaveGame: () => void;
  handleSort: () => void;
  handleSmartSort: () => void;
  handleHint: () => void;

  // ── Control state ──────────────────────────────────────────────────────
  /** True when it is the local player's turn and the game engine is ready. */
  isPlayerReady: boolean;

  // ── GameControls internals ─────────────────────────────────────────────
  gameManagerRef: React.MutableRefObject<GameStateManager | null>;
  isMountedRef: React.MutableRefObject<boolean>;
}

// ---------------------------------------------------------------------------
// Context object
// ---------------------------------------------------------------------------

const GameContext = createContext<GameContextType | undefined>(undefined);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface GameContextProviderProps {
  children: React.ReactNode;
  value: GameContextType;
}

export function GameContextProvider({ children, value }: GameContextProviderProps) {
  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

// ---------------------------------------------------------------------------
// Consumer hook
// ---------------------------------------------------------------------------

/**
 * Returns the current `GameContextType` value.
 * Throws if called outside a `<GameContextProvider>`.
 */
export function useGameContext(): GameContextType {
  const ctx = useContext(GameContext);
  if (ctx === undefined) {
    throw new Error('useGameContext must be used within a GameContextProvider');
  }
  return ctx;
}
