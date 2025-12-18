import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, useWindowDimensions } from 'react-native';
import { COLORS, SPACING, FONT_SIZES, OVERLAYS, MODAL } from '../../constants';
import { soundManager, hapticManager, HapticType, showConfirm } from '../../utils';
import { i18n } from '../../i18n';

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
  // Detect orientation
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  
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
      supportedOrientations={['portrait', 'landscape']}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <View style={[styles.modalContainer, isLandscape && styles.modalContainerLandscape]} onStartShouldSetResponder={() => true}>
          <View style={[styles.header, isLandscape && styles.headerLandscape]}>
            <Text style={[styles.headerTitle, isLandscape && styles.headerTitleLandscape]}>{i18n.t('game.settings')}</Text>
            <Pressable 
              onPress={onClose} 
              style={styles.closeButton}
              accessibilityRole="button"
              accessibilityLabel="Close settings"
            >
              <Text style={styles.closeButtonText}>✕</Text>
            </Pressable>
          </View>

          {/* LANDSCAPE MODE: Single row layout */}
          {isLandscape ? (
            <View style={styles.contentLandscape}>
              <Pressable 
                style={styles.menuItemLandscape}
                onPress={handleToggleSound}
                accessibilityRole="button"
                accessibilityLabel={`${i18n.t('settings.soundEffects')}, currently ${soundEnabled ? i18n.t('common.on') : i18n.t('common.off')}`}
              >
                <Text style={styles.menuItemTextLandscape}>🔊</Text>
                <Text style={styles.menuItemLabelLandscape}>{i18n.t('settings.soundEffects')}</Text>
                <Text style={styles.menuItemValueLandscape}>{soundEnabled ? i18n.t('common.on') : i18n.t('common.off')}</Text>
              </Pressable>

              <View style={styles.menuItemLandscape}>
                <Text style={[styles.menuItemTextLandscape, styles.disabledText]}>🎵</Text>
                <Text style={[styles.menuItemLabelLandscape, styles.disabledText]}>{i18n.t('settings.music')}</Text>
                <Text style={[styles.menuItemValueLandscape, styles.disabledText]}>{i18n.t('common.off')}</Text>
              </View>

              <Pressable 
                style={styles.menuItemLandscape}
                onPress={handleToggleVibration}
                accessibilityRole="button"
                accessibilityLabel={`${i18n.t('settings.vibration')}, currently ${vibrationEnabled ? i18n.t('common.on') : i18n.t('common.off')}`}
              >
                <Text style={styles.menuItemTextLandscape}>📳</Text>
                <Text style={styles.menuItemLabelLandscape}>{i18n.t('settings.vibration')}</Text>
                <Text style={styles.menuItemValueLandscape}>{vibrationEnabled ? i18n.t('common.on') : i18n.t('common.off')}</Text>
              </Pressable>

              <View style={styles.dividerLandscape} />

              <Pressable
                style={[styles.menuItemLandscape, styles.leaveGameItemLandscape]}
                onPress={handleLeaveGame}
                accessibilityRole="button"
                accessibilityLabel="Leave game"
              >
                <Text style={styles.leaveGameTextLandscape}>
                  {i18n.t('game.leaveGame')}
                </Text>
              </Pressable>
            </View>
          ) : (
            /* PORTRAIT MODE: Original vertical layout */
            <View style={styles.content}>
              {/* Sound Settings */}
              <Pressable 
                style={styles.menuItem}
                onPress={handleToggleSound}
                accessibilityRole="button"
                accessibilityLabel={`${i18n.t('settings.soundEffects')}, currently ${soundEnabled ? i18n.t('common.on') : i18n.t('common.off')}`}
                accessibilityHint="Tap to toggle sound effects"
              >
                <Text style={styles.menuItemText}>🔊 {i18n.t('settings.soundEffects')}</Text>
                <Text style={styles.menuItemValue}>{soundEnabled ? i18n.t('common.on') : i18n.t('common.off')}</Text>
              </Pressable>

              {/* Music Settings - Coming Soon (non-interactive) */}
              <View style={[styles.menuItem, styles.disabledItem]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={[styles.menuItemText, styles.disabledText]}>🎵 {i18n.t('settings.music')}</Text>
                  <Text style={styles.comingSoonBadge}>Coming soon</Text>
                </View>
                <Text style={styles.disabledText}>{i18n.t('common.off')}</Text>
              </View>

              {/* Vibration Settings */}
              <Pressable 
                style={styles.menuItem}
                onPress={handleToggleVibration}
                accessibilityRole="button"
                accessibilityLabel={`${i18n.t('settings.vibration')}, currently ${vibrationEnabled ? i18n.t('common.on') : i18n.t('common.off')}`}
                accessibilityHint="Tap to toggle vibration"
              >
                <Text style={styles.menuItemText}>📳 {i18n.t('settings.vibration')}</Text>
                <Text style={styles.menuItemValue}>{vibrationEnabled ? i18n.t('common.on') : i18n.t('common.off')}</Text>
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
                  {i18n.t('game.leaveGame')}
                </Text>
              </Pressable>
            </View>
          )}
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
  // LANDSCAPE MODE STYLES - Compact horizontal layout
  modalContainerLandscape: {
    width: '90%',
    maxWidth: 700,
  },
  headerLandscape: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
  },
  headerTitleLandscape: {
    fontSize: FONT_SIZES.lg,
  },
  contentLandscape: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    gap: SPACING.sm,
  },
  menuItemLandscape: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    backgroundColor: COLORS.gray.dark,
    borderRadius: MODAL.menuItemBorderRadius,
    minWidth: 80,
    gap: 4,
  },
  menuItemTextLandscape: {
    fontSize: FONT_SIZES.xl,
  },
  menuItemLabelLandscape: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.white,
    fontWeight: '600',
    textAlign: 'center',
  },
  menuItemValueLandscape: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.gray.light,
    fontWeight: '500',
    textAlign: 'center',
  },
  dividerLandscape: {
    width: 1,
    height: 50,
    backgroundColor: COLORS.gray.medium,
  },
  leaveGameItemLandscape: {
    backgroundColor: OVERLAYS.leaveGameBackground,
    borderWidth: MODAL.leaveGameBorderWidth,
    borderColor: OVERLAYS.leaveGameBorder,
  },
  leaveGameTextLandscape: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.danger,
    fontWeight: '700',
    textAlign: 'center',
  },
});
