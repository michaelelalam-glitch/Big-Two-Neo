-- Phase 2 — Database & Migration Integrity (Task #658)
-- ============================================================
-- 2.1  Verify UNIQUE INDEX on game_history(room_id) is present.
--      Prevents duplicate game_history rows for the same room from
--      being inserted concurrently by client complete-game and the
--      process_disconnected_players Phase-B / Phase-C paths.
--
-- 2.2  Force-sweep grace-period alignment is a TypeScript edge-function
--      concern (FORCE_SWEEP_GRACE_MS = 55 000 ms, intentionally 5 s less
--      than BOT_REPLACE_AFTER = 60 s to absorb client/server clock drift).
--      The SQL functions process_disconnected_players and
--      mark_player_disconnected both use the correct 60-second threshold.
--      No SQL change is required.
--
-- 2.3  Room-membership validation has been added to the mark-disconnected
--      edge function (apps/mobile/supabase/functions/mark-disconnected/index.ts).
--      The SQL function mark_player_disconnected is already restricted to
--      {postgres, service_role} only (REVOKE ALL FROM authenticated + anon).
--      This migration tightens the DB layer by asserting the ACL is correct
--      and removes any inadvertent public/authenticator grants.

-- ── 2.1 Idempotent UNIQUE INDEX on game_history(room_id) ─────────────────────
-- The index already exists (idx_game_history_unique_room_id and
-- idx_game_history_room_id_unique) but we ensure the canonical covering index
-- is present for new deployments.  CREATE UNIQUE INDEX IF NOT EXISTS is
-- idempotent — a no-op if the index already exists with a matching definition.

CREATE UNIQUE INDEX IF NOT EXISTS idx_game_history_room_unique
  ON public.game_history (room_id)
  WHERE room_id IS NOT NULL;

COMMENT ON INDEX public.idx_game_history_room_unique IS
  'Task #658 2.1 — Prevents duplicate game_history rows for the same room. '
  'Blocks concurrent client complete-game + process_disconnected_players inserts.';

-- ── 2.3 Tighten mark_player_disconnected ACL ─────────────────────────────────
-- Ensure the function is NOT callable by the authenticated or anon roles
-- via PostgREST.  Only postgres (owner) and service_role (edge functions) may
-- execute it.  REVOKE is idempotent — safe to run even if the grant was never
-- made.

DO $$
BEGIN
  -- Revoke from authenticated
  REVOKE ALL ON FUNCTION public.mark_player_disconnected(uuid, uuid)
    FROM authenticated, anon;
EXCEPTION WHEN undefined_object OR insufficient_privilege THEN
  -- Function may have been created without those grants — safe to ignore.
  NULL;
END;
$$;

-- Re-confirm service_role can execute (already in ACL but harmless to repeat).
GRANT EXECUTE ON FUNCTION public.mark_player_disconnected(uuid, uuid)
  TO service_role;

-- ── Comment: tasks 653 & 654 require manual credential rotation ──────────────
-- Task #653 — Rotate Supabase service role key:
--   Supabase Dashboard → Settings → API → "Service Role" → Reset key.
--   Update EAS/CI secret SUPABASE_SERVICE_ROLE_KEY after rotation.
--
-- Task #654 — Rotate MongoDB Atlas password:
--   MongoDB Atlas → Database Access → big2admin → Edit → Reset Password.
--   Update any connection-string secrets referencing big2.ukgka7p.mongodb.net.
--
-- Neither rotation can be performed via SQL migration.  They are tracked as
-- task #653 and #654 in the admin task manager.
