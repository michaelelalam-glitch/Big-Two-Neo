/**
 * useActiveGameBanner — H5 Audit fix (Task #637)
 *
 * Owns all state and logic for the "active game" banner shown on HomeScreen:
 *   - Current room detection (checkCurrentRoom, useFocusEffect)
 *   - Voluntarily-left room persistence (AsyncStorage)
 *   - 60s disconnect countdown + handleTimerExpired bot-replacement poll
 *   - Banner action handlers: resume, leave, replace-bot-and-rejoin
 *   - Game exclusivity guard (checkGameExclusivity)
 *
 * Extracted from HomeScreen.tsx which was 1,643 LOC.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../services/supabase';
import { showError, showSuccess, showConfirm } from '../utils';
import { roomLogger } from '../utils/logger';
import { i18n } from '../i18n';
import type { RootStackParamList } from '../navigation/AppNavigator';
import type { RoomPlayerWithRoom } from '../types';
import type { ActiveGameInfo } from '../components/home/ActiveGameBanner';

type HomeNavProp = StackNavigationProp<RootStackParamList, 'Home'>;

// Single source of truth for the AsyncStorage key.
export const VOLUNTARILY_LEFT_ROOMS_KEY = '@stephanos_voluntarily_left_rooms';

// Cached disconnect timer start time — written by useGameCleanup immediately after
// mark-disconnected succeeds so the HomeScreen banner can show the countdown
// without waiting for the get-rejoin-status edge-function round-trip (~5 s).
export const DISCONNECT_TIMER_KEY = '@stephanos_disconnect_timer_started_at';

export interface UseActiveGameBannerResult {
  currentRoom: string | null;
  setCurrentRoom: React.Dispatch<React.SetStateAction<string | null>>;
  currentRoomStatus: 'waiting' | 'playing' | undefined;
  disconnectTimestamp: number | null;
  canRejoinAfterExpiry: boolean | null;
  bannerRefreshKey: number;
  setBannerRefreshKey: React.Dispatch<React.SetStateAction<number>>;
  checkCurrentRoom: () => Promise<void>;
  checkGameExclusivity: (targetType: 'online' | 'offline') => Promise<boolean>;
  handleBannerResume: (gameInfo: ActiveGameInfo) => void;
  handleBannerLeave: (gameInfo: ActiveGameInfo, onDone?: () => void) => void;
  handleReplaceBotAndRejoin: (roomCode: string, onDone?: () => void) => void;
  handleTimerExpired: () => Promise<void>;
}

export function useActiveGameBanner(
  user: User | null | undefined,
  navigation: HomeNavProp
): UseActiveGameBannerResult {
  const [currentRoom, setCurrentRoom] = useState<string | null>(null);
  /** Ref that always holds the latest currentRoom so closures can read it */
  const currentRoomRef = useRef<string | null>(null);
  /** At most one scheduled re-check can be pending at a time. */
  const hasScheduledRecheckRef = useRef(false);
  /** Handle for the pending re-check so it can be cleared on unmount. */
  const recheckTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Tracks how many consecutive 'connected' responses we have seen from
   * get-rejoin-status when we expected to be disconnected. Drives the
   * exponential-backoff multi-retry cycle. Reset to 0 any time we get a
   * non-connected response or whenever checkCurrentRoom is called externally
   * (focus event, Realtime event).
   */
  const recheckAttemptRef = useRef(0);
  /**
   * Delays for the multi-retry cycle (milliseconds):
   * 1 s → 2 s → 4 s → 8 s → 16 s  (∼ 31 s total budget)
   * Covers the ~3 s mark-disconnected window AND the Phase A 30 s frequency.
   */
  const RECHECK_DELAYS_MS = [1000, 2000, 4000, 8000, 16000] as const;
  const voluntarilyLeftRoomsRef = useRef<Set<string>>(new Set());
  const storageLoadedRef = useRef<boolean>(false);
  /** Stable UUID for the room currently shown in banner, for voluntarily-left writes. */
  const currentRoomIdRef = useRef<string | null>(null);
  /** Stable ref to checkCurrentRoom so Realtime callback can always call the latest version. */
  const checkCurrentRoomRef = useRef<(() => Promise<void>) | null>(null);

  const [currentRoomStatus, setCurrentRoomStatus] = useState<'waiting' | 'playing' | undefined>(
    undefined
  );
  const [disconnectTimestamp, setDisconnectTimestamp] = useState<number | null>(null);
  const [canRejoinAfterExpiry, setCanRejoinAfterExpiry] = useState<boolean | null>(null);
  const [bannerRefreshKey, setBannerRefreshKey] = useState(0);

  // Keep currentRoomRef in sync with currentRoom state.
  useEffect(() => {
    currentRoomRef.current = currentRoom;
  }, [currentRoom]);

  // Clear any pending re-check on unmount.
  useEffect(() => {
    return () => {
      if (recheckTimeoutRef.current) {
        clearTimeout(recheckTimeoutRef.current);
      }
    };
  }, []);

  // Load voluntarily-left rooms from AsyncStorage so banner suppression survives restarts.
  useEffect(() => {
    AsyncStorage.getItem(VOLUNTARILY_LEFT_ROOMS_KEY)
      .then(raw => {
        if (raw) {
          try {
            const arr: string[] = JSON.parse(raw);
            voluntarilyLeftRoomsRef.current = new Set(arr);
          } catch {
            /* Ignore parse error — start fresh */
          }
        }
        storageLoadedRef.current = true;
      })
      .catch(() => {
        storageLoadedRef.current = true;
      });
  }, []);

  const checkCurrentRoom = useCallback(async () => {
    if (!user) return;

    // Ensure voluntarily-left set is loaded before evaluating banner suppression.
    if (!storageLoadedRef.current) {
      try {
        const raw = await AsyncStorage.getItem(VOLUNTARILY_LEFT_ROOMS_KEY);
        if (raw) {
          const arr: string[] = JSON.parse(raw);
          voluntarilyLeftRoomsRef.current = new Set(arr);
        }
      } catch {
        /* ignore — start fresh */
      }
      storageLoadedRef.current = true;
    }

    try {
      const { data, error } = await supabase
        .from('room_players')
        .select('room_id, rooms!inner(code, status)')
        .eq('user_id', user.id)
        .in('rooms.status', ['waiting', 'playing'])
        .single();

      if (error && error.code !== 'PGRST116') {
        // PGRST116 = no rows found (player not in any active room) — normal case,
        // fall through so roomData resolves to null below.
        // All other errors are unexpected; log and abort.
        roomLogger.error(
          'Error checking current room:',
          error?.message || error?.code || 'Unknown error'
        );
        return;
      }

      const roomData = data as RoomPlayerWithRoom | null;
      if (roomData?.rooms?.code) {
        if (voluntarilyLeftRoomsRef.current.has(roomData.room_id)) {
          roomLogger.info(
            `🚫 Suppressing banner for voluntarily-left room: ${roomData.rooms.code}`
          );
          setCurrentRoom(null);
          currentRoomIdRef.current = null;
          setCurrentRoomStatus(undefined);
          setDisconnectTimestamp(null);
          setCanRejoinAfterExpiry(null);
          return;
        }
        currentRoomIdRef.current = roomData.room_id;
        setCurrentRoom(roomData.rooms.code);
        setCurrentRoomStatus(roomData.rooms.status as 'waiting' | 'playing');
        if (roomData.rooms.status === 'playing') {
          // Optimistically apply the cached disconnect timestamp so the countdown
          // appears immediately without waiting for the get-rejoin-status round-trip.
          try {
            const cachedTs = await AsyncStorage.getItem(DISCONNECT_TIMER_KEY);
            if (cachedTs) {
              const ts = Number(cachedTs);
              const ageMs = Date.now() - ts;
              if (ageMs >= 0 && ageMs <= 65_000) {
                setDisconnectTimestamp(ts);
              } else {
                // Stale entry — discard so it doesn't flash an expired countdown.
                AsyncStorage.removeItem(DISCONNECT_TIMER_KEY).catch(() => {});
              }
            }
          } catch {
            // Ignore storage errors — fall back to server-side timestamp.
          }
          try {
            const { data: statusData } = await supabase.functions.invoke('get-rejoin-status', {
              body: { room_id: roomData.room_id },
            });
            if (statusData?.success) {
              if (statusData.status === 'disconnected' || statusData.disconnect_timer_active) {
                recheckAttemptRef.current = 0; // stop any pending retry cycle
                // 6.5: Unified single source of truth — always derive the anchor
                // from disconnect_timer_started_at when available. If the server
                // omits this field, fall back to seconds_left to approximate it.
                // Using one formula prevents subtle drift between the two paths.
                // Guard: if seconds_left is also absent, use null rather than
                // computing an anchor 60s in the past (which appears expired).
                const parsedDisconnectStartedAtMs = statusData.disconnect_timer_started_at
                  ? new Date(statusData.disconnect_timer_started_at).getTime()
                  : null;
                const serverAnchorMs = Number.isFinite(parsedDisconnectStartedAtMs)
                  ? Math.min(parsedDisconnectStartedAtMs as number, Date.now())
                  : typeof statusData.seconds_left === 'number'
                    ? Date.now() - (60 - statusData.seconds_left) * 1000
                    : null;
                setDisconnectTimestamp(serverAnchorMs);
              } else if (statusData.status === 'replaced_by_bot') {
                recheckAttemptRef.current = 0;
                AsyncStorage.removeItem(DISCONNECT_TIMER_KEY).catch(() => {});
                setDisconnectTimestamp(null);
                setCanRejoinAfterExpiry(true);
              } else if (statusData.status === 'room_closed') {
                recheckAttemptRef.current = 0;
                AsyncStorage.removeItem(DISCONNECT_TIMER_KEY).catch(() => {});
                setCurrentRoom(null);
                setCurrentRoomStatus(undefined);
                setDisconnectTimestamp(null);
                setCanRejoinAfterExpiry(null);
              } else {
                // 'connected' — mark-disconnected window may not have completed yet
                // (there's a brief async gap between stopHeartbeat and the server
                // committing 'disconnected'). The heartbeat neq-guard now prevents
                // the race from lasting >3 s, but we still need to wait it out.
                //
                // Strategy: keep the optimistic DISCONNECT_TIMER_KEY timestamp
                // (do NOT remove it; it drives the visible countdown). Schedule
                // retries at [1, 2, 4, 8, 16] s. Only clear the timestamp after
                // ALL retries are exhausted and the server still says 'connected'
                // (meaning the player is genuinely online, no disconnect happened).
                // Clear any existing pending retry before scheduling a new one to
                // prevent overlapping timeouts when checkCurrentRoom is called
                // concurrently (focus + Realtime + retry).
                if (recheckTimeoutRef.current) {
                  clearTimeout(recheckTimeoutRef.current);
                  recheckTimeoutRef.current = null;
                  hasScheduledRecheckRef.current = false;
                }
                const attempt = recheckAttemptRef.current;
                if (attempt < RECHECK_DELAYS_MS.length) {
                  recheckAttemptRef.current = attempt + 1;
                  hasScheduledRecheckRef.current = true;
                  recheckTimeoutRef.current = setTimeout(() => {
                    recheckTimeoutRef.current = null;
                    hasScheduledRecheckRef.current = false;
                    if (currentRoomRef.current) {
                      checkCurrentRoomRef.current?.();
                    } else {
                      recheckAttemptRef.current = 0;
                    }
                  }, RECHECK_DELAYS_MS[attempt]);
                } else {
                  // All retries exhausted — player is genuinely connected (no disconnect).
                  recheckAttemptRef.current = 0;
                  AsyncStorage.removeItem(DISCONNECT_TIMER_KEY).catch(() => {});
                  setDisconnectTimestamp(null);
                }
              }
            }
          } catch {
            // Network blip — leave disconnectTimestamp unchanged.
          }
        }
      } else {
        // Check if this player was replaced by a bot.
        try {
          const { data: replacedData, error: replacedDataError } = await supabase
            .from('room_players')
            .select('room_id, rooms!inner(code, status)')
            .eq('human_user_id', user.id)
            .eq('connection_status', 'replaced_by_bot')
            .in('rooms.status', ['playing'])
            .maybeSingle();

          if (replacedDataError) {
            // Transient network error or RLS issue — don't treat as "room closed".
            // Leave banner state unchanged so the user isn't incorrectly kicked out.
            roomLogger.error('Error checking replaced_by_bot status:', replacedDataError.message);
            return;
          }

          const rd = replacedData as {
            room_id: string;
            rooms: { code: string; status: string };
          } | null;
          if (rd?.rooms?.code) {
            if (voluntarilyLeftRoomsRef.current.has(rd.room_id)) {
              roomLogger.info(
                `🚫 Suppressing replaced-bot banner for voluntarily-left room: ${rd.rooms.code}`
              );
              setCurrentRoom(null);
              currentRoomIdRef.current = null;
              setCurrentRoomStatus(undefined);
              setDisconnectTimestamp(null);
              setCanRejoinAfterExpiry(null);
              return;
            }
            roomLogger.info(
              `🤖 Bot replaced player in room ${rd.rooms.code} — keeping rejoin banner`
            );
            currentRoomIdRef.current = rd.room_id;
            setCurrentRoom(rd.rooms.code);
            setCurrentRoomStatus('playing');
            setDisconnectTimestamp(null);
            setCanRejoinAfterExpiry(true);
          } else {
            // Before clearing the banner, confirm the room is actually finished.
            let shouldClear = true;
            const currentRoomSnapshot = currentRoomRef.current;
            if (currentRoomSnapshot) {
              try {
                const { data: roomCheck } = await supabase
                  .from('rooms')
                  .select('status')
                  .eq('code', currentRoomSnapshot)
                  .maybeSingle();
                if (roomCheck?.status === 'playing') {
                  shouldClear = false;
                }
              } catch {
                /* ignore */
              }
            }
            if (shouldClear) {
              setCurrentRoom(null);
              setCurrentRoomStatus(undefined);
              setDisconnectTimestamp(null);
              setCanRejoinAfterExpiry(null);
            }
          }
        } catch {
          setCurrentRoom(null);
          setCurrentRoomStatus(undefined);
          setDisconnectTimestamp(null);
          setCanRejoinAfterExpiry(null);
        }
      }
    } catch (error: unknown) {
      roomLogger.error(
        'Error in checkCurrentRoom:',
        error instanceof Error ? error.message : String(error)
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);
  // NOTE: disconnectTimestamp intentionally omitted from deps — including it would
  // recreate the callback on every countdown tick, causing useFocusEffect to
  // re-invoke checkCurrentRoom in a tight restart loop.

  // Keep checkCurrentRoomRef in sync so Realtime callbacks always call the latest version.
  useEffect(() => {
    checkCurrentRoomRef.current = checkCurrentRoom;
  }, [checkCurrentRoom]);

  // Realtime subscriptions: listen for this user's own room_players row changes.
  // Two filters are needed because a bot-replacement UPDATE changes user_id to the
  // bot's UUID (or NULL), so user_id=eq.${user.id} would not fire; the original
  // player is then stored in human_user_id. A second channel covers that case.
  //
  // Covers two scenarios that polling misses:
  //   1. Android: Phase A marks the player disconnected (30 s stale heartbeat) while
  //      HomeScreen is already focused — useFocusEffect won't fire again.
  //   2. Any platform: 'replaced_by_bot' fires while on HomeScreen.
  // On either event, reset the retry counter and re-run checkCurrentRoom so the
  // banner immediately shows the countdown or bot-replacement UI.
  useEffect(() => {
    if (!user?.id) return;

    const handleRoomPlayerUpdate = () => {
      // Any UPDATE to this user's room_players row — clear retry counter
      // (a server-delivered event supersedes the local retry cycle) and
      // re-run the full banner check.
      recheckAttemptRef.current = 0;
      if (recheckTimeoutRef.current) {
        clearTimeout(recheckTimeoutRef.current);
        recheckTimeoutRef.current = null;
        hasScheduledRecheckRef.current = false;
      }
      checkCurrentRoomRef.current?.();
    };

    // Channel 1: active seat (user_id = this user)
    const channel1 = supabase
      .channel(`banner_presence_${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'room_players',
          filter: `user_id=eq.${user.id}`,
        },
        handleRoomPlayerUpdate
      )
      .subscribe();

    // Channel 2: bot-replaced seat (human_user_id = this user, user_id changed to bot)
    const channel2 = supabase
      .channel(`banner_human_${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'room_players',
          filter: `human_user_id=eq.${user.id}`,
        },
        handleRoomPlayerUpdate
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel1);
      supabase.removeChannel(channel2);
    };
  }, [user?.id]);

  // Refresh banner state every time HomeScreen regains focus.
  useFocusEffect(
    useCallback(() => {
      // Reset retry counter on every focus event so external calls always
      // get a fresh check (not a continuation of a stale retry cycle).
      recheckAttemptRef.current = 0;
      checkCurrentRoom();
    }, [checkCurrentRoom])
  );

  const handleTimerExpired = useCallback(async () => {
    if (!user || !currentRoom) return;

    // Null disconnectTimestamp immediately so the countdown effect cannot re-fire.
    setDisconnectTimestamp(null);

    // Trigger an immediate server-side sweep at the 60s mark.
    try {
      const roomCode = currentRoomRef.current;
      if (roomCode) {
        const { data: disconnRow } = await supabase
          .from('room_players')
          .select('id, room_id, rooms!inner(code)')
          .eq('user_id', user.id)
          .eq('connection_status', 'disconnected')
          .eq('rooms.code', roomCode)
          .maybeSingle();
        if (disconnRow?.id && disconnRow?.room_id) {
          // sweep_only=true: skip the heartbeat UPDATE so Phase B can still detect us.
          supabase.functions
            .invoke('update-heartbeat', {
              body: { room_id: disconnRow.room_id, player_id: disconnRow.id, sweep_only: true },
            })
            .catch(() => {
              /* non-fatal */
            });
        }
      }
    } catch {
      /* Non-fatal */
    }

    // Poll for the replaced_by_bot row. With the forced sweep this should be ~2s.
    const MAX_ATTEMPTS = 9;
    const FIRST_POLL_MS = 2000;
    const POLL_INTERVAL_MS = 4000;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      await new Promise(resolve =>
        setTimeout(resolve, attempt === 0 ? FIRST_POLL_MS : POLL_INTERVAL_MS)
      );
      try {
        const { data: replacedRow } = await supabase
          .from('room_players')
          .select('id, rooms!inner(status)')
          .eq('human_user_id', user.id)
          .eq('connection_status', 'replaced_by_bot')
          .maybeSingle();
        if (replacedRow) {
          const roomStatus = (replacedRow as { rooms?: { status?: string } }).rooms?.status;
          if (!roomStatus || roomStatus === 'finished') {
            setCurrentRoom(null);
            setCurrentRoomStatus(undefined);
            setCanRejoinAfterExpiry(null);
          } else {
            setCanRejoinAfterExpiry(true);
          }
          return;
        }
      } catch {
        /* keep polling */
      }
    }

    // After MAX_ATTEMPTS the replaced row still isn't there — keep banner open.
    try {
      const { data: replacedFinal } = await supabase
        .from('room_players')
        .select('id, rooms!inner(status)')
        .eq('human_user_id', user.id)
        .eq('connection_status', 'replaced_by_bot')
        .maybeSingle();
      if (!replacedFinal) {
        try {
          const { data: roomCheck } = await supabase
            .from('rooms')
            .select('status')
            .eq('code', currentRoom)
            .maybeSingle();
          if (roomCheck?.status === 'playing') {
            setCanRejoinAfterExpiry(true);
            return;
          }
        } catch {
          /* ignore */
        }
        setCurrentRoom(null);
        setCurrentRoomStatus(undefined);
        setCanRejoinAfterExpiry(null);
      } else {
        const roomStatus = (replacedFinal as { rooms?: { status?: string } }).rooms?.status;
        if (!roomStatus || roomStatus === 'finished') {
          setCurrentRoom(null);
          setCurrentRoomStatus(undefined);
          setCanRejoinAfterExpiry(null);
        } else {
          setCanRejoinAfterExpiry(true);
        }
      }
    } catch {
      /* Safe fallback — keep banner state as is */
    }
  }, [user, currentRoom]);

  const handleLeaveCurrentRoom = useCallback(
    async (onDone?: () => void) => {
      if (!user || !currentRoom) {
        onDone?.();
        return;
      }

      showConfirm({
        title: i18n.t('home.leaveRoomConfirm'),
        message: `${i18n.t('home.leave')} ${currentRoom}?`,
        confirmText: i18n.t('home.leave'),
        cancelText: i18n.t('common.cancel'),
        destructive: true,
        onCancel: onDone,
        onConfirm: async () => {
          try {
            roomLogger.info(`🚪 Leaving room ${currentRoom}...`);
            const { data: membership, error: membershipQueryError } = await supabase
              .from('room_players')
              .select('room_id, rooms!inner(status)')
              .eq('user_id', user.id)
              .eq('rooms.code', currentRoom)
              .maybeSingle();
            const roomStatus = (membership?.rooms as unknown as { status: string } | null)?.status;
            const treatAsPlaying =
              !!membershipQueryError || !membership || roomStatus === 'playing';

            if (treatAsPlaying) {
              if (membership?.room_id) {
                const { error: invokeError } = await supabase.functions.invoke(
                  'mark-disconnected',
                  {
                    body: { room_id: membership.room_id },
                  }
                );
                if (invokeError) throw invokeError;
                // Do NOT delete the room_players row here. The server expects it to remain with
                // connection_status='disconnected' so process_disconnected_players can replace the
                // player with a bot and record stats (consistent with GameScreen cleanup logic).
                // VOLUNTARILY_LEFT_ROOMS_KEY suppression below prevents the banner from re-showing.
              } else {
                const { data: plainRows } = await supabase
                  .from('room_players')
                  .select('room_id')
                  .eq('user_id', user.id);
                if (plainRows && plainRows.length > 0) {
                  const roomIds = plainRows.map(r => r.room_id).filter(Boolean) as string[];
                  const { data: roomStatuses } = await supabase
                    .from('rooms')
                    .select('id, status')
                    .in('id', roomIds);
                  const statusMap = new Map((roomStatuses ?? []).map(r => [r.id, r.status]));
                  const playingIds = roomIds.filter(
                    id => statusMap.get(id) === 'playing' || !statusMap.has(id)
                  );
                  const nonPlayingIds = roomIds.filter(
                    id => statusMap.has(id) && statusMap.get(id) !== 'playing'
                  );
                  if (nonPlayingIds.length > 0) {
                    await supabase
                      .from('room_players')
                      .delete()
                      .eq('user_id', user.id)
                      .in('room_id', nonPlayingIds);
                  }
                  if (playingIds.length > 0) {
                    await Promise.allSettled(
                      playingIds.map(id =>
                        supabase.functions.invoke('mark-disconnected', { body: { room_id: id } })
                      )
                    );
                  }
                }
              }
              roomLogger.info(
                '✅ Playing-room leave: mark-disconnected called — cron will close room and record stats'
              );
            } else {
              let deleteQuery = supabase.from('room_players').delete().eq('user_id', user.id);
              if (membership?.room_id) {
                deleteQuery = deleteQuery.eq('room_id', membership.room_id);
              }
              const { error } = await deleteQuery;
              if (error) throw error;
              roomLogger.info('✅ Successfully left room - auto-cleanup triggered');
            }

            showSuccess(i18n.t('home.leftRoom'));
            const stableRoomId = membership?.room_id ?? currentRoomIdRef.current;
            if (stableRoomId) {
              voluntarilyLeftRoomsRef.current.add(stableRoomId);
              currentRoomIdRef.current = null;
              const _leftArr = Array.from(voluntarilyLeftRoomsRef.current).slice(-20);
              voluntarilyLeftRoomsRef.current = new Set(_leftArr);
              AsyncStorage.setItem(VOLUNTARILY_LEFT_ROOMS_KEY, JSON.stringify(_leftArr)).catch(
                () => {}
              );
            } else {
              currentRoomIdRef.current = null;
            }
            setCurrentRoom(null);
            setCurrentRoomStatus(undefined);
            setDisconnectTimestamp(null);
            setCanRejoinAfterExpiry(null);

            if (!treatAsPlaying) {
              await checkCurrentRoom();
            }
          } catch (error: unknown) {
            roomLogger.error(
              'Error leaving room:',
              error instanceof Error ? error.message : String(error)
            );
            showError(i18n.t('lobby.leaveRoomError'));
          } finally {
            onDone?.();
          }
        },
      });
    },
    [user, currentRoom, checkCurrentRoom]
  );

  const handleBannerResume = useCallback(
    (gameInfo: ActiveGameInfo) => {
      if (gameInfo.type === 'online') {
        if (gameInfo.roomStatus === 'playing') {
          navigation.replace('Game', { roomCode: gameInfo.roomCode });
        } else {
          navigation.replace('Lobby', { roomCode: gameInfo.roomCode });
        }
      } else {
        navigation.navigate('Game', { roomCode: 'LOCAL_AI_GAME' });
      }
    },
    [navigation]
  );

  const handleBannerLeave = useCallback(
    (gameInfo: ActiveGameInfo, onDone?: () => void) => {
      if (gameInfo.type === 'online') {
        if (canRejoinAfterExpiry === true) {
          showConfirm({
            title: 'Leave Permanently?',
            message: 'A bot is playing for you. If you leave now you cannot rejoin this game.',
            confirmText: 'Leave Permanently',
            cancelText: 'Stay',
            destructive: true,
            onCancel: onDone,
            onConfirm: async () => {
              try {
                if (user) {
                  const { error: rpcError } = await supabase.rpc(
                    'delete_room_players_by_human_user_id',
                    {
                      human_user_id: user.id,
                    }
                  );
                  if (rpcError) {
                    roomLogger.error(
                      'Failed to delete room_players for permanent leave (RPC error)',
                      {
                        error: rpcError,
                        humanUserId: user.id,
                      }
                    );
                  }
                }
                const stablePermanentRoomId = currentRoomIdRef.current;
                if (stablePermanentRoomId) {
                  voluntarilyLeftRoomsRef.current.add(stablePermanentRoomId);
                  const _leftArr = Array.from(voluntarilyLeftRoomsRef.current).slice(-20);
                  voluntarilyLeftRoomsRef.current = new Set(_leftArr);
                  AsyncStorage.setItem(VOLUNTARILY_LEFT_ROOMS_KEY, JSON.stringify(_leftArr)).catch(
                    () => {}
                  );
                } else {
                  roomLogger.warn(
                    'Permanent leave without currentRoomIdRef set; not persisting voluntarily-left room',
                    {
                      gameInfoRoomCode: gameInfo.roomCode,
                    }
                  );
                }
                currentRoomIdRef.current = null;
                setCurrentRoom(null);
                setCurrentRoomStatus(undefined);
                setDisconnectTimestamp(null);
                setCanRejoinAfterExpiry(null);
              } finally {
                onDone?.();
              }
            },
          });
        } else {
          handleLeaveCurrentRoom(onDone);
        }
      } else {
        showConfirm({
          title: 'Discard Game?',
          message: 'Your offline game progress will be lost.',
          confirmText: 'Discard',
          cancelText: 'Cancel',
          destructive: true,
          onCancel: onDone,
          onConfirm: async () => {
            try {
              await AsyncStorage.removeItem('@stephanos_game_state');
              // Also remove legacy key so pre-rename saves don't resurface
              await AsyncStorage.removeItem('@big2_game_state');
              // Remove associated offline history (new + legacy) to prevent stale UI after discard
              await AsyncStorage.removeItem('@stephanos_score_history');
              await AsyncStorage.removeItem('@big2_score_history');
              await AsyncStorage.removeItem('@stephanos_play_history');
              await AsyncStorage.removeItem('@big2_play_history');
              setBannerRefreshKey(k => k + 1);
              showSuccess('Offline game discarded');
            } catch {
              showError('Failed to discard game');
            } finally {
              onDone?.();
            }
          },
        });
      }
    },
    [handleLeaveCurrentRoom, canRejoinAfterExpiry, user]
  );

  const handleReplaceBotAndRejoin = useCallback(
    (roomCode: string, onDone?: () => void): void => {
      // Guard: verify the room is still open before navigating.
      // In a 1-human + 3-bot room the server closes the room (status='finished')
      // instead of creating a replaced_by_bot row, so there is a window where the
      // countdown has expired and the button is visible but the room is already
      // closed — navigating without this check causes a native crash.
      void (async () => {
        try {
          const { data: roomCheck, error: roomCheckError } = await supabase
            .from('rooms')
            .select('status')
            .eq('code', roomCode)
            .maybeSingle();

          if (roomCheckError) {
            roomLogger.error(
              `[handleReplaceBotAndRejoin] DB error checking room ${roomCode}:`,
              roomCheckError.message
            );
            // Abort navigation on query error — proceeding optimistically risks entering a
            // closed/finished multiplayer room when the DB failure masks its actual status.
            showError(i18n.t('home.roomCheckError'));
            onDone?.();
            return;
          } else if (
            !roomCheck ||
            roomCheck.status === 'finished' ||
            roomCheck.status === 'ended'
          ) {
            roomLogger.info(
              `🚫 [handleReplaceBotAndRejoin] Room ${roomCode} is closed (status=${roomCheck?.status ?? 'not found'}) — aborting navigation`
            );
            showError(i18n.t('home.roomClosedError'));
            // Clear banner so the stale entry is removed immediately
            currentRoomIdRef.current = null;
            setCurrentRoom(null);
            setCurrentRoomStatus(undefined);
            setDisconnectTimestamp(null);
            setCanRejoinAfterExpiry(null);
            onDone?.();
            return;
          }
        } catch {
          // Network error — abort navigation to avoid entering a potentially closed room.
          // Proceeding optimistically here undermines the crash-prevention goal of this guard.
          roomLogger.error(
            `[handleReplaceBotAndRejoin] Network error checking room ${roomCode} — aborting navigation`
          );
          showError(i18n.t('home.roomCheckError'));
          onDone?.();
          return;
        }

        roomLogger.info(`🔄 Replacing bot and rejoining game: ${roomCode}`);
        setDisconnectTimestamp(null);
        setCanRejoinAfterExpiry(null);
        navigation.replace('Game', { roomCode });
        // onDone is intentionally NOT called here: navigation.replace unmounts this screen,
        // making the isRejoining reset unnecessary (and potentially a no-op).
      })();
    },
    [navigation]
  );

  const checkGameExclusivity = useCallback(
    async (targetType: 'online' | 'offline'): Promise<boolean> => {
      try {
        let stateJson = await AsyncStorage.getItem('@stephanos_game_state');
        // One-time migration: check legacy @big2_game_state if new key is absent
        if (!stateJson) {
          const legacyJson = await AsyncStorage.getItem('@big2_game_state');
          if (legacyJson) {
            await AsyncStorage.setItem('@stephanos_game_state', legacyJson);
            await AsyncStorage.removeItem('@big2_game_state');
            stateJson = legacyJson;
          }
        }
        if (stateJson) {
          const state = JSON.parse(stateJson);
          if (state && !state.gameOver && state.gameStarted && !state.gameEnded) {
            if (targetType === 'offline') {
              return new Promise<boolean>(resolve => {
                showConfirm({
                  title: 'Game In Progress',
                  message: 'You have an offline game in progress. Discard it and start a new one?',
                  confirmText: 'Discard & Start New',
                  cancelText: 'Resume Current Game',
                  destructive: true,
                  onConfirm: async () => {
                    try {
                      await AsyncStorage.removeItem('@stephanos_game_state');
                      await AsyncStorage.removeItem('@big2_game_state');
                      await AsyncStorage.removeItem('@stephanos_score_history');
                      await AsyncStorage.removeItem('@big2_score_history');
                      await AsyncStorage.removeItem('@stephanos_play_history');
                      await AsyncStorage.removeItem('@big2_play_history');
                      setBannerRefreshKey(k => k + 1);
                    } catch {
                      /* ignore storage errors — discard proceeds regardless */
                    } finally {
                      resolve(true);
                    }
                  },
                  onCancel: () => {
                    navigation.navigate('Game', { roomCode: 'LOCAL_AI_GAME' });
                    resolve(false);
                  },
                });
              });
            } else {
              return new Promise<boolean>(resolve => {
                showConfirm({
                  title: 'Game In Progress',
                  message:
                    'You have an offline game in progress. You must leave it before joining an online game.',
                  confirmText: 'Discard Offline Game',
                  cancelText: 'Resume Offline Game',
                  destructive: true,
                  onConfirm: async () => {
                    try {
                      await AsyncStorage.removeItem('@stephanos_game_state');
                      await AsyncStorage.removeItem('@big2_game_state');
                      await AsyncStorage.removeItem('@stephanos_score_history');
                      await AsyncStorage.removeItem('@big2_score_history');
                      await AsyncStorage.removeItem('@stephanos_play_history');
                      await AsyncStorage.removeItem('@big2_play_history');
                      setBannerRefreshKey(k => k + 1);
                    } catch {
                      /* ignore storage errors — discard proceeds regardless */
                    } finally {
                      resolve(true);
                    }
                  },
                  onCancel: () => {
                    navigation.navigate('Game', { roomCode: 'LOCAL_AI_GAME' });
                    resolve(false);
                  },
                });
              });
            }
          }
        }
      } catch {
        /* AsyncStorage read failed — proceed */
      }

      if (user && targetType === 'offline' && currentRoom) {
        return new Promise<boolean>(resolve => {
          showConfirm({
            title: 'Game In Progress',
            message: `You are in online room ${currentRoom}. You must leave it before starting an offline game.`,
            confirmText: 'Leave Online Room',
            cancelText: 'Go to Room',
            destructive: true,
            onConfirm: async () => {
              try {
                const { data: membershipCheck, error: membershipError } = await supabase
                  .from('room_players')
                  .select('room_id, rooms!inner(status)')
                  .eq('user_id', user.id)
                  .eq('rooms.code', currentRoom)
                  .maybeSingle();
                const currentStatus = (
                  membershipCheck?.rooms as unknown as { status: string } | null
                )?.status;
                const shouldTreatAsPlaying =
                  !!membershipError || !membershipCheck || currentStatus === 'playing';
                if (shouldTreatAsPlaying) {
                  if (membershipCheck?.room_id) {
                    const { error: invokeError } = await supabase.functions.invoke(
                      'mark-disconnected',
                      {
                        body: { room_id: membershipCheck.room_id },
                      }
                    );
                    if (invokeError) throw invokeError;
                  } else {
                    const { data: plainRows } = await supabase
                      .from('room_players')
                      .select('room_id')
                      .eq('user_id', user.id);
                    if (plainRows && plainRows.length > 0) {
                      await Promise.allSettled(
                        plainRows.map(r =>
                          supabase.functions.invoke('mark-disconnected', {
                            body: { room_id: r.room_id },
                          })
                        )
                      );
                    }
                  }
                } else {
                  let deleteQuery = supabase.from('room_players').delete().eq('user_id', user.id);
                  if (membershipCheck?.room_id) {
                    deleteQuery = deleteQuery.eq('room_id', membershipCheck.room_id);
                  }
                  const { error: deleteError } = await deleteQuery;
                  if (deleteError) throw deleteError;
                }
                setCurrentRoom(null);
                setCurrentRoomStatus(undefined);
                setDisconnectTimestamp(null);
                if (!shouldTreatAsPlaying) await checkCurrentRoom();
                resolve(true);
              } catch {
                showError('Failed to leave the room. Try again.');
                resolve(false);
              }
            },
            onCancel: () => {
              navigation.replace('Lobby', { roomCode: currentRoom });
              resolve(false);
            },
          });
        });
      }

      return true;
    },
    [user, currentRoom, navigation, checkCurrentRoom]
  );

  return {
    currentRoom,
    setCurrentRoom,
    currentRoomStatus,
    disconnectTimestamp,
    canRejoinAfterExpiry,
    bannerRefreshKey,
    setBannerRefreshKey,
    checkCurrentRoom,
    checkGameExclusivity,
    handleBannerResume,
    handleBannerLeave,
    handleReplaceBotAndRejoin,
    handleTimerExpired,
  };
}
