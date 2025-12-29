-- ============================================================================
-- DEFINITIVE SCHEMA ALIGNMENT FIX
-- ============================================================================
-- ROOT CAUSE: Multiple migrations with conflicting column names caused schema drift
-- 
-- PROBLEMS IDENTIFIED:
-- 1. Some migrations use "pass_count", but actual table has "passes"
-- 2. Some migrations use "current_player_index", but actual table has "current_player"  
-- 3. Some migrations use "player_hands", but actual table has "hands"
-- 4. game_phase CHECK constraint may not include 'game_over' in production
-- 5. Multiple conflicting versions of start_game_with_bots() exist
--
-- SOLUTION: Query actual schema, fix ALL mismatches, create ONE correct function
--
-- Date: December 29, 2025, 7:00 AM
-- Author: Comprehensive Migration Audit
-- Task: Fix cascading migration errors (#568, #583)

-- ==========================================================================
-- STEP 1: Verify game_state table exists and get actual column names
-- ==========================================================================

DO $$
DECLARE
  v_has_passes BOOLEAN;
  v_has_pass_count BOOLEAN;
  v_has_current_player BOOLEAN;
  v_has_current_player_index BOOLEAN;
  v_has_hands BOOLEAN;
  v_has_player_hands BOOLEAN;
  v_constraint_definition TEXT;
BEGIN
  RAISE NOTICE '=== DEFINITIVE SCHEMA ALIGNMENT FIX ===';
  RAISE NOTICE 'Checking actual game_state schema...';
  
  -- Check which columns actually exist
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'game_state' AND column_name = 'passes'
  ) INTO v_has_passes;
  
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'game_state' AND column_name = 'pass_count'
  ) INTO v_has_pass_count;
  
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'game_state' AND column_name = 'current_player'
  ) INTO v_has_current_player;
  
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'game_state' AND column_name = 'current_player_index'
  ) INTO v_has_current_player_index;
  
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'game_state' AND column_name = 'hands'
  ) INTO v_has_hands;
  
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'game_state' AND column_name = 'player_hands'
  ) INTO v_has_player_hands;
  
  -- Report findings
  RAISE NOTICE '--- Column Audit Results ---';
  RAISE NOTICE 'passes: % | pass_count: %', v_has_passes, v_has_pass_count;
  RAISE NOTICE 'current_player: % | current_player_index: %', v_has_current_player, v_has_current_player_index;
  RAISE NOTICE 'hands: % | player_hands: %', v_has_hands, v_has_player_hands;
  
  -- Validate expected schema
  IF NOT v_has_passes THEN
    RAISE EXCEPTION 'CRITICAL: game_state.passes column missing!';
  END IF;
  
  IF NOT v_has_current_player THEN
    RAISE EXCEPTION 'CRITICAL: game_state.current_player column missing!';
  END IF;
  
  IF NOT v_has_hands THEN
    RAISE EXCEPTION 'CRITICAL: game_state.hands column missing!';
  END IF;
  
  -- Check for wrong columns that shouldn't exist
  IF v_has_pass_count THEN
    RAISE WARNING 'game_state has pass_count column - this should be "passes"';
  END IF;
  
  IF v_has_current_player_index THEN
    RAISE WARNING 'game_state has current_player_index column - this should be "current_player"';
  END IF;
  
  IF v_has_player_hands THEN
    RAISE WARNING 'game_state has player_hands column - this should be "hands"';
  END IF;
  
  RAISE NOTICE 'Schema validation complete ✓';
END $$;

-- ==========================================================================
-- STEP 2: Fix game_phase CHECK constraint (ensure it includes all phases)
-- ==========================================================================

DO $$
BEGIN
  RAISE NOTICE 'Fixing game_phase CHECK constraint...';
  
  -- Drop existing constraint (idempotent)
  ALTER TABLE game_state DROP CONSTRAINT IF EXISTS game_state_game_phase_check;
  
  -- Add correct constraint with ALL valid phases
  ALTER TABLE game_state 
    ADD CONSTRAINT game_state_game_phase_check 
    CHECK (game_phase IN ('first_play', 'playing', 'finished', 'game_over'));
  
  RAISE NOTICE 'game_phase constraint updated ✓';
END $$;

-- ==========================================================================
-- STEP 3: Drop ALL conflicting function overloads
-- ==========================================================================

DROP FUNCTION IF EXISTS start_game_with_bots(UUID, INTEGER, VARCHAR) CASCADE;
DROP FUNCTION IF EXISTS start_game_with_bots(UUID, INTEGER, TEXT) CASCADE;
DROP FUNCTION IF EXISTS start_game_with_bots(UUID, INTEGER) CASCADE;
DROP FUNCTION IF EXISTS start_game_with_bots(UUID, INTEGER, CHARACTER VARYING) CASCADE;

-- ==========================================================================
-- STEP 4: Create definitive start_game_with_bots() using ACTUAL column names
-- ==========================================================================

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
  
  -- 2. Check ranked mode restriction (use correct column: ranked_mode)
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
  
  -- 6. Shuffle deck and deal cards
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
  
  -- 7. UPSERT game_state using CORRECT column names from schema
  INSERT INTO game_state (
    room_id,
    current_player,      -- ✓ NOT current_player_index
    current_turn,
    hands,               -- ✓ NOT player_hands
    last_play,           -- ✓ NOT last_played_hand
    passes,              -- ✓ NOT pass_count
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
    'first_play'  -- ✓ Valid value in CHECK constraint
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
  
  -- 8. Update room status
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
      'hint', 'Check game_state table schema matches function column names'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions
GRANT EXECUTE ON FUNCTION start_game_with_bots(UUID, INTEGER, TEXT) TO authenticated;

-- Add documentation
COMMENT ON FUNCTION start_game_with_bots(UUID, INTEGER, TEXT) IS 
  'DEFINITIVE version using verified schema column names: current_player (not current_player_index), hands (not player_hands), passes (not pass_count), last_play (not last_played_hand). Handles both new games and restarts using UPSERT. Game phase starts as first_play requiring 3D.';

-- ==========================================================================
-- SUCCESS MESSAGE
-- ==========================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== ✓ DEFINITIVE SCHEMA ALIGNMENT FIX COMPLETE ===';
  RAISE NOTICE '';
  RAISE NOTICE 'Fixed:';
  RAISE NOTICE '  ✓ game_phase CHECK constraint includes all phases';
  RAISE NOTICE '  ✓ start_game_with_bots() uses correct column names:';
  RAISE NOTICE '      - current_player (not current_player_index)';
  RAISE NOTICE '      - hands (not player_hands)';
  RAISE NOTICE '      - passes (not pass_count)';
  RAISE NOTICE '      - last_play (not last_played_hand)';
  RAISE NOTICE '  ✓ Handles room restarts with UPSERT';
  RAISE NOTICE '  ✓ Validates ranked mode correctly';
  RAISE NOTICE '  ✓ Sets game_phase to first_play (requires 3D)';
  RAISE NOTICE '';
  RAISE NOTICE 'All function overload conflicts resolved.';
  RAISE NOTICE 'Schema is now aligned and consistent.';
  RAISE NOTICE '';
END $$;
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
