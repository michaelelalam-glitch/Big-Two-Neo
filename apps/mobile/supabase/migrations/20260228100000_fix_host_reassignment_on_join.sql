-- Fix: When all players leave a casual room and a new player joins,
-- they were NOT made host because rooms.host_id still pointed to the
-- original (now-absent) creator. This caused the "Ready Up" button to
-- appear instead of "Start Game" for the only player in the room.
--
-- Fix: After inserting the new player, if no existing player in the room
-- has is_host = true, promote the joining player to host and update
-- rooms.host_id accordingly.

CREATE OR REPLACE FUNCTION join_room_atomic(
  p_room_code TEXT,
  p_user_id UUID,
  p_username TEXT
)
RETURNS JSONB AS $$
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
  v_has_active_host BOOLEAN;
BEGIN
  -- ✅ Validate username is not empty or blank
  IF p_username IS NULL OR length(trim(p_username)) = 0 THEN
    RAISE EXCEPTION 'Username cannot be empty';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('join_room_atomic'), hashtext(UPPER(p_room_code)));

  SELECT username INTO v_existing_username
  FROM room_players
  WHERE user_id = p_user_id
  LIMIT 1;

  IF v_existing_username IS NOT NULL AND LOWER(v_existing_username) != LOWER(p_username) THEN
    IF NOT (v_existing_username LIKE 'Player_%') THEN
      RAISE EXCEPTION 'You already have username "%". You cannot change your username.', v_existing_username;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM room_players
    WHERE LOWER(username) = LOWER(p_username)
      AND user_id != p_user_id
  ) THEN
    RAISE EXCEPTION 'Username "%" is already taken by another user', p_username;
  END IF;

  SELECT id, status, host_id INTO v_room_id, v_room_status, v_host_id
  FROM rooms
  WHERE code = UPPER(p_room_code);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room not found: %', p_room_code;
  END IF;

  IF v_room_status NOT IN ('waiting', 'playing') THEN
    RAISE EXCEPTION 'Room is not accepting players (status: %)', v_room_status;
  END IF;

  SELECT COUNT(*) INTO v_player_count
  FROM room_players
  WHERE room_id = v_room_id;

  IF v_player_count >= 4 THEN
    RAISE EXCEPTION 'Room is full (4/4 players)';
  END IF;

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

  SELECT room_id INTO v_other_room
  FROM room_players
  WHERE user_id = p_user_id
  LIMIT 1;

  IF v_other_room IS NOT NULL AND v_other_room != v_room_id THEN
    RAISE EXCEPTION 'User already in another room';
  END IF;

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

  -- Check if the host_id user is currently in the room
  -- If not (they left), the joining user should become host
  SELECT EXISTS(
    SELECT 1 FROM room_players
    WHERE room_id = v_room_id AND is_host = true
  ) INTO v_has_active_host;

  IF v_has_active_host THEN
    -- Normal case: host is present, use rooms.host_id to determine
    v_is_host := (v_host_id = p_user_id);
  ELSE
    -- No active host in the room — promote joining player
    v_is_host := true;
    -- Update rooms.host_id to reflect the new host
    UPDATE rooms SET host_id = p_user_id WHERE id = v_room_id;
  END IF;

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
  'Thread-safe room join with row-level locking, global username uniqueness, input validation, and automatic host reassignment when previous host is absent.';
