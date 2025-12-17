import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Modal, Pressable } from 'react-native';
import { COLORS, SPACING, FONT_SIZES, OVERLAYS, MODAL } from '../../constants';
import { soundManager, hapticManager, HapticType, showConfirm } from '../../utils';

interface GameSettingsModalProps {
  visible: boolean;
  onClose: () => void;
  onLeaveGame: () => void;
}

export default function GameSettingsModal({
  visible,
  onClose,
  onLeaveGame,
}: GameSettingsModalProps) {
  // Load initial settings from managers
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [vibrationEnabled, setVibrationEnabled] = useState(true);

  // Load saved settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      const savedSoundEnabled = await soundManager.isAudioEnabled();
      const savedVibrationEnabled = await hapticManager.isHapticsEnabled();
      setSoundEnabled(savedSoundEnabled);
      setVibrationEnabled(savedVibrationEnabled);
    };
    loadSettings();
  }, []);

  const handleToggleSound = async () => {
    const newValue = !soundEnabled;
    setSoundEnabled(newValue);
    await soundManager.setAudioEnabled(newValue);
    // Play confirmation haptic
    if (vibrationEnabled) {
      hapticManager.trigger(HapticType.SELECTION);
    }
  };

  const handleToggleVibration = async () => {
    const newValue = !vibrationEnabled;
    setVibrationEnabled(newValue);
    await hapticManager.setHapticsEnabled(newValue);
    // Play confirmation haptic if enabling (ironic but standard UX)
    if (newValue) {
      hapticManager.trigger(HapticType.SELECTION);
    }
  };

  const handleLeaveGame = () => {
    // Close modal first, then trigger leave game flow
    // GameScreen will show the confirmation dialog
    onClose();
    onLeaveGame();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <View style={styles.modalContainer} onStartShouldSetResponder={() => true}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Settings</Text>
            <Pressable 
              onPress={onClose} 
              style={styles.closeButton}
              accessibilityRole="button"
              accessibilityLabel="Close settings"
            >
              <Text style={styles.closeButtonText}>✕</Text>
            </Pressable>
          </View>

          <View style={styles.content}>
            {/* Sound Settings */}
            <Pressable 
              style={styles.menuItem}
              onPress={handleToggleSound}
              accessibilityRole="button"
              accessibilityLabel={`Sound Effects, currently ${soundEnabled ? 'on' : 'off'}`}
              accessibilityHint="Tap to toggle sound effects"
            >
              <Text style={styles.menuItemText}>🔊 Sound Effects</Text>
              <Text style={styles.menuItemValue}>{soundEnabled ? 'On' : 'Off'}</Text>
            </Pressable>

            {/* Music Settings - Coming Soon (non-interactive) */}
            <View style={[styles.menuItem, styles.disabledItem]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={[styles.menuItemText, styles.disabledText]}>🎵 Music</Text>
                <Text style={styles.comingSoonBadge}>Coming soon</Text>
              </View>
              <Text style={styles.disabledText}>Off</Text>
            </View>

            {/* Vibration Settings */}
            <Pressable 
              style={styles.menuItem}
              onPress={handleToggleVibration}
              accessibilityRole="button"
              accessibilityLabel={`Vibration, currently ${vibrationEnabled ? 'on' : 'off'}`}
              accessibilityHint="Tap to toggle vibration"
            >
              <Text style={styles.menuItemText}>📳 Vibration</Text>
              <Text style={styles.menuItemValue}>{vibrationEnabled ? 'On' : 'Off'}</Text>
            </Pressable>

            <View style={styles.divider} />

            {/* Leave Game - Only shown in game */}
            <Pressable
              style={[styles.menuItem, styles.leaveGameItem]}
              onPress={handleLeaveGame}
              accessibilityRole="button"
              accessibilityLabel="Leave game"
              accessibilityHint="Leave the current game and return to home"
            >
              <Text style={[styles.menuItemText, styles.leaveGameText]}>
                Leave Game
              </Text>
            </Pressable>
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: OVERLAYS.modalOverlay,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    width: '85%',
    maxWidth: MODAL.maxWidth,
    backgroundColor: COLORS.primary,
    borderRadius: MODAL.borderRadius,
    borderWidth: MODAL.borderWidth,
    borderColor: COLORS.gray.medium,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SPACING.lg,
    paddingHorizontal: SPACING.xl,
    backgroundColor: COLORS.gray.dark,
    borderBottomWidth: MODAL.headerBorderWidth,
    borderBottomColor: COLORS.gray.medium,
  },
  headerTitle: {
    fontSize: FONT_SIZES.xl,
    fontWeight: 'bold',
    color: COLORS.white,
  },
  closeButton: {
    width: MODAL.closeButtonSize,
    height: MODAL.closeButtonSize,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: MODAL.closeButtonRadius,
    backgroundColor: OVERLAYS.closeButtonBackground,
  },
  closeButtonText: {
    fontSize: FONT_SIZES.xl,
    color: COLORS.white,
    fontWeight: 'bold',
  },
  content: {
    padding: SPACING.lg,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    backgroundColor: COLORS.gray.dark,
    borderRadius: MODAL.menuItemBorderRadius,
    marginBottom: SPACING.sm,
  },
  menuItemText: {
    fontSize: FONT_SIZES.lg,
    color: COLORS.white,
    fontWeight: '600',
  },
  menuItemValue: {
    fontSize: FONT_SIZES.md,
    color: COLORS.gray.light,
    fontWeight: '500',
  },
  divider: {
    height: MODAL.dividerHeight,
    backgroundColor: COLORS.gray.medium,
    marginVertical: SPACING.md,
  },
  leaveGameItem: {
    backgroundColor: OVERLAYS.leaveGameBackground,
    borderWidth: MODAL.leaveGameBorderWidth,
    borderColor: OVERLAYS.leaveGameBorder,
  },
  leaveGameText: {
    color: COLORS.danger,
  },
  disabledItem: {
    opacity: 0.5,
  },
  disabledText: {
    color: COLORS.gray.medium,
  },
  comingSoonBadge: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.gray.medium,
    fontStyle: 'italic',
    opacity: 0.8,
  },
});
