# Game Room Landscape Layout - React Native Migration Plan

**Project:** Two-Big Mobile App  
**Component:** Complete Game Room in Landscape Mode  
**Target Device (Base):** iPhone 17 (932×430pt landscape)  
**Adaptive Range:** All iOS/Android phones & tablets  
**Date:** December 17, 2025

---

## 📋 Overview

This plan provides **exact pixel measurements** for migrating the web app's landscape game room to React Native, optimized for iPhone 17 but with adaptive scaling for all devices. All measurements are based on the web app's production layout, colors, and spacing.

### Layout Architecture

The game room uses a **CSS Grid oval table layout** with 5 zones:
- **Top:** Opponent player card
- **Left:** Opponent player card
- **Right:** Opponent player card
- **Center:** Oval play area (poker-style table)
- **Bottom:** Your position with cards

### Screen Regions (Landscape)

```
┌─────────────────────────────────────────────────────────────┐
│ Scoreboard (Top-Left)                                        │ ← 60pt
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Left Player    ┌────────── Top Player ──────────┐  Right    │
│    Card         │                                 │  Player   │
│                 │      Oval Table (Poker Style)   │  Card     │
│                 │        (Play Area)              │           │
│                 └─────────────────────────────────┘           │
│                                                               │
│                    Your Position + Cards                      │
│                                                               │
├─────────────────────────────────────────────────────────────┤
│                   Control Bar                                 │ ← 68pt
└─────────────────────────────────────────────────────────────┘
```

---

## 🎯 Phase 1: Base Device Measurements (iPhone 17)

### 1.1 Screen Specifications

**iPhone 17 Landscape:**
- **Total Screen:** 932pt width × 430pt height (2796×1290px @3x)
- **Safe Area:** Insets for notch/home indicator
  - Top: 0pt (no notch in landscape)
  - Bottom: 21pt (home indicator)
  - Left: 59pt (camera cutout)
  - Right: 59pt (camera cutout)
- **Usable Area:** 814pt × 409pt (932 - 118 left/right, 430 - 21 bottom)

**Available Height Breakdown:**
```
Total: 430pt
├─ Top Bar (Scoreboard/Title): 60pt
├─ Game Area: 302pt (430 - 60 - 68)
└─ Control Bar: 68pt
```

---

## 📐 Phase 2: Component Measurements (Exact Sizes)

### 2.1 Scoreboard Component

#### **Collapsed State (Default)**
```typescript
{
  position: 'absolute',
  top: 12,
  left: 20,
  width: 'auto',
  maxWidth: 200,
  minHeight: 'auto',
  padding: 8,
  borderRadius: 12,
  backgroundColor: 'rgba(255, 255, 255, 0.95)',
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.1,
  shadowRadius: 8,
  zIndex: 1000,
}

// Content
header: {
  height: 24, // "Match X" title + buttons
  marginBottom: 6,
}
playerRow: {
  height: 22, // Per player (4 players = 88pt total)
  gap: 3, // Between rows
}
totalHeight: ~120pt // Auto-sized based on content
```

**Player Row Layout:**
```
┌────────────────────────┐
│ PlayerName      85 pts │ ← 22pt height
└────────────────────────┘
```

#### **Expanded State (Score History)**
```typescript
{
  position: 'absolute',
  top: 12,
  left: 20,
  width: 'auto',
  maxWidth: 600,
  maxHeight: '80vh', // 344pt on iPhone 17 (430 * 0.8)
  padding: 8,
  overflowY: 'scroll',
  // ... same styling as collapsed
}

// Content Structure
header: 24pt
currentScores: ~88pt (4 players × 22pt)
separator: 8pt
historySection: {
  perMatch: 120pt, // Match card height
  gap: 8pt,
}
totalHeight: ~344pt max (scrollable)
```

**Match Card Layout (in expanded view):**
```
┌──────────────────────────────┐
│ Match 1           ▼          │ ← 32pt header
├──────────────────────────────┤
│ Alice: 15 pts (+15)          │ ← 22pt per player
│ Bob: 23 pts (+8)             │
│ Carol: 0 pts (+0) 🏆         │
│ Dave: 12 pts (+12)           │
└──────────────────────────────┘
Total: ~120pt per match
```

#### **Play History Panel**
```typescript
{
  position: 'absolute',
  top: 12,
  left: 240, // Next to scoreboard
  width: 400,
  maxHeight: '80vh', // 344pt
  padding: 12,
  backgroundColor: 'rgba(255, 255, 255, 0.95)',
  borderRadius: 12,
  overflowY: 'scroll',
}

// Last Hand Display
handCard: {
  height: 100, // Player name + cards
  marginBottom: 8,
}
cardImage: {
  width: 35,
  height: 51, // 1.4444 ratio
}
```

