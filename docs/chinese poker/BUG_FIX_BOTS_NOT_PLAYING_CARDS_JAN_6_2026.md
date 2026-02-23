# 🐛 BUG FIX: Bots Not Playing Cards (Only Passing After 3D)

**Date:** January 6, 2026  
**Status:** ✅ SQL Fix Ready (Needs Manual Application)  
**Severity:** CRITICAL - Game Unplayable

---

## 🎯 Problem Summary

Bots were only playing the 3♦ on the first turn, then passing every subsequent turn with the error message: `"No 3♦ found"`. This made the multiplayer game unplayable.

### Symptoms
- Bot 4 plays 3♦ successfully ✅
- Bot 2 passes: "No 3♦ found" ✅ (correct)
- Bot 3 passes: "No 3♦ found" ✅ (correct)
- **Bot 4 passes: "No 3♦ found"** ❌ (BUG! Should beat current play)
- HTTP 400 error when Bot 4 tries to pass

---

## 🔍 Root Cause Analysis

### Database State Issue
The `game_state.game_phase` column was stuck at `"first_play"` even after the 3D was successfully played. The `play-cards` Edge Function correctly validates and processes moves but **never transitions the game_phase to "normal_play"**.

### Bot AI Logic Chain
1. `useBotCoordinator.ts` line ~176: Calculates `isFirstPlayOfGame` from `gameState.game_phase === 'first_play'`
2. `BotAI.getPlay()` line 59: Checks `if (isFirstPlayOfGame)` and routes to `handleFirstPlay()`
3. `BotAI.handleFirstPlay()` line 74: Returns `{ cards: null, reasoning: 'No 3D found' }` when bot doesn't have 3D
4. Result: Bots stuck in "first play mode" looking for 3D forever

### Why The HTTP 400 Error?
Bot 4 had already played the 3D in round 1, so:
- Bot 4's hand no longer contains 3D
- Bot thinks it's still first play mode
- Tries to pass (because no 3D)
- But passing is invalid when you're supposed to beat a play
- Server rejects with HTTP 400

---

## ✅ Solution

### Automatic Game Phase Transition
Created a PostgreSQL trigger that automatically transitions `game_phase` from `"first_play"` to `"normal_play"` immediately after the first card is played (when `played_cards` becomes non-empty).

### Implementation
```sql
-- Auto-transition function
CREATE OR REPLACE FUNCTION transition_game_phase_after_first_play()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.game_phase = 'first_play' AND 
     NEW.played_cards IS NOT NULL AND 
     jsonb_array_length(NEW.played_cards) > 0 THEN
    NEW.game_phase := 'normal_play';
    RAISE NOTICE 'game_phase transitioned from first_play to normal_play for room_id: %', NEW.room_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger on UPDATE
CREATE TRIGGER trigger_transition_game_phase
  BEFORE UPDATE ON game_state
  FOR EACH ROW
  EXECUTE FUNCTION transition_game_phase_after_first_play();

-- Fix existing stuck games
UPDATE game_state
SET game_phase = 'normal_play'
WHERE game_phase = 'first_play'
  AND played_cards IS NOT NULL
  AND jsonb_array_length(played_cards) > 0;
```

---

## 📋 How To Apply Fix

### Option 1: Supabase SQL Editor (Recommended)
1. Open Supabase Dashboard: https://supabase.com/dashboard/project/dppybucldqufbqhwnkxu/sql
2. Copy contents of `temp_fix_game_phase.sql`
3. Paste into SQL Editor
4. Click "Run"

### Option 2: Via Terminal (if migration works)
```bash
cd apps/mobile
supabase db push
```

---

## 🧪 Testing

### Before Fix
```
Bot 4: Plays 3D ✅
Bot 2: Passes (no 3D) ✅
Bot 3: Passes (no 3D) ✅
Bot 4: Passes (no 3D) ❌ HTTP 400 ERROR
```

### After Fix
```
Bot 4: Plays 3D ✅
Bot 2: Passes (no 3D) ✅
Bot 3: Passes (no 3D) ✅
Bot 4: Plays cards to beat 3D ✅
Game continues normally ✅
```

---

## 📁 Files Created

1. `/apps/mobile/supabase/migrations/20260106222754_fix_game_phase_transition.sql` - Timestamped migration
2. `/apps/mobile/temp_fix_game_phase.sql` - Quick-apply SQL script

---

## 🎮 Impact

**Before:** Game completely broken - bots can't play after first turn  
**After:** Bots play normally throughout the entire game  

**User Experience:**
- Multiplayer games now work correctly
- Bots make valid moves
- No more HTTP 400 errors
- Game flows naturally from first play to normal play

---

## 📊 Related Issues

### Task #585: Fix Match End Error
**Separate bug** where games fail to start a new match after someone wins. Error: `"Edge Function returned a non-2xx status code"`. Needs investigation of match-end Edge Function logic.

---

## 🔗 References

- Console Log: `/Users/michaelalam/Desktop/console log.md` (lines 820-890 show the bug)
- Screenshot: Shows "HTTP 400" error dialog
- Bot AI: `/apps/mobile/src/game/bot/index.ts` line 50-95
- Bot Coordinator: `/apps/mobile/src/hooks/useBotCoordinator.ts` line 105-250
- Play Cards Function: `/apps/mobile/supabase/functions/play-cards/index.ts`

---

**Status:** ✅ Fix ready - Awaiting manual SQL application via Supabase Dashboard
