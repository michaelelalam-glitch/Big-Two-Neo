import React, { useState, useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, ActivityIndicator, Vibration, ToastAndroid, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, RouteProp, useNavigation, NavigationProp } from '@react-navigation/native';
import { RootStackParamList } from '../navigation/AppNavigator';
import { CardHand, PlayerInfo, CenterPlayArea, GameSettingsModal, AutoPassTimer, HelperButtons } from '../components/game';
import { ScoreboardContainer } from '../components/scoreboard';
import type { Card } from '../game/types';
import { COLORS, SPACING, FONT_SIZES, LAYOUT, OVERLAYS, POSITIONING, SHADOWS, OPACITIES } from '../constants';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../services/supabase';
import { createGameStateManager, type GameState, type GameStateManager, type Player } from '../game/state';
import { gameLogger } from '../utils/logger';
import { ScoreboardProvider, useScoreboard } from '../contexts/ScoreboardContext';
import type { ScoreHistory } from '../types/scoreboard';
import { usePlayHistoryTracking } from '../hooks/usePlayHistoryTracking';
import { sortHandLowestToHighest, smartSortHand, findHintPlay } from '../utils/helperButtonUtils';

type GameScreenRouteProp = RouteProp<RootStackParamList, 'Game'>;
type GameScreenNavigationProp = NavigationProp<RootStackParamList>;

/**
 * Maps players array to scoreboard display order [0, 3, 1, 2]
 * This order places the user at top-left, then arranges bots clockwise
 * @param players - Array of 4 players in game state order
 * @param mapper - Function to extract desired property from each player
 * @returns Array of values in scoreboard display order
 */
function mapPlayersToScoreboardOrder<T>(players: Player[], mapper: (player: Player) => T): T[] {
  // Scoreboard display order: [player 0, player 3, player 1, player 2]
  // This creates a clockwise arrangement: user (top-left), bot3 (top-right), bot1 (bottom-left), bot2 (bottom-right)
  return [
    mapper(players[0]),
    mapper(players[3]),
    mapper(players[1]),
    mapper(players[2])
  ];
}

/**
 * Maps game state player index to scoreboard display position
 * @param gameIndex - Player index in game state (0-3)
 * @returns Position index in scoreboard display (0-3)
 */
function mapGameIndexToScoreboardPosition(gameIndex: number): number {
  // Mapping: game index -> scoreboard position
  // 0 -> 0 (user stays at position 0)
  // 3 -> 1 (bot3 to position 1)
  // 1 -> 2 (bot1 to position 2)
  // 2 -> 3 (bot2 to position 3)
  const mapping: Record<number, number> = { 0: 0, 3: 1, 1: 2, 2: 3 };
  return mapping[gameIndex] ?? 0;
}

