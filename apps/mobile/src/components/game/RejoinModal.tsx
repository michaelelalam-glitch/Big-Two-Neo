/**
 * RejoinModal – shown when the server has replaced a disconnected human with a bot.
 *
 * The player sees this when:
 *   • They were away > 60 seconds and a bot took their seat.
 *   • They re-opened the app and get-rejoin-status returns 'replaced_by_bot'.
 *   • useConnectionManager fires onBotReplaced.
 *
 * Tapping "Reclaim My Seat" calls reconnect() which:
 *   1. Hits the reconnect-player edge function.
 *   2. The server swaps the bot row back to the human's user_id.
 *   3. The game continues for everyone — no interruption.
 *
 * fix/rejoin branch
 */

import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { COLORS, FONT_SIZES, SPACING } from '../../constants';

// ─── Props ────────────────────────────────────────────────────────────────────

interface RejoinModalProps {
  /** Whether the modal is visible */
  visible: boolean;
  /**
   * Username of the bot currently holding the seat.
   * Shown so the player knows which slot was taken.
   */
  botUsername?: string | null;
  /**
   * Seconds remaining in the game (from server) — informational.
   * undefined = we don't know yet; pass through from RejoinStatusPayload.
   */
  secondsLeft?: number;
  /** Called when the player taps "Reclaim My Seat" */
  onReclaim: () => Promise<void>;
  /**
   * Called when the player taps "Leave Room" — permanently leaves the game.
   * If undefined the leave button is hidden.
   */
  onLeaveRoom?: () => void;
  /**
   * Called when the player taps "Watch / Spectate" or closes the modal.
   * If undefined the dismiss button is hidden (player MUST reclaim or leave).
   */
  onDismiss?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function RejoinModal({
  visible,
  botUsername,
  onReclaim,
  onLeaveRoom,
  onDismiss,
}: RejoinModalProps) {
  const [isReclaiming, setIsReclaiming] = useState(false);
  const [reclaimed, setReclaimed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset internal state each time the modal is opened so a previously-shown
  // "Seat reclaimed" or error state does not bleed into the next appearance.
  useEffect(() => {
    if (visible) {
      setIsReclaiming(false);
      setReclaimed(false);
      setError(null);
    }
  }, [visible]);

  const handleReclaim = async () => {
    setIsReclaiming(true);
    setError(null);
    try {
      await onReclaim();
      setReclaimed(true);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to reclaim seat. Please try again.';
      setError(message);
    } finally {
      setIsReclaiming(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      accessibilityViewIsModal
      onRequestClose={onDismiss ?? (() => {})}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          {/* Icon */}
          <Text style={styles.icon}>🤖</Text>

          {/* Title */}
          <Text style={styles.title}>A bot replaced you!</Text>

          {/* Body */}
          <Text style={styles.body}>
            {botUsername
              ? `${botUsername} (bot) is playing in your seat.`
              : 'A bot is playing in your seat.'}
            {'\n\n'}
            Tap <Text style={styles.bold}>Reclaim My Seat</Text> to jump back in — the game
            keeps going for everyone else.
          </Text>

          {/* Error */}
          {error !== null && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Success state */}
          {reclaimed ? (
            <View style={styles.successBox}>
              <Text style={styles.successText}>✅ Seat reclaimed! Rejoining…</Text>
            </View>
          ) : (
            <>
              {/* Primary CTA */}
              <TouchableOpacity
                style={[styles.reclaimButton, isReclaiming && styles.reclaimButtonDisabled]}
                onPress={handleReclaim}
                disabled={isReclaiming}
                accessibilityRole="button"
                accessibilityLabel="Reclaim my seat"
              >
                {isReclaiming ? (
                  <ActivityIndicator color={COLORS.white} size="small" />
                ) : (
                  <Text style={styles.reclaimButtonText}>Reclaim My Seat</Text>
                )}
              </TouchableOpacity>

              {/* Secondary: dismiss / spectate */}
              {onDismiss && (
                <TouchableOpacity
                  style={styles.dismissButton}
                  onPress={onDismiss}
                  disabled={isReclaiming}
                  accessibilityRole="button"
                  accessibilityLabel="Watch as spectator"
                >
                  <Text style={styles.dismissButtonText}>Watch Game</Text>
                </TouchableOpacity>
              )}

              {/* Leave room permanently */}
              {onLeaveRoom && (
                <TouchableOpacity
                  style={styles.leaveButton}
                  onPress={onLeaveRoom}
                  disabled={isReclaiming}
                  accessibilityRole="button"
                  accessibilityLabel="Leave room"
                >
                  <Text style={styles.leaveButtonText}>Leave Room</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
  },
  card: {
    backgroundColor: '#1a2235',
    borderRadius: 20,
    padding: SPACING.xl,
    alignItems: 'center',
    width: '100%',
    maxWidth: 360,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  icon: {
    fontSize: 48,
    marginBottom: SPACING.md,
  },
  title: {
    fontSize: FONT_SIZES.xl,
    fontWeight: 'bold',
    color: COLORS.white,
    marginBottom: SPACING.sm,
    textAlign: 'center',
  },
  body: {
    fontSize: FONT_SIZES.md,
    color: 'rgba(255,255,255,0.75)',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: SPACING.lg,
  },
  bold: {
    fontWeight: 'bold',
    color: COLORS.white,
  },
  errorBox: {
    backgroundColor: 'rgba(220,53,69,0.2)',
    borderRadius: 8,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    marginBottom: SPACING.md,
    width: '100%',
  },
  errorText: {
    color: '#ff6b7a',
    fontSize: FONT_SIZES.sm,
    textAlign: 'center',
  },
  successBox: {
    backgroundColor: 'rgba(46,125,50,0.3)',
    borderRadius: 8,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    width: '100%',
  },
  successText: {
    color: '#69f0ae',
    fontSize: FONT_SIZES.md,
    textAlign: 'center',
    fontWeight: '600',
  },
  reclaimButton: {
    backgroundColor: COLORS.red?.active ?? '#e53935',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: SPACING.xl,
    width: '100%',
    alignItems: 'center',
    marginBottom: SPACING.sm,
    minHeight: 50,
    justifyContent: 'center',
  },
  reclaimButtonDisabled: {
    opacity: 0.6,
  },
  reclaimButtonText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.md,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  dismissButton: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    alignItems: 'center',
  },
  dismissButtonText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: FONT_SIZES.sm,
  },
  leaveButton: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    alignItems: 'center',
    marginTop: SPACING.xs,
  },
  leaveButtonText: {
    color: '#ff6b7a',
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
  },
});

export default RejoinModal;
