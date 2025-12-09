# Phase 1: Architecture & Design Analysis - COMPLETE

**Date:** December 9, 2025  
**Status:** ✅ Complete  
**Duration:** 1.5 hours  

---

## Executive Summary

Phase 1 has been completed successfully. This document contains the comprehensive architecture analysis and design decisions for implementing server-side one-card-left rule validation in multiplayer games.

### Key Findings

1. ✅ **Current Database Schema** - Well-structured, ready for extension
2. ✅ **Validation Logic Exists** - Can be reused from `state.ts` and `game-logic.ts`
3. ✅ **No game_state Table** - Multiplayer uses `rooms` + `room_players` only
4. ✅ **Edge Functions Infrastructure** - Already exists and working
5. ✅ **Code Reuse Strategy** - Clear path from local → server validation

---

## 1. Database Schema Analysis

### 1.1 Current Schema Overview

**Core Tables:**
```sql
-- rooms table (created implicitly, enhanced by migrations)
rooms (
  id UUID PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  host_id UUID REFERENCES auth.users(id),
  status TEXT CHECK (status IN ('waiting', 'playing', 'finished')),
  max_players INTEGER DEFAULT 4,
  fill_with_bots BOOLEAN DEFAULT FALSE,
  is_public BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  -- NO last_play or game state columns currently
)

-- room_players table (primary table for multiplayer lobby)
room_players (
  id UUID PRIMARY KEY,
  room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  username VARCHAR(50),  -- Added in migration 20251205000002
  player_index INTEGER CHECK (player_index >= 0 AND player_index < 4),
  is_host BOOLEAN DEFAULT FALSE,
  is_ready BOOLEAN DEFAULT FALSE,
  is_bot BOOLEAN DEFAULT FALSE,
  joined_at TIMESTAMPTZ,
  -- MISSING: hand JSONB column (TO BE ADDED)
  -- MISSING: hand_count INTEGER generated column (TO BE ADDED)
  
  UNIQUE(room_id, player_index),
  UNIQUE(room_id, user_id)
)

-- profiles table (user metadata)
profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  username VARCHAR(50) UNIQUE,
  avatar_url TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
```

**Indexes:**
- `idx_room_players_room_id` - Fast room lookups
- `idx_room_players_user_id` - Fast user lookups
- `idx_room_players_username` - Username searches
- `idx_room_players_username_global_unique` - Global username uniqueness (LOWER(username))
- `idx_rooms_is_public_status` - Public room filtering

**RLS Policies:**
- ✅ Players can view room_players in their room
- ✅ Authenticated users can join rooms
- ✅ Players can update their own status
- ✅ Players can leave rooms
- ✅ Host can update room (via host_id check)

### 1.2 Schema Gaps & Requirements

**What's Missing for Server Validation:**

1. **`room_players.hand` column** (JSONB)
   - Purpose: Store each player's current hand securely
   - Type: `JSONB` for array of Card objects
   - Default: `'[]'::jsonb`
   - Required for: Finding highest card, validating plays

2. **`room_players.hand_count` column** (INTEGER, GENERATED)
   - Purpose: Fast lookup of player card counts
   - Type: `INTEGER GENERATED ALWAYS AS (jsonb_array_length(hand)) STORED`
   - Required for: "Next player has 1 card" check
   - Performance: Indexed for O(1) lookup

3. **`rooms.last_play` column** (JSONB) - OPTIONAL
   - Purpose: Store current play to beat
   - Type: `JSONB` { player_id, cards, combo }
   - Alternative: Could be stored in real-time channel state only
   - **DECISION:** Store in database for server validation reliability

4. **`validation_history` table** (NEW) - OPTIONAL but RECOMMENDED
   - Purpose: Audit log for debugging and cheat detection
   - Columns: room_id, player_id, action, is_valid, reason, cards_played, created_at
   - Use case: Investigate suspicious activity, debug validation failures

### 1.3 Privacy & Security Considerations

**Q: Should players see other players' hands?**  
**A:** NO - Protect via RLS policies

**RLS Policy Strategy:**
```sql
-- Players can ONLY see their own hand
CREATE POLICY "Players can view own hand"
ON room_players FOR SELECT
USING (auth.uid() = user_id);

-- Only service_role can update hands (Edge Function only)
CREATE POLICY "Only service role can update hands"
ON room_players FOR UPDATE
USING (auth.role() = 'service_role');

-- Prevent client-side tampering
REVOKE UPDATE ON room_players.hand FROM authenticated;
```

