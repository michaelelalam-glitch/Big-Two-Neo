-- Fix winner_id UUID casting in complete_game_from_client
-- Date: December 30, 2025
-- Issue: "column "winner_id" is of type uuid but expression is of type text"

CREATE OR REPLACE FUNCTION complete_game_from_client(
  p_room_id UUID,
  p_room_code TEXT,
  p_players JSONB,
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
  v_winner_uuid UUID;
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

  -- ✅ FIX: Convert winner_id to UUID with proper null handling
  -- If winner is a bot or invalid, set to NULL
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
    v_winner_uuid,  -- ✅ Use pre-validated UUID variable
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
  'Completes a game and updates player stats. Callable by authenticated clients (fallback when Edge Function unavailable).';
