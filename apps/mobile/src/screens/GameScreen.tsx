import React, { useState, useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, RouteProp, useNavigation, NavigationProp } from '@react-navigation/native';
import { RootStackParamList } from '../navigation/AppNavigator';
import { CardHand, PlayerInfo, MatchScoreboard, CenterPlayArea, GameSettingsModal } from '../components/game';
import type { Card } from '../game/types';
import { COLORS, SPACING, FONT_SIZES, LAYOUT, OVERLAYS, POSITIONING, SHADOWS, OPACITIES } from '../constants';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../services/supabase';
import { createGameStateManager, type GameState, type GameStateManager } from '../game/state';

type GameScreenRouteProp = RouteProp<RootStackParamList, 'Game'>;
type GameScreenNavigationProp = NavigationProp<RootStackParamList>;

export default function GameScreen() {
  const route = useRoute<GameScreenRouteProp>();
  const navigation = useNavigation<GameScreenNavigationProp>();
  const { user } = useAuth();
  const { roomCode } = route.params;
  const [showSettings, setShowSettings] = useState(false);
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());
  
  // Game state management
  const gameManagerRef = useRef<GameStateManager | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  
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
    
    console.log('🔍 [GameScreen] Bot turn check:', {
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
      
      console.log(`🤖 [GameScreen] Bot ${currentPlayer.name} is thinking...`);
      
      // Bot turn timing: configurable delay for natural feel, 100ms between subsequent bot turns
      setTimeout(() => {
        gameManagerRef.current?.executeBotTurn()
          .then(() => {
            console.log(`✅ [GameScreen] Bot ${currentPlayer.name} turn finished`);
            // Release lock immediately after turn completes
            isExecutingBotTurnRef.current = false;
            console.log('🔓 [GameScreen] Bot turn lock released');
            // Check for next bot turn
            setTimeout(checkAndExecuteBotTurn, 100);
          })
          .catch((error) => {
            console.error('❌ [GameScreen] Bot turn failed:', error);
            isExecutingBotTurnRef.current = false;
            console.log('🔓 [GameScreen] Bot turn lock released (error)');
            
            // Notify user and attempt recovery
            Alert.alert(
              'Bot Turn Error',
              `Bot ${currentPlayer.name} encountered an error. The game will continue with the next player.`,
              [{ text: 'OK' }]
            );
            
            // Check for next player after brief delay
            setTimeout(checkAndExecuteBotTurn, 100);
          });
            // Notify user and attempt recovery
            Alert.alert(
              'Bot Turn Error',
              `Bot ${currentPlayer.name} encountered an error. Continuing to next player.`,
              [{ text: 'OK' }]
            );
            
            // Check for next bot turn after short delay to allow game recovery
            setTimeout(checkAndExecuteBotTurn, 500);
          });
      }, getBotDelayMs('medium'));
    }
  };

  // Initialize game engine
  useEffect(() => {
    // Prevent multiple initializations for the same room
    if (isInitializedRef.current && initializedRoomRef.current === roomCode) {
      console.log('⏭️ [GameScreen] Game already initialized for room:', roomCode);
      return;
    }

    const initGame = async () => {
      try {
        console.log('🎮 [GameScreen] Initializing game engine for room:', roomCode);
        
        // Mark as initializing
        isInitializedRef.current = true;
        initializedRoomRef.current = roomCode;
        
        // Create game manager
        const manager = createGameStateManager();
        gameManagerRef.current = manager;
        
        // Subscribe to state changes
        const unsubscribe = manager.subscribe((state: GameState) => {
          console.log('📊 [GameScreen] Game state updated:', {
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
                    console.log('🔄 [GameScreen] Starting next match...');
                    const result = await manager.startNewMatch();
                    if (result.success) {
                      console.log('✅ [GameScreen] New match started');
                      // Bot turns will be triggered by the subscription callback
                    } else {
                      console.error('❌ [GameScreen] Failed to start new match:', result.error);
                    }
                  }
                }
              ]
            );
            return; // Don't trigger bot turns while alert is showing
          }
          
          // Handle game over (101+ points reached)
          if (state.gameOver) {
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
        console.log('✅ [GameScreen] Game initialized successfully');

        // Bot turn will be triggered by subscription callback

        return () => {
          unsubscribe();
        };
      } catch (error) {
        console.error('❌ [GameScreen] Failed to initialize game:', error);
        setIsInitializing(false);
        Alert.alert('Error', 'Failed to initialize game. Please try again.');
      }
    };

    initGame();
  }, [roomCode, currentPlayerName]);

  // Derived state from game engine
  const playerHand = useMemo(() => {
    if (!gameState) return [];
    return gameState.players[0].hand; // Player is always at index 0
  }, [gameState]);

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
    if (!gameState) {
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
        console.log(`🧹 [GameScreen] Deliberate exit: Removing user ${user.id} from room ${roomCode}`);
        
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
              console.error('❌ [GameScreen] Cleanup error:', error);
            } else {
              console.log('✅ [GameScreen] Successfully removed from room');
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
      console.error('❌ [GameScreen] Game not initialized');
      return;
    }

    // Prevent duplicate card plays
    if (isPlayingCards) {
      console.log('⏭️ [GameScreen] Card play already in progress, ignoring...');
      return;
    }

    try {
      setIsPlayingCards(true);
      
      console.log('🎴 [GameScreen] Playing cards:', cards.map(c => c.id));
      
      // Get card IDs to play
      const cardIds = cards.map(c => c.id);
      
      // Attempt to play cards through game engine
      const result = await gameManagerRef.current.playCards(cardIds);
      
      if (result.success) {
        console.log('✅ [GameScreen] Cards played successfully');
        
        // Clear selection only if component is still mounted
        if (isMountedRef.current) {
          setSelectedCardIds(new Set());
        }
        
        // Bot turns and match/game end will be handled by subscription callback
      } else {
        // Show error from validation
        Alert.alert('Invalid Move', result.error || 'Invalid play');
      }
    } catch (error) {
      console.error('❌ [GameScreen] Failed to play cards:', error);
      
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
      console.error('❌ [GameScreen] Game not initialized');
      return;
    }

    if (isPassing) {
      console.log('⏭️ [GameScreen] Pass already in progress, ignoring...');
      return;
    }

    try {
      setIsPassing(true);
      console.log('⏭️ [GameScreen] Player passing...');
      
      const result = await gameManagerRef.current.pass();
      
      if (result.success) {
        console.log('✅ [GameScreen] Pass successful');
        
        // Clear selection only if component is still mounted
        if (isMountedRef.current) {
          setSelectedCardIds(new Set());
        }
        
        // Bot turns will be triggered automatically by the subscription
      } else {
        Alert.alert('Cannot Pass', result.error || 'Cannot pass');
      }
    } catch (error) {
      console.error('❌ [GameScreen] Failed to pass:', error);
      
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
          {/* Match Scoreboard (top-left, outside table) */}
          <View style={styles.scoreboardContainer}>
            <MatchScoreboard
              players={scoreboardPlayers}
              currentMatch={gameState?.currentMatch || 1}
            />
          </View>

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
              />
            </View>
          </View>
        </>
      )}
    </View>
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
