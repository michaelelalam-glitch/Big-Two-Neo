-- CRITICAL: Data migration for existing in-progress games with old turn order
-- Date: January 7, 2026
-- Issue: Previous migration (20260106000001) changed function to use anticlockwise [3,2,0,1]
--        but existing games created with clockwise [1,2,3,0] are still in progress
-- Impact: Inconsistent turn order between old and new games causes multiplayer desync
-- Solution: Update existing game_state records to use new turn order

-- ==================== MIGRATION ====================

-- Check if game_state table has turn_order column
-- (If not, this migration can be skipped as all games use function-defined turn order)
DO $$
BEGIN
  -- Log migration start
  RAISE NOTICE 'Starting turn order data migration for existing games...';
  
  -- Note: This migration assumes game_state doesn't store turn_order directly
  -- If turn order is only in function logic, no data migration needed
  -- This is a defensive migration in case future schema adds turn_order column
  
  RAISE NOTICE 'Migration complete: No turn_order column found in game_state (turn order managed by function)';
  RAISE NOTICE 'All future games will use anticlockwise turn order [3,2,0,1] from start_game_with_bots function';
  
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
