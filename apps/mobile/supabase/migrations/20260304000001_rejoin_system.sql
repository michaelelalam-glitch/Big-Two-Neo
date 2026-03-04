-- ============================================================================
-- REJOIN SYSTEM MIGRATION
-- Branch: fix/rejoin
-- Date: 2026-03-04
--
-- Overview
-- --------
-- Implements a fully server-side 60-second rejoin / bot-replacement system:
--
--   1. When a player stops heartbeating the DB marks them 'disconnected'
--      after HEARTBEAT_SLACK (30 s) without touching the client.
--   2. process_disconnected_players() replaces them with a bot 60 s after
--      disconnected_at is stamped.
--   3. The displaced human can reclaim their seat at any time while a game is
--      still running.
--   4. Special rules:
--        • Ranked mode  → replacement bot is always 'hard'
--        • 1 human left → close room instead of replacing
--        • Offline rooms → skip all timers (game pauses)
-- ============================================================================

-- ============================================================================
-- STEP 0: Enable pg_cron (needs superuser; no-op if already enabled)
-- ============================================================================
DO $$
BEGIN
  -- Attempt to enable pg_cron, but ignore errors if privileges are insufficient.
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  EXCEPTION
    WHEN OTHERS THEN
      -- On Supabase and other managed setups, this often requires superuser privileges.
      -- Later logic already tolerates pg_cron being unavailable, so we can safely continue.
      NULL;
  END;
END;
$$;

-- ============================================================================
-- STEP 1: Schema additions
-- ============================================================================

-- human_user_id: original auth.uid() preserved when a bot takes the seat.
--   Used so the human can find their displaced slot and reclaim it.
ALTER TABLE public.room_players
  ADD COLUMN IF NOT EXISTS human_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- replaced_username: clean username before the "Bot " prefix is prepended.
ALTER TABLE public.room_players
  ADD COLUMN IF NOT EXISTS replaced_username VARCHAR(100);

-- Store the host-chosen difficulty inside rooms.settings so the server can
-- look it up without joining other tables.
-- (Populated by start_game_with_bots update below — no schema change needed
--  since rooms.settings is already JSONB.)

-- Index to quickly find players pending bot-replacement.
CREATE INDEX IF NOT EXISTS idx_room_players_pending_replacement
  ON public.room_players (room_id, disconnected_at)
  WHERE connection_status = 'disconnected';

-- Index to quickly find stale heartbeats (missed heartbeat detection).
CREATE INDEX IF NOT EXISTS idx_room_players_last_seen
  ON public.room_players (room_id, last_seen_at)
  WHERE connection_status = 'connected' AND is_bot = FALSE;

-- ============================================================================
-- STEP 2: Trigger to persist bot_difficulty into rooms.settings on game start
--
-- The existing start_game_with_bots function sets bot_difficulty on each
-- room_players row. This trigger copies it into rooms.settings so
-- process_disconnected_players can look it up when there are no bots yet.
-- ============================================================================
CREATE OR REPLACE FUNCTION public._sync_bot_difficulty_to_room_settings()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_difficulty TEXT;
BEGIN
  -- Only act when room transitions to 'playing'
  IF NEW.status = 'playing' AND (OLD.status IS DISTINCT FROM 'playing') THEN
    -- Read difficulty from any existing bot player in this room
    SELECT bot_difficulty INTO v_difficulty
    FROM   public.room_players
    WHERE  room_id = NEW.id AND is_bot = TRUE
    LIMIT  1;

    IF v_difficulty IS NOT NULL THEN
      NEW.settings := COALESCE(NEW.settings, '{}'::JSONB)
                      || jsonb_build_object('bot_difficulty', v_difficulty);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_bot_difficulty ON public.rooms;
CREATE TRIGGER trg_sync_bot_difficulty
  BEFORE UPDATE OF status ON public.rooms
  FOR EACH ROW
  EXECUTE FUNCTION public._sync_bot_difficulty_to_room_settings();

