/**
 * PlayerTargetPicker — modal for selecting which opponent to throw at.
 *
 * Shows names of the other players in the current game. The local player
 * (display index 0) is excluded. Bots CAN be targeted — they just don't see
 * the full-screen popup.
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
import { MODAL_SUPPORTED_ORIENTATIONS } from '../../constants';

interface PlayerTargetPickerProps {
  visible: boolean;
  throwable: ThrowableType;
  /** layoutPlayers[1..3] — opponents in display order (top, left, right) */
  opponents: readonly { name: string; player_index: number }[];
  onSelect: (playerIndex: number) => void;
  onClose: () => void;
}

const THROWABLE_EMOJI: Record<ThrowableType, string> = {
  egg: '🥚',
  smoke: '💨',
  confetti: '🎊',
  cake: '🎂',
};

const POSITION_LABEL: Record<number, string> = {
  1: 'Top',
  2: 'Left',
  3: 'Right',
};

export function PlayerTargetPicker({
  visible,
  throwable,
  opponents,
  onSelect,
  onClose,
}: PlayerTargetPickerProps) {
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
      supportedOrientations={MODAL_SUPPORTED_ORIENTATIONS}
    >
      <TouchableWithoutFeedback onPress={onClose} accessible={false}>
        <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]} />
      </TouchableWithoutFeedback>

      <Animated.View style={[styles.sheet, { transform: [{ translateY: slideAnim }] }]}>
        <View style={styles.handle} />
        <Text style={styles.title}>{THROWABLE_EMOJI[throwable]} Throw at…</Text>

        <View style={styles.playerList}>
          {opponents.map((opp, displayOffsetIdx) => (
            <Pressable
              key={opp.player_index}
              style={({ pressed }) => [styles.playerButton, pressed && styles.playerButtonPressed]}
              onPress={() => onSelect(opp.player_index)}
              accessibilityRole="button"
              accessibilityLabel={`Throw at ${opp.name}`}
            >
              <Text style={styles.playerEmoji}>🎯</Text>
              <View style={styles.playerInfo}>
                <Text style={styles.playerName} numberOfLines={1}>
                  {opp.name}
                </Text>
                <Text style={styles.playerPosition}>
                  {POSITION_LABEL[displayOffsetIdx + 1] ?? ''}
                </Text>
              </View>
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
    marginBottom: 16,
  },
  playerList: {
    gap: 10,
  },
  playerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#374151',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 12,
  },
  playerButtonPressed: {
    opacity: 0.7,
    transform: [{ scale: 0.98 }],
  },
  playerEmoji: {
    fontSize: 22,
  },
  playerInfo: {
    flex: 1,
  },
  playerName: {
    color: '#F9FAFB',
    fontSize: 15,
    fontWeight: '600',
  },
  playerPosition: {
    color: '#9CA3AF',
    fontSize: 11,
    marginTop: 1,
  },
});
