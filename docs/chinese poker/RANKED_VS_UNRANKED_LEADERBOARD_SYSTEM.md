# 🏆 Ranked vs Unranked Leaderboard System Documentation

**Date:** December 23, 2025  
**Project:** Big-Two-Neo Mobile App  
**Purpose:** Explain how ranked and unranked leaderboards work, including rank points and ELO rating systems

---

## 📊 System Overview

The game has **TWO independent scoring systems** that track player performance:

### 1. **Rank Points (ALL GAMES)**
- **What:** General performance metric  
- **Applies to:** EVERY game (ranked AND unranked/casual)  
- **Awards:**
  - **1st place (Winner):** +25 points
  - **2nd place:** +10 points
  - **3rd place:** -5 points
  - **4th place:** -15 points
- **Used for:** Unranked/Global Leaderboard
- **Resets:** Never (cumulative lifetime score)

### 2. **ELO Rating (RANKED GAMES ONLY)**
- **What:** Competitive skill rating based on chess ELO system
- **Applies to:** ONLY ranked matches
- **Calculation:** Considers opponent skill levels (win against better players = more ELO gain)
- **Used for:** Ranked Leaderboard (minimum 10 matches to appear)
- **Starting ELO:** 1000 (default for all new players)

---

## 🎮 Game Modes

### Casual/Unranked Mode
- **Leaderboard:** Global (Rank Points)
- **Stats tracked:** Win/loss, games played, rank points, streaks, combos
- **ELO impact:** ❌ NO - ELO rating unchanged
- **Rank points:** ✅ YES - Full awards (+25/-15)
- **Purpose:** Practice, fun, no pressure
- **Requirements:** None

### Ranked Mode
- **Leaderboard:** Ranked (ELO Rating)
- **Stats tracked:** All stats + ELO changes
- **ELO impact:** ✅ YES - Gain/lose ELO based on result
- **Rank points:** ✅ YES - Full awards (+25/-15)
- **Purpose:** Competitive skill-based matchmaking
- **Requirements:** Must complete 10 matches to appear on ranked leaderboard

---

## 📈 Stat Updates Per Game Mode

| Stat | Casual Game | Ranked Game |
|------|-------------|-------------|
| Games Played | ✅ +1 | ✅ +1 |
| Games Won/Lost | ✅ Updated | ✅ Updated |
| Win Rate | ✅ Recalculated | ✅ Recalculated |
| Rank Points | ✅ +25/-15 | ✅ +25/-15 |
| ELO Rating | ❌ No change | ✅ ±ELO (dynamic) |
| Streaks | ✅ Updated | ✅ Updated |
| Combo Stats | ✅ Tracked | ✅ Tracked |
| Leaderboard | Global only | Global + Ranked |

---

## 🏅 Leaderboard Types

### Global Leaderboard (Unranked)
**Query:** `leaderboard_global` materialized view  
**Sort by:** Rank Points (descending)  
**Filters:**
- All-time (default)
- Weekly (last 7 days)
- Daily (last 24 hours)

**Eligibility:** Any player with games_played > 0

**Sample Entry:**
```json
{
  "rank": 1,
  "username": "Player1",
  "rank_points": 850,
  "games_played": 42,
  "games_won": 30,
  "win_rate": 71.43,
  "longest_win_streak": 8
}
```

### Ranked Leaderboard (ELO-based)
**Query:** `player_stats` table with ELO sorting  
**Sort by:** ELO Rating (descending)  
**Requirements:**
- Minimum 10 ranked matches played
- Only counts ranked games

**Eligibility:** `ranked_games_played >= 10`

**Sample Entry:**
```json
{
  "rank": 1,
  "username": "ProPlayer",
  "elo_rating": 1450,
  "ranked_games_played": 15,
  "ranked_games_won": 12,
  "win_rate": 80.0
}
```

---

## 🔢 ELO Calculation (Ranked Only)

### Formula
```
ELO_change = K × (Actual_Score - Expected_Score)
```

Where:
- **K-factor:** 32 (higher K = more volatile ratings)
- **Actual Score:** 1 for win, 0 for loss
- **Expected Score:** Based on rating difference

### Expected Score Formula
```
Expected = 1 / (1 + 10^((Opponent_Rating - Your_Rating) / 400))
```

### Examples

**Scenario 1: Equal opponents (1000 vs 1000)**
- Winner: +16 ELO
- Loser: -16 ELO

**Scenario 2: Strong beats weak (1200 vs 800)**
- Winner: +6 ELO (expected to win)
- Loser: -6 ELO

**Scenario 3: Weak beats strong (800 vs 1200)**
- Winner: +26 ELO (upset!)
- Loser: -26 ELO

---

## 🛠️ Implementation Details

### Database Functions

**1. `update_player_stats_after_game()`**
```sql
-- Called for ALL games (casual + ranked)
-- Updates: games_played, games_won, win_rate, rank_points, streaks, combos
-- Does NOT update ELO (separate function)
```

**2. `update_player_elo_after_match()`**
```sql
-- Called ONLY for ranked games
-- Updates: elo_rating, ranked_games_played, ranked_games_won
-- Considers opponent ELO ratings
```

