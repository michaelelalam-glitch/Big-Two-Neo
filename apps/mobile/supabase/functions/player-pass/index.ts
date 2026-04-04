// deno-lint-ignore-file no-explicit-any
import { createClient } from 'jsr:@supabase/supabase-js@2';
// Use shared parseCards utility to reduce duplication
import { parseCards } from '../_shared/parseCards.ts';
import { checkRateLimit, rateLimitResponse } from '../_shared/rateLimiter.ts';

// Rate-limit config for player-pass: same budget as play-cards.
// A player physically cannot pass more than once per turn, so 10/10s is very generous.
const PLAYER_PASS_RATE_LIMIT_MAX    = 10;
const PLAYER_PASS_RATE_LIMIT_WINDOW = 10; // seconds

// Higher budget for service-role callers (bots / internal) to prevent a compromised
// service key from performing unlimited passes while still bounding DoS impact.
// At 300 ms per move, a legitimate bot coordinator executes at most ~3 passes/s.
// 30 passes per 30 s (1/s sustained ceiling) is generous but finite.
const SERVICE_ROLE_RATE_LIMIT_MAX    = 30;
const SERVICE_ROLE_RATE_LIMIT_WINDOW = 30; // seconds

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ==================== TRAINING DATA HELPER ====================
/**
 * Fire-and-forget insert of a pass action into game_hands_training.
 * Mirrors the training insert in play-cards so the ML dataset contains both
 * play and pass actions (one row per decision). Non-blocking — uses
 * EdgeRuntime.waitUntil so it never delays the response.
 */
const PLAYER_PASS_HASH_CACHE_MAX = 1000;
const _playerPassHashCache = new Map<string, string>();
function _cachedPlayerPassHash(hash: string, id: string): void {
  if (_playerPassHashCache.size >= PLAYER_PASS_HASH_CACHE_MAX) {
    const firstKey = _playerPassHashCache.keys().next().value;
    if (firstKey !== undefined) _playerPassHashCache.delete(firstKey);
  }
  _playerPassHashCache.set(id, hash);
}

