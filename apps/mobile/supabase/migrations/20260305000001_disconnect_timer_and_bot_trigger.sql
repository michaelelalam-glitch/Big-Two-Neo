-- Migration: disconnect_timer_and_bot_trigger
-- Purpose:
--   1. Add a persistent disconnect timer that is NOT reset by heartbeat resume
--   2. Return affected room codes from process_disconnected_players so
--      the edge function can trigger bot-coordinator for stuck bots
--   3. Implement 1-human-3-bots room-close rule (already existed, preserved)

-- ────────────────────────────────────────────────────────────────────────────
-- 1. New column: persistent disconnect timer
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.room_players
  ADD COLUMN IF NOT EXISTS disconnect_timer_started_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_room_players_disconnect_timer
  ON public.room_players (disconnect_timer_started_at)
  WHERE disconnect_timer_started_at IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. process_disconnected_players  (sweeps stale heartbeats + replaces)
--
--    Phase A: marks stale-heartbeat players; sets disconnect_timer_started_at
--             only if not already set (COALESCE).
--    Phase B: uses disconnect_timer_started_at (not disconnected_at) so the
--             timer survives heartbeat-resume cycles.
--    Returns: rooms_with_bot_replacements[] for bot-coordinator triggering.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.process_disconnected_players()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  -- tunables
  HEARTBEAT_SLACK   CONSTANT INTERVAL := INTERVAL '30 seconds';
  BOT_REPLACE_AFTER CONSTANT INTERVAL := INTERVAL '60 seconds';

  rec               RECORD;
  v_room            RECORD;
  v_human_count     INTEGER;
  v_original_human_count INTEGER;
  v_bot_difficulty  VARCHAR(10);
  v_marked          INTEGER := 0;
  v_replaced        INTEGER := 0;
  v_closed          INTEGER := 0;
  v_affected_codes  TEXT[] := '{}';
  v_room_code       TEXT;
  v_game_state      RECORD;
