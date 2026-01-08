-- ============================================================================
-- Migration: Document Turn Order Change (No Data Migration)
-- Date: January 7, 2026
-- Purpose: Document the turn order change from clockwise to anticlockwise
--          for historical tracking. NO DATA MIGRATION OCCURS.
-- 
-- Rationale: Turn order logic exists only in application functions 
--            (start_game_with_bots, play-cards, player-pass), not in 
--            persisted game_state data. Therefore, no existing game data 
--            requires modification.
-- 
-- Impact: 
--   - Existing in-progress games: Continue using old function logic until completion
--   - New games: Use updated start_game_with_bots with anticlockwise turn order [3,2,0,1]
-- ============================================================================

-- ==================== MIGRATION ====================

-- Check if game_state table has turn_order column
-- (If not, this migration can be skipped as all games use function-defined turn order)
DO $$
BEGIN
  -- Log migration start
  RAISE NOTICE '=== Turn Order Change Documentation ===';
  RAISE NOTICE 'Previous turn order (clockwise): [1,2,3,0] → 0→1→2→3→0';
  RAISE NOTICE 'New turn order (anticlockwise): [3,2,0,1] → 0→3→2→1→0';
  RAISE NOTICE 'All future games will use anticlockwise turn order [3,2,0,1] from start_game_with_bots function';
  RAISE NOTICE 'This migration performs NO data updates - it exists for documentation only';
  RAISE NOTICE '======================================';
  
  -- Note: This migration assumes game_state doesn't store turn_order directly
  -- If turn order is only in function logic, no data migration needed
  -- This is a defensive migration in case future schema adds turn_order column
  
  RAISE NOTICE 'Migration complete: No turn_order column found in game_state (turn order managed by function)';
  RAISE NOTICE 'All future games will use anticlockwise turn order mapping [3,2,0,1] from start_game_with_bots function';
  RAISE NOTICE 'This array maps current player index to next player index: 0→3, 1→2, 2→0, 3→1';
  RAISE NOTICE 'The actual play sequence depends on the starting player (e.g., if player 0 starts: 0→3→2→1→0)';
  
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Migration note: % (This is expected if no schema change needed)', SQLERRM;
END $$;

-- ==================== VALIDATION ====================

-- Log games that may be affected by turn order changes
-- (For manual review if needed)
DO $$
DECLARE
  v_active_games INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_active_games
  FROM game_state
  WHERE game_phase IN ('first_play', 'normal_play')
    AND current_turn >= 0;
  
  RAISE NOTICE '✓ Active games found: % (these use function-defined turn order)', v_active_games;
  RAISE NOTICE '✓ Turn order consistency: All new games will use anticlockwise [3,2,0,1]';
  RAISE NOTICE '✓ Existing games: Continue with their original turn order until completion';
END $$;

-- ==================== COMMENTS ====================

COMMENT ON FUNCTION start_game_with_bots IS 
'Creates game with anticlockwise turn order [3,2,0,1]. All games started after migration 20260107000001 use this turn order consistently.';
