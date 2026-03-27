/**
 * PrivacyConsentModal — Task #272 (GDPR / analytics consent)
 *
 * Modal asking the user to opt in or out of anonymous analytics and crash
 * reporting. This is a presentational component: it renders the UI and
 * surfaces the user's choice via `onAccept` and `onDecline` callbacks.
 *
 * Any persistence of the choice (e.g. to AsyncStorage) and enabling/disabling
 * of analytics or error-reporting services (e.g. Firebase Analytics, Sentry)
 * must be implemented by the caller of this component.
 */

import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface PrivacyConsentModalProps {
  /** Whether the modal is currently visible. */
  visible: boolean;
  /** Called when the user taps "Accept & Continue". */
  onAccept: () => void;
  /** Called when the user taps "No thanks". */
  onDecline: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PrivacyConsentModal({
  visible,
  onAccept,
  onDecline,
}: PrivacyConsentModalProps) {
  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      statusBarTranslucent
      // Prevents assistive technology from interacting with background content
      accessibilityViewIsModal
    >
      <View style={styles.overlay}>
        <View
          style={styles.card}
          accessibilityLiveRegion="polite"
          // Expose the card as a named region so screen readers announce it
          accessible
          accessibilityLabel="Privacy settings dialog"
        >
          {/* Icon */}
          <Text style={styles.icon} accessibilityElementsHidden>
            🔒
          </Text>

          {/* Title */}
          <Text style={styles.title} accessibilityRole="header">
            We Value Your Privacy
          </Text>

          {/* Body copy */}
          <Text style={styles.body}>
            Big&nbsp;2 uses <Text style={styles.bodyBold}>analytics</Text> to improve the game
            experience and <Text style={styles.bodyBold}>crash reporting</Text> to fix bugs faster.
            We use trusted third-party services (such as Firebase and Sentry) and share a
            pseudonymous ID with them, but not your name, email, or contact details.
          </Text>

          <Text style={styles.body}>Your choice is saved for future app launches.</Text>

          {/* Accept */}
          <TouchableOpacity
            style={styles.acceptButton}
            onPress={onAccept}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Accept analytics and continue"
            testID="privacy-consent-accept"
          >
            <Text style={styles.acceptText}>Accept &amp; Continue</Text>
          </TouchableOpacity>

          {/* Decline */}
          <TouchableOpacity
            style={styles.declineButton}
            onPress={onDecline}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Decline analytics tracking"
            testID="privacy-consent-decline"
          >
            <Text style={styles.declineText}>No thanks</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#1a1f2e',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(74, 144, 226, 0.3)',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.45,
        shadowRadius: 16,
      },
      android: {
        elevation: 12,
      },
    }),
  },
  icon: {
    fontSize: 40,
    marginBottom: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#f3f4f6',
    textAlign: 'center',
    marginBottom: 16,
  },
  body: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 12,
  },
  bodyBold: {
    color: '#d1d5db',
    fontWeight: '600',
  },
  acceptButton: {
    backgroundColor: '#4A90E2',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    width: '100%',
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 10,
    minHeight: 44, // iOS HIG minimum touch target
    justifyContent: 'center',
  },
  acceptText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  declineButton: {
    paddingVertical: 10,
    paddingHorizontal: 24,
    width: '100%',
    alignItems: 'center',
    minHeight: 44, // iOS HIG minimum touch target
    justifyContent: 'center',
  },
  declineText: {
    color: '#6b7280',
    fontSize: 14,
    fontWeight: '500',
  },
});
