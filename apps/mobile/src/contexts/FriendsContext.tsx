/**
 * FriendsContext
 *
 * Global friends state that ensures a single Supabase Realtime subscription
 * and a single Presence channel run per authenticated session, rather than
 * one per AddFriendButton list item (Copilot review #2966043713).
 *
 * Also handles in-app friend request notifications: when the current user
 * receives a new friend request while online, a modal pop-up appears with
 * Accept / Decline buttons.
 *
 * Usage:
 *   Wrap the authenticated navigator with <FriendsProvider>.
 *   Consume state via useFriendsContext() in AddFriendButton, FriendsList, etc.
 */

import React, { createContext, useContext, useRef, useEffect, useState, ReactNode } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useFriends, type Friendship } from '../hooks/useFriends';
import { usePresence } from '../hooks/usePresence';
import { COLORS, SPACING, FONT_SIZES } from '../constants';
import { i18n } from '../i18n';
import { showError } from '../utils';
import { useAuth } from './AuthContext';

// ============================================================================
// Context shape
// ============================================================================

interface FriendsContextValue
  extends ReturnType<typeof useFriends>, ReturnType<typeof usePresence> {}

const FriendsContext = createContext<FriendsContextValue | null>(null);

// ============================================================================
// Provider
// ============================================================================

export function FriendsProvider({ children }: { children: ReactNode }) {
  const friendsData = useFriends();
  const presenceData = usePresence();
  const { user } = useAuth();

  // ---- In-app friend request notification (with queue) ----
  const [notification, setNotification] = useState<Friendship | null>(null);
  const prevIncomingRef = useRef<Friendship[]>([]);
  const notificationQueueRef = useRef<Friendship[]>([]);
  const isFirstRender = useRef(true);

  // ---- Clear notification state when the auth session ends ----
  useEffect(() => {
    if (!user?.id) {
      setNotification(null);
      notificationQueueRef.current = [];
      prevIncomingRef.current = [];
      isFirstRender.current = true;
    }
  }, [user?.id]);

  // Advance to the next queued notification (or clear if empty)
  const advanceQueue = () => {
    const next = notificationQueueRef.current[0] ?? null;
    notificationQueueRef.current = notificationQueueRef.current.slice(1);
    setNotification(next);
  };

  useEffect(() => {
    if (isFirstRender.current) {
      // Seed the ref with the initial list so existing requests don't
      // trigger a pop-up on mount — only genuinely new ones do.
      isFirstRender.current = false;
      prevIncomingRef.current = friendsData.incomingPending;
      return;
    }
    const prev = prevIncomingRef.current;
    const newRequests = friendsData.incomingPending.filter(r => !prev.some(p => p.id === r.id));
    prevIncomingRef.current = friendsData.incomingPending;

    if (newRequests.length > 0) {
      // Enqueue all newly-arrived requests
      notificationQueueRef.current = [...notificationQueueRef.current, ...newRequests];
      // If no modal is open yet, show the first queued item now
      setNotification(prev => {
        if (prev !== null) return prev; // modal already visible — queue will flush on dismiss
        const next = notificationQueueRef.current[0] ?? null;
        notificationQueueRef.current = notificationQueueRef.current.slice(1);
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [friendsData.incomingPending]);

  const handleAccept = async () => {
    if (!notification) return;
    try {
      await friendsData.acceptRequest(notification.id);
      advanceQueue();
    } catch (e: unknown) {
      showError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDecline = async () => {
    if (!notification) return;
    try {
      await friendsData.declineRequest(notification.id);
      advanceQueue();
    } catch (e: unknown) {
      showError(e instanceof Error ? e.message : String(e));
    }
  };

  const value: FriendsContextValue = {
    ...friendsData,
    ...presenceData,
  };

  return (
    <FriendsContext.Provider value={value}>
      {children}

      {/* In-app friend request pop-up */}
      {notification && (
        <Modal transparent animationType="fade" visible onRequestClose={advanceQueue}>
          <View style={styles.overlay}>
            <View style={styles.card}>
              <Text style={styles.title}>{i18n.t('friends.friendRequest')}</Text>
              <Text style={styles.message}>
                {notification.friend.username ?? i18n.t('friends.unknownPlayer')}{' '}
                {i18n.t('friends.sentYouARequest')}
              </Text>
              <View style={styles.actions}>
                <TouchableOpacity
                  style={[styles.btn, styles.btnAccept]}
                  onPress={handleAccept}
                  accessibilityRole="button"
                  accessibilityLabel={i18n.t('friends.accept')}
                >
                  <Text style={styles.btnText}>{i18n.t('friends.accept')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, styles.btnDecline]}
                  onPress={handleDecline}
                  accessibilityRole="button"
                  accessibilityLabel={i18n.t('friends.decline')}
                >
                  <Text style={styles.btnText}>{i18n.t('friends.decline')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </FriendsContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useFriendsContext(): FriendsContextValue {
  const ctx = useContext(FriendsContext);
  if (!ctx) {
    throw new Error('useFriendsContext must be used within a FriendsProvider');
  }
  return ctx;
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingTop: 80,
  },
  card: {
    backgroundColor: COLORS.background.primary,
    borderRadius: 12,
    padding: SPACING.lg,
    width: '80%',
    maxWidth: 340,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  title: {
    color: COLORS.white,
    fontSize: FONT_SIZES.md,
    fontWeight: '700',
    marginBottom: SPACING.xs,
  },
  message: {
    color: COLORS.gray.text,
    fontSize: FONT_SIZES.sm,
    marginBottom: SPACING.md,
  },
  actions: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  btn: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
  },
  btnAccept: {
    backgroundColor: COLORS.success,
  },
  btnDecline: {
    backgroundColor: COLORS.error,
  },
  btnText: {
    color: COLORS.white,
    fontWeight: '600',
    fontSize: FONT_SIZES.sm,
  },
});
