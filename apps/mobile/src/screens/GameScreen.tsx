import React, { useState, useEffect, useRef, useCallback, Profiler } from 'react';
import { View, Text, StyleSheet, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, RouteProp, useNavigation, NavigationProp } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { CardHand, PlayerInfo, GameSettingsModal, HelperButtons, GameControls, GameLayout } from '../components/game';
import { ScoreboardContainer } from '../components/scoreboard';
import type { Card } from '../game/types';
import type { FinalScore } from '../types/gameEnd';
import type { ScoreHistory, PlayHistoryMatch } from '../types/scoreboard';
import { COLORS, SPACING, FONT_SIZES, LAYOUT, OVERLAYS, POSITIONING } from '../constants';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../services/supabase';
import { useGameStateManager } from '../hooks/useGameStateManager';
import { useBotCoordinator } from '../hooks/useBotCoordinator';
import { useRealtime } from '../hooks/useRealtime';
import { gameLogger } from '../utils/logger';
import { ScoreboardProvider, useScoreboard } from '../contexts/ScoreboardContext';
import { usePlayHistoryTracking } from '../hooks/usePlayHistoryTracking';

// Delay between user actions to prevent rapid repeated presses (milliseconds)
const ACTION_DEBOUNCE_MS = 300;
import { soundManager, hapticManager, SoundType, showError, showInfo, showConfirm, performanceMonitor } from '../utils';
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
import { sortCardsForDisplay } from '../utils/cardSorting';

