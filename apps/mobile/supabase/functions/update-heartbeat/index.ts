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
 * NOTE: player_id is room_players.id and is validated server-side against auth.uid().
 */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

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
      .eq('user_id', user.id)
      .maybeSingle();

    if (playerError || !player) {
      // Player might have been replaced by a bot; return a special status so
      // the client knows to call get-rejoin-status
      return new Response(
        JSON.stringify({ success: false, replaced_by_bot: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update heartbeat timestamp
    await supabaseClient
      .from('room_players')
      .update({
        last_seen_at:      new Date().toISOString(),
        connection_status: 'connected',
        disconnected_at:   null,
      })
      .eq('id', player_id)
      .eq('room_id', room_id);

    // Every 6th heartbeat (~30 s at 5 s interval) run the sweep so bot-replacement
    // works even when pg_cron is unavailable (e.g. dev environment).
    const count = typeof heartbeat_count === 'number' ? heartbeat_count : 0;
    if (count % 6 === 0) {
      supabaseClient.rpc('process_disconnected_players').then(() => {}).catch(() => {});
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

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get authenticated user from JWT
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

    const { room_id, player_id } = await req.json();

    console.log('💓 [update-heartbeat] Request received:', {
      user_id: user.id.substring(0, 8),
      room_id: room_id?.substring(0, 8),
      player_id: player_id?.substring(0, 8),
    });

    if (!room_id || !player_id) {
      console.log('❌ [update-heartbeat] Missing required fields');
      return new Response(
        JSON.stringify({ success: false, error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify the player exists in the room AND belongs to the authenticated user
    const { data: player, error: playerError } = await supabaseClient
      .from('room_players')
      .select('id, user_id')
      .eq('id', player_id)
      .eq('room_id', room_id)
      .eq('user_id', user.id)
      .single();

    if (playerError || !player) {
      console.log('❌ [update-heartbeat] Player not found or unauthorized:', playerError);
      return new Response(
        JSON.stringify({ success: false, error: 'Player not found or unauthorized' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update heartbeat
    const { error: updateError } = await supabaseClient
      .from('room_players')
      .update({
        last_seen_at: new Date().toISOString(),
        connection_status: 'connected',
        disconnected_at: null,
      })
      .eq('id', player_id)
      .eq('room_id', room_id);

    if (updateError) {
      console.log('❌ [update-heartbeat] Update failed:', updateError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to update heartbeat' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('✅ [update-heartbeat] Success');
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
