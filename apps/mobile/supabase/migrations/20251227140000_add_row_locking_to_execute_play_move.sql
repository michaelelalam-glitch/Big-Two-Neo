-- ==========================================================================
-- FIX: Add Row-Level Locking to execute_play_move (CRITICAL BUG FIX)
-- ==========================================================================
-- Problem: Race condition when network requests fail and retry
-- Timeline of bug:
--   1. Bot 1 tries to play → network fails
--   2. Client optimistically advances turn to Bot 2
--   3. Bot 2 reads game_state (no lock) and sees turn=2
--   4. Bot 1 retry succeeds and writes turn=2 to DB
--   5. Bot 2 tries to execute → "Not your turn" error
--
-- Root Cause: Missing FOR UPDATE lock on game_state SELECT
-- Solution: Add SELECT ... FOR UPDATE NOWAIT to prevent concurrent modifications
--
-- This ensures:
--   ✅ Only ONE bot can modify game_state at a time
--   ✅ Concurrent requests fail fast with "could not obtain lock"
--   ✅ No more race conditions from network retries

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
  v_current_hands JSONB;
  v_player_hand JSONB;
  v_new_hand JSONB;
  v_combo_type TEXT;
  v_next_turn INTEGER;
  v_card JSONB;
BEGIN
  -- 1. Get room ID from code
  SELECT id INTO v_room_id FROM rooms WHERE code = p_room_code;
  
  IF v_room_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Room not found');
  END IF;
  
  -- 2. Get game state WITH ROW LOCK (CRITICAL FIX)
  -- FOR UPDATE NOWAIT = Lock the row immediately or fail fast
  -- This prevents race conditions from network retries
  SELECT * INTO v_game_state 
  FROM game_state 
  WHERE room_id = v_room_id
  FOR UPDATE NOWAIT;
  
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Game state not found');
  END IF;
  
  -- 3. Get player info
  SELECT * INTO v_player FROM room_players WHERE id = p_player_id AND room_id = v_room_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Player not found in room');
  END IF;
  
  -- 4. Verify it's this player's turn (now with row lock held)
  IF v_game_state.current_turn != v_player.player_index THEN
    RETURN json_build_object(
      'success', false, 
      'error', 'Not your turn',
      'current_turn', v_game_state.current_turn,
      'your_index', v_player.player_index
    );
  END IF;
  
  -- 5. Get current hands
  v_current_hands := v_game_state.hands;
  v_player_hand := v_current_hands->v_player.player_index::TEXT;
  
  -- 6. Remove played cards from hand (compare full objects)
  v_new_hand := '[]'::JSONB;
  FOR v_card IN SELECT jsonb_array_elements(v_player_hand)
  LOOP
    IF NOT (p_cards @> jsonb_build_array(v_card)) THEN
      v_new_hand := v_new_hand || jsonb_build_array(v_card);
    END IF;
  END LOOP;
  
  -- 7. Update hands
  v_current_hands := jsonb_set(v_current_hands, ARRAY[v_player.player_index::TEXT], v_new_hand);
  
  -- 8. Calculate next turn (clockwise)
  v_next_turn := (v_player.player_index + 1) % 4;
  
  -- 9. Classify combo type
  CASE jsonb_array_length(p_cards)
    WHEN 1 THEN v_combo_type := 'Single';
    WHEN 2 THEN v_combo_type := 'Pair';
    WHEN 3 THEN v_combo_type := 'Triple';
    WHEN 5 THEN v_combo_type := 'Five Card';
    ELSE v_combo_type := 'Unknown';
  END CASE;
  
  -- 10. Update game state (lock is held until commit)
  UPDATE game_state
  SET
    hands = v_current_hands,
    current_turn = v_next_turn,
    last_play = jsonb_build_object(
      'position', v_player.player_index,
      'cards', p_cards,
      'combo_type', v_combo_type
    ),
    pass_count = 0,
    auto_pass_timer = NULL,
    updated_at = NOW()
  WHERE room_id = v_room_id;
  
  -- 11. Check for match end
  IF jsonb_array_length(v_new_hand) = 0 THEN
    UPDATE game_state
    SET game_phase = 'finished'
    WHERE room_id = v_room_id;
    
    RETURN json_build_object(
      'success', true,
      'game_finished', true,
      'winner_index', v_player.player_index
    );
  END IF;
  
  RETURN json_build_object(
    'success', true,
    'next_turn', v_next_turn,
    'cards_remaining', jsonb_array_length(v_new_hand)
  );
EXCEPTION
  WHEN lock_not_available THEN
    -- Another transaction is modifying game state - retry
    RETURN json_build_object(
      'success', false,
      'error', 'Game state locked - another move in progress',
      'retry', true
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION execute_play_move IS 'Execute a play move with row-level locking to prevent race conditions from network retries';
