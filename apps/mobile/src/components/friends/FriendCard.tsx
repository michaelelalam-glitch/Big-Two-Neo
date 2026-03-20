/**
 * FriendCard
 *
 * Renders a single friendship row with:
 *  - Online indicator dot
 *  - Avatar initial / photo
 *  - Username + ELO
 *  - Favourite star toggle (accepted only)
 *  - Accept / Decline buttons (incoming pending)
 *  - Cancel / Unfriend button
 */

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { Friendship } from '../../hooks/useFriends';
import { COLORS, SPACING, FONT_SIZES } from '../../constants';
import { i18n } from '../../i18n';

interface FriendCardProps {
  item: Friendship;
  type: 'accepted' | 'outgoing' | 'incoming';
  isOnline?: boolean;
  onAccept?: (id: string) => Promise<void>;
  onDecline?: (id: string) => Promise<void>;
  onRemove?: (id: string) => Promise<void>;
  onToggleFavorite?: (id: string, current: boolean) => Promise<void>;
}

export function FriendCard({
  item,
  type,
  isOnline = false,
  onAccept,
  onDecline,
  onRemove,
  onToggleFavorite,
}: FriendCardProps) {
  const [busy, setBusy] = useState(false);

  const wrap = (fn: () => Promise<void>) => async () => {
    setBusy(true);
    try {
      await fn();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert(i18n.t('common.error'), msg);
    } finally {
      setBusy(false);
    }
  };

  const initials = (item.friend.username ?? '?').slice(0, 2).toUpperCase();

  return (
    <View style={styles.card}>
      {/* Avatar */}
      <View style={styles.avatarWrap}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        {/* Online dot */}
        <View style={[styles.onlineDot, isOnline ? styles.dotOnline : styles.dotOffline]} />
      </View>

      {/* Info */}
      <View style={styles.info}>
        <Text style={styles.username} numberOfLines={1}>
          {item.friend.username ?? i18n.t('friends.unknownPlayer')}
          {type === 'outgoing' && (
            <Text style={styles.pending}> · {i18n.t('friends.requestSent')}</Text>
          )}
        </Text>
        {item.friend.elo_rating != null && (
          <Text style={styles.elo}>ELO {item.friend.elo_rating}</Text>
        )}
      </View>

      {/* Actions */}
      <View style={styles.actions}>
        {busy ? (
          <ActivityIndicator size="small" color={COLORS.secondary} />
        ) : (
          <>
            {type === 'accepted' && onToggleFavorite && (
              <TouchableOpacity
                style={styles.iconBtn}
                onPress={wrap(() => onToggleFavorite(item.id, item.is_favorite))}
                accessibilityLabel={
                  item.is_favorite ? i18n.t('friends.unfavorite') : i18n.t('friends.favorite')
                }
              >
                <Text style={[styles.iconBtnText, item.is_favorite && styles.favoriteActive]}>
                  {item.is_favorite ? '★' : '☆'}
                </Text>
              </TouchableOpacity>
            )}
            {type === 'incoming' && onAccept && (
              <TouchableOpacity
                style={[styles.actionBtn, styles.acceptBtn]}
                onPress={wrap(() => onAccept(item.id))}
              >
                <Text style={styles.actionBtnText}>{i18n.t('friends.accept')}</Text>
              </TouchableOpacity>
            )}
            {(type === 'incoming' || type === 'outgoing') && onDecline && (
              <TouchableOpacity
                style={[styles.actionBtn, styles.declineBtn]}
                onPress={wrap(() => onDecline(item.id))}
              >
                <Text style={styles.actionBtnText}>
                  {type === 'outgoing'
                    ? i18n.t('friends.cancelRequest')
                    : i18n.t('friends.decline')}
                </Text>
              </TouchableOpacity>
            )}
            {type === 'accepted' && onRemove && (
              <TouchableOpacity
                style={[styles.actionBtn, styles.removeBtn]}
                onPress={wrap(() => onRemove(item.id))}
              >
                <Text style={styles.actionBtnText}>{i18n.t('friends.unfriend')}</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background.dark,
    borderRadius: 10,
    padding: SPACING.sm,
    marginBottom: SPACING.xs,
  },
  avatarWrap: {
    position: 'relative',
    marginRight: SPACING.sm,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.secondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.sm,
    fontWeight: '700',
  },
  onlineDot: {
    position: 'absolute',
    bottom: 1,
    right: 1,
    width: 11,
    height: 11,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: COLORS.background.dark,
  },
  dotOnline: {
    backgroundColor: COLORS.success,
  },
  dotOffline: {
    backgroundColor: COLORS.gray.medium,
  },
  info: {
    flex: 1,
  },
  username: {
    color: COLORS.white,
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
  },
  pending: {
    color: COLORS.gray.medium,
    fontSize: FONT_SIZES.xs,
    fontWeight: '400',
  },
  elo: {
    color: COLORS.gray.text,
    fontSize: FONT_SIZES.xs,
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  iconBtn: {
    padding: SPACING.xs,
  },
  iconBtnText: {
    fontSize: FONT_SIZES.lg,
    color: COLORS.gray.medium,
  },
  favoriteActive: {
    color: COLORS.gold,
  },
  actionBtn: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: 6,
  },
  acceptBtn: {
    backgroundColor: COLORS.success,
  },
  declineBtn: {
    backgroundColor: COLORS.gray.dark,
  },
  removeBtn: {
    backgroundColor: COLORS.danger,
  },
  actionBtnText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.xs,
    fontWeight: '600',
  },
});