-- ============================================================================
-- STEP 3: process_disconnected_players()
--
-- Called every ~10 seconds via pg_cron.
-- Two-phase sweep:
--   Phase A – Mark 'connected' players as 'disconnected' when their
--             heartbeat has been silent for more than 30 s.
--             (Skipped for offline rooms and bot players.)
--   Phase B – Replace 'disconnected' players with bots when disconnected_at
--             is > 60 s ago.
--             Special rules: ranked → hard bot; sole human → close room.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.process_disconnected_players()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  -- tunables
  HEARTBEAT_SLACK   CONSTANT INTERVAL := INTERVAL '30 seconds'; -- stale heartbeat threshold
  BOT_REPLACE_AFTER CONSTANT INTERVAL := INTERVAL '60 seconds'; -- time before bot replaces

  rec               RECORD;
  v_room            RECORD;
  v_human_count     INTEGER;
  v_bot_difficulty  VARCHAR(10);
  v_marked          INTEGER := 0;
  v_replaced        INTEGER := 0;
  v_closed          INTEGER := 0;
BEGIN

  -- ──────────────────────────────────────────────────────────────────────────
  -- PHASE A: Mark stale-heartbeat human players as disconnected
  -- ──────────────────────────────────────────────────────────────────────────
  FOR rec IN
    SELECT rp.id, rp.room_id
    FROM   public.room_players rp
    JOIN   public.rooms r ON r.id = rp.room_id
    WHERE  rp.is_bot           = FALSE
      AND  rp.connection_status = 'connected'
      AND  rp.last_seen_at      < NOW() - HEARTBEAT_SLACK
      AND  r.status             = 'playing'
      -- Skip offline rooms
      AND  COALESCE((r.settings->>'is_offline')::BOOLEAN, FALSE) = FALSE
  LOOP
    UPDATE public.room_players
    SET
      connection_status = 'disconnected',
      disconnected_at   = NOW()
    WHERE id = rec.id
      -- Recheck so a concurrent heartbeat does not lose
      AND connection_status = 'connected'
      AND last_seen_at < NOW() - HEARTBEAT_SLACK;

    IF FOUND THEN
      v_marked := v_marked + 1;
    END IF;
  END LOOP;

  -- ──────────────────────────────────────────────────────────────────────────
  -- PHASE B: Replace long-disconnected players with bots (or close room)
  -- ──────────────────────────────────────────────────────────────────────────
  FOR rec IN
    SELECT rp.*
    FROM   public.room_players rp
    JOIN   public.rooms r ON r.id = rp.room_id
    WHERE  rp.is_bot           = FALSE
      AND  rp.connection_status = 'disconnected'
      AND  rp.disconnected_at   < NOW() - BOT_REPLACE_AFTER
      AND  r.status             = 'playing'
      AND  COALESCE((r.settings->>'is_offline')::BOOLEAN, FALSE) = FALSE
  LOOP
    -- Fetch the room once per affected player
    SELECT * INTO v_room FROM public.rooms WHERE id = rec.room_id;

    -- Count remaining active humans (excluding this disconnected player)
    SELECT COUNT(*)
    INTO   v_human_count
    FROM   public.room_players
    WHERE  room_id          = rec.room_id
      AND  is_bot           = FALSE
      AND  connection_status != 'disconnected'
      AND  connection_status != 'replaced_by_bot'
      AND  id               != rec.id;

    -- ── Special rule: sole human left → close the room ──────────────────────
    IF v_human_count = 0 THEN
      UPDATE public.rooms
      SET
        status      = 'finished',
        finished_at = NOW(),
        updated_at  = NOW()
      WHERE id = rec.room_id
        AND status = 'playing';

      v_closed := v_closed + 1;
      CONTINUE;  -- no bot replacement needed
    END IF;

    -- ── Determine replacement bot difficulty ────────────────────────────────
    IF v_room.ranked_mode = TRUE THEN
      v_bot_difficulty := 'hard';
    ELSE
      v_bot_difficulty := COALESCE(
        v_room.settings->>'bot_difficulty',
        rec.bot_difficulty,
        'medium'
      );
    END IF;

    -- ── Replace the player with a bot ───────────────────────────────────────
    UPDATE public.room_players
    SET
      -- Preserve original identity so the human can reclaim later
      human_user_id     = rec.user_id,
      replaced_username = rec.username,
      -- Bot identity
      user_id           = NULL,
      is_bot            = TRUE,
      bot_difficulty    = v_bot_difficulty,
      username          = 'Bot ' || COALESCE(rec.username, 'Player'),
      connection_status = 'replaced_by_bot',
      disconnected_at   = NULL,
      last_seen_at      = NOW()
    WHERE id = rec.id
      AND connection_status = 'disconnected'; -- guard against race condition

    IF FOUND THEN
      v_replaced := v_replaced + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'marked_disconnected', v_marked,
    'replaced_with_bot',   v_replaced,
    'rooms_closed',        v_closed,
    'processed_at',        NOW()
  );

