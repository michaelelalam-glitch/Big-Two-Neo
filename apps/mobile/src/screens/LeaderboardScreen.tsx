import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Image,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import EmptyState from '../components/EmptyState';
import { COLORS, SPACING, FONT_SIZES } from '../constants';
import { useAuth } from '../contexts/AuthContext';
import { i18n } from '../i18n';
import { RootStackParamList } from '../navigation/AppNavigator';
import { supabase } from '../services/supabase';
import { statsLogger } from '../utils/logger';

type LeaderboardScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Leaderboard'>;

interface LeaderboardEntry {
  user_id: string;
  username: string;
  avatar_url: string | null;
  rank_points: number;
  games_played: number;
  games_won: number;
  win_rate: number;
  longest_win_streak: number;
  current_win_streak: number;
  rank: number;
}

type TimeFilter = 'all_time' | 'weekly' | 'daily';
type LeaderboardType = 'global' | 'ranked';

// Note: Supabase client types !inner joins as arrays, even though PostgREST
// returns an object for to-one relationships. Array type kept for TS compat.
interface PlayerStatsWithProfile {
  user_id: string;
  rank_points: number;
  games_played: number;
  games_won: number;
  win_rate: number;
  longest_win_streak: number;
  current_win_streak: number;
  profiles: {
    username: string;
    avatar_url: string | null;
  }[];
}

