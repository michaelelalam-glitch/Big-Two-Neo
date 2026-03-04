-- Task: Add client-accessible game completion function
-- Date: December 23, 2025
-- Purpose: Allow clients to complete games and update stats when Edge Function is unavailable

-- =============================================================================
-- CLIENT-ACCESSIBLE GAME COMPLETION FUNCTION
-- =============================================================================

CREATE OR REPLACE FUNCTION complete_game_from_client(
  p_room_id UUID,
  p_room_code TEXT,
  p_players JSONB, -- Array of player data with user_id, username, score, finish_position, combos_played
  p_winner_id TEXT,
  p_game_duration_seconds INTEGER,
  p_started_at TIMESTAMPTZ,
  p_finished_at TIMESTAMPTZ
) RETURNS JSONB AS $$
DECLARE
  v_game_history_id UUID;
  v_player JSONB;
  v_real_players JSONB[] := '{}';
  v_won BOOLEAN;
  v_calling_user_id UUID;
BEGIN
  -- SECURITY: Verify caller is authenticated
  v_calling_user_id := auth.uid();
  IF v_calling_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Must be logged in';
  END IF;

  -- SECURITY: Verify caller is one of the players in the game
  IF NOT EXISTS (
    SELECT 1 
    FROM jsonb_array_elements(p_players) AS player
    WHERE (player->>'user_id')::TEXT = v_calling_user_id::TEXT
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Caller must be a player in this game';
  END IF;

  -- Filter out bot players (user_id starts with 'bot_')
  FOR v_player IN SELECT * FROM jsonb_array_elements(p_players)
  LOOP
    IF (v_player->>'user_id')::TEXT NOT LIKE 'bot_%' THEN
      v_real_players := array_append(v_real_players, v_player);
    END IF;
  END LOOP;

  -- Insert game history record
  INSERT INTO game_history (
    room_id,
    room_code,
    player_1_id,
    player_1_username,
    player_1_score,
    player_2_id,
    player_2_username,
    player_2_score,
    player_3_id,
    player_3_username,
    player_3_score,
    player_4_id,
    player_4_username,
    player_4_score,
    winner_id,
    game_duration_seconds,
    started_at,
    finished_at
  ) VALUES (
    p_room_id,
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
    CASE 
      WHEN p_winner_id LIKE 'bot_%' THEN NULL 
      ELSE p_winner_id::UUID 
    END,
    p_game_duration_seconds,
    p_started_at,
    p_finished_at
  )
  RETURNING id INTO v_game_history_id;

  -- Update stats for each REAL player (not bots)
  FOR v_player IN SELECT * FROM unnest(v_real_players)
  LOOP
    v_won := (v_player->>'user_id')::TEXT = p_winner_id::TEXT;
    
    -- Call the service-role-only function using SECURITY DEFINER context
    PERFORM update_player_stats_after_game(
      (v_player->>'user_id')::UUID,
      v_won,
      (v_player->>'finish_position')::INTEGER,
      (v_player->>'score')::INTEGER,
      v_player->'combos_played'
    );
  END LOOP;

  -- Refresh leaderboard materialized view
  PERFORM refresh_leaderboard();

  RETURN jsonb_build_object(
    'success', true,
    'game_history_id', v_game_history_id,
    'players_updated', array_length(v_real_players, 1),
    'message', 'Game completed and stats updated successfully'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated users (they can only complete games they're part of)
GRANT EXECUTE ON FUNCTION complete_game_from_client TO authenticated;

-- Add comment
COMMENT ON FUNCTION complete_game_from_client IS 
'Client-accessible function to complete a game and update player stats. 
Security: Verifies caller is authenticated and is a player in the game.';
