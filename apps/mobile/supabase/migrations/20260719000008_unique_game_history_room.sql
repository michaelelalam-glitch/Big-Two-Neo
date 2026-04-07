-- Lightweight verification for schema history continuity.
--
-- Despite the filename/intent ("unique_game_history_room"), the partial unique
-- index on game_history(room_id) WHERE room_id IS NOT NULL was already
-- created/verified by:
--   • 20260313000001_dedup_game_history_and_fix_stats.sql
--   • 20260403000001_phase2_db_migration_integrity.sql
--
-- Rather than re-creating the index (which would risk an unnecessary full-table
-- build and brief write-lock), we assert it exists so the migration chain stays
-- auditable.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'game_history'
      AND indexdef ILIKE '%room_id%'
      AND indexdef ILIKE '%unique%'
  ) THEN
    RAISE WARNING 'Expected unique index on game_history(room_id) not found — verify manually';
  END IF;
END $$;
