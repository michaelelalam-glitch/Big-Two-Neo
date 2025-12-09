# One-Card-Left Rule: Multiplayer Implementation Plan

**Created:** December 9, 2025  
**Status:** Planning Phase  
**Priority:** High  
**Estimated Effort:** 3-5 days  

---

## Executive Summary

**Current State:**
- ✅ One-card-left rule works perfectly in **local solo games** (vs bots) - implemented in `state.ts`
- ❌ Rule is **NOT enforced** in multiplayer games - `useRealtime.ts` has no validation
- ⚠️ Orphaned Edge Function exists on Supabase (needs cleanup)

**Goal:**
Implement server-side validation to enforce the one-card-left rule in multiplayer games, ensuring fair play and game integrity.

**Architecture Decision:** ✅ **Strategy 1 - Dual Validation (Approved)**
- **Keep** existing local validation in `state.ts` for solo/offline games
- **Add** new server-side validation in Edge Function for multiplayer games
- **Clear separation:** Local = solo games, Server = multiplayer games

**Success Criteria:**
1. Players cannot play any card except their highest when next player has 1 card (multiplayer)
2. Players cannot pass when they can beat the play AND next player has 1 card (multiplayer)
3. Validation happens server-side (cannot be bypassed by client manipulation)
4. Local validation continues to work for solo games (offline capability maintained)
5. Real-time feedback to all players in the room
6. No performance degradation or race conditions

---

## Phase 1: Architecture & Design (4-6 hours)

### 1.1 Database Schema Analysis

**Current Schema Review:**
```sql
-- apps/mobile/supabase/migrations/*.sql
-- Review tables: rooms, room_players, game_state
```

**Required Changes:**
- [ ] Determine if `room_players.hand` needs to be added (secure card storage)
- [ ] Evaluate if `game_state` table needs card tracking columns
- [ ] Consider privacy: Should server track all cards or just card counts?
- [ ] Design schema for validation history/audit trail

**Decision Points:**
- **Option A:** Store full hand data in database (more secure, easier validation)
- **Option B:** Store only card counts (more private, requires client trust)
- **✅ DECISION:** Option A for server-authoritative validation

**Why Option A:**
- Server needs to validate "highest card" rule → requires full hand data
- Prevents client-side tampering
- Enables robust server-side validation
- Privacy protected by RLS policies (players can't see others' hands)

### 1.2 Validation Architecture

**Server-Side Options:**

**Option 1: Edge Function (Recommended)**
```
Client → Edge Function → Database → Response
- Pros: TypeScript, testable, reusable
- Cons: Cold start latency (~50-200ms)
- Use case: Complex validation logic
```

**Option 2: Database RPC Function**
```
Client → Supabase RPC → PostgreSQL Function → Response
- Pros: Faster (no cold start), transactional
- Cons: PL/pgSQL (harder to maintain)
- Use case: Simple validation with DB operations
```

**Option 3: Database Trigger**
```
Client → Insert/Update → Trigger → Validation → Response
- Pros: Automatic, no explicit call needed
- Cons: Harder to debug, less flexible
- Use case: Passive validation
```

**✅ DECISION:** **Edge Function** for flexibility and testability

**Why Edge Function:**
- TypeScript (same language as client, easy to share validation logic)
- Testable with Deno's built-in test runner
- Can reuse helper functions from `state.ts`
- Easier to debug than PL/pgSQL
- Supports complex validation logic

### 1.3 Real-Time Sync Strategy

**Current Real-Time Flow:**
```typescript
// apps/mobile/src/hooks/useRealtime.ts
playCards() → Supabase realtime update → All clients notified
```

**Enhanced Flow with Validation:**
```typescript
playCards() 
  → Call Edge Function (validate)
  → If valid: Update database
  → Realtime broadcast to all players
  → If invalid: Return error to player only
```

**Design Considerations:**
- [ ] Error handling: How to communicate validation failures?
- [ ] Race conditions: What if two players play simultaneously?
- [ ] Optimistic updates: Show immediately or wait for validation?
- [ ] Rollback strategy: How to undo invalid moves?

