/**
 * useFriends hook
 *
 * Manages the current user's friend list:
 *  - list accepted friends + pending received/sent requests
 *  - send a friend request
 *  - accept / decline a received request
 *  - remove a friend (unfriend)
 *  - toggle is_favorite on an accepted friendship
 *
 * Realtime updates are handled via a Supabase postgres_changes subscription
 * on the friendships table so the list stays in sync across tabs.
 *
 * NOTE: User blocking (block/unblock/isBlocked) is intentionally deferred to a
 * future v2 release. The unfriend feature covers the immediate v1 need.
 * A backlog task (#674) exists for the full client-side blocking implementation.
 * The DB schema (blocked_users table + triggers) was created in this PR via migration
 * 20260720000003 — no client hooks for blocking are wired up here.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabase';
import { useAuth } from '../contexts/AuthContext';
import { uiLogger } from '../utils/logger';
import { i18n } from '../i18n';
import { notifyFriendRequest, notifyFriendAccepted } from '../services/pushNotificationService';

export interface FriendProfile {
  id: string;
  username?: string;
  avatar_url?: string | null;
  elo_rating?: number | null;
  rank?: string | null;
}

export interface Friendship {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: 'pending' | 'accepted';
  is_favorite: boolean;
  created_at: string;
  /** The other person's profile (populated after fetch) */
  friend: FriendProfile;
}

interface UseFriendsResult {
  /** Accepted friends */
  friends: Friendship[];
  /** Friend requests I sent that are still pending */
  outgoingPending: Friendship[];
  /** Friend requests I received that are still pending */
  incomingPending: Friendship[];
  loading: boolean;
  /** Send a friend request to the given userId */
  sendRequest: (userId: string) => Promise<void>;
  /** Accept a friend request (called by the addressee) */
  acceptRequest: (friendshipId: string) => Promise<void>;
  /** Decline / cancel a friend request */
  declineRequest: (friendshipId: string) => Promise<void>;
  /** Remove an accepted friendship */
  removeFriend: (friendshipId: string) => Promise<void>;
  /** Toggle is_favorite on an accepted friendship */
  toggleFavorite: (friendshipId: string, current: boolean) => Promise<void>;
  /** True if there's already an accepted or pending friendship with the given userId */
  isFriendOrPending: (userId: string) => boolean;
  refresh: () => Promise<void>;
}

interface RawFriendship {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: 'pending' | 'accepted';
  is_favorite: boolean;
  created_at: string;
  requester_profile: FriendProfile[] | FriendProfile | null;
  addressee_profile: FriendProfile[] | FriendProfile | null;
}

function pickProfile(raw: RawFriendship, myId: string): FriendProfile {
  const isRequester = raw.requester_id === myId;
  const profileData = isRequester ? raw.addressee_profile : raw.requester_profile;
  // Supabase may return array or object depending on join type
  const p = Array.isArray(profileData) ? profileData[0] : profileData;
  return p ?? { id: isRequester ? raw.addressee_id : raw.requester_id };
}

