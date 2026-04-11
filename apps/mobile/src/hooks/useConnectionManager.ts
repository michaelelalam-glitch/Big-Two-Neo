/**
 * useConnectionManager – Player connection lifecycle manager (fix/rejoin edition)
 *
 * Key design decisions
 * ─────────────────────
 * 1. HEARTBEAT ONLY (no client-side timer).
 *    The 60-second bot-replacement window is enforced entirely by the Postgres
 *    process_disconnected_players() function (pg_cron + heartbeat piggyback).
 *    The client never starts its own countdown.
 *
 * 2. APP-BACKGROUND ≠ DISCONNECT.
 *    When the OS backgrounds the app (swipe-up, incoming call, reopen) we
 *    simply stop sending heartbeats. The server will eventually mark the player
 *    disconnected (~30 s) and notify everyone via realtime. We do NOT call
 *    mark-disconnected on background — that would restart the 60 s timer on
 *    every app reopen and disrupt the game.
 *
 * 3. FOREGROUND → CHECK STATUS.
 *    When the app returns to the foreground we call get-rejoin-status to find
 *    out what happened while we were away, then react accordingly:
 *      - 'connected'      → resume heartbeat (nothing else needed)
 *      - 'disconnected'   → resume heartbeat immediately (we're back in time)
 *      - 'replaced_by_bot'→ surface "reclaim seat" UI via onBotReplaced callback
 *      - 'room_closed'    → surface "room closed" UI via onRoomClosed callback
 *
 * 4. EXPLICIT LEAVE (leaveRoom).
 *    The GameActions hook calls disconnect() which calls mark-disconnected only
 *    when the player intentionally navigates away.
 *
 * 5. OFFLINE ROOMS.
 *    The server skips all disconnect/replacement logic for offline rooms.
 *    The client behaves identically — heartbeats keep running so the rejoin
 *    path works transparently when connectivity is restored.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { supabase } from '../services/supabase';
import { networkLogger } from '../utils/logger';
import { trackConnection, trackEvent } from '../services/analytics';
import { sentryCapture } from '../services/sentry';
import type { ConnectionStatus } from '../components/ConnectionStatusIndicator';

// ─── Types ───────────────────────────────────────────────────────────────────

export type RejoinStatus =
  | 'connected'
  | 'disconnected'
  | 'replaced_by_bot'
  | 'room_closed'
  | 'not_in_room';

export interface RejoinStatusPayload {
  status: RejoinStatus;
  /** Seconds left before bot replaces player (status = 'disconnected') */
  seconds_left?: number;
  player_index?: number;
  bot_username?: string;
}

interface UseConnectionManagerOptions {
  roomId: string;
  /** room_players.id — NOT auth.uid() */
  playerId: string;
  enabled: boolean;
  /**
   * P2-6 FIX: Current game phase. When set to 'finished' or 'game_over' the
   * heartbeat is stopped automatically to avoid wasted network traffic in
   * completed rooms.
   */
  gamePhase?: string | null;
  /** Called when the server confirms a bot has taken this player's seat */
  onBotReplaced?: () => void;
  /** Called when the room was closed while the player was away */
  onRoomClosed?: () => void;
}

