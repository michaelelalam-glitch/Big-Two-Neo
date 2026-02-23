# [P1.3] Property Sets & Deck Configuration

**Notion Task ID:** `310df7b8-b95e-81e1-a069-de7b9d4c4983`
**Phase:** 1 — Core Game Engine (no UI)
**Depends on:** [P1.1] Game Types & Interfaces
**Required by:** [P1.2] Deck Definition, [P2.2] Rent & Payment System

---

## Objective

Create `/apps/mobile/src/game/lebanese-deal/deck-config.ts` — the static configuration file that defines every Lebanese Deal card category: property set sizes and rent tables, dual-color wild card pairings, money denominations, and action card counts. This becomes the single source of truth that `deck.ts` reads to build the deck.

---

## Output File

```
apps/mobile/src/game/lebanese-deal/deck-config.ts
```

---

## Step-by-Step Implementation

### Step 1 — Imports

```ts
import { PropertyColor, ActionType } from './types';
```

No other imports needed — this file is pure static data.

---

### Step 2 — Define `PropertySetConfig` interface (local to this file)

```ts
interface PropertySetConfig {
  color: PropertyColor;
  nameAr: string;
  nameEn: string;
  totalCards: number;       // How many property cards of this color exist in the deck
  /** rentValues[i] = rent charged when you own i+1 cards of this set */
  rentValues: number[];     // Length must equal totalCards
}
```

---

### Step 3 — Define `PROPERTY_SETS` array

One entry per color group. Rent values come from `docs/SAUDI_DEAL_CARDS_REFERENCE.md`.

```ts
export const PROPERTY_SETS: PropertySetConfig[] = [
  {
    color: PropertyColor.Tabuk,
    nameAr: 'تبوك',
    nameEn: 'Tabuk',
    totalCards: 2,
    rentValues: [1, 2],
  },
  {
    color: PropertyColor.Hail,
    nameAr: 'حائل',
    nameEn: "Ha'il",
    totalCards: 2,
    rentValues: [2, 3],
  },
  {
    color: PropertyColor.AlJouf,
    nameAr: 'الجوف',
    nameEn: 'Al Jouf',
    totalCards: 2,
    rentValues: [2, 4],
  },
  {
    color: PropertyColor.Jeddah,
    nameAr: 'جدة',
    nameEn: 'Jeddah',
    totalCards: 2,
    rentValues: [2, 4],
  },
  {
    color: PropertyColor.Madinah,
    nameAr: 'المدينة',
    nameEn: 'Madinah',
    totalCards: 3,
    rentValues: [2, 3, 4],
  },
  {
    color: PropertyColor.Taif,
    nameAr: 'الطائف',
    nameEn: "Ta'if",
    totalCards: 3,
    rentValues: [1, 2, 3],
  },
  {
    color: PropertyColor.Asir,
    nameAr: 'عسير',
    nameEn: 'Asir',
    totalCards: 3,
    rentValues: [2, 3, 5],
  },
  {
    color: PropertyColor.Eastern,
    nameAr: 'الشرقية',
    nameEn: 'Eastern Province',
    totalCards: 3,
    rentValues: [2, 3, 6],
  },
  {
    color: PropertyColor.Makkah,
    nameAr: 'مكة',
    nameEn: 'Makkah',
    totalCards: 3,
    rentValues: [2, 4, 7],
  },
  {
    color: PropertyColor.Qassim,
    nameAr: 'القصيم',
    nameEn: 'Qassim',
    totalCards: 3,
    rentValues: [3, 4, 6],
  },
  {
    color: PropertyColor.Jizan,
    nameAr: 'جازان',
    nameEn: 'Jizan',
    totalCards: 4,
    rentValues: [3, 5, 10, 12],
  },
  {
    color: PropertyColor.Riyadh,
    nameAr: 'الرياض',
    nameEn: 'Riyadh',
    totalCards: 4,
    rentValues: [2, 3, 4, 8],
  },
];
```

