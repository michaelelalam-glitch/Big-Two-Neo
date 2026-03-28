/**
 * useGameActions — Play/Pass action handlers for both local AI and multiplayer games.
 *
 * Extracted from GameScreen.tsx to reduce file size (~200 lines).
 * Handles:
 * - handlePlayCards / handlePass with ref-based duplicate guards
 * - CardHand drag-to-play/pass wrappers
 * - handleLeaveGame with confirmation dialog
 * - play/pass success callbacks (clear selection)
 */

import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import type { StackNavigationProp } from '@react-navigation/stack';

import { i18n } from '../i18n';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { soundManager, hapticManager, SoundType, showError, showConfirm } from '../utils';
import { sortCardsForDisplay } from '../utils/cardSorting';
import { gameLogger } from '../utils/logger';
import {
  trackGameplayAction,
  trackGameEvent,
  checkHintFollowed,
  turnTimeEnd,
} from '../services/analytics';
import { sentryCapture } from '../services/sentry';
import type { Card } from '../game/types';
import { classifyCards, canBeatPlay } from '../game';
import type { LastPlay } from '../game';

interface GameManagerLike {
  playCards: (cardIds: string[]) => Promise<{ success: boolean; error?: string }>;
  pass: () => Promise<{ success: boolean; error?: string }>;
}

interface MultiplayerValidationState {
  lastPlay: LastPlay | null;
  isFirstPlayOfGame: boolean;
  playerHand: Card[];
}

interface UseGameActionsOptions {
  isLocalAIGame: boolean;
  gameManagerRef: React.RefObject<GameManagerLike | null>;
  multiplayerPlayCards: ((cards: Card[]) => Promise<void>) | null;
  multiplayerPass: (() => Promise<void>) | null;
  setSelectedCardIds: (ids: Set<string>) => void;
  navigation: StackNavigationProp<RootStackParamList, 'Game'>;
  isMountedRef: React.RefObject<boolean>;
  /** Optional: returns current game state for client-side pre-validation (Task #573) */
  getMultiplayerValidationState?: () => MultiplayerValidationState | null;
  /**
   * Orientation-aware alert callback (iOS only — replaces native Alert.alert for
   * in-game error popups). On iOS, routes through InGameAlert which respects the
   * game's orientation lock. On Android, callers fall through to showError/Toast.
   * When provided, pass { title, message } to match showError title parity.
   */
  onAlert?: (options: { title?: string; message: string }) => void;
}

