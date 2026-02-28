/**
 * Responsive Scaling Utilities
 * 
 * Provides scaling functions for adaptive layouts across all device sizes.
 * Works with both portrait and landscape orientations.
 * 
 * Based on existing patterns from:
 * - `/src/constants/landscape.ts` (landscape base specs)
 * - `/src/components/scoreboard/hooks/useResponsiveStyles.ts` (responsive dimensions)
 * 
 * Created as part of Task #447: Build responsive scaling system with breakpoints
 * Date: December 18, 2025
 */

import { Dimensions } from 'react-native';
import { LANDSCAPE_BASE, getDeviceCategory } from '../constants/landscape';

// ============================================================================
// BASE DIMENSIONS
// ============================================================================

/**
 * Portrait mode base dimensions (iPhone 6/7/8)
 * Standard baseline for portrait scaling
 */
export const PORTRAIT_BASE = {
  width: 375,
  height: 812,
} as const;

/**
 * Get current screen dimensions
 * Note: Use useWindowDimensions() hook in components for automatic updates
 */
export const getScreenDimensions = () => {
  return Dimensions.get('window');
};

// ============================================================================
// DEVICE DETECTION
// ============================================================================

/**
 * Check if device is in landscape orientation
 */
export const isLandscape = (width: number, height: number): boolean => {
  return width > height;
};

/**
 * Check if device is in portrait orientation
 */
export const isPortrait = (width: number, height: number): boolean => {
  return height > width;
};

/**
 * Detect device size category (portrait mode)
 * Based on width breakpoints
 */
export const getPortraitDeviceCategory = (width: number): 'small' | 'medium' | 'large' => {
  if (width < 375) return 'small';   // iPhone SE (320-374px)
  if (width < 768) return 'medium';  // Standard phones (375-767px)
  return 'large';                     // Tablets (768px+)
};

// ============================================================================
// SCALING FUNCTIONS - PORTRAIT MODE
// ============================================================================

/**
 * Scale based on screen width (portrait mode)
 * Proportional to base width (375pt - iPhone 6/7/8)
 * 
 * @param size - Base size in points
 * @param screenWidth - Current screen width (optional, uses Dimensions if not provided)
 * @returns Scaled size
 * 
 * @example
 * scalePortraitWidth(16) // Returns ~17 on iPhone 17 (390pt width)
 */
export const scalePortraitWidth = (size: number, screenWidth?: number): number => {
  const width = screenWidth ?? Dimensions.get('window').width;
  return (width / PORTRAIT_BASE.width) * size;
};

/**
 * Scale based on screen height (portrait mode)
 * Proportional to base height (812pt - iPhone X)
 * 
 * @param size - Base size in points
 * @param screenHeight - Current screen height (optional)
 * @returns Scaled size
 */
export const scalePortraitHeight = (size: number, screenHeight?: number): number => {
  const height = screenHeight ?? Dimensions.get('window').height;
  return (height / PORTRAIT_BASE.height) * size;
};

/**
 * Moderate scaling - less aggressive than linear scaling
 * Balances proportional sizing with readability
 * 
 * @param size - Base size in points
 * @param factor - Scaling factor (0-1), default 0.5
 *   - 0 = no scaling (returns original size)
 *   - 0.5 = moderate scaling (recommended)
 *   - 1 = full linear scaling
 * @param screenWidth - Current screen width (optional)
 * @returns Moderately scaled size
 * 
 * @example
 * moderateScale(16) // Less aggressive than scalePortraitWidth
 * moderateScale(16, 0.3) // Even less aggressive
 */
export const moderateScale = (
  size: number,
  factor: number = 0.5,
  screenWidth?: number
): number => {
  const scaled = scalePortraitWidth(size, screenWidth);
  return size + (scaled - size) * factor;
};

/**
 * Scale font size (portrait mode)
 * Uses moderate scaling to maintain readability
 * 
 * @param size - Base font size in points
 * @param screenWidth - Current screen width (optional)
 * @returns Scaled font size
 */
export const scaleFontSize = (size: number, screenWidth?: number): number => {
  return Math.round(moderateScale(size, 0.5, screenWidth));
};

// ============================================================================
// SCALING FUNCTIONS - LANDSCAPE MODE
// ============================================================================

/**
 * Scale based on screen width (landscape mode)
 * Proportional to iPhone 17 landscape base (932pt)
 * 
 * @param size - Base size in points
 * @param screenWidth - Current screen width
 * @returns Scaled size
 */
export const scaleLandscapeWidth = (size: number, screenWidth: number): number => {
  return (screenWidth / LANDSCAPE_BASE.width) * size;
};

/**
 * Scale based on screen height (landscape mode)
 * Proportional to iPhone 17 landscape base (430pt)
 * 
 * @param size - Base size in points
 * @param screenHeight - Current screen height
 * @returns Scaled size
 */
export const scaleLandscapeHeight = (size: number, screenHeight: number): number => {
  return (screenHeight / LANDSCAPE_BASE.height) * size;
};

/**
 * Scale font size (landscape mode)
 * Rounded to nearest integer for pixel-perfect rendering
 * 
 * @param size - Base font size in points
 * @param screenWidth - Current screen width
 * @returns Scaled font size
 */
