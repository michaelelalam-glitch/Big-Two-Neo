import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

interface GameCompletionRequest {
  room_id: string | null; // Must be valid UUID or null for local games
  room_code: string;
  game_type: 'casual' | 'ranked' | 'private'; // Game mode
  players: {
    user_id: string;
    username: string;
    score: number;
    finish_position: number;
    cards_left: number; // Cards remaining at end of game
    was_bot: boolean; // Whether this player slot is a bot
    disconnected: boolean; // Whether player disconnected
    original_username: string | null; // Original player name before bot replaced them
    combos_played: {
      singles: number;
      pairs: number;
      triples: number;
      straights: number;
      flushes: number;
      full_houses: number;
      four_of_a_kinds: number;
      straight_flushes: number;
      royal_flushes: number;
    };
  }[];
  winner_id: string;
  game_duration_seconds: number;
  started_at: string;
  finished_at: string;
  game_completed: boolean; // Whether game reached natural conclusion (no forfeit)
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get service_role client for privileged operations
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    // Get authenticated user from request
    const authHeader = req.headers.get('Authorization')!;
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const gameData: GameCompletionRequest = await req.json();

    console.log('[Complete Game] Processing game completion:', {
      room_code: gameData.room_code,
      winner_id: gameData.winner_id,
      players_count: gameData.players.length,
    });

    // ============================================================================
    // STEP 1: VALIDATE GAME DATA
    // ============================================================================

