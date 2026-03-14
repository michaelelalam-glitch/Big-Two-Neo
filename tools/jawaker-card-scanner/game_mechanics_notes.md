# Saudi Deal — Game Mechanics Observations
> Seeded manually from card reference + gameplay screenshots | To be enriched automatically by scanner.py

---

## Overview

| Property | Value |
|---|---|
| Platform | Jawaker (jawaker.com / BlueStacks) |
| Players | 4 |
| Win Condition | First to collect **3 complete property sets** of **different colors** |
| Moves per turn | Up to **3 moves** per turn (after drawing 2 cards) |
| Total cards (estimated) | ~110–120 |
| No-change rule (فكة) | Overpayment is lost — no change given |
| Set sizes | 2, 3, or 4 properties depending on region/color |
| colors / regions | 12 |

---

## Turn Structure (confirmed)

1. **Draw phase** — active player draws **2 cards** from the deck
2. **Action phase** — player plays up to **3 moves**:
   - Place a property card on the board → 1 move
   - Play an action card → 1 move
   - Place a card in the bank (as money) → 1 move
3. Turn passes clockwise to the next player

> **Move counter UI:** shown as `X/3` next to the active player's avatar (e.g. `0/3`, `1/3`, `2/3`).  
> **واسطة** (Wasta) grants an extra turn without resetting the move counter.

---

## Board Layout (from screenshots)

```
┌──────────────────────────────────────────────────────────────┐
│  HEADER: "Saudi Deal" title + notification bell + menu       │
├──────────────┬───────────────────────────────────────────────┤
│  AVATAR      │  OPP PROPERTY GRID (3×3 or 4×3 face-down)    │
│  NAME        │  (top section — opponent's placed properties) │
│  BANK: XXم  │                                               │
│  MOVE: X/3   │                                               │
├──────────────┴───────────────────────────────────────────────┤
│              PLAYED CARD / NOTIFICATION ZONE (center)        │
│  (card played this turn appears here, overlays appear here)  │
├──────────────────────────────────────────────────────────────┤
│  OWN PROPERTY GRID (2 rows × 5–6 columns)                   │
│  (own placed property cards — color-coded)                   │
├──────────────────────────────────────────────────────────────┤
│  HAND STRIP (bottom) — horizontally scrollable held cards    │
│  Each card shows: value badge (p1–p10) + name + description  │
└──────────────────────────────────────────────────────────────┘
```

---

## Card Value System

| Badge | Monetary Value | Role |
|---|---|---|
| p1 | 1 Million | Very common money / low-value actions |
| p2 | 2 Million | Common actions |
| p3 | 3 Million | Mid-value actions |
| p4 | 4 Million | Mid-value properties / actions |
| p5 | 5 Million | Strong defense / steal cards |
| p7 | 7 Million | Rare high-power cards (e.g. أبرا كدبرا) |
| p10 | 10 Million | Money card only |
| p20 | 20 Million | Money card only (single copy) |

> If you cannot pay exactly, you pay the next highest card you hold and **lose the difference**.

---

## Property Board Rules (observed)

