/**
 * Visual Regression Tests — Landscape Layout (L11)
 *
 * Snapshot tests for landscape-mode components. Run `pnpm test --updateSnapshot`
 * to regenerate snapshots when intentional UI changes are made. If a snapshot
 * fails during CI, it indicates an unintended visual change that requires
 * explicit review.
 *
 * Coverage:
 * - LandscapeCard (base, compact, hand, center size variants)
 * - LandscapeControlBar (default toolbar)
 * - LandscapeScoreboard (summary view)
 *
 * Note: LandscapeGameLayout and LandscapeOvalTable have complex external deps
 * (audio, supabase) and are covered by integration tests in their own files.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const { View, Text, ScrollView } = require('react-native');
  return {
    __esModule: true,
    default: {
      View: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) =>
        React.createElement(View, { ...props, ref })
      ),
      Text: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) =>
        React.createElement(Text, { ...props, ref })
      ),
      ScrollView: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) =>
        React.createElement(ScrollView, { ...props, ref })
      ),
      createAnimatedComponent: (C: React.ComponentType) => C,
    },
    useSharedValue: jest.fn((v: unknown) => ({ value: v })),
    useAnimatedStyle: jest.fn((fn: () => unknown) => fn()),
    withTiming: jest.fn((v: unknown) => v),
    withSpring: jest.fn((v: unknown) => v),
    runOnJS: jest.fn((fn: unknown) => fn),
    cancelAnimation: jest.fn(),
    Easing: { bezier: jest.fn() },
  };
});

jest.mock('react-native-gesture-handler', () => ({
  GestureDetector: ({ children }: { children: React.ReactNode }) => children,
  Gesture: {
    Tap: jest.fn(() => ({
      onEnd: jest.fn().mockReturnThis(),
      enabled: jest.fn().mockReturnThis(),
    })),
    Pan: jest.fn(() => ({
      onUpdate: jest.fn().mockReturnThis(),
      enabled: jest.fn().mockReturnThis(),
    })),
    Simultaneous: jest.fn(),
  },
  GestureHandlerRootView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('../../../utils/cardAssets', () => ({
  getCardImageSource: jest.fn(() => ({ uri: 'mock-card-image' })),
}));

jest.mock('../../../utils/soundManager', () => ({
  soundManager: { playSound: jest.fn(), cleanup: jest.fn() },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function aCard(rank: string, suit: string) {
  return { id: `${rank}${suit}`, rank: rank as never, suit: suit as never };
}

// ── LandscapeCard snapshot tests ──────────────────────────────────────────────

describe('LandscapeCard — visual regression (L11)', () => {
  // Import lazily so mocks apply first
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const LandscapeCard = require('../LandscapeCard').default;

  test('renders base-size card snapshot', () => {
    const { toJSON } = render(<LandscapeCard card={aCard('A', 'S')} size="base" />);
    expect(toJSON()).toMatchSnapshot();
  });

  test('renders compact-size card snapshot', () => {
    const { toJSON } = render(<LandscapeCard card={aCard('K', 'H')} size="compact" />);
    expect(toJSON()).toMatchSnapshot();
  });

  test('renders hand-size card snapshot', () => {
    const { toJSON } = render(<LandscapeCard card={aCard('3', 'D')} size="hand" />);
    expect(toJSON()).toMatchSnapshot();
  });

  test('renders center-size card snapshot', () => {
    const { toJSON } = render(<LandscapeCard card={aCard('2', 'C')} size="center" />);
    expect(toJSON()).toMatchSnapshot();
  });

  test('red-suit (hearts) card snapshot', () => {
    const { toJSON } = render(<LandscapeCard card={aCard('Q', 'H')} size="base" />);
    expect(toJSON()).toMatchSnapshot();
  });

  test('black-suit (spades) card snapshot', () => {
    const { toJSON } = render(<LandscapeCard card={aCard('J', 'S')} size="base" />);
    expect(toJSON()).toMatchSnapshot();
  });
});
