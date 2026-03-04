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
}

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

  const heartbeatIntervalRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatCountRef     = useRef<number>(0);
  const appStateRef           = useRef<AppStateStatus>('active');

  // ── Helpers ──────────────────────────────────────────────────────────────

  const stopHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
  }, []);

  // ── Heartbeat ─────────────────────────────────────────────────────────────

  const sendHeartbeat = useCallback(async () => {
    if (!enabled || !roomId || !playerId) return;

    heartbeatCountRef.current += 1;

    try {
      const { data, error } = await supabase.functions.invoke('update-heartbeat', {
        body: {
          room_id:         roomId,
          player_id:       playerId,
          heartbeat_count: heartbeatCountRef.current,
        },
      });

      if (error) {
        console.warn('[useConnectionManager] heartbeat error:', error);
        return;
      }

      // Server detected we were replaced by a bot (user_id no longer matches)
      if (data?.replaced_by_bot) {
        setConnectionStatus('disconnected');
        stopHeartbeat();
        onBotReplaced?.();
        return;
      }

      if (data?.success) {
        setConnectionStatus('connected');
      }
    } catch (err) {
      console.warn('[useConnectionManager] heartbeat exception:', err);
    }
  }, [enabled, roomId, playerId, stopHeartbeat, onBotReplaced]);

  const startHeartbeat = useCallback(() => {
    stopHeartbeat();
    sendHeartbeat(); // immediate
    heartbeatIntervalRef.current = setInterval(sendHeartbeat, 5000);
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
        console.warn('[useConnectionManager] get-rejoin-status error:', error);
        return null;
      }

      const payload: RejoinStatusPayload = {
        status:       data.status,
        seconds_left: data.seconds_left,
        player_index: data.player_index,
        bot_username: data.bot_username,
      };

      setRejoinStatus(payload);
      return payload;
    } catch (err) {
      console.warn('[useConnectionManager] checkRejoinStatus exception:', err);
      return null;
    }
  }, [roomId]);

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
        console.error('[useConnectionManager] reconnect failed:', error || data?.error);
        setConnectionStatus('disconnected');
        return;
      }

      setConnectionStatus('connected');
      setRejoinStatus(null);
      startHeartbeat();
    } catch (err) {
      console.error('[useConnectionManager] reconnect exception:', err);
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
      console.error('[useConnectionManager] disconnect error:', err);
    }
  }, [roomId, playerId, stopHeartbeat]);

  // ── App state: foreground/background ─────────────────────────────────────

  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (nextAppState) => {
      const prev = appStateRef.current;
      appStateRef.current = nextAppState;

      if (!enabled || !roomId || !playerId) return;

      if (nextAppState === 'active' && prev !== 'active') {
        // App came to foreground — check server state before deciding what to do.
        // Do NOT call mark-disconnected or assume anything.
        const status = await checkRejoinStatus();

        if (!status) {
          // Network issue — cautiously resume heartbeat
          startHeartbeat();
          return;
        }

        switch (status.status) {
          case 'connected':
            // We never missed the window; just resume heartbeat
            startHeartbeat();
            break;

          case 'disconnected':
            // Still in grace period — reconnect immediately
            await reconnect();
            break;

          case 'replaced_by_bot':
            // Bot took over; surface "reclaim seat" UI
            setConnectionStatus('disconnected');
            onBotReplaced?.();
            break;

          case 'room_closed':
            onRoomClosed?.();
            break;

          default:
            startHeartbeat();
        }
      } else if (nextAppState === 'background' || nextAppState === 'inactive') {
        // App went to background.
        // Pause the heartbeat so we stop updating last_seen_at.
        // The server will detect the silence and eventually mark us disconnected.
        // We do NOT proactively call mark-disconnected here — reopening the app
        // would restart the 60-second timer, disrupting in-progress games.
        stopHeartbeat();
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
          event:  'UPDATE',
          schema: 'public',
          table:  'room_players',
          filter: `room_id=eq.${roomId},id=eq.${playerId}`,
        },
        (payload) => {
          const rec = payload.new as {
            connection_status: string;
            human_user_id?: string | null;
          };

          if (rec.connection_status === 'replaced_by_bot') {
            setConnectionStatus('disconnected');
            stopHeartbeat();
            onBotReplaced?.();
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

  return {
    connectionStatus,
    isReconnecting,
    isSpectator: false, // removed in fix/rejoin
    rejoinStatus,
    reconnect,
    disconnect,
  };
}


  /**
   * Send heartbeat to update last_seen_at
   * Note: playerId param is room_players.id (validated server-side against auth.uid())
   */
  const sendHeartbeat = useCallback(async () => {
    if (!enabled || !roomId || !playerId) return;

    try {
      const { data, error } = await supabase.functions.invoke('update-heartbeat', {
        body: {
          room_id: roomId,
          player_id: playerId, // playerId is room_players.id
        },
      });

      if (!error && data?.success) {
        setConnectionStatus('connected');
      } else {
        console.error('Heartbeat error:', error || data?.error);
      }
    } catch (err) {
      console.error('Heartbeat exception:', err);
    }
  }, [enabled, roomId, playerId]);

  /**
   * Mark player as disconnected
   * Note: playerId param is room_players.id (validated server-side against auth.uid())
   */
  const disconnect = useCallback(async () => {
    if (!roomId || !playerId) return;

    try {
      const { data, error } = await supabase.functions.invoke('mark-disconnected', {
        body: {
          room_id: roomId,
          player_id: playerId, // playerId is room_players.id
        },
      });

      if (!error && data?.success) {
        setConnectionStatus('disconnected');
      } else {
        console.error('Disconnect error:', error || data?.error);
      }
    } catch (err) {
      console.error('Disconnect error:', err);
    }
  }, [roomId, playerId]);

  /**
   * Reconnect player (restore from bot if replaced)
   */
  const reconnect = useCallback(async () => {
    if (!roomId || !playerId) return;

    setIsReconnecting(true);
    setConnectionStatus('reconnecting');

    try {
      const { data, error } = await supabase.functions.invoke('reconnect-player', {
        body: {
          room_id: roomId,
          player_id: playerId,
        },
      });

      if (!error && data?.success) {
        setConnectionStatus('connected');
        
        // Preserve spectator status from backend if provided
        const isSpectatorFromServer = data?.result?.is_spectator;
        if (typeof isSpectatorFromServer === 'boolean') {
          setIsSpectator(isSpectatorFromServer);
        } else {
          // Default: reconnected players are typically not spectators
          setIsSpectator(false);
        }
        
        // Resume heartbeat
        if (heartbeatIntervalRef.current) {
          clearInterval(heartbeatIntervalRef.current);
        }
        heartbeatIntervalRef.current = setInterval(sendHeartbeat, 5000);
        
        // Send immediate heartbeat
        await sendHeartbeat();
      } else {
        console.error('Reconnect failed:', error);
        setConnectionStatus('disconnected');
      }
    } catch (err) {
      console.error('Reconnect exception:', err);
      setConnectionStatus('disconnected');
    } finally {
      setIsReconnecting(false);
    }
  }, [roomId, playerId, sendHeartbeat]);

  /**
   * Start heartbeat interval
   */
  const startHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
    }

    // Send immediate heartbeat
    sendHeartbeat();

    // Start interval (every 5 seconds)
    heartbeatIntervalRef.current = setInterval(sendHeartbeat, 5000);
  }, [sendHeartbeat]);

  /**
   * Stop heartbeat interval
   */
  const stopHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
  }, []);

  /**
   * Handle app state changes (pause/resume heartbeat)
   */
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      const previousAppState = appStateRef.current;
      appStateRef.current = nextAppState;

      if (enabled && roomId && playerId) {
        if (nextAppState === 'active' && previousAppState !== 'active') {
          // App came to foreground - reconnect
          reconnect();
        } else if (nextAppState === 'background' || nextAppState === 'inactive') {
          // App went to background - pause heartbeat (but don't disconnect immediately)
          stopHeartbeat();
        }
      }
    });

    return () => {
      subscription.remove();
    };
  }, [enabled, roomId, playerId, reconnect, stopHeartbeat]);

  /**
   * Start/stop heartbeat based on enabled state
   */
  useEffect(() => {
    if (enabled && roomId && playerId && appStateRef.current === 'active') {
      startHeartbeat();
    } else {
      stopHeartbeat();
    }

    return () => {
      stopHeartbeat();
    };
  }, [enabled, roomId, playerId, startHeartbeat, stopHeartbeat]);

  /**
   * Listen for connection status changes from room_players
   */
  useEffect(() => {
    if (!enabled || !roomId || !playerId) return;

    const channel = supabase
      .channel(`connection_status_${roomId}_${playerId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'room_players',
          filter: `room_id=eq.${roomId},id=eq.${playerId}`,
        },
        (payload) => {
          const newRecord = payload.new as { connection_status: string };
          
          if (newRecord.connection_status === 'replaced_by_bot') {
            setConnectionStatus('disconnected');
            stopHeartbeat();
          } else if (newRecord.connection_status === 'disconnected') {
            setConnectionStatus('disconnected');
          } else if (newRecord.connection_status === 'connected') {
            setConnectionStatus('connected');
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, roomId, playerId, stopHeartbeat]);

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      stopHeartbeat();
      // eslint-disable-next-line react-hooks/exhaustive-deps -- reconnectTimeoutRef.current is a plain mutable ref (not a DOM ref); stale-value ref-in-cleanup warning is not applicable
      if (reconnectTimeoutRef.current) {
        // eslint-disable-next-line react-hooks/exhaustive-deps -- same ref, same reason
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [stopHeartbeat]);

  return {
    connectionStatus,
    isReconnecting,
    isSpectator,
    reconnect,
    disconnect,
  };
}
