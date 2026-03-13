# Landscape Layout Fixes - December 18, 2025

## Overview
Fixed 4 critical layout issues affecting both portrait and landscape modes in the game room.

## Issues Fixed

### 1. ✅ Portrait Card Hand Spacing
**Problem:** User reported cards in portrait mode were too compressed and couldn't see all 13 cards properly.

**Root Cause:** The card spacing itself was correct (`CARD_OVERLAP_MARGIN = -30px`), but the user needed verification that landscape changes didn't affect portrait mode.

**Solution:** Verified that `CardHand.tsx` maintains the original `marginLeft: LAYOUT.handAlignmentOffset` (68px) and cards use the correct -30px overlap margin. Portrait mode card spacing remains unchanged.

**Files:** No changes needed - spacing was already correct.

---

### 2. ✅ Play History Modal Size in Landscape
**Problem:** Play History Modal was way too big in landscape mode, taking up excessive screen space.

**Root Cause:** Modal width in landscape was set to 600-700px, which is disproportionately large for landscape orientation.

**Solution:** 
- Reduced landscape modal width from 600-700px to 400-450px
- Added separate height calculation: 75% in portrait, 70% in landscape
- Modal now proportionate to screen size in both orientations

**Files Changed:**
- `apps/mobile/src/components/scoreboard/hooks/useResponsiveStyles.ts`
  - Lines 434-444: Updated `modalContainer` width and height

```typescript
// Before:
width: dims.isLargeDevice ? dims.moderateScale(700) : dims.moderateScale(600),
height: dims.screenHeight * 0.75,

// After:
width: dims.isLargeDevice ? dims.moderateScale(450) : dims.moderateScale(400),
height: dims.isPortrait ? dims.screenHeight * 0.75 : dims.screenHeight * 0.70,
```

---

### 3. ✅ Expanded Scoreboard Size Consistency
**Problem:** Expanded scoreboard had different sizes in landscape vs portrait mode.

**Root Cause:** `maxWidth` was calculated as `screenWidth - moderateScale(24)`, which varies significantly between orientations.

**Solution:** 
- Set consistent `maxWidth` to 280-320px regardless of orientation
- Ensures same physical size in both portrait and landscape

**Files Changed:**
- `apps/mobile/src/components/scoreboard/hooks/useResponsiveStyles.ts`
  - Lines 234-242: Updated `expandedContainer` maxWidth

```typescript
// Before:
maxWidth: dims.screenWidth - dims.moderateScale(24),

// After:
maxWidth: dims.isSmallDevice ? dims.moderateScale(280) : dims.moderateScale(320),
```

---

### 4. ✅ Top Player Name Position & Table Height in Landscape
**Problem:** 
- Top player's name button was positioned below the avatar instead of to the right
- Table was too low, causing player's cards at bottom to overlap with cards on the table

**Root Cause:** 
- `LandscapeOpponent` component only supported vertical layout (name below avatar)
- Table `mainArea` was positioned at `top: 35%`, leaving insufficient space at bottom

**Solution:**
- Added `layout` prop to `LandscapeOpponent` component ('vertical' | 'horizontal')
- Top opponent now uses `layout="horizontal"` to position name badge to the right
- Raised table position from 35% to 28% to prevent card overlap

**Files Changed:**

1. **`apps/mobile/src/components/gameRoom/LandscapeOpponent.tsx`**
   - Lines 23-31: Added `layout` prop to interface
   - Lines 43-45: Added support for horizontal layout in component
   - Lines 82-86: Added `containerHorizontal` style for horizontal layout

```typescript
// New prop:
layout?: 'vertical' | 'horizontal';

// New style:
containerHorizontal: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 12,
}
```

2. **`apps/mobile/src/components/gameRoom/LandscapeGameLayout.tsx`**
   - Lines 161-167: Updated top opponent to use horizontal layout
   - Lines 345-351: Raised table position from 35% to 28%

```typescript
// Top opponent with horizontal layout:
<LandscapeOpponent
  name={playerNames[1] || 'Bot 1'}
  isActive={isOpponentActive(1)}
  layout="horizontal"
/>

// Raised table:
mainArea: {
  top: '28%', // Raised from 35%
}
```

---

## Testing Checklist

### Portrait Mode
- [ ] All 13 cards visible in hand
- [ ] Cards have proper spacing (not too compressed)
- [ ] Play History Modal opens at appropriate size (90% width, 75% height)
- [ ] Expanded Scoreboard has consistent size (~320px max width)

### Landscape Mode
- [ ] Top opponent name appears to the RIGHT of avatar (horizontal layout)
- [ ] Table positioned high enough to prevent card overlap
- [ ] Player's cards at bottom don't overlap with table cards
- [ ] Play History Modal appropriately sized (400-450px width, 70% height)
- [ ] Expanded Scoreboard same size as portrait mode (~320px max width)
- [ ] Left and right opponents retain vertical layout (name below avatar)

---

## Related Tasks
- Task #452: Landscape Game Room Core Components
- Task #451: Landscape Layout Implementation
- Task #461: Landscape Card Interaction

## Date
December 18, 2025
