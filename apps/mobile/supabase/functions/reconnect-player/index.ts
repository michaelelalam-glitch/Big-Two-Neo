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
      console.error('❌ [reconnect-player] Auth error:', authError);
      return new Response(
        JSON.stringify({ success: false, error: 'Not authenticated' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { room_id, player_id } = await req.json();

    console.log('🔄 [reconnect-player] Request received:', {
      user_id: user.id.substring(0, 8),
      room_id: room_id?.substring(0, 8),
      player_id: player_id?.substring(0, 8),
    });

    if (!room_id || !player_id) {
      console.log('❌ [reconnect-player] Missing required fields');
      return new Response(
        JSON.stringify({ success: false, error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get player info AND verify ownership
    const { data: player, error: playerError } = await supabaseClient
      .from('room_players')
      .select('id, user_id, username, connection_status, is_bot')
      .eq('id', player_id)
      .eq('room_id', room_id)
      .eq('user_id', user.id)
      .single();

    if (playerError || !player) {
      console.log('❌ [reconnect-player] Player not found or unauthorized:', playerError);
      return new Response(
        JSON.stringify({ success: false, error: 'Player not found or unauthorized' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let wasBot = false;
    let originalUsername = player.username;

    // If player was replaced by bot, restore original username
    if (player.connection_status === 'replaced_by_bot') {
      wasBot = true;
      
      // Safe bot username restoration: only strip 'Bot ' prefix if present
      // This prevents incorrect stripping if a legitimate user has 'Bot ' in their name
      if (typeof player.username === 'string' && player.username.startsWith('Bot ')) {
        originalUsername = player.username.substring('Bot '.length);
      } else {
        // If username doesn't match bot pattern, preserve it as-is
        // This handles edge cases where bot replacement didn't add the prefix
        originalUsername = player.username;
      }
      
      console.log('🤖 [reconnect-player] Player was replaced by bot, restoring:', {
        bot_username: player.username,
        original_username: originalUsername,
      });
    }

    // Update player connection status
    const { error: updateError } = await supabaseClient
      .from('room_players')
      .update({
        connection_status: 'connected',
        last_seen_at: new Date().toISOString(),
        disconnected_at: null,
        is_bot: false,
        username: originalUsername,
      })
      .eq('id', player_id)
      .eq('room_id', room_id);

    if (updateError) {
      console.log('❌ [reconnect-player] Update failed:', updateError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to reconnect player' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('✅ [reconnect-player] Success', { was_bot: wasBot });
    return new Response(
      JSON.stringify({ 
        success: true, 
        was_bot: wasBot,
        username: originalUsername,
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
