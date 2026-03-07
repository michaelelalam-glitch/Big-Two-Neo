-- ==========================================================================
-- FIX TURN_STARTED_AT ON GAME CREATION
-- ==========================================================================
-- Problem: start_game_with_bots INSERT doesn't include turn_started_at
-- Result: New games have turn_started_at=NULL, breaking turn timer
-- Fix: Add DEFAULT NOW() and update start_game_with_bots function

-- 1. Add DEFAULT NOW() to turn_started_at column
ALTER TABLE game_state 
  ALTER COLUMN turn_started_at SET DEFAULT NOW();

COMMENT ON COLUMN game_state.turn_started_at IS 
  'UTC timestamp when current_turn player''s turn started. Defaults to NOW() on INSERT. Auto-updates on current_turn change via trigger.';

-- 2. Fix start_game_with_bots to explicitly set turn_started_at
-- (Get the most recent version from 20260106000001_fix_bot_turn_order_indices.sql)
CREATE OR REPLACE FUNCTION start_game_with_bots(
  p_room_id UUID,
  p_bot_difficulty TEXT DEFAULT 'medium'
)
RETURNS JSON AS $$
DECLARE
  v_room RECORD;
  v_players RECORD[];
  v_total_players INTEGER;
  v_bots_needed INTEGER;
  v_bot_names TEXT[] := ARRAY['Bot Alice', 'Bot Bob', 'Bot Charlie'];
  v_i INTEGER;
  v_existing_bot RECORD;
  v_bot_player_id UUID;
  
  -- Game state
  v_deck TEXT[];
  v_shuffled_deck TEXT[];
  v_player_hands JSONB := '{}'::JSONB;
  v_starting_player INTEGER;
  v_temp TEXT;
  v_j INTEGER;
