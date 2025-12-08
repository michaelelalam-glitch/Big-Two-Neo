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

  const fetchStats = useCallback(async () => {
    if (!user?.id) return;

    try {
      const { data, error } = await supabase
        .from('player_stats')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows
        console.error('[Profile] Stats fetch error:', error);
      } else {
        setStats(data);
      }
    } catch (error) {
      console.error('[Profile] Error fetching stats:', error);
    } finally {
      setStatsLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchStats();
    setRefreshing(false);
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
            console.error('Error signing out:', error);
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
          <ActivityIndicator size="large" color="#4A90E2" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView 
        style={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#4A90E2" />
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
              <ActivityIndicator size="small" color="#4A90E2" style={{ paddingVertical: 20 }} />
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
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#25292e',
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
    color: '#fff',
  },
  section: {
    backgroundColor: '#1c1f24',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 16,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2d33',
  },
  label: {
    fontSize: 14,
    color: '#a0a0a0',
    flex: 1,
  },
  value: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '500',
    flex: 2,
    textAlign: 'right',
  },
  valueSmall: {
    fontSize: 12,
    color: '#fff',
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
    color: '#fff',
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
    backgroundColor: '#2a2d33',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#4A90E2',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: '#a0a0a0',
    textAlign: 'center',
  },
  noStatsContainer: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  noStatsText: {
    fontSize: 16,
    color: '#a0a0a0',
    marginBottom: 8,
  },
  noStatsSubtext: {
    fontSize: 14,
    color: '#666',
  },
});

export default ProfileScreen;
