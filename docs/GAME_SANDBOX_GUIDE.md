# Game Sandbox — Beginner's Guide

> A step-by-step guide to testing every Big Two edge case using the Game Sandbox.  
> No prior testing experience required.

---

## Table of Contents

1. [What is the Game Sandbox?](#what-is-the-game-sandbox)
2. [Quick Start (Your First Test)](#quick-start-your-first-test)
3. [Running the Tests](#running-the-tests)
4. [Core Concepts](#core-concepts)
5. [Creating a Game](#creating-a-game)
6. [Setting Up Custom Hands](#setting-up-custom-hands)
7. [Playing Cards](#playing-cards)
8. [Passing Turns](#passing-turns)
9. [Testing Bot AI](#testing-bot-ai)
10. [Testing Combos](#testing-combos)
11. [Testing Beat Play Logic](#testing-beat-play-logic)
12. [Testing Scoring](#testing-scoring)
13. [Running Full Game Simulations](#running-full-game-simulations)
14. [Multi-Game Stress Testing](#multi-game-stress-testing)
15. [Edge Cases You Should Test](#edge-cases-you-should-test)
16. [All Available Methods (Cheat Sheet)](#all-available-methods-cheat-sheet)
17. [Troubleshooting](#troubleshooting)

---

## What is the Game Sandbox?

The Game Sandbox is a testing tool that gives you **full control** over a Big Two card game. Think of it as a "cheat mode" for testing — you can:

- **Set exact cards** for each player (instead of random deals)
- **Force specific game states** (whose turn, what's on the table, scores)
- **Run bot players** at any difficulty
- **Simulate 20+ games at once** for stress testing
- **Validate every game rule** (3♦ first play, one-card-left rule, combos, etc.)

**File locations:**
- Sandbox code: `apps/mobile/src/__tests__/sandbox/GameSandbox.ts`
- Test file: `apps/mobile/src/__tests__/sandbox/GameSandbox.test.ts`

---

## Quick Start (Your First Test)

Open the test file at `apps/mobile/src/__tests__/sandbox/GameSandbox.test.ts`.

Here's the simplest possible test — it creates a game and checks it started:

```typescript
import { GameSandbox, card, cards } from './GameSandbox';

it('creates a basic game', () => {
  const sb = GameSandbox.create();
  
  // 4 players, each with 13 cards
  expect(sb.state.players).toHaveLength(4);
  expect(sb.state.players[0].hand.length).toBe(13);
  expect(sb.state.gameStarted).toBe(true);
});
```

To add your own test, just add an `it(...)` block inside any `describe(...)` section.

---

## Running the Tests

Open a terminal in the `apps/mobile` directory and run:

```bash
# Run ALL sandbox tests
pnpm jest --testPathPattern="sandbox/GameSandbox" --verbose

# Run a SPECIFIC test by name
pnpm jest --testPathPattern="sandbox/GameSandbox" -t "creates a basic game"

# Run tests in watch mode (re-runs when you save changes)
pnpm jest --testPathPattern="sandbox/GameSandbox" --watch
```

**What you'll see:**
```
 PASS  src/__tests__/sandbox/GameSandbox.test.ts
  GameSandbox: creation
    ✓ creates a 4-player game with dealt hands (5 ms)
    ✓ creates a 2-player game (2 ms)
    ...
  GameSandbox: playCards
    ✓ plays a valid single (3 ms)
    ✓ rejects weaker play against existing trick (2 ms)
    ...

Test Suites: 1 passed, 1 total
Tests:       87 passed, 87 total
```

**If a test fails**, you'll see a red message with what was expected vs. what actually happened.

---

## Core Concepts

### The `card()` and `cards()` helpers

Every card in Big Two has a **rank** and a **suit**:

| Ranks (low → high) | `3` `4` `5` `6` `7` `8` `9` `10` `J` `Q` `K` `A` `2` |
|---|---|
| **Suits (low → high)** | `D` (♦ Diamond) `C` (♣ Club) `H` (♥ Heart) `S` (♠ Spade) |

Cards are written as `rank + suit`:
```typescript
card('3D')     // 3 of Diamonds (lowest card in the game)
card('2S')     // 2 of Spades (highest card in the game)
card('10H')    // 10 of Hearts
card('AS')     // Ace of Spades
card('KD')     // King of Diamonds

// Create multiple cards at once:
cards('3D', '4C', '5H')   // Array of 3 cards
```

### Game State

Every sandbox has a `.state` object that tracks everything:

```typescript
const sb = GameSandbox.create();

sb.state.players               // Array of 4 players
sb.state.currentPlayerIndex    // Whose turn (0-3)
sb.state.lastPlay              // The cards on the table to beat (or null)
sb.state.isFirstPlayOfGame     // Is this the very first play?
sb.state.gameEnded             // Has someone won?
sb.state.winnerId              // Who won? (null if game ongoing)
sb.state.consecutivePasses     // How many players passed in a row
sb.state.roundHistory          // Array of every play/pass in the game
sb.state.played_cards          // All cards that have been played
```

### Players

Each player has:
```typescript
sb.state.players[0].id         // "player-0" (or "bot-0" for bots)
sb.state.players[0].name       // "Player 0"
sb.state.players[0].hand       // Array of Card objects (their current cards)
sb.state.players[0].isBot      // false (human) or true (bot)
sb.state.players[0].passed     // Did they pass this trick?
```

---

## Creating a Game

### Default game (4 players, random cards)
```typescript
const sb = GameSandbox.create();
```

### Custom player count (2, 3, or 4)
```typescript
const sb = GameSandbox.create({ players: 2 });
const sb = GameSandbox.create({ players: 3 });
```

### Custom hands (exact cards you choose)
```typescript
const sb = GameSandbox.create({
  players: 2,
  hands: {
    0: cards('3D', '5D', 'KS', '2S'),    // Player 0 gets these exact cards
    1: cards('4C', '6H', 'AS', '2H'),    // Player 1 gets these exact cards
  },
});
```

### With bot players
```typescript
const sb = GameSandbox.create({
  bots: {
    1: 'easy',     // Player 1 is an easy bot
    2: 'medium',   // Player 2 is a medium bot
    3: 'hard',     // Player 3 is a hard bot
  },
  // Player 0 is human (not listed in bots)
});
```

### With pre-set scores
```typescript
const sb = GameSandbox.create({
  scores: { 'player-0': 95, 'player-1': 100 },
});
```

### Choose who goes first
```typescript
const sb = GameSandbox.create({
  startingPlayerIndex: 2,  // Player 2 starts
});
```

### Disable the 3♦-must-start rule
```typescript
const sb = GameSandbox.create({
  enforceFirstPlayRule: false,  // Any card can start the game
});
```

---

## Setting Up Custom Hands

After creating a game, you can change anyone's hand at any time:

```typescript
const sb = GameSandbox.create();

// Give Player 0 exactly these 3 cards
sb.setHand(0, cards('3D', 'KS', '2S'));

// Or use the player ID string
sb.setHand('player-0', cards('3D', 'KS', '2S'));

// Check what they have
console.log(sb.state.players[0].hand);
// → [{ id: '3D', rank: '3', suit: 'D' }, ...]
```

---

## Playing Cards

### Basic play
```typescript
const sb = GameSandbox.create({
  startingPlayerIndex: 0,
  hands: { 0: cards('3D', '4D', '5D') },
});

const result = sb.playCards(0, cards('3D'));
// result = { success: true, comboType: 'Single' }
```

### What happens when you play:
1. Cards are **removed** from the player's hand
2. Turn advances to the **next player**
3. The played cards become the new **lastPlay** (trick to beat)
4. If the hand is **empty**, that player wins

### Handling failures
```typescript
// Wrong turn
const r1 = sb.playCards(1, cards('4D'));
// r1 = { success: false, error: 'Not your turn' }

// Invalid combo
const r2 = sb.playCards(0, cards('3D', '7S'));
// r2 = { success: false, error: 'Invalid card combination' }

// Can't beat the current trick
const r3 = sb.playCards(0, cards('3D'));
// (when table has King) → { success: false, error: 'Cannot beat the current play' }

// First play must include 3♦
const r4 = sb.playCards(0, cards('5D'));
// r4 = { success: false, error: 'First play must include 3♦' }
```

### Valid combo types
| Cards | Combo Type | Example |
|-------|-----------|---------|
| 1 card | Single | `cards('3D')` |
| 2 same-rank | Pair | `cards('3D', '3C')` |
| 3 same-rank | Triple | `cards('3D', '3C', '3H')` |
| 5-card straight | Straight | `cards('3D', '4C', '5H', '6S', '7D')` |
| 5 same-suit | Flush | `cards('3D', '5D', '7D', '9D', 'JD')` |
| 3+2 same-rank | Full House | `cards('3D', '3C', '3H', '4D', '4C')` |
| 4 same-rank + 1 | Four of a Kind | `cards('3D', '3C', '3H', '3S', '4D')` |
| 5-card straight same-suit | Straight Flush | `cards('3D', '4D', '5D', '6D', '7D')` |

---

## Passing Turns

```typescript
const sb = GameSandbox.create({
  players: 3,
  startingPlayerIndex: 0,
  hands: {
    0: cards('KS', '3D', '4D', '5D', '6D', '7D', '8D', '9D', '10D'),
    1: cards('3C', '4C', '5C', '6C', '7C', '8C', '9C', '10C', 'JC'),
    2: cards('3S', '4S', '5S', '6S', '7S', '8S', '9S', '10S', 'JS'),
  },
  enforceFirstPlayRule: false,
});
sb.setIsFirstPlay(false);

// Player 0 plays King of Spades
sb.playCards(0, cards('KS'));

// Player 1 can't beat it, passes
sb.pass(1);     // { success: true }

// Player 2 can't beat it, passes
sb.pass(2);     // { success: true }

// All opponents passed → trick complete!
// Player 0 leads a fresh trick (lastPlay resets to null)
expect(sb.state.currentPlayerIndex).toBe(0);
expect(sb.state.lastPlay).toBeNull();
```

### When you CAN'T pass:
- **You're leading** (no lastPlay) — must play a card
- **One-card-left rule** forces you to play in some situations

---

## Testing Bot AI

Bots come in 3 difficulties: `'easy'`, `'medium'`, `'hard'`.

```typescript
const sb = GameSandbox.create({
  bots: { 0: 'easy', 1: 'medium', 2: 'hard', 3: 'hard' },
});

// Run one bot turn
const result = sb.runBotTurn();
// result = { action: 'play', cards: [...], comboType: 'Single' }
// or      { action: 'pass' }

// Run a complete game (all bots)
let turns = 0;
while (!sb.state.gameEnded && turns < 500) {
  sb.runBotTurn();
  turns++;
}
console.log(`Game ended in ${turns} turns. Winner: ${sb.state.winnerId}`);
```

### Bot fallback behavior:
- If a bot tries to pass but the **one-card-left rule** forbids it, the sandbox automatically plays the bot's highest valid single
- If a bot is **leading** (must play), the sandbox plays the lowest card
- These fallbacks ensure the game always progresses

---

## Testing Combos

Use the built-in `classifyCards` function to check what combo a set of cards makes:

```typescript
import { classifyCards } from '../../game/engine';

classifyCards(cards('3D'))                          // 'Single'
classifyCards(cards('3D', '3C'))                    // 'Pair'
classifyCards(cards('3D', '3C', '3H'))              // 'Triple'
classifyCards(cards('3D', '4C', '5H', '6S', '7D')) // 'Straight'
classifyCards(cards('3D', '5D', '7D', '9D', 'JD')) // 'Flush'
classifyCards(cards('3D', '3C', '3H', '4D', '4C')) // 'Full House'
classifyCards(cards('3D', '3C', '3H', '3S', '4D')) // 'Four of a Kind'
classifyCards(cards('3D', '4D', '5D', '6D', '7D')) // 'Straight Flush'

// Invalid combos return 'unknown'
classifyCards(cards('3D', '5C'))                    // 'unknown' (not a pair)
classifyCards(cards('3D', '4D', '5D', '6D'))        // 'unknown' (4 cards isn't valid)
```

---

## Testing Beat Play Logic

Use `canBeatPlay` to check if one play beats another:

```typescript
import { canBeatPlay } from '../../game/engine';

// Build a "last play" object
const lastPlay = { cards: cards('4D'), combo_type: 'Single' as const };

canBeatPlay(cards('5D'), lastPlay)   // true  — 5 beats 4
canBeatPlay(cards('3D'), lastPlay)   // false — 3 can't beat 4
canBeatPlay(cards('4S'), lastPlay)   // true  — same rank, higher suit

// Or use the sandbox helper:
const sb = GameSandbox.create();
sb.setLastPlay({ cards: cards('KS'), combo_type: 'Single' });
sb.wouldBeatPlay(cards('AS'))   // true — Ace beats King
sb.wouldBeatPlay(cards('QD'))   // false — Queen can't beat King
```

### Combo hierarchy (what beats what):
```
Straight < Flush < Full House < Four of a Kind < Straight Flush
```
A higher-ranking combo of the **same size** beats a lower one. 
A Straight Flush can also beat a Four of a Kind (special rule).

---

## Testing Scoring

```typescript
const sb = GameSandbox.create({
  scores: { 'player-0': 95, 'player-1': 100 },
});

// Read scores
sb.getScore('player-0')   // 95
sb.getScore('player-1')   // 100
sb.getScore('nonexistent') // 0 (unknown players return 0)

// Update scores mid-game
sb.setScores({ 'player-0': 101 });
sb.getScore('player-0')   // 101
```

---

## Running Full Game Simulations

Run a complete game from start to finish with all bots:

```typescript
it('completes a full 4-bot game', () => {
  const sb = GameSandbox.create({
    bots: { 0: 'easy', 1: 'medium', 2: 'hard', 3: 'hard' },
  });

  let turns = 0;
  while (!sb.state.gameEnded && turns < 500) {
    sb.runBotTurn();
    turns++;
  }

  expect(sb.state.gameEnded).toBe(true);
  expect(sb.state.winnerId).toBeTruthy();
  
  // The winner should have 0 cards
  const winner = sb.state.players.find(p => p.id === sb.state.winnerId);
  expect(winner?.hand.length).toBe(0);
  
  console.log(`Game ended in ${turns} turns`);
  console.log(`Winner: ${sb.state.winnerId}`);
  console.log(`History: ${sb.state.roundHistory.length} actions`);
}, 10_000);  // 10 second timeout
```

---

## Multi-Game Stress Testing

Run 20+ games simultaneously to catch rare edge cases:

```typescript
import { MultiGameRunner } from './GameSandbox';

it('runs 25 concurrent games', () => {
  const runner = new MultiGameRunner();
  
  // Create 25 games with all-bot players
  runner.createGames(25, {
    bots: { 0: 'medium', 1: 'medium', 2: 'medium', 3: 'medium' },
  });

  // Run them all to completion
  const results = runner.runAllToCompletion();
  
  // Check every game completed
  for (const [gameId, result] of results) {
    expect(result.winnerId).toBeTruthy();
    console.log(`${gameId}: Winner=${result.winnerId}, Turns=${result.turns}`);
  }

  // Get aggregate statistics
  const stats = runner.getAggregateStats();
  console.log(`Completed: ${stats.completed}/${stats.totalGames}`);
  console.log(`Avg turns: ${stats.avgTurns}`);
  console.log(`Win rates:`, stats.winRates);
  
  runner.clear();
}, 60_000);  // 60 second timeout
```

### Custom per-game configurations:
```typescript
const runner = new MultiGameRunner();
runner.createGames(10, {}, (index) => ({
  // Games 0-4: 4-player easy
  // Games 5-9: 2-player hard
  players: index < 5 ? 4 : 2,
  bots: index < 5
    ? { 0: 'easy', 1: 'easy', 2: 'easy', 3: 'easy' }
    : { 0: 'hard', 1: 'hard' },
}));
```

---

## Edge Cases You Should Test

Here's a checklist of scenarios the sandbox lets you test. Each example below is a complete test you can copy into the test file.

### 1. Player wins with last card
```typescript
it('player wins by playing their only card', () => {
  const sb = GameSandbox.create({
    players: 2,
    hands: { 0: cards('2S'), 1: cards('3D', '4D', '5D') },
    enforceFirstPlayRule: false,
  });
  sb.setIsFirstPlay(false);
  sb.playCards(0, cards('2S'));
  expect(sb.state.gameEnded).toBe(true);
  expect(sb.state.winnerId).toBe('player-0');
});
```

### 2. All opponents pass → trick winner leads fresh
```typescript
it('trick resets when all pass', () => {
  const sb = GameSandbox.create({
    players: 2,
    startingPlayerIndex: 0,
    hands: { 0: cards('KS', '3D'), 1: cards('3C', '4C') },
    enforceFirstPlayRule: false,
  });
  sb.setIsFirstPlay(false);
  sb.playCards(0, cards('KS'));
  sb.pass(1);
  // Player 0 leads fresh trick
  expect(sb.state.currentPlayerIndex).toBe(0);
  expect(sb.state.lastPlay).toBeNull();
});
```

### 3. Skip players with empty hands
```typescript
it('skips eliminated players', () => {
  const sb = GameSandbox.create({
    players: 3,
    startingPlayerIndex: 0,
    hands: { 0: cards('3D', '5D'), 1: [], 2: cards('4D', '6D') },
    enforceFirstPlayRule: false,
  });
  sb.setIsFirstPlay(false);
  sb.playCards(0, cards('3D'));
  expect(sb.state.currentPlayerIndex).toBe(2); // Skipped player 1
});
```

### 4. First play must include 3♦
```typescript
it('rejects first play without 3 of diamonds', () => {
  const sb = GameSandbox.create({
    startingPlayerIndex: 0,
    hands: { 0: cards('3D', '4D', '5D', '6D', '7D', '8D', '9D', '10D', 'JD', 'QD', 'KD', 'AD', '2D') },
  });
  const result = sb.playCards(0, cards('4D'));
  expect(result.success).toBe(false);
  expect(result.error).toContain('3♦');
});
```

### 5. Highest play detection (2♠ is king)
```typescript
it('identifies 2S as the highest single', () => {
  const sb = GameSandbox.create();
  sb.setPlayedCards([]);
  expect(sb.checkHighestPlay(cards('2S'))).toBe(true);
  expect(sb.checkHighestPlay(cards('AS'))).toBe(false);
});
```

### 6. Valid plays query
```typescript
it('shows all valid plays for a hand', () => {
  const sb = GameSandbox.create({
    startingPlayerIndex: 0,
    hands: { 0: cards('3D', '5D', 'AS') },
    enforceFirstPlayRule: false,
  });
  sb.setIsFirstPlay(false);
  sb.setLastPlay({ cards: cards('4D'), combo_type: 'Single' });
  
  const plays = sb.getValidPlays(0);
  const singles = plays.filter(p => p.length === 1);
  // 5D and AS beat 4D, but 3D doesn't
  expect(singles.length).toBe(2);
});
```

### 7. Pair beats pair
```typescript
it('higher pair beats lower pair', () => {
  expect(canBeatPlay(
    cards('5D', '5C'),
    { cards: cards('3D', '3C'), combo_type: 'Pair' }
  )).toBe(true);
});
```

### 8. Straight Flush beats Four of a Kind
```typescript
it('straight flush beats four of a kind', () => {
  const sf = cards('3D', '4D', '5D', '6D', '7D');
  const foak = cards('3D', '3C', '3H', '3S', '4D');
  expect(canBeatPlay(sf, { cards: foak, combo_type: 'Four of a Kind' })).toBe(true);
});
```

### 9. Cards not in hand are rejected
```typescript
it('rejects playing cards you do not have', () => {
  const sb = GameSandbox.create({
    startingPlayerIndex: 0,
    hands: { 0: cards('3D', '4D') },
  });
  const result = sb.playCards(0, cards('KS'));
  expect(result.success).toBe(false);
  expect(result.error).toContain('not in hand');
});
```

### 10. Snapshot for before/after comparison
```typescript
it('snapshot creates an independent copy of state', () => {
  const sb = GameSandbox.create();
  const before = sb.snapshot();
  sb.setHand(0, []);
  expect(before.players[0].hand.length).toBeGreaterThan(0);
  expect(sb.state.players[0].hand.length).toBe(0);
});
```

---

## All Available Methods (Cheat Sheet)

### Creating Games

| Method | What it does |
|--------|-------------|
| `GameSandbox.create()` | New 4-player game with random hands |
| `GameSandbox.create({ players: 2 })` | 2-player game |
| `GameSandbox.create({ hands: { 0: cards(...) } })` | Custom hands |
| `GameSandbox.create({ bots: { 1: 'hard' } })` | Bot players |
| `GameSandbox.create({ scores: { 'player-0': 99 } })` | Pre-set scores |
| `GameSandbox.create({ startingPlayerIndex: 2 })` | Choose who starts |
| `GameSandbox.create({ enforceFirstPlayRule: false })` | Disable 3♦ rule |

### Changing State

| Method | What it does |
|--------|-------------|
| `sb.setHand(0, cards(...))` | Replace a player's hand |
| `sb.setScores({ 'player-0': 50 })` | Update cumulative scores |
| `sb.setCurrentPlayer(2)` | Change whose turn it is |
| `sb.setLastPlay({ cards: cards('KS'), combo_type: 'Single' })` | Set the trick to beat |
| `sb.setLastPlay(null)` | Clear the trick (new round) |
| `sb.setIsFirstPlay(false)` | Toggle first-play flag |
| `sb.setPlayedCards(cards('3D', '4D'))` | Set played card history |
| `sb.resetPasses()` | Clear all pass flags |

### Game Actions

| Method | Returns | What it does |
|--------|---------|-------------|
| `sb.playCards(0, cards('3D'))` | `{ success, error?, comboType? }` | Play cards for a player |
| `sb.pass(0)` | `{ success, error? }` | Pass for a player |
| `sb.runBotTurn()` | `{ action, cards?, comboType? }` | Run one bot's turn |
| `sb.forcePlayLowestPublic(0)` | `void` | Force play lowest card (bypasses rules) |

### Queries

| Method | Returns | What it does |
|--------|---------|-------------|
| `sb.currentPlayer()` | `Player` | Get the current player |
| `sb.getPlayer(0)` | `Player` | Get player by index or id |
| `sb.getValidPlays(0)` | `Card[][]` | All valid plays for a player |
| `sb.wouldBeatPlay(cards('AS'))` | `boolean` | Would these cards beat the current trick? |
| `sb.checkHighestPlay(cards('2S'))` | `boolean` | Is this the highest possible play? |
| `sb.getScore('player-0')` | `number` | Get cumulative score |
| `sb.snapshot()` | `GameState` | Deep copy of current state |

### Card Helpers

| Function | What it does |
|----------|-------------|
| `card('3D')` | Create one card |
| `cards('3D', '4C', '5H')` | Create array of cards |
| `fullDeck()` | Get all 52 cards |
| `dealCards(4)` | Deal random hands to N players |
| `sortHand(cards(...))` | Sort cards by rank then suit |
| `classifyCards(cards(...))` | Get combo type ('Single', 'Pair', etc.) |
| `canBeatPlay(cards, lastPlay)` | Can these cards beat that play? |

### Multi-Game Runner

| Method | What it does |
|--------|-------------|
| `runner.createGames(20, config)` | Create N games |
| `runner.createGames(10, base, (i) => overrides)` | Per-game configs |
| `runner.getGame('game-0')` | Access a specific game |
| `runner.runAllToCompletion()` | Run all games until someone wins |
| `runner.getAggregateStats()` | Win rates, avg turns, completion count |
| `runner.getAllGames()` | Get all game instances |
| `runner.clear()` | Destroy all games |

---

## Troubleshooting

### "Invalid card id: XY"
You used an invalid card code. Valid format: `{rank}{suit}` where rank is `3-10`, `J`, `Q`, `K`, `A`, or `2`, and suit is `D`, `C`, `H`, or `S`.

### "Not your turn"
You're trying to play or pass for a player who isn't the current player. Check `sb.state.currentPlayerIndex` or use `sb.setCurrentPlayer(n)` to force it.

### "Cannot pass when leading"
You can't pass when there's no trick to beat (nobody played yet this round). You must play a card.

### "First play must include 3♦"
The first play of the game requires the 3 of Diamonds. Either include it in your play or use `enforceFirstPlayRule: false`.

### "Player X is not a bot"
You called `runBotTurn()` but the current player is human. Either set up bots in the config or play manually with `playCards()`.

### Tests timing out
Full game simulations and multi-game runners can take a few seconds. Make sure you have a timeout set:
```typescript
it('my test', () => {
  // test code
}, 10_000);  // 10 second timeout
```

### "players must be 2-4"
Big Two supports 2, 3, or 4 players only.

---

## Next Steps

1. **Start small**: Copy one of the edge case tests, modify it, run it
2. **Break things**: Give a player impossible hands, play cards out of turn, pass when you shouldn't — see what errors you get
3. **Run simulations**: Use the `MultiGameRunner` with different difficulties to compare bot behavior
4. **Add your own tests**: Found a bug in the game logic? Set up the exact state that triggers it and write a test!

Happy testing! 🃏
