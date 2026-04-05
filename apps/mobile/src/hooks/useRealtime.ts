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
  BroadcastData,
  BroadcastPayload,
} from '../types/multiplayer';
import type { Database } from '../types/database.types';
import type { MultiplayerMatchScoreDetail, UseRealtimeOptions } from '../types/realtimeTypes';
import { isValidTimerStatePayload } from '../utils/edgeFunctionErrors';
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
  const { userId, username, onError, onDisconnect, onReconnect } = options;

  // State
  const [room, setRoom] = useState<Room | null>(null);
  const [roomPlayers, setRoomPlayers] = useState<Player[]>([]); // Players in room_players table (lobby)
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [playerHands, setPlayerHands] = useState<Map<string, PlayerHand>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  // Reactive channel state — triggers re-subscription in consumers (e.g. useGameChat).
  const [realtimeChannel, setRealtimeChannel] = useState<RealtimeChannel | null>(null);

  // Refs
  const channelRef = useRef<RealtimeChannel | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 7.2: Guard against ghost channels from rapid joinChannel calls (e.g. quick
  // reconnects).  If a join is already in-flight, concurrent calls return the
  // same in-progress promise instead of spawning a second channel.
  // 7.2: Keyed by roomId so a join in-flight for roomA never eclipses a new
  // join request for roomB (rapid room-switch / reconnect safety).
  const joiningChannelPromiseRef = useRef<{ roomId: string; promise: Promise<void> } | null>(null);
  // Mutable ref to the latest gameState — updated below via useEffect so that
  // joinChannel's broadcast handlers always read fresh data without needing
  // gameState itself in joinChannel's dependency array (which would change
  // joinChannel identity on every game-state update and cause reconnect churn).
  const gameStateRef = useRef(gameState);
  /** Tracks the freshest last_seen_at per player ID without triggering re-renders.
   *  Updated on every room_players UPDATE (even heartbeat-only skipped ones).
   *  Used by MultiplayerGame for client-side disconnect staleness detection. */
  const playerLastSeenAtRef = useRef<Record<string, string>>({});
  /** Maps room_players.id → user_id for presence leave → disconnect detection.
   *  Updated alongside playerLastSeenAtRef in the postgres_changes handler. */
  const playerIdToUserIdRef = useRef<Record<string, string>>({});

  // Track mount status to prevent in-flight async callbacks from calling setState
  // after the component unmounts. This guards against EXC_BAD_ACCESS crashes in
  // Fabric's Scheduler::uiManagerDidFinishTransaction when fetchGameState or
  // fetchPlayers resolve after navigation tears the component tree down.
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Computed values
  const currentPlayer = roomPlayers.find(p => p.user_id === userId) || null;
  const isHost = currentPlayer?.is_host === true;

  // Keep gameStateRef in sync so joinChannel's broadcast handlers can read the
  // latest value without gameState being in joinChannel's dependency array.
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  // ⏰ Clock sync for accurate timer calculations (matches AutoPassTimer component)
  const { getCorrectedNow } = useClockSync(gameState?.auto_pass_timer || null);

  // BULLETPROOF: Data ready check - ensures game state is fully loaded with valid data.
  // NOTE: We intentionally do NOT require roomPlayers.length > 0 once the game has
  // reached the terminal phase ('game_over'). When complete-game runs it
  // deletes room_players as part of cleanup; that Realtime event arrives while
  // game_state still reports game_phase = 'game_over'. Without this exemption,
  // isDataReady would flip back to false, isInitializing becomes true, and
  // GameView's hasGameEverInitialized-gated GameEndModal would lose its stable
  // terminal-phase view. The 'finished' phase is a between-match transition and
  // is NOT considered terminal here — only 'game_over' signals the actual end.
  const isGameTerminal = gameState?.game_phase === 'game_over';
  const isDataReady =
    !loading &&
    !!gameState &&
    !!gameState.hands &&
    Object.keys(gameState.hands).length > 0 &&
    (roomPlayers.length > 0 || isGameTerminal);

  /**
   * Broadcast message to all room players
   */
  const broadcastMessage = useCallback(
    async (event: BroadcastEvent, data: BroadcastData) => {
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
    },
    [room]
  );

  // ⏰ Auto-pass timer (extracted hook — manages its own refs/intervals)
  const { isAutoPassInProgress } = useAutoPassTimer({
    gameState,
    room,
    roomPlayers,
    broadcastMessage,
    getCorrectedNow,
    currentUserId: userId,
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

      // Guard: component unmounted while fetch was in-flight — skip state updates.
      if (!isMountedRef.current) return;

      if (error) {
        networkLogger.error(`❌ [fetchPlayers] Error fetching players:`, error);
        throw error;
      } else if (data) {
        setRoomPlayers(data);
        // Populate refs for presence leave → disconnect detection
        for (const player of data) {
          if (player.id && player.user_id) {
            playerIdToUserIdRef.current[player.id] = player.user_id;
          }
          if (player.id && player.last_seen_at) {
            playerLastSeenAtRef.current[player.id] = player.last_seen_at;
          }
        }
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

    // Guard: component unmounted while fetch was in-flight — skip state updates.
    if (!isMountedRef.current) return;

    if (error) {
      if (error.code !== 'PGRST116') {
        networkLogger.error('[fetchGameState] Error:', error);
        throw error;
      }
      setGameState(null);
    } else if (data) {
      // Map the DB row into GameState, explicitly assigning each field.
      // Json-typed columns are cast to their app-layer types; the DB schema
      // stores them as JSONB, so the runtime shape matches at read-time.
      type GameStateRow = Database['public']['Tables']['game_state']['Row'];
      const row = data as GameStateRow;
      if (!row.room_id) {
        networkLogger.error('[fetchGameState] game_state row has null room_id, skipping');
        setGameState(null);
        return;
      }
      const mapped: GameState = {
        id: row.id,
        room_id: row.room_id,
        current_turn: row.current_turn,
        turn_started_at: row.turn_started_at,
        last_play: row.last_play as unknown as GameState['last_play'],
        pass_count: row.pass_count ?? 0,
        game_phase: row.game_phase as GameState['game_phase'],
        winner: row.winner,
        game_winner_index: row.game_winner_index,
        match_number: row.match_number,
        hands: (row.hands ?? {}) as unknown as GameState['hands'],
        play_history: (row.play_history ?? []) as unknown as GameState['play_history'],
        final_scores: row.final_scores as unknown as GameState['final_scores'],
        scores_history: (row.scores_history ?? []) as unknown as GameState['scores_history'],
        auto_pass_timer: row.auto_pass_timer as unknown as GameState['auto_pass_timer'],
        played_cards: (row.played_cards ?? []) as unknown as GameState['played_cards'],
        updated_at: row.updated_at ?? new Date().toISOString(),
      };
      setGameState(mapped);
    } else {
      setGameState(null);
    }
  }, []);

  /**
   * Join a realtime channel for the room
   */
  const joinChannel = useCallback(
    async (roomId: string): Promise<void> => {
      // 7.2: Deduplicate concurrent joinChannel calls — only reuse the in-flight
      // promise when it's for the SAME roomId. A different roomId must start a
      // fresh join so we don't accidentally join the wrong channel.
      if (joiningChannelPromiseRef.current?.roomId === roomId) {
        return joiningChannelPromiseRef.current.promise;
      }

      // Use definite assignment assertion so the IIFE's finally block can
      // reference `joinPromise` by identity to guard against clearing a newer
      // in-flight promise. TypeScript would otherwise report TS2454 (use before assign).
      let joinPromise!: Promise<void>; // eslint-disable-line prefer-const
      // eslint-disable-next-line prefer-const
      joinPromise = (async () => {
        try {
          // Remove existing channel. Clear the reactive state immediately so
          // consumers (e.g. useGameChat) stop using the old channel the moment
          // joinChannel is called, not only after the new subscription reaches
          // SUBSCRIBED (Copilot PR-150 r2950195919).
          if (channelRef.current) {
            setRealtimeChannel(null);
            setIsConnected(false);
            await channelRef.current.unsubscribe();
            channelRef.current = null;
          }

          // Remove any ghost room:* channels left over from crash recovery or rapid reconnect
          // retries. Without this, the Supabase client accumulates zombie channels in its
          // internal registry and fires a CLOSED callback for every one when the WebSocket
          // reconnects — blocking the JS thread for seconds and freezing the UI
          // ("CLOSED storm"). We filter to realtime:room:* so the matchmaking channel
          // (realtime:waiting_room_updates) is never disrupted.
          const roomGhosts = supabase
            .getChannels()
            .filter(ch => (ch as { topic?: string }).topic?.startsWith('realtime:room:'));
          if (roomGhosts.length > 0) {
            await Promise.allSettled(roomGhosts.map(gh => supabase.removeChannel(gh)));
          }

          // Create new channel with presence
          const channel = supabase.channel(`room:${roomId}`, {
            config: {
              presence: {
                key: userId,
              },
            },
          });

          // Subscribe to presence events — 'leave' triggers instant disconnect detection
          channel
            .on('presence', { event: 'sync' }, () => {})
            .on('presence', { event: 'join' }, ({ key: _key, newPresences: _newPresences }) => {})
            .on(
              'presence',
              { event: 'leave' },
              ({ key: leftUserId, leftPresences: _leftPresences }) => {
                // When a player's presence leaves (WebSocket drops), immediately mark their
                // last_seen_at as stale so the client-side staleness detector in MultiplayerGame
                // picks it up on the very next polling cycle (~1s) instead of waiting 30s.
                if (leftUserId && leftUserId !== userId) {
                  networkLogger.warn(
                    `[useRealtime] 🔌 Presence LEAVE detected for user ${leftUserId.substring(0, 8)} — marking stale for instant disconnect`
                  );
                  // Find the room_players row for this user via the ref-based mapping
                  // and backdate last_seen_at to 60s ago so staleness detector fires immediately.
                  const staleTimestamp = new Date(Date.now() - 60_000).toISOString();
                  for (const [playerId, mappedUserId] of Object.entries(
                    playerIdToUserIdRef.current
                  )) {
                    if (mappedUserId === leftUserId) {
                      playerLastSeenAtRef.current[playerId] = staleTimestamp;
                      networkLogger.info(
                        `[useRealtime] ⚡ Backdated last_seen_at for playerId=${playerId.substring(0, 8)} (instant disconnect detection)`
                      );
                    }
                  }

                  // 10.6 robustness: also schedule a server-side force-sweep so that even
                  // if Realtime is unreliable (missed presence leaves), the server will
                  // start the 60-second disconnect timer at the right moment.
                  // We find the LOCAL player's room_players.id (not the leaving player's)
                  // because update-heartbeat validates against auth.uid() of the caller.
                  // The sweep_only flag skips updating our own heartbeat row; force_sweep
                  // runs process_disconnected_players() immediately when validated.
                  // This call will be rejected server-side if the player is not yet stale
                  // (< 30s silence), but that's fine — the staleness detector + ring
                  // expiry (forceSweep) handles the confirmed path. This is belt-and-suspenders.
                  let localPlayerId: string | null = null;
                  for (const [pid, uid] of Object.entries(playerIdToUserIdRef.current)) {
                    if (uid === userId) {
                      localPlayerId = pid;
                      break;
                    }
                  }
                  if (localPlayerId) {
                    void supabase.functions
                      .invoke('update-heartbeat', {
                        body: {
                          room_id: roomId,
                          player_id: localPlayerId,
                          sweep_only: true,
                          force_sweep: true,
                        },
                      })
                      .catch((err: unknown) => {
                        networkLogger.warn(
                          '[useRealtime] Presence-leave force-sweep failed (non-critical):',
                          err
                        );
                      });
                  }
                }
              }
            );

          // Subscribe to broadcast events
          // Note: fetchPlayers and fetchGameState are called fire-and-forget with void+catch
          // so that transient network errors in Realtime callbacks surface as warnings rather
          // than unhandled promise rejections (addresses Copilot review comment).
          const warnFetch = (label: string) => (err: unknown) =>
            networkLogger.warn(`[Realtime] ${label} broadcast fetch error:`, err);

          channel
            .on('broadcast', { event: 'player_joined' }, _payload => {
              void fetchPlayers(roomId).catch(warnFetch('player_joined'));
            })
            .on('broadcast', { event: 'player_left' }, _payload => {
              void fetchPlayers(roomId).catch(warnFetch('player_left'));
            })
            .on('broadcast', { event: 'player_ready' }, _payload => {
              void fetchPlayers(roomId).catch(warnFetch('player_ready'));
            })
            // fix/rejoin: human reclaimed seat from bot — refresh both players and
            // game state so all clients update their UI (stop waiting for "bot" turn)
            .on('broadcast', { event: 'player_reconnected' }, payload => {
              networkLogger.info('🔄 [Realtime] player_reconnected broadcast received:', payload);
              void fetchPlayers(roomId).catch(warnFetch('player_reconnected/players'));
              void fetchGameState(roomId).catch(warnFetch('player_reconnected/gameState'));
            })
            .on('broadcast', { event: 'game_started' }, _payload => {
              void fetchGameState(roomId).catch(warnFetch('game_started'));
            })
            .on('broadcast', { event: 'cards_played' }, _payload => {
              void fetchGameState(roomId).catch(warnFetch('cards_played'));
            })
            .on('broadcast', { event: 'player_passed' }, _payload => {
              void fetchGameState(roomId).catch(warnFetch('player_passed'));
            })
            .on('broadcast', { event: 'game_ended' }, payload => {
              networkLogger.info('🎉 [Realtime] game_ended broadcast received:', payload);
              void fetchGameState(roomId).catch(warnFetch('game_ended'));
            })
            .on('broadcast', { event: 'game_over' }, payload => {
              networkLogger.info('🎉 [Realtime] game_over broadcast received:', payload);
              void fetchGameState(roomId).catch(warnFetch('game_over'));
              // Use onGameOverRef.current so the latest callback is always invoked
              // without needing to re-subscribe the channel when the prop changes.
              const broadcastData = ((payload as { data?: Record<string, unknown> })?.data ??
                payload) as Record<string, unknown>;
              const rawScores = (broadcastData?.final_scores as unknown[] | undefined) ?? [];
              // Shape-validate each entry — must have the fields useMultiplayerScoreHistory expects.
              const isValidScore = (s: unknown): s is PlayerMatchScoreDetail =>
                typeof s === 'object' &&
                s !== null &&
                typeof (s as Record<string, unknown>).player_index === 'number' &&
                typeof (s as Record<string, unknown>).matchScore === 'number' &&
                typeof (s as Record<string, unknown>).cumulativeScore === 'number';
              const finalScores: PlayerMatchScoreDetail[] = Array.isArray(rawScores)
                ? rawScores.filter(isValidScore)
                : [];
              if (Array.isArray(rawScores) && finalScores.length !== rawScores.length) {
                networkLogger.warn(
                  '[Realtime] game_over: some final_scores entries had unexpected shape and were filtered'
                );
              }
              const matchNumber =
                (broadcastData?.match_number as number | undefined) ??
                gameStateRef.current?.match_number ??
                1;
              // onMatchEnded + onGameOver calls removed — score history is handled by
              // useMultiplayerScoreHistory and modal by useMatchEndHandler (both DB-authoritative).
              // fetchGameState above will update multiplayerGameState which triggers both hooks.
              gameLogger.info(
                '[Realtime] game_over received; fetchGameState triggered for modal/score-history refresh',
                { matchNumber }
              );
            })
            .on('broadcast', { event: 'match_ended' }, payload => {
              networkLogger.info('🏆 [Realtime] match_ended broadcast received:', payload);
              // broadcastMessage wraps data as { event, data: {...}, timestamp }
              // Access payload.data first, fall back to top-level for robustness
              const broadcastData =
                (
                  payload as {
                    data?: { match_scores?: PlayerMatchScoreDetail[]; match_number?: number };
                  }
                )?.data || payload;
              const matchNumber =
                (broadcastData as { match_number?: number })?.match_number ||
                gameStateRef.current?.match_number ||
                1;
              gameLogger.info(
                '[Realtime] match_ended received; fetchGameState triggered for score-history refresh',
                { matchNumber }
              );
              // onMatchEnded call removed — useMultiplayerScoreHistory reads from DB scores_history.
              void fetchGameState(roomId).catch(warnFetch('match_ended'));
            })
            .on('broadcast', { event: 'auto_pass_timer_started' }, payload => {
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
              void fetchGameState(roomId).catch(warnFetch('auto_pass_timer_started'));
            })
            .on('broadcast', { event: 'auto_pass_timer_cancelled' }, _payload => {
              setGameState(prevState => {
                if (!prevState) return prevState;
                return { ...prevState, auto_pass_timer: null };
              });
              void fetchGameState(roomId).catch(warnFetch('auto_pass_timer_cancelled'));
            })
            .on('broadcast', { event: 'auto_pass_executed' }, _payload => {
              setGameState(prevState => {
                if (!prevState) return prevState;
                return { ...prevState, auto_pass_timer: null };
              });
              void fetchGameState(roomId).catch(warnFetch('auto_pass_executed'));
            });

          // Subscribe to database changes
          channel
            .on(
              'postgres_changes',
              {
                event: 'UPDATE',
                schema: 'public',
                table: 'rooms',
                filter: `id=eq.${roomId}`,
              },
              payload => {
                setRoom(payload.new as Room);
              }
            )
            .on(
              'postgres_changes',
              {
                event: '*',
                schema: 'public',
                table: 'game_state',
                filter: `room_id=eq.${roomId}`,
              },
              payload => {
                if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
                  setGameState(payload.new as GameState);
                }
              }
            )
            // ✅ FIX: Listen to room_players changes to catch is_host updates.
            // PERF: For UPDATE events, merge the changed row directly instead of re-fetching
            // all players from the DB. Heartbeats fire every 5 s per player (×4 players ≈ 1/s)
            // and previously triggered a full SELECT + setState + 2-3 cascading re-renders.
            // Returning the SAME prev reference when only heartbeat fields changed prevents
            // those unnecessary re-renders entirely.
            .on(
              'postgres_changes',
              {
                event: '*',
                schema: 'public',
                table: 'room_players',
                filter: `room_id=eq.${roomId}`,
              },
              async payload => {
                if (payload.eventType === 'UPDATE') {
                  const updated = payload.new as Player;
                  // Always track last_seen_at in a mutable ref (no re-render).
                  // Used by the client-side staleness detector to detect disconnects
                  // even when the server's process_disconnected_players hasn't fired yet.
                  if (updated.id && updated.last_seen_at) {
                    playerLastSeenAtRef.current[updated.id] = updated.last_seen_at;
                  }
                  // Track user_id mapping for presence leave → disconnect detection
                  if (updated.id && updated.user_id) {
                    playerIdToUserIdRef.current[updated.id] = updated.user_id;
                  }
                  setRoomPlayers(prev => {
                    const idx = prev.findIndex(p => p.id === updated.id);
                    if (idx === -1) return [...prev, updated]; // new row — insert

                    const existing = prev[idx];
                    // Only re-render when UI-relevant fields change.
                    // last_heartbeat / heartbeat_count are heartbeat-only and never affect rendering.
                    // 7.3: Normalize ISO timestamp format to a numeric millisecond
                    // value before comparing — Supabase realtime can return the same
                    // timestamp in different ISO formats (with/without ms, +00:00 vs Z),
                    // causing spurious re-renders on every 5s heartbeat even when the
                    // timer anchor hasn't changed. `new Date(ts).getTime()` normalizes
                    // any valid ISO string to a stable numeric representation.
                    const normalizeTs = (ts: string | null | undefined): number | null =>
                      ts ? new Date(ts).getTime() : null;
                    const meaningfullyChanged =
                      existing.is_host !== updated.is_host ||
                      existing.is_bot !== updated.is_bot ||
                      existing.connection_status !== updated.connection_status ||
                      existing.player_index !== updated.player_index ||
                      existing.username !== updated.username ||
                      existing.human_user_id !== updated.human_user_id ||
                      existing.user_id !== updated.user_id ||
                      normalizeTs(existing.disconnect_timer_started_at) !==
                        normalizeTs(updated.disconnect_timer_started_at);

                    if (!meaningfullyChanged) {
                      return prev; // same reference → React bails out → no re-render
                    }

                    const next = [...prev];
                    next[idx] = updated;
                    return next;
                  });
                } else {
                  // INSERT / DELETE: full re-fetch to ensure consistent ordering
                  await fetchPlayers(roomId);
                }
              }
            );

          // Assign channelRef BEFORE subscribing so that any reactive consumers
          // (e.g. useGameChat) that read the ref during the re-render triggered by
          // setIsConnected(true) will already see the channel instance.
          channelRef.current = channel;
          // NOTE: setRealtimeChannel is called only after SUBSCRIBED so that the
          // reactive channel state is non-null only when the channel is fully ready
          // (Copilot PR-150 r2950125694).

          // Subscribe and track presence - WAIT for subscription to complete
          await new Promise<void>((resolve, reject) => {
            // `settled` prevents a late subscribe callback from re-exposing the
            // channel after the timeout has already fired and rejected the promise
            // (Copilot PR-150 r2950333912).
            let settled = false;
            const timeout = setTimeout(() => {
              if (settled) return;
              settled = true;
              // Unsubscribe AND remove from the Supabase client so the channel
              // doesn't remain registered and leak handlers on subsequent joins
              // (Copilot PR-150 r2950125715).
              void channel
                .unsubscribe()
                .then(() => supabase.removeChannel(channel))
                .catch(() => {
                  // Ensure the channel is removed even if unsubscribe rejects
                  // (Copilot PR-150 r3964546887).
                  supabase.removeChannel(channel);
                });
              // Guard: only clear reactive state if this channel is still active.
              // A concurrent joinChannel(differentRoomId) may have already replaced
              // channelRef.current; we must not clobber the newer channel.
              if (channelRef.current === channel) {
                channelRef.current = null;
                setRealtimeChannel(null);
              }
              reject(new Error('Subscription timeout after 10s'));
            }, 10000);

            channel.subscribe(async status => {
              networkLogger.info('[useRealtime] 📡 joinChannel subscription status:', status);

              if (status === 'SUBSCRIBED') {
                if (settled) return; // timeout already fired – ignore late SUBSCRIBED callbacks
                settled = true;
                clearTimeout(timeout);
                // Guard: if a newer joinChannel call has replaced channelRef.current,
                // this channel is stale — clean it up and settle the promise as a no-op
                // so the joiningChannelPromiseRef finally-block can clear correctly.
                if (channelRef.current !== channel) {
                  void channel
                    .unsubscribe()
                    .then(() => supabase.removeChannel(channel))
                    .catch(() => {
                      supabase.removeChannel(channel);
                    });
                  resolve(); // settle promise so callers don't hang indefinitely
                  return;
                }
                // Only expose channel to reactive consumers after subscription is
                // confirmed so that chat/send can't race against a still-connecting
                // channel (Copilot PR-150 r2950125694).
                setRealtimeChannel(channel);
                setIsConnected(true);
                networkLogger.info('[useRealtime] ✅ Channel subscribed successfully');

                // Track presence
                try {
                  await channel.track({
                    user_id: userId,
                    username,
                    online_at: new Date().toISOString(),
                  });
                } catch (trackErr: unknown) {
                  networkLogger.warn(
                    '[useRealtime] ⚠️ Presence track failed (non-fatal):',
                    trackErr
                  );
                  // Resolve anyway — the channel is subscribed; presence failure is
                  // non-fatal and will be retried when the component re-renders.
                }

                networkLogger.info(
                  '[useRealtime] ✅ Presence tracked, resolving joinChannel promise'
                );
                resolve();
              } else if (status === 'CLOSED') {
                // Always update reactive state — CLOSED can fire after a successful
                // SUBSCRIBED (e.g. server-side disconnect), so we must not gate this
                // on `settled` to avoid leaving isConnected/channel state stale.
                if (channelRef.current === channel) {
                  channelRef.current = null;
                  setRealtimeChannel(null);
                  setIsConnected(false);
                  onDisconnect?.();
                }
                // Best-effort cleanup: remove the closed channel from the Supabase
                // client to prevent ghost channel accumulation across reconnects.
                void channel
                  .unsubscribe()
                  .then(() => supabase.removeChannel(channel))
                  .catch(() => {
                    supabase.removeChannel(channel);
                  });
                // Only reject the initial promise if it hasn't been settled yet
                // (i.e. CLOSED fired before SUBSCRIBED / timeout in the connection race).
                if (!settled) {
                  settled = true;
                  clearTimeout(timeout);
                  reject(new Error('Channel closed'));
                }
              } else if (status === 'CHANNEL_ERROR') {
                // Always update reactive state — CHANNEL_ERROR can fire after SUBSCRIBED.
                if (channelRef.current === channel) {
                  channelRef.current = null;
                  setRealtimeChannel(null);
                  setIsConnected(false);
                  onDisconnect?.();
                }
                // Best-effort cleanup: remove the errored channel from the Supabase
                // client to prevent ghost channel accumulation on transient errors.
                void channel
                  .unsubscribe()
                  .then(() => supabase.removeChannel(channel))
                  .catch(() => {
                    supabase.removeChannel(channel);
                  });
                // Only reject the initial promise if it hasn't been settled yet.
                if (!settled) {
                  settled = true;
                  clearTimeout(timeout);
                  // Brief delay gives Supabase a window to recover from transient
                  // network blips before the caller triggers a full reconnect cycle.
                  setTimeout(() => reject(new Error('Channel error')), 1_000);
                }
              }
            });
          });

          // Note: broadcast handlers use gameStateRef.current (instead of the
          // captured gameState) so that joinChannel's identity stays stable across
          // game-state updates and does not trigger unnecessary reconnects.
        } finally {
          // Only clear the ref if it still points to this invocation. If a newer
          // joinChannel(roomId) call has already set a different entry, we must
          // not erase it — doing so would re-enable duplicate channel creation.
          if (joiningChannelPromiseRef.current?.promise === joinPromise) {
            joiningChannelPromiseRef.current = null;
          }
        }
      })();

      joiningChannelPromiseRef.current = { roomId, promise: joinPromise };
      return joinPromise;
    },
    [userId, username, onDisconnect, fetchPlayers, fetchGameState]
  ); // reconnect intentionally omitted to avoid circular dependency

  // 🏠 Room lobby operations (extracted hook)
  const { createRoom, joinRoom, leaveRoom, setReady, startGame } = useRoomLobby({
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
  const playCards = useCallback(
    async (cards: Card[], playerIndex?: number): Promise<void> => {
      if (!gameState) {
        throw new Error('Game state not loaded');
      }

      // Optimistic UI: immediately remove played cards from the human's displayed hand.
      // The Realtime postgres_changes subscription will correct the full game state
      // (~200ms after the EF updates the DB), so this snapshot is short-lived.
      // Only apply for human plays (playerIndex === undefined); bot plays go through
      // the same path but do not need an optimistic update.
      if (playerIndex === undefined) {
        const humanIndex = currentPlayer?.player_index;
        if (humanIndex !== undefined) {
          const cardIds = new Set(cards.map(c => c.id));
          setGameState(prev => {
            if (!prev) return prev;
            const handKey = String(humanIndex);
            return {
              ...prev,
              hands: {
                ...prev.hands,
                [handKey]: (prev.hands[handKey] ?? []).filter(c => !cardIds.has(c.id)),
              },
            };
          });
        }
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
          setGameState,
        });
      } catch (err) {
        const error = err as Error;
        setError(error);
        // FIX: Skip onError for bot plays (playerIndex provided) — bot errors are handled
        // by BotCoordinator's own catch block.
        // FIX: Also skip onError for human plays — the error is re-thrown to the caller
        // (useGameActions) which handles display. Calling onError here AND re-throwing
        // caused duplicate error popups.
        if (playerIndex !== undefined) {
          gameLogger.warn('[useRealtime] ⚠️ Bot play error (suppressed from UI):', error.message);
        } else {
          // Re-sync the hand in case the optimistic update was wrong (server rejected the play).
          // Fire-and-forget — the throw below surfaces the error to the UI immediately.
          if (room?.id) void fetchGameState(room.id).catch(() => {});
        }
        throw error;
      }
    },
    // refreshGameState replaced by inline fetchGameState(room.id) in error path (see above)
    [gameState, currentPlayer, roomPlayers, room, broadcastMessage, fetchGameState]
  );

  /**
   * Pass turn — thin wrapper around executePass (server Edge Function call)
   */
  const pass = useCallback(
    async (playerIndex?: number): Promise<void> => {
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
        // FIX: Also skip onError for human passes — the error is re-thrown to the caller
        // (useGameActions) which handles display. Calling onError here AND re-throwing
        // caused duplicate error popups.
        if (playerIndex !== undefined) {
          gameLogger.warn('[useRealtime] ⚠️ Bot pass error (suppressed from UI):', error.message);
        }
        throw error;
      }
    },
    [gameState, currentPlayer, roomPlayers, room, broadcastMessage, isAutoPassInProgress]
  );

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
      setTimeout(
        () => reconnect(),
        Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000)
      );
    }
    // joinChannel intentionally omitted to avoid circular dependency
  }, [room, onError, onReconnect]); // eslint-disable-line react-hooks/exhaustive-deps -- joinChannel intentionally omitted to avoid circular dependency

  /**
   * Connect to an existing room (called when navigating from Lobby -> Game).
   * This is used when the room is already 'playing' and you just need to join the channel.
   */
  const connectToRoom = useCallback(
    async (code: string): Promise<void> => {
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

        const timeoutPromise = new Promise<{ data: null; error: Error }>((_, reject) => {
          const timer = setTimeout(() => {
            reject(new Error('Room query timeout after 5 seconds'));
          }, 5000);
          queryPromise.finally(() => clearTimeout(timer));
        });

        const { data: existingRoom, error: roomError } = await Promise.race([
          queryPromise,
          timeoutPromise,
        ]);

        if (roomError || !existingRoom) {
          throw new Error(roomError?.message || 'Room not found');
        }

        // Ensure the caller is already in the room.
        // Also match human_user_id so a player whose seat was temporarily held by a
        // bot (replaced_by_bot path) can still establish the Realtime channel and
        // see the game while the RejoinModal prompts them to reclaim their seat.
        const { data: membership, error: membershipError } = await supabase
          .from('room_players')
          .select('id')
          .eq('room_id', existingRoom.id)
          .or(`user_id.eq.${userId},human_user_id.eq.${userId}`)
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
    },
    [userId, onError, joinChannel, fetchPlayers, fetchGameState]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (channelRef.current) {
        channelRef.current.unsubscribe();
        channelRef.current = null;
        setRealtimeChannel(null);
        setIsConnected(false);
      }
      // Remove all ghost room:* channels so they don't accumulate across game sessions
      // and trigger a CLOSED storm the next time the WebSocket reconnects.
      const roomGhosts = supabase
        .getChannels()
        .filter(ch => (ch as { topic?: string }).topic?.startsWith('realtime:room:'));
      if (roomGhosts.length > 0) {
        void Promise.allSettled(roomGhosts.map(gh => supabase.removeChannel(gh)));
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps -- timerIntervalRef.current is a plain mutable ref (not a DOM ref)
      if (timerIntervalRef.current) {
        // eslint-disable-next-line react-hooks/exhaustive-deps -- same ref, same reason
        clearInterval(timerIntervalRef.current);
      }
    };
  }, []);

  const refreshGameState = useCallback(async (): Promise<void> => {
    if (room?.id) {
      await fetchGameState(room.id);
    }
  }, [room?.id, fetchGameState]);

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
    isAutoPassInProgress,
    playerLastSeenAtRef,
    refreshGameState,
    channel: realtimeChannel,
    channelRef,
  };
}
