import React, { Profiler, useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CardHand, PlayerInfo, GameSettingsModal, HelperButtons, GameControls, GameLayout } from '../../components/game';
import { ScoreboardContainer } from '../../components/scoreboard';
import { LandscapeGameLayout } from '../../components/gameRoom/LandscapeGameLayout';
import { GameEndModal, GameEndErrorBoundary } from '../../components/gameEnd';
import { COLORS, SPACING, FONT_SIZES, LAYOUT, OVERLAYS, POSITIONING } from '../../constants';
import { performanceMonitor } from '../../utils';
import { i18n } from '../../i18n';
import type { Card } from '../../game/types';
import type { ScoreHistory, PlayHistoryMatch } from '../../types/scoreboard';
import type { GameCallbacks } from './types';

interface GameUIProps {
  // Orientation
  currentOrientation: 'portrait' | 'landscape';
  onToggleOrientation: () => void;
  
  // Loading state
  isInitializing: boolean;
  
  // Player info
  currentPlayerName: string;
  effectivePlayerHand: Card[];
  selectedCardIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  
  // Layout players (already mapped to scoreboard order)
  layoutPlayers: any[];
  
  // Last play info
  effectiveLastPlayedCards: Card[];
  effectiveLastPlayedBy: number | null;
  effectiveLastPlayComboType: string | null;
  effectiveLastPlayCombo: any | null;
  
  // Game state
  hasEffectiveGameState: boolean;
  effectiveAutoPassTimerState: any;
  isLocalAIGame: boolean;
  gameManagerRef: React.RefObject<any>;
  effectiveScoreboardCurrentPlayerIndex: number;
  
  // Scoreboard data
  memoizedPlayerNames: string[];
  memoizedCurrentScores: number[];
  memoizedCardCounts: number[];
  memoizedOriginalPlayerNames: string[];
  matchNumber: number;
  isGameFinished: boolean;
  scoreHistory: ScoreHistory[];
  playHistoryByMatch: PlayHistoryMatch[];
  
  // Callbacks
  onCardsReorder: (cards: Card[]) => void;
  onPlayCards: GameCallbacks['onPlayCards'];
  onPass: GameCallbacks['onPass'];
  onLeaveGame: GameCallbacks['onLeaveGame'];
  showSettings: boolean;
  setShowSettings: (show: boolean) => void;
  
  // Helper button handlers
  handleSort: () => void;
  handleSmartSort: () => void;
  handleHint: () => void;
  
  // Control handlers
  handlePlaySuccess: () => void;
  handlePassSuccess: () => void;
  handleCardHandPlayCards: (cards: Card[]) => Promise<void>;
  handleCardHandPass: () => Promise<void>;
  
  // Refs
  isMountedRef: React.RefObject<boolean>;
  customCardOrder: Card[];
  setCustomCardOrder: (cards: Card[]) => void;
}

/**
 * GameUI - Pure UI component for game screen
 * Handles all rendering logic for both portrait and landscape modes
 */
