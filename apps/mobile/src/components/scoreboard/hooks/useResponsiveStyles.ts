/**
 * useResponsiveStyles Hook
 * 
 * Dynamically calculates responsive styles based on current window dimensions
 * Automatically updates when device orientation changes
 * 
 * Created as part of Task #359: Mobile screen size adaptations
 * Date: December 13, 2025
 */

import { useMemo } from 'react';
import { useWindowDimensions, Platform } from 'react-native';
import { ScoreboardColors } from '../styles/colors';

// Minimum touch target size (iOS HIG & Material Design)
const MIN_TOUCH_TARGET = 44;

/**
 * Calculate responsive scale factor based on current screen width
 * Base: 375 (iPhone 6/7/8 standard width)
 */
const getScale = (width: number) => (width / 375);

/**
 * Calculate responsive vertical scale factor based on current screen height
 * Base: 812 (iPhone X standard height)
 */
const getVerticalScale = (height: number) => (height / 812);

/**
 * Moderate scaling - less aggressive than linear scaling
 * @param size Base size
 * @param width Current window width
 * @param factor Scaling factor (0-1), where 0 = no scaling, 1 = full linear scaling
 */
const getModerateScale = (size: number, width: number, factor = 0.5) => {
  const scaled = getScale(width) * size;
  return size + (scaled - size) * factor;
};

export interface ResponsiveDimensions {
  scale: (size: number) => number;
  verticalScale: (size: number) => number;
  moderateScale: (size: number, factor?: number) => number;
  isPortrait: boolean;
  isLandscape: boolean;
  screenWidth: number;
  screenHeight: number;
  minTouchTarget: number;
  isSmallDevice: boolean;  // iPhone SE, etc.
  isMediumDevice: boolean; // Standard phones
  isLargeDevice: boolean;  // Tablets
}

/**
 * Hook to get responsive dimensions and scaling functions
 * Updates automatically when window dimensions change
 */
export const useResponsiveDimensions = (): ResponsiveDimensions => {
  const { width, height } = useWindowDimensions();

  return useMemo(() => {
    const isPortrait = height > width;
    const isLandscape = width > height;
    
    // Device size categories based on width
    const isSmallDevice = width < 375;   // iPhone SE (320-374)
    const isMediumDevice = width >= 375 && width < 768; // Standard phones (375-767)
    const isLargeDevice = width >= 768;  // Tablets (768+)

    return {
      scale: (size: number) => getScale(width) * size,
      verticalScale: (size: number) => getVerticalScale(height) * size,
      moderateScale: (size: number, factor = 0.5) => getModerateScale(size, width, factor),
      isPortrait,
      isLandscape,
      screenWidth: width,
      screenHeight: height,
      minTouchTarget: MIN_TOUCH_TARGET,
      isSmallDevice,
      isMediumDevice,
      isLargeDevice,
    };
  }, [width, height]);
};

/**
 * Generate responsive scoreboard container styles
 */
