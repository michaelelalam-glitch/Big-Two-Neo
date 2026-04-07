-- ==========================================================================
-- EMERGENCY FIX: Turn Timer Initialization
-- ==========================================================================
-- Applies the turn_started_at fix immediately to unblock autoplay

-- 1. Add DEFAULT NOW() to turn_started_at column (safe to run multiple times)
ALTER TABLE game_state 
  ALTER COLUMN turn_started_at SET DEFAULT NOW();

-- 2. Update all existing games with NULL or invalid turn_started_at
UPDATE game_state 
SET turn_started_at = NOW()
WHERE game_phase IN ('playing', 'first_play')
  AND (turn_started_at IS NULL OR turn_started_at < NOW() - INTERVAL '1 day');

-- 3. Verify the trigger exists (should already exist from 20260308000002)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'trigger_update_turn_started_at'
  ) THEN
    RAISE EXCEPTION 'Trigger trigger_update_turn_started_at not found! Run migration 20260308000002 first.';
  END IF;
END $$;

-- Success report
DO $$
DECLARE
  v_fixed_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_fixed_count
  FROM game_state
  WHERE game_phase IN ('playing', 'first_play')
    AND turn_started_at >= NOW() - INTERVAL '5 minutes';
    
  RAISE NOTICE '✅ Turn timer fix applied!';
  RAISE NOTICE '   - %s active games have valid turn_started_at timestamps', v_fixed_count;
  RAISE NOTICE '   - turn_started_at now defaults to NOW()';
  RAISE NOTICE '   - Autoplay should now work correctly';
END $$;
