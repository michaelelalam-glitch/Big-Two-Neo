/**
 * InGameAlert — Modal-based alert that respects the game's chosen orientation.
 *
 * Problem: iOS native Alert.alert renders in the device's physical orientation,
 * ignoring expo-screen-orientation locks. When a player holds their device in
 * landscape but plays in portrait mode (via the in-game toggle), native alerts
 * appear in landscape — breaking the UI.
 *
 * Solution: This component uses a React Native <Modal> with supportedOrientations
 * that includes both portrait and landscape variants (game orientation listed
 * first for preference). This prevents iOS from throwing when the device's
 * current interface orientation is not in the supported set, while still
 * rendering correctly for the game's chosen orientation.
 *
 * Usage:
 *   // Render once in GameView:
 *   <InGameAlert ref={inGameAlertRef} orientation={currentOrientation} />
 *
 *   // Show from anywhere with access to the ref:
 *   inGameAlertRef.current?.show({ title: 'Error', message: 'Something failed' });
 */

import React, { useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal } from 'react-native';
import { COLORS, SPACING, FONT_SIZES } from '../../constants';
import { i18n } from '../../i18n';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InGameAlertButton {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

export interface InGameAlertOptions {
  title?: string;
  message: string;
  buttons?: InGameAlertButton[];
}

export interface InGameAlertHandle {
  show: (options: InGameAlertOptions) => void;
  hide: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface InGameAlertProps {
  orientation: 'portrait' | 'landscape';
}

export const InGameAlert = forwardRef<InGameAlertHandle, InGameAlertProps>(
  ({ orientation }, ref) => {
    const [visible, setVisible] = useState(false);
    const [alertOptions, setAlertOptions] = useState<InGameAlertOptions | null>(null);

    const show = useCallback((options: InGameAlertOptions) => {
      setAlertOptions(options);
      setVisible(true);
    }, []);

    const hide = useCallback(() => {
      setVisible(false);
      setAlertOptions(null);
    }, []);

    useImperativeHandle(ref, () => ({ show, hide }), [show, hide]);

    const handleButtonPress = useCallback(
      (onPress?: () => void) => {
        hide();
        onPress?.();
      },
      [hide]
    );

    // Include both portrait and landscape in supportedOrientations so the
    // Modal can always present without crashing on iOS (if the device's current
    // interface orientation isn't in the list, iOS throws). The game-orientation
    // is listed first so it's preferred.
    const supportedOrientations: (
      | 'portrait'
      | 'portrait-upside-down'
      | 'landscape'
      | 'landscape-left'
      | 'landscape-right'
    )[] =
      orientation === 'landscape'
        ? ['landscape', 'landscape-left', 'landscape-right', 'portrait', 'portrait-upside-down']
        : ['portrait', 'portrait-upside-down', 'landscape', 'landscape-left', 'landscape-right'];

    const buttons = alertOptions?.buttons ?? [
      { text: i18n.t('common.ok'), style: 'default' as const },
    ];

    return (
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={hide}
        supportedOrientations={supportedOrientations}
      >
        <View style={styles.overlay}>
          <View style={styles.alertContainer}>
            {alertOptions?.title && <Text style={styles.title}>{alertOptions.title}</Text>}
            <Text style={styles.message}>{alertOptions?.message}</Text>
            <View style={styles.buttonRow}>
              {buttons.map((btn, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={[
                    styles.button,
                    btn.style === 'destructive' && styles.buttonDestructive,
                    btn.style === 'cancel' && styles.buttonCancel,
                    buttons.length > 1 && idx < buttons.length - 1 && styles.buttonWithSeparator,
                  ]}
                  onPress={() => handleButtonPress(btn.onPress)}
                >
                  <Text
                    style={[
                      styles.buttonText,
                      btn.style === 'destructive' && styles.buttonTextDestructive,
                      btn.style === 'cancel' && styles.buttonTextCancel,
                    ]}
                  >
                    {btn.text}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </Modal>
    );
  }
);

InGameAlert.displayName = 'InGameAlert';

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
  },
  alertContainer: {
    backgroundColor: COLORS.gray.dark,
    borderRadius: 14,
    padding: SPACING.lg,
    minWidth: 270,
    maxWidth: 340,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  title: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '700',
    color: COLORS.white,
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
  message: {
    fontSize: FONT_SIZES.md,
    color: COLORS.gray.light,
    textAlign: 'center',
    marginBottom: SPACING.lg,
    lineHeight: 22,
  },
  buttonRow: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255, 255, 255, 0.15)',
    marginHorizontal: -SPACING.lg,
    paddingHorizontal: 0,
  },
  button: {
    flex: 1,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonWithSeparator: {
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: 'rgba(255, 255, 255, 0.15)',
  },
  buttonDestructive: {},
  buttonCancel: {},
  buttonText: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    color: COLORS.info,
  },
  buttonTextDestructive: {
    color: COLORS.error,
  },
  buttonTextCancel: {
    fontWeight: '400',
  },
});
