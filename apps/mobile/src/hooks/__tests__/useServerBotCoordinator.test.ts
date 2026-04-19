/**
 * Tests for useServerBotCoordinator hook
 *
 * Covers the three behaviours Copilot flagged as requiring unit tests:
 *  1. Schedules a fallback trigger after the grace period when it's a bot's turn.
 *  2. Re-schedules after TRIGGER_COOLDOWN_MS if the bot turn is still stuck.
 *  3. Does NOT cancel the pending timer on an unrelated re-render that produces
 *     a new `players` array reference without changing current_turn or game_phase.
 */

jest.mock('../../services/supabase', () => ({
  supabase: {
    functions: {
      invoke: jest.fn().mockResolvedValue({ data: { success: true }, error: null }),
    },
  },
}));

jest.mock('../../utils/logger', () => ({
  gameLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { renderHook, act } from '@testing-library/react-native';
import { useServerBotCoordinator } from '../useServerBotCoordinator';
import { supabase } from '../../services/supabase';

// Use fake timers so we can fast-forward without waiting for real delays
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});

afterEach(() => {
  // Only drain pending timers when fake timers are active; calling
  // runOnlyPendingTimers with real timers triggers a Jest warning.
  if (jest.isMockFunction(setTimeout)) {
    jest.runOnlyPendingTimers();
  }
  jest.useRealTimers();
});

const ROOM_CODE = 'TEST01';
const FALLBACK_GRACE_PERIOD_MS = 300;
const TRIGGER_COOLDOWN_MS = 2000;

const botPlayer = { player_index: 1, is_bot: true, username: 'Bot1' };
const humanPlayer = { player_index: 0, is_bot: false, username: 'Human' };

const makeBotTurnState = (current_turn = 1, game_phase = 'playing') =>
  ({
    current_turn,
    game_phase,
    id: 'gs-1',
    room_id: 'room-1',
    match_number: 1,
    hands: {},
    last_play: null,
    played_cards: [],
    passes: 0,
    auto_pass_timer: null,
    play_history: [],
  }) as any;

describe('useServerBotCoordinator', () => {
  describe('Grace period scheduling', () => {
    it('triggers bot-coordinator after grace period when it is a bot turn', async () => {
      const gameState = makeBotTurnState(1);
      const players = [humanPlayer, botPlayer];

      renderHook(() =>
        useServerBotCoordinator({
          roomCode: ROOM_CODE,
          enabled: true,
          gameState,
          players,
        })
      );

      // Before grace period — should NOT have been called yet
      expect(supabase.functions.invoke).not.toHaveBeenCalled();

      // Advance past the grace period
      await act(async () => {
        jest.advanceTimersByTime(FALLBACK_GRACE_PERIOD_MS + 100);
      });

      expect(supabase.functions.invoke).toHaveBeenCalledWith('bot-coordinator', {
        body: { room_code: ROOM_CODE },
      });
    });

    it('does NOT trigger when it is a human turn', async () => {
      const gameState = makeBotTurnState(0); // human turn
      const players = [humanPlayer, botPlayer];

      renderHook(() =>
        useServerBotCoordinator({
          roomCode: ROOM_CODE,
          enabled: true,
          gameState,
          players,
        })
      );

      await act(async () => {
        jest.advanceTimersByTime(FALLBACK_GRACE_PERIOD_MS + 100);
      });

      expect(supabase.functions.invoke).not.toHaveBeenCalled();
    });

    it('does NOT trigger when disabled', async () => {
      const gameState = makeBotTurnState(1);
      const players = [humanPlayer, botPlayer];

      renderHook(() =>
        useServerBotCoordinator({
          roomCode: ROOM_CODE,
          enabled: false,
          gameState,
          players,
        })
      );

      await act(async () => {
        jest.advanceTimersByTime(FALLBACK_GRACE_PERIOD_MS + 100);
      });

      expect(supabase.functions.invoke).not.toHaveBeenCalled();
    });

    it('does NOT trigger when game_phase is finished', async () => {
      const gameState = makeBotTurnState(1, 'finished');
      const players = [humanPlayer, botPlayer];

      renderHook(() =>
        useServerBotCoordinator({
          roomCode: ROOM_CODE,
          enabled: true,
          gameState,
          players,
        })
      );

      await act(async () => {
        jest.advanceTimersByTime(FALLBACK_GRACE_PERIOD_MS + 100);
      });

      expect(supabase.functions.invoke).not.toHaveBeenCalled();
    });

    it('does NOT trigger when isAutoPassInProgress is true', async () => {
      const gameState = makeBotTurnState(1);
      const players = [humanPlayer, botPlayer];

      renderHook(() =>
        useServerBotCoordinator({
          roomCode: ROOM_CODE,
          enabled: true,
          gameState,
          players,
          isAutoPassInProgress: true,
        })
      );

      await act(async () => {
        jest.advanceTimersByTime(FALLBACK_GRACE_PERIOD_MS + 100);
      });

      expect(supabase.functions.invoke).not.toHaveBeenCalled();
    });
  });

  describe('Cooldown retry behaviour', () => {
    it('re-triggers after TRIGGER_COOLDOWN_MS if bot turn is still stuck', async () => {
      const gameState = makeBotTurnState(1);
      const players = [humanPlayer, botPlayer];

      // Make first invocation resolve immediately (simulate server call that didn't advance turn)
      (supabase.functions.invoke as jest.Mock).mockResolvedValue({ error: null });

      renderHook(() =>
        useServerBotCoordinator({
          roomCode: ROOM_CODE,
          enabled: true,
          gameState,
          players,
        })
      );

      // First trigger after grace period
      await act(async () => {
        jest.advanceTimersByTime(FALLBACK_GRACE_PERIOD_MS + 100);
      });
      expect(supabase.functions.invoke).toHaveBeenCalledTimes(1);

      // Second trigger after cooldown (turn still hasn't advanced)
      await act(async () => {
        jest.advanceTimersByTime(TRIGGER_COOLDOWN_MS + 100);
      });
      expect(supabase.functions.invoke).toHaveBeenCalledTimes(2);
    });
  });

  describe('Timer stability on player array re-renders', () => {
    it('does NOT cancel the pending timer when players array reference changes without turn change', async () => {
      const gameState = makeBotTurnState(1);
      const players = [humanPlayer, botPlayer];

      const { rerender } = renderHook(
        (props: { players: typeof players }) =>
          useServerBotCoordinator({
            roomCode: ROOM_CODE,
            enabled: true,
            gameState,
            players: props.players,
          }),
        { initialProps: { players } }
      );

      // Advance half the grace period
      act(() => {
        jest.advanceTimersByTime(FALLBACK_GRACE_PERIOD_MS / 2);
      });

      // Re-render with NEW players array reference (same data, different object)
      rerender({ players: [{ ...humanPlayer }, { ...botPlayer }] });

      // Advance the remaining grace period
      await act(async () => {
        jest.advanceTimersByTime(FALLBACK_GRACE_PERIOD_MS / 2 + 100);
      });

      // Should still have fired exactly once — timer was NOT cancelled by the re-render
      expect(supabase.functions.invoke).toHaveBeenCalledTimes(1);
    });
  });

  describe('Cleanup on unmount', () => {
    it('cancels pending timer on unmount', async () => {
      const gameState = makeBotTurnState(1);
      const players = [humanPlayer, botPlayer];

      const { unmount } = renderHook(() =>
        useServerBotCoordinator({
          roomCode: ROOM_CODE,
          enabled: true,
          gameState,
          players,
        })
      );

      // Advance part of the grace period, then unmount
      act(() => {
        jest.advanceTimersByTime(FALLBACK_GRACE_PERIOD_MS / 2);
      });

      unmount();

      // Advance past the full grace period — trigger should NOT fire after unmount
      await act(async () => {
        jest.advanceTimersByTime(FALLBACK_GRACE_PERIOD_MS);
      });

      expect(supabase.functions.invoke).not.toHaveBeenCalled();
    });
  });
});
