/**
 * Game Room Landscape Color System
 * 
 * Defines all colors used in the landscape game room components.
 * **Matches portrait mode colors exactly for theme consistency.**
 * Uses colors from src/constants/index.ts (COLORS, OVERLAYS)
 * 
 * Created as part of Task #448: Color palette and theming system
 * Date: December 18, 2025
 */

// ============================================================================
// BACKGROUND COLORS
// ============================================================================

export const GameColors = {
  // -------------------------------------------------------------------------
  // Main Backgrounds (matches portrait COLORS.background & COLORS.primary)
  // -------------------------------------------------------------------------
  background: {
    primary: '#25292e',                       // Main dark background (portrait mode)
    dark: '#1c1f24',                          // Dark background for sections
    gradient: ['#25292e', '#1c1f24', '#25292e'], // Subtle gradient (same palette)
    gradientLocations: [0, 0.5, 1],          // Gradient stop positions
  },

  // -------------------------------------------------------------------------
  // Panel Backgrounds
  // -------------------------------------------------------------------------
  panel: {
    base: '#25292e',                          // Base panel background (same as primary)
    border: '#7A7A7A',                        // Panel border (matches table.border)
    light: 'rgba(255, 255, 255, 0.95)',       // Light panel (scoreboard) - from OVERLAYS
    transparent: 'transparent',               // Transparent panels
  },

  // -------------------------------------------------------------------------
  // Text Colors
  // -------------------------------------------------------------------------
  text: {
    primary: '#FFFFFF',                       // Primary text (white)
    muted: '#a0a0a0',                         // Muted/secondary text (COLORS.gray.text)
    dark: '#666',                             // Dark text (COLORS.gray.textDark)
    white: '#FFFFFF',                         // Pure white text
    shadow: 'rgba(0, 0, 0, 0.7)',            // Text shadow color
  },

  // -------------------------------------------------------------------------
  // Accent Colors (matches portrait COLORS)
  // -------------------------------------------------------------------------
  accent: {
    blue: '#4A90E2',                          // Primary blue accent (COLORS.secondary)
    green: '#4CAF50',                         // Success/play green (COLORS.success)
    red: '#EF4444',                           // Danger/error red (COLORS.danger)
    amber: '#FF9800',                         // Warning amber (COLORS.warning)
    gold: '#FFD700',                          // Gold (winner/badges) (COLORS.gold)
    gray: '#9E9E9E',                          // Neutral gray (COLORS.gray.medium)
  },

  // -------------------------------------------------------------------------
  // Player Status Colors (matches portrait red.active and blue.primary)
  // -------------------------------------------------------------------------
  playerStatus: {
    active: '#E74C3C',                        // Active turn indicator (red) - COLORS.red.active
    passed: '#9E9E9E',                        // Passed state (gray) - COLORS.gray.medium
    disconnected: '#EF4444',                  // Disconnected (red) - COLORS.danger
    winner: '#4CAF50',                        // Winner state (green) - COLORS.success
  },

  // -------------------------------------------------------------------------
  // Card Colors (matches portrait card suits)
  // -------------------------------------------------------------------------
  card: {
    background: '#ffffff',                    // Card background (white)
    shadow: 'rgba(0, 0, 0, 0.15)',           // Card shadow
    border: 'rgba(0, 0, 0, 0.1)',            // Card border
    insetHighlight: 'rgba(255, 255, 255, 0.5)', // Inset highlight
    
    // Suit colors (from COLORS.card)
    hearts: '#E74C3C',                        // Red suits
    diamonds: '#E74C3C',
    clubs: '#2C3E50',                         // Black suits
    spades: '#2C3E50',
    
    // Shimmer effect colors
    shimmer: [
      'rgba(255, 255, 255, 0)',
      'rgba(255, 255, 255, 0.3)',
      'rgba(255, 255, 255, 0)',
    ],
  },

  // -------------------------------------------------------------------------
  // Poker Table Colors (matches portrait COLORS.table)
  // -------------------------------------------------------------------------
  table: {
    background: '#4A7C59',                    // Green felt color (portrait mode)
    border: '#7A7A7A',                        // Gray border (portrait mode)
    gradientColors: [
      '#4A7C59',                              // Green felt (solid color for consistency)
      '#4A7C59',                              // Same color (no gradient)
    ],
  },

  // -------------------------------------------------------------------------
  // Player Badge Colors (matches portrait OVERLAYS.nameBadgeBackground)
  // -------------------------------------------------------------------------
  badge: {
    green: 'rgba(46, 125, 50, 0.9)',         // Green badge (portrait OVERLAYS.nameBadgeBackground)
    greenShadow: 'rgba(76, 175, 80, 0.4)',   // Green badge shadow
    gold: '#FFD700',                          // Gold badge (winner/host) - COLORS.gold
    goldShadow: 'rgba(255, 215, 0, 0.3)',    // Gold badge shadow
    border: 'rgba(255, 255, 255, 0.3)',      // Badge border
  },

  // -------------------------------------------------------------------------
  // Control Bar Colors (similar to portrait game controls)
  // -------------------------------------------------------------------------
  controlBar: {
    background: 'rgba(255, 255, 255, 0.95)',  // Control bar background (matches scoreboard)
    border: 'rgba(0, 0, 0, 0.1)',            // Top border
    gradientColors: [
      'rgba(255, 255, 255, 0.95)',
      'rgba(255, 255, 255, 0.9)',
    ],
    
    // Button colors (matches portrait mode button colors)
    buttonWhite: '#ffffff',                   // White button background
    buttonBorder: '#9E9E9E',                  // Button border (COLORS.gray.medium)
    buttonGreen: '#4CAF50',                   // Play button (COLORS.success)
    buttonGreenDark: '#388E3C',               // Play button darker shade
    buttonGray: '#9E9E9E',                    // Pass button (COLORS.gray.medium)
    buttonBlue: '#4A90E2',                    // Action button (COLORS.secondary)
    buttonDisabled: 0.5,                      // Disabled button opacity (OPACITIES.disabled)
  },

  // -------------------------------------------------------------------------
  // Shadow Colors (matches portrait SHADOWS constants)
  // -------------------------------------------------------------------------
  shadow: {
    light: 'rgba(0, 0, 0, 0.1)',             // Light shadow
    medium: 'rgba(0, 0, 0, 0.25)',           // Medium shadow (SHADOWS.scoreboard.opacity)
    heavy: 'rgba(0, 0, 0, 0.5)',             // Heavy shadow
    black: '#000',                            // Pure black shadow (COLORS.black)
    cardShadow: 'rgba(0, 0, 0, 0.3)',        // Card shadow (SHADOWS.table.opacity)
    greenGlow: 'rgba(76, 175, 80, 0.3)',     // Green button glow
  },
};

