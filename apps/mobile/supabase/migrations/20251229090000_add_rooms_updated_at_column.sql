-- ============================================================================
-- FIX: Add missing updated_at column to rooms table
-- ============================================================================
-- ROOT CAUSE: start_game_with_bots() tries to UPDATE rooms.updated_at but column doesn't exist
-- ERROR: "column 'updated_at' of relation 'rooms' does not exist"
--
-- SOLUTION: Add updated_at column with auto-update trigger
--
-- Date: December 29, 2025, 9:00 AM
-- Task: Fix missing column error

-- Add updated_at column to rooms table
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Create trigger function to auto-update updated_at
CREATE OR REPLACE FUNCTION update_rooms_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
DROP TRIGGER IF EXISTS rooms_updated_at_trigger ON rooms;
CREATE TRIGGER rooms_updated_at_trigger
  BEFORE UPDATE ON rooms
  FOR EACH ROW
  EXECUTE FUNCTION update_rooms_updated_at();

-- Add comment
COMMENT ON COLUMN rooms.updated_at IS 'Timestamp of last update to this room (auto-updated via trigger)';

-- Success message
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== ✓ ROOMS TABLE UPDATED_AT COLUMN ADDED ===';
  RAISE NOTICE '';
  RAISE NOTICE 'Fixed:';
  RAISE NOTICE '  ✓ Added rooms.updated_at column';
  RAISE NOTICE '  ✓ Created auto-update trigger';
  RAISE NOTICE '  ✓ start_game_with_bots() will now work';
  RAISE NOTICE '';
END $$;
