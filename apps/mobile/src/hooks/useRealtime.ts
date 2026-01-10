/**
 * useRealtime - Real-time multiplayer game hook with Supabase Realtime
 * 
 * Features:
 * - Room creation and joining with unique codes
 * - Real-time player presence tracking via Supabase Presence (ephemeral online/offline status)
 * - Game state synchronization across all clients
 * - Turn-based logic with optimistic updates
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
import { notifyGameStarted, notifyPlayerTurn, notifyAllPlayersReady } from '../services/pushNotificationTriggers';
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
  AutoPassTimerState,
} from '../types/multiplayer';
import { networkLogger, gameLogger } from '../utils/logger';
import { canBeatPlay } from '../game/engine/game-logic';

/**
 * Extract detailed error message from Supabase Edge Function response
 * When an Edge Function returns a non-2xx status, the actual error details
 * are in error.context, not just error.message
 */
function extractEdgeFunctionError(error: any, result: any, fallback: string): string {
  // Priority 1: Check if result has error field (from Edge Function response body)
  if (result?.error) {
    return result.error;
  }
  
  // Priority 2: Check error.context.status for HTTP status code
  if (error?.context?.status) {
    const status = error.context.status;
    const statusText = error.context.statusText || '';
    return `HTTP ${status}${statusText ? ': ' + statusText : ''}`;
  }
  
  // Priority 3: Use error.message (usually "Edge Function returned a non-2xx status code")
  if (error?.message && error.message !== 'Edge Function returned a non-2xx status code') {
    return error.message;
  }
  
  // Fallback
  return fallback;
}

/**
 * Get server time from Supabase for clock synchronization
 * CRITICAL: This ensures all clients use the same time reference
 */
async function getServerTimeMs(): Promise<number> {
  try {
    const { data, error } = await supabase.functions.invoke('server-time', {
      body: {},
    });
    if (error || !data?.timestamp) {
      networkLogger.error('[Clock Sync] Failed to get server time:', error);
      // Fallback to local time if server call fails
      return Date.now();
    }
    return Number(data.timestamp);
  } catch (err) {
    networkLogger.error('[Clock Sync] Exception getting server time:', err);
    return Date.now();
  }
}

interface UseRealtimeOptions {
  userId: string;
  username: string;
  onError?: (error: Error) => void;
  onDisconnect?: () => void;
  onReconnect?: () => void;
  onMatchEnded?: (matchNumber: number, matchScores: PlayerMatchScoreDetail[]) => void;
}

export type { UseRealtimeOptions };

// ============================================================================
// MATCH SCORING SYSTEM (Phase 1 - ported from local game)
// ============================================================================

interface PlayerMatchScoreDetail {
  player_index: number;
  cardsRemaining: number;
  pointsPerCard: number;
  matchScore: number;
  cumulativeScore: number;
}

/**
 * Calculate score for a single player based on cards remaining
 * Scoring rules:
 * - 1-4 cards: 1 point per card
 * - 5-9 cards: 2 points per card
 * - 10-13 cards: 3 points per card
 * - Winner (0 cards): 0 points
 */
function calculatePlayerMatchScore(
  cardsRemaining: number,
  currentScore: number
): PlayerMatchScoreDetail {
  let pointsPerCard: number;
  
  if (cardsRemaining >= 1 && cardsRemaining <= 4) {
    pointsPerCard = 1;
  } else if (cardsRemaining >= 5 && cardsRemaining <= 9) {
    pointsPerCard = 2;
  } else if (cardsRemaining >= 10 && cardsRemaining <= 13) {
    pointsPerCard = 3;
  } else {
    pointsPerCard = 0; // Winner or invalid
  }
  
  const matchScore = cardsRemaining * pointsPerCard;
  const cumulativeScore = currentScore + matchScore;
  
  return {
    player_index: -1, // Will be set by caller
    cardsRemaining,
    pointsPerCard,
    matchScore,
    cumulativeScore,
  };
}

/**
 * Check if game should end (any player >= 101 points)
 */
function shouldGameEnd(scores: PlayerMatchScoreDetail[]): boolean {
  return scores.some(score => score.cumulativeScore >= 101);
}

/**
 * Find final winner (player with lowest cumulative score)
 */
