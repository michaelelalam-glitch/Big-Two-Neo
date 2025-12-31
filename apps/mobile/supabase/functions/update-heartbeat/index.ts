// deno-lint-ignore-file no-explicit-any
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ==================== MAIN HANDLER ====================

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get authenticated user from request
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { room_id, player_id } = await req.json();

    console.log('💓 [update-heartbeat] Request received:', {
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

    // Verify the player exists in the room
    const { data: player, error: playerError } = await supabaseClient
      .from('room_players')
      .select('id, user_id')
      .eq('id', player_id)
      .eq('room_id', room_id)
      .single();

    if (playerError || !player) {
      console.log('❌ [update-heartbeat] Player not found:', playerError);
      return new Response(
        JSON.stringify({ success: false, error: 'Player not found in room' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
