-- ============================================================================
-- Migration: Fix bot name doubling + enforce highest-play on auto-play
-- Branch: fix/auto-pass-cascade
-- Date: 2026-03-08
--
-- Problems fixed
-- --------------
-- 1. BOT NAME DOUBLING ("Bot Bot Alice")
--    When auto-play-turn (edge function) replaced a player with a bot it did not
--    set replaced_username, so reconnect_player() fell back to username
--    ("Bot Alice") instead of the clean name ("Alice").  On subsequent inactivity
--    cycles the prefix stacked: "Bot Bot Alice", "Bot Bot Bot Alice", …
--
--    Fixes applied here:
--    a) reconnect_player() now strips any number of leading "Bot " prefixes
--       from the restored username (handles existing bad rows in DB).
--    b) process_disconnected_players() strips "Bot " prefixes from the
--       current username before storing it as replaced_username, so even if
--       the column was previously populated with a polluted value the next
--       replacement cycle will clean it up.
--
-- 2. AUTO-PLAY MUST ALWAYS PLAY HIGHEST COMBINATION
--    The edge function already calls BotAI('hard').getPlay() but the hard
--    difficulty strategy intentionally plays the LOWEST valid card when
--    opponents have many cards.  The correct behaviour for an inactivity
--    auto-play is to always play the highest valid combination (or pass if
--    no valid play exists).  This is enforced exclusively in the TypeScript
--    edge function (see auto-play-turn/index.ts — uses playHighestValid()).
--    No SQL change needed for this fix.
-- ============================================================================

