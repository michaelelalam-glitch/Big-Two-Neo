-- Task #646 (Policy Split): Split the broad UPDATE policy into two scoped policies.
-- Also removes the unnecessary ::text cast from the canonical pair unique index.
--
-- Issue: The previous WITH CHECK (NOT (status='accepted' AND requester_id=auth.uid()))
-- inadvertently blocked the requester from toggling is_favorite after the
-- friendship was accepted, because status='accepted' and requester_id=auth.uid()
-- both remain true even for innocent is_favorite updates.
--
-- Fix: Replace with two explicit policies that each cover one narrow case.

-- ============================================================
-- 1. Fix canonical pair index (remove unnecessary ::text cast)
-- ============================================================
DROP INDEX IF EXISTS friendships_canonical_pair_idx;

CREATE UNIQUE INDEX IF NOT EXISTS friendships_canonical_pair_idx
  ON public.friendships (
    LEAST(requester_id, addressee_id),
    GREATEST(requester_id, addressee_id)
  );

-- ============================================================
-- 2. Replace broad UPDATE policy with two scoped policies
-- ============================================================
DROP POLICY IF EXISTS "friendships_update_own" ON public.friendships;

-- Policy A: Only the addressee may accept a pending request.
CREATE POLICY "friendships_accept_request"
  ON public.friendships FOR UPDATE
  USING (auth.uid() = addressee_id AND status = 'pending')
  WITH CHECK (status = 'accepted');

-- Policy B: Either party may toggle is_favorite on an accepted friendship.
--           WITH CHECK ensures status cannot be downgraded from 'accepted'.
CREATE POLICY "friendships_update_favorite"
  ON public.friendships FOR UPDATE
  USING (
    (auth.uid() = requester_id OR auth.uid() = addressee_id)
    AND status = 'accepted'
  )
  WITH CHECK (status = 'accepted');
