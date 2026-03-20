import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Modal,
  useWindowDimensions,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, SPACING, FONT_SIZES } from '../constants';
import { ActiveGameBanner } from '../components/home/ActiveGameBanner';
import { useAuth } from '../contexts/AuthContext';
import { useNotifications } from '../contexts/NotificationContext';
import { useActiveGameBanner } from '../hooks/useActiveGameBanner';
import { useMatchmakingFlow } from '../hooks/useMatchmakingFlow';
import { i18n } from '../i18n';
import { RootStackParamList } from '../navigation/AppNavigator';

type HomeScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Home'>;

export default function HomeScreen() {
  const navigation = useNavigation<HomeScreenNavigationProp>();
  const { user, profile } = useAuth();
  const { unreadCount } = useNotifications();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const isLandscape = screenWidth > screenHeight;

  const {
    currentRoom,
    setCurrentRoom,
    currentRoomStatus,
    disconnectTimestamp,
    canRejoinAfterExpiry,
    bannerRefreshKey,
    checkGameExclusivity,
    handleBannerResume,
    handleBannerLeave,
    handleReplaceBotAndRejoin,
    handleTimerExpired,
  } = useActiveGameBanner(user, navigation);

  const {
    isQuickPlaying,
    isRankedSearching,
    setIsRankedSearching,
    showFindGameModal,
    setShowFindGameModal,
    showDifficultyModal,
    setShowDifficultyModal,
    handleCasualMatch,
    handleRankedMatch,
    handleOfflinePractice,
    handleStartOfflineWithDifficulty,
  } = useMatchmakingFlow(user, profile, navigation, checkGameExclusivity, setCurrentRoom);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={true}
        bounces={true}
      >
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.leaderboardButton}
            onPress={() => navigation.navigate('Leaderboard')}
          >
            <Text style={styles.leaderboardButtonText}>{i18n.t('home.leaderboard')}</Text>
          </TouchableOpacity>
          <View style={styles.headerRight}>
            <TouchableOpacity
              style={styles.bellButton}
              onPress={() => navigation.navigate('Notifications')}
              accessibilityRole="button"
              accessibilityLabel={
                unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'
              }
              accessibilityHint="Opens notification history"
            >
              <Text style={styles.bellButtonText}>🔔</Text>
              {unreadCount > 0 && (
                <View style={styles.bellBadge}>
                  <Text style={styles.bellBadgeText}>
                    {unreadCount > 99 ? '99+' : String(unreadCount)}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.settingsButton}
              onPress={() => navigation.navigate('Settings')}
            >
              <Text style={styles.settingsButtonText}>⚙️</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.profileButton}
              onPress={() => navigation.navigate('Profile')}
            >
              <Text style={styles.profileButtonText}>{i18n.t('home.profile')}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.content}>
          <Text style={styles.title}>{i18n.t('home.title')}</Text>
          <Text style={styles.subtitle}>
            {i18n.t('home.welcome')}, {profile?.username || user?.email || 'Player'}!
          </Text>

          {/* Active Game Banner - shows for both offline and online open games */}
          <ActiveGameBanner
            onlineRoomCode={currentRoom}
            onlineRoomStatus={currentRoomStatus}
            disconnectTimestamp={disconnectTimestamp}
            onResume={handleBannerResume}
            onLeave={handleBannerLeave}
            onReplaceBotAndRejoin={handleReplaceBotAndRejoin}
            onTimerExpired={handleTimerExpired}
            canRejoinAfterExpiry={canRejoinAfterExpiry}
            refreshTrigger={bannerRefreshKey}
          />

          <View style={styles.buttonContainer}>
            <TouchableOpacity
              style={[
                styles.mainButton,
                styles.findGameButton,
                (isQuickPlaying || isRankedSearching) && styles.buttonDisabled,
              ]}
              onPress={() => setShowFindGameModal(true)}
              disabled={isQuickPlaying || isRankedSearching}
            >
              {isQuickPlaying || isRankedSearching ? (
                <>
                  <ActivityIndicator color={COLORS.white} size="small" />
                  <Text style={styles.mainButtonSubtext}>
                    {isRankedSearching
                      ? i18n.t('home.findingRankedMatch')
                      : i18n.t('common.loading')}
                  </Text>
                </>
              ) : (
                <>
                  <Text style={styles.mainButtonText}>{i18n.t('home.findGame')}</Text>
                  <Text style={styles.mainButtonSubtext}>{i18n.t('home.findGameDescription')}</Text>
                </>
              )}
            </TouchableOpacity>

            {isRankedSearching && (
              <TouchableOpacity
                style={[styles.mainButton, styles.cancelButton]}
                onPress={() => {
                  setIsRankedSearching(false);
                }}
              >
                <Text style={styles.mainButtonText}>{i18n.t('home.cancelSearch')}</Text>
                <Text style={styles.mainButtonSubtext}>{i18n.t('home.findingRankedMatch')}</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[styles.mainButton, styles.createButton]}
              onPress={async () => {
                const canProceed = await checkGameExclusivity('online');
                if (canProceed) navigation.navigate('CreateRoom');
              }}
            >
              <Text style={styles.mainButtonText}>{i18n.t('home.createRoom')}</Text>
              <Text style={styles.mainButtonSubtext}>{i18n.t('home.createRoomDescription')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.mainButton, styles.offlinePracticeButton]}
              onPress={handleOfflinePractice}
            >
              <Text style={styles.mainButtonText}>{i18n.t('home.offlinePractice')}</Text>
              <Text style={styles.mainButtonSubtext}>
                {i18n.t('home.offlinePracticeDescription')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.mainButton, styles.joinButton]}
              onPress={async () => {
                const canProceed = await checkGameExclusivity('online');
                if (canProceed) navigation.navigate('JoinRoom');
              }}
            >
              <Text style={styles.mainButtonText}>{i18n.t('home.joinRoom')}</Text>
              <Text style={styles.mainButtonSubtext}>{i18n.t('home.joinRoomDescription')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.mainButton, styles.howToPlayButton]}
              onPress={() => navigation.navigate('HowToPlay')}
            >
              <Text style={styles.mainButtonText}>{i18n.t('home.howToPlay')}</Text>
              <Text style={styles.mainButtonSubtext}>{i18n.t('home.howToPlayDescription')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      {/* Bot Difficulty Picker Modal */}
      <Modal
        visible={showDifficultyModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowDifficultyModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalContainer,
              { maxHeight: screenHeight * 0.88, width: isLandscape ? screenWidth * 0.65 : '100%' },
            ]}
          >
            <Text style={styles.modalTitle}>{i18n.t('home.botDifficultyTitle')}</Text>
            <Text style={styles.modalSubtitle}>{i18n.t('home.botDifficultySubtitle')}</Text>

            <ScrollView
              showsVerticalScrollIndicator={false}
              bounces={false}
              contentContainerStyle={styles.modalScrollContent}
            >
              <View
                style={[
                  styles.modalButtonContainer,
                  isLandscape && styles.modalButtonContainerLandscape,
                ]}
              >
                <TouchableOpacity
                  style={[
                    styles.modalButton,
                    styles.difficultyEasyButton,
                    isLandscape && styles.modalButtonLandscape,
                  ]}
                  onPress={() => handleStartOfflineWithDifficulty('easy')}
                >
                  <Text
                    style={[styles.modalButtonIcon, isLandscape && styles.modalButtonIconLandscape]}
                  >
                    😊
                  </Text>
                  <Text style={styles.modalButtonText}>{i18n.t('home.easy')}</Text>
                  <Text style={styles.modalButtonSubtext}>{i18n.t('home.easyDesc')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.modalButton,
                    styles.difficultyMediumButton,
                    isLandscape && styles.modalButtonLandscape,
                  ]}
                  onPress={() => handleStartOfflineWithDifficulty('medium')}
                >
                  <Text
                    style={[styles.modalButtonIcon, isLandscape && styles.modalButtonIconLandscape]}
                  >
                    🧠
                  </Text>
                  <Text style={styles.modalButtonText}>{i18n.t('home.medium')}</Text>
                  <Text style={styles.modalButtonSubtext}>{i18n.t('home.mediumDesc')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.modalButton,
                    styles.difficultyHardButton,
                    isLandscape && styles.modalButtonLandscape,
                  ]}
                  onPress={() => handleStartOfflineWithDifficulty('hard')}
                >
                  <Text
                    style={[styles.modalButtonIcon, isLandscape && styles.modalButtonIconLandscape]}
                  >
                    🔥
                  </Text>
                  <Text style={styles.modalButtonText}>{i18n.t('home.hard')}</Text>
                  <Text style={styles.modalButtonSubtext}>{i18n.t('home.hardDesc')}</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => setShowDifficultyModal(false)}
              >
                <Text style={styles.modalCancelText}>{i18n.t('common.cancel')}</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Find a Game Modal */}
      <Modal
        visible={showFindGameModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowFindGameModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalContainer,
              { maxHeight: screenHeight * 0.88, width: isLandscape ? screenWidth * 0.65 : '100%' },
            ]}
          >
            <Text style={styles.modalTitle}>{i18n.t('home.findGame')}</Text>
            <Text style={styles.modalSubtitle}>{i18n.t('home.chooseGameMode')}</Text>

            <ScrollView
              showsVerticalScrollIndicator={false}
              bounces={false}
              contentContainerStyle={styles.modalScrollContent}
            >
              <View
                style={[
                  styles.modalButtonContainer,
                  isLandscape && styles.modalButtonContainerLandscape,
                ]}
              >
                <TouchableOpacity
                  style={[
                    styles.modalButton,
                    styles.modalCasualButton,
                    isLandscape && styles.modalButtonLandscape,
                  ]}
                  onPress={handleCasualMatch}
                  disabled={isQuickPlaying}
                >
                  <Text
                    style={[styles.modalButtonIcon, isLandscape && styles.modalButtonIconLandscape]}
                  >
                    🎮
                  </Text>
                  <Text style={styles.modalButtonText}>{i18n.t('home.casualMatch')}</Text>
                  <Text style={styles.modalButtonSubtext}>
                    {i18n.t('home.casualMatchDescription')}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.modalButton,
                    styles.modalRankedButton,
                    isLandscape && styles.modalButtonLandscape,
                  ]}
                  onPress={() => handleRankedMatch(0)}
                  disabled={isRankedSearching}
                >
                  <Text
                    style={[styles.modalButtonIcon, isLandscape && styles.modalButtonIconLandscape]}
                  >
                    🏆
                  </Text>
                  <Text style={styles.modalButtonText}>{i18n.t('home.rankedMatch')}</Text>
                  <Text style={styles.modalButtonSubtext}>
                    {i18n.t('home.rankedMatchDescription')}
                  </Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => setShowFindGameModal(false)}
              >
                <Text style={styles.modalCancelText}>{i18n.t('common.cancel')}</Text>
              </TouchableOpacity>
            </ScrollView>
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: SPACING.md,
  },
  headerRight: {
    flexDirection: 'row',
    gap: SPACING.sm,
    alignItems: 'center',
  },
  leaderboardButton: {
    backgroundColor: COLORS.gold,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  leaderboardButtonText: {
    color: COLORS.primary,
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
  },
  settingsButton: {
    backgroundColor: COLORS.gray.dark,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
  },
  settingsButtonText: {
    fontSize: FONT_SIZES.lg,
  },
  bellButton: {
    backgroundColor: COLORS.gray.dark,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    position: 'relative',
  },
  bellButtonText: {
    fontSize: FONT_SIZES.lg,
  },
  bellBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: COLORS.red.active,
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 3,
  },
  bellBadgeText: {
    color: COLORS.white,
    fontSize: 10,
    fontWeight: '700',
  },
  profileButton: {
    backgroundColor: COLORS.secondary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  profileButtonText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
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
    marginBottom: SPACING.md,
  },
  subtitle: {
    fontSize: FONT_SIZES.md,
    color: COLORS.gray.medium,
    marginBottom: SPACING.xl,
  },
  currentRoomBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(251, 191, 36, 0.2)',
    borderWidth: 1,
    borderColor: '#F59E0B',
    borderRadius: 8,
    padding: SPACING.md,
    marginBottom: SPACING.lg,
  },
  currentRoomText: {
    flex: 1,
    fontSize: FONT_SIZES.sm,
    color: '#FCD34D',
    fontWeight: '600',
  },
  leaveRoomButton: {
    backgroundColor: '#EF4444',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  leaveRoomButtonText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
  },
  buttonContainer: {
    width: '100%',
    gap: SPACING.md,
  },
  mainButton: {
    padding: SPACING.lg,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  findGameButton: {
    backgroundColor: '#10B981', // Vibrant Green
    borderWidth: 2,
    borderColor: '#34D399',
  },
  cancelButton: {
    backgroundColor: '#EF4444', // Red
    borderWidth: 2,
    borderColor: '#F87171',
  },
  createButton: {
    backgroundColor: '#3B82F6', // Blue
  },
  offlinePracticeButton: {
    backgroundColor: '#6366F1', // Indigo
    borderWidth: 2,
    borderColor: '#818CF8',
  },
  joinButton: {
    backgroundColor: '#8B5CF6', // Purple
  },
  howToPlayButton: {
    backgroundColor: '#F59E0B', // Amber/Orange
  },
  mainButtonText: {
    fontSize: FONT_SIZES.xl,
    fontWeight: 'bold',
    color: COLORS.white,
    marginBottom: SPACING.xs,
  },
  mainButtonSubtext: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.white,
    opacity: 0.9,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  modalContainer: {
    backgroundColor: COLORS.primary,
    borderRadius: 16,
    padding: SPACING.xl,
    width: '100%',
    maxWidth: 400,
    borderWidth: 2,
    borderColor: COLORS.secondary,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  modalTitle: {
    fontSize: FONT_SIZES.xxl,
    fontWeight: 'bold',
    color: COLORS.white,
    textAlign: 'center',
    marginBottom: SPACING.xs,
  },
  modalSubtitle: {
    fontSize: FONT_SIZES.md,
    color: COLORS.gray.medium,
    textAlign: 'center',
    marginBottom: SPACING.xl,
  },
  modalButtonContainer: {
    gap: SPACING.md,
    marginBottom: SPACING.lg,
  },
  modalButton: {
    padding: SPACING.lg,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  modalCasualButton: {
    backgroundColor: '#10B981',
    borderColor: '#34D399',
  },
  modalRankedButton: {
    backgroundColor: '#F59E0B',
    borderColor: '#FBBF24',
  },
  difficultyEasyButton: {
    backgroundColor: '#10B981',
    borderColor: '#34D399',
  },
  difficultyMediumButton: {
    backgroundColor: '#F59E0B',
    borderColor: '#FBBF24',
  },
  difficultyHardButton: {
    backgroundColor: '#EF4444',
    borderColor: '#F87171',
  },
  modalButtonIcon: {
    fontSize: 32,
    marginBottom: SPACING.xs,
  },
  modalButtonText: {
    fontSize: FONT_SIZES.lg,
    fontWeight: 'bold',
    color: COLORS.white,
    marginBottom: SPACING.xs,
  },
  modalButtonSubtext: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.white,
    opacity: 0.9,
    textAlign: 'center',
  },
  modalCancelButton: {
    padding: SPACING.md,
    alignItems: 'center',
  },
  modalCancelText: {
    fontSize: FONT_SIZES.md,
    color: COLORS.gray.medium,
    fontWeight: '600',
  },
  modalScrollContent: {
    flexGrow: 1,
  },
  modalButtonContainerLandscape: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  modalButtonLandscape: {
    flex: 1,
    minWidth: 120,
    padding: SPACING.md,
  },
  modalButtonIconLandscape: {
    fontSize: 20,
    marginBottom: 2,
  },
});
