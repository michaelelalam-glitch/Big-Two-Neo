-- Migration: Add SECURITY DEFINER RPC for mutual friends list
-- Returns the list of mutual friends (id + username) between the calling user
-- and a target user.  Complements get_mutual_friends_count which only returns
-- the count.
--
-- Dependency: public.friendships table and public.profiles table must exist.

CREATE OR REPLACE FUNCTION public.get_mutual_friends_list(p_other_user_id uuid)
RETURNS TABLE(friend_id uuid, username text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT mf.friend_id, p.username
  FROM (
    SELECT CASE
      WHEN f1.requester_id = auth.uid() THEN f1.addressee_id
      ELSE f1.requester_id
    END AS friend_id
    FROM public.friendships f1
    WHERE f1.status = 'accepted'
      AND (f1.requester_id = auth.uid() OR f1.addressee_id = auth.uid())
    INTERSECT
    SELECT CASE
      WHEN f2.requester_id = p_other_user_id THEN f2.addressee_id
      ELSE f2.requester_id
    END AS friend_id
    FROM public.friendships f2
    WHERE f2.status = 'accepted'
      AND (f2.requester_id = p_other_user_id OR f2.addressee_id = p_other_user_id)
  ) mf
  JOIN public.profiles p ON p.id = mf.friend_id
  ORDER BY p.username ASC;
$$;

-- Grant execute to authenticated users only
REVOKE ALL ON FUNCTION public.get_mutual_friends_list(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_mutual_friends_list(uuid) TO authenticated;
