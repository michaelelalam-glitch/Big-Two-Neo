/**
 * Landscape Layout Constants
 * 
 * Base specifications for iPhone 17 landscape mode (932×430pt)
 * with safe area insets and adaptive scaling system
 * 
 * Part of Task #456: Setup base screen specifications and safe area handling
 * Date: December 18, 2025
 */

// ============================================================================
// BASE DEVICE SPECIFICATIONS (iPhone 17 Landscape)
// ============================================================================

export const LANDSCAPE_BASE = {
  // Screen dimensions
  width: 932,  // Base width (iPhone 17 Pro Max landscape)
  height: 430, // Base height (iPhone 17 Pro Max landscape)
  
  // Safe area insets (iPhone 17 in landscape)
  safeArea: {
    top: 0,      // No notch in landscape
    bottom: 21,  // Home indicator
    left: 59,    // Camera cutout (Dynamic Island)
    right: 59,   // Camera cutout (Dynamic Island)
  },
  
  // Usable area calculation (814pt × 409pt)
  usableArea: {
    width: 814,   // 932 - (59 + 59)
    height: 409,  // 430 - 21
  },
  
  // Layout zones
  zones: {
    topBarHeight: 60,       // Scoreboard area
    controlBarHeight: 68,   // Bottom controls
    gameAreaHeight: 302,    // 430 - 60 - 68
  },
} as const;

// ============================================================================
// DEVICE BREAKPOINTS
// ============================================================================

export const BREAKPOINTS = {
  phoneSmall: 568,    // iPhone SE landscape width
  phoneMedium: 667,   // iPhone 8 landscape width
  phoneLarge: 844,    // iPhone 14 landscape width
  phoneMax: 932,      // iPhone 17 Pro Max landscape width
  tabletSmall: 1024,  // iPad 10.2" landscape width
  tabletLarge: 1366,  // iPad Pro 12.9" landscape width
} as const;

export type DeviceCategory = 
  | 'phoneSmall' 
  | 'phoneMedium' 
  | 'phoneLarge' 
  | 'tabletSmall' 
  | 'tabletLarge';

/**
 * Determine device category based on screen width
 */
export const getDeviceCategory = (width: number): DeviceCategory => {
  if (width < BREAKPOINTS.phoneMedium) return 'phoneSmall';
  if (width < BREAKPOINTS.phoneLarge) return 'phoneMedium';
  if (width < BREAKPOINTS.tabletSmall) return 'phoneLarge';
  if (width < BREAKPOINTS.tabletLarge) return 'tabletSmall';
  return 'tabletLarge';
};

// ============================================================================
// COMPONENT DIMENSIONS
// ============================================================================

export const LANDSCAPE_DIMENSIONS = {
  // Oval poker table (center play area)
  table: {
    width: 420,
    height: 240,
    borderRadius: 120, // Half of height for rounded ends
    padding: 16,
  },
  
  // Player cards
  playerCards: {
    top: {
      width: 180,
      height: 160,
      profileSize: 100,
      badgeSize: 44,
    },
    side: {
      width: 140,
      height: 160,
      profileSize: 80,
      badgeSize: 36,
    },
  },
  
  // Your position (bottom)
  yourPosition: {
    height: 180,
    cardWidth: 72,
    cardHeight: 104, // 72 × 1.4444 aspect ratio
    cardOverlap: 0.5, // 50% overlap
    badgeSize: 44,
  },
  
  // Scoreboard
  scoreboard: {
    collapsed: {
      maxWidth: 200,
      minHeight: 120,
    },
    expanded: {
      maxWidth: 600,
      maxHeight: 344, // 80vh on iPhone 17 (430 * 0.8)
    },
    playerRowHeight: 22,
    matchCardHeight: 120,
  },
  
  // Control bar
  controlBar: {
    height: 68,
    buttonHeight: 44, // WCAG minimum touch target
    buttonGap: 8,
  },
  
  // Cards
  cards: {
    base: {
      width: 72,
      height: 104,
      borderRadius: 12,
    },
    compact: {
      width: 32,
      height: 46,
      borderRadius: 4,
    },
    center: {
      width: 70,
      height: 98,
      borderRadius: 10,
    },
    hand: {
      width: 60,
      height: 84,
      borderRadius: 8,
    },
  },
} as const;

// ============================================================================
// POSITIONING
// ============================================================================

export const LANDSCAPE_POSITIONING = {
  scoreboard: {
    top: 16,
    left: 20,
  },
  
  table: {
    centerX: 407, // Center of usable area (814 / 2)
    centerY: 165, // Center of game area (302 / 2 + 60 topBar)
  },
  
  players: {
    top: {
      x: 407, // Center
      y: 60,  // Below top bar
    },
    left: {
      x: 140,  // 80 (safe) + 60 (offset)
      y: 215,  // Vertical center
    },
    right: {
      x: 674,  // Mirror of left
      y: 215,
    },
    bottom: {
      x: 407,  // Center
      y: 320,  // Above your position
    },
  },
  
  playerCards: {
    top: {
      top: 60, // Below top bar
      centerOffset: -90, // Half of width (180 / 2)
    },
    left: {
      left: 80, // After safe area + padding
      centerOffset: -80, // Half of height (160 / 2)
    },
    right: {
      right: 80,
      centerOffset: -80,
    },
  },
  
  yourPosition: {
    bottom: 68, // Above control bar
    paddingHorizontal: 20,
  },
  
  controlBar: {
    bottom: 0,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
} as const;

// ============================================================================
// SCALING FUNCTIONS
// ============================================================================

/**
 * Scale a value based on screen width relative to base width
 */
export const scaleWidth = (size: number, screenWidth: number): number => {
  return (screenWidth / LANDSCAPE_BASE.width) * size;
};

/**
 * Scale a value based on screen height relative to base height
 */
export const scaleHeight = (size: number, screenHeight: number): number => {
  return (screenHeight / LANDSCAPE_BASE.height) * size;
};

/**
 * Scale font size
 */
export const scaleFont = (size: number, screenWidth: number): number => {
  const scale = screenWidth / LANDSCAPE_BASE.width;
  return Math.round(size * scale);
};

/**
 * Clamp value between min and max
 */
export const clamp = (value: number, min: number, max: number): number => {
  return Math.min(Math.max(value, min), max);
};

/**
 * Scale with clamped limits
 */
export const scaleClamped = (
  size: number,
  screenWidth: number,
  min: number,
  max: number
): number => {
  return clamp(scaleWidth(size, screenWidth), min, max);
};
