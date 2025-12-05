/**
 * useRealtime - Real-time multiplayer game hook with Supabase Realtime
 * 
 * Features:
 * - Room creation and joining with unique codes
 * - Real-time player presence tracking via room_players table
 * - Game state synchronization across all clients
 * - Turn-based logic with optimistic updates
 * - Automatic reconnection handling
 * - 4-player multiplayer support
 * 
 * NOTE: This hook uses the `room_players` table for lobby management.
 * The `players` table is used only by Edge Functions for game logic.
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
  ComboType,
  UseRealtimeReturn,
  BroadcastEvent,
  BroadcastPayload,
  PlayerPresence,
} from '../types/multiplayer';

interface UseRealtimeOptions {
  userId: string;
  username: string;
  onError?: (error: Error) => void;
  onDisconnect?: () => void;
  onReconnect?: () => void;
}

export type { UseRealtimeOptions };

/**
 * Determines the type of 5-card combination in Big Two (e.g., straight, flush, full house, four of a kind, straight flush).
 *
 * @param {Card[]} cards - An array of exactly 5 Card objects. Each card should have a `rank` and `suit` property.
 * @returns {ComboType} The type of 5-card combo: 'straight', 'flush', 'full_house', 'four_of_a_kind', or 'straight_flush'.
 * @throws {Error} If the input array does not contain exactly 5 cards, or if the cards do not form a valid 5-card combination.
 *
 * Logic:
 * - Sorts cards by rank value.
 * - Checks for flush (all cards of the same suit).
 * - Checks for straight (consecutive ranks following Big Two rules).
 * - Counts rank frequencies to identify four of a kind and full house.
 * - Returns the appropriate ComboType based on Big Two rules:
 *   - 'straight_flush': both straight and flush.
 *   - 'four_of_a_kind': four cards of the same rank.
 *   - 'full_house': three cards of one rank and two of another.
 *   - 'flush': all cards of the same suit.
 *   - 'straight': five consecutive ranks.
 *   - Throws error if none of the above.
 */
