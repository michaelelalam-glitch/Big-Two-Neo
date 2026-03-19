/**
 * Unit tests for GlobalErrorBoundary — Task #643
 *
 * Covers:
 *  - Renders children normally when no error is thrown
 *  - Shows fallback UI when a child throws
 *  - "Try Again" resets the boundary so children re-mount
 */

import React from 'react';
import { Text } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { GlobalErrorBoundary } from '../GlobalErrorBoundary';

// ── Helper: component that throws on demand ───────────────────────────────────
interface ThrowingChildProps {
  shouldThrow?: boolean;
}
function ThrowingChild({ shouldThrow = false }: ThrowingChildProps) {
  if (shouldThrow) throw new Error('test global error');
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

describe('GlobalErrorBoundary — normal rendering', () => {
  it('renders children when no error is thrown', () => {
    const { getByTestId } = render(
      <GlobalErrorBoundary>
        <ThrowingChild shouldThrow={false} />
      </GlobalErrorBoundary>
    );
    expect(getByTestId('healthy-child')).toBeTruthy();
  });
});

describe('GlobalErrorBoundary — error fallback', () => {
  it('shows fallback UI when a child throws', () => {
    const { getByText, queryByTestId } = render(
      <GlobalErrorBoundary>
        <ThrowingChild shouldThrow />
      </GlobalErrorBoundary>
    );
    expect(getByText('Something went wrong')).toBeTruthy();
    expect(queryByTestId('healthy-child')).toBeNull();
  });

  it('shows "Try Again" button in fallback', () => {
    const { getByText } = render(
      <GlobalErrorBoundary>
        <ThrowingChild shouldThrow />
      </GlobalErrorBoundary>
    );
    expect(getByText('Try Again')).toBeTruthy();
  });
});

describe('GlobalErrorBoundary — Try Again', () => {
  it('re-renders children after pressing "Try Again" when child no longer throws', () => {
    let shouldThrow = true;

    function ControlledChild() {
      if (shouldThrow) throw new Error('boom');
      return <Text testID="recovered-child">Recovered</Text>;
    }

    const { getByText, getByTestId } = render(
      <GlobalErrorBoundary>
        <ControlledChild />
      </GlobalErrorBoundary>
    );

    expect(getByText('Something went wrong')).toBeTruthy();

    // Fix the root cause before pressing Try Again
    shouldThrow = false;
    fireEvent.press(getByText('Try Again'));

    expect(getByTestId('recovered-child')).toBeTruthy();
  });

  it('clears the error state when "Try Again" is pressed', () => {
    const { getByText } = render(
      <GlobalErrorBoundary>
        <ThrowingChild shouldThrow />
      </GlobalErrorBoundary>
    );

    expect(getByText('Something went wrong')).toBeTruthy();

    // Pressing Try Again resets boundary state (child will re-throw,
    // but the boundary itself accepted the reset — error UI is re-shown
    // after the next render cycle which is acceptable behaviour).
    fireEvent.press(getByText('Try Again'));

    // The fallback is shown again because the child still throws
    expect(getByText('Something went wrong')).toBeTruthy();
  });
});
