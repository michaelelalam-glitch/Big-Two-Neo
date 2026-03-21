/**
 * Task #327 — Visual Regression Tests for Card UI
 *
 * Snapshot tests that act as baselines for:
 *   - Card component (all 4 suits, selected/unselected, disabled)
 *   - CardHand component (5 cards, 13 cards, selected card)
 *   - CenterPlayArea component (empty, single, combo)
 *   - PlayerInfo component (active, inactive, disconnected)
 *
 * First run creates `__snapshots__/CardVisualRegression.test.tsx.snap`.
 * Subsequent runs diff against that baseline — a visual regression fails
 * the test, prompting a deliberate `--updateSnapshot` review.
 *
 * CI integration: snapshots are committed; CI fails on unexpected diffs.
 */

// ── Gesture-handler mock (must come before any component imports) ──────────
jest.mock('react-native-gesture-handler', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    Gesture: {
      Pan: jest.fn(() => ({
        onStart: jest.fn().mockReturnThis(),
        onUpdate: jest.fn().mockReturnThis(),
        onEnd: jest.fn().mockReturnThis(),
        onFinalize: jest.fn().mockReturnThis(),
        enabled: jest.fn().mockReturnThis(),
        minDistance: jest.fn().mockReturnThis(),
      })),
      Tap: jest.fn(() => ({
        onStart: jest.fn().mockReturnThis(),
        onEnd: jest.fn().mockReturnThis(),
        enabled: jest.fn().mockReturnThis(),
        maxDuration: jest.fn().mockReturnThis(),
      })),
      LongPress: jest.fn(() => ({
        onStart: jest.fn().mockReturnThis(),
        onEnd: jest.fn().mockReturnThis(),
        enabled: jest.fn().mockReturnThis(),
        minDuration: jest.fn().mockReturnThis(),
      })),
      Race: jest.fn((...gestures: any[]) => gestures[0]),
      Exclusive: jest.fn((...gestures: any[]) => gestures[0]),
      Simultaneous: jest.fn((...gestures: any[]) => gestures[0]),
    },
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
    GestureHandlerRootView: ({ children }: { children: React.ReactNode }) =>
      React.createElement(View, null, children),
  };
});

// ── SVG mock (react-native-svg used by InactivityCountdownRing) ──────────────
jest.mock('react-native-svg', () => {
  const React = require('react');
  const createMock =
    (name: string) =>
    ({ children, ...props }: any) =>
      React.createElement(name, props, children);
  return {
    Svg: createMock('Svg'),
    Circle: createMock('Circle'),
    Path: createMock('Path'),
    G: createMock('G'),
    default: createMock('Svg'),
  };
});

import React from 'react';
import { render } from '@testing-library/react-native';
import Card from '../Card';
import CardHand from '../CardHand';
import CenterPlayArea from '../CenterPlayArea';
import PlayerInfo from '../PlayerInfo';
import type { Card as CardType } from '../../../game/types';

// ── Test fixtures ─────────────────────────────────────────────────────────────

const SUIT_CARDS: CardType[] = [
  { id: '3H', rank: '3', suit: 'H' },
  { id: '5D', rank: '5', suit: 'D' },
  { id: '7C', rank: '7', suit: 'C' },
  { id: '9S', rank: '9', suit: 'S' },
];

const FULL_HAND_13: CardType[] = [
  { id: '3H', rank: '3', suit: 'H' },
  { id: '4D', rank: '4', suit: 'D' },
  { id: '5C', rank: '5', suit: 'C' },
  { id: '6S', rank: '6', suit: 'S' },
  { id: '7H', rank: '7', suit: 'H' },
  { id: '8D', rank: '8', suit: 'D' },
  { id: '9C', rank: '9', suit: 'C' },
  { id: '10C', rank: '10', suit: 'C' },
  { id: 'JS', rank: 'J', suit: 'S' },
  { id: 'QH', rank: 'Q', suit: 'H' },
  { id: 'KD', rank: 'K', suit: 'D' },
  { id: 'AC', rank: 'A', suit: 'C' },
  { id: '2S', rank: '2', suit: 'S' },
];

const STRAIGHT_COMBO: CardType[] = [
  { id: '3H', rank: '3', suit: 'H' },
  { id: '4D', rank: '4', suit: 'D' },
  { id: '5C', rank: '5', suit: 'C' },
  { id: '6S', rank: '6', suit: 'S' },
  { id: '7H', rank: '7', suit: 'H' },
];

// ── Card snapshots ────────────────────────────────────────────────────────────

