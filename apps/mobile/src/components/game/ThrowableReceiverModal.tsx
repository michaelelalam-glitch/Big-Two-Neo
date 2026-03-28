/**
 * ThrowableReceiverModal — full-screen animated popup shown only to the player
 * who was targeted by a throwable.
 *
 * Behaviour:
 * - Appears with a scale-in + fade animation.
 * - Auto-dismisses after 5 seconds (parent controls via `visible` prop).
 * - Dismissed immediately on double-tap anywhere on the overlay.
 * - Bots never see this (they have no screen).
 */

import React, { useEffect, useRef, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  Animated,
  TouchableWithoutFeedback,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import type { ThrowableType } from '../../types/multiplayer';
import { MODAL_SUPPORTED_ORIENTATIONS } from '../../constants';

interface ThrowableReceiverModalProps {
  visible: boolean;
  throwable: ThrowableType;
  fromName: string;
  onDismiss: () => void;
}

const BIG_EMOJI: Record<ThrowableType, string> = {
  egg: '🥚',
  smoke: '💨',
  confetti: '🎊',
  cake: '🎂',
};

const SPLAT_EMOJI: Record<ThrowableType, string> = {
  egg: '🍳',
  smoke: '🌫️',
  confetti: '✨',
  cake: '🍰',
};

const LABEL: Record<ThrowableType, string> = {
  egg: 'Splat!',
  smoke: 'Poof!',
  confetti: 'Surprise!',
  cake: 'Splat!',
};

const BG_COLOR: Record<ThrowableType, string> = {
  egg: 'rgba(251,191,36,0.92)',
  smoke: 'rgba(107,114,128,0.90)',
  confetti: 'rgba(124,58,237,0.88)',
  cake: 'rgba(236,72,153,0.90)',
};

/** Confetti piece colored randomly for the confetti theme. */
const CONFETTI_COLORS = ['#EF4444', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899'];

function ConfettiPieces() {
  const pieces = Array.from({ length: 20 }, (_, i) => i);

  return (
    <>
      {pieces.map(i => {
        const leftPct = (i * 93 + 17) % 100;
        const topPct = (i * 47 + 5) % 80;
        const color = CONFETTI_COLORS[i % CONFETTI_COLORS.length] ?? '#FFFFFF';
        const rotate = `${(i * 37) % 360}deg`;
        const size = 6 + (i % 5) * 2;
        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: `${leftPct}%`,
              top: `${topPct}%`,
              width: size,
              height: size + 2,
              backgroundColor: color,
              borderRadius: 1,
              transform: [{ rotate }],
              opacity: 0.9,
            }}
          />
        );
      })}
    </>
  );
}

export function ThrowableReceiverModal({
  visible,
  throwable,
  fromName,
  onDismiss,
}: ThrowableReceiverModalProps) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const splatAnim = useRef(new Animated.Value(0)).current;

  // Track double-tap: two taps within 300 ms dismisses the modal.
  const lastTapRef = useRef<number>(0);

  const handleTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      onDismiss();
    }
    lastTapRef.current = now;
  }, [onDismiss]);

  useEffect(() => {
    if (!visible) {
      // Reset for next show.
      scaleAnim.setValue(0);
      opacityAnim.setValue(0);
      splatAnim.setValue(0);
      return;
    }

    Animated.sequence([
      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 1,
          useNativeDriver: true,
          tension: 100,
          friction: 7,
        }),
        Animated.timing(opacityAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]),
      Animated.delay(300),
      Animated.spring(splatAnim, {
        toValue: 1,
        useNativeDriver: true,
        tension: 80,
        friction: 6,
      }),
    ]).start();
  }, [visible, scaleAnim, opacityAnim, splatAnim]);

  if (!visible) return null;

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      statusBarTranslucent
      supportedOrientations={MODAL_SUPPORTED_ORIENTATIONS}
      onRequestClose={onDismiss}
    >
      <TouchableWithoutFeedback onPress={handleTap} accessible={false}>
        <Animated.View
          style={[
            styles.backdrop,
            {
              width: screenWidth,
              height: screenHeight,
              backgroundColor: BG_COLOR[throwable],
              opacity: opacityAnim,
            },
          ]}
        >
          {/* Confetti background pieces */}
          {throwable === 'confetti' && <ConfettiPieces />}

          <Animated.View style={[styles.content, { transform: [{ scale: scaleAnim }] }]}>
            {/* Incoming projectile emoji */}
            <Text style={styles.bigEmoji} accessibilityLabel={`${throwable} incoming`}>
              {BIG_EMOJI[throwable]}
            </Text>

            {/* Splat / impact emoji */}
            <Animated.Text style={[styles.splatEmoji, { transform: [{ scale: splatAnim }] }]}>
              {SPLAT_EMOJI[throwable]}
            </Animated.Text>

            {/* Label */}
            <Text style={styles.label}>{LABEL[throwable]}</Text>

            {/* From-name attribution */}
            <Text style={styles.from}>{fromName} threw this at you!</Text>

            {/* Dismiss hint */}
            <Text style={styles.hint}>Double-tap to dismiss</Text>
          </Animated.View>
        </Animated.View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
    gap: 8,
  },
  bigEmoji: {
    fontSize: 80,
    marginBottom: 4,
  },
  splatEmoji: {
    fontSize: 56,
  },
  label: {
    fontSize: 36,
    fontWeight: '900',
    color: '#FFFFFF',
    marginTop: 8,
  },
  from: {
    fontSize: 18,
    color: 'rgba(255,255,255,0.9)',
    fontWeight: '600',
    marginTop: 4,
  },
  hint: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.65)',
    marginTop: 16,
  },
});
