import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { COLORS, SPACING, FONT_SIZES } from '../constants';
import { supabase } from '../services/supabase';
import { i18n } from '../i18n';
import { showError } from '../utils';

type RankedLeaderboardNavigationProp = StackNavigationProp<RootStackParamList, 'RankedLeaderboard'>;

interface RankedPlayer {
  user_id: string;
  username: string;
  elo_rating: number;
  ranked_matches_played: number;
  ranked_wins: number;
  ranked_win_rate: number;
}

type TimeFilter = 'allTime' | 'weekly' | 'daily';

/**
 * Ranked Leaderboard Screen
 * 
 * Displays top 100 ranked players by ELO rating
 * - Minimum 10 ranked matches required
 * - Time filters: All-Time, Weekly, Daily
 * - Shows rank badge, username, ELO, matches, win rate
 * - Color-coded by rank tier (Bronze, Silver, Gold, Diamond, Master)
 */
export default function RankedLeaderboardScreen() {
  const navigation = useNavigation<RankedLeaderboardNavigationProp>();
  
  const [players, setPlayers] = useState<RankedPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('allTime');

  useEffect(() => {
    loadLeaderboard();
  }, [timeFilter]);

  const loadLeaderboard = async () => {
    try {
      setLoading(true);
      
      // Query profiles with minimum 10 ranked matches
      const { data, error } = await supabase
        .from('profiles')
        .select('user_id:id, username, elo_rating, ranked_matches_played, ranked_wins')
        .gte('ranked_matches_played', 10)
        .order('elo_rating', { ascending: false })
        .limit(100);

      if (error) throw error;

      // Calculate win rates
      const rankedPlayers: RankedPlayer[] = (data || []).map((player: any) => ({
        ...player,
        ranked_win_rate: player.ranked_matches_played > 0 
          ? (player.ranked_wins / player.ranked_matches_played) * 100 
          : 0,
      }));

      setPlayers(rankedPlayers);
    } catch (error: any) {
      console.error('Error loading ranked leaderboard:', error);
      showError(error?.message || 'Failed to load leaderboard');
    } finally {
      setLoading(false);
    }
  };

  const getRankBadge = (rank: number) => {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return `#${rank}`;
  };

  const getRankColor = (elo: number) => {
    if (elo >= 2200) return '#A855F7'; // Master - Purple
    if (elo >= 1800) return '#3B82F6'; // Diamond - Blue
    if (elo >= 1400) return '#FFD700'; // Gold
    if (elo >= 1000) return '#C0C0C0'; // Silver
    return '#CD7F32'; // Bronze
  };

  const getRankTier = (elo: number) => {
    if (elo >= 2200) return '👑 Master';
    if (elo >= 1800) return '💎 Diamond';
    if (elo >= 1400) return '🥇 Gold';
    if (elo >= 1000) return '🥈 Silver';
    return '🥉 Bronze';
  };

  const renderPlayer = ({ item, index }: { item: RankedPlayer; index: number }) => {
    const rank = index + 1;
    const rankColor = getRankColor(item.elo_rating);

    return (
      <View style={[styles.playerCard, { borderLeftColor: rankColor }]}>
        <View style={styles.rankBadgeContainer}>
          <Text style={[styles.rankBadge, rank <= 3 && styles.topThreeRank]}>
            {getRankBadge(rank)}
          </Text>
        </View>

        <View style={styles.playerInfo}>
          <Text style={styles.username} numberOfLines={1}>{item.username}</Text>
          <Text style={styles.rankTier}>{getRankTier(item.elo_rating)}</Text>
        </View>

        <View style={styles.statsContainer}>
          <View style={styles.eloContainer}>
            <Text style={[styles.eloValue, { color: rankColor }]}>
              {item.elo_rating}
            </Text>
            <Text style={styles.eloLabel}>{i18n.t('matchHistory.elo')}</Text>
          </View>

          <View style={styles.secondaryStats}>
            <Text style={styles.secondaryStatText}>
              {item.ranked_matches_played} {i18n.t('leaderboard.matches')}
            </Text>
            <Text style={styles.secondaryStatText}>
              {item.ranked_win_rate.toFixed(1)}% {i18n.t('leaderboard.winRate')}
            </Text>
          </View>
        </View>
      </View>
    );
  };

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyIcon}>🏆</Text>
      <Text style={styles.emptyTitle}>{i18n.t('leaderboard.noRankedPlayers')}</Text>
      <Text style={styles.emptySubtitle}>{i18n.t('leaderboard.playRankedMatches')}</Text>
    </View>
  );

  const renderHeader = () => (
    <View style={styles.filterContainer}>
      <Text style={styles.filterLabel}>{i18n.t('leaderboard.filter')}</Text>
      <View style={styles.filterButtons}>
        <TouchableOpacity
          style={[styles.filterButton, timeFilter === 'allTime' && styles.filterButtonActive]}
          onPress={() => setTimeFilter('allTime')}
        >
          <Text style={[styles.filterButtonText, timeFilter === 'allTime' && styles.filterButtonTextActive]}>
            {i18n.t('common.allTime')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterButton, timeFilter === 'weekly' && styles.filterButtonActive]}
          onPress={() => setTimeFilter('weekly')}
        >
          <Text style={[styles.filterButtonText, timeFilter === 'weekly' && styles.filterButtonTextActive]}>
            {i18n.t('common.weekly')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterButton, timeFilter === 'daily' && styles.filterButtonActive]}
          onPress={() => setTimeFilter('daily')}
        >
          <Text style={[styles.filterButtonText, timeFilter === 'daily' && styles.filterButtonTextActive]}>
            {i18n.t('common.daily')}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{i18n.t('leaderboard.rankedTitle')}</Text>
        <View style={styles.placeholder} />
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.secondary} />
          <Text style={styles.loadingText}>{i18n.t('common.loading')}</Text>
        </View>
      ) : (
        <FlatList
          data={players}
          renderItem={renderPlayer}
          keyExtractor={(item) => item.user_id}
          ListHeaderComponent={renderHeader}
          ListEmptyComponent={renderEmpty}
          contentContainerStyle={[
            styles.listContent,
            players.length === 0 && styles.listContentEmpty
          ]}
          showsVerticalScrollIndicator={true}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.primary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButtonText: {
    color: COLORS.white,
    fontSize: 24,
    fontWeight: 'bold',
  },
  title: {
    fontSize: FONT_SIZES.xl,
    fontWeight: 'bold',
    color: COLORS.white,
  },
  placeholder: {
    width: 40,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: COLORS.gray.medium,
    fontSize: FONT_SIZES.md,
    marginTop: SPACING.md,
  },
  filterContainer: {
    padding: SPACING.md,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    marginBottom: SPACING.sm,
  },
  filterLabel: {
    color: COLORS.gray.medium,
    fontSize: FONT_SIZES.sm,
    marginBottom: SPACING.xs,
  },
  filterButtons: {
    flexDirection: 'row',
    gap: SPACING.xs,
  },
  filterButton: {
    flex: 1,
    paddingVertical: SPACING.xs,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
  },
  filterButtonActive: {
    backgroundColor: COLORS.secondary,
    borderColor: COLORS.secondary,
  },
  filterButtonText: {
    color: COLORS.gray.light,
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
  },
  filterButtonTextActive: {
    color: COLORS.white,
  },
  listContent: {
    padding: SPACING.md,
  },
  listContentEmpty: {
    flex: 1,
    justifyContent: 'center',
  },
  playerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    borderLeftWidth: 4,
  },
  rankBadgeContainer: {
    width: 50,
    alignItems: 'center',
  },
  rankBadge: {
    fontSize: FONT_SIZES.lg,
    fontWeight: 'bold',
    color: COLORS.gray.medium,
  },
  topThreeRank: {
    fontSize: 28,
  },
  playerInfo: {
    flex: 1,
    marginLeft: SPACING.sm,
  },
  username: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    color: COLORS.white,
    marginBottom: 2,
  },
  rankTier: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.gray.medium,
  },
  statsContainer: {
    alignItems: 'flex-end',
  },
  eloContainer: {
    alignItems: 'center',
    marginBottom: 4,
  },
  eloValue: {
    fontSize: FONT_SIZES.xl,
    fontWeight: 'bold',
  },
  eloLabel: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.gray.medium,
  },
  secondaryStats: {
    alignItems: 'flex-end',
  },
  secondaryStatText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.gray.medium,
  },
  emptyContainer: {
    alignItems: 'center',
    padding: SPACING.xl,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: SPACING.md,
  },
  emptyTitle: {
    fontSize: FONT_SIZES.xl,
    fontWeight: 'bold',
    color: COLORS.white,
    marginBottom: SPACING.xs,
  },
  emptySubtitle: {
    fontSize: FONT_SIZES.md,
    color: COLORS.gray.medium,
    textAlign: 'center',
  },
});
