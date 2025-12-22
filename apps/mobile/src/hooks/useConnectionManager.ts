import { useState, useEffect, useCallback, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { supabase } from '../services/supabase';
import type { ConnectionStatus } from '../components/ConnectionStatusIndicator';

interface UseConnectionManagerOptions {
  roomId: string;
  userId: string;
  enabled: boolean;
}

interface UseConnectionManagerReturn {
  connectionStatus: ConnectionStatus;
  isReconnecting: boolean;
  reconnect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

/**
 * useConnectionManager - Manages player connection state and heartbeat
 * 
 * Features:
 * - Automatic heartbeat (every 5 seconds)
 * - Disconnect detection (no heartbeat for 15+ seconds)
 * - Bot replacement after grace period
 * - Reconnection logic (restores player from bot)
 * - App state tracking (pause/resume heartbeat)
 * 
 * Usage:
 * ```tsx
 * const { connectionStatus, reconnect } = useConnectionManager({
 *   roomId: 'abc123',
 *   userId: 'user-123',
 *   enabled: true,
 * });
 * ```
 */
export function useConnectionManager({
  roomId,
  userId,
  enabled,
}: UseConnectionManagerOptions): UseConnectionManagerReturn {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connected');
  const [isReconnecting, setIsReconnecting] = useState(false);
  
  const heartbeatIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appStateRef = useRef<AppStateStatus>('active');

  /**
   * Send heartbeat to update last_seen_at
   */
  const sendHeartbeat = useCallback(async () => {
    if (!enabled || !roomId || !userId) return;

    try {
      const { error } = await supabase.rpc('update_player_heartbeat', {
        p_room_id: roomId,
        p_user_id: userId,
      });

      if (!error) {
        setConnectionStatus('connected');
      } else {
        console.error('Heartbeat error:', error);
      }
    } catch (err) {
      console.error('Heartbeat exception:', err);
    }
  }, [enabled, roomId, userId]);

  /**
   * Mark player as disconnected
   */
  const disconnect = useCallback(async () => {
    if (!roomId || !userId) return;

    try {
      await supabase.rpc('mark_player_disconnected', {
        p_room_id: roomId,
        p_user_id: userId,
      });

      setConnectionStatus('disconnected');
    } catch (err) {
      console.error('Disconnect error:', err);
    }
  }, [roomId, userId]);

  /**
   * Reconnect player (restore from bot if replaced)
   */
  const reconnect = useCallback(async () => {
    if (!roomId || !userId) return;

    setIsReconnecting(true);
    setConnectionStatus('reconnecting');

    try {
      const { data, error } = await supabase.rpc('reconnect_player', {
        p_room_id: roomId,
        p_user_id: userId,
      });

      if (!error && data) {
        setConnectionStatus('connected');
        console.log('✅ Reconnected successfully');
        
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
  }, [roomId, userId, sendHeartbeat]);

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

      if (enabled && roomId && userId) {
        if (nextAppState === 'active' && previousAppState !== 'active') {
          // App came to foreground - reconnect
          console.log('📱 App resumed - reconnecting...');
          reconnect();
        } else if (nextAppState === 'background' || nextAppState === 'inactive') {
          // App went to background - pause heartbeat (but don't disconnect immediately)
          console.log('📱 App backgrounded - pausing heartbeat');
          stopHeartbeat();
        }
      }
    });

    return () => {
      subscription.remove();
    };
  }, [enabled, roomId, userId, reconnect, stopHeartbeat]);

  /**
   * Start/stop heartbeat based on enabled state
   */
  useEffect(() => {
    if (enabled && roomId && userId && appStateRef.current === 'active') {
      startHeartbeat();
    } else {
      stopHeartbeat();
    }

    return () => {
      stopHeartbeat();
    };
  }, [enabled, roomId, userId, startHeartbeat, stopHeartbeat]);

  /**
   * Listen for connection status changes from room_players
   */
  useEffect(() => {
    if (!enabled || !roomId || !userId) return;

    const channel = supabase
      .channel(`connection_status_${roomId}_${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'room_players',
          filter: `room_id=eq.${roomId},user_id=eq.${userId}`,
        },
        (payload) => {
          const newRecord = payload.new as { connection_status: string };
          
          if (newRecord.connection_status === 'replaced_by_bot') {
            console.log('🤖 Replaced by bot');
            setConnectionStatus('disconnected');
            stopHeartbeat();
          } else if (newRecord.connection_status === 'disconnected') {
            console.log('🔌 Marked as disconnected');
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
  }, [enabled, roomId, userId, stopHeartbeat]);

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      stopHeartbeat();
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [stopHeartbeat]);

  return {
    connectionStatus,
    isReconnecting,
    reconnect,
    disconnect,
  };
}
