/**
 * Tests for Card Overlap Utilities
 * 
 * Task #461: Implement adaptive card overlap calculations
 * Date: December 19, 2025
 */

import {
  calculateCardOverlap,
  calculateResponsiveOverlap,
  getCardPositions,
  getOverlapPercentage,
  getSpacingFromOverlap,
} from '../cardOverlap';

// ============================================================================
// TEST SUITE: calculateCardOverlap
// ============================================================================

describe('calculateCardOverlap - Basic Calculations', () => {
  it('returns zero values for zero cards', () => {
    const result = calculateCardOverlap(0, 72, 800);
    
    expect(result.cardSpacing).toBe(0);
    expect(result.totalWidth).toBe(0);
    expect(result.overlapPercentage).toBe(0);
  });

  it('returns correct values for single card', () => {
    const result = calculateCardOverlap(1, 72, 800);
    
    expect(result.cardSpacing).toBe(0);
    expect(result.totalWidth).toBe(72);
    expect(result.overlapPercentage).toBe(0);
  });

  it('uses preferred spacing when cards fit', () => {
    const result = calculateCardOverlap(
      5,    // 5 cards
      72,   // 72pt width
      800,  // 800pt available
      36    // 36pt preferred spacing (50% overlap)
    );
    
    expect(result.cardSpacing).toBe(36);
    expect(result.totalWidth).toBe(216); // 72 + (36 × 4)
    expect(result.overlapPercentage).toBe(0.5); // 50% overlap
  });

  it('reduces spacing when cards do not fit', () => {
    const result = calculateCardOverlap(
      10,   // 10 cards
      72,   // 72pt width
      300,  // 300pt available (tight space)
      36    // 36pt preferred (would overflow)
    );
    
    // Required spacing: (300 - 72) / (10 - 1) = 228 / 9 = 25.33pt
    expect(result.cardSpacing).toBeCloseTo(25.3, 1);
    expect(result.totalWidth).toBeLessThanOrEqual(300);
    expect(result.overlapPercentage).toBeGreaterThan(0.5); // More than 50% overlap
  });

  it('clamps to minimum spacing', () => {
    const result = calculateCardOverlap(
      15,   // 15 cards
      72,   // 72pt width
      200,  // 200pt available (very tight)
      36,   // 36pt preferred
      20    // 20pt minimum
    );
    
    // Required spacing would be (200-72)/(15-1) = 9.14pt
    // Should clamp to minSpacing (20pt)
    expect(result.cardSpacing).toBe(20);
    expect(result.totalWidth).toBe(352); // 72 + (20 × 14) = 352pt (exceeds available)
  });
});

describe('calculateCardOverlap - Edge Cases', () => {
  it('handles negative card count', () => {
    const result = calculateCardOverlap(-5, 72, 800);
    
    expect(result.cardSpacing).toBe(0);
    expect(result.totalWidth).toBe(0);
    expect(result.overlapPercentage).toBe(0);
  });

  it('handles very large card count', () => {
    const result = calculateCardOverlap(100, 72, 5000, 36, 20);
    
    // Should reduce spacing significantly
    expect(result.cardSpacing).toBeGreaterThanOrEqual(20); // At least minimum
    expect(result.totalWidth).toBeGreaterThanOrEqual(72); // At least one card
  });

  it('handles very small available width', () => {
    const result = calculateCardOverlap(5, 72, 100, 36, 20);
    
    // Should clamp to minimum spacing
    expect(result.cardSpacing).toBe(20);
  });

  it('handles exact fit scenario', () => {
    const result = calculateCardOverlap(
      5,    // 5 cards
      72,   // 72pt width
      216,  // Exactly 216pt available
      36    // 36pt spacing
    );
    
    expect(result.cardSpacing).toBe(36);
    expect(result.totalWidth).toBe(216); // Exact fit
  });
});

