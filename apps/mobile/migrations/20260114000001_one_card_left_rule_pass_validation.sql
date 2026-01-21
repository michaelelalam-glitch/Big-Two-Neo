-- Migration: One Card Left Rule - Add Pass Validation
-- Created: 2026-01-14
-- Description: Updates validate_one_card_left_rule to prevent passing when player has a higher single

-- ==================== ONE CARD LEFT RULE VALIDATION (UPDATED) ====================

-- Function to validate One Card Left rule (supports both playing and passing)
CREATE OR REPLACE FUNCTION validate_one_card_left_rule(
  p_selected_cards JSONB,
  p_current_player_hand JSONB,
  p_next_player_card_count INTEGER,
  p_last_play JSONB
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_highest_single JSONB;
  v_played_card JSONB;
  v_played_card_id TEXT;
  v_highest_card_id TEXT;
  v_is_passing BOOLEAN;
BEGIN
  -- Rule only applies when next player has exactly 1 card
  IF p_next_player_card_count != 1 THEN
    RETURN jsonb_build_object('valid', true);
  END IF;
  
  -- Determine if player is passing (NULL or empty array) or playing
  -- @copilot-review-fix: Treat NULL as passing (same as empty array) to handle edge cases
  -- NULL p_selected_cards OR empty array = player is passing
  v_is_passing := p_selected_cards IS NULL OR jsonb_array_length(p_selected_cards) = 0;
  
  -- Rule only applies when:
  -- 1. Player is passing, OR
  -- 2. Player is playing a single
  -- @copilot-review-fix: Simplified logic since v_is_passing now handles NULL
  IF NOT v_is_passing AND jsonb_array_length(p_selected_cards) != 1 THEN
    RETURN jsonb_build_object('valid', true);
  END IF;
  
  -- Rule only applies when last play was a single (or no last play)
  IF p_last_play IS NOT NULL 
     AND p_last_play->'cards' IS NOT NULL 
     AND jsonb_array_length(p_last_play->'cards') != 1 THEN
    RETURN jsonb_build_object('valid', true);
  END IF;
  
  -- Find the highest single that beats the last play
  v_highest_single := find_highest_beating_single(p_current_player_hand, p_last_play);
  
  -- If no valid single exists, player can pass or play whatever they want
  IF v_highest_single IS NULL THEN
    RETURN jsonb_build_object('valid', true);
  END IF;
  
  -- Case 1: Player is PASSING but has a higher single → BLOCK
  IF v_is_passing THEN
    RETURN jsonb_build_object(
      'valid', false,
      'error', format('Cannot pass! Must play highest single (%s%s) when opponent has 1 card left', 
                     v_highest_single->>'rank', v_highest_single->>'suit'),
      'required_card', v_highest_single
    );
  END IF;
  
  -- Case 2: Player is PLAYING a single → Must be the highest one
  v_played_card := p_selected_cards->0;
  v_played_card_id := v_played_card->>'id';
  v_highest_card_id := v_highest_single->>'id';
  
  IF v_played_card_id != v_highest_card_id THEN
    RETURN jsonb_build_object(
      'valid', false,
      'error', format('Must play highest single (%s%s) when opponent has 1 card left', 
                     v_highest_single->>'rank', v_highest_single->>'suit'),
      'required_card', v_highest_single
    );
  END IF;
  
  RETURN jsonb_build_object('valid', true);
END;
$$;

COMMENT ON FUNCTION validate_one_card_left_rule IS 
'Validates the One Card Left rule: When next player has 1 card, current player CANNOT pass if they have a higher single, and if playing a single it MUST be the highest one';
