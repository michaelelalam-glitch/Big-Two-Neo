-- Migration: 20260405000001_play_again_rematch.sql
--
-- Implements truly-atomic "Play Again" coordination so the FIRST human
-- who presses the button becomes the host of the new room, while subsequent
-- callers join that same room — even if two callers hit the server
-- simultaneously.
--
-- Changes
-- -------
-- 1. rooms.rematch_for_room_id  — soft FK + UNIQUE so at most one live
--    rematch room can exist per finished room.  NULL-able so existing rooms
--    are not affected.
-- 2. get_or_create_rematch_room — SECURITY DEFINER RPC invoked by every
--    player who presses "Play Again".  Thanks to the UNIQUE constraint the
--    race is resolved inside the transaction: one caller creates the room
--    (is_host=true) and all others join it (is_host=false).

-- ── 1. Add nullable column ────────────────────────────────────────────────
ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS rematch_for_room_id UUID
    REFERENCES rooms(id) ON DELETE SET NULL;

-- Unique: only one live rematch room per source room.
-- Use a partial unique index instead of a table constraint so we can
-- tolerate NULL (multiple rows with NULL rematch_for_room_id are fine).
CREATE UNIQUE INDEX IF NOT EXISTS rooms_rematch_for_room_id_unique
  ON rooms (rematch_for_room_id)
  WHERE rematch_for_room_id IS NOT NULL;

-- ── 2. Atomic RPC ─────────────────────────────────────────────────────────
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
SET search_path = public
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
  -- ── A. Fast-path: a rematch room already exists ──────────────────────────
  SELECT id, code
    INTO v_existing_id, v_existing_code
    FROM rooms
   WHERE rematch_for_room_id = p_source_room_id
   LIMIT 1;

  IF FOUND THEN
    -- Another player beat us here — join the room they created.
    v_join_result := join_room_atomic(v_existing_code, p_user_id, p_username);
    RETURN jsonb_build_object(
      'success',    true,
      'room_id',    v_existing_id,
      'room_code',  v_existing_code,
      'is_host',    false
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
            'is_host',   false
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

GRANT EXECUTE ON FUNCTION get_or_create_rematch_room TO authenticated;

COMMENT ON FUNCTION get_or_create_rematch_room IS
  'Atomic Play-Again coordinator. '
  'The first caller creates a new room (is_host=true); all subsequent '
  'callers for the same source_room_id join that room (is_host=false). '
  'Concurrency-safe via a UNIQUE partial index on rematch_for_room_id.';
