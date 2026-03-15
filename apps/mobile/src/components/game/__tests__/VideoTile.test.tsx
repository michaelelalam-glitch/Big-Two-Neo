/**
 * Unit tests for VideoTile — Task #651
 * Tests cover render states, press behaviour, accessibility, and placeholder vs slot paths.
 */

import React from 'react';
import { View } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { VideoTile, VIDEO_TILE_SIZE } from '../VideoTile';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderTile(props: Partial<React.ComponentProps<typeof VideoTile>> = {}) {
  return render(
    <VideoTile
      isCameraOn={false}
      {...props}
    />
  );
}

// ---------------------------------------------------------------------------
// Render states
// ---------------------------------------------------------------------------

describe('VideoTile — render states', () => {
  it('renders without crashing', () => {
    const { toJSON } = renderTile();
    expect(toJSON()).not.toBeNull();
  });

  it('shows placeholder camera icon when camera is off and no videoStreamSlot', () => {
    const { getByText } = renderTile({ isCameraOn: false });
    expect(getByText('📵')).toBeTruthy();
  });

  it('shows active camera icon when camera is on and no videoStreamSlot', () => {
    const { getByText } = renderTile({ isCameraOn: true });
    expect(getByText('📷')).toBeTruthy();
  });

  it('shows connecting spinner when isConnecting=true (hides icon)', () => {
    const { queryByText, getByTestId } = renderTile({
      isCameraOn: false,
      isConnecting: true,
      testID: 'my-tile',
    });
    // Spinner is rendered
    expect(getByTestId('my-tile-connecting')).toBeTruthy();
    // Icon is NOT shown while connecting
    expect(queryByText('📵')).toBeNull();
    expect(queryByText('📷')).toBeNull();
  });

  it('renders provided videoStreamSlot instead of placeholder icon', () => {
    const { getByTestId, queryByText } = renderTile({
      isCameraOn: true,
      // Use a plain View (not a nested VideoTile) to avoid the nested tile
      // itself rendering the 📷 placeholder and causing a false positive.
      videoStreamSlot: <View testID="mock-stream" />,
    });
    // SDK slot is rendered
    expect(getByTestId('mock-stream')).toBeTruthy();
    // Placeholder icon is NOT shown
    expect(queryByText('📷')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Local player tile
// ---------------------------------------------------------------------------

describe('VideoTile — local player', () => {
  it('shows LIVE label when isLocal=true and camera is on', () => {
    const { getByText } = renderTile({ isCameraOn: true, isLocal: true });
    expect(getByText('LIVE')).toBeTruthy();
  });

  it('shows OFF label when isLocal=true and camera is off', () => {
    const { getByText } = renderTile({ isCameraOn: false, isLocal: true });
    expect(getByText('OFF')).toBeTruthy();
  });

  it('does NOT show LIVE / OFF label for remote tile', () => {
    const { queryByText } = renderTile({ isCameraOn: true, isLocal: false });
    expect(queryByText('LIVE')).toBeNull();
    expect(queryByText('OFF')).toBeNull();
  });

  it('calls onCameraToggle when local tile is pressed', () => {
    const onCameraToggle = jest.fn();
    const { getByTestId } = renderTile({
      isCameraOn: false,
      isLocal: true,
      onCameraToggle,
      testID: 'local-tile',
    });
    fireEvent.press(getByTestId('local-tile'));
    expect(onCameraToggle).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onCameraToggle when remote tile is pressed', () => {
    const onCameraToggle = jest.fn();
    const { getByTestId } = renderTile({
      isCameraOn: false,
      isLocal: false,
      onCameraToggle,
      testID: 'remote-tile',
    });
    fireEvent.press(getByTestId('remote-tile'));
    expect(onCameraToggle).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Accessibility
// ---------------------------------------------------------------------------

describe('VideoTile — accessibility', () => {
  it('announces "camera is on. Tap to turn off" for local tile with camera on and handler provided', () => {
    const { getByTestId } = renderTile({ isCameraOn: true, isLocal: true, onCameraToggle: jest.fn(), testID: 'tile-a11y' });
    const tile = getByTestId('tile-a11y');
    expect(tile.props.accessibilityLabel).toContain('camera is on');
    expect(tile.props.accessibilityLabel).toContain('Tap to turn off');
  });

  it('announces "camera is off. Tap to turn on" for local tile with camera off and handler provided', () => {
    const { getByTestId } = renderTile({ isCameraOn: false, isLocal: true, onCameraToggle: jest.fn(), testID: 'tile-on-a11y' });
    const tile = getByTestId('tile-on-a11y');
    expect(tile.props.accessibilityLabel).toContain('off');
    expect(tile.props.accessibilityLabel).toContain('Tap to turn on');
  });

  it('omits "Tap to" instruction when local tile is disabled (no onCameraToggle) — r2936061507', () => {
    // Without onCameraToggle the Pressable is disabled — the label must NOT include
    // "Tap to" so screen readers don't announce an actionable instruction for an inert control.
    const { getByTestId } = renderTile({ isCameraOn: false, isLocal: true, testID: 'disabled-tile' });
    const tile = getByTestId('disabled-tile');
    expect(tile.props.accessibilityLabel).toContain('camera is off');
    expect(tile.props.accessibilityLabel).not.toContain('Tap to');
    expect(tile.props.accessibilityState.disabled).toBe(true);
  });

  it('omits "Tap to" instruction when local tile camera is on but no handler — r2936061507', () => {
    const { getByTestId } = renderTile({ isCameraOn: true, isLocal: true, testID: 'disabled-on-tile' });
    const tile = getByTestId('disabled-on-tile');
    expect(tile.props.accessibilityLabel).toContain('camera is on');
    expect(tile.props.accessibilityLabel).not.toContain('Tap to');
  });

  it('announces opponent camera state for remote tile', () => {
    const { getByTestId } = renderTile({ isCameraOn: true, isLocal: false, testID: 'remote-a11y' });
    const tile = getByTestId('remote-a11y');
    expect(tile.props.accessibilityLabel).toContain("Opponent's camera");
    expect(tile.props.accessibilityRole).toBe('image');
  });

  it('uses role="button" for local tile', () => {
    const { getByTestId } = renderTile({ isCameraOn: false, isLocal: true, testID: 'local-role' });
    expect(getByTestId('local-role').props.accessibilityRole).toBe('button');
  });
});

// ---------------------------------------------------------------------------
// VIDEO_TILE_SIZE constant
// ---------------------------------------------------------------------------

describe('VIDEO_TILE_SIZE', () => {
  it('is a positive number (≥44 for touch target guidance)', () => {
    expect(VIDEO_TILE_SIZE).toBeGreaterThanOrEqual(44);
  });
});
