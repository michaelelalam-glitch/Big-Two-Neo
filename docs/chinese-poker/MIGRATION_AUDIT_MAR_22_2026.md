# Migration History Audit — March 22, 2026

## Overview

Comprehensive audit of the Supabase migration history for `big2-mobile-backend` (project `dppybucldqufbqhwnkxu`), comparing the local `apps/mobile/migrations/` directory against the applied DB migrations and all Supabase security advisories.

---

## Section 1 — Local vs Database Migration Drift

### 1A. Applied DB migrations count
The database has **91 applied migrations** spanning December 2025 through March 2026.

### 1B. Migration directories — two separate locations

> **Important:** The repository has **two** migration directories with different purposes:
> - `apps/mobile/supabase/migrations/` — **Active Supabase CLI source of truth** (52 files). These are applied by `supabase db push` / `supabase db reset` and correspond to the 91 entries in the Supabase `schema_migrations` table.
> - `apps/mobile/migrations/` — **Legacy / reference only** (10 files: 9 original hand-crafted files + 1 reference copy added by this PR, **not** tracked by Supabase CLI). These were written before the CLI workflow was established and are never applied automatically.
>
> All drift analysis below applies to the **legacy** `apps/mobile/migrations/` directory. The active `apps/mobile/supabase/migrations/` directory contains the 52 properly-timestamped migrations that match the DB history.

#### Legacy reference files (`apps/mobile/migrations/` — 10 files)

The legacy `apps/mobile/migrations/` directory contains **10 files** (9 original + 1 reference copy added by this PR):

| Local File | DB Equivalent | Status |
|---|---|---|
| `20260114000000_one_card_left_rule_functions.sql` | `20260114113159_one_card_left_rule_functions_v2` | ⚠️ Timestamp mismatch — DB applied a _v2 with different timestamp |
| `20260114000001_one_card_left_rule_pass_validation.sql` | `20260114120515_20260114000001_one_card_left_rule_pass_validation` | ⚠️ Timestamp mismatch — DB stored filename as migration name |
| `20260115000001_fix_auto_pass_exempt_player_return.sql` | `20260115050528_fix_auto_pass_exempt_player_return` | ⚠️ Timestamp mismatch |
| `20260321000000_friendships.sql` | `20260320142258_friendships` | ❌ Different timestamp — treated as NEW unapplied migration |
| `20260321000001_friendships_security_fixes.sql` | `20260320143127_friendships_security_fixes` | ❌ Different timestamp |
| `20260321000002_friendships_policy_split.sql` | `20260320144919_friendships_policy_split` | ❌ Different timestamp |
| `20260321000003_friendships_tighten_with_check.sql` | `20260320150817_friendships_tighten_with_check` | ❌ Different timestamp |
| `20260321000004_friendships_immutable_parties.sql` | `20260320152037_friendships_immutable_parties` | ❌ Different timestamp |
| `push_tokens.sql` | *(not tracked)* | ❌ No timestamp prefix — applied manually, untracked |
| `20260322000000_security_hardening.sql` | *(canonical copy in `supabase/migrations/`)* | 📋 Reference copy added by this PR — not applied by CLI |

### 1C. Duplicate migration names in DB

The following migration names appear **twice** in the DB history, indicating they were reapplied:

| Name | Versions |
|---|---|
| `one_card_left_rule_functions_v2` | `20260114113159` and `20260120080206` |
| `create_missing_game_phase_trigger` | `20260110031728` and `20260110040000` |
| `add_bot_coordinator_lease_table` | `20260301004614` and `20260302000000` |

These are idempotent `CREATE OR REPLACE` or `CREATE TABLE IF NOT EXISTS` statements so they are harmless, but they represent unclean history.

---

## Section 2 — Security Advisories

### 2A. ERRORS (must fix)

| Table | Issue | Fix |
|---|---|---|
| `public.room_analytics` | RLS disabled — table is public-facing but unprotected | Enable RLS + add read policy |

### 2B. WARNINGS — Function mutable `search_path` (62 functions)

Every `public.*` function lacks `SET search_path = public, pg_catalog` (or equivalent), exposing them to search-path injection if an attacker-controlled schema is placed earlier on the path.

**Affected functions:**
`reset_played_cards_on_new_match`, `update_push_tokens_updated_at`, `update_player_stats`, `update_updated_at_column`, `sync_room_code`, `set_friendships_updated_at`, `test_cleanup_user_data`, `generate_room_code`, `enforce_friendships_parties_immutable`, `sync_player_position`, `transition_game_phase_after_first_play`, `refresh_leaderboard`, `try_acquire_bot_coordinator_lease`, `release_bot_coordinator_lease`, `try_join_quick_play_room`, `execute_pass_move`, `auto_create_player_stats`, `check_user_not_in_room`, `is_auto_pass_timer_expired`, `replace_disconnected_with_bot`, `cancel_matchmaking`, `cleanup_stale_waiting_room_entries`, `get_next_turn_after_three_passes`, `card_string_to_object`, `log_room_event`, `server_time_ms`, `calculate_trick_winner`, `force_leave_room`, `check_all_players_ready`, `execute_auto_pass_batch`, `validate_play_action`, `calculate_rank_from_elo`, `complete_game_from_client`, `validate_pass_action`, `is_username_available_global`, `compare_cards`, `classify_combo`, `start_game_with_bots` (×2 signatures), `initialize_player_stats`, `is_bot_coordinator`, `find_match`, `find_highest_beating_single`, `get_card_value`, `get_or_create_room`, `validate_one_card_left_rule`, `is_highest_possible_play`, `advance_game_state`, `execute_play_move`, `reconnect_player`, `on_player_ready_check_autostart`, `execute_bot_turn`, `check_room_abandonment`, `get_rejoin_status`, `update_turn_started_at`, `update_player_stats_after_game`, `cleanup_abandoned_rooms`, `handle_new_user`, `_sync_bot_difficulty_to_room_settings`, `cleanup_empty_rooms`, `generate_room_code_v2`, `update_rooms_updated_at`

