import { create } from 'zustand';
import { Player, Room, GameState } from '../types';

interface AppStore {
  currentUser: Player | null;
  currentRoom: Room | null;
  gameState: GameState | null;
  setCurrentUser: (user: Player | null) => void;
  setCurrentRoom: (room: Room | null) => void;
  setGameState: (state: GameState | null) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  currentUser: null,
  currentRoom: null,
  gameState: null,
  setCurrentUser: (user) => set({ currentUser: user }),
  setCurrentRoom: (room) => set({ currentRoom: room }),
  setGameState: (state) => set({ gameState: state }),
}));
