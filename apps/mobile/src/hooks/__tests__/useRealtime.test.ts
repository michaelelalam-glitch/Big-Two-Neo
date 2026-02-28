/**
 * Tests for useRealtime hook - core functionality
 *
 * Architecture note (Dec 2025):
 * - Game actions (playCards, pass) now use Edge Functions via invokeWithRetry
 * - Game state is managed server-side; client does optimistic local updates
 * - Combo type determination moved to server (play-cards Edge Function)
 * - Timer cancellation tests are in useRealtime-timer-cancellation.test.ts
 */

// Mock Supabase BEFORE imports
jest.mock('../../services/supabase');

// Mock Edge Function calls
jest.mock('../../utils/edgeFunctionRetry', () => ({
  invokeWithRetry: jest.fn().mockResolvedValue({
    data: { success: true },
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

describe('useRealtime', () => {
  const mockUserId = 'user-123';
  const mockUsername = 'TestUser';
  const mockOptions = {
    userId: mockUserId,
    username: mockUsername,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (supabase.removeChannel as jest.Mock) = jest.fn();
  });

  describe('Initial State', () => {
    it('should start disconnected', () => {
      const { result } = renderHook(() => useRealtime(mockOptions));
      expect(result.current.isConnected).toBe(false);
    });

    it('should have no error initially', () => {
      const { result } = renderHook(() => useRealtime(mockOptions));
      expect(result.current.error).toBeNull();
    });

    it('should have no room initially', () => {
      const { result } = renderHook(() => useRealtime(mockOptions));
      expect(result.current.room).toBeNull();
    });

    it('should have no game state initially', () => {
      const { result } = renderHook(() => useRealtime(mockOptions));
      expect(result.current.gameState).toBeNull();
    });

    it('should not be loading initially', () => {
      const { result } = renderHook(() => useRealtime(mockOptions));
      expect(result.current.loading).toBe(false);
    });
  });

  describe('Room Management', () => {
    it('should create a room', async () => {
      const mockRoom = {
        id: 'room-123',
        code: 'ABCD12',
        host_id: mockUserId,
        status: 'waiting',
        max_players: 4,
      };

      // createRoom: from('rooms').insert({...}).select().single()
      (supabase.from as jest.Mock).mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: mockRoom,
              error: null,
            }),
          }),
        }),
      });

      (supabase.channel as jest.Mock).mockReturnValue({
        on: jest.fn().mockReturnThis(),
        subscribe: jest.fn().mockImplementation((cb?: any) => {
          if (typeof cb === 'function') cb('SUBSCRIBED');
          return { unsubscribe: jest.fn() };
        }),
        send: jest.fn().mockResolvedValue(undefined),
        track: jest.fn().mockResolvedValue(undefined),
        unsubscribe: jest.fn(),
      });

      const { result } = renderHook(() => useRealtime(mockOptions));

      await act(async () => {
        const room = await result.current.createRoom();
        expect(room).toEqual(mockRoom);
      });

      expect(result.current.room).toEqual(mockRoom);
    });
  });

  describe('Error Handling', () => {
    it('should accept onError callback', () => {
      const onError = jest.fn();
      const { result } = renderHook(() =>
        useRealtime({ ...mockOptions, onError })
      );
      expect(result.current.error).toBeNull();
    });

    it('should accept onDisconnect callback', () => {
      const onDisconnect = jest.fn();
      const { result } = renderHook(() =>
        useRealtime({ ...mockOptions, onDisconnect })
      );
      expect(result.current.isConnected).toBe(false);
    });
  });

  describe('Hook Return API', () => {
    it('should expose all expected functions', () => {
      const { result } = renderHook(() => useRealtime(mockOptions));

      expect(typeof result.current.createRoom).toBe('function');
      expect(typeof result.current.joinRoom).toBe('function');
      expect(typeof result.current.connectToRoom).toBe('function');
      expect(typeof result.current.leaveRoom).toBe('function');
      expect(typeof result.current.setReady).toBe('function');
      expect(typeof result.current.startGame).toBe('function');
      expect(typeof result.current.playCards).toBe('function');
      expect(typeof result.current.pass).toBe('function');
    });

    it('should expose all expected state values', () => {
      const { result } = renderHook(() => useRealtime(mockOptions));

      expect(result.current).toHaveProperty('room');
      expect(result.current).toHaveProperty('gameState');
      expect(result.current).toHaveProperty('isConnected');
      expect(result.current).toHaveProperty('loading');
      expect(result.current).toHaveProperty('error');
      expect(result.current).toHaveProperty('players');
      expect(result.current).toHaveProperty('currentPlayer');
      expect(result.current).toHaveProperty('isHost');
    });
  });

  describe('Turn Validation', () => {
    it('should throw when passing without game state', async () => {
      const { result } = renderHook(() => useRealtime(mockOptions));

      // gameState is null — pass should throw
      await expect(
        act(async () => {
          await result.current.pass();
        })
      ).rejects.toThrow('Game state not loaded');
    });

    it('should throw when playing cards without game state', async () => {
      const { result } = renderHook(() => useRealtime(mockOptions));

      await expect(
        act(async () => {
          await result.current.playCards([{ id: 'AH', suit: 'H', rank: 'A' }]);
        })
      ).rejects.toThrow();
    });
  });
});
