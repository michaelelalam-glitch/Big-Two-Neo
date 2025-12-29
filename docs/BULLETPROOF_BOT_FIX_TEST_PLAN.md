# BULLETPROOF Bot Fix - Test Plan

## Prerequisites
- **Clear app cache:** Shake device → Reload  
- **Fresh start:** Close and restart the app completely
- **Console logs visible:** Make sure dev tools are open

## Test 1: Verify Data Ready Flag Works

**Steps:**
1. Start a new casual game (Quick Play with 3 bots)
2. Watch console logs immediately after game starts

**Expected Console Logs:**
```
[GameScreen] 🎯 BULLETPROOF Data Ready Check: {
  isMultiplayerDataReady: false,    ← Should start FALSE
  isMultiplayerHost: false,          ← Should start FALSE  
  playersCount: 0,                   ← Should start 0
  hasGameState: false,               ← Should start FALSE
  hasHands: false,                   ← Should start FALSE
  handsCount: 0,                     ← Should start 0
  willEnableBot: false               ← Should start FALSE
}

... (data loading) ...

[GameScreen] 🎯 BULLETPROOF Data Ready Check: {
  isMultiplayerDataReady: true,     ← Should become TRUE ✅
  isMultiplayerHost: true,           ← Should become TRUE ✅
  playersCount: 4,                   ← Should become 4 ✅
  hasGameState: true,                ← Should become TRUE ✅
  hasHands: true,                    ← Should become TRUE ✅
  handsCount: 4,                     ← Should become 4 ✅
  willEnableBot: true                ← Should become TRUE ✅
}
```

**Success Criteria:**
- ✅ `isMultiplayerDataReady` transitions from `false` → `true`
- ✅ All values become truthy/populated
- ✅ `willEnableBot` becomes `true`

## Test 2: Verify Bot Coordinator Executes

**Steps:**
1. Continue watching logs after data ready
2. Look for bot coordinator logs

**Expected Console Logs:**
```
[BotCoordinator] useEffect triggered {
  roomCode: '6Z3LMU',
  isCoordinator: true,              ← Should be TRUE ✅
  playerCount: 4,
  hasGameState: true
}

[BotCoordinator] 🤖 Executing bot turn {
  currentPlayerIndex: 2,            ← Or whichever bot starts
  playerCount: 4,
  currentPlayer: {
    is_bot: true,
    player_index: 2,
    player_name: 'Janice Eaton',
    cards_length: 13
  }
}
```

**Success Criteria:**
- ✅ `[BotCoordinator] useEffect triggered` appears
- ✅ `isCoordinator: true` is logged
- ✅ `[BotCoordinator] 🤖 Executing bot turn` appears
- ✅ Bot player data is populated (has cards, name, etc.)

## Test 3: Verify Bots Actually Play Cards

**Steps:**
1. Watch the game screen
2. Wait ~500ms after game starts

**Expected Behavior:**
- ✅ First bot's turn starts automatically
- ✅ Bot plays cards within ~500ms
- ✅ Cards disappear from bot's hand
- ✅ Cards appear in center play area
- ✅ Turn advances to next player
- ✅ If next is bot, they play immediately
- ✅ If next is human, "Your Turn" indicator appears

**Console Logs:**
```
[BotCoordinator] 🎯 Bot will play: [
  { rank: '3', suit: 'D', id: '3D' }
]

[useRealtime] 📤 Broadcasting cards_played event: {
  player_index: 2,
  cards: [{ rank: '3', suit: 'D', id: '3D' }],
  combo_type: 'Single'
}

[GameScreen] ✅ Cards played successfully
```

**Success Criteria:**
- ✅ Bot actually plays cards (visible in UI)
- ✅ Game state updates (turn advances)
- ✅ Next player can take their turn
- ✅ No freezing or errors

## Test 4: Full Game Flow

**Steps:**
1. Play through an entire game
2. Let bots play automatically
3. Play your turn when it comes
4. Continue until someone runs out of cards

**Expected Behavior:**
- ✅ Bots play all their turns automatically
- ✅ No getting "stuck" on bot turns
- ✅ Game progresses smoothly
- ✅ Match ends when someone wins (runs out of cards)
- ✅ Scores are calculated correctly
- ✅ "Next Match" button appears
- ✅ Can start a new match

## Test 5: Multiple Matches to Game Over

**Steps:**
1. Play multiple matches until someone reaches >= 101 points
2. Verify game-over modal appears

**Expected Behavior:**
- ✅ Cumulative scores track across matches
- ✅ When any player hits >= 101 points, game ends
- ✅ Game-over modal shows with final scores
- ✅ Winner is player with LOWEST cumulative score

## Failure Scenarios to Watch For

### ❌ Scenario 1: Data Never Becomes Ready
**Symptoms:**
- `isMultiplayerDataReady` stays `false`
- `hasGameState` stays `false`
- `hasHands` stays `false`

**What to check:**
- Is Supabase connection working?
- Check network tab for failed requests
- Look for `fetchGameState` errors

### ❌ Scenario 2: Bot Coordinator Never Runs
**Symptoms:**
- No `[BotCoordinator] useEffect triggered` log
- `isCoordinator` stays `false`

**What to check:**
- Is `isMultiplayerHost` true?
- Is `playersWithCards.length > 0`?
- Check the full BULLETPROOF data ready log

### ❌ Scenario 3: Bots Don't Play Despite Coordinator Running
**Symptoms:**
- Bot coordinator logs appear
- But no `🤖 Executing bot turn` logs
- Or logs appear but cards don't play

**What to check:**
- Check for errors in bot AI logic
- Verify `currentPlayer?.is_bot` is true
- Check if bot has valid cards to play

## Recovery Steps if Test Fails

1. **Clear cache again:** Shake → Reload
2. **Check console for specific error messages**
3. **Copy ALL console logs** (especially around game start)
4. **Take screenshots** of:
   - Console logs showing the error
   - Game screen state when frozen
   - BULLETPROOF data ready logs
5. **Report back with:**
   - Which test failed
   - Exact console logs
   - Screenshots
   - Description of what you saw vs expected

## Success Definition

The fix is SUCCESSFUL if:
- ✅ All 5 tests pass
- ✅ Bots play automatically every turn
- ✅ No freezing or getting stuck
- ✅ Can play complete games through to match end
- ✅ Can play multiple matches to game-over
- ✅ All console logs show expected values

If ANY test fails, we need to debug further with the specific error logs.
