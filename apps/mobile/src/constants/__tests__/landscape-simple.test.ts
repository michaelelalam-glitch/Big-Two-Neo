/**
 * Simplified Tests for Landscape Layout Constants - Task #456
 * Tests core functionality: base specs, device detection, and scaling
 */

import {
  LANDSCAPE_BASE,
  BREAKPOINTS,
  getDeviceCategory,
  LANDSCAPE_DIMENSIONS,
  LANDSCAPE_POSITIONING,
  scaleWidth,
  scaleHeight,
  scaleFont,
  clamp,
  scaleClamped,
} from '../landscape';

describe('Landscape Constants - Task #456 (Simplified)', () => {
  
  describe('Base Specifications', () => {
    test('has correct screen dimensions', () => {
      expect(LANDSCAPE_BASE.width).toBe(932);
      expect(LANDSCAPE_BASE.height).toBe(430);
    });
    
    test('has correct safe area insets', () => {
      expect(LANDSCAPE_BASE.safeArea.left).toBe(59);
      expect(LANDSCAPE_BASE.safeArea.right).toBe(59);
      expect(LANDSCAPE_BASE.safeArea.bottom).toBe(21);
    });
    
    test('calculates usable area correctly', () => {
      expect(LANDSCAPE_BASE.usableArea.width).toBe(814);
      expect(LANDSCAPE_BASE.usableArea.height).toBe(409);
    });
  });
  
  describe('Device Breakpoints', () => {
    test('categorizes devices correctly', () => {
      expect(getDeviceCategory(568)).toBe('phoneSmall');
      expect(getDeviceCategory(667)).toBe('phoneMedium');
      expect(getDeviceCategory(932)).toBe('phoneLarge');
      expect(getDeviceCategory(1024)).toBe('tabletSmall');
      expect(getDeviceCategory(1366)).toBe('tabletLarge');
    });
  });
  
  describe('Layout Dimensions', () => {
    test('table has correct dimensions', () => {
      expect(LANDSCAPE_DIMENSIONS.table.width).toBe(420);
      expect(LANDSCAPE_DIMENSIONS.table.height).toBe(240);
    });
    
    test('cards have correct aspect ratio', () => {
      const { width, height } = LANDSCAPE_DIMENSIONS.cards.base;
      expect(width).toBe(72);
      expect(height).toBe(104);
      expect(height / width).toBeCloseTo(1.444, 2);
    });
    
    test('control bar meets touch target minimum', () => {
      expect(LANDSCAPE_DIMENSIONS.controlBar.buttonHeight).toBeGreaterThanOrEqual(44);
    });
  });
  
  describe('Scaling Functions', () => {
    test('scaleWidth works correctly', () => {
      expect(scaleWidth(100, 932)).toBeCloseTo(100, 1);
      expect(scaleWidth(100, 667)).toBeCloseTo(71.6, 1);
    });
    
    test('scaleHeight works correctly', () => {
      expect(scaleHeight(100, 430)).toBeCloseTo(100, 1);
    });
    
    test('clamp restricts values', () => {
      expect(clamp(50, 0, 100)).toBe(50);
      expect(clamp(-10, 0, 100)).toBe(0);
      expect(clamp(150, 0, 100)).toBe(100);
    });
  });
});
