-- Fix execute_pass_move to use anticlockwise turn order
-- BUG: RPC was using (index + 1) % 4 (clockwise) while play-cards Edge Function uses anticlockwise
-- This caused desynchronization when players passed vs played cards

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
  -- Anticlockwise turn order array: 0→3→2→1→0
  -- Turn order mapping by player_index: 0→3, 1→2, 2→0, 3→1.
  -- Position 0 (bottom) → 3 (right)
  -- Position 3 (right) → 1 (top)
  -- Position 1 (top) → 2 (left)
  -- Position 2 (left) → 0 (bottom)
  -- NOTE: PostgreSQL arrays are 1-indexed, so turn_order[player_index + 1] accesses the mapping
  v_turn_order INTEGER[] := ARRAY[3, 2, 0, 1];
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
  
  -- Calculate next turn using anticlockwise array (FIXED)
  -- BEFORE: v_next_turn := (v_player.player_index + 1) % 4; (CLOCKWISE)
  -- AFTER: v_next_turn := v_turn_order[v_player.player_index + 1]; (ANTICLOCKWISE)
  -- Note: PostgreSQL arrays are 1-indexed, so add 1 to player_index
  v_next_turn := v_turn_order[v_player.player_index + 1];
  v_new_pass_count := v_game_state.passes + 1;
  
  -- Check if 3 consecutive passes (clear trick)
  IF v_new_pass_count >= 3 THEN
    UPDATE game_state
    SET
      current_turn = v_next_turn,
      passes = 0,
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
      passes = v_new_pass_count,
      passes_in_row = passes_in_row + 1,
      updated_at = NOW()
    WHERE room_id = v_room_id;
    
    RETURN json_build_object(
      'success', true,
      'next_turn', v_next_turn,
      'passes', v_new_pass_count
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
GRANT EXECUTE ON FUNCTION execute_pass_move(TEXT, UUID) TO authenticated;

-- Success message
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== ✓ execute_pass_move NOW USES ANTICLOCKWISE TURN ORDER ===';
  RAISE NOTICE 'Turn sequence: 0→3→1→2→0 (matches play-cards Edge Function)';
  RAISE NOTICE 'Position mapping: 0=Bottom, 1=Top, 2=Left, 3=Right';
  RAISE NOTICE '';
END $$;
