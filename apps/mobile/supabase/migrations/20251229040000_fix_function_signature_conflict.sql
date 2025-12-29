-- ============================================================================
-- CRITICAL FIX: Function signature ambiguity
-- ============================================================================
-- ROOT CAUSE: Multiple overloads of start_game_with_bots() exist with different
-- parameter types (text vs character varying), causing PostgreSQL to fail when
-- calling the function: "Could not choose the best candidate function"
--
-- SOLUTION: Drop ALL overloads and create a single canonical version with TEXT
-- type for p_bot_difficulty parameter
--
-- Date: December 29, 2025
-- Task: Critical bug fix for function signature conflict

-- Drop ALL possible overloads of the function
DROP FUNCTION IF EXISTS start_game_with_bots(UUID, INTEGER, VARCHAR) CASCADE;
DROP FUNCTION IF EXISTS start_game_with_bots(UUID, INTEGER, TEXT) CASCADE;
DROP FUNCTION IF EXISTS start_game_with_bots(UUID, INTEGER) CASCADE;

-- Create the canonical version with TEXT type (PostgreSQL standard)
CREATE FUNCTION start_game_with_bots(
  p_room_id UUID,
  p_bot_count INTEGER,
  p_bot_difficulty TEXT DEFAULT 'medium'
)
RETURNS JSON AS $$
DECLARE
  v_room RECORD;
  v_human_count INTEGER;
  v_total_players INTEGER;
  v_coordinator_id UUID;
  v_next_player_index INTEGER;
  v_deck TEXT[];
  v_shuffled_deck TEXT[];
  v_player_hands JSONB[];
  v_i INTEGER;
  v_starting_player INTEGER;
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
  IF v_room.mode = 'ranked' AND p_bot_count > 0 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Cannot add bots to ranked games'
    );
  END IF;
  
  -- 3. Calculate player counts
  SELECT COUNT(*) INTO v_human_count 
  FROM room_players 
  WHERE room_id = p_room_id;
  
  v_total_players := v_human_count + p_bot_count;
  
  IF v_total_players > 4 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Total players would exceed 4',
      'human_count', v_human_count,
      'bot_count', p_bot_count
    );
  END IF;
  
  IF v_total_players < 2 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Need at least 2 players to start',
      'current_total', v_total_players
    );
  END IF;
  
  -- 4. Get coordinator (first human player)
  SELECT user_id INTO v_coordinator_id
  FROM room_players
  WHERE room_id = p_room_id
  ORDER BY joined_at ASC
  LIMIT 1;
  
  IF v_coordinator_id IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'No human players found in room'
    );
  END IF;
  
  -- 5. Create bot players if needed
  v_next_player_index := v_human_count;
  FOR v_i IN 1..p_bot_count LOOP
    INSERT INTO room_players (room_id, user_id, is_bot, bot_difficulty, player_index)
    VALUES (
      p_room_id,
      gen_random_uuid(), -- Bot gets random UUID
      true,
      p_bot_difficulty,
      v_next_player_index
    );
    v_next_player_index := v_next_player_index + 1;
  END LOOP;
  
  -- 6. Shuffle deck and deal cards
  v_deck := ARRAY[
    'C3','D3','H3','S3','C4','D4','H4','S4','C5','D5','H5','S5',
    'C6','D6','H6','S6','C7','D7','H7','S7','C8','D8','H8','S8',
    'C9','D9','H9','S9','C10','D10','H10','S10','CJ','DJ','HJ','SJ',
    'CQ','DQ','HQ','SQ','CK','DK','HK','SK','CA','DA','HA','SA','C2','D2','H2','S2'
  ];
  
  -- Fisher-Yates shuffle
  FOR v_i IN REVERSE array_length(v_deck, 1)..2 LOOP
    DECLARE
      v_j INTEGER := floor(random() * v_i + 1)::INTEGER;
      v_temp TEXT := v_deck[v_i];
    BEGIN
      v_deck[v_i] := v_deck[v_j];
      v_deck[v_j] := v_temp;
    END;
  END LOOP;
  v_shuffled_deck := v_deck;
  
  -- Deal 13 cards to each player
  v_player_hands := ARRAY[]::JSONB[];
  FOR v_i IN 0..(v_total_players - 1) LOOP
    v_player_hands := array_append(
      v_player_hands,
      to_jsonb(v_shuffled_deck[(v_i * 13 + 1):(v_i * 13 + 13)])
    );
  END LOOP;
  
  -- Find starting player (who has 3 of Diamonds)
  v_starting_player := NULL;
  FOR v_i IN 1..v_total_players LOOP
    IF v_player_hands[v_i] ? 'D3' THEN
      v_starting_player := v_i - 1; -- Convert to 0-indexed
      EXIT;
    END IF;
  END LOOP;
  
  IF v_starting_player IS NULL THEN
    v_starting_player := 0; -- Fallback
  END IF;
  
  -- 7. **CRITICAL FIX**: Use UPSERT instead of INSERT to handle game restarts
  INSERT INTO game_state (
    room_id,
    current_player_index,
    last_played_hand,
    pass_count,
    round_number,
    player_hands
  )
  VALUES (
    p_room_id,
    v_starting_player,
    NULL,
    0,
    1,
    v_player_hands
  )
  ON CONFLICT (room_id) DO UPDATE SET
    current_player_index = EXCLUDED.current_player_index,
    last_played_hand = EXCLUDED.last_played_hand,
    pass_count = EXCLUDED.pass_count,
    round_number = EXCLUDED.round_number,
    player_hands = EXCLUDED.player_hands,
    updated_at = NOW();
  
  -- 8. Update room status
  UPDATE rooms 
  SET status = 'playing',
      updated_at = NOW()
  WHERE id = p_room_id;
  
  -- Return success
  RETURN json_build_object(
    'success', true,
    'room_id', p_room_id,
    'total_players', v_total_players,
    'human_count', v_human_count,
    'bot_count', p_bot_count,
    'starting_player', v_starting_player,
    'coordinator_id', v_coordinator_id
  );
  
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false,
      'error', SQLERRM,
      'detail', SQLSTATE
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions
GRANT EXECUTE ON FUNCTION start_game_with_bots(UUID, INTEGER, TEXT) TO authenticated;

-- Add documentation
COMMENT ON FUNCTION start_game_with_bots(UUID, INTEGER, TEXT) IS 
  'Fixed version that handles both new games and restarts in same room using UPSERT. Uses TEXT type for bot_difficulty to avoid signature ambiguity.';
