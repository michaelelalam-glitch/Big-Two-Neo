# Critical Bug Fixes - December 18, 2025

## Overview
Fixed 4 critical issues affecting game functionality and layout in both portrait and landscape modes.

---

## ✅ Issue 1: VirtualizedLists Nesting Error

**Problem:** 
Console error: "VirtualizedLists should never be nested inside plain ScrollViews with the same orientation because it can break windowing and other functionality"

**Root Cause:**
In `LobbyScreen.tsx`, a `FlatList` component (line 439) was nested inside a `ScrollView` (line 408). React Native forbids this because both components handle vertical scrolling, causing conflicts.

**Solution:**
Replaced `ScrollView` with a plain `View` container. The `FlatList` handles its own scrolling, so the outer `ScrollView` was unnecessary and caused the error.

**Files Changed:**
- `apps/mobile/src/screens/LobbyScreen.tsx`
  - Lines 406-413: Changed `<ScrollView>` to `<View>`
  - Line 487: Changed `</ScrollView>` to `</View>`

```typescript
// Before:
<ScrollView 
  style={styles.scrollView}
  contentContainerStyle={styles.scrollContent}
  showsVerticalScrollIndicator={true}
  bounces={true}
>

// After:
<View style={styles.scrollView}>
```

**Result:** ✅ VirtualizedLists error eliminated

---

## ✅ Issue 2: Portrait Mode - Can't See All 13 Cards

**Problem:**
In portrait mode, the user couldn't see all 13 cards in their hand. Cards were pushed off-screen or compressed.

**Root Cause:**
The `cardsWrapper` style in `CardHand.tsx` had `marginLeft: LAYOUT.handAlignmentOffset` (68px), which pushed the entire card hand to the right, causing cards to be cut off on the left side of the screen.

**Solution:**
Removed the `marginLeft: LAYOUT.handAlignmentOffset` from the `cardsWrapper` style. The cards now center properly using `justifyContent: 'center'` without any offset.

**Files Changed:**
- `apps/mobile/src/components/game/CardHand.tsx`
  - Lines 391-397: Removed `marginLeft` offset

```typescript
// Before:
cardsWrapper: {
  flexDirection: 'row',
  paddingHorizontal: SPACING.lg,
  paddingVertical: SPACING.md,
  alignItems: 'center',
  justifyContent: 'center',
  marginLeft: LAYOUT.handAlignmentOffset, // 68px offset - REMOVED
}

// After:
cardsWrapper: {
  flexDirection: 'row',
  paddingHorizontal: SPACING.lg,
  paddingVertical: SPACING.md,
  alignItems: 'center',
  justifyContent: 'center', // Cards now center without offset
}
```

**Result:** ✅ All 13 cards now visible in portrait mode with proper card overlap (-30px)

---

## ✅ Issue 3: Landscape Table Position Too Low

**Problem:**
In landscape mode, the table (oval green area) was positioned too low, leaving a large gap between the top player's avatar and the table. The user requested the table to "touch the bottom of the top centre player's profile circle."

**Root Cause:**
The `mainArea` (table container) was positioned at `top: '28%'`, which left too much space above the table.

**Solution:**
Raised the table position from `28%` to `18%` so it touches the bottom of the top player's avatar circle.

**Files Changed:**
- `apps/mobile/src/components/gameRoom/LandscapeGameLayout.tsx`
  - Lines 345-351: Changed `top` from `'28%'` to `'18%'`

```typescript
// Before:
mainArea: {
  position: 'absolute',
  top: '28%', // Too low
  left: 0,
  right: 0,
  alignItems: 'center',
  zIndex: 3,
}

// After:
mainArea: {
  position: 'absolute',
  top: '18%', // Touches bottom of top player avatar
  left: 0,
  right: 0,
  alignItems: 'center',
  zIndex: 3,
}
```

**Result:** ✅ Table now touches bottom of top player's avatar in landscape mode

---

## ✅ Issue 4: Player Name Button Styling in Landscape

**Problem:**
In landscape mode, the player's name "Steve Peterson" was displayed as plain white text, while the bot names appeared in styled buttons with background, border, and rounded corners. The user wanted consistent styling.

**Root Cause:**
The `LandscapeYourPosition` component displayed the player name using simple `<Text>` styles (`playerName`, `playerNameActive`), while the `LandscapeOpponent` component used proper button-style badges (`nameBadge`, `nameBadgeActive`).

**Solution:**
Replaced the plain text styling with button badge styling that matches:
- Semi-transparent black background: `rgba(0, 0, 0, 0.6)`
- White border (2px): `borderColor: COLORS.white`
- Green border when active: `borderColor: COLORS.success`
- Rounded corners: `borderRadius: 20`
- Padding: `paddingVertical: 6, paddingHorizontal: 16`

**Files Changed:**
- `apps/mobile/src/components/gameRoom/LandscapeYourPosition.tsx`
  - Lines 228-238: Replaced plain text with button badge in main render
  - Lines 214-223: Fixed empty state to use button badge
  - Lines 300-322: Replaced `playerName` and `playerNameActive` styles with `nameBadge`, `nameBadgeActive`, and `nameText` styles

```typescript
// Before (plain text):
<View style={styles.playerInfo}>
  <Text style={[styles.playerName, isActive && styles.playerNameActive]}>
    {playerName}
  </Text>
</View>

playerName: {
  fontSize: 16,
  fontWeight: '600',
  color: COLORS.white,
}

// After (button badge):
<View style={styles.playerInfo}>
  <View style={[
    styles.nameBadge,
    isActive && styles.nameBadgeActive,
  ]}>
    <Text style={styles.nameText} numberOfLines={1}>
      {playerName}
    </Text>
  </View>
</View>

nameBadge: {
  backgroundColor: 'rgba(0, 0, 0, 0.6)',
  paddingVertical: 6,
  paddingHorizontal: 16,
  borderRadius: 20,
  borderWidth: 2,
  borderColor: COLORS.white,
  minWidth: 80,
  alignItems: 'center',
}

nameBadgeActive: {
  borderColor: COLORS.success, // Green border when active
}
```

**Result:** ✅ Player name now appears in same styled button as bot names in landscape mode

---

## Testing Checklist

### Portrait Mode
- [x] All 13 cards visible and properly spaced
- [x] Cards use -30px overlap (standard)
- [x] Cards centered horizontally without offset
- [x] No VirtualizedLists error in lobby

### Landscape Mode
- [x] Table touches bottom of top player's avatar
- [x] Player name appears in button badge (matches bot styling)
- [x] Name badge has white border (green when active)
- [x] Table properly positioned with minimal gap above

### Lobby Screen
- [x] No VirtualizedLists nesting error
- [x] Player list scrolls properly
- [x] All UI elements functional

---

## Summary of Changes

| File | Change | Lines |
|------|--------|-------|
| `LobbyScreen.tsx` | Replace ScrollView with View | 406-413, 487 |
| `CardHand.tsx` | Remove marginLeft offset | 391-397 |
| `LandscapeGameLayout.tsx` | Raise table from 28% to 18% | 345-351 |
| `LandscapeYourPosition.tsx` | Add button badge styling | 214-238, 300-322 |

---

## Related Tasks
- Task #452: Landscape Game Room Core Components
- Task #451: Landscape Layout Implementation
- Task #461: Landscape Card Interaction

## Date
December 18, 2025
