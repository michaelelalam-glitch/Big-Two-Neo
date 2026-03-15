/**
 * GameView - Shared presentation component for both Local AI and Multiplayer game modes.
 * Contains all JSX rendering (portrait, landscape, modals) with no game-mode-specific logic.
 * Created as part of Task #570: Split GameScreen component.
 *
 * H4 Audit fix (Task #638): all game-view state is now consumed from GameContext via
 * useGameContext() instead of being threaded as 50+ individual props. Parent screens
 * (MultiplayerGame, LocalAIGame) provide the context via <GameContextProvider>.
 */
import React, { Profiler } from 'react';
import { View, Text, Pressable, TouchableOpacity, ActivityIndicator } from 'react-native';
import { CardHand, PlayerInfo, GameSettingsModal, HelperButtons, GameControls, GameLayout } from '../components/game';
import { GameEndModal, GameEndErrorBoundary } from '../components/gameEnd';
import { LandscapeGameLayout } from '../components/gameRoom/LandscapeGameLayout';
import { ConnectionStatusIndicator } from '../components/ConnectionStatusIndicator';
import { ScoreboardContainer } from '../components/scoreboard';
import { i18n } from '../i18n';
import { scoreDisplayStyles } from '../styles/scoreDisplayStyles';
import { gameScreenStyles as styles } from '../styles/gameScreenStyles';
import { performanceMonitor } from '../utils';
import { gameLogger } from '../utils/logger';
import type { Card } from '../game/types';
import { useGameContext } from '../contexts/GameContext';

function GameViewComponent() {
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
    toggleVideoChat,
    toggleCamera,
    toggleVoiceChat,
    toggleMic,
    isVideoChatConnecting,
  } = useGameContext();

  const isMultiplayerGame = !isLocalAIGame;

  // Performance profiling callback (Task #430)
  const onRenderCallback: React.ProfilerOnRenderCallback = (
    id,
    phase,
    actualDuration,
    baseDuration,
    startTime,
    commitTime,
  ) => {
    performanceMonitor.logRender(id, phase, actualDuration, baseDuration, startTime, commitTime, new Set());
  };

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
            disconnectedPlayers={layoutPlayersWithScores.map((p) => p.isDisconnected ?? false)}
            disconnectTimerStartedAts={layoutPlayersWithScores.map((p) => p.disconnectTimerStartedAt ?? null)}
            turnTimerStartedAts={layoutPlayersWithScores.map((p) => p.turnTimerStartedAt ?? null)}
            onCountdownExpireds={layoutPlayersWithScores.map((p) => p.onCountdownExpired)}
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
            // Drag-to-play callback
            onPlayCards={async (cards: Card[]) => {
              gameLogger.info('🎴 [Landscape] Drag-to-play triggered with cards:', cards.length);
              try {
                await handlePlayCards(cards);
              } catch (error) {
                gameLogger.error('❌ [Landscape] Drag-to-play failed', error);
              }
            }}
            // Control callbacks
            onOrientationToggle={toggleOrientation}
            onHelp={() => gameLogger.info('Help requested')}
            onSort={handleSort}
            onSmartSort={handleSmartSort}
            onPlay={async () => {
              gameLogger.info('🎴 [Landscape] Play button pressed with selected cards:', selectedCards.length);
              try {
                await handlePlayCards(selectedCards);
              } catch (error) {
                gameLogger.error('❌ [Landscape] Play button failed to play cards', { error });
              }
            }}
            onPass={async () => {
              gameLogger.info('🎴 [Landscape] Pass button pressed');
              try {
                await handlePass();
              } catch (error) {
                gameLogger.error('❌ [Landscape] Pass action failed', error);
              }
            }}
            onHint={handleHint}
            onSettings={() => setShowSettings(true)}
            // Control states
            disabled={false}
            canPlay={isPlayerReady && selectedCards.length > 0}
            canPass={isPlayerReady}
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

            {/* Task #590: Score action buttons - top left */}
            <View style={scoreDisplayStyles.scoreActionContainer} pointerEvents="box-none">
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

            {/* Scoreboard Container */}
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

            {/* Hamburger menu (top-right) */}
            <Pressable
              style={styles.menuContainer}
              onPress={() => setShowSettings(true)}
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
              players={layoutPlayersWithScores}
              lastPlayedCards={effectiveLastPlayedCards}
              lastPlayedBy={effectiveLastPlayedBy}
              lastPlayComboType={effectiveLastPlayComboType}
              lastPlayCombo={effectiveLastPlayCombo}
              autoPassTimerState={effectiveAutoPassTimerState}
            />

            {/* PlayerInfo - INDEPENDENT ABSOLUTE POSITIONING */}
            <View style={styles.playerInfoContainer}>
              {/* Task #651 — wire video tile for local player (opt-in entry point).
                  Only active in multiplayer; LocalAIGame sets isChatConnected=false.
                  Remote player tiles are deferred until the real SDK is installed
                  and a player_index↔participantId join can be performed. */}
              <PlayerInfo
                name={layoutPlayersWithScores[0]?.name ?? currentPlayerName}
                cardCount={layoutPlayersWithScores[0]?.cardCount ?? effectivePlayerHand.length}
                isActive={layoutPlayersWithScores[0]?.isActive ?? false}
                totalScore={layoutPlayersWithScores[0]?.totalScore ?? playerTotalScores[0] ?? 0}
                isDisconnected={layoutPlayersWithScores[0]?.isDisconnected}
                disconnectTimerStartedAt={layoutPlayersWithScores[0]?.disconnectTimerStartedAt}
                turnTimerStartedAt={layoutPlayersWithScores[0]?.turnTimerStartedAt}
                onCountdownExpired={layoutPlayersWithScores[0]?.onCountdownExpired}
                isLocalPlayer={isMultiplayerGame}
                isCameraOn={isMultiplayerGame && isChatConnected ? isLocalCameraOn : undefined}
                isMicOn={isMultiplayerGame && isChatConnected ? isLocalMicOn : undefined}
                onVideoChatToggle={isMultiplayerGame ? toggleVideoChat : undefined}
                isVideoChatConnecting={isMultiplayerGame ? isVideoChatConnecting : false}
              />
            </View>

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
              />
            </View>
          </>
        )}

        {/* Game End Modal (Task #415) - Rendered OUTSIDE orientation conditional */}
        <GameEndErrorBoundary onReset={() => {}}>
          <GameEndModal />
        </GameEndErrorBoundary>

        {/* Game Settings Modal */}
        <GameSettingsModal
          visible={showSettings}
          onClose={() => setShowSettings(false)}
          onLeaveGame={handleLeaveGame}
          roomCode={roomCode}
          isInChatSession={isMultiplayerGame && isChatConnected}
          isLocalMicOn={isLocalMicOn}
          isLocalCameraOn={isLocalCameraOn}
          isVideoChatConnecting={isMultiplayerGame ? isVideoChatConnecting : false}
          onToggleVoiceChat={isMultiplayerGame ? toggleVoiceChat : undefined}
          onToggleVideoChat={isMultiplayerGame ? toggleVideoChat : undefined}
          onToggleCamera={isMultiplayerGame && isChatConnected ? toggleCamera : undefined}
          onToggleMic={isMultiplayerGame && isChatConnected ? toggleMic : undefined}
        />
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
