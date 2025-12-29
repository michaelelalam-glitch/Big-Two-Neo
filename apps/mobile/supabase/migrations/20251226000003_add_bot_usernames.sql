-- ============================================================================
-- FIX: Add bot usernames to start_game_with_bots RPC function
-- ============================================================================
-- Issue: Bots are created without usernames, causing NULL values in room_players
-- This breaks lobby UI display and may crash GameScreen
--
-- Fix: Generate unique bot usernames (Bot 1, Bot 2, Bot 3) based on player_index
-- Ensures bots are properly displayed in lobby and game

DROP FUNCTION IF EXISTS start_game_with_bots(UUID, INTEGER, VARCHAR);

CREATE OR REPLACE FUNCTION start_game_with_bots(
  p_room_id UUID,
  p_bot_count INTEGER,
  p_bot_difficulty VARCHAR
)
RETURNS JSON AS $$
DECLARE
  v_room RECORD;
  v_human_count INTEGER;
  v_total_players INTEGER;
  v_coordinator_id UUID;
  v_next_player_index INTEGER;
  v_bot_username VARCHAR;
BEGIN
  -- 1. Get room and validate
  SELECT * INTO v_room FROM rooms WHERE id = p_room_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Room not found',
      'room_id', p_room_id
    );
  END IF;
  
  IF v_room.status != 'waiting' THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Room is not in waiting status',
      'current_status', v_room.status
    );
  END IF;
  
  -- 2. Check ranked mode restriction
  IF v_room.ranked_mode = true THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Cannot start ranked games with bots'
    );
  END IF;
  
  -- 3. Count human players
  SELECT COUNT(*) INTO v_human_count
  FROM room_players
  WHERE room_id = p_room_id AND (is_bot = false OR is_bot IS NULL);
  
  v_total_players := v_human_count + p_bot_count;
  
  -- 4. Validate
  IF v_total_players != 4 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Total players must equal 4',
      'human_count', v_human_count,
      'bot_count', p_bot_count
    );
  END IF;
  
  IF v_human_count = 0 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Cannot start with 0 humans'
    );
  END IF;
  
  -- 5. Get coordinator (first human)
  SELECT user_id INTO v_coordinator_id
  FROM room_players
  WHERE room_id = p_room_id AND (is_bot = false OR is_bot IS NULL)
  ORDER BY joined_at ASC
  LIMIT 1;
  
  -- 6. Find next player index
  SELECT COALESCE(MAX(player_index), -1) + 1 INTO v_next_player_index
  FROM room_players
  WHERE room_id = p_room_id;
  
  -- 7. Create bots with usernames (CRITICAL FIX)
  FOR i IN 1..p_bot_count LOOP
    -- Generate bot username: "Bot 1", "Bot 2", "Bot 3"
    v_bot_username := 'Bot ' || (v_next_player_index + i)::VARCHAR;
    
    INSERT INTO room_players (
      room_id,
      user_id,
      username,           -- NEW: Set username for bots
      player_index,
      is_bot,
      bot_difficulty,
      is_ready,
      joined_at
    ) VALUES (
      p_room_id,
      NULL,
      v_bot_username,     -- NEW: Bot 1, Bot 2, Bot 3
      v_next_player_index + i - 1,
      true,
      p_bot_difficulty,
      true,
      NOW()
    );
  END LOOP;
  
  -- 8. Update room: Set coordinator AND set status to 'playing'
  UPDATE rooms
  SET 
    bot_coordinator_id = v_coordinator_id,
    status = 'playing'
  WHERE id = p_room_id;
  
  -- 9. Success
  RETURN json_build_object(
    'success', true,
    'room_id', p_room_id,
    'human_count', v_human_count,
    'bot_count', p_bot_count,
    'coordinator_id', v_coordinator_id,
    'status', 'playing'
  );
  
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION start_game_with_bots TO authenticated;

COMMENT ON FUNCTION start_game_with_bots IS 'Start multiplayer game with mixed humans + AI bots. Validates player count, creates bot players WITH USERNAMES, sets coordinator, and changes room status to playing to trigger navigation for all players.';