---

## Phase 2: Database Schema Implementation (2-3 hours)

### 2.1 Migration Creation

**File:** `apps/mobile/supabase/migrations/[timestamp]_add_card_tracking.sql`

```sql
-- Add card tracking to room_players table
ALTER TABLE room_players 
ADD COLUMN hand JSONB DEFAULT '[]'::jsonb,
ADD COLUMN hand_count INTEGER GENERATED ALWAYS AS (jsonb_array_length(hand)) STORED;

-- Create index for performance
CREATE INDEX idx_room_players_hand_count ON room_players(hand_count);

-- Add validation history table (optional, for debugging)
CREATE TABLE IF NOT EXISTS validation_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  player_id UUID NOT NULL,
  action TEXT NOT NULL, -- 'play' or 'pass'
  is_valid BOOLEAN NOT NULL,
  reason TEXT,
  cards_played JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_validation_history_room ON validation_history(room_id, created_at DESC);
```

**Security Considerations:**
- [ ] Add Row-Level Security (RLS) policies
- [ ] Ensure players cannot read other players' hands
- [ ] Only allow updates via Edge Function (not direct client access)

```sql
-- RLS Policy: Players can only see their own hand
CREATE POLICY "Players can view own hand"
ON room_players FOR SELECT
USING (auth.uid() = player_id);

-- RLS Policy: Only Edge Functions can update hands
CREATE POLICY "Only service role can update hands"
ON room_players FOR UPDATE
USING (auth.role() = 'service_role');
```

### 2.2 Migration Testing

**Test Checklist:**
- [ ] Run migration on local Supabase instance
- [ ] Verify hand column is JSONB and nullable
- [ ] Test hand_count generated column updates correctly
- [ ] Verify RLS policies block unauthorized access
- [ ] Test performance with 1000+ rooms

**Test Commands:**
```bash
cd apps/mobile
supabase db reset --local
supabase db push --local
```

---

## Phase 3: Edge Function Implementation (6-8 hours) ✅ COMPLETE

**Status:** Complete  
**Date Completed:** December 9, 2025  
**Time Taken:** 6 hours

**Deliverables:**
- ✅ Edge Function (`validate-multiplayer-play/index.ts`) - 450+ lines
- ✅ Unit tests (`test.ts`) - 18 test cases
- ✅ Integration tests (`integration.test.ts`) - 18 scenarios
- ✅ Complete documentation (`README.md`)
- ✅ Deployment guide (`PHASE_3_EDGE_FUNCTION_COMPLETE.md`)

**Key Features Implemented:**
1. ✅ Full one-card-left rule validation
2. ✅ Highest card requirement for singles
3. ✅ Cannot-pass validation with beating logic
4. ✅ Multi-card play support (pairs, triples, 5-card combos)
5. ✅ Comprehensive error messages with card symbols
6. ✅ CORS and authentication support
7. ✅ Performance optimizations

**See:** `/docs/PHASE_3_EDGE_FUNCTION_COMPLETE.md` for deployment instructions

### 3.1 Edge Function Structure

**File:** `apps/mobile/supabase/functions/validate-multiplayer-play/index.ts`