**3. `record_match_result()`**
```sql
-- Called from server (Edge Function or RPC)
-- Determines if match is ranked based on match_type
-- Calls appropriate update functions
```

### Game Completion Flow

```
Player finishes game
        ↓
Check: Ranked or Casual?
        ↓
    ┌───────┴────────┐
    │                │
 Casual            Ranked
    │                │
    ↓                ↓
Update rank      Update rank
  points           points
    │                +
    │            Update ELO
    │                │
    └────────┬───────┘
             ↓
    Refresh leaderboards
             ↓
    Update player stats screen
```

---

## 🎯 User Experience

### Casual Game
1. Player selects "Find Match" (casual mode)
2. Game completes, player finishes 1st place
3. **Gains:** +25 rank points, +1 win, updated streaks
4. **Does NOT gain/lose:** ELO rating
5. **Appears on:** Global Leaderboard only

### Ranked Game
1. Player selects "Find Match (Ranked)" 
2. Game completes, player finishes 1st place
3. **Gains:** +25 rank points, +16 ELO (approx), +1 ranked win
4. **Updates:** Both rank points AND ELO
5. **Appears on:** Global Leaderboard + Ranked Leaderboard (if 10+ matches)

---

## 🚨 Edge Cases

### Player Leaves Prematurely

**Casual Game:**
- Forfeits: -15 rank points (4th place penalty)
- Does NOT count as "game played" if less than 2 rounds

**Ranked Game:**
- Forfeits: -15 rank points + ELO loss (treated as loss)
- **Does count** as ranked game played (penalties apply)

### Bot Players
- **Bots do NOT:**
  - Affect ELO calculations
  - Appear on leaderboards
  - Have player_stats entries
- **Bots DO:**
  - Allow game to continue if real player disconnects
  - Count for rank point calculations (win vs 3 bots = +25 points)

---

## 📱 UI Display

### HomeScreen
```tsx
<Button onPress={() => navigation.navigate('FindMatch', { matchType: 'casual' })}>
  🎯 Find Match
</Button>

<Button onPress={() => navigation.navigate('FindMatch', { matchType: 'ranked' })}>
  🏆 Ranked Match
</Button>
```

### LeaderboardScreen (Toggle Tabs)
```tsx
<SegmentedControl
  values={['Global', 'Ranked']}
  selectedIndex={leaderboardType === 'global' ? 0 : 1}
  onChange={(e) => setLeaderboardType(e.nativeEvent.selectedSegmentIndex === 0 ? 'global' : 'ranked')}
/>
```

**Global Tab:**
- Shows rank points leaderboard
- Filter: All-time, Weekly, Daily

**Ranked Tab:**
- Shows ELO rating leaderboard
- Requires 10+ ranked matches
- Only shows players who meet requirement

---

## 🔧 Configuration

### Rank Points Awards (ALL GAMES)
```typescript
const RANK_POINTS = {
  FIRST_PLACE: 25,
  SECOND_PLACE: 10,
  THIRD_PLACE: -5,
  FOURTH_PLACE: -15,
};
```

### ELO System (RANKED ONLY)
```typescript
const ELO_CONFIG = {
  K_FACTOR: 32, // Rating volatility
  DEFAULT_RATING: 1000,
  MIN_MATCHES_FOR_LEADERBOARD: 10,
};
```

---

## 🧪 Testing Scenarios

### Test Case 1: Casual Game Win
1. Play casual match, finish 1st
2. ✅ Verify: Rank points +25
3. ✅ Verify: ELO unchanged
4. ✅ Verify: Appears on Global Leaderboard

### Test Case 2: Ranked Game Loss
1. Play ranked match, finish 4th
2. ✅ Verify: Rank points -15
3. ✅ Verify: ELO decreased (~16 points)
4. ✅ Verify: Ranked games count incremented
5. ✅ Verify: If 10+ matches, appears on Ranked Leaderboard

### Test Case 3: Leaderboard Toggle
1. Open LeaderboardScreen
2. ✅ Verify: Global tab shows rank points
3. Switch to Ranked tab
4. ✅ Verify: Ranked tab shows ELO ratings
5. ✅ Verify: Only players with 10+ matches shown

---

## 📝 Summary

| Aspect | Casual Mode | Ranked Mode |
|--------|-------------|-------------|
| **Primary Metric** | Rank Points | ELO Rating |
| **Applies to** | All games | Ranked games only |
| **Rank Points** | ✅ Yes (+25/-15) | ✅ Yes (+25/-15) |
| **ELO Rating** | ❌ No | ✅ Yes (dynamic) |
| **Leaderboard** | Global only | Global + Ranked |
| **Requirements** | None | 10+ matches for ranked board |
| **Purpose** | Fun, practice | Competitive skill-based |
| **Matchmaking** | Random | ELO-based (future) |

---

## 🚀 Future Enhancements

1. **ELO-based matchmaking:** Match players with similar ELO ratings in ranked mode
2. **Seasonal resets:** Reset ranked ELO every season (e.g., quarterly)
3. **Rank tiers:** Bronze/Silver/Gold/Platinum based on ELO ranges
4. **Decay system:** Penalize inactive ranked players to prevent rank camping
5. **Placement matches:** Initial 10 matches to determine starting ELO more accurately

---

**End of Documentation**
