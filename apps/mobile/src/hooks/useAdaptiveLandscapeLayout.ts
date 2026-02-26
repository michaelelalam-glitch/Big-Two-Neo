/**
 * useAdaptiveLandscapeLayout Hook
 * 
 * Provides responsive layout dimensions based on current screen size
 * Adapts from iPhone SE (568px) to iPad Pro (1366px) in landscape
 * 
 * Part of Task #456: Setup base screen specifications and safe area handling
 * Date: December 18, 2025
 */

import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  LANDSCAPE_DIMENSIONS,
  getDeviceCategory,
  clamp,
  type DeviceCategory,
} from '../constants/landscape';

export interface AdaptiveLandscapeLayout {
  // Screen info
  screenWidth: number;
  screenHeight: number;
  category: DeviceCategory;
  isLandscape: boolean;
  
  // Safe areas
  safeArea: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
  
  // Usable dimensions
  usableWidth: number;
  usableHeight: number;
  
  // Component sizes
  cardWidth: number;
  cardHeight: number;
  cardOverlap: number;
  
  tableWidth: number;
  tableHeight: number;
  tableBorderRadius: number;
  
  topPlayerProfileSize: number;
  sidePlayerProfileSize: number;
  topPlayerBadgeSize: number;
  sidePlayerBadgeSize: number;
  
  controlBarHeight: number;
  scoreboardCollapsedWidth: number;
  scoreboardExpandedWidth: number;
}

/**
 * Hook to get adaptive landscape layout dimensions
 * Automatically recalculates on orientation change or screen resize
 */
export const useAdaptiveLandscapeLayout = (): AdaptiveLandscapeLayout => {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  
  return useMemo(() => {
    const isLandscape = width > height;
    const category = getDeviceCategory(width);
    
    // Calculate usable dimensions
    const usableWidth = width - (insets.left + insets.right);
    const usableHeight = height - (insets.top + insets.bottom);
    
    // Card sizes based on device category
    const cardWidth = 
      category === 'phoneSmall' ? 56 :
      category === 'phoneMedium' ? 64 :
      category === 'phoneLarge' ? 72 :
      category === 'tabletSmall' ? 80 :
      88; // tabletLarge
    
    const cardHeight = cardWidth * 1.4444; // Standard playing card aspect ratio
    
    // Card overlap percentage (less overlap on tablets for better visibility)
    const cardOverlap = 
      category === 'phoneSmall' ? 0.4 :
      category.includes('phone') ? 0.5 :
      0.45; // tablets
    
    // Oval table dimensions (poker-style)
    const tableWidth = clamp(
      width * 0.45, // 45% of screen width
      320, // Min width (phoneSmall)
      560  // Max width (tabletLarge)
    );
    
    const tableHeight = clamp(
      usableHeight * 0.55, // 55% of available height
      180, // Min height (phoneSmall)
      320  // Max height (tabletLarge)
    );
    
    const tableBorderRadius = tableHeight / 2; // Rounded ends
    
    // Player profile sizes
    const topPlayerProfileSize = category.includes('phone') ? 80 : 100;
    const sidePlayerProfileSize = category.includes('phone') ? 60 : 80;
    
    // Badge sizes
    const topPlayerBadgeSize = 
      category === 'phoneSmall' ? 36 :
      category.includes('phone') ? 44 :
      52; // tablets
    
    const sidePlayerBadgeSize = topPlayerBadgeSize - 8;
    
    // Control bar (fixed)
    const controlBarHeight = LANDSCAPE_DIMENSIONS.controlBar.height;
    
    // Scoreboard widths
    const scoreboardCollapsedWidth = LANDSCAPE_DIMENSIONS.scoreboard.collapsed.maxWidth;
    const scoreboardExpandedWidth = clamp(
      width * 0.5,
      400,
      600
    );
    
    return {
      screenWidth: width,
      screenHeight: height,
      category,
      isLandscape,
      
      safeArea: {
        top: insets.top,
        bottom: insets.bottom,
        left: insets.left,
        right: insets.right,
      },
      
      usableWidth,
      usableHeight,
      
      cardWidth,
      cardHeight,
      cardOverlap,
      
      tableWidth,
      tableHeight,
      tableBorderRadius,
      
      topPlayerProfileSize,
      sidePlayerProfileSize,
      topPlayerBadgeSize,
      sidePlayerBadgeSize,
      
      controlBarHeight,
      scoreboardCollapsedWidth,
      scoreboardExpandedWidth,
    };
  }, [width, height, insets]);
};
