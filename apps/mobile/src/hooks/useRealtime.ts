/**
 * useRealtime - Real-time multiplayer game hook with Supabase Realtime
 * 
 * Features:
 * - Room creation and joining with unique codes (via useRoomLobby)
 * - Real-time player presence tracking via Supabase Presence
 * - Game state synchronization across all clients
 * - Turn-based logic delegated to server Edge Functions (via realtimeActions)
 * - Automatic reconnection handling
 * - 4-player multiplayer support
 * 
 * NOTE: This hook uses the `room_players` table for lobby management (persistent player data).
 *       Real-time online/offline status is tracked using Supabase Presence features.
 *       The `players` table is used only by Edge Functions for game logic.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../services/supabase';
import {
  Room,
  Player,
  GameState,
  PlayerHand,
  Card,
  UseRealtimeReturn,
  BroadcastEvent,
  BroadcastPayload,
} from '../types/multiplayer';
import type {
  MultiplayerMatchScoreDetail,
  UseRealtimeOptions,
} from '../types/realtimeTypes';
import {
  isValidTimerStatePayload,
} from '../utils/edgeFunctionErrors';
import { networkLogger, gameLogger } from '../utils/logger';
import { executePlayCards, executePass } from './realtimeActions';
import { useAutoPassTimer } from './useAutoPassTimer';
import { useClockSync } from './useClockSync';
import { useRoomLobby } from './useRoomLobby';

// Re-export types for backward compatibility
export type { UseRealtimeOptions } from '../types/realtimeTypes';

// Alias for internal use
type PlayerMatchScoreDetail = MultiplayerMatchScoreDetail;

export function useRealtime(options: UseRealtimeOptions): UseRealtimeReturn {
  const { userId, username, onError, onDisconnect, onReconnect, onMatchEnded } = options;
  
  // State
  const [room, setRoom] = useState<Room | null>(null);
  const [roomPlayers, setRoomPlayers] = useState<Player[]>([]); // Players in room_players table (lobby)
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [playerHands, setPlayerHands] = useState<Map<string, PlayerHand>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  
  // Refs
  const channelRef = useRef<RealtimeChannel | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  // Computed values
  const currentPlayer = roomPlayers.find(p => p.user_id === userId) || null;
  const isHost = currentPlayer?.is_host === true;
  
  // ⏰ Clock sync for accurate timer calculations (matches AutoPassTimer component)
  const { getCorrectedNow } = useClockSync(gameState?.auto_pass_timer || null);
  
  // BULLETPROOF: Data ready check - ensures game state is fully loaded with valid data
  const isDataReady = !loading && 
    !!gameState && 
    !!gameState.hands && 
    Object.keys(gameState.hands).length > 0 && 
    roomPlayers.length > 0;
  
  /**
   * Broadcast message to all room players
   */
  const broadcastMessage = useCallback(async (event: BroadcastEvent, data: any) => {
    if (!channelRef.current || !room) return;
    
    const payload: BroadcastPayload = {
      event,
      data,
      timestamp: new Date().toISOString(),
    };
    
    await channelRef.current.send({
      type: 'broadcast',
      event,
      payload,
    });
  }, [room]);
  
  // ⏰ Auto-pass timer (extracted hook — manages its own refs/intervals)
  const { isAutoPassInProgress } = useAutoPassTimer({
    gameState,
    room,
    roomPlayers,
    broadcastMessage,
    getCorrectedNow,
  });

  /**
   * Fetch all room players from room_players table
   */
  const fetchPlayers = useCallback(async (roomId: string) => {
    try {
      const { data, error } = await supabase
        .from('room_players')
        .select('*')
        .eq('room_id', roomId)
        .order('player_index');
      
      if (error) {
        networkLogger.error(`❌ [fetchPlayers] Error fetching players:`, error);
        throw error;
      } else if (data) {
        setRoomPlayers(data);
      }
    } catch (err) {
      networkLogger.error('[useRealtime] Failed to fetch players:', err);
      throw err;
    }
  }, []);
  
  /**
   * Fetch current game state
   */
  const fetchGameState = useCallback(async (roomId: string) => {
    const { data, error } = await supabase
      .from('game_state')
      .select('*')
      .eq('room_id', roomId)
      .single();
    
    if (error) {
      if (error.code !== 'PGRST116') {
        networkLogger.error('[fetchGameState] Error:', error);
        throw error;
      }
      setGameState(null);
    } else if (data) {
      setGameState(data);
    } else {
      setGameState(null);
    }
  }, []);

  /**
   * Join a realtime channel for the room
   */
  const joinChannel = useCallback(async (roomId: string): Promise<void> => {
    // Remove existing channel
    if (channelRef.current) {
      await channelRef.current.unsubscribe();
      await supabase.removeChannel(channelRef.current);
    }
    
    // Create new channel with presence
    const channel = supabase.channel(`room:${roomId}`, {
      config: {
        presence: {
          key: userId,
        },
      },
    });
    
    // Subscribe to presence events (logging disabled to reduce console noise)
    channel
      .on('presence', { event: 'sync' }, () => {})
      .on('presence', { event: 'join' }, ({ key: _key, newPresences: _newPresences }) => {})
      .on('presence', { event: 'leave' }, ({ key: _key2, leftPresences: _leftPresences }) => {});
    
    // Subscribe to broadcast events
    channel
      .on('broadcast', { event: 'player_joined' }, (_payload) => {
        fetchPlayers(roomId);
      })
      .on('broadcast', { event: 'player_left' }, (_payload) => {
        fetchPlayers(roomId);
      })
      .on('broadcast', { event: 'player_ready' }, (_payload) => {
        fetchPlayers(roomId);
      })
      .on('broadcast', { event: 'game_started' }, (_payload) => {
        fetchGameState(roomId);
      })
      .on('broadcast', { event: 'cards_played' }, (_payload) => {
        fetchGameState(roomId);
      })
      .on('broadcast', { event: 'player_passed' }, (_payload) => {
        fetchGameState(roomId);
      })
      .on('broadcast', { event: 'game_ended' }, (payload) => {
        networkLogger.info('🎉 [Realtime] game_ended broadcast received:', payload);
        fetchGameState(roomId);
      })
      .on('broadcast', { event: 'match_ended' }, (payload) => {
        networkLogger.info('🏆 [Realtime] match_ended broadcast received:', payload);
        // broadcastMessage wraps data as { event, data: {...}, timestamp }
        // Access payload.data first, fall back to top-level for robustness
        const broadcastData = (payload as any)?.data || payload;
        const matchScores = broadcastData?.match_scores as PlayerMatchScoreDetail[];
        const matchNumber = broadcastData?.match_number || gameState?.match_number || 1;
        if (matchScores && onMatchEnded) {
          onMatchEnded(matchNumber, matchScores);
        }
        fetchGameState(roomId);
      })
      .on('broadcast', { event: 'auto_pass_timer_started' }, (payload) => {
        if (isValidTimerStatePayload(payload)) {
          setGameState(prevState => {
            if (!prevState) return prevState;
            return {
              ...prevState,
              auto_pass_timer: payload.timer_state,
            };
          });
        } else {
          networkLogger.warn('[Timer] Invalid timer payload');
        }
        fetchGameState(roomId);
      })
      .on('broadcast', { event: 'auto_pass_timer_cancelled' }, (_payload) => {
        setGameState(prevState => {
          if (!prevState) return prevState;
          return { ...prevState, auto_pass_timer: null };
        });
        fetchGameState(roomId);
      })
      .on('broadcast', { event: 'auto_pass_executed' }, (_payload) => {
        setGameState(prevState => {
          if (!prevState) return prevState;
          return { ...prevState, auto_pass_timer: null };
        });
        fetchGameState(roomId);
      });
    
    // Subscribe to database changes
    channel
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'rooms',
        filter: `id=eq.${roomId}`,
      }, (payload) => {
        setRoom(payload.new as Room);
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'game_state',
        filter: `room_id=eq.${roomId}`,
      }, (payload) => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          setGameState(payload.new as GameState);
        }
      })
      // ✅ FIX: Listen to room_players changes to catch is_host updates
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'room_players',
        filter: `room_id=eq.${roomId}`,
      }, async (payload) => {
        networkLogger.debug('[useRealtime] 👥 room_players change:', payload.eventType);
        await fetchPlayers(roomId);
      });
    
    // Subscribe and track presence - WAIT for subscription to complete
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Subscription timeout after 10s')), 10000);
      
      channel.subscribe(async (status) => {
        networkLogger.info('[useRealtime] 📡 joinChannel subscription status:', status);
        
        if (status === 'SUBSCRIBED') {
          clearTimeout(timeout);
          setIsConnected(true);
          networkLogger.info('[useRealtime] ✅ Channel subscribed successfully');
          
          // Track presence
          await channel.track({
            user_id: userId,
            username,
            online_at: new Date().toISOString(),
          });
          
          networkLogger.info('[useRealtime] ✅ Presence tracked, resolving joinChannel promise');
          resolve();
        } else if (status === 'CLOSED') {
          clearTimeout(timeout);
          setIsConnected(false);
          onDisconnect?.();
          reject(new Error('Channel closed'));
        } else if (status === 'CHANNEL_ERROR') {
          clearTimeout(timeout);
          reject(new Error('Channel error'));
        }
      });
    });
    
    channelRef.current = channel;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- gameState intentionally excluded from joinChannel; reading it inside the channel callbacks would capture a stale closure — gameState is read dynamically from the latest broadcast events instead
  }, [userId, username, onDisconnect, onMatchEnded, fetchPlayers, fetchGameState]); // reconnect intentionally omitted to avoid circular dependency

  // 🏠 Room lobby operations (extracted hook)
  const {
    createRoom,
    joinRoom,
    leaveRoom,
    setReady,
    startGame,
  } = useRoomLobby({
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
  });

  /**
   * Play cards — thin wrapper around executePlayCards (server Edge Function call)
   */
  const playCards = useCallback(async (cards: Card[], playerIndex?: number): Promise<void> => {
    if (!gameState) {
      throw new Error('Game state not loaded');
    }
    
    try {
      await executePlayCards({
        cards,
        playerIndex,
        gameState,
        currentPlayer,
        roomPlayers,
        room,
        broadcastMessage,
        onMatchEnded,
        setGameState,
      });
    } catch (err) {
      const error = err as Error;
      setError(error);
      // FIX: Skip onError for bot plays (playerIndex provided) — bot errors are handled
      // by BotCoordinator's own catch block.
      if (playerIndex === undefined) {
        onError?.(error);
      } else {
        gameLogger.warn('[useRealtime] ⚠️ Bot play error (suppressed from UI):', error.message);
      }
      throw error;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- room and onMatchEnded intentionally excluded
  }, [gameState, currentPlayer, roomPlayers, onError, broadcastMessage]);
  
  /**
   * Pass turn — thin wrapper around executePass (server Edge Function call)
   */
  const pass = useCallback(async (playerIndex?: number): Promise<void> => {
    if (!gameState) {
      throw new Error('Game state not loaded');
    }
    
    try {
      await executePass({
        playerIndex,
        gameState,
        currentPlayer,
        roomPlayers,
        room,
        isAutoPassInProgress,
        broadcastMessage,
        setGameState,
      });
    } catch (err) {
      const error = err as Error;
      setError(error);
      // FIX: Skip onError for bot passes (playerIndex provided) — same rationale as playCards.
      if (playerIndex === undefined) {
        onError?.(error);
      } else {
        gameLogger.warn('[useRealtime] ⚠️ Bot pass error (suppressed from UI):', error.message);
      }
      throw error;
    }
  }, [gameState, currentPlayer, roomPlayers, room, onError, broadcastMessage, isAutoPassInProgress]);

  /**
   * Reconnect to the room
   */
  const reconnect = useCallback(async (): Promise<void> => {
    if (!room || reconnectAttemptsRef.current >= maxReconnectAttempts) return;
    
    reconnectAttemptsRef.current++;
    
    try {
      await joinChannel(room.id);
      reconnectAttemptsRef.current = 0;
      onReconnect?.();
    } catch (err) {
      const error = err as Error;
      setError(error);
      onError?.(error);
      
      // Retry with exponential backoff
      setTimeout(() => reconnect(), Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, onError, onReconnect]); // joinChannel intentionally omitted to avoid circular dependency
  
  /**
   * Connect to an existing room (called when navigating from Lobby -> Game).
   * This is used when the room is already 'playing' and you just need to join the channel.
   */
  const connectToRoom = useCallback(async (code: string): Promise<void> => {
    networkLogger.info(`🚀 [connectToRoom] Connecting to: ${code}`);
    setLoading(true);
    setError(null);

    try {
      const normalizedCode = code.toUpperCase();
      
      // CRITICAL FIX: Use promise wrapper with aggressive timeout
      const queryPromise = (async () => {
        const result = await supabase
          .from('rooms')
          .select('*')
          .eq('code', normalizedCode)
          .single();
        return result;
      })();
      
      const timeoutPromise = new Promise<{ data: null; error: any }>((_, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('Room query timeout after 5 seconds'));
        }, 5000);
        queryPromise.finally(() => clearTimeout(timer));
      });
      
      const { data: existingRoom, error: roomError } = await Promise.race([
        queryPromise,
        timeoutPromise
      ]);

      if (roomError || !existingRoom) {
        throw new Error(roomError?.message || 'Room not found');
      }

      // Ensure the caller is already in the room
      const { data: membership, error: membershipError } = await supabase
        .from('room_players')
        .select('id')
        .eq('room_id', existingRoom.id)
        .eq('user_id', userId)
        .maybeSingle();

      if (membershipError) {
        throw membershipError;
      }
      if (!membership) {
        throw new Error('You are not a member of this room');
      }

      setRoom(existingRoom);

      // CRITICAL FIX: Fetch data BEFORE joining channel
      try {
        await fetchPlayers(existingRoom.id);
      } catch (error) {
        networkLogger.warn('[connectToRoom] Retrying fetch players...', error);
        await new Promise(resolve => setTimeout(resolve, 500));
        await fetchPlayers(existingRoom.id);
      }
      
      try {
        await fetchGameState(existingRoom.id);
      } catch (error) {
        networkLogger.warn('[connectToRoom] Retrying fetch state...', error);
        await new Promise(resolve => setTimeout(resolve, 500));
        await fetchGameState(existingRoom.id);
      }
      
      // Join channel AFTER initial data is loaded
      await joinChannel(existingRoom.id);
      
      networkLogger.info(`✅ [connectToRoom] Connected to ${code}`);
    } catch (err) {
      const error = err as Error;
      networkLogger.error(`❌ [connectToRoom] Failed:`, error.message);
      setError(error);
      onError?.(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [userId, onError, joinChannel, fetchPlayers, fetchGameState]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (channelRef.current) {
        channelRef.current.unsubscribe();
        supabase.removeChannel(channelRef.current);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps -- timerIntervalRef.current is a plain mutable ref (not a DOM ref)
      if (timerIntervalRef.current) {
        // eslint-disable-next-line react-hooks/exhaustive-deps -- same ref, same reason
        clearInterval(timerIntervalRef.current);
      }
    };
  }, []);

  return {
    room,
    players: roomPlayers, // Expose as 'players' for backward compatibility
    gameState,
    playerHands,
    isConnected,
    isHost,
    isDataReady, // BULLETPROOF: Indicates game state is fully loaded and ready
    currentPlayer,
    createRoom,
    joinRoom,
    connectToRoom,
    leaveRoom,
    setReady,
    startGame,
    playCards,
    pass,
    reconnect,
    loading,
    error,
  };
}
