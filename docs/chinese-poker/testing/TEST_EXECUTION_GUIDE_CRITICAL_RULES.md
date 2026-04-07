# Test Execution Guide - Critical Multiplayer Rules

**Created:** December 29, 2025  
**Purpose:** Instructions for running tests and verifying fixes

---

## Quick Start

### 1. Run the New Test Suite

```bash
cd apps/mobile

# Run critical rules tests
npm test -- critical-rules.test.ts --no-coverage

# Or run with watch mode for development
npm test -- critical-rules.test.ts --watch
```

**Expected Results (BEFORE applying migration):**
- ❌ Test 1: "Cannot pass when leading" - **FAILS** (server allows pass)
- ❌ Test 2: "First play without 3♦" - **FAILS** (server allows invalid play)
- ✅ Test 3: "Allow pass when last_play exists" - PASSES
- ✅ Test 4: "Accept first play with 3♦" - PASSES

### 2. Apply SQL Migration

```bash
# Option A: Using Supabase CLI (recommended)
cd apps/mobile
npx supabase db push

# Option B: Manual via Supabase Dashboard
# 1. Go to https://supabase.com/dashboard/project/YOUR_PROJECT/sql/new
# 2. Copy contents of: supabase/migrations/20251229000001_add_critical_game_rule_validation.sql
# 3. Click "Run"
```

### 3. Verify Migration Applied

```sql
-- Run this query in Supabase SQL Editor
SELECT 
  routine_name,
  routine_definition
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('execute_pass_move', 'execute_play_move')
ORDER BY routine_name;

-- Look for these strings in the definitions:
-- ✅ "Cannot pass when leading" (in execute_pass_move)
-- ✅ "First play must include 3♦" (in execute_play_move)
```

### 4. Run Tests Again (After Migration)

```bash
npm test -- critical-rules.test.ts --no-coverage
```

**Expected Results (AFTER applying migration):**
- ✅ Test 1: "Cannot pass when leading" - **PASSES** 
- ✅ Test 2: "First play without 3♦" - **PASSES**
- ✅ Test 3: "Allow pass when last_play exists" - PASSES
- ✅ Test 4: "Accept first play with 3♦" - PASSES
- ✅ All additional edge case tests - PASS

---

## Running Full Test Suite

### Unit Tests (Game Logic)

```bash
# Run all game logic tests
npm test -- game-logic.test.ts --no-coverage

# Key tests to verify:
# ✅ Card sorting and classification (33 tests)
# ✅ Combo validation (Single, Pair, Triple, 5-card)
# ✅ Beat logic (can card A beat card B?)
# ✅ One Card Left rule (already tested, reference)
```

### Integration Tests (State Manager)

```bash
# Run state manager tests (local game engine)
npm test -- state.test.ts --no-coverage

# These tests verify:
# ✅ Pass when leading prevention (local game)
# ✅ First play 3♦ requirement (local game)
# ✅ Turn management
# ✅ Match scoring
```

### Multiplayer Integration Tests

```bash
# Run multiplayer-specific tests
npm test -- critical-rules.test.ts --no-coverage

# These tests verify:
# ✅ Server-side validation (RPC functions)
# ✅ Cannot pass when leading (server)
# ✅ First play must include 3♦ (server)
# ✅ Edge cases (pair with 3♦, 5-card combo with 3♦)
```

---

## Manual Testing

### Test Case 1: Cannot Pass When Leading

**Steps:**
1. Create a new multiplayer game room
2. Start game with 4 players (1 human + 3 bots recommended)
3. First player (has 3♦) attempts to pass
4. **Expected:** Error message "Cannot pass when leading - you must play cards"
5. First player plays a valid card (e.g., 3♦ alone)
6. Second player now attempts to pass
7. **Expected:** Pass succeeds (someone has played)

**How to Test:**
```typescript
// In your game room
// Player 0's turn (they have 3♦)
try {
  await pass(); // Should fail
} catch (error) {
  console.log(error.message); // "Cannot pass when leading - you must play cards"
}

// Play valid card
await playCards([{ id: '3D', rank: '3', suit: 'D' }]);

// Now player 1 can pass
await pass(); // Should succeed
```

### Test Case 2: First Play Must Include 3♦

**Steps:**
1. Create a new multiplayer game room
2. Start game with 4 players
3. First player (has 3♦) attempts to play 4♣ without 3♦
4. **Expected:** Error message "First play must include 3♦ (three of diamonds)"
5. First player plays 3♦ (alone or in a combo)
6. **Expected:** Play succeeds

