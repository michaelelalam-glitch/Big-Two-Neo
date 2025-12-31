-- Fix Security Issues in RPC Functions
-- Date: December 31, 2025
-- Issue: execute_pass_move and complete_game_from_client lack auth.uid() validation
-- Risk: Any authenticated user can execute moves or forge game results for other players

-- ==============================================================================
-- 1. Fix execute_pass_move - Add auth.uid() validation
-- ==============================================================================

CREATE OR REPLACE FUNCTION execute_pass_move(
  p_room_code TEXT,
  p_player_id UUID
)
RETURNS JSON AS $$
DECLARE
  v_room_id UUID;
  v_game_state RECORD;
  v_player RECORD;
  v_next_turn INTEGER;
  v_new_pass_count INTEGER;
  -- Anticlockwise turn order mapping: 0→3, 1→2, 2→0, 3→1
  -- Implementation: v_turn_order[player_index + 1] because PostgreSQL arrays are 1-indexed
  -- Example: player_index=0 → turn_order[1] = 3 (next player)
  -- Example: player_index=2 → turn_order[3] = 0 (next player)
  -- Position 0 (bottom) → 3 (right)
  -- Position 1 (top) → 2 (left)  
  -- Position 2 (left) → 0 (bottom)
  -- Position 3 (right) → 1 (top)
  v_turn_order INTEGER[] := ARRAY[3, 2, 0, 1];
BEGIN
  -- Get room
  SELECT id INTO v_room_id FROM rooms WHERE code = p_room_code;
  IF v_room_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Room not found');
  END IF;
  
  -- Get game state with row locking
  SELECT * INTO v_game_state FROM game_state WHERE room_id = v_room_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Game state not found');
  END IF;
  
  -- Get player
  SELECT * INTO v_player FROM room_players WHERE id = p_player_id AND room_id = v_room_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Player not found');
  END IF;
  
  -- ✅ SECURITY FIX: Verify that the authenticated user owns this player
  IF v_player.user_id != auth.uid() THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Unauthorized: You can only pass for your own player'
    );
  END IF;
  
  -- Verify turn
  IF v_game_state.current_turn != v_player.player_index THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Not your turn',
      'current_turn', v_game_state.current_turn,
      'your_index', v_player.player_index
    );
  END IF;
  
  -- Calculate next turn using anticlockwise array (FIXED)
  -- BEFORE: v_next_turn := (v_player.player_index + 1) % 4; (CLOCKWISE)
  -- AFTER: v_next_turn := v_turn_order[v_player.player_index + 1]; (ANTICLOCKWISE)
  -- Note: PostgreSQL arrays are 1-indexed, so add 1 to player_index
  v_next_turn := v_turn_order[v_player.player_index + 1];
  v_new_pass_count := v_game_state.passes + 1;
  
  -- Check if 3 consecutive passes (clear trick)
  IF v_new_pass_count >= 3 THEN
    UPDATE game_state
    SET
      current_turn = v_next_turn,
      passes = 0,
      passes_in_row = 0,
      last_play = NULL,
      last_player = NULL,
      updated_at = NOW()
    WHERE room_id = v_room_id;
    
    RETURN json_build_object(
      'success', true,
      'next_turn', v_next_turn,
      'trick_cleared', true
    );
  ELSE
    -- Normal pass - advance turn
    UPDATE game_state
    SET
      current_turn = v_next_turn,
      passes = v_new_pass_count,
      passes_in_row = v_new_pass_count,
      updated_at = NOW()
    WHERE room_id = v_room_id;
    
    RETURN json_build_object(
      'success', true,
      'next_turn', v_next_turn,
      'passes', v_new_pass_count,
      'trick_cleared', false
    );
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION execute_pass_move IS 
  'Executes a pass move with auth.uid() validation. Only allows users to pass for their own player.';

-- ==============================================================================
-- 2. Fix complete_game_from_client - Add auth.uid() validation and verify against room_players
-- ==============================================================================

CREATE OR REPLACE FUNCTION complete_game_from_client(
  p_room_id UUID,
  p_room_code TEXT,
  p_players JSONB,
  p_winner_id TEXT,
  p_game_duration_seconds INTEGER,
  p_started_at TIMESTAMP WITH TIME ZONE,
  p_finished_at TIMESTAMP WITH TIME ZONE
)
RETURNS JSONB AS $$
DECLARE
  v_room_id UUID;
  v_winner_uuid UUID;
  v_game_history_id UUID;
  v_real_players JSONB[];
  v_player JSONB;
  v_won BOOLEAN;
  v_player_in_room RECORD;
  v_caller_in_room BOOLEAN := FALSE;
