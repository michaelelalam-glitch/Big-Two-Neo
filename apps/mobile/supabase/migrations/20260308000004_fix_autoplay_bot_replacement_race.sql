-- Migration: Fix auto-play and bot replacement race condition
-- Date: 2026-03-08
-- Issue: When inactivity timer expires, auto-play fails because player gets replaced by bot
-- during the time between timer expiry and auto-play call.
--
-- Fix:
-- 1. Allow auto-play to work for players even if they've been replaced by bot (using human_user_id)
-- 2. Delay bot replacement if the player's turn is active and timer hasn't expired yet
-- 3. Ensure auto-play can execute even if bot replacement has started

-- ========================================================================
-- Fix process_disconnected_players to respect active turn timer
-- ========================================================================

CREATE OR REPLACE FUNCTION process_disconnected_players()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_marked       INT := 0;
  v_replaced     INT := 0;
  v_closed       INT := 0;
  v_codes        TEXT[] := '{}';
  rec            RECORD;
  v_bot_auth_id  UUID;
  v_bot_diff     TEXT;
  v_human_count  INT;
  v_bot_count    INT;
BEGIN
  -- ── Phase A: Mark stale heartbeats (> 15s old) as 'disconnected' ──────
  FOR rec IN
    SELECT rp.id, rp.room_id, rp.username, r.code
    FROM room_players rp
    JOIN rooms r ON r.id = rp.room_id
    WHERE r.status IN ('waiting', 'playing')
      AND rp.last_seen_at < (NOW() - INTERVAL '15 seconds')
      AND rp.connection_status = 'connected'
  LOOP
    UPDATE room_players
    SET
      connection_status = 'disconnected',
      disconnected_at   = NOW()
    WHERE id = rec.id;

    v_marked := v_marked + 1;
  END LOOP;

  -- ── Phase B: Replace long-disconnected players with bots (or close room) ─
  FOR rec IN
    SELECT
      rp.id,
      rp.room_id,
      rp.player_index,
      rp.username,
      rp.user_id,
      rp.disconnected_at,
      r.code,
      r.status,
      r.game_mode,
      r.bot_difficulty,
      gs.current_turn,
      gs.turn_started_at
    FROM room_players rp
    JOIN rooms r ON r.id = rp.room_id
    LEFT JOIN game_state gs ON gs.room_id = r.id
    WHERE r.status IN ('waiting', 'playing')
      AND rp.disconnected_at IS NOT NULL
      AND rp.disconnected_at < (NOW() - INTERVAL '60 seconds')  -- 60s grace period
      AND rp.connection_status = 'disconnected'
    ORDER BY rp.disconnected_at ASC
  LOOP
    -- ── NEW: Skip replacement if this player's turn is active and timer hasn't expired ──
    -- This prevents bot replacement from interfering with auto-play
    IF rec.status = 'playing' AND rec.current_turn = rec.player_index THEN
      -- Check if turn timer (60s) has expired
      IF rec.turn_started_at IS NOT NULL THEN
        DECLARE
          v_turn_elapsed INTERVAL := NOW() - rec.turn_started_at;
          v_turn_timeout INTERVAL := INTERVAL '70 seconds'; -- 60s + 10s buffer for auto-play
        BEGIN
          IF v_turn_elapsed < v_turn_timeout THEN
            -- Turn timer hasn't expired yet, skip bot replacement
            -- This allows auto-play to execute first
            RAISE NOTICE 'Skipping bot replacement for player % (turn still active: %s elapsed)', 
                         rec.player_index, EXTRACT(EPOCH FROM v_turn_elapsed);
            CONTINUE;
          END IF;
        END;
      END IF;
    END IF;

    -- ── Check how many humans remain in the room ────────────────────────────
    SELECT
      COUNT(*) FILTER (WHERE rp2.user_id IS NOT NULL 
                        AND rp2.connection_status != 'disconnected'
                        AND rp2.connection_status != 'replaced_by_bot'),
      COUNT(*) FILTER (WHERE rp2.user_id IS NULL)
    INTO v_human_count, v_bot_count
    FROM room_players rp2
    WHERE rp2.room_id = rec.room_id;

    -- ── If no humans remain → close the room ─────────────────────────────────
    IF (v_human_count - 1) <= 0 THEN
      UPDATE rooms SET status = 'finished', ended_at = NOW() WHERE id = rec.room_id;
      UPDATE room_players SET connection_status = 'disconnected' WHERE room_id = rec.room_id;
      v_closed := v_closed + 1;
      v_codes := array_append(v_codes, rec.code);
      CONTINUE;
    END IF;

    -- ── Determine replacement bot difficulty ────────────────────────────────
    v_bot_diff := CASE
      WHEN rec.game_mode = 'ranked' THEN 'hard'
      ELSE COALESCE(rec.bot_difficulty, 'medium')
    END;

    -- Replace the player row with a bot
    UPDATE room_players
    SET
      user_id                     = NULL,
      human_user_id               = rec.user_id,
      replaced_username           = rec.username,
      username                    = 'Bot ' || COALESCE(rec.username, 'Player'),
      connection_status           = 'replaced_by_bot',
      last_seen_at                = NOW(),
      disconnect_timer_started_at = NULL,
      bot_difficulty              = v_bot_diff
    WHERE id = rec.id;

    v_replaced := v_replaced + 1;
    v_codes := array_append(v_codes, rec.code);

    -- Sync bot difficulty to room settings
    PERFORM _sync_bot_difficulty_to_room_settings(rec.room_id);
  END LOOP;

  RETURN jsonb_build_object(
    'marked_disconnected',     v_marked,
    'replaced_with_bot',           v_replaced,
    'rooms_closed',            v_closed,
    'affected_room_codes',     v_codes
  );
END;
$$;

COMMENT ON FUNCTION process_disconnected_players IS 
  'Sweeps room_players for stale heartbeats and replaces long-disconnected players with bots. '
  'Phase A: marks heartbeats > 15s old as disconnected. '
  'Phase B: replaces players disconnected > 60s with bots (respecting active turn timers). '
  'Returns stats: {marked_disconnected, replaced_with_bot, rooms_closed, affected_room_codes}.';

-- ========================================================================
-- Notify deployment
-- ========================================================================

DO $$
BEGIN
  RAISE NOTICE '✅ Migration 20260308000004: Auto-play and bot replacement race condition fixed';
  RAISE NOTICE '   - Bot replacement now respects active turn timers (60s + 10s buffer)';
  RAISE NOTICE '   - Auto-play can execute even if player disconnected';
  RAISE NOTICE '   - Edge function updated to use human_user_id for auth checks';
END $$;
