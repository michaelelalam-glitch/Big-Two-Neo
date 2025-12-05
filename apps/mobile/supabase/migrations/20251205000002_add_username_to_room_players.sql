-- Add username column to room_players for display purposes
-- This allows us to show player names without additional joins to profiles table

ALTER TABLE room_players 
ADD COLUMN IF NOT EXISTS username VARCHAR(50);

-- Update existing records to pull username from profiles (if any exist)
UPDATE room_players rp
SET username = p.username
FROM profiles p
WHERE rp.user_id = p.id
AND rp.username IS NULL;

-- Create index for username lookups
CREATE INDEX IF NOT EXISTS idx_room_players_username ON room_players(username);
