/**
 * MultiplayerGameScreen - Complete standalone screen for multiplayer games
 * 
 * Handles: 2-4 human players + optional AI bots with server-side game state
 * State Management: useRealtime (Supabase Realtime sync)
 * Bot Management: useBotCoordinator (HOST only)
 * Task #570 - Extracted from 1,366-line GameScreen.tsx
 */

import React, { useState, useEffect, useRef, useCallback, useMemo, Profiler } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, BackHandler } from 'react-native';
import { useRoute, RouteProp, useNavigation, CommonActions } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../../navigation/AppNavigator';
import { CardHand, PlayerInfo, GameSettingsModal, HelperButtons, GameControls, GameLayout } from '../../components/game';
import { ScoreboardContainer } from '../../components/scoreboard';
import type { Card } from '../../game/types';
import type { ScoreHistory, PlayHistoryMatch, PlayHistoryHand, PlayerPosition } from '../../types/scoreboard';
import { COLORS, SPACING, FONT_SIZES, LAYOUT, OVERLAYS, POSITIONING } from '../../constants';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../services/supabase';
import { useBotCoordinator } from '../../hooks/useBotCoordinator';
import { useRealtime } from '../../hooks/useRealtime';
import { gameLogger } from '../../utils/logger';
import { useScoreboard } from '../../contexts/ScoreboardContext';
import { soundManager, hapticManager, SoundType, showError } from '../../utils';
import { useHelperButtons } from '../../hooks/useHelperButtons';
import { useCardSelection } from '../../hooks/useCardSelection';
import { useOrientationManager } from '../../hooks/useOrientationManager';
import { LandscapeGameLayout } from '../../components/gameRoom/LandscapeGameLayout';
import { sortCardsForDisplay } from '../../utils/cardSorting';

type GameScreenRouteProp = RouteProp<RootStackParamList, 'Game'>;
type GameScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Game'>;

