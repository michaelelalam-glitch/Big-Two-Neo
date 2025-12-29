-- ==========================================================================
-- CRITICAL FIX: Add Server-Side Game Rule Validation
-- ==========================================================================
-- Date: December 29, 2025
-- Purpose: Enforce core Big Two rules on the server (authoritative validation)
--
-- CRITICAL ISSUES FIXED:
-- 1. ❌ Players can currently pass when leading (lastPlay is null) - NOT ALLOWED
-- 2. ❌ First play doesn't require 3♦ - MUST include 3♦ in opening play
--
-- These are fundamental rule violations that break core gameplay.
-- Server must be the authoritative source of truth for all game rules.
-- ==========================================================================

-- ==========================================================================
-- FIX #1: Add "Cannot Pass When Leading" validation to execute_pass_move
-- ==========================================================================

DROP FUNCTION IF EXISTS execute_pass_move(TEXT, UUID);

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
  -- 1. Get room ID from code
  SELECT id INTO v_room_id FROM rooms WHERE code = p_room_code;
  
  IF v_room_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Room not found');
  END IF;
  
  -- 2. Get game state WITH ROW LOCK (prevent race conditions)
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
  
  -- 🔥 CRITICAL FIX #1: Cannot pass when leading (no last_play)
  IF v_game_state.last_play IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Cannot pass when leading - you must play cards'
    );
  END IF;
  
  -- 5. Calculate next turn
  v_next_turn := (v_player.player_index + 1) % 4;
  v_new_pass_count := v_game_state.pass_count + 1;
  
  -- 6. Check if 3 consecutive passes (clear last_play, trick winner leads)
  IF v_new_pass_count >= 3 THEN
    UPDATE game_state
    SET
      current_turn = v_next_turn,
      pass_count = 0,
      last_play = NULL,
      auto_pass_timer = NULL,
      updated_at = NOW()
    WHERE room_id = v_room_id;
    
    RETURN json_build_object(
      'success', true,
      'next_turn', v_next_turn,
      'trick_cleared', true
    );
  ELSE
    -- 7. Normal pass - just advance turn
    UPDATE game_state
    SET
      current_turn = v_next_turn,
      pass_count = v_new_pass_count,
      updated_at = NOW()
    WHERE room_id = v_room_id;
    
    RETURN json_build_object(
      'success', true,
      'next_turn', v_next_turn,
      'pass_count', v_new_pass_count
    );
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION execute_pass_move TO authenticated;

COMMENT ON FUNCTION execute_pass_move IS 
  'Execute a pass move with rule validation: prevents passing when leading (last_play is null)';

-- ==========================================================================
-- FIX #2: Add "First Play Must Include 3♦" validation to execute_play_move
-- ==========================================================================

DROP FUNCTION IF EXISTS execute_play_move(TEXT, UUID, JSONB);

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
  v_card_id TEXT;
  v_has_three_diamond BOOLEAN;
  v_is_first_play BOOLEAN;
BEGIN
  -- 1. Get room ID from code
  SELECT id INTO v_room_id FROM rooms WHERE code = p_room_code;
  
  IF v_room_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Room not found');
  END IF;
  
  -- 2. Get game state WITH ROW LOCK (CRITICAL - prevents race conditions)
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
  
  -- 4. Verify it's this player's turn (with row lock held)
  IF v_game_state.current_turn != v_player.player_index THEN
    RETURN json_build_object(
      'success', false, 
      'error', 'Not your turn',
      'current_turn', v_game_state.current_turn,
      'your_index', v_player.player_index
    );
  END IF;
  
  -- 🔥 CRITICAL FIX #2: First play must include 3♦
  -- Determine if this is the first play of the game
  v_is_first_play := (
    v_game_state.played_cards IS NULL OR 
    jsonb_array_length(COALESCE(v_game_state.played_cards, '[]'::jsonb)) = 0
  );
  
  IF v_is_first_play THEN
    -- Check if played cards include 3♦
    v_has_three_diamond := false;
    FOR v_card IN SELECT jsonb_array_elements(p_cards)
    LOOP
      v_card_id := v_card->>'id';
      IF v_card_id = '3D' THEN
        v_has_three_diamond := true;
        EXIT;
      END IF;
    END LOOP;
    
    IF NOT v_has_three_diamond THEN
      RETURN json_build_object(
        'success', false,
        'error', 'First play must include 3♦ (three of diamonds)'
      );
    END IF;
  END IF;
  
  -- 5. Get current hands
  v_current_hands := v_game_state.hands;
  v_player_hand := v_current_hands->v_player.player_index::TEXT;
  
  -- 6. Verify player has all the cards they're trying to play
  FOR v_card IN SELECT jsonb_array_elements(p_cards)
  LOOP
    IF NOT (v_player_hand @> jsonb_build_array(v_card)) THEN
      RETURN json_build_object(
        'success', false,
        'error', 'Card not in hand: ' || (v_card->>'id')
      );
    END IF;
  END LOOP;
  
  -- 7. Remove played cards from hand
  v_new_hand := '[]'::JSONB;
  FOR v_card IN SELECT jsonb_array_elements(v_player_hand)
  LOOP
    IF NOT (p_cards @> jsonb_build_array(v_card)) THEN
      v_new_hand := v_new_hand || jsonb_build_array(v_card);
    END IF;
  END LOOP;
  
  -- 8. Update hands
  v_current_hands := jsonb_set(v_current_hands, ARRAY[v_player.player_index::TEXT], v_new_hand);
  
  -- 9. Calculate next turn (clockwise: 0→1→2→3→0)
  v_next_turn := (v_player.player_index + 1) % 4;
  
  -- 10. Classify combo type (simplified)
  CASE jsonb_array_length(p_cards)
    WHEN 1 THEN v_combo_type := 'Single';
    WHEN 2 THEN v_combo_type := 'Pair';
    WHEN 3 THEN v_combo_type := 'Triple';
    WHEN 5 THEN v_combo_type := 'Five Card';
    ELSE v_combo_type := 'Unknown';
  END CASE;
  
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
    played_cards = COALESCE(played_cards, '[]'::jsonb) || p_cards,
    updated_at = NOW()
  WHERE room_id = v_room_id;
  
  -- 12. Check for match end (player has no cards left)
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
    RETURN json_build_object(
      'success', false,
      'error', 'Game state is locked - another action in progress'
    );
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false,
      'error', SQLERRM
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION execute_play_move TO authenticated;

COMMENT ON FUNCTION execute_play_move IS 
  'Execute a play move with rule validation: first play must include 3♦, verifies cards in hand';

-- ==========================================================================
-- Logging and verification
-- ==========================================================================

DO $$
BEGIN
  RAISE NOTICE '✅ Migration 20251229000001 applied: Critical game rule validation added';
  RAISE NOTICE '   - Fixed: Cannot pass when leading';
  RAISE NOTICE '   - Fixed: First play must include 3♦';
  RAISE NOTICE '   - Server is now authoritative for core game rules';
END $$;
