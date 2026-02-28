import React, { useState, useEffect, useRef, Profiler } from 'react';
import { View, Text, Pressable, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRoute, RouteProp, useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { CardHand, PlayerInfo, GameSettingsModal, HelperButtons, GameControls, GameLayout } from '../components/game';
import { GameEndModal, GameEndErrorBoundary } from '../components/gameEnd';
import { LandscapeGameLayout } from '../components/gameRoom/LandscapeGameLayout';
import { ScoreboardContainer } from '../components/scoreboard';
import { useAuth } from '../contexts/AuthContext';
import { GameEndProvider, useGameEnd } from '../contexts/GameEndContext';
import { ScoreboardProvider, useScoreboard } from '../contexts/ScoreboardContext';
import { useBotCoordinator } from '../hooks/useBotCoordinator';
import { useBotTurnManager } from '../hooks/useBotTurnManager';
import { useCardSelection } from '../hooks/useCardSelection';
import { useDerivedGameState } from '../hooks/useDerivedGameState';
import { useGameActions } from '../hooks/useGameActions';
import { useGameAudio } from '../hooks/useGameAudio';
import { useGameCleanup } from '../hooks/useGameCleanup';
import { useGameEndCallbacks } from '../hooks/useGameEndCallbacks';
import { useGameStateManager } from '../hooks/useGameStateManager';
import { useHelperButtons } from '../hooks/useHelperButtons';
import { useMatchEndHandler } from '../hooks/useMatchEndHandler';
import { useMultiplayerLayout } from '../hooks/useMultiplayerLayout';
import { useMultiplayerPlayHistory } from '../hooks/useMultiplayerPlayHistory';
import { useMultiplayerRoomLoader } from '../hooks/useMultiplayerRoomLoader';
import { useOneCardLeftAlert } from '../hooks/useOneCardLeftAlert';
import { useOrientationManager } from '../hooks/useOrientationManager';
import { usePlayerDisplayData } from '../hooks/usePlayerDisplayData';
import { usePlayerTotalScores } from '../hooks/usePlayerTotalScores';
import { usePlayHistoryTracking } from '../hooks/usePlayHistoryTracking';
import { useRealtime } from '../hooks/useRealtime';
import { useScoreboardMapping } from '../hooks/useScoreboardMapping';
import { i18n } from '../i18n';
import { RootStackParamList } from '../navigation/AppNavigator';
import { scoreDisplayStyles } from '../styles/scoreDisplayStyles';
import { gameScreenStyles as styles } from '../styles/gameScreenStyles';
import {
  showError,
  performanceMonitor,
} from '../utils';
import { gameLogger } from '../utils/logger';
import { parseMultiplayerHands } from '../utils/parseMultiplayerHands';
import type { Card } from '../game/types';
import type { GameStateManager } from '../game/state';
import type { FinalScore } from '../types/gameEnd';
import type { GameState as MultiplayerGameState, Player as MultiplayerPlayer } from '../types/multiplayer';
import type { ScoreHistory, PlayHistoryMatch } from '../types/scoreboard';

type GameScreenRouteProp = RouteProp<RootStackParamList, 'Game'>;
type GameScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Game'>;

function GameScreenContent() {
  const route = useRoute<GameScreenRouteProp>();
  const navigation = useNavigation<GameScreenNavigationProp>();
  const { user, profile } = useAuth();
  const scoreboardContext = useScoreboard(); // Get entire context
  const { 
    addScoreHistory, 
    addPlayHistory,
    restoreScoreHistory,
    scoreHistory, 
    playHistoryByMatch 
  } = scoreboardContext; // Task #351 & #352 & #355
  const { openGameEndModal, setOnPlayAgain, setOnReturnToMenu } = useGameEnd(); // Task #415, #416, #417
  const { roomCode, forceNewGame = false, botDifficulty = 'medium' } = route.params;
  const [showSettings, setShowSettings] = useState(false);
  
  // Store refs to always get latest context values (prevent stale closure)
  const scoreboardRef = useRef(scoreboardContext);
  useEffect(() => {
    scoreboardRef.current = scoreboardContext;
  }, [scoreboardContext]);
  
  // PHASE 6: Detect game mode
  const isLocalAIGame = roomCode === 'LOCAL_AI_GAME';
  const isMultiplayerGame = !isLocalAIGame;
  
  gameLogger.info(`🎮 [GameScreen] Game mode: ${isLocalAIGame ? 'LOCAL AI (client-side)' : 'MULTIPLAYER (server-side)'}`);
  
  // PHASE 6: State for multiplayer room data
  const [multiplayerPlayers, setMultiplayerPlayers] = useState<MultiplayerPlayer[]>([]);
  
  // Orientation manager (Task #450) - gracefully handles missing native module
  const { currentOrientation, toggleOrientation, isAvailable: orientationAvailable } = useOrientationManager();

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

  // PHASE 6: Initialize multiplayer room data if needed (extracted to useMultiplayerRoomLoader)
  useMultiplayerRoomLoader({ isMultiplayerGame, roomCode, navigation, setMultiplayerPlayers });

  // Bot turn management hook (Task #Phase 2B) - only for LOCAL games
  const gameManagerRefPlaceholder = useRef<GameStateManager | null>(null);
  const { checkAndExecuteBotTurn } = useBotTurnManager({
    gameManagerRef: gameManagerRefPlaceholder,
  });

  // PHASE 6: Client-side game state (LOCAL AI games only)
  const { gameManagerRef, gameState: localGameState, isInitializing } = useGameStateManager({
    roomCode,
    currentPlayerName,
    forceNewGame,
    isLocalGame: isLocalAIGame, // CRITICAL: Only init for local games, not multiplayer!
    botDifficulty, // Task #596: Pass difficulty from route params
    addScoreHistory,
    restoreScoreHistory,
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
    isHost: isMultiplayerHost,
    isDataReady: isMultiplayerDataReady, // BULLETPROOF: Game state fully loaded
    players: realtimePlayers,
    playCards: multiplayerPlayCards,
    pass: multiplayerPass,
    connectToRoom: multiplayerConnectToRoom,
  } = useRealtime({
    userId: user?.id || '',
    username: currentPlayerName,
    onError: (error) => {
      gameLogger.error('[GameScreen] Multiplayer error:', error.message);
      // Only show critical errors, not connection issues or turn race conditions
      const msg = error.message?.toLowerCase() || '';
      if (msg.includes('connection') || msg.includes('reconnect') || msg.includes('not your turn')) {
        gameLogger.warn('⚠️ [GameScreen] Suppressed non-critical multiplayer error from UI');
        return;
      }
      showError(error.message);
    },
    onDisconnect: () => {
      gameLogger.warn('[GameScreen] Multiplayer disconnected');
      // NOTE: Auto-reconnection is handled internally by useRealtime
      // Do NOT call reconnect() here to avoid infinite loop
    },
    onReconnect: () => {
      gameLogger.info('[GameScreen] Multiplayer reconnected successfully');
      // Silent reconnection - no alert spam
    },
    onMatchEnded: (matchNumber, matchScores) => {
      gameLogger.info(`[GameScreen] 🏆 Match ${matchNumber} ended! Adding scores to scoreboard...`, matchScores);
      
      // Convert match scores to ScoreHistory format
      const pointsAdded: number[] = [];
      const cumulativeScores: number[] = [];
      
      // Sort by player_index to ensure correct order
      const sortedScores = [...matchScores].sort((a, b) => a.player_index - b.player_index);
      
      sortedScores.forEach(score => {
        pointsAdded.push(score.matchScore);
        cumulativeScores.push(score.cumulativeScore);
      });
      
      const scoreHistoryEntry: ScoreHistory = {
        matchNumber,
        pointsAdded,
        scores: cumulativeScores,
        timestamp: new Date().toISOString(),
      };
      
      gameLogger.info('[GameScreen] 📊 Adding score history entry:', scoreHistoryEntry);
      addScoreHistory(scoreHistoryEntry);
    },
  });

  // PHASE 6: Ensure multiplayer realtime channel is joined when entering the Game screen.
  // Lobby -> Game happens AFTER room status becomes 'playing', so joinRoom() cannot be used here.
  useEffect(() => {
    if (!isMultiplayerGame) return;
    if (!user?.id) return;

    multiplayerConnectToRoom(roomCode).catch((error: Error) => {
      console.error('[GameScreen] ❌ Failed to connect:', error);
      gameLogger.error('[GameScreen] Failed to connect:', error?.message || String(error));
      showError(error?.message || 'Failed to connect to room');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMultiplayerGame, roomCode, user?.id]); // Removed multiplayerConnectToRoom to prevent infinite reconnect loop

  // ─── MULTIPLAYER SCORE HISTORY PERSISTENCE ─────────────────────────────────
  // Per-room AsyncStorage key so different rooms don't clobber each other.
  // Restore on mount (rejoin); persist whenever scoreHistory changes.
  const ROOM_SCORE_KEY = `@big2_score_history_${roomCode}`;
  const hasRestoredMultiplayerScoresRef = useRef(false);

  // 1. Restore score history for this room on mount (multiplayer only)
  useEffect(() => {
    if (!isMultiplayerGame) return;
    if (hasRestoredMultiplayerScoresRef.current) return;

    (async () => {
      try {
        const stored = await AsyncStorage.getItem(ROOM_SCORE_KEY);
        if (stored) {
          const parsed: ScoreHistory[] = JSON.parse(stored);
          if (Array.isArray(parsed) && parsed.length > 0) {
            gameLogger.info(`[GameScreen] 🔄 Restoring ${parsed.length} score history entries for room ${roomCode}`);
            restoreScoreHistory(parsed);
          }
        }
      } catch (err: unknown) {
        gameLogger.error('[GameScreen] Failed to restore multiplayer score history:', err instanceof Error ? err.message : String(err));
      } finally {
        hasRestoredMultiplayerScoresRef.current = true;
      }
    })();
  }, [isMultiplayerGame, ROOM_SCORE_KEY, roomCode, restoreScoreHistory]);

  // 2. Persist score history for this room whenever it changes (multiplayer only)
  const isFirstMultiplayerRenderRef = useRef(true);
  useEffect(() => {
    if (!isMultiplayerGame) return;
    if (isFirstMultiplayerRenderRef.current) {
      isFirstMultiplayerRenderRef.current = false;
      return;
    }
    if (scoreHistory.length > 0) {
      AsyncStorage.setItem(ROOM_SCORE_KEY, JSON.stringify(scoreHistory)).catch((err) => {
        gameLogger.error('[GameScreen] Failed to persist multiplayer score history:', err?.message || String(err));
      });
    }
  }, [isMultiplayerGame, scoreHistory, ROOM_SCORE_KEY]);
  // ─────────────────────────────────────────────────────────────────────────────

  // MULTIPLAYER HANDS MEMO - MUST BE DEFINED BEFORE playersWithCards!!!
  const multiplayerHandsByIndex = React.useMemo(() => {
    const hands = multiplayerGameState?.hands;
    return parseMultiplayerHands(hands as Record<string, ({ id: string; rank: string; suit: string } | string)[]> | undefined);
  }, [multiplayerGameState]);
  
  // PHASE 6: Merge player hands into players for bot coordinator
  // Bot coordinator needs cards, but multiplayerPlayers only has metadata from room_players table
  // Hands are fetched separately via useRealtime's playerHands Map
  // CRITICAL FIX: Use player_index as key for hands (bots have null user_id!)
  const playersWithCards = React.useMemo(() => {
    if (!multiplayerPlayers) {
      return [];
    }
    
    // CRITICAL FIX: Always return players with cards property (even if empty)
    // Don't return early when hands are missing - just use empty arrays
    // This ensures useBotCoordinator always receives consistent player structure
    const hasHands = !!multiplayerHandsByIndex;
    
    const result = multiplayerPlayers.map((player) => {
      // Get hand for this player using their player_index (works for both humans and bots)
      const playerHandKey = String(player.player_index);
      const playerHand = hasHands ? multiplayerHandsByIndex[playerHandKey] : undefined;
      
      const withCards = {
        ...player,
        player_id: player.id, // Expose room_players.id as player_id for RPC calls
        cards: (Array.isArray(playerHand) ? playerHand : []) as Card[],
      };
      
      return withCards;
    });
    
    return result;
  }, [multiplayerHandsByIndex, multiplayerPlayers]);
  
  // DIAGNOSTIC: Track coordinator status
  useEffect(() => {
    if (!isMultiplayerGame) return;
    
    const coordinatorStatus = isMultiplayerDataReady && isMultiplayerHost && playersWithCards.length > 0;
    gameLogger.info('[GameScreen] 🎯 Coordinator Status:', {
      isCoordinator: coordinatorStatus,
      breakdown: {
        isMultiplayerGame,
        isMultiplayerDataReady,
        isMultiplayerHost,
        playersWithCardsCount: playersWithCards.length,
      },
      will_trigger_bots: coordinatorStatus,
    });
  }, [isMultiplayerGame, isMultiplayerDataReady, isMultiplayerHost, realtimePlayers, multiplayerGameState, playersWithCards]);
  
  // PHASE 6: Bot coordinator hook (MULTIPLAYER games with bots, HOST only)
  // BULLETPROOF: Only enable when:
  // 1. Game state is fully loaded with hands (isMultiplayerDataReady)
  // 2. Current user is the host (isMultiplayerHost)
  // 3. Players array is populated (playersWithCards.length > 0)
  useBotCoordinator({
    roomCode: roomCode, // Pass room code (string) not room ID (UUID)
    isCoordinator: isMultiplayerGame && isMultiplayerDataReady && isMultiplayerHost && playersWithCards.length > 0,
    gameState: multiplayerGameState,
    players: playersWithCards,
    playCards: multiplayerPlayCards,
    passMove: multiplayerPass,
  });
  
  // PHASE 6: Unified game state (LOCAL only). Multiplayer uses server state shape.
  const gameState = isLocalAIGame ? localGameState : null;

  // Task #355: Play history tracking - automatically sync game plays to scoreboard
  usePlayHistoryTracking(localGameState); // Only track local game (multiplayer uses different system)
  
  // CRITICAL FIX: Multiplayer play history tracking (extracted to useMultiplayerPlayHistory)
  useMultiplayerPlayHistory({
    isMultiplayerGame,
    multiplayerGameState: multiplayerGameState as MultiplayerGameState | null,
    addPlayHistory,
  });
  
  // CRITICAL FIX: One card left detection for ALL players (extracted to useOneCardLeftAlert)
  useOneCardLeftAlert({ isLocalAIGame, gameState, multiplayerGameState, multiplayerPlayers, roomCode });

  // CRITICAL FIX: Detect multiplayer game end and open modal (extracted to useMatchEndHandler)
  useMatchEndHandler({
    isMultiplayerGame,
    multiplayerGameState: multiplayerGameState as MultiplayerGameState | null,
    multiplayerPlayers,
    scoreHistory: scoreHistory || [],
    playHistoryByMatch: playHistoryByMatch || [],
    openGameEndModal,
  });

  // Derived game state hook (Task #Phase 2B)
  const {
    playerHand: localPlayerHand,
    lastPlayedCards: localLastPlayedCards,
    lastPlayedBy: localLastPlayedBy,
    lastPlayComboType: localLastPlayComboType,
    lastPlayCombo: localLastPlayCombo,
  } = useDerivedGameState({
    gameState,
    customCardOrder,
    setCustomCardOrder,
  });

  // Scoreboard mapping hook (Task #Phase 2B)
  const {
    players,
  } = useScoreboardMapping({
    gameState,
    currentPlayerName,
  });

  // -------------------------------
  // MULTIPLAYER UI DERIVED STATE (extracted to useMultiplayerLayout)
  // -------------------------------
  const {
    multiplayerPlayerHand,
    multiplayerLastPlay,
    multiplayerLastPlayedCards,
    multiplayerLastPlayedBy,
    multiplayerLastPlayComboType,
    multiplayerLastPlayCombo,
    multiplayerLayoutPlayers,
  } = useMultiplayerLayout({
    multiplayerPlayers,
    multiplayerHandsByIndex,
    multiplayerGameState: multiplayerGameState as MultiplayerGameState | null,
    userId: user?.id,
  });

  // multiplayerHandsByIndex moved above playersWithCards to fix bot card loading

  // Compute effective values BEFORE helper buttons hook (CRITICAL BUG FIX Dec 27 2025)
  // Helper buttons need the ACTUAL hand being displayed, not just localPlayerHand
  // SAFETY: Ensure we always have an array (never undefined) to prevent filter crashes
  // CRITICAL FIX Dec 27: Use React.useMemo with proper deps to recompute when multiplayer hand changes!
  // CRITICAL FIX Dec 27 #2: Apply customCardOrder to multiplayer hands as well!
  const effectivePlayerHand: Card[] = React.useMemo(() => {
    const hand = isLocalAIGame ? localPlayerHand : multiplayerPlayerHand;
    let result = (hand ?? []) as Card[];
    
    // Apply customCardOrder for BOTH local and multiplayer games
    if (customCardOrder.length > 0 && result.length > 0) {
      const orderMap = new Map(customCardOrder.map((id, index) => [id, index]));
      result = [...result].sort((a, b) => {
        const aIndex = orderMap.get(a.id) ?? 999;
        const bIndex = orderMap.get(b.id) ?? 999;
        return aIndex - bIndex;
      });
    }
    
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- multiplayerHandsByIndex is an extra trigger that ensures effectivePlayerHand recomputes when hands update; ESLint flags it as unnecessary but it serves as a safety net for React's dep comparison
  }, [isLocalAIGame, localPlayerHand, multiplayerPlayerHand, multiplayerHandsByIndex, customCardOrder]);
  
  // CRITICAL: Define multiplayerLastPlay BEFORE using it in useHelperButtons!
  // NOTE: multiplayerLastPlay is now provided by useMultiplayerLayout hook
  
  // Helper buttons hook (Task #Phase 2B)
  const { handleSort, handleSmartSort, handleHint } = useHelperButtons({
    playerHand: effectivePlayerHand, // FIXED: Use effective hand (local OR multiplayer)
    lastPlay: isLocalAIGame ? (gameState?.lastPlay || null) : (multiplayerLastPlay || null),
    isFirstPlay: isLocalAIGame 
      ? (gameState?.lastPlay === null && gameState?.players.every((p) => p.hand.length === 13))
      : (multiplayerLastPlay === null),
    customCardOrder,
    setCustomCardOrder,
    setSelectedCardIds,
  });

  // Effective values: multiplayerLastPlay* values now from useMultiplayerLayout

  // Effective values: route to local or multiplayer data
  const effectiveLastPlayedCards = isLocalAIGame ? localLastPlayedCards : multiplayerLastPlayedCards;
  const effectiveLastPlayedBy = isLocalAIGame ? localLastPlayedBy : multiplayerLastPlayedBy;
  const effectiveLastPlayComboType = isLocalAIGame ? localLastPlayComboType : multiplayerLastPlayComboType;
  const effectiveLastPlayCombo = isLocalAIGame ? localLastPlayCombo : multiplayerLastPlayCombo;

  // Register Game End callbacks (extracted to useGameEndCallbacks)
  useGameEndCallbacks({ gameManagerRef, currentPlayerName, botDifficulty, navigation, setOnPlayAgain, setOnReturnToMenu });



  // Cleanup: Remove player from room when deliberately leaving (NOT on every unmount)
  // Navigation cleanup + mount tracking (extracted to useGameCleanup)
  const { isMountedRef } = useGameCleanup({ userId: user?.id, roomCode, navigation, orientationAvailable });

  // Audio/haptic feedback (extracted to useGameAudio)
  useGameAudio({ isLocalAIGame, isMultiplayerGame, gameState, multiplayerGameState });

  // CRITICAL FIX: Play/Pass action handlers (extracted to useGameActions)
  const {
    handlePlayCards,
    handlePass,
    handlePlaySuccess,
    handlePassSuccess,
    handleCardHandPlayCards,
    handleCardHandPass,
    handleLeaveGame,
  } = useGameActions({
    isLocalAIGame,
    gameManagerRef,
    multiplayerPlayCards,
    multiplayerPass,
    setSelectedCardIds,
    navigation,
    isMountedRef,
  });

  // Get selected cards array for GameControls
  // SAFETY: effectivePlayerHand now guaranteed to be array (never undefined)
  const selectedCards = getSelectedCards(effectivePlayerHand);

  const layoutPlayers = isLocalAIGame ? players : multiplayerLayoutPlayers;

  // Task #590: Compute total scores per player for score badges (shared hook)
  const playerTotalScores = usePlayerTotalScores(layoutPlayers, scoreHistory);

  // Display data: memoized arrays, scoreboard index, timer state (extracted to usePlayerDisplayData)
  const {
    memoizedPlayerNames,
    memoizedCurrentScores,
    memoizedCardCounts,
    memoizedOriginalPlayerNames,
    effectiveAutoPassTimerState,
    effectiveScoreboardCurrentPlayerIndex,
    matchNumber,
    isGameFinished,
    layoutPlayersWithScores,
    displayOrderScoreHistory,
  } = usePlayerDisplayData({
    isLocalAIGame,
    gameState,
    multiplayerGameState,
    multiplayerPlayers,
    layoutPlayers,
    scoreHistory,
    playerTotalScores,
    multiplayerLayoutPlayers,
  });

  const hasEffectiveGameState = isLocalAIGame ? !!gameState : !!multiplayerGameState;

  // Performance profiling callback (Task #430)
  // React 19 Profiler signature: (id, phase, actualDuration, baseDuration, startTime, commitTime)
  const onRenderCallback: React.ProfilerOnRenderCallback = (
    id,
    phase,
    actualDuration,
    baseDuration,
    startTime,
    commitTime
  ) => {
    performanceMonitor.logRender(id, phase, actualDuration, baseDuration, startTime, commitTime, new Set());
  };

  return (
    <Profiler id="GameScreen" onRender={onRenderCallback}>
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
            playerNames={memoizedPlayerNames}
            currentScores={memoizedCurrentScores}
            cardCounts={memoizedCardCounts}
            currentPlayerIndex={effectiveScoreboardCurrentPlayerIndex}
            matchNumber={isLocalAIGame ? (gameState?.currentMatch ?? 1) : (multiplayerGameState?.match_number ?? 1)}
            isGameFinished={isGameFinished}
            scoreHistory={displayOrderScoreHistory}
            playHistory={playHistoryByMatch}
            originalPlayerNames={memoizedOriginalPlayerNames}
            autoPassTimerState={effectiveAutoPassTimerState}
            totalScores={playerTotalScores}

            // Table data
            lastPlayedCards={effectiveLastPlayedCards}
            lastPlayedBy={effectiveLastPlayedBy ?? undefined}
            lastPlayComboType={effectiveLastPlayComboType ?? undefined}
            lastPlayCombo={effectiveLastPlayCombo ?? undefined}

            // Player data (bottom center is always index 0 after mapping)
            playerName={layoutPlayers[0]?.name ?? currentPlayerName}
            playerCardCount={layoutPlayers[0]?.cardCount ?? effectivePlayerHand.length}
            playerCards={effectivePlayerHand}
            isPlayerActive={layoutPlayers[0]?.isActive ?? false}
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
            canPlay={(layoutPlayers[0]?.isActive ?? false) && selectedCards.length > 0 && hasEffectiveGameState && (isLocalAIGame ? !!gameManagerRef.current : true)}
            canPass={(layoutPlayers[0]?.isActive ?? false) && hasEffectiveGameState && (isLocalAIGame ? !!gameManagerRef.current : true)}
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

            {/* Scoreboard Container (expanded view + play history modal, Task #590: no more compact) */}
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
            players={layoutPlayersWithScores}
            lastPlayedCards={effectiveLastPlayedCards}
            lastPlayedBy={effectiveLastPlayedBy}
            lastPlayComboType={effectiveLastPlayComboType}
            lastPlayCombo={effectiveLastPlayCombo}
            autoPassTimerState={effectiveAutoPassTimerState}
          />

          {/* PlayerInfo - INDEPENDENT ABSOLUTE POSITIONING */}
          <View style={styles.playerInfoContainer}>
            <PlayerInfo
              name={layoutPlayers[0]?.name ?? currentPlayerName}
              cardCount={layoutPlayers[0]?.cardCount ?? effectivePlayerHand.length}
              isActive={layoutPlayers[0]?.isActive ?? false}
              totalScore={playerTotalScores[0] ?? 0}
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

          {/* Player's hand - INDEPENDENT - NOT AFFECTED BY BUTTONS */}
          <View style={styles.cardHandContainer}>
            <CardHand
              cards={effectivePlayerHand}
              onPlayCards={handleCardHandPlayCards} // FIXED: Wire to GameControls for drag-to-play
              onPass={handleCardHandPass} // FIXED: Wire to GameControls for drag-to-pass
              canPlay={(layoutPlayers[0]?.isActive ?? false) && hasEffectiveGameState && (isLocalAIGame ? !!gameManagerRef.current : true)}
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
