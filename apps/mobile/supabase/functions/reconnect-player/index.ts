// deno-lint-ignore-file no-explicit-any
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * reconnect-player edge function
 *
 * Handles two scenarios:
 *   1. Simple reconnect  – player was disconnected but bot has NOT yet replaced them.
 *      Action: restore connection_status → 'connected', clear disconnected_at.
 *
 *   2. Reclaim-from-bot – bot replaced the player (connection_status = 'replaced_by_bot'
 *      OR human_user_id = auth.uid()).
 *      Action: restore the seat fully (user_id, username, is_bot = false, etc.)
 *
 * In both cases the server-side reconnect_player() RPC does the heavy lifting.
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
      console.error('❌ [reconnect-player] Auth error:', authError);
      return new Response(
        JSON.stringify({ success: false, error: 'Not authenticated' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json();
    const { room_id } = body;

    if (!room_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing room_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('🔄 [reconnect-player] user:', user.id.substring(0, 8), 'room:', room_id.substring(0, 8));

    // Delegate entirely to the server-side RPC which handles both reconnect paths
    const { data: rpcResult, error: rpcError } = await supabaseClient
      .rpc('reconnect_player', {
        p_room_id:  room_id,
        p_user_id:  user.id,
      });

    if (rpcError) {
      console.error('❌ [reconnect-player] RPC error:', rpcError);
      return new Response(
        JSON.stringify({ success: false, error: rpcError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const result = rpcResult as {
      success: boolean;
      was_replaced?: boolean;
      room_closed?: boolean;
      player_index?: number;
      username?: string;
      message?: string;
      error?: string;
    };

    if (!result.success) {
      if (result.room_closed) {
        return new Response(
          JSON.stringify({ success: false, room_closed: true, message: result.message }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({ success: false, error: result.error || result.message }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('✅ [reconnect-player] Success', {
      was_bot:      result.was_replaced,
      player_index: result.player_index,
    });

    return new Response(
      JSON.stringify({
        success:        true,
        was_bot:        result.was_replaced ?? false,
        username:       result.username,
        player_index:   result.player_index,
        message:        result.message,
        // Legacy field kept for compatibility with useConnectionManager
        result: {
          is_spectator: false,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('💥 [reconnect-player] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
