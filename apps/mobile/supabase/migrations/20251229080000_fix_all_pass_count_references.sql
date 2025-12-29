-- ============================================================================
-- COMPREHENSIVE FIX: Replace ALL pass_count references with passes
-- ============================================================================
-- ROOT CAUSE: game_state table uses "passes" but multiple RPC functions use "pass_count"
--
-- AFFECTED FUNCTIONS:
-- - execute_play_move (20251227000002)
-- - execute_pass_move (20251227150000)
-- - add_highest_play_detection_to_server (20251228000002)
-- - fix_execute_play_move_json_encoding (20251227120002)
--
-- Date: December 29, 2025, 8:00 AM
-- Task: Fix ALL pass_count → passes mismatches in RPC functions

-- ==========================================================================
-- FIX execute_play_move
-- ==========================================================================

CREATE OR REPLACE FUNCTION execute_play_move(
  p_room_code TEXT,
  p_player_id UUID,
  p_cards JSONB
)
RETURNS JSON AS $$
DECLARE
  v_room_id UUID;
  v_game_state RECORD;
  v_player RECORD;
  v_player_hand JSONB;
  v_new_hand JSONB;
  v_next_turn INTEGER;
  v_card JSONB;
BEGIN
  -- Get room
  SELECT id INTO v_room_id FROM rooms WHERE code = p_room_code;
  IF v_room_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Room not found');
  END IF;
  
  -- Get game state with row locking
  SELECT * INTO v_game_state FROM game_state WHERE room_id = v_room_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Game state not found');
  END IF;
  
  -- Get player
  SELECT * INTO v_player FROM room_players WHERE id = p_player_id AND room_id = v_room_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Player not found');
  END IF;
  
  -- Verify turn
  IF v_game_state.current_turn != v_player.player_index THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Not your turn',
      'current_turn', v_game_state.current_turn,
      'your_index', v_player.player_index
    );
  END IF;
  
  -- Get player's hand
  v_player_hand := v_game_state.hands->v_player.player_index::TEXT;
  IF v_player_hand IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Hand not found');
  END IF;
  
  -- Remove played cards from hand
  v_new_hand := v_player_hand;
  FOR v_card IN SELECT * FROM jsonb_array_elements(p_cards) LOOP
    v_new_hand := v_new_hand - v_card;
  END LOOP;
  
  -- Calculate next turn
  v_next_turn := (v_player.player_index + 1) % 4;
  
  -- Update game state - CORRECT COLUMN: passes (not pass_count)
  UPDATE game_state
  SET
    hands = jsonb_set(hands, ARRAY[v_player.player_index::TEXT], v_new_hand),
    last_play = p_cards,
    last_player = v_player.player_index,
    current_turn = v_next_turn,
    passes = 0,  -- ✓ CORRECT COLUMN NAME
    passes_in_row = 0,
    play_history = play_history || jsonb_build_object(
      'player', v_player.player_index,
      'cards', p_cards,
      'timestamp', NOW()
    ),
    updated_at = NOW()
  WHERE room_id = v_room_id;
  
  RETURN json_build_object(
    'success', true,
    'next_turn', v_next_turn,
    'remaining_cards', jsonb_array_length(v_new_hand)
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

-- ==========================================================================
-- FIX execute_pass_move
-- ==========================================================================

CREATE OR REPLACE FUNCTION execute_pass_move(
  p_room_code TEXT,
  p_player_id UUID
)
RETURNS JSON AS $$
DECLARE
  v_room_id UUID;
  v_game_state RECORD;
  v_player RECORD;
  v_next_turn INTEGER;
  v_new_pass_count INTEGER;
BEGIN
  -- Get room
  SELECT id INTO v_room_id FROM rooms WHERE code = p_room_code;
  IF v_room_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Room not found');
  END IF;
  
  -- Get game state with row locking
  SELECT * INTO v_game_state FROM game_state WHERE room_id = v_room_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Game state not found');
  END IF;
  
  -- Get player
  SELECT * INTO v_player FROM room_players WHERE id = p_player_id AND room_id = v_room_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Player not found');
  END IF;
  
  -- Verify turn
  IF v_game_state.current_turn != v_player.player_index THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Not your turn',
      'current_turn', v_game_state.current_turn,
      'your_index', v_player.player_index
    );
  END IF;
  
  -- Calculate next turn
  v_next_turn := (v_player.player_index + 1) % 4;
  v_new_pass_count := v_game_state.passes + 1;  -- ✓ CORRECT COLUMN NAME
  
  -- Check if 3 consecutive passes (clear trick)
  IF v_new_pass_count >= 3 THEN
    UPDATE game_state
    SET
      current_turn = v_next_turn,
      passes = 0,  -- ✓ CORRECT COLUMN NAME
      passes_in_row = 0,
      last_play = NULL,
      last_player = NULL,
      updated_at = NOW()
    WHERE room_id = v_room_id;
    
    RETURN json_build_object(
      'success', true,
      'next_turn', v_next_turn,
      'trick_cleared', true
    );
  ELSE
    -- Normal pass - advance turn
    UPDATE game_state
    SET
      current_turn = v_next_turn,
      passes = v_new_pass_count,  -- ✓ CORRECT COLUMN NAME
      passes_in_row = passes_in_row + 1,
      updated_at = NOW()
    WHERE room_id = v_room_id;
    
    RETURN json_build_object(
      'success', true,
      'next_turn', v_next_turn,
      'passes', v_new_pass_count  -- ✓ CORRECT RESPONSE KEY
    );
  END IF;
  
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
GRANT EXECUTE ON FUNCTION execute_play_move(TEXT, UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION execute_pass_move(TEXT, UUID) TO authenticated;

-- Success message
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== ✓ ALL pass_count → passes FIXES APPLIED ===';
  RAISE NOTICE '';
  RAISE NOTICE 'Fixed functions:';
  RAISE NOTICE '  ✓ execute_play_move()';
  RAISE NOTICE '  ✓ execute_pass_move()';
  RAISE NOTICE '';
  RAISE NOTICE 'All functions now use correct column name: passes';
  RAISE NOTICE '';
END $$;
