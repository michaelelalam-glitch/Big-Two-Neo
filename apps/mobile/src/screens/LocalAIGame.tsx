/**
 * LocalAIGame - Full component for Local AI (client-side) game mode.
 * Contains all local-only hooks (game state manager, bot turn manager, derived state, etc.)
 * plus shared hooks (card selection, orientation, audio, etc.), then renders GameView.
 * Created as part of Task #570: Split GameScreen component.
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRoute, RouteProp, useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { useAuth } from '../contexts/AuthContext';
import { useGameEnd } from '../contexts/GameEndContext';
import { useScoreboard } from '../contexts/ScoreboardContext';
import { useBotTurnManager } from '../hooks/useBotTurnManager';
import { useCardSelection } from '../hooks/useCardSelection';
import { useDerivedGameState } from '../hooks/useDerivedGameState';
import { useGameActions } from '../hooks/useGameActions';
import { useGameAudio } from '../hooks/useGameAudio';
import { useGameCleanup } from '../hooks/useGameCleanup';
import { useGameEndCallbacks } from '../hooks/useGameEndCallbacks';
import { useGameStateManager } from '../hooks/useGameStateManager';
import { sortHandLowestToHighest } from '../utils/helperButtonUtils';
import { useHelperButtons } from '../hooks/useHelperButtons';
import { useOneCardLeftAlert } from '../hooks/useOneCardLeftAlert';
import { useOrientationManager } from '../hooks/useOrientationManager';
import { usePlayerDisplayData } from '../hooks/usePlayerDisplayData';
import { usePlayerTotalScores } from '../hooks/usePlayerTotalScores';
import { usePlayHistoryTracking } from '../hooks/usePlayHistoryTracking';
import { useScoreboardMapping } from '../hooks/useScoreboardMapping';
import { gameLogger } from '../utils/logger';
import { RootStackParamList } from '../navigation/AppNavigator';
import type { Card } from '../game/types';
import type { GameStateManager } from '../game/state';
import type { FinalScore } from '../types/gameEnd';
import type { ScoreHistory, PlayHistoryMatch } from '../types/scoreboard';
import { GameContextProvider } from '../contexts/GameContext';
import type { GameContextType } from '../contexts/GameContext';
import { GameView } from './GameView';

type GameScreenRouteProp = RouteProp<RootStackParamList, 'Game'>;
type GameScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Game'>;

export function LocalAIGame() {
  const route = useRoute<GameScreenRouteProp>();
  const navigation = useNavigation<GameScreenNavigationProp>();
  const { user, profile } = useAuth();
  const scoreboardContext = useScoreboard();
  const {
    addScoreHistory,
    restoreScoreHistory,
    scoreHistory,
    playHistoryByMatch,
    clearHistory,
    setIsPlayHistoryOpen,
    setIsScoreboardExpanded,
  } = scoreboardContext;
  const { openGameEndModal, setOnPlayAgain, setOnReturnToMenu } = useGameEnd();
  const { roomCode, forceNewGame = false, botDifficulty = 'medium' } = route.params;
  const [showSettings, setShowSettings] = useState(false);

  const currentPlayerName = profile?.username || user?.email?.split('@')[0] || 'Player';

  gameLogger.info('🎮 [LocalAIGame] Game mode: LOCAL AI (client-side)');

  // Card selection hook
  const {
    selectedCardIds,
    setSelectedCardIds,
    customCardOrder,
    setCustomCardOrder,
    handleCardsReorder,
  } = useCardSelection();

  // Orientation manager (Task #450)
  const {
    currentOrientation,
    toggleOrientation,
    isAvailable: orientationAvailable,
  } = useOrientationManager();

  // Bot turn management
  const gameManagerRefPlaceholder = useRef<GameStateManager | null>(null);
  const { checkAndExecuteBotTurn } = useBotTurnManager({
    gameManagerRef: gameManagerRefPlaceholder,
    botDifficulty,
  });

  // Client-side game state
  const { gameManagerRef, gameState, isInitializing } = useGameStateManager({
    roomCode,
    currentPlayerName,
    forceNewGame,
    isLocalGame: true,
    botDifficulty,
    addScoreHistory,
    restoreScoreHistory,
    openGameEndModal: (
      winnerName: string,
      winnerPosition: number,
      finalScores: FinalScore[],
      playerNames: string[],
      sh: ScoreHistory[],
      ph: PlayHistoryMatch[]
    ) => {
      openGameEndModal(winnerName, winnerPosition, finalScores, playerNames, sh, ph);
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

  // Derived game state (player hand, last play info)
  const { playerHand, lastPlayedCards, lastPlayedBy, lastPlayComboType, lastPlayCombo } =
    useDerivedGameState({
      gameState,
      customCardOrder,
      setCustomCardOrder,
    });

  // Scoreboard mapping (map game players to display positions)
  const { players } = useScoreboardMapping({ gameState, currentPlayerName });

  // Play history tracking
  usePlayHistoryTracking(gameState);

  // One card left alert
  useOneCardLeftAlert({
    isLocalAIGame: true,
    gameState,
    multiplayerGameState: null,
    multiplayerPlayers: [],
    roomCode,
  });

  // Effective player hand (apply custom card order)
  const effectivePlayerHand: Card[] = React.useMemo(() => {
    let result = (playerHand ?? []) as Card[];
    if (customCardOrder.length > 0 && result.length > 0) {
      const orderMap = new Map(customCardOrder.map((id, index) => [id, index]));
      result = [...result].sort(
        (a, b) => (orderMap.get(a.id) ?? 999) - (orderMap.get(b.id) ?? 999)
      );
    }
    return result;
  }, [playerHand, customCardOrder]);

  // Auto-sort hand when cards are first dealt
  const hasAutoSortedRef = useRef(false);
  useEffect(() => {
    const hand = (playerHand ?? []) as Card[];
    if (hand.length > 0 && customCardOrder.length === 0 && !hasAutoSortedRef.current) {
      hasAutoSortedRef.current = true;
      const sorted = sortHandLowestToHighest(hand);
      setCustomCardOrder(sorted.map(c => c.id));
    }
    if (hand.length === 0) {
      hasAutoSortedRef.current = false;
    }
  }, [playerHand, customCardOrder, setCustomCardOrder]);

  // Helper buttons
  const { handleSort, handleSmartSort, handleHint } = useHelperButtons({
    playerHand: effectivePlayerHand,
    lastPlay: gameState?.lastPlay || null,
    isFirstPlay:
      gameState?.lastPlay === null && gameState?.players.every(p => p.hand.length === 13),
    customCardOrder,
    setCustomCardOrder,
    setSelectedCardIds,
  });

  // Game end callbacks (play again / return to menu)
  useGameEndCallbacks({
    gameManagerRef,
    currentPlayerName,
    botDifficulty,
    navigation,
    setOnPlayAgain,
    setOnReturnToMenu,
    clearHistory,
  });

  // Cleanup: navigation cleanup + mount tracking
  const { isMountedRef } = useGameCleanup({
    userId: user?.id,
    roomCode,
    navigation,
    orientationAvailable,
  });

  // Audio/haptic feedback
  useGameAudio({
    isLocalAIGame: true,
    isMultiplayerGame: false,
    gameState,
    multiplayerGameState: null,
  });

  // Play/Pass action handlers
  const {
    handlePlayCards,
    handlePass,
    handlePlaySuccess,
    handlePassSuccess,
    handleCardHandPlayCards,
    handleCardHandPass,
    handleLeaveGame,
  } = useGameActions({
    isLocalAIGame: true,
    gameManagerRef,
    multiplayerPlayCards: null,
    multiplayerPass: null,
    setSelectedCardIds,
    navigation,
    isMountedRef,
  });

  // Computed values
  // useMemo ensures selectedCards only gets a new reference when the hand or
  // selection actually changes (perf/task-628, mirrors MultiplayerGame fix).
  const selectedCards = useMemo(
    () => effectivePlayerHand.filter(card => selectedCardIds.has(card.id)),
    [effectivePlayerHand, selectedCardIds]
  );
  const layoutPlayers = players;
  const playerTotalScores = usePlayerTotalScores(layoutPlayers, scoreHistory);

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
    isLocalAIGame: true,
    gameState,
    multiplayerGameState: null,
    multiplayerPlayers: [],
    layoutPlayers,
    scoreHistory,
    playerTotalScores,
    multiplayerLayoutPlayers: [],
  });

  // Stable callbacks for GameView — wrapped with useCallback so React.memo on GameView
  // can bail out when these props haven't semantically changed (H2 audit fix).
  const togglePlayHistory = useCallback(
    () => setIsPlayHistoryOpen((prev: boolean) => !prev),
    [setIsPlayHistoryOpen]
  );
  const toggleScoreboardExpanded = useCallback(
    () => setIsScoreboardExpanded((prev: boolean) => !prev),
    [setIsScoreboardExpanded]
  );

  // Player is ready when it's their turn, game state exists, and game manager is initialized
  const isPlayerReady =
    (layoutPlayers[0]?.isActive ?? false) && !!gameState && !!gameManagerRef.current;

  // Build the context value; useMemo keeps the object reference stable so that
  // GameView (wrapped in React.memo) only re-renders when game-visible state
  // actually changes (H2 + H4 audit fix).
  const gameContextValue = React.useMemo<GameContextType>(
    () => ({
      isLocalAIGame: true,
      currentOrientation,
      toggleOrientation,
      isInitializing,
      isConnected: true,
      showSettings,
      setShowSettings,
      effectivePlayerHand,
      selectedCardIds,
      setSelectedCardIds,
      handleCardsReorder,
      selectedCards,
      customCardOrder,
      setCustomCardOrder,
      effectiveLastPlayedCards: lastPlayedCards,
      effectiveLastPlayedBy: lastPlayedBy,
      effectiveLastPlayComboType: lastPlayComboType,
      effectiveLastPlayCombo: lastPlayCombo,
      layoutPlayers,
      layoutPlayersWithScores,
      playerTotalScores,
      currentPlayerName,
      togglePlayHistory,
      toggleScoreboardExpanded,
      memoizedPlayerNames,
      memoizedCurrentScores,
      memoizedCardCounts,
      memoizedOriginalPlayerNames,
      effectiveAutoPassTimerState,
      effectiveScoreboardCurrentPlayerIndex,
      matchNumber,
      isGameFinished,
      displayOrderScoreHistory,
      playHistoryByMatch,
      handlePlayCards,
      handlePass,
      handlePlaySuccess,
      handlePassSuccess,
      handleCardHandPlayCards,
      handleCardHandPass,
      handleLeaveGame,
      handleSort,
      handleSmartSort,
      handleHint,
      isPlayerReady,
      gameManagerRef,
      isMountedRef,
      // Task #651 / #649: video + voice chat is multiplayer-only; no-op stubs here
      isChatConnected: false,
      voiceChatEnabled: false,
      isLocalCameraOn: false,
      isLocalMicOn: false,
      remoteCameraStates: {},
      remoteMicStates: {},
      remotePlayerIds: [],
      toggleVideoChat: async () => {},
      toggleCamera: async () => {},
      toggleVoiceChat: async () => {},
      toggleMic: async () => {},
      isVideoChatConnecting: false,
      isAudioConnecting: false,
      getVideoTrackRef: () => undefined,
      // Task #648: text chat is multiplayer-only; no-op stubs here
      chatMessages: [],
      sendChatMessage: () => false,
      chatUnreadCount: 0,
      isChatCooldown: false,
      isChatDrawerOpen: false,
      toggleChatDrawer: () => {},
      localUserId: '',
      // Throwables are multiplayer-only; no-op stubs here
      throwableActiveEffects: [null, null, null, null],
      throwableIncoming: null,
      throwableDismissIncoming: () => {},
      sendThrowable: () => {},
      isThrowCooldown: false,
      cooldownRemaining: 0,
    }),
    [
      currentOrientation,
      toggleOrientation,
      isInitializing,
      showSettings,
      setShowSettings,
      effectivePlayerHand,
      selectedCardIds,
      setSelectedCardIds,
      handleCardsReorder,
      selectedCards,
      customCardOrder,
      setCustomCardOrder,
      lastPlayedCards,
      lastPlayedBy,
      lastPlayComboType,
      lastPlayCombo,
      layoutPlayers,
      layoutPlayersWithScores,
      playerTotalScores,
      currentPlayerName,
      togglePlayHistory,
      toggleScoreboardExpanded,
      memoizedPlayerNames,
      memoizedCurrentScores,
      memoizedCardCounts,
      memoizedOriginalPlayerNames,
      effectiveAutoPassTimerState,
      effectiveScoreboardCurrentPlayerIndex,
      matchNumber,
      isGameFinished,
      displayOrderScoreHistory,
      playHistoryByMatch,
      handlePlayCards,
      handlePass,
      handlePlaySuccess,
      handlePassSuccess,
      handleCardHandPlayCards,
      handleCardHandPass,
      handleLeaveGame,
      handleSort,
      handleSmartSort,
      handleHint,
      isPlayerReady,
      gameManagerRef,
      isMountedRef,
    ]
  );

  return (
    <GameContextProvider value={gameContextValue}>
      <GameView />
    </GameContextProvider>
  );
}
