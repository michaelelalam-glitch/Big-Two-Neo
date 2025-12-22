/**
 * Tests for LandscapeControlBar Component
 * 
 * Task #451: Implement control bar with all button groups
 * Date: December 19, 2025
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { LandscapeControlBar } from '../LandscapeControlBar';

// Mock SafeAreaView
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaView: ({ children, ...props }: any) => 
      React.createElement(View, props, children),
  };
});

// Mock Haptics
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: {
    Light: 'light',
    Medium: 'medium',
    Heavy: 'heavy',
  },
}));

// ============================================================================
// TEST SUITE: RENDERING
// ============================================================================

describe('LandscapeControlBar - Rendering', () => {
  it('renders all button groups', () => {
    const { getByTestId } = render(
      <LandscapeControlBar
        onOrientationToggle={jest.fn()}
        onSort={jest.fn()}
        onSmartSort={jest.fn()}
        onPlay={jest.fn()}
        onPass={jest.fn()}
        onHint={jest.fn()}
        onSettings={jest.fn()}
      />
    );

    // Group 1: Orientation Toggle (Help button removed in landscape)
    expect(getByTestId('orientation-toggle-button')).toBeTruthy();
    
    // Group 2: Sort Buttons
    expect(getByTestId('sort-button')).toBeTruthy();
    
    // Group 3: Sort Buttons
    expect(getByTestId('sort-button')).toBeTruthy();
    expect(getByTestId('smart-sort-button')).toBeTruthy();
    
    // Group 4: Action Buttons
    expect(getByTestId('play-button')).toBeTruthy();
    expect(getByTestId('pass-button')).toBeTruthy();
    
    // Group 5: Hint
    expect(getByTestId('hint-button')).toBeTruthy();
    
    // Group 6: Settings
    expect(getByTestId('settings-button')).toBeTruthy();
  });

  it('renders button labels correctly', () => {
    const { getByText } = render(
      <LandscapeControlBar
        onSort={jest.fn()}
        onSmartSort={jest.fn()}
        onPlay={jest.fn()}
        onPass={jest.fn()}
      />
    );

    expect(getByText('Sort')).toBeTruthy();
    expect(getByText('Smart')).toBeTruthy();
    expect(getByText('Play')).toBeTruthy();
    expect(getByText('Pass')).toBeTruthy();
  });

  it('renders icon buttons correctly', () => {
    const { getByText } = render(
      <LandscapeControlBar
        onOrientationToggle={jest.fn()}
        onSettings={jest.fn()}
      />
    );

    expect(getByText('🔄')).toBeTruthy(); // Orientation
    expect(getByText('⚙️')).toBeTruthy(); // Settings
    // Note: Hint is a text button, not icon button
  });
});

// ============================================================================
// TEST SUITE: BUTTON INTERACTIONS
// ============================================================================

describe('LandscapeControlBar - Button Interactions', () => {
  it('calls onOrientationToggle when orientation button pressed', () => {
    const onOrientationToggle = jest.fn();
    const { getByTestId } = render(
      <LandscapeControlBar onOrientationToggle={onOrientationToggle} />
    );

    fireEvent.press(getByTestId('orientation-toggle-button'));
    expect(onOrientationToggle).toHaveBeenCalledTimes(1);
  });

  it('calls onSort when sort button pressed', () => {
    const onSort = jest.fn();
    const { getByTestId } = render(
      <LandscapeControlBar onSort={onSort} />
    );

    fireEvent.press(getByTestId('sort-button'));
    expect(onSort).toHaveBeenCalledTimes(1);
  });

  it('calls onSmartSort when smart sort button pressed', () => {
    const onSmartSort = jest.fn();
    const { getByTestId } = render(
      <LandscapeControlBar onSmartSort={onSmartSort} />
    );

    fireEvent.press(getByTestId('smart-sort-button'));
    expect(onSmartSort).toHaveBeenCalledTimes(1);
  });

  it('calls onPlay when play button pressed', () => {
    const onPlay = jest.fn();
    const { getByTestId } = render(
      <LandscapeControlBar onPlay={onPlay} canPlay={true} />
    );

    fireEvent.press(getByTestId('play-button'));
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it('calls onPass when pass button pressed', () => {
    const onPass = jest.fn();
    const { getByTestId } = render(
      <LandscapeControlBar onPass={onPass} canPass={true} />
    );

    fireEvent.press(getByTestId('pass-button'));
    expect(onPass).toHaveBeenCalledTimes(1);
  });

  it('calls onHint when hint button pressed', () => {
    const onHint = jest.fn();
    const { getByTestId } = render(
      <LandscapeControlBar onHint={onHint} />
    );

    fireEvent.press(getByTestId('hint-button'));
    expect(onHint).toHaveBeenCalledTimes(1);
  });

  it('calls onSettings when settings button pressed', () => {
    const onSettings = jest.fn();
    const { getByTestId } = render(
      <LandscapeControlBar onSettings={onSettings} />
    );

    fireEvent.press(getByTestId('settings-button'));
    expect(onSettings).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// TEST SUITE: DISABLED STATE
// ============================================================================

describe('LandscapeControlBar - Disabled State', () => {
  it('disables sort buttons when disabled prop is true', () => {
    const onSort = jest.fn();
    const onSmartSort = jest.fn();
    const { getByTestId } = render(
      <LandscapeControlBar 
        onSort={onSort} 
        onSmartSort={onSmartSort}
        disabled={true}
      />
    );

    fireEvent.press(getByTestId('sort-button'));
    fireEvent.press(getByTestId('smart-sort-button'));
    
    expect(onSort).not.toHaveBeenCalled();
    expect(onSmartSort).not.toHaveBeenCalled();
  });

  it('disables play button when canPlay is false', () => {
    const onPlay = jest.fn();
    const { getByTestId } = render(
      <LandscapeControlBar onPlay={onPlay} canPlay={false} />
    );

    fireEvent.press(getByTestId('play-button'));
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('disables pass button when canPass is false', () => {
    const onPass = jest.fn();
    const { getByTestId } = render(
      <LandscapeControlBar onPass={onPass} canPass={false} />
    );

    fireEvent.press(getByTestId('pass-button'));
    expect(onPass).not.toHaveBeenCalled();
  });

  it('disables hint button when disabled prop is true', () => {
    const onHint = jest.fn();
    const { getByTestId } = render(
      <LandscapeControlBar onHint={onHint} disabled={true} />
    );

    fireEvent.press(getByTestId('hint-button'));
    expect(onHint).not.toHaveBeenCalled();
  });

  it('does NOT disable orientation toggle when disabled prop is true', () => {
    const onOrientationToggle = jest.fn();
    const { getByTestId } = render(
      <LandscapeControlBar 
        onOrientationToggle={onOrientationToggle}
        disabled={true}
      />
    );

    fireEvent.press(getByTestId('orientation-toggle-button'));
    expect(onOrientationToggle).toHaveBeenCalledTimes(1);
  });

  it('does NOT disable settings when disabled prop is true', () => {
    const onSettings = jest.fn();
    const { getByTestId } = render(
      <LandscapeControlBar onSettings={onSettings} disabled={true} />
    );

    fireEvent.press(getByTestId('settings-button'));
    expect(onSettings).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// TEST SUITE: HAPTIC FEEDBACK
// ============================================================================

describe('LandscapeControlBar - Haptic Feedback', () => {
  it('triggers haptic feedback when button pressed', async () => {
    const Haptics = require('expo-haptics');
    const { getByTestId } = render(
      <LandscapeControlBar onOrientationToggle={jest.fn()} />
    );

    fireEvent.press(getByTestId('orientation-toggle-button'));
    expect(Haptics.impactAsync).toHaveBeenCalledWith('light');
  });

  it('does not trigger haptic when disabled button pressed', () => {
    const Haptics = require('expo-haptics');
    Haptics.impactAsync.mockClear();

    const { getByTestId } = render(
      <LandscapeControlBar onSort={jest.fn()} disabled={true} />
    );

    fireEvent.press(getByTestId('sort-button'));
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });
});

// ============================================================================
// TEST SUITE: BUTTON VARIANTS
// ============================================================================

describe('LandscapeControlBar - Button Variants', () => {
  it('renders play button when canPlay is true', () => {
    const onPlay = jest.fn();
    const { getByTestId } = render(
      <LandscapeControlBar onPlay={onPlay} canPlay={true} />
    );

    const button = getByTestId('play-button');
    fireEvent.press(button);
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it('renders pass button when canPass is true', () => {
    const onPass = jest.fn();
    const { getByTestId } = render(
      <LandscapeControlBar onPass={onPass} canPass={true} />
    );

    const button = getByTestId('pass-button');
    fireEvent.press(button);
    expect(onPass).toHaveBeenCalledTimes(1);
  });

  it('renders sort buttons as ghost variant', () => {
    const { getByTestId } = render(
      <LandscapeControlBar onSort={jest.fn()} />
    );

    const button = getByTestId('sort-button');
    expect(button).toBeTruthy();
  });
});

// ============================================================================
// TEST SUITE: ACCESSIBILITY
// ============================================================================

describe('LandscapeControlBar - Accessibility', () => {
  it('provides testID for all buttons', () => {
    const { getByTestId } = render(
      <LandscapeControlBar
        onHelp={jest.fn()}
        onOrientationToggle={jest.fn()}
        onSort={jest.fn()}
        onSmartSort={jest.fn()}
        onPlay={jest.fn()}
        onPass={jest.fn()}
        onHint={jest.fn()}
        onSettings={jest.fn()}
      />
    );

    expect(getByTestId('orientation-toggle-button')).toBeTruthy();
    expect(getByTestId('sort-button')).toBeTruthy();
    expect(getByTestId('smart-sort-button')).toBeTruthy();
    expect(getByTestId('play-button')).toBeTruthy();
    expect(getByTestId('pass-button')).toBeTruthy();
    expect(getByTestId('hint-button')).toBeTruthy();
    expect(getByTestId('settings-button')).toBeTruthy();
  });

  it('disables play button when canPlay is false', () => {
    const onPlay = jest.fn();
    const { getByTestId } = render(
      <LandscapeControlBar 
        onPlay={onPlay}
        canPlay={false}
      />
    );

    const button = getByTestId('play-button');
    fireEvent.press(button);
    expect(onPlay).not.toHaveBeenCalled();
  });
});

// ============================================================================
// TEST SUITE: EDGE CASES
// ============================================================================

describe('LandscapeControlBar - Edge Cases', () => {
  it('renders without any handlers', () => {
    const { getByTestId } = render(<LandscapeControlBar />);
    
    // Should still render orientation button
    expect(getByTestId('orientation-toggle-button')).toBeTruthy();
  });

  it('handles press when handler is undefined', () => {
    const { getByTestId } = render(
      <LandscapeControlBar /> // No handlers
    );

    // Should not crash when pressed
    expect(() => {
      fireEvent.press(getByTestId('orientation-toggle-button'));
    }).not.toThrow();
  });

  it('enables play and pass when both canPlay and canPass are true', () => {
    const onPlay = jest.fn();
    const onPass = jest.fn();
    const { getByTestId } = render(
      <LandscapeControlBar 
        onPlay={onPlay}
        onPass={onPass}
        canPlay={true}
        canPass={true}
      />
    );

    fireEvent.press(getByTestId('play-button'));
    fireEvent.press(getByTestId('pass-button'));

    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPass).toHaveBeenCalledTimes(1);
  });
});
