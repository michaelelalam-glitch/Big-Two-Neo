// deno-lint-ignore-file no-explicit-any
import { createClient } from 'jsr:@supabase/supabase-js@2';
// @copilot-review-fix: Use shared parseCards utility to reduce duplication
import { parseCards } from '../_shared/parseCards.ts';

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
    // BUT: Handle race condition where trick was just cleared by previous player's 3rd pass
    if (!gameState.last_play) {
      // Validate passes with type checking
      const rawPasses = gameState?.passes;
      const currentPasses =
        typeof rawPasses === 'number' && Number.isFinite(rawPasses) ? rawPasses : 0;
      
      // If passes is 0 and we have no last_play, this is a race condition:
      // The previous player's pass cleared the trick, making this player the leader.
      // The bot coordinator had already queued this pass action before the trick cleared.
      // Solution: Silently succeed and let them play as the leader on their actual turn.
      if (currentPasses === 0) {
        console.log('✅ [player-pass] Race condition detected: trick already cleared, succeeding gracefully');
        return new Response(
          JSON.stringify({
            success: true,
            next_turn: gameState.current_turn, // Keep current turn (they are now leader)
            passes: 0,
            trick_cleared: true,
            timer_preserved: false,
            auto_pass_timer: gameState.auto_pass_timer,
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // Otherwise, genuinely cannot pass when leading
      console.log('❌ [player-pass] Cannot pass when leading');
      return new Response(
        JSON.stringify({ success: false, error: 'Cannot pass when leading' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 5.5 ✅ ONE CARD LEFT RULE: Check if player can pass
    // Get current hands for all players
    const currentHands = gameState.hands || {};
    
    // Calculate next player index (counterclockwise: 0→1→2→3→0)
    // @copilot-review-fix: Use modulo arithmetic to support variable player counts
    const totalPlayers = Object.keys(currentHands).length || 4; // Default to 4 if hands empty
    const nextPlayerIndex = (player.player_index + 1) % totalPlayers;
    const nextPlayerHandRaw = currentHands[nextPlayerIndex] || [];
    
    // @copilot-review-fix: Using shared parseCards utility from _shared/parseCards.ts
    const nextPlayerHand = parseCards(nextPlayerHandRaw);
    const playerHandRaw = currentHands[player.player_index] || [];
    const playerHand = parseCards(playerHandRaw);
    const lastPlay = gameState.last_play;
    
    // Only check if: next player has 1 card AND last play was a single
    if (nextPlayerHand.length === 1 && lastPlay?.cards?.length === 1) {
      console.log('🎯 [player-pass] One Card Left check triggered:', {
        nextPlayerIndex,
        nextPlayerCards: nextPlayerHand.length,
        lastPlayCards: lastPlay.cards.length,
      });

      // @copilot-review-fix: Track timeout ID for cleanup on early resolution
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      let timeoutFired = false; // Track if timeout callback executed
      
      try {
        // Create a timeout promise (5 seconds max) with cleanup
        // @copilot-review-fix: Use flag to prevent unhandled rejection when timeout fires after race won
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            timeoutFired = true;
            timeoutId = null; // Mark as fired
            reject(new Error('One Card Left validation timeout (5s)'));
          }, 5000);
        });

        // Call SQL function - it will check if player has a higher single
        const validationPromise = supabaseClient
          .rpc('validate_one_card_left_rule', {
            p_selected_cards: [],              // Empty array = passing (no cards selected)
            p_current_player_hand: playerHand, // Player's current hand
            p_next_player_card_count: nextPlayerHand.length, // Should be 1
            p_last_play: lastPlay || null      // Last play object
          });

        // Race between validation and timeout
        // @copilot-review-fix: Always clear timeout in finally block to prevent memory leaks
        let raceResult: any;
        try {
          raceResult = await Promise.race([validationPromise, timeoutPromise]);
        } finally {
          // Always clear timeout if it hasn't fired yet
          if (timeoutId && !timeoutFired) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
        }
        const { data: oneCardLeftValidation, error: validationError } = raceResult;

        if (validationError) {
          console.error('❌ [player-pass] One Card Left SQL error:', {
            message: validationError.message,
            details: validationError.details,
            hint: validationError.hint,
            code: validationError.code,
          });
          // Don't block gameplay if SQL function fails - just log and continue
        } else if (oneCardLeftValidation && !oneCardLeftValidation.valid) {
          console.log('❌ [player-pass] One Card Left Rule blocks pass:', oneCardLeftValidation);
          return new Response(
            JSON.stringify({
              success: false,
              error: oneCardLeftValidation.error,
              required_card: oneCardLeftValidation.required_card,
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        } else {
          console.log('✅ [player-pass] One Card Left validation passed - no higher single available');
        }
      } catch (err) {
        console.error('❌ [player-pass] One Card Left exception:', err);
        // Don't block gameplay if validation throws - log and continue
      }
    }

    // 6. Calculate next turn (counterclockwise: 0→1→2→3→0)
    // Turn order mapping: [0→1, 1→2, 2→3, 3→0]
    // Actual sequence: 0→1→2→3→0 (counterclockwise around the table)
    // NOTE: MUST match local game AI and play-cards function: [1, 2, 3, 0]
    const turnOrder = [1, 2, 3, 0]; // Next player index for current indices [0, 1, 2, 3]
    const nextTurn = turnOrder[player.player_index];
    
    // Validate passes with type checking
    const rawPasses = gameState?.passes;
    // Use Number.isFinite in addition to typeof === 'number' to reject NaN, Infinity, and -Infinity,
    // which are technically numbers but would break the passes logic if accepted.
    const currentPasses =
      typeof rawPasses === 'number' && Number.isFinite(rawPasses) ? rawPasses : 0;
    const newPasses = currentPasses + 1;

    console.log('✅ [player-pass] Processing pass:', {
      player_index: player.player_index,
      next_turn: nextTurn,
      current_passes: currentPasses,
      new_passes: newPasses,
      current_auto_pass_timer: gameState.auto_pass_timer,
    });

    // 7. Check if 3 consecutive passes (new trick starts, reset passes)
    if (newPasses >= 3) {
      console.log('🎯 [player-pass] 3 consecutive passes - clearing trick');

      // ⚡ CRITICAL FIX: Determine correct next turn after 3 passes
      // If auto-pass timer is active, return to exempt player (who played highest card)
      // Otherwise, use normal turn advancement
      const { data: correctNextTurn, error: nextTurnError } = await supabaseClient
        .rpc('get_next_turn_after_three_passes', {
          p_game_state_id: gameState.id,
          p_last_passing_player_index: player.player_index,
        });

      if (nextTurnError) {
        console.error('❌ [player-pass] Failed to calculate next turn:', nextTurnError);
        // Fallback to normal turn order if SQL function fails
      }

      const finalNextTurn = (typeof correctNextTurn === 'number') ? correctNextTurn : nextTurn;
      
      console.log('🔄 [player-pass] Turn calculation:', {
        normal_next_turn: nextTurn,
        correct_next_turn: finalNextTurn,
        has_auto_pass_timer: !!gameState.auto_pass_timer,
        timer_active: gameState.auto_pass_timer?.active,
        exempt_player: gameState.auto_pass_timer?.player_index,
      });

      // Clear trick: remove last_play, reset pass count (stored in 'passes' field), set correct turn
      // 🔥 CRITICAL: Clear auto_pass_timer since all players have passed (trick complete)
      const { error: updateError } = await supabaseClient
        .from('game_state')
        .update({
          current_turn: finalNextTurn,
          passes: 0,
          last_play: null,
          auto_pass_timer: null, // Clear timer after trick completes
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

      console.log('✅ [player-pass] Trick cleared successfully, turn returned to player', finalNextTurn);

      return new Response(
        JSON.stringify({
          success: true,
          next_turn: finalNextTurn,
          trick_cleared: true,
          passes: 0,
          auto_pass_timer: null, // Timer cleared
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
        passes: newPasses,
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
        passes: newPasses,
        trick_cleared: false,
        auto_pass_timer: gameState.auto_pass_timer, // Return existing timer
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    // Normalize error with proper type guards (avoid leaking sensitive details)
    let message = 'Internal server error';
    let stack: string | undefined;

    if (error instanceof Error) {
      message = error.message || message;
      stack = error.stack;
    }

    console.error('❌ [player-pass] Unexpected error:', error);
    console.error('❌ [player-pass] Error stack:', stack);
    // TODO: In production, send error details to a logging service (e.g., Sentry, Datadog)
    // rather than relying on console.error which may not be persistent or searchable.
    
    // Only return generic error message to client (no stack traces in production)
    return new Response(
      JSON.stringify({
        success: false,
        error: message,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
