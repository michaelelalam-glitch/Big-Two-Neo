/**
 * Tests for useDisconnectDetection
 *
 * Covers key transitions flagged in the Copilot review (PR #125, comment
 * r2930422917). Tests are organised around the five reviewer-requested
 * scenarios plus extras for correctness:
 *
 *  1.  REPLACE reducer equality guard - no re-render when map is unchanged.
 *  2.  Client provides disconnect anchor when server says disconnected but
 *      has no timer yet (stale heartbeat seeds the ring's start timestamp).
 *  3.  Client does NOT seed an anchor for a fresh-heartbeat player.
 *  4.  Local player is never seeded (excluded from client-side detection).
 *  5.  Heartbeat override - fresh playerLastSeenAtRef prevents a client
 *      anchor even when connection_status=disconnected.
 *  6.  Anchor correction downward - earlier server timestamp wins.
 *  7.  No upward anchor correction - later server timestamp is rejected.
 *  8.  Immediate clear - grey ring disappears as soon as server confirms
 *      connected without waiting for the next 1 s interval tick.
 *  9.  Ghost ref pruning - departed player's ref entry is removed during
 *      the interval so the immediate-clear rebuild cannot re-introduce it.
 *  10. Countdown expiry -> forceSweep for remote players.
 *  11. Belt-and-suspenders 5 s retry forceSweep.
 *  12. Countdown expiry -> setShowBotReplacedModal for local player.
 */

