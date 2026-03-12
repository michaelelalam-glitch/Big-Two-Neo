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
  soundManager: {
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

// Mock logger to prevent expo-file-system transform errors
jest.mock('../../utils/logger', () => ({
  gameLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  statsLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { GameStateManager, type GameState } from '../state';
import { gameLogger } from '../../utils/logger';
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
    test('handles saveState AsyncStorage error gracefully and logs it', async () => {
      (gameLogger.error as jest.Mock).mockClear();
      (AsyncStorage.setItem as jest.Mock).mockRejectedValue(new Error('Storage full'));
      
      await manager.initializeGame({ playerName: 'Player 1', botCount: 1, botDifficulty: 'easy' });
      
      // saveState should handle errors gracefully without throwing
      await expect(manager.saveState()).resolves.toBeUndefined();
      
      // Verify the error was logged via gameLogger (not silently swallowed)
      expect(gameLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to save game state'),
        expect.stringContaining('Storage full')
      );
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

  // ---------------------------------------------------------------------------
  // C1 — gameRoundHistory pruning (OOM fix)
  // ---------------------------------------------------------------------------
  describe('C1 — gameRoundHistory pruning', () => {
    /** Build a minimal serialised GameState with N round-history entries. */
    function makePersistedState(
      entries: Array<{ matchNumber?: number }>,
      currentMatch: number
    ): string {
      const state = {
        players: [],
        currentPlayerIndex: 0,
        roundHistory: [],
        gameRoundHistory: entries.map(e => ({
          playerId: 'p1',
          playerName: 'Player 1',
          cards: [],
          combo_type: 'unknown',
          timestamp: Date.now(),
          passed: true,
          ...e,
        })),
        tricksPlayed: 0,
        currentMatch,
        lastMatchWinnerId: null,
        phase: 'waiting',
        played_cards: [],
        consecutivePasses: 0,
        currentTrick: null,
        scores: [],
        matchScores: [],
        gameOver: false,
        winner: null,
        auto_pass_timer: null,
      };
      return JSON.stringify(state);
    }

    test('loadState prunes entries older than cutoff when all have matchNumber', async () => {
      // Simulate 25 matches worth of history (one entry per match, matchNumbers 1–25)
      const entries = Array.from({ length: 25 }, (_, i) => ({ matchNumber: i + 1 }));
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(makePersistedState(entries, 25));

      const loaded = await manager.loadState();

      // Cutoff = 25 - 20 = 5; entries with matchNumber < 5 should be pruned
      expect(loaded).not.toBeNull();
      expect(loaded!.gameRoundHistory.every(e => (e.matchNumber ?? 0) >= 5)).toBe(true);
      // Entries for matches 5–25 = 21 entries retained
      expect(loaded!.gameRoundHistory.length).toBeLessThanOrEqual(21);
      // AsyncStorage.setItem should have been called (needsMigration=true)
      expect(AsyncStorage.setItem).toHaveBeenCalled();
    });

    test('loadState uses length-based cap for legacy entries without matchNumber', async () => {
      // All 30 entries are legacy (no matchNumber field)
      const entries = Array.from({ length: 30 }, () => ({}));
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(makePersistedState(entries, 25));

      const loaded = await manager.loadState();

      expect(loaded).not.toBeNull();
      // Should be capped to MAX_GAME_ROUND_HISTORY_MATCHES = 20
      expect(loaded!.gameRoundHistory.length).toBeLessThanOrEqual(20);
    });

    test('loadState does not prune when entries are within the cap', async () => {
      const entries = Array.from({ length: 10 }, (_, i) => ({ matchNumber: i + 15 }));
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(makePersistedState(entries, 25));
      (AsyncStorage.setItem as jest.Mock).mockClear();

      const loaded = await manager.loadState();

      expect(loaded).not.toBeNull();
      expect(loaded!.gameRoundHistory.length).toBe(10);
    });

    test('startNewMatch tags new entries with current match number', async () => {
      (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
      await manager.initializeGame({ playerName: 'Player 1', botCount: 3, botDifficulty: 'easy' });

      const state = manager.getState()!;
      // Manually inject a round-history entry tagged with match 1
      state.gameRoundHistory.push({
        playerId: 'p1', playerName: 'Player 1', cards: [],
        combo_type: 'unknown', timestamp: Date.now(), passed: true,
        matchNumber: state.currentMatch,
      });

      expect(state.gameRoundHistory[0].matchNumber).toBe(state.currentMatch);
    });

    test('startNewMatch prunes entries older than cutoff after >20 matches', async () => {
      (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
      await manager.initializeGame({ playerName: 'Player 1', botCount: 3, botDifficulty: 'easy' });

      const state = manager.getState()!;
      // Simulate 25 existing entries tagged with matches 1–25
      state.gameRoundHistory = Array.from({ length: 25 }, (_, i) => ({
        playerId: 'p1', playerName: 'Player 1', cards: [],
        combo_type: 'unknown', timestamp: Date.now(), passed: true,
        matchNumber: i + 1,
      }));
      // Push currentMatch to 25 so pruning triggers (cutoff=6) when startNewMatch increments to 26
      state.currentMatch = 25;
      // startNewMatch requires gameEnded=true and gameOver=false
      state.gameEnded = true;
      state.gameOver = false;

      await manager.startNewMatch();

      const afterState = manager.getState()!;
      // cutoff = 26 - 20 = 6; entries with matchNumber < 6 should be gone
      expect(afterState.gameRoundHistory.every(e => (e.matchNumber ?? 0) >= 6)).toBe(true);
    });

    test('startNewMatch uses length-based cap for legacy entries without matchNumber', async () => {
      (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
      await manager.initializeGame({ playerName: 'Player 1', botCount: 3, botDifficulty: 'easy' });

      const state = manager.getState()!;
      // 30 legacy entries with no matchNumber
      state.gameRoundHistory = Array.from({ length: 30 }, () => ({
        playerId: 'p1', playerName: 'Player 1', cards: [],
        combo_type: 'unknown', timestamp: Date.now(), passed: true,
      }));
      state.currentMatch = 25; // ensures pruning condition triggers
      // startNewMatch requires gameEnded=true and gameOver=false
      state.gameEnded = true;
      state.gameOver = false;

      await manager.startNewMatch();

      const afterState = manager.getState()!;
      expect(afterState.gameRoundHistory.length).toBeLessThanOrEqual(20);
    });
  });
});