async function fireTrainingPassInsert(
  supabaseClient: any,
  room: { id: string; ranked_mode?: boolean | null; is_public?: boolean | null },
  room_code: string,
  gameState: any,
  player: any,
): Promise<void> {
  const insertPromise = (async () => {
    try {
      const stableId = (player.user_id ?? player.id)?.toString();
      if (!stableId) return;

      let playerHash = _playerPassHashCache.get(stableId);
      if (!playerHash) {
        const encoder = new TextEncoder();
        const hashBuf = await crypto.subtle.digest('SHA-256', encoder.encode(stableId));
        playerHash = Array.from(new Uint8Array(hashBuf))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');
        _cachedPlayerPassHash(playerHash, stableId);
      }

      const currentHands = (gameState.hands as Record<string, unknown>) || {};
      const playerHandRaw = currentHands[player.player_index] || [];
      const playerHand = Array.isArray(playerHandRaw) ? (playerHandRaw as unknown[]) : [];

      // opponent_hand_sizes: 4-element array indexed by player seat.
      // Own seat is null (not an opponent); the three opponent slots hold
      // the number of cards each opponent currently holds.
      const opponentHandSizes: (number | null)[] = [null, null, null, null];
      for (const idx of [0, 1, 2, 3]) {
        if (idx !== player.player_index) {
          const h = currentHands[idx];
          opponentHandSizes[idx] = Array.isArray(h) ? (h as unknown[]).length : 0;
        }
      }
      const totalCardsRemaining = Object.values(currentHands as Record<string, unknown[]>)
        .reduce((sum, h) => sum + (Array.isArray(h) ? h.length : 0), 0);

      const currentMatchNumber = (gameState.match_number as number) || 1;
      // play_sequence: derived from total_training_actions, a session-global
      // monotonically increasing counter persisted in game_state.total_training_actions
      // (added in migration 20260718000003). It increments on every play (play-cards)
      // and every pass (here). It NEVER resets between rounds/tricks, so play_sequence
      // values accumulate across rounds within a session. This is intentional: the
      // unique index on (game_session_id, round_number, play_sequence, player_index)
      // is still satisfied because the counter grows strictly — no two actions share
      // the same value within a session.
      const playSequence = (typeof gameState.total_training_actions === 'number' && Number.isFinite(gameState.total_training_actions)
        ? gameState.total_training_actions : 0) + 1;

      const trainingRow = {
        room_id: room.id,
        room_code,
        game_session_id: room.id,
        round_number: currentMatchNumber,
        play_sequence: playSequence,
        player_index: player.player_index,
        is_bot: player.is_bot ?? false,
        player_hash: playerHash,
        hand_before_play: playerHand,
        hand_size_before: playerHand.length,
        cards_played: [],
        combo_type: 'pass',
        combo_key: null,
        last_play_before: gameState.last_play ?? null,
        last_play_combo_type: (gameState.last_play as any)?.combo_type ?? null,
        is_first_play_of_round: false, // passing requires a last_play; leader cannot pass
        is_first_play_of_game: false,
        passes_before_this_play: (gameState.passes as number) || 0,
        opponent_hand_sizes: opponentHandSizes,
        total_cards_remaining: totalCardsRemaining,
        won_trick: false,
        won_round: false,
        won_game: false,
        cards_remaining_after_play: playerHand.length, // hand unchanged after pass
        was_highest_possible: false,
        alternative_plays_available: null,
        risk_score: null,
        game_ended_at: null,
        game_type: room.ranked_mode === true
          ? 'ranked'
          : (room.is_public ?? true) === true
            ? 'casual'
            : 'private',
        bot_difficulty: player.is_bot ? (player.bot_difficulty ?? null) : null,
      };

      const { error } = await supabaseClient
        .from('game_hands_training')
        .upsert(trainingRow, {
          onConflict: 'game_session_id,round_number,play_sequence,player_index',
          ignoreDuplicates: true,
        });
      if (error) console.warn('[player-pass] Training insert warning:', error.message);
    } catch (err) {
      console.warn('[player-pass] Training data prep failed (non-critical):', err);
    }
  })();

  try {
    (globalThis as any).EdgeRuntime?.waitUntil(insertPromise);
  } catch (_) { /* non-critical */ }
}

// ==================== BOT-COORDINATOR HELPER ====================
/**
 * Trigger bot-coordinator when the next player is a bot.
 *
 * Execution model:
 *   - The async DB lookup (is next player a bot?) is awaited at all call sites,
 *     so player-pass waits ~50 ms for the DB round-trip before returning.
 *   - The bot-coordinator HTTP fetch itself is background via EdgeRuntime.waitUntil:
 *     player-pass returns its Response once the DB lookup resolves; the runtime
 *     then keeps the background fetch alive until bot-coordinator finishes its full
 *     loop (up to LOCK_TIMEOUT_MS ≈ 30 s). The function's return value is void.
 *   - In environments without EdgeRuntime (local dev / unit tests) the fetch runs
 *     as a detached promise which may be GC'd; this is acceptable in non-prod contexts.
 *
 * Skips the call if the current request itself came from bot-coordinator
 * (prevents infinite loops).
 *
 * @param supabaseClient     Service-role Supabase client
 * @param roomId             Room UUID (for bot lookup)
 * @param roomCode           Room code (for bot-coordinator body)
 * @param nextTurn           Player index of the next player
 * @param req                Original request (to check x-bot-coordinator header)
 * @param label              Log label for tracing
 * @param callerIsServiceRole Whether the current request has service-role auth
 */