    // ITEM 1: Reject local/offline games — they should never save to leaderboard
    if (gameData.room_code === 'LOCAL' && gameData.room_id === null) {
      console.log('[Complete Game] Rejected: local/offline game — stats not saved');
      return new Response(
        JSON.stringify({ error: 'Local/offline games cannot save stats', code: 'LOCAL_GAME_REJECTED' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate game_type
    const validGameTypes = ['casual', 'ranked', 'private'];
    if (!validGameTypes.includes(gameData.game_type)) {
      return new Response(
        JSON.stringify({ error: 'Invalid game_type. Must be casual, ranked, or private' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify the requesting user is one of the players
    const requestingPlayer = gameData.players.find(p => p.user_id === user.id);
    if (!requestingPlayer) {
      return new Response(
        JSON.stringify({ error: 'User not part of this game' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate game data integrity
    if (gameData.players.length !== 4) {
      return new Response(
        JSON.stringify({ error: 'Invalid game: must have 4 players' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify winner is one of the players
    const winner = gameData.players.find(p => p.user_id === gameData.winner_id);
    if (!winner) {
      return new Response(
        JSON.stringify({ error: 'Invalid winner_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify finish positions are valid (1-4, no duplicates)
    const positions = gameData.players.map(p => p.finish_position).sort();
    if (positions.join(',') !== '1,2,3,4') {
      return new Response(
        JSON.stringify({ error: 'Invalid finish positions' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify winner has position 1 (lowest score wins in Big Two)
    if (winner.finish_position !== 1) {
      return new Response(
        JSON.stringify({ error: 'Winner must have position 1' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ============================================================================
    // STEP 2: VALIDATE ROOM_ID (must be UUID or null)
    // ============================================================================
    
    // Validate room_id: must be null (local games) or valid UUID format
    if (gameData.room_id !== null) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(gameData.room_id)) {
        console.error(`[Complete Game] Invalid room_id format: ${gameData.room_id}`);
        return new Response(
          JSON.stringify({ error: 'room_id must be a valid UUID or null' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // ============================================================================
    // STEP 3: RECORD GAME HISTORY (for audit trail)
    // ============================================================================

    // Filter out bot players - only record real user IDs in game_history
    // Bot user_ids like "bot_player-1" don't exist in auth.users and would violate FK constraints
    // NOTE: This results in NULL values for bot player_id columns in game_history, which is expected
    // behavior since bots don't have auth.users records. Usernames are still preserved for all players.
    const realPlayers = gameData.players.map(p => p.user_id.startsWith('bot_') ? null : p.user_id);

    const { error: historyError } = await supabaseAdmin
      .from('game_history')
      .insert({
        room_id: gameData.room_id,
        room_code: gameData.room_code,
        game_type: gameData.game_type,
        player_1_id: realPlayers[0],
        player_2_id: realPlayers[1],
        player_3_id: realPlayers[2],
        player_4_id: realPlayers[3],
        player_1_username: gameData.players[0].username,
        player_2_username: gameData.players[1].username,
        player_3_username: gameData.players[2].username,
        player_4_username: gameData.players[3].username,
        player_1_score: gameData.players[0].score,
        player_2_score: gameData.players[1].score,
        player_3_score: gameData.players[2].score,
        player_4_score: gameData.players[3].score,
        // Bot tracking: original username before bot replacement
        player_1_original_username: gameData.players[0].original_username,
        player_2_original_username: gameData.players[1].original_username,
        player_3_original_username: gameData.players[2].original_username,
        player_4_original_username: gameData.players[3].original_username,
        // Bot flags
        player_1_was_bot: gameData.players[0].was_bot,
        player_2_was_bot: gameData.players[1].was_bot,
        player_3_was_bot: gameData.players[2].was_bot,
        player_4_was_bot: gameData.players[3].was_bot,
        // Disconnect flags
        player_1_disconnected: gameData.players[0].disconnected,
        player_2_disconnected: gameData.players[1].disconnected,
        player_3_disconnected: gameData.players[2].disconnected,
        player_4_disconnected: gameData.players[3].disconnected,
        // Cards left in hand at end
        player_1_cards_left: gameData.players[0].cards_left,
        player_2_cards_left: gameData.players[1].cards_left,
        player_3_cards_left: gameData.players[2].cards_left,
        player_4_cards_left: gameData.players[3].cards_left,
        // Game completion
        game_completed: gameData.game_completed,
        winner_id: gameData.winner_id.startsWith('bot_') ? null : gameData.winner_id,
        game_duration_seconds: gameData.game_duration_seconds,
        started_at: gameData.started_at,
        finished_at: gameData.finished_at,
      });

    if (historyError) {
      console.error('[Complete Game] Failed to record game history:', historyError);
      return new Response(
        JSON.stringify({ error: 'Failed to record game history', details: historyError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[Complete Game] Game history recorded successfully');

    // ============================================================================
    // STEP 3: UPDATE PLAYER STATS (for each REAL player only, skip bots)
    // ============================================================================

    // Only update stats for real players (not bots)
    const realPlayerData = gameData.players.filter(p => !p.user_id.startsWith('bot_'));

    const statsUpdatePromises = realPlayerData.map(async (player) => {
      const won = player.user_id === gameData.winner_id;

      console.log(`[Complete Game] Updating stats for ${player.username}: won=${won}, position=${player.finish_position}`);

      const { error: statsError } = await supabaseAdmin.rpc('update_player_stats_after_game', {
        p_user_id: player.user_id,
        p_won: won,
        p_finish_position: player.finish_position,
        p_score: player.score,
        p_combos_played: player.combos_played,
        p_game_type: gameData.game_type,
        p_completed: gameData.game_completed,
        p_cards_left: player.cards_left,
      });

      if (statsError) {
        console.error(`[Complete Game] Failed to update stats for ${player.username}:`, statsError);
        return { user_id: player.user_id, success: false, error: statsError.message };
      }

      return { user_id: player.user_id, success: true };
    });

    const statsResults = await Promise.all(statsUpdatePromises);
    const failedUpdates = statsResults.filter(r => !r.success);

    if (failedUpdates.length > 0) {
      console.error('[Complete Game] Some stats updates failed:', failedUpdates);
      return new Response(
        JSON.stringify({ 
          error: 'Partial failure updating stats', 
          failed_players: failedUpdates,
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[Complete Game] All player stats updated successfully');

    // ============================================================================
    // STEP 4: SEND PUSH NOTIFICATIONS
    // ============================================================================

    // SECURITY: User participation already validated in STEP 1 above
    // (requestingPlayer check ensures user is a game participant)

    try {
      const winnerPlayer = gameData.players.find(p => p.user_id === gameData.winner_id);
      const winnerName = winnerPlayer?.username || 'Unknown';
      
      // Notify winner
      if (!gameData.winner_id.startsWith('bot_')) {
        await supabaseAdmin.functions.invoke('send-push-notification', {
          body: {
            user_ids: [gameData.winner_id],
            title: '🎉 Victory!',
            body: `Congratulations! You won in room ${gameData.room_code}!`,
            data: {
              type: 'game_ended',
              room_code: gameData.room_code,
              room_id: gameData.room_id,
              winner: winnerName,
              is_winner: true,
            },
            sound: 'default',
            badge: 1,
          },
        });
      }
      
      // Notify other players
      const otherPlayers = realPlayerData.filter(p => p.user_id !== gameData.winner_id);
      if (otherPlayers.length > 0) {
        await supabaseAdmin.functions.invoke('send-push-notification', {
          body: {
            user_ids: otherPlayers.map(p => p.user_id),
            title: '🏁 Game Over',
            body: `${winnerName} won the game in room ${gameData.room_code}`,
            data: {
              type: 'game_ended',
              room_code: gameData.room_code,
              room_id: gameData.room_id,
              winner: winnerName,
              is_winner: false,
            },
            sound: 'default',
            badge: 1,
          },
        });
      }
      
      console.log('[Complete Game] Push notifications sent successfully');
    } catch (notifError) {
      console.warn('[Complete Game] Failed to send push notifications (non-critical):', notifError);
      // Don't fail the request - notifications are optional
    }

    // ============================================================================
    // STEP 5: BROADCAST game_ended EVENT TO ALL CLIENTS (CORRECTED)
    // ============================================================================
    // CRITICAL FIX: Properly broadcasts to subscribed clients
    
    if (gameData.room_id) {
      try {
        const winnerPlayer = gameData.players.find(p => p.user_id === gameData.winner_id);
        const finalScores = gameData.players
          .sort((a, b) => a.score - b.score) // Lowest score wins
          .map((p, index) => ({
            player_index: index,
            player_name: p.username,
            cumulative_score: p.score,
            points_added: 0, // Final game doesn't add points
            rank: p.finish_position,
            is_busted: p.score >= 101,
          }));
        
        const broadcastPayload = {
          game_winner_name: winnerPlayer?.username || 'Unknown',
          game_winner_index: gameData.players.findIndex(p => p.user_id === gameData.winner_id),
          final_scores: finalScores,
          room_code: gameData.room_code,
        };
        
        console.log('[Complete Game] Broadcasting game_ended to room:', gameData.room_id, broadcastPayload);
        
        // CORRECTED: Subscribe to channel, broadcast, then unsubscribe
        const channel = supabaseAdmin.channel(`room:${gameData.room_id}`);
        
        await channel.subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            const { error: broadcastError } = await channel.send({
              type: 'broadcast',
              event: 'game_ended',
              payload: broadcastPayload,
            });
            
            if (broadcastError) {
              console.error('[Complete Game] Failed to broadcast game_ended:', broadcastError);
            } else {
              console.log('[Complete Game] ✅ game_ended broadcast sent successfully');
            }
            
            // Unsubscribe after sending
            await supabaseAdmin.removeChannel(channel);
          }
        });
        
      } catch (broadcastError) {
        console.error('[Complete Game] Error broadcasting game_ended:', broadcastError);
        // Non-critical - continue
      }
    } else {
      console.log('[Complete Game] No room_id, skipping broadcast (local game)');
    }

    // ============================================================================
    // STEP 6: REFRESH LEADERBOARD
    // ============================================================================

    const { error: leaderboardError } = await supabaseAdmin.rpc('refresh_leaderboard');
    if (leaderboardError) {
      console.warn('[Complete Game] Leaderboard refresh failed (non-critical):', leaderboardError);
      // Don't fail the request - leaderboard will refresh eventually
    } else {
      console.log('[Complete Game] Leaderboard refreshed successfully');
    }

    // ============================================================================
    // STEP 7: RETURN SUCCESS
    // ============================================================================

    return new Response(
      JSON.stringify({ 
        success: true,
        message: 'Game completed and stats updated successfully',
        winner_id: gameData.winner_id,
        players_updated: gameData.players.length,
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('[Complete Game] Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
