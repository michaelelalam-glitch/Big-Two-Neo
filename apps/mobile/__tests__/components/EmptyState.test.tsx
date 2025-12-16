/**
 * Tests for EmptyState component
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import EmptyState from '../../src/components/EmptyState';

describe('EmptyState', () => {
  it('renders with required title prop only', () => {
    const { getByText } = render(<EmptyState title="No data available" />);
    expect(getByText('No data available')).toBeTruthy();
  });

  it('renders with icon when provided', () => {
    const { getByText } = render(
      <EmptyState title="No rankings" icon="🏆" />
    );
    expect(getByText('🏆')).toBeTruthy();
    expect(getByText('No rankings')).toBeTruthy();
  });

  it('renders with subtitle when provided', () => {
    const { getByText } = render(
      <EmptyState 
        title="No rankings" 
        subtitle="Play games to appear on the leaderboard" 
      />
    );
    expect(getByText('No rankings')).toBeTruthy();
    expect(getByText('Play games to appear on the leaderboard')).toBeTruthy();
  });

  it('renders action button when provided', () => {
    const mockOnPress = jest.fn();
    const { getByText } = render(
      <EmptyState 
        title="No data" 
        action={{ label: 'Create New', onPress: mockOnPress }} 
      />
    );
    expect(getByText('Create New')).toBeTruthy();
  });

  it('invokes action button callback when pressed', () => {
    const mockOnPress = jest.fn();
    const { getByText } = render(
      <EmptyState 
        title="No data" 
        action={{ label: 'Create New', onPress: mockOnPress }} 
      />
    );
    
    fireEvent.press(getByText('Create New'));
    expect(mockOnPress).toHaveBeenCalledTimes(1);
  });

  it('renders with all props provided', () => {
    const mockOnPress = jest.fn();
    const { getByText } = render(
      <EmptyState 
        icon="🎮"
        title="No games found"
        subtitle="Start playing to see your history"
        action={{ label: 'Play Now', onPress: mockOnPress }}
        variant="dashed"
      />
    );
    
    expect(getByText('🎮')).toBeTruthy();
    expect(getByText('No games found')).toBeTruthy();
    expect(getByText('Start playing to see your history')).toBeTruthy();
    expect(getByText('Play Now')).toBeTruthy();
  });

  it('renders with default variant when not specified', () => {
    const { getByText } = render(<EmptyState title="Default variant" />);
    expect(getByText('Default variant')).toBeTruthy();
  });

  it('renders with dashed variant', () => {
    const { getByText } = render(
      <EmptyState title="Dashed variant" variant="dashed" />
    );
    expect(getByText('Dashed variant')).toBeTruthy();
  });

  it('renders with minimal variant', () => {
    const { getByText } = render(
      <EmptyState title="Minimal variant" variant="minimal" />
    );
    expect(getByText('Minimal variant')).toBeTruthy();
  });

  it('does not render subtitle when not provided', () => {
    const { queryByText } = render(<EmptyState title="No subtitle" />);
    // Only title should exist
    expect(queryByText('No subtitle')).toBeTruthy();
  });

  it('does not render icon when not provided', () => {
    const { container } = render(<EmptyState title="No icon" />);
    // Should only have title text, no icon
    expect(container.findAllByType('Text')).toHaveLength(1);
  });

  it('does not render action button when not provided', () => {
    const { container } = render(<EmptyState title="No action" />);
    // Should not have TouchableOpacity
    expect(container.findAllByType('TouchableOpacity')).toHaveLength(0);
  });
});
