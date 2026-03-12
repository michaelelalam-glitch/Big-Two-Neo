/**
 * MultiplayerGame - Full component for Multiplayer (server-side) game mode.
 * Contains all multiplayer-only hooks (realtime, bot coordinator, match end handler, etc.)
 * plus shared hooks (card selection, orientation, audio, etc.), then renders GameView.
 * Created as part of Task #570: Split GameScreen component.
 */
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRoute, RouteProp, useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { useAuth } from '../contexts/AuthContext';
import { useGameEnd } from '../contexts/GameEndContext';
import { useScoreboard } from '../contexts/ScoreboardContext';
import { useConnectionManager } from '../hooks/useConnectionManager';
import { useServerBotCoordinator } from '../hooks/useServerBotCoordinator';
import { useTurnInactivityTimer } from '../hooks/useTurnInactivityTimer';
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
import { RootStackParamList } from '../navigation/AppNavigator';
import { supabase } from '../services/supabase';
import { showError } from '../utils';
import { gameLogger } from '../utils/logger';
import { parseMultiplayerHands } from '../utils/parseMultiplayerHands';
import type { Card } from '../game/types';
import type { GameStateManager } from '../game/state';
// FinalScore import removed — onGameOver callback replaced by useMatchEndHandler (DB-authoritative path)
import type { GameState as MultiplayerGameState, Player as MultiplayerPlayer } from '../types/multiplayer';
import type { ScoreHistory } from '../types/scoreboard';
import { RejoinModal } from '../components/game/RejoinModal';
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

  // State for bot replacement dialog
  const [showBotReplacedModal, setShowBotReplacedModal] = useState(false);
  const [botReplacedUsername, setBotReplacedUsername] = useState<string | null>(null);

  // State for multiplayer room data
  const [multiplayerPlayers, setMultiplayerPlayers] = useState<MultiplayerPlayer[]>([]);
  const [roomInfo, setRoomInfo] = useState<RoomInfo | null>(null);
  // Track when game transitions to 'playing' to calculate duration
  const [gameStartedAt, setGameStartedAt] = useState<string | null>(null);

  // Orientation manager (Task #450)
  const { currentOrientation, toggleOrientation, isAvailable: orientationAvailable } = useOrientationManager();

  const currentPlayerName = profile?.username || user?.email?.split('@')[0] || 'Player';

  // Log game mode ONCE (not on every render)
  useEffect(() => {
    gameLogger.info('🎮 [MultiplayerGame] Game mode: MULTIPLAYER (server-side)');
  }, []);

  // ─── Register Play Again / Return to Menu callbacks ──────────────────────
  useEffect(() => {
    setOnPlayAgain(() => () => {
      gameLogger.info('🔄 [MultiplayerGame] Play Again → navigating to Lobby with same room');
      // Navigate to Lobby so the player can re-queue / rejoin the same room.
      // index: 1 makes Lobby the active screen; Home is kept in the back-stack
      // so the user can still navigate home from the lobby.
      navigation.reset({
        index: 1,
        routes: [{ name: 'Home' }, { name: 'Lobby', params: { roomCode, playAgain: true } }],
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
    isAutoPassInProgress,
    playerLastSeenAtRef,
    refreshGameState,
  } = useRealtime({
    userId: user?.id || '',
    username: currentPlayerName,
    onError: (error) => {
      gameLogger.error('[MultiplayerGame] Multiplayer error:', error.message);
      const msg = error.message?.toLowerCase() || '';
      if (msg.includes('not your turn')) {
        // Stale Realtime state caused the client to think it was our turn, but the
        // server disagrees. Re-fetch authoritative game state so the UI immediately
        // reflects the correct current_turn and the Play button reverts.
        gameLogger.warn('⚠️ [MultiplayerGame] "Not your turn" — refreshing game state to re-sync UI');
        void refreshGameState().catch((refreshError) => {
          gameLogger.error(
            '[MultiplayerGame] Failed to refresh game state after "Not your turn" error:',
            refreshError,
          );
        });
        return;
      }
      if (msg.includes('connection') || msg.includes('reconnect')) {
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

  // ─── HEARTBEAT / CONNECTION MANAGER ──────────────────────────────────────
  // Keeps this player's connection_status = 'connected' via periodic heartbeats.
  // Without this, the server-side cron marks the player as 'disconnected' after
  // 30 s of silence, causing all avatars to show the disconnect spinner.
  const myRoomPlayerId = useMemo(() => {
    const me =
      multiplayerPlayers.find(p => p.user_id === user?.id) ??
      multiplayerPlayers.find(p => p.human_user_id === user?.id);
    return me?.id ?? null;
  }, [multiplayerPlayers, user?.id]);

  const { reconnect: connectionReconnect, isReconnecting, rejoinStatus, forceSweep } = useConnectionManager({
    roomId: roomInfo?.id ?? '',
    playerId: myRoomPlayerId ?? '',
    enabled: !!roomInfo?.id && !!myRoomPlayerId,
    onBotReplaced: () => {
      gameLogger.warn('[MultiplayerGame] Player was replaced by a bot — showing rejoin dialog');
      setShowBotReplacedModal(true);
    },
    onRoomClosed: () => {
      gameLogger.warn('[MultiplayerGame] Room was closed while away');
      navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
    },
  });

  // Update bot username from rejoin status payload when available
  useEffect(() => {
    if (rejoinStatus?.status === 'replaced_by_bot' && rejoinStatus.bot_username) {
      setBotReplacedUsername(rejoinStatus.bot_username);
    }
  }, [rejoinStatus]);

  // ── Bot Replacement Modal Handlers ──────────────────────────────────────
  const handleReclaimSeat = useCallback(async () => {
    gameLogger.info('[MultiplayerGame] Reclaiming seat from bot...');
    try {
      await connectionReconnect();
      setShowBotReplacedModal(false);
      setBotReplacedUsername(null);
      gameLogger.info('[MultiplayerGame] Seat reclaimed successfully');
    } catch (err) {
      gameLogger.error('[MultiplayerGame] Failed to reclaim seat from bot:', err instanceof Error ? err.message : String(err));
      // Keep modal open — user can retry or leave
    }
  }, [connectionReconnect]);

  const handleLeaveRoomFromModal = useCallback(() => {
    // Intentionally do NOT delete the replaced_by_bot row here.
    // We navigate to Home and let the HomeScreen banner show
    // "Replace Bot & Rejoin" + "Leave" — the permanent row deletion
    // and voluntarily-left suppression happen only when the player
    // explicitly presses "Leave" on that HomeScreen banner.
    gameLogger.info('[MultiplayerGame] Leaving room after bot replacement — keeping replaced_by_bot row for HomeScreen banner');
    setShowBotReplacedModal(false);
    navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
  }, [navigation]);
  // ─────────────────────────────────────────────────────────────────────────────

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
    isAutoPassInProgress,
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
  // CRITICAL FIX: Use live realtimePlayers (kept up-to-date by Supabase realtime
  // subscription) so that connection_status, disconnect_timer_started_at, and
  // username changes (e.g. bot replacement) are reflected immediately.
  // Fall back to the initial one-time load while the realtime channel is joining.
  const effectiveMultiplayerPlayers = realtimePlayers.length > 0 ? realtimePlayers : multiplayerPlayers;

  const {
    multiplayerPlayerHand,
    multiplayerLastPlay,
    multiplayerLastPlayedCards,
    multiplayerLastPlayedBy,
    multiplayerLastPlayComboType,
    multiplayerLastPlayCombo,
    multiplayerLayoutPlayers,
  } = useMultiplayerLayout({
    multiplayerPlayers: effectiveMultiplayerPlayers,
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
    roomId: roomInfo?.id,
  });

  // Audio/haptic feedback
  useGameAudio({
    isLocalAIGame: false,
    isMultiplayerGame: true,
    gameState: null,
    multiplayerGameState,
  });

  // Client-side pre-validation state supplier for Task #573
  const getMultiplayerValidationState = React.useCallback(() => {
    if (!multiplayerGameState) return null;
    return {
      lastPlay: multiplayerLastPlay ?? null,
      isFirstPlayOfGame: multiplayerGameState.game_phase === 'first_play',
      playerHand: effectivePlayerHand,
    };
  }, [multiplayerGameState, multiplayerLastPlay, effectivePlayerHand]);

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
    getMultiplayerValidationState,
  });

  // ── TURN INACTIVITY TIMER ────────────────────────────────────────────────
  // Monitors turn_started_at when it's the local player's turn.
  // Shows yellow InactivityCountdownRing (60s to play/pass).
  // Separate from the charcoal-grey disconnect ring (connection inactivity).
  // When expired: auto-plays highest valid cards OR passes.
  const { isMyTurn: isTurnInactivityMyTurn } = useTurnInactivityTimer({
    gameState: multiplayerGameState,
    room: roomInfo,
    roomPlayers: effectiveMultiplayerPlayers,
    // broadcastMessage omitted — turn_auto_played is supplementary; auto-play is confirmed
    // by the server-authoritative game_state update. Wire to useRealtime.broadcastMessage
    // (once added to UseRealtimeReturn) when turn_auto_played needs to reach other clients.
    getCorrectedNow: () => Date.now(), // Use clock-sync if available
    currentUserId: user?.id,
    onAutoPlay: (cards, action) => {
      // Auto-play always triggers bot replacement (65s spec).
      // The server will broadcast replaced_by_bot via Realtime; RejoinModal handles
      // the reclaim flow. No "I'm Still Here?" modal needed.
      gameLogger.info('[MultiplayerGame] Turn auto-played:', action, cards?.length ?? 0, 'cards — bot replacement in progress');
    },
  });
  // ─────────────────────────────────────────────────────────────────────────────

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

  // ── Client-side disconnect staleness detector ─────────────────────────────
  // The server marks players as 'disconnected' via process_disconnected_players()
  // (pg_cron + heartbeat piggyback), but Realtime delivery of that change can be
  // unreliable. As a fallback, we detect stale last_seen_at timestamps directly:
  // if a player's heartbeat hasn't updated for >30s they are treated as disconnected.
  // playerLastSeenAtRef is updated on every Realtime UPDATE event (even heartbeat-only
  // skipped ones), giving us the freshest timestamp without causing re-renders.
  const [clientDisconnections, setClientDisconnections] = useState<Map<number, string>>(new Map());
  const clientDisconnectStartRef = useRef<Record<number, string>>({});
  // Holds the ID of the 5s belt-and-suspenders forceSweep retry so it can be
  // cancelled if the component unmounts before the timeout fires.
  const sweepRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable ref so the disconnect-staleness interval callback can read the latest
  // game state (current_turn / turn_started_at) without being re-created on every
  // game state change. Used to seed the disconnect timer anchor at turn_started_at
  // when a player disconnects during their active turn, so the charcoal-grey ring
  // picks up exactly where the yellow turn ring left off.
  const multiplayerGameStateRef = useRef(multiplayerGameState);
  useEffect(() => { multiplayerGameStateRef.current = multiplayerGameState; }, [multiplayerGameState]);

  // TURN RING CONTINUITY (#628): persist the last-known turn_started_at so the
  // yellow ring anchor is never lost during brief null-gameState windows
  // (e.g. when player_reconnected broadcast triggers a fetchGameState re-fetch
  // and, on error, setGameState(null) fires before the retry succeeds).
  // Without this, turnTimerStartedAt → null → ring unmounts → remounts with a
  // potentially clock-skewed startedAt that startTimeMs normalises to 'now',
  // making the ring appear to restart from 60 s.
  const lastTurnStartedAtRef = useRef<string | null>(null);
  // RING REJOIN FIX (#629): persist whether the local player (idx 0) had the
  // active turn when gameState was last non-null. When gameState temporarily
  // becomes null (reconnect re-fetch, fetch error), isActive falls to false
  // because current_turn is unknown. Without this ref, isEffectivelyActive
  // becomes false → suppressDisconnectRing deactivates → turnTimerStartedAt
  // returns null → the yellow ring disappears until gameState reloads.
  // Only updated when gameState is authoritative (non-null); null windows
  // leave the ref at its last known value so the ring persists.
  const localPlayerWasActiveRef = useRef<boolean>(false);
  useEffect(() => {
    if (multiplayerGameState?.turn_started_at) {
      lastTurnStartedAtRef.current = multiplayerGameState.turn_started_at;
    }
    // Only update the was-active flag when gameState is non-null (authoritative).
    // When gameState is null (transient loading window), preserve the last known
    // value so the yellow ring anchor remains continuous through the null window.
    if (multiplayerGameState !== null) {
      const currentTurn = multiplayerGameState.current_turn;
      const localIdx = layoutPlayers[0]?.player_index;
      localPlayerWasActiveRef.current =
        typeof currentTurn === 'number' && currentTurn === localIdx;
    }
  }, [multiplayerGameState?.turn_started_at, multiplayerGameState?.current_turn, layoutPlayers[0]?.player_index]);

  useEffect(() => {
    const STALE_THRESHOLD_MS = 30_000; // 30s: matches server Phase A threshold — one source of truth
    const interval = setInterval(() => {
      if (!realtimePlayers || realtimePlayers.length === 0) return;

      const now = Date.now();
      const newMap = new Map<number, string>();

      for (const rp of realtimePlayers) {
        // Skip bots and the local player (they can't disconnect from our perspective)
        if (rp.is_bot || typeof rp.player_index !== 'number') continue;
        if (rp.user_id === user?.id) continue;

        // Bot replaced — clear any client-side detection and skip
        if (rp.connection_status === 'replaced_by_bot') {
          delete clientDisconnectStartRef.current[rp.player_index];
          continue;
        }

        // Server-confirmed disconnect: anchor the ring to the best available timestamp.
        // CRITICAL: Do NOT fall through to the stale-heartbeat check for disconnected
        // players — their last_seen_at is stale by design and would always trigger.
        //
        // Anchor selection priority (in order):
        //   1. turn_started_at (turn carry-over) — ensures charcoal ring picks up where
        //      the yellow ring left off, no visual jump.
        //   2. rp.disconnect_timer_started_at (server timer anchor) — used when there is
        //      NO existing client anchor yet, so the ring is precisely synced to the
        //      server's 60-second window. InactivityCountdownRing normalises future
        //      timestamps to 'now', so a slightly-ahead server clock is safe.
        //   3. new Date().toISOString() — fallback when neither above is available.
        //
        // We NEVER overwrite an existing client anchor with a LATER server timestamp
        // (would visually replenish the ring to full). We DO correct the anchor when the
        // server provides an EARLIER timestamp — this fixes a bug where the client fell
        // back to 'now' (STALE_THRESHOLD_MS = 30s after the last heartbeat) before Phase A
        // ran and set disconnect_timer_started_at = last_seen_at (which is earlier by ~18s).
        // Without this correction the ring depletes to empty ~12-18s before the server
        // fires bot replacement, causing it to visually disappear with arc still showing.
        if (rp.connection_status === 'disconnected') {
          // ── Heartbeat freshness override ────────────────────────────────────
          // The Realtime postgres_changes event that flips connection_status to
          // 'connected' may arrive AFTER the next heartbeat update has already
          // refreshed playerLastSeenAtRef. If the heartbeat ref shows a fresh
          // timestamp, the player has reconnected — clear the grey ring instead
          // of perpetuating it from stale Realtime data.
          const hbIso = playerLastSeenAtRef.current[rp.id] || rp.last_seen_at;
          if (hbIso) {
            const hbStaleMs = now - new Date(hbIso).getTime();
            if (hbStaleMs < STALE_THRESHOLD_MS) {
              // Heartbeat is fresh — player reconnected but realtimePlayers
              // state update hasn't been processed yet.
              if (clientDisconnectStartRef.current[rp.player_index] !== undefined) {
                delete clientDisconnectStartRef.current[rp.player_index];
                gameLogger.info(
                  `[MultiplayerGame] Heartbeat override: player_index=${rp.player_index} heartbeat fresh (${Math.round(hbStaleMs / 1000)}s) but connection_status=disconnected — clearing grey ring`,
                );
              }
              continue; // Don't add to newMap — player is live
            }
          }

          const existingAnchor = clientDisconnectStartRef.current[rp.player_index];
          const serverAnchorMs = rp.disconnect_timer_started_at
            ? new Date(rp.disconnect_timer_started_at).getTime()
            : null;
          const existingAnchorMs = existingAnchor ? new Date(existingAnchor).getTime() : null;
          // Seed if not set yet; or correct downward if server anchor is strictly earlier
          const needsUpdate =
            !existingAnchor ||
            (serverAnchorMs !== null && existingAnchorMs !== null && serverAnchorMs < existingAnchorMs);
          if (needsUpdate) {
            const gs = multiplayerGameStateRef.current;
            const isTheirTurn = gs?.current_turn === rp.player_index;
            let anchor: string;
            let anchorType: string;
            if (isTheirTurn && gs?.turn_started_at) {
              // Turn carry-over: continue countdown from where the yellow ring was
              anchor = gs.turn_started_at;
              anchorType = 'turn_started_at';
            } else if (rp.disconnect_timer_started_at) {
              anchor = rp.disconnect_timer_started_at;
              anchorType = 'server_timer_ts';
            } else {
              // Use the player's actual last heartbeat time from the DB row as anchor.
              // This matches the anchor Phase A will set (disconnect_timer_started_at = last_seen_at),
              // so when Phase A's Realtime event arrives there is no correction needed and the
              // ring depletes smoothly without a visual jump.
              if (rp.last_seen_at) {
                anchor = rp.last_seen_at;
                anchorType = 'last_seen_at';
              } else {
                anchor = new Date().toISOString();
                anchorType = 'now';
              }
            }
            clientDisconnectStartRef.current[rp.player_index] = anchor;
            gameLogger.warn(
              `[MultiplayerGame] Client-side: ${existingAnchor ? 'CORRECTED' : 'seeding'} disconnect for player_index=${rp.player_index} (anchor=${anchorType}${existingAnchorMs !== null && serverAnchorMs !== null ? `, correction=${Math.round((existingAnchorMs - serverAnchorMs) / 1000)}s` : ''})`,
            );
          }
          newMap.set(rp.player_index, clientDisconnectStartRef.current[rp.player_index]);
          continue;
        }

        // Player is 'connected' — check for stale heartbeat
        // SHORT-CIRCUIT: if the server's room_players row confirms the player is
        // connected AND the disconnect timer has been cleared, they have definitively
        // reconnected.  Do NOT let a presence-leave-backdated last_seen_at override
        // this authoritative server state by re-seeding the grey ring.
        if (rp.connection_status === 'connected' && !rp.disconnect_timer_started_at) {
          if (clientDisconnectStartRef.current[rp.player_index] !== undefined) {
            delete clientDisconnectStartRef.current[rp.player_index];
            gameLogger.info(
              `[MultiplayerGame] Stale-check shortcircuit: player_index=${rp.player_index} server-confirmed connected, clearing grey ring`,
            );
          }
          // Do NOT add to newMap — player is live, no ring needed.
          continue;
        }

        // Use freshest last_seen_at: prefer ref (updated each heartbeat ping),
        // fall back to the value from the last meaningful state update.
        const lastSeenIso = playerLastSeenAtRef.current[rp.id] || rp.last_seen_at;
        if (!lastSeenIso) continue;

        const staleMs = now - new Date(lastSeenIso).getTime();
        if (staleMs > STALE_THRESHOLD_MS) {
          // Disconnect detected via stale heartbeat. If it's this player's turn, use
          // turn_started_at as the anchor so the charcoal grey ring continues the
          // turn countdown rather than restarting from 60s.
          // If disconnect_timer_started_at is already set on the row (server may have
          // fired the Realtime update before we detected staleness), prefer it over
          // client-local now — same anchor-selection logic as the server-confirmed path.
          if (!clientDisconnectStartRef.current[rp.player_index]) {
            const gs = multiplayerGameStateRef.current;
            const isTheirTurn = gs?.current_turn === rp.player_index;
            let anchor: string;
            let anchorType: string;
            if (isTheirTurn && gs?.turn_started_at) {
              anchor = gs.turn_started_at;
              anchorType = 'turn_started_at';
            } else if (rp.disconnect_timer_started_at) {
              anchor = rp.disconnect_timer_started_at;
              anchorType = 'server_timer_ts';
            } else {
              // Use the player's actual last heartbeat time from the DB row as anchor.
              // This matches Phase A's anchor (disconnect_timer_started_at = last_seen_at),
              // preventing a later anchor-correction jump in the grey ring.
              // Do NOT use playerLastSeenAtRef here — it may be backdated by Presence
              // events (artificially early timestamp would cause the ring to expire immediately).
              if (rp.last_seen_at) {
                anchor = rp.last_seen_at;
                anchorType = 'last_seen_at';
              } else {
                // Fallback: no DB heartbeat timestamp available; use client "now".
                anchor = new Date().toISOString();
                anchorType = 'client_now';
              }
            }
            clientDisconnectStartRef.current[rp.player_index] = anchor;
            gameLogger.warn(`[MultiplayerGame] Client-side: player_index=${rp.player_index} detected as disconnected (stale ${Math.round(staleMs / 1000)}s, anchor=${anchorType})`);
          }
          newMap.set(rp.player_index, clientDisconnectStartRef.current[rp.player_index]);
        } else {
          // Player is live — heartbeat is fresh, clear any client-side detection.
          // The heartbeat UPDATE on the server now always clears disconnect_timer_started_at,
          // so there is no 'heartbeat-race' case where connection_status='connected' but
          // the timer is still set. A live heartbeat means fully reconnected.
          if (clientDisconnectStartRef.current[rp.player_index]) {
            gameLogger.info(`[MultiplayerGame] Client-side: player_index=${rp.player_index} reconnected`);
            delete clientDisconnectStartRef.current[rp.player_index];
          }
        }
      }

      // Only update if the map contents actually changed to avoid re-rendering
      // the entire Game screen every second when nothing has changed.
      setClientDisconnections(prev => {
        if (prev.size === newMap.size &&
            [...newMap.entries()].every(([k, v]) => prev.get(k) === v)) {
          return prev;
        }
        return newMap;
      });
    }, 1_000); // Poll every 1s — presence-leave backdate still triggers within one cycle

    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realtimePlayers, user?.id]);

  // Cancel the 5s sweep-retry timeout if the screen unmounts before it fires.
  useEffect(() => {
    return () => {
      if (sweepRetryTimeoutRef.current !== null) {
        clearTimeout(sweepRetryTimeoutRef.current);
      }
    };
  }, []);

  // ── Immediate reconnect clear ──────────────────────────────────────────────
  // The 1s polling interval that normally clears clientDisconnections can be
  // starved in a 4-player game: heartbeats arrive every ~1.25 s (5 s / 4 players),
  // continuously restarting the setInterval before it fires. This means a stale
  // grey-ring anchor can persist indefinitely after a player reconnects, blocking
  // the yellow turn ring from appearing for observers.
  //
  // Fix: react directly to realtimePlayers changes. Whenever a player transitions
  // to connection_status='connected' with disconnect_timer_started_at=null (server
  // has confirmed they are fully reconnected), immediately wipe their entry from
  // clientDisconnectStartRef and update the clientDisconnections state. This fires
  // synchronously in the same React render batch as the realtimePlayers update,
  // so the yellow ring appears on the next paint — no interval delay needed.
  useEffect(() => {
    if (!realtimePlayers || realtimePlayers.length === 0) return;

    let changed = false;
    for (const rp of realtimePlayers) {
      if (rp.is_bot || typeof rp.player_index !== 'number') continue;
      if (rp.user_id === user?.id) continue;
      // Server confirmed reconnect: connected + no timer
      if (
        rp.connection_status === 'connected' &&
        !rp.disconnect_timer_started_at &&
        clientDisconnectStartRef.current[rp.player_index] !== undefined
      ) {
        delete clientDisconnectStartRef.current[rp.player_index];
        changed = true;
        gameLogger.info(
          `[MultiplayerGame] Immediate clear: player_index=${rp.player_index} confirmed reconnected by server`,
        );
      }
    }

    if (changed) {
      setClientDisconnections(prev => {
        const newMap = new Map(prev);
        for (const rp of realtimePlayers) {
          if (typeof rp.player_index === 'number' &&
              clientDisconnectStartRef.current[rp.player_index] === undefined) {
            newMap.delete(rp.player_index);
          }
        }
        return newMap;
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realtimePlayers, user?.id]);
  // ─────────────────────────────────────────────────────────────────────────────

  // ── Countdown Expiry Handlers ──────────────────────────────────────────
  // CONNECTION countdown expired: show RejoinModal (bot replaced player)
  const handleLocalPlayerCountdownExpired = useCallback(() => {
    gameLogger.warn('[MultiplayerGame] Local player connection countdown expired — showing rejoin modal');
    setShowBotReplacedModal(true);
  }, []);

  // Another player's disconnect countdown expired — trigger immediate bot replacement
  // instead of waiting up to 30 s for the next heartbeat-piggyback sweep.
  const handleOtherPlayerDisconnectExpired = useCallback(() => {
    gameLogger.warn('[MultiplayerGame] Remote player disconnect countdown expired — forcing sweep');
    forceSweep();
    // Phase B now uses <= (not <) so the first sweep at exactly T=60s is sufficient;
    // the 1s retry is no longer needed.
    // Belt-and-suspenders: retry at 5s covers server-clock-skew edge cases where the
    // first sweep fires slightly before the 60s threshold is reached server-side.
    // process_disconnected_players() is idempotent — multiple calls are safe.
    // Store the timeout ID so it can be cancelled if the screen unmounts first.
    if (sweepRetryTimeoutRef.current !== null) clearTimeout(sweepRetryTimeoutRef.current);
    sweepRetryTimeoutRef.current = setTimeout(() => {
      sweepRetryTimeoutRef.current = null;
      forceSweep();
    }, 5_000);
  }, [forceSweep]);

  // Enrich layoutPlayersWithScores with countdown data for both turn and connection timers
  const enrichedLayoutPlayers = useMemo(() => {
    // Get turn timer started_at from game_state (shared state for ALL players).
    // Fall back to lastTurnStartedAtRef when gameState is briefly null (reconnect
    // fetch error) so the ring anchor persists and never triggers a restart.
    const turnStartedAt = multiplayerGameState?.turn_started_at ?? lastTurnStartedAtRef.current ?? null;

    // CRITICAL FIX: Pass turnTimerStartedAt to ALL players based on isActive (current turn)
    // Previously only passed to idx === 0 (local player), but the ring needs to be
    // visible to ALL players when it's ANYONE's turn (server-authoritative state)
    return layoutPlayersWithScores.map((player, idx) => {
      // Client-side disconnect override: use staleness detection when server hasn't
      // delivered the connection_status change yet via Realtime.
      const clientDisconnectTimerStartedAt = player.player_index !== undefined
        ? (clientDisconnections.get(player.player_index) ?? null)
        : null;
      const isClientDisconnected = clientDisconnectTimerStartedAt !== null;

      // REJOIN FIX (#624): When the local player (idx 0) is on their turn, they are
      // actively on the game screen. Always show the yellow turn ring, never the grey
      // disconnect ring. The grey ring anchor (disconnect_timer_started_at) can linger
      // on the DB row from the previous disconnect window even after reconnect, causing
      // the yellow ring to be hidden. The server's auto-play deadline is always
      // turn_started_at + 60s, so the yellow ring always uses turn_started_at.
      // NOTE: The RejoinModal is triggered via the Realtime 'replaced_by_bot' update
      // (not via ring onExpired), so bot-replacement UX is unaffected.
      //
      // RING REJOIN FIX (#629): Extend the active-turn guard to cover brief
      // null-gameState windows. When multiplayerGameState is transiently null
      // (fetchGameState re-fetch after reconnect), isActive falls to false because
      // current_turn is unknown. If we have a preserved turn anchor AND the previous
      // non-null gameState confirmed this was the local player's turn, we treat them
      // as still active so both suppressDisconnectRing and turnTimerStartedAt remain
      // set — preventing a visible ring disappearance during the loading window.
      // Also keep the ring alive when the local player is in the RejoinModal /
      // reclaiming-their-seat flow (showBotReplacedModal or isReconnecting=true).
      // During this window the bot may have played and advanced current_turn, so
      // player.isActive and localPlayerWasActiveRef can both be false.  Without this
      // guard suppressDisconnectRing deactivates → ring disappears → remounts fresh
      // at 100 % the moment the new turn state loads.
      const isInRejoinFlow = idx === 0 && (showBotReplacedModal || isReconnecting) && turnStartedAt !== null;
      const isEffectivelyActive =
        player.isActive ||
        (idx === 0 && !multiplayerGameState && localPlayerWasActiveRef.current && turnStartedAt !== null) ||
        isInRejoinFlow;

      const suppressDisconnectRing = idx === 0 && isEffectivelyActive;

      // Server-authoritative reconnect guard: if the server's room_players row says
      // this player is connected with no disconnect timer, they have definitively
      // reconnected. Discard any stale client-side detection so the grey ring clears
      // immediately. Without this, a timing window between the immediate-clear effect
      // above and the next enrichedLayoutPlayers re-evaluation could leave a stale
      // clientDisconnectTimerStartedAt blocking the yellow turn ring.
      const serverConfirmedConnected = !player.isDisconnected && !player.disconnectTimerStartedAt;

      // ── Client-alive guard for remote players ────────────────────────────
      // When the client-side staleness detector has cleared this player from
      // clientDisconnections (their heartbeat is fresh), AND it's their active
      // turn, suppress the grey ring to let the yellow turn ring through.
      // This handles the window where Realtime data is stale (postgres_changes
      // event delayed/lost on mobile) but the heartbeat ref already confirms
      // the player is alive. Without this, stale player.disconnectTimerStartedAt
      // from layoutPlayersWithScores keeps the grey ring visible because
      // serverConfirmedConnected is false (it reads the same stale data).
      // Safety: if the player IS disconnecting, the staleness detector will
      // re-add them to clientDisconnections within 30s → guard deactivates.
      const clientClearedDuringTurn = idx > 0 && player.isActive && !isClientDisconnected;

      return {
        ...player,
        // Show turn ring on WHOEVER's turn it is (all players see it).
        // Always anchor to turn_started_at — that's the server's auto-play deadline.
        turnTimerStartedAt: isEffectivelyActive ? turnStartedAt : null,
        // Merge client-side + server-side disconnect state.
        // Local player on their turn: suppress grey ring so yellow turn ring is visible.
        // Remote player on their turn + client says alive: suppress grey ring (stale Realtime guard).
        isDisconnected: (suppressDisconnectRing || serverConfirmedConnected || clientClearedDuringTurn)
          ? false
          : (isClientDisconnected || player.isDisconnected),
        disconnectTimerStartedAt: (suppressDisconnectRing || serverConfirmedConnected || clientClearedDuringTurn)
          ? null
          : (clientDisconnectTimerStartedAt || player.disconnectTimerStartedAt),
        // Connection countdown callback:
        //   idx 0 (local player) → show RejoinModal when their own timer hits 0
        //   idx > 0 (other players) → force process_disconnected_players immediately
        //     so bot replacement happens right when the ring hits 0, not up to 30s later
        onCountdownExpired: idx === 0 ? handleLocalPlayerCountdownExpired : handleOtherPlayerDisconnectExpired,
      };
    });
  }, [layoutPlayersWithScores, handleLocalPlayerCountdownExpired, handleOtherPlayerDisconnectExpired, multiplayerGameState?.turn_started_at, multiplayerGameState?.current_turn, clientDisconnections, showBotReplacedModal, isReconnecting]);

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
        layoutPlayersWithScores={enrichedLayoutPlayers}
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

      {/* Bot Replacement Modal — shown when the server replaces a disconnected
          or AFK player with a bot. Offers "Reclaim My Seat" or "Leave Room".
          Triggered by Realtime connection_status='replaced_by_bot' for both
          disconnected players and connected-but-AFK players (65s spec). */}
      <RejoinModal
        visible={showBotReplacedModal}
        botUsername={botReplacedUsername}
        onReclaim={handleReclaimSeat}
        onLeaveRoom={handleLeaveRoomFromModal}
      />
    </>
  );
}
