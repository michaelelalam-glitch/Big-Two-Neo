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

CREATE OR REPLACE FUNCTION public.get_player_game_state(p_room_id UUID)
RETURNS SETOF public.game_state
LANGUAGE plpgsql
SECURITY DEFINER
-- Hardened search_path: empty default prevents object-hijacking via
-- user-controlled schemas. All references below are schema-qualified.
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID;
  v_player_index INT;
  v_row public.game_state%ROWTYPE;
  v_filtered_hands JSONB;
BEGIN
  -- 1. Authenticate
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 2. Verify room membership and get player_index
  SELECT rp.player_index INTO v_player_index
  FROM public.room_players rp
  WHERE rp.room_id = p_room_id AND rp.user_id = v_user_id
  LIMIT 1;

  IF v_player_index IS NULL THEN
    RAISE EXCEPTION 'Not a player in this room';
  END IF;

  -- 3. Fetch raw game state
  SELECT * INTO v_row
  FROM public.game_state gs
  WHERE gs.room_id = p_room_id;

  IF v_row.id IS NULL THEN
    -- No game state exists yet — return empty result set
    RETURN;
  END IF;

  -- 4. Build filtered hands: keep own hand, replace others with placeholders
  --    Placeholder cards preserve array length (so card counts remain accurate)
  --    but hide the actual card identity (suit, rank).
  SELECT COALESCE(
    pg_catalog.jsonb_object_agg(
      key,
      CASE
        WHEN key = v_player_index::text THEN value
        WHEN pg_catalog.jsonb_array_length(value) > 0 THEN
          -- Generate placeholder array of same length
          (SELECT pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object('id', 'hidden_' || i, 'rank', '?', 'suit', '?')
          ) FROM pg_catalog.generate_series(0, pg_catalog.jsonb_array_length(value) - 1) AS i)
        ELSE '[]'::jsonb
      END
    ),
    '{}'::jsonb
  ) INTO v_filtered_hands
  FROM pg_catalog.jsonb_each(v_row.hands) AS kv(key, value);

  -- 5. Replace hands with filtered version
  v_row.hands := v_filtered_hands;

  RETURN NEXT v_row;
END;
$$;

-- Restrict RPC execution to authenticated users only.
-- REVOKE is required because functions are executable by PUBLIC by default.
REVOKE EXECUTE ON FUNCTION public.get_player_game_state(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_player_game_state(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_player_game_state(UUID) TO authenticated;

COMMENT ON FUNCTION public.get_player_game_state(UUID) IS
  'C1 Fix: Returns game_state with only the requesting player''s hand visible. '
  'Other players'' hands are replaced with placeholder arrays preserving card counts. '
  'NOTE: The game_state SELECT RLS policy still exists for Realtime change notifications; '
  'Sprint 2 should migrate to broadcast or a separate notification table to fully close '
  'the raw-payload cheating vector.';
