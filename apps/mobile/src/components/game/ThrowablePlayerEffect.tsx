/**
 * ThrowablePlayerEffect — small animated overlay rendered on a player's avatar tile.
 *
 * Shows a fireworks-style radial burst animation (egg splat, smoke puff, confetti burst)
 * visible to ALL players in the room when someone throws an item.
 *
 * Designed to sit as an AbsoluteView on top of the PlayerInfo avatar area.
 * Auto-dismisses after the parent (useThrowables) sets activeEffect to null.
 */

import React, { useEffect, useRef } from 'react';
import { Text, Animated, StyleSheet } from 'react-native';
import type { ThrowableType } from '../../types/multiplayer';

interface ThrowablePlayerEffectProps {
  throwable: ThrowableType;
}

const SPLAT_EMOJIS: Record<ThrowableType, string> = {
  egg: '🍳',
  smoke: '🌫️',
  confetti: '✨',
};

const PROJECTILE_EMOJIS: Record<ThrowableType, string> = {
  egg: '🥚',
  smoke: '💨',
  confetti: '🎊',
};

const PARTICLE_COLORS: Record<ThrowableType, string[]> = {
  egg: ['#FBBF24', '#FCD34D', '#F59E0B', '#FEF3C7', '#FBBF24'],
  smoke: ['#9CA3AF', '#D1D5DB', '#6B7280', '#E5E7EB', '#9CA3AF'],
  confetti: ['#EF4444', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899'],
};

const PARTICLE_COUNT = 10;

/** Single radial burst particle driven by a shared burstAnim value 0→1. */
function BurstParticle({
  angle,
  dist,
  color,
  burstAnim,
  isConfetti,
}: {
  angle: number;
  dist: number;
  color: string;
  burstAnim: Animated.Value;
  isConfetti: boolean;
}) {
  const tx = burstAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, Math.cos(angle) * dist],
  });
  const ty = burstAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, Math.sin(angle) * dist],
  });
  const opacity = burstAnim.interpolate({
    inputRange: [0, 0.15, 0.65, 1],
    outputRange: [0, 1, 1, 0],
  });
  const scale = burstAnim.interpolate({
    inputRange: [0, 0.15, 1],
    outputRange: [0, 1.4, 0.7],
  });

  return (
    <Animated.View
      style={[
        styles.particle,
        {
          backgroundColor: color,
          opacity,
          borderRadius: isConfetti ? 1 : 5,
          width: isConfetti ? 5 : 8,
          height: isConfetti ? 8 : 8,
          transform: [{ translateX: tx }, { translateY: ty }, { scale }],
        },
      ]}
    />
  );
}

export function ThrowablePlayerEffect({ throwable }: ThrowablePlayerEffectProps) {
  const burstAnim = useRef(new Animated.Value(0)).current;
  const splatScale = useRef(new Animated.Value(0.2)).current;
  const splatOpacity = useRef(new Animated.Value(0)).current;
  const containerOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.sequence([
      // Phase 1: radial burst + splat appear simultaneously
      Animated.parallel([
        Animated.timing(burstAnim, {
          toValue: 1,
          duration: 450,
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.delay(80),
          Animated.parallel([
            Animated.timing(splatOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
            Animated.spring(splatScale, {
              toValue: 1,
              tension: 120,
              friction: 6,
              useNativeDriver: true,
            }),
          ]),
        ]),
      ]),
      // Phase 2: hold
      Animated.delay(3200),
      // Phase 3: fade out entire overlay
      Animated.timing(containerOpacity, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]).start();
  }, [burstAnim, splatOpacity, splatScale, containerOpacity]);

  const colors = PARTICLE_COLORS[throwable];
  const isConfetti = throwable === 'confetti';

  return (
    <Animated.View pointerEvents="none" style={[styles.container, { opacity: containerOpacity }]}>
      {Array.from({ length: PARTICLE_COUNT }, (_, i) => {
        const angle = (i * (2 * Math.PI)) / PARTICLE_COUNT;
        // Alternate distances for visual depth: 18, 24, or 30 px
        const dist = 18 + (i % 3) * 6;
        const color = colors[i % colors.length] ?? '#FFFFFF';
        return (
          <BurstParticle
            key={i}
            angle={angle}
            dist={dist}
            color={color}
            burstAnim={burstAnim}
            isConfetti={isConfetti}
          />
        );
      })}
      {/* Splat emoji — scales in after burst */}
      <Animated.Text
        style={[styles.splatEmoji, { opacity: splatOpacity, transform: [{ scale: splatScale }] }]}
      >
        {SPLAT_EMOJIS[throwable]}
      </Animated.Text>
      {/* Projectile emoji — small corner indicator */}
      <Text style={styles.projectileEmoji}>{PROJECTILE_EMOJIS[throwable]}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    // Note: pointerEvents is set as a View prop above, not here (it is not a
    // style property in React Native).
  },
  splatEmoji: {
    fontSize: 28,
    textAlign: 'center',
  },
  projectileEmoji: {
    position: 'absolute',
    top: 2,
    right: 2,
    fontSize: 11,
  },
  particle: {
    position: 'absolute',
  },
});