function findFinalWinner(scores: PlayerMatchScoreDetail[]): number {
  let lowestScore = Infinity;
  let winnerIndex = scores[0].player_index;
  
  scores.forEach(score => {
    if (score.cumulativeScore < lowestScore) {
      lowestScore = score.cumulativeScore;
      winnerIndex = score.player_index;
    }
  });
  
  return winnerIndex;
}

/**
 * Determines the type of 5-card combination in Big Two (e.g., Straight, Flush, Full House, Four of a Kind, Straight Flush).
 *
 * @param {Card[]} cards - An array of exactly 5 Card objects. Each card should have a `rank` and `suit` property.
 * @returns {ComboType} The type of 5-card combo: 'Straight', 'Flush', 'Full House', 'Four of a Kind', or 'Straight Flush'.
 * @throws {Error} If the input array does not contain exactly 5 cards, or if the cards do not form a valid 5-card combination.
 *
 * Logic:
 * - Sorts cards by rank value.
 * - Checks for flush (all cards of the same suit).
 * - Checks for straight (consecutive ranks following Big Two rules).
 * - Counts rank frequencies to identify four of a kind and full house.
 * - Returns the appropriate ComboType based on Big Two rules:
 *   - 'Straight Flush': both straight and flush.
 *   - 'Four of a Kind': four cards of the same rank.
 *   - 'Full House': three cards of one rank and two of another.
 *   - 'Flush': all cards of the same suit.
 *   - 'Straight': five consecutive ranks.
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
    return 'Straight Flush';
  } else if (counts[0] === 4) {
    return 'Four of a Kind';
  } else if (counts[0] === 3 && counts[1] === 2) {
    return 'Full House';
  } else if (isFlush) {
    return 'Flush';
  } else if (isStraight) {
    return 'Straight';
  } else {
    throw new Error('Invalid 5-card combination');
  }
}

/**
 * Type guard to validate auto-pass timer broadcast payload
 */
