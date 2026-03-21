-- Task #646: Friendships & Social Features
-- Creates the friendships table to support:
--   - Friend requests (pending → accepted)
--   - Favouriting friends
--   - Querying online friends via Supabase Presence (client-side)
-- Relies on the existing index on profiles.username for fast leaderboard friend checks.

-- ============================================================
-- 1. friendships table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.friendships (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  addressee_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  is_favorite     boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- prevent self-friendship and duplicate pairs
  CONSTRAINT friendships_no_self_link   CHECK (requester_id <> addressee_id)
  -- NOTE: The directional UNIQUE constraint is intentionally omitted here.
  -- Migration 20260321000001 adds a canonical (unordered) unique index instead,
  -- so that (A→B) and (B→A) cannot both exist.
);

-- ============================================================
-- 2. Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS friendships_requester_idx ON public.friendships (requester_id);
CREATE INDEX IF NOT EXISTS friendships_addressee_idx ON public.friendships (addressee_id);
CREATE INDEX IF NOT EXISTS friendships_status_idx    ON public.friendships (status);

-- ============================================================
-- 3. updated_at trigger (reuse pattern from existing tables)
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_friendships_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS friendships_set_updated_at ON public.friendships;
CREATE TRIGGER friendships_set_updated_at
  BEFORE UPDATE ON public.friendships
  FOR EACH ROW EXECUTE FUNCTION public.set_friendships_updated_at();

-- ============================================================
-- 4. Row-Level Security
-- ============================================================
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;

-- Users can view any row where they are requester OR addressee
CREATE POLICY "friendships_select_own"
  ON public.friendships FOR SELECT
  USING (
    auth.uid() = requester_id
    OR auth.uid() = addressee_id
  );

-- A user can only INSERT a row where they are the requester.
-- Enforce status='pending' on insert to prevent a malicious client from
-- creating an already-accepted friendship without going through the
-- accept-request UPDATE flow.
CREATE POLICY "friendships_insert_own"
  ON public.friendships FOR INSERT
  WITH CHECK (auth.uid() = requester_id AND status = 'pending');

-- Either party may UPDATE. Note: no WITH CHECK is applied here; the
-- corresponding hardening (self-accept prevention, party immutability) is
-- applied in migrations 20260321000002 and 20260321000004.
CREATE POLICY "friendships_update_own"
  ON public.friendships FOR UPDATE
  USING (
    auth.uid() = requester_id
    OR auth.uid() = addressee_id
  );

-- Either party may DELETE (unfriend)
CREATE POLICY "friendships_delete_own"
  ON public.friendships FOR DELETE
  USING (
    auth.uid() = requester_id
    OR auth.uid() = addressee_id
  );