```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface ValidatePlayRequest {
  room_id: string;
  player_id: string;
  action: 'play' | 'pass';
  cards?: Card[]; // Only for 'play' action
}

interface ValidationResult {
  valid: boolean;
  error?: string;
  next_player_hand_count?: number;
}

serve(async (req) => {
  try {
    const { room_id, player_id, action, cards } = await req.json();
    
    // Initialize Supabase client with service role key
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    
    // 1. Fetch room state and player hands
    const { data: room, error: roomError } = await supabase
      .from('rooms')
      .select(`
        *,
        room_players!inner(player_id, position, hand, hand_count)
      `)
      .eq('id', room_id)
      .single();
    
    if (roomError) throw roomError;
    
    // 2. Determine next player
    const currentPlayerIndex = room.room_players.findIndex(p => p.player_id === player_id);
    const nextPlayerIndex = (currentPlayerIndex + 1) % room.room_players.length;
    const nextPlayer = room.room_players[nextPlayerIndex];
    
    // 3. Check one-card-left rule
    if (nextPlayer.hand_count === 1) {
      if (action === 'play') {
        // Validate playing highest card
        const currentPlayer = room.room_players[currentPlayerIndex];
        const highestCard = findHighestCard(currentPlayer.hand);
        
        if (!areCardsEqual(cards, [highestCard])) {
          return new Response(
            JSON.stringify({
              valid: false,
              error: `Next player has 1 card! You must play your highest card: ${formatCard(highestCard)}`,
              next_player_hand_count: 1
            }),
            { headers: { 'Content-Type': 'application/json' }, status: 400 }
          );
        }
      } else if (action === 'pass') {
        // Validate cannot pass if can beat
        const currentPlayer = room.room_players[currentPlayerIndex];
        const canBeat = canBeatLastPlay(currentPlayer.hand, room.last_play);
        
        if (canBeat) {
          return new Response(
            JSON.stringify({
              valid: false,
              error: 'Next player has 1 card! You cannot pass when you can beat the play.',
              next_player_hand_count: 1
            }),
            { headers: { 'Content-Type': 'application/json' }, status: 400 }
          );
        }
      }
    }
    
    // 4. Validation passed
    return new Response(
      JSON.stringify({ valid: true }),
      { headers: { 'Content-Type': 'application/json' }, status: 200 }
    );
    
  } catch (error) {
    console.error('Validation error:', error);
    return new Response(
      JSON.stringify({ valid: false, error: error.message }),
      { headers: { 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});

// Helper functions (reuse from local game logic)
function findHighestCard(hand: Card[]): Card {
  return hand.sort((a, b) => {
    const rankOrder = { '3': 0, '4': 1, '5': 2, ..., '2': 12 };
    const suitOrder = { diamonds: 0, clubs: 1, hearts: 2, spades: 3 };
    
    const rankDiff = rankOrder[b.rank] - rankOrder[a.rank];
    if (rankDiff !== 0) return rankDiff;
    return suitOrder[b.suit] - suitOrder[a.suit];
  })[0];
}

function canBeatLastPlay(hand: Card[], lastPlay: any): boolean {
  // Implement Big 2 beating logic
  // (Copy from apps/mobile/src/game/state.ts)
}

function areCardsEqual(cards1: Card[], cards2: Card[]): boolean {
  // Compare cards by rank and suit
}

function formatCard(card: Card): string {
  const suits = { diamonds: '♦', clubs: '♣', hearts: '♥', spades: '♠' };
  return `${card.rank}${suits[card.suit]}`;
}
```

### 3.2 Edge Function Testing

**File:** `apps/mobile/supabase/functions/validate-multiplayer-play/test.ts`

```typescript
import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';

Deno.test('Should reject non-highest card when next player has 1 card', async () => {
  const response = await fetch('http://localhost:54321/functions/v1/validate-multiplayer-play', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      room_id: 'test-room-123',
      player_id: 'player-1',
      action: 'play',
      cards: [{ rank: '5', suit: 'hearts' }] // Not highest
    })
  });
  
  const result = await response.json();
  assertEquals(result.valid, false);
  assertEquals(result.error, 'Next player has 1 card! You must play your highest card: 2♠');
});

Deno.test('Should reject pass when can beat and next player has 1 card', async () => {
  const response = await fetch('http://localhost:54321/functions/v1/validate-multiplayer-play', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      room_id: 'test-room-123',
      player_id: 'player-1',
      action: 'pass'
    })
  });
  
  const result = await response.json();
  assertEquals(result.valid, false);
  assertEquals(result.error.includes('cannot pass'), true);
});
```

**Test Execution:**
```bash
cd apps/mobile
supabase functions serve validate-multiplayer-play --env-file .env.local
deno test --allow-net supabase/functions/validate-multiplayer-play/test.ts
```

### 3.3 Edge Function Deployment

