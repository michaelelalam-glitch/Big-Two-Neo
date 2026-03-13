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
  match_type: 'casual' | 'ranked' | 'private' | 'local';
  final_position: number;
  elo_change: number | null;
  created_at: string;
}

interface GameHistoryRow {
  id: string;
  room_code: string;
  game_type: string | null;
  game_completed: boolean | null;
  player_1_id: string | null;
  player_2_id: string | null;
  player_3_id: string | null;
  player_4_id: string | null;
  player_1_score: number | null;
  player_2_score: number | null;
  player_3_score: number | null;
  player_4_score: number | null;
  winner_id: string | null;
  voided_user_id: string | null;
  finished_at: string | null;
  created_at: string;
}

/**
 * Static lookup — defined once at module level (no i18n calls) so FlatList
 * rows never allocate a new object during renderItem.
 */
const MATCH_TYPE_EMOJI: Record<MatchHistoryEntry['match_type'], string> = {
  casual: '😊',
  ranked: '🏆',
  private: '🔒',
  local: '🎮',
};

/**
 * Match History Screen
 *
 * Reads from game_history (the table actually populated by the complete-game edge
 * function). match_history / match_participants are legacy tables that are never
 * written to and will always be empty.
 *
 * Displays user's match history with:
 * - Last 20 matches per page (paginated)
 * - Room code, game type (casual/ranked/private/local)
 * - Final position based on finish ranking derived from player scores (1–4, or 0 for incomplete/voided games)
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

  useEffect(() => {
    loadMatches();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadMatches intentionally excluded; user is the correct dependency trigger
  }, [user]);

  const loadMatches = async (pageNum: number = 0) => {
    if (!user) return;
    
    try {
      setLoading(true);
      
      // game_history stores player slots (player_1_id … player_4_id).
      // We find all games the current user participated in using an OR filter.
      const { data, error } = await supabase
        .from('game_history')
        .select(`
          id,
          room_code,
          game_type,
          game_completed,
          player_1_id,
          player_2_id,
          player_3_id,
          player_4_id,
          player_1_score,
          player_2_score,
          player_3_score,
          player_4_score,
          winner_id,
          voided_user_id,
          finished_at,
          created_at
        `)
        .or(
          `player_1_id.eq.${user.id},player_2_id.eq.${user.id},player_3_id.eq.${user.id},player_4_id.eq.${user.id},voided_user_id.eq.${user.id}`
        )
        // finished_at is NULL for abandoned/incomplete games; nullsFirst:false keeps
        // completed games at the top and groups abandoned entries at the bottom sorted
        // by their creation time (mirrors the display fallback: finished_at ?? created_at).
        .order('finished_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .range(pageNum * PAGE_SIZE, (pageNum + 1) * PAGE_SIZE - 1);

      if (error) throw error;

      const formattedMatches: MatchHistoryEntry[] = (data || []).map((item: GameHistoryRow) => {
        // For incomplete/abandoned games slot order reflects room seat order,
        // not finish order — render as abandoned (sentinel 0 → 🚪).
        //
        // For completed games: complete-game edge function writes player_*_id
        // slots in seat/payload order (NOT finish order). Derive position by
        // sorting all 4 slots by score ascending (lowest score = 1st place in
        // Big Two). Include bot/null-id seats in the sort so the ranking is
        // not artificially compressed to only human players.
        let finalPosition: number;
        if (item.game_completed !== true) {
          finalPosition = 0; // abandoned/incomplete
        } else {
          const allSlots = [
            { id: item.player_1_id, score: item.player_1_score ?? Number.POSITIVE_INFINITY },
            { id: item.player_2_id, score: item.player_2_score ?? Number.POSITIVE_INFINITY },
            { id: item.player_3_id, score: item.player_3_score ?? Number.POSITIVE_INFINITY },
            { id: item.player_4_id, score: item.player_4_score ?? Number.POSITIVE_INFINITY },
          ];
          allSlots.sort((a, b) => a.score - b.score);
          const rankIndex = allSlots.findIndex(s => s.id === user.id);
          const isVoided = item.voided_user_id === user.id;
          // isVoided is checked first: a voided player's user_id may still appear
          // in a player_X_id slot (race window during bot replacement), so checking
          // rankIndex first could incorrectly show a placement instead of the
          // voided sentinel (0 → 🚪).
          if (isVoided) {
            finalPosition = 0; // sentinel: seat was taken over by a bot
          } else if (rankIndex >= 0) {
            finalPosition = rankIndex + 1;
          } else {
            finalPosition = 4; // fallback: user not found in any slot
          }
        }

        const rawType = item.game_type ?? 'casual';
        const matchType = (['casual', 'ranked', 'private', 'local'] as const).includes(
          rawType as 'casual' | 'ranked' | 'private' | 'local'
        )
          ? (rawType as MatchHistoryEntry['match_type'])
          : 'casual';

        return {
          match_id: item.id,
          room_code: item.room_code ?? '',
          match_type: matchType,
          final_position: finalPosition,
          elo_change: null, // game_history has no per-player ELO delta column
          // Note: `created_at` in MatchHistoryEntry is populated from
          // game_history.finished_at (match completion time), falling back
          // to row creation time when finished_at is null (incomplete games).
          // The field is used only for display formatting.
          created_at: item.finished_at ?? item.created_at ?? '',
        };
      });

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

  const getPositionOrdinal = (position: number): string => {
    if (position === 0) return '—'; // voided/abandoned
    const lang = i18n.getLanguage();
    // Non-English locales: return a plain number so the translation template
    // (e.g. "{{ordinal}}. Platz" / "المركز {{ordinal}}") formats it natively
    // without embedding English suffixes ("1st", "2nd", ...) mid-string.
    // Generalised to any non-en locale: only en* tags use ordinal suffixes;
    // all others (de, ar, or any future locale) receive plain integers.
    // Use startsWith to handle regional tags (e.g. 'en-US', 'de-DE', 'ar-SA').
    if (!lang.startsWith('en')) return `${position}`;
    // English: proper ordinal suffixes with 11/12/13 special-case.
    const rem100 = position % 100;
    if (rem100 >= 11 && rem100 <= 13) return `${position}th`;
    switch (position % 10) {
      case 1: return `${position}st`;
      case 2: return `${position}nd`;
      case 3: return `${position}rd`;
      default: return `${position}th`;
    }
  };

  const getPositionEmoji = (position: number) => {
    switch (position) {
      case 0: return '🚪'; // voided/abandoned
      case 1: return '🥇';
      case 2: return '🥈';
      case 3: return '🥉';
      case 4: return '4️⃣';
      default: return '';
    }
  };

  const getPositionColor = (position: number) => {
    switch (position) {
      case 0: return '#555555'; // voided/abandoned
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

  // Computed once per component mount. i18n locale is stable for the lifetime
  // of the screen so this is safe to define here rather than inside renderMatchCard
  // (avoids allocating two new objects per FlatList row on every re-render).
  const matchTypeLabel: Record<MatchHistoryEntry['match_type'], string> = {
    casual: i18n.t('matchmaking.casual'),
    ranked: i18n.t('matchmaking.ranked'),
    private: i18n.t('profile.private'),
    local: i18n.t('matchHistory.local'),
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
                {MATCH_TYPE_EMOJI[item.match_type]} {matchTypeLabel[item.match_type]}
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
              {item.final_position === 0
                ? i18n.t('matchHistory.abandoned')
                : i18n.t('matchHistory.position', {
                    ordinal: getPositionOrdinal(item.final_position),
                    position: item.final_position,
                  })}
            </Text>
          </View>

          {isRanked && item.elo_change !== null && (
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
