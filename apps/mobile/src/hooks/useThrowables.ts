/**
 * useThrowables — GG Poker–style fun throwables (egg / smoke / confetti).
 *
 * Listens for `throwable_sent` broadcast events on the existing room channel
 * and exposes a `sendThrowable` function. Manages per–display-position active
 * effects so GameView can render overlay animations on the correct player tile.
 *
 * Effects auto-dismiss after 5 seconds. The receiver (target) also gets an
 * `incomingThrowable` state for a full-screen popup, dismissible by double-tap.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { ThrowableType } from '../types/multiplayer';

/** Single active throwable effect rendered on a player's avatar tile. */
export interface ActiveThrowableEffect {
  /** Unique ID used as React key and for removal. */
  id: string;
  throwable: ThrowableType;
  /** Display name of the player who threw it. */
  from_name: string;
}

/** Full-screen popup state shown only to the target player. */
export interface IncomingThrowable {
  throwable: ThrowableType;
  from_name: string;
}

export interface UseThrowablesOptions {
  /** Reactive Supabase Realtime channel from useRealtime. */
  channel: RealtimeChannel | null;
  /** Current user's Supabase ID (to detect when we are the target). */
  userId: string;
  /** Current user's display name. */
  username: string;
  /**
   * layoutPlayers array from useMultiplayerLayout:
   *   [0] = local player (bottom)
   *   [1] = top
   *   [2] = left
   *   [3] = right
   * Each entry has `player_index` (game seat index).
   */
  layoutPlayers: readonly { player_index: number }[];
  /**
   * The game seat index of the local player. Used to detect if we are the
   * target without iterating layoutPlayers every time.
   */
  myPlayerIndex: number;
}

export interface UseThrowablesReturn {
  /**
   * Active effect for each display position (indexed 0-3 matching layoutPlayers).
   * null means no active effect for that position.
   */
  activeEffects: readonly (ActiveThrowableEffect | null)[];
  /** Set when the local player is the target — drives the full-screen popup. */
  incomingThrowable: IncomingThrowable | null;
  /** Dismiss the incoming full-screen popup (called on double-tap or after 5s). */
  dismissIncoming: () => void;
  /**
   * Broadcast a throwable to a specific game seat.
   * @param targetGameIndex Game seat index (player_index) of the target.
   * @param throwable The throwable type.
   */
  sendThrowable: (targetGameIndex: number, throwable: ThrowableType) => void;
}

/** How long (ms) an effect is shown on the avatar tile and the full-screen popup. */
const EFFECT_DURATION_MS = 5_000;

let _seqThrowable = 0;
function nextThrowableId(uid: string): string {
  _seqThrowable += 1;
  return `throwable_${uid}_${Date.now()}_${_seqThrowable}`;
}

