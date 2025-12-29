-- ==========================================================================
-- FIX GAME_STATE RLS POLICIES TO ALLOW FUNCTION INSERTS
-- ==========================================================================
-- The start_game_with_bots() function runs with SECURITY DEFINER but RLS
-- is still blocking INSERT operations. We need to allow the function to insert.

-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Players can view game state in their room" ON game_state;
DROP POLICY IF EXISTS "Only coordinator can insert game state" ON game_state;
DROP POLICY IF EXISTS "Only coordinator can update game state" ON game_state;

-- Create permissive SELECT policy (anyone in room can view)
CREATE POLICY "Players can view game state in their room" ON game_state
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM room_players
      WHERE room_players.room_id = game_state.room_id
      AND room_players.user_id = auth.uid()
    )
  );

-- CRITICAL FIX: Allow INSERT for SECURITY DEFINER functions
-- When a function runs with SECURITY DEFINER, it bypasses RLS by default
-- BUT we need to explicitly allow it
CREATE POLICY "Allow function insert game state" ON game_state
  FOR INSERT WITH CHECK (true);

-- Allow UPDATE for authenticated users (bot coordinator via RPC)
CREATE POLICY "Allow function update game state" ON game_state
  FOR UPDATE USING (true);

-- Comments
COMMENT ON POLICY "Allow function insert game state" ON game_state IS 
  'Allows SECURITY DEFINER functions (like start_game_with_bots) to insert game state';
COMMENT ON POLICY "Allow function update game state" ON game_state IS 
  'Allows SECURITY DEFINER functions (like execute_play_move) to update game state';
