/**
 * Styles for GameScreen (portrait mode layout).
 *
 * Extracted from GameScreen.tsx to reduce file length and separate concerns.
 */

import { StyleSheet } from 'react-native';
import { COLORS, SPACING, FONT_SIZES, LAYOUT, OVERLAYS, POSITIONING } from '../constants';

export const gameScreenStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.primary, // Dark background outside table
  },
  menuContainer: {
    position: 'absolute',
    top: POSITIONING.menuTop,
    right: SPACING.md,
    zIndex: 200,
  },
  menuIcon: {
    width: LAYOUT.menuIconSize,
    height: LAYOUT.menuIconSize,
    backgroundColor: OVERLAYS.menuBackground,
    borderRadius: LAYOUT.menuBorderRadius,
    alignItems: 'center',
    justifyContent: 'center',
    gap: LAYOUT.menuLineGap,
  },
  orientationToggleContainer: {
    position: 'absolute',
    top: POSITIONING.menuTop + LAYOUT.menuIconSize + SPACING.sm,
    right: SPACING.md,
    zIndex: 200,
    width: LAYOUT.menuIconSize,
    height: LAYOUT.menuIconSize,
    backgroundColor: OVERLAYS.menuBackground,
    borderRadius: LAYOUT.menuBorderRadius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orientationToggleIcon: {
    fontSize: 20,
    textAlign: 'center',
  },
  menuLine: {
    width: LAYOUT.menuLineWidth,
    height: LAYOUT.menuLineHeight,
    backgroundColor: COLORS.white,
    borderRadius: POSITIONING.menuLineBorderRadius,
  },
  // PlayerInfo - FULLY INDEPENDENT positioning
  playerInfoContainer: {
    position: 'absolute',
    bottom: POSITIONING.playerInfoBottom,
    left: POSITIONING.playerInfoLeft,
    zIndex: 250,
  },
  // Action buttons (Play/Pass) - FULLY INDEPENDENT positioning
  actionButtonsRow: {
    position: 'absolute',
    bottom: POSITIONING.actionButtonsBottom,
    right: POSITIONING.actionButtonsRight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    zIndex: 180,
  },
  // Helper Buttons (Sort/Smart/Hint) - FULLY INDEPENDENT positioning
  helperButtonsRow: {
    position: 'absolute',
    bottom: POSITIONING.helperButtonsBottom,
    left: POSITIONING.helperButtonsLeft,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    zIndex: 170,
  },
  // CARDS - FULLY INDEPENDENT positioning
  cardHandContainer: {
    position: 'absolute',
    bottom: POSITIONING.cardsBottom,
    left: 0,
    right: 0,
    zIndex: 50,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
  },
  loadingText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.xl,
    fontWeight: 'bold',
    marginBottom: SPACING.md,
  },
  loadingSubtext: {
    color: COLORS.gray.light,
    fontSize: FONT_SIZES.md,
  },
  // Spectator Mode Banner Styles
  spectatorBanner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(33, 150, 243, 0.95)', // Blue with transparency
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 1000, // Above everything
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  spectatorEmoji: {
    fontSize: 32,
    marginRight: SPACING.md,
  },
  spectatorTextContainer: {
    flex: 1,
  },
  spectatorTitle: {
    color: COLORS.white,
    fontSize: FONT_SIZES.md,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  spectatorDescription: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: FONT_SIZES.sm,
    lineHeight: 18,
  },
});
