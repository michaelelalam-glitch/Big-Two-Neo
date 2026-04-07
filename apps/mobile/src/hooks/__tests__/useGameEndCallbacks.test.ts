/**
 * useGameEndCallbacks Hook Tests — H15 Audit Fix
 *
 * Tests for Play Again / Return to Menu callback registration:
 * - Play Again: clears history, reinitializes game, handles errors
 * - Return to Menu: resets navigation stack to Home
 * - iOS alert path vs showError fallback
 * - Null gameManagerRef graceful handling
 */

import { renderHook } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { useGameEndCallbacks } from '../useGameEndCallbacks';

// ── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../../utils', () => ({
  showError: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  gameLogger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../../i18n', () => ({
  i18n: { t: (key: string) => key },
}));

import { showError } from '../../utils';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeOptions(overrides: Record<string, unknown> = {}) {
  const playAgainFn: { current: (() => Promise<void>) | null } = { current: null };
  const returnToMenuFn: { current: (() => void) | null } = { current: null };

  const defaultOpts = {
    gameManagerRef: { current: { initializeGame: jest.fn().mockResolvedValue(undefined) } },
    currentPlayerName: 'TestPlayer',
    botDifficulty: 'medium' as const,
    navigation: { reset: jest.fn() } as unknown,
    setOnPlayAgain: jest.fn((factory: () => () => Promise<void>) => {
      playAgainFn.current = factory();
    }),
    setOnReturnToMenu: jest.fn((factory: () => () => void) => {
      returnToMenuFn.current = factory();
    }),
    clearHistory: jest.fn(),
    onAlert: undefined as ((opts: { title?: string; message: string }) => void) | undefined,
    ...overrides,
  };

  return {
    opts: defaultOpts as Parameters<typeof useGameEndCallbacks>[0],
    playAgainFn,
    returnToMenuFn,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('useGameEndCallbacks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registers both callbacks on mount', () => {
    const { opts } = makeOptions();
    renderHook(() => useGameEndCallbacks(opts));

    expect(opts.setOnPlayAgain).toHaveBeenCalledTimes(1);
    expect(opts.setOnReturnToMenu).toHaveBeenCalledTimes(1);
  });

  // ── Play Again ────────────────────────────────────────────────────────

  it('Play Again: clears history and reinitializes game', async () => {
    const mockInit = jest.fn().mockResolvedValue(undefined);
    const { opts, playAgainFn } = makeOptions({
      gameManagerRef: { current: { initializeGame: mockInit } },
    });

    renderHook(() => useGameEndCallbacks(opts));
    await playAgainFn.current!();

    expect(opts.clearHistory).toHaveBeenCalledTimes(1);
    expect(mockInit).toHaveBeenCalledWith({
      playerName: 'TestPlayer',
      botCount: 3,
      botDifficulty: 'medium',
    });
  });

  it('Play Again: shows error when gameManagerRef is null', async () => {
    const { opts, playAgainFn } = makeOptions({
      gameManagerRef: { current: null },
    });

    renderHook(() => useGameEndCallbacks(opts));
    await playAgainFn.current!();

    expect(showError).toHaveBeenCalledWith('Game not ready. Please try again.');
    expect(opts.clearHistory).not.toHaveBeenCalled();
  });

  it('Play Again: catches initializeGame errors and shows alert', async () => {
    const mockInit = jest.fn().mockRejectedValue(new Error('init failed'));
    const { opts, playAgainFn } = makeOptions({
      gameManagerRef: { current: { initializeGame: mockInit } },
    });

    renderHook(() => useGameEndCallbacks(opts));
    await playAgainFn.current!();

    expect(showError).toHaveBeenCalledWith('Failed to restart game. Please try again.');
  });

  it('Play Again on iOS uses onAlert instead of showError', async () => {
    const originalOS = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });

    const mockAlert = jest.fn();
    const { opts, playAgainFn } = makeOptions({
      gameManagerRef: { current: null },
      onAlert: mockAlert,
    });

    renderHook(() => useGameEndCallbacks(opts));
    await playAgainFn.current!();

    expect(mockAlert).toHaveBeenCalledWith({
      title: 'common.error',
      message: 'Game not ready. Please try again.',
    });
    expect(showError).not.toHaveBeenCalled();

    Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
  });

  it('Play Again uses showError on Android even with onAlert', async () => {
    const originalOS = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });

    const mockAlert = jest.fn();
    const { opts, playAgainFn } = makeOptions({
      gameManagerRef: { current: null },
      onAlert: mockAlert,
    });

    renderHook(() => useGameEndCallbacks(opts));
    await playAgainFn.current!();

    expect(showError).toHaveBeenCalledWith('Game not ready. Please try again.');
    expect(mockAlert).not.toHaveBeenCalled();

    Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
  });

  // ── Return to Menu ────────────────────────────────────────────────────

  it('Return to Menu: resets navigation to Home', () => {
    const mockReset = jest.fn();
    const { opts, returnToMenuFn } = makeOptions({
      navigation: { reset: mockReset },
    });

    renderHook(() => useGameEndCallbacks(opts));
    returnToMenuFn.current!();

    expect(mockReset).toHaveBeenCalledWith({
      index: 0,
      routes: [{ name: 'Home' }],
    });
  });

  // ── Dependency updates ────────────────────────────────────────────────

  it('re-registers callbacks when botDifficulty changes', () => {
    const { opts } = makeOptions({ botDifficulty: 'easy' as const });
    const { rerender } = renderHook(
      (props: Parameters<typeof useGameEndCallbacks>[0]) => useGameEndCallbacks(props),
      { initialProps: opts }
    );

    expect(opts.setOnPlayAgain).toHaveBeenCalledTimes(1);

    const updatedOpts = { ...opts, botDifficulty: 'hard' as const };
    rerender(updatedOpts);

    // setOnPlayAgain is called again with new difficulty closure
    expect(opts.setOnPlayAgain).toHaveBeenCalledTimes(2);
  });
});
