-- =============================================================================
-- Migration: Round-2 Copilot review corrections
-- Date: 2026-03-22
-- =============================================================================
-- Remove the authenticated SELECT policy on room_analytics that was created by
-- 20260322000000_security_hardening.sql before that migration was corrected.
-- room_analytics.metadata contains raw SQLERRM error details that must not be
-- readable by regular clients.  service_role bypasses RLS and retains access.
--
-- Note: the three paginated leaderboard functions (get_leaderboard_ranked/
-- casual/global) have their hardened bounds (LEAST/GREATEST/COALESCE pattern)
-- reflected in 20260322000001 and 20260322000002; no changes are needed here.
-- =============================================================================

DROP POLICY IF EXISTS "Authenticated users can read room analytics" ON public.room_analytics;

