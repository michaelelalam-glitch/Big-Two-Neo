# play-cards Edge Function - Complete Version History

**Date:** December 30, 2025  
**Function:** `play-cards`  
**Project:** dppybucldqufbqhwnkxu  
**Purpose:** Server-side card play validation for Phase 2 migration  

---

## Version 1 (Initial Deployment)
**Date:** ~Dec 27, 2025  
**Purpose:** Initial server-side validation  

**Key Features:**
- Basic card play validation
- Turn verification
- Hand verification
- Combo type classification (single, pair, triple, 5-card)
- Beat play logic
- Update hands, turn, last_play

**Known Issues:**
- Missing One Card Left Rule enforcement
- No auto-pass timer support
- No 3♦ validation

---

## Version 2-3 (Early Iterations)
**Date:** Dec 27-28, 2025  
**Purpose:** Bug fixes from initial testing  

**Changes:**
- Fixed response format issues
- Added better error messages
- Improved database query error handling

---

## Version 4 (Auto-Pass Timer Integration)
**Date:** Dec 28, 2025  
**Purpose:** Add auto-pass timer support  

**Changes:**
- ✅ Created auto-pass timer when highest play detected
- ✅ Returned timer object in response
- ✅ Client displays countdown
- Added `pass_count` tracking

**Related Docs:** AUTO_PASS_TIMER_*.md files

---

## Version 5 (Bug Fixes)
**Date:** Dec 29, 2025  
**Purpose:** Fix timer creation bugs  

**Changes:**
- Fixed timer not appearing
- Fixed timer not resetting properly
- Improved pass count logic

---

## Version 6 (One Card Left Rule)
**Date:** Dec 29, 2025  
**Purpose:** Enforce One Card Left Rule  

**Changes:**
- ✅ **CRITICAL FIX:** One Card Left Rule enforcement
  - When next player has 1 card left
  - Current player plays single
  - MUST play highest beating single
- Added comprehensive logging for rule checks
- Fixed edge case: Only enforce when there's a lastPlay to beat
- Don't enforce when leading (no lastPlay)

**Bug Fixed:** 404 errors when leading (no lastPlay validation issue)

**Lines Added:** 605-680 (One Card Left Rule logic)

---

## Version 7 (3♦ Validation + Match Number Support)
**Date:** Dec 29, 2025  
**Purpose:** Add first-play 3♦ requirement  

**Changes:**
- ✅ **3♦ VALIDATION:** First play of first match MUST include 3 of Diamonds
- Added `match_number` column support (with fallback `|| 1`)
- Check if first play: `played_cards.length === 0`
- Only enforce on Match 1
- Returns clear error: "First play of first match must include 3♦"

**Schema Dependency:** `match_number` column (falls back to 1 if missing)

**Lines:** 553-575 (3♦ validation logic)

---

## Version 8 (Bug Fixes)
**Date:** Dec 29-30, 2025  
**Purpose:** Production testing fixes  

**Changes:**
- Fixed database query edge cases
- Improved error messaging
- Better null handling

---

## Version 9 (Bot Testing)
**Date:** Dec 30, 2025 ~8am  
**Purpose:** Bot coordinator compatibility  

**Changes:**
- Tested with bot coordinator
- **BUG DISCOVERED:** Bot plays returning 400 "Not your turn"
- Issue tracked but not yet fixed in this version

**Known Issue:** `.eq('id', player_id)` querying wrong column

---

## Version 10 (Entry Logging for Debugging)
**Date:** Dec 30, 2025 ~9:35am  
**Purpose:** Add debugging logs to diagnose bot 400 errors  

**Changes:**
- ✅ Added entry-level logging:
  ```typescript
  console.log('🎮 [play-cards] Request received:', {
    room_code,
    player_id: player_id?.substring(0, 8),
    cards_count: Array.isArray(cards) ? cards.length : 'not array',
  });
  ```
- Added "Missing required fields" log
- Better visibility into Edge Function execution

**Purpose:** Help identify where 400 errors originate

**Lines:** 488-501 (entry logging)

**Testing Result:** Logs show function IS being called, so issue is inside function logic

---

## Version 11 (CRITICAL: Player ID Column Fix) ✅ DEPLOYED
**Date:** Dec 30, 2025 ~9:48am  
**Purpose:** Fix bot coordinator "Not your turn" errors  

**THE BUG:**
```typescript
// ❌ WRONG (Version 1-10)
const { data: player } = await supabaseClient
  .from('room_players')
  .select('*')
  .eq('id', player_id)  // ← WRONG COLUMN!
  .eq('room_id', room.id)
  .single();
```

