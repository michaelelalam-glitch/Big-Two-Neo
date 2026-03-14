/**
 * useDisconnectDetection — Disconnect state machine for MultiplayerGame.
 *
 * Extracted from MultiplayerGame.tsx as part of Audit H1 fix (#633).
 * Manages client-side disconnect detection, anchor computation, and enriches
 * layout players with turn-timer / disconnect-ring metadata.
 *
 * State machine transitions per remote player:
 *   connected → timeout_pending → disconnected → replaced_by_bot
 *
 * clientDisconnections state is committed via a single REPLACE action (with
 * equality guard) to avoid redundant re-renders.  Per-player anchor mutations
 * flow through clientDisconnectStartRef (avoids stale closures in the interval)
 * and are flushed to React state via REPLACE at the end of each tick.
 */

import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

import type {
  GameState as MultiplayerGameState,
  Player as MultiplayerPlayer,
} from '../types/multiplayer';
import { gameLogger } from '../utils/logger';
import type { LayoutPlayerWithScore } from './usePlayerDisplayData';

// ── Reducer ────────────────────────────────────────────────────────────────────
// Only REPLACE is dispatched: the interval and immediate-clear effect both
// build a full snapshot Map and commit it atomically at the end of each tick.
// The equality check prevents spurious re-renders when the map is unchanged.

type DisconnectMapAction = { type: 'REPLACE'; map: Map<number, string> };

function disconnectMapReducer(
  state: Map<number, string>,
  action: DisconnectMapAction,
): Map<number, string> {
  // Equality guard — avoids re-renders when map contents haven't changed
  // (common outcome for the 1s polling interval in a connected game).
  // Uses a plain for..of loop instead of [...entries()].every() to avoid
  // allocating a temporary array on every 1s tick dispatch.
  if (state.size === action.map.size) {
    let equal = true;
    for (const [k, v] of action.map) {
      if (state.get(k) !== v) { equal = false; break; }
    }
    if (equal) return state;
  }
  return action.map;
}

// ── Public types ───────────────────────────────────────────────────────────────

export interface EnrichedLayoutPlayer extends LayoutPlayerWithScore {
  /** ISO timestamp when the turn inactivity ring should start (non-null on active turn). */
  turnTimerStartedAt: string | null;
  /** Whether the connection-loss spinner should show (overrides server value). */
  isDisconnected: boolean;
  /** ISO anchor for the 60-second disconnect countdown ring. */
  disconnectTimerStartedAt: string | null;
  /** Fired when this player's countdown ring reaches zero. */
  onCountdownExpired: () => void;
}

interface UseDisconnectDetectionOptions {
  /** Live player rows from Supabase Realtime subscription.
   *  Typed as nullable to match the runtime reality — MultiplayerGame passes
   *  the value directly from useRealtime which can be null/undefined before
   *  the first subscription event arrives.
   */
  realtimePlayers: MultiplayerPlayer[] | null | undefined;
  /** Current authenticated user's id. */
  userId: string | undefined;
  /** Server-authoritative game state (may be null during reconnect re-fetches). */
  multiplayerGameState: MultiplayerGameState | null;
  /** Mutable ref tracking the freshest last_seen_at per player UUID from useRealtime. */
  playerLastSeenAtRef: { current: Record<string, string> };
  /** Immediately invoke process_disconnected_players() on the server. */
  forceSweep: () => void;
  /** From usePlayerDisplayData — includes totalScore per seat. */
  layoutPlayersWithScores: LayoutPlayerWithScore[];
  /** From useMultiplayerLayout — used to determine local player's seat index. */
  layoutPlayers: Array<{ player_index?: number; isActive: boolean }>;
  /** True while the RejoinModal is open. */
  showBotReplacedModal: boolean;
  /** True while useConnectionManager is executing a reconnect RPC. */
  isReconnecting: boolean;
  /** Opens the RejoinModal when the local player's countdown expires. */
  setShowBotReplacedModal: Dispatch<SetStateAction<boolean>>;
}

