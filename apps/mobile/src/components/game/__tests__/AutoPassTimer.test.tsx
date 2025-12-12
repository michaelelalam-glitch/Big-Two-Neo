/**
 * Tests for AutoPassTimer Component
 * 
 * Tests the countdown timer display UI component that shows when
 * the highest possible card/combo is played.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import AutoPassTimer from '../AutoPassTimer';
import type { AutoPassTimerState } from '../../../types/multiplayer';

describe('AutoPassTimer Component', () => {
  const createTimerState = (overrides?: Partial<AutoPassTimerState>): AutoPassTimerState => ({
    active: true,
    started_at: new Date().toISOString(),
    duration_ms: 10000,
    remaining_ms: 10000,
    triggering_play: {
      position: 0,
      cards: [{ id: '2S', rank: '2', suit: 'S' }],
      combo_type: 'Single',
    },
    ...overrides,
  });

  describe('Rendering', () => {
    it('should render timer when active', () => {
      const timerState = createTimerState();
      const { getByText } = render(
        <AutoPassTimer timerState={timerState} currentPlayerIndex={0} />
      );

      expect(getByText('10')).toBeTruthy(); // 10 seconds
      expect(getByText('sec')).toBeTruthy();
      expect(getByText('Highest Play: Single')).toBeTruthy();
    });

    it('should not render when timer is null', () => {
      const { queryByText } = render(
        <AutoPassTimer timerState={null} currentPlayerIndex={0} />
      );

      expect(queryByText('sec')).toBeNull();
    });

    it('should not render when timer is inactive', () => {
      const timerState = createTimerState({ active: false });
      const { queryByText } = render(
        <AutoPassTimer timerState={timerState} currentPlayerIndex={0} />
      );

      expect(queryByText('sec')).toBeNull();
    });

    it('should not render when remaining time is 0', () => {
      const timerState = createTimerState({ remaining_ms: 0 });
      const { queryByText } = render(
        <AutoPassTimer timerState={timerState} currentPlayerIndex={0} />
      );

      expect(queryByText('sec')).toBeNull();
    });
  });

  describe('Countdown Display', () => {
    it('should display 10 seconds for 10000ms remaining', () => {
      const timerState = createTimerState({ remaining_ms: 10000 });
      const { getByText } = render(
        <AutoPassTimer timerState={timerState} currentPlayerIndex={0} />
      );

      expect(getByText('10')).toBeTruthy();
    });

    it('should display 5 seconds for 5000ms remaining', () => {
      const timerState = createTimerState({ remaining_ms: 5000 });
      const { getByText } = render(
        <AutoPassTimer timerState={timerState} currentPlayerIndex={0} />
      );

      expect(getByText('5')).toBeTruthy();
    });

    it('should display 1 second for 1000ms remaining', () => {
      const timerState = createTimerState({ remaining_ms: 1000 });
      const { getByText } = render(
        <AutoPassTimer timerState={timerState} currentPlayerIndex={0} />
      );

      expect(getByText('1')).toBeTruthy();
    });

    it('should round up partial seconds', () => {
      const timerState = createTimerState({ remaining_ms: 1500 }); // 1.5s
      const { getByText } = render(
        <AutoPassTimer timerState={timerState} currentPlayerIndex={0} />
      );

      expect(getByText('2')).toBeTruthy(); // Rounded up from 1.5
    });
  });

  describe('Combo Type Display', () => {
    it('should display Single combo type', () => {
      const timerState = createTimerState({
        triggering_play: {
          position: 0,
          cards: [{ id: '2S', rank: '2', suit: 'S' }],
          combo_type: 'Single',
        },
      });
      const { getByText } = render(
        <AutoPassTimer timerState={timerState} currentPlayerIndex={0} />
      );

      expect(getByText('Highest Play: Single')).toBeTruthy();
    });

    it('should display Pair combo type', () => {
      const timerState = createTimerState({
        triggering_play: {
          position: 0,
          cards: [
            { id: '2S', rank: '2', suit: 'S' },
            { id: '2H', rank: '2', suit: 'H' },
          ],
          combo_type: 'Pair',
        },
      });
      const { getByText } = render(
        <AutoPassTimer timerState={timerState} currentPlayerIndex={0} />
      );

      expect(getByText('Highest Play: Pair')).toBeTruthy();
    });

    it('should display Straight Flush combo type', () => {
      const timerState = createTimerState({
        triggering_play: {
          position: 0,
          cards: [
            { id: '10S', rank: '10', suit: 'S' },
            { id: 'JS', rank: 'J', suit: 'S' },
            { id: 'QS', rank: 'Q', suit: 'S' },
            { id: 'KS', rank: 'K', suit: 'S' },
            { id: 'AS', rank: 'A', suit: 'S' },
          ],
          combo_type: 'Straight Flush',
        },
      });
      const { getByText } = render(
        <AutoPassTimer timerState={timerState} currentPlayerIndex={0} />
      );

      expect(getByText('Highest Play: Straight Flush')).toBeTruthy();
    });
  });

  describe('Message Display', () => {
    it('should display auto-pass message with time', () => {
      const timerState = createTimerState({ remaining_ms: 7000 });
      const { getByText } = render(
        <AutoPassTimer timerState={timerState} currentPlayerIndex={0} />
      );

      expect(getByText('No one can beat this play - 7s to pass')).toBeTruthy();
    });

    it('should update message when time changes', () => {
      const timerState = createTimerState({ remaining_ms: 3000 });
      const { getByText, rerender } = render(
        <AutoPassTimer timerState={timerState} currentPlayerIndex={0} />
      );

      expect(getByText('No one can beat this play - 3s to pass')).toBeTruthy();

      // Simulate time passing
      const updatedTimerState = createTimerState({ remaining_ms: 2000 });
      rerender(<AutoPassTimer timerState={updatedTimerState} currentPlayerIndex={0} />);

      expect(getByText('No one can beat this play - 2s to pass')).toBeTruthy();
    });
  });

  describe('Edge Cases', () => {
    it('should handle very low remaining time', () => {
      const timerState = createTimerState({ remaining_ms: 100 }); // 0.1s
      const { getByText } = render(
        <AutoPassTimer timerState={timerState} currentPlayerIndex={0} />
      );

      expect(getByText('1')).toBeTruthy(); // Rounded up from 0.1
    });

    it('should handle exactly 1 second remaining', () => {
      const timerState = createTimerState({ remaining_ms: 1000 });
      const { getByText } = render(
        <AutoPassTimer timerState={timerState} currentPlayerIndex={0} />
      );

      expect(getByText('1')).toBeTruthy();
      expect(getByText('No one can beat this play - 1s to pass')).toBeTruthy();
    });

    it('should handle full duration (10 seconds)', () => {
      const timerState = createTimerState({ 
        duration_ms: 10000, 
        remaining_ms: 10000 
      });
      const { getByText } = render(
        <AutoPassTimer timerState={timerState} currentPlayerIndex={0} />
      );

      expect(getByText('10')).toBeTruthy();
    });
  });

  describe('Component Props', () => {
    it('should accept currentPlayerIndex prop', () => {
      const timerState = createTimerState();
      const { getByText } = render(
        <AutoPassTimer timerState={timerState} currentPlayerIndex={2} />
      );

      expect(getByText('10')).toBeTruthy();
    });

    it('should handle null timerState gracefully', () => {
      const { queryByText } = render(
        <AutoPassTimer timerState={null} currentPlayerIndex={0} />
      );

      // Should not render anything when timer is null
      expect(queryByText('sec')).toBeNull();
    });
  });
});
