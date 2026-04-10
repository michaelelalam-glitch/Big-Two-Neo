// deno-lint-ignore-file no-explicit-any
/**
 * Auto-Play Turn Edge Function
 *
 * Called when a player's turn countdown expires (60s without action).
 * Auto-plays the highest valid cards OR passes if no valid play.
 *
 * Flow:
 * 1. Verify turn_started_at + 60s has elapsed
 * 2. Use BotAI (hard difficulty = aggressive, highest cards) to find best play
 * 3. Call play-cards or player-pass internally
 * 4. Return auto-played cards to show in "I'm Still Here?" modal
 *
 * @module auto-play-turn
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { BotAI } from '../_shared/botAI.ts';
import { parseCards } from '../_shared/parseCards.ts';
import { checkRateLimit, rateLimitResponse } from '../_shared/rateLimiter.ts';
import type { Card } from '../_shared/gameEngine.ts';
import { checkMinimumVersion } from '../_shared/versionCheck.ts';
// M12: CORS origin controlled by ALLOWED_ORIGIN env var
import { buildCorsHeaders } from '../_shared/cors.ts';

const TURN_TIMEOUT_MS = 60_000; // 60 seconds
const AUTO_PLAY_RATE_LIMIT_MAX = 5;
const AUTO_PLAY_RATE_LIMIT_WINDOW = 60; // seconds

const corsHeaders = buildCorsHeaders();




/**
 * Replace an inactive human player with a bot after auto-play.
 * Mirrors the pattern used by process_disconnected_players():
 *  - is_bot = true, user_id = null, human_user_id = original user
 *  - connection_status = 'replaced_by_bot'
 *  - username = 'Bot <original_name>'
 * The Realtime subscription on the client detects the status change and shows
 * the RejoinModal ("Reclaim My Seat").
 */
/** Replaces the given player slot with a bot. Returns true if the DB update
 *  succeeded, false if it failed (error is logged but not thrown so callers
 *  can still return a successful auto-play response). */
