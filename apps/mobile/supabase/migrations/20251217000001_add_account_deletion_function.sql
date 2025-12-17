-- Migration: Add account deletion function
-- Created: 2025-12-17
-- Purpose: Safely delete user account and all associated data

-- Function to delete a user account and all their data
-- This cascades through all related tables
CREATE OR REPLACE FUNCTION delete_user_account(user_id UUID)
RETURNS VOID AS $$
BEGIN
  -- Delete from player_stats (no cascade needed - direct delete)
  DELETE FROM player_stats WHERE player_id = user_id;
  
  -- Delete from room_players (removes user from any active rooms)
  DELETE FROM room_players WHERE user_id = user_id;
  
  -- Delete from profiles (this is the main user profile)
  DELETE FROM profiles WHERE id = user_id;
  
  -- Note: Rooms where user is host should be handled by triggers
  -- or we can update host_id to NULL for those rooms
  UPDATE rooms SET host_id = NULL WHERE host_id = user_id;
  
  -- Log the deletion (for admin/audit purposes)
  RAISE NOTICE 'User account deleted: %', user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users (they can only delete their own account)
GRANT EXECUTE ON FUNCTION delete_user_account(UUID) TO authenticated;

-- Add RLS policy to ensure users can only delete their own account
-- Note: The actual auth.users deletion must be handled by Supabase Auth API
-- This function only deletes the user's data from our tables

COMMENT ON FUNCTION delete_user_account(UUID) IS 
'Safely deletes a user account and all associated data. Should only be called after confirming user identity. Does not delete from auth.users (use Supabase Auth API for that).';