```bash
cd apps/mobile
supabase functions deploy validate-multiplayer-play --no-verify-jwt
```

**Environment Variables Needed:**
- `SUPABASE_URL` (auto-injected)
- `SUPABASE_SERVICE_ROLE_KEY` (auto-injected)

---

## Phase 4: Client Integration (4-6 hours) ✅ CORE COMPLETE

**Status:** Core Complete (Hand sync pending architecture decision)  
**Date Completed:** December 10, 2025  
**Time Taken:** 3 hours (core features)  
**Remaining:** 5-6 hours (hand sync + UX enhancements)

**Deliverables:**
- ✅ Edge Function validation integrated in `playCards()` method
- ✅ Edge Function validation integrated in `pass()` method
- ✅ Database migration created (Phase 2: `20251210000239_add_card_tracking.sql`)
- ✅ Comprehensive implementation documentation
- ⏭️ Hand synchronization (pending architecture investigation)
- ⏭️ Loading states and UX enhancements
- ⏭️ End-to-end testing

**Key Features Implemented:**
1. ✅ Server-side validation before playing cards
2. ✅ Server-side validation before passing
3. ✅ Card format conversion (client → Edge Function)
4. ✅ Error handling and propagation
5. ✅ Database schema with RLS policies
6. ⏭️ Hand synchronization to database (requires investigation)

**See:** 
- `/docs/PHASE_4_SUMMARY.md` for complete summary
- `/docs/PHASE_4_CLIENT_INTEGRATION_NOTES.md` for detailed notes

**Next Steps:**
1. Apply Phase 2 migration: `cd apps/mobile && supabase db push`
2. Investigate game flow to determine hand sync approach
3. Implement hand synchronization
4. Add loading states and error message improvements
5. End-to-end testing

### 4.1 Update useRealtime Hook

**File:** `apps/mobile/src/hooks/useRealtime.ts`

**Changes Required:**

```typescript
// Line ~438: playCards() method
const playCards = useCallback(async (cards: Card[]) => {
  if (!user || !roomId) return;
  
  try {
    setIsProcessing(true);
    
    // 1. Call Edge Function for validation
    const { data: validationResult, error: validationError } = await supabase.functions.invoke(
      'validate-multiplayer-play',
      {
        body: {
          room_id: roomId,
          player_id: user.id,
          action: 'play',
          cards: cards
        }
      }
    );
    
    if (validationError || !validationResult.valid) {
      // Show error to current player only
      Alert.alert(
        'Invalid Play',
        validationResult.error || 'Cannot play these cards',
        [{ text: 'OK' }]
      );
      return;
    }
    
    // 2. Proceed with play (existing code)
    const { error: playError } = await supabase
      .from('rooms')
      .update({
        last_play: {
          player_id: user.id,
          cards: cards,
          play_type: determinePlayType(cards)
        },
        pass_count: 0,
        updated_at: new Date().toISOString()
      })
      .eq('id', roomId);
    
    if (playError) throw playError;
    
    // 3. Update player's hand in database
    const { error: handError } = await supabase
      .from('room_players')
      .update({
        hand: gameState.players[playerIndex].hand.filter(
          c => !cards.some(card => c.rank === card.rank && c.suit === card.suit)
        )
      })
      .eq('room_id', roomId)
      .eq('player_id', user.id);
    
    if (handError) throw handError;
    
  } catch (error) {
    console.error('Error playing cards:', error);
    Alert.alert('Error', 'Failed to play cards');
  } finally {
    setIsProcessing(false);
  }
}, [user, roomId, gameState]);

// Line ~524: pass() method
const pass = useCallback(async () => {
  if (!user || !roomId) return;
  
  try {
    setIsProcessing(true);
    
    // 1. Call Edge Function for validation
    const { data: validationResult, error: validationError } = await supabase.functions.invoke(
      'validate-multiplayer-play',
      {
        body: {
          room_id: roomId,
          player_id: user.id,
          action: 'pass'
        }
      }
    );
    
    if (validationError || !validationResult.valid) {
      Alert.alert(
        'Cannot Pass',
        validationResult.error || 'You cannot pass right now',
        [{ text: 'OK' }]
      );
      return;
    }
    
    // 2. Proceed with pass (existing code)
    const { error } = await supabase
      .from('rooms')
      .update({
        pass_count: (gameState.passCount || 0) + 1,
        updated_at: new Date().toISOString()
      })
      .eq('id', roomId);
    
    if (error) throw error;
    
  } catch (error) {
    console.error('Error passing:', error);
    Alert.alert('Error', 'Failed to pass');
  } finally {
    setIsProcessing(false);
  }
}, [user, roomId, gameState]);
```

