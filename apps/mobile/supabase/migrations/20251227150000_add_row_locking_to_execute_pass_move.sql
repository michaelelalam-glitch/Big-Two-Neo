-- Migration: Add row-level locking to execute_pass_move
-- Date: 2025-12-27 15:00:00
-- Purpose: Fix race condition in pass moves - same issue as execute_play_move had
--
-- PROBLEM: Bot tried to pass at 7:22:34 pm, got "Not your turn" error
-- ROOT CAUSE: execute_pass_move SELECT statement missing FOR UPDATE NOWAIT lock
-- SOLUTION: Add identical row-level locking pattern from execute_play_move fix
--
-- Evidence from console log line 4601:
-- 7:22:34 pm | GAME | ERROR : [BotCoordinator] Error executing bot turn: Not your turn
--
-- Play moves work perfectly (3 bots played successfully), but pass moves fail

-- Drop existing function
DROP FUNCTION IF EXISTS execute_pass_move(TEXT, UUID);

-- Recreate with row-level locking
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
  v_lock_conflict BOOLEAN := false;
BEGIN
  -- 1. Get room ID from code
  SELECT id INTO v_room_id FROM rooms WHERE code = p_room_code;
  
  IF v_room_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Room not found');
  END IF;
  
  -- 2. Get game state WITH ROW-LEVEL LOCK (FIX: Added FOR UPDATE NOWAIT)
  BEGIN
    SELECT * INTO v_game_state 
    FROM game_state 
    WHERE room_id = v_room_id
    FOR UPDATE NOWAIT;
  EXCEPTION
    WHEN lock_not_available THEN
      v_lock_conflict := true;
  END;
  
  -- Return retry flag if lock conflict occurred
  IF v_lock_conflict THEN
    RETURN json_build_object(
      'success', false, 
      'error', 'State locked - retry',
      'should_retry', true
    );
  END IF;
  
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
  
  -- 5. Calculate next turn
  v_next_turn := (v_player.player_index + 1) % 4;
  v_new_pass_count := v_game_state.pass_count + 1;
  
  -- 6. Check if 3 consecutive passes (clear last_play, person who played last_play wins trick)
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
      auto_pass_timer = NULL,
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

-- Ensure permissions are granted
GRANT EXECUTE ON FUNCTION execute_pass_move TO authenticated;

-- Success message
DO $$
BEGIN
  RAISE NOTICE 'Migration 20251227150000 applied: Added row-level locking to execute_pass_move';
  RAISE NOTICE 'This fixes the "Not your turn" error when bots try to pass';
END $$;
