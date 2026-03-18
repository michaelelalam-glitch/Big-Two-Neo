/**
 * useGameChat — real-time in-game text chat hook (Task #648).
 *
 * Listens for `chat_message` broadcast events on the existing room channel
 * and exposes a `sendMessage` function with profanity filtering + rate limiting.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { ChatMessage } from '../types/chat';
import { filterMessage } from '../utils/profanityFilter';
import { gameLogger } from '../utils/logger';
import { soundManager, SoundType } from '../utils/soundManager';

/** Maximum number of messages retained in memory. */
const MAX_MESSAGES = 100;

/** Minimum interval between sends (ms). */
const COOLDOWN_MS = 2_000;

export interface UseGameChatOptions {
  /** Reactive Supabase Realtime channel from useRealtime.
   *  When this changes (joinChannel called), the subscription is re-attached. */
  channel: RealtimeChannel | null;
  /** Current user's Supabase ID. */
  userId: string;
  /** Current user's display name. */
  username: string;
  /** Whether the chat drawer is currently visible (resets unread count). */
  isDrawerOpen: boolean;
}

export interface UseGameChatReturn {
  messages: ChatMessage[];
  sendMessage: (text: string) => boolean;
  unreadCount: number;
  isCooldown: boolean;
}

// Sequential ID generator scoped to the browser/JS runtime.
// Including the userId makes IDs unique across clients even when two players
// send within the same millisecond (Copilot PR-150 r2950195900).
let _msgSeq = 0;
function nextId(uid: string): string {
  _msgSeq += 1;
  return `chat_${uid}_${Date.now()}_${_msgSeq}`;
}

export function useGameChat({
  channel,
  userId,
  username,
  isDrawerOpen,
}: UseGameChatOptions): UseGameChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isCooldown, setIsCooldown] = useState(false);
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSentRef = useRef(0);
  // Keep userId and isDrawerOpen in refs so the broadcast handler can read
  // them without being listed as useEffect deps (which would cause handler
  // accumulation when they change while the same channel is active).
  const userIdRef = useRef(userId);
  const isDrawerOpenRef = useRef(isDrawerOpen);

  useEffect(() => { userIdRef.current = userId; }, [userId]);

  // Keep ref in sync so the broadcast handler can check without stale closure.
  useEffect(() => {
    isDrawerOpenRef.current = isDrawerOpen;
    if (isDrawerOpen) setUnreadCount(0);
  }, [isDrawerOpen]);

  // Clean up cooldown timer on unmount.
  useEffect(() => {
    return () => {
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
    };
  }, []);

  // Subscribe to chat_message broadcast events.
  // Depends ONLY on `channel` so the effect only re-runs when the channel
  // instance changes (reconnect). userId / isDrawerOpen are read from refs
  // inside the handler to avoid accumulating duplicate handlers on every
  // re-render that merely changes those values.
  useEffect(() => {
    if (!channel) return;

    // broadcastMessage (useRealtime) wraps chat messages in a BroadcastPayload
    // envelope: { event: 'chat_message', data: <ChatMessage>, timestamp: string }.
    // The Realtime callback receives this envelope, so we read payload.data to
    // extract the ChatMessage. payload.payload.data guards against Supabase SDK
    // versions that double-wrap the broadcast payload.
    let isActive = true;

    const handler = (payload: { event?: string; data?: ChatMessage; timestamp?: string; payload?: { data?: ChatMessage } }) => {
      if (!isActive) return;
      const raw = payload?.data ?? payload?.payload?.data;
      if (!raw || !raw.id || !raw.user_id || !raw.message) return;

      // Normalise potentially-missing fields that ChatDrawer uses directly.
      // created_at: `new Date(x).toLocaleTimeString` throws on invalid strings
      //   (Copilot PR-150 r2950068886) — fall back to now if absent/invalid.
      // username: fall back to user_id so bubbles always display a name.
      const created_at =
        raw.created_at && !Number.isNaN(Date.parse(raw.created_at))
          ? raw.created_at
          : new Date().toISOString();
      // Apply profanity filter on receive so a modified client can't bypass it
      // by broadcasting unfiltered text (Copilot PR-150 r2950195912).
      const msg: ChatMessage = {
        ...raw,
        username: raw.username || raw.user_id,
        created_at,
        message: filterMessage(raw.message),
      };

      setMessages((prev) => {
        // Deduplicate: optimistic local add + broadcast echo can create duplicates
        // (Copilot PR-150 r2950068891).
        if (prev.some((m) => m.id === msg.id)) return prev;
        const next = [...prev, msg];
        return next.length > MAX_MESSAGES ? next.slice(next.length - MAX_MESSAGES) : next;
      });

      // Increment unread if drawer is closed and message is from someone else.
      if (!isDrawerOpenRef.current && msg.user_id !== userIdRef.current) {
        setUnreadCount((c) => c + 1);
      }

      // Play a notification sound for every incoming message from another player.
      if (msg.user_id !== userIdRef.current) {
        soundManager.playSound(SoundType.CHAT_MESSAGE).catch(() => {});
      }
    };

    channel.on('broadcast', { event: 'chat_message' }, handler);

    return () => {
      isActive = false;
      // Supabase JS v2 doesn't expose a per-event unsubscribe, but setting
      // isActive=false prevents state updates if the handler fires after
      // this effect cleans up (Copilot PR-150 r3964546887).
      // Listener cleanup is handled by useRealtime when it unsubscribes the
      // entire channel. Because the effect only re-runs on channel change
      // (not on userId/isDrawerOpen changes), handlers won't accumulate.
    };
  }, [channel]);

  const sendMessage = useCallback(
    (text: string): boolean => {
      const trimmed = text.trim();
      if (!trimmed || trimmed.length > 500) return false;

      const now = Date.now();
      if (now - lastSentRef.current < COOLDOWN_MS) return false;

      if (!channel) return false;

      lastSentRef.current = now;
      setIsCooldown(true);
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
      cooldownTimerRef.current = setTimeout(() => setIsCooldown(false), COOLDOWN_MS);

      const filtered = filterMessage(trimmed);

      const msg: ChatMessage = {
        id: nextId(userId),
        user_id: userId,
        username,
        message: filtered,
        created_at: new Date().toISOString(),
      };

      // Optimistic: add to local messages immediately.
      setMessages((prev) => {
        const next = [...prev, msg];
        return next.length > MAX_MESSAGES ? next.slice(next.length - MAX_MESSAGES) : next;
      });

      // Use the same BroadcastPayload envelope shape as broadcastMessage() in
      // useRealtime ({event, data, timestamp}) to keep all broadcast payloads
      // consistent and avoid shape drift (Copilot PR-150 r2949966846).
      channel
        .send({
          type: 'broadcast',
          event: 'chat_message',
          payload: { event: 'chat_message', data: msg, timestamp: new Date().toISOString() },
        })
        .catch((err: unknown) => {
          gameLogger.error('[useGameChat] Failed to send chat message:', err);
          // Roll back the optimistic message so the sender isn't left with a
          // ghost message that never reached other players
          // (Copilot PR-150 r2950125732).
          setMessages((prev) => prev.filter((m) => m.id !== msg.id));
        });

      return true;
    },
    [channel, userId, username],
  );

  return { messages, sendMessage, unreadCount, isCooldown };
}
