-- Migration: Add spectator mode support
-- Description: Adds is_spectator column to room_players and updates reconnect_player() 
-- to set spectator mode when bot has replaced disconnected player
-- Date: 2025-12-22

-- Step 1: Add is_spectator column to room_players table
ALTER TABLE public.room_players
ADD COLUMN IF NOT EXISTS is_spectator BOOLEAN DEFAULT FALSE;

-- Add comment explaining the column
COMMENT ON COLUMN public.room_players.is_spectator IS 
'Indicates if the player is in spectator mode (can watch but not play). Set to TRUE when a bot has replaced a disconnected player after the 15-second grace period.';

-- Step 2: Update reconnect_player function to set spectator mode
-- Drop existing function (keep same signature for backward compatibility)
DROP FUNCTION IF EXISTS public.reconnect_player(UUID, UUID);

-- Recreate function with spectator logic
CREATE OR REPLACE FUNCTION public.reconnect_player(
  p_room_id UUID,
  p_user_id UUID
)
RETURNS TABLE(
  success BOOLEAN,
  message TEXT,
  is_spectator BOOLEAN,
  room_state JSONB
) AS $$
DECLARE
  v_player_record RECORD;
  v_bot_replaced BOOLEAN;
  v_room_state JSONB;
  v_room_status TEXT;
BEGIN
  -- Step 1: Check if room exists and is active
  SELECT status INTO v_room_status
  FROM public.rooms
  WHERE id = p_room_id AND status IN ('waiting', 'playing');
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Room not found or game ended', FALSE, NULL::JSONB;
    RETURN;
  END IF;
  
  -- Step 2: Find player in room_players
  SELECT * INTO v_player_record
  FROM public.room_players
  WHERE user_id = p_user_id AND room_id = p_room_id;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Player not in this room', FALSE, NULL::JSONB;
    RETURN;
  END IF;
  
  -- Step 3: Check if bot has replaced this player (connection_status = 'replaced_by_bot')
  v_bot_replaced := v_player_record.connection_status = 'replaced_by_bot';
  
  -- Step 4: Set spectator mode if bot has replaced player
  IF v_bot_replaced THEN
    -- Update player to spectator mode (can watch but not play)
    UPDATE public.room_players
    SET 
      is_spectator = TRUE,
      connection_status = 'connected', -- Allow them to watch
      last_seen_at = NOW()
    WHERE user_id = p_user_id AND room_id = p_room_id;
    
    -- Get current room state
    SELECT jsonb_build_object(
      'room_id', r.id,
      'room_code', r.code,
      'status', r.status,
      'current_player_position', r.current_player_position,
      'spectator_position', v_player_record.position
    ) INTO v_room_state
    FROM public.rooms r
    WHERE r.id = p_room_id;
    
    RETURN QUERY SELECT TRUE, 'Reconnected as spectator (bot replaced you)', TRUE, v_room_state;
    RETURN;
  END IF;
  
  -- Step 5: Normal reconnection (no bot replacement)
  -- Restore player from bot if was disconnected
  UPDATE public.room_players
  SET 
    is_spectator = FALSE,
    connection_status = 'connected',
    last_seen_at = NOW(),
    disconnected_at = NULL,
    is_bot = FALSE
  WHERE user_id = p_user_id AND room_id = p_room_id;
  
  -- Get current room state
  SELECT jsonb_build_object(
    'room_id', r.id,
    'room_code', r.code,
    'status', r.status,
    'current_player_position', r.current_player_position
  ) INTO v_room_state
  FROM public.rooms r
  WHERE r.id = p_room_id;
  
  RETURN QUERY SELECT TRUE, 'Reconnected successfully', FALSE, v_room_state;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.reconnect_player(UUID, UUID) TO authenticated;

-- Add comment explaining the function
COMMENT ON FUNCTION public.reconnect_player(UUID, UUID) IS
'Handles player reconnection to a room. Sets is_spectator=TRUE if a bot has replaced the player after disconnection grace period. Returns success status, message, spectator flag, and room state.';

-- Step 3: Create index on is_spectator for efficient queries
CREATE INDEX IF NOT EXISTS idx_room_players_is_spectator 
ON public.room_players(is_spectator)
WHERE is_spectator = TRUE;

-- Add comment for index
COMMENT ON INDEX idx_room_players_is_spectator IS
'Optimizes queries filtering for spectators. Partial index only includes TRUE values for efficiency.';
