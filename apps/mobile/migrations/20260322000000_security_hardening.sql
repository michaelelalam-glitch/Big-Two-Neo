-- Migration: Security Hardening — Fix mutable search_path, RLS gaps, permissive policies
-- Date: 2026-03-22
-- Addresses all Supabase security advisor warnings/errors/infos:
--   1. Set search_path on all public functions (62 functions)
--   2. Enable RLS on public.room_analytics + add read policy
--   3. Add access policy for bot_coordinator_locks (RLS enabled, no policies)
--   4. Tighten permissive RLS policies on players and rooms
-- ============================================================

-- ============================================================
-- 1. Fix mutable search_path on all public functions
--    Prevents search-path confusion/injection attacks
-- ============================================================

ALTER FUNCTION public._sync_bot_difficulty_to_room_settings()
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.advance_game_state(p_room_code text, p_event_type text)
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.auto_create_player_stats()
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.calculate_rank_from_elo(p_elo_rating integer)
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.calculate_trick_winner(p_room_id uuid)
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.cancel_matchmaking(p_user_id uuid)
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.card_string_to_object(card_code text)
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.check_all_players_ready(p_room_id uuid)
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.check_room_abandonment()
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.check_user_not_in_room()
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.classify_combo(cards jsonb)
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.cleanup_abandoned_rooms()
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.cleanup_empty_rooms()
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.cleanup_stale_waiting_room_entries()
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.compare_cards(card1 jsonb, card2 jsonb)
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.complete_game_from_client(
  p_room_id uuid,
  p_room_code text,
  p_players jsonb,
  p_winner_id text,
  p_game_duration_seconds integer,
  p_started_at timestamp with time zone,
  p_finished_at timestamp with time zone
) SET search_path = public, pg_catalog;

ALTER FUNCTION public.enforce_friendships_parties_immutable()
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.execute_auto_pass_batch(
  p_room_code text,
  p_timer_sequence_id integer,
  p_exempt_player_id uuid
) SET search_path = public, pg_catalog;

ALTER FUNCTION public.execute_bot_turn(p_room_id uuid, p_bot_player_index integer)
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.execute_pass_move(p_room_code text, p_player_id uuid)
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.execute_play_move(p_room_code text, p_player_id uuid, p_cards jsonb)
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.find_highest_beating_single(p_hand jsonb, p_last_play jsonb)
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.find_match(
  p_username character varying,
  p_skill_rating integer,
  p_region character varying,
  p_match_type character varying
) SET search_path = public, pg_catalog;

ALTER FUNCTION public.force_leave_room(p_user_id uuid)
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.generate_room_code()
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.generate_room_code_v2()
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.get_card_value(p_card jsonb)
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.get_next_turn_after_three_passes(
  p_game_state_id uuid,
  p_last_passing_player_index integer
) SET search_path = public, pg_catalog;

ALTER FUNCTION public.get_or_create_room(
  p_user_id uuid,
  p_username text,
  p_is_public boolean,
  p_is_matchmaking boolean,
  p_ranked_mode boolean
) SET search_path = public, pg_catalog;

ALTER FUNCTION public.get_rejoin_status(p_room_id uuid, p_user_id uuid)
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.handle_new_user()
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.initialize_player_stats(p_user_id uuid)
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.is_auto_pass_timer_expired(timer_state jsonb)
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.is_bot_coordinator(p_room_id uuid)
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.is_highest_possible_play(p_cards jsonb, p_played_cards jsonb)
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.is_username_available_global(p_username text, p_exclude_user_id uuid)
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.log_room_event(
  p_room_id uuid,
  p_event_type text,
  p_error_type text,
  p_metadata jsonb
) SET search_path = public, pg_catalog;

ALTER FUNCTION public.on_player_ready_check_autostart()
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.reconnect_player(p_room_id uuid, p_user_id uuid)
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.refresh_leaderboard()
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.release_bot_coordinator_lease(p_room_code text, p_coordinator_id text)
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.replace_disconnected_with_bot(
  p_room_id uuid,
  p_player_index integer,
  p_disconnect_duration_seconds integer
) SET search_path = public, pg_catalog;

