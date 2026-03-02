import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  FlatList,
  Image,
} from 'react-native';
import { useRoute, RouteProp, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { formatDistanceToNow, format } from 'date-fns';
import { SafeAreaView } from 'react-native-safe-area-context';
import EmptyState from '../components/EmptyState';
import StreakGraph from '../components/stats/StreakGraph';
import { COLORS, SPACING, FONT_SIZES } from '../constants';
import { useAuth } from '../contexts/AuthContext';
import { i18n } from '../i18n';
import { RootStackParamList } from '../navigation/AppNavigator';
import { supabase } from '../services/supabase';
import { statsLogger } from '../utils/logger';

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
  lowest_score: number | null;
  avg_score_per_game: number;
  avg_cards_left_in_hand: number;
  current_win_streak: number;
  longest_win_streak: number;
  current_loss_streak: number;
  global_rank: number | null;
  rank_points: number;
  rank_points_history: { timestamp: string; points: number; is_win: boolean; game_type: string }[] | null;
  // Per-mode stats (DB column names)
  casual_games_played: number;
  casual_games_won: number;
  casual_games_lost: number;
  casual_win_rate: number;
  casual_rank_points: number;
  ranked_games_played: number;
  ranked_games_won: number;
  ranked_games_lost: number;
  ranked_win_rate: number;
  ranked_rank_points: number;
  private_games_played: number;
  private_games_won: number;
  private_games_lost: number;
  private_win_rate: number;
  // Game completion
  games_completed: number;
  games_abandoned: number;
  completion_rate: number;
  current_completion_streak: number;
  longest_completion_streak: number;
  // Combo stats
  singles_played: number;
  pairs_played: number;
  triples_played: number;
  straights_played: number;
  flushes_played: number;
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
  game_type: string | null;
  winner_id: string;
  game_completed: boolean | null;
  player_1_username: string | null;
  player_2_username: string | null;
  player_3_username: string | null;
  player_4_username: string | null;
  player_1_score: number;
  player_2_score: number;
  player_3_score: number;
  player_4_score: number;
  // Bot tracking
  player_1_was_bot: boolean | null;
  player_2_was_bot: boolean | null;
  player_3_was_bot: boolean | null;
  player_4_was_bot: boolean | null;
  player_1_original_username: string | null;
  player_2_original_username: string | null;
  player_3_original_username: string | null;
  player_4_original_username: string | null;
  // Disconnect tracking
  player_1_disconnected: boolean | null;
  player_2_disconnected: boolean | null;
  player_3_disconnected: boolean | null;
  player_4_disconnected: boolean | null;
  // Cards left
  player_1_cards_left: number | null;
  player_2_cards_left: number | null;
  player_3_cards_left: number | null;
  player_4_cards_left: number | null;
  game_duration_seconds: number | null;
  finished_at: string;
}