### 4.2 Update Hand Synchronization

**New Function:** Sync local hand to database

```typescript
// Add to useRealtime.ts
const syncHandToDatabase = useCallback(async (hand: Card[]) => {
  if (!user || !roomId) return;
  
  try {
    await supabase
      .from('room_players')
      .update({ hand })
      .eq('room_id', roomId)
      .eq('player_id', user.id);
  } catch (error) {
    console.error('Error syncing hand:', error);
  }
}, [user, roomId]);

// Call after card distribution and after each play
useEffect(() => {
  if (gameState.players[playerIndex]?.hand) {
    syncHandToDatabase(gameState.players[playerIndex].hand);
  }
}, [gameState.players, playerIndex, syncHandToDatabase]);
```

### 4.3 Error Handling & UX

**Display Validation Errors:**
- Use `Alert.alert()` for immediate feedback
- Show card count of next player: "Next player has 1 card!"
- Highlight which card must be played (if possible)

**Loading States:**
- Show spinner during validation: `setIsProcessing(true)`
- Disable play/pass buttons while validating
- Timeout after 5 seconds if Edge Function doesn't respond

**Optimistic Updates (Optional):**
- Show move immediately on client
- Rollback if validation fails
- Trade-off: Better UX vs potential confusion

---

## Phase 5: Testing & Quality Assurance (6-8 hours)

### 5.1 Unit Tests

**Test Files to Create:**

1. **Edge Function Tests:** `apps/mobile/supabase/functions/validate-multiplayer-play/test.ts`
   - [ ] Test: Valid play when next player has 2+ cards
   - [ ] Test: Invalid play when not highest card and next player has 1 card
   - [ ] Test: Valid pass when cannot beat and next player has 1 card
   - [ ] Test: Invalid pass when can beat and next player has 1 card
   - [ ] Test: Edge case - Last two players, both have 1 card
   - [ ] Test: Performance - Validation completes in <100ms

2. **Client Tests:** Add to existing test suite
   - [ ] Test: playCards() calls Edge Function before database update
   - [ ] Test: pass() calls Edge Function before database update
   - [ ] Test: Validation error shows alert
   - [ ] Test: Hand syncs to database after play

### 5.2 Integration Tests

**Playwright E2E Tests:** `tests/multiplayer-one-card-left.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test('One-card-left rule enforced in multiplayer', async ({ page, context }) => {
  // Setup: Create room with 4 players
  const room = await createTestRoom(4);
  
  // Simulate game until Player 2 has 1 card
  await playUntilPlayerHasOneCard(room, 2);
  
  // Player 1 tries to play non-highest card
  await page.click('[data-testid="card-5-hearts"]');
  await page.click('[data-testid="play-button"]');
  
  // Should show error
  await expect(page.getByText('Next player has 1 card!')).toBeVisible();
  await expect(page.getByText('You must play your highest card')).toBeVisible();
  
  // Play highest card instead
  await page.click('[data-testid="card-2-spades"]');
  await page.click('[data-testid="play-button"]');
  
  // Should succeed
  await expect(page.getByText('Invalid Play')).not.toBeVisible();
});

test('Cannot pass when can beat and next player has 1 card', async ({ page }) => {
  // Setup: Player can beat last play, next player has 1 card
  const room = await setupPassTestScenario();
  
  // Try to pass
  await page.click('[data-testid="pass-button"]');
  
  // Should show error
  await expect(page.getByText('You cannot pass when you can beat the play')).toBeVisible();
});
```

