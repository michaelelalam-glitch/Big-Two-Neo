// deno-lint-ignore-file no-explicit-any
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
 * IMPORTANT: Does NOT clear disconnect_timer_started_at — that is a persistent
 * server-side timer that only resets via explicit reconnect_player() RPC or
 * active game actions (play-cards / player-pass).
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
    const { room_id, player_id, heartbeat_count, force_sweep } = body;

    if (!room_id || !player_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify ownership (player_id = room_players.id, must belong to auth user)
    const { data: player, error: playerError } = await supabaseClient
      .from('room_players')
      .select('id, user_id, connection_status')
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

    // Update heartbeat timestamp.
    // NOTE: We deliberately do NOT clear disconnect_timer_started_at here.
    // That persistent timer is only cleared by explicit reconnect (rejoin button)
    // or active game actions (play-cards / player-pass).
    // Request an exact count so updateCount is non-null and we can detect
    // "0 rows matched" (race with bot replacement).
    const { error: updateError, count: updateCount } = await supabaseClient
      .from('room_players')
      .update({
        last_seen_at:      new Date().toISOString(),
        connection_status: 'connected',
        disconnected_at:   null,
        // disconnect_timer_started_at is intentionally NOT touched here
      }, { count: 'exact' })
      .eq('id', player_id)
      .eq('room_id', room_id)
      // Guard against race: do not flip a replaced_by_bot row back to 'connected'.
      // If the row was claimed by a bot between the ownership SELECT above and this
      // UPDATE, user_id will no longer match (it was set to the bot's UUID) and
      // connection_status will be 'replaced_by_bot' — either predicate rejects it.
      .eq('user_id', user.id)
      .neq('connection_status', 'replaced_by_bot');

    if (updateError) {
      console.error('❌ [update-heartbeat] Update failed:', updateError.message);
      return new Response(
        JSON.stringify({ success: false, error: 'Heartbeat update failed' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (updateCount === 0) {
      console.warn('[update-heartbeat] Update matched 0 rows — player may have been replaced');
      return new Response(
        JSON.stringify({ success: false, replaced_by_bot: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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
    let shouldSweep = sweepSlot % 6 === 0;
    if (force_sweep === true && !shouldSweep) {
      const { data: expiredTimer, error: expiredTimerError } = await supabaseClient
        .from('room_players')
        .select('id')
        .eq('room_id', room_id)
        .eq('is_bot', false)
        .neq('connection_status', 'connected')
        .not('disconnect_timer_started_at', 'is', null)
        .lt('disconnect_timer_started_at', new Date(Date.now() - 60_000).toISOString())
        .limit(1)
        .maybeSingle();

      if (expiredTimerError) {
        console.warn(`[update-heartbeat] force_sweep validation query failed for room ${room_id}:`, expiredTimerError.message);
        // Keep shouldSweep=false on error so a query failure cannot be exploited
        // to trigger an unvalidated sweep.
      } else {
        shouldSweep = !!expiredTimer;
        if (!shouldSweep) {
          console.log(`[update-heartbeat] force_sweep ignored: no expired disconnect timer in room ${room_id}`);
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
