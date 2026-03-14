# CRITICAL FIX: Apply Card Object Structure Migration

## Problem Identified
Your cards are rendering as blank/white because the database is storing card data as **strings** (`"C3"`, `"D4"`) instead of **proper card objects** with the structure `{id: "C3", rank: "3", suit: "C"}`.

The Card component (Card.tsx) expects objects and logs this error when it receives strings:
```
[Card] 🚨 INVALID CARD OBJECT
```

## Solution
A migration file already exists to fix this: `20251229100000_fix_card_object_structure.sql`

This migration:
1. Creates a helper function `card_string_to_object()` to convert strings to objects
2. Updates `start_game_with_bots()` to generate proper card objects
3. Ensures all cards have the correct `{id, rank, suit}` structure

## How to Apply the Fix

### Option 1: Using Supabase Dashboard (RECOMMENDED)
1. Go to: https://supabase.com/dashboard/project/dppybucldqufbqhwnkxu
2. Navigate to: **SQL Editor** → **New query**
3. Copy the entire contents of `supabase/migrations/20251229100000_fix_card_object_structure.sql`
4. Paste into the SQL editor
5. Click **Run** button
6. You should see: `✓ CARD OBJECT STRUCTURE FIX COMPLETE`

### Option 2: Using Supabase CLI
```bash
cd apps/mobile
supabase db push
```

### Option 3: Manual SQL Execution
Copy the SQL from the migration file and run it in your preferred PostgreSQL client.

## After Applying Migration
1. **Force close** the mobile app completely
2. **Restart** the app
3. **Start a new game**
4. Your cards should now display correctly!

## Verification
After starting a new game, check the console logs:
- ❌ **Before fix**: `[Card] 🚨 INVALID CARD OBJECT`
- ✅ **After fix**: Cards render with proper rank/suit display

## Important Notes
- This fix only affects **NEW games** started after the migration
- **Existing games** with the old card format may still have issues
- If you still see blank cards, try starting a fresh game

## Migration File Location
`/Users/michaelalam/Desktop/Desktop/Coding/Coding/Big-Two-Neo/apps/mobile/supabase/migrations/20251229100000_fix_card_object_structure.sql`
