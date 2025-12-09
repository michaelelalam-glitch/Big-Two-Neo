# Phase 4: Client Integration - Implementation Notes

**Date:** December 10, 2025  
**Status:** In Progress  

---

## Completed Tasks ✅

### 1. Edge Function Validation Integration
- ✅ Updated `playCards()` method to call `validate-multiplayer-play` Edge Function
- ✅ Updated `pass()` method to call `validate-multiplayer-play` Edge Function
- ✅ Added error handling for validation failures
- ✅ Mapped card format from client format to Edge Function format

**Changes Made:**
- **File:** `apps/mobile/src/hooks/useRealtime.ts`
- **Lines:** ~429-502 (playCards), ~503-570 (pass)

**Validation Flow:**
```typescript
1. User attempts to play cards or pass
2. Client calls Edge Function with room_id, player_id, action, cards
3. Edge Function validates against one-card-left rule
4. If valid: proceed with database update
5. If invalid: throw error with user-friendly message
```

### 2. Database Migration Created
- ✅ Created migration file: `20251210000239_add_card_tracking.sql`
- ✅ Adds `hand` column (JSONB) to `room_players` table
- ✅ Adds `hand_count` generated column for fast lookups
- ✅ Creates indexes for performance
- ✅ Adds RLS policies for security
- ✅ Creates optional `validation_history` table for audit logs

**Migration Status:** Ready to apply  
**Apply Command:** `cd apps/mobile && supabase db push`

---

## Pending Tasks ⏭️

### 3. Hand Synchronization (BLOCKED - Requires Architecture Decision)

**Challenge:**
The current `useRealtime` hook doesn't manage player hands directly. Cards are likely dealt by an Edge Function or stored elsewhere in the game state.

**Questions to Answer:**
1. **Where are cards dealt?** 
   - Edge Function? (`start-game` function?)
   - Client-side dealing?
   - Separate game state management?

2. **Where are hands currently stored?**
   - Only in client state?
   - In `game_state` table?
   - In `players` table (separate from `room_players`)?

3. **When should hands be synced to database?**
   - After initial deal
   - After each play
   - On game state changes

**Investigation Needed:**
```bash
# Check existing Edge Functions
cd apps/mobile
supabase functions list

# Look for game start logic
grep -r "deal.*cards" apps/mobile/src/
grep -r "startGame\|start_game" apps/mobile/src/

# Check if hands are in game state
grep -r "PlayerHand\|player.*hand" apps/mobile/src/types/
```

**Proposed Solutions:**

**Option A: Sync in playCards() (Simple)**
```typescript
// In playCards(), after validation passes:
const remainingCards = currentPlayerHand.filter(
  c => !cards.some(card => cardsMatch(c, card))
);

await supabase
  .from('room_players')
  .update({ hand: remainingCards })
  .eq('room_id', room.id)
  .eq('user_id', userId);
```

**Option B: Sync via Edge Function (Secure)**
```typescript
// Edge Function handles hand updates
// Client just sends action, server updates hands
// More secure but requires refactoring Edge Functions
```

**Option C: Sync on Game State Changes (Comprehensive)**
```typescript
// Subscribe to game state changes
// Update hands when any player acts
// Ensures consistency across all clients
```

### 4. Error Handling & Loading States

**Required Improvements:**

1. **Loading Indicators:**
```typescript
const [isValidating, setIsValidating] = useState(false);

const playCards = async (cards: Card[]) => {
  setIsValidating(true);
  try {
    // validation...
  } finally {
    setIsValidating(false);
  }
};
```

2. **Better Error Messages:**
```typescript
// Current: Generic "Validation failed"
// Needed: User-friendly messages with context

if (!validationResult?.valid) {
  const errorMsg = validationResult?.error || 'Invalid play';
  const nextPlayerCount = validationResult?.next_player_hand_count;
  
  if (nextPlayerCount === 1) {
    // Highlight that one-card-left rule is active
    throw new Error(`⚠️ ${errorMsg}\n\nThe next player has only 1 card left!`);
  } else {
    throw new Error(errorMsg);
  }
}
```

3. **Timeout Handling:**
```typescript
// Timeout Edge Function calls after 5 seconds
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 5000);

const { data, error } = await supabase.functions.invoke(
  'validate-multiplayer-play',
  { 
    body: {...},
    signal: controller.signal 
  }
);

clearTimeout(timeoutId);
```

