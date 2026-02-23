-- ============================================================================
-- CRITICAL FIX: Add missing columns to game_state table
-- ============================================================================
-- ROOT CAUSE: Phase 2 Edge Functions expect columns that don't exist in schema
-- - match_number: Used to track which match (1, 2, 3...) for 3♦ validation
-- - pass_count: Used by Edge Function (conflicts with 'passes' column)
-- - auto_pass_timer: Server-managed timer state (Phase 2.3)
--
-- Date: December 30, 2025
-- Task: Production readiness fix - schema alignment

-- 1. Add match_number column (tracks which match we're on: 1, 2, 3...)
ALTER TABLE game_state 
ADD COLUMN IF NOT EXISTS match_number INTEGER NOT NULL DEFAULT 1
CHECK (match_number >= 1);

COMMENT ON COLUMN game_state.match_number IS 'Current match number (1-based). Match 1 requires 3♦ on first play.';

-- 2. Add pass_count column (Edge Function uses this name, not 'passes')
-- Note: We already have 'passes' column, but Edge Function expects 'pass_count'
-- Keep both for compatibility, sync them via trigger
ALTER TABLE game_state 
ADD COLUMN IF NOT EXISTS pass_count INTEGER NOT NULL DEFAULT 0
CHECK (pass_count >= 0);

COMMENT ON COLUMN game_state.pass_count IS 'Number of consecutive passes (resets when cards are played). Used by Edge Functions.';

-- 3. Add auto_pass_timer column (server-managed timer state from Phase 2.3)
-- Replaces auto_pass_active boolean with full timer state object
ALTER TABLE game_state 
ADD COLUMN IF NOT EXISTS auto_pass_timer JSONB DEFAULT NULL;

COMMENT ON COLUMN game_state.auto_pass_timer IS 'Server-managed auto-pass timer state (Phase 2.3). Contains: active, started_at, duration_ms, remaining_ms, end_timestamp, sequence_id.';

-- 4. Create trigger to keep 'passes' and 'pass_count' in sync
-- This ensures backward compatibility if any code uses the old 'passes' column
CREATE OR REPLACE FUNCTION sync_pass_counts()
RETURNS TRIGGER AS $$
BEGIN
  -- When pass_count changes, update passes
  IF NEW.pass_count IS DISTINCT FROM OLD.pass_count THEN
    NEW.passes := NEW.pass_count;
    NEW.passes_in_row := NEW.pass_count;
  END IF;
  
  -- When passes changes, update pass_count
  IF NEW.passes IS DISTINCT FROM OLD.passes THEN
    NEW.pass_count := NEW.passes;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sync_pass_counts_trigger
BEFORE UPDATE ON game_state
FOR EACH ROW
EXECUTE FUNCTION sync_pass_counts();

-- 5. Drop auto_pass_active column (replaced by auto_pass_timer)
-- Only drop if it exists (for idempotency)
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'game_state' 
    AND column_name = 'auto_pass_active'
  ) THEN
    ALTER TABLE game_state DROP COLUMN auto_pass_active;
    RAISE NOTICE 'Dropped deprecated auto_pass_active column';
  END IF;
END $$;

-- 6. Update existing rows to have default values
UPDATE game_state 
SET 
  match_number = 1,
  pass_count = COALESCE(passes, 0),
  auto_pass_timer = NULL
WHERE match_number IS NULL OR pass_count IS NULL;

-- Success message
DO $$
BEGIN
  RAISE NOTICE 'game_state schema updated successfully:';
  RAISE NOTICE '  ✅ Added match_number column';
  RAISE NOTICE '  ✅ Added pass_count column';
  RAISE NOTICE '  ✅ Added auto_pass_timer column';
  RAISE NOTICE '  ✅ Created pass_count sync trigger';
  RAISE NOTICE '  ✅ Dropped deprecated auto_pass_active column';
END $$;
