-- =========================================================================
-- EMERGENCY FIX: Fix duplicate key constraint error in join_room_atomic
-- Apply this NOW in Supabase Dashboard SQL Editor
-- =========================================================================

-- Fix join_room_atomic to find available player_index positions
-- This fixes the "duplicate key value violates unique constraint room_players_room_id_position_key" error

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
BEGIN
  -- Step 1: Lock and fetch room (blocks other joins)
  SELECT id, status, host_id INTO v_room_id, v_room_status, v_host_id
  FROM rooms
  WHERE code = UPPER(p_room_code)
  FOR UPDATE;  -- Row-level lock until transaction commits
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room not found: %', p_room_code;
  END IF;
  
  -- Step 2: Check room status
  IF v_room_status NOT IN ('waiting', 'playing') THEN
    RAISE EXCEPTION 'Room is not accepting players (status: %)', v_room_status;
  END IF;
  
  -- Step 3: Count current players (within locked transaction)
  SELECT COUNT(*) INTO v_player_count
  FROM room_players
  WHERE room_id = v_room_id;
  
  -- Step 4: Check capacity
  IF v_player_count >= 4 THEN
    RAISE EXCEPTION 'Room is full (4/4 players)';
  END IF;
  
  -- Step 5: Check if user already in this room
  IF EXISTS (
    SELECT 1 FROM room_players
    WHERE room_id = v_room_id AND user_id = p_user_id
  ) THEN
    -- User already in room, return existing data (idempotent)
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
  
  -- Step 6: Check if user is in a DIFFERENT room
  IF EXISTS (
    SELECT 1 FROM room_players
    WHERE user_id = p_user_id AND room_id != v_room_id
  ) THEN
    RAISE EXCEPTION 'User is already in another room';
  END IF;
  
  -- Step 7: Check username uniqueness
  IF EXISTS (
    SELECT 1 FROM room_players
    WHERE room_id = v_room_id AND LOWER(username) = LOWER(p_username)
  ) THEN
    RAISE EXCEPTION 'Username "%" is already taken in this room', p_username;
  END IF;
  
  -- Step 8: Determine player_index and host status
  -- CRITICAL FIX: Find first available position (handles mid-game joins when players leave)
  SELECT COALESCE(
    (
      SELECT s.i
      FROM generate_series(0, 3) AS s(i)
      WHERE NOT EXISTS (
        SELECT 1 FROM room_players
        WHERE room_id = v_room_id AND player_index = s.i
      )
      LIMIT 1
    ),
    v_player_count  -- Fallback to sequential (should never happen if capacity check works)
  ) INTO v_player_index;
  
  v_is_host := (v_host_id IS NULL OR v_player_count = 0);  -- First player or abandoned room
  
  -- Step 9: Insert player
  INSERT INTO room_players (
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
  
  -- Step 10: Update room host if needed
  IF v_is_host THEN
    UPDATE rooms
    SET host_id = p_user_id
    WHERE id = v_room_id;
  END IF;
  
  -- Step 11: Build success response
  v_result := jsonb_build_object(
    'room_id', v_room_id,
    'room_code', p_room_code,
    'player_index', v_player_index,
    'is_host', v_is_host,
    'already_joined', false,
    'player_count', v_player_count + 1
  );
  
  RETURN v_result;
  
EXCEPTION
  WHEN OTHERS THEN
    -- Log failed join attempt (if room exists)
    IF v_room_id IS NOT NULL THEN
      -- Log to room_analytics if function exists
      BEGIN
        PERFORM log_room_event(
          v_room_id,
          'join_failed',
          'race_condition_join',
          jsonb_build_object(
            'username', p_username,
            'error', SQLERRM
          )
        );
      EXCEPTION WHEN undefined_function THEN
        -- log_room_event doesn't exist, skip logging
        NULL;
      END;
    END IF;
    
    RAISE;
END;
$$ LANGUAGE plpgsql;

-- Verify fix
SELECT '✅ join_room_atomic function updated with position-finding logic!' AS status;
