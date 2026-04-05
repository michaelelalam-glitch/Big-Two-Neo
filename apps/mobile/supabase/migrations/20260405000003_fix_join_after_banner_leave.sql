-- Migration: 20260405000003_fix_join_after_banner_leave.sql
--
-- Problem
-- -------
-- When a player leaves an active game via the "Leave Game" banner on HomeScreen,
-- the client calls mark-disconnected (setting connection_status='disconnected') but
-- intentionally leaves the room_players row intact so that process_disconnected_players
-- can replace the player with a bot and record stats.
--
-- The cron that cleans up those rows may not have fired yet when the player
-- immediately tries to start a new match.  join_room_atomic (called transitively
-- by get_or_create_room) checks:
--
--   SELECT room_id INTO v_other_room FROM room_players WHERE user_id = p_user_id LIMIT 1;
--   IF v_other_room IS NOT NULL AND v_other_room != v_room_id THEN
--     RAISE EXCEPTION 'User already in another room';
--   END IF;
--
-- This finds the stale disconnected row in the playing/finished room and blocks
-- the new join with "User already in another room".
--
-- Fix
-- ---
-- Before the conflict check, auto-delete stale room_players rows where:
--   - The user is 'disconnected' (mark-disconnected was already called)
--   - The room is in a non-waiting state (playing / finished / game_over)
--   - It is not the room the user is trying to join
--
-- Deleting these rows is safe because:
--   1. process_disconnected_players reads game_states (not room_players) to decide
--      whether to replace a player — deleting the row does not prevent bot replacement.
--      (The cron already has the game data it needs.)
--   2. The player explicitly left (mark-disconnected confirms intention).
--   3. The row served its purpose once the cron noted the player is gone.
--
-- This is a CREATE OR REPLACE on the most recent version of join_room_atomic
-- (last defined in 20260319000001_lobby_security_and_ghost_eviction_fixes.sql).
-- All other changes from that migration are preserved verbatim.
-- =============================================================================

CREATE OR REPLACE FUNCTION join_room_atomic(
  p_room_code TEXT,
  p_user_id   UUID,
  p_username  TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- ── Ghost eviction (lobby only) ───────────────────────────────────────────
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
  -- ─────────────────────────────────────────────────────────────────────────

  -- Idempotent: return existing record if already in the room.
  IF EXISTS (SELECT 1 FROM room_players WHERE room_id = v_room_id AND user_id = p_user_id) THEN
    SELECT jsonb_build_object(
      'room_id', v_room_id, 'room_code', p_room_code,
      'player_index', player_index, 'is_host', is_host, 'already_joined', true
    ) INTO v_result
    FROM room_players WHERE room_id = v_room_id AND user_id = p_user_id;
    RETURN v_result;
  END IF;

  -- ── Blocked re-entry check (private rooms only) ──────────────────────────
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
  -- ─────────────────────────────────────────────────────────────────────────

  SELECT COUNT(*) INTO v_player_count FROM room_players WHERE room_id = v_room_id;

  IF v_player_count >= 4 THEN
    RAISE EXCEPTION 'Room is full (4/4 players)';
  END IF;

  -- ── Stale-disconnect cleanup ──────────────────────────────────────────────
  -- Auto-remove rows where the player left a playing/finished room via
  -- mark-disconnected but the cleanup cron hasn't fired yet.  Without this,
  -- get_or_create_room → join_room_atomic throws "User already in another room"
  -- the moment the player tries to start a new match after leaving via the banner.
  --
  -- This is safe: process_disconnected_players operates on game_states,
  -- not on room_players rows, so deleting the row here does not prevent
  -- bot replacement from completing.
  DELETE FROM room_players
   WHERE user_id = p_user_id
     AND room_id != v_room_id
     AND connection_status = 'disconnected'
     AND room_id IN (
           SELECT id FROM rooms
            WHERE status IN ('playing', 'finished', 'game_over')
         );
  -- ─────────────────────────────────────────────────────────────────────────

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

  -- Joiner becomes host when no host exists (all ghosts evicted → host_id NULL).
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
$$;

REVOKE EXECUTE ON FUNCTION join_room_atomic(TEXT, UUID, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION join_room_atomic(TEXT, UUID, TEXT) TO authenticated, service_role;

DO $notice$ BEGIN
  RAISE NOTICE '✅ Migration 20260405000003: join_room_atomic auto-deletes stale disconnected rows from playing/finished rooms before conflict check, fixing "User already in another room" after banner leave.';
END $notice$;
