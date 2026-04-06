/**
 * useThrowables — GG Poker–style fun throwables (egg / smoke / confetti).
 *
 * Listens for `throwable_sent` broadcast events on the existing room channel
 * and exposes a `sendThrowable` function. Manages per–display-position active
 * effects so GameView can render overlay animations on the correct player tile.
 *
 * Features:
 * - Per-slot effect queue: simultaneous throwables are shown sequentially.
 * - Local echo: the thrower sees the animation immediately (Supabase broadcast
 *   does not echo sends back to the sender).
 * - 30-second cooldown with countdown after each throw.
 * - Effects auto-dismiss after 5 seconds. The receiver also gets a full-screen
 *   popup (`incomingThrowable`), dismissible by double-tap.
 *
 * Rate Limiting:
 * - Client-side: 30s cooldown per user (persisted via AsyncStorage).
 * - Receiver-side: dedup within 30s window prevents replay/duplicate animations.
 * - Server-side: Throwables use Supabase Realtime broadcast (peer-to-peer via
 *   server relay). No Edge Function validation layer exists because throwables
 *   are purely cosmetic — they cannot affect game state, scores, or rank points.
 *   Accepted risk: a malicious client bypassing the cooldown could spam throwable
 *   animations. Impact is limited to visual annoyance with no gameplay effect.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { ThrowableType } from '../types/multiplayer';
import { trackEvent } from '../services/analytics';

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
  /** True while the 30-second post-throw cooldown is active. */
  isThrowCooldown: boolean;
  /** Seconds remaining in the cooldown (0 when not in cooldown). */
  cooldownRemaining: number;
}

/** How long (ms) an effect is shown on the avatar tile and the full-screen popup. */
const EFFECT_DURATION_MS = 5_000;
/** Cooldown after throwing (ms). */
const COOLDOWN_MS = 30_000;
const COOLDOWN_SECS = 30;

