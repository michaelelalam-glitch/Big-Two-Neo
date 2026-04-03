// deno-lint-ignore-file no-explicit-any
/**
 * Bot Coordinator Edge Function
 *
 * Server-side bot turn executor for Big Two multiplayer games.
 * Replaces the client-side useBotCoordinator hook, eliminating:
 * - Race conditions from Realtime propagation delays
 * - Single point of failure when host disconnects
 * - 16+ critical-fix patches for client-side timing issues
 *
 * Architecture:
 * 1. Triggered after play-cards / player-pass / start_new_match when next turn is a bot
 * 2. Loops through consecutive bot turns, calling play-cards/player-pass via HTTP
 * 3. Adds configurable delays between moves for Realtime animation sync
 * 4. Uses a Postgres row-based lease (via try_acquire_bot_coordinator_lease) to prevent concurrent coordinators
 *
 * @module bot-coordinator
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { BotAI, type BotDifficulty } from '../_shared/botAI.ts';
import { parseCards } from '../_shared/parseCards.ts';
import type { Card } from '../_shared/gameEngine.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Delay between bot moves (ms) — minimal pause to allow Realtime to propagate.
 * Realtime itself adds ~100–150ms latency, so 100ms here keeps total per-bot-turn
 * latency around 200–250ms — matching local 'hard' bot pace without artificial drag.
 */
const BOT_MOVE_DELAY_MS = 100;

/** Maximum bot moves per invocation — prevents infinite loops */
const MAX_BOT_MOVES = 20;

/** Lock timeout — abandon if we can't acquire lock within this duration (ms) */
const LOCK_TIMEOUT_MS = 30_000;

// ==================== HELPERS ====================

interface GameState {
  id: string;
  room_id: string;
  current_turn: number;
  game_phase: string;
  hands: Record<string, any[]>;
  last_play: any;
  match_number: number;
  played_cards: any[];
  passes: number;
  auto_pass_timer: any;
  [key: string]: any;
}

interface RoomPlayer {
  id: string;
  user_id: string;
  username: string;
  player_index: number;
  is_bot: boolean;
  bot_difficulty: BotDifficulty | null;
  room_id: string;
  [key: string]: any;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Broadcasts an event to a Supabase Realtime room channel.
 * Uses the subscribe → send → removeChannel pattern required by supabase-js v2
 * for reliable broadcast delivery from Edge Functions.
 * A 5-second safety timeout ensures the function always resolves even if the
 * channel subscription never completes (e.g., cold WebSocket path).
 */
async function broadcastToRoom(
  supabaseClient: ReturnType<typeof createClient>,
  roomId: string,
  event: string,
  payload: Record<string, any>,
): Promise<void> {
  return new Promise<void>((resolve) => {
    const channel = supabaseClient.channel(`room:${roomId}`);
    let settled = false;

    const finish = (): void => {
      if (!settled) {
        settled = true;
        supabaseClient.removeChannel(channel).catch(() => {});
        resolve();
      }
    };

    // Safety net: always resolve after 5 s to avoid blocking the EF indefinitely
    const safetyTimeout = setTimeout(finish, 5000);

    channel.subscribe((status: string) => {
      if (status === 'SUBSCRIBED') {
        channel
          .send({ type: 'broadcast', event, payload } as any)
          .then(() => { clearTimeout(safetyTimeout); finish(); })
          .catch(() => { clearTimeout(safetyTimeout); finish(); });
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        clearTimeout(safetyTimeout);
        finish();
      }
    });
  });
}

/**
 * Call the play-cards Edge Function to execute a bot's card play.
 * Uses HTTP fetch to reuse all existing validation logic.
 */
/** Fetch timeout — well within LOCK_TIMEOUT_MS (30 s) so the lease is always released. */
const FETCH_TIMEOUT_MS = 10_000;

async function callPlayCards(
  supabaseUrl: string,
  serviceKey: string,
  roomCode: string,
  playerId: string,
  cards: Card[],
): Promise<{ success: boolean; error?: string; match_ended?: boolean; game_over?: boolean; match_scores?: any[]; final_winner_index?: number | null }> {
  const url = `${supabaseUrl}/functions/v1/play-cards`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    const botAuthKey = Deno.env.get('INTERNAL_BOT_AUTH_KEY') || 'c1d8e407-49ca-4754-a12b-72a819d5bc17';
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        'x-bot-coordinator': 'true', // Signal to skip recursive bot trigger
        ...(botAuthKey ? { 'x-bot-auth': botAuthKey } : {}),
      },
      body: JSON.stringify({
        room_code: roomCode,
        player_id: playerId,
        cards: cards.map(c => ({ id: c.id, rank: c.rank, suit: c.suit })),
        _bot_auth: botAuthKey,  // body-based auth for internal calls (header stripped by relay)
      }),
      signal: controller.signal,
    });
  } catch (fetchErr: any) {
    if (fetchErr?.name === 'AbortError') {
      console.error('[bot-coordinator] ❌ play-cards timed out after 10 s');
      return { success: false, error: 'Request timed out after 10s' };
    }
    return { success: false, error: fetchErr?.message ?? 'fetch error' };
  } finally {
    clearTimeout(timeoutId);
  }

  // Read the body once as text, then parse — avoids the double-consume issue where
  // res.json() consumes the body stream and a subsequent res.text() call returns empty.
  const rawBody = await res.text().catch(() => '');
  let data: any;
  try {
    data = JSON.parse(rawBody);
  } catch (_e) {
    console.error(`[bot-coordinator] ❌ play-cards returned non-JSON body (HTTP ${res.status}):`, rawBody);
    return { success: false, error: `Non-JSON response from play-cards (HTTP ${res.status})` };
  }

  if (!res.ok || !data.success) {
    console.error(`[bot-coordinator] ❌ play-cards failed:`, data);
    return { success: false, error: data.error || `HTTP ${res.status}` };
  }
  return {
    success: true,
    match_ended: data.match_ended,
    game_over: data.game_over,
    match_scores: data.match_scores,
    final_winner_index: data.final_winner_index,
  };
}

