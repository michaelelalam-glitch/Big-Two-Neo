import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, SPACING, FONT_SIZES } from '../constants';
import { useAuth } from '../contexts/AuthContext';
import { useMatchmaking } from '../hooks/useMatchmaking';
import { i18n } from '../i18n';
import { RootStackParamList } from '../navigation/AppNavigator';
import { showError } from '../utils';
import { useUnlockOrientationOnIos } from '../hooks/useUnlockOrientationOnIos';

type MatchmakingScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Matchmaking'>;
type MatchmakingScreenRouteProp = RouteProp<RootStackParamList, 'Matchmaking'>;

/** P7-2: Server expires waiting_room entries after 5 minutes. */
const QUEUE_EXPIRY_SECONDS = 5 * 60;

/**
 * Matchmaking Screen - Quick Match Queue
 *
 * Features:
 * - Joins matchmaking queue automatically on mount
 * - Shows waiting player count
 * - Real-time updates via Supabase
 * - Auto-navigates to lobby when match found
 * - Skill-based matchmaking (±200 ELO)
 * - Supports Casual and Ranked match types
 */
export default function MatchmakingScreen() {
  const navigation = useNavigation<MatchmakingScreenNavigationProp>();
  const route = useRoute<MatchmakingScreenRouteProp>();
  const { user, profile } = useAuth();

  // On iOS, release any portrait lock held by the game screen so the
  // matchmaking screen can auto-rotate in landscape.
  useUnlockOrientationOnIos(navigation);

  // Get match type from route params (default: 'casual')
  const matchType = route.params?.matchType || 'casual';

  const {
    isSearching,
    waitingCount,
    matchFound,
    roomCode,
    error,
    queueJoinedAt,
    startMatchmaking,
    cancelMatchmaking,
    resetMatch,
  } = useMatchmaking();

  // Start matchmaking on mount
  useEffect(() => {
    if (!user || !profile) {
      showError(i18n.t('matchmaking.signInRequired'));
      navigation.goBack();
      return;
    }

    const username = profile.username || `Player_${user.id.substring(0, 8)}`;
    const skillRating = profile.elo_rating || 1000; // Default to 1000 if no rating
    const region = profile.region || 'global'; // Default to global

    // Start searching for match with specified match type
    void startMatchmaking(username, skillRating, region, matchType);

    // Cleanup on unmount
    return () => {
      void cancelMatchmaking();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cancelMatchmaking, matchType, navigation, startMatchmaking intentionally excluded; this effect is intentionally scoped to user/profile changes (representing the authenticated context); including the matchmaking functions would restart matchmaking on every hook re-render
  }, [user, profile]);

  // Navigate to lobby when match found
  useEffect(() => {
    if (matchFound && roomCode) {
      resetMatch();

      // Route to Lobby for all game types (consistent routing)
      navigation.replace('Lobby', { roomCode });
    }
  }, [matchFound, roomCode, navigation, resetMatch]);

  // Show error if matchmaking fails
  useEffect(() => {
    if (error) {
      showError(error);
    }
  }, [error]);

  // P7-2 FIX: Queue expiry countdown — the server expires waiting_room entries
  // after 5 minutes. Show a live countdown so users know when to retry.
  const [queueSecondsLeft, setQueueSecondsLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!queueJoinedAt) {
      setQueueSecondsLeft(null);
      return;
    }
    const expiryMs = new Date(queueJoinedAt).getTime() + QUEUE_EXPIRY_SECONDS * 1000;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((expiryMs - Date.now()) / 1000));
      setQueueSecondsLeft(remaining);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [queueJoinedAt]);

  const handleCancel = async () => {
    await cancelMatchmaking();
    navigation.goBack();
  };

  const handleStartWithAI = async () => {
    // Cancel matchmaking first
    await cancelMatchmaking();

    // Navigate directly to Game screen with a special flag for AI game
    // GameScreen will detect no roomCode and start a local game
    navigation.replace('Game', { roomCode: 'LOCAL_AI_GAME' });
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
      return i18n.t('matchmaking.onePlayerWaiting');
    } else if (waitingCount === 2) {
      return i18n.t('matchmaking.twoPlayersWaiting');
    } else if (waitingCount === 3) {
      return i18n.t('matchmaking.threePlayersWaiting');
    } else {
      return i18n.t('matchmaking.startingGame');
    }
  };

  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  // Shared blocks used in both portrait and landscape
  const matchTypeBadge = (
    <View style={[styles.matchTypeBadge, matchType === 'ranked' && styles.matchTypeBadgeRanked]}>
      <Text style={styles.matchTypeBadgeText}>
        {matchType === 'casual' ? '😊 ' : '🏆 '}
        {i18n.t(`matchmaking.${matchType}`)}
      </Text>
    </View>
  );

  const searchingAnimation = (
    <View style={[styles.animationContainer, isLandscape && styles.animationContainerLandscape]}>
      <ActivityIndicator size={isLandscape ? 'small' : 'large'} color={COLORS.success} />
      <Text style={[styles.searchingText, isLandscape && styles.searchingTextLandscape]}>
        {getSearchingText()}
      </Text>
    </View>
  );

  const waitingCountBlock = (
    <View style={[styles.countContainer, isLandscape && styles.countContainerLandscape]}>
      <Text style={[styles.countText, isLandscape && styles.countTextLandscape]}>
        {waitingCount}
      </Text>
      <Text style={[styles.countLabel, isLandscape && styles.countLabelLandscape]}>
        {i18n.t('matchmaking.playersInQueue')}
      </Text>
    </View>
  );

  const statusMessage = (
    <Text style={[styles.statusMessage, isLandscape && styles.statusMessageLandscape]}>
      {getWaitingMessage()}
    </Text>
  );

  // P7-2 FIX: Queue expiry countdown display (shown while waiting, hidden when matched)
  const queueExpiryBlock =
    !matchFound && queueSecondsLeft !== null && queueSecondsLeft > 0 ? (
      <Text style={[styles.queueExpiryText, isLandscape && styles.queueExpiryTextLandscape]}>
        {i18n.t('matchmaking.queueExpiresIn', { count: queueSecondsLeft })}
      </Text>
    ) : null;

  const playersForNextMatch = Math.min(waitingCount, 4);

  const progressBlock = (
    <>
      <View style={styles.progressBarContainer}>
        <View style={[styles.progressBar, { width: `${(playersForNextMatch / 4) * 100}%` }]} />
      </View>
      <Text style={[styles.progressText, isLandscape && styles.progressTextLandscape]}>
        {playersForNextMatch}/4 {i18n.t('matchmaking.playersNeeded')}
      </Text>
    </>
  );

  const roomCodeBlock =
    roomCode && waitingCount < 4 ? (
      <View style={[styles.roomCodeContainer, isLandscape && styles.roomCodeContainerLandscape]}>
        <Text style={styles.roomCodeLabel}>🔗 {i18n.t('matchmaking.shareWithFriends')}</Text>
        <View style={styles.roomCodeBox}>
          <Text style={[styles.roomCodeText, isLandscape && styles.roomCodeTextLandscape]}>
            {roomCode}
          </Text>
        </View>
        <Text style={styles.roomCodeHint}>{i18n.t('matchmaking.friendsCanJoin')}</Text>
      </View>
    ) : null;

  const infoBox = (
    <View style={[styles.infoBox, isLandscape && styles.infoBoxLandscape]}>
      <Text style={styles.infoTitle}>ℹ️ {i18n.t('matchmaking.howItWorks')}</Text>
      <Text style={styles.infoText}>{i18n.t('matchmaking.description')}</Text>
    </View>
  );

  const actionButtons = (
    <View style={isLandscape ? styles.actionButtonsRowLandscape : undefined}>
      <TouchableOpacity
        style={[styles.startWithAIButton, isLandscape && styles.startWithAIButtonLandscape]}
        onPress={handleStartWithAI}
        accessibilityRole="button"
        accessibilityLabel={i18n.t('lobby.startWithBots')}
      >
        <Text style={[styles.startWithAIButtonText, isLandscape && styles.buttonTextLandscape]}>
          🤖 {i18n.t('lobby.startWithBots')}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        testID="cancel-matchmaking-button"
        style={[styles.cancelButton, isLandscape && styles.cancelButtonLandscape]}
        onPress={handleCancel}
        accessibilityRole="button"
        accessibilityLabel={i18n.t('common.cancel')}
      >
        <Text style={[styles.cancelButtonText, isLandscape && styles.buttonTextLandscape]}>
          {i18n.t('common.cancel')}
        </Text>
      </TouchableOpacity>
    </View>
  );

  const errorBlock = error ? (
    <View style={styles.errorContainer}>
      <Text style={styles.errorText}>❌ {error}</Text>
    </View>
  ) : null;

  return (
    <SafeAreaView style={styles.container} testID="matchmaking-screen">
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, isLandscape && styles.scrollContentLandscape]}
        showsVerticalScrollIndicator={true}
        bounces={true}
      >
        {isLandscape ? (
          // LANDSCAPE: two-column layout with minHeight to prevent column collapse on iOS
          <View style={[styles.landscapeRoot, { minHeight: Math.max(0, height - SPACING.xl) }]}>
            {/* Left column: status & animation */}
            <View style={styles.landscapeLeft}>
              <Text style={styles.titleLandscape}>{i18n.t('matchmaking.title')}</Text>
              {matchTypeBadge}
              {searchingAnimation}
              {waitingCountBlock}
              {statusMessage}
              {queueExpiryBlock}
              {progressBlock}
            </View>
            {/* Right column: info, room code, actions */}
            <View style={styles.landscapeRight}>
              {roomCodeBlock}
              {infoBox}
              {actionButtons}
              {errorBlock}
            </View>
          </View>
        ) : (
          // PORTRAIT: single-column layout (original)
          <View style={styles.content}>
            <Text style={styles.title}>{i18n.t('matchmaking.title')}</Text>
            {matchTypeBadge}
            {searchingAnimation}
            {waitingCountBlock}
            {statusMessage}
            {queueExpiryBlock}
            {roomCodeBlock}
            {progressBlock}
            {infoBox}
            {actionButtons}
            {errorBlock}
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  scrollContentLandscape: {
    paddingBottom: SPACING.md,
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
  animationContainerLandscape: {
    marginBottom: SPACING.sm,
  },
  searchingText: {
    fontSize: FONT_SIZES.lg,
    color: COLORS.success,
    marginTop: SPACING.md,
    fontWeight: '600',
  },
  searchingTextLandscape: {
    fontSize: FONT_SIZES.md,
    marginTop: SPACING.xs,
  },
  countContainer: {
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  countContainerLandscape: {
    marginBottom: SPACING.sm,
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
  countLabelLandscape: {
    fontSize: FONT_SIZES.sm,
  },
  statusMessage: {
    fontSize: FONT_SIZES.lg,
    color: COLORS.white,
    textAlign: 'center',
    marginBottom: SPACING.xl,
    paddingHorizontal: SPACING.lg,
  },
  statusMessageLandscape: {
    fontSize: FONT_SIZES.md,
    marginBottom: SPACING.sm,
  },
  // P7-2: Queue expiry countdown
  queueExpiryText: {
    fontSize: FONT_SIZES.sm,
    color: 'rgba(255,255,255,0.55)',
    textAlign: 'center',
    marginBottom: SPACING.md,
  },
  queueExpiryTextLandscape: {
    fontSize: FONT_SIZES.xs,
    marginBottom: SPACING.xs,
  },
  roomCodeContainer: {
    width: '100%',
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.3)',
    borderRadius: 12,
    padding: SPACING.md,
    marginBottom: SPACING.lg,
    alignItems: 'center',
  },
  roomCodeContainerLandscape: {
    padding: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  roomCodeLabel: {
    fontSize: FONT_SIZES.md,
    color: COLORS.info,
    fontWeight: '600',
    marginBottom: SPACING.sm,
  },
  roomCodeBox: {
    backgroundColor: COLORS.gray.dark,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: 8,
    marginBottom: SPACING.xs,
  },
  roomCodeText: {
    fontSize: FONT_SIZES.xl,
    color: COLORS.white,
    fontWeight: '700',
    letterSpacing: 4,
    fontFamily: 'monospace',
  },
  roomCodeTextLandscape: {
    fontSize: FONT_SIZES.lg,
  },
  roomCodeHint: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.gray.medium,
    textAlign: 'center',
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
  progressTextLandscape: {
    marginBottom: SPACING.sm,
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
  infoBoxLandscape: {
    padding: SPACING.sm,
    marginBottom: SPACING.sm,
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
  startWithAIButton: {
    backgroundColor: COLORS.info,
    paddingHorizontal: 40,
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: SPACING.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  startWithAIButtonText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.lg,
    fontWeight: '600',
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
  matchTypeBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: COLORS.success,
    borderRadius: 20,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    marginBottom: SPACING.lg,
  },
  matchTypeBadgeRanked: {
    backgroundColor: 'rgba(250, 204, 21, 0.15)',
    borderColor: '#FCD34D',
  },
  matchTypeBadgeText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
  },
  // Landscape layout
  landscapeRoot: {
    flexDirection: 'row',
    padding: SPACING.md,
    gap: SPACING.lg,
  },
  landscapeLeft: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  landscapeRight: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleLandscape: {
    fontSize: FONT_SIZES.xl,
    fontWeight: 'bold',
    color: COLORS.white,
    marginBottom: SPACING.md,
  },
  countTextLandscape: {
    fontSize: 48,
  },
  actionButtonsRowLandscape: {
    flexDirection: 'row',
    gap: SPACING.sm,
    width: '100%',
    justifyContent: 'center',
  },
  startWithAIButtonLandscape: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: 10,
    flex: 1,
  },
  cancelButtonLandscape: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: 10,
    flex: 1,
  },
  buttonTextLandscape: {
    fontSize: FONT_SIZES.md,
  },
});
