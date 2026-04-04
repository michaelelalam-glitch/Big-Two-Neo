/**
 * @file useGameActions-validation.test.ts
 * @description Unit tests for Task #573: client-side card play validation.
 *
 * Covers the four pre-flight checks that run before the server round-trip:
 *  1. Card not in hand
 *  2. Invalid combination (classifyCards returns 'unknown')
 *  3. First play must include 3♦
 *  4. Must beat the current last play
 *
 * For each invalid case we verify:
 *  - `multiplayerPlayCards` is NOT called (server trip avoided)
 *  - `showError` IS called with the appropriate i18n message
 *  - `soundManager.playSound(INVALID_MOVE)` IS called
 *
 * Valid plays pass all checks and reach `multiplayerPlayCards`.
 */

// ---- Mocks (must precede all imports) ------------------------------------

jest.mock('../../i18n', () => ({
  i18n: {
    t: (key: string) => key, // Return key itself for easy assertion
  },
}));

jest.mock('../../utils', () => ({
  soundManager: {
    playSound: jest.fn(),
  },
  hapticManager: {
    playCard: jest.fn(),
    pass: jest.fn(),
  },
  SoundType: {
    INVALID_MOVE: 'INVALID_MOVE',
    CARD_PLAY: 'CARD_PLAY',
    PASS: 'PASS',
  },
  showError: jest.fn(),
  showConfirm: jest.fn(),
}));

jest.mock('../../utils/cardSorting', () => ({
  // Return cards as-is to keep test data predictable
  sortCardsForDisplay: (cards: unknown[]) => cards,
}));

jest.mock('../../utils/logger', () => ({
  gameLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  networkLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../../game/engine/game-logic', () => ({
  classifyCards: jest.fn(),
  canBeatPlay: jest.fn(),
  validateOneCardLeftRule: jest.fn(),
}));

// ---- Imports -------------------------------------------------------------

import { renderHook, act } from '@testing-library/react-native';
import { useGameActions } from '../useGameActions';
import { soundManager, SoundType, showError } from '../../utils';
import { classifyCards, canBeatPlay, validateOneCardLeftRule } from '../../game/engine/game-logic';
import type { Card } from '../../game/types';
import type { LastPlay } from '../../types/multiplayer';

// ---- Helpers -------------------------------------------------------------

const makeCard = (id: string): Card => {
  const rank = id.slice(0, -1) as Card['rank'];
  const suit = id.slice(-1) as Card['suit'];
  return { id, rank, suit };
};

type ValidationState = {
  lastPlay: LastPlay | null;
  isFirstPlayOfGame: boolean;
  playerHand: Card[];
  nextPlayerCardCount?: number;
};

/** Build a navigation mock (unused methods default to jest.fn()) */
const makeNavigation = () => ({
  navigate: jest.fn(),
  goBack: jest.fn(),
  dispatch: jest.fn(),
  reset: jest.fn(),
  setParams: jest.fn(),
  setOptions: jest.fn(),
  isFocused: jest.fn().mockReturnValue(true),
  canGoBack: jest.fn().mockReturnValue(true),
  addListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
  removeListener: jest.fn(),
  getParent: jest.fn(),
  getId: jest.fn(),
  getState: jest.fn(),
});

// ---- Tests ---------------------------------------------------------------

