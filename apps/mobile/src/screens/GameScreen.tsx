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
import type { ScoreHistory, PlayHistoryMatch, PlayHistoryHand, PlayerPosition } from '../types/scoreboard';
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
import {
  soundManager,
  hapticManager,
  HapticType,
  SoundType,
  showError,
  showInfo,
  showConfirm,
  performanceMonitor,
} from '../utils';
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
    addPlayHistory,
    setIsScoreboardExpanded, 
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
  const [multiplayerRoomId, setMultiplayerRoomId] = useState<string | null>(null);
  const [multiplayerPlayers, setMultiplayerPlayers] = useState<any[]>([]);
  
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
    playerHands: multiplayerPlayerHands,
    isConnected: isMultiplayerConnected,
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
      // Only show critical errors, not connection issues
      if (!error.message.includes('connection') && !error.message.includes('reconnect')) {
        showError(error.message);
      }
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
    const hands = (multiplayerGameState as any)?.hands as
      | Record<string, Array<{ id: string; rank: string; suit: string } | string>>
      | undefined;
    
    if (!hands) return undefined;
    
    // 🔧 CRITICAL FIX: Parse string cards into objects (handles old game data)
    // Some games created before migration have cards as strings: "D10" instead of {id:"D10", rank:"10", suit:"D"}
    const parsedHands: Record<string, Array<{ id: string; rank: string; suit: string }>> = {};
    
    for (const [playerIndex, handData] of Object.entries(hands)) {
      if (!Array.isArray(handData)) continue;
      
      // Map cards with index tracking for better error reporting
      const parseResults = handData.map((card: any, index: number) => {
        // If card is already an object with id/rank/suit, return as-is
        if (typeof card === 'object' && card !== null && 'id' in card && 'rank' in card && 'suit' in card) {
          return { index, raw: card, parsed: card as { id: string; rank: string; suit: string } };
        }
        
        // If card is a string, parse it into object format
        if (typeof card === 'string') {
          // Handle double-JSON-encoded strings: "\"D10\"" -> "D10"
          let cardStr = card;
          /**
           * Maximum iterations for JSON parsing loop to handle legacy nested string formats.
           * Rationale: Legacy data may have cards with 2-3 levels of JSON nesting.
           * Setting to 5 provides safety margin while preventing infinite loops.
           */
          const MAX_ITERATIONS = 5;
          let iterations = 0;
          try {
            // Try to parse if it's JSON-encoded
            while (typeof cardStr === 'string' && (cardStr.startsWith('"') || cardStr.startsWith('{')) && iterations < MAX_ITERATIONS) {
              iterations++;
              const parsed = JSON.parse(cardStr);
              if (typeof parsed === 'string') {
                // Verify parsed value actually changed (prevent subtle bugs)
                const previousCardStr = cardStr;
                cardStr = parsed;
                if (cardStr === previousCardStr) {
                  console.warn('[GameScreen] JSON.parse returned same value, breaking loop');
                  break;
                }
              } else if (typeof parsed === 'object' && parsed !== null) {
                // It's already an object
                return { index, raw: card, parsed: parsed as { id: string; rank: string; suit: string } };
              } else {
                break;
              }
            }
          } catch (e) {
            // Not JSON, treat as plain string
            console.debug('[GameScreen] JSON parse failed, treating as plain string:', { card, error: e });
          }
          
          // Now cardStr should be like "D10", "C5", "HK", etc.
          // Extract suit (first character) and rank (rest)
          if (cardStr.length >= 2) {
            // Validate suit is one of the four valid suits
            const validSuits = ['D', 'C', 'H', 'S'] as const;
            const suitChar = cardStr[0];
            if (!validSuits.includes(suitChar as any)) {
              gameLogger.error('[GameScreen] 🚨 Invalid suit detected while parsing card string:', {
                rawCard: card,
                parsedString: cardStr,
                suitChar,
              });
              return { index, raw: card, parsed: null };
            }
            const suit = suitChar as (typeof validSuits)[number];
            const rank = cardStr.substring(1); // '10', '5', 'K', etc.
            return {
              index,
              raw: card,
              parsed: {
                id: cardStr,
                rank,
                suit,
              },
            };
          }
        }
        
        // Fallback: Invalid card detected - log error and return null
        gameLogger.error('[GameScreen] 🚨 Could not parse card:', card);
        return { index, raw: card, parsed: null };
      });

      // Check for parsing failures - fail completely if any cards couldn't be parsed
      const failedParses = parseResults.filter(r => r.parsed === null);
      if (failedParses.length > 0) {
        const failedIndices = failedParses.map(f => f.index);
        const errorMsg = `Card parsing failed for ${failedParses.length}/${handData.length} cards in hand for player ${playerIndex}. Failed indices: ${failedIndices.join(', ')}. Cannot proceed with incomplete hand.`;
        gameLogger.error('[GameScreen] 🚨 CRITICAL: ' + errorMsg, {
          playerIndex,
          totalCards: handData.length,
          failedCount: failedParses.length,
          failedCards: failedParses.map(f => f.raw),
        });
        throw new Error(errorMsg);
      }

      // All cards parsed successfully
      parsedHands[playerIndex] = parseResults.map(r => r.parsed!);
    }
    
    return parsedHands;
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
        cards: Array.isArray(playerHand) ? playerHand : [],
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
  
  // CRITICAL FIX: Multiplayer play history tracking
  // Track play_history from multiplayer game state and sync to scoreboard
  useEffect(() => {
    if (!isMultiplayerGame || !multiplayerGameState) return;
    
    const playHistoryArray = (multiplayerGameState as any)?.play_history;
    
    if (!Array.isArray(playHistoryArray) || playHistoryArray.length === 0) {
      return;
    }
    
    gameLogger.info(`[GameScreen] 📊 Syncing ${playHistoryArray.length} plays from multiplayer game state to scoreboard`);
    
    // CRITICAL FIX: Group plays by match_number stored in each play
    // Database format: [{ match_number, position, cards, combo_type, passed }, ...]
    // Scoreboard format: [{ matchNumber, hands: [{ by, type, count, cards }] }, ...]
    
    const playsByMatch: Record<number, PlayHistoryHand[]> = {};
    
    // Group all plays by their match_number
    playHistoryArray.forEach((play: any) => {
      if (play.passed || !play.cards || play.cards.length === 0) return;
      
      const matchNum = play.match_number || 1; // Default to match 1 for legacy plays
      
      if (!playsByMatch[matchNum]) {
        playsByMatch[matchNum] = [];
      }
      
      playsByMatch[matchNum].push({
        by: play.position as PlayerPosition,
        type: play.combo_type || 'single',
        count: play.cards.length,
        cards: play.cards,
      });
    });
    
    // Add each match's plays to scoreboard
    Object.entries(playsByMatch).forEach(([matchNumStr, hands]) => {
      const matchNum = parseInt(matchNumStr, 10);
      const matchData: PlayHistoryMatch = {
        matchNumber: matchNum,
        hands,
      };
      gameLogger.info(`[GameScreen] 📊 Adding ${hands.length} hands for Match ${matchNum} to scoreboard`);
      addPlayHistory(matchData);
    });
    
  }, [isMultiplayerGame, multiplayerGameState, multiplayerPlayers, roomCode, addPlayHistory]);
  
  // CRITICAL FIX: One card left detection for ALL players (local + multiplayer)
  const oneCardLeftDetectedRef = useRef(new Set<string>()); // Track which players we've alerted for
  useEffect(() => {
    const effectiveGameState = isLocalAIGame ? gameState : multiplayerGameState;
    const hands = (effectiveGameState as any)?.hands;
    
    if (!hands || typeof hands !== 'object') return;
    
    // Check each player's hand
    Object.entries(hands).forEach(([playerIndex, cards]) => {
      if (!Array.isArray(cards)) return;
      
      const key = `${roomCode}-${playerIndex}`;
      
      if (cards.length === 1 && !oneCardLeftDetectedRef.current.has(key)) {
        // Player has one card left - first time detection
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

  // CRITICAL FIX: Detect multiplayer game end and open modal with proper data
  useEffect(() => {
    if (!isMultiplayerGame || !multiplayerGameState) return;
    
    const gamePhase = (multiplayerGameState as any)?.game_phase;
    const winner = (multiplayerGameState as any)?.winner;
    const finalScores = (multiplayerGameState as any)?.final_scores;
    
    if (gamePhase !== 'finished' || !winner || !finalScores) {
      return;
    }
    
    gameLogger.info('[GameScreen] 🏁 Multiplayer game finished! Opening end modal...');
    
    // Find winner name
    const winnerPlayer = multiplayerPlayers.find(p => p.player_index === winner);
    const winnerName = winnerPlayer?.username || `Player ${winner + 1}`;
    
    // Convert final_scores to FinalScore format
    const formattedScores: FinalScore[] = Object.entries(finalScores as Record<string, number>).map(([position, score]) => {
      const player = multiplayerPlayers.find(p => p.player_index === parseInt(position));
      return {
        player_index: parseInt(position),
        player_name: player?.username || `Player ${parseInt(position) + 1}`,
        cumulative_score: score as number,
        points_added: 0, // Unknown from this context
      };
    });
    
    // Get player names in order
    const playerNames = multiplayerPlayers.map(p => p.username).filter(Boolean);
    
    // Get scoreboard data
    const currentScoreHistory = scoreHistory || [];
    const currentPlayHistory = playHistoryByMatch || [];
    
    gameLogger.info('[GameScreen] 📊 Opening game end modal with data:', {
      winnerName,
      winnerPosition: winner,
      scoresCount: formattedScores.length,
      playerNamesCount: playerNames.length,
      scoreHistoryCount: currentScoreHistory.length,
      playHistoryCount: currentPlayHistory.length,
    });
    
    // Open game end modal
    openGameEndModal(
      winnerName,
      winner,
      formattedScores,
      playerNames,
      currentScoreHistory,
      currentPlayHistory
    );
    
  }, [isMultiplayerGame, multiplayerGameState, multiplayerPlayers, scoreHistory, playHistoryByMatch, openGameEndModal]);

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
    mapPlayersToScoreboardOrder,
    mapGameIndexToScoreboardPosition,
  } = useScoreboardMapping({
    gameState,
    currentPlayerName,
  });

  // -------------------------------
  // MULTIPLAYER UI DERIVED STATE
  // -------------------------------
  const multiplayerSeatIndex = React.useMemo(() => {
    const me = multiplayerPlayers.find((p) => p.user_id === user?.id);
    const myIndex = typeof me?.player_index === 'number' ? me.player_index : 0;
    return myIndex;
  }, [multiplayerPlayers, user?.id]);

  // multiplayerHandsByIndex moved above playersWithCards to fix bot card loading

  const multiplayerPlayerHand = React.useMemo(() => {
    const raw = multiplayerHandsByIndex?.[String(multiplayerSeatIndex)];
    const result = Array.isArray(raw) ? (raw as any[]) : [];
    return result;
  }, [multiplayerHandsByIndex, multiplayerSeatIndex, multiplayerGameState]);

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
  }, [isLocalAIGame, localPlayerHand, multiplayerPlayerHand, multiplayerHandsByIndex, customCardOrder]);
  
  // CRITICAL: Define multiplayerLastPlay BEFORE using it in useHelperButtons!
  const multiplayerLastPlay = (multiplayerGameState as any)?.last_play ?? null;
  
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

  const multiplayerLastPlayedCards = React.useMemo(() => {
    const cards = multiplayerLastPlay?.cards;
    return Array.isArray(cards) ? cards : [];
  }, [multiplayerLastPlay]);

  const multiplayerLastPlayedBy = React.useMemo(() => {
    // Edge function stores player as player_index (not position)
    const playerIdx = multiplayerLastPlay?.player_index;
    if (typeof playerIdx !== 'number') return null;
    const p = multiplayerPlayers.find((pl) => pl.player_index === playerIdx);
    // Fallback to "Player N" if player list isn't loaded yet
    return p?.username ?? `Player ${playerIdx + 1}`;
  }, [multiplayerLastPlay, multiplayerPlayers]);

  const multiplayerLastPlayComboType = (multiplayerLastPlay?.combo_type as string | null) ?? null;

  const multiplayerLastPlayCombo = React.useMemo(() => {
    if (!multiplayerLastPlayComboType) return null;
    const cards = multiplayerLastPlayedCards;
    if (!Array.isArray(cards) || cards.length === 0) return multiplayerLastPlayComboType;

    if (multiplayerLastPlayComboType === 'Single') return `Single ${cards[0].rank}`;
    if (multiplayerLastPlayComboType === 'Pair') return `Pair of ${cards[0].rank}s`;
    if (multiplayerLastPlayComboType === 'Triple') return `Triple ${cards[0].rank}s`;
    if (multiplayerLastPlayComboType === 'Straight') {
      const sorted = sortCardsForDisplay(cards as any, 'Straight');
      const high = sorted[0];
      return high ? `Straight to ${high.rank}` : 'Straight';
    }
    if (multiplayerLastPlayComboType === 'Flush') {
      const sorted = sortCardsForDisplay(cards as any, 'Flush');
      const high = sorted[0];
      return high ? `Flush (${high.rank} high)` : 'Flush';
    }
    if (multiplayerLastPlayComboType === 'Straight Flush') {
      const sorted = sortCardsForDisplay(cards as any, 'Straight Flush');
      const high = sorted[0];
      return high ? `Straight Flush to ${high.rank}` : 'Straight Flush';
    }

    return multiplayerLastPlayComboType;
  }, [multiplayerLastPlayComboType, multiplayerLastPlayedCards]);

  const multiplayerLayoutPlayers = React.useMemo(() => {
    const getName = (idx: number): string => {
      const p = multiplayerPlayers.find((pl) => pl.player_index === idx);
      return p?.username ?? `Player ${idx + 1}`;
    };

    const getCount = (idx: number): number => {
      const hand = multiplayerHandsByIndex?.[String(idx)];
      return Array.isArray(hand) ? hand.length : 13;
    };
    
    const getScore = (idx: number): number => {
      const scores = (multiplayerGameState as any)?.scores;
      // FIXED Task #539: Database stores scores as ARRAY [0,0,0,0], not object
      if (!Array.isArray(scores)) return 0;
      return scores[idx] || 0;
    };

    const currentTurn = (multiplayerGameState as any)?.current_turn;
    const isActive = (idx: number) => typeof currentTurn === 'number' && currentTurn === idx;

    // CRITICAL: RELATIVE positioning - each player sees THEMSELVES at bottom
    // This is standard card game UX: you're always at bottom, others positioned clockwise
    // Layout array: [0]=bottom (you), [1]=top (opposite), [2]=left, [3]=right
    const bottom = multiplayerSeatIndex;           // Current player (YOU)
    const top = (multiplayerSeatIndex + 2) % 4;    // Opposite player (2 seats away)
    const left = (multiplayerSeatIndex + 3) % 4;   // Left player (3 seats counterclockwise)
    const right = (multiplayerSeatIndex + 1) % 4;  // Right player (1 seat clockwise)

    return [
      { name: getName(bottom), cardCount: getCount(bottom), score: getScore(bottom), isActive: isActive(bottom), player_index: bottom },
      { name: getName(top), cardCount: getCount(top), score: getScore(top), isActive: isActive(top), player_index: top },
      { name: getName(left), cardCount: getCount(left), score: getScore(left), isActive: isActive(left), player_index: left },
      { name: getName(right), cardCount: getCount(right), score: getScore(right), isActive: isActive(right), player_index: right },
    ];
  }, [multiplayerPlayers, multiplayerHandsByIndex, multiplayerGameState, multiplayerSeatIndex]);

  // Effective values moved ABOVE helper buttons hook (line ~307) to fix helper button bugs
  const effectiveLastPlayedCards = isLocalAIGame ? localLastPlayedCards : (multiplayerLastPlayedCards as any);
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
        const newState = await manager.initializeGame({
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

    const currentMatchNumber = (multiplayerGameState as any)?.match_number ?? null;
    const gamePhase = (multiplayerGameState as any)?.game_phase;

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
  }, [isMultiplayerGame, isLocalAIGame, gameState?.auto_pass_timer?.remaining_ms, multiplayerGameState?.auto_pass_timer?.remaining_ms]);

  // CRITICAL FIX: Play/Pass action handlers - defined in GameScreen to work in BOTH orientations
  // Previously these were only set by GameControls which is only mounted in portrait mode
  // PHASE 6: Updated to support both local and multiplayer modes
  // Task #568: Add ref-based guards to prevent race conditions during server validation
  // Copilot Review: Use separate refs to prevent cross-operation blocking
  const [isPlayingCards, setIsPlayingCards] = useState(false);
  const [isPassing, setIsPassing] = useState(false);
  const isPlayingCardsRef = useRef(false); // Synchronous guard for duplicate play requests
  const isPassingRef = useRef(false); // Synchronous guard for duplicate pass requests

  const handlePlayCards = useCallback(async (cards: Card[]) => {
    // Task #568: Prevent race condition with synchronous ref check
    // Copilot Review: Separate ref for play operations only
    if (isPlayingCardsRef.current) {
      gameLogger.warn('⚠️ [GameScreen] Card play already in progress, ignoring duplicate request');
      return;
    }

    // PHASE 6: Route to appropriate game engine
    if (isLocalAIGame) {
      // Local AI game - use GameStateManager
      if (!gameManagerRef.current) {
        gameLogger.error('❌ [GameScreen] Game not initialized');
        return;
      }

      try {
        isPlayingCardsRef.current = true; // Set synchronous guard
        setIsPlayingCards(true);

        // Task #270: Add haptic feedback for Play button
        hapticManager.playCard();

        // Task #313: Auto-sort cards for proper display order before submission
        // This ensures straights are played as 6-5-4-3-2 (highest first) not 3-4-5-6-2
        const sortedCards = sortCardsForDisplay(cards);
        const cardIds = sortedCards.map(card => card.id);
        
        const result = await gameManagerRef.current.playCards(cardIds);
        
        // CRITICAL FIX: Check return value for errors (playCards returns {success, error}, doesn't throw)
        if (!result.success) {
          gameLogger.warn(`❌ [GameScreen] Invalid play: ${result.error}`);
          soundManager.playSound(SoundType.INVALID_MOVE);
          showError(result.error || 'Invalid play');
          return; // Don't clear selection or play sound
        }
        
        setSelectedCardIds(new Set());
        soundManager.playSound(SoundType.CARD_PLAY);
      } catch (error: any) {
        gameLogger.error('❌ [GameScreen] Error playing cards:', error?.message || String(error));
        soundManager.playSound(SoundType.INVALID_MOVE);
        showError(error.message || 'Failed to play cards');
      } finally {
        isPlayingCardsRef.current = false; // Clear synchronous guard
        setIsPlayingCards(false);
      }
    } else {
      // Multiplayer game - use Realtime hook
      if (!multiplayerPlayCards) {
        gameLogger.error('❌ [GameScreen] Multiplayer not initialized');
        return;
      }

      try {
        isPlayingCardsRef.current = true; // Set synchronous guard
        setIsPlayingCards(true);
        hapticManager.playCard();
        
        const sortedCards = sortCardsForDisplay(cards);
        await multiplayerPlayCards(sortedCards as any);
        setSelectedCardIds(new Set());
        soundManager.playSound(SoundType.CARD_PLAY);
      } catch (error: any) {
        gameLogger.error('❌ [GameScreen] Error playing cards:', error?.message || String(error));
        showError(error.message || 'Failed to play cards');
      } finally {
        isPlayingCardsRef.current = false; // Clear synchronous guard
        setIsPlayingCards(false);
      }
    }
  }, [isLocalAIGame, gameManagerRef, multiplayerPlayCards, setSelectedCardIds]);

  const handlePass = useCallback(async () => {
    // Task #568: Prevent race condition with synchronous ref check
    // Copilot Review: Separate ref for pass operations only
    if (isPassingRef.current) {
      gameLogger.warn('⚠️ [GameScreen] Pass action already in progress, ignoring duplicate request');
      return;
    }

    // PHASE 6: Route to appropriate game engine
    if (isLocalAIGame) {
      // Local AI game
      if (!gameManagerRef.current) {
        gameLogger.error('❌ [GameScreen] Game not initialized');
        return;
      }

      try {
        isPassingRef.current = true; // Set synchronous guard
        setIsPassing(true);

        // Task #270: Add haptic feedback for Pass button
        hapticManager.pass();

        const result = await gameManagerRef.current.pass();
        
        // CRITICAL FIX: Check return value for errors (pass returns {success, error}, doesn't throw)
        if (!result.success) {
          gameLogger.warn(`❌ [GameScreen] Cannot pass: ${result.error}`);
          soundManager.playSound(SoundType.INVALID_MOVE);
          showError(result.error || 'Cannot pass');
          return; // Don't clear selection or play sound
        }
        
        setSelectedCardIds(new Set());
        soundManager.playSound(SoundType.PASS);
      } catch (error: any) {
        gameLogger.error('❌ [GameScreen] Error passing:', error?.message || String(error));
        soundManager.playSound(SoundType.INVALID_MOVE);
        showError(error.message || 'Failed to pass');
      } finally {
        isPassingRef.current = false; // Clear synchronous guard
        setIsPassing(false);
      }
    } else {
      // Multiplayer game
      if (!multiplayerPass) {
        gameLogger.error('❌ [GameScreen] Multiplayer not initialized');
        return;
      }

      try {
        isPassingRef.current = true; // Set synchronous guard
        setIsPassing(true);
        hapticManager.pass();
        
        await multiplayerPass();
        setSelectedCardIds(new Set());
        soundManager.playSound(SoundType.PASS);
      } catch (error: any) {
        gameLogger.error('❌ [GameScreen] Error passing (multiplayer):', error?.message || String(error));
        showError(error.message || 'Failed to pass');
      } finally {
        isPassingRef.current = false; // Clear synchronous guard
        setIsPassing(false);
      }
    }
  }, [isLocalAIGame, gameManagerRef, multiplayerPass, setSelectedCardIds]);

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
  // SAFETY: effectivePlayerHand now guaranteed to be array (never undefined)
  const selectedCards = getSelectedCards(effectivePlayerHand);

  const layoutPlayers = isLocalAIGame ? players : (multiplayerLayoutPlayers as any);

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
    return multiplayerPlayers.map(p => p.username || p.player_name || `Player ${p.player_index + 1}`);
  }, [isLocalAIGame, gameState, multiplayerPlayers]);
  const hasEffectiveGameState = isLocalAIGame ? !!gameState : !!multiplayerGameState;
  // 🔥 FIXED Task #540: Auto-pass timer now works in BOTH local AND multiplayer!
  // The game_state table has auto_pass_timer column for multiplayer (added Dec 28, 2025)
  const effectiveAutoPassTimerState = isLocalAIGame
    ? ((gameState as any)?.auto_pass_timer ?? undefined)
    : ((multiplayerGameState as any)?.auto_pass_timer ?? undefined); // ✅ Now reads from multiplayer game_state!

  // 📊 PRODUCTION FIX: Scoreboard currentPlayerIndex must match multiplayerLayoutPlayers array order.
  // multiplayerLayoutPlayers array order: [me (index 0), top (index 1), left (index 2), right (index 3)].
  // We resolve the LAYOUT ARRAY INDEX of the active player so that:
  //   - LandscapeGameLayout's isOpponentActive(index) shows the red circle on the correct player
  //   - LandscapeScoreboard highlights the correct row
  // NOTE: Portrait is unaffected — it reads .isActive directly from each player object.
  const multiplayerCurrentTurn = (multiplayerGameState as any)?.current_turn;

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
            matchNumber={isLocalAIGame ? ((gameState as any)?.currentMatch ?? 1) : ((multiplayerGameState as any)?.match_number ?? 1)}
            isGameFinished={(gameState as any)?.gameOver ?? false}
            scoreHistory={scoreHistory}
            playHistory={playHistoryByMatch}
            originalPlayerNames={memoizedOriginalPlayerNames}
            autoPassTimerState={effectiveAutoPassTimerState}

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
            {/* Scoreboard Container (top-left, with expand/collapse & play history) */}
            <ScoreboardContainer
            playerNames={memoizedPlayerNames}
            currentScores={memoizedCurrentScores}
            cardCounts={memoizedCardCounts}
            currentPlayerIndex={effectiveScoreboardCurrentPlayerIndex}
            matchNumber={isLocalAIGame ? ((gameState as any)?.currentMatch ?? 1) : ((multiplayerGameState as any)?.match_number ?? 1)}
            isGameFinished={(gameState as any)?.gameOver ?? false}
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
            players={layoutPlayers as any}
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
