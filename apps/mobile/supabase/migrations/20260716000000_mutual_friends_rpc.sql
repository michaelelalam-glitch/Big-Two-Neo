-- Migration: Add SECURITY DEFINER RPC for mutual friends count
-- Problem: RLS policy friendships_select_own restricts SELECT on friendships to
-- auth.uid() = requester_id OR auth.uid() = addressee_id. This means a user
-- cannot see another user's friendships with third parties, so the client-side
-- mutual friends query always returns 0.
-- Solution: A SECURITY DEFINER function that runs with elevated privileges to
-- count mutual friends between the calling user and a target user.

CREATE OR REPLACE FUNCTION get_mutual_friends_count(p_other_user_id uuid)
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
REVOKE ALL ON FUNCTION get_mutual_friends_count(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_mutual_friends_count(uuid) TO authenticated;
