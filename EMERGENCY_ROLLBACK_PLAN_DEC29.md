# EMERGENCY ROLLBACK PLAN - December 29, 2025

## SITUATION:
- Everything worked at commit **ba1013f** (Dec 29, 3:16pm)
- 20 commits AFTER that broke everything
- Local migrations don't match Supabase (timestamp mismatch)
- Local Edge Function file is EMPTY but Supabase has version 5 (working)

## WHAT BROKE:
1. **Migration Hell**: 108 migrations on Supabase vs 65+ local files with DIFFERENT timestamps
2. **Edge Function Sync**: play-cards local file is EMPTY (0 bytes) vs deployed 842 lines
3. **Schema Drift**: Multiple migrations trying to fix the same things created conflicts

## ROLLBACK OPTIONS:

### OPTION 1: GIT ROLLBACK (SAFEST - RECOMMENDED)
```bash
cd /Users/michaelalam/Desktop/Desktop/Coding/Coding/Big-Two-Neo

# 1. Stash current broken state
git stash save "BROKEN_STATE_$(date +%Y%m%d_%H%M%S)"

# 2. Create rollback branch
git checkout -b rollback/to-ba1013f

# 3. Reset to working commit
git reset --hard ba1013f

# 4. Test immediately
cd apps/mobile
pnpm expo start
```

**PROS:**
- Gets you back to working code INSTANTLY
- Can compare what changed
- Can cherry-pick good fixes later

**CONS:**
- Loses all work after ba1013f (but it's stashed)
- Need to re-sync Supabase

---

### OPTION 2: RESTORE EDGE FUNCTION FROM GIT
```bash
cd /Users/michaelalam/Desktop/Desktop/Coding/Coding/Big-Two-Neo/apps/mobile

# Extract working Edge Function from ba1013f
git show ba1013f:apps/mobile/supabase/functions/play-cards/index.ts > supabase/functions/play-cards/index.ts

# Check it
cat supabase/functions/play-cards/index.ts | head -20
wc -l supabase/functions/play-cards/index.ts  # Should be 834 lines

# Deploy it
npx supabase functions deploy play-cards
```

**PROS:**
- Keeps current code
- Only fixes Edge Function
- Fast

**CONS:**
- Doesn't fix migration hell
- Database might still be out of sync

---

### OPTION 3: NUCLEAR - WIPE SUPABASE AND REAPPLY FROM ba1013f

⚠️ **DANGER: THIS DESTROYS ALL DATA**

```bash
# 1. Reset to ba1013f
git reset --hard ba1013f

# 2. Delete ALL migrations from Supabase
# (Use Supabase Dashboard -> SQL Editor)
# Run the script I'll create below

# 3. Reapply only migrations from ba1013f
npx supabase db reset --linked

# 4. Deploy Edge Functions
npx supabase functions deploy --no-verify-jwt play-cards
npx supabase functions deploy bot-turn
npx supabase functions deploy start-game
```

**PROS:**
- Clean slate
- Perfect sync
- Back to working state

**CONS:**
- **DESTROYS ALL USER DATA**
- **DESTROYS ALL GAME ROOMS**
- Takes time

---

## MY RECOMMENDATION:

### **DO OPTION 1 RIGHT NOW:**

This gets you back to working code in 30 seconds. Then we can:
1. Test that ba1013f actually works
2. Look at what commits broke it
3. Cherry-pick ONLY the good fixes
4. Reapply migrations ONE AT A TIME with testing

---

## WHAT COMMITS TO INVESTIGATE:

After ba1013f, these look suspicious:

```
8dd8cc8 - fix(migration): Clean up card_string_to_object
c424921 - fix(critical): Use single-letter suits
ef11305 - fix(critical): Generate proper card objects
93b06b6 - fix(database): Add missing updated_at
73439c3 - fix(database): Applied comprehensive schema fixes
e2e0a28 - fix(database): Comprehensive schema alignment
e4b1d68 - fix(database): Use correct game_state column names
```

**7 COMMITS ALL TRYING TO FIX DATABASE SCHEMA = RED FLAG**

This suggests the problem started with schema drift and then you kept trying to fix it, making it worse.

---

## NEXT STEPS:

**TELL ME:**
1. Do you want Option 1 (git reset to ba1013f)?
2. Or do you want Option 2 (just restore Edge Function)?
3. Do you care about preserving any data currently in Supabase?

**I WILL:**
1. Execute the rollback
2. Verify it works
3. Help you understand what went wrong
4. Reapply fixes ONE AT A TIME

---

## WHY THIS HAPPENED:

Looking at the commits, here's the chain of failures:

1. **ba1013f**: Everything working
2. **Commits after**: Someone (probably me) started applying migrations
3. **Migration timestamps got out of sync** (local 20251229030000 vs Supabase 20251229003900)
4. **Multiple fixes for same problem** created duplicate functions
5. **Edge Function file got corrupted/deleted** locally
6. **Kept trying to fix with more migrations** = made it worse

The root cause: **Migration version control was lost after ba1013f**

---

## PREVENTION FOR FUTURE:

1. **ALWAYS tag working commits**: `git tag v1.0-working ba1013f`
2. **Test migrations locally first**: Use Supabase local dev
3. **ONE migration at a time**: Apply, test, commit
4. **Never apply migrations from multiple branches**: Causes timestamp hell
5. **Keep Edge Functions in git**: Don't edit directly in Supabase

---

**WAITING FOR YOUR GO-AHEAD TO EXECUTE ROLLBACK**
