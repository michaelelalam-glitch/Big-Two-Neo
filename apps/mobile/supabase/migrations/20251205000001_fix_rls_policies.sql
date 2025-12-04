-- Fix RLS Security Policies
-- Date: December 5, 2025
-- Purpose: Address Copilot security review findings

-- ============================================================================
-- FIX ROOMS TABLE RLS - Restrict code access to participants only
-- ============================================================================

-- Drop the overly permissive policy
DROP POLICY IF EXISTS "Rooms are viewable by everyone" ON rooms;

-- Create restrictive policy that only allows participants and hosts to view rooms
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

-- ============================================================================
-- FIX GAME_STATE TABLE RLS - Prevent arbitrary tampering
-- ============================================================================

-- Drop the overly permissive update policy
DROP POLICY IF EXISTS "Players in room can update game state" ON game_state;

-- Disable direct updates - game state should only be updated via secure functions
CREATE POLICY "Restrictive game state update"
  ON game_state FOR UPDATE
  TO authenticated
  USING (false)
  WITH CHECK (false);

-- Note: Game state updates should be performed via SECURITY DEFINER functions
-- that enforce game rules. This prevents client-side tampering.

-- ============================================================================
-- CREATE SECURE FUNCTION FOR ROOM LOOKUP BY CODE
-- ============================================================================

-- Function to lookup room by code (for joining)
-- This allows users to find rooms by code without exposing all room codes
CREATE OR REPLACE FUNCTION public.lookup_room_by_code(room_code TEXT)
RETURNS TABLE (
  id UUID,
  code TEXT,
  host_id UUID,
  status TEXT,
  max_players INTEGER,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  -- Validate code format
  IF LENGTH(room_code) != 6 THEN
    RAISE EXCEPTION 'Invalid room code format';
  END IF;

  -- Return room if it exists and is joinable
  RETURN QUERY
  SELECT
    r.id,
    r.code,
    r.host_id,
    r.status,
    r.max_players,
    r.created_at,
    r.updated_at
  FROM rooms r
  WHERE r.code = room_code
    AND r.status = 'waiting'; -- Only return rooms that are waiting for players

  -- If no room found, don't reveal whether code exists
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room not found or not available';
  END IF;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.lookup_room_by_code(TEXT) TO authenticated;

-- ============================================================================
-- CREATE SECURE FUNCTION FOR GAME STATE UPDATES
-- ============================================================================

-- Placeholder for future game state update function
-- This should validate game rules before allowing updates
-- Example: UPDATE game_state SET current_turn = ... WHERE room_id = ... AND <game_rules>

COMMENT ON FUNCTION public.lookup_room_by_code IS 'Secure function to lookup room by code without exposing all room codes';
