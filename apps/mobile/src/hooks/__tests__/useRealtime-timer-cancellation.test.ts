/**
 * @file useRealtime-timer-cancellation.test.ts
 * @description Integration tests for auto-pass timer cancellation behavior.
 * Tests ensure timers are properly canceled when players pass or play cards.
 *
 * Architecture note (Dec 2025):
 * - pass() calls the player-pass Edge Function via invokeWithRetry.
 *   If the response has no auto_pass_timer, local state is cleared.
 *   A 'player_passed' broadcast is sent.
 * - playCards() calls the play-cards Edge Function via invokeWithRetry.
 *   If the previous gameState had auto_pass_timer, an 'auto_pass_timer_cancelled'
 *   broadcast is sent (fire-and-forget) with reason 'new_play'.
 *   A 'cards_played' broadcast is always sent.
 */

// Mock Supabase BEFORE imports
jest.mock('../../services/supabase');

// Mock invokeWithRetry (Edge Function calls)
jest.mock('../../utils/edgeFunctionRetry', () => ({
  invokeWithRetry: jest.fn().mockResolvedValue({
    data: {
      success: true,
      next_turn: 1,
      passes: 1,
      trick_cleared: false,
    },
    error: null,
  }),
}));

// Mock loggers
jest.mock('../../utils/logger', () => ({
  networkLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    logRealtimeEvent: jest.fn(),
    logRealtimeError: jest.fn(),
  },
  gameLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { renderHook, act, waitFor } from '@testing-library/react-native';
import { useRealtime } from '../useRealtime';
import { supabase } from '../../services/supabase';
import { invokeWithRetry } from '../../utils/edgeFunctionRetry';
import type { Card, GameState, AutoPassTimerState } from '../../types/multiplayer';

describe('useRealtime - Timer Cancellation', () => {
  const mockRoomId = 'test-room-123';
  const mockUserId = 'user-123';
  const mockUsername = 'TestPlayer';

  const mockAutoPassTimer: AutoPassTimerState = {
    active: true,
    started_at: new Date().toISOString(),
    duration_ms: 15000,
    remaining_ms: 12000,
    triggering_play: {
      position: 0,
      cards: [{ id: '2S', suit: 'S', rank: '2' }],
      combo_type: 'Single',
    },
    player_id: 'test-player',
  };

  const mockGameState: GameState = {
    id: 'game-123',
    room_id: mockRoomId,
    current_turn: 0,
    turn_timer: 30,
    last_play: null,
    pass_count: 0,
    game_phase: 'playing',
    winner: null,
    match_number: 1,
    hands: { '0': [{ id: 'AH', suit: 'H', rank: 'A' }] },
    play_history: [],
    scores: [],
    final_scores: null,
    auto_pass_timer: mockAutoPassTimer,
    played_cards: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const mockCard: Card = {
    id: 'AH',
    suit: 'H',
    rank: 'A',
  };

  /**
   * Sets up all Supabase mocks to support the full connectToRoom -> pass/playCards flow.
   */
  function setupTestMocks(opts: {
    gameState?: any;
    mockUpdateFn?: jest.Mock;
    mockBroadcastFn?: jest.Mock;
  } = {}) {
    const {
      gameState = mockGameState,
      mockUpdateFn = jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ error: null }),
      }),
      mockBroadcastFn = jest.fn().mockResolvedValue(undefined),
    } = opts;

    const mockRoom = {
      id: mockRoomId,
      name: 'Test Room',
      max_players: 4,
      code: mockRoomId,
      status: 'playing',
    };

    const mockMembership = { id: 'player-rec-1' };
    const mockPlayersList = [
      {
        id: 'player-rec-1',
        room_id: mockRoomId,
        user_id: mockUserId,
        username: mockUsername,
        player_index: 0,
        is_host: true,
        is_ready: true,
        is_bot: false,
      },
      {
        id: 'player-rec-2',
        room_id: mockRoomId,
        user_id: 'bot-1',
        username: 'Bot 1',
        player_index: 1,
        is_host: false,
        is_ready: true,
        is_bot: true,
      },
      {
        id: 'player-rec-3',
        room_id: mockRoomId,
        user_id: 'bot-2',
        username: 'Bot 2',
        player_index: 2,
        is_host: false,
        is_ready: true,
        is_bot: true,
      },
      {
        id: 'player-rec-4',
        room_id: mockRoomId,
        user_id: 'bot-3',
        username: 'Bot 3',
        player_index: 3,
        is_host: false,
        is_ready: true,
        is_bot: true,
      },
    ];

    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'rooms') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({ data: mockRoom, error: null }),
              }),
              single: jest.fn().mockResolvedValue({ data: mockRoom, error: null }),
            }),
            single: jest.fn().mockResolvedValue({ data: mockRoom, error: null }),
          }),
        };
      }

      if (table === 'room_players') {
        return {
          select: jest.fn().mockImplementation(() => ({
            eq: jest.fn().mockImplementation(() => ({
              eq: jest.fn().mockReturnValue({
                maybeSingle: jest.fn().mockResolvedValue({ data: mockMembership, error: null }),
              }),
              order: jest.fn().mockResolvedValue({ data: mockPlayersList, error: null }),
              maybeSingle: jest.fn().mockResolvedValue({ data: mockMembership, error: null }),
            })),
            order: jest.fn().mockResolvedValue({ data: mockPlayersList, error: null }),
          })),
        };
      }

      if (table === 'game_state') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: gameState, error: null }),
            }),
          }),
          update: mockUpdateFn,
        };
      }

      // Fallback
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null, error: null }),
        update: mockUpdateFn,
      };
    });

    (supabase.channel as jest.Mock).mockReturnValue({
      on: jest.fn().mockReturnThis(),
      subscribe: jest.fn().mockImplementation((cb?: any) => {
        if (typeof cb === 'function') cb('SUBSCRIBED');
        return { unsubscribe: jest.fn() };
      }),
      send: mockBroadcastFn,
      track: jest.fn().mockResolvedValue(undefined),
      unsubscribe: jest.fn(),
    });

    return { mockUpdateFn, mockBroadcastFn };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Default pass response (no timer preserved = timer cleared)
    (invokeWithRetry as jest.Mock).mockResolvedValue({
      data: {
        success: true,
        next_turn: 1,
        passes: 1,
        trick_cleared: false,
      },
      error: null,
    });

    // Ensure removeChannel is available
    (supabase as any).removeChannel = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /**
   * Helper to connect to a room and wait for gameState to load.
   */
  async function connectAndWait(result: any) {
    await act(async () => {
      const promise = result.current.connectToRoom(mockRoomId);
      await jest.advanceTimersByTimeAsync(100);
      await promise;
    });

    await waitFor(
      () => {
        expect(result.current.gameState).toBeTruthy();
      },
      { timeout: 3000 }
    );
  }

  describe('Manual Pass Cancellation', () => {
    it('should clear local auto_pass_timer after passing (Edge Function returns no timer)', async () => {
      const { mockBroadcastFn } = setupTestMocks();

      (invokeWithRetry as jest.Mock).mockResolvedValue({
        data: {
          success: true,
          next_turn: 1,
          passes: 1,
          trick_cleared: false,
        },
        error: null,
      });

      const { result } = renderHook(() =>
        useRealtime({ userId: mockUserId, username: mockUsername })
      );

      await connectAndWait(result);
      expect(result.current.gameState?.auto_pass_timer).toBeTruthy();

      await act(async () => {
        const passPromise = result.current.pass();
        await jest.advanceTimersByTimeAsync(500);
        await passPromise;
      });

      expect(invokeWithRetry).toHaveBeenCalledWith('player-pass', {
        body: {
          room_code: mockRoomId,
          player_id: mockUserId,
        },
      });

      expect(result.current.gameState?.auto_pass_timer).toBeNull();

      expect(mockBroadcastFn).toHaveBeenCalledWith({
        type: 'broadcast',
        event: 'player_passed',
        payload: expect.objectContaining({
          event: 'player_passed',
          data: expect.objectContaining({
            player_index: 0,
          }),
        }),
      });
    });

    it('should NOT clear local auto_pass_timer when Edge Function returns a timer', async () => {
      setupTestMocks();

      (invokeWithRetry as jest.Mock).mockResolvedValue({
        data: {
          success: true,
          next_turn: 1,
          passes: 1,
          trick_cleared: false,
          auto_pass_timer: mockAutoPassTimer,
        },
        error: null,
      });

      const { result } = renderHook(() =>
        useRealtime({ userId: mockUserId, username: mockUsername })
      );

      await connectAndWait(result);

      await act(async () => {
        const passPromise = result.current.pass();
        await jest.advanceTimersByTimeAsync(500);
        await passPromise;
      });

      expect(result.current.gameState?.auto_pass_timer).toBeTruthy();
    });
  });

  describe('Play Cards Cancellation', () => {
    it('should broadcast auto_pass_timer_cancelled when playing cards while timer is active', async () => {
      const mockBroadcastFn = jest.fn().mockResolvedValue(undefined);
      setupTestMocks({ mockBroadcastFn });

      (invokeWithRetry as jest.Mock).mockResolvedValue({
        data: {
          success: true,
          combo_type: 'Single',
          next_turn: 1,
          passes: 0,
          trick_cleared: false,
        },
        error: null,
      });

      const { result } = renderHook(() =>
        useRealtime({ userId: mockUserId, username: mockUsername })
      );

      await connectAndWait(result);
      expect(result.current.gameState?.auto_pass_timer).toBeTruthy();

      await act(async () => {
        const playPromise = result.current.playCards([mockCard]);
        await jest.advanceTimersByTimeAsync(500);
        await playPromise;
      });

      expect(invokeWithRetry).toHaveBeenCalledWith('play-cards', {
        body: {
          room_code: mockRoomId,
          player_id: mockUserId,
          cards: [{ id: 'AH', rank: 'A', suit: 'H' }],
        },
      });

      const cancellationCall = mockBroadcastFn.mock.calls.find(
        (call: any[]) => call[0]?.event === 'auto_pass_timer_cancelled'
      );
      expect(cancellationCall).toBeDefined();
      expect(cancellationCall![0].payload.data.reason).toBe('new_play');
    });

    it('should broadcast correct cancellation reason for new plays', async () => {
      const mockBroadcastFn = jest.fn().mockResolvedValue(undefined);
      setupTestMocks({ mockBroadcastFn });

      (invokeWithRetry as jest.Mock).mockResolvedValue({
        data: {
          success: true,
          combo_type: 'Pair',
          next_turn: 1,
          passes: 0,
          trick_cleared: false,
        },
        error: null,
      });

      const { result } = renderHook(() =>
        useRealtime({ userId: mockUserId, username: mockUsername })
      );

      await connectAndWait(result);

      await act(async () => {
        const playPromise = result.current.playCards([
          mockCard,
          { ...mockCard, id: 'AD', suit: 'D' },
        ]);
        await jest.advanceTimersByTimeAsync(500);
        await playPromise;
      });

      const cancellationCall = mockBroadcastFn.mock.calls.find(
        (call: any[]) => call[0]?.event === 'auto_pass_timer_cancelled'
      );
      expect(cancellationCall).toBeDefined();
      expect(cancellationCall![0].payload.data.reason).toBe('new_play');
    });

    it('should NOT broadcast cancellation if no timer was active when playing', async () => {
      const mockBroadcastFn = jest.fn().mockResolvedValue(undefined);
      setupTestMocks({
        gameState: { ...mockGameState, auto_pass_timer: null },
        mockBroadcastFn,
      });

      (invokeWithRetry as jest.Mock).mockResolvedValue({
        data: {
          success: true,
          combo_type: 'Single',
          next_turn: 1,
          passes: 0,
          trick_cleared: false,
        },
        error: null,
      });

      const { result } = renderHook(() =>
        useRealtime({ userId: mockUserId, username: mockUsername })
      );

      await connectAndWait(result);

      await act(async () => {
        const playPromise = result.current.playCards([mockCard]);
        await jest.advanceTimersByTimeAsync(500);
        await playPromise;
      });

      const cancellationCalls = mockBroadcastFn.mock.calls.filter(
        (call: any[]) => call[0]?.event === 'auto_pass_timer_cancelled'
      );
      expect(cancellationCalls).toHaveLength(0);
    });
  });

  describe('Cancellation Reason Validation', () => {
    it('should use "new_play" reason for play cards action', async () => {
      const mockBroadcastFn = jest.fn().mockResolvedValue(undefined);
      setupTestMocks({ mockBroadcastFn });

      (invokeWithRetry as jest.Mock).mockResolvedValue({
        data: {
          success: true,
          combo_type: 'Single',
          next_turn: 1,
          passes: 0,
          trick_cleared: false,
        },
        error: null,
      });

      const { result } = renderHook(() =>
        useRealtime({ userId: mockUserId, username: mockUsername })
      );

      await connectAndWait(result);

      await act(async () => {
        const playPromise = result.current.playCards([mockCard]);
        await jest.advanceTimersByTimeAsync(500);
        await playPromise;
      });

      const cancellationCall = mockBroadcastFn.mock.calls.find(
        (call: any[]) => call[0]?.event === 'auto_pass_timer_cancelled'
      );
      expect(cancellationCall![0].payload.data.reason).toBe('new_play');
    });

    it('should include player_index in cancellation broadcast', async () => {
      const mockBroadcastFn = jest.fn().mockResolvedValue(undefined);
      setupTestMocks({ mockBroadcastFn });

      (invokeWithRetry as jest.Mock).mockResolvedValue({
        data: {
          success: true,
          combo_type: 'Single',
          next_turn: 1,
          passes: 0,
          trick_cleared: false,
        },
        error: null,
      });

      const { result } = renderHook(() =>
        useRealtime({ userId: mockUserId, username: mockUsername })
      );

      await connectAndWait(result);

      await act(async () => {
        const playPromise = result.current.playCards([mockCard]);
        await jest.advanceTimersByTimeAsync(500);
        await playPromise;
      });

      const cancellationCall = mockBroadcastFn.mock.calls.find(
        (call: any[]) => call[0]?.event === 'auto_pass_timer_cancelled'
      );
      expect(cancellationCall![0].payload.data.player_index).toBe(0);
    });
  });

  describe('Database State Updates', () => {
    it('should update play_history in database when playing cards', async () => {
      const mockUpdateFn = jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ error: null }),
      });
      setupTestMocks({ mockUpdateFn });

      (invokeWithRetry as jest.Mock).mockResolvedValue({
        data: {
          success: true,
          combo_type: 'Single',
          next_turn: 1,
          passes: 0,
          trick_cleared: false,
        },
        error: null,
      });

      const { result } = renderHook(() =>
        useRealtime({ userId: mockUserId, username: mockUsername })
      );

      await connectAndWait(result);

      await act(async () => {
        const playPromise = result.current.playCards([mockCard]);
        await jest.advanceTimersByTimeAsync(500);
        await playPromise;
      });

      expect(mockUpdateFn).toHaveBeenCalledWith(
        expect.objectContaining({
          play_history: expect.arrayContaining([
            expect.objectContaining({
              cards: [mockCard],
              passed: false,
            }),
          ]),
        })
      );
    });

    it('should broadcast cards_played event when playing cards', async () => {
      const mockBroadcastFn = jest.fn().mockResolvedValue(undefined);
      setupTestMocks({ mockBroadcastFn });

      (invokeWithRetry as jest.Mock).mockResolvedValue({
        data: {
          success: true,
          combo_type: 'Single',
          next_turn: 1,
          passes: 0,
          trick_cleared: false,
        },
        error: null,
      });

      const { result } = renderHook(() =>
        useRealtime({ userId: mockUserId, username: mockUsername })
      );

      await connectAndWait(result);

      await act(async () => {
        const playPromise = result.current.playCards([mockCard]);
        await jest.advanceTimersByTimeAsync(500);
        await playPromise;
      });

      expect(mockBroadcastFn).toHaveBeenCalledWith({
        type: 'broadcast',
        event: 'cards_played',
        payload: expect.objectContaining({
          event: 'cards_played',
          data: expect.objectContaining({
            player_index: 0,
            cards: [mockCard],
          }),
        }),
      });
    });

    it('should call player-pass Edge Function when passing', async () => {
      setupTestMocks();

      (invokeWithRetry as jest.Mock).mockResolvedValue({
        data: {
          success: true,
          next_turn: 1,
          passes: 1,
          trick_cleared: false,
        },
        error: null,
      });

      const { result } = renderHook(() =>
        useRealtime({ userId: mockUserId, username: mockUsername })
      );

      await connectAndWait(result);

      await act(async () => {
        const passPromise = result.current.pass();
        await jest.advanceTimersByTimeAsync(500);
        await passPromise;
      });

      expect(invokeWithRetry).toHaveBeenCalledWith('player-pass', {
        body: {
          room_code: mockRoomId,
          player_id: mockUserId,
        },
      });
    });
  });
});
