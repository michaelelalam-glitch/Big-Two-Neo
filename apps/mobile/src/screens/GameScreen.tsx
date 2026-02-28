import React, { useState, useEffect, useRef, Profiler } from 'react';
import { View, Text, Pressable, TouchableOpacity } from 'react-native';
import { useRoute, RouteProp, useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { CardHand, PlayerInfo, GameSettingsModal, HelperButtons, GameControls, GameLayout } from '../components/game';
import { GameEndModal, GameEndErrorBoundary } from '../components/gameEnd';
import { LandscapeGameLayout } from '../components/gameRoom/LandscapeGameLayout';
import { ScoreboardContainer } from '../components/scoreboard';
import { COLORS, SPACING, FONT_SIZES, LAYOUT, OVERLAYS, POSITIONING } from '../constants';
import { useAuth } from '../contexts/AuthContext';
import { GameEndProvider, useGameEnd } from '../contexts/GameEndContext';
import { ScoreboardProvider, useScoreboard } from '../contexts/ScoreboardContext';
import { useBotCoordinator } from '../hooks/useBotCoordinator';
import { useBotTurnManager } from '../hooks/useBotTurnManager';
import { useCardSelection } from '../hooks/useCardSelection';
import { useDerivedGameState } from '../hooks/useDerivedGameState';
import { useGameActions } from '../hooks/useGameActions';
import { useGameStateManager } from '../hooks/useGameStateManager';
import { useHelperButtons } from '../hooks/useHelperButtons';
import { useMatchEndHandler } from '../hooks/useMatchEndHandler';
import { useMultiplayerLayout } from '../hooks/useMultiplayerLayout';
import { useMultiplayerPlayHistory } from '../hooks/useMultiplayerPlayHistory';
import { useOrientationManager } from '../hooks/useOrientationManager';
import { usePlayerTotalScores } from '../hooks/usePlayerTotalScores';
import { usePlayHistoryTracking } from '../hooks/usePlayHistoryTracking';
import { useRealtime } from '../hooks/useRealtime';
import { useScoreboardMapping } from '../hooks/useScoreboardMapping';
import { i18n } from '../i18n';
import { RootStackParamList } from '../navigation/AppNavigator';
import { supabase } from '../services/supabase';
import { scoreDisplayStyles } from '../styles/scoreDisplayStyles';
import { gameScreenStyles as styles } from '../styles/gameScreenStyles';
import {
  soundManager,
  hapticManager,
  HapticType,
  SoundType,
  showError,
  performanceMonitor,
} from '../utils';
import { gameLogger } from '../utils/logger';
import { parseMultiplayerHands } from '../utils/parseMultiplayerHands';
import type { Card } from '../game/types';
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
        
        // Load players
        const { data: playersData, error: playersError } = await supabase
          .from('room_players')
          .select('*')
          .eq('room_id', roomData.id)
          .order('player_index');
        
        if (playersError) throw playersError;
        
        setMultiplayerPlayers(playersData || []);
        gameLogger.info(`[GameScreen] Loaded ${playersData?.length || 0} players from room`);
        
        // NOTE: Game state is loaded via useRealtime.connectToRoom()
        // No need to manually load it here
      } catch (error: any) {
        gameLogger.error('[GameScreen] Error loading multiplayer room:', error?.message || String(error));
      }
    };
    
    loadMultiplayerRoom();
  }, [isMultiplayerGame, roomCode, navigation]);

  // Bot turn management hook (Task #Phase 2B) - only for LOCAL games
  const gameManagerRefPlaceholder = useRef<any>(null);
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

    multiplayerConnectToRoom(roomCode).catch((error: any) => {
      console.error('[GameScreen] ❌ Failed to connect:', error);
      gameLogger.error('[GameScreen] Failed to connect:', error?.message || String(error));
      showError(error?.message || 'Failed to connect to room');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMultiplayerGame, roomCode, user?.id]); // Removed multiplayerConnectToRoom to prevent infinite reconnect loop
  
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
    multiplayerPlayers,
    roomCode,
    addPlayHistory,
  });
  
  // CRITICAL FIX: One card left detection for ALL players (local + multiplayer)
  const oneCardLeftDetectedRef = useRef(new Set<string>()); // Track which players we've alerted for
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- local vs multiplayer game state have different shapes
    const effectiveGameState = isLocalAIGame ? gameState : multiplayerGameState as any;
    const hands = effectiveGameState?.hands;
    
    if (!hands || typeof hands !== 'object') return;
    
    // Check each player's hand
    Object.entries(hands).forEach(([playerIndex, cards]) => {
      if (!Array.isArray(cards)) return;
      
      const key = `${roomCode}-${playerIndex}`;
      
      if (cards.length === 1 && !oneCardLeftDetectedRef.current.has(key)) {
        // Player has one card left - first time detection
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- local game state players shape differs from multiplayer
        const player = isLocalAIGame 
          ? (gameState as any)?.players?.[parseInt(playerIndex)]
          : multiplayerPlayers.find(p => p.player_index === parseInt(playerIndex));
        
        if (player) {
          const playerName = isLocalAIGame ? player.name : player.username;
          gameLogger.info(`🚨 [One Card Alert] ${playerName} (index ${playerIndex}) has 1 card remaining`);
          
          // Play subtle notification without intrusive popup
          try {
            soundManager.playSound(SoundType.TURN_NOTIFICATION);
            hapticManager.trigger(HapticType.WARNING);
          } catch (error) {
            gameLogger.error('Error showing one-card-left notification', { error, playerName, playerIndex });
          }
          
          oneCardLeftDetectedRef.current.add(key);
        }
      } else if (cards.length > 1 && oneCardLeftDetectedRef.current.has(key)) {
        // Player drew more cards, reset alert
        oneCardLeftDetectedRef.current.delete(key);
      }
    });
  }, [isLocalAIGame, gameState, multiplayerGameState, multiplayerPlayers, roomCode]);

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
    multiplayerSeatIndex,
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
    let result = (hand as any) || [];
    
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
      ? (gameState?.lastPlay === null && gameState?.players.every((p: any) => p.hand.length === 13))
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

  // Register Game End callbacks (Task #416, #417)
  useEffect(() => {
    const manager = gameManagerRef.current;
    if (!manager) return;

    setOnPlayAgain(() => async () => {
      gameLogger.info('🔄 [GameScreen] Play Again requested - reinitializing game');
      try {
        await manager.initializeGame({
          playerName: currentPlayerName,
          botCount: 3,
          botDifficulty: botDifficulty, // Task #596: Reuse selected difficulty on Play Again
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
            // eslint-disable-next-line @typescript-eslint/no-require-imports -- dynamic require inside try/catch; static import cannot be inside a conditional block
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
  // NOTE: Only for LOCAL games - multiplayer uses auto_pass_deadline instead
  const hasPlayedHighestCardSoundRef = useRef(false);

  // Multiplayer match start sound tracking: detect match_number changes
  const previousMultiplayerMatchNumberRef = useRef<number | null>(null);

  // "fi_mat3am_hawn" plays on EVERY match start (match 1, 2, 3...) for multiplayer
  useEffect(() => {
    if (!isMultiplayerGame || !multiplayerGameState) return;

    const currentMatchNumber = multiplayerGameState?.match_number ?? null;
    const gamePhase = multiplayerGameState?.game_phase;

    // Only fire when the game is actively in the playing phase
    if (gamePhase !== 'playing') return;

    // Fire when match_number changes — covers match 1 start and all subsequent matches
    if (currentMatchNumber !== null && currentMatchNumber !== previousMultiplayerMatchNumberRef.current) {
      previousMultiplayerMatchNumberRef.current = currentMatchNumber;
      soundManager.playSound(SoundType.GAME_START);
      gameLogger.info(`🎵 [Audio] Match start sound triggered - multiplayer match ${currentMatchNumber}`);
    }
  }, [isMultiplayerGame, multiplayerGameState]);

  useEffect(() => {
    // CRITICAL FIX: Support BOTH local and multiplayer auto-pass timers
    const effectiveGameState = isLocalAIGame ? gameState : multiplayerGameState;
    const timerState = effectiveGameState?.auto_pass_timer;

    if (!timerState || !timerState.active) {
      // Timer not active - reset flags for next timer activation
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
    const remaining_ms = timerState.remaining_ms;
    const displaySeconds = Math.ceil(remaining_ms / 1000);
    
    // Vibrate with increasing frequency from 5→1 (more pulses = more intense)
    if (displaySeconds <= 5 && displaySeconds >= 1) {
      gameLogger.warn(`🚨 [VIBRATION] Triggering urgent countdown at ${displaySeconds}s (remaining_ms=${remaining_ms})`);
      hapticManager.urgentCountdown(displaySeconds);
      gameLogger.info(`📳 [Haptic] Progressive vibration triggered: ${displaySeconds}s`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- gameState and multiplayerGameState (full objects) intentionally excluded; subscribing to only the specific scalar that drives haptic/sound intensity prevents this firing on every unrelated state field change
  }, [isMultiplayerGame, isLocalAIGame, gameState?.auto_pass_timer?.remaining_ms, multiplayerGameState?.auto_pass_timer?.remaining_ms]);

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

  // Task #590: Match number and game finished state
  const matchNumber = isLocalAIGame 
    ? ((gameState as any)?.currentMatch ?? 1) 
    : (multiplayerGameState?.match_number ?? 1);
  const isGameFinished = isLocalAIGame
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- local game state shape differs from multiplayer
    ? ((gameState as any)?.gameOver ?? false)
    : (
        multiplayerGameState?.game_phase === 'finished' ||
        multiplayerGameState?.game_phase === 'game_over'
      );

  // Task #590: Layout players with total scores for GameLayout
  const layoutPlayersWithScores = React.useMemo(() => {
    return layoutPlayers.map((p: any, i: number) => ({
      ...p,
      totalScore: playerTotalScores[i] ?? 0,
    }));
  }, [layoutPlayers, playerTotalScores]);

  // 🎯 PERFORMANCE: Memoize expensive props to reduce re-renders
  // 📊 PRODUCTION FIX: Scoreboard shows TURN ORDER [0,1,2,3], not physical positions
  // This gives clean sequential display: Steve Peterson, Bot 1, Bot 2, Bot 3
  const memoizedPlayerNames = React.useMemo(() => {
    return layoutPlayers.length === 4 
      ? layoutPlayers.map((p: any) => p.name)  // ✅ Direct order: no mapping
      : [];
  }, [layoutPlayers]);

  const memoizedCurrentScores = React.useMemo(() => {
    if (layoutPlayers.length !== 4) return [];
    
    // 📊 PRODUCTION FIX: Calculate scores in TURN ORDER [0,1,2,3]
    // Scoreboard shows game logic (who's winning), not physical positions
    if (scoreHistory.length > 0) {
      // For local AI games, layoutPlayers are in order [0,1,2,3]
      // For multiplayer, we need to use player_index from the player object
      return layoutPlayers.map((p: any, index: number) => {
        // Use player_index if available (multiplayer), otherwise use array index (local AI)
        const playerIdx = p.player_index !== undefined ? p.player_index : index;
        return scoreHistory.reduce(
          (sum, match) => sum + (match.pointsAdded[playerIdx] || 0), 
          0
        );
      });
    }
    
    return layoutPlayers.map((p: any) => p.score);  // ✅ Direct order: no mapping
  }, [layoutPlayers, scoreHistory]);

  const memoizedCardCounts = React.useMemo(() => {
    return layoutPlayers.length === 4 
      ? layoutPlayers.map((p: any) => p.cardCount)  // ✅ Direct order: no mapping
      : [];
  }, [layoutPlayers]);

  const memoizedOriginalPlayerNames = React.useMemo(() => {
    if (isLocalAIGame) {
      return (gameState as any)?.players ? (gameState as any).players.map((p: any) => p.name) : [];
    }
    return multiplayerPlayers.map(p => p.username || `Player ${p.player_index + 1}`);
  }, [isLocalAIGame, gameState, multiplayerPlayers]);
  const hasEffectiveGameState = isLocalAIGame ? !!gameState : !!multiplayerGameState;
  // 🔥 FIXED Task #540: Auto-pass timer now works in BOTH local AND multiplayer!
  // The game_state table has auto_pass_timer column for multiplayer (added Dec 28, 2025)
  // CRITICAL FIX: Don't show auto-pass timer when game_phase='finished' or 'game_over'.
  // When a bot plays its last card (highest play), the server may still have an active timer
  // in the game_state. Rendering it causes rAF spam at remaining=0.
  const multiplayerPhase = multiplayerGameState?.game_phase;
  const isMatchActive = !multiplayerPhase || (multiplayerPhase !== 'finished' && multiplayerPhase !== 'game_over');
  const effectiveAutoPassTimerState = isLocalAIGame
    ? ((gameState as any)?.auto_pass_timer ?? undefined)
    : (isMatchActive ? (multiplayerGameState?.auto_pass_timer ?? undefined) : undefined); // ✅ Suppress timer when match is over

  // 📊 PRODUCTION FIX: Scoreboard currentPlayerIndex must match multiplayerLayoutPlayers array order.
  // multiplayerLayoutPlayers array order: [me (index 0), top (index 1), left (index 2), right (index 3)].
  // We resolve the LAYOUT ARRAY INDEX of the active player so that:
  //   - LandscapeGameLayout's isOpponentActive(index) shows the red circle on the correct player
  //   - LandscapeScoreboard highlights the correct row
  // NOTE: Portrait is unaffected — it reads .isActive directly from each player object.
  const multiplayerCurrentTurn = multiplayerGameState?.current_turn;

  // Helper: map absolute player_index → layout array slot [me=0, top=1, left=2, right=3]
  const getMultiplayerScoreboardIndex = (currentTurn: number): number => {
    const idx = multiplayerLayoutPlayers.findIndex((p: any) => p.player_index === currentTurn);
    return idx >= 0 ? idx : 0;
  };

  const effectiveScoreboardCurrentPlayerIndex = isLocalAIGame
    ? ((gameState as any)?.currentPlayerIndex ?? 0)  // ✅ Local AI: direct game state index
    : (typeof multiplayerCurrentTurn === 'number'
        ? getMultiplayerScoreboardIndex(multiplayerCurrentTurn)  // ✅ FIX: layout-aware lookup
        : 0);

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
            playerNames={memoizedPlayerNames}
            currentScores={memoizedCurrentScores}
            cardCounts={memoizedCardCounts}
            currentPlayerIndex={effectiveScoreboardCurrentPlayerIndex}
            matchNumber={isLocalAIGame ? ((gameState as any)?.currentMatch ?? 1) : (multiplayerGameState?.match_number ?? 1)}
            isGameFinished={isGameFinished}
            scoreHistory={scoreHistory}
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
            scoreHistory={scoreHistory}
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
            players={layoutPlayersWithScores as any}
            lastPlayedCards={effectiveLastPlayedCards as any}
            lastPlayedBy={effectiveLastPlayedBy as any}
            lastPlayComboType={effectiveLastPlayComboType as any}
            lastPlayCombo={effectiveLastPlayCombo as any}
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
