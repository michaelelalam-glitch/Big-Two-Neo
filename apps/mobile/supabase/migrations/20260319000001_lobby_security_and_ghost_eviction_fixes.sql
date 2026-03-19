-- =============================================================================
-- Migration: lobby_security_and_ghost_eviction_fixes
-- Date: 2026-03-19
--
-- Fixes two user-facing bugs:
--
--   BUG 1 — Re-enter lobby: duplicate key on room_players_room_id_position_key
--     Root cause: join_room_atomic lacked SECURITY DEFINER in prod (the function
--     was overwritten or the earlier migration was not applied in the correct order).
--     Ghost-eviction
--     DELETE inside the function was blocked by RLS (policy: auth.uid()=user_id),
--     so stale ghost rows were never removed. Their occupied positions caused a
--     UNIQUE constraint violation when the same user tried to rejoin.
--     Also: NULL last_seen_at rows (from old code paths) never matched the
--     "< NOW()-60s" threshold, so they were permanently stuck.
--     Also: when ALL players were ghosts, cleanup_empty_rooms trigger deleted
--     the room before INSERT, causing FK violations (room not found).
--
--   BUG 2 — Disconnect kick not working after 60s
--     Root cause: lobby_evict_ghosts did not exist in the DB — it was defined
--     in a migration file (20260318000003) whose version number was lower than
--     the last applied migration (20260318120901), so Supabase never ran it.
--     Also: NULL last_seen_at rows were never evicted.
--
-- Copilot PR-153 review comments addressed:
--   #1/#2 — join_room_atomic not SECURITY DEFINER (ghost eviction + host_id UPDATE blocked by RLS)
--   #3    — lobby_kick_player missing constraints (waiting-only, non-bot, non-host)
--   #4    — lobby_host_leave broken reindex order (DELETE host row FIRST)
--   #5    — update_player_heartbeat accepts spoofable p_user_id
--   #6    — lobby_evict_ghosts: NULL last_seen_at rows + membership check
--   #7    — lobby_claim_host: membership check (info-leak prevention)
--            + demotion-safety: only demote ghost host after confirming caller eligible
--
-- REPLICA IDENTITY:
--   The previous migration applied REPLICA IDENTITY FULL which increases WAL
--   volume. The room_players_realtime_idx unique index already covers
--   (room_id, player_index). Switch to REPLICA IDENTITY USING INDEX so only
--   those two columns are replicated for DELETE events (sufficient for the
--   room_id=eq.X Realtime filter).
-- =============================================================================

-- Ensure the unique index exists before switching REPLICA IDENTITY so this
-- migration is self-contained on environments where migration
-- 20260318000002 was not applied (e.g. skipped due to version ordering).
CREATE UNIQUE INDEX IF NOT EXISTS room_players_realtime_idx
  ON room_players (room_id, player_index);

-- Switch to index-based REPLICA IDENTITY (lower WAL overhead than FULL).
-- room_players_realtime_idx is UNIQUE NOT NULL on (room_id, player_index).
ALTER TABLE room_players REPLICA IDENTITY USING INDEX room_players_realtime_idx;

