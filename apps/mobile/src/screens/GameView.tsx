/**
 * GameView - Shared presentation component for both Local AI and Multiplayer game modes.
 * Contains all JSX rendering (portrait, landscape, modals) with no game-mode-specific logic.
 * Created as part of Task #570: Split GameScreen component.
 *
 * H4 Audit fix (Task #638): all game-view state is now consumed from GameContext via
 * useGameContext() instead of being threaded as 50+ individual props. Parent screens
 * (MultiplayerGame, LocalAIGame) provide the context via <GameContextProvider>.
 */
import React, { Profiler, useMemo, useCallback, useState, useRef, useEffect } from 'react';
import { View, Text, Pressable, TouchableOpacity, ActivityIndicator, Animated } from 'react-native';
import {
  CardHand,
  PlayerInfo,
  GameSettingsModal,
  HelperButtons,
  GameControls,
  GameLayout,
  LiveKitVideoSlot,
  ChatDrawer,
  ThrowablePicker,
  PlayerTargetPicker,
  ThrowableReceiverModal,
  ThrowButton,
  ThrowablePlayerEffect,
} from '../components/game';
import type { ThrowableType } from '../types/multiplayer';
import { GameEndModal, GameEndErrorBoundary } from '../components/gameEnd';
import { LandscapeGameLayout } from '../components/gameRoom/LandscapeGameLayout';
import { ConnectionStatusIndicator } from '../components/ConnectionStatusIndicator';
import { ScoreboardContainer } from '../components/scoreboard';
import { i18n } from '../i18n';
import { scoreDisplayStyles } from '../styles/scoreDisplayStyles';
import { gameScreenStyles as styles } from '../styles/gameScreenStyles';
import { performanceMonitor } from '../utils';
import { gameLogger } from '../utils/logger';
import { isExpectedTurnRaceError } from '../utils/edgeFunctionErrors';
import type { Card } from '../game/types';
import type { DragZoneState } from '../components/game';
import { useGameContext } from '../contexts/GameContext';
import { useFriendsContext } from '../contexts/FriendsContext';
import { AddFriendButton } from '../components/friends';
import { useUserPreferencesStore } from '../store';
import { LAYOUT } from '../constants';

