-- Fix: room_abandonment_check trigger crashes on room statuses outside
-- ('waiting','playing','finished') — e.g. 'starting', 'active' — because
-- log_room_event() passes v_room.status directly as status_reached which
-- violates the room_analytics_status_reached_check constraint, rolling back
-- the whole DELETE and leaving the user stuck in a "zombie" room slot.
--
-- Two-part fix:
--   1. check_room_abandonment() — wrap PERFORM log_room_event in BEGIN/EXCEPTION
--      so analytics failures NEVER propagate and block room cleanup DELETEs.
--   2. log_room_event() — map all non-('waiting','playing','finished') room
--      statuses to a safe value so INSERT always satisfies the constraint.

-- ── 1. Fix log_room_event: map unknown statuses to valid constraint values ──
CREATE OR REPLACE FUNCTION log_room_event(
  p_room_id UUID,
  p_event_type TEXT,
  p_error_type TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_room RECORD;
  v_players RECORD;
  v_analytics_id UUID;
  v_time_in_waiting INTEGER;
  v_time_in_playing INTEGER;
  v_is_dirty BOOLEAN;
  v_status_reached TEXT;
BEGIN
  -- Get room details
  SELECT * INTO v_room FROM rooms WHERE id = p_room_id;

  IF NOT FOUND THEN
    RAISE WARNING 'Room % not found for event logging', p_room_id;
    RETURN NULL;
  END IF;

  -- Count players
  SELECT
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE is_bot = FALSE) AS humans,
    COUNT(*) FILTER (WHERE is_bot = TRUE) AS bots
  INTO v_players
  FROM room_players
  WHERE room_id = p_room_id;

  -- Calculate time spent in each phase
  v_time_in_waiting := EXTRACT(EPOCH FROM (
    COALESCE(v_room.started_at, NOW()) - v_room.created_at
  ))::INTEGER;

  v_time_in_playing := CASE
    WHEN v_room.started_at IS NOT NULL THEN
      EXTRACT(EPOCH FROM (NOW() - v_room.started_at))::INTEGER
    ELSE 0
  END;

  -- Determine if room is dirty
  v_is_dirty := (p_error_type IS NOT NULL);

  -- Map room status to the allowed set for room_analytics.status_reached.
  -- 'starting' and 'active' are in-flight statuses → treat as 'playing'.
  -- Any other unknown status is treated as 'waiting' (safe default).
  v_status_reached := CASE
    WHEN v_room.status IN ('waiting', 'playing', 'finished') THEN v_room.status
    WHEN v_room.status IN ('starting', 'active')             THEN 'playing'
    ELSE                                                          'waiting'
  END;

  -- Insert analytics record
  INSERT INTO room_analytics (
    room_id,
    room_code,
    status_reached,
    error_type,
    is_dirty,
    player_count_at_event,
    human_player_count,
    bot_player_count,
    time_in_waiting_seconds,
    time_in_playing_seconds,
    created_at,
    event_at,
    metadata
  ) VALUES (
    p_room_id,
    v_room.code,
    v_status_reached,
    p_error_type,
    v_is_dirty,
    v_players.total,
    v_players.humans,
    v_players.bots,
    v_time_in_waiting,
    v_time_in_playing,
    v_room.created_at,
    NOW(),
    p_metadata
  ) RETURNING id INTO v_analytics_id;

  RETURN v_analytics_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION log_room_event IS
  'Logs room lifecycle events to room_analytics. Unknown room statuses are mapped '
  'to the nearest valid status_reached value so the constraint is never violated.';

-- ── 2. Fix check_room_abandonment: swallow analytics errors so they never ──
--        roll back a player DELETE / zombie cleanup.
CREATE OR REPLACE FUNCTION check_room_abandonment()
RETURNS TRIGGER AS $$
DECLARE
  v_remaining_players INTEGER;
  v_room_status TEXT;
BEGIN
  -- Count remaining players after this row was deleted
  SELECT COUNT(*) INTO v_remaining_players
  FROM room_players
  WHERE room_id = OLD.room_id;

  -- Get current room status
  SELECT status INTO v_room_status
  FROM rooms
  WHERE id = OLD.room_id;

  -- Log abandonment only when last player leaves an unfinished room
  IF v_remaining_players = 0 AND v_room_status IS NOT NULL AND v_room_status != 'finished' THEN
    BEGIN
      PERFORM log_room_event(
        OLD.room_id,
        'room_abandoned',
        CASE v_room_status
          WHEN 'waiting' THEN 'all_players_left_waiting'
          WHEN 'playing' THEN 'all_players_left_playing'
          ELSE                'all_players_left_waiting'   -- safe fallback
        END,
        jsonb_build_object(
          'last_player_username', OLD.username,
          'last_player_was_host', OLD.is_host
        )
      );
    EXCEPTION WHEN OTHERS THEN
      -- Analytics failure must NEVER block a room cleanup DELETE.
      -- Log a warning but let the DELETE proceed.
      RAISE WARNING 'room_abandonment_check: analytics logging failed (room=%): %',
        OLD.room_id, SQLERRM;
    END;
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION check_room_abandonment IS
  'AFTER DELETE trigger on room_players. Logs analytics when the last player '
  'leaves an unfinished room. Analytics errors are caught and warned so they '
  'never roll back a legitimate room-player DELETE or zombie cleanup.';
