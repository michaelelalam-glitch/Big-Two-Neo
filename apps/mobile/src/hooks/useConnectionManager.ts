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

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useConnectionManager({
  roomId,
  playerId,
  enabled,
  onBotReplaced,
  onRoomClosed,
}: UseConnectionManagerOptions): UseConnectionManagerReturn {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connected');
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [rejoinStatus, setRejoinStatus] = useState<RejoinStatusPayload | null>(null);

  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatCountRef = useRef<number>(0);
  const consecutiveFailuresRef = useRef<number>(0);
  const heartbeatBackedOffRef = useRef<boolean>(false);
  const appStateRef = useRef<AppStateStatus>('active');

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
  }, []);

  // ── Heartbeat ─────────────────────────────────────────────────────────────

  // Earliest time the next heartbeat attempt may fire (enforces backoff rate-limit).
  const nextHeartbeatAllowedAtRef = useRef<number>(0);

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
          setConnectionStatus('reconnecting');
          heartbeatBackedOffRef.current = true;
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
        }
        consecutiveFailuresRef.current = 0;
      }

      // Server detected we were replaced by a bot (user_id no longer matches)
      if (data?.replaced_by_bot) {
        setConnectionStatus('disconnected');
        stopHeartbeat();
        onBotReplacedRef.current?.();
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
        setConnectionStatus('reconnecting');
        heartbeatBackedOffRef.current = true;
      }
    }
  }, [enabled, roomId, playerId, stopHeartbeat]);

  const startHeartbeat = useCallback(() => {
    stopHeartbeat();
    // Reset backoff + failure state whenever heartbeat is explicitly restarted
    // (e.g. on app foreground, on reconnect) so the next sequence starts fresh.
    consecutiveFailuresRef.current = 0;
    heartbeatBackedOffRef.current = false;
    nextHeartbeatAllowedAtRef.current = 0; // allow immediately
    sendHeartbeat(); // immediate first beat
    heartbeatIntervalRef.current = setInterval(sendHeartbeat, HEARTBEAT_NORMAL_INTERVAL);
  }, [sendHeartbeat, stopHeartbeat]);

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
        return;
      }

      setConnectionStatus('connected');
      setRejoinStatus(null);
      startHeartbeat();
    } catch (err) {
      networkLogger.error('[useConnectionManager] reconnect exception:', err);
      setConnectionStatus('disconnected');
    } finally {
      setIsReconnecting(false);
    }
  }, [roomId, playerId, startHeartbeat, onRoomClosed]);

  // ── Explicit disconnect (intentional leave) ───────────────────────────────

  const disconnect = useCallback(async () => {
    stopHeartbeat();
    if (!roomId || !playerId) return;

    try {
      await supabase.functions.invoke('mark-disconnected', {
        body: { room_id: roomId, player_id: playerId },
      });
      setConnectionStatus('disconnected');
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
            // Still in grace period — just resume heartbeat.
            // The update-heartbeat edge function will set connection_status back
            // to 'connected' without clearing disconnect_timer_started_at.
            // This ensures the persistent 60-second server-side timer is NOT reset
            // by merely reopening the app. Only an explicit rejoin (button press)
            // or active game action (play/pass) clears the timer.
            startHeartbeatRef.current();
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

  // ── Start heartbeat on mount ──────────────────────────────────────────────

  useEffect(() => {
    if (enabled && roomId && playerId && appStateRef.current === 'active') {
      startHeartbeat();
    } else {
      stopHeartbeat();
    }

    return stopHeartbeat;
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
            setConnectionStatus('disconnected');
            stopHeartbeatRef.current();
            onBotReplacedRef.current?.();
          } else if (rec.connection_status === 'disconnected') {
            setConnectionStatus('disconnected');
          } else if (rec.connection_status === 'connected') {
            setConnectionStatus('connected');
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