// ============================================================================
// GRADIENT CONFIGURATIONS (for react-native-linear-gradient)
// ============================================================================

/**
 * Background gradient for full screen
 * Subtle gradient using portrait mode colors
 */
export const BackgroundGradient = {
  colors: GameColors.background.gradient,
  locations: GameColors.background.gradientLocations,
  start: { x: 0, y: 0 },
  end: { x: 0, y: 1 },
};

/**
 * Control bar gradient
 * Subtle gradient from top to bottom (matches scoreboard style)
 */
export const ControlBarGradient = {
  colors: GameColors.controlBar.gradientColors,
  start: { x: 0, y: 0 },
  end: { x: 0, y: 1 },
};

/**
 * Play button gradient
 * Green gradient using portrait mode success color
 */
export const PlayButtonGradient = {
  colors: [
    GameColors.controlBar.buttonGreen,
    GameColors.controlBar.buttonGreenDark,
  ],
  start: { x: 0, y: 0 },
  end: { x: 1, y: 1 },
};

/**
 * Poker table - no gradient (solid green felt like portrait mode)
 * Matches portrait table background exactly
 */
export const TableGradient = {
  colors: GameColors.table.gradientColors,
  start: { x: 0, y: 0 },
  end: { x: 0, y: 1 },
};

/**
 * Card shimmer effect gradient
 * Animated shine overlay
 */
export const CardShimmerGradient = {
  colors: GameColors.card.shimmer,
  start: { x: 0, y: 0 },
  end: { x: 1, y: 0 },
  // Animate start/end to create shimmer effect
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get player status color
 * @param status - Player status: 'active' | 'passed' | 'disconnected' | 'winner'
 * @returns Color string
 */
export const getPlayerStatusColor = (
  status: 'active' | 'passed' | 'disconnected' | 'winner'
): string => {
  return GameColors.playerStatus[status];
};

/**
 * Get button color by type
 * @param type - Button type: 'play' | 'pass' | 'action' | 'utility'
 * @param disabled - Whether button is disabled
 * @returns Color string
 */
export const getButtonColor = (
  type: 'play' | 'pass' | 'action' | 'utility',
  disabled: boolean = false
): string => {
  if (disabled) {
    return GameColors.controlBar.buttonGray; // All disabled buttons are gray
  }
  
  switch (type) {
    case 'play':
      return GameColors.controlBar.buttonGreen;
    case 'pass':
      return GameColors.controlBar.buttonGray;
    case 'action':
      return GameColors.controlBar.buttonBlue;
    case 'utility':
      return GameColors.controlBar.buttonWhite;
    default:
      return GameColors.controlBar.buttonWhite;
  }
};

/**
 * Create rgba color with custom opacity
 * @param hexColor - Hex color string (e.g., '#3b82f6')
 * @param opacity - Opacity (0-1)
 * @returns rgba color string
 */
export const withOpacity = (hexColor: string, opacity: number): string => {
  // Remove # if present
  const hex = hexColor.replace('#', '');
  
  // Parse RGB
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  
  // Clamp opacity between 0 and 1
  const clampedOpacity = Math.max(0, Math.min(1, opacity));
  
  return `rgba(${r}, ${g}, ${b}, ${clampedOpacity})`;
};

// ============================================================================
// EXPORTS
// ============================================================================

export default GameColors;
