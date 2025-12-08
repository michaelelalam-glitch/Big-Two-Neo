import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Image,
  TouchableOpacity,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, RouteProp, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { COLORS, SPACING, FONT_SIZES } from '../constants';
import { supabase } from '../services/supabase';
import { useAuth } from '../contexts/AuthContext';

type StatsScreenRouteProp = RouteProp<RootStackParamList, 'Stats'>;
type StatsScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Stats'>;

interface PlayerStats {
  user_id: string;
  games_played: number;
  games_won: number;
  games_lost: number;
  win_rate: number;
  avg_finish_position: number;
  total_points: number;
  highest_score: number;
  avg_score_per_game: number;
  current_win_streak: number;
  longest_win_streak: number;
  current_loss_streak: number;
  global_rank: number | null;
  rank_points: number;
  // Combo stats
  singles_played: number;
  pairs_played: number;
  triples_played: number;
  straights_played: number;
  full_houses_played: number;
  four_of_a_kinds_played: number;
  straight_flushes_played: number;
  royal_flushes_played: number;
  first_game_at: string | null;
  last_game_at: string | null;
}

interface Profile {
  username: string;
  avatar_url: string | null;
}

interface GameHistoryEntry {
  id: string;
  room_code: string;
  winner_id: string;
  player_1_username: string | null;
  player_2_username: string | null;
  player_3_username: string | null;
  player_4_username: string | null;
  player_1_score: number;
  player_2_score: number;
  player_3_score: number;
  player_4_score: number;
  game_duration_seconds: number | null;
  finished_at: string;
}

