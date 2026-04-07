# Stats & Leaderboard Overhaul Plan

**Branch:** `fix/stats-leaderboard-overhaul`  
**Base:** `game/chinese-poker`  
**Date:** March 2, 2026  

---

## Current State

- `player_stats` table aggregates ALL games (local AI, casual, ranked, private) into a single set of columns
- `game_history.game_mode` column exists (defaults to `'standard'`) but is **never set** by the `complete-game` edge function
- `leaderboard_global` materialized view shows a single combined leaderboard
- `RankedLeaderboardScreen` queries `profiles.elo_rating` but the `complete-game` edge function never updates ELO
- Two parallel ranking systems exist (`rank_points` in `player_stats`, `elo_rating` in `profiles`) — disconnected
- Local AI game stats are saved identically to multiplayer games
- No game_type/mode distinction in stats pipeline
- StreakGraph recalculates rank points client-side instead of using actual DB values

---

## 8 Work Items

### Item 1: Block Offline/Local Game Stats from Saving

**Goal:** Offline mode games should NEVER be saved to leaderboard or player stats.

**Changes:**
- **`state.ts` — `saveGameStatsToDatabase()`**: Add early return when game mode is `'local'` / offline (room_code === 'LOCAL' and room_id === null). Log info but don't call edge function.
- **`complete-game` edge function**: Add server-side validation — reject any payload with `room_code: 'LOCAL'` and `room_id: null` to prevent manual bypass.

**Migration:** None needed — this is a code-only change.

---

### Item 2: Split Casual & Ranked Leaderboards

**Goal:** The left toggle shows "Casual Leaderboard" (casual + private games), the right shows "Ranked Leaderboard" (ranked games only). Each with its own data.

**Database Changes (Migration):**
1. Add `game_type` column to `game_history` table: `TEXT NOT NULL DEFAULT 'casual'` — values: `'casual'`, `'ranked'`, `'private'`, `'local'`
2. Add per-mode stat columns to `player_stats`:
   - `casual_games_played`, `casual_games_won`, `casual_games_lost`, `casual_win_rate`, `casual_rank_points` (default 1000)
   - `ranked_games_played`, `ranked_games_won`, `ranked_games_lost`, `ranked_win_rate`, `ranked_rank_points` (default 1000)
   - `private_games_played`, `private_games_won`, `private_games_lost`, `private_win_rate`
3. Create `leaderboard_casual` materialized view — same structure as `leaderboard_global` but filtered by casual + private stats
4. Create `leaderboard_ranked` materialized view — filtered by ranked stats
5. Update `update_player_stats_after_game()` RPC to accept `p_game_type TEXT` parameter and update mode-specific columns
6. Update `refresh_leaderboard()` to refresh both materialized views

**Edge Function Changes:**
- `complete-game`: Accept `game_type` in payload, validate it's one of `'casual'|'ranked'|'private'`, store in `game_history.game_type`, pass to `update_player_stats_after_game()`