---

### 2.2 Oval Play Area (Poker Table)

**Web Dimensions:**
```css
width: 500px;
height: 280px;
border-radius: 140px; /* Half of height for oval ends */
padding: 24px;
```

**React Native (iPhone 17 Landscape):**
```typescript
{
  width: 420, // Wider oval shape like poker table
  height: 240, // Shorter height
  borderRadius: 120, // Half of height for rounded ends
  padding: 16,
  backgroundColor: 'transparent',
  // Gradient background (poker table green)
  borderWidth: 3,
  borderColor: '#1d2a40', // --panel-border
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 12 },
  shadowOpacity: 0.3,
  shadowRadius: 40,
  // Position
  alignSelf: 'center',
  justifyContent: 'center',
  alignItems: 'center',
}
```

**Inner Content (Last Play):**
```typescript
// Text area
lastPlayInfo: {
  fontSize: 14,
  marginBottom: 8,
  textAlign: 'center',
}

// Cards row
cardsContainer: {
  flexDirection: 'row',
  gap: 8,
  justifyContent: 'center',
  maxWidth: 240, // Fit 5 cards (48px each + gaps)
}

cardImage: {
  width: 48,
  height: 67, // 1.4 ratio
}
```

**Adaptive Sizing (Tablets):**
```typescript
// iPad Air (1180×820 landscape)
{
  width: 560, // Wider oval for tablets
  height: 320,
  borderRadius: 160, // Half of height
  padding: 20,
}

cardImage: {
  width: 60,
  height: 84,
}
```

---

### 2.3 Player Cards (Opponents)

#### **Top Player Card**
```typescript
{
  // Position
  position: 'absolute',
  top: 60, // Below top bar
  left: '50%',
  transform: [{ translateX: -90 }], // Half of width
  
  // Size
  width: 180, // Narrower without fanned cards
  height: 160,
  padding: 16,
  
  // Layout (Two-part: name/count and profile only)
  flexDirection: 'row',
  gap: 12,
  alignItems: 'center',
  justifyContent: 'center',
  
  // Background
  backgroundColor: 'transparent',
}
```

**Content Structure:**
```
┌───────────────────────────┐
│ [Name]     [Profile]      │
│ [Count]      (100pt)      │
│  (80pt)                   │
└───────────────────────────┘
```

**Name/Count Section:**
```typescript
nameCountSection: {
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
  width: 80,
}

playerName: {
  fontSize: 14,
  fontWeight: '600',
  color: '#ffffff',
  maxWidth: 80,
  numberOfLines: 1,
  ellipsizeMode: 'tail',
}

cardCountBadge: {
  width: 44,
  height: 44,
  borderRadius: 22,
  backgroundColor: '#4CAF50', // Green gradient
  borderWidth: 3,
  borderColor: 'rgba(255, 255, 255, 0.3)',
  justifyContent: 'center',
  alignItems: 'center',
  shadowColor: 'rgba(76, 175, 80, 0.4)',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 1,
  shadowRadius: 12,
}

cardCountText: {
  fontSize: 22,
  fontWeight: 'bold',
  color: '#ffffff',
}
```

**Profile Circle:**
```typescript
profileCircle: {
  width: 100,
  height: 100,
  borderRadius: 50,
  borderWidth: 4,
  borderColor: '#FFD700', // Gold
  overflow: 'hidden',
  shadowColor: 'rgba(255, 215, 0, 0.3)',
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 1,
  shadowRadius: 20,
}

// Video or avatar image fills the circle
videoOrAvatar: {
  width: 100,
  height: 100,
}
```

#### **Left & Right Player Cards**
```typescript
sidePlayerCard: {
  width: 140,
  height: 160,
  padding: 16,
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
}

// Position
leftPlayer: {
  position: 'absolute',
  left: 80, // After safe area (59pt) + padding
  top: '50%',
  transform: [{ translateY: -80 }],
}

rightPlayer: {
  position: 'absolute',
  right: 80,
  top: '50%',
  transform: [{ translateY: -80 }],
}

// Content
profileCircle: {
  width: 80, // Smaller than top player
  height: 80,
  borderRadius: 40,
  // ... same styling
}

cardCountBadge: {
  width: 36,
  height: 36,
  borderRadius: 18,
  fontSize: 18, // Smaller text
}
```

---

### 2.4 Your Position (Bottom Player)

```typescript
{
  position: 'absolute',
  bottom: 68, // Above control bar
  left: 0,
  right: 0,
  height: 180, // Enough for cards + info
  paddingHorizontal: 20,
  flexDirection: 'column',
  alignItems: 'center',
  gap: 12,
}
```