describe('calculateCardOverlap - Overlap Percentage', () => {
  it('calculates 50% overlap correctly', () => {
    const result = calculateCardOverlap(5, 72, 800, 36); // 36 = 72 * 0.5
    
    expect(result.overlapPercentage).toBe(0.5);
  });

  it('calculates 67% overlap correctly', () => {
    const result = calculateCardOverlap(5, 72, 800, 24); // 24 = 72 * 0.33
    
    expect(result.overlapPercentage).toBeCloseTo(0.67, 2);
  });

  it('calculates 72% overlap (minimum) correctly', () => {
    const result = calculateCardOverlap(15, 72, 200, 36, 20); // Clamps to 20pt
    
    expect(result.overlapPercentage).toBeCloseTo(0.72, 2); // 1 - (20/72)
  });
});

// ============================================================================
// TEST SUITE: calculateResponsiveOverlap
// ============================================================================

describe('calculateResponsiveOverlap - Device Detection', () => {
  it('uses tablet settings for wide screens', () => {
    const result = calculateResponsiveOverlap(5, 1200); // Tablet width
    
    // Tablet: Less overlap (48pt spacing = 33% overlap)
    expect(result.cardSpacing).toBeGreaterThan(36); // More space than phones
  });

  it('uses phone settings for narrow screens', () => {
    const result = calculateResponsiveOverlap(5, 800); // Phone width
    
    // Phone: More overlap (36pt spacing = 50% overlap)
    expect(result.cardSpacing).toBeLessThanOrEqual(36);
  });

  it('handles breakpoint edge case (exactly 1024pt)', () => {
    const result = calculateResponsiveOverlap(5, 1024);
    
    // Should use tablet settings
    expect(result.cardSpacing).toBeGreaterThan(36);
  });
});

describe('calculateResponsiveOverlap - Available Width', () => {
  it('subtracts correct padding for tablets', () => {
    const deviceWidth = 1200;
    const result = calculateResponsiveOverlap(5, deviceWidth);
    
    // Tablet padding: 100pt (50pt each side)
    // Available: 1200 - 100 = 1100pt
    expect(result.totalWidth).toBeLessThanOrEqual(1100);
  });

  it('subtracts correct padding for phones', () => {
    const deviceWidth = 800;
    const result = calculateResponsiveOverlap(5, deviceWidth);
    
    // Phone padding: 40pt (20pt each side)
    // Available: 800 - 40 = 760pt
    expect(result.totalWidth).toBeLessThanOrEqual(760);
  });
});

// ============================================================================
// TEST SUITE: getCardPositions
// ============================================================================

describe('getCardPositions - Position Calculation', () => {
  it('returns correct positions for 5 cards with 36pt spacing', () => {
    const positions = getCardPositions(5, 36);
    
    expect(positions).toEqual([0, 36, 72, 108, 144]);
  });

  it('returns single position for 1 card', () => {
    const positions = getCardPositions(1, 36);
    
    expect(positions).toEqual([0]);
  });

  it('returns empty array for 0 cards', () => {
    const positions = getCardPositions(0, 36);
    
    expect(positions).toEqual([]);
  });

  it('handles fractional spacing', () => {
    const positions = getCardPositions(3, 25.5);
    
    expect(positions).toEqual([0, 25.5, 51]);
  });
});

// ============================================================================
// TEST SUITE: getOverlapPercentage
// ============================================================================

describe('getOverlapPercentage - Percentage Calculation', () => {
  it('calculates 50% overlap from 36pt spacing (72pt card)', () => {
    const percentage = getOverlapPercentage(36, 72);
    
    expect(percentage).toBe(0.5);
  });

  it('calculates 0% overlap (no overlap)', () => {
    const percentage = getOverlapPercentage(72, 72);
    
    expect(percentage).toBe(0);
  });

  it('calculates 100% overlap (cards stacked)', () => {
    const percentage = getOverlapPercentage(0, 72);
    
    expect(percentage).toBe(1);
  });

  it('calculates 67% overlap from 24pt spacing', () => {
    const percentage = getOverlapPercentage(24, 72);
    
    expect(percentage).toBeCloseTo(0.67, 2);
  });

  it('handles negative spacing (cards separated)', () => {
    const percentage = getOverlapPercentage(100, 72);
    
    expect(percentage).toBeLessThan(0); // Negative overlap = gap between cards
  });
});

