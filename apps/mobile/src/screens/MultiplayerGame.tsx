/**
 * MultiplayerGame - Full component for Multiplayer (server-side) game mode.
 * Contains all multiplayer-only hooks (realtime, bot coordinator, match end handler, etc.)
 * plus shared hooks (card selection, orientation, audio, etc.), then renders GameView.
 * Created as part of Task #570: Split GameScreen component.
 */
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Alert,
  BackHandler,
  InteractionManager,
  Platform,
  TouchableOpacity,
  Text,
  StyleSheet,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  useRoute,
  RouteProp,
  useNavigation,
  useIsFocused,
  useFocusEffect,
} from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import Constants from 'expo-constants';
import { InGameAlert } from '../components/game/InGameAlert';
import type { InGameAlertHandle, InGameAlertOptions } from '../components/game/InGameAlert';
import { useAuth } from '../contexts/AuthContext';
import { useGameEnd } from '../contexts/GameEndContext';
import { useScoreboard } from '../contexts/ScoreboardContext';
import { supabase, APP_VERSION } from '../services/supabase';
import { API } from '../constants';
import type { FinalScore } from '../types/gameEnd';
import { useConnectionManager } from '../hooks/useConnectionManager';
import { useDisconnectDetection } from '../hooks/useDisconnectDetection';
import { useServerBotCoordinator } from '../hooks/useServerBotCoordinator';
import { useMatchTransition } from '../hooks/useMatchTransition';
import { useTurnInactivityTimer } from '../hooks/useTurnInactivityTimer';
import { useClockSync } from '../hooks/useClockSync';
import { useCardSelection } from '../hooks/useCardSelection';
import { useGameActions, type GameMode } from '../hooks/useGameActions';
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
import { sortHandLowestToHighest } from '../utils/helperButtonUtils';
import { gameLogger } from '../utils/logger';
import { parseMultiplayerHands } from '../utils/parseMultiplayerHands';
import { showError } from '../utils/alerts';
import type { Card } from '../game/types';
import type { GameStateManager } from '../game/state';
// FinalScore import removed — onGameOver callback replaced by useMatchEndHandler (DB-authoritative path)
import type {
  GameState as MultiplayerGameState,
  Player as MultiplayerPlayer,
} from '../types/multiplayer';
import type { ScoreHistory } from '../types/scoreboard';
import { parsePersistedScoreHistory } from '../utils/parsePersistedScoreHistory';
import { RejoinModal } from '../components/game/RejoinModal';
import { GameContextProvider } from '../contexts/GameContext';
import type { GameContextType } from '../contexts/GameContext';
import { useGameSessionStore } from '../store';
import { useVideoChat, StubVideoChatAdapter } from '../hooks/useVideoChat';
import { useGameChat } from '../hooks/useGameChat';
import { useThrowables } from '../hooks/useThrowables';
import { i18n } from '../i18n';
import {
  trackEvent,
  trackGameEvent,
  featureDurationStart,
  featureDurationEnd,
} from '../services/analytics';
import { GameView } from './GameView';
// LiveKitVideoChatAdapter is loaded lazily via require() (see videoChatAdapter useMemo below)
// to prevent @livekit/react-native native module access at module-load time.
// A static import would evaluate the module immediately, potentially crashing in
// environments where the native module is not linked (Expo Go, CI, pre-prebuild builds).
// The module exports `isLiveKitAvailable` which is set at module-eval time inside
// a try/catch; checking it avoids constructing the adapter when the native module
// is absent, without any error ever reaching React's renderer.
// isExpoGo is kept as a fast-path to skip the require entirely when we know we
// are in Expo Go (avoids any module evaluation overhead).
const isExpoGo =
  Constants.executionEnvironment === 'storeClient' ||
  (Constants as unknown as { appOwnership?: string }).appOwnership === 'expo';

type GameScreenRouteProp = RouteProp<RootStackParamList, 'Game'>;
type GameScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Game'>;

/**
 * DEV-ONLY flag: set to `true` to re-enable the floating "Skip to End" red button
 * during debugging. The button calls the complete-game edge function with fake data
 * so you can test the Play Again / rematch flow without finishing a real game.
 * Play Again is working in production so the button is hidden by default.
 */
