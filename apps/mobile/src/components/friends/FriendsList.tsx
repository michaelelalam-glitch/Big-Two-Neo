/**
 * FriendsList
 *
 * Tabbed list showing:
 *  - "Friends" tab: accepted friends (with online indicator)
 *  - "Requests" tab: incoming + outgoing pending requests
 *
 * Consumes useFriends + usePresence; meant to be embedded in ProfileScreen.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  TextInput,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { useFriendsContext } from '../../contexts/FriendsContext';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../services/supabase';
import { COLORS, SPACING, FONT_SIZES } from '../../constants';
import { i18n } from '../../i18n';
import { FriendCard } from './FriendCard';
import { AddFriendButton } from './AddFriendButton';

type Tab = 'friends' | 'requests';

interface SearchResult {
  id: string;
  username: string;
}

export function FriendsList() {
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const { user } = useAuth();
  const {
    friends,
    outgoingPending,
    incomingPending,
    loading,
    acceptRequest,
    declineRequest,
    removeFriend,
    toggleFavorite,
    isOnline,
  } = useFriendsContext();
  const [tab, setTab] = useState<Tab>('friends');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  // Token to discard stale search responses — incremented on every new query so
  // a slow older response never overwrites a newer result.
  const searchTokenRef = useRef(0);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const searchUsers = useCallback(
    async (query: string) => {
      const trimmed = query.trim();
      if (trimmed.length < 2) {
        setSearchResults([]);
        setSearching(false);
        return;
      }
      if (!user?.id) {
        // Auth not ready yet — clear any loading state/results and bail out.
        setSearchResults([]);
        setSearching(false);
        return;
      }
      setSearching(true);
      const token = ++searchTokenRef.current;
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, username')
          .ilike('username', `%${trimmed}%`)
          .neq('id', user.id)
          .limit(10);
        if (!mountedRef.current) return;
        // Discard stale responses — only apply if this is still the latest query.
        if (token !== searchTokenRef.current) return;
        if (!error && data) {
          setSearchResults(data as SearchResult[]);
        } else {
          setSearchResults([]);
        }
      } catch {
        if (!mountedRef.current) return;
        if (token !== searchTokenRef.current) return;
        setSearchResults([]);
      } finally {
        if (mountedRef.current && token === searchTokenRef.current) {
          setSearching(false);
        }
      }
    },
    [user?.id]
  );

  const handleSearchChange = useCallback(
    (text: string) => {
      setSearchQuery(text);
      // Invalidate any in-flight Supabase request immediately so stale
      // responses from a previous debounce cycle can't overwrite state.
      ++searchTokenRef.current;
      // Clear stale results and show loading state immediately so the UI
      // doesn't flash "no results" during the 400ms debounce.
      setSearchResults([]);
      if (text.trim().length >= 2) setSearching(true);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => searchUsers(text), 400);
    },
    [searchUsers]
  );

  const isSearchActive = searchQuery.trim().length >= 2;

  const pendingCount = incomingPending.length + outgoingPending.length;

  const requestItems = [
    ...incomingPending.map(f => ({ ...f, _type: 'incoming' as const })),
    ...outgoingPending.map(f => ({ ...f, _type: 'outgoing' as const })),
  ];

  return (
    <View style={styles.container}>
      {/* Search bar */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder={i18n.t('friends.searchPlaceholder')}
          placeholderTextColor={COLORS.gray.text}
          value={searchQuery}
          onChangeText={handleSearchChange}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity
            style={styles.clearButton}
            accessibilityRole="button"
            accessibilityLabel={i18n.t('friends.clearSearch')}
            onPress={() => {
              if (debounceRef.current) {
                clearTimeout(debounceRef.current);
                debounceRef.current = null;
              }
              // Invalidate any in-flight Supabase request so its response is discarded.
              searchTokenRef.current += 1;
              setSearching(false);
              setSearchQuery('');
              setSearchResults([]);
            }}
          >
            <Text style={styles.clearButtonText}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Search results (replaces tabs while active) */}
      {isSearchActive ? (
        <View style={styles.searchResults}>
          {searching ? (
            <ActivityIndicator size="small" color={COLORS.secondary} style={styles.loader} />
          ) : searchResults.length === 0 ? (
            <Text style={styles.empty}>{i18n.t('friends.noResults')}</Text>
          ) : (
            searchResults.map(result => (
              <View key={result.id} style={styles.searchResultRow}>
                <Text style={styles.searchResultName} numberOfLines={1}>
                  {result.username}
                </Text>
                <AddFriendButton targetUserId={result.id} compact />
              </View>
            ))
          )}
        </View>
      ) : (
        <>
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

          {loading ? (
            <ActivityIndicator size="small" color={COLORS.secondary} style={styles.loader} />
          ) : (
            <View>
              {tab === 'friends' ? (
                friends.length === 0 ? (
                  <Text style={styles.empty}>{i18n.t('friends.noFriends')}</Text>
                ) : (
                  friends.map(item => (
                    <FriendCard
                      key={item.id}
                      item={item}
                      type="accepted"
                      isOnline={isOnline(item.friend.id)}
                      onToggleFavorite={toggleFavorite}
                      onRemove={removeFriend}
                      onPress={() => navigation.navigate('Stats', { userId: item.friend.id })}
                    />
                  ))
                )
              ) : requestItems.length === 0 ? (
                <Text style={styles.empty}>{i18n.t('friends.noPending')}</Text>
              ) : (
                requestItems.map(item => (
                  <FriendCard
                    key={item.id}
                    item={item}
                    type={item._type}
                    onAccept={item._type === 'incoming' ? acceptRequest : undefined}
                    onDecline={declineRequest}
                  />
                ))
              )}
            </View>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.gray.dark,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: SPACING.sm,
  },
  searchInput: {
    flex: 1,
    color: COLORS.white,
    fontSize: FONT_SIZES.sm,
    paddingVertical: SPACING.sm,
  },
  clearButton: {
    padding: SPACING.xs,
  },
  clearButtonText: {
    color: COLORS.gray.text,
    fontSize: FONT_SIZES.md,
  },
  searchResults: {
    flex: 1,
  },
  searchResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.gray.dark,
  },
  searchResultName: {
    color: COLORS.white,
    fontSize: FONT_SIZES.sm,
    fontWeight: '500',
    flex: 1,
    marginRight: SPACING.sm,
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
