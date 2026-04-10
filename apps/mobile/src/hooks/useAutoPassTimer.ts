/**
 * useAutoPassTimer — Server-authoritative auto-pass timer hook.
 *
 * Architecture (Mar 2026 – SELF-PASS + SERVER CASCADE):
 * - Timer state lives in `game_state.auto_pass_timer` (database)
 * - Contains `started_at`, `duration_ms`, and `end_timestamp`
 * - ALL clients calculate remaining_ms independently from the SAME server timestamp
 * - When the timer expires, the first client whose user's turn it is calls
 *   `player-pass` for ITSELF.  The server-side cascade in the player-pass
 *   edge function then completes ALL remaining passes atomically in a single
 *   DB write.  No sequential client-by-client passing.
 * - The interval is created ONCE per room (stable interval pattern) and reads
 *   all state from refs — no deps-based recreation during gameplay.
 * - Bots are handled by the bot-coordinator, not this hook.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../services/supabase';
import type {
  GameState,
  Player,
  AutoPassTimerState,
  BroadcastEvent,
  BroadcastData,
} from '../types/multiplayer';
import type { PlayerPassResponse } from '../types/realtimeTypes';
import { invokeWithRetry } from '../utils/edgeFunctionRetry';
import { networkLogger } from '../utils/logger';

export interface UseAutoPassTimerOptions {
  /** Current game state (read via ref for freshness inside setInterval). */
  gameState: GameState | null;
  /** Room object – needed for room_id and room code. */
  room: { id: string; code: string } | null;
  /** Current list of room players. */
  roomPlayers: Player[];
  /** Broadcast a message to all connected clients. */
  broadcastMessage: (event: BroadcastEvent, data: BroadcastData) => Promise<void>;
  /** Clock-sync corrected timestamp (ms) — ref-based, safe in stale closures. */
  getCorrectedNow: () => number;
  /** Current authenticated user id (auth.uid) — used to only auto-pass the local player. */
  currentUserId?: string | null;
}

/**
 * Manages the auto-pass timer lifecycle:
 * 1. Creates a SINGLE stable 100ms polling interval per room (no deps churn).
 * 2. All state is read from refs inside the interval callback.
 * 3. When the timer expires, triggers ONE self-pass call; the server-side
 *    cascade in player-pass handles all remaining passes atomically.
 * 4. Interval stops when auto_pass_timer is cleared by the server.
 */
