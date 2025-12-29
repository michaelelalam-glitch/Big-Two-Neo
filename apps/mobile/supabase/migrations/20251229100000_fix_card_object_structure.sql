-- ==========================================================================
-- FIX: Card Object Structure - Generate proper card objects
-- ==========================================================================
-- CRITICAL: Cards must be objects {id, rank, suit}, not strings "C3"
-- 
-- Previous implementation stored: ["C3", "D4", "H5"]
-- Required format: [{"id":"C3","rank":"3","suit":"C"}, ...]
-- 
-- This fixes the "INVALID CARD OBJECT" error in Card.tsx
-- ==========================================================================

-- Helper function to convert card string to proper object
CREATE OR REPLACE FUNCTION card_string_to_object(card_code TEXT)
RETURNS JSONB AS $$
DECLARE
  v_suit CHAR(1);
  v_rank TEXT;
BEGIN
  -- Extract suit (first character)
  v_suit := substring(card_code from 1 for 1);
  
  -- Extract rank (remaining characters)
  v_rank := substring(card_code from 2);
  
  -- Build proper card object with SINGLE-LETTER SUIT (matches Edge Function)
  RETURN jsonb_build_object(
    'id', card_code,
    'rank', v_rank,
    'suit', v_suit  -- Returns 'D' not 'DIAMONDS'
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Grant permissions
GRANT EXECUTE ON FUNCTION card_string_to_object(TEXT) TO authenticated;

-- ==========================================================================
-- Rewrite start_game_with_bots() to generate proper card objects
-- ==========================================================================

DROP FUNCTION IF EXISTS start_game_with_bots(UUID, INTEGER, TEXT);

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
  v_next_player_index INTEGER;
  v_deck TEXT[];
  v_shuffled_deck TEXT[];
  v_player_hands JSONB;
  v_i INTEGER;
  v_starting_player INTEGER;
  v_card_string TEXT;
  v_player_hand JSONB;
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
      gen_random_uuid(),
      true,
      p_bot_difficulty,
      v_next_player_index
    );
    v_next_player_index := v_next_player_index + 1;
  END LOOP;
  
  -- 6. Shuffle deck
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
  
  -- 7. Deal 13 cards to each player - CONVERT TO PROPER CARD OBJECTS
  v_player_hands := '{}'::JSONB;
  FOR v_i IN 0..(v_total_players - 1) LOOP
    -- Build array of proper card objects for this player
    v_player_hand := '[]'::JSONB;
    FOR v_card_string IN 
      SELECT unnest(v_shuffled_deck[(v_i * 13 + 1):(v_i * 13 + 13)])
    LOOP
      v_player_hand := v_player_hand || jsonb_build_array(
        card_string_to_object(v_card_string)
      );
    END LOOP;
    
    -- Add this player's hand to the hands object
    v_player_hands := v_player_hands || jsonb_build_object(
      v_i::TEXT,
      v_player_hand
    );
  END LOOP;
  
  -- 8. Find starting player (who has 3 of Diamonds)
  v_starting_player := NULL;
  FOR v_i IN 0..(v_total_players - 1) LOOP
    -- Check if this player's hand contains D3
    IF EXISTS (
      SELECT 1 
      FROM jsonb_array_elements(v_player_hands->v_i::TEXT) AS card
      WHERE card->>'id' = 'D3'
    ) THEN
      v_starting_player := v_i;
      EXIT;
    END IF;
  END LOOP;
  
  IF v_starting_player IS NULL THEN
    v_starting_player := 0; -- Fallback
  END IF;
  
  -- 9. UPSERT game_state
  INSERT INTO game_state (
    room_id,
    current_player,
    current_turn,
    hands,
    last_play,
    passes,
    passes_in_row,
    round_number,
    dealer_index,
    game_phase
  )
  VALUES (
    p_room_id,
    v_starting_player,
    v_starting_player,
    v_player_hands,
    NULL,
    0,
    0,
    1,
    0,
    'first_play'
  )
  ON CONFLICT (room_id) DO UPDATE SET
    current_player = EXCLUDED.current_player,
    current_turn = EXCLUDED.current_turn,
    hands = EXCLUDED.hands,
    last_play = EXCLUDED.last_play,
    passes = EXCLUDED.passes,
    passes_in_row = EXCLUDED.passes_in_row,
    round_number = EXCLUDED.round_number,
    dealer_index = EXCLUDED.dealer_index,
    game_phase = EXCLUDED.game_phase,
    game_started_at = NOW(),
    updated_at = NOW();
  
  -- 10. Update room status
  UPDATE rooms 
  SET status = 'playing',
      started_at = NOW(),
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
    'coordinator_id', v_coordinator_id,
    'game_phase', 'first_play'
  );
  
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false,
      'error', SQLERRM,
      'detail', SQLSTATE,
      'hint', 'Check game_state table schema and card object structure'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions
GRANT EXECUTE ON FUNCTION start_game_with_bots(UUID, INTEGER, TEXT) TO authenticated;

-- Add documentation
COMMENT ON FUNCTION start_game_with_bots(UUID, INTEGER, TEXT) IS 
  'Creates proper card objects with {id, rank, suit} structure. Fixes INVALID CARD OBJECT error in mobile app. Uses card_string_to_object() helper to convert TEXT[] deck to JSONB card objects.';

-- ==========================================================================
-- SUCCESS MESSAGE
-- ==========================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== ✓ CARD OBJECT STRUCTURE FIX COMPLETE ===';
  RAISE NOTICE '';
  RAISE NOTICE 'Fixed:';
  RAISE NOTICE '  ✓ Cards now stored as proper objects: {id, rank, suit}';
  RAISE NOTICE '  ✓ Created card_string_to_object() helper function';
  RAISE NOTICE '  ✓ Updated start_game_with_bots() to generate card objects';
  RAISE NOTICE '  ✓ Starting player detection updated for object format';
  RAISE NOTICE '';
  RAISE NOTICE 'Mobile app will now render cards correctly!';
  RAISE NOTICE 'Error "INVALID CARD OBJECT" should be resolved.';
  RAISE NOTICE '';
END $$;
