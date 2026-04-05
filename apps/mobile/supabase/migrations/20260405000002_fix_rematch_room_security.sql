-- Migration: 20260405000002_fix_rematch_room_security.sql
--
-- Corrective migration for 20260405000001_play_again_rematch.sql.
--
-- Fixes
-- -----
-- 1. Drop FK on rooms.rematch_for_room_id — a FK to rooms(id) causes the
--    get_or_create_rematch_room INSERT to fail with a foreign key violation
--    when the source room has already been deleted by cleanup_empty_rooms
--    (triggered after the last room_players row is removed by the client).
--    The column is kept as a plain UUID advisory reference.
--
-- 2. REVOKE EXECUTE from PUBLIC — Postgres grants new functions to PUBLIC by
--    default; restrict to authenticated only to match repository security
--    posture.
--
-- 3. Fix search_path — SECURITY DEFINER functions must set
--    `search_path = public, pg_catalog` to prevent pg_catalog shadowing.

-- ── 1. Drop foreign key ────────────────────────────────────────────────────
ALTER TABLE rooms
  DROP CONSTRAINT IF EXISTS rooms_rematch_for_room_id_fkey;

-- ── 2. Revoke public access + re-create function with correct search_path ──
REVOKE EXECUTE ON FUNCTION get_or_create_rematch_room(UUID, UUID, TEXT, BOOLEAN, BOOLEAN, BOOLEAN) FROM PUBLIC;

CREATE OR REPLACE FUNCTION get_or_create_rematch_room(
  p_source_room_id  UUID,
  p_user_id         UUID,
  p_username        TEXT,
  p_is_public       BOOLEAN,
  p_is_matchmaking  BOOLEAN,
  p_ranked_mode     BOOLEAN
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_existing_code   TEXT;
  v_existing_id     UUID;
  v_new_code        TEXT;
  v_new_id          UUID;
  v_join_result     JSONB;
  v_collision_tries INTEGER := 0;
  v_max_retries     INTEGER := 5;
BEGIN
  -- ── Guard: verify caller participated in the source room ───────────────
  -- Prevents abuse of the SECURITY DEFINER function with arbitrary room UUIDs.
  -- game_history persists after cleanup_empty_rooms deletes the source room;
  -- room_players is checked as a fallback for the race where game_history
  -- hasn't been written yet but the source room still exists.
  IF NOT EXISTS (
    SELECT 1 FROM game_history
     WHERE room_id = p_source_room_id
       AND p_user_id IN (player_1_id, player_2_id, player_3_id, player_4_id)
  ) AND NOT EXISTS (
    SELECT 1 FROM room_players
     WHERE room_id = p_source_room_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'get_or_create_rematch_room: user % is not a participant of room %',
      p_user_id, p_source_room_id;
  END IF;

  -- ── A. Fast-path: a rematch room already exists ──────────────────────────
  SELECT id, code
    INTO v_existing_id, v_existing_code
    FROM rooms
   WHERE rematch_for_room_id = p_source_room_id
   LIMIT 1;

  IF FOUND THEN
    -- Another player beat us here — join the room they created.
    -- Propagate the actual is_host from join_room_atomic: in an extreme race
    -- host_id may still be NULL when we call join so the function may
    -- legitimately promote this caller to host.
    v_join_result := join_room_atomic(v_existing_code, p_user_id, p_username);
    RETURN jsonb_build_object(
      'success',    true,
      'room_id',    v_existing_id,
      'room_code',  v_existing_code,
      'is_host',    COALESCE((v_join_result->>'is_host')::BOOLEAN, false)
    );
  END IF;

  -- ── B. No rematch room yet — race to create one ──────────────────────────
  --
  -- The UNIQUE INDEX on rematch_for_room_id ensures that if two callers enter
  -- this branch concurrently, exactly one INSERT succeeds; the other gets a
  -- unique_violation and must fall through to path A.

  LOOP
    v_collision_tries := v_collision_tries + 1;

    BEGIN
      v_new_code := generate_room_code_v2();

      INSERT INTO rooms (
        code, host_id, status, max_players,
        is_public, is_matchmaking, ranked_mode,
        rematch_for_room_id, created_at
      ) VALUES (
        v_new_code, NULL, 'waiting', 4,
        p_is_public, p_is_matchmaking, p_ranked_mode,
        p_source_room_id, NOW()
      )
      RETURNING id INTO v_new_id;

      -- Creator joins as host
      PERFORM join_room_atomic(v_new_code, p_user_id, p_username);

      RETURN jsonb_build_object(
        'success',   true,
        'room_id',   v_new_id,
        'room_code', v_new_code,
        'is_host',   true
      );

    EXCEPTION
      WHEN unique_violation THEN
        -- Either room code collision OR rematch_for_room_id collision (race).
        -- Distinguish the two cases by checking whether the rematch room now
        -- exists (race lost) vs. a plain code collision.
        SELECT id, code
          INTO v_existing_id, v_existing_code
          FROM rooms
         WHERE rematch_for_room_id = p_source_room_id
         LIMIT 1;

        IF FOUND THEN
          -- Race lost: another caller created the rematch room first.
          v_join_result := join_room_atomic(v_existing_code, p_user_id, p_username);
          RETURN jsonb_build_object(
            'success',   true,
            'room_id',   v_existing_id,
            'room_code', v_existing_code,
            'is_host',   COALESCE((v_join_result->>'is_host')::BOOLEAN, false)
          );
        END IF;

        -- Plain room-code collision — retry with a different code.
        IF v_collision_tries >= v_max_retries THEN
          RAISE EXCEPTION 'get_or_create_rematch_room: failed after % collision attempts',
            v_max_retries;
        END IF;
        -- Loop to generate a new code
    END;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_or_create_rematch_room(UUID, UUID, TEXT, BOOLEAN, BOOLEAN, BOOLEAN) TO authenticated;

COMMENT ON FUNCTION public.get_or_create_rematch_room(UUID, UUID, TEXT, BOOLEAN, BOOLEAN, BOOLEAN) IS
  'Atomic Play-Again coordinator. '
  'The first caller creates a new room (is_host=true); all subsequent '
  'callers for the same source_room_id join that room (is_host=false). '
  'Concurrency-safe via a UNIQUE partial index on rematch_for_room_id. '
  'source_room_id is advisory (no FK) so cleanup_empty_rooms cannot '
  'break Play Again by deleting the finished source room first.';
