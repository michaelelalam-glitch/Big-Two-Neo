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
  sendMessage: (text: string) => void;
  unreadCount: number;
  isCooldown: boolean;
}

// Simple sequential ID generator (unique enough for ephemeral messages).
let _msgSeq = 0;
function nextId(): string {
  _msgSeq += 1;
  return `chat_${Date.now()}_${_msgSeq}`;
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

    // Supabase broadcast delivers the sent `payload` object directly as the
    // callback argument (i.e., `payload = { data: msg }`). Fall back to the
    // nested `payload.payload.data` shape for forwards-compat robustness.
    const handler = (payload: { data?: ChatMessage; payload?: { data?: ChatMessage } }) => {
      const msg = payload?.data ?? payload?.payload?.data;
      if (!msg || !msg.id || !msg.user_id || !msg.message) return;

      setMessages((prev) => {
        const next = [...prev, msg];
        return next.length > MAX_MESSAGES ? next.slice(next.length - MAX_MESSAGES) : next;
      });

      // Increment unread if drawer is closed and message is from someone else.
      if (!isDrawerOpenRef.current && msg.user_id !== userIdRef.current) {
        setUnreadCount((c) => c + 1);
      }
    };

    channel.on('broadcast', { event: 'chat_message' }, handler);

    return () => {
      // Supabase JS v2 doesn't expose a per-event unsubscribe, but channel
      // listener cleanup is handled by useRealtime when it unsubscribes the
      // entire channel. Because the effect only re-runs on channel change
      // (not on userId/isDrawerOpen changes), handlers won't accumulate.
    };
  }, [channel]);

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || trimmed.length > 500) return;

      const now = Date.now();
      if (now - lastSentRef.current < COOLDOWN_MS) return;

      if (!channel) return;

      lastSentRef.current = now;
      setIsCooldown(true);
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
      cooldownTimerRef.current = setTimeout(() => setIsCooldown(false), COOLDOWN_MS);

      const filtered = filterMessage(trimmed);

      const msg: ChatMessage = {
        id: nextId(),
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

      channel
        .send({
          type: 'broadcast',
          event: 'chat_message',
          payload: { data: msg },
        })
        .catch((err: unknown) => {
          gameLogger.error('[useGameChat] Failed to send chat message:', err);
        });
    },
    [channel, userId, username],
  );

  return { messages, sendMessage, unreadCount, isCooldown };
}