export const useScoreboardContainerStyles = () => {
  const dims = useResponsiveDimensions();

  return useMemo(() => ({
    container: {
      position: 'absolute' as const,
      top: dims.moderateScale(12),
      left: dims.moderateScale(12),
      maxWidth: dims.isPortrait 
        ? dims.screenWidth * 0.9 
        : dims.isLargeDevice 
          ? dims.moderateScale(500) 
          : dims.moderateScale(400),
      zIndex: 100,
      pointerEvents: 'box-none' as const, // Task #380: Allow touch events to pass through to elements below
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
  }), [dims]);
};

/**
 * Generate responsive compact scoreboard styles
 */
export const useCompactScoreboardStyles = () => {
  const dims = useResponsiveDimensions();

  return useMemo(() => ({
    compactContainer: {
      backgroundColor: ScoreboardColors.background.compact,
      borderRadius: dims.moderateScale(8),
      padding: dims.isSmallDevice ? dims.moderateScale(10) : dims.moderateScale(12),
      minWidth: dims.isSmallDevice ? dims.moderateScale(180) : dims.moderateScale(200),
      maxWidth: dims.isSmallDevice ? dims.moderateScale(280) : dims.moderateScale(320),
      pointerEvents: 'auto' as const, // Task #380: Capture touches on scoreboard content
    },

    compactHeader: {
      flexDirection: 'row' as const,
      justifyContent: 'space-between' as const,
      alignItems: 'center' as const,
      marginBottom: dims.moderateScale(8),
      paddingBottom: dims.moderateScale(8),
      borderBottomWidth: 1,
      borderBottomColor: ScoreboardColors.border.primary,
    },

    matchTitle: {
      fontSize: dims.isSmallDevice ? dims.moderateScale(12) : dims.moderateScale(14),
      fontWeight: '700' as const,
      color: ScoreboardColors.text.highlight,
      letterSpacing: 0.5,
    },

    headerButtons: {
      flexDirection: 'row' as const,
      gap: dims.moderateScale(8),
    },

    iconButton: {
      minWidth: dims.minTouchTarget,
      minHeight: dims.minTouchTarget,
      justifyContent: 'center' as const,
      alignItems: 'center' as const,
      backgroundColor: ScoreboardColors.button.background,
      borderRadius: dims.moderateScale(6),
      paddingHorizontal: dims.moderateScale(8),
    },

    iconButtonActive: {
      backgroundColor: ScoreboardColors.button.backgroundActive,
    },

    iconButtonText: {
      fontSize: dims.moderateScale(12),
      color: ScoreboardColors.button.text,
      fontWeight: '600' as const,
    },

    playerList: {
      gap: dims.moderateScale(6),
    },

    playerRow: {
      flexDirection: 'row' as const,
      justifyContent: 'space-between' as const,
      alignItems: 'center' as const,
      paddingVertical: dims.moderateScale(6),
      paddingHorizontal: dims.moderateScale(8),
      borderRadius: dims.moderateScale(4),
      backgroundColor: 'transparent',
    },

    playerRowCurrent: {
      backgroundColor: ScoreboardColors.background.currentMatch,
      borderLeftWidth: 3,
      borderLeftColor: ScoreboardColors.border.highlight,
    },

    playerName: {
      fontSize: dims.isSmallDevice ? dims.moderateScale(11) : dims.moderateScale(13),
      fontWeight: '500' as const,
      color: ScoreboardColors.text.primary,
      flex: 1,
    },

    playerNameCurrent: {
      color: ScoreboardColors.text.currentPlayer,
      fontWeight: '700' as const,
    },

    playerStats: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: dims.moderateScale(12),
    },

    cardCount: {
      fontSize: dims.moderateScale(12),
      color: ScoreboardColors.text.secondary,
      fontWeight: '500' as const,
    },

    playerScore: {
      fontSize: dims.moderateScale(14),
      fontWeight: '700' as const,
      minWidth: dims.moderateScale(40),
      textAlign: 'right' as const,
    },
  }), [dims]);
};

/**
 * Generate responsive expanded scoreboard styles
 */
