-- ==========================================================================
-- TASK #555: Lock down game_state RLS — block direct client writes
-- ==========================================================================
-- Previously, migration 20251227120001 opened INSERT/UPDATE to everyone
-- (WITH CHECK (true) / USING (true)) so SECURITY DEFINER functions would
-- work.  But SECURITY DEFINER functions bypass RLS entirely, so those
-- permissive policies are unnecessary and expose the table to direct
-- client writes.
--
-- This migration:
--   1. Drops the overly-permissive INSERT/UPDATE policies.
--   2. Keeps the SELECT policy (only room members can read).
--   3. Adds a restrictive DELETE policy (nobody can delete from client).
--   4. All writes now go strictly through SECURITY DEFINER RPCs / Edge Functions.
-- ==========================================================================

-- 1) Drop the wide-open INSERT policy
DROP POLICY IF EXISTS "Allow function insert game state" ON game_state;

-- 2) Drop the wide-open UPDATE policy
DROP POLICY IF EXISTS "Allow function update game state" ON game_state;

-- 3) Ensure SELECT policy still exists (idempotent re-create)
DROP POLICY IF EXISTS "Players can view game state in their room" ON game_state;
CREATE POLICY "Players can view game state in their room" ON game_state
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM room_players
      WHERE room_players.room_id = game_state.room_id
        AND room_players.user_id = auth.uid()
    )
  );

-- 4) Explicitly block DELETE from clients
CREATE POLICY "No direct deletes on game_state" ON game_state
  FOR DELETE USING (false);

-- 5) Block INSERT from clients (SECURITY DEFINER functions bypass RLS)
CREATE POLICY "No direct inserts on game_state" ON game_state
  FOR INSERT WITH CHECK (false);

-- 6) Block UPDATE from clients (SECURITY DEFINER functions bypass RLS)
CREATE POLICY "No direct updates on game_state" ON game_state
  FOR UPDATE USING (false)
  WITH CHECK (false);

-- Verify RLS is enabled (idempotent)
ALTER TABLE game_state ENABLE ROW LEVEL SECURITY;

COMMENT ON POLICY "No direct inserts on game_state" ON game_state IS
  'Task #555: All writes must go through SECURITY DEFINER Edge Functions / RPCs.';
COMMENT ON POLICY "No direct updates on game_state" ON game_state IS
  'Task #555: All writes must go through SECURITY DEFINER Edge Functions / RPCs.';
COMMENT ON POLICY "No direct deletes on game_state" ON game_state IS
  'Task #555: Clients cannot delete game state rows.';