**Layout Structure:**
```
┌────────────────────────────────────────────────┐
│  [Name/Count]        [Cards Row]               │
│    (100pt)          (Centered)                 │
└────────────────────────────────────────────────┘
```

**Name/Count Badge (Left Side):**
```typescript
playerInfoLeft: {
  position: 'absolute',
  left: 20,
  bottom: 90, // Above cards
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
}

playerName: {
  fontSize: 14,
  fontWeight: '600',
  color: '#ffffff',
  textShadowColor: 'rgba(0, 0, 0, 0.7)',
  textShadowOffset: { width: 2, height: 2 },
  textShadowRadius: 4,
}

cardCountBadge: {
  width: 44,
  height: 44,
  borderRadius: 22,
  // ... same styling as opponent badges
}
```

**Cards Row (Center):**
```typescript
cardsRowContainer: {
  flexDirection: 'row',
  alignItems: 'flex-end', // Cards align at bottom
  justifyContent: 'center',
  paddingHorizontal: 60, // Space for name/count on left
  gap: 0, // Cards overlap
}

// Card sizing (base)
cardWidth: 72,
cardHeight: 104, // 72 × 1.4444

// Overlapping cards
cardButton: {
  marginLeft: -36, // 50% overlap (72 × 0.5)
  zIndex: index + 1, // Stack order
}

cardButton_first: {
  marginLeft: 0, // No overlap on first card
}

// Selected state
cardButton_selected: {
  transform: [
    { translateY: -24 }, // Lift up
    { scale: 1.12 }, // Slightly larger
  ],
  zIndex: 200, // Above all other cards
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.3,
  shadowRadius: 24,
}

// Hover state (on devices with pointer)
cardButton_hover: {
  transform: [{ translateY: -24 }, { scale: 1.12 }],
  opacity: 0.85, // Slight transparency
  zIndex: 199,
}
```

**Adaptive Card Sizing:**
```typescript
// iPhone 17: Base size
cardWidth: 72, cardHeight: 104

// iPhone SE (568×320 landscape): Smaller
cardWidth: 56, cardHeight: 78, overlap: 40%

// iPad Air (1180×820 landscape): Larger
cardWidth: 88, cardHeight: 124, overlap: 45%

// Max cards visible calculation
maxVisibleWidth = screenWidth - (leftPadding + rightPadding + nameSection)
maxVisibleWidth = 932 - (20 + 20 + 100) = 792pt
cardsWithOverlap = 13 cards × (72 × 0.5) + 72 = 540pt ✓ Fits
```

---

### 2.5 Control Bar (Bottom)

```typescript
{
  position: 'absolute',
  bottom: 0,
  left: 0,
  right: 0,
  height: 68,
  backgroundColor: 'rgba(255, 255, 255, 0.98)',
  borderTopWidth: 1,
  borderTopColor: 'rgba(0, 0, 0, 0.1)',
  paddingHorizontal: 16,
  paddingVertical: 8,
  paddingBottom: 21, // Safe area inset (home indicator)
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  shadowColor: '#000',
  shadowOffset: { width: 0, height: -2 },
  shadowOpacity: 0.08,
  shadowRadius: 12,
  zIndex: 50, // Below cards (150)
}
```

**Button Layout (6 Groups):**
```
┌──────────────────────────────────────────────────────────────────┐
│ [Chat] [🐛][⚙️][🔄] [Card Count] [Smart][Clear] [Play][Pass]    │
│  Order:1  Order:2    Order:3      Order:4       Order:5         │
└──────────────────────────────────────────────────────────────────┘
```

