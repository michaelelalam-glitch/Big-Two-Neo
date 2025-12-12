/**
 * Scoreboard Responsive Styles
 * 
 * Comprehensive StyleSheet for all scoreboard components
 * Optimized for mobile devices (iOS & Android)
 * 
 * Created as part of Task #344: Responsive StyleSheet
 * Date: December 12, 2025
 */

import { StyleSheet, Dimensions, Platform, PixelRatio } from 'react-native';
import { ScoreboardColors } from './colors';

// ============================================================================
// RESPONSIVE UTILITIES
// ============================================================================

// Note: These values are computed at module load time and won't update dynamically.
// For responsive orientation changes, components should use useWindowDimensions() hook.
// fontScale removed to prevent quadratic scaling (Text components already apply font scaling by default)
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const isPortrait = SCREEN_HEIGHT > SCREEN_WIDTH;

// Calculate responsive sizes
const scale = (size: number) => (SCREEN_WIDTH / 375) * size;
const verticalScale = (size: number) => (SCREEN_HEIGHT / 812) * size;
const moderateScale = (size: number, factor = 0.5) => size + (scale(size) - size) * factor;

// Minimum touch target size (iOS HIG & Material Design)
const MIN_TOUCH_TARGET = 44;

// ============================================================================
// SCOREBOARD CONTAINER STYLES
// ============================================================================