**Client Changes:**
- `state.ts`: Send `game_type` in completion payload (derive from room's `ranked_mode` flag and `is_public` flag)
- `LeaderboardScreen.tsx`: Rename toggle labels — "Casual Leaderboard" (left) / "Ranked Leaderboard" (right). Query `leaderboard_casual` for casual tab, `leaderboard_ranked` for ranked tab.
- Remove `RankedLeaderboardScreen.tsx` — all handled in one screen

---

### Item 3: Profile Overview Tabs (Overview, Casual, Private, Ranked)

**Goal:** 4 buttons in the Overview section: Overview (all), Casual, Private, Ranked. Each shows games played, win rate, games won, games lost for that mode.

**Changes:**
- **`StatsScreen.tsx`**: Add a `statsTab` state (`'overview' | 'casual' | 'private' | 'ranked'`). Show 4 toggle buttons. 
  - **Overview**: Use existing aggregate `games_played`, `games_won`, `games_lost`, `win_rate` (sum of casual + private + ranked, excluding local)
  - **Casual/Private/Ranked**: Use new per-mode columns from `player_stats`

**Migration:** Covered by Item 2 migration (mode-specific columns).

---

### Item 4: Game Completion Section

**Goal:** Below Overview section, show game completion percentage and current streak of completed games (casual + private + ranked only).

**Database Changes (Migration):**
1. Add to `player_stats`:
   - `games_completed INTEGER DEFAULT 0` — games fully completed (no disconnect/forfeit)
   - `games_abandoned INTEGER DEFAULT 0` — games user disconnected from
   - `completion_rate DECIMAL(5,2) DEFAULT 100.00` — percentage
   - `current_completion_streak INTEGER DEFAULT 0` — consecutive completed games
   - `longest_completion_streak INTEGER DEFAULT 0`

2. Update `update_player_stats_after_game()`: Accept `p_completed BOOLEAN DEFAULT true`, update completion columns

**Edge Function Changes:**
- `complete-game`: Pass `completed: true/false` based on whether user finished or was replaced by bot

**Client Changes:**
- `StatsScreen.tsx`: Add "Game Completion" section below Overview tabs with completion_rate and current_completion_streak display

---

### Item 5: Fix Rank Progression Graph

**Goal:** Rank progression graph works correctly with data from DB, shows win AND loss dots.

**Database Changes (Migration):**
1. Add `rank_points_after INTEGER` column to `game_history` — stores player's rank_points after each game
2. Update `update_player_stats_after_game()` to return the new rank_points value
3. Update `complete-game` to store `rank_points_after` in game_history for each player (add player_N_rank_points columns or use JSONB)

**Alternative simpler approach:** Add `rank_points_history JSONB DEFAULT '[]'` to `player_stats` — append `{game_id, points, is_win, timestamp}` per game. Cap at last 100 entries.

**Client Changes:**
- `StreakGraph.tsx`: 
  - Use actual rank_points from DB instead of recalculating
  - Add "Loss" legend item with white dot alongside existing "Win" legend
  - Ensure axis labels are clear with data points visible at intersections
  - Fix graph to use `rank_points_history` from player_stats or query game_history for rank progression

---

### Item 6: Update Performance Stats

**Goal:** Performance section shows: Avg Position, Total Points, Highest Score (bad — use 💀 emoji), Lowest Score (good — use ⭐), Average Score, Average Cards Left in Hand.

**Database Changes (Migration):**
1. Add to `player_stats`:
   - `lowest_score INTEGER DEFAULT NULL` — lowest (best) score
   - `avg_cards_left_in_hand DECIMAL(5,2) DEFAULT 0` — average cards remaining per match
   - `total_cards_left_in_hand INTEGER DEFAULT 0` — running total for average calculation

2. Update `update_player_stats_after_game()`: Accept `p_cards_left INTEGER`, update lowest_score and avg_cards_left

**Edge Function Changes:**
- `complete-game`: Calculate and pass lowest_score and cards_left for each player

**Client Changes:**
- `state.ts`: Include `cards_left` count in game completion payload (cards remaining when game ends)
- `StatsScreen.tsx`: 
  - Change Highest Score emoji from ⭐ to 💀 (high score = bad in Big Two)
  - Add Lowest Score card with ⭐ emoji
  - Add "Avg Cards Left" card with appropriate emoji
  - 6 performance cards total in 2x3 grid

---

### Item 7: Recent Games Improvements

**Goal:** Show bots in recent games, show bot replacements ("Bot 2 replaced Steve"), show disconnected games.

**Database Changes (Migration):**
1. Add to `game_history`:
   - `player_1_original_username TEXT` ... `player_4_original_username TEXT` — original player name before bot replacement
   - `player_1_was_bot BOOLEAN DEFAULT false` ... `player_4_was_bot BOOLEAN DEFAULT false`
   - `player_1_disconnected BOOLEAN DEFAULT false` ... `player_4_disconnected BOOLEAN DEFAULT false`
   - `game_completed BOOLEAN DEFAULT true` — whether game reached natural conclusion

**Edge Function Changes:**
- `complete-game`: Accept and store bot replacement info, disconnection status, and game_completed flag

**Client Changes:**
- `StatsScreen.tsx` — `renderHistoryItem()`:
  - Show all player names (including bots)
  - If player was replaced by bot: show "Bot N replaced {original_name}"
  - Show disconnected games with a different badge/indicator
  - Query game_history including local games if user disconnected

---

### Item 8: Complete Games Only for Combos & Performance

**Goal:** Only stats from fully completed games contribute to combos played and performance stats.

**Database Changes (Migration):**
- Use `game_completed` flag from Item 7

**Edge Function Changes:**
- `update_player_stats_after_game()`: Only update combo columns and performance columns (avg_position, total_points, highest_score, lowest_score, avg_score, avg_cards_left) when `p_completed = true`. Always update games_played, won/lost, streaks, rank_points.

**Client Changes:** None beyond what's already tracked by Items 4 & 7.

---

## Migration Strategy

All DB changes consolidated into a single migration file:  
`20260302000001_stats_leaderboard_overhaul.sql`

### New Columns on `player_stats`:
- casual_games_played, casual_games_won, casual_games_lost, casual_win_rate, casual_rank_points
- ranked_games_played, ranked_games_won, ranked_games_lost, ranked_win_rate, ranked_rank_points
- private_games_played, private_games_won, private_games_lost, private_win_rate
- games_completed, games_abandoned, completion_rate, current_completion_streak, longest_completion_streak
- lowest_score, avg_cards_left_in_hand, total_cards_left_in_hand
- rank_points_history (JSONB)

### New Columns on `game_history`:
- game_type (casual/ranked/private/local)
- player_N_original_username (×4)
- player_N_was_bot (×4) 
- player_N_disconnected (×4)
- player_N_cards_left (×4)
- game_completed

### New Materialized Views:
- leaderboard_casual
- leaderboard_ranked

### Updated RPC:
- update_player_stats_after_game() — new params: p_game_type, p_completed, p_cards_left
- refresh_leaderboard() — refresh all 3 views

---

## Implementation Order

1. **Migration** — Apply all DB schema changes
2. **Edge Function** — Update `complete-game` to handle game types, completion, cards left
3. **Client: state.ts** — Block offline saves, send game_type and cards_left
4. **Client: LeaderboardScreen** — Split into casual/ranked views
5. **Client: StatsScreen** — Overview tabs, completion section, performance updates, recent games improvements, StreakGraph fixes

---

## Files Modified

| File | Changes |
|------|---------|
| `supabase/migrations/20260302000001_stats_leaderboard_overhaul.sql` | New migration |
| `supabase/functions/complete-game/index.ts` | Game type handling, completion tracking |
| `src/game/state.ts` | Block offline saves, send game_type/cards_left |
| `src/screens/LeaderboardScreen.tsx` | Casual/Ranked split |
| `src/screens/StatsScreen.tsx` | Overview tabs, completion, performance, recent games |
| `src/components/stats/StreakGraph.tsx` | Fix graph, add loss dots |
| `src/screens/RankedLeaderboardScreen.tsx` | DELETE — functionality merged into LeaderboardScreen |
