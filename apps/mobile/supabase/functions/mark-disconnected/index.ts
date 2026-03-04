// deno-lint-ignore-file no-explicit-any
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * mark-disconnected edge function
 *
 * Called ONLY when a player explicitly leaves the game (navigates away, tabs out
 * far enough that AppState triggers 'background', etc.).
 *
 * NOT called when the app is merely backgrounded temporarily (e.g. swipe-up, incoming
 * call) — in that case the heartbeat simply stops and process_disconnected_players()
 * on the server detects it after 30 s.
 *
 * Offline rooms are skipped entirely — the DB function guards this.
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
      console.error('❌ [mark-disconnected] Auth error:', authError);
      return new Response(
        JSON.stringify({ success: false, error: 'Not authenticated' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { room_id, player_id } = await req.json();

    console.log('🔌 [mark-disconnected]', {
      user_id:   user.id.substring(0, 8),
      room_id:   room_id?.substring(0, 8),
      player_id: player_id?.substring(0, 8),
    });

    if (!room_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing room_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use the server-side function which guards offline rooms
    await supabaseClient.rpc('mark_player_disconnected', {
      p_room_id: room_id,
      p_user_id: user.id,
    });

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
