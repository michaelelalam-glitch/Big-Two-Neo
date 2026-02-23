# [P1.4] Action Card Logic

**Notion Task ID:** `310df7b8-b95e-8193-be3e-c48f66bd3ee8`
**Phase:** 1 — Core Game Engine (no UI)
**Depends on:** [P1.1] Game Types & Interfaces, [P1.3] Property Sets & Deck Configuration

---

## Objective

Create `/apps/mobile/src/game/lebanese-deal/action-cards.ts` — implements the pure game-logic effect of every action card. Each function takes `GameState` (or slices of it) and returns an updated state, with no side effects, UI calls, or async operations.

---

## Output File

```
apps/mobile/src/game/lebanese-deal/action-cards.ts
```

> Mirror the pattern from `apps/mobile/src/game/engine/game-logic.ts`: pure functions, no mutation of input, return new state slices.

---

## Step-by-Step Implementation

### Step 1 — Imports

```ts
import {
  LebaneseDealGameState, PlayerState, Card, ActionCard, PropertyCard, WildCard,
  PropertyColor, ActionType, TurnPhase, PendingAction, MoneyCard,
} from './types';
import { isCompleteSet, getRentForSet } from './deck-config';
```

---

### Step 2 — Utility: `getPlayer` and `cloneState`

```ts
function getPlayer(state: LebaneseDealGameState, playerId: string): PlayerState {
  const p = state.players.find(p => p.id === playerId);
  if (!p) throw new Error(`Player not found: ${playerId}`);
  return p;
}

/**
 * Shallow-clones the state with a new players array.
 * Use this at the top of every action function.
 */
function cloneState(state: LebaneseDealGameState): LebaneseDealGameState {
  return {
    ...state,
    players: state.players.map(p => ({ ...p,
      hand: [...p.hand],
      bank: [...p.bank],
      propertyArea: Object.fromEntries(
        Object.entries(p.propertyArea).map(([k, v]) => [k, [...(v ?? [])]])
      ) as PlayerState['propertyArea'],
    })),
  };
}
```

---

### Step 3 — `dealBreaker(state, attackerId, victimId, color)`

Steals a **complete set** from victim's property area:

```ts
/**
 * DEAL BREAKER — steals a complete set of one color from victim.
 * Only valid if victim has a complete set of that color.
 * @throws if victim does not have a complete set of `color`
 */
export function dealBreaker(
  state: LebaneseDealGameState,
  attackerId: string,
  victimId: string,
  color: PropertyColor,
): LebaneseDealGameState {
  const s = cloneState(state);
  const attacker = getPlayer(s, attackerId);
  const victim = getPlayer(s, victimId);

  const stolenCards = victim.propertyArea[color] ?? [];
  if (!isCompleteSet(color, stolenCards.length)) {
    throw new Error(`dealBreaker: victim does not have a complete set of ${color}`);
  }

  // Move entire set from victim → attacker
  victim.propertyArea[color] = [];
  attacker.propertyArea[color] = [
    ...(attacker.propertyArea[color] ?? []),
    ...stolenCards,
  ];

  return s;
}
```

---

### Step 4 — `slyDeal(state, attackerId, victimId, card)`

Steals **one property card** from an **incomplete** set:

```ts
/**
 * SLY DEAL — steals one property card from victim's incomplete set.
 * Cannot steal from a complete set (use Deal Breaker for that).
 * @throws if the target card is in a complete set
 */
export function slyDeal(
  state: LebaneseDealGameState,
  attackerId: string,
  victimId: string,
  card: PropertyCard | WildCard,
): LebaneseDealGameState {
  const s = cloneState(state);
  const attacker = getPlayer(s, attackerId);
  const victim = getPlayer(s, victimId);

  const color = card.type === 'property'
    ? (card as PropertyCard).color
    : (card as WildCard).chosenColor!;

  const victimSet = victim.propertyArea[color] ?? [];
  if (isCompleteSet(color, victimSet.length)) {
    throw new Error(`slyDeal: cannot steal from a complete set`);
  }

  // Remove card from victim
  victim.propertyArea[color] = victimSet.filter(c => c.id !== card.id);

  // Add to attacker's matching area
  attacker.propertyArea[color] = [
    ...(attacker.propertyArea[color] ?? []),
    card,
  ];

  return s;
}
```

---

### Step 5 — `forceDeal(state, player1Id, player2Id, card1, card2)`

Swaps one property card between two players:

