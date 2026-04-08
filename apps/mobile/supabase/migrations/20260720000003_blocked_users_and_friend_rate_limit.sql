-- ============================================================================
-- Sprint 4 PR-4F: blocked_users table + friend request DB rate limiting
--
-- H20: blocked_users table was completely missing. Creates it with RLS so
--      users can only see/manage their own block entries.
-- M29: Add DB-side trigger to enforce friend request rate limiting (max 10
--      requests per user per hour) preventing abuse via direct API calls that
--      bypass the client-side useFriends.ts throttle.
-- ============================================================================

-- ── blocked_users ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.blocked_users (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  blocker_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at      timestamptz DEFAULT NOW() NOT NULL,
  CONSTRAINT blocked_users_unique UNIQUE (blocker_id, blocked_id),
  -- Prevent self-blocking
  CONSTRAINT blocked_users_no_self CHECK (blocker_id <> blocked_id)
);

-- Index for fast lookups in both directions
CREATE INDEX IF NOT EXISTS idx_blocked_users_blocker ON public.blocked_users (blocker_id);
CREATE INDEX IF NOT EXISTS idx_blocked_users_blocked ON public.blocked_users (blocked_id);

-- RLS
ALTER TABLE public.blocked_users ENABLE ROW LEVEL SECURITY;

-- Users can view their own block entries (rows where they are the blocker)
DROP POLICY IF EXISTS "blocked_users_select_own" ON public.blocked_users;
CREATE POLICY "blocked_users_select_own"
  ON public.blocked_users FOR SELECT
  USING (auth.uid() = blocker_id);

-- Users can only insert rows where they are the blocker
DROP POLICY IF EXISTS "blocked_users_insert_own" ON public.blocked_users;
CREATE POLICY "blocked_users_insert_own"
  ON public.blocked_users FOR INSERT
  WITH CHECK (auth.uid() = blocker_id);

-- Users can only delete their own block entries
DROP POLICY IF EXISTS "blocked_users_delete_own" ON public.blocked_users;
CREATE POLICY "blocked_users_delete_own"
  ON public.blocked_users FOR DELETE
  USING (auth.uid() = blocker_id);

-- ── Friend request DB-side rate limit trigger (M29) ──────────────────────────
-- Limits each user to 10 friend requests per hour to prevent spam via direct
-- API calls that fully bypass the client-side throttle in useFriends.ts.
-- Uses the append-only rate_limit_tracking counter (upsert_rate_limit_counter)
-- so deletion of older pending rows cannot bypass this limit.
-- Consistent with enforce_create_room_rate_limit (same table + ERRCODE P0429).

CREATE OR REPLACE FUNCTION public.check_friend_request_rate_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  MAX_REQUESTS_PER_HOUR CONSTANT integer := 10;
  WINDOW_SECS           CONSTANT integer := 3600;
  v_caller_uid uuid;
  v_attempts   integer;
BEGIN
  -- Only rate-limit INSERT of new pending requests
  IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
    -- auth.uid() is null when called from service-role or direct SQL — skip check.
    v_caller_uid := auth.uid();
    IF v_caller_uid IS NULL THEN
      RETURN NEW;
    END IF;

    -- Increment the append-only counter (deletion-proof: counts all attempts,
    -- not just rows still present in friendships).
    v_attempts := upsert_rate_limit_counter(v_caller_uid, 'friend_request', WINDOW_SECS);

    IF v_attempts > MAX_REQUESTS_PER_HOUR THEN
      RAISE EXCEPTION 'Maximum 10 friend requests per hour exceeded'
        USING ERRCODE = 'P0429';  -- consistent with enforce_create_room_rate_limit
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ── Remove existing friendships when a block is created ───────────────────────
-- When a user blocks another, any pending/accepted friendship between them should
-- be removed to prevent awkward states (friends who have each other blocked).

CREATE OR REPLACE FUNCTION public.cleanup_friendship_on_block()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  DELETE FROM public.friendships
  WHERE (requester_id = NEW.blocker_id AND addressee_id = NEW.blocked_id)
     OR (requester_id = NEW.blocked_id AND addressee_id = NEW.blocker_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_friendship_on_block ON public.blocked_users;
CREATE TRIGGER trg_cleanup_friendship_on_block
  AFTER INSERT ON public.blocked_users
  FOR EACH ROW
  EXECUTE FUNCTION public.cleanup_friendship_on_block();

-- ── Prevent friend requests to/from blocked users ────────────────────────────

CREATE OR REPLACE FUNCTION public.check_not_blocked_on_friend_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_blocked bool;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.blocked_users
       WHERE (blocker_id = NEW.requester_id AND blocked_id = NEW.addressee_id)
          OR (blocker_id = NEW.addressee_id AND blocked_id = NEW.requester_id)
    ) INTO v_blocked;

    IF v_blocked THEN
      RAISE EXCEPTION 'Cannot send friend request to or from a blocked user'
        USING ERRCODE = 'P0001',
              DETAIL = 'friend_request_blocked';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Apply triggers on public.friendships only when that table exists in the
-- CLI-managed schema.  This keeps a fresh `supabase db reset` / `supabase db push`
-- working even if friendships is still created by a legacy/manual migration.
-- Uses EXECUTE (dynamic SQL) so DDL can run inside the conditional block.
-- Trigger order: BEFORE INSERT triggers fire alphabetically by name.
-- trg_00_no_friend_request_when_blocked must run BEFORE
-- trg_01_friend_request_rate_limit so blocked requests are rejected before
-- consuming the sender's rate-limit budget.
-- Both referenced trigger functions (check_not_blocked_on_friend_request and
-- check_friend_request_rate_limit) are defined above this block.
DO $$
BEGIN
  IF to_regclass('public.friendships') IS NOT NULL THEN
    -- Idempotent: drop both old name and new name before (re-)creating.
    EXECUTE 'DROP TRIGGER IF EXISTS trg_friend_request_rate_limit ON public.friendships';
    EXECUTE 'DROP TRIGGER IF EXISTS trg_01_friend_request_rate_limit ON public.friendships';
    EXECUTE '
      CREATE TRIGGER trg_01_friend_request_rate_limit
        BEFORE INSERT ON public.friendships
        FOR EACH ROW
        EXECUTE FUNCTION public.check_friend_request_rate_limit()
    ';

    EXECUTE 'DROP TRIGGER IF EXISTS trg_no_friend_request_when_blocked ON public.friendships';
    EXECUTE 'DROP TRIGGER IF EXISTS trg_00_no_friend_request_when_blocked ON public.friendships';
    EXECUTE '
      CREATE TRIGGER trg_00_no_friend_request_when_blocked
        BEFORE INSERT ON public.friendships
        FOR EACH ROW
        EXECUTE FUNCTION public.check_not_blocked_on_friend_request()
    ';
  ELSE
    RAISE WARNING
      'public.friendships not found — skipping friend-request triggers. '
      'Apply the migration that creates friendships first if these triggers are needed.';
  END IF;
END $$;

-- NOTE: The triggers on public.friendships (trg_00_no_friend_request_when_blocked
-- and trg_01_friend_request_rate_limit) are created inside the DO $$ conditional
-- block above, which guards against public.friendships not existing yet.