export function MultiplayerGameScreen() {
  const route = useRoute<GameScreenRouteProp>();
  const navigation = useNavigation<GameScreenNavigationProp>();
  const { user, profile } = useAuth();
  const { addScoreHistory, scoreHistory, playHistoryByMatch } = useScoreboard();
  const { roomCode } = route.params;
  const [showSettings, setShowSettings] = useState(false);
  
  gameLogger.info('[MultiplayerGameScreen] Initializing for room:', roomCode);
  
  // State for multiplayer room data
  const [multiplayerPlayers, setMultiplayerPlayers] = useState<any[]>([]);
  
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

  // Load multiplayer room data
  useEffect(() => {
    const loadMultiplayerRoom = async () => {
      try {
        const { data: roomData, error: roomError } = await supabase
          .from('rooms')
          .select('id')
          .eq('code', roomCode)
          .single();
        
        if (roomError || !roomData) {
          gameLogger.error('[MultiplayerGameScreen] Room not found:', roomError);
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
        gameLogger.info(`[MultiplayerGameScreen] Loaded ${playersData?.length || 0} players from room`);
      } catch (error: any) {
        gameLogger.error('[MultiplayerGameScreen] Error loading room:', error?.message || String(error));
      }
    };
    
    loadMultiplayerRoom();
  }, [roomCode, navigation]);

  // Server-side multiplayer game state
  const { 
    gameState: multiplayerGameState, 
    isHost: isMultiplayerHost,
    isDataReady: isMultiplayerDataReady,
    players: realtimePlayers,
    playCards: multiplayerPlayCards,
    pass: multiplayerPass,
    connectToRoom: multiplayerConnectToRoom,
  } = useRealtime({
    userId: user?.id || '',
    username: currentPlayerName,
    onError: (error) => {
      gameLogger.error('[MultiplayerGameScreen] Multiplayer error:', error.message);
      if (!error.message.includes('connection') && !error.message.includes('reconnect')) {
        showError(error.message);
      }
    },
    onDisconnect: () => {
      gameLogger.warn('[MultiplayerGameScreen] Multiplayer disconnected');
    },
    onReconnect: () => {
      gameLogger.info('[MultiplayerGameScreen] Multiplayer reconnected successfully');
    },
    onMatchEnded: (matchNumber, matchScores) => {
      gameLogger.info(`[MultiplayerGameScreen] 🏆 Match ${matchNumber} ended!`, matchScores);
      
      const pointsAdded: number[] = [];
      const cumulativeScores: number[] = [];
      
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
      
      gameLogger.info('[MultiplayerGameScreen] 📊 Adding score history entry:', scoreHistoryEntry);
      addScoreHistory(scoreHistoryEntry);
    },
  });

  // Connect to room when entering screen
  useEffect(() => {
    if (!user?.id) return;

    multiplayerConnectToRoom(roomCode).catch((error: any) => {
      console.error('[MultiplayerGameScreen] ❌ Failed to connect:', error);
      gameLogger.error('[MultiplayerGameScreen] Failed to connect:', error?.message || String(error));
      showError(error?.message || 'Failed to connect to room');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode, user?.id]);
  
  // Multiplayer hands memo
  const multiplayerHandsByIndex = useMemo(() => {
    const hands = (multiplayerGameState as any)?.hands as
      | Record<string, Array<{ id: string; rank: string; suit: string }>>
      | undefined;
    
    return hands;
  }, [multiplayerGameState]);
  
  // Merge player hands for bot coordinator
  const playersWithCards = useMemo(() => {
    if (!multiplayerPlayers) {
      return [];
    }
    
    const hasHands = !!multiplayerHandsByIndex;
    
    const result = multiplayerPlayers.map((player) => {
      const playerHandKey = String(player.player_index);
      const playerHand = hasHands ? multiplayerHandsByIndex[playerHandKey] : undefined;
      
      const withCards = {
        ...player,
        player_id: player.id,
        cards: Array.isArray(playerHand) ? playerHand : [],
      };
      
      return withCards;
    });
    
    return result;
  }, [multiplayerHandsByIndex, multiplayerPlayers]);
  
  // Bot coordinator (HOST only)
  useBotCoordinator({
    roomCode: roomCode,
    isCoordinator: isMultiplayerDataReady && isMultiplayerHost && playersWithCards.length > 0,
    gameState: multiplayerGameState,
    players: playersWithCards,
    playCards: multiplayerPlayCards,
    passMove: multiplayerPass,
  });
  
  // Multiplayer play history tracking
  useEffect(() => {
    if (!multiplayerGameState) return;
    
    const playHistoryArray = (multiplayerGameState as any)?.play_history;
    
    if (!Array.isArray(playHistoryArray) || playHistoryArray.length === 0) {
      return;
    }
    
    gameLogger.info(`[MultiplayerGameScreen] 📊 Syncing ${playHistoryArray.length} plays to scoreboard`);
    
    const playsByMatch: Record<number, PlayHistoryHand[]> = {};
    
    playHistoryArray.forEach((play: any) => {
      if (play.passed || !play.cards || play.cards.length === 0) return;
      
      const matchNum = play.match_number || 1;
      
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
  }, [multiplayerGameState]);

  // Derived game state (multiplayer uses different data structure)
  // CRITICAL: Get player's index first, then use it to get hand from game state
  const currentPlayerIndex = useMemo(() => {
    if (!realtimePlayers || !user?.id) return 0;
    const playerIndex = realtimePlayers.findIndex(p => p.user_id === user.id);
    return playerIndex >= 0 ? playerIndex : 0;
  }, [realtimePlayers, user?.id]);

  const effectivePlayerHand: Card[] = useMemo(() => {
    // Get hand from game state using player_index as key
    const hands = (multiplayerGameState as any)?.hands;
    if (!hands) return [];
    
    const playerHandKey = String(currentPlayerIndex);
    const hand = hands[playerHandKey];
    
    gameLogger.info('[MultiplayerGameScreen] 🎴 Player hand lookup:', {
      currentPlayerIndex,
      playerHandKey,
      handExists: !!hand,
      handSize: hand?.length || 0,
    });
    
    let result = Array.isArray(hand) ? hand : [];
    
    // CRITICAL: Apply custom card order from drag/drop and helper buttons
    if (customCardOrder.length > 0 && result.length > 0) {
      const orderMap = new Map(customCardOrder.map((id, index) => [id, index]));
      result = [...result].sort((a, b) => {
        const aIndex = orderMap.get(a.id) ?? 999;
        const bIndex = orderMap.get(b.id) ?? 999;
        return aIndex - bIndex;
      });
    }
    
    return result;
  }, [multiplayerGameState, currentPlayerIndex, customCardOrder]);

  const effectiveLastPlayedCards: Card[] = useMemo(() => {
    const lastPlay = (multiplayerGameState as any)?.last_play;
    return lastPlay?.cards || [];
  }, [multiplayerGameState]);

  const effectiveLastPlayedBy = useMemo(() => {
    const lastPlay = (multiplayerGameState as any)?.last_play;
    return lastPlay?.by || null;
  }, [multiplayerGameState]);

  const effectiveLastPlayComboType = useMemo(() => {
    const lastPlay = (multiplayerGameState as any)?.last_play;
    return lastPlay?.comboType || null;
  }, [multiplayerGameState]);

  const effectiveLastPlayCombo = useMemo(() => {
    const lastPlay = (multiplayerGameState as any)?.last_play;
    return lastPlay?.combo || null;
  }, [multiplayerGameState]);

  // Scoreboard mapping (multiplayer uses realtime players)
  const layoutPlayers = useMemo(() => {
    // CRITICAL: Always return 4 players for proper GameLayout rendering
    const currentTurn = (multiplayerGameState as any)?.current_turn ?? 0;
    const hands = (multiplayerGameState as any)?.hands;
    
    if (!realtimePlayers || realtimePlayers.length === 0) {
      // Loading state - return placeholder players
      return [
        {
          name: currentPlayerName,
          cardCount: 13,
          score: 0,
          isActive: false,
          isCurrentPlayer: true,
        },
        {
          name: 'Player 2',
          cardCount: 13,
          score: 0,
          isActive: false,
          isCurrentPlayer: false,
        },
        {
          name: 'Player 3',
          cardCount: 13,
          score: 0,
          isActive: false,
          isCurrentPlayer: false,
        },
        {
          name: 'Player 4',
          cardCount: 13,
          score: 0,
          isActive: false,
          isCurrentPlayer: false,
        },
      ];
    }

    // Map realtime players to layout format
    const mappedPlayers = realtimePlayers.map((player, idx) => {
      // Get hand from game state using player_index
      const playerHandKey = String(player.player_index ?? idx);
      const hand = hands?.[playerHandKey];
      const cardCount = Array.isArray(hand) ? hand.length : 13;
      
      return {
        name: player.username || `Player ${idx + 1}`,
        cardCount,
        score: 0, // TODO: Get from game state
        isActive: idx === currentTurn,
        isCurrentPlayer: player.user_id === user?.id,
      };
    });

    // CRITICAL: Ensure exactly 4 players for GameLayout
    while (mappedPlayers.length < 4) {
      mappedPlayers.push({
        name: `Player ${mappedPlayers.length + 1}`,
        cardCount: 13,
        score: 0,
        isActive: false,
        isCurrentPlayer: false,
      });
    }

    return mappedPlayers.slice(0, 4); // Ensure exactly 4 players
  }, [realtimePlayers, multiplayerGameState, currentPlayerName, user?.id]);

  // Helper buttons
  const {
    handleSort,
    handleSmartSort,
    handleHint,
  } = useHelperButtons({
    playerHand: effectivePlayerHand,
    lastPlay: null,
    isFirstPlay: effectiveLastPlayedCards.length === 0,
    customCardOrder,
    setCustomCardOrder,
    setSelectedCardIds,
  });

  // Auto-pass timer audio/haptic feedback
  const hasPlayedHighestCardSoundRef = useRef(false);

  useEffect(() => {
    const timerState = multiplayerGameState?.auto_pass_timer;

    if (!timerState || !timerState.active) {
      hasPlayedHighestCardSoundRef.current = false;
      return;
    }

    if (!hasPlayedHighestCardSoundRef.current) {
      soundManager.playSound(SoundType.HIGHEST_CARD);
      gameLogger.info('🎵 [Audio] Highest card sound - auto-pass timer active');
      hasPlayedHighestCardSoundRef.current = true;
    }

    const remaining_ms = timerState.remaining_ms;
    const displaySeconds = Math.ceil(remaining_ms / 1000);
    
    if (displaySeconds <= 5 && displaySeconds >= 1) {
      gameLogger.warn(`🚨 [VIBRATION] Urgent countdown at ${displaySeconds}s`);
      hapticManager.urgentCountdown(displaySeconds);
      gameLogger.info(`📳 [Haptic] Progressive vibration: ${displaySeconds}s`);
    }
  }, [multiplayerGameState?.auto_pass_timer?.remaining_ms]);

  // Play/Pass action handlers with race condition guards
  const isPlayingCardsRef = useRef(false);
  const isPassingRef = useRef(false);

  const handlePlayCards = useCallback(async (cards: Card[]) => {
    if (isPlayingCardsRef.current) {
      gameLogger.warn('⚠️ [MultiplayerGameScreen] Play already in progress');
      return;
    }

    if (!multiplayerPlayCards) {
      gameLogger.error('❌ [MultiplayerGameScreen] Not initialized');
      return;
    }

    try {
      isPlayingCardsRef.current = true;
      setIsPlayingCards(true);
      hapticManager.playCard();
      
      const sortedCards = sortCardsForDisplay(cards);
      await multiplayerPlayCards(sortedCards as any);
      setSelectedCardIds(new Set());
      soundManager.playSound(SoundType.CARD_PLAY);
    } catch (error: any) {
      gameLogger.error('❌ [MultiplayerGameScreen] Error playing cards:', error?.message || String(error));
      showError(error.message || 'Failed to play cards');
    } finally {
      isPlayingCardsRef.current = false;
      setIsPlayingCards(false);
    }
  }, [multiplayerPlayCards, setSelectedCardIds]);

  const handlePass = useCallback(async () => {
    if (isPassingRef.current) {
      gameLogger.warn('⚠️ [MultiplayerGameScreen] Pass already in progress');
      return;
    }

    if (!multiplayerPass) {
      gameLogger.error('❌ [MultiplayerGameScreen] Not initialized');
      return;
    }

    try {
      isPassingRef.current = true;
      setIsPassing(true);
      hapticManager.pass();

      await multiplayerPass();
      setSelectedCardIds(new Set());
      soundManager.playSound(SoundType.PASS);
    } catch (error: any) {
      gameLogger.error('❌ [MultiplayerGameScreen] Error passing:', error?.message || String(error));
      showError(error.message || 'Failed to pass');
    } finally {
      isPassingRef.current = false;
      setIsPassing(false);
    }
  }, [multiplayerPass, setSelectedCardIds]);

  // Track mounted status
  const isMountedRef = useRef(true);
  
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Callback handlers for GameControls
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

  // Get selected cards
  const selectedCards = useMemo(() => {
    if (customCardOrder.length > 0) {
      return customCardOrder
        .filter(cardId => selectedCardIds.has(cardId))
        .map(cardId => effectivePlayerHand.find(c => c.id === cardId))
        .filter((c): c is Card => c !== undefined);
    }
    
    return effectivePlayerHand.filter(c => selectedCardIds.has(c.id));
  }, [selectedCardIds, effectivePlayerHand, customCardOrder]);

  // Refs for drag-to-play handlers
  const onPlayCardsRef = useRef<((cards: Card[]) => Promise<void>) | null>(null);
  const onPassRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    onPlayCardsRef.current = handlePlayCards;
    onPassRef.current = handlePass;
  }, [handlePlayCards, handlePass]);

  const handleCardHandPlayCards = useCallback((cards: Card[]) => {
    if (onPlayCardsRef.current) {
      onPlayCardsRef.current(cards);
    }
  }, []);

  const handleCardHandPass = useCallback(() => {
    if (onPassRef.current) {
      onPassRef.current();
    }
  }, []);

  // Leave game handler
  const handleLeaveGame = useCallback(() => {
    Alert.alert(
      'Leave Game',
      'Are you sure you want to leave this game?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: () => {
            navigation.dispatch(
              CommonActions.reset({
                index: 0,
                routes: [{ name: 'Home' }],
              })
            );
          },
        },
      ],
      { cancelable: true }
    );
  }, [navigation]);

  // Back button handler
  useEffect(() => {
    const onBackPress = () => {
      handleLeaveGame();
      return true;
    };

    const backHandler = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    
    return () => backHandler.remove();
  }, [handleLeaveGame]);

  // Cleanup: Remove player from room on deliberate navigation
  useEffect(() => {
    let isDeliberateLeave = false;
    
    const allowedActionTypes = ['POP', 'GO_BACK', 'NAVIGATE'];
    const unsubscribe = navigation.addListener('beforeRemove', async (e: any) => {
      const actionType = e?.data?.action?.type;
      if (
        typeof actionType === 'string' &&
        allowedActionTypes.includes(actionType)
      ) {
        isDeliberateLeave = true;
        
        // Unlock orientation
        if (orientationAvailable) {
          try {
            const ScreenOrientation = require('expo-screen-orientation');
            await ScreenOrientation.unlockAsync();
            gameLogger.info('🔓 [Orientation] Unlocked on navigation away');
          } catch (error) {
            gameLogger.error('❌ [Orientation] Failed to unlock:', error);
          }
        }
      }
    });

    return () => {
      unsubscribe();
      
      if (isDeliberateLeave && user?.id && roomCode) {
        gameLogger.info(`🧹 [MultiplayerGameScreen] Removing user ${user.id} from room ${roomCode}`);
        
        supabase
          .from('room_players')
          .delete()
          .eq('user_id', user.id)
          .then(({ error }) => {
            if (error) {
              gameLogger.error('❌ [MultiplayerGameScreen] Cleanup error:', error?.message);
            } else {
              gameLogger.info('✅ [MultiplayerGameScreen] Successfully removed from room');
            }
          });
      }
    };
  }, [user, roomCode, navigation, orientationAvailable]);

  // Check if we have game state
  const hasGameState = !!multiplayerGameState;
  const effectiveAutoPassTimerState = multiplayerGameState?.auto_pass_timer;
  
  // Loading state - don't render game UI until data is ready
  const isLoading = !multiplayerGameState || layoutPlayers.length === 0;

  // Memoized scoreboard data
  const memoizedCurrentScores = useMemo(() => {
    return layoutPlayers.map(p => p.score);
  }, [layoutPlayers]);

  const memoizedCardCounts = useMemo(() => {
    return layoutPlayers.map(p => p.cardCount);
  }, [layoutPlayers]);

  const memoizedOriginalPlayerNames = useMemo(() => {
    return layoutPlayers.map(p => p.name);
  }, [layoutPlayers]);

  const memoizedPlayerNames = useMemo(() => {
    return layoutPlayers.map(p => p.name);
  }, [layoutPlayers]);

  const effectiveScoreboardCurrentPlayerIndex = useMemo(() => {
    const activeIndex = layoutPlayers.findIndex(p => p.isActive);
    return activeIndex >= 0 ? activeIndex : 0;
  }, [layoutPlayers]);

  // Render based on orientation
  const isLandscape = currentOrientation?.includes('LANDSCAPE');

  // Performance profiling
  const onRenderCallback = useCallback((
    id: string,
    phase: 'mount' | 'update' | 'nested-update',
    actualDuration: number
  ) => {
    if (actualDuration > 16) {
      gameLogger.warn(`[Performance] ${id} render took ${actualDuration.toFixed(2)}ms`);
    }
  }, []);

  // Show loading state while connecting/loading
  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Connecting to game...</Text>
        <Text style={styles.loadingSubtext}>Room: {roomCode}</Text>
      </View>
    );
  }

  return (
    <Profiler id="MultiplayerGameScreen" onRender={onRenderCallback}>
      <View style={styles.container}>
      {isLandscape ? (
        <LandscapeGameLayout
          playerNames={memoizedPlayerNames}
          currentScores={memoizedCurrentScores}
          cardCounts={memoizedCardCounts}
          currentPlayerIndex={effectiveScoreboardCurrentPlayerIndex}
          matchNumber={(multiplayerGameState as any)?.match_number ?? 1}
          isGameFinished={false}
          scoreHistory={scoreHistory}
          playHistory={playHistoryByMatch}
          originalPlayerNames={memoizedOriginalPlayerNames}
          autoPassTimerState={effectiveAutoPassTimerState ?? undefined}
          lastPlayedCards={effectiveLastPlayedCards as any}
          lastPlayedBy={effectiveLastPlayedBy as any}
          lastPlayComboType={effectiveLastPlayComboType as any}
          lastPlayCombo={effectiveLastPlayCombo as any}
          playerName={layoutPlayers[0]?.name ?? currentPlayerName}
          playerCardCount={layoutPlayers[0]?.cardCount ?? effectivePlayerHand.length}
          playerCards={effectivePlayerHand}
          isPlayerActive={layoutPlayers[0]?.isActive ?? false}
          selectedCardIds={selectedCardIds}
          onSelectionChange={setSelectedCardIds}
          onCardsReorder={handleCardsReorder}
          onPlayCards={handleCardHandPlayCards}
          onOrientationToggle={toggleOrientation}
          onSort={handleSort}
          onSmartSort={handleSmartSort}
          onHint={handleHint}
          onPlay={() => handlePlayCards(selectedCards)}
          onPass={handlePass}
          onSettings={() => setShowSettings(true)}
          canPlay={(layoutPlayers[0]?.isActive ?? false) && hasGameState}
        />
      ) : (
        <>
          {/* Scoreboard (top-left, outside table) */}
          <View style={styles.scoreboardContainer}>
            <ScoreboardContainer
              currentScores={memoizedCurrentScores}
              cardCounts={memoizedCardCounts}
              currentPlayerIndex={effectiveScoreboardCurrentPlayerIndex}
              matchNumber={(multiplayerGameState as any)?.match_number ?? 1}
              isGameFinished={false}
              scoreHistory={scoreHistory}
              playHistory={playHistoryByMatch}
              originalPlayerNames={memoizedOriginalPlayerNames}
              playerNames={memoizedPlayerNames}
            />
          </View>

          {/* Hamburger menu (top-right, outside table) */}
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

          {/* Orientation Toggle Button */}
          <Pressable 
            style={styles.orientationToggleContainer} 
            onPress={() => {
              gameLogger.info('🔄 [UI] Orientation toggle button pressed');
              toggleOrientation();
            }}
            accessibilityRole="button"
            accessibilityLabel="Toggle orientation"
          >
            <Text style={styles.orientationToggleIcon}>
              🔄
            </Text>
          </Pressable>

          {/* Game table layout */}
          <GameLayout
            players={layoutPlayers as any}
            lastPlayedCards={effectiveLastPlayedCards as any}
            lastPlayedBy={effectiveLastPlayedBy as any}
            lastPlayComboType={effectiveLastPlayComboType as any}
            lastPlayCombo={effectiveLastPlayCombo as any}
            autoPassTimerState={effectiveAutoPassTimerState ?? undefined}
          />

          {/* PlayerInfo */}
          <View style={styles.playerInfoContainer}>
            <PlayerInfo
              name={layoutPlayers[0]?.name ?? currentPlayerName}
              cardCount={layoutPlayers[0]?.cardCount ?? effectivePlayerHand.length}
              isActive={layoutPlayers[0]?.isActive ?? false}
            />
          </View>
          
          {/* Action buttons (Play/Pass) */}
          <View style={styles.actionButtonsRow}>
            <GameControls
              gameManager={null}
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
          
          {/* Helper Buttons Row (Sort/Smart/Hint) */}
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
              canPlay={(layoutPlayers[0]?.isActive ?? false) && hasGameState}
              disabled={false}
              hideButtons={true}
              selectedCardIds={selectedCardIds}
              onSelectionChange={setSelectedCardIds}
              onCardsReorder={handleCardsReorder}
            />
          </View>
        </>
      )}
      
      {/* Game Settings Modal */}
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