```ts
/**
 * FORCE DEAL — player1 gives card1 to player2, player2 gives card2 to player1.
 * Neither card can be from a complete set.
 */
export function forceDeal(
  state: LebaneseDealGameState,
  player1Id: string,
  player2Id: string,
  card1: PropertyCard | WildCard,
  card2: PropertyCard | WildCard,
): LebaneseDealGameState {
  const s = cloneState(state);
  const p1 = getPlayer(s, player1Id);
  const p2 = getPlayer(s, player2Id);

  function removeCardFromArea(player: PlayerState, card: PropertyCard | WildCard) {
    for (const color of Object.keys(player.propertyArea) as PropertyColor[]) {
      const set = player.propertyArea[color] ?? [];
      if (isCompleteSet(color, set.length)) continue; // Cannot take from complete sets
      const idx = set.findIndex(c => c.id === card.id);
      if (idx !== -1) {
        player.propertyArea[color] = set.filter(c => c.id !== card.id);
        return color;
      }
    }
    throw new Error(`forceDeal: card ${card.id} not found in player's non-complete sets`);
  }

  function addCardToArea(player: PlayerState, card: PropertyCard | WildCard, color: PropertyColor) {
    player.propertyArea[color] = [...(player.propertyArea[color] ?? []), card];
  }

  const color1 = removeCardFromArea(p1, card1);
  const color2 = removeCardFromArea(p2, card2);
  addCardToArea(p2, card1, color1);
  addCardToArea(p1, card2, color2);

  return s;
}
```

---

### Step 6 — `debtCollector(state, attackerId, victimId)`

Sets up a pending payment of 5M:

```ts
/**
 * DEBT COLLECTOR — victim must pay 5M to attacker.
 * Sets `pendingAction` on the state. Payment is resolved separately.
 */
export function debtCollector(
  state: LebaneseDealGameState,
  attackerId: string,
  victimId: string,
): LebaneseDealGameState {
  return {
    ...state,
    pendingAction: {
      type: ActionType.DebtCollector,
      attackerId,
      victimIds: [victimId],
      amount: 5,
      isDoubleRent: false,
      justSayNoPlayed: false,
    },
    turnPhase: TurnPhase.Paying,
  };
}
```

---

### Step 7 — `birthday(state, attackerId)`

All other players pay 2M:

```ts
/**
 * BIRTHDAY — all other players must each pay 2M to attacker.
 */
export function birthday(
  state: LebaneseDealGameState,
  attackerId: string,
): LebaneseDealGameState {
  const victimIds = state.players
    .filter(p => p.id !== attackerId)
    .map(p => p.id);

  return {
    ...state,
    pendingAction: {
      type: ActionType.Birthday,
      attackerId,
      victimIds,
      amount: 2,
      isDoubleRent: false,
      justSayNoPlayed: false,
    },
    turnPhase: TurnPhase.Paying,
  };
}
```

---

### Step 8 — `activateDoubleRent(state)`

Marks that the next rent card played is doubled:

```ts
/**
 * DOUBLE RENT — the next rent card played this turn deals double rent.
 * Must be played BEFORE the rent card in the same turn.
 */
export function activateDoubleRent(
  state: LebaneseDealGameState,
): LebaneseDealGameState {
  return { ...state, doubleRentActive: true };
}
```

---

### Step 9 — `justSayNo(state, defenderId)`

Counter an incoming action:

```ts
/**
 * JUST SAY NO — cancels the current pending action.
 * The pendingAction must target defenderId.
 * Removes the Just Say No card from the defender's hand (caller must
 * have already removed it before calling this function).
 */
export function justSayNo(
  state: LebaneseDealGameState,
  defenderId: string,
): LebaneseDealGameState {
  if (!state.pendingAction) {
    throw new Error('justSayNo: no pending action to cancel');
  }
  if (!state.pendingAction.victimIds.includes(defenderId)) {
    throw new Error(`justSayNo: player ${defenderId} is not a victim of the pending action`);
  }

  return {
    ...state,
    pendingAction: {
      ...state.pendingAction,
      justSayNoPlayed: true,
    },
    // Pending action cancelled — remove victim or cancel entirely
    // If Birthday targeting multiple, remove only this victim:
    ...(state.pendingAction.victimIds.length > 1 ? {
      pendingAction: {
        ...state.pendingAction,
        victimIds: state.pendingAction.victimIds.filter(id => id !== defenderId),
      },
    } : {
      pendingAction: null,
      turnPhase: TurnPhase.Playing,
    }),
  };
}
```

> **Note:** `weakNo` follows the same signature as `justSayNo` but can itself be countered by a real Just Say No. Handle this in the state manager (P2.1) — this file only handles the card effect, not the counter chain.

---

### Step 10 — `setLock(state, ownerId, color)`

Locks a complete set against Deal Breaker and Sly Deal:

```ts
/**
 * SET LOCK — places a protection marker on a complete set.
 * The set cannot be stolen until the lock is removed.
 * (Implementation note: store a `lockedSets` set on PlayerState if needed,
 * or check for a SetLock card in the propertyArea as a sentinel.)
 */
export function setLock(
  state: LebaneseDealGameState,
  ownerId: string,
  color: PropertyColor,
): LebaneseDealGameState {
  const s = cloneState(state);
  const owner = getPlayer(s, ownerId);

  if (!isCompleteSet(color, (owner.propertyArea[color] ?? []).length)) {
    throw new Error(`setLock: can only lock a complete set`);
  }

  // Convention: locked sets are tracked in GameState.lockedSets
  // This requires adding `lockedSets: Record<string, PropertyColor[]>` to GameState in types.ts
  // See types.ts step 9 — add `lockedSets` field to LebaneseDealGameState
  const lockedKey = `${ownerId}_${color}`;
  return {
    ...s,
    // @ts-ignore — extend GameState in P1.1 to include lockedSets
    lockedSets: new Set([...((s as any).lockedSets ?? []), lockedKey]),
  };
}
```

> **Action item for P1.1:** After implementing this file, go back to `types.ts` and add `lockedSets: Set<string>` to `LebaneseDealGameState`.

---

### Step 11 — `extraTurn(state)`

Resets move count to allow 3 more plays:

```ts
/**
 * EXTRA TURN — resets the current turn's move counter,
 * granting the player 3 additional card plays this turn.
 * Discard to bank: not applicable — this card is played to activate the effect.
 */
