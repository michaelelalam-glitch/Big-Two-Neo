-- Migration: Add account deletion function
-- Created: 2025-12-17
-- Purpose: Safely delete user account and all associated data

-- Function to delete the current authenticated user's account and all their data
-- This cascades through all related tables
-- SECURITY: Uses auth.uid() to prevent horizontal privilege escalation
CREATE OR REPLACE FUNCTION delete_user_account()
RETURNS VOID AS $$
DECLARE
  target_user UUID := auth.uid();
BEGIN
  -- Ensure we have an authenticated user context
  IF target_user IS NULL THEN
    RAISE EXCEPTION 'delete_user_account: auth.uid() is null. This function must be called in an authenticated context.';
  END IF;

  -- Delete from player_stats (no cascade needed - direct delete)
  DELETE FROM player_stats WHERE player_id = target_user;
  
  -- Delete from room_players (removes user from any active rooms)
  DELETE FROM room_players WHERE user_id = target_user;
  
  -- Delete from profiles (this is the main user profile)
  DELETE FROM profiles WHERE id = target_user;
  
  -- Note: Rooms where user is host should be handled by triggers
  -- or we can update host_id to NULL for those rooms
  UPDATE rooms SET host_id = NULL WHERE host_id = target_user;
  
  -- Log the deletion (for admin/audit purposes)
  RAISE NOTICE 'User account deleted: %', target_user;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users (they can only delete their own account)
GRANT EXECUTE ON FUNCTION delete_user_account() TO authenticated;

-- Add RLS policy to ensure users can only delete their own account
-- Note: The actual auth.users deletion must be handled by Supabase Auth API
-- This function only deletes the user's data from our tables

COMMENT ON FUNCTION delete_user_account() IS 
'Safely deletes the current authenticated user account''s data and all associated records. Uses auth.uid() to prevent unauthorized deletion. Does not delete from auth.users (use Supabase Auth API for that)';