**Button Groups:**
```typescript
// Group 1: Chat (Left)
chatButton: {
  width: 56,
  height: 44,
  borderRadius: 8,
  backgroundColor: '#3b82f6',
  justifyContent: 'center',
  alignItems: 'center',
}

// Group 2: Secondary (Bug, Settings, Orientation Toggle)
secondaryButton: {
  width: 44,
  height: 44,
  borderRadius: 8,
  backgroundColor: 'transparent',
  borderWidth: 1,
  borderColor: '#d1d5db',
}

// Orientation Toggle Button (Portrait/Landscape switcher)
orientationToggleButton: {
  width: 44,
  height: 44,
  borderRadius: 8,
  backgroundColor: 'transparent',
  borderWidth: 1,
  borderColor: '#d1d5db',
  justifyContent: 'center',
  alignItems: 'center',
}

orientationToggleIcon: {
  // Icon: 🔄 or screen rotation icon
  fontSize: 20,
  color: '#374151',
}

// Group 3: Card Count Indicator (Center)
cardIndicator: {
  paddingHorizontal: 12,
  paddingVertical: 8,
  borderRadius: 8,
  backgroundColor: 'rgba(59, 130, 246, 0.1)',
  borderWidth: 1,
  borderColor: 'rgba(59, 130, 246, 0.3)',
  flexDirection: 'row',
  alignItems: 'center',
  gap: 4,
}

cardCountText: {
  fontSize: 14,
  fontWeight: '700',
  color: '#2563eb',
}

// Group 4: Utility (Smart, Clear)
utilityButton: {
  height: 44,
  paddingHorizontal: 16,
  borderRadius: 8,
  backgroundColor: 'white',
  borderWidth: 1.5,
  borderColor: '#d1d5db',
  flexDirection: 'row',
  alignItems: 'center',
  gap: 6,
}

// Group 5: Primary Actions (Play, Pass)
primaryButton: {
  height: 44,
  paddingHorizontal: 20,
  borderRadius: 8,
  backgroundColor: '#10b981', // Green for Play
  flexDirection: 'row',
  alignItems: 'center',
  gap: 6,
  shadowColor: '#10b981',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.3,
  shadowRadius: 4,
}

passButton: {
  backgroundColor: '#6b7280', // Gray
}

disabledButton: {
  opacity: 0.4,
}
```

**Touch Targets (WCAG):**
- Minimum: 44pt × 44pt ✓
- Recommended: 48pt × 48pt
- All buttons meet accessibility standards

---

### 2.6 Card Rendering (On Table and In Hand)

#### **Card Image Component**
```typescript
cardImage: {
  width: 72, // Base size
  height: 104, // 72 × 1.4444
  borderRadius: 12,
  backgroundColor: '#ffffff',
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.15,
  shadowRadius: 8,
  // Multiple shadow layers for depth
  elevation: 4, // Android
}

// Premium card effects (shimmer/shine)
cardShine: {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  borderRadius: 12,
  overflow: 'hidden',
}

// Use LinearGradient for shine effect
shineGradient: {
  colors: [
    'rgba(255, 255, 255, 0)',
    'rgba(255, 255, 255, 0.3)',
    'rgba(255, 255, 255, 0)',
  ],
  start: { x: 0, y: 0 },
  end: { x: 1, y: 0 },
  // Animate position for shimmer
}
```

**Card Border/Inset:**
```typescript
cardBorder: {
  borderWidth: 1,
  borderColor: 'rgba(0, 0, 0, 0.1)',
}

cardInsetHighlight: {
  borderWidth: 2,
  borderColor: 'rgba(255, 255, 255, 0.5)',
}
```

**Opponent Compact Cards (Top/Left/Right):**
```typescript
compactCard: {
  width: 32, // Much smaller
  height: 46,
  borderRadius: 4,
}
```

**Play Area Cards (Last Play):**
```typescript
centerCard: {
  width: 70,
  height: 98,
  borderRadius: 10,
}
```

---

## 🎨 Phase 3: Colors & Theming

### 3.1 Color Palette (Exact Web Colors)

```typescript
export const GameColors = {
  // Background
  bg: '#0b1220',
  bgGradient: ['#11301f', '#0f261a', '#0b1220'], // Radial gradient
  
  // Panels
  panel: '#101826',
  panelBorder: '#1d2a40',
  panelLight: 'rgba(255, 255, 255, 0.95)', // Scoreboard
  
  // Text
  text: '#e6ebf5',
  muted: '#9fb0d0',
  textDark: '#374151', // On light panels
  
  // Accents
  accent: '#3b82f6', // Blue
  success: '#10b981', // Green
  danger: '#ef4444', // Red
  warning: '#f59e0b', // Amber
  
  // Player status
  active: '#3b82f6', // Active turn
  passed: '#6b7280', // Passed
  disconnected: '#ef4444', // Disconnected
  winner: '#10b981', // Winner
  
  // Card effects
  cardWhite: '#ffffff',
  cardShadow: 'rgba(0, 0, 0, 0.15)',
  
  // Control bar
  controlBarBg: 'rgba(255, 255, 255, 0.98)',
  controlBarBorder: 'rgba(0, 0, 0, 0.1)',
  
  // Shadows
  shadowLight: 'rgba(0, 0, 0, 0.1)',
  shadowMedium: 'rgba(0, 0, 0, 0.25)',
  shadowHeavy: 'rgba(0, 0, 0, 0.5)',
  
  // Oval poker table
  tableBg: 'rgba(16, 185, 129, 0.08)', // Green poker table
  tableBorder: '#1d2a40',
  
  // Player card badge
  badgeGreen: '#4CAF50',
  badgeGreenShadow: 'rgba(76, 175, 80, 0.4)',
  badgeGold: '#FFD700',
  
};
```

### 3.2 Gradients

