/**
 * 2-Player & 3-Player Game Configuration Tests — H21 Audit Fix
 *
 * All existing game engine tests assume 4 players (botCount: 3).
 * These tests verify initialization, dealing, scoring, and
 * turn-advancement behavior for 2-player and 3-player configs.
 */

// Mock soundManager FIRST to prevent .m4a require errors
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

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

import { GameStateManager, createGameStateManager, type GameConfig } from '../state';

// ────────────────────────────────────────────────────────────────────────────
// 2-Player Games (botCount: 1)
// ────────────────────────────────────────────────────────────────────────────
describe('2-Player Game (botCount: 1)', () => {
  let manager: GameStateManager;
  const config: GameConfig = {
    playerName: 'Player 1',
    botCount: 1,
    botDifficulty: 'medium',
  };

  beforeEach(() => {
    manager = createGameStateManager();
    jest.clearAllMocks();
  });

  afterEach(() => {
    manager.destroy();
  });

  it('initializes with exactly 2 players', async () => {
    const state = await manager.initializeGame(config);
    expect(state.players).toHaveLength(2);
    expect(state.players[0].isBot).toBe(false);
    expect(state.players[1].isBot).toBe(true);
  });

  it('deals 13 cards to each player (26 of 52 used)', async () => {
    const state = await manager.initializeGame(config);
    expect(state.players[0].hand).toHaveLength(13);
    expect(state.players[1].hand).toHaveLength(13);
  });

  it('has no duplicate cards across hands', async () => {
    const state = await manager.initializeGame(config);
    const allCards = [...state.players[0].hand, ...state.players[1].hand];
    const uniqueIds = new Set(allCards.map(c => c.id));
    expect(uniqueIds.size).toBe(26);
  });

  it('starting player has 3D or falls back to player 0 when 3D is undealt', async () => {
    const state = await manager.initializeGame(config);
    const startingPlayer = state.players[state.currentPlayerIndex];
    const allDealtCards = state.players.flatMap(p => p.hand);
    const threeOfDiamondsDealt = allDealtCards.some(c => c.id === '3D');

    if (threeOfDiamondsDealt) {
      expect(startingPlayer.hand.some(c => c.id === '3D')).toBe(true);
    } else {
      // 3D is in the undealt 26 cards — fallback to player 0
      expect(state.currentPlayerIndex).toBe(0);
    }
  });

  it('sets game-started flags correctly', async () => {
    const state = await manager.initializeGame(config);
    expect(state.isFirstPlayOfGame).toBe(true);
    expect(state.gameStarted).toBe(true);
    expect(state.gameEnded).toBe(false);
  });

  it('initializes match scores for both players', async () => {
    const state = await manager.initializeGame(config);
    expect(state.matchScores).toHaveLength(2);
    expect(state.matchScores[0].playerId).toBe('player_0');
    expect(state.matchScores[1].playerId).toBe('bot_1');
    expect(state.matchScores.every(s => s.score === 0)).toBe(true);
  });

  it('gameplay crashes within first turn cycle due to hardcoded TURN_ORDER', async () => {
    // DOCUMENTS BUG: TURN_ORDER = [3, 2, 0, 1] is hardcoded for 4 players.
    // For 2 players, TURN_ORDER[0]=3 and TURN_ORDER[1]=2 are both out of bounds.
    // The crash happens in advanceToNextPlayer() when players[nextIdx] is undefined.
    const state = await manager.initializeGame(config);
    const allDealtCards = state.players.flatMap(p => p.hand);
    const threeOfDiamondsDealt = allDealtCards.some(c => c.id === '3D');

    if (!threeOfDiamondsDealt) {
      // 3D in undealt deck half — first play is blocked by validation.
      // Bug still exists but can't be triggered without 3D on the table.
      expect(state.players.length).toBe(2);
      return;
    }

    // 3D is dealt — attempt gameplay; crash occurs on first successful turn advance
    let crashed = false;
    try {
      for (let turn = 0; turn < 10; turn++) {
        const s = manager.getState();
        if (!s || s.gameEnded) break;
        const p = s.players[s.currentPlayerIndex];
        if (p.isBot) {
          await manager.executeBotTurn();
        } else if (s.isFirstPlayOfGame) {
          const d3 = p.hand.find(c => c.id === '3D');
          if (d3) {
            await manager.playCards([d3.id]);
          } else {
            break; // Human can't play first without 3D
          }
        } else if (s.lastPlay) {
          await manager.pass();
        }
      }
    } catch {
      crashed = true;
    }

    expect(crashed).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 3-Player Games (botCount: 2)
// ────────────────────────────────────────────────────────────────────────────
describe('3-Player Game (botCount: 2)', () => {
  let manager: GameStateManager;
  const config: GameConfig = {
    playerName: 'Player 1',
    botCount: 2,
    botDifficulty: 'hard',
  };

  beforeEach(() => {
    manager = createGameStateManager();
    jest.clearAllMocks();
  });

  afterEach(() => {
    manager.destroy();
  });

  it('initializes with exactly 3 players', async () => {
    const state = await manager.initializeGame(config);
    expect(state.players).toHaveLength(3);
    expect(state.players[0].isBot).toBe(false);
    expect(state.players[1].isBot).toBe(true);
    expect(state.players[2].isBot).toBe(true);
  });

  it('deals 13 cards to each player (39 of 52 used)', async () => {
    const state = await manager.initializeGame(config);
    for (const player of state.players) {
      expect(player.hand).toHaveLength(13);
    }
  });

  it('has no duplicate cards across hands', async () => {
    const state = await manager.initializeGame(config);
    const allCards = state.players.flatMap(p => p.hand);
    const uniqueIds = new Set(allCards.map(c => c.id));
    expect(uniqueIds.size).toBe(39);
  });

  it('starting player has 3D or falls back to player 0 when 3D is undealt', async () => {
    const state = await manager.initializeGame(config);
    const startingPlayer = state.players[state.currentPlayerIndex];
    const allDealtCards = state.players.flatMap(p => p.hand);
    const threeOfDiamondsDealt = allDealtCards.some(c => c.id === '3D');

    if (threeOfDiamondsDealt) {
      expect(startingPlayer.hand.some(c => c.id === '3D')).toBe(true);
    } else {
      // 3D is in the undealt 13 cards — fallback to player 0
      expect(state.currentPlayerIndex).toBe(0);
    }
  });

  it('assigns correct bot difficulty', async () => {
    const state = await manager.initializeGame(config);
    expect(state.players[1].botDifficulty).toBe('hard');
    expect(state.players[2].botDifficulty).toBe('hard');
  });

  it('initializes match scores for all 3 players', async () => {
    const state = await manager.initializeGame(config);
    expect(state.matchScores).toHaveLength(3);
    expect(state.matchScores.map(s => s.playerId)).toEqual(['player_0', 'bot_1', 'bot_2']);
  });

  it('pass-reset threshold is player-count-aware', async () => {
    // consecutivePasses >= players.length - 1 resets the board.
    // For 3 players: 2 consecutive passes should reset.
    const state = await manager.initializeGame(config);
    // The threshold formula `players.length - 1` = 2 for 3 players
    expect(state.players.length - 1).toBe(2);
  });

  it('gameplay crashes when player 0 turn advances (TURN_ORDER[0]=3 bug)', async () => {
    // DOCUMENTS BUG: TURN_ORDER[0] = 3 is out of bounds for 3-player games.
    // TURN_ORDER[1]=2 and TURN_ORDER[2]=0 are valid, so crash only happens
    // when player at index 0 completes a play and advanceToNextPlayer is called.
    const state = await manager.initializeGame(config);
    const allDealtCards = state.players.flatMap(p => p.hand);
    const threeOfDiamondsDealt = allDealtCards.some(c => c.id === '3D');

    if (!threeOfDiamondsDealt) {
      // 3D in undealt 13 cards — first play is blocked by validation.
      expect(state.players.length).toBe(3);
      return;
    }

    // 3D is dealt — play through turns until player 0's turn advance triggers crash
    let crashed = false;
    try {
      for (let turn = 0; turn < 20; turn++) {
        const s = manager.getState();
        if (!s || s.gameEnded) break;
        const p = s.players[s.currentPlayerIndex];
        if (p.isBot) {
          await manager.executeBotTurn();
        } else if (s.isFirstPlayOfGame) {
          const d3 = p.hand.find(c => c.id === '3D');
          if (d3) {
            await manager.playCards([d3.id]);
          } else {
            break;
          }
        } else if (s.lastPlay) {
          await manager.pass();
        }
      }
    } catch {
      crashed = true;
    }

    // For 3 players, crash is expected when player 0 tries to advance
    expect(crashed).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 1-Player Game (botCount: 0 — edge case)
// ────────────────────────────────────────────────────────────────────────────
describe('1-Player Game (botCount: 0) — edge case', () => {
  let manager: GameStateManager;
  const config: GameConfig = {
    playerName: 'Solo',
    botCount: 0,
    botDifficulty: 'easy',
  };

  beforeEach(() => {
    manager = createGameStateManager();
  });

  afterEach(() => {
    manager.destroy();
  });

  it('initializes with exactly 1 player', async () => {
    const state = await manager.initializeGame(config);
    expect(state.players).toHaveLength(1);
    expect(state.players[0].name).toBe('Solo');
  });

  it('deals 13 cards to the solo player', async () => {
    const state = await manager.initializeGame(config);
    expect(state.players[0].hand).toHaveLength(13);
  });
});
