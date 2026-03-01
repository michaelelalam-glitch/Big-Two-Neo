/**
 * Tests for useMatchTransition hook
 *
 * Covers the Copilot-flagged behaviours:
 *  1. Schedules fallback start_new_match after grace period when game_phase='finished'.
 *  2. Does NOT schedule when game_phase is NOT 'finished'.
 *  3. Cancels the pending timer when the game advances before it fires.
 *  4. Does NOT restart the timer on unrelated gameState re-renders (because gameState is
 *     stored in a ref — triggerNewMatch is not recreated on every state update).
 */

jest.mock('../../services/supabase', () => ({
  supabase: {
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { game_phase: 'finished', match_number: 1 },
        error: null,
      }),
    }),
  },
}));

jest.mock('../../utils/edgeFunctionRetry', () => ({
  invokeWithRetry: jest.fn().mockResolvedValue({
    data: { success: true, match_number: 2, starting_player_index: 0 },
    error: null,
  }),
}));

jest.mock('../../utils/logger', () => ({
  gameLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  networkLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { renderHook, act } from '@testing-library/react-native';
import { useMatchTransition } from '../useMatchTransition';
import { invokeWithRetry } from '../../utils/edgeFunctionRetry';

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

const MATCH_TRANSITION_GRACE_MS = 5000;

const mockRoom = { id: 'room-1', code: 'ABC123' };

const makeGameState = (game_phase: string, match_number = 1) =>
  ({
    game_phase,
    match_number,
    id: 'gs-1',
    room_id: 'room-1',
    current_turn: 0,
    hands: {},
    last_play: null,
    played_cards: [],
    passes: 0,
    auto_pass_timer: null,
    play_history: [],
  } as any);

describe('useMatchTransition', () => {
  describe('Grace period scheduling', () => {
    it('calls start_new_match after grace period when game_phase is finished', async () => {
      const gameState = makeGameState('finished');

      renderHook(() =>
        useMatchTransition({ gameState, room: mockRoom, enabled: true })
      );

      // Before grace period
      expect(invokeWithRetry).not.toHaveBeenCalled();

      // Advance past grace period
      await act(async () => {
        jest.advanceTimersByTime(MATCH_TRANSITION_GRACE_MS + 100);
      });

      expect(invokeWithRetry).toHaveBeenCalledWith(
        'start_new_match',
        expect.objectContaining({
          body: expect.objectContaining({ room_id: mockRoom.id }),
        })
      );
    });

    it('does NOT call start_new_match when game_phase is playing', async () => {
      const gameState = makeGameState('playing');

      renderHook(() =>
        useMatchTransition({ gameState, room: mockRoom, enabled: true })
      );

      await act(async () => {
        jest.advanceTimersByTime(MATCH_TRANSITION_GRACE_MS + 100);
      });

      expect(invokeWithRetry).not.toHaveBeenCalled();
    });

    it('does NOT call start_new_match when disabled', async () => {
      const gameState = makeGameState('finished');

      renderHook(() =>
        useMatchTransition({ gameState, room: mockRoom, enabled: false })
      );

      await act(async () => {
        jest.advanceTimersByTime(MATCH_TRANSITION_GRACE_MS + 100);
      });

      expect(invokeWithRetry).not.toHaveBeenCalled();
    });
  });

  describe('Timer cancellation when game advances', () => {
    it('cancels the timer when game_phase changes to playing before it fires', async () => {
      const { rerender } = renderHook(
        (props: { gameState: ReturnType<typeof makeGameState> }) =>
          useMatchTransition({ gameState: props.gameState, room: mockRoom, enabled: true }),
        { initialProps: { gameState: makeGameState('finished') } }
      );

      // Advance half the grace period
      act(() => {
        jest.advanceTimersByTime(MATCH_TRANSITION_GRACE_MS / 2);
      });

      // Game advanced — next match started by someone else
      rerender({ gameState: makeGameState('playing', 2) });

      // Advance past full grace period
      await act(async () => {
        jest.advanceTimersByTime(MATCH_TRANSITION_GRACE_MS);
      });

      expect(invokeWithRetry).not.toHaveBeenCalled();
    });
  });

  describe('Stable callback — no timer restart on unrelated state updates', () => {
    it('fires exactly once even if gameState reference changes without phase change', async () => {
      // Simulate repeated Realtime updates that produce a new gameState object
      // without changing game_phase or match_number (e.g., passes field changes).
      const { rerender } = renderHook(
        (props: { gameState: ReturnType<typeof makeGameState> }) =>
          useMatchTransition({ gameState: props.gameState, room: mockRoom, enabled: true }),
        { initialProps: { gameState: makeGameState('finished') } }
      );

      // Advance part of the grace period
      act(() => {
        jest.advanceTimersByTime(MATCH_TRANSITION_GRACE_MS / 2);
      });

      // New object reference with same values (simulate Realtime update unrelated to phase)
      rerender({ gameState: { ...makeGameState('finished'), passes: 1 } });

      // Advance remaining time
      await act(async () => {
        jest.advanceTimersByTime(MATCH_TRANSITION_GRACE_MS / 2 + 200);
      });

      // Should have been called exactly once — timer wasn't restarted by the re-render
      expect(invokeWithRetry).toHaveBeenCalledTimes(1);
    });
  });

  describe('Cleanup on unmount', () => {
    it('cancels the pending timer on unmount', async () => {
      const gameState = makeGameState('finished');

      const { unmount } = renderHook(() =>
        useMatchTransition({ gameState, room: mockRoom, enabled: true })
      );

      act(() => {
        jest.advanceTimersByTime(MATCH_TRANSITION_GRACE_MS / 2);
      });

      unmount();

      await act(async () => {
        jest.advanceTimersByTime(MATCH_TRANSITION_GRACE_MS);
      });

      expect(invokeWithRetry).not.toHaveBeenCalled();
    });
  });
});
