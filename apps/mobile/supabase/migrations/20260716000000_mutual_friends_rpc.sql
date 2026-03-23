-- Migration: Add SECURITY DEFINER RPC for mutual friends count
-- Problem: RLS policy friendships_select_own restricts SELECT on friendships to
-- auth.uid() = requester_id OR auth.uid() = addressee_id. This means a user
-- cannot see another user's friendships with third parties, so the client-side
-- mutual friends query always returns 0.
-- Solution: A SECURITY DEFINER function that runs with elevated privileges to
-- count mutual friends between the calling user and a target user.
--
-- Dependency note: This function queries the `public.friendships` table which
-- is part of the pre-existing Supabase project schema (established before the
-- migration system was introduced). On a fresh `supabase db reset`, the
-- baseline migration (00000000000000_baseline.sql) must include the friendships
-- table definition, or this migration must be applied after it is created.

-- Precondition: abort early with a clear error if friendships table is missing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'friendships'
  ) THEN
    RAISE EXCEPTION
      'Migration 20260716000000_mutual_friends_rpc requires public.friendships '
      'to exist. Apply the baseline migration (00000000000000_baseline.sql) first.';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.get_mutual_friends_count(p_other_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT count(*)::integer
  FROM (
    -- Current user's accepted friends
    SELECT CASE
      WHEN requester_id = auth.uid() THEN addressee_id
      ELSE requester_id
    END AS friend_id
    FROM friendships
    WHERE status = 'accepted'
      AND (requester_id = auth.uid() OR addressee_id = auth.uid())
  ) my_friends
  INNER JOIN (
    -- Target user's accepted friends
    SELECT CASE
      WHEN requester_id = p_other_user_id THEN addressee_id
      ELSE requester_id
    END AS friend_id
    FROM friendships
    WHERE status = 'accepted'
      AND (requester_id = p_other_user_id OR addressee_id = p_other_user_id)
  ) their_friends
  ON my_friends.friend_id = their_friends.friend_id;
$$;

-- Grant execute to authenticated users only
REVOKE ALL ON FUNCTION public.get_mutual_friends_count(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_mutual_friends_count(uuid) TO authenticated;
