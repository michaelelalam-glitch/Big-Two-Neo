# [P1.2] Deck Definition

**Notion Task ID:** `310df7b8-b95e-815a-919f-c234209ecf10`
**Phase:** 1 — Core Game Engine (no UI)
**Depends on:** [P1.1] Game Types & Interfaces, [P1.3] Property Sets & Deck Configuration

---

## Objective

Create `/apps/mobile/src/game/lebanese-deal/deck.ts` — builds the complete Lebanese Deal card deck as a flat array of `Card` objects ready to be shuffled and dealt. This file is the single place where every card instance is constructed.

---

## Output File

```
apps/mobile/src/game/lebanese-deal/deck.ts
```

---

## Reference Data

Full card counts come from `docs/SAUDI_DEAL_CARDS_REFERENCE.md` and align with the configuration defined in [P1.3] `deck-config.ts`.

---

## Step-by-Step Implementation

### Step 1 — Imports

```ts
import {
  Card, CardType, ActionType, PropertyColor,
  PropertyCard, MoneyCard, ActionCard, RentCard, WildCard,
} from './types';
import { PROPERTY_SETS, MONEY_DENOMINATIONS, ACTION_CARD_COUNTS, DUAL_COLOR_WILDS } from './deck-config';
```

> **Do not hardcode card data here.** Pull all counts and rent tables from `deck-config.ts` so there is one source of truth.

---

### Step 2 — Helper: `makeId(prefix, index)`

```ts
let _idCounter = 0;
function makeId(prefix: string): string {
  return `${prefix}_${++_idCounter}`;
}
```

Reset `_idCounter` inside `buildDeck()` so each call produces a fresh consistent deck.

---

### Step 3 — Build property cards

Iterate `PROPERTY_SETS` from `deck-config.ts`. For each color group, create N `PropertyCard` objects (where N = `set.totalCards`):

```ts
function buildPropertyCards(): PropertyCard[] {
  const cards: PropertyCard[] = [];
  for (const set of PROPERTY_SETS) {
    for (let i = 0; i < set.totalCards; i++) {
      cards.push({
        id: makeId(`prop_${set.color}`),
        type: CardType.Property,
        color: set.color,
        nameAr: set.nameAr,
        nameEn: set.nameEn,
        rentValues: set.rentValues,  // e.g. [0, 1, 2, 4] for Riyadh
      });
    }
  }
  return cards;
}
```

**Expected output:** 34 property cards total (matching `docs/SAUDI_DEAL_CARDS_REFERENCE.md` counts per color).

---

### Step 4 — Build money cards

```ts
function buildMoneyCards(): MoneyCard[] {
  const cards: MoneyCard[] = [];
  for (const denom of MONEY_DENOMINATIONS) {
    for (let i = 0; i < denom.count; i++) {
      cards.push({
        id: makeId(`money_${denom.value}`),
        type: CardType.Money,
        value: denom.value,
        nameAr: `${denom.value}م`,
        nameEn: `${denom.value}M`,
      });
    }
  }
  return cards;
}
```

**Expected counts** (from `docs/SAUDI_DEAL_CARDS_REFERENCE.md`):

| Value | Count |
|-------|-------|
| 1م    | 6     |
| 2م    | 5     |
| 3م    | 3     |
| 4م    | 3     |
| 5م    | 2     |
| 10م   | 1     |
| 20م   | 1     |

**Total: 21 money cards**

---

### Step 5 — Build action cards

```ts
function buildActionCards(): ActionCard[] {
  const cards: ActionCard[] = [];
  for (const entry of ACTION_CARD_COUNTS) {
    for (let i = 0; i < entry.count; i++) {
      cards.push({
        id: makeId(`action_${entry.actionType}`),
        type: CardType.Action,
        actionType: entry.actionType,
        nameAr: entry.nameAr,
        nameEn: entry.nameEn,
        bankValue: entry.bankValue,
      });
    }
  }
  return cards;
}
```

**Expected counts** from Notion task + `docs/SAUDI_DEAL_CARDS_REFERENCE.md`:

| Action                  | English Name    | Count | Bank Value |
|-------------------------|-----------------|-------|------------|
| `deal_breaker`          | Deal Breaker    | 2     | 5म         |
| `sly_deal`              | Sly Deal        | 2     | 3म         |
| `force_deal`            | Force Deal      | 2     | 3म         |
| `debt_collector`        | Debt Collector  | 1     | 3म         |
| `birthday`              | Birthday        | 1     | 2म         |
| `double_rent`           | Double Rent     | 2     | 1म         |
| `just_say_no`           | Just Say No     | 2     | 4म         |
| `extra_turn`            | Extra Turn      | 2     | 1م         |
| `draw_two`              | Draw Two        | 2     | 1م         |
| `set_lock`              | Set Lock        | 2     | 2م         |
| `weak_no`               | Weak No         | 1     | 2م         |
| `ultimate_shield`       | Ultimate Shield | 1     | 4م         |
| `house`                 | House           | 2     | 3م         |
| `hotel`                 | Hotel           | 2     | 4م         |
| `mosque`                | Mosque          | 1     | 5م         |
| `zakat`                 | Zakat           | 1     | 2م         |
| `get_joker`             | Get Joker       | 1     | 4م         |
| `abracadabra`           | Abracadabra     | 1     | 5م         |

