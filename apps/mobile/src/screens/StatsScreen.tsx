import React, { useEffect, useState, useCallback, useRef } from 'react';
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
  Modal,
} from 'react-native';
import { useRoute, RouteProp, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { formatDistanceToNow, format } from 'date-fns';
import { SafeAreaView } from 'react-native-safe-area-context';
import EmptyState from '../components/EmptyState';
import StreakGraph from '../components/stats/StreakGraph';
import { AddFriendButton } from '../components/friends';
import { COLORS, SPACING, FONT_SIZES, MODAL_SUPPORTED_ORIENTATIONS } from '../constants';
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
  rank_points_history:
    | { timestamp: string; points: number; is_win: boolean; game_type: string }[]
    | null;
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
  // Global game completion
  games_completed: number;
  games_abandoned: number;
  games_voided: number;
  completion_rate: number;
  current_completion_streak: number;
  longest_completion_streak: number;
  // Per-mode completion (from migration 20260309000004)
  casual_games_completed: number;
  casual_games_abandoned: number;
  casual_games_voided: number;
  ranked_games_completed: number;
  ranked_games_abandoned: number;
  ranked_games_voided: number;
  private_games_completed: number;
  private_games_abandoned: number;
  private_games_voided: number;
  // Per-mode performance stats
  casual_total_points: number;
  casual_highest_score: number;
  casual_lowest_score: number | null;
  casual_avg_score_per_game: number;
  casual_avg_finish_position: number;
  casual_avg_cards_left: number;
  ranked_total_points: number;
  ranked_highest_score: number;
  ranked_lowest_score: number | null;
  ranked_avg_score_per_game: number;
  ranked_avg_finish_position: number;
  ranked_avg_cards_left: number;
  private_total_points: number;
  private_highest_score: number;
  private_lowest_score: number | null;
  private_avg_score_per_game: number;
  private_avg_finish_position: number;
  private_avg_cards_left: number;
  // Global combo stats (overall)
  singles_played: number;
  pairs_played: number;
  triples_played: number;
  straights_played: number;
  flushes_played: number;
  full_houses_played: number;
  four_of_a_kinds_played: number;
  straight_flushes_played: number;
  royal_flushes_played: number;
  // Per-mode combo stats
  casual_singles_played: number;
  casual_pairs_played: number;
  casual_triples_played: number;
  casual_straights_played: number;
  casual_flushes_played: number;
  casual_full_houses_played: number;
  casual_four_of_a_kinds_played: number;
  casual_straight_flushes_played: number;
  casual_royal_flushes_played: number;
  ranked_singles_played: number;
  ranked_pairs_played: number;
  ranked_triples_played: number;
  ranked_straights_played: number;
  ranked_flushes_played: number;
  ranked_full_houses_played: number;
  ranked_four_of_a_kinds_played: number;
  ranked_straight_flushes_played: number;
  ranked_royal_flushes_played: number;
  private_singles_played: number;
  private_pairs_played: number;
  private_triples_played: number;
  private_straights_played: number;
  private_flushes_played: number;
  private_full_houses_played: number;
  private_four_of_a_kinds_played: number;
  private_straight_flushes_played: number;
  private_royal_flushes_played: number;
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
  winner_id: string | null;
  game_completed: boolean | null;
  player_1_username: string | null;
  player_2_username: string | null;
  player_3_username: string | null;
  player_4_username: string | null;
  player_1_score: number | null;
  player_2_score: number | null;
  player_3_score: number | null;
  player_4_score: number | null;
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
  // Bot difficulty (same for all bots in a game)
  bot_difficulty: string | null;
  game_duration_seconds: number | null;
  finished_at: string;
  // Voided game: set when this player was the last human to leave an unfinished game
  voided_user_id: string | null;
}

type StatsTab = 'overview' | 'casual' | 'private' | 'ranked';
type HistoryTab = 'recent' | 'won' | 'lost' | 'incomplete';

/**
 * Maps a player_stats DB row (all numeric fields nullable) to the local
 * PlayerStats interface (numeric fields non-null, defaulting to 0).
 * rank_points_history is validated via a type guard rather than an assertion.
 */
