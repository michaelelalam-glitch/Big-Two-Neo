/**
 * LocalAIGameScreen - Complete standalone screen for local AI games
 * Handles client-side game logic with 1 human + 3 AI bots
 * Task #570 - Extracted from 1,366-line GameScreen.tsx
 */

import React, { useState, useEffect, useRef, useCallback, useMemo, Profiler } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, TouchableOpacity } from 'react-native';
import { useRoute, RouteProp, useNavigation } from '@react-navigation/native';
import { CardHand, PlayerInfo, GameSettingsModal, HelperButtons, GameControls, GameLayout } from '../../components/game';
import { GameEndModal, GameEndErrorBoundary } from '../../components/gameEnd';
import { LandscapeGameLayout } from '../../components/gameRoom/LandscapeGameLayout';
import { ScoreboardContainer } from '../../components/scoreboard';
import { COLORS, SPACING, FONT_SIZES, LAYOUT, OVERLAYS, POSITIONING } from '../../constants';
import { useAuth } from '../../contexts/AuthContext';
import { useGameEnd } from '../../contexts/GameEndContext';
import { useScoreboard } from '../../contexts/ScoreboardContext';
import { useBotTurnManager } from '../../hooks/useBotTurnManager';
import { useCardSelection } from '../../hooks/useCardSelection';
import { useDerivedGameState } from '../../hooks/useDerivedGameState';
import { useGameStateManager } from '../../hooks/useGameStateManager';
import { useHelperButtons } from '../../hooks/useHelperButtons';
import { useOrientationManager } from '../../hooks/useOrientationManager';
import { usePlayerTotalScores } from '../../hooks/usePlayerTotalScores';
import { usePlayHistoryTracking } from '../../hooks/usePlayHistoryTracking';
import { useScoreboardMapping } from '../../hooks/useScoreboardMapping';
import { RootStackParamList } from '../../navigation/AppNavigator';
import { scoreDisplayStyles } from '../../styles/scoreDisplayStyles';
import { soundManager, hapticManager, SoundType, showError, performanceMonitor } from '../../utils';
import { sortCardsForDisplay } from '../../utils/cardSorting';
import { gameLogger } from '../../utils/logger';
import type { Card } from '../../game/types';
import type { StackNavigationProp } from '@react-navigation/stack';

type GameScreenRouteProp = RouteProp<RootStackParamList, 'Game'>;
type GameScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Game'>;

/**
 * LocalAIGameScreen - Self-contained component for local AI games
 * Complete with state management, UI rendering, and all game logic
 */
