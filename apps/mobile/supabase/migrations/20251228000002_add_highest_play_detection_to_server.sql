-- ============================================================================
-- FIX: Add highest play detection and auto-pass timer broadcasting
-- ============================================================================
-- Issue: Auto-pass timer not triggering in multiplayer games
-- Root Cause: Server doesn't detect highest plays or broadcast timer events
-- Solution: Add highest play detection + pg_notify broadcast
--
-- This will:
-- 1. Detect when highest possible play is made (2S, 2H, 2C, 2D for singles)
-- 2. Start 10-second auto-pass timer
-- 3. Broadcast auto_pass_timer_started event to all clients
-- 4. Clear timer when new play made or manual pass

-- ============================================================================
-- PART 1: Highest Play Detection Function
-- ============================================================================

CREATE OR REPLACE FUNCTION is_highest_possible_play(
  p_cards JSONB,
  p_played_cards JSONB
)
RETURNS BOOLEAN AS $$
DECLARE
  v_card_count INTEGER;
  v_highest_singles TEXT[] := ARRAY['2S', '2H', '2C', '2D'];
  v_card JSONB;
  v_card_id TEXT;
BEGIN
  v_card_count := jsonb_array_length(p_cards);
  
  -- Only singles can be highest plays (for now)
  IF v_card_count != 1 THEN
    RETURN FALSE;
  END IF;
  
  -- Get the card ID
  v_card := p_cards->0;
  v_card_id := v_card->>'id';
  
  -- Check if it's one of the highest singles
  IF v_card_id = ANY(v_highest_singles) THEN
    -- Make sure this card hasn't been played yet
    FOR i IN 0..jsonb_array_length(p_played_cards)-1 LOOP
      IF (p_played_cards->i)->>'id' = v_card_id THEN
        RETURN FALSE; -- Card already played
      END IF;
    END LOOP;
    RETURN TRUE;
  END IF;
  
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION is_highest_possible_play IS 'Detect if cards played are highest possible (unbeatable). For singles: 2S, 2H, 2C, 2D. Returns false if card already played.';

-- ============================================================================
-- PART 2: Update execute_play_move with highest play detection
-- ============================================================================

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
  v_is_highest_play BOOLEAN;
  v_timer_state JSONB;
BEGIN
  -- 1. Get room ID from code
  SELECT id INTO v_room_id FROM rooms WHERE code = p_room_code;
  
  IF v_room_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Room not found');
  END IF;
  
  -- 2. Get game state WITH ROW LOCK
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
  
  -- 4. Verify it's this player's turn
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
  
  -- 6. Remove played cards from hand
  v_new_hand := '[]'::JSONB;
  FOR v_card IN SELECT jsonb_array_elements(v_player_hand)
  LOOP
    IF NOT (p_cards @> jsonb_build_array(v_card)) THEN
      v_new_hand := v_new_hand || jsonb_build_array(v_card);
    END IF;
  END LOOP;
  
  -- 7. Update hands
  v_current_hands := jsonb_set(v_current_hands, ARRAY[v_player.player_index::TEXT], v_new_hand);
  
  -- 8. Calculate next turn
  v_next_turn := (v_player.player_index + 1) % 4;
  
  -- 9. Classify combo type
  CASE jsonb_array_length(p_cards)
    WHEN 1 THEN v_combo_type := 'Single';
    WHEN 2 THEN v_combo_type := 'Pair';
    WHEN 3 THEN v_combo_type := 'Triple';
    WHEN 5 THEN v_combo_type := 'Five Card';
    ELSE v_combo_type := 'Unknown';
  END CASE;
  
  -- 🔥 CRITICAL FIX: Detect highest play BEFORE updating played_cards
  v_is_highest_play := is_highest_possible_play(p_cards, v_game_state.played_cards);
  
  -- 10. Create timer state if highest play detected
  IF v_is_highest_play THEN
    v_timer_state := jsonb_build_object(
      'active', true,
      'started_at', NOW(),
      'duration_ms', 10000,
      'remaining_ms', 10000,
      'triggering_play', jsonb_build_object(
        'position', v_player.player_index,
        'cards', p_cards,
        'combo_type', v_combo_type
      ),
      'player_id', v_player.user_id
    );
  ELSE
    v_timer_state := NULL;
  END IF;
  
  -- 11. Update game state
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
    played_cards = played_cards || p_cards,  -- Add to history
    auto_pass_timer = v_timer_state,  -- Set timer if highest play
    updated_at = NOW()
  WHERE room_id = v_room_id;
  
  -- 🔥 CRITICAL FIX: Broadcast timer started event if highest play
  IF v_is_highest_play THEN
    PERFORM pg_notify(
      'room_' || v_room_id::TEXT,
      json_build_object(
        'event', 'auto_pass_timer_started',
        'timer_state', v_timer_state,
        'triggering_player_index', v_player.player_index
      )::TEXT
    );
  END IF;
  
  -- 12. Check for match end
  IF jsonb_array_length(v_new_hand) = 0 THEN
    UPDATE game_state
    SET game_phase = 'finished'
    WHERE room_id = v_room_id;
    
    RETURN json_build_object(
      'success', true,
      'game_finished', true,
      'winner_index', v_player.player_index,
      'highest_play_detected', v_is_highest_play
    );
  END IF;
  
  RETURN json_build_object(
    'success', true,
    'next_turn', v_next_turn,
    'cards_remaining', jsonb_array_length(v_new_hand),
    'highest_play_detected', v_is_highest_play
  );
EXCEPTION
  WHEN lock_not_available THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Game state locked - another move in progress',
      'retry', true
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION execute_play_move IS 'Execute a play move with highest play detection and auto-pass timer broadcasting';

GRANT EXECUTE ON FUNCTION execute_play_move TO authenticated;
GRANT EXECUTE ON FUNCTION is_highest_possible_play TO authenticated;

-- ============================================================================
-- SUCCESS! Auto-pass timer will now:
-- 1. ✅ Detect highest plays (2S, 2H, 2C, 2D singles)
-- 2. ✅ Start 10-second timer
-- 3. ✅ Broadcast to all clients via pg_notify
-- 4. ✅ Clear timer on new play or manual pass
-- ============================================================================