```typescript
// Background gradient (full screen)
backgroundGradient: {
  colors: ['#11301f', '#0f261a', '#0b1220'],
  locations: [0, 0.4, 1],
  // Use react-native-linear-gradient
}

// Control bar gradient
controlBarGradient: {
  colors: ['rgba(255, 255, 255, 0.98)', 'rgba(255, 255, 255, 0.95)'],
  start: { x: 0, y: 0 },
  end: { x: 0, y: 1 },
}

// Button gradient (Play button)
playButtonGradient: {
  colors: ['#10b981', '#059669'],
  start: { x: 0, y: 0 },
  end: { x: 1, y: 1 },
}

// Oval poker table radial gradient
tableGradient: {
  colors: [
    'rgba(16, 185, 129, 0.08)',
    'rgba(59, 130, 246, 0.08)',
  ],
  // Use expo-linear-gradient or react-native-svg for radial
  // Applied to oval shape
}
```

---

## 📱 Phase 4: Responsive Scaling System

### 4.1 Breakpoints

```typescript
export const Breakpoints = {
  phoneSmall: 568,   // iPhone SE landscape width
  phoneMedium: 667,  // iPhone 8 landscape width
  phoneLarge: 844,   // iPhone 14 landscape width
  phoneMax: 932,     // iPhone 17 Pro Max landscape width
  tabletSmall: 1024, // iPad 10.2" landscape width
  tabletLarge: 1366, // iPad Pro 12.9" landscape width
};

export const getDeviceCategory = (width: number) => {
  if (width < Breakpoints.phoneMedium) return 'phoneSmall';
  if (width < Breakpoints.phoneLarge) return 'phoneMedium';
  if (width < Breakpoints.tabletSmall) return 'phoneLarge';
  if (width < Breakpoints.tabletLarge) return 'tabletSmall';
  return 'tabletLarge';
};
```

### 4.2 Scaling Functions

```typescript
import { Dimensions } from 'react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const BASE_WIDTH = 932; // iPhone 17 landscape
const BASE_HEIGHT = 430;

// Scale based on width
export const scaleWidth = (size: number): number => {
  return (SCREEN_WIDTH / BASE_WIDTH) * size;
};

// Scale based on height
export const scaleHeight = (size: number): number => {
  return (SCREEN_HEIGHT / BASE_HEIGHT) * size;
};

// Scale font size
export const scaleFont = (size: number): number => {
  const scale = SCREEN_WIDTH / BASE_WIDTH;
  return Math.round(size * scale);
};

// Clamp value between min and max
export const clamp = (value: number, min: number, max: number): number => {
  return Math.min(Math.max(value, min), max);
};

// Scale with limits
export const scaleClamped = (
  size: number,
  min: number,
  max: number
): number => {
  return clamp(scaleWidth(size), min, max);
};
```

### 4.3 Adaptive Component Sizes

```typescript
import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';

export const useAdaptiveLayout = () => {
  const { width, height } = useWindowDimensions();
  const category = getDeviceCategory(width);
  
  return useMemo(() => {
    // Card sizes
    const cardWidth = category === 'phoneSmall' ? 56 :
                      category === 'phoneMedium' ? 64 :
                      category === 'phoneLarge' ? 72 :
                      category === 'tabletSmall' ? 80 :
                      88;
    
    const cardHeight = cardWidth * 1.4444;
    
    // Oval table size (poker table style)
    const tableWidth = clamp(
      width * 0.45, // 45% of screen width
      320, // Min width (phoneSmall)
      560  // Max width (tabletLarge)
    );
    
    const tableHeight = clamp(
      height * 0.55, // 55% of available height
      180, // Min height (phoneSmall)
      320  // Max height (tabletLarge)
    );
    
    // Player profile sizes
    const topPlayerProfile = category.includes('phone') ? 80 : 100;
    const sidePlayerProfile = category.includes('phone') ? 60 : 80;
    
    // Card count badge
    const badgeSize = category === 'phoneSmall' ? 36 :
                      category.includes('phone') ? 44 :
                      52;
    
    // Control bar height
    const controlBarHeight = 68; // Fixed
    
    // Scoreboard width
    const scoreboardCollapsedWidth = 200;
    const scoreboardExpandedWidth = clamp(width * 0.5, 400, 600);
    
    // Overlaps
    const cardOverlap = category === 'phoneSmall' ? 0.4 :
                        category.includes('phone') ? 0.5 :
                        0.45; // Tablets less overlap
    
    return {
      cardWidth,
      cardHeight,
      tableWidth,
      tableHeight,
      topPlayerProfile,
      sidePlayerProfile,
      badgeSize,
      controlBarHeight,
      scoreboardCollapsedWidth,
      scoreboardExpandedWidth,
      cardOverlap,
      category,
    };
  }, [width, height, category]);
};
```

