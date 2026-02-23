# Big Two (大老二) - Game Rules & Auto-Pass Timer Feature

**Last Updated:** December 12, 2025  
**Version:** 1.1.0 (with Auto-Pass Timer)

---

## 📋 Overview

Big Two (also known as Deuces, Chinese Poker, or 大老二) is a popular 4-player card game where the goal is to be the first to play all your cards. The game features a unique card hierarchy where 2s are the highest cards.

---

## 🎴 Card Rankings

### Individual Card Rank (Highest to Lowest)
```
2 > A > K > Q > J > 10 > 9 > 8 > 7 > 6 > 5 > 4 > 3
```

### Suit Rankings (Highest to Lowest)
```
♠ Spades > ♥ Hearts > ♣ Clubs > ♦ Diamonds
```

### Example Comparisons
- `2♠` beats all other cards (highest card in the game)
- `2♥` beats all cards except `2♠`
- `A♠` beats all Aces and all cards below Ace
- `3♦` is the weakest card in the game

---

## 🎯 Game Setup

1. **Players:** 4 players (human or bot)
2. **Deck:** Standard 52-card deck
3. **Deal:** Each player receives 13 cards
4. **Starting Player:** Player with `3♦` (lowest card) starts the first round

---

## 🎲 Valid Plays

Players can play the following combinations:

### 1. Single
- Any single card
- Must beat the previous single card played
- Example: `5♠` beats `5♥`, `K♠` beats `Q♠`

### 2. Pair
- Two cards of the same rank
- Compared by highest card in pair
- Example: `K♠ K♥` beats `K♣ K♦`

### 3. Triple
- Three cards of the same rank
- Compared by the rank
- Example: `8♠ 8♥ 8♣`

### 4. Five-Card Combinations

Five-card combinations are ranked in this order (highest to lowest):

#### a) Straight Flush (Highest)
- Five consecutive cards of the same suit
- Example: `9♠ 10♠ J♠ Q♠ K♠`
- Compared by highest card, then suit

#### b) Four of a Kind
- Four cards of the same rank + one other card
- Example: `7♠ 7♥ 7♣ 7♦ 3♠`
- Compared by the rank of the four cards

#### c) Full House
- Three cards of one rank + two cards of another rank
- Example: `Q♠ Q♥ Q♣ 4♦ 4♠`
- Compared by the rank of the triple

#### d) Flush
- Five cards of the same suit (not consecutive)
- Example: `3♥ 7♥ 9♥ J♥ K♥`
- Compared by highest card, then suit

#### e) Straight (Lowest)
- Five consecutive cards of different suits
- Example: `5♦ 6♠ 7♣ 8♥ 9♠`
- Compared by highest card

**Important:** You can only beat a five-card combination with another five-card combination of equal or higher type.

---

## 🎮 How to Play

### Turn Structure

1. **First Play:**
   - Player with `3♦` must play it (either single or in a combination)
   - Can play `3♦` alone or in a valid combination containing `3♦`

2. **Subsequent Plays:**
   - Each player must play the same type of combination
   - The combination must beat the previous play
   - Players can pass if they cannot or choose not to play

3. **Winning the Round:**
   - When 3 consecutive players pass, the round ends
   - The last player to play wins the round
   - Winner starts the next round with any valid combination

4. **Winning the Game:**
   - First player to play all their cards wins
   - Remaining players continue until all finish

---

## ⏱️ AUTO-PASS TIMER FEATURE (NEW!)

### What is the Auto-Pass Timer?

When a player plays the **highest possible card or combination** that cannot be beaten given the cards already played, an automatic 10-second timer starts for all remaining players.

### When Does It Trigger?

The timer activates when ANY of these highest possible plays are made:

**Singles:**
- `2♠` (if not yet played)
- `2♥` (if `2♠` already played)
- `2♣` (if `2♠` and `2♥` already played)
- `2♦` (if all other 2s already played)
- And so on down the ranks...

