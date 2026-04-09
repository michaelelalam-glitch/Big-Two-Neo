/**
 * useRoomLobby Hook Tests — H15 Audit Fix
 *
 * Tests for lobby management callbacks:
 * - createRoom: inserts room + host player, handles collision retries
 * - joinRoom: validates room, finds slot, inserts player, broadcasts
 * - leaveRoom: deletes player, cleans up channel/state
 * - setReady: updates DB, broadcasts, notifies when all ready
 * - startGame: host-only guard, RPC call, validates response
 */

import { renderHook, act } from '@testing-library/react-native';
import { useRoomLobby, UseRoomLobbyOptions } from '../useRoomLobby';

// ── Supabase mock ────────────────────────────────────────────────────────────

const mockFrom = jest.fn();
const mockRpc = jest.fn();
const mockRemoveChannel = jest.fn();

jest.mock('../../services/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
    removeChannel: (...args: unknown[]) => mockRemoveChannel(...args),
  },
}));

jest.mock('../../services/pushNotificationTriggers', () => ({
  notifyGameStarted: jest.fn().mockResolvedValue(undefined),
  notifyAllPlayersReady: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../utils/logger', () => ({
  networkLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { notifyGameStarted, notifyAllPlayersReady } from '../../services/pushNotificationTriggers';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Supabase chainable query builder mock */
function chainMock(result: { data?: unknown; error?: unknown; count?: number | null }) {
  const chain: Record<string, jest.Mock> = {};
  const methods = ['insert', 'select', 'delete', 'update', 'eq', 'order', 'single'];
  for (const m of methods) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }
  // Terminal methods resolve to result
  chain.single = jest.fn().mockResolvedValue(result);
  // select with count option
  chain.select = jest
    .fn()
    .mockReturnValue({ ...chain, then: (r: (v: unknown) => void) => r(result) });
  // Make the chain thenable for await
  (chain as Record<string, unknown>).then = (resolve: (v: unknown) => void) => resolve(result);
  return chain;
}

const ROOM_ID = 'room-uuid-123';
const USER_ID = 'user-uuid-456';
const PLAYER_ID = 'player-uuid-789';

function makeRoom(overrides: Record<string, unknown> = {}) {
  return {
    id: ROOM_ID,
    code: 'ABCD12',
    status: 'waiting',
    host_id: USER_ID,
    max_players: 4,
    ...overrides,
  };
}

function makePlayer(overrides: Record<string, unknown> = {}) {
  return {
    id: PLAYER_ID,
    room_id: ROOM_ID,
    user_id: USER_ID,
    username: 'TestUser',
    player_index: 0,
    is_host: false,
    is_ready: false,
    is_bot: false,
    ...overrides,
  };
}

function makeOptions(overrides: Partial<UseRoomLobbyOptions> = {}): UseRoomLobbyOptions {
  return {
    userId: USER_ID,
    username: 'TestUser',
    room: null,
    roomPlayers: [],
    currentPlayer: null,
    isHost: false,
    setRoom: jest.fn(),
    setRoomPlayers: jest.fn(),
    setGameState: jest.fn(),
    setPlayerHands: jest.fn(),
    setIsConnected: jest.fn(),
    setLoading: jest.fn(),
    setError: jest.fn(),
    channelRef: { current: null },
    broadcastMessage: jest.fn().mockResolvedValue(undefined),
    joinChannel: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('useRoomLobby', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── createRoom ──────────────────────────────────────────────────────────

  describe('createRoom', () => {
    it('creates room and joins as host', async () => {
      const room = makeRoom();
      const roomChain = chainMock({ data: room, error: null });
      const playerChain = chainMock({ data: null, error: null });

      mockFrom.mockImplementation((table: string) => {
        if (table === 'rooms') return roomChain;
        if (table === 'room_players') return playerChain;
        return chainMock({ data: null, error: null });
      });

      const opts = makeOptions();
      const { result } = renderHook(() => useRoomLobby(opts));

      let created: unknown;
      await act(async () => {
        created = await result.current.createRoom();
      });

      expect(created).toEqual(room);
      expect(opts.setRoom).toHaveBeenCalledWith(room);
      expect(opts.joinChannel).toHaveBeenCalledWith(ROOM_ID);
      expect(opts.setLoading).toHaveBeenCalledWith(true);
    });

    it('retries on unique code collision (23505)', async () => {
      const room = makeRoom();
      const collisionError = { code: '23505', message: 'duplicate key' };
      let callCount = 0;

      const roomChain: Record<string, jest.Mock> = {};
      roomChain.insert = jest.fn().mockReturnValue(roomChain);
      roomChain.select = jest.fn().mockReturnValue(roomChain);
      roomChain.single = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 2) return Promise.resolve({ data: null, error: collisionError });
        return Promise.resolve({ data: room, error: null });
      });

      const playerChain = chainMock({ data: null, error: null });
      mockFrom.mockImplementation((table: string) => {
        if (table === 'rooms') return roomChain;
        return playerChain;
      });

      const opts = makeOptions();
      const { result } = renderHook(() => useRoomLobby(opts));

      await act(async () => {
        await result.current.createRoom();
      });

      // single() called 3 times (2 collisions + 1 success)
      expect(roomChain.single).toHaveBeenCalledTimes(3);
      expect(opts.setRoom).toHaveBeenCalledWith(room);
    });

    it('throws after max collision attempts', async () => {
      const collisionError = { code: '23505', message: 'duplicate' };

      const roomChain: Record<string, jest.Mock> = {};
      roomChain.insert = jest.fn().mockReturnValue(roomChain);
      roomChain.select = jest.fn().mockReturnValue(roomChain);
      roomChain.single = jest.fn().mockResolvedValue({ data: null, error: collisionError });

      mockFrom.mockReturnValue(roomChain);

      const opts = makeOptions();
      const { result } = renderHook(() => useRoomLobby(opts));

      await act(async () => {
        await expect(result.current.createRoom()).rejects.toEqual(collisionError);
      });

      expect(opts.setError).toHaveBeenCalled();
    });
  });

  // ── joinRoom ────────────────────────────────────────────────────────────

  describe('joinRoom', () => {
    it('joins room by code and broadcasts', async () => {
      const room = makeRoom();

      // Room lookup chain (read-only, no concurrency risk)
      const roomSelectChain: Record<string, jest.Mock> = {};
      roomSelectChain.select = jest.fn().mockReturnValue(roomSelectChain);
      roomSelectChain.eq = jest.fn().mockReturnValue(roomSelectChain);
      roomSelectChain.single = jest.fn().mockResolvedValue({ data: room, error: null });

      mockFrom.mockImplementation((table: string) => {
        if (table === 'rooms') return roomSelectChain;
        return chainMock({ data: null, error: null });
      });

      // M28: atomic join RPC returns player_index
      mockRpc.mockResolvedValue({
        data: { room_id: ROOM_ID, player_index: 1, is_host: false, already_joined: false },
        error: null,
      });

      const opts = makeOptions();
      const { result } = renderHook(() => useRoomLobby(opts));

      await act(async () => {
        await result.current.joinRoom('abcd12');
      });

      expect(mockRpc).toHaveBeenCalledWith('join_room_atomic', {
        p_room_code: 'ABCD12',
        p_user_id: USER_ID,
        p_username: 'TestUser',
      });
      expect(opts.setRoom).toHaveBeenCalledWith(room);
      expect(opts.joinChannel).toHaveBeenCalled();
      expect(opts.broadcastMessage).toHaveBeenCalledWith(
        'player_joined',
        expect.objectContaining({ user_id: USER_ID })
      );
    });

    it('throws when room not found', async () => {
      const roomChain: Record<string, jest.Mock> = {};
      roomChain.select = jest.fn().mockReturnValue(roomChain);
      roomChain.eq = jest.fn().mockReturnValue(roomChain);
      roomChain.single = jest
        .fn()
        .mockResolvedValue({ data: null, error: { message: 'not found' } });

      mockFrom.mockReturnValue(roomChain);

      const opts = makeOptions();
      const { result } = renderHook(() => useRoomLobby(opts));

      await act(async () => {
        await expect(result.current.joinRoom('ZZZZZZ')).rejects.toThrow(
          'Room not found or already started'
        );
      });
    });
  });

  // ── leaveRoom ───────────────────────────────────────────────────────────

  describe('leaveRoom', () => {
    it('cleans up player, channel, and state', async () => {
      const player = makePlayer();
      const room = makeRoom();
      const mockUnsubscribe = jest.fn().mockResolvedValue(undefined);
      const channelRef = { current: { unsubscribe: mockUnsubscribe } };

      const deleteChain: Record<string, jest.Mock> = {};
      deleteChain.delete = jest.fn().mockReturnValue(deleteChain);
      deleteChain.eq = jest.fn().mockResolvedValue({ error: null });

      mockFrom.mockReturnValue(deleteChain);
      mockRemoveChannel.mockResolvedValue(undefined);

      const opts = makeOptions({
        room: room as never,
        currentPlayer: player as never,
        channelRef: channelRef as never,
      });
      const { result } = renderHook(() => useRoomLobby(opts));

      await act(async () => {
        await result.current.leaveRoom();
      });

      expect(opts.broadcastMessage).toHaveBeenCalledWith('player_left', expect.any(Object));
      expect(mockUnsubscribe).toHaveBeenCalled();
      expect(mockRemoveChannel).toHaveBeenCalled();
      expect(opts.setRoom).toHaveBeenCalledWith(null);
      expect(opts.setRoomPlayers).toHaveBeenCalledWith([]);
      expect(opts.setIsConnected).toHaveBeenCalledWith(false);
    });

    it('does nothing when no room or player', async () => {
      const opts = makeOptions({ room: null, currentPlayer: null });
      const { result } = renderHook(() => useRoomLobby(opts));

      await act(async () => {
        await result.current.leaveRoom();
      });

      expect(mockFrom).not.toHaveBeenCalled();
    });
  });

  // ── setReady ────────────────────────────────────────────────────────────

  describe('setReady', () => {
    it('does nothing when no currentPlayer', async () => {
      const opts = makeOptions({ currentPlayer: null });
      const { result } = renderHook(() => useRoomLobby(opts));

      await act(async () => {
        await result.current.setReady(true);
      });

      expect(mockFrom).not.toHaveBeenCalled();
    });

    it('updates ready status and broadcasts', async () => {
      const player = makePlayer();
      const updateChain: Record<string, jest.Mock> = {};
      updateChain.update = jest.fn().mockReturnValue(updateChain);
      updateChain.eq = jest.fn().mockResolvedValue({ error: null });

      mockFrom.mockReturnValue(updateChain);

      const opts = makeOptions({ currentPlayer: player as never });
      const { result } = renderHook(() => useRoomLobby(opts));

      await act(async () => {
        await result.current.setReady(false);
      });

      expect(opts.broadcastMessage).toHaveBeenCalledWith('player_ready', {
        user_id: USER_ID,
        ready: false,
      });
    });
  });

  // ── startGame ───────────────────────────────────────────────────────────

  describe('startGame', () => {
    it('does nothing when not host', async () => {
      const opts = makeOptions({ isHost: false });
      const { result } = renderHook(() => useRoomLobby(opts));

      await act(async () => {
        await result.current.startGame();
      });

      expect(mockRpc).not.toHaveBeenCalled();
    });

    it('throws when players not ready', async () => {
      const room = makeRoom();
      const players = [
        makePlayer({ is_host: true, user_id: 'host' }),
        makePlayer({ is_host: false, is_ready: false, user_id: 'p2' }),
      ];

      const opts = makeOptions({
        isHost: true,
        room: room as never,
        roomPlayers: players as never[],
      });
      const { result } = renderHook(() => useRoomLobby(opts));

      await act(async () => {
        await expect(result.current.startGame()).rejects.toThrow(
          'All non-host players must be ready'
        );
      });
    });

    it('throws when fewer than 2 players', async () => {
      const room = makeRoom();
      const players = [makePlayer({ is_host: true })];

      const opts = makeOptions({
        isHost: true,
        room: room as never,
        roomPlayers: players as never[],
      });
      const { result } = renderHook(() => useRoomLobby(opts));

      await act(async () => {
        await expect(result.current.startGame()).rejects.toThrow('Need at least 2 players');
      });
    });

    it('calls RPC and broadcasts on success', async () => {
      const room = makeRoom();
      const players = [
        makePlayer({ is_host: true, user_id: 'host' }),
        makePlayer({ is_host: false, is_ready: true, user_id: 'p2' }),
      ];

      mockRpc.mockResolvedValue({
        data: { success: true, game_state: { room_id: ROOM_ID }, room_id: ROOM_ID },
        error: null,
      });

      const opts = makeOptions({
        isHost: true,
        room: room as never,
        roomPlayers: players as never[],
      });
      const { result } = renderHook(() => useRoomLobby(opts));

      await act(async () => {
        await result.current.startGame('hard');
      });

      expect(mockRpc).toHaveBeenCalledWith('start_game_with_bots', {
        p_room_id: ROOM_ID,
        p_bot_count: 2, // 4 - 2 players
        p_bot_difficulty: 'hard',
      });
      expect(opts.broadcastMessage).toHaveBeenCalledWith('game_started', expect.any(Object));
      expect(notifyGameStarted).toHaveBeenCalledWith(ROOM_ID, 'ABCD12');
    });
  });
});