describe('useGameActions — client-side card validation (Task #573)', () => {
  let multiplayerPlayCards: jest.Mock;
  let multiplayerPass: jest.Mock;
  let setSelectedCardIds: jest.Mock;
  let isMountedRef: React.RefObject<boolean>;
  let navigation: ReturnType<typeof makeNavigation>;

  beforeEach(() => {
    jest.clearAllMocks();
    multiplayerPlayCards = jest.fn().mockResolvedValue(undefined);
    multiplayerPass = jest.fn().mockResolvedValue(undefined);
    setSelectedCardIds = jest.fn();
    isMountedRef = { current: true };
    navigation = makeNavigation();

    // Default: classifyCards returns a valid type, canBeatPlay returns true, OCL passes
    (classifyCards as jest.Mock).mockReturnValue('Single');
    (canBeatPlay as jest.Mock).mockReturnValue(true);
    (validateOneCardLeftRule as jest.Mock).mockReturnValue({ valid: true });
  });

  /**
   * Helper: render the hook and call handlePlayCards with the given cards/state.
   */
  const renderAndPlay = async (cards: Card[], validationState: ValidationState | null) => {
    const getMultiplayerValidationState = jest.fn().mockReturnValue(validationState);

    const { result } = renderHook(() =>
      useGameActions({
        isLocalAIGame: false,
        gameManagerRef: { current: null },
        multiplayerPlayCards,
        multiplayerPass,
        setSelectedCardIds,
        navigation: navigation as any,
        isMountedRef,
        getMultiplayerValidationState,
      })
    );

    await act(async () => {
      await result.current.handlePlayCards(cards);
    });

    return { getMultiplayerValidationState };
  };

  // ---- Validation state is absent ----------------------------------------

  it('calls multiplayerPlayCards when getMultiplayerValidationState is not provided', async () => {
    const { result } = renderHook(() =>
      useGameActions({
        isLocalAIGame: false,
        gameManagerRef: { current: null },
        multiplayerPlayCards,
        multiplayerPass,
        setSelectedCardIds,
        navigation: navigation as any,
        isMountedRef,
        // No getMultiplayerValidationState
      })
    );

    const cards = [makeCard('3D')];
    await act(async () => {
      await result.current.handlePlayCards(cards);
    });

    expect(multiplayerPlayCards).toHaveBeenCalledTimes(1);
    expect(showError).not.toHaveBeenCalled();
  });

  it('calls multiplayerPlayCards when getMultiplayerValidationState returns null', async () => {
    await renderAndPlay([makeCard('3D')], null);
    expect(multiplayerPlayCards).toHaveBeenCalledTimes(1);
    expect(showError).not.toHaveBeenCalled();
  });

  // ---- Check 1: Card not in hand -----------------------------------------

  describe('Check 1 — card not in player hand', () => {
    it('rejects when a selected card is missing from the hand', async () => {
      const handCards = [makeCard('3D'), makeCard('4H')];
      const selectedCards = [makeCard('5S')]; // Not in hand

      await renderAndPlay(selectedCards, {
        lastPlay: null,
        isFirstPlayOfGame: false,
        playerHand: handCards,
      });

      expect(multiplayerPlayCards).not.toHaveBeenCalled();
      expect(showError).toHaveBeenCalledWith('game.cardNotInHand');
      expect(soundManager.playSound).toHaveBeenCalledWith(SoundType.INVALID_MOVE);
    });

    it('allows play when all cards are in the hand', async () => {
      const card = makeCard('3D');

      await renderAndPlay([card], {
        lastPlay: null,
        isFirstPlayOfGame: false,
        playerHand: [card],
      });

      expect(multiplayerPlayCards).toHaveBeenCalledTimes(1);
      expect(showError).not.toHaveBeenCalled();
    });
  });

  // ---- Check 2: Invalid combination --------------------------------------

  describe('Check 2 — invalid card combination', () => {
    it('rejects when classifyCards returns "unknown"', async () => {
      (classifyCards as jest.Mock).mockReturnValue('unknown');

      const card = makeCard('3D');
      await renderAndPlay([card], {
        lastPlay: null,
        isFirstPlayOfGame: false,
        playerHand: [card],
      });

      expect(multiplayerPlayCards).not.toHaveBeenCalled();
      expect(showError).toHaveBeenCalledWith('game.invalidCombo');
      expect(soundManager.playSound).toHaveBeenCalledWith(SoundType.INVALID_MOVE);
    });

    it('proceeds when classifyCards returns a valid type', async () => {
      (classifyCards as jest.Mock).mockReturnValue('Pair');

      const cards = [makeCard('3D'), makeCard('3H')];
      await renderAndPlay(cards, {
        lastPlay: null,
        isFirstPlayOfGame: false,
        playerHand: cards,
      });

      expect(multiplayerPlayCards).toHaveBeenCalledTimes(1);
    });
  });

  // ---- Check 3: First play must include 3♦ --------------------------------

  describe('Check 3 — first play must include 3♦', () => {
    it('rejects first play without the 3 of Diamonds', async () => {
      const card = makeCard('4H');
      await renderAndPlay([card], {
        lastPlay: null,
        isFirstPlayOfGame: true,
        playerHand: [card],
      });

      expect(multiplayerPlayCards).not.toHaveBeenCalled();
      expect(showError).toHaveBeenCalledWith('game.firstPlayMustInclude3D');
      expect(soundManager.playSound).toHaveBeenCalledWith(SoundType.INVALID_MOVE);
    });

    it('allows first play that includes 3D as a single', async () => {
      const card = makeCard('3D');
      await renderAndPlay([card], {
        lastPlay: null,
        isFirstPlayOfGame: true,
        playerHand: [card],
      });

      expect(multiplayerPlayCards).toHaveBeenCalledTimes(1);
      expect(showError).not.toHaveBeenCalled();
    });

    it('allows first play that includes 3D in a pair', async () => {
      const cards = [makeCard('3D'), makeCard('3H')];
      (classifyCards as jest.Mock).mockReturnValue('Pair');

      await renderAndPlay(cards, {
        lastPlay: null,
        isFirstPlayOfGame: true,
        playerHand: cards,
      });

      expect(multiplayerPlayCards).toHaveBeenCalledTimes(1);
    });

    it('does NOT apply the 3D rule when it is not the first play of the game', async () => {
      const card = makeCard('5H');
      await renderAndPlay([card], {
        lastPlay: null,
        isFirstPlayOfGame: false,
        playerHand: [card],
      });

      // No 3D, but isFirstPlayOfGame=false → should proceed
      expect(multiplayerPlayCards).toHaveBeenCalledTimes(1);
      expect(showError).not.toHaveBeenCalled();
    });
  });

  // ---- Check 4: Must beat last play --------------------------------------

  describe('Check 4 — must beat current last play', () => {
    const mockLastPlay: LastPlay = {
      player_index: 1,
      cards: [makeCard('5H')],
      combo_type: 'Single',
      timestamp: new Date().toISOString(),
    };

    it('rejects when the play cannot beat the last play', async () => {
      (canBeatPlay as jest.Mock).mockReturnValue(false);

      const card = makeCard('3D');
      await renderAndPlay([card], {
        lastPlay: mockLastPlay,
        isFirstPlayOfGame: false,
        playerHand: [card],
      });

      expect(multiplayerPlayCards).not.toHaveBeenCalled();
      expect(showError).toHaveBeenCalledWith('game.cannotBeat');
      expect(soundManager.playSound).toHaveBeenCalledWith(SoundType.INVALID_MOVE);
    });

    it('allows the play when it can beat the last play', async () => {
      (canBeatPlay as jest.Mock).mockReturnValue(true);

      const card = makeCard('AS');
      await renderAndPlay([card], {
        lastPlay: mockLastPlay,
        isFirstPlayOfGame: false,
        playerHand: [card],
      });

      expect(multiplayerPlayCards).toHaveBeenCalledTimes(1);
      expect(showError).not.toHaveBeenCalled();
    });

    it('skips the beat-check when there is no last play (leading)', async () => {
      const card = makeCard('7H');
      await renderAndPlay([card], {
        lastPlay: null,
        isFirstPlayOfGame: false,
        playerHand: [card],
      });

      expect(canBeatPlay).not.toHaveBeenCalled();
      expect(multiplayerPlayCards).toHaveBeenCalledTimes(1);
    });
  });

  // ---- Check 5: One Card Left rule (OCL) --------------------------------

  describe('Check 5 — One Card Left rule', () => {
    const mockLastPlay: LastPlay = {
      player_index: 1,
      cards: [makeCard('5H')],
      combo_type: 'Single',
      timestamp: new Date().toISOString(),
    };

    it('rejects a single when OCL rule requires a higher card and nextPlayerCardCount=1', async () => {
      (validateOneCardLeftRule as jest.Mock).mockReturnValue({
        valid: false,
      });

      const card = makeCard('6D');
      await renderAndPlay([card], {
        lastPlay: mockLastPlay,
        isFirstPlayOfGame: false,
        playerHand: [card, makeCard('AS')],
        nextPlayerCardCount: 1,
      });

      expect(multiplayerPlayCards).not.toHaveBeenCalled();
      expect(showError).toHaveBeenCalledWith('game.oneCardLeftMustPlayHighestSingle');
      expect(soundManager.playSound).toHaveBeenCalledWith(SoundType.INVALID_MOVE);
    });

    it('allows the play when OCL rule is satisfied (playing highest single)', async () => {
      (validateOneCardLeftRule as jest.Mock).mockReturnValue({ valid: true });

      const card = makeCard('AS');
      await renderAndPlay([card], {
        lastPlay: mockLastPlay,
        isFirstPlayOfGame: false,
        playerHand: [card],
        nextPlayerCardCount: 1,
      });

      expect(multiplayerPlayCards).toHaveBeenCalledTimes(1);
      expect(showError).not.toHaveBeenCalled();
    });

    it('skips OCL check when nextPlayerCardCount is undefined', async () => {
      // validateOneCardLeftRule should not be called if count is not provided
      const card = makeCard('6D');
      await renderAndPlay([card], {
        lastPlay: mockLastPlay,
        isFirstPlayOfGame: false,
        playerHand: [card],
        // nextPlayerCardCount intentionally omitted
      });

      expect(validateOneCardLeftRule).not.toHaveBeenCalled();
      expect(multiplayerPlayCards).toHaveBeenCalledTimes(1);
    });
  });

  // ---- Offline / local-AI validation path --------------------------------

  describe('Offline validation path (getOfflineValidationState)', () => {
    /**
     * Helper: render the hook in local-AI mode with getOfflineValidationState.
     */
    const renderAndPlayOffline = async (cards: Card[], offlineState: ValidationState | null) => {
      const getOfflineValidationState = jest.fn().mockReturnValue(offlineState);
      const gameManager = {
        playCards: jest.fn().mockResolvedValue({ success: true }),
        pass: jest.fn(),
      };

      const { result } = renderHook(() =>
        useGameActions({
          isLocalAIGame: true,
          gameManagerRef: { current: gameManager },
          multiplayerPlayCards,
          multiplayerPass,
          setSelectedCardIds,
          navigation: navigation as any,
          isMountedRef,
          getOfflineValidationState,
        })
      );

      await act(async () => {
        await result.current.handlePlayCards(cards);
      });

      return { gameManager, getOfflineValidationState };
    };

    it('calls gameManager.playCards when offline validation passes', async () => {
      const card = makeCard('AS');
      const { gameManager } = await renderAndPlayOffline([card], {
        lastPlay: null,
        isFirstPlayOfGame: false,
        playerHand: [card],
      });

      expect(gameManager.playCards).toHaveBeenCalledTimes(1);
      expect(showError).not.toHaveBeenCalled();
    });

    it('rejects offline card-not-in-hand check', async () => {
      const { gameManager } = await renderAndPlayOffline([makeCard('5S')], {
        lastPlay: null,
        isFirstPlayOfGame: false,
        playerHand: [makeCard('3D')],
      });

      expect(gameManager.playCards).not.toHaveBeenCalled();
      expect(showError).toHaveBeenCalledWith('game.cardNotInHand');
    });

    it('rejects offline OCL rule violation', async () => {
      (validateOneCardLeftRule as jest.Mock).mockReturnValue({
        valid: false,
      });

      const mockLast: LastPlay = {
        player_index: 1,
        cards: [makeCard('7H')],
        combo_type: 'Single',
        timestamp: new Date().toISOString(),
      };

      const card = makeCard('9D');
      const { gameManager } = await renderAndPlayOffline([card], {
        lastPlay: mockLast,
        isFirstPlayOfGame: false,
        playerHand: [card, makeCard('AS')],
        nextPlayerCardCount: 1,
      });

      expect(gameManager.playCards).not.toHaveBeenCalled();
      expect(showError).toHaveBeenCalledWith('game.oneCardLeftMustPlayHighestSingle');
    });

    it('calls gameManager.playCards when getOfflineValidationState returns null', async () => {
      const gameManager = {
        playCards: jest.fn().mockResolvedValue({ success: true }),
        pass: jest.fn(),
      };

      const { result } = renderHook(() =>
        useGameActions({
          isLocalAIGame: true,
          gameManagerRef: { current: gameManager },
          multiplayerPlayCards,
          multiplayerPass,
          setSelectedCardIds,
          navigation: navigation as any,
          isMountedRef,
          getOfflineValidationState: jest.fn().mockReturnValue(null),
        })
      );

      await act(async () => {
        await result.current.handlePlayCards([makeCard('3D')]);
      });

      expect(gameManager.playCards).toHaveBeenCalledTimes(1);
    });
  });

  // ---- Local AI game bypasses multiplayer validation ---------------------

  it('does not call getMultiplayerValidationState for local AI games', async () => {
    const getMultiplayerValidationState = jest.fn().mockReturnValue({
      lastPlay: null,
      isFirstPlayOfGame: true,
      playerHand: [],
    });

    const gameManager = {
      playCards: jest.fn().mockResolvedValue({ success: true }),
      pass: jest.fn(),
    };

    const { result } = renderHook(() =>
      useGameActions({
        isLocalAIGame: true,
        gameManagerRef: { current: gameManager },
        multiplayerPlayCards,
        multiplayerPass,
        setSelectedCardIds,
        navigation: navigation as any,
        isMountedRef,
        getMultiplayerValidationState,
      })
    );

    const cards = [makeCard('4S')]; // Would fail 3D check if checked
    await act(async () => {
      await result.current.handlePlayCards(cards);
    });

    // Local AI path — getMultiplayerValidationState never consulted
    expect(getMultiplayerValidationState).not.toHaveBeenCalled();
    expect(gameManager.playCards).toHaveBeenCalledTimes(1);
    expect(multiplayerPlayCards).not.toHaveBeenCalled();
  });
});
