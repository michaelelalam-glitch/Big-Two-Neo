-- ⚠️ WARNING: This is a temporary hotfix script.
-- DO NOT USE if migration 20260106222754_fix_game_phase_transition.sql has been applied.
-- This file is kept for reference only and should be deleted after migration is confirmed.
--
-- Fix game_phase not transitioning from first_play to normal_play
CREATE OR REPLACE FUNCTION transition_game_phase_after_first_play()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.game_phase = 'first_play' AND 
     NEW.played_cards IS NOT NULL AND 
     jsonb_array_length(NEW.played_cards) > 0 THEN
    NEW.game_phase := 'normal_play';
    RAISE NOTICE 'game_phase transitioned from first_play to normal_play for room_id: %', NEW.room_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_transition_game_phase ON game_state;

CREATE TRIGGER trigger_transition_game_phase
  BEFORE UPDATE ON game_state
  FOR EACH ROW
  EXECUTE FUNCTION transition_game_phase_after_first_play();

UPDATE game_state
SET game_phase = 'normal_play'
WHERE game_phase = 'first_play'
  AND played_cards IS NOT NULL
  AND jsonb_array_length(played_cards) > 0;