function isValidTimerStatePayload(
  payload: unknown
): payload is { timer_state: AutoPassTimerState } {
  if (typeof payload !== 'object' || payload === null || !('timer_state' in payload)) {
    return false;
  }
  
  const timerState = (payload as { timer_state: unknown }).timer_state;
  
  if (typeof timerState !== 'object' || timerState === null) {
    return false;
  }
  
  const state = timerState as Record<string, unknown>;
  
  // Validate basic timer fields
  if (
    typeof state.active !== 'boolean' ||
    typeof state.started_at !== 'string' ||
    typeof state.duration_ms !== 'number' ||
    typeof state.remaining_ms !== 'number'
  ) {
    return false;
  }
  
  // Validate triggering_play structure
  const triggeringPlay = state.triggering_play;
  if (typeof triggeringPlay !== 'object' || triggeringPlay === null) {
    return false;
  }
  
  const play = triggeringPlay as Record<string, unknown>;
  return (
    typeof play.position === 'number' &&
    Array.isArray(play.cards) &&
    typeof play.combo_type === 'string'
  );
}

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
  
  // 🔥 CRITICAL: Track active timer interval to prevent duplicates
  const activeTimerInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentTimerId = useRef<string | null>(null);
  const maxReconnectAttempts = 5;
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  // Computed values
  const currentPlayer = roomPlayers.find(p => p.user_id === userId) || null;
  const isHost = currentPlayer?.is_host === true;
  
  // BULLETPROOF: Data ready check - ensures game state is fully loaded with valid data
  // Returns true ONLY when:
  // 1. Not currently loading
  // 2. Game state exists
  // 3. Game state has hands object
  // 4. Hands object has at least one player's hand
  // 5. Players array is populated
  const isDataReady = !loading && 
    !!gameState && 
    !!gameState.hands && 
    Object.keys(gameState.hands).length > 0 && 
    roomPlayers.length > 0;
  
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
      setRoomPlayers([]);
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
      
      // Check if all players are now ready and notify host
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
  }, [currentPlayer, userId, onError, broadcastMessage, room, roomPlayers]);
  
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
      // ✅ CRITICAL FIX: Use start_game_with_bots RPC to ensure consistent turn order
      // This RPC correctly finds the player with 3♦ and sets them as starting player.
      // Uses anticlockwise turn order (indices [3,2,0,1] → sequence depends on starting player).
      const botCount = Math.max(0, 4 - roomPlayers.length);
      const { data: startResult, error: startError } = await supabase.rpc('start_game_with_bots', {
        p_room_id: room.id,
        p_bot_count: botCount,
        p_bot_difficulty: 'medium',
      });

      if (startError || !startResult?.success) {
        throw new Error(startError?.message || startResult?.error || 'Failed to start game');
      }

      // ✅ CRITICAL: Validate RPC returned valid game state
      const gameState = (startResult as any).game_state ?? startResult;
      if (!gameState || !gameState.room_id) {
        throw new Error('Failed to start game: missing game state from RPC result');
      }

      // CRITICAL FIX: Send push notifications AFTER RPC success (prevents notifications for failed games)
      // Use fire-and-forget pattern with error logging only
      notifyGameStarted(room.id, room.code).catch(err => 
        networkLogger.error('❌ Failed to send game start notifications:', err)
      );

      // Game state is created by RPC with correct starting player (who has 3♦)
      // Broadcast ONLY metadata - clients will fetch game state via realtime subscription
      // This prevents broadcasting stale/incorrect game state structure
      await broadcastMessage('game_started', { success: true, roomId: room.id });
    } catch (err) {
      const error = err as Error;
      setError(error);
      onError?.(error);
      throw error;
    }
  }, [isHost, room, roomPlayers, onError, broadcastMessage]);
  
  /**
   * ✅ Phase 2: Play cards using server-side Edge Function
   * @param cards - Cards to play
   * @param playerIndex - Optional: Specify player index for bot coordinator
   */
  const playCards = useCallback(async (cards: Card[], playerIndex?: number): Promise<void> => {
    const effectivePlayerIndex = playerIndex ?? currentPlayer?.player_index;
    
    // Validate game state exists
    if (!gameState) {
      throw new Error('Game state not loaded');
    }
    
    // Basic turn validation before calling server
    if (playerIndex === undefined) {
      if (!currentPlayer) {
        throw new Error('Player not found');
      }
      if (gameState.current_turn !== currentPlayer.player_index) {
        throw new Error('Not your turn');
      }
    } else {
      if (gameState.current_turn !== playerIndex) {
        throw new Error(`Not player ${playerIndex}'s turn (current turn: ${gameState.current_turn})`);
      }
    }
    
    try {
      if (cards.length === 0) {
        throw new Error('Cannot play an empty hand');
      }

      // Get current hands to check for match end locally (for UI responsiveness)
      const currentHands = gameState.hands || {};
      const myHandKey = String(effectivePlayerIndex);
      const myHand = currentHands[myHandKey as unknown as number] || [];
      const cardIdsToRemove = new Set(cards.map(c => c.id));
      const cardsRemainingAfterPlay = myHand.filter((c: Card) => !cardIdsToRemove.has(c.id)).length;
      // matchWillEnd is now determined by server response (result.match_ended)

      // 📡 CRITICAL: Call Edge Function for server-side validation
      // When playerIndex is provided (bot coordinator), find the bot's player_id
      const playingPlayer = playerIndex !== undefined
        ? roomPlayers.find(p => p.player_index === playerIndex)
        : currentPlayer;
      
      if (!playingPlayer) {
        throw new Error(`Player with index ${playerIndex} not found`);
      }
      
      gameLogger.info('[useRealtime] 📡 Calling play-cards Edge Function...', {
        player_id: playingPlayer.user_id,
        player_index: effectivePlayerIndex,
        is_bot: playerIndex !== undefined,
      });
      
      const { data: result, error: playError } = await supabase.functions.invoke('play-cards', {
        body: {
          room_code: room!.code,
          player_id: playingPlayer.user_id, // ✅ FIX: Use bot's user_id (not record id)
          cards: cards.map(c => ({
            id: c.id,
            rank: c.rank,
            suit: c.suit
          }))
        }
      });

      if (playError || !result?.success) {
        const errorMessage = extractEdgeFunctionError(playError, result, 'Server validation failed');
        const debugInfo = result?.debug ? JSON.stringify(result.debug) : 'No debug info';
        const statusCode = playError?.context?.status || 'unknown';
        
        gameLogger.error('[useRealtime] ❌ Server validation failed:', {
          message: errorMessage,
          status: statusCode,
          debug: debugInfo,
        });
        gameLogger.error('[useRealtime] 📦 Full error context:', {
          error: playError,
          result: result,
        });
        
        throw new Error(errorMessage);
      }

      gameLogger.info('[useRealtime] ✅ Server validation passed:', result);

      // PHASE 1: Handle match end (use server-calculated scores)
      const matchWillEnd = result.match_ended || false;
      let matchScores: PlayerMatchScoreDetail[] | null = null;
      let gameOver = false;
      let finalWinnerIndex: number | null = null;

      if (matchWillEnd && result.match_scores) {
        gameLogger.info('[useRealtime] 🏁 Match ended! Using server-calculated scores');
        
        // Server has already calculated scores and updated room_players
        matchScores = result.match_scores;
        gameOver = result.game_over || false;
        finalWinnerIndex = result.final_winner_index !== undefined ? result.final_winner_index : null;

        gameLogger.info('[useRealtime] 📊 Server scores:', {
          matchScores,
          gameOver,
          finalWinnerIndex,
        });
      }

      // PHASE 2: Append to play_history
      const currentPlayHistory = (gameState as any).play_history || [];
      const currentMatchNumber = (gameState as any).match_number || 1;
      const comboType = result.combo_type;
      const updatedPlayHistory = [
        ...currentPlayHistory,
        {
          match_number: currentMatchNumber,
          position: effectivePlayerIndex,
          cards,
          combo_type: comboType,
          passed: false,
        },
      ];

      // PHASE 3: Use auto-pass timer from server response
      // Server now detects highest play and creates timer
      const autoPassTimerState = result.auto_pass_timer || null;
      const isHighestPlay = result.highest_play_detected || false;

      gameLogger.info('[useRealtime] ⏰ Server timer state:', {
        isHighestPlay,
        timerState: autoPassTimerState,
      });

      // ✅ PHASE 2 FIX: Server already updated game_state (hands, last_play, current_turn, auto_pass_timer)
      // Client should NOT update game_state - only update play_history if needed
      // Note: play_history is cosmetic and not critical for game logic
      if (updatedPlayHistory.length > 0) {
        const { error: historyError } = await supabase
          .from('game_state')
          .update({
            play_history: updatedPlayHistory,
          })
          .eq('id', gameState.id);

        if (historyError) {
          // Non-fatal: play_history is cosmetic
          gameLogger.warn('[useRealtime] ⚠️ Failed to update play_history (non-fatal):', historyError);
        } else {
          gameLogger.info('[useRealtime] ✅ Play history updated');
        }
      }

      // Broadcast cards played
      await broadcastMessage('cards_played', {
        player_index: effectivePlayerIndex,
        cards,
        combo_type: comboType,
      });

      // Broadcast auto-pass timer if highest play
      if (isHighestPlay && autoPassTimerState) {
        try {
          await broadcastMessage('auto_pass_timer_started', {
            timer_state: autoPassTimerState,
            triggering_player_index: effectivePlayerIndex,
          });
          gameLogger.info('[useRealtime] ⏰ Auto-pass timer broadcasted:', autoPassTimerState);
        } catch (timerBroadcastError) {
          gameLogger.error('[useRealtime] ⚠️ Auto-pass timer broadcast failed (non-fatal):', timerBroadcastError);
        }
      }

      // Wait for Realtime sync
      gameLogger.info('[useRealtime] ⏳ Waiting 300ms for Realtime sync...');
      await new Promise(resolve => setTimeout(resolve, 300));

      // Broadcast match end or game over
      if (matchWillEnd && matchScores) {
        if (gameOver && finalWinnerIndex !== null) {
          await broadcastMessage('game_over', {
            winner_index: finalWinnerIndex,
            final_scores: matchScores,
          });
          gameLogger.info('[useRealtime] 📡 Broadcast: GAME OVER');
        } else {
          await broadcastMessage('match_ended', {
            winner_index: effectivePlayerIndex,
            match_number: currentMatchNumber,
            match_scores: matchScores,
          });
          gameLogger.info('[useRealtime] 📡 Broadcast: MATCH ENDED');

          if (onMatchEnded) {
            gameLogger.info('[useRealtime] 📊 Calling onMatchEnded callback directly');
            onMatchEnded(currentMatchNumber, matchScores);
          }

          // Start next match (fire-and-forget to prevent bot coordinator interference)
          // CRITICAL FIX: Use IIFE so bot actions during transition don't interrupt match start
          (async () => {
            try {
              gameLogger.info('[useRealtime] 🔄 Starting next match in 2 seconds...');
              await new Promise(resolve => setTimeout(resolve, 2000));

              gameLogger.info('[useRealtime] 🎴 Calling start_new_match edge function...');
              const { data: newMatchData, error: newMatchError } = await supabase.functions.invoke('start_new_match', {
                body: { room_id: room!.id },
              });

              if (newMatchError) {
                gameLogger.error('[useRealtime] ❌ Failed to start new match:', newMatchError);
              } else {
                gameLogger.info('[useRealtime] ✅ New match started successfully:', newMatchData);
                await broadcastMessage('new_match_started', {
                  match_number: newMatchData.match_number,
                  starting_player_index: newMatchData.starting_player_index,
                });
              }
            } catch (matchStartError) {
              gameLogger.error('[useRealtime] 💥 Match start failed (non-fatal):', matchStartError);
            }
          })().catch((unhandledError) => {
            // Ensure any unexpected rejection from the match start flow is logged
            gameLogger.error('[useRealtime] 💥 Unhandled error in match start flow:', unhandledError);
          }); // Fire-and-forget: don't await (but handle rejections)
        }
      }

      // DISABLED: Turn notifications are too spammy
      // const nextPlayerIndex = result.next_turn;
      // const nextPlayer = roomPlayers[nextPlayerIndex];
      // if (nextPlayer && !nextPlayer.is_bot && nextPlayer.user_id && room) {
      //   notifyPlayerTurn(nextPlayer.user_id, room.code, room.id, nextPlayer.username).catch(err =>
      //     console.error('Failed to send turn notification:', err)
      //   );
      // }
      
      // If there was an active timer, broadcast cancellation
      // 🎯 PERFORMANCE FIX: Non-blocking cancellation - don't await, timer cancellation is cosmetic
      const hadPreviousTimer = gameState.auto_pass_timer !== null && gameState.auto_pass_timer !== undefined;
      if (hadPreviousTimer) {
        broadcastMessage('auto_pass_timer_cancelled', {
          player_index: effectivePlayerIndex,
          reason: 'new_play' as const,
        }).catch((cancelError) => {
          gameLogger.warn('[useRealtime] ⚠️ Timer cancellation broadcast failed (non-fatal):', cancelError);
        });
      }
    } catch (err) {
      const error = err as Error;
      setError(error);
      onError?.(error);
      throw error;
    }
  }, [gameState, currentPlayer, roomPlayers, onError, broadcastMessage]);
  
  /**
   * Pass turn
   * @param playerIndex - Optional player index for bot moves (when host plays on behalf of bot)
   */
  const pass = useCallback(async (playerIndex?: number): Promise<void> => {
    // Determine which player is passing
    const passingPlayer = playerIndex !== undefined 
      ? roomPlayers.find(p => p.player_index === playerIndex)
      : currentPlayer;
    
    if (!gameState || !passingPlayer || gameState.current_turn !== passingPlayer.player_index) {
      throw new Error('Not your turn');
    }
    
    if (!room?.code) {
      throw new Error('Room code not available');
    }
    
    try {
      gameLogger.info('[useRealtime] 📡 Calling player-pass Edge Function...', {
        player_id: passingPlayer.user_id,
        player_index: passingPlayer.player_index,
        is_bot: playerIndex !== undefined,
      });

      // ✅ UNIFIED ARCHITECTURE: Use Edge Function (matches play-cards pattern)
      // This ensures consistent state management and preserves auto_pass_timer
      const { data: result, error: passError } = await supabase.functions.invoke('player-pass', {
        body: {
          room_code: room.code,
          player_id: passingPlayer.user_id, // ✅ Use user_id (consistent with play-cards)
        }
      });

      if (passError || !result?.success) {
        const errorMessage = extractEdgeFunctionError(passError, result, 'Pass validation failed');
        const statusCode = passError?.context?.status || 'unknown';
        
        gameLogger.error('[useRealtime] ❌ Pass failed:', {
          message: errorMessage,
          status: statusCode,
          fullError: passError,
          result: result,
        });
        
        throw new Error(errorMessage);
      }

      gameLogger.info('[useRealtime] ✅ Pass successful:', {
        next_turn: result.next_turn,
        passes: result.passes, // DB column and response field are both 'passes' (previously 'pass_count', renamed for consistency)
        trick_cleared: result.trick_cleared,
        timer_preserved: !!result.auto_pass_timer,
      });
      
      // Broadcast manual pass event
      await broadcastMessage('player_passed', { player_index: passingPlayer.player_index });
      
      // CRITICAL: Wait for Realtime to propagate before bot coordinator checks turn
      gameLogger.info('[useRealtime] ⏳ Waiting 300ms for Realtime sync after pass...');
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // DISABLED: Turn notifications are too spammy
      // const nextPlayerIndex = result.next_turn;
      // const nextPlayer = roomPlayers[nextPlayerIndex];
      // if (nextPlayer && !nextPlayer.is_bot && nextPlayer.user_id && room) {
      //   notifyPlayerTurn(nextPlayer.user_id, room.code, room.id, nextPlayer.username).catch(err =>
      //     console.error('Failed to send turn notification:', err)
      //   );
      // }
    } catch (err) {
      const error = err as Error;
      setError(error);
      onError?.(error);
      throw error;
    }
  }, [gameState, currentPlayer, roomPlayers, room, onError, broadcastMessage]);
  
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
      .on('presence', { event: 'join' }, ({ key, newPresences }) => {})
      .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {});
    
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
        networkLogger.info('🎉 [Realtime] game_ended broadcast received:', payload);
        // Fetch updated game state which will trigger modal in GameScreen
        fetchGameState(roomId);
      })
      .on('broadcast', { event: 'match_ended' }, (payload) => {
        networkLogger.info('🏆 [Realtime] match_ended broadcast received:', payload);
        // Notify GameScreen to add score history
        const matchScores = (payload as any).match_scores as PlayerMatchScoreDetail[];
        const matchNumber = (payload as any).match_number || gameState?.match_number || 1;
        if (matchScores && onMatchEnded) {
          onMatchEnded(matchNumber, matchScores);
        }
        // Fetch updated game state to sync new match
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
      .on('broadcast', { event: 'auto_pass_timer_cancelled' }, (payload) => {
        setGameState(prevState => {
          if (!prevState) return prevState;
          return { ...prevState, auto_pass_timer: null };
        });
        fetchGameState(roomId);
      })
      .on('broadcast', { event: 'auto_pass_executed' }, (payload) => {
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
        console.log('[useRealtime] 👥 room_players change:', payload.eventType);
        // Refetch players to ensure we have latest is_host status
        await fetchPlayers(roomId);
      });
    
    // Subscribe and track presence - WAIT for subscription to complete
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Subscription timeout after 10s')), 10000);
      
      channel.subscribe(async (status) => {
        console.log('[useRealtime] 📡 joinChannel subscription status:', status);
        
        if (status === 'SUBSCRIBED') {
          clearTimeout(timeout);
          setIsConnected(true);
          console.log('[useRealtime] ✅ Channel subscribed successfully');
          
          // Track presence
          await channel.track({
            user_id: userId,
            username,
            online_at: new Date().toISOString(),
          });
          
          console.log('[useRealtime] ✅ Presence tracked, resolving joinChannel promise');
          resolve(); // BULLETPROOF: Signal that subscription is complete
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
    // eslint-disable-next-line react-hooks/exhaustive-deps  
  }, [userId, username, onDisconnect, onMatchEnded, fetchPlayers, fetchGameState]); // reconnect intentionally omitted to avoid circular dependency
  
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
      // The .single() query was hanging indefinitely, blocking all data loading
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
      // This ensures we have initial state even if channel subscription lags
      try {
        await fetchPlayers(existingRoom.id);
      } catch (playerError: any) {
        networkLogger.warn('[connectToRoom] Retrying fetch players...');
        await new Promise(resolve => setTimeout(resolve, 500));
        await fetchPlayers(existingRoom.id);
      }
      
      try {
        await fetchGameState(existingRoom.id);
      } catch (stateError) {
        networkLogger.warn('[connectToRoom] Retrying fetch state...');
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
      // Cleanup timer interval
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    };
  }, []);
  
  /**
   * Auto-pass timer: Server-authoritative design
   * 
   * NEW ARCHITECTURE (Dec 29, 2025 - CRITICAL FIX v2):
   * - Timer state is stored in database (game_state.auto_pass_timer)
   * - Contains started_at timestamp and duration_ms
   * - ALL clients calculate remaining_ms independently from the SAME server timestamp
   * - 🔥 FIX: Use useRef to prevent multiple intervals for same timer
   * - 🔥 FIX: Only start interval ONCE per timer (track by started_at)
   * - ALL clients execute auto-pass for redundancy (backend validates turns)
   * 
   * CORRECT AUTO-PASS LOGIC:
   * - When timer expires, pass ALL players EXCEPT the one who played the highest card
   * - The player who played the highest card is stored in auto_pass_timer.player_id
   * - Loop through all 4 players and pass each one that:
   *   1. Is NOT the player who played the highest card
   *   2. Has NOT already manually passed
   */
  useEffect(() => {
    const timerState = gameState?.auto_pass_timer;
    
    networkLogger.info('⏰ [DEBUG] Timer useEffect triggered', {
      gamePhase: gameState?.game_phase,
      hasAutoPassTimer: !!timerState,
      timerActive: timerState?.active,
      timerStartedAt: timerState?.started_at,
      currentTimerId: currentTimerId.current,
      hasActiveInterval: !!activeTimerInterval.current,
      roomId: room?.id,
    });
    
    // Cleanup function
    const cleanup = () => {
      if (activeTimerInterval.current) {
        networkLogger.info('⏰ [DEBUG] Clearing timer interval');
        clearInterval(activeTimerInterval.current);
        activeTimerInterval.current = null;
        currentTimerId.current = null;
      }
    };
    
    // Skip if game has finished
    if (gameState?.game_phase === 'finished') {
      cleanup();
      return;
    }
    
    // Skip if no timer or timer is inactive
    if (!timerState || !timerState.active) {
      cleanup();
      return;
    }
    
    // ⏰ CRITICAL: Check if this is the SAME timer using sequence_id (prevent duplicate intervals)
    const newTimerId = (timerState as any).sequence_id || timerState.started_at;
    if (currentTimerId.current === newTimerId && activeTimerInterval.current) {
      networkLogger.info('⏰ [DEBUG] Timer already running for sequence_id', newTimerId);
      return; // Already polling this timer!
    }
    
    // Clear old interval if switching to new timer
    cleanup();
    
    // Store new timer ID
    currentTimerId.current = newTimerId;
    
    networkLogger.info('⏰ [DEBUG] Starting NEW timer polling interval', {
      sequence_id: (timerState as any).sequence_id,
      started_at: timerState.started_at,
      end_timestamp: (timerState as any).end_timestamp,
      duration_ms: timerState.duration_ms,
      player_id: timerState.player_id,
    });
    
    // ⏰ CRITICAL FIX: Use setInterval to poll for timer expiration every 100ms
    // Uses SERVER-AUTHORITATIVE end_timestamp with clock sync
    activeTimerInterval.current = setInterval(() => {
      // ⚠️ CRITICAL: Re-read timer state on each tick to avoid stale closure data
      const currentTimerState = gameState?.auto_pass_timer;
      
      // If timer was cleared or deactivated, stop interval
      if (!currentTimerState || !currentTimerState.active) {
        if (activeTimerInterval.current) {
          networkLogger.info('⏰ [Timer] Timer deactivated, stopping interval');
          clearInterval(activeTimerInterval.current);
          activeTimerInterval.current = null;
          currentTimerId.current = null;
        }
        return;
      }
      
      // ⏰ NEW: Calculate remaining time from server-authoritative end_timestamp
      let remaining: number;
      const endTimestamp = (currentTimerState as any).end_timestamp;
      
      if (typeof endTimestamp === 'number') {
        // Use end_timestamp (server-authoritative)
        const now = Date.now();
        remaining = Math.max(0, endTimestamp - now);
        
        networkLogger.info(`⏰ [Timer] Server-auth check: ${remaining}ms remaining (endTime: ${new Date(endTimestamp).toISOString()})`);
      } else {
        // Fallback: calculate from started_at (old architecture)
        const startedAt = new Date(currentTimerState.started_at).getTime();
        const now = Date.now();
        const elapsed = now - startedAt;
        remaining = Math.max(0, currentTimerState.duration_ms - elapsed);
        
        networkLogger.info(`⏰ [Timer] Fallback check: ${remaining}ms remaining`);
      }
      
      // If timer has expired, auto-pass ALL players except the one who played highest card
      if (remaining <= 0) {
        // Clear interval and refs
        if (activeTimerInterval.current) {
          clearInterval(activeTimerInterval.current);
          activeTimerInterval.current = null;
          currentTimerId.current = null;
        }
        
        const exemptPlayerId = currentTimerState.player_id; // Player who played the highest card
        networkLogger.info(`⏰ [Timer] EXPIRED! Auto-passing all players except player_id: ${exemptPlayerId}`);
      
        // Find the player who played the highest card by matching player_id
        const exemptPlayer = roomPlayers.find(p => p.user_id === exemptPlayerId);
        const exemptPlayerIndex = exemptPlayer?.player_index;
        
        networkLogger.info(`⏰ [Timer] Exempt player index: ${exemptPlayerIndex}, current turn: ${gameState.current_turn}, pass_count: ${gameState.pass_count}`);
        
        // Auto-pass logic:
        // We need to pass players starting from AFTER the exempt player until we've passed 3 players
        // This ensures the exempt player gets to play again
        const playersToPass: number[] = [];
        
        if (exemptPlayerIndex !== undefined) {
          // Calculate which players need to be auto-passed
          // Start from the player AFTER the one who played the highest card
          for (let i = 1; i <= 3; i++) {
            const playerIndex = (exemptPlayerIndex + i) % roomPlayers.length;
            playersToPass.push(playerIndex);
          }
          
          networkLogger.info(`⏰ [Timer] Players to auto-pass: [${playersToPass.join(', ')}]`);
          
          // Execute auto-pass for each player sequentially
          const executeAutoPasses = async () => {
            for (const playerIndex of playersToPass) {
              try {
                networkLogger.info(`⏰ [Timer] Auto-passing player ${playerIndex}...`);
                
                // Call pass() - backend will validate if it's their turn
                // If not their turn yet, backend will reject with "Not your turn" error
                await pass(playerIndex);
                
                networkLogger.info(`⏰ [Timer] ✅ Successfully auto-passed player ${playerIndex}`);
                
                // Broadcast auto-pass event
                await broadcastMessage('auto_pass_executed', {
                  player_index: playerIndex,
                }).catch((broadcastError) => {
                  networkLogger.error('[Timer] Broadcast failed:', broadcastError);
                });
                
                // CRITICAL: Wait longer for Realtime to propagate the updated game_state
                // This ensures the next pass() call sees the updated current_turn
                networkLogger.info(`⏰ [Timer] Waiting 500ms for Realtime sync...`);
                await new Promise(resolve => setTimeout(resolve, 500));
                
              } catch (error) {
                const errorMsg = (error as Error).message || String(error);
                
                // If error is "Not your turn", that's expected - skip this player
                if (errorMsg.includes('Not your turn')) {
                  networkLogger.warn(`⏰ [Timer] Player ${playerIndex} already passed or not their turn - skipping`);
                  continue; // Continue to next player
                }
                
                // Other errors are unexpected - log and stop
                networkLogger.error(`⏰ [Timer] Unexpected error for player ${playerIndex}:`, error);
                break; // Stop on unexpected error
              }
            }
            
            networkLogger.info('⏰ [Timer] Auto-pass complete! Clearing timer state...');
            
            // Clear the timer from database after all passes
            try {
              await supabase
                .from('game_state')
                .update({ auto_pass_timer: null })
                .eq('room_id', room?.id);
              networkLogger.info('⏰ [Timer] ✅ Timer cleared from database');
            } catch (error) {
              networkLogger.error('[Timer] Failed to clear timer:', error);
            }
          };
          
          executeAutoPasses();
        }
      }
    }, 100); // Check every 100ms
    
    // Cleanup interval on unmount or when timer changes
    return () => {
      if (activeTimerInterval.current) {
        networkLogger.info('⏰ [DEBUG] Cleaning up timer polling interval on unmount');
        clearInterval(activeTimerInterval.current);
        activeTimerInterval.current = null;
        currentTimerId.current = null;
      }
    };
  }, [
    gameState?.auto_pass_timer?.active,
    gameState?.auto_pass_timer?.started_at,
    gameState?.game_phase,
    room?.id,
    roomPlayers,
    pass,
    broadcastMessage,
  ]);

  // NOTE: Timer display is handled by AutoPassTimer component
  // It recalculates remaining_ms from started_at every render

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