-- =============================================================================
-- join_room_atomic — SECURITY DEFINER + auth.uid() guard
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
  -- service_role (Edge Functions / admin) may call with auth.uid() = NULL;
  -- allow those through since they are already trusted.  Normal authenticated
  -- callers must match the JWT uid to prevent impersonation.
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
  -- SECURITY DEFINER allows DELETE of other users' rows (bypasses RLS policy
  -- "FOR DELETE USING (auth.uid() = user_id)").
  -- NULL last_seen_at rows are treated as infinitely stale (legacy rows from
  -- code paths that pre-date the DEFAULT NOW() column addition).
  IF v_room_status = 'waiting' THEN
    DELETE FROM room_players
     WHERE room_id      = v_room_id
       AND is_bot       = FALSE
       AND user_id     IS NOT NULL
       AND user_id     != p_user_id
       AND (last_seen_at IS NULL OR last_seen_at < NOW() - v_ghost_threshold);

    -- Refresh host_id: check_host_departure trigger may have promoted a new host.
    SELECT host_id INTO v_host_id FROM rooms WHERE id = v_room_id;

    -- After eviction the cleanup_empty_rooms trigger may have deleted the room
    -- if ALL players were stale. Re-check before proceeding to avoid FK violation.
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Room was cleaned up after ghost eviction — all players were stale';
    END IF;
  END IF;
  -- ─────────────────────────────────────────────────────────────────────────

  -- Idempotent: return existing record if already in the room.
  -- Must run BEFORE the capacity check so a user who is already seated in a
  -- full (4/4) room does not receive a spurious "Room is full" error on retry
  -- (e.g. after a network error triggers a client-side re-call).
  IF EXISTS (SELECT 1 FROM room_players WHERE room_id = v_room_id AND user_id = p_user_id) THEN
    SELECT jsonb_build_object(
      'room_id', v_room_id, 'room_code', p_room_code,
      'player_index', player_index, 'is_host', is_host, 'already_joined', true
    ) INTO v_result
    FROM room_players WHERE room_id = v_room_id AND user_id = p_user_id;
    RETURN v_result;
  END IF;

  SELECT COUNT(*) INTO v_player_count FROM room_players WHERE room_id = v_room_id;

  IF v_player_count >= 4 THEN
    RAISE EXCEPTION 'Room is full (4/4 players)';
  END IF;

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
  -- SECURITY DEFINER lets us UPDATE rooms.host_id even when host_id IS NULL
  -- (RLS UPDATE policy "host_id = auth.uid()" would fail for NULL host_id).
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

