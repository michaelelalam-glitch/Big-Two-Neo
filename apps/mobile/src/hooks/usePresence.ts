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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { supabase } from '../services/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useUserPreferencesStore } from '../store/userPreferencesSlice';
import { networkLogger } from '../utils/logger';

interface UsePresenceResult {
  /** Set of user IDs that are currently online */
  onlineUserIds: Set<string>;
  /** Convenience helper: returns true if the given userId is online */
  isOnline: (userId: string) => boolean;
}

const PRESENCE_CHANNEL = 'app-presence';

export function usePresence(): UsePresenceResult {
  const { user } = useAuth();
  const showOnlineStatus = useUserPreferencesStore(s => s.showOnlineStatus);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const showOnlineStatusRef = useRef(showOnlineStatus);
  showOnlineStatusRef.current = showOnlineStatus;

  const updateOnlineSet = useCallback((presenceState: Record<string, { user_id?: string }[]>) => {
    const ids = new Set<string>();
    for (const presences of Object.values(presenceState)) {
      for (const p of presences) {
        if (p.user_id) ids.add(p.user_id);
      }
    }
    setOnlineUserIds(ids);
  }, []);

  const join = useCallback(async () => {
    if (!user?.id) return;

    // Await removal of the existing channel before creating a replacement so
    // that rapid join() calls (e.g., multiple AppState 'active' events) do not
    // momentarily leave two channels active or leak resources.
    if (channelRef.current) {
      await supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const channel = supabase.channel(PRESENCE_CHANNEL, {
      config: { presence: { key: user.id } },
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        // 7.12: Guard — when showOnlineStatus is off, ignore all presence events
        // so the cleared Set (set in the toggle effect) is never repopulated.
        if (!showOnlineStatusRef.current) return;
        updateOnlineSet(channel.presenceState<{ user_id?: string }>());
      })
      .on('presence', { event: 'join' }, ({ newPresences }) => {
        if (!showOnlineStatusRef.current) return;
        setOnlineUserIds(prev => {
          const next = new Set(prev);
          for (const p of newPresences as { user_id?: string }[]) {
            if (p.user_id) next.add(p.user_id);
          }
          return next;
        });
      })
      .on('presence', { event: 'leave' }, ({ leftPresences }) => {
        if (!showOnlineStatusRef.current) return;
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
          // Only track presence on initial subscribe if online status is enabled
          if (!showOnlineStatusRef.current) return;
          try {
            await channel.track({ user_id: user.id });
          } catch (error) {
            // Avoid unhandled promise rejections if presence tracking fails
            networkLogger.error('[usePresence] Failed to track presence for user', user.id, error);
          }
        }
      });

    channelRef.current = channel;
  }, [user?.id, updateOnlineSet]);

  useEffect(() => {
    // Clear stale online state when the user signs out
    if (!user?.id) {
      setOnlineUserIds(new Set());
      if (channelRef.current) {
        void supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      return;
    }

    void join();

    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        void join();
      } else if (state === 'background' || state === 'inactive') {
        if (channelRef.current) {
          void channelRef.current.untrack().catch(error => {
            networkLogger.error('[usePresence] Failed to untrack presence', error);
          });
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

  // Respect showOnlineStatus toggle: untrack when disabled, re-track when enabled
  useEffect(() => {
    if (!user?.id || !channelRef.current) return;
    if (!showOnlineStatus) {
      void channelRef.current.untrack().catch(() => {});
      // 7.12: Clear stale in-memory presence data. When the setting is off the
      // listener guard (showOnlineStatusRef) stops processing new events, so
      // the Set would remain frozen at whatever was present at toggle time.
      setOnlineUserIds(new Set());
    } else {
      void channelRef.current.track({ user_id: user.id }).catch(() => {});
    }
  }, [showOnlineStatus, user?.id]);

  const isOnline = useCallback(
    (userId: string) => {
      // When showOnlineStatus is off, never report the current user as online
      if (!showOnlineStatus && userId === user?.id) return false;
      return onlineUserIds.has(userId);
    },
    [onlineUserIds, showOnlineStatus, user?.id]
  );

  // Gate returned set: exclude current user when they opted out of online status
  const gatedOnlineUserIds = useMemo(() => {
    if (showOnlineStatus || !user?.id) return onlineUserIds;
    if (!onlineUserIds.has(user.id)) return onlineUserIds;
    const filtered = new Set(onlineUserIds);
    filtered.delete(user.id);
    return filtered;
  }, [onlineUserIds, showOnlineStatus, user?.id]);

  return { onlineUserIds: gatedOnlineUserIds, isOnline };
}