**How to Test:**
```typescript
// Player 0's turn (they have 3♦ and 4♣)
try {
  await playCards([{ id: '4C', rank: '4', suit: 'C' }]); // Should fail
} catch (error) {
  console.log(error.message); // "First play must include 3♦"
}

// Play valid first play
await playCards([{ id: '3D', rank: '3', suit: 'D' }]); // Should succeed
```

### Test Case 3: First Play with 3♦ in Combo

**Steps:**
1. Start game where first player has: 3♦, 3♣ (pair)
2. First player plays pair: 3♦ + 3♣
3. **Expected:** Play succeeds (3♦ included in combo)

**Steps (5-card combo):**
1. Start game where first player has: 3♦, 4♣, 5♥, 6♠, 7♦ (straight)
2. First player plays straight containing 3♦
3. **Expected:** Play succeeds

---

## Regression Testing

### Run Existing Test Suites

```bash
# Run all tests to ensure no regressions
npm test -- --no-coverage

# Expected results:
# ✅ Game Logic: 49/49 passing
# ✅ Bot AI: 16/16 passing
# ✅ State Manager: 46/46 passing
# ✅ Critical Rules: 8/8 passing (NEW)
# ✅ Total: 119+ tests passing
```

### Known Tests That Should Still Pass

1. **One Card Left Rule** - Already implemented, should not regress
2. **Bot AI** - Bots already handle first play correctly
3. **Local Game Engine** - Already validates both rules correctly
4. **Multiplayer Turn Management** - Turn order should not be affected

---

## Troubleshooting

### Test Fails: "Room not found"

**Cause:** Database connection or test setup issue

**Fix:**
```bash
# Verify Supabase connection
echo $EXPO_PUBLIC_SUPABASE_URL
echo $EXPO_PUBLIC_SUPABASE_ANON_KEY

# Make sure .env file exists
ls -la apps/mobile/.env
```

### Test Fails: "Migration not applied"

**Cause:** SQL migration not deployed

**Fix:**
```bash
# Re-apply migration
cd apps/mobile
npx supabase db push

# Or apply manually via Supabase dashboard
```

### Test Timeout

**Cause:** Slow network or database operations

**Fix:**
```typescript
// Increase jest timeout in test file
jest.setTimeout(30000); // 30 seconds
```

---

## Performance Testing

### Check Server Response Times

```bash
# Run critical rules tests with timing
npm test -- critical-rules.test.ts --verbose

# Look for timing info:
# ✅ execute_pass_move: < 200ms
# ✅ execute_play_move: < 300ms
```

### Load Testing (Optional)

```bash
# Use k6 or similar tool to test concurrent games
k6 run load-test.js

# Monitor:
# - Response times
# - Error rates
# - Database locks (should not occur)
```

---

## CI/CD Integration

### Add to GitHub Actions

```yaml
# .github/workflows/test.yml
name: Test Suite

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: cd apps/mobile && npm install
      
      - name: Run unit tests
        run: cd apps/mobile && npm test -- --no-coverage
      
      - name: Run critical rules tests
        run: cd apps/mobile && npm test -- critical-rules.test.ts
```

---

## Deployment Checklist

- [ ] ✅ All unit tests passing
- [ ] ✅ Critical rules tests passing
- [ ] ✅ Manual testing completed
- [ ] ✅ Migration applied to staging
- [ ] ✅ Smoke tests on staging passed
- [ ] 🔄 Deploy migration to production
- [ ] 🔄 Run smoke tests on production
- [ ] 🔄 Monitor logs for 24 hours
- [ ] 🔄 Update documentation

---

## Monitoring After Deploy

### Check Logs for Rule Violations

```sql
-- Query logs for rule violation attempts
SELECT 
  player_id,
  error_message,
  COUNT(*) as attempts,
  MAX(timestamp) as last_attempt
FROM game_logs
WHERE 
  error_message LIKE '%Cannot pass when leading%'
  OR error_message LIKE '%First play must include 3%'
GROUP BY player_id, error_message
ORDER BY attempts DESC;
```

### Alert on High Error Rates

```typescript
// Set up monitoring alert
if (ruleViolationRate > 5% of total moves) {
  sendAlert('High rule violation rate detected');
}
```

---

## Rollback Plan

If issues occur after deployment:

```sql
-- OPTION 1: Restore old function versions
-- Copy functions from: 20251227000002_add_game_move_rpcs.sql

-- OPTION 2: Disable validation temporarily
CREATE OR REPLACE FUNCTION execute_pass_move(...)
RETURNS JSON AS $$
BEGIN
  -- Comment out validation:
  -- IF v_game_state.last_play IS NULL THEN
  --   RETURN json_build_object('success', false, ...);
  -- END IF;
  ...
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## Support

For issues or questions:
- Engineering Team: [Your Team]
- On-call: [Contact Info]
- Documentation: [Link to docs]