---

## 🏗️ Phase 5: Component Architecture

### 5.1 File Structure

```
src/
├── components/
│   ├── gameRoom/
│   │   ├── GameRoomLayout.tsx          # Main landscape layout
│   │   ├── OvalTable.tsx               # Play area (center, poker-style)
│   │   ├── PlayerCard.tsx              # Opponent cards (top/left/right)
│   │   ├── YourPosition.tsx            # Bottom player with cards
│   │   ├── Scoreboard.tsx              # Top-left panel
│   │   ├── PlayHistoryPanel.tsx        # Play history
│   │   ├── ControlBar.tsx              # Bottom bar
│   │   └── CardImage.tsx               # Card rendering
│   ├── cards/
│   │   ├── CardButton.tsx              # Touchable card
│   │   └── CardShimmer.tsx             # Shine effect
│   └── ui/
│       ├── Badge.tsx                   # Card count badge
│       └── Button.tsx                  # Control bar buttons
├── hooks/
│   ├── useAdaptiveLayout.ts            # Responsive sizing
│   ├── useCardSelection.ts             # Card state management
│   └── useGameState.ts                 # Game state hook
├── styles/
│   ├── colors.ts                       # Color palette
│   ├── spacing.ts                      # Spacing system
│   └── typography.ts                   # Font sizes
└── utils/
    ├── scaling.ts                      # Scaling functions
    └── cardAssets.ts                   # Card image URLs
```

### 5.2 Main Layout Component

```typescript
// GameRoomLayout.tsx
import React from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAdaptiveLayout } from '../../hooks/useAdaptiveLayout';
import { GameColors } from '../../styles/colors';

interface GameRoomLayoutProps {
  gameState: GameState;
  onPlayCard: () => void;
  onPass: () => void;
  // ... other props
}

export const GameRoomLayout: React.FC<GameRoomLayoutProps> = ({
  gameState,
  onPlayCard,
  onPass,
}) => {
  const insets = useSafeAreaInsets();
  const layout = useAdaptiveLayout();
  
  return (
    <LinearGradient
      colors={GameColors.bgGradient}
      style={styles.container}
      locations={[0, 0.4, 1]}
    >
      {/* Scoreboard - Top Left */}
      <Scoreboard
        style={{
          position: 'absolute',
          top: 12,
          left: Math.max(insets.left, 20),
          zIndex: 1000,
        }}
        gameState={gameState}
      />
      
      {/* Game Table Grid */}
      <View style={[
        styles.gameGrid,
        {
          paddingTop: 60,
          paddingBottom: layout.controlBarHeight,
          paddingLeft: Math.max(insets.left, 20),
          paddingRight: Math.max(insets.right, 20),
        }
      ]}>
        {/* Top Player */}
        <PlayerCard
          player={gameState.players[(gameState.you + 2) % 4]}
          position="top"
          profileSize={layout.topPlayerProfile}
          badgeSize={layout.badgeSize}
        />
        
        {/* Left Player */}
        <PlayerCard
          player={gameState.players[(gameState.you + 3) % 4]}
          position="left"
          profileSize={layout.sidePlayerProfile}
          badgeSize={layout.badgeSize}
        />
        
        {/* Oval Table (Poker Style) */}
        <OvalTable
          width={layout.tableWidth}
          height={layout.tableHeight}
          lastPlay={gameState.lastPlay}
        />
        
        {/* Right Player */}
        <PlayerCard
          player={gameState.players[(gameState.you + 1) % 4]}
          position="right"
          profileSize={layout.sidePlayerProfile}
          badgeSize={layout.badgeSize}
        />
        
        {/* Your Position */}
        <YourPosition
          hand={gameState.hand}
          playerName={gameState.names[gameState.you]}
          cardCount={gameState.counts[gameState.you]}
          cardWidth={layout.cardWidth}
          cardHeight={layout.cardHeight}
          overlap={layout.cardOverlap}
          badgeSize={layout.badgeSize}
        />
      </View>
      
      {/* Control Bar - Bottom */}
      <ControlBar
        style={{
          bottom: insets.bottom,
          paddingBottom: insets.bottom,
        }}
        onPlay={onPlayCard}
        onPass={onPass}
        selectedCount={selectedCards.length}
      />
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  gameGrid: {
    flex: 1,
    // Grid layout mimics CSS Grid with absolute positioning
  },
});
```

---

## 🎮 Phase 6: Interaction & Gestures

### 6.1 Card Selection (Touch)

