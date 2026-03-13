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

    // Must play 3D first — game rules prohibit passing on the first play.
    // Without this, pass() returns {success:false} immediately and the while
    // loop below becomes an infinite microtask loop when the human holds 3D.
    const state = manager.getState()!;
    const startingPlayer = state.players[state.currentPlayerIndex];
    const card3D = startingPlayer.hand.find(c => c.id === '3D')!;
    await manager.playCards([card3D.id]);

    // Advance to the first bot player (at most 1 pass needed since 3 of 4 are bots)
    let safety = 0;
    while (!state.players[state.currentPlayerIndex].isBot) {
      const result = await manager.pass();
      if (!result.success || ++safety > 4) {
        throw new Error(
          `Failed to advance to bot player after ${safety} attempts: ${result.error}`
        );
      }
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

describe('Game State Manager - gameRoundHistory pruning (C1 OOM fix)', () => {
  let manager: GameStateManager;

  beforeEach(() => {
    manager = createGameStateManager();
    jest.clearAllMocks();
  });

  afterEach(() => {
    manager.destroy();
  });

  /** Build a minimal GameState-like object with N history entries spread across matchNumbers 1..N  */
  function makeStateWithHistory(matchCount: number) {
    const entries = Array.from({ length: matchCount }, (_, i) => ({
      playerId: 'p1',
      playerName: 'Player 1',
      cards: [],
      combo_type: 'Single' as const,
      passed: false,
      timestamp: Date.now(),
      matchNumber: i + 1,
    }));

    return {
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
      gameRoundHistory: entries,
      currentMatch: matchCount,
      matchScores: [],
      lastMatchWinnerId: null,
      gameOver: false,
      finalWinnerId: null,
      startedAt: Date.now(),
      auto_pass_timer: null,
      played_cards: [],
    };
  }

  test('loadState() prunes oversized matchNumber-based history (>20 matches)', async () => {
    const taggedState = makeStateWithHistory(25); // 25 entries, all with matchNumber 1-25
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(taggedState));
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);

    const loaded = await manager.loadState();

    // cutoff = 25 - 20 + 1 = 6; entries with matchNumber >= 6 are retained (matches 6-25 = 20 entries)
    const cutoff = 25 - 20 + 1;
    expect(loaded!.gameRoundHistory.every(e => (e.matchNumber ?? 0) >= cutoff)).toBe(true);
    // The pruned array must be bounded to exactly MAX_GAME_ROUND_HISTORY_MATCHES (20)
    expect(loaded!.gameRoundHistory.length).toBeLessThanOrEqual(20);
    // Migration save must be triggered
    expect(AsyncStorage.setItem).toHaveBeenCalled();
  });

  test('loadState() applies length-based cap for legacy entries without matchNumber', async () => {
    // Simulate a pre-upgrade persisted state where entries have no matchNumber
    const legacyEntries = Array.from({ length: 5000 }, (_, i) => ({
      playerId: 'p1',
      playerName: 'Player 1',
      cards: [],
      combo_type: 'Single' as const,
      passed: false,
      timestamp: Date.now() - i,
      // No matchNumber — legacy format
    }));
    const legacyState = {
      ...makeStateWithHistory(1),
      gameRoundHistory: legacyEntries,
      currentMatch: 25, // currentMatch > MAX so pruning is triggered
    };
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(legacyState));
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);

    const loaded = await manager.loadState();

    // Legacy path: length-based cap — MAX_LEGACY_ROUND_HISTORY_ENTRIES = 20 * 200 = 4000
    expect(loaded!.gameRoundHistory.length).toBeLessThanOrEqual(4000);
    // All retained entries should still have no matchNumber (legacy format preserved)
    expect(loaded!.gameRoundHistory.every(e => e.matchNumber == null)).toBe(true);
    // Migration save must be triggered
    expect(AsyncStorage.setItem).toHaveBeenCalled();
  });

  test('loadState() leaves history untouched when ≤20 matches', async () => {
    const smallState = makeStateWithHistory(15);
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(smallState));
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);

    const loaded = await manager.loadState();

    expect(loaded!.gameRoundHistory).toHaveLength(15);
    // No needsMigration triggered by pruning — setItem should not have been called
    // (no other migration fields are missing in this state)
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  test('startNewMatch() prunes entries older than currentMatch-20', async () => {
    const config: GameConfig = { playerName: 'Player 1', botCount: 3, botDifficulty: 'medium' };
    await manager.initializeGame(config);

    // Manually inject history entries spanning matches 1-21 to simulate a long session
    const state = manager.getState()!;
    state.currentMatch = 21;
    state.gameRoundHistory = Array.from({ length: 21 }, (_, i) => ({
      playerId: 'p1',
      playerName: 'Player 1',
      cards: [],
      combo_type: 'Single' as const,
      passed: false,
      timestamp: Date.now(),
      matchNumber: i + 1,
    }));
    state.gameEnded = true;
    state.winnerId = state.players[0].id;

    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);

    await manager.startNewMatch();

    // After startNewMatch currentMatch becomes 22; cutoff = 22-20 = 2;
    // entries with matchNumber < 2 (matchNumber === 1) should be removed
    const newState = manager.getState()!;
    expect(newState.gameRoundHistory.every(e => (e.matchNumber ?? 0) >= 2)).toBe(true);
    expect(newState.gameRoundHistory.length).toBe(20);
  });

  test('history entries pushed during play are tagged with currentMatch', async () => {
    const config: GameConfig = { playerName: 'Player 1', botCount: 3, botDifficulty: 'medium' };
    await manager.initializeGame(config);

    const state = manager.getState()!;
    const currentPlayer = state.players[state.currentPlayerIndex];
    const card3D = currentPlayer.hand.find(c => c.id === '3D')!;

    await manager.playCards([card3D.id]);

    const newState = manager.getState()!;
    const lastEntry = newState.gameRoundHistory[newState.gameRoundHistory.length - 1];
    expect(lastEntry.matchNumber).toBe(newState.currentMatch);
  });
});

describe('Game State Manager - lazy timer start (C2 leak fix)', () => {
  let setIntervalSpy: jest.SpyInstance;
  let clearIntervalSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    // Spy BEFORE creating any manager so we capture calls from the constructor.
    setIntervalSpy = jest.spyOn(global, 'setInterval');
    clearIntervalSpy = jest.spyOn(global, 'clearInterval');
  });

  afterEach(() => {
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });

  test('constructor does NOT call setInterval', () => {
    const manager = createGameStateManager();
    // The 100ms auto-pass interval must not be started until a game session exists.
    expect(setIntervalSpy).not.toHaveBeenCalled();
    manager.destroy();
  });

  test('initializeGame() starts exactly one interval', async () => {
    const manager = createGameStateManager();
    setIntervalSpy.mockClear(); // discard any unrelated setInterval calls from other modules

    await manager.initializeGame({ playerName: 'Player 1', botCount: 3, botDifficulty: 'medium' });

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 100);
    manager.destroy();
  });

  test('loadState() re-starts the interval for a restored session', async () => {
    const manager = createGameStateManager();

    // Build a minimal saved state to satisfy loadState migration + assign
    const savedState = {
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
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(savedState));

    setIntervalSpy.mockClear();
    await manager.loadState();

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 100);
    manager.destroy();
  });

  test('destroy() stops the interval and calling it twice is safe', async () => {
    const manager = createGameStateManager();

    await manager.initializeGame({ playerName: 'Player 1', botCount: 3, botDifficulty: 'medium' });

    manager.destroy();
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);

    // Second destroy must be a no-op (timerInterval is null after first destroy)
    manager.destroy();
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
  });
});
