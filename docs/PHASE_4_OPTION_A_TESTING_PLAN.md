# Phase 4 Option A: Comprehensive Testing Plan

**Date:** December 10, 2025  
**Status:** Ready for Testing  
**Prerequisites:** Docker + Supabase local instance  
**Estimated Time:** 5 hours

---

## 🚨 CRITICAL: Prerequisites

### 1. Install Docker (if not installed)

**Mac:**
```bash
# Download Docker Desktop from:
# https://www.docker.com/products/docker-desktop

# Or install via Homebrew:
brew install --cask docker

# Start Docker Desktop
open /Applications/Docker.app
```

**Verify Installation:**
```bash
docker --version
# Expected: Docker version 20.10+ or higher

docker ps
# Expected: Empty list or running containers (no errors)
```

### 2. Start Supabase Local Instance

```bash
# Navigate to mobile project
cd /Users/michaelalam/Desktop/Desktop/Coding/Coding/Big-Two-Neo/apps/mobile

# Start Supabase (will download images on first run ~500MB)
supabase start

# Expected output:
# Started supabase local development setup.
# 
#          API URL: http://localhost:54321
#      GraphQL URL: http://localhost:54321/graphql/v1
#           DB URL: postgresql://postgres:postgres@localhost:54322/postgres
#       Studio URL: http://localhost:54323
#     Inbucket URL: http://localhost:54324
#       JWT secret: ...
#         anon key: ...
# service_role key: ...
```

**If Supabase start fails:**
```bash
# Stop any existing instances
supabase stop

# Reset and restart
supabase db reset
supabase start
```

### 3. Apply Phase 2 Migration (Task 3)

```bash
# Verify migration file exists
ls supabase/migrations/*add_card_tracking.sql

# Apply migration to local database
supabase db push --local

# Verify schema changes
supabase db inspect

# Check if hand column exists
supabase db execute --local "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'room_players' AND column_name = 'hand';"

# Expected output:
#  column_name | data_type 
# -------------+-----------
#  hand        | jsonb
```

**Verify RLS Policies:**
```bash
supabase db execute --local "SELECT policyname, tablename, cmd FROM pg_policies WHERE tablename = 'room_players';"

# Expected policies:
# - "Players can view own hand"
# - "Only service role can update hands"
```

---

## 🧪 Testing Phases

## Phase 1: Edge Function Unit Testing (2 hours)

### Test 1.1: deal-cards Edge Function

**Start Edge Function Locally:**
```bash
cd apps/mobile

# Serve function
supabase functions serve deal-cards --env-file .env.local

# In another terminal, run tests
deno test --allow-net --allow-env supabase/functions/deal-cards/test.ts
```

**Manual Test Cases:**

**Test 1.1.1: 4-Player Deal**
```bash
curl -X POST http://localhost:54321/functions/v1/deal-cards \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -d '{
    "room_id": "test-room-4p"
  }'

# Expected response:
# {
#   "success": true,
#   "starting_player_id": "...",
#   "hands_dealt": 4,
#   "cards_per_hand": 13
# }
```

**Test 1.1.2: 2-Player Deal**
```bash
# Create room with 2 players first
curl -X POST http://localhost:54321/functions/v1/deal-cards \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -d '{
    "room_id": "test-room-2p"
  }'

# Expected: 26 cards per player
```

**Test 1.1.3: Starting Player Has 3♦**
```bash
# After dealing, verify starting player's hand contains 3 of diamonds
supabase db execute --local "
  SELECT hand FROM room_players 
  WHERE room_id = 'test-room-4p' 
  AND player_id = (SELECT current_turn FROM game_state WHERE room_id = 'test-room-4p');
"

# Expected: hand contains {"rank": "3", "suit": "D"}
```

**Test 1.1.4: No Duplicate Cards**
```bash
# Verify all 52 cards are dealt exactly once
supabase db execute --local "
  WITH all_cards AS (
    SELECT jsonb_array_elements(hand) AS card
    FROM room_players
    WHERE room_id = 'test-room-4p'
  )
  SELECT COUNT(*), COUNT(DISTINCT card) FROM all_cards;
"

# Expected: (52, 52) - total 52 cards, 52 unique
```

### Test 1.2: update-hand Edge Function

**Start Edge Function:**
```bash
supabase functions serve update-hand --env-file .env.local
```

**Test 1.2.1: Valid Card Removal**
```bash
# Play 3 of diamonds (starting move)
curl -X POST http://localhost:54321/functions/v1/update-hand \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -d '{
    "room_id": "test-room-4p",
    "player_id": "starting-player-id",
    "cards_played": [
      {"rank": "3", "suit": "D"}
    ]
  }'

# Expected response:
# {
#   "success": true,
#   "new_hand": [...],  // 12 cards remaining
#   "hand_count": 12,
#   "game_ended": false
# }
```