export const useExpandedScoreboardStyles = () => {
  const dims = useResponsiveDimensions();

  return useMemo(() => ({
    expandedContainer: {
      backgroundColor: ScoreboardColors.background.expanded,
      borderRadius: dims.moderateScale(8),
      padding: dims.moderateScale(8),
      minWidth: dims.isLandscape 
        ? dims.screenWidth * 0.45  // Landscape: cover more horizontal space
        : dims.isSmallDevice ? dims.moderateScale(140) : dims.moderateScale(150),
      maxWidth: dims.isLandscape 
        ? dims.screenWidth * 0.65  // Landscape: INCREASED to cover player profile, cards, and name
        : dims.isSmallDevice ? dims.moderateScale(280) : dims.moderateScale(320),
      maxHeight: dims.isLandscape 
        ? dims.screenHeight * 0.92  // Landscape: INCREASED to cover bottom player area completely
        : dims.screenHeight * 0.85,
      // LANDSCAPE FIX: Position to cover bottom-left player area
      ...(dims.isLandscape && {
        position: 'absolute' as const,
        bottom: 0,  // Anchor to bottom to cover player's cards/name
        left: dims.moderateScale(20),
      }),
      pointerEvents: 'auto' as const, // Task #380: Capture touches on scoreboard content
    },

    expandedHeader: {
      flexDirection: 'row' as const,
      justifyContent: 'space-between' as const,
      alignItems: 'center' as const,
      marginBottom: dims.moderateScale(12), // SAME in both orientations
      paddingBottom: dims.moderateScale(12), // SAME in both orientations
      borderBottomWidth: 1,
      borderBottomColor: ScoreboardColors.border.primary,
    },

    expandedTitle: {
      fontSize: dims.isLandscape 
        ? dims.moderateScale(13)  // Landscape: slightly smaller
        : dims.isSmallDevice ? dims.moderateScale(14) : dims.moderateScale(16),
      fontWeight: '700' as const,
      color: ScoreboardColors.text.highlight,
    },

    headerButtons: {
      flexDirection: 'row' as const,
      gap: dims.moderateScale(8),
    },

    iconButton: {
      minWidth: dims.minTouchTarget,
      minHeight: dims.minTouchTarget,
      justifyContent: 'center' as const,
      alignItems: 'center' as const,
      backgroundColor: ScoreboardColors.button.background,
      borderRadius: dims.moderateScale(6),
      paddingHorizontal: dims.moderateScale(8),
    },

    iconButtonText: {
      fontSize: dims.moderateScale(12),
      color: ScoreboardColors.button.text,
      fontWeight: '600' as const,
    },

    closeButton: {
      minWidth: dims.minTouchTarget,
      minHeight: dims.minTouchTarget,
      justifyContent: 'center' as const,
      alignItems: 'center' as const,
      backgroundColor: ScoreboardColors.button.background,
      borderRadius: dims.moderateScale(6),
      paddingHorizontal: dims.moderateScale(12),
    },

    closeButtonText: {
      fontSize: dims.moderateScale(14),
      color: ScoreboardColors.button.text,
      fontWeight: '600' as const,
    },

    tableContainer: {
      borderWidth: 1,
      borderColor: ScoreboardColors.border.table,
      borderRadius: dims.moderateScale(6),
      overflow: 'hidden' as const,
    },

    tableScrollView: {
      maxHeight: dims.screenHeight * 0.7, // SAME in both orientations
    },

    tableHeaderRow: {
      flexDirection: 'row' as const,
      backgroundColor: ScoreboardColors.background.tableHeader,
      borderBottomWidth: 2,
      borderBottomColor: ScoreboardColors.border.table,
    },

    tableHeaderCell: {
      flex: 1,
      paddingVertical: dims.isLandscape ? dims.moderateScale(6) : dims.moderateScale(10),
      paddingHorizontal: dims.moderateScale(4),
      justifyContent: 'center' as const,
      alignItems: 'center' as const,
      width: dims.isLandscape ? dims.screenWidth * 0.13 : dims.screenWidth * 0.18,
    },

    tableHeaderCellFirst: {
      width: dims.isLandscape ? dims.screenWidth * 0.10 : dims.screenWidth * 0.15,
      alignItems: 'flex-start' as const,
    },

    tableHeaderText: {
      fontSize: dims.isLandscape 
        ? dims.moderateScale(11)  // Landscape: larger, readable text
        : dims.isSmallDevice ? dims.moderateScale(10) : dims.moderateScale(12),
      fontWeight: '700' as const,
      color: ScoreboardColors.text.primary,
      textAlign: 'center' as const,
    },

    tableHeaderTextCurrent: {
      color: ScoreboardColors.text.currentPlayer,
    },

    tableRow: {
      flexDirection: 'row' as const,
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
      paddingVertical: dims.isLandscape ? dims.moderateScale(5) : dims.moderateScale(8),
      paddingHorizontal: dims.moderateScale(4),
      justifyContent: 'center' as const,
      alignItems: 'center' as const,
      width: dims.isLandscape ? dims.screenWidth * 0.13 : dims.screenWidth * 0.18,
    },

    tableCellFirst: {
      width: dims.isLandscape ? dims.screenWidth * 0.10 : dims.screenWidth * 0.15,
      alignItems: 'flex-start' as const,
    },

    tableCellText: {
      fontSize: dims.isLandscape 
        ? dims.moderateScale(12)  // Landscape: larger, readable text
        : dims.isSmallDevice ? dims.moderateScale(11) : dims.moderateScale(13),
      color: ScoreboardColors.text.primary,
      textAlign: 'center' as const,
    },

    tableCellLabel: {
      fontSize: dims.isLandscape ? dims.moderateScale(10) : dims.moderateScale(11),
      color: ScoreboardColors.text.secondary,
      fontWeight: '600' as const,
    },

    totalRow: {
      backgroundColor: ScoreboardColors.background.tableHeader,
      borderTopWidth: 2,
      borderTopColor: ScoreboardColors.border.highlight,
    },

    totalCell: {
      paddingVertical: dims.moderateScale(10),
    },

    totalCellText: {
      fontSize: dims.moderateScale(14),
      fontWeight: '700' as const,
    },

    divider: {
      height: 1,
      backgroundColor: ScoreboardColors.border.primary,
      marginVertical: dims.moderateScale(8),
    },

    emptyState: {
      padding: dims.moderateScale(32),
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },

    emptyStateText: {
      fontSize: dims.moderateScale(14),
      color: ScoreboardColors.text.muted,
      textAlign: 'center' as const,
    },
  }), [dims]);
};