-- =============================================================================
-- lobby_host_leave — DELETE host row FIRST (prevents UNIQUE constraint violation)
-- =============================================================================
CREATE OR REPLACE FUNCTION lobby_host_leave(
  p_room_id         UUID,
  p_leaving_user_id UUID
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_host        BOOLEAN;
  v_new_host_id    UUID;
  v_remaining_id   UUID;
  v_room_status    TEXT;
  v_index          INT := 0;
BEGIN
  -- Security: reject calls where the JWT uid doesn't match the supplied user_id.
  IF auth.uid() IS DISTINCT FROM p_leaving_user_id THEN
    RAISE EXCEPTION 'lobby_host_leave: JWT uid does not match supplied user_id';
  END IF;

  SELECT is_host INTO v_is_host
    FROM room_players
   WHERE room_id = p_room_id AND user_id = p_leaving_user_id;

  IF NOT FOUND OR v_is_host IS NOT TRUE THEN
    RAISE EXCEPTION 'lobby_host_leave: user % is not the host of room %',
      p_leaving_user_id, p_room_id;
  END IF;

  -- Waiting-lobby guard: block calls on in-progress games to prevent
  -- room_players reindexing / deletion from corrupting active game state.
  SELECT status INTO v_room_status FROM rooms WHERE id = p_room_id;
  IF NOT FOUND OR v_room_status != 'waiting' THEN
    RAISE EXCEPTION 'lobby_host_leave: room is not in waiting state (status: %)',
      COALESCE(v_room_status, 'not found');
  END IF;

  SELECT user_id INTO v_new_host_id
    FROM room_players
   WHERE room_id = p_room_id
     AND user_id != p_leaving_user_id
     AND is_bot   = FALSE
     AND user_id IS NOT NULL
   ORDER BY player_index
   LIMIT 1;

  IF v_new_host_id IS NOT NULL THEN
    -- Promote next human as host.
    UPDATE room_players SET is_host = TRUE
     WHERE room_id = p_room_id AND user_id = v_new_host_id;

    -- Transfer host ownership in rooms table.
    UPDATE rooms SET host_id = v_new_host_id WHERE id = p_room_id;

    -- DELETE the leaving host's row FIRST.
    -- Freeing the host's player_index slot prevents UNIQUE constraint violations
    -- in the re-index step: the freed index can now be safely assigned to another
    -- player without colliding with the (still-present) host row.
    DELETE FROM room_players
     WHERE room_id = p_room_id AND user_id = p_leaving_user_id;

    -- Re-index remaining players (gapless, starting from 0).
    FOR v_remaining_id IN
      SELECT id FROM room_players WHERE room_id = p_room_id ORDER BY player_index
    LOOP
      UPDATE room_players SET player_index = v_index WHERE id = v_remaining_id;
      v_index := v_index + 1;
    END LOOP;
  ELSE
    -- No other human players — delete the room entirely (cascade clears room_players).
    DELETE FROM rooms WHERE id = p_room_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION lobby_host_leave(UUID, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION lobby_host_leave(UUID, UUID) TO authenticated;

-- =============================================================================
-- lobby_kick_player — constraints + auth.uid() guard
-- =============================================================================
CREATE OR REPLACE FUNCTION lobby_kick_player(
  p_room_id         UUID,
  p_kicker_user_id  UUID,
  p_kicked_user_id  UUID
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_host        BOOLEAN;
  v_room_status    TEXT;
  v_kicked_is_bot  BOOLEAN;
  v_kicked_is_host BOOLEAN;
BEGIN
  -- Security: prevent impersonation via spoofed kicker id.
  IF auth.uid() IS DISTINCT FROM p_kicker_user_id THEN
    RAISE EXCEPTION 'lobby_kick_player: JWT uid does not match supplied kicker_user_id';
  END IF;

  -- Only allow kicking in a waiting lobby (not during active games).
  SELECT status INTO v_room_status FROM rooms WHERE id = p_room_id;
  IF NOT FOUND OR v_room_status != 'waiting' THEN
    RAISE EXCEPTION 'lobby_kick_player: can only kick players in a waiting lobby (status: %)',
      COALESCE(v_room_status, 'not found');
  END IF;

  -- Kicker must be the room host.
  SELECT is_host INTO v_is_host
    FROM room_players
   WHERE room_id = p_room_id AND user_id = p_kicker_user_id;

  IF NOT FOUND OR v_is_host IS NOT TRUE THEN
    RAISE EXCEPTION 'lobby_kick_player: user % is not the host of room %',
      p_kicker_user_id, p_room_id;
  END IF;

  IF p_kicker_user_id = p_kicked_user_id THEN
    RAISE EXCEPTION 'lobby_kick_player: host cannot kick themselves';
  END IF;

  -- Target must exist and be a non-bot, non-host human.
  SELECT is_bot, is_host INTO v_kicked_is_bot, v_kicked_is_host
    FROM room_players
   WHERE room_id = p_room_id AND user_id = p_kicked_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'lobby_kick_player: target player not found in room %', p_room_id;
  END IF;
  IF v_kicked_is_bot THEN
    RAISE EXCEPTION 'lobby_kick_player: cannot kick a bot';
  END IF;
  IF v_kicked_is_host THEN
    RAISE EXCEPTION 'lobby_kick_player: cannot kick the host';
  END IF;

  DELETE FROM room_players WHERE room_id = p_room_id AND user_id = p_kicked_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION lobby_kick_player(UUID, UUID, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION lobby_kick_player(UUID, UUID, UUID) TO authenticated;

-- =============================================================================
-- update_player_heartbeat — validate auth.uid() == p_user_id
-- Prevents fake heartbeats keeping ghost players alive indefinitely.
-- =============================================================================
CREATE OR REPLACE FUNCTION update_player_heartbeat(
  p_room_id UUID,
  p_user_id UUID
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'update_player_heartbeat: JWT uid does not match p_user_id';
  END IF;

  UPDATE room_players
     SET last_seen_at      = NOW(),
         connection_status = 'connected',
         disconnected_at   = NULL
   WHERE room_id = p_room_id
     AND user_id = p_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION update_player_heartbeat(UUID, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION update_player_heartbeat(UUID, UUID) TO authenticated;

-- =============================================================================
-- lobby_evict_ghosts — CREATE (was missing from DB)
-- Called by LobbyScreen every 15 seconds. Without this function the disconnect
-- kick never fires regardless of how long a player has been offline.
-- Membership check prevents arbitrary authenticated users from triggering
-- deletions in rooms they don't belong to.
-- NULL last_seen_at rows are treated as infinitely stale.
-- =============================================================================
CREATE OR REPLACE FUNCTION lobby_evict_ghosts(
  p_room_id UUID
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ghost_threshold CONSTANT INTERVAL := INTERVAL '60 seconds';
  v_evicted INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'lobby_evict_ghosts: not authenticated';
  END IF;

  -- Caller must be a current member of the room.
  IF NOT EXISTS (
    SELECT 1 FROM room_players
     WHERE room_id = p_room_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'lobby_evict_ghosts: caller is not a member of room %', p_room_id;
  END IF;

  -- Only evict from waiting lobbies (not during active games).
  IF NOT EXISTS (
    SELECT 1 FROM rooms WHERE id = p_room_id AND status = 'waiting'
  ) THEN
    RETURN 0;
  END IF;

  DELETE FROM room_players
   WHERE room_id = p_room_id
     AND is_bot   = FALSE
     AND user_id IS NOT NULL
     AND user_id != auth.uid()
     AND (last_seen_at IS NULL OR last_seen_at < NOW() - v_ghost_threshold);

  GET DIAGNOSTICS v_evicted = ROW_COUNT;
  RETURN v_evicted;
END;
$$;

REVOKE EXECUTE ON FUNCTION lobby_evict_ghosts(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION lobby_evict_ghosts(UUID) TO authenticated;

-- =============================================================================
-- lobby_claim_host — membership check + demotion safety
-- =============================================================================
CREATE OR REPLACE FUNCTION lobby_claim_host(
  p_room_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id       UUID    := auth.uid();
  v_current_host    RECORD;
  v_first_human     RECORD;
  v_ghost_threshold CONSTANT INTERVAL := INTERVAL '45 seconds';
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'lobby_claim_host: not authenticated';
  END IF;

  -- Membership check: prevents information leak to non-members.
  IF NOT EXISTS (
    SELECT 1 FROM room_players
     WHERE room_id = p_room_id AND user_id = v_caller_id
  ) THEN
    RAISE EXCEPTION 'lobby_claim_host: caller is not a member of room %', p_room_id;
  END IF;

  SELECT user_id, last_seen_at INTO v_current_host
    FROM room_players
   WHERE room_id = p_room_id AND is_host = TRUE
   LIMIT 1;

  IF FOUND THEN
    IF v_current_host.user_id = v_caller_id THEN
      RETURN jsonb_build_object('status', 'already_host');
    END IF;
    IF v_current_host.last_seen_at IS NOT NULL AND
       v_current_host.last_seen_at > NOW() - v_ghost_threshold THEN
      RETURN jsonb_build_object('status', 'active_host_exists', 'host_id', v_current_host.user_id);
    END IF;
    -- Ghost host detected. Defer demotion until caller eligibility confirmed.
  END IF;

  SELECT user_id, player_index INTO v_first_human
    FROM room_players
   WHERE room_id = p_room_id AND is_bot = FALSE AND user_id IS NOT NULL
   ORDER BY player_index LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'no_humans');
  END IF;

  IF v_first_human.user_id IS DISTINCT FROM v_caller_id THEN
    -- Caller is not the first human — do NOT demote the ghost host;
    -- this prevents leaving the room with no host at all.
    RETURN jsonb_build_object('status', 'not_first_human', 'first_human_id', v_first_human.user_id);
  END IF;

  -- Caller IS eligible: safe to demote ghost host (if one was found above).
  IF v_current_host.user_id IS NOT NULL AND v_current_host.user_id != v_caller_id THEN
    UPDATE room_players SET is_host = FALSE
     WHERE room_id = p_room_id AND user_id = v_current_host.user_id;
  END IF;

  UPDATE room_players SET is_host = TRUE WHERE room_id = p_room_id AND user_id = v_caller_id;
  UPDATE rooms SET host_id = v_caller_id WHERE id = p_room_id;
  RETURN jsonb_build_object('status', 'claimed');
END;
$$;

REVOKE EXECUTE ON FUNCTION lobby_claim_host(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION lobby_claim_host(UUID) TO authenticated;

DO $$
BEGIN
  RAISE NOTICE '✅ Migration 20260319000001: join_room_atomic SECURITY DEFINER + NULL ghost fix + post-eviction room check; lobby_host_leave DELETE-first reindex; lobby_kick_player constraints + auth guard; update_player_heartbeat auth guard; lobby_evict_ghosts created (was missing from DB); lobby_claim_host membership check + demotion safety; REPLICA IDENTITY switched from FULL to INDEX.';
END $$;
