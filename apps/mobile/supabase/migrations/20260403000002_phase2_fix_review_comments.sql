-- Phase 2 — Review comment fixes (Task #658)
-- ============================================================
-- Addresses Copilot PR review comments on 20260403000001:
--
-- Fix 1: Drop the redundant idx_game_history_room_unique index that was
--   created by the original 20260403000001 even though an equivalent partial
--   unique index (idx_game_history_unique_room_id or idx_game_history_room_id_unique)
--   already existed.  IF NOT EXISTS only checked the index *name*, not the
--   definition, so a duplicate was built.  Drop the newly created one; the
--   pre-existing indexes provide the same guarantee.
--
-- Fix 2: Revoke EXECUTE on mark_player_disconnected from PUBLIC.
--   The original 20260403000001 (already applied to production) revoked only
--   from authenticated + anon.  The file has since been updated, but this
--   migration closes the gap for environments that ran the original version.
--   Note: on fresh environments that run the updated 20260403000001, the
--   REVOKE FROM PUBLIC here is idempotent (safe to run twice).

-- ── Fix 1: Remove duplicate partial unique index ──────────────────────────────
DROP INDEX IF EXISTS public.idx_game_history_room_unique;

-- Annotate the canonical pre-existing partial index using a DO block so the
-- migration is portable across environments where the index may exist under
-- either of the two known legacy names.  to_regclass returns NULL (not an
-- error) when the identifier does not exist, so we can COALESCE safely.
DO $$
DECLARE
  canonical_index regclass;
BEGIN
  canonical_index := COALESCE(
    to_regclass('public.idx_game_history_unique_room_id'),
    to_regclass('public.idx_game_history_room_id_unique')
  );

  IF canonical_index IS NOT NULL THEN
    EXECUTE format(
      'COMMENT ON INDEX %s IS %L',
      canonical_index,
      'Task #658 2.1 canonical — Prevents duplicate game_history rows for the same room. Blocks concurrent client complete-game + process_disconnected_players inserts.'
    );
  ELSE
    RAISE NOTICE 'No equivalent game_history partial unique index found to annotate.';
  END IF;
END
$$;

-- ── Fix 2: Revoke from PUBLIC on mark_player_disconnected ─────────────────────
-- Closes the gap left by the original 20260403000001 deployment (authenticated
-- + anon only).  The updated 20260403000001 file includes PUBLIC; this ensures
-- existing deployments are also hardened.  REVOKE is idempotent.
REVOKE ALL ON FUNCTION public.mark_player_disconnected(uuid, uuid)
  FROM PUBLIC;