/** AsyncStorage key for persisting cooldown end timestamp, scoped per user. */
function cooldownStorageKey(uid: string): string {
  return `throwable_cooldown_end_${uid}`;
}

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
  const [isThrowCooldown, setIsThrowCooldown] = useState(false);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);

  // Keep refs in sync so broadcast handlers don't capture stale closures.
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
  const cooldownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cooldownEndRef = useRef<number>(0);
  const isCooldownActiveRef = useRef(false);

  // Per-slot effect queues. Each slot has an array of pending effects and a flag
  // indicating whether something is currently showing.
  const effectQueuesRef = useRef<ActiveThrowableEffect[][]>([[], [], [], []]);
  const slotActiveIdRef = useRef<(string | null)[]>([null, null, null, null]);

  // Stable ref to the recursive slot-starter so it can call itself without
  // capturing stale closures. Set once on mount.
  const startNextRef = useRef<(slot: number) => void>(() => {});

  useEffect(() => {
    startNextRef.current = (displaySlot: number) => {
      const queue = effectQueuesRef.current[displaySlot];
      if (!queue || queue.length === 0) {
        slotActiveIdRef.current[displaySlot] = null;
        setActiveEffects(prev => {
          const next = [...prev];
          next[displaySlot] = null;
          return next;
        });
        return;
      }
      const effect = queue.shift()!;
      slotActiveIdRef.current[displaySlot] = effect.id;
      setActiveEffects(prev => {
        const arr = [...prev];
        arr[displaySlot] = effect;
        return arr;
      });
      const timer = setTimeout(() => {
        delete dismissTimersRef.current[effect.id];
        startNextRef.current(displaySlot);
      }, EFFECT_DURATION_MS);
      dismissTimersRef.current[effect.id] = timer;
    };
  }, []); // setActiveEffects is stable; other dependencies are refs

  const enqueueEffect = useCallback((displaySlot: number, effect: ActiveThrowableEffect) => {
    effectQueuesRef.current[displaySlot]!.push(effect);
    // Start playing immediately if nothing is currently showing for this slot.
    if (slotActiveIdRef.current[displaySlot] === null) {
      startNextRef.current(displaySlot);
    }
  }, []);

  // Clear all timers on unmount.
  useEffect(() => {
    const timers = dismissTimersRef.current;
    return () => {
      Object.values(timers).forEach(t => clearTimeout(t));
      if (incomingTimerRef.current) clearTimeout(incomingTimerRef.current);
      if (cooldownIntervalRef.current) clearInterval(cooldownIntervalRef.current);
    };
  }, []);

  // Restore cooldown state on mount (survives disconnect/reconnect).
  useEffect(() => {
    void (async () => {
      try {
        const stored = await AsyncStorage.getItem(cooldownStorageKey(userId));
        if (!stored) return;
        const endTime = Number(stored);
        const remaining = Math.ceil((endTime - Date.now()) / 1000);
        if (remaining > 0) {
          isCooldownActiveRef.current = true;
          cooldownEndRef.current = endTime;
          setIsThrowCooldown(true);
          setCooldownRemaining(remaining);
          if (cooldownIntervalRef.current) clearInterval(cooldownIntervalRef.current);
          cooldownIntervalRef.current = setInterval(() => {
            const r = Math.ceil((cooldownEndRef.current - Date.now()) / 1000);
            if (r <= 0) {
              isCooldownActiveRef.current = false;
              clearInterval(cooldownIntervalRef.current!);
              cooldownIntervalRef.current = null;
              setIsThrowCooldown(false);
              setCooldownRemaining(0);
              void AsyncStorage.removeItem(cooldownStorageKey(userId)).catch(() => {});
            } else {
              setCooldownRemaining(r);
            }
          }, 500);
        } else {
          // Expired while away — clean up
          void AsyncStorage.removeItem(cooldownStorageKey(userId)).catch(() => {});
        }
      } catch {
        /* best-effort */
      }
    })();
  }, [userId]); // Re-run when userId changes to restore the correct user's cooldown

  const startCooldown = useCallback(() => {
    isCooldownActiveRef.current = true;
    const endTime = Date.now() + COOLDOWN_MS;
    cooldownEndRef.current = endTime;
    setIsThrowCooldown(true);
    setCooldownRemaining(COOLDOWN_SECS);

    // Persist cooldown end time so it survives reconnections
    void AsyncStorage.setItem(cooldownStorageKey(userId), String(endTime)).catch(() => {});

    if (cooldownIntervalRef.current) clearInterval(cooldownIntervalRef.current);
    cooldownIntervalRef.current = setInterval(() => {
      const remaining = Math.ceil((cooldownEndRef.current - Date.now()) / 1000);
      if (remaining <= 0) {
        isCooldownActiveRef.current = false;
        clearInterval(cooldownIntervalRef.current!);
        cooldownIntervalRef.current = null;
        setIsThrowCooldown(false);
        setCooldownRemaining(0);
        void AsyncStorage.removeItem(cooldownStorageKey(userId)).catch(() => {});
      } else {
        setCooldownRemaining(remaining);
      }
    }, 500);
  }, [userId]);

  const dismissIncoming = useCallback(() => {
    if (incomingTimerRef.current) {
      clearTimeout(incomingTimerRef.current);
      incomingTimerRef.current = null;
    }
    setIncomingThrowable(null);
  }, []);

  // Subscribe to throwable_sent broadcasts.
  // Receiver-side rate limit: discard throwables from same thrower within 30s
  const _throwableReceiveMap = useRef(new Map<string, number>());
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
        (throwable !== 'egg' &&
          throwable !== 'smoke' &&
          throwable !== 'confetti' &&
          throwable !== 'cake')
      ) {
        return;
      }

      // Receiver-side rate limit: ignore if same thrower sent within 30s
      const now = Date.now();
      const lastReceived = _throwableReceiveMap.current.get(thrower_id);
      if (lastReceived && now - lastReceived < COOLDOWN_MS) {
        return; // Discard — sender bypassed client cooldown
      }
      _throwableReceiveMap.current.set(thrower_id, now);

      // Periodic sweep + FIFO cap to prevent unbounded growth from spoofed IDs
      if (_throwableReceiveMap.current.size > 200) {
        // Purge expired entries first
        for (const [key, ts] of _throwableReceiveMap.current) {
          if (now - ts >= COOLDOWN_MS) _throwableReceiveMap.current.delete(key);
        }
        // If still over cap after purge, FIFO evict oldest
        if (_throwableReceiveMap.current.size > 200) {
          const iter = _throwableReceiveMap.current.keys();
          while (_throwableReceiveMap.current.size > 200) {
            const oldest = iter.next();
            if (oldest.done) break;
            _throwableReceiveMap.current.delete(oldest.value);
          }
        }
      }

      const players = layoutPlayersRef.current;
      const displaySlot = players.findIndex(p => p.player_index === target_player_index);
      if (displaySlot === -1) return;

      const effectId = nextThrowableId(thrower_id);
      const effect: ActiveThrowableEffect = { id: effectId, throwable, from_name: thrower_name };

      enqueueEffect(displaySlot, effect);

      // Show full-screen popup ONLY if we are the target.
      if (target_player_index === myPlayerIndexRef.current) {
        trackEvent('throwable_received', { throwable_type: throwable });
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
    };
  }, [channel, enqueueEffect]);

  const sendThrowable = useCallback(
    (targetGameIndex: number, throwable: ThrowableType) => {
      if (!channel || isCooldownActiveRef.current) return;

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

      // Local echo — Supabase broadcast does not deliver events back to the sender.
      const players = layoutPlayersRef.current;
      const displaySlot = players.findIndex(p => p.player_index === targetGameIndex);
      if (displaySlot !== -1) {
        const effectId = nextThrowableId(userIdRef.current);
        enqueueEffect(displaySlot, { id: effectId, throwable, from_name: username });
      }

      startCooldown();
    },
    [channel, username, enqueueEffect, startCooldown]
  );

  return {
    activeEffects,
    incomingThrowable,
    dismissIncoming,
    sendThrowable,
    isThrowCooldown,
    cooldownRemaining,
  };
}
