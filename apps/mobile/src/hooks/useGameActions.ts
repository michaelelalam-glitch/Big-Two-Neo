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
}

export function useGameActions({
  isLocalAIGame,
  gameManagerRef,
  multiplayerPlayCards,
  multiplayerPass,
  setSelectedCardIds,
  navigation,
  isMountedRef,
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
  }, [isLocalAIGame, gameManagerRef, multiplayerPlayCards, setSelectedCardIds]);

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
