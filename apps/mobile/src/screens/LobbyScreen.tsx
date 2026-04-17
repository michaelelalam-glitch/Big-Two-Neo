import React, { useCallback, useEffect, useState, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  FlatList,
  Modal,
  Share,
  Alert,
  BackHandler,
  useWindowDimensions,
} from 'react-native';
import { useNavigation, useRoute, useFocusEffect, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, SPACING, FONT_SIZES, MODAL_SUPPORTED_ORIENTATIONS } from '../constants';
import { useAuth } from '../contexts/AuthContext';
import { i18n } from '../i18n';
import { RootStackParamList } from '../navigation/AppNavigator';
import { notifyGameStarted, notifyRoomInvite } from '../services/pushNotificationTriggers';
import { supabase } from '../services/supabase';
import { showError, showConfirm, extractErrorMessage } from '../utils';
import { roomLogger } from '../utils/logger';
import { AddFriendButton } from '../components/friends';
import { useFriendsContext } from '../contexts/FriendsContext';
import { useUnlockOrientationOnIos } from '../hooks/useUnlockOrientationOnIos';

type LobbyScreenRouteProp = RouteProp<RootStackParamList, 'Lobby'>;
type LobbyScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Lobby'>;

interface Player {
  id: string;
  user_id: string | null; // null for bot rows
  player_index: number;
  is_ready: boolean | null; // DB column has no NOT NULL constraint
  is_bot: boolean | null; // DB column has no NOT NULL constraint
  is_host: boolean | null; // DB column has no NOT NULL constraint
  profiles?: {
    username?: string;
  };
}

/**
 * Room type classification - exactly one of these flags should be true at a time.
 * Represents mutually exclusive room categories based on matchmaking and ranked flags.
 */
interface RoomType {
  isPrivate: boolean; // Private room (not matchmaking, not public)
  isCasual: boolean; // Casual matchmaking (matchmaking + not ranked)
  isRanked: boolean; // Ranked matchmaking (matchmaking + ranked)
}