export function useFriends(): UseFriendsResult {
  const { user, profile } = useAuth();
  const [friends, setFriends] = useState<Friendship[]>([]);
  const [outgoingPending, setOutgoing] = useState<Friendship[]>([]);
  const [incomingPending, setIncoming] = useState<Friendship[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('friendships')
        .select(
          `
          id, requester_id, addressee_id, status, is_favorite, created_at,
          requester_profile:profiles!friendships_requester_id_fkey(id, username, avatar_url, elo_rating, rank),
          addressee_profile:profiles!friendships_addressee_id_fkey(id, username, avatar_url, elo_rating, rank)
        `
        )
        .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
        .order('created_at', { ascending: false });

      if (error) {
        uiLogger.error('[useFriends] fetch error', error.message);
        return;
      }

      const rows = (data ?? []) as RawFriendship[];
      const accepted: Friendship[] = [];
      const outgoing: Friendship[] = [];
      const incoming: Friendship[] = [];

      for (const row of rows) {
        const entry: Friendship = {
          id: row.id,
          requester_id: row.requester_id,
          addressee_id: row.addressee_id,
          status: row.status,
          is_favorite: row.is_favorite,
          created_at: row.created_at,
          friend: pickProfile(row, user.id),
        };
        if (row.status === 'accepted') {
          accepted.push(entry);
        } else if (row.requester_id === user.id) {
          outgoing.push(entry);
        } else {
          incoming.push(entry);
        }
      }

      // Favourites first, then alphabetical
      accepted.sort((a, b) => {
        if (a.is_favorite !== b.is_favorite) return a.is_favorite ? -1 : 1;
        return (a.friend.username ?? '').localeCompare(b.friend.username ?? '');
      });

      setFriends(accepted);
      setOutgoing(outgoing);
      setIncoming(incoming);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  // Realtime subscription
  useEffect(() => {
    if (!user?.id) {
      // Clear stale data when the user signs out
      setFriends([]);
      setOutgoing([]);
      setIncoming([]);
      return;
    }

    fetchAll();

    const channel = supabase
      .channel(`friendships:user:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'friendships',
          filter: `requester_id=eq.${user.id}`,
        },
        () => {
          fetchAll();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'friendships',
          filter: `addressee_id=eq.${user.id}`,
        },
        async payload => {
          // For INSERT events, optimistically populate the incoming request
          // immediately (with a quick profile fetch) so the in-app notification
          // modal appears instantly instead of waiting for fetchAll() to finish.
          if (payload.eventType === 'INSERT') {
            const row = payload.new as {
              id: string;
              requester_id: string;
              addressee_id: string;
              status: string;
              is_favorite: boolean;
              created_at: string;
            };
            if (row.status === 'pending') {
              const { data: profileData } = await supabase
                .from('profiles')
                .select('id, username, avatar_url, elo_rating, rank')
                .eq('id', row.requester_id)
                .single();
              const tempEntry: Friendship = {
                id: row.id,
                requester_id: row.requester_id,
                addressee_id: row.addressee_id,
                status: 'pending',
                is_favorite: row.is_favorite ?? false,
                created_at: row.created_at,
                friend: profileData ?? { id: row.requester_id },
              };
              setIncoming(prev => (prev.some(f => f.id === row.id) ? prev : [...prev, tempEntry]));
            }
          }
          fetchAll();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Client-side throttle: max 1 friend request per 5 seconds
  const lastRequestTimeRef = useRef(0);
  const FRIEND_REQUEST_THROTTLE_MS = 5_000;

  const sendRequest = useCallback(
    async (userId: string) => {
      if (!user?.id) return;
      const now = Date.now();
      if (now - lastRequestTimeRef.current < FRIEND_REQUEST_THROTTLE_MS) {
        throw new Error(i18n.t('friends.throttle'));
      }
      lastRequestTimeRef.current = now;
      const { error } = await supabase
        .from('friendships')
        .insert({ requester_id: user.id, addressee_id: userId, status: 'pending' });
      if (error) {
        // Unique constraint: duplicate or already-pending request
        if (error.code === '23505') {
          throw new Error(i18n.t('friends.requestPending'));
        }
        throw new Error(error.message);
      }
      // Send offline push notification to the addressee
      const senderName = profile?.username || user.email || i18n.t('friends.unknownPlayer');
      notifyFriendRequest(userId, senderName, user.id).catch(() => {
        // Swallow push errors — the request was saved successfully
      });
      await fetchAll();
    },
    [user?.id, user?.email, profile?.username, fetchAll]
  );

  const acceptRequest = useCallback(
    async (friendshipId: string) => {
      if (!user?.id) return;
      const { data, error } = await supabase
        .from('friendships')
        .update({ status: 'accepted' })
        .eq('id', friendshipId)
        .eq('addressee_id', user.id)
        .eq('status', 'pending')
        .select();
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) {
        throw new Error(i18n.t('friends.requestAlreadyHandled'));
      }
      // Notify the requester that their request was accepted
      const requesterId = data[0].requester_id;
      const accepterName = profile?.username || user.email || i18n.t('friends.unknownPlayer');
      notifyFriendAccepted(requesterId, accepterName, user.id).catch(() => {
        // Swallow push errors — the acceptance was saved successfully
      });
      await fetchAll();
    },
    [user?.id, user?.email, profile?.username, fetchAll]
  );

  const declineRequest = useCallback(
    async (friendshipId: string) => {
      const { error } = await supabase.from('friendships').delete().eq('id', friendshipId);
      if (error) throw new Error(error.message);
      await fetchAll();
    },
    [fetchAll]
  );

  const removeFriend = useCallback(
    async (friendshipId: string) => {
      const { error } = await supabase.from('friendships').delete().eq('id', friendshipId);
      if (error) throw new Error(error.message);
      await fetchAll();
    },
    [fetchAll]
  );

  const toggleFavorite = useCallback(
    async (friendshipId: string, current: boolean) => {
      const { error } = await supabase
        .from('friendships')
        .update({ is_favorite: !current })
        .eq('id', friendshipId);
      if (error) throw new Error(error.message);
      await fetchAll();
    },
    [fetchAll]
  );

  const isFriendOrPending = useCallback(
    (userId: string): boolean => {
      return (
        friends.some(f => f.friend.id === userId) ||
        outgoingPending.some(f => f.addressee_id === userId) ||
        incomingPending.some(f => f.requester_id === userId)
      );
    },
    [friends, outgoingPending, incomingPending]
  );

  return {
    friends,
    outgoingPending,
    incomingPending,
    loading,
    sendRequest,
    acceptRequest,
    declineRequest,
    removeFriend,
    toggleFavorite,
    isFriendOrPending,
    refresh: fetchAll,
  };
}
