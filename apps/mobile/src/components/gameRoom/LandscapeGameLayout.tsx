/**
 * LandscapeGameLayout Component
 *
 * Complete landscape game room layout
 *
 * Features:
 * - All Phase 2 components integrated
 * - Scoreboard, table, players, controls
 * - Orientation-aware rendering
 *
 * Task #450: Add orientation toggle functionality
 * Date: December 18, 2025
 */

import React from 'react';
import { View, StyleSheet, Text, Pressable, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { i18n } from '../../i18n';
import { scoreDisplayStyles } from '../../styles/scoreDisplayStyles';
import { gameScreenStyles } from '../../styles/gameScreenStyles';
import { AutoPassTimer, ThrowButton, ThrowablePlayerEffect } from '../game';
import type { InGameAlertOptions } from '../game';
import type { Card as CardType } from '../../game/types';
import type { AutoPassTimerState } from '../../types/multiplayer';
import type { ActiveThrowableEffect } from '../../hooks/useThrowables';
import type { ScoreHistory, PlayHistoryMatch } from '../../types/scoreboard';
import { LAYOUT } from '../../constants';
import { useUserPreferencesStore } from '../../store';
import { AddFriendButton } from '../friends';
import { useFriendsContext } from '../../contexts/FriendsContext';
import { LandscapeYourPosition } from './LandscapeYourPosition';
import { LandscapeScoreboard, PlayHistoryModal } from './LandscapeScoreboard';
import { LandscapeOvalTable } from './LandscapeOvalTable';
import { LandscapeOpponent } from './LandscapeOpponent';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface LandscapeGameLayoutProps {
  /** Scoreboard data */
  playerNames: string[];
  /** Optional player user IDs in display order [bottom, top, left, right] — used for friend actions */
  playerIds?: (string | null)[];
  currentScores: number[];
  cardCounts: number[];
  currentPlayerIndex: number;
  matchNumber: number;
  isGameFinished: boolean;
  scoreHistory?: ScoreHistory[];
  playHistory?: PlayHistoryMatch[];
  originalPlayerNames?: string[]; // Original player names for play history (game state order)
  autoPassTimerState?: AutoPassTimerState;
  /** Total cumulative scores per player (Task #590) */
  totalScores?: number[];

  /** Table data */
  lastPlayedCards?: CardType[];
  lastPlayedBy?: string;
  lastPlayComboType?: string;
  lastPlayCombo?: string;

  /** Player data */
  playerName: string;
  playerCardCount: number;
  playerCards: CardType[];
  isPlayerActive: boolean;
  selectedCardIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  onCardsReorder?: (reorderedCards: CardType[]) => void;

  /** Drag-to-play callback */
  onPlayCards?: (cards: CardType[]) => void;

  /** fix/rejoin: disconnect state per player in display order [bottom, top, left, right] */
  disconnectedPlayers?: boolean[];
  /** Disconnect timer started_at per player in display order */
  disconnectTimerStartedAts?: (string | null)[];
  /** Turn timer started_at per player in display order */
  turnTimerStartedAts?: (string | null)[];
  /** Countdown expired callbacks per player in display order */
  onCountdownExpireds?: ((() => void) | undefined)[];

  /** Chat toggle (multiplayer only) */
  onChatToggle?: () => void;
  isChatOpen?: boolean;
  isMultiplayer?: boolean;
  chatUnreadCount?: number;

  /** Control bar callbacks */
  onOrientationToggle: () => void;
  onHelp?: () => void;
  onSort?: () => void;
  onSmartSort?: () => void;
  onPlay?: () => void;
  onPass?: () => void;
  onHint?: () => void;
  onSettings?: () => void;

  /** Control states */
  disabled?: boolean;
  canPlay?: boolean;
  canPass?: boolean;

  /** Throwables (multiplayer only) */
  onThrowPress?: () => void;
  isThrowCooldown?: boolean;
  cooldownRemaining?: number;
  /** Active throwable effects per display slot [0=local, 1=top, 2=left, 3=right] */
  throwableActiveEffects?: readonly (ActiveThrowableEffect | null)[];
  /** Whether the local player's mic is on (for mic toggle button) */
  isLocalMicOn?: boolean;
  /** Called when the local player presses the mic toggle button */
  onMicToggle?: () => void;

  /** Drag zone state for table glow (matches portrait GameLayout) */
  dropZoneState?: import('../game/CardHand').DragZoneState;
  /** Callback when drag zone state changes (from LandscapeYourPosition) */
  onDragZoneChange?: (state: import('../game/CardHand').DragZoneState) => void;

  /** Video chat: camera on per display slot [bottom, top, left, right] */
  isCameraOns?: boolean[];
  /** Video chat: mic on per display slot */
  isMicOns?: boolean[];
  /** Video chat: connecting per display slot */
  isVideoChatConnectings?: boolean[];
  /** Video chat: video stream slot elements per display slot */
  videoStreamSlots?: (React.ReactNode | undefined)[];
  /** Orientation-aware alert (replaces native Alert.alert for landscape) */
  showInGameAlert?: (options: InGameAlertOptions) => void;
  /** Server-to-client clock offset (ms) from useClockSync — forwarded to each LandscapeOpponent
   * so InactivityCountdownRing computes elapsed time against the corrected server clock. */
  turnClockOffsetMs?: number;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

// H14: Wrap with React.memo so parent re-renders only propagate when props change.
export const LandscapeGameLayout = React.memo(function LandscapeGameLayout({
  // Scoreboard
  playerNames,
  currentScores,
  cardCounts,
  currentPlayerIndex,
  matchNumber,
  isGameFinished,
  scoreHistory = [],
  playHistory = [],
  originalPlayerNames,
  autoPassTimerState,
  totalScores = [0, 0, 0, 0],

  // Table
  lastPlayedCards,
  lastPlayedBy,
  lastPlayComboType,
  lastPlayCombo,

  // Player
  playerName,
  playerCardCount,
  playerCards,
  isPlayerActive,
  selectedCardIds,
  onSelectionChange,
  onCardsReorder,
  onPlayCards: onPlayCardsCallback,

  // Chat
  onChatToggle,
  isChatOpen = false,
  isMultiplayer = false,
  chatUnreadCount = 0,

  // Controls
  onOrientationToggle,
  onHelp: _onHelp,
  onSort,
  onSmartSort,
  onPlay,
  onPass,
  onHint,
  onSettings,
  disabled = false,
  canPlay = false,
  canPass = false,
  onThrowPress,
  isThrowCooldown = false,
  cooldownRemaining = 0,
  throwableActiveEffects,
  disconnectedPlayers = [false, false, false, false],
  disconnectTimerStartedAts,
  turnTimerStartedAts,
  onCountdownExpireds,
  playerIds = [],
  isLocalMicOn,
  onMicToggle,
  dropZoneState,
  onDragZoneChange,
  isCameraOns,
  isMicOns,
  isVideoChatConnectings,
  videoStreamSlots,
  showInGameAlert,
  turnClockOffsetMs = 0,
}: LandscapeGameLayoutProps) {
  // Friends context to check friendship status in-game
  const { friends } = useFriendsContext();

  const profilePhotoSize = useUserPreferencesStore(s => s.profilePhotoSize);
  const throwableClipSize = React.useMemo(() => {
    const scaleMap = { small: 0.85, medium: 1.0, large: 1.25 } as const;
    return Math.round(LAYOUT.avatarSize * (scaleMap[profilePhotoSize] ?? 1.0));
  }, [profilePhotoSize]);

  // Scoreboard expand/collapse state
  const [isScoreboardExpanded, setIsScoreboardExpanded] = React.useState(false);
  const [showPlayHistory, setShowPlayHistory] = React.useState(false);
  const [collapsedMatches, setCollapsedMatches] = React.useState<Set<number>>(new Set());

  // Toggle match collapse in play history
  const handleToggleMatch = (matchNumber: number) => {
    setCollapsedMatches(prev => {
      const newSet = new Set(prev);
      if (newSet.has(matchNumber)) {
        newSet.delete(matchNumber);
      } else {
        newSet.add(matchNumber);
      }
      return newSet;
    });
  };

  // Helper function to check if a player index is currently active
  // (scoreboard order is [user, top, left, right])
  const isOpponentActive = (index: number) => {
    return currentPlayerIndex === index;
  };

  const [opponentActionTarget, setOpponentActionTarget] = React.useState<{
    id: string;
    name: string;
  } | null>(null);

  /** Show a contextual action sheet when tapping an opponent's avatar */
  const handleOpponentAvatarPress = (displayIndex: number) => {
    const opponentId = playerIds[displayIndex];
    const opponentName = playerNames[displayIndex] ?? i18n.t('friends.unknownPlayer');
    if (!opponentId) return;
    if (showInGameAlert) {
      showInGameAlert({
        title: opponentName,
        message: i18n.t('friends.tapToSendFriendRequest'),
        buttons: [
          {
            text: i18n.t('friends.addFriend'),
            onPress: () => {
              setOpponentActionTarget({ id: opponentId, name: opponentName });
            },
          },
          { text: i18n.t('common.cancel'), style: 'cancel' },
        ],
      });
    } else {
      // Fallback: native Alert.alert with same confirmation buttons
      Alert.alert(opponentName, i18n.t('friends.tapToSendFriendRequest'), [
        {
          text: i18n.t('friends.addFriend'),
          onPress: () => {
            setOpponentActionTarget({ id: opponentId, name: opponentName });
          },
        },
        { text: i18n.t('common.cancel'), style: 'cancel' },
      ]);
    }
  };

  /** Handle long-press on opponent name: show Add Friend or Already Friends */
  const handleOpponentNameLongPress = (displayIndex: number) => {
    const opponentId = playerIds[displayIndex];
    const opponentName = playerNames[displayIndex] ?? i18n.t('friends.unknownPlayer');
    if (!opponentId) return;
    const isFriend = friends.some(f => f.friend.id === opponentId && f.status === 'accepted');
    if (isFriend) {
      if (showInGameAlert) {
        showInGameAlert({
          title: opponentName,
          message: i18n.t('friends.alreadyFriends'),
          buttons: [{ text: i18n.t('common.ok'), style: 'cancel' }],
        });
      } else {
        Alert.alert(opponentName, i18n.t('friends.alreadyFriends'));
      }
    } else {
      setOpponentActionTarget({ id: opponentId, name: opponentName });
    }
  };

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.container}>
      <View style={styles.contentContainer}>
        {/* Task #590: Match number pill - far left corner */}
        <View style={styles.matchNumberContainer}>
          <View style={scoreDisplayStyles.matchNumberBadge}>
            <Text style={scoreDisplayStyles.matchNumberText}>
              {isGameFinished
                ? i18n.t('game.gameOver')
                : `${i18n.t('gameEnd.match')} ${matchNumber}`}
            </Text>
          </View>
        </View>

        {/* Task #590: Score action buttons - below Match N pill */}
        <View style={styles.scoreActionContainer}>
          <TouchableOpacity
            style={scoreDisplayStyles.scoreActionButton}
            onPress={() => setShowPlayHistory(prev => !prev)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="View play history"
            accessibilityHint="Opens the list of plays for this match"
          >
            <Text style={scoreDisplayStyles.scoreActionButtonText}>📜</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={scoreDisplayStyles.scoreActionButton}
            onPress={() => setIsScoreboardExpanded(prev => !prev)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Toggle scoreboard"
            accessibilityHint="Expands or collapses the scoreboard"
          >
            <Text style={scoreDisplayStyles.scoreActionButtonText}>▶</Text>
          </TouchableOpacity>
          {/* Task #648: chat toggle — rendered next to the expand button in
               landscape so it never overlaps the menu icon (top-right corner) */}
          {isMultiplayer && onChatToggle && (
            <View style={{ position: 'relative' }}>
              <TouchableOpacity
                style={[
                  scoreDisplayStyles.scoreActionButton,
                  isChatOpen && { backgroundColor: 'rgba(74,144,226,0.4)' },
                ]}
                onPress={onChatToggle}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={i18n.t('chat.a11yToggleLabel')}
                accessibilityHint={i18n.t('chat.a11yToggleHint')}
              >
                <Text style={scoreDisplayStyles.scoreActionButtonText}>💬</Text>
              </TouchableOpacity>
              {chatUnreadCount > 0 && !isChatOpen && (
                <View
                  style={{
                    position: 'absolute',
                    top: -4,
                    right: -4,
                    backgroundColor: '#F44336',
                    borderRadius: 10,
                    minWidth: 18,
                    height: 18,
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingHorizontal: 4,
                  }}
                >
                  <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>
                    {chatUnreadCount > 99 ? '99+' : chatUnreadCount}
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>

        {/* Scoreboard - expanded only (Task #590: collapsed removed) */}
        <View style={styles.scoreboardContainer}>
          <LandscapeScoreboard
            playerNames={playerNames}
            originalPlayerNames={originalPlayerNames}
            currentScores={currentScores}
            cardCounts={cardCounts}
            currentPlayerIndex={currentPlayerIndex}
            matchNumber={matchNumber}
            isGameFinished={isGameFinished}
            isExpanded={isScoreboardExpanded}
            onToggleExpand={() => {
              setIsScoreboardExpanded(!isScoreboardExpanded);
            }}
            onTogglePlayHistory={() => {
              setShowPlayHistory(!showPlayHistory);
            }}
            scoreHistory={scoreHistory}
            playHistory={playHistory}
          />
        </View>

        {/* Play History Modal (same as portrait) */}
        {showPlayHistory && (
          <PlayHistoryModal
            visible={showPlayHistory}
            onClose={() => setShowPlayHistory(false)}
            playerNames={originalPlayerNames || []}
            playHistory={playHistory}
            currentMatch={matchNumber}
            collapsedMatches={collapsedMatches}
            onToggleMatch={handleToggleMatch}
          />
        )}

        {/* Top opponent - Player at index 1 (opposite player, +2 positions clockwise) */}
        <View style={styles.topOpponent}>
          <LandscapeOpponent
            name={playerNames[1] || 'Opponent 1'}
            cardCount={cardCounts[1] || 0}
            isActive={isOpponentActive(1)}
            layout="horizontal"
            totalScore={totalScores[1]}
            isBot={!playerIds[1]}
            isDisconnected={disconnectedPlayers[1]}
            disconnectTimerStartedAt={disconnectTimerStartedAts?.[1]}
            turnTimerStartedAt={turnTimerStartedAts?.[1]}
            onCountdownExpired={onCountdownExpireds?.[1]}
            onAvatarPress={playerIds[1] ? () => handleOpponentAvatarPress(1) : undefined}
            onNameLongPress={playerIds[1] ? () => handleOpponentNameLongPress(1) : undefined}
            isCameraOn={isCameraOns?.[1]}
            isMicOn={isMicOns?.[1]}
            isVideoChatConnecting={isVideoChatConnectings?.[1]}
            videoStreamSlot={videoStreamSlots?.[1]}
            clockOffsetMs={turnClockOffsetMs}
          />
          {throwableActiveEffects?.[1] != null && (
            <View
              pointerEvents="none"
              style={[
                styles.throwableClip,
                {
                  width: throwableClipSize,
                  height: throwableClipSize,
                  borderRadius: throwableClipSize / 2,
                  left: 0,
                  alignSelf: 'auto',
                },
              ]}
            >
              <ThrowablePlayerEffect
                key={throwableActiveEffects[1]!.id}
                throwable={throwableActiveEffects[1]!.throwable}
              />
            </View>
          )}
        </View>

        {/* Left opponent - Player at index 2 (left player, +3 positions = 1 counterclockwise) */}
        <View style={styles.leftOpponent}>
          <LandscapeOpponent
            name={playerNames[2] || 'Opponent 2'}
            cardCount={cardCounts[2] || 0}
            isActive={isOpponentActive(2)}
            totalScore={totalScores[2]}
            isBot={!playerIds[2]}
            isDisconnected={disconnectedPlayers[2]}
            disconnectTimerStartedAt={disconnectTimerStartedAts?.[2]}
            turnTimerStartedAt={turnTimerStartedAts?.[2]}
            onCountdownExpired={onCountdownExpireds?.[2]}
            onAvatarPress={playerIds[2] ? () => handleOpponentAvatarPress(2) : undefined}
            onNameLongPress={playerIds[2] ? () => handleOpponentNameLongPress(2) : undefined}
            isCameraOn={isCameraOns?.[2]}
            isMicOn={isMicOns?.[2]}
            isVideoChatConnecting={isVideoChatConnectings?.[2]}
            videoStreamSlot={videoStreamSlots?.[2]}
            clockOffsetMs={turnClockOffsetMs}
          />
          {throwableActiveEffects?.[2] != null && (
            <View
              pointerEvents="none"
              style={[
                styles.throwableClip,
                {
                  width: throwableClipSize,
                  height: throwableClipSize,
                  borderRadius: throwableClipSize / 2,
                },
              ]}
            >
              <ThrowablePlayerEffect
                key={throwableActiveEffects[2]!.id}
                throwable={throwableActiveEffects[2]!.throwable}
              />
            </View>
          )}
        </View>

        {/* Right opponent - Player at index 3 (right player, +1 position clockwise) */}
        <View style={styles.rightOpponent}>
          <LandscapeOpponent
            name={playerNames[3] || 'Opponent 3'}
            cardCount={cardCounts[3] || 0}
            isActive={isOpponentActive(3)}
            totalScore={totalScores[3]}
            isBot={!playerIds[3]}
            isDisconnected={disconnectedPlayers[3]}
            disconnectTimerStartedAt={disconnectTimerStartedAts?.[3]}
            turnTimerStartedAt={turnTimerStartedAts?.[3]}
            onCountdownExpired={onCountdownExpireds?.[3]}
            onAvatarPress={playerIds[3] ? () => handleOpponentAvatarPress(3) : undefined}
            onNameLongPress={playerIds[3] ? () => handleOpponentNameLongPress(3) : undefined}
            isCameraOn={isCameraOns?.[3]}
            isMicOn={isMicOns?.[3]}
            isVideoChatConnecting={isVideoChatConnectings?.[3]}
            videoStreamSlot={videoStreamSlots?.[3]}
            clockOffsetMs={turnClockOffsetMs}
          />
          {throwableActiveEffects?.[3] != null && (
            <View
              pointerEvents="none"
              style={[
                styles.throwableClip,
                {
                  width: throwableClipSize,
                  height: throwableClipSize,
                  borderRadius: throwableClipSize / 2,
                },
              ]}
            >
              <ThrowablePlayerEffect
                key={throwableActiveEffects[3]!.id}
                throwable={throwableActiveEffects[3]!.throwable}
              />
            </View>
          )}
        </View>

        {/* Inline Add Friend overlay — shown after avatar tap */}
        {opponentActionTarget && (
          <View style={gameScreenStyles.friendActionOverlay} pointerEvents="auto">
            <View style={gameScreenStyles.friendActionCard}>
              <Text style={gameScreenStyles.friendActionName} numberOfLines={1}>
                {opponentActionTarget.name}
              </Text>
              <AddFriendButton targetUserId={opponentActionTarget.id} compact />
              <TouchableOpacity
                style={gameScreenStyles.friendActionClose}
                onPress={() => setOpponentActionTarget(null)}
              >
                <Text style={gameScreenStyles.friendActionCloseText}>✕</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Top-right buttons: Rotation & Settings (SWITCHED ORDER) */}
        <View style={styles.topRightButtons}>
          <Pressable
            style={styles.actionButton}
            onPress={onOrientationToggle}
            accessibilityLabel="Toggle orientation"
            accessibilityRole="button"
          >
            <Text style={styles.actionButtonText}>🔄</Text>
          </Pressable>
          <Pressable
            style={styles.actionButton}
            onPress={onSettings}
            accessibilityLabel="Settings"
            accessibilityRole="button"
            testID="settings-button"
          >
            {/* Hamburger menu (3 lines like portrait) */}
            <View style={styles.hamburgerMenu}>
              <View style={styles.hamburgerLine} />
              <View style={styles.hamburgerLine} />
              <View style={styles.hamburgerLine} />
            </View>
          </Pressable>
        </View>

        {/* Main game area - center */}
        <View style={styles.mainArea}>
          {/* Oval table with last played cards */}
          <LandscapeOvalTable
            lastPlayed={lastPlayedCards ?? null}
            lastPlayedBy={lastPlayedBy ?? null}
            combinationType={lastPlayComboType ?? null}
            comboDisplayText={lastPlayCombo ?? undefined}
            dropZoneState={dropZoneState}
          />

          {/* Auto-Pass Timer Display (OVERLAY on table) */}
          {autoPassTimerState && (
            <View style={styles.timerOverlay}>
              <AutoPassTimer
                timerState={autoPassTimerState}
                currentPlayerIndex={0}
                clockOffsetMs={turnClockOffsetMs}
              />
            </View>
          )}
        </View>

        {/* Player (bottom-left) - same design as Bot 2 */}
        <View style={styles.bottomPlayerContainer}>
          <LandscapeOpponent
            name={playerName}
            cardCount={playerCardCount}
            isActive={isPlayerActive}
            layout="vertical"
            totalScore={totalScores[0]}
            isDisconnected={disconnectedPlayers[0]}
            disconnectTimerStartedAt={disconnectTimerStartedAts?.[0]}
            turnTimerStartedAt={turnTimerStartedAts?.[0]}
            onCountdownExpired={onCountdownExpireds?.[0]}
            isMicOn={isLocalMicOn}
            onMicToggle={onMicToggle}
            isCameraOn={isCameraOns?.[0]}
            isVideoChatConnecting={isVideoChatConnectings?.[0]}
            videoStreamSlot={videoStreamSlots?.[0]}
            clockOffsetMs={turnClockOffsetMs}
          />
          {throwableActiveEffects?.[0] != null && (
            <ThrowablePlayerEffect
              key={throwableActiveEffects[0]!.id}
              throwable={throwableActiveEffects[0]!.throwable}
            />
          )}
        </View>

        {/* Action buttons - RIGHT SIDE (2-row layout) */}
        <View style={styles.actionButtonsContainer}>
          {/* German mode: ThrowButton above the button grid to avoid overlapping Hinweis */}
          {onThrowPress != null && i18n.getLanguage() === 'de' && (
            <View style={styles.throwButtonRowAbove}>
              <ThrowButton
                onPress={onThrowPress}
                isThrowCooldown={isThrowCooldown}
                cooldownRemaining={cooldownRemaining}
              />
            </View>
          )}
          {/* Top row: Play + Smart (+ Throw for non-German) */}
          <View style={styles.buttonRow}>
            <Pressable
              style={[styles.playButton, (!canPlay || disabled) && { opacity: 0.5 }]}
              onPress={onPlay}
              disabled={!canPlay || disabled}
              accessibilityLabel="Play cards"
              accessibilityRole="button"
            >
              <Text style={styles.playButtonText}>{i18n.t('game.play')}</Text>
            </Pressable>
            <Pressable
              style={[styles.smartButton, disabled && { opacity: 0.5 }]}
              onPress={onSmartSort}
              disabled={disabled}
              accessibilityLabel="Smart sort"
              accessibilityRole="button"
            >
              <Text style={styles.smartButtonText}>{i18n.t('game.smart')}</Text>
            </Pressable>
            {onThrowPress != null && i18n.getLanguage() !== 'de' && (
              <ThrowButton
                onPress={onThrowPress}
                isThrowCooldown={isThrowCooldown}
                cooldownRemaining={cooldownRemaining}
              />
            )}
          </View>

          {/* Bottom row: Pass + Sort + Hint */}
          <View style={styles.buttonRow}>
            <Pressable
              style={[styles.passButton, (!canPass || disabled) && { opacity: 0.5 }]}
              onPress={onPass}
              disabled={!canPass || disabled}
              accessibilityLabel="Pass turn"
              accessibilityRole="button"
            >
              <Text style={styles.passButtonText}>{i18n.t('game.pass')}</Text>
            </Pressable>
            <Pressable
              style={[styles.sortButton, disabled && { opacity: 0.5 }]}
              onPress={onSort}
              disabled={disabled}
              accessibilityLabel="Sort cards"
              accessibilityRole="button"
            >
              <Text
                style={[
                  styles.sortButtonText,
                  i18n.getLanguage() === 'de' && styles.sortButtonTextGerman,
                ]}
              >
                {i18n.t('game.sort')}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.hintButton, disabled && { opacity: 0.5 }]}
              onPress={onHint}
              disabled={disabled}
              accessibilityLabel="Get hint"
              accessibilityRole="button"
            >
              <Text style={styles.hintButtonText}>{i18n.t('game.hint')}</Text>
            </Pressable>
          </View>
        </View>

        {/* Your position - BOTTOM OF SCREEN */}
        <View style={styles.yourPosition}>
          <LandscapeYourPosition
            playerName={playerName}
            cards={playerCards}
            isActive={isPlayerActive}
            selectedCardIds={selectedCardIds}
            onSelectionChange={onSelectionChange}
            onPlayCards={onPlayCardsCallback}
            onCardsReorder={onCardsReorder}
            onDragZoneChange={onDragZoneChange}
          />
        </View>
      </View>
    </SafeAreaView>
  );
});

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#25292e', // Matches portrait COLORS.primary
  },
  contentContainer: {
    flex: 1,
    position: 'relative',
  },
  scoreboardContainer: {
    position: 'absolute',
    top: 0,
    left: -30,
    zIndex: 10,
  },
  // Task #590: Match number pill — landscape override
  // Landscape uses fixed top/left because SafeAreaView already handles insets at the edges.
  // Portrait uses POSITIONING.menuTop via scoreDisplayStyles to account for the status bar
  // (no SafeAreaView wrapper there). The values intentionally differ between orientations.
  matchNumberContainer: {
    position: 'absolute',
    top: 8,
    left: 8,
    zIndex: 150,
  },
  // Task #590: Score action buttons — landscape override
  scoreActionContainer: {
    position: 'absolute',
    top: 46,
    left: 8,
    flexDirection: 'row',
    gap: 8,
    zIndex: 150,
  },

  // Opponent positions around table
  topOpponent: {
    position: 'absolute',
    top: 8,
    left: '50%',
    transform: [{ translateX: -40 }], // Center horizontally
    zIndex: 5,
  },
  leftOpponent: {
    position: 'absolute',
    left: 60, // Move CLOSER TO TABLE (away from scoreboard)
    top: '50%',
    transform: [{ translateY: -80 }], // Raised further to prevent Steve's photo overlapping bot name
    zIndex: 5,
  },
  rightOpponent: {
    position: 'absolute',
    right: 60,
    top: '50%',
    transform: [{ translateY: -80 }], // Raised to match left opponent
    zIndex: 5,
  },

  throwableClip: {
    width: 70,
    height: 70,
    borderRadius: 35,
    position: 'absolute',
    top: 0,
    alignSelf: 'center',
  },

  mainArea: {
    position: 'absolute',
    top: '18%', // Raised to touch bottom of top player's avatar circle
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 3,
  },

  timerOverlay: {
    position: 'absolute', // Overlay on table (don't push layout)
    top: 20, // MIDDLE OF SCREEN (was -80, under Bot 1)
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 100, // Above table
  },

  yourPosition: {
    position: 'absolute',
    bottom: 8,
    left: 130, // Leave space for Steve Peterson in FAR LEFT
    right: 150, // Leave space for Play/Pass + helper buttons on right
    zIndex: 100, // CRITICAL: Must be higher than buttons (60) to allow drag/drop
  },

  topRightButtons: {
    position: 'absolute',
    top: 8,
    right: 8,
    flexDirection: 'row',
    gap: 8,
    zIndex: 100,
  },

  actionButton: {
    width: 44, // EXACT same as helperButton
    height: 44, // EXACT same as helperButton
    borderRadius: 8, // EXACT same as helperButton
    backgroundColor: 'rgba(255, 255, 255, 0.1)', // EXACT same as helperButton
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)', // EXACT same as helperButton
    alignItems: 'center',
    justifyContent: 'center',
  },

  actionButtonText: {
    fontSize: 16,
  },

  hamburgerMenu: {
    width: 18,
    height: 14,
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  hamburgerLine: {
    width: 18,
    height: 2,
    backgroundColor: '#ffffff',
    borderRadius: 1,
  },

  bottomPlayerContainer: {
    position: 'absolute',
    bottom: 20, // Move WAY UP (closer to table, avoid cards)
    left: -30, // FAR BOTTOM LEFT CORNER
    zIndex: 60,
  },

  actionButtonsContainer: {
    position: 'absolute',
    bottom: 12,
    right: -24,
    flexDirection: 'column',
    gap: 6,
    zIndex: 60,
    pointerEvents: 'box-none', // CRITICAL: Allow touches to pass through container but buttons receive touches
  },

  buttonRow: {
    flexDirection: 'row',
    gap: 6,
    pointerEvents: 'box-none', // IMPORTANT: Allow button touches while maintaining gesture handling
  },

  /** German-mode only: holds the ThrowButton above the two action button rows */
  throwButtonRowAbove: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 4,
    pointerEvents: 'box-none',
  },

  // Play button (Green)
  playButton: {
    width: 60,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#10b981',
    alignItems: 'center',
    justifyContent: 'center',
  },

  playButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 'bold',
  },

  // Smart button (Teal/Cyan)
  smartButton: {
    width: 70,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#0891b2',
    alignItems: 'center',
    justifyContent: 'center',
  },

  smartButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 'bold',
  },

  // Pass button (Gray)
  passButton: {
    width: 60,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#374151',
    borderWidth: 1,
    borderColor: '#6b7280',
    alignItems: 'center',
    justifyContent: 'center',
  },

  passButtonText: {
    color: '#D1D5DB',
    fontSize: 13,
    fontWeight: 'bold',
  },

  // Sort button (Gray) - WIDER for German 'Sortieren'
  sortButton: {
    width: 85, // Increased from 55 to fit 'Sortieren'
    height: 40,
    borderRadius: 12,
    backgroundColor: '#374151',
    borderWidth: 1,
    borderColor: '#6b7280',
    alignItems: 'center',
    justifyContent: 'center',
  },

  sortButtonText: {
    color: '#D1D5DB',
    fontSize: 13, // Default size for English/Arabic
    fontWeight: 'bold',
  },

  sortButtonTextGerman: {
    fontSize: 11, // Smaller size for German 'Sortieren'
  },

  // Hint button (Orange)
  hintButton: {
    width: 55,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#f59e0b',
    alignItems: 'center',
    justifyContent: 'center',
  },

  hintButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 'bold',
  },
});