-- ============================================================================
-- Fix 1a: reconnect_player — strip "Bot " prefixes when restoring username
-- ============================================================================
CREATE OR REPLACE FUNCTION public.reconnect_player(
  p_room_id UUID,
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rec          RECORD;
  v_room_status  TEXT;
  v_was_bot      BOOLEAN := FALSE;
  v_clean_name   TEXT;
BEGIN
  -- 1. Room must still be active
  SELECT status INTO v_room_status
  FROM   public.rooms
  WHERE  id = p_room_id;

  IF NOT FOUND OR v_room_status NOT IN ('waiting', 'playing') THEN
    RETURN jsonb_build_object(
      'success',     FALSE,
      'room_closed', TRUE,
      'message',     'Room not found or already finished'
    );
  END IF;

  -- 2. Find the player's row.
  --    Either they are still the user_id (disconnected, not yet replaced)
  --    OR a bot is now sitting there and human_user_id = p_user_id.
  SELECT * INTO v_rec
  FROM   public.room_players
  WHERE  room_id = p_room_id
    AND  (
           user_id       = p_user_id
           OR human_user_id = p_user_id
         )
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'message', 'Player not found in this room'
    );
  END IF;

  v_was_bot := (v_rec.connection_status = 'replaced_by_bot');

  -- 3. Derive clean username: prefer replaced_username (most accurate), fall back
  --    to current username.  Then strip ALL stacked "Bot " prefixes so that
  --    bad rows from before this migration are automatically healed.
  v_clean_name := COALESCE(v_rec.replaced_username, v_rec.username, 'Player');
  -- Remove any number of leading "Bot " prefixes (case-insensitive).
  -- Loop to handle stacking: "Bot Bot Alice" → "Bot Alice" → "Alice"
  WHILE v_clean_name ILIKE 'Bot %' LOOP
    v_clean_name := TRIM(SUBSTRING(v_clean_name FROM 5));
  END LOOP;
  -- Fallback if stripping left an empty string
  IF v_clean_name = '' THEN
    v_clean_name := 'Player';
  END IF;

  -- 4. Restore the seat to the human
  UPDATE public.room_players
  SET
    user_id                     = p_user_id,
    human_user_id               = NULL,          -- seat is theirs again
    replaced_username           = NULL,
    is_bot                      = FALSE,
    bot_difficulty              = NULL,
    username                    = v_clean_name,
    connection_status           = 'connected',
    last_seen_at                = NOW(),
    disconnected_at             = NULL,
    disconnect_timer_started_at = NULL
  WHERE id = v_rec.id;

  RETURN jsonb_build_object(
    'success',      TRUE,
    'was_replaced', v_was_bot,
    'player_index', v_rec.player_index,
    'username',     v_clean_name,
    'message',      CASE WHEN v_was_bot THEN 'Reclaimed seat from bot' ELSE 'Reconnected successfully' END
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', FALSE, 'error', SQLERRM);
END;
$$;

-- Security: only edge functions (service_role) may invoke this.
REVOKE ALL ON FUNCTION public.reconnect_player(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconnect_player(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.reconnect_player(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reconnect_player(UUID, UUID) TO service_role;

COMMENT ON FUNCTION public.reconnect_player(UUID, UUID) IS
  'Allows a human to reconnect to their seat (simple reconnect or reclaim-from-bot). '
  'Strips any stacked "Bot " prefixes from the restored username to prevent name '
  'doubling when the same player is replaced multiple times during a game.';

-- ============================================================================
-- Fix 1b: process_disconnected_players — store clean name in replaced_username
--
-- Re-creates the function with a small addition: before writing replaced_username
-- we strip any "Bot " prefix from the current row's username.  This heals
-- existing polluted rows on the next replacement cycle.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.process_disconnected_players()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  HEARTBEAT_SLACK   CONSTANT INTERVAL := INTERVAL '30 seconds';
  BOT_REPLACE_AFTER CONSTANT INTERVAL := INTERVAL '60 seconds';

  rec               RECORD;
  v_room            RECORD;
  v_human_count     INTEGER;
  v_bot_difficulty  VARCHAR(10);
  v_marked          INTEGER := 0;
  v_replaced        INTEGER := 0;
  v_closed          INTEGER := 0;
  v_affected_codes  TEXT[]  := '{}';
  v_room_code       TEXT;
  v_turn_elapsed    INTERVAL;
  v_clean_username  TEXT;
BEGIN

  -- ── Phase A: Mark stale heartbeats as disconnected ───────────────────────
  FOR rec IN
    SELECT rp.id, rp.room_id
    FROM   public.room_players rp
    JOIN   public.rooms r ON r.id = rp.room_id
    WHERE  rp.is_bot             = FALSE
      AND  rp.connection_status  = 'connected'
      AND  rp.last_seen_at       < NOW() - HEARTBEAT_SLACK
      AND  r.status              = 'playing'
      AND  COALESCE((r.settings->>'is_offline')::BOOLEAN, FALSE) = FALSE
  LOOP
    UPDATE public.room_players
    SET
      connection_status           = 'disconnected',
      disconnected_at             = NOW(),
      disconnect_timer_started_at = COALESCE(disconnect_timer_started_at, NOW())
    WHERE id = rec.id
      AND connection_status = 'connected'
      AND last_seen_at < NOW() - HEARTBEAT_SLACK;

    IF FOUND THEN
      v_marked := v_marked + 1;
    END IF;
  END LOOP;

  -- ── Phase B: Replace long-disconnected players with bots (or close room) ─
  FOR rec IN
    SELECT rp.*, gs.current_turn, gs.turn_started_at
    FROM   public.room_players rp
    JOIN   public.rooms r ON r.id = rp.room_id
    LEFT JOIN public.game_state gs ON gs.room_id = r.id
    WHERE  rp.is_bot             = FALSE
      AND  rp.connection_status  = 'disconnected'
      AND  rp.disconnect_timer_started_at IS NOT NULL
      AND  rp.disconnect_timer_started_at < NOW() - BOT_REPLACE_AFTER
      AND  r.status              = 'playing'
      AND  COALESCE((r.settings->>'is_offline')::BOOLEAN, FALSE) = FALSE
  LOOP
    -- Active-turn guard: let auto-play-turn act first before replacing with bot
    IF rec.current_turn = rec.player_index AND rec.turn_started_at IS NOT NULL THEN
      v_turn_elapsed := NOW() - rec.turn_started_at;
      IF v_turn_elapsed < INTERVAL '70 seconds' THEN
        CONTINUE;
      END IF;
    END IF;

    SELECT * INTO v_room FROM public.rooms WHERE id = rec.room_id;

    -- Count remaining connected humans (excluding the disconnected player)
    SELECT COUNT(*)
    INTO   v_human_count
    FROM   public.room_players
    WHERE  room_id          = rec.room_id
      AND  is_bot           = FALSE
      AND  connection_status NOT IN ('disconnected', 'replaced_by_bot')
      AND  id               != rec.id;

    -- Sole human left → close the room instead of replacing
    IF v_human_count = 0 THEN
      UPDATE public.rooms
      SET
        status      = 'finished',
        finished_at = NOW(),
        updated_at  = NOW()
      WHERE id = rec.room_id
        AND status = 'playing';

      v_closed := v_closed + 1;
      CONTINUE;
    END IF;

    -- Determine bot difficulty
    IF v_room.ranked_mode = TRUE THEN
      v_bot_difficulty := 'hard';
    ELSE
      v_bot_difficulty := COALESCE(
        v_room.settings->>'bot_difficulty',
        rec.bot_difficulty,
        'medium'
      );
    END IF;

    -- Derive the clean player name: strip any stacked "Bot " prefixes so that
    -- replaced_username is always the original human name, not "Bot Alice" etc.
    v_clean_username := COALESCE(rec.username, 'Player');
    WHILE v_clean_username ILIKE 'Bot %' LOOP
      v_clean_username := TRIM(SUBSTRING(v_clean_username FROM 5));
    END LOOP;
    IF v_clean_username = '' THEN
      v_clean_username := 'Player';
    END IF;

    -- Replace the player row with a bot
    UPDATE public.room_players
    SET
      human_user_id               = rec.user_id,
      replaced_username           = v_clean_username,   -- always the clean name
      user_id                     = NULL,
      is_bot                      = TRUE,
      bot_difficulty              = v_bot_difficulty,
      username                    = 'Bot ' || v_clean_username,
      connection_status           = 'replaced_by_bot',
      disconnected_at             = NULL,
      disconnect_timer_started_at = NULL,
      last_seen_at                = NOW()
    WHERE id = rec.id
      AND connection_status = 'disconnected';

    IF FOUND THEN
      v_replaced := v_replaced + 1;

      SELECT code INTO v_room_code FROM public.rooms WHERE id = rec.room_id;
      IF v_room_code IS NOT NULL AND NOT (v_room_code = ANY(v_affected_codes)) THEN
        v_affected_codes := array_append(v_affected_codes, v_room_code);
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'marked_disconnected',         v_marked,
    'replaced_with_bot',           v_replaced,
    'rooms_closed',                v_closed,
    'rooms_with_bot_replacements', to_jsonb(v_affected_codes),
    'affected_room_codes',         to_jsonb(v_affected_codes)
  );
END;
$function$;

-- Restrict to service_role only
REVOKE ALL ON FUNCTION public.process_disconnected_players() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_disconnected_players() FROM anon;
REVOKE ALL ON FUNCTION public.process_disconnected_players() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.process_disconnected_players() TO service_role;

COMMENT ON FUNCTION public.process_disconnected_players IS
  'Sweeps room_players for stale heartbeats and replaces long-disconnected players with bots. '
  'Stores clean username (no "Bot " prefix) in replaced_username so reclaim always restores '
  'the original player name regardless of how many times they were replaced.';

-- ============================================================================
-- Heal any existing polluted replaced_username rows in the DB right now.
-- Updates rows where replaced_username starts with "Bot " to strip the prefix.
-- ============================================================================
UPDATE public.room_players
SET replaced_username = REGEXP_REPLACE(replaced_username, '^(Bot\s+)+', '', 'i')
WHERE replaced_username ILIKE 'Bot %';

-- ============================================================================
-- Fix get_rejoin_status — sync disconnect timer with in-game orange ring
--
-- The in-game InactivityCountdownRing (orange) anchors its countdown to
-- disconnect_timer_started_at — the persistent column set once when the
-- player first disconnects and never reset by reconnects.
--
-- The old implementation used disconnected_at (the last heartbeat fail time)
-- and returned an INTEGER seconds_left. The home-screen had to back-compute:
--   disconnectTimestamp = Date.now() - (60 - secondsLeft) * 1000
-- This introduced up to ±30s drift (disconnected_at vs disconnect_timer_started_at)
-- plus 1-second integer rounding loss.
--
-- Fix: use disconnect_timer_started_at as the anchor, and return the raw ISO
-- timestamp so the client calculates elapsed time with Date.now() — exactly
-- the same arithmetic the InactivityCountdownRing uses.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_rejoin_status(
  p_room_id UUID,
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rec          RECORD;
  v_room_status  TEXT;
  v_seconds_left INTEGER;
BEGIN
  SELECT status INTO v_room_status
  FROM   public.rooms WHERE id = p_room_id;

  IF NOT FOUND OR v_room_status = 'finished' THEN
    RETURN jsonb_build_object('status', 'room_closed');
  END IF;

  SELECT * INTO v_rec
  FROM   public.room_players
  WHERE  room_id = p_room_id
    AND  (user_id = p_user_id OR human_user_id = p_user_id)
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_in_room');
  END IF;

  IF v_rec.connection_status = 'replaced_by_bot' THEN
    RETURN jsonb_build_object(
      'status',        'replaced_by_bot',
      'player_index',  v_rec.player_index,
      'bot_username',  v_rec.username
    );
  END IF;

  IF v_rec.connection_status = 'disconnected' THEN
    -- Use disconnect_timer_started_at (persistent 60s anchor) as the source of truth.
    -- Fall back to disconnected_at if the column is NULL (older rows before the
    -- disconnect_timer_and_bot_trigger migration).
    DECLARE
      v_timer_anchor TIMESTAMPTZ;
    BEGIN
      v_timer_anchor := COALESCE(v_rec.disconnect_timer_started_at, v_rec.disconnected_at);

      v_seconds_left := GREATEST(
        0,
        60 - EXTRACT(EPOCH FROM (NOW() - v_timer_anchor))::INTEGER
      );

      RETURN jsonb_build_object(
        'status',                        'disconnected',
        'seconds_left',                  v_seconds_left,
        -- Return the raw ISO timestamp so clients can anchor their countdown
        -- to the same moment as the in-game InactivityCountdownRing.
        'disconnect_timer_started_at',   v_timer_anchor,
        'player_index',                  v_rec.player_index
      );
    END;
  END IF;

  RETURN jsonb_build_object(
    'status',       'connected',
    'player_index', v_rec.player_index
  );
END;
$$;

-- Restrict to service_role only (called by get-rejoin-status edge function)
REVOKE ALL ON FUNCTION public.get_rejoin_status(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_rejoin_status(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.get_rejoin_status(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_rejoin_status(UUID, UUID) TO service_role;

COMMENT ON FUNCTION public.get_rejoin_status IS
  'Returns the current rejoin status for a player in a room. '
  'For disconnected players, returns the raw disconnect_timer_started_at ISO timestamp '
  'so both the home-screen banner and in-game orange ring anchor to the same moment.';