export function useGameActions({
  isLocalAIGame,
  gameManagerRef,
  multiplayerPlayCards,
  multiplayerPass,
  setSelectedCardIds,
  navigation,
  isMountedRef,
  getMultiplayerValidationState,
  onAlert,
}: UseGameActionsOptions) {
  // Task #568: Separate refs to prevent cross-operation blocking
  const isPlayingCardsRef = useRef(false);
  const isPassingRef = useRef(false);

  // Platform-aware error display: InGameAlert modal on iOS (orientation-safe),
  // Toast/system-Alert via showError on Android.
  const alertError = useCallback(
    (message: string) => {
      if (Platform.OS === 'ios' && onAlert) {
        onAlert({ title: i18n.t('common.error'), message });
      } else {
        showError(message);
      }
    },
    [onAlert]
  );

  const handlePlayCards = useCallback(
    async (cards: Card[]) => {
      if (isPlayingCardsRef.current) {
        gameLogger.warn(
          '⚠️ [GameScreen] Card play already in progress, ignoring duplicate request'
        );
        return;
      }

      if (isLocalAIGame) {
        if (!gameManagerRef.current) {
          gameLogger.error('❌ [GameScreen] Game not initialized');
          return;
        }

        try {
          isPlayingCardsRef.current = true;
          hapticManager.playCard();

          const sortedCards = sortCardsForDisplay(cards);
          const cardIds = sortedCards.map(card => card.id);

          const result = await gameManagerRef.current.playCards(cardIds);

          if (!result.success) {
            gameLogger.warn(`❌ [GameScreen] Invalid play: ${result.error}`);
            soundManager.playSound(SoundType.INVALID_MOVE);
            const msg = result.error || 'Invalid play';
            alertError(msg);
            return;
          }

          setSelectedCardIds(new Set());
          soundManager.playSound(SoundType.CARD_PLAY);
          trackGameplayAction('card_play', {
            mode: 'local_ai',
            card_count: cards.length,
            play_method: 'button',
          });
          turnTimeEnd('play');
          checkHintFollowed(cards.map(c => c.id));
          sentryCapture.breadcrumb('Card play (local AI)', { card_count: cards.length }, 'game');
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          gameLogger.error('❌ [GameScreen] Error playing cards:', msg);
          soundManager.playSound(SoundType.INVALID_MOVE);
          trackGameplayAction('play_error', {
            mode: 'local_ai',
            error: (msg || 'unknown').slice(0, 100),
          });
          trackGameplayAction('play_validation_error', {
            mode: 'local_ai',
            error_type: (msg || 'unknown').slice(0, 100),
          });
          const errMsg = msg || 'Failed to play cards';
          alertError(errMsg);
        } finally {
          isPlayingCardsRef.current = false;
        }
      } else {
        if (!multiplayerPlayCards) {
          gameLogger.error('❌ [GameScreen] Multiplayer not initialized');
          return;
        }

        try {
          isPlayingCardsRef.current = true;
          hapticManager.playCard();

          const sortedCards = sortCardsForDisplay(cards);

          // Task #573: Client-side validation — catch common errors before server round-trip
          if (getMultiplayerValidationState) {
            const validationState = getMultiplayerValidationState();
            if (validationState) {
              const { lastPlay, isFirstPlayOfGame, playerHand } = validationState;

              // 1. Verify all selected cards are actually in the player's hand
              const handCardIds = new Set(playerHand.map(c => c.id));
              const missingCard = sortedCards.find(c => !handCardIds.has(c.id));
              if (missingCard) {
                soundManager.playSound(SoundType.INVALID_MOVE);
                const m = i18n.t('game.cardNotInHand');
                alertError(m);
                trackGameplayAction('play_validation_error', {
                  mode: 'multiplayer',
                  error_type: 'card_not_in_hand',
                });
                isPlayingCardsRef.current = false;
                return;
              }

              // 2. Verify the combination itself is valid
              const combo = classifyCards(sortedCards);
              if (combo === 'unknown') {
                soundManager.playSound(SoundType.INVALID_MOVE);
                const m = i18n.t('game.invalidCombo');
                alertError(m);
                trackGameplayAction('play_validation_error', {
                  mode: 'multiplayer',
                  error_type: 'invalid_combo',
                });
                isPlayingCardsRef.current = false;
                return;
              }

              // 3. First play of game must include the 3 of Diamonds.
              // Use rank+suit check instead of id string comparison since the server
              // stores cards in suit-first format ('D3') while local state uses
              // rank-first format ('3D'). Checking rank/suit fields works for both.
              if (isFirstPlayOfGame && !sortedCards.some(c => c.rank === '3' && c.suit === 'D')) {
                soundManager.playSound(SoundType.INVALID_MOVE);
                const m = i18n.t('game.firstPlayMustInclude3D');
                alertError(m);
                trackGameplayAction('play_validation_error', {
                  mode: 'multiplayer',
                  error_type: 'must_play_3d_first',
                });
                isPlayingCardsRef.current = false;
                return;
              }

              // 4. Must beat the current last play (if one exists)
              if (lastPlay && !canBeatPlay(sortedCards, lastPlay)) {
                soundManager.playSound(SoundType.INVALID_MOVE);
                const m = i18n.t('game.cannotBeat');
                alertError(m);
                trackGameplayAction('play_validation_error', {
                  mode: 'multiplayer',
                  error_type: 'cannot_beat_combo',
                });
                isPlayingCardsRef.current = false;
                return;
              }

              gameLogger.info('✅ [GameActions] Client-side validation passed', {
                combo,
                cardCount: sortedCards.length,
                isFirstPlay: isFirstPlayOfGame,
                hasLastPlay: !!lastPlay,
              });
            }
          }
          await multiplayerPlayCards(sortedCards as Card[]);
          setSelectedCardIds(new Set());
          soundManager.playSound(SoundType.CARD_PLAY);
          trackGameplayAction('card_play', {
            mode: 'multiplayer',
            card_count: sortedCards.length,
            play_method: 'button',
          });
          turnTimeEnd('play');
          checkHintFollowed(sortedCards.map(c => c.id));
          sentryCapture.breadcrumb(
            'Card play (multiplayer)',
            { card_count: sortedCards.length },
            'game'
          );
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          gameLogger.error('❌ [GameScreen] Error playing cards:', msg);
          trackGameplayAction('play_error', {
            mode: 'multiplayer',
            error: (msg || 'unknown').slice(0, 100),
          });
          throw error; // Re-throw so GameControls can handle
        } finally {
          isPlayingCardsRef.current = false;
        }
      }
    },
    [
      isLocalAIGame,
      gameManagerRef,
      multiplayerPlayCards,
      setSelectedCardIds,
      getMultiplayerValidationState,
      alertError,
    ]
  );

  const handlePass = useCallback(async () => {
    if (isPassingRef.current) {
      gameLogger.warn(
        '⚠️ [GameScreen] Pass action already in progress, ignoring duplicate request'
      );
      return;
    }

    if (isLocalAIGame) {
      if (!gameManagerRef.current) {
        gameLogger.error('❌ [GameScreen] Game not initialized');
        return;
      }

      try {
        isPassingRef.current = true;
        hapticManager.pass();

        const result = await gameManagerRef.current.pass();

        if (!result.success) {
          gameLogger.warn(`❌ [GameScreen] Cannot pass: ${result.error}`);
          soundManager.playSound(SoundType.INVALID_MOVE);
          const m = result.error || 'Cannot pass';
          alertError(m);
          return;
        }

        setSelectedCardIds(new Set());
        soundManager.playSound(SoundType.PASS);
        trackGameplayAction('card_pass', { mode: 'local_ai' });
        turnTimeEnd('pass');
        sentryCapture.breadcrumb('Pass (local AI)', undefined, 'game');
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        gameLogger.error('❌ [GameScreen] Error passing:', msg);
        soundManager.playSound(SoundType.INVALID_MOVE);
        const failMsg = msg || 'Failed to pass';
        alertError(failMsg);
      } finally {
        isPassingRef.current = false;
      }
    } else {
      if (!multiplayerPass) {
        gameLogger.error('❌ [GameScreen] Multiplayer not initialized');
        return;
      }

      try {
        isPassingRef.current = true;

        // Client-side pre-validation: cannot pass when leading (no last play on board)
        if (getMultiplayerValidationState) {
          const validationState = getMultiplayerValidationState();
          if (validationState && !validationState.lastPlay) {
            soundManager.playSound(SoundType.INVALID_MOVE);
            const m = i18n.t('game.cannotPassMessage');
            alertError(m);
            trackGameplayAction('play_validation_error', {
              mode: 'multiplayer',
              error_type: 'cannot_pass_when_leading',
            });
            return;
          }
        }

        hapticManager.pass();

        await multiplayerPass();
        setSelectedCardIds(new Set());
        soundManager.playSound(SoundType.PASS);
        trackGameplayAction('card_pass', { mode: 'multiplayer' });
        turnTimeEnd('pass');
        sentryCapture.breadcrumb('Pass (multiplayer)', undefined, 'game');
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes('Not your turn')) {
          gameLogger.warn(
            '⚠️ [GameScreen] Suppressed "Not your turn" pass error (likely auto-pass race)'
          );
        } else {
          gameLogger.error('❌ [GameScreen] Error passing (multiplayer):', msg);
          const failMsg = msg || 'Failed to pass';
          alertError(failMsg);
        }
      } finally {
        isPassingRef.current = false;
      }
    }
  }, [
    isLocalAIGame,
    gameManagerRef,
    multiplayerPass,
    setSelectedCardIds,
    getMultiplayerValidationState,
    alertError,
  ]);

  // Refs to access play/pass handlers for drag-to-play from CardHand
  const onPlayCardsRef = useRef<((cards: Card[]) => Promise<void>) | null>(null);
  const onPassRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    onPlayCardsRef.current = handlePlayCards;
    onPassRef.current = handlePass;
  }, [handlePlayCards, handlePass]);

  const handlePlaySuccess = () => {
    if (isMountedRef.current) {
      setSelectedCardIds(new Set());
    }
  };

  const handlePassSuccess = () => {
    if (isMountedRef.current) {
      setSelectedCardIds(new Set());
    }
  };

  const handleCardHandPlayCards = (cards: Card[]) => {
    trackGameplayAction('play_method_used', { method: 'drag' });
    if (onPlayCardsRef.current) {
      onPlayCardsRef.current(cards);
    }
  };

  const handleCardHandPass = () => {
    if (onPassRef.current) {
      onPassRef.current();
    }
  };

  const handleLeaveGame = (skipConfirmation = false) => {
    if (skipConfirmation) {
      navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
      return;
    }

    showConfirm({
      title: i18n.t('game.leaveGameConfirm'),
      message: i18n.t('game.leaveGameMessage'),
      confirmText: i18n.t('game.leaveGame'),
      cancelText: i18n.t('game.stay'),
      destructive: true,
      onConfirm: () => {
        trackGameEvent('game_abandoned', { source: 'leave_button' });
        trackGameEvent('game_not_completed', { reason: 'player_left' });
        sentryCapture.breadcrumb('Game abandoned', { source: 'leave_button' }, 'game');
        navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
      },
    });
  };

  return {
    handlePlayCards,
    handlePass,
    handlePlaySuccess,
    handlePassSuccess,
    handleCardHandPlayCards,
    handleCardHandPass,
    handleLeaveGame,
  };
}