BEGIN
  -- Validate room_id
  IF p_room_id IS NULL THEN
    SELECT id INTO v_room_id FROM rooms WHERE code = p_room_code;
    IF v_room_id IS NULL THEN
      RAISE EXCEPTION 'Room not found: %', p_room_code;
    END IF;
  ELSE
    v_room_id := p_room_id;
  END IF;

  -- ✅ SECURITY FIX: Verify caller is actually a player in this room
  SELECT EXISTS(
    SELECT 1 FROM room_players 
    WHERE room_id = v_room_id AND user_id = auth.uid()
  ) INTO v_caller_in_room;
  
  IF NOT v_caller_in_room THEN
    RAISE EXCEPTION 'Unauthorized: You are not a player in this room';
  END IF;

  -- ✅ SECURITY FIX: Validate all player user_ids against room_players
  -- Cross-check client-supplied p_players against authoritative room_players table
  FOR v_player IN SELECT * FROM jsonb_array_elements(p_players)
  LOOP
    -- Skip bot players (user_id starts with 'bot_')
    IF v_player->>'user_id' LIKE 'bot_%' THEN
      CONTINUE;
    END IF;
    
    -- Verify this real player is actually in the room
    SELECT * INTO v_player_in_room 
    FROM room_players 
    WHERE room_id = v_room_id 
      AND user_id = (v_player->>'user_id')::UUID;
      
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invalid player data: user_id % not in room', v_player->>'user_id';
    END IF;
  END LOOP;

  -- ✅ SECURITY FIX: Validate winner_id against room_players (if not a bot)
  IF p_winner_id IS NOT NULL AND p_winner_id != '' AND NOT p_winner_id LIKE 'bot_%' THEN
    SELECT EXISTS(
      SELECT 1 FROM room_players 
      WHERE room_id = v_room_id AND user_id = p_winner_id::UUID
    ) INTO v_caller_in_room;
    
    IF NOT v_caller_in_room THEN
      RAISE EXCEPTION 'Invalid winner: user_id % not in room', p_winner_id;
    END IF;
  END IF;

  -- Extract real (non-bot) players only
  SELECT array_agg(p) INTO v_real_players
  FROM jsonb_array_elements(p_players) AS p
  WHERE NOT (p->>'user_id' LIKE 'bot_%');

  -- Handle winner_id safely with UUID casting
  BEGIN
    IF p_winner_id IS NULL OR p_winner_id = '' OR p_winner_id LIKE 'bot_%' THEN
      v_winner_uuid := NULL;
    ELSE
      v_winner_uuid := p_winner_id::UUID;
    END IF;
  EXCEPTION
    WHEN invalid_text_representation THEN
      -- If UUID casting fails, log the invalid winner_id for debugging and treat as bot/invalid winner
      RAISE LOG 'Invalid winner_id value "%" could not be cast to UUID in complete_game_from_client', p_winner_id;
      v_winner_uuid := NULL;
  END;

  -- Insert game history
  INSERT INTO game_history (
    room_code,
    player_0_id,
    player_0_name,
    player_0_score,
    player_1_id,
    player_1_name,
    player_1_score,
    player_2_id,
    player_2_name,
    player_2_score,
    player_3_id,
    player_3_name,
    player_3_score,
    winner_id,
    game_duration_seconds,
    started_at,
    finished_at
  )
  VALUES (
    p_room_code,
    (p_players->0->>'user_id')::UUID,
    p_players->0->>'username',
    (p_players->0->>'score')::INTEGER,
    (p_players->1->>'user_id')::UUID,
    p_players->1->>'username',
    (p_players->1->>'score')::INTEGER,
    (p_players->2->>'user_id')::UUID,
    p_players->2->>'username',
    (p_players->2->>'score')::INTEGER,
    (p_players->3->>'user_id')::UUID,
    p_players->3->>'username',
    (p_players->3->>'score')::INTEGER,
    v_winner_uuid,
    p_game_duration_seconds,
    p_started_at,
    p_finished_at
  )
  RETURNING id INTO v_game_history_id;

  -- Update stats for each REAL player (not bots)
  FOR v_player IN SELECT * FROM unnest(v_real_players)
  LOOP
    v_won := (v_player->>'user_id')::UUID = v_winner_uuid;
    
    INSERT INTO player_stats (user_id, games_played, games_won)
    VALUES ((v_player->>'user_id')::UUID, 1, CASE WHEN v_won THEN 1 ELSE 0 END)
    ON CONFLICT (user_id)
    DO UPDATE SET
      games_played = player_stats.games_played + 1,
      games_won = player_stats.games_won + CASE WHEN v_won THEN 1 ELSE 0 END;

    -- Update combo stats
    IF v_player->>'combos_played' IS NOT NULL THEN
      INSERT INTO combo_stats (user_id, total_combos_played)
      VALUES ((v_player->>'user_id')::UUID, (v_player->>'combos_played')::INTEGER)
      ON CONFLICT (user_id)
      DO UPDATE SET
        total_combos_played = combo_stats.total_combos_played + (v_player->>'combos_played')::INTEGER;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'game_history_id', v_game_history_id,
    'players_updated', array_length(v_real_players, 1)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION complete_game_from_client TO authenticated;

COMMENT ON FUNCTION complete_game_from_client IS 
  'Completes a game and updates player stats. Validates all players and winner against room_players. Only callable by room participants.';
