-- Migration: Fix game_phase not transitioning from first_play to normal_play
-- Problem: game_phase stays stuck in 'first_play' after 3D is played,
-- causing bots to only look for 3D and pass every turn.
-- Solution: Add trigger to auto-transition game_phase after first successful play.

-- Step 1: Add function to transition game_phase after first play
CREATE OR REPLACE FUNCTION transition_game_phase_after_first_play()
RETURNS TRIGGER AS $$
BEGIN
  -- If game_phase is 'first_play' and played_cards array is not empty,
  -- it means someone just played the 3D (first play completed)
  IF NEW.game_phase = 'first_play' AND 
     NEW.played_cards IS NOT NULL AND 
     jsonb_array_length(NEW.played_cards) > 0 THEN
    
    -- Transition to normal_play
    NEW.game_phase := 'normal_play';
    
    -- Log the transition for debugging
    RAISE NOTICE 'game_phase transitioned from first_play to normal_play for room_id: %', NEW.room_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 2: Create trigger on game_state table
DROP TRIGGER IF EXISTS trigger_transition_game_phase ON game_state;

CREATE TRIGGER trigger_transition_game_phase
  BEFORE UPDATE ON game_state
  FOR EACH ROW
  EXECUTE FUNCTION transition_game_phase_after_first_play();

-- Step 3: Fix existing games stuck in first_play
-- Any game with played_cards should be in normal_play, not first_play
UPDATE game_state
SET game_phase = 'normal_play'
WHERE game_phase = 'first_play'
  AND played_cards IS NOT NULL
  AND jsonb_array_length(played_cards) > 0;

COMMENT ON FUNCTION transition_game_phase_after_first_play() IS 
'Auto-transitions game_phase from first_play to normal_play after 3D is played. Fixes bug where bots only look for 3D.';

COMMENT ON TRIGGER trigger_transition_game_phase ON game_state IS
'Automatically transitions game phase after first play completed.';
