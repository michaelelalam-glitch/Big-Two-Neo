/**
 * useRoomLobby — Room creation, joining, leaving, ready, and game start logic.
 *
 * Extracted from useRealtime.ts to reduce file size (~260 lines).
 * Returns callbacks for lobby management (createRoom, joinRoom, leaveRoom, setReady, startGame).
 */

import { useCallback } from 'react';
import { notifyGameStarted, notifyAllPlayersReady } from '../services/pushNotificationTriggers';
import { supabase } from '../services/supabase';
import type {
  Room,
  Player,
  PlayerHand,
  BroadcastEvent,
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
  setGameState: React.Dispatch<React.SetStateAction<any>>;
  setPlayerHands: React.Dispatch<React.SetStateAction<Map<string, PlayerHand>>>;
  setIsConnected: React.Dispatch<React.SetStateAction<boolean>>;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setError: React.Dispatch<React.SetStateAction<Error | null>>;
  channelRef: React.MutableRefObject<any>;
  onError?: (error: Error) => void;
  broadcastMessage: (event: BroadcastEvent, data: any) => Promise<void>;
  joinChannel: (roomId: string) => Promise<void>;
}

/**
 * Generate a unique 6-character room code
 */
function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

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
      const code = generateRoomCode();

      const { data: newRoom, error: roomError } = await supabase
        .from('rooms')
        .insert({
          code,
          host_id: userId,
          status: 'waiting',
          max_players: 4,
        })
        .select()
        .single();

      if (roomError) throw roomError;

      const { error: playerError } = await supabase
        .from('room_players')
        .insert({
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
   * Join an existing room by code
   */
  const joinRoom = useCallback(async (code: string): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const { data: existingRoom, error: roomError } = await supabase
        .from('rooms')
        .select('*')
        .eq('code', code.toUpperCase())
        .eq('status', 'waiting')
        .single();

      if (roomError) throw new Error('Room not found or already started');

      const { count } = await supabase
        .from('room_players')
        .select('*', { count: 'exact', head: true })
        .eq('room_id', existingRoom.id);

      if (count && count >= existingRoom.max_players) {
        throw new Error('Room is full');
      }

      const { data: existingPlayers } = await supabase
        .from('room_players')
        .select('player_index')
        .eq('room_id', existingRoom.id)
        .order('player_index');

      const takenPositions = new Set(existingPlayers?.map(p => p.player_index) || []);
      let player_index = 0;
      while (takenPositions.has(player_index) && player_index < 4) player_index++;

      const { error: playerError } = await supabase
        .from('room_players')
        .insert({
          room_id: existingRoom.id,
          user_id: userId,
          username,
          player_index,
          is_host: false,
          is_ready: false,
          is_bot: false,
        });

      if (playerError) throw playerError;

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, username, onError, broadcastMessage]);

  /**
   * Leave the current room
   */
  const leaveRoom = useCallback(async (): Promise<void> => {
    if (!room || !currentPlayer) return;

    try {
      await supabase
        .from('room_players')
        .delete()
        .eq('id', currentPlayer.id);

      await broadcastMessage('player_left', { user_id: userId, player_index: currentPlayer.player_index });

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
  }, [room, currentPlayer, userId, onError, broadcastMessage, channelRef, setRoom, setRoomPlayers, setGameState, setPlayerHands, setIsConnected, setError]);

  /**
   * Set player ready status
   */
  const setReady = useCallback(async (ready: boolean): Promise<void> => {
    if (!currentPlayer) return;

    try {
      await supabase
        .from('room_players')
        .update({ is_ready: ready })
        .eq('id', currentPlayer.id);

      await broadcastMessage('player_ready', { user_id: userId, ready });

      if (ready && room) {
        const updatedPlayers = await supabase
          .from('room_players')
          .select('is_ready, user_id')
          .eq('room_id', room.id);

        const allReady = updatedPlayers.data?.every(p => p.is_ready) ?? false;
        const hostPlayer = roomPlayers.find(p => p.is_host);

        if (allReady && hostPlayer && hostPlayer.user_id) {
          notifyAllPlayersReady(hostPlayer.user_id, room.code, room.id).catch(err =>
            console.error('Failed to send all players ready notification:', err)
          );
        }
      }
    } catch (err) {
      const error = err as Error;
      setError(error);
      onError?.(error);
    }
  }, [currentPlayer, userId, onError, broadcastMessage, room, roomPlayers, setError]);

  /**
   * Start the game (host only)
   */
  const startGame = useCallback(async (botDifficulty: 'easy' | 'medium' | 'hard' = 'medium'): Promise<void> => {
    if (!isHost || !room) return;

    const allReady = roomPlayers.every(p => p.is_ready);
    if (!allReady) throw new Error('All players must be ready');
    if (roomPlayers.length < 2) throw new Error('Need at least 2 players to start');

    try {
      const botCount = Math.max(0, 4 - roomPlayers.length);
      const { data: startResult, error: startError } = await supabase.rpc('start_game_with_bots', {
        p_room_id: room.id,
        p_bot_count: botCount,
        p_bot_difficulty: botDifficulty,
      });

      if (startError || !startResult?.success) {
        throw new Error(startError?.message || startResult?.error || 'Failed to start game');
      }

      const gameStateResult = (startResult as any).game_state ?? startResult;
      if (!gameStateResult || !gameStateResult.room_id) {
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
  }, [isHost, room, roomPlayers, onError, broadcastMessage, setError]);

  return { createRoom, joinRoom, leaveRoom, setReady, startGame };
}
