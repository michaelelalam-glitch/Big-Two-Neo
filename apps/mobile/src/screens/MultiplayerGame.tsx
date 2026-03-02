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
import { useMatchEndHandler } from '../hooks/useMatchEndHandler';
import { useMultiplayerLayout } from '../hooks/useMultiplayerLayout';
import { useMultiplayerPlayHistory } from '../hooks/useMultiplayerPlayHistory';
import { useMultiplayerRoomLoader } from '../hooks/useMultiplayerRoomLoader';
import { supabase } from '../services/supabase';
import { API } from '../constants';
import { useOneCardLeftAlert } from '../hooks/useOneCardLeftAlert';
import { useOrientationManager } from '../hooks/useOrientationManager';
import { usePlayerDisplayData } from '../hooks/usePlayerDisplayData';
import { usePlayerTotalScores } from '../hooks/usePlayerTotalScores';
import { useRealtime } from '../hooks/useRealtime';
import { RootStackParamList } from '../navigation/AppNavigator';
import { showError } from '../utils';
import { gameLogger } from '../utils/logger';
import { parseMultiplayerHands } from '../utils/parseMultiplayerHands';
import type { Card } from '../game/types';
import type { GameStateManager } from '../game/state';
import type { FinalScore } from '../types/gameEnd';
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
  const { openGameEndModal } = useGameEnd();
  const { roomCode } = route.params;
  const [showSettings, setShowSettings] = useState(false);

  // State for multiplayer room data
  const [multiplayerPlayers, setMultiplayerPlayers] = useState<MultiplayerPlayer[]>([]);
  // Room UUID and game start time — used for online stats saving
  const [roomId, setRoomId] = useState<string | null>(null);
  const gameStartedAtRef = useRef<number>(Date.now());
  // Ref to check host status inside onGameOver closure (isMultiplayerHost is returned after useRealtime)
  const isMultiplayerHostRef = useRef<boolean>(false);

  // Orientation manager (Task #450)
  const { currentOrientation, toggleOrientation, isAvailable: orientationAvailable } = useOrientationManager();

  const currentPlayerName = profile?.username || user?.email?.split('@')[0] || 'Player';

  useEffect(() => {
    gameLogger.info('🎮 [MultiplayerGame] Game mode: MULTIPLAYER (server-side)');
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

  // Initialize multiplayer room data
  useMultiplayerRoomLoader({ isMultiplayerGame: true, roomCode, navigation, setMultiplayerPlayers, setRoomId });

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
      if (msg.includes('connection') || msg.includes('reconnect') || msg.includes('not your turn')) {
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
    onMatchEnded: (matchNumber, matchScores) => {
      gameLogger.info(`[MultiplayerGame] 🏆 Match ${matchNumber} ended! Adding scores to scoreboard...`, matchScores);

      const pointsAdded: number[] = [];
      const cumulativeScores: number[] = [];
      const sortedScores = [...matchScores].sort((a, b) => a.player_index - b.player_index);

      sortedScores.forEach((score) => {
        pointsAdded.push(score.matchScore);
        cumulativeScores.push(score.cumulativeScore);
      });

      const scoreHistoryEntry: ScoreHistory = {
        matchNumber,
        pointsAdded,
        scores: cumulativeScores,
        timestamp: new Date().toISOString(),
      };

      gameLogger.info('[MultiplayerGame] 📊 Adding score history entry:', scoreHistoryEntry);
      addScoreHistory(scoreHistoryEntry);
    },
    onGameOver: (winnerIndex, finalScores) => {
      gameLogger.info(`[MultiplayerGame] 🎉 Game Over! Winner: Player ${winnerIndex}, scores:`, finalScores);

      let winnerIdx: number;
      if (winnerIndex !== null && winnerIndex !== undefined) {
        winnerIdx = winnerIndex;
      } else if (finalScores.length > 0) {
        const minScore = Math.min(...finalScores.map((s) => s.cumulativeScore));
        const derivedWinner = finalScores.find((s) => s.cumulativeScore === minScore);
        winnerIdx = derivedWinner !== undefined ? derivedWinner.player_index : 0;
      } else {
        winnerIdx = 0;
      }
      const winnerPlayer = multiplayerPlayers.find((p) => p.player_index === winnerIdx);
      const formattedScores: FinalScore[] = [...finalScores]
        .sort((a, b) => a.cumulativeScore - b.cumulativeScore)
        .map((s, index) => ({
          player_index: s.player_index,
          player_name:
            multiplayerPlayers.find((p) => p.player_index === s.player_index)?.username ||
            `Player ${s.player_index + 1}`,
          cumulative_score: s.cumulativeScore,
          points_added: s.matchScore,
          rank: index + 1,
          is_busted: s.cumulativeScore >= 101,
        }));
      const playerNames = [...multiplayerPlayers]
        .sort((a, b) => a.player_index - b.player_index)
        .map((p) => p.username);

      openGameEndModal(
        winnerPlayer?.username || `Player ${winnerIdx + 1}`,
        winnerIdx,
        formattedScores,
        playerNames,
        scoreHistory || [],
        playHistoryByMatch || [],
      );

      // Save stats for online multiplayer (fire-and-forget, does not block UI)
      const nowTs = Date.now();
      void (async () => {
        try {
          // Only the host persists stats — every client receives the game_over broadcast
          if (!isMultiplayerHostRef.current) return;

          const { data: { session } } = await supabase.auth.getSession();
          if (!session?.access_token) return;

          // Only send human players — bots do not have real Supabase user accounts
          const humanPlayers = multiplayerPlayers.filter(p => !p.is_bot);
          if (humanPlayers.length === 0) return;

          // Compute rankings relative to human players only so positions are gapless (1..N)
          // Sorting all finalScores (which includes bots) would create gaps when bots are excluded
          const humanScoresSorted = humanPlayers
            .map(player => {
              const score = finalScores.find(s => s.player_index === player.player_index);
              return { player_index: player.player_index, score: score?.cumulativeScore ?? 0 };
            })
            .sort((a, b) => a.score - b.score);

          const rankByPlayerIndex = new Map<number, number>();
          humanScoresSorted.forEach((entry, idx) => {
            rankByPlayerIndex.set(entry.player_index, idx + 1);
          });

          const playersData = humanPlayers.map(player => {
            const score = finalScores.find(s => s.player_index === player.player_index);
            const rank = rankByPlayerIndex.get(player.player_index) ?? 1;
            return {
              user_id: player.user_id,
              username: player.username,
              score: score?.cumulativeScore ?? 0,
              finish_position: rank,
              // Combo tracking for online games is not yet implemented; send zeros
              combos_played: { singles: 0, pairs: 0, triples: 0, straights: 0, flushes: 0, full_houses: 0, four_of_a_kinds: 0, straight_flushes: 0, royal_flushes: 0 },
            };
          });

          // Winner is the human player with rank 1 (lowest cumulative score among humans)
          const topHumanEntry = humanScoresSorted[0];
          const winnerHuman = topHumanEntry
            ? humanPlayers.find(p => p.player_index === topHumanEntry.player_index)
            : undefined;
          const winnerId = winnerHuman?.user_id ?? (user?.id ?? '');

          const response = await fetch(
            `${API.SUPABASE_URL}/functions/v1/complete-game`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${session.access_token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                room_id: roomId,
                room_code: roomCode,
                players: playersData,
                winner_id: winnerId,
                game_duration_seconds: Math.floor((nowTs - gameStartedAtRef.current) / 1000),
                started_at: new Date(gameStartedAtRef.current).toISOString(),
                finished_at: new Date(nowTs).toISOString(),
              }),
            }
          );

          if (response.ok) {
            gameLogger.info('[MultiplayerGame] ✅ Online game stats saved successfully');
          } else {
            const errBody = await response.json().catch(() => ({}));
            gameLogger.warn('[MultiplayerGame] ⚠️ Stats save failed:', errBody);
          }
        } catch (statsErr) {
          // Non-blocking — game still ends even if stats fail to save
          gameLogger.warn('[MultiplayerGame] ⚠️ Failed to save online game stats:', statsErr instanceof Error ? statsErr.message : String(statsErr));
        }
      })();
    },
  });

  // Keep isMultiplayerHostRef in sync so the onGameOver callback can check it without a closure issue
  isMultiplayerHostRef.current = isMultiplayerHost;

  // Ensure multiplayer realtime channel is joined when entering the Game screen
  useEffect(() => {
    if (!user?.id) return;

    multiplayerConnectToRoom(roomCode).catch((error: Error) => {
      console.error('[MultiplayerGame] ❌ Failed to connect:', error);
      gameLogger.error('[MultiplayerGame] Failed to connect:', error?.message || String(error));
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

  // DIAGNOSTIC: Track coordinator status
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
  }, [isMultiplayerDataReady, isMultiplayerHost, realtimePlayers, multiplayerGameState, playersWithCards]);

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
    isLocalAIGame: false,
    gameManagerRef: emptyGameManagerRef,
    multiplayerPlayCards,
    multiplayerPass,
    setSelectedCardIds,
    navigation,
    isMountedRef,
  });

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
    <GameView
      isLocalAIGame={false}
      currentOrientation={currentOrientation}
      toggleOrientation={toggleOrientation}
      isInitializing={false}
      isConnected={isConnected}
      showSettings={showSettings}
      setShowSettings={setShowSettings}
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
  );
}