interface UseConnectionManagerReturn {
  connectionStatus: ConnectionStatus;
  isReconnecting: boolean;
  /** @deprecated always false – spectator mode removed in fix/rejoin */
  isSpectator: boolean;
  rejoinStatus: RejoinStatusPayload | null;
  /** Reconnect / reclaim seat */
  reconnect: () => Promise<void>;
  /** Explicit leave — only call when the player intentionally exits */
  disconnect: () => Promise<void>;
  /**
   * Immediately triggers process_disconnected_players() via update-heartbeat.
   * Call this when another player's disconnect countdown ring expires so bot
   * replacement happens at once instead of waiting up to 30s for the next
   * scheduled piggyback sweep.
   */
  forceSweep: () => void;
  /**
   * Stop the periodic heartbeat without calling mark-disconnected.
   * Use this when the server has already replaced the player with a bot
   * (e.g. after auto-play-turn) to prevent heartbeats from overwriting
   * connection_status='replaced_by_bot'.
   */
  stopHeartbeats: () => void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Normal heartbeat polling cadence (ms). */
const HEARTBEAT_NORMAL_INTERVAL = 5_000;
/**
 * Backed-off polling cadence used after HEARTBEAT_BACKOFF_THRESHOLD consecutive
 * failures (ms). The base interval stays at 5 s but requests are rate-limited so
 * only one attempt per 30 s is actually sent to the edge function.
 */
const HEARTBEAT_BACKOFF_INTERVAL = 30_000;
/** Number of consecutive failures before backoff + 'reconnecting' status kicks in. */
const HEARTBEAT_BACKOFF_THRESHOLD = 3;
/**
 * P2-2 FIX: Debounce delay before transitioning away from 'connected' to 'reconnecting'.
 * A briefly flaky network can cause rapid connected→reconnecting→connected flicker in
 * the UI indicator. A 2-second debounce suppresses transient blips that self-resolve.
 */
const RECONNECTING_DEBOUNCE_MS = 2_000;

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useConnectionManager({
  roomId,
  playerId,
  enabled,
  gamePhase,
  onBotReplaced,
  onRoomClosed,
}: UseConnectionManagerOptions): UseConnectionManagerReturn {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connected');
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [rejoinStatus, setRejoinStatus] = useState<RejoinStatusPayload | null>(null);

  // Track the previous DB-reported connection_status so we only fire
  // the analytics 'reconnect' event on an actual transition (e.g. disconnected →
  // connected), not on every routine heartbeat UPDATE that keeps writing 'connected'.
  const prevDbConnectionStatusRef = useRef<string>('connected');

  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatCountRef = useRef<number>(0);
  const consecutiveFailuresRef = useRef<number>(0);
  const heartbeatBackedOffRef = useRef<boolean>(false);
  const appStateRef = useRef<AppStateStatus>('active');
  // P2-2 FIX: Pending timeout for debounced 'reconnecting' transition.
  // Cleared immediately if a successful heartbeat arrives within the debounce window,
  // preventing the indicator from flickering for brief network blips.
  const reconnectingDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refs for callbacks used inside AppState/Realtime listeners
  // to avoid stale closures when parent re-renders with new callback instances.
  const onBotReplacedRef = useRef(onBotReplaced);
  const onRoomClosedRef = useRef(onRoomClosed);
  onBotReplacedRef.current = onBotReplaced;
  onRoomClosedRef.current = onRoomClosed;

  // ── Helpers ──────────────────────────────────────────────────────────────

  const stopHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    // P2-2: Also cancel any pending reconnecting debounce so it cannot fire
    // after the heartbeat is intentionally stopped (e.g. on disconnect/unmount).
    if (reconnectingDebounceRef.current) {
      clearTimeout(reconnectingDebounceRef.current);
      reconnectingDebounceRef.current = null;
    }
  }, []);

  // P2-6 FIX: Stop heartbeats when the game has finished/ended to avoid wasted
  // network traffic in rooms that are no longer active.
  useEffect(() => {
    if (gamePhase === 'finished' || gamePhase === 'game_over') {
      networkLogger.debug(
        '[ConnectionManager] Game ended — stopping heartbeats (phase=%s)',
        gamePhase
      );
      stopHeartbeat();
    }
  }, [gamePhase, stopHeartbeat]);

  // P2-2 FIX: Debounced transition to 'reconnecting'. Clears any pending debounce when
  // the connection recovers so brief blips don't trigger the indicator.
  const scheduleReconnectingStatus = useCallback(() => {
    if (reconnectingDebounceRef.current) return; // already pending
    reconnectingDebounceRef.current = setTimeout(() => {
      reconnectingDebounceRef.current = null;
      setConnectionStatus('reconnecting');
    }, RECONNECTING_DEBOUNCE_MS);
  }, []);

  const cancelReconnectingDebounce = useCallback(() => {
    if (reconnectingDebounceRef.current) {
      clearTimeout(reconnectingDebounceRef.current);
      reconnectingDebounceRef.current = null;
    }
  }, []);

  // ── Heartbeat ─────────────────────────────────────────────────────────────

  // Earliest time the next heartbeat attempt may fire (enforces backoff rate-limit).
  const nextHeartbeatAllowedAtRef = useRef<number>(0);

  // Ref to the latest reconnect function — avoids including it in sendHeartbeat's
  // dep array (reconnect is defined later in the hook; a direct dep creates a
  // forward-reference / circular-dep lint warning). The ref is kept current via
  // a useEffect below once reconnect is in scope.
  const reconnectRef = useRef<() => Promise<void>>(async () => {});

  const sendHeartbeat = useCallback(async () => {
    if (!enabled || !roomId || !playerId) return;

    // Rate-limit: when in backoff mode, skip ticks until the backoff interval elapses.
    if (Date.now() < nextHeartbeatAllowedAtRef.current) return;
    nextHeartbeatAllowedAtRef.current =
      Date.now() +
      (heartbeatBackedOffRef.current ? HEARTBEAT_BACKOFF_INTERVAL : HEARTBEAT_NORMAL_INTERVAL);

    heartbeatCountRef.current += 1;

    try {
      const { data, error } = await supabase.functions.invoke('update-heartbeat', {
        body: {
          room_id: roomId,
          player_id: playerId,
          heartbeat_count: heartbeatCountRef.current,
        },
      });

      if (error) {
        consecutiveFailuresRef.current += 1;
        const failures = consecutiveFailuresRef.current;

        // Only log once the backoff threshold is reached to avoid LogBox noise
        // from single transient network blips (e.g., simulator, brief offline).
        if (failures >= HEARTBEAT_BACKOFF_THRESHOLD) {
          if (failures === HEARTBEAT_BACKOFF_THRESHOLD) {
            networkLogger.warn(
              `[useConnectionManager] ${failures} consecutive heartbeat failures — ` +
                `backing off to ${HEARTBEAT_BACKOFF_INTERVAL / 1000}s interval`,
              error
            );
          }
          // Mark connection as degraded so the UI shows the reconnecting indicator.
          // P2-2 FIX: Debounced — a brief blip that self-resolves within 2s won't
          // flicker the indicator. If the next heartbeat succeeds first it will
          // call cancelReconnectingDebounce() before the timeout fires.
          scheduleReconnectingStatus();
          heartbeatBackedOffRef.current = true;
          trackEvent('heartbeat_backoff', { consecutive_failures: failures });
          sentryCapture.breadcrumb('Heartbeat backoff', { failures }, 'connection');
        }
        return;
      }

      // ── Success path ───────────────────────────────────────────────────────
      if (consecutiveFailuresRef.current > 0) {
        if (heartbeatBackedOffRef.current) {
          networkLogger.info(
            '[useConnectionManager] heartbeat recovered — restoring normal interval'
          );
          heartbeatBackedOffRef.current = false;
          // 6.3: Reset the rate-limiter so the next heartbeat fires immediately
          // instead of waiting up to HEARTBEAT_BACKOFF_INTERVAL (30 s) for the
          // already-elapsed backoff window to expire.
          nextHeartbeatAllowedAtRef.current = 0;
        }
        consecutiveFailuresRef.current = 0;
      }
      // P2-2 FIX: Cancel any pending reconnecting debounce on success so a brief
      // blip that self-resolved within 2 s doesn't trigger the indicator.
      cancelReconnectingDebounce();

      // Server detected we were replaced by a bot (user_id no longer matches)
      if (data?.replaced_by_bot) {
        setConnectionStatus('replaced_by_bot');
        stopHeartbeat();
        trackEvent('player_replaced_by_bot', { room_id: roomId });
        sentryCapture.breadcrumb('Replaced by bot', { room_id: roomId }, 'connection');
        onBotReplacedRef.current?.();
        return;
      }

      // Heartbeat UPDATE was skipped because the row is already 'disconnected'
      // (mark-disconnected fired before this tick, or Phase A ran while we were
      // in-game with a transient network disruption). The neq guard in
      // update-heartbeat prevents the heartbeat from silently clearing the
      // disconnected status. We must call reconnect() explicitly.
      if (data?.is_disconnected) {
        stopHeartbeat();
        void reconnectRef.current();
        return;
      }

      if (data?.success) {
        setConnectionStatus('connected');
      }
    } catch (err) {
      // Network-level throw (some Supabase client versions throw instead of returning { error })
      consecutiveFailuresRef.current += 1;
      const failures = consecutiveFailuresRef.current;
      if (failures >= HEARTBEAT_BACKOFF_THRESHOLD) {
        if (failures === HEARTBEAT_BACKOFF_THRESHOLD) {
          networkLogger.warn('[useConnectionManager] heartbeat exception:', err);
        }
        scheduleReconnectingStatus();
        heartbeatBackedOffRef.current = true;
        trackEvent('heartbeat_backoff', { consecutive_failures: failures });
        sentryCapture.breadcrumb('Heartbeat backoff (exception)', { failures }, 'connection');
      }
    }
  }, [
    enabled,
    roomId,
    playerId,
    stopHeartbeat,
    scheduleReconnectingStatus,
    cancelReconnectingDebounce,
  ]);

  const startHeartbeat = useCallback(() => {
    stopHeartbeat();
    // Reset backoff + failure state whenever heartbeat is explicitly restarted
    // (e.g. on app foreground, on reconnect) so the next sequence starts fresh.
    consecutiveFailuresRef.current = 0;
    heartbeatBackedOffRef.current = false;
    nextHeartbeatAllowedAtRef.current = 0; // allow immediately
    // P2-2 FIX: Cancel any pending debounced reconnecting transition when the
    // heartbeat explicitly restarts (foreground restore, reconnect complete).
    cancelReconnectingDebounce();
    sendHeartbeat(); // immediate first beat
    heartbeatIntervalRef.current = setInterval(sendHeartbeat, HEARTBEAT_NORMAL_INTERVAL);
  }, [sendHeartbeat, stopHeartbeat, cancelReconnectingDebounce]);

  // ── Rejoin status check ───────────────────────────────────────────────────

  /**
   * Ask the server what state we're in. Called on app-foreground.
   * Does NOT modify the DB — purely a read.
   */
  const checkRejoinStatus = useCallback(async (): Promise<RejoinStatusPayload | null> => {
    if (!roomId) return null;

    try {
      const { data, error } = await supabase.functions.invoke('get-rejoin-status', {
        body: { room_id: roomId },
      });

      if (error || !data?.success) {
        networkLogger.warn('[useConnectionManager] get-rejoin-status error:', error);
        return null;
      }

      const payload: RejoinStatusPayload = {
        status: data.status,
        seconds_left: data.seconds_left,
        player_index: data.player_index,
        bot_username: data.bot_username,
      };

      setRejoinStatus(payload);
      return payload;
    } catch (err) {
      networkLogger.warn('[useConnectionManager] checkRejoinStatus exception:', err);
      return null;
    }
  }, [roomId]);

  // Keep stable refs for internal callbacks so effects always call the latest version
  const checkRejoinStatusRef = useRef(checkRejoinStatus);
  const startHeartbeatRef = useRef(startHeartbeat);
  const stopHeartbeatRef = useRef(stopHeartbeat);
  checkRejoinStatusRef.current = checkRejoinStatus;
  startHeartbeatRef.current = startHeartbeat;
  stopHeartbeatRef.current = stopHeartbeat;

  // ── Reconnect / reclaim ───────────────────────────────────────────────────

  /**
   * Reconnect to the game. Works in two modes:
   *   1. Player was merely disconnected (not yet replaced)  → just resumes heartbeat
   *   2. Bot replaced the player                           → reclaims the seat first
   */
  const reconnect = useCallback(async () => {
    if (!roomId || !playerId) return;

    setIsReconnecting(true);
    setConnectionStatus('reconnecting');

    try {
      const { data, error } = await supabase.functions.invoke('reconnect-player', {
        body: { room_id: roomId },
      });

      if (error || !data?.success) {
        if (data?.room_closed) {
          onRoomClosed?.();
          return;
        }
        networkLogger.error('[useConnectionManager] reconnect failed:', error || data?.error);
        setConnectionStatus('disconnected');
        trackEvent('reconnect_failed', { room_id: roomId });
        sentryCapture.message(`Reconnect failed: ${String(error || data?.error || 'unknown')}`, {
          context: 'Reconnect',
          level: 'warning',
        });
        return;
      }

      setConnectionStatus('connected');
      setRejoinStatus(null);
      startHeartbeat();
      trackEvent('reconnect_succeeded', { room_id: roomId });
      sentryCapture.breadcrumb('Reconnect succeeded', { room_id: roomId }, 'connection');
    } catch (err) {
      networkLogger.error('[useConnectionManager] reconnect exception:', err);
      setConnectionStatus('disconnected');
      trackEvent('reconnect_failed', { room_id: roomId });
      sentryCapture.exception(err instanceof Error ? err : new Error(String(err)), {
        context: 'Reconnect',
      });
    } finally {
      setIsReconnecting(false);
    }
  }, [roomId, playerId, startHeartbeat, onRoomClosed]);

  // Keep reconnectRef current so sendHeartbeat always calls the latest closure.
  useEffect(() => {
    reconnectRef.current = reconnect;
  }, [reconnect]);

  // ── Explicit disconnect (intentional leave) ───────────────────────────────

  const disconnect = useCallback(async () => {
    stopHeartbeat();
    if (!roomId || !playerId) return;

    try {
      await supabase.functions.invoke('mark-disconnected', {
        body: { room_id: roomId, player_id: playerId },
      });
      setConnectionStatus('disconnected');
      trackConnection('disconnect', { room_id: roomId, reason: 'intentional_leave' });
      sentryCapture.breadcrumb('Intentional disconnect', { room_id: roomId }, 'connection');
    } catch (err) {
      networkLogger.error('[useConnectionManager] disconnect error:', err);
    }
  }, [roomId, playerId, stopHeartbeat]);

  // ── App state: foreground/background ─────────────────────────────────────

  useEffect(() => {
    const subscription = AppState.addEventListener('change', async nextAppState => {
      const prev = appStateRef.current;
      appStateRef.current = nextAppState;

      if (!enabled || !roomId || !playerId) return;

      if (nextAppState === 'active' && prev !== 'active') {
        trackEvent('app_state_changed', { from: prev, to: 'active' });
        // App came to foreground — check server state before deciding what to do.
        // Do NOT call mark-disconnected or assume anything.
        const status = await checkRejoinStatusRef.current();

        if (!status) {
          // Network issue — cautiously resume heartbeat
          startHeartbeatRef.current();
          return;
        }

        switch (status.status) {
          case 'connected':
            // We never missed the window; just resume heartbeat
            startHeartbeatRef.current();
            break;

          case 'disconnected':
            // Still in grace period. With the neq('connection_status','disconnected')
            // guard now in update-heartbeat, simply resuming the heartbeat can no
            // longer flip the row back to 'connected' — we must call reconnect()
            // which invokes reconnect-player explicitly and then restarts the heartbeat.
            // reconnect_player handles both in-grace-period (was_replaced=false) and
            // bot-already-took-over (was_replaced=true) transparently.
            void reconnect();
            break;

          case 'replaced_by_bot':
            // Bot took over; surface "reclaim seat" UI
            setConnectionStatus('disconnected');
            onBotReplacedRef.current?.();
            break;

          case 'room_closed':
            onRoomClosedRef.current?.();
            break;

          default:
            startHeartbeatRef.current();
        }
      } else if (nextAppState === 'background' || nextAppState === 'inactive') {
        trackEvent('app_state_changed', { from: prev, to: nextAppState });
        // App went to background.
        // Pause the heartbeat so we stop updating last_seen_at.
        // The server will detect the silence and eventually mark us disconnected.
        // We do NOT proactively call mark-disconnected here — reopening the app
        // would restart the 60-second timer, disrupting in-progress games.
        stopHeartbeatRef.current();
      }
    });

    return () => subscription.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, roomId, playerId]);

  // ── Memory warning: release non-essential resources ────────────────────────
  useEffect(() => {
    const handleMemoryPressure = () => {
      networkLogger.warn('[useConnectionManager] Memory pressure — releasing resources');
      // soundManager is imported lazily to avoid circular deps;
      // fire-and-forget cleanup is fine here.
      import('../utils/soundManager').then(m => m.soundManager.cleanup()).catch(() => {});
    };

    // iOS fires 'memoryWarning' via AppState; Android requires a native bridge
    // module to forward ComponentCallbacks2.onTrimMemory() into JS. Since that
    // native module is not yet implemented, memory-pressure handling on Android
    // relies on the OS reclaiming resources directly.
    // TODO: implement a TrimMemoryModule native module to emit this event.
    const iosSub = AppState.addEventListener('memoryWarning', handleMemoryPressure);

    return () => {
      iosSub.remove();
    };
  }, []);

  // ── Start heartbeat on mount ──────────────────────────────────────────────

  useEffect(() => {
    if (enabled && roomId && playerId && appStateRef.current === 'active') {
      startHeartbeat();
    } else {
      stopHeartbeat();
    }

    return () => {
      stopHeartbeat();
      cancelReconnectingDebounce();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, roomId, playerId]);

  // ── Realtime: listen for own row changes ─────────────────────────────────

  useEffect(() => {
    if (!enabled || !roomId || !playerId) return;

    const channel = supabase
      .channel(`conn_mgr_${roomId}_${playerId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'room_players',
          filter: `id=eq.${playerId}`,
        },
        payload => {
          const rec = payload.new as {
            connection_status: string;
            human_user_id?: string | null;
          };

          if (rec.connection_status === 'replaced_by_bot') {
            prevDbConnectionStatusRef.current = 'replaced_by_bot';
            setConnectionStatus('disconnected');
            stopHeartbeatRef.current();
            trackEvent('player_replaced_by_bot', { room_id: roomId, source: 'realtime' });
            onBotReplacedRef.current?.();
          } else if (rec.connection_status === 'disconnected') {
            prevDbConnectionStatusRef.current = 'disconnected';
            setConnectionStatus('disconnected');
            trackConnection('disconnect', { room_id: roomId, source: 'realtime' });
          } else if (rec.connection_status === 'connected') {
            // Only fire 'reconnect' when there was an actual transition FROM a
            // non-connected state. Every heartbeat writes 'connected' to DB, which
            // triggers this Realtime listener — without this guard, 'reconnect' would
            // fire every 5 s and flood Firebase Analytics / DebugView.
            const wasDisconnected = prevDbConnectionStatusRef.current !== 'connected';
            prevDbConnectionStatusRef.current = 'connected';
            setConnectionStatus('connected');
            if (wasDisconnected) {
              trackConnection('reconnect', { room_id: roomId, source: 'realtime' });
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, roomId, playerId]);

  // ── Cleanup ───────────────────────────────────────────────────────────────

  useEffect(() => {
    return stopHeartbeat;
  }, [stopHeartbeat]);

  const forceSweep = useCallback(() => {
    if (!enabled || !roomId || !playerId) return;
    // Fire-and-forget: send a heartbeat with force_sweep=true so the server
    // runs process_disconnected_players() immediately (no count%6 gate).
    supabase.functions
      .invoke('update-heartbeat', {
        body: {
          room_id: roomId,
          player_id: playerId,
          heartbeat_count: heartbeatCountRef.current,
          force_sweep: true,
        },
      })
      .catch((err: unknown) => {
        networkLogger.warn('[useConnectionManager] forceSweep error:', err);
      });
  }, [enabled, roomId, playerId]);

  return {
    connectionStatus,
    isReconnecting,
    isSpectator: false, // removed in fix/rejoin
    rejoinStatus,
    reconnect,
    disconnect,
    forceSweep,
    stopHeartbeats: stopHeartbeat,
  };
}