**Test Execution:**
```bash
cd apps/mobile
npm run test:e2e
```

### 5.3 Manual Testing Checklist

**Scenario 1: Two Players, Both Have 1 Card**
- [ ] Player 1 must play their highest card
- [ ] Player 2 must play their highest card or lose
- [ ] Game ends correctly

**Scenario 2: Four Players, Player 2 Has 1 Card**
- [ ] Player 1 must play highest card
- [ ] Player 3 and Player 4 can play normally
- [ ] After Player 2's turn, restriction lifts for Player 1

**Scenario 3: Race Condition Test**
- [ ] Two players try to play simultaneously
- [ ] Only one play is accepted
- [ ] Validation doesn't break

**Scenario 4: Network Failure**
- [ ] Edge Function times out (disconnect WiFi)
- [ ] User sees error message
- [ ] Game state remains consistent

**Scenario 5: Malicious Client**
- [ ] Client sends modified hand data
- [ ] Server validation rejects tampered data
- [ ] Player is not able to cheat

### 5.4 Performance Testing

**Load Test: 100 Concurrent Rooms**
```bash
# Use artillery or k6 for load testing
artillery quick --count 100 --num 10 \
  https://[project-id].supabase.co/functions/v1/validate-multiplayer-play
```

**Metrics to Track:**
- [ ] Average validation latency: Target <200ms
- [ ] 99th percentile latency: Target <500ms
- [ ] Error rate: Target <0.1%
- [ ] Database query time: Target <50ms

---

## Phase 6: Deployment & Rollout (2-3 hours)

### 6.1 Pre-Deployment Checklist

- [ ] All unit tests passing (100% coverage on validation logic)
- [ ] All integration tests passing
- [ ] Manual testing scenarios completed
- [ ] Performance benchmarks meet targets
- [ ] Database migration tested on staging
- [ ] Edge Function tested on staging
- [ ] Rollback plan documented
- [ ] Monitoring alerts configured

### 6.2 Deployment Steps

**Step 1: Deploy Database Migration**
```bash
cd apps/mobile
supabase db push --linked
```

**Step 2: Deploy Edge Function**
```bash
supabase functions deploy validate-multiplayer-play
```

**Step 3: Deploy Mobile App Update**
```bash
# Build and submit to app stores
eas build --platform all --profile production
eas submit --platform all
```

**Step 4: Verify Production**
- [ ] Check Edge Function logs: `supabase functions logs validate-multiplayer-play`
- [ ] Monitor database performance: `supabase db inspect performance`
- [ ] Test with production account

### 6.3 Rollback Plan

**If Critical Issues Arise:**

1. **Immediate:** Disable Edge Function validation
   ```typescript
   // Temporary flag in useRealtime.ts
   const ENABLE_SERVER_VALIDATION = false;
   ```

2. **Database:** Rollback migration
   ```bash
   supabase db reset --linked
   supabase db push --linked --exclude [migration-file]
   ```

3. **Client:** Release hotfix with validation disabled
   ```bash
   eas update --branch production --message "Disable server validation"
   ```

### 6.4 Monitoring & Alerts

**Key Metrics to Monitor:**
- Edge Function invocation rate (should match game play rate)
- Edge Function error rate (should be <1%)
- Database query latency on `room_players.hand` lookups
- Client-side validation error counts

**Alerts to Configure:**
- Edge Function error rate >5% for 5 minutes
- Average latency >500ms for 10 minutes
- Database connection pool exhaustion

**Tools:**
- Supabase Dashboard: Monitoring & Logs
- Sentry: Client-side error tracking
- LangSmith: Edge Function tracing (if using MCP)

---

## Phase 7: Documentation & Cleanup (2-3 hours)

### 7.1 Code Documentation

**Update README:**
- Document new Edge Function: Purpose, inputs, outputs
- Document database schema changes
- Add troubleshooting guide

**Inline Comments:**
- Explain validation logic in Edge Function
- Document helper functions (findHighestCard, canBeatLastPlay)
- Add JSDoc comments for public functions