**Test 1.2.2: Cheat Detection (Invalid Card)**
```bash
# Try to play a card not in hand
curl -X POST http://localhost:54321/functions/v1/update-hand \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -d '{
    "room_id": "test-room-4p",
    "player_id": "starting-player-id",
    "cards_played": [
      {"rank": "2", "suit": "S"}  // Not in hand
    ]
  }'

# Expected response:
# {
#   "success": false,
#   "error": "Cards not in hand"
# }
# Status: 400
```

**Test 1.2.3: Win Detection**
```bash
# Manually set player to have 1 card, then play it
supabase db execute --local "
  UPDATE room_players 
  SET hand = '[{\"rank\": \"3\", \"suit\": \"D\"}]'::jsonb
  WHERE room_id = 'test-room-4p' AND player_id = 'starting-player-id';
"

curl -X POST http://localhost:54321/functions/v1/update-hand \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -d '{
    "room_id": "test-room-4p",
    "player_id": "starting-player-id",
    "cards_played": [{"rank": "3", "suit": "D"}]
  }'

# Expected response:
# {
#   "success": true,
#   "new_hand": [],
#   "hand_count": 0,
#   "game_ended": true
# }
```

### Test 1.3: validate-multiplayer-play Edge Function

**Already Deployed - Test Live:**
```bash
# Test one-card-left rule validation
curl -X POST http://localhost:54321/functions/v1/validate-multiplayer-play \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -d '{
    "room_id": "test-room-4p",
    "player_id": "player-1-id",
    "action": "play",
    "cards": [{"rank": "5", "suit": "H"}]
  }'

# Expected: validation based on next player's hand count
```

**See:** `/docs/PHASE_3_EDGE_FUNCTION_COMPLETE.md` for full test suite

---

## Phase 2: Client Integration Testing (2 hours)

### Test 2.1: Multiplayer Game Flow

**Setup: Create Room**
```bash
# Use Supabase Studio (http://localhost:54323)
# 1. Navigate to Table Editor → rooms
# 2. Insert new row:
#    - id: UUID
#    - code: "TEST01"
#    - status: "waiting"
#    - created_by: YOUR_USER_ID

# 3. Navigate to room_players
# 4. Insert 4 players:
#    - room_id: same UUID
#    - player_id: different UUIDs
#    - position: 0, 1, 2, 3
```

**Test 2.1.1: Room Connection**
```typescript
// In mobile app, navigate to GameScreen with roomCode: "TEST01"

// Expected logs:
// [GameScreen] Multiplayer mode detected
// [useRealtime] Connecting to room TEST01
// [useRealtime] Room loaded
// [GameScreen] Connecting to multiplayer... (loading screen)
// [GameScreen] Game UI rendered
```

**Test 2.1.2: Player Hand Display**
```typescript
// After room connection:
// 1. Host starts game (calls startGame())
// 2. deal-cards Edge Function executes
// 3. Player's hand is fetched from database
// 4. Hand displays in UI (13 cards)

// Verify in console:
// [GameScreen] playerHand: [...]  // 13 Card objects

// Verify in UI:
// - CardHand component shows 13 cards
// - Cards are sorted (3D at start for first player)
```

**Test 2.1.3: Opponent Card Counts**
```typescript
// After game starts:
// Verify opponent card counts display correctly

// Expected UI:
// - Top player: 13 cards
// - Left player: 13 cards  
// - Right player: 13 cards

// Verify in console:
// [GameScreen] opponentHandCounts: Map { "player2-id" => 13, "player3-id" => 13, "player4-id" => 13 }
```

**Test 2.1.4: Play Cards**
```typescript
// 1. Select cards in hand (tap to select)
// 2. Click "Play" button
// 3. Verify cards sent to server
// 4. Verify hand updates locally

// Expected logs:
// [GameScreen] Playing cards (multiplayer): ["3D"]
// [useRealtime] Calling validate-multiplayer-play...
// [useRealtime] Validation passed
// [useRealtime] Calling update-hand...
// [useRealtime] Hand updated: 12 cards
// [GameScreen] Cards played successfully

// Expected UI:
// - Hand now has 12 cards (3D removed)
// - Center play area shows 3D
// - Turn indicator moves to next player
```

**Test 2.1.5: Real-Time Opponent Updates**
```typescript
// When another player plays cards:
// 1. Server updates room_players table
// 2. Postgres subscription fires
// 3. opponentHandCounts map updates
// 4. UI re-renders

// Expected logs:
// [useRealtime] hand-updates channel: UPDATE event
// [useRealtime] Opponent player2-id has 12 cards

// Expected UI:
// - Opponent card count changes from 13 → 12
```

