-- Migration: 20260406000001_fix_rematch_room_cleanup.sql
--
-- Problem
-- -------
-- Play Again ("get_or_create_rematch_room") always fails with:
--   "user is not a participant of room <uuid>"
--
-- Root cause chain:
--   1. complete-game edge function inserts into game_history (room_id = source_room_id)
--   2. complete-game deletes ALL room_players rows for the room (Step 3b)
--   3. trigger_cleanup_empty_rooms fires AFTER the last room_players DELETE
--   4. It sees player_count=0 and deletes the room (DELETE FROM rooms WHERE id = ...)
--   5. FK: game_history.room_id REFERENCES rooms(id) ON DELETE SET NULL
--        → game_history.room_id is set to NULL
--   6. get_or_create_rematch_room RPC fallback:
--        SELECT 1 FROM game_history
--         WHERE room_id = p_source_room_id        ← NULL ≠ UUID → no rows found
--           AND p_user_id IN (player_1_id, ...)
--      → fails → RAISE EXCEPTION "not a participant"
--
-- Fix
-- ---
-- Modify cleanup_empty_rooms to skip rooms whose status is 'finished' or 'game_over'.
-- complete-game marks the room 'finished' BEFORE deleting room_players, so the trigger
-- will no longer delete the room when the last player row is removed after a normal
-- game completion.
--
-- These tombstone rooms (status='finished', 0 players) are eventually deleted by
-- the existing cleanup_abandoned_rooms cron (handles completed rooms older than 30 days).
--
-- This is a CREATE OR REPLACE on cleanup_empty_rooms (last defined in baseline).
-- All other behaviour is preserved verbatim.
-- =============================================================================

CREATE OR REPLACE FUNCTION cleanup_empty_rooms()
RETURNS TRIGGER AS $$
DECLARE
  v_player_count INTEGER;
  v_room_status TEXT;
BEGIN
  -- Get room status DIRECTLY from rooms table (separate query, not via JOIN).
  -- Using a JOIN+GROUP BY on room_players returns no rows when count=0,
  -- which leaves v_room_status NULL and would bypass the status guard.
  SELECT status INTO v_room_status
  FROM rooms
  WHERE id = OLD.room_id;

  -- Rooms in terminal completion states are kept as tombstones:
  --   get_or_create_rematch_room verifies membership via game_history.room_id.
  --   If the room is deleted, the FK sets game_history.room_id=NULL and
  --   the fallback lookup fails → "user is not a participant" error.
  --   Tombstone rooms are cleaned up by cleanup_abandoned_rooms (30-day retention).
  IF v_room_status IN ('finished', 'game_over') THEN
    RETURN OLD;
  END IF;

  -- Count remaining players
  SELECT COUNT(*) INTO v_player_count
  FROM room_players
  WHERE room_id = OLD.room_id;

  -- If the room is gone already (race condition) or has no players, delete it
  IF v_room_status IS NULL OR v_player_count = 0 THEN
    DELETE FROM rooms WHERE id = OLD.room_id;
    RAISE NOTICE 'Auto-deleted empty room: %', OLD.room_id;
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_empty_rooms IS
  'Automatically deletes empty rooms when the last player leaves. '
  'Rooms with status=finished/game_over are kept as tombstones for rematch lookup '
  'and cleaned up by cleanup_abandoned_rooms after 30 days.';

-- =============================================================================
-- Fix 2: get_or_create_rematch_room — RLS bypass + correct host_id
-- =============================================================================
-- Problem: postgres is NOT a superuser on Supabase, so SECURITY DEFINER does
-- NOT bypass RLS. The INSERT into rooms had host_id = NULL, which violates
-- the RLS INSERT policy (host_id = auth.uid()). Additionally, SET LOCAL
-- row_security = off is needed because postgres owns the table but isn't super.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_or_create_rematch_room(
  p_source_room_id uuid,
  p_user_id uuid,
  p_username text,
  p_is_public boolean,
  p_is_matchmaking boolean,
  p_ranked_mode boolean
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_existing_code   TEXT;
  v_existing_id     UUID;
  v_new_code        TEXT;
  v_new_id          UUID;
  v_join_result     JSONB;
  v_collision_tries INTEGER := 0;
  v_max_retries     INTEGER := 5;
