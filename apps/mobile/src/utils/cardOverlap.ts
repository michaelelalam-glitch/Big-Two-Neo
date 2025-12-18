/**
 * Card Overlap Utilities
 * 
 * Adaptive calculations for card overlap in landscape mode
 * Ensures cards fit within container with optimal spacing
 * 
 * Task #461: Implement adaptive card overlap calculations
 * Date: December 19, 2025
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface CardOverlapResult {
  /** Spacing between cards (marginLeft) */
  cardSpacing: number;
  /** Total width of card hand */
  totalWidth: number;
  /** Overlap percentage (0-1) */
  overlapPercentage: number;
}

// ============================================================================
// CORE FUNCTIONS
// ============================================================================

/**
 * Calculate adaptive card overlap based on container width
 * 
 * Algorithm:
 * 1. Start with preferred spacing (50% overlap = cardWidth * 0.5)
 * 2. Calculate total width: firstCard + (spacing × remaining cards)
 * 3. If width exceeds container, reduce spacing proportionally
 * 4. Clamp spacing to minimum value (e.g., 20pt)
 * 
 * @param cardCount - Number of cards
 * @param cardWidth - Width of single card (e.g., 72pt)
 * @param availableWidth - Container width minus padding
 * @param preferredSpacing - Ideal spacing between cards (e.g., 36pt for 50% overlap)
 * @param minSpacing - Minimum spacing (e.g., 20pt for 72% overlap)
 * @returns CardOverlapResult with spacing, total width, and overlap percentage
 */
export function calculateCardOverlap(
  cardCount: number,
  cardWidth: number,
  availableWidth: number,
  preferredSpacing: number = cardWidth * 0.5,
  minSpacing: number = cardWidth * 0.28
): CardOverlapResult {
  // Handle edge cases
  if (cardCount <= 0) {
    return {
      cardSpacing: 0,
      totalWidth: 0,
      overlapPercentage: 0,
    };
  }

  if (cardCount === 1) {
    return {
      cardSpacing: 0,
      totalWidth: cardWidth,
      overlapPercentage: 0,
    };
  }

  // Calculate total width with preferred spacing
  // Formula: firstCard + (spacing × remaining cards)
  const preferredTotalWidth = cardWidth + (preferredSpacing * (cardCount - 1));

  // If preferred width fits, use it
  if (preferredTotalWidth <= availableWidth) {
    return {
      cardSpacing: preferredSpacing,
      totalWidth: preferredTotalWidth,
      overlapPercentage: 1 - (preferredSpacing / cardWidth),
    };
  }

  // Calculate required spacing to fit within container
  // Solve: cardWidth + (spacing × (count - 1)) = availableWidth
  // spacing = (availableWidth - cardWidth) / (count - 1)
  const requiredSpacing = (availableWidth - cardWidth) / (cardCount - 1);

  // Clamp to minimum spacing
  const finalSpacing = Math.max(requiredSpacing, minSpacing);
  const finalTotalWidth = cardWidth + (finalSpacing * (cardCount - 1));

  return {
    cardSpacing: Math.round(finalSpacing * 10) / 10, // Round to 1 decimal
    totalWidth: Math.round(finalTotalWidth),
    overlapPercentage: 1 - (finalSpacing / cardWidth),
  };
}

/**
 * Calculate overlap for specific device breakpoints
 * Optimized for common scenarios (phone vs tablet)
 * 
 * @param cardCount - Number of cards
 * @param deviceWidth - Screen width
 * @returns CardOverlapResult
 */
export function calculateResponsiveOverlap(
  cardCount: number,
  deviceWidth: number
): CardOverlapResult {
  // Device-specific settings
  const isTablet = deviceWidth >= 1024;
  const cardWidth = 72;
  
  // Tablet: More space, use less overlap
  if (isTablet) {
    const availableWidth = deviceWidth - 100; // More padding on tablets
    return calculateCardOverlap(
      cardCount,
      cardWidth,
      availableWidth,
      48, // Less overlap on tablets (33%)
      32  // Higher minimum (56%)
    );
  }

  // Phone: Less space, use more overlap
  const availableWidth = deviceWidth - 40; // Standard padding
  return calculateCardOverlap(
    cardCount,
    cardWidth,
    availableWidth,
    36, // Standard 50% overlap
    20  // Lower minimum (72% overlap)
  );
}

/**
 * Get card positions for absolute positioning
 * Useful for animations or complex layouts
 * 
 * @param cardCount - Number of cards
 * @param spacing - Card spacing from calculateCardOverlap
 * @returns Array of x positions
 */
export function getCardPositions(cardCount: number, spacing: number): number[] {
  const positions: number[] = [];
  
  for (let i = 0; i < cardCount; i++) {
    positions.push(i * spacing);
  }
  
  return positions;
}

/**
 * Calculate overlap percentage from spacing
 * 
 * @param spacing - Space between cards
 * @param cardWidth - Width of single card
 * @returns Overlap percentage (0-1)
 */
export function getOverlapPercentage(spacing: number, cardWidth: number): number {
  return 1 - (spacing / cardWidth);
}

/**
 * Calculate spacing from overlap percentage
 * 
 * @param overlapPercentage - Desired overlap (0-1)
 * @param cardWidth - Width of single card
 * @returns Spacing value
 */
export function getSpacingFromOverlap(overlapPercentage: number, cardWidth: number): number {
  return cardWidth * (1 - overlapPercentage);
}