**Test 2.1.6: Pass Action**
```typescript
// 1. Click "Pass" button
// 2. Verify pass sent to server

// Expected logs:
// [GameScreen] Passing (multiplayer)...
// [useRealtime] Calling validate-multiplayer-play (action: pass)...
// [useRealtime] Validation passed
// [useRealtime] Updating game_state (pass_count + 1)
// [GameScreen] Pass successful

// Expected UI:
// - Turn indicator moves to next player
// - Pass count increments (if visible)
```

### Test 2.2: One-Card-Left Rule Enforcement

**Setup: Manually Set Next Player to 1 Card**
```bash
# In Supabase Studio:
supabase db execute --local "
  UPDATE room_players 
  SET hand = '[{\"rank\": \"2\", \"suit\": \"S\"}]'::jsonb
  WHERE room_id = 'test-room-id' AND position = 1;
"
```

**Test 2.2.1: Non-Highest Card Blocked**
```typescript
// 1. Current player selects non-highest card (e.g., 5H)
// 2. Click "Play"
// 3. Verify validation fails

// Expected logs:
// [GameScreen] Playing cards (multiplayer): ["5H"]
// [useRealtime] Calling validate-multiplayer-play...
// [useRealtime] Validation failed: Next player has 1 card! You must play your highest card: 2♠

// Expected UI:
// - Alert modal appears: "Invalid Move: Next player has 1 card! You must play your highest card: 2♠"
// - Cards remain in hand (not removed)
```

**Test 2.2.2: Highest Card Allowed**
```typescript
// 1. Current player selects highest card (2S)
// 2. Click "Play"
// 3. Verify play succeeds

// Expected logs:
// [GameScreen] Playing cards (multiplayer): ["2S"]
// [useRealtime] Validation passed
// [useRealtime] Hand updated

// Expected UI:
// - Cards played successfully
// - Center area shows 2♠
```

**Test 2.2.3: Cannot Pass When Can Beat**
```typescript
// Setup: Current player can beat last play, next player has 1 card

// 1. Click "Pass"
// 2. Verify validation fails

// Expected logs:
// [GameScreen] Passing (multiplayer)...
// [useRealtime] Validation failed: Next player has 1 card! You cannot pass when you can beat the play.

// Expected UI:
// - Alert modal: "Cannot Pass: Next player has 1 card! You cannot pass when you can beat the play."
```

### Test 2.3: Error Handling

**Test 2.3.1: Network Failure**
```bash
# Disconnect WiFi or stop Supabase
supabase stop
```

```typescript
// 1. Try to play cards
// 2. Verify timeout error

// Expected logs:
// [GameScreen] Playing cards (multiplayer)...
// [useRealtime] Error: Network request failed

// Expected UI:
// - Alert: "Multiplayer Error: Network request failed"
```

**Test 2.3.2: Invalid Room Code**
```typescript
// Navigate to GameScreen with roomCode: "INVALID"

// Expected logs:
// [GameScreen] Multiplayer mode detected
// [useRealtime] Error: Room not found

// Expected UI:
// - Loading screen shows error message
// - Option to return to home
```

**Test 2.3.3: Edge Function Timeout**
```typescript
// Simulate slow Edge Function (>5s)

// Expected logs:
// [GameScreen] Playing cards (multiplayer)...
// [useRealtime] Timeout waiting for Edge Function

// Expected UI:
// - Alert: "Request timed out. Please try again."
// - Cards remain in hand
```

---

## Phase 3: End-to-End Testing (1 hour)

### Test 3.1: Full 4-Player Game

**Setup: 4 Devices/Browsers**
```
Device 1: Host (creates room, starts game)
Device 2: Player 2
Device 3: Player 3
Device 4: Player 4
```

**Test Flow:**
1. Device 1 creates room (code: "ABC123")
2. Devices 2-4 join room
3. All devices show "Waiting for players..." (3/4 ready)
4. Device 1 starts game
5. All devices receive dealt hands
6. Player with 3♦ plays it
7. Game continues until one player has 1 card
8. Verify one-card-left rule enforced for all players
9. Continue until winner (hand empty)
10. Verify "Game Over" screen appears for all players

**Expected Outcome:**
- ✅ All players see synchronized game state
- ✅ Card counts update in real-time for all players
- ✅ Turn indicator moves correctly
- ✅ One-card-left rule blocks invalid plays
- ✅ Winner detected and announced to all

### Test 3.2: Disconnect/Reconnect

**Test Flow:**
1. Start 4-player game
2. Player 2 disconnects (close app or WiFi off)
3. Game continues without Player 2
4. Player 2 reconnects
5. Verify Player 2 sees current game state

**Expected Outcome:**
- ✅ Game doesn't crash when player disconnects
- ✅ Other players can continue
- ✅ Reconnected player syncs to current state
- ✅ Hand and card counts accurate after reconnect

### Test 3.3: Race Condition Test

