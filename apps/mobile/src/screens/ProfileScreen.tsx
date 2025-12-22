import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { format } from 'date-fns';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../services/supabase';
import { COLORS, SPACING } from '../constants';
import { statsLogger, authLogger } from '../utils/logger';
import { showError, showConfirm } from '../utils';
import EmptyState from '../components/EmptyState';
import { RankBadge, Rank } from '../components/RankBadge';
import { i18n } from '../i18n';

interface PlayerStats {
  games_played: number;
  games_won: number;
  games_lost: number;
  win_rate: number;
  total_points: number;
  current_win_streak: number;
  longest_win_streak: number;
  rank_points: number;
  global_rank: number | null;
}

const ProfileScreen = () => {
  const { user, profile, isLoading, signOut } = useAuth();
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStats = useCallback(async (loadingType: 'initial' | 'refresh' = 'initial') => {
    if (!user?.id) return;

    if (loadingType === 'initial') {
      setStatsLoading(true);
    } else {
      setRefreshing(true);
    }

    try {
      const { data, error } = await supabase
        .from('player_stats')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows
        statsLogger.error('[Profile] Stats fetch error:', error?.message || error?.code || 'Unknown error');
      } else {
        setStats(data);
      }
    } catch (error: any) {
      statsLogger.error('[Profile] Error fetching stats:', error?.message || error?.code || String(error));
    } finally {
      if (loadingType === 'initial') {
        setStatsLoading(false);
      } else {
        setRefreshing(false);
      }
    }
  }, [user?.id]);

  useEffect(() => {
    fetchStats('initial');
  }, [fetchStats]);

  const onRefresh = useCallback(async () => {
    await fetchStats('refresh');
  }, [fetchStats]);

  const handleSignOut = async () => {
    showConfirm({
      title: i18n.t('profile.signOut'),
      message: i18n.t('profile.signOutConfirm'),
      confirmText: i18n.t('profile.signOut'),
      destructive: true,
      onConfirm: async () => {
        try {
          await signOut();
        } catch (error: any) {
          authLogger.error('Error signing out:', error?.message || String(error));
          showError(i18n.t('profile.signOutError'));
        }
      }
    });
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.secondary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView 
        style={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.secondary} />
        }
      >
        <View style={styles.content}>
          <View style={styles.header}>
            <Text style={styles.title}>{i18n.t('profile.title')}</Text>
            {profile?.rank && profile?.elo_rating && (
              <View style={styles.rankBadgeContainer}>
                <RankBadge 
                  rank={profile.rank as Rank} 
                  elo={profile.elo_rating} 
                  size="large" 
                  showElo={true}
                />
              </View>
            )}
          </View>

          {/* Overview Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{i18n.t('profile.overview')}</Text>
            
            {statsLoading ? (
              <ActivityIndicator size="small" color={COLORS.secondary} style={{ paddingVertical: 20 }} />
            ) : stats ? (
              <>
                <View style={styles.statsGrid}>
                  <View style={styles.statBox}>
                    <Text style={styles.statValue}>{stats.games_played}</Text>
                    <Text style={styles.statLabel}>{i18n.t('profile.gamesPlayed')}</Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statValue}>{stats.win_rate.toFixed(1)}%</Text>
                    <Text style={styles.statLabel}>{i18n.t('profile.winRate')}</Text>
                  </View>
                </View>

                <View style={styles.statsGrid}>
                  <View style={styles.statBox}>
                    <Text style={styles.statValue}>{stats.games_won}</Text>
                    <Text style={styles.statLabel}>{i18n.t('profile.gamesWon')}</Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statValue}>{stats.games_played - stats.games_won}</Text>
                    <Text style={styles.statLabel}>{i18n.t('profile.gamesLost')}</Text>
                  </View>
                </View>

                <View style={styles.statsGrid}>
                  <View style={styles.statBox}>
                    <Text style={styles.statValue}>{stats.rank_points}</Text>
                    <Text style={styles.statLabel}>{i18n.t('profile.rankPoints')}</Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statValue}>#{stats.global_rank || 'N/A'}</Text>
                    <Text style={styles.statLabel}>{i18n.t('profile.rank')}</Text>
                  </View>
                </View>

                {/* Streaks Section */}
                <Text style={[styles.sectionTitle, { marginTop: SPACING.md }]}>{i18n.t('profile.streaks')}</Text>
                <View style={styles.statsGrid}>
                  <View style={styles.statBox}>
                    <Text style={styles.statValue}>{stats.current_win_streak}</Text>
                    <Text style={styles.statLabel}>{i18n.t('profile.currentStreak')}</Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statValue}>{stats.longest_win_streak}</Text>
                    <Text style={styles.statLabel}>{i18n.t('profile.bestStreak')}</Text>
                  </View>
                </View>

                <View style={styles.infoRow}>
                  <Text style={styles.label}>{i18n.t('profile.totalScore')}</Text>
                  <Text style={styles.value}>{stats.total_points.toLocaleString()}</Text>
                </View>

                {stats.global_rank && (
                  <View style={styles.infoRow}>
                    <Text style={styles.label}>{i18n.t('profile.rank')}</Text>
                    <Text style={styles.value}>#{stats.global_rank}</Text>
                  </View>
                )}
              </>
            ) : (
              <EmptyState
                icon="📈"
                title={i18n.t('profile.noStatsYet')}
                subtitle={i18n.t('profile.playFirstGame')}
                variant="minimal"
              />
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{i18n.t('profile.accountInfo')}</Text>

            <View style={styles.infoRow}>
              <Text style={styles.label}>{i18n.t('profile.email')}</Text>
              <Text style={styles.value}>{user?.email || i18n.t('profile.notProvided')}</Text>
            </View>

            <View style={styles.infoRow}>
              <Text style={styles.label}>{i18n.t('profile.userId')}</Text>
              <Text style={styles.valueSmall} numberOfLines={1}>
                {user?.id || 'N/A'}
              </Text>
            </View>

            {profile?.username && (
              <View style={styles.infoRow}>
                <Text style={styles.label}>{i18n.t('profile.username')}</Text>
                <Text style={styles.value}>{profile.username}</Text>
              </View>
            )}

            {profile?.full_name && (
              <View style={styles.infoRow}>
                <Text style={styles.label}>{i18n.t('profile.fullName')}</Text>
                <Text style={styles.value}>{profile.full_name}</Text>
              </View>
            )}

            <View style={styles.infoRow}>
              <Text style={styles.label}>{i18n.t('profile.provider')}</Text>
              <Text style={styles.value}>
                {user?.app_metadata?.provider || 'email'}
              </Text>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{i18n.t('profile.sessionDetails')}</Text>

            <View style={styles.infoRow}>
              <Text style={styles.label}>{i18n.t('profile.lastSignIn')}</Text>
              <Text style={styles.valueSmall}>
                {user?.last_sign_in_at
                  ? format(new Date(user.last_sign_in_at), 'MMM d, yyyy h:mm a')
                  : 'N/A'}
              </Text>
            </View>

            <View style={styles.infoRow}>
              <Text style={styles.label}>{i18n.t('profile.createdAt')}</Text>
              <Text style={styles.valueSmall}>
                {user?.created_at
                  ? format(new Date(user.created_at), 'MMMM d, yyyy')
                  : 'N/A'}
              </Text>
            </View>

            <View style={styles.infoRow}>
              <Text style={styles.label}>{i18n.t('profile.emailConfirmed')}</Text>
              <Text style={styles.value}>
                {user?.email_confirmed_at ? i18n.t('common.yes') : i18n.t('common.no')}
              </Text>
            </View>
          </View>

          <TouchableOpacity
            style={styles.matchHistoryButton}
            onPress={() => navigation.navigate('MatchHistory')}
            activeOpacity={0.7}
          >
            <Text style={styles.matchHistoryButtonText}>📜 {i18n.t('matchHistory.title')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.signOutButton}
            onPress={handleSignOut}
            activeOpacity={0.7}
          >
            <Text style={styles.signOutButtonText}>{i18n.t('profile.signOut')}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

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
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 20,
  },
  header: {
    marginBottom: 30,
  },
  rankBadgeContainer: {
    marginTop: 16,
    alignSelf: 'flex-start',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: COLORS.white,
  },
  section: {
    backgroundColor: COLORS.background.dark,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.white,
    marginBottom: 16,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray.darker,
  },
  label: {
    fontSize: 14,
    color: COLORS.gray.text,
    flex: 1,
  },
  value: {
    fontSize: 14,
    color: COLORS.white,
    fontWeight: '500',
    flex: 2,
    textAlign: 'right',
  },
  valueSmall: {
    fontSize: 12,
    color: COLORS.white,
    fontWeight: '500',
    flex: 2,
    textAlign: 'right',
  },
  signOutButton: {
    backgroundColor: '#dc3545',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 20,
  },
  signOutButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '600',
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
    gap: 12,
  },
  statBox: {
    flex: 1,
    backgroundColor: COLORS.gray.darker,
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.secondary,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: COLORS.gray.text,
    textAlign: 'center',
  },
  noStatsContainer: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  noStatsText: {
    fontSize: 16,
    color: COLORS.gray.text,
    marginBottom: 8,
  },
  noStatsSubtext: {
    fontSize: 14,
    color: COLORS.gray.textDark,
  },
  matchHistoryButton: {
    backgroundColor: COLORS.secondary,
    paddingVertical: 14,
    borderRadius: 8,
    marginBottom: 12,
    alignItems: 'center',
  },
  matchHistoryButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '600',
  },
});

export default ProfileScreen;
