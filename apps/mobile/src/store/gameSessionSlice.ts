/**
 * gameSessionSlice — Task #647: Expand Zustand store
 *
 * Holds transient game-session state that is shared across multiple components
 * but previously required prop-drilling through GameView / CardHand / GameControls.
 *
 * Card selection (selectedCardIds) lives exclusively in GameContext via the
 * useCardSelection hook — it was never migrated to this store.
 *
 * Note: action callbacks (handlePlayCards, handlePass, etc.) remain in
 * GameContext because they close over async game state managers and LiveKit
 * refs that cannot trivially be stored in Zustand.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { LayoutPlayer, LayoutPlayerWithTimer } from '../contexts/GameContext';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GameSessionState {
  // ── Card selection ────────────────────────────────────────────────────────
  /** User-defined card ordering (drag-to-reorder) */
  customCardOrder: string[];

  // ── Player layout ─────────────────────────────────────────────────────────
  /** Display-order player list for the current game */
  layoutPlayers: LayoutPlayer[];
  /** layoutPlayers enriched with score history and turn-timer data */
  layoutPlayersWithScores: LayoutPlayerWithTimer[];
  /** Cumulative scores indexed by display order */
  playerTotalScores: number[];
  /** Display name of the local player */
  currentPlayerName: string;

  // ── Game status ───────────────────────────────────────────────────────────
  /** True when it is the local player's turn and the game engine is ready */
  isPlayerReady: boolean;
  /** True when the current game/match has concluded */
  isGameFinished: boolean;
  /** Current match number (1-based) within the session */
  matchNumber: number;

  // ── Actions ───────────────────────────────────────────────────────────────
  setCustomCardOrder: (order: string[]) => void;
  setLayoutPlayers: (players: LayoutPlayer[]) => void;
  setLayoutPlayersWithScores: (players: LayoutPlayerWithTimer[]) => void;
  setPlayerTotalScores: (scores: number[]) => void;
  setCurrentPlayerName: (name: string) => void;
  setIsPlayerReady: (ready: boolean) => void;
  // P4-6 FIX: isGameFinished and matchNumber are derived from the Realtime
  // game_state.game_phase subscription via syncSessionSnapshot only.
  // Standalone setters have been removed to prevent drift caused by a missed
  // Realtime update leaving the store in an inconsistent state.
  /** Atomically sync layout, score, and game-status session fields in a single named store action */
  syncSessionSnapshot: (snapshot: {
    layoutPlayers: LayoutPlayer[];
    layoutPlayersWithScores: LayoutPlayerWithTimer[];
    playerTotalScores: number[];
    currentPlayerName: string;
    isPlayerReady: boolean;
    isGameFinished: boolean;
    matchNumber: number;
  }) => void;
  /** Reset all session state when a game ends / player navigates away */
  resetSession: () => void;
}

// ─── Initial state ────────────────────────────────────────────────────────────

const INITIAL_STATE: Omit<
  GameSessionState,
  | 'setCustomCardOrder'
  | 'setLayoutPlayers'
  | 'setLayoutPlayersWithScores'
  | 'setPlayerTotalScores'
  | 'setCurrentPlayerName'
  | 'setIsPlayerReady'
  | 'syncSessionSnapshot'
  | 'resetSession'
> = {
  customCardOrder: [],
  layoutPlayers: [],
  layoutPlayersWithScores: [],
  playerTotalScores: [],
  currentPlayerName: '',
  isPlayerReady: false,
  isGameFinished: false,
  matchNumber: 1,
};

// ─── Store ────────────────────────────────────────────────────────────────────

export const useGameSessionStore = create<GameSessionState>()(
  devtools(
    set => ({
      ...INITIAL_STATE,

      setCustomCardOrder: order =>
        set({ customCardOrder: order }, false, 'gameSession/setCustomCardOrder'),

      setLayoutPlayers: players =>
        set({ layoutPlayers: players }, false, 'gameSession/setLayoutPlayers'),

      setLayoutPlayersWithScores: players =>
        set({ layoutPlayersWithScores: players }, false, 'gameSession/setLayoutPlayersWithScores'),

      setPlayerTotalScores: scores =>
        set({ playerTotalScores: scores }, false, 'gameSession/setPlayerTotalScores'),

      setCurrentPlayerName: name =>
        set({ currentPlayerName: name }, false, 'gameSession/setCurrentPlayerName'),

      setIsPlayerReady: ready =>
        set({ isPlayerReady: ready }, false, 'gameSession/setIsPlayerReady'),

      syncSessionSnapshot: snapshot => set(snapshot, false, 'gameSession/syncSessionSnapshot'),

      resetSession: () => set({ ...INITIAL_STATE }, false, 'gameSession/resetSession'),
    }),
    { name: 'Big2/GameSession' }
  )
);