export default function LobbyScreen() {
  const navigation = useNavigation<LobbyScreenNavigationProp>();
  const route = useRoute<LobbyScreenRouteProp>();
  const { roomCode, joining = false } = route.params;
  const { user, profile } = useAuth();
  const { friends, onlineUserIds } = useFriendsContext();

  // Landscape detection for responsive overlay
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  // On iOS, release any portrait lock held by the game screen so the lobby
  // can auto-rotate in landscape.
  useUnlockOrientationOnIos(navigation);

  // Invite friends modal state
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [selectedFriendIds, setSelectedFriendIds] = useState<Set<string>>(new Set());
  const [isSendingInvites, setIsSendingInvites] = useState(false);

  const [players, setPlayers] = useState<Player[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isReady, setIsReady] = useState(false);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [roomType, setRoomType] = useState<RoomType>({
    isPrivate: false,
    isCasual: false,
    isRanked: false,
  });
  const [, setIsMatchmakingRoom] = useState(false);
  const [isTogglingReady, setIsTogglingReady] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isLeaving, setIsLeavingState] = useState(false);
  const [botDifficulty, setBotDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [isGameInProgress, setIsGameInProgress] = useState(false); // Room already 'playing' (rejoin)
  const isLeavingRef = useRef(false); // Prevent double navigation
  const lastConnectionStatusRef = useRef<string | null>(null); // Track for kicked-reason detection
  const isStartingRef = useRef(false); // Prevent duplicate start-game calls
  const isLeaveConfirmOpenRef = useRef(false); // Prevent stacked leave-confirmation dialogs
  const claimHostInFlightRef = useRef(false); // Prevent concurrent lobby_claim_host RPC calls
  const hasAttemptedJoinRef = useRef(false); // Prevent repeated join_room_atomic calls in invite-join flow
  const lastJoinRoomCodeRef = useRef<string | null>(null); // Track roomCode to reset guard on room change
  const roomIdRef = useRef<string | null>(null); // Stable ref so subscription callbacks don't use stale closure
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const loadPlayersRef = useRef<() => Promise<void>>(async () => {});
  const userIdRef = useRef<string | undefined>(undefined);

  // Performance optimization: Calculate human player count once using useMemo
  const humanPlayerCount = useMemo(() => players.filter(p => !p.is_bot).length, [players]);

  // All non-host, non-bot players must be ready before the host can start.
  // The host is not required to toggle ready — they are implicitly ready as the initiator.
  const allNonHostHumansReady = useMemo(
    () => players.filter(p => !p.is_bot && !p.is_host).every(p => p.is_ready),
    [players]
  );

  // Always keep loadPlayersRef and userIdRef pointing at latest values (avoids stale closures in subscriptions)
  useEffect(() => {
    loadPlayersRef.current = loadPlayers;
    userIdRef.current = user?.id;
  });

  useEffect(() => {
    loadPlayers();
    return subscribeToRoomsTable();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadPlayers and subscribeToRoomsTable intentionally excluded; correct trigger is roomCode
  }, [roomCode]);

  // Reset the invite-join guard whenever the user navigates to a different room
  // so a new deep-link invite is never incorrectly blocked.
  useEffect(() => {
    if (lastJoinRoomCodeRef.current !== roomCode) {
      lastJoinRoomCodeRef.current = roomCode;
      hasAttemptedJoinRef.current = false;
    }
  }, [roomCode]);

  // Cache of meaningful fields per player_index so the UPDATE handler can detect
  // real changes without relying on payload.old (which only contains REPLICA
  // IDENTITY columns: room_id + player_index). Without this cache, every
  // heartbeat-only update would either be missed (old approach) or force a
  // redundant reload.
  const playerFieldCacheRef = useRef<
    Map<number, { is_ready: unknown; is_host: unknown; is_bot: unknown; username: unknown }>
  >(new Map());

  // Set up filtered room_players subscription only once roomId is known.
  // Filtering by room_id prevents firing for other rooms' player changes (global subscription bug).
  useEffect(() => {
    if (!roomId) return;
    // Clear the field cache when roomId changes so stale data from the previous
    // room doesn't suppress legitimate reloads.
    playerFieldCacheRef.current.clear();

    // Always reload on INSERT and DELETE events (player joining, being kicked, or leaving).
    // Also listen for UPDATE events, but only trigger a reload when meaningful fields change
    // (host/ready/bot status, username).  Pure heartbeat updates
    // (e.g., last_seen_at only) are ignored to avoid noisy logs and
    // unnecessary re-renders on every 15-second heartbeat tick.
    const channel = supabase
      .channel(`lobby-players:${roomId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'room_players',
          filter: `room_id=eq.${roomId}`,
        },
        () => {
          loadPlayersRef.current();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'room_players',
          filter: `room_id=eq.${roomId}`,
        },
        () => {
          loadPlayersRef.current();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'room_players',
          filter: `room_id=eq.${roomId}`,
        },
        payload => {
          // Only reload for meaningful field changes (ready status, host, bot replacement).
          // Skip pure heartbeat updates (last_seen_at / last_heartbeat only) to avoid
          // console spam and unnecessary re-renders on every 15-second heartbeat tick.
          const n = payload.new as Record<string, unknown>;
          // Track the current user's connection_status so the kicked-player alert
          // can distinguish a disconnect kick from an inactivity kick.
          if (n.user_id === userIdRef.current && n.connection_status !== undefined) {
            lastConnectionStatusRef.current = n.connection_status as string;
          }
          // room_players uses REPLICA IDENTITY USING INDEX (room_id, player_index),
          // so payload.old only contains the indexed columns — never is_ready,
          // is_host, is_bot, or username. Compare payload.new against a local
          // cache of meaningful fields instead of relying on payload.old.
          const playerIdx = n.player_index as number;
          const incoming = {
            is_ready: n.is_ready,
            is_host: n.is_host,
            is_bot: n.is_bot,
            username: n.username,
          };
          const cached = playerFieldCacheRef.current.get(playerIdx);
          const meaningfulChange =
            !cached ||
            cached.is_ready !== incoming.is_ready ||
            cached.is_host !== incoming.is_host ||
            cached.is_bot !== incoming.is_bot ||
            cached.username !== incoming.username;
          playerFieldCacheRef.current.set(playerIdx, incoming);
          if (meaningfulChange) {
            loadPlayersRef.current();
          }
        }
      )
      // 8.2: Subscribe to rooms DELETE filtered by id (rooms DELETE events only carry
      // replica-identity/PK columns, so the code-eq filter in subscribeToRoomsTable
      // can't match them — this subscription uses id=eq.${roomId} which is always
      // present in DELETE payloads).
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'rooms',
          filter: `id=eq.${roomId}`,
        },
        () => {
          roomLogger.warn('[LobbyScreen] Room hard-deleted — navigating Home');
          if (!isLeavingRef.current) {
            isLeavingRef.current = true;
            navigation.replace('Home');
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- roomId is the correct trigger; loadPlayersRef is a stable ref
  }, [roomId]);

  // Lobby heartbeat — refreshes last_seen_at every 15 s so the server can distinguish
  // active players from ghosts (those who crashed/backgrounded without leaving).
  // Also triggers ghost eviction: lobby_evict_ghosts removes players with
  // last_seen_at > 60 s and the existing check_host_departure trigger promotes
  // the next human when a ghost host is evicted.
  useEffect(() => {
    if (!roomId || !user?.id) return;

    // Guard: skip a tick if the previous heartbeat+evict cycle is still running.
    // Prevents overlapping in-flight RPCs on slow networks. (Copilot r2953630203)
    let inFlight = false;

    const runHeartbeatAndEvict = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        // 1. Update this player's heartbeat
        const { error: heartbeatErr } = await supabase.rpc('update_player_heartbeat', {
          p_room_id: roomId,
          p_user_id: user.id,
        });
        if (heartbeatErr) {
          roomLogger.warn('[LobbyScreen] Heartbeat failed:', heartbeatErr.message);
        }

        // 2. Evict ghost players from this lobby (stale > 60 s)
        const { data: evicted, error: evictErr } = await supabase.rpc('lobby_evict_ghosts', {
          p_room_id: roomId,
        });
        if (evictErr) {
          roomLogger.warn('[LobbyScreen] Ghost eviction failed:', evictErr.message);
        } else if (evicted && evicted > 0) {
          roomLogger.info(`[LobbyScreen] 👻 Evicted ${evicted} ghost player(s) from lobby`);
        }
      } catch (err) {
        roomLogger.warn(
          '[LobbyScreen] Heartbeat/eviction request rejected:',
          extractErrorMessage(err)
        );
      } finally {
        inFlight = false;
      }
    };

    // Run immediately on mount so ghosts are evicted right away (not after 15 s).
    runHeartbeatAndEvict();
    const interval = setInterval(runHeartbeatAndEvict, 15_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, user?.id]);

  /**
   * Fetches the room id (and side-loads room metadata into state).
   * @param options.suppressNavigation – when true, skip all navigation side-effects
   *   so callers that only need the id (handleLeaveRoom, handleToggleReady,
   *   handleStartWithBots) do not accidentally redirect to Game/Home.
   */
  const getRoomId = async (options?: { suppressNavigation?: boolean }) => {
    const { data, error } = await supabase
      .from('rooms')
      .select('id, status, is_matchmaking, is_public, ranked_mode, host_id')
      .eq('code', roomCode)
      .single();

    if (error || !data) {
      roomLogger.info('[LobbyScreen] Room not found, navigating to Home (likely cleaned up)');
      // Silently navigate home instead of showing error
      // This happens when user leaves game and cleanup removes them from room
      if (!options?.suppressNavigation && !isLeavingRef.current) {
        isLeavingRef.current = true;
        navigation.replace('Home');
      }
      return null;
    }

    // Room already in progress — navigate directly to Game (no need to idle in lobby with Rejoin button).
    // When suppressNavigation is true (callers only need the id), return the id so they can proceed
    // rather than returning null which would cause them to bail out or navigate Home unexpectedly.
    if (data.status === 'playing') {
      if (!options?.suppressNavigation && !isLeavingRef.current) {
        isLeavingRef.current = true;
        navigation.replace('Game', { roomCode });
        return null;
      }
      // suppressNavigation=true: return id so the caller can use it
      return data.id;
    }

    // Handle ended/finished rooms: navigate home since the game is over.
    // Accept both 'ended' (legacy) and 'finished' (current complete-game Step 3b value).
    if (data.status === 'ended' || data.status === 'finished') {
      roomLogger.info('[LobbyScreen] Room ended — navigating Home');
      if (!options?.suppressNavigation && !isLeavingRef.current) {
        isLeavingRef.current = true;
        navigation.replace('Home');
      }
      return null;
    }

    // Set matchmaking status (backward compatibility)
    setIsMatchmakingRoom(data.is_matchmaking || false);

    // Determine room type
    let newRoomType: RoomType = {
      isPrivate: !data.is_matchmaking && !data.is_public,
      isCasual: !!data.is_matchmaking && !data.ranked_mode,
      isRanked: !!data.is_matchmaking && !!data.ranked_mode,
    };

    // Fallback: handle edge case where no room type is detected.
    // This occurs for public non-matchmaking rooms (is_public=true, is_matchmaking=false).
    // These are treated as "casual" rooms since they allow bot filling and aren't ranked.
    // Note: This is intentional - public rooms without matchmaking should behave like casual games.
    if (!newRoomType.isPrivate && !newRoomType.isCasual && !newRoomType.isRanked) {
      roomLogger.warn(
        '[LobbyScreen] Room type fallback applied - treating public non-matchmaking as casual',
        {
          code: roomCode,
          is_matchmaking: data.is_matchmaking,
          is_public: data.is_public,
          ranked_mode: data.ranked_mode,
        }
      );
      newRoomType = { isPrivate: false, isCasual: true, isRanked: false };
    }

    setRoomType(newRoomType);
    roomLogger.info('[LobbyScreen] Room type detected:', newRoomType);

    return data.id;
  };

  const loadPlayers = async () => {
    try {
      // Get roomId - prefer the stable ref (always current), fall back to state, then fetch
      let currentRoomId = roomIdRef.current || roomId;
      if (!currentRoomId) {
        currentRoomId = await getRoomId();
        if (!currentRoomId) return; // Room not found, getRoomId handles navigation
        roomIdRef.current = currentRoomId;
        setRoomId(currentRoomId);
      }

      // REMOVED: Console spam - subscription triggers this on every room_players change
      // roomLogger.info('[LobbyScreen] Loading players for room:', currentRoomId, 'user:', user?.id);

      // Use the username column to avoid N+1 query problem
      const { data, error } = await supabase
        .from('room_players')
        .select(
          `
          id,
          user_id,
          player_index,
          is_ready,
          is_bot,
          is_host,
          username
        `
        )
        .eq('room_id', currentRoomId)
        .order('player_index');

      if (error) {
        // Only log error message/code to avoid exposing DB internals
        roomLogger.error(
          '[LobbyScreen] Query error:',
          error?.message || error?.code || 'Unknown error'
        );
        throw error;
      }

      // Raw query data intentionally not logged (high-volume, triggers every reload)

      // Transform data to match Player interface (with profiles object for backward compatibility)
      const players = (data || []).map(player => ({
        ...player,
        profiles: player.username ? { username: player.username } : undefined,
      }));

      // ── Host reassignment fallback ──
      // lobby_host_leave and the check_host_departure trigger handle host
      // transfer atomically, so this block fires only in exceptional cases
      // (e.g. the host process crashed before calling lobby_host_leave).
      //
      // We intentionally avoid mutating the local player array here because
      // that would set currentUserPlayer.is_host = true below, enabling
      // host-only UI controls (start / kick) that will fail server-side;
      // the DB still shows no host until the RPC completes.
      //
      // Instead, call lobby_claim_host — a SECURITY DEFINER RPC that checks
      // last_seen_at to distinguish live vs. ghost hosts and promotes only the
      // first-human if eligible.  The Realtime subscription on room_players
      // will fire loadPlayers() once the DB reflects the new is_host=true row,
      // at which point the host-only UI appears with a valid server state.
      const hasActiveHost = players.some((p: Player) => p.is_host === true);
      if (!hasActiveHost && players.length > 0 && user?.id && !claimHostInFlightRef.current) {
        const humanPlayers = players.filter((p: Player) => !p.is_bot && p.user_id);
        const firstHuman = humanPlayers.sort(
          (a: Player, b: Player) => a.player_index - b.player_index
        )[0];
        if (firstHuman && firstHuman.user_id === user.id) {
          roomLogger.warn(
            '[LobbyScreen] ⚠️ No active host found — this client is first human, calling lobby_claim_host'
          );
          claimHostInFlightRef.current = true;
          // Wrap in async IIFE with try/finally because supabase.rpc() returns
          // a PromiseLike that may not implement .finally(), causing a TypeError.
          (async () => {
            let claimTimeoutId: ReturnType<typeof setTimeout> | undefined;
            try {
              // 8.4: Race the RPC against a 5-second timeout so that a hung
              // lobby_claim_host call does not keep claimHostInFlightRef=true
              // forever and permanently block future host-claim attempts.
              const rpcPromise = supabase.rpc('lobby_claim_host', {
                p_room_id: currentRoomId,
              });
              // Suppress unhandled rejection if timeoutPromise resolves first
              Promise.resolve(rpcPromise).catch(() => {});
              const timeoutPromise = new Promise<never>((_, reject) => {
                claimTimeoutId = setTimeout(
                  () => reject(new Error('lobby_claim_host timed out')),
                  5000
                );
              });
              const { data: claimData, error: claimErr } = await Promise.race([
                rpcPromise,
                timeoutPromise,
              ]);
              if (claimErr) {
                roomLogger.error('[LobbyScreen] lobby_claim_host failed:', claimErr.message);
              } else {
                roomLogger.info('[LobbyScreen] lobby_claim_host result:', claimData);
              }
            } catch (err) {
              roomLogger.error(
                '[LobbyScreen] lobby_claim_host rejected:',
                extractErrorMessage(err)
              );
            } finally {
              clearTimeout(claimTimeoutId);
              claimHostInFlightRef.current = false;
            }
          })();
          // Host UI will update via the room_players Realtime subscription once
          // the DB confirms is_host = true — no optimistic local mutation needed.
        }
      }

      setPlayers(players);

      // Seed the field cache from the loaded players so the first Realtime
      // UPDATE for each player_index doesn't trigger a redundant reload.
      for (const p of players) {
        playerFieldCacheRef.current.set(p.player_index, {
          is_ready: p.is_ready,
          is_host: p.is_host,
          is_bot: p.is_bot,
          username: p.username ?? (p.profiles?.username || null),
        });
      }

      // Check if current user is the host - MUST happen after data is fetched
      const currentUserPlayer = players.find(p => p.user_id === user?.id);
      if (currentUserPlayer) {
        const hostStatus = currentUserPlayer.is_host === true;
        roomLogger.info('[LobbyScreen] ✅ Current user found:', {
          user_id: user?.id,
          is_host: currentUserPlayer.is_host,
          player_index: currentUserPlayer.player_index,
        });
        setIsHost(hostStatus);
      } else {
        roomLogger.info('[LobbyScreen] ❌ Current user NOT found in players list!', {
          user_id: user?.id,
          all_user_ids: players.map(p => p.user_id),
        });
        setIsHost(false);

        // Kicked: if not in an invite-join flow the current user
        // has been removed from the room — show them who kicked them then
        // navigate home.
        // Guard: user?.id must be set — when AuthContext is still loading the
        // find() above returns undefined for every update, which would fire
        // this alert incorrectly for every player-list change.
        if (!joining && !isLeavingRef.current && user?.id) {
          const kickerHost = players.find(p => p.is_host === true);
          const hostName = kickerHost?.profiles?.username || 'Host';
          roomLogger.info('[LobbyScreen] Current user removed from room (kicked) by:', hostName);
          isLeavingRef.current = true;
          const lastConnectionStatus = lastConnectionStatusRef.current;
          let kickMessage: string;
          if (lastConnectionStatus === 'disconnected') {
            kickMessage = i18n.t('lobby.kickedDisconnectedMessage');
          } else if (kickerHost) {
            kickMessage = i18n.t('lobby.kickedByHostMessage', { hostName });
          } else {
            kickMessage = i18n.t('lobby.kickedInactivityMessage');
          }
          Alert.alert(
            i18n.t('lobby.kickedTitle'),
            kickMessage,
            [{ text: i18n.t('common.ok'), onPress: () => navigation.replace('Home') }],
            { cancelable: false }
          );
          return;
        }

        // Invite join: user arrived via a push notification / deep link and
        // hasn't called join_room_atomic yet — auto-join them now.
        // Guard with hasAttemptedJoinRef to prevent repeated RPC calls when
        // the realtime subscription fires while the join is in-flight.
        if (joining && user && !isLeavingRef.current && !hasAttemptedJoinRef.current) {
          hasAttemptedJoinRef.current = true;
          const username = profile?.username || user.email?.split('@')[0] || 'Player';
          roomLogger.info('[LobbyScreen] Invite join — auto-joining room as:', username);
          const { error: joinError } = await supabase.rpc('join_room_atomic', {
            p_room_code: roomCode,
            p_user_id: user.id,
            p_username: username,
          });
          if (joinError) {
            roomLogger.error('[LobbyScreen] Failed to join on invite:', joinError.message);
            hasAttemptedJoinRef.current = false; // allow retry on transient errors
            // Room may be full or no longer exist — fall back to Home
            if (!isLeavingRef.current) {
              isLeavingRef.current = true;
              navigation.replace('Home');
            }
          } else {
            // Clear the joining param so subsequent loadPlayers calls don't re-enter this branch
            navigation.setParams({ joining: false });
          }
          // loadPlayers will fire again via the realtime subscription
          return;
        }
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      const code =
        error instanceof Object && 'code' in error
          ? String((error as Record<string, unknown>).code)
          : '';
      roomLogger.error('[LobbyScreen] Error loading players:', msg);
      // Don't show alert if room was cleaned up (user left)
      // Just navigate home silently
      if (msg.includes('not found') || code === 'PGRST116') {
        roomLogger.info('[LobbyScreen] Room no longer exists, navigating home');
        if (!isLeavingRef.current) {
          isLeavingRef.current = true;
          navigation.replace('Home');
        }
      } else {
        showError(i18n.t('lobby.loadPlayersError'));
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Subscribes to rooms table UPDATE events for this room (status updates, etc.).
  // DELETE is handled separately in the useEffect([roomId]) block using an id-based
  // filter, because Postgres DELETE events only carry replica-identity (PK) columns
  // so a code=eq.${roomCode} filter would silently miss hard-deletes.
  // room_players changes are handled by a separate filtered subscription (see useEffect for roomId).
  const subscribeToRoomsTable = () => {
    roomLogger.info(`[LobbyScreen] Setting up rooms subscription for room: ${roomCode}`);
    const channel = supabase
      .channel(`lobby-rooms:${roomCode}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'rooms',
          filter: `code=eq.${roomCode}`,
        },
        (payload: {
          eventType?: string;
          old?: { status?: string };
          new?: { status?: string; code?: string };
        }) => {
          roomLogger.info('[LobbyScreen] Rooms table UPDATE event received:', {
            oldStatus: payload.old?.status,
            newStatus: payload.new?.status,
            roomCode: payload.new?.code,
            isLeaving: isLeavingRef.current,
          });

          // CRITICAL: Auto-navigate ALL players (including host) when game starts
          // Do NOT check isStartingRef - let subscription handle navigation for everyone
          if (payload.new?.status === 'playing' && !isLeavingRef.current) {
            roomLogger.info(
              '[LobbyScreen] Room status changed to playing, navigating ALL players to game...'
            );

            // CRITICAL FIX: Add a small delay to ensure game_state INSERT has propagated
            // The backend creates game_state BEFORE updating room status, but Realtime
            // subscriptions may receive events out of order. This 100ms delay ensures
            // the frontend's game_state subscription has time to receive the INSERT event.
            setTimeout(() => {
              // CRITICAL FIX: Pass forceNewGame: true to prevent loading stale cached game state
              // This ensures all players start with fresh state from server, not AsyncStorage.
              // Pass botDifficulty so the host's selected difficulty is preserved in stats.
              navigation.replace('Game', { roomCode, forceNewGame: true, botDifficulty });
            }, 100);
          }
        }
      )
      .subscribe((status, err) => {
        roomLogger.info(
          `[LobbyScreen] Rooms subscription status: ${status}`,
          err ? { error: err } : {}
        );
      });

    return () => {
      roomLogger.info(`[LobbyScreen] Unsubscribing from rooms channel: ${roomCode}`);
      supabase.removeChannel(channel);
    };
  };

  const handleToggleReady = async () => {
    if (isTogglingReady) return;

    try {
      setIsTogglingReady(true);
      const currentRoomId = roomId || (await getRoomId({ suppressNavigation: true }));
      if (!currentRoomId) return;
      if (!user?.id) {
        roomLogger.error('Cannot toggle ready: no authenticated user');
        return;
      }

      const { error } = await supabase
        .from('room_players')
        .update({ is_ready: !isReady })
        .eq('room_id', currentRoomId)
        .eq('user_id', user.id);

      if (error) throw error;
      setIsReady(!isReady);
    } catch (error: unknown) {
      roomLogger.error(
        'Error toggling ready:',
        error instanceof Error ? error.message : String(error)
      );
      showError(i18n.t('lobby.readyStatusError'));
    } finally {
      setIsTogglingReady(false);
    }
  };

  const handleShareCode = async () => {
    try {
      // We rely on try-catch to detect platform limitations (e.g., ERR_UNSUPPORTED_ACTIVITY on web).
      const deepLink = `stephanos://lobby/${roomCode}?joining=true`;
      const baseMessage =
        i18n.t('lobby.shareMessage', { roomCode }) ||
        `Join my Stephanos game! Room code: ${roomCode}`;
      await Share.share({
        message: `${baseMessage}\n${deepLink}`,
        title: i18n.t('lobby.shareTitle') || 'Join Stephanos Game',
        url: deepLink, // iOS: shown in share sheet separately
      });
    } catch (error: unknown) {
      // User dismissed the share dialog - this is normal behavior, don't show error
      const errorMsg = (error instanceof Error ? error.message : '').toLowerCase();
      const errorCode = (
        error instanceof Object && 'code' in error
          ? String((error as Record<string, unknown>).code)
          : ''
      ).toLowerCase();
      const errorName = (error instanceof Error ? error.name : '').toLowerCase();

      if (
        errorMsg.includes('cancel') ||
        errorMsg.includes('dismiss') ||
        errorCode === 'abort' ||
        errorName === 'abort' ||
        errorName === 'aborterror'
      ) {
        roomLogger.info('[LobbyScreen] User dismissed share dialog');
        return;
      }

      // Actual error occurred
      roomLogger.error(
        'Error sharing room code:',
        error instanceof Error ? error.message : String(error)
      );
      Alert.alert(
        i18n.t('lobby.shareError') || 'Unable to share',
        i18n.t('lobby.shareErrorMessage') ||
          'There was a problem sharing the room code. You can copy and share it manually.'
      );
    }
  };

  /** Invite selected friends to the room via push notification */
  const handleSendFriendInvites = async () => {
    if (selectedFriendIds.size === 0) return;
    setIsSendingInvites(true);
    try {
      // Resolve roomId via DB lookup rather than falling back to empty string,
      // which would break deep-link navigation in the push payload.
      const resolvedRoomId = roomId || (await getRoomId({ suppressNavigation: true }));
      if (!resolvedRoomId) {
        showError(i18n.t('lobby.roomNotFound') || 'Room not found — cannot send invites');
        return;
      }
      const senderName = profile?.username || user?.email || i18n.t('friends.unknownPlayer');
      // Batch all invites into a single edge function call to avoid
      // N separate auth/DB round-trips and reduce rate-limit risk.
      await notifyRoomInvite(Array.from(selectedFriendIds), roomCode, resolvedRoomId, senderName);
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSendingInvites(false);
      setShowInviteModal(false);
      setSelectedFriendIds(new Set());
    }
  };

  /** Toggle a friend's selection in the invite modal */
  const toggleFriendSelection = (friendUserId: string) => {
    setSelectedFriendIds(prev => {
      const next = new Set(prev);
      if (next.has(friendUserId)) {
        next.delete(friendUserId);
      } else {
        next.add(friendUserId);
      }
      return next;
    });
  };

  // Friends who are not already in the room, sorted by online > favorites > alphabetical
  const invitableFriends = friends
    .filter(f => !players.some(p => p.user_id === f.friend.id))
    .sort((a, b) => {
      const aOnline = onlineUserIds.has(a.friend.id) ? 1 : 0;
      const bOnline = onlineUserIds.has(b.friend.id) ? 1 : 0;
      if (bOnline !== aOnline) return bOnline - aOnline;
      const aFav = a.is_favorite ? 1 : 0;
      const bFav = b.is_favorite ? 1 : 0;
      if (bFav !== aFav) return bFav - aFav;
      return (a.friend.username || '').localeCompare(b.friend.username || '');
    });

  const handleStartWithBots = async () => {
    if (isStarting || isStartingRef.current) {
      roomLogger.info('⏭️ [LobbyScreen] Start already in progress, ignoring...');
      return;
    }

    // Guard: all non-host human players must be ready before the host can start
    const nonHostHumans = players.filter(p => !p.is_bot && !p.is_host);
    if (nonHostHumans.some(p => !p.is_ready)) {
      showError(i18n.t('lobby.notAllPlayersReady') || 'All players must be ready before starting');
      return;
    }

    try {
      isStartingRef.current = true;
      setIsStarting(true);
      const currentRoomId = roomId || (await getRoomId({ suppressNavigation: true }));
      if (!currentRoomId) {
        setIsStarting(false);
        isStartingRef.current = false;
        return;
      }
      if (!user?.id) {
        roomLogger.error('Cannot start with bots: no authenticated user');
        setIsStarting(false);
        isStartingRef.current = false;
        return;
      }

      // Get current user's room_player data
      const { data: roomPlayerData, error: roomPlayerError } = await supabase
        .from('room_players')
        .select('id, username, player_index, is_host')
        .eq('room_id', currentRoomId)
        .eq('user_id', user.id)
        .single();

      if (roomPlayerError || !roomPlayerData) {
        roomLogger.error(
          'Room player lookup error:',
          roomPlayerError?.message || roomPlayerError?.code || 'Unknown error'
        );
        showError(i18n.t('lobby.playerDataNotFound'));
        return;
      }

      // If the room already started, don't try to start again
      const { data: roomStatusData, error: roomStatusError } = await supabase
        .from('rooms')
        .select('status')
        .eq('id', currentRoomId)
        .single();
      if (!roomStatusError && roomStatusData?.status === 'playing') {
        roomLogger.info('[LobbyScreen] Room already playing; navigating to game');
        navigation.replace('Game', { roomCode, forceNewGame: true });
        setIsStarting(false);
        return;
      }

      // Host check: Only the host can start the game in ALL room types
      // Server-side RPC also enforces this (coordinator = first human player = host)
      if (!roomPlayerData.is_host) {
        showError(i18n.t('lobby.onlyHostCanStart'));
        setIsStarting(false);
        isStartingRef.current = false;
        return;
      }

      // CRITICAL: Determine bot count using humans (desired) AND current occupancy (safety)
      const humanCount = players.filter(p => !p.is_bot).length;
      const totalCount = players.length;
      const openSeats = Math.max(0, 4 - totalCount);

      // The RPC historically expects "bot_count based on humans" (human + bot = 4)
      // but we must also handle rooms that already contain bots.
      const desiredBotCount = Math.max(0, 4 - humanCount);

      roomLogger.info(
        `🎮 [LobbyScreen] Starting game: ${humanCount} humans, ${totalCount}/4 filled, ${openSeats} open seats, desired bots=${desiredBotCount}`
      );

      if (totalCount > 4) {
        showError(i18n.t('lobby.tooManyPlayers'));
        setIsStarting(false);
        isStartingRef.current = false;
        return;
      }

      if (humanCount === 0) {
        showError(i18n.t('lobby.noPlayersError'));
        setIsStarting(false);
        isStartingRef.current = false;
        return;
      }

      // Call start_game_with_bots RPC function.
      // Navigation is handled by the rooms UPDATE realtime subscription when status becomes 'playing'.
      const { data: startResult, error: startError } = await supabase.rpc('start_game_with_bots', {
        p_room_id: currentRoomId,
        p_bot_count: desiredBotCount,
        p_bot_difficulty: botDifficulty,
      });

      if (startError) {
        throw new Error(`Failed to start game: ${startError.message}`);
      }

      // Narrow the Json RPC result to the expected shape
      type StartGameRpcResult = { success?: boolean; error?: string };
      const typedStartResult = startResult as StartGameRpcResult | null;
      if (!typedStartResult || typedStartResult.success !== true) {
        const errMsg = typedStartResult?.error || 'Failed to start game';
        throw new Error(errMsg);
      }

      roomLogger.info('✅ [LobbyScreen] Game started successfully:', startResult);

      // 🔔 Send push notification
      roomLogger.info('📤 Sending game start notification...');
      notifyGameStarted(currentRoomId, roomCode).catch(err =>
        roomLogger.error('❌ Failed to send game start notification:', err)
      );

      // DO NOT manually navigate - let Realtime subscription handle navigation for ALL players
      // The subscription will fire when room status changes to 'playing'
      // CRITICAL: Set isGameInProgress BEFORE clearing isStarting so the auto-start useEffect
      // (which depends on isStarting) cannot re-fire handleStartWithBots a second time.
      roomLogger.info(
        '⏳ [LobbyScreen] Waiting for Realtime subscription to navigate all players...'
      );
      setIsGameInProgress(true);
      setIsStarting(false);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      roomLogger.error('Error starting game:', msg);
      showError(msg || i18n.t('lobby.startGameError'));
      // Reset immediately on error
      setIsStarting(false);
    } finally {
      // Ensure ref is always reset
      isStartingRef.current = false;
    }
  };

  // Auto-start when the room is full (4 humans) and every non-host has pressed ready.
  // Applies to casual, private, and ranked rooms — no bots are needed.
  // Only the host's client fires start_game_with_bots; isStartingRef prevents double-firing.
  useEffect(() => {
    if (
      humanPlayerCount === 4 &&
      allNonHostHumansReady &&
      isHost &&
      !isStarting &&
      !isStartingRef.current &&
      !isGameInProgress
    ) {
      roomLogger.info(
        '[LobbyScreen] 🚀 Auto-starting: full room of 4 humans, all non-host players ready'
      );
      handleStartWithBots();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleStartWithBots is not memoised; isStartingRef is a stable ref
  }, [humanPlayerCount, allNonHostHumansReady, isHost, isStarting, isGameInProgress]);

  const handleLeaveRoom = () => {
    if (isLeavingRef.current || isLeaving || isLeaveConfirmOpenRef.current) return;
    // Auth must be loaded before opening the dialog — the RPC requires a valid
    // UUID and onConfirm would silently no-op without it.
    if (!user?.id) return;

    isLeaveConfirmOpenRef.current = true;
    showConfirm({
      title: i18n.t('lobby.confirmLeaveTitle'),
      message: isHost
        ? i18n.t('lobby.confirmLeaveHost')
        : isReady
          ? i18n.t('lobby.confirmLeaveReady')
          : i18n.t('lobby.confirmLeaveMessage'),
      confirmText: i18n.t('lobby.confirmLeaveYes'),
      cancelText: i18n.t('lobby.confirmLeaveNo'),
      destructive: true,
      cancelable: false,
      onConfirm: async () => {
        isLeaveConfirmOpenRef.current = false;
        if (!user) return; // auth not yet loaded — UUID arg would be undefined
        if (isLeavingRef.current) return;
        try {
          isLeavingRef.current = true;
          setIsLeavingState(true);

          const currentRoomId = roomId || (await getRoomId({ suppressNavigation: true }));
          if (!currentRoomId) {
            navigation.replace('Home');
            return;
          }

          if (isHost) {
            // Atomically transfer host to the next human player and remove the
            // leaving host. lobby_host_leave is SECURITY DEFINER so it can
            // update other players' rows and rooms.host_id — direct writes from
            // the client are blocked by RLS.
            const { error: leaveErr } = await supabase.rpc('lobby_host_leave', {
              p_room_id: currentRoomId,
              p_leaving_user_id: user.id,
            });
            if (leaveErr) throw leaveErr;
          } else {
            const { error } = await supabase
              .from('room_players')
              .delete()
              .eq('room_id', currentRoomId)
              .eq('user_id', user.id);
            if (error) throw error;
          }

          navigation.replace('Home');
        } catch (error: unknown) {
          roomLogger.error(
            'Error leaving room:',
            error instanceof Error ? error.message : String(error)
          );
          isLeavingRef.current = false;
          setIsLeavingState(false);
          showError(i18n.t('lobby.leaveRoomError'));
        }
      },
      onCancel: () => {
        isLeaveConfirmOpenRef.current = false;
      },
    });
  };

  // P16-L3: Intercept Android hardware back button to show leave confirmation
  // Use useFocusEffect so the handler only runs while this screen is focused,
  // preventing it from intercepting back presses on other stacked screens.
  const handleLeaveRoomRef = useRef(handleLeaveRoom);
  handleLeaveRoomRef.current = handleLeaveRoom;
  useFocusEffect(
    useCallback(() => {
      const onBackPress = () => {
        handleLeaveRoomRef.current();
        return true; // prevent default back navigation
      };
      const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () => sub.remove();
    }, [])
  );

  /**
   * Kick a human player from the lobby.
   * Only the host can kick, and only in private rooms (never casual or ranked).
   */
  const handleKickPlayer = (playerToKick: Player) => {
    if (!isHost || !roomType.isPrivate || !roomId) return;
    if (!user) return; // auth not yet loaded — UUID arg would be undefined
    // Bot rows have user_id = null — cannot kick via UUID-typed RPC arg
    if (!playerToKick.user_id) return;
    // Capture the validated user_id into a local const so async callback does not
    // rely on a non-null assertion and the guard is clearly visible to TypeScript.
    const kickedUserId = playerToKick.user_id;

    const displayName = playerToKick.profiles?.username || 'Player';
    showConfirm({
      title: i18n.t('lobby.kickPlayerTitle'),
      message: i18n.t('lobby.kickPlayerMessage', { name: displayName }),
      confirmText: i18n.t('lobby.kickPlayerConfirm'),
      cancelText: i18n.t('common.cancel'),
      destructive: true,
      cancelable: false,
      onConfirm: async () => {
        try {
          // lobby_kick_player is SECURITY DEFINER — direct DELETE from the client
          // is blocked by the "Players can leave rooms" RLS policy which only
          // allows a user to remove their OWN row.
          const { error } = await supabase.rpc('lobby_kick_player', {
            p_room_id: roomId,
            p_kicker_user_id: user.id,
            p_kicked_user_id: kickedUserId,
          });
          if (error) throw error;
          // Subscription will refresh the player list automatically
        } catch (error: unknown) {
          roomLogger.error(
            'Error kicking player:',
            error instanceof Error ? error.message : String(error)
          );
          showError(i18n.t('lobby.kickPlayerError'));
        }
      },
    });
  };

  const renderPlayer = ({ item, index: _index }: { item: Player | null; index: number }) => {
    if (!item) {
      return (
        <View style={[styles.playerCard, styles.emptySlot]}>
          <Text style={styles.emptyText}>{i18n.t('lobby.emptySlot')}</Text>
        </View>
      );
    }

    const isCurrentUser = item.user_id === user?.id;
    const displayName = item.is_bot
      ? `Bot ${item.player_index + 1}`
      : item.profiles?.username || 'Player';

    return (
      <View style={[styles.playerCard, isCurrentUser && styles.currentUserCard]}>
        <View style={styles.playerInfo}>
          {item.is_host && (
            <View style={styles.hostBadge}>
              <Text style={styles.hostText}>👑 HOST</Text>
            </View>
          )}
          <Text style={styles.playerName}>{displayName}</Text>
          {isCurrentUser && <Text style={styles.youLabel}>({i18n.t('lobby.you')})</Text>}
        </View>
        {/* Right-side badges: ready status + host kick button (private rooms only) */}
        <View style={styles.playerCardRight}>
          {item.is_ready && (
            <View style={styles.readyBadge}>
              <Text style={styles.readyText}>✓ {i18n.t('lobby.ready')}</Text>
            </View>
          )}
          {/* Add Friend button for human non-self players */}
          {!isCurrentUser && !item.is_bot && item.user_id && (
            <AddFriendButton targetUserId={item.user_id} compact />
          )}
          {isHost &&
            roomType.isPrivate &&
            !isCurrentUser &&
            !item.is_bot &&
            item.is_host !== true && (
              <TouchableOpacity style={styles.kickButton} onPress={() => handleKickPlayer(item)}>
                <Text style={styles.kickButtonText}>{i18n.t('lobby.kickPlayer')}</Text>
              </TouchableOpacity>
            )}
        </View>
      </View>
    );
  };

  // Create array of 4 slots, filling empty ones with null
  const playerSlots = Array.from(
    { length: 4 },
    (_, i) => players.find(p => p.player_index === i) || null
  );

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color={COLORS.white} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} testID="lobby-screen">
      {/* Invite Friends Modal */}
      <Modal
        visible={showInviteModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowInviteModal(false)}
        supportedOrientations={MODAL_SUPPORTED_ORIENTATIONS}
      >
        <View style={isLandscape ? styles.modalOverlayLandscape : styles.modalOverlay}>
          <View style={isLandscape ? styles.modalCardLandscape : styles.modalCard}>
            <Text style={styles.modalTitle}>
              {i18n.t('friends.inviteFriends') || 'Invite Friends'}
            </Text>
            <Text style={styles.modalSubtitle}>
              {i18n.t('lobby.roomCode')}: {roomCode}
            </Text>
            {invitableFriends.length === 0 ? (
              <Text style={styles.emptyText}>
                {i18n.t('friends.noFriendsToInvite') ||
                  'All your friends are already in this room.'}
              </Text>
            ) : (
              <FlatList
                data={invitableFriends}
                keyExtractor={item => item.id}
                style={styles.friendListContainer}
                renderItem={({ item }) => {
                  const isOnline = onlineUserIds.has(item.friend.id);
                  return (
                    <TouchableOpacity
                      style={[
                        styles.friendInviteRow,
                        selectedFriendIds.has(item.friend.id) && styles.friendInviteRowSelected,
                      ]}
                      onPress={() => toggleFriendSelection(item.friend.id)}
                    >
                      <View style={styles.friendInviteAvatar}>
                        <Text style={styles.friendInviteAvatarText}>
                          {(item.friend.username ?? '?').slice(0, 2).toUpperCase()}
                        </Text>
                        {isOnline && <View style={styles.onlineDot} />}
                      </View>
                      <Text
                        style={[
                          styles.friendInviteName,
                          !isOnline && styles.friendInviteNameOffline,
                        ]}
                        numberOfLines={1}
                      >
                        {item.friend.username ?? i18n.t('friends.unknownPlayer')}
                      </Text>
                      {item.is_favorite && <Text style={styles.favoriteStar}>⭐</Text>}
                      <View
                        style={[
                          styles.friendInviteCheck,
                          selectedFriendIds.has(item.friend.id) && styles.friendInviteCheckSelected,
                        ]}
                      >
                        {selectedFriendIds.has(item.friend.id) && (
                          <Text style={styles.friendInviteCheckMark}>✓</Text>
                        )}
                      </View>
                    </TouchableOpacity>
                  );
                }}
              />
            )}
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnCancel]}
                onPress={() => {
                  setShowInviteModal(false);
                  setSelectedFriendIds(new Set());
                }}
              >
                <Text style={styles.modalBtnText}>{i18n.t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalBtn,
                  styles.modalBtnSend,
                  (selectedFriendIds.size === 0 || isSendingInvites) && styles.modalBtnDisabled,
                ]}
                onPress={handleSendFriendInvites}
                disabled={selectedFriendIds.size === 0 || isSendingInvites}
              >
                {isSendingInvites ? (
                  <ActivityIndicator size="small" color={COLORS.white} />
                ) : (
                  <Text style={styles.modalBtnText}>
                    {i18n.t('friends.sendInvite') || 'Send Invite'}
                    {selectedFriendIds.size > 0 ? ` (${selectedFriendIds.size})` : ''}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <View style={styles.header}>
        <TouchableOpacity
          style={[styles.leaveButton, isLeaving && styles.buttonDisabled]}
          onPress={handleLeaveRoom}
          disabled={isLeaving}
        >
          {isLeaving ? (
            <ActivityIndicator color={COLORS.white} size="small" />
          ) : (
            <Text style={styles.leaveButtonText}>← {i18n.t('lobby.leaveRoom')}</Text>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={true}
      >
        <View style={styles.content}>
          <Text style={styles.title}>{i18n.t('lobby.title')}</Text>

          {/* Room Type Badge - Color-coded by room type for visual distinction */}
          {/* Uses chained OR for clean fallback: evaluates left-to-right, stops at first truthy value */}
          <View style={[styles.roomTypeBadge]}>
            <Text style={styles.roomTypeBadgeText}>
              {(roomType.isRanked && i18n.t('lobby.rankedMatch')) ||
                (roomType.isCasual && `🎮 ${i18n.t('lobby.casualMatch')}`) ||
                (roomType.isPrivate && i18n.t('lobby.privateRoom')) ||
                i18n.t('lobby.title')}
            </Text>
          </View>

          {/* Room Code Card with Copy/Share */}
          <View style={styles.roomCodeCard}>
            <View style={styles.roomCodeHeader}>
              <Text style={styles.roomCodeLabel}>{i18n.t('lobby.roomCode')}:</Text>
              <Text style={styles.roomCode}>{roomCode}</Text>
            </View>
            <View style={styles.roomCodeActions}>
              <TouchableOpacity style={styles.roomCodeButton} onPress={handleShareCode}>
                <Text style={styles.roomCodeButtonText}>{i18n.t('lobby.share') || '📤 Share'}</Text>
              </TouchableOpacity>
              {invitableFriends.length > 0 && (
                <TouchableOpacity
                  style={[styles.roomCodeButton, styles.inviteButton]}
                  onPress={() => setShowInviteModal(true)}
                >
                  <Text style={styles.roomCodeButtonText}>
                    {i18n.t('friends.inviteFriends') || '👥 Invite Friends'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          <Text style={styles.playersLabel}>
            {i18n.t('lobby.players')} ({players.length}/4)
          </Text>

          <View style={styles.playerList}>
            {playerSlots.map((item, index) => (
              <View key={`player-slot-${index}`}>{renderPlayer({ item, index })}</View>
            ))}
          </View>

          {/* Rejoin Game button — shown when room is already 'playing' (rejoin scenario) */}
          {isGameInProgress ? (
            <TouchableOpacity
              style={styles.rejoinButton}
              onPress={() => navigation.replace('Game', { roomCode })}
            >
              <Text style={styles.rejoinButtonText}>🎮 Rejoin Game</Text>
            </TouchableOpacity>
          ) : (
            <>
              {/* The host does not need to toggle ready — only non-host human players do. */}
              {!isHost && (
                <TouchableOpacity
                  style={[
                    styles.readyButton,
                    isReady && styles.readyButtonActive,
                    isTogglingReady && styles.buttonDisabled,
                  ]}
                  onPress={handleToggleReady}
                  disabled={isTogglingReady}
                >
                  {isTogglingReady ? (
                    <ActivityIndicator color={COLORS.white} size="small" />
                  ) : (
                    <Text style={styles.readyButtonText}>
                      {isReady ? `✓ ${i18n.t('lobby.ready')}` : i18n.t('lobby.readyUp')}
                    </Text>
                  )}
                </TouchableOpacity>
              )}
            </>
          )}

          {/* Bot Filling Controls - Host only, for Casual/Private (NOT Ranked) */}
          {/* Hidden when game is already in progress (rejoin) since bots are already set */}
          {/* Performance: humanPlayerCount calculated once via useMemo */}
          {isHost && !roomType.isRanked && !isGameInProgress ? (
            <>
              {/* Show bot count and start button if less than 4 humans */}
              {humanPlayerCount < 4 && (
                <>
                  {/* Bot Difficulty Selector */}
                  <View style={styles.difficultyContainer}>
                    <Text style={styles.difficultyLabel}>{i18n.t('lobby.botDifficultyLabel')}</Text>
                    <View style={styles.difficultyButtons}>
                      {(['easy', 'medium', 'hard'] as const).map(level => (
                        <TouchableOpacity
                          key={level}
                          style={[
                            styles.difficultyButton,
                            botDifficulty === level && styles.difficultyButtonActive,
                          ]}
                          onPress={() => setBotDifficulty(level)}
                        >
                          <Text
                            style={[
                              styles.difficultyButtonText,
                              botDifficulty === level && styles.difficultyButtonTextActive,
                            ]}
                          >
                            {i18n.t(`lobby.${level}`)}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                </>
              )}

              {/* Start button: shown when bots are needed OR when 4 humans are all ready */}
              {/* Always visible for host so there's a manual fallback if auto-start misfires */}
              {(humanPlayerCount < 4 || allNonHostHumansReady) && (
                <TouchableOpacity
                  style={[
                    styles.startButton,
                    (isStarting || !allNonHostHumansReady) && styles.buttonDisabled,
                  ]}
                  onPress={handleStartWithBots}
                  disabled={isStarting || !allNonHostHumansReady}
                >
                  {isStarting ? (
                    <>
                      <ActivityIndicator color={COLORS.white} size="small" />
                      <Text style={[styles.startButtonText, { marginTop: 4 }]}>
                        {i18n.t('lobby.starting')}...
                      </Text>
                    </>
                  ) : humanPlayerCount >= 4 ? (
                    <Text style={styles.startButtonText}>🎮 Start Game</Text>
                  ) : (
                    <Text style={styles.startButtonText}>
                      {i18n.t('lobby.startWithBotsCount', {
                        count: 4 - humanPlayerCount,
                      }) || `🤖 Start with ${4 - humanPlayerCount} AI Bot(s)`}
                    </Text>
                  )}
                </TouchableOpacity>
              )}

              <Text style={styles.hostInfo}>
                {i18n.t('lobby.hostInfo') || 'Only the host can start the game'}
              </Text>
            </>
          ) : null}

          {/* Ranked mode - require 4 human players (no bots) */}
          {roomType.isRanked && (
            <View style={styles.rankedInfo}>
              <Text style={styles.rankedInfoText}>
                🏆 {i18n.t('lobby.rankedRequirement') || 'Ranked matches require 4 human players'}
              </Text>
              <Text style={styles.rankedInfoText}>
                {humanPlayerCount < 4
                  ? i18n.t('lobby.waitingForMorePlayers') || 'Waiting for more players...'
                  : isStarting
                    ? i18n.t('lobby.starting') + '...' || 'Starting...'
                    : allNonHostHumansReady
                      ? i18n.t('lobby.allReadyToStart') || 'All ready to start!'
                      : i18n.t('lobby.waitingForPlayers') || 'Waiting for players to ready up...'}
              </Text>
            </View>
          )}

          {/* Non-host players: show waiting message in all non-ranked rooms */}
          {!roomType.isRanked && !isHost && !isGameInProgress && (
            <Text style={styles.waitingInfo}>
              {humanPlayerCount === 4 && allNonHostHumansReady
                ? i18n.t('lobby.starting') + '...' || 'Starting...'
                : i18n.t('lobby.waitingForHost') || 'Waiting for host to start the game...'}
            </Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.primary,
  },
  header: {
    flexDirection: 'row',
    padding: SPACING.md,
    backgroundColor: COLORS.primary,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: SPACING.xl,
  },
  leaveButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  leaveButtonText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.md,
  },
  content: {
    flex: 1,
    padding: SPACING.lg,
  },
  title: {
    fontSize: FONT_SIZES.xxl,
    fontWeight: 'bold',
    color: COLORS.white,
    textAlign: 'center',
    marginBottom: SPACING.md,
  },
  roomTypeBadge: {
    alignSelf: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    backgroundColor: 'rgba(59, 130, 246, 0.3)',
    borderRadius: 12,
    marginBottom: SPACING.md,
  },
  roomTypeBadgeText: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    color: COLORS.white,
  },
  roomCodeCard: {
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    borderRadius: 12,
    padding: SPACING.lg,
    marginBottom: SPACING.xl,
    borderWidth: 2,
    borderColor: 'rgba(59, 130, 246, 0.4)',
  },
  roomCodeHeader: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  roomCodeActions: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  roomCodeButton: {
    backgroundColor: 'rgba(59, 130, 246, 0.3)',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: 8,
    minWidth: 100,
    marginHorizontal: SPACING.sm,
  },
  roomCodeButtonText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    textAlign: 'center',
  },
  roomCodeContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.xl,
    padding: SPACING.md,
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    borderRadius: 8,
  },
  roomCodeLabel: {
    fontSize: FONT_SIZES.md,
    color: COLORS.gray.medium,
    marginRight: SPACING.sm,
  },
  roomCode: {
    fontSize: FONT_SIZES.xl,
    fontWeight: 'bold',
    color: COLORS.white,
    letterSpacing: 2,
  },
  playersLabel: {
    fontSize: FONT_SIZES.lg,
    color: COLORS.white,
    marginBottom: SPACING.md,
  },
  playerList: {
    gap: SPACING.sm,
  },
  playerCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: SPACING.md,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  currentUserCard: {
    borderColor: '#3B82F6',
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
  },
  emptySlot: {
    opacity: 0.5,
  },
  playerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  hostBadge: {
    marginRight: SPACING.sm,
    backgroundColor: '#F59E0B',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  hostText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.xs,
    fontWeight: '700',
  },
  playerName: {
    fontSize: FONT_SIZES.md,
    color: COLORS.white,
    fontWeight: '600',
    marginRight: SPACING.sm,
  },
  // Note: youLabel gets marginRight even as last element for visual balance
  // Alternative would be conditional styling based on badge presence
  youLabel: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.gray.medium,
  },
  emptyText: {
    fontSize: FONT_SIZES.md,
    color: COLORS.gray.medium,
    fontStyle: 'italic',
  },
  readyBadge: {
    backgroundColor: '#10B981',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  readyText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
  },
  playerCardRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  kickButton: {
    backgroundColor: '#EF4444',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  kickButtonText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.xs,
    fontWeight: '700',
  },
  readyButton: {
    backgroundColor: '#3B82F6',
    padding: SPACING.lg,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: SPACING.xl,
  },
  readyButtonActive: {
    backgroundColor: '#10B981',
  },
  readyButtonText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.lg,
    fontWeight: 'bold',
  },
  rejoinButton: {
    backgroundColor: '#10B981',
    padding: SPACING.lg,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: SPACING.xl,
  },
  rejoinButtonText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.lg,
    fontWeight: 'bold',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  botFillingContainer: {
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
    padding: SPACING.md,
    borderRadius: 8,
    marginTop: SPACING.md,
  },
  botFillingLabel: {
    fontSize: FONT_SIZES.md,
    color: COLORS.white,
    textAlign: 'center',
    marginVertical: 2,
  },
  difficultyContainer: {
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    padding: SPACING.md,
    borderRadius: 8,
    marginTop: SPACING.sm,
    alignItems: 'center',
  },
  difficultyLabel: {
    fontSize: FONT_SIZES.md,
    color: COLORS.white,
    fontWeight: '600',
    marginBottom: SPACING.sm,
  },
  difficultyButtons: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  difficultyButton: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 2,
    borderColor: 'transparent',
    minWidth: 80,
    alignItems: 'center',
  },
  difficultyButtonActive: {
    backgroundColor: '#8B5CF6',
    borderColor: '#A78BFA',
  },
  difficultyButtonText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.white,
    fontWeight: '600',
  },
  difficultyButtonTextActive: {
    color: COLORS.white,
    fontWeight: '700',
  },
  startButton: {
    backgroundColor: '#8B5CF6',
    padding: SPACING.lg,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: SPACING.md,
  },
  startButtonText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.lg,
    fontWeight: 'bold',
  },
  rankedInfo: {
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    padding: SPACING.lg,
    borderRadius: 8,
    marginTop: SPACING.md,
  },
  rankedInfoText: {
    fontSize: FONT_SIZES.md,
    color: COLORS.white,
    textAlign: 'center',
    marginVertical: 4,
  },
  hostInfo: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.gray.medium,
    textAlign: 'center',
    marginTop: SPACING.md,
  },
  waitingInfo: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.gray.medium,
    textAlign: 'center',
    marginTop: SPACING.md,
    fontStyle: 'italic',
  },
  // Invite friends modal
  inviteButton: {
    backgroundColor: COLORS.secondary,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalOverlayLandscape: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCard: {
    backgroundColor: COLORS.background.dark,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: SPACING.lg,
    maxHeight: '70%',
  },
  modalCardLandscape: {
    backgroundColor: COLORS.background.dark,
    borderRadius: 16,
    padding: SPACING.lg,
    maxHeight: '90%',
    width: '65%',
  },
  modalTitle: {
    color: COLORS.white,
    fontSize: FONT_SIZES.lg,
    fontWeight: '700',
    marginBottom: SPACING.xs,
  },
  modalSubtitle: {
    color: COLORS.gray.text,
    fontSize: FONT_SIZES.sm,
    marginBottom: SPACING.md,
  },
  friendListContainer: {
    maxHeight: 300,
  },
  friendInviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.xs,
    borderRadius: 8,
    marginBottom: 4,
  },
  friendInviteRowSelected: {
    backgroundColor: 'rgba(74,144,226,0.15)',
  },
  friendInviteAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.secondary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.sm,
  },
  friendInviteAvatarText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.xs,
    fontWeight: '700',
  },
  friendInviteName: {
    flex: 1,
    color: COLORS.white,
    fontSize: FONT_SIZES.sm,
  },
  friendInviteNameOffline: {
    opacity: 0.5,
  },
  onlineDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#4CAF50',
    borderWidth: 2,
    borderColor: COLORS.primary,
  },
  favoriteStar: {
    fontSize: 14,
    marginRight: SPACING.xs,
  },
  friendInviteCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.gray.medium,
    justifyContent: 'center',
    alignItems: 'center',
  },
  friendInviteCheckSelected: {
    backgroundColor: COLORS.secondary,
    borderColor: COLORS.secondary,
  },
  friendInviteCheckMark: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '700',
  },
  modalActions: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginTop: SPACING.md,
  },
  modalBtn: {
    flex: 1,
    paddingVertical: SPACING.sm,
    borderRadius: 8,
    alignItems: 'center',
  },
  modalBtnCancel: {
    backgroundColor: COLORS.gray.dark,
  },
  modalBtnSend: {
    backgroundColor: COLORS.secondary,
  },
  modalBtnDisabled: {
    opacity: 0.4,
  },
  modalBtnText: {
    color: COLORS.white,
    fontWeight: '600',
    fontSize: FONT_SIZES.sm,
  },
});
