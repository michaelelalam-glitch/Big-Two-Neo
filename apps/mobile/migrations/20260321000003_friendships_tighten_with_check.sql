-- Task #646 (WITH CHECK Hardening): Prevent UPDATE policies from allowing
-- row mutation beyond the intended fields.
--
-- Issue: The prior WITH CHECK clauses only verified status, leaving
-- requester_id / addressee_id writable. An adversarial client could accept
-- a pending request while also mutating the parties to create an accepted
-- friendship between arbitrary users.
--
-- Fix: Re-create both UPDATE policies so WITH CHECK also asserts that the
-- updated row still involves auth.uid().

DROP POLICY IF EXISTS "friendships_accept_request" ON public.friendships;
DROP POLICY IF EXISTS "friendships_update_favorite" ON public.friendships;

-- Policy A: Only the addressee may accept a pending request.
--           WITH CHECK additionally confirms auth.uid() is still the addressee
--           in the post-update row (prevents switching parties during accept).
CREATE POLICY "friendships_accept_request"
  ON public.friendships FOR UPDATE
  USING (auth.uid() = addressee_id AND status = 'pending')
  WITH CHECK (auth.uid() = addressee_id AND status = 'accepted');

-- Policy B: Either party may toggle is_favorite on an accepted friendship.
--           WITH CHECK ensures status cannot change and the updated row still
--           involves the current user.
CREATE POLICY "friendships_update_favorite"
  ON public.friendships FOR UPDATE
  USING (
    (auth.uid() = requester_id OR auth.uid() = addressee_id)
    AND status = 'accepted'
  )
  WITH CHECK (
    status = 'accepted'
    AND (auth.uid() = requester_id OR auth.uid() = addressee_id)
  );
