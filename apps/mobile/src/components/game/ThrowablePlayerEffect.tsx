/**
 * ThrowablePlayerEffect — small animated overlay rendered on a player's avatar tile.
 *
 * Shows a brief emoji + particle animation (egg splat, smoke puff, confetti burst)
 * visible to ALL players in the room when someone throws an item.
 *
 * Designed to sit as an AbsoluteView on top of the PlayerInfo avatar area.
 * Auto-dismisses after the parent (useThrowables) sets activeEffect to null.
 */

import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';
import type { ThrowableType } from '../../types/multiplayer';

interface ThrowablePlayerEffectProps {
  throwable: ThrowableType;
}

const EMOJIS: Record<ThrowableType, string> = {
  egg: '🥚',
  smoke: '💨',
  confetti: '🎊',
};

const SPLAT_EMOJIS: Record<ThrowableType, string> = {
  egg: '🍳',
  smoke: '🌫️',
  confetti: '✨',
};

// Small floating particle positions for each type
const PARTICLE_OFFSETS: Record<ThrowableType, { x: number; y: number }[]> = {
  egg: [
    { x: -12, y: -8 },
    { x: 10, y: -12 },
    { x: -8, y: 10 },
    { x: 12, y: 8 },
  ],
  smoke: [
    { x: -10, y: -10 },
    { x: 0, y: -15 },
    { x: 10, y: -10 },
  ],
  confetti: [
    { x: -14, y: -8 },
    { x: 14, y: -8 },
    { x: -8, y: 12 },
    { x: 8, y: 12 },
    { x: 0, y: -16 },
  ],
};

const PARTICLE_COLORS: Record<ThrowableType, string[]> = {
  egg: ['#FBBF24', '#FCD34D', '#F59E0B'],
  smoke: ['#9CA3AF', '#D1D5DB', '#6B7280'],
  confetti: ['#EF4444', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6'],
};

function SingleParticle({
  x,
  y,
  color,
  delay,
  throwable,
}: {
  x: number;
  y: number;
  color: string;
  delay: number;
  throwable: ThrowableType;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.delay(delay),
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.timing(translateX, { toValue: x, duration: 400, useNativeDriver: true }),
        Animated.timing(translateY, {
          toValue: throwable === 'smoke' ? y - 10 : y,
          duration: 400,
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(opacity, { toValue: 0, duration: 600, useNativeDriver: true }),
    ]).start();
  }, [delay, opacity, scale, translateX, translateY, x, y, throwable]);

  return (
    <Animated.View
      style={[
        styles.particle,
        {
          backgroundColor: color,
          opacity,
          transform: [{ translateX }, { translateY }, { scale }],
          borderRadius: throwable === 'confetti' ? 2 : 6,
          width: throwable === 'confetti' ? 5 : 7,
          height: throwable === 'confetti' ? 7 : 7,
        },
      ]}
    />
  );
}

export function ThrowablePlayerEffect({ throwable }: ThrowablePlayerEffectProps) {
  const splatOpacity = useRef(new Animated.Value(0)).current;
  const splatScale = useRef(new Animated.Value(0.3)).current;
  const containerOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(splatOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.spring(splatScale, {
          toValue: 1,
          useNativeDriver: true,
          tension: 120,
          friction: 6,
        }),
      ]),
      Animated.delay(3500),
      Animated.timing(containerOpacity, { toValue: 0, duration: 600, useNativeDriver: true }),
    ]).start();
  }, [splatOpacity, splatScale, containerOpacity]);

  const offsets = PARTICLE_OFFSETS[throwable];
  const colors = PARTICLE_COLORS[throwable];

  return (
    <Animated.View style={[styles.container, { opacity: containerOpacity }]}>
      {/* Particles */}
      {offsets.map((offset, i) => (
        <SingleParticle
          key={i}
          x={offset.x}
          y={offset.y}
          color={colors[i % colors.length] ?? '#FFFFFF'}
          delay={i * 40}
          throwable={throwable}
        />
      ))}
      {/* Splat emoji */}
      <Animated.Text
        style={[styles.splatEmoji, { opacity: splatOpacity, transform: [{ scale: splatScale }] }]}
      >
        {SPLAT_EMOJIS[throwable]}
      </Animated.Text>
      {/* Projectile emoji (small, top-right) */}
      <Text style={styles.projectileEmoji}>{EMOJIS[throwable]}</Text>
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
    pointerEvents: 'none',
  } as const,
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