export function useAutoPassTimer({
  gameState,
  room,
  roomPlayers,
  broadcastMessage,
  getCorrectedNow,
  currentUserId,
}: UseAutoPassTimerOptions): { isAutoPassInProgress: boolean } {
  // ── Refs (all state the interval callback needs) ────────────────────────
  const gameStateRef = useRef<GameState | null>(null);
  const roomRef = useRef<{ id: string; code: string } | null>(null);
  const roomPlayersRef = useRef<Player[]>([]);
  const currentUserIdRef = useRef<string | null>(null);
  const broadcastMessageRef = useRef<typeof broadcastMessage>(broadcastMessage);
  const getCorrectedNowRef = useRef<typeof getCorrectedNow>(getCorrectedNow);

  /** Timestamp-based execution guard to prevent concurrent self-pass calls. */
  const autoPassExecutionGuard = useRef<number | null>(null);
  /** Reactive mirror of the guard for consumers (e.g. useRealtime gating pass()). */
  const [isAutoPassInProgressState, setIsAutoPassInProgressState] = useState(false);
  /** Whether the timer has already expired — used together with
   *  `lastSelfPassAttemptRef` to throttle self-pass attempts to every 500 ms
   *  after expiry (the underlying setInterval remains at 100 ms). */
  const hasExpiredRef = useRef(false);
  /** Timestamp of last self-pass attempt for throttling. */
  const lastSelfPassAttemptRef = useRef<number>(0);
  /** Track which timer sequence_id the interval is handling to detect new timers. */
  const activeTimerSequenceRef = useRef<string | null>(null);
  /**
   * P3-2 FIX: Numeric NTP drift snapshotted at the moment a new timer sequence is
   * detected.  getCorrectedNow is a stable callback reading a mutable driftRef, so
   * snapshotting the function reference is a no-op.  We must snapshot the numeric
   * offset (`getCorrectedNow() - Date.now()`) so mid-countdown NTP sync cannot change
   * computed remaining-ms for the current sequence.
   */
  const timerSnapshotDriftRef = useRef<number | null>(null);

  // ── Keep refs in sync with props (cheap, no interval recreation) ────────
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);
  useEffect(() => {
    roomRef.current = room;
  }, [room]);
  useEffect(() => {
    roomPlayersRef.current = roomPlayers;
  }, [roomPlayers]);
  useEffect(() => {
    currentUserIdRef.current = currentUserId ?? null;
  }, [currentUserId]);
  useEffect(() => {
    broadcastMessageRef.current = broadcastMessage;
  }, [broadcastMessage]);
  useEffect(() => {
    getCorrectedNowRef.current = getCorrectedNow;
  }, [getCorrectedNow]);

  // ── Stable self-pass function (reads everything from refs) ──────────────
  const tryAutoPassSelf = useCallback(async () => {
    const currentRoom = roomRef.current;
    const userId = currentUserIdRef.current;
    if (!currentRoom || !userId) return;

    const now = Date.now();
    const lockTimeout = 10_000;
    const currentLock = autoPassExecutionGuard.current;

    // Skip if already executing (non-stale lock)
    if (currentLock && now - currentLock < lockTimeout) return;
    if (currentLock) {
      networkLogger.warn('⏰ [Timer] Stale self-pass lock detected, overriding');
    }

    autoPassExecutionGuard.current = now;
    setIsAutoPassInProgressState(true);

    try {
      // Fetch fresh game state from DB (not from ref — ref might lag Realtime)
      const { data: gs, error: stateErr } = await supabase
        .from('game_state')
        .select('current_turn, passes, last_play, auto_pass_timer, game_phase')
        .eq('room_id', currentRoom.id)
        .single();

      if (stateErr || !gs) {
        networkLogger.error('⏰ [Timer] Self-pass: failed to fetch game state:', stateErr);
        return;
      }

      // Early exits
      if (gs.game_phase === 'finished' || gs.game_phase === 'game_over') return;
      if (!gs.auto_pass_timer || !(gs.auto_pass_timer as { active?: boolean }).active) return;
      if (!gs.last_play && (!gs.passes || gs.passes === 0)) return;
      if ((gs.passes || 0) >= 3) return;

      // Find local player
      const players = roomPlayersRef.current;
      const myPlayer = players.find(p => p.user_id === userId);
      if (!myPlayer) return;

      // Exempt check
      const timerData = gs.auto_pass_timer as {
        triggering_play?: { position?: number };
        player_index?: number;
      } | null;
      const exemptIdx = timerData?.triggering_play?.position ?? timerData?.player_index;
      if (myPlayer.player_index === exemptIdx) return;

      // Turn check
      if (gs.current_turn !== myPlayer.player_index) return;

      // It's our turn → auto-pass (server will cascade remaining passes)
      networkLogger.info(
        `⏰ [Timer] Auto-passing self (player ${myPlayer.player_index}, ${myPlayer.username})`
      );

      const { data: passResult, error: passError } = await invokeWithRetry<PlayerPassResponse>(
        'player-pass',
        { body: { room_code: currentRoom.code, player_id: myPlayer.user_id } }
      );

      if (passError || !passResult?.success) {
        // Try to read the real error body from the edge-function response context
        // (Supabase stores the HTTP response in error.context when the function returns non-2xx).
        let realErrMsg = passResult?.error || passError?.message || 'Unknown';
        let contextBody: string | null = null;
        try {
          // context.body may be a pre-read string, or context.text() may be available
          const ctx = (passError as { context?: { body?: string; text?: () => Promise<string> } })
            ?.context;
          if (ctx?.body) {
            contextBody = ctx.body;
          } else if (typeof ctx?.text === 'function') {
            contextBody = await ctx.text();
          }
          if (contextBody) {
            const parsed = JSON.parse(contextBody) as { error?: string };
            if (parsed?.error) realErrMsg = parsed.error;
          }
        } catch {
          // ignore – best-effort body extraction
        }

        // Known race-condition outcomes are expected when multiple clients compete
        // (e.g. opponent already played, game ended, timer was cleared by server).
        // Log as WARN (not ERROR) so Sentry/LogBox isn't polluted by expected churn.
        const isExpectedRace =
          /not your turn|game already ended|timer.*cleared|auto.?pass.*cleared|already passed|cannot pass when leading/i.test(
            realErrMsg
          );
        if (isExpectedRace) {
          networkLogger.warn(`⏰ [Timer] ⚠️ Self-pass skipped (race): ${realErrMsg}`);
        } else {
          networkLogger.error(
            `⏰ [Timer] ❌ Self-pass failed: ${realErrMsg}${contextBody ? ` (raw: ${contextBody})` : ''}`
          );
        }
        return;
      }

      networkLogger.info(
        `⏰ [Timer] ✅ Self-pass successful. next_turn=${passResult.next_turn}, ` +
          `passes=${passResult.passes}, trick_cleared=${passResult.trick_cleared}`
      );

      // Broadcast (non-blocking, best-effort)
      void broadcastMessageRef
        .current('auto_pass_executed', { player_index: myPlayer.player_index })
        .catch(() => {});
    } catch (fatalError) {
      networkLogger.error('⏰ [Timer] ❌ Self-pass fatal error:', fatalError);
    } finally {
      autoPassExecutionGuard.current = null;
      setIsAutoPassInProgressState(false);
    }
  }, []); // Empty deps: reads everything from refs

  // ── Stable polling interval — created ONCE per room ─────────────────────
  // Instead of recreating the interval every time a dep changes (which resets
  // expiry detection and causes stale getCorrectedNow captures), we create
  // ONE long-lived interval that reads ALL state from refs.  This avoids the
  // bugs where interval recreation caused the timer to "restart at 10s" or
  // fire EXPIRED incorrectly.
  useEffect(() => {
    if (!room?.id) return;

    networkLogger.debug('⏰ [DEBUG] Creating stable timer polling interval for room', room.id);

    const interval = setInterval(() => {
      const gs = gameStateRef.current;
      const timerState = gs?.auto_pass_timer;

      // No active timer → nothing to do
      if (!timerState || !timerState.active) {
        // If we were tracking a timer, reset tracking state
        if (activeTimerSequenceRef.current) {
          networkLogger.debug('⏰ [Timer] Timer deactivated, resetting tracking');
          activeTimerSequenceRef.current = null;
          hasExpiredRef.current = false;
          lastSelfPassAttemptRef.current = 0;
        }
        return;
      }

      // Game finished → skip
      if (gs?.game_phase === 'finished' || gs?.game_phase === 'game_over') return;

      // Detect new timer (different sequence_id → reset expiry tracking)
      const seqId =
        (timerState as AutoPassTimerState & { sequence_id?: string }).sequence_id ||
        timerState.started_at;
      if (activeTimerSequenceRef.current !== seqId) {
        activeTimerSequenceRef.current = seqId;
        hasExpiredRef.current = false;
        lastSelfPassAttemptRef.current = 0;
        // P3-2 FIX: Snapshot the numeric drift at sequence activation (not the function
        // reference, which would still read the mutable driftRef on every call).
        timerSnapshotDriftRef.current = getCorrectedNowRef.current() - Date.now();
        networkLogger.debug('⏰ [Timer] Tracking new timer sequence:', seqId);
      }

      // Calculate corrected-now using the frozen drift from sequence activation.
      // Falls back to live getCorrectedNow when no sequence snapshot exists.
      const snapshotNow =
        timerSnapshotDriftRef.current !== null
          ? () => Date.now() + timerSnapshotDriftRef.current! // frozen drift, immune to NTP updates
          : getCorrectedNowRef.current;
      let remaining: number;
      const endTimestamp = (timerState as AutoPassTimerState & { end_timestamp?: number })
        .end_timestamp;

      if (typeof endTimestamp === 'number') {
        const correctedNow = snapshotNow();
        remaining = Math.max(0, endTimestamp - correctedNow);
        // Cap at duration_ms: if drift snapshot=0 and device clock is behind server the
        // raw endTimestamp - correctedNow can exceed duration_ms, stalling the timer.
        remaining = Math.min(remaining, timerState.duration_ms);
        // Log once per whole-second transition
        if (
          remaining > 0 &&
          Math.floor(remaining / 1000) !== Math.floor((remaining + 100) / 1000)
        ) {
          networkLogger.debug(`⏰ [Timer] ${Math.ceil(remaining / 1000)}s remaining`);
        }
      } else {
        const startedAt = new Date(timerState.started_at).getTime();
        const correctedNow = snapshotNow();
        const elapsed = correctedNow - startedAt;
        remaining = Math.max(0, timerState.duration_ms - elapsed);
        // Cap at duration_ms for the same reason as the end_timestamp path above.
        remaining = Math.min(remaining, timerState.duration_ms);
      }

      // Timer expired → trigger one self-pass (server cascades the rest)
      if (remaining <= 0) {
        const now = Date.now();
        if (now - lastSelfPassAttemptRef.current < 500) return; // throttle
        lastSelfPassAttemptRef.current = now;

        if (!hasExpiredRef.current) {
          hasExpiredRef.current = true;
          networkLogger.info('⏰ [Timer] EXPIRED — triggering self-pass (server will cascade)');
        }

        void tryAutoPassSelf();
      }
    }, 100);

    return () => {
      networkLogger.debug('⏰ [DEBUG] Cleaning up stable timer polling interval');
      clearInterval(interval);
      activeTimerSequenceRef.current = null;
      timerSnapshotDriftRef.current = null;
    };
  }, [room?.id, tryAutoPassSelf]); // Only recreate when room changes

  return { isAutoPassInProgress: isAutoPassInProgressState };
}
