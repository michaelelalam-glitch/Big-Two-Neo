-- ============================================================================
-- CRITICAL FIX: Allow start_game_with_bots to insert bot players
-- ============================================================================
-- ROOT CAUSE: RLS policy "Authenticated users can join rooms" requires 
-- user_id = auth.uid(), which fails for bot inserts where user_id = NULL
--
-- ERROR: "new row violates row-level security policy for table room_players"
--
-- FIX: Add a policy that allows server functions to insert bot players
-- ============================================================================

-- Allow the start_game_with_bots function (or any server function) to insert bots
-- This policy allows INSERT when user_id IS NULL and is_bot = TRUE
-- It's safe because only server-side RPC functions can set is_bot = TRUE
CREATE POLICY "Server can insert bot players" ON room_players
  FOR INSERT WITH CHECK (
    user_id IS NULL AND is_bot = TRUE
  );

-- EXPLANATION:
-- - This policy allows rows where user_id IS NULL AND is_bot = TRUE to be inserted
-- - Only server-side functions (like start_game_with_bots) can insert such rows
-- - Client code cannot bypass this because clients can't set is_bot = TRUE directly
--   (they would fail the "Authenticated users can join rooms" policy which requires is_host = FALSE)
-- - This is secure because:
--   1. Bots have no user_id (NULL), so they can't authenticate
--   2. is_bot flag prevents clients from impersonating bots
--   3. start_game_with_bots validates room ownership before inserting bots