### 2C. WARNINGS — RLS policy always true (permissive policies)

| Table | Policy | Operation | Issue |
|---|---|---|---|
| `game_events` | "System can insert game events" | INSERT | `WITH CHECK (true)` — any service role caller |
| `game_state` | "Service role can manage game state" | ALL | Both USING and WITH CHECK are `true` |
| `match_history` | "System can insert match history" | INSERT | `WITH CHECK (true)` |
| `match_participants` | "System can insert match participants" | INSERT | `WITH CHECK (true)` |
| `players` | "Allow updates for authenticated users" | UPDATE | Both USING and WITH CHECK are `true` |
| `players` | "Users can join rooms" | INSERT | `WITH CHECK (true)` |
| `players` | "Users can leave rooms" | DELETE | `USING (true)` |
| `rooms` | "Anyone can create rooms" | INSERT | `WITH CHECK (true)` |

### 2D. INFO — RLS enabled with no policies

| Table | Issue |
|---|---|
| `bot_coordinator_locks` | RLS enabled but zero policies — all access blocked |

### 2E. WARNINGS — Materialized views in public API

| View | Issue |
|---|---|
| `leaderboard_ranked` | Accessible by `anon` and `authenticated` roles directly |
| `leaderboard_global` | Same |
| `leaderboard_casual` | Same |

These views are intentionally public-readable (leaderboard data). The advisory is informational — no action required unless we want to move them to a `private` schema. **Accepted risk for now.**

### 2F. WARNINGS — Leaked password protection disabled

Auth setting — enable via Supabase dashboard or Auth config. Not fixable via migration SQL. **Will be addressed via dashboard note.**

---

## Section 3 — Remediation Plan

### Step 1 — Fix migration file naming (local repo cleanup)
- Rename the `20260321000000-4_friendships*.sql` files to match the exact DB timestamps (`20260320142258` etc.) so the local files are accurate source-of-truth references.
- Rename `push_tokens.sql` to the timestamp of its first actual DB migration entry, or simply document it as applied outside the migration system.

### Step 2 — Create security hardening migration
Create `20260322000000_security_hardening.sql` that:
1. Adds `SET search_path = public, pg_catalog` (**or** uses `ALTER FUNCTION ... SET search_path`) to all 62 affected functions (the 2-arg `start_game_with_bots` overload is guarded against missing-function errors)
2. Enables RLS on `public.room_analytics` + adds a membership-scoped read-only policy for authenticated users (JOIN via `public.players`; falls back to `public.room_players` if `players` is absent)
3. Intentionally leaves `bot_coordinator_locks` **without** any client-facing RLS policy — access is restricted to service_role / SECURITY DEFINER functions only. Adding a broad policy would unnecessarily expose coordinator lock state to all authenticated users.

### Step 3 — Fix permissive RLS policies (combined into Step 2 migration)
The same `20260322000000_security_hardening.sql` also:
- Updates `players` UPDATE policy to only allow a user to update their own row (guarded against environments without the `players` table)
- Updates `players` INSERT policy to check `auth.uid()` context
- Updates `players` DELETE policy to only allow deleting own row
- Updates `rooms` INSERT policy to require authenticated caller
- **Leaves** `game_events`, `game_state`, `match_history`, `match_participants` service-role policies alone (called from SECURITY DEFINER functions with their own auth guards)

### Step 4 — Apply migration via Supabase MCP

Migration applied to `big2-mobile-backend` via `mcp_supabase_apply_migration`.
File placed in `apps/mobile/supabase/migrations/` as the Supabase CLI source of
truth used by `supabase db push` / `supabase db reset`.

A reference copy also exists in `apps/mobile/migrations/` for historical
context only. It is **not** used by the Supabase CLI, does **not** affect
`supabase db reset`, and may drift from the active migration over time.

### Step 5 — Stage, commit, push new branch, open PR comparing to `game/chinese-poker`

---

## Implementation Status

| Step | Status |
|---|---|
| Step 1 — fix local file naming | ✅ Documented (20260321 vs 20260320 drift noted) |
| Step 2 — security hardening migration (`20260322000000`) | ✅ Applied to production |
| Step 3 — tighten RLS policies (merged into Step 2) | ✅ Applied to production |
| Step 4 — apply migration | ✅ Applied via Supabase MCP |
| Step 5 — branch/PR | ✅ PR #170 opened, Copilot review addressed |