> **Verify:** `docs/SAUDI_DEAL_CARDS_REFERENCE.md` lists 12 color groups. Ensure total property cards = 34 (sum of all `totalCards`).
> **Jizan 4th rent value:** The reference doc shows 3م/5م/10م for 3 cards — if Jizan has 4 cards, add the 4th rent value. Confirm with the physical card game.

---

### Step 4 — Define `MONEY_DENOMINATIONS`

```ts
interface MoneyDenominationConfig {
  value: number;   // In millions
  count: number;   // How many copies in the deck
}

export const MONEY_DENOMINATIONS: MoneyDenominationConfig[] = [
  { value: 1,  count: 6 },
  { value: 2,  count: 5 },
  { value: 3,  count: 3 },
  { value: 4,  count: 3 },
  { value: 5,  count: 2 },
  { value: 10, count: 1 },
  { value: 20, count: 1 },
];
// Total: 21 money cards
```

---

### Step 5 — Define `ACTION_CARD_COUNTS`

```ts
interface ActionCardConfig {
  actionType: ActionType;
  nameAr: string;
  nameEn: string;
  count: number;
  bankValue: number;  // Value in millions when banked instead of played
}

export const ACTION_CARD_COUNTS: ActionCardConfig[] = [
  // Steal cards
  { actionType: ActionType.DealBreaker,     nameAr: 'رحت فيها',         nameEn: 'Deal Breaker',    count: 2, bankValue: 5 },
  { actionType: ActionType.SlyDeal,         nameAr: 'عيني عينك',        nameEn: 'Sly Deal',        count: 2, bankValue: 3 },
  { actionType: ActionType.ForceDeal,       nameAr: 'اعطيني أعطيك',     nameEn: 'Force Deal',      count: 2, bankValue: 3 },
  // Rent / Collect
  { actionType: ActionType.DebtCollector,   nameAr: 'طلع الدين',        nameEn: 'Debt Collector',  count: 1, bankValue: 3 },
  { actionType: ActionType.Birthday,        nameAr: 'شبيك لبيك',        nameEn: "It's Your Birthday", count: 1, bankValue: 2 },
  { actionType: ActionType.Zakat,           nameAr: 'طلع زكاتك',        nameEn: 'Zakat',           count: 1, bankValue: 2 },
  // Rent modifiers
  { actionType: ActionType.DoubleRent,      nameAr: 'زيادة الخير',      nameEn: 'Double Rent',     count: 2, bankValue: 1 },
  // Defense
  { actionType: ActionType.JustSayNo,       nameAr: 'تبطي عظم',         nameEn: 'Just Say No',     count: 2, bankValue: 4 },
  { actionType: ActionType.WeakNo,          nameAr: 'أقول لا يكثر',     nameEn: 'Weak No',         count: 1, bankValue: 2 },
  { actionType: ActionType.UltimateShield,  nameAr: 'عدم تعرض',         nameEn: 'Ultimate Shield', count: 1, bankValue: 4 },
  // Set protection
  { actionType: ActionType.SetLock,         nameAr: 'لا يحوشك',         nameEn: 'Set Lock',        count: 2, bankValue: 2 },
  // Utility / Turn effects
  { actionType: ActionType.ExtraTurn,       nameAr: 'واسطة',            nameEn: 'Extra Turn',      count: 2, bankValue: 1 },
  { actionType: ActionType.DrawTwo,         nameAr: 'حبتين السحب',      nameEn: 'Draw Two',        count: 2, bankValue: 1 },
  // Property upgrades
  { actionType: ActionType.House,           nameAr: 'بيت',              nameEn: 'House',           count: 2, bankValue: 3 },
  { actionType: ActionType.Hotel,           nameAr: 'فندق',             nameEn: 'Hotel',           count: 2, bankValue: 4 },
  { actionType: ActionType.Mosque,          nameAr: 'مسجد',             nameEn: 'Mosque',          count: 1, bankValue: 5 },
  // Special
  { actionType: ActionType.GetJoker,        nameAr: 'هات الجوكر',       nameEn: 'Get Joker',       count: 1, bankValue: 4 },
  { actionType: ActionType.Abracadabra,     nameAr: 'أبرا كدبرا',       nameEn: 'Abracadabra',     count: 1, bankValue: 5 },
];
```

---

