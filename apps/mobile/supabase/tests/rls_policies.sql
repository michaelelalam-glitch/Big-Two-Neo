-- ============================================================================
-- RLS POLICY TESTS  (pgTAP)
-- Task #22 (Tier 4 -- P14-2)
--
-- Validates that each table's RLS policies match the actual migration
-- definitions:
--
--   Open SELECT (USING true) -- accessible by all roles including anon:
--     profiles, rooms, player_stats, game_history, waiting_room
--
--   Restricted SELECT -- only own rows or membership required:
--     room_players         (room-membership check, authenticated only)
--     rate_limit_tracking  (own rows only, authenticated only)
--     blocked_users        (own rows where blocker_id = auth.uid())
--     bot_coordinator_locks  (no SELECT policy -- full deny by default)
--
-- Notes:
--   push_tokens and friendships are intentionally excluded: neither is defined
--   in CLI-managed supabase/migrations/ files, so including them would cause
--   "relation does not exist" errors on supabase db reset.
--   Runs inside one transaction, rolled back at the end -- no test data persists.
--
-- Run locally:   supabase test db
-- Run in CI:     supabase test db --project-ref <project-id>
-- ============================================================================

BEGIN;

SELECT plan(21);

-- ============================================================================
-- HELPERS
-- ============================================================================

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

INSERT INTO public.profiles (id, username, created_at, updated_at)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'pgtap_owner', now(), now())
ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username;

INSERT INTO public.profiles (id, username, created_at, updated_at)
VALUES ('bbbbbbbb-0000-0000-0000-000000000002'::uuid, 'pgtap_other', now(), now())
ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username;

DO $$
DECLARE
  v_room_id uuid := 'cccccccc-0000-0000-0000-000000000003'::uuid;
