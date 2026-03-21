/**
 * Zustand store index — Task #647: Expanded store with slices
 *
 * Exports:
 *   useAppStore         — core user/room/game state (original store)
 *   useAudioSettingsStore — persisted audio & game preference settings
 *   useGameSessionStore   — transient game-session state (replaces Context prop-drilling)
 */

import { create } from 'zustand';
import type { Player, Room, GameState } from '../types';

// ─── Original app store (keep for backward compatibility) ─────────────────────

interface AppStore {
  currentUser: Player | null;
  currentRoom: Room | null;
  gameState: GameState | null;
  setCurrentUser: (user: Player | null) => void;
  setCurrentRoom: (room: Room | null) => void;
  setGameState: (state: GameState | null) => void;
}

export const useAppStore = create<AppStore>(set => ({
  currentUser: null,
  currentRoom: null,
  gameState: null,
  setCurrentUser: user => set({ currentUser: user }),
  setCurrentRoom: room => set({ currentRoom: room }),
  setGameState: state => set({ gameState: state }),
}));

// ─── New slices (Task #647) ───────────────────────────────────────────────────

export { useAudioSettingsStore } from './audioSettingsSlice';
export type {
  AudioSettingsState,
  CardSortOrder,
  AnimationSpeed,
  AutoPassTimer,
} from './audioSettingsSlice';

export { useGameSessionStore } from './gameSessionSlice';
export type { GameSessionState } from './gameSessionSlice';
