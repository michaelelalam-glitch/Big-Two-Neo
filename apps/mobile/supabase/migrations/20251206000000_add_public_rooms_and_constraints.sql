-- Add public/private room support and enforce single-room membership
-- Migration: 20251206000000

-- Add is_public column to rooms table
ALTER TABLE rooms 
ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT TRUE;

-- Add index for finding public rooms
CREATE INDEX IF NOT EXISTS idx_rooms_is_public_status ON rooms(is_public, status) WHERE is_public = TRUE AND status = 'waiting';

-- Create function to check if user is already in a room
CREATE OR REPLACE FUNCTION check_user_not_in_room()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if user is already in ANY OTHER room (allows idempotent inserts to same room)
  IF EXISTS (
    SELECT 1 FROM room_players 
    WHERE user_id = NEW.user_id 
    AND room_id != NEW.room_id
  ) THEN
    RAISE EXCEPTION 'User is already in another room. Leave that room first.'
      USING ERRCODE = 'unique_violation';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to enforce single-room membership
DROP TRIGGER IF EXISTS enforce_single_room_membership ON room_players;
CREATE TRIGGER enforce_single_room_membership
  BEFORE INSERT ON room_players
  FOR EACH ROW
  EXECUTE FUNCTION check_user_not_in_room();

-- Add comment for documentation
COMMENT ON COLUMN rooms.is_public IS 'TRUE for public rooms (Quick Play), FALSE for private rooms (created via Create Room with code sharing)';
COMMENT ON TRIGGER enforce_single_room_membership ON room_players IS 'Prevents INSERT operations that would place a user in multiple rooms';