> **Note:** Verify exact counts against `docs/SAUDI_DEAL_CARDS_REFERENCE.md`. The Notion task description mentions Monopoly Deal counts (e.g. Deal Breaker×2, Sly Deal×3) — use the Saudi/Lebanese-specific counts from the reference file.

---

### Step 6 — Build rent cards

```ts
function buildRentCards(): RentCard[] {
  const cards: RentCard[] = [];
  // Each dual-color rent card appears twice in the deck
  for (const rentConfig of DUAL_COLOR_WILDS) {
    for (let copy = 0; copy < 2; copy++) {
      cards.push({
        id: makeId(`rent_${rentConfig.colorA}_${rentConfig.colorB}`),
        type: CardType.Rent,
        colors: [rentConfig.colorA, rentConfig.colorB],
        nameAr: rentConfig.nameAr,
        nameEn: `Rent (${rentConfig.colorA}/${rentConfig.colorB})`,
        bankValue: 1,
      });
    }
  }
  // Universal rent card (collect rent on any color) — 2 copies
  for (let i = 0; i < 2; i++) {
    cards.push({
      id: makeId('rent_any'),
      type: CardType.Rent,
      colors: Object.values(PropertyColor),
      nameAr: 'الإيجار',
      nameEn: 'Rent (Any)',
      bankValue: 1,
    });
  }
  return cards;
}
```

---

### Step 7 — Build wild cards

```ts
function buildWildCards(): WildCard[] {
  const cards: WildCard[] = [];
  // Dual-color wilds — 1 copy of each combination
  for (const dualWild of DUAL_COLOR_WILDS) {
    cards.push({
      id: makeId(`wild_${dualWild.colorA}_${dualWild.colorB}`),
      type: CardType.Wild,
      validColors: [dualWild.colorA, dualWild.colorB],
      nameAr: dualWild.nameAr,
      nameEn: `Wild (${dualWild.colorA}/${dualWild.colorB})`,
    });
  }
  // Universal wild — 1 copy (can be any color)
  cards.push({
    id: makeId('wild_universal'),
    type: CardType.Wild,
    validColors: null,
    nameAr: 'الجوكر العالمي',
    nameEn: 'Universal Wild',
  });
  return cards;
}
```

---

### Step 8 — Assemble `buildDeck()` export

```ts
/**
 * Builds a full, unshuffled Lebanese Deal deck.
 * Call this once at game initialization, then shuffle the result.
 */
export function buildDeck(): Card[] {
  _idCounter = 0; // Reset for deterministic IDs
  return [
    ...buildPropertyCards(),
    ...buildMoneyCards(),
    ...buildActionCards(),
    ...buildRentCards(),
    ...buildWildCards(),
  ];
}
```

---

### Step 9 — Add `shuffleDeck()` utility

```ts
/**
 * Fisher-Yates in-place shuffle. Returns the same array (mutated).
 */
export function shuffleDeck(deck: Card[]): Card[] {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
```

---

### Step 10 — Verify card total

Add a dev-only validation (can be a Jest test in P8.1):

```ts
// Expected total: ~106 cards
// 34 property + 21 money + ~34 action + ~14 rent + ~14 wild = ~117
// Adjust based on final config in deck-config.ts
export const EXPECTED_DECK_SIZE = 117; // Update after verifying with deck-config
```

---

## Reference Files

| File | Purpose |
|------|---------|
| `apps/mobile/src/game/lebanese-deal/types.ts` | All type imports (P1.1) |
| `apps/mobile/src/game/lebanese-deal/deck-config.ts` | Card counts & rent tables (P1.3) |

---

## Acceptance Criteria

- [ ] `buildDeck()` returns a flat `Card[]` with no duplicated `id` values
- [ ] Property card count = sum of all `totalCards` in `PROPERTY_SETS`
- [ ] Money card count = 21 (matching reference file)
- [ ] Each card object satisfies its TypeScript type without `as` casts
- [ ] `shuffleDeck()` produces a different order on each call (non-deterministic, tested via multiple runs)
- [ ] Zero TypeScript errors

---

---

# Saudi Deal (سعودي ديل) — Complete Card Reference

