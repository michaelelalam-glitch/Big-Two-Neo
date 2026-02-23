# [P1.1] Game Types & Interfaces

**Notion Task ID:** `310df7b8-b95e-8179-8deb-c2babc540349`
**Phase:** 1 — Core Game Engine (no UI)
**Priority:** HIGH — all other Phase 1 tasks depend on this

---

## Objective

Create `/apps/mobile/src/game/lebanese-deal/types.ts` — the single source of truth for all TypeScript types and interfaces used by the Lebanese Deal game engine.

---

## Output File

```
apps/mobile/src/game/lebanese-deal/types.ts
```

> Mirror the pattern from `apps/mobile/src/game/types/index.ts` (Big Two): JSDoc comments on every export, clear interface composition, no circular dependencies.

---

## Step-by-Step Implementation

### Step 1 — Create the directory

```bash
mkdir -p apps/mobile/src/game/lebanese-deal
```

Create an empty `index.ts` barrel file too:
```
apps/mobile/src/game/lebanese-deal/index.ts
```
It will export everything once all P1 files are done (leave empty for now).

---

### Step 2 — Define `PropertyColor` enum

All 10 Lebanese Deal color groups. Use the English transliteration names used in `docs/SAUDI_DEAL_CARDS_REFERENCE.md`:

```ts
export enum PropertyColor {
  Tabuk = 'tabuk',
  Hail = 'hail',
  AlJouf = 'al_jouf',
  Jeddah = 'jeddah',
  Madinah = 'madinah',
  Taif = 'taif',
  Asir = 'asir',
  Eastern = 'eastern',
  Makkah = 'makkah',
  Qassim = 'qassim',
  Jizan = 'jizan',
  Riyadh = 'riyadh',
}
```

> Note: The game has 12 color groups total. Ensure the count matches `deck-config.ts` (P1.3).

---

### Step 3 — Define `CardType` enum

```ts
export enum CardType {
  Property = 'property',
  Money = 'money',
  Action = 'action',
  Rent = 'rent',
  Wild = 'wild',
}
```

---

### Step 4 — Define `ActionType` enum

One entry per distinct action card effect:

```ts
export enum ActionType {
  DealBreaker = 'deal_breaker',
  SlyDeal = 'sly_deal',
  ForceDeal = 'force_deal',
  DebtCollector = 'debt_collector',
  Birthday = 'birthday',
  DoubleRent = 'double_rent',
  JustSayNo = 'just_say_no',
  ExtraTurn = 'extra_turn',
  DrawTwo = 'draw_two',
  SetLock = 'set_lock',        // لا يحوشك — protects a complete set
  WeakNo = 'weak_no',          // أقول لا يكثر — can be overridden by Just Say No
  UltimateShield = 'ultimate_shield', // عدم تعرض — cannot be countered
  House = 'house',             // بيت — upgrade on complete set
  Hotel = 'hotel',             // فندق — upgrade on house
  Mosque = 'mosque',           // مسجد — upgrade on hotel
  Zakat = 'zakat',             // طلع زكاتك — collect from all players
  GetJoker = 'get_joker',      // هات الجوكر
  Abracadabra = 'abracadabra', // أبرا كدبرا
}
```

---

### Step 5 — Define base `Card` interface and discriminated union sub-types

```ts
/** Base interface — every card has these fields */
export interface BaseCard {
  id: string;        // Unique identifier, e.g. "prop_riyadh_1", "money_5", "action_deal_breaker_1"
  type: CardType;
  nameAr: string;    // Arabic display name
  nameEn: string;    // English display name
}

/** A property card belonging to a color group */
export interface PropertyCard extends BaseCard {
  type: CardType.Property;
  color: PropertyColor;
  /** Rent values indexed by number of cards held in that set: [0-card, 1-card, 2-card, full-set] */
  rentValues: number[];
}

/** A money / bank card */
export interface MoneyCard extends BaseCard {
  type: CardType.Money;
  value: number;  // In millions (e.g. 1, 2, 3, 4, 5, 10, 20)
}

/** An action card that triggers a game effect */
export interface ActionCard extends BaseCard {
  type: CardType.Action;
  actionType: ActionType;
  /** For banking: the monetary value of this card if paid as money */
  bankValue: number;
}

/** A rent demand card — valid for 1 or 2 colors */
export interface RentCard extends BaseCard {
  type: CardType.Rent;
  colors: PropertyColor[];  // 1 color = targeted rent; 2 colors = color-specific rent
  bankValue: number;
}

/** A wild card that can substitute for any property of a chosen color */
export interface WildCard extends BaseCard {
  type: CardType.Wild;
  /** null = universal wild (any color); [ColorA, ColorB] = dual-color wild */
  validColors: PropertyColor[] | null;
  /** Set at runtime when played to a property group */
  chosenColor?: PropertyColor;
}

/** Discriminated union of all card types */
export type Card = PropertyCard | MoneyCard | ActionCard | RentCard | WildCard;
```