function GameScreenContent() {
  const route = useRoute<GameScreenRouteProp>();
  const navigation = useNavigation<GameScreenNavigationProp>();
  const { user } = useAuth();
  const { 
    addScoreHistory, 
    setIsScoreboardExpanded, 
    scoreHistory, 
    playHistoryByMatch 
  } = useScoreboard(); // Task #351 & #352 & #355
  const { roomCode } = route.params;
  const [showSettings, setShowSettings] = useState(false);
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());
  
  // Game state management
  const gameManagerRef = useRef<GameStateManager | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  
  // Task #355: Play history tracking - automatically sync game plays to scoreboard
  usePlayHistoryTracking(gameState);
  
  // Track initialization to prevent multiple inits
  const isInitializedRef = useRef(false);
  const initializedRoomRef = useRef<string | null>(null);
  
  // Track bot turn execution to prevent duplicates
  const isExecutingBotTurnRef = useRef(false);
  const lastBotTurnPlayerIndexRef = useRef<number | null>(null);
  
  // Track card play execution to prevent duplicates (use state for UI updates)
  const [isPlayingCards, setIsPlayingCards] = useState(false);
  
  // Track pass execution
  const [isPassing, setIsPassing] = useState(false);
  
  // Track custom card order (user can rearrange cards)
  const [customCardOrder, setCustomCardOrder] = useState<string[]>([]);

  // Get player username from auth context (fallback to email prefix if no username)
  const currentPlayerName = user?.user_metadata?.username || 
                           user?.email?.split('@')[0] || 
                           'Player';

  // Bot turn timing configuration based on difficulty
  const getBotDelayMs = (difficulty: 'easy' | 'medium' | 'hard' = 'medium'): number => {
    const delays = { easy: 1200, medium: 800, hard: 500 };
    return delays[difficulty];
  };

  // Bot turn checker function (accessible from everywhere)
  const checkAndExecuteBotTurn = () => {
    if (!gameManagerRef.current) return;
    
    const currentState = gameManagerRef.current.getState();
    if (!currentState || currentState.gameEnded) return;
    
    const currentPlayer = currentState.players[currentState.currentPlayerIndex];
    
    // Detect new trick: lastPlay is null and consecutivePasses is 0 (trick was just won)
    const isNewTrickLeader = !currentState.lastPlay && currentState.consecutivePasses === 0;
    const turnChanged = lastBotTurnPlayerIndexRef.current !== currentState.currentPlayerIndex;
    
    gameLogger.debug('🔍 [GameScreen] Bot turn check:', {
      currentPlayer: currentPlayer.name,
      isBot: currentPlayer.isBot,
      gameEnded: currentState.gameEnded,
      isExecuting: isExecutingBotTurnRef.current,
      turnChanged,
      isNewTrickLeader,
      lastPlayerIndex: lastBotTurnPlayerIndexRef.current,
      currentPlayerIndex: currentState.currentPlayerIndex
    });
    
    // Execute bot turn if: it's a bot, not already executing, AND (turn changed OR leading new trick)
    if (currentPlayer.isBot && !isExecutingBotTurnRef.current && (turnChanged || isNewTrickLeader)) {
      // Mark as executing and track player index
      isExecutingBotTurnRef.current = true;
      lastBotTurnPlayerIndexRef.current = currentState.currentPlayerIndex;
      
      gameLogger.info(`🤖 [GameScreen] Bot ${currentPlayer.name} is thinking...`);
      
      // Bot turn timing: configurable delay for natural feel, 100ms between subsequent bot turns
      setTimeout(() => {
        gameManagerRef.current?.executeBotTurn()
          .then(() => {
            gameLogger.info(`✅ [GameScreen] Bot ${currentPlayer.name} turn finished`);
            // Release lock immediately after turn completes
            isExecutingBotTurnRef.current = false;
            gameLogger.debug('🔓 [GameScreen] Bot turn lock released');
            // Check for next bot turn
            setTimeout(checkAndExecuteBotTurn, 100);
          })
          .catch((error: any) => {
            // Only log error message/code to avoid exposing game state internals
            gameLogger.error('❌ [GameScreen] Bot turn failed:', error?.message || error?.code || String(error));
            isExecutingBotTurnRef.current = false;
            gameLogger.debug('🔓 [GameScreen] Bot turn lock released (error)');
            
            // Notify user and attempt recovery
            Alert.alert(
              'Bot Turn Error',
              `Bot ${currentPlayer.name} encountered an error. The game will continue with the next player.`,
              [{ text: 'OK' }]
            );
            
            // Check for next player after brief delay
            setTimeout(checkAndExecuteBotTurn, 100);
          });
      }, getBotDelayMs('medium'));
    }
  };

  // Initialize game engine
  useEffect(() => {
    // Prevent multiple initializations for the same room
    if (isInitializedRef.current && initializedRoomRef.current === roomCode) {
      gameLogger.debug('⏭️ [GameScreen] Game already initialized for room:', roomCode);
      return;
    }

    const initGame = async () => {
      try {
        gameLogger.info('🎮 [GameScreen] Initializing game engine for room:', roomCode);
        
        // Mark as initializing
        isInitializedRef.current = true;
        initializedRoomRef.current = roomCode;
        
        // Create game manager
        const manager = createGameStateManager();
        gameManagerRef.current = manager;
        
        // Subscribe to state changes
        const unsubscribe = manager.subscribe((state: GameState) => {
          gameLogger.debug('📊 [GameScreen] Game state updated:', {
            currentPlayer: state.players[state.currentPlayerIndex].name,
            handSize: state.players[0].hand.length,
            lastPlay: state.lastPlay?.combo || 'none',
            gameEnded: state.gameEnded,
            gameOver: state.gameOver
          });
          setGameState(state);
          
          // Handle match end (someone ran out of cards)
          if (state.gameEnded && !state.gameOver) {
            // Match ended but game continues
            const matchWinner = state.players.find(p => p.id === state.winnerId);
            const matchScores = state.matchScores;
            
            // Task #351: Track score history for scoreboard
            // Extract points added this match from matchScores array
            const pointsAdded: number[] = [];
            const cumulativeScores: number[] = [];
            
            matchScores.forEach(playerScore => {
              // Get the latest match score (points added this match)
              const latestMatchScore = playerScore.matchScores[playerScore.matchScores.length - 1] || 0;
              pointsAdded.push(latestMatchScore);
              cumulativeScores.push(playerScore.score);
            });
            
            const scoreHistory: ScoreHistory = {
              matchNumber: state.currentMatch,
              pointsAdded,
              scores: cumulativeScores,
              timestamp: new Date().toISOString(),
            };
            
            addScoreHistory(scoreHistory);
            gameLogger.info('📊 [Score History] Added to scoreboard context:', scoreHistory);
            
            // Build score summary
            const scoreSummary = matchScores
              .map(s => `${s.playerName}: ${s.score} pts`)
              .join('\n');
            
            Alert.alert(
              `Match ${state.currentMatch} Complete!`,
              `${matchWinner?.name || 'Someone'} wins the match!\n\n${scoreSummary}`,
              [
                {
                  text: 'Next Match',
                  onPress: async () => {
                    gameLogger.info('🔄 [GameScreen] Starting next match...');
                    const result = await manager.startNewMatch();
                    if (result.success) {
                      gameLogger.info('✅ [GameScreen] New match started');
                      // Bot turns will be triggered by the subscription callback
                    } else {
                      // Only log error message to avoid exposing game state internals
                      const errorMsg = result.error instanceof Error ? result.error.message : String(result.error);
                      gameLogger.error('❌ [GameScreen] Failed to start new match:', errorMsg);
                    }
                  }
                }
              ]
            );
            return; // Don't trigger bot turns while alert is showing
          }
          
          // Handle game over (101+ points reached)
          if (state.gameOver) {
            // Task #352: Auto-expand scoreboard on game end
            setIsScoreboardExpanded(true);
            gameLogger.info('📊 [Auto-Expand] Scoreboard expanded - game over detected');
            
            const finalWinner = state.matchScores.find(s => s.playerId === state.finalWinnerId);
            const scoreSummary = state.matchScores
              .sort((a, b) => a.score - b.score)
              .map(s => `${s.playerName}: ${s.score} pts`)
              .join('\n');
            
            Alert.alert(
              'Game Over!',
              `${finalWinner?.playerName || 'Someone'} wins the game!\n\n${scoreSummary}`,
              [{ text: 'OK', onPress: handleLeaveGame }]
            );
            return; // Don't trigger bot turns when game is over
          }
          
          // Trigger bot turn check after state update
          setTimeout(() => checkAndExecuteBotTurn(), 100);
        });

        // Initialize game with 3 bots
        const initialState = await manager.initializeGame({
          playerName: currentPlayerName,
          botCount: 3,
          botDifficulty: 'medium' // Can be changed to 'easy', 'medium', or 'hard'
        });

        setGameState(initialState);
        setIsInitializing(false);
        gameLogger.info('✅ [GameScreen] Game initialized successfully');

        // Bot turn will be triggered by subscription callback

        return () => {
          unsubscribe();
          // Cleanup timer interval to prevent memory leaks
          if (gameManagerRef.current) {
            gameManagerRef.current.destroy();
          }
        };
      } catch (error: any) {
        gameLogger.error('❌ [GameScreen] Failed to initialize game:', error?.message || error?.code || String(error));
        setIsInitializing(false);
        Alert.alert('Error', 'Failed to initialize game. Please try again.');
      }
    };

    initGame();
  }, [roomCode, currentPlayerName]);

  // Derived state from game engine
  const playerHand = useMemo(() => {
    if (!gameState) return [];
    const hand = gameState.players[0].hand; // Player is always at index 0
    
    // Reset custom order if hand is empty (new round starting)
    if (hand.length === 0 && customCardOrder.length > 0) {
      setCustomCardOrder([]);
    }
    
    // If user has manually reordered cards, use that order
    if (customCardOrder.length > 0) {
      const orderedHand: Card[] = [];
      
      // First, add cards in custom order that are still in hand
      for (const cardId of customCardOrder) {
        const card = hand.find(c => c.id === cardId);
        if (card) orderedHand.push(card);
      }
      
      // Then add any new cards that aren't in custom order (at the end)
      for (const card of hand) {
        if (!orderedHand.some(c => c.id === card.id)) {
          orderedHand.push(card);
        }
      }
      
      // Only use custom order if we found at least some matching cards
      if (orderedHand.length > 0) {
        return orderedHand;
      }
    }
    
    return hand;
  }, [gameState, customCardOrder]);

  const lastPlayedCards = useMemo(() => {
    if (!gameState || !gameState.lastPlay) return [];
    return gameState.lastPlay.cards;
  }, [gameState]);

  const lastPlayedBy = useMemo(() => {
    if (!gameState || gameState.roundHistory.length === 0) return null;
    const lastEntry = gameState.roundHistory[gameState.roundHistory.length - 1];
    return lastEntry.playerName;
  }, [gameState]);

  const lastPlayCombo = useMemo(() => {
    if (!gameState || !gameState.lastPlay) return null;
    return gameState.lastPlay.combo;
  }, [gameState]);

  // Map game state players to UI format
  const players = useMemo(() => {
    // Return placeholder while loading OR if players don't have hands yet (initialization race condition)
    if (!gameState || !gameState.players || gameState.players.length !== 4 || !gameState.players[0]?.hand) {
      // Return placeholder while loading
      return [
        { name: currentPlayerName, cardCount: 13, score: 0, position: 'bottom' as const, isActive: true },
        { name: 'Opponent 1', cardCount: 13, score: 0, position: 'top' as const, isActive: false },
        { name: 'Opponent 2', cardCount: 13, score: 0, position: 'left' as const, isActive: false },
        { name: 'Opponent 3', cardCount: 13, score: 0, position: 'right' as const, isActive: false },
      ];
    }

    // Helper function to get player score by ID
    const getPlayerScore = (playerId: string): number => {
      const playerScore = gameState.matchScores.find(s => s.playerId === playerId);
      return playerScore?.score || 0;
    };

    return [
      {
        name: gameState.players[0].name, // Bottom (player)
        cardCount: gameState.players[0].hand.length,
        score: getPlayerScore(gameState.players[0].id),
        position: 'bottom' as const,
        isActive: gameState.currentPlayerIndex === 0
      },
      {
        name: gameState.players[1].name, // Top
        cardCount: gameState.players[1].hand.length,
        score: getPlayerScore(gameState.players[1].id),
        position: 'top' as const,
        isActive: gameState.currentPlayerIndex === 1
      },
      {
        name: gameState.players[2].name, // Left
        cardCount: gameState.players[2].hand.length,
        score: getPlayerScore(gameState.players[2].id),
        position: 'left' as const,
        isActive: gameState.currentPlayerIndex === 2
      },
      {
        name: gameState.players[3].name, // Right
        cardCount: gameState.players[3].hand.length,
        score: getPlayerScore(gameState.players[3].id),
        position: 'right' as const,
        isActive: gameState.currentPlayerIndex === 3
      },
    ];
  }, [gameState, currentPlayerName]);

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
        
        // Reset initialization refs to allow re-initialization in a new room
        isInitializedRef.current = false;
        initializedRoomRef.current = null;
        
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

  const handlePlayCards = async (cards: Card[]) => {
    if (!gameManagerRef.current || !gameState) {
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
      
      gameLogger.info('🎴 [GameScreen] Playing cards:', cards.map(c => c.id));
      
      // Get card IDs to play
      const cardIds = cards.map(c => c.id);
      
      // Attempt to play cards through game engine
      const result = await gameManagerRef.current.playCards(cardIds);
      
      if (result.success) {
        gameLogger.info('✅ [GameScreen] Cards played successfully');
        
        // Clear selection only if component is still mounted
        if (isMountedRef.current) {
          setSelectedCardIds(new Set());
        }
        
        // Preserve custom card order by removing only the played cards
        if (customCardOrder.length > 0) {
          const playedCardIds = new Set(cardIds);
          // Also filter out any IDs not present in the current hand
          const currentHandCardIds = new Set(playerHand.map(card => card.id));
          const updatedOrder = customCardOrder.filter(id => !playedCardIds.has(id) && currentHandCardIds.has(id));
          setCustomCardOrder(updatedOrder);
        }
        
        // Bot turns and match/game end will be handled by subscription callback
      } else {
        // Show error from validation
        Alert.alert('Invalid Move', result.error || 'Invalid play');
      }
    } catch (error: any) {
      // Only log error message/code to avoid exposing game state internals
      gameLogger.error('❌ [GameScreen] Failed to play cards:', error?.message || error?.code || String(error));
      
      // Show user-friendly error
      const errorMessage = error instanceof Error ? error.message : 'Invalid play';
      Alert.alert('Invalid Move', errorMessage);
    } finally {
      // Release lock after short delay to prevent rapid double-taps
      setTimeout(() => {
        if (isMountedRef.current) {
          setIsPlayingCards(false);
        }
      }, 300);
    }
  };

  const handlePass = async () => {
    if (!gameManagerRef.current || !gameState) {
      gameLogger.error('❌ [GameScreen] Game not initialized');
      return;
    }

    if (isPassing) {
      gameLogger.debug('⏭️ [GameScreen] Pass already in progress, ignoring...');
      return;
    }

    try {
      setIsPassing(true);
      gameLogger.info('⏭️ [GameScreen] Player passing...');
      
      const result = await gameManagerRef.current.pass();
      
      if (result.success) {
        gameLogger.info('✅ [GameScreen] Pass successful');
        
        // Clear selection only if component is still mounted
        if (isMountedRef.current) {
          setSelectedCardIds(new Set());
        }
        
        // Bot turns will be triggered automatically by the subscription
      } else {
        Alert.alert('Cannot Pass', result.error || 'Cannot pass');
      }
    } catch (error: any) {
      // Only log error message/code to avoid exposing game state internals
      gameLogger.error('❌ [GameScreen] Failed to pass:', error?.message || error?.code || String(error));
      
      const errorMessage = error instanceof Error ? error.message : 'Cannot pass';
      Alert.alert('Cannot Pass', errorMessage);
    } finally {
      setTimeout(() => {
        if (isMountedRef.current) {
          setIsPassing(false);
        }
      }, 300);
    }
  };

  const handleLeaveGame = () => {
    // Navigate to home screen (resets the navigation stack)
    navigation.reset({
      index: 0,
      routes: [{ name: 'Home' }],
    });
  };

  // Handle card rearrangement
  const handleCardsReorder = (reorderedCards: Card[]) => {
    const newOrder = reorderedCards.map(card => card.id);
    setCustomCardOrder(newOrder);
  };

  // Helper Buttons Handlers (Task #388-390)
  
  /**
   * Sort button handler - Arranges cards from lowest to highest
   * Task #388: Implement Sort button functionality
   */
  const handleSort = () => {
    if (!gameState || playerHand.length === 0) return;
    
    // Haptic feedback (50ms vibration)
    Vibration.vibrate(50);
    
    // Sort hand
    const sorted = sortHandLowestToHighest(playerHand);
    const newOrder = sorted.map(card => card.id);
    setCustomCardOrder(newOrder);
    
    gameLogger.info('[GameScreen] Sorted hand lowest to highest');
  };

  /**
   * Smart Sort button handler - Groups cards by combo type
   * Task #389: Implement Smart Sort button functionality
   */
  const handleSmartSort = () => {
    if (!gameState || playerHand.length === 0) return;
    
    // Haptic feedback (double vibration: 30ms, pause 50ms, 30ms)
    Vibration.vibrate([30, 50, 30]);
    
    // Smart sort hand
    const smartSorted = smartSortHand(playerHand);
    const newOrder = smartSorted.map(card => card.id);
    setCustomCardOrder(newOrder);
    
    // Toast message
    if (Platform.OS === 'android') {
      ToastAndroid.show('Hand organized by combos', ToastAndroid.SHORT);
    } else if (Platform.OS === 'ios') {
      Alert.alert('Hand organized by combos');
    }
    
    gameLogger.info('[GameScreen] Smart sorted hand by combo type');
  };

  /**
   * Hint button handler - Suggests best play
   * Task #390: Implement Hint button functionality
   */
  const handleHint = () => {
    if (!gameState || playerHand.length === 0) return;
    
    const isFirstPlay = gameState.lastPlay === null && gameState.players.every(p => p.hand.length === 13);
    const recommended = findHintPlay(
      playerHand,
      gameState.lastPlay,
      isFirstPlay
    );
    
    if (recommended === null) {
      // No valid play - recommend passing
      Vibration.vibrate([50, 100, 50]); // Double vibration for pass
      
      if (Platform.OS === 'android') {
        ToastAndroid.show('No valid play - recommend passing', ToastAndroid.LONG);
      } else if (Platform.OS === 'ios') {
        Alert.alert('No valid play - recommend passing');
      }
      
      gameLogger.info('[GameScreen] Hint: No valid play, recommend pass');
    } else {
      // Valid play found - auto-select cards
      Vibration.vibrate([30, 50, 30]); // Success pattern
      
      const recommendedSet = new Set(recommended);
      setSelectedCardIds(recommendedSet);
      
      const cardCount = recommended.length;
      const comboType = cardCount === 1 ? 'Single' : 
                       cardCount === 2 ? 'Pair' : 
                       cardCount === 3 ? 'Triple' : 
                       cardCount === 5 ? '5-card combo' : 
                       `${cardCount} card${cardCount > 1 ? 's' : ''}`;
      
      if (Platform.OS === 'android') {
        ToastAndroid.show(`Recommended: ${comboType}`, ToastAndroid.SHORT);
      } else if (Platform.OS === 'ios') {
        Alert.alert(`Recommended: ${comboType}`);
      }
      
      gameLogger.info(`[GameScreen] Hint: Recommended ${cardCount} card(s)`);
    }
  };

  // Memoize scoreboard players to prevent unnecessary re-renders
  const scoreboardPlayers = useMemo(() => 
    players.map((p, index) => ({ 
      name: p.name, 
      score: p.score,
      isCurrentPlayer: index === 0 // First player is always the authenticated user
    }))
  , [players]);

  // Extract disabled state logic to prevent duplication
  const isPassDisabled = !players[0].isActive || isPassing;
  const isPlayDisabled = !players[0].isActive || selectedCardIds.size === 0 || isPlayingCards;

  return (
    <View style={styles.container}>
      {isInitializing ? (
        // Loading state
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Initializing game...</Text>
          <Text style={styles.loadingSubtext}>Setting up game engine...</Text>
        </View>
      ) : (
        <>
          {/* Scoreboard Container (top-left, with expand/collapse & play history) */}
          <ScoreboardContainer
            playerNames={mapPlayersToScoreboardOrder(players, p => p.name)}
            currentScores={mapPlayersToScoreboardOrder(players, p => p.score)}
            cardCounts={mapPlayersToScoreboardOrder(players, p => p.cardCount)}
            currentPlayerIndex={mapGameIndexToScoreboardPosition(gameState?.currentPlayerIndex || 0)}
            matchNumber={gameState?.currentMatch || 1}
            isGameFinished={gameState?.gameEnded || false}
            scoreHistory={scoreHistory}
            playHistory={playHistoryByMatch}
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

          {/* Game Settings Modal */}
          <GameSettingsModal
            visible={showSettings}
            onClose={() => setShowSettings(false)}
            onLeaveGame={handleLeaveGame}
          />

          {/* Top player (Jad) - OUTSIDE table, above it */}
          <View style={styles.topPlayerAboveTable}>
            <PlayerInfo
              name={players[1].name}
              cardCount={players[1].cardCount}
              isActive={players[1].isActive}
            />
          </View>

          {/* Game table area */}
          <View style={styles.tableArea}>
            {/* Middle row: Left player, Center play area, Right player */}
            <View style={styles.middleRow}>
              {/* Left player (Roben) */}
              <View style={styles.leftPlayerContainer}>
                <PlayerInfo
                  name={players[2].name}
                  cardCount={players[2].cardCount}
                  isActive={players[2].isActive}
                />
              </View>

              {/* Center play area (last played cards) */}
              <View style={styles.centerPlayArea}>
                <CenterPlayArea
                  lastPlayed={lastPlayedCards}
                  lastPlayedBy={lastPlayedBy || 'Waiting...'}
                  combinationType={lastPlayCombo || 'No plays yet'}
                />
                
                {/* Auto-Pass Timer Display */}
                {gameState?.auto_pass_timer && (
                  <AutoPassTimer
                    timerState={gameState.auto_pass_timer}
                    currentPlayerIndex={0} // Player is always at index 0 in local game
                  />
                )}
              </View>

              {/* Right player (James) */}
              <View style={styles.rightPlayerContainer}>
                <PlayerInfo
                  name={players[3].name}
                  cardCount={players[3].cardCount}
                  isActive={players[3].isActive}
                />
              </View>
            </View>
          </View>

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
              
              {/* Action buttons next to player */}
              <View style={styles.actionButtons}>
                <Pressable
                  style={[styles.actionButton, styles.passButton, isPassDisabled && styles.buttonDisabled]}
                  onPress={handlePass}
                  disabled={isPassDisabled}
                  accessibilityRole="button"
                  accessibilityLabel="Pass turn"
                  accessibilityState={{ disabled: isPassDisabled }}
                >
                  {isPassing ? (
                    <ActivityIndicator color={COLORS.gray.light} size="small" accessibilityLabel="Passing turn" />
                  ) : (
                    <Text style={[styles.actionButtonText, styles.passButtonText]}>Pass</Text>
                  )}
                </Pressable>

                <Pressable
                  style={[
                    styles.actionButton,
                    styles.playButton,
                    isPlayDisabled && styles.buttonDisabled,
                  ]}
                  onPress={() => {
                    if (isPlayDisabled) return;
                    const selected = playerHand.filter((card) => selectedCardIds.has(card.id));
                    handlePlayCards(selected);
                    setSelectedCardIds(new Set()); // Clear selection after play
                  }}
                  disabled={isPlayDisabled}
                  accessibilityRole="button"
                  accessibilityLabel="Play selected cards"
                  accessibilityState={{ disabled: isPlayDisabled }}
                >
                  {isPlayingCards ? (
                    <ActivityIndicator color={COLORS.white} size="small" accessibilityLabel="Playing cards" />
                  ) : (
                    <Text style={styles.actionButtonText}>Play</Text>
                  )}
                </Pressable>
              </View>
            </View>

            {/* Player's hand */}
            <View style={styles.cardHandContainer}>
              <CardHand
                cards={playerHand}
                onPlayCards={handlePlayCards}
                onPass={handlePass}
                canPlay={players[0].isActive}
                hideButtons={true} // Hide internal buttons since we display them externally
                selectedCardIds={selectedCardIds}
                onSelectionChange={setSelectedCardIds}
                onCardsReorder={handleCardsReorder}
              />
            </View>
          </View>
        </>
      )}
    </View>
  );
}