export function GameUI({
  currentOrientation,
  onToggleOrientation,
  isInitializing,
  currentPlayerName,
  effectivePlayerHand,
  selectedCardIds,
  onSelectionChange,
  layoutPlayers,
  effectiveLastPlayedCards,
  effectiveLastPlayedBy,
  effectiveLastPlayComboType,
  effectiveLastPlayCombo,
  hasEffectiveGameState,
  effectiveAutoPassTimerState,
  isLocalAIGame,
  gameManagerRef,
  effectiveScoreboardCurrentPlayerIndex,
  memoizedPlayerNames,
  memoizedCurrentScores,
  memoizedCardCounts,
  memoizedOriginalPlayerNames,
  matchNumber,
  isGameFinished,
  scoreHistory,
  playHistoryByMatch,
  onCardsReorder,
  onPlayCards,
  onPass,
  onLeaveGame,
  showSettings,
  setShowSettings,
  handleSort,
  handleSmartSort,
  handleHint,
  handlePlaySuccess,
  handlePassSuccess,
  handleCardHandPlayCards,
  handleCardHandPass,
  isMountedRef,
  customCardOrder,
  setCustomCardOrder,
}: GameUIProps) {
  // Selected cards for controls
  const selectedCards = useMemo(() => {
    return effectivePlayerHand.filter((card) => selectedCardIds.has(card.id));
  }, [effectivePlayerHand, selectedCardIds]);

  // Performance profiling callback
  const onRenderCallback = (
    id: string,
    phase: 'mount' | 'update',
    actualDuration: number,
    baseDuration: number,
    startTime: number,
    commitTime: number
  ) => {
    performanceMonitor.logRender(id, phase, actualDuration, baseDuration, startTime, commitTime, new Set());
  };

  return (
    <Profiler id="GameScreen" onRender={onRenderCallback as any}>
      <View style={[styles.container, { direction: 'ltr' }]}>
        {isInitializing ? (
          // Loading state
          <View style={styles.loadingContainer}>
            <Text style={styles.loadingText}>Initializing game...</Text>
            <Text style={styles.loadingSubtext}>Setting up game engine...</Text>
          </View>
        ) : currentOrientation === 'landscape' ? (
          // LANDSCAPE MODE
          <LandscapeGameLayout
            playerNames={memoizedPlayerNames}
            currentScores={memoizedCurrentScores}
            cardCounts={memoizedCardCounts}
            currentPlayerIndex={effectiveScoreboardCurrentPlayerIndex}
            matchNumber={matchNumber}
            isGameFinished={isGameFinished}
            scoreHistory={scoreHistory}
            playHistory={playHistoryByMatch}
            originalPlayerNames={memoizedOriginalPlayerNames}
            autoPassTimerState={effectiveAutoPassTimerState}
            lastPlayedCards={effectiveLastPlayedCards}
            lastPlayedBy={effectiveLastPlayedBy !== null ? String(effectiveLastPlayedBy) : undefined}
            lastPlayComboType={effectiveLastPlayComboType ?? undefined}
            lastPlayCombo={effectiveLastPlayCombo ?? undefined}
            playerName={layoutPlayers[0]?.name ?? currentPlayerName}
            playerCardCount={layoutPlayers[0]?.cardCount ?? effectivePlayerHand.length}
            playerCards={effectivePlayerHand}
            isPlayerActive={layoutPlayers[0]?.isActive ?? false}
            selectedCardIds={selectedCardIds}
            onSelectionChange={onSelectionChange}
            onCardsReorder={onCardsReorder}
            onPlayCards={onPlayCards}
            onOrientationToggle={onToggleOrientation}
            onHelp={() => {}}
            onSort={handleSort}
            onSmartSort={handleSmartSort}
            onPlay={() => onPlayCards(selectedCards)}
            onPass={onPass}
            onHint={handleHint}
            onSettings={() => setShowSettings(true)}
            disabled={false}
            canPlay={(layoutPlayers[0]?.isActive ?? false) && selectedCards.length > 0 && hasEffectiveGameState && (isLocalAIGame ? !!gameManagerRef.current : true)}
            canPass={(layoutPlayers[0]?.isActive ?? false) && hasEffectiveGameState && (isLocalAIGame ? !!gameManagerRef.current : true)}
          />
        ) : (
          // PORTRAIT MODE
          <>
            <ScoreboardContainer
              playerNames={memoizedPlayerNames}
              currentScores={memoizedCurrentScores}
              cardCounts={memoizedCardCounts}
              currentPlayerIndex={effectiveScoreboardCurrentPlayerIndex}
              matchNumber={matchNumber}
              isGameFinished={isGameFinished}
              scoreHistory={scoreHistory}
              playHistory={playHistoryByMatch}
              originalPlayerNames={memoizedOriginalPlayerNames}
            />

            <Pressable
              style={styles.menuContainer}
              onPress={() => setShowSettings(true)}
              accessibilityRole="button"
              accessibilityLabel="Open settings menu"
            >
              <View style={styles.menuIcon}>
                <View style={styles.menuLine} />
                <View style={styles.menuLine} />
                <View style={styles.menuLine} />
              </View>
            </Pressable>

            <Pressable
              style={styles.orientationToggleContainer}
              onPress={onToggleOrientation}
              accessibilityRole="button"
              accessibilityLabel="Toggle orientation"
            >
              <Text style={styles.orientationToggleIcon}>🔄</Text>
            </Pressable>

            <GameLayout
              players={layoutPlayers as any}
              lastPlayedCards={effectiveLastPlayedCards as any}
              lastPlayedBy={effectiveLastPlayedBy as any}
              lastPlayComboType={effectiveLastPlayComboType as any}
              lastPlayCombo={effectiveLastPlayCombo as any}
              autoPassTimerState={effectiveAutoPassTimerState}
            />

            <View style={styles.playerInfoContainer}>
              <PlayerInfo
                name={layoutPlayers[0]?.name ?? currentPlayerName}
                cardCount={layoutPlayers[0]?.cardCount ?? effectivePlayerHand.length}
                isActive={layoutPlayers[0]?.isActive ?? false}
              />
            </View>

            <View style={styles.actionButtonsRow}>
              <GameControls
                gameManager={gameManagerRef.current}
                isPlayerActive={layoutPlayers[0]?.isActive ?? false}
                selectedCards={selectedCards}
                onPlaySuccess={handlePlaySuccess}
                onPassSuccess={handlePassSuccess}
                isMounted={isMountedRef}
                customCardOrder={customCardOrder as any}
                setCustomCardOrder={setCustomCardOrder as any}
                playerHand={effectivePlayerHand as any}
                onPlayCards={onPlayCards}
                onPass={onPass}
              />
            </View>

            <View style={styles.helperButtonsRow}>
              <HelperButtons
                onSort={handleSort}
                onSmartSort={handleSmartSort}
                onHint={handleHint}
                disabled={effectivePlayerHand.length === 0}
              />
            </View>

            <View style={styles.cardHandContainer}>
              <CardHand
                cards={effectivePlayerHand}
                onPlayCards={handleCardHandPlayCards}
                onPass={handleCardHandPass}
                canPlay={(layoutPlayers[0]?.isActive ?? false) && hasEffectiveGameState && (isLocalAIGame ? !!gameManagerRef.current : true)}
                disabled={false}
                hideButtons={true}
                selectedCardIds={selectedCardIds}
                onSelectionChange={onSelectionChange}
                onCardsReorder={onCardsReorder}
              />
            </View>
          </>
        )}

        {/* Game End Modal - Render outside orientation conditional */}
        <GameEndErrorBoundary onReset={() => {}}>
          <GameEndModal />
        </GameEndErrorBoundary>

        {/* Game Settings Modal */}
        <GameSettingsModal
          visible={showSettings}
          onClose={() => setShowSettings(false)}
          onLeaveGame={onLeaveGame}
        />
      </View>
    </Profiler>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.primary,
  },
  scoreboardContainer: {
    position: 'absolute',
    top: POSITIONING.scoreboardTop,
    left: POSITIONING.scoreboardLeft,
    zIndex: 100,
  },
  menuContainer: {
    position: 'absolute',
    top: POSITIONING.menuTop,
    right: SPACING.md,
    zIndex: 100,
  },
  menuIcon: {
    width: LAYOUT.menuIconSize,
    height: LAYOUT.menuIconSize,
    backgroundColor: OVERLAYS.menuBackground,
    borderRadius: LAYOUT.menuBorderRadius,
    alignItems: 'center',
    justifyContent: 'center',
    gap: LAYOUT.menuLineGap,
  },
  orientationToggleContainer: {
    position: 'absolute',
    top: POSITIONING.menuTop + LAYOUT.menuIconSize + SPACING.sm,
    right: SPACING.md,
    zIndex: 100,
    width: LAYOUT.menuIconSize,
    height: LAYOUT.menuIconSize,
    backgroundColor: OVERLAYS.menuBackground,
    borderRadius: LAYOUT.menuBorderRadius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orientationToggleIcon: {
    fontSize: 20,
    textAlign: 'center',
  },
  menuLine: {
    width: LAYOUT.menuLineWidth,
    height: LAYOUT.menuLineHeight,
    backgroundColor: COLORS.white,
    borderRadius: POSITIONING.menuLineBorderRadius,
  },
  playerInfoContainer: {
    position: 'absolute',
    bottom: POSITIONING.playerInfoBottom,
    left: POSITIONING.playerInfoLeft,
    zIndex: 250,
  },
  actionButtonsRow: {
    position: 'absolute',
    bottom: POSITIONING.actionButtonsBottom,
    right: POSITIONING.actionButtonsRight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    zIndex: 180,
  },
  helperButtonsRow: {
    position: 'absolute',
    bottom: POSITIONING.helperButtonsBottom,
    left: POSITIONING.helperButtonsLeft,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    zIndex: 170,
  },
  cardHandContainer: {
    position: 'absolute',
    bottom: POSITIONING.cardsBottom,
    left: 0,
    right: 0,
    zIndex: 50,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
  },
  loadingText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.xl,
    fontWeight: 'bold',
    marginBottom: SPACING.md,
  },
  loadingSubtext: {
    color: COLORS.gray.light,
    fontSize: FONT_SIZES.md,
  },
});