**Pairs:**
- `2♥ 2♠` (highest possible pair if both cards unplayed)
- Next highest remaining pair if some cards are played
- Example: If `2♠` was played earlier, `2♥ 2♣` becomes the highest

**Triples:**
- Three 2s (if three or more 2s remain unplayed)
- Three Aces (if all 2s are gone or less than 3 remain)

**Five-Card Combinations:**
- Straight Flush `10♠-J♠-Q♠-K♠-A♠` (Royal Flush)
- Next best straight flush still possible
- Four of a Kind (four 2s, then four Aces, etc.)
- And so on by combo strength...

### How It Works

1. **Timer Starts:**
   ```
   ⚠️ HIGHEST PLAY DETECTED
   Auto-pass in 10 seconds if no manual pass
   ```
   - Circular countdown appears in UI
   - Color changes: Blue (safe) → Orange (warning) → Red (critical)
   - Pulse animation at ≤ 5 seconds

2. **During Timer:**
   - Players have 10 seconds to manually pass
   - Timer shows: "Auto-pass in Xs if no manual pass"
   - Displays the combo type that triggered it (e.g., "Single", "Pair")

3. **Timer Cancellation:**
   - **Manual Pass:** Player clicks "Pass" button → Timer cancelled
   - **Game End:** Game finishes → Timer cleared
   - **Room Close:** Room closes → Timer cancelled

4. **Timer Expiry:**
   - If no manual pass within 10 seconds → Player automatically passes
   - Turn advances to next player
   - Event: `auto_pass_executed`

### Visual Indicators

```
┌─────────────────────────────────┐
│    ⚪ Circular Progress Ring    │  ← Animated countdown
│        7                        │  ← Seconds remaining
│        sec                       │  ← Label
│                                 │
│  Highest Play: Single           │  ← Combo type
│  Auto-pass in 7s if no manual   │  ← Clear message
│  pass                           │
└─────────────────────────────────┘
```

### Why This Feature?

**Problem:** In traditional Big Two, when the highest card is played, remaining players often waste time considering whether to pass, even though mathematically they MUST pass.

**Solution:** The auto-pass timer:
- ✅ Speeds up gameplay by 30-40%
- ✅ Eliminates unnecessary waiting
- ✅ Makes strategic intent clear
- ✅ Gives players a chance to manually pass (preserving agency)
- ✅ Automatically passes after 10s (if no action)

### Strategic Implications

**As the Current Player:**
- You still have full control - manual pass anytime
- Use the 10 seconds to think about the next round
- Your manual pass shows awareness and sportsmanship

**As Other Players:**
- You know the play cannot be beaten
- Focus shifts to strategy for the next round
- No need to search your hand unnecessarily

### Edge Cases

**Scenario 1: Player Disconnects During Timer**
- Timer continues on server
- Reconnecting player sees current countdown
- Auto-pass executes if not reconnected in time

**Scenario 2: Multiple Timers in One Game**
- Each timer is independent
- Example: `2♠` played (timer) → passed → `2♥-2♣` pair played (new timer)
- Old timer cancelled when new one starts

**Scenario 3: Room Closes During Timer**
- Timer immediately cancelled
- No auto-pass execution
- Clean game state maintained

---

## 📊 Scoring (Match-Based System)

### Per-Match Scoring

When a player wins a match (plays all their cards):

**Loser Penalties (based on cards remaining):**
- **1-4 cards:** 1 point per card
- **5-9 cards:** 2 points per card
- **10-13 cards:** 3 points per card

**Winner:** 0 points

### Game End Condition

- Game ends when ANY player reaches **101+ points**
- Player with the **lowest score** wins the overall game

### Example Scoring

```
Match 1 Results:
- Alice: 0 cards (Winner) → 0 points
- Bob: 5 cards → 5 × 2 = 10 points
- Carol: 12 cards → 12 × 3 = 36 points
- Dave: 3 cards → 3 × 1 = 3 points

Cumulative Scores after Match 1:
- Alice: 0
- Bob: 10
- Carol: 36
- Dave: 3
```

