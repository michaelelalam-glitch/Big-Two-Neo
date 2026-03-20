/**
 * AddFriendButton
 *
 * Reusable button shown next to players in the Leaderboard, Lobby,
 * and Game Room. Handles existing friendship states gracefully.
 */

import React, { useState } from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useFriendsContext } from '../../contexts/FriendsContext';
import { useAuth } from '../../contexts/AuthContext';
import { COLORS, SPACING, FONT_SIZES } from '../../constants';
import { i18n } from '../../i18n';

interface AddFriendButtonProps {
  targetUserId: string;
  /** Compact style for in-game use */
  compact?: boolean;
}

export function AddFriendButton({ targetUserId, compact = false }: AddFriendButtonProps) {
  const { user } = useAuth();
  const { sendRequest, isFriendOrPending, friends, outgoingPending } = useFriendsContext();
  const [busy, setBusy] = useState(false);

  // Don't show button for current user
  if (!user || targetUserId === user.id) return null;

  const alreadyFriend = friends.some(f => f.friend.id === targetUserId);
  const requestSent = outgoingPending.some(f => f.addressee_id === targetUserId);
  const isPendingOrFriend = isFriendOrPending(targetUserId);

  const handlePress = async () => {
    if (isPendingOrFriend) return;
    setBusy(true);
    try {
      await sendRequest(targetUserId);
      Alert.alert(i18n.t('friends.addFriend'), i18n.t('friends.added'));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert(i18n.t('common.error'), msg);
    } finally {
      setBusy(false);
    }
  };

  let label = i18n.t('friends.addFriend');
  if (alreadyFriend) label = i18n.t('friends.alreadyFriends');
  else if (requestSent) label = i18n.t('friends.requestSent');

  return (
    <TouchableOpacity
      style={[styles.btn, compact && styles.btnCompact, isPendingOrFriend && styles.btnDisabled]}
      onPress={handlePress}
      disabled={isPendingOrFriend || busy}
      accessibilityLabel={label}
    >
      {busy ? (
        <ActivityIndicator size="small" color={COLORS.white} />
      ) : (
        <Text style={[styles.label, compact && styles.labelCompact]}>
          {isPendingOrFriend ? (alreadyFriend ? '✓ ' : '⏳ ') : '+ '}
          {label}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    backgroundColor: COLORS.secondary,
    borderRadius: 8,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
  },
  btnCompact: {
    borderRadius: 6,
    paddingHorizontal: SPACING.xs,
    paddingVertical: 3,
  },
  btnDisabled: {
    backgroundColor: COLORS.gray.dark,
  },
  label: {
    color: COLORS.white,
    fontSize: FONT_SIZES.xs,
    fontWeight: '600',
  },
  labelCompact: {
    fontSize: 10,
  },
});
