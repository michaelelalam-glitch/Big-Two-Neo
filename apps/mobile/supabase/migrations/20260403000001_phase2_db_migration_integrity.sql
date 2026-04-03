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
-- The index may already exist under an older name (idx_game_history_unique_room_id
-- or idx_game_history_room_id_unique).  `CREATE UNIQUE INDEX IF NOT EXISTS` only
-- compares the target index *name*, not the definition, so it would silently
-- create a second equivalent index on the table if the existing one has a
-- different name — adding redundant write overhead.
-- We instead query pg_index to detect any equivalent unique partial index on
-- game_history(room_id) WHERE room_id IS NOT NULL, and only build the canonical
-- idx_game_history_unique_room_id (standardizing on the existing canonical name)
-- if no such index exists yet.

DO $$
DECLARE
  v_index_name text;
BEGIN
  SELECT idx.relname
    INTO v_index_name
  FROM pg_index i
  JOIN pg_class tbl
    ON tbl.oid = i.indrelid
  JOIN pg_namespace ns
    ON ns.oid = tbl.relnamespace
  JOIN pg_class idx
    ON idx.oid = i.indexrelid
  JOIN pg_attribute a
    ON a.attrelid = tbl.oid
   AND a.attnum = ANY (i.indkey)
  WHERE ns.nspname = 'public'
    AND tbl.relname = 'game_history'
    AND i.indisunique
    AND i.indnkeyatts = 1
    AND i.indnatts = 1
    AND a.attname = 'room_id'
    AND i.indpred IS NOT NULL
    AND regexp_replace(
      lower(pg_get_expr(i.indpred, i.indrelid)),
      '[[:space:]()]+',
      '',
      'g'
    ) = 'room_idisnotnull'
  LIMIT 1;

  IF v_index_name IS NULL THEN
    -- Standardize on the existing canonical name used in 20260313000001.
    -- Avoids introducing a 3rd name (idx_game_history_room_unique) that would
    -- need a cleanup migration on any environment without legacy indexes.
    EXECUTE $sql$
      CREATE UNIQUE INDEX idx_game_history_unique_room_id
        ON public.game_history (room_id)
        WHERE room_id IS NOT NULL
    $sql$;
    v_index_name := 'idx_game_history_unique_room_id';
  END IF;

  EXECUTE format(
    'COMMENT ON INDEX public.%I IS %L',
    v_index_name,
    'Task #658 2.1 — Prevents duplicate game_history rows for the same room. Blocks concurrent client complete-game + process_disconnected_players inserts.'
  );
END;
$$;

-- ── 2.3 Tighten mark_player_disconnected ACL ─────────────────────────────────
-- Ensure the function is NOT callable by PUBLIC, authenticated, or anon roles
-- via PostgREST.  Only postgres (owner) and service_role (edge functions) may
-- execute it.  REVOKE is idempotent — safe to run even if the grant was never
-- made, but the migration must fail if it lacks privilege to harden the ACL.

REVOKE ALL ON FUNCTION public.mark_player_disconnected(uuid, uuid)
  FROM PUBLIC, authenticated, anon;

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