EXCEPTION WHEN OTHERS THEN
  -- Never crash pg_cron job; return error details instead
  RETURN jsonb_build_object('error', SQLERRM, 'processed_at', NOW());
END;
$$;
-- Security: only edge functions (service_role) should invoke this expensive sweep.
REVOKE ALL ON FUNCTION public.process_disconnected_players() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.process_disconnected_players() TO service_role;

-- ============================================================================
-- STEP 4: Schedule process_disconnected_players every minute via pg_cron
-- ============================================================================

-- Note: Supabase pg_cron uses standard 5-field cron (minute granularity).
-- The function is also triggered by update-heartbeat edge function on every
-- heartbeat call, giving ~5-second effective granularity while the game is active.
DO $$
BEGIN
  -- Remove stale schedule if it exists
  PERFORM cron.unschedule('process-disconnected-players');
EXCEPTION WHEN OTHERS THEN
  NULL; -- pg_cron might not be installed yet, that is OK
END;
$$;

DO $$
BEGIN
  PERFORM cron.schedule(
    'process-disconnected-players',
    '* * * * *',
    'SELECT public.process_disconnected_players();'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron scheduling skipped (extension not available): %', SQLERRM;
END;
$$;

-- ============================================================================
-- STEP 5: reconnect_player() — human reclaims seat (direct or via bot slot)
-- ============================================================================
DROP FUNCTION IF EXISTS public.reconnect_player(UUID, UUID);

CREATE OR REPLACE FUNCTION public.reconnect_player(
  p_room_id   UUID,
  p_user_id   UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rec          RECORD;
  v_room_status  TEXT;
  v_was_bot      BOOLEAN := FALSE;
BEGIN
  -- 1. Room must still be active
  SELECT status INTO v_room_status
  FROM   public.rooms
  WHERE  id = p_room_id;

  IF NOT FOUND OR v_room_status NOT IN ('waiting', 'playing') THEN
    RETURN jsonb_build_object(
      'success',     FALSE,
      'room_closed', TRUE,
      'message',     'Room not found or already finished'
    );
  END IF;

  -- 2. Find the player's row.
  --    Either they are still the user_id (disconnected, not yet replaced)
  --    OR a bot is now sitting there and human_user_id = p_user_id.
  SELECT * INTO v_rec
  FROM   public.room_players
  WHERE  room_id = p_room_id
    AND  (
           user_id       = p_user_id
           OR human_user_id = p_user_id
         )
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'message', 'Player not found in this room'
    );
  END IF;

  v_was_bot := (v_rec.connection_status = 'replaced_by_bot');

  -- 3. Restore the seat to the human
  UPDATE public.room_players
  SET
    user_id           = p_user_id,
    human_user_id     = NULL,            -- clear — seat is theirs again
    replaced_username = NULL,
    is_bot            = FALSE,
    bot_difficulty    = NULL,
    username          = COALESCE(v_rec.replaced_username, v_rec.username),
    connection_status = 'connected',
    last_seen_at      = NOW(),
    disconnected_at   = NULL
  WHERE id = v_rec.id;

  RETURN jsonb_build_object(
    'success',          TRUE,
    'was_replaced',     v_was_bot,
    'player_index',     v_rec.player_index,
    'username',         COALESCE(v_rec.replaced_username, v_rec.username),
    'message',          CASE WHEN v_was_bot THEN 'Reclaimed seat from bot' ELSE 'Reconnected successfully' END
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', FALSE, 'error', SQLERRM);
END;
$$;
-- Security: only edge functions (service_role) should invoke this.
-- The edge function verifies auth.uid() before calling the RPC.
REVOKE ALL ON FUNCTION public.reconnect_player(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reconnect_player(UUID, UUID) TO service_role;
COMMENT ON FUNCTION public.reconnect_player(UUID, UUID) IS
'Allows a human to reconnect to their seat. Handles both simple reconnect (was '
'disconnected but not yet replaced) and reclaim-from-bot (bot_replacement_status). '
'Looks up the row by user_id OR human_user_id so the player can always find their slot.';

-- ============================================================================
-- STEP 6: mark_player_disconnected — guard offline rooms
-- ============================================================================
CREATE OR REPLACE FUNCTION public.mark_player_disconnected(
  p_room_id UUID,
  p_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_is_offline BOOLEAN;
BEGIN
  -- Skip for offline rooms — game just pauses, no timer
  SELECT COALESCE((settings->>'is_offline')::BOOLEAN, FALSE)
  INTO   v_is_offline
  FROM   public.rooms
  WHERE  id = p_room_id;

  IF v_is_offline THEN
    RETURN;
  END IF;

  UPDATE public.room_players
  SET
    connection_status = 'disconnected',
    disconnected_at   = NOW()
  WHERE room_id = p_room_id
    AND user_id = p_user_id
    AND connection_status = 'connected';  -- idempotent
END;
$$;
-- Security: only edge functions (service_role) should invoke this.
REVOKE ALL ON FUNCTION public.mark_player_disconnected(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.mark_player_disconnected(UUID, UUID) TO service_role;

-- ============================================================================
-- STEP 7: Helper — get_rejoin_status(room_id, user_id)
--
-- Called by the client on app-foreground to instantly know what state it's in:
--   • connected         → already in game, nothing to do
--   • disconnected      → in grace period, rejoin sends heartbeat
--   • replaced_by_bot   → can reclaim seat via reconnect_player()
--   • room_closed       → room finished while away
--   • not_in_room       → was never in this room
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_rejoin_status(
  p_room_id UUID,
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rec          RECORD;
  v_room_status  TEXT;
  v_seconds_left INTEGER;
BEGIN
  SELECT status INTO v_room_status
  FROM   public.rooms WHERE id = p_room_id;

  IF NOT FOUND OR v_room_status = 'finished' THEN
    RETURN jsonb_build_object('status', 'room_closed');
  END IF;

  SELECT * INTO v_rec
  FROM   public.room_players
  WHERE  room_id = p_room_id
    AND  (user_id = p_user_id OR human_user_id = p_user_id)
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_in_room');
  END IF;

  IF v_rec.connection_status = 'replaced_by_bot' THEN
    RETURN jsonb_build_object(
      'status',        'replaced_by_bot',
      'player_index',  v_rec.player_index,
      'bot_username',  v_rec.username
    );
  END IF;

  IF v_rec.connection_status = 'disconnected' THEN
    -- How many seconds remain before bot replacement?
    v_seconds_left := GREATEST(
      0,
      60 - EXTRACT(EPOCH FROM (NOW() - v_rec.disconnected_at))::INTEGER
    );
    RETURN jsonb_build_object(
      'status',        'disconnected',
      'seconds_left',  v_seconds_left,
      'player_index',  v_rec.player_index
    );
  END IF;

  RETURN jsonb_build_object(
    'status',       'connected',
    'player_index', v_rec.player_index
  );
END;
$$;
-- Security: only edge functions (service_role) should invoke this.
REVOKE ALL ON FUNCTION public.get_rejoin_status(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_rejoin_status(UUID, UUID) TO service_role;
COMMENT ON FUNCTION public.get_rejoin_status IS
'Returns the current rejoin status for a player in a room. Used on app-foreground to determine the UI state.';
