# Phase 4 Quick Reference Card

## ✅ Phase 4 Core Complete: Client Integration

**Date:** December 10, 2025  
**Time:** 3 hours (core)  
**Status:** CORE FEATURES COMPLETE

---

## 📦 What's Done

| Task | Status | Time |
|------|--------|------|
| Edge Function integration (playCards) | ✅ | 1h |
| Edge Function integration (pass) | ✅ | 0.5h |
| Database migration (Phase 2) | ✅ | 1h |
| Documentation | ✅ | 0.5h |
| **Total** | **✅** | **3h** |

---

## 🔧 What Was Changed

### File: `apps/mobile/src/hooks/useRealtime.ts`

**Before (playCards):**
```typescript
const playCards = async (cards: Card[]) => {
  // NOTE: One-card-left rule is enforced in local game mode only
  // Multiplayer games do not currently validate this rule server-side.
  
  // Determine combo type...
  // Update game state...
};
```

**After (playCards):**
```typescript
const playCards = async (cards: Card[]) => {
  // SERVER-SIDE VALIDATION
  const { data: validationResult, error } = await supabase.functions.invoke(
    'validate-multiplayer-play',
    { body: { room_id, player_id, action: 'play', cards } }
  );
  
  if (!validationResult?.valid) {
    throw new Error(validationResult?.error || 'Invalid play');
  }
  
  // Proceed with play...
};
```

**Before (pass):**
```typescript
const pass = async () => {
  // NOTE: One-card-left rule is enforced in local game mode only
  
  const newPassCount = gameState.pass_count + 1;
  // Update game state...
};
```

**After (pass):**
```typescript
const pass = async () => {
  // SERVER-SIDE VALIDATION
  const { data: validationResult, error } = await supabase.functions.invoke(
    'validate-multiplayer-play',
    { body: { room_id, player_id, action: 'pass' } }
  );
  
  if (!validationResult?.valid) {
    throw new Error(validationResult?.error || 'Cannot pass');
  }
  
  // Proceed with pass...
};
```

---

## 📊 Database Migration

**File:** `apps/mobile/supabase/migrations/20251210000239_add_card_tracking.sql`

**Changes:**
```sql
ALTER TABLE room_players 
ADD COLUMN hand JSONB DEFAULT '[]'::jsonb;

ALTER TABLE room_players 
ADD COLUMN hand_count INTEGER 
GENERATED ALWAYS AS (jsonb_array_length(hand)) STORED;

CREATE INDEX idx_room_players_hand_count ON room_players(hand_count);
```

**Apply:**
```bash
cd apps/mobile
supabase db push
```

---

## ⚠️ What's Pending

| Task | Status | Est. Time |
|------|--------|-----------|
| Apply migration | ⏭️ | 5 min |
| Hand synchronization | ⏭️ | 2-3h |
| Loading states | ⏭️ | 30 min |
| Better error messages | ⏭️ | 30 min |
| Timeout/retry logic | ⏭️ | 1h |
| End-to-end testing | ⏭️ | 2h |
| **Total** | **⏭️** | **~6-7h** |

---

## 🎯 Validation Flow (Now Active)

```
User clicks "Play Cards"
    ↓
playCards([3♦, 3♣])
    ↓
Convert cards to Edge Function format
    ↓
Call Edge Function: validate-multiplayer-play
    ↓
Edge Function checks:
  - Is it player's turn?
  - Does next player have 1 card?
  - If single: Is it highest card?
  - If pass: Can player beat last play?
    ↓
Return { valid: boolean, error?: string }
    ↓
If valid: Update game_state
If invalid: Throw error
    ↓
UI shows error or proceeds
```

---

## 🔍 Hand Sync Investigation Needed

**Problem:** Edge Function needs `room_players.hand` data, but we don't know where hands are currently stored.

**Questions:**
1. Where are cards dealt in multiplayer?
2. Where is player hand state stored?
3. When should hands sync to database?

**Options:**
- **A:** Client syncs after each play (simple)
- **B:** Server manages all hands (secure)
- **C:** Hybrid (recommended)

**Next Step:** Investigate game flow
```bash
grep -r "deal.*cards" apps/mobile/src/
grep -r "startGame" apps/mobile/src/
```

---

## 🧪 Quick Test

### Test 1: Verify Edge Function Call
```bash
# Check if validation is called
# Add console.log in playCards before supabase.functions.invoke
# Play a card in game
# Check browser console for log
```

### Test 2: Test Error Handling
```bash
# Modify validation to always return invalid
# Play a card
# Verify error is shown to user
```

### Test 3: Apply Migration
```bash
cd apps/mobile
supabase db reset
supabase db push
supabase db inspect  # Verify hand column exists
```

---

## 📝 Error Messages

| Scenario | Error Message |
|----------|---------------|
| Next player 1 card, non-highest | "Next player has 1 card! You must play your highest card: 2♠" |
| Next player 1 card, can beat | "Next player has 1 card! You cannot pass when you can beat the play." |
| Not your turn | "Not your turn" |
| Invalid card combo | "Invalid card combination" |
| Validation failed | "Validation failed: [error]" |

---

## 🚀 Deploy Checklist

- [x] ✅ Edge Function deployed
- [x] ✅ Client code integrated
- [ ] ⏭️ Migration applied
- [ ] ⏭️ Hand sync implemented
- [ ] ⏭️ Loading states added
- [ ] ⏭️ End-to-end tests passed

---

## 📚 Documentation

- **Summary:** `/docs/PHASE_4_SUMMARY.md`
- **Notes:** `/docs/PHASE_4_CLIENT_INTEGRATION_NOTES.md`
- **Migration:** `/apps/mobile/supabase/migrations/20251210000239_add_card_tracking.sql`
- **Edge Function:** `/apps/mobile/supabase/functions/validate-multiplayer-play/`

---

## ⏭️ Next Immediate Actions

1. **Apply Migration (5 min):**
   ```bash
   cd apps/mobile && supabase db push
   ```

2. **Test Validation (15 min):**
   - Start local Supabase
   - Test Edge Function with curl
   - Verify it can access room_players.hand

3. **Investigate Game Flow (1h):**
   - Find card dealing logic
   - Understand hand storage
   - Decide on sync approach

4. **Implement Hand Sync (2-3h):**
   - Based on investigation findings
   - Add sync logic
   - Test locally

5. **Polish & Test (2-3h):**
   - Add loading states
   - Improve error messages
   - End-to-end testing

---

## ✅ Success Criteria

**Core (Complete):**
- [x] ✅ Edge Function called before play
- [x] ✅ Edge Function called before pass
- [x] ✅ Validation errors thrown
- [x] ✅ Database schema ready

**Full (Pending):**
- [ ] ⏭️ Hands synced to database
- [ ] ⏭️ Migration applied
- [ ] ⏭️ All tests passing
- [ ] ⏭️ Production ready

---

**Phase 4 Status:** ✅ 40% Complete  
**Next Phase:** Complete hand sync + testing → Phase 5

---

**Contact:** Implementation Agent  
**Last Updated:** December 10, 2025