export function extraTurn(state: LebaneseDealGameState): LebaneseDealGameState {
  return { ...state, turnMovesPlayed: 0 };
}
```

---

### Step 12 — `drawTwo(state, playerId)`

Immediately draw 2 cards from draw pile:

```ts
/**
 * DRAW TWO — player draws 2 additional cards immediately.
 * Returns updated state with those cards moved from drawPile → player's hand.
 */
export function drawTwo(
  state: LebaneseDealGameState,
  playerId: string,
): LebaneseDealGameState {
  const s = cloneState(state);
  const player = getPlayer(s, playerId);
  const drawn = s.drawPile.splice(0, 2);
  player.hand.push(...drawn);
  return s;
}
```

---

### Step 13 — Export action dispatcher `applyActionCard`

Single entry point for the state manager (P2.1) to call:

```ts
/**
 * Dispatches an action card effect based on `actionType`.
 * This is the main entry point called by the state manager.
 */
export function applyActionCard(
  state: LebaneseDealGameState,
  card: ActionCard,
  options: {
    attackerId: string;
    victimId?: string;
    color?: PropertyColor;
    targetCard?: PropertyCard | WildCard;
    swapCard?: PropertyCard | WildCard;
  },
): LebaneseDealGameState {
  const { attackerId, victimId, color, targetCard, swapCard } = options;

  switch (card.actionType) {
    case ActionType.DealBreaker:
      return dealBreaker(state, attackerId, victimId!, color!);
    case ActionType.SlyDeal:
      return slyDeal(state, attackerId, victimId!, targetCard!);
    case ActionType.ForceDeal:
      return forceDeal(state, attackerId, victimId!, targetCard!, swapCard!);
    case ActionType.DebtCollector:
      return debtCollector(state, attackerId, victimId!);
    case ActionType.Birthday:
      return birthday(state, attackerId);
    case ActionType.DoubleRent:
      return activateDoubleRent(state);
    case ActionType.JustSayNo:
    case ActionType.WeakNo:
      return justSayNo(state, attackerId);
    case ActionType.ExtraTurn:
      return extraTurn(state);
    case ActionType.DrawTwo:
      return drawTwo(state, attackerId);
    case ActionType.SetLock:
      return setLock(state, attackerId, color!);
    default:
      // UltimateShield, House, Hotel, Mosque, Zakat, GetJoker, Abracadabra
      // Implement in follow-up tasks when game rules are fully confirmed
      console.warn(`applyActionCard: unhandled action type ${card.actionType}`);
      return state;
  }
}
```

---

## Key Game Rules to Encode

| Rule | Implementation Location |
|------|------------------------|
| Cannot steal from a complete set with Sly Deal | `slyDeal()` throws |
| Cannot steal from a locked set (Set Lock) | Check `lockedSets` in `dealBreaker()` and `slyDeal()` |
| Just Say No can be countered by another Just Say No | Handled in P2.1 state manager, not here |
| Weak No can be defeated by Just Say No | Handle counter chain in P2.1 |
| Double Rent must be played before rent card in same turn | `doubleRentActive` flag cleared when rent is charged |
| Force Deal cannot use cards from complete sets | `forceDeal()` skips complete sets |

---

## Reference Files

| File | Purpose |
|------|---------|
| `apps/mobile/src/game/lebanese-deal/types.ts` | All game types (P1.1) |
| `apps/mobile/src/game/lebanese-deal/deck-config.ts` | `isCompleteSet`, `getRentForSet` (P1.3) |
| `apps/mobile/src/game/engine/game-logic.ts` | Big Two pure-function pattern to mirror |
| `docs/SAUDI_DEAL_CARDS_REFERENCE.md` | Arabic card names and effect descriptions |

---

## Acceptance Criteria

- [ ] `dealBreaker` throws if victim does not have a complete set
- [ ] `slyDeal` throws if target card is in a complete set
- [ ] `forceDeal` throws if either card is from a complete set
- [ ] `justSayNo` removes the pending action from state
- [ ] `birthday` sets `turnPhase = TurnPhase.Paying` and `victimIds` = all other 3 players
- [ ] `activateDoubleRent` sets `doubleRentActive = true` on state
- [ ] `extraTurn` resets `turnMovesPlayed` to `0`
- [ ] No functions mutate their `state` input (pure functions — spread/clone only)
- [ ] Zero TypeScript errors
- [ ] Unit tests added in P8.1 covering at least: `dealBreaker` happy path, `dealBreaker` invalid throw, `slyDeal` complete-set guard, `justSayNo` cancel, `birthday` victim count
