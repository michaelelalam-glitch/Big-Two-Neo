/**
 * useLandscapeStyles Hook
 * 
 * Landscape-specific responsive styles for game room components
 * Based on iPhone 17 landscape (932×430pt) with adaptive scaling
 * 
 * Scoreboard Dimensions (from migration plan):
 * - Collapsed state: 120pt height (24pt header + 88pt player list + 8pt padding)
 * - Expanded state: 344pt max height (32pt header + scrollable content)
 * - Position: Top-left (20pt left, 60pt top from safe area)
 * - Max width: 280pt (compact for landscape)
 * 
 * Created as part of Task #454: Landscape scoreboard styles
 * Date: December 19, 2025
 */

import { useMemo } from 'react';
import { useWindowDimensions, Platform } from 'react-native';
import { ScoreboardColors } from '../../scoreboard/styles/colors';

/**
 * Landscape Scoreboard Styles Hook
 * Returns exact dimensions from migration plan
 */
export const useLandscapeScoreboardStyles = () => {
  const { width, height } = useWindowDimensions();
  
  // Detect landscape orientation
  const isLandscape = width > height;
  
  return useMemo(() => {
    // Base dimensions (from migration plan)
    const COLLAPSED_HEIGHT = 120;
    const EXPANDED_MAX_HEIGHT = 344;
    const MAX_WIDTH = 280;
    const TOP_POSITION = 8; // Closer to top
    const LEFT_POSITION = 0; // EXTREME LEFT as requested
    
    // Player row dimensions
    const PLAYER_ROW_HEIGHT = 22;
    const PLAYER_ROW_GAP = 3;
    const HEADER_HEIGHT = 24;
    const EXPANDED_HEADER_HEIGHT = 32;
    
    return {
      // ======================================================================
      // CONTAINER (Absolute positioning)
      // ======================================================================
      container: {
        position: 'absolute' as const,
        top: TOP_POSITION,
        left: LEFT_POSITION,
        maxWidth: MAX_WIDTH,
        zIndex: 1000,
        pointerEvents: 'box-none' as const,
        ...Platform.select({
          ios: {
            shadowColor: ScoreboardColors.shadow.heavy,
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.3,
            shadowRadius: 12,
          },
          android: {
            elevation: 12,
          },
        }),
      },

      // ======================================================================
      // COLLAPSED STATE (120pt height)
      // ======================================================================
      collapsedContainer: {
        backgroundColor: ScoreboardColors.background.compact,
        borderRadius: 8,
        padding: 8,
        minHeight: COLLAPSED_HEIGHT,
        maxWidth: MAX_WIDTH,
        pointerEvents: 'auto' as const,
      },

      collapsedHeader: {
        flexDirection: 'row' as const,
        justifyContent: 'space-between' as const,
        alignItems: 'center' as const,
        height: HEADER_HEIGHT,
        marginBottom: 6,
        paddingBottom: 6,
        borderBottomWidth: 1,
        borderBottomColor: ScoreboardColors.border.primary,
      },

      matchTitle: {
        fontSize: 14,
        fontWeight: '700' as const,
        color: ScoreboardColors.text.highlight,
        letterSpacing: 0.5,
      },

      headerButtons: {
        flexDirection: 'row' as const,
        gap: 8,
      },

      iconButton: {
        minWidth: 32,
        minHeight: 32,
        justifyContent: 'center' as const,
        alignItems: 'center' as const,
        backgroundColor: ScoreboardColors.button.background,
        borderRadius: 6,
        paddingHorizontal: 8,
      },

      iconButtonText: {
        fontSize: 12,
        color: ScoreboardColors.button.text,
        fontWeight: '600' as const,
      },

      playerList: {
        gap: PLAYER_ROW_GAP,
      },

      playerRow: {
        flexDirection: 'row' as const,
        justifyContent: 'space-between' as const,
        alignItems: 'center' as const,
        height: PLAYER_ROW_HEIGHT,
        paddingVertical: 4,
        paddingHorizontal: 8,
        borderRadius: 4,
        backgroundColor: 'transparent',
      },

      playerRowCurrent: {
        backgroundColor: ScoreboardColors.background.currentMatch,
        borderLeftWidth: 3,
        borderLeftColor: ScoreboardColors.border.highlight,
      },

      playerName: {
        fontSize: 13,
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
        gap: 8,
      },

      cardCount: {
        fontSize: 11,
        color: ScoreboardColors.text.secondary,
        fontWeight: '500' as const,
      },

      playerScore: {
        fontSize: 13,
        fontWeight: '700' as const,
        minWidth: 45,
        textAlign: 'right' as const,
      },

      // ======================================================================
      // EXPANDED STATE (344pt max height, scrollable)
      // ======================================================================
      expandedContainer: {
        backgroundColor: ScoreboardColors.background.expanded,
        borderRadius: 8,
        padding: 8,
        width: MAX_WIDTH, // Use fixed width instead of maxWidth for visibility
        maxHeight: EXPANDED_MAX_HEIGHT,
        pointerEvents: 'auto' as const,
        overflow: 'hidden' as const, // Ensure content is clipped properly
      },

      expandedHeader: {
        flexDirection: 'row' as const,
        justifyContent: 'space-between' as const,
        alignItems: 'center' as const,
        height: EXPANDED_HEADER_HEIGHT,
        marginBottom: 8,
        paddingBottom: 8,
        borderBottomWidth: 1,
        borderBottomColor: ScoreboardColors.border.primary,
      },

      expandedTitle: {
        fontSize: 14,
        fontWeight: '700' as const,
        color: ScoreboardColors.text.highlight,
        letterSpacing: 0.5,
        flex: 1,
      },

      closeButton: {
        minHeight: 32,
        justifyContent: 'center' as const,
        alignItems: 'center' as const,
        backgroundColor: ScoreboardColors.button.background,
        borderRadius: 6,
        paddingHorizontal: 12,
        paddingVertical: 6,
      },

      closeButtonText: {
        fontSize: 12,
        color: ScoreboardColors.button.text,
        fontWeight: '600' as const,
      },

      // ======================================================================
      // TABLE STYLES (Expanded view)
      // ======================================================================
      tableContainer: {
        flex: 1,
        overflow: 'hidden' as const,
      },

      tableScrollView: {
        flex: 1,
      },

      tableHeaderRow: {
        flexDirection: 'row' as const,
        backgroundColor: ScoreboardColors.background.tableHeader,
        borderTopLeftRadius: 6,
        borderTopRightRadius: 6,
        paddingVertical: 8,
        paddingHorizontal: 4,
      },

      tableHeaderCell: {
        flex: 1,
        justifyContent: 'center' as const,
        alignItems: 'center' as const,
        paddingHorizontal: 4,
      },

      tableHeaderCellFirst: {
        flex: 0.6,
        alignItems: 'flex-start' as const,
        paddingLeft: 8,
      },

      tableHeaderText: {
        fontSize: 11,
        fontWeight: '700' as const,
        color: ScoreboardColors.text.secondary,
        textTransform: 'uppercase' as const,
        letterSpacing: 0.5,
      },

      tableHeaderTextCurrent: {
        color: ScoreboardColors.text.currentPlayer,
      },

      tableRow: {
        flexDirection: 'row' as const,
        backgroundColor: ScoreboardColors.background.tableRow,
        paddingVertical: 8,
        paddingHorizontal: 4,
        borderBottomWidth: 1,
        borderBottomColor: ScoreboardColors.border.table,
      },

      tableRowAlt: {
        backgroundColor: ScoreboardColors.background.tableRowAlt,
      },

      tableRowCurrent: {
        backgroundColor: ScoreboardColors.background.currentMatch,
        borderLeftWidth: 3,
        borderLeftColor: ScoreboardColors.border.highlight,
      },

      tableTotalRow: {
        flexDirection: 'row' as const,
        backgroundColor: ScoreboardColors.background.tableHeader,
        borderBottomLeftRadius: 6,
        borderBottomRightRadius: 6,
        paddingVertical: 10,
        paddingHorizontal: 4,
        borderTopWidth: 2,
        borderTopColor: ScoreboardColors.border.primary,
      },

      tableCell: {
        flex: 1,
        justifyContent: 'center' as const,
        alignItems: 'center' as const,
        paddingHorizontal: 4,
      },

      tableCellFirst: {
        flex: 0.6,
        alignItems: 'flex-start' as const,
        paddingLeft: 8,
      },

      tableCellText: {
        fontSize: 12,
        fontWeight: '600' as const,
        color: ScoreboardColors.text.primary,
      },

      tableCellLabel: {
        fontSize: 10,
        fontWeight: '400' as const,
        color: ScoreboardColors.text.muted,
        marginTop: 2,
      },

      tableTotalText: {
        fontSize: 13,
        fontWeight: '700' as const,
        color: ScoreboardColors.text.highlight,
      },
    };
  }, [width, height, isLandscape]);
};
