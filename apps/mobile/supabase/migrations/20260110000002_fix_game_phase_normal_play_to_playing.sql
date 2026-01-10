-- ============================================================================
-- CRITICAL FIX: Change 'normal_play' to 'playing' in game phase trigger
-- ============================================================================
-- ROOT CAUSE: Trigger transitions first_play → 'normal_play', but everywhere
-- else in code expects 'playing'. This causes game to be stuck after first card.
--
-- PROBLEM:
-- - Trigger sets game_phase = 'normal_play' (not in CHECK constraint!)
-- - useBotCoordinator checks for 'playing', not 'normal_play'
-- - Result: Bots keep checking for 3D and eventually crash with HTTP 400
--
-- SOLUTION:
-- - Change trigger to use 'playing' (matches the code and CHECK constraint)
-- - This aligns with valid phases: 'first_play', 'playing', 'finished', 'game_over'
--
-- Date: January 10, 2026
-- Task #587: Fix game phase transition

-- Update the trigger function to use 'playing' instead of 'normal_play'
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

-- Fix any existing games stuck in 'normal_play' (should transition to 'playing')
UPDATE game_state
SET game_phase = 'playing'
WHERE game_phase = 'normal_play';

COMMENT ON FUNCTION transition_game_phase_after_first_play() IS 
'Auto-transitions game_phase from first_play to playing after 3D is played. Fixed to use playing instead of normal_play.';
