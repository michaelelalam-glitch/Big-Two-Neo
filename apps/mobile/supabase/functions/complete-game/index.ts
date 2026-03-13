import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

interface GameCompletionRequest {
  room_id: string | null; // Must be valid UUID or null for local games
  room_code: string;
  game_type: 'casual' | 'ranked' | 'private'; // Game mode
  /** Difficulty of bot players in this game, if any (e.g. 'easy'|'medium'|'hard'). null for human-only games. */
  bot_difficulty?: string | null;
  players: {
    user_id: string;
    username: string;
    score: number;
    finish_position: number;
    cards_left: number; // Cards remaining at end of game
    was_bot: boolean; // Whether this player slot is a bot
    disconnected: boolean; // Whether player disconnected
    original_username: string | null; // Original player name before bot replaced them
    combos_played: {
      singles: number;
      pairs: number;
      triples: number;
      straights: number;
      flushes: number;
      full_houses: number;
      four_of_a_kinds: number;
      straight_flushes: number;
      royal_flushes: number;
    };
  }[];
  winner_id: string;
  game_duration_seconds: number;
  started_at: string;
  finished_at: string;
  game_completed: boolean; // Whether game reached natural conclusion (no forfeit)
  // NOTE: voided_player_id is intentionally NOT accepted from the client.
  // The server deterministically computes who was the last human to leave by
  // sorting on COALESCE(room_players.disconnect_timer_started_at, disconnected_at) DESC
  // — this prevents a malicious client from setting voided_player_id to another
  // player to avoid abandonment penalties. last_seen_at is intentionally excluded
  // because it is contaminated by bot heartbeats for replaced players.
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ─── Helper: broadcast game_ended to all room clients ────────────────────────
// Called from both the normal path (Step 5) and the dedup/23505 short-circuit
// paths so clients are never left waiting for a game_ended event even when the
// winning caller crashes before reaching Step 5.
//
// Uses the same Promise-based subscribe→send→removeChannel pattern as
// bot-coordinator/broadcastToRoom: channel.subscribe() is synchronous in
// supabase-js v2 (returns a RealtimeChannel, not a Promise), so we wrap the
// entire flow in a new Promise that resolves once the broadcast is sent (or on
// error/timeout). A 5-second safety timeout prevents the channel from leaking.
//
// FIRE-AND-FORGET: all call sites use `void broadcastGameEnded(...)` so the
// edge function response is not held up by the Realtime subscribe→send flow.
// Broadcast failures are logged but never cause the HTTP response to fail.
async function broadcastGameEnded(
  client: ReturnType<typeof createClient>,
  gameData: { room_id?: string | null; room_code?: string; winner_id: string; players: Array<{ user_id: string; username: string; score: number; finish_position: number }> }
): Promise<void> {
  if (!gameData.room_id) return;
  try {
    const winnerPlayer = gameData.players.find(p => p.user_id === gameData.winner_id);
    // Sort by finish_position (already validated as 1–4, unique, winner=1) so the
    // finalScores array is in finish order for display purposes.
    // Use p.finish_position as the single source of truth for both finish_position
    // and rank — avoids the mismatch that arose when finish_position was derived
    // from a score sort (finishIdx+1) while rank came from the client-validated
    // p.finish_position, which could diverge on ties or future rule changes.
    const finalScores = [...gameData.players]
      .sort((a, b) => a.finish_position - b.finish_position)
      .map((p) => ({
        // player_index is the original seat/array index so it aligns with
        // game_winner_index (which also uses the original players array).
        player_index: gameData.players.findIndex(orig => orig.user_id === p.user_id),
        player_name: p.username,
        cumulative_score: p.score,
        points_added: 0,
        finish_position: p.finish_position, // single source of truth: validated by Step 1
        rank: p.finish_position,             // same field; kept for backwards-compat payload shape
        is_busted: p.score >= 101,
      }));
    const broadcastPayload = {
      game_winner_name: winnerPlayer?.username || 'Unknown',
      game_winner_index: gameData.players.findIndex(p => p.user_id === gameData.winner_id),
      final_scores: finalScores,
      room_code: gameData.room_code,
    };
    await new Promise<void>((resolve) => {
      const channel = client.channel(`room:${gameData.room_id}`);
      let settled = false;
      const finish = (): void => {
        if (!settled) {
          settled = true;
          client.removeChannel(channel).catch(() => {});
          resolve();
        }
      };
      // Safety net: always resolve after 5 s to avoid blocking the edge function
      const safetyTimeout = setTimeout(finish, 5000);
      channel.subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          channel
            .send({ type: 'broadcast', event: 'game_ended', payload: broadcastPayload })
            .then((result: unknown) => {
              // Realtime send() resolves (not rejects) on error; check the result object.
              const res = result as { error?: string } | null;
              if (res?.error) {
                console.error('[Complete Game] broadcastGameEnded: send returned error:', res.error);
              }
              clearTimeout(safetyTimeout);
              finish();
            })
            .catch((broadcastError: unknown) => {
              console.error('[Complete Game] broadcastGameEnded: failed to send:', broadcastError);
              clearTimeout(safetyTimeout);
              finish();
            });
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          // Channel failed — resolve the internal Promise immediately to free Deno
          // runtime resources. The HTTP response is never delayed: all callers
          // invoke `void broadcastGameEnded(...)` (fire-and-forget).
          clearTimeout(safetyTimeout);
          finish();
        }
      });
    });
  } catch (err) {
    console.warn('[Complete Game] broadcastGameEnded error (non-critical):', err);
  }
}


  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get service_role client for privileged operations
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    // Get authenticated user from request
    const authHeader = req.headers.get('Authorization')!;
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const gameData: GameCompletionRequest = await req.json();

    console.log('[Complete Game] Processing game completion:', {
      room_code: gameData.room_code,
      winner_id: gameData.winner_id,
      players_count: gameData.players.length,
    });

    // ============================================================================
    // STEP 1: VALIDATE GAME DATA
    // ============================================================================

    // ITEM 1: 'CASUAL' games (human + bots, room_id=null) are valid and should save stats.
    // Only reject if room_code is exactly 'LOCAL' (legacy test/debug games with no human player).
    if (gameData.room_code === 'LOCAL') {
      console.log('[Complete Game] Rejected: LOCAL game code — stats not saved');
      return new Response(
        JSON.stringify({ error: 'LOCAL game code is reserved for test/debug only', code: 'LOCAL_GAME_REJECTED' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate game_type
    const validGameTypes = ['casual', 'ranked', 'private'];
    if (!validGameTypes.includes(gameData.game_type)) {
      return new Response(
        JSON.stringify({ error: 'Invalid game_type. Must be casual, ranked, or private' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify the requesting user is one of the players
    const requestingPlayer = gameData.players.find(p => p.user_id === user.id);
    if (!requestingPlayer) {
      return new Response(
        JSON.stringify({ error: 'User not part of this game' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate game data integrity
    if (gameData.players.length !== 4) {
      return new Response(
        JSON.stringify({ error: 'Invalid game: must have 4 players' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify winner is one of the players
    const winner = gameData.players.find(p => p.user_id === gameData.winner_id);
    if (!winner) {
      return new Response(
        JSON.stringify({ error: 'Invalid winner_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify finish positions are valid (1-4, no duplicates)
    const positions = gameData.players.map(p => p.finish_position).sort();
    if (positions.join(',') !== '1,2,3,4') {
      return new Response(
        JSON.stringify({ error: 'Invalid finish positions' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify winner has position 1 (lowest score wins in Big Two)
    if (winner.finish_position !== 1) {
      return new Response(
        JSON.stringify({ error: 'Winner must have position 1' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ============================================================================
    // STEP 2: VALIDATE ROOM_ID (must be UUID or null)
    // ============================================================================
    
    // Validate room_id: must be null (local games) or valid UUID format
    if (gameData.room_id !== null) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(gameData.room_id)) {
        console.error(`[Complete Game] Invalid room_id format: ${gameData.room_id}`);
        return new Response(
          JSON.stringify({ error: 'room_id must be a valid UUID or null' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // ============================================================================
    // STEP 2b: DEDUPLICATION GUARD — only ONE client should record per game
    // ============================================================================
    // In a 4-human game every client calls complete-game when game_phase →
    // 'game_over'. Without this guard, game_history gets N rows and
    // update_player_stats_after_game runs N× per player, quadrupling stats.
    //
    // The guard checks for an existing game_history row with the same room_id.
    // The first caller wins; subsequent callers receive a 200 (not an error)
    // because from each client's perspective the game *did* complete.
    //
    // stats_applied_at tracks whether the winning caller completed all stats.
    // When IS NULL the winner crashed between INSERT and stats RPCs — the
    // state is partially failed. Stats cannot be re-applied automatically
    // (update_player_stats_after_game is NOT idempotent; re-running would
    // double-count). We log the failure visibly and still short-circuit.
    // Admin diagnostic: SELECT * FROM game_history WHERE stats_applied_at IS NULL;
    //
    // ── DEPLOYMENT ORDER (Step 2b — single authoritative sequence) ────────────
    // Step 1 — Deploy this Edge Function FIRST (safe before the index exists):
    //   The SELECT-based dedup guard + 23505 handler return 200 for duplicates
    //   instead of re-inserting, preventing new duplicates from the moment the
    //   updated function goes live. The old function must be replaced before
    //   migration 000001 runs so it cannot race-insert a duplicate between the
    //   DELETE and CREATE UNIQUE INDEX steps inside that migration.
    //
    // Step 2 — Apply migration 20260313000001 (dedup existing rows + add UNIQUE
    //   index on game_history(room_id)).  This is the primary race-safety
    //   guarantee at the DB level; without it the 23505 path below is unreachable
    //   and the SELECT-based dedup above is the only guard (sufficient but weaker).
    //
    // OPTIONAL (but strongly recommended for partial-failure observability):
    //   migration 20260313000002 may be applied any time before or after this
    //   function is deployed. The SELECT below queries `stats_applied_at`;
    //   if the column is absent PostgREST returns an error that is caught by
    //   dupCheckError — the function falls through and processes the game
    //   normally. Applying migration 00002 enables the age-based partial-failure
    //   detection but is not required for correct deduplication.
    // ──────────────────────────────────────────────────────────────────────────
    if (gameData.room_id) {
      const { data: existingRow, error: dupCheckError } = await supabaseAdmin
        .from('game_history')
        .select('id, stats_applied_at, created_at')
        .eq('room_id', gameData.room_id)
        // Prefer the most-complete row: stats_applied_at set > null, then earliest by created_at.
        // During the brief window before the dedup migration runs, duplicate rows may exist;
        // this ordering ensures we always find the fully-applied row if one exists.
        .order('stats_applied_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (dupCheckError) {
        // If the error is because the stats_applied_at column doesn't exist yet
        // (migration 00002 not yet applied), fall back to a simpler id-only query
        // so dedup still works before that optional migration runs.
        const isColumnMissing =
          dupCheckError.message?.includes('stats_applied_at') ||
          (dupCheckError as { code?: string }).code === '42703';
        if (isColumnMissing) {
          console.warn('[Complete Game] stats_applied_at column absent — using id-only fallback dedup');
          const { data: fallbackRow, error: fallbackErr } = await supabaseAdmin
            .from('game_history')
            .select('id')
            .eq('room_id', gameData.room_id)
            .limit(1)
            .maybeSingle();
          if (!fallbackErr && fallbackRow) {
            console.log(`[Complete Game] ⏭️ Dedup (fallback): game already recorded for room ${gameData.room_id} — skipping duplicate`);
            const { error: roomEndErr } = await supabaseAdmin
              .from('rooms')
              .update({ status: 'finished' })
              .eq('id', gameData.room_id);
            if (roomEndErr) {
              console.warn('[Complete Game] Failed to mark room finished in fallback dedup path:', roomEndErr.message);
            }
            void broadcastGameEnded(supabaseAdmin, gameData);
            return new Response(
              JSON.stringify({ success: true, message: 'Game already recorded by another client', duplicate: true }),
              { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
        } else {
          console.warn('[Complete Game] Dedup check failed (proceeding):', dupCheckError.message);
        }
      } else if (existingRow) {
        if (existingRow.stats_applied_at === null) {
          // stats_applied_at IS NULL means either:
          //   a) Winning caller is still in-progress (stats RPCs not yet done) — normal race window.
          //   b) Winning caller crashed before completing stats — true partial failure.
          // Distinguish with a 30-second age threshold: fresh rows are likely in-progress;
          // stale rows indicate a real crash. Only escalate to console.error for stale rows.
          const rowAgeMs = existingRow.created_at
            ? Date.now() - new Date(existingRow.created_at).getTime()
            : Infinity;
          if (rowAgeMs < 30_000) {
            console.warn(`[Complete Game] ⏳ Dedup: game_history exists for room ${gameData.room_id}, stats_applied_at null (row age ${Math.round(rowAgeMs / 1000)}s) — likely in progress`);
          } else {
            // Row is stale (>30 s): winning caller almost certainly crashed.
            // Stats are unrecoverable here (non-idempotent update_player_stats_after_game
            // would double-count). Log as error for admin diagnosis.
            console.error(`[Complete Game] ⚠️ Partial failure detected for room ${gameData.room_id} — game_history exists but stats_applied_at is null (row age ${Math.round(rowAgeMs / 1000)}s). Stats may be missing. Admin diagnostic: SELECT * FROM game_history WHERE stats_applied_at IS NULL;`);
          }
        } else {
          console.log(`[Complete Game] ⏭️ Game fully recorded for room ${gameData.room_id} (stats_applied_at set) — skipping duplicate`);
        }
        // Only mark the room as finished (idempotent). Do NOT delete room_players
        // here — the winning caller may still be mid-way through Step 3, querying
        // room_players for bot-replaced humans / bot difficulty. Deleting rows
        // early would corrupt those queries.
        if (gameData.room_id) {
          const { error: roomEndErr } = await supabaseAdmin
            .from('rooms')
            .update({ status: 'finished' })
            .eq('id', gameData.room_id);
          if (roomEndErr) {
            console.warn('[Complete Game] Failed to mark room finished in duplicate path:', roomEndErr.message);
          }
          // Broadcast game_ended so clients are not blocked even if the winning
          // caller crashed before reaching Step 5. Idempotent from client side.
          void broadcastGameEnded(supabaseAdmin, gameData);
        }
        return new Response(
          JSON.stringify({
            success: true,
            message: existingRow.stats_applied_at !== null
              ? 'Game already recorded by another client'
              : 'Game already recorded but stats may be partial — see server logs',
            duplicate: true,
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // ============================================================================
    // STEP 3: RECORD GAME HISTORY (for audit trail)
    // ============================================================================

    // ── Determine voided player server-side (before insert so voided_user_id is stored) ──
    // Must also run before Step 3b which deletes room_players rows.
    //
    // Do NOT trust the client for this — a malicious caller could name any player
    // as voided to deny them an "abandoned" stat.  Instead, find the human with
    // the most-recent heartbeat-anchored disconnect timestamp in the room.
    //
    // Two categories of "gone" humans:
    //   1. is_bot=false, connection_status='disconnected': still-disconnected;
    //      disconnect_timer_started_at is the Phase-A heartbeat-anchored anchor.
    //   2. is_bot=true,  human_user_id IS NOT NULL:        replaced by bot;
    //      disconnected_at and disconnect_timer_started_at were both cleared on
    //      replacement; last_seen_at is updated by bot heartbeats (contaminated).
    //      Do NOT use last_seen_at in the sort key — fall back to NULL so replaced
    //      humans always sort AFTER still-disconnected humans.
    let serverVoidedPlayerId: string | null = null;
    if (!gameData.game_completed && gameData.room_id) {
      const { data: allGoneRows, error: lastGoneError } = await supabaseAdmin
        .from('room_players')
        .select('user_id, human_user_id, disconnect_timer_started_at, disconnected_at, is_bot')
        .eq('room_id', gameData.room_id)
        .in('connection_status', ['disconnected', 'replaced_by_bot']);

      if (lastGoneError) {
        console.error('[Complete Game] Failed to query voided player — all players will be recorded as abandoned:', lastGoneError.message);
      }

      if (allGoneRows && allGoneRows.length > 0) {
        // Sort by COALESCE(disconnect_timer_started_at, disconnected_at) DESC.
        // last_seen_at is intentionally excluded: for replaced_by_bot rows it
        // reflects bot heartbeats rather than the human's actual disconnect time.
        const candidates = allGoneRows
          .map(r => ({
            effectiveUserId: r.is_bot ? r.human_user_id : r.user_id,
            sortKey: r.disconnect_timer_started_at ?? r.disconnected_at as string | null,
          }))
          .filter(c => c.effectiveUserId != null);

        candidates.sort((a, b) => {
          if (!a.sortKey && !b.sortKey) {
            // Deterministic tiebreak when both timers are null (e.g., all replaced_by_bot rows):
            // sort by user_id string so the chosen voidedPlayerId is stable across re-runs.
            return (a.effectiveUserId ?? '').localeCompare(b.effectiveUserId ?? '');
          }
          if (!a.sortKey) return 1;
          if (!b.sortKey) return -1;
          return new Date(b.sortKey).getTime() - new Date(a.sortKey).getTime();
        });

        const lastGone = candidates[0];
        if (lastGone?.effectiveUserId) {
          // Sanity check: the player must be in the submitted player list
          const inList = gameData.players.some(p => p.user_id === lastGone.effectiveUserId);
          if (inList) {
            serverVoidedPlayerId = lastGone.effectiveUserId;
            console.log(`[Complete Game] Server-computed voided player: ${serverVoidedPlayerId}`);
          }
        }
      }
    }

    // Filter out bot players - only record real user IDs in game_history
    // Bot user_ids like "bot_player-1" don't exist in auth.users and would violate FK constraints
    // NOTE: This results in NULL values for bot player_id columns in game_history, which is expected
    // behavior since bots don't have auth.users records. Usernames are still preserved for all players.
    const realPlayers = gameData.players.map(p => p.user_id.startsWith('bot_') ? null : p.user_id);

    const { error: historyError } = await supabaseAdmin
      .from('game_history')
      .insert({
        room_id: gameData.room_id,
        room_code: gameData.room_code,
        game_type: gameData.game_type,
        player_1_id: realPlayers[0],
        player_2_id: realPlayers[1],
        player_3_id: realPlayers[2],
        player_4_id: realPlayers[3],
        player_1_username: gameData.players[0].username,
        player_2_username: gameData.players[1].username,
        player_3_username: gameData.players[2].username,
        player_4_username: gameData.players[3].username,
        player_1_score: gameData.players[0].score,
        player_2_score: gameData.players[1].score,
        player_3_score: gameData.players[2].score,
        player_4_score: gameData.players[3].score,
        // Bot tracking: original username before bot replacement
        player_1_original_username: gameData.players[0].original_username,
        player_2_original_username: gameData.players[1].original_username,
        player_3_original_username: gameData.players[2].original_username,
        player_4_original_username: gameData.players[3].original_username,
        // Bot flags
        player_1_was_bot: gameData.players[0].was_bot,
        player_2_was_bot: gameData.players[1].was_bot,
        player_3_was_bot: gameData.players[2].was_bot,
        player_4_was_bot: gameData.players[3].was_bot,
        // Disconnect flags
        player_1_disconnected: gameData.players[0].disconnected,
        player_2_disconnected: gameData.players[1].disconnected,
        player_3_disconnected: gameData.players[2].disconnected,
        player_4_disconnected: gameData.players[3].disconnected,
        // Cards left in hand at end
        player_1_cards_left: gameData.players[0].cards_left,
        player_2_cards_left: gameData.players[1].cards_left,
        player_3_cards_left: gameData.players[2].cards_left,
        player_4_cards_left: gameData.players[3].cards_left,
        // Bot difficulty (same for all bots in a game)
        bot_difficulty: gameData.bot_difficulty ?? null,
        // Game completion
        game_completed: gameData.game_completed,
        winner_id: gameData.winner_id.startsWith('bot_') ? null : gameData.winner_id,
        game_duration_seconds: gameData.game_duration_seconds,
        started_at: gameData.started_at,
        finished_at: gameData.finished_at,
        // Voided player: null for completed games, set when last human left an unfinished game
        voided_user_id: serverVoidedPlayerId,
      });

    if (historyError) {
      // Unique constraint violation on room_id = race-condition duplicate.
      // Another client's INSERT landed between our SELECT check and this INSERT.
      // Treat it the same as the dedup guard above: return 200, skip stats.
      if (historyError.code === '23505') {
        // Race-condition duplicate: another caller's INSERT committed between our
        // SELECT check and this INSERT. The winning caller may not have applied
        // stats yet (stats_applied_at IS NULL). We cannot re-apply stats here
        // (non-idempotent function), but we mark the room ended and broadcast so
        // clients are not blocked. See admin diagnostic in Step 2b comment.
        console.log(`[Complete Game] ⏭️ Unique constraint hit for room ${gameData.room_id} — duplicate (race), skipping`);
        // Only mark the room as finished (idempotent). Do NOT delete room_players —
        // the winning caller is still executing Step 3 and reads room_players.
        if (gameData.room_id) {
          const { error: roomEndErr } = await supabaseAdmin
            .from('rooms')
            .update({ status: 'finished' })
            .eq('id', gameData.room_id);
          if (roomEndErr) {
            console.warn('[Complete Game] Failed to mark room finished in 23505 path:', roomEndErr.message);
          }
          // Broadcast game_ended so clients are not blocked if the winning
          // caller crashes before reaching Step 5. Idempotent from client side.
          void broadcastGameEnded(supabaseAdmin, gameData);
        }
        return new Response(
          JSON.stringify({
            success: true,
            message: 'Game already recorded by another client (race)',
            duplicate: true,
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      console.error('[Complete Game] Failed to record game history:', historyError);
      return new Response(
        JSON.stringify({ error: 'Failed to record game history', details: historyError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[Complete Game] Game history recorded successfully');

    // ============================================================================
    // STEP 3: UPDATE PLAYER STATS (for each REAL player only, skip bots)
    // ============================================================================

    // serverVoidedPlayerId is computed in STEP 3 above (before game_history insert)
    // to allow storing voided_user_id in the audit trail.

    // Query for humans who were replaced by bots BEFORE room_players is deleted in Step 3b.
    // These players left mid-game and must receive an ABANDONED stat regardless of whether
    // the game completed or not.  The client sends their slot as user_id="bot_X" which
    // would otherwise be silently filtered out by the realPlayerData filter below.
    // Must be queried here — after this point Step 3b deletes the room_players rows.
    let botReplacedHumanIds: string[] = [];
    // Server-authoritative bot difficulty: queried from room_players, never trusted from the client.
    // This prevents ELO manipulation via a spoofed bot_difficulty=null payload.
    let serverBotDifficulty: string | null = null;
    if (gameData.room_id) {
      // Fetch ALL bot rows (replacements + still-present bots) to get difficulty.
      // Removing the human_user_id IS NOT NULL filter so regular bot rows also
      // contribute their difficulty for the multiplier determination.
      const { data: replacedRows, error: replacedError } = await supabaseAdmin
        .from('room_players')
        .select('human_user_id, bot_difficulty')
        .eq('room_id', gameData.room_id)
        .eq('is_bot', true);

      if (replacedError) {
        console.error('[Complete Game] Failed to query bot-replaced humans (abandoned stats may be missed):', replacedError.message);
      } else {
        // Collect human IDs that were replaced by bots.
        botReplacedHumanIds = (replacedRows ?? [])
          .filter(r => r.human_user_id != null)
          .map(r => r.human_user_id as string);
        if (botReplacedHumanIds.length > 0) {
          console.log(`[Complete Game] Found ${botReplacedHumanIds.length} bot-replaced human(s) — will record ABANDONED:`, botReplacedHumanIds);
        }

        // Derive the hardest bot difficulty present in this game.
        const difficulties = (replacedRows ?? [])
          .map(r => r.bot_difficulty as string | null)
          .filter(Boolean) as string[];
        if (difficulties.includes('hard'))        serverBotDifficulty = 'hard';
        else if (difficulties.includes('medium')) serverBotDifficulty = 'medium';
        else if (difficulties.length > 0)         serverBotDifficulty = 'easy';
      }
    }

    // Only update stats for real players (not bots)
    const realPlayerData = gameData.players.filter(p => !p.user_id.startsWith('bot_'));

    // ── Bot multiplier (server-authoritative) ────────────────────────────────
    // For games with a real room (room_id != null): derived exclusively from the
    // server-queried room_players rows above — ignoring the client-supplied
    // bot_difficulty field which an attacker could set to null (→ multiplier 1.0)
    // to inflate their ELO gain in a bot game.
    // For room_id=null (local casual games): no room_players exist to query, so
    // we fall back to the client-supplied value. The ELO impact is limited since
    // these are single-player games with no ranked/private modes.
    let botMultiplier: number;
    if (gameData.room_id !== null) {
      botMultiplier =
        serverBotDifficulty === 'hard'   ? 0.9 :
        serverBotDifficulty === 'medium' ? 0.7 :
        serverBotDifficulty === 'easy'   ? 0.5 : 1.0; // null → all-human lobby
    } else {
      botMultiplier =
        gameData.bot_difficulty === 'easy'   ? 0.5 :
        gameData.bot_difficulty === 'medium' ? 0.7 :
        gameData.bot_difficulty === 'hard'   ? 0.9 : 1.0;
    }

    // ── Chess K=32 pairwise ELO (ranked games only) ────────────────────────────
    // Must be computed before the stats update loop so all players' current
    // rated_rank_points are fetched simultaneously.
    // Private games are excluded — they do not affect ranked_rank_points.
    const rankedEloDeltaMap = new Map<string, number>();

    if (gameData.game_type === 'ranked') {
      // Collect all real player user IDs (including bot-replaced humans at pos 4)
      const allRealUserIds = [
        ...realPlayerData.map(p => p.user_id),
        ...botReplacedHumanIds,
      ];

      if (allRealUserIds.length > 0) {
        const { data: ratingRows, error: ratingError } = await supabaseAdmin
          .from('player_stats')
          .select('user_id, ranked_rank_points')
          .in('user_id', allRealUserIds);

        if (ratingError) {
          console.error('[Complete Game] Failed to fetch ranked_rank_points for ELO calc:', ratingError.message);
          // Fall back to 0 delta for all players
          allRealUserIds.forEach(id => rankedEloDeltaMap.set(id, 0));
        } else {
          // Build rating lookup (default 1000 for new players)
          const ratingLookup = new Map<string, number>();
          (ratingRows ?? []).forEach(r => {
            ratingLookup.set(r.user_id as string, (r.ranked_rank_points as number) ?? 1000);
          });
          allRealUserIds.forEach(id => {
            if (!ratingLookup.has(id)) ratingLookup.set(id, 1000);
            rankedEloDeltaMap.set(id, 0);
          });

          // Build finish-position list for all real players
          const finishList: Array<{ user_id: string; finish_position: number; rating: number }> = [
            ...realPlayerData.map(p => ({
              user_id: p.user_id,
              // Disconnected (abandoned) players must not gain ELO by reporting a
              // favourable finish position after leaving the game. Override to 4
              // (last place) so they are treated as losers in every pairwise match-up,
              // mirroring the bot-replaced path below which already hardcodes 4.
              // The equal-position guard in the pairwise loop ensures two abandoned
              // players at position 4 do not exchange ELO with each other.
              finish_position: p.disconnected ? 4 : p.finish_position,
              rating: ratingLookup.get(p.user_id) ?? 1000,
            })),
            ...botReplacedHumanIds.map(id => ({
              user_id: id,
              finish_position: 4, // abandoned players placed last
              rating: ratingLookup.get(id) ?? 1000,
            })),
          ];

          // Pairwise chess ELO: every unique pair (i, j) where pos_i < pos_j
          const K = 32;
          for (let a = 0; a < finishList.length; a++) {
            for (let b = a + 1; b < finishList.length; b++) {
              // Skip equal finish_position pairs — e.g., two bot-replaced humans
              // both set to position 4. Treating tied abandons as a winner/loser
              // pair is arbitrary and unfair; no ELO should be exchanged.
              if (finishList[a].finish_position === finishList[b].finish_position) continue;

              // Determine winner / loser of this pair by finish position
              const [winner, loser] =
                finishList[a].finish_position < finishList[b].finish_position
                  ? [finishList[a], finishList[b]]
                  : [finishList[b], finishList[a]];

              const expected = 1 / (1 + Math.pow(10, (loser.rating - winner.rating) / 400));
              const winnerDelta = Math.round(K * (1 - expected));
              const loserDelta  = -winnerDelta; // enforce zero-sum per pair: avoids rating inflation/deflation from independent rounding

              rankedEloDeltaMap.set(winner.user_id, (rankedEloDeltaMap.get(winner.user_id) ?? 0) + winnerDelta);
              rankedEloDeltaMap.set(loser.user_id,  (rankedEloDeltaMap.get(loser.user_id)  ?? 0) + loserDelta);
            }
          }
        }
      }
    }

    const statsUpdatePromises = realPlayerData.map(async (player) => {
      const won = player.user_id === gameData.winner_id;

      console.log(`[Complete Game] Updating stats for ${player.username}: won=${won}, position=${player.finish_position}, disconnected=${player.disconnected}`);

      // A player is voided when they were the last human to leave an unfinished game.
      // serverVoidedPlayerId is computed from room_players above — never from the client.
      const isVoided = !gameData.game_completed &&
        !!serverVoidedPlayerId &&
        player.user_id === serverVoidedPlayerId;

      // A disconnected-but-not-yet-bot-replaced player abandoned the game even if
      // game_completed=true (they were still in the room_players list with
      // connection_status='disconnected').  Treat them as abandoned rather than
      // completed so games_abandoned / ELO penalty are applied correctly.
      const isCompleted = gameData.game_completed && !player.disconnected;

      // Abandoned (disconnected, not voided) players receive a penalty score of 200 so
      // the ELO formula (100 - p_score) yields a negative delta (−100 × multiplier)
      // instead of rewarding a low game score earned before departure.
      const effectiveScore = (!isCompleted && !isVoided) ? 200 : player.score;

      const { error: statsError } = await supabaseAdmin.rpc('update_player_stats_after_game', {
        p_user_id: player.user_id,
        p_won: won,
        p_finish_position: player.finish_position,
        p_score: effectiveScore,
        p_combos_played: player.combos_played,
        p_game_type: gameData.game_type,
        p_completed: isCompleted,
        p_cards_left: player.cards_left,
        p_voided: isVoided,
        p_bot_multiplier: botMultiplier,
        p_ranked_elo_change: rankedEloDeltaMap.get(player.user_id) ?? 0,
      });

      if (statsError) {
        console.error(`[Complete Game] Failed to update stats for ${player.username}:`, statsError);
        return { user_id: player.user_id, success: false, error: statsError.message };
      }

      return { user_id: player.user_id, success: true };
    });

    // Record ABANDONED for every human who was replaced by a bot.
    // p_completed=false, p_voided=false → games_abandoned += 1, ELO penalty applied.
    // p_score=200 so the ELO formula (100 - score) yields a penalty (−100 × multiplier)
    // rather than rewarding abandonment with a large positive delta.
    // These run in parallel with the main statsUpdatePromises.
    const abandonedPromises = botReplacedHumanIds.map(async (humanUserId) => {
      const { error: abandonedError } = await supabaseAdmin.rpc('update_player_stats_after_game', {
        p_user_id: humanUserId,
        p_won: false,
        p_finish_position: 4,
        p_score: 200,
        p_combos_played: {},
        p_game_type: gameData.game_type,
        p_completed: false,
        p_cards_left: 0,
        p_voided: false,
        p_bot_multiplier: botMultiplier,
        p_ranked_elo_change: rankedEloDeltaMap.get(humanUserId) ?? 0,
      });

      if (abandonedError) {
        console.error(`[Complete Game] Failed to record ABANDONED for bot-replaced user ${humanUserId}:`, abandonedError.message);
        return { user_id: humanUserId, success: false, error: abandonedError.message };
      }

      console.log(`[Complete Game] ✅ Recorded ABANDONED for bot-replaced user: ${humanUserId}`);
      return { user_id: humanUserId, success: true };
    });

    const [statsResults, abandonedResults] = await Promise.all([
      Promise.all(statsUpdatePromises),
      Promise.all(abandonedPromises),
    ]);

    const failedStats = statsResults.filter(r => !r.success);
    const failedAbandoned = abandonedResults.filter(r => !r.success);

    // Abandoned-stat failures are non-blocking: the game completed successfully and
    // all real-player records were written. We log the failure loudly for ops
    // visibility but intentionally return a 200 rather than a 500, because the
    // completed game itself is valid and re-triggering the entire flow would cause
    // duplicate stat entries for the players whose records DID succeed.
    if (failedAbandoned.length > 0) {
      console.error('[Complete Game] ⚠️ Failed to record ABANDONED for some bot-replaced players (non-blocking):', failedAbandoned);
    }

    if (failedStats.length > 0) {
      console.error('[Complete Game] Some stats updates failed:', failedStats);
      return new Response(
        JSON.stringify({ 
          error: 'Partial failure updating stats', 
          failed_players: failedStats,
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[Complete Game] All player stats updated successfully');

    // Mark stats_applied_at now that all stats RPCs have completed.
    // This unlocks the dedup guard: any subsequent caller that finds this row
    // will see stats_applied_at IS NOT NULL and know stats are complete.
    if (gameData.room_id) {
      const { error: statsAppliedErr } = await supabaseAdmin
        .from('game_history')
        .update({ stats_applied_at: new Date().toISOString() })
        .eq('room_id', gameData.room_id)
        .is('stats_applied_at', null); // only update if not already set (idempotent)
      if (statsAppliedErr) {
        console.warn('[Complete Game] Failed to set stats_applied_at (non-critical):', statsAppliedErr.message);
      }
    }

    // ============================================================================
    // STEP 3b: CLOSE ROOM (mark finished + clean up room_players)
    // ============================================================================
    // Prevents "reconnect to game" banner after game completion.

    if (gameData.room_id) {
      try {
        // Mark room as finished so HomeScreen banner doesn't show it.
        // Use 'finished' consistently with the dedup/23505 short-circuit paths above.
        const { error: roomUpd } = await supabaseAdmin
          .from('rooms')
          .update({ status: 'finished' })
          .eq('id', gameData.room_id);

        if (roomUpd) {
          console.warn('[Complete Game] Failed to mark room as finished:', roomUpd.message);
        } else {
          console.log('[Complete Game] Room marked as finished');
        }

        // Remove all room_players entries so no user sees a stale banner
        const { error: rpDel } = await supabaseAdmin
          .from('room_players')
          .delete()
          .eq('room_id', gameData.room_id);

        if (rpDel) {
          console.warn('[Complete Game] Failed to clean room_players:', rpDel.message);
        } else {
          console.log('[Complete Game] Room players cleaned up');
        }
      } catch (roomCleanupErr) {
        console.warn('[Complete Game] Room cleanup error (non-critical):', roomCleanupErr);
      }
    }

    // ============================================================================
    // STEP 4: SEND PUSH NOTIFICATIONS
    // ============================================================================

    // SECURITY: User participation already validated in STEP 1 above
    // (requestingPlayer check ensures user is a game participant)

    try {
      const winnerPlayer = gameData.players.find(p => p.user_id === gameData.winner_id);
      const winnerName = winnerPlayer?.username || 'Unknown';
      
      // Notify winner
      if (!gameData.winner_id.startsWith('bot_')) {
        await supabaseAdmin.functions.invoke('send-push-notification', {
          body: {
            user_ids: [gameData.winner_id],
            title: '🎉 Victory!',
            body: `Congratulations! You won in room ${gameData.room_code}!`,
            data: {
              type: 'game_ended',
              room_code: gameData.room_code,
              room_id: gameData.room_id,
              winner: winnerName,
              is_winner: true,
            },
            sound: 'default',
            badge: 1,
          },
        });
      }
      
      // Notify other players
      const otherPlayers = realPlayerData.filter(p => p.user_id !== gameData.winner_id);
      if (otherPlayers.length > 0) {
        await supabaseAdmin.functions.invoke('send-push-notification', {
          body: {
            user_ids: otherPlayers.map(p => p.user_id),
            title: '🏁 Game Over',
            body: `${winnerName} won the game in room ${gameData.room_code}`,
            data: {
              type: 'game_ended',
              room_code: gameData.room_code,
              room_id: gameData.room_id,
              winner: winnerName,
              is_winner: false,
            },
            sound: 'default',
            badge: 1,
          },
        });
      }
      
      console.log('[Complete Game] Push notifications sent successfully');
    } catch (notifError) {
      console.warn('[Complete Game] Failed to send push notifications (non-critical):', notifError);
      // Don't fail the request - notifications are optional
    }

    // ============================================================================
    // STEP 5: BROADCAST game_ended EVENT TO ALL CLIENTS
    // ============================================================================
    // Uses the shared broadcastGameEnded helper (also called from dedup/23505
    // short-circuit paths) so clients are unblocked even when the winning caller
    // crashes before this step.
    // Fire-and-forget: the edge function response is not held waiting for the
    // Realtime subscribe→send flow (up to 5 s). The HTTP response proceeds
    // immediately to the leaderboard refresh step below.
    console.log('[Complete Game] Broadcasting game_ended to room:', gameData.room_id);
    void broadcastGameEnded(supabaseAdmin, gameData);

    // ============================================================================
    // STEP 6: REFRESH LEADERBOARD
    // ============================================================================

    const { error: leaderboardError } = await supabaseAdmin.rpc('refresh_leaderboard');
    if (leaderboardError) {
      console.warn('[Complete Game] Leaderboard refresh failed (non-critical):', leaderboardError);
      // Don't fail the request - leaderboard will refresh eventually
    } else {
      console.log('[Complete Game] Leaderboard refreshed successfully');
    }

    // ============================================================================
    // STEP 7: RETURN SUCCESS
    // ============================================================================

    return new Response(
      JSON.stringify({ 
        success: true,
        message: 'Game completed and stats updated successfully',
        winner_id: gameData.winner_id,
        players_updated: gameData.players.length,
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('[Complete Game] Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
