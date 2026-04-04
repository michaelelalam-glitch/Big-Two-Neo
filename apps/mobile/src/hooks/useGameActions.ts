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
import { isExpectedTurnRaceError } from '../utils/edgeFunctionErrors';
import {
  trackGameplayAction,
  trackGameEvent,
  trackError,
  checkHintFollowed,
  turnTimeEnd,
} from '../services/analytics';
import { sentryCapture } from '../services/sentry';
import type { Card } from '../game/types';
import { classifyCards, canBeatPlay } from '../game';
import type { LastPlay } from '../game';
import { validateOneCardLeftRule } from '../game/engine/game-logic';

interface GameManagerLike {
  playCards: (cardIds: string[]) => Promise<{ success: boolean; error?: string }>;
  pass: () => Promise<{ success: boolean; error?: string }>;
}

interface MultiplayerValidationState {
  lastPlay: LastPlay | null;
  isFirstPlayOfGame: boolean;
  playerHand: Card[];
  /** Number of cards held by the next active player — used for OCL pre-validation (Task #660). */
  nextPlayerCardCount?: number;
}

/** Differentiates game modes for analytics events. */
export type GameMode = 'offline' | 'online_ranked' | 'online_casual' | 'online_private';

interface UseGameActionsOptions {
  isLocalAIGame: boolean;
  gameManagerRef: React.RefObject<GameManagerLike | null>;
  multiplayerPlayCards: ((cards: Card[]) => Promise<void>) | null;
  multiplayerPass: (() => Promise<void>) | null;
  setSelectedCardIds: (ids: Set<string>) => void;
  navigation: StackNavigationProp<RootStackParamList, 'Game'>;
  isMountedRef: React.RefObject<boolean>;
  /** Optional: returns current game state for client-side pre-validation (Task #573 multiplayer) */
  getMultiplayerValidationState?: () => MultiplayerValidationState | null;
  /** Optional: returns current game state for client-side pre-validation in offline/local AI mode (Task #660). */
  getOfflineValidationState?: () => MultiplayerValidationState | null;
  /**
   * Orientation-aware alert callback (iOS only — replaces native Alert.alert for
   * in-game error popups). On iOS, routes through InGameAlert which respects the
   * game's orientation lock. On Android, callers fall through to showError/Toast.
   * When provided, pass { title, message } to match showError title parity.
   */
  onAlert?: (options: { title?: string; message: string }) => void;
  /**
   * Game mode for analytics differentiation.
   * 'offline' for local AI games; 'online_ranked'|'online_casual'|'online_private' for multiplayer.
   * If omitted, local AI games default to 'offline' and multiplayer games default to 'online_casual'.
   */
  gameMode?: GameMode;
  /** Number of human players in the room (for game_not_completed analytics). */
  humanCount?: number;
  /** Number of bot players in the room (for game_not_completed analytics). */
  botCount?: number;
  /** Bot difficulty selected for the room (for game_not_completed analytics). */
  botDifficultyLevel?: string;
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
  getOfflineValidationState,
  onAlert,
  gameMode,
  humanCount,
  botCount,
  botDifficultyLevel,
}: UseGameActionsOptions) {
  const resolvedGameMode: GameMode = gameMode ?? (isLocalAIGame ? 'offline' : 'online_casual');
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

          // Task #660: Client-side pre-validation for offline mode — mirrors multiplayer
          // validation to catch errors before calling the game manager, giving faster
          // feedback and consistent validation behaviour across both modes.
          if (getOfflineValidationState) {
            const vState = getOfflineValidationState();
            if (vState) {
              const { lastPlay, isFirstPlayOfGame, playerHand, nextPlayerCardCount } = vState;

              // 1. All selected cards must be in the player's hand
              const handCardIds = new Set(playerHand.map(c => c.id));
              const missingCard = sortedCards.find(c => !handCardIds.has(c.id));
              if (missingCard) {
                soundManager.playSound(SoundType.INVALID_MOVE);
                alertError(i18n.t('game.cardNotInHand'));
                trackGameplayAction('play_validation_error', {
                  mode: 'local_ai',
                  error_type: 'card_not_in_hand',
                });
                isPlayingCardsRef.current = false;
                return;
              }

              // 2. Combination must be valid
              const combo = classifyCards(sortedCards);
              if (combo === 'unknown') {
                soundManager.playSound(SoundType.INVALID_MOVE);
                alertError(i18n.t('game.invalidCombo'));
                trackGameplayAction('play_validation_error', {
                  mode: 'local_ai',
                  error_type: 'invalid_combo',
                });
                isPlayingCardsRef.current = false;
                return;
              }

              // 3. First play of game must include the 3 of Diamonds
              if (isFirstPlayOfGame && !sortedCards.some(c => c.rank === '3' && c.suit === 'D')) {
                soundManager.playSound(SoundType.INVALID_MOVE);
                alertError(i18n.t('game.firstPlayMustInclude3D'));
                trackGameplayAction('play_validation_error', {
                  mode: 'local_ai',
                  error_type: 'must_play_3d_first',
                });
                isPlayingCardsRef.current = false;
                return;
              }

              // 4. Must beat the current last play (if one exists)
              if (lastPlay && !canBeatPlay(sortedCards, lastPlay)) {
                soundManager.playSound(SoundType.INVALID_MOVE);
                alertError(i18n.t('game.cannotBeat'));
                trackGameplayAction('play_validation_error', {
                  mode: 'local_ai',
                  error_type: 'cannot_beat_combo',
                });
                isPlayingCardsRef.current = false;
                return;
              }

              // 5. One Card Left rule: when playing a single, must play highest single
              if (nextPlayerCardCount !== undefined) {
                const oclValidation = validateOneCardLeftRule(
                  sortedCards,
                  playerHand,
                  nextPlayerCardCount,
                  lastPlay
                );
                if (!oclValidation.valid) {
                  soundManager.playSound(SoundType.INVALID_MOVE);
                  alertError(i18n.t('game.oneCardLeftMustPlayHighestSingle'));
                  trackGameplayAction('play_validation_error', {
                    mode: 'local_ai',
                    error_type: 'one_card_left_rule',
                  });
                  isPlayingCardsRef.current = false;
                  return;
                }
              }
            }
          }

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
            play_method: playMethodRef.current,
          });
          playMethodRef.current = 'button';
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
          playMethodRef.current = 'button';
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
              const { lastPlay, isFirstPlayOfGame, playerHand, nextPlayerCardCount } =
                validationState;

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

              // 5. One Card Left rule — only applies to singles (Task #660)
              if (nextPlayerCardCount !== undefined) {
                const oclValidation = validateOneCardLeftRule(
                  sortedCards,
                  playerHand,
                  nextPlayerCardCount,
                  lastPlay
                );
                if (!oclValidation.valid) {
                  soundManager.playSound(SoundType.INVALID_MOVE);
                  alertError(i18n.t('game.oneCardLeftMustPlayHighestSingle'));
                  trackGameplayAction('play_validation_error', {
                    mode: 'multiplayer',
                    error_type: 'one_card_left_rule',
                  });
                  isPlayingCardsRef.current = false;
                  return;
                }
              }
            }
          }
          await multiplayerPlayCards(sortedCards as Card[]);
          setSelectedCardIds(new Set());
          soundManager.playSound(SoundType.CARD_PLAY);
          trackGameplayAction('card_play', {
            mode: 'multiplayer',
            card_count: sortedCards.length,
            play_method: playMethodRef.current,
          });
          playMethodRef.current = 'button';
          turnTimeEnd('play');
          checkHintFollowed(sortedCards.map(c => c.id));
          sentryCapture.breadcrumb(
            'Card play (multiplayer)',
            { card_count: sortedCards.length },
            'game'
          );
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          // Expected race conditions are warnings, not errors
          const isExpectedRace = isExpectedTurnRaceError(msg);
          const logFn = isExpectedRace
            ? gameLogger.warn.bind(gameLogger)
            : gameLogger.error.bind(gameLogger);
          logFn('❌ [GameScreen] Error playing cards:', msg);
          trackGameplayAction('play_error', {
            mode: 'multiplayer',
            error: (msg || 'unknown').slice(0, 100),
          });
          // Expected race conditions (e.g. 'not your turn', 'player not found') occur when
          // invokeWithRetry fires a retry after a transient FunctionsFetchError but the
          // bot/other player took the turn during the backoff window. Realtime syncs state
          // automatically. Suppressed from UI — GameControls swallows these in its own catch.
          // Must RE-THROW so GameControls does NOT execute post-await success side effects
          // (play sound, clear card order, onPlaySuccess).
          if (isExpectedRace) {
            sentryCapture.breadcrumb(
              `Play rejected (retry race): ${msg}`,
              { context: 'MultiplayerPlayCards' },
              'game'
            );
            throw error; // Re-throw — GameControls suppresses popup for this string
          } else if (
            msg.includes('Must play highest') ||
            msg.includes('Must beat') ||
            msg.includes('Invalid play') ||
            msg.includes('Play rejected:')
          ) {
            sentryCapture.message(`Play rejected: ${msg}`, {
              context: 'MultiplayerPlayCards',
              level: 'warning',
            });
          } else {
            sentryCapture.exception(error instanceof Error ? error : new Error(msg), {
              context: 'MultiplayerPlayCards',
            });
            trackError('play_cards', msg);
          }
          throw error; // Re-throw so GameControls can handle
        } finally {
          playMethodRef.current = 'button';
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
      getOfflineValidationState,
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
        if (isExpectedTurnRaceError(msg)) {
          gameLogger.warn('⚠️ [GameScreen] Expected-race pass error (likely auto-pass race):', msg);
          // Re-throw so callers (GameControls) skip success side effects
          // (pass sound, onPassSuccess). GameControls will suppress the popup.
          throw error instanceof Error ? error : new Error(msg);
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

  // Ref to track play method (button vs drag) — set before calling handlePlayCards
  const playMethodRef = useRef<'button' | 'drag'>('button');

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
    playMethodRef.current = 'drag';
    if (onPlayCardsRef.current) {
      void onPlayCardsRef.current(cards).catch((err: unknown) => {
        gameLogger.error('❌ [GameActions] Drag-to-play error:', err);
      });
    }
  };

  const handleCardHandPass = () => {
    if (onPassRef.current) {
      onPassRef.current();
    }
  };

  const handleLeaveGame = (skipConfirmation = false) => {
    if (skipConfirmation) {
      // Game is already over (e.g., game_over phase) — no confirm dialog needed.
      // Still fire analytics so every exit path is counted.
      trackGameEvent('game_abandoned', {
        source: 'skip_confirmation',
        game_mode: resolvedGameMode,
      });
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
        trackGameEvent('game_abandoned', { source: 'leave_button', game_mode: resolvedGameMode });
        trackGameEvent('game_not_completed', {
          reason: 'player_left',
          game_mode: resolvedGameMode,
          ...(humanCount !== undefined && { human_count: humanCount }),
          ...(botCount !== undefined && { bot_count: botCount }),
          ...(botDifficultyLevel !== undefined && { bot_difficulty: botDifficultyLevel }),
        });
        sentryCapture.breadcrumb(
          'Game abandoned',
          { source: 'leave_button', game_mode: resolvedGameMode },
          'game'
        );
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
