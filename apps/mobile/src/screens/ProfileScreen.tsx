import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../services/supabase';
import { COLORS } from '../constants';
import ErrorBoundary from '../components/ErrorBoundary';
import { statsLogger, authLogger } from '../utils/logger';

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
        statsLogger.error('[Profile] Stats fetch error:', { error });
      } else {
        setStats(data);
      }
    } catch (error) {
      statsLogger.error('[Profile] Error fetching stats:', { error });
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
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      {
        text: 'Cancel',
        style: 'cancel',
      },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          try {
            await signOut();
          } catch (error) {
            authLogger.error('Error signing out:', { error });
            Alert.alert('Error', 'Failed to sign out. Please try again.');
          }
        },
      },
    ]);
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
      <ErrorBoundary>
      <ScrollView 
        style={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.secondary} />
        }
      >
        <View style={styles.content}>
          <View style={styles.header}>
            <Text style={styles.title}>Profile</Text>
          </View>

          {/* Statistics Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>📊 Statistics</Text>
            
            {statsLoading ? (
              <ActivityIndicator size="small" color={COLORS.secondary} style={{ paddingVertical: 20 }} />
            ) : stats ? (
              <>
                <View style={styles.statsGrid}>
                  <View style={styles.statBox}>
                    <Text style={styles.statValue}>{stats.games_played}</Text>
                    <Text style={styles.statLabel}>Games Played</Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statValue}>{stats.games_won}</Text>
                    <Text style={styles.statLabel}>Wins</Text>
                  </View>
                </View>

                <View style={styles.statsGrid}>
                  <View style={styles.statBox}>
                    <Text style={styles.statValue}>{stats.win_rate.toFixed(1)}%</Text>
                    <Text style={styles.statLabel}>Win Rate</Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statValue}>{stats.rank_points}</Text>
                    <Text style={styles.statLabel}>Rank Points</Text>
                  </View>
                </View>

                <View style={styles.statsGrid}>
                  <View style={styles.statBox}>
                    <Text style={styles.statValue}>{stats.current_win_streak}</Text>
                    <Text style={styles.statLabel}>Current Streak</Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statValue}>{stats.longest_win_streak}</Text>
                    <Text style={styles.statLabel}>Best Streak</Text>
                  </View>
                </View>

                <View style={styles.infoRow}>
                  <Text style={styles.label}>Total Points</Text>
                  <Text style={styles.value}>{stats.total_points.toLocaleString()}</Text>
                </View>

                {stats.global_rank && (
                  <View style={styles.infoRow}>
                    <Text style={styles.label}>Global Rank</Text>
                    <Text style={styles.value}>#{stats.global_rank}</Text>
                  </View>
                )}
              </>
            ) : (
              <View style={styles.noStatsContainer}>
                <Text style={styles.noStatsText}>No game statistics yet</Text>
                <Text style={styles.noStatsSubtext}>Play your first game to see your stats!</Text>
              </View>
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Account Information</Text>

            <View style={styles.infoRow}>
              <Text style={styles.label}>Email</Text>
              <Text style={styles.value}>{user?.email || 'Not provided'}</Text>
            </View>

            <View style={styles.infoRow}>
              <Text style={styles.label}>User ID</Text>
              <Text style={styles.valueSmall} numberOfLines={1}>
                {user?.id || 'N/A'}
              </Text>
            </View>

            {profile?.username && (
              <View style={styles.infoRow}>
                <Text style={styles.label}>Username</Text>
                <Text style={styles.value}>{profile.username}</Text>
              </View>
            )}

            {profile?.full_name && (
              <View style={styles.infoRow}>
                <Text style={styles.label}>Full Name</Text>
                <Text style={styles.value}>{profile.full_name}</Text>
              </View>
            )}

            <View style={styles.infoRow}>
              <Text style={styles.label}>Provider</Text>
              <Text style={styles.value}>
                {user?.app_metadata?.provider || 'email'}
              </Text>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Session Details</Text>

            <View style={styles.infoRow}>
              <Text style={styles.label}>Last Sign In</Text>
              <Text style={styles.valueSmall}>
                {user?.last_sign_in_at
                  ? new Date(user.last_sign_in_at).toLocaleDateString()
                  : 'N/A'}
              </Text>
            </View>

            <View style={styles.infoRow}>
              <Text style={styles.label}>Created At</Text>
              <Text style={styles.valueSmall}>
                {user?.created_at
                  ? new Date(user.created_at).toLocaleDateString()
                  : 'N/A'}
              </Text>
            </View>

            <View style={styles.infoRow}>
              <Text style={styles.label}>Email Confirmed</Text>
              <Text style={styles.value}>
                {user?.email_confirmed_at ? 'Yes' : 'No'}
              </Text>
            </View>
          </View>

          <TouchableOpacity
            style={styles.signOutButton}
            onPress={handleSignOut}
            activeOpacity={0.7}
          >
            <Text style={styles.signOutButtonText}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
      </ErrorBoundary>
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
});

export default ProfileScreen;
