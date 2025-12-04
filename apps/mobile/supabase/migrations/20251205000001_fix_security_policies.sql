-- Security Policy Fixes
-- Date: December 5, 2025
-- Purpose: Fix RLS policies identified in Copilot review

-- Drop the overly permissive "Rooms are viewable by everyone" policy
DROP POLICY IF EXISTS "Rooms are viewable by everyone" ON rooms;

-- Replace with restricted policy that only allows room participants and host to view
CREATE POLICY "Rooms are viewable by host and participants"
  ON rooms FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM players
      WHERE players.room_id = rooms.id
        AND players.user_id = auth.uid()
    )
    OR rooms.host_id = auth.uid()
  );

-- Drop the permissive game_state update policy
DROP POLICY IF EXISTS "Players in room can update game state" ON game_state;

-- Replace with restrictive policy that disallows direct updates
-- Game state updates should only happen via SECURITY DEFINER functions
CREATE POLICY "Restrict direct game state updates"
  ON game_state FOR UPDATE
  TO authenticated
  USING (false)
  WITH CHECK (false);

-- Add comment explaining the security model
COMMENT ON POLICY "Restrict direct game state updates" ON game_state IS 
  'Direct updates are restricted to prevent tampering. Game state mutations should be performed via SECURITY DEFINER functions that enforce game rules and validate transitions.';
