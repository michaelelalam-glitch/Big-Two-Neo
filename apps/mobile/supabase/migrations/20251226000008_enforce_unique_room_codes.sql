-- ============================================================================
-- CRITICAL FIX: Enforce UNIQUE room codes + Automatic room cleanup
-- ============================================================================
-- Issue: Multiple rooms with same room code can exist simultaneously
-- This causes 2+ players to be routed to DIFFERENT rooms with the SAME code
-- Root cause: Missing UNIQUE constraint on rooms.code column
--
-- Fix Strategy:
-- 1. Clean up any duplicate room codes (keep oldest)
-- 2. Add UNIQUE constraint to prevent future duplicates
-- 3. Update room creation logic to handle collisions gracefully
-- 4. Add automatic cleanup trigger when all players leave

-- ============================================================================
-- STEP 1: Clean up existing duplicate room codes
-- ============================================================================

-- Delete duplicate rooms, keeping only the oldest one for each code
DELETE FROM rooms
WHERE id IN (
  SELECT r2.id
  FROM rooms r1
  INNER JOIN rooms r2 ON r1.code = r2.code AND r1.id < r2.id
);

-- Verify no duplicates remain
DO $$
DECLARE
  v_duplicate_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_duplicate_count
  FROM (
    SELECT code, COUNT(*) as cnt
    FROM rooms
    GROUP BY code
    HAVING COUNT(*) > 1
  ) duplicates;
  
  IF v_duplicate_count > 0 THEN
    RAISE EXCEPTION 'Still have % duplicate room codes!', v_duplicate_count;
  ELSE
    RAISE NOTICE '✅ All duplicate room codes cleaned up';
  END IF;
END $$;

-- ============================================================================
-- STEP 2: Add UNIQUE constraint to rooms.code
-- ============================================================================

-- Add unique constraint (prevents duplicate codes at database level)
ALTER TABLE rooms 
ADD CONSTRAINT rooms_code_unique UNIQUE (code);

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_rooms_code_lookup ON rooms(code) WHERE status IN ('waiting', 'playing');

COMMENT ON CONSTRAINT rooms_code_unique ON rooms IS
  'Ensures one room code can only exist once at any given time. Room codes can be reused after room is deleted.';

-- ============================================================================
-- STEP 3: Add automatic room cleanup when empty
-- ============================================================================

-- Function to check if room is empty and clean up
CREATE OR REPLACE FUNCTION cleanup_empty_rooms()
RETURNS TRIGGER AS $$
DECLARE
  v_player_count INTEGER;
  v_room_status TEXT;
BEGIN
  -- Count remaining players in the room
  SELECT COUNT(*), r.status INTO v_player_count, v_room_status
  FROM room_players rp
  JOIN rooms r ON r.id = rp.room_id
  WHERE rp.room_id = OLD.room_id
  GROUP BY r.status;
  
  -- If no players left, delete the room (makes code available for reuse)
  IF v_player_count IS NULL OR v_player_count = 0 THEN
    DELETE FROM rooms WHERE id = OLD.room_id;
    RAISE NOTICE 'Auto-deleted empty room: %', OLD.room_id;
  END IF;
  
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Trigger: Auto-delete room when last player leaves
DROP TRIGGER IF EXISTS trigger_cleanup_empty_rooms ON room_players;
CREATE TRIGGER trigger_cleanup_empty_rooms
  AFTER DELETE ON room_players
  FOR EACH ROW
  EXECUTE FUNCTION cleanup_empty_rooms();

COMMENT ON FUNCTION cleanup_empty_rooms IS
  'Automatically deletes rooms when the last player leaves, making room code available for reuse';

-- ============================================================================
-- STEP 4: Update generate_room_code_v2 with better collision handling
-- ============================================================================

-- Enhanced room code generation with exponential backoff
CREATE OR REPLACE FUNCTION generate_room_code_v2()
RETURNS VARCHAR AS $$
DECLARE
  chars TEXT := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  result VARCHAR := '';
  i INTEGER;
  max_attempts INTEGER := 100;
  attempt INTEGER := 0;
  random_index INTEGER;
