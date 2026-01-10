-- ⚠️ APPLY THIS SQL IN SUPABASE SQL EDITOR ⚠️
-- Go to: https://supabase.com/dashboard/project/dppybucldqufbqhwnkxu/sql/new

-- Fix 1: Update trigger to use 'playing' instead of 'normal_play'
CREATE OR REPLACE FUNCTION transition_game_phase_after_first_play()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.game_phase = 'first_play' AND 
     NEW.played_cards IS NOT NULL AND 
     jsonb_array_length(NEW.played_cards) > 0 THEN
    NEW.game_phase := 'playing';  -- Changed from 'normal_play'
    RAISE NOTICE 'game_phase transitioned from first_play to playing for room_id: %', NEW.room_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Fix 2: Fix any existing games stuck in 'normal_play'
UPDATE game_state
SET game_phase = 'playing'
WHERE game_phase = 'normal_play';

-- Fix 3: Fix current stuck game (if it exists)
UPDATE game_state
SET game_phase = 'playing'
WHERE game_phase = 'first_play'
  AND played_cards IS NOT NULL
  AND jsonb_array_length(played_cards) > 0;