async function replacePlayerWithBot(
  client: ReturnType<typeof createClient>,
  player: any,
  roomId: string,
): Promise<boolean> {
  const originalUserId = player.user_id;
  // Strip any stacked "Bot " prefixes so reclaim always restores the clean name.
  // e.g. "Bot Bot Alice" → "Alice", "Alice" → "Alice"
  const cleanUsername = (player.username || 'Player').replace(/^(Bot )+/i, '').trim() || 'Player';

  // Determine bot difficulty from room settings
  const { data: room } = await client
    .from('rooms')
    .select('settings, bot_difficulty')
    .eq('id', roomId)
    .single();

  const botDifficulty =
    room?.settings?.bot_difficulty ?? room?.bot_difficulty ?? 'hard';

  const { error } = await client
    .from('room_players')
    .update({
      human_user_id: originalUserId,
      // Store the clean username so reconnect_player() RPC can restore it via
      // COALESCE(replaced_username, username) without ever re-adding "Bot ".
      replaced_username: cleanUsername,
      user_id: null,
      is_bot: true,
      bot_difficulty: botDifficulty,
      username: `Bot ${cleanUsername}`,
      connection_status: 'replaced_by_bot',
      disconnected_at: null,
      disconnect_timer_started_at: null,
    })
    .eq('id', player.id);

  if (error) {
    console.error(`[auto-play-turn] ❌ Failed to replace player with bot:`, error.message);
    return false;
  }
  console.log(
    `[auto-play-turn] 🤖 Player ${player.player_index} (${cleanUsername}) replaced by bot after inactivity`,
  );
  return true;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

    // C3: Enforce minimum app version
    const versionError = checkMinimumVersion(req, corsHeaders);
    if (versionError) return versionError;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabaseClient = createClient(supabaseUrl, serviceKey);

    // ── Authorization ──
    const authHeader = req.headers.get('authorization') ?? '';
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);

    if (userError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Rate limiting ──
    const rateLimitResult = await checkRateLimit(
      supabaseClient,
      user.id,
      'auto_play_turn',
      AUTO_PLAY_RATE_LIMIT_MAX,
      AUTO_PLAY_RATE_LIMIT_WINDOW,
    );
    if (!rateLimitResult.allowed) {
      return rateLimitResponse(rateLimitResult.retryAfterMs, corsHeaders);
    }

    // ── Parse request body ──
    const { room_code } = await req.json();
    if (!room_code) {
      return new Response(
        JSON.stringify({ success: false, error: 'room_code required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Fetch room ──
    const { data: room, error: roomError } = await supabaseClient
      .from('rooms')
      .select('id, code')
      .eq('code', room_code)
      .single();

    if (roomError || !room) {
      return new Response(
        JSON.stringify({ success: false, error: 'Room not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Fetch game state ──
    const { data: gameState, error: gsError } = await supabaseClient
      .from('game_state')
      .select('*')
      .eq('room_id', room.id)
      .single();

    if (gsError || !gameState) {
      return new Response(
        JSON.stringify({ success: false, error: 'Game state not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Fetch current player ──
    const { data: players, error: playersError } = await supabaseClient
      .from('room_players')
      .select('*')
      .eq('room_id', room.id)
      .order('player_index', { ascending: true });

    if (playersError || !players || players.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'Players not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const currentPlayer = players.find(p => p.player_index === gameState.current_turn);
    if (!currentPlayer) {
      return new Response(
        JSON.stringify({ success: false, error: 'Current player not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Verify it's the calling user's turn ──
    // Check both user_id (active player) and human_user_id (if replaced by bot)
    const playerUserId = currentPlayer.user_id;
    const playerHumanUserId = (currentPlayer as any).human_user_id;
    const isPlayersTurn = playerUserId === user.id || playerHumanUserId === user.id;
    
    console.log(`[auto-play-turn] Auth check: user=${user.id}, player_user_id=${playerUserId}, human_user_id=${playerHumanUserId}, isPlayersTurn=${isPlayersTurn}`);
    
    if (!isPlayersTurn) {
      // Log detailed IDs server-side only; return a generic message to the client
      // to avoid leaking internal user_id values in 403 responses.
      console.warn(`[auto-play-turn] Not your turn — caller=${user.id}, current_turn_player=${gameState.current_turn}, player_user_id=${playerUserId}, human_user_id=${playerHumanUserId}`);
      return new Response(
        JSON.stringify({ 
          success: false, 
          action: 'not_your_turn',
          error: 'Not your turn',
        }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Check if 60s timeout has elapsed ──
    const turnStartedAt = gameState.turn_started_at;
    if (!turnStartedAt) {
      return new Response(
        JSON.stringify({ success: false, error: 'turn_started_at not set' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const startTime = new Date(turnStartedAt).getTime();
    const now = Date.now();
    const elapsed = now - startTime;

    if (elapsed < TURN_TIMEOUT_MS) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          action: 'timeout_not_reached',
          seconds_elapsed: Math.floor(elapsed / 1000),
          error: `Timeout not reached (${Math.floor(elapsed / 1000)}s / 60s)` 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    console.log(`⏰ [auto-play-turn] Timeout reached for player ${currentPlayer.player_index} (${Math.floor(elapsed / 1000)}s elapsed)`);

    // ── Re-validate turn state before executing ──
    // Between the timeout check above and executing the play, another caller may have
    // already advanced the turn (race condition on multi-client retry). Re-fetch the
    // authoritative game state and confirm current_turn and turn_started_at are unchanged.
    const { data: freshGameState, error: freshGsError } = await supabaseClient
      .from('game_state')
      .select('current_turn, turn_started_at, game_phase')
      .eq('room_id', room.id)
      .single();

    if (freshGsError || !freshGameState) {
      return new Response(
        JSON.stringify({ success: false, error: 'Game state not found during re-validation' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (freshGameState.game_phase === 'finished' || freshGameState.game_phase === 'game_over') {
      return new Response(
        JSON.stringify({ success: true, action: 'skipped', reason: 'game_already_ended' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (freshGameState.current_turn !== currentPlayer.player_index) {
      console.log(`[auto-play-turn] Turn already advanced to ${freshGameState.current_turn} — skipping auto-play`);
      return new Response(
        JSON.stringify({ success: true, action: 'skipped', reason: 'turn_already_advanced' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (freshGameState.turn_started_at !== turnStartedAt) {
      console.log(`[auto-play-turn] turn_started_at changed — new turn already started, skipping`);
      return new Response(
        JSON.stringify({ success: true, action: 'skipped', reason: 'new_turn_started' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // P2-1 FIX: Check if the current player is already disconnected or replaced.
    // At the exact 60-second boundary, both this auto-play-turn invocation AND the
    // server-side pg_cron process_disconnected_players() can fire concurrently.
    // If the pg_cron sweep already replaced the player with a bot (connection_status ∈
    // ['replaced_by_bot', 'disconnected']), executing auto-play-turn will create a
    // race where two actors try to make a play for the same slot — risking duplicate
    // plays or conflicting DB writes.  Detecting disconnected/replaced status here
    // allows the server's bot-replacement mechanism to win without contention.
    const freshPlayerStatus = (currentPlayer as any).connection_status as string | undefined;
    if (freshPlayerStatus === 'disconnected' || freshPlayerStatus === 'replaced_by_bot') {
      console.log(
        `[auto-play-turn] Player ${currentPlayer.player_index} connection_status="${freshPlayerStatus}" — deferring to server bot-replacement (P2-1)`,
      );
      return new Response(
        JSON.stringify({ success: true, action: 'skipped', reason: 'player_disconnected' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── Use BotAI to find best play (hard difficulty = highest cards) ──
    const hand = parseCards(gameState.hands[currentPlayer.player_index.toString()] || []);
    const lastPlay = gameState.last_play;
    const isFirstPlayOfGame = gameState.game_phase === 'first_play';
    const playerCardCounts = players.map(p => {
      const cards = gameState.hands[p.player_index.toString()] || [];
      return Array.isArray(cards) ? cards.length : 0;
    });
    console.log(`[auto-play-turn] Card counts by player_index: ${playerCardCounts.join(', ')}`);

    // Always play the highest valid combination for inactivity auto-play.
    // We intentionally bypass BotAI.getPlay() strategy (which can choose to save
    // high cards) and use playHighestValid() which always maximises the played value.
    const botAI = new BotAI('hard');
    const playResult = botAI.playHighestValid({
      hand,
      lastPlay,
      isFirstPlayOfGame,
    });

    // ── Execute the play ──
    // CRITICAL: Use the room_players ROW ID (currentPlayer.id), NOT the user's auth UUID.
    // play-cards and player-pass with service-role key look up by room_players.id,
    // not user_id. Using the auth UUID causes a 404 every time.
    const effectivePlayerId = currentPlayer.id;
    
    console.log(`[auto-play-turn] Using room_players row ID: ${effectivePlayerId} (player_index=${currentPlayer.player_index}, user_id=${playerUserId}, human_user_id=${playerHumanUserId})`);
    console.log(`[auto-play-turn] Auto-play decision: ${playResult.reasoning}`);
    
    if (!playResult.cards || playResult.cards.length === 0) {
      // Pass
      console.log(`⏰ [auto-play-turn] Auto-passing for player ${currentPlayer.player_index}`);
      
      const passUrl = `${supabaseUrl}/functions/v1/player-pass`;
      const passRes = await fetch(passUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
          'x-auto-play': 'true', // Signal for logging
        },
        body: JSON.stringify({
          room_code: room.code,
          player_id: effectivePlayerId,
        }),
      });

      const passData = await passRes.json();
      if (!passRes.ok || !passData.success) {
        return new Response(
          JSON.stringify({ success: false, error: passData.error || 'Pass failed' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      // Always replace the inactive player with a bot (65s spec):
      // 60s inactivity → auto-play fires → immediate bot replacement.
      // Connected-but-AFK players reclaim their seat via the RejoinModal.
      const replacedPass = await replacePlayerWithBot(supabaseClient, currentPlayer, room.id);

      // Kick bot-coordinator so the newly-placed bot starts playing immediately
      // without waiting for the next heartbeat watchdog cycle (~15s).
      void fetch(`${supabaseUrl}/functions/v1/bot-coordinator`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
          'x-bot-coordinator': 'true',
        },
        body: JSON.stringify({ room_code: room.code }),
      }).catch((botErr: unknown) => {
        console.warn('[auto-play-turn] bot-coordinator trigger failed (non-critical):', botErr);
      });

      return new Response(
        JSON.stringify({ 
          success: true, 
          action: 'pass',
          replaced_by_bot: replacedPass,
          seconds_elapsed: Math.floor(elapsed / 1000),
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    } else {
      // Play cards
      const cardsToPlay = playResult.cards.map(cardId => {
        const card = hand.find(c => c.id === cardId);
        if (!card) throw new Error(`Card ${cardId} not found in hand`);
        return card;
      });

      console.log(`⏰ [auto-play-turn] Auto-playing ${cardsToPlay.length} cards for player ${currentPlayer.player_index}:`, cardsToPlay.map(c => c.id));

      const playUrl = `${supabaseUrl}/functions/v1/play-cards`;
      const playRes = await fetch(playUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
          'x-auto-play': 'true', // Signal for logging
        },
        body: JSON.stringify({
          room_code: room.code,
          player_id: effectivePlayerId,
          cards: cardsToPlay.map(c => ({ id: c.id, rank: c.rank, suit: c.suit })),
        }),
      });

      const playData = await playRes.json();
      if (!playRes.ok || !playData.success) {
        return new Response(
          JSON.stringify({ success: false, error: playData.error || 'Play failed' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      // Always replace the inactive player with a bot (65s spec):
      // 60s inactivity → auto-play fires → immediate bot replacement.
      // Connected-but-AFK players reclaim their seat via the RejoinModal.
      const replacedPlay = await replacePlayerWithBot(supabaseClient, currentPlayer, room.id);

      // Kick bot-coordinator so the newly-placed bot starts playing immediately
      // without waiting for the next heartbeat watchdog cycle (~15s).
      void fetch(`${supabaseUrl}/functions/v1/bot-coordinator`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
          'x-bot-coordinator': 'true',
        },
        body: JSON.stringify({ room_code: room.code }),
      }).catch((botErr: unknown) => {
        console.warn('[auto-play-turn] bot-coordinator trigger failed (non-critical):', botErr);
      });

      return new Response(
        JSON.stringify({ 
          success: true, 
          action: 'play',
          cards: cardsToPlay,
          replaced_by_bot: replacedPlay,
          seconds_elapsed: Math.floor(elapsed / 1000),
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
  } catch (error: any) {
    console.error('[auto-play-turn] ❌ Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error?.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