BEGIN
  -- 1. Validate room exists
  SELECT * INTO v_room FROM rooms WHERE id = p_room_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Room not found');
  END IF;

  -- 2. Count existing human + bot players
  SELECT COUNT(*) INTO v_total_players 
  FROM room_players 
  WHERE room_id = p_room_id;

  -- 3. Calculate how many bots we need (4-player game)
  v_bots_needed := 4 - v_total_players;
  IF v_bots_needed < 0 THEN
    v_bots_needed := 0;
  END IF;

  -- 4. Create bot users if needed
  IF v_bots_needed > 0 THEN
    FOR v_i IN 1..v_bots_needed LOOP
      DECLARE
        v_bot_username TEXT := v_bot_names[v_i];
        v_bot_user_id UUID;
      BEGIN
        -- Check if bot user already exists (reuse if so)
        SELECT id INTO v_bot_user_id 
        FROM auth.users 
        WHERE raw_user_meta_data->>'username' = v_bot_username
        LIMIT 1;

        IF v_bot_user_id IS NULL THEN
          -- Create new bot user
          INSERT INTO auth.users (
            instance_id,
            id,
            aud,
            role,
            email,
            encrypted_password,
            email_confirmed_at,
            recovery_sent_at,
            last_sign_in_at,
            raw_app_meta_data,
            raw_user_meta_data,
            created_at,
            updated_at,
            confirmation_token,
            email_change,
            email_change_token_new,
            recovery_token
          )
          VALUES (
            '00000000-0000-0000-0000-000000000000',
            gen_random_uuid(),
            'authenticated',
            'authenticated',
            v_bot_username || '@bot.local',
            crypt('bot-password-' || gen_random_uuid()::TEXT, gen_salt('bf')),
            NOW(),
            NOW(),
            NOW(),
            jsonb_build_object('provider', 'bot', 'providers', ARRAY['bot']),
            jsonb_build_object('username', v_bot_username, 'is_bot', true, 'bot_difficulty', p_bot_difficulty),
            NOW(),
            NOW(),
            '',
            '',
            '',
            ''
          )
          RETURNING id INTO v_bot_user_id;
        END IF;

        -- Add bot to room_players
        INSERT INTO room_players (
          id,
          room_id,
          user_id,
          username,
          player_index,
          is_bot,
          bot_difficulty
        )
        VALUES (
          gen_random_uuid(),
          p_room_id,
          v_bot_user_id,
          v_bot_username,
          v_total_players,
          true,
          p_bot_difficulty
        );

        v_total_players := v_total_players + 1;
      END;
    END LOOP;
  END IF;

  -- 5. Reassign player indices (0, 1, 2, 3) after bots added
  v_i := 0;
  FOR v_existing_bot IN 
    SELECT id FROM room_players WHERE room_id = p_room_id ORDER BY created_at ASC
  LOOP
    UPDATE room_players 
    SET player_index = v_i 
    WHERE id = v_existing_bot.id;
    v_i := v_i + 1;
  END LOOP;

  -- 6. Verify we have exactly 4 players now
  SELECT COUNT(*) INTO v_total_players FROM room_players WHERE room_id = p_room_id;
  IF v_total_players != 4 THEN
    RETURN json_build_object(
      'success', false, 
      'error', 'Invalid player count after adding bots',
      'player_count', v_total_players
    );
  END IF;

  -- 7. Shuffle deck and deal cards
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
  
  -- Deal 13 cards to each player - store as JSONB object with player indices as keys
  v_player_hands := '{}'::JSONB;
  FOR v_i IN 0..(v_total_players - 1) LOOP
    v_player_hands := v_player_hands || jsonb_build_object(
      v_i::TEXT,
      to_jsonb(v_shuffled_deck[(v_i * 13 + 1):(v_i * 13 + 13)])
    );
  END LOOP;
  
  -- Find starting player (who has 3 of Diamonds)
  v_starting_player := NULL;
  FOR v_i IN 0..(v_total_players - 1) LOOP
    IF v_player_hands->v_i::TEXT @> '["D3"]'::jsonb THEN
      v_starting_player := v_i;
      EXIT;
    END IF;
  END LOOP;
  
  IF v_starting_player IS NULL THEN
    v_starting_player := 0; -- Fallback
  END IF;
  
  -- 8. UPSERT game_state (✅ NOW INCLUDES turn_started_at)
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
    turn_started_at  -- ✅ ADDED
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
    NOW()  -- ✅ ADDED
  )
  ON CONFLICT (room_id) DO UPDATE SET
    current_turn = EXCLUDED.current_turn,
    hands = EXCLUDED.hands,
    last_play = EXCLUDED.last_play,
    passes = EXCLUDED.passes,
    round_number = EXCLUDED.round_number,
    game_phase = EXCLUDED.game_phase,
    played_cards = EXCLUDED.played_cards,
    match_number = EXCLUDED.match_number,
    play_history = EXCLUDED.play_history,
    auto_pass_timer = EXCLUDED.auto_pass_timer,
    turn_started_at = NOW(),  -- ✅ ADDED
    updated_at = NOW();
  
  -- 9. Update room status to 'playing'
  UPDATE rooms
  SET status = 'playing', updated_at = NOW()
  WHERE id = p_room_id;
  
  -- 10. Success
  RETURN json_build_object(
    'success', true,
    'room_id', p_room_id,
    'starting_player', v_starting_player,
    'total_players', v_total_players,
    'bots_added', v_bots_needed
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION start_game_with_bots IS
  'Creates game_state with proper turn_started_at initialization for turn timer support.';

-- 3. Initialize turn_started_at for any existing games that still have NULL
UPDATE game_state 
SET turn_started_at = NOW()
WHERE turn_started_at IS NULL;

-- Success message
DO $$
BEGIN
  RAISE NOTICE '✅ Turn timer fix applied successfully';
  RAISE NOTICE '   - turn_started_at now has DEFAULT NOW()';
  RAISE NOTICE '   - start_game_with_bots updated to set turn_started_at';
  RAISE NOTICE '   - All existing NULL values initialized';
END $$;