BEGIN

  -- ──────────────────────────────────────────────────────────────────────────
  -- PHASE A: Mark stale-heartbeat human players as disconnected
  -- ──────────────────────────────────────────────────────────────────────────
  FOR rec IN
    SELECT rp.id, rp.room_id
    FROM   public.room_players rp
    JOIN   public.rooms r ON r.id = rp.room_id
    WHERE  rp.is_bot           = FALSE
      AND  rp.connection_status = 'connected'
      AND  rp.last_seen_at      < NOW() - HEARTBEAT_SLACK
      AND  r.status             = 'playing'
      AND  COALESCE((r.settings->>'is_offline')::BOOLEAN, FALSE) = FALSE
  LOOP
    UPDATE public.room_players
    SET
      connection_status          = 'disconnected',
      disconnected_at            = NOW(),
      -- Key fix: only set the persistent timer if not already running
      disconnect_timer_started_at = COALESCE(disconnect_timer_started_at, NOW())
    WHERE id = rec.id
      AND connection_status = 'connected'
      AND last_seen_at < NOW() - HEARTBEAT_SLACK;

    IF FOUND THEN
      v_marked := v_marked + 1;
    END IF;
  END LOOP;

  -- ──────────────────────────────────────────────────────────────────────────
  -- PHASE B: Replace long-disconnected players with bots (or close room)
  --
  -- Uses disconnect_timer_started_at (persistent, not reset by heartbeat)
  -- instead of disconnected_at (which gets cleared on heartbeat resume).
  -- ──────────────────────────────────────────────────────────────────────────
  FOR rec IN
    SELECT rp.*
    FROM   public.room_players rp
    JOIN   public.rooms r ON r.id = rp.room_id
    WHERE  rp.is_bot           = FALSE
      AND  rp.connection_status = 'disconnected'
      AND  rp.disconnect_timer_started_at IS NOT NULL
      AND  rp.disconnect_timer_started_at < NOW() - BOT_REPLACE_AFTER
      AND  r.status             = 'playing'
      AND  COALESCE((r.settings->>'is_offline')::BOOLEAN, FALSE) = FALSE
  LOOP
    SELECT * INTO v_room FROM public.rooms WHERE id = rec.room_id;

    -- Count remaining active humans (excluding this disconnected player)
    SELECT COUNT(*)
    INTO   v_human_count
    FROM   public.room_players
    WHERE  room_id          = rec.room_id
      AND  is_bot           = FALSE
      AND  connection_status != 'disconnected'
      AND  connection_status != 'replaced_by_bot'
      AND  id               != rec.id;

    -- ── Special rule: 1 human + 3 bots → close room ────────────────────
    -- If the disconnected player is the ONLY human that was ever in the room
    -- (all others are original bots, not replacement bots), close the room.
    -- This covers the "1 human playing with 3 AI bots" scenario.
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

    -- ── Determine replacement bot difficulty ────────────────────────────
    IF v_room.ranked_mode = TRUE THEN
      v_bot_difficulty := 'hard';
    ELSE
      v_bot_difficulty := COALESCE(
        v_room.settings->>'bot_difficulty',
        rec.bot_difficulty,
        'medium'
      );
    END IF;

    -- ── Replace the player with a bot ───────────────────────────────────
    UPDATE public.room_players
    SET
      human_user_id              = rec.user_id,
      replaced_username          = rec.username,
      user_id                    = NULL,
      is_bot                     = TRUE,
      bot_difficulty             = v_bot_difficulty,
      username                   = 'Bot ' || COALESCE(rec.username, 'Player'),
      connection_status          = 'replaced_by_bot',
      disconnected_at            = NULL,
      disconnect_timer_started_at = NULL,
      last_seen_at               = NOW()
    WHERE id = rec.id
      AND connection_status = 'disconnected';

    IF FOUND THEN
      v_replaced := v_replaced + 1;

      -- Collect room code for bot-coordinator trigger
      SELECT code INTO v_room_code FROM public.rooms WHERE id = rec.room_id;
      IF v_room_code IS NOT NULL AND NOT (v_room_code = ANY(v_affected_codes)) THEN
        v_affected_codes := array_append(v_affected_codes, v_room_code);
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'marked_disconnected',        v_marked,
    'replaced_with_bot',          v_replaced,
    'rooms_closed',               v_closed,
    'rooms_with_bot_replacements', to_jsonb(v_affected_codes),
    'processed_at',               NOW()
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('error', SQLERRM, 'processed_at', NOW());
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. reconnect_player  (explicit rejoin – clears the persistent timer)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reconnect_player(p_room_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_rec          RECORD;
  v_room_status  TEXT;
  v_was_bot      BOOLEAN := FALSE;
BEGIN
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

  SELECT * INTO v_rec
  FROM   public.room_players
  WHERE  room_id = p_room_id
    AND  (user_id = p_user_id OR human_user_id = p_user_id)
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'message', 'Player not found in this room'
    );
  END IF;

  v_was_bot := (v_rec.connection_status = 'replaced_by_bot');

  -- Restore the seat AND clear the persistent disconnect timer
  UPDATE public.room_players
  SET
    user_id                    = p_user_id,
    human_user_id              = NULL,
    replaced_username          = NULL,
    is_bot                     = FALSE,
    bot_difficulty             = NULL,
    username                   = COALESCE(v_rec.replaced_username, v_rec.username),
    connection_status          = 'connected',
    last_seen_at               = NOW(),
    disconnected_at            = NULL,
    disconnect_timer_started_at = NULL   -- CLEAR the persistent timer on explicit rejoin
  WHERE id = v_rec.id;

  RETURN jsonb_build_object(
    'success',          TRUE,
    'was_replaced',     v_was_bot,
    'player_index',     v_rec.player_index,
    'username',         COALESCE(v_rec.replaced_username, v_rec.username),
    'message',          CASE WHEN v_was_bot THEN 'Reclaimed seat from bot' ELSE 'Reconnected successfully' END
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', FALSE, 'error', SQLERRM);
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. get_rejoin_status  (uses persistent timer for seconds_left)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_rejoin_status(p_room_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
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
    -- Use the persistent timer (not disconnected_at which resets)
    v_seconds_left := GREATEST(
      0,
      60 - EXTRACT(EPOCH FROM (NOW() - COALESCE(v_rec.disconnect_timer_started_at, v_rec.disconnected_at, NOW())))::INTEGER
    );
    RETURN jsonb_build_object(
      'status',        'disconnected',
      'seconds_left',  v_seconds_left,
      'player_index',  v_rec.player_index
    );
  END IF;

  -- Player is 'connected' but may still have a timer running
  -- (e.g. app reopened, heartbeat resumed, but timer wasn't explicitly cleared)
  IF v_rec.disconnect_timer_started_at IS NOT NULL THEN
    v_seconds_left := GREATEST(
      0,
      60 - EXTRACT(EPOCH FROM (NOW() - v_rec.disconnect_timer_started_at))::INTEGER
    );
    RETURN jsonb_build_object(
      'status',                   'connected',
      'player_index',             v_rec.player_index,
      'disconnect_timer_active',  TRUE,
      'seconds_left',             v_seconds_left
    );
  END IF;

  RETURN jsonb_build_object(
    'status',       'connected',
    'player_index', v_rec.player_index
  );
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. mark_player_disconnected  (sets persistent timer via COALESCE)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_player_disconnected(p_room_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_is_offline BOOLEAN;
BEGIN
  SELECT COALESCE((settings->>'is_offline')::BOOLEAN, FALSE)
  INTO   v_is_offline
  FROM   public.rooms
  WHERE  id = p_room_id;

  IF v_is_offline THEN
    RETURN;
  END IF;

  UPDATE public.room_players
  SET
    connection_status          = 'disconnected',
    disconnected_at            = NOW(),
    -- Only set timer if not already running
    disconnect_timer_started_at = COALESCE(disconnect_timer_started_at, NOW())
  WHERE room_id = p_room_id
    AND user_id = p_user_id
    AND connection_status = 'connected';
END;
$function$;
