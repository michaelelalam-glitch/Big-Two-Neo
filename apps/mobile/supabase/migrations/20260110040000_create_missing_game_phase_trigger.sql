-- ============================================================================
-- CRITICAL FIX: CREATE THE MISSING TRIGGER + Fix All Game Phase Issues
-- ============================================================================
-- ROOT CAUSE: Previous migration only created the FUNCTION but never created
-- the TRIGGER itself! So the function was never being called.
--
-- COMPLETE FIX:
-- 1. Drop old trigger if exists
-- 2. Create/update the function to use 'playing' instead of 'normal_play'
-- 3. CREATE THE TRIGGER (this was missing!)
-- 4. Fix all stuck games in 'first_play' that have played_cards
-- 5. Fix all games stuck in 'normal_play' to 'playing'
--
-- Date: January 10, 2026
-- Task #587: Complete game phase trigger fix

-- Step 1: Drop existing trigger if it exists
DROP TRIGGER IF EXISTS trigger_transition_game_phase_after_first_play ON game_state;

-- Step 2: Create/update the function
CREATE OR REPLACE FUNCTION transition_game_phase_after_first_play()
RETURNS TRIGGER AS $$
BEGIN
  -- If game_phase is 'first_play' and played_cards array is not empty,
  -- it means someone just played the 3D (first play completed)
  IF NEW.game_phase = 'first_play' AND 
     NEW.played_cards IS NOT NULL AND 
     jsonb_array_length(NEW.played_cards) > 0 THEN
    
    -- Transition to 'playing' (NOT 'normal_play')
    NEW.game_phase := 'playing';
    
    -- Log the transition for debugging
    RAISE NOTICE 'game_phase transitioned from first_play to playing for room_id: %', NEW.room_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 3: CREATE THE TRIGGER (THIS WAS MISSING!)
CREATE TRIGGER trigger_transition_game_phase_after_first_play
  BEFORE UPDATE ON game_state
  FOR EACH ROW
  EXECUTE FUNCTION transition_game_phase_after_first_play();

-- Step 4: Fix all games stuck in 'first_play' that have already played D3
UPDATE game_state
SET game_phase = 'playing'
WHERE game_phase = 'first_play' 
  AND played_cards IS NOT NULL 
  AND jsonb_array_length(played_cards) > 0;

-- Step 5: Fix any games stuck in 'normal_play' to 'playing'
UPDATE game_state
SET game_phase = 'playing'
WHERE game_phase = 'normal_play';

COMMENT ON TRIGGER trigger_transition_game_phase_after_first_play ON game_state IS 
'Auto-transitions game_phase from first_play to playing after 3D is played';

COMMENT ON FUNCTION transition_game_phase_after_first_play() IS 
'Trigger function that auto-transitions game_phase from first_play to playing after 3D is played. Fixed to use playing instead of normal_play and trigger is now properly created.';
