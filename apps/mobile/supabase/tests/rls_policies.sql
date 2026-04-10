-- ============================================================================
-- RLS POLICY TESTS  (pgTAP)
-- Task #22 (Tier 4 — P14-2)
--
-- Tests that each critical table's Row Level Security policies enforce:
--   • Anonymous role  → zero rows visible, writes blocked
--   • Authenticated user → only own rows visible / editable
--   • Service-role    → full access (bypasses RLS)
--
-- Run locally:   supabase test db
-- Run in CI:     supabase test db --project-ref <project-id>
--
-- The entire suite runs inside a single transaction rolled back at the end
-- so it leaves no test data behind.
-- ============================================================================

BEGIN;

-- Plan must equal the exact number of SELECT ok() / is() calls below.
SELECT plan(34);

-- ============================================================================
-- HELPERS
-- ============================================================================

-- Seed a throwaway authenticated user for all ownership tests.
-- auth.users is managed by Supabase; we insert into it directly only in
-- test context (service-role connection that bypasses RLS).
DO $$
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  )
  VALUES (
    'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated', 'authenticated',
    'pgtap-owner@test.invalid',
    crypt('test-password', gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb
  )
  ON CONFLICT (id) DO NOTHING;

  -- A second user — must NOT be able to see user 1's data
  INSERT INTO auth.users (
    id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  )
  VALUES (
    'bbbbbbbb-0000-0000-0000-000000000002'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated', 'authenticated',
    'pgtap-other@test.invalid',
    crypt('test-password', gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb
  )
  ON CONFLICT (id) DO NOTHING;
END;
$$;

-- Seed an owner profile
INSERT INTO public.profiles (id, username, created_at, updated_at)
VALUES (
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  'pgtap_owner',
  now(), now()
)
ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username;

-- Seed a second profile (other user)
INSERT INTO public.profiles (id, username, created_at, updated_at)
VALUES (
  'bbbbbbbb-0000-0000-0000-000000000002'::uuid,
  'pgtap_other',
  now(), now()
)
ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username;

-- Seed a test room owned by user 1
DO $$
DECLARE
  v_room_id uuid := 'cccccccc-0000-0000-0000-000000000003'::uuid;
BEGIN
  -- Insert without RLS (service-role context in setup block)
  INSERT INTO public.rooms (id, room_code, host_id, status, created_at, updated_at)
  VALUES (
    v_room_id, 'PGTAP1', 'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
    'waiting', now(), now()
  )
  ON CONFLICT (id) DO NOTHING;

  -- Put user 1 into the room
  INSERT INTO public.room_players (room_id, user_id, player_index, is_host, is_ready, is_bot, created_at)
  VALUES (
    v_room_id,
    'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
    0, true, false, false, now()
  )
  ON CONFLICT (room_id, user_id) DO NOTHING;
END;
$$;

-- ============================================================================
-- SECTION 1 — profiles table
-- ============================================================================

-- 1a. Anonymous role cannot read profiles
SET LOCAL ROLE anon;
SELECT is(
  (SELECT count(*)::int FROM public.profiles),
  0,
  'anon: cannot read any row from public.profiles'
);

-- 1b. Anonymous role cannot insert into profiles
SELECT throws_ok(
  $$
    INSERT INTO public.profiles (id, username, created_at, updated_at)
    VALUES ('dddddddd-0000-0000-0000-000000000004'::uuid, 'anon_hacker', now(), now())
  $$,
  'new row violates row-level security policy for table "profiles"',
  'anon: INSERT into profiles is blocked by RLS'
);

RESET ROLE;

-- 1c. Owner can read their own profile row
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM public.profiles WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'::uuid),
  1,
  'authenticated owner: can read own profile'
);

-- 1d. Owner cannot read another user's profile (or row count is limited to own rows)
SELECT ok(
  (SELECT count(*)::int FROM public.profiles WHERE id = 'bbbbbbbb-0000-0000-0000-000000000002'::uuid) = 0,
  'authenticated owner: cannot read other user profile'
);

RESET ROLE;

-- 1e. Service-role sees all profiles
SELECT ok(
  (SELECT count(*)::int FROM public.profiles) >= 2,
  'service-role: can read all profiles'
);

-- ============================================================================
-- SECTION 2 — push_tokens table
-- ============================================================================

-- Insert a test push token for user 1
INSERT INTO public.push_tokens (user_id, token, platform, created_at, updated_at)
VALUES (
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  'ExponentPushToken[test-token-owner]',
  'ios', now(), now()
)
ON CONFLICT DO NOTHING;

INSERT INTO public.push_tokens (user_id, token, platform, created_at, updated_at)
VALUES (
  'bbbbbbbb-0000-0000-0000-000000000002'::uuid,
  'ExponentPushToken[test-token-other]',
  'android', now(), now()
)
ON CONFLICT DO NOTHING;

-- 2a. Anonymous cannot read push_tokens
SET LOCAL ROLE anon;
SELECT is(
  (SELECT count(*)::int FROM public.push_tokens),
  0,
  'anon: cannot read any push_tokens row'
);
RESET ROLE;

-- 2b. Owner can read own tokens
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT ok(
  (SELECT count(*)::int FROM public.push_tokens
    WHERE user_id = 'aaaaaaaa-0000-0000-0000-000000000001'::uuid) >= 1,
  'authenticated owner: can read own push_tokens'
);

-- 2c. Owner cannot read other user's tokens
SELECT is(
  (SELECT count(*)::int FROM public.push_tokens
    WHERE user_id = 'bbbbbbbb-0000-0000-0000-000000000002'::uuid),
  0,
  'authenticated owner: cannot read other user push_tokens'
);
RESET ROLE;

-- ============================================================================
-- SECTION 3 — rooms table
-- ============================================================================

-- 3a. Anonymous cannot read rooms
SET LOCAL ROLE anon;
SELECT is(
  (SELECT count(*)::int FROM public.rooms WHERE room_code = 'PGTAP1'),
  0,
  'anon: cannot read any rooms row'
);
RESET ROLE;

-- 3b. A member of the room can read it
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT ok(
  (SELECT count(*)::int FROM public.rooms WHERE room_code = 'PGTAP1') >= 1,
  'authenticated member: can read own room'
);

-- 3c. A user NOT in the room cannot see it
SET LOCAL "request.jwt.claims" TO '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
SELECT is(
  (SELECT count(*)::int FROM public.rooms WHERE room_code = 'PGTAP1'),
  0,
  'authenticated non-member: cannot read room they are not in'
);
RESET ROLE;

-- ============================================================================
-- SECTION 4 — room_players table
-- ============================================================================

-- 4a. Anonymous cannot read room_players
SET LOCAL ROLE anon;
SELECT is(
  (SELECT count(*)::int FROM public.room_players
    WHERE room_id = 'cccccccc-0000-0000-0000-000000000003'::uuid),
  0,
  'anon: cannot read room_players'
);
RESET ROLE;

-- 4b. Member of the room can read room_players for that room
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT ok(
  (SELECT count(*)::int FROM public.room_players
    WHERE room_id = 'cccccccc-0000-0000-0000-000000000003'::uuid) >= 1,
  'authenticated member: can read own room_players rows'
);

-- 4c. Non-member cannot read room_players for that room
SET LOCAL "request.jwt.claims" TO '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
SELECT is(
  (SELECT count(*)::int FROM public.room_players
    WHERE room_id = 'cccccccc-0000-0000-0000-000000000003'::uuid),
  0,
  'authenticated non-member: cannot see room_players for a room they are not in'
);
RESET ROLE;

-- ============================================================================
-- SECTION 5 — player_stats table
-- ============================================================================

-- Insert test stats
INSERT INTO public.player_stats (user_id, elo_rating, games_played, wins, created_at, updated_at)
VALUES (
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  1200, 10, 5, now(), now()
)
ON CONFLICT (user_id) DO UPDATE SET games_played = EXCLUDED.games_played;

INSERT INTO public.player_stats (user_id, elo_rating, games_played, wins, created_at, updated_at)
VALUES (
  'bbbbbbbb-0000-0000-0000-000000000002'::uuid,
  1000, 2, 0, now(), now()
)
ON CONFLICT (user_id) DO UPDATE SET games_played = EXCLUDED.games_played;

-- 5a. Anonymous cannot read player_stats
SET LOCAL ROLE anon;
SELECT is(
  (SELECT count(*)::int FROM public.player_stats),
  0,
  'anon: cannot read player_stats'
);
RESET ROLE;

-- 5b. Authenticated user can read own stats
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT ok(
  (SELECT count(*)::int FROM public.player_stats
    WHERE user_id = 'aaaaaaaa-0000-0000-0000-000000000001'::uuid) >= 1,
  'authenticated: can read own player_stats'
);
RESET ROLE;

-- ============================================================================
-- SECTION 6 — rate_limit_tracking table
-- ============================================================================

-- 6a. Anonymous cannot read rate_limit_tracking
SET LOCAL ROLE anon;
SELECT is(
  (SELECT count(*)::int FROM public.rate_limit_tracking),
  0,
  'anon: cannot read rate_limit_tracking'
);

-- 6b. Anonymous cannot INSERT into rate_limit_tracking
SELECT throws_ok(
  $$
    INSERT INTO public.rate_limit_tracking (user_id, function_name, request_count, window_start)
    VALUES (
      'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
      'test-func', 1, now()
    )
  $$,
  'new row violates row-level security policy for table "rate_limit_tracking"',
  'anon: INSERT into rate_limit_tracking is blocked by RLS'
);
RESET ROLE;

-- ============================================================================
-- SECTION 7 — friendships table
-- ============================================================================

-- Insert a friendship
INSERT INTO public.friendships (user_id, friend_id, status, created_at, updated_at)
VALUES (
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  'bbbbbbbb-0000-0000-0000-000000000002'::uuid,
  'pending', now(), now()
)
ON CONFLICT DO NOTHING;

-- 7a. Anonymous cannot read friendships
SET LOCAL ROLE anon;
SELECT is(
  (SELECT count(*)::int FROM public.friendships),
  0,
  'anon: cannot read friendships'
);
RESET ROLE;

-- 7b. A user can see their own friendships
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT ok(
  (SELECT count(*)::int FROM public.friendships
    WHERE user_id = 'aaaaaaaa-0000-0000-0000-000000000001'::uuid) >= 1,
  'authenticated: can read own friendships'
);
RESET ROLE;

-- ============================================================================
-- SECTION 8 — blocked_users table
-- ============================================================================

-- 8a. Anonymous cannot read blocked_users
SET LOCAL ROLE anon;
SELECT is(
  (SELECT count(*)::int FROM public.blocked_users),
  0,
  'anon: cannot read blocked_users'
);
RESET ROLE;

-- 8b. Authenticated user can only see their own blocks
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT is(
  (SELECT count(*)::int FROM public.blocked_users
    WHERE user_id <> 'aaaaaaaa-0000-0000-0000-000000000001'::uuid),
  0,
  'authenticated: cannot see other users blocked_users rows'
);
RESET ROLE;

-- ============================================================================
-- SECTION 9 — game_history table
-- ============================================================================

-- 9a. Anonymous cannot read game_history
SET LOCAL ROLE anon;
SELECT is(
  (SELECT count(*)::int FROM public.game_history),
  0,
  'anon: cannot read game_history'
);
RESET ROLE;

-- ============================================================================
-- SECTION 10 — waiting_room table
-- ============================================================================

-- 10a. Anonymous cannot read waiting_room
SET LOCAL ROLE anon;
SELECT is(
  (SELECT count(*)::int FROM public.waiting_room),
  0,
  'anon: cannot read waiting_room'
);
RESET ROLE;

-- 10b. Authenticated user can see waiting_room entries (public matchmaking view)
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
-- This test only checks the policy doesn't error; actual count depends on live data
SELECT ok(
  (SELECT count(*)::int FROM public.waiting_room) >= 0,
  'authenticated: can query waiting_room without error'
);
RESET ROLE;

-- ============================================================================
-- SECTION 11 — bot_coordinator_locks table
-- ============================================================================

-- 11a. Anonymous cannot read bot_coordinator_locks
SET LOCAL ROLE anon;
SELECT is(
  (SELECT count(*)::int FROM public.bot_coordinator_locks),
  0,
  'anon: cannot read bot_coordinator_locks'
);
RESET ROLE;

-- ============================================================================
-- Finish
-- ============================================================================
SELECT * FROM finish();

ROLLBACK;