**Test Flow:**
1. Two players try to play simultaneously
2. Verify only one play is accepted

**Expected Outcome:**
- ✅ First player's move succeeds
- ✅ Second player's move is rejected (not their turn)
- ✅ Game state remains consistent

---

## 📊 Test Metrics & Success Criteria

### Functional Requirements

| Requirement | Test | Status |
|-------------|------|--------|
| Cards dealt server-side | Test 1.1.1-1.1.4 | ⏭️ |
| Hands stored in database | Test 1.1.3 | ⏭️ |
| update-hand removes cards correctly | Test 1.2.1 | ⏭️ |
| Anti-cheat validation works | Test 1.2.2 | ⏭️ |
| Win detection fires | Test 1.2.3 | ⏭️ |
| Client displays playerHand | Test 2.1.2 | ⏭️ |
| Opponent card counts sync | Test 2.1.3, 2.1.5 | ⏭️ |
| Play cards updates hand | Test 2.1.4 | ⏭️ |
| One-card-left rule blocks non-highest | Test 2.2.1 | ⏭️ |
| One-card-left rule allows highest | Test 2.2.2 | ⏭️ |
| Cannot pass when can beat (1 card rule) | Test 2.2.3 | ⏭️ |

### Performance Requirements

| Metric | Target | Test | Status |
|--------|--------|------|--------|
| Edge Function cold start | <500ms | Test 1.1.1 (first call) | ⏭️ |
| Edge Function warm latency | <100ms | Test 1.1.1 (second+ call) | ⏭️ |
| Hand update latency | <200ms | Test 2.1.4 | ⏭️ |
| Real-time sync latency | <500ms | Test 2.1.5 | ⏭️ |

### Security Requirements

| Requirement | Test | Status |
|-------------|------|--------|
| Players cannot see others' hands | Manual DB check | ⏭️ |
| Cheat attempts blocked | Test 1.2.2 | ⏭️ |
| RLS policies active | Test 1.2.2 (DB query fails without service role) | ⏭️ |

---

## 🐛 Known Issues & Workarounds

### Issue 1: Migration Not Applied (Current Blocker)

**Symptoms:**
- Edge Functions return "column 'hand' does not exist"
- useRealtime fails to fetch playerHand

**Solution:**
```bash
# Install Docker (see Prerequisites)
cd apps/mobile
supabase start
supabase db push --local
```

### Issue 2: Cold Start Latency

**Symptoms:**
- First Edge Function call takes 2-3 seconds
- Subsequent calls are fast (<100ms)

**Workaround:**
- Keep functions warm with periodic pings
- Use Supabase Pro plan (reduces cold starts)

**Future Optimization:**
- Implement Edge Function warming in production

### Issue 3: Real-Time Subscription Lag

**Symptoms:**
- Opponent card counts update 500ms-1s after play

**Expected Behavior:**
- Postgres subscriptions have ~100-500ms latency

**Not a Bug:**
- This is normal for Postgres realtime

---

## 📝 Test Execution Checklist

### Before Testing
- [ ] Docker installed and running
- [ ] Supabase local instance started (`supabase start`)
- [ ] Phase 2 migration applied (`supabase db push --local`)
- [ ] Edge Functions verified (`supabase functions list`)
- [ ] Test data seeded (rooms + players in Supabase Studio)

### During Testing
- [ ] Record all test results (pass/fail)
- [ ] Screenshot any errors
- [ ] Save console logs for failed tests
- [ ] Note any unexpected behavior

### After Testing
- [ ] Update test status in this document
- [ ] File issues for any bugs found
- [ ] Update success criteria metrics
- [ ] Document any new workarounds

---

## 🚀 Next Steps After Testing

### If All Tests Pass:
1. Deploy Edge Functions to production
2. Apply migration to production database
3. Submit mobile app update
4. Update documentation
5. Mark Phase 4 complete

### If Tests Fail:
1. Document failures in issues
2. Fix bugs
3. Re-run affected tests
4. Update code and documentation
5. Repeat testing cycle

---

## 📚 Related Documentation

- **Phase 3 Complete:** `/docs/PHASE_3_EDGE_FUNCTION_COMPLETE.md`
- **Phase 4 Client Integration:** `/docs/PHASE_4_OPTION_A_CLIENT_INTEGRATION_COMPLETE.md`
- **Implementation Plan:** `/docs/TASK_ONE_CARD_LEFT_MULTIPLAYER_IMPLEMENTATION_PLAN.md`
- **Database Schema:** `/apps/mobile/supabase/migrations/20251210000239_add_card_tracking.sql`

---

**Status:** ⏭️ **Ready for Execution**  
**Blocked By:** Docker installation + Supabase local setup  
**Estimated Time:** 5 hours (after prerequisites)  
**Last Updated:** December 10, 2025
