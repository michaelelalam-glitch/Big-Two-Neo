-- ============================================================================
-- CRITICAL FIX: Change username unique constraint from GLOBAL to PER-ROOM
-- ============================================================================
-- Issue: Global unique constraint on room_players.username prevents bots
-- from having same username across different rooms. When starting a second
-- game with bots named "Bot 1", "Bot 2", "Bot 3", the constraint fails:
-- ERROR: duplicate key value violates unique constraint "idx_room_players_username_global_unique"
--
-- Root Cause: The function creates bots with simple names "Bot 1", "Bot 2", "Bot 3"
-- but the constraint enforces GLOBAL uniqueness (across ALL rooms), not per-room.
--
-- Fix: Change constraint from GLOBAL to PER-ROOM scope:
-- - DROP: idx_room_players_username_global_unique (GLOBAL)
-- - CREATE: idx_room_players_username_per_room (SCOPED to room_id + username)
--
-- Impact: Allows multiple rooms to have "Bot 1", "Bot 2", "Bot 3" simultaneously.
-- Usernames only need to be unique WITHIN each room, not across all rooms.

-- Drop the broken global constraint
DROP INDEX IF EXISTS idx_room_players_username_global_unique;

-- Create new per-room scoped constraint
-- This allows "Bot 1" to exist in multiple rooms simultaneously
-- but prevents duplicate usernames within the same room
CREATE UNIQUE INDEX idx_room_players_username_per_room
ON room_players (room_id, LOWER(username))
WHERE username IS NOT NULL;

COMMENT ON INDEX idx_room_players_username_per_room IS 'Enforce unique usernames per room (not globally). Allows bots to have same names across different games.';
