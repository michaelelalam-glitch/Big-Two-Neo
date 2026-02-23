# 🔥 CRITICAL BUG FIX: JSON Double-Encoding in execute_play_move

## THE PROBLEM

After a player plays a card, the backend RPC function `execute_play_move` is **CORRUPTING PLAYER HANDS** by double-encoding JSON!

**What's happening:**
- Players 0 and 3 have cards stored as **JSON STRINGS**: `"{\"id\": \"AH\", \"rank\": \"A\"}"`
- Players 1 and 2 have proper objects: `{id: "AH", rank: "A", suit: "H"}`
- React components can't parse the strings, showing `first_3_cards: [null, null, null]`
- Game breaks after first play

**Root Cause (Line 63-72 of migration 20251227000002_add_game_move_rpcs.sql):**
```sql
v_new_hand := '[]'::JSONB;
FOR v_card_id IN SELECT jsonb_array_elements_text(v_player_hand)  ← BUG HERE!
LOOP
  IF NOT (p_cards @> to_jsonb(ARRAY[v_card_id])) THEN
    v_new_hand := v_new_hand || to_jsonb(v_card_id);  ← DOUBLE-ENCODING!
  END IF;
END LOOP;
```

`jsonb_array_elements_text()` converts objects to strings, then `to_jsonb()` wraps them as JSON strings instead of keeping objects!

---

## THE FIX

Use `jsonb_array_elements()` (without `_text`) to preserve object structure:

```sql
v_new_hand := '[]'::JSONB;
FOR v_card IN SELECT jsonb_array_elements(v_player_hand)  ✅ NO _text
LOOP
  IF NOT (p_cards @> jsonb_build_array(v_card->>'id')) THEN
    v_new_hand := v_new_hand || jsonb_build_array(v_card);  ✅ Keep as object
  END IF;
END LOOP;
```

---

## HOW TO APPLY THE FIX

### Option 1: Supabase Dashboard SQL Editor (EASIEST)

1. Go to https://supabase.com/dashboard/project/dppybucldqufbqhwnkxu/sql
2. Copy the ENTIRE contents of: `supabase/migrations/20251227120002_fix_execute_play_move_json_encoding.sql`
3. Paste into SQL Editor
4. Click "Run"
5. You should see: "Success. No rows returned"

### Option 2: psql Direct Connection

```bash
psql postgresql://postgres.dppybucldqufbqhwnkxu:[PASSWORD]@aws-0-us-west-1.pooler.supabase.com:5432/postgres \
  -f supabase/migrations/20251227120002_fix_execute_play_move_json_encoding.sql
```

---

## AFTER APPLYING THE FIX

### ⚠️ IMPORTANT: START A NEW GAME!

The existing game (room KHNSSW) has **CORRUPTED DATA IN THE DATABASE**. The fix only prevents future corruption.

**To test the fix:**
1. **Leave the current game**
2. **Create a NEW room**
3. **Start a NEW game with 3 bots**
4. **Play one round** and verify cards stay as proper objects

---

## VERIFICATION

After playing a card, check the console logs. You should see:

**❌ BEFORE FIX (BROKEN):**
```javascript
"0": [
  "{\"id\": \"AH\", \"rank\": \"A\", \"suit\": \"H\"}",  ← STRING!
  "{ \"id\": \"3H\", \"rank\": \"3\", \"suit\": \"H\"}"
]
```

**✅ AFTER FIX (CORRECT):**
```javascript
"0": [
  {"id": "AH", "rank": "A", "suit": "H"},  ← OBJECT!
  {"id": "3H", "rank": "3", "suit": "H"}
]
```

---

## FILES CREATED

- Migration: `supabase/migrations/20251227120002_fix_execute_play_move_json_encoding.sql`
- This Doc: `docs/BUG_FIX_JSON_DOUBLE_ENCODING_DEC_27_2025.md`

---

## SUMMARY

**Bug:** `jsonb_array_elements_text()` + `to_jsonb()` = double JSON encoding  
**Fix:** Use `jsonb_array_elements()` + `jsonb_build_array()` to preserve objects  
**Action:** Apply SQL via Supabase Dashboard → Start NEW game to test  

🚀 **This will completely fix the game breaking after first play!**
