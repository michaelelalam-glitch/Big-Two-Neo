/**
 * Extended state manager tests for error handling and edge cases
 */

// Mock soundManager FIRST to prevent .m4a require errors
jest.mock('../../utils/soundManager', () => ({
  SoundManager: {
    preloadAllSounds: jest.fn(() => Promise.resolve()),
    playSound: jest.fn(() => Promise.resolve()),
    cleanup: jest.fn(() => Promise.resolve()),
  },
  SoundType: {
    GAME_START: 'GAME_START',
    HIGHEST_CARD: 'HIGHEST_CARD',
    CARD_PLAY: 'CARD_PLAY',
    PASS: 'PASS',
  },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { GameStateManager, type GameState } from '../state';
import type { Card } from '../types';

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

describe('GameStateManager - Extended Coverage Tests', () => {
  let manager: GameStateManager;

  beforeEach(() => {
    jest.clearAllMocks();
    manager = new GameStateManager();
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    (AsyncStorage.removeItem as jest.Mock).mockResolvedValue(undefined);
  });

  afterEach(() => {
    manager.destroy();
  });

  describe('AsyncStorage error handling', () => {
    test('handles saveState AsyncStorage error gracefully', async () => {
      (AsyncStorage.setItem as jest.Mock).mockRejectedValue(new Error('Storage full'));
      
      await manager.initializeGame({ playerName: 'Player 1', botCount: 1, botDifficulty: 'easy' });
      
      // saveState should handle errors gracefully without throwing
      await expect(manager.saveState()).resolves.toBeUndefined();
    });

    test('handles loadState with corrupted data', async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue('invalid json {{{');
      
      const result = await manager.loadState();
      expect(result).toBeNull();
    });

    test('handles loadState with null data (no saved state)', async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
      
      const result = await manager.loadState();
      expect(result).toBeNull();
    });

    test('handles loadState AsyncStorage error', async () => {
      (AsyncStorage.getItem as jest.Mock).mockRejectedValue(new Error('Storage read error'));
      
      const result = await manager.loadState();
      expect(result).toBeNull();
    });

    test('handles clearState successfully', async () => {
      (AsyncStorage.removeItem as jest.Mock).mockResolvedValue(undefined);
      
      await manager.clearState();
      expect(AsyncStorage.removeItem).toHaveBeenCalledWith('@big2_game_state');
    });
  });

  describe('Game flow edge cases', () => {
    test('validates pass is only allowed when lastPlay exists', async () => {
      await manager.initializeGame({ playerName: 'Player 1', botCount: 1, botDifficulty: 'easy' });
      
      // Try to pass at start of game (no lastPlay, isFirstPlayOfGame=true)
      const result = await manager.pass();
      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot pass when leading');
    });

    test('validates cards must be from current player hand', async () => {
      await manager.initializeGame({ playerName: 'Player 1', botCount: 1, botDifficulty: 'easy' });
      
      const result = await manager.playCards(['FAKE_CARD_ID']);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid card selection');
    });

    test('handles playCards when game not started', async () => {
      const result = await manager.playCards(['3D']);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Game not in progress');
    });

    test('handles pass when game not started', async () => {
      const result = await manager.pass();
      expect(result.success).toBe(false);
      expect(result.error).toBe('Game not in progress');
    });

    test('handles executeBotTurn when game not started', async () => {
      await manager.executeBotTurn();
      // Should do nothing
      const state = manager.getState();
      expect(state).toBeNull();
    });
  });

  describe('Game state listeners', () => {
    test('notifies listener via subscribe on game init', async () => {
      const listener = jest.fn();
      manager.subscribe(listener);
      
      await manager.initializeGame({ playerName: 'Player 1', botCount: 1, botDifficulty: 'easy' });
      
      expect(listener).toHaveBeenCalled();
    });

    test('removes listener via unsubscribe', async () => {
      const listener = jest.fn();
      const unsubscribe = manager.subscribe(listener);
      unsubscribe();
      
      await manager.initializeGame({ playerName: 'Player 1', botCount: 1, botDifficulty: 'easy' });
      
      expect(listener).not.toHaveBeenCalled();
    });

    test('handles multiple listeners', async () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();
      manager.subscribe(listener1);
      manager.subscribe(listener2);
      
      await manager.initializeGame({ playerName: 'Player 1', botCount: 1, botDifficulty: 'easy' });
      
      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
    });
  });

  describe('Special game scenarios', () => {
    test('handles bot playing at game start', async () => {
      await manager.initializeGame({ playerName: 'Player 1', botCount: 3, botDifficulty: 'easy' });
      const state = manager.getState();
      
      // If bot has 3D, it should be current player
      if (state && state.players[state.currentPlayerIndex].isBot) {
        await manager.executeBotTurn();
        const newState = manager.getState();
        expect(newState!.lastPlay).not.toBeNull();
      }
    });

    test('handles game with multiple bots', async () => {
      const state = await manager.initializeGame({ playerName: 'Player 1', botCount: 3, botDifficulty: 'medium' });
      
      expect(state.players.length).toBe(4);
      expect(state.players.filter(p => p.isBot).length).toBe(3);
    });

    test('handles game with hard difficulty bots', async () => {
      const state = await manager.initializeGame({ playerName: 'Player 1', botCount: 2, botDifficulty: 'hard' });
      
      expect(state.players.length).toBe(3);
      expect(state.players.filter(p => p.isBot && p.botDifficulty === 'hard').length).toBe(2);
    });

    test('properly deals 13 cards to each player', async () => {
      const state = await manager.initializeGame({ playerName: 'Player 1', botCount: 3, botDifficulty: 'easy' });
      
      expect(state.players.every(p => p.hand.length === 13)).toBe(true);
    });

    test('finds player with 3D as starting player', async () => {
      const state = await manager.initializeGame({ playerName: 'Player 1', botCount: 3, botDifficulty: 'easy' });
      
      const startingPlayer = state.players[state.currentPlayerIndex];
      expect(startingPlayer.hand.some(c => c.id === '3D')).toBe(true);
    });

    test('sets isFirstPlayOfGame flag correctly', async () => {
      const state = await manager.initializeGame({ playerName: 'Player 1', botCount: 1, botDifficulty: 'easy' });
      
      expect(state.isFirstPlayOfGame).toBe(true);
    });
  });

  describe('Save/load state persistence', () => {
    test('saves and loads complete game state', async () => {
      let savedState: string | null = null;
      
      (AsyncStorage.setItem as jest.Mock).mockImplementation(async (key, value) => {
        savedState = value;
      });
      (AsyncStorage.getItem as jest.Mock).mockImplementation(async () => savedState);
      
      const originalState = await manager.initializeGame({ playerName: 'Player 1', botCount: 1, botDifficulty: 'medium' });
      
      await manager.saveState();
      
      const newManager = new GameStateManager();
      const loadedState = await newManager.loadState();
      
      expect(loadedState).not.toBeNull();
      expect(loadedState!.players.length).toBe(originalState.players.length);
      expect(loadedState!.players[0].name).toBe('Player 1');
    });

    test('clearState removes saved data and resets state', async () => {
      (AsyncStorage.removeItem as jest.Mock).mockResolvedValue(undefined);
      
      await manager.initializeGame({ playerName: 'Player 1', botCount: 1, botDifficulty: 'easy' });
      expect(manager.getState()).not.toBeNull();
      
      await manager.clearState();
      
      expect(AsyncStorage.removeItem).toHaveBeenCalledWith('@big2_game_state');
      expect(manager.getState()).toBeNull();
    });

    test('getState returns null before initialization', () => {
      expect(manager.getState()).toBeNull();
    });
  });
});