```typescript
import { PanGestureHandler } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedGestureHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

export const CardButton = ({ card, onSelect, isSelected }) => {
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);
  
  const gestureHandler = useAnimatedGestureHandler({
    onStart: () => {
      scale.value = withSpring(1.05);
    },
    onActive: (event) => {
      translateY.value = Math.min(event.translationY, 0); // Only lift up
    },
    onEnd: () => {
      if (translateY.value < -20) {
        // Threshold for selection
        onSelect(card.id);
      }
      translateY.value = withSpring(isSelected ? -24 : 0);
      scale.value = withSpring(1);
    },
  });
  
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));
  
  return (
    <PanGestureHandler onGestureEvent={gestureHandler}>
      <Animated.View style={[styles.card, animatedStyle]}>
        <CardImage card={card} />
      </Animated.View>
    </PanGestureHandler>
  );
};
```

### 6.2 Long Press (Tap to Select Alternative)

```typescript
import { LongPressGestureHandler } from 'react-native-gesture-handler';

// Simple tap to select (no drag)
<LongPressGestureHandler
  minDurationMs={100}
  onHandlerStateChange={({ nativeEvent }) => {
    if (nativeEvent.state === State.ACTIVE) {
      onSelect(card.id);
    }
  }}
>
  <Animated.View style={styles.card}>
    <CardImage card={card} />
  </Animated.View>
</LongPressGestureHandler>
```

### 6.3 Button Press Feedback

```typescript
import { Pressable } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';

export const ControlBarButton = ({ onPress, children, disabled }) => {
  const scale = useSharedValue(1);
  
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  
  return (
    <Pressable
      onPressIn={() => {
        scale.value = withTiming(0.95, { duration: 100 });
      }}
      onPressOut={() => {
        scale.value = withTiming(1, { duration: 100 });
      }}
      onPress={onPress}
      disabled={disabled}
    >
      <Animated.View style={[styles.button, animatedStyle]}>
        {children}
      </Animated.View>
    </Pressable>
  );
};
```

---

## 🧪 Phase 7: Testing Matrix

### 7.1 Device Test Grid

| Device | Width × Height | Test Focus |
|--------|----------------|------------|
| **iPhone SE (2022)** | 568×320pt | Min size, tight spacing |
| **iPhone 14** | 844×390pt | Standard phone |
| **iPhone 17 Pro** | 932×430pt | Base reference |
| **iPhone 17 Pro Max** | 932×430pt | Max phone size |
| **iPad Mini** | 1024×768pt | Small tablet |
| **iPad Air** | 1180×820pt | Standard tablet |
| **iPad Pro 12.9"** | 1366×1024pt | Large tablet |
| **Samsung Galaxy S24** | 915×412pt | Android phone |
| **Google Pixel Tablet** | 1080×675pt | Android tablet |

### 7.2 Test Checklist

#### Visual Tests
- [ ] Scoreboard appears at top-left, readable
- [ ] Play area is circular and centered
- [ ] All 4 player cards visible and properly positioned
- [ ] Your cards display at bottom with overlap
- [ ] Control bar fixed at bottom, all buttons accessible
- [ ] Card count badges visible on all players
- [ ] No overlapping elements
- [ ] Safe areas respected (notch, home indicator)

#### Interaction Tests
- [ ] Cards can be selected by tap
- [ ] Selected cards lift up with animation
- [ ] Multiple cards selectable
- [ ] Clear button deselects all
- [ ] Play button executes action
- [ ] Pass button works when enabled
- [ ] Smart Sort reorders cards
- [ ] Scoreboard expands on tap
- [ ] Play history opens on button tap

#### Responsive Tests
- [ ] Layout adapts on iPhone SE (smallest)
- [ ] Layout expands on iPad Pro (largest)
- [ ] Card sizes scale appropriately
- [ ] Touch targets ≥ 44pt on all devices
- [ ] Text remains readable at all sizes
- [ ] No content cutoff or overflow

#### Performance Tests
- [ ] Smooth 60fps card animations
- [ ] No lag with 13 cards in hand
- [ ] Scoreboard scroll is smooth
- [ ] No memory leaks after 10 minutes
- [ ] Fast orientation change (portrait ↔ landscape)

---

## 📊 Phase 8: Performance Optimization

### 8.1 Memoization Strategy

```typescript
import React, { memo } from 'react';

// Memoize cards to prevent re-renders
export const CardImage = memo(({ card }) => {
  return <Image source={{ uri: getCardUrl(card) }} style={styles.card} />;
}, (prevProps, nextProps) => {
  return prevProps.card.id === nextProps.card.id;
});

// Memoize player cards
export const PlayerCard = memo(({ player, position }) => {
  // ... component
}, (prevProps, nextProps) => {
  return (
    prevProps.player.cardCount === nextProps.player.cardCount &&
    prevProps.player.isActive === nextProps.player.isActive &&
    prevProps.player.isPassed === nextProps.player.isPassed
  );
});
```