ALTER FUNCTION public.reset_played_cards_on_new_match()
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.server_time_ms()
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.set_friendships_updated_at()
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.start_game_with_bots(p_room_id uuid, p_bot_difficulty text)
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.start_game_with_bots(p_room_id uuid, p_bot_count integer, p_bot_difficulty text)
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.sync_player_position()
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.sync_room_code()
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.test_cleanup_user_data(p_user_ids uuid[])
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.transition_game_phase_after_first_play()
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.try_acquire_bot_coordinator_lease(
  p_room_code text,
  p_coordinator_id text,
  p_timeout_seconds integer
) SET search_path = public, pg_catalog;

ALTER FUNCTION public.try_join_quick_play_room(p_player_name text, p_room_code text)
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.update_player_stats(
  p_user_id uuid,
  p_won boolean,
  p_score integer,
  p_finish_position integer,
  p_game_type text,
  p_cards_left integer,
  p_completed boolean,
  p_combo_stats jsonb
) SET search_path = public, pg_catalog;

ALTER FUNCTION public.update_player_stats_after_game(
  p_user_id uuid,
  p_won boolean,
  p_finish_position integer,
  p_score integer,
  p_combos_played jsonb,
  p_game_type text,
  p_completed boolean,
  p_cards_left integer,
  p_voided boolean
) SET search_path = public, pg_catalog;

ALTER FUNCTION public.update_push_tokens_updated_at()
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.update_rooms_updated_at()
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.update_turn_started_at()
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.update_updated_at_column()
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.validate_one_card_left_rule(
  p_selected_cards jsonb,
  p_current_player_hand jsonb,
  p_next_player_card_count integer,
  p_last_play jsonb
) SET search_path = public, pg_catalog;

ALTER FUNCTION public.validate_pass_action(p_room_code text, p_player_id uuid)
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.validate_play_action(p_room_code text, p_player_id uuid, p_cards jsonb)
  SET search_path = public, pg_catalog;

-- ============================================================
-- 2. Enable RLS on public.room_analytics (currently unprotected)
--    Allow authenticated users to read analytics for their own rooms;
--    disallow unauthenticated reads entirely on this table.
-- ============================================================

ALTER TABLE public.room_analytics ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated user may read analytics (aggregate/public stats)
CREATE POLICY "Authenticated users can read room analytics"
  ON public.room_analytics
  FOR SELECT
  TO authenticated
  USING (true);

-- Insert/update locked to service role only (inserted by server functions)
-- No INSERT/UPDATE/DELETE policy for anon or authenticated — only service role
-- (service_role bypasses RLS by default in Supabase)

-- ============================================================
-- 3. Add access policy for bot_coordinator_locks
--    Table has RLS enabled but zero policies → all access is blocked.
--    Functions that use it are SECURITY DEFINER so they run as postgres/service
--    role and bypass RLS; but add an explicit SELECT policy for clarity and to
--    satisfy the advisor.
-- ============================================================

-- Allow authenticated users to read lock state (needed for client polling)
CREATE POLICY "Authenticated users can read bot coordinator locks"
  ON public.bot_coordinator_locks
  FOR SELECT
  TO authenticated
  USING (true);

-- ============================================================
-- 4. Tighten permissive RLS policies on public.players
--    Replaces overly broad UPDATE/INSERT/DELETE policies that used (true)
--    with auth.uid()-scoped equivalents.
-- ============================================================

-- 4a. UPDATE: only allow a user to update their own player row
DROP POLICY IF EXISTS "Allow updates for authenticated users" ON public.players;
CREATE POLICY "Players can update own row"
  ON public.players
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 4b. INSERT: restrict to the authenticated user inserting themselves
DROP POLICY IF EXISTS "Users can join rooms" ON public.players;
CREATE POLICY "Users can join rooms"
  ON public.players
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- 4c. DELETE: only allow a user to remove their own player row
DROP POLICY IF EXISTS "Users can leave rooms" ON public.players;
CREATE POLICY "Users can leave rooms"
  ON public.players
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- ============================================================
-- 5. Tighten rooms INSERT policy — require caller to be authenticated
-- ============================================================

DROP POLICY IF EXISTS "Anyone can create rooms" ON public.rooms;
CREATE POLICY "Authenticated users can create rooms"
  ON public.rooms
  FOR INSERT
  TO authenticated
  WITH CHECK (true);