export const scaleLandscapeFont = (size: number, screenWidth: number): number => {
  const scale = screenWidth / LANDSCAPE_BASE.width;
  return Math.round(size * scale);
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Clamp value between min and max
 * 
 * @param value - Value to clamp
 * @param min - Minimum value
 * @param max - Maximum value
 * @returns Clamped value
 * 
 * @example
 * clamp(150, 100, 200) // Returns 150
 * clamp(50, 100, 200)  // Returns 100
 * clamp(250, 100, 200) // Returns 200
 */
export const clamp = (value: number, min: number, max: number): number => {
  return Math.min(Math.max(value, min), max);
};

/**
 * Scale with clamped limits (portrait mode)
 * Useful for ensuring sizes don't get too small or too large
 * 
 * @param size - Base size in points
 * @param min - Minimum scaled size
 * @param max - Maximum scaled size
 * @param screenWidth - Current screen width (optional)
 * @returns Clamped scaled size
 * 
 * @example
 * scaleClampedPortrait(100, 80, 120) // Returns between 80-120
 */
export const scaleClampedPortrait = (
  size: number,
  min: number,
  max: number,
  screenWidth?: number
): number => {
  return clamp(scalePortraitWidth(size, screenWidth), min, max);
};

/**
 * Scale with clamped limits (landscape mode)
 * 
 * @param size - Base size in points
 * @param screenWidth - Current screen width
 * @param min - Minimum scaled size
 * @param max - Maximum scaled size
 * @returns Clamped scaled size
 */
export const scaleClampedLandscape = (
  size: number,
  screenWidth: number,
  min: number,
  max: number
): number => {
  return clamp(scaleLandscapeWidth(size, screenWidth), min, max);
};

// ============================================================================
// ADAPTIVE SCALING (AUTO-DETECT ORIENTATION)
// ============================================================================

/**
 * Adaptive scaling based on current orientation
 * Automatically chooses portrait or landscape scaling
 * 
 * @param size - Base size in points
 * @param screenWidth - Current screen width
 * @param screenHeight - Current screen height
 * @returns Scaled size appropriate for current orientation
 */
export const scaleAdaptive = (
  size: number,
  screenWidth: number,
  screenHeight: number
): number => {
  if (isLandscape(screenWidth, screenHeight)) {
    return scaleLandscapeWidth(size, screenWidth);
  }
  return scalePortraitWidth(size, screenWidth);
};

/**
 * Adaptive moderate scaling (auto-detect orientation)
 * Uses moderate scaling factor for better readability
 * 
 * @param size - Base size in points
 * @param factor - Scaling factor (0-1), default 0.5
 * @param screenWidth - Current screen width
 * @param screenHeight - Current screen height
 * @returns Moderately scaled size
 */
export const moderateScaleAdaptive = (
  size: number,
  factor: number = 0.5,
  screenWidth: number,
  screenHeight: number
): number => {
  const scaled = scaleAdaptive(size, screenWidth, screenHeight);
  return size + (scaled - size) * factor;
};

// ============================================================================
// ACCESSIBILITY
// ============================================================================

/**
 * Minimum touch target size (iOS HIG & Material Design)
 * Ensures accessibility for all interactive elements
 */
export const MIN_TOUCH_TARGET = 44;

/**
 * Ensure size meets minimum touch target requirements
 * 
 * @param size - Proposed size
 * @returns Size adjusted to meet minimum touch target (44pt)
 * 
 * @example
 * ensureMinTouchTarget(32) // Returns 44
 * ensureMinTouchTarget(48) // Returns 48
 */
export const ensureMinTouchTarget = (size: number): number => {
  return Math.max(size, MIN_TOUCH_TARGET);
};

/**
 * Scale with minimum touch target enforcement
 * Useful for buttons and interactive elements
 * 
 * @param size - Base size in points
 * @param screenWidth - Current screen width (optional)
 * @returns Scaled size, never less than 44pt
 */
export const scaleWithMinTouch = (size: number, screenWidth?: number): number => {
  return ensureMinTouchTarget(scalePortraitWidth(size, screenWidth));
};

// ============================================================================
// SPACING UTILITIES
// ============================================================================

/**
 * Standard spacing scale
 * Based on 8pt grid system
 */
export const SPACING_SCALE = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

/**
 * Get responsive spacing value
 * Scales spacing based on screen width
 * 
 * @param key - Spacing key (xs, sm, md, lg, xl, xxl)
 * @param screenWidth - Current screen width (optional)
 * @returns Scaled spacing value
 */
export const getSpacing = (
  key: keyof typeof SPACING_SCALE,
  screenWidth?: number
): number => {
  return moderateScale(SPACING_SCALE[key], 0.3, screenWidth);
};

// ============================================================================
// EXPORTS
// ============================================================================

/**
 * Consolidated exports for easy importing
 */
export const ScalingUtils = {
  // Base dimensions
  PORTRAIT_BASE,
  LANDSCAPE_BASE,
  
  // Device detection
  isLandscape,
  isPortrait,
  getDeviceCategory,
  getPortraitDeviceCategory,
  
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
  
  // Utilities
  clamp,
  scaleClampedPortrait,
  scaleClampedLandscape,
  
  // Accessibility
  MIN_TOUCH_TARGET,
  ensureMinTouchTarget,
  scaleWithMinTouch,
  
  // Spacing
  SPACING_SCALE,
  getSpacing,
} as const;

export default ScalingUtils;