async function triggerBotCoordinatorIfNeeded(
  supabaseClient: any,
  roomId: string,
  roomCode: string,
  nextTurn: number,
  req: Request,
  label: string,
  callerIsServiceRole: boolean,
): Promise<void> {
  const sk = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  // If the incoming request was already identified as service-role AND has x-bot-coordinator
  // header, it came from bot-coordinator — don't recurse.
  const isInternalCall =
    callerIsServiceRole &&
    req.headers.get('x-bot-coordinator') === 'true';

  if (isInternalCall) return; // Don't recurse into bot-coordinator

  // Guard: skip if required env vars are not configured
  if (!sk || !Deno.env.get('SUPABASE_URL')) {
    console.warn('[player-pass] SUPABASE_SERVICE_ROLE_KEY or SUPABASE_URL not set — skipping bot coordinator trigger');
    return;
  }

  try {
    const { data: nextPlayer } = await supabaseClient
      .from('room_players')
      .select('is_bot')
      .eq('room_id', roomId)
      .eq('player_index', nextTurn)
      .single();

    if (nextPlayer?.is_bot) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
      // Start the bot-coordinator fetch in the background via EdgeRuntime.waitUntil.
      // player-pass returns immediately; the runtime keeps the task alive after the
      // Response is sent. This prevents blocking player-pass on bot turn execution
      // (bot-coordinator can run up to LOCK_TIMEOUT_MS ≈ 30 s) while guaranteeing
      // the coordinator runs to completion (unlike a fully detached void promise).
      const botPromise = fetch(`${supabaseUrl}/functions/v1/bot-coordinator`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${sk}`,
          'Content-Type': 'application/json',
          'x-bot-coordinator': 'true',
        },
        body: JSON.stringify({ room_code: roomCode }),
      }).then(async (res) => {
        if (res.ok) {
          console.log(`🤖 [player-pass] Bot coordinator triggered (${label}) for player ${nextTurn}`);
        } else {
          const body = await res.text().catch(() => '');
          console.error(`[player-pass] ⚠️ Bot coordinator (${label}) non-2xx: ${res.status}`, body);
        }
      }).catch((fetchErr: any) => {
        console.error(`[player-pass] ⚠️ Bot coordinator trigger (${label}) failed:`, fetchErr);
      });
      // EdgeRuntime.waitUntil ensures the background task completes even after
      // the handler has returned its Response. Falls back silently in environments
      // where EdgeRuntime is not available (local dev, unit tests).
      try { (globalThis as any).EdgeRuntime?.waitUntil(botPromise); } catch (_) {}
    }
  } catch (err) {
    console.error(`[player-pass] ⚠️ Bot next-player check (${label}) failed (non-critical):`, err);
  }
}

// ==================== MAIN HANDLER ====================

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    const supabaseClient = createClient(supabaseUrl, serviceKey);

    // ── Request size guard (DoS mitigation) ─────────────────────────────────
    // Reject oversized bodies before reading/parsing. Legitimate player-pass
    // payloads (room_code + player_id + optional _bot_auth) are tiny; 4 KB cap.
    const contentLength = Number(req.headers.get('content-length') ?? '0');
    if (contentLength > 4_096) {
      return new Response(
        JSON.stringify({ success: false, error: 'Request body too large' }),
        { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Early body peek for bot-coordinator authentication ─────────────────────
    // Body is read after the size guard above (Content-Length checked first).
    // JSON parse errors are caught; all further body access uses pre-parsed bodyJson.
    let bodyJson: Record<string, any> | null = null;
    const rawBodyText = await req.text().catch(() => '');
    try { bodyJson = rawBodyText ? JSON.parse(rawBodyText) : null; } catch { /* handled below */ }

    // ── Authorization check (BEFORE body parse, matching bot-coordinator pattern) ──
    // Service-role callers (bot-coordinator) may act for any player_id.
    // Non-service-role callers (clients) must present a valid user JWT; the resolved
    // user.id is compared against player_id after the body is parsed below.
    //
    // Three equivalent auth paths (header OR body token):
    //   1. SUPABASE_SERVICE_ROLE_KEY bearer match
    //   2. INTERNAL_BOT_AUTH_KEY custom header
    //   3. _bot_auth field in the request body (guaranteed to pass through unchanged)
    const authHeader  = req.headers.get('authorization') ?? '';
    const botAuthHdr  = req.headers.get('x-bot-auth') ?? '';
    const internalKey = Deno.env.get('INTERNAL_BOT_AUTH_KEY') ?? '';
    const hasInternalKey = internalKey !== '';
    const botBodyAuth = bodyJson?._bot_auth ?? '';
    const isServiceRole =
      (serviceKey !== '' && authHeader === `Bearer ${serviceKey}`) ||
      (hasInternalKey && botAuthHdr === internalKey) ||
      (hasInternalKey && botBodyAuth === internalKey);
    let callerJwtUserId: string | null = null;

    if (!isServiceRole) {
      const anonClient = createClient(
        supabaseUrl,
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data: { user }, error: authError } = await anonClient.auth.getUser();
      if (authError || !user) {
        return new Response(
          JSON.stringify({ success: false, error: 'Unauthorized' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      callerJwtUserId = user.id;
    }
    // ────────────────────────────────────────────────────────────────────────

    // Parse body AFTER auth — re-use the pre-parsed bodyJson from the early peek.
    let room_code: string, player_id: string;
    try {
      if (!bodyJson) throw new Error('no body');
      room_code = bodyJson.room_code;
      player_id = bodyJson.player_id;
    } catch (_e) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid JSON body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate required fields before the identity check so a missing/empty
    // player_id returns 400 (Bad Request) instead of a misleading 403 (Forbidden).
    if (!room_code || !player_id) {
      console.log('❌ [player-pass] Missing required fields');
      return new Response(
        JSON.stringify({ success: false, error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Now that we have a valid player_id, complete the identity check for client callers.
    if (!isServiceRole && callerJwtUserId !== player_id) {
      console.warn('[player-pass] 🔒 Forbidden: JWT user', callerJwtUserId?.substring(0, 8), '≠ player_id', player_id?.substring(0, 8));
      return new Response(
        JSON.stringify({ success: false, error: 'Forbidden: player_id does not match authenticated user' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Rate limiting (applies to ALL callers; service-role gets a higher budget) ──
    // Prevents pass spam from client-side AND a compromised service-role key.
    // Uses the shared rate_limit_tracking table — Task #556.
    // For service-role calls: player_id is room_players.id (not user_id), so each
    // bot player slot is tracked independently — a rogue coordinator cannot saturate
    // the limit across all bots simultaneously using a single bucket.
    {
      const [rlMax, rlWindow] = isServiceRole
        ? [SERVICE_ROLE_RATE_LIMIT_MAX, SERVICE_ROLE_RATE_LIMIT_WINDOW]
        : [PLAYER_PASS_RATE_LIMIT_MAX, PLAYER_PASS_RATE_LIMIT_WINDOW];
      const rl = await checkRateLimit(
        supabaseClient,
        player_id,
        'player_pass',
        rlMax,
        rlWindow,
      );
      if (!rl.allowed) {
        return rateLimitResponse(rl.retryAfterMs, corsHeaders);
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    console.log('🎮 [player-pass] Request received:', {
      room_code,
      player_id: player_id?.substring(0, 8),
    });

    // 1. Get room
    const { data: room, error: roomError } = await supabaseClient
      .from('rooms')
      .select('id, code, status, ranked_mode, is_public')
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
    // Service-role callers (bot-coordinator) pass room_players.id which works
    // for replacement bots that have user_id = NULL.
    // Client callers pass their auth user_id.
    let player: any, playerError: any;
    if (isServiceRole) {
      const result = await supabaseClient
        .from('room_players')
        .select('*')
        .eq('id', player_id)
        .eq('room_id', room.id)
        .single();
      player = result.data;
      playerError = result.error;
    } else {
      const result = await supabaseClient
        .from('room_players')
        .select('*')
        .eq('user_id', player_id)
        .eq('room_id', room.id)
        .single();
      player = result.data;
      playerError = result.error;
    }

    if (playerError || !player) {
      console.log('❌ [player-pass] Player not found:', playerError);
      return new Response(
        JSON.stringify({ success: false, error: 'Player not found in room' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3b. Clear persistent disconnect timer — player is actively playing
    if (!player.is_bot && player.disconnect_timer_started_at) {
      await supabaseClient
        .from('room_players')
        .update({ disconnect_timer_started_at: null })
        .eq('id', player.id)
        .eq('room_id', room.id);
    }

    // 4a. Reject passes when game is already finished/game_over
    if (gameState.game_phase === 'finished' || gameState.game_phase === 'game_over') {
      console.log('❌ [player-pass] Game already ended:', { game_phase: gameState.game_phase });
      return new Response(
        JSON.stringify({
          success: false,
          error: `Game already ended (phase: ${gameState.game_phase})`,
          game_phase: gameState.game_phase,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4b. Verify it's this player's turn
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
    
    // Calculate total players from hands object
    // Validate totalPlayers > 1 before proceeding
    // This prevents incorrect turn calculations when hands object is empty or malformed
    const totalPlayers = Object.keys(currentHands).length;

    // Skip One Card Left Rule when the auto_pass_timer is active.
    // An active (and typically already-expired) timer means ALL non-exempt players are
    // being force-passed. The courtesy rule must not block these forced passes — doing so
    // would leave the game permanently stuck when bots need to auto-pass.
    const isAutoPassScenario = !!gameState.auto_pass_timer?.active;

    // Only proceed with One Card Left check if we have valid player count AND it is NOT an auto-pass scenario
    if (totalPlayers > 1 && !isAutoPassScenario) {
    // Calculate next player index (counterclockwise: 0→1→2→3→0)
    // Use modulo arithmetic to support variable player counts
    const nextPlayerIndex = (player.player_index + 1) % totalPlayers;
    const nextPlayerHandRaw = currentHands[nextPlayerIndex] || [];
    
    // Using shared parseCards utility from _shared/parseCards.ts
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

      // Improved timeout cleanup - clear timeout BEFORE rejection
      // This prevents the issue where rejection happens before flag is set
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      let timeoutCleared = false; // Track if timeout was externally cleared
      
      // Helper to safely clear timeout
      const clearTimeoutSafe = () => {
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
          timeoutId = null;
          timeoutCleared = true;
        }
      };
      
      try {
        // Create a timeout promise (5 seconds max) with improved cleanup
        // Check if timeout was externally cleared before rejecting
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            // Only reject if timeout wasn't cleared externally (race was still pending)
            if (!timeoutCleared) {
              timeoutId = null; // Mark as fired
              reject(new Error('One Card Left validation timeout (5s)'));
            }
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
        // Always clear timeout in finally block to prevent memory leaks
        let raceResult: any;
        try {
          raceResult = await Promise.race([validationPromise, timeoutPromise]);
        } finally {
          // Always clear timeout using safe helper (idempotent)
          clearTimeoutSafe();
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
    } // End of if (totalPlayers > 1 && !isAutoPassScenario)

    // 6. Calculate next turn (counterclockwise: 0→1→2→3→0)
    // Turn order mapping: [0→1, 1→2, 2→3, 3→0]
    // Actual sequence: 0→1→2→3→0 (counterclockwise around the table)
    // NOTE: MUST match local game AI and play-cards function: [1, 2, 3, 0]
    const turnOrder = [1, 2, 3, 0]; // Next player index for current indices [0, 1, 2, 3]
    const nextTurn = turnOrder[player.player_index];
    
    // Monotonic action counter for training data play_sequence (never resets between tricks).
    const totalTrainingActions = typeof gameState.total_training_actions === 'number' && Number.isFinite(gameState.total_training_actions)
      ? gameState.total_training_actions : 0;

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
          total_training_actions: totalTrainingActions + 1,
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

      // Log pass action to training dataset (fire-and-forget)
      fireTrainingPassInsert(supabaseClient, room, room_code, gameState, player);

      // Trigger bot-coordinator if next player is a bot (Task #551)
      await triggerBotCoordinatorIfNeeded(supabaseClient, room.id, room_code, finalNextTurn, req, 'trick clear', isServiceRole);

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

    // ─────────────────────────────────────────────────────────────────────────
    // 8. SERVER-SIDE CASCADE: If auto_pass_timer is expired AND more passes are
    //    needed, complete ALL remaining passes atomically in this single edge
    //    function invocation.  This eliminates:
    //    (a) Sequential client-by-client auto-pass triggers (visible timer
    //        "reappearing" between each pass)
    //    (b) JWT 403 errors when one client tried to pass other humans
    //    (c) Dependency on every client being online to advance the game
    //
    //    After the cascade, a SINGLE game_state update goes out → ONE Realtime
    //    event → all clients see the final "trick cleared" state at once.
    // ─────────────────────────────────────────────────────────────────────────
    const autoTimer = gameState.auto_pass_timer as {
      active?: boolean;
      end_timestamp?: number;
      started_at?: string;
      duration_ms?: number;
      triggering_play?: { position?: number };
      player_index?: number;
    } | null;

    const isTimerExpired = (() => {
      if (!autoTimer?.active) return false;
      const endTs = autoTimer.end_timestamp ||
        (autoTimer.started_at
          ? new Date(autoTimer.started_at).getTime() + (autoTimer.duration_ms || 0)
          : 0);
      return Date.now() >= endTs;
    })();

    if (isTimerExpired && newPasses < 3) {
      // ⚡ CASCADE: Timer expired — complete all remaining passes atomically.
      // We know every non-exempt player MUST pass, so skip straight to the
      // "trick cleared" state in a single DB write.
      const exemptPlayerIndex = autoTimer?.triggering_play?.position ?? autoTimer?.player_index;

      console.log('⚡ [player-pass] SERVER-SIDE CASCADE: Timer expired, completing all remaining passes', {
        current_passes_after_this: newPasses,
        remaining_passes: 3 - newPasses,
        exempt_player: exemptPlayerIndex,
      });

      // The exempt player (who played the highest card) gets the next turn
      let cascadeNextTurn: number;
      if (typeof exemptPlayerIndex === 'number') {
        cascadeNextTurn = exemptPlayerIndex;
      } else {
        // Fallback: use SQL function
        const { data: correctNextTurn } = await supabaseClient
          .rpc('get_next_turn_after_three_passes', {
            p_game_state_id: gameState.id,
            p_last_passing_player_index: player.player_index,
          });
        cascadeNextTurn = (typeof correctNextTurn === 'number') ? correctNextTurn : nextTurn;
      }

      // Atomic update: skip to trick-cleared state
      const { error: cascadeError } = await supabaseClient
        .from('game_state')
        .update({
          current_turn: cascadeNextTurn,
          passes: 0,
          last_play: null,
          auto_pass_timer: null, // Clear timer — trick complete
          total_training_actions: totalTrainingActions + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', gameState.id);

      if (cascadeError) {
        console.log('❌ [player-pass] CASCADE failed:', cascadeError);
        return new Response(
          JSON.stringify({ success: false, error: 'Failed to update game state (cascade)' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('✅ [player-pass] CASCADE complete: trick cleared, turn →', cascadeNextTurn);

      // Log pass action to training dataset (fire-and-forget)
      fireTrainingPassInsert(supabaseClient, room, room_code, gameState, player);

      // Trigger bot-coordinator if the exempt player is a bot
      await triggerBotCoordinatorIfNeeded(supabaseClient, room.id, room_code, cascadeNextTurn, req, 'cascade', isServiceRole);

      return new Response(
        JSON.stringify({
          success: true,
          next_turn: cascadeNextTurn,
          trick_cleared: true,
          passes: 0,
          auto_pass_timer: null,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    // ── End of server-side cascade ────────────────────────────────────────

    // 8b. Normal pass (timer NOT expired, or no timer) - advance turn and increment pass count
    // 🔥 CRITICAL: Preserve auto_pass_timer - DO NOT set to NULL!
    const { error: updateError } = await supabaseClient
      .from('game_state')
      .update({
        current_turn: nextTurn,
        passes: newPasses,
        // DO NOT touch auto_pass_timer - preserve existing value!
        total_training_actions: totalTrainingActions + 1,
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

    // Log pass action to training dataset (fire-and-forget)
    fireTrainingPassInsert(supabaseClient, room, room_code, gameState, player);

    // Trigger bot-coordinator if next player is a bot (Task #551)
    await triggerBotCoordinatorIfNeeded(supabaseClient, room.id, room_code, nextTurn, req, 'normal pass', isServiceRole);

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
