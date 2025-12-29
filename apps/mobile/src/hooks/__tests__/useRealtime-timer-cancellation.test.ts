/**
 * @file useRealtime-timer-cancellation.test.ts
 * @description Integration tests for auto-pass timer cancellation behavior
 * Tests ensure timers are properly canceled when players pass or play cards
 */

// Mock Supabase BEFORE imports
jest.mock('../../services/supabase');

import { renderHook, act, waitFor } from '@testing-library/react-native';
import { useRealtime } from '../useRealtime';
import { supabase } from '../../services/supabase';
import type { Card, GameState, Player, AutoPassTimerState } from '../../types/multiplayer';

// Mock network logger
jest.mock('../../utils/logger', () => ({
  networkLogger: {
    logRealtimeEvent: jest.fn(),
    logRealtimeError: jest.fn(),
  },
}));

describe.skip('useRealtime - Timer Cancellation', () => {
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
    current_turn: 1,
    turn_timer: 30,
    last_play: null,
    pass_count: 0,
    game_phase: 'playing',
    winner: null,
    match_number: 1,
    hands: {},
    play_history: [],
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

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup comprehensive Supabase mocks for joinRoom
    const mockRoom = {
      id: mockRoomId,
      name: 'Test Room',
      max_players: 4,
    };
    
    const mockPlayers: any[] = [];
    
    // Mock for different table queries
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      const mockChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        single: jest.fn().mockImplementation(() => {
          if (table === 'rooms') {
            return Promise.resolve({ data: mockRoom, error: null });
          }
          if (table === 'game_state') {
            return Promise.resolve({ data: mockGameState, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        }),
        insert: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
      };
      
      // For players query (returns array)
      if (table === 'players') {
        mockChain.select = jest.fn().mockReturnValue({
          ...mockChain,
          eq: jest.fn().mockReturnValue({
            ...mockChain,
            order: jest.fn().mockResolvedValue({ data: mockPlayers, error: null }),
          }),
        });
      }
      
      return mockChain;
    });
  });

  describe('Manual Pass Cancellation', () => {
    it('should cancel active timer when player passes', async () => {
      const mockUpdateFn = jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ error: null }),
      });
      const mockBroadcastFn = jest.fn().mockResolvedValue(undefined);

      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockGameState, error: null }),
        update: mockUpdateFn,
      });

      (supabase.channel as jest.Mock).mockReturnValue({
        on: jest.fn().mockReturnThis(),
        subscribe: jest.fn(),
        send: mockBroadcastFn,
        unsubscribe: jest.fn(),
      });

      const { result } = renderHook(() =>
        useRealtime({
          userId: mockUserId,
          username: mockUsername,
        })
      );

      // Join room first
      await act(async () => {
        await result.current.joinRoom(mockRoomId);
      });

      // Wait for initial state
      await waitFor(() => {
        expect(result.current.gameState).toBeTruthy();
      }, { timeout: 3000 });

      // Execute pass action
      await act(async () => {
        await result.current.pass();
      });

      // Verify timer was cleared in database
      expect(mockUpdateFn).toHaveBeenCalledWith(
        expect.objectContaining({
          auto_pass_timer: null,
        })
      );

      // Verify cancellation event was broadcast
      expect(mockBroadcastFn).toHaveBeenCalledWith({
        type: 'broadcast',
        event: 'auto_pass_timer_cancelled',
        payload: expect.objectContaining({
          reason: 'manual_pass',
        }),
      });
    });

    it('should NOT broadcast cancellation if no timer was active', async () => {
      const mockUpdateFn = jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ error: null }),
      });
      const mockBroadcastFn = jest.fn().mockResolvedValue(undefined);

      const gameStateNoTimer = {
        ...mockGameState,
        auto_pass_timer: null,
      };

      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: gameStateNoTimer, error: null }),
        update: mockUpdateFn,
      });

      (supabase.channel as jest.Mock).mockReturnValue({
        on: jest.fn().mockReturnThis(),
        subscribe: jest.fn(),
        send: mockBroadcastFn,
        unsubscribe: jest.fn(),
      });

      const { result } = renderHook(() =>
        useRealtime({
          userId: mockUserId,
          username: mockUsername,
        })
      );

      // Join room first
      await act(async () => {
        await result.current.joinRoom(mockRoomId);
      });

      await waitFor(() => {
        expect(result.current.gameState).toBeTruthy();
      }, { timeout: 3000 });

      await act(async () => {
        await result.current.pass();
      });

      // Verify database was updated
      expect(mockUpdateFn).toHaveBeenCalled();

      // Verify NO cancellation event was broadcast
      const cancellationCalls = mockBroadcastFn.mock.calls.filter(
        (call) => call[0]?.event === 'auto_pass_timer_cancelled'
      );
      expect(cancellationCalls).toHaveLength(0);
    });
  });

  describe('Play Cards Cancellation', () => {
    it('should cancel active timer when player plays cards', async () => {
      const mockUpdateFn = jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ error: null }),
      });
      const mockBroadcastFn = jest.fn().mockResolvedValue(undefined);

      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockGameState, error: null }),
        update: mockUpdateFn,
      });

      (supabase.channel as jest.Mock).mockReturnValue({
        on: jest.fn().mockReturnThis(),
        subscribe: jest.fn(),
        send: mockBroadcastFn,
        unsubscribe: jest.fn(),
      });

      const { result } = renderHook(() =>
        useRealtime({
          userId: mockUserId,
          username: mockUsername,
        })
      );

      // Join room first
      await act(async () => {
        await result.current.joinRoom(mockRoomId);
      });

      await waitFor(() => {
        expect(result.current.gameState).toBeTruthy();
      }, { timeout: 3000 });

      // Play a single card
      await act(async () => {
        await result.current.playCards([mockCard]);
      });

      // Verify timer was cleared in database
      expect(mockUpdateFn).toHaveBeenCalledWith(
        expect.objectContaining({
          auto_pass_timer: null,
        })
      );

      // Verify cancellation event was broadcast with 'new_play' reason
      expect(mockBroadcastFn).toHaveBeenCalledWith({
        type: 'broadcast',
        event: 'auto_pass_timer_cancelled',
        payload: expect.objectContaining({
          reason: 'new_play',
        }),
      });
    });

    it('should broadcast correct cancellation reason for new plays', async () => {
      const mockUpdateFn = jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ error: null }),
      });
      const mockBroadcastFn = jest.fn().mockResolvedValue(undefined);

      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockGameState, error: null }),
        update: mockUpdateFn,
      });

      (supabase.channel as jest.Mock).mockReturnValue({
        on: jest.fn().mockReturnThis(),
        subscribe: jest.fn(),
        send: mockBroadcastFn,
        unsubscribe: jest.fn(),
      });

      const { result } = renderHook(() =>
        useRealtime({
          userId: mockUserId,
          username: mockUsername,
        })
      );

      // Join room first
      await act(async () => {
        await result.current.joinRoom(mockRoomId);
      });

      await waitFor(() => {
        expect(result.current.gameState).toBeTruthy();
      }, { timeout: 3000 });

      // Play a pair
      await act(async () => {
        await result.current.playCards([mockCard, { ...mockCard, id: 'AD', suit: 'D' }]);
      });

      // Find the cancellation broadcast call
      const cancellationCall = mockBroadcastFn.mock.calls.find(
        (call) => call[0]?.event === 'auto_pass_timer_cancelled'
      );

      expect(cancellationCall).toBeDefined();
      expect(cancellationCall![0].payload.reason).toBe('new_play');
    });

    it('should NOT broadcast cancellation if no timer was active when playing', async () => {
      const mockUpdateFn = jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ error: null }),
      });
      const mockBroadcastFn = jest.fn().mockResolvedValue(undefined);

      const gameStateNoTimer = {
        ...mockGameState,
        auto_pass_timer: null,
      };

      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: gameStateNoTimer, error: null }),
        update: mockUpdateFn,
      });

      (supabase.channel as jest.Mock).mockReturnValue({
        on: jest.fn().mockReturnThis(),
        subscribe: jest.fn(),
        send: mockBroadcastFn,
        unsubscribe: jest.fn(),
      });

      const { result } = renderHook(() =>
        useRealtime({
          userId: mockUserId,
          username: mockUsername,
        })
      );

      // Join room first
      await act(async () => {
        await result.current.joinRoom(mockRoomId);
      });

      await waitFor(() => {
        expect(result.current.gameState).toBeTruthy();
      }, { timeout: 3000 });

      await act(async () => {
        await result.current.playCards([mockCard]);
      });

      // Verify database was updated
      expect(mockUpdateFn).toHaveBeenCalled();

      // Verify NO cancellation event was broadcast
      const cancellationCalls = mockBroadcastFn.mock.calls.filter(
        (call) => call[0]?.event === 'auto_pass_timer_cancelled'
      );
      expect(cancellationCalls).toHaveLength(0);
    });
  });

  describe('Cancellation Reason Validation', () => {
    it('should use "manual_pass" reason for pass action', async () => {
      const mockBroadcastFn = jest.fn().mockResolvedValue(undefined);

      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockGameState, error: null }),
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ error: null }),
        }),
      });

      (supabase.channel as jest.Mock).mockReturnValue({
        on: jest.fn().mockReturnThis(),
        subscribe: jest.fn(),
        send: mockBroadcastFn,
        unsubscribe: jest.fn(),
      });

      const { result } = renderHook(() =>
        useRealtime({
          userId: mockUserId,
          username: mockUsername,
        })
      );

      // Join room first
      await act(async () => {
        await result.current.joinRoom(mockRoomId);
      });

      await waitFor(() => {
        expect(result.current.gameState).toBeTruthy();
      }, { timeout: 3000 });

      await act(async () => {
        await result.current.pass();
      });

      const cancellationCall = mockBroadcastFn.mock.calls.find(
        (call) => call[0]?.event === 'auto_pass_timer_cancelled'
      );

      expect(cancellationCall![0].payload.reason).toBe('manual_pass');
    });

    it('should use "new_play" reason for play cards action', async () => {
      const mockBroadcastFn = jest.fn().mockResolvedValue(undefined);

      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockGameState, error: null }),
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ error: null }),
        }),
      });

      (supabase.channel as jest.Mock).mockReturnValue({
        on: jest.fn().mockReturnThis(),
        subscribe: jest.fn(),
        send: mockBroadcastFn,
        unsubscribe: jest.fn(),
      });

      const { result } = renderHook(() =>
        useRealtime({
          userId: mockUserId,
          username: mockUsername,
        })
      );

      // Join room first
      await act(async () => {
        await result.current.joinRoom(mockRoomId);
      });

      await waitFor(() => {
        expect(result.current.gameState).toBeTruthy();
      }, { timeout: 3000 });

      await act(async () => {
        await result.current.playCards([mockCard]);
      });

      const cancellationCall = mockBroadcastFn.mock.calls.find(
        (call) => call[0]?.event === 'auto_pass_timer_cancelled'
      );

      expect(cancellationCall![0].payload.reason).toBe('new_play');
    });
  });

  describe('Database State Updates', () => {
    it('should set auto_pass_timer to null when passing', async () => {
      const mockUpdateFn = jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ error: null }),
      });

      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockGameState, error: null }),
        update: mockUpdateFn,
      });

      (supabase.channel as jest.Mock).mockReturnValue({
        on: jest.fn().mockReturnThis(),
        subscribe: jest.fn(),
        send: jest.fn().mockResolvedValue(undefined),
        unsubscribe: jest.fn(),
      });

      const { result } = renderHook(() =>
        useRealtime({
          userId: mockUserId,
          username: mockUsername,
        })
      );

      // Join room first
      await act(async () => {
        await result.current.joinRoom(mockRoomId);
      });

      await waitFor(() => {
        expect(result.current.gameState).toBeTruthy();
      }, { timeout: 3000 });

      await act(async () => {
        await result.current.pass();
      });

      expect(mockUpdateFn).toHaveBeenCalledWith(
        expect.objectContaining({
          auto_pass_timer: null,
        })
      );
    });

    it('should set auto_pass_timer to null when playing cards', async () => {
      const mockUpdateFn = jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ error: null }),
      });

      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockGameState, error: null }),
        update: mockUpdateFn,
      });

      (supabase.channel as jest.Mock).mockReturnValue({
        on: jest.fn().mockReturnThis(),
        subscribe: jest.fn(),
        send: jest.fn().mockResolvedValue(undefined),
        unsubscribe: jest.fn(),
      });

      const { result } = renderHook(() =>
        useRealtime({
          userId: mockUserId,
          username: mockUsername,
        })
      );

      // Join room first
      await act(async () => {
        await result.current.joinRoom(mockRoomId);
      });

      await waitFor(() => {
        expect(result.current.gameState).toBeTruthy();
      }, { timeout: 3000 });

      await act(async () => {
        await result.current.playCards([mockCard]);
      });

      expect(mockUpdateFn).toHaveBeenCalledWith(
        expect.objectContaining({
          auto_pass_timer: null,
        })
      );
    });
  });
});
