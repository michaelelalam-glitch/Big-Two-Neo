import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { COLORS, SPACING, FONT_SIZES } from '../constants';
import { useNotifications, AppNotification } from '../contexts/NotificationContext';
import { useFriendsContext } from '../contexts/FriendsContext';
import { RootStackParamList } from '../navigation/AppNavigator';
import { i18n } from '../i18n';

type NotificationsNavProp = StackNavigationProp<RootStackParamList, 'Notifications'>;

function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return i18n.t('notifications.justNow') || 'Just now';
  if (minutes < 60)
    return i18n.t('matchHistory.minutesAgo', { count: minutes }) || `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return i18n.t('matchHistory.hoursAgo', { count: hours }) || `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return i18n.t('matchHistory.daysAgo', { count: days }) || `${days}d ago`;
}

function notifIcon(type: AppNotification['type']): string {
  switch (type) {
    case 'game_invite':
    case 'room_invite':
      return '🎮';
    case 'friend_request':
      return '👤';
    case 'friend_accepted':
      return '🤝';
    case 'game_started':
      return '🚀';
    case 'your_turn':
      return '⏰';
    case 'game_ended':
      return '🏁';
    default:
      return '🔔';
  }
}

export default function NotificationsScreen() {
  const navigation = useNavigation<NotificationsNavProp>();
  const { storedNotifications, unreadCount, markAllRead, clearAll } = useNotifications();
  const { incomingPending, acceptRequest, declineRequest } = useFriendsContext();
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());

  // Mark all as read whenever the screen gains focus (not just on initial mount),
  // so notifications received while navigating away are also cleared on return.
  // Guard with unreadCount to avoid unnecessary AsyncStorage writes and renders
  // when everything is already read.
  useFocusEffect(
    useCallback(() => {
      if (unreadCount > 0) {
        markAllRead();
      }
    }, [markAllRead, unreadCount])
  );

  const handleNotifPress = (item: AppNotification) => {
    if ((item.type === 'game_invite' || item.type === 'room_invite') && item.data?.roomCode) {
      navigation.navigate('Lobby', {
        roomCode: item.data.roomCode as string,
        joining: true,
      });
    } else if (item.type === 'friend_request' || item.type === 'friend_accepted') {
      navigation.navigate('Profile');
    } else if ((item.type === 'game_started' || item.type === 'your_turn') && item.data?.roomCode) {
      navigation.navigate('Game', { roomCode: item.data.roomCode as string });
    }
  };

  // Find the matching pending friendship for a friend_request notification
  const findPendingRequest = (item: AppNotification) => {
    if (item.type !== 'friend_request') return null;

    // Prefer matching via structured data (friendshipId) when available
    const friendshipId = item.data?.friendshipId as string | undefined;
    if (friendshipId) {
      return incomingPending.find(req => req.id === friendshipId) ?? null;
    }

    // Fallback: match by sender username from notification body
    return (
      incomingPending.find(req => {
        const username = req.friend.username;
        return username && username.length > 0 && item.body.includes(username);
      }) ?? null
    );
  };

  const handleAcceptRequest = async (friendshipId: string) => {
    setProcessingIds(prev => new Set(prev).add(friendshipId));
    try {
      await acceptRequest(friendshipId);
    } finally {
      setProcessingIds(prev => {
        const next = new Set(prev);
        next.delete(friendshipId);
        return next;
      });
    }
  };

  const handleDeclineRequest = async (friendshipId: string) => {
    setProcessingIds(prev => new Set(prev).add(friendshipId));
    try {
      await declineRequest(friendshipId);
    } finally {
      setProcessingIds(prev => {
        const next = new Set(prev);
        next.delete(friendshipId);
        return next;
      });
    }
  };

  const renderItem = ({ item }: { item: AppNotification }) => {
    const pendingRequest = findPendingRequest(item);
    const isProcessing = pendingRequest ? processingIds.has(pendingRequest.id) : false;

    return (
      <TouchableOpacity
        style={[styles.row, !item.read && styles.rowUnread]}
        onPress={() => handleNotifPress(item)}
        activeOpacity={0.7}
      >
        <Text style={styles.icon}>{notifIcon(item.type)}</Text>
        <View style={styles.rowContent}>
          <Text style={styles.rowTitle}>{item.title}</Text>
          <Text style={styles.rowBody} numberOfLines={2}>
            {item.body}
          </Text>
          {pendingRequest && (
            <View style={styles.friendActions}>
              <TouchableOpacity
                style={[styles.friendBtn, styles.friendBtnAccept]}
                onPress={() => handleAcceptRequest(pendingRequest.id)}
                disabled={isProcessing}
                activeOpacity={0.7}
              >
                <Text style={styles.friendBtnText}>
                  {isProcessing ? '...' : i18n.t('friends.accept') || 'Accept'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.friendBtn, styles.friendBtnDecline]}
                onPress={() => handleDeclineRequest(pendingRequest.id)}
                disabled={isProcessing}
                activeOpacity={0.7}
              >
                <Text style={styles.friendBtnText}>{i18n.t('friends.decline') || 'Decline'}</Text>
              </TouchableOpacity>
            </View>
          )}
          <Text style={styles.rowTime}>{formatRelativeTime(item.receivedAt)}</Text>
        </View>
        {!item.read && <View style={styles.unreadDot} />}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView
      style={styles.container}
      edges={['top', 'left', 'right']}
      testID="notifications-screen"
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backText}>← {i18n.t('common.back') || 'Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {i18n.t('notifications.title') || '🔔 Notifications'}
        </Text>
        {storedNotifications.length > 0 && (
          <TouchableOpacity onPress={clearAll} style={styles.clearButton}>
            <Text style={styles.clearText}>{i18n.t('notifications.clearAll') || 'Clear'}</Text>
          </TouchableOpacity>
        )}
      </View>

      {storedNotifications.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>🔔</Text>
          <Text style={styles.emptyText}>
            {i18n.t('notifications.empty') || 'No notifications yet'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={storedNotifications}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background.primary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray.dark,
  },
  backButton: {
    paddingVertical: SPACING.xs,
    paddingRight: SPACING.sm,
  },
  backText: {
    color: COLORS.blue.primary,
    fontSize: FONT_SIZES.md,
  },
  headerTitle: {
    flex: 1,
    color: COLORS.white,
    fontSize: FONT_SIZES.lg,
    fontWeight: '700',
    textAlign: 'center',
  },
  clearButton: {
    paddingVertical: SPACING.xs,
    paddingLeft: SPACING.sm,
  },
  clearText: {
    color: COLORS.red.active,
    fontSize: FONT_SIZES.sm,
  },
  list: {
    padding: SPACING.md,
    gap: SPACING.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: COLORS.background.dark,
    borderRadius: 12,
    padding: SPACING.md,
    gap: SPACING.sm,
  },
  rowUnread: {
    borderLeftWidth: 3,
    borderLeftColor: COLORS.blue.primary,
  },
  icon: {
    fontSize: 28,
  },
  rowContent: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    color: COLORS.white,
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
  },
  rowBody: {
    color: COLORS.gray.light,
    fontSize: FONT_SIZES.sm,
  },
  rowTime: {
    color: COLORS.gray.medium,
    fontSize: FONT_SIZES.xs,
    marginTop: 4,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.blue.primary,
    marginTop: 6,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: SPACING.md,
  },
  emptyIcon: {
    fontSize: 48,
  },
  emptyText: {
    color: COLORS.gray.medium,
    fontSize: FONT_SIZES.md,
  },
  friendActions: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginTop: SPACING.xs,
  },
  friendBtn: {
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: SPACING.md,
  },
  friendBtnAccept: {
    backgroundColor: COLORS.success,
  },
  friendBtnDecline: {
    backgroundColor: COLORS.error,
  },
  friendBtnText: {
    color: COLORS.white,
    fontWeight: '600',
    fontSize: FONT_SIZES.xs,
  },
});
