// deno-lint-ignore-file no-explicit-any
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { checkMinimumVersion } from '../_shared/versionCheck.ts';
// M12: CORS origin controlled by ALLOWED_ORIGIN env var
import { buildCorsHeaders } from '../_shared/cors.ts';
// P5-2 Fix: DB-backed rate limiter — enforced globally across all isolates.
import { checkRateLimit } from '../_shared/rateLimiter.ts';






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
  const corsHeaders = buildCorsHeaders();
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

    // C3: Enforce minimum app version
    const versionError = checkMinimumVersion(req, corsHeaders);
    if (versionError) return versionError;

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
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
    
    if (authError || !user) {
      console.error('❌ [find-match] Auth error:', authError);
      return new Response(
        JSON.stringify({ success: false, error: 'Not authenticated' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // P5-2 Fix: Rate limit find-match to prevent matchmaking abuse (10 req/60s per user).
    const rl = await checkRateLimit(supabaseClient, user.id, 'find_match', 10, 60);
    if (!rl.allowed) {
      return new Response(
        JSON.stringify({ success: false, error: 'Rate limit exceeded. Please wait before searching again.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } }
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
    // Scoped to avoid race condition: another request could create a room_player
    // between step 1 and step 2, so we only delete from finished games.
    const { data: staleEntries, error: staleSelectError } = await supabaseClient
      .from('room_players')
      .select('id, rooms!inner(status)')
      .eq('user_id', userId)
      .in('rooms.status', ['completed', 'abandoned']);

    if (staleSelectError) {
      console.error('⚠️ Failed to query stale room_players:', staleSelectError.message);
    }

    if (staleEntries && staleEntries.length > 0) {
      const { error: staleDeleteError } = await supabaseClient
        .from('room_players')
        .delete()
        .eq('user_id', userId)
        .in('id', staleEntries.map((e: { id: string }) => e.id));

      if (staleDeleteError) {
        console.error('⚠️ Failed to delete stale room_players:', staleDeleteError.message);
      }
    }

    // 3. Clean up only this user's stale waiting room entries (older than 5 minutes)
    // Note: This runs on every find-match call. For high-traffic scenarios,
    // consider moving this to a scheduled background job for better performance.
    await supabaseClient
      .from('waiting_room')
      .delete()
      .eq('user_id', userId)
      .eq('status', 'waiting')
      .lt('joined_at', new Date(Date.now() - 5 * 60 * 1000).toISOString());

    // 3b. Recover stale 'processing' rows for this user.
    // A crashed/timed-out find-match invocation may leave the user's row stuck
    // in 'processing', which causes the ignoreDuplicates INSERT in Step 4 to
    // silently skip the row and the Step B UPDATE (constrained to status='waiting')
    // to also skip it. This blocks the user from re-joining matchmaking until the
    // row is cleaned up. We revert it back to 'waiting' if it has been in
    // 'processing' for more than 30 seconds (well past any normal match-assembly
    // window), so the subsequent upsert can refresh the row's data as usual.
    // Use processing_started_at when available (set by step 6a) for an accurate
    // staleness check; fall back to joined_at for legacy rows that predate the
    // column addition (COALESCE logic via OR filter).
    const thirtySecsAgo = new Date(Date.now() - 30 * 1000).toISOString();
    const { error: staleProcessingRecoveryError } = await supabaseClient
      .from('waiting_room')
      .update({ status: 'waiting', processing_started_at: null })
      .eq('user_id', userId)
      .eq('status', 'processing')
      .or(`processing_started_at.lt.${thirtySecsAgo},and(processing_started_at.is.null,joined_at.lt.${thirtySecsAgo})`);
    if (staleProcessingRecoveryError) {
      console.error('❌ [find-match] Stale processing recovery failed:', staleProcessingRecoveryError.message);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to recover from stale matchmaking state' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3c. Recover stale 'matched' rows for this user.
    // A 'matched' row whose room was abandoned (room expired / ON DELETE logic
    // didn't clean the waiting_room row) prevents the user from re-entering the
    // queue: Step A (ignoreDuplicates) silently skips the existing row and Step B
    // only refreshes rows in 'waiting' state. Reset matched rows that are >5 min
    // old so the subsequent upsert can proceed normally.
    const { error: staleMatchedRecoveryError } = await supabaseClient
      .from('waiting_room')
      .update({ status: 'waiting', matched_room_id: null, matched_at: null })
      .eq('user_id', userId)
      .eq('status', 'matched')
      .lt('matched_at', new Date(Date.now() - 5 * 60 * 1000).toISOString());
    if (staleMatchedRecoveryError) {
      console.error('❌ [find-match] Stale matched recovery failed:', staleMatchedRecoveryError.message);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to recover from stale matched state' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // H9 Fix: Check if user already has a waiting_room entry in 'processing' or
    // 'matched' state. A concurrent find-match may have already claimed this user
    // for a match. The ignoreDuplicates upsert in step 4 would silently skip the
    // insert, leaving the user stuck without feedback.
    const { data: existingEntry, error: existingEntryError } = await supabaseClient
      .from('waiting_room')
      .select('status, matched_room_id')
      .eq('user_id', userId)
      .in('status', ['processing', 'matched'])
      .maybeSingle();

    if (existingEntryError) {
      console.error('❌ [find-match] Error checking existing waiting_room entry:', existingEntryError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to check existing waiting room state' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (existingEntry) {
      if (existingEntry.status === 'matched' && existingEntry.matched_room_id) {
        // Already matched — fetch room code from rooms table and return the match result
        console.log('ℹ️ [find-match] User already matched, returning existing match');
        const { data: roomData } = await supabaseClient
          .from('rooms')
          .select('code')
          .eq('id', existingEntry.matched_room_id)
          .maybeSingle();
        return new Response(
          JSON.stringify({
            matched: true,
            room_id: existingEntry.matched_room_id,
            room_code: roomData?.code ?? undefined,
            waiting_count: 4,
          } as FindMatchResponse),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      // Status is 'processing' — another invocation is assembling a match
      console.log('ℹ️ [find-match] User is in processing state, returning waiting');
      return new Response(
        JSON.stringify({ matched: false, waiting_count: 0 } as FindMatchResponse),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4. Insert or update user in waiting room.
    // Two-step upsert that protects rows already in 'processing' state:
    //   Step A — INSERT the new row; if a row already exists, do nothing (ignoreDuplicates)
    //            so that a concurrent find-match that already flipped this user's row to
    //            'processing' is not overwritten back to 'waiting'.
    //   Step B — UPDATE the row only when it is still in 'waiting' state so stale
    //            skill_rating / region / match_type data is refreshed, but
    //            'processing' rows (mid-assembly by another invocation) are left intact.
    const entryData = {
      user_id: userId,
      username,
      skill_rating,
      region,
      status: 'waiting' as const,
      match_type,
      joined_at: new Date().toISOString(),
    };

    // Step A: Insert if absent; skip silently if the row already exists.
    const { error: insertOnlyError } = await supabaseClient
      .from('waiting_room')
      .upsert(entryData, { onConflict: 'user_id', ignoreDuplicates: true });

    if (insertOnlyError) {
      console.error('❌ [find-match] Failed to insert into waiting room:', insertOnlyError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to join matchmaking' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step B: Refresh the existing row's data only if it's still 'waiting' (not 'processing').
    const { error: insertError } = await supabaseClient
      .from('waiting_room')
      .update({ username, skill_rating, region, match_type, joined_at: entryData.joined_at })
      .eq('user_id', userId)
      .eq('status', 'waiting');

    if (insertError) {
      console.error('❌ [find-match] Failed to update waiting room entry:', insertError);
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

    // C5 Fix: Write waiting_count to all waiting players' rows so Realtime
    // UPDATE events carry the current queue size to connected clients.
    if (waitingPlayers && waitingPlayers.length > 0) {
      const waitingUserIds = waitingPlayers.map((p: any) => p.user_id);
      const { error: waitingCountUpdateError } = await supabaseClient
        .from('waiting_room')
        .update({ waiting_count: waitingCount })
        .in('user_id', waitingUserIds)
        .eq('status', 'waiting');

      if (waitingCountUpdateError) {
        console.error('⚠️ [find-match] Failed to update waiting_count for Realtime queue sync:', {
          error: waitingCountUpdateError,
          region,
          match_type,
          waitingCount,
          waitingUserIds,
        });
      }
    }

    // 6. If we have 4+ players, create a match
    if (waitingCount >= 4) {
      console.log('✅ [find-match] Creating match with 4 players');

      // 6a. Optimistic concurrency lock — atomically claim all 4 seats by flipping
      // status 'waiting' → 'processing'. Only one concurrent find-match invocation
      // can succeed because the others will see 'processing' rows and get < 4 hits.
      // Any invocation that doesn't update all 4 rows backs off and returns "waiting".
      // This eliminates the previous race condition where two concurrent callers could
      // match the same players and create two rooms for the same group.
      const candidateIds = (waitingPlayers as any[]).slice(0, 4).map((p: any) => p.user_id);
      // Use .select() (not head:true) so we get the actual row IDs back.
      // This lets us revert EXACTLY the rows this invocation flipped, without
      // touching rows already locked by a concurrent caller.
      const { data: lockedRows, error: lockError } = await supabaseClient
        .from('waiting_room')
        .update({ status: 'processing', processing_started_at: new Date().toISOString() })
        .in('user_id', candidateIds)
        .eq('status', 'waiting') // Only lock rows still in 'waiting' state
        .select('user_id');

      if (lockError) {
        console.error('❌ [find-match] Optimistic lock update failed:', lockError);
        return new Response(
          JSON.stringify({ success: false, error: 'Failed to join matchmaking' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const lockedCount = lockedRows?.length ?? 0;
      // The IDs we actually flipped in THIS invocation (not rows owned by concurrent callers)
      const lockedIds = (lockedRows ?? []).map((r: any) => r.user_id);

      if (lockedCount < 4) {
        // Another concurrent caller already claimed some of these players; back off.
        console.log(`⏳ [find-match] Lost optimistic lock (locked ${lockedCount}/4), backing off`);
        // Reset only the rows THIS invocation locked — only revert rows still in
        // 'processing' to avoid clobbering a row that may have legitimately advanced
        // (e.g. matched by another invocation after this backup read).
        if (lockedIds.length > 0) {
          await supabaseClient
            .from('waiting_room')
            .update({ status: 'waiting', processing_started_at: null })
            .in('user_id', lockedIds)
            .eq('status', 'processing'); // Only revert rows we actually own
        }
        return new Response(
          JSON.stringify({ success: false, matched: false, waiting_count: waitingCount }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Generate room code using RPC
      const { data: roomCodeData, error: codeError } = await supabaseClient.rpc('generate_room_code_v2');
      
      if (codeError || !roomCodeData) {
        console.error('❌ [find-match] Failed to generate room code:', codeError);
        // Release optimistic lock so these players can be re-matched.
        // Guard on status='processing' to avoid clobbering rows advanced by a
        // concurrent invocation after this lock was acquired.
        await supabaseClient.from('waiting_room').update({ status: 'waiting', processing_started_at: null }).in('user_id', lockedIds).eq('status', 'processing');
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
        // Release optimistic lock so these players can be re-matched
        await supabaseClient.from('waiting_room').update({ status: 'waiting', processing_started_at: null }).in('user_id', lockedIds).eq('status', 'processing');
        return new Response(
          JSON.stringify({ success: false, error: 'Failed to create room' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const roomId = room.id;

      // Add players to room (multiple ops without a transaction; failures are rolled back manually below)
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
        // Rollback: delete the room and release optimistic lock
        await supabaseClient.from('rooms').delete().eq('id', roomId);
        await supabaseClient.from('waiting_room').update({ status: 'waiting', processing_started_at: null }).in('user_id', lockedIds).eq('status', 'processing');
        return new Response(
          JSON.stringify({ success: false, error: 'Failed to add players to room' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Update waiting room status for matched players
      // H10 Fix: Use lockedIds (the rows THIS invocation actually locked) instead
      // of matchedUserIds (derived from the original query snapshot which may include
      // players that were grabbed by a concurrent invocation).
      const { error: matchedUpdateError } = await supabaseClient
        .from('waiting_room')
        .update({
          status: 'matched',
          matched_room_id: roomId,
          matched_at: new Date().toISOString(),
        })
        .in('user_id', lockedIds);

      if (matchedUpdateError) {
        console.error('❌ [find-match] Failed to mark players as matched:', matchedUpdateError);
        // Rollback: rows are still in 'processing'; delete room/players and release lock
        await supabaseClient.from('rooms').delete().eq('id', roomId);
        await supabaseClient.from('room_players').delete().eq('room_id', roomId);
        await supabaseClient
          .from('waiting_room')
          .update({ status: 'waiting', processing_started_at: null })
          .in('user_id', lockedIds)
          .eq('status', 'processing');
        return new Response(
          JSON.stringify({ success: false, error: 'Failed to update match status' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Start game with bots (0 bots since we have 4 players)
      const { data: startResult, error: startError } = await supabaseClient.rpc('start_game_with_bots', {
        p_room_id: roomId,
        p_bot_count: 0,
        p_bot_difficulty: 'medium',
      });

      if (startError || !startResult?.success) {
        console.error('❌ [find-match] Failed to auto-start game:', startError || startResult);
        
        // Rollback: Delete room, room_players, and release optimistic lock.
        // matched-status update succeeded above, so lockedIds rows are in 'matched' state;
        // no status predicate needed — lockedIds already scopes to only rows this invocation locked.
        await supabaseClient.from('rooms').delete().eq('id', roomId);
        await supabaseClient.from('room_players').delete().eq('room_id', roomId);
        await supabaseClient
          .from('waiting_room')
          .update({ status: 'waiting', matched_room_id: null, matched_at: null, processing_started_at: null })
          .in('user_id', lockedIds);
        
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