### 7.3 Cleanup Tasks

- [ ] Delete orphaned Edge Function from Supabase:
  ```bash
  supabase functions delete validate-one-card-left
  ```
- [ ] **UPDATE (DO NOT DELETE):** Add clarifying comments to `state.ts` validation logic:
  ```typescript
  // NOTE: This validation is for LOCAL SOLO GAMES ONLY (vs bots)
  // Multiplayer games use server-side validation in Edge Function
  // ONE-CARD-LEFT RULE: Cannot pass when next player has 1 card...
  ```
- [ ] Update task status in todo list
- [ ] Archive implementation plan (this file)
- [ ] Delete orphaned Edge Function from Supabase:
  ```bash
  supabase functions delete validate-one-card-left
  ```
- [ ] Remove local-only comments from `state.ts`
- [ ] Update task status in todo list
- [ ] Archive implementation plan (this file)

---

## Risk Assessment & Mitigation

### High-Risk Areas

**Risk 1: Race Conditions**
- **Impact:** Two players play simultaneously, validation fails
- **Mitigation:** Use database transactions with row-level locking
- **Fallback:** Implement optimistic locking with version numbers

**Risk 2: Edge Function Latency**
- **Impact:** Slow validation (>500ms) degrades UX
- **Mitigation:** Optimize database queries, add indexes
- **Fallback:** Cache player hands in Edge Function memory

**Risk 3: Hand Data Privacy**
- **Impact:** Players could theoretically see other players' hands
- **Mitigation:** RLS policies, encrypt hand data, audit logs
- **Fallback:** Store only card counts, not full hands

**Risk 4: Client-Server Desync**
- **Impact:** Client state differs from server state
- **Mitigation:** Always fetch from server after validation
- **Fallback:** Add reconciliation logic on mismatch

### Medium-Risk Areas

**Risk 5: Backward Compatibility**
- **Impact:** Old app versions break after schema change
- **Mitigation:** Make `hand` column nullable, default to empty array
- **Fallback:** Feature flag to disable validation for old clients

**Risk 6: Testing Coverage**
- **Impact:** Edge cases not caught before production
- **Mitigation:** 100% test coverage requirement, manual QA
- **Fallback:** Phased rollout (10% → 50% → 100%)

---

## Success Metrics

### Functional Metrics
- ✅ 100% of invalid plays are blocked (no false negatives)
- ✅ 0% of valid plays are blocked (no false positives)
- ✅ Rule enforced in 100% of multiplayer games

### Performance Metrics
- ✅ Validation latency p50 <100ms, p99 <300ms
- ✅ No increase in database CPU usage (< +5%)
- ✅ No increase in client crash rate

### Business Metrics
- ✅ Player reports of cheating decrease by >90%
- ✅ Player retention rate remains stable (±2%)
- ✅ No increase in support tickets

---

## Timeline & Effort Estimate

| Phase | Duration | Dependencies | Owner |
|-------|----------|--------------|-------|
| Phase 1: Architecture & Design | 4-6 hours | None | Backend Engineer |
| Phase 2: Database Schema | 2-3 hours | Phase 1 | Backend Engineer |
| Phase 3: Edge Function | 6-8 hours | Phase 2 | Backend Engineer |
| Phase 4: Client Integration | 4-6 hours | Phase 3 | Mobile Engineer |
| Phase 5: Testing & QA | 6-8 hours | Phase 4 | QA Engineer + All |
| Phase 6: Deployment | 2-3 hours | Phase 5 | DevOps + Backend |
| Phase 7: Documentation | 2-3 hours | Phase 6 | Technical Writer |

**Total Estimated Effort:** 26-37 hours (~3-5 days)

**Critical Path:** Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6

**Parallel Work Opportunities:**
- Documentation can start during Phase 5
- Client integration can begin while Edge Function tests are being written

---

## Open Questions & Decisions

### Architecture Decisions
- [ ] **Q:** Should we store full hand data or just card counts?  
  **A:** TBD - Leaning towards full hand for better validation

