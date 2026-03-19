/**
 * Unit tests for GameErrorBoundary — Task #643
 *
 * Covers:
 *  - Renders children normally when no error is thrown
 *  - Shows fallback UI when a child throws
 *  - "Try Again" resets the boundary so children re-mount
 *  - "Return to Menu" triggers navigation.reset to Home
 *  - onError callback is called with the thrown error
 */

import React from 'react';
import { Text } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';

// ── Mock navigation ──────────────────────────────────────────────────────────
const mockReset = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ reset: mockReset }),
}));

// ── Import component under test ──────────────────────────────────────────────
import { GameErrorBoundary } from '../GameErrorBoundary';

// ── Helper: component that throws on demand ───────────────────────────────────
interface ThrowingChildProps {
  shouldThrow?: boolean;
}
function ThrowingChild({ shouldThrow = false }: ThrowingChildProps) {
  if (shouldThrow) throw new Error('test game error');
  return <Text testID="healthy-child">All good</Text>;
}

// Suppress React's error boundary console.error noise in test output
beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  (console.error as jest.Mock).mockRestore();
  jest.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GameErrorBoundary — normal rendering', () => {
  it('renders children when no error is thrown', () => {
    const { getByTestId } = render(
      <GameErrorBoundary>
        <ThrowingChild shouldThrow={false} />
      </GameErrorBoundary>
    );
    expect(getByTestId('healthy-child')).toBeTruthy();
  });
});

describe('GameErrorBoundary — error fallback', () => {
  it('shows fallback UI when a child throws', () => {
    const { getByText, queryByTestId } = render(
      <GameErrorBoundary>
        <ThrowingChild shouldThrow />
      </GameErrorBoundary>
    );
    expect(getByText('Game Error')).toBeTruthy();
    expect(queryByTestId('healthy-child')).toBeNull();
  });

  it('shows "Try Again" and "Return to Menu" buttons in fallback', () => {
    const { getByText } = render(
      <GameErrorBoundary>
        <ThrowingChild shouldThrow />
      </GameErrorBoundary>
    );
    expect(getByText('Try Again')).toBeTruthy();
    expect(getByText('Return to Menu')).toBeTruthy();
  });
});

describe('GameErrorBoundary — Try Again', () => {
  it('triggers a child re-mount when "Try Again" is pressed (mount counter confirms boundary reset)', () => {
    let mountCount = 0;

    function CountingChild() {
      mountCount++;
      throw new Error('persistent game error');
    }

    const { getByText } = render(
      <GameErrorBoundary>
        <CountingChild />
      </GameErrorBoundary>
    );

    // Child was mounted once and threw — boundary shows fallback
    const mountsAfterFirstRender = mountCount;
    expect(mountsAfterFirstRender).toBeGreaterThan(0);
    expect(getByText('Game Error')).toBeTruthy();

    fireEvent.press(getByText('Try Again'));

    // After reset the boundary clears hasError and re-mounts the child.
    // The child throws again (showing the fallback), but mountCount
    // increasing is the observable proof that the boundary actually reset
    // its internal state and attempted a fresh render of its children.
    expect(mountCount).toBeGreaterThan(mountsAfterFirstRender);
  });

  it('re-renders children after pressing "Try Again" when child no longer throws', () => {
    let shouldThrow = true;

    function ControlledChild() {
      if (shouldThrow) throw new Error('boom');
      return <Text testID="recovered-child">Recovered</Text>;
    }

    const { getByText, getByTestId } = render(
      <GameErrorBoundary>
        <ControlledChild />
      </GameErrorBoundary>
    );

    expect(getByText('Game Error')).toBeTruthy();

    // Fix the root cause before pressing Try Again
    shouldThrow = false;
    fireEvent.press(getByText('Try Again'));

    expect(getByTestId('recovered-child')).toBeTruthy();
  });
});

describe('GameErrorBoundary — Return to Menu', () => {
  it('calls navigation.reset to Home when "Return to Menu" is pressed', () => {
    const { getByText } = render(
      <GameErrorBoundary>
        <ThrowingChild shouldThrow />
      </GameErrorBoundary>
    );

    fireEvent.press(getByText('Return to Menu'));

    expect(mockReset).toHaveBeenCalledTimes(1);
    expect(mockReset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'Home' }] });
  });
});

describe('GameErrorBoundary — onError callback', () => {
  it('calls the onError prop with the thrown error', () => {
    const onError = jest.fn();
    const testError = new Error('callback test error');

    function SingleThrow() {
      throw testError;
    }

    render(
      <GameErrorBoundary onError={onError}>
        <SingleThrow />
      </GameErrorBoundary>
    );

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      testError,
      expect.objectContaining({ componentStack: expect.any(String) })
    );
  });
});
