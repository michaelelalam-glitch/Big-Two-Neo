-- PLACEHOLDER MIGRATION (L2): This migration slot was reserved for a change
-- that was applied directly to the remote database before formal migration
-- tracking was introduced. The no-op SELECT 1 ensures supabase db push and
-- supabase db pull treat this as a valid, applied migration with no schema change.
SELECT 1;
