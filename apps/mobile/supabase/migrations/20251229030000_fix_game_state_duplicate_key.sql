-- ============================================================================
-- CRITICAL FIX: Prevent "duplicate key value violates unique constraint game_state_room_id_key"
-- ============================================================================
-- ROOT CAUSE: start_game_with_bots() tries to INSERT game_state, but if a
-- previous game already exists for the room, it fails with duplicate key error
--
-- SOLUTION: Use UPSERT (INSERT ... ON CONFLICT ... DO UPDATE) to handle both
-- new games and restarting games in the same room
--
-- Date: December 29, 2025
-- Task: Critical bug fix (not in original roadmap)

CREATE OR REPLACE FUNCTION start_game_with_bots(
  p_room_id UUID,
  p_bot_count INTEGER,
  p_bot_difficulty VARCHAR DEFAULT 'medium'
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
  
  -- 7. Create bots (only if they don't exist)
  FOR i IN 1..p_bot_count LOOP
    INSERT INTO room_players (
      room_id, user_id, username, player_index, is_bot, bot_difficulty, is_ready, joined_at
    ) VALUES (
      p_room_id, NULL, 'Bot ' || i, v_next_player_index + i - 1, true, p_bot_difficulty, true, NOW()
    )
    ON CONFLICT (room_id, player_index) DO UPDATE
    SET is_ready = true, bot_difficulty = p_bot_difficulty;
  END LOOP;
  
  -- 8. Create deck and shuffle
  v_deck := ARRAY[
    '3D', '3C', '3H', '3S',
    '4D', '4C', '4H', '4S',
    '5D', '5C', '5H', '5S',
    '6D', '6C', '6H', '6S',
    '7D', '7C', '7H', '7S',
    '8D', '8C', '8H', '8S',
    '9D', '9C', '9H', '9S',
    '10D', '10C', '10H', '10S',
    'JD', 'JC', 'JH', 'JS',
    'QD', 'QC', 'QH', 'QS',
    'KD', 'KC', 'KH', 'KS',
    'AD', 'AC', 'AH', 'AS',
    '2D', '2C', '2H', '2S'
  ];
  
  -- Shuffle deck (Fisher-Yates shuffle)
  v_shuffled_deck := v_deck;
  FOR v_i IN REVERSE 52..2 LOOP
    DECLARE
      v_j INTEGER := 1 + FLOOR(RANDOM() * v_i);
      v_temp TEXT := v_shuffled_deck[v_i];
    BEGIN
      v_shuffled_deck[v_i] := v_shuffled_deck[v_j];
      v_shuffled_deck[v_j] := v_temp;
    END;
  END LOOP;
  
  -- 9. Deal cards to players (13 each)
  v_player_hands := ARRAY[
    json_build_array()::jsonb, -- Player 0
    json_build_array()::jsonb, -- Player 1
    json_build_array()::jsonb, -- Player 2
    json_build_array()::jsonb  -- Player 3
  ];
  
  FOR v_i IN 1..52 LOOP
    DECLARE
      v_player_idx INTEGER := ((v_i - 1) % 4);
      v_card_str TEXT := v_shuffled_deck[v_i];
      v_card_json JSONB := json_build_object(
        'rank', SUBSTRING(v_card_str FROM 1 FOR LENGTH(v_card_str) - 1),
        'suit', SUBSTRING(v_card_str FROM LENGTH(v_card_str) FOR 1),
        'id', v_card_str
      )::jsonb;
    BEGIN
      v_player_hands[v_player_idx + 1] := v_player_hands[v_player_idx + 1] || v_card_json;
    END;
  END LOOP;
  
  -- 10. Find who has 3D (starts game)
  v_starting_player := 0;
  FOR v_i IN 0..3 LOOP
    IF v_player_hands[v_i + 1] @> '[{"id": "3D"}]'::jsonb THEN
      v_starting_player := v_i;
      EXIT;
    END IF;
  END LOOP;
  
  -- 11. UPSERT game state (handles both new games and restarts)
  -- CRITICAL FIX: Use ON CONFLICT DO UPDATE to prevent duplicate key error
  INSERT INTO game_state (
    room_id,
    current_player,
    current_turn,
    hands,
    played_cards,
    scores,
    round,
    passes,
    passes_in_row,
    last_play,
    last_player,
    play_history,
    round_number,
    dealer_index,
    game_started_at,
    auto_pass_active,
    game_phase
  ) VALUES (
    p_room_id,
    v_starting_player,
    v_starting_player,
    json_build_object(
      '0', v_player_hands[1],
      '1', v_player_hands[2],
      '2', v_player_hands[3],
      '3', v_player_hands[4]
    )::jsonb,
    '[]'::jsonb,
    '[0, 0, 0, 0]'::jsonb,
    1,
    0,
    0,
    NULL,
    NULL,
    '[]'::jsonb,
    1,
    0,
    NOW(),
    false,
    'playing'
  )
  ON CONFLICT (room_id) DO UPDATE SET
    current_player = v_starting_player,
    current_turn = v_starting_player,
    hands = json_build_object(
      '0', v_player_hands[1],
      '1', v_player_hands[2],
      '2', v_player_hands[3],
      '3', v_player_hands[4]
    )::jsonb,
    played_cards = '[]'::jsonb,
    scores = '[0, 0, 0, 0]'::jsonb,
    round = 1,
    passes = 0,
    passes_in_row = 0,
    last_play = NULL,
    last_player = NULL,
    play_history = '[]'::jsonb,
    round_number = 1,
    dealer_index = 0,
    game_started_at = NOW(),
    auto_pass_active = false,
    game_phase = 'playing',
    updated_at = NOW();
  
  -- 12. Update room: Set coordinator AND set status to 'playing'
  UPDATE rooms
  SET 
    bot_coordinator_id = v_coordinator_id,
    status = 'playing',
    started_at = NOW()
  WHERE id = p_room_id;
  
  -- 13. Success
  RETURN json_build_object(
    'success', true,
    'room_id', p_room_id,
    'human_count', v_human_count,
    'bot_count', p_bot_count,
    'coordinator_id', v_coordinator_id,
    'status', 'playing',
    'starting_player', v_starting_player,
    'message', 'Game started successfully (handles new/restart)'
  );
  
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

-- Ensure grants are in place
GRANT EXECUTE ON FUNCTION start_game_with_bots TO authenticated;

COMMENT ON FUNCTION start_game_with_bots IS
  'Starts a multiplayer game with AI bots. Uses UPSERT to handle both new games and game restarts, preventing duplicate key constraint violations on room_id.';