export function LocalAIGameScreen() {
  const route = useRoute<GameScreenRouteProp>();
  const navigation = useNavigation<GameScreenNavigationProp>();
  const { user, profile } = useAuth();
  const scoreboardContext = useScoreboard();
  const { 
    addScoreHistory, 
    scoreHistory, 
    playHistoryByMatch 
  } = scoreboardContext;
  const { openGameEndModal, setOnPlayAgain, setOnReturnToMenu } = useGameEnd();
  const { roomCode, forceNewGame = false, botDifficulty = 'medium' } = route.params;
  const [showSettings, setShowSettings] = useState(false);
  
  gameLogger.info(`🎮 [LocalAIGameScreen] Starting local AI game`);
  
  // Orientation manager
  const { currentOrientation, toggleOrientation, isAvailable: orientationAvailable } = useOrientationManager();
  
  // Get player username
  const currentPlayerName = profile?.username || 
                           user?.email?.split('@')[0] || 
                           'Player';

  // Card selection hook
  const {
    selectedCardIds,
    setSelectedCardIds,
    customCardOrder,
    setCustomCardOrder,
    handleCardsReorder,
  } = useCardSelection();

  // Track component mount status
  const isMountedRef = useRef(true);
  
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Auto-pass timer audio/haptic feedback flags
  const hasPlayedHighestCardSoundRef = useRef(false);

  // Race condition guards
  const isPlayingCardsRef = useRef(false);
  const isPassingRef = useRef(false);

  // One card left detection
  const oneCardLeftDetectedRef = useRef(new Set<string>());

  // Bot turn management
  const gameManagerRefPlaceholder = useRef<any>(null);
  const { checkAndExecuteBotTurn } = useBotTurnManager({
    gameManagerRef: gameManagerRefPlaceholder,
  });

  // Client-side game state
  const { gameManagerRef, gameState, isInitializing } = useGameStateManager({
    roomCode,
    currentPlayerName,
    forceNewGame,
    isLocalGame: true,
    botDifficulty, // Task #596: Pass difficulty from route params
    addScoreHistory,
    openGameEndModal,
    scoreHistory,
    playHistoryByMatch,
    checkAndExecuteBotTurn,
  });

  // Update placeholder ref
  useEffect(() => {
    if (gameManagerRef.current) {
      gameManagerRefPlaceholder.current = gameManagerRef.current;
    }
  }, [gameManagerRef]);

  // Play history tracking
  usePlayHistoryTracking(gameState);

  // Derived game state
  const {
    playerHand: localPlayerHand,
    lastPlayedCards,
    lastPlayedBy,
    lastPlayComboType,
    lastPlayCombo,
  } = useDerivedGameState({
    gameState,
    customCardOrder,
    setCustomCardOrder,
  });

  // Scoreboard mapping
  const {
    players: layoutPlayers,
    mapPlayersToScoreboardOrder,
    mapGameIndexToScoreboardPosition,
  } = useScoreboardMapping({
    gameState,
    currentPlayerName,
  });

  // Effective player hand (apply custom order)
  const effectivePlayerHand: Card[] = useMemo(() => {
    let result = localPlayerHand || [];
    
    if (customCardOrder.length > 0 && result.length > 0) {
      const orderMap = new Map(customCardOrder.map((id, index) => [id, index]));
      result = [...result].sort((a, b) => {
        const aIndex = orderMap.get(a.id) ?? 999;
        const bIndex = orderMap.get(b.id) ?? 999;
        return aIndex - bIndex;
      });
    }
    
    return result;
  }, [localPlayerHand, customCardOrder]);

  // Helper buttons
  const { handleSort, handleSmartSort, handleHint } = useHelperButtons({
    playerHand: effectivePlayerHand,
    lastPlay: gameState?.lastPlay || null,
    isFirstPlay: gameState?.lastPlay === null && gameState?.players.every((p: any) => p.hand.length === 13),
    customCardOrder,
    setCustomCardOrder,
    setSelectedCardIds,
  });

  // Memoized scoreboard props
  const memoizedPlayerNames = useMemo(() => {
    return layoutPlayers.length === 4 
      ? mapPlayersToScoreboardOrder(layoutPlayers, (p: any) => p.name) 
      : [];
  }, [layoutPlayers, mapPlayersToScoreboardOrder]);

  const memoizedCurrentScores = useMemo(() => {
    if (layoutPlayers.length !== 4) return [];
    
    if (scoreHistory.length > 0) {
      return mapPlayersToScoreboardOrder(
        layoutPlayers.map((p: any) => ({
          ...p,
          score: scoreHistory.reduce((sum, match) => sum + (match.pointsAdded[p.player_index] || 0), 0)
        })),
        (p: any) => p.score
      );
    }
    
    return mapPlayersToScoreboardOrder(layoutPlayers, (p: any) => p.score);
  }, [layoutPlayers, scoreHistory, mapPlayersToScoreboardOrder]);

  const memoizedCardCounts = useMemo(() => {
    return layoutPlayers.length === 4 
      ? mapPlayersToScoreboardOrder(layoutPlayers, (p: any) => p.cardCount) 
      : [];
  }, [layoutPlayers, mapPlayersToScoreboardOrder]);

  const memoizedOriginalPlayerNames = useMemo(() => {
    return (gameState as any)?.players ? (gameState as any).players.map((p: any) => p.name) : [];
  }, [gameState]);

  const hasEffectiveGameState = !!gameState;
  const effectiveAutoPassTimerState = (gameState as any)?.auto_pass_timer;
  const effectiveScoreboardCurrentPlayerIndex = mapGameIndexToScoreboardPosition(
    (gameState as any)?.currentPlayerIndex ?? 0
  );
  const matchNumber = (gameState as any)?.currentMatch ?? 1;
  const isGameFinished = (gameState as any)?.gameOver ?? false;

  // Compute per-player total scores for badges (Task #590 — shared hook)
  const playerTotalScores = usePlayerTotalScores(layoutPlayers, scoreHistory);

  // Layout players with totalScore attached (Task #590)
  const layoutPlayersWithScores = useMemo(() => {
    return layoutPlayers.map((p: any, i: number) => ({
      ...p,
      totalScore: playerTotalScores[i] ?? 0,
    }));
  }, [layoutPlayers, playerTotalScores]);

  // Selected cards for controls
  const selectedCards = useMemo(() => {
    return effectivePlayerHand.filter((card) => selectedCardIds.has(card.id));
  }, [effectivePlayerHand, selectedCardIds]);

  // Leave game handler
  const handleLeaveGame = useCallback(async () => {
    Alert.alert(
      'Leave Game',
      'Are you sure you want to leave this game?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: () => {
            navigation.reset({
              index: 0,
              routes: [{ name: 'Home' }],
            });
          },
        },
      ]
    );
  }, [navigation]);

  // Register Game End callbacks
  useEffect(() => {
    const manager = gameManagerRef.current;
    if (!manager) return;

    setOnPlayAgain(() => async () => {
      gameLogger.info('🔄 [LocalAIGameScreen] Play Again requested');
      try {
        await manager.initializeGame({
          playerName: currentPlayerName,
          botCount: 3,
          botDifficulty: botDifficulty, // Task #596: Reuse selected difficulty on Play Again
        });
        soundManager.playSound(SoundType.GAME_START);
      } catch (error) {
        gameLogger.error('❌ Failed to restart game:', error);
        showError('Failed to restart game. Please try again.');
      }
    });

    setOnReturnToMenu(() => () => {
      gameLogger.info('🏠 [LocalAIGameScreen] Return to Menu requested');
      navigation.reset({
        index: 0,
        routes: [{ name: 'Home' }],
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- botDifficulty intentionally excluded from the game-end callback setup effect; the callbacks only need to re-register when the player name or navigation ref changes; botDifficulty is read at call-time inside the async callback
  }, [currentPlayerName, navigation, gameManagerRef, setOnPlayAgain, setOnReturnToMenu]);

  // Cleanup on deliberate leave
  useEffect(() => {
    const allowedActionTypes = ['POP', 'GO_BACK', 'NAVIGATE'];
    const unsubscribe = navigation.addListener('beforeRemove', async (e: any) => {
      const actionType = e?.data?.action?.type;
      if (typeof actionType === 'string' && allowedActionTypes.includes(actionType)) {
        if (orientationAvailable) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports -- dynamic require inside try/catch; static import cannot be inside a conditional block
            const ScreenOrientation = require('expo-screen-orientation');
            await ScreenOrientation.unlockAsync();
            gameLogger.info('🔓 Unlocked orientation on navigation away');
          } catch (error) {
            gameLogger.error('❌ Failed to unlock orientation:', error);
          }
        }
      }
    });

    return () => {
      unsubscribe();
    };
  }, [navigation, orientationAvailable]);

  // Action handlers
  const handlePlayCards = useCallback(async (cards: Card[]) => {
    if (isPlayingCardsRef.current) {
      gameLogger.warn('⚠️ Card play already in progress');
      return;
    }

    if (!gameManagerRef.current) {
      gameLogger.error('❌ Game not initialized');
      return;
    }

    try {
      isPlayingCardsRef.current = true;
      hapticManager.playCard();

      const sortedCards = sortCardsForDisplay(cards);
      const cardIds = sortedCards.map(card => card.id);
      
      await gameManagerRef.current.playCards(cardIds);
      setSelectedCardIds(new Set());
      soundManager.playSound(SoundType.CARD_PLAY);
    } catch (error: any) {
      gameLogger.error('❌ Error playing cards:', error);
      showError(error.message || 'Failed to play cards');
    } finally {
      isPlayingCardsRef.current = false;
    }
  }, [gameManagerRef, setSelectedCardIds]);

  const handlePass = useCallback(async () => {
    if (isPassingRef.current) {
      gameLogger.warn('⚠️ Pass action already in progress');
      return;
    }

    if (!gameManagerRef.current) {
      gameLogger.error('❌ Game not initialized');
      return;
    }

    try {
      isPassingRef.current = true;
      hapticManager.pass();

      await gameManagerRef.current.pass();
      setSelectedCardIds(new Set());
      soundManager.playSound(SoundType.PASS);
    } catch (error: any) {
      gameLogger.error('❌ Error passing:', error);
      showError(error.message || 'Failed to pass');
    } finally {
      isPassingRef.current = false;
    }
  }, [gameManagerRef, setSelectedCardIds]);

  const handlePlaySuccess = () => {
    if (isMountedRef.current) {
      setSelectedCardIds(new Set());
    }
  };

  const handlePassSuccess = () => {
    if (isMountedRef.current) {
      setSelectedCardIds(new Set());
    }
  };

  const handleCardHandPlayCards = async (cards: Card[]) => {
    await handlePlayCards(cards);
  };

  const handleCardHandPass = async () => {
    await handlePass();
  };

  // Auto-pass timer effects
  useEffect(() => {
    const timerState = gameState?.auto_pass_timer;

    if (!timerState || !timerState.active) {
      hasPlayedHighestCardSoundRef.current = false;
      return;
    }

    if (!hasPlayedHighestCardSoundRef.current) {
      soundManager.playSound(SoundType.HIGHEST_CARD);
      hasPlayedHighestCardSoundRef.current = true;
    }

    const remaining_ms = timerState.remaining_ms;
    const displaySeconds = Math.ceil(remaining_ms / 1000);
    
    if (displaySeconds <= 5 && displaySeconds >= 1) {
      hapticManager.urgentCountdown(displaySeconds);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- gameState?.auto_pass_timer (full object) intentionally excluded; only remaining_ms drives the haptic intensity; subscribing to the full timer object would retrigger on started_at / active changes unrelated to countdown display
  }, [gameState?.auto_pass_timer?.remaining_ms]);

  // One card left detection
  useEffect(() => {
    const hands = (gameState as any)?.hands;
    
    if (!hands || typeof hands !== 'object') return;
    
    Object.entries(hands).forEach(([playerIndex, cards]) => {
      if (!Array.isArray(cards)) return;
      
      const key = `${roomCode}-${playerIndex}`;
      
      if (cards.length === 1 && !oneCardLeftDetectedRef.current.has(key)) {
        oneCardLeftDetectedRef.current.add(key);
      } else if (cards.length > 1 && oneCardLeftDetectedRef.current.has(key)) {
        oneCardLeftDetectedRef.current.delete(key);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- using (gameState as any)?.hands as a dep is a complex expression; gameState (full object) intentionally excluded as we only need to react to hand content changes, not all game state mutations
  }, [(gameState as any)?.hands, roomCode]);

  // Performance profiling
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

  // Render
  return (
    <Profiler id="LocalAIGameScreen" onRender={onRenderCallback as any}>
      <View style={[styles.container, { direction: 'ltr' }]}>
        {isInitializing ? (
          <View style={styles.loadingContainer}>
            <Text style={styles.loadingText}>Initializing game...</Text>
            <Text style={styles.loadingSubtext}>Setting up game engine...</Text>
          </View>
        ) : currentOrientation === 'landscape' ? (
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
            lastPlayedCards={lastPlayedCards}
            lastPlayedBy={lastPlayedBy ?? undefined}
            lastPlayComboType={lastPlayComboType ?? undefined}
            lastPlayCombo={lastPlayCombo ?? undefined}
            playerName={layoutPlayers[0]?.name ?? currentPlayerName}
            playerCardCount={layoutPlayers[0]?.cardCount ?? effectivePlayerHand.length}
            playerCards={effectivePlayerHand}
            isPlayerActive={layoutPlayers[0]?.isActive ?? false}
            selectedCardIds={selectedCardIds}
            onSelectionChange={setSelectedCardIds}
            onCardsReorder={handleCardsReorder}
            onPlayCards={handlePlayCards}
            onOrientationToggle={toggleOrientation}
            onHelp={() => {}}
            onSort={handleSort}
            onSmartSort={handleSmartSort}
            onPlay={() => handlePlayCards(selectedCards)}
            onPass={handlePass}
            onHint={handleHint}
            onSettings={() => setShowSettings(true)}
            disabled={false}
            canPlay={(layoutPlayers[0]?.isActive ?? false) && selectedCards.length > 0 && hasEffectiveGameState && !!gameManagerRef.current}
            canPass={(layoutPlayers[0]?.isActive ?? false) && hasEffectiveGameState && !!gameManagerRef.current}
          />
        ) : (
          <>
            {/* Match number display - top center (Task #590) */}
            <View style={scoreDisplayStyles.matchNumberContainer}>
              <View style={scoreDisplayStyles.matchNumberBadge}>
                <Text style={scoreDisplayStyles.matchNumberText}>
                  {isGameFinished ? 'Game Over' : `Match ${matchNumber}`}
                </Text>
              </View>
            </View>

            {/* Score action buttons - top left (Task #590) */}
            <View style={scoreDisplayStyles.scoreActionContainer}>
              <TouchableOpacity
                style={scoreDisplayStyles.scoreActionButton}
                onPress={() => scoreboardContext.setIsPlayHistoryOpen(prev => !prev)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="View play history"
                accessibilityHint="Opens the list of plays for this match"
              >
                <Text style={scoreDisplayStyles.scoreActionButtonText}>📜</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={scoreDisplayStyles.scoreActionButton}
                onPress={() => scoreboardContext.setIsScoreboardExpanded(prev => !prev)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Toggle scoreboard"
                accessibilityHint="Expands or collapses the scoreboard"
              >
                <Text style={scoreDisplayStyles.scoreActionButtonText}>▶</Text>
              </TouchableOpacity>
            </View>

            {/* Scoreboard: expanded view + play history modal (Task #590) */}
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
              onPress={toggleOrientation}
              accessibilityRole="button"
              accessibilityLabel="Toggle orientation"
            >
              <Text style={styles.orientationToggleIcon}>🔄</Text>
            </Pressable>

            <GameLayout
              players={layoutPlayersWithScores as any}
              lastPlayedCards={lastPlayedCards as any}
              lastPlayedBy={lastPlayedBy as any}
              lastPlayComboType={lastPlayComboType as any}
              lastPlayCombo={lastPlayCombo as any}
              autoPassTimerState={effectiveAutoPassTimerState}
            />

            <View style={styles.playerInfoContainer}>
              <PlayerInfo
                name={layoutPlayers[0]?.name ?? currentPlayerName}
                cardCount={layoutPlayers[0]?.cardCount ?? effectivePlayerHand.length}
                isActive={layoutPlayers[0]?.isActive ?? false}
                totalScore={playerTotalScores[0] ?? 0}
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
                onPlayCards={handlePlayCards}
                onPass={handlePass}
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
                canPlay={(layoutPlayers[0]?.isActive ?? false) && hasEffectiveGameState && !!gameManagerRef.current}
                disabled={false}
                hideButtons={true}
                selectedCardIds={selectedCardIds}
                onSelectionChange={setSelectedCardIds}
                onCardsReorder={handleCardsReorder}
              />
            </View>
          </>
        )}

        <GameEndErrorBoundary onReset={() => {}}>
          <GameEndModal />
        </GameEndErrorBoundary>

        <GameSettingsModal
          visible={showSettings}
          onClose={() => setShowSettings(false)}
          onLeaveGame={handleLeaveGame}
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