type StatsTab = 'overview' | 'casual' | 'private' | 'ranked';

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
  const [activeTab, setActiveTab] = useState<StatsTab>('overview');

  const fetchData = useCallback(async () => {
    if (!userId) return;

    try {
      statsLogger.info('[Stats] Fetching data for user:', userId.slice(0, 8) + '...');

      // Fetch player stats
      const { data: statsData, error: statsError } = await supabase
        .from('player_stats')
        .select('*')
        .eq('user_id', userId)
        .single();

      // Handle stats errors explicitly
      if (statsError) {
        if (statsError.code === 'PGRST116') {
          // No rows found - user has no stats yet
          setStats(null);
        } else {
          // Other error - log and throw
          statsLogger.error('[Stats] Stats query error:', statsError?.message || statsError?.code || 'Unknown error');
          throw statsError;
        }
      } else {
        setStats(statsData);
      }

      // Fetch profile
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('username, avatar_url')
        .eq('id', userId)
        .single();

      if (profileError) {
        statsLogger.error('[Stats] Profile query error:', profileError);
        throw profileError;
      }

      setProfile(profileData);

      // Fetch game history (last 100 games for graph)
      const { data: historyData, error: historyError } = await supabase
        .from('game_history')
        .select('*')
        .or(`player_1_id.eq.${userId},player_2_id.eq.${userId},player_3_id.eq.${userId},player_4_id.eq.${userId}`)
        .order('finished_at', { ascending: false })
        .limit(100);

      if (historyError) {
        statsLogger.error('[Stats] History query error:', historyError);
      } else {
        setGameHistory(historyData || []);
      }

    } catch (error: unknown) {
      // Only log error message/code to avoid exposing DB internals
      statsLogger.error('[Stats] Error fetching data:', error instanceof Error ? error.message : String(error));
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

  // ─── Per-mode derived data ─────────────────────────────────────────────────
  // Filter game history by game_type for per-mode tabs
  const filteredGameHistory = React.useMemo(() => {
    if (activeTab === 'overview') return gameHistory;
    return gameHistory.filter((g) => g.game_type === activeTab);
  }, [gameHistory, activeTab]);

  // Per-mode games played / completed for completion section
  const modeGamesPlayed = React.useMemo(() => {
    if (!stats || activeTab === 'overview') return 0;
    if (activeTab === 'casual') return stats.casual_games_played || 0;
    if (activeTab === 'ranked') return stats.ranked_games_played || 0;
    return stats.private_games_played || 0;
  }, [stats, activeTab]);

  const modeGamesCompleted = React.useMemo(() => {
    // NOTE: game history is capped at the last 100 entries fetched (per .limit(100)).
    // For heavy users with >100 games per mode this count may undercount vs the true total.
    // TODO: add casual_games_completed / ranked_games_completed / private_games_completed
    // DB columns and use them here once the migration lands.
    if (activeTab === 'overview') return stats?.games_completed || 0;
    return filteredGameHistory.filter((g) => g.game_completed !== false).length;
  }, [filteredGameHistory, activeTab, stats]);
  // ─────────────────────────────────────────────────────────────────────────────

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
    const isIncomplete = item.game_completed === false;

    return (
      <View style={[styles.historyItem, isWinner && styles.historyItemWin, isIncomplete && styles.historyItemIncomplete]}>
        <View style={styles.historyHeader}>
          <View style={styles.historyResult}>
            <Text style={[styles.resultBadge, isWinner ? styles.winBadge : styles.lossBadge]}>
              {isWinner ? '🏆 WIN' : '❌ LOSS'}
            </Text>
            <Text style={styles.historyCode}>Room: {item.room_code}</Text>
            {item.game_type && (
              <Text style={styles.gameTypeBadge}>
                {item.game_type === 'ranked' ? '🏆' : item.game_type === 'private' ? '🔒' : '🎮'}
              </Text>
            )}
            {isIncomplete && (
              <Text style={styles.incompleteBadge}>⚠️ Incomplete</Text>
            )}
          </View>
          <Text style={styles.historyTime}>{timeAgo}</Text>
        </View>
        
        <View style={styles.historyPlayers}>
          {[1, 2, 3, 4].map((num) => {
            const username = item[`player_${num}_username` as keyof GameHistoryEntry] as string;
            const score = item[`player_${num}_score` as keyof GameHistoryEntry] as number;
            const wasBot = item[`player_${num}_was_bot` as keyof GameHistoryEntry] as boolean | null;
            const originalUsername = item[`player_${num}_original_username` as keyof GameHistoryEntry] as string | null;
            const disconnected = item[`player_${num}_disconnected` as keyof GameHistoryEntry] as boolean | null;
            const cardsLeft = item[`player_${num}_cards_left` as keyof GameHistoryEntry] as number | null;
            if (!username) return null;
            
            return (
              <View key={num} style={styles.historyPlayer}>
                <View style={styles.historyPlayerNameRow}>
                  <Text style={styles.historyPlayerName} numberOfLines={1}>
                    {wasBot && originalUsername 
                      ? `🤖 Bot (replaced ${originalUsername})`
                      : wasBot 
                        ? `🤖 ${username}` 
                        : username}
                  </Text>
                  {disconnected && <Text style={styles.disconnectedBadge}>📡 DC</Text>}
                </View>
                <View style={styles.historyPlayerScoreRow}>
                  <Text style={styles.historyPlayerScore}>{score} pts</Text>
                  {cardsLeft != null && cardsLeft > 0 && (
                    <Text style={styles.cardsLeftBadge}>🃏{cardsLeft}</Text>
                  )}
                </View>
              </View>
            );
          })}
        </View>

        <Text style={styles.historyDuration}>Duration: {duration}</Text>
      </View>
    );
  };

  const getTimeAgo = (date: Date): string => {
    try {
      return formatDistanceToNow(date, { addSuffix: true });
    } catch (error) {
      console.warn('[StatsScreen] getTimeAgo fallback:', error);
      return format(date, 'MMM d, yyyy');
    }
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
        <EmptyState
          icon="📊"
          title="No stats available"
          subtitle={isOwnProfile ? 'Play some games to see your stats!' : 'This user hasn\'t played any games yet.'}
          action={{
            label: 'Go Back',
            onPress: () => navigation.goBack(),
          }}
        />
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
              <Image
                source={{ uri: profile.avatar_url }}
                style={styles.avatar}
                resizeMode="cover"
              />
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

        {/* Tab Bar: Overview / Casual / Private / Ranked */}
        <View style={styles.tabBar}>
          {(['overview', 'casual', 'private', 'ranked'] as StatsTab[]).map((tab) => (
            <TouchableOpacity
              key={tab}
              style={[styles.tabButton, activeTab === tab && styles.tabButtonActive]}
              onPress={() => setActiveTab(tab)}
            >
              <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
                {tab === 'overview' ? '📊 Overview' : tab === 'casual' ? '🎮 Casual' : tab === 'private' ? '🔒 Private' : '🏆 Ranked'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Mode-Aware Key Stats */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {activeTab === 'overview' ? i18n.t('profile.overview') : `${activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} Stats`}
          </Text>

          {/* Core 4 cards — played / win rate / won / lost */}
          <View style={styles.statsGrid}>
            {activeTab === 'overview' && (
              <>
                {renderStatCard(i18n.t('profile.gamesPlayed'), stats.games_played, '🎮')}
                {renderStatCard(i18n.t('profile.winRate'), `${stats.win_rate.toFixed(1)}%`, '🏆')}
                {renderStatCard(i18n.t('profile.gamesWon'), stats.games_won, '✅')}
                {renderStatCard(i18n.t('profile.gamesLost'), stats.games_lost, '❌')}
              </>
            )}
            {activeTab === 'casual' && (
              <>
                {renderStatCard(i18n.t('profile.gamesPlayed'), stats.casual_games_played || 0, '🎮')}
                {renderStatCard(i18n.t('profile.winRate'), `${(stats.casual_win_rate || 0).toFixed(1)}%`, '🏆')}
                {renderStatCard(i18n.t('profile.gamesWon'), stats.casual_games_won || 0, '✅')}
                {renderStatCard(i18n.t('profile.gamesLost'), stats.casual_games_lost || 0, '❌')}
              </>
            )}
            {activeTab === 'private' && (
              <>
                {renderStatCard(i18n.t('profile.gamesPlayed'), stats.private_games_played || 0, '🎮')}
                {renderStatCard(i18n.t('profile.winRate'), `${(stats.private_win_rate || 0).toFixed(1)}%`, '🏆')}
                {renderStatCard(i18n.t('profile.gamesWon'), stats.private_games_won || 0, '✅')}
                {renderStatCard(i18n.t('profile.gamesLost'), stats.private_games_lost || 0, '❌')}
              </>
            )}
            {activeTab === 'ranked' && (
              <>
                {renderStatCard(i18n.t('profile.gamesPlayed'), stats.ranked_games_played || 0, '🎮')}
                {renderStatCard(i18n.t('profile.winRate'), `${(stats.ranked_win_rate || 0).toFixed(1)}%`, '🏆')}
                {renderStatCard(i18n.t('profile.gamesWon'), stats.ranked_games_won || 0, '✅')}
                {renderStatCard(i18n.t('profile.gamesLost'), stats.ranked_games_lost || 0, '❌')}
              </>
            )}
          </View>

          {/* Rank Points + secondary metric — overview, casual, ranked, private */}
          <View style={[styles.statsGrid, { marginTop: SPACING.md }]}>
            {activeTab === 'overview' && (
              <>
                {renderStatCard(i18n.t('profile.rankPoints'), stats.rank_points, '⭐')}
                {renderStatCard(i18n.t('profile.rank'), stats.global_rank ? `#${stats.global_rank}` : '#N/A', '🌐')}
              </>
            )}
            {activeTab === 'casual' && (
              <>
                {renderStatCard(i18n.t('profile.rankPoints'), stats.casual_rank_points || 0, '⭐')}
                {renderStatCard(i18n.t('profile.totalPoints'), (stats.total_points || 0).toLocaleString(), '💎')}
              </>
            )}
            {activeTab === 'ranked' && (
              <>
                {renderStatCard(i18n.t('profile.rankPoints'), stats.ranked_rank_points || 0, '⭐')}
                {renderStatCard(i18n.t('profile.rank'), stats.global_rank ? `#${stats.global_rank}` : '#N/A', '🌐')}
              </>
            )}
            {activeTab === 'private' && (
              <>
                {renderStatCard(i18n.t('profile.totalPoints'), (stats.total_points || 0).toLocaleString(), '💎')}
                {renderStatCard(i18n.t('profile.avgScore'), stats.avg_score_per_game?.toFixed(0) || 'N/A', '📈')}
              </>
            )}
          </View>

          {/* Streaks — all tabs */}
          <Text style={[styles.sectionTitle, { marginTop: SPACING.lg }]}>{i18n.t('profile.streaks')}</Text>
          <View style={styles.streaksContainer}>
            <View style={styles.streakItem}>
              <Text style={styles.streakLabel}>{i18n.t('profile.currentStreak')}</Text>
              <Text style={[styles.streakValue, stats.current_win_streak > 0 && styles.streakValueActive]}>
                {stats.current_win_streak > 0
                  ? `🔥 ${stats.current_win_streak} ${i18n.t('profile.wins')}`
                  : stats.current_loss_streak > 0
                    ? `❄️ ${stats.current_loss_streak} ${i18n.t('profile.losses')}`
                    : 'None'}
              </Text>
            </View>
            <View style={styles.streakItem}>
              <Text style={styles.streakLabel}>{i18n.t('profile.bestStreak')}</Text>
              <Text style={styles.streakValue}>🏅 {stats.longest_win_streak} {i18n.t('profile.wins')}</Text>
            </View>
          </View>

          {/* Total Points row — private / ranked only (Casual already shows it in the rank points card) */}
          {(activeTab === 'private' || activeTab === 'ranked') && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>{i18n.t('profile.totalScore')}</Text>
              <Text style={styles.infoValue}>{(stats.total_points || 0).toLocaleString()}</Text>
            </View>
          )}
        </View>

        {/* Game Completion Section — all tabs */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{i18n.t('profile.gameCompletion')}</Text>
          <View style={styles.completionContainer}>
            <View style={styles.completionMain}>
              <View style={styles.completionCircle}>
                <Text style={styles.completionPercentage}>
                  {activeTab === 'overview'
                    ? (stats.completion_rate || 0).toFixed(0)
                    : modeGamesPlayed > 0
                      ? ((modeGamesCompleted / modeGamesPlayed) * 100).toFixed(0)
                      : '0'}%
                </Text>
                <Text style={styles.completionLabel}>Completed</Text>
              </View>
              <View style={styles.completionDetails}>
                <View style={styles.completionRow}>
                  <Text style={styles.completionDetailLabel}>✅ Completed</Text>
                  <Text style={styles.completionDetailValue}>
                    {activeTab === 'overview' ? (stats.games_completed || 0) : modeGamesCompleted}
                  </Text>
                </View>
                <View style={styles.completionRow}>
                  <Text style={styles.completionDetailLabel}>🚪 Abandoned</Text>
                  <Text style={styles.completionDetailValue}>
                    {activeTab === 'overview'
                      ? (stats.games_abandoned || 0)
                      : Math.max(0, modeGamesPlayed - modeGamesCompleted)}
                  </Text>
                </View>
                {activeTab === 'overview' && (
                  <>
                    <View style={styles.completionRow}>
                      <Text style={styles.completionDetailLabel}>🔥 Current Streak</Text>
                      <Text style={[styles.completionDetailValue, (stats.current_completion_streak || 0) > 0 && styles.streakValueActive]}>
                        {stats.current_completion_streak || 0}
                      </Text>
                    </View>
                    <View style={styles.completionRow}>
                      <Text style={styles.completionDetailLabel}>🏅 Best Streak</Text>
                      <Text style={styles.completionDetailValue}>{stats.longest_completion_streak || 0}</Text>
                    </View>
                  </>
                )}
              </View>
            </View>
          </View>
        </View>

        {/* Standalone Streaks section removed — now rendered inline in core stats section above */}

        {/* Rank Progression Graph — Overview + Ranked only */}
        {(activeTab === 'overview' || activeTab === 'ranked') && userId && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{i18n.t('profile.rankProgression')}</Text>
            <StreakGraph 
              gameHistory={gameHistory} 
              userId={userId} 
              rankPointsHistory={
                activeTab === 'ranked'
                  ? (Array.isArray(stats.rank_points_history)
                      ? stats.rank_points_history.filter((e) => e?.game_type === 'ranked')
                      : undefined)
                  : stats.rank_points_history || undefined
              }
            />
          </View>
        )}

        {/* Performance — all tabs (uses overall stats; per-mode not tracked yet) */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{i18n.t('profile.performance')}</Text>
          <View style={styles.statsGrid}>
            {renderStatCard(i18n.t('profile.avgPosition'), stats.avg_finish_position?.toFixed(2) || 'N/A', '📊')}
            {renderStatCard(i18n.t('profile.totalPoints'), stats.total_points.toLocaleString(), '💎')}
            {renderStatCard(i18n.t('profile.highestScore'), stats.highest_score, '💀')}
            {renderStatCard(i18n.t('profile.lowestScore'), stats.lowest_score ?? 0, '⭐')}
            {renderStatCard(i18n.t('profile.avgScore'), stats.avg_score_per_game?.toFixed(0) || 'N/A', '📈')}
            {renderStatCard(i18n.t('profile.avgCardsLeft'), (stats.avg_cards_left_in_hand || 0).toFixed(1), '🃏')}
          </View>
        </View>

        {/* Combo Stats — all tabs (overall; per-mode not tracked yet) */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{i18n.t('profile.combosPlayed')}</Text>
          <View style={styles.comboGrid}>
            {renderComboCard(i18n.t('profile.singles'), stats.singles_played, '🃏')}
            {renderComboCard(i18n.t('profile.pairs'), stats.pairs_played, '🃏🃏')}
            {renderComboCard(i18n.t('profile.triples'), stats.triples_played, '🃏🃏🃏')}
            {renderComboCard(i18n.t('profile.straights'), stats.straights_played, '➡️')}
            {renderComboCard(i18n.t('profile.flushes'), stats.flushes_played, '🌊')}
            {renderComboCard(i18n.t('profile.fullHouses'), stats.full_houses_played, '🏠')}
            {renderComboCard(i18n.t('profile.fourOfAKind'), stats.four_of_a_kinds_played, '🌟')}
            {renderComboCard(i18n.t('profile.straightFlush'), stats.straight_flushes_played, '💫')}
            {renderComboCard(i18n.t('profile.royalFlush'), stats.royal_flushes_played, '👑')}
          </View>
        </View>

        {/* Game History — all tabs; filtered by game_type for per-mode tabs */}
        {filteredGameHistory.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{i18n.t('profile.recentGames')}</Text>
            <FlatList
              data={filteredGameHistory.slice(0, 20)}
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
    color: COLORS.white,
    fontSize: FONT_SIZES.md,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.xl,
  },
  emptyText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.xl,
    fontWeight: 'bold',
    marginBottom: SPACING.sm,
  },
  emptySubtext: {
    color: COLORS.white + '99',
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
    color: COLORS.white,
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
    color: COLORS.white,
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
    color: COLORS.white,
    fontSize: FONT_SIZES.xxl * 1.5,
    fontWeight: 'bold',
  },
  username: {
    color: COLORS.white,
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
    color: COLORS.white + '99',
    fontSize: FONT_SIZES.md,
    marginTop: SPACING.xs,
  },
  // Tab Bar
  tabBar: {
    flexDirection: 'row',
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.lg,
    gap: SPACING.xs,
  },
  tabButton: {
    flex: 1,
    paddingVertical: SPACING.sm,
    borderRadius: 8,
    backgroundColor: COLORS.secondary,
    alignItems: 'center',
  },
  tabButtonActive: {
    backgroundColor: COLORS.accent,
  },
  tabText: {
    color: COLORS.white + '99',
    fontSize: FONT_SIZES.xs,
    fontWeight: '600',
  },
  tabTextActive: {
    color: COLORS.white,
  },
  // Game Completion
  completionContainer: {
    backgroundColor: COLORS.secondary,
    borderRadius: 12,
    padding: SPACING.md,
  },
  completionMain: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  completionCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 3,
    borderColor: COLORS.accent,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.md,
  },
  completionPercentage: {
    color: COLORS.accent,
    fontSize: FONT_SIZES.xl,
    fontWeight: 'bold',
  },
  completionLabel: {
    color: COLORS.white + '99',
    fontSize: FONT_SIZES.xs,
  },
  completionDetails: {
    flex: 1,
    gap: SPACING.xs,
  },
  completionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  completionDetailLabel: {
    color: COLORS.white + '99',
    fontSize: FONT_SIZES.sm,
  },
  completionDetailValue: {
    color: COLORS.white,
    fontSize: FONT_SIZES.sm,
    fontWeight: 'bold',
  },
  section: {
    paddingHorizontal: SPACING.lg,
    marginBottom: SPACING.xl,
  },
  sectionTitle: {
    color: COLORS.white,
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
    color: COLORS.white,
    fontSize: FONT_SIZES.xl,
    fontWeight: 'bold',
    marginBottom: SPACING.xs,
  },
  statLabel: {
    color: COLORS.white + '99',
    fontSize: FONT_SIZES.sm,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.white + '22',
    marginTop: SPACING.md,
  },
  infoLabel: {
    color: COLORS.white + '99',
    fontSize: FONT_SIZES.md,
  },
  infoValue: {
    color: COLORS.white,
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
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
    color: COLORS.white + '99',
    fontSize: FONT_SIZES.md,
  },
  streakValue: {
    color: COLORS.white,
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
    color: COLORS.white + '99',
    fontSize: FONT_SIZES.xs,
    textAlign: 'center',
    marginBottom: SPACING.xs,
  },
  comboCount: {
    color: COLORS.white,
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
    borderLeftColor: COLORS.success,
  },
  historyItemIncomplete: {
    borderRightWidth: 4,
    borderRightColor: '#FF9500',
    opacity: 0.85,
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
    backgroundColor: COLORS.success,
    color: COLORS.white,
  },
  lossBadge: {
    backgroundColor: COLORS.error,
    color: COLORS.white,
  },
  historyCode: {
    color: COLORS.white + '99',
    fontSize: FONT_SIZES.xs,
  },
  historyTime: {
    color: COLORS.white + '66',
    fontSize: FONT_SIZES.xs,
  },
  historyPlayers: {
    gap: SPACING.xs,
    marginBottom: SPACING.sm,
  },
  historyPlayer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  historyPlayerNameRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  historyPlayerName: {
    color: COLORS.white,
    fontSize: FONT_SIZES.sm,
    flex: 1,
  },
  historyPlayerScoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  historyPlayerScore: {
    color: COLORS.accent,
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
  },
  disconnectedBadge: {
    fontSize: FONT_SIZES.xs,
    color: '#FF9500',
  },
  gameTypeBadge: {
    fontSize: FONT_SIZES.xs,
  },
  incompleteBadge: {
    fontSize: FONT_SIZES.xs,
    color: '#FF9500',
    fontWeight: '600',
  },
  cardsLeftBadge: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.white + '66',
  },
  historyDuration: {
    color: COLORS.white + '66',
    fontSize: FONT_SIZES.xs,
    fontStyle: 'italic',
  },
});
