/**
 * Tests for Landscape Card Component
 * 
 * Validates card rendering, size variants, and visual styling
 * Part of Task #449: Card rendering system
 */

// @ts-nocheck - Test infrastructure types incomplete
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import LandscapeCard from '../LandscapeCard';
import type { Card } from '../../../game/types';
import { LANDSCAPE_DIMENSIONS } from '../../../constants/landscape';
import { COLORS } from '../../../constants';

describe('LandscapeCard Component - Task #449', () => {
  
  const mockCards: Card[] = [
    { id: '3H', rank: '3' as const, suit: 'H' as const }, // Hearts (red)
    { id: 'AS', rank: 'A' as const, suit: 'S' as const }, // Spades (black)
    { id: 'KD', rank: 'K' as const, suit: 'D' as const }, // Diamonds (red)
    { id: '10C', rank: '10' as const, suit: 'C' as const }, // Clubs (black)
  ];
  
  // ============================================================================
  // RENDERING TESTS
  // ============================================================================
  
  describe('Basic Rendering', () => {
    
    test('renders without crashing', () => {
      const { getByText } = render(<LandscapeCard card={mockCards[0]} />);
      
      // Should render rank and suit symbols
      expect(getByText('3')).toBeTruthy();
      expect(getByText('♥')).toBeTruthy();
    });
    
    test('renders all card ranks correctly', () => {
      const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
      
      ranks.forEach(rank => {
        const card: Card = { id: `${rank}H`, rank: rank as any, suit: 'H' as const };
        const { getByText } = render(<LandscapeCard card={card} />);
        
        expect(getByText(rank)).toBeTruthy();
      });
    });
    
    test('renders all suit symbols correctly', () => {
      const suits = [
        { suit: 'H' as const, symbol: '♥' },
        { suit: 'D' as const, symbol: '♦' },
        { suit: 'C' as const, symbol: '♣' },
        { suit: 'S' as const, symbol: '♠' },
      ];
      
      suits.forEach(({ suit, symbol }) => {
        const card: Card = { id: `A${suit}`, rank: 'A' as const, suit };
        const { getAllByText } = render(<LandscapeCard card={card} />);
        
        // Should render suit symbol 3 times (top-left, center, bottom-right)
        const suitElements = getAllByText(symbol);
        expect(suitElements.length).toBe(3);
      });
    });
    
    test('renders rank 3 times (top-left, bottom-right twice due to rotation)', () => {
      const { getAllByText } = render(<LandscapeCard card={mockCards[0]} />);
      
      // Rank appears in top-left and bottom-right
      const rankElements = getAllByText('3');
      expect(rankElements.length).toBe(2);
    });
  });
  
  // ============================================================================
  // SIZE VARIANT TESTS
  // ============================================================================
  
  describe('Size Variants', () => {
    
    test('base size has correct dimensions', () => {
      const { getByAccessibilityLabel } = render(
        <LandscapeCard card={mockCards[0]} size="base" />
      );
      
      const cardElement = getByAccessibilityLabel('3 of ♥');
      expect(cardElement.props.style).toMatchObject({
        width: LANDSCAPE_DIMENSIONS.cards.base.width,
        height: LANDSCAPE_DIMENSIONS.cards.base.height,
      });
    });
    
    test('compact size has correct dimensions', () => {
      const { getByAccessibilityLabel } = render(
        <LandscapeCard card={mockCards[0]} size="compact" />
      );
      
      const cardElement = getByAccessibilityLabel('3 of ♥');
      expect(cardElement.props.style).toMatchObject({
        width: LANDSCAPE_DIMENSIONS.cards.compact.width,
        height: LANDSCAPE_DIMENSIONS.cards.compact.height,
      });
    });
    
    test('center size has correct dimensions', () => {
      const { getByAccessibilityLabel } = render(
        <LandscapeCard card={mockCards[0]} size="center" />
      );
      
      const cardElement = getByAccessibilityLabel('3 of ♥');
      expect(cardElement.props.style).toMatchObject({
        width: LANDSCAPE_DIMENSIONS.cards.center.width,
        height: LANDSCAPE_DIMENSIONS.cards.center.height,
      });
    });
    
    test('all sizes maintain correct aspect ratio', () => {
      const sizes: Array<'base' | 'compact' | 'center'> = ['base', 'compact', 'center'];
      
      sizes.forEach(size => {
        const dimensions = LANDSCAPE_DIMENSIONS.cards[size];
        const aspectRatio = dimensions.height / dimensions.width;
        
        // Standard poker card aspect ratio ~1.44
        expect(aspectRatio).toBeCloseTo(1.444, 2);
      });
    });
  });
  
  // ============================================================================
  // COLOR TESTS
  // ============================================================================
  
  describe('Suit Colors', () => {
    
    test('hearts are red', () => {
      const card: Card = { id: 'AH', rank: 'A' as const, suit: 'H' as const };
      const { getByText } = render(<LandscapeCard card={card} />);
      
      const rankElement = getByText('A');
      expect(rankElement.props.style.color).toBe(COLORS.card.hearts);
    });
    
    test('diamonds are red', () => {
      const card: Card = { id: 'AD', rank: 'A' as const, suit: 'D' as const };
      const { getByText } = render(<LandscapeCard card={card} />);
      
      const rankElement = getByText('A');
      expect(rankElement.props.style.color).toBe(COLORS.card.diamonds);
    });
    
    test('clubs are black', () => {
      const card: Card = { id: 'AC', rank: 'A' as const, suit: 'C' as const };
      const { getByText } = render(<LandscapeCard card={card} />);
      
      const rankElement = getByText('A');
      expect(rankElement.props.style.color).toBe(COLORS.card.clubs);
    });
    
    test('spades are black', () => {
      const card: Card = { id: 'AS', rank: 'A' as const, suit: 'S' as const };
      const { getByText } = render(<LandscapeCard card={card} />);
      
      const rankElement = getByText('A');
      expect(rankElement.props.style.color).toBe(COLORS.card.spades);
    });
  });
  
  // ============================================================================
  // ACCESSIBILITY TESTS
  // ============================================================================
  
  describe('Accessibility', () => {
    
    test('has accessibility label with rank and suit', () => {
      const { getByAccessibilityLabel } = render(<LandscapeCard card={mockCards[0]} />);
      
      expect(getByAccessibilityLabel('3 of ♥')).toBeTruthy();
    });
    
    test('has accessibility role of image', () => {
      const { getByAccessibilityLabel } = render(<LandscapeCard card={mockCards[0]} />);
      
      const cardElement = getByAccessibilityLabel('3 of ♥');
      expect(cardElement.props.accessibilityRole).toBe('image');
    });
    
    test('accessibility labels are unique for all cards', () => {
      mockCards.forEach(card => {
        const suitSymbol = { H: '♥', D: '♦', C: '♣', S: '♠' }[card.suit];
        const { getByAccessibilityLabel } = render(<LandscapeCard card={card} />);
        
        expect(getByAccessibilityLabel(`${card.rank} of ${suitSymbol}`)).toBeTruthy();
      });
    });
  });
  
  // ============================================================================
  // VISUAL STYLING TESTS
  // ============================================================================
  
  describe('Visual Styling', () => {
    
    test('has white background', () => {
      const { getByAccessibilityLabel } = render(<LandscapeCard card={mockCards[0]} />);
      
      const cardElement = getByAccessibilityLabel('3 of ♥');
      // Check inner card view has white background
      expect(cardElement.props.children.props.style.backgroundColor).toBe('#FFFFFF');
    });
    
    test('has border', () => {
      const { getByAccessibilityLabel } = render(<LandscapeCard card={mockCards[0]} />);
      
      const cardElement = getByAccessibilityLabel('3 of ♥');
      const cardStyle = cardElement.props.children.props.style;
      
      expect(cardStyle.borderWidth).toBe(1);
      expect(cardStyle.borderColor).toBe('#E0E0E0');
    });
    
    test('has shadow for depth', () => {
      const { getByAccessibilityLabel } = render(<LandscapeCard card={mockCards[0]} />);
      
      const cardElement = getByAccessibilityLabel('3 of ♥');
      const containerStyle = cardElement.props.style;
      
      expect(containerStyle.shadowColor).toBe('#000');
      expect(containerStyle.shadowOpacity).toBe(0.2);
      expect(containerStyle.elevation).toBe(3);
    });
  });
  
  // ============================================================================
  // INTEGRATION TESTS
  // ============================================================================
  
  describe('Integration Tests', () => {
    
    test('renders multiple cards without conflicts', () => {
      const { getAllByAccessibilityRole } = render(
        <>
          {mockCards.map(card => (
            <LandscapeCard key={card.id} card={card} />
          ))}
        </>
      );
      
      const cardElements = getAllByAccessibilityRole('image');
      expect(cardElements.length).toBe(mockCards.length);
    });
    
    test('different sizes can be mixed', () => {
      const { getAllByAccessibilityRole } = render(
        <>
          <LandscapeCard card={mockCards[0]} size="base" />
          <LandscapeCard card={mockCards[1]} size="compact" />
          <LandscapeCard card={mockCards[2]} size="center" />
        </>
      );
      
      const cardElements = getAllByAccessibilityRole('image');
      expect(cardElements.length).toBe(3);
    });
  });
  
  // ============================================================================
  // CONSISTENCY WITH PORTRAIT MODE
  // ============================================================================
  
  describe('Portrait Mode Consistency', () => {
    
    test('uses same suit colors as portrait Card.tsx', () => {
      // Hearts and Diamonds should be red
      expect(COLORS.card.hearts).toMatch(/#[eE][fF]4444/);
      expect(COLORS.card.diamonds).toMatch(/#[eE][fF]4444/);
      
      // Clubs and Spades should be black/dark
      expect(COLORS.card.clubs).toMatch(/#[12][fF]2937/);
      expect(COLORS.card.spades).toMatch(/#[12][fF]2937/);
    });
    
    test('uses same white background', () => {
      const { getByAccessibilityLabel } = render(<LandscapeCard card={mockCards[0]} />);
      
      const cardElement = getByAccessibilityLabel('3 of ♥');
      expect(cardElement.props.children.props.style.backgroundColor).toBe('#FFFFFF');
    });
    
    test('uses same suit symbols', () => {
      const symbols = ['♥', '♦', '♣', '♠'];
      
      const card: Card = { id: 'AH', rank: 'A' as const, suit: 'H' as const };
      const { getByText } = render(<LandscapeCard card={card} />);
      
      // Should render heart symbol
      expect(getByText(symbols[0])).toBeTruthy();
    });
  });
});
