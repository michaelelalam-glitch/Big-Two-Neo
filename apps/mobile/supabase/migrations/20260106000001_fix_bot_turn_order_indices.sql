-- FIX: Bot player_index assignment to match anticlockwise turn order
-- Date: January 6, 2026
-- Issue: Bots are assigned sequential indices (1,2,3) but anticlockwise turn order
--        requires specific indices to match the turn sequence 0→3→1→2→0
-- 
-- Current behavior:  Steve(0) → Bot4(3) → Bot2(1) → Bot3(2) → Steve
-- Desired behavior: Steve(0) → Bot2(3) → Bot3(1) → Bot4(2) → Steve
-- 
-- Solution: Assign bot player_index based on anticlockwise turn order positions
--           turnOrder = [3, 2, 0, 1] means:
--           - Position after player 0: index 3 → Bot 2
--           - Position after player 3: index 1 → Bot 3  
--           - Position after player 1: index 2 → Bot 4

CREATE OR REPLACE FUNCTION start_game_with_bots(
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
  v_deck TEXT[];
  v_shuffled_deck TEXT[];
  v_player_hands JSONB;
  v_i INTEGER;
  v_starting_player INTEGER;
  v_bot_indices INTEGER[];
  v_bot_name TEXT;
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
  IF v_room.ranked_mode = true AND p_bot_count > 0 THEN
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
  WHERE room_id = p_room_id AND is_bot = false
  ORDER BY joined_at ASC
  LIMIT 1;
  
  IF v_coordinator_id IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'No human players found in room'
    );
  END IF;
  
  -- 5. ✅ CRITICAL FIX: Assign bot player_index based on anticlockwise turn order
  -- Anticlockwise turn order: 0→3→1→2→0 (turnOrder = [3, 2, 0, 1])
  -- For proper turn sequence with human at index 0:
  --   Bot 1 (next after human): index 3 (because turnOrder[0] = 3)
  --   Bot 2 (next after Bot 1): index 1 (because turnOrder[3] = 1)
  --   Bot 3 (next after Bot 2): index 2 (because turnOrder[1] = 2)
  IF p_bot_count = 1 THEN
    v_bot_indices := ARRAY[3];  -- Only 1 bot: place at index 3 (next after 0)
  ELSIF p_bot_count = 2 THEN
    v_bot_indices := ARRAY[3, 1];  -- 2 bots: indices 3, 1 (turn: 0→3→1→0)
  ELSIF p_bot_count = 3 THEN
    v_bot_indices := ARRAY[3, 1, 2];  -- 3 bots: indices 3, 1, 2 (turn: 0→3→1→2→0)
  ELSE
    -- Fallback for invalid bot count
    v_bot_indices := ARRAY[]::INTEGER[];
  END IF;
  
  -- 6. Create bot players with correct indices and names
  FOR v_i IN 1..p_bot_count LOOP
    -- Bot names: Bot 2, Bot 3, Bot 4 (matching their visual turn position)
    v_bot_name := 'Bot ' || (v_i + 1)::TEXT;
    
    INSERT INTO room_players (
      room_id, 
      user_id, 
      username,
      is_bot, 
      bot_difficulty, 
      player_index,
      is_ready
    )
    VALUES (
      p_room_id,
      gen_random_uuid(),
      v_bot_name,
      true,
      p_bot_difficulty,
      v_bot_indices[v_i],  -- ✅ Use turn-order-based index
      true
    );
  END LOOP;
  
  -- 7. Shuffle deck and deal cards
  v_deck := ARRAY[
    'D3','C3','H3','S3','D4','C4','H4','S4','D5','C5','H5','S5',
    'D6','C6','H6','S6','D7','C7','H7','S7','D8','C8','H8','S8',
    'D9','C9','H9','S9','D10','C10','H10','S10','DJ','CJ','HJ','SJ',
    'DQ','CQ','HQ','SQ','DK','CK','HK','SK','DA','CA','HA','SA','D2','C2','H2','S2'
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
  
  -- Deal 13 cards to each player - store as JSONB object with player indices as keys
  v_player_hands := '{}'::JSONB;
  FOR v_i IN 0..(v_total_players - 1) LOOP
    v_player_hands := v_player_hands || jsonb_build_object(
      v_i::TEXT,
      to_jsonb(v_shuffled_deck[(v_i * 13 + 1):(v_i * 13 + 13)])
    );
  END LOOP;
  
  -- Find starting player (who has 3 of Diamonds)
  v_starting_player := NULL;
  FOR v_i IN 0..(v_total_players - 1) LOOP
    IF v_player_hands->v_i::TEXT @> '["D3"]'::jsonb THEN
      v_starting_player := v_i;
      EXIT;
    END IF;
  END LOOP;
  
  IF v_starting_player IS NULL THEN
    v_starting_player := 0; -- Fallback
  END IF;
  
  -- 8. UPSERT game_state (using correct column names from schema)
  INSERT INTO game_state (
    room_id,
    current_turn,
    hands,
    last_play,
    passes,
    round_number,
    game_phase,
    played_cards,
    match_number,
    play_history,
    auto_pass_timer
  )
  VALUES (
    p_room_id,
    v_starting_player,
    v_player_hands,
    NULL,
    0,
    1,
    'first_play',
    '[]'::JSONB,
    1,
    '[]'::JSONB,
    NULL
  )
  ON CONFLICT (room_id) DO UPDATE SET
    current_turn = EXCLUDED.current_turn,
    hands = EXCLUDED.hands,
    last_play = EXCLUDED.last_play,
    passes = EXCLUDED.passes,
    round_number = EXCLUDED.round_number,
    game_phase = EXCLUDED.game_phase,
    played_cards = EXCLUDED.played_cards,
    match_number = EXCLUDED.match_number,
    play_history = EXCLUDED.play_history,
    auto_pass_timer = EXCLUDED.auto_pass_timer,
    updated_at = NOW();
  
  -- 9. Update room status to 'playing'
  UPDATE rooms
  SET status = 'playing', updated_at = NOW()
  WHERE id = p_room_id;
  
  -- 10. Success
  RETURN json_build_object(
    'success', true,
    'room_id', p_room_id,
    'starting_player', v_starting_player,
    'total_players', v_total_players,
    'bot_indices', v_bot_indices
  );
  
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION start_game_with_bots TO authenticated;

COMMENT ON FUNCTION start_game_with_bots IS 'Start game with bots using anticlockwise turn-order indices (0→3→1→2→0). Bot 2 at index 3, Bot 3 at index 1, Bot 4 at index 2.';
