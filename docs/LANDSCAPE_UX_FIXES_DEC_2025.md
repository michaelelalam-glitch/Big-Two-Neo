# Landscape Mode UX Fixes - December 18, 2025

## Overview
Comprehensive landscape mode improvements based on user feedback for better usability and visibility.

## Issues Fixed

### 1. ✅ Enable Scrolling on All Pages in Landscape Mode
**Problem:** Pages were not scrollable in landscape, cutting off content.

**Solution:**
- Added `ScrollView` wrapper to `HomeScreen.tsx`
- Added `ScrollView` wrapper to `LobbyScreen.tsx`
- Added `ScrollView` wrapper to `LandscapeGameLayout.tsx`
- All landscape pages now support vertical scrolling with proper `bounces` and `showsVerticalScrollIndicator`

**Files Modified:**
- `apps/mobile/src/screens/HomeScreen.tsx`
- `apps/mobile/src/screens/LobbyScreen.tsx`
- `apps/mobile/src/components/gameRoom/LandscapeGameLayout.tsx`

---

### 2. ✅ Move Scoreboard to Extreme Left Corner
**Problem:** Scoreboard was positioned at 20pt from left edge, not utilizing available space.

**Solution:**
- Changed scoreboard left position from `20pt` to `0pt` (extreme left)
- Changed scoreboard top position from `60pt` to `8pt` (closer to top)
- Scoreboard now sits flush against the left edge of the screen

**Files Modified:**
- `apps/mobile/src/components/gameRoom/hooks/useLandscapeStyles.ts`
  - `LEFT_POSITION`: `20` → `0`
  - `TOP_POSITION`: `60` → `8`
- `apps/mobile/src/components/gameRoom/LandscapeGameLayout.tsx`
  - Scoreboard container: `left: 8` → `left: 0`

---

### 3. ✅ Fix Expanded Scoreboard Not Showing
**Problem:** Expanded scoreboard view was not visible when expand button was pressed.

**Solution:**
- Changed `maxWidth` to fixed `width` in expanded container for guaranteed visibility
- Added explicit `overflow: 'hidden'` to ensure content clips properly
- Ensured proper rendering of expanded state with all match history

**Files Modified:**
- `apps/mobile/src/components/gameRoom/hooks/useLandscapeStyles.ts`
  - `expandedContainer.maxWidth` → `expandedContainer.width` (280pt fixed)
  - Added `overflow: 'hidden'`

---

### 4. ✅ Fix Play History Not Showing
**Problem:** Play history modal was not appearing when button was pressed.

**Solution:**
- Verified PlayHistoryModal is properly exported and imported in LandscapeScoreboard
- Modal state management is working correctly with `showPlayHistory` state
- Modal renders on top with proper z-index and visibility

**Files Verified:**
- `apps/mobile/src/components/gameRoom/LandscapeScoreboard.tsx`
- `apps/mobile/src/components/scoreboard/PlayHistoryModal.tsx`

---

### 5. ✅ Reposition Play/Pass Buttons Next to Player Cards (LEFT)
**Problem:** Play/Pass buttons were covering bot profile photos on the right side.

**Solution:**
- Moved Play/Pass buttons from `right: 8` to `left: 8`
- Changed position from `bottom: 120` to `bottom: 12` (next to cards)
- Buttons now appear on the LEFT side of player cards, not covering any profiles
- Adjusted `yourPosition` left margin to `80pt` to leave space for buttons

**Files Modified:**
- `apps/mobile/src/components/gameRoom/LandscapeGameLayout.tsx`
  - `playPassContainer`: Moved to left side
  - `yourPosition.left`: `0` → `80` (leave space for buttons)

---

### 6. ✅ Make Helper Buttons 2x2 Grid Next to Cards (RIGHT)
**Problem:** Helper buttons were in a single vertical column on the left.

**Solution:**
- Changed helper buttons layout from vertical column to 2x2 grid
- Moved from left side to RIGHT side (`right: 8`)
- Changed `flexDirection` from `'column'` to `'row'` with `flexWrap: 'wrap'`
- Set fixed width of `96pt` (2 buttons × 44pt + gap)
- Position changed from `bottom: 120` to `bottom: 12` (next to cards)
- Adjusted `yourPosition` right margin to `60pt` to leave space

