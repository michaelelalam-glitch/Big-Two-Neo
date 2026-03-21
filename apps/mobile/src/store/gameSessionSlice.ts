/**
 * gameSessionSlice — Task #647: Expand Zustand store
 *
 * Holds transient game-session state that is shared across multiple components
 * but previously required prop-drilling through GameView / CardHand / GameControls.
 *
 * Migration plan:
 * - Phase 1 (this PR): Create the slice scaffold. No GameContext writes are
 *   wired yet — this establishes the store shape and devtools integration for
 *   future migration.
 * - Phase 2 (future): Wire GameContext to write into this slice; consumers may
 *   read from either.
 *
 * Note: action callbacks (handlePlayCards, handlePass, etc.) remain in
 * GameContext because they close over async game state managers and LiveKit
 * refs that cannot trivially be stored in Zustand.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { Card } from '../game/types';
import type { LayoutPlayer, LayoutPlayerWithTimer } from '../contexts/GameContext';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GameSessionState {
  // ── Card selection ────────────────────────────────────────────────────────
  /** IDs of currently selected cards (Set for O(1) lookup) */
  /** Selected card IDs stored as a serializable string array */
  selectedCardIds: string[];
  /** Derived array of selected Card objects (kept in sync with selectedCardIds) */
  selectedCards: Card[];
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
  setSelectedCardIds: (ids: string[], allCards: Card[]) => void;
  setCustomCardOrder: (order: string[]) => void;
  setLayoutPlayers: (players: LayoutPlayer[]) => void;
  setLayoutPlayersWithScores: (players: LayoutPlayerWithTimer[]) => void;
  setPlayerTotalScores: (scores: number[]) => void;
  setCurrentPlayerName: (name: string) => void;
  setIsPlayerReady: (ready: boolean) => void;
  setIsGameFinished: (finished: boolean) => void;
  setMatchNumber: (match: number) => void;
  /** Reset all session state when a game ends / player navigates away */
  resetSession: () => void;
}

// ─── Initial state ────────────────────────────────────────────────────────────

const INITIAL_STATE: Omit<
  GameSessionState,
  | 'setSelectedCardIds'
  | 'setCustomCardOrder'
  | 'setLayoutPlayers'
  | 'setLayoutPlayersWithScores'
  | 'setPlayerTotalScores'
  | 'setCurrentPlayerName'
  | 'setIsPlayerReady'
  | 'setIsGameFinished'
  | 'setMatchNumber'
  | 'resetSession'
> = {
  selectedCardIds: [],
  selectedCards: [],
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

      setSelectedCardIds: (ids, allCards) => {
        const nextIds = [...ids];
        return set(
          {
            selectedCardIds: nextIds,
            selectedCards: allCards.filter(c => nextIds.includes(c.id)),
          },
          false,
          'gameSession/setSelectedCardIds'
        );
      },

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

      setIsGameFinished: finished =>
        set({ isGameFinished: finished }, false, 'gameSession/setIsGameFinished'),

      setMatchNumber: match => set({ matchNumber: match }, false, 'gameSession/setMatchNumber'),

      resetSession: () =>
        set({ ...INITIAL_STATE, selectedCardIds: [] }, false, 'gameSession/resetSession'),
    }),
    { name: 'Big2/GameSession' }
  )
);
