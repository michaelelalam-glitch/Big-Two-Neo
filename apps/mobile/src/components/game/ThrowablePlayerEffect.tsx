/**
 * ThrowablePlayerEffect — animated overlay rendered on a player's avatar tile.
 *
 * Each throwable type has a distinct animation:
 *  • Egg    — amber splat drip: particles cluster downward (gravity) + yolk splat
 *  • Smoke  — grey puff: particles drift upward and expand outward
 *  • Confetti — multicolour burst: rectangular confetti pieces scatter in all
 *               directions with rotation
 *
 * Uses onLayout to measure the container so all particle distances and font
 * sizes scale proportionally in both portrait and landscape player tiles.
 * `pointerEvents="none"` is set as a View prop (not a StyleSheet property).
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Text, Animated, StyleSheet, LayoutChangeEvent } from 'react-native';
import type { ThrowableType } from '../../types/multiplayer';

interface ThrowablePlayerEffectProps {
  throwable: ThrowableType;
}

// ─── colour palettes ───────────────────────────────────────────────────────

const SPLAT_EMOJIS: Record<ThrowableType, string> = {
  egg: '🍳',
  smoke: '🌫️',
  confetti: '✨',
};

// ─── per-type particle builders ────────────────────────────────────────────

interface ParticleSpec {
  id: number;
  angle: number; // radians
  dist: number; // px  (will be scaled by containerSize)
  color: string;
  isRect: boolean; // rectangular confetti piece?
  w: number;
  h: number;
  endOpacity: number;
}

function buildEggParticles(size: number): ParticleSpec[] {
  // 12 amber droplets, biased downward (gravity: sin>0 = lower half)
  const colors = ['#FBBF24', '#FCD34D', '#F59E0B', '#FEF3C7', '#FBBF24', '#F59E0B'];
  const r = size * 0.42;
  return Array.from({ length: 12 }, (_, i) => {
    // angle range: 30°–150° (lower hemisphere) for majority; 2 go sideways
    const baseAngle =
      i < 10
        ? Math.PI * 0.15 + (i / 9) * (Math.PI * 0.7) // 27°–153° (downward)
        : i === 10
          ? -Math.PI * 0.3
          : -Math.PI * 0.7; // two sideways squirts
    const dist = r * (0.55 + (i % 3) * 0.2);
    return {
      id: i,
      angle: baseAngle,
      dist,
      color: colors[i % colors.length] ?? '#FBBF24',
      isRect: false,
      w: 7 + (i % 3) * 2,
      h: 7 + (i % 3) * 2,
      endOpacity: 0,
    };
  });
}

function buildSmokeParticles(size: number): ParticleSpec[] {
  // 10 grey puffs drifting upward
  const colors = ['#9CA3AF', '#D1D5DB', '#6B7280', '#E5E7EB', '#9CA3AF'];
  const r = size * 0.4;
  return Array.from({ length: 10 }, (_, i) => {
    // angle range: -150° to -30° (upper hemisphere) — sin<0
    const baseAngle = -Math.PI * 0.82 + (i / 9) * (Math.PI * 0.64);
    const dist = r * (0.5 + (i % 3) * 0.22);
    return {
      id: i,
      angle: baseAngle,
      dist,
      color: colors[i % colors.length] ?? '#9CA3AF',
      isRect: false,
      w: 9 + (i % 4) * 2,
      h: 9 + (i % 4) * 2,
      endOpacity: 0,
    };
  });
}

function buildConfettiParticles(size: number): ParticleSpec[] {
  // 14 multicolour rectangles evenly distributed full-circle
  const colors = ['#EF4444', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#14B8A6'];
  const r = size * 0.48;
  return Array.from({ length: 14 }, (_, i) => {
    const angle = (i * (2 * Math.PI)) / 14;
    const dist = r * (0.45 + (i % 3) * 0.2);
    return {
      id: i,
      angle,
      dist,
      color: colors[i % colors.length] ?? '#EF4444',
      isRect: true,
      w: 4 + (i % 3) * 2,
      h: 7 + (i % 2) * 3,
      endOpacity: 0.05,
    };
  });
}

// ─── single animated particle ──────────────────────────────────────────────

function AnimatedParticle({ spec, burstAnim }: { spec: ParticleSpec; burstAnim: Animated.Value }) {
  const tx = burstAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, Math.cos(spec.angle) * spec.dist],
  });
  const ty = burstAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, Math.sin(spec.angle) * spec.dist],
  });
  const opacity = burstAnim.interpolate({
    inputRange: [0, 0.12, 0.6, 1],
    outputRange: [0, 1, 0.9, spec.endOpacity],
  });
  const scale = burstAnim.interpolate({
    inputRange: [0, 0.12, 0.5, 1],
    outputRange: [0, 1.3, 1.0, 0.6],
  });

  return (
    <Animated.View
      style={[
        styles.particle,
        {
          width: spec.w,
          height: spec.h,
          borderRadius: spec.isRect ? 1 : spec.w / 2,
          backgroundColor: spec.color,
          opacity,
          transform: [{ translateX: tx }, { translateY: ty }, { scale }],
        },
      ]}
    />
  );
}

// ─── main component ────────────────────────────────────────────────────────

export function ThrowablePlayerEffect({ throwable }: ThrowablePlayerEffectProps) {
  // Measure container so distances scale with portrait/landscape tile sizes
  const [containerSize, setContainerSize] = useState(60);
  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setContainerSize(Math.min(width, height));
  }, []);

  const burstAnim = useRef(new Animated.Value(0)).current;
  const splatScale = useRef(new Animated.Value(0.2)).current;
  const splatOpacity = useRef(new Animated.Value(0)).current;
  const containerOpacity = useRef(new Animated.Value(1)).current;

  // Different timing per throwable type
  const burstDuration = throwable === 'smoke' ? 600 : throwable === 'confetti' ? 520 : 400;
  const splatDelay = throwable === 'egg' ? 60 : throwable === 'smoke' ? 200 : 80;

  useEffect(() => {
    burstAnim.setValue(0);
    splatScale.setValue(0.2);
    splatOpacity.setValue(0);
    containerOpacity.setValue(1);

    Animated.sequence([
      Animated.parallel([
        Animated.timing(burstAnim, { toValue: 1, duration: burstDuration, useNativeDriver: true }),
        Animated.sequence([
          Animated.delay(splatDelay),
          Animated.parallel([
            Animated.timing(splatOpacity, { toValue: 1, duration: 160, useNativeDriver: true }),
            Animated.spring(splatScale, {
              toValue: 1,
              tension: 130,
              friction: 6,
              useNativeDriver: true,
            }),
          ]),
        ]),
      ]),
      Animated.delay(3100),
      Animated.timing(containerOpacity, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]).start();
  }, [burstAnim, splatScale, splatOpacity, containerOpacity, burstDuration, splatDelay]);

  const particles =
    throwable === 'egg'
      ? buildEggParticles(containerSize)
      : throwable === 'smoke'
        ? buildSmokeParticles(containerSize)
        : buildConfettiParticles(containerSize);

  const splatSize = Math.max(18, containerSize * 0.38);

  return (
    <Animated.View
      pointerEvents="none"
      onLayout={handleLayout}
      style={[styles.container, { opacity: containerOpacity }]}
    >
      {particles.map(spec => (
        <AnimatedParticle key={spec.id} spec={spec} burstAnim={burstAnim} />
      ))}
      <Animated.Text
        style={[
          styles.splatEmoji,
          { fontSize: splatSize, opacity: splatOpacity, transform: [{ scale: splatScale }] },
        ]}
      >
        {SPLAT_EMOJIS[throwable]}
      </Animated.Text>
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
    // Note: pointerEvents is set as a View prop above — not a StyleSheet property in React Native.
  },
  particle: {
    position: 'absolute',
  },
  splatEmoji: {
    textAlign: 'center',
  },
});