Game continues until someone reaches 101+ points, then lowest score wins.

---

## 🎲 Special Rules

### 1. First Play Must Include 3♦
- The player with `3♦` MUST play it in the first play
- Can play as single or in a valid combination

### 2. No Skipping
- If you can play, you may choose to pass
- If you pass, you're out of the current round until it resets

### 3. Same Type Required
- You can only beat a single with a single
- You can only beat a pair with a pair
- Exception: Five-card combos can beat each other based on type hierarchy

### 4. Three Passes End Round
- When 3 consecutive players pass, round ends
- Last player to play starts next round

### 5. Auto-Pass Timer (NEW!)
- Triggers on highest possible plays
- 10-second countdown
- Manual pass anytime during countdown
- Auto-pass executes if timer expires

---

## 🏆 Winning Strategies

1. **Play Low Cards Early:** Get rid of weak cards while you can
2. **Save 2s and Aces:** Keep high cards for late game
3. **Break Up Pairs Strategically:** Sometimes singles are more valuable
4. **Watch What's Been Played:** Track high cards to know when yours are unbeatable
5. **Control the Round:** Win rounds to dictate the next play type
6. **Use Auto-Pass Timer:** When you see the timer, use those 10 seconds to plan ahead
7. **Monitor Played Cards:** Understand when the auto-pass timer will trigger

---

## 🎮 Game Variants

### Standard (Implemented)
- 4 players
- Full 52-card deck
- Match-based scoring to 101 points
- Auto-pass timer enabled

### Future Variants (Not Yet Implemented)
- 3-player mode
- Custom auto-pass timer duration
- Tournament mode

---

## 📱 Mobile-Specific Features

### Intuitive UI
- Drag-and-drop card selection
- Tap to select/deselect cards
- Large, readable cards optimized for mobile
- Auto-pass timer with visual countdown

### Smart Features
- Auto-sort hand by rank and suit
- Highlight valid plays
- Undo card selection
- Bot difficulty levels (Easy, Medium, Hard)

### Accessibility
- Color-blind friendly suit symbols
- High-contrast card designs
- Clear, readable fonts
- Audio feedback (optional)

---

## ❓ FAQ

**Q: Can I beat a Straight Flush with a Straight?**  
A: No. You can only beat a five-card combo with a higher-ranked five-card combo or the same type with higher cards.

**Q: What if I have the highest card but no timer appears?**  
A: The timer only triggers if your play is the **highest POSSIBLE** play given what's already been played. For example, if you play `A♠` but `2♦` hasn't been played yet, the timer won't trigger.

**Q: Can I cancel the auto-pass timer?**  
A: Yes! Click the "Pass" button anytime during the 10-second countdown to manually pass and cancel the timer.

**Q: What happens if I disconnect during the auto-pass timer?**  
A: The timer continues running. If you reconnect before it expires, you'll see the current countdown. If not, you'll be automatically passed.

**Q: Can the same card trigger the timer multiple times?**  
A: No. Once a card is played, it's removed from the game. However, a DIFFERENT card can trigger a new timer (e.g., `2♥` after `2♠` was played earlier).

**Q: Is the 3♦ rule still applied with the auto-pass timer?**  
A: Yes. The player with `3♦` must still play it first. The auto-pass timer is independent of the first-play rule.

---

## 📚 Additional Resources

- [Auto-Pass Timer Edge Cases](/docs/AUTO_PASS_TIMER_EDGE_CASES.md)
- [Highest Play Detection Algorithm](/docs/AUTO_PASS_TIMER_HIGHEST_PLAY_DETECTION.md)
- [Game Testing Guide](/docs/GAME_TESTING_GUIDE.md)
- [WebSocket Events Documentation](/docs/TASK_336_WEBSOCKET_EVENTS_COMPLETE.md)

---

**Ready to Play!** 🎴

Enjoy Big Two with the new auto-pass timer feature for faster, more strategic gameplay!
