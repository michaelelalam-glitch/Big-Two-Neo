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
import Constants from 'expo-constants';
import { InGameAlert } from '../components/game/InGameAlert';
import type { InGameAlertHandle, InGameAlertOptions } from '../components/game/InGameAlert';
import { useAuth } from '../contexts/AuthContext';
import { useGameEnd } from '../contexts/GameEndContext';
import { useScoreboard } from '../contexts/ScoreboardContext';
import { supabase } from '../services/supabase';
import { useConnectionManager } from '../hooks/useConnectionManager';
import { useDisconnectDetection } from '../hooks/useDisconnectDetection';
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
import { sortHandLowestToHighest } from '../utils/helperButtonUtils';
import { gameLogger } from '../utils/logger';
import { parseMultiplayerHands } from '../utils/parseMultiplayerHands';
import type { Card } from '../game/types';
import type { GameStateManager } from '../game/state';
// FinalScore import removed — onGameOver callback replaced by useMatchEndHandler (DB-authoritative path)
import type {
  GameState as MultiplayerGameState,
  Player as MultiplayerPlayer,
} from '../types/multiplayer';
import type { ScoreHistory } from '../types/scoreboard';
import { RejoinModal } from '../components/game/RejoinModal';
import { GameContextProvider } from '../contexts/GameContext';
import type { GameContextType } from '../contexts/GameContext';
import { useVideoChat, StubVideoChatAdapter } from '../hooks/useVideoChat';
import { useGameChat } from '../hooks/useGameChat';
import { useThrowables } from '../hooks/useThrowables';
import { i18n } from '../i18n';
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
    setIsPlayHistoryOpen,
    setIsScoreboardExpanded,
  } = scoreboardContext;
  const { openGameEndModal, setOnPlayAgain, setOnReturnToMenu } = useGameEnd();
  const { roomCode, botDifficulty = 'medium' } = route.params;
  const [showSettings, setShowSettings] = useState(false);

  // In-game alert ref — orientation-aware replacement for Alert.alert
  const inGameAlertRef = useRef<InGameAlertHandle>(null);
  const showInGameAlert = useCallback((options: InGameAlertOptions) => {
    inGameAlertRef.current?.show(options);
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
  useEffect(() => {
    roomInfoRef.current = roomInfo;
  }, [roomInfo]);
  // Mirror isHost so the Play Again callback avoids stale closures
  const isHostRef = useRef(false);

  // Track when game transitions to 'playing' to calculate duration
  const [gameStartedAt, setGameStartedAt] = useState<string | null>(null);

  // Orientation manager (Task #450)
  const {
    currentOrientation,
    toggleOrientation,
    isAvailable: orientationAvailable,
  } = useOrientationManager();

  const currentPlayerName = profile?.username || user?.email?.split('@')[0] || 'Player';

  // Log game mode ONCE (not on every render)
  useEffect(() => {
    gameLogger.info('🎮 [MultiplayerGame] Game mode: MULTIPLAYER (server-side)');
  }, []);

  // ─── Register Play Again / Return to Menu callbacks ──────────────────────
  useEffect(() => {
    setOnPlayAgain(() => async () => {
      // Read from ref to always get the latest roomInfo, even if the closure is stale
      const info = roomInfoRef.current;
      gameLogger.info('🔄 [MultiplayerGame] Play Again pressed, roomInfo:', {
        hasInfo: !!info,
        is_public: info?.is_public,
        ranked_mode: info?.ranked_mode,
      });

      if (!user?.id) {
        showInGameAlert({ message: 'Not logged in. Please sign in and try again.' });
        return;
      }

      try {
        // 1. Clean up old room membership (scoped to current room) to prevent
        // "already in room" conflicts. Uses both user_id (direct) and
        // human_user_id (bot-replacement) cleanup paths.
        if (info?.id) {
          const { error: cleanupError } = await supabase
            .from('room_players')
            .delete()
            .eq('user_id', user.id)
            .eq('room_id', info.id);
          if (cleanupError) {
            gameLogger.warn(
              '⚠️ [MultiplayerGame] Play Again: old room cleanup warning:',
              cleanupError.message
            );
          }
        }
        // Also clean up bot-replacement rows where user was replaced
        const { error: botCleanupError } = await supabase.rpc(
          'delete_room_players_by_human_user_id',
          { human_user_id: user.id }
        );
        if (botCleanupError) {
          gameLogger.warn(
            '⚠️ [MultiplayerGame] Play Again: bot-replacement cleanup warning:',
            botCleanupError.message
          );
        }

        if (!info) {
          gameLogger.error(
            '❌ [MultiplayerGame] Play Again: missing room info; cannot determine room flags.'
          );
          showInGameAlert({
            message: 'Unable to create a new game room right now. Please try again.',
          });
          return;
        }

        const username = profile?.username || user?.email?.split('@')[0] || 'Player';

        // 2. Deterministic creator: host creates immediately, non-host listens
        //    for a broadcast first (up to 5s) before falling back to creating.
        //    This prevents the race where multiple players press Play Again
        //    simultaneously, all listen, nobody broadcasts, and everyone
        //    creates separate rooms.
        const amHost = isHostRef.current;
        let receivedRoomCode: string | null = null;

        if (!amHost && info.id) {
          const playAgainChannel = supabase.channel(`play-again:${info.id}`);
          receivedRoomCode = await new Promise<string | null>(resolve => {
            const timeout = setTimeout(() => {
              supabase.removeChannel(playAgainChannel);
              resolve(null);
            }, 5000);

            playAgainChannel
              .on('broadcast', { event: 'play_again_room' }, payload => {
                clearTimeout(timeout);
                const code = payload?.payload?.room_code as string | undefined;
                if (code) {
                  gameLogger.info('🔄 [MultiplayerGame] Received play_again_room broadcast:', code);
                  resolve(code);
                } else {
                  resolve(null);
                }
                supabase.removeChannel(playAgainChannel);
              })
              .subscribe();
          });
        }

        if (receivedRoomCode) {
          // Another player already created a room — join it
          gameLogger.info(
            '🔄 [MultiplayerGame] Play Again → Joining existing room:',
            receivedRoomCode
          );
          const { error: joinError } = await supabase.rpc('join_room_atomic', {
            p_room_code: receivedRoomCode,
            p_user_id: user.id,
            p_username: username,
          });

          if (joinError) {
            gameLogger.warn(
              '⚠️ [MultiplayerGame] Failed to join broadcasted room, creating new one:',
              joinError.message
            );
            // Fall through to create own room
          } else {
            navigation.reset({
              index: 1,
              routes: [{ name: 'Home' }, { name: 'Lobby', params: { roomCode: receivedRoomCode } }],
            });
            return;
          }
        }

        // 3. Create new room AND join atomically via get_or_create_room RPC.
        const { data: roomResult, error: createError } = await supabase.rpc('get_or_create_room', {
          p_user_id: user.id,
          p_username: username,
          p_is_public: info.is_public,
          p_is_matchmaking: info.is_matchmaking,
          p_ranked_mode: info.ranked_mode,
        });

        const result = roomResult as {
          success: boolean;
          room_code: string;
          room_id: string;
        } | null;

        if (createError || !result?.success || !result.room_code) {
          gameLogger.error(
            '❌ [MultiplayerGame] Play Again: failed to create room:',
            createError?.message
          );
          showInGameAlert({ message: 'Failed to create new room. Please try again.' });
          return;
        }

        gameLogger.info('🔄 [MultiplayerGame] Play Again → Created new room:', result.room_code);

        // 4. Broadcast the new room code to other players on the old room channel
        if (info.id) {
          const broadcastChannel = supabase.channel(`play-again:${info.id}`);
          broadcastChannel.subscribe(async status => {
            if (status === 'SUBSCRIBED') {
              await broadcastChannel.send({
                type: 'broadcast',
                event: 'play_again_room',
                payload: { room_code: result.room_code },
              });
              gameLogger.info(
                '📡 [MultiplayerGame] Broadcasted play_again_room:',
                result.room_code
              );
              // Re-broadcast every 1s for 5 seconds so late subscribers can receive it
              // (Supabase broadcasts are not buffered, so one-shot can miss late joiners)
              const rebroadcastInterval = setInterval(async () => {
                try {
                  await broadcastChannel.send({
                    type: 'broadcast',
                    event: 'play_again_room',
                    payload: { room_code: result.room_code },
                  });
                } catch {
                  /* best-effort */
                }
              }, 1000);
              setTimeout(() => {
                clearInterval(rebroadcastInterval);
                supabase.removeChannel(broadcastChannel);
              }, 5000);
            } else if (
              status === 'CHANNEL_ERROR' ||
              status === 'TIMED_OUT' ||
              status === 'CLOSED'
            ) {
              gameLogger.warn(`📡 [MultiplayerGame] Broadcast channel ${status} — removing`);
              supabase.removeChannel(broadcastChannel);
            }
          });
        }

        // Navigate to the Lobby with the new room code
        navigation.reset({
          index: 1,
          routes: [{ name: 'Home' }, { name: 'Lobby', params: { roomCode: result.room_code } }],
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        gameLogger.error('❌ [MultiplayerGame] Play Again error:', msg);
        showInGameAlert({ message: 'Failed to create new room. Please try again.' });
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

  // Track when game starts (for duration calculation)
  // Placed after useRealtime so multiplayerGameState is already declared.
  useEffect(() => {
    if (
      multiplayerGameState?.game_phase === 'first_play' ||
      multiplayerGameState?.game_phase === 'playing'
    ) {
      if (!gameStartedAt) {
        setGameStartedAt(new Date().toISOString());
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multiplayerGameState?.game_phase]);

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

    // Fire-and-forget: the async retry chain manages its own lifecycle via the
    // cancelled flag and retryTimerResolve; we don't need to await it here.
    void connectWithRetry(0);

    return () => {
      cancelled = true;
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
            gameLogger.info(
              `[MultiplayerGame] 🔄 Restoring ${parsed.length} score history entries for room ${roomCode}`
            );
            restoreScoreHistory(parsed);
          }
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
    onAlert: showInGameAlert,
  });

  // ── TURN INACTIVITY TIMER ────────────────────────────────────────────────
  // Monitors turn_started_at when it's the local player's turn.
  // Shows yellow InactivityCountdownRing (60s to play/pass).
  // Separate from the charcoal-grey disconnect ring (connection inactivity).
  // When expired: auto-plays highest valid cards OR passes.
  const { isMyTurn: _isTurnInactivityMyTurn } = useTurnInactivityTimer({
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
      gameLogger.info(
        '[MultiplayerGame] Turn auto-played:',
        action,
        cards?.length ?? 0,
        'cards — bot replacement in progress'
      );
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
  const togglePlayHistory = useCallback(
    () => setIsPlayHistoryOpen((prev: boolean) => !prev),
    [setIsPlayHistoryOpen]
  );
  const toggleScoreboardExpanded = useCallback(
    () => setIsScoreboardExpanded((prev: boolean) => !prev),
    [setIsScoreboardExpanded]
  );

  // Player is ready when it's their turn and multiplayer game state exists.
  // Memoized so a layoutPlayers array reference swap that doesn't change
  // isActive (the common case during bot plays) won't cascade into
  // gameContextValue and trigger GameView to re-render.
  const localPlayerIsActive = layoutPlayers[0]?.isActive ?? false;
  const isPlayerReady = useMemo(
    () => localPlayerIsActive && !!multiplayerGameState,
    [localPlayerIsActive, multiplayerGameState]
  );

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
      customCardOrder,
      setCustomCardOrder,
      effectiveLastPlayedCards: multiplayerLastPlayedCards,
      effectiveLastPlayedBy: multiplayerLastPlayedBy,
      effectiveLastPlayComboType: multiplayerLastPlayComboType,
      effectiveLastPlayCombo: multiplayerLastPlayCombo,
      layoutPlayers,
      layoutPlayersWithScores: enrichedLayoutPlayers,
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
      customCardOrder,
      setCustomCardOrder,
      multiplayerLastPlayedCards,
      multiplayerLastPlayedBy,
      multiplayerLastPlayComboType,
      multiplayerLastPlayCombo,
      layoutPlayers,
      enrichedLayoutPlayers,
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
          is confirmed active (orientationAvailable). Without the lock, currentOrientation
          is simulated (Expo Go / missing module) and may diverge from the real interface
          orientation, causing an iOS Modal presentation crash. */}
      <InGameAlert
        ref={inGameAlertRef}
        {...(orientationAvailable ? { gameOrientation: currentOrientation } : {})}
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
