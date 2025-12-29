-- Fix matchmaking join failures caused by RLS + SELECT ... FOR UPDATE
--
-- Problem:
-- - join_room_atomic used `SELECT ... FOR UPDATE` on `rooms`.
-- - In Postgres, SELECT FOR UPDATE is treated like an UPDATE-locking read and is checked against UPDATE RLS policies.
-- - Our rooms UPDATE policy is host-only, so non-host players could not lock the row, causing "Room not found".
--
-- Solution:
-- - Remove FOR UPDATE and use an advisory transaction lock keyed by room code.
-- - Preserves atomic join semantics without requiring UPDATE privileges on rooms.

CREATE OR REPLACE FUNCTION join_room_atomic(
  p_room_code TEXT,
  p_user_id UUID,
  p_username TEXT
) RETURNS JSONB AS $$
DECLARE
  v_room_id UUID;
  v_player_count INTEGER;
  v_player_index INTEGER;
  v_is_host BOOLEAN;
  v_host_id UUID;
  v_room_status TEXT;
  v_result JSONB;
  v_existing_username TEXT;
  v_other_room UUID;
BEGIN
  -- Serialize joins per-room without requiring UPDATE privileges on rooms
  PERFORM pg_advisory_xact_lock(hashtext('join_room_atomic'), hashtext(UPPER(p_room_code)));

  -- Step 1: Check if user already has a username in the system
  SELECT username INTO v_existing_username
  FROM room_players
  WHERE user_id = p_user_id
  LIMIT 1;

  IF v_existing_username IS NOT NULL AND LOWER(v_existing_username) != LOWER(p_username) THEN
    IF NOT (v_existing_username LIKE 'Player_%') THEN
      RAISE EXCEPTION 'You already have username "%". You cannot change your username.', v_existing_username;
    END IF;
  END IF;

  -- Step 2: Check if username is taken by another user (GLOBAL CHECK)
  IF EXISTS (
    SELECT 1 FROM room_players
    WHERE LOWER(username) = LOWER(p_username)
      AND user_id != p_user_id
  ) THEN
    RAISE EXCEPTION 'Username "%" is already taken by another user', p_username;
  END IF;

  -- Step 3: Fetch room (NO FOR UPDATE; avoids UPDATE RLS policy checks)
  SELECT id, status, host_id INTO v_room_id, v_room_status, v_host_id
  FROM rooms
  WHERE code = UPPER(p_room_code);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room not found: %', p_room_code;
  END IF;

  -- Step 4: Check room status
  IF v_room_status NOT IN ('waiting', 'playing') THEN
    RAISE EXCEPTION 'Room is not accepting players (status: %)', v_room_status;
  END IF;

  -- Step 5: Count current players in THIS room
  SELECT COUNT(*) INTO v_player_count
  FROM room_players
  WHERE room_id = v_room_id;

  -- Step 6: Check capacity
  IF v_player_count >= 4 THEN
    RAISE EXCEPTION 'Room is full (4/4 players)';
  END IF;

  -- Step 7: Check if user already in this room
  IF EXISTS (
    SELECT 1 FROM room_players
    WHERE room_id = v_room_id AND user_id = p_user_id
  ) THEN
    SELECT jsonb_build_object(
      'room_id', v_room_id,
      'room_code', p_room_code,
      'player_index', player_index,
      'is_host', is_host,
      'already_joined', true
    ) INTO v_result
    FROM room_players
    WHERE room_id = v_room_id AND user_id = p_user_id;

    RETURN v_result;
  END IF;

  -- Step 8: Check if user is in a DIFFERENT room (cleanup will handle removals on client leave)
  SELECT room_id INTO v_other_room
  FROM room_players
  WHERE user_id = p_user_id
  LIMIT 1;

  IF v_other_room IS NOT NULL AND v_other_room != v_room_id THEN
    RAISE EXCEPTION 'User already in another room';
  END IF;

  -- Step 9: Find next available player_index (0..3)
  SELECT i INTO v_player_index
  FROM generate_series(0, 3) AS i
  WHERE NOT EXISTS (
    SELECT 1 FROM room_players rp
    WHERE rp.room_id = v_room_id AND rp.player_index = i
  )
  ORDER BY i
  LIMIT 1;

  IF v_player_index IS NULL THEN
    RAISE EXCEPTION 'Room is full (no available positions)';
  END IF;

  -- Step 10: Host assignment
  v_is_host := (v_host_id = p_user_id);

  -- Step 11: Insert player
  INSERT INTO room_players(
    room_id,
    user_id,
    username,
    player_index,
    is_host,
    is_ready,
    is_bot
  ) VALUES (
    v_room_id,
    p_user_id,
    p_username,
    v_player_index,
    v_is_host,
    false,
    false
  );

  RETURN jsonb_build_object(
    'room_id', v_room_id,
    'room_code', p_room_code,
    'player_index', v_player_index,
    'is_host', v_is_host,
    'already_joined', false
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION join_room_atomic IS
  'Atomically join a room by code. Uses advisory transaction locks (not SELECT FOR UPDATE) to avoid RLS UPDATE-policy lock failures.';
