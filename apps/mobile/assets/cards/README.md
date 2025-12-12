# Playing Card Assets

## Overview
This directory contains all 52 standard playing card SVG files downloaded from tekeye.uk.

## Source
Cards downloaded from: https://www.tekeye.uk/playing_cards/images/svg_playing_cards/fronts/

## Format
- **File naming:** `{suit}_{rank}.svg`
- **Suits:** hearts, diamonds, clubs, spades
- **Ranks:** ace, 2, 3, 4, 5, 6, 7, 8, 9, 10, jack, queen, king

## Total Files
52 SVG files (13 ranks × 4 suits)

## Usage in Code
Cards are accessed via the `cardAssets.ts` utility:

```typescript
import { getCardAsset } from '@/utils/cardAssets';

// Get card asset by game format (rank, suit)
const aceOfSpades = getCardAsset('A', 'S');
const tenOfHearts = getCardAsset('10', 'H');
```

## Card Mapping
Game format → Asset format:
- **Suits:** H → hearts, D → diamonds, C → clubs, S → spades
- **Ranks:** A → ace, 2-10 → 2-10, J → jack, Q → queen, K → king

## Examples
- `A` + `S` → `spades_ace.svg`
- `10` + `H` → `hearts_10.svg`
- `K` + `D` → `diamonds_king.svg`
- `3` + `C` → `clubs_3.svg`

## Re-downloading
To re-download all cards:
```bash
cd assets/cards
./download_cards.sh
```

## License
Cards are from tekeye.uk public domain playing cards collection.
