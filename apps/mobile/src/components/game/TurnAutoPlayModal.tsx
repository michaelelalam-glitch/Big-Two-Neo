/**
 * TurnAutoPlayModal – shown when the 60s turn countdown expires and auto-play executes.
 *
 * The player sees this when:
 *   • It's their turn and they didn't play/pass within 60 seconds
 *   • auto-play-turn edge function auto-played highest valid cards OR passed
 *   • The game kept moving forward to avoid stalling
 *
 * Tapping "I'm Still Here" dismisses the modal and continues playing normally.
 * If not dismissed within 30s: marks player as disconnected → bot replacement flow
 *
 * fix/turn-inactivity branch
 */

import React, { useState, useEffect, useRef } from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { COLORS, FONT_SIZES, SPACING } from '../../constants';
import { i18n } from '../../i18n';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Card {
  id: string;
  rank: string;
  suit: string;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface TurnAutoPlayModalProps {
  /** Whether the modal is visible */
  visible: boolean;
  /** What action was taken: 'play' (cards played) or 'pass' (no valid play) */
  action: 'play' | 'pass';
  /** Cards that were auto-played (null if passed) */
  cards: Card[] | null;
  /** Called when the player taps "I'm Still Here" */
  onConfirm: () => void;
  /**
   * Called if the player doesn't respond within 30s.
   * Triggers disconnect → bot replacement flow.
   */
  onTimeout?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

const RESPONSE_TIMEOUT_MS = 30_000; // 30 seconds to respond
const RESPONSE_TIMEOUT_S = RESPONSE_TIMEOUT_MS / 1000;

export function TurnAutoPlayModal({
  visible,
  action,
  cards,
  onConfirm,
  onTimeout,
}: TurnAutoPlayModalProps) {
  const [secondsLeft, setSecondsLeft] = useState(RESPONSE_TIMEOUT_S);

  // Store onTimeout in a ref so the interval callback always has the latest
  // version without needing onTimeout in the dep array (which would restart
  // the interval — and reset the countdown — on every parent re-render).
  const onTimeoutRef = useRef(onTimeout);
  useEffect(() => {
    onTimeoutRef.current = onTimeout;
  }, [onTimeout]);

  // Reset timer when modal opens
  useEffect(() => {
    if (!visible) return;

    setSecondsLeft(RESPONSE_TIMEOUT_S);
    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const remaining = Math.max(0, RESPONSE_TIMEOUT_S - elapsed);
      setSecondsLeft(remaining);

      if (remaining === 0) {
        clearInterval(interval);
        onTimeoutRef.current?.();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [visible]);

  const renderAutoPlayedCards = () => {
    if (!cards || cards.length === 0) return null;

    const cardText = cards.map(c => `${c.rank}${c.suit}`).join(', ');
    return (
      <View style={styles.cardsBox}>
        <Text style={styles.cardsLabel}>{i18n.t('game.autoPlayedLabel')}</Text>
        <Text style={styles.cardsText}>{cardText}</Text>
      </View>
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      accessibilityViewIsModal
      onRequestClose={onConfirm}
      supportedOrientations={[
        'portrait',
        'portrait-upside-down',
        'landscape-left',
        'landscape-right',
      ]}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          {/* Icon */}
          <Text style={styles.icon}>⏰</Text>

          {/* Title */}
          <Text style={styles.title}>{i18n.t('game.autoPlayedForYouTitle')}</Text>

          {/* Body */}
          <Text style={styles.body}>
            {action === 'play'
              ? i18n.t('game.autoPlayedPlay', {
                  count: cards?.length || 0,
                  card:
                    (cards?.length || 0) === 1
                      ? i18n.t('game.cardSingular')
                      : i18n.t('game.cardPlural'),
                })
              : i18n.t('game.autoPlayedPass')}
            {'\n\n'}
            <Text style={styles.bold}>{i18n.t('game.areYouStillHere')}</Text>
            {'\n'}
            <Text style={styles.small}>
              {i18n.t('game.tapBelowOrDisconnect', { seconds: secondsLeft })}
            </Text>
          </Text>

          {/* Show auto-played cards */}
          {action === 'play' && renderAutoPlayedCards()}

          {/* Primary CTA */}
          <TouchableOpacity
            style={styles.confirmButton}
            onPress={onConfirm}
            accessibilityRole="button"
            accessibilityLabel={i18n
              .t('game.imStillHere')
              .replace(/[\u{1F300}-\u{1FFFF}\u{2600}-\u{27FF}]/gu, '')
              .trim()}
          >
            <Text style={styles.confirmButtonText}>{i18n.t('game.imStillHere')}</Text>
          </TouchableOpacity>

          {/* Timer warning */}
          <Text style={styles.timerText}>
            {i18n.t('game.secondsRemainingTimer', { seconds: secondsLeft })}
          </Text>
        </View>
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.xl,
  },
  card: {
    backgroundColor: COLORS.background.dark,
    borderRadius: 16,
    paddingVertical: SPACING.xl,
    paddingHorizontal: SPACING.xl,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 12,
  },
  icon: {
    fontSize: 56,
    marginBottom: SPACING.md,
  },
  title: {
    fontSize: FONT_SIZES.xxl,
    fontWeight: '700',
    color: COLORS.white,
    marginBottom: SPACING.md,
    textAlign: 'center',
  },
  body: {
    fontSize: FONT_SIZES.md,
    color: COLORS.gray.text,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: SPACING.lg,
  },
  bold: {
    fontWeight: '700',
    color: COLORS.white,
  },
  small: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.gray.textDark,
  },
  cardsBox: {
    backgroundColor: COLORS.background.primary,
    borderRadius: 8,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.lg,
    width: '100%',
  },
  cardsLabel: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.gray.textDark,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  cardsText: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    color: COLORS.accent, // Orange color
    textAlign: 'center',
  },
  confirmButton: {
    backgroundColor: COLORS.success,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.xl,
    borderRadius: 12,
    minWidth: 220,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.md,
    shadowColor: COLORS.success,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  confirmButtonText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.lg,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  timerText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.error,
    fontWeight: '600',
  },
});
