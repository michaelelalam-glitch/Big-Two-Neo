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

const TURN_TIMEOUT_MS = 60_000; // 60 seconds
const AUTO_PLAY_RATE_LIMIT_MAX = 5;
const AUTO_PLAY_RATE_LIMIT_WINDOW = 60; // seconds

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AutoPlayResponse {
  success: boolean;
  action: 'play' | 'pass' | 'timeout_not_reached' | 'not_your_turn';
  cards?: Card[];
  error?: string;
  seconds_elapsed?: number;
}

/**
 * Replace an inactive human player with a bot after auto-play.
 * Mirrors the pattern used by process_disconnected_players():
 *  - is_bot = true, user_id = null, human_user_id = original user
 *  - connection_status = 'replaced_by_bot'
 *  - username = 'Bot <original_name>'
 * The Realtime subscription on the client detects the status change and shows
 * the RejoinModal ("Reclaim My Seat").
 */
async function replacePlayerWithBot(
  client: ReturnType<typeof createClient>,
  player: any,
  roomId: string,
): Promise<void> {
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
  } else {
    console.log(
      `[auto-play-turn] 🤖 Player ${player.player_index} (${cleanUsername}) replaced by bot after inactivity`,
    );
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

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
      return new Response(
        JSON.stringify({ 
          success: false, 
          action: 'not_your_turn',
          error: `Not your turn (current player: ${gameState.current_turn}, your user_id: ${user.id}, player_user_id: ${playerUserId}, human_user_id: ${playerHumanUserId})` 
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

    // ── Use BotAI to find best play (hard difficulty = highest cards) ──
    const hand = parseCards(gameState.hands[currentPlayer.player_index.toString()] || []);
    const lastPlay = gameState.last_play;
    const isFirstPlayOfGame = gameState.game_phase === 'first_play';
    const playerCardCounts = players.map(p => {
      const cards = gameState.hands[p.player_index.toString()] || [];
      return Array.isArray(cards) ? cards.length : 0;
    });

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

      // ── Replace inactive player with bot ──
      // The player was inactive for 60s. Mark them as a bot so the bot-coordinator
      // takes over on subsequent turns. The client detects 'replaced_by_bot' via
      // Realtime and shows the RejoinModal ("Reclaim My Seat").
      await replacePlayerWithBot(supabaseClient, currentPlayer, room.id);

      return new Response(
        JSON.stringify({ 
          success: true, 
          action: 'pass',
          replaced_by_bot: true,
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

      // ── Replace inactive player with bot ──
      await replacePlayerWithBot(supabaseClient, currentPlayer, room.id);

      return new Response(
        JSON.stringify({ 
          success: true, 
          action: 'play',
          cards: cardsToPlay,
          replaced_by_bot: true,
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