/**
 * Generate responsive play history modal styles
 */
export const usePlayHistoryModalStyles = () => {
  const dims = useResponsiveDimensions();

  return useMemo(() => ({
    modalOverlay: {
      flex: 1,
      backgroundColor: ScoreboardColors.background.overlay,
      // LANDSCAPE FIX: Position at top-left, not centered
      justifyContent: dims.isLandscape ? 'flex-start' as const : 'center' as const,
      alignItems: dims.isLandscape ? 'flex-start' as const : 'center' as const,
      padding: dims.isLandscape ? 0 : dims.moderateScale(20), // No padding in landscape
    },

    modalBackdrop: {
      position: 'absolute' as const,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    },

    modalContainer: {
      backgroundColor: ScoreboardColors.background.modal,
      borderRadius: dims.moderateScale(12),
      // LANDSCAPE FIX: Match expanded scoreboard width (65% of screen width)
      width: dims.isLandscape 
        ? dims.screenWidth * 0.65  // Match expanded scoreboard width
        : dims.screenWidth * 0.9,
      // LANDSCAPE FIX: Fill full screen height (92% to match expanded scoreboard)
      height: dims.isLandscape 
        ? dims.screenHeight * 0.92  // Full height like expanded scoreboard
        : dims.screenHeight * 0.75,
      // LANDSCAPE FIX: Position at top-left corner (absolute positioning)
      ...(dims.isLandscape && {
        position: 'absolute' as const,
        top: dims.moderateScale(20),  // Match expanded scoreboard top position
        left: dims.moderateScale(20),  // Match expanded scoreboard left position
      }),
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
      flexDirection: 'row' as const,
      justifyContent: 'space-between' as const,
      alignItems: 'center' as const,
      padding: dims.moderateScale(16),
      borderBottomWidth: 1,
      borderBottomColor: ScoreboardColors.border.modal,
    },

    modalTitle: {
      fontSize: dims.isLandscape 
        ? dims.moderateScale(14)  // Landscape: smaller title
        : dims.isSmallDevice ? dims.moderateScale(16) : dims.moderateScale(18),
      fontWeight: '700' as const,
      color: ScoreboardColors.text.highlight,
    },

    modalCloseButton: {
      minWidth: dims.minTouchTarget,
      minHeight: dims.minTouchTarget,
      justifyContent: 'center' as const,
      alignItems: 'center' as const,
      backgroundColor: ScoreboardColors.button.background,
      borderRadius: dims.moderateScale(8),
      paddingHorizontal: dims.moderateScale(16),
    },

    modalCloseButtonText: {
      fontSize: dims.moderateScale(14),
      color: ScoreboardColors.button.text,
      fontWeight: '600' as const,
    },

    modalContent: {
      flex: 1,
      padding: dims.moderateScale(16),
    },

    modalScrollView: {
      flex: 1,
    },

    matchCard: {
      backgroundColor: ScoreboardColors.matchCard.background,
      borderRadius: dims.moderateScale(8),
      marginBottom: dims.isLandscape ? dims.moderateScale(6) : dims.moderateScale(12),  // Landscape: tighter spacing
      borderWidth: 1,
      borderColor: ScoreboardColors.matchCard.border,
      overflow: 'hidden' as const,
    },

    matchCardCurrent: {
      backgroundColor: ScoreboardColors.matchCard.backgroundCurrent,
      borderColor: ScoreboardColors.border.highlight,
      borderWidth: 2,
    },

    matchCardHeader: {
      flexDirection: 'row' as const,
      justifyContent: 'space-between' as const,
      alignItems: 'center' as const,
      padding: dims.isLandscape ? dims.moderateScale(8) : dims.moderateScale(12),  // Landscape: more compact
      backgroundColor: ScoreboardColors.matchCard.headerBg,
      minHeight: dims.minTouchTarget,
    },

    matchCardHeaderTouchable: {
      flex: 1,
      flexDirection: 'row' as const,
      justifyContent: 'space-between' as const,
      alignItems: 'center' as const,
    },

    matchCardTitle: {
      fontSize: dims.isLandscape ? dims.moderateScale(12) : dims.moderateScale(14),  // Landscape: smaller text
      fontWeight: '700' as const,
      color: ScoreboardColors.matchCard.headerText,
    },

    matchCardIcon: {
      fontSize: dims.moderateScale(16),
      color: ScoreboardColors.button.icon,
    },

    matchCardContent: {
      padding: dims.isLandscape ? dims.moderateScale(8) : dims.moderateScale(12),  // Landscape: more compact
      gap: dims.isLandscape ? dims.moderateScale(6) : dims.moderateScale(8),  // Landscape: tighter spacing
    },

    handCard: {
      backgroundColor: ScoreboardColors.handCard.background,
      borderRadius: dims.moderateScale(6),
      padding: dims.moderateScale(10), // SAME in both orientations
      borderWidth: 1,
      borderColor: ScoreboardColors.handCard.border,
      marginBottom: dims.moderateScale(8), // SAME in both orientations
    },

    handCardLatest: {
      backgroundColor: ScoreboardColors.handCard.backgroundLatest,
      borderColor: ScoreboardColors.handCard.borderLatest,
      borderWidth: 2,
    },

    handCardHeader: {
      flexDirection: 'row' as const,
      justifyContent: 'space-between' as const,
      alignItems: 'center' as const,
      marginBottom: dims.moderateScale(8), // SAME in both orientations
    },

    handPlayerName: {
      fontSize: dims.moderateScale(13), // SAME in both orientations
      fontWeight: '600' as const,
      color: ScoreboardColors.handCard.playerName,
    },

    handComboType: {
      fontSize: dims.moderateScale(11), // SAME in both orientations
      color: ScoreboardColors.handCard.comboType,
      fontStyle: 'italic' as const,
    },

    handCardsContainer: {
      flexDirection: 'row' as const,
      flexWrap: 'wrap' as const,
      gap: dims.moderateScale(6),
      alignItems: 'center' as const,
    },

    cardImage: {
      borderRadius: dims.moderateScale(4),
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
      width: dims.moderateScale(35),
      height: dims.moderateScale(51),
    },

    cardImageMedium: {
      width: dims.moderateScale(50),
      height: dims.moderateScale(73),
    },

    badge: {
      backgroundColor: ScoreboardColors.status.playing,
      borderRadius: dims.moderateScale(12),
      paddingHorizontal: dims.moderateScale(8),
      paddingVertical: dims.moderateScale(4),
      minWidth: dims.moderateScale(24),
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },

    badgeText: {
      fontSize: dims.moderateScale(10),
      color: '#FFFFFF',
      fontWeight: '700' as const,
    },

    emptyState: {
      padding: dims.moderateScale(32),
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },

    emptyStateText: {
      fontSize: dims.moderateScale(14),
      color: ScoreboardColors.text.muted,
      textAlign: 'center' as const,
    },

    emptyStateTextSmall: {
      fontSize: dims.moderateScale(12),
      color: ScoreboardColors.text.muted,
      textAlign: 'center' as const,
      marginTop: dims.moderateScale(4),
    },

    divider: {
      height: 1,
      backgroundColor: ScoreboardColors.border.primary,
      marginVertical: dims.moderateScale(8),
    },

    tableCellLabel: {
      fontSize: dims.moderateScale(11),
      color: ScoreboardColors.text.secondary,
      fontWeight: '600' as const,
    },

    pastMatchesHeaderText: {
      fontSize: dims.moderateScale(11),
      color: ScoreboardColors.text.secondary,
      fontWeight: '600' as const,
      marginBottom: dims.moderateScale(8),
    },
  }), [dims]);
};
