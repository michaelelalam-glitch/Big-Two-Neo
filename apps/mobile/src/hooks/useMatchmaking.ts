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
  /**
   * r2936724700: Server-written queue size. When the Edge Function updates this
   * field on the user's row (on INSERT/DELETE in the waiting room), the existing
   * filtered UPDATE subscription delivers the new count and drives the UI,
   * removing the need for a separate broad subscription.
   */
  waiting_count?: number;
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
  startMatchmaking: (
    username: string,
    skillRating?: number,
    region?: string,
    matchType?: 'casual' | 'ranked'
  ) => Promise<void>;
  cancelMatchmaking: () => Promise<void>;
  resetMatch: () => void;
}

/**
 * Hook for managing matchmaking (Quick Play feature)
 *
 * Uses Supabase Realtime as the primary source for match detection.
 * A one-shot `find-match` call registers the user in the waiting room (and
 * resolves immediately when a match is already available). After that,
 * Postgres-change events on `waiting_room` drive all state updates.
 *
 * M16: If Realtime reports CHANNEL_ERROR or TIMED_OUT, a 5-second polling
 * fallback against `waiting_room` activates automatically. The polling interval
 * is cleared when: (a) a match is found, (b) Realtime recovers (SUBSCRIBED),
 * or (c) matchmaking is cancelled/unmounted.
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
   * Set to true as soon as a matched UPDATE is observed so that subsequent
   * duplicate/buffered events for the same row cannot start a second
   * concurrent room-code fetch.
   */
  const isResolvingMatchRef = useRef(false);
  /**
   * M16: Fallback polling interval ID. Set when Realtime fails (CHANNEL_ERROR /
   * TIMED_OUT) so we continue checking for match status via direct DB query.
   * Cleared when Realtime recovers, match is found, or matchmaking is cancelled.
   */
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * Start searching for a match.
   *
   * Calls `find-match` once to register the user in the waiting room.
   * If a match is immediately available the function resolves it
   * synchronously. Otherwise a Realtime subscription on `waiting_room`
   * drives all further state transitions. If Realtime later reports
   * CHANNEL_ERROR or TIMED_OUT, the M16 polling fallback activates automatically.
   *
   * The `isStartingRef` guard prevents a second concurrent invocation (e.g.
   * the user tapping "Find Match" twice in rapid succession) from creating a
   * duplicate Realtime subscription.
   */
  const startMatchmaking = useCallback(
    async (
      username: string,
      skillRating: number = 1000,
      region: string = 'global',
      matchType: 'casual' | 'ranked' = 'casual'
    ) => {
      // Debounce: ignore if a start is already in flight or search is active
      if (isStartingRef.current || isSearching) return;
      isStartingRef.current = true;
      isCancelledRef.current = false;
      isResolvingMatchRef.current = false;

      try {
        setError(null);
        setIsSearching(true);
        setMatchFound(false);
        setRoomCode(null);
        setRoomId(null);

        // Get current user
        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser();
        if (authError || !user) {
          throw new Error('User not authenticated');
        }

        // Bail out if cancel() was called while getUser() was in flight
        if (isCancelledRef.current) {
          setIsSearching(false);
          return;
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

        // Bail out if cancel() was called while find-match was in flight.
        // 8.3: If we reach here, find-match has already registered the user in
        // the waiting_room server-side.  Re-invoke cancel-matchmaking to ensure
        // the server removes that entry (the earlier cancel() call may have
        // raced the find-match insertion and returned early because
        // userIdRef.current was not yet set at that point).
        if (isCancelledRef.current) {
          setIsSearching(false);
          supabase.functions.invoke('cancel-matchmaking', { body: {} }).catch(() => {
            /* best-effort server cleanup */
          });
          return;
        }

        // Runtime validation before type casting
        if (!data || typeof data !== 'object') {
          throw new Error('Invalid response format from find-match');
        }

        const result = data as {
          matched: boolean;
          room_code?: string;
          room_id?: string;
          waiting_count: number;
        };

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
    },
    [isSearching]
  );

  /**
   * Subscribe to waiting room changes for real-time match notification.
   *
   * Only one subscription is active at a time; any pre-existing channel is
   * torn down before creating the new one.
   *
   * The `isCancelledRef` guard ensures that a Realtime event delivered after
   * `cancelMatchmaking()` (possible due to buffering) does not incorrectly
   * transition the hook back into "match found" state.
   *
   * M16: If Realtime reports CHANNEL_ERROR or TIMED_OUT, a 5-second polling
   * fallback kicks in to query `waiting_room` directly. The interval is cleared
   * once a match is found, the subscription recovers, or matchmaking is cancelled.
   */
  const subscribeToWaitingRoom = (userId: string) => {
    // Clean up existing channel and any stale polling interval
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }
    if (pollingIntervalRef.current !== null) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }

    /** Shared match resolution logic used by both Realtime and polling paths. */
    const resolveMatchedEntry = (entry: WaitingRoomEntry) => {
      if (isCancelledRef.current) return;
      if (!entry.matched_room_id) return;
      if (isResolvingMatchRef.current) return;
      isResolvingMatchRef.current = true;

      // Keep channel and polling active until the room fetch succeeds so that
      // a transient network error does not leave the hook with no live
      // subscription and isResolvingMatchRef permanently true.  Teardown
      // moves to the success path; the error paths reset isResolvingMatchRef
      // so the next Realtime event or poll tick can retry.
      (async () => {
        const { data: room, error: roomError } = await supabase
          .from('rooms')
          .select('code')
          .eq('id', entry.matched_room_id!)
          .single();

        if (isCancelledRef.current) return;
        if (roomError || !room) {
          // Tear down channel and polling to avoid a contradictory state where
          // isSearching is false but subscriptions are still active and may
          // call setState unexpectedly. isResolvingMatchRef is reset so a
          // fresh startMatchmaking() call can proceed.
          isResolvingMatchRef.current = false;
          if (pollingIntervalRef.current !== null) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
          }
          if (channelRef.current) {
            supabase.removeChannel(channelRef.current);
            channelRef.current = null;
          }
          setError('Failed to fetch room details');
          setIsSearching(false);
          return;
        }

        // Room fetch succeeded — now tear down channel and polling
        if (pollingIntervalRef.current !== null) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
        if (channelRef.current) {
          supabase.removeChannel(channelRef.current);
          channelRef.current = null;
        }

        setMatchFound(true);
        setRoomCode(room.code);
        setRoomId(entry.matched_room_id);
        setIsSearching(false);
        setWaitingCount(4);
      })().catch((err: unknown) => {
        if (isCancelledRef.current) return;
        // Tear down and stop searching — consistent with error path above.
        isResolvingMatchRef.current = false;
        if (pollingIntervalRef.current !== null) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
        if (channelRef.current) {
          supabase.removeChannel(channelRef.current);
          channelRef.current = null;
        }
        setError(err instanceof Error ? err.message : 'Failed to fetch room details');
        setIsSearching(false);
      });
    };

    /** M16: Start polling waiting_room every 5 s as a Realtime fallback. */
    const startPollingFallback = () => {
      if (pollingIntervalRef.current !== null) return; // already polling
      console.warn('⚠️ [useMatchmaking] Realtime unavailable — starting polling fallback');
      // in-flight guard: prevents overlapping async executions if a poll
      // takes longer than the 5s interval before completing
      let isInFlight = false;
      pollingIntervalRef.current = setInterval(async () => {
        if (isCancelledRef.current) {
          clearInterval(pollingIntervalRef.current!);
          pollingIntervalRef.current = null;
          return;
        }
        if (isInFlight) return; // skip tick — previous poll still running
        isInFlight = true;
        try {
          const { data, error: pollErr } = await supabase
            .from('waiting_room')
            .select('status, matched_room_id, waiting_count, user_id')
            .eq('user_id', userId)
            .single();

          if (pollErr || !data) return;

          const entry = data as WaitingRoomEntry;
          if (typeof entry.waiting_count === 'number') {
            setWaitingCount(entry.waiting_count);
          }
          if (entry.status === 'matched') {
            resolveMatchedEntry(entry);
          }
        } catch {
          // Ignore transient polling errors
        } finally {
          isInFlight = false;
        }
      }, 5000);
    };

    // Create new channel
    const channel = supabase
      .channel('waiting_room_updates')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'waiting_room',
          filter: `user_id=eq.${userId}`,
        },
        payload => {
          // Ignore events that arrive after cancelMatchmaking() was called
          if (isCancelledRef.current) return;

          // r2936724697: Defensive user-id guard. The server-side filter is the
          // primary guard, but add an explicit check so any buffered/misdelivered
          // cross-user event (or test simulation) cannot transition this user's
          // state incorrectly.
          if (payload.new && (payload.new as WaitingRoomEntry).user_id !== userId) return;

          // r2936724700: Keep waitingCount current from server-written field.
          // When the Edge Function writes waiting_count to the user's row on each
          // queue INSERT/DELETE, this filtered UPDATE drives the UI without a
          // separate broad subscription.
          const updatedEntry = payload.new as WaitingRoomEntry;
          if (typeof updatedEntry.waiting_count === 'number') {
            setWaitingCount(updatedEntry.waiting_count);
          }

          // Realtime is working — clear any active polling fallback
          if (pollingIntervalRef.current !== null) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
          }

          // Subscription is already filtered to UPDATE events for this user;
          // only act when the row transitions to 'matched'.
          if (payload.new && payload.new.status === 'matched') {
            resolveMatchedEntry(payload.new as WaitingRoomEntry);
          }
        }
      )
      .subscribe((status: string) => {
        // M16: Start polling fallback when Realtime is unavailable
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          startPollingFallback();
        } else if (status === 'SUBSCRIBED') {
          // Realtime recovered — stop polling to avoid redundant DB load
          if (pollingIntervalRef.current !== null) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
          }
        }
      });

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
      // Mark cancelled immediately — fires even when userId is not yet set,
      // so startMatchmaking bails out if cancel races the getUser() /
      // find-match awaits, and any buffered Realtime events are ignored.
      isCancelledRef.current = true;
      isResolvingMatchRef.current = false;
      setIsSearching(false);
      setWaitingCount(0);

      const userId = userIdRef.current;
      if (!userId) return;

      // Unsubscribe from channel
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }

      // M16: Clear any active polling fallback
      if (pollingIntervalRef.current !== null) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }

      // Call cancel-matchmaking Edge Function
      const { data, error: cancelError } = await supabase.functions.invoke('cancel-matchmaking', {
        body: {},
      });

      if (cancelError || !data?.success) {
        console.error('Error canceling matchmaking:', cancelError || data);
      }

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

  // Cleanup on unmount — tear down Realtime channel and any active polling fallback
  useEffect(() => {
    return () => {
      isCancelledRef.current = true;
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
      // M16: Clear polling fallback interval to prevent setState calls after unmount
      if (pollingIntervalRef.current !== null) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
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