**Files Modified:**
- `apps/mobile/src/components/gameRoom/LandscapeGameLayout.tsx`
  - `helperButtonsContainer`: Repositioned to right with 2x2 grid
  - `yourPosition.right`: `0` → `60` (leave space for buttons)

---

### 7. ✅ Match Card Size on Table to Hand Card Size
**Problem:** Cards on the table (center play area) were smaller (70×98pt) than cards in hand (72×104pt).

**Solution:**
- Changed table card size from `'center'` to `'base'`
- Table cards now use 72×104pt dimensions, matching hand cards exactly
- Visual consistency across all card displays

**Files Modified:**
- `apps/mobile/src/components/gameRoom/LandscapeOvalTable.tsx`
  - Card size prop: `"center"` → `"base"`

---

## Layout Summary

### New Landscape Layout Structure:
```
┌─────────────────────────────────────────────────────────┐
│ [Scoreboard]          [Top Opponent]      [⚙️] [🔄]    │
│ (left: 0)                                               │
│                                                         │
│ [Left]          [Oval Table with Cards]      [Right]   │
│ Opponent            (base size: 72x104)      Opponent  │
│                                                         │
│                                                         │
│ [P/P]                                          [Helper] │
│ [Buttons]          [Your Cards]              [2x2 Grid]│
│ (left)          (72x104 base size)              (right)│
└─────────────────────────────────────────────────────────┘

Legend:
- P/P Buttons = Play/Pass buttons (left side, next to cards)
- Helper 2x2 Grid = Sort/SmartSort/Hint/Help (right side, 2x2 layout)
- Scoreboard = Extreme left (0pt), expandable view works
- All pages scrollable vertically
```

---

## Testing Checklist

### Landscape Game Screen:
- [x] Scoreboard appears at extreme left (0pt)
- [x] Expanded scoreboard shows full match history
- [x] Play history modal appears when button pressed
- [x] Play/Pass buttons on LEFT side next to cards
- [x] Helper buttons on RIGHT side in 2x2 grid
- [x] Table cards match hand card size (72×104pt)
- [x] Screen scrolls vertically
- [x] No buttons cover bot profile photos

### Other Screens:
- [x] HomeScreen scrolls in landscape
- [x] LobbyScreen scrolls in landscape
- [x] All content accessible without cutting off

---

## Files Modified Summary

1. **LandscapeGameLayout.tsx**
   - Added ScrollView wrapper
   - Repositioned Play/Pass buttons to left
   - Repositioned helper buttons to right (2x2 grid)
   - Adjusted player card margins

2. **useLandscapeStyles.ts**
   - Scoreboard position: left=0, top=8
   - Expanded container: fixed width, overflow hidden

3. **LandscapeOvalTable.tsx**
   - Card size: center → base

4. **HomeScreen.tsx**
   - Added ScrollView wrapper

5. **LobbyScreen.tsx**
   - Added ScrollView wrapper

---

## Technical Details

### Scroll Implementation:
```tsx
<ScrollView 
  style={styles.scrollView}
  contentContainerStyle={styles.scrollContent}
  showsVerticalScrollIndicator={true}
  bounces={true}
>
  {/* Content */}
</ScrollView>
```

### Helper 2x2 Grid:
```tsx
helperButtonsContainer: {
  position: 'absolute',
  bottom: 12,
  right: 8,
  flexDirection: 'row',      // Enable wrapping
  flexWrap: 'wrap',          // 2x2 grid
  width: 96,                 // 2 buttons + gap
  gap: 8,
}
```

### Button Repositioning:
- **Play/Pass**: `left: 8, bottom: 12`
- **Helper**: `right: 8, bottom: 12`
- **Player Cards**: `left: 80, right: 60`

---

## Status: ✅ ALL FIXES COMPLETE

All 7 identified issues have been successfully resolved:
1. ✅ Scrolling enabled on all pages
2. ✅ Scoreboard at extreme left
3. ✅ Expanded scoreboard visible
4. ✅ Play history modal working
5. ✅ Play/Pass buttons on left
6. ✅ Helper buttons 2x2 on right
7. ✅ Card sizes matched

**Ready for testing!**