---

### Step 6 — Define `PlayerState` interface

```ts
export interface PlayerState {
  id: string;
  name: string;
  isBot: boolean;
  /** Cards currently in the player's hand */
  hand: Card[];
  /** Money cards banked (played face-up as money) */
  bank: MoneyCard[];
  /**
   * Property groups owned.
   * Key = PropertyColor enum value.
   * Value = array of PropertyCard and/or WildCard placed there.
   */
  propertyArea: Partial<Record<PropertyColor, (PropertyCard | WildCard)[]>>;
  /** Pending Just Say No / defense card (if any) */
  pendingDefense: ActionCard | null;
}
```

---

### Step 7 — Define `TurnPhase` enum and `GameStatus` enum

```ts
export enum TurnPhase {
  Drawing = 'drawing',
  Playing = 'playing',
  Paying = 'paying',   // Waiting for a targeted player to pay rent/debt
  Responding = 'responding', // Waiting for Just Say No response
  Ended = 'ended',
}

export enum GameStatus {
  Waiting = 'waiting',
  Active = 'active',
  Finished = 'finished',
}
```

---

### Step 8 — Define `PendingAction` interface

Used when an action is played and waiting for a response (e.g. Just Say No window):

```ts
export interface PendingAction {
  type: ActionType;
  attackerId: string;
  victimIds: string[];           // 1 for most actions, all for Birthday/Zakat
  amount?: number;               // For rent/debt
  propertyColor?: PropertyColor; // For Deal Breaker / Sly Deal
  card1?: Card;                  // For Force Deal
  card2?: Card;
  isDoubleRent: boolean;
  justSayNoPlayed: boolean;
}
```

---

### Step 9 — Define `GameState` interface

```ts
export interface LebaneseDealGameState {
  gameId: string;
  status: GameStatus;
  players: PlayerState[];        // Always 4 players (index 0–3)
  drawPile: Card[];
  discardPile: Card[];
  currentPlayerIndex: number;    // 0–3
  turnPhase: TurnPhase;
  turnMovesPlayed: number;       // Max 3 cards playable per turn
  pendingAction: PendingAction | null;
  winnerIndex: number | null;
  /** Set when Double Rent is played; consumed on next rent card */
  doubleRentActive: boolean;
  round: number;
}
```

---

### Step 10 — Add barrel export to `index.ts`

Once all P1 files are done, add to `apps/mobile/src/game/lebanese-deal/index.ts`:

```ts
export * from './types';
export * from './deck-config';
export * from './deck';
export * from './action-cards';
```

---

## Reference Files

| File | Purpose |
|------|---------|
| `apps/mobile/src/game/types/index.ts` | Big Two type pattern to mirror |
| `docs/SAUDI_DEAL_CARDS_REFERENCE.md` | Full card list — color names, counts, Arabic names |
| `apps/mobile/src/types/multiplayer.ts` | Existing shared types (do not duplicate) |

---

## Acceptance Criteria

- [ ] `types.ts` exports: `PropertyColor`, `CardType`, `ActionType`, `BaseCard`, `PropertyCard`, `MoneyCard`, `ActionCard`, `RentCard`, `WildCard`, `Card`, `PlayerState`, `TurnPhase`, `GameStatus`, `PendingAction`, `LebaneseDealGameState`
- [ ] Zero TypeScript errors (`tsc --noEmit` passes)
- [ ] No imports from other `lebanese-deal/` files (this is the root type file — no circular deps)
- [ ] All color names in `PropertyColor` match exactly what `deck-config.ts` (P1.3) uses
