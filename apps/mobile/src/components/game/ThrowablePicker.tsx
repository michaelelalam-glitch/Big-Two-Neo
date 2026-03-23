/**
 * ThrowablePicker — compact bottom-sheet overlay for selecting a throwable type.
 *
 * Shows three options: Egg 🥚, Smoke 💨, Confetti 🎊.
 * Tapping one calls onSelect and closes the sheet.
 * Tapping outside (backdrop) calls onClose.
 */

import React, { useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  Animated,
  StyleSheet,
  TouchableWithoutFeedback,
} from 'react-native';
import type { ThrowableType } from '../../types/multiplayer';

interface ThrowablePickerProps {
  visible: boolean;
  onSelect: (throwable: ThrowableType) => void;
  onClose: () => void;
}

const OPTIONS: { type: ThrowableType; emoji: string; label: string; color: string }[] = [
  { type: 'egg', emoji: '🥚', label: 'Egg', color: '#FBBF24' },
  { type: 'smoke', emoji: '💨', label: 'Smoke', color: '#6B7280' },
  { type: 'confetti', emoji: '🎊', label: 'Confetti', color: '#7C3AED' },
];

export function ThrowablePicker({ visible, onSelect, onClose }: ThrowablePickerProps) {
  const slideAnim = useRef(new Animated.Value(200)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 0,
          useNativeDriver: true,
          tension: 100,
          friction: 8,
        }),
        Animated.timing(backdropOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    }
    // Note: close animation is omitted — the component returns null when !visible,
    // so a slide-out animation would never be rendered.
  }, [visible, slideAnim, backdropOpacity]);

  if (!visible) return null;

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      onRequestClose={onClose}
      supportedOrientations={['portrait', 'portrait-upside-down', 'landscape', 'landscape-left', 'landscape-right']}
    >
      {/* Backdrop */}
      <TouchableWithoutFeedback onPress={onClose} accessible={false}>
        <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]} />
      </TouchableWithoutFeedback>

      {/* Sheet */}
      <Animated.View style={[styles.sheet, { transform: [{ translateY: slideAnim }] }]}>
        <View style={styles.handle} />
        <Text style={styles.title}>Throw something</Text>
        <View style={styles.options}>
          {OPTIONS.map(opt => (
            <Pressable
              key={opt.type}
              style={({ pressed }) => [
                styles.optionButton,
                { backgroundColor: opt.color, opacity: pressed ? 0.75 : 1 },
              ]}
              onPress={() => onSelect(opt.type)}
              accessibilityRole="button"
              accessibilityLabel={`Throw ${opt.label}`}
            >
              <Text style={styles.optionEmoji}>{opt.emoji}</Text>
              <Text style={styles.optionLabel}>{opt.label}</Text>
            </Pressable>
          ))}
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#1F2937',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 10,
    paddingBottom: 36,
    paddingHorizontal: 20,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    backgroundColor: '#4B5563',
    borderRadius: 2,
    marginBottom: 12,
  },
  title: {
    color: '#F9FAFB',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 20,
  },
  options: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
  },
  optionButton: {
    width: 80,
    height: 80,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  optionEmoji: {
    fontSize: 30,
  },
  optionLabel: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
});
