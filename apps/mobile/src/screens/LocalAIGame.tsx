/**
 * LocalAIGame - Full component for Local AI (client-side) game mode.
 * Contains all local-only hooks (game state manager, bot turn manager, derived state, etc.)
 * plus shared hooks (card selection, orientation, audio, etc.), then renders GameView.
 * Created as part of Task #570: Split GameScreen component.
 */
import React, { useState, useEffect, useRef } from 'react';
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
  } = scoreboardContext;
  const { openGameEndModal, setOnPlayAgain, setOnReturnToMenu } = useGameEnd();
  const { roomCode, forceNewGame = false, botDifficulty = 'medium' } = route.params;
  const [showSettings, setShowSettings] = useState(false);

  const currentPlayerName = profile?.username || user?.email?.split('@')[0] || 'Player';

  useEffect(() => {
    gameLogger.info('🎮 [LocalAIGame] Game mode: LOCAL AI (client-side)');
  }, []);

  // Card selection hook
  const {
    selectedCardIds,
    setSelectedCardIds,
    customCardOrder,
    setCustomCardOrder,
    handleCardsReorder,
    getSelectedCards,
  } = useCardSelection();

  // Orientation manager (Task #450)
  const { currentOrientation, toggleOrientation, isAvailable: orientationAvailable } = useOrientationManager();

  // Bot turn management
  const gameManagerRefPlaceholder = useRef<GameStateManager | null>(null);
  const { checkAndExecuteBotTurn } = useBotTurnManager({
    gameManagerRef: gameManagerRefPlaceholder,
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
      ph: PlayHistoryMatch[],
    ) => {
      openGameEndModal(winnerName, winnerPosition, finalScores, playerNames, sh, ph);
    },
    scoreHistory,
    playHistoryByMatch,
    checkAndExecuteBotTurn,
  });

  // Keep placeholder ref in sync with the actual gameManagerRef (direct assignment is safe for refs)
  gameManagerRefPlaceholder.current = gameManagerRef.current;

  // Derived game state (player hand, last play info)
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
      result = [...result].sort((a, b) => (orderMap.get(a.id) ?? 999) - (orderMap.get(b.id) ?? 999));
    }
    return result;
  }, [playerHand, customCardOrder]);

  // Helper buttons
  const { handleSort, handleSmartSort, handleHint } = useHelperButtons({
    playerHand: effectivePlayerHand,
    lastPlay: gameState?.lastPlay || null,
    isFirstPlay: gameState?.lastPlay === null && gameState?.players.every((p) => p.hand.length === 13),
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
  const selectedCards = getSelectedCards(effectivePlayerHand);
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

  // Player is ready when it's their turn, game state exists, and game manager is initialized
  const isPlayerReady = (layoutPlayers[0]?.isActive ?? false) && !!gameState && !!gameManagerRef.current;

  return (
    <GameView
      isLocalAIGame={true}
      currentOrientation={currentOrientation}
      toggleOrientation={toggleOrientation}
      isInitializing={isInitializing}
      isConnected={true}
      showSettings={showSettings}
      setShowSettings={setShowSettings}
      effectivePlayerHand={effectivePlayerHand}
      selectedCardIds={selectedCardIds}
      setSelectedCardIds={setSelectedCardIds}
      handleCardsReorder={handleCardsReorder}
      selectedCards={selectedCards}
      customCardOrder={customCardOrder}
      setCustomCardOrder={setCustomCardOrder}
      effectiveLastPlayedCards={lastPlayedCards}
      effectiveLastPlayedBy={lastPlayedBy}
      effectiveLastPlayComboType={lastPlayComboType}
      effectiveLastPlayCombo={lastPlayCombo}
      layoutPlayers={layoutPlayers}
      layoutPlayersWithScores={layoutPlayersWithScores}
      playerTotalScores={playerTotalScores}
      currentPlayerName={currentPlayerName}
      togglePlayHistory={() => scoreboardContext.setIsPlayHistoryOpen((prev: boolean) => !prev)}
      toggleScoreboardExpanded={() => scoreboardContext.setIsScoreboardExpanded((prev: boolean) => !prev)}
      memoizedPlayerNames={memoizedPlayerNames}
      memoizedCurrentScores={memoizedCurrentScores}
      memoizedCardCounts={memoizedCardCounts}
      memoizedOriginalPlayerNames={memoizedOriginalPlayerNames}
      effectiveAutoPassTimerState={effectiveAutoPassTimerState}
      effectiveScoreboardCurrentPlayerIndex={effectiveScoreboardCurrentPlayerIndex}
      matchNumber={matchNumber}
      isGameFinished={isGameFinished}
      displayOrderScoreHistory={displayOrderScoreHistory}
      playHistoryByMatch={playHistoryByMatch}
      handlePlayCards={handlePlayCards}
      handlePass={handlePass}
      handlePlaySuccess={handlePlaySuccess}
      handlePassSuccess={handlePassSuccess}
      handleCardHandPlayCards={handleCardHandPlayCards}
      handleCardHandPass={handleCardHandPass}
      handleLeaveGame={handleLeaveGame}
      handleSort={handleSort}
      handleSmartSort={handleSmartSort}
      handleHint={handleHint}
      isPlayerReady={isPlayerReady}
      gameManagerRef={gameManagerRef}
      isMountedRef={isMountedRef}
    />
  );
}
