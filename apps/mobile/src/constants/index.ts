// App-wide constants

export const COLORS = {
  primary: '#25292e',
  secondary: '#4A90E2',
  accent: '#FF6B35',
  success: '#4CAF50',
  error: '#F44336',
  warning: '#FF9800',
  info: '#2196F3', // Blue for info messages
  white: '#FFFFFF',
  black: '#000000',
  danger: '#EF4444', // Red for destructive actions
  gold: '#FFD700', // Gold for leaderboard first place
  silver: '#C0C0C0', // Silver for leaderboard second place
  bronze: '#CD7F32', // Bronze for leaderboard third place
  red: {
    active: '#E74C3C', // Red for active turn indicator
  },
  blue: {
    primary: '#4A90E2', // Blue for current player
  },
  table: {
    background: '#4A7C59', // Green felt color
    border: '#7A7A7A', // Gray border
  },
  gray: {
    light: '#F5F5F5',
    medium: '#9E9E9E',
    dark: '#424242',
    darker: '#2a2d33', // Darker gray for UI elements
    text: '#a0a0a0', // Gray text
    textDark: '#666', // Darker gray text
  },
  card: {
    hearts: '#E74C3C',
    diamonds: '#E74C3C',
    clubs: '#2C3E50',
    spades: '#2C3E50',
  },
  background: {
    dark: '#1c1f24', // Dark background for sections
    primary: '#25292e', // Primary dark background
  },
};

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const FONT_SIZES = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
};

export const API = {
  SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL || '',
  SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '',
};

// Layout Constants
export const LAYOUT = {
  // Table dimensions
  tableWidth: 340,
  tableHeight: 450,
  tableBorderRadius: 40,
  tableBorderWidth: 5,
  
  // Player positioning
  playerOverlapOffset: -50,
  leftPlayerOffset: 228, // Position to the right of scoreboard. Calculated: ScoreboardContainer width (200px) + left (12px) + SPACING.md (16px) = 228px
  topPlayerSpacing: 140,
  topPlayerOverlap: -25,
  
  // Hamburger menu
  menuIconSize: 40,
  menuLineWidth: 20,
  menuLineHeight: 3,
  menuLineGap: 4,
  menuBorderRadius: 20,
  
  // Scoreboard
  scoreboardWidth: 140,
  scoreboardMinHeight: 130,
  scoreboardPadding: 8,
  scoreboardBorderRadius: 8,
  
  // Player avatar
  avatarSize: 70,
  avatarBorderWidth: 4,
  avatarIconSize: 40,
  avatarBorderRadius: 35,
  avatarInnerRadius: 31,
  avatarIconRadius: 20,
  
  // Center play area
  centerPlayHeightTable: 80,
  
  // Card hand positioning
  handAlignmentOffset: 68, // Horizontal offset for centering player's hand (user-requested: 52px or 68px)
};

// Card font sizes (used with scaling)
export const CARD_FONTS = {
  rankFontSize: 16,
  suitFontSize: 14,
  centerSuitFontSize: 32,
  centerSuitMarginTop: 20,
};

// Overlay colors
export const OVERLAYS = {
  menuBackground: 'rgba(255, 255, 255, 0.2)',
  emptyStateBackground: 'rgba(255, 255, 255, 0.05)',
  emptyStateBorder: 'rgba(255, 255, 255, 0.15)',
  leaveGameBackground: 'rgba(239, 68, 68, 0.15)',
  leaveGameBorder: 'rgba(239, 68, 68, 0.3)',
  modalOverlay: 'rgba(0, 0, 0, 0.7)',
  scoreboardBackground: 'rgba(255, 255, 255, 0.95)',
  nameBadgeBackground: 'rgba(46, 125, 50, 0.9)', // Green badge for player names
  closeButtonBackground: 'rgba(255, 255, 255, 0.1)', // Semi-transparent white for close button
};

// Badge dimensions
export const BADGE = {
  nameBorderRadius: 16,
  nameBorderWidth: 2,
  nameMinWidth: 80,
  cardCountTop: 52,
  cardCountLeft: -12,
  cardCountPaddingVertical: 4,
  cardCountBorderRadius: 12,
  cardCountBorderWidth: 1,
};

// Modal dimensions
export const MODAL = {
  maxWidth: 400,
  borderRadius: 20,
  borderWidth: 2,
  headerBorderWidth: 1,
  closeButtonSize: 32,
  closeButtonRadius: 16,
  menuItemBorderRadius: 12,
  dividerHeight: 1,
  leaveGameBorderWidth: 1,
};

// Center Play Area
export const CENTER_PLAY = {
  emptyStateBorderRadius: 16,
  emptyStateBorderWidth: 2,
  cardFirstMargin: 40,
  cardSpacing: 48,
};

// Positioning
export const POSITIONING = {
  scoreboardTop: 40,
  scoreboardLeft: 16,
  menuTop: 60,
  menuLineBorderRadius: 2,
  bottomSectionMarginTop: -50,
  actionButtonBorderRadius: 12,
  actionButtonMinWidth: 70,
  passButtonBorderWidth: 1,
  sidePlayerTop: 0,
  // INDEPENDENT CONTROLS - Change these to move components:
  // Note: Negative values extend components beyond the visible viewport edge for optimal card fan display
  // Values determined through iterative testing to balance aesthetics and usability across device sizes
  cardsBottom: -45,               // Cards bottom position (-45 = extend below viewport for better fan visibility)
  playerInfoBottom: 100,        // Profile photo + name button (higher = up, lower = down)
  helperButtonsBottom: 180,     // Sort/Smart/Hint buttons (higher = up, lower = down)
  actionButtonsBottom: 120,     // Pass/Play buttons (higher = up, lower = down)
  playerInfoLeft: 16,           // Profile photo + name button left position
  helperButtonsLeft: 160,        // Sort/Smart/Hint buttons left position  
  actionButtonsRight: 0,       // Pass/Play buttons right position (0 = flush with right edge)
};

// Scoreboard detail dimensions
export const SCOREBOARD_DETAIL = {
  headerBorderWidth: 2,
  headerPaddingBottom: 4,
  headerMarginBottom: 4,
  playerRowPaddingVertical: 2,
  playerRowGap: 6,
  indicatorWidth: 16,
  iconFontSize: 10,
  scoreMinWidth: 24,
};

// Shadow properties
export const SHADOWS = {
  table: {
    offset: { width: 0, height: 4 },
    opacity: 0.3,
    radius: 8,
    elevation: 8,
  },
  scoreboard: {
    offset: { width: 0, height: 2 },
    opacity: 0.25,
    radius: 4,
    elevation: 5,
  },
  activeAvatar: {
    offset: { width: 0, height: 0 },
    opacity: 0.8,
    radius: 8,
    elevation: 8,
  },
};

// Typography
export const TYPOGRAPHY = {
  rankLineHeight: 18,
  suitLineHeight: 16,
};

// Opacities
export const OPACITIES = {
  avatarIcon: 0.6,
  disabled: 0.5,
};
