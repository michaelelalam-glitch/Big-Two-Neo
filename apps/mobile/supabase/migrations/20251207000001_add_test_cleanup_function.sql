-- Migration: Add test cleanup function with authorization checks
-- Date: December 7, 2025
-- Purpose: Provide RLS-bypass cleanup for integration tests with security constraints

-- Drop function if it exists
DROP FUNCTION IF EXISTS test_cleanup_user_data(UUID[]);

-- Create test cleanup function with authorization
CREATE OR REPLACE FUNCTION test_cleanup_user_data(p_user_ids UUID[])
RETURNS VOID
SECURITY DEFINER  -- Bypasses RLS policies
LANGUAGE plpgsql
AS $$
DECLARE
  caller_uid UUID;
  allowed_test_users UUID[] := ARRAY[
    '00817b76-e3c5-4535-8f72-56df66047bb2'::UUID,  -- testUserId1 (tester@big2.app)
    'a3297019-266a-4fa7-be39-39e1f4beed04'::UUID,  -- testUserId2 (guest)
    '2eab6a51-e47b-4c37-bb29-ed998e3ed30b'::UUID,  -- guest user 2
    '4ce1c03a-1b49-4e94-9572-60fe13759e14'::UUID   -- michael user
  ];
  user_id_to_delete UUID;
BEGIN
  -- Get the calling user's ID from JWT
  caller_uid := NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
  
  -- SECURITY: Only allow test users to call this function
  IF caller_uid IS NULL OR NOT (caller_uid = ANY(allowed_test_users)) THEN
    RAISE EXCEPTION 'Unauthorized: Only test users can call this function';
  END IF;
  
  -- Validate each user_id before deletion
  FOREACH user_id_to_delete IN ARRAY p_user_ids
  LOOP
    -- Allow deletion only if user is in the allowed test users list
    IF user_id_to_delete = ANY(allowed_test_users) THEN
      DELETE FROM room_players WHERE user_id = user_id_to_delete;
    ELSE
      -- Unauthorized: trying to delete non-test user data
      RAISE EXCEPTION 'Unauthorized: Cannot delete data for user %', user_id_to_delete;
    END IF;
  END LOOP;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION test_cleanup_user_data(UUID[]) TO authenticated;

-- Add comment
COMMENT ON FUNCTION test_cleanup_user_data(UUID[]) IS 
  'Test cleanup function with authorization. Can only delete data for self or whitelisted test users.';