// Wrapper component with ScoreboardProvider for Task #351
export default function GameScreen() {
  return (
    <ScoreboardProvider>
      <GameScreenContent />
    </ScoreboardProvider>
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
  menuLine: {
    width: LAYOUT.menuLineWidth,
    height: LAYOUT.menuLineHeight,
    backgroundColor: COLORS.white,
    borderRadius: POSITIONING.menuLineBorderRadius,
  },
  topPlayerAboveTable: {
    alignItems: 'center',
    paddingTop: LAYOUT.topPlayerSpacing, // Space for scoreboard above
    paddingLeft: LAYOUT.leftPlayerOffset, // Move to the right of scoreboard
    marginBottom: LAYOUT.topPlayerOverlap, // Slight overlap with table
    zIndex: 50,
  },
  tableArea: {
    width: LAYOUT.tableWidth,
    height: LAYOUT.tableHeight,
    backgroundColor: COLORS.table.background, // Green felt color
    alignSelf: 'center',
    borderRadius: LAYOUT.tableBorderRadius,
    borderWidth: LAYOUT.tableBorderWidth,
    borderColor: COLORS.table.border,
    paddingVertical: SPACING.xl,
    paddingHorizontal: SPACING.lg,
    justifyContent: 'center',
    shadowColor: COLORS.black,
    shadowOffset: SHADOWS.table.offset,
    shadowOpacity: SHADOWS.table.opacity,
    shadowRadius: SHADOWS.table.radius,
    elevation: SHADOWS.table.elevation,
  },
  middleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
  },
  leftPlayerContainer: {
    alignItems: 'center',
    position: 'absolute',
    left: LAYOUT.playerOverlapOffset,
    top: POSITIONING.sidePlayerTop, 
  },
  centerPlayArea: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.md,
  },
  rightPlayerContainer: {
    alignItems: 'center',
    position: 'absolute',
    right: LAYOUT.playerOverlapOffset,
    top: POSITIONING.sidePlayerTop, // Align with green circle indicator
  },
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
  },
  actionButtons: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  actionButton: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    borderRadius: POSITIONING.actionButtonBorderRadius,
    minWidth: POSITIONING.actionButtonMinWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButton: {
    backgroundColor: COLORS.accent,
  },
  passButton: {
    backgroundColor: COLORS.gray.dark,
    borderWidth: POSITIONING.passButtonBorderWidth,
    borderColor: COLORS.gray.medium,
  },
  buttonDisabled: {
    opacity: OPACITIES.disabled,
  },
  actionButtonText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.md,
    fontWeight: 'bold',
  },
  passButtonText: {
    color: COLORS.gray.light,
  },
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