**Security Measures:**
1. ✅ Hand data only updatable by Edge Functions (service_role)
2. ✅ Players can only SELECT their own hand (not others')
3. ✅ Validation happens server-side (client cannot bypass)
4. ✅ Audit log tracks all validation attempts

### 1.4 Performance Considerations

**Database Query Optimization:**
```sql
-- Index for fast "next player has 1 card" check
CREATE INDEX idx_room_players_hand_count ON room_players(hand_count);

-- Composite index for room + player lookups
CREATE INDEX idx_room_players_room_user ON room_players(room_id, user_id);
```

**Expected Query Performance:**
- Room + players fetch: <10ms (single JOIN)
- Hand count check: <5ms (indexed column)
- Validation history insert: <5ms (async, non-blocking)
- **Total validation latency target: <100ms (p50), <300ms (p99)**

---

## 2. Validation Architecture Design

### 2.1 Decision: Edge Function (TypeScript)

**✅ SELECTED:** Edge Function approach

**Why Edge Function over Database RPC:**
1. **TypeScript** - Same language as client, easy to share code
2. **Testable** - Deno test runner built-in
3. **Debuggable** - Better error messages, stack traces
4. **Code Reuse** - Can import from `game-logic.ts` (with minor adaptations)
5. **Flexibility** - Complex validation logic without PL/pgSQL limitations

**Trade-offs Accepted:**
- Cold start latency: ~50-200ms (acceptable for turn-based game)
- Edge Function pricing: Minimal cost for this use case

### 2.2 Edge Function Architecture

**File Structure:**
```
apps/mobile/supabase/functions/
└── validate-multiplayer-play/
    ├── index.ts              # Main handler
    ├── validation-logic.ts   # Core validation (reused from game-logic.ts)
    ├── types.ts              # Shared types (Card, LastPlay, etc.)
    └── _test.ts              # Deno tests
```

**Request Flow:**
```
Client (playCards/pass)
  ↓
  Edge Function: validate-multiplayer-play
  ↓
  1. Fetch room + room_players (with hands)
  2. Determine next player
  3. Check one-card-left rule
     - If action='play': Validate highest card
     - If action='pass': Validate cannot pass if can beat
  4. Return { valid: true/false, error?: string }
  ↓
  Client receives response
  ↓
  If valid: Update database + broadcast
  If invalid: Show error alert to player
```

**Input Schema:**
```typescript
interface ValidatePlayRequest {
  room_id: string;
  player_id: string;
  action: 'play' | 'pass';
  cards?: Card[];  // Only for 'play' action
}
```

**Output Schema:**
```typescript
interface ValidationResult {
  valid: boolean;
  error?: string;
  next_player_hand_count?: number;  // For client debugging
}
```

### 2.3 Code Reuse Strategy

**From `state.ts` (Local Validation):**

1. **Highest Card Logic** (Lines 540-555)
   ```typescript
   // Source: apps/mobile/src/game/state.ts
   const sortedHand = sortHand([...player.hand]);
   const highestCard = sortedHand[sortedHand.length - 1];
   ```
   → Copy to Edge Function `findHighestCard(hand: Card[]): Card`

2. **Can Beat Check** (Lines 285-295)
   ```typescript
   // Source: apps/mobile/src/game/state.ts
   const canBeat = canBeatPlay(currentPlayer.hand, this.state.lastPlay);
   ```
   → Import from `game-logic.ts` (available as exported function)

3. **Card Comparison**
   ```typescript
   // Check if playing the highest card
   if (playingCard.id !== highestCard.id) { ... }
   ```
   → Copy to Edge Function `areCardsEqual()`

**From `game-logic.ts` (Already Exported):**

1. **`canBeatPlay(newCards, lastPlay)`** - Already exported ✅
2. **`sortHand(cards)`** - Already exported ✅
3. **`classifyCards(cards)`** - Already exported ✅
4. **`RANK_VALUE`, `SUIT_VALUE` constants** - Already exported ✅

**Adaptation Required:**
- Edge Function runs in Deno, not React Native
- Import paths: Change from relative to absolute Deno URLs
- Remove React Native dependencies (e.g., `AsyncStorage`, `Alert`)

### 2.4 Real-Time Sync Strategy

**Current Flow (No Validation):**
```
Client: playCards()
  → Update rooms.last_play
  → Realtime channel broadcasts to all clients
  → All clients update local state
```

**Enhanced Flow (With Validation):**
```
Client: playCards()
  ↓
  1. Call Edge Function (validate)
     → If invalid: Show error, STOP
     → If valid: Continue
  ↓
  2. Update rooms.last_play
  3. Update room_players.hand (remove played cards)
  ↓
  4. Realtime channel broadcasts to all clients
  ↓
  5. All clients update local state
```

**Error Handling:**
- **Invalid play:** Show error to current player only (not broadcast)
- **Network timeout:** Show generic error, don't update state
- **Race condition:** Database constraint prevents duplicate plays

**Optimistic Updates Decision:**
- **❌ NO optimistic updates for multiplayer**
- Reason: Server validation is authoritative, rollback is complex
- Trade-off: Slight latency (100-300ms) but guaranteed correctness

---

## 3. Implementation Roadmap

### 3.1 Phase 2: Database Schema Implementation (Next)

**Tasks:**
1. Create migration: `20251209000001_add_card_tracking.sql`
2. Add `room_players.hand` column (JSONB)
3. Add `room_players.hand_count` generated column
4. Add `rooms.last_play` column (JSONB)
5. Create `validation_history` table (optional)
6. Add RLS policies for hand privacy
7. Add indexes for performance
8. Test migration locally
9. Push to remote

**Estimated Time:** 2-3 hours

### 3.2 Phase 3: Edge Function Implementation

**Tasks:**
1. Create `validate-multiplayer-play` function directory
2. Copy validation logic from `state.ts` and `game-logic.ts`
3. Implement request handler
4. Add helper functions (findHighestCard, areCardsEqual)
5. Write Deno tests
6. Test locally with `supabase functions serve`
7. Deploy to Supabase

**Estimated Time:** 6-8 hours

### 3.3 Phase 4: Client Integration

**Tasks:**
1. Update `useRealtime.ts` playCards() method
2. Update `useRealtime.ts` pass() method
3. Add Edge Function invocation calls
4. Implement error handling (Alert.alert)
5. Add loading states (setIsProcessing)
6. Sync hand to database after plays
7. Test in mobile app

**Estimated Time:** 4-6 hours

---

## 4. Risk Assessment

### 4.1 High-Risk Areas

**Risk 1: Race Conditions**
- **Scenario:** Two players play simultaneously
- **Impact:** Both validations pass, duplicate plays
- **Mitigation:** Database transaction + row-level locking
- **Fallback:** Add `version` column for optimistic locking

**Risk 2: Edge Function Latency**
- **Scenario:** Validation takes >500ms
- **Impact:** Poor UX, player frustration
- **Mitigation:** Optimize queries, add indexes, cache player hands
- **Fallback:** Show loading spinner, timeout after 5s

**Risk 3: Hand Data Desync**
- **Scenario:** Client hand differs from server hand
- **Impact:** Validation failures, confused players
- **Mitigation:** Always sync hand to database after plays
- **Fallback:** Add reconciliation endpoint to re-sync

### 4.2 Medium-Risk Areas

**Risk 4: Backward Compatibility**
- **Scenario:** Old app versions don't sync hands
- **Impact:** Validation fails for old clients
- **Mitigation:** Make `hand` column nullable, default to empty array
- **Fallback:** Feature flag to disable validation for old clients

**Risk 5: Privacy Leaks**
- **Scenario:** RLS policy misconfigured, players see other hands
- **Impact:** Cheating, unfair gameplay
- **Mitigation:** Comprehensive RLS policy testing
- **Fallback:** Encrypt hand data at rest

---

## 5. Validation Logic Specification

### 5.1 One-Card-Left Rule (Detailed)

**Rule 1: Playing Cards When Next Player Has 1 Card**
```
IF next_player.hand_count === 1 AND action === 'play' THEN
  IF cards.length === 1 THEN
    highest_card = findHighestCard(current_player.hand)
    IF cards[0] !== highest_card THEN
      REJECT with error: "Next player has 1 card! You must play your highest card: {highest_card}"
    END IF
  ELSE
    ALLOW (multi-card plays have no restriction)
  END IF
END IF
```

**Rule 2: Passing When Next Player Has 1 Card**
```
IF next_player.hand_count === 1 AND action === 'pass' THEN
  can_beat = canBeatPlay(current_player.hand, last_play)
  IF can_beat THEN
    REJECT with error: "Next player has 1 card! You cannot pass when you can beat the play."
  ELSE
    ALLOW (pass is OK if cannot beat)
  END IF
END IF
```

### 5.2 Highest Card Determination

**Algorithm (Big Two Rules):**
```typescript
function findHighestCard(hand: Card[]): Card {
  // Sort by rank value (3=0, 4=1, ..., A=12, 2=13)
  // Then by suit value (diamonds=0, clubs=1, hearts=2, spades=3)
  const sorted = sortHand(hand);
  
  // Highest card is last in sorted array
  return sorted[sorted.length - 1];
}
```

**Example:**
```
Hand: [3♦, 5♣, 2♠, K♥, A♦]
Sorted: [3♦, 5♣, K♥, A♦, 2♠]
Highest: 2♠ (2 is highest rank, spades is highest suit)
```

### 5.3 Can Beat Validation

**Algorithm (Reuse from game-logic.ts):**
```typescript
function canBeatLastPlay(hand: Card[], lastPlay: LastPlay): boolean {
  // Try all possible plays from hand that match lastPlay.cards.length
  const numCards = lastPlay.cards.length;
  
  if (numCards === 1) {
    // Try each single card
    for (const card of hand) {
      if (canBeatPlay([card], lastPlay)) return true;
    }
  } else if (numCards === 2) {
    // Try all pairs
    const pairs = findAllPairs(hand);
    for (const pair of pairs) {
      if (canBeatPlay(pair, lastPlay)) return true;
    }
  }
  // ... similar for triples, 5-card combos
  
  return false;
}
```

---

## 6. Testing Strategy

### 6.1 Unit Tests (Edge Function)

**Test Cases:**
1. ✅ Valid play when next player has 2+ cards
2. ❌ Invalid play when not highest card and next player has 1 card
3. ✅ Valid pass when cannot beat and next player has 1 card
4. ❌ Invalid pass when can beat and next player has 1 card
5. ✅ Edge case: Last two players, both have 1 card
6. ✅ Performance: Validation completes in <100ms

### 6.2 Integration Tests (E2E)

**Test Scenarios:**
1. Four players, Player 2 has 1 card → Player 1 must play highest
2. Two players, both have 1 card → Both must play highest
3. Player can beat but next player has 1 card → Cannot pass
4. Race condition: Two players play simultaneously → Only one succeeds

### 6.3 Manual Testing

**Checklist:**
- [ ] Play non-highest card when next player has 1 card → Error shown
- [ ] Play highest card when next player has 1 card → Success
- [ ] Pass when can beat and next player has 1 card → Error shown
- [ ] Pass when cannot beat and next player has 1 card → Success
- [ ] After player with 1 card plays → Restriction lifts for others

---

## 7. Success Criteria

### 7.1 Functional Requirements

- ✅ 100% of invalid plays blocked (no false negatives)
- ✅ 0% of valid plays blocked (no false positives)
- ✅ Rule enforced in 100% of multiplayer games
- ✅ Error messages clear and helpful

### 7.2 Performance Requirements

- ✅ Validation latency p50 <100ms
- ✅ Validation latency p99 <300ms
- ✅ No increase in database CPU usage (< +5%)
- ✅ No increase in client crash rate

### 7.3 Security Requirements

- ✅ Players cannot see other players' hands (RLS policies)
- ✅ Players cannot bypass validation (server-side only)
- ✅ Validation attempts audited (validation_history table)

---

## 8. Next Steps

### Immediate Actions (Phase 2)

1. **Create database migration** - Add hand, hand_count, last_play columns
2. **Add RLS policies** - Protect hand data privacy
3. **Add indexes** - Optimize performance
4. **Test locally** - Verify schema changes work
5. **Push to production** - Deploy migration

### Prepare for Phase 3

1. **Set up Edge Function directory structure**
2. **Copy validation logic from state.ts**
3. **Import game-logic.ts functions**
4. **Write Deno tests**

---

## 9. Appendix

### 9.1 File References

**Database Schema:**
- `/apps/mobile/supabase/migrations/20251205000001_mobile_lobby_schema.sql` - Base schema
- `/apps/mobile/supabase/migrations/20251205000002_add_username_to_room_players.sql` - Username column
- `/apps/mobile/supabase/migrations/20251206000002_fix_global_username_uniqueness.sql` - Username constraints

**Validation Logic (Local):**
- `/apps/mobile/src/game/state.ts` - Lines 280-302 (pass validation)
- `/apps/mobile/src/game/state.ts` - Lines 535-560 (play validation)
- `/apps/mobile/src/game/engine/game-logic.ts` - Lines 260-320 (canBeatPlay, sortHand)

**Multiplayer Hook:**
- `/apps/mobile/src/hooks/useRealtime.ts` - Lines 438-498 (playCards)
- `/apps/mobile/src/hooks/useRealtime.ts` - Lines 524-534 (pass)

### 9.2 Key Decisions Log

| Decision | Option Chosen | Rationale | Date |
|----------|---------------|-----------|------|
| Store hand data in DB? | Yes (Option A) | Required for server validation | 2025-12-09 |
| Validation approach? | Edge Function | TypeScript, testable, code reuse | 2025-12-09 |
| Optimistic updates? | No | Server authority, simpler rollback | 2025-12-09 |
| Validation history? | Yes (optional) | Debugging and cheat detection | 2025-12-09 |
| Hand privacy? | RLS policies | Standard Supabase security pattern | 2025-12-09 |

---

## ✅ Phase 1 Sign-Off

**Completed By:** Beastmode Unified Agent  
**Date:** December 9, 2025  
**Status:** ✅ APPROVED - Ready for Phase 2  

**Key Deliverables:**
1. ✅ Database schema analysis complete
2. ✅ Validation architecture designed
3. ✅ Code reuse strategy documented
4. ✅ Risk assessment complete
5. ✅ Testing strategy defined
6. ✅ Success criteria established

**Next Phase:** Phase 2 - Database Schema Implementation (2-3 hours)
