import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, SPACING, FONT_SIZES } from '../constants';
import { useAuth } from '../contexts/AuthContext';
import { i18n } from '../i18n';
import { RootStackParamList } from '../navigation/AppNavigator';
import { supabase } from '../services/supabase';
import { showError } from '../utils';

type MatchHistoryNavigationProp = StackNavigationProp<RootStackParamList, 'MatchHistory'>;

interface MatchHistoryEntry {
  match_id: string;
  room_code: string;
  match_type: 'casual' | 'ranked';
  final_position: number;
  elo_change: number | null;
  created_at: string;
  player_count: number;
}

/**
 * Match History Screen
 * 
 * Displays user's match history with:
 * - Last 50 matches (paginated)
 * - Room code, match type (casual/ranked)
 * - Final position (1st, 2nd, 3rd, 4th)
 * - ELO change (for ranked matches only)
 * - Match date/time
 */
export default function MatchHistoryScreen() {
  const navigation = useNavigation<MatchHistoryNavigationProp>();
  const { user } = useAuth();
  
  const [matches, setMatches] = useState<MatchHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  
  const PAGE_SIZE = 20;

  interface MatchParticipantRow {
    match_id: string;
    final_position: number;
    elo_change: number | null;
    match_history: {
      room_code: string;
      match_type: 'casual' | 'ranked';
      created_at: string;
      player_count: number;
    }[];
  }

  useEffect(() => {
    loadMatches();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadMatches intentionally excluded; it is defined in the component body without useCallback; user is the correct trigger (load history when the authenticated user changes)
  }, [user]);

  const loadMatches = async (pageNum: number = 0) => {
    if (!user) return;
    
    try {
      setLoading(true);
      
      // Query match_participants table joined with match_history
      const { data, error } = await supabase
        .from('match_participants')
        .select(`
          match_id,
          final_position,
          elo_change,
          match_history!inner(
            room_code,
            match_type,
            created_at,
            player_count
          )
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false, foreignTable: 'match_history' })
        .range(pageNum * PAGE_SIZE, (pageNum + 1) * PAGE_SIZE - 1);

      if (error) throw error;

      const formattedMatches: MatchHistoryEntry[] = (data || []).map((item: MatchParticipantRow) => ({
        match_id: item.match_id,
        room_code: item.match_history[0].room_code,
        match_type: item.match_history[0].match_type,
        final_position: item.final_position,
        elo_change: item.elo_change,
        created_at: item.match_history[0].created_at,
        player_count: item.match_history[0].player_count,
      }));

      if (pageNum === 0) {
        setMatches(formattedMatches);
      } else {
        setMatches(prev => [...prev, ...formattedMatches]);
      }
      
      setHasMore(formattedMatches.length === PAGE_SIZE);
      setPage(pageNum);
    } catch (error: unknown) {
      console.error('Error loading match history:', error);
      showError(error instanceof Error ? error.message : 'Failed to load match history');
    } finally {
      setLoading(false);
    }
  };

  const loadMore = () => {
    if (!loading && hasMore) {
      loadMatches(page + 1);
    }
  };

  const getPositionEmoji = (position: number) => {
    switch (position) {
      case 1: return '🥇';
      case 2: return '🥈';
      case 3: return '🥉';
      case 4: return '4️⃣';
      default: return '';
    }
  };

  const getPositionColor = (position: number) => {
    switch (position) {
      case 1: return '#FFD700'; // Gold
      case 2: return '#C0C0C0'; // Silver
      case 3: return '#CD7F32'; // Bronze
      case 4: return '#8B8B8B'; // Gray
      default: return COLORS.white;
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return i18n.t('matchHistory.justNow');
    if (diffMins < 60) return i18n.t('matchHistory.minutesAgo', { count: diffMins });
    if (diffHours < 24) return i18n.t('matchHistory.hoursAgo', { count: diffHours });
    if (diffDays < 7) return i18n.t('matchHistory.daysAgo', { count: diffDays });
    
    return date.toLocaleDateString(i18n.getLanguage(), { 
      month: 'short', 
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined 
    });
  };

  const renderMatchCard = ({ item }: { item: MatchHistoryEntry }) => {
    const isRanked = item.match_type === 'ranked';
    const eloChange = item.elo_change || 0;
    const eloPositive = eloChange > 0;

    return (
      <View style={styles.matchCard}>
        <View style={styles.matchHeader}>
          <View style={styles.matchHeaderLeft}>
            <Text style={styles.roomCode}>#{item.room_code}</Text>
            <View style={[
              styles.matchTypeBadge,
              isRanked && styles.matchTypeBadgeRanked
            ]}>
              <Text style={styles.matchTypeBadgeText}>
                {isRanked ? '🏆' : '😊'} {i18n.t(`matchmaking.${item.match_type}`)}
              </Text>
            </View>
          </View>
          <Text style={styles.matchDate}>{formatDate(item.created_at)}</Text>
        </View>

        <View style={styles.matchBody}>
          <View style={styles.positionContainer}>
            <Text style={styles.positionEmoji}>{getPositionEmoji(item.final_position)}</Text>
            <Text style={[
              styles.positionText,
              { color: getPositionColor(item.final_position) }
            ]}>
              {i18n.t('matchHistory.position', { position: item.final_position })}
            </Text>
          </View>

          {isRanked && (
            <View style={[
              styles.eloChangeContainer,
              eloPositive ? styles.eloPositive : styles.eloNegative
            ]}>
              <Text style={styles.eloChangeText}>
                {eloPositive ? '+' : ''}{eloChange} {i18n.t('matchHistory.elo')}
              </Text>
            </View>
          )}
        </View>
      </View>
    );
  };

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyIcon}>🎮</Text>
      <Text style={styles.emptyTitle}>{i18n.t('matchHistory.noMatches')}</Text>
      <Text style={styles.emptySubtitle}>{i18n.t('matchHistory.playFirstMatch')}</Text>
    </View>
  );

  const renderFooter = () => {
    if (!loading || page === 0) return null;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="small" color={COLORS.secondary} />
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{i18n.t('matchHistory.title')}</Text>
        <View style={styles.placeholder} />
      </View>

      {loading && page === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.secondary} />
          <Text style={styles.loadingText}>{i18n.t('common.loading')}</Text>
        </View>
      ) : (
        <FlatList
          data={matches}
          renderItem={renderMatchCard}
          keyExtractor={(item) => item.match_id}
          ListEmptyComponent={renderEmpty}
          ListFooterComponent={renderFooter}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          contentContainerStyle={[
            styles.listContent,
            matches.length === 0 && styles.listContentEmpty
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
  listContent: {
    padding: SPACING.md,
  },
  listContentEmpty: {
    flex: 1,
    justifyContent: 'center',
  },
  matchCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  matchHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  matchHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  roomCode: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    color: COLORS.white,
  },
  matchTypeBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    borderWidth: 1,
    borderColor: COLORS.success,
    borderRadius: 12,
    paddingHorizontal: SPACING.xs,
    paddingVertical: 2,
  },
  matchTypeBadgeRanked: {
    backgroundColor: 'rgba(250, 204, 21, 0.2)',
    borderColor: '#FCD34D',
  },
  matchTypeBadgeText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.xs,
    fontWeight: '600',
  },
  matchDate: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.gray.medium,
  },
  matchBody: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  positionContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  positionEmoji: {
    fontSize: 28,
  },
  positionText: {
    fontSize: FONT_SIZES.lg,
    fontWeight: 'bold',
  },
  eloChangeContainer: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: 8,
  },
  eloPositive: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
  },
  eloNegative: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
  },
  eloChangeText: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    color: COLORS.white,
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
  footerLoader: {
    paddingVertical: SPACING.lg,
    alignItems: 'center',
  },
});