describe('Card — visual regression snapshots', () => {
  const noop = jest.fn();

  it('renders 3♥ unselected (baseline)', () => {
    const { toJSON } = render(
      <Card card={SUIT_CARDS[0]} isSelected={false} onToggleSelect={noop} />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it('renders 5♦ unselected', () => {
    const { toJSON } = render(
      <Card card={SUIT_CARDS[1]} isSelected={false} onToggleSelect={noop} />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it('renders 7♣ unselected', () => {
    const { toJSON } = render(
      <Card card={SUIT_CARDS[2]} isSelected={false} onToggleSelect={noop} />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it('renders 9♠ unselected', () => {
    const { toJSON } = render(
      <Card card={SUIT_CARDS[3]} isSelected={false} onToggleSelect={noop} />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it('renders card in selected state (elevated)', () => {
    const { toJSON } = render(
      <Card card={SUIT_CARDS[0]} isSelected={true} onToggleSelect={noop} />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it('renders card in disabled state', () => {
    const { toJSON } = render(
      <Card card={SUIT_CARDS[0]} isSelected={false} onToggleSelect={noop} disabled={true} />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it('renders 2♠ (highest card in Big Two)', () => {
    const twoSpades: CardType = { id: '2S', rank: '2', suit: 'S' };
    const { toJSON } = render(<Card card={twoSpades} isSelected={false} onToggleSelect={noop} />);
    expect(toJSON()).toMatchSnapshot();
  });
});

// ── CardHand snapshots ────────────────────────────────────────────────────────

describe('CardHand — visual regression snapshots', () => {
  const noop = jest.fn();

  it('renders a 5-card hand (no selection)', () => {
    const hand5 = FULL_HAND_13.slice(0, 5);
    const { toJSON } = render(<CardHand cards={hand5} onPlayCards={noop} onPass={noop} />);
    expect(toJSON()).toMatchSnapshot();
  });

  it('renders a 13-card starting hand', () => {
    const { toJSON } = render(<CardHand cards={FULL_HAND_13} onPlayCards={noop} onPass={noop} />);
    expect(toJSON()).toMatchSnapshot();
  });

  it('renders hand with one card selected', () => {
    const { toJSON } = render(
      <CardHand
        cards={FULL_HAND_13.slice(0, 5)}
        selectedCardIds={new Set([FULL_HAND_13[0].id])}
        onPlayCards={noop}
        onPass={noop}
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it('renders hand with Play button disabled (no cards selected)', () => {
    const { toJSON } = render(
      <CardHand cards={FULL_HAND_13.slice(0, 5)} onPlayCards={noop} onPass={noop} />
    );
    expect(toJSON()).toMatchSnapshot();
  });
});

// ── CenterPlayArea snapshots ──────────────────────────────────────────────────

describe('CenterPlayArea — visual regression snapshots', () => {
  it('renders empty state (no cards played yet)', () => {
    const { toJSON } = render(<CenterPlayArea lastPlayed={null} lastPlayedBy={null} />);
    expect(toJSON()).toMatchSnapshot();
  });

  it('renders single card play', () => {
    const single: CardType[] = [{ id: 'AH', rank: 'A', suit: 'H' }];
    const { toJSON } = render(
      <CenterPlayArea
        lastPlayed={single}
        lastPlayedBy="Alice"
        combinationType="Single"
        comboDisplayText="Single A♥"
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it('renders pair play', () => {
    const pair: CardType[] = [
      { id: 'KH', rank: 'K', suit: 'H' },
      { id: 'KD', rank: 'K', suit: 'D' },
    ];
    const { toJSON } = render(
      <CenterPlayArea
        lastPlayed={pair}
        lastPlayedBy="Bob"
        combinationType="Pair"
        comboDisplayText="Pair K"
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it('renders straight combo (5 cards)', () => {
    const { toJSON } = render(
      <CenterPlayArea
        lastPlayed={STRAIGHT_COMBO}
        lastPlayedBy="Charlie"
        combinationType="Straight"
        comboDisplayText="Straight to 7"
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it('renders with drop zone text (during drag)', () => {
    const { toJSON } = render(
      <CenterPlayArea lastPlayed={null} lastPlayedBy={null} dropZoneText="Drop here to play" />
    );
    expect(toJSON()).toMatchSnapshot();
  });
});

// ── PlayerInfo snapshots ──────────────────────────────────────────────────────

describe('PlayerInfo — visual regression snapshots', () => {
  it('renders active player (current turn)', () => {
    const { toJSON } = render(
      <PlayerInfo name="Alice" cardCount={7} isActive={true} totalScore={0} />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it('renders inactive player (waiting for turn)', () => {
    const { toJSON } = render(
      <PlayerInfo name="Bob" cardCount={13} isActive={false} totalScore={-5} />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it('renders disconnected player (spinner shown)', () => {
    const { toJSON } = render(
      <PlayerInfo name="Charlie" cardCount={5} isActive={false} isDisconnected={true} />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it('renders player with 1 card left (near win)', () => {
    const { toJSON } = render(
      <PlayerInfo name="Dave" cardCount={1} isActive={true} totalScore={10} />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it('renders local player with camera on', () => {
    const { toJSON } = render(
      <PlayerInfo
        name="Me"
        cardCount={8}
        isActive={false}
        isLocalPlayer={true}
        isCameraOn={true}
        isMicOn={true}
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });
});
