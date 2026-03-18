-- =============================================================================
-- Migration: fix_lobby_host_leave_reindex_and_ghost_players
-- Date: March 18, 2026
-- Addresses: Copilot PR-153 review comments from commit 2ae66af (11:26 UTC)
--
-- 1. UNIQUE constraint violation fix (r2952721833)
--    lobby_host_leave was re-indexing remaining players BEFORE deleting the
--    leaving host's row.  When any remaining player was assigned the host's
--    current player_index (e.g. 0), Postgres raised:
--      duplicate key value violates unique constraint
--      "room_players_room_id_position_key"
--    Fix: DELETE the leaving host row FIRST, then re-index remaining players.
--    This frees the host's slot so no intermediate state can collide.
--
-- 2. REPLICA IDENTITY overhead fix (r2952721870)
--    REPLICA IDENTITY FULL replicates every column in WAL for DELETE events,
--    significantly increasing WAL volume on busy lobbies.  We only need
--    room_id in the DELETE record so the Realtime filter `room_id=eq.X` can
--    match.  A stable-named unique index on (room_id, player_index) covers
--    this: both columns are NOT NULL, so it qualifies for USING INDEX mode.
--
-- 3. lobby_claim_host RPC (supports LobbyScreen fallback fix)
--    Atomically promotes the first human to host when no is_host=true row
--    exists, or when the current host is a ghost (last_seen_at > 45 s stale).
--    Previously the client only mutated the local player array, enabling
--    host-only UI controls that fail server-side on every action.
--
-- 4. Ghost player / seat-squatting fix
--    Players who crash or background the app without calling lobby_host_leave
--    leave ghost rows in room_players with stale last_seen_at.  Two-pronged fix:
--      a. join_room_atomic evicts stale non-bot lobby players (last_seen_at
--         > 60 s) before the capacity check, freeing their seats for new joiners.
--         (LobbyScreen now sends a heartbeat every 15 s — see client change.)
--      b. lobby_claim_host detects and demotes ghost hosts, allowing the next
--         human to take over without an admin action.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. REPLICA IDENTITY — switch FULL → USING INDEX (r2952721870)
-- ---------------------------------------------------------------------------
-- For REPLICA IDENTITY USING INDEX all indexed columns must be NOT NULL.
-- room_id and player_index are semantically mandatory (a room_player row
-- always belongs to a room and always has an assigned position), so we add
-- explicit NOT NULL constraints before creating the index.
ALTER TABLE room_players
  ALTER COLUMN room_id     SET NOT NULL,
  ALTER COLUMN player_index SET NOT NULL;

-- Drop the legacy auto-generated unique constraints so the new predictably-named
-- index below is the only unique enforcement on (room_id, player_index).
-- The constraint name depends on history: 'room_players_room_id_position_key'
-- on the live DB (column was originally called 'position'), or
-- 'room_players_room_id_player_index_key' on fresh installs.
ALTER TABLE room_players DROP CONSTRAINT IF EXISTS room_players_room_id_position_key;
ALTER TABLE room_players DROP CONSTRAINT IF EXISTS room_players_room_id_player_index_key;

-- Create a predictably-named unique index that serves both uniqueness and
-- REPLICA IDENTITY.  No redundant constraint overhead.
CREATE UNIQUE INDEX IF NOT EXISTS room_players_realtime_idx
  ON room_players(room_id, player_index);

ALTER TABLE room_players REPLICA IDENTITY USING INDEX room_players_realtime_idx;

-- ---------------------------------------------------------------------------
-- 2. lobby_host_leave — fixed re-index order (r2952721833)
-- ---------------------------------------------------------------------------
-- DELETE the leaving host FIRST, then re-index remaining rows.
-- Previously the re-index loop ran while the host row still existed, causing
-- a UNIQUE constraint violation when another player was assigned the freed index.
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
  v_index          INT := 0;
