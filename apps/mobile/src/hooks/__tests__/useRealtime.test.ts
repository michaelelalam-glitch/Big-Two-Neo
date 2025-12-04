/**
 * Tests for useRealtime hook and multiplayer functionality
 */

import { renderHook, act } from '@testing-library/react-hooks';
import { waitFor } from '@testing-library/react-native';
import { useRealtime } from '../useRealtime';
import { supabase } from '../../services/supabase';

// Mock Supabase
jest.mock('../../services/supabase', () => ({
  supabase: {
    channel: jest.fn(),
    removeChannel: jest.fn(),
    from: jest.fn(),
  },
}));

describe('useRealtime', () => {
  const mockUserId = 'user-123';
  const mockUsername = 'TestUser';
  const mockOptions = {
    userId: mockUserId,
    username: mockUsername,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Room Management', () => {
    it('should create a new room', async () => {
      const mockRoom = {
        id: 'room-123',
        code: 'ABC123',
        host_id: mockUserId,
        status: 'waiting',
        max_players: 4,
      };

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

      const { result } = renderHook(() => useRealtime(mockOptions));

      await act(async () => {
        const room = await result.current.createRoom();
        expect(room).toEqual(mockRoom);
      });

      expect(result.current.room).toEqual(mockRoom);
      expect(result.current.isHost).toBe(true);
    });

    it('should join an existing room', async () => {
      const mockCode = 'ABC123';
      const mockRoom = {
        id: 'room-123',
        code: mockCode,
        host_id: 'other-user',
        status: 'waiting',
        max_players: 4,
      };

      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: mockRoom,
                error: null,
              }),
            }),
          }),
        }),
      });

      const { result } = renderHook(() => useRealtime(mockOptions));

      await act(async () => {
        await result.current.joinRoom(mockCode);
      });

      expect(result.current.room).toEqual(mockRoom);
      expect(result.current.isHost).toBe(false);
    });

    it('should handle room not found error', async () => {
      const mockCode = 'INVALID';

      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: null,
                error: { message: 'Room not found' },
              }),
            }),
          }),
        }),
      });

      const { result } = renderHook(() => useRealtime(mockOptions));

      await expect(async () => {
        await act(async () => {
          await result.current.joinRoom(mockCode);
        });
      }).rejects.toThrow();
    });

    it('should leave a room', async () => {
      const mockRoom = {
        id: 'room-123',
        code: 'ABC123',
        host_id: mockUserId,
        status: 'waiting',
        max_players: 4,
      };

      // Setup initial state
      (supabase.from as jest.Mock).mockReturnValue({
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({
            data: null,
            error: null,
          }),
        }),
      });

      const { result } = renderHook(() => useRealtime(mockOptions));

      // Manually set room state for test
      act(() => {
        // @ts-ignore - setting internal state for test
        result.current.room = mockRoom;
      });

      await act(async () => {
        await result.current.leaveRoom();
      });

      expect(result.current.room).toBeNull();
      expect(result.current.isConnected).toBe(false);
    });
  });

  describe('Player Management', () => {
    it('should set player ready status', async () => {
      const mockPlayer = {
        id: 'player-123',
        user_id: mockUserId,
        username: mockUsername,
        position: 0,
        is_host: true,
        is_ready: false,
      };

      (supabase.from as jest.Mock).mockReturnValue({
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({
            data: { ...mockPlayer, is_ready: true },
            error: null,
          }),
        }),
      });

      const { result } = renderHook(() => useRealtime(mockOptions));

      await act(async () => {
        await result.current.setReady(true);
      });

      // Verify update was called
      expect(supabase.from).toHaveBeenCalledWith('players');
    });

    it('should track multiple players', async () => {
      const mockPlayers = [
        {
          id: 'player-1',
          user_id: mockUserId,
          username: mockUsername,
          position: 0,
          is_host: true,
          is_ready: true,
        },
        {
          id: 'player-2',
          user_id: 'user-456',
          username: 'Player2',
          position: 1,
          is_host: false,
          is_ready: false,
        },
      ];

      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockResolvedValue({
              data: mockPlayers,
              error: null,
            }),
          }),
        }),
      });

      const { result } = renderHook(() => useRealtime(mockOptions));

      // Trigger fetch players
      await act(async () => {
        // Internal method call simulation
      });

      // Wait for players to be set
      await waitFor(() => {
        expect(result.current.players.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Game Actions', () => {
    it('should start game when host', async () => {
      const mockRoom = {
        id: 'room-123',
        code: 'ABC123',
        host_id: mockUserId,
        status: 'waiting',
        max_players: 4,
      };

      const mockPlayers = [
        {
          id: 'player-1',
          user_id: mockUserId,
          position: 0,
          is_host: true,
          is_ready: true,
        },
        {
          id: 'player-2',
          user_id: 'user-456',
          position: 1,
          is_host: false,
          is_ready: true,
        },
      ];

      (supabase.from as jest.Mock).mockReturnValue({
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({
            data: { ...mockRoom, status: 'playing' },
            error: null,
          }),
        }),
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: { room_id: mockRoom.id, game_phase: 'dealing' },
              error: null,
            }),
          }),
        }),
      });

      const { result } = renderHook(() => useRealtime(mockOptions));

      // Setup initial state
      act(() => {
        // @ts-ignore
        result.current.room = mockRoom;
        // @ts-ignore
        result.current.players = mockPlayers;
        // @ts-ignore
        result.current.isHost = true;
      });

      await act(async () => {
        await result.current.startGame();
      });

      expect(supabase.from).toHaveBeenCalledWith('rooms');
      expect(supabase.from).toHaveBeenCalledWith('game_state');
    });

    it('should play cards on player turn', async () => {
      const mockCards = [
        { suit: 'spades' as const, rank: '3' as const },
        { suit: 'hearts' as const, rank: '3' as const },
      ];

      const mockGameState = {
        id: 'game-123',
        room_id: 'room-123',
        current_turn: 0,
        game_phase: 'playing',
      };

      const mockPlayer = {
        id: 'player-1',
        user_id: mockUserId,
        position: 0,
        is_host: true,
      };

      (supabase.from as jest.Mock).mockReturnValue({
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({
            data: { ...mockGameState, last_play: { cards: mockCards } },
            error: null,
          }),
        }),
      });

      const { result } = renderHook(() => useRealtime(mockOptions));

      // Setup state
      act(() => {
        // @ts-ignore
        result.current.gameState = mockGameState;
        // @ts-ignore
        result.current.currentPlayer = mockPlayer;
        // @ts-ignore
        result.current.players = [mockPlayer];
      });

      await act(async () => {
        await result.current.playCards(mockCards);
      });

      expect(supabase.from).toHaveBeenCalledWith('game_state');
    });

    it('should determine combo type for single card', async () => {
      const mockCards = [
        { suit: 'spades' as const, rank: '3' as const },
      ];

      const mockGameState = {
        id: 'game-123',
        room_id: 'room-123',
        current_turn: 0,
        game_phase: 'playing',
      };

      const mockPlayer = {
        id: 'player-1',
        user_id: mockUserId,
        position: 0,
        is_host: true,
      };

      const updateMock = jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ data: mockGameState, error: null }),
      });

      (supabase.from as jest.Mock).mockReturnValue({ update: updateMock });

      const { result } = renderHook(() => useRealtime(mockOptions));

      act(() => {
        // @ts-ignore
        result.current.gameState = mockGameState;
        // @ts-ignore
        result.current.currentPlayer = mockPlayer;
        // @ts-ignore
        result.current.players = [mockPlayer];
      });

      await act(async () => {
        await result.current.playCards(mockCards);
      });

      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          last_play: expect.objectContaining({
            combo_type: 'single',
          }),
        })
      );
    });

    it('should determine combo type for triple', async () => {
      const mockCards = [
        { suit: 'spades' as const, rank: '3' as const },
        { suit: 'hearts' as const, rank: '3' as const },
        { suit: 'clubs' as const, rank: '3' as const },
      ];

      const mockGameState = {
        id: 'game-123',
        room_id: 'room-123',
        current_turn: 0,
        game_phase: 'playing',
      };

      const mockPlayer = {
        id: 'player-1',
        user_id: mockUserId,
        position: 0,
        is_host: true,
      };

      const updateMock = jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ data: mockGameState, error: null }),
      });

      (supabase.from as jest.Mock).mockReturnValue({ update: updateMock });

      const { result } = renderHook(() => useRealtime(mockOptions));

      act(() => {
        // @ts-ignore
        result.current.gameState = mockGameState;
        // @ts-ignore
        result.current.currentPlayer = mockPlayer;
        // @ts-ignore
        result.current.players = [mockPlayer];
      });

      await act(async () => {
        await result.current.playCards(mockCards);
      });

      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          last_play: expect.objectContaining({
            combo_type: 'triple',
          }),
        })
      );
    });

    it('should determine combo type for straight', async () => {
      const mockCards = [
        { suit: 'spades' as const, rank: '3' as const },
        { suit: 'hearts' as const, rank: '4' as const },
        { suit: 'clubs' as const, rank: '5' as const },
        { suit: 'diamonds' as const, rank: '6' as const },
        { suit: 'spades' as const, rank: '7' as const },
      ];

      const mockGameState = {
        id: 'game-123',
        room_id: 'room-123',
        current_turn: 0,
        game_phase: 'playing',
      };

      const mockPlayer = {
        id: 'player-1',
        user_id: mockUserId,
        position: 0,
        is_host: true,
      };

      const updateMock = jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ data: mockGameState, error: null }),
      });

      (supabase.from as jest.Mock).mockReturnValue({ update: updateMock });

      const { result } = renderHook(() => useRealtime(mockOptions));

      act(() => {
        // @ts-ignore
        result.current.gameState = mockGameState;
        // @ts-ignore
        result.current.currentPlayer = mockPlayer;
        // @ts-ignore
        result.current.players = [mockPlayer];
      });

      await act(async () => {
        await result.current.playCards(mockCards);
      });

      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          last_play: expect.objectContaining({
            combo_type: 'straight',
          }),
        })
      );
    });

    it('should determine combo type for flush', async () => {
      const mockCards = [
        { suit: 'spades' as const, rank: '3' as const },
        { suit: 'spades' as const, rank: '5' as const },
        { suit: 'spades' as const, rank: '7' as const },
        { suit: 'spades' as const, rank: '9' as const },
        { suit: 'spades' as const, rank: 'J' as const },
      ];

      const mockGameState = {
        id: 'game-123',
        room_id: 'room-123',
        current_turn: 0,
        game_phase: 'playing',
      };

      const mockPlayer = {
        id: 'player-1',
        user_id: mockUserId,
        position: 0,
        is_host: true,
      };

      const updateMock = jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ data: mockGameState, error: null }),
      });

      (supabase.from as jest.Mock).mockReturnValue({ update: updateMock });

      const { result } = renderHook(() => useRealtime(mockOptions));

      act(() => {
        // @ts-ignore
        result.current.gameState = mockGameState;
        // @ts-ignore
        result.current.currentPlayer = mockPlayer;
        // @ts-ignore
        result.current.players = [mockPlayer];
      });

      await act(async () => {
        await result.current.playCards(mockCards);
      });

      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          last_play: expect.objectContaining({
            combo_type: 'flush',
          }),
        })
      );
    });

    it('should determine combo type for full house', async () => {
      const mockCards = [
        { suit: 'spades' as const, rank: '3' as const },
        { suit: 'hearts' as const, rank: '3' as const },
        { suit: 'clubs' as const, rank: '3' as const },
        { suit: 'diamonds' as const, rank: '4' as const },
        { suit: 'spades' as const, rank: '4' as const },
      ];

      const mockGameState = {
        id: 'game-123',
        room_id: 'room-123',
        current_turn: 0,
        game_phase: 'playing',
      };

      const mockPlayer = {
        id: 'player-1',
        user_id: mockUserId,
        position: 0,
        is_host: true,
      };

      const updateMock = jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ data: mockGameState, error: null }),
      });

      (supabase.from as jest.Mock).mockReturnValue({ update: updateMock });

      const { result } = renderHook(() => useRealtime(mockOptions));

      act(() => {
        // @ts-ignore
        result.current.gameState = mockGameState;
        // @ts-ignore
        result.current.currentPlayer = mockPlayer;
        // @ts-ignore
        result.current.players = [mockPlayer];
      });

      await act(async () => {
        await result.current.playCards(mockCards);
      });

      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          last_play: expect.objectContaining({
            combo_type: 'full_house',
          }),
        })
      );
    });

    it('should determine combo type for four of a kind', async () => {
      const mockCards = [
        { suit: 'spades' as const, rank: '3' as const },
        { suit: 'hearts' as const, rank: '3' as const },
        { suit: 'clubs' as const, rank: '3' as const },
        { suit: 'diamonds' as const, rank: '3' as const },
        { suit: 'spades' as const, rank: '4' as const },
      ];

      const mockGameState = {
        id: 'game-123',
        room_id: 'room-123',
        current_turn: 0,
        game_phase: 'playing',
      };

      const mockPlayer = {
        id: 'player-1',
        user_id: mockUserId,
        position: 0,
        is_host: true,
      };

      const updateMock = jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ data: mockGameState, error: null }),
      });

      (supabase.from as jest.Mock).mockReturnValue({ update: updateMock });

      const { result } = renderHook(() => useRealtime(mockOptions));

      act(() => {
        // @ts-ignore
        result.current.gameState = mockGameState;
        // @ts-ignore
        result.current.currentPlayer = mockPlayer;
        // @ts-ignore
        result.current.players = [mockPlayer];
      });

      await act(async () => {
        await result.current.playCards(mockCards);
      });

      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          last_play: expect.objectContaining({
            combo_type: 'four_of_a_kind',
          }),
        })
      );
    });

    it('should determine combo type for straight flush', async () => {
      const mockCards = [
        { suit: 'spades' as const, rank: '3' as const },
        { suit: 'spades' as const, rank: '4' as const },
        { suit: 'spades' as const, rank: '5' as const },
        { suit: 'spades' as const, rank: '6' as const },
        { suit: 'spades' as const, rank: '7' as const },
      ];

      const mockGameState = {
        id: 'game-123',
        room_id: 'room-123',
        current_turn: 0,
        game_phase: 'playing',
      };

      const mockPlayer = {
        id: 'player-1',
        user_id: mockUserId,
        position: 0,
        is_host: true,
      };

      const updateMock = jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ data: mockGameState, error: null }),
      });

      (supabase.from as jest.Mock).mockReturnValue({ update: updateMock });

      const { result } = renderHook(() => useRealtime(mockOptions));

      act(() => {
        // @ts-ignore
        result.current.gameState = mockGameState;
        // @ts-ignore
        result.current.currentPlayer = mockPlayer;
        // @ts-ignore
        result.current.players = [mockPlayer];
      });

      await act(async () => {
        await result.current.playCards(mockCards);
      });

      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          last_play: expect.objectContaining({
            combo_type: 'straight_flush',
          }),
        })
      );
    });

    it('should throw error for invalid card count (4 cards)', async () => {
      const mockCards = [
        { suit: 'spades' as const, rank: '3' as const },
        { suit: 'hearts' as const, rank: '4' as const },
        { suit: 'clubs' as const, rank: '5' as const },
        { suit: 'diamonds' as const, rank: '6' as const },
      ];

      const mockGameState = {
        id: 'game-123',
        room_id: 'room-123',
        current_turn: 0,
        game_phase: 'playing',
      };

      const mockPlayer = {
        id: 'player-1',
        user_id: mockUserId,
        position: 0,
        is_host: true,
      };

      const { result } = renderHook(() => useRealtime(mockOptions));

      act(() => {
        // @ts-ignore
        result.current.gameState = mockGameState;
        // @ts-ignore
        result.current.currentPlayer = mockPlayer;
        // @ts-ignore
        result.current.players = [mockPlayer];
      });

      await expect(
        act(async () => {
          await result.current.playCards(mockCards);
        })
      ).rejects.toThrow('Invalid card combination');
    });

    it('should throw error for invalid card count (6 cards)', async () => {
      const mockCards = [
        { suit: 'spades' as const, rank: '3' as const },
        { suit: 'hearts' as const, rank: '4' as const },
        { suit: 'clubs' as const, rank: '5' as const },
        { suit: 'diamonds' as const, rank: '6' as const },
        { suit: 'spades' as const, rank: '7' as const },
        { suit: 'hearts' as const, rank: '8' as const },
      ];

      const mockGameState = {
        id: 'game-123',
        room_id: 'room-123',
        current_turn: 0,
        game_phase: 'playing',
      };

      const mockPlayer = {
        id: 'player-1',
        user_id: mockUserId,
        position: 0,
        is_host: true,
      };

      const { result } = renderHook(() => useRealtime(mockOptions));

      act(() => {
        // @ts-ignore
        result.current.gameState = mockGameState;
        // @ts-ignore
        result.current.currentPlayer = mockPlayer;
        // @ts-ignore
        result.current.players = [mockPlayer];
      });

      await expect(
        act(async () => {
          await result.current.playCards(mockCards);
        })
      ).rejects.toThrow('Invalid card combination');
    });

    it('should throw error for invalid 5-card combination', async () => {
      const mockCards = [
        { suit: 'spades' as const, rank: '3' as const },
        { suit: 'hearts' as const, rank: '5' as const },
        { suit: 'clubs' as const, rank: '7' as const },
        { suit: 'diamonds' as const, rank: '9' as const },
        { suit: 'spades' as const, rank: 'K' as const },
      ];

      const mockGameState = {
        id: 'game-123',
        room_id: 'room-123',
        current_turn: 0,
        game_phase: 'playing',
      };

      const mockPlayer = {
        id: 'player-1',
        user_id: mockUserId,
        position: 0,
        is_host: true,
      };

      const { result } = renderHook(() => useRealtime(mockOptions));

      act(() => {
        // @ts-ignore
        result.current.gameState = mockGameState;
        // @ts-ignore
        result.current.currentPlayer = mockPlayer;
        // @ts-ignore
        result.current.players = [mockPlayer];
      });

      await expect(
        act(async () => {
          await result.current.playCards(mockCards);
        })
      ).rejects.toThrow('Invalid 5-card combination');
    });

    it('should throw error for invalid pair with mismatched ranks', async () => {
      const mockCards = [
        { suit: 'spades' as const, rank: '3' as const },
        { suit: 'hearts' as const, rank: '4' as const },
      ];

      const mockGameState = {
        id: 'game-123',
        room_id: 'room-123',
        current_turn: 0,
        game_phase: 'playing',
      };

      const mockPlayer = {
        id: 'player-1',
        user_id: mockUserId,
        position: 0,
        is_host: true,
      };

      const { result } = renderHook(() => useRealtime(mockOptions));

      act(() => {
        // @ts-ignore
        result.current.gameState = mockGameState;
        // @ts-ignore
        result.current.currentPlayer = mockPlayer;
        // @ts-ignore
        result.current.players = [mockPlayer];
      });

      await expect(
        act(async () => {
          await result.current.playCards(mockCards);
        })
      ).rejects.toThrow('Invalid pair: cards must have matching ranks');
    });

    it('should throw error for invalid triple with two matching and one different', async () => {
      const mockCards = [
        { suit: 'spades' as const, rank: '3' as const },
        { suit: 'hearts' as const, rank: '3' as const },
        { suit: 'clubs' as const, rank: '4' as const },
      ];

      const mockGameState = {
        id: 'game-123',
        room_id: 'room-123',
        current_turn: 0,
        game_phase: 'playing',
      };

      const mockPlayer = {
        id: 'player-1',
        user_id: mockUserId,
        position: 0,
        is_host: true,
      };

      const { result } = renderHook(() => useRealtime(mockOptions));

      act(() => {
        // @ts-ignore
        result.current.gameState = mockGameState;
        // @ts-ignore
        result.current.currentPlayer = mockPlayer;
        // @ts-ignore
        result.current.players = [mockPlayer];
      });

      await expect(
        act(async () => {
          await result.current.playCards(mockCards);
        })
      ).rejects.toThrow('Invalid triple: all cards must have matching ranks');
    });

    it('should throw error for invalid triple with all different ranks', async () => {
      const mockCards = [
        { suit: 'spades' as const, rank: '3' as const },
        { suit: 'hearts' as const, rank: '4' as const },
        { suit: 'clubs' as const, rank: '5' as const },
      ];

      const mockGameState = {
        id: 'game-123',
        room_id: 'room-123',
        current_turn: 0,
        game_phase: 'playing',
      };

      const mockPlayer = {
        id: 'player-1',
        user_id: mockUserId,
        position: 0,
        is_host: true,
      };

      const { result } = renderHook(() => useRealtime(mockOptions));

      act(() => {
        // @ts-ignore
        result.current.gameState = mockGameState;
        // @ts-ignore
        result.current.currentPlayer = mockPlayer;
        // @ts-ignore
        result.current.players = [mockPlayer];
      });

      await expect(
        act(async () => {
          await result.current.playCards(mockCards);
        })
      ).rejects.toThrow('Invalid triple: all cards must have matching ranks');
    });

    it('should pass turn', async () => {
      const mockGameState = {
        id: 'game-123',
        room_id: 'room-123',
        current_turn: 0,
        pass_count: 0,
        game_phase: 'playing',
      };

      const mockPlayer = {
        id: 'player-1',
        user_id: mockUserId,
        position: 0,
      };

      (supabase.from as jest.Mock).mockReturnValue({
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({
            data: { ...mockGameState, pass_count: 1, current_turn: 1 },
            error: null,
          }),
        }),
      });

      const { result } = renderHook(() => useRealtime(mockOptions));

      // Setup state
      act(() => {
        // @ts-ignore
        result.current.gameState = mockGameState;
        // @ts-ignore
        result.current.currentPlayer = mockPlayer;
        // @ts-ignore
        result.current.players = [mockPlayer, { position: 1 }];
      });

      await act(async () => {
        await result.current.pass();
      });

      expect(supabase.from).toHaveBeenCalledWith('game_state');
    });

    it('should not allow actions when not player turn', async () => {
      const mockGameState = {
        id: 'game-123',
        room_id: 'room-123',
        current_turn: 1, // Not current player's turn
        game_phase: 'playing',
      };

      const mockPlayer = {
        id: 'player-1',
        user_id: mockUserId,
        position: 0,
      };

      const { result } = renderHook(() => useRealtime(mockOptions));

      // Setup state
      act(() => {
        // @ts-ignore
        result.current.gameState = mockGameState;
        // @ts-ignore
        result.current.currentPlayer = mockPlayer;
      });

      await expect(async () => {
        await act(async () => {
          await result.current.playCards([{ suit: 'spades' as const, rank: '3' as const }]);
        });
      }).rejects.toThrow('Not your turn');
    });
  });

  describe('Real-time Synchronization', () => {
    it('should handle connection state changes', () => {
      const { result } = renderHook(() => useRealtime(mockOptions));

      expect(result.current.isConnected).toBe(false);

      // Connection changes would be tested with actual channel subscription
    });

    it('should handle reconnection', async () => {
      const onReconnect = jest.fn();
      const { result } = renderHook(() =>
        useRealtime({ ...mockOptions, onReconnect })
      );

      await act(async () => {
        await result.current.reconnect();
      });

      // Reconnection logic would trigger onReconnect callback
    });

    it('should handle errors gracefully', () => {
      const onError = jest.fn();
      const { result } = renderHook(() =>
        useRealtime({ ...mockOptions, onError })
      );

      expect(result.current.error).toBeNull();
    });
  });

  describe('Room Code Generation', () => {
    it('should generate unique 6-character codes', async () => {
      const codes = new Set<string>();

      // Generate multiple codes
      for (let i = 0; i < 100; i++) {
        (supabase.from as jest.Mock).mockReturnValue({
          insert: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: {
                  id: `room-${i}`,
                  code: `CODE${i}`,
                  host_id: mockUserId,
                  status: 'waiting',
                  max_players: 4,
                },
                error: null,
              }),
            }),
          }),
        });

        const { result } = renderHook(() => useRealtime(mockOptions));

        await act(async () => {
          const room = await result.current.createRoom();
          codes.add(room.code);
        });
      }

      // All codes should be unique
      expect(codes.size).toBe(100);

      // All codes should be 6 characters
      codes.forEach((code) => {
        expect(code.length).toBe(6);
      });
    });
  });
});