- [ ] **Q:** Edge Function vs RPC Function?  
  **A:** Edge Function (TypeScript, easier to test)

- [ ] **Q:** Optimistic updates or wait for validation?  
  **A:** TBD - Test both approaches

### Security Decisions
- [ ] **Q:** How to prevent hand data leaks?  
  **A:** RLS policies + encryption

- [ ] **Q:** Should we audit validation attempts?  
  **A:** Yes, for debugging and cheat detection

### UX Decisions
- [ ] **Q:** How to show validation errors?  
  **A:** Alert modal with clear explanation

- [ ] **Q:** Should we highlight the required card?  
  **A:** Nice-to-have, not MVP
### A. Related Files
- `/apps/mobile/src/game/state.ts` - **Local solo game validation (KEEP AS-IS)** - Reference for server logic
  - Lines 280-302: Pass validation with one-card-left rule
  - Lines 535-560: Play validation with highest card requirement
- `/apps/mobile/src/hooks/useRealtime.ts` - **Multiplayer game state management (ADD SERVER CALLS)**
  - Line ~438: `playCards()` - Add Edge Function validation before play
  - Line ~524: `pass()` - Add Edge Function validation before pass
- `/apps/mobile/supabase/migrations/` - Database schema (add hand column)
- `/big2-multiplayer/` - DO NOT TOUCH (separate project, different architecture)
### A. Related Files
- `/apps/mobile/src/game/state.ts` - Local game validation (reference implementation)
### C. Code Reuse Strategy (Local → Server)

**From `state.ts` (Local Validation) → Edge Function (Server Validation):**

1. **Highest Card Logic** (Lines ~540-555):
   ```typescript
   const sortedHand = sortHand([...player.hand]);
   const highestCard = sortedHand[sortedHand.length - 1];
   ```
   → Copy to Edge Function `findHighestCard()`

2. **Can Beat Check** (Lines ~285-295):
   ```typescript
   const canBeat = canBeatPlay(currentPlayer.hand, this.state.lastPlay);
   ```
   → Copy to Edge Function `canBeatLastPlay()`

3. **Card Sorting** (Existing `sortHand()` function):
   → Reuse in Edge Function for consistent ordering

4. **Suit Symbols** (Lines ~288-293, ~548-553):
   ```typescript
   const suitSymbols: Record<string, string> = {
     'D': '♦', 'C': '♣', 'H': '♥', 'S': '♠'
   };
   ```
   → Copy to Edge Function for error messages

**Architecture:**
```
┌─────────────────────────────────────────────────────┐
│ SOLO GAMES (Offline)                                │
│ Client → state.ts validation → Local game state     │
│ ✅ Works offline                                     │
│ ✅ Instant feedback                                  │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ MULTIPLAYER GAMES (Online)                          │
│ Client → Edge Function validation → Database        │
│ ✅ Server-authoritative                             │
│ ✅ Cannot be bypassed                               │
│ ✅ Fair for all players                             │
└─────────────────────────────────────────────────────┘
```
### B. Reference Documentation
- Big 2 Rules: https://en.wikipedia.org/wiki/Big_two
- Supabase Edge Functions: https://supabase.com/docs/guides/functions
- Supabase Realtime: https://supabase.com/docs/guides/realtime

### C. Similar Implementations
- Local game validation: `/apps/mobile/src/game/state.ts` lines 265, 483
- Card sorting logic: Reuse from `GameStateManager.sortHand()`
- Play beating logic: Reuse from `GameStateManager.canBeatPlay()`

---

## Next Steps

1. **Review this plan with team** (30 min meeting)
2. **Get approval to proceed** (stakeholder sign-off)
3. **Assign tasks to engineers** (use task management system)
4. **Start Phase 1: Architecture & Design** (schedule architecture review)
5. **Set up daily standups** (15 min sync during implementation)

---

**Status:** ✅ **Plan Complete - Ready for Review**  
**Last Updated:** December 9, 2025  
**Next Review:** After Phase 1 completion
