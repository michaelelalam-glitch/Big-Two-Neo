#!/bin/bash

# Direct SQL execution to Supabase
# This fixes the JSON double-encoding bug in execute_play_move

echo "🚀 Applying migration: fix_execute_play_move_json_encoding..."

# Create a temp SQL file with the function
cat > /tmp/fix_migration.sql << 'EOF'
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
  v_current_hands JSONB;
  v_player_hand JSONB;
  v_new_hand JSONB;
  v_combo_type TEXT;
  v_next_turn INTEGER;
  v_card JSONB;
BEGIN
  SELECT id INTO v_room_id FROM rooms WHERE code = p_room_code;
  
  IF v_room_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Room not found');
  END IF;
  
  SELECT * INTO v_game_state FROM game_state WHERE room_id = v_room_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Game state not found');
  END IF;
  
  SELECT * INTO v_player FROM room_players WHERE id = p_player_id AND room_id = v_room_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Player not found in room');
  END IF;
  
  IF v_game_state.current_turn != v_player.player_index THEN
    RETURN json_build_object(
      'success', false, 
      'error', 'Not your turn',
      'current_turn', v_game_state.current_turn,
      'your_index', v_player.player_index
    );
  END IF;
  
  v_current_hands := v_game_state.hands;
  v_player_hand := v_current_hands->v_player.player_index::TEXT;
  
  v_new_hand := '[]'::JSONB;
  FOR v_card IN SELECT jsonb_array_elements(v_player_hand)
  LOOP
    IF NOT (p_cards @> jsonb_build_array(v_card->>'id')) THEN
      v_new_hand := v_new_hand || jsonb_build_array(v_card);
    END IF;
  END LOOP;
  
  v_current_hands := jsonb_set(v_current_hands, ARRAY[v_player.player_index::TEXT], v_new_hand);
  
  v_next_turn := (v_player.player_index + 1) % 4;
  
  CASE jsonb_array_length(p_cards)
    WHEN 1 THEN v_combo_type := 'Single';
    WHEN 2 THEN v_combo_type := 'Pair';
    WHEN 3 THEN v_combo_type := 'Triple';
    WHEN 5 THEN v_combo_type := 'Five Card';
    ELSE v_combo_type := 'Unknown';
  END CASE;
  
  UPDATE game_state
  SET
    hands = v_current_hands,
    current_turn = v_next_turn,
    last_play = jsonb_build_object(
      'position', v_player.player_index,
      'cards', p_cards,
      'combo_type', v_combo_type
    ),
    pass_count = 0,
    auto_pass_timer = NULL,
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
EOF

# Apply using curl to Supabase REST API
response=$(curl -s -X POST \
  'https://dppybucldqufbqhwnkxu.supabase.co/rest/v1/rpc/exec' \
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwcHlidWNsZHF1ZmJxaHdua3h1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzQyNjE0NTQsImV4cCI6MjA0OTgzNzQ1NH0.YbL3z3C0uSXNHDOjhKL_3BsCYJrNv5F9FTKlD0iMV7k" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwcHlidWNsZHF1ZmJxaHdua3h1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzQyNjE0NTQsImV4cCI6MjA0OTgzNzQ1NH0.YbL3z3C0uSXNHDOjhKL_3BsCYJrNv5F9FTKlD0iMV7k" \
  -H "Content-Type: application/json" \
  -d "{\"query\": $(cat /tmp/fix_migration.sql | jq -Rs .)}")

echo "$response"

if echo "$response" | grep -q "error"; then
  echo "❌ Migration failed"
  exit 1
else
  echo "✅ Migration applied successfully!"
  echo ""
  echo "🔧 IMPORTANT: You must START A NEW GAME to see the fix!"
  echo "The existing game has corrupted data in the database."
  echo "Create a new room and start a fresh game to test the fix."
fi

rm /tmp/fix_migration.sql