**THE FIX:**
```typescript
// ✅ CORRECT (Version 11)
const { data: player } = await supabaseClient
  .from('room_players')
  .select('*')
  .eq('player_id', player_id)  // ← CORRECT COLUMN!
  .eq('room_id', room.id)
  .single();
```

**Root Cause:**
- `room_players` table has 3 UUID columns:
  - `id` = room_players record UUID (primary key)
  - `player_id` = actual player identifier ← **THIS IS WHAT WE SEND**
  - `user_id` = auth user ID
- Function was comparing `player_id` VALUE to `id` COLUMN
- Bot coordinator sends bot's `player_id` (e.g., "efd50de0...")
- Function looked for room_players record WHERE `id = "efd50de0..."`
- Record not found → 404 "Player not found" → 400 error

**Impact:** **CRITICAL** - This bug broke ALL bot plays and potentially ALL plays after the fix in Phase 2

**Files Changed:**
- `/apps/mobile/supabase/functions/play-cards/index.ts` line 537

**Deployment Status:** ✅ Deployed successfully  
**Deployment Command:** `npx supabase functions deploy play-cards --no-verify-jwt`

---

## Current Status (Post-Version 11)

**Latest Error (9:50am):**
```
Failed to send a request to the Edge Function
```

**This is different from:**
- ✅ Version 9-10: "Edge Function returned non-2xx status code" (400 error)
- ❌ Version 11+: "Failed to send a request" (network/deployment issue)

**Possible Causes:**
1. Version 11 deployment failed (but logs showed success)
2. TypeScript syntax error in version 11
3. Network connectivity issue
4. Function timeout during deployment

---

## Schema Dependencies

| Column | Required By | Version Added | Status |
|--------|-------------|---------------|--------|
| `match_number` | 3♦ validation | v7+ | ❌ NOT IN DATABASE (fallback to 1) |
| `pass_count` | Auto-pass timer | v4+ | ❌ NOT IN DATABASE (uses `passes` instead) |
| `auto_pass_timer` | Timer creation | v4+ | ✅ IN DATABASE (JSONB) |
| `player_id` (room_players) | Player lookup | v1+ | ✅ IN DATABASE (fixed in v11) |

---

## Migration Requirements

**CRITICAL:** These columns must be added before Match 2 starts:

```sql
-- Add match_number column
ALTER TABLE game_state ADD COLUMN match_number INTEGER DEFAULT 1;

-- Add pass_count column
ALTER TABLE game_state ADD COLUMN pass_count INTEGER DEFAULT 0;

-- Create sync trigger
CREATE OR REPLACE FUNCTION sync_pass_count()
RETURNS TRIGGER AS $$
BEGIN
  NEW.pass_count := array_length(NEW.passes, 1);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_pass_count
  BEFORE UPDATE ON game_state
  FOR EACH ROW
  WHEN (OLD.passes IS DISTINCT FROM NEW.passes)
  EXECUTE FUNCTION sync_pass_count();
```

**Migration File:** `/apps/mobile/supabase/migrations/20251230000000_add_missing_game_state_columns.sql`  
**Status:** Created but NOT applied to remote database

---

## Next Steps

1. **IMMEDIATE:** Investigate version 11 deployment failure
   - Check Supabase Dashboard for function status
   - Verify TypeScript compilation succeeded
   - Check for runtime errors in logs

2. **URGENT:** Apply schema migration
   - Add `match_number` and `pass_count` columns
   - Test Match 2 transitions

3. **TESTING:** Verify bot coordinator works with v11 fix
   - Start game with 1 human + 3 bots
   - Confirm bots can play cards
   - Verify no more "Not your turn" errors

---

## Deployment Commands Reference

```bash
# Deploy play-cards function
cd /apps/mobile
npx supabase functions deploy play-cards --no-verify-jwt

# Check function status
npx supabase functions list

# View logs
# (Or use Supabase Dashboard)
```

---

## Related Documentation

- `PHASE_2_PRODUCTION_ISSUES_DEC_30_2025.md` - Schema mismatch issues
- `PHASE_2_COMPLETE_SUMMARY_DEC_29_2025.md` - Phase 2 overview
- `AUTO_PASS_TIMER_*.md` - Timer implementation docs
- `BUG_FIX_ZERO_COMBOS_MARK_HUNTER.md` - One Card Left Rule docs

---

**Last Updated:** Dec 30, 2025 9:51am