export default function LeaderboardScreen() {
  const navigation = useNavigation<LeaderboardScreenNavigationProp>();
  const { user } = useAuth();
  
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all_time');
  const [leaderboardType, setLeaderboardType] = useState<LeaderboardType>('global');
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [userRank, setUserRank] = useState<LeaderboardEntry | null>(null);

  const PAGE_SIZE = 20;

  const fetchLeaderboard = useCallback(async (resetPagination: boolean = false) => {
    try {
      const startIndex = resetPagination ? 0 : page * PAGE_SIZE;
      const endIndex = startIndex + PAGE_SIZE - 1;

      statsLogger.info('[Leaderboard] Fetching:', { startIndex, endIndex, timeFilter });

      // Calculate time filter date
      let timeFilterDate: string | null = null;
      if (timeFilter === 'weekly') {
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        timeFilterDate = weekAgo.toISOString();
      } else if (timeFilter === 'daily') {
        const dayAgo = new Date();
        dayAgo.setDate(dayAgo.getDate() - 1);
        timeFilterDate = dayAgo.toISOString();
      }

      // For weekly/daily, query player_stats directly with time filter
      // For all_time, use the optimized materialized view
      let query;
      if (timeFilter === 'all_time') {
        query = supabase
          .from('leaderboard_global')
          .select('*')
          .range(startIndex, endIndex);
      } else {
        // Query player_stats with time filter and join profiles
        query = supabase
          .from('player_stats')
          .select(`
            user_id,
            rank_points,
            games_played,
            games_won,
            win_rate,
            longest_win_streak,
            current_win_streak,
            profiles!inner (
              username,
              avatar_url
            )
          `)
          .gte('last_game_at', timeFilterDate!)
          .gt('games_played', 0)
          .order('rank_points', { ascending: false })
          .order('games_won', { ascending: false })
          .range(startIndex, endIndex);
      }

      const { data, error } = await query;

      if (error) {
        statsLogger.error('[Leaderboard] Query error:', error?.message || error?.code || 'Unknown error');
        throw error;
      }

      // Transform data if querying player_stats directly (weekly/daily)
      let transformedData: LeaderboardEntry[];
      if (timeFilter === 'all_time') {
        transformedData = (data || []) as LeaderboardEntry[];
      } else {
        // Transform joined data to match LeaderboardEntry interface
        transformedData = (data || []).map((item: PlayerStatsWithProfile, index: number) => {
          const profile = Array.isArray(item.profiles) ? item.profiles[0] : item.profiles;
          return {
            user_id: item.user_id,
            username: profile?.username ?? 'Unknown',
            avatar_url: profile?.avatar_url ?? null,
            rank_points: item.rank_points,
            games_played: item.games_played,
            games_won: item.games_won,
            win_rate: item.win_rate,
            longest_win_streak: item.longest_win_streak,
            current_win_streak: item.current_win_streak,
            rank: startIndex + index + 1, // Calculate rank based on position
          };
        });
      }

      if (resetPagination) {
        setLeaderboard(transformedData);
        setPage(0);
      } else {
        setLeaderboard(prev => [...prev, ...transformedData]);
      }

      setHasMore(transformedData.length === PAGE_SIZE);

      // Fetch current user's rank separately
      if (user) {
        let userRankQuery;
        if (timeFilter === 'all_time') {
          userRankQuery = supabase
            .from('leaderboard_global')
            .select('*')
            .eq('user_id', user.id)
            .single();
        } else {
          // For weekly/daily, calculate user's rank from player_stats
          userRankQuery = supabase
            .from('player_stats')
            .select(`
              user_id,
              rank_points,
              games_played,
              games_won,
              win_rate,
              longest_win_streak,
              current_win_streak,
              profiles!inner (
                username,
                avatar_url
              )
            `)
            .eq('user_id', user.id)
            .gte('last_game_at', timeFilterDate || '1970-01-01')
            .gt('games_played', 0)
            .single();
        }

        const { data: userRankData } = await userRankQuery;

        if (userRankData) {
          if (timeFilter === 'all_time') {
            // Only show rank if user has played games
            if (userRankData.games_played > 0) {
              setUserRank(userRankData);
            } else {
              setUserRank(null);
            }
          } else {
            // For weekly/daily: Check if user played ANY games in this period
            // Query game_history to count actual games within the time range
            const { data: periodGames, error: periodError } = await supabase
              .from('game_history')
              .select('id', { count: 'exact', head: true })
              .or(`player_1_id.eq.${user.id},player_2_id.eq.${user.id},player_3_id.eq.${user.id},player_4_id.eq.${user.id}`)
              .gte('finished_at', timeFilterDate!)
              .limit(1);

            // If no games in this period, hide rank card
            if (periodError || !periodGames) {
              statsLogger.info('[Leaderboard] Error checking period games:', periodError);
              setUserRank(null);
            } else {
              // Transform weekly/daily data
              // Calculate rank by counting users with higher points
              const { count } = await supabase
                .from('player_stats')
                .select('*', { count: 'exact', head: true })
                .gte('last_game_at', timeFilterDate!)
                .gt('games_played', 0)
                .gt('rank_points', userRankData.rank_points);

              setUserRank({
                user_id: userRankData.user_id,
                username: userRankData.profiles.username,
                avatar_url: userRankData.profiles.avatar_url,
                rank_points: userRankData.rank_points,
                games_played: userRankData.games_played,
                games_won: userRankData.games_won,
                win_rate: userRankData.win_rate,
                longest_win_streak: userRankData.longest_win_streak,
                current_win_streak: userRankData.current_win_streak,
                rank: (count || 0) + 1,
              });
            }
          }
        } else {
          // User hasn't played any games yet, clear rank card
          setUserRank(null);
        }
      }
    } catch (error: unknown) {
      statsLogger.error('[Leaderboard] Error fetching leaderboard:', error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [page, timeFilter, user]);

  useEffect(() => {
    fetchLeaderboard(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeFilter]); // Intentionally only trigger on timeFilter change, not fetchLeaderboard

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setPage(0);
    fetchLeaderboard(true);
  }, [fetchLeaderboard]);

  const loadMore = useCallback(() => {
    if (!loading && hasMore) {
      // Increment page and pass the NEW page value to avoid stale closure
      setPage(prev => {
        const nextPage = prev + 1;
        fetchLeaderboard(false);
        return nextPage;
      });
    }
  }, [loading, hasMore, fetchLeaderboard]);

  const renderHeader = () => (
    <View style={styles.headerContainer}>
      <Text style={styles.title}>{i18n.t('leaderboard.title')}</Text>
      
      {/* Leaderboard Type Toggle */}
      <View style={[styles.filterContainer, { marginBottom: SPACING.sm }]}>
        <TouchableOpacity
          style={[styles.filterButton, leaderboardType === 'global' && styles.filterButtonActive]}
          onPress={() => setLeaderboardType('global')}
        >
          <Text style={[styles.filterText, leaderboardType === 'global' && styles.filterTextActive]}>
            {i18n.t('common.allTime')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterButton, leaderboardType === 'ranked' && styles.filterButtonActive]}
          onPress={() => setLeaderboardType('ranked')}
        >
          <Text style={[styles.filterText, leaderboardType === 'ranked' && styles.filterTextActive]}>
            🏆 {i18n.t('leaderboard.rankedTitle')}
          </Text>
        </TouchableOpacity>
      </View>
      
      {/* User's Rank Card */}
      {userRank && (
        <View style={styles.userRankCard}>
          <View style={styles.rankBadge}>
            <Text style={styles.rankBadgeText}>#{userRank.rank}</Text>
          </View>
          <View style={styles.userRankInfo}>
            <Text style={styles.userRankUsername}>{userRank.username}</Text>
            <Text style={styles.userRankStats}>
              {userRank.rank_points} {i18n.t('leaderboard.points')} • {userRank.games_won}W / {userRank.games_played}G
            </Text>
          </View>
        </View>
      )}

      {/* Filter Tabs */}
      <View style={styles.filterContainer}>
        <TouchableOpacity
          style={[styles.filterButton, timeFilter === 'all_time' && styles.filterButtonActive]}
          onPress={() => setTimeFilter('all_time')}
        >
          <Text style={[styles.filterText, timeFilter === 'all_time' && styles.filterTextActive]}>
            {i18n.t('leaderboard.allTime')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterButton, timeFilter === 'weekly' && styles.filterButtonActive]}
          onPress={() => setTimeFilter('weekly')}
        >
          <Text style={[styles.filterText, timeFilter === 'weekly' && styles.filterTextActive]}>
            {i18n.t('leaderboard.weekly')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterButton, timeFilter === 'daily' && styles.filterButtonActive]}
          onPress={() => setTimeFilter('daily')}
        >
          <Text style={[styles.filterText, timeFilter === 'daily' && styles.filterTextActive]}>
            {i18n.t('leaderboard.daily')}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Column Headers */}
      <View style={styles.columnHeaders}>
        <Text style={[styles.columnHeader, styles.rankColumn]}>{i18n.t('leaderboard.rank')}</Text>
        <Text style={[styles.columnHeader, styles.playerColumn]}>{i18n.t('leaderboard.player')}</Text>
        <Text style={[styles.columnHeader, styles.statsColumn]}>{i18n.t('leaderboard.winLoss')}</Text>
        <Text style={[styles.columnHeader, styles.pointsColumn]}>{i18n.t('leaderboard.points')}</Text>
      </View>
    </View>
  );

  const renderItem = ({ item, index: _index }: { item: LeaderboardEntry; index: number }) => {
    const isCurrentUser = user && item.user_id === user.id;
    const rankColor = 
      item.rank === 1 ? COLORS.gold : 
      item.rank === 2 ? COLORS.silver : 
      item.rank === 3 ? COLORS.bronze : 
      COLORS.white;

    return (
      <TouchableOpacity
        style={[
          styles.leaderboardItem,
          isCurrentUser && styles.leaderboardItemHighlight,
        ]}
        onPress={() => navigation.navigate('Stats', { userId: item.user_id })}
      >
        {/* Rank */}
        <View style={styles.rankColumn}>
          <Text style={[styles.rankText, { color: rankColor }]}>
            #{item.rank}
          </Text>
          {item.rank <= 3 && (
            <Text style={styles.medal}>
              {item.rank === 1 ? '👑' : item.rank === 2 ? '🥈' : '🥉'}
            </Text>
          )}
        </View>

        {/* Player Info */}
        <View style={styles.playerColumn}>
          <View style={styles.playerAvatar}>
            {item.avatar_url ? (
              <Image
                source={{ uri: item.avatar_url }}
                style={styles.avatarImage}
                resizeMode="cover"
              />
            ) : (
              <Text style={styles.avatarPlaceholder}>
                {item.username.charAt(0).toUpperCase()}
              </Text>
            )}
          </View>
          <View style={styles.playerInfo}>
            <Text style={styles.playerName} numberOfLines={1}>
              {item.username}
            </Text>
            {item.current_win_streak > 0 && (
              <Text style={styles.streakText}>
                🔥 {item.current_win_streak} {i18n.t('leaderboard.winStreak')}
              </Text>
            )}
          </View>
        </View>

        {/* Win/Loss */}
        <View style={styles.statsColumn}>
          <Text style={styles.winsText}>{item.games_won}W</Text>
          <Text style={styles.lossesText}>
            {item.games_played - item.games_won}L
          </Text>
        </View>

        {/* Points */}
        <View style={styles.pointsColumn}>
          <Text style={styles.pointsText}>{item.rank_points}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderFooter = () => {
    if (!loading) return null;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="small" color={COLORS.accent} />
      </View>
    );
  };

  const renderEmpty = () => (
    <EmptyState
      icon="🏆"
      title={i18n.t('leaderboard.noRankings')}
      subtitle={i18n.t('leaderboard.playToRank')}
    />
  );

  if (loading && leaderboard.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.accent} />
          <Text style={styles.loadingText}>{i18n.t('common.loading')}...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <FlatList
        data={leaderboard}
        renderItem={renderItem}
        keyExtractor={(item) => item.user_id}
        ListHeaderComponent={renderHeader}
        ListFooterComponent={renderFooter}
        ListEmptyComponent={renderEmpty}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.accent}
            colors={[COLORS.accent]}
          />
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.3}
        contentContainerStyle={styles.listContent}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.primary,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: SPACING.md,
    color: COLORS.white,
    fontSize: FONT_SIZES.md,
  },
  listContent: {
    paddingBottom: SPACING.xl,
  },
  headerContainer: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.md,
  },
  title: {
    fontSize: FONT_SIZES.xxl,
    fontWeight: 'bold',
    color: COLORS.white,
    marginBottom: SPACING.md,
  },
  userRankCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.accent + '20',
    borderRadius: 12,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderWidth: 2,
    borderColor: COLORS.accent,
  },
  rankBadge: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: COLORS.accent,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.md,
  },
  rankBadgeText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.lg,
    fontWeight: 'bold',
  },
  userRankInfo: {
    flex: 1,
  },
  userRankUsername: {
    color: COLORS.white,
    fontSize: FONT_SIZES.lg,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  userRankStats: {
    color: COLORS.white + 'CC',
    fontSize: FONT_SIZES.sm,
  },
  filterContainer: {
    flexDirection: 'row',
    marginBottom: SPACING.md,
    gap: SPACING.sm,
  },
  filterButton: {
    flex: 1,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: 8,
    backgroundColor: COLORS.secondary,
    alignItems: 'center',
  },
  filterButtonActive: {
    backgroundColor: COLORS.accent,
  },
  filterText: {
    color: COLORS.white + '99',
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
  },
  filterTextActive: {
    color: COLORS.white,
  },
  filterTextDisabled: {
    color: COLORS.white + '40',
  },
  columnHeaders: {
    flexDirection: 'row',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.secondary,
  },
  columnHeader: {
    color: COLORS.white + '99',
    fontSize: FONT_SIZES.xs,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  leaderboardItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.secondary + '40',
  },
  leaderboardItemHighlight: {
    backgroundColor: COLORS.accent + '10',
  },
  rankColumn: {
    width: 60,
    alignItems: 'center',
  },
  rankText: {
    fontSize: FONT_SIZES.md,
    fontWeight: 'bold',
  },
  medal: {
    fontSize: 12,
    marginTop: 2,
  },
  playerColumn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  playerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.secondary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.sm,
  },
  avatarImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  avatarPlaceholder: {
    color: COLORS.white,
    fontSize: FONT_SIZES.lg,
    fontWeight: 'bold',
  },
  playerInfo: {
    flex: 1,
  },
  playerName: {
    color: COLORS.white,
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
  },
  streakText: {
    color: COLORS.accent,
    fontSize: FONT_SIZES.xs,
    marginTop: 2,
  },
  statsColumn: {
    width: 60,
    alignItems: 'center',
  },
  winsText: {
    color: COLORS.success,
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
  },
  lossesText: {
    color: COLORS.white + '99',
    fontSize: FONT_SIZES.xs,
  },
  pointsColumn: {
    width: 70,
    alignItems: 'flex-end',
  },
  pointsText: {
    color: COLORS.accent,
    fontSize: FONT_SIZES.md,
    fontWeight: 'bold',
  },
  footerLoader: {
    paddingVertical: SPACING.lg,
    alignItems: 'center',
  },
  emptyContainer: {
    paddingVertical: SPACING.xl * 2,
    paddingHorizontal: SPACING.lg,
    alignItems: 'center',
  },
  emptyText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.lg,
    fontWeight: '600',
    marginBottom: SPACING.sm,
  },
  emptySubtext: {
    color: COLORS.white + '99',
    fontSize: FONT_SIZES.sm,
    textAlign: 'center',
  },
});