export function useThrowables({
  channel,
  userId,
  username,
  layoutPlayers,
  myPlayerIndex,
}: UseThrowablesOptions): UseThrowablesReturn {
  // Four slots matching display positions 0-3.
  const [activeEffects, setActiveEffects] = useState<(ActiveThrowableEffect | null)[]>([
    null,
    null,
    null,
    null,
  ]);
  const [incomingThrowable, setIncomingThrowable] = useState<IncomingThrowable | null>(null);

  // Keep refs in sync so the broadcast handler doesn't capture stale closures.
  const layoutPlayersRef = useRef(layoutPlayers);
  const myPlayerIndexRef = useRef(myPlayerIndex);
  const userIdRef = useRef(userId);

  useEffect(() => {
    layoutPlayersRef.current = layoutPlayers;
  }, [layoutPlayers]);
  useEffect(() => {
    myPlayerIndexRef.current = myPlayerIndex;
  }, [myPlayerIndex]);
  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  // Auto-dismiss timers keyed by effect ID.
  const dismissTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const incomingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear all timers on unmount.
  useEffect(() => {
    return () => {
      Object.values(dismissTimersRef.current).forEach(t => clearTimeout(t));
      if (incomingTimerRef.current) clearTimeout(incomingTimerRef.current);
    };
  }, []);

  const scheduleEffectDismiss = useCallback((displaySlot: number, effectId: string) => {
    const timer = setTimeout(() => {
      setActiveEffects(prev => {
        const next = [...prev];
        if (next[displaySlot]?.id === effectId) next[displaySlot] = null;
        return next;
      });
      delete dismissTimersRef.current[effectId];
    }, EFFECT_DURATION_MS);
    dismissTimersRef.current[effectId] = timer;
  }, []);

  const dismissIncoming = useCallback(() => {
    if (incomingTimerRef.current) {
      clearTimeout(incomingTimerRef.current);
      incomingTimerRef.current = null;
    }
    setIncomingThrowable(null);
  }, []);

  // Subscribe to throwable_sent broadcasts.
  useEffect(() => {
    if (!channel) return;

    let isActive = true;

    const handler = (payload: {
      event?: string;
      data?: {
        thrower_id?: string;
        thrower_name?: string;
        target_player_index?: number;
        throwable?: ThrowableType;
      };
      timestamp?: string;
      payload?: {
        data?: {
          thrower_id?: string;
          thrower_name?: string;
          target_player_index?: number;
          throwable?: ThrowableType;
        };
      };
    }) => {
      if (!isActive) return;

      const raw = payload?.data ?? payload?.payload?.data;
      if (!raw) return;
      const { thrower_id, thrower_name, target_player_index, throwable } = raw;
      if (
        typeof thrower_id !== 'string' ||
        typeof thrower_name !== 'string' ||
        typeof target_player_index !== 'number' ||
        (throwable !== 'egg' && throwable !== 'smoke' && throwable !== 'confetti')
      ) {
        return;
      }

      // Find the display slot for this target (layoutPlayers is indexed by display position).
      const players = layoutPlayersRef.current;
      const displaySlot = players.findIndex(p => p.player_index === target_player_index);
      if (displaySlot === -1) return; // target not visible in this client's layout

      const effectId = nextThrowableId(thrower_id);
      const effect: ActiveThrowableEffect = {
        id: effectId,
        throwable,
        from_name: thrower_name,
      };

      setActiveEffects(prev => {
        const next = [...prev];
        // Cancel any existing auto-dismiss timer for this slot.
        const existing = next[displaySlot];
        if (existing && dismissTimersRef.current[existing.id]) {
          clearTimeout(dismissTimersRef.current[existing.id]);
          delete dismissTimersRef.current[existing.id];
        }
        next[displaySlot] = effect;
        return next;
      });

      scheduleEffectDismiss(displaySlot, effectId);

      // Show full-screen popup ONLY if we are the target.
      if (target_player_index === myPlayerIndexRef.current) {
        if (incomingTimerRef.current) clearTimeout(incomingTimerRef.current);
        setIncomingThrowable({ throwable, from_name: thrower_name });
        incomingTimerRef.current = setTimeout(() => {
          setIncomingThrowable(null);
          incomingTimerRef.current = null;
        }, EFFECT_DURATION_MS);
      }
    };

    channel.on('broadcast', { event: 'throwable_sent' }, handler);

    return () => {
      isActive = false;
      // Listener cleanup handled by useRealtime when the full channel unsubscribes.
    };
  }, [channel, scheduleEffectDismiss]);

  const sendThrowable = useCallback(
    (targetGameIndex: number, throwable: ThrowableType) => {
      if (!channel) return;

      channel
        .send({
          type: 'broadcast',
          event: 'throwable_sent',
          payload: {
            event: 'throwable_sent',
            data: {
              thrower_id: userIdRef.current,
              thrower_name: username,
              target_player_index: targetGameIndex,
              throwable,
            },
            timestamp: new Date().toISOString(),
          },
        })
        .catch(() => {
          // Non-fatal — throwables are best-effort fun features.
        });
    },
    [channel, username]
  );

  return {
    activeEffects,
    incomingThrowable,
    dismissIncoming,
    sendThrowable,
  };
}
