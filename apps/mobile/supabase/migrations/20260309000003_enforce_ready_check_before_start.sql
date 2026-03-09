-- Task #623: Enforce ready check before game start
-- Date: March 9, 2026
-- Problem: start_game_with_bots() has no validation that all non-host human players are ready.
--          The host could force-start the game even if other human players have not toggled ready.
-- Fix: Add a server-side guard that rejects the RPC call if any non-host, non-bot player
--      has is_ready = false. This mirrors the frontend gate added in LobbyScreen.tsx.

CREATE OR REPLACE FUNCTION start_game_with_bots(
  p_room_id UUID,
  p_bot_count INTEGER,
  p_bot_difficulty TEXT DEFAULT 'medium'
)
RETURNS JSON AS $$
DECLARE
  v_room RECORD;
  v_human_count INTEGER;
  v_total_players INTEGER;
  v_coordinator_id UUID;
  v_deck TEXT[];
  v_shuffled_deck TEXT[];
  v_player_hands JSONB;
  v_i INTEGER;
  v_starting_player INTEGER;
  v_bot_indices INTEGER[];
  v_bot_name TEXT;
  v_caller_id UUID;
  v_is_participant BOOLEAN;
  v_unready_count INTEGER;  -- Task #623: count of non-host humans who are not ready
