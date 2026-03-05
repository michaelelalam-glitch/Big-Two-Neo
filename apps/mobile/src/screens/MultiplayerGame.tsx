/**
 * MultiplayerGame - Full component for Multiplayer (server-side) game mode.
 * Contains all multiplayer-only hooks (realtime, bot coordinator, match end handler, etc.)
 * plus shared hooks (card selection, orientation, audio, etc.), then renders GameView.
 * Created as part of Task #570: Split GameScreen component.
 */
import React, { useState, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRoute, RouteProp, useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { useAuth } from '../contexts/AuthContext';
import { useGameEnd } from '../contexts/GameEndContext';
import { useScoreboard } from '../contexts/ScoreboardContext';
import { useServerBotCoordinator } from '../hooks/useServerBotCoordinator';
import { useCardSelection } from '../hooks/useCardSelection';
import { useGameActions } from '../hooks/useGameActions';
import { useGameAudio } from '../hooks/useGameAudio';
import { useGameCleanup } from '../hooks/useGameCleanup';
import { useHelperButtons } from '../hooks/useHelperButtons';
import { useGameStatsUploader } from '../hooks/useGameStatsUploader';
import { useMatchEndHandler } from '../hooks/useMatchEndHandler';
import { useMultiplayerLayout } from '../hooks/useMultiplayerLayout';
import { useMultiplayerPlayHistory } from '../hooks/useMultiplayerPlayHistory';
import { useMultiplayerScoreHistory } from '../hooks/useMultiplayerScoreHistory';
import { useMultiplayerRoomLoader } from '../hooks/useMultiplayerRoomLoader';
import type { RoomInfo } from '../hooks/useMultiplayerRoomLoader';
import { useOneCardLeftAlert } from '../hooks/useOneCardLeftAlert';
import { useOrientationManager } from '../hooks/useOrientationManager';
import { usePlayerDisplayData } from '../hooks/usePlayerDisplayData';
import { usePlayerTotalScores } from '../hooks/usePlayerTotalScores';
import { useRealtime } from '../hooks/useRealtime';
import { useConnectionManager } from '../hooks/useConnectionManager';
import { RejoinModal } from '../components/game/RejoinModal';
import { RootStackParamList } from '../navigation/AppNavigator';
import { showError } from '../utils';
import { gameLogger } from '../utils/logger';
import { parseMultiplayerHands } from '../utils/parseMultiplayerHands';
import type { Card } from '../game/types';
import type { GameStateManager } from '../game/state';
// FinalScore import removed — onGameOver callback replaced by useMatchEndHandler (DB-authoritative path)
import type { GameState as MultiplayerGameState, Player as MultiplayerPlayer } from '../types/multiplayer';
import type { ScoreHistory } from '../types/scoreboard';
import { GameView } from './GameView';

type GameScreenRouteProp = RouteProp<RootStackParamList, 'Game'>;
type GameScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Game'>;

export function MultiplayerGame() {
  const route = useRoute<GameScreenRouteProp>();
  const navigation = useNavigation<GameScreenNavigationProp>();
  const { user, profile } = useAuth();
  const scoreboardContext = useScoreboard();
  const {
    addScoreHistory,
    addPlayHistory,
    restoreScoreHistory,
    scoreHistory,
    playHistoryByMatch,
  } = scoreboardContext;
  const { openGameEndModal, setOnPlayAgain, setOnReturnToMenu } = useGameEnd();
  const { roomCode, botDifficulty = 'medium' } = route.params;
  const [showSettings, setShowSettings] = useState(false);

  // State for multiplayer room data
  const [multiplayerPlayers, setMultiplayerPlayers] = useState<MultiplayerPlayer[]>([]);
  const [roomInfo, setRoomInfo] = useState<RoomInfo | null>(null);
  // Track when game transitions to 'playing' to calculate duration
  const [gameStartedAt, setGameStartedAt] = useState<string | null>(null);

  // Rejoin modal state (fix/rejoin)
  const [showRejoinModal, setShowRejoinModal] = useState(false);
  const [rejoinBotUsername, setRejoinBotUsername] = useState<string | null>(null);

  // ── Derived IDs for useConnectionManager ──────────────────────────────────
  // The current user's room_players row (needed for heartbeat + reconnect)
  const myRoomPlayerRow = React.useMemo(
    () => multiplayerPlayers.find((p) => p.user_id === user?.id || p.human_user_id === user?.id),
    [multiplayerPlayers, user?.id],
  );

  // Orientation manager (Task #450)
  const { currentOrientation, toggleOrientation, isAvailable: orientationAvailable } = useOrientationManager();

  const currentPlayerName = profile?.username || user?.email?.split('@')[0] || 'Player';

  // ── Connection manager (fix/rejoin) ───────────────────────────────────────
  const { reconnect: connectionReconnect, disconnect: connectionDisconnect } = useConnectionManager({
    roomId: roomInfo?.id ?? '',
    playerId: myRoomPlayerRow?.id ?? '',
    enabled: !!(roomInfo?.id && myRoomPlayerRow?.id),
    onBotReplaced: () => {
      // Server has placed a bot in our seat — surface the reclaim modal
      const botRow = multiplayerPlayers.find(
        (p) => p.human_user_id === user?.id && p.is_bot,
      );
      setRejoinBotUsername(botRow?.username ?? null);
      setShowRejoinModal(true);
    },
    onRoomClosed: () => {
      // Room was closed while we were away — send player home
      navigation.reset({
        index: 0,
        routes: [{ name: 'Home' }],
      });
    },
  });

  gameLogger.info('🎮 [MultiplayerGame] Game mode: MULTIPLAYER (server-side)');

  // ─── Register Play Again / Return to Menu callbacks ──────────────────────
  useEffect(() => {
    setOnPlayAgain(() => () => {
      gameLogger.info('🔄 [MultiplayerGame] Play Again → navigating to Lobby with same room');
      // Navigate to Lobby so the player can re-queue / rejoin the same room
      navigation.reset({
        index: 0,
        routes: [{ name: 'Home' }, { name: 'Lobby', params: { roomCode } }],
      });
    });

    setOnReturnToMenu(() => () => {
      gameLogger.info('🏠 [MultiplayerGame] Return to Menu → Home');
      navigation.reset({
        index: 0,
        routes: [{ name: 'Home' }],
      });
    });
  }, [roomCode, navigation, setOnPlayAgain, setOnReturnToMenu]);
  // ─────────────────────────────────────────────────────────────────────────────

  // Card selection hook
  const {
    selectedCardIds,
    setSelectedCardIds,
    customCardOrder,
    setCustomCardOrder,
    handleCardsReorder,
    getSelectedCards,
  } = useCardSelection();

  // Initialize multiplayer room data
  useMultiplayerRoomLoader({ isMultiplayerGame: true, roomCode, navigation, setMultiplayerPlayers, setRoomInfo });

  // Empty game manager ref (multiplayer has no local game engine)
  const emptyGameManagerRef = useRef<GameStateManager | null>(null);

  // Server-side multiplayer game state via Realtime
  const {
    gameState: multiplayerGameState,
    isHost: isMultiplayerHost,
    isDataReady: isMultiplayerDataReady,
    isConnected,
    players: realtimePlayers,
    playCards: multiplayerPlayCards,
    pass: multiplayerPass,
    connectToRoom: multiplayerConnectToRoom,
  } = useRealtime({
    userId: user?.id || '',
    username: currentPlayerName,
    onError: (error) => {
      gameLogger.error('[MultiplayerGame] Multiplayer error:', error.message);
      const msg = error.message?.toLowerCase() || '';
      if (
        msg.includes('connection') ||
        msg.includes('reconnect') ||
        msg.includes('not your turn') ||
        // When a bot holds the player's seat the initial connectToRoom membership
        // check fails with this message. useConnectionManager surfaces the reclaim
        // modal instead — no need to show a redundant alert.
        msg.includes('not a member')
      ) {
        gameLogger.warn('⚠️ [MultiplayerGame] Suppressed non-critical multiplayer error from UI');
        return;
      }
      showError(error.message);
    },
    onDisconnect: () => {
      gameLogger.warn('[MultiplayerGame] Multiplayer disconnected');
    },
    onReconnect: () => {
      gameLogger.info('[MultiplayerGame] Multiplayer reconnected successfully');
    },
    // NOTE: onMatchEnded removed — score history is populated exclusively by
    // useMultiplayerScoreHistory which reads from game_state.scores_history (DB).
    // Having both caused every match to be added twice (doubling cumulative scores).
    //
    // NOTE: onGameOver removed — game-end modal is opened exclusively by
    // useMatchEndHandler which reads from multiplayerGameState after the postgres_changes
    // update arrives.  The broadcast-path opened the modal with stale React state
    // (missing last match in score history, zero final standings for non-winner),
    // producing different UIs per player.  useMatchEndHandler uses DB-authoritative data
    // so every player — winner and losers — sees the same correct modal.
  });

  // Track when game starts (for duration calculation)
  // Placed after useRealtime so multiplayerGameState is already declared.
  useEffect(() => {
    if (multiplayerGameState?.game_phase === 'first_play' || multiplayerGameState?.game_phase === 'playing') {
      if (!gameStartedAt) {
        setGameStartedAt(new Date().toISOString());
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multiplayerGameState?.game_phase]);

  // ── Sync multiplayerPlayers from realtime (fix/rejoin) ────────────────────
  // useRealtime subscribes to room_players postgres_changes, so realtimePlayers
  // contains fresh connection_status, human_user_id, is_bot updates for ALL players.
  // We keep multiplayerPlayers in sync so the disconnect spinner renders correctly.
  useEffect(() => {
    if (realtimePlayers && realtimePlayers.length > 0) {
      setMultiplayerPlayers(realtimePlayers as MultiplayerPlayer[]);
    }
  }, [realtimePlayers]);

  // Ensure multiplayer realtime channel is joined when entering the Game screen
  useEffect(() => {
    if (!user?.id) return;

    multiplayerConnectToRoom(roomCode).catch((error: Error) => {
      console.error('[MultiplayerGame] ❌ Failed to connect:', error);
      gameLogger.error('[MultiplayerGame] Failed to connect:', error?.message || String(error));
      // 'not a member' means a bot currently holds the seat — useConnectionManager
      // will surface the RejoinModal so we intentionally skip the alert here.
      const msg = (error?.message || '').toLowerCase();
      if (msg.includes('not a member')) return;
      showError(error?.message || 'Failed to connect to room');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode, user?.id]);

  // ─── MULTIPLAYER SCORE HISTORY PERSISTENCE ─────────────────────────────────
  const ROOM_SCORE_KEY = `@big2_score_history_${roomCode}`;
  const hasRestoredMultiplayerScoresRef = useRef(false);

  // 1. Restore score history for this room on mount
  useEffect(() => {
    if (hasRestoredMultiplayerScoresRef.current) return;

    (async () => {
      try {
        const stored = await AsyncStorage.getItem(ROOM_SCORE_KEY);
        if (stored) {
          const parsed: ScoreHistory[] = JSON.parse(stored);
          if (Array.isArray(parsed) && parsed.length > 0) {
            gameLogger.info(`[MultiplayerGame] 🔄 Restoring ${parsed.length} score history entries for room ${roomCode}`);
            restoreScoreHistory(parsed);
          }
        }
      } catch (err: unknown) {
        gameLogger.error('[MultiplayerGame] Failed to restore multiplayer score history:', err instanceof Error ? err.message : String(err));
      } finally {
        hasRestoredMultiplayerScoresRef.current = true;
      }
    })();
  }, [ROOM_SCORE_KEY, roomCode, restoreScoreHistory]);

  // 2. Persist score history for this room whenever it changes
  const isFirstMultiplayerRenderRef = useRef(true);
  useEffect(() => {
    if (isFirstMultiplayerRenderRef.current) {
      isFirstMultiplayerRenderRef.current = false;
      return;
    }
    if (scoreHistory.length > 0) {
      AsyncStorage.setItem(ROOM_SCORE_KEY, JSON.stringify(scoreHistory)).catch((err) => {
        gameLogger.error('[MultiplayerGame] Failed to persist multiplayer score history:', err?.message || String(err));
      });
    }
  }, [scoreHistory, ROOM_SCORE_KEY]);
  // ─────────────────────────────────────────────────────────────────────────────

  // MULTIPLAYER HANDS MEMO
  const multiplayerHandsByIndex = React.useMemo(() => {
    const hands = multiplayerGameState?.hands;
    return parseMultiplayerHands(hands as Record<string, ({ id: string; rank: string; suit: string } | string)[]> | undefined);
  }, [multiplayerGameState]);

  // Merge player hands into players for bot coordinator
  const playersWithCards = React.useMemo(() => {
    if (!multiplayerPlayers) {
      return [];
    }

    const hasHands = !!multiplayerHandsByIndex;

    return multiplayerPlayers.map((player) => {
      const playerHandKey = String(player.player_index);
      const playerHand = hasHands ? multiplayerHandsByIndex[playerHandKey] : undefined;

      return {
        ...player,
        player_id: player.id,
        cards: (Array.isArray(playerHand) ? playerHand : []) as Card[],
      };
    });
  }, [multiplayerHandsByIndex, multiplayerPlayers]);

  // DIAGNOSTIC: Track coordinator status.
  // NOTE: realtimePlayers intentionally excluded from deps — it changed on every heartbeat
  // tick (every ~1 s across 4 players) which spammed this log and caused unnecessary
  // re-evaluations.  The values that actually affect coordinator readiness are
  // isMultiplayerDataReady, isMultiplayerHost, and playersWithCards.
  useEffect(() => {
    const coordinatorStatus = isMultiplayerDataReady && isMultiplayerHost && playersWithCards.length > 0;
    gameLogger.info('[MultiplayerGame] 🎯 Coordinator Status:', {
      isCoordinator: coordinatorStatus,
      breakdown: {
        isMultiplayerGame: true,
        isMultiplayerDataReady,
        isMultiplayerHost,
        playersWithCardsCount: playersWithCards.length,
      },
      will_trigger_bots: coordinatorStatus,
    });
  }, [isMultiplayerDataReady, isMultiplayerHost, playersWithCards]);

  // Server-side bot coordinator fallback (Tasks #551/#552)
  useServerBotCoordinator({
    roomCode,
    enabled: isMultiplayerDataReady && playersWithCards.length > 0,
    gameState: multiplayerGameState,
    players: playersWithCards,
  });

  // Multiplayer play history tracking
  useMultiplayerPlayHistory({
    isMultiplayerGame: true,
    multiplayerGameState: multiplayerGameState as MultiplayerGameState | null,
    addPlayHistory,
  });

  // Multiplayer score history tracking (from game_state.scores_history)
  // This ensures scoreboard is populated even for bot-triggered match ends
  // where no HTTP response or broadcast reaches the human client.
  useMultiplayerScoreHistory({
    isMultiplayerGame: true,
    multiplayerGameState: multiplayerGameState as MultiplayerGameState | null,
    addScoreHistory,
  });

  // One card left alert
  useOneCardLeftAlert({
    isLocalAIGame: false,
    gameState: null,
    multiplayerGameState,
    multiplayerPlayers,
    roomCode,
  });

  // Detect multiplayer game end and open modal
  useMatchEndHandler({
    isMultiplayerGame: true,
    multiplayerGameState: multiplayerGameState as MultiplayerGameState | null,
    multiplayerPlayers,
    scoreHistory: scoreHistory || [],
    playHistoryByMatch: playHistoryByMatch || [],
    openGameEndModal,
  });

  // Upload game stats to leaderboard when game finishes
  useGameStatsUploader({
    isMultiplayerGame: true,
    multiplayerGameState: multiplayerGameState as MultiplayerGameState | null,
    multiplayerPlayers,
    roomInfo,
    gameStartedAt,
    // Pass the host-selected difficulty as a fallback for when the DB column is NULL.
    // The navigation param defaults to 'medium' so non-host players who didn't select
    // a difficulty still get a sensible fallback.
    botDifficultyFallback: botDifficulty,
  });

  // Multiplayer UI derived state
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

  // Effective player hand (apply custom card order)
  const effectivePlayerHand: Card[] = React.useMemo(() => {
    let result = (multiplayerPlayerHand ?? []) as Card[];
    if (customCardOrder.length > 0 && result.length > 0) {
      const orderMap = new Map(customCardOrder.map((id, index) => [id, index]));
      result = [...result].sort((a, b) => (orderMap.get(a.id) ?? 999) - (orderMap.get(b.id) ?? 999));
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- multiplayerHandsByIndex is a safety dep
  }, [multiplayerPlayerHand, multiplayerHandsByIndex, customCardOrder]);

  // Helper buttons
  const { handleSort, handleSmartSort, handleHint } = useHelperButtons({
    playerHand: effectivePlayerHand,
    lastPlay: multiplayerLastPlay || null,
    isFirstPlay: multiplayerLastPlay === null,
    customCardOrder,
    setCustomCardOrder,
    setSelectedCardIds,
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
    isLocalAIGame: false,
    isMultiplayerGame: true,
    gameState: null,
    multiplayerGameState,
  });

  // Task #573: Stable callback that reads the latest game state at call-time for
  // client-side card validation in useGameActions (avoids stale-closure issues).
  const getMultiplayerValidationState = React.useCallback(() => {
    if (!multiplayerGameState) return null;
    return {
      lastPlay: multiplayerGameState.last_play ?? null,
      isFirstPlayOfGame: multiplayerGameState.match_number === 1 && multiplayerGameState.last_play === null,
      playerHand: (multiplayerPlayerHand ?? []) as Card[],
    };
  }, [multiplayerGameState, multiplayerPlayerHand]);

  // Play/Pass action handlers
  const {
    handlePlayCards,
    handlePass,
    handlePlaySuccess,
    handlePassSuccess,
    handleCardHandPlayCards,
    handleCardHandPass,
    handleLeaveGame: handleLeaveGameBase,
  } = useGameActions({
    isLocalAIGame: false,
    gameManagerRef: emptyGameManagerRef,
    multiplayerPlayCards,
    multiplayerPass,
    setSelectedCardIds,
    navigation,
    isMountedRef,
    getMultiplayerValidationState,
  });

  // Wrap leave so we fire mark-disconnected (explicit leave) before navigating (fix/rejoin)
  const handleLeaveGame = React.useCallback((skipConfirmation?: boolean) => {
    // Fire-and-forget — we don't block navigation on this
    connectionDisconnect().catch(() => {});
    handleLeaveGameBase(skipConfirmation);
  }, [connectionDisconnect, handleLeaveGameBase]);

  // Computed values
  const selectedCards = getSelectedCards(effectivePlayerHand);
  const layoutPlayers = multiplayerLayoutPlayers;
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
    isLocalAIGame: false,
    gameState: null,
    multiplayerGameState,
    multiplayerPlayers,
    layoutPlayers,
    scoreHistory,
    playerTotalScores,
    multiplayerLayoutPlayers,
  });

  // Player is ready when it's their turn and multiplayer game state exists
  const isPlayerReady = (layoutPlayers[0]?.isActive ?? false) && !!multiplayerGameState;

  return (
    <>
      <GameView
        isLocalAIGame={false}
        currentOrientation={currentOrientation}
        toggleOrientation={toggleOrientation}
        isInitializing={!isMultiplayerDataReady}
        isConnected={isConnected}
        showSettings={showSettings}
        setShowSettings={setShowSettings}
        roomCode={roomCode}
        effectivePlayerHand={effectivePlayerHand}
        selectedCardIds={selectedCardIds}
        setSelectedCardIds={setSelectedCardIds}
        handleCardsReorder={handleCardsReorder}
        selectedCards={selectedCards}
        customCardOrder={customCardOrder}
        setCustomCardOrder={setCustomCardOrder}
        effectiveLastPlayedCards={multiplayerLastPlayedCards}
        effectiveLastPlayedBy={multiplayerLastPlayedBy}
        effectiveLastPlayComboType={multiplayerLastPlayComboType}
        effectiveLastPlayCombo={multiplayerLastPlayCombo}
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
        gameManagerRef={emptyGameManagerRef}
        isMountedRef={isMountedRef}
      />

      {/* Rejoin / reclaim-seat modal (fix/rejoin) */}
      <RejoinModal
        visible={showRejoinModal}
        botUsername={rejoinBotUsername}
        onReclaim={async () => {
          await connectionReconnect();
          setShowRejoinModal(false);
          // Re-establish the Realtime channel after reclaiming the seat.
          // The initial connectToRoom may have succeeded (Fix A: human_user_id match)
          // or failed (pre-fix path). Either way, calling it again is safe:
          // it refreshes players/game-state and ensures isConnected=true so the
          // game renders properly instead of staying on "Initializing game…".
          multiplayerConnectToRoom(roomCode).catch((e: Error) => {
            gameLogger.error('[MultiplayerGame] post-reclaim reconnect failed:', e?.message || String(e));
          });
        }}
        onDismiss={() => setShowRejoinModal(false)}
      />
    </>
  );
}
