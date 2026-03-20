/**
 * usePresence hook
 *
 * Tracks which users are currently online using Supabase Realtime Presence.
 * Each user joins the 'app-presence' channel when the app is foregrounded and
 * leaves (auto-removed by Supabase) when the connection drops.
 *
 * Usage:
 *   const { onlineUserIds, isOnline } = usePresence();
 *   isOnline('some-user-id') // → true / false
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { supabase } from '../services/supabase';
import { useAuth } from '../contexts/AuthContext';

interface UsePresenceResult {
  /** Set of user IDs that are currently online */
  onlineUserIds: Set<string>;
  /** Convenience helper: returns true if the given userId is online */
  isOnline: (userId: string) => boolean;
}

const PRESENCE_CHANNEL = 'app-presence';

export function usePresence(): UsePresenceResult {
  const { user } = useAuth();
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const updateOnlineSet = useCallback((presenceState: Record<string, { user_id?: string }[]>) => {
    const ids = new Set<string>();
    for (const presences of Object.values(presenceState)) {
      for (const p of presences) {
        if (p.user_id) ids.add(p.user_id);
      }
    }
    setOnlineUserIds(ids);
  }, []);

  const join = useCallback(() => {
    if (!user?.id) return;

    // Clean up any existing channel
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }

    const channel = supabase.channel(PRESENCE_CHANNEL, {
      config: { presence: { key: user.id } },
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        updateOnlineSet(channel.presenceState<{ user_id?: string }>());
      })
      .on('presence', { event: 'join' }, ({ newPresences }) => {
        setOnlineUserIds(prev => {
          const next = new Set(prev);
          for (const p of newPresences as { user_id?: string }[]) {
            if (p.user_id) next.add(p.user_id);
          }
          return next;
        });
      })
      .on('presence', { event: 'leave' }, ({ leftPresences }) => {
        setOnlineUserIds(prev => {
          const next = new Set(prev);
          for (const p of leftPresences as { user_id?: string }[]) {
            if (p.user_id) next.delete(p.user_id);
          }
          return next;
        });
      })
      .subscribe(async status => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ user_id: user.id });
        }
      });

    channelRef.current = channel;
  }, [user?.id, updateOnlineSet]);

  useEffect(() => {
    // Clear stale online state when the user signs out
    if (!user?.id) {
      setOnlineUserIds(new Set());
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      return;
    }

    join();

    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        join();
      } else if (state === 'background' || state === 'inactive') {
        if (channelRef.current) {
          channelRef.current.untrack();
        }
      }
    });

    return () => {
      subscription.remove();
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const isOnline = useCallback((userId: string) => onlineUserIds.has(userId), [onlineUserIds]);

  return { onlineUserIds, isOnline };
}
