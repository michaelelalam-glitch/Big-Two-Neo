import React from 'react';
import { View, Text, StyleSheet, Modal, Pressable, Alert } from 'react-native';
import { COLORS, SPACING, FONT_SIZES, OVERLAYS } from '../../constants';

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
  const handleLeaveGame = () => {
    Alert.alert(
      'Leave Game',
      'Are you sure you want to leave this game? Your progress will be lost.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: () => {
            onClose();
            onLeaveGame();
          },
        },
      ]
    );
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
              onPress={() => Alert.alert('Coming soon', 'This setting will be available in a future update.')}
              accessibilityRole="button"
              accessibilityLabel="Sound Effects, currently on"
              accessibilityHint="Tap to toggle sound effects"
            >
              <Text style={styles.menuItemText}>🔊 Sound Effects</Text>
              <Text style={styles.menuItemValue}>On</Text>
            </Pressable>

            {/* Music Settings */}
            <Pressable 
              style={styles.menuItem}
              onPress={() => Alert.alert('Coming soon', 'This setting will be available in a future update.')}
              accessibilityRole="button"
              accessibilityLabel="Music, currently on"
              accessibilityHint="Tap to toggle music"
            >
              <Text style={styles.menuItemText}>🎵 Music</Text>
              <Text style={styles.menuItemValue}>On</Text>
            </Pressable>

            {/* Vibration Settings */}
            <Pressable 
              style={styles.menuItem}
              onPress={() => Alert.alert('Coming soon', 'This setting will be available in a future update.')}
              accessibilityRole="button"
              accessibilityLabel="Vibration, currently on"
              accessibilityHint="Tap to toggle vibration"
            >
              <Text style={styles.menuItemText}>📳 Vibration</Text>
              <Text style={styles.menuItemValue}>On</Text>
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
    maxWidth: 400,
    backgroundColor: COLORS.primary,
    borderRadius: 20,
    borderWidth: 2,
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
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray.medium,
  },
  headerTitle: {
    fontSize: FONT_SIZES.xl,
    fontWeight: 'bold',
    color: COLORS.white,
  },
  closeButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
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
    borderRadius: 12,
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
    height: 1,
    backgroundColor: COLORS.gray.medium,
    marginVertical: SPACING.md,
  },
  leaveGameItem: {
    backgroundColor: OVERLAYS.leaveGameBackground,
    borderWidth: 1,
    borderColor: OVERLAYS.leaveGameBorder,
  },
  leaveGameText: {
    color: COLORS.danger,
  },
});
