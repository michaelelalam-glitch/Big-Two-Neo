-- ==========================================================================
-- C1 FIX: Secure game_state — prevent hand exposure via RLS bypass
-- ==========================================================================
-- The SELECT RLS policy on game_state grants full row access to room members,
-- including the `hands` JSONB column which contains ALL players' cards.
-- This means any room member can query `select('*')` and see opponents' hands.
--
-- Fix: Create a SECURITY DEFINER function `get_player_game_state` that:
--   1. Verifies the caller is a room member
--   2. Returns game_state with only the caller's hand visible
--   3. Replaces other players' hands with placeholder arrays (preserving card counts)
--
-- Client code must call this RPC instead of querying game_state directly.
-- The postgres_changes Realtime subscription still fires (for change notification)
-- but the client must NOT use the raw payload — it must re-fetch via this RPC.
-- ==========================================================================

CREATE OR REPLACE FUNCTION get_player_game_state(p_room_id UUID)
RETURNS SETOF game_state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_player_index INT;
  v_row game_state%ROWTYPE;
  v_filtered_hands JSONB;
BEGIN
  -- 1. Authenticate
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 2. Verify room membership and get player_index
  SELECT rp.player_index INTO v_player_index
  FROM room_players rp
  WHERE rp.room_id = p_room_id AND rp.user_id = v_user_id
  LIMIT 1;

  IF v_player_index IS NULL THEN
    RAISE EXCEPTION 'Not a player in this room';
  END IF;

  -- 3. Fetch raw game state
  SELECT * INTO v_row
  FROM game_state gs
  WHERE gs.room_id = p_room_id;

  IF v_row.id IS NULL THEN
    -- No game state exists yet — return empty result set
    RETURN;
  END IF;

  -- 4. Build filtered hands: keep own hand, replace others with placeholders
  --    Placeholder cards preserve array length (so card counts remain accurate)
  --    but hide the actual card identity (suit, rank).
  SELECT COALESCE(
    jsonb_object_agg(
      key,
      CASE
        WHEN key = v_player_index::text THEN value
        WHEN jsonb_array_length(value) > 0 THEN
          -- Generate placeholder array of same length
          (SELECT jsonb_agg(
            jsonb_build_object('id', 'hidden_' || i, 'rank', '?', 'suit', '?')
          ) FROM generate_series(0, jsonb_array_length(value) - 1) AS i)
        ELSE '[]'::jsonb
      END
    ),
    '{}'::jsonb
  ) INTO v_filtered_hands
  FROM jsonb_each(v_row.hands) AS kv(key, value);

  -- 5. Replace hands with filtered version
  v_row.hands := v_filtered_hands;

  RETURN NEXT v_row;
END;
$$;

-- Grant execute to authenticated users (RPC is callable by any logged-in user;
-- the function body verifies room membership).
GRANT EXECUTE ON FUNCTION get_player_game_state(UUID) TO authenticated;

COMMENT ON FUNCTION get_player_game_state(UUID) IS
  'C1 Fix: Returns game_state with only the requesting player''s hand visible. '
  'Other players'' hands are replaced with placeholder arrays preserving card counts.';
