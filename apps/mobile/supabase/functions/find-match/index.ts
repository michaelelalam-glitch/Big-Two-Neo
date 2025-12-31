// deno-lint-ignore-file no-explicit-any
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ==================== TYPES ====================

interface FindMatchRequest {
  username: string;
  skill_rating?: number;
  region?: string;
  match_type?: 'casual' | 'ranked';
}

interface FindMatchResponse {
  matched: boolean;
  room_id?: string;
  room_code?: string;
  waiting_count: number;
}

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

    // Get user from JWT
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
    
    if (authError || !user) {
      console.error('❌ [find-match] Auth error:', authError);
      return new Response(
        JSON.stringify({ success: false, error: 'Not authenticated' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { username, skill_rating = 1000, region = 'global', match_type = 'casual' }: FindMatchRequest = await req.json();

    console.log('🎮 [find-match] Request received:', {
      user_id: user.id.substring(0, 8),
      username,
      skill_rating,
      region,
      match_type,
    });

    if (!username) {
      return new Response(
        JSON.stringify({ success: false, error: 'Username is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = user.id;
    const isRanked = match_type === 'ranked';

    // 1. Check if user is already in an active game
    const { data: activeRoomCheck, error: activeRoomCheckError } = await supabaseClient
      .from('room_players')
      .select('id, room_id, rooms!inner(status)')
      .eq('user_id', userId)
      .not('rooms.status', 'in', '(completed,abandoned)')
      .limit(1);

    if (activeRoomCheckError) {
      console.error('❌ [find-match] Error checking active rooms:', activeRoomCheckError);
    }

    if (activeRoomCheck && activeRoomCheck.length > 0) {
      console.log('⚠️ [find-match] User is already in an active game, denying matchmaking:', {
        user_id: userId.substring(0, 8),
        room_id: activeRoomCheck[0].room_id,
      });
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'You are already in an active game',
          room_id: activeRoomCheck[0].room_id,
        }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Clean up only completed/abandoned room_players for this user
    // Note: This uses a subquery which may not work in all Supabase versions
    // Alternative: Clean up all room_players since we've verified no active games above
    await supabaseClient
      .from('room_players')
      .delete()
      .eq('user_id', userId);

    // 3. Clean up only this user's stale waiting room entries (older than 5 minutes)
    // Note: This runs on every find-match call. For high-traffic scenarios,
    // consider moving this to a scheduled background job for better performance.
    await supabaseClient
      .from('waiting_room')
      .delete()
      .eq('user_id', userId)
      .eq('status', 'waiting')
      .lt('joined_at', new Date(Date.now() - 5 * 60 * 1000).toISOString());

    // 4. Insert or update user in waiting room
    const { error: insertError } = await supabaseClient
      .from('waiting_room')
      .upsert({
        user_id: userId,
        username,
        skill_rating,
        region,
        status: 'waiting',
        match_type,
        joined_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id',
      });

    if (insertError) {
      console.error('❌ [find-match] Failed to insert into waiting room:', insertError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to join matchmaking' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 5. Find waiting players (skill rating within 200, same region and match type, joined within last 5 minutes)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: waitingPlayers, error: searchError } = await supabaseClient
      .from('waiting_room')
      .select('*')
      .eq('status', 'waiting')
      .eq('region', region)
      .eq('match_type', match_type)
      .gte('skill_rating', skill_rating - 200)
      .lte('skill_rating', skill_rating + 200)
      .gte('joined_at', fiveMinutesAgo)
      .order('joined_at', { ascending: true })
      .limit(4);

    if (searchError) {
      console.error('❌ [find-match] Failed to search waiting room:', searchError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to search for match' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const waitingCount = waitingPlayers?.length || 0;

    console.log(`🔍 [find-match] Found ${waitingCount} waiting players`);

    // 6. If we have 4+ players, create a match
    // Note: There's a potential race condition where multiple concurrent find-match calls
    // might try to create rooms with overlapping players. For production, consider:
    // 1. Using database-level locking (SELECT ... FOR UPDATE)
    // 2. Implementing optimistic concurrency control
    // 3. Adding a 'processing' status to waiting_room entries
    if (waitingCount >= 4) {
      console.log('✅ [find-match] Creating match with 4 players');

      // Generate room code using RPC
      const { data: roomCodeData, error: codeError } = await supabaseClient.rpc('generate_room_code_v2');
      
      if (codeError || !roomCodeData) {
        console.error('❌ [find-match] Failed to generate room code:', codeError);
        return new Response(
          JSON.stringify({ success: false, error: 'Failed to generate room code' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const roomCode = roomCodeData;
      const hostId = waitingPlayers[0].user_id;

      // Create room
      const { data: room, error: roomError } = await supabaseClient
        .from('rooms')
        .insert({
          code: roomCode,
          host_id: hostId,
          status: 'waiting',
          max_players: 4,
          fill_with_bots: false,
          is_matchmaking: true,
          is_public: true,
          ranked_mode: isRanked,
        })
        .select('id')
        .single();

      if (roomError || !room) {
        console.error('❌ [find-match] Failed to create room:', roomError);
        return new Response(
          JSON.stringify({ success: false, error: 'Failed to create room' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const roomId = room.id;

      // Add players to room
      // Note: This performs multiple database operations without a transaction wrapper.
      // For production, consider wrapping room creation and player insertion in a
      // database transaction for atomicity. Current approach uses manual rollback on failure.
      const playersToAdd = waitingPlayers.slice(0, 4).map((player, index) => ({
        room_id: roomId,
        user_id: player.user_id,
        username: player.username,
        player_index: index,
        is_host: index === 0,
        is_ready: true,
        is_bot: false,
      }));

      const { error: playersError } = await supabaseClient
        .from('room_players')
        .insert(playersToAdd);

      if (playersError) {
        console.error('❌ [find-match] Failed to add players:', playersError);
        // Rollback: delete the room
        await supabaseClient.from('rooms').delete().eq('id', roomId);
        return new Response(
          JSON.stringify({ success: false, error: 'Failed to add players to room' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Update waiting room status for matched players
      const matchedUserIds = waitingPlayers.slice(0, 4).map(p => p.user_id);
      await supabaseClient
        .from('waiting_room')
        .update({
          status: 'matched',
          matched_room_id: roomId,
          matched_at: new Date().toISOString(),
        })
        .in('user_id', matchedUserIds);

      // Start game with bots (0 bots since we have 4 players)
      const { data: startResult, error: startError } = await supabaseClient.rpc('start_game_with_bots', {
        p_room_id: roomId,
        p_bot_count: 0,
        p_bot_difficulty: 'medium',
      });

      if (startError || !startResult?.success) {
        console.error('❌ [find-match] Failed to auto-start game:', startError || startResult);
        
        // Rollback: Delete room and reset waiting room entries
        await supabaseClient.from('rooms').delete().eq('id', roomId);
        await supabaseClient.from('room_players').delete().eq('room_id', roomId);
        await supabaseClient
          .from('waiting_room')
          .update({ status: 'waiting', matched_room_id: null })
          .in('user_id', matchedUserIds);
        
        return new Response(
          JSON.stringify({ success: false, error: 'Failed to start game' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('✅ [find-match] Match created successfully:', { room_id: roomId, room_code: roomCode });

      const response: FindMatchResponse = {
        matched: true,
        room_id: roomId,
        room_code: roomCode,
        waiting_count: 4,
      };

      return new Response(
        JSON.stringify(response),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } else {
      // Not enough players yet
      console.log(`⏳ [find-match] Waiting for more players (${waitingCount}/4)`);

      const response: FindMatchResponse = {
        matched: false,
        waiting_count: waitingCount,
      };

      return new Response(
        JSON.stringify(response),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  } catch (error: any) {
    console.error('💥 [find-match] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