interface UseDisconnectDetectionReturn {
  /** layoutPlayersWithScores enriched with turn-timer and disconnect-ring fields. */
  enrichedLayoutPlayers: EnrichedLayoutPlayer[];
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useDisconnectDetection({
  realtimePlayers,
  userId,
  multiplayerGameState,
  playerLastSeenAtRef,
  forceSweep,
  layoutPlayersWithScores,
  layoutPlayers,
  showBotReplacedModal,
  isReconnecting,
  setShowBotReplacedModal,
}: UseDisconnectDetectionOptions): UseDisconnectDetectionReturn {

  // ── Client-side disconnect map ─────────────────────────────────────────────
  // Maps playerIndex → ISO anchor timestamp for the grey disconnect ring.
  // Committed atomically via a single REPLACE action (equality guard prevents
  // spurious re-renders). Per-player anchor mutations are staged in
  // clientDisconnectStartRef (avoids stale closures inside the interval
  // callback) and flushed to React state by dispatching REPLACE at the end
  // of each interval tick and inside the immediate-clear effect.
  const [clientDisconnections, dispatch] = useReducer(
    disconnectMapReducer,
    new Map<number, string>(),
  );

  // Ref mirror used inside interval + immediate-clear callbacks:
  // Avoids stale closures without adding state to interval deps.
  const clientDisconnectStartRef = useRef<Record<number, string>>({});

  // Holds the ID of the 5s belt-and-suspenders forceSweep retry so it can
  // be cancelled if the component unmounts before the timeout fires.
  const sweepRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Game-state ref ─────────────────────────────────────────────────────────
  // Stable ref so the 1s interval can read the latest game state without
  // being re-created on every game-state change.
  const multiplayerGameStateRef = useRef(multiplayerGameState);
  useEffect(() => {
    multiplayerGameStateRef.current = multiplayerGameState;
  }, [multiplayerGameState]);

  // ── Turn ring continuity refs (#628, #629) ─────────────────────────────────
  // TURN RING CONTINUITY (#628): persist the last non-null turn_started_at so
  // the yellow ring anchor is never lost during brief null-gameState windows
  // (e.g. when player_reconnected broadcast triggers a fetchGameState re-fetch
  // and, on error, setGameState(null) fires before the retry succeeds).
  const lastTurnStartedAtRef = useRef<string | null>(null);

  // RING REJOIN FIX (#629): remember whether idx-0 had the active turn when
  // gameState was last authoritative (non-null). Null windows leave the ref
  // at its last known value so the yellow ring persists through loading.
  const localPlayerWasActiveRef = useRef<boolean>(false);

  useEffect(() => {
    if (multiplayerGameState?.turn_started_at) {
      lastTurnStartedAtRef.current = multiplayerGameState.turn_started_at;
    }
    // Only update the was-active flag when gameState is authoritative.
    if (multiplayerGameState !== null) {
      const currentTurn = multiplayerGameState.current_turn;
      const localIdx = layoutPlayers[0]?.player_index;
      localPlayerWasActiveRef.current =
        typeof currentTurn === 'number' && currentTurn === localIdx;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multiplayerGameState?.turn_started_at, multiplayerGameState?.current_turn, layoutPlayers[0]?.player_index]);

  // ── Sweep-retry cleanup ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (sweepRetryTimeoutRef.current !== null) {
        clearTimeout(sweepRetryTimeoutRef.current);
      }
    };
  }, []);

  // ── Stable ref mirror for realtimePlayers ──────────────────────────────────
  // Keeps the interval stable (deps = [userId] only). The interval reads
  // this ref so it always sees the latest player list without being torn
  // down and recreated on every Realtime update (~every 1.25 s per player).
  const realtimePlayersRef = useRef(realtimePlayers);
  useEffect(() => {
    realtimePlayersRef.current = realtimePlayers;
  }, [realtimePlayers]);

  // ── Main 1s staleness-detection interval ──────────────────────────────────
  // Detects player disconnects via stale last_seen_at timestamps as a fallback
  // for when Supabase Realtime delivery of connection_status changes is delayed.
  // STALE_THRESHOLD_MS mirrors the server Phase A threshold (30 s).
  //
  // The effect does NOT start at all when userId is undefined (pre-auth / logged-out)
  // so no background wakeups occur in unauthenticated states.  The [userId] dep
  // ensures the interval is created once auth resolves and cleared on sign-out.
  useEffect(() => {
    // Don't install the interval until the authenticated user is known;
    // skips background wakeups during logged-out / pre-auth states.
    if (!userId) return;

    const STALE_THRESHOLD_MS = 30_000;

    const interval = setInterval(() => {

      const players = realtimePlayersRef.current;
      if (!players || players.length === 0) return;

      const now = Date.now();
      const newMap = new Map<number, string>();

      for (const rp of players) {
        // Skip bots, invalid rows, and the local player.
        if (rp.is_bot || typeof rp.player_index !== 'number') continue;
        if (rp.user_id === userId) continue;

        // Bot replaced — clear client-side detection and skip.
        if (rp.connection_status === 'replaced_by_bot') {
          delete clientDisconnectStartRef.current[rp.player_index];
          continue;
        }

        if (rp.connection_status === 'disconnected') {
          // ── Heartbeat freshness override ──────────────────────────────────
          // The postgres_changes event that flips connection_status → 'connected'
          // may arrive AFTER a fresh heartbeat has updated playerLastSeenAtRef.
          // If the heartbeat is fresh, the player has reconnected — clear the ring.
          const hbIso = playerLastSeenAtRef.current[rp.id] || rp.last_seen_at;
          if (hbIso) {
            const hbStaleMs = now - new Date(hbIso).getTime();
            if (hbStaleMs < STALE_THRESHOLD_MS) {
              if (clientDisconnectStartRef.current[rp.player_index] !== undefined) {
                delete clientDisconnectStartRef.current[rp.player_index];
                gameLogger.info(
                  `[useDisconnectDetection] Heartbeat override: player_index=${rp.player_index} heartbeat fresh (${Math.round(hbStaleMs / 1000)}s) but connection_status=disconnected — clearing grey ring`,
                );
              }
              continue;
            }
          }

          // Anchor selection (in priority order):
          //   1. turn_started_at — turn carry-over, no visual jump from yellow ring.
          //   2. disconnect_timer_started_at — server timer anchor.
          //   3. last_seen_at — matches Phase A's anchor; prevents ring expiry lag.
          //   4. now — last-resort fallback.
          const existingAnchor = clientDisconnectStartRef.current[rp.player_index];
          const serverAnchorMs = rp.disconnect_timer_started_at
            ? new Date(rp.disconnect_timer_started_at).getTime()
            : null;
          const existingAnchorMs = existingAnchor ? new Date(existingAnchor).getTime() : null;
          // Seed if not set; or correct downward if server anchor is strictly earlier.
          const needsUpdate =
            !existingAnchor ||
            (serverAnchorMs !== null && existingAnchorMs !== null && serverAnchorMs < existingAnchorMs);

          if (needsUpdate) {
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
            } else if (rp.last_seen_at) {
              anchor = rp.last_seen_at;
              anchorType = 'last_seen_at';
            } else {
              anchor = new Date().toISOString();
              anchorType = 'now';
            }
            clientDisconnectStartRef.current[rp.player_index] = anchor;
            gameLogger.warn(
              `[useDisconnectDetection] Client-side: ${existingAnchor ? 'CORRECTED' : 'seeding'} disconnect for player_index=${rp.player_index} (anchor=${anchorType}${existingAnchorMs !== null && serverAnchorMs !== null ? `, correction=${Math.round((existingAnchorMs - serverAnchorMs) / 1000)}s` : ''})`,
            );
          }
          newMap.set(rp.player_index, clientDisconnectStartRef.current[rp.player_index]);
          continue;
        }

        // Server-confirmed connected with no pending timer — clear grey ring.
        if (rp.connection_status === 'connected' && !rp.disconnect_timer_started_at) {
          if (clientDisconnectStartRef.current[rp.player_index] !== undefined) {
            delete clientDisconnectStartRef.current[rp.player_index];
            gameLogger.info(
              `[useDisconnectDetection] Stale-check shortcircuit: player_index=${rp.player_index} server-confirmed connected, clearing grey ring`,
            );
          }
          continue;
        }

        // Stale heartbeat detection (not yet server-confirmed as disconnected).
        const lastSeenIso = playerLastSeenAtRef.current[rp.id] || rp.last_seen_at;
        if (!lastSeenIso) continue;

        const staleMs = now - new Date(lastSeenIso).getTime();
        if (staleMs > STALE_THRESHOLD_MS) {
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
            } else if (rp.last_seen_at) {
              anchor = rp.last_seen_at;
              anchorType = 'last_seen_at';
            } else {
              anchor = new Date().toISOString();
              anchorType = 'client_now';
            }
            clientDisconnectStartRef.current[rp.player_index] = anchor;
            gameLogger.warn(
              `[useDisconnectDetection] Client-side: player_index=${rp.player_index} detected as disconnected (stale ${Math.round(staleMs / 1000)}s, anchor=${anchorType})`,
            );
          }
          newMap.set(rp.player_index, clientDisconnectStartRef.current[rp.player_index]);
        } else {
          // Heartbeat is fresh — player is live.
          if (clientDisconnectStartRef.current[rp.player_index]) {
            gameLogger.info(
              `[useDisconnectDetection] Client-side: player_index=${rp.player_index} reconnected`,
            );
            delete clientDisconnectStartRef.current[rp.player_index];
          }
        }
      }

      // Prune the ref: delete entries whose player_index is not present in the
      // current disconnected snapshot (newMap). This covers two cases:
      //   1. Player left the room (room_players DELETE) — absent from
      //      realtimePlayers so never iterated above → never added to newMap.
      //   2. Player server-confirmed connected this tick — reached a `continue`
      //      above → not added to newMap despite still being in realtimePlayers.
      // Without this, the immediate-clear effect (fired by a *different*
      // reconnecting player) rebuilds the Map from the ref and quietly
      // re-introduces a ghost anchor for any cleared or departed seat.
      for (const key of Object.keys(clientDisconnectStartRef.current)) {
        if (!newMap.has(Number(key))) {
          delete clientDisconnectStartRef.current[Number(key)];
        }
      }

      dispatch({ type: 'REPLACE', map: newMap });
    }, 1_000);

    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // ── Immediate reconnect clear ──────────────────────────────────────────────
  // The 1s polling interval (above) is stable — it runs only once per userId
  // and reads realtimePlayersRef, so Realtime heartbeats do NOT restart it.
  // However the interval still has up to 1 s of lag between a server-confirmed
  // reconnect and the stale grey-ring anchor being removed.  This effect removes
  // the anchor in the same render cycle that realtimePlayers delivers the
  // connection_status='connected' + disconnect_timer_started_at=null update,
  // ensuring the yellow turn ring appears immediately on reconnect for observers.
  useEffect(() => {
    if (!realtimePlayers || realtimePlayers.length === 0) return;

    let changed = false;
    for (const rp of realtimePlayers) {
      if (rp.is_bot || typeof rp.player_index !== 'number') continue;
      if (rp.user_id === userId) continue;
      if (
        rp.connection_status === 'connected' &&
        !rp.disconnect_timer_started_at &&
        clientDisconnectStartRef.current[rp.player_index] !== undefined
      ) {
        delete clientDisconnectStartRef.current[rp.player_index];
        changed = true;
        gameLogger.info(
          `[useDisconnectDetection] Immediate clear: player_index=${rp.player_index} confirmed reconnected by server`,
        );
      }
    }

    if (changed) {
      // Prune the ref before rebuilding: entries for players no longer present
      // in realtimePlayers (departed seats) must not be re-introduced as ghost
      // entries. This handles the race where this effect fires for a reconnecting
      // player BEFORE the 1s interval has had a chance to prune the ref itself.
      const activePIdx = new Set(
        realtimePlayers
          .map(p => p.player_index)
          .filter((idx): idx is number => typeof idx === 'number'),
      );
      for (const key of Object.keys(clientDisconnectStartRef.current)) {
        if (!activePIdx.has(Number(key))) {
          delete clientDisconnectStartRef.current[Number(key)];
        }
      }
      // Rebuild map from the pruned ref (single source of truth); avoids
      // stale closure over `clientDisconnections` state.
      const newMap = new Map<number, string>();
      for (const [idx, anchor] of Object.entries(clientDisconnectStartRef.current)) {
        newMap.set(Number(idx), anchor);
      }
      dispatch({ type: 'REPLACE', map: newMap });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realtimePlayers, userId]);

  // ── Countdown expiry callbacks ─────────────────────────────────────────────

  /** Local player's 60s connection countdown reached zero → open RejoinModal. */
  const handleLocalPlayerCountdownExpired = useCallback(() => {
    gameLogger.warn(
      '[useDisconnectDetection] Local player connection countdown expired — showing rejoin modal',
    );
    setShowBotReplacedModal(true);
  }, [setShowBotReplacedModal]);

  /** Remote player's disconnect countdown reached zero → immediately trigger bot replacement. */
  const handleOtherPlayerDisconnectExpired = useCallback(() => {
    gameLogger.warn(
      '[useDisconnectDetection] Remote player disconnect countdown expired — forcing sweep',
    );
    forceSweep();
    // Phase B uses <= so the first sweep at exactly T=60s is sufficient.
    // Belt-and-suspenders: 5s retry covers server-clock-skew edge cases.
    // process_disconnected_players() is idempotent — safe to call twice.
    if (sweepRetryTimeoutRef.current !== null) clearTimeout(sweepRetryTimeoutRef.current);
    sweepRetryTimeoutRef.current = setTimeout(() => {
      sweepRetryTimeoutRef.current = null;
      forceSweep();
    }, 5_000);
  }, [forceSweep]);

  // ── Enriched layout players ────────────────────────────────────────────────
  const enrichedLayoutPlayers = useMemo((): EnrichedLayoutPlayer[] => {
    // Fall back to lastTurnStartedAtRef when gameState is briefly null (reconnect
    // fetch error) so the ring anchor persists and never triggers a restart.
    const turnStartedAt =
      multiplayerGameState?.turn_started_at ?? lastTurnStartedAtRef.current ?? null;

    return layoutPlayersWithScores.map((player, idx) => {
      // Client-side disconnect anchor for this seat.
      const clientDisconnectTimerStartedAt =
        player.player_index !== undefined
          ? (clientDisconnections.get(player.player_index) ?? null)
          : null;
      const isClientDisconnected = clientDisconnectTimerStartedAt !== null;

      // REJOIN FIX (#624/#629): extend the active-turn guard to cover rejoin flow
      // and brief null-gameState windows.
      const isInRejoinFlow =
        idx === 0 && (showBotReplacedModal || isReconnecting) && turnStartedAt !== null;
      const isEffectivelyActive =
        player.isActive ||
        (idx === 0 && !multiplayerGameState && localPlayerWasActiveRef.current && turnStartedAt !== null) ||
        isInRejoinFlow;

      // Local player on their turn: always suppress the grey disconnect ring so
      // the yellow turn ring is visible (disconnect_timer_started_at can linger
      // from the previous disconnect window after reconnect).
      const suppressDisconnectRing = idx === 0 && isEffectivelyActive;

      // Server authoritative reconnect: if the server confirms connected + no
      // timer, discard stale client-side detection immediately.
      const serverConfirmedConnected =
        !player.isDisconnected && !player.disconnectTimerStartedAt;

      // Remote player on their turn + client says alive: suppress grey ring
      // (handles stale Realtime delivery for observers).
      const clientClearedDuringTurn = idx > 0 && player.isActive && !isClientDisconnected;

      const shouldSuppressRing =
        suppressDisconnectRing || serverConfirmedConnected || clientClearedDuringTurn;

      return {
        ...player,
        // Turn ring: visible on WHOEVER's active turn it is (all players see it).
        turnTimerStartedAt: isEffectivelyActive ? turnStartedAt : null,
        // Disconnect ring: merge client-side + server-side state.
        isDisconnected: shouldSuppressRing
          ? false
          : (isClientDisconnected || (player.isDisconnected ?? false)),
        disconnectTimerStartedAt: shouldSuppressRing
          ? null
          : (clientDisconnectTimerStartedAt ?? player.disconnectTimerStartedAt ?? null),
        // Countdown expiry routing:
        //   idx 0 (local) → open RejoinModal
        //   idx > 0 (others) → force immediate bot-replacement sweep
        onCountdownExpired:
          idx === 0 ? handleLocalPlayerCountdownExpired : handleOtherPlayerDisconnectExpired,
      };
    });
  }, [
    layoutPlayersWithScores,
    handleLocalPlayerCountdownExpired,
    handleOtherPlayerDisconnectExpired,
    multiplayerGameState?.turn_started_at,
    multiplayerGameState?.current_turn,
    clientDisconnections,
    showBotReplacedModal,
    isReconnecting,
  ]);

  return { enrichedLayoutPlayers };
}
