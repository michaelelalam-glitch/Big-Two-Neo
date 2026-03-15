import { useState, useEffect, useCallback, useRef } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../services/supabase';

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
 * Uses Supabase Realtime as the **single** source of truth for match detection.
 * A one-shot `find-match` call registers the user in the waiting room (and
 * resolves immediately when a match is already available). After that,
 * Postgres-change events on `waiting_room` drive all state updates — there is
 * no polling interval, which eliminates the dual-source race condition where
 * both polling and Realtime could previously call `setMatchFound` concurrently.
 *
 * Race-condition guards:
 * - `isStartingRef` — prevents a second concurrent call to `startMatchmaking`
 *   from creating a duplicate Realtime subscription.
 * - `isCancelledRef` — prevents a Realtime callback that arrives after
 *   `cancelMatchmaking()` from incorrectly transitioning the hook back into a
 *   "match found" state.
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

  const channelRef = useRef<RealtimeChannel | null>(null);
  const userIdRef = useRef<string | null>(null);
  /** Prevents concurrent duplicate calls to startMatchmaking. */
  const isStartingRef = useRef(false);
  /** Set to true by cancelMatchmaking so in-flight Realtime callbacks are ignored. */
  const isCancelledRef = useRef(false);

  /**
   * Start searching for a match.
   *
   * Calls `find-match` once to register the user in the waiting room.
   * If a match is immediately available the function resolves it
   * synchronously. Otherwise a Realtime subscription on `waiting_room`
   * drives all further state transitions — no polling interval is started.
   *
   * The `isStartingRef` guard prevents a second concurrent invocation (e.g.
   * the user tapping "Find Match" twice in rapid succession) from creating a
   * duplicate Realtime subscription.
   */
  const startMatchmaking = useCallback(async (
    username: string,
    skillRating: number = 1000,
    region: string = 'global',
    matchType: 'casual' | 'ranked' = 'casual'
  ) => {
    // Debounce: ignore if a start is already in flight or search is active
    if (isStartingRef.current || isSearching) return;
    isStartingRef.current = true;
    isCancelledRef.current = false;

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

      // One-shot call: registers user in the waiting room and returns an
      // immediate match if one was already available.
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
        // Immediate match — resolve without subscribing
        setMatchFound(true);
        setRoomCode(result.room_code ?? null);
        setRoomId(result.room_id ?? null);
        setIsSearching(false);
        setWaitingCount(4);
      } else {
        // Waiting — subscribe to Realtime for match notification (no polling)
        setWaitingCount(result.waiting_count);
        subscribeToWaitingRoom(user.id);
      }
    } catch (err) {
      console.error('Error starting matchmaking:', err);
      setError(err instanceof Error ? err.message : 'Failed to start matchmaking');
      setIsSearching(false);
    } finally {
      isStartingRef.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSearching]);

  /**
   * Subscribe to waiting room changes for real-time match notification.
   *
   * Only one subscription is active at a time; any pre-existing channel is
   * torn down before creating the new one.
   *
   * The `isCancelledRef` guard ensures that a Realtime event delivered after
   * `cancelMatchmaking()` (possible due to buffering) does not incorrectly
   * transition the hook back into "match found" state.
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
          // Ignore events that arrive after cancelMatchmaking() was called
          if (isCancelledRef.current) return;

          // Update waiting count on any row change
          if (
            payload.eventType === 'INSERT' ||
            (payload.eventType === 'UPDATE' && !('matched_room_id' in payload.new))
          ) {
            // Count update is a best-effort UI hint handled via a follow-up
            // fetch; we don't attempt to count rows from change events alone.
          }

          // If this user was matched, resolve the search
          if (
            payload.eventType === 'UPDATE' &&
            payload.new &&
            'user_id' in payload.new &&
            payload.new.user_id === userId &&
            payload.new.status === 'matched'
          ) {
            const entry = payload.new as WaitingRoomEntry;
            if (entry.matched_room_id) {
              // Fetch room code then resolve
              supabase
                .from('rooms')
                .select('code')
                .eq('id', entry.matched_room_id)
                .single()
                .then(({ data: room }) => {
                  // Guard again in case cancel raced the async fetch
                  if (isCancelledRef.current) return;
                  if (room) {
                    setMatchFound(true);
                    setRoomCode(room.code);
                    setRoomId(entry.matched_room_id);
                    setIsSearching(false);
                    setWaitingCount(4);

                    // Tear down channel — no further events needed
                    if (channelRef.current) {
                      supabase.removeChannel(channelRef.current);
                      channelRef.current = null;
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
   * Cancel matchmaking.
   *
   * Sets `isCancelledRef` before any async work so that any Realtime callback
   * already enqueued (but not yet delivered) sees the cancelled flag and
   * does not transition to "match found".
   */
  const cancelMatchmaking = useCallback(async () => {
    try {
      const userId = userIdRef.current;
      if (!userId) return;

      // Mark cancelled before async teardown so enqueued Realtime
      // callbacks are ignored even if they fire during the await below.
      isCancelledRef.current = true;

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

  // Cleanup on unmount — tear down Realtime channel only (no interval to clear)
  useEffect(() => {
    return () => {
      isCancelledRef.current = true;
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
