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
CREATE POLICY "blocked_users_select_own"
  ON public.blocked_users FOR SELECT
  USING (auth.uid() = blocker_id);

-- Users can only insert rows where they are the blocker
CREATE POLICY "blocked_users_insert_own"
  ON public.blocked_users FOR INSERT
  WITH CHECK (auth.uid() = blocker_id);

-- Users can only delete their own block entries
CREATE POLICY "blocked_users_delete_own"
  ON public.blocked_users FOR DELETE
  USING (auth.uid() = blocker_id);

-- ── Friend request DB-side rate limit trigger (M29) ──────────────────────────
-- Limits each user to 10 friend requests per hour to prevent spam via direct
-- API calls that fully bypass the client-side throttle in useFriends.ts.

CREATE OR REPLACE FUNCTION public.check_friend_request_rate_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count int;
  v_window_start timestamptz;
BEGIN
  -- Only rate-limit INSERT of new pending requests
  IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
    v_window_start := NOW() - INTERVAL '1 hour';
    SELECT COUNT(*)
      INTO v_count
      FROM public.friendships
     WHERE requester_id = NEW.requester_id
       AND status = 'pending'
       AND created_at >= v_window_start;

    IF v_count >= 10 THEN
      RAISE EXCEPTION 'friend_request_rate_limit'
        USING DETAIL = 'Maximum 10 friend requests per hour exceeded',
              ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_friend_request_rate_limit ON public.friendships;
CREATE TRIGGER trg_friend_request_rate_limit
  BEFORE INSERT ON public.friendships
  FOR EACH ROW
  EXECUTE FUNCTION public.check_friend_request_rate_limit();

-- ── Remove existing friendships when a block is created ───────────────────────
-- When a user blocks another, any pending/accepted friendship between them should
-- be removed to prevent awkward states (friends who have each other blocked).

CREATE OR REPLACE FUNCTION public.cleanup_friendship_on_block()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
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
      RAISE EXCEPTION 'friend_request_blocked'
        USING DETAIL = 'Cannot send friend request to or from a blocked user',
              ERRCODE = 'P0002';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_no_friend_request_when_blocked ON public.friendships;
CREATE TRIGGER trg_no_friend_request_when_blocked
  BEFORE INSERT ON public.friendships
  FOR EACH ROW
  EXECUTE FUNCTION public.check_not_blocked_on_friend_request();
