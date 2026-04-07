# One Card Left Rule - Debugging Guide

**Issue Reported:** User claims they were able to pass when they shouldn't have been able to.

---

## 🔍 How to Reproduce & Debug

### Expected Behavior

When **ALL THREE** conditions are met:
1. ✅ Last play was a **single card**
2. ✅ **Next player** (in turn order) has **exactly 1 card**
3. ✅ Current player has a **valid single** that beats the last play

**Then:** Current player **CANNOT PASS** and **MUST play their highest beating single**.

### How to Test

1. **Start a game** with at least 2 players
2. **Play until** one player has exactly 1 card remaining
3. **Have another player play a single** card
4. **Try to pass** as the player immediately before the 1-card player
5. **Expected result:** You should see an alert: "Cannot Pass" with message explaining the rule

### Debug Logs

The game now includes detailed console logging for the One Card Left rule. When you try to pass, look for these logs:

```
[OneCardLeft] Checking pass validation: {
  currentPlayer: "Player 1",
  nextPlayer: "Bot 1",          ← This is who we're checking
  nextPlayerCardCount: 1,       ← Should be 1 for rule to apply
  lastPlayType: "single",       ← Should be "single" for rule to apply
  lastPlayCards: 1
}

[OneCardLeft] Pass validation result: {
  canPass: false,
  error: "Cannot pass when Bot 1 (next player) has 1 card left..."
}

[OneCardLeft] Blocking pass with error: "Cannot pass when Bot 1 (next player) has 1 card left and you have a valid single (must play K♠)"
```

---

## 🎯 Understanding "Next Player"

**CRITICAL:** "Next player" means **the player who will play after you in turn order**, NOT necessarily the player sitting to your right visually.

### Example with 4 Players:
```
Turn Order: Player 1 → Bot 1 → Bot 2 → Bot 3 → (back to Player 1)
           You're here ↑      ↑ Next player is Bot 1
```

If **Bot 1** has 1 card, then:
- ✅ **Player 1 (you)** must play highest single (Bot 1 is next after you)
- ❌ Bot 2 can pass normally (Bot 3 is next, not Bot 1)
- ❌ Bot 3 can pass normally (Player 1 is next, not Bot 1)

---

## 🧪 Test Scenarios

### Scenario 1: Rule Should Block Pass ✅
```
Current Player: Player 1
Current Hand: [5♥, 7♦, K♠]
Last Play: 4♠ (single)
Next Player: Bot 1 (1 card)

Action: Try to pass
Expected: ❌ BLOCKED - "Cannot pass when Bot 1 (next player) has 1 card left and you have a valid single (must play K♠)"
```

### Scenario 2: Rule Should Allow Pass (Not a Single) ✅
```
Current Player: Player 1
Current Hand: [5♥, 7♦, K♠]
Last Play: 4♠4♥ (pair)          ← Not a single!
Next Player: Bot 1 (1 card)

Action: Try to pass
Expected: ✅ ALLOWED - Rule only applies to singles
```

### Scenario 3: Rule Should Allow Pass (Next Player Has >1 Card) ✅
```
Current Player: Player 1
Current Hand: [5♥, 7♦, K♠]
Last Play: 4♠ (single)
Next Player: Bot 1 (3 cards)     ← Not 1 card!

Action: Try to pass
Expected: ✅ ALLOWED - Rule only applies when next player has exactly 1 card
```

### Scenario 4: Rule Should Allow Pass (No Valid Singles) ✅
```
Current Player: Player 1
Current Hand: [3♥, 3♦, 3♠]       ← All lower than last play!
Last Play: K♠ (single)
Next Player: Bot 1 (1 card)

Action: Try to pass
Expected: ✅ ALLOWED - Player has no valid singles to play
```

---

## 🔧 Troubleshooting

### "I was able to pass when I shouldn't have been"

**Check these things:**

1. **Was the last play a single?**
   - Look at the console logs: `lastPlayType: "single"`
   - If it says "pair", "triple", etc., the rule doesn't apply

2. **Did the NEXT player (in turn order) have exactly 1 card?**
   - Look at the console logs: `nextPlayer: "Bot X", nextPlayerCardCount: 1`
   - Make sure you're looking at the correct "next player" (see diagram above)
   - The next player is NOT necessarily the one visually to your right

3. **Did you have a valid single that could beat the last play?**
   - Look at the console logs for the validation result
   - If you had no beating singles, passing is allowed

4. **Was the game state synced correctly?**
   - In multiplayer, there might be a sync delay
   - Check if the player's card count was updated correctly

### "The error message is confusing"

The error message now includes the next player's name:
```
"Cannot pass when Bot 1 (next player) has 1 card left and you have a valid single (must play K♠)"
                 ^^^^^ This tells you WHO you're protecting against
                                                                  ^^^ This tells you WHAT you must play
```

---

## 📝 Implementation Details

### Files Involved

1. **`game-logic.ts`** - Pure validation functions:
   - `findHighestBeatingSingle()` - Finds highest card that beats last play
   - `validateOneCardLeftRule()` - Validates if a play follows the rule
   - `canPassWithOneCardLeftRule()` - Checks if passing is allowed

2. **`state.ts`** - Game state manager:
   - `pass()` method calls `canPassWithOneCardLeftRule()` before allowing pass
   - `validatePlay()` method calls `validateOneCardLeftRule()` before allowing plays
   - Enhanced with debug logging and clearer error messages

3. **`GameScreen.tsx`** - UI:
   - Shows Alert when `pass()` returns `{ success: false, error: "..." }`

### Code Flow
```
User clicks "Pass" button
    ↓
GameScreen.handlePass()
    ↓
GameStateManager.pass()
    ↓
Calculate nextPlayerIndex = (currentPlayerIndex + 1) % players.length
    ↓
Get nextPlayer.hand.length
    ↓
Call canPassWithOneCardLeftRule()
    ↓
If rule applies → findHighestBeatingSingle()
    ↓
If has beating single → return { canPass: false, error: "..." }
    ↓
GameScreen shows Alert with error
```

---

## ✅ Verification Checklist

When testing the One Card Left rule:

- [ ] Console logs show correct next player identification
- [ ] Console logs show correct card count for next player
- [ ] Console logs show correct last play type (single/pair/etc.)
- [ ] Alert appears when trying to pass (if rule applies)
- [ ] Alert message names the correct next player
- [ ] Alert message shows which card must be played
- [ ] Passing is allowed when last play is NOT a single
- [ ] Passing is allowed when next player has MORE than 1 card
- [ ] Passing is allowed when player has NO valid beating singles
- [ ] All 49 game logic tests pass

---

## 🚀 Next Steps

If the issue persists:

1. **Capture console logs** - Send the `[OneCardLeft]` log output
2. **Take screenshot** - Show the game state when the issue occurs
3. **Note the turn order** - Which player is "next" after you?
4. **Check card counts** - How many cards does each player have?
5. **Verify last play** - Was it a single, pair, or something else?

This information will help identify if:
- There's a bug in the calculation
- There's a misunderstanding about "next player"
- There's a state sync issue in multiplayer
- There's a UI/UX issue with displaying player order

---

**Last Updated:** December 11, 2025  
**Status:** Enhanced with debug logging and clearer error messages
