/**
 * useRoomLobby — Room creation, joining, leaving, ready, and game start logic.
 *
 * Extracted from useRealtime.ts to reduce file size (~260 lines).
 * Returns callbacks for lobby management (createRoom, joinRoom, leaveRoom, setReady, startGame).
 */

import { useCallback } from 'react';
import { RealtimeChannel } from '@supabase/supabase-js';
import { notifyGameStarted, notifyAllPlayersReady } from '../services/pushNotificationTriggers';
import { supabase } from '../services/supabase';
import type {
  Room,
  Player,
  GameState,
  PlayerHand,
  BroadcastEvent,
  BroadcastData,
} from '../types/multiplayer';
import { networkLogger } from '../utils/logger';

export interface UseRoomLobbyOptions {
  userId: string;
  username: string;
  room: Room | null;
  roomPlayers: Player[];
  currentPlayer: Player | null;
  isHost: boolean;
  setRoom: React.Dispatch<React.SetStateAction<Room | null>>;
  setRoomPlayers: React.Dispatch<React.SetStateAction<Player[]>>;
  setGameState: React.Dispatch<React.SetStateAction<GameState | null>>;
  setPlayerHands: React.Dispatch<React.SetStateAction<Map<string, PlayerHand>>>;
  setIsConnected: React.Dispatch<React.SetStateAction<boolean>>;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setError: React.Dispatch<React.SetStateAction<Error | null>>;
  channelRef: React.MutableRefObject<RealtimeChannel | null>;
  onError?: (error: Error) => void;
  broadcastMessage: (event: BroadcastEvent, data: BroadcastData) => Promise<void>;
  joinChannel: (roomId: string) => Promise<void>;
}

/**
 * Generate a unique 6-character room code
 */
function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    // Math.random() is intentional: room codes are NOT security-critical.
    // They are short-lived, human-readable join codes for ad-hoc games.
    // Duplicate codes are handled by the DB unique constraint + MAX_ROOM_CREATE_ATTEMPTS retry. (L17)
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/** Max attempts to insert a room before giving up on code collision */
const MAX_ROOM_CREATE_ATTEMPTS = 3;

