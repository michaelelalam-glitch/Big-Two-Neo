-- Secure Player Joins Migration
-- Date: December 5, 2025
-- Purpose: Fix critical security vulnerability in player RLS policies
-- 
-- SECURITY ISSUE: The original policies allowed:
-- 1. Any authenticated user to view ALL players in ALL rooms
-- 2. Users to directly INSERT into players, bypassing room validation
-- 3. Attackers to enumerate rooms and join without codes
--
-- This migration implements secure room joining through a SECURITY DEFINER function.

-- ============================================================================
-- DROP OLD PERMISSIVE POLICIES
-- ============================================================================

-- Drop the overly permissive SELECT policy
DROP POLICY IF EXISTS "Players are viewable by everyone" ON players;

-- Drop the direct INSERT policy that bypasses validation
DROP POLICY IF EXISTS "Authenticated users can join rooms" ON players;

-- ============================================================================
-- CREATE RESTRICTIVE RLS POLICIES
-- ============================================================================

-- Only allow users to view players in rooms they are part of (or host)
CREATE POLICY "Players are viewable by participants and hosts"
  ON players FOR SELECT
  USING (
    -- User can see their own player record
    auth.uid() = user_id
    OR
    -- User can see other players in rooms they are part of
    EXISTS (
      SELECT 1 FROM players p2
      WHERE p2.room_id = players.room_id 
        AND p2.user_id = auth.uid()
    )
    OR
    -- Room host can see all players in their room
    EXISTS (
      SELECT 1 FROM rooms r
      WHERE r.id = players.room_id
        AND r.host_id = auth.uid()
    )
  );

-- Remove ability for users to directly INSERT into players
-- All inserts must go through the SECURITY DEFINER function
CREATE POLICY "Only SECURITY DEFINER functions can insert players"
  ON players FOR INSERT
  TO postgres
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- CREATE SECURE JOIN FUNCTION
-- ============================================================================

-- SECURITY DEFINER function to join a room by code with full validation
CREATE OR REPLACE FUNCTION public.join_room_by_code(
  in_room_code TEXT,
  in_username TEXT,
  in_position INTEGER
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room_id UUID;
  v_user_id UUID := auth.uid();
  v_max_players INTEGER;
  v_host_id UUID;
  v_status TEXT;
  v_player_count INTEGER;
  v_player_id UUID;
  v_is_host BOOLEAN := false;
BEGIN
  -- Validate input
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User not authenticated';
  END IF;

  IF in_position < 0 OR in_position > 3 THEN
    RAISE EXCEPTION 'Invalid position. Must be 0-3';
  END IF;

  -- Look up room by code and lock it (prevents race conditions)
  SELECT id, max_players, status, host_id 
  INTO v_room_id, v_max_players, v_status, v_host_id
  FROM rooms
  WHERE code = UPPER(in_room_code)
  FOR UPDATE;

  -- Validate room exists
  IF v_room_id IS NULL THEN
    RAISE EXCEPTION 'Room not found';
  END IF;
  
  -- Validate room is joinable
  IF v_status <> 'waiting' THEN
    RAISE EXCEPTION 'Room is not joinable (status: %)', v_status;
  END IF;

  -- Check if user is already in this room
  IF EXISTS (
    SELECT 1 FROM players 
    WHERE room_id = v_room_id 
      AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'User already in room';
  END IF;

  -- Check room capacity
  SELECT COUNT(*) INTO v_player_count 
  FROM players 
  WHERE room_id = v_room_id;

  IF v_player_count >= v_max_players THEN
    RAISE EXCEPTION 'Room is full (% / % players)', v_player_count, v_max_players;
  END IF;

  -- Check if requested position is available (with lock to prevent race)
  IF EXISTS (
    SELECT 1 FROM players 
    WHERE room_id = v_room_id 
      AND position = in_position 
    FOR UPDATE
  ) THEN
    RAISE EXCEPTION 'Position % already taken', in_position;
  END IF;

  -- Determine if this user is the host
  v_is_host := (v_user_id = v_host_id);

  -- Insert player record
  INSERT INTO players (
    room_id, 
    user_id, 
    username, 
    position, 
    is_host,
    is_ready,
    connected
  )
  VALUES (
    v_room_id, 
    v_user_id, 
    in_username, 
    in_position, 
    v_is_host,
    false,
    true
  )
  RETURNING id INTO v_player_id;

  -- Return the new player ID
  RETURN v_player_id;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.join_room_by_code(TEXT, TEXT, INTEGER) TO authenticated;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON FUNCTION public.join_room_by_code IS 
'Securely join a room by code with validation of capacity, status, and position availability. 
This is the ONLY approved way to join a room. Direct INSERTs into players table are blocked by RLS.';

COMMENT ON POLICY "Players are viewable by participants and hosts" ON players IS
'Restricts player visibility to only participants in the same room and room hosts.
Prevents enumeration of rooms and players by unauthorized users.';

COMMENT ON POLICY "Only SECURITY DEFINER functions can insert players" ON players IS
'Blocks direct INSERTs into players table. All joins must go through join_room_by_code() 
which enforces capacity limits, room status checks, and position validation.';
