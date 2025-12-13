/**
 * useScoreboardAnimations Hook
 * 
 * Provides Reanimated animations for scoreboard expand/collapse transitions
 * Task #354: Expand/collapse animations with Reanimated
 * 
 * Features:
 * - Smooth expand/collapse (300ms)
 * - Match card animations (250ms)
 * - Modal fade animations (200ms)
 * - 60fps performance with native driver
 * 
 * Usage:
 * ```tsx
 * const { animatedStyle, expandedHeight, toggleExpanded } = useScoreboardAnimations({
 *   isExpanded: false,
 *   collapsedHeight: 120,
 *   expandedHeight: 400
 * });
 * ```
 */

import { useEffect } from 'react';
import { useSharedValue, useAnimatedStyle, withTiming, interpolate, Extrapolate } from 'react-native-reanimated';

export interface ScoreboardAnimationConfig {
  isExpanded: boolean;
  collapsedHeight?: number;
  expandedHeight?: number;
  duration?: number;
}

export interface ScoreboardAnimations {
  animatedStyle: {
    height: number;
    opacity: number;
  };
  expandProgress: ReturnType<typeof useSharedValue<number>>;
}

/**
 * Hook for scoreboard expand/collapse animations
 * Uses React Native Reanimated for 60fps native animations
 */
export function useScoreboardAnimations({
  isExpanded,
  collapsedHeight = 120,
  expandedHeight = 400,
  duration = 300,
}: ScoreboardAnimationConfig): ScoreboardAnimations {
  // Shared value for animation progress (0 = collapsed, 1 = expanded)
  const expandProgress = useSharedValue(isExpanded ? 1 : 0);

  // Animate on expand state change
  useEffect(() => {
    expandProgress.value = withTiming(isExpanded ? 1 : 0, {
      duration,
    });
  }, [isExpanded, duration, expandProgress]);

  // Animated style for height and opacity
  const animatedStyle = useAnimatedStyle(() => {
    const height = interpolate(
      expandProgress.value,
      [0, 1],
      [collapsedHeight, expandedHeight],
      Extrapolate.CLAMP
    );

    const opacity = interpolate(
      expandProgress.value,
      [0, 0.5, 1],
      [1, 0.95, 1],
      Extrapolate.CLAMP
    );

    return {
      height,
      opacity,
    };
  });

  return {
    animatedStyle,
    expandProgress,
  };
}

/**
 * Hook for match card collapse/expand animations
 * Shorter duration (250ms) for responsive feel
 */
export function useMatchCardAnimations(isCollapsed: boolean) {
  const collapseProgress = useSharedValue(isCollapsed ? 1 : 0);

  useEffect(() => {
    collapseProgress.value = withTiming(isCollapsed ? 1 : 0, {
      duration: 250,
    });
  }, [isCollapsed, collapseProgress]);

  const animatedStyle = useAnimatedStyle(() => {
    const height = interpolate(
      collapseProgress.value,
      [0, 1],
      [200, 50], // Expanded to collapsed height
      Extrapolate.CLAMP
    );

    const opacity = interpolate(
      collapseProgress.value,
      [0, 0.3, 1],
      [1, 0.7, 1],
      Extrapolate.CLAMP
    );

    return {
      height,
      opacity,
    };
  });

  return {
    animatedStyle,
    collapseProgress,
  };
}

/**
 * Hook for play history modal fade animations
 * Fast fade (200ms) for modal open/close
 */
export function useModalFadeAnimations(isVisible: boolean) {
  const fadeProgress = useSharedValue(isVisible ? 1 : 0);

  useEffect(() => {
    fadeProgress.value = withTiming(isVisible ? 1 : 0, {
      duration: 200,
    });
  }, [isVisible, fadeProgress]);

  const animatedStyle = useAnimatedStyle(() => {
    const opacity = fadeProgress.value;
    const scale = interpolate(
      fadeProgress.value,
      [0, 1],
      [0.95, 1],
      Extrapolate.CLAMP
    );

    return {
      opacity,
      transform: [{ scale }],
    };
  });

  return {
    animatedStyle,
    fadeProgress,
  };
}

/**
 * Hook for smooth scroll animations in expanded scoreboard
 * Used for table scroll with momentum
 */
export function useScrollAnimations() {
  const scrollY = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [
        {
          translateY: -scrollY.value,
        },
      ],
    };
  });

  return {
    animatedStyle,
    scrollY,
  };
}

/**
 * Example Usage in ScoreboardContainer:
 * 
 * ```tsx
 * import Animated from 'react-native-reanimated';
 * import { useScoreboardAnimations } from '../hooks/useScoreboardAnimations';
 * 
 * function ScoreboardContainer() {
 *   const { isScoreboardExpanded } = useScoreboard();
 *   const { animatedStyle } = useScoreboardAnimations({
 *     isExpanded: isScoreboardExpanded,
 *     collapsedHeight: 120,
 *     expandedHeight: 400,
 *   });
 * 
 *   return (
 *     <Animated.View style={[styles.container, animatedStyle]}>
 *       {isScoreboardExpanded ? <ExpandedScoreboard /> : <CompactScoreboard />}
 *     </Animated.View>
 *   );
 * }
 * ```
 */
