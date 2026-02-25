/**
 * Shared Score Display Styles (Task #590)
 *
 * Centralizes match number badge, score action button, and total score badge
 * styles + helpers used across GameScreen, LocalAIGameScreen,
 * MultiplayerGameScreen, PlayerInfo, and LandscapeOpponent.
 *
 * Single source of truth — update here to keep all screens consistent.
 */

import { StyleSheet } from 'react-native';
import { POSITIONING, OVERLAYS } from '../constants';

// ============================================================================
// SCORE BADGE HELPERS
// ============================================================================

/** Returns a background color for the total score badge based on sign. */
export function getScoreBadgeColor(score: number): string {
  if (score > 0) return '#4CAF50'; // green
  if (score < 0) return '#F44336'; // red
  return '#78909C'; // gray
}

/** Formats a numeric score for display. */
export function formatScore(score: number): string {
  return `${score}`;
}

// ============================================================================
// SHARED STYLES
// ============================================================================

/**
 * Match number pill + score action button styles shared across all game screens.
 */
export const scoreDisplayStyles = StyleSheet.create({
  // Match number display — top center
  matchNumberContainer: {
    position: 'absolute',
    top: POSITIONING.menuTop,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 150,
  },
  matchNumberBadge: {
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 215, 0, 0.4)',
  },
  matchNumberText: {
    color: '#FFD700',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  // Score action buttons — top left
  scoreActionContainer: {
    position: 'absolute',
    top: POSITIONING.menuTop,
    left: 12,
    flexDirection: 'row',
    gap: 8,
    zIndex: 150,
  },
  scoreActionButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: OVERLAYS.menuBackground,
    borderRadius: 10,
  },
  scoreActionButtonText: {
    fontSize: 18,
  },

  // Total score badge (positioned on avatar, bottom-left)
  scoreBadgePosition: {
    position: 'absolute',
    bottom: -6,
    left: -6,
    zIndex: 10,
  },
  scoreBadge: {
    minWidth: 32,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.8)',
  },
  scoreBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center',
    color: '#FFFFFF',
  },
});
