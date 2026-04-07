// deno-lint-ignore-file no-explicit-any
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-app-version',
};

// Timing constants — keep these in sync with the SQL BOT_REPLACE_AFTER /
// HEARTBEAT_SLACK values in process_disconnected_players() so drift is obvious.
/** Force-sweep threshold: must match BOT_REPLACE_AFTER (60 s) to prevent
 *  premature bot replacement when client clock drifts ahead. */
const FORCE_SWEEP_THRESHOLD_MS = 60_000;
/** Matches Phase A's HEARTBEAT_SLACK (30 s). A player silent for this long is
 *  considered disconnected and eligible for the stale-connected force_sweep path. */
const HEARTBEAT_SLACK_MS = 30_000;

/**
 * update-heartbeat edge function
 *
 * Keeps the player's row alive every 5 seconds.
 * Also piggybacks a call to process_disconnected_players() on every 6th heartbeat
 * (~30 s) so bot-replacement happens even if pg_cron is not available.
 *
 * After the sweep, if any players were replaced with bots, triggers bot-coordinator
 * for the affected rooms so the newly-placed bot can start playing immediately.
 *
 * NOTE: Heartbeat clears disconnect_timer_started_at so the ring disappears as soon
 * as a player resumes sending heartbeats. One source of truth: a live heartbeat means
 * the player is back, no dual-condition check needed.
 *
 * NOTE: player_id is room_players.id and is validated server-side against auth.uid().
 */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabaseClient = createClient(supabaseUrl, serviceKey);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);

    if (authError || !user) {
      console.error('❌ [update-heartbeat] Auth error:', authError);
      return new Response(
        JSON.stringify({ success: false, error: 'Not authenticated' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let body: any;
    try {
      body = await req.json();
    } catch (parseError) {
      console.error('❌ [update-heartbeat] Invalid JSON body:', parseError);
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid JSON body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const { room_id, player_id, heartbeat_count, force_sweep, sweep_only } = body;
    // Normalize once to a strict boolean to avoid truthy/strict-equality inconsistency.
    // e.g. a caller sending sweep_only='true' (string) would pass `if (!sweep_only)` but
    // fail `sweep_only === true`, leaving the row stale without triggering a sweep.
    const sweepOnly = sweep_only === true;

    if (!room_id || !player_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify ownership (player_id = room_players.id, must belong to auth user)
    // Also fetch player_index + username for the reconnect broadcast.
    const { data: player, error: playerError } = await supabaseClient
      .from('room_players')
      .select('id, user_id, connection_status, player_index, username')
      .eq('id', player_id)
      .eq('room_id', room_id)
      .maybeSingle();

    if (playerError) {
      console.error('❌ [update-heartbeat] Player lookup error:', playerError.message);
      return new Response(
        JSON.stringify({ success: false, error: 'Player lookup failed' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!player) {
      // Row doesn't exist at all — player was removed from the room
      return new Response(
        JSON.stringify({ success: false, error: 'Player not found in room' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Player exists but user_id doesn't match — they were replaced by a bot
    if (player.user_id !== user.id) {
      if (player.connection_status === 'replaced_by_bot') {
        return new Response(
          JSON.stringify({ success: false, replaced_by_bot: true }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      // Some other mismatch (shouldn't happen) — return 403
      return new Response(
        JSON.stringify({ success: false, error: 'Player does not belong to authenticated user' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // sweepOnly=true: caller is a disconnected player triggering a forced sweep.
    // Skip the heartbeat UPDATE so the row stays 'disconnected' and
    // process_disconnected_players() can find and replace this player.
    // A normal heartbeat would flip connection_status back to 'connected',
    // causing Phase B to miss the player entirely.
    if (!sweepOnly) {
      // Update heartbeat timestamp.
      // NOTE: Heartbeat now clears disconnect_timer_started_at atomically so the
      // grey ring disappears the moment a player resumes sending heartbeats.
      // Request an exact count so updateCount is non-null and we can detect
      // "0 rows matched" (race with bot replacement).
      const { error: updateError, count: updateCount } = await supabaseClient
        .from('room_players')
        .update({
          last_seen_at:                 new Date().toISOString(),
          connection_status:            'connected',
          disconnected_at:              null,
          // Clear the disconnect timer so the charcoal ring disappears the moment
          // a player resumes heartbeats. A live heartbeat = player is back.
          disconnect_timer_started_at:  null,
        }, { count: 'exact' })
        .eq('id', player_id)
        .eq('room_id', room_id)
        // Guard against race: do not flip a replaced_by_bot or disconnected row back
        // to 'connected'. If the row was claimed by a bot, user_id will no longer
        // match and connection_status will be 'replaced_by_bot'. If mark-disconnected
        // already fired (beforeRemove path), skip the heartbeat so the disconnect is
        // not silently undone (which would delay the grey ring by up to 30 s on other
        // clients and prevent the HomeScreen banner from showing a countdown).
        .eq('user_id', user.id)
        .neq('connection_status', 'replaced_by_bot')
        .neq('connection_status', 'disconnected');

      if (updateError) {
        console.error('❌ [update-heartbeat] Update failed:', updateError.message);
        return new Response(
          JSON.stringify({ success: false, error: 'Heartbeat update failed' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (updateCount === 0) {
        // 0 rows matched — either player was replaced_by_bot, already set to
        // 'disconnected' (mark-disconnected fired first — this is intentional),
        // or the row was removed. Re-read to distinguish the two cases.
        const { data: freshPlayer } = await supabaseClient
          .from('room_players')
          .select('connection_status')
          .eq('id', player_id)
          .eq('room_id', room_id)
          .eq('user_id', user.id)
          .maybeSingle();

        if (!freshPlayer || freshPlayer.connection_status === 'replaced_by_bot') {
          console.warn('[update-heartbeat] Update matched 0 rows — player was replaced by bot');
          return new Response(
            JSON.stringify({ success: false, replaced_by_bot: true }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (freshPlayer.connection_status === 'disconnected') {
          // Expected: mark-disconnected fired before this heartbeat tick.
          // Return success=false so the client knows it must call reconnect-player
          // to come back (heartbeat alone can no longer clear 'disconnected').
          console.log('[update-heartbeat] Skipped heartbeat UPDATE — row is disconnected (mark-disconnected took effect)');
          return new Response(
            JSON.stringify({ success: false, is_disconnected: true }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Some other 0-row situation (row removed, etc.)
        console.warn('[update-heartbeat] Update matched 0 rows — unexpected state', freshPlayer.connection_status);
        return new Response(
          JSON.stringify({ success: false, replaced_by_bot: true }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // ── Reconnect broadcast ────────────────────────────────────────────────
      // When a player transitions from disconnected → connected (heartbeat resumes
      // after app foregrounded), broadcast player_reconnected so all other clients
      // call fetchPlayers() and get fresh room_players data. Without this, clients
      // rely solely on Realtime postgres_changes — which can be delayed or lost on
      // mobile networks — leaving the grey ring stuck on the reconnected player.
      // This broadcast is only attempted for disconnected → connected transitions
      // and runs asynchronously via EdgeRuntime.waitUntil / fallback await below.
      // Its success or failure is logged, but it is not tracked in the HTTP response.
      if (player.connection_status === 'disconnected') {
        // Promise registered with EdgeRuntime.waitUntil (see try/catch below)
        // so the edge runtime does not terminate the subscribe→send flow before
        // it completes — even after the HTTP response has already been returned.
        const reconnectBroadcast = (async (): Promise<void> => {
          try {
            // IMPORTANT: channel name must use room_id (UUID) to match the
            // client's Realtime subscription in useRealtime.ts joinChannel().
            // Use subscribe→send→removeChannel pattern: supabase-js Realtime
            // requires a SUBSCRIBED channel before send() is reliable; calling
            // send() on an unsubscribed channel can silently drop the message.
            const payload = {
              player_index: player.player_index,
              username: player.username,
              was_replaced: false,
            };
            await new Promise<void>((resolve) => {
              const ch = supabaseClient.channel(`room:${room_id}`);
              let settled = false;
              const finish = (): void => {
                if (!settled) {
                  settled = true;
                  supabaseClient.removeChannel(ch).catch(() => {});
                  resolve();
                }
              };
              const safetyTimeout = setTimeout(() => {
                console.warn(`[update-heartbeat] Reconnect broadcast safety timeout for room ${room_id}`);
                finish();
              }, 5000);
              ch.subscribe((status: string) => {
                // Guard: if the safety timeout already fired and settled the
                // Promise, ignore any late SUBSCRIBED / status callbacks to
                // prevent double-send or post-cleanup work.
                if (settled) return;
                if (status === 'SUBSCRIBED') {
                  ch.send({ type: 'broadcast', event: 'player_reconnected', payload })
                    .then((result: any) => {
                      // supabase-js Realtime send() resolves (not rejects) on
                      // delivery failures; inspect the resolved value for errors.
                      if (result?.error) {
                        console.warn(`[update-heartbeat] Reconnect broadcast delivery failure — room ${room_id}:`, result.error);
                        clearTimeout(safetyTimeout);
                        finish();
                      } else {
                        console.log(`📡 [update-heartbeat] Broadcast player_reconnected for player_index=${player.player_index} in room ${room_id}`);
                        clearTimeout(safetyTimeout);
                        finish();
                      }
                    })
                    .catch((e: unknown) => {
                      console.warn('[update-heartbeat] Reconnect broadcast send failed — room', room_id, ':', e);
                      clearTimeout(safetyTimeout);
                      finish();
                    });
                } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                  console.warn(`[update-heartbeat] Reconnect broadcast channel error (${status}) for room ${room_id}`);
                  clearTimeout(safetyTimeout);
                  finish();
                }
              });
            });
          } catch (bcastErr: any) {
            console.warn('[update-heartbeat] Reconnect broadcast exception — room', room_id, ':', bcastErr?.message);
          }
        })();
        // Fire-and-forget: broadcast continues after the HTTP response.
        // Uses EdgeRuntime.waitUntil so the Edge Function runtime keeps the
        // promise alive past the response flush (consistent with bot-watchdog).
        try {
          (globalThis as any).EdgeRuntime?.waitUntil(reconnectBroadcast);
        } catch (_) {
          await reconnectBroadcast;
        }
      }
    }

    // Every 6th heartbeat (~30 s at 5 s interval) run the sweep so bot-replacement
    // works even when pg_cron is unavailable (e.g. dev environment).
    // Default to 1 (not 0) so the first heartbeat doesn't trigger an immediate sweep.
    const count =
      Number.isInteger(heartbeat_count) && heartbeat_count > 0 ? heartbeat_count : 1;

    // ── Bot-coordinator watchdog (throttled: every 3rd heartbeat ≈ 15s) ─────
    // Triggers bot-coordinator when the current turn belongs to a bot.
    // Throttled to every 3rd heartbeat to reduce DB round trips; bot-coordinator
    // has a row-based lease so duplicate triggers from multiple clients are safe.
    if (count % 3 === 0) {
      const botWatchdogPromise = (async () => {
        try {
          const { data: gs } = await supabaseClient
            .from('game_state')
            .select('current_turn, game_phase')
            .eq('room_id', room_id)
            .maybeSingle();

          // Only act for actively-playing games
          if (!gs || (gs.game_phase !== 'playing' && gs.game_phase !== 'normal_play' && gs.game_phase !== 'first_play')) return;

          const { data: turnPlayer } = await supabaseClient
            .from('room_players')
            .select('is_bot')
            .eq('room_id', room_id)
            .eq('player_index', gs.current_turn)
            .maybeSingle();

          if (!turnPlayer?.is_bot) return;

          // Current turn is a bot — ensure coordinator is running
          const { data: roomInfo } = await supabaseClient
            .from('rooms')
            .select('code')
            .eq('id', room_id)
            .maybeSingle();

          if (!roomInfo?.code) return;

          console.log(`[update-heartbeat] 🤖 Bot watchdog: current turn is a bot in room ${roomInfo.code}, triggering coordinator`);
          await fetch(`${supabaseUrl}/functions/v1/bot-coordinator`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${serviceKey}`,
              'Content-Type': 'application/json',
              'x-bot-coordinator': 'true',
            },
            body: JSON.stringify({ room_code: roomInfo.code }),
          });
        } catch (watchdogErr: any) {
          console.warn('[update-heartbeat] Bot watchdog error (non-critical):', watchdogErr?.message);
        }
      })();

      try {
        (globalThis as any).EdgeRuntime?.waitUntil(botWatchdogPromise);
      } catch (_) {
        await botWatchdogPromise;
      }
    }

    // Determine whether to run the sweep this heartbeat.
    // force_sweep=true is sent by the client when a disconnect countdown ring expires
    // (ring hits 0) so the replacement happens immediately rather than waiting up to
    // 30s for the next scheduled piggyback sweep.
    // SECURITY: periodic gate is derived from the server clock — one 5-second slot per
    // 30-second window (~1/6 frequency) — so a malicious client cannot force a sweep by
    // sending a heartbeat_count that is a multiple of 6.  force_sweep is additionally
    // validated server-side: it is only honoured when the room has a player with a
    // genuinely expired disconnect timer (disconnect_timer_started_at older than 60 s).
    // Without that check any authenticated client could trigger process_disconnected_players
    // + bot-coordinator fanout on every heartbeat (DoS vector).
    const sweepSlot = Math.floor(Date.now() / 5_000);
    // Spread sweep load across the 30-second window using a deterministic per-room
    // offset (0–5) derived from the first 4 bytes of the room UUID. This prevents
    // a synchronized thundering-herd where every room sweeps at the same 5-second
    // slot on the server clock.
    const roomSweepOffset = room_id
      ? parseInt(room_id.replace(/-/g, '').substring(0, 8), 16) % 6
      : 0;
    let shouldSweep = sweepSlot % 6 === roomSweepOffset;
    // sweepOnly also implies an immediate forced sweep; apply the same
    // server-side validation (expired disconnect timer) to prevent DoS.
    if ((force_sweep === true || sweepOnly) && !shouldSweep) {
      // Primary check: Phase-B-ready player — already marked disconnected with an expired timer.
      // FORCE_SWEEP_THRESHOLD_MS equals BOT_REPLACE_AFTER (60 s), so the server-side
      // validation threshold is an exact match: a player must have had
      // disconnect_timer_started_at set at least 60 s ago to pass. This means the
      // forced-sweep client request is only accepted once the player is already
      // eligible for Phase B replacement; no early replacement is possible.
      // Defense-in-depth: this Edge-runtime Date.now() check is a pre-filter only.
      // The authoritative Phase B replacement is performed by
      // process_disconnected_players(), which uses the DB clock (NOW()).
      // Minor Edge↔DB clock skew is acceptable because the DB function
      // independently verifies the same 60 s threshold before replacing anyone.
      // Use lte (not lt) so the boundary case (disconnect_timer_started_at = now-60s
      // exactly) also passes validation rather than being deferred to the 5s retry.
      const { data: expiredTimer, error: expiredTimerError } = await supabaseClient
        .from('room_players')
        .select('id')
        .eq('room_id', room_id)
        .eq('is_bot', false)
        .neq('connection_status', 'connected')
        .not('disconnect_timer_started_at', 'is', null)
        .lte('disconnect_timer_started_at', new Date(Date.now() - FORCE_SWEEP_THRESHOLD_MS).toISOString())
        .limit(1)
        .maybeSingle();

      if (expiredTimerError) {
        console.warn(`[update-heartbeat] force_sweep validation query failed for room ${room_id}:`, expiredTimerError.message);
        // Keep shouldSweep=false on error so a query failure cannot be exploited
        // to trigger an unvalidated sweep.
      } else if (expiredTimer) {
        shouldSweep = true;
      } else {
        // Secondary check: connected player with a stale heartbeat (>= HEARTBEAT_SLACK_MS = 30s).
        // This covers the gap where a player disconnects during their active turn: Phase A
        // only runs on the periodic sweep schedule (~30s), so at exactly T+60s (when the turn
        // ring fires) the player may still show as 'connected' with disconnect_timer_started_at
        // = NULL.  Without this check the forced sweep is rejected, and bot replacement is
        // delayed up to T+90s (next periodic sweep).  Allowing the sweep when a stale
        // connected-player exists lets Phase A + Phase B run in the same call at T+60s,
        // achieving the intended "replace after 60s from turn start" behaviour.
        // This matches Phase A's eligibility criterion exactly (HEARTBEAT_SLACK constant),
        // so it does not expand the attack surface beyond what the periodic sweep already does.
        const { data: staleConnected, error: staleConnectedError } = await supabaseClient
          .from('room_players')
          .select('id')
          .eq('room_id', room_id)
          .eq('is_bot', false)
          .eq('connection_status', 'connected')
          .lte('last_seen_at', new Date(Date.now() - HEARTBEAT_SLACK_MS).toISOString())
          .limit(1)
          .maybeSingle();

        if (staleConnectedError) {
          console.warn(`[update-heartbeat] force_sweep stale-connected check failed for room ${room_id}:`, staleConnectedError.message);
          // Keep shouldSweep=false on error.
        } else {
          shouldSweep = !!staleConnected;
          if (!shouldSweep) {
            console.log(`[update-heartbeat] force_sweep ignored: no expired disconnect timer or stale connected player in room ${room_id}`);
          }
        }
      }
    }

    if (shouldSweep) {
      // Periodic/forced sweep: mark stale heartbeats as disconnected and replace with bots
      const sweepPromise = (async () => {
        try {
          const { data: sweepResult, error: sweepError } = await supabaseClient
            .rpc('process_disconnected_players');

          if (sweepError) {
            console.warn('[update-heartbeat] Sweep error:', sweepError.message);
            return;
          }

          // Primary: use rooms_with_bot_replacements from the updated function
          let affectedCodes: string[] = sweepResult?.rooms_with_bot_replacements ?? [];

          // Fallback: if migration not yet deployed, rooms_with_bot_replacements may be absent.
          // Query directly for recently-replaced bot rows in playing rooms.
          if (affectedCodes.length === 0 && (sweepResult?.replaced_with_bot ?? 0) > 0) {
            const { data: recentBots } = await supabaseClient
              .from('room_players')
              .select('rooms!inner(code, status)')
              .eq('connection_status', 'replaced_by_bot')
              .eq('is_bot', true)
              .eq('rooms.status', 'playing')
              .gte('last_seen_at', new Date(Date.now() - 90_000).toISOString());

            if (recentBots) {
              const codes = recentBots
                .map((r: any) => r.rooms?.code)
                .filter((c: any): c is string => typeof c === 'string');
              affectedCodes = [...new Set(codes)];
              console.log(`[update-heartbeat] 🔍 Fallback found replacement rooms: [${affectedCodes.join(', ')}]`);
            }
          }

          if (affectedCodes.length > 0) {
            console.log(`[update-heartbeat] 🤖 Bot replacements in ${affectedCodes.length} room(s), triggering bot-coordinator...`);

            for (const roomCode of affectedCodes) {
              try {
                await fetch(`${supabaseUrl}/functions/v1/bot-coordinator`, {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${serviceKey}`,
                    'Content-Type': 'application/json',
                    'x-bot-coordinator': 'true',
                  },
                  body: JSON.stringify({ room_code: roomCode }),
                });
                console.log(`[update-heartbeat] ✅ Bot coordinator triggered for room ${roomCode}`);
              } catch (botErr: any) {
                console.warn(`[update-heartbeat] ⚠️ Bot coordinator trigger failed for ${roomCode}:`, botErr?.message);
              }
            }
          }
        } catch (err: any) {
          console.warn('[update-heartbeat] Sweep exception:', err?.message);
        }
      })();

      // Use EdgeRuntime.waitUntil so the response returns immediately
      // and the sweep + bot-coordinator run in the background
      try {
        (globalThis as any).EdgeRuntime?.waitUntil(sweepPromise);
      } catch (_) {
        // EdgeRuntime.waitUntil not available — await inline instead
        await sweepPromise;
      }
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('💥 [update-heartbeat] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
