import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../services/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

export interface WaitingRoomEntry {
  id: string;
  user_id: string;
  username: string;
  skill_rating: number;
  region: string;
  status: 'waiting' | 'matched' | 'cancelled';
  matched_room_id: string | null;
  joined_at: string;
  matched_at: string | null;
}

export interface MatchResult {
  matched: boolean;
  room_id: string | null;
  room_code: string | null;
  waiting_count: number;
}

interface UseMatchmakingReturn {
  isSearching: boolean;
  waitingCount: number;
  matchFound: boolean;
  roomCode: string | null;
  roomId: string | null;
  error: string | null;
  startMatchmaking: (username: string, skillRating?: number, region?: string, matchType?: 'casual' | 'ranked') => Promise<void>;
  cancelMatchmaking: () => Promise<void>;
  resetMatch: () => void;
}

/**
 * Hook for managing matchmaking (Quick Play feature)
 * 
 * Features:
 * - Joins waiting room and polls for matches
 * - Real-time updates on waiting player count
 * - Auto-cancels on unmount or timeout
 * - Skill-based matchmaking (±200 ELO)
 * - Region-based matching
 * 
 * Usage:
 * ```tsx
 * const { isSearching, matchFound, roomCode, startMatchmaking, cancelMatchmaking } = useMatchmaking();
 * 
 * // Start searching
 * await startMatchmaking('Player1', 1200, 'na');
 * 
 * // When matchFound is true, navigate to room with roomCode
 * if (matchFound && roomCode) {
 *   navigation.navigate('Lobby', { roomCode });
 * }
 * ```
 */
export function useMatchmaking(): UseMatchmakingReturn {
  const [isSearching, setIsSearching] = useState(false);
  const [waitingCount, setWaitingCount] = useState(0);
  const [matchFound, setMatchFound] = useState(false);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const pollIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const userIdRef = useRef<string | null>(null);

  /**
   * Start searching for a match
   */
  const startMatchmaking = useCallback(async (
    username: string,
    skillRating: number = 1000,
    region: string = 'global',
    matchType: 'casual' | 'ranked' = 'casual'
  ) => {
    try {
      setError(null);
      setIsSearching(true);
      setMatchFound(false);
      setRoomCode(null);
      setRoomId(null);

      // Get current user
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        throw new Error('User not authenticated');
      }

      userIdRef.current = user.id;

      // Call find-match Edge Function
      const { data, error: matchError } = await supabase.functions.invoke('find-match', {
        body: {
          username,
          skill_rating: skillRating,
          region,
          match_type: matchType,
        },
      });

      if (matchError) {
        throw matchError;
      }

      // Runtime validation before type casting
      if (!data || typeof data !== 'object') {
        throw new Error('Invalid response format from find-match');
      }

      const result = data as { matched: boolean; room_code?: string; room_id?: string; waiting_count: number };

      // Validate required fields
      if (typeof result.matched !== 'boolean' || typeof result.waiting_count !== 'number') {
        throw new Error('Response missing required fields (matched, waiting_count)');
      }

      // When matched is true, room_code and room_id must be present
      if (result.matched && (!result.room_code || !result.room_id)) {
        throw new Error('Matched response missing room details');
      }

      if (result.matched) {
        // Match found immediately!
        setMatchFound(true);
        setRoomCode(result.room_code);
        setRoomId(result.room_id);
        setIsSearching(false);
        setWaitingCount(4);
      } else {
        // No match yet, start polling
        setWaitingCount(result.waiting_count);
        
        // Subscribe to waiting room changes
        subscribeToWaitingRoom(user.id);
        
        // Poll every 2 seconds for matches
        pollIntervalRef.current = setInterval(async () => {
          await checkForMatch(user.id, username, skillRating, region, matchType);
        }, 2000);
      }
    } catch (err) {
      console.error('Error starting matchmaking:', err);
      setError(err instanceof Error ? err.message : 'Failed to start matchmaking');
      setIsSearching(false);
    }
  }, []);

  /**
   * Check if a match has been found
   */
  const checkForMatch = async (
    userId: string,
    username: string,
    skillRating: number,
    region: string,
    matchType: 'casual' | 'ranked' = 'casual'
  ) => {
    try {
      const { data, error: matchError } = await supabase.functions.invoke('find-match', {
        body: {
          username,
          skill_rating: skillRating,
          region,
          match_type: matchType,
        },
      });

      if (matchError) throw matchError;

      const result = data as { matched: boolean; room_code?: string; room_id?: string; waiting_count: number };

      if (result.matched) {
        // Match found!
        setMatchFound(true);
        setRoomCode(result.room_code);
        setRoomId(result.room_id);
        setIsSearching(false);
        setWaitingCount(4);
        
        // Stop polling
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        
        // Unsubscribe from waiting room
        if (channelRef.current) {
          supabase.removeChannel(channelRef.current);
          channelRef.current = null;
        }
      } else {
        setWaitingCount(result.waiting_count);
      }
    } catch (err) {
      console.error('Error checking for match:', err);
    }
  };

  /**
   * Subscribe to waiting room changes for real-time updates
   */
  const subscribeToWaitingRoom = (userId: string) => {
    // Clean up existing channel
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }

    // Create new channel
    const channel = supabase
      .channel('waiting_room_updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'waiting_room',
        },
        (payload) => {
          
          // If this user was matched, stop searching
          if (
            payload.eventType === 'UPDATE' &&
            payload.new &&
            'user_id' in payload.new &&
            payload.new.user_id === userId &&
            payload.new.status === 'matched'
          ) {
            const entry = payload.new as WaitingRoomEntry;
            if (entry.matched_room_id) {
              // Fetch room details
              supabase
                .from('rooms')
                .select('code')
                .eq('id', entry.matched_room_id)
                .single()
                .then(({ data: room }) => {
                  if (room) {
                    setMatchFound(true);
                    setRoomCode(room.code);
                    setRoomId(entry.matched_room_id);
                    setIsSearching(false);
                    setWaitingCount(4);
                    
                    // Stop polling
                    if (pollIntervalRef.current) {
                      clearInterval(pollIntervalRef.current);
                      pollIntervalRef.current = null;
                    }
                  }
                });
            }
          }
        }
      )
      .subscribe();

    channelRef.current = channel;
  };

  /**
   * Cancel matchmaking
   */
  const cancelMatchmaking = useCallback(async () => {
    try {
      const userId = userIdRef.current;
      if (!userId) return;

      // Stop polling
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }

      // Unsubscribe from channel
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }

      // Call cancel-matchmaking Edge Function
      const { data, error: cancelError } = await supabase.functions.invoke('cancel-matchmaking', {
        body: {},
      });

      if (cancelError || !data?.success) {
        console.error('Error canceling matchmaking:', cancelError || data);
      }

      setIsSearching(false);
      setWaitingCount(0);
      setError(null);
      userIdRef.current = null;
    } catch (err) {
      console.error('Error canceling matchmaking:', err);
      setError(err instanceof Error ? err.message : 'Failed to cancel matchmaking');
    }
  }, []);

  /**
   * Reset match state (for navigation)
   */
  const resetMatch = useCallback(() => {
    setMatchFound(false);
    setRoomCode(null);
    setRoomId(null);
    setWaitingCount(0);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, []);

  return {
    isSearching,
    waitingCount,
    matchFound,
    roomCode,
    roomId,
    error,
    startMatchmaking,
    cancelMatchmaking,
    resetMatch,
  };
}