**Platform:** Jawaker (jawaker.com)
**Win Condition:** First player to collect **3 complete property sets** of different colors
**Players:** 4
**Total Cards:** ~110–120
**Source:** Official Jawaker rules + OCR card image analysis (jawaker.com/saudi-deal-rules)

---

## 💰 MONEY CARDS — 21 total

| Value | Copies | Notes |
|---|---|---|
| 1م (1 Million) | ×6 | Most common |
| 2م | ×5 | |
| 3م | ×3 | |
| 4م | ×3 | |
| 5م | ×2 | |
| 10م | ×1 | **Single copy — no duplicate** |
| 20م | ×1 | **Single copy — no duplicate** |

> No change (فكة) rule: if asked to pay 2م and only hold a 5م card, you must pay the 5م and lose the difference.

---

## 🏠 PROPERTY CARDS — 34 unique cards (0 duplicates)

All property cards are unique. Organized into 12 color-coded regional groups:

| Color | Region | Properties | Set Size | Rent (1/2/complete) |
|---|---|---|---|---|
| Brown | تبوك (Tabuk) | تيماء · ضباء | 2 | 1م / 2م |
| Light Purple | حائل (Ha'il) | الغزالة · الشنان | 2 | 2م / 3م |
| Pink | الجوف (Al Jouf) | القريات · طبرجل | 2 | 2م / 4م |
| Light Blue | جدة (Jeddah) | درة العروس · جدة القديمة | 2 | 2م / 4م |
| Orange | المدينة (Madinah) | خيبر · معهد الذهب · ينبع | 3 | 2م / 3م / 4م |
| Gold | الطائف (Ta'if) | الشفا · الهدا · هوازن | 3 | 1م / 2م / 3م |
| Green | عسير (Asir) | خميس مشيط · أيها · النماص | 3 | 2م / 3م / 5م |
| Red | الشرقية (Eastern Province) | الدمام · الجبيل · الخبر | 3 | 2م / 3م / 6م |
| Dark Gold | مكة المكرمة (Makkah) | مزدلفة · أجياد · عرفة | 3 | 2م / 4م / 7م |
| Dark Blue | القصيم (Qassim) | رياض الخبراء · بريدة · عنيزة | 3 | 3م / 4م / 6م |
| Yellow | جازان (Jizan) | جزر فرسان · صبيا · عريش · فيفاء | 4 | 3م / 5م / 10م |
| Navy | الرياض (Riyadh) | الجنادرية · الدوادمي · الدرعية · سدير | 4 | 2م / 3م / 4م / 8م |

---

## 🌈 WILD PROPERTY CARDS — ~14 cards

| Card | Copies | Description |
|---|---|---|
| **هلا بالجوكر!** (Universal Wild) | ×2 | Can be placed as any color property |
| Dual-color wilds (various region pairs) | ×1 each (~13 pairs) | Shows rent for both groups; player picks color on placement |

> Wild cards cannot be freely repositioned between your own sets during your turn — does cost a move.

---

## ⚡ ACTION CARDS

### 🏠 Upgrade Cards

| Card (Arabic) | Value | Copies | Effect |
|---|---|---|---|
| **بيت** (House) | 3م | ×2 | Add to any complete set to increase rent |
| **فندق** (Hotel) | 4م | ×2 | Add to a set that already has a House; further increases rent |
| **مسجد** (Mosque) | 3م | ×1 | Rent booster for Makkah set only; requires complete set |

### 💸 Rent Cards

| Card (Arabic) | Value | Copies | Effect |
|---|---|---|---|
| **الإيجار** (Rent) — per color pair | 1م | ×2 per variant | Collect rent from ALL players for one specific color group |
| **زيادة الخير** (Double Rent) | 1م | ×2 | ×2 multiplier — played alongside any rent card; counts as 2 moves |
| **طب وتخيّر** (Choose & Collect) | 3م | ×2 | Collect rent for any one of your properties from ONE chosen player |

### 🦹 Steal / Force Cards

| Card (Arabic) | Value | Copies | Effect |
|---|---|---|---|
| **عيني عينك** (Sly Deal) | 2م | ×2 | Take one property card from an opponent's set into your hand |
| **اعطيني أعطيك** (Force Deal) | 2م | ×2 | Swap one of your properties with one of an opponent's |
| **رحت فيها** (Deal Breaker) | 5م | ×2 | Steal an **entire complete set** from any player — most powerful steal |
| **هات الجوكر** (Wild Steal) | 5م | ×1 | Steal any wild card from an opponent's placed set |
| **أبرا كدبرا** (Abracadabra) | 7م | ×1 | Convert one of your complete sets to a different color; **cannot be countered** by Just Say No |

### 💰 Collect from All Players

| Card (Arabic) | Value | Copies | Effect |
|---|---|---|---|
| **طلع زكاتك** (Zakat) | 1م | ×1 | All opponents each pay you 1م |
| **شبيك لبيك** (Birthday / At Your Service) | 1م | ×1 | Collect a chosen amount from **all** players |

> ⚠️ Both "Collect from All" cards are **single copies** — no duplicates.

### 🛡️ Defense Cards

| Card (Arabic) | Value | Copies | Type | Effect |
|---|---|---|---|---|
| **تبطي عظم** (Just Say No) | 5م | ×2 | Counter | Refuse **any** action played against you |
| **أقول لا يكثر** (Weak No) | 3م | ×1 | Counter | Refuse a rent demand only (limited — cannot block steals) |
| **عدم تعرض** (Ultimate Shield) | 5م | ×1 | Shield | Protect **ALL** your properties from any theft/deal breaker for **2 full turns** |

### 🔒 Property Protection Cards

| Card (Arabic) | Value | Copies | Effect |
|---|---|---|---|
| **لا يحوشك** (Set Lock) | 5م | ×2 | Lock **one complete set** — cannot be stolen until removed |

> **عدم تعرض** (listed above under Defense) also protects all properties for 2 turns and is the strongest protection card.

### ⚙️ Utility / Extra Action Cards

| Card (Arabic) | Value | Copies | Effect |
|---|---|---|---|
| **واسطة** (Wasta / Connections) | 2م | ×2 | Take an extra turn (play again) |
| **حبتين السحب** (Draw Two) | 1م | ×2 | Draw 2 extra cards from the pile immediately |
| **خذلك غفوة** (Take a Nap) | 2م | ×1 | Skip a chosen opponent's next draw phase |
| **ورنا شطارتك** (Show Your Skill) | 2م | ×1 | Prevent a chosen player from drawing their 2 cards next turn |
| **جددها** (Renew It) | 3م | ×1 | Discard your entire hand and draw fresh cards |
| **تنقى لك** (Pick for Yourself) | 3م | ×1 | Take a property from the shared/community play area |
| **طلع الدفايات يا الطيب** (Debt Collector) | 3م | ×1 | Force one chosen player to pay you 5م |
| **أنهيييك** (I'll Finish You) | 6م | ×1 | High-value aggressive action against one player |

---

## 📊 Duplicate Summary

| Category | Has Duplicates? | Count |
|---|---|---|
| Money 1م–5م | ✅ Yes | Multiple copies (6/5/3/3/2) |
| Money 10م | ❌ No | ×1 only |
| Money 20م | ❌ No | ×1 only |
| Property cards (all cities) | ❌ No | All 34 are unique |
| Universal Wild (جوكر) | ❌ No | ×1 only |
| Dual-color wilds | ❌ No | ×1 each |
| الإيجار (Rent per color) | ✅ Yes | ×2 per color variant |
| زيادة الخير (Double Rent) | ✅ Yes | ×2 |
| طب وتخيّر (Choose & Collect) | ✅ Yes | ×2 |
| بيت (House) | ✅ Yes | ×2 |
| فندق (Hotel) | ✅ Yes | ×2 |
| مسجد (Mosque) | ❌ No | ×1 |
| عيني عينك (Sly Deal) | ✅ Yes | ×2 |
| اعطيني أعطيك (Force Deal) | ✅ Yes | ×2 |
| رحت فيها (Deal Breaker) | ✅ Yes | ×2 |
| هات الجوكر (Wild Steal) | ❌ No | ×1 |
| أبرا كدبرا (Abracadabra) | ❌ No | ×1 |
| طلع زكاتك (Zakat) | ❌ No | ×1 |
| شبيك لبيك (Birthday) | ❌ No | ×1 |
| تبطي عظم (Just Say No) | ✅ Yes | ×2 |
| أقول لا يكثر (PROPA No) | ❌ No | ×1 |
| عدم تعرض (Ultimate Shield) | ❌ No | ×1 |
| لا يحوشك (Set Lock) | ✅ Yes | ×2 |
| واسطة (Extra Turn) | ✅ Yes | ×2 |
| حبتين السحب (Draw Two) | ✅ Yes | ×2 |
| All other utility cards | ❌ No | ×1 each |

---

## 🎮 Key Rules Summary

- **Turn:** Draw 2 cards, play up to 3 moves (place property, play action, add to bank)
- **Win:** First to collect 3 complete property sets of **different colors**
- **No Fakka (فكة):** No change given — overpayment is lost
- **Wild card repositioning:** does consume a move
- **Just Say No chain:** A countered Just Say No can itself be countered by another Just Say No
- **عدم تعرض** activates on placement and lasts 2 of the opponent's turns
- **أبرا كدبرا** converts a complete set to a new color and cannot be blocked

---

*Reference compiled from: official Jawaker rules page + OCR analysis of card images — February 2026*
