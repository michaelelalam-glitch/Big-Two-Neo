import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { COLORS, SPACING, FONT_SIZES } from '../constants';
import { useAuth } from '../contexts/AuthContext';
import { useMatchmaking } from '../hooks/useMatchmaking';
import { i18n } from '../i18n';
import { showError } from '../utils';

type MatchmakingScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Matchmaking'>;

/**
 * Matchmaking Screen - Quick Match Queue
 * 
 * Features:
 * - Joins matchmaking queue automatically on mount
 * - Shows waiting player count
 * - Real-time updates via Supabase
 * - Auto-navigates to lobby when match found
 * - Skill-based matchmaking (±200 ELO)
 */
export default function MatchmakingScreen() {
  const navigation = useNavigation<MatchmakingScreenNavigationProp>();
  const { user, profile } = useAuth();
  
  const {
    isSearching,
    waitingCount,
    matchFound,
    roomCode,
    error,
    startMatchmaking,
    cancelMatchmaking,
    resetMatch,
  } = useMatchmaking();

  // Start matchmaking on mount
  useEffect(() => {
    if (!user || !profile) {
      showError('You must be signed in to use matchmaking');
      navigation.goBack();
      return;
    }

    const username = profile.username || `Player_${user.id.substring(0, 8)}`;
    const skillRating = profile.elo_rating || 1000; // Default to 1000 if no rating
    const region = profile.region || 'global'; // Default to global

    // Start searching for match
    void startMatchmaking(username, skillRating, region);

    // Cleanup on unmount
    return () => {
      void cancelMatchmaking();
    };
  }, [user, profile]);

  // Navigate to lobby when match found
  useEffect(() => {
    if (matchFound && roomCode) {
      resetMatch();
      navigation.replace('Lobby', { roomCode });
    }
  }, [matchFound, roomCode, navigation, resetMatch]);

  // Show error if matchmaking fails
  useEffect(() => {
    if (error) {
      showError(error);
    }
  }, [error]);

  const handleCancel = async () => {
    await cancelMatchmaking();
    navigation.goBack();
  };

  const getSearchingText = () => {
    if (!isSearching) return i18n.t('matchmaking.initializing');
    
    if (waitingCount === 0) {
      return i18n.t('matchmaking.searching');
    } else if (waitingCount === 1) {
      return i18n.t('matchmaking.waiting1');
    } else if (waitingCount === 2) {
      return i18n.t('matchmaking.waiting2');
    } else if (waitingCount === 3) {
      return i18n.t('matchmaking.waiting3');
    } else {
      return i18n.t('matchmaking.matched');
    }
  };

  const getWaitingMessage = () => {
    if (waitingCount === 0) {
      return i18n.t('matchmaking.beFirst');
    } else if (waitingCount === 1) {
      return i18n.t('matchmaking.1playerWaiting');
    } else if (waitingCount === 2) {
      return i18n.t('matchmaking.2playersWaiting');
    } else if (waitingCount === 3) {
      return i18n.t('matchmaking.3playersWaiting');
    } else {
      return i18n.t('matchmaking.startingGame');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {/* Header */}
        <Text style={styles.title}>{i18n.t('matchmaking.title')}</Text>
        
        {/* Searching Animation */}
        <View style={styles.animationContainer}>
          <ActivityIndicator size="large" color={COLORS.success} />
          <Text style={styles.searchingText}>{getSearchingText()}</Text>
        </View>

        {/* Waiting Count */}
        <View style={styles.countContainer}>
          <Text style={styles.countText}>{waitingCount}</Text>
          <Text style={styles.countLabel}>{i18n.t('matchmaking.playersInQueue')}</Text>
        </View>

        {/* Status Message */}
        <Text style={styles.statusMessage}>{getWaitingMessage()}</Text>

        {/* Progress Bar */}
        <View style={styles.progressBarContainer}>
          <View style={[styles.progressBar, { width: `${(waitingCount / 4) * 100}%` }]} />
        </View>
        <Text style={styles.progressText}>
          {waitingCount}/4 {i18n.t('matchmaking.playersNeeded')}
        </Text>

        {/* Info Box */}
        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>ℹ️ {i18n.t('matchmaking.howItWorks')}</Text>
          <Text style={styles.infoText}>
            {i18n.t('matchmaking.description')}
          </Text>
        </View>

        {/* Cancel Button */}
        <TouchableOpacity
          style={styles.cancelButton}
          onPress={handleCancel}
        >
          <Text style={styles.cancelButtonText}>{i18n.t('common.cancel')}</Text>
        </TouchableOpacity>

        {/* Error Display */}
        {error && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>❌ {error}</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.primary,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.lg,
  },
  title: {
    fontSize: FONT_SIZES.xxl,
    fontWeight: 'bold',
    color: COLORS.white,
    marginBottom: SPACING.xl,
  },
  animationContainer: {
    alignItems: 'center',
    marginBottom: SPACING.xl,
  },
  searchingText: {
    fontSize: FONT_SIZES.lg,
    color: COLORS.success,
    marginTop: SPACING.md,
    fontWeight: '600',
  },
  countContainer: {
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  countText: {
    fontSize: 72,
    fontWeight: 'bold',
    color: COLORS.success,
  },
  countLabel: {
    fontSize: FONT_SIZES.md,
    color: COLORS.gray.medium,
  },
  statusMessage: {
    fontSize: FONT_SIZES.lg,
    color: COLORS.white,
    textAlign: 'center',
    marginBottom: SPACING.xl,
    paddingHorizontal: SPACING.lg,
  },
  progressBarContainer: {
    width: '100%',
    height: 8,
    backgroundColor: COLORS.gray.dark,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: SPACING.sm,
  },
  progressBar: {
    height: '100%',
    backgroundColor: COLORS.success,
    borderRadius: 4,
  },
  progressText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.gray.medium,
    marginBottom: SPACING.xl,
  },
  infoBox: {
    width: '100%',
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.3)',
    borderRadius: 12,
    padding: SPACING.md,
    marginBottom: SPACING.xl,
  },
  infoTitle: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    color: COLORS.info,
    marginBottom: SPACING.xs,
  },
  infoText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.gray.light,
    lineHeight: 20,
  },
  cancelButton: {
    backgroundColor: COLORS.error,
    paddingHorizontal: 40,
    paddingVertical: 14,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  cancelButtonText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.lg,
    fontWeight: '600',
  },
  errorContainer: {
    marginTop: SPACING.lg,
    padding: SPACING.md,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: COLORS.error,
    borderRadius: 8,
  },
  errorText: {
    color: COLORS.error,
    fontSize: FONT_SIZES.sm,
    textAlign: 'center',
  },
});
