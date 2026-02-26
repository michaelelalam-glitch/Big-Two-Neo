/**
 * Game State Manager tests
 * Tests for game initialization, state management, and persistence
 */

// Mock soundManager to prevent .m4a file parse errors
jest.mock('../../utils/soundManager', () => ({
  soundManager: {
    playSound: jest.fn().mockResolvedValue(undefined),
    stopSound: jest.fn(),
    initialize: jest.fn().mockResolvedValue(undefined),
  },
  SoundType: {
    GAME_START: 'GAME_START',
    HIGHEST_CARD: 'HIGHEST_CARD',
    CARD_PLAY: 'CARD_PLAY',
    PASS: 'PASS',
    WINNER: 'WINNER',
  },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  GameStateManager,
  createGameStateManager,
  type GameConfig,
} from '../state';

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

describe('Game State Manager - Initialization', () => {
  let manager: GameStateManager;

  beforeEach(() => {
    manager = createGameStateManager();
    jest.clearAllMocks();
  });

  afterEach(() => {
    manager.destroy();
  });

  test('creates manager instance', () => {
    expect(manager).toBeInstanceOf(GameStateManager);
  });

  test('initializes game with correct configuration', async () => {
    const config: GameConfig = {
      playerName: 'Player 1',
      botCount: 3,
      botDifficulty: 'medium',
    };

    const state = await manager.initializeGame(config);

    expect(state.players).toHaveLength(4);
    expect(state.players[0].name).toBe('Player 1');
    expect(state.players[0].isBot).toBe(false);
    expect(state.players[1].isBot).toBe(true);
    expect(state.players[2].isBot).toBe(true);
    expect(state.players[3].isBot).toBe(true);
  });

  test('deals 13 cards to each player', async () => {
    const config: GameConfig = {
      playerName: 'Player 1',
      botCount: 3,
      botDifficulty: 'medium',
    };

    const state = await manager.initializeGame(config);

    for (const player of state.players) {
      expect(player.hand).toHaveLength(13);
    }
  });

  test('finds starting player with 3D', async () => {
    const config: GameConfig = {
      playerName: 'Player 1',
      botCount: 3,
      botDifficulty: 'medium',
    };

    const state = await manager.initializeGame(config);
    const startingPlayer = state.players[state.currentPlayerIndex];

    expect(startingPlayer.hand.some(c => c.id === '3D')).toBe(true);
  });

  test('sets isFirstPlayOfGame to true', async () => {
    const config: GameConfig = {
      playerName: 'Player 1',
      botCount: 3,
      botDifficulty: 'medium',
    };

    const state = await manager.initializeGame(config);

    expect(state.isFirstPlayOfGame).toBe(true);
    expect(state.gameStarted).toBe(true);
    expect(state.gameEnded).toBe(false);
  });
});

describe('Game State Manager - Play Cards', () => {
  let manager: GameStateManager;

  beforeEach(async () => {
    manager = createGameStateManager();
    const config: GameConfig = {
      playerName: 'Player 1',
      botCount: 3,
      botDifficulty: 'medium',
    };
    await manager.initializeGame(config);
    jest.clearAllMocks();
  });

  afterEach(() => {
    manager.destroy();
  });

  test('allows valid single card play', async () => {
    const state = manager.getState()!;
    const currentPlayer = state.players[state.currentPlayerIndex];
    const card3D = currentPlayer.hand.find(c => c.id === '3D')!;

    const result = await manager.playCards([card3D.id]);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  test('rejects invalid card (not in hand)', async () => {
    const result = await manager.playCards(['INVALID_CARD']);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  test('removes played cards from hand', async () => {
    const state = manager.getState()!;
    const currentPlayer = state.players[state.currentPlayerIndex];
    const card3D = currentPlayer.hand.find(c => c.id === '3D')!;
    const initialHandSize = currentPlayer.hand.length;

    await manager.playCards([card3D.id]);

    const newState = manager.getState()!;
    const newPlayer = newState.players.find(p => p.id === currentPlayer.id)!;

    expect(newPlayer.hand.length).toBe(initialHandSize - 1);
    expect(newPlayer.hand.some(c => c.id === card3D.id)).toBe(false);
  });

  test('updates lastPlay after valid play', async () => {
    const state = manager.getState()!;
    const currentPlayer = state.players[state.currentPlayerIndex];
    const card3D = currentPlayer.hand.find(c => c.id === '3D')!;

    await manager.playCards([card3D.id]);

    const newState = manager.getState()!;

    expect(newState.lastPlay).not.toBeNull();
    expect(newState.lastPlay!.cards).toHaveLength(1);
    expect(newState.lastPlay!.combo_type).toBe('Single');
  });

  test('sets isFirstPlayOfGame to false after first play', async () => {
    const state = manager.getState()!;
    const currentPlayer = state.players[state.currentPlayerIndex];
    const card3D = currentPlayer.hand.find(c => c.id === '3D')!;

    await manager.playCards([card3D.id]);

    const newState = manager.getState()!;
    expect(newState.isFirstPlayOfGame).toBe(false);
  });

  test('advances to next player after play', async () => {
    const state = manager.getState()!;
    const currentPlayer = state.players[state.currentPlayerIndex];
    const card3D = currentPlayer.hand.find(c => c.id === '3D')!;
    const initialIndex = state.currentPlayerIndex;

    await manager.playCards([card3D.id]);

    const newState = manager.getState()!;
    expect(newState.currentPlayerIndex).not.toBe(initialIndex);
  });

  test('detects win when hand is empty', async () => {
    const state = manager.getState()!;
    const currentPlayer = state.players[state.currentPlayerIndex];

    // Artificially reduce hand to 1 card for testing
    currentPlayer.hand = [currentPlayer.hand.find(c => c.id === '3D')!];

    const result = await manager.playCards(['3D']);

    expect(result.success).toBe(true);
    const newState = manager.getState()!;
    expect(newState.gameEnded).toBe(true);
    expect(newState.winnerId).toBe(currentPlayer.id);
  });
});

describe('Game State Manager - Pass', () => {
  let manager: GameStateManager;

  beforeEach(async () => {
    manager = createGameStateManager();
    const config: GameConfig = {
      playerName: 'Player 1',
      botCount: 3,
      botDifficulty: 'medium',
    };
    await manager.initializeGame(config);

    // Make first play to set lastPlay
    const state = manager.getState()!;
    const currentPlayer = state.players[state.currentPlayerIndex];
    const card3D = currentPlayer.hand.find(c => c.id === '3D')!;
    await manager.playCards([card3D.id]);

    jest.clearAllMocks();
  });

  afterEach(() => {
    manager.destroy();
  });

  test('allows pass when not leading', async () => {
    const result = await manager.pass();

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  test('increments consecutive passes', async () => {
    const initialPasses = manager.getState()!.consecutivePasses;

    await manager.pass();

    const newPasses = manager.getState()!.consecutivePasses;
    expect(newPasses).toBe(initialPasses + 1);
  });

  test('advances to next player after pass', async () => {
    const initialIndex = manager.getState()!.currentPlayerIndex;

    await manager.pass();

    const newIndex = manager.getState()!.currentPlayerIndex;
    expect(newIndex).not.toBe(initialIndex);
  });

  test('starts new trick when all players pass', async () => {
    // Pass 3 times (all other players)
    await manager.pass();
    await manager.pass();
    await manager.pass();

    const state = manager.getState()!;

    // After 3 passes, trick should reset
    expect(state.consecutivePasses).toBe(0);
    expect(state.lastPlay).toBeNull();
  });

  test('adds pass to round history', async () => {
    const initialHistory = manager.getState()!.roundHistory.length;

    await manager.pass();

    const newHistory = manager.getState()!.roundHistory;
    expect(newHistory.length).toBe(initialHistory + 1);
    expect(newHistory[newHistory.length - 1].passed).toBe(true);
  });
});

describe('Game State Manager - Persistence', () => {
  let manager: GameStateManager;

  beforeEach(() => {
    manager = createGameStateManager();
    jest.clearAllMocks();
  });

  afterEach(() => {
    manager.destroy();
  });

  test('saves state to AsyncStorage', async () => {
    const config: GameConfig = {
      playerName: 'Player 1',
      botCount: 3,
      botDifficulty: 'medium',
    };

    await manager.initializeGame(config);

    expect(AsyncStorage.setItem).toHaveBeenCalled();
  });

  test('loads state from AsyncStorage', async () => {
    const mockState = {
      players: [],
      currentPlayerIndex: 0,
      lastPlay: null,
      lastPlayPlayerIndex: 0,
      consecutivePasses: 0,
      isFirstPlayOfGame: true,
      gameStarted: true,
      gameEnded: false,
      winnerId: null,
      roundHistory: [],
      gameRoundHistory: [],
      currentMatch: 1,
      matchScores: [],
      lastMatchWinnerId: null,
      gameOver: false,
      finalWinnerId: null,
      startedAt: Date.now(),
      auto_pass_timer: null,
      played_cards: [],
    };

    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(mockState));
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);

    const loadedState = await manager.loadState();

    expect(AsyncStorage.getItem).toHaveBeenCalled();
    expect(loadedState).toEqual(mockState);
  });

  test('returns null when no saved state', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);

    const loadedState = await manager.loadState();

    expect(loadedState).toBeNull();
  });

  test('clears state from AsyncStorage', async () => {
    await manager.clearState();

    expect(AsyncStorage.removeItem).toHaveBeenCalled();
  });
});

describe('Game State Manager - State Listeners', () => {
  let manager: GameStateManager;

  beforeEach(() => {
    manager = createGameStateManager();
  });

  afterEach(() => {
    manager.destroy();
  });

  test('notifies listeners on state change', async () => {
    const listener = jest.fn();
    manager.subscribe(listener);

    const config: GameConfig = {
      playerName: 'Player 1',
      botCount: 3,
      botDifficulty: 'medium',
    };

    await manager.initializeGame(config);

    expect(listener).toHaveBeenCalled();
  });

  test('unsubscribe removes listener', async () => {
    const listener = jest.fn();
    const unsubscribe = manager.subscribe(listener);

    unsubscribe();

    const config: GameConfig = {
      playerName: 'Player 1',
      botCount: 3,
      botDifficulty: 'medium',
    };

    await manager.initializeGame(config);

    expect(listener).not.toHaveBeenCalled();
  });

  test('multiple listeners receive updates', async () => {
    const listener1 = jest.fn();
    const listener2 = jest.fn();

    manager.subscribe(listener1);
    manager.subscribe(listener2);

    const config: GameConfig = {
      playerName: 'Player 1',
      botCount: 3,
      botDifficulty: 'medium',
    };

    await manager.initializeGame(config);

    expect(listener1).toHaveBeenCalled();
    expect(listener2).toHaveBeenCalled();
  });
});

describe('Game State Manager - Bot Turn Execution', () => {
  let manager: GameStateManager;

  beforeEach(async () => {
    manager = createGameStateManager();
    const config: GameConfig = {
      playerName: 'Player 1',
      botCount: 3,
      botDifficulty: 'easy',
    };
    await manager.initializeGame(config);

    // Move to first bot player
    const state = manager.getState()!;
    while (!state.players[state.currentPlayerIndex].isBot) {
      await manager.pass();
    }

    jest.clearAllMocks();
  });

  afterEach(() => {
    manager.destroy();
  });

  test('executes bot turn automatically', async () => {
    const state = manager.getState()!;
    const currentPlayer = state.players[state.currentPlayerIndex];
    const initialHistoryLength = state.roundHistory.length;

    expect(currentPlayer.isBot).toBe(true);

    await manager.executeBotTurn();

    // State should have changed (either play or pass)
    const newState = manager.getState()!;
    expect(newState.roundHistory.length).toBeGreaterThan(initialHistoryLength);
  });

  test('does not execute turn for human player', async () => {
    // Force current player to be human
    const state = manager.getState()!;
    state.currentPlayerIndex = 0; // Player 1 is always human

    const initialHistoryLength = state.roundHistory.length;

    await manager.executeBotTurn();

    // No action should be taken
    const newState = manager.getState()!;
    expect(newState.roundHistory.length).toBe(initialHistoryLength);
  });
});
