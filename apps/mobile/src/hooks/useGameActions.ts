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
import type { StackNavigationProp } from '@react-navigation/stack';

import { i18n } from '../i18n';
import type { RootStackParamList } from '../navigation/AppNavigator';
import {
  soundManager,
  hapticManager,
  SoundType,
  showError,
  showConfirm,
} from '../utils';
import { sortCardsForDisplay } from '../utils/cardSorting';
import { gameLogger } from '../utils/logger';
import type { Card } from '../game/types';
import { classifyCards, canBeatPlay } from '../game/engine/game-logic';
import type { LastPlay } from '../types/multiplayer';

interface GameManagerLike {
  playCards: (cardIds: string[]) => Promise<{ success: boolean; error?: string }>;
  pass: () => Promise<{ success: boolean; error?: string }>;
}

interface UseGameActionsOptions {
  isLocalAIGame: boolean;
  gameManagerRef: React.RefObject<GameManagerLike | null>;
  multiplayerPlayCards: ((cards: Card[]) => Promise<void>) | null;
  multiplayerPass: (() => Promise<void>) | null;
  setSelectedCardIds: (ids: Set<string>) => void;
  navigation: StackNavigationProp<RootStackParamList, 'Game'>;
  isMountedRef: React.RefObject<boolean>;
  /**
   * Task #573: Client-side validation context for multiplayer.
   * Returns current game state needed to validate card plays before
   * sending to the server — eliminates unnecessary server round-trips.
   */
  getMultiplayerValidationState?: () => {
    lastPlay: LastPlay | null;
    isFirstPlayOfGame: boolean;
    playerHand: Card[];
  } | null;
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
}: UseGameActionsOptions) {
  // Task #568: Separate refs to prevent cross-operation blocking
  const isPlayingCardsRef = useRef(false);
  const isPassingRef = useRef(false);

  const handlePlayCards = useCallback(async (cards: Card[]) => {
    if (isPlayingCardsRef.current) {
      gameLogger.warn('⚠️ [GameScreen] Card play already in progress, ignoring duplicate request');
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
          showError(result.error || 'Invalid play');
          return;
        }

        setSelectedCardIds(new Set());
        soundManager.playSound(SoundType.CARD_PLAY);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        gameLogger.error('❌ [GameScreen] Error playing cards:', msg);
        soundManager.playSound(SoundType.INVALID_MOVE);
        showError(msg || 'Failed to play cards');
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
              showError(i18n.t('game.cardNotInHand'));
              isPlayingCardsRef.current = false;
              return;
            }

            // 2. Verify the combination itself is valid
            const combo = classifyCards(sortedCards);
            if (combo === 'unknown') {
              soundManager.playSound(SoundType.INVALID_MOVE);
              showError(i18n.t('game.invalidCombo'));
              isPlayingCardsRef.current = false;
              return;
            }

            // 3. First play of game must include the 3 of Diamonds
            if (isFirstPlayOfGame && !sortedCards.some(c => c.id === '3D')) {
              soundManager.playSound(SoundType.INVALID_MOVE);
              showError(i18n.t('game.firstPlayMustInclude3D'));
              isPlayingCardsRef.current = false;
              return;
            }

            // 4. Must beat the current last play (if one exists)
            if (lastPlay && !canBeatPlay(sortedCards, lastPlay)) {
              soundManager.playSound(SoundType.INVALID_MOVE);
              showError(i18n.t('game.cannotBeat'));
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
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        gameLogger.error('❌ [GameScreen] Error playing cards:', msg);
        throw error; // Re-throw so GameControls can handle
      } finally {
        isPlayingCardsRef.current = false;
      }
    }
  }, [isLocalAIGame, gameManagerRef, multiplayerPlayCards, setSelectedCardIds, getMultiplayerValidationState]);

  const handlePass = useCallback(async () => {
    if (isPassingRef.current) {
      gameLogger.warn('⚠️ [GameScreen] Pass action already in progress, ignoring duplicate request');
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
          showError(result.error || 'Cannot pass');
          return;
        }

        setSelectedCardIds(new Set());
        soundManager.playSound(SoundType.PASS);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        gameLogger.error('❌ [GameScreen] Error passing:', msg);
        soundManager.playSound(SoundType.INVALID_MOVE);
        showError(msg || 'Failed to pass');
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
        hapticManager.pass();

        await multiplayerPass();
        setSelectedCardIds(new Set());
        soundManager.playSound(SoundType.PASS);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes('Not your turn')) {
          gameLogger.warn('⚠️ [GameScreen] Suppressed "Not your turn" pass error (likely auto-pass race)');
        } else {
          gameLogger.error('❌ [GameScreen] Error passing (multiplayer):', msg);
          showError(msg || 'Failed to pass');
        }
      } finally {
        isPassingRef.current = false;
      }
    }
  }, [isLocalAIGame, gameManagerRef, multiplayerPass, setSelectedCardIds]);

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
