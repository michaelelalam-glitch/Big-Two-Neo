-- ============================================================================
-- MIGRATION: Add missing columns and implement critical Big Two game rules
-- ============================================================================
-- Date: February 28, 2026
--
-- Context: Integration tests (critical-rules.test.ts, username-uniqueness) were
-- failing because:
--   1. game_state was missing passes_in_row and last_player columns
--      (execute_pass_move UPDATE referenced them → runtime error)
--   2. execute_pass_move had NO check for "cannot pass when leading"
--   3. execute_play_move had NO check for "first play must include 3♦"
--   4. join_room_atomic accepted empty/blank usernames
--
-- Changes:
--   1. ALTER TABLE: add passes_in_row, last_player columns
--   2. execute_pass_move: add "cannot pass when leading" rule
--   3. execute_play_move: add "first play must include 3♦" rule + game_phase transition
--   4. join_room_atomic: add empty username validation
--
-- Applied to project dppybucldqufbqhwnkxu via mcp_supabase_execute_sql
-- ============================================================================

-- 1. Add missing columns that execute_pass_move references
ALTER TABLE game_state ADD COLUMN IF NOT EXISTS passes_in_row INTEGER DEFAULT 0;
ALTER TABLE game_state ADD COLUMN IF NOT EXISTS last_player INTEGER;

-- 2. execute_pass_move — add "cannot pass when leading" rule
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
  -- Anticlockwise turn order: 0→3, 1→2, 2→0, 3→1
  v_turn_order INTEGER[] := ARRAY[3, 2, 0, 1];
BEGIN
  SELECT id INTO v_room_id FROM rooms WHERE code = p_room_code;
  IF v_room_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Room not found');
  END IF;

  SELECT * INTO v_game_state FROM game_state WHERE room_id = v_room_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Game state not found');
  END IF;

  SELECT * INTO v_player FROM room_players WHERE id = p_player_id AND room_id = v_room_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Player not found');
  END IF;

  -- SECURITY: auth.uid() is NULL for service_role calls (intentional bypass)
  IF v_player.user_id != auth.uid() THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Unauthorized: You can only pass for your own player'
    );
  END IF;

  IF v_game_state.current_turn != v_player.player_index THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Not your turn',
      'current_turn', v_game_state.current_turn,
      'your_index', v_player.player_index
    );
  END IF;

  -- ✅ RULE: Cannot pass when leading (last_play IS NULL = you start the trick)
  IF v_game_state.last_play IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Cannot pass when leading - you must play cards'
    );
  END IF;

  v_next_turn := v_turn_order[v_player.player_index + 1];
  v_new_pass_count := COALESCE(v_game_state.passes, 0) + 1;

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
  'Executes a pass move with auth.uid() validation and leading-trick rule enforcement.';

-- 3. execute_play_move — add "first play must include 3♦" rule
CREATE OR REPLACE FUNCTION execute_play_move(
  p_room_code TEXT,
  p_player_id UUID,
  p_cards JSONB
)
RETURNS JSON AS $$
DECLARE
  v_room_id UUID;
  v_game_state RECORD;
  v_player RECORD;
  v_player_hand JSONB;
  v_new_hand JSONB;
  v_next_turn INTEGER;
  v_card JSONB;