- Each player has **2 rows** of property slots on their half of the board
- Properties are placed **face-up** with color-coded card backs
- A **complete set** is formed when all required properties of one color are placed
- Once complete, **upgrade cards** (بيت / فندق / مسجد) can be placed on the set
- The set indicator (color strip) on the board changes when a set is complete
- Board colors observed in gameplay (from property card backs):
  - White/blank = empty slot
  - Green strip (عسير / Asir)
  - Red strip (الشرقية / Eastern)
  - Blue strip (جدة / Jeddah or القصيم)
  - Orange strip (المدينة / Madinah)
  - Brown strip (تبوك / Tabuk)
  - Gold/Yellow strip (الطائف / Ta'if or جازان / Jizan)
  - Dark Gold (مكة)
  - Navy (الرياض)
  - Pink (الجوف)
  - Light Purple (حائل)
  - Cyan strip (جدة القديمة / Light Blue)

---

## Payment Flow (confirmed from overlays)

1. **Rent card played** → notification appears on target player screen
2. **لا يوجد لديك بطاقات تحميك** = "You have no defense cards" → payment forced
3. Player pays from **bank cards** (money pile on the right of avatar)
4. **No-change rule**: if you owe 2م but have only a 5م → pay 5م, lose 3م
5. **Order of payment** for all-player rent: each player pays in turn order

---

## Notification Overlay System

| Trigger | Text shown |
|---|---|
| A card is played against you | "لعبت هذه الورقة ضدك" |
| You have no defense cards | "لا يوجد لديك بطاقات تحميك" |
| Swap card played | Shows both players' hands side-by-side with arrow |
| Auction card | Shows property card with price + arrow to buyer |
| Shield active | Shield icon + "أحمِ أراضيك من السرقة لدورين" |
| Property stolen | Card moves from one side to the other with animation |

---

## Defense / Counter System (observed)

| Counter Card | Can Block |
|---|---|
| **تبطي عظم** (Just Say No) | Any action against you |
| **بالمشمش** (No Way) | Any action against you (single-use) |
| **أقول لا يكثر** (Weak No) | Rent demands only |
| **تغد بهم قبل يتعشون فيك** (Reversal) | Payment demands — reverses payment back onto attacker |
| **عدم تعرض** (Ultimate Shield) | Protects ALL properties for 2 full turns |
| **لا يحوشك** (Set Lock) | Protects one complete set permanently until removed |

> **Chain rule:** A countered Just Say No can itself be countered by another Just Say No.

---

## Action Card Play Rules (observed)

- Action cards are played from hand → count as **1 move**
- Some cards require choosing a target player (tap their avatar / property)
- **زيادة الخير** (Double Rent) is played ON TOP of a rent card → counts as +1 move (total 2 moves for that combo)
- **واسطة** grants an extra turn but the card played to trigger it still counts as 1 move
- **أبرا كدبرا** (Abracadabra) cannot be countered by any Just Say No — it always resolves

---

## Steal Cards — Rule Distinctions

| Card | Targets | Requires Payment? | Set must be incomplete? |
|---|---|---|---|
| عيني عينك (Sly Deal) | 1 property | No | Yes — not in complete set |
| اعطيني أعطيك (Force Deal) | 1 property (swap) | No | Yes — not in complete set |
| رحت فيها (Deal Breaker) | Entire complete set | No | No — targets COMPLETE set |
| ازرررررف (Run!) | 1 property | No | Yes — not in complete set |
| تمت المصادرة (Confiscation) | 1 property | No | Yes — not in complete set |
| سوق الهوامير (Auction) | 1 property | Yes — at printed value | Yes — not in complete set |
| هات الجوكر (Wild Steal) | 1 wild card only | No | — |

---

## Win Condition Flow

1. Player completes their **3rd property set** of a unique color
2. Game immediately ends — winner announced
3. Remaining players' banks + property values are NOT counted (no scoring)
4. Win is binary: **first to 3 complete sets wins**

> Observed UI: small counter `X/3` visible near player avatar during gameplay.

---

## Unknowns Still Pending

| Item | Notes |
|---|---|
| Card name for Blind Steal | Effect confirmed: take random card from any player's hand |
| Card name for Move Limiter | Effect confirmed: target's next turn limited to 1 move |
| **قال انفخ يا شريم / قال ما هن برطم** full effect | Card seen in screenshots but description not fully OCR'd |
| **تواكر** | Seen by OCR — unknown if property or action card |
| **أرض معنا ولا منا؟** | May be same card as جاك يا مهنا ما تتمنى or separate variant |
| Exact deck composition (copy counts per card) | Need more gameplay sessions |
| Wild card pair combinations (13 dual-color wilds) | Specific pairs not all confirmed |

---

*Seeded from: card reference file + gameplay screenshots (Feb–Mar 2026)*  
*Auto-enriched by: scanner.py game_events.json observations*
