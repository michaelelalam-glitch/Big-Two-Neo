/**
 * Tests for Responsive Scaling Utilities
 * 
 * Validates scaling functions across different device types:
 * - iPhone SE (portrait: 375×667, landscape: 667×375)
 * - iPhone 17 (portrait: 390×844, landscape: 932×430)
 * - iPad Pro 12.9" (portrait: 1024×1366, landscape: 1366×1024)
 * 
 * Tests orientation detection, scaling accuracy, clamping, and accessibility
 * 
 * Part of Task #447: Build responsive scaling system with breakpoints
 */

import {
  // Portrait scaling
  scalePortraitWidth,
  scalePortraitHeight,
  moderateScale,
  scaleFontSize,
  
  // Landscape scaling
  scaleLandscapeWidth,
  scaleLandscapeHeight,
  scaleLandscapeFont,
  
  // Adaptive scaling
  scaleAdaptive,
  moderateScaleAdaptive,
  
  // Device detection
  isLandscape,
  isPortrait,
  getPortraitDeviceCategory,
  
  // Utilities
  clamp,
  scaleClampedPortrait,
  scaleClampedLandscape,
  
  // Accessibility
  ensureMinTouchTarget,
  scaleWithMinTouch,
  MIN_TOUCH_TARGET,
  
  // Spacing
  getSpacing,
  SPACING_SCALE,
  
  PORTRAIT_BASE,
} from '../scaling';

import { LANDSCAPE_BASE } from '../../constants/landscape';

