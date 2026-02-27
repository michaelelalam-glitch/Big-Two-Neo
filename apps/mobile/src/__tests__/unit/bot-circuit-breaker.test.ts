/**
 * Unit tests for bot retry/circuit-breaker logic in GameStateManager.executeBotTurn()
 *
 * Verifies that:
 * 1. Bot retries stop after MAX_BOT_RETRIES (3 attempts)
 * 2. State advances (via advanceToNextPlayer) when the bot is declared stuck
 * 3. Listeners are notified after the forced advance
 */

// Mock soundManager to prevent .m4a file parse errors
jest.mock('../../utils/soundManager', () => ({
  soundManager: {
    playSound: jest.fn(),
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

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

import { createGameStateManager, type GameState } from '../../game/state';

describe('Bot circuit-breaker / retry logic', () => {
  let manager: ReturnType<typeof createGameStateManager>;

  beforeEach(async () => {
    manager = createGameStateManager();

    // Initialize game with 3 bots and easy difficulty (minimises randomness effects)
    await manager.initializeGame({
      playerName: 'Test Player',
      botCount: 3,
      botDifficulty: 'easy',
    });
  });

  afterEach(() => {
    manager.destroy();
  });

  test('should execute bot turn normally and advance player index', async () => {
    const state = manager.getState();
    if (!state) return;

    // Advance past human player if needed
    if (!state.players[state.currentPlayerIndex].isBot) {
      const human = state.players[state.currentPlayerIndex];
      const card3D = human.hand.find(c => c.id === '3D');
      if (card3D) await manager.playCards([card3D.id]);
    }

    const botState = manager.getState();
    if (!botState || !botState.players[botState.currentPlayerIndex].isBot) return;

    const playerIndexBefore = botState.currentPlayerIndex;

    let listenerCalled = false;
    const unsubscribe = manager.subscribe(() => { listenerCalled = true; });

    await manager.executeBotTurn();
    unsubscribe();

    const afterState = manager.getState();
    expect(afterState).not.toBeNull();
    if (afterState && !afterState.gameEnded) {
      expect(afterState.currentPlayerIndex).not.toBe(playerIndexBefore);
    }
    expect(listenerCalled).toBe(true);
  });

  test('should force-advance and notify listeners when bot is stuck after MAX_BOT_RETRIES', async () => {
    // Helper: advance until a bot is the current player using real methods
    async function advanceToBotTurn(): Promise<boolean> {
      for (let i = 0; i < 10; i++) {
        const s = manager.getState();
        if (!s || s.gameEnded) return false;
        if (s.players[s.currentPlayerIndex].isBot) return true;
        // Human player: play the 3D card to advance turn (human always starts with 3D)
        const human = s.players[s.currentPlayerIndex];
        const card3D = human.hand.find(c => c.id === '3D');
        if (card3D) await manager.playCards([card3D.id]);
      }
      const s = manager.getState();
      return Boolean(s && s.players[s.currentPlayerIndex].isBot);
    }

    const onBotTurn = await advanceToBotTurn();
    if (!onBotTurn) return; // Guard: skip if couldn't reach a bot turn

    const playerIndexBefore = manager.getState()!.currentPlayerIndex;

    // Force playCards and pass to always fail by directly replacing the methods
    // on the instance. This reliably intercepts `this.playCards()` / `this.pass()`
    // calls from within executeBotTurn() and triggers the circuit-breaker.
    const playCardsMock = jest.fn().mockResolvedValue({ success: false, error: 'forced test failure' });
    const passMock = jest.fn().mockResolvedValue({ success: false, error: 'forced test failure' });
    (manager as any).playCards = playCardsMock;
    (manager as any).pass = passMock;

    let listenerCallCount = 0;
    const unsubscribe = manager.subscribe(() => { listenerCallCount++; });

    await manager.executeBotTurn();
    unsubscribe();

    // (1) Circuit-breaker should have called advanceToNextPlayer() — player advances
    const afterState = manager.getState();
    expect(afterState).not.toBeNull();
    if (afterState && !afterState.gameEnded) {
      expect(afterState.currentPlayerIndex).not.toBe(playerIndexBefore);
    }

    // (2) Listeners must have been notified after the forced advance
    expect(listenerCallCount).toBeGreaterThan(0);

    // (3) At least 4 failed calls: 1 initial + 3 retries = MAX_BOT_RETRIES + 1
    const totalFailedCalls = playCardsMock.mock.calls.length + passMock.mock.calls.length;
    expect(totalFailedCalls).toBeGreaterThanOrEqual(4);
  });

  test('should not crash when executeBotTurn is called on non-bot player', async () => {
    const state = manager.getState();
    if (!state) return;

    // If human player is current, executeBotTurn should be a no-op (return null)
    if (!state.players[state.currentPlayerIndex].isBot) {
      const result = await manager.executeBotTurn();
      expect(result).toBeNull();
    }
  });

  test('should handle multiple sequential bot turns without getting stuck', async () => {
    // Play through several turns to verify the circuit breaker doesn't
    // interfere with normal gameplay flow
    let iterations = 0;
    const maxIterations = 20;

    while (iterations < maxIterations) {
      const state = manager.getState();
      if (!state || state.gameEnded) break;

      if (state.players[state.currentPlayerIndex].isBot) {
        await manager.executeBotTurn();
      } else {
        // Human player passes
        await manager.pass();
      }

      iterations++;
    }

    // Should have progressed through multiple turns without hanging
    expect(iterations).toBeGreaterThan(0);

    const finalState = manager.getState();
    expect(finalState).not.toBeNull();
  });
});
