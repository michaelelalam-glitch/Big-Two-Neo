-- Fix: get_or_create_room created rooms with host_id = NULL
-- This caused the first human join to NOT be marked host (join_room_atomic compares rooms.host_id).
-- Side effects included:
-- - Clients seeing "Only the host can start" in casual rooms
-- - Host-only room cleanup (delete/update) not working reliably

CREATE OR REPLACE FUNCTION get_or_create_room(
  p_user_id UUID,
  p_username TEXT,
  p_is_public BOOLEAN,
  p_is_matchmaking BOOLEAN,
  p_ranked_mode BOOLEAN
) RETURNS JSONB AS $$
DECLARE
  v_room_code TEXT;
  v_room_id UUID;
  v_collision_attempts INTEGER := 0;
  v_max_collisions INTEGER := 5;
BEGIN
  LOOP
    v_collision_attempts := v_collision_attempts + 1;

    BEGIN
      v_room_code := generate_room_code_v2();

      -- IMPORTANT: set host_id at creation time
      INSERT INTO rooms (code, host_id, status, max_players, is_public, is_matchmaking, ranked_mode, created_at)
      VALUES (v_room_code, p_user_id, 'waiting', 4, p_is_public, p_is_matchmaking, p_ranked_mode, NOW())
      RETURNING id INTO v_room_id;

      -- Add the creator to the room
      PERFORM join_room_atomic(v_room_code, p_user_id, p_username);

      RETURN jsonb_build_object(
        'success', true,
        'room_id', v_room_id,
        'room_code', v_room_code,
        'attempts', v_collision_attempts
      );

    EXCEPTION WHEN unique_violation THEN
      IF v_collision_attempts >= v_max_collisions THEN
        RAISE EXCEPTION 'Failed to create room after % collision attempts', v_max_collisions;
      END IF;
    END;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Backfill: existing rooms created with host_id = NULL
-- Choose the first non-bot human in the room (lowest player_index).
WITH host_candidates AS (
  SELECT
    r.id AS room_id,
    (
      SELECT rp.user_id
      FROM room_players rp
      WHERE rp.room_id = r.id
        AND rp.is_bot = false
        AND rp.user_id IS NOT NULL
      ORDER BY rp.player_index ASC
      LIMIT 1
    ) AS host_user_id
  FROM rooms r
  WHERE r.host_id IS NULL
)
UPDATE rooms r
SET host_id = hc.host_user_id
FROM host_candidates hc
WHERE r.id = hc.room_id
  AND hc.host_user_id IS NOT NULL;

-- Normalize room_players.is_host based on rooms.host_id
UPDATE room_players rp
SET is_host = (rp.user_id = r.host_id)
FROM rooms r
WHERE rp.room_id = r.id
  AND r.host_id IS NOT NULL
  AND rp.is_bot = false;

-- Ensure bots never appear as host
UPDATE room_players
SET is_host = false
WHERE is_bot = true;

GRANT EXECUTE ON FUNCTION get_or_create_room TO authenticated;

COMMENT ON FUNCTION get_or_create_room IS
  'Safely creates a new room with guaranteed unique code. Sets host_id to creator to ensure host behavior works for casual rooms.';