BEGIN
  LOOP
    attempt := attempt + 1;
    
    -- Generate 6-character code
    result := '';
    FOR i IN 1..6 LOOP
      random_index := 1 + FLOOR(RANDOM() * 32)::INTEGER;
      result := result || SUBSTRING(chars FROM random_index FOR 1);
    END LOOP;
    
    -- Check for collision (now enforced by UNIQUE constraint)
    IF NOT EXISTS (SELECT 1 FROM rooms WHERE code = result) THEN
      RETURN result;
    END IF;
    
    -- Max attempts reached
    IF attempt >= max_attempts THEN
      RAISE EXCEPTION 'Failed to generate unique room code after % attempts. Database may be full.', max_attempts;
    END IF;
    
    -- Add small delay on collision (prevents thundering herd)
    IF attempt > 10 THEN
      PERFORM pg_sleep(0.001 * attempt); -- Exponential backoff: 11ms, 12ms, 13ms...
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql VOLATILE;

GRANT EXECUTE ON FUNCTION generate_room_code_v2() TO authenticated;

COMMENT ON FUNCTION generate_room_code_v2() IS 
  'Generates unique 6-character room codes with collision detection and exponential backoff. Guaranteed unique by database constraint.';

-- ============================================================================
-- STEP 5: Add helper function to safely get or create room
-- ============================================================================

CREATE OR REPLACE FUNCTION get_or_create_room(
  p_user_id UUID,
  p_username TEXT,
  p_is_public BOOLEAN,
  p_is_matchmaking BOOLEAN,
  p_ranked_mode BOOLEAN
) RETURNS JSONB AS $$
DECLARE
  v_room_code TEXT;
  v_room_id UUID;
  v_collision_attempts INTEGER := 0;
  v_max_collisions INTEGER := 5;
BEGIN
  -- Retry loop for collision handling
  LOOP
    v_collision_attempts := v_collision_attempts + 1;
    
    BEGIN
      -- Generate unique code
      v_room_code := generate_room_code_v2();
      
      -- Try to create room (will fail if code already exists due to UNIQUE constraint)
      INSERT INTO rooms (code, host_id, status, max_players, is_public, is_matchmaking, ranked_mode, created_at)
      VALUES (v_room_code, NULL, 'waiting', 4, p_is_public, p_is_matchmaking, p_ranked_mode, NOW())
      RETURNING id INTO v_room_id;
      
      -- Success! Now add user as host
      PERFORM join_room_atomic(v_room_code, p_user_id, p_username);
      
      RETURN jsonb_build_object(
        'success', true,
        'room_id', v_room_id,
        'room_code', v_room_code,
        'attempts', v_collision_attempts
      );
      
    EXCEPTION WHEN unique_violation THEN
      -- Code collision, try again
      IF v_collision_attempts >= v_max_collisions THEN
        RAISE EXCEPTION 'Failed to create room after % collision attempts', v_max_collisions;
      END IF;
      -- Loop continues with new code
    END;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION get_or_create_room TO authenticated;

COMMENT ON FUNCTION get_or_create_room IS
  'Safely creates a new room with guaranteed unique code, handling collisions gracefully';

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Test: Try to insert duplicate room code (should fail)
DO $$
DECLARE
  v_test_code TEXT := 'TEST99';
BEGIN
  -- Create first room
  INSERT INTO rooms (code, host_id, status, max_players)
  VALUES (v_test_code, (SELECT id FROM auth.users LIMIT 1), 'waiting', 4);
  
  -- Try to create duplicate (should fail)
  BEGIN
    INSERT INTO rooms (code, host_id, status, max_players)
    VALUES (v_test_code, (SELECT id FROM auth.users LIMIT 1), 'waiting', 4);
    
    RAISE EXCEPTION '❌ CONSTRAINT FAILED: Duplicate room code was allowed!';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE '✅ UNIQUE constraint working: Duplicate room code blocked';
  END;
  
  -- Cleanup test room
  DELETE FROM rooms WHERE code = v_test_code;
END $$;

-- Final summary
SELECT 
  '✅ Room code uniqueness enforced' as status,
  'One room code = one room at any time' as guarantee,
  'Automatic cleanup when empty' as lifecycle;
