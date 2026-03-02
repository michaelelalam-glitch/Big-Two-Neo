import React, { useState, useCallback } from 'react';
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
import { useNavigation } from '@react-navigation/native';
import { format } from 'date-fns';
import type { StackNavigationProp } from '@react-navigation/stack';
import { RankBadge, Rank } from '../components/RankBadge';
import { COLORS, SPACING } from '../constants';
import { useAuth } from '../contexts/AuthContext';
import { i18n } from '../i18n';
import { RootStackParamList } from '../navigation/AppNavigator';
import { showError, showConfirm } from '../utils';
import { authLogger } from '../utils/logger';

const ProfileScreen = () => {
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const { user, profile, isLoading, signOut } = useAuth();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    // Just briefly show refresh indicator – profile data comes from AuthContext
    setTimeout(() => setRefreshing(false), 500);
  }, []);

  const handleSignOut = async () => {
    showConfirm({
      title: i18n.t('profile.signOut'),
      message: i18n.t('profile.signOutConfirm'),
      confirmText: i18n.t('profile.signOut'),
      destructive: true,
      onConfirm: async () => {
        try {
          await signOut();
        } catch (error: unknown) {
          authLogger.error('Error signing out:', error instanceof Error ? error.message : String(error));
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
            <View style={styles.rankRowContainer}>
              {profile?.rank && profile?.elo_rating ? (
                <View style={styles.rankBadgeContainer}>
                  <RankBadge 
                    rank={profile.rank as Rank} 
                    elo={profile.elo_rating} 
                    size="large" 
                    showElo={true}
                  />
                </View>
              ) : (
                <View style={styles.rankBadgePlaceholder} />
              )}
              <TouchableOpacity
                style={styles.statsButtonInline}
                onPress={() => navigation.navigate('Stats', { userId: user?.id })}
                activeOpacity={0.7}
              >
                <Text style={styles.statsButtonInlineText}>📊 {i18n.t('profile.viewFullStats') || 'View Full Stats'}</Text>
              </TouchableOpacity>
            </View>
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
  rankRowContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    gap: 12,
  },
  rankBadgeContainer: {
    flex: 1,
    alignSelf: 'stretch',
  },
  rankBadgePlaceholder: {
    flex: 1,
  },
  statsButtonInline: {
    flex: 1,
    alignSelf: 'stretch',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background.dark,
    borderWidth: 1,
    borderColor: COLORS.secondary,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 8,
    minHeight: 52,
  },
  statsButtonInlineText: {
    color: COLORS.secondary,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
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
