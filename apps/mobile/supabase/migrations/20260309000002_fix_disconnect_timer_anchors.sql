-- ============================================================================
-- Migration: Fix disconnect timer anchors for correct banner & ring sync
-- Branch: game/chinese-poker
-- Date: 2026-03-09
--
-- Problems fixed
-- --------------
-- 1. Navigator.reset() not calling mark-disconnected (client fix in useGameCleanup).
--    When the client fix is not deployed OR the app is force-closed, the heartbeat
--    detection path (process_disconnected_players Phase A) would fire ~30s late and
--    use NOW() as the disconnect_timer_started_at anchor — giving a fresh 60s
--    countdown instead of the correct remaining time.
--
-- 2. Turn timer carry-over on disconnect:
--    When a player disconnects during their active turn (e.g. 20s elapsed = 40s left),
--    both the in-game charcoal grey ring (other players' view) and the home-screen
--    banner (disconnected player's view) should start the countdown at the remaining
--    turn time (40s), NOT at a fresh 60s.
--
-- Fixes
-- -----
-- A. mark_player_disconnected(p_room_id, p_user_id):
--    Joins game_state. If it is the disconnecting player's turn and the turn started
--    within the last 60s, sets disconnect_timer_started_at = turn_started_at instead
--    of NOW(). COALESCE still ensures an already-running timer is never reset.
--
-- B. process_disconnected_players() Phase A:
--    Uses last_seen_at (when heartbeat stopped) as the disconnect_timer_started_at
--    anchor instead of NOW(). Also applies turn carry-over: if it's the player's
--    turn when Phase A detects them, uses the earlier of turn_started_at and
--    last_seen_at so the connection ring picks up where the turn ring left off.
-- ============================================================================

-- ── A. mark_player_disconnected ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_player_disconnected(p_room_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_is_offline      BOOLEAN;
  v_player_idx      INTEGER;
  v_current_turn    INTEGER;
  v_turn_started_at TIMESTAMPTZ;
  v_timer_anchor    TIMESTAMPTZ;
BEGIN
  -- Guard: skip offline rooms entirely
  SELECT COALESCE((settings->>'is_offline')::BOOLEAN, FALSE)
  INTO   v_is_offline
  FROM   public.rooms
  WHERE  id = p_room_id;

  IF v_is_offline THEN
    RETURN;
  END IF;

  -- Only proceed if the player is currently connected
  SELECT player_index
  INTO   v_player_idx
  FROM   public.room_players
  WHERE  room_id          = p_room_id
    AND  user_id          = p_user_id
    AND  connection_status = 'connected'
  LIMIT  1;

  IF NOT FOUND THEN
    RETURN; -- Not connected — nothing to do
  END IF;

  -- Fetch current game state to determine whether it's this player's turn
  SELECT current_turn, turn_started_at
  INTO   v_current_turn, v_turn_started_at
  FROM   public.game_state
  WHERE  room_id = p_room_id
  LIMIT  1;

  -- Determine the disconnect timer anchor:
  --   • If it's this player's turn AND the turn started within the last 60s,
  --     use turn_started_at so the disconnect timer (and home-screen banner)
  --     picks up exactly where the yellow turn ring left off — no jump to 60s.
  --   • Otherwise use NOW() for a fresh 60s countdown.
  IF v_current_turn IS NOT NULL
     AND v_current_turn = v_player_idx
     AND v_turn_started_at IS NOT NULL
     AND v_turn_started_at > NOW() - INTERVAL '60 seconds'
  THEN
    v_timer_anchor := v_turn_started_at;
  ELSE
    v_timer_anchor := NOW();
  END IF;

  UPDATE public.room_players
  SET
    connection_status           = 'disconnected',
    disconnected_at             = NOW(),
    -- COALESCE: never overwrite an already-running persistent timer
    disconnect_timer_started_at = COALESCE(disconnect_timer_started_at, v_timer_anchor)
  WHERE room_id          = p_room_id
    AND user_id          = p_user_id
    AND connection_status = 'connected';
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_player_disconnected(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_player_disconnected(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.mark_player_disconnected(UUID, UUID) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.mark_player_disconnected(UUID, UUID) TO service_role;

COMMENT ON FUNCTION public.mark_player_disconnected IS
  'Marks a player as disconnected. Sets disconnect_timer_started_at to turn_started_at '
  'when it is the player''s active turn (so the 60s window picks up where the turn '
  'timer left off), otherwise uses NOW() for a fresh 60s countdown.';


-- ── B. process_disconnected_players — Phase A anchor fix ────────────────────
-- Replaces Phase A's COALESCE(disconnect_timer_started_at, NOW()) anchor with
-- an anchor that reflects when the player actually stopped heartbeating, and also
-- carries over the turn timer when it's the player's active turn.
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

  -- Used in Phase A for anchor computation
  v_gs_current_turn    INTEGER;
  v_gs_turn_started_at TIMESTAMPTZ;
  v_phase_a_anchor     TIMESTAMPTZ;
BEGIN

  -- ── Phase A: Mark stale heartbeats as disconnected ───────────────────────
  -- selects last_seen_at and player_index so we can compute the correct timer anchor
  FOR rec IN
    SELECT rp.id, rp.room_id, rp.last_seen_at, rp.player_index
    FROM   public.room_players rp
    JOIN   public.rooms r ON r.id = rp.room_id
    WHERE  rp.is_bot             = FALSE
      AND  rp.connection_status  = 'connected'
      AND  rp.last_seen_at       < NOW() - HEARTBEAT_SLACK
      AND  r.status              = 'playing'
      AND  COALESCE((r.settings->>'is_offline')::BOOLEAN, FALSE) = FALSE
  LOOP
    -- Fetch game state to check if it's this player's active turn
    SELECT current_turn, turn_started_at
    INTO   v_gs_current_turn, v_gs_turn_started_at
    FROM   public.game_state
    WHERE  room_id = rec.room_id
    LIMIT  1;

    -- Anchor selection (Phase A):
    --   • Turn carry-over: if it's the player's turn and the turn started before
    --     the last heartbeat (always true since they were playing), use
    --     turn_started_at so the ring picks up where the yellow turn ring was.
    --   • Otherwise anchor to last_seen_at — the moment the heartbeat stopped —
    --     so the banner and ring correctly reflect time elapsed since they left,
    --     NOT a fresh 60s from when pg_cron ran (which would be ~30s too late).
    IF v_gs_current_turn = rec.player_index
       AND v_gs_turn_started_at IS NOT NULL
       AND v_gs_turn_started_at > rec.last_seen_at - INTERVAL '60 seconds'
    THEN
      -- Use the earlier of (turn_started_at, last_seen_at) so we never set an
      -- anchor that is NEWER than the heartbeat stop (which would give >60s left)
      v_phase_a_anchor := LEAST(v_gs_turn_started_at, rec.last_seen_at);
    ELSE
      -- Not their turn (or no game state) — anchor to when heartbeat stopped
      v_phase_a_anchor := rec.last_seen_at;
    END IF;

    UPDATE public.room_players
    SET
      connection_status           = 'disconnected',
      disconnected_at             = NOW(),
      -- Use the computed anchor; COALESCE ensures an existing timer is not reset
      disconnect_timer_started_at = COALESCE(disconnect_timer_started_at, v_phase_a_anchor)
    WHERE id                 = rec.id
      AND connection_status  = 'connected'
      AND last_seen_at       < NOW() - HEARTBEAT_SLACK;

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
      -- Use persistent timer (survives heartbeat-resume cycles)
      AND  rp.disconnect_timer_started_at IS NOT NULL
      AND  rp.disconnect_timer_started_at < NOW() - BOT_REPLACE_AFTER
      AND  r.status              = 'playing'
      AND  COALESCE((r.settings->>'is_offline')::BOOLEAN, FALSE) = FALSE
  LOOP
    -- Active-turn guard: if this player's turn is active and turn timer hasn't
    -- expired yet (60s + 10s buffer for auto-play), skip replacement to let
    -- auto-play-turn handle it first. This prevents a race where bot replacement
    -- interferes with the auto-play edge function.
    IF rec.current_turn = rec.player_index AND rec.turn_started_at IS NOT NULL THEN
      v_turn_elapsed := NOW() - rec.turn_started_at;
      IF v_turn_elapsed < INTERVAL '70 seconds' THEN
        CONTINUE; -- Let auto-play handle this player
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
      WHERE id     = rec.room_id
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

    -- Replace the player row with a bot
    UPDATE public.room_players
    SET
      human_user_id               = rec.user_id,
      replaced_username           = rec.username,
      user_id                     = NULL,
      is_bot                      = TRUE,
      bot_difficulty              = v_bot_difficulty,
      -- Strip any existing 'Bot ' prefix before prepending to prevent 'Bot Bot ...' doubling
      username                    = 'Bot ' || REGEXP_REPLACE(COALESCE(rec.username, 'Player'), '^Bot ', '', 'i'),
      connection_status           = 'replaced_by_bot',
      disconnected_at             = NULL,
      disconnect_timer_started_at = NULL,
      last_seen_at                = NOW()
    WHERE id               = rec.id
      AND connection_status = 'disconnected'; -- guard against races

    IF FOUND THEN
      v_replaced := v_replaced + 1;

      -- Collect the room code for bot-coordinator triggering
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

-- Restrict to service_role only (called by update-heartbeat edge function)
REVOKE ALL ON FUNCTION public.process_disconnected_players() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_disconnected_players() FROM anon;
REVOKE ALL ON FUNCTION public.process_disconnected_players() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.process_disconnected_players() TO service_role;

COMMENT ON FUNCTION public.process_disconnected_players IS
  'Sweeps room_players for stale heartbeats and replaces long-disconnected players with bots. '
  'Phase A anchors disconnect_timer_started_at to last_seen_at (not NOW()) so the '
  'home-screen banner immediately shows the correct remaining time. '
  'Turn carry-over: when it is the player''s active turn, uses turn_started_at as the '
  'anchor so the charcoal-grey disconnect ring picks up where the yellow turn ring left off.';