BEGIN
  -- 🔒 SECURITY CHECK: Verify caller is in the room
  v_caller_id := auth.uid();

  IF v_caller_id IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Unauthorized: Must be authenticated'
    );
  END IF;

  -- Check if caller is a participant in the room
  SELECT EXISTS(
    SELECT 1 FROM room_players
    WHERE room_id = p_room_id
    AND user_id = v_caller_id
  ) INTO v_is_participant;

  IF NOT v_is_participant THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Unauthorized: Must be a room participant to start game'
    );
  END IF;

  -- 1. Get room and validate
  SELECT * INTO v_room FROM rooms WHERE id = p_room_id;

  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Room not found',
      'room_id', p_room_id
    );
  END IF;

  IF v_room.status != 'waiting' THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Room is not in waiting status',
      'current_status', v_room.status
    );
  END IF;

  -- 2. Check ranked mode restriction (CRITICAL: Prevent bot injection in ranked games)
  IF v_room.ranked_mode = true AND p_bot_count > 0 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Cannot add bots to ranked games'
    );
  END IF;

  -- 3. Count human players and calculate bot indices
  SELECT COUNT(*) INTO v_human_count
  FROM room_players
  WHERE room_id = p_room_id AND is_bot = false;

  v_total_players := v_human_count + p_bot_count;

  IF v_total_players != 4 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Total players must be 4',
      'human_count', v_human_count,
      'bot_count', p_bot_count
    );
  END IF;

  -- 4. Find coordinator (first human player, i.e. the host)
  SELECT user_id INTO v_coordinator_id
  FROM room_players
  WHERE room_id = p_room_id AND is_bot = false
  ORDER BY joined_at ASC, user_id ASC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'No human players found in room'
    );
  END IF;

  -- 5. CRITICAL SECURITY: Verify caller is the coordinator
  IF v_caller_id IS DISTINCT FROM v_coordinator_id THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Unauthorized: Only the room coordinator can start the game'
    );
  END IF;

  -- 5.5. TASK #623 READY CHECK:
  --      All non-host (non-coordinator), non-bot players must have is_ready = true.
  --      The host/coordinator is the initiator and is implicitly ready.
  --      Bots are always ready and are excluded from this check.
  SELECT COUNT(*) INTO v_unready_count
  FROM room_players
  WHERE room_id = p_room_id
    AND is_bot = false
    AND is_host = false
    AND is_ready = false;

  IF v_unready_count > 0 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Cannot start: ' || v_unready_count || ' player(s) are not ready',
      'unready_count', v_unready_count
    );
  END IF;

  -- 6. Assign bot player_index based on anticlockwise turn order (0→3→2→1→0)
  IF p_bot_count = 1 THEN
    v_bot_indices := ARRAY[3];
  ELSIF p_bot_count = 2 THEN
    v_bot_indices := ARRAY[3, 2];
  ELSIF p_bot_count = 3 THEN
    v_bot_indices := ARRAY[3, 2, 1];
  ELSE
    v_bot_indices := ARRAY[]::INTEGER[];
  END IF;

  -- 7. Create bot players with correct indices and names
  FOR v_i IN 1..p_bot_count LOOP
    v_bot_name := 'Bot ' || (v_i + 1)::TEXT;

    INSERT INTO room_players (
      room_id,
      user_id,
      username,
      is_bot,
      bot_difficulty,
      player_index,
      is_ready
    )
    VALUES (
      p_room_id,
      gen_random_uuid(),
      v_bot_name,
      true,
      p_bot_difficulty,
      v_bot_indices[v_i],
      true
    );
  END LOOP;

  -- 8. Shuffle deck and deal cards
  v_deck := ARRAY[
    'D3','C3','H3','S3','D4','C4','H4','S4','D5','C5','H5','S5',
    'D6','C6','H6','S6','D7','C7','H7','S7','D8','C8','H8','S8',
    'D9','C9','H9','S9','D10','C10','H10','S10','DJ','CJ','HJ','SJ',
    'DQ','CQ','HQ','SQ','DK','CK','HK','SK','DA','CA','HA','SA','D2','C2','H2','S2'
  ];

  -- Fisher-Yates shuffle
  FOR v_i IN REVERSE array_length(v_deck, 1)..2 LOOP
    DECLARE
      v_j INTEGER := floor(random() * v_i + 1)::INTEGER;
      v_temp TEXT := v_deck[v_i];
    BEGIN
      v_deck[v_i] := v_deck[v_j];
      v_deck[v_j] := v_temp;
    END;
  END LOOP;
  v_shuffled_deck := v_deck;

  -- Deal 13 cards to each of the 4 players
  v_player_hands := '{}'::JSONB;
  FOR v_i IN 0..(v_total_players - 1) LOOP
    v_player_hands := v_player_hands || jsonb_build_object(
      v_i::TEXT,
      to_jsonb(v_shuffled_deck[(v_i * 13 + 1):(v_i * 13 + 13)])
    );
  END LOOP;

  -- Find starting player (who has 3♦)
  v_starting_player := NULL;
  FOR v_i IN 0..(v_total_players - 1) LOOP
    IF v_player_hands->v_i::TEXT @> '["D3"]'::jsonb THEN
      v_starting_player := v_i;
      EXIT;
    END IF;
  END LOOP;

  IF v_starting_player IS NULL THEN
    v_starting_player := 0;
  END IF;

  -- 9. UPSERT game_state
  INSERT INTO game_state (
    room_id,
    current_turn,
    hands,
    last_play,
    passes,
    round_number,
    game_phase,
    played_cards,
    match_number,
    play_history,
    auto_pass_timer,
    turn_started_at
  )
  VALUES (
    p_room_id,
    v_starting_player,
    v_player_hands,
    NULL,
    0,
    1,
    'first_play',
    '[]'::JSONB,
    1,
    '[]'::JSONB,
    NULL,
    NOW()
  )
  ON CONFLICT (room_id) DO UPDATE SET
    current_turn    = EXCLUDED.current_turn,
    hands           = EXCLUDED.hands,
    last_play       = EXCLUDED.last_play,
    passes          = EXCLUDED.passes,
    round_number    = EXCLUDED.round_number,
    game_phase      = EXCLUDED.game_phase,
    played_cards    = EXCLUDED.played_cards,
    match_number    = EXCLUDED.match_number,
    play_history    = EXCLUDED.play_history,
    auto_pass_timer = EXCLUDED.auto_pass_timer,
    turn_started_at = NOW(),
    updated_at      = NOW();

  -- 10. Update room status to 'playing'
  UPDATE rooms
  SET status = 'playing', updated_at = NOW()
  WHERE id = p_room_id;

  -- 11. Success
  RETURN json_build_object(
    'success', true,
    'room_id', p_room_id,
    'starting_player', v_starting_player,
    'total_players', v_total_players,
    'bot_indices', v_bot_indices
  );

EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION start_game_with_bots(UUID, INTEGER, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION start_game_with_bots(UUID, INTEGER, TEXT) TO authenticated, service_role;

COMMENT ON FUNCTION start_game_with_bots(UUID, INTEGER, TEXT) IS
  'Start game with bots. Enforces: (1) authenticated caller, (2) caller is coordinator, '
  '(3) all non-host human players are ready (Task #623). '
  'Bot indices follow anticlockwise turn order: 0→3→2→1→0.';

DO $$
BEGIN
  RAISE NOTICE '✅ Migration 20260309000003: Ready check added to start_game_with_bots';
  RAISE NOTICE '   - Non-host, non-bot players must have is_ready = true before game can start';
  RAISE NOTICE '   - turn_started_at is set to NOW() on game creation';
END $$;