type GameScreenRouteProp = RouteProp<RootStackParamList, 'Game'>;
type GameScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Game'>;

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
  
  // PHASE 6: Detect game mode
  const isLocalAIGame = roomCode === 'LOCAL_AI_GAME';
  const isMultiplayerGame = !isLocalAIGame;
  
  gameLogger.info(`🎮 [GameScreen] Game mode: ${isLocalAIGame ? 'LOCAL AI (client-side)' : 'MULTIPLAYER (server-side)'}`);
  
  // PHASE 6: State for multiplayer room data
  const [multiplayerRoomId, setMultiplayerRoomId] = useState<string | null>(null);
  const [multiplayerPlayers, setMultiplayerPlayers] = useState<any[]>([]);
  
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

  // PHASE 6: Initialize multiplayer room data if needed
  useEffect(() => {
    if (!isMultiplayerGame) return;
    
    const loadMultiplayerRoom = async () => {
      try {
        const { data: roomData, error: roomError } = await supabase
          .from('rooms')
          .select('id')
          .eq('code', roomCode)
          .single();
        
        if (roomError || !roomData) {
          gameLogger.error('[GameScreen] Multiplayer room not found:', roomError);
          showError('Room not found');
          navigation.replace('Home');
          return;
        }
        
        setMultiplayerRoomId(roomData.id);
        
        // Load players
        const { data: playersData, error: playersError } = await supabase
          .from('room_players')
          .select('*')
          .eq('room_id', roomData.id)
          .order('player_index');
        
        if (playersError) throw playersError;
        
        setMultiplayerPlayers(playersData || []);
        gameLogger.info(`[GameScreen] Loaded ${playersData?.length || 0} players from room`);
      } catch (error: any) {
        gameLogger.error('[GameScreen] Error loading multiplayer room:', error?.message || String(error));
      }
    };
    
    loadMultiplayerRoom();
  }, [isMultiplayerGame, roomCode, navigation]);
  
  // PHASE 6: Determine if current user is host (bot coordinator)
  const isHostPlayer = multiplayerPlayers.find(p => p.user_id === user?.id)?.is_host || false;
  
  // Bot turn management hook (Task #Phase 2B) - only for LOCAL games
  const gameManagerRefPlaceholder = useRef<any>(null);
  const { checkAndExecuteBotTurn } = useBotTurnManager({
    gameManagerRef: gameManagerRefPlaceholder,
  });

  // PHASE 6: Client-side game state (LOCAL AI games only)
  const { gameManagerRef, gameState: localGameState, isInitializing } = useGameStateManager({
    roomCode,
    currentPlayerName,
    addScoreHistory,
    openGameEndModal: (winnerName: string, winnerPosition: number, finalScores: FinalScore[], playerNames: string[], scoreHistory: ScoreHistory[], playHistory: PlayHistoryMatch[]) => {
      openGameEndModal(winnerName, winnerPosition, finalScores, playerNames, scoreHistory, playHistory);
    },
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
  
  // PHASE 6: Server-side multiplayer game state (MULTIPLAYER games only)
  const { 
    gameState: multiplayerGameState, 
    playerHands: multiplayerPlayerHands,
    isConnected: isMultiplayerConnected,
    playCards: multiplayerPlayCards,
    pass: multiplayerPass,
  } = useRealtime({
    userId: user?.id || '',
    username: currentPlayerName,
    onError: (error) => {
      gameLogger.error('[GameScreen] Multiplayer error:', error.message);
      showError(error.message);
    },
    onDisconnect: () => {
      gameLogger.warn('[GameScreen] Multiplayer disconnected');
      showInfo('Connection lost. Reconnecting...');
    },
    onReconnect: () => {
      gameLogger.info('[GameScreen] Multiplayer reconnected');
      showInfo('Reconnected!');
    },
  });
  
  // PHASE 6: Bot coordinator hook (MULTIPLAYER games with bots, HOST only)
  useBotCoordinator({
    roomId: multiplayerRoomId,
    isCoordinator: isMultiplayerGame && isHostPlayer,
    gameState: multiplayerGameState,
    players: multiplayerPlayers,
  });
  
  // PHASE 6: Unified game state (switch based on mode)
  const gameState = isLocalAIGame ? localGameState : (multiplayerGameState as any); // Cast to avoid type conflicts

  // Task #355: Play history tracking - automatically sync game plays to scoreboard
  usePlayHistoryTracking(localGameState); // Only track local game (multiplayer uses different system)

  // Derived game state hook (Task #Phase 2B) - only for local games
  const {
    playerHand,
    lastPlayedCards,
    lastPlayedBy,
    lastPlayComboType,
    lastPlayCombo,
  } = useDerivedGameState({
    gameState: localGameState,
    customCardOrder,
    setCustomCardOrder,
  });

  // Scoreboard mapping hook (Task #Phase 2B) - only for local games
  const {
    players,
    mapPlayersToScoreboardOrder,
    mapGameIndexToScoreboardPosition,
  } = useScoreboardMapping({
    gameState: localGameState,
    currentPlayerName,
  });

  // Helper buttons hook (Task #Phase 2B) - only for local games
  const { handleSort, handleSmartSort, handleHint } = useHelperButtons({
    playerHand,
    lastPlay: localGameState?.lastPlay || null,
    isFirstPlay:
      localGameState?.lastPlay === null && localGameState?.players.every((p) => p.hand.length === 13),
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
  // CRITICAL FIX: Also unlock orientation when navigating away to prevent orientation lock from persisting
  useEffect(() => {
    // Track if component is being unmounted due to navigation away
    let isDeliberateLeave = false;
    
    // Listen for navigation events to detect deliberate exits
    const allowedActionTypes = ['POP', 'GO_BACK', 'NAVIGATE'];
    const unsubscribe = navigation.addListener('beforeRemove', async (e: any) => {
      // Only set as deliberate leave for certain navigation actions (e.g., back, pop, custom leave)
      const actionType = e?.data?.action?.type;
      if (
        typeof actionType === 'string' &&
        allowedActionTypes.includes(actionType)
      ) {
        isDeliberateLeave = true;
        
        // CRITICAL FIX: Unlock orientation immediately when leaving GameScreen
        // This ensures other screens can auto-rotate properly
        if (orientationAvailable) {
          try {
            const ScreenOrientation = require('expo-screen-orientation');
            await ScreenOrientation.unlockAsync();
            gameLogger.info('🔓 [Orientation] Unlocked on navigation away from GameScreen');
          } catch (error) {
            gameLogger.error('❌ [Orientation] Failed to unlock on navigation:', error);
          }
        }
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
  }, [user, roomCode, navigation, orientationAvailable]);

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

  // CRITICAL FIX: Play/Pass action handlers - defined in GameScreen to work in BOTH orientations
  // Previously these were only set by GameControls which is only mounted in portrait mode
  // PHASE 6: Updated to support both local and multiplayer modes
  const [isPlayingCards, setIsPlayingCards] = useState(false);
  const [isPassing, setIsPassing] = useState(false);

  const handlePlayCards = useCallback(async (cards: Card[]) => {
    // PHASE 6: Route to appropriate game engine
    if (isLocalAIGame) {
      // Local AI game - use GameStateManager
      if (!gameManagerRef.current) {
        gameLogger.error('❌ [GameScreen] Game not initialized');
        return;
      }

      // Prevent duplicate card plays
      if (isPlayingCards) {
        gameLogger.debug('⏭️ [GameScreen] Card play already in progress, ignoring...');
        return;
      }

      try {
        setIsPlayingCards(true);

        // Task #270: Add haptic feedback for Play button
        hapticManager.playCard();

        // Task #313: Auto-sort cards for proper display order before submission
        // This ensures straights are played as 6-5-4-3-2 (highest first) not 3-4-5-6-2
        const sortedCards = sortCardsForDisplay(cards);
        const cardIds = sortedCards.map(card => card.id);
        
        await gameManagerRef.current.playCards(cardIds);
        setSelectedCardIds(new Set());
        soundManager.playSound(SoundType.CARD_PLAY);
      } catch (error: any) {
        gameLogger.error('❌ [GameScreen] Error playing cards:', error?.message || String(error));
        showError(error.message || 'Failed to play cards');
      } finally {
        setIsPlayingCards(false);
      }
    } else {
      // Multiplayer game - use Realtime hook
      if (!multiplayerPlayCards) {
        gameLogger.error('❌ [GameScreen] Multiplayer not initialized');
        return;
      }

      if (isPlayingCards) {
        gameLogger.debug('⏭️ [GameScreen] Card play already in progress, ignoring...');
        return;
      }

      try {
        setIsPlayingCards(true);
        hapticManager.playCard();
        
        const sortedCards = sortCardsForDisplay(cards);
        // Convert Card[] to string[] (card IDs) for multiplayer API
        const cardIds = sortedCards.map(c => c.id);
        await multiplayerPlayCards(cardIds as any);
        setSelectedCardIds(new Set());
        soundManager.playSound(SoundType.CARD_PLAY);
      } catch (error: any) {
        gameLogger.error('❌ [GameScreen] Error playing cards (multiplayer):', error?.message || String(error));
        showError(error.message || 'Failed to play cards');
      } finally {
        setIsPlayingCards(false);
      }
    }
  }, [isLocalAIGame, gameManagerRef, multiplayerPlayCards, isPlayingCards, setSelectedCardIds]);

  const handlePass = useCallback(async () => {
    // PHASE 6: Route to appropriate game engine
    if (isLocalAIGame) {
      // Local AI game
      if (!gameManagerRef.current) {
        gameLogger.error('❌ [GameScreen] Game not initialized');
        return;
      }

      if (isPassing) {
        gameLogger.debug('⏭️ [GameScreen] Pass already in progress, ignoring...');
        return;
      }

      try {
        setIsPassing(true);

        // Task #270: Add haptic feedback for Pass button
        hapticManager.pass();

        await gameManagerRef.current.pass();
        setSelectedCardIds(new Set());
        soundManager.playSound(SoundType.PASS);
      } catch (error: any) {
        gameLogger.error('❌ [GameScreen] Error passing:', error?.message || String(error));
        showError(error.message || 'Failed to pass');
      } finally {
        setIsPassing(false);
      }
    } else {
      // Multiplayer game
      if (!multiplayerPass) {
        gameLogger.error('❌ [GameScreen] Multiplayer not initialized');
        return;
      }

      if (isPassing) {
        gameLogger.debug('⏭️ [GameScreen] Pass already in progress, ignoring...');
        return;
      }

      try {
        setIsPassing(true);
        hapticManager.pass();
        
        await multiplayerPass();
        setSelectedCardIds(new Set());
        soundManager.playSound(SoundType.PASS);
      } catch (error: any) {
        gameLogger.error('❌ [GameScreen] Error passing (multiplayer):', error?.message || String(error));
        showError(error.message || 'Failed to pass');
      } finally {
        setIsPassing(false);
      }
    }
  }, [isLocalAIGame, gameManagerRef, multiplayerPass, isPassing, setSelectedCardIds]);

  // Refs to access play/pass handlers for drag-to-play from CardHand
  const onPlayCardsRef = useRef<((cards: Card[]) => Promise<void>) | null>(null);
  const onPassRef = useRef<(() => Promise<void>) | null>(null);

  // Set refs on mount and whenever handlers change
  useEffect(() => {
    onPlayCardsRef.current = handlePlayCards;
    onPassRef.current = handlePass;
  }, [handlePlayCards, handlePass]);

  // Callback handlers for GameControls component (for portrait mode)
  const handlePlaySuccess = () => {
    // Clear selection after successful play (for portrait mode)
    if (isMountedRef.current) {
      setSelectedCardIds(new Set());
    }
  };

  const handlePassSuccess = () => {
    // Clear selection after successful pass (for portrait mode)
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
        {/* Spectator Mode Banner - Show if player is spectating */}
        {/* TODO: Integrate with useConnectionManager to detect spectator status */}
        {false && ( // Placeholder - will be enabled when useConnectionManager is integrated
          <View style={styles.spectatorBanner}>
            <Text style={styles.spectatorEmoji}>👁️</Text>
            <View style={styles.spectatorTextContainer}>
              <Text style={styles.spectatorTitle}>{i18n.t('game.spectatorMode')}</Text>
              <Text style={styles.spectatorDescription}>{i18n.t('game.spectatorDescription')}</Text>
            </View>
          </View>
        )}
        
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
            playerNames={localGameState ? mapPlayersToScoreboardOrder(localGameState.players, (p: any) => p.name) : []}
            currentScores={localGameState && localGameState.matchScores ? mapPlayersToScoreboardOrder(localGameState.matchScores, (s: any) => s.score) : []}
            cardCounts={localGameState ? mapPlayersToScoreboardOrder(localGameState.players, (p: any) => p.hand.length) : []}
            currentPlayerIndex={mapGameIndexToScoreboardPosition(localGameState?.currentPlayerIndex ?? 0)}
            matchNumber={localGameState?.currentMatch ?? 1}
            isGameFinished={localGameState?.gameOver ?? false}
            scoreHistory={scoreHistory}
            playHistory={playHistoryByMatch}
            originalPlayerNames={localGameState ? localGameState.players.map((p: any) => p.name) : []}
            autoPassTimerState={localGameState?.auto_pass_timer ?? undefined}

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
              handlePlayCards(cards);
            }}

            // Control callbacks
            onOrientationToggle={toggleOrientation}
            onHelp={() => gameLogger.info('Help requested')}
            onSort={handleSort}
            onSmartSort={handleSmartSort}
            onPlay={() => {
              gameLogger.info('🎴 [Landscape] Play button pressed with selected cards:', selectedCards.length);
              handlePlayCards(selectedCards);
            }}
            onPass={() => {
              gameLogger.info('🎴 [Landscape] Pass button pressed');
              handlePass();
            }}
            onHint={handleHint}
            onSettings={() => setShowSettings(true)}

            // Control states - CRITICAL FIX: Ensure game state is initialized before enabling controls
            disabled={false}
            canPlay={players[0].isActive && selectedCards.length > 0 && !!gameState && !!gameManagerRef.current}
            canPass={players[0].isActive && !!gameState && !!gameManagerRef.current}
          />
        ) : (
          // PORTRAIT MODE (existing layout)
          <>
            {/* Scoreboard Container (top-left, with expand/collapse & play history) */}
            <ScoreboardContainer
            playerNames={localGameState ? mapPlayersToScoreboardOrder(localGameState.players, (p: any) => p.name) : []}
            currentScores={localGameState && localGameState.matchScores ? mapPlayersToScoreboardOrder(localGameState.matchScores, (s: any) => s.score) : []}
            cardCounts={localGameState ? mapPlayersToScoreboardOrder(localGameState.players, (p: any) => p.hand.length) : []}
            currentPlayerIndex={mapGameIndexToScoreboardPosition(localGameState?.currentPlayerIndex ?? 0)}
            matchNumber={localGameState?.currentMatch ?? 1}
            isGameFinished={localGameState?.gameOver ?? false}
            scoreHistory={scoreHistory}
            playHistory={playHistoryByMatch}
            originalPlayerNames={localGameState ? localGameState.players.map((p: any) => p.name) : []}
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
              🔄
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

          {/* PlayerInfo - INDEPENDENT ABSOLUTE POSITIONING */}
          <View style={styles.playerInfoContainer}>
            <PlayerInfo
              name={players[0].name}
              cardCount={players[0].cardCount}
              isActive={players[0].isActive}
            />
          </View>
          
          {/* Action buttons (Play/Pass) - INDEPENDENT ABSOLUTE POSITIONING */}
          <View style={styles.actionButtonsRow}>
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
          
          {/* Helper Buttons Row (Sort/Smart/Hint) - INDEPENDENT ABSOLUTE POSITIONING */}
          <View style={styles.helperButtonsRow}>
            <HelperButtons
              onSort={handleSort}
              onSmartSort={handleSmartSort}
              onHint={handleHint}
              disabled={playerHand.length === 0}
            />
          </View>

          {/* Player's hand - INDEPENDENT - NOT AFFECTED BY BUTTONS */}
          <View style={styles.cardHandContainer}>
            <CardHand
              cards={playerHand}
              onPlayCards={handleCardHandPlayCards} // FIXED: Wire to GameControls for drag-to-play
              onPass={handleCardHandPass} // FIXED: Wire to GameControls for drag-to-pass
              canPlay={players[0].isActive && !!gameState && !!gameManagerRef.current}
              disabled={false}
              hideButtons={true} // Hide internal buttons since we display them externally
              selectedCardIds={selectedCardIds}
              onSelectionChange={setSelectedCardIds}
              onCardsReorder={handleCardsReorder}
            />
          </View>
        </>
      )}
      
      {/* Game End Modal (Task #415) - CRITICAL FIX: Render OUTSIDE orientation conditional so it works in BOTH portrait AND landscape */}
      <GameEndErrorBoundary onReset={() => {}}>
        <GameEndModal />
      </GameEndErrorBoundary>
      
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
  // PlayerInfo - FULLY INDEPENDENT positioning
  playerInfoContainer: {
    position: 'absolute',
    bottom: POSITIONING.playerInfoBottom,
    left: POSITIONING.playerInfoLeft,
    zIndex: 250,
  },
  // Action buttons (Play/Pass) - FULLY INDEPENDENT positioning
  actionButtonsRow: {
    position: 'absolute',
    bottom: POSITIONING.actionButtonsBottom,
    right: POSITIONING.actionButtonsRight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    zIndex: 180,
  },
  // Helper Buttons (Sort/Smart/Hint) - FULLY INDEPENDENT positioning
  helperButtonsRow: {
    position: 'absolute',
    bottom: POSITIONING.helperButtonsBottom,
    left: POSITIONING.helperButtonsLeft,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    zIndex: 170,
  },
  // CARDS - FULLY INDEPENDENT positioning
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
  // Spectator Mode Banner Styles
  spectatorBanner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(33, 150, 243, 0.95)', // Blue with transparency
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 1000, // Above everything
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  spectatorEmoji: {
    fontSize: 32,
    marginRight: SPACING.md,
  },
  spectatorTextContainer: {
    flex: 1,
  },
  spectatorTitle: {
    color: COLORS.white,
    fontSize: FONT_SIZES.md,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  spectatorDescription: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: FONT_SIZES.sm,
    lineHeight: 18,
  },
});
