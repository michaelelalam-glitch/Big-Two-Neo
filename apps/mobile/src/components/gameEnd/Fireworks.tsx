/**
 * Fireworks Component - Celebratory animation for game end
 * 
 * Features:
 * - Pure React Native Animated API (no external dependencies)
 * - 12 burst locations distributed across screen
 * - Radial particle explosion (12 particles per burst)
 * - 5-second default duration (configurable)
 * - Positioned behind modal (zIndex: 9998)
 * - Uses native driver for 60fps performance
 * 
 * Created as part of Task #405: Build Fireworks animation component
 * Date: December 16, 2025
 */

import React, { useEffect, useRef, useMemo } from 'react';
import { View, Animated, StyleSheet, Platform } from 'react-native';
import { FireworksProps } from '../../types/gameEnd';

// ============================================================================
// PERFORMANCE CONFIGURATION (Task #398)
// ============================================================================

/**
 * Detect device performance tier
 * Older devices get reduced particle counts for smooth 60fps
 */
const getPerformanceTier = (): 'high' | 'medium' | 'low' => {
  // iOS: Assume newer devices support high performance
  // Android: Use conservative approach for older devices
  if (Platform.OS === 'ios') {
    return 'high'; // iOS generally handles animations well
  }
  // Android: Default to medium for safety
  return 'medium';
};

const PERFORMANCE_CONFIG = {
  high: { burstCount: 12, particlesPerBurst: 12 },
  medium: { burstCount: 8, particlesPerBurst: 8 },
  low: { burstCount: 6, particlesPerBurst: 6 },
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const Fireworks: React.FC<FireworksProps> = ({ 
  active, 
  duration = 5000 
}) => {
  const performanceTier = useMemo(() => getPerformanceTier(), []);
  const config = PERFORMANCE_CONFIG[performanceTier];
  const animations = useRef<Animated.Value[]>([]);
  
  useEffect(() => {
    if (active) {
      // Task #398: Initialize burst animations based on performance tier
      const bursts = Array(config.burstCount).fill(0).map(() => new Animated.Value(0));
      animations.current = bursts;
      
      // Stagger burst animations (300ms intervals, cycling within duration)
      const burstSequence = bursts.map((anim, i) => 
        Animated.sequence([
          Animated.delay((i * 300) % duration),
          Animated.timing(anim, {
            toValue: 1,
            duration: 1500,
            useNativeDriver: true,
          }),
        ])
      );
      
      // Run all bursts in parallel, repeating
      const loopAnimation = Animated.loop(
        Animated.parallel(burstSequence)
      );
      
      loopAnimation.start();
      
      // Stop after duration
      const timeout = setTimeout(() => {
        loopAnimation.stop();
      }, duration);
      
      return () => {
        clearTimeout(timeout);
        loopAnimation.stop();
        animations.current.forEach(anim => anim.stopAnimation());
      };
    }
    
    return () => {
      animations.current.forEach(anim => anim.stopAnimation());
    };
  }, [active, duration]);
  
  if (!active) return null;
  
  return (
    <View style={styles.container} pointerEvents="none">
      {animations.current.map((anim, i) => {
        // Distribute burst locations across screen
        const left = 20 + (i * 8) % 60;
        const top = 10 + (i * 12) % 50;
        
        return (
          <FireworkBurst
            key={i}
            animation={anim}
            left={`${left}%`}
            top={`${top}%`}
            hueOffset={i * 30}
            particleCount={config.particlesPerBurst} // Task #398: Dynamic particle count
          />
        );
      })}
    </View>
  );
};

// ============================================================================
// FIREWORK BURST SUB-COMPONENT
// ============================================================================

interface FireworkBurstProps {
  animation: Animated.Value;
  left: string;
  top: string;
  hueOffset: number;
  particleCount: number; // Task #398: Configurable particle count
}

const FireworkBurst: React.FC<FireworkBurstProps> = ({ 
  animation, 
  left, 
  top, 
  hueOffset,
  particleCount 
}) => {
  // Task #398: Create particles based on device performance
  const particles = useMemo(() => Array(particleCount).fill(0).map((_, j) => {
    const angleStep = 360 / particleCount; // Distribute evenly based on particle count
    const angle = (j * angleStep) * (Math.PI / 180);
    const distance = 80;
    
    const translateX = animation.interpolate({
      inputRange: [0, 1],
      outputRange: [0, Math.cos(angle) * distance],
    });
    
    const translateY = animation.interpolate({
      inputRange: [0, 1],
      outputRange: [0, Math.sin(angle) * distance],
    });
    
    const opacity = animation.interpolate({
      inputRange: [0, 0.1, 1],
      outputRange: [0, 1, 0],
    });
    
    const scale = animation.interpolate({
      inputRange: [0, 0.1, 1],
      outputRange: [0, 1, 0.5],
    });
    
    // Task #398: Memoize color calculation
    const hue = (hueOffset + j * (360 / particleCount)) % 360;
    const color = hslToRgb(hue, 100, 60);
    
    return (
      <Animated.View
        key={j}
        style={[
          styles.particle,
          {
            backgroundColor: color,
            transform: [
              { translateX },
              { translateY },
              { scale },
            ],
            opacity,
          },
        ]}
      />
    );
  }), [animation, hueOffset, particleCount]); // Task #398: Memoize particle calculations
  
  return (
    <View style={[styles.burst, { left, top }]}>
      {particles}
    </View>
  );
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Convert HSL color to RGB string
 * React Native doesn't support hsl() directly
 * 
 * @param h Hue (0-360)
 * @param s Saturation (0-100)
 * @param l Lightness (0-100)
 * @returns RGB color string
 */
const hslToRgb = (h: number, s: number, l: number): string => {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) =>
    l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const r = Math.round(255 * f(0));
  const g = Math.round(255 * f(8));
  const b = Math.round(255 * f(4));
  return `rgb(${r}, ${g}, ${b})`;
};

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9998, // Behind modal (modal is 9999)
  },
  burst: {
    position: 'absolute',
    width: 10,
    height: 10,
  },
  particle: {
    position: 'absolute',
    width: 4,
    height: 4,
    borderRadius: 2,
  },
});

// ============================================================================
// EXPORTS
// ============================================================================

export default Fireworks;