const DEV_SHOW_SKIP_TO_END = false;

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
    isPlayHistoryOpen,
    isScoreboardExpanded,
    setIsPlayHistoryOpen,
    setIsScoreboardExpanded,
  } = scoreboardContext;
  const { openGameEndModal, setOnPlayAgain, setOnReturnToMenu } = useGameEnd();
  const { roomCode, botDifficulty = 'medium' } = route.params;
  const [showSettings, setShowSettings] = useState(false);

  // In-game alert ref — orientation-aware replacement for Alert.alert
  const inGameAlertRef = useRef<InGameAlertHandle>(null);
  const showInGameAlert = useCallback((options: InGameAlertOptions) => {
    // Fallback when the ref is unmounted/unavailable (e.g. during screen teardown).
    // Use Alert.alert when buttons are present to preserve custom actions;
    // otherwise fall back to showError for simple message-only errors.
    if (inGameAlertRef.current) {
      inGameAlertRef.current.show(options);
    } else if (options.buttons?.length) {
      Alert.alert(options.title ?? '', options.message, options.buttons);
    } else {
      showError(options.message, options.title);
    }
  }, []);

  // State for bot replacement dialog
  const [showBotReplacedModal, setShowBotReplacedModal] = useState(false);
  const [botReplacedUsername, setBotReplacedUsername] = useState<string | null>(null);

  // State for multiplayer room data
  const [multiplayerPlayers, setMultiplayerPlayers] = useState<MultiplayerPlayer[]>([]);
  const [roomInfo, setRoomInfo] = useState<RoomInfo | null>(null);
  // Keep a ref mirror of roomInfo so the Play Again callback always reads the latest value,
  // avoiding stale-closure issues when the Alert.alert onPress fires.
  const roomInfoRef = useRef<RoomInfo | null>(null);

  /** Derive a consistent GA4 game_mode string from a RoomInfo object. */
  const getGameModeForAnalytics = useCallback(
    (info: RoomInfo): GameMode =>
      info.ranked_mode
        ? 'online_ranked'
        : info.is_matchmaking || info.is_public
          ? 'online_casual'
          : 'online_private',
    []
  );
  useEffect(() => {
    roomInfoRef.current = roomInfo;
  }, [roomInfo]);
  // Mirror isHost so the Play Again callback avoids stale closures
  const isHostRef = useRef(false);

  // Track when game transitions to 'playing' to calculate duration
  const [gameStartedAt, setGameStartedAt] = useState<string | null>(null);
  // Prevent duplicate game_started events across re-renders
  const hasTrackedGameStartRef = useRef(false);

  // Orientation manager (Task #450)
  const {
    currentOrientation,
    toggleOrientation,
    isAvailable: orientationAvailable,
    isLocked,
  } = useOrientationManager();
  // Guard against stale isLocked after useGameCleanup unlocks orientation in
  // the beforeRemove handler without updating the isLocked state.
  const isFocused = useIsFocused();

  const currentPlayerName = profile?.username || user?.email?.split('@')[0] || 'Player';

  // Log game mode ONCE (not on every render)
  useEffect(() => {
    gameLogger.info('🎮 [MultiplayerGame] Game mode: MULTIPLAYER (server-side)');
  }, []);

  // ─── Android hardware back button handler ────────────────────────────────
  // Use useFocusEffect so the handler only intercepts back presses while this
  // screen is focused (other mounted-but-unfocused screens won't interfere).
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return;
      const handler = () => {
        Alert.alert(i18n.t('game.leaveGameConfirm'), i18n.t('game.leaveGameMessage'), [
          { text: i18n.t('game.stay'), style: 'cancel' },
          {
            text: i18n.t('game.leaveGame'),
            style: 'destructive',
            onPress: () => navigation.goBack(),
          },
        ]);
        return true; // Suppress default back behaviour
      };
      const sub = BackHandler.addEventListener('hardwareBackPress', handler);
      return () => sub.remove();
    }, [navigation])
  );

  // ─── Register Play Again / Return to Menu callbacks ──────────────────────
  useEffect(() => {
    setOnPlayAgain(() => async () => {
      // Read from ref to always get the latest roomInfo, even if the closure is stale
      const info = roomInfoRef.current;
      gameLogger.info('🔄 [MultiplayerGame] Play Again pressed, roomInfo:', {
        hasInfo: !!info,
        roomId: info?.id,
        is_public: info?.is_public,
        ranked_mode: info?.ranked_mode,
      });

      if (!user?.id) {
        throw new Error('Not logged in. Please sign in and try again.');
      }

      try {
        if (!info) {
          gameLogger.error(
            '❌ [MultiplayerGame] Play Again: missing room info; cannot determine room flags.'
          );
          throw new Error('Unable to create a new game room right now. Please try again.');
        }

        if (!info.id) {
          gameLogger.error('❌ [MultiplayerGame] Play Again: missing room id.');
          throw new Error('Unable to create a new game room right now. Please try again.');
        }

        // Bot-replacement cleanup is intentionally NOT performed here.
        // The get_or_create_rematch_room RPC atomically deletes the caller's
        // room_players row as part of its participation check.  Pre-deleting
        // via delete_room_players_by_human_user_id can remove the row the RPC
        // needs to find, causing a "not a participant" error.

        const username = profile?.username || user?.email?.split('@')[0] || 'Player';

        // 2. Atomically get-or-create the rematch room.
        //    The server-side RPC guarantees that no matter how many players
        //    press Play Again simultaneously, exactly ONE new room is created.
        //    The first caller (by DB transaction ordering) becomes the host;
        //    all subsequent callers join that same room.
        gameLogger.info(
          '🔄 [MultiplayerGame] Play Again: creating rematch room for source',
          info.id
        );
        const rematchPromise = supabase.rpc('get_or_create_rematch_room', {
          p_source_room_id: info.id,
          p_user_id: user.id,
          p_username: username,
          p_is_public: info.is_public,
          p_is_matchmaking: info.is_matchmaking,
          p_ranked_mode: info.ranked_mode,
        });
        let rematchTimeoutId: ReturnType<typeof setTimeout> | undefined;
        const rematchTimeout = new Promise<never>((_, reject) => {
          rematchTimeoutId = setTimeout(() => {
            gameLogger.warn(
              '⏰ [MultiplayerGame] Play Again: get_or_create_rematch_room timed out after 15 s'
            );
            reject(new Error('Your match request timed out. Please try again.'));
          }, 15_000);
        });
        const { data: rematchResult, error: rematchError } = await Promise.race([
          rematchPromise,
          rematchTimeout,
        ]).finally(() => clearTimeout(rematchTimeoutId));
        gameLogger.info(
          '🔄 [MultiplayerGame] Play Again: rematch RPC done, success:',
          !rematchError
        );

        const result = rematchResult as {
          success: boolean;
          room_code: string;
          room_id: string;
          is_host: boolean;
        } | null;

        if (rematchError || !result?.success || !result.room_code) {
          gameLogger.error(
            '❌ [MultiplayerGame] Play Again: rematch RPC failed:',
            rematchError?.message ?? 'no room_code in result',
            'code:',
            rematchError?.code,
            'details:',
            rematchError?.details,
            'result:',
            JSON.stringify(result)
          );
          throw new Error('Failed to create new room. Please try again.');
        }

        gameLogger.info(
          '🔄 [MultiplayerGame] Play Again → rematch room:',
          result.room_code,
          'is_host:',
          result.is_host
        );

        // 3. Navigate every player (host and non-host alike) to the new lobby.
        navigation.reset({
          index: 1,
          routes: [{ name: 'Home' }, { name: 'Lobby', params: { roomCode: result.room_code } }],
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        gameLogger.error('❌ [MultiplayerGame] Play Again error:', msg);
        throw err;
      }
    });

    setOnReturnToMenu(() => () => {
      gameLogger.info('🏠 [MultiplayerGame] Return to Menu → Home');
      navigation.reset({
        index: 0,
        routes: [{ name: 'Home' }],
      });
    });
  }, [
    navigation,
    setOnPlayAgain,
    setOnReturnToMenu,
    user?.id,
    profile?.username,
    user?.email,
    showInGameAlert,
  ]);
  // ─────────────────────────────────────────────────────────────────────────────

  // Card selection hook
  const {
    selectedCardIds,
    setSelectedCardIds,
    customCardOrder,
    setCustomCardOrder,
    handleCardsReorder,
  } = useCardSelection();

  // Initialize multiplayer room data
  useMultiplayerRoomLoader({
    isMultiplayerGame: true,
    roomCode,
    navigation,
    setMultiplayerPlayers,
    setRoomInfo,
  });

  // Empty game manager ref (multiplayer has no local game engine)
  const emptyGameManagerRef = useRef<GameStateManager | null>(null);

  // Suppresses the onError → showInGameAlert in-game alert/modal while connectWithRetry is in progress.
  // Without this, every failed intermediate attempt (attempt 0, 1) would surface
  // an error alert to the user even when a later retry succeeds.
  const suppressConnectErrorsRef = useRef(false);

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
    channel: realtimeChannel,
  } = useRealtime({
    userId: user?.id || '',
    username: currentPlayerName,
    onError: error => {
      gameLogger.error('[MultiplayerGame] Multiplayer error:', error.message);
      const msg = error.message?.toLowerCase() || '';
      if (msg.includes('not your turn')) {
        // Stale Realtime state caused the client to think it was our turn, but the
        // server disagrees. Re-fetch authoritative game state so the UI immediately
        // reflects the correct current_turn and the Play button reverts.
        gameLogger.warn(
          '⚠️ [MultiplayerGame] "Not your turn" — refreshing game state to re-sync UI'
        );
        void refreshGameState().catch(refreshError => {
          gameLogger.error(
            '[MultiplayerGame] Failed to refresh game state after "Not your turn" error:',
            refreshError
          );
        });
        return;
      }
      if (msg.includes('connection') || msg.includes('reconnect')) {
        gameLogger.warn('⚠️ [MultiplayerGame] Suppressed non-critical multiplayer error from UI');
        return;
      }
      // Suppress connect errors while connectWithRetry has pending retries.
      // This prevents showing an error toast on attempt 0/1 when attempt 1/2
      // may still succeed. suppressConnectErrorsRef is cleared before the
      // final-attempt showInGameAlert call and on effect cleanup.
      if (suppressConnectErrorsRef.current) {
        gameLogger.warn('⚠️ [MultiplayerGame] Suppressed connect error during retry');
        return;
      }
      showInGameAlert({ message: error.message });
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

  // Keep isHostRef in sync so Play Again callback avoids stale closures
  useEffect(() => {
    isHostRef.current = isMultiplayerHost;
  }, [isMultiplayerHost]);

  // Track when game starts (for duration calculation and analytics)
  // Placed after useRealtime so multiplayerGameState is already declared.
  useEffect(() => {
    if (
      multiplayerGameState?.game_phase === 'first_play' ||
      multiplayerGameState?.game_phase === 'playing'
    ) {
      if (!gameStartedAt) {
        setGameStartedAt(new Date().toISOString());
      }
      if (!hasTrackedGameStartRef.current && roomInfo && multiplayerPlayers.length > 0) {
        hasTrackedGameStartRef.current = true;
        const botsPresent = multiplayerPlayers.some(p => p.is_bot);
        const dbBotDifficulty = multiplayerPlayers.find(p => p.is_bot)?.bot_difficulty;
        const analyticsBotDifficulty = botsPresent
          ? (dbBotDifficulty ?? botDifficulty ?? 'unknown')
          : 'none';
        const analyticsGameMode = getGameModeForAnalytics(roomInfo);
        trackGameEvent('game_started', {
          game_mode: analyticsGameMode,
          player_count: multiplayerPlayers.length,
          bots_present: botsPresent ? 1 : 0,
          human_count: multiplayerPlayers.filter(p => !p.is_bot).length,
          bot_count: multiplayerPlayers.filter(p => p.is_bot).length,
          bot_difficulty: analyticsBotDifficulty,
        });
      }
    } else if (
      multiplayerGameState?.game_phase === 'dealing' &&
      (multiplayerGameState?.match_number ?? 1) === 1
    ) {
      hasTrackedGameStartRef.current = false;
    }
  }, [
    multiplayerGameState?.game_phase,
    multiplayerGameState?.match_number,
    roomInfo,
    multiplayerPlayers,
    gameStartedAt,
    botDifficulty,
    getGameModeForAnalytics,
  ]);

  // Ensure multiplayer realtime channel is joined when entering the Game screen.
  // Makes up to 4 total attempts (initial + 3 retries) with exponential backoff:
  // delay after attempt 0 = 1 s, delay after attempt 1 = 2 s, delay after attempt 2 = 4 s.
  // Retries guard against transient failures common on cold app start when the Supabase
  // connection isn't fully ready.
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    // Stored resolve fn so the cleanup can unblock the awaiting Promise immediately
    // rather than leaving the async chain hanging until the timeout fires.
    let retryTimerResolve: (() => void) | null = null;

    // Suppress onError toasts while retries are in-flight so the user does not
    // see an error on attempt 0/1 when a later retry may still succeed.
    suppressConnectErrorsRef.current = true;

    const connectWithRetry = async (attempt: number) => {
      try {
        await multiplayerConnectToRoom(roomCode);
        // If cleanup ran while we were awaiting (e.g. user navigated away),
        // stop here — do not touch any refs/state after unmount.
        if (cancelled) return;
        // Connection succeeded — re-enable onError toasts for the rest of the
        // screen lifetime so genuine post-connection errors are shown to the user.
        suppressConnectErrorsRef.current = false;
      } catch (error: unknown) {
        const err = error as Error;
        if (cancelled) return;
        // Exponential back-off: 1 s after attempt 0, 2 s after attempt 1, 4 s after attempt 2.
        // 4 total attempts (0, 1, 2, 3); actual delays 1 s → 2 s → 4 s.
        if (attempt < 3) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
          gameLogger.warn(
            `[MultiplayerGame] Connect attempt ${attempt + 1} failed, retrying in ${delay}ms...`,
            err?.message
          );
          await new Promise<void>(resolve => {
            retryTimerResolve = resolve;
            retryTimer = setTimeout(resolve, delay);
          });
          retryTimer = null;
          retryTimerResolve = null;
          if (!cancelled) await connectWithRetry(attempt + 1);
        } else {
          // Final attempt failed — allow the onError toast to show now.
          suppressConnectErrorsRef.current = false;
          console.error('[MultiplayerGame] ❌ Failed to connect after 4 attempts:', err);
          gameLogger.error('[MultiplayerGame] Failed to connect:', err?.message || String(err));
          showInGameAlert({ message: err?.message || 'Failed to connect to room' });
        }
      }
    };

    // Defer until the navigation animation finishes so connectWithRetry doesn't
    // run during an active Fabric navigation transaction. Concurrent async state
    // updates during a transaction cause EXC_BAD_ACCESS crashes in
    // Scheduler::uiManagerDidFinishTransaction / RuntimeScheduler_Modern::updateRendering.
    const interactionHandle = InteractionManager.runAfterInteractions(() => {
      if (!cancelled) void connectWithRetry(0);
    });

    return () => {
      cancelled = true;
      interactionHandle.cancel();
      suppressConnectErrorsRef.current = false;
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      // Resolve the pending promise so the async chain exits immediately
      // rather than hanging until the cancelledTimeout would have fired.
      if (retryTimerResolve) {
        retryTimerResolve();
        retryTimerResolve = null;
      }
    };
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

  const {
    reconnect: connectionReconnect,
    isReconnecting,
    rejoinStatus,
    forceSweep,
    stopHeartbeats,
  } = useConnectionManager({
    roomId: roomInfo?.id ?? '',
    playerId: myRoomPlayerId ?? '',
    enabled: !!roomInfo?.id && !!myRoomPlayerId,
    onBotReplaced: () => {
      gameLogger.warn('[MultiplayerGame] Player was replaced by a bot — showing rejoin dialog');
      setShowBotReplacedModal(true);
    },
    onRoomClosed: () => {
      gameLogger.warn('[MultiplayerGame] Room was closed while away');
      navigation.reset({ index: 0, routes: [{ name: 'Home', params: { roomClosed: true } }] });
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
      // Explicitly refresh game state after reclaim so the UI shows the human's
      // hand and correct turn info. The server also broadcasts player_reconnected
      // which triggers fetchGameState, but this explicit call is belt-and-suspenders
      // in case the broadcast arrives late or is lost on a flaky mobile connection.
      await refreshGameState().catch(err => {
        gameLogger.warn(
          '[MultiplayerGame] Post-reclaim refreshGameState failed (non-fatal):',
          err instanceof Error ? err.message : String(err)
        );
      });
      setShowBotReplacedModal(false);
      setBotReplacedUsername(null);
      gameLogger.info('[MultiplayerGame] Seat reclaimed successfully');
    } catch (err) {
      gameLogger.error(
        '[MultiplayerGame] Failed to reclaim seat from bot:',
        err instanceof Error ? err.message : String(err)
      );
      // Keep modal open — user can retry or leave
    }
  }, [connectionReconnect, refreshGameState]);

  const handleLeaveRoomFromModal = useCallback(() => {
    // Intentionally do NOT delete the replaced_by_bot row here.
    // We navigate to Home and let the HomeScreen banner show
    // "Replace Bot & Rejoin" + "Leave" — the permanent row deletion
    // and voluntarily-left suppression happen only when the player
    // explicitly presses "Leave" on that HomeScreen banner.
    gameLogger.info(
      '[MultiplayerGame] Leaving room after bot replacement — keeping replaced_by_bot row for HomeScreen banner'
    );
    setShowBotReplacedModal(false);
    const info = roomInfoRef.current;
    const abandonedParams: Record<string, string | number> = { source: 'bot_replacement' };
    if (info) {
      abandonedParams.game_mode = getGameModeForAnalytics(info);
    }
    trackGameEvent('game_abandoned', abandonedParams);
    navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
  }, [navigation, getGameModeForAnalytics]);
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
        const { entries, shouldRemove } = parsePersistedScoreHistory(stored);
        if (entries) {
          gameLogger.info(
            `[MultiplayerGame] 🔄 Restoring ${entries.length} score history entries for room ${roomCode}`
          );
          restoreScoreHistory(entries);
        } else if (shouldRemove) {
          gameLogger.warn('[MultiplayerGame] Persisted score history is invalid, removing');
          await AsyncStorage.removeItem(ROOM_SCORE_KEY);
        }
      } catch (err: unknown) {
        gameLogger.error(
          '[MultiplayerGame] Failed to restore multiplayer score history:',
          err instanceof Error ? err.message : String(err)
        );
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
      AsyncStorage.setItem(ROOM_SCORE_KEY, JSON.stringify(scoreHistory)).catch(err => {
        gameLogger.error(
          '[MultiplayerGame] Failed to persist multiplayer score history:',
          err?.message || String(err)
        );
      });
    }
  }, [scoreHistory, ROOM_SCORE_KEY]);
  // ─────────────────────────────────────────────────────────────────────────────

  // ─── CUSTOM CARD ORDER PERSISTENCE ──────────────────────────────────────────
  const CARD_ORDER_KEY = `@big2_card_order_${roomCode}`;
  const hasRestoredCardOrderRef = useRef(false);
  // Stores the match_number that was active when the card order was last saved.
  // Used by the auto-sort effect to skip sorting when re-entering a game
  // mid-match where the player already has a valid custom card arrangement.
  const restoredMatchNumberRef = useRef<number | null>(null);

  // 1. Restore custom card order for this room on mount
  useEffect(() => {
    if (hasRestoredCardOrderRef.current) return;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(CARD_ORDER_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          // Support old format (plain array) and new format ({ cards, matchNumber })
          const cards: string[] = Array.isArray(parsed) ? parsed : (parsed?.cards ?? []);
          const storedMatchNumber: number | null = Array.isArray(parsed)
            ? null
            : (parsed?.matchNumber ?? null);
          if (Array.isArray(cards) && cards.length > 0) {
            gameLogger.info(
              `[MultiplayerGame] 🔄 Restoring card order (${cards.length} cards) for room ${roomCode}`
            );
            setCustomCardOrder(cards);
            restoredMatchNumberRef.current = storedMatchNumber;
          }
        }
      } catch (err: unknown) {
        gameLogger.error(
          '[MultiplayerGame] Failed to restore card order:',
          err instanceof Error ? err.message : String(err)
        );
      } finally {
        hasRestoredCardOrderRef.current = true;
      }
    })();
  }, [CARD_ORDER_KEY, roomCode, setCustomCardOrder]);

  // 2. Reset custom card order and stored order when match number changes to avoid
  // carrying a previous match's order into a new hand.
  const lastMatchNumberForOrderResetRef = useRef<number | null>(null);
  useEffect(() => {
    const currentMatchNumber = multiplayerGameState?.match_number ?? null;
    if (currentMatchNumber === null) return;
    if (
      lastMatchNumberForOrderResetRef.current !== null &&
      lastMatchNumberForOrderResetRef.current !== currentMatchNumber
    ) {
      setCustomCardOrder([]);
      AsyncStorage.removeItem(CARD_ORDER_KEY).catch(err => {
        gameLogger.error(
          '[MultiplayerGame] Failed to clear stored card order on match change:',
          err?.message || String(err)
        );
      });
    }
    lastMatchNumberForOrderResetRef.current = currentMatchNumber;
  }, [multiplayerGameState?.match_number, setCustomCardOrder, CARD_ORDER_KEY]);

  // 3. Persist custom card order (with current match_number) whenever it changes
  const isFirstCardOrderRenderRef = useRef(true);
  useEffect(() => {
    if (isFirstCardOrderRenderRef.current) {
      isFirstCardOrderRenderRef.current = false;
      return;
    }
    const currentMatchNumber = multiplayerGameState?.match_number ?? 1;
    if (customCardOrder.length > 0) {
      const data = { cards: customCardOrder, matchNumber: currentMatchNumber };
      AsyncStorage.setItem(CARD_ORDER_KEY, JSON.stringify(data)).catch(err => {
        gameLogger.error(
          '[MultiplayerGame] Failed to persist card order:',
          err?.message || String(err)
        );
      });
    }
  }, [customCardOrder, CARD_ORDER_KEY, multiplayerGameState?.match_number]);
  // ─────────────────────────────────────────────────────────────────────────────

  // MULTIPLAYER HANDS MEMO
  const multiplayerHandsByIndex = React.useMemo(() => {
    const hands = multiplayerGameState?.hands;
    return parseMultiplayerHands(
      hands as Record<string, ({ id: string; rank: string; suit: string } | string)[]> | undefined
    );
  }, [multiplayerGameState]);

  // Merge player hands into players for bot coordinator
  const playersWithCards = React.useMemo(() => {
    if (!multiplayerPlayers) {
      return [];
    }

    const hasHands = !!multiplayerHandsByIndex;

    return multiplayerPlayers.map(player => {
      const playerHandKey = String(player.player_index);
      const playerHand = hasHands ? multiplayerHandsByIndex[playerHandKey] : undefined;

      return {
        ...player,
        player_id: player.id,
        cards: (Array.isArray(playerHand) ? playerHand : []) as Card[],
      };
    });
  }, [multiplayerHandsByIndex, multiplayerPlayers]);

  // DIAGNOSTIC: Track coordinator status — only log when the output boolean changes.
  // Previously included realtimePlayers + multiplayerGameState as deps, causing a log
  // (and the effect overhead) on every bot play. Now derived from the 3 inputs that
  // actually affect the boolean so it fires at most a handful of times per game.
  const playersWithCardsCount = playersWithCards.length;
  const prevCoordinatorRef = useRef<boolean | null>(null);
  useEffect(() => {
    const coordinatorStatus =
      isMultiplayerDataReady && isMultiplayerHost && playersWithCardsCount > 0;
    if (coordinatorStatus === prevCoordinatorRef.current) return; // unchanged — skip
    prevCoordinatorRef.current = coordinatorStatus;
    gameLogger.info('[MultiplayerGame] 🎯 Coordinator Status:', {
      isCoordinator: coordinatorStatus,
      breakdown: {
        isMultiplayerGame: true,
        isMultiplayerDataReady,
        isMultiplayerHost,
        playersWithCardsCount,
      },
      will_trigger_bots: coordinatorStatus,
    });
  }, [isMultiplayerDataReady, isMultiplayerHost, playersWithCardsCount]);

  // Server-side bot coordinator fallback (Tasks #551/#552)
  useServerBotCoordinator({
    roomCode,
    enabled: isMultiplayerDataReady && (realtimePlayers.length > 0 || playersWithCards.length > 0),
    gameState: multiplayerGameState,
    players: (realtimePlayers.length > 0 ? realtimePlayers : playersWithCards) as unknown as {
      player_index: number;
      is_bot?: boolean | null;
      [key: string]: unknown;
    }[],
    isAutoPassInProgress,
  });

  // Match transition safety net: calls start_new_match if game stays in 'finished'
  // phase for longer than MATCH_TRANSITION_GRACE_MS (1500ms). Critical for the
  // bot-won-match case where bot-coordinator is the primary caller but can fail.
  useMatchTransition({
    gameState: multiplayerGameState,
    room: roomInfo,
    enabled: isMultiplayerDataReady && isConnected,
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
  const effectiveMultiplayerPlayers =
    realtimePlayers.length > 0 ? realtimePlayers : multiplayerPlayers;

  const {
    multiplayerSeatIndex,
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
      result = [...result].sort(
        (a, b) => (orderMap.get(a.id) ?? 999) - (orderMap.get(b.id) ?? 999)
      );
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- multiplayerHandsByIndex is a safety dep
  }, [multiplayerPlayerHand, multiplayerHandsByIndex, customCardOrder]);

  // Auto-sort hand when cards are first dealt or a new match begins.
  // Keyed off multiplayerGameState.match_number so new deals are detected
  // reliably even when card IDs persist across matches (e.g. '3D', 'AS').
  const hasAutoSortedRef = useRef(false);
  const prevMatchNumberRef = useRef<number | null>(null);
  useEffect(() => {
    // Wait until card order restore has completed to avoid racing with it
    if (!hasRestoredCardOrderRef.current) return;
    const hand = (multiplayerPlayerHand ?? []) as Card[];
    const currentMatchNumber = multiplayerGameState?.match_number ?? 1;

    if (hand.length > 0) {
      // Reset sort guard whenever the match number advances (new deal without
      // passing through an empty-hand state is handled correctly this way).
      if (currentMatchNumber !== prevMatchNumberRef.current) {
        const isFirstRunAfterMount = prevMatchNumberRef.current === null;
        hasAutoSortedRef.current = false;
        prevMatchNumberRef.current = currentMatchNumber;

        // On first run after mount: if the persisted order was saved for this
        // exact match, skip auto-sort to preserve the player's arrangement.
        if (isFirstRunAfterMount && restoredMatchNumberRef.current === currentMatchNumber) {
          hasAutoSortedRef.current = true;
        }
      }
      if (!hasAutoSortedRef.current) {
        hasAutoSortedRef.current = true;
        const sorted = sortHandLowestToHighest(hand);
        setCustomCardOrder(sorted.map(c => c.id));
        gameLogger.info(
          '[MultiplayerGame] Auto-sorted dealt hand (match #' + currentMatchNumber + ')'
        );
      }
    }
  }, [multiplayerPlayerHand, multiplayerGameState?.match_number, setCustomCardOrder]);

  // Helper buttons
  const { handleSort, handleSmartSort, handleHint } = useHelperButtons({
    playerHand: effectivePlayerHand,
    lastPlay: multiplayerLastPlay || null,
    isFirstPlay: multiplayerGameState?.game_phase === 'first_play',
    customCardOrder,
    setCustomCardOrder,
    setSelectedCardIds,
    onAlert: showInGameAlert,
  });

  // Cleanup: navigation cleanup + mount tracking
  const { isMountedRef } = useGameCleanup({
    userId: user?.id,
    roomCode,
    navigation,
    orientationAvailable,
    roomId: roomInfo?.id,
    stopHeartbeat: stopHeartbeats,
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
    // Compute next active player's card count for OCL validation.
    // Walk forward from the local player's seat, skipping players with 0 cards.
    let nextPlayerCardCount: number | undefined;
    if (
      multiplayerSeatIndex !== null &&
      multiplayerSeatIndex !== undefined &&
      multiplayerHandsByIndex
    ) {
      const n = effectiveMultiplayerPlayers.length;
      for (let i = 1; i < n; i++) {
        const candidateIndex = (multiplayerSeatIndex + i) % n;
        const count = multiplayerHandsByIndex[String(candidateIndex)]?.length ?? 0;
        if (count > 0) {
          nextPlayerCardCount = count;
          break;
        }
      }
    }
    return {
      lastPlay: multiplayerLastPlay ?? null,
      isFirstPlayOfGame: multiplayerGameState.game_phase === 'first_play',
      playerHand: effectivePlayerHand,
      nextPlayerCardCount,
    };
  }, [
    multiplayerGameState,
    multiplayerLastPlay,
    effectivePlayerHand,
    multiplayerSeatIndex,
    multiplayerHandsByIndex,
    effectiveMultiplayerPlayers,
  ]);

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
    onAlert: showInGameAlert,
    gameMode: roomInfo ? getGameModeForAnalytics(roomInfo) : undefined,
    humanCount: effectiveMultiplayerPlayers.filter(p => !p.is_bot).length,
    botCount: effectiveMultiplayerPlayers.filter(p => p.is_bot).length,
    botDifficultyLevel: effectiveMultiplayerPlayers.some(p => p.is_bot)
      ? (effectiveMultiplayerPlayers.find(p => p.is_bot)?.bot_difficulty ?? botDifficulty)
      : undefined,
  });

  // ── TURN INACTIVITY TIMER ────────────────────────────────────────────────
  // Monitors turn_started_at when it's the local player's turn.
  // Shows yellow InactivityCountdownRing (60s to play/pass).
  // Separate from the charcoal-grey disconnect ring (connection inactivity).
  // When expired: auto-plays highest valid cards OR passes.
  //
  // Clock sync: measure the client→server offset from the auto-pass timer state
  // so getCorrectedNow() compensates for the server being ahead of the client.
  // This prevents spurious "clock skew detected" warnings on every turn and ensures
  // the auto-play edge function fires at the correct 60s server-relative deadline.
  // offsetMs is also forwarded to GameContext so InactivityCountdownRing uses the same
  // corrected clock as AutoPassTimer (fixes the ⚠️ Clock skew log in InactivityRing).
  // fallbackServerTimestamp: when no auto-pass timer has fired yet, seed an initial rough
  // offset from turn_started_at so the very first turn's InactivityRing / TurnTimer don't
  // log residual clock-skew warnings.
  const turnStartedAtMs = multiplayerGameState?.turn_started_at
    ? new Date(multiplayerGameState.turn_started_at).getTime()
    : null;
  const { getCorrectedNow: getTurnCorrectedNow, offsetMs: turnClockOffsetMs } = useClockSync(
    multiplayerGameState?.auto_pass_timer ?? null,
    turnStartedAtMs
  );
  const { isMyTurn: _isTurnInactivityMyTurn } = useTurnInactivityTimer({
    gameState: multiplayerGameState,
    room: roomInfo,
    roomPlayers: effectiveMultiplayerPlayers,
    // broadcastMessage omitted — turn_auto_played is supplementary; auto-play is confirmed
    // by the server-authoritative game_state update. Wire to useRealtime.broadcastMessage
    // (once added to UseRealtimeReturn) when turn_auto_played needs to reach other clients.
    getCorrectedNow: getTurnCorrectedNow,
    currentUserId: user?.id,
    onAutoPlay: (cards, action) => {
      // auto-play-turn edge function replaces the player with a bot immediately
      // (65s spec). Stop heartbeats (without calling mark-disconnected) so they
      // don't overwrite the server-set connection_status='replaced_by_bot'.
      // The Realtime subscription in useConnectionManager will surface the
      // RejoinModal automatically.
      gameLogger.info(
        '[MultiplayerGame] Turn auto-played:',
        action,
        cards?.length ?? 0,
        'cards — stopping heartbeats for bot replacement flow'
      );
      stopHeartbeats();
    },
  });
  // ─────────────────────────────────────────────────────────────────────────────

  // Computed values
  // useMemo ensures selectedCards only gets a new reference when the hand or
  // selection actually changes — not on every MultiplayerGame render.  Without
  // this, getSelectedCards() returns a fresh array each call, which invalidates
  // the gameContextValue useMemo every render and forces GameView to re-render
  // even when nothing visible has changed (perf/task-628).
  const selectedCards = useMemo(
    () => effectivePlayerHand.filter(card => selectedCardIds.has(card.id)),
    [effectivePlayerHand, selectedCardIds]
  );
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

  // ── Client-side disconnect state machine (H1 — Audit fix #633) ─────────────
  // All disconnect detection logic (stale-heartbeat polling, anchor computation,
  // ring suppression, countdown expiry handlers, enrichedLayoutPlayers useMemo)
  // has been extracted to useDisconnectDetection for testability and readability.
  const { enrichedLayoutPlayers } = useDisconnectDetection({
    realtimePlayers,
    userId: user?.id,
    multiplayerGameState: multiplayerGameState as MultiplayerGameState | null,
    playerLastSeenAtRef,
    forceSweep,
    layoutPlayersWithScores,
    layoutPlayers,
    showBotReplacedModal,
    isReconnecting,
    setShowBotReplacedModal,
  });

  // Stable callbacks for GameView — wrapped with useCallback so React.memo on GameView
  // can bail out when these props haven't semantically changed (H2 audit fix).
  // Side effects are in useEffects below that observe committed state transitions,
  // avoiding stale-closure issues on rapid taps and concurrent-mode double-invocation.
  const hasMountedPlayHistoryRef = useRef(false);
  const hasMountedScoreboardRef = useRef(false);
  // Refs mirror current open state for the unmount cleanup (closure capture workaround).
  const isPlayHistoryOpenRef = useRef(isPlayHistoryOpen);
  const isScoreboardExpandedRef = useRef(isScoreboardExpanded);

  const togglePlayHistory = useCallback(() => {
    setIsPlayHistoryOpen(prev => !prev);
  }, [setIsPlayHistoryOpen]);
  const toggleScoreboardExpanded = useCallback(() => {
    setIsScoreboardExpanded(prev => !prev);
  }, [setIsScoreboardExpanded]);

  useEffect(() => {
    isPlayHistoryOpenRef.current = isPlayHistoryOpen;
    if (!hasMountedPlayHistoryRef.current) {
      hasMountedPlayHistoryRef.current = true;
      return;
    }
    if (isPlayHistoryOpen) {
      featureDurationStart('play_history');
      trackEvent('play_history_viewed', { action: 'open' });
    } else {
      featureDurationEnd('play_history', 'play_history_session_duration');
    }
  }, [isPlayHistoryOpen]);

  useEffect(() => {
    isScoreboardExpandedRef.current = isScoreboardExpanded;
    if (!hasMountedScoreboardRef.current) {
      hasMountedScoreboardRef.current = true;
      return;
    }
    if (isScoreboardExpanded) {
      featureDurationStart('scoreboard');
      trackEvent('scoreboard_expanded', { action: 'open' });
    } else {
      featureDurationEnd('scoreboard', 'scoreboard_session_duration');
    }
  }, [isScoreboardExpanded]);

  // Emit duration events for any open panels when the screen unmounts so no session is lost.
  useEffect(() => {
    return () => {
      if (isPlayHistoryOpenRef.current) {
        featureDurationEnd('play_history', 'play_history_session_duration');
      }
      if (isScoreboardExpandedRef.current) {
        featureDurationEnd('scoreboard', 'scoreboard_session_duration');
      }
    };
  }, []);

  // Player is ready when it's their turn and multiplayer game state exists.
  // Memoized so a layoutPlayers array reference swap that doesn't change
  // isActive (the common case during bot plays) won't cascade into
  // gameContextValue and trigger GameView to re-render.
  const localPlayerIsActive = layoutPlayers[0]?.isActive ?? false;
  const isPlayerReady = useMemo(
    () => localPlayerIsActive && !!multiplayerGameState,
    [localPlayerIsActive, multiplayerGameState]
  );

  // ── C2 Audit: Sync game-session state to Zustand (single source of truth) ──
  // GameView reads these from useGameSessionStore instead of GameContext.
  // Single atomic setState so all subscribers observe a consistent snapshot
  // and only one re-render is triggered per update cycle.
  useEffect(() => {
    useGameSessionStore.setState({
      layoutPlayers,
      layoutPlayersWithScores: enrichedLayoutPlayers,
      playerTotalScores,
      currentPlayerName,
      isPlayerReady,
      isGameFinished,
      matchNumber,
    });
  }, [
    layoutPlayers,
    enrichedLayoutPlayers,
    playerTotalScores,
    currentPlayerName,
    isPlayerReady,
    isGameFinished,
    matchNumber,
  ]);

  // ── Task #651 / #649: in-game video + voice chat ─────────────────────────────
  // LiveKitVideoChatAdapter is used in native (EAS) builds where
  // @livekit/react-native is linked. StubVideoChatAdapter (no-op) is used in
  // Expo Go and any other environment where the native module is absent.
  // The require() is lazy so the module is only evaluated when needed.
  // isLiveKitAvailable is exported by the module and set at module-eval time
  // inside a try/catch, so it is safe to check without any throw risk.
  const videoChatAdapter = React.useMemo(() => {
    if (isExpoGo) return new StubVideoChatAdapter();
    try {
      const { LiveKitVideoChatAdapter, isLiveKitAvailable } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../hooks/LiveKitVideoChatAdapter') as typeof import('../hooks/LiveKitVideoChatAdapter');
      if (!isLiveKitAvailable) {
        gameLogger.info('[VideoChat] @livekit/react-native not linked — using stub adapter');
        return new StubVideoChatAdapter();
      }
      return new LiveKitVideoChatAdapter();
    } catch {
      gameLogger.warn('[VideoChat] LiveKit not available, falling back to stub adapter');
      return new StubVideoChatAdapter();
    }
  }, []);

  const {
    isChatConnected,
    voiceChatEnabled,
    isLocalCameraOn,
    isLocalMicOn,
    remoteParticipants,
    toggleVideoChat: _toggleVideoChat,
    toggleVoiceChat: _toggleVoiceChat,
    toggleCamera,
    toggleMic,
    isConnecting: isVideoChatConnecting,
    isAudioConnecting,
    getVideoTrackRef,
  } = useVideoChat({
    roomId: roomInfo?.id,
    userId: user?.id,
    adapter: videoChatAdapter,
    autoConnect: true,
    onAlert: showInGameAlert,
  });

  // Guard: LiveKit requires native WebRTC modules. Show a clear alert when the
  // adapter resolved to the stub (covers Expo Go, missing native module, or any
  // other environment where @livekit/react-native is unavailable).
  const isLiveKitUnavailable = videoChatAdapter instanceof StubVideoChatAdapter;

  const toggleVideoChat = useCallback(async () => {
    if (isLiveKitUnavailable) {
      const devHint = __DEV__
        ? '\n\n  pnpm expo install expo-dev-client\n  eas build --profile development          # simulator/emulator\n  eas build --profile developmentDevice    # physical device'
        : '';
      showInGameAlert({
        title: i18n.t('chat.devBuildRequiredTitle'),
        message: i18n.t('chat.devBuildRequiredMessage') + devHint,
      });
      return;
    }
    await _toggleVideoChat();
  }, [_toggleVideoChat, isLiveKitUnavailable, showInGameAlert]);

  const toggleVoiceChat = useCallback(async () => {
    if (isLiveKitUnavailable) {
      const devHint = __DEV__
        ? '\n\n  pnpm expo install expo-dev-client\n  eas build --profile development          # simulator/emulator\n  eas build --profile developmentDevice    # physical device'
        : '';
      showInGameAlert({
        title: i18n.t('chat.devBuildRequiredTitle'),
        message: i18n.t('chat.devBuildRequiredMessage') + devHint,
      });
      return;
    }
    await _toggleVoiceChat();
  }, [_toggleVoiceChat, isLiveKitUnavailable, showInGameAlert]);

  // Build a stable Record<userId, cameraState> from the SDK participant list
  // so GameView / PlayerInfo can look up each player's camera state by user_id.
  const remoteCameraStates = useMemo(
    () =>
      Object.fromEntries(
        remoteParticipants.map(p => [
          p.participantId,
          { isCameraOn: p.isCameraOn, isConnecting: p.isConnecting },
        ])
      ),
    [remoteParticipants]
  );

  // Build a stable Record<userId, micState> from participant list.
  const remoteMicStates = useMemo(
    () =>
      Object.fromEntries(remoteParticipants.map(p => [p.participantId, { isMicOn: p.isMicOn }])),
    [remoteParticipants]
  );

  // Build remote player IDs in display order [top, left, right] so GameView can
  // map display-position indices (1, 2, 3 of layoutPlayers) to LiveKit participant
  // identities (= Supabase user_id) for video stream slot lookup.
  // layoutPlayers[idx].player_index is the game-seat index; look up the
  // corresponding player from effectiveMultiplayerPlayers (the same realtime-driven
  // source used to build layoutPlayers) to avoid stale IDs after bot replacement or
  // username/user_id changes.
  const remotePlayerIds = useMemo((): readonly string[] => {
    return [1, 2, 3].map(displayIdx => {
      const lp = layoutPlayers[displayIdx];
      if (!lp) return '';
      const mp = effectiveMultiplayerPlayers.find(p => p.player_index === lp.player_index);
      // Bots (including bot-replaced players) should not expose a user_id
      // so that long-press / add-friend actions are disabled for them.
      if (mp?.is_bot) return '';
      return mp?.user_id ?? '';
    });
  }, [layoutPlayers, effectiveMultiplayerPlayers]);

  // ── Task #648: In-game text chat ──────────────────────────────────────
  const [isChatDrawerOpen, setIsChatDrawerOpen] = useState(false);
  const toggleChatDrawer = useCallback(() => setIsChatDrawerOpen(prev => !prev), []);

  // ── Auto-dismiss all overlays when the RejoinModal appears ──────────────
  // When the bot-replacement popup is shown the player should not be
  // interacting with any other overlay (chat, play history, settings menu,
  // or expanded scoreboard). Close them all automatically so the modal is
  // fully visible and nothing else captures touches underneath it.
  useEffect(() => {
    if (!showBotReplacedModal) return;
    setIsChatDrawerOpen(false);
    setShowSettings(false);
    setIsPlayHistoryOpen(false);
    setIsScoreboardExpanded(false);
  }, [
    showBotReplacedModal,
    setShowSettings,
    setIsChatDrawerOpen,
    setIsPlayHistoryOpen,
    setIsScoreboardExpanded,
  ]);

  const {
    messages: chatMessages,
    sendMessage: sendChatMessage,
    unreadCount: chatUnreadCount,
    isCooldown: isChatCooldown,
  } = useGameChat({
    channel: realtimeChannel,
    userId: user?.id || '',
    username: currentPlayerName,
    isDrawerOpen: isChatDrawerOpen,
  });

  // Throwables — fun GG Poker–style egg/smoke/confetti interactions.
  const {
    activeEffects: throwableActiveEffects,
    incomingThrowable: throwableIncoming,
    dismissIncoming: throwableDismissIncoming,
    sendThrowable,
    isThrowCooldown,
    cooldownRemaining,
  } = useThrowables({
    channel: realtimeChannel,
    userId: user?.id || '',
    username: currentPlayerName,
    layoutPlayers: layoutPlayers,
    myPlayerIndex: multiplayerSeatIndex,
  });

  // Build the context value; useMemo keeps the object reference stable so that
  // GameView (wrapped in React.memo) only re-renders when game-visible state
  // actually changes (H2 + H4 audit fix).
  const gameContextValue = React.useMemo<GameContextType>(
    () => ({
      isLocalAIGame: false,
      currentOrientation,
      toggleOrientation,
      isInitializing: !isMultiplayerDataReady,
      isConnected,
      showSettings,
      setShowSettings,
      roomCode,
      effectivePlayerHand,
      selectedCardIds,
      setSelectedCardIds,
      handleCardsReorder,
      selectedCards,
      effectiveLastPlayedCards: multiplayerLastPlayedCards,
      effectiveLastPlayedBy: multiplayerLastPlayedBy,
      effectiveLastPlayComboType: multiplayerLastPlayComboType,
      effectiveLastPlayCombo: multiplayerLastPlayCombo,
      togglePlayHistory,
      toggleScoreboardExpanded,
      memoizedPlayerNames,
      memoizedCurrentScores,
      memoizedCardCounts,
      memoizedOriginalPlayerNames,
      effectiveAutoPassTimerState,
      effectiveScoreboardCurrentPlayerIndex,
      displayOrderScoreHistory,
      playHistoryByMatch,
      turnClockOffsetMs,
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
      gameManagerRef: emptyGameManagerRef,
      isMountedRef,
      // Task #651 / #649
      isChatConnected,
      voiceChatEnabled,
      isLocalCameraOn,
      isLocalMicOn,
      remoteCameraStates,
      remoteMicStates,
      toggleVideoChat,
      toggleVoiceChat,
      toggleCamera,
      toggleMic,
      isVideoChatConnecting,
      isAudioConnecting,
      remotePlayerIds,
      getVideoTrackRef,
      // Task #648: in-game text chat
      chatMessages,
      sendChatMessage,
      chatUnreadCount,
      isChatCooldown,
      isChatDrawerOpen,
      toggleChatDrawer,
      localUserId: user?.id || '',
      // Throwables
      throwableActiveEffects,
      throwableIncoming,
      throwableDismissIncoming,
      sendThrowable,
      isThrowCooldown,
      cooldownRemaining,
      showInGameAlert,
    }),
    [
      currentOrientation,
      toggleOrientation,
      isMultiplayerDataReady,
      isConnected,
      showSettings,
      setShowSettings,
      roomCode,
      effectivePlayerHand,
      selectedCardIds,
      setSelectedCardIds,
      handleCardsReorder,
      selectedCards,
      multiplayerLastPlayedCards,
      multiplayerLastPlayedBy,
      multiplayerLastPlayComboType,
      multiplayerLastPlayCombo,
      togglePlayHistory,
      toggleScoreboardExpanded,
      memoizedPlayerNames,
      memoizedCurrentScores,
      memoizedCardCounts,
      memoizedOriginalPlayerNames,
      effectiveAutoPassTimerState,
      effectiveScoreboardCurrentPlayerIndex,
      displayOrderScoreHistory,
      playHistoryByMatch,
      turnClockOffsetMs,
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
      emptyGameManagerRef,
      isMountedRef,
      isChatConnected,
      voiceChatEnabled,
      isLocalCameraOn,
      isLocalMicOn,
      remoteCameraStates,
      remoteMicStates,
      toggleVideoChat,
      toggleVoiceChat,
      toggleCamera,
      toggleMic,
      isVideoChatConnecting,
      isAudioConnecting,
      remotePlayerIds,
      getVideoTrackRef,
      chatMessages,
      sendChatMessage,
      chatUnreadCount,
      isChatCooldown,
      isChatDrawerOpen,
      toggleChatDrawer,
      user?.id,
      throwableActiveEffects,
      throwableIncoming,
      throwableDismissIncoming,
      sendThrowable,
      isThrowCooldown,
      cooldownRemaining,
      showInGameAlert,
    ]
  );

  // ── DEV ONLY: Skip to game end (calls complete-game edge function with fake data) ──
  const handleDevSkipToEnd = useCallback(async () => {
    if (!__DEV__) return;
    if (!roomInfo?.id || !user?.id) {
      Alert.alert('Dev: Skip to End', 'Room info or user not ready yet.');
      return;
    }

    const players =
      effectiveMultiplayerPlayers.length === 4 ? effectiveMultiplayerPlayers : multiplayerPlayers;

    if (players.length < 1) {
      Alert.alert('Dev: Skip to End', 'No player data yet. Wait for game to start.');
      return;
    }

    // Pad to exactly 4 players if needed
    const paddedPlayers = [...players];
    while (paddedPlayers.length < 4) {
      paddedPlayers.push({
        ...paddedPlayers[0],
        user_id: `00000000-0000-0000-0000-00000000000${paddedPlayers.length}`,
        username: `BotPad${paddedPlayers.length}`,
        is_bot: true,
        player_index: paddedPlayers.length,
      });
    }

    // Current user is winner (pos 1); others get positions 2–4
    let otherPos = 2;
    const payload = {
      room_id: roomInfo.id,
      room_code: roomCode,
      game_type: (roomInfo.ranked_mode
        ? 'ranked'
        : roomInfo.is_public || roomInfo.is_matchmaking
          ? 'casual'
          : 'private') as 'casual' | 'ranked' | 'private',
      bot_difficulty:
        (
          paddedPlayers.find(p => (p as { is_bot?: boolean }).is_bot) as
            | { bot_difficulty?: string }
            | undefined
        )?.bot_difficulty ?? null,
      players: paddedPlayers.map(p => {
        const isBot = !!(p as { is_bot?: boolean }).is_bot;
        // Edge function maps user_ids starting with "bot_" → null before INSERT,
        // so bots must use this format to avoid FK constraint violations.
        const userId = isBot ? `bot_${p.player_index}` : p.user_id;
        return {
          user_id: userId,
          username: p.username,
          score: p.user_id === user.id ? 0 : 25,
          finish_position: p.user_id === user.id ? 1 : otherPos++,
          cards_left: p.user_id === user.id ? 0 : 5,
          was_bot: isBot,
          disconnected: false,
          original_username: null,
          combos_played: {
            singles: 1,
            pairs: 0,
            triples: 0,
            straights: 0,
            flushes: 0,
            full_houses: 0,
            four_of_a_kinds: 0,
            straight_flushes: 0,
            royal_flushes: 0,
          },
        };
      }),
      winner_id: user.id,
      game_duration_seconds: 60,
      started_at: gameStartedAt ?? new Date(Date.now() - 60_000).toISOString(),
      finished_at: new Date().toISOString(),
      game_completed: true,
    };

    gameLogger.info('[DEV] Calling complete-game with fake payload', {
      room_code: roomCode,
      players: payload.players.map(p => `${p.username}(pos=${p.finish_position})`).join(', '),
    });

    // Use direct fetch with Authorization header — same pattern as useGameStatsUploader.
    // supabase.functions.invoke fails silently in React Native with a network error
    // because it doesn't propagate the session token reliably in this context.
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) {
      Alert.alert('Dev: Skip to End', 'No auth session — are you logged in?');
      return;
    }

    // Retry up to 3 times with 1.5 s delay — the edge function is idempotent
    // (deduplicates via unique constraint). "Network request failed" means the
    // TCP response dropped; the server likely processed the request and already
    // broadcast game_ended, so retries are safe and necessary.
    const MAX_DEV_RETRIES = 3;
    let succeeded = false;
    let lastError: string | null = null;
    for (let attempt = 1; attempt <= MAX_DEV_RETRIES; attempt++) {
      try {
        const resp = await fetch(`${API.SUPABASE_URL}/functions/v1/complete-game`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'x-app-version': APP_VERSION,
          },
          body: JSON.stringify(payload),
        });
        const text = await resp.text();
        if (resp.ok) {
          gameLogger.info(`[DEV] complete-game succeeded (attempt ${attempt}) — opening modal`);
          succeeded = true;
          break;
        }
        if (resp.status === 409 || resp.status === 422) {
          // Already processed (dedup hit): room is already finished, treat as success
          gameLogger.info(
            `[DEV] complete-game: already processed (HTTP ${resp.status}) — opening modal`
          );
          succeeded = true;
          break;
        }
        gameLogger.error(
          `[DEV] complete-game HTTP ${resp.status} (attempt ${attempt}):`,
          text.slice(0, 200)
        );
        lastError = `HTTP ${resp.status}: ${text.slice(0, 150)}`;
        // 4xx client errors won't be fixed by retrying
        if (resp.status < 500) break;
      } catch (fetchErr) {
        const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
        gameLogger.warn(
          `[DEV] complete-game network error (attempt ${attempt}/${MAX_DEV_RETRIES}):`,
          msg
        );
        lastError = msg;
        // "Network request failed" means the request likely succeeded server-side
        // (room is now finished). Treat as success after first attempt and
        // open the modal — the game_ended broadcast confirms the server ran it.
        if (attempt >= 1) {
          gameLogger.info(
            '[DEV] Network error — server likely processed the request. Opening modal.'
          );
          succeeded = true;
          break;
        }
        if (attempt < MAX_DEV_RETRIES) {
          await new Promise(r => setTimeout(r, 1500));
        }
      }
    }

    if (!succeeded && lastError) {
      Alert.alert('Dev: Skip to End — Error', lastError);
      return;
    }

    // ── Open the game end modal directly ──────────────────────────────────────
    // complete-game sets room.status='finished' and broadcasts game_ended, but does
    // NOT update game_state.game_phase to 'game_over'. useMatchEndHandler only fires
    // on that DB change, so the modal never opens via the normal DB-authoritative path.
    // We bypass that by calling openGameEndModal directly with the synthetic data.
    const winnerName = profile?.username || user.email?.split('@')[0] || 'You';
    const winnerIndex = paddedPlayers.findIndex(p => p.user_id === user.id);

    // payload.players was built from paddedPlayers.map, so index i maps directly
    const devFinalScores: FinalScore[] = payload.players.map((p, i) => ({
      player_index: i,
      player_name: p.username ?? 'Unknown',
      cumulative_score: p.score,
      points_added: p.score,
    }));

    const devPlayerNames = paddedPlayers.map(p => p.username ?? 'Unknown');

    gameLogger.info('[DEV] Opening game end modal directly with synthetic data');
    openGameEndModal(
      winnerName,
      winnerIndex >= 0 ? winnerIndex : 0,
      devFinalScores,
      devPlayerNames,
      [],
      []
    );
  }, [
    roomInfo,
    user?.id,
    user?.email,
    profile?.username,
    roomCode,
    effectiveMultiplayerPlayers,
    multiplayerPlayers,
    gameStartedAt,
    openGameEndModal,
  ]);
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <>
      <GameContextProvider value={gameContextValue}>
        <GameView />
      </GameContextProvider>

      {/* In-game alert — orientation-aware replacement for native Alert.alert.
          Uses a Modal with supportedOrientations restricted to the game's chosen
          orientation so popups always appear aligned with the game layout, not the
          physical device rotation.
          Only constrain to the game orientation when the native orientation lock
          is confirmed active. useOrientationManager initialises isLocked=false
          when expo-screen-orientation is absent (e.g. Expo Go) and sets it false
          again if lockAsync fails, so this gate is reliable. Without the lock,
          currentOrientation is UI-only and may diverge from the real interface
          orientation, causing an iOS Modal crash. */}
      <InGameAlert
        ref={inGameAlertRef}
        {...(isLocked && isFocused ? { gameOrientation: currentOrientation } : {})}
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

      {/* DEV ONLY: "Skip to End" floating button — forces game completion so
          Play Again / rematch flow can be tested without playing a full game.
          Calls complete-game edge function with a fake payload (current user wins).
          Hidden in production builds (tree-shaken by __DEV__ = false).
          To re-enable for debugging: set DEV_SHOW_SKIP_TO_END = true at the top of this file. */}
      {__DEV__ && DEV_SHOW_SKIP_TO_END && (
        <TouchableOpacity
          style={devStyles.skipButton}
          onPress={handleDevSkipToEnd}
          activeOpacity={0.7}
        >
          <Text style={devStyles.skipButtonText}>🔧 End</Text>
        </TouchableOpacity>
      )}
    </>
  );
}

// Dev-only styles; production gets empty style objects (zero runtime cost).
const devStyles = __DEV__
  ? StyleSheet.create({
      skipButton: {
        position: 'absolute',
        top: 60,
        right: 12,
        zIndex: 9999,
        backgroundColor: 'rgba(255, 60, 60, 0.85)',
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 6,
      },
      skipButtonText: {
        color: '#fff',
        fontSize: 12,
        fontWeight: '700',
      },
    })
  : StyleSheet.create({ skipButton: {}, skipButtonText: {} });