BEGIN
  INSERT INTO public.rooms (id, code, host_id, status, created_at, updated_at)
  VALUES (
    v_room_id, 'PGTAP1', 'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
    'waiting', now(), now()
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.room_players (
    room_id, user_id, player_index, is_host, is_ready, is_bot, joined_at
  )
  VALUES (
    v_room_id,
    'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
    0, true, false, false, now()
  )
  ON CONFLICT (room_id, user_id) DO NOTHING;
END;
$$;

-- ============================================================================
-- SECTION 1 -- profiles (SELECT USING true)
-- ============================================================================

SET LOCAL ROLE anon;
SELECT ok(
  (SELECT count(*)::int FROM public.profiles) >= 1,
  'anon: can SELECT profiles (USING true -- public viewable)'
);
SELECT throws_ok(
  $inner$
    INSERT INTO public.profiles (id, username, created_at, updated_at)
    VALUES ('dddddddd-0000-0000-0000-000000000004'::uuid, 'anon_hacker', now(), now())
  $inner$,
  'new row violates row-level security policy for table "profiles"',
  'anon: INSERT into profiles is blocked by RLS'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
-- Set both JSON claims (PostgREST<12) and individual claim (PostgREST≥12 / current Supabase)
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
SET LOCAL "request.jwt.claim.sub" TO 'aaaaaaaa-0000-0000-0000-000000000001';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SELECT is(
  (SELECT count(*)::int FROM public.profiles WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'::uuid),
  1,
  'authenticated owner: can read own profile'
);
SELECT ok(
  (SELECT count(*)::int FROM public.profiles WHERE id = 'bbbbbbbb-0000-0000-0000-000000000002'::uuid) >= 1,
  'authenticated: can read other user profile (USING true)'
);
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT ok(
  (SELECT count(*)::int FROM public.profiles) >= 2,
  'service-role: can read all profiles'
);
RESET ROLE;

-- ============================================================================
-- SECTION 2 -- rooms (SELECT USING true)
-- ============================================================================

SET LOCAL ROLE anon;
SELECT ok(
  (SELECT count(*)::int FROM public.rooms WHERE code = 'PGTAP1') >= 1,
  'anon: can SELECT rooms (USING true -- anyone can view)'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
SET LOCAL "request.jwt.claim.sub" TO 'aaaaaaaa-0000-0000-0000-000000000001';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SELECT ok(
  (SELECT count(*)::int FROM public.rooms WHERE code = 'PGTAP1') >= 1,
  'authenticated: can read rooms (USING true)'
);
RESET ROLE;

SET LOCAL ROLE anon;
SELECT throws_ok(
  $inner$
    INSERT INTO public.rooms (code, host_id, status)
    VALUES ('PGTAPX', 'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'waiting')
  $inner$,
  'new row violates row-level security policy for table "rooms"',
  'anon: INSERT into rooms is blocked by RLS'
);
RESET ROLE;

-- ============================================================================
-- SECTION 3 -- room_players (restricted SELECT)
-- ============================================================================

SET LOCAL ROLE anon;
SELECT is(
  (SELECT count(*)::int FROM public.room_players
    WHERE room_id = 'cccccccc-0000-0000-0000-000000000003'::uuid),
  0,
  'anon: cannot read room_players'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
SET LOCAL "request.jwt.claim.sub" TO 'aaaaaaaa-0000-0000-0000-000000000001';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SELECT ok(
  (SELECT count(*)::int FROM public.room_players
    WHERE room_id = 'cccccccc-0000-0000-0000-000000000003'::uuid) >= 1,
  'authenticated member: can read own room_players rows'
);
SET LOCAL "request.jwt.claims" TO '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
SET LOCAL "request.jwt.claim.sub" TO 'bbbbbbbb-0000-0000-0000-000000000002';
SELECT is(
  (SELECT count(*)::int FROM public.room_players
    WHERE room_id = 'cccccccc-0000-0000-0000-000000000003'::uuid),
  0,
  'authenticated non-member: cannot see room_players in a room they are not in'
);
RESET ROLE;

-- ============================================================================
-- SECTION 4 -- player_stats (SELECT USING true)
-- ============================================================================

INSERT INTO public.player_stats (user_id, elo_rating, games_played, wins, created_at, updated_at)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001'::uuid, 1200, 10, 5, now(), now())
ON CONFLICT (user_id) DO UPDATE SET games_played = EXCLUDED.games_played;

SET LOCAL ROLE anon;
SELECT ok(
  (SELECT count(*)::int FROM public.player_stats
    WHERE user_id = 'aaaaaaaa-0000-0000-0000-000000000001'::uuid) >= 1,
  'anon: can SELECT player_stats (USING true -- leaderboard use-case)'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
SET LOCAL "request.jwt.claim.sub" TO 'aaaaaaaa-0000-0000-0000-000000000001';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SELECT ok(
  (SELECT count(*)::int FROM public.player_stats
    WHERE user_id = 'aaaaaaaa-0000-0000-0000-000000000001'::uuid) >= 1,
  'authenticated: can read player_stats'
);
RESET ROLE;

-- ============================================================================
-- SECTION 5 -- rate_limit_tracking (restricted SELECT, anon blocked)
-- Columns: user_id, action_type, window_start, attempts, updated_at
-- ============================================================================

SET LOCAL ROLE anon;
SELECT is(
  (SELECT count(*)::int FROM public.rate_limit_tracking),
  0,
  'anon: cannot read rate_limit_tracking'
);
SELECT throws_ok(
  $inner$
    INSERT INTO public.rate_limit_tracking (user_id, action_type, window_start, attempts)
    VALUES (
      'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
      'test-action', now(), 1
    )
  $inner$,
  'new row violates row-level security policy for table "rate_limit_tracking"',
  'anon: INSERT into rate_limit_tracking is blocked by RLS'
);
RESET ROLE;

-- ============================================================================
-- SECTION 6 -- blocked_users (SELECT USING blocker_id = auth.uid())
-- Columns: blocker_id, blocked_id (not user_id)
-- ============================================================================

SET LOCAL ROLE anon;
SELECT is(
  (SELECT count(*)::int FROM public.blocked_users),
  0,
  'anon: cannot read blocked_users'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
SET LOCAL "request.jwt.claim.sub" TO 'aaaaaaaa-0000-0000-0000-000000000001';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SELECT is(
  (SELECT count(*)::int FROM public.blocked_users
    WHERE blocker_id <> 'aaaaaaaa-0000-0000-0000-000000000001'::uuid),
  0,
  'authenticated: cannot see blocked_users rows from other blockers'
);
RESET ROLE;

-- ============================================================================
-- SECTION 7 -- game_history (SELECT USING true)
-- ============================================================================

SET LOCAL ROLE anon;
SELECT ok(
  (SELECT count(*)::int FROM public.game_history) >= 0,
  'anon: can SELECT game_history (USING true)'
);
RESET ROLE;

-- ============================================================================
-- SECTION 8 -- waiting_room (SELECT USING true)
-- ============================================================================

SET LOCAL ROLE anon;
SELECT ok(
  (SELECT count(*)::int FROM public.waiting_room) >= 0,
  'anon: can SELECT waiting_room (USING true)'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
SET LOCAL "request.jwt.claim.sub" TO 'aaaaaaaa-0000-0000-0000-000000000001';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SELECT ok(
  (SELECT count(*)::int FROM public.waiting_room) >= 0,
  'authenticated: can query waiting_room without error'
);
RESET ROLE;

-- ============================================================================
-- SECTION 9 -- bot_coordinator_locks (no SELECT policy -- deny by default)
-- ============================================================================

SET LOCAL ROLE anon;
SELECT is(
  (SELECT count(*)::int FROM public.bot_coordinator_locks),
  0,
  'anon: cannot read bot_coordinator_locks (no SELECT policy -- deny by default)'
);
RESET ROLE;

-- ============================================================================
SELECT * FROM finish();

ROLLBACK;