BEGIN
  SELECT id INTO v_room_id FROM rooms WHERE code = p_room_code;
  IF v_room_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Room not found');
  END IF;

  SELECT * INTO v_game_state FROM game_state WHERE room_id = v_room_id FOR UPDATE NOWAIT;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Game state not found');
  END IF;

  SELECT * INTO v_player FROM room_players WHERE id = p_player_id AND room_id = v_room_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Player not found');
  END IF;

  -- SECURITY: Verify caller owns this player seat.
  -- auth.uid() is NULL for service_role calls (intentional bypass for auto-pass).
  IF v_player.user_id != auth.uid() THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Unauthorized: You can only play for your own player'
    );
  END IF;

  IF v_game_state.current_turn != v_player.player_index THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Not your turn',
      'current_turn', v_game_state.current_turn,
      'your_index', v_player.player_index
    );
  END IF;

  -- ✅ RULE: First play must include the 3 of Diamonds
  IF v_game_state.game_phase = 'first_play' THEN
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_cards) AS card
      WHERE card->>'suit' = 'D' AND card->>'rank' = '3'
    ) THEN
      RETURN json_build_object(
        'success', false,
        'error', 'First play must include the 3 of Diamonds'
      );
    END IF;
  END IF;

  v_player_hand := v_game_state.hands->v_player.player_index::text;

  -- SECURITY: Validate every card in p_cards exists in the player's hand.
  -- Prevents fabricated or duplicate card IDs from being injected.
  DECLARE
    v_played_card JSONB;
  BEGIN
    FOR v_played_card IN SELECT * FROM jsonb_array_elements(p_cards)
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_player_hand) AS hand_card
        WHERE hand_card->>'id' = v_played_card->>'id'
      ) THEN
        RETURN json_build_object(
          'success', false,
          'error', 'Card not in hand: ' || (v_played_card->>'id')
        );
      END IF;
    END LOOP;
  END;

  v_new_hand := '[]'::jsonb;
  FOR v_card IN SELECT * FROM jsonb_array_elements(v_player_hand)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_cards) AS played
      WHERE played->>'id' = v_card->>'id'
    ) THEN
      v_new_hand := v_new_hand || jsonb_build_array(v_card);
    END IF;
  END LOOP;

  v_next_turn := CASE
    WHEN v_game_state.current_turn = 0 THEN 3
    ELSE v_game_state.current_turn - 1
  END;

  UPDATE game_state
  SET
    hands = jsonb_set(hands, ARRAY[v_player.player_index::text], v_new_hand),
    last_play = jsonb_build_object(
      'player_index', v_player.player_index,
      'cards', p_cards
    ),
    current_turn = v_next_turn,
    passes = 0,
    played_cards = COALESCE(played_cards, '[]'::jsonb) || p_cards,
    game_phase = CASE WHEN game_phase = 'first_play' THEN 'playing' ELSE game_phase END,
    updated_at = NOW()
  WHERE room_id = v_room_id;

  IF jsonb_array_length(v_new_hand) = 0 THEN
    UPDATE game_state
    SET game_phase = 'finished'
    WHERE room_id = v_room_id;

    RETURN json_build_object(
      'success', true,
      'game_finished', true,
      'winner_index', v_player.player_index
    );
  END IF;

  RETURN json_build_object(
    'success', true,
    'next_turn', v_next_turn,
    'cards_remaining', jsonb_array_length(v_new_hand)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION execute_play_move IS
  'Executes a play move with 3-of-Diamonds first-play rule and game_phase transitions.';

-- 4. join_room_atomic — add empty username validation
CREATE OR REPLACE FUNCTION join_room_atomic(
  p_room_code TEXT,
  p_user_id UUID,
  p_username TEXT
)
RETURNS JSONB AS $$
DECLARE
  v_room_id UUID;
  v_player_count INTEGER;
  v_player_index INTEGER;
  v_is_host BOOLEAN;
  v_host_id UUID;
  v_room_status TEXT;
  v_result JSONB;
  v_existing_username TEXT;
  v_other_room UUID;
BEGIN
  -- ✅ Validate username is not empty or blank
  IF p_username IS NULL OR length(trim(p_username)) = 0 THEN
    RAISE EXCEPTION 'Username cannot be empty';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('join_room_atomic'), hashtext(UPPER(p_room_code)));

  SELECT username INTO v_existing_username
  FROM room_players
  WHERE user_id = p_user_id
  LIMIT 1;

  IF v_existing_username IS NOT NULL AND LOWER(v_existing_username) != LOWER(p_username) THEN
    IF NOT (v_existing_username LIKE 'Player_%') THEN
      RAISE EXCEPTION 'You already have username "%". You cannot change your username.', v_existing_username;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM room_players
    WHERE LOWER(username) = LOWER(p_username)
      AND user_id != p_user_id
  ) THEN
    RAISE EXCEPTION 'Username "%" is already taken by another user', p_username;
  END IF;

  SELECT id, status, host_id INTO v_room_id, v_room_status, v_host_id
  FROM rooms
  WHERE code = UPPER(p_room_code);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room not found: %', p_room_code;
  END IF;

  IF v_room_status NOT IN ('waiting', 'playing') THEN
    RAISE EXCEPTION 'Room is not accepting players (status: %)', v_room_status;
  END IF;

  SELECT COUNT(*) INTO v_player_count
  FROM room_players
  WHERE room_id = v_room_id;

  IF v_player_count >= 4 THEN
    RAISE EXCEPTION 'Room is full (4/4 players)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM room_players
    WHERE room_id = v_room_id AND user_id = p_user_id
  ) THEN
    SELECT jsonb_build_object(
      'room_id', v_room_id,
      'room_code', p_room_code,
      'player_index', player_index,
      'is_host', is_host,
      'already_joined', true
    ) INTO v_result
    FROM room_players
    WHERE room_id = v_room_id AND user_id = p_user_id;

    RETURN v_result;
  END IF;

  SELECT room_id INTO v_other_room
  FROM room_players
  WHERE user_id = p_user_id
  LIMIT 1;

  IF v_other_room IS NOT NULL AND v_other_room != v_room_id THEN
    RAISE EXCEPTION 'User already in another room';
  END IF;

  SELECT i INTO v_player_index
  FROM generate_series(0, 3) AS i
  WHERE NOT EXISTS (
    SELECT 1 FROM room_players rp
    WHERE rp.room_id = v_room_id AND rp.player_index = i
  )
  ORDER BY i
  LIMIT 1;

  IF v_player_index IS NULL THEN
    RAISE EXCEPTION 'Room is full (no available positions)';
  END IF;

  v_is_host := (v_host_id = p_user_id);

  INSERT INTO room_players(
    room_id,
    user_id,
    username,
    player_index,
    is_host,
    is_ready,
    is_bot
  ) VALUES (
    v_room_id,
    p_user_id,
    p_username,
    v_player_index,
    v_is_host,
    false,
    false
  );

  RETURN jsonb_build_object(
    'room_id', v_room_id,
    'room_code', p_room_code,
    'player_index', v_player_index,
    'is_host', v_is_host,
    'already_joined', false
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION join_room_atomic IS
  'Thread-safe room join with row-level locking, global username uniqueness, and input validation.';
