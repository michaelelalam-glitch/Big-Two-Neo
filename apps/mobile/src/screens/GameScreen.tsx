import React, { useState, useEffect, useRef, Profiler } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, RouteProp, useNavigation, NavigationProp } from '@react-navigation/native';
import { RootStackParamList } from '../navigation/AppNavigator';
import { CardHand, PlayerInfo, GameSettingsModal, HelperButtons, GameControls, GameLayout } from '../components/game';
import { ScoreboardContainer } from '../components/scoreboard';
import type { Card } from '../game/types';
import { COLORS, SPACING, FONT_SIZES, LAYOUT, OVERLAYS, POSITIONING } from '../constants';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../services/supabase';
import { useGameStateManager } from '../hooks/useGameStateManager';
import { gameLogger } from '../utils/logger';
import { ScoreboardProvider, useScoreboard } from '../contexts/ScoreboardContext';
import { usePlayHistoryTracking } from '../hooks/usePlayHistoryTracking';
import { soundManager, hapticManager, SoundType, showError, showConfirm, performanceMonitor } from '../utils';
import { GameEndProvider, useGameEnd } from '../contexts/GameEndContext';
import { GameEndModal, GameEndErrorBoundary } from '../components/gameEnd';
import { i18n } from '../i18n';
import { useBotTurnManager } from '../hooks/useBotTurnManager';
import { useHelperButtons } from '../hooks/useHelperButtons';
import { useDerivedGameState } from '../hooks/useDerivedGameState';
import { useScoreboardMapping } from '../hooks/useScoreboardMapping';
import { useCardSelection } from '../hooks/useCardSelection';
import { useOrientationManager } from '../hooks/useOrientationManager';
import { LandscapeGameLayout } from '../components/gameRoom/LandscapeGameLayout';

type GameScreenRouteProp = RouteProp<RootStackParamList, 'Game'>;
type GameScreenNavigationProp = NavigationProp<RootStackParamList>;

