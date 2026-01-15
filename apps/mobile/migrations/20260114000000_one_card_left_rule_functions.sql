-- Migration: One Card Left Rule - Postgres Function Implementation
-- Created: 2026-01-14
-- Description: Implements "One Card Left" rule as database functions for better performance

-- ==================== HELPER FUNCTIONS ====================

-- Function to find the highest single card that beats the last play
CREATE OR REPLACE FUNCTION find_highest_beating_single(
  p_hand JSONB,
  p_last_play JSONB
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_card JSONB;
  v_highest_card JSONB := NULL;
  v_highest_value INTEGER := -1;
  v_card_value INTEGER;
  v_last_play_card JSONB;
  v_last_play_value INTEGER;
BEGIN
  -- If no last play (leading), return highest card from hand
  IF p_last_play IS NULL OR p_last_play->>'combo_type' IS NULL THEN
    FOR v_card IN SELECT * FROM jsonb_array_elements(p_hand)
    LOOP
      v_card_value := get_card_value(v_card);
      IF v_card_value > v_highest_value THEN
        v_highest_value := v_card_value;
        v_highest_card := v_card;
      END IF;
    END LOOP;
    RETURN v_highest_card;
  END IF;
  
  -- Only check singles against singles
  IF (p_last_play->'cards')::jsonb IS NULL OR jsonb_array_length(p_last_play->'cards') != 1 THEN
    RETURN NULL;
  END IF;
  
  -- Get last play card value
  v_last_play_card := (p_last_play->'cards')->0;
  v_last_play_value := get_card_value(v_last_play_card);
  
  -- Find all singles that beat the last play, keep track of highest
  FOR v_card IN SELECT * FROM jsonb_array_elements(p_hand)
  LOOP
    v_card_value := get_card_value(v_card);
    IF v_card_value > v_last_play_value AND v_card_value > v_highest_value THEN
      v_highest_value := v_card_value;
      v_highest_card := v_card;
    END IF;
  END LOOP;
  
  RETURN v_highest_card;
END;
$$;

-- Function to get card value (rank * 10 + suit)
CREATE OR REPLACE FUNCTION get_card_value(p_card JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_rank TEXT;
  v_suit TEXT;
  v_rank_value INTEGER;
  v_suit_value INTEGER;
BEGIN
  v_rank := p_card->>'rank';
  v_suit := p_card->>'suit';
  
  -- Rank values
  v_rank_value := CASE v_rank
    WHEN '3' THEN 1
    WHEN '4' THEN 2
    WHEN '5' THEN 3
    WHEN '6' THEN 4
    WHEN '7' THEN 5
    WHEN '8' THEN 6
    WHEN '9' THEN 7
    WHEN '10' THEN 8
    WHEN 'J' THEN 9
    WHEN 'Q' THEN 10
    WHEN 'K' THEN 11
    WHEN 'A' THEN 12
    WHEN '2' THEN 13
    ELSE 0
  END;
  
  -- Suit values
  v_suit_value := CASE v_suit
    WHEN 'D' THEN 1
    WHEN 'C' THEN 2
    WHEN 'H' THEN 3
    WHEN 'S' THEN 4
    ELSE 0
  END;
  
  RETURN v_rank_value * 10 + v_suit_value;
END;
$$;

-- ==================== ONE CARD LEFT RULE VALIDATION ====================

-- Function to validate One Card Left rule
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
BEGIN
  -- Rule only applies when next player has exactly 1 card
  IF p_next_player_card_count != 1 THEN
    RETURN jsonb_build_object('valid', true);
  END IF;
  
  -- Rule only applies to singles
  IF jsonb_array_length(p_selected_cards) != 1 THEN
    RETURN jsonb_build_object('valid', true);
  END IF;
  
  -- Find the highest single that beats the last play
  v_highest_single := find_highest_beating_single(p_current_player_hand, p_last_play);
  
  -- If no valid single exists, rule doesn't apply
  IF v_highest_single IS NULL THEN
    RETURN jsonb_build_object('valid', true);
  END IF;
  
  -- Check if player is playing the highest single
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

-- ==================== INTEGRATION WITH GAME STATE ====================

-- Add validation to game state updates (called from Edge Function)
-- This can be called directly from TypeScript Edge Functions:
--
-- const validation = await supabase.rpc('validate_one_card_left_rule', {
--   p_selected_cards: cards,
--   p_current_player_hand: playerHand,
--   p_next_player_card_count: nextPlayerHand.length,
--   p_last_play: gameState.last_play
-- });
--
-- if (!validation.valid) {
--   return { error: validation.error, required_card: validation.required_card };
-- }

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION find_highest_beating_single(JSONB, JSONB) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION get_card_value(JSONB) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION validate_one_card_left_rule(JSONB, JSONB, INTEGER, JSONB) TO authenticated, anon;

COMMENT ON FUNCTION validate_one_card_left_rule IS 
'Validates the One Card Left rule: When next player has 1 card, current player must play highest single if playing a single';

COMMENT ON FUNCTION find_highest_beating_single IS 
'Finds the highest single card from hand that beats the last play';

COMMENT ON FUNCTION get_card_value IS 
'Calculates numeric value of a card for comparison (rank * 10 + suit)';
