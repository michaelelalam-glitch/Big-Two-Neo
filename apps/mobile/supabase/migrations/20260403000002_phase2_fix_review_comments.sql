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

-- ── Fix 1 + 2 (combined): Safe drop + portable COMMENT ───────────────────────
-- Only drop idx_game_history_room_unique when a legacy equivalent already exists
-- so that we never remove the only uniqueness guard (e.g. in fresh environments
-- where 20260403000001 ran and created idx_game_history_unique_room_id as the
-- only partial unique index, there is nothing to drop here).
-- Then annotate whichever canonical index remains, including idx_game_history_room_unique
-- as a fallback so the migration is portable across all known index histories.
DO $$
DECLARE
  canonical_index regclass;
  has_legacy_equivalent boolean;
BEGIN
  has_legacy_equivalent := (
    to_regclass('public.idx_game_history_unique_room_id') IS NOT NULL
    OR to_regclass('public.idx_game_history_room_id_unique') IS NOT NULL
  );

  -- Only drop the newer redundant index when one of the known legacy equivalent
  -- partial unique indexes is present; otherwise keep the current uniqueness guard.
  IF has_legacy_equivalent
     AND to_regclass('public.idx_game_history_room_unique') IS NOT NULL THEN
    DROP INDEX public.idx_game_history_room_unique;
  ELSE
    RAISE NOTICE 'Skipping drop of idx_game_history_room_unique because no equivalent legacy partial unique index exists (or index already absent).';
  END IF;

  -- Annotate whichever canonical index is present, probing all known names.
  canonical_index := COALESCE(
    to_regclass('public.idx_game_history_unique_room_id'),
    to_regclass('public.idx_game_history_room_id_unique'),
    to_regclass('public.idx_game_history_room_unique')
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
END;
$$;

-- ── Fix 2: Revoke from PUBLIC on mark_player_disconnected ─────────────────────
-- Closes the gap left by the original 20260403000001 deployment (authenticated
-- + anon only).  The updated 20260403000001 file includes PUBLIC; this ensures
-- existing deployments are also hardened.  REVOKE is idempotent.
REVOKE ALL ON FUNCTION public.mark_player_disconnected(uuid, uuid)
  FROM PUBLIC;