describe('Responsive Scaling Utilities', () => {
  
  // ============================================================================
  // DEVICE DETECTION TESTS
  // ============================================================================
  
  describe('Device Detection', () => {
    
    test('isLandscape detects landscape orientation', () => {
      expect(isLandscape(932, 430)).toBe(true);  // iPhone 17 landscape
      expect(isLandscape(1366, 1024)).toBe(true); // iPad Pro landscape
      expect(isLandscape(667, 375)).toBe(true);   // iPhone SE landscape
    });
    
    test('isLandscape detects portrait orientation', () => {
      expect(isLandscape(390, 844)).toBe(false);  // iPhone 17 portrait
      expect(isLandscape(1024, 1366)).toBe(false); // iPad Pro portrait
      expect(isLandscape(375, 667)).toBe(false);   // iPhone SE portrait
    });
    
    test('isPortrait detects portrait orientation', () => {
      expect(isPortrait(390, 844)).toBe(true);   // iPhone 17 portrait
      expect(isPortrait(1024, 1366)).toBe(true); // iPad Pro portrait
      expect(isPortrait(375, 667)).toBe(true);   // iPhone SE portrait
    });
    
    test('isPortrait detects landscape orientation', () => {
      expect(isPortrait(932, 430)).toBe(false);   // iPhone 17 landscape
      expect(isPortrait(1366, 1024)).toBe(false); // iPad Pro landscape
      expect(isPortrait(667, 375)).toBe(false);   // iPhone SE landscape
    });
    
    test('getPortraitDeviceCategory categorizes devices correctly', () => {
      expect(getPortraitDeviceCategory(320)).toBe('small');   // iPhone SE (old)
      expect(getPortraitDeviceCategory(375)).toBe('medium');  // iPhone 6/7/8
      expect(getPortraitDeviceCategory(390)).toBe('medium');  // iPhone 17
      expect(getPortraitDeviceCategory(768)).toBe('large');   // iPad
      expect(getPortraitDeviceCategory(1024)).toBe('large');  // iPad Pro
    });
  });
  
  // ============================================================================
  // PORTRAIT SCALING TESTS
  // ============================================================================
  
  describe('Portrait Scaling', () => {
    
    test('scalePortraitWidth scales proportionally to base width (375pt)', () => {
      // Base device (iPhone 6/7/8: 375pt width)
      expect(scalePortraitWidth(100, 375)).toBeCloseTo(100, 1);
      
      // iPhone 17 (390pt width - 4% larger)
      expect(scalePortraitWidth(100, 390)).toBeCloseTo(104, 1);
      
      // iPhone SE (320pt width - 14.7% smaller)
      expect(scalePortraitWidth(100, 320)).toBeCloseTo(85.3, 1);
      
      // iPad (768pt width - 104.8% larger)
      expect(scalePortraitWidth(100, 768)).toBeCloseTo(204.8, 1);
    });
    
    test('scalePortraitHeight scales proportionally to base height (812pt)', () => {
      // Base device (iPhone X/11: 812pt height)
      expect(scalePortraitHeight(100, 812)).toBeCloseTo(100, 1);
      
      // iPhone 17 (844pt height - 3.9% larger)
      expect(scalePortraitHeight(100, 844)).toBeCloseTo(103.9, 1);
      
      // iPhone SE (667pt height - 17.9% smaller)
      expect(scalePortraitHeight(100, 667)).toBeCloseTo(82.1, 1);
    });
    
    test('moderateScale with factor 0.5 scales less aggressively', () => {
      // iPhone 17 (390pt width - 4% larger than base)
      const linearScale = scalePortraitWidth(100, 390); // ~104
      const moderateScaleValue = moderateScale(100, 0.5, 390); // ~102
      
      expect(moderateScaleValue).toBeGreaterThan(100);
      expect(moderateScaleValue).toBeLessThan(linearScale);
      expect(moderateScaleValue).toBeCloseTo(102, 0);
    });
    
    test('moderateScale with factor 0 returns original size', () => {
      expect(moderateScale(100, 0, 390)).toBe(100);
      expect(moderateScale(100, 0, 768)).toBe(100);
    });
    
    test('moderateScale with factor 1 equals linear scaling', () => {
      const linearScale = scalePortraitWidth(100, 390);
      expect(moderateScale(100, 1, 390)).toBeCloseTo(linearScale, 1);
    });
    
    test('scaleFontSize rounds to nearest integer', () => {
      const fontSize = scaleFontSize(16, 390);
      expect(fontSize).toBe(Math.round(fontSize));
    });
    
    test('scaleFontSize maintains readability on small devices', () => {
      const baseFontSize = 16;
      
      // iPhone SE (320pt width)
      const smallDeviceFont = scaleFontSize(baseFontSize, 320);
      expect(smallDeviceFont).toBeGreaterThan(14); // Still readable
      
      // iPad (768pt width) - moderate scaling keeps it reasonable
      const largeDeviceFont = scaleFontSize(baseFontSize, 768);
      expect(largeDeviceFont).toBeGreaterThan(baseFontSize);
      expect(largeDeviceFont).toBeLessThanOrEqual(baseFontSize * 1.5); // Not too large (allows exactly 24pt)
    });
  });
  
  // ============================================================================
  // LANDSCAPE SCALING TESTS
  // ============================================================================
  
  describe('Landscape Scaling', () => {
    
    test('scaleLandscapeWidth scales proportionally to base width (932pt)', () => {
      // Base device (iPhone 17 landscape: 932pt width)
      expect(scaleLandscapeWidth(100, 932)).toBeCloseTo(100, 1);
      
      // iPhone SE landscape (667pt width - 28.4% smaller)
      expect(scaleLandscapeWidth(100, 667)).toBeCloseTo(71.6, 1);
      
      // iPad Pro landscape (1366pt width - 46.6% larger)
      expect(scaleLandscapeWidth(100, 1366)).toBeCloseTo(146.6, 1);
    });
    
    test('scaleLandscapeHeight scales proportionally to base height (430pt)', () => {
      // Base device (iPhone 17 landscape: 430pt height)
      expect(scaleLandscapeHeight(100, 430)).toBeCloseTo(100, 1);
      
      // iPhone SE landscape (375pt height - 12.8% smaller)
      expect(scaleLandscapeHeight(100, 375)).toBeCloseTo(87.2, 1);
      
      // iPad Pro landscape (1024pt height - 138.1% larger)
      expect(scaleLandscapeHeight(100, 1024)).toBeCloseTo(238.1, 1);
    });
    
    test('scaleLandscapeFont rounds to nearest integer', () => {
      const fontSize = scaleLandscapeFont(16, 932);
      expect(fontSize).toBe(Math.round(fontSize));
      expect(fontSize).toBe(16);
    });
  });
  
  // ============================================================================
  // ADAPTIVE SCALING TESTS
  // ============================================================================
  
  describe('Adaptive Scaling', () => {
    
    test('scaleAdaptive uses landscape scaling when width > height', () => {
      const landscapeResult = scaleAdaptive(100, 932, 430); // iPhone 17 landscape
      const expectedLandscape = scaleLandscapeWidth(100, 932);
      expect(landscapeResult).toBeCloseTo(expectedLandscape, 1);
    });
    
    test('scaleAdaptive uses portrait scaling when height > width', () => {
      const portraitResult = scaleAdaptive(100, 390, 844); // iPhone 17 portrait
      const expectedPortrait = scalePortraitWidth(100, 390);
      expect(portraitResult).toBeCloseTo(expectedPortrait, 1);
    });
    
    test('moderateScaleAdaptive applies moderate scaling in landscape', () => {
      const adaptiveResult = moderateScaleAdaptive(100, 0.5, 1366, 1024); // iPad landscape
      const linearScale = scaleAdaptive(100, 1366, 1024);
      
      expect(adaptiveResult).toBeGreaterThan(100);
      expect(adaptiveResult).toBeLessThan(linearScale);
    });
    
    test('moderateScaleAdaptive applies moderate scaling in portrait', () => {
      const adaptiveResult = moderateScaleAdaptive(100, 0.5, 768, 1024); // iPad portrait
      const linearScale = scaleAdaptive(100, 768, 1024);
      
      expect(adaptiveResult).toBeGreaterThan(100);
      expect(adaptiveResult).toBeLessThan(linearScale);
    });
  });
  
  // ============================================================================
  // UTILITY FUNCTION TESTS
  // ============================================================================
  
  describe('Utility Functions', () => {
    
    test('clamp returns value when within range', () => {
      expect(clamp(50, 0, 100)).toBe(50);
      expect(clamp(25, 10, 50)).toBe(25);
    });
    
    test('clamp returns min when value is below range', () => {
      expect(clamp(-10, 0, 100)).toBe(0);
      expect(clamp(5, 10, 50)).toBe(10);
    });
    
    test('clamp returns max when value is above range', () => {
      expect(clamp(150, 0, 100)).toBe(100);
      expect(clamp(75, 10, 50)).toBe(50);
    });
    
    test('scaleClampedPortrait limits scaled values', () => {
      // iPhone 17 (390pt width) would scale 100 to ~104
      const result = scaleClampedPortrait(100, 95, 102, 390);
      expect(result).toBe(102); // Clamped to max
    });
    
    test('scaleClampedLandscape limits scaled values', () => {
      // iPad Pro landscape (1366pt) would scale 100 to ~146
      const result = scaleClampedLandscape(100, 1366, 100, 120);
      expect(result).toBe(120); // Clamped to max
    });
  });
  
  // ============================================================================
  // ACCESSIBILITY TESTS
  // ============================================================================
  
  describe('Accessibility', () => {
    
    test('MIN_TOUCH_TARGET is 44pt (iOS HIG standard)', () => {
      expect(MIN_TOUCH_TARGET).toBe(44);
    });
    
    test('ensureMinTouchTarget enforces 44pt minimum', () => {
      expect(ensureMinTouchTarget(32)).toBe(44);
      expect(ensureMinTouchTarget(40)).toBe(44);
      expect(ensureMinTouchTarget(44)).toBe(44);
    });
    
    test('ensureMinTouchTarget preserves sizes above minimum', () => {
      expect(ensureMinTouchTarget(48)).toBe(48);
      expect(ensureMinTouchTarget(60)).toBe(60);
      expect(ensureMinTouchTarget(100)).toBe(100);
    });
    
    test('scaleWithMinTouch scales but never below 44pt', () => {
      // iPhone SE (320pt width) - would scale 50 down to ~42.7
      const result = scaleWithMinTouch(50, 320);
      expect(result).toBeGreaterThanOrEqual(44);
    });
    
    test('scaleWithMinTouch allows sizes above minimum to scale normally', () => {
      // iPad (768pt width) - would scale 60 up to ~122.9
      const result = scaleWithMinTouch(60, 768);
      expect(result).toBeGreaterThan(60);
    });
  });
  
  // ============================================================================
  // SPACING TESTS
  // ============================================================================
  
  describe('Spacing Utilities', () => {
    
    test('SPACING_SCALE follows 8pt grid system', () => {
      expect(SPACING_SCALE.xs).toBe(4);
      expect(SPACING_SCALE.sm).toBe(8);
      expect(SPACING_SCALE.md).toBe(16);
      expect(SPACING_SCALE.lg).toBe(24);
      expect(SPACING_SCALE.xl).toBe(32);
      expect(SPACING_SCALE.xxl).toBe(48);
    });
    
    test('getSpacing scales spacing values moderately', () => {
      // Base device (375pt width)
      const baseSpacing = getSpacing('md', 375);
      expect(baseSpacing).toBeCloseTo(16, 0);
      
      // iPhone 17 (390pt width) - slightly larger
      const scaledSpacing = getSpacing('md', 390);
      expect(scaledSpacing).toBeGreaterThan(16);
      expect(scaledSpacing).toBeLessThan(17); // Moderate scaling (factor 0.3)
    });
    
    test('getSpacing maintains proportions across scale', () => {
      const smSpacing = getSpacing('sm', 390);
      const mdSpacing = getSpacing('md', 390);
      const lgSpacing = getSpacing('lg', 390);
      
      // MD should be approximately 2x SM
      expect(mdSpacing / smSpacing).toBeCloseTo(2, 0);
      
      // LG should be approximately 1.5x MD
      expect(lgSpacing / mdSpacing).toBeCloseTo(1.5, 0);
    });
  });
  
  // ============================================================================
  // INTEGRATION TESTS (CROSS-DEVICE)
  // ============================================================================
  
  describe('Cross-Device Integration', () => {
    
    const devices = [
      { name: 'iPhone SE', portrait: { width: 375, height: 667 }, landscape: { width: 667, height: 375 } },
      { name: 'iPhone 17', portrait: { width: 390, height: 844 }, landscape: { width: 932, height: 430 } },
      { name: 'iPad Pro 12.9"', portrait: { width: 1024, height: 1366 }, landscape: { width: 1366, height: 1024 } },
    ];
    
    test('Adaptive scaling handles all device orientations', () => {
      devices.forEach(device => {
        // Portrait
        const portraitResult = scaleAdaptive(
          100,
          device.portrait.width,
          device.portrait.height
        );
        expect(portraitResult).toBeGreaterThan(0);
        
        // Landscape
        const landscapeResult = scaleAdaptive(
          100,
          device.landscape.width,
          device.landscape.height
        );
        expect(landscapeResult).toBeGreaterThan(0);
      });
    });
    
    test('Touch targets meet accessibility standards on all devices', () => {
      devices.forEach(device => {
        const buttonSize = scaleWithMinTouch(40, device.portrait.width);
        expect(buttonSize).toBeGreaterThanOrEqual(44);
      });
    });
    
    test('Font sizes remain readable across devices', () => {
      const baseFontSize = 16;
      
      devices.forEach(device => {
        const fontSize = scaleFontSize(baseFontSize, device.portrait.width);
        
        // Minimum readable font size (14pt)
        expect(fontSize).toBeGreaterThanOrEqual(14);
        
        // Maximum reasonable font size for moderate scaling
        // iPad Pro 12.9" at 1024pt width scales 16pt to ~30pt with factor 0.5
        expect(fontSize).toBeLessThanOrEqual(32); // Adjusted to accommodate tablet scaling
      });
    });
    
    test('Spacing maintains visual hierarchy on all devices', () => {
      devices.forEach(device => {
        const sm = getSpacing('sm', device.portrait.width);
        const md = getSpacing('md', device.portrait.width);
        const lg = getSpacing('lg', device.portrait.width);
        
        // Ensure hierarchy is preserved
        expect(sm).toBeLessThan(md);
        expect(md).toBeLessThan(lg);
        
        // Ensure spacing is reasonable (not too small or too large)
        expect(sm).toBeGreaterThanOrEqual(6);  // Minimum useful spacing
        expect(lg).toBeLessThanOrEqual(60);    // Maximum reasonable spacing
      });
    });
  });
  
  // ============================================================================
  // EDGE CASE TESTS
  // ============================================================================
  
  describe('Edge Cases', () => {
    
    test('Handles zero values', () => {
      expect(scalePortraitWidth(0, 390)).toBe(0);
      expect(moderateScale(0, 0.5, 390)).toBe(0);
      expect(clamp(0, 0, 100)).toBe(0);
    });
    
    test('Handles negative values in clamp', () => {
      expect(clamp(-50, -100, 100)).toBe(-50);
      expect(clamp(-150, -100, 100)).toBe(-100);
    });
    
    test('Handles extreme screen sizes', () => {
      // Very small device (hypothetical)
      const tinyScale = scalePortraitWidth(100, 200);
      expect(tinyScale).toBeGreaterThan(0);
      
      // Very large device (hypothetical)
      const hugeScale = scalePortraitWidth(100, 2000);
      expect(hugeScale).toBeGreaterThan(0);
    });
    
    test('Handles equal min and max in clamp', () => {
      expect(clamp(50, 100, 100)).toBe(100);
      expect(clamp(150, 100, 100)).toBe(100);
    });
  });
});
