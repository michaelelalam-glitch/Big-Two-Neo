-- ==========================================================================
-- FIX: Make start_game_with_bots safe when bots already exist in room_players
-- ==========================================================================
--
-- Problem:
-- - start_game_with_bots() assumed the room contained only humans.
-- - In casual matchmaking, rooms can already contain bots (or partial bot fills).
-- - The old implementation inserted bots at MAX(player_index)+1, which violates
--   the room_players_player_index_check constraint (expected 0..3).
--
-- Fix:
-- - Compute current occupancy (humans + bots).
-- - Only add bots into open seat indices 0..3.
-- - Accept callers that pass "desired bots by human count" even if bots already
--   exist, but require that p_bot_count is at least the number of open seats.
-- - Ensure game_state is initialized idempotently for waiting rooms.

CREATE OR REPLACE FUNCTION start_game_with_bots(
  p_room_id UUID,
  p_bot_count INTEGER,
  p_bot_difficulty VARCHAR DEFAULT 'medium'
)
RETURNS JSON AS $$
DECLARE
  v_room RECORD;
  v_human_count INTEGER;
  v_existing_bot_count INTEGER;
  v_existing_total_players INTEGER;
  v_bots_to_add INTEGER;
  v_coordinator_id UUID;
  v_open_index INTEGER;
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

  -- 3. Count current occupancy
  SELECT COUNT(*) INTO v_human_count
  FROM room_players
  WHERE room_id = p_room_id AND (is_bot = false OR is_bot IS NULL);

  SELECT COUNT(*) INTO v_existing_bot_count
  FROM room_players
  WHERE room_id = p_room_id AND is_bot = true;

  SELECT COUNT(*) INTO v_existing_total_players
  FROM room_players
  WHERE room_id = p_room_id;

  IF v_human_count = 0 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Cannot start with 0 humans'
    );
  END IF;

  IF v_existing_total_players > 4 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Too many players in room',
      'total_players', v_existing_total_players
    );
  END IF;

  v_bots_to_add := GREATEST(0, 4 - v_existing_total_players);

  -- Callers may pass p_bot_count based on human count (4 - humans) even if bots already exist.
  -- We only require that the caller's requested bot count can cover missing seats.
  IF p_bot_count < v_bots_to_add THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Not enough bots requested to fill open seats',
      'bots_required', v_bots_to_add,
      'bots_requested', p_bot_count
    );
  END IF;

  -- 4. Get coordinator (first human)
  SELECT user_id INTO v_coordinator_id
  FROM room_players
  WHERE room_id = p_room_id AND (is_bot = false OR is_bot IS NULL)
  ORDER BY joined_at ASC
  LIMIT 1;

  -- 5. Create missing bots in open indices 0..3
  FOR v_i IN 1..v_bots_to_add LOOP
    SELECT idx
    INTO v_open_index
    FROM generate_series(0, 3) AS idx
    LEFT JOIN room_players rp
      ON rp.room_id = p_room_id
     AND rp.player_index = idx
    WHERE rp.id IS NULL
    ORDER BY idx
    LIMIT 1;

    IF v_open_index IS NULL THEN
      RETURN json_build_object(
        'success', false,
        'error', 'No open seat index available for bot insertion'
      );
    END IF;

    INSERT INTO room_players (
      room_id, user_id, username, player_index, is_bot, bot_difficulty, is_ready, joined_at
    ) VALUES (
      p_room_id,
      NULL,
      'Bot ' || (v_existing_bot_count + v_i),
      v_open_index,
      true,
      p_bot_difficulty,
      true,
      NOW()
    );
  END LOOP;

  -- 6. Reset any stale game_state for this waiting room (idempotent start)
  DELETE FROM game_state WHERE room_id = p_room_id;

  -- 7. Create deck and shuffle
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

  -- 8. Deal cards to players (13 each) by player_index 0..3
  v_player_hands := ARRAY[
    json_build_array()::jsonb,
    json_build_array()::jsonb,
    json_build_array()::jsonb,
    json_build_array()::jsonb
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

  -- 9. Find who has 3D (starts game)
  v_starting_player := 0;
  FOR v_i IN 0..3 LOOP
    -- Check if player has 3D card using jsonb_path_exists for more robust matching
    IF jsonb_path_exists(v_player_hands[v_i + 1], '$[*] ? (@.id == "3D")') THEN
      v_starting_player := v_i;
      EXIT;
    END IF;
  END LOOP;

  -- 10. Create game state
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
  );

  -- 11. Update room
  UPDATE rooms
  SET
    bot_coordinator_id = v_coordinator_id,
    status = 'playing',
    started_at = NOW()
  WHERE id = p_room_id;

  RETURN json_build_object(
    'success', true,
    'room_id', p_room_id,
    'human_count', v_human_count,
    'existing_bot_count', v_existing_bot_count,
    'bots_added', v_bots_to_add,
    'bots_requested', p_bot_count,
    'coordinator_id', v_coordinator_id,
    'status', 'playing',
    'starting_player', v_starting_player
  );

EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION start_game_with_bots TO authenticated;

COMMENT ON FUNCTION start_game_with_bots IS
  'Starts a multiplayer game with AI bots. Safely fills open seats (0..3), deals cards, and initializes game_state for real-time sync.';