export function useRoomLobby({
  userId,
  username,
  room,
  roomPlayers,
  currentPlayer,
  isHost,
  setRoom,
  setRoomPlayers,
  setGameState,
  setPlayerHands,
  setIsConnected,
  setLoading,
  setError,
  channelRef,
  onError,
  broadcastMessage,
  joinChannel,
}: UseRoomLobbyOptions) {
  /**
   * Create a new game room
   */
  const createRoom = useCallback(async (): Promise<Room> => {
    setLoading(true);
    setError(null);

    try {
      // Retry with fresh codes on unique-constraint collision (rooms_code_unique).
      let newRoom: Room | null = null;
      for (let attempt = 0; attempt < MAX_ROOM_CREATE_ATTEMPTS; attempt++) {
        const code = generateRoomCode();

        const { data, error: roomError } = await supabase
          .from('rooms')
          .insert({
            code,
            host_id: userId,
            status: 'waiting',
            max_players: 4,
          })
          .select()
          .single();

        if (roomError) {
          // 23505 = unique_violation — retry with a new code
          const isUniqueViolation =
            roomError.code === '23505' || roomError.message?.includes('duplicate');
          if (isUniqueViolation && attempt < MAX_ROOM_CREATE_ATTEMPTS - 1) {
            networkLogger.warn(
              `[useRoomLobby] Room code collision (attempt ${attempt + 1}/${MAX_ROOM_CREATE_ATTEMPTS}), retrying`
            );
            continue;
          }
          // P0429 = rate limit exceeded (enforce_create_room_rate_limit trigger — Task #281).
          // Log the event for observability; the throw below surfaces it to the caller
          // regardless of error type — no special control-flow change is needed here.
          if (
            roomError.code === 'P0429' ||
            roomError.message?.toLowerCase().includes('rate limit')
          ) {
            networkLogger.warn(
              '[useRoomLobby] Room creation rate limit exceeded for user',
              userId?.substring(0, 8)
            );
          }
          throw roomError;
        }

        newRoom = data as Room;
        break;
      }

      if (!newRoom) throw new Error('Failed to create room after max attempts');

      const { error: playerError } = await supabase.from('room_players').insert({
        room_id: newRoom.id,
        user_id: userId,
        username,
        player_index: 0,
        is_host: true,
        is_ready: false,
        is_bot: false,
      });

      if (playerError) throw playerError;

      setRoom(newRoom);
      await joinChannel(newRoom.id);
      return newRoom;
    } catch (err) {
      const error = err as Error;
      setError(error);
      onError?.(error);
      throw error;
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, username, onError]);

  /**
   * Join an existing room by code.
   * Uses join_room_atomic RPC to prevent TOCTOU race conditions (M28):
   * the DB-level advisory lock ensures count+index+insert are atomic.
   */
  const joinRoom = useCallback(
    async (code: string): Promise<void> => {
      setLoading(true);
      setError(null);

      try {
        // Fetch room for local UI state (setRoom) — read-only, no concurrency risk.
        const { data: existingRoom, error: roomError } = await supabase
          .from('rooms')
          .select('*')
          .eq('code', code.toUpperCase())
          .eq('status', 'waiting')
          .single();

        if (roomError || !existingRoom) throw new Error('Room not found or already started');

        // Atomic join: advisory-locked insert inside a DB transaction prevents
        // double-join and seat collision under concurrent callers (M28).
        const { data: joinResult, error: joinError } = await supabase.rpc('join_room_atomic', {
          p_room_code: code.toUpperCase(),
          p_user_id: userId,
          p_username: username,
        });

        if (joinError) {
          // Surface meaningful DB-level error messages (room full, banned, etc.)
          throw new Error(joinError.message ?? 'Failed to join room');
        }

        const rawIndex = (joinResult as { player_index?: unknown } | null)?.player_index;
        if (typeof rawIndex !== 'number' || Number.isNaN(rawIndex)) {
          throw new Error('Failed to join room: invalid player index returned');
        }
        const player_index = rawIndex;

        setRoom(existingRoom);
        await joinChannel(existingRoom.id);
        await broadcastMessage('player_joined', { user_id: userId, username, player_index });
      } catch (err) {
        const error = err as Error;
        setError(error);
        onError?.(error);
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [userId, username, onError, broadcastMessage, joinChannel, setError, setLoading, setRoom]
  );

  /**
   * Leave the current room
   */
  const leaveRoom = useCallback(async (): Promise<void> => {
    if (!room || !currentPlayer) return;

    try {
      await supabase.from('room_players').delete().eq('id', currentPlayer.id);

      await broadcastMessage('player_left', {
        user_id: userId,
        player_index: currentPlayer.player_index,
      });

      if (channelRef.current) {
        await channelRef.current.unsubscribe();
        await supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }

      setRoom(null);
      setRoomPlayers([]);
      setGameState(null);
      setPlayerHands(new Map());
      setIsConnected(false);
    } catch (err) {
      const error = err as Error;
      setError(error);
      onError?.(error);
    }
  }, [
    room,
    currentPlayer,
    userId,
    onError,
    broadcastMessage,
    channelRef,
    setRoom,
    setRoomPlayers,
    setGameState,
    setPlayerHands,
    setIsConnected,
    setError,
  ]);

  /**
   * Set player ready status
   */
  const setReady = useCallback(
    async (ready: boolean): Promise<void> => {
      if (!currentPlayer) return;

      try {
        await supabase.from('room_players').update({ is_ready: ready }).eq('id', currentPlayer.id);

        await broadcastMessage('player_ready', { user_id: userId, ready });

        if (ready && room) {
          const updatedPlayers = await supabase
            .from('room_players')
            .select('is_ready, user_id, is_host, is_bot')
            .eq('room_id', room.id);

          // Only non-host, non-bot players are required to be ready.
          // The host is the initiator and bots are always ready.
          // Use strict equality (=== true / !== true) to handle nullable DB booleans safely.
          const nonHostHumans =
            updatedPlayers.data?.filter(p => p.is_host !== true && p.is_bot !== true) ?? [];
          const allReady =
            nonHostHumans.length === 0 || nonHostHumans.every(p => p.is_ready === true);
          const hostPlayer = roomPlayers.find(p => p.is_host === true);

          if (allReady && hostPlayer && hostPlayer.user_id) {
            notifyAllPlayersReady(hostPlayer.user_id, room.code, room.id).catch(err =>
              networkLogger.error('Failed to send all players ready notification:', err)
            );
          }
        }
      } catch (err) {
        const error = err as Error;
        setError(error);
        onError?.(error);
      }
    },
    [currentPlayer, userId, onError, broadcastMessage, room, roomPlayers, setError]
  );

  /**
   * Start the game (host only)
   */
  const startGame = useCallback(
    async (botDifficulty: 'easy' | 'medium' | 'hard' = 'medium'): Promise<void> => {
      if (!isHost || !room) return;

      // Only non-host, non-bot players must be ready. Bots are auto-ready; the host is the initiator.
      // Use strict equality (=== true / !== true) to handle nullable DB booleans safely.
      const nonHostHumans = roomPlayers.filter(p => p.is_host !== true && p.is_bot !== true);
      const allReady = nonHostHumans.length === 0 || nonHostHumans.every(p => p.is_ready === true);
      if (!allReady) throw new Error('All non-host players must be ready');
      if (roomPlayers.length < 2) throw new Error('Need at least 2 players to start');

      try {
        const botCount = Math.max(0, 4 - roomPlayers.length);
        const { data: startResult, error: startError } = await supabase.rpc(
          'start_game_with_bots',
          {
            p_room_id: room.id,
            p_bot_count: botCount,
            p_bot_difficulty: botDifficulty,
          }
        );

        // Narrow the Json RPC result to the known response shape
        type GameStartRpcResult = {
          success?: boolean;
          error?: string;
          game_state?: GameState;
          room_id?: string;
        };
        const typedResult = startResult as GameStartRpcResult | null;
        if (startError || !typedResult?.success) {
          throw new Error(startError?.message || typedResult?.error || 'Failed to start game');
        }

        const gameStateResult = typedResult.game_state ?? typedResult;
        if (!gameStateResult?.room_id) {
          throw new Error('Failed to start game: missing game state from RPC result');
        }

        notifyGameStarted(room.id, room.code).catch(err =>
          networkLogger.error('❌ Failed to send game start notifications:', err)
        );

        await broadcastMessage('game_started', { success: true, roomId: room.id });
      } catch (err) {
        const error = err as Error;
        setError(error);
        onError?.(error);
        throw error;
      }
    },
    [isHost, room, roomPlayers, onError, broadcastMessage, setError]
  );

  return { createRoom, joinRoom, leaveRoom, setReady, startGame };
}
