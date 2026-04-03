-- Phase 2 — Review comment fixes (Task #658)
-- ============================================================
-- Addresses Copilot PR review comments on 20260403000001:
--
-- Fix 1: Drop the redundant idx_game_history_room_unique index that was
--   created by 20260403000001 even though an equivalent partial unique index
--   (idx_game_history_unique_room_id) already existed.  IF NOT EXISTS only
--   checked the index *name*, not the definition, so a duplicate was built.
--   Drop the newly created one; the pre-existing idx_game_history_unique_room_id
--   and idx_game_history_room_id_unique provide the same guarantee.
--
-- Fix 2: Add REVOKE from PUBLIC on mark_player_disconnected.
--   20260403000001 revoked from authenticated + anon but not PUBLIC.
--   If EXECUTE was granted to PUBLIC it would bypass those revokes.

-- ── Fix 1: Remove duplicate partial unique index ──────────────────────────────
DROP INDEX IF EXISTS public.idx_game_history_room_unique;

-- Annotate the canonical pre-existing partial index for documentation.
COMMENT ON INDEX public.idx_game_history_unique_room_id IS
  'Task #658 2.1 canonical — Prevents duplicate game_history rows for the same room. '
  'Blocks concurrent client complete-game + process_disconnected_players inserts.';

-- ── Fix 2: Revoke from PUBLIC on mark_player_disconnected ─────────────────────
-- Supplement 20260403000001 which only revoked from authenticated + anon.
-- Revoke from PUBLIC ensures no role can acquire EXECUTE via implicit grant.
REVOKE ALL ON FUNCTION public.mark_player_disconnected(uuid, uuid)
  FROM PUBLIC;
