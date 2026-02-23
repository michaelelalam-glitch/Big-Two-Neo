# 🚨 CRITICAL: Phase 2 Production Readiness Issues - Dec 30, 2025

## Overview
During production testing of Phase 2, multiple critical schema mismatches were discovered between the Edge Functions and the database schema. These must be fixed before deployment.

---

## Issue #1: Missing `winner` Column ✅ FIXED

**Error:**
```
Could not find the 'winner' column of 'game_state' in the schema cache
```

**Root Cause:**
- Client code tried to update `game_state.winner` column
- This column doesn't exist in the schema
- Leftover from old code

**Fix Applied:**
- Removed `winner`, `game_phase`, and `auto_pass_timer` updates from client
- Server Edge Function already handles all game_state updates
- Client only updates `play_history` (cosmetic, non-critical)

**File Changed:** `/apps/mobile/src/hooks/useRealtime.ts` line 729-752

---

## Issue #2: Missing `match_number` Column ❌ NOT FIXED YET

**Error:** Edge Function expects `gameState.match_number` but column doesn't exist

**Root Cause:**
- `game_state` table schema missing `match_number` column
- Edge Function uses it to validate 3♦ requirement (line 553)
- Currently falls back to `|| 1` but will fail when match 2 starts

**Impact:** CRITICAL - 3♦ validation will fail after match 1

**Fix Created:** Migration file `20251230000000_add_missing_game_state_columns.sql`

**Status:** Migration file created but not yet applied to remote database

---

## Issue #3: `pass_count` vs `passes` Column Naming ❌ NOT FIXED YET

**Error:** Edge Function uses `pass_count`, schema has `passes`

**Root Cause:**
- Schema has `passes` and `passes_in_row` columns
- Edge Function expects `pass_count` (line 799)
- Naming inconsistency between client and server

**Impact:** MEDIUM - Pass counting may be incorrect

**Fix Created:** Migration adds `pass_count` column and sync trigger

**Status:** Migration file created but not yet applied

---

## Issue #4: Bot Coordinator Sending Wrong `player_id` ✅ FIXED

**Error:**
```
Not your turn (Edge Function returned non-2xx status)
```

**Root Cause:**
- Bot coordinator called `playCards(cards, botPlayerIndex)`
- Client sent host's `player_id` instead of bot's `player_id`
- Edge Function validated wrong player

**Fix Applied:**
- Modified `useRealtime.playCards()` to lookup correct player by `playerIndex`
- When `playerIndex` provided, find bot's `player_id` from `roomPlayers`
- Pass correct `player_id` to Edge Function

**File Changed:** `/apps/mobile/src/hooks/useRealtime.ts` line 647-665

---

## Issue #5: Client Redundantly Updating `game_state` ✅ FIXED

**Problem:**
- Client tried to update `game_state` after Edge Function already did
- Caused schema errors (winner, game_phase, auto_pass_timer)
- Violates Phase 2 architecture (server is source of truth)

**Fix Applied:**
- Removed all game_state updates except `play_history` (cosmetic)
- Server Edge Function handles all critical updates
- Client just appends to play_history (non-fatal if it fails)

**File Changed:** `/apps/mobile/src/hooks/useRealtime.ts` line 729-752

---

## Required Actions Before Production

### 1. Apply Schema Migration ⏳ URGENT
```bash
# Apply the migration to remote database
cd /Users/michaelalam/Desktop/Desktop/Coding/Coding/Big-Two-Neo/apps/mobile

# Option A: Use Supabase dashboard SQL editor
# Copy contents of: supabase/migrations/20251230000000_add_missing_game_state_columns.sql
# Paste and execute in: https://supabase.com/dashboard/project/dppybucldqufbqhwnkxu/sql/new

# Option B: Fix migration history then push
# (Complex - migrations out of sync with remote)
```

**Migration adds:**
- ✅ `match_number` column (INTEGER, default 1)
- ✅ `pass_count` column (INTEGER, default 0)
- ✅ `auto_pass_timer` column (JSONB, nullable)
- ✅ Sync trigger between `passes` and `pass_count`
- ✅ Drops deprecated `auto_pass_active` column

### 2. Test Full Game Flow ⏳ REQUIRED
After migration applied:
- [ ] Start match 1 → Bot plays 3♦ successfully
- [ ] Complete match 1 → Match 2 starts
- [ ] Match 2 doesn't require 3♦
- [ ] Auto-pass timer works
- [ ] Score calculation works
- [ ] Game completes successfully

### 3. Verify Schema Consistency ⏳ RECOMMENDED
```sql
-- Run this query to verify all columns exist:
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'game_state'
ORDER BY ordinal_position;

-- Expected columns:
-- id, room_id, current_turn, current_player, hands, played_cards,
-- scores, round, passes, passes_in_row, last_play, last_player,
-- play_history, round_number, dealer_index, game_started_at,
-- game_phase, created_at, updated_at, match_number, pass_count,
-- auto_pass_timer
```

---

## Other Production Concerns

### 1. Migration History Out of Sync
**Problem:** Remote database has 100+ migrations not in local repo  
**Impact:** Cannot use `supabase db push` or `supabase db pull`  
**Fix:** Need to repair migration history or accept manual SQL execution  
**Priority:** LOW (doesn't block functionality, just dev workflow)

### 2. Row Level Security (RLS) Not Enforced
**Problem:** `game_state` has RLS enabled but Edge Functions use service role  
**Impact:** Edge Functions bypass RLS (intentional for now)  
**Fix:** Phase 5 - Implement proper RLS policies  
**Priority:** MEDIUM (security hardening)

### 3. Error Handling in Edge Function
**Problem:** Some errors return generic messages  
**Impact:** Hard to debug client-side issues  
**Fix:** Add more detailed error responses  
**Priority:** LOW (nice to have)

### 4. `play_history` Still Client-Side
**Problem:** `play_history` updated by client, not server  
**Impact:** Cosmetic only, not critical  
**Fix:** Move to server in future phase  
**Priority:** LOW (cosmetic)

---

## Summary

### CRITICAL (Blocks Production) ❌
1. **Missing `match_number` column** - Breaks match 2+ 
2. **Missing `pass_count` column** - May break pass logic

### HIGH (Fixed, Ready for Testing) ✅
1. **Bot coordinator player_id bug** - FIXED
2. **Winner column error** - FIXED  
3. **Client redundant updates** - FIXED

### MEDIUM (Tech Debt) ⏳
1. Migration history out of sync
2. RLS not enforced
3. Error handling improvements

### LOW (Future Enhancements) 💡
1. Move play_history to server
2. Better logging
3. Performance optimizations

---

## Deployment Checklist

- [ ] Apply migration `20251230000000_add_missing_game_state_columns.sql`
- [ ] Verify all columns exist in `game_state` table
- [ ] Test full game flow (match 1 → match 2)
- [ ] Test bot coordinator with Edge Functions
- [ ] Test auto-pass timer functionality
- [ ] Test score calculation
- [ ] Create PR with all fixes
- [ ] Deploy client changes
- [ ] Deploy Edge Function changes
- [ ] Monitor production for errors

---

**Status:** 🚨 MIGRATION REQUIRED BEFORE PRODUCTION  
**Next Action:** Apply schema migration via Supabase dashboard  
**Estimated Time:** 5 minutes to apply, 30 minutes to test  
**Blocking:** Missing database columns prevent match 2+ from working
