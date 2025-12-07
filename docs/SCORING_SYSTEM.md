# Big Two Scoring System

**Last Updated:** December 7, 2025

## Match Scoring Rules

### When a Match Ends
A match ends when **one player finishes all cards in their hand** (plays their last card).

### Points Calculation
The winner receives **0 points**. All other players receive points based on the number of cards remaining in their hand:

| Cards Remaining | Points per Card | Example Calculation |
|----------------|----------------|---------------------|
| 1-4 cards      | **1 point**    | 3 cards = 3 × 1 = **3 points** |
| 5-9 cards      | **2 points**   | 7 cards = 7 × 2 = **14 points** |
| 10-13 cards    | **3 points**   | 11 cards = 11 × 3 = **33 points** |
| 0 cards (winner)| **0 points**  | 0 cards = **0 points** |

### Important Notes
- **NO MULTIPLIERS**: Unlike some variants, there are no score doublings for unused 2s, four-of-a-kinds, or straight flushes
- **EXACT RULES**: These scoring rules must be followed with **zero exceptions**

## Game End Condition

### When the Game Ends
The entire game ends when **any player's cumulative score reaches 101 points or more**.

### Determining the Winner
When the game ends, **the player with the LOWEST total score wins the game**.

## Example Game Flow

### Match 1
- Player 1 finishes first (plays last card) → **0 points**
- Player 2 has 3 cards left → **3 points** (3 × 1)
- Player 3 has 7 cards left → **14 points** (7 × 2)
- Player 4 has 10 cards left → **30 points** (10 × 3)

**Cumulative Scores:** [0, 3, 14, 30]

### Match 2
- Player 2 finishes first → **0 points this match**
- Player 1 has 9 cards left → **18 points this match** (9 × 2)
- Player 3 has 4 cards left → **4 points this match** (4 × 1)
- Player 4 has 11 cards left → **33 points this match** (11 × 3)

**Cumulative Scores:** [18, 3, 18, 63]

### Match 3
- Player 3 finishes first → **0 points this match**
- Player 1 has 8 cards left → **16 points this match** (8 × 2)
- Player 2 has 2 cards left → **2 points this match** (2 × 1)
- Player 4 has 13 cards left → **39 points this match** (13 × 3)

**Cumulative Scores:** [34, 5, 18, 102]

### Game Ends
Player 4 has reached **102 points** (≥ 101), so the game ends.

**Winner:** Player 2 with the lowest score of **5 points** 🏆

## Implementation Details

### Code Location
- **Types:** `/apps/mobile/src/game/types/index.ts`
  - `PlayerMatchScoreDetail` interface
  - `MatchResult` interface
  
- **Logic:** `/apps/mobile/src/game/state.ts`
  - `calculatePlayerScore(hand: Card[])` - Calculates points for a single player
  - `calculateMatchScores(players: Player[], winnerId: string)` - Calculates all players' scores
  - `shouldGameEnd(matchScores: PlayerMatchScore[])` - Checks if anyone reached 101+
  - `findFinalWinner(matchScores: PlayerMatchScore[])` - Finds player with lowest score

### Key Implementation Points
```typescript
// Points per card based on count
if (cardsRemaining >= 1 && cardsRemaining <= 4) {
  pointsPerCard = 1;
} else if (cardsRemaining >= 5 && cardsRemaining <= 9) {
  pointsPerCard = 2;
} else if (cardsRemaining >= 10 && cardsRemaining <= 13) {
  pointsPerCard = 3;
} else {
  pointsPerCard = 0; // Winner
}

finalScore = cardsRemaining * pointsPerCard;
```

### Testing
Comprehensive tests are available in `/apps/mobile/src/game/__tests__/scoring.test.ts` covering:
- ✅ All card count scenarios (1-13 cards)
- ✅ Winner scoring (0 points)
- ✅ Game end conditions (≥ 101 points)
- ✅ Final winner determination (lowest score)
- ✅ Multi-match cumulative scoring

Run tests: `pnpm test scoring.test.ts`

## Scoring Reference Table

| Remaining Cards | Points per Card | Total Points |
|----------------|----------------|--------------|
| 0 (Winner)     | 0              | **0**        |
| 1              | 1              | **1**        |
| 2              | 1              | **2**        |
| 3              | 1              | **3**        |
| 4              | 1              | **4**        |
| 5              | 2              | **10**       |
| 6              | 2              | **12**       |
| 7              | 2              | **14**       |
| 8              | 2              | **16**       |
| 9              | 2              | **18**       |
| 10             | 3              | **30**       |
| 11             | 3              | **33**       |
| 12             | 3              | **36**       |
| 13             | 3              | **39**       |

## Compliance Checklist

- ✅ Winner gets 0 points
- ✅ 1-4 cards = 1 point per card
- ✅ 5-9 cards = 2 points per card
- ✅ 10-13 cards = 3 points per card
- ✅ No multipliers or doublings
- ✅ Game ends at 101+ points
- ✅ Lowest score wins the game
- ✅ Comprehensive tests passing