export default function StatsScreen() {
  const route = useRoute<StatsScreenRouteProp>();
  const navigation = useNavigation<StatsScreenNavigationProp>();
  const { user } = useAuth();
  
  const userId = route.params?.userId || user?.id;
  const isOwnProfile = userId === user?.id;

  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [gameHistory, setGameHistory] = useState<GameHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    if (!userId) return;

    try {
      console.log('[Stats] Fetching data for user:', userId);

      // Fetch player stats
      const { data: statsData, error: statsError } = await supabase
        .from('player_stats')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (statsError && statsError.code !== 'PGRST116') { // PGRST116 = no rows
        console.error('[Stats] Stats query error:', statsError);
        throw statsError;
      }

      setStats(statsData);

      // Fetch profile
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('username, avatar_url')
        .eq('id', userId)
        .single();

      if (profileError) {
        console.error('[Stats] Profile query error:', profileError);
        throw profileError;
      }

      setProfile(profileData);

      // Fetch game history (last 10 games)
      const { data: historyData, error: historyError } = await supabase
        .from('game_history')
        .select('*')
        .or(`player_1_id.eq.${userId},player_2_id.eq.${userId},player_3_id.eq.${userId},player_4_id.eq.${userId}`)
        .order('finished_at', { ascending: false })
        .limit(10);

      if (historyError) {
        console.error('[Stats] History query error:', historyError);
      } else {
        setGameHistory(historyData || []);
      }

    } catch (error) {
      console.error('[Stats] Error fetching data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData();
  }, [fetchData]);

  const renderStatCard = (label: string, value: string | number, icon?: string) => (
    <View style={styles.statCard}>
      {icon && <Text style={styles.statIcon}>{icon}</Text>}
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );

  const renderComboCard = (name: string, count: number, emoji: string) => (
    <View style={styles.comboCard}>
      <Text style={styles.comboEmoji}>{emoji}</Text>
      <Text style={styles.comboName}>{name}</Text>
      <Text style={styles.comboCount}>{count}</Text>
    </View>
  );

  const renderHistoryItem = ({ item }: { item: GameHistoryEntry }) => {
    const isWinner = item.winner_id === userId;
    const duration = item.game_duration_seconds 
      ? `${Math.floor(item.game_duration_seconds / 60)}m ${item.game_duration_seconds % 60}s`
      : 'N/A';
    
    const finishedDate = new Date(item.finished_at);
    const timeAgo = getTimeAgo(finishedDate);

    return (
      <View style={[styles.historyItem, isWinner && styles.historyItemWin]}>
        <View style={styles.historyHeader}>
          <View style={styles.historyResult}>
            <Text style={[styles.resultBadge, isWinner ? styles.winBadge : styles.lossBadge]}>
              {isWinner ? '🏆 WIN' : '❌ LOSS'}
            </Text>
            <Text style={styles.historyCode}>Room: {item.room_code}</Text>
          </View>
          <Text style={styles.historyTime}>{timeAgo}</Text>
        </View>
        
        <View style={styles.historyPlayers}>
          {[1, 2, 3, 4].map((num) => {
            const username = item[`player_${num}_username` as keyof GameHistoryEntry] as string;
            const score = item[`player_${num}_score` as keyof GameHistoryEntry] as number;
            if (!username) return null;
            
            return (
              <View key={num} style={styles.historyPlayer}>
                <Text style={styles.historyPlayerName} numberOfLines={1}>
                  {username}
                </Text>
                <Text style={styles.historyPlayerScore}>{score} pts</Text>
              </View>
            );
          })}
        </View>

        <Text style={styles.historyDuration}>Duration: {duration}</Text>
      </View>
    );
  };

  const getTimeAgo = (date: Date): string => {
    const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
    
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return date.toLocaleDateString();
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.accent} />
          <Text style={styles.loadingText}>Loading stats...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!stats || !profile) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No stats available</Text>
          <Text style={styles.emptySubtext}>
            {isOwnProfile ? 'Play some games to see your stats!' : 'This user hasn\'t played any games yet.'}
          </Text>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.accent}
            colors={[COLORS.accent]}
          />
        }
      >
        {/* Header */}
        <TouchableOpacity style={styles.backIcon} onPress={() => navigation.goBack()}>
          <Text style={styles.backIconText}>←</Text>
        </TouchableOpacity>

        {/* Profile Section */}
        <View style={styles.profileSection}>
          <View style={styles.avatarContainer}>
            {profile.avatar_url ? (
              <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarText}>
                  {profile.username.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
          </View>
          <Text style={styles.username}>{profile.username}</Text>
          <Text style={styles.rankPoints}>{stats.rank_points} Rank Points</Text>
          {stats.global_rank && (
            <Text style={styles.globalRank}>#{stats.global_rank} Global</Text>
          )}
        </View>

        {/* Key Stats */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Overview</Text>
          <View style={styles.statsGrid}>
            {renderStatCard('Games Played', stats.games_played, '🎮')}
            {renderStatCard('Win Rate', `${stats.win_rate.toFixed(1)}%`, '🏆')}
            {renderStatCard('Games Won', stats.games_won, '✅')}
            {renderStatCard('Games Lost', stats.games_lost, '❌')}
          </View>
        </View>

        {/* Streaks */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Streaks</Text>
          <View style={styles.streaksContainer}>
            <View style={styles.streakItem}>
              <Text style={styles.streakLabel}>Current Streak</Text>
              <Text style={[styles.streakValue, stats.current_win_streak > 0 && styles.streakValueActive]}>
                {stats.current_win_streak > 0 
                  ? `🔥 ${stats.current_win_streak} Wins` 
                  : stats.current_loss_streak > 0
                    ? `❄️ ${stats.current_loss_streak} Losses`
                    : 'None'}
              </Text>
            </View>
            <View style={styles.streakItem}>
              <Text style={styles.streakLabel}>Best Streak</Text>
              <Text style={styles.streakValue}>
                🏅 {stats.longest_win_streak} Wins
              </Text>
            </View>
          </View>
        </View>

        {/* Performance */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Performance</Text>
          <View style={styles.statsGrid}>
            {renderStatCard('Avg Position', stats.avg_finish_position?.toFixed(2) || 'N/A', '📊')}
            {renderStatCard('Total Points', stats.total_points.toLocaleString(), '💎')}
            {renderStatCard('Highest Score', stats.highest_score, '⭐')}
            {renderStatCard('Avg Score', stats.avg_score_per_game?.toFixed(0) || 'N/A', '📈')}
          </View>
        </View>

        {/* Combo Stats */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Combos Played</Text>
          <View style={styles.comboGrid}>
            {renderComboCard('Singles', stats.singles_played, '🃏')}
            {renderComboCard('Pairs', stats.pairs_played, '🃏🃏')}
            {renderComboCard('Triples', stats.triples_played, '🃏🃏🃏')}
            {renderComboCard('Straights', stats.straights_played, '➡️')}
            {renderComboCard('Full Houses', stats.full_houses_played, '🏠')}
            {renderComboCard('Four of a Kind', stats.four_of_a_kinds_played, '🌟')}
            {renderComboCard('Straight Flush', stats.straight_flushes_played, '💫')}
            {renderComboCard('Royal Flush', stats.royal_flushes_played, '👑')}
          </View>
        </View>

        {/* Game History */}
        {gameHistory.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Recent Games</Text>
            <FlatList
              data={gameHistory}
              renderItem={renderHistoryItem}
              keyExtractor={(item) => item.id}
              scrollEnabled={false}
            />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.primary,
  },
  scrollContent: {
    paddingBottom: SPACING.xl,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: SPACING.md,
    color: COLORS.text,
    fontSize: FONT_SIZES.md,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.xl,
  },
  emptyText: {
    color: COLORS.text,
    fontSize: FONT_SIZES.xl,
    fontWeight: 'bold',
    marginBottom: SPACING.sm,
  },
  emptySubtext: {
    color: COLORS.text + '99',
    fontSize: FONT_SIZES.md,
    textAlign: 'center',
    marginBottom: SPACING.xl,
  },
  backButton: {
    backgroundColor: COLORS.accent,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.xl,
    borderRadius: 8,
  },
  backButtonText: {
    color: COLORS.text,
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
  },
  backIcon: {
    position: 'absolute',
    top: SPACING.lg,
    left: SPACING.lg,
    zIndex: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.secondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backIconText: {
    color: COLORS.text,
    fontSize: FONT_SIZES.xl,
  },
  profileSection: {
    alignItems: 'center',
    paddingVertical: SPACING.xl,
    paddingTop: SPACING.xl * 2,
  },
  avatarContainer: {
    marginBottom: SPACING.md,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 3,
    borderColor: COLORS.accent,
  },
  avatarPlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: COLORS.secondary,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: COLORS.accent,
  },
  avatarText: {
    color: COLORS.text,
    fontSize: FONT_SIZES.xxl * 1.5,
    fontWeight: 'bold',
  },
  username: {
    color: COLORS.text,
    fontSize: FONT_SIZES.xxl,
    fontWeight: 'bold',
    marginBottom: SPACING.xs,
  },
  rankPoints: {
    color: COLORS.accent,
    fontSize: FONT_SIZES.lg,
    fontWeight: '600',
  },
  globalRank: {
    color: COLORS.text + '99',
    fontSize: FONT_SIZES.md,
    marginTop: SPACING.xs,
  },
  section: {
    paddingHorizontal: SPACING.lg,
    marginBottom: SPACING.xl,
  },
  sectionTitle: {
    color: COLORS.text,
    fontSize: FONT_SIZES.lg,
    fontWeight: 'bold',
    marginBottom: SPACING.md,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.md,
  },
  statCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: COLORS.secondary,
    borderRadius: 12,
    padding: SPACING.md,
    alignItems: 'center',
  },
  statIcon: {
    fontSize: FONT_SIZES.xxl,
    marginBottom: SPACING.xs,
  },
  statValue: {
    color: COLORS.text,
    fontSize: FONT_SIZES.xl,
    fontWeight: 'bold',
    marginBottom: SPACING.xs,
  },
  statLabel: {
    color: COLORS.text + '99',
    fontSize: FONT_SIZES.sm,
  },
  streaksContainer: {
    gap: SPACING.md,
  },
  streakItem: {
    backgroundColor: COLORS.secondary,
    borderRadius: 12,
    padding: SPACING.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  streakLabel: {
    color: COLORS.text + '99',
    fontSize: FONT_SIZES.md,
  },
  streakValue: {
    color: COLORS.text,
    fontSize: FONT_SIZES.lg,
    fontWeight: 'bold',
  },
  streakValueActive: {
    color: COLORS.accent,
  },
  comboGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  comboCard: {
    width: '23%',
    backgroundColor: COLORS.secondary,
    borderRadius: 8,
    padding: SPACING.sm,
    alignItems: 'center',
  },
  comboEmoji: {
    fontSize: FONT_SIZES.lg,
    marginBottom: SPACING.xs,
  },
  comboName: {
    color: COLORS.text + '99',
    fontSize: FONT_SIZES.xs,
    textAlign: 'center',
    marginBottom: SPACING.xs,
  },
  comboCount: {
    color: COLORS.text,
    fontSize: FONT_SIZES.md,
    fontWeight: 'bold',
  },
  historyItem: {
    backgroundColor: COLORS.secondary,
    borderRadius: 12,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  historyItemWin: {
    borderLeftWidth: 4,
    borderLeftColor: '#4CAF50',
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  historyResult: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  resultBadge: {
    fontSize: FONT_SIZES.xs,
    fontWeight: 'bold',
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: 4,
  },
  winBadge: {
    backgroundColor: '#4CAF50',
    color: COLORS.text,
  },
  lossBadge: {
    backgroundColor: '#F44336',
    color: COLORS.text,
  },
  historyCode: {
    color: COLORS.text + '99',
    fontSize: FONT_SIZES.xs,
  },
  historyTime: {
    color: COLORS.text + '66',
    fontSize: FONT_SIZES.xs,
  },
  historyPlayers: {
    gap: SPACING.xs,
    marginBottom: SPACING.sm,
  },
  historyPlayer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  historyPlayerName: {
    color: COLORS.text,
    fontSize: FONT_SIZES.sm,
    flex: 1,
  },
  historyPlayerScore: {
    color: COLORS.accent,
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
  },
  historyDuration: {
    color: COLORS.text + '66',
    fontSize: FONT_SIZES.xs,
    fontStyle: 'italic',
  },
});