BEGIN
  -- Bypass RLS for this transaction (postgres is not superuser on Supabase)
  SET LOCAL row_security = off;

  -- ── Guard: p_user_id must match the authenticated caller ──────────────
  IF auth.uid() IS NOT NULL AND p_user_id != auth.uid() THEN
    RAISE EXCEPTION 'get_or_create_rematch_room: p_user_id does not match authenticated user';
  END IF;

  -- ── Guard + atomic source-room cleanup ────────────────────────────────
  IF EXISTS (
    SELECT 1 FROM room_players
     WHERE room_id = p_source_room_id AND user_id = p_user_id
  ) THEN
    DELETE FROM room_players
     WHERE room_id = p_source_room_id AND user_id = p_user_id;
  ELSIF NOT EXISTS (
    SELECT 1 FROM game_history
     WHERE room_id = p_source_room_id
       AND p_user_id IN (player_1_id, player_2_id, player_3_id, player_4_id)
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
    v_join_result := join_room_atomic(v_existing_code, p_user_id, p_username);
    RETURN jsonb_build_object(
      'success',    true,
      'room_id',    v_existing_id,
      'room_code',  v_existing_code,
      'is_host',    COALESCE((v_join_result->>'is_host')::BOOLEAN, false)
    );
  END IF;

  -- ── B. No rematch room yet — race to create one ──────────────────────────
  LOOP
    v_collision_tries := v_collision_tries + 1;

    BEGIN
      v_new_code := generate_room_code_v2();

      INSERT INTO rooms (
        code, host_id, status, max_players,
        is_public, is_matchmaking, ranked_mode,
        rematch_for_room_id, created_at
      ) VALUES (
        v_new_code, p_user_id, 'waiting', 4,
        p_is_public, p_is_matchmaking, p_ranked_mode,
        p_source_room_id, NOW()
      )
      RETURNING id INTO v_new_id;

      PERFORM join_room_atomic(v_new_code, p_user_id, p_username);

      RETURN jsonb_build_object(
        'success',   true,
        'room_id',   v_new_id,
        'room_code', v_new_code,
        'is_host',   true
      );

    EXCEPTION
      WHEN unique_violation THEN
        SELECT id, code
          INTO v_existing_id, v_existing_code
          FROM rooms
         WHERE rematch_for_room_id = p_source_room_id
         LIMIT 1;

        IF FOUND THEN
          v_join_result := join_room_atomic(v_existing_code, p_user_id, p_username);
          RETURN jsonb_build_object(
            'success',   true,
            'room_id',   v_existing_id,
            'room_code', v_existing_code,
            'is_host',   COALESCE((v_join_result->>'is_host')::BOOLEAN, false)
          );
        END IF;

        IF v_collision_tries >= v_max_retries THEN
          RAISE EXCEPTION 'get_or_create_rematch_room: failed after % collision attempts',
            v_max_retries;
        END IF;
    END;
  END LOOP;
END;
$function$;

COMMENT ON FUNCTION get_or_create_rematch_room IS
  'Atomically creates or joins a rematch room for Play Again. '
  'SET LOCAL row_security = off bypasses RLS (postgres is not superuser on Supabase). '
  'host_id is set to p_user_id to satisfy the RLS INSERT policy as a fallback.';

-- =============================================================================
-- Fix 3: join_room_atomic — RLS bypass for rooms UPDATE
-- =============================================================================
-- Problem: join_room_atomic does UPDATE rooms SET host_id = p_user_id when a
-- new host is assigned (e.g. after ghost eviction). The UPDATE RLS policy
-- requires auth.uid() = host_id, which fails when the current host was evicted
-- and host_id is NULL. Same root cause: postgres isn't superuser.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.join_room_atomic(p_room_code text, p_user_id uuid, p_username text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_room_id       UUID;
  v_player_count  INTEGER;
  v_player_index  INTEGER;
  v_is_host       BOOLEAN;
  v_host_id       UUID;
  v_room_status   TEXT;
  v_result        JSONB;
  v_existing_username TEXT;
  v_other_room    UUID;
  v_ghost_threshold CONSTANT INTERVAL := INTERVAL '60 seconds';
BEGIN
  -- Bypass RLS for this transaction (postgres is not superuser on Supabase)
  SET LOCAL row_security = off;

  -- Security: caller must be who they say they are.
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'join_room_atomic: JWT uid does not match p_user_id';
  END IF;

  -- Username null/blank guard.
  IF p_username IS NULL OR length(trim(p_username)) = 0 THEN
    RAISE EXCEPTION 'Username cannot be blank';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('join_room_atomic'), hashtext(UPPER(p_room_code)));

  -- Username consistency guard.
  SELECT username INTO v_existing_username
    FROM room_players WHERE user_id = p_user_id LIMIT 1;

  IF v_existing_username IS NOT NULL AND LOWER(v_existing_username) != LOWER(p_username) THEN
    IF NOT (v_existing_username LIKE 'Player_%') THEN
      RAISE EXCEPTION 'You already have username "%". You cannot change your username.', v_existing_username;
    END IF;
  END IF;

  -- Global username uniqueness.
  IF EXISTS (
    SELECT 1 FROM room_players
    WHERE LOWER(username) = LOWER(p_username)
      AND user_id != p_user_id
  ) THEN
    RAISE EXCEPTION 'Username "%" is already taken by another user', p_username;
  END IF;

  SELECT id, status, host_id
    INTO v_room_id, v_room_status, v_host_id
    FROM rooms
   WHERE code = UPPER(p_room_code);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room not found: %', p_room_code;
  END IF;

  IF v_room_status NOT IN ('waiting', 'playing') THEN
    RAISE EXCEPTION 'Room is not accepting players (status: %)', v_room_status;
  END IF;

  -- Ghost eviction (lobby only)
  IF v_room_status = 'waiting' THEN
    DELETE FROM room_players
     WHERE room_id      = v_room_id
       AND is_bot       = FALSE
       AND user_id     IS NOT NULL
       AND user_id     != p_user_id
       AND (last_seen_at IS NULL OR last_seen_at < NOW() - v_ghost_threshold);

    SELECT host_id INTO v_host_id FROM rooms WHERE id = v_room_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Room was cleaned up after ghost eviction — all players were stale';
    END IF;
  END IF;

  -- Idempotent: return existing record if already in the room.
  IF EXISTS (SELECT 1 FROM room_players WHERE room_id = v_room_id AND user_id = p_user_id) THEN
    SELECT jsonb_build_object(
      'room_id', v_room_id, 'room_code', p_room_code,
      'player_index', player_index, 'is_host', is_host, 'already_joined', true
    ) INTO v_result
    FROM room_players WHERE room_id = v_room_id AND user_id = p_user_id;
    RETURN v_result;
  END IF;

  -- Blocked re-entry check (private rooms only)
  IF EXISTS (
    SELECT 1
      FROM rooms
     WHERE id            = v_room_id
       AND COALESCE(is_matchmaking, FALSE) = FALSE
       AND (is_public IS NULL OR is_public = FALSE)
       AND p_user_id     = ANY(COALESCE(banned_user_ids, '{}'))
  ) THEN
    RAISE EXCEPTION 'You have been kicked from this private room and cannot rejoin';
  END IF;

  SELECT COUNT(*) INTO v_player_count FROM room_players WHERE room_id = v_room_id;

  IF v_player_count >= 4 THEN
    RAISE EXCEPTION 'Room is full (4/4 players)';
  END IF;

  -- Stale-disconnect cleanup
  DELETE FROM room_players
   WHERE user_id = p_user_id
     AND room_id != v_room_id
     AND connection_status = 'disconnected'
     AND room_id IN (
           SELECT id FROM rooms
            WHERE status IN ('playing', 'finished', 'game_over')
         );

  SELECT room_id INTO v_other_room FROM room_players WHERE user_id = p_user_id LIMIT 1;
  IF v_other_room IS NOT NULL AND v_other_room != v_room_id THEN
    RAISE EXCEPTION 'User already in another room';
  END IF;

  SELECT i INTO v_player_index
    FROM generate_series(0, 3) AS i
   WHERE NOT EXISTS (
     SELECT 1 FROM room_players rp WHERE rp.room_id = v_room_id AND rp.player_index = i
   )
   ORDER BY i LIMIT 1;

  IF v_player_index IS NULL THEN
    RAISE EXCEPTION 'Room is full (no available positions)';
  END IF;

  -- Joiner becomes host when no host exists (all ghosts evicted -> host_id NULL).
  v_is_host := (v_host_id IS NULL OR v_host_id = p_user_id);

  INSERT INTO room_players(room_id, user_id, username, player_index, is_host, is_ready, is_bot, last_seen_at)
  VALUES (v_room_id, p_user_id, p_username, v_player_index, v_is_host, false, false, NOW());

  IF v_is_host THEN
    UPDATE rooms SET host_id = p_user_id WHERE id = v_room_id;
  END IF;

  RETURN jsonb_build_object(
    'room_id', v_room_id, 'room_code', p_room_code,
    'player_index', v_player_index, 'is_host', v_is_host, 'already_joined', false
  );
END;
$function$;

COMMENT ON FUNCTION join_room_atomic IS
  'Joins a player to a room with ghost eviction, slot assignment, and host promotion. '
  'SET LOCAL row_security = off bypasses RLS (postgres is not superuser on Supabase).';

-- ── Permissions: revoke public access, grant to authenticated only ──────────────
-- Postgres grants EXECUTE to PUBLIC for new functions by default; revoke it so
-- anonymous (anon role) clients cannot call these SECURITY DEFINER RPCs directly.
REVOKE EXECUTE ON FUNCTION public.get_or_create_rematch_room(UUID, UUID, TEXT, BOOLEAN, BOOLEAN, BOOLEAN) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_or_create_rematch_room(UUID, UUID, TEXT, BOOLEAN, BOOLEAN, BOOLEAN) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.join_room_atomic(TEXT, UUID, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.join_room_atomic(TEXT, UUID, TEXT) TO authenticated;
