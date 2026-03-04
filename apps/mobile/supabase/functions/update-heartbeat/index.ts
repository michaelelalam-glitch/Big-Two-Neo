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

    const body = await req.json();
    const { room_id, player_id, heartbeat_count } = body;

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
    const { error: updateError, count: updateCount } = await supabaseClient
      .from('room_players')
      .update({
        last_seen_at:      new Date().toISOString(),
        connection_status: 'connected',
        disconnected_at:   null,
        // disconnect_timer_started_at is intentionally NOT touched here
      })
      .eq('id', player_id)
      .eq('room_id', room_id);

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
    if (count % 6 === 0) {
      // Await the sweep result to check if bots replaced any players
      const sweepPromise = (async () => {
        try {
          const { data: sweepResult, error: sweepError } = await supabaseClient
            .rpc('process_disconnected_players');

          if (sweepError) {
            console.warn('[update-heartbeat] Sweep error:', sweepError.message);
            return;
          }

          // If bots replaced players in any rooms, trigger bot-coordinator for each
          const affectedCodes: string[] = sweepResult?.rooms_with_bot_replacements ?? [];
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