4. **Retry Logic:**
```typescript
// Retry failed validations (network issues)
const MAX_RETRIES = 2;
let retries = 0;

while (retries < MAX_RETRIES) {
  try {
    const result = await supabase.functions.invoke(...);
    if (result.data) break;
  } catch (err) {
    retries++;
    if (retries >= MAX_RETRIES) throw err;
    await sleep(1000 * retries); // Exponential backoff
  }
}
```

---

## Dependencies

### Must Complete Before Phase 4 Can Finish:

1. **Apply Database Migration (Phase 2)**
   ```bash
   cd apps/mobile
   supabase db push
   ```
   - Adds `hand` column to `room_players`
   - Without this, Edge Function will fail to validate

2. **Understand Game Flow**
   - How are cards dealt initially?
   - Where is player hand state managed?
   - When should hands be synced to database?

3. **Test Edge Function in Production**
   - Deploy Edge Function if not already deployed
   - Verify it can access room_players.hand
   - Test validation with real game scenarios

---

## Testing Plan

### Unit Tests (After Hand Sync Implementation)
```typescript
describe('useRealtime - Server Validation', () => {
  it('should call Edge Function before playing cards', async () => {
    // Mock supabase.functions.invoke
    // Verify it's called with correct params
  });

  it('should throw error if validation fails', async () => {
    // Mock validation failure
    // Verify error is thrown with correct message
  });

  it('should update hand in database after play', async () => {
    // Verify hand is updated in room_players
  });
});
```

### Integration Tests
```typescript
describe('One-Card-Left Rule - Multiplayer', () => {
  it('should reject non-highest card when next player has 1 card', async () => {
    // Setup: Create game where next player has 1 card
    // Try to play non-highest card
    // Expect error
  });

  it('should reject pass when can beat and next player has 1 card', async () => {
    // Setup: Can beat last play, next player has 1 card
    // Try to pass
    // Expect error
  });
});
```

### Manual Testing Scenarios
- [ ] Play game until a player has 1 card
- [ ] Try to play non-highest card → Should show error
- [ ] Try to pass when can beat → Should show error
- [ ] Play highest card → Should succeed
- [ ] Pass when can't beat → Should succeed

---

## Next Steps (Immediate)

1. **Investigate Game Flow:**
   - Find where cards are dealt
   - Identify where player hands are stored
   - Understand game state management

2. **Apply Database Migration:**
   ```bash
   cd apps/mobile
   supabase db push
   ```

3. **Deploy Edge Function (if not deployed):**
   ```bash
   supabase functions deploy validate-multiplayer-play
   ```

4. **Implement Hand Synchronization:**
   - Based on findings from step 1
   - Choose Option A, B, or C
   - Add sync logic to appropriate place

5. **Add Loading States:**
   - Add `isValidating` state
   - Disable buttons during validation
   - Show spinner/loading indicator

6. **Improve Error Messages:**
   - Parse error from Edge Function
   - Show user-friendly alerts
   - Include context about one-card-left rule

7. **Test End-to-End:**
   - Create test game
   - Validate all scenarios
   - Fix any issues

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Database migration fails | Edge Function can't validate | Test migration on local Supabase first |
| Hand sync breaks existing flow | Game unplayable | Feature flag to disable validation |
| Edge Function latency | Poor UX | Add timeout + retry logic |
| Hands get out of sync | Invalid game state | Periodic reconciliation |

---

## Timeline

- **Phase 4.1 (Completed):** Edge Function integration (2 hours) ✅
- **Phase 4.2 (Completed):** Database migration creation (1 hour) ✅
- **Phase 4.3 (Pending):** Hand synchronization (2-3 hours) ⏭️
- **Phase 4.4 (Pending):** Error handling & loading states (1 hour) ⏭️
- **Phase 4.5 (Pending):** Testing & bug fixes (2 hours) ⏭️

**Total Remaining:** ~5-6 hours

---

## Files Modified

### Created:
- `/apps/mobile/supabase/migrations/20251210000239_add_card_tracking.sql` (Phase 2 migration)

### Modified:
- `/apps/mobile/src/hooks/useRealtime.ts` (playCards, pass methods)

### To Modify:
- `/apps/mobile/src/hooks/useRealtime.ts` (add hand sync, loading states)
- Possibly other files depending on game flow investigation

---

**Status:** Phase 4 ~40% Complete  
**Next Action:** Investigate game flow to implement hand synchronization  
**Blocker:** Need to understand where/when cards are dealt and stored