function GameScreenContent() {
  const route = useRoute<GameScreenRouteProp>();
  const navigation = useNavigation<GameScreenNavigationProp>();
  const { user, profile } = useAuth();
  const scoreboardContext = useScoreboard(); // Get entire context
  const { 
    addScoreHistory, 
    setIsScoreboardExpanded, 
    scoreHistory, 
    playHistoryByMatch 
  } = scoreboardContext; // Task #351 & #352 & #355
  const { openGameEndModal, setOnPlayAgain, setOnReturnToMenu } = useGameEnd(); // Task #415, #416, #417
  const { roomCode } = route.params;
  const [showSettings, setShowSettings] = useState(false);
  
  // Orientation manager (Task #450) - gracefully handles missing native module
  const { currentOrientation, toggleOrientation, isAvailable: orientationAvailable } = useOrientationManager();
  
  // CRITICAL FIX: Store refs to always get latest context values
  const scoreboardRef = useRef(scoreboardContext);
  useEffect(() => {
    scoreboardRef.current = scoreboardContext;
  }, [scoreboardContext]);

  // Get player username from profile (consistent with leaderboard and lobby)
  const currentPlayerName = profile?.username || 
                           user?.email?.split('@')[0] || 
                           'Player';

  // Card selection hook (Task #Phase 2B)
  const {
    selectedCardIds,
    setSelectedCardIds,
    customCardOrder,
    setCustomCardOrder,
    handleCardsReorder,
    getSelectedCards,
  } = useCardSelection();

  // Bot turn management hook (Task #Phase 2B) - must be created BEFORE gameStateManager
  const gameManagerRefPlaceholder = useRef<any>(null);
  const { checkAndExecuteBotTurn } = useBotTurnManager({
    gameManagerRef: gameManagerRefPlaceholder,
  });

  // Game state management - extracted to useGameStateManager hook (Task #427)
  const { gameManagerRef, gameState, isInitializing } = useGameStateManager({
    roomCode,
    currentPlayerName,
    addScoreHistory,
    openGameEndModal,
    scoreHistory,
    playHistoryByMatch,
    checkAndExecuteBotTurn,
  });

  // Update placeholder ref once gameManagerRef is available
  useEffect(() => {
    if (gameManagerRef.current) {
      gameManagerRefPlaceholder.current = gameManagerRef.current;
    }
  }, [gameManagerRef]);

  // Task #355: Play history tracking - automatically sync game plays to scoreboard
  usePlayHistoryTracking(gameState);

  // Derived game state hook (Task #Phase 2B)
  const {
    playerHand,
    lastPlayedCards,
    lastPlayedBy,
    lastPlayComboType,
    lastPlayCombo,
  } = useDerivedGameState({
    gameState,
    customCardOrder,
    setCustomCardOrder,
  });

  // Scoreboard mapping hook (Task #Phase 2B)
  const {
    players,
    mapPlayersToScoreboardOrder,
    mapGameIndexToScoreboardPosition,
  } = useScoreboardMapping({
    gameState,
    currentPlayerName,
  });

  // Helper buttons hook (Task #Phase 2B)
  const { handleSort, handleSmartSort, handleHint } = useHelperButtons({
    playerHand,
    lastPlay: gameState?.lastPlay || null,
    isFirstPlay:
      gameState?.lastPlay === null && gameState?.players.every((p) => p.hand.length === 13),
    customCardOrder,
    setCustomCardOrder,
    setSelectedCardIds,
  });

  // Register Game End callbacks (Task #416, #417)
  useEffect(() => {
    const manager = gameManagerRef.current;
    if (!manager) return;

    setOnPlayAgain(() => async () => {
      gameLogger.info('🔄 [GameScreen] Play Again requested - reinitializing game');
      try {
        const newState = await manager.initializeGame({
          playerName: currentPlayerName,
          botCount: 3,
          botDifficulty: 'medium',
        });
        // TODO: This needs to trigger a state update through the hook
        gameLogger.info('✅ [GameScreen] Game restarted successfully');
        soundManager.playSound(SoundType.GAME_START);
      } catch (error) {
        gameLogger.error('❌ [GameScreen] Failed to restart game:', error);
        showError('Failed to restart game. Please try again.');
      }
    });

    setOnReturnToMenu(() => () => {
      gameLogger.info('🏠 [GameScreen] Return to Menu requested - navigating to Home');
      navigation.reset({
        index: 0,
        routes: [{ name: 'Home' }],
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPlayerName, navigation, gameManagerRef]);



  // Cleanup: Remove player from room when deliberately leaving (NOT on every unmount)
  useEffect(() => {
    // Track if component is being unmounted due to navigation away
    let isDeliberateLeave = false;
    
    // Listen for navigation events to detect deliberate exits
    const allowedActionTypes = ['POP', 'GO_BACK', 'NAVIGATE'];
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      // Only set as deliberate leave for certain navigation actions (e.g., back, pop, custom leave)
      const actionType = e?.data?.action?.type;
      if (
        typeof actionType === 'string' &&
        allowedActionTypes.includes(actionType)
      ) {
        isDeliberateLeave = true;
      }
    });

    return () => {
      unsubscribe();
      
      // Only cleanup if this is a deliberate leave (not a re-render)
      if (isDeliberateLeave && user?.id && roomCode) {
        gameLogger.info(`🧹 [GameScreen] Deliberate exit: Removing user ${user.id} from room ${roomCode}`);
        
        // Use non-blocking cleanup (don't await)
        supabase
          .from('room_players')
          .delete()
          .eq('user_id', user.id)
          .then(({ error }) => {
            if (error) {
              gameLogger.error('❌ [GameScreen] Cleanup error:', error?.message || error?.code || 'Unknown error');
            } else {
              gameLogger.info('✅ [GameScreen] Successfully removed from room');
            }
          });
      }
    };
  }, [user, roomCode, navigation]);

  // Track component mount status for async operations
  const isMountedRef = useRef(true);
  
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Task #270: Auto-pass timer audio/haptic feedback
  const hasPlayedHighestCardSoundRef = useRef(false);

  useEffect(() => {
    // DEBUG: Log every timer update
    gameLogger.debug('[DEBUG] Timer effect fired:', {
      hasTimer: !!gameState?.auto_pass_timer,
      remaining_ms: gameState?.auto_pass_timer?.remaining_ms,
      displaySeconds: gameState?.auto_pass_timer ? Math.ceil(gameState.auto_pass_timer.remaining_ms / 1000) : null
    });

    if (!gameState?.auto_pass_timer) {
      // Timer not active - reset flags for next timer activation
      gameLogger.debug('[DEBUG] Resetting timer flags (timer inactive)');
      hasPlayedHighestCardSoundRef.current = false;
      return;
    }

    // Timer just became active - play highest card sound (once per timer activation)
    if (!hasPlayedHighestCardSoundRef.current) {
      soundManager.playSound(SoundType.HIGHEST_CARD);
      gameLogger.info('🎵 [Audio] Highest card sound triggered - auto-pass timer active');
      hasPlayedHighestCardSoundRef.current = true;
    }

    // Progressive intensity vibration from 5 seconds down to 1
    // CRITICAL: Use Math.ceil to match UI display logic (5000ms = 5 seconds)
    const remaining_ms = gameState.auto_pass_timer.remaining_ms;
    const displaySeconds = Math.ceil(remaining_ms / 1000);
    
    // Vibrate with increasing frequency from 5→1 (more pulses = more intense)
    if (displaySeconds <= 5 && displaySeconds >= 1) {
      gameLogger.warn(`🚨 [VIBRATION] Triggering urgent countdown at ${displaySeconds}s (remaining_ms=${remaining_ms})`);
      hapticManager.urgentCountdown(displaySeconds);
      gameLogger.info(`📳 [Haptic] Progressive vibration triggered: ${displaySeconds}s`);
    }
  }, [gameState?.auto_pass_timer?.remaining_ms]); // CRITICAL FIX: Watch remaining_ms, not object reference

  // Refs to access GameControls' handlePlayCards/handlePass for drag-to-play from CardHand
  const onPlayCardsRef = useRef<((cards: Card[]) => Promise<void>) | null>(null);
  const onPassRef = useRef<(() => Promise<void>) | null>(null);

  // Callback handlers for GameControls component
  const handlePlaySuccess = () => {
    // Clear selection after successful play
    if (isMountedRef.current) {
      setSelectedCardIds(new Set());
    }
  };

  const handlePassSuccess = () => {
    // Clear selection after successful pass
    if (isMountedRef.current) {
      setSelectedCardIds(new Set());
    }
  };

  // Wrapper for CardHand drag-to-play: calls GameControls' handlePlayCards
  const handleCardHandPlayCards = (cards: Card[]) => {
    if (onPlayCardsRef.current) {
      onPlayCardsRef.current(cards);
    }
  };

  // Wrapper for CardHand drag-to-pass: calls GameControls' handlePass
  const handleCardHandPass = () => {
    if (onPassRef.current) {
      onPassRef.current();
    }
  };

  const handleLeaveGame = (skipConfirmation = false) => {
    if (skipConfirmation) {
      // Navigate directly without confirmation (called from nested dialog)
      navigation.reset({
        index: 0,
        routes: [{ name: 'Home' }],
      });
      return;
    }
    
    // Show confirmation dialog
    showConfirm({
      title: i18n.t('game.leaveGameConfirm'),
      message: i18n.t('game.leaveGameMessage'),
      confirmText: i18n.t('game.leaveGame'),
      cancelText: i18n.t('game.stay'),
      destructive: true,
      onConfirm: () => {
        navigation.reset({
          index: 0,
          routes: [{ name: 'Home' }],
        });
      }
    });
  };

  // Get selected cards array for GameControls
  const selectedCards = getSelectedCards(playerHand);

  // Performance profiling callback (Task #430)
  // React 19 Profiler signature: (id, phase, actualDuration, baseDuration, startTime, commitTime)
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
        ) : (currentOrientation === 'landscape') ? (
          // LANDSCAPE MODE (Task #450) - now uses mapped player order for all props
          <LandscapeGameLayout
            // Scoreboard and player order: [user, Bot 1, Bot 2, Bot 3] = [0,3,1,2]
            playerNames={gameState ? mapPlayersToScoreboardOrder(gameState.players, p => p.name) : []}
            currentScores={gameState ? mapPlayersToScoreboardOrder(gameState.matchScores, s => s.score) : []}
            cardCounts={gameState ? mapPlayersToScoreboardOrder(gameState.players, p => p.hand.length) : []}
            currentPlayerIndex={mapGameIndexToScoreboardPosition(gameState?.currentPlayerIndex || 0)}
            matchNumber={gameState?.currentMatch || 1}
            isGameFinished={gameState?.gameOver || false}
            scoreHistory={scoreHistory}
            playHistory={playHistoryByMatch}
            originalPlayerNames={gameState ? gameState.players.map(p => p.name) : []}
            autoPassTimerState={gameState?.auto_pass_timer}

            // Table data
            lastPlayedCards={lastPlayedCards}
            lastPlayedBy={lastPlayedBy ?? undefined}
            lastPlayComboType={lastPlayComboType ?? undefined}
            lastPlayCombo={lastPlayCombo ?? undefined}

            // Player data (bottom center is always index 0 after mapping)
            playerName={players[0].name}
            playerCardCount={players[0].cardCount}
            playerCards={playerHand}
            isPlayerActive={players[0].isActive}
            selectedCardIds={selectedCardIds}
            onSelectionChange={setSelectedCardIds}
            onCardsReorder={handleCardsReorder}

            // Drag-to-play callback
            onPlayCards={(cards: Card[]) => {
              gameLogger.info('🎴 [Landscape] Drag-to-play triggered with cards:', cards.length);
              if (onPlayCardsRef.current) {
                onPlayCardsRef.current(cards);
              }
            }}

            // Control callbacks
            onOrientationToggle={toggleOrientation}
            onHelp={() => gameLogger.info('Help requested')}
            onSort={handleSort}
            onSmartSort={handleSmartSort}
            onPlay={() => {
              gameLogger.info('🎴 [Landscape] Play button pressed with selected cards:', selectedCards.length);
              if (onPlayCardsRef.current) {
                onPlayCardsRef.current(selectedCards);
              }
            }}
            onPass={() => {
              gameLogger.info('🎴 [Landscape] Pass button pressed');
              if (onPassRef.current) {
                onPassRef.current();
              }
            }}
            onHint={handleHint}
            onSettings={() => setShowSettings(true)}

            // Control states
            disabled={!players[0].isActive}
            canPlay={players[0].isActive && selectedCards.length > 0}
            canPass={players[0].isActive}
          />
        ) : (
          // PORTRAIT MODE (existing layout)
          <>
            {/* Scoreboard Container (top-left, with expand/collapse & play history) */}
            <ScoreboardContainer
            playerNames={gameState ? mapPlayersToScoreboardOrder(gameState.players, p => p.name) : []}
            currentScores={gameState ? gameState.matchScores.map(s => s.score) : []}
            cardCounts={gameState ? mapPlayersToScoreboardOrder(gameState.players, p => p.hand.length) : []}
            currentPlayerIndex={mapGameIndexToScoreboardPosition(gameState?.currentPlayerIndex || 0)}
            matchNumber={gameState?.currentMatch || 1}
            isGameFinished={gameState?.gameOver || false}
            scoreHistory={scoreHistory}
            playHistory={playHistoryByMatch}
            originalPlayerNames={gameState ? gameState.players.map(p => p.name) : []}
          />

          {/* Hamburger menu (top-right, outside table) */}
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
            <Text style={styles.orientationToggleIcon}>
              {currentOrientation === 'landscape' ? '📱' : '🔄'}
            </Text>
          </Pressable>

          {/* Game table layout - extracted to GameLayout component (Task #426) */}
          <GameLayout
            players={players}
            lastPlayedCards={lastPlayedCards}
            lastPlayedBy={lastPlayedBy}
            lastPlayComboType={lastPlayComboType}
            lastPlayCombo={lastPlayCombo}
            autoPassTimerState={gameState?.auto_pass_timer || undefined}
          />

          {/* Bottom section: Player info, action buttons, and hand */}
          <View style={styles.bottomSection}>
            {/* Helper Buttons Row - positioned above Pass/Play buttons */}
            <View style={styles.helperButtonsRow}>
              <HelperButtons
                onSort={handleSort}
                onSmartSort={handleSmartSort}
                onHint={handleHint}
                disabled={!players[0].isActive || playerHand.length === 0}
              />
            </View>
            
            {/* Player info with action buttons next to it */}
            <View style={styles.bottomPlayerWithActions}>
              <PlayerInfo
                name={players[0].name}
                cardCount={players[0].cardCount}
                isActive={players[0].isActive}
              />
              
              {/* Action buttons - extracted to GameControls component (Task #425) */}
              <GameControls
                gameManager={gameManagerRef.current}
                isPlayerActive={players[0].isActive}
                selectedCards={selectedCards}
                onPlaySuccess={handlePlaySuccess}
                onPassSuccess={handlePassSuccess}
                isMounted={isMountedRef}
                customCardOrder={customCardOrder}
                setCustomCardOrder={setCustomCardOrder}
                playerHand={playerHand}
                onPlayCardsRef={onPlayCardsRef}
                onPassRef={onPassRef}
              />
            </View>

            {/* Player's hand */}
            <View style={styles.cardHandContainer}>
              <CardHand
                cards={playerHand}
                onPlayCards={handleCardHandPlayCards} // FIXED: Wire to GameControls for drag-to-play
                onPass={handleCardHandPass} // FIXED: Wire to GameControls for drag-to-pass
                canPlay={players[0].isActive}
                hideButtons={true} // Hide internal buttons since we display them externally
                selectedCardIds={selectedCardIds}
                onSelectionChange={setSelectedCardIds}
                onCardsReorder={handleCardsReorder}
              />
            </View>
          </View>
          
          {/* Game End Modal (Task #415) - CRITICAL FIX: Wrapped in error boundary */}
          <GameEndErrorBoundary onReset={() => {}}>
            <GameEndModal />
          </GameEndErrorBoundary>
        </>
      )}
      
      {/* Game Settings Modal - WORKS IN BOTH PORTRAIT AND LANDSCAPE */}
      <GameSettingsModal
        visible={showSettings}
        onClose={() => setShowSettings(false)}
        onLeaveGame={handleLeaveGame}
      />
      </View>
    </Profiler>
  );
}

// Wrapper component with ScoreboardProvider and GameEndProvider
export default function GameScreen() {
  return (
    <GameEndProvider>
      <ScoreboardProvider>
        <GameScreenContent />
      </ScoreboardProvider>
    </GameEndProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.primary, // Dark background outside table
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
  // Layout styles moved to GameLayout component (Task #426)
  bottomSection: {
    marginTop: POSITIONING.bottomSectionMarginTop,
    zIndex: 50,
  },
  helperButtonsRow: {
    position: 'absolute',
    bottom: POSITIONING.helperButtonsBottom,
    left: POSITIONING.helperButtonsLeft,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 100,
  },
  bottomPlayerWithActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.xs,
    zIndex: 150, // Task #380: Above scoreboard (zIndex: 100) to allow interaction when expanded
  },
  // Action button styles moved to GameControls component (Task #425)
  cardHandContainer: {
    // Cards display below player and buttons
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