function determine5CardCombo(cards: Card[]): ComboType {
  if (cards.length !== 5) {
    throw new Error('determine5CardCombo expects exactly 5 cards');
  }

  // Sort cards by rank value for easier analysis
  const rankValues: Record<string, number> = {
    '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
    'J': 11, 'Q': 12, 'K': 13, 'A': 14, '2': 15
  };
  
  const sortedCards = [...cards].sort((a, b) => rankValues[a.rank] - rankValues[b.rank]);
  
  // Check for flush (all same suit)
  const isFlush = sortedCards.every(card => card.suit === sortedCards[0].suit);
  
  // All valid Big Two straight sequences
  // Note: A-2-3-4-5 and 2-3-4-5-6 are valid wraparounds (A or 2 acting as low card)
  // But sequences like J-Q-K-A-2, Q-K-A-2-3, K-A-2-3-4 are INVALID (2 cannot be high in a straight)
  const VALID_STRAIGHT_SEQUENCES: string[][] = [
    ['3', '4', '5', '6', '7'],
    ['4', '5', '6', '7', '8'],
    ['5', '6', '7', '8', '9'],
    ['6', '7', '8', '9', '10'],
    ['7', '8', '9', '10', 'J'],
    ['8', '9', '10', 'J', 'Q'],
    ['9', '10', 'J', 'Q', 'K'],
    ['10', 'J', 'Q', 'K', 'A'],
    ['A', '2', '3', '4', '5'],  // Wraparound: Ace acts as low
    ['2', '3', '4', '5', '6'],  // Wraparound: 2 acts as low
  ];
  
  // Check for straight (Big Two rules)
  // For wraparound sequences (A-2-3-4-5 and 2-3-4-5-6), sorting breaks the pattern
  // So we need to check against both sorted and original rank orders
  const handRanks = sortedCards.map(card => card.rank);
  const originalHandRanks = cards.map(card => card.rank);
  
  let isStraight = VALID_STRAIGHT_SEQUENCES.some(seq =>
    seq.every((rank, idx) => rank === handRanks[idx])
  );
  
  // Explicitly check for wraparound straights in original order
  // These patterns won't match after sorting due to high rank values of A and 2
  if (!isStraight) {
    // Check A-2-3-4-5 pattern
    const a2345Pattern: string[] = ['A', '2', '3', '4', '5'];
    // Check 2-3-4-5-6 pattern  
    const t23456Pattern: string[] = ['2', '3', '4', '5', '6'];
    
    // Create a set of original ranks for order-independent matching
    const rankSet = new Set<string>(originalHandRanks);
    
    if (a2345Pattern.every(rank => rankSet.has(rank)) ||
        t23456Pattern.every(rank => rankSet.has(rank))) {
      isStraight = true;
    }
  }
  
  // Count rank frequencies
  const rankCounts = sortedCards.reduce((acc, card) => {
    acc[card.rank] = (acc[card.rank] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  const counts = Object.values(rankCounts).sort((a, b) => b - a);
  
  // Determine combo type
  if (isFlush && isStraight) {
    return 'straight_flush';
  } else if (counts[0] === 4) {
    return 'four_of_a_kind';
  } else if (counts[0] === 3 && counts[1] === 2) {
    return 'full_house';
  } else if (isFlush) {
    return 'flush';
  } else if (isStraight) {
    return 'straight';
  } else {
    throw new Error('Invalid 5-card combination');
  }
}

export function useRealtime(options: UseRealtimeOptions): UseRealtimeReturn {
  const { userId, username, onError, onDisconnect, onReconnect } = options;
  
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
  
  // Computed values
  const currentPlayer = roomPlayers.find(p => p.user_id === userId) || null;
  const isHost = currentPlayer?.is_host || false;
  
  /**
   * Generate a unique 6-character room code
   */
  const generateRoomCode = (): string => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  };
  
  /**
   * Broadcast message to all room players in the lobby
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
  
  /**
   * Create a new game room
   */
  const createRoom = useCallback(async (): Promise<Room> => {
    setLoading(true);
    setError(null);
    
    try {
      const code = generateRoomCode();
      
      // Create room in database
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
      
      // Create player record
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
      
      // Join the realtime channel
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
  }, [userId, username, onError]);
  
  /**
   * Join an existing room by code
   */
  const joinRoom = useCallback(async (code: string): Promise<void> => {
    setLoading(true);
    setError(null);
    
    try {
      // Find room by code
      const { data: existingRoom, error: roomError } = await supabase
        .from('rooms')
        .select('*')
        .eq('code', code.toUpperCase())
        .eq('status', 'waiting')
        .single();
      
      if (roomError) throw new Error('Room not found or already started');
      
      // Check player count
      const { count } = await supabase
        .from('room_players')
        .select('*', { count: 'exact', head: true })
        .eq('room_id', existingRoom.id);
      
      if (count && count >= existingRoom.max_players) {
        throw new Error('Room is full');
      }
      
      // Determine next available player_index
      const { data: existingPlayers } = await supabase
        .from('room_players')
        .select('player_index')
        .eq('room_id', existingRoom.id)
        .order('player_index');
      
      const takenPositions = new Set(existingPlayers?.map(p => p.player_index) || []);
      let player_index = 0;
      while (takenPositions.has(player_index) && player_index < 4) player_index++;
      
      // Create player record
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
      
      // Join the realtime channel
      await joinChannel(existingRoom.id);
      
      // Broadcast join event
      await broadcastMessage('player_joined', { user_id: userId, username, player_index });
    } catch (err) {
      const error = err as Error;
      setError(error);
      onError?.(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [userId, username, onError, broadcastMessage]);
  
  /**
   * Leave the current room
   */
  const leaveRoom = useCallback(async (): Promise<void> => {
    if (!room || !currentPlayer) return;
    
    try {
      // Delete player from room
      await supabase
        .from('room_players')
        .delete()
        .eq('id', currentPlayer.id);
      
      // Broadcast leave event
      await broadcastMessage('player_left', { user_id: userId, player_index: currentPlayer.player_index });
      
      // Unsubscribe from channel
      if (channelRef.current) {
        await channelRef.current.unsubscribe();
        await supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      
      // Clear state
      setRoom(null);
      setPlayers([]);
      setGameState(null);
      setPlayerHands(new Map());
      setIsConnected(false);
    } catch (err) {
      const error = err as Error;
      setError(error);
      onError?.(error);
    }
  }, [room, currentPlayer, userId, onError, broadcastMessage]);
  
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
    } catch (err) {
      const error = err as Error;
      setError(error);
      onError?.(error);
    }
  }, [currentPlayer, userId, onError, broadcastMessage]);
  
  /**
   * Start the game (host only)
   */
  const startGame = useCallback(async (): Promise<void> => {
    if (!isHost || !room) return;
    
    // Check if all room players are ready
    const allReady = roomPlayers.every(p => p.is_ready);
    if (!allReady) {
      throw new Error('All players must be ready');
    }
    
    if (roomPlayers.length < 2) {
      throw new Error('Need at least 2 players to start');
    }
    
    try {
      // Update room status
      await supabase
        .from('rooms')
        .update({ status: 'playing' })
        .eq('id', room.id);
      
      // Create initial game state
      const { data: newGameState, error: gameError } = await supabase
        .from('game_state')
        .insert({
          room_id: room.id,
          current_turn: 0,
          turn_timer: 30,
          last_play: null,
          pass_count: 0,
          game_phase: 'dealing',
        })
        .select()
        .single();
      
      if (gameError) throw gameError;
      
      await broadcastMessage('game_started', { game_state: newGameState });
    } catch (err) {
      const error = err as Error;
      setError(error);
      onError?.(error);
      throw error;
    }
  }, [isHost, room, roomPlayers, onError, broadcastMessage]);
  
  /**
   * Play cards
   */
  const playCards = useCallback(async (cards: Card[]): Promise<void> => {
    if (!gameState || !currentPlayer || gameState.current_turn !== currentPlayer.player_index) {
      throw new Error('Not your turn');
    }
    
    try {
      // Validate cards array is not empty
      if (cards.length === 0) {
        throw new Error('Cannot play an empty hand');
      }
      
      // Determine combo type based on card count
      let comboType: ComboType;
      switch (cards.length) {
        case 1:
          comboType = 'single';
          break;
        case 2:
          // Validate that both cards have the same rank
          if (cards[0].rank !== cards[1].rank) {
            throw new Error('Invalid pair: cards must have matching ranks');
          }
          comboType = 'pair';
          break;
        case 3:
          // Validate that all three cards have the same rank
          if (cards[0].rank !== cards[1].rank || cards[0].rank !== cards[2].rank) {
            throw new Error('Invalid triple: all cards must have matching ranks');
          }
          comboType = 'triple';
          break;
        case 5:
          // Determine 5-card combo type by checking card properties
          comboType = determine5CardCombo(cards);
          break;
        default:
          throw new Error('Invalid card combination');
      }
      
      // Update game state
      const { error: updateError } = await supabase
        .from('game_state')
        .update({
          last_play: {
            position: currentPlayer.player_index,
            cards,
            combo_type: comboType,
          },
          pass_count: 0,
          current_turn: (currentPlayer.player_index + 1) % roomPlayers.length,
        })
        .eq('id', gameState.id);
      
      if (updateError) throw updateError;
      
      await broadcastMessage('cards_played', {
        player_index: currentPlayer.player_index,
        cards,
        combo_type: comboType,
      });
    } catch (err) {
      const error = err as Error;
      setError(error);
      onError?.(error);
      throw error;
    }
  }, [gameState, currentPlayer, roomPlayers, onError, broadcastMessage]);
  
  /**
   * Pass turn
   */
  const pass = useCallback(async (): Promise<void> => {
    if (!gameState || !currentPlayer || gameState.current_turn !== currentPlayer.player_index) {
      throw new Error('Not your turn');
    }
    
    try {
      const newPassCount = gameState.pass_count + 1;
      
      // If all other room players passed, clear the table
      const clearTable = newPassCount >= roomPlayers.length - 1;
      
      await supabase
        .from('game_state')
        .update({
          pass_count: clearTable ? 0 : newPassCount,
          last_play: clearTable ? null : gameState.last_play,
          current_turn: (currentPlayer.player_index + 1) % roomPlayers.length,
        })
        .eq('id', gameState.id);
      
      await broadcastMessage('player_passed', { player_index: currentPlayer.player_index });
    } catch (err) {
      const error = err as Error;
      setError(error);
      onError?.(error);
      throw error;
    }
  }, [gameState, currentPlayer, roomPlayers, onError, broadcastMessage]);
  
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
  }, [room, onError, onReconnect]);
  
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
    
    // Subscribe to presence events
    channel
      .on('presence', { event: 'sync' }, () => {
        const presenceState = channel.presenceState<PlayerPresence>();
        console.log('Presence sync:', presenceState);
      })
      .on('presence', { event: 'join' }, ({ key, newPresences }) => {
        console.log('Player joined presence:', key, newPresences);
      })
      .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
        console.log('Player left presence:', key, leftPresences);
      });
    
    // Subscribe to broadcast events
    channel
      .on('broadcast', { event: 'player_joined' }, (payload) => {
        fetchPlayers(roomId);
      })
      .on('broadcast', { event: 'player_left' }, (payload) => {
        fetchPlayers(roomId);
      })
      .on('broadcast', { event: 'player_ready' }, (payload) => {
        fetchPlayers(roomId);
      })
      .on('broadcast', { event: 'game_started' }, (payload) => {
        fetchGameState(roomId);
      })
      .on('broadcast', { event: 'cards_played' }, (payload) => {
        fetchGameState(roomId);
      })
      .on('broadcast', { event: 'player_passed' }, (payload) => {
        fetchGameState(roomId);
      })
      .on('broadcast', { event: 'game_ended' }, (payload) => {
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
      });
    
    // Subscribe and track presence
    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        setIsConnected(true);
        
        // Track presence
        await channel.track({
          user_id: userId,
          username,
          online_at: new Date().toISOString(),
        });
        
        // Load initial data
        await fetchPlayers(roomId);
        await fetchGameState(roomId);
      } else if (status === 'CLOSED') {
        setIsConnected(false);
        onDisconnect?.();
        reconnect();
      }
    });
    
    channelRef.current = channel;
  }, [userId, username, onDisconnect, reconnect]);
  
  /**
   * Fetch all room players from room_players table
   */
  const fetchPlayers = useCallback(async (roomId: string) => {
    const { data, error } = await supabase
      .from('room_players')
      .select('*')
      .eq('room_id', roomId)
      .order('player_index');
    
    if (!error && data) {
      setRoomPlayers(data);
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
    
    if (!error && data) {
      setGameState(data);
    }
  }, []);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (channelRef.current) {
        channelRef.current.unsubscribe();
        supabase.removeChannel(channelRef.current);
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
    currentPlayer,
    createRoom,
    joinRoom,
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