function GameViewComponent() {
  const profilePhotoSize = useUserPreferencesStore(s => s.profilePhotoSize);
  const throwableClipSize = useMemo(() => {
    const scaleMap = { small: 0.85, medium: 1.0, large: 1.25 } as const;

    return Math.round(LAYOUT.avatarSize * (scaleMap[profilePhotoSize] ?? 1.0));
  }, [profilePhotoSize]);

  const {
    isLocalAIGame,
    currentOrientation,
    toggleOrientation,
    isInitializing,
    isConnected,
    showSettings,
    setShowSettings,
    roomCode,
    effectivePlayerHand,

    selectedCardIds,
    setSelectedCardIds,
    handleCardsReorder,
    selectedCards,
    customCardOrder,
    setCustomCardOrder,
    effectiveLastPlayedCards,
    effectiveLastPlayedBy,
    effectiveLastPlayComboType,
    effectiveLastPlayCombo,
    layoutPlayers,
    layoutPlayersWithScores,
    playerTotalScores,
    currentPlayerName,
    togglePlayHistory,
    toggleScoreboardExpanded,
    memoizedPlayerNames,
    memoizedCurrentScores,
    memoizedCardCounts,
    memoizedOriginalPlayerNames,
    effectiveAutoPassTimerState,
    effectiveScoreboardCurrentPlayerIndex,
    matchNumber,
    isGameFinished,
    displayOrderScoreHistory,
    playHistoryByMatch,
    handlePlayCards,
    handlePass,
    handlePlaySuccess,
    handlePassSuccess,
    handleCardHandPlayCards,
    handleCardHandPass,
    handleLeaveGame,
    handleSort,
    handleSmartSort,
    handleHint,
    isPlayerReady,
    gameManagerRef,
    isMountedRef,
    // Task #651 / #649 video + voice chat
    isChatConnected,
    isLocalCameraOn,
    isLocalMicOn,
    remoteCameraStates,
    remoteMicStates,
    toggleVideoChat,
    toggleCamera,
    toggleVoiceChat,
    toggleMic,
    isVideoChatConnecting,
    isAudioConnecting,
    getVideoTrackRef,
    remotePlayerIds,
    // Task #648: in-game text chat
    chatMessages,
    sendChatMessage,
    chatUnreadCount,
    isChatCooldown,
    isChatDrawerOpen,
    toggleChatDrawer,
    localUserId,
    // Throwables
    throwableActiveEffects,
    throwableIncoming,
    throwableDismissIncoming,
    sendThrowable,
    isThrowCooldown,
    cooldownRemaining,
    showInGameAlert,
    turnClockOffsetMs,
  } = useGameContext();

  const isMultiplayerGame = !isLocalAIGame;

  // Task #652: Track drag zone state for table perimeter glow
  const [dropZoneState, setDropZoneState] = useState<DragZoneState>('idle');

  // Throwables: two-step selection flow (pick type → pick target)
  const [showThrowablePicker, setShowThrowablePicker] = useState(false);
  const [pendingThrowableType, setPendingThrowableType] = useState<ThrowableType | null>(null);

  // Portrait mode: Add-friend action target (set when long-pressing an opponent name)
  const { friends } = useFriendsContext();
  const [portraitActionTarget, setPortraitActionTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const handlePortraitOpponentNameLongPress = useCallback(
    (displayIndex: number) => {
      const opponentId = remotePlayerIds[displayIndex - 1];
      const opponentName =
        layoutPlayersWithScores[displayIndex]?.name ?? i18n.t('friends.unknownPlayer');
      if (!opponentId) return;
      const isFriend = friends.some(f => f.friend.id === opponentId && f.status === 'accepted');
      if (isFriend) {
        showInGameAlert({
          title: opponentName,
          message: i18n.t('friends.alreadyFriends'),
          buttons: [{ text: i18n.t('common.ok'), style: 'cancel' }],
        });
      } else {
        setPortraitActionTarget({ id: opponentId, name: opponentName });
      }
    },
    [remotePlayerIds, layoutPlayersWithScores, friends, showInGameAlert]
  );

  // Drag hint pulse animation — only running when the hint is actually visible
  // (avoids keeping an Animated.loop alive for the entire game view lifetime).
  const hintPulse = useRef(new Animated.Value(0.4)).current;
  const isHintVisible = dropZoneState === 'idle' && selectedCardIds.size > 0 && isPlayerReady;

  // Track if the game has EVER been initialized (isInitializing flipped false at least once).
  // This keeps GameEndModal mounted even when complete-game deletes room_players and
  // causes isInitializing to flip back to true, which would otherwise unmount the modal.
  const [hasGameEverInitialized, setHasGameEverInitialized] = useState(false);
  useEffect(() => {
    if (!isInitializing) {
      setHasGameEverInitialized(true);
    }
  }, [isInitializing]);
  useEffect(() => {
    if (!isHintVisible) {
      return;
    }
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(hintPulse, { toValue: 0.7, duration: 1500, useNativeDriver: true }),
        Animated.timing(hintPulse, { toValue: 0.4, duration: 1500, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [isHintVisible, hintPulse]);

  // Step 1: Memoize the stable per-player boolean state so that unrelated renders
  // (e.g. timer ticks) do not cause unnecessary GameLayout / PlayerInfo re-renders.
  // videoStreamSlot is intentionally NOT computed here — see step 2 below.
  // (Copilot PR-146 r2939676099 — avoid allocating a new array on every render.)
  const enrichedBaseData = useMemo(
    () =>
      layoutPlayersWithScores.map((p, idx) => {
        if (idx === 0) return p; // local player rendered separately below
        // `idx` is the display-position index (1=top, 2=left, 3=right);
        // `p.player_index` is the underlying game-seat index (not display order).
        // remotePlayerIds[idx-1] is the userId for display position idx,
        // computed in MultiplayerGame by matching seat indices into effectiveMultiplayerPlayers.
        const remoteParticipantId = remotePlayerIds[idx - 1] || undefined;
        const cameraState = remoteParticipantId
          ? remoteCameraStates[remoteParticipantId]
          : undefined;
        const micState = remoteParticipantId ? remoteMicStates[remoteParticipantId] : undefined;
        return {
          ...p,
          isCameraOn: isMultiplayerGame && isChatConnected ? cameraState?.isCameraOn : undefined,
          isMicOn: isMultiplayerGame && isChatConnected ? micState?.isMicOn : undefined,
          // isVideoChatConnecting is intentionally omitted for remote players:
          // PlayerInfo ignores it for non-local participants. When remote-player
          // connecting state becomes user-visible, pass it here and update PlayerInfo.
        };
      }),
    [
      layoutPlayersWithScores,
      remotePlayerIds,
      remoteCameraStates,
      remoteMicStates,
      isMultiplayerGame,
      isChatConnected,
    ]
  );

  // Step 2: Memoize video stream slot injection so timer ticks and other
  // unrelated renders do not allocate a new players array on every frame
  // (Copilot PR-146 r2943651654). Fresh TrackReferences are still obtained
  // on each recompute because:
  //   • enrichedBaseData (dep) recomputes whenever remoteParticipants changes
  //     (via remoteCameraStates → participants chain), so re-publish events
  //     naturally propagate through the chain and trigger a recompute here.
  //   • getVideoTrackRef is stable (useCallback[adapterProp]) and only
  //     changes when the adapter is hot-swapped.
  const enrichedRemotePlayers = useMemo(
    () =>
      enrichedBaseData.map((p, idx) => {
        if (idx === 0) return p;
        const remoteParticipantId = remotePlayerIds[idx - 1] || undefined;
        const trackRef =
          isMultiplayerGame &&
          isChatConnected &&
          (p as { isCameraOn?: boolean }).isCameraOn &&
          remoteParticipantId
            ? getVideoTrackRef(remoteParticipantId)
            : undefined;
        return {
          ...p,
          videoStreamSlot: trackRef ? (
            <LiveKitVideoSlot trackRef={trackRef} mirror={false} zOrder={0} />
          ) : undefined,
        };
      }),
    [enrichedBaseData, remotePlayerIds, isChatConnected, isMultiplayerGame, getVideoTrackRef]
  );

  // Step 3: Precompute local player video slot so it is not re-created on every
  // render via an inline IIFE in JSX (Copilot PR-149 r2946299470).
  const localVideoSlot = useMemo(() => {
    if (!(isMultiplayerGame && isChatConnected && isLocalCameraOn)) return undefined;
    const localRef = getVideoTrackRef('__local__');
    return localRef ? <LiveKitVideoSlot trackRef={localRef} mirror={true} zOrder={1} /> : undefined;
  }, [isMultiplayerGame, isChatConnected, isLocalCameraOn, getVideoTrackRef]);

  // Stable close-settings callback — avoids recreating an inline arrow on every
  // render (which would break React.memo on GameSettingsModal). Task #628.
  const closeSettings = useCallback(() => setShowSettings(false), [setShowSettings]);

  // Performance profiling callback (Task #430)
  // useCallback with empty deps: same identity across all re-renders, no new
  // allocation on updates. The callback itself is stateless (reads no closure
  // values from the component) so this is always safe.
  const onRenderCallback = useCallback<React.ProfilerOnRenderCallback>(
    (id, phase, actualDuration, baseDuration, startTime, commitTime) => {
      performanceMonitor.logRender(
        id,
        phase,
        actualDuration,
        baseDuration,
        startTime,
        commitTime,
        new Set()
      );
    },
    []
  );

  return (
    <Profiler id="GameScreen" onRender={onRenderCallback}>
      <View style={[styles.container, { direction: 'ltr' }]}>
        {/* Spectator Mode Banner - Placeholder for future integration */}
        {false && (
          <View style={styles.spectatorBanner}>
            <Text style={styles.spectatorEmoji}>👁️</Text>
            <View style={styles.spectatorTextContainer}>
              <Text style={styles.spectatorTitle}>{i18n.t('game.spectatorMode')}</Text>
              <Text style={styles.spectatorDescription}>{i18n.t('game.spectatorDescription')}</Text>
            </View>
          </View>
        )}

        {/* Task #575: Connection status indicator for multiplayer */}
        {isMultiplayerGame && (
          <ConnectionStatusIndicator
            status={isConnected ? 'connected' : 'reconnecting'}
            style={{ position: 'absolute', top: 50, alignSelf: 'center', zIndex: 200 }}
          />
        )}

        {isInitializing ? (
          // Loading state
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#fff" style={{ marginBottom: 12 }} />
            <Text style={styles.loadingText}>{i18n.t('game.initializingGame')}</Text>
            <Text style={styles.loadingSubtext}>{i18n.t('game.settingUpEngine')}</Text>
          </View>
        ) : currentOrientation === 'landscape' ? (
          // LANDSCAPE MODE (Task #450)
          <LandscapeGameLayout
            playerNames={memoizedPlayerNames}
            currentScores={memoizedCurrentScores}
            cardCounts={memoizedCardCounts}
            currentPlayerIndex={effectiveScoreboardCurrentPlayerIndex}
            matchNumber={matchNumber}
            isGameFinished={isGameFinished}
            scoreHistory={displayOrderScoreHistory}
            playHistory={playHistoryByMatch}
            originalPlayerNames={memoizedOriginalPlayerNames}
            autoPassTimerState={effectiveAutoPassTimerState}
            totalScores={playerTotalScores}
            disconnectedPlayers={layoutPlayersWithScores.map(p => p.isDisconnected ?? false)}
            disconnectTimerStartedAts={layoutPlayersWithScores.map(
              p => p.disconnectTimerStartedAt ?? null
            )}
            turnTimerStartedAts={layoutPlayersWithScores.map(p => p.turnTimerStartedAt ?? null)}
            onCountdownExpireds={layoutPlayersWithScores.map(p => p.onCountdownExpired)}
            turnClockOffsetMs={turnClockOffsetMs}
            // Table data
            lastPlayedCards={effectiveLastPlayedCards}
            lastPlayedBy={effectiveLastPlayedBy ?? undefined}
            lastPlayComboType={effectiveLastPlayComboType ?? undefined}
            lastPlayCombo={effectiveLastPlayCombo ?? undefined}
            // Player data
            playerName={layoutPlayers[0]?.name ?? currentPlayerName}
            playerCardCount={layoutPlayers[0]?.cardCount ?? effectivePlayerHand.length}
            playerCards={effectivePlayerHand}
            isPlayerActive={layoutPlayers[0]?.isActive ?? false}
            selectedCardIds={selectedCardIds}
            onSelectionChange={setSelectedCardIds}
            onCardsReorder={handleCardsReorder}
            // Drag-to-play callback — uses handleCardHandPlayCards (not handlePlayCards directly)
            // so play_method is correctly set to 'drag' in analytics before the play is processed.
            onPlayCards={(cards: Card[]) => {
              gameLogger.info('🎴 [Landscape] Drag-to-play triggered with cards:', cards.length);
              handleCardHandPlayCards(cards);
            }}
            // Control callbacks
            onOrientationToggle={toggleOrientation}
            onHelp={() => gameLogger.info('Help requested')}
            onSort={handleSort}
            onSmartSort={handleSmartSort}
            onPlay={async () => {
              gameLogger.info(
                '🎴 [Landscape] Play button pressed with selected cards:',
                selectedCards.length
              );
              try {
                await handlePlayCards(selectedCards);
              } catch (error) {
                const errMsg = error instanceof Error ? error.message : String(error);
                const isExpectedRace = isExpectedTurnRaceError(errMsg);
                const logFn = isExpectedRace
                  ? gameLogger.warn.bind(gameLogger)
                  : gameLogger.error.bind(gameLogger);
                logFn('❌ [Landscape] Play button failed to play cards', errMsg);
                if (typeof __DEV__ !== 'undefined' && __DEV__) {
                  gameLogger.debug('❌ [Landscape] Play button error details:', { error });
                }
              }
            }}
            onPass={async () => {
              gameLogger.info('🎴 [Landscape] Pass button pressed');
              try {
                await handlePass();
              } catch (error) {
                const errMsg = error instanceof Error ? error.message : String(error);
                const isExpectedRace = isExpectedTurnRaceError(errMsg);
                const logFn = isExpectedRace
                  ? gameLogger.warn.bind(gameLogger)
                  : gameLogger.error.bind(gameLogger);
                logFn('❌ [Landscape] Pass action failed', errMsg);
                if (typeof __DEV__ !== 'undefined' && __DEV__) {
                  gameLogger.debug('❌ [Landscape] Pass action error details:', { error });
                }
              }
            }}
            onHint={handleHint}
            onSettings={() => setShowSettings(true)}
            // Control states
            disabled={false}
            canPlay={isPlayerReady && selectedCards.length > 0}
            canPass={isPlayerReady}
            // Chat (multiplayer only) — button placed in scoreActionContainer
            // next to the ▶ expand button so it never overlaps the menu icon.
            isMultiplayer={isMultiplayerGame}
            onChatToggle={isMultiplayerGame ? toggleChatDrawer : undefined}
            isChatOpen={isChatDrawerOpen}
            chatUnreadCount={chatUnreadCount}
            playerIds={isMultiplayerGame ? [localUserId, ...remotePlayerIds] : undefined}
            // Throwables (multiplayer only) — ThrowButton right of Smart button
            onThrowPress={isMultiplayerGame ? () => setShowThrowablePicker(true) : undefined}
            isThrowCooldown={isThrowCooldown}
            cooldownRemaining={cooldownRemaining}
            throwableActiveEffects={throwableActiveEffects}
            isLocalMicOn={isMultiplayerGame && isChatConnected ? isLocalMicOn : undefined}
            onMicToggle={isMultiplayerGame ? toggleMic : undefined}
            dropZoneState={dropZoneState}
            onDragZoneChange={setDropZoneState}
            isCameraOns={
              isMultiplayerGame && isChatConnected
                ? [
                    isLocalCameraOn,
                    (enrichedRemotePlayers[1] as { isCameraOn?: boolean })?.isCameraOn ?? false,
                    (enrichedRemotePlayers[2] as { isCameraOn?: boolean })?.isCameraOn ?? false,
                    (enrichedRemotePlayers[3] as { isCameraOn?: boolean })?.isCameraOn ?? false,
                  ]
                : undefined
            }
            isMicOns={
              isMultiplayerGame && isChatConnected
                ? [
                    isLocalMicOn,
                    (enrichedRemotePlayers[1] as { isMicOn?: boolean })?.isMicOn ?? false,
                    (enrichedRemotePlayers[2] as { isMicOn?: boolean })?.isMicOn ?? false,
                    (enrichedRemotePlayers[3] as { isMicOn?: boolean })?.isMicOn ?? false,
                  ]
                : undefined
            }
            isVideoChatConnectings={
              isMultiplayerGame ? [isVideoChatConnecting, false, false, false] : undefined
            }
            videoStreamSlots={[
              localVideoSlot,
              (enrichedRemotePlayers[1] as { videoStreamSlot?: React.ReactNode })?.videoStreamSlot,
              (enrichedRemotePlayers[2] as { videoStreamSlot?: React.ReactNode })?.videoStreamSlot,
              (enrichedRemotePlayers[3] as { videoStreamSlot?: React.ReactNode })?.videoStreamSlot,
            ]}
            showInGameAlert={showInGameAlert}
          />
        ) : (
          // PORTRAIT MODE (existing layout)
          <>
            {/* Task #590: Match number display - top center */}
            <View style={scoreDisplayStyles.matchNumberContainer} pointerEvents="box-none">
              <View style={scoreDisplayStyles.matchNumberBadge}>
                <Text style={scoreDisplayStyles.matchNumberText}>
                  {isGameFinished ? 'Game Over' : `Match ${matchNumber}`}
                </Text>
              </View>
            </View>

            {/* Task #590: Score action buttons - top left
                Layout: column-1 = [📜, 💬(multiplayer)], column-2 = [▶] */}
            <View style={scoreDisplayStyles.scoreActionContainer} pointerEvents="box-none">
              {/* Column 1: play-history on top, chat below it */}
              <View style={{ flexDirection: 'column', gap: 8 }}>
                <TouchableOpacity
                  style={scoreDisplayStyles.scoreActionButton}
                  onPress={togglePlayHistory}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="View play history"
                  accessibilityHint="Opens the list of plays for this match"
                >
                  <Text style={scoreDisplayStyles.scoreActionButtonText}>📜</Text>
                </TouchableOpacity>
                {/* Task #648: chat icon button (multiplayer only) — below 📜 */}
                {isMultiplayerGame && (
                  <View style={{ position: 'relative' }}>
                    <TouchableOpacity
                      style={[
                        scoreDisplayStyles.scoreActionButton,
                        isChatDrawerOpen && { backgroundColor: 'rgba(74,144,226,0.4)' },
                      ]}
                      onPress={toggleChatDrawer}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={i18n.t('chat.a11yToggleLabel')}
                      accessibilityHint={i18n.t('chat.a11yToggleHint')}
                    >
                      <Text style={scoreDisplayStyles.scoreActionButtonText}>💬</Text>
                    </TouchableOpacity>
                    {chatUnreadCount > 0 && !isChatDrawerOpen && (
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
              {/* Column 2: scoreboard expand toggle */}
              <TouchableOpacity
                style={scoreDisplayStyles.scoreActionButton}
                onPress={toggleScoreboardExpanded}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Toggle scoreboard"
                accessibilityHint="Expands or collapses the scoreboard"
              >
                <Text style={scoreDisplayStyles.scoreActionButtonText}>▶</Text>
              </TouchableOpacity>
            </View>

            {/* Hamburger menu (top-right) */}
            <Pressable
              style={styles.menuContainer}
              onPress={() => setShowSettings(true)}
              testID="settings-button"
              accessibilityRole="button"
              accessibilityLabel="Open settings menu"
              accessibilityHint="Opens game settings and options"
            >
              <View style={styles.menuIcon}>
                <View style={styles.menuLine} />
                <View style={styles.menuLine} />
                <View style={styles.menuLine} />
              </View>
            </Pressable>

            {/* Orientation Toggle Button (Task #450) */}
            <Pressable
              style={styles.orientationToggleContainer}
              onPress={() => {
                gameLogger.info('🔄 [UI] Orientation toggle button pressed');
                toggleOrientation();
              }}
              accessibilityRole="button"
              accessibilityLabel="Toggle orientation"
              accessibilityHint="Switch between portrait and landscape mode"
            >
              <Text style={styles.orientationToggleIcon}>🔄</Text>
            </Pressable>

            {/* Game table layout (Task #426) */}
            <GameLayout
              players={enrichedRemotePlayers}
              lastPlayedCards={effectiveLastPlayedCards}
              lastPlayedBy={effectiveLastPlayedBy}
              lastPlayComboType={effectiveLastPlayComboType}
              lastPlayCombo={effectiveLastPlayCombo}
              autoPassTimerState={effectiveAutoPassTimerState}
              dropZoneState={dropZoneState}
              onOpponentNameLongPress={
                isMultiplayerGame ? handlePortraitOpponentNameLongPress : undefined
              }
              opponentPlayerIds={isMultiplayerGame ? remotePlayerIds : undefined}
              throwableActiveEffects={throwableActiveEffects}
              clockOffsetMs={turnClockOffsetMs}
            />

            {/* PlayerInfo - INDEPENDENT ABSOLUTE POSITIONING */}
            <View style={styles.playerInfoContainer}>
              {/* Task #651 Phase 5 — wire live video slot for local player.
                  Only active in multiplayer; LocalAIGame sets isChatConnected=false.
                  getVideoTrackRef('__local__') returns the LiveKit TrackReference for
                  the local camera track; undefined when camera is off or not linked. */}
              <PlayerInfo
                name={layoutPlayersWithScores[0]?.name ?? currentPlayerName}
                cardCount={layoutPlayersWithScores[0]?.cardCount ?? effectivePlayerHand.length}
                isActive={layoutPlayersWithScores[0]?.isActive ?? false}
                totalScore={layoutPlayersWithScores[0]?.totalScore ?? playerTotalScores[0] ?? 0}
                isDisconnected={layoutPlayersWithScores[0]?.isDisconnected}
                disconnectTimerStartedAt={layoutPlayersWithScores[0]?.disconnectTimerStartedAt}
                turnTimerStartedAt={layoutPlayersWithScores[0]?.turnTimerStartedAt}
                onCountdownExpired={layoutPlayersWithScores[0]?.onCountdownExpired}
                clockOffsetMs={turnClockOffsetMs}
                isLocalPlayer={isMultiplayerGame}
                isCameraOn={isMultiplayerGame && isChatConnected ? isLocalCameraOn : undefined}
                isMicOn={isMultiplayerGame && isChatConnected ? isLocalMicOn : undefined}
                onVideoChatToggle={isMultiplayerGame ? toggleVideoChat : undefined}
                isVideoChatConnecting={isMultiplayerGame ? isVideoChatConnecting : false}
                videoStreamSlot={localVideoSlot}
                onMicToggle={isMultiplayerGame ? toggleMic : undefined}
              />
              {/* Throwable effect overlay for local player (display index 0) */}
              {throwableActiveEffects?.[0] != null && (
                <View
                  pointerEvents="none"
                  style={{
                    width: throwableClipSize,
                    height: throwableClipSize,
                    borderRadius: throwableClipSize / 2,
                    position: 'absolute',
                    top: 0,
                    alignSelf: 'center',
                  }}
                >
                  <ThrowablePlayerEffect
                    key={throwableActiveEffects[0]!.id}
                    throwable={throwableActiveEffects[0]!.throwable}
                  />
                </View>
              )}
            </View>

            {/* Drag-to-play hint — rendered above action/helper buttons so it isn't
                hidden behind actionButtonsRow (zIndex 180) or helperButtonsRow (zIndex 170).
                Was previously inside CardHand's cardHandContainer (zIndex 50) which caused
                the hint to be covered. */}
            {isHintVisible && (
              <Animated.View
                pointerEvents="none"
                style={[styles.dragHintContainer, { opacity: hintPulse }]}
              >
                <Text style={styles.dragHintText}>{i18n.t('game.dragToPlayHint')}</Text>
              </Animated.View>
            )}

            {/* Action buttons (Play/Pass) - INDEPENDENT ABSOLUTE POSITIONING */}
            <View style={styles.actionButtonsRow}>
              <GameControls
                gameManager={gameManagerRef.current}
                isPlayerActive={layoutPlayers[0]?.isActive ?? false}
                selectedCards={selectedCards}
                onPlaySuccess={handlePlaySuccess}
                onPassSuccess={handlePassSuccess}
                isMounted={isMountedRef}
                customCardOrder={customCardOrder}
                setCustomCardOrder={setCustomCardOrder}
                playerHand={effectivePlayerHand}
                onPlayCards={handlePlayCards}
                onPass={handlePass}
              />
            </View>

            {/* Helper Buttons Row (Sort/Smart/Hint) - INDEPENDENT ABSOLUTE POSITIONING */}
            <View style={styles.helperButtonsRow}>
              <HelperButtons
                onSort={handleSort}
                onSmartSort={handleSmartSort}
                onHint={handleHint}
                disabled={effectivePlayerHand.length === 0}
              />
            </View>

            {/* Throw Button — multiplayer only, separate FAB on the right side */}
            {isMultiplayerGame && (
              <View
                style={
                  i18n.getLanguage() === 'de'
                    ? styles.throwButtonContainerAbove
                    : styles.throwButtonContainer
                }
              >
                <ThrowButton
                  onPress={() => setShowThrowablePicker(true)}
                  isThrowCooldown={isThrowCooldown}
                  cooldownRemaining={cooldownRemaining}
                />
              </View>
            )}

            {/* Player's hand */}
            <View style={styles.cardHandContainer}>
              <CardHand
                cards={effectivePlayerHand}
                onPlayCards={handleCardHandPlayCards}
                onPass={handleCardHandPass}
                canPlay={isPlayerReady}
                disabled={false}
                hideButtons={true}
                selectedCardIds={selectedCardIds}
                onSelectionChange={setSelectedCardIds}
                onCardsReorder={handleCardsReorder}
                onDragZoneChange={setDropZoneState}
              />
            </View>

            {/* Scoreboard Container — kept at the end of the portrait block for layout
                clarity and to group scoreboard-related UI in one place. The expanded
                scoreboard is rendered inside a React Native Modal by ScoreboardContainer,
                so its z-order is managed by the modal layer rather than local render order. */}
            <ScoreboardContainer
              playerNames={memoizedPlayerNames}
              currentScores={memoizedCurrentScores}
              cardCounts={memoizedCardCounts}
              currentPlayerIndex={effectiveScoreboardCurrentPlayerIndex}
              matchNumber={matchNumber}
              isGameFinished={isGameFinished}
              scoreHistory={displayOrderScoreHistory}
              playHistory={playHistoryByMatch}
              originalPlayerNames={memoizedOriginalPlayerNames}
            />
          </>
        )}

        {/* Game End Modal: mounted once the game has initialized and stays mounted
            even if isInitializing flips back to true when complete-game deletes
            room_players. GameEndModal manages its own visibility via showGameEndModal. */}
        {hasGameEverInitialized && (
          <GameEndErrorBoundary onReset={() => {}}>
            <GameEndModal />
          </GameEndErrorBoundary>
        )}

        {/* Game End Modal, Settings Modal, Chat Drawer — deferred until game
            data is ready (isInitializing=false).  Mounting these heavy
            components (GameSettingsModal: 736 lines; ChatDrawer: 454 lines) during the
            loading phase added ~4-5 ms to the initial mount render, pushing it
            over the 16ms budget.  None of these are needed while the spinner
            is shown, so deferring is safe and has no UX impact. */}
        {!isInitializing && (
          <>
            {/* Game Settings Modal */}
            <GameSettingsModal
              visible={showSettings}
              onClose={closeSettings}
              onLeaveGame={handleLeaveGame}
              roomCode={roomCode}
              isInChatSession={isMultiplayerGame && isChatConnected}
              isLocalMicOn={isLocalMicOn}
              isLocalCameraOn={isLocalCameraOn}
              isVideoChatConnecting={isMultiplayerGame ? isVideoChatConnecting : false}
              isAudioChatConnecting={isMultiplayerGame ? isAudioConnecting : false}
              onToggleVoiceChat={isMultiplayerGame ? toggleVoiceChat : undefined}
              onToggleVideoChat={isMultiplayerGame ? toggleVideoChat : undefined}
              onToggleCamera={isMultiplayerGame ? toggleCamera : undefined}
              onToggleMic={isMultiplayerGame ? toggleMic : undefined}
              showInGameAlert={showInGameAlert}
            />

            {/* Task #648: In-game text chat drawer (multiplayer only) */}
            {isMultiplayerGame && (
              <ChatDrawer
                messages={chatMessages}
                sendMessage={sendChatMessage}
                isCooldown={isChatCooldown}
                isOpen={isChatDrawerOpen}
                onToggle={toggleChatDrawer}
                localUserId={localUserId}
              />
            )}

            {/* Throwables modals (multiplayer only) */}
            {isMultiplayerGame && (
              <>
                <ThrowablePicker
                  visible={showThrowablePicker}
                  onSelect={t => {
                    setPendingThrowableType(t);
                    setShowThrowablePicker(false);
                  }}
                  onClose={() => setShowThrowablePicker(false)}
                />
                <PlayerTargetPicker
                  visible={pendingThrowableType != null}
                  throwable={pendingThrowableType ?? 'egg'}
                  opponents={layoutPlayersWithScores
                    .slice(1)
                    .flatMap(p =>
                      p.player_index != null ? [{ name: p.name, player_index: p.player_index }] : []
                    )}
                  onSelect={pi => {
                    sendThrowable(pi, pendingThrowableType!);
                    setPendingThrowableType(null);
                  }}
                  onClose={() => setPendingThrowableType(null)}
                />
                <ThrowableReceiverModal
                  visible={throwableIncoming != null}
                  throwable={throwableIncoming?.throwable ?? 'egg'}
                  fromName={throwableIncoming?.from_name ?? ''}
                  onDismiss={throwableDismissIncoming}
                />
              </>
            )}

            {/* Portrait mode: Add-friend overlay */}
            {portraitActionTarget && (
              <View style={styles.friendActionOverlay} pointerEvents="auto">
                <View style={styles.friendActionCard}>
                  <Text style={styles.friendActionName} numberOfLines={1}>
                    {portraitActionTarget.name}
                  </Text>
                  <AddFriendButton targetUserId={portraitActionTarget.id} compact />
                  <TouchableOpacity
                    style={styles.friendActionClose}
                    onPress={() => setPortraitActionTarget(null)}
                  >
                    <Text style={styles.friendActionCloseText}>✕</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </>
        )}
      </View>
    </Profiler>
  );
}

/**
 * React.memo wrapper — bails out of re-renders triggered by non-context state
 * changes in parent screens (H2 audit fix).  Since GameViewComponent accepts no
 * props, memo prevents any re-render that isn't driven by a GameContext value
 * change.
 */
export const GameView = React.memo(GameViewComponent);