jest.mock('../../utils/logger', () => ({
  gameLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { renderHook, act } from '@testing-library/react-native';
import { useDisconnectDetection } from '../useDisconnectDetection';
import type { Player as MultiplayerPlayer } from '../../types/multiplayer';
import type { LayoutPlayerWithScore } from '../usePlayerDisplayData';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LOCAL_USER = 'local-user-id';
const REMOTE_ID = 'remote-player-db-id';
const REMOTE_USER = 'remote-user-id';

function makePlayer(overrides: Partial<MultiplayerPlayer> = {}): MultiplayerPlayer {
  return {
    id: REMOTE_ID,
    room_id: 'room-1',
    user_id: REMOTE_USER,
    username: 'Player2',
    player_index: 1,
    is_host: false,
    is_ready: true,
    is_bot: false,
    joined_at: new Date().toISOString(),
    connection_status: 'connected',
    disconnect_timer_started_at: null,
    last_seen_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeLayoutPlayer(
  overrides: Partial<LayoutPlayerWithScore> = {},
): LayoutPlayerWithScore {
  return {
    name: 'Player',
    cardCount: 10,
    score: 0,
    isActive: false,
    player_index: 1,
    totalScore: 0,
    isDisconnected: false,
    disconnectTimerStartedAt: null,
    ...overrides,
  };
}

/**
 * Layout player that mirrors a server-confirmed disconnected seat that has no
 * timer anchor yet. This state disables the serverConfirmedConnected guard so
 * the client-side anchor in clientDisconnections is forwarded as
 * disconnectTimerStartedAt in the returned enrichedLayoutPlayers entry.
 */
function makeDisconnectedLayoutPlayer(
  overrides: Partial<LayoutPlayerWithScore> = {},
): LayoutPlayerWithScore {
  return makeLayoutPlayer({
    isDisconnected: true,
    disconnectTimerStartedAt: null,
    ...overrides,
  });
}

type HookProps = Parameters<typeof useDisconnectDetection>[0];

/**
 * Builds a full default props object. For reference-stability tests (test 1
 * and countdown tests) create the object OUTSIDE renderHook so the same
 * jest.fn() references are reused on every render, keeping useCallback
 * outputs stable and enrichedLayoutPlayers reference constant.
 */
function makeProps(overrides: Partial<HookProps> = {}): HookProps {
  return {
    realtimePlayers: [],
    userId: LOCAL_USER,
    multiplayerGameState: null,
    playerLastSeenAtRef: { current: {} },
    forceSweep: jest.fn(),
    layoutPlayersWithScores: [
      makeLayoutPlayer({ player_index: 0, name: 'LocalPlayer' }),
      makeLayoutPlayer({ player_index: 1, name: 'Player2' }),
    ],
    layoutPlayers: [
      { player_index: 0, isActive: false },
      { player_index: 1, isActive: false },
    ],
    showBotReplacedModal: false,
    isReconnecting: false,
    setShowBotReplacedModal: jest.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('useDisconnectDetection', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // 1 -----------------------------------------------------------------------
  describe('REPLACE reducer equality guard', () => {
    it('does not change enrichedLayoutPlayers reference when map is unchanged', () => {
      // Use stable props so jest.fn() references are identical across every
      // render, keeping useCallback outputs (and thus the enrichedLayoutPlayers
      // useMemo) referentially stable when clientDisconnections is unchanged.
      const stableProps = makeProps();
      const { result } = renderHook(() => useDisconnectDetection(stableProps));

      const before = result.current.enrichedLayoutPlayers;

      // No remote players -> interval early-returns -> REPLACE never dispatched
      // -> reducer equality guard keeps same state -> useMemo not re-run.
      act(() => { jest.advanceTimersByTime(1_100); });
      act(() => { jest.advanceTimersByTime(1_100); });

      expect(result.current.enrichedLayoutPlayers).toBe(before);
    });
  });

  // 2 -----------------------------------------------------------------------
  describe('client anchor seeding', () => {
    it('seeds disconnect anchor from last_seen_at when server confirmed disconnected but has no timer', () => {
      // serverConfirmedConnected guard is disabled when isDisconnected=true,
      // so the client-side anchor propagates to disconnectTimerStartedAt.
      const lastSeenTs = new Date(Date.now() - 40_000).toISOString();
      const remotePlayer = makePlayer({
        connection_status: 'disconnected',
        disconnect_timer_started_at: null,
        last_seen_at: lastSeenTs,
      });
      const layoutPlayersWithScores = [
        makeLayoutPlayer({ player_index: 0, name: 'LocalPlayer' }),
        makeDisconnectedLayoutPlayer({ player_index: 1 }),
      ];

      const { result } = renderHook(() =>
        useDisconnectDetection(makeProps({ realtimePlayers: [remotePlayer], layoutPlayersWithScores })),
      );

      expect(result.current.enrichedLayoutPlayers[1].disconnectTimerStartedAt).toBeNull();

      act(() => { jest.advanceTimersByTime(1_100); });

      expect(result.current.enrichedLayoutPlayers[1].isDisconnected).toBe(true);
      expect(result.current.enrichedLayoutPlayers[1].disconnectTimerStartedAt).toBe(lastSeenTs);
    });

    it('does not seed an entry for a remote player whose heartbeat is fresh', () => {
      const freshTime = new Date(Date.now() - 5_000).toISOString();
      const remotePlayer = makePlayer({
        connection_status: 'connected',
        last_seen_at: freshTime,
      });

      const { result } = renderHook(() =>
        useDisconnectDetection(makeProps({ realtimePlayers: [remotePlayer] })),
      );

      act(() => { jest.advanceTimersByTime(1_100); });

      expect(result.current.enrichedLayoutPlayers[1].isDisconnected).toBe(false);
      expect(result.current.enrichedLayoutPlayers[1].disconnectTimerStartedAt).toBeNull();
    });

    it('never seeds an entry for the local player even with a stale heartbeat', () => {
      const staleTime = new Date(Date.now() - 35_000).toISOString();
      const localPlayer = makePlayer({
        user_id: LOCAL_USER,
        player_index: 0,
        connection_status: 'connected',
        last_seen_at: staleTime,
      });

      const { result } = renderHook(() =>
        useDisconnectDetection(makeProps({ realtimePlayers: [localPlayer] })),
      );

      act(() => { jest.advanceTimersByTime(1_100); });

      expect(result.current.enrichedLayoutPlayers[0].isDisconnected).toBe(false);
    });
  });

  // 5 -----------------------------------------------------------------------
  describe('heartbeat override reconnect', () => {
    it('suppresses client anchor when playerLastSeenAtRef has a fresh heartbeat despite connection_status=disconnected', () => {
      // The postgres_changes event for connection_status -> connected may lag
      // behind a fresh heartbeat in the ref. Client skips anchoring when the
      // ref has a fresh ping so the countdown ring does not flash.
      const freshTime = new Date(Date.now() - 5_000).toISOString();
      const staleServerTime = new Date(Date.now() - 45_000).toISOString();
      const remotePlayer = makePlayer({
        connection_status: 'disconnected',
        disconnect_timer_started_at: null,
        last_seen_at: staleServerTime,
      });
      const playerLastSeenAtRef = { current: { [REMOTE_ID]: freshTime } };
      const layoutPlayersWithScores = [
        makeLayoutPlayer({ player_index: 0, name: 'LocalPlayer' }),
        makeDisconnectedLayoutPlayer({ player_index: 1 }),
      ];

      const { result } = renderHook(() =>
        useDisconnectDetection(
          makeProps({ realtimePlayers: [remotePlayer], playerLastSeenAtRef, layoutPlayersWithScores }),
        ),
      );

      act(() => { jest.advanceTimersByTime(1_100); });

      // Client skips anchoring -> no client-side disconnectTimerStartedAt.
      expect(result.current.enrichedLayoutPlayers[1].disconnectTimerStartedAt).toBeNull();
    });
  });

  // 6 -----------------------------------------------------------------------
  describe('anchor correction downward', () => {
    it('corrects ring anchor to an earlier server disconnect_timer_started_at', () => {
      const laterTs = new Date(Date.now() - 10_000).toISOString();
      const remotePlayer = makePlayer({
        connection_status: 'disconnected',
        disconnect_timer_started_at: laterTs,
        last_seen_at: new Date(Date.now() - 45_000).toISOString(),
      });
      const layoutPlayersWithScores = [
        makeLayoutPlayer({ player_index: 0, name: 'LocalPlayer' }),
        makeDisconnectedLayoutPlayer({ player_index: 1 }),
      ];

      const { result, rerender } = renderHook(
        (props: HookProps) => useDisconnectDetection(props),
        { initialProps: makeProps({ realtimePlayers: [remotePlayer], layoutPlayersWithScores }) },
      );

      // Tick 1 - anchor seeded from disconnect_timer_started_at = laterTs.
      act(() => { jest.advanceTimersByTime(1_100); });
      expect(result.current.enrichedLayoutPlayers[1].disconnectTimerStartedAt).toBe(laterTs);

      // Server now provides an EARLIER anchor.
      const earlierTs = new Date(Date.now() - 30_000).toISOString();
      rerender(makeProps({
        realtimePlayers: [{ ...remotePlayer, disconnect_timer_started_at: earlierTs }],
        layoutPlayersWithScores,
      }));

      // Tick 2 - anchor corrected downward.
      act(() => { jest.advanceTimersByTime(1_100); });
      expect(result.current.enrichedLayoutPlayers[1].disconnectTimerStartedAt).toBe(earlierTs);
    });

    it('does NOT correct anchor upward - later server timestamp is rejected', () => {
      const earlierTs = new Date(Date.now() - 30_000).toISOString();
      const remotePlayer = makePlayer({
        connection_status: 'disconnected',
        disconnect_timer_started_at: earlierTs,
        last_seen_at: new Date(Date.now() - 45_000).toISOString(),
      });
      const layoutPlayersWithScores = [
        makeLayoutPlayer({ player_index: 0, name: 'LocalPlayer' }),
        makeDisconnectedLayoutPlayer({ player_index: 1 }),
      ];

      const { result, rerender } = renderHook(
        (props: HookProps) => useDisconnectDetection(props),
        { initialProps: makeProps({ realtimePlayers: [remotePlayer], layoutPlayersWithScores }) },
      );

      act(() => { jest.advanceTimersByTime(1_100); });
      expect(result.current.enrichedLayoutPlayers[1].disconnectTimerStartedAt).toBe(earlierTs);

      // Server sends a LATER timestamp - should be rejected.
      const laterTs = new Date(Date.now() - 5_000).toISOString();
      rerender(makeProps({
        realtimePlayers: [{ ...remotePlayer, disconnect_timer_started_at: laterTs }],
        layoutPlayersWithScores,
      }));

      act(() => { jest.advanceTimersByTime(1_100); });
      expect(result.current.enrichedLayoutPlayers[1].disconnectTimerStartedAt).toBe(earlierTs);
    });
  });

  // 8 -----------------------------------------------------------------------
  describe('immediate clear effect', () => {
    it('clears the grey ring immediately when server confirms connected without waiting 1 s', () => {
      const lastSeenTs = new Date(Date.now() - 40_000).toISOString();
      const disconnectedPlayer = makePlayer({
        connection_status: 'disconnected',
        disconnect_timer_started_at: null,
        last_seen_at: lastSeenTs,
      });
      const layoutDisconnected = [
        makeLayoutPlayer({ player_index: 0, name: 'LocalPlayer' }),
        makeDisconnectedLayoutPlayer({ player_index: 1 }),
      ];
      const layoutConnected = [
        makeLayoutPlayer({ player_index: 0, name: 'LocalPlayer' }),
        makeLayoutPlayer({ player_index: 1, isDisconnected: false, disconnectTimerStartedAt: null }),
      ];

      const { result, rerender } = renderHook(
        (props: HookProps) => useDisconnectDetection(props),
        {
          initialProps: makeProps({
            realtimePlayers: [disconnectedPlayer],
            layoutPlayersWithScores: layoutDisconnected,
          }),
        },
      );

      // Seed the client anchor via the stale-check interval.
      act(() => { jest.advanceTimersByTime(1_100); });
      expect(result.current.enrichedLayoutPlayers[1].disconnectTimerStartedAt).toBe(lastSeenTs);

      // Server confirms reconnect.
      const reconnectedPlayer = {
        ...disconnectedPlayer,
        connection_status: 'connected' as const,
        disconnect_timer_started_at: null,
      };
      act(() => {
        rerender(makeProps({
          realtimePlayers: [reconnectedPlayer],
          layoutPlayersWithScores: layoutConnected,
        }));
      });

      // Ring cleared without advancing the timer another 1 s.
      expect(result.current.enrichedLayoutPlayers[1].isDisconnected).toBe(false);
      expect(result.current.enrichedLayoutPlayers[1].disconnectTimerStartedAt).toBeNull();
    });
  });

  // 9 -----------------------------------------------------------------------
  describe('ghost ref pruning', () => {
    it('removes departed player ref entry so it cannot be reintroduced when another player reconnects', () => {
      const staleTime = new Date(Date.now() - 40_000).toISOString();
      const departedPlayer = makePlayer({
        player_index: 1,
        connection_status: 'disconnected',
        last_seen_at: staleTime,
      });
      const stayingPlayer = makePlayer({
        id: 'staying-db-id',
        user_id: 'staying-user-id',
        player_index: 2,
        connection_status: 'disconnected',
        last_seen_at: staleTime,
      });
      const layoutPlayers = [
        { player_index: 0, isActive: false },
        { player_index: 1, isActive: false },
        { player_index: 2, isActive: false },
      ];
      const layoutBothDisconnected = [
        makeLayoutPlayer({ player_index: 0, name: 'LocalPlayer' }),
        makeDisconnectedLayoutPlayer({ player_index: 1, name: 'DepartedPlayer' }),
        makeDisconnectedLayoutPlayer({ player_index: 2, name: 'StayingPlayer' }),
      ];
      const layoutOnlyStayingDisconnected = [
        makeLayoutPlayer({ player_index: 0, name: 'LocalPlayer' }),
        makeLayoutPlayer({ player_index: 1, name: 'DepartedPlayer' }),
        makeDisconnectedLayoutPlayer({ player_index: 2, name: 'StayingPlayer' }),
      ];
      const layoutStayingReconnected = [
        makeLayoutPlayer({ player_index: 0, name: 'LocalPlayer' }),
        makeLayoutPlayer({ player_index: 1, name: 'DepartedPlayer' }),
        makeLayoutPlayer({ player_index: 2, name: 'StayingPlayer' }),
      ];

      const { result, rerender } = renderHook(
        (props: HookProps) => useDisconnectDetection(props),
        {
          initialProps: makeProps({
            realtimePlayers: [departedPlayer, stayingPlayer],
            layoutPlayersWithScores: layoutBothDisconnected,
            layoutPlayers,
          }),
        },
      );

      // Tick 1: both players seeded in clientDisconnectStartRef.
      act(() => { jest.advanceTimersByTime(1_100); });
      expect(result.current.enrichedLayoutPlayers[1].disconnectTimerStartedAt).not.toBeNull();

      // departedPlayer leaves the room (DELETE -> removed from realtimePlayers).
      rerender(makeProps({
        realtimePlayers: [stayingPlayer],
        layoutPlayersWithScores: layoutOnlyStayingDisconnected,
        layoutPlayers,
      }));

      // Tick 2: interval builds newMap without departedPlayer, then prunes
      // the ref so player_index 1 is removed before dispatching REPLACE.
      act(() => { jest.advanceTimersByTime(1_100); });

      // stayingPlayer reconnects -> immediate-clear fires with changed=true
      // and rebuilds the Map from the ref. Without pruning the ref would still
      // carry departedPlayer's anchor and re-introduce it here.
      const reconnectedStaying = {
        ...stayingPlayer,
        connection_status: 'connected' as const,
        disconnect_timer_started_at: null,
      };
      act(() => {
        rerender(makeProps({
          realtimePlayers: [reconnectedStaying],
          layoutPlayersWithScores: layoutStayingReconnected,
          layoutPlayers,
        }));
      });

      // departedPlayer's slot must not have a ghost grey ring.
      expect(result.current.enrichedLayoutPlayers[1].disconnectTimerStartedAt).toBeNull();
    });

    // 9b -------------------------------------------------------------------------
    it('prunes departed player ref in immediate-clear (race: clear fires before interval)', () => {
      // Regression for r2930422867: if the immediate-clear effect fires for a
      // reconnecting player BEFORE the 1s interval has had a chance to prune
      // the departed player's ref entry, the rebuilt Map must not re-introduce
      // a ghost anchor for the departed seat.
      const staleTime = new Date(Date.now() - 40_000).toISOString();
      const departedPlayer = makePlayer({
        player_index: 1,
        connection_status: 'disconnected',
        last_seen_at: staleTime,
      });
      const stayingPlayer = makePlayer({
        id: 'staying-db-id',
        user_id: 'staying-user-id',
        player_index: 2,
        connection_status: 'disconnected',
        last_seen_at: staleTime,
      });
      const layoutPlayers = [
        { player_index: 0, isActive: false },
        { player_index: 1, isActive: false },
        { player_index: 2, isActive: false },
      ];
      const layoutBothDisconnected = [
        makeLayoutPlayer({ player_index: 0, name: 'LocalPlayer' }),
        makeDisconnectedLayoutPlayer({ player_index: 1, name: 'DepartedPlayer' }),
        makeDisconnectedLayoutPlayer({ player_index: 2, name: 'StayingPlayer' }),
      ];
      const layoutStayingReconnected = [
        makeLayoutPlayer({ player_index: 0, name: 'LocalPlayer' }),
        makeLayoutPlayer({ player_index: 1, name: 'DepartedPlayer' }),
        makeLayoutPlayer({ player_index: 2, name: 'StayingPlayer' }),
      ];

      const { result, rerender } = renderHook(
        (props: HookProps) => useDisconnectDetection(props),
        {
          initialProps: makeProps({
            realtimePlayers: [departedPlayer, stayingPlayer],
            layoutPlayersWithScores: layoutBothDisconnected,
            layoutPlayers,
          }),
        },
      );

      // Tick 1: both players seeded in clientDisconnectStartRef.
      act(() => { jest.advanceTimersByTime(1_100); });
      expect(result.current.enrichedLayoutPlayers[1].disconnectTimerStartedAt).not.toBeNull();

      // departedPlayer leaves AND stayingPlayer reconnects in the same render.
      // We do NOT advance timers here, so the 1s interval has NOT pruned the
      // ref yet — this is the race the fix targets.
      const reconnectedStaying = {
        ...stayingPlayer,
        connection_status: 'connected' as const,
        disconnect_timer_started_at: null,
      };
      act(() => {
        rerender(makeProps({
          // departedPlayer absent (room_players DELETE)
          realtimePlayers: [reconnectedStaying],
          layoutPlayersWithScores: layoutStayingReconnected,
          layoutPlayers,
        }));
      });

      // immediate-clear must prune the ref BEFORE rebuilding the Map, so the
      // departed player does not reappear as a ghost grey ring.
      expect(result.current.enrichedLayoutPlayers[1].disconnectTimerStartedAt).toBeNull();
      expect(result.current.enrichedLayoutPlayers[2].disconnectTimerStartedAt).toBeNull();
    });
  });

  // 10 ----------------------------------------------------------------------
  describe('countdown expiry', () => {
    it('calls forceSweep when a remote player countdown expires', () => {
      const forceSweep = jest.fn();
      const stableProps = makeProps({ forceSweep });

      const { result } = renderHook(() => useDisconnectDetection(stableProps));

      act(() => {
        result.current.enrichedLayoutPlayers[1].onCountdownExpired();
      });

      expect(forceSweep).toHaveBeenCalledTimes(1);
    });

    // 11 --------------------------------------------------------------------
    it('schedules a 5 s belt-and-suspenders retry forceSweep call', () => {
      const forceSweep = jest.fn();
      const stableProps = makeProps({ forceSweep });

      const { result } = renderHook(() => useDisconnectDetection(stableProps));

      act(() => {
        result.current.enrichedLayoutPlayers[1].onCountdownExpired();
      });

      expect(forceSweep).toHaveBeenCalledTimes(1);

      act(() => { jest.advanceTimersByTime(5_100); });
      expect(forceSweep).toHaveBeenCalledTimes(2);
    });

    // 12 --------------------------------------------------------------------
    it('opens the RejoinModal when the local player countdown expires', () => {
      const setShowBotReplacedModal = jest.fn();
      const stableProps = makeProps({ setShowBotReplacedModal });

      const { result } = renderHook(() => useDisconnectDetection(stableProps));

      act(() => {
        result.current.enrichedLayoutPlayers[0].onCountdownExpired();
      });

      expect(setShowBotReplacedModal).toHaveBeenCalledWith(true);
    });
  });
});