### Step 6 — Define `DUAL_COLOR_WILDS`

Each entry represents one dual-color wild card AND the corresponding rent card pair (2 rent cards per pairing):

```ts
interface DualColorWildConfig {
  colorA: PropertyColor;
  colorB: PropertyColor;
  nameAr: string;
}

export const DUAL_COLOR_WILDS: DualColorWildConfig[] = [
  { colorA: PropertyColor.Tabuk,   colorB: PropertyColor.Hail,    nameAr: 'جوكر تبوك/حائل' },
  { colorA: PropertyColor.AlJouf,  colorB: PropertyColor.Jeddah,  nameAr: 'جوكر الجوف/جدة' },
  { colorA: PropertyColor.Madinah, colorB: PropertyColor.Taif,    nameAr: 'جوكر المدينة/الطائف' },
  { colorA: PropertyColor.Asir,    colorB: PropertyColor.Eastern, nameAr: 'جوكر عسير/الشرقية' },
  { colorA: PropertyColor.Makkah,  colorB: PropertyColor.Qassim,  nameAr: 'جوكر مكة/القصيم' },
  { colorA: PropertyColor.Jizan,   colorB: PropertyColor.Riyadh,  nameAr: 'جوكر جازان/الرياض' },
];
```

> **Note:** Verify the exact pairings from the physical card game — dual-color wilds are always paired between two specific colors. `docs/SAUDI_DEAL_CARDS_REFERENCE.md` lists ~13 pairings; update this array to match exactly.

---

### Step 7 — Export helper: `getRentForSet`

Used by the rent system (P2.2) to look up rent based on how many cards a player holds:

```ts
/**
 * Returns the rent owed for a property color given the number of cards the
 * owner has in that set.
 * @param color - The property color
 * @param cardCount - Number of property/wild cards in that set (1-based)
 * @returns Rent in millions, or 0 if cardCount is 0 or invalid
 */
export function getRentForSet(color: PropertyColor, cardCount: number): number {
  const set = PROPERTY_SETS.find(s => s.color === color);
  if (!set || cardCount <= 0) return 0;
  const idx = Math.min(cardCount, set.rentValues.length) - 1;
  return set.rentValues[idx];
}
```

---

### Step 8 — Export helper: `isCompleteSet`

```ts
/**
 * Returns true if the player has all required cards for a complete set of this color.
 * Wild cards count toward the set.
 */
export function isCompleteSet(color: PropertyColor, cardCount: number): boolean {
  const set = PROPERTY_SETS.find(s => s.color === color);
  if (!set) return false;
  return cardCount >= set.totalCards;
}
```

---

### Step 9 — Export constants

```ts
/** Win condition: number of complete property sets needed */
export const SETS_TO_WIN = 3;

/** Cards dealt to each player at start */
export const STARTING_HAND_SIZE = 5;

/** Cards drawn per turn (standard) */
export const CARDS_DRAWN_PER_TURN = 2;

/** Maximum cards playable per turn */
export const MAX_PLAYS_PER_TURN = 3;

/** Max hand size (no limit in standard rules — set to large number) */
export const MAX_HAND_SIZE = 99;
```

---

## Reference Files

| File | Purpose |
|------|---------|
| `apps/mobile/src/game/lebanese-deal/types.ts` | `PropertyColor`, `ActionType` enums (P1.1) |
| `docs/SAUDI_DEAL_CARDS_REFERENCE.md` | Authoritative card list with exact counts and rent values |

---

## Acceptance Criteria

- [ ] `PROPERTY_SETS` has exactly 12 entries, one per `PropertyColor`
- [ ] Each `rentValues` array length matches `totalCards` for that set (or totalCards - 1 if index 0 means "0 cards")
- [ ] `getRentForSet(PropertyColor.Riyadh, 4)` returns `8` (full set rent)
- [ ] `isCompleteSet(PropertyColor.Tabuk, 2)` returns `true`
- [ ] `isCompleteSet(PropertyColor.Tabuk, 1)` returns `false`
- [ ] `MONEY_DENOMINATIONS` sums to 21 total money cards
- [ ] Zero TypeScript errors
