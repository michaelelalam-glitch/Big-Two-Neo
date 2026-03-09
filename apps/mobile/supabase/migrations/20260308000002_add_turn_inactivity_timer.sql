-- ==========================================================================
-- ADD TURN INACTIVITY TIMER SYSTEM
-- ==========================================================================
-- Tracks when a player's turn started to implement 60s turn timeout with auto-play
-- Charcoal grey ring countdown visible to current player during their turn
-- If timeout expires: auto-play highest valid cards OR pass

-- 1. Add turn_started_at column to game_state
ALTER TABLE game_state 
  ADD COLUMN IF NOT EXISTS turn_started_at TIMESTAMPTZ;

COMMENT ON COLUMN game_state.turn_started_at IS 
  'UTC timestamp when current_turn player''s turn started. Used for 60s turn inactivity timeout. Reset on every turn change.';

-- 2. Create function to update turn_started_at whenever current_turn changes
CREATE OR REPLACE FUNCTION update_turn_started_at()
RETURNS TRIGGER AS $$
BEGIN
  -- If current_turn changed, reset turn_started_at to NOW()
  IF NEW.current_turn IS DISTINCT FROM OLD.current_turn THEN
    NEW.turn_started_at := NOW();
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Create trigger to auto-update turn_started_at on current_turn change
DROP TRIGGER IF EXISTS trigger_update_turn_started_at ON game_state;
CREATE TRIGGER trigger_update_turn_started_at
  BEFORE UPDATE ON game_state
  FOR EACH ROW
  EXECUTE FUNCTION update_turn_started_at();

COMMENT ON FUNCTION update_turn_started_at() IS 
  'Automatically sets turn_started_at to NOW() whenever current_turn changes. Enables 60s turn timeout detection.';

-- 4. Initialize turn_started_at for existing games
UPDATE game_state 
SET turn_started_at = NOW()
WHERE turn_started_at IS NULL 
  AND game_phase IN ('playing', 'first_play');

-- Success message
DO $$
BEGIN
  RAISE NOTICE '✅ Turn inactivity timer system installed successfully';
  RAISE NOTICE '   - turn_started_at column added to game_state';
  RAISE NOTICE '   - Auto-update trigger created for turn transitions';
  RAISE NOTICE '   - Existing games initialized with current timestamp';
END $$;