export const scoreboardStyles = StyleSheet.create({
  // -------------------------------------------------------------------------
  // Container Positioning
  // -------------------------------------------------------------------------
  
  container: {
    position: 'absolute',
    top: moderateScale(12),
    left: moderateScale(12),
    maxWidth: isPortrait ? SCREEN_WIDTH * 0.9 : moderateScale(400),
    zIndex: 100,
    ...Platform.select({
      ios: {
        shadowColor: ScoreboardColors.shadow.heavy,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.5,
        shadowRadius: 4,
      },
      android: {
        elevation: 8,
      },
    }),
  },

  // -------------------------------------------------------------------------
  // Compact Scoreboard Styles
  // -------------------------------------------------------------------------
  
  compactContainer: {
    backgroundColor: ScoreboardColors.background.compact,
    borderRadius: moderateScale(8),
    padding: moderateScale(12),
    minWidth: moderateScale(200),
    maxWidth: moderateScale(320),
  },

  compactHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: moderateScale(8),
    paddingBottom: moderateScale(8),
    borderBottomWidth: 1,
    borderBottomColor: ScoreboardColors.border.primary,
  },

  matchTitle: {
    fontSize: moderateScale(14),
    fontWeight: '700',
    color: ScoreboardColors.text.highlight,
    letterSpacing: 0.5,
  },

  // Note: 'gap' property is supported in React Native 0.71+
  // For older versions, replace with margin/padding on child elements
  headerButtons: {
    flexDirection: 'row',
    gap: moderateScale(8),
  },

  iconButton: {
    minWidth: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: ScoreboardColors.button.background,
    borderRadius: moderateScale(6),
    paddingHorizontal: moderateScale(8),
  },

  iconButtonActive: {
    backgroundColor: ScoreboardColors.button.backgroundActive,
  },

  iconButtonText: {
    fontSize: moderateScale(12),
    color: ScoreboardColors.button.text,
    fontWeight: '600',
  },

  // -------------------------------------------------------------------------
  // Player Score List (Compact)
  // -------------------------------------------------------------------------
  
  playerList: {
    gap: moderateScale(6),
  },

  playerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: moderateScale(6),
    paddingHorizontal: moderateScale(8),
    borderRadius: moderateScale(4),
    backgroundColor: 'transparent',
  },

  playerRowCurrent: {
    backgroundColor: ScoreboardColors.background.currentMatch,
    borderLeftWidth: 3,
    borderLeftColor: ScoreboardColors.border.highlight,
  },

  playerName: {
    fontSize: moderateScale(13),
    fontWeight: '500',
    color: ScoreboardColors.text.primary,
    flex: 1,
  },

  playerNameCurrent: {
    color: ScoreboardColors.text.currentPlayer,
    fontWeight: '700',
  },

  playerStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: moderateScale(12),
  },

  cardCount: {
    fontSize: moderateScale(12),
    color: ScoreboardColors.text.secondary,
    fontWeight: '500',
  },

  playerScore: {
    fontSize: moderateScale(14),
    fontWeight: '700',
    minWidth: moderateScale(40),
    textAlign: 'right',
  },

  // -------------------------------------------------------------------------
  // Expanded Scoreboard Styles
  // -------------------------------------------------------------------------
  
  expandedContainer: {
    backgroundColor: ScoreboardColors.background.expanded,
    borderRadius: moderateScale(8),
    padding: moderateScale(12),
    minWidth: moderateScale(300),
    maxWidth: isPortrait ? SCREEN_WIDTH * 0.95 : moderateScale(600),
    maxHeight: SCREEN_HEIGHT * 0.7,
  },

  expandedHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: moderateScale(12),
    paddingBottom: moderateScale(12),
    borderBottomWidth: 1,
    borderBottomColor: ScoreboardColors.border.primary,
  },

  expandedTitle: {
    fontSize: moderateScale(16),
    fontWeight: '700',
    color: ScoreboardColors.text.highlight,
  },

  closeButton: {
    minWidth: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: ScoreboardColors.button.background,
    borderRadius: moderateScale(6),
    paddingHorizontal: moderateScale(12),
  },

  closeButtonText: {
    fontSize: moderateScale(14),
    color: ScoreboardColors.button.text,
    fontWeight: '600',
  },

  // -------------------------------------------------------------------------
  // Score Table Styles
  // -------------------------------------------------------------------------
  
  tableContainer: {
    borderWidth: 1,
    borderColor: ScoreboardColors.border.table,
    borderRadius: moderateScale(6),
    overflow: 'hidden',
  },

  tableScrollView: {
    maxHeight: SCREEN_HEIGHT * 0.5,
  },

  tableHeaderRow: {
    flexDirection: 'row',
    backgroundColor: ScoreboardColors.background.tableHeader,
    borderBottomWidth: 2,
    borderBottomColor: ScoreboardColors.border.table,
  },

  tableHeaderCell: {
    flex: 1,
    paddingVertical: moderateScale(10),
    paddingHorizontal: moderateScale(8),
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: moderateScale(80),
  },

  tableHeaderCellFirst: {
    minWidth: moderateScale(60),
    alignItems: 'flex-start',
  },

  tableHeaderText: {
    fontSize: moderateScale(12),
    fontWeight: '700',
    color: ScoreboardColors.text.primary,
    textAlign: 'center',
  },

  tableHeaderTextCurrent: {
    color: ScoreboardColors.text.currentPlayer,
  },

  tableRow: {
    flexDirection: 'row',
    backgroundColor: ScoreboardColors.background.tableRow,
    borderBottomWidth: 1,
    borderBottomColor: ScoreboardColors.border.table,
  },

  tableRowAlt: {
    backgroundColor: ScoreboardColors.background.tableRowAlt,
  },

  tableRowCurrent: {
    backgroundColor: ScoreboardColors.background.currentMatch,
  },

  tableCell: {
    flex: 1,
    paddingVertical: moderateScale(8),
    paddingHorizontal: moderateScale(8),
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: moderateScale(80),
  },

  tableCellFirst: {
    minWidth: moderateScale(60),
    alignItems: 'flex-start',
  },

  tableCellText: {
    fontSize: moderateScale(13),
    color: ScoreboardColors.text.primary,
    textAlign: 'center',
  },

  tableCellLabel: {
    fontSize: moderateScale(11),
    color: ScoreboardColors.text.secondary,
    fontWeight: '600',
  },

  totalRow: {
    backgroundColor: ScoreboardColors.background.tableHeader,
    borderTopWidth: 2,
    borderTopColor: ScoreboardColors.border.highlight,
  },

  totalCell: {
    paddingVertical: moderateScale(10),
  },

  totalCellText: {
    fontSize: moderateScale(14),
    fontWeight: '700',
  },

  // -------------------------------------------------------------------------
  // Play History Modal Styles
  // -------------------------------------------------------------------------
  
  modalOverlay: {
    flex: 1,
    backgroundColor: ScoreboardColors.background.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: moderateScale(20),
  },

  modalContainer: {
    backgroundColor: ScoreboardColors.background.modal,
    borderRadius: moderateScale(12),
    width: isPortrait ? SCREEN_WIDTH * 0.9 : moderateScale(600),
    maxHeight: SCREEN_HEIGHT * 0.8,
    ...Platform.select({
      ios: {
        shadowColor: ScoreboardColors.shadow.heavy,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.6,
        shadowRadius: 8,
      },
      android: {
        elevation: 12,
      },
    }),
  },

  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: moderateScale(16),
    borderBottomWidth: 1,
    borderBottomColor: ScoreboardColors.border.modal,
  },

  modalTitle: {
    fontSize: moderateScale(18),
    fontWeight: '700',
    color: ScoreboardColors.text.highlight,
  },

  modalCloseButton: {
    minWidth: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: ScoreboardColors.button.background,
    borderRadius: moderateScale(8),
    paddingHorizontal: moderateScale(16),
  },

  modalCloseButtonText: {
    fontSize: moderateScale(14),
    color: ScoreboardColors.button.text,
    fontWeight: '600',
  },

  modalContent: {
    padding: moderateScale(16),
    maxHeight: SCREEN_HEIGHT * 0.7,
  },

  modalScrollView: {
    flex: 1,
  },

  // -------------------------------------------------------------------------
  // Match Card Styles (Play History)
  // -------------------------------------------------------------------------
  
  matchCard: {
    backgroundColor: ScoreboardColors.matchCard.background,
    borderRadius: moderateScale(8),
    marginBottom: moderateScale(12),
    borderWidth: 1,
    borderColor: ScoreboardColors.matchCard.border,
    overflow: 'hidden',
  },

  matchCardCurrent: {
    backgroundColor: ScoreboardColors.matchCard.backgroundCurrent,
    borderColor: ScoreboardColors.border.highlight,
    borderWidth: 2,
  },

  matchCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: moderateScale(12),
    backgroundColor: ScoreboardColors.matchCard.headerBg,
    minHeight: MIN_TOUCH_TARGET,
  },

  matchCardHeaderTouchable: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  matchCardTitle: {
    fontSize: moderateScale(14),
    fontWeight: '700',
    color: ScoreboardColors.matchCard.headerText,
  },

  matchCardIcon: {
    fontSize: moderateScale(16),
    color: ScoreboardColors.button.icon,
  },

  matchCardContent: {
    padding: moderateScale(12),
    gap: moderateScale(8),
  },

  // -------------------------------------------------------------------------
  // Hand Card Styles (Individual Plays)
  // -------------------------------------------------------------------------
  
  handCard: {
    backgroundColor: ScoreboardColors.handCard.background,
    borderRadius: moderateScale(6),
    padding: moderateScale(10),
    borderWidth: 1,
    borderColor: ScoreboardColors.handCard.border,
    marginBottom: moderateScale(8),
  },

  handCardLatest: {
    backgroundColor: ScoreboardColors.handCard.backgroundLatest,
    borderColor: ScoreboardColors.handCard.borderLatest,
    borderWidth: 2,
  },

  handCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: moderateScale(8),
  },

  handPlayerName: {
    fontSize: moderateScale(13),
    fontWeight: '600',
    color: ScoreboardColors.handCard.playerName,
  },

  handComboType: {
    fontSize: moderateScale(11),
    color: ScoreboardColors.handCard.comboType,
    fontStyle: 'italic',
  },

  handCardsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: moderateScale(4),
  },

  // -------------------------------------------------------------------------
  // Card Image Styles
  // -------------------------------------------------------------------------
  
  cardImage: {
    borderRadius: moderateScale(4),
    borderWidth: 1,
    borderColor: ScoreboardColors.border.card,
    ...Platform.select({
      ios: {
        shadowColor: ScoreboardColors.shadow.card,
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.4,
        shadowRadius: 2,
      },
      android: {
        elevation: 2,
      },
    }),
  },

  cardImageSmall: {
    width: moderateScale(35),
    height: moderateScale(51),
  },

  cardImageMedium: {
    width: moderateScale(50),
    height: moderateScale(73),
  },

  // -------------------------------------------------------------------------
  // Utility Styles
  // -------------------------------------------------------------------------
  
  divider: {
    height: 1,
    backgroundColor: ScoreboardColors.border.primary,
    marginVertical: moderateScale(8),
  },

  emptyState: {
    padding: moderateScale(32),
    alignItems: 'center',
    justifyContent: 'center',
  },

  emptyStateText: {
    fontSize: moderateScale(14),
    color: ScoreboardColors.text.muted,
    textAlign: 'center',
  },

  badge: {
    backgroundColor: ScoreboardColors.status.playing,
    borderRadius: moderateScale(12),
    paddingHorizontal: moderateScale(8),
    paddingVertical: moderateScale(4),
    minWidth: moderateScale(24),
    alignItems: 'center',
    justifyContent: 'center',
  },

  badgeText: {
    fontSize: moderateScale(10),
    color: '#FFFFFF',
    fontWeight: '700',
  },
});

// ============================================================================
// RESPONSIVE HELPERS
// ============================================================================

export const responsive = {
  scale,
  verticalScale,
  moderateScale,
  isPortrait,
  screenWidth: SCREEN_WIDTH,
  screenHeight: SCREEN_HEIGHT,
  minTouchTarget: MIN_TOUCH_TARGET,
  fontScale,
};

// ============================================================================
// EXPORTS
// ============================================================================

export default scoreboardStyles;
