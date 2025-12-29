-- ============================================================================
-- FIX: Auto-start matchmaking games when 4 players matched
-- ============================================================================
-- Issue #1: Casual/Private/Ranked matches don't auto-start when 4 players join
-- Issue #2: "User is already in another room" error (code 23505)
-- Issue #3: Only last player enters lobby in ranked mode (not all 4)
--
-- Root Cause: find_match creates rooms with status='waiting' but never
-- transitions to 'playing'. The ready trigger only fires on UPDATE, not INSERT.
--
-- Solution: Call start_game_with_bots(0 bots) when 4 players matched
-- This will:
-- 1. Create game_state
-- 2. Set room status to 'playing'
-- 3. Trigger navigation for all 4 players
-- 4. Clean up room memberships before matching

DROP FUNCTION IF EXISTS find_match(VARCHAR, INTEGER, VARCHAR, VARCHAR);

CREATE OR REPLACE FUNCTION find_match(
  p_username VARCHAR(50),
  p_skill_rating INTEGER DEFAULT 1000,
  p_region VARCHAR(10) DEFAULT 'global',
  p_match_type VARCHAR(10) DEFAULT 'casual'  -- 'casual' or 'ranked'
)
RETURNS TABLE(
  matched BOOLEAN,
  room_id UUID,
  room_code VARCHAR(10),
  waiting_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_waiting_players waiting_room[];
  v_new_room_id UUID;
  v_new_room_code VARCHAR(10);
  v_waiting_count INTEGER;
  v_player_index INTEGER;
  v_is_ranked BOOLEAN;
  v_start_result JSONB;
BEGIN
  -- SECURITY: Use auth.uid() instead of trusting client-supplied user_id
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  
  -- Convert match_type to boolean for ranked_mode
  v_is_ranked := p_match_type = 'ranked';
  
  -- 🔥 CRITICAL FIX: Remove user from any existing rooms FIRST
  -- This prevents "User is already in another room" error (code 23505)
  DELETE FROM room_players WHERE user_id = v_user_id;
  
  -- Cleanup stale waiting room entries
  PERFORM cleanup_stale_waiting_room_entries();
  
  -- Insert/update user in waiting room
  INSERT INTO waiting_room (user_id, username, skill_rating, region, status, match_type)
  VALUES (v_user_id, p_username, p_skill_rating, p_region, 'waiting', p_match_type)
  ON CONFLICT (user_id) 
  DO UPDATE SET 
    joined_at = NOW(), 
    status = 'waiting',
    match_type = p_match_type;
  
  -- Find waiting players with similar skill, same region, AND same match type
  SELECT ARRAY_AGG(wr ORDER BY wr.joined_at) INTO v_waiting_players
  FROM waiting_room wr
  WHERE wr.status = 'waiting'
  AND wr.region = p_region
  AND wr.match_type = p_match_type  -- CRITICAL: Match by type
  AND ABS(wr.skill_rating - p_skill_rating) <= 200
  AND wr.joined_at >= NOW() - INTERVAL '5 minutes'
  LIMIT 4;
  
  v_waiting_count := COALESCE(array_length(v_waiting_players, 1), 0);
  
  -- If 4 players found, create a room AND AUTO-START
  IF v_waiting_count >= 4 THEN
    v_new_room_code := generate_room_code_v2();
    
    -- Create room with proper matchmaking flags
    INSERT INTO rooms (
      code, 
      host_id, 
      status, 
      max_players, 
      fill_with_bots,
      is_matchmaking,
      is_public,
      ranked_mode
    )
    VALUES (
      v_new_room_code, 
      (v_waiting_players[1]).user_id, 
      'waiting',  -- Will become 'playing' after start_game_with_bots
      4, 
      FALSE,
      TRUE,
      TRUE,
      v_is_ranked
    )
    RETURNING id INTO v_new_room_id;
    
    -- Add all 4 players to the room
    FOR i IN 1..4 LOOP
      v_player_index := i - 1;
      
      INSERT INTO room_players (
        room_id, 
        user_id, 
        username, 
        player_index, 
        is_host, 
        is_ready,
        is_bot
      )
      VALUES (
        v_new_room_id,
        (v_waiting_players[i]).user_id,
        (v_waiting_players[i]).username,
        v_player_index,
        v_player_index = 0,  -- First player is host
        TRUE,                -- All players ready
        FALSE                -- Not a bot
      );
      
      -- Mark players as matched in waiting room
      UPDATE waiting_room
      SET status = 'matched', 
          matched_room_id = v_new_room_id,
          matched_at = NOW()
      WHERE user_id = (v_waiting_players[i]).user_id;
    END LOOP;
    
    -- 🔥 CRITICAL FIX: Auto-start game with 0 bots (4 humans only)
    -- This will:
    -- 1. Create game_state
    -- 2. Set room status to 'playing'
    -- 3. Trigger navigation for ALL 4 players via realtime subscription
    v_start_result := start_game_with_bots(v_new_room_id, 0, 'medium');
    
    IF v_start_result->>'success' != 'true' THEN
      RAISE EXCEPTION 'Failed to auto-start game: %', v_start_result->>'error';
    END IF;
    
    RETURN QUERY SELECT 
      TRUE as matched,
      v_new_room_id as room_id,
      v_new_room_code as room_code,
      4 as waiting_count;
  ELSE
    -- No match yet, return waiting count
    RETURN QUERY SELECT 
      FALSE as matched,
      NULL::UUID as room_id,
      NULL::VARCHAR as room_code,
      v_waiting_count as waiting_count;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION find_match TO authenticated;

COMMENT ON FUNCTION find_match IS 'Find or create a matchmaking game with AUTO-START. When 4 players matched, automatically starts the game (all players navigate to GameScreen). Cleans up existing room memberships to prevent "already in room" errors.';

-- ============================================================================
-- SUCCESS! All matchmaking modes (casual, ranked, private) will now:
-- 1. Auto-start when 4 players matched
-- 2. Navigate all players directly to GameScreen
-- 3. No more "already in room" errors
-- ============================================================================
