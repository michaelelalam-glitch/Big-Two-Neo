-- Task #646 (Security Fix): Friendships table security hardening
--
-- Applies two improvements flagged in code review:
--   1. Replace directional UNIQUE(requester_id, addressee_id) with a
--      canonical (unordered) unique index so A→B and B→A cannot coexist.
--   2. Add WITH CHECK to the UPDATE RLS policy so the original requester
--      cannot self-accept their own outgoing request.

-- ============================================================
-- 1. Canonical pair unique index (replaces directional UNIQUE constraint)
-- ============================================================
ALTER TABLE public.friendships DROP CONSTRAINT IF EXISTS friendships_unique_pair;

CREATE UNIQUE INDEX IF NOT EXISTS friendships_canonical_pair_idx
  ON public.friendships (
    LEAST(requester_id::text, addressee_id::text),
    GREATEST(requester_id::text, addressee_id::text)
  );

-- ============================================================
-- 2. Tighten UPDATE RLS policy with WITH CHECK
-- ============================================================
DROP POLICY IF EXISTS "friendships_update_own" ON public.friendships;

CREATE POLICY "friendships_update_own"
  ON public.friendships FOR UPDATE
  USING (
    auth.uid() = requester_id OR auth.uid() = addressee_id
  )
  WITH CHECK (
    -- Only the addressee may set status = 'accepted'.
    -- The requester cannot self-accept their own outgoing request.
    NOT (status = 'accepted' AND requester_id = auth.uid())
  );
