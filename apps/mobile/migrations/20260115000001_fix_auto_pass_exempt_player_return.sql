/*
 * Migration: Fix Auto-Pass Timer Exempt Player Return
 * Date: January 15, 2026
 * Issue: When auto-pass timer expires and 3 players pass, turn should return to exempt player (who played highest card),
 *        not advance to the 4th player.
 * 
 * Current behavior (BROKEN):
 * - Player 0 plays highest card → auto_pass_timer.player_index = 0
 * - Players 1, 2, 3 auto-pass
 * - After 3 passes, backend clears trick and sets current_turn = next in sequence (player 0's turn again by coincidence in 4-player game)
 * - But this is WRONG for cases where exempt player is not at index 0
 *  
 * Example broken flow:
 * - Player 2 plays highest card → auto_pass_timer.player_index = 2
 * - Players 3, 0, 1 auto-pass (3 passes)
 * - Backend sees passes=3, calculates next_turn from player 1: turnOrder[1] = 2
 * - Turn goes to player 2 (CORRECT by accident)
 * - But if logic were different, could go to player 2+1=3
 *
 * Root cause:
 * - player-pass Edge Function doesn't check if passes came from auto-pass timer
 * - When passes=3, it blindly advances turn using turnOrder array
 * - Should detect auto_pass_timer exists and return to exempted_player_index
 *
 * Fix:
 * - Add stored procedure to calculate correct next turn when 3 passes occur
 * - Check if auto_pass_timer exists and is active
 * - If yes, return turn to exempted_player_index (stored in auto_pass_timer.player_index)
 * - If no, use normal turnOrder logic
 */

-- Drop function if exists (for idempotency)
DROP FUNCTION IF EXISTS get_next_turn_after_three_passes(uuid, integer);

-- Create function to determine next turn after 3 consecutive passes
CREATE OR REPLACE FUNCTION get_next_turn_after_three_passes(
  p_game_state_id uuid,
  p_last_passing_player_index integer
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_auto_pass_timer jsonb;
  v_exempt_player_index integer;
  v_timer_active boolean;
  v_normal_next_turn integer;
BEGIN
  -- Get auto_pass_timer from game_state
  SELECT auto_pass_timer INTO v_auto_pass_timer
  FROM game_state
  WHERE id = p_game_state_id;
  
  -- Check if timer exists and is active
  v_timer_active := (v_auto_pass_timer->>'active')::boolean;
  v_exempt_player_index := (v_auto_pass_timer->>'player_index')::integer;
  
  -- If auto-pass timer is active and has exempt player, return to that player
  IF v_timer_active IS TRUE AND v_exempt_player_index IS NOT NULL THEN
    -- Return turn to the player who played the highest card (exempt from auto-pass)
    RETURN v_exempt_player_index;
  END IF;
  
  -- Otherwise, use normal turn advancement logic: [0→1, 1→2, 2→3, 3→0]
  v_normal_next_turn := CASE p_last_passing_player_index
    WHEN 0 THEN 1
    WHEN 1 THEN 2
    WHEN 2 THEN 3
    WHEN 3 THEN 0
    ELSE 0 -- Default to 0 if invalid index
  END;
  
  RETURN v_normal_next_turn;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_next_turn_after_three_passes(uuid, integer) TO authenticated, anon, service_role;

-- Add comment
COMMENT ON FUNCTION get_next_turn_after_three_passes IS 
'Determines the correct next turn after 3 consecutive passes. If auto-pass timer is active, returns turn to exempt player. Otherwise uses normal turn order.';
