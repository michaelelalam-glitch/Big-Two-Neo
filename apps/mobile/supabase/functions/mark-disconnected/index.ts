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

    const { room_id, player_id } = await req.json();

    console.log('🔌 [mark-disconnected] Request received:', {
      room_id: room_id?.substring(0, 8),
      player_id: player_id?.substring(0, 8),
    });

    if (!room_id || !player_id) {
      console.log('❌ [mark-disconnected] Missing required fields');
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
      console.log('❌ [mark-disconnected] Player not found:', playerError);
      return new Response(
        JSON.stringify({ success: false, error: 'Player not found in room' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Mark player as disconnected
    const { error: updateError } = await supabaseClient
      .from('room_players')
      .update({
        connection_status: 'disconnected',
        disconnected_at: new Date().toISOString(),
      })
      .eq('id', player_id)
      .eq('room_id', room_id);

    if (updateError) {
      console.log('❌ [mark-disconnected] Update failed:', updateError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to mark player as disconnected' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('✅ [mark-disconnected] Success');
    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('💥 [mark-disconnected] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
