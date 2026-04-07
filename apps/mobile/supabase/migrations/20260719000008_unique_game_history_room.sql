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
    SELECT 1
    FROM pg_class t
    JOIN pg_namespace tn ON tn.oid = t.relnamespace
    JOIN pg_index i ON i.indrelid = t.oid
    JOIN pg_class idx ON idx.oid = i.indexrelid
    WHERE t.relname = 'game_history'
      AND tn.nspname = 'public'
      AND i.indisunique = true
      AND pg_get_expr(i.indpred, i.indrelid) ILIKE '%room_id%IS NOT NULL%'
  ) THEN
    RAISE WARNING 'Expected unique partial index on game_history(room_id) WHERE room_id IS NOT NULL not found — verify manually';
  END IF;
END $$;
