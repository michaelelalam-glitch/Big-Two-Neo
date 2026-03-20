/**
 * FriendsList
 *
 * Tabbed list showing:
 *  - "Friends" tab: accepted friends (with online indicator)
 *  - "Requests" tab: incoming + outgoing pending requests
 *
 * Consumes useFriends + usePresence; meant to be embedded in ProfileScreen.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  StyleSheet,
  RefreshControl,
} from 'react-native';
import { Friendship } from '../../hooks/useFriends';
import { useFriendsContext } from '../../contexts/FriendsContext';
import { COLORS, SPACING, FONT_SIZES } from '../../constants';
import { i18n } from '../../i18n';
import { FriendCard } from './FriendCard';

type Tab = 'friends' | 'requests';

export function FriendsList() {
  const {
    friends,
    outgoingPending,
    incomingPending,
    loading,
    acceptRequest,
    declineRequest,
    removeFriend,
    toggleFavorite,
    refresh,
    isOnline,
  } = useFriendsContext();
  const [tab, setTab] = useState<Tab>('friends');
  const [refreshing, setRefreshing] = useState(false);

  const pendingCount = incomingPending.length + outgoingPending.length;

  const handleRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  const renderFriend = ({ item }: { item: Friendship }) => (
    <FriendCard
      item={item}
      type="accepted"
      isOnline={isOnline(item.friend.id)}
      onToggleFavorite={toggleFavorite}
      onRemove={removeFriend}
    />
  );

  const renderRequest = ({ item }: { item: Friendship & { _type: 'incoming' | 'outgoing' } }) => (
    <FriendCard
      item={item}
      type={item._type}
      onAccept={item._type === 'incoming' ? acceptRequest : undefined}
      onDecline={declineRequest}
    />
  );

  const requestItems = [
    ...incomingPending.map(f => ({ ...f, _type: 'incoming' as const })),
    ...outgoingPending.map(f => ({ ...f, _type: 'outgoing' as const })),
  ];

  return (
    <View style={styles.container}>
      {/* Tab Bar */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, tab === 'friends' && styles.tabActive]}
          onPress={() => setTab('friends')}
        >
          <Text style={[styles.tabText, tab === 'friends' && styles.tabTextActive]}>
            {i18n.t('friends.myFriends')} ({friends.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'requests' && styles.tabActive]}
          onPress={() => setTab('requests')}
        >
          <Text style={[styles.tabText, tab === 'requests' && styles.tabTextActive]}>
            {i18n.t('friends.requests')}
            {pendingCount > 0 && <Text style={styles.badge}> {pendingCount}</Text>}
          </Text>
        </TouchableOpacity>
      </View>

      {loading && !refreshing ? (
        <ActivityIndicator size="small" color={COLORS.secondary} style={styles.loader} />
      ) : tab === 'friends' ? (
        <FlatList
          data={friends}
          keyExtractor={f => f.id}
          renderItem={renderFriend}
          ListEmptyComponent={<Text style={styles.empty}>{i18n.t('friends.noFriends')}</Text>}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={COLORS.secondary}
            />
          }
          scrollEnabled={false}
        />
      ) : (
        <FlatList
          data={requestItems}
          keyExtractor={f => f.id}
          renderItem={renderRequest}
          ListEmptyComponent={<Text style={styles.empty}>{i18n.t('friends.noPending')}</Text>}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={COLORS.secondary}
            />
          }
          scrollEnabled={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray.dark,
    marginBottom: SPACING.sm,
  },
  tab: {
    flex: 1,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: COLORS.secondary,
  },
  tabText: {
    color: COLORS.gray.text,
    fontSize: FONT_SIZES.sm,
    fontWeight: '500',
  },
  tabTextActive: {
    color: COLORS.secondary,
    fontWeight: '700',
  },
  badge: {
    color: COLORS.accent,
    fontWeight: '700',
  },
  empty: {
    color: COLORS.gray.text,
    textAlign: 'center',
    marginTop: SPACING.lg,
    fontSize: FONT_SIZES.sm,
  },
  loader: {
    marginTop: SPACING.lg,
  },
});
