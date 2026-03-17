/**
 * useGameChat — real-time in-game text chat hook (Task #648).
 *
 * Listens for `chat_message` broadcast events on the existing room channel
 * and exposes a `sendMessage` function with profanity filtering + rate limiting.
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { ChatMessage } from '../types/chat';
import { filterMessage } from '../utils/profanityFilter';
import { gameLogger } from '../utils/logger';

/** Maximum number of messages retained in memory. */
const MAX_MESSAGES = 100;

/** Minimum interval between sends (ms). */
const COOLDOWN_MS = 2_000;

export interface UseGameChatOptions {
  /** Ref to the Supabase Realtime channel for the room. */
  channelRef: React.MutableRefObject<RealtimeChannel | null>;
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
  channelRef,
  userId,
  username,
  isDrawerOpen,
}: UseGameChatOptions): UseGameChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isCooldown, setIsCooldown] = useState(false);
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSentRef = useRef(0);
  const isDrawerOpenRef = useRef(isDrawerOpen);

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

  // Derive channel from ref so subscription re-runs when it becomes available.
  const channel = channelRef.current;

  // Subscribe to chat_message broadcast events.
  useEffect(() => {
    if (!channel) return;

    const handler = (payload: { payload?: { data?: ChatMessage } }) => {
      const msg = payload?.payload?.data;
      if (!msg || !msg.id || !msg.user_id || !msg.message) return;

      setMessages((prev) => {
        const next = [...prev, msg];
        return next.length > MAX_MESSAGES ? next.slice(next.length - MAX_MESSAGES) : next;
      });

      // Increment unread if drawer is closed and message is from someone else.
      if (!isDrawerOpenRef.current && msg.user_id !== userId) {
        setUnreadCount((c) => c + 1);
      }
    };

    channel.on('broadcast', { event: 'chat_message' }, handler);

    return () => {
      // Supabase JS v2 doesn't expose a per-event unsubscribe, but removing
      // channel listeners is handled when the channel itself is unsubscribed
      // (which happens in useRealtime cleanup). No-op here is safe.
    };
  }, [channel, userId]);

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || trimmed.length > 500) return;

      const now = Date.now();
      if (now - lastSentRef.current < COOLDOWN_MS) return;

      const channel = channelRef.current;
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
    [channelRef, userId, username],
  );

  return { messages, sendMessage, unreadCount, isCooldown };
}