// ============================================================================
// TEST SUITE: getSpacingFromOverlap
// ============================================================================

describe('getSpacingFromOverlap - Spacing Calculation', () => {
  it('calculates 36pt spacing from 50% overlap (72pt card)', () => {
    const spacing = getSpacingFromOverlap(0.5, 72);
    
    expect(spacing).toBe(36);
  });

  it('calculates 72pt spacing from 0% overlap', () => {
    const spacing = getSpacingFromOverlap(0, 72);
    
    expect(spacing).toBe(72);
  });

  it('calculates 0pt spacing from 100% overlap', () => {
    const spacing = getSpacingFromOverlap(1, 72);
    
    expect(spacing).toBe(0);
  });

  it('calculates 24pt spacing from 67% overlap', () => {
    const spacing = getSpacingFromOverlap(0.67, 72);
    
    expect(spacing).toBeCloseTo(23.76, 2);
  });

  it('handles fractional overlap percentage', () => {
    const spacing = getSpacingFromOverlap(0.333, 72);
    
    expect(spacing).toBeCloseTo(48.024, 2);
  });
});

// ============================================================================
// TEST SUITE: Integration Tests
// ============================================================================

describe('cardOverlap - Integration Tests', () => {
  it('round-trip conversion: spacing → overlap → spacing', () => {
    const originalSpacing = 36;
    const cardWidth = 72;
    
    const overlap = getOverlapPercentage(originalSpacing, cardWidth);
    const recoveredSpacing = getSpacingFromOverlap(overlap, cardWidth);
    
    expect(recoveredSpacing).toBeCloseTo(originalSpacing, 5);
  });

  it('matches calculateCardOverlap with getOverlapPercentage', () => {
    const result = calculateCardOverlap(5, 72, 800, 36);
    const manualOverlap = getOverlapPercentage(result.cardSpacing, 72);
    
    expect(result.overlapPercentage).toBeCloseTo(manualOverlap, 5);
  });

  it('positions array matches total width', () => {
    const result = calculateCardOverlap(5, 72, 800, 36);
    const positions = getCardPositions(5, result.cardSpacing);
    
    const calculatedTotalWidth = positions[positions.length - 1] + 72; // Last position + card width
    expect(calculatedTotalWidth).toBeCloseTo(result.totalWidth, 1);
  });
});

// ============================================================================
// TEST SUITE: Real-World Scenarios
// ============================================================================

describe('cardOverlap - Real-World Scenarios', () => {
  it('handles iPhone SE landscape (568pt)', () => {
    const result = calculateCardOverlap(
      13,   // Full hand
      72,   // Card width
      528,  // 568 - 40 padding
      36,   // Preferred spacing
      20    // Minimum spacing
    );
    
    expect(result.totalWidth).toBeLessThanOrEqual(528);
    expect(result.cardSpacing).toBeGreaterThanOrEqual(20);
  });

  it('handles iPhone 17 landscape (932pt)', () => {
    const result = calculateCardOverlap(
      13,   // Full hand
      72,   // Card width
      892,  // 932 - 40 padding
      36,   // Preferred spacing
      20    // Minimum spacing
    );
    
    expect(result.cardSpacing).toBe(36); // Should fit with preferred spacing
    expect(result.totalWidth).toBe(504); // 72 + (36 × 12)
  });

  it('handles iPad Pro landscape (1366pt)', () => {
    const result = calculateResponsiveOverlap(13, 1366);
    
    expect(result.totalWidth).toBeLessThanOrEqual(1266); // 1366 - 100 padding
    expect(result.overlapPercentage).toBeLessThan(0.5); // Less overlap on tablets
  });

  it('handles 3 cards (typical combo)', () => {
    const result = calculateCardOverlap(3, 72, 800, 36);
    
    expect(result.cardSpacing).toBe(36);
    expect(result.totalWidth).toBe(144); // 72 + (36 × 2)
  });

  it('handles 5 cards (full house)', () => {
    const result = calculateCardOverlap(5, 72, 800, 36);
    
    expect(result.cardSpacing).toBe(36);
    expect(result.totalWidth).toBe(216); // 72 + (36 × 4)
  });
});