function toPlayerStats(
  row: Partial<Record<keyof PlayerStats, unknown>>,
  globalRank?: number | null
): PlayerStats {
  const num = (key: keyof PlayerStats): number => {
    const v = row[key];
    return typeof v === 'number' ? v : 0;
  };
  const numOrNull = (key: keyof PlayerStats): number | null => {
    const v = row[key];
    return typeof v === 'number' ? v : null;
  };
  const strOrNull = (key: keyof PlayerStats): string | null => {
    const v = row[key];
    return typeof v === 'string' ? v : null;
  };
  const isHistEntry = (
    e: unknown
  ): e is { timestamp: string; points: number; is_win: boolean; game_type: string } =>
    typeof e === 'object' &&
    e !== null &&
    !Array.isArray(e) &&
    'timestamp' in e &&
    typeof (e as Record<string, unknown>).timestamp === 'string' &&
    'points' in e &&
    typeof (e as Record<string, unknown>).points === 'number' &&
    'is_win' in e &&
    typeof (e as Record<string, unknown>).is_win === 'boolean' &&
    'game_type' in e &&
    typeof (e as Record<string, unknown>).game_type === 'string';
  const histRaw = row.rank_points_history;
  return {
    user_id: typeof row.user_id === 'string' ? row.user_id : '',
    games_played: num('games_played'),
    games_won: num('games_won'),
    games_lost: num('games_lost'),
    win_rate: num('win_rate'),
    avg_finish_position: num('avg_finish_position'),
    total_points: num('total_points'),
    highest_score: num('highest_score'),
    lowest_score: numOrNull('lowest_score'),
    avg_score_per_game: num('avg_score_per_game'),
    avg_cards_left_in_hand: num('avg_cards_left_in_hand'),
    current_win_streak: num('current_win_streak'),
    longest_win_streak: num('longest_win_streak'),
    current_loss_streak: num('current_loss_streak'),
    global_rank: globalRank !== undefined ? globalRank : numOrNull('global_rank'),
    rank_points: num('rank_points'),
    rank_points_history: Array.isArray(histRaw) ? histRaw.filter(isHistEntry) : null,
    casual_games_played: num('casual_games_played'),
    casual_games_won: num('casual_games_won'),
    casual_games_lost: num('casual_games_lost'),
    casual_win_rate: num('casual_win_rate'),
    casual_rank_points: num('casual_rank_points'),
    ranked_games_played: num('ranked_games_played'),
    ranked_games_won: num('ranked_games_won'),
    ranked_games_lost: num('ranked_games_lost'),
    ranked_win_rate: num('ranked_win_rate'),
    ranked_rank_points: num('ranked_rank_points'),
    private_games_played: num('private_games_played'),
    private_games_won: num('private_games_won'),
    private_games_lost: num('private_games_lost'),
    private_win_rate: num('private_win_rate'),
    games_completed: num('games_completed'),
    games_abandoned: num('games_abandoned'),
    games_voided: num('games_voided'),
    completion_rate: num('completion_rate'),
    current_completion_streak: num('current_completion_streak'),
    longest_completion_streak: num('longest_completion_streak'),
    casual_games_completed: num('casual_games_completed'),
    casual_games_abandoned: num('casual_games_abandoned'),
    casual_games_voided: num('casual_games_voided'),
    ranked_games_completed: num('ranked_games_completed'),
    ranked_games_abandoned: num('ranked_games_abandoned'),
    ranked_games_voided: num('ranked_games_voided'),
    private_games_completed: num('private_games_completed'),
    private_games_abandoned: num('private_games_abandoned'),
    private_games_voided: num('private_games_voided'),
    casual_total_points: num('casual_total_points'),
    casual_highest_score: num('casual_highest_score'),
    casual_lowest_score: numOrNull('casual_lowest_score'),
    casual_avg_score_per_game: num('casual_avg_score_per_game'),
    casual_avg_finish_position: num('casual_avg_finish_position'),
    casual_avg_cards_left: num('casual_avg_cards_left'),
    ranked_total_points: num('ranked_total_points'),
    ranked_highest_score: num('ranked_highest_score'),
    ranked_lowest_score: numOrNull('ranked_lowest_score'),
    ranked_avg_score_per_game: num('ranked_avg_score_per_game'),
    ranked_avg_finish_position: num('ranked_avg_finish_position'),
    ranked_avg_cards_left: num('ranked_avg_cards_left'),
    private_total_points: num('private_total_points'),
    private_highest_score: num('private_highest_score'),
    private_lowest_score: numOrNull('private_lowest_score'),
    private_avg_score_per_game: num('private_avg_score_per_game'),
    private_avg_finish_position: num('private_avg_finish_position'),
    private_avg_cards_left: num('private_avg_cards_left'),
    singles_played: num('singles_played'),
    pairs_played: num('pairs_played'),
    triples_played: num('triples_played'),
    straights_played: num('straights_played'),
    flushes_played: num('flushes_played'),
    full_houses_played: num('full_houses_played'),
    four_of_a_kinds_played: num('four_of_a_kinds_played'),
    straight_flushes_played: num('straight_flushes_played'),
    royal_flushes_played: num('royal_flushes_played'),
    casual_singles_played: num('casual_singles_played'),
    casual_pairs_played: num('casual_pairs_played'),
    casual_triples_played: num('casual_triples_played'),
    casual_straights_played: num('casual_straights_played'),
    casual_flushes_played: num('casual_flushes_played'),
    casual_full_houses_played: num('casual_full_houses_played'),
    casual_four_of_a_kinds_played: num('casual_four_of_a_kinds_played'),
    casual_straight_flushes_played: num('casual_straight_flushes_played'),
    casual_royal_flushes_played: num('casual_royal_flushes_played'),
    ranked_singles_played: num('ranked_singles_played'),
    ranked_pairs_played: num('ranked_pairs_played'),
    ranked_triples_played: num('ranked_triples_played'),
    ranked_straights_played: num('ranked_straights_played'),
    ranked_flushes_played: num('ranked_flushes_played'),
    ranked_full_houses_played: num('ranked_full_houses_played'),
    ranked_four_of_a_kinds_played: num('ranked_four_of_a_kinds_played'),
    ranked_straight_flushes_played: num('ranked_straight_flushes_played'),
    ranked_royal_flushes_played: num('ranked_royal_flushes_played'),
    private_singles_played: num('private_singles_played'),
    private_pairs_played: num('private_pairs_played'),
    private_triples_played: num('private_triples_played'),
    private_straights_played: num('private_straights_played'),
    private_flushes_played: num('private_flushes_played'),
    private_full_houses_played: num('private_full_houses_played'),
    private_four_of_a_kinds_played: num('private_four_of_a_kinds_played'),
    private_straight_flushes_played: num('private_straight_flushes_played'),
    private_royal_flushes_played: num('private_royal_flushes_played'),
    first_game_at: strOrNull('first_game_at'),
    last_game_at: strOrNull('last_game_at'),
  };
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
  const [activeTab, setActiveTab] = useState<StatsTab>('overview');
  const [historyTab, setHistoryTab] = useState<HistoryTab>('recent');
  const [mutualFriendsCount, setMutualFriendsCount] = useState<number>(0);
  const [mutualFriendsList, setMutualFriendsList] = useState<
    { friend_id: string; username: string }[]
  >([]);
  const [mutualFriendsModalVisible, setMutualFriendsModalVisible] = useState(false);
  const [mutualFriendsLoading, setMutualFriendsLoading] = useState(false);
  const mutualFriendsLoadingRef = useRef(false);
  const isMountedRef = useRef(true);
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Close the mutual friends modal automatically when the user navigates away
  // from this screen (e.g., after accepting a room invite). Without this the
  // modal stays open and reappears during every subsequent screen transition.
  useEffect(() => {
    const unsubscribe = navigation.addListener('blur', () => {
      setMutualFriendsModalVisible(false);
    });
    return unsubscribe;
  }, [navigation]);

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

      if (statsError) {
        if (statsError.code === 'PGRST116') {
          // No rows found - user has no stats yet
          setStats(null);
        } else {
          // Other error - log and throw
          statsLogger.error(
            '[Stats] Stats query error:',
            statsError?.message || statsError?.code || 'Unknown error'
          );
          throw statsError;
        }
      } else if (statsData) {
        // Fetch global_rank at read-time from leaderboard_ranked so it stays
        // accurate without relying on the stored (potentially stale) column.
        // Uses the SECURITY DEFINER RPC wrapper (direct view access revoked).
        const { data: rankRow, error: rankError } = await supabase
          .rpc('get_leaderboard_rank_ranked_by_user_id', { p_user_id: userId })
          .maybeSingle();
        if (rankError) {
          // Log the failure and fall back to the stored global_rank from statsData.
          statsLogger.error(
            '[Stats] Rank query error:',
            rankError?.message || rankError?.code || 'Unknown error'
          );
          setStats(toPlayerStats(statsData, statsData.global_rank ?? null));
        } else {
          // rankRow being null means the user has no entry in leaderboard_ranked
          // (ranked_games_played = 0 — the view filters out zero-game players).
          // Do NOT fall back to the stored global_rank in that case — it would
          // display a non-null rank for casual-only players, contradicting #N/A intent.
          // Only fall back when the user has played ranked games but the materialized
          // view is temporarily stale (rankRow null despite ranked_games_played > 0).
          const rankedGamesPlayed = statsData.ranked_games_played ?? 0;
          setStats(
            toPlayerStats(
              statsData,
              rankRow?.rank ?? (rankedGamesPlayed > 0 ? statsData.global_rank : null)
            )
          );
        }
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
      // Also match by voided_user_id as a safety net for Phase-C-closed rooms
      // where player_X_id may still be null (e.g., all humans hard-deleted).
      const { data: historyData, error: historyError } = await supabase
        .from('game_history')
        .select('*')
        .or(
          `player_1_id.eq.${userId},player_2_id.eq.${userId},player_3_id.eq.${userId},player_4_id.eq.${userId},voided_user_id.eq.${userId}`
        )
        .order('finished_at', { ascending: false })
        .limit(100);

      if (historyError) {
        statsLogger.error('[Stats] History query error:', historyError);
      } else {
        setGameHistory(historyData || []);
      }
    } catch (error: unknown) {
      // Only log error message/code to avoid exposing DB internals
      statsLogger.error(
        '[Stats] Error fetching data:',
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Compute mutual friends count for other players' profiles
  useEffect(() => {
    if (isOwnProfile || !userId) {
      setMutualFriendsCount(0);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.rpc('get_mutual_friends_count', {
          p_other_user_id: userId,
        });
        if (cancelled) return;
        if (error) {
          setMutualFriendsCount(0);
          return;
        }
        setMutualFriendsCount(data ?? 0);
      } catch {
        if (!cancelled) setMutualFriendsCount(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, isOwnProfile]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData();
  }, [fetchData]);

  const openMutualFriendsList = useCallback(async () => {
    if (!userId || mutualFriendsLoadingRef.current) return;
    mutualFriendsLoadingRef.current = true;
    setMutualFriendsModalVisible(true);
    setMutualFriendsLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_mutual_friends_list', {
        p_other_user_id: userId,
      });
      if (!isMountedRef.current) return;
      if (error) {
        statsLogger.error('[Stats] Mutual friends list error:', error.message);
        setMutualFriendsList([]);
      } else {
        setMutualFriendsList(data ?? []);
      }
    } catch {
      if (isMountedRef.current) setMutualFriendsList([]);
    } finally {
      if (isMountedRef.current) setMutualFriendsLoading(false);
      mutualFriendsLoadingRef.current = false;
    }
  }, [userId]);

  // ─── Per-mode derived data ─────────────────────────────────────────────────
  // Filter game history by game_type for per-mode tabs
  // Deduplicate game history by room_code before filtering.
  // The game_history table may store one row per participating client
  // (e.g. 2 humans → 2 rows for the same room), so we keep only the
  // first occurrence of each room_code (ordered by finished_at DESC from
  // the query, so the first is the most recent/canonical row).
  const deduplicatedGameHistory = React.useMemo(() => {
    const seen = new Set<string>();
    return gameHistory.filter(g => {
      if (seen.has(g.room_code)) return false;
      seen.add(g.room_code);
      return true;
    });
  }, [gameHistory]);

  const filteredGameHistory = React.useMemo(() => {
    if (activeTab === 'overview') return deduplicatedGameHistory;
    return deduplicatedGameHistory.filter(g => g.game_type === activeTab);
  }, [deduplicatedGameHistory, activeTab]);

  // History tab filter: within filteredGameHistory, further filter by outcome
  const historyTabFiltered = React.useMemo(() => {
    if (historyTab === 'recent') return filteredGameHistory;
    if (historyTab === 'won')
      return filteredGameHistory.filter(g => g.game_completed === true && g.winner_id === userId);
    if (historyTab === 'lost')
      return filteredGameHistory.filter(g => g.game_completed === true && g.winner_id !== userId);
    if (historyTab === 'incomplete')
      return filteredGameHistory.filter(g => g.game_completed === false);
    return filteredGameHistory;
  }, [filteredGameHistory, historyTab, userId]);

  // Per-mode completed / abandoned / voided for completion section
  // Use DB-stored per-mode columns (from migration 20260309000004) for accuracy —
  // they are not capped at 100 like the local game_history fetch.
  const modeGamesCompleted = React.useMemo(() => {
    if (!stats) return 0;
    if (activeTab === 'overview') return stats.games_completed || 0;
    if (activeTab === 'casual') return stats.casual_games_completed || 0;
    if (activeTab === 'ranked') return stats.ranked_games_completed || 0;
    return stats.private_games_completed || 0;
  }, [stats, activeTab]);

  const modeGamesAbandoned = React.useMemo(() => {
    if (!stats) return 0;
    if (activeTab === 'overview') return stats.games_abandoned || 0;
    if (activeTab === 'casual') return stats.casual_games_abandoned || 0;
    if (activeTab === 'ranked') return stats.ranked_games_abandoned || 0;
    return stats.private_games_abandoned || 0;
  }, [stats, activeTab]);

  const modeGamesVoided = React.useMemo(() => {
    if (!stats) return 0;
    if (activeTab === 'overview') return stats.games_voided || 0;
    if (activeTab === 'casual') return stats.casual_games_voided || 0;
    if (activeTab === 'ranked') return stats.ranked_games_voided || 0;
    return stats.private_games_voided || 0;
  }, [stats, activeTab]);

  // Per-tab completion % clamped to 0-100
  // Voided games are excluded from both numerator and denominator:
  //   % = games_completed / (games_completed + games_abandoned)
  const modeCompletionRate = React.useMemo(() => {
    if (!stats) return 0;
    // Use the same client-side formula for all tabs (overview + per-mode) so
    // voided games never inflate the denominator regardless of DB completion_rate.
    const completed = activeTab === 'overview' ? stats.games_completed || 0 : modeGamesCompleted;
    const abandoned = activeTab === 'overview' ? stats.games_abandoned || 0 : modeGamesAbandoned;
    const attempted = completed + abandoned;
    if (attempted === 0) return 0;
    return Math.min(100, Math.max(0, Math.round((completed / attempted) * 100)));
  }, [activeTab, stats, modeGamesCompleted, modeGamesAbandoned]);

  // ─── Per-tab performance stats (use mode-specific DB columns) ─────────────
  const perfStats = React.useMemo(() => {
    if (!stats) return null;
    if (activeTab === 'overview') {
      return {
        avgPosition: stats.avg_finish_position,
        totalPoints:
          (stats.casual_total_points || 0) +
          (stats.ranked_total_points || 0) +
          (stats.private_total_points || 0),
        highestScore: stats.highest_score,
        lowestScore: stats.lowest_score,
        avgScore: stats.avg_score_per_game,
        avgCardsLeft: stats.avg_cards_left_in_hand,
      };
    }
    if (activeTab === 'casual') {
      return {
        avgPosition: stats.casual_avg_finish_position || 0,
        totalPoints: stats.casual_total_points || 0,
        highestScore: stats.casual_highest_score || 0,
        lowestScore: stats.casual_lowest_score ?? null,
        avgScore: stats.casual_avg_score_per_game || 0,
        avgCardsLeft: stats.casual_avg_cards_left || 0,
      };
    }
    if (activeTab === 'ranked') {
      return {
        avgPosition: stats.ranked_avg_finish_position || 0,
        totalPoints: stats.ranked_total_points || 0,
        highestScore: stats.ranked_highest_score || 0,
        lowestScore: stats.ranked_lowest_score ?? null,
        avgScore: stats.ranked_avg_score_per_game || 0,
        avgCardsLeft: stats.ranked_avg_cards_left || 0,
      };
    }
    // private
    return {
      avgPosition: stats.private_avg_finish_position || 0,
      totalPoints: stats.private_total_points || 0,
      highestScore: stats.private_highest_score || 0,
      lowestScore: stats.private_lowest_score ?? null,
      avgScore: stats.private_avg_score_per_game || 0,
      avgCardsLeft: stats.private_avg_cards_left || 0,
    };
  }, [stats, activeTab]);

  // ─── Per-tab combo stats (use mode-specific DB columns) ───────────────────
  const comboStats = React.useMemo(() => {
    if (!stats) return null;
    if (activeTab === 'overview') {
      return {
        singles: stats.singles_played,
        pairs: stats.pairs_played,
        triples: stats.triples_played,
        straights: stats.straights_played,
        flushes: stats.flushes_played,
        full_houses: stats.full_houses_played,
        four_of_a_kinds: stats.four_of_a_kinds_played,
        straight_flushes: stats.straight_flushes_played,
        royal_flushes: stats.royal_flushes_played,
      };
    }
    if (activeTab === 'casual') {
      return {
        singles: stats.casual_singles_played || 0,
        pairs: stats.casual_pairs_played || 0,
        triples: stats.casual_triples_played || 0,
        straights: stats.casual_straights_played || 0,
        flushes: stats.casual_flushes_played || 0,
        full_houses: stats.casual_full_houses_played || 0,
        four_of_a_kinds: stats.casual_four_of_a_kinds_played || 0,
        straight_flushes: stats.casual_straight_flushes_played || 0,
        royal_flushes: stats.casual_royal_flushes_played || 0,
      };
    }
    if (activeTab === 'ranked') {
      return {
        singles: stats.ranked_singles_played || 0,
        pairs: stats.ranked_pairs_played || 0,
        triples: stats.ranked_triples_played || 0,
        straights: stats.ranked_straights_played || 0,
        flushes: stats.ranked_flushes_played || 0,
        full_houses: stats.ranked_full_houses_played || 0,
        four_of_a_kinds: stats.ranked_four_of_a_kinds_played || 0,
        straight_flushes: stats.ranked_straight_flushes_played || 0,
        royal_flushes: stats.ranked_royal_flushes_played || 0,
      };
    }
    // private
    return {
      singles: stats.private_singles_played || 0,
      pairs: stats.private_pairs_played || 0,
      triples: stats.private_triples_played || 0,
      straights: stats.private_straights_played || 0,
      flushes: stats.private_flushes_played || 0,
      full_houses: stats.private_full_houses_played || 0,
      four_of_a_kinds: stats.private_four_of_a_kinds_played || 0,
      straight_flushes: stats.private_straight_flushes_played || 0,
      royal_flushes: stats.private_royal_flushes_played || 0,
    };
  }, [stats, activeTab]);
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
    // Voided: THIS player was the last human to leave — neutral grey badge,
    // no penalty applied.
    const isVoided = isIncomplete && item.voided_user_id === userId;
    // Abandoned: incomplete AND voided_user_id is known (non-null) AND this
    // player is not the voided player — they left early and earn a red badge.
    // When voided_user_id is null (all humans left simultaneously with no
    // determinable ordering) we treat everyone as neutral INCOMPLETE rather
    // than incorrectly labelling them as ABANDONED.
    const isAbandoned = isIncomplete && item.voided_user_id != null && !isVoided;

    // Neutral: incomplete game where this player is neither voided nor abandoned
    // (voided_user_id is null — simultaneous disconnect; no blame can be assigned).
    // These render a neutral ⚪ INCOMPLETE badge with historyItemIncomplete styling.
    const isNeutralIncomplete = isIncomplete && !isVoided && !isAbandoned;

    return (
      <View
        style={[
          styles.historyItem,
          !isIncomplete && isWinner && styles.historyItemWin,
          isVoided
            ? styles.historyItemVoided
            : isAbandoned
              ? styles.historyItemAbandoned
              : isNeutralIncomplete
                ? styles.historyItemIncomplete
                : undefined,
        ]}
      >
        <View style={styles.historyHeader}>
          <View style={styles.historyResult}>
            {isVoided ? (
              <Text style={[styles.resultBadge, styles.voidBadge]}>⚫ VOIDED</Text>
            ) : isAbandoned ? (
              <Text style={[styles.resultBadge, styles.abandonedBadge]}>❌ ABANDONED</Text>
            ) : isNeutralIncomplete ? (
              <Text style={[styles.resultBadge, styles.incompleteBadge]}>⚪ INCOMPLETE</Text>
            ) : (
              <Text style={[styles.resultBadge, isWinner ? styles.winBadge : styles.lossBadge]}>
                {isWinner ? '🏆 WIN' : '❌ LOSS'}
              </Text>
            )}
            <Text style={styles.historyCode}>Room: {item.room_code}</Text>
            {item.game_type && (
              <Text style={styles.gameTypeBadge}>
                {item.game_type === 'ranked' ? '🏆' : item.game_type === 'private' ? '🔒' : '🎮'}
              </Text>
            )}
          </View>
          <Text style={styles.historyTime}>{timeAgo}</Text>
        </View>

        <View style={styles.historyPlayers}>
          {[1, 2, 3, 4].map(num => {
            const username = item[`player_${num}_username` as keyof GameHistoryEntry] as string;
            const score = item[`player_${num}_score` as keyof GameHistoryEntry] as number;
            const wasBot = item[`player_${num}_was_bot` as keyof GameHistoryEntry] as
              | boolean
              | null;
            const originalUsername = item[
              `player_${num}_original_username` as keyof GameHistoryEntry
            ] as string | null;
            const disconnected = item[`player_${num}_disconnected` as keyof GameHistoryEntry] as
              | boolean
              | null;
            if (!username) return null;

            // A player is a bot if was_bot is explicitly true, OR if they have an
            // originalUsername (meaning a bot replaced a disconnected human). The
            // second case covers games where player_X_was_bot wasn't persisted.
            const isBot = wasBot === true || !!originalUsername;

            // Build difficulty tag: (E) easy, (M) medium (default), (H) hard.
            // Always emit a tag whenever we know the player is a bot, even when
            // bot_difficulty is null (NULL → treat as medium).
            const difficultyTag = isBot
              ? item.bot_difficulty === 'easy'
                ? ' (E)'
                : item.bot_difficulty === 'hard'
                  ? ' (H)'
                  : ' (M)'
              : '';

            return (
              <View key={num} style={styles.historyPlayer}>
                <View style={styles.historyPlayerNameRow}>
                  <Text style={styles.historyPlayerName} numberOfLines={1}>
                    {isBot && originalUsername
                      ? `🤖 Bot (replaced ${originalUsername})${difficultyTag}`
                      : isBot
                        ? `🤖 ${username}${difficultyTag}`
                        : username}
                  </Text>
                  {disconnected && <Text style={styles.disconnectedBadge}>📡 DC</Text>}
                </View>
                <View style={styles.historyPlayerScoreRow}>
                  <Text style={styles.historyPlayerScore}>{score} pts</Text>
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
          subtitle={
            isOwnProfile
              ? 'Play some games to see your stats!'
              : "This user hasn't played any games yet."
          }
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
                <Text style={styles.avatarText}>{profile.username.charAt(0).toUpperCase()}</Text>
              </View>
            )}
          </View>
          <Text style={styles.username}>{profile.username}</Text>
          {/* Add friend button — shown only when viewing another player's profile */}
          {!isOwnProfile && userId && <AddFriendButton targetUserId={userId} compact={false} />}
          {!isOwnProfile && mutualFriendsCount > 0 && (
            <TouchableOpacity onPress={openMutualFriendsList}>
              <Text style={styles.mutualFriends}>
                {i18n.t(
                  mutualFriendsCount === 1
                    ? 'profile.mutualFriendsLabelOne'
                    : 'profile.mutualFriendsLabelMany',
                  { count: mutualFriendsCount }
                )}
              </Text>
            </TouchableOpacity>
          )}
          {/* Header: show ranked ELO on ranked tab, casual ELO otherwise */}
          <Text style={styles.rankPoints}>
            {activeTab === 'ranked'
              ? (stats.ranked_rank_points ?? stats.casual_rank_points ?? stats.rank_points)
              : (stats.casual_rank_points ?? stats.rank_points)}{' '}
            Rank Points
          </Text>
          {stats.global_rank && <Text style={styles.globalRank}>#{stats.global_rank} Global</Text>}
        </View>

        {/* Tab Bar: Overview / Casual / Private / Ranked */}
        <View style={styles.tabBar}>
          {(['overview', 'casual', 'private', 'ranked'] as StatsTab[]).map(tab => (
            <TouchableOpacity
              key={tab}
              style={[styles.tabButton, activeTab === tab && styles.tabButtonActive]}
              onPress={() => setActiveTab(tab)}
            >
              <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
                {(
                  {
                    overview: `📊 ${i18n.t('profile.overview')}`,
                    casual: `🎮 ${i18n.t('matchmaking.casual')}`,
                    private: `🔒 ${i18n.t('profile.private')}`,
                    ranked: `🏆 ${i18n.t('matchmaking.ranked')}`,
                  } as Record<string, string>
                )[tab] ?? tab}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Mode-Aware Key Stats */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {(
              {
                overview: i18n.t('profile.overview'),
                casual: i18n.t('profile.casualStats'),
                private: i18n.t('profile.privateStats'),
                ranked: i18n.t('profile.rankedStats'),
              } as Record<string, string>
            )[activeTab] ?? activeTab}
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
                {renderStatCard(
                  i18n.t('profile.gamesPlayed'),
                  stats.casual_games_played || 0,
                  '🎮'
                )}
                {renderStatCard(
                  i18n.t('profile.winRate'),
                  `${(stats.casual_win_rate || 0).toFixed(1)}%`,
                  '🏆'
                )}
                {renderStatCard(i18n.t('profile.gamesWon'), stats.casual_games_won || 0, '✅')}
                {renderStatCard(i18n.t('profile.gamesLost'), stats.casual_games_lost || 0, '❌')}
              </>
            )}
            {activeTab === 'private' && (
              <>
                {renderStatCard(
                  i18n.t('profile.gamesPlayed'),
                  stats.private_games_played || 0,
                  '🎮'
                )}
                {renderStatCard(
                  i18n.t('profile.winRate'),
                  `${(stats.private_win_rate || 0).toFixed(1)}%`,
                  '🏆'
                )}
                {renderStatCard(i18n.t('profile.gamesWon'), stats.private_games_won || 0, '✅')}
                {renderStatCard(i18n.t('profile.gamesLost'), stats.private_games_lost || 0, '❌')}
              </>
            )}
            {activeTab === 'ranked' && (
              <>
                {renderStatCard(
                  i18n.t('profile.gamesPlayed'),
                  stats.ranked_games_played || 0,
                  '🎮'
                )}
                {renderStatCard(
                  i18n.t('profile.winRate'),
                  `${(stats.ranked_win_rate || 0).toFixed(1)}%`,
                  '🏆'
                )}
                {renderStatCard(i18n.t('profile.gamesWon'), stats.ranked_games_won || 0, '✅')}
                {renderStatCard(i18n.t('profile.gamesLost'), stats.ranked_games_lost || 0, '❌')}
              </>
            )}
          </View>

          {/* Rank Points + secondary metric — overview, casual, ranked, private */}
          <View style={[styles.statsGrid, { marginTop: SPACING.md }]}>
            {activeTab === 'overview' && (
              <>
                {/* Overview rank = casual ELO (canonical; synced in migration 20260309000004) */}
                {renderStatCard(
                  i18n.t('profile.rankPoints'),
                  stats.casual_rank_points ?? stats.rank_points,
                  '⭐'
                )}
                {renderStatCard(
                  i18n.t('profile.rank'),
                  stats.global_rank ? `#${stats.global_rank}` : '#N/A',
                  '🌐'
                )}
              </>
            )}
            {activeTab === 'casual' && (
              <>
                {renderStatCard(i18n.t('profile.rankPoints'), stats.casual_rank_points || 0, '⭐')}
                {renderStatCard(
                  i18n.t('profile.totalPoints'),
                  (stats.casual_total_points || 0).toLocaleString(),
                  '💎'
                )}
              </>
            )}
            {activeTab === 'ranked' && (
              <>
                {renderStatCard(i18n.t('profile.rankPoints'), stats.ranked_rank_points || 0, '⭐')}
                {renderStatCard(
                  i18n.t('profile.rank'),
                  stats.global_rank ? `#${stats.global_rank}` : '#N/A',
                  '🌐'
                )}
                {renderStatCard(
                  i18n.t('profile.totalPoints'),
                  (stats.ranked_total_points || 0).toLocaleString(),
                  '💎'
                )}
              </>
            )}
            {activeTab === 'private' && (
              <>
                {renderStatCard(
                  i18n.t('profile.totalPoints'),
                  (stats.private_total_points || 0).toLocaleString(),
                  '💎'
                )}
                {renderStatCard(
                  i18n.t('profile.avgScore'),
                  (stats.private_avg_score_per_game || 0).toFixed(0),
                  '📈'
                )}
              </>
            )}
          </View>

          {/* Streaks — all tabs */}
          <Text style={[styles.sectionTitle, { marginTop: SPACING.lg }]}>
            {i18n.t('profile.streaks')}
          </Text>
          <View style={styles.streaksContainer}>
            <View style={styles.streakItem}>
              <Text style={styles.streakLabel}>{i18n.t('profile.currentStreak')}</Text>
              <Text
                style={[
                  styles.streakValue,
                  stats.current_win_streak > 0 && styles.streakValueActive,
                ]}
              >
                {stats.current_win_streak > 0
                  ? `🔥 ${stats.current_win_streak} ${i18n.t('profile.wins')}`
                  : stats.current_loss_streak > 0
                    ? `❄️ ${stats.current_loss_streak} ${i18n.t('profile.losses')}`
                    : 'None'}
              </Text>
            </View>
            <View style={styles.streakItem}>
              <Text style={styles.streakLabel}>{i18n.t('profile.bestStreak')}</Text>
              <Text style={styles.streakValue}>
                🏅 {stats.longest_win_streak} {i18n.t('profile.wins')}
              </Text>
            </View>
          </View>

          {/* Total Points row — private only (ranked has a dedicated stat card above) */}
          {activeTab === 'private' && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>{i18n.t('profile.totalScore')}</Text>
              <Text style={styles.infoValue}>
                {(stats.private_total_points || 0).toLocaleString()}
              </Text>
            </View>
          )}
        </View>

        {/* Game Completion Section — all tabs; uses per-mode DB columns + clamped % */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{i18n.t('profile.gameCompletion')}</Text>
          <View style={styles.completionContainer}>
            <View style={styles.completionMain}>
              <View style={styles.completionCircle}>
                <Text style={styles.completionPercentage}>{modeCompletionRate.toFixed(0)}%</Text>
                <Text style={styles.completionLabel}>{i18n.t('profile.completed')}</Text>
              </View>
              <View style={styles.completionDetails}>
                <View style={styles.completionRow}>
                  <Text style={styles.completionDetailLabel}>✅ {i18n.t('profile.completed')}</Text>
                  <Text style={styles.completionDetailValue}>{modeGamesCompleted}</Text>
                </View>
                <View style={styles.completionRow}>
                  <Text style={styles.completionDetailLabel}>🚪 {i18n.t('profile.abandoned')}</Text>
                  <Text style={styles.completionDetailValue}>{modeGamesAbandoned}</Text>
                </View>
                <View style={styles.completionRow}>
                  <Text style={styles.completionDetailLabel}>🏳️ {i18n.t('profile.voided')}</Text>
                  <Text style={styles.completionDetailValue}>{modeGamesVoided}</Text>
                </View>
                {activeTab === 'overview' && (
                  <>
                    <View style={styles.completionRow}>
                      <Text style={styles.completionDetailLabel}>
                        🔥 {i18n.t('profile.currentStreak')}
                      </Text>
                      <Text
                        style={[
                          styles.completionDetailValue,
                          (stats.current_completion_streak || 0) > 0 && styles.streakValueActive,
                        ]}
                      >
                        {stats.current_completion_streak || 0}
                      </Text>
                    </View>
                    <View style={styles.completionRow}>
                      <Text style={styles.completionDetailLabel}>
                        🏅 {i18n.t('profile.bestStreak')}
                      </Text>
                      <Text style={styles.completionDetailValue}>
                        {stats.longest_completion_streak || 0}
                      </Text>
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
              gameHistory={gameHistory.filter(g => g.game_completed === true)}
              userId={userId}
              rankPointsHistory={
                activeTab === 'ranked'
                  ? Array.isArray(stats.rank_points_history)
                    ? stats.rank_points_history.filter(e => e?.game_type === 'ranked')
                    : undefined
                  : stats.rank_points_history || undefined
              }
              totalGamesPlayed={
                activeTab === 'ranked'
                  ? (stats.ranked_games_played ?? undefined)
                  : (stats.games_played ?? undefined)
              }
            />
          </View>
        )}

        {/* Performance — per-tab using mode-specific DB columns */}
        {perfStats && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{i18n.t('profile.performance')}</Text>
            <View style={styles.statsGrid}>
              {renderStatCard(
                i18n.t('profile.avgPosition'),
                perfStats.avgPosition?.toFixed(2) || 'N/A',
                '📊'
              )}
              {renderStatCard(
                i18n.t('profile.totalPoints'),
                (perfStats.totalPoints || 0).toLocaleString(),
                '💎'
              )}
              {renderStatCard(i18n.t('profile.highestScore'), perfStats.highestScore || 0, '💀')}
              {renderStatCard(i18n.t('profile.lowestScore'), perfStats.lowestScore ?? 0, '⭐')}
              {renderStatCard(
                i18n.t('profile.avgScore'),
                perfStats.avgScore?.toFixed(0) || 'N/A',
                '📈'
              )}
              {renderStatCard(
                i18n.t('profile.avgCardsLeft'),
                (perfStats.avgCardsLeft || 0).toFixed(1),
                '🃏'
              )}
            </View>
          </View>
        )}

        {/* Combo Stats — per-tab using mode-specific DB columns */}
        {comboStats && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{i18n.t('profile.combosPlayed')}</Text>
            <View style={styles.comboGrid}>
              {renderComboCard(i18n.t('profile.singles'), comboStats.singles, '🃏')}
              {renderComboCard(i18n.t('profile.pairs'), comboStats.pairs, '🃏🃏')}
              {renderComboCard(i18n.t('profile.triples'), comboStats.triples, '🃏🃏🃏')}
              {renderComboCard(i18n.t('profile.straights'), comboStats.straights, '➡️')}
              {renderComboCard(i18n.t('profile.flushes'), comboStats.flushes, '🌊')}
              {renderComboCard(i18n.t('profile.fullHouses'), comboStats.full_houses, '🏠')}
              {renderComboCard(i18n.t('profile.fourOfAKind'), comboStats.four_of_a_kinds, '🌟')}
              {renderComboCard(i18n.t('profile.straightFlush'), comboStats.straight_flushes, '💫')}
              {renderComboCard(i18n.t('profile.royalFlush'), comboStats.royal_flushes, '👑')}
            </View>
          </View>
        )}

        {/* Game History — all tabs; filtered by game_type for per-mode tabs */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{i18n.t('profile.recentGames')}</Text>

          {/* History outcome filter tabs: Recent / Won / Lost / Incomplete */}
          <View style={styles.historyTabBar}>
            {[
              {
                key: 'recent' as HistoryTab,
                label: i18n.t('profile.historyTabRecent'),
                count: filteredGameHistory.length,
              },
              {
                key: 'won' as HistoryTab,
                label: i18n.t('profile.historyTabWon'),
                count: filteredGameHistory.filter(
                  g => g.game_completed === true && g.winner_id === userId
                ).length,
              },
              {
                key: 'lost' as HistoryTab,
                label: i18n.t('profile.historyTabLost'),
                count: filteredGameHistory.filter(
                  g => g.game_completed === true && g.winner_id !== userId
                ).length,
              },
              {
                key: 'incomplete' as HistoryTab,
                label: i18n.t('profile.historyTabIncomplete'),
                count: filteredGameHistory.filter(g => g.game_completed === false).length,
              },
            ].map(({ key, label, count }) => (
              <TouchableOpacity
                key={key}
                style={[
                  styles.historyTabButton,
                  historyTab === key && styles.historyTabButtonActive,
                ]}
                onPress={() => setHistoryTab(key)}
              >
                <Text
                  style={[styles.historyTabText, historyTab === key && styles.historyTabTextActive]}
                >
                  {label}
                </Text>
                {count > 0 && (
                  <Text
                    style={[
                      styles.historyTabCount,
                      historyTab === key && styles.historyTabCountActive,
                    ]}
                  >
                    {count}
                  </Text>
                )}
              </TouchableOpacity>
            ))}
          </View>

          {historyTabFiltered.length > 0 ? (
            <FlatList
              data={historyTabFiltered.slice(0, 20)}
              renderItem={renderHistoryItem}
              keyExtractor={item => item.id}
              scrollEnabled={false}
            />
          ) : (
            <Text style={styles.historyEmptyText}>
              {historyTab === 'won'
                ? i18n.t('profile.historyEmptyWon')
                : historyTab === 'lost'
                  ? i18n.t('profile.historyEmptyLost')
                  : historyTab === 'incomplete'
                    ? i18n.t('profile.historyEmptyIncomplete')
                    : i18n.t('profile.historyEmptyRecent')}
            </Text>
          )}
        </View>
      </ScrollView>

      {/* Mutual Friends List Modal */}
      <Modal
        visible={mutualFriendsModalVisible}
        transparent
        animationType="slide"
        supportedOrientations={MODAL_SUPPORTED_ORIENTATIONS}
        onRequestClose={() => setMutualFriendsModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{i18n.t('profile.mutualFriends')}</Text>
              <TouchableOpacity onPress={() => setMutualFriendsModalVisible(false)}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            {mutualFriendsLoading ? (
              <ActivityIndicator color={COLORS.accent} style={{ marginTop: SPACING.xl }} />
            ) : mutualFriendsList.length === 0 ? (
              <Text style={styles.modalEmpty}>{i18n.t('profile.noMutualFriends')}</Text>
            ) : (
              <FlatList
                data={mutualFriendsList}
                keyExtractor={item => item.friend_id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.mutualFriendRow}
                    onPress={() => {
                      setMutualFriendsModalVisible(false);
                      navigation.push('Stats', { userId: item.friend_id });
                    }}
                  >
                    <View style={styles.mutualFriendAvatar}>
                      <Text style={styles.mutualFriendAvatarText}>
                        {(item.username ?? '?').charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <Text style={styles.mutualFriendName}>
                      {item.username ?? i18n.t('profile.unknownPlayer')}
                    </Text>
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        </View>
      </Modal>
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
  mutualFriends: {
    color: COLORS.white + 'AA',
    fontSize: FONT_SIZES.sm,
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
  // History outcome filter tabs (Recent / Won / Lost / Incomplete)
  historyTabBar: {
    flexDirection: 'row',
    marginBottom: SPACING.md,
    gap: SPACING.xs,
  },
  historyTabButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: COLORS.secondary,
    gap: 4,
  },
  historyTabButtonActive: {
    backgroundColor: COLORS.accent + '33',
    borderWidth: 1,
    borderColor: COLORS.accent,
  },
  historyTabText: {
    color: COLORS.white + '88',
    fontSize: 10,
    fontWeight: '600',
  },
  historyTabTextActive: {
    color: COLORS.white,
  },
  historyTabCount: {
    color: COLORS.white + '66',
    fontSize: 9,
    fontWeight: '700',
    backgroundColor: COLORS.white + '11',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 6,
    overflow: 'hidden',
  },
  historyTabCountActive: {
    color: COLORS.accent,
    backgroundColor: COLORS.accent + '22',
  },
  historyEmptyText: {
    color: COLORS.white + '66',
    fontSize: FONT_SIZES.sm,
    textAlign: 'center',
    paddingVertical: SPACING.lg,
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
  historyItemAbandoned: {
    borderLeftWidth: 4,
    borderLeftColor: COLORS.error,
    opacity: 0.85,
  },
  historyItemIncomplete: {
    borderLeftWidth: 4,
    borderLeftColor: '#555555',
    opacity: 0.7,
  },
  historyItemVoided: {
    borderLeftWidth: 4,
    borderLeftColor: '#888888',
    opacity: 0.75,
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
  voidBadge: {
    backgroundColor: '#555555',
    color: COLORS.white,
  },
  incompleteBadge: {
    backgroundColor: '#444444',
    color: COLORS.white + 'CC',
  },
  abandonedBadge: {
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
  cardsLeftBadge: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.white + '66',
  },
  historyDuration: {
    color: COLORS.white + '66',
    fontSize: FONT_SIZES.xs,
    fontStyle: 'italic',
  },
  // Mutual Friends Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '85%',
    maxHeight: '60%',
    backgroundColor: COLORS.secondary,
    borderRadius: 16,
    padding: SPACING.lg,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  modalTitle: {
    color: COLORS.white,
    fontSize: FONT_SIZES.lg,
    fontWeight: 'bold',
  },
  modalClose: {
    color: COLORS.white + '99',
    fontSize: FONT_SIZES.xl,
    padding: SPACING.xs,
  },
  modalEmpty: {
    color: COLORS.white + '99',
    fontSize: FONT_SIZES.md,
    textAlign: 'center',
    marginTop: SPACING.xl,
  },
  mutualFriendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.white + '11',
  },
  mutualFriendAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.accent + '33',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.sm,
  },
  mutualFriendAvatarText: {
    color: COLORS.accent,
    fontSize: FONT_SIZES.md,
    fontWeight: 'bold',
  },
  mutualFriendName: {
    color: COLORS.white,
    fontSize: FONT_SIZES.md,
  },
});