/**
 * Call the player-pass Edge Function to execute a bot's pass.
 */
async function callPlayerPass(
  supabaseUrl: string,
  serviceKey: string,
  roomCode: string,
  playerId: string,
): Promise<{ success: boolean; error?: string }> {
  const url = `${supabaseUrl}/functions/v1/player-pass`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    const botAuthKey = Deno.env.get('INTERNAL_BOT_AUTH_KEY') || 'c1d8e407-49ca-4754-a12b-72a819d5bc17';
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        'x-bot-coordinator': 'true',
        ...(botAuthKey ? { 'x-bot-auth': botAuthKey } : {}),
      },
      body: JSON.stringify({
        room_code: roomCode,
        player_id: playerId,
        _bot_auth: botAuthKey,  // body-based auth for internal calls (header stripped by relay)
      }),
      signal: controller.signal,
    });
  } catch (fetchErr: any) {
    if (fetchErr?.name === 'AbortError') {
      console.error('[bot-coordinator] ❌ player-pass timed out after 10 s');
      return { success: false, error: 'Request timed out after 10s' };
    }
    return { success: false, error: fetchErr?.message ?? 'fetch error' };
  } finally {
    clearTimeout(timeoutId);
  }

  // Read the body once as text, then parse — avoids the double-consume issue.
  const rawBody = await res.text().catch(() => '');
  let data: any;
  try {
    data = JSON.parse(rawBody);
  } catch (_e) {
    console.error(`[bot-coordinator] ❌ player-pass returned non-JSON body (HTTP ${res.status}):`, rawBody);
    return { success: false, error: `Non-JSON response from player-pass (HTTP ${res.status})` };
  }

  if (!res.ok || !data.success) {
    console.error(`[bot-coordinator] ❌ player-pass failed:`, data);
    return { success: false, error: data.error || `HTTP ${res.status}` };
  }
  return { success: true };
}