BEGIN
  -- Security: reject calls where the JWT uid doesn't match the supplied user_id.
  IF auth.uid() IS DISTINCT FROM p_leaving_user_id THEN
    RAISE EXCEPTION 'lobby_host_leave: JWT uid does not match supplied user_id';
  END IF;

  -- Validate: caller must be the room's host.
  SELECT is_host
    INTO v_is_host
    FROM room_players
   WHERE room_id = p_room_id
     AND user_id = p_leaving_user_id;

  IF NOT FOUND OR v_is_host IS NOT TRUE THEN
    RAISE EXCEPTION 'lobby_host_leave: user % is not the host of room %',
      p_leaving_user_id, p_room_id;
  END IF;

  -- Find the next human player (lowest player_index, excluding the leaving host).
  SELECT user_id
    INTO v_new_host_id
    FROM room_players
   WHERE room_id = p_room_id
     AND user_id != p_leaving_user_id
     AND is_bot   = FALSE
     AND user_id IS NOT NULL
   ORDER BY player_index
   LIMIT 1;

  IF v_new_host_id IS NOT NULL THEN
    -- a. Promote next human as host in room_players.
    UPDATE room_players
       SET is_host = TRUE
     WHERE room_id = p_room_id
       AND user_id = v_new_host_id;

    -- b. Transfer host ownership in rooms table.
    UPDATE rooms
       SET host_id = v_new_host_id
     WHERE id = p_room_id;

    -- c. DELETE the leaving host's row FIRST.
    --    Freeing the host's player_index slot prevents UNIQUE constraint
    --    violations in the re-index step below: the freed index can now be
    --    safely assigned to another player without colliding.
    DELETE FROM room_players
     WHERE room_id = p_room_id
       AND user_id = p_leaving_user_id;

    -- d. Re-index remaining players (all rows, gapless, starting from 0).
    FOR v_remaining_id IN
      SELECT id
        FROM room_players
       WHERE room_id = p_room_id
       ORDER BY player_index
    LOOP
      UPDATE room_players
         SET player_index = v_index
       WHERE id = v_remaining_id;
      v_index := v_index + 1;
    END LOOP;

  ELSE
    -- No other human players — delete the room entirely.
    -- room_players rows are cleaned up by ON DELETE CASCADE on rooms.
    DELETE FROM rooms WHERE id = p_room_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION lobby_host_leave(UUID, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION lobby_host_leave(UUID, UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. lobby_claim_host — atomic ghost-host detection & self-promotion
-- ---------------------------------------------------------------------------
-- Called by LobbyScreen when loadPlayers detects no active host.  Atomically:
--   • Returns 'already_host'       — caller is already the host (no-op).
--   • Returns 'active_host_exists' — a live host is present; rejected.
--   • Demotes ghost host (last_seen_at > 45 s) then promotes caller when they
--     are the lowest-player_index human.
--   • Returns 'not_first_human'    — caller is not the eligible promotee.
--   • Returns 'claimed'            — promotion succeeded.
CREATE OR REPLACE FUNCTION lobby_claim_host(
  p_room_id UUID
) RETURNS jsonb
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

  -- Inspect current host state.
  SELECT user_id, last_seen_at
    INTO v_current_host
    FROM room_players
   WHERE room_id = p_room_id
     AND is_host = TRUE
   LIMIT 1;

  IF FOUND THEN
    -- Caller is already marked as host in the DB — no-op.
    IF v_current_host.user_id = v_caller_id THEN
      RETURN jsonb_build_object('status', 'already_host');
    END IF;

    -- A live (non-ghost) host exists — reject the claim.
    IF v_current_host.last_seen_at > NOW() - v_ghost_threshold THEN
      RETURN jsonb_build_object(
        'status',   'active_host_exists',
        'host_id',  v_current_host.user_id
      );
    END IF;

    -- Ghost host detected — we will demote after confirming the caller is
    -- eligible, so we don't leave the room host-less on early returns.
  END IF;

  -- Caller must be the first human (lowest player_index) to claim host.
  SELECT user_id, player_index
    INTO v_first_human
    FROM room_players
   WHERE room_id = p_room_id
     AND is_bot   = FALSE
     AND user_id IS NOT NULL
   ORDER BY player_index
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'no_humans');
  END IF;

  IF v_first_human.user_id IS DISTINCT FROM v_caller_id THEN
    RETURN jsonb_build_object(
      'status',          'not_first_human',
      'first_human_id',  v_first_human.user_id
    );
  END IF;

  -- Caller is confirmed as the first human — now demote the ghost host.
  IF v_current_host.user_id IS NOT NULL THEN
    UPDATE room_players
       SET is_host = FALSE
     WHERE room_id = p_room_id
       AND user_id = v_current_host.user_id;
  END IF;

  -- Promote caller to host in both tables.
  UPDATE room_players
     SET is_host = TRUE
   WHERE room_id = p_room_id
     AND user_id = v_caller_id;

  UPDATE rooms
     SET host_id = v_caller_id
   WHERE id = p_room_id;

  RETURN jsonb_build_object('status', 'claimed');
END;
$$;

REVOKE EXECUTE ON FUNCTION lobby_claim_host(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION lobby_claim_host(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. join_room_atomic — evict ghost lobby players before capacity check
-- ---------------------------------------------------------------------------
-- Players who crash / background the app without leaving accumulate as ghosts
-- with stale last_seen_at, occupying seats that real players cannot take.
-- Solution: before the capacity check, DELETE non-bot real-user rows in a
-- waiting lobby whose last_seen_at is older than 60 seconds.  The existing
-- AFTER DELETE trigger (check_host_departure → reassign_next_host) handles
-- host promotion automatically if a ghost host is evicted.
--
-- LobbyScreen sends an update_player_heartbeat call every 15 s, so active
-- players will never have a last_seen_at older than 60 s under normal operation.
--
-- Also: add a banned_user_ids UUID[] column to rooms so lobby_kick_player
-- can record kicked players and join_room_atomic can block re-entry in private
-- rooms (see also migration_006).
ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS banned_user_ids UUID[] DEFAULT '{}' NOT NULL;
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
  -- Security: reject calls where the JWT uid doesn't match p_user_id.
  -- This also enables SECURITY DEFINER so ghost eviction can DELETE other
  -- users' stale room_players rows (blocked by RLS in the caller's role).
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'join_room_atomic: JWT uid does not match p_user_id';
  END IF;

  -- Username null/blank validation (restored — prevents NULL/empty usernames
  -- from bypassing downstream username-uniqueness checks).
  IF p_username IS NULL OR length(trim(p_username)) = 0 THEN
    RAISE EXCEPTION 'Username cannot be blank';
  END IF;

  -- Serialize joins per-room without requiring UPDATE privileges on rooms.
  PERFORM pg_advisory_xact_lock(hashtext('join_room_atomic'), hashtext(UPPER(p_room_code)));

  -- Username consistency guard.
  SELECT username INTO v_existing_username
  FROM room_players
  WHERE user_id = p_user_id
  LIMIT 1;

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

  -- Fetch room (advisory lock replaces SELECT FOR UPDATE to avoid UPDATE-RLS failures).
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

  -- ── Ghost eviction (lobby only) ────────────────────────────────────────────
  -- Remove stale non-bot players from a waiting lobby so their seats are freed
  -- for new joiners.  The joiner themselves is never evicted.  The
  -- check_host_departure trigger fires automatically for each deleted row and
  -- calls reassign_next_host when a ghost host is among the evicted rows.
  --
  -- last_seen_at IS NULL is treated as infinitely stale (covers players inserted
  -- via old code paths that pre-date the DEFAULT NOW() column addition).
  IF v_room_status = 'waiting' THEN
    DELETE FROM room_players
     WHERE room_id      = v_room_id
       AND is_bot       = FALSE
       AND user_id     IS NOT NULL
       AND user_id     != p_user_id
       AND (last_seen_at IS NULL OR last_seen_at < NOW() - v_ghost_threshold);

    -- Refresh host_id: the trigger may have promoted a new host after eviction.
    SELECT host_id INTO v_host_id FROM rooms WHERE id = v_room_id;

    -- After eviction the cleanup_empty_rooms trigger may have deleted the room
    -- if ALL players were stale. Re-check before proceeding.
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Room was cleaned up after ghost eviction — all players were stale';
    END IF;
  END IF;
  -- ─────────────────────────────────────────────────────────────────────────

  -- ── Blocked re-entry check (private rooms only) ──────────────────────────
  -- Players kicked by the host in a private room are recorded in
  -- rooms.banned_user_ids by lobby_kick_player (see migration_006).
  -- Block their re-entry here; casual/ranked rooms allow free re-entry.
  IF p_user_id = ANY(
    SELECT unnest(COALESCE(banned_user_ids, '{}'))
      FROM rooms
     WHERE id = v_room_id
       AND is_matchmaking = FALSE
       AND (is_public IS NULL OR is_public = FALSE)
  ) THEN
    RAISE EXCEPTION 'You have been kicked from this private room and cannot rejoin';
  END IF;
  -- ─────────────────────────────────────────────────────────────────────────

  SELECT COUNT(*) INTO v_player_count
  FROM room_players
  WHERE room_id = v_room_id;

  IF v_player_count >= 4 THEN
    RAISE EXCEPTION 'Room is full (4/4 players)';
  END IF;

  -- Idempotent: if user is already in the room return their existing record.
  IF EXISTS (
    SELECT 1 FROM room_players
    WHERE room_id = v_room_id AND user_id = p_user_id
  ) THEN
    SELECT jsonb_build_object(
      'room_id',       v_room_id,
      'room_code',     p_room_code,
      'player_index',  player_index,
      'is_host',       is_host,
      'already_joined', true
    ) INTO v_result
    FROM room_players
    WHERE room_id = v_room_id AND user_id = p_user_id;

    RETURN v_result;
  END IF;

  -- Prevent joining while in a different room.
  SELECT room_id INTO v_other_room
  FROM room_players
  WHERE user_id = p_user_id
  LIMIT 1;

  IF v_other_room IS NOT NULL AND v_other_room != v_room_id THEN
    RAISE EXCEPTION 'User already in another room';
  END IF;

  -- Find first available position 0..3.
  SELECT i INTO v_player_index
  FROM generate_series(0, 3) AS i
  WHERE NOT EXISTS (
    SELECT 1 FROM room_players rp
    WHERE rp.room_id = v_room_id AND rp.player_index = i
  )
  ORDER BY i
  LIMIT 1;

  IF v_player_index IS NULL THEN
    RAISE EXCEPTION 'Room is full (no available positions)';
  END IF;

  -- Determine host status: joiner is host when rooms.host_id is NULL (all
  -- ghosts evicted) or rooms.host_id already points to this user.
  v_is_host := (v_host_id IS NULL OR v_host_id = p_user_id);

  -- Insert player with current timestamp as initial heartbeat.
  INSERT INTO room_players(
    room_id, user_id, username, player_index,
    is_host, is_ready, is_bot, last_seen_at
  ) VALUES (
    v_room_id, p_user_id, p_username, v_player_index,
    v_is_host, false, false, NOW()
  );

  -- Sync rooms.host_id when this player becomes host.
  IF v_is_host THEN
    UPDATE rooms
       SET host_id = p_user_id
     WHERE id = v_room_id;
  END IF;

  RETURN jsonb_build_object(
    'room_id',       v_room_id,
    'room_code',     p_room_code,
    'player_index',  v_player_index,
    'is_host',       v_is_host,
    'already_joined', false
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION join_room_atomic(TEXT, UUID, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION join_room_atomic(TEXT, UUID, TEXT) TO authenticated, service_role;

COMMENT ON FUNCTION join_room_atomic IS
  'Atomically join a room by code. Evicts ghost lobby players (last_seen_at > 60 s) '
  'before the capacity check, freeing seats for new joiners.';

COMMENT ON FUNCTION lobby_host_leave IS
  'Atomically transfer host and remove leaving host. DELETE the host row first so '
  'the freed player_index slot cannot cause a UNIQUE constraint violation during re-index.';

COMMENT ON FUNCTION lobby_claim_host IS
  'Promote the first human to host when no active host exists, or when the current '
  'host is a ghost (last_seen_at stale > 45 s). Called by LobbyScreen fallback.';

DO $$
BEGIN
  RAISE NOTICE '✅ Migration 20260318000002 applied: lobby_host_leave reindex fix, REPLICA IDENTITY USING INDEX, ghost-player eviction, lobby_claim_host RPC.';
END $$;
