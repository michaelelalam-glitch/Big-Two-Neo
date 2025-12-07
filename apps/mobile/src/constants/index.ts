// App-wide constants

export const COLORS = {
  primary: '#25292e',
  secondary: '#4A90E2',
  accent: '#FF6B35',
  success: '#4CAF50',
  error: '#F44336',
  warning: '#FF9800',
  white: '#FFFFFF',
  black: '#000000',
  danger: '#EF4444', // Red for destructive actions
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
  },
  card: {
    hearts: '#E74C3C',
    diamonds: '#E74C3C',
    clubs: '#2C3E50',
    spades: '#2C3E50',
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