// ==================== MAIN HANDLER ====================

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    // ── Authorization check ──────────────────────────────────────────────────
    // Allow calls from:
    //   a) Internal Edge Function triggers (service-role JWT)
    //   b) Authenticated users — validated as a room member below (after parsing room_code)
    const authHeader = req.headers.get('authorization') ?? '';
    const isServiceRole = serviceKey !== '' && authHeader === `Bearer ${serviceKey}`;
    let callerUserId: string | null = null;

    if (!isServiceRole) {
      // Validate the user JWT using Supabase auth (anon/authenticated callers)
      const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: authError } = await userClient.auth.getUser();
      if (authError || !user) {
        return new Response(
          JSON.stringify({ success: false, error: 'Unauthorized' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      callerUserId = user.id;
    }
    // ─────────────────────────────────────────────────────────────────────────

    const supabaseClient = createClient(supabaseUrl, serviceKey);

    let body: { room_code?: string };
    try {
      body = await req.json();
    } catch (_e) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid JSON body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    const { room_code } = body;

    if (!room_code) {
      return new Response(
        JSON.stringify({ success: false, error: 'room_code is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    console.log(`🤖 [bot-coordinator] Starting for room: ${room_code}`);

    // 1. Get room
    const { data: room, error: roomError } = await supabaseClient
      .from('rooms')
      .select('id, code, status')
      .eq('code', room_code)
      .single();

    if (roomError || !room) {
      console.error('[bot-coordinator] Room not found:', roomError);
      return new Response(
        JSON.stringify({ success: false, error: 'Room not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // 1b. For authenticated (non-service-role) callers, confirm they are in this room.
    if (!isServiceRole && callerUserId) {
      const { data: membership, error: memberError } = await supabaseClient
        .from('room_players')
        .select('id')
        .eq('room_id', room.id)
        .eq('user_id', callerUserId)
        .maybeSingle();

      if (memberError || !membership) {
        return new Response(
          JSON.stringify({ success: false, error: 'Forbidden: not a member of this room' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
    }

    // 2. Get all room players (including bots)
    const { data: roomPlayers, error: playersError } = await supabaseClient
      .from('room_players')
      .select('*')
      .eq('room_id', room.id)
      .order('player_index', { ascending: true });

    if (playersError || !roomPlayers) {
      console.error('[bot-coordinator] Room players not found:', playersError);
      return new Response(
        JSON.stringify({ success: false, error: 'Room players not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // 3. Acquire a row-based coordinator lease to prevent concurrent bot coordinators.
    //    Row-based leases work reliably across all PgBouncer/pooled connections,
    //    unlike pg_advisory_lock which is session-scoped and can leak across pools.
    //    Retry up to 3× with 500 ms backoff so transient contention (two Edge Function
    //    invocations landing within milliseconds of each other) doesn't cause a missed
    //    bot turn. Each retry is still well within the LOCK_TIMEOUT_MS budget.
    const MAX_LEASE_RETRIES = 3;
    const LEASE_RETRY_DELAY_MS = 500;
    const coordinatorId = crypto.randomUUID();
    const leaseTimeoutSeconds = Math.ceil((LOCK_TIMEOUT_MS * 1.5) / 1000);

    let leaseAcquired = false;
    const leaseErrors: string[] = [];

    for (let leaseAttempt = 0; leaseAttempt < MAX_LEASE_RETRIES; leaseAttempt++) {
      // Bail out early if overall timeout has been hit
      if (Date.now() - startTime > LOCK_TIMEOUT_MS) break;

      const { data, error } = await supabaseClient
        .rpc('try_acquire_bot_coordinator_lease', {
          p_room_code: room_code,
          p_coordinator_id: coordinatorId,
          // Use 1.5× the loop budget so the lease outlives even a worst-case run.
          // If p_timeout_seconds == LOCK_TIMEOUT_MS and an HTTP call stalls near the
          // deadline, the lease can expire mid-run allowing a second coordinator to overlap.
          p_timeout_seconds: leaseTimeoutSeconds,
        });

      if (error) {
        leaseErrors.push(error.message);
        break; // DB error — don't retry
      }

      if (data === true) {
        leaseAcquired = true;
        break;
      }

      console.log(`[bot-coordinator] ⏳ Lease contention (attempt ${leaseAttempt + 1}/${MAX_LEASE_RETRIES}), retrying in ${LEASE_RETRY_DELAY_MS}ms...`);
      await delay(LEASE_RETRY_DELAY_MS);
    }

    if (leaseErrors.length > 0) {
      console.error('[bot-coordinator] Failed to acquire coordinator lease:', leaseErrors);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to acquire coordinator lease' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (!leaseAcquired) {
      console.log('[bot-coordinator] ⏳ Another coordinator is already running for this room after retries, skipping');
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: 'concurrent_coordinator' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // 4. Bot turn execution loop
    let movesExecuted = 0;
    let lastError: string | null = null;
    let lastExitReason: string | null = null;
    // Track whether a match/game ended during bot play so we can start the next match
    let matchEndedData: {
      match_ended: boolean;
      game_over: boolean;
      match_scores?: any[];
      final_winner_index?: number | null;
      match_number?: number;
    } | null = null;

    try {
      for (let iteration = 0; iteration < MAX_BOT_MOVES; iteration++) {
        // Check timeout
        if (Date.now() - startTime > LOCK_TIMEOUT_MS) {
          console.warn('[bot-coordinator] ⏰ Timeout reached, stopping');
          break;
        }

        // Refresh lease every 3 iterations to prevent expiry during long-running loops.
        // lease expiry defaults to 45 s; after 3 moves (~3 s at 300 ms delay + fetch
        // latency) we are well within budget, but over 10+ moves without refresh the
        // lease can expire and allow a concurrent coordinator to acquire it.
        if (iteration > 0 && iteration % 3 === 0) {
          const { data: refreshed, error: refreshErr } = await supabaseClient
            .rpc('refresh_bot_coordinator_lease', {
              p_room_code: room_code,
              p_coordinator_id: coordinatorId,
              p_timeout_seconds: leaseTimeoutSeconds,
            });
          if (refreshErr || !refreshed) {
            // Another coordinator may have stolen the lease — stop to avoid dual execution.
            console.warn('[bot-coordinator] ⚠️ Lease refresh failed (stolen or expired), stopping');
            break;
          }
        }

        // Fetch fresh game state
        const { data: gameState, error: gsError } = await supabaseClient
          .from('game_state')
          .select('*')
          .eq('room_id', room.id)
          .single();

        if (gsError || !gameState) {
          console.error('[bot-coordinator] Game state not found:', gsError);
          lastError = 'Game state not found';
          lastExitReason = `game_state_not_found: ${gsError?.message}`;
          break;
        }

        const gs = gameState as GameState;

        // Check if game is still active
        if (gs.game_phase === 'finished' || gs.game_phase === 'game_over') {
          console.log(`[bot-coordinator] 🏁 Game phase is '${gs.game_phase}', stopping`);
          lastExitReason = `game_phase_${gs.game_phase}`;
          break;
        }

        // Re-fetch the current-turn player from DB on every iteration.
        // This is the PRIMARY fix for the game-freeze-on-rejoin bug:
        // the initial `roomPlayers` snapshot is fetched ONCE before this loop,
        // so it cannot detect a human reclaiming their seat mid-run.
        // A fresh DB read ensures that when reconnect_player() sets is_bot=FALSE,
        // the coordinator sees it on the next iteration and stops immediately.
        const { data: freshTurnPlayer, error: freshPlayerErr } = await supabaseClient
          .from('room_players')
          .select('*')
          .eq('room_id', room.id)
          .eq('player_index', gs.current_turn)
          .maybeSingle();

        if (freshPlayerErr) {
          console.error('[bot-coordinator] Error fetching turn player:', freshPlayerErr.message);
          lastError = 'Failed to fetch current turn player';
          lastExitReason = `player_fetch_error: ${freshPlayerErr.message}`;
          break;
        }

        // Prefer fresh DB row; fall back to initial snapshot only if row vanished
        const currentPlayer = (freshTurnPlayer as RoomPlayer | null) ??
          (roomPlayers.find(p => p.player_index === gs.current_turn) as RoomPlayer | undefined);

        if (!currentPlayer || !currentPlayer.is_bot) {
          console.log(`[bot-coordinator] 👤 Turn ${gs.current_turn} is human (${currentPlayer?.username || 'unknown'}), stopping`);
          lastExitReason = `human_turn_${gs.current_turn}`;
          break;
        }

        console.log(`🤖 [bot-coordinator] Bot turn: ${currentPlayer.username} (index ${currentPlayer.player_index}, difficulty ${currentPlayer.bot_difficulty || 'medium'})`);

        // Get bot's hand
        const botHandRaw = gs.hands?.[currentPlayer.player_index] || [];
        const botHand = parseCards(botHandRaw) as Card[];

        if (botHand.length === 0) {
          console.warn(`[bot-coordinator] ⚠️ Bot ${currentPlayer.username} has no cards, skipping`);
          lastExitReason = `empty_hand_player_${currentPlayer.player_index}`;
          break;
        }

        // Build player card counts for BotAI
        const playerCardCounts: number[] = [];
        for (let i = 0; i < 4; i++) {
          const handRaw = gs.hands?.[i] || [];
          playerCardCounts.push(Array.isArray(handRaw) ? handRaw.length : 0);
        }

        // Calculate next player index (counterclockwise: 0→1→2→3→0)
        const nextPlayerIndex = (currentPlayer.player_index + 1) % 4;

        // Parse last play
        const lastPlay = gs.last_play || null;

        // Determine if this is the first play of the game
        const playedCards = gs.played_cards || [];
        const isFirstPlay = playedCards.length === 0;
        const matchNumber = gs.match_number || 1;

        // ── Auto-pass timer override ────────────────────────────────────────────
        // When auto_pass_timer is active AND expired, all non-exempt players MUST pass.
        // The bot missed its turn window — override BotAI and force a pass.
        // Combined with the player-pass fix that skips the One Card Left Rule during
        // auto-pass scenarios, this guarantees the game always advances out of a
        // stuck timer state.
        const timerData = gs.auto_pass_timer as {
          active?: boolean;
          end_timestamp?: number;
          started_at?: string;
          duration_ms?: number;
          triggering_play?: { position?: number };
          player_index?: number;
        } | null;

        let forcePass = false;
        if (timerData?.active) {
          const endTimestamp =
            timerData.end_timestamp ||
            (timerData.started_at
              ? new Date(timerData.started_at).getTime() + (timerData.duration_ms || 0)
              : 0);
          const isExpired = Date.now() >= endTimestamp;
          if (isExpired) {
            const exemptIndex =
              timerData.triggering_play?.position ?? timerData.player_index;
            forcePass =
              typeof exemptIndex === 'number' &&
              currentPlayer.player_index !== exemptIndex;
            if (forcePass) {
              console.log(
                `⏰ [bot-coordinator] Auto-pass timer expired — forcing pass for bot ${currentPlayer.username} (index ${currentPlayer.player_index}, exempt=${exemptIndex})`,
              );
            }
          }
        }
        // ────────────────────────────────────────────────────────────────────────

        // Create BotAI and make decision
        const difficulty: BotDifficulty = (currentPlayer.bot_difficulty as BotDifficulty) || 'medium';
        const botAI = new BotAI(difficulty);
        const decision = forcePass
          ? { cards: null, reasoning: 'Auto-pass timer expired — forced pass' }
          : botAI.getPlay({
              hand: botHand,
              lastPlay,
              isFirstPlayOfGame: isFirstPlay,
              matchNumber,
              playerCardCounts,
              currentPlayerIndex: currentPlayer.player_index,
              nextPlayerIndex,
            });

        console.log(`[bot-coordinator] 🎯 Bot decision: ${decision.cards ? `play ${decision.cards.length} cards` : 'pass'} — ${decision.reasoning}`);

        // Execute the decision
        if (decision.cards) {
          // Map card IDs to full card objects from hand
          const cardsToPlay: Card[] = [];
          for (const cardId of decision.cards) {
            const card = botHand.find(c => c.id === cardId);
            if (card) {
              cardsToPlay.push(card);
            } else {
              console.error(`[bot-coordinator] ❌ Card ${cardId} not found in bot's hand`);
              lastError = `Card ${cardId} not found in bot's hand`;
              lastExitReason = `card_not_found: ${cardId}`;
              break;
            }
          }

          if (lastError) break;

          const result = await callPlayCards(supabaseUrl, serviceKey, room.code, currentPlayer.id, cardsToPlay);
          if (!result.success) {
            lastError = result.error || 'play-cards failed';
            lastExitReason = `play_cards_failed: ${lastError}`;
            console.error(`[bot-coordinator] ❌ Bot play failed: ${lastError}`);
            break;
          }

          movesExecuted++;
          console.log(`✅ [bot-coordinator] Bot played successfully (move #${movesExecuted})`);

          // If match ended or game over, stop
          if (result.match_ended || result.game_over) {
            matchEndedData = {
              match_ended: !!result.match_ended,
              game_over: !!result.game_over,
              match_scores: result.match_scores,
              final_winner_index: result.final_winner_index,
              match_number: gs.match_number || 1,
            };
            console.log(`[bot-coordinator] 🏁 Match/game ended after bot play (game_over=${result.game_over})`);
            break;
          }
        } else {
          // Pass
          const result = await callPlayerPass(supabaseUrl, serviceKey, room.code, currentPlayer.id);
          if (!result.success) {
            lastError = result.error || 'player-pass failed';
            lastExitReason = `player_pass_failed: ${lastError}`;
            console.error(`[bot-coordinator] ❌ Bot pass failed: ${lastError}`);
            break;
          }

          movesExecuted++;
          console.log(`✅ [bot-coordinator] Bot passed successfully (move #${movesExecuted})`);
        }

        // Delay for Realtime propagation and smooth animation
        await delay(BOT_MOVE_DELAY_MS);
      }
    } finally {
      // 5. Release coordinator lease
      try {
        const { error: releaseError } = await supabaseClient
          .rpc('release_bot_coordinator_lease', {
            p_room_code: room_code,
            p_coordinator_id: coordinatorId,
          });
        if (releaseError) {
          console.error('[bot-coordinator] Lease release error:', releaseError);
        }
      } catch (err: any) {
        console.error('[bot-coordinator] Lease release exception:', err);
      }
    }

    // ─── Post-loop: handle match / game end triggered by a bot play ───────────
    if (matchEndedData?.match_ended && !matchEndedData.game_over) {
      // A bot won the match (but the overall game continues).
      // The client-side coordinator (useServerBotCoordinator) stops when it sees
      // game_phase='finished', so nobody calls start_new_match.  We must do it here.
      console.log('[bot-coordinator] 🔄 Bot won match — calling start_new_match in 500ms...');
      await delay(500); // Let the final play-cards update propagate via Realtime

      // CRITICAL: await the start_new_match call — fire-and-forget is unreliable in
      // Deno Edge Functions because the runtime may terminate dangling promises once
      // the handler returns a Response.  Awaiting ensures the next match actually starts.
      // Bounded by FETCH_TIMEOUT_MS so a hung start_new_match doesn't block indefinitely.
      try {
        const snmController = new AbortController();
        const snmTimeoutId = setTimeout(() => snmController.abort(), FETCH_TIMEOUT_MS);
        let snmRes: Response;
        try {
          snmRes = await fetch(`${supabaseUrl}/functions/v1/start_new_match`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${serviceKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              room_id: room.id,
              expected_match_number: matchEndedData.match_number,
            }),
            signal: snmController.signal,
          });
        } finally {
          clearTimeout(snmTimeoutId);
        }
        if (!snmRes.ok) {
          const errBody = await snmRes.text().catch(() => '(unreadable)');
          console.error(`[bot-coordinator] ⚠️ start_new_match failed (${snmRes.status}):`, errBody);
        } else {
          console.log('[bot-coordinator] ✅ start_new_match succeeded — next match started');
        }
      } catch (snmErr: any) {
        console.error('[bot-coordinator] ⚠️ start_new_match fetch error:', snmErr?.message);
      }

      // Broadcast match_ended so all clients update their local scoreboards.
      // Uses subscribe → send → removeChannel as required by supabase-js v2 Realtime.
      try {
        await broadcastToRoom(supabaseClient, room.id, 'match_ended', {
          winner_index: matchEndedData.final_winner_index ?? null,
          match_number: matchEndedData.match_number ?? 1,
          match_scores: matchEndedData.match_scores ?? [],
        });
        console.log('[bot-coordinator] 📡 Broadcast: match_ended (winner=' + (matchEndedData.final_winner_index ?? null) + ')');
      } catch (bcastErr: any) {
        console.warn('[bot-coordinator] ⚠️ match_ended broadcast failed (non-critical):', bcastErr?.message);
      }
    } else if (matchEndedData?.game_over) {
      // The entire game is over (someone reached 101+).
      // Broadcast game_over so clients open the game-end modal.
      console.log('[bot-coordinator] 🎉 Game over — broadcasting to clients...');
      try {
        await broadcastToRoom(supabaseClient, room.id, 'game_over', {
          winner_index: matchEndedData.final_winner_index ?? null,
          final_scores: matchEndedData.match_scores ?? [],
        });
        console.log('[bot-coordinator] 📡 Broadcast: game_over');
      } catch (bcastErr: any) {
        console.warn('[bot-coordinator] ⚠️ game_over broadcast failed (non-critical):', bcastErr?.message);
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`🤖 [bot-coordinator] Done: ${movesExecuted} moves in ${elapsed}ms${lastError ? ` (last error: ${lastError})` : ''}${lastExitReason ? ` (exit: ${lastExitReason})` : ''}`);

    return new Response(
      JSON.stringify({
        success: true,
        moves_executed: movesExecuted,
        elapsed_ms: elapsed,
        error: lastError,
        exit_reason: lastExitReason,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error: any) {
    console.error('[bot-coordinator] ❌ Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

