-- ============================================================================
-- CRITICAL BUG FIXES - December 26, 2025
-- ============================================================================
-- Fixes:
-- 1. Ranked matchmaking navigation issue
-- 2. Casual lobby showing auto-created bots
-- 3. Private room crash when starting with bots

-- ============================================================================
-- FIX 1 & 3: Update start_game_with_bots to properly initialize game state
-- ============================================================================
CREATE OR REPLACE FUNCTION start_game_with_bots(
  p_room_id UUID,
  p_bot_count INTEGER,
  p_bot_difficulty VARCHAR DEFAULT 'medium'
)
RETURNS JSON AS $$
DECLARE
  v_room RECORD;
  v_human_count INTEGER;
  v_existing_bots INTEGER;
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
  
  -- 3. Count human players AND existing bots
  SELECT COUNT(*) INTO v_human_count
  FROM room_players
  WHERE room_id = p_room_id AND (is_bot = false OR is_bot IS NULL);
  
  SELECT COUNT(*) INTO v_existing_bots
  FROM room_players
  WHERE room_id = p_room_id AND is_bot = true;
  
  v_total_players := v_human_count + v_existing_bots + p_bot_count;
  
  -- 4. Validate
  IF v_total_players != 4 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Total players must equal 4',
      'human_count', v_human_count,
      'existing_bots', v_existing_bots,
      'requested_bots', p_bot_count,
      'total', v_total_players
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
  
  -- 7. Create NEW bots (only if p_bot_count > 0)
  IF p_bot_count > 0 THEN
    FOR i IN 1..p_bot_count LOOP
      INSERT INTO room_players (
        room_id, user_id, username, player_index, is_bot, bot_difficulty, is_ready, joined_at
      ) VALUES (
        p_room_id, NULL, 'Bot ' || (v_next_player_index + i - 1), v_next_player_index + i - 1, true, p_bot_difficulty, true, NOW()
      );
    END LOOP;
  END IF;
  
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
  
  -- 10. Find who has 3D (starts game)
  v_starting_player := 0;
  FOR v_i IN 0..3 LOOP
    IF v_player_hands[v_i + 1] @> '[{"id": "3D"}]'::jsonb THEN
      v_starting_player := v_i;
      EXIT;
    END IF;
  END LOOP;
  
  -- 11. Delete any existing game state (in case of retry)
  DELETE FROM game_state WHERE room_id = p_room_id;
  
  -- 12. Create game state
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
  
  -- 13. Update room: Set coordinator AND set status to 'playing'
  UPDATE rooms
  SET 
    bot_coordinator_id = v_coordinator_id,
    status = 'playing',
    started_at = NOW(),
    updated_at = NOW()
  WHERE id = p_room_id;
  
  -- 14. Success
  RETURN json_build_object(
    'success', true,
    'room_id', p_room_id,
    'human_count', v_human_count,
    'existing_bots', v_existing_bots,
    'new_bots', p_bot_count,
    'total_players', 4,
    'coordinator_id', v_coordinator_id,
    'status', 'playing',
    'starting_player', v_starting_player
  );
  
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM, 'detail', SQLSTATE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- FIX 2: Clean up any phantom bots in casual rooms
-- ============================================================================
-- Delete all bots from rooms that are still in 'waiting' status
-- (Bots should only exist in 'playing' rooms)
DELETE FROM room_players
WHERE is_bot = true
AND room_id IN (
  SELECT id FROM rooms WHERE status = 'waiting'
);

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================
-- Run these to verify the fixes:

-- Check for any bots in waiting rooms (should be 0)
-- SELECT COUNT(*) as bots_in_waiting_rooms
-- FROM room_players
-- WHERE is_bot = true
-- AND room_id IN (SELECT id FROM rooms WHERE status = 'waiting');

-- Check matchmaking rooms
-- SELECT id, code, status, is_matchmaking, ranked_mode, is_public
-- FROM rooms
-- WHERE is_matchmaking = true
-- ORDER BY created_at DESC
-- LIMIT 10;
