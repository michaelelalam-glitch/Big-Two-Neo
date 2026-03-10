import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

interface GameCompletionRequest {
  room_id: string | null; // Must be valid UUID or null for local games
  room_code: string;
  game_type: 'casual' | 'ranked' | 'private'; // Game mode
  /** Difficulty of bot players in this game, if any (e.g. 'easy'|'medium'|'hard'). null for human-only games. */
  bot_difficulty?: string | null;
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
  // NOTE: voided_player_id is intentionally NOT accepted from the client.
  // The server deterministically computes who was the last human to leave by
  // sorting on COALESCE(room_players.disconnect_timer_started_at, disconnected_at) DESC
  // — this prevents a malicious client from setting voided_player_id to another
  // player to avoid abandonment penalties. last_seen_at is intentionally excluded
  // because it is contaminated by bot heartbeats for replaced players.
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

    // ITEM 1: 'CASUAL' games (human + bots, room_id=null) are valid and should save stats.
    // Only reject if room_code is exactly 'LOCAL' (legacy test/debug games with no human player).
    if (gameData.room_code === 'LOCAL') {
      console.log('[Complete Game] Rejected: LOCAL game code — stats not saved');
      return new Response(
        JSON.stringify({ error: 'LOCAL game code is reserved for test/debug only', code: 'LOCAL_GAME_REJECTED' }),
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

    // ── Determine voided player server-side (before insert so voided_user_id is stored) ──
    // Must also run before Step 3b which deletes room_players rows.
    //
    // Do NOT trust the client for this — a malicious caller could name any player
    // as voided to deny them an "abandoned" stat.  Instead, find the human with
    // the most-recent heartbeat-anchored disconnect timestamp in the room.
    //
    // Two categories of "gone" humans:
    //   1. is_bot=false, connection_status='disconnected': still-disconnected;
    //      disconnect_timer_started_at is the Phase-A heartbeat-anchored anchor.
    //   2. is_bot=true,  human_user_id IS NOT NULL:        replaced by bot;
    //      disconnected_at and disconnect_timer_started_at were both cleared on
    //      replacement; last_seen_at is updated by bot heartbeats (contaminated).
    //      Do NOT use last_seen_at in the sort key — fall back to NULL so replaced
    //      humans always sort AFTER still-disconnected humans.
    let serverVoidedPlayerId: string | null = null;
    if (!gameData.game_completed && gameData.room_id) {
      const { data: allGoneRows, error: lastGoneError } = await supabaseAdmin
        .from('room_players')
        .select('user_id, human_user_id, disconnect_timer_started_at, disconnected_at, is_bot')
        .eq('room_id', gameData.room_id)
        .in('connection_status', ['disconnected', 'replaced_by_bot']);

      if (lastGoneError) {
        console.error('[Complete Game] Failed to query voided player — all players will be recorded as abandoned:', lastGoneError.message);
      }

      if (allGoneRows && allGoneRows.length > 0) {
        // Sort by COALESCE(disconnect_timer_started_at, disconnected_at) DESC.
        // last_seen_at is intentionally excluded: for replaced_by_bot rows it
        // reflects bot heartbeats rather than the human's actual disconnect time.
        const candidates = allGoneRows
          .map(r => ({
            effectiveUserId: r.is_bot ? r.human_user_id : r.user_id,
            sortKey: r.disconnect_timer_started_at ?? r.disconnected_at as string | null,
          }))
          .filter(c => c.effectiveUserId != null);

        candidates.sort((a, b) => {
          if (!a.sortKey && !b.sortKey) {
            // Deterministic tiebreak when both timers are null (e.g., all replaced_by_bot rows):
            // sort by user_id string so the chosen voidedPlayerId is stable across re-runs.
            return (a.effectiveUserId ?? '').localeCompare(b.effectiveUserId ?? '');
          }
          if (!a.sortKey) return 1;
          if (!b.sortKey) return -1;
          return new Date(b.sortKey).getTime() - new Date(a.sortKey).getTime();
        });

        const lastGone = candidates[0];
        if (lastGone?.effectiveUserId) {
          // Sanity check: the player must be in the submitted player list
          const inList = gameData.players.some(p => p.user_id === lastGone.effectiveUserId);
          if (inList) {
            serverVoidedPlayerId = lastGone.effectiveUserId;
            console.log(`[Complete Game] Server-computed voided player: ${serverVoidedPlayerId}`);
          }
        }
      }
    }

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
        // Bot difficulty (same for all bots in a game)
        bot_difficulty: gameData.bot_difficulty ?? null,
        // Game completion
        game_completed: gameData.game_completed,
        winner_id: gameData.winner_id.startsWith('bot_') ? null : gameData.winner_id,
        game_duration_seconds: gameData.game_duration_seconds,
        started_at: gameData.started_at,
        finished_at: gameData.finished_at,
        // Voided player: null for completed games, set when last human left an unfinished game
        voided_user_id: serverVoidedPlayerId,
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

    // serverVoidedPlayerId is computed in STEP 3 above (before game_history insert)
    // to allow storing voided_user_id in the audit trail.

    // Query for humans who were replaced by bots BEFORE room_players is deleted in Step 3b.
    // These players left mid-game and must receive an ABANDONED stat regardless of whether
    // the game completed or not.  The client sends their slot as user_id="bot_X" which
    // would otherwise be silently filtered out by the realPlayerData filter below.
    // Must be queried here — after this point Step 3b deletes the room_players rows.
    let botReplacedHumanIds: string[] = [];
    if (gameData.room_id) {
      const { data: replacedRows, error: replacedError } = await supabaseAdmin
        .from('room_players')
        .select('human_user_id')
        .eq('room_id', gameData.room_id)
        .eq('is_bot', true)
        .not('human_user_id', 'is', null);

      if (replacedError) {
        console.error('[Complete Game] Failed to query bot-replaced humans (abandoned stats may be missed):', replacedError.message);
      } else {
        botReplacedHumanIds = (replacedRows ?? [])
          .map(r => r.human_user_id as string)
          .filter(Boolean);
        if (botReplacedHumanIds.length > 0) {
          console.log(`[Complete Game] Found ${botReplacedHumanIds.length} bot-replaced human(s) — will record ABANDONED:`, botReplacedHumanIds);
        }
      }
    }

    // Only update stats for real players (not bots)
    const realPlayerData = gameData.players.filter(p => !p.user_id.startsWith('bot_'));

    // ── Bot multiplier (applied to casual & private ELO formula) ─────────────
    // Determined by the hardest bot present; 1.0 for all-human lobbies.
    const botMultiplier =
      gameData.bot_difficulty === 'easy'   ? 0.5 :
      gameData.bot_difficulty === 'medium' ? 0.7 :
      gameData.bot_difficulty === 'hard'   ? 0.9 : 1.0;

    // ── Chess K=32 pairwise ELO (ranked & private games only) ────────────────
    // Must be computed before the stats update loop so all players' current
    // rated_rank_points are fetched simultaneously.
    const rankedEloDeltaMap = new Map<string, number>();

    if (gameData.game_type === 'ranked' || gameData.game_type === 'private') {
      // Collect all real player user IDs (including bot-replaced humans at pos 4)
      const allRealUserIds = [
        ...realPlayerData.map(p => p.user_id),
        ...botReplacedHumanIds,
      ];

      if (allRealUserIds.length > 0) {
        const { data: ratingRows, error: ratingError } = await supabaseAdmin
          .from('player_stats')
          .select('user_id, ranked_rank_points')
          .in('user_id', allRealUserIds);

        if (ratingError) {
          console.error('[Complete Game] Failed to fetch ranked_rank_points for ELO calc:', ratingError.message);
          // Fall back to 0 delta for all players
          allRealUserIds.forEach(id => rankedEloDeltaMap.set(id, 0));
        } else {
          // Build rating lookup (default 1000 for new players)
          const ratingLookup = new Map<string, number>();
          (ratingRows ?? []).forEach(r => {
            ratingLookup.set(r.user_id as string, (r.ranked_rank_points as number) ?? 1000);
          });
          allRealUserIds.forEach(id => {
            if (!ratingLookup.has(id)) ratingLookup.set(id, 1000);
            rankedEloDeltaMap.set(id, 0);
          });

          // Build finish-position list for all real players
          const finishList: Array<{ user_id: string; finish_position: number; rating: number }> = [
            ...realPlayerData.map(p => ({
              user_id: p.user_id,
              finish_position: p.finish_position,
              rating: ratingLookup.get(p.user_id) ?? 1000,
            })),
            ...botReplacedHumanIds.map(id => ({
              user_id: id,
              finish_position: 4, // abandoned players placed last
              rating: ratingLookup.get(id) ?? 1000,
            })),
          ];

          // Pairwise chess ELO: every unique pair (i, j) where pos_i < pos_j
          const K = 32;
          for (let a = 0; a < finishList.length; a++) {
            for (let b = a + 1; b < finishList.length; b++) {
              // Skip equal finish_position pairs — e.g., two bot-replaced humans
              // both set to position 4. Treating tied abandons as a winner/loser
              // pair is arbitrary and unfair; no ELO should be exchanged.
              if (finishList[a].finish_position === finishList[b].finish_position) continue;

              // Determine winner / loser of this pair by finish position
              const [winner, loser] =
                finishList[a].finish_position < finishList[b].finish_position
                  ? [finishList[a], finishList[b]]
                  : [finishList[b], finishList[a]];

              const expected = 1 / (1 + Math.pow(10, (loser.rating - winner.rating) / 400));
              const winnerDelta = Math.round(K * (1 - expected));
              const loserDelta  = -winnerDelta; // enforce zero-sum per pair: avoids rating inflation/deflation from independent rounding

              rankedEloDeltaMap.set(winner.user_id, (rankedEloDeltaMap.get(winner.user_id) ?? 0) + winnerDelta);
              rankedEloDeltaMap.set(loser.user_id,  (rankedEloDeltaMap.get(loser.user_id)  ?? 0) + loserDelta);
            }
          }
        }
      }
    }

    const statsUpdatePromises = realPlayerData.map(async (player) => {
      const won = player.user_id === gameData.winner_id;

      console.log(`[Complete Game] Updating stats for ${player.username}: won=${won}, position=${player.finish_position}, disconnected=${player.disconnected}`);

      // A player is voided when they were the last human to leave an unfinished game.
      // serverVoidedPlayerId is computed from room_players above — never from the client.
      const isVoided = !gameData.game_completed &&
        !!serverVoidedPlayerId &&
        player.user_id === serverVoidedPlayerId;

      // A disconnected-but-not-yet-bot-replaced player abandoned the game even if
      // game_completed=true (they were still in the room_players list with
      // connection_status='disconnected').  Treat them as abandoned rather than
      // completed so games_abandoned / ELO penalty are applied correctly.
      const isCompleted = gameData.game_completed && !player.disconnected;

      // Abandoned (disconnected, not voided) players receive a penalty score of 200 so
      // the ELO formula (100 - p_score) yields a negative delta (−100 × multiplier)
      // instead of rewarding a low game score earned before departure.
      const effectiveScore = (!isCompleted && !isVoided) ? 200 : player.score;

      const { error: statsError } = await supabaseAdmin.rpc('update_player_stats_after_game', {
        p_user_id: player.user_id,
        p_won: won,
        p_finish_position: player.finish_position,
        p_score: effectiveScore,
        p_combos_played: player.combos_played,
        p_game_type: gameData.game_type,
        p_completed: isCompleted,
        p_cards_left: player.cards_left,
        p_voided: isVoided,
        p_bot_multiplier: botMultiplier,
        p_ranked_elo_change: rankedEloDeltaMap.get(player.user_id) ?? 0,
      });

      if (statsError) {
        console.error(`[Complete Game] Failed to update stats for ${player.username}:`, statsError);
        return { user_id: player.user_id, success: false, error: statsError.message };
      }

      return { user_id: player.user_id, success: true };
    });

    // Record ABANDONED for every human who was replaced by a bot.
    // p_completed=false, p_voided=false → games_abandoned += 1, ELO penalty applied.
    // p_score=200 so the ELO formula (100 - score) yields a penalty (−100 × multiplier)
    // rather than rewarding abandonment with a large positive delta.
    // These run in parallel with the main statsUpdatePromises.
    const abandonedPromises = botReplacedHumanIds.map(async (humanUserId) => {
      const { error: abandonedError } = await supabaseAdmin.rpc('update_player_stats_after_game', {
        p_user_id: humanUserId,
        p_won: false,
        p_finish_position: 4,
        p_score: 200,
        p_combos_played: {},
        p_game_type: gameData.game_type,
        p_completed: false,
        p_cards_left: 0,
        p_voided: false,
        p_bot_multiplier: botMultiplier,
        p_ranked_elo_change: rankedEloDeltaMap.get(humanUserId) ?? 0,
      });

      if (abandonedError) {
        console.error(`[Complete Game] Failed to record ABANDONED for bot-replaced user ${humanUserId}:`, abandonedError.message);
        return { user_id: humanUserId, success: false, error: abandonedError.message };
      }

      console.log(`[Complete Game] ✅ Recorded ABANDONED for bot-replaced user: ${humanUserId}`);
      return { user_id: humanUserId, success: true };
    });

    const [statsResults, abandonedResults] = await Promise.all([
      Promise.all(statsUpdatePromises),
      Promise.all(abandonedPromises),
    ]);

    const failedStats = statsResults.filter(r => !r.success);
    const failedAbandoned = abandonedResults.filter(r => !r.success);

    // Abandoned-stat failures are non-blocking: the game completed successfully and
    // all real-player records were written. We log the failure loudly for ops
    // visibility but intentionally return a 200 rather than a 500, because the
    // completed game itself is valid and re-triggering the entire flow would cause
    // duplicate stat entries for the players whose records DID succeed.
    if (failedAbandoned.length > 0) {
      console.error('[Complete Game] ⚠️ Failed to record ABANDONED for some bot-replaced players (non-blocking):', failedAbandoned);
    }

    if (failedStats.length > 0) {
      console.error('[Complete Game] Some stats updates failed:', failedStats);
      return new Response(
        JSON.stringify({ 
          error: 'Partial failure updating stats', 
          failed_players: failedStats,
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[Complete Game] All player stats updated successfully');

    // ============================================================================
    // STEP 3b: CLOSE ROOM (mark ended + clean up room_players)
    // ============================================================================
    // Prevents "reconnect to game" banner after game completion.

    if (gameData.room_id) {
      try {
        // Mark room as ended so HomeScreen banner doesn't show it
        const { error: roomUpd } = await supabaseAdmin
          .from('rooms')
          .update({ status: 'ended' })
          .eq('id', gameData.room_id);

        if (roomUpd) {
          console.warn('[Complete Game] Failed to mark room as ended:', roomUpd.message);
        } else {
          console.log('[Complete Game] Room marked as ended');
        }

        // Remove all room_players entries so no user sees a stale banner
        const { error: rpDel } = await supabaseAdmin
          .from('room_players')
          .delete()
          .eq('room_id', gameData.room_id);

        if (rpDel) {
          console.warn('[Complete Game] Failed to clean room_players:', rpDel.message);
        } else {
          console.log('[Complete Game] Room players cleaned up');
        }
      } catch (roomCleanupErr) {
        console.warn('[Complete Game] Room cleanup error (non-critical):', roomCleanupErr);
      }
    }

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