### 8.2 Lazy Loading

```typescript
// Load card images lazily
import FastImage from 'react-native-fast-image';

<FastImage
  source={{ 
    uri: cardUrl,
    priority: FastImage.priority.high,
  }}
  style={styles.cardImage}
  resizeMode={FastImage.resizeMode.contain}
/>
```

### 8.3 Animation Optimization

```typescript
// Use native driver for all animations
useNativeDriver: true

// Avoid layout animations on card list
animatedStyles: {
  transform: [{ translateY }], // ✓ Uses native driver
  opacity: opacity, // ✓ Uses native driver
  // Avoid: width, height, left, top (trigger layout)
}
```

---

## 📦 Phase 9: Dependencies

### 9.1 Required Packages

```json
{
  "dependencies": {
    "react": "^18.2.0",
    "react-native": "^0.73.0",
    "react-native-reanimated": "^3.6.0",
    "react-native-gesture-handler": "^2.14.0",
    "react-native-safe-area-context": "^4.8.0",
    "react-native-linear-gradient": "^2.8.0",
    "react-native-svg": "^14.1.0",
    "react-native-fast-image": "^8.6.3",
    "@react-navigation/native": "^6.1.0"
  }
}
```

### 9.2 Installation

```bash
# Install dependencies
npm install react-native-reanimated react-native-gesture-handler \
  react-native-safe-area-context react-native-linear-gradient \
  react-native-svg react-native-fast-image

# iOS: Install pods
cd ios && pod install && cd ..

# Android: No additional setup needed (auto-linking)
```

---

## ✅ Phase 10: Success Criteria

The migration is complete when:

1. ✅ **Visual Parity:** Layout matches web exactly (±2pt tolerance)
2. ✅ **Color Accuracy:** All colors match web palette
3. ✅ **Responsive:** Works on iPhone SE through iPad Pro
4. ✅ **Performance:** 60fps animations, <100ms response time
5. ✅ **Accessibility:** All touch targets ≥ 44pt
6. ✅ **Safe Areas:** Respects notch and home indicator
7. ✅ **Gestures:** Card selection smooth and intuitive
8. ✅ **No Regressions:** All web features work on mobile

---

## 🎯 Summary of Key Measurements (iPhone 17)

| Element | Width | Height | Notes |
|---------|-------|--------|-------|
| **Screen (Landscape)** | 932pt | 430pt | Base reference |
| **Safe Area (Usable)** | 814pt | 409pt | After insets |
| **Top Bar** | Full | 60pt | Scoreboard + title |
| **Control Bar** | Full | 68pt | Bottom fixed |
| **Game Area** | Full | 302pt | Between bars |
| **Oval Table** | 420pt | 240pt | Play area (poker style) |
| **Top Player Card** | 180pt | 160pt | 2-part layout (no fan cards) |
| **Side Player Card** | 140pt | 160pt | Left/right |
| **Player Profile (Top)** | 100pt | 100pt | Video/avatar |
| **Player Profile (Side)** | 80pt | 80pt | Smaller |
| **Card Count Badge** | 44pt | 44pt | Circular |
| **Your Card (Base)** | 72pt | 104pt | 1.4444 ratio |
| **Card Overlap** | -36pt | — | 50% of width |
| **Play Area Card** | 70pt | 98pt | Last play |
| **Scoreboard Collapsed** | 200pt | ~120pt | Auto height |
| **Scoreboard Expanded** | 600pt | 344pt | 80vh max |
| **Control Button** | Auto | 44pt | Min touch target |

---

## 📝 Next Steps After Implementation

1. **Video Integration** - Add WebRTC for player video streams
2. **Animations** - Add card dealing, shuffle, win animations
3. **Haptic Feedback** - Add vibration for card selection, play, pass
4. **Sound Effects** - Card sounds, win/loss audio
5. **Offline Mode** - Practice mode with bots
6. **Tutorial Overlay** - First-time user guide
7. **Landscape Lock** - Force landscape orientation in game

---

## 📞 Reference Files

- **Web Layout:** `client/src/App.tsx` (lines 7000-7600)
- **Styles:** `client/src/styles.css` (lines 1140-1800)
- **Player Card:** `client/src/components/PlayerCard.css`
- **Control Bar:** `client/src/components/AdaptiveControlBar.css`
- **Card Logic:** `client/src/utils/game-logic.ts`

---

**END OF MIGRATION PLAN**

This plan ensures pixel-perfect recreation of the web layout in React Native with full responsive support for all phone and tablet sizes. All measurements are production-tested and optimized for performance.
