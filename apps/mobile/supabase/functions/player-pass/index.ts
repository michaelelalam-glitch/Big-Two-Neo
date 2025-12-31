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

    const { room_code, player_id } = await req.json();

    console.log('🎮 [player-pass] Request received:', {
      room_code,
      player_id: player_id?.substring(0, 8),
    });

    if (!room_code || !player_id) {
      console.log('❌ [player-pass] Missing required fields');
      return new Response(
        JSON.stringify({ success: false, error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 1. Get room
    const { data: room, error: roomError } = await supabaseClient
      .from('rooms')
      .select('id, code, status')
      .eq('code', room_code)
      .single();

    if (roomError || !room) {
      console.log('❌ [player-pass] Room not found:', roomError);
      return new Response(
        JSON.stringify({ success: false, error: 'Room not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Get game state
    const { data: gameState, error: gameError } = await supabaseClient
      .from('game_state')
      .select('*')
      .eq('room_id', room.id)
      .single();

    if (gameError || !gameState) {
      console.log('❌ [player-pass] Game state not found:', gameError);
      return new Response(
        JSON.stringify({ success: false, error: 'Game state not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3. Get player info
    const { data: player, error: playerError } = await supabaseClient
      .from('room_players')
      .select('*')
      .eq('user_id', player_id)
      .eq('room_id', room.id)
      .single();

    if (playerError || !player) {
      console.log('❌ [player-pass] Player not found:', playerError);
      return new Response(
        JSON.stringify({ success: false, error: 'Player not found in room' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4. Verify it's this player's turn
    if (gameState.current_turn !== player.player_index) {
      console.log('❌ [player-pass] Not player\'s turn:', {
        current_turn: gameState.current_turn,
        player_index: player.player_index,
      });
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Not your turn',
          current_turn: gameState.current_turn,
          your_index: player.player_index,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 5. Cannot pass if leading (no last_play)
    if (!gameState.last_play) {
      console.log('❌ [player-pass] Cannot pass when leading');
      return new Response(
        JSON.stringify({ success: false, error: 'Cannot pass when leading' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 6. Calculate next turn (anticlockwise: 0→3→2→1→0)
    // Turn order mapping: [0→3, 1→2, 2→0, 3→1]
    const turnOrder = [3, 2, 0, 1]; // Next player index for current indices [0, 1, 2, 3]
    const nextTurn = turnOrder[player.player_index];
    const newPassCount = (gameState.passes || 0) + 1;

    console.log('✅ [player-pass] Processing pass:', {
      player_index: player.player_index,
      next_turn: nextTurn,
      new_pass_count: newPassCount,
      current_auto_pass_timer: gameState.auto_pass_timer,
    });

    // 7. Check if 3 consecutive passes (new trick starts)
    if (newPassCount >= 3) {
      console.log('🎯 [player-pass] 3 consecutive passes - clearing trick');

      // Clear trick: remove last_play, reset pass count, advance turn
      // 🔥 CRITICAL: Preserve auto_pass_timer if it exists!
      // The timer should persist until: (1) timer expires, or (2) someone beats the highest play
      const { error: updateError } = await supabaseClient
        .from('game_state')
        .update({
          current_turn: nextTurn,
          pass_count: 0,
          last_play: null,
          // DO NOT set auto_pass_timer to NULL - let it persist!
          updated_at: new Date().toISOString(),
        })
        .eq('id', gameState.id);

      if (updateError) {
        console.log('❌ [player-pass] Failed to update game state:', updateError);
        return new Response(
          JSON.stringify({ success: false, error: 'Failed to update game state' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('✅ [player-pass] Trick cleared successfully');

      return new Response(
        JSON.stringify({
          success: true,
          next_turn: nextTurn,
          trick_cleared: true,
          pass_count: 0,
          auto_pass_timer: gameState.auto_pass_timer, // Return existing timer
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 8. Normal pass - just advance turn and increment pass count
    // 🔥 CRITICAL: Preserve auto_pass_timer - DO NOT set to NULL!
    const { error: updateError } = await supabaseClient
      .from('game_state')
      .update({
        current_turn: nextTurn,
        pass_count: newPassCount,
        // DO NOT touch auto_pass_timer - preserve existing value!
        updated_at: new Date().toISOString(),
      })
      .eq('id', gameState.id);

    if (updateError) {
      console.log('❌ [player-pass] Failed to update game state:', updateError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to update game state' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('✅ [player-pass] Pass processed successfully');

    return new Response(
      JSON.stringify({
        success: true,
        next_turn: nextTurn,
        pass_count: newPassCount,
        trick_cleared: false,
        auto_pass_timer: gameState.auto_pass_timer, // Return existing timer
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('❌ [player-pass] Unexpected error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message || 'Internal server error',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
