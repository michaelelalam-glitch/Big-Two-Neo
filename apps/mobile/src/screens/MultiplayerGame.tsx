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
import { TurnAutoPlayModal } from '../components/game/TurnAutoPlayModal';
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

  // State for turn auto-play dialog
  const [showTurnAutoPlayModal, setShowTurnAutoPlayModal] = useState(false);
  const [autoPlayedCards, setAutoPlayedCards] = useState<Card[] | null>(null);
  const [autoPlayAction, setAutoPlayAction] = useState<'play' | 'pass'>('pass');

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
    isAutoPassInProgress,
    playerLastSeenAtRef,
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

  const { reconnect: connectionReconnect, rejoinStatus } = useConnectionManager({
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

  const handleLeaveRoomFromModal = useCallback(async () => {
    gameLogger.info('[MultiplayerGame] Leaving room after bot replacement');
    setShowBotReplacedModal(false);
    if (user?.id) {
      // Use SECURITY DEFINER RPC to bypass RLS — replaced rows have
      // user_id = NULL so a client-side DELETE would be silently blocked.
      const { error: rpcErr } = await supabase.rpc('delete_room_players_by_human_user_id', {
        human_user_id: user.id,
      });
      if (rpcErr) {
        gameLogger.error('[MultiplayerGame] Failed to delete room_player on leave:', rpcErr);
      }
    }
    navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
  }, [user?.id, navigation]);
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
  useTurnInactivityTimer({
    gameState: multiplayerGameState,
    room: roomInfo,
    roomPlayers: effectiveMultiplayerPlayers,
    broadcastMessage: async (event, data) => {
      // Re-use the broadcast pattern from useRealtime if needed
      gameLogger.info('[MultiplayerGame] Broadcasting turn event:', event, data);
    },
    getCorrectedNow: () => Date.now(), // Use clock-sync if available
    currentUserId: user?.id,
    onAutoPlay: (cards, action) => {
      gameLogger.info('[MultiplayerGame] Turn auto-played:', action, cards);
      setAutoPlayedCards(cards);
      setAutoPlayAction(action);
      setShowTurnAutoPlayModal(true);
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
  // if a player's heartbeat hasn't updated for >12s they are treated as disconnected.
  // playerLastSeenAtRef is updated on every Realtime UPDATE event (even heartbeat-only
  // skipped ones), giving us the freshest timestamp without causing re-renders.
  const [clientDisconnections, setClientDisconnections] = useState<Map<number, string>>(new Map());
  const clientDisconnectStartRef = useRef<Record<number, string>>({});

  // Stable ref so the disconnect-staleness interval callback can read the latest
  // game state (current_turn / turn_started_at) without being re-created on every
  // game state change. Used to seed the disconnect timer anchor at turn_started_at
  // when a player disconnects during their active turn, so the charcoal-grey ring
  // picks up exactly where the yellow turn ring left off.
  const multiplayerGameStateRef = useRef(multiplayerGameState);
  useEffect(() => { multiplayerGameStateRef.current = multiplayerGameState; }, [multiplayerGameState]);

  useEffect(() => {
    const STALE_THRESHOLD_MS = 12_000; // 12s: fast detection, presence leave backdates to 60s
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

        // Server-confirmed disconnect: preserve the client-detected start timestamp
        // (seeding from client now if we don't have one yet).
        // CRITICAL: Do NOT fall through to the stale-heartbeat check for disconnected
        // players — their last_seen_at is stale by design and would always trigger.
        // More importantly, never switch to the raw server disconnect_timer_started_at
        // for the ring animation: that timestamp comes from the server clock and can be
        // seconds in the future relative to the client clock, causing the ring to
        // normalise to "now" and replenish to full at the moment the server event arrives.
        if (rp.connection_status === 'disconnected') {
          if (!clientDisconnectStartRef.current[rp.player_index]) {
            // Turn carry-over: if this player disconnected during their active turn, seed
            // the disconnect ring from turn_started_at so the charcoal grey ring picks up
            // exactly where the yellow turn ring left off (no jump back to full).
            // Otherwise fall back to client-local now (fresh 60s countdown).
            const gs = multiplayerGameStateRef.current;
            const isTheirTurn = gs?.current_turn === rp.player_index;
            const anchor = (isTheirTurn && gs?.turn_started_at) ? gs.turn_started_at : new Date().toISOString();
            clientDisconnectStartRef.current[rp.player_index] = anchor;
            gameLogger.warn(`[MultiplayerGame] Client-side: seeding disconnect from server event for player_index=${rp.player_index} (anchor=${isTheirTurn ? 'turn_started_at' : 'now'})`);
          }
          newMap.set(rp.player_index, clientDisconnectStartRef.current[rp.player_index]);
          continue;
        }

        // Player is 'connected' — check for stale heartbeat
        // Use freshest last_seen_at: prefer ref (updated each heartbeat ping),
        // fall back to the value from the last meaningful state update.
        const lastSeenIso = playerLastSeenAtRef.current[rp.id] || rp.last_seen_at;
        if (!lastSeenIso) continue;

        const staleMs = now - new Date(lastSeenIso).getTime();
        if (staleMs > STALE_THRESHOLD_MS) {
          // Disconnect detected via stale heartbeat. If it's this player's turn, use
          // turn_started_at as the anchor so the charcoal grey ring continues the
          // turn countdown rather than restarting from 60s.
          if (!clientDisconnectStartRef.current[rp.player_index]) {
            const gs = multiplayerGameStateRef.current;
            const isTheirTurn = gs?.current_turn === rp.player_index;
            const anchor = (isTheirTurn && gs?.turn_started_at) ? gs.turn_started_at : new Date().toISOString();
            clientDisconnectStartRef.current[rp.player_index] = anchor;
            gameLogger.warn(`[MultiplayerGame] Client-side: player_index=${rp.player_index} detected as disconnected (stale ${Math.round(staleMs / 1000)}s, anchor=${isTheirTurn ? 'turn_started_at' : 'now'})`);
          }
          newMap.set(rp.player_index, clientDisconnectStartRef.current[rp.player_index]);
        } else {
          // Player is live — only clear client detection when the server also has no
          // active timer (disconnect_timer_started_at = null). If the server timer is
          // still running (heartbeat race set connection_status back to 'connected'
          // without clearing the persistent timer), keep our client-side start time.
          if (clientDisconnectStartRef.current[rp.player_index]) {
            if (!rp.disconnect_timer_started_at) {
              gameLogger.info(`[MultiplayerGame] Client-side: player_index=${rp.player_index} reconnected (server timer cleared)`);
              delete clientDisconnectStartRef.current[rp.player_index];
            } else {
              // Server timer still active despite 'connected' status (heartbeat race).
              // Keep the client-detected start time so the ring animation is unaffected.
              newMap.set(rp.player_index, clientDisconnectStartRef.current[rp.player_index]);
            }
          }
        }
      }

      setClientDisconnections(newMap);
    }, 1_000); // Poll every 1s for fast disconnect detection (presence leave backdates timestamps)

    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realtimePlayers, user?.id]);
  // ─────────────────────────────────────────────────────────────────────────────

  // ── Countdown Expiry Handlers ──────────────────────────────────────────
  // CONNECTION countdown expired: show RejoinModal (bot replaced player)
  const handleLocalPlayerCountdownExpired = useCallback(() => {
    gameLogger.warn('[MultiplayerGame] Local player connection countdown expired — showing rejoin modal');
    setShowBotReplacedModal(true);
  }, []);

  // Enrich layoutPlayersWithScores with countdown data for both turn and connection timers
  const enrichedLayoutPlayers = useMemo(() => {
    // Get turn timer started_at from game_state (shared state for ALL players)
    const turnStartedAt = multiplayerGameState?.turn_started_at || null;

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

      return {
        ...player,
        // Show turn ring on WHOEVER's turn it is (all players see it)
        turnTimerStartedAt: player.isActive ? turnStartedAt : null,
        // Merge client-side + server-side disconnect state
        isDisconnected: isClientDisconnected || player.isDisconnected,
        disconnectTimerStartedAt: clientDisconnectTimerStartedAt || player.disconnectTimerStartedAt,
        // Connection countdown callback: only local player handles expiry
        onCountdownExpired: idx === 0 ? handleLocalPlayerCountdownExpired : undefined,
      };
    });
  }, [layoutPlayersWithScores, handleLocalPlayerCountdownExpired, multiplayerGameState?.turn_started_at, clientDisconnections]);

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
          player with a bot. Offers "Reclaim My Seat" or "Leave Room". */}
      <RejoinModal
        visible={showBotReplacedModal}
        botUsername={botReplacedUsername}
        onReclaim={handleReclaimSeat}
        onLeaveRoom={handleLeaveRoomFromModal}
      />

      {/* Turn Auto-Play Modal — shown when 60s turn countdown expires and
          auto-play-turn edge function plays/passes automatically. */}
      <TurnAutoPlayModal
        visible={showTurnAutoPlayModal}
        action={autoPlayAction}
        cards={autoPlayedCards}
        onConfirm={() => {
          gameLogger.info('[MultiplayerGame] Player confirmed: still here');
          setShowTurnAutoPlayModal(false);
          setAutoPlayedCards(null);
        }}
        onTimeout={async () => {
          gameLogger.warn('[MultiplayerGame] Turn auto-play modal timed out — marking player disconnected');
          setShowTurnAutoPlayModal(false);
          setAutoPlayedCards(null);
          // Mark player as disconnected → triggers bot replacement flow
          if (roomInfo?.id) {
            const { error } = await supabase.functions.invoke('mark-disconnected', {
              body: { room_id: roomInfo.id },
            });
            if (error) {
              gameLogger.error('[MultiplayerGame] Failed to mark player disconnected:', error);
            }
          }
        }}
      />
    </>
  );
}
