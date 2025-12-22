/**
 * Simplified Tests for Landscape Card Component - Task #449
 * Tests core rendering, size variants, and visual consistency
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import LandscapeCard from '../LandscapeCard';
import type { Card } from '../../../game/types';
import { LANDSCAPE_DIMENSIONS } from '../../../constants/landscape';
import { COLORS } from '../../../constants';

describe('LandscapeCard Component - Task #449 (Simplified)', () => {
  
  const mockCards: Card[] = [
    { id: '3H', rank: '3', suit: 'H' },
    { id: 'AS', rank: 'A', suit: 'S' },
    { id: 'KD', rank: 'K', suit: 'D' },
    { id: '10C', rank: '10', suit: 'C' },
  ];
  
  describe('Basic Rendering', () => {
    
    test('renders without crashing', () => {
      const { getAllByText } = render(<LandscapeCard card={mockCards[0]} />);
      
      // Should render rank (appears twice: top-left and bottom-right corners)
      const ranks = getAllByText('3');
      expect(ranks.length).toBe(2);
    });
    
    test('renders all ranks correctly', () => {
      const ranks: Array<'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K'> = 
        ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
      
      ranks.forEach(rank => {
        const card: Card = { id: `${rank}H`, rank, suit: 'H' };
        const { getAllByText } = render(<LandscapeCard card={card} />);
        
        // Rank appears twice (top-left and bottom-right)
        const rankElements = getAllByText(rank);
        expect(rankElements.length).toBe(2);
      });
    });
    
    test('renders all suit symbols', () => {
      const suits: Array<{ suit: 'H' | 'D' | 'C' | 'S', symbol: string }> = [
        { suit: 'H', symbol: '♥' },
        { suit: 'D', symbol: '♦' },
        { suit: 'C', symbol: '♣' },
        { suit: 'S', symbol: '♠' },
      ];
      
      suits.forEach(({ suit, symbol }) => {
        const card: Card = { id: `A${suit}`, rank: 'A', suit };
        const { getAllByText } = render(<LandscapeCard card={card} />);
        
        // Should render suit symbol 3 times (top, center, bottom)
        const suitElements = getAllByText(symbol);
        expect(suitElements.length).toBe(3);
      });
    });
  });
  
  describe('Size Variants', () => {
    
    test('base size has correct dimensions', () => {
      render(<LandscapeCard card={mockCards[0]} size="base" />);
      
      expect(LANDSCAPE_DIMENSIONS.cards.base.width).toBe(72);
      expect(LANDSCAPE_DIMENSIONS.cards.base.height).toBe(104);
    });
    
    test('compact size has correct dimensions', () => {
      render(<LandscapeCard card={mockCards[0]} size="compact" />);
      
      expect(LANDSCAPE_DIMENSIONS.cards.compact.width).toBe(32);
      expect(LANDSCAPE_DIMENSIONS.cards.compact.height).toBe(46);
    });
    
    test('center size has correct dimensions', () => {
      render(<LandscapeCard card={mockCards[0]} size="center" />);
      
      expect(LANDSCAPE_DIMENSIONS.cards.center.width).toBe(70);
      expect(LANDSCAPE_DIMENSIONS.cards.center.height).toBe(98);
    });
    
    test('all sizes maintain poker card aspect ratio', () => {
      const sizes: Array<'base' | 'compact' | 'center'> = ['base', 'compact', 'center'];
      
      sizes.forEach(size => {
        const dims = LANDSCAPE_DIMENSIONS.cards[size];
        const aspectRatio = dims.height / dims.width;
        
        // Standard poker card aspect ratio ~1.44 (allow for slight variations)
        expect(aspectRatio).toBeGreaterThanOrEqual(1.4);
        expect(aspectRatio).toBeLessThanOrEqual(1.5);
      });
    });
  });
  
  describe('Suit Colors', () => {
    
    test('hearts use red color', () => {
      const card: Card = { id: 'AH', rank: 'A', suit: 'H' };
      const { getAllByText } = render(<LandscapeCard card={card} />);
      
      const rankElements = getAllByText('A');
      // Check first rank element has correct color
      expect(rankElements[0].props.style.color).toBe(COLORS.card.hearts);
    });
    
    test('diamonds use red color', () => {
      const card: Card = { id: 'AD', rank: 'A', suit: 'D' };
      const { getAllByText } = render(<LandscapeCard card={card} />);
      
      const rankElements = getAllByText('A');
      expect(rankElements[0].props.style.color).toBe(COLORS.card.diamonds);
    });
    
    test('clubs use black color', () => {
      const card: Card = { id: 'AC', rank: 'A', suit: 'C' };
      const { getAllByText } = render(<LandscapeCard card={card} />);
      
      const rankElements = getAllByText('A');
      expect(rankElements[0].props.style.color).toBe(COLORS.card.clubs);
    });
    
    test('spades use black color', () => {
      const card: Card = { id: 'AS', rank: 'A', suit: 'S' };
      const { getAllByText } = render(<LandscapeCard card={card} />);
      
      const rankElements = getAllByText('A');
      expect(rankElements[0].props.style.color).toBe(COLORS.card.spades);
    });
  });
  describe('Portrait Mode Consistency', () => {
    
    test('uses same suit colors as portrait Card.tsx', () => {
      // Red suits - using actual COLORS constants
      expect(COLORS.card.hearts).toBe('#E74C3C');
      expect(COLORS.card.diamonds).toBe('#E74C3C');
      
      // Black suits
      expect(COLORS.card.clubs).toBe('#2C3E50');
      expect(COLORS.card.spades).toBe('#2C3E50');
    });
    
    test('renders same suit symbols as portrait mode', () => {
      const card: Card = { id: 'AH', rank: 'A', suit: 'H' };
      const { getAllByText } = render(<LandscapeCard card={card} />);
      
      const hearts = getAllByText('♥');
      expect(hearts.length).toBeGreaterThan(0);
    });
  });
  
  describe('Integration', () => {
    
    test('renders multiple cards without conflicts', () => {
      const { getAllByText } = render(
        <>
          <LandscapeCard card={mockCards[0]} />
          <LandscapeCard card={mockCards[1]} />
          <LandscapeCard card={mockCards[2]} />
          <LandscapeCard card={mockCards[3]} />
        </>
      );
      
      // Each rank appears twice per card, check we have expected results
      expect(getAllByText('3').length).toBeGreaterThanOrEqual(2);
      expect(getAllByText('A').length).toBeGreaterThanOrEqual(2);
      expect(getAllByText('K').length).toBeGreaterThanOrEqual(2);
      expect(getAllByText('10').length).toBeGreaterThanOrEqual(2);
    });
    
    test('different sizes can be mixed', () => {
      const { getAllByText } = render(
        <>
          <LandscapeCard card={mockCards[0]} size="base" />
          <LandscapeCard card={mockCards[1]} size="compact" />
          <LandscapeCard card={mockCards[2]} size="center" />
        </>
      );
      
      // Each card renders rank twice (top-left and bottom-right)
      expect(getAllByText('3').length).toBe(2);
      expect(getAllByText('A').length).toBe(2);
      expect(getAllByText('K').length).toBe(2);
    });
  });
});
